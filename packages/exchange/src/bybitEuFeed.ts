// packages/exchange/src/bybitEuFeed.ts — a CCXT Pro bybit.eu illesztése
//
// FELADAT: A `BybitEuFeed` a CCXT Pro `bybiteu` exchange osztályát
// csomagolja be a `ExchangeFeed` interfészbe. A CCXT Pro minden
// `watch*` metódusa Promise<...>-vel tér vissza, és a CCXt belső state
// gép automatikusan újracsatlakozik — nekünk ezt Promise-alapú
// függvényhívásokká kell alakítanunk, amelyek push-alapú callback-eket
// hívnak meg.
//
// FONTOS: a CCXT Pro `watch*` metódusait EGY alkalommal kell hívni, és
// ők maguk rekurzívan hívják magukat (stateful iterator). A mi
// `subscribe*` metódusaink PONT EGY CCXT Pro hívást indítanak el, és
// a belső subscribe-állapotban tartják a referenciát, amíg a consumer
// le nem iratkozik.
/* eslint-disable @typescript-eslint/require-await -- Az `ExchangeFeed` interfész Promise-alapú, de egyes metódusok szinkron belső state-ből dolgoznak. */

import ccxt, {
  type Exchange as CcxtExchange,
  type Ticker as CcxtTicker,
  type OrderBook as CcxtOrderBook,
  type Trade as CcxtTrade,
  type MarketInterface as CcxtMarket,
  type Order as CcxtOrder,
  type Position as CcxtPosition,
} from "ccxt";

import type { ExchangeFeed, FeedListener, SubscriptionId } from "./feed.js";
import { ExchangeFeedError } from "./feed.js";
import type {
  Balance,
  ClientOrderId,
  ExchangeOrderId,
  ExchangePosition,
  Execution,
  FeedEvent,
  MarketMeta,
  Ohlcv,
  Order,
  OrderBook,
  OrderRequest,
  OrderStatus,
  Symbol,
  Ticker,
  Timeframe,
  Trade,
} from "./types.js";
import { isSupportedSymbol } from "./symbols.js";

/**
 * `BybitEuFeedOptions` — a CCXT Pro bybit.eu feed konfigurációja.
 *
 * Az `apiKey` és a `secret` KÖTELEZŐEN környezeti változóból jön —
 * a `createBybitEuFeed` factory felelős az olvasásukért, maga a feed
 * NEM olvas `process.env`-ből (tesztelhetőség miatt).
 */
export interface BybitEuFeedOptions {
  readonly apiKey: string;
  readonly secret: string;
  /** Rate limit ms-ban. Alap: 100 (10 req/sec — bybit V5 biztonságos alap, lásd stack-findings.md §7.1). */
  readonly rateLimitMs: number;
  /**
   * Ha `true`, a CCXT Pro `sandbox` módba kapcsol (`api-testnet.bybit.eu`).
   * A bybit.eu-n NINCS publikus sandbox (lásd stack-findings.md §1.3), ezért
   * ez csak opcionális — a paper mód NEM használja, csak manuális debughoz.
   */
  readonly sandbox: boolean;
  /** REST request timeout passed to the CCXT exchange instance. */
  readonly timeoutMs?: number;
  /**
   * Optional REST API origin.  CCXT's bybiteu adapter exposes separate
   * `spot`, `futures`, `v2`, `public`, and `private` REST URLs, therefore a
   * single configured origin is applied consistently to all five.
   *
   * Only an origin is accepted.  Supplying a path would make the generated
   * CCXT V5 request path ambiguous, so it is rejected rather than ignored.
   */
  readonly endpoint?: string;
  /**
   * Optional WebSocket origin.  The feed appends the documented V5 paths for
   * public spot and private streams.  As with `endpoint`, a path is rejected
   * to avoid silently constructing an invalid URL.
   */
  readonly wsEndpoint?: string;
  /**
   * `exchange` — opcionális, dependency injection célokra (tesztek).
   * Ha meg van adva, a feed ezt a CCXT exchange instance-ot használja
   * a `new ccxt.bybiteu(...)` factory hívás helyett. Ez lehetővé teszi
   * a tesztek számára, hogy a valódi CCXT modul mockolása nélkül
   * (ami izolációs bug-okat okozna más exchange tesztekben) tudják
   * tesztelni a feed-et.
   */
  readonly exchange?: CcxtExchange;
}

/**
 * A `BybitEuFeed` belső subscription-nyilvántartása. Egy `Subscription`
 * egy CCXT Pro `watch*` ciklust reprezentál, ami a consumer leiratkozásáig
 * fut. A `cancelled` flag biztosítja, hogy a CCXT promise-t ne hívjuk
 * tovább a leiratkozás után (amúgy is a CCXt-nek kell a watch-ot megszakítani,
 * de a mi kódunk biztonságosabb).
 */
interface Subscription {
  readonly id: SubscriptionId;
  readonly listener: FeedListener;
  readonly kind: "ticker" | "orderbook" | "trades" | "ohlcv" | "orders" | "executions";
  readonly symbol: Symbol | undefined;
  readonly timeframe: Timeframe | undefined;
  cancelled: boolean;
  /**
   * Megszakítja a REST fallback várakozását leiratkozáskor/close()-kor.
   * A már futó CCXT fetch Promise nem abortálható ezen az interfészen;
   * ezért minden fetch után, emit előtt újra ellenőrizzük a cancelled flaget.
   */
  readonly abortController: AbortController;
  /** A CCXT watch promise lánc — leiratkozáskor break-elünk. */
  runner: Promise<void>;
}

/**
 * Bybit V5 addresses orders created with an `orderLinkId`; CCXT's generic
 * `*WithClientOrderId` fallbacks do not translate that field for Bybit.  Keep
 * the request category required to retrieve/cancel a conditional spot order
 * until the normal bounded order lifecycle has had a chance to settle it.
 */
interface ClientOrderMetadata {
  readonly symbol: Symbol;
  readonly spotOrderFilter: "Order" | "StopOrder" | undefined;
  terminalAt: number | undefined;
}

const CLIENT_ORDER_METADATA_LIMIT = 5_000;
const CLIENT_ORDER_TERMINAL_TTL_MS = 60 * 60 * 1_000;

const TIMEFRAME_MS: Readonly<Record<Timeframe, number>> = {
  "1m": 60_000,
  "5m": 5 * 60_000,
  "15m": 15 * 60_000,
  "1h": 60 * 60_000,
  "4h": 4 * 60 * 60_000,
  "1d": 24 * 60 * 60_000,
};

function isNotSupportedError(err: unknown): boolean {
  return (
    err instanceof Error &&
    (err.name === "NotSupported" ||
      err.message.includes("NotSupported") ||
      err.message.includes("is not supported yet"))
  );
}

/**
 * A fallback polling két kör között azonnal felébreszthető. A korábbi
 * `setInterval`-alapú megoldás minden normál timeout után hátrahagyta az
 * intervalt; itt egyetlen timeout és egy egyszer lefutó abort-listener él.
 */
function waitForNextPoll(signal: AbortSignal, delayMs = 1_000): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal.removeEventListener("abort", finish);
      resolve();
    };
    const timeout = setTimeout(finish, delayMs);
    if (signal.aborted) {
      finish();
      return;
    }
    signal.addEventListener("abort", finish, { once: true });
  });
}

function isClosedOhlcv(candle: Ohlcv, timeframe: Timeframe, now = Date.now()): boolean {
  return candle[0] + TIMEFRAME_MS[timeframe] <= now;
}

/**
 * CCXT expects base origins in its `urls` map and appends exchange-specific
 * paths itself. Accepting an arbitrary path here would either duplicate V5
 * paths or silently redirect requests to a different route, so reject it.
 */
function validateOrigin(value: string, field: "endpoint" | "wsEndpoint"): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new ExchangeFeedError(`[bybiteu] ${field} must be an absolute URL, got ${value}`, undefined);
  }
  const expectedProtocol = field === "endpoint" ? "https:" : "wss:";
  if (parsed.protocol !== expectedProtocol) {
    throw new ExchangeFeedError(
      `[bybiteu] ${field} must use ${expectedProtocol}, got ${parsed.protocol}`,
      undefined,
    );
  }
  if (parsed.pathname !== "/" || parsed.search !== "" || parsed.hash !== "") {
    throw new ExchangeFeedError(
      `[bybiteu] ${field} must be an origin without path, query, or fragment: ${value}`,
      undefined,
    );
  }
  return parsed.origin;
}

/**
 * `BybitEuFeed` — a CCXT Pro bybit.eu SPOT feed illesztése.
 *
 * A konstruktor NEM nyit WS kapcsolatot — a `open()` hívás indítja a
 * CCXT Pro `loadMarkets()` hívását, ami a CCXT belső WS client-et
 * is inicializálja. A `close()` hívás zárja le a connection-t.
 */
export class BybitEuFeed implements ExchangeFeed {
  readonly exchangeId = "bybiteu";
  private readonly client: CcxtExchange;
  private readonly subs = new Map<SubscriptionId, Subscription>();
  private readonly clientOrderMetadata = new Map<ClientOrderId, ClientOrderMetadata>();
  private nextId: SubscriptionId = 1;
  private opened = false;

  constructor(opts: BybitEuFeedOptions) {
    // Dependency injection: ha a caller átad egy exchange instance-ot,
    // azt használjuk. Egyébként a CCXT factory-t hívjuk.
    if (opts.exchange !== undefined) {
      this.client = opts.exchange;
    } else {
      // A CCXT CJS disztribúcióban a `watch*` metódusok kizárólag a
      // `ccxt.pro.bybiteu` namespace-en érhetők el (a `ccxt.bybiteu` a
      // REST-only class — `pro instance instanceof ccxt.bybiteu === false`).
      // Az `instanceof` ellenőrzés a tesztben (C1) garantálja, hogy a
      // production konstruktor a WS-enabled osztályt használja.
      this.client = new ccxt.pro.bybiteu({
        apiKey: opts.apiKey,
        secret: opts.secret,
        enableRateLimit: true,
        rateLimit: opts.rateLimitMs,
        ...(opts.timeoutMs !== undefined ? { timeout: opts.timeoutMs } : {}),
        options: { defaultType: "spot" },
      });
    }
    if (opts.sandbox && (opts.endpoint !== undefined || opts.wsEndpoint !== undefined)) {
      throw new ExchangeFeedError(
        "[bybiteu] sandbox cannot be combined with endpoint or wsEndpoint overrides; " +
          "CCXT setSandboxMode replaces the exchange URL set",
        undefined,
      );
    }
    if (opts.sandbox) {
      // A CCXT Pro setSandboxMode(true) azonnal átvált a testnet URL-re.
      // bybit.eu-n a `api-testnet.bybit.eu` hostra mutat (bár nincs rajta
      // publikus sandbox, a CCXT kód nem tiltja — lásd stack-findings.md §1.3).
      this.client.setSandboxMode(true);
    }
    if (opts.endpoint !== undefined) {
      this.applyRestEndpoint(opts.endpoint);
    }
    if (opts.wsEndpoint !== undefined) {
      this.applyWebsocketEndpoint(opts.wsEndpoint);
    }
  }

  /** Apply an explicit REST origin to every REST route used by CCXT bybiteu. */
  private applyRestEndpoint(endpoint: string): void {
    const origin = validateOrigin(endpoint, "endpoint");
    const urls = this.client.urls as unknown as {
      api: Record<string, unknown>;
    };
    for (const key of ["spot", "futures", "v2", "public", "private"] as const) {
      urls.api[key] = origin;
    }
  }

  /** Apply a WebSocket origin using the V5 stream paths documented by Bybit. */
  private applyWebsocketEndpoint(wsEndpoint: string): void {
    const origin = validateOrigin(wsEndpoint, "wsEndpoint");
    const urls = this.client.urls as unknown as {
      api: {
        ws?: {
          public?: Record<string, unknown>;
          private?: {
            spot?: Record<string, unknown>;
            contract?: unknown;
            trade?: unknown;
          };
        };
      };
    };
    const ws = urls.api.ws;
    if (ws?.public === undefined || ws.private === undefined) {
      throw new ExchangeFeedError("[bybiteu] CCXT bybiteu adapter does not expose configurable V5 WebSocket URLs", undefined);
    }
    ws.public["spot"] = `${origin}/v5/public/spot`;
    if (ws.private.spot !== undefined) {
      ws.private.spot["unified"] = `${origin}/v5/private`;
      ws.private.spot["nonUnified"] = `${origin}/spot/private/v3`;
    }
    ws.private.contract = `${origin}/v5/private`;
    ws.private.trade = `${origin}/v5/trade`;
  }

  /**
   * A CCXT nyers exchange objektum elérése — csak a felsőbb rétegek
   * (paper engine, TUI) számára, akik a CCXT Pro watch* metódusait
   * közvetlenül szeretnék hívni. A legtöbb felhasználó számára a
   * `subscribe*` metódusok elegendőek.
   */
  get raw(): CcxtExchange {
    return this.client;
  }

  async open(): Promise<void> {
    if (this.opened) return;
    // A `loadMarkets` REST hívás, de a CCXT Pro belső WS client-jét is
    // inicializálja. A további `watch*` hívások ezen a client-en mennek.
    await this.client.loadMarkets();
    this.opened = true;
  }

  async close(): Promise<void> {
    // Az összes aktív subscription-t megszakítjuk; a CCXT Pro a saját
    // belső state-jében a `watch*` promise-okat cleanup-olja.
    for (const sub of this.subs.values()) {
      sub.cancelled = true;
      sub.abortController.abort();
    }
    this.subs.clear();
    this.opened = false;
    // C3 fix: a CCXT Pro NEM zárja be magát a watch* promise-ok cleanup-ja
    // után — a `client.close()` hívás szükséges az underlying WS connection
    // lezárásához. A `latency-monitor.ts` és a CCXT Pro dokumentáció ezt
    // explicit kéri (ld. /tmp/ccxt-FINAL-REPORT.md C3).
    await this.client.close();
  }

  async subscribeTicker(symbol: Symbol, listener: FeedListener): Promise<SubscriptionId> {
    this.assertOpen();
    const id = this.nextId++;
    const sub: Subscription = {
      id,
      listener,
      kind: "ticker",
      symbol,
      timeframe: undefined,
      cancelled: false,
      abortController: new AbortController(),
      runner: undefined as unknown as Promise<void>,
    };
    this.subs.set(id, sub);
    sub.runner = this.runTickerLoop(id, symbol, listener);
    return id;
  }

  async subscribeOrderBook(symbol: Symbol, limit: number, listener: FeedListener): Promise<SubscriptionId> {
    this.assertOpen();
    const id = this.nextId++;
    const sub: Subscription = {
      id,
      listener,
      kind: "orderbook",
      symbol,
      timeframe: undefined,
      cancelled: false,
      abortController: new AbortController(),
      runner: undefined as unknown as Promise<void>,
    };
    this.subs.set(id, sub);
    sub.runner = this.runOrderBookLoop(id, symbol, limit, listener);
    return id;
  }

  async subscribeTrades(symbol: Symbol, listener: FeedListener): Promise<SubscriptionId> {
    this.assertOpen();
    const id = this.nextId++;
    const sub: Subscription = {
      id,
      listener,
      kind: "trades",
      symbol,
      timeframe: undefined,
      cancelled: false,
      abortController: new AbortController(),
      runner: undefined as unknown as Promise<void>,
    };
    this.subs.set(id, sub);
    sub.runner = this.runTradesLoop(id, symbol, listener);
    return id;
  }

  async subscribeOhlcv(symbol: Symbol, timeframe: Timeframe, listener: FeedListener): Promise<SubscriptionId> {
    this.assertOpen();
    const id = this.nextId++;
    const sub: Subscription = {
      id,
      listener,
      kind: "ohlcv",
      symbol,
      timeframe,
      cancelled: false,
      abortController: new AbortController(),
      runner: undefined as unknown as Promise<void>,
    };
    this.subs.set(id, sub);
    sub.runner = this.runOhlcvLoop(id, symbol, timeframe, listener);
    return id;
  }

  async subscribeOrderUpdates(listener: FeedListener): Promise<SubscriptionId> {
    this.assertOpen();
    const id = this.nextId++;
    const sub: Subscription = {
      id, listener, kind: "orders", symbol: undefined, timeframe: undefined,
      cancelled: false, abortController: new AbortController(), runner: undefined as unknown as Promise<void>,
    };
    this.subs.set(id, sub);
    sub.runner = this.runPrivateOrdersLoop(id, listener);
    return id;
  }

  async subscribeExecutions(listener: FeedListener): Promise<SubscriptionId> {
    this.assertOpen();
    const id = this.nextId++;
    const sub: Subscription = {
      id, listener, kind: "executions", symbol: undefined, timeframe: undefined,
      cancelled: false, abortController: new AbortController(), runner: undefined as unknown as Promise<void>,
    };
    this.subs.set(id, sub);
    sub.runner = this.runPrivateExecutionsLoop(id, listener);
    return id;
  }

  async unsubscribe(id: SubscriptionId): Promise<void> {
    const sub = this.subs.get(id);
    if (sub === undefined) return;
    sub.cancelled = true;
    sub.abortController.abort();
    this.subs.delete(id);
    try {
      if (sub.kind === "orders" && this.client.has["unWatchOrders"] === true) {
        await this.client.unWatchOrders();
      } else if (sub.kind === "executions" && this.client.has["unWatchMyTrades"] === true) {
        await this.client.unWatchMyTrades();
      }
    } catch {
      // `close()` still tears down the underlying private socket.  Some CCXT
      // market modes expose watch but not unwatch; local cancellation already
      // prevents any further callback delivery.
    }
    // A CCXT promise chain-t NEM tudjuk megszakítani, de a `cancelled` flag
    // miatt a callback-eket már nem hívjuk — a következő tick-ek
    // no-op-ként mennek tovább a CCXT-en belül, amíg a CCXt belső
    // WS reconnect ciklusa ki nem zárja az adott topic-ot.
  }

  async fetchTickerSnapshot(symbol: Symbol): Promise<Ticker> {
    this.assertOpen();
    this.assertSupported(symbol);
    const raw = await this.client.fetchTicker(symbol);
    return normalizeTicker(raw, symbol);
  }

  async fetchOrderBookSnapshot(symbol: Symbol, limit: number): Promise<OrderBook> {
    this.assertOpen();
    this.assertSupported(symbol);
    const raw = await this.client.fetchOrderBook(symbol, limit);
    return normalizeOrderBook(raw, symbol);
  }

  /**
   * `fetchOHLCV` — REST OHLCV history lekérése (CCXT Pro `fetchOHLCV`).
   *
   * A `OhlcStream.start()` hívja a backfill során, hogy az indítás
   * előtt feltöltse a ring buffer-t az utolsó `limit` darab lezárt
   * bar-ral. A bybit V5 default limit 1000 — ezt a CCXt saját
   * default-jára bízzuk (a hívó felelőssége a `limit` megadása).
   */
  async fetchOHLCV(symbol: Symbol, timeframe: Timeframe, since: number | undefined, limit: number): Promise<readonly Ohlcv[]> {
    this.assertOpen();
    this.assertSupported(symbol);
    const raw = await this.client.fetchOHLCV(symbol, timeframe, since, limit);
    return raw as readonly Ohlcv[];
  }

  async fetchMarketMeta(symbol: Symbol): Promise<MarketMeta> {
    this.assertOpen();
    this.assertSupported(symbol);
    // A CCXT `markets` mező `Dictionary<any>` (index signature), a
    // `noPropertyAccessFromIndexSignature` miatt csak `[]` szintaxissal
    // érhető el. A `markets[symbol]` értéke `any` — ellenőrizzük, hogy
    // valóban MarketInterface-e, mielőtt normalizálunk.
    const markets = this.client.markets as Record<string, CcxtMarket | undefined>;
    // eslint-disable-next-line security/detect-object-injection -- symbol brand type, internal use
    const market = markets[symbol];
    if (market === undefined) {
      throw new ExchangeFeedError(`Ismeretlen market: ${symbol}`, undefined);
    }
    return normalizeMarketMeta(market, symbol);
  }

  async fetchBalances(): Promise<readonly Balance[]> {
    this.assertOpen();
    const raw = await this.client.fetchBalance();
    // A CCXT `Balances` típus `info: any` + `timestamp?: any` + `datetime?: any` extra
    // mezőket tartalmaz, amiket a mi normalizálónk külön szűr.
    return normalizeBalances(raw);
  }

  /**
   * Exchange-authoritative positions for emergency reconciliation.  Bybit's
   * spot category does not support positions, so CCXT capability is checked
   * explicitly instead of silently returning an empty list.
   */
  async fetchPositions(symbols?: readonly Symbol[]): Promise<readonly ExchangePosition[]> {
    this.assertOpen();
    if (this.client.has["fetchPositions"] !== true) {
      throw new ExchangeFeedError("The configured Bybit category does not support fetchPositions", undefined);
    }
    const raw = await this.client.fetchPositions(symbols === undefined ? undefined : [...symbols]);
    return raw
      .map((position) => normalizePosition(position))
      .filter((position): position is ExchangePosition => position !== undefined);
  }

  async placeOrder(req: OrderRequest): Promise<Order> {
    this.assertOpen();
    this.assertSupported(req.symbol);
    if (req.type === "limit" && req.price === undefined) {
      throw new ExchangeFeedError(`Limit order-hez kötelező a price mező: ${req.clientOrderId}`, undefined);
    }
    const market = this.client.market(req.symbol);
    // Explicit V5 key: CCXT also accepts clientOrderId and translates it,
    // but preserving orderLinkId at this boundary avoids an adapter-specific
    // generic client-id path and makes the intended wire identifier clear.
    const params: Record<string, unknown> = { orderLinkId: req.clientOrderId };
    if (req.protectiveKind !== undefined) {
      if (req.triggerPrice === undefined) throw new ExchangeFeedError("Protective order requires triggerPrice", undefined);
      if (market.spot) {
        // V5 spot conditional: triggerPrice + StopOrder.  CCXT 4.5.64 also
        // derives this filter, but pass it explicitly to keep the wire shape
        // stable.  Spot has no reduceOnly; the order sells only the confirmed
        // acquired base quantity and sibling cancellation provides OCO-like
        // lifecycle handling.
        Object.assign(params, { triggerPrice: req.triggerPrice, orderFilter: "StopOrder" });
      } else {
        // CCXT maps these fields to V5 conditional close orders with the
        // correct triggerDirection for the close side. closeOnTrigger avoids
        // an SL failing merely because other orders consume margin.
        Object.assign(params, {
          reduceOnly: true,
          closeOnTrigger: true,
          ...(req.protectiveKind === "stop_loss"
            ? { stopLossPrice: req.triggerPrice }
            : { takeProfitPrice: req.triggerPrice }),
        });
      }
    } else if (req.reduceOnly === true && !market.spot) {
      Object.assign(params, { reduceOnly: true });
    }
    const raw = await this.client.createOrder(req.symbol, req.type, req.side, req.amount, req.price, params);
    const order = normalizeOrder(raw, req);
    this.rememberClientOrder(req.clientOrderId, req.symbol, market.spot
      ? (req.protectiveKind === undefined ? "Order" : "StopOrder")
      : undefined, order.status);
    return order;
  }

  async cancelOrder(clientOrderId: ClientOrderId, symbol: Symbol): Promise<Order> {
    this.assertOpen();
    this.assertSupported(symbol);
    const metadata = this.clientOrderMetadata.get(clientOrderId);
    const isSpot = this.client.market(symbol).spot;
    const params: Record<string, unknown> = { orderLinkId: clientOrderId };
    if (isSpot) params["orderFilter"] = metadata?.spotOrderFilter ?? "Order";
    // Do not use CCXT's generic cancelOrderWithClientOrderId().  In pinned
    // CCXT it produces `orderId: ""` + `clientOrderId`, neither of which is
    // Bybit V5's documented `orderLinkId` request field.
    const raw = await this.client.cancelOrder(undefined as unknown as string, symbol, params);
    const order = normalizeOrder(raw, undefined);
    this.rememberClientOrder(clientOrderId, symbol, isSpot ? (params["orderFilter"] as "Order" | "StopOrder") : undefined, order.status);
    return order;
  }

  async fetchOrder(clientOrderId: ClientOrderId, symbol: Symbol): Promise<Order> {
    this.assertOpen();
    this.assertSupported(symbol);
    const metadata = this.clientOrderMetadata.get(clientOrderId);
    const isSpot = this.client.market(symbol).spot;
    const params: Record<string, unknown> = { orderLinkId: clientOrderId, acknowledged: true };
    if (isSpot && metadata?.spotOrderFilter === "StopOrder") {
      // CCXT maps `trigger` to Bybit's spot StopOrder filter for realtime
      // lookup.  This is distinct from an attached TP/SL order.
      params["trigger"] = true;
    }
    // Passing undefined suppresses CCXT's `orderId` field; `orderLinkId` is
    // the sole identifier on the V5 request. `acknowledged` is required by
    // CCXT's Bybit fetchOrder guard for its limited realtime-order endpoint.
    const raw = await this.client.fetchOrder(undefined as unknown as string, symbol, params);
    const order = normalizeOrder(raw, undefined);
    this.rememberClientOrder(clientOrderId, symbol, isSpot ? metadata?.spotOrderFilter : undefined, order.status);
    return order;
  }

  private rememberClientOrder(
    clientOrderId: ClientOrderId,
    symbol: Symbol,
    spotOrderFilter: "Order" | "StopOrder" | undefined,
    status: OrderStatus,
  ): void {
    const terminalAt = status === "open" ? undefined : Date.now();
    this.clientOrderMetadata.delete(clientOrderId);
    this.clientOrderMetadata.set(clientOrderId, { symbol, spotOrderFilter, terminalAt });
    const cutoff = Date.now() - CLIENT_ORDER_TERMINAL_TTL_MS;
    for (const [id, value] of this.clientOrderMetadata) {
      if (value.terminalAt !== undefined && value.terminalAt < cutoff) this.clientOrderMetadata.delete(id);
    }
    while (this.clientOrderMetadata.size > CLIENT_ORDER_METADATA_LIMIT) {
      const oldest = this.clientOrderMetadata.keys().next().value;
      if (oldest === undefined) break;
      this.clientOrderMetadata.delete(oldest);
    }
  }

  async fetchOpenOrders(symbol: Symbol): Promise<readonly Order[]> {
    this.assertOpen();
    this.assertSupported(symbol);
    const raws = await this.client.fetchOpenOrders(symbol);
    return raws.map((raw) => normalizeOrder(raw, undefined));
  }

  statusOf(s: string): OrderStatus {
    if (s === "open" || s === "closed" || s === "canceled") return s;
    // A CCXT néha "filled" státuszt ad vissza — ezt "closed"-ra normalizáljuk.
    if (s === "filled") return "closed";
    return "open";
  }

  // === Belső watch loop-ok (CCXT Pro stateful iterátorok) ===

  private async runTickerLoop(id: SubscriptionId, symbol: Symbol, listener: FeedListener): Promise<void> {
    const sub = this.subs.get(id);
    if (sub === undefined) return;
    // A lokális `cancelled` flag-ot a `sub.cancelled` alapján olvassuk —
    // ezáltal a typescript-eslint `no-unnecessary-condition` szabálya nem
    // jelzi false-positive-szal a `while (!cancelled)` cikluson belüli
    // ellenőrzéseket (amelyek a CCXT `await` hívás utáni korszakban
    // kritikusak a consumer leiratkozásának azonnali tiszteletben tartásához).
    let cancelled = sub.cancelled;
    try {
      // A CCXT Pro watchTicker saját magát rekurzívan hívja — ha a WS
      // kapcsolat megszakad, a CCXT reconnect-el és újra hívja a watch-ot.
      while (!cancelled) {
        const raw = await this.client.watchTicker(symbol);
        cancelled = sub.cancelled;
        if (cancelled) return;
        const t = normalizeTicker(raw, symbol);
        const event: FeedEvent = { kind: "ticker", payload: t };
        listener(event);
      }
    } catch (err) {
      if (cancelled) return;
      // Phase 66: the CCXT bybit.eu `watchTicker()` is not supported
      // in CCXT 4.5.64 (`NotSupported: bybiteu watchTicker() is not
      // supported yet`). Fall back to polling `fetchTicker` at 1s
      // intervals — the public REST endpoint works without auth.
      const isNotSupported = isNotSupportedError(err);
      if (isNotSupported) {
        while (!cancelled) {
          try {
            const raw = await this.client.fetchTicker(symbol);
            cancelled = sub.cancelled;
            if (cancelled) return;
            const t = normalizeTicker(raw, symbol);
            const event: FeedEvent = { kind: "ticker", payload: t };
            listener(event);
          } catch {
            if (cancelled) return;
          }
          await waitForNextPoll(sub.abortController.signal);
          cancelled = sub.cancelled;
        }
        return;
      }
      // At this point the `if (isNotSupported) { ... }` block has
      // either returned early (cancelled) or exited its inner `while`
      // loop (which only ends when `cancelled === true`). Throwing
      // here is therefore unconditional; the `if (!cancelled)` guard
      // was dead code (the @typescript-eslint/no-unnecessary-condition
      // rule flagged it in CI).
      throw new ExchangeFeedError(`Ticker watch hiba: ${symbol}`, err);
    }
  }

  private async runOrderBookLoop(id: SubscriptionId, symbol: Symbol, limit: number, listener: FeedListener): Promise<void> {
    const sub = this.subs.get(id);
    if (sub === undefined) return;
    let cancelled = sub.cancelled;
    try {
      while (!cancelled) {
        const raw = await this.client.watchOrderBook(symbol, limit);
        cancelled = sub.cancelled;
        if (cancelled) return;
        const ob = normalizeOrderBook(raw, symbol);
        const event: FeedEvent = { kind: "orderbook", payload: ob };
        listener(event);
      }
    } catch (err) {
      if (cancelled) return;
      // C2 fix: defenzív NotSupported → REST polling fallback. A C1 fix
      // (ccxt.pro.bybiteu) után ez sosem fut le, DE ha a CCXT verzió
      // downgrade-elődik vagy a `ccxt.pro` namespace eltűnik, a fallback
      // megmenti a botot az összeomlástól (ugyanaz a minta, mint a
      // `runTickerLoop` 358-383 sorokon).
      const isNotSupported = isNotSupportedError(err);
      if (isNotSupported) {
        while (!cancelled) {
          try {
            const raw = await this.client.fetchOrderBook(symbol, limit);
            cancelled = sub.cancelled;
            if (cancelled) return;
            const ob = normalizeOrderBook(raw, symbol);
            const event: FeedEvent = { kind: "orderbook", payload: ob };
            listener(event);
          } catch {
            if (cancelled) return;
          }
          await waitForNextPoll(sub.abortController.signal);
          cancelled = sub.cancelled;
        }
        return;
      }
      throw new ExchangeFeedError(`OrderBook watch hiba: ${symbol}`, err);
    }
  }

  private async runTradesLoop(id: SubscriptionId, symbol: Symbol, listener: FeedListener): Promise<void> {
    const sub = this.subs.get(id);
    if (sub === undefined) return;
    let cancelled = sub.cancelled;
    try {
      while (!cancelled) {
        const raw = await this.client.watchTrades(symbol);
        cancelled = sub.cancelled;
        if (cancelled) return;
        for (const trade of raw) {
          const t = normalizeTrade(trade, symbol);
          const event: FeedEvent = { kind: "trade", payload: t };
          listener(event);
        }
      }
    } catch (err) {
      if (cancelled) return;
      // C2 fix: defenzív NotSupported → REST polling fallback (ugyanaz
      // a minta, mint a `runTickerLoop` 358-383 sorokon és az
      // `runOrderBookLoop`-ban fent).
      const isNotSupported = isNotSupportedError(err);
      if (isNotSupported) {
        while (!cancelled) {
          try {
            const raw = await this.client.fetchTrades(symbol);
            cancelled = sub.cancelled;
            if (cancelled) return;
            for (const trade of raw) {
              const t = normalizeTrade(trade, symbol);
              const event: FeedEvent = { kind: "trade", payload: t };
              listener(event);
            }
          } catch {
            if (cancelled) return;
          }
          await waitForNextPoll(sub.abortController.signal);
          cancelled = sub.cancelled;
        }
        return;
      }
      throw new ExchangeFeedError(`Trades watch hiba: ${symbol}`, err);
    }
  }

  private async runOhlcvLoop(id: SubscriptionId, symbol: Symbol, timeframe: Timeframe, listener: FeedListener): Promise<void> {
    const sub = this.subs.get(id);
    if (sub === undefined) return;
    let cancelled = sub.cancelled;
    // A CCXT Pro a cache-elt OHLCV tömböt adja vissza minden update-nél.
    // Ezért subscriptionönként vízjelet tartunk: ugyanaz a lezárt candle
    // nem jut el kétszer a trading réteghez, de külön szimbólum/idősík
    // subscriptionök egymástól függetlenek maradnak.
    let lastEmittedTimestamp: number | undefined;
    let pendingWatchCandle: Ohlcv | undefined;
    const emitClosedCandles = (raw: readonly unknown[], source: "watch" | "rest"): void => {
      const candles = raw
        .map((candle) => candle as Ohlcv)
        .sort((a, b) => a[0] - b[0]);
      // CCXT's unified OHLCV tuple deliberately drops Bybit's raw
      // `confirm` flag.  For the websocket path we therefore never infer
      // finality merely from wall-clock time: the newest bucket is retained
      // until a strictly later bucket is observed.  Repeated open updates,
      // reconnect cache replays and a late final update only replace this
      // pending value; exactly one decision is emitted for the timestamp.
      // REST history has no confirm flag either, but its older buckets can be
      // closed with the explicit end-time rule while the current bucket stays
      // excluded.
      const candidates = source === "watch"
        ? (() => {
            const merged = pendingWatchCandle === undefined ? candles : [pendingWatchCandle, ...candles];
            const byTimestamp = new Map<number, Ohlcv>();
            for (const candle of merged) byTimestamp.set(candle[0], candle);
            const ordered = [...byTimestamp.values()].sort((a, b) => a[0] - b[0]);
            pendingWatchCandle = ordered.at(-1);
            return ordered.slice(0, -1);
          })()
        : candles.filter((candle) => isClosedOhlcv(candle, timeframe));
      for (const candle of candidates) {
        if (lastEmittedTimestamp !== undefined && candle[0] <= lastEmittedTimestamp) continue;
        const event: FeedEvent = {
          kind: "ohlcv",
          payload: { symbol, timeframe, candle },
        };
        listener(event);
        lastEmittedTimestamp = candle[0];
        // A listener szinkron módon hívhatja az async unsubscribe()-ot.
        // Az unsubscribe a legelső await előtt állítja a flaget, ezért a
        // cache következő candle-jét már ebben a ciklusban sem emitáljuk.
        if (sub.cancelled) return;
      }
    };
    try {
      while (!cancelled) {
        const raw = await this.client.watchOHLCV(symbol, timeframe);
        cancelled = sub.cancelled;
        if (cancelled) return;
        emitClosedCandles(raw, "watch");
        cancelled = sub.cancelled;
        if (cancelled) return;
      }
    } catch (err) {
      if (cancelled) return;
      // Phase 66: bybit.eu CCXT 4.5.64 doesn't support watchOHLCV
      // either. Fall back to polling fetchOHLCV at 1s.
      const isNotSupported = isNotSupportedError(err);
      if (isNotSupported) {
        while (!cancelled) {
          try {
            const raw = await this.client.fetchOHLCV(symbol, timeframe, undefined, 100);
            cancelled = sub.cancelled;
            if (cancelled) return;
            emitClosedCandles(raw, "rest");
            cancelled = sub.cancelled;
            if (cancelled) return;
          } catch {
            if (cancelled) return;
          }
          await waitForNextPoll(sub.abortController.signal);
          cancelled = sub.cancelled;
        }
        return;
      }
      // At this point the `if (isNotSupported) { ... }` block has
      // either returned early (cancelled) or exited its inner `while`
      // loop (which only ends when `cancelled === true`). Throwing
      // here is therefore unconditional; the `if (!cancelled)` guard
      // was dead code (the @typescript-eslint/no-unnecessary-condition
      // rule flagged it in CI).
      throw new ExchangeFeedError(`OHLCV watch hiba: ${symbol}/${timeframe}`, err);
    }
  }

  private async runPrivateOrdersLoop(id: SubscriptionId, listener: FeedListener): Promise<void> {
    const sub = this.subs.get(id);
    if (sub === undefined) return;
    let cancelled = sub.cancelled;
    try {
      while (!cancelled) {
        const updates = await this.client.watchOrders();
        cancelled = sub.cancelled;
        if (cancelled) return;
        for (const raw of updates) {
          const order = normalizeOrder(raw, undefined);
          if (order.clientOrderId === "" || String(order.symbol) === "UNKNOWN") continue;
          listener({ kind: "order", payload: order });
          cancelled = sub.cancelled;
          if (cancelled) return;
        }
      }
    } catch (err) {
      if (sub.cancelled) return;
      throw new ExchangeFeedError("Private order watch hiba", err);
    }
  }

  private async runPrivateExecutionsLoop(id: SubscriptionId, listener: FeedListener): Promise<void> {
    const sub = this.subs.get(id);
    if (sub === undefined) return;
    let cancelled = sub.cancelled;
    try {
      while (!cancelled) {
        const updates = await this.client.watchMyTrades();
        cancelled = sub.cancelled;
        if (cancelled) return;
        for (const raw of updates) {
          const execution = normalizeExecution(raw);
          if (execution === undefined) continue;
          listener({ kind: "execution", payload: execution });
          cancelled = sub.cancelled;
          if (cancelled) return;
        }
      }
    } catch (err) {
      if (sub.cancelled) return;
      throw new ExchangeFeedError("Private execution watch hiba", err);
    }
  }

  private assertOpen(): void {
    if (!this.opened) {
      throw new ExchangeFeedError("A feed még nincs megnyitva (hívd open()-t előbb)", undefined);
    }
  }

  private assertSupported(symbol: Symbol): void {
    if (!isSupportedSymbol(symbol)) {
      // A `symbol` brand típus, ezért a template literal szabály nem fogadja
      // el közvetlenül — átkonvertáljuk string-gé a hibaüzenetben.
      const symbolStr: string = symbol;
      throw new ExchangeFeedError(`Nem támogatott symbol: ${symbolStr}`, undefined);
    }
  }
}

/** `CcxtBalancesLike` — a CCXT `Balances` típusának egyszerűsített, normalizáló-barát változata.
 *
 * A CCXT `Balance` típus minden számszerű mezője `Num` = `number | undefined`,
 * és az `exactOptionalPropertyTypes: true` miatt a `number` nem elég — a
 * property-knek opcionálisnak KELL lenniük, vagy `undefined` union-nak.
 */
interface CcxtBalanceEntry {
  free?: number | undefined;
  used?: number | undefined;
  total?: number | undefined;
}
type CcxtBalancesLike = Record<string, CcxtBalanceEntry | undefined>;

// === Normalizáló függvények (CCXT → @mm/exchange típusok) ===

/** A CCXT `Ticker` → a mi `Ticker` típusunk. Az `undefined` mezőkhöz 0-t adunk. */
export function normalizeTicker(raw: CcxtTicker, symbol: Symbol): Ticker {
  return {
    symbol,
    timestamp: raw.timestamp ?? Date.now(),
    bid: raw.bid ?? 0,
    ask: raw.ask ?? 0,
    last: raw.last ?? 0,
    baseVolume: raw.baseVolume ?? 0,
    quoteVolume: raw.quoteVolume ?? 0,
  };
}

/** CCXT `OrderBook` → a mi `OrderBook` típusunk. */
export function normalizeOrderBook(raw: CcxtOrderBook, symbol: Symbol): OrderBook {
  return {
    symbol,
    timestamp: raw.timestamp ?? Date.now(),
    nonce: raw.nonce ?? 0,
    bids: raw.bids.map(([price, amount]) => ({ price: price ?? 0, amount: amount ?? 0 })),
    asks: raw.asks.map(([price, amount]) => ({ price: price ?? 0, amount: amount ?? 0 })),
  };
}

/** CCXT `Trade` → a mi `Trade` típusunk. */
export function normalizeTrade(raw: CcxtTrade, symbol: Symbol): Trade {
  const takerSide: "buy" | "sell" = raw.side === "sell" ? "sell" : "buy";
  return {
    id: raw.id ?? "",
    symbol,
    timestamp: raw.timestamp ?? Date.now(),
    price: raw.price ?? 0,
    amount: raw.amount ?? 0,
    takerSide,
  };
}

/** CCXT `Market` → a mi `MarketMeta` típusunk. */
export function normalizeMarketMeta(raw: CcxtMarket, symbol: Symbol): MarketMeta {
  // A CCXT precision: number — a tizedesjegyek számát adja meg.
  // A mi kódunk a `precision` értéket "tizedesjegy" -ként kezeli.
  const amountPrecision = typeof raw.precision.amount === "number" ? raw.precision.amount : 8;
  const pricePrecision = typeof raw.precision.price === "number" ? raw.precision.price : 2;
  return {
    symbol,
    base: raw.base,
    quote: raw.quote,
    amountPrecision,
    pricePrecision,
    minAmount: raw.limits.amount?.min ?? 0,
    minCost: raw.limits.cost?.min ?? 0,
    isSpot: raw.spot,
  };
}

/** CCXT `Balances` → a mi `Balance[]` típusunk. */
export function normalizeBalances(raw: CcxtBalancesLike): readonly Balance[] {
  const out: Balance[] = [];
  for (const [currency, entry] of Object.entries(raw)) {
    if (entry === undefined) continue;
    if (currency === "info" || currency === "timestamp" || currency === "datetime") continue;
    out.push({
      currency,
      free: entry.free ?? 0,
      total: entry.total ?? 0,
    });
  }
  return out;
}

/** CCXT derivative Position → emergency reconciliation shape. */
export function normalizePosition(raw: CcxtPosition): ExchangePosition | undefined {
  const quantity = raw.contracts ?? 0;
  if (!raw.symbol || !Number.isFinite(quantity) || quantity <= 0) return undefined;
  if (raw.side !== "long" && raw.side !== "short") return undefined;
  return {
    symbol: raw.symbol as Symbol,
    side: raw.side,
    quantity,
    entryPrice: raw.entryPrice,
    markPrice: raw.markPrice,
    unrealizedPnl: raw.unrealizedPnl,
    updateTimestamp: raw.lastUpdateTimestamp,
  };
}

/** CCXT authenticated trade -> execution. `id` is Bybit's execId. */
export function normalizeExecution(raw: CcxtTrade): Execution | undefined {
  if (raw.id === undefined || raw.id === "" || raw.symbol === undefined || raw.price === undefined || raw.amount === undefined) {
    return undefined;
  }
  const info = raw.info as Record<string, unknown> | undefined;
  const clientOrderIdRaw = info?.["orderLinkId"] ?? info?.["c"];
  const exchangeOrderIdRaw = raw.order ?? info?.["orderId"] ?? info?.["o"];
  return {
    executionId: raw.id,
    clientOrderId: typeof clientOrderIdRaw === "string" && clientOrderIdRaw !== "" ? clientOrderIdRaw as ClientOrderId : undefined,
    exchangeOrderId: typeof exchangeOrderIdRaw === "string" && exchangeOrderIdRaw !== "" ? exchangeOrderIdRaw as ExchangeOrderId : undefined,
    symbol: raw.symbol as Symbol,
    side: raw.side === "sell" ? "sell" : "buy",
    quantity: raw.amount,
    price: raw.price,
    fee: raw.fee?.cost ?? 0,
    feeCurrency: raw.fee?.currency,
    timestamp: raw.timestamp ?? Date.now(),
  };
}

/** CCXT `Order` → a mi `Order` típusunk. */
export function normalizeOrder(raw: CcxtOrder, req: OrderRequest | undefined): Order {
  const side: "buy" | "sell" = raw.side === "sell" ? "sell" : "buy";
  const status: OrderStatus = raw.status === "closed" || raw.status === "filled" ? "closed" : raw.status === "canceled" || raw.status === "cancelled" ? "canceled" : "open";
  return {
    clientOrderId: (raw.clientOrderId ?? req?.clientOrderId ?? "") as ClientOrderId,
    exchangeId: raw.id !== undefined && raw.id !== "" ? (raw.id as unknown as ExchangeOrderId) : undefined,
    symbol: (raw.symbol ?? req?.symbol ?? "UNKNOWN") as Symbol,
    side,
    type: raw.type === "limit" ? "limit" : "market",
    amount: raw.amount ?? 0,
    price: raw.price ?? req?.price,
    status,
    filled: raw.filled ?? 0,
    average: raw.average,
    submitTimestamp: raw.timestamp ?? Date.now(),
    updateTimestamp: raw.lastUpdateTimestamp,
  };
}
