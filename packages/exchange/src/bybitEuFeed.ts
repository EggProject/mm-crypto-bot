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
} from "ccxt";

import type { ExchangeFeed, FeedListener, SubscriptionId } from "./feed.js";
import { ExchangeFeedError } from "./feed.js";
import type {
  Balance,
  ClientOrderId,
  ExchangeOrderId,
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
  readonly kind: "ticker" | "orderbook" | "trades" | "ohlcv";
  readonly symbol: Symbol;
  readonly timeframe: Timeframe | undefined;
  cancelled: boolean;
  /** A CCXT watch promise lánc — leiratkozáskor break-elünk. */
  runner: Promise<void>;
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
  private nextId: SubscriptionId = 1;
  private opened = false;

  constructor(opts: BybitEuFeedOptions) {
    // Dependency injection: ha a caller átad egy exchange instance-ot,
    // azt használjuk. Egyébként a CCXT factory-t hívjuk.
    if (opts.exchange !== undefined) {
      this.client = opts.exchange;
    } else {
      // A CCXT factory `pro: true` flag-gel hozza létre a CCXT Pro belső WS
      // client-jét. A `new ccxt.pro.bybiteu(...)` is működne, de az ESM
      // import miatt az alap `ccxt.bybiteu` a CCXT Pro metódusait is tartalmazza
      // (4.5.x óta, lásd stack-findings.md §1.1).
      this.client = new ccxt.bybiteu({
        apiKey: opts.apiKey,
        secret: opts.secret,
        enableRateLimit: true,
        rateLimit: opts.rateLimitMs,
        options: { defaultType: "spot" },
      });
    }
    if (opts.sandbox) {
      // A CCXT Pro setSandboxMode(true) azonnal átvált a testnet URL-re.
      // bybit.eu-n a `api-testnet.bybit.eu` hostra mutat (bár nincs rajta
      // publikus sandbox, a CCXT kód nem tiltja — lásd stack-findings.md §1.3).
      this.client.setSandboxMode(true);
    }
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
    }
    this.subs.clear();
    this.opened = false;
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
      runner: undefined as unknown as Promise<void>,
    };
    this.subs.set(id, sub);
    sub.runner = this.runOhlcvLoop(id, symbol, timeframe, listener);
    return id;
  }

  async unsubscribe(id: SubscriptionId): Promise<void> {
    const sub = this.subs.get(id);
    if (sub === undefined) return;
    sub.cancelled = true;
    this.subs.delete(id);
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

  async placeOrder(req: OrderRequest): Promise<Order> {
    this.assertOpen();
    this.assertSupported(req.symbol);
    if (req.type === "limit" && req.price === undefined) {
      throw new ExchangeFeedError(`Limit order-hez kötelező a price mező: ${req.clientOrderId}`, undefined);
    }
    const params: Record<string, unknown> = {
      clientOrderId: req.clientOrderId,
      // A CCXT Pro bybit V5 támogatja a takeProfitPrice / stopLossPrice
      // params-ot — a bybit API automatikusan trigger order-t hoz létre.
      ...(req.takeProfitPrice !== undefined ? { takeProfitPrice: req.takeProfitPrice } : {}),
      ...(req.stopLossPrice !== undefined ? { stopLossPrice: req.stopLossPrice } : {}),
    };
    const raw = await this.client.createOrder(req.symbol, req.type, req.side, req.amount, req.price, params);
    return normalizeOrder(raw, req);
  }

  async cancelOrder(clientOrderId: ClientOrderId, symbol: Symbol): Promise<Order> {
    this.assertOpen();
    this.assertSupported(symbol);
    // A bybit V5 API-nak van dedikált `cancelOrderWithClientOrderId`
    // végpontja (lásd stack-findings.md §7.3 — idempotency).
    const raw = await this.client.cancelOrderWithClientOrderId(clientOrderId, symbol);
    return normalizeOrder(raw, undefined);
  }

  async fetchOrder(clientOrderId: ClientOrderId, symbol: Symbol): Promise<Order> {
    this.assertOpen();
    this.assertSupported(symbol);
    const raw = await this.client.fetchOrderWithClientOrderId(clientOrderId, symbol);
    return normalizeOrder(raw, undefined);
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
      const isNotSupported =
        err instanceof Error &&
        (err.name === "NotSupported" ||
          err.message.includes("NotSupported") ||
          err.message.includes("is not supported yet"));
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
          // Wait 1s before next poll, with a cancellable delay.
          await new Promise<void>((resolve) => {
            const handle = setTimeout(resolve, 1000);
            const checkInterval = setInterval(() => {
              if (sub.cancelled) {
                clearTimeout(handle);
                clearInterval(checkInterval);
                resolve();
              }
            }, 100);
          });
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
      if (!cancelled) {
        throw new ExchangeFeedError(`OrderBook watch hiba: ${symbol}`, err);
      }
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
      if (!cancelled) {
        throw new ExchangeFeedError(`Trades watch hiba: ${symbol}`, err);
      }
    }
  }

  private async runOhlcvLoop(id: SubscriptionId, symbol: Symbol, timeframe: Timeframe, listener: FeedListener): Promise<void> {
    const sub = this.subs.get(id);
    if (sub === undefined) return;
    let cancelled = sub.cancelled;
    try {
      while (!cancelled) {
        const raw = await this.client.watchOHLCV(symbol, timeframe);
        cancelled = sub.cancelled;
        if (cancelled) return;
        for (const candle of raw) {
          const event: FeedEvent = {
            kind: "ohlcv",
            payload: { symbol, timeframe, candle: candle as unknown as Ohlcv },
          };
          listener(event);
        }
      }
    } catch (err) {
      if (cancelled) return;
      // Phase 66: bybit.eu CCXT 4.5.64 doesn't support watchOHLCV
      // either. Fall back to polling fetchOHLCV at 1s.
      const isNotSupported =
        err instanceof Error &&
        (err.name === "NotSupported" ||
          err.message.includes("NotSupported") ||
          err.message.includes("is not supported yet"));
      if (isNotSupported) {
        while (!cancelled) {
          try {
            const raw = await this.client.fetchOHLCV(symbol, timeframe, undefined, 100);
            cancelled = sub.cancelled;
            if (cancelled) return;
            for (const candle of raw) {
              const event: FeedEvent = {
                kind: "ohlcv",
                payload: { symbol, timeframe, candle: candle as unknown as Ohlcv },
              };
              listener(event);
            }
          } catch {
            if (cancelled) return;
          }
          await new Promise<void>((resolve) => {
            const handle = setTimeout(resolve, 1000);
            const checkInterval = setInterval(() => {
              if (sub.cancelled) {
                clearTimeout(handle);
                clearInterval(checkInterval);
                resolve();
              }
            }, 100);
          });
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
