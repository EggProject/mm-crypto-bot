/**
 * apps/bot/src/web-client/http-server.ts
 *
 * ============================================================================
 * PHASE 46 — WEB CLIENT HTTP SERVER
 * ============================================================================
 *
 * A `HttpServer` a web client böngésző-felé néző HTTP végpontjait
 * kezeli. A `Bun.serve()` WebSocket-aware módját használja (a `Bun.serve`
 * egyetlen hívás az HTTP + WebSocket endpoint-okhoz), de a HTTP
 * handler-eket ez a fájl exportálja; a WebSocket relay-t a `ws-relay.ts`.
 *
 * A HTTP végpontok:
 *
 *   - GET  /                              → static index.html (a static-server)
 *   - GET  /static/*                      → static fájlok (a static-server)
 *   - GET  /api/strategies                → a state-feed-ből
 *   - GET  /api/ohlc?symbol=&tf=&count=   → a state-feed-ből
 *   - POST /api/control                   → a state-feed-nek
 *   - GET  /api/health                    → a web client health (mindig 200)
 *
 * ============================================================================
 * STATE-FEED INTEGRÁCIÓ
 * ============================================================================
 *
 *   A HTTP handler-ek a `StateFeedClientHandle`-en át érik el a
 *   state-feed klienst. A REST handler-ek a `send()` metódussal küldenek
 *   üzeneteket, és a `onMessage` callback-en át kapják a választ.
 *
 *   A request-response korreláció:
 *     - A kéréskor a handler generál egy `requestId`-t (UUID helyett
 *       egy monoton számláló + timestamp), és a state-feed felé küldi
 *       a CONTROL üzenetben (a `requestId` mezőben).
 *     - A state-feed a CONTROL üzenetet feldolgozza, és a választ
 *       egy külön "response" üzenetben küldi vissza (a `requestId`-val).
 *     - A handler a `pendingRequests` map-ből kikeresi a callback-et, és
 *       meghívja a válasszal.
 *
 *   Mivel a state-feed protokoll a Phase 45-ben NEM támogatja a
 *   request-response korrelációt (a CONTROL egy tűz-and-forget üzenet),
 *   a GET /api/strategies / GET /api/ohlc a SNAPSHOT-ból olvas, amit
 *   a kliens azonnal megkap connect után. A `pendingRequests` map
 *   csak a POST /api/control-hoz kell (ahol a state-feed a jövőbeli
 *   Phase 49+-ben fog response-ot küldeni).
 *
 *   A Phase 46 egyszerűsített modellje:
 *     - A GET /api/strategies a SNAPSHOT-ot cache-eli, és a cache-ből
 *       olvassa. Ha nincs cache (a state-feed még nem küldött SNAPSHOT-ot),
 *       503-at ad vissza.
 *     - A GET /api/ohlc a SNAPSHOT `ohlcBootstrap`-jából olvassa ki a
 *       kért (symbol, tf) párost, és a `count` paraméter alapján az
 *       utolsó N bar-t adja vissza.
 *     - A POST /api/control a CONTROL üzenetet a state-feed felé küldi,
 *       és 202 Accepted-tel válaszol (a state-fire nem küld response-ot).
 *
 * ============================================================================
 * TESZTELHETŐSÉG
 * ============================================================================
 *
 *   A `createHttpHandler` factory a HTTP handler-eket a `Bun.serve`
 *   `fetch` callback-jéhez készíti elő. A tesztek közvetlenül hívják
 *   a factory-t, és a `Bun.serve`-t is használhatják (a Phase 45
 *   tesztjeihez hasonlóan).
 */

import type {
  StateFeedPosition,
  StateFeedSnapshot,
  StateFeedTrade,
} from "../state-feed/publisher.js";
import { type StateFeedClientMessage, type StateFeedOHLC } from "../state-feed/protocol.js";
import type { StateFeedClientHandle } from "./state-feed-client.js";
import { createStaticHandler } from "./static-server.js";

// ============================================================================
// Types
// ============================================================================

/** A HTTP request kezelő kontextusa. */
export interface HttpHandlerContext {
  /** A state-feed kliens (a send / isConnected API). */
  readonly stateFeed: StateFeedClientHandle;
  /** A cache-elt SNAPSHOT a state-feed-ről (a GET /api/strategies,
   *  GET /api/ohlc ezt olvassa). Null, ha még nincs SNAPSHOT. */
  readonly snapshot: StateFeedSnapshot | null;
  /** Az OHLC bootstrap adatok (a SNAPSHOT része). A state-feed
   *  `ohlcBootstrap` mezőjéből jön. */
  readonly ohlcBootstrap: Readonly<Record<string, Readonly<Record<string, readonly StateFeedOHLC[]>>>>;
  /** A static handler — a GET / és a GET /static/* útvonalakhoz. */
  readonly staticHandler: (req: Request) => Response | Promise<Response>;
}

/** A HTTP request kezelő típusa. */
export type HttpRequestHandler = (req: Request, ctx: HttpHandlerContext) => Response | Promise<Response>;

/** A factory visszatérési típusa. */
export interface HttpHandlerFactory {
  /** A factory által generált fetch handler. */
  readonly fetch: (req: Request) => Response | Promise<Response>;
  /** Az aktuális SNAPSHOT-ot frissítő metódus (a state-feed client
   *  hívja, amikor SNAPSHOT-ot kap). */
  setSnapshot(snapshot: StateFeedSnapshot, ohlcBootstrap: HttpHandlerContext["ohlcBootstrap"]): void;
  /** A snapshot cache törlése (close / reconnect esetén). */
  clearSnapshot(): void;
  /** A `stateFeed` referencia cseréje (a tesztek használják). */
  setStateFeed(stateFeed: StateFeedClientHandle): void;
  /** Az aktuális kontextus olvasása (a tesztek használják). */
  readonly context: HttpHandlerContext;
}

// ============================================================================
// Factory
// ============================================================================

/**
 * `createHttpHandler` — a HTTP handler factory. A factory visszaadja
 * a `Bun.serve` `fetch` callback-jéhez illeszkedő handlert, és a
 * `setSnapshot` / `clearSnapshot` API-t a state-feed client
 * callback-jeihez.
 *
 * A factory-t a `startWebClient` composer használja (lásd
 * `apps/bot/src/web-client/index.ts`).
 */
export function createHttpHandler(
  initialStateFeed: StateFeedClientHandle,
  options: { readonly webDistDir: string },
): HttpHandlerFactory {
  let snapshot: StateFeedSnapshot | null = null;
  let ohlcBootstrap: HttpHandlerContext["ohlcBootstrap"] = {};
  let stateFeed: StateFeedClientHandle = initialStateFeed;

  const staticHandler = createStaticHandler({ webDistDir: options.webDistDir });

  const context: HttpHandlerContext = {
    get stateFeed(): StateFeedClientHandle {
      return stateFeed;
    },
    get snapshot(): StateFeedSnapshot | null {
      return snapshot;
    },
    get ohlcBootstrap(): HttpHandlerContext["ohlcBootstrap"] {
      return ohlcBootstrap;
    },
    staticHandler,
  };

  const factory: HttpHandlerFactory = {
    fetch: (req: Request) => handleHttpRequest(req, context),
    setSnapshot(newSnapshot, newOhlc) {
      snapshot = newSnapshot;
      ohlcBootstrap = newOhlc;
    },
    clearSnapshot() {
      snapshot = null;
      ohlcBootstrap = {};
    },
    setStateFeed: (newStateFeed) => {
      stateFeed = newStateFeed;
    },
    get context(): HttpHandlerContext {
      return context;
    },
  };

  return factory;
}

// ============================================================================
// Request router
// ============================================================================

/**
 * `handleHttpRequest` — a fő request handler. A path alapján elágazik
 * a megfelelő al-handler-re.
 */
async function handleHttpRequest(req: Request, ctx: HttpHandlerContext): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;
  const method = req.method.toUpperCase();

  // A GET / és a GET /static/* + GET /assets/* a static handler-re megy.
  // Phase 52E (REVISED 2026-07-18 00:25 Budapest): a Vite build az
  // asset-eket az `assets/` mappába rakja, és az index.html
  // `<script src="/assets/...">`-re hivatkozik. A router szintjén is
  // hozzá kell adni a `/assets/*` útvonalat a static handlerhez —
  // különben a `/assets/*` kérések a 404-es fallback ágba esnek.
  if (
    method === "GET" &&
    (path === "/" || path.startsWith("/static/") || path.startsWith("/assets/"))
  ) {
    return await ctx.staticHandler(req);
  }

  // A GET /api/health mindig 200, függetlenül a state-feed állapotától.
  if (method === "GET" && path === "/api/health") {
    return jsonResponse({
      ok: true,
      stateFeedConnected: ctx.stateFeed.isConnected(),
      hasSnapshot: ctx.snapshot !== null,
    });
  }

  // A state-feed-függő végpontok: ha nincs kapcsolat, 503.
  if (!ctx.stateFeed.isConnected()) {
    return jsonResponse(
      { error: "state-feed disconnected", reconnectAttempt: ctx.stateFeed.reconnectAttempt() },
      503,
    );
  }

  // GET /api/strategies — a cache-elt SNAPSHOT-ból.
  if (method === "GET" && path === "/api/strategies") {
    return handleGetStrategies(ctx);
  }

  // GET /api/ohlc?symbol=&tf=&count=
  if (method === "GET" && path === "/api/ohlc") {
    return handleGetOhlc(url, ctx);
  }

  // Phase 69: GET /api/status — a dashboard status banner forrása.
  // A cache-elt SNAPSHOT `botStatus` mezőjét adja vissza; a UI poll-ozza
  // ezt az endpoint-ot a real-time WS frissítések mellett (a WS a
  // SNAPSHOT message-ben szállítja a `botStatus`-t, de a poll biztosítja,
  // hogy reconnect után is frissüljön a status).
  if (method === "GET" && path === "/api/status") {
    return handleGetStatus(ctx);
  }

  // Phase 82 (item 4 — user mandate 2026-07-27 12:17): GET /api/trades —
  // a dashboard trade history táblájának forrása. A cache-elt SNAPSHOT
  // `history[]` (lezárt trade-ek) + `positions[]` (nyitott pozíciók)
  // mezőit adja vissza egységes TradeHistoryItem formátumban. A UI
  // poll-ozza ezt az endpoint-ot (5s) — a forrás a cache-elt SNAPSHOT,
  // tehát a válasz azonnali (nincs state-feed round-trip).
  if (method === "GET" && path === "/api/trades") {
    return handleGetTrades(url, ctx);
  }

  // POST /api/control — a body { command, ...args } → state-feed CONTROL.
  if (method === "POST" && path === "/api/control") {
    return await handlePostControl(req, ctx);
  }

  return jsonResponse({ error: "not found", path }, 404);
}

// ============================================================================
// Endpoint handlers
// ============================================================================

/**
 * `handleGetStrategies` — a state-feed SNAPSHOT `strategies` mezőjét
 * adja vissza. Ha nincs SNAPSHOT cache, 503-at ad.
 */
function handleGetStrategies(ctx: HttpHandlerContext): Response {
  if (ctx.snapshot === null) {
    return jsonResponse({ error: "snapshot not yet received from state-feed" }, 503);
  }
  return jsonResponse({
    strategies: buildStrategiesList(ctx.snapshot),
  });
}

/**
 * `handleGetStatus` — Phase 69: a dashboard status banner forrása.
 *
 * A cache-elt SNAPSHOT `botStatus` mezőjét adja vissza:
 *   - `state` — a bot magas-szintű állapota ("running" / "paused" / "stopped")
 *   - `startedAt` — a `markBotStarted()` utolsó hívásának timestamp-je
 *                    (0 ha még soha nem futott)
 *   - `lastUpdate` — a state-frissítés timestamp-je
 *   - `activeStrategyCount` — a `strategies` listából az `enabled === true` elemek száma
 *
 * A `state-feed disconnected` 503-as branch-et a router elején kezeljük;
 * ez a handler CSAK akkor fut le, ha a state-feed connected.
 *
 * Ha még nincs SNAPSHOT cache (a state-feed frissen csatlakozott, de
 * a HELLO + SNAPSHOT még nem jött meg), a 503-as branch ad vissza
 * `snapshot not yet received from state-feed` üzenetet — a UI ezt a
 * `state === "stopped"` fallback-ként kezeli.
 */
function handleGetStatus(ctx: HttpHandlerContext): Response {
  if (ctx.snapshot === null) {
    // Phase 71: a fallback response is kibővítve a `positions: []`
    // mezővel, hogy a UI parser a friss snapshot-ból és a fallback-ből
    // is ugyanazt a shape-et kapja. A `positions: []` a default "no
    // engine state yet" állapotot tükrözi.
    return jsonResponse(
      {
        botStatus: {
          state: "stopped",
          startedAt: 0,
          lastUpdate: 0,
          activeStrategyCount: 0,
          positions: [],
        },
      },
      503,
    );
  }
  return jsonResponse({ botStatus: ctx.snapshot.botStatus });
}

/**
 * `TradeHistoryItem` — a trade history tábla egységes sora. A Phase 82
 * (item 4 — user mandate 2026-07-27 12:17) dashboard feature a zárt
 * trade-eket ÉS a nyitott pozíciókat egyetlen táblában mutatja, így
 * a `status` mező (`"open"` / `"closed"`) szétválogatja őket.
 *
 * - `id`           — a pozíció / trade egyedi azonosítója.
 * - `strategy`     — a `StateFeedTrade.reason` mezőből jön (a bot
 *                    a `closedTrade.strategy`-t írja oda); nyitott
 *                    pozícióknál a `position.id` eleje (strategy prefix).
 * - `symbol`       — pl. `"BTC/USDC"`.
 * - `side`         — `"buy"` / `"sell"` (a state-feed / WS terminológia).
 * - `entryPrice`   — az entry-ár.
 * - `entryTime`    — az entry timestamp-je.
 * - `exitPrice`    — a zárási ár (null nyitott pozíciónál).
 * - `exitTime`     — a zárás timestamp-je (null nyitott pozíciónál).
 * - `quantity`     — a méret (instrument unit).
 * - `leverage`     — a pozíció leverage-e.
 * - `pnl`          — realizált P&L (zárt) VAGY unrealized P&L (nyitott), USD.
 * - `pnlPct`       — ugyanaz, százalékban.
 * - `duration`     — `exitTime - entryTime` (zárt) VAGY `now - entryTime`
 *                    (nyitott), ms-ben.
 * - `status`       — `"open"` VAGY `"closed"`.
 */
export interface TradeHistoryItem {
  readonly id: string;
  readonly strategy: string;
  readonly symbol: string;
  readonly side: "buy" | "sell";
  readonly entryPrice: number;
  readonly entryTime: number;
  readonly exitPrice: number | null;
  readonly exitTime: number | null;
  readonly quantity: number;
  readonly leverage: number;
  readonly pnl: number;
  readonly pnlPct: number;
  readonly duration: number;
  readonly status: "open" | "closed";
}

/**
 * `handleGetTrades` — Phase 82 (item 4 — user mandate 2026-07-27 12:17):
 * a dashboard trade history táblájának forrása. A cache-elt SNAPSHOT
 * `history[]` (lezárt trade-ek, `StateFeedTrade[]`) és `positions[]`
 * (nyitott pozíciók, `StateFeedPosition[]`) mezőit egyesíti
 * `TradeHistoryItem[]` formátumban.
 *
 * Query paramok (mind opcionális):
 *   - `?limit=N`          — max N elemet ad vissza (default: 200).
 *   - `?symbol=BTC/USDC`  — csak a megadott symbol-t.
 *   - `?strategy=NAME`    — csak a megadott stratégiát.
 *   - `?status=open|closed|all` — default: "all".
 *
 * Ha nincs SNAPSHOT cache (a state-feed frissen csatlakozott, de a
 * HELLO + SNAPSHOT még nem jött meg), a `state-feed disconnected`
 * ág nem fut le — ez a handler a `snapshot` meglétére is ellenőriz.
 * A `state-feed disconnected` 503-at a router elején kezeljük.
 */
function handleGetTrades(url: URL, ctx: HttpHandlerContext): Response {
  if (ctx.snapshot === null) {
    return jsonResponse({ error: "snapshot not yet received from state-feed" }, 503);
  }
  const limit = parseLimitParam(url.searchParams.get("limit"));
  const symbolFilter = url.searchParams.get("symbol");
  const strategyFilter = url.searchParams.get("strategy");
  const statusFilter = parseStatusParam(url.searchParams.get("status"));

  const trades: TradeHistoryItem[] = [];
  if (statusFilter === "all" || statusFilter === "open") {
    for (const p of ctx.snapshot.positions) {
      const item = openPositionToTradeItem(p);
      if (item !== null && matchesFilters(item, symbolFilter, strategyFilter)) {
        trades.push(item);
      }
    }
  }
  if (statusFilter === "all" || statusFilter === "closed") {
    for (const t of ctx.snapshot.history) {
      const item = closedTradeToTradeItem(t);
      if (item !== null && matchesFilters(item, symbolFilter, strategyFilter)) {
        trades.push(item);
      }
    }
  }
  // Legfrissebb elöl (exitTime desc, nyitottaknál entryTime desc fallback).
  trades.sort((a, b) => {
    const aTs = a.exitTime ?? a.entryTime;
    const bTs = b.exitTime ?? b.entryTime;
    return bTs - aTs;
  });
  const sliced = trades.length > limit ? trades.slice(0, limit) : trades;
  return jsonResponse({ trades: sliced, count: sliced.length });
}

/**
 * `parseLimitParam` — a `?limit=N` query param feldolgozása. Érvénytelen
 * vagy hiányzó érték esetén 200 (a default cap).
 */
function parseLimitParam(raw: string | null): number {
  if (raw === null) return 200;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 200;
  return Math.min(Math.floor(n), 1000);
}

/**
 * `parseStatusParam` — a `?status=...` query param feldolgozása. Csak
 * a három megengedett értéket fogadja el; minden más esetben "all".
 */
function parseStatusParam(raw: string | null): "all" | "open" | "closed" {
  if (raw === "open" || raw === "closed" || raw === "all") return raw;
  return "all";
}

/**
 * `matchesFilters` — a trade history item symbol + strategy szűrőkre
 * való illeszkedésének ellenőrzése. A `null` filter = "nincs szűrő".
 */
function matchesFilters(
  item: TradeHistoryItem,
  symbolFilter: string | null,
  strategyFilter: string | null,
): boolean {
  if (symbolFilter !== null && item.symbol !== symbolFilter) return false;
  if (strategyFilter !== null && item.strategy !== strategyFilter) return false;
  return true;
}

/**
 * `openPositionToTradeItem` — a `StateFeedPosition` → `TradeHistoryItem`
 * konverzió. A nyitott pozíció `exitPrice` / `exitTime` mezői `null`
 * (még nincs zárás); a `pnl` az unrealized P&L; a `duration` a
 * `now - openedAt`.
 *
 * A `strategy` mezőt a `position.id` elejéről nyerjük ki (a Phase 68
 * `restorePosition` óta a formátum `<strategy>:<symbol>:<side>`); ha
 * a feloldás nem sikerül (legacy / mock adat), a fallback `"unknown"`.
 */
function openPositionToTradeItem(p: StateFeedPosition): TradeHistoryItem | null {
  if (typeof p.symbol !== "string" || p.symbol.length === 0) return null;
  if (typeof p.id !== "string" || p.id.length === 0) return null;
  // Az ESLint `@typescript-eslint/no-unnecessary-condition` miatt kell
  // a disable: a `p.side` típusa `"buy" | "sell"` (mindig truthy a check),
  // DE a legacy / mock adatokkal meghívott `setSnapshot` átadhat
  // érvénytelen side-ot is — a futásidőben védünk, hogy ne dőljön el
  // a többi mező mappingja egy falsy side-dal.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (p.side !== "buy" && p.side !== "sell") return null;
  if (typeof p.entryPrice !== "number" || !Number.isFinite(p.entryPrice)) return null;
  if (typeof p.openedAt !== "number" || !Number.isFinite(p.openedAt)) return null;
  if (typeof p.quantity !== "number" || !Number.isFinite(p.quantity)) return null;
  const strategy = p.id.includes(":") ? (p.id.split(":")[0] ?? "unknown") : "unknown";
  return {
    id: p.id,
    strategy,
    symbol: p.symbol,
    side: p.side,
    entryPrice: p.entryPrice,
    entryTime: p.openedAt,
    exitPrice: null,
    exitTime: null,
    quantity: p.quantity,
    leverage: typeof p.leverage === "number" && Number.isFinite(p.leverage) ? p.leverage : 1,
    pnl: typeof p.unrealizedPnl === "number" && Number.isFinite(p.unrealizedPnl) ? p.unrealizedPnl : 0,
    pnlPct:
      typeof p.unrealizedPnlPct === "number" && Number.isFinite(p.unrealizedPnlPct)
        ? p.unrealizedPnlPct
        : 0,
    duration: Date.now() - p.openedAt,
    status: "open",
  };
}

/**
 * `closedTradeToTradeItem` — a `StateFeedTrade` → `TradeHistoryItem`
 * konverzió. A zárt trade minden mezője kitöltött; a `strategy` a
 * `trade.reason` mezőből jön (a `mapClosedTrade` oda írja a bot
 * `closedTrade.strategy`-jét).
 *
 * Defensive shape check: ha bármely mező hiányzik / érvénytelen,
 * `null`-t adunk vissza (a handler kiszűri). A bot helyes publikálása
 * mellett ez a védelem csak a legacy / mock adatok ellen kell.
 */
function closedTradeToTradeItem(t: StateFeedTrade): TradeHistoryItem | null {
  if (typeof t.symbol !== "string" || t.symbol.length === 0) return null;
  // Az ESLint `@typescript-eslint/no-unnecessary-condition` miatt kell
  // a disable: a `t.side` típusa `"buy" | "sell"` (mindig truthy a check),
  // DE a legacy / mock adatokkal meghívott `setSnapshot` átadhat
  // érvénytelen side-ot is — a futásidőben védünk, hogy ne dőljön el
  // a többi mező mappingja egy falsy side-dal.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (t.side !== "buy" && t.side !== "sell") return null;
  if (typeof t.entryPrice !== "number" || !Number.isFinite(t.entryPrice)) return null;
  if (typeof t.exitPrice !== "number" || !Number.isFinite(t.exitPrice)) return null;
  if (typeof t.closedAt !== "number" || !Number.isFinite(t.closedAt)) return null;
  if (typeof t.openedAt !== "number" || !Number.isFinite(t.openedAt)) return null;
  if (typeof t.quantity !== "number" || !Number.isFinite(t.quantity)) return null;
  if (typeof t.id !== "string" || t.id.length === 0) return null;
  return {
    id: t.id,
    strategy: typeof t.reason === "string" && t.reason.length > 0 ? t.reason : "unknown",
    symbol: t.symbol,
    side: t.side,
    entryPrice: t.entryPrice,
    entryTime: t.openedAt,
    exitPrice: t.exitPrice,
    exitTime: t.closedAt,
    quantity: t.quantity,
    leverage: typeof t.leverage === "number" && Number.isFinite(t.leverage) ? t.leverage : 1,
    pnl: typeof t.pnlUsdt === "number" && Number.isFinite(t.pnlUsdt) ? t.pnlUsdt : 0,
    pnlPct: typeof t.pnlPct === "number" && Number.isFinite(t.pnlPct) ? t.pnlPct : 0,
    duration: Math.max(0, t.closedAt - t.openedAt),
    status: "closed",
  };
}

/**
 * `buildStrategiesList` — a state-feed SNAPSHOT `strategies` mezőjéből
 * nyeri ki a stratégiák listáját. Phase 52E bugfix: korábban ez a
 * függvény HARDCODED 1 stratégiát adott vissza a `snapshot.tickers`
 * alapján (`donchian_pivot_composition` néven), a `dydx_cex_carry` és
 * `cascade_fade` stratégiák nem jelentek meg a dashboardon. A fix: a
 * `LiveStatePublisher` a `LiveStatePublisherOptions.strategies` opcióból
 * (vagy best-effort a `bot.config.strategies`-ből) építi a listát, és
 * a SNAPSHOT `strategies` mezőjében tárolja. A `buildStrategiesList`
 * mostantól a `snapshot.strategies`-ből olvas.
 */
function buildStrategiesList(
  snapshot: StateFeedSnapshot,
): readonly {
  readonly name: string;
  readonly enabled: boolean;
  readonly symbols: readonly string[];
  readonly timeframes: readonly string[];
}[] {
  // Ha a SNAPSHOT `strategies` mezője NEM üres (Phase 52E óta a
  // publisher a `LiveStatePublisherOptions.strategies`-ből építi),
  // használjuk. Ha üres (legacy / fallback), a régi viselkedés:
  // donchian_pivot_composition a `tickers` alapján.
  // A `&&` feltétel az ESLint `@typescript-eslint/no-unnecessary-condition`
  // miatt kell: a `StateFeedSnapshot.strategies` típusa `readonly
  // StateFeedStrategyDescriptor[]` (mindig truthy), DE a legacy
  // teszt fixture-ök (amik megkerülik a TypeScript típusellenőrzést)
  // `undefined` értéket adhatnak át — ezt a futásidőben is kezelni
  // kell, hogy ne dobjunk TypeError-t.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (snapshot.strategies && snapshot.strategies.length > 0) {
    return snapshot.strategies.map((s) => ({
      name: s.name,
      enabled: s.enabled,
      symbols: [...s.symbols],
      timeframes: [...s.timeframes],
    }));
  }
  // Fallback (régi kliens kompatibilitás): donchian_pivot_composition a tickers-ből.
  const timeframes = ["1h", "4h", "1d"] as const;
  const symbols = snapshot.tickers.map((t) => t.symbol);
  return [
    {
      name: "donchian_pivot_composition",
      enabled: true,
      symbols,
      timeframes,
    },
  ];
}

/**
 * `handleGetOhlc` — a state-feed `ohlcBootstrap`-jából adja vissza
 * a kért (symbol, tf) OHLC bar-okat, a `count` paraméter által
 * korlátozva.
 */
function handleGetOhlc(url: URL, ctx: HttpHandlerContext): Response {
  const symbol = url.searchParams.get("symbol");
  const tf = url.searchParams.get("tf");
  const countRaw = url.searchParams.get("count");
  if (symbol === null || tf === null) {
    return jsonResponse({ error: "missing required query params: symbol, tf" }, 400);
  }
  const perSymbol = ctx.ohlcBootstrap[symbol];
  if (perSymbol === undefined) {
    return jsonResponse({ error: "unknown symbol", symbol }, 404);
  }
  const bars = perSymbol[tf];
  if (bars === undefined) {
    return jsonResponse({ error: "unknown timeframe", symbol, tf }, 404);
  }
  const count = countRaw === null ? bars.length : Math.max(0, Math.min(Number(countRaw) || bars.length, bars.length));
  const tail = count === bars.length ? bars : bars.slice(bars.length - count);
  return jsonResponse({ symbol, tf, bars: tail });
}

/**
 * `handlePostControl` — a body { command, ...args } → state-feed CONTROL.
 * A 202 Accepted a tűz-and-forget természetet tükrözi (a state-feed
 * nem küld explicit response-ot a CONTROL-ra).
 */
async function handlePostControl(req: Request, ctx: HttpHandlerContext): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "invalid JSON body" }, 400);
  }
  if (typeof body !== "object" || body === null) {
    return jsonResponse({ error: "body must be a JSON object" }, 400);
  }
  const obj = body as Record<string, unknown>;
  const command = obj["command"];
  if (typeof command !== "string") {
    return jsonResponse({ error: "missing or invalid 'command' field" }, 400);
  }
  // A state-feed ControlMessage csak a megengedett command-okat fogadja.
  const allowed = ["start", "stop", "pause", "resume", "kill_switch"] as const;
  if (!allowed.includes(command as (typeof allowed)[number])) {
    return jsonResponse({ error: "invalid command", allowed }, 400);
  }
  const message: StateFeedClientMessage = {
    type: "control",
    command: command as (typeof allowed)[number],
    ...(typeof obj["confirm"] === "boolean" ? { confirm: obj["confirm"] } : {}),
    ...(typeof obj["paused"] === "boolean" ? { paused: obj["paused"] } : {}),
  };
  const sent = ctx.stateFeed.send(message);
  if (!sent) {
    return jsonResponse({ error: "state-feed send failed" }, 503);
  }
  return jsonResponse({ accepted: true, command: message.command }, 202);
}

// ============================================================================
// Helper
// ============================================================================

/**
 * `jsonResponse` — egy JSON Response builder.
 */
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}
