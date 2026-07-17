/**
 * apps/bot/src/state-feed/publisher.ts
 *
 * ===========================================================================
 * PHASE 44 — TUI REMOVAL + STATE-FEED PUBLISHER (RENAMED)
 * ===========================================================================
 *
 * A `LiveStatePublisher` (volt `LiveBotStateProvider`) híd a futó `Bot`
 * és a jövőbeli state-feed szerver között. A `Bot.subscribe(listener)`
 * segítségével feliratkozik a bot állapotváltozásaira, és a bot
 * `BotState`-ját a state-feed számára érthető formátumra
 * (`StateFeedSnapshot`, `StateFeedPosition`, `StateFeedTrade`,
 * `StateFeedStatistics`, `StateFeedTickerEvent`) leképezve adja vissza.
 *
 * ===========================================================================
 * MIÉRT KÜLÖN PUBLISHER?
 * ===========================================================================
 * A state-feed protokoll (Phase 45) a `LiveStatePublisher.subscribe(fn)`
 * metódusán keresztül fogadja a bot state-változásait. A publisher
 * a `Bot` nyers `BotState`-jét egy normalizált, szerializálható
 * formátumba (`StateFeedSnapshot`) konvertálja, hogy a state-feed
 * szerver a JSON-over-TCP vonalon továbbíthassa a web client felé.
 *
 * Az előző fájl (`apps/bot/src/tui/live-bot-state-provider.ts`) a
 * TUI-t szolgálta ki (Ink 7 + React 19). A Phase 44 törölte a TUI-t,
 * a publisher fájl új helyre költözött, az osztály átnevezésre került,
 * és az Ink-specifikus típusok lokális típusokká alakultak. A Phase 45
 * a state-feed szervert (TCP `127.0.0.1:7914`, newline-delimited JSON)
 * építi majd erre a publisher-re.
 *
 * ===========================================================================
 * MAPPING — Bot.BotState → StateFeedSnapshot
 * ===========================================================================
 *   Snapshot mező             │ Forrás (Bot oldaláról)
 *   ──────────────────────────┼────────────────────────────────────
 *   status.mode               │ "with-bot" (fix — a state-feed a futó
 *                              │  bot-ot képviseli)
 *   status.engineAvailable    │ `active` flag (publisher figyel-e a botra)
 *   status.engineError        │ `setEngineError()` által beállított üzenet
 *   status.connected          │ `active` flag (publisher csatlakoztatva van)
 *   status.lastUpdate         │ Date.now() a notify időpontjában
 *   running                   │ `botRunning` flag (a bot TÉNYLEGESEN fut-e)
 *   killSwitch                │ saját killSwitchState (UI állapot)
 *   positions[]               │ bot.positions[] (mapping: side, %, stop, TP)
 *   statistics                │ aggregálás bot.closedTrades + counters
 *   history[]                 │ bot.closedTrades[] (mapping → StateFeedTrade)
 *   tickers[]                 │ enabled symbols + bot.positions[].currentPrice
 *   tickerEvents[]            │ synthetic event-buffer (max 32 elem)
 *   paused                    │ `setPaused()` által beállított UI-flag
 *   killSwitchThresholdPct    │ statikus, default -10%
 *
 * A `stopLoss` / `takeProfit` mezők egyelőre `null` — a bot jelenleg
 * nem tárolja ezeket a perzisztens state-ben (Phase 49+ feature).
 *
 * ===========================================================================
 * PHASE 38 FIX #38 — RUNNING FLAG DECOUPLING (preserved)
 * ===========================================================================
 * A `running` mező a state-feed / jövőbeli kliens számára a
 * "bot TÉNYLEGESEN fut-e" szemantikát jelenti, NEM a "publisher figyel"
 * állapotot. A Phase 36 Track A1 user mandate (`mm-bot start` ne
 * induljon automatikusan) óta a `mm-bot start` alapértelmezetten a
 * bot-ot `stopped` állapotban hagyja, és a `markBotStarted()` /
 * `markBotStopped()` API explicit módon jelzi, hogy a bot valóban
 * elindult / leállt — ezt a `start.ts` hívja a `bot.start()` /
 * `bot.stop()` mellé.
 *
 * ===========================================================================
 * ÉLETCIKLUS INTEGRÁCIÓ
 * ===========================================================================
 * A `LiveStatePublisher` a `mm-bot start` parancs által indított
 * futó `Bot`-hoz csatlakozik:
 *
 *   1) `start()` — feliratkozik a bot state-változásaira (`bot.subscribe`).
 *      A `botRunning` flag `false` marad (a bot még nem indult el).
 *   2) `markBotStarted()` — a `start.ts` hívja a `bot.start()` sikeres
 *      resolve-ja után; a `running` flag `true`-ra vált.
 *   3) `markBotStopped()` — a `start.ts` hívja a `bot.stop()` sikeres
 *      resolve-ja után; a `running` flag `false`-ra vált.
 *   4) `killSwitch()` — vészleállító: `bot.stop()` + a kill-switch
 *      state átállítása `triggered`-re.
 *   5) `dispose()` — leiratkozás + takarítás.
 *
 * A publisher a bot életciklusát NEM veszi át — a start parancs
 * felelős a `bot.start()` hívásért. A publisher csak a state-feed
 * kliensek felé történő közzétételért felel.
 *
 * ===========================================================================
 * PHASE 45 PREVIEW — EVENTEMITER-LIKE API
 * ===========================================================================
 * A Phase 45 state-feed szerver a `addEventListener(fn)` és `emit(event)`
 * metódusokon keresztül fog feliratkozni. A Phase 44-ben a
 * `subscribe(listener)` metódus (az Ink `useSyncExternalStore` által
 * inspirált API) még elérhető a backward compatibility kedvéért — a
 * Phase 45 a `subscribe`-t `addEventListener`-re cseréli.
 */

import type { Bot } from "../bot/bot.js";
import type {
  BotState as EngineBotState,
  ClosedTradeSnapshot,
} from "../bot/state-store.js";

// ============================================================================
// State-feed types (the snapshot shape, formerly the TUI's BotState shape)
// ============================================================================

/** A state-feed `Position` — long/short oldal buy/sell formában. */
export type StateFeedSide = "buy" | "sell";

/** A state-feed `Position` shape (a volt TUI `Position`). */
export interface StateFeedPosition {
  readonly id: string;
  readonly symbol: string;
  readonly side: StateFeedSide;
  readonly entryPrice: number;
  readonly currentPrice: number;
  readonly quantity: number;
  readonly leverage: number;
  readonly unrealizedPnl: number;
  readonly unrealizedPnlPct: number;
  readonly openedAt: number;
  readonly stopLoss: number | null;
  readonly takeProfit: number | null;
}

/** A state-feed `Trade` shape (a volt TUI `Trade`). */
export interface StateFeedTrade {
  readonly id: string;
  readonly symbol: string;
  readonly side: StateFeedSide;
  readonly entryPrice: number;
  readonly exitPrice: number;
  readonly quantity: number;
  readonly leverage: number;
  readonly pnlUsdt: number;
  readonly pnlPct: number;
  readonly openedAt: number;
  readonly closedAt: number;
  readonly reason: string;
}

/** A state-feed `Statistics` shape. */
export interface StateFeedStatistics {
  readonly totalPnlUsdt: number;
  readonly totalPnlPct: number;
  readonly winRate: number;
  readonly totalTrades: number;
  readonly winningTrades: number;
  readonly losingTrades: number;
  readonly maxDrawdownPct: number;
  readonly currentDrawdownPct: number;
  readonly avgWinPnl: number;
  readonly avgLossPnl: number;
  readonly bestTradePnl: number;
  readonly worstTradePnl: number;
  readonly profitFactor: number;
  readonly sharpeRatio: number;
  readonly equityUsdt: number;
  readonly initialEquityUsdt: number;
}

/** A state-feed `TickerPrice` shape. */
export interface StateFeedTickerPrice {
  readonly symbol: string;
  readonly price: number;
  readonly change24hPct: number;
  readonly volume24hUsdt: number;
}

/** A state-feed `TickerEvent` shape. */
export interface StateFeedTickerEvent {
  readonly seq: number;
  readonly symbol: string;
  readonly price: number;
  readonly volume: number;
  readonly timestamp: number;
}

/** A kill-switch UI-állapot. */
export type StateFeedKillSwitchState = "armed" | "confirm" | "triggered";

/** A state-feed `Status` shape. */
export interface StateFeedStatus {
  readonly mode: "with-bot";
  readonly engineAvailable: boolean;
  readonly engineError: string | null;
  readonly connected: boolean;
  readonly lastUpdate: number;
}

/**
 * `StateFeedStrategyDescriptor` — a state-feed-en publish-elt
 * stratégia descriptor (a `web-client/http-server.ts`
 * `buildStrategiesList` ebből építi a `/api/strategies` választ).
 *
 * Phase 52E bugfix: korábban a `buildStrategiesList` a
 * `snapshot.tickers` / `snapshot.positions` alapján származtatott
 * egy HARDCODED 1-stratégiás listát (a Phase 49+ commentje ígérte
 * a külön `strategies` mezőt, de soha nem készült el). A fix:
 * a `LiveStatePublisher` a bot engine `BotState.strategies`
 * listájából építi a `strategies` tömböt, ÉS a `buildStrategiesList`
 * a `snapshot.strategies`-ből olvas.
 */
export interface StateFeedStrategyDescriptor {
  readonly name: string;
  readonly enabled: boolean;
  readonly symbols: readonly string[];
  readonly timeframes: readonly string[];
  readonly cap?: number;
}

/** A state-feed `Snapshot` — a publisher által publikált teljes state. */
export interface StateFeedSnapshot {
  readonly status: StateFeedStatus;
  readonly running: boolean;
  readonly killSwitch: StateFeedKillSwitchState;
  readonly positions: readonly StateFeedPosition[];
  readonly statistics: StateFeedStatistics;
  readonly history: readonly StateFeedTrade[];
  readonly tickers: readonly StateFeedTickerPrice[];
  readonly tickerEvents: readonly StateFeedTickerEvent[];
  readonly strategies: readonly StateFeedStrategyDescriptor[];
  readonly paused: boolean;
  readonly killSwitchThresholdPct: number;
}

// ============================================================================
// Helpers — bot state → state-feed state mapping
// ============================================================================

/** A `Bot` long/short oldalát a state-feed buy/sell formájára konvertálja. */
export function mapSide(side: "long" | "short"): StateFeedSide {
  return side === "long" ? "buy" : "sell";
}

/** A bot engine pozíció típusa — a `EngineBotState.positions` eleme. */
type EnginePosition = EngineBotState["positions"][number];

/** Egy bot pozíció → state-feed pozíció. */
export function mapPosition(p: EnginePosition): StateFeedPosition {
  const notional = p.notionalUsd > 0 ? p.notionalUsd : p.entryPrice * p.quantity;
  const unrealizedPnlPct = notional > 0 ? (p.unrealizedPnl / notional) * 100 : 0;
  return {
    id: p.id,
    symbol: p.symbol,
    side: mapSide(p.side),
    entryPrice: p.entryPrice,
    currentPrice: p.currentPrice,
    quantity: p.quantity,
    leverage: p.leverage,
    unrealizedPnl: p.unrealizedPnl,
    unrealizedPnlPct,
    openedAt: p.openedAt,
    stopLoss: null, // A bot jelenleg nem tárolja perzisztensen (Phase 49+ feature)
    takeProfit: null,
  };
}

/** Egy bot `ClosedTradeSnapshot` → state-feed `Trade`. */
export function mapClosedTrade(t: ClosedTradeSnapshot, index: number): StateFeedTrade {
  return {
    id: `${t.strategy}-${t.symbol}-${t.side}-${t.closedAt}-${String(index)}`,
    symbol: t.symbol,
    side: mapSide(t.side),
    entryPrice: t.entryPrice,
    exitPrice: t.exitPrice,
    quantity: t.quantity,
    leverage: 1, // A bot nem tárolja perzisztensen
    pnlUsdt: t.pnl,
    pnlPct: t.pnlPct,
    openedAt: t.closedAt - 60 * 60 * 1000, // Heurisztika
    closedAt: t.closedAt,
    reason: t.strategy,
  };
}

// ============================================================================
// Phase 39 — Snapshot equality helper (Fix #39: TUI responsiveness, preserved)
// ============================================================================

/**
 * `stateEqualsIgnoringTimestamp` — két `StateFeedSnapshot` mély összehasonlítása,
 * a `status.lastUpdate` mező kihagyásával.
 *
 * A `lastUpdate` ms-pontosságú timestamp, és minden `refreshFromBot()`
 * híváskor változna — de a klienst nem érdekli a ms-pontosság (a Header
 * `Frissítve: HH:MM:SS` formátumban mutatja, ahol a másodperc a lényeges).
 * Ha csak a `lastUpdate` változna, a függvény `true`-t ad vissza, és a
 * snapshot referenciája megmarad → nincs felesleges re-render.
 *
 * A függvény rekurzívan hasonlítja a `StateFeedSnapshot` shape minden mezőjét.
 */
export function stateEqualsIgnoringTimestamp(
  a: StateFeedSnapshot,
  b: StateFeedSnapshot,
): boolean {
  // status.lastUpdate kihagyása — a többi status-mezőt rekurzívan hasonlítjuk.
  // A `status.mode` mező mindig `"with-bot"` (literál típus a `StateFeedStatus`
  // -ban), így a mode-egyenlőség ellenőrzése felesleges — a TypeScript literal
  // type-ellenőrzése garantálja, hogy a két snapshot mode-ja megegyezik.
  if (
    a.status.engineAvailable !== b.status.engineAvailable ||
    a.status.connected !== b.status.connected ||
    a.status.engineError !== b.status.engineError
  ) {
    return false;
  }
  // A többi top-level mező:
  if (a.running !== b.running) return false;
  if (a.killSwitch !== b.killSwitch) return false;
  if (a.paused !== b.paused) return false;
  if (a.killSwitchThresholdPct !== b.killSwitchThresholdPct) return false;

  // Tömbök: positions, history, tickers, tickerEvents — mély egyenlőség.
  if (!arrayDeepEqual(a.positions, b.positions)) return false;
  if (!arrayDeepEqual(a.history, b.history)) return false;
  if (!arrayDeepEqual(a.tickers, b.tickers)) return false;
  if (!arrayDeepEqual(a.tickerEvents, b.tickerEvents)) return false;

  // Statistics: object — minden mezőt egyenként hasonlítunk.
  if (!statisticsEquals(a.statistics, b.statistics)) return false;

  return true;
}

/** Két `StateFeedStatistics` objektum mezőnkénti összehasonlítása. */
function statisticsEquals(a: StateFeedStatistics, b: StateFeedStatistics): boolean {
  return (
    a.totalPnlUsdt === b.totalPnlUsdt &&
    a.totalPnlPct === b.totalPnlPct &&
    a.winRate === b.winRate &&
    a.totalTrades === b.totalTrades &&
    a.winningTrades === b.winningTrades &&
    a.losingTrades === b.losingTrades &&
    a.maxDrawdownPct === b.maxDrawdownPct &&
    a.currentDrawdownPct === b.currentDrawdownPct &&
    a.avgWinPnl === b.avgWinPnl &&
    a.avgLossPnl === b.avgLossPnl &&
    a.bestTradePnl === b.bestTradePnl &&
    a.worstTradePnl === b.worstTradePnl &&
    a.profitFactor === b.profitFactor &&
    a.sharpeRatio === b.sharpeRatio &&
    a.equityUsdt === b.equityUsdt &&
    a.initialEquityUsdt === b.initialEquityUsdt
  );
}

/** Két readonly tömb mély egyenlősége — azonos hossz + minden elem rekurzívan egyenlő. */
function arrayDeepEqual<T>(a: readonly T[], b: readonly T[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (!deepValueEquals(a[i], b[i])) return false;
  }
  return true;
}

/** Két érték rekurzív összehasonlítása — primitívek + tömb + objektum. */
function deepValueEquals(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return false;
  if (typeof a === "number") {
    // NaN-safe: NaN === NaN a mi szempontunkból egyenlő.
    if (Number.isNaN(a) && Number.isNaN(b)) return true;
    return false;
  }
  if (Array.isArray(a)) {
    if (!Array.isArray(b)) return false;
    return arrayDeepEqual(a, b);
  }
  if (typeof a === "object") {
    return objectDeepEquals(a as Record<string, unknown>, b as Record<string, unknown>);
  }
  return false;
}

/** Két object mezőnkénti összehasonlítása. */
function objectDeepEquals(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
): boolean {
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  for (const key of keysA) {
    if (!Object.prototype.hasOwnProperty.call(b, key)) return false;
    if (!deepValueEquals(a[key], b[key])) return false;
  }
  return true;
}

/** A bot `closedTrades` + P&L adataiból aggregált `StateFeedStatistics`. */
function computeStatistics(
  closedTrades: readonly ClosedTradeSnapshot[],
  realizedPnlUsd: number,
  initialEquityUsd: number,
  equityUsd: number,
): StateFeedStatistics {
  if (closedTrades.length === 0) {
    return {
      totalPnlUsdt: realizedPnlUsd,
      totalPnlPct: initialEquityUsd > 0 ? (realizedPnlUsd / initialEquityUsd) * 100 : 0,
      winRate: 0,
      totalTrades: 0,
      winningTrades: 0,
      losingTrades: 0,
      maxDrawdownPct: 0,
      currentDrawdownPct: 0,
      avgWinPnl: 0,
      avgLossPnl: 0,
      bestTradePnl: 0,
      worstTradePnl: 0,
      profitFactor: 0,
      sharpeRatio: 0,
      equityUsdt: equityUsd,
      initialEquityUsdt: initialEquityUsd,
    };
  }

  let winningPnl = 0;
  let losingPnl = 0;
  let winningCount = 0;
  let losingCount = 0;
  let best = Number.NEGATIVE_INFINITY;
  let worst = Number.POSITIVE_INFINITY;

  for (const t of closedTrades) {
    const pnl = t.pnl;
    if (pnl > 0) {
      winningCount++;
      winningPnl += pnl;
      best = Math.max(best, pnl);
    } else if (pnl < 0) {
      losingCount++;
      losingPnl += Math.abs(pnl);
      worst = Math.min(worst, pnl);
    }
  }

  const totalTrades = closedTrades.length;
  const winRate = totalTrades > 0 ? (winningCount / totalTrades) * 100 : 0;
  const avgWin = winningCount > 0 ? winningPnl / winningCount : 0;
  const avgLoss = losingCount > 0 ? losingPnl / losingCount : 0;
  const profitFactor =
    losingPnl > 0 ? winningPnl / losingPnl : winningPnl > 0 ? Number.POSITIVE_INFINITY : 0;

  // Egyszerűsített Sharpe.
  const sortedTrades = [...closedTrades].sort((a, b) => a.closedAt - b.closedAt);
  const returns: number[] = [];
  let runningEquity = initialEquityUsd;
  for (const t of sortedTrades) {
    const equityBefore = runningEquity;
    runningEquity += t.pnl;
    if (equityBefore > 0) {
      returns.push(t.pnl / equityBefore);
    }
  }
  let sharpe = 0;
  if (returns.length > 1) {
    const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
    const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / (returns.length - 1);
    const stddev = Math.sqrt(variance);
    sharpe = stddev > 0 ? (mean / stddev) * Math.sqrt(returns.length) : 0;
  }

  // Drawdown számítás.
  let peak = initialEquityUsd;
  let maxDd = 0;
  let eq = initialEquityUsd;
  for (const t of sortedTrades) {
    eq += t.pnl;
    if (eq > peak) peak = eq;
    const ddPct = peak > 0 ? ((peak - eq) / peak) * 100 : 0;
    if (ddPct > maxDd) maxDd = ddPct;
  }
  const currentDd = peak > 0 && equityUsd < peak ? ((peak - equityUsd) / peak) * 100 : 0;

  return {
    totalPnlUsdt: realizedPnlUsd,
    totalPnlPct: initialEquityUsd > 0 ? (realizedPnlUsd / initialEquityUsd) * 100 : 0,
    winRate,
    totalTrades,
    winningTrades: winningCount,
    losingTrades: losingCount,
    maxDrawdownPct: maxDd,
    currentDrawdownPct: currentDd,
    avgWinPnl: avgWin,
    avgLossPnl: -avgLoss, // state-feed konvenció: negatív
    bestTradePnl: best === Number.NEGATIVE_INFINITY ? 0 : best,
    worstTradePnl: worst === Number.POSITIVE_INFINITY ? 0 : worst,
    profitFactor,
    sharpeRatio: sharpe,
    equityUsdt: equityUsd,
    initialEquityUsdt: initialEquityUsd,
  };
}

/** A bot enabled symbols + positions[].currentPrice → state-feed TickerPrice[]. */
function buildTickers(
  positions: readonly EnginePosition[],
  enabledSymbols: readonly string[],
): readonly StateFeedTickerPrice[] {
  const seen = new Set<string>();
  const out: StateFeedTickerPrice[] = [];
  for (const sym of enabledSymbols) {
    if (seen.has(sym)) continue;
    seen.add(sym);
    const pos = positions.find((p) => p.symbol === sym);
    out.push({
      symbol: sym,
      price: pos?.currentPrice ?? 0,
      change24hPct: 0,
      volume24hUsdt: 0,
    });
  }
  for (const p of positions) {
    if (seen.has(p.symbol)) continue;
    seen.add(p.symbol);
    out.push({
      symbol: p.symbol,
      price: p.currentPrice,
      change24hPct: 0,
      volume24hUsdt: 0,
    });
  }
  return out;
}

/** A `LiveStatePublisher` induló state-feed state-je (a bot indulása előtt). */
function initialStateFeedSnapshot(
  initialEquityUsdt: number,
  strategies: readonly StateFeedStrategyDescriptor[],
): StateFeedSnapshot {
  return {
    status: {
      mode: "with-bot",
      engineAvailable: false,
      engineError: null,
      connected: false,
      lastUpdate: 0,
    },
    running: false,
    killSwitch: "armed",
    positions: [],
    statistics: {
      totalPnlUsdt: 0,
      totalPnlPct: 0,
      winRate: 0,
      totalTrades: 0,
      winningTrades: 0,
      losingTrades: 0,
      maxDrawdownPct: 0,
      currentDrawdownPct: 0,
      avgWinPnl: 0,
      avgLossPnl: 0,
      bestTradePnl: 0,
      worstTradePnl: 0,
      profitFactor: 0,
      sharpeRatio: 0,
      equityUsdt: initialEquityUsdt,
      initialEquityUsdt,
    },
    history: [],
    tickers: [],
    tickerEvents: [] as readonly StateFeedTickerEvent[],
    strategies,
    paused: false,
    killSwitchThresholdPct: -10,
  };
}

// ============================================================================
// Phase 45 preview — EventEmitter-like API
// ============================================================================

/** A `LiveStatePublisher` event típusai (a Phase 45 state-feed szerver használja). */
export type LiveStatePublisherEvent =
  | { readonly type: "snapshot"; readonly snapshot: StateFeedSnapshot }
  | { readonly type: "state"; readonly snapshot: StateFeedSnapshot }
  | { readonly type: "tick"; readonly symbol: string; readonly price: number }
  | { readonly type: "bar"; readonly symbol: string; readonly timeframe: string; readonly ohlc: { readonly time: number; readonly open: number; readonly high: number; readonly low: number; readonly close: number; readonly volume: number } }
  | { readonly type: "indicator"; readonly symbol: string; readonly strategy: string; readonly timeframe: string; readonly indicator: string; readonly series: Readonly<Record<string, readonly (number | null)[]>> }
  | { readonly type: "marker"; readonly symbol: string; readonly strategy: string; readonly timeframe: string; readonly side: "long" | "short" | "buy" | "sell"; readonly price: number; readonly label: string }
  | { readonly type: "error"; readonly message: string; readonly recoverable: boolean }
  | { readonly type: "started" }
  | { readonly type: "stopped" }
  | { readonly type: "kill-switch"; readonly state: StateFeedKillSwitchState }
  | { readonly type: "paused"; readonly paused: boolean }
  | { readonly type: "engine-error"; readonly message: string | null };

/** Az EventEmitter-like `addEventListener` callback-jének típusa. */
export type LiveStatePublisherListener = (event: LiveStatePublisherEvent) => void;

/** A `subscribe()` metódus listener-típusa (a backward-compat API). */
export type Listener = () => void;

// ============================================================================
// LiveStatePublisher class
// ============================================================================

/** A `LiveStatePublisher` opciói. */
export interface LiveStatePublisherOptions {
  readonly bot: Bot;
  readonly enabledSymbols?: readonly string[];
  readonly initialEquityUsdt?: number;
  /**
   * Phase 52E bugfix: a bot engine config.strategies objektumából
   * származtatott, normalizált stratégia-lista. A `LiveStatePublisher`
   * a SNAPSHOT `strategies` mezőjébe írja (a `web-client/http-server.ts`
   * `buildStrategiesList` innen olvas). Ha nincs megadva, a publisher
   * a `bot.config.strategies`-ből próbálja származtatni (best-effort).
   */
  readonly strategies?: readonly StateFeedStrategyDescriptor[];
}

/**
 * `LiveStatePublisher` — a `Bot` → state-feed bridge implementáció.
 *
 * A `bot.subscribe(listener)` segítségével a bot minden `getState()`
 * hívásakor értesítést kap, és a kapott `BotState`-et lefordítja a
 * state-feed formátumára. A Phase 45 state-feed szerver az
 * `addEventListener(fn)` metódussal iratkozik fel az eseményekre.
 *
 * A `subscribe(listener)` metódus a backward-compat API — a Phase 44
 * tesztek és a `start.ts` is ezt használja. A Phase 45 az
 * `addEventListener`-re fog átállni.
 */
export class LiveStatePublisher {
  private readonly bot: Bot;
  private readonly tickerSymbolOrder: readonly string[];
  private readonly staticStrategies: readonly StateFeedStrategyDescriptor[];
  private readonly listeners = new Set<Listener>();
  private readonly eventListeners = new Set<LiveStatePublisherListener>();
  private readonly unsubscribers: (() => void)[] = [];

  private currentState: StateFeedSnapshot;

  /**
   * `active` — a publisher belső "figyelek a botra" flag-je.
   *
   * A `start()` hívásakor áll `true`-ra, a `stop()` / `dispose()`
   * hívásakor `false`-ra. A `state.status.engineAvailable` és
   * `state.status.connected` mezőket vezérli (nem a `state.running`-ot).
   *
   * Független a `botRunning`-tól: a publisher aktív LEHET úgy, hogy
   * a bot még nem fut (Phase 36 Track A1 user mandate: a `mm-bot start`
   * a publisher-t a bot indulása ELŐTT indítja, és a user
   * `markBotStarted()` hívásával indítja a botot).
   */
  private active = false;

  /**
   * `botRunning` — a "a bot TÉNYLEGESEN fut-e" flag.
   *
   * CSAK a `markBotStarted()` / `markBotStopped()` hívások állítják.
   * A `state.running` mezőt vezérli. A `start.ts` hívja a
   * `bot.start()` / `bot.stop()` sikeres resolve-ja után.
   *
   * Kezdőértéke `false` — a publisher soha nem állítja önmagától
   * `true`-ra.
   */
  private botRunning = false;

  private killSwitchState: StateFeedKillSwitchState = "armed";
  private lastEngineState: EngineBotState | null = null;

  /**
   * Ticker-event rolling buffer (max 32 event).
   * A `LiveStatePublisher` NEM kap valós ticker-stream-et a
   * `Bot`-tól (a bot a feed-en keresztül kapja, és a `BotState`-ben
   * csak a position-ök currentPrice-ét látjuk). A synthetic event-eket
   * a `onEngineStateChanged` híváskor generáljuk, az enabled symbol-ok
   * position-árai alapján — így a `LiveTradingPanel` (Phase 49+)
   * mindig mutat valamit, és a tesztek reprodukálhatók.
   */
  private readonly tickerEventBuffer: StateFeedTickerEvent[] = [];
  private nextTickerSeq = 1;

  public constructor(options: LiveStatePublisherOptions) {
    this.bot = options.bot;
    this.tickerSymbolOrder = options.enabledSymbols ?? [];
    // Phase 52E bugfix: a strategies listát a konstruktorban tároljuk,
    // és az initialStateFeedSnapshot + a refreshFromBot a currentState-be írja.
    this.staticStrategies = options.strategies ?? [];
    this.currentState = initialStateFeedSnapshot(
      options.initialEquityUsdt ?? 10_000,
      this.staticStrategies,
    );
  }

  // --------------------------------------------------------------------------
  // Phase 45 preview — EventEmitter-like API
  // --------------------------------------------------------------------------

  /**
   * `addEventListener` — feliratkozás a state-feed eseményekre.
   *
   * A Phase 45 state-feed szerver ezen a metóduson keresztül kapja
   * meg a bot state-változásait (`snapshot` event) és a kontroll
   * eseményeket (`started`, `stopped`, `kill-switch`, `paused`,
   * `engine-error`). A függvény egy unsubscribe callback-et ad
   * vissza.
   *
   * A listener-ek értesítése SORBAN történik, és egy listener
   * kivétele nem állítja le a többit (best-effort delivery).
   */
  public addEventListener(listener: LiveStatePublisherListener): () => void {
    this.eventListeners.add(listener);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      this.eventListeners.delete(listener);
    };
  }

  /**
   * `emit` — belső helper, amely a `notifyListeners()` során
   * meghívódik. A Phase 45 state-feed szerver a `snapshot` event-et
   * használja a bot state broadcast-jára.
   *
   * Publikus metódus, hogy a tesztek közvetlenül is triggerelhessenek
   * event-emission-t, illetve hogy a `setKillSwitchState` /
   * `markBotStarted` / stb. belső metódusok egységesen használhassák.
   */
  public emit(event: LiveStatePublisherEvent): void {
    if (this.eventListeners.size === 0) return;
    for (const listener of [...this.eventListeners]) {
      try {
        listener(event);
      } catch {
        // Egy listener hibája nem állíthatja le a többit.
      }
    }
  }

  // --------------------------------------------------------------------------
  // Backward-compat API — Phase 45-ig használatos
  // --------------------------------------------------------------------------

  /**
   * `subscribe` — feliratkozás a state-változásokra.
   * Másolatot készítünk a notify során, hogy a listener-ek a
   * callback-jük közben biztonságosan leiratkozhassanak.
   */
  public subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      this.listeners.delete(listener);
    };
  }

  /**
   * `getSnapshot` — a legutolsó ismert state-pillanatkép.
   */
  public getSnapshot(): StateFeedSnapshot {
    return this.currentState;
  }

  /**
   * `start` — feliratkozik a bot state-változásaira, és a bot
   * aktuális állapotát betölti a snapshot-ba.
   *
   * A bot életciklusát a start command kezeli; a `start()` itt
   * csak a publisher belső state-jét inicializálja (az `active` flag-et
   * állítja `true`-ra). A `botRunning` flag-et NEM állítja — a
   * `start.ts` hívja a `markBotStarted()`-et a `bot.start()` sikeres
   * resolve-ja után.
   */
  // eslint-disable-next-line @typescript-eslint/require-await
  public async start(): Promise<void> {
    if (this.active) return;
    this.active = true;
    this.killSwitchState = "armed";
    // Feliratkozás a bot state-változásaira.
    this.subscribeToBot();
    // A bot aktuális állapotát lekérdezzük.
    this.refreshFromBot();
  }

  /**
   * `stop` — a state-feed kliens felől jövő stop kérés. A botot
   * leállítja (graceful), a bot subscription-t törli, és a saját
   * state-et frissíti.
   */
  public async stop(): Promise<void> {
    if (!this.active) return;
    this.active = false;
    this.unsubscribeFromBot();
    // A stop kérés a bot futását is leállítja — a `botRunning` flag
    // is `false`-ra vált.
    this.botRunning = false;
    try {
      await this.bot.stop();
    } catch {
      // A bot leállítása nem kritikus.
    }
    this.refreshFromBot();
  }

  /**
   * `markBotStarted` — a `start.ts` hívja a `bot.start()` sikeres
   * resolve-ja után. A `state.running` mezőt `true`-ra állítja.
   *
   * A flag idempotens: többszöri hívás nem okoz állapotváltást.
   */
  public markBotStarted(): void {
    if (this.botRunning) return;
    this.botRunning = true;
    this.refreshFromBot();
    this.emit({ type: "started" });
  }

  /**
   * `markBotStopped` — a `start.ts` hívja a `bot.stop()` sikeres
   * resolve-ja után. A `state.running` mezőt `false`-ra állítja.
   *
   * A flag idempotens: többszöri hívás nem okoz állapotváltást.
   */
  public markBotStopped(): void {
    if (!this.botRunning) return;
    this.botRunning = false;
    this.refreshFromBot();
    this.emit({ type: "stopped" });
  }

  /**
   * `killSwitch` — vészleállító. A botot leállítja, a kill-switch
   * state-et `triggered`-re állítja.
   */
  public async killSwitch(): Promise<void> {
    this.killSwitchState = "triggered";
    this.botRunning = false;
    this.unsubscribeFromBot();
    try {
      await this.bot.stop();
    } catch {
      // best-effort
    }
    this.refreshFromBot();
    this.emit({ type: "kill-switch", state: "triggered" });
    this.emit({ type: "stopped" });
  }

  /**
   * `setKillSwitchState` — a state-feed kliens felől jövő
   * kill-switch state változtatás (armed / confirm / triggered).
   */
  public setKillSwitchState(state: StateFeedKillSwitchState): void {
    if (this.killSwitchState === state) {
      return;
    }
    this.killSwitchState = state;
    this.refreshFromBot();
    this.emit({ type: "kill-switch", state });
  }

  /**
   * `setPaused` — a state-feed kliens felől jövő pause/resume kérés.
   *
   * A `LiveStatePublisher` esetén a `paused` flag tisztán UI-flag:
   * a `Bot` önállóan kezeli a saját position-nyitási logikáját, és
   * a pause NEM állítja meg a bot futását. A flag célja, hogy a
   * state-feed klienseken a `[PAUSED]` badge megjelenjen.
   */
  public setPaused(paused: boolean): void {
    if (this.currentState.paused === paused) {
      return;
    }
    this.currentState = { ...this.currentState, paused };
    this.notifyListeners();
    this.emit({ type: "paused", paused });
  }

  /**
   * `setEngineError` — a state-feed klienst értesíti, hogy a bot
   * engine elszállt (vagy épp helyreállt). A `state.status.engineError`
   * mezőt állítja, amit a kliens külön warning-sorként jeleníthet meg.
   *
   * A metódus idempotens: ha az új message ugyanaz, mint a jelenlegi
   * (vagy mindkettő null), nem cserélünk referenciát és nem notify-olunk.
   * A `null` message a hiba törlését jelenti (pl. recovery flow).
   */
  public setEngineError(message: string | null): void {
    if (this.currentState.status.engineError === message) {
      return;
    }
    this.currentState = {
      ...this.currentState,
      status: { ...this.currentState.status, engineError: message },
    };
    this.notifyListeners();
    this.emit({ type: "engine-error", message });
  }

  // --------------------------------------------------------------------------
  // Phase 45 — State-feed event publication API
  // --------------------------------------------------------------------------

  /**
   * `publishTick` — a bot feed tick listener-éből hívódik. A `tick`
   * event a state-feed broadcast-on át megy a 4Hz throttling-hoz.
   *
   * PR 45A-ban a metódus már implementált (csak az event-et adja ki);
   * a bot.ts feed listener-ét a Phase 45B-ben kötjük be.
   */
  public publishTick(symbol: string, price: number): void {
    this.emit({ type: "tick", symbol, price });
  }

  /**
   * `publishBar` — a StrategyRunner-ból hívódik, amikor egy OHLC bar
   * lezárul. A `bar` event a state-feed broadcast-on át megy a
   * subscription-szűrővel.
   */
  public publishBar(
    symbol: string,
    timeframe: string,
    ohlc: { readonly time: number; readonly open: number; readonly high: number; readonly low: number; readonly close: number; readonly volume: number },
  ): void {
    this.emit({ type: "bar", symbol, timeframe, ohlc });
  }

  /**
   * `publishIndicator` — a StrategyRunner-ból hívódik, amikor egy
   * indikátor frissül (Donchian / pivot / stb.). A `series` mező
   * a kliens által interpretált adatsor.
   */
  public publishIndicator(
    symbol: string,
    strategy: string,
    timeframe: string,
    indicator: string,
    series: Readonly<Record<string, readonly (number | null)[]>>,
  ): void {
    this.emit({ type: "indicator", symbol, strategy, timeframe, indicator, series });
  }

  /**
   * `publishMarker` — a StrategyRunner-ból hívódik, amikor egy
   * stratégia jelet ad (entry/exit). A `marker` event a chart
   * overlay-en jelenik meg.
   */
  public publishMarker(
    symbol: string,
    strategy: string,
    timeframe: string,
    side: "long" | "short" | "buy" | "sell",
    price: number,
    label: string,
  ): void {
    this.emit({ type: "marker", symbol, strategy, timeframe, side, price, label });
  }

  /**
   * `publishState` — a bot engine-ből hívódik minden `bot.subscribe`
   * notification-nél. A `state` event a positions / statistics /
   * kill-switch / paused mezőket szállítja.
   */
  public publishState(): void {
    this.emit({ type: "state", snapshot: this.currentState });
  }

  /**
   * `publishError` — a bot engine-ből hívódik, amikor a bot hibát
   * észlel. A `recoverable` flag jelzi, hogy a bot önállóan tud-e
   * helyreállni (pl. `MissingCredentialsError` recovery flow).
   */
  public publishError(message: string, recoverable: boolean): void {
    this.emit({ type: "error", message, recoverable });
  }

  /**
   * `dispose` — a state-feed kliens lecsatlakozásakor hívja.
   */
  // eslint-disable-next-line @typescript-eslint/require-await
  public async dispose(): Promise<void> {
    this.unsubscribeFromBot();
    this.listeners.clear();
    this.eventListeners.clear();
  }

  // --------------------------------------------------------------------------
  // Belső logika
  // --------------------------------------------------------------------------

  /**
   * `subscribeToBot` — a bot `subscribe(listener)` hívásával
   * feliratkozik a state-változásokra.
   */
  private subscribeToBot(): void {
    if (this.unsubscribers.length > 0) return;
    const unsub = this.bot.subscribe((engineState) => {
      this.onEngineStateChanged(engineState);
    });
    this.unsubscribers.push(unsub);
  }

  /**
   * `unsubscribeFromBot` — a bot subscription törlése.
   */
  private unsubscribeFromBot(): void {
    while (this.unsubscribers.length > 0) {
      const unsub = this.unsubscribers.pop();
      if (unsub !== undefined) {
        try {
          unsub();
        } catch {
          // best-effort
        }
      }
    }
  }

  /**
   * `onEngineStateChanged` — a bot értesített minket egy friss
   * `BotState`-ről. A frissítés előtt ticker-event-eket generálunk
   * az enabled symbol-okra (a jövőbeli `LiveTradingPanel`-hez).
   */
  private onEngineStateChanged(engineState: EngineBotState): void {
    this.lastEngineState = engineState;
    // Ticker-event-ek generálása a friss engine state-ből.
    this.synthesizeTickerEvents(engineState);
    this.refreshFromBot();
  }

  /**
   * `synthesizeTickerEvents` — a `LiveStatePublisher` NEM kap
   * valós ticker-stream-et a Bot-tól (a feed a Bot-on belül fut, és
   * a `BotState` csak a position-öket exponálja). Helyette minden
   * engine-notifykor generálunk egy-egy synthetic TickerEvent-et az
   * enabled symbol-okra, a position currentPrice (vagy 0) alapján.
   */
  private synthesizeTickerEvents(engine: EngineBotState): void {
    const now = engine.savedAt;
    for (const symbol of this.tickerSymbolOrder) {
      const pos = engine.positions.find((p) => p.symbol === symbol);
      const lastPrice = pos?.currentPrice ?? 0;
      const volume = pos ? pos.notionalUsd : 0;
      this.tickerEventBuffer.push({
        seq: this.nextTickerSeq++,
        symbol,
        price: lastPrice,
        volume,
        timestamp: now,
      });
    }
    // A rolling buffer méret-limitje: 32 event.
    const BUFFER_SIZE = 32;
    if (this.tickerEventBuffer.length > BUFFER_SIZE) {
      this.tickerEventBuffer.splice(0, this.tickerEventBuffer.length - BUFFER_SIZE);
    }
  }

  /**
   * `refreshFromBot` — a `lastEngineState` (vagy a bot `getState()`)
   * alapján újraszámolja a state-feed snapshot-ot, és notify-olja
   * a klienseket.
   */
  private refreshFromBot(): void {
    const engine = this.lastEngineState;
    const now = Date.now();

    if (engine === null) {
      // A bot még nem adott state-et — induló state frissítése.
      const tickers = buildTickers([], this.tickerSymbolOrder);
      const candidate: StateFeedSnapshot = {
        ...this.currentState,
        running: this.botRunning,
        killSwitch: this.killSwitchState,
        status: {
          ...this.currentState.status,
          mode: "with-bot",
          engineAvailable: this.active,
          engineError: null,
          connected: this.active,
          lastUpdate: now,
        },
        tickers,
        tickerEvents: this.tickerEventBuffer.slice(),
        strategies: this.staticStrategies,
      };
      if (stateEqualsIgnoringTimestamp(this.currentState, candidate)) {
        // Nincs változás — ne cseréljük a referenciát, ne notify-oljunk.
        return;
      }
      this.currentState = candidate;
      this.notifyListeners();
      this.emit({ type: "snapshot", snapshot: this.currentState });
      return;
    }

    const positions = engine.positions.map(mapPosition);
    const history = engine.closedTrades.map(mapClosedTrade);
    const statistics = computeStatistics(
      engine.closedTrades,
      engine.realizedPnlUsd,
      engine.initialEquityUsd,
      engine.equityUsd,
    );
    const tickers = buildTickers(engine.positions, this.tickerSymbolOrder);

    const candidate: StateFeedSnapshot = {
      status: {
        mode: "with-bot",
        engineAvailable: this.active,
        engineError: null,
        connected: this.active,
        lastUpdate: now,
      },
      running: this.botRunning,
      killSwitch: this.killSwitchState,
      positions,
      statistics,
      history,
      tickers,
      tickerEvents: this.tickerEventBuffer.slice(),
      strategies: this.staticStrategies,
      paused: this.currentState.paused,
      killSwitchThresholdPct: this.currentState.killSwitchThresholdPct,
    };
    if (stateEqualsIgnoringTimestamp(this.currentState, candidate)) {
      // A többi mező referenciája is csak a tényleges változásnál
      // cserélődik. Ha minden más egyezik, nem cserélünk referenciát
      // és nem notify-olunk.
      return;
    }
    this.currentState = candidate;
    this.notifyListeners();
    this.emit({ type: "snapshot", snapshot: this.currentState });
  }

  /**
   * `notifyListeners` — a backward-compat `subscribe()` listener-eit
   * értesíti a state-változásról.
   */
  private notifyListeners(): void {
    if (this.listeners.size === 0) return;
    for (const listener of [...this.listeners]) {
      try {
        listener();
      } catch {
        // Egy listener hibája nem állíthatja le a többit.
      }
    }
  }

  // --------------------------------------------------------------------------
  // Tesztelési segédletek
  // --------------------------------------------------------------------------

  /**
   * `getLastEngineState` — a legutolsó bot `BotState`, amit a publisher
   * látott.
   */
  public getLastEngineState(): EngineBotState | null {
    return this.lastEngineState;
  }
}
