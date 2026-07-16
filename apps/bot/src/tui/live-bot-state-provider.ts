/**
 * apps/bot/src/tui/live-bot-state-provider.ts
 *
 * ===========================================================================
 * PHASE 34 TRACK A — TUI INTEGRATION
 * ===========================================================================
 *
 * A `LiveBotStateProvider` híd a futó `Bot` és a `@mm-crypto-bot/tui`
 * csomag `BotStateProvider` interfésze között. A `Bot.subscribe(listener)`
 * segítségével feliratkozik a bot állapotváltozásaira, és a bot
 * `BotState`-ját a TUI által várt formátumra (`Position`, `Trade`,
 * `Statistics`, `TickerPrice`, `ProviderStatus`) leképezve adja vissza.
 *
 * ===========================================================================
 * MIÉRT KÜLÖN PROVIDER?
 * ===========================================================================
 * A TUI egy általános `BotStateProvider` interfészen dolgozik, ami a
 * TUI-only (`SimulatedProvider`) és a with-bot módot (`PaperProvider`,
 * `LiveBotStateProvider`) egységesen kezeli. A `LiveBotStateProvider` a
 * Phase 33-as `Bot` osztály állapotát exponálja — a Phase 34 Track A
 * szállítmánya.
 *
 * ===========================================================================
 * MAPPING — Bot.BotState → TUI.BotState
 * ===========================================================================
 *   TUI mező                │ Forrás (Bot oldaláról)
 *   ─────────────────────────┼────────────────────────────────────
 *   status.mode              │ "with-bot" (fix)
 *   status.engineAvailable   │ `active` flag (provider figyel a botra)
 *   status.engineError       │ null
 *   status.connected         │ `active` flag (provider figyel a botra)
 *   status.lastUpdate        │ Date.now() a notify időpontjában
 *   running                  │ `botRunning` flag (a bot TÉNYLEGESEN fut-e)
 *   killSwitch               │ saját killSwitchState (UI állapot)
 *   positions[]              │ bot.positions[] (mapping: side, %, stop, TP)
 *   statistics               │ aggregálás bot.closedTrades + counters
 *   history[]                │ bot.closedTrades[] (mapping → Trade)
 *   tickers[]                │ enabled symbols + bot.positions[].currentPrice
 *
 * A `stopLoss` / `takeProfit` mezők egyelőre `null` — a bot jelenleg
 * nem tárolja ezeket a perzisztens state-ben.
 *
 * ===========================================================================
 * PHASE 38 FIX #38 — RUNNING FLAG DECOUPLING
 * ===========================================================================
 * A `running` mező a TUI-nak a "bot TÉNYLEGESEN fut-e" szemantikát jelenti,
 * NEM a "provider figyel" állapotot. A Phase 36 Track A1 user mandate
 * (`mm-bot start` ne induljon automatikusan) óta a `mm-bot start` alap-
 * értelmezetten a TUI-t `stopped` állapotban nyitja, és a user a `[s]`
 * billentyűvel indítja a botot. A bug az volt, hogy a provider
 * `start()` metódusa UNCONDITIONALLY `running = true`-ra állította a
 * saját belső flag-jét, és a `state.running` a TUI-nak `true`-t mutatott
 * a bot indulása ELŐTT.
 *
 * A fix: a provider belső "active" flag-je (provider szintű "figyelek a
 * botra" szemafor) ELVÁLASZTÁSRA került a `botRunning` flag-től. A
 * `markBotStarted()` / `markBotStopped()` API explicit módon jelzi a
 * provider felé, hogy a bot valóban elindult / leállt — ezt a
 * `start.ts` hívja a `bot.start()` / `bot.stop()` mellé.
 *
 * A `state.running` a `botRunning` flag-et olvassa (NEM az `active`-et).
 * A `state.status.engineAvailable` / `state.status.connected` az
 * `active` flag-et olvassa (a provider csatlakoztatva van-e a bot notify
 * folyamhoz). A kettő ELTÉRHET: a provider aktív (figyel), de a bot
 * még nem futott el (stopped state).
 *
 * ===========================================================================
 * ÉLETCIKLUS INTEGRÁCIÓ
 * ===========================================================================
 * A `LiveBotStateProvider` a `mm-bot start` parancs által indított
 * futó `Bot`-hoz csatlakozik:
 *
 *   1) `start()` — feliratkozik a bot state-változásaira (`bot.subscribe`).
 *      A bot már fut (a start command előbb indítja). A friss state-et
 *      lekérdezi a `getState()`-en át.
 *   2) `stop()` — leiratkozik a bot-ról, majd `bot.stop()` (graceful).
 *   3) `killSwitch()` — a TUI-ból jövő vészleállító: `bot.stop()` +
 *      a kill-switch state átállítása `triggered`-re.
 *   4) `dispose()` — leiratkozás + takarítás.
 *
 * A provider a bot életciklusát NEM veszi át — a start command a
 * felelős a `bot.start()` hívásért. A provider csak a TUI-val való
 * kommunikációért felel, és a TUI-ból jövő stop/kill kéréseket
 * továbbítja a bot-nak.
 */

import type {
  BotState as TuiBotState,
  KillSwitchState,
  Position as TuiPosition,
  Side as TuiSide,
  Statistics,
  TickerEvent,
  TickerPrice,
  Trade as TuiTrade,
} from "@mm-crypto-bot/tui";
import type { BotStateProvider, Listener } from "@mm-crypto-bot/tui";

import type { Bot } from "../bot/bot.js";
import type { BotState as EngineBotState, ClosedTradeSnapshot } from "../bot/state-store.js";

/** A bot engine pozíció típusa — a  eleme. */
type EnginePosition = EngineBotState["positions"][number];

// ============================================================================
// Helpers — bot state → TUI state mapping
// ============================================================================

/** A `Bot` long/short oldalát a TUI buy/sell formájára konvertálja. */
export function mapSide(side: "long" | "short"): TuiSide {
  return side === "long" ? "buy" : "sell";
}

/** Egy bot pozíció → TUI pozíció. */
export function mapPosition(p: EnginePosition): TuiPosition {
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
    stopLoss: null, // A bot jelenleg nem tárolja perzisztensen (Track B+ feature)
    takeProfit: null,
  };
}

/** Egy bot `ClosedTradeSnapshot` → TUI `Trade`. */
export function mapClosedTrade(t: ClosedTradeSnapshot, index: number): TuiTrade {
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
// Phase 39 — Snapshot equality helper (Fix #39: TUI responsiveness)
// ============================================================================

/**
 * `stateEqualsIgnoringTimestamp` — két `TuiBotState` mély összehasonlítása,
 * a `status.lastUpdate` mező kihagyásával.
 *
 * A `lastUpdate` ms-pontosságú timestamp, és minden `refreshFromBot()`
 * híváskor változna — de a UI-t nem érdekli a ms-pontosság (a Header
 * `Frissítve: HH:MM:SS` formátumban mutatja, ahol a másodperc a lényeges).
 * Ha csak a `lastUpdate` változna, a függvény `true`-t ad vissza, és a
 * snapshot referenciája megmarad → nincs felesleges re-render.
 *
 * A függvény rekurzívan hasonlítja a `BotState` shape minden mezőjét:
 *   - Primitívek: `Object.is` (NaN-safe)
 *   - Tömbök: azonos hossz + minden elem rekurzívan egyenlő
 *   - Objektumok: azonos kulcsok + minden érték rekurzívan egyenlő
 *
 * A `Number.NaN`-t külön kezeljük, mert az `Object.is(NaN, NaN) === true`,
 * de `NaN === NaN` hamis — a `JSON.stringify`-alapú összehasonlítás
 * elveszne a NaN-en. Mi a `Number.isNaN` + `Object.is` kombinációt használjuk.
 */
export function stateEqualsIgnoringTimestamp(a: TuiBotState, b: TuiBotState): boolean {
  // status.lastUpdate kihagyása — a többi status-mezőt rekurzívan hasonlítjuk.
  if (
    a.status.mode !== b.status.mode ||
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

/** Két `Statistics` objektum mezőnkénti összehasonlítása. */
function statisticsEquals(a: Statistics, b: Statistics): boolean {
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

/** A bot `closedTrades` + P&L adataiból aggregált `Statistics`. */
function computeStatistics(
  closedTrades: readonly ClosedTradeSnapshot[],
  realizedPnlUsd: number,
  initialEquityUsd: number,
  equityUsd: number,
): Statistics {
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
    avgLossPnl: -avgLoss, // TUI konvenció: negatív
    bestTradePnl: best === Number.NEGATIVE_INFINITY ? 0 : best,
    worstTradePnl: worst === Number.POSITIVE_INFINITY ? 0 : worst,
    profitFactor,
    sharpeRatio: sharpe,
    equityUsdt: equityUsd,
    initialEquityUsdt: initialEquityUsd,
  };
}

/** A bot enabled symbols + positions[].currentPrice → TUI TickerPrice[]. */
function buildTickers(
  positions: readonly EnginePosition[],
  enabledSymbols: readonly string[],
): readonly TickerPrice[] {
  const seen = new Set<string>();
  const out: TickerPrice[] = [];
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

/** A `LiveBotStateProvider` induló TUI state-je (a bot indulása előtt). */
function initialTuiState(initialEquityUsdt: number): TuiBotState {
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
    tickerEvents: [] as readonly TickerEvent[],
    paused: false,
    killSwitchThresholdPct: -10,
  };
}

// ============================================================================
// LiveBotStateProvider class
// ============================================================================

/** A `LiveBotStateProvider` opciói. */
export interface LiveBotStateProviderOptions {
  readonly bot: Bot;
  readonly enabledSymbols?: readonly string[];
  readonly initialEquityUsdt?: number;
}

/**
 * `LiveBotStateProvider` — a `Bot` → TUI bridge implementáció.
 *
 * Implementálja a `@mm-crypto-bot/tui` `BotStateProvider` interfészét.
 * A `bot.subscribe(listener)` segítségével a bot minden `getState()`
 * hívásakor értesítést kap, és a kapott `BotState`-et lefordítja a
 * TUI formátumára.
 */
export class LiveBotStateProvider implements BotStateProvider {
  private readonly bot: Bot;
  private readonly tickerSymbolOrder: readonly string[];
  private readonly listeners = new Set<Listener>();
  private readonly unsubscribers: (() => void)[] = [];

  private currentState: TuiBotState;

  /**
   * `active` — a provider belső "figyelek a botra" flag-je.
   *
   * A `start()` hívásakor áll `true`-ra, a `stop()` / `dispose()`
   * hívásakor `false`-ra. A `state.status.engineAvailable` és
   * `state.status.connected` mezőket vezérli (nem a `state.running`-ot).
   *
   * Független a `botRunning`-tól: a provider aktív LEHET úgy, hogy
   * a bot még nem fut (Phase 36 Track A1: a `mm-bot start` indítja a
   * provider-t, és csak a user `[s]` billentyűje után indul a bot).
   */
  private active = false;

  /**
   * `botRunning` — a "a bot TÉNYLEGESEN fut-e" flag.
   *
   * CSAK a `markBotStarted()` / `markBotStopped()` hívások állítják.
   * A `state.running` TUI mezőt vezérli. A `start.ts` hívja a
   * `bot.start()` sikeres resolve-ja után.
   *
   * Kezdőértéke `false` — a provider soha nem állítja önmagától
   * `true`-ra (a Phase 38 Fix #38 kulcsa: a provider nem dönti el,
   * hogy a bot mikor fut, csak a CLI/start parancs jelzi).
   */
  private botRunning = false;

  private killSwitchState: KillSwitchState = "armed";
  private lastEngineState: EngineBotState | null = null;

  /**
   * Phase 34 Track B: ticker-event rolling buffer (max 32 event).
   * A `LiveBotStateProvider` NEM kap valós ticker-stream-et a
   * `Bot`-tól (a bot a feed-en keresztül kapja, és a `BotState`-ben
   * csak a position-ök currentPrice-ét látjuk). A synthetic event-eket
   * a `onEngineStateChanged` híváskor generáljuk, az enabled symbol-ok
   * position-árai alapján — így a `LiveTradingPanel` sub-panelje
   * mindig mutat valamit, és a `realtime-update-probe` tesztelhető.
   */
  private readonly tickerEventBuffer: TickerEvent[] = [];
  private nextTickerSeq = 1;

  public constructor(options: LiveBotStateProviderOptions) {
    this.bot = options.bot;
    this.tickerSymbolOrder = options.enabledSymbols ?? [];
    this.currentState = initialTuiState(options.initialEquityUsdt ?? 10_000);
  }

  // --------------------------------------------------------------------------
  // BotStateProvider API
  // --------------------------------------------------------------------------

  /**
   * `subscribe` — feliratkozás a TUI listener-einek.
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
   * `getSnapshot` — a TUI legutolsó ismert state-pillanatképe.
   */
  public getSnapshot(): TuiBotState {
    return this.currentState;
  }

  /**
   * `start` — feliratkozik a bot state-változásaira, és a bot
   * aktuális állapotát betölti a TUI-ba.
   *
   * A bot életciklusát a start command kezeli; a `start()` itt
   * csak a provider belső state-jét inicializálja (az `active` flag-et
   * állítja `true`-ra). A `botRunning` flag-et NEM állítja — a Phase 38
   * Fix #38 előtti bug az volt, hogy a `start()` UNCONDITIONALLY
   * `running = true`-ra állította a `state.running`-ot, és a TUI
   * `stopped` állapotban is "running"-ot mutatott. A `botRunning`
   * flag-et CSAK a `markBotStarted()` állítja, amit a `start.ts`
   * hív a `bot.start()` sikeres resolve-ja után.
   *
   * A `BotStateProvider` interfész `Promise<void>` visszatérési
   * típust ír elő, ezért `async` — a jelenlegi implementációban
   * nincs `await`. A Bot.subscribe szinkron, így nem kell await.
   */
  // eslint-disable-next-line @typescript-eslint/require-await
  public async start(): Promise<void> {
    if (this.active) return;
    this.active = true;
    this.killSwitchState = "armed";
    // Feliratkozás a bot state-változásaira.
    this.subscribeToBot();
    // A bot már fut; a friss state-et lekérdezzük.
    this.refreshFromBot();
  }

  /**
   * `stop` — a TUI-ból jövő stop kérés. A botot leállítja
   * (graceful), a bot subscription-t törli, és a saját state-et
   * frissíti.
   *
   * Phase 38 Fix #38: a `stop()` a provider `active` flag-jét
   * `false`-ra állítja, de a `botRunning` flag-et NEM bántja —
   * a `start.ts` hívja a `markBotStopped()`-et a `bot.stop()`
   * mellé (vagy a stop flag a provider.stop() belső flow-jában
   * is tisztul, ha a TUI-ból jön a stop kérés).
   */
  public async stop(): Promise<void> {
    if (!this.active) return;
    this.active = false;
    this.unsubscribeFromBot();
    // A TUI-ból jövő stop kérés a bot futását is leállítja — a
    // `botRunning` flag is `false`-ra vált, mert a stop kérés a
    // bot-ot is leállítja.
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
   * resolve-ja után. A `state.running` TUI mezőt `true`-ra állítja.
   *
   * Phase 38 Fix #38: ez a metódus a "bot TÉNYLEGESEN elindult"
   * explicit jele a provider felé. A `provider.start()` önmagában
   * NEM elégséges — a Phase 36 Track A1 óta a provider a bot indulása
   * ELŐTT indul el (hogy a TUI stopped state-ben nyíljon), és a
   * user `[s]` billentyűje indítja a botot. A flag kezeléséért a
   * CLI/start parancs a felelős, NEM a provider.
   *
   * A flag idempotens: többszöri hívás nem okoz állapotváltást.
   */
  public markBotStarted(): void {
    if (this.botRunning) return;
    this.botRunning = true;
    this.refreshFromBot();
  }

  /**
   * `markBotStopped` — a `start.ts` hívja a `bot.stop()` sikeres
   * resolve-ja után (vagy amikor a bot-ot egyéb úton leállítják —
   * pl. SIGINT, kill switch). A `state.running` TUI mezőt
   * `false`-ra állítja.
   *
   * Phase 38 Fix #38: a Phase 36 Track A1 user mandate-ja szerint
   * a `[s]` billentyűvel a user a stopped state-be is visszatérhet —
   * ez a metódus jelzi a provider felé, hogy a bot leállt.
   *
   * A flag idempotens: többszöri hívás nem okoz állapotváltást.
   */
  public markBotStopped(): void {
    if (!this.botRunning) return;
    this.botRunning = false;
    this.refreshFromBot();
  }

  /**
   * `killSwitch` — a TUI-ból jövő vészleállító. A botot leállítja,
   * a kill-switch state-et `triggered`-re állítja.
   *
   * Phase 38 Fix #38: a kill-switch a bot-ot is leállítja, így a
   * `botRunning` flag is `false`-ra vált (a TUI-nak a stopped state
   * felé kell mutatnia, nem pedig "running" állapotot egy nem-létező
   * bot-ról).
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
  }

  /**
   * `setKillSwitchState` — a TUI-ból jövő kill-switch state
   * változtatás (armed / confirm / triggered).
   *
   * Phase 39 (Fix #39: TUI responsiveness): a `refreshFromBot`
   * mostant őrzi a snapshot referenciát (lásd ott). Ha a
   * kill-switch state nem változott ÉS a többi state-mező sem,
   * a hívás teljesen no-op (nincs referencia-csere, nincs notify).
   */
  public setKillSwitchState(state: KillSwitchState): void {
    if (this.killSwitchState === state) {
      return;
    }
    this.killSwitchState = state;
    this.refreshFromBot();
  }

  /**
   * `setPaused` — a TUI-ból jövő pause/resume kérés.
   *
   * A `LiveBotStateProvider` esetén a `paused` flag tisztán UI-flag:
   * a `Bot` önállóan kezeli a saját position-nyitási logikáját, és
   * a pause NEM állítja meg a bot futását. A flag célja, hogy a
   * TUI-ban a `[PAUSED]` badge megjelenjen, és a user jelzést
   * kapjon arról, hogy a TUI-ból felfüggesztette a megfigyelést.
   *
   * Ha a jövőben a bot is támogatja a pause-flag-et (pl. a
   * `Bot.subscribe` payloadjában), ez a provider egyszerűen
   * továbbítja azt.
   *
   * Phase 39 (Fix #39: TUI responsiveness): a `setPaused` is
   * őrzi a snapshot referenciát — ha a `paused` flag már az új
   * értéken van, nem cserélünk referenciát ÉS nem notify-olunk.
   * (Korábban mindig új objektumot építettünk és notify-oltunk,
   * ami a `useSyncExternalStore` referenciákon alapuló change-
   * detection-jét félrevezette.)
   */
  public setPaused(paused: boolean): void {
    if (this.currentState.paused === paused) {
      return;
    }
    this.currentState = { ...this.currentState, paused };
    this.notifyListeners();
  }

  /**
   * `setEngineError` — a TUI-t értesíti, hogy a bot engine
   * elszállt (vagy épp helyreállt). A `state.status.engineError`
   * mezőt állítja, amit a TUI Header komponense külön sárga
   * warning-sorban + piros [● CRASHED] badge-ben jelenít meg.
   *
   * Phase 43 Track 2: a korábbi implementációban a
   * `botStartPromise.catch()` a hibát csak a `console.error`-ba
   * írta, a TUI-ban nem jelent meg. A user a [● STOPPED] badge-et
   * látta + "press [s] to start" üzenetet, miközben a bot valójában
   * AZONNAL összeomlott. A fix: a `startCommand` a hibát
   * `provider.setEngineError(message)` hívással a TUI-ba is eljuttatja.
   *
   * A metódus idempotens: ha az új message ugyanaz, mint a jelenlegi
   * (vagy mindkettő null), nem cserélünk referenciát és nem notify-olunk.
   * A `null` message a hiba törlését jelenti (pl. a user [s]-t nyomott
   * a bot újraindításához).
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
  }

  /**
   * `dispose` — a TUI kilépéskor hívja.
   *
   * A `BotStateProvider` interfész `Promise<void>` visszatérési
   * típust ír elő, ezért `async` — a jelenlegi implementációban
   * nincs `await`. Az unsubscribe és a listener-takarítás szinkron.
   */
  // eslint-disable-next-line @typescript-eslint/require-await
  public async dispose(): Promise<void> {
    this.unsubscribeFromBot();
    this.listeners.clear();
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
   * az enabled symbol-okra (a `LiveTradingPanel` sub-panel-jéhez).
   */
  private onEngineStateChanged(engineState: EngineBotState): void {
    this.lastEngineState = engineState;
    // Ticker-event-ek generálása a friss engine state-ből.
    this.synthesizeTickerEvents(engineState);
    this.refreshFromBot();
  }

  /**
   * `synthesizeTickerEvents` — a `LiveBotStateProvider` NEM kap
   * valós ticker-stream-et a Bot-tól (a feed a Bot-on belül fut, és
   * a `BotState` csak a position-öket exponálja). Helyette minden
   * engine-notifykor generálunk egy-egy synthetic TickerEvent-et az
   * enabled symbol-okra, a position currentPrice (vagy 0) alapján.
   *
   * A `volume` a position notional-ja, vagy 0 ha nincs pozíció.
   * Ez a synthetic event-faed nem "valódi" market volume, de a
   * `LiveTradingPanel` sub-panelje számára megfelelő — a user
   * láthatja, hogy a feed aktív, és az utolsó ismert árat.
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
   * alapján újraszámolja a TUI state-et, és notify-olja a TUI-t.
   *
   * Phase 38 Fix #38: a `state.running` a `botRunning` flag-et olvassa
   * (NEM az `active`-et). A `state.status.engineAvailable` és
   * `state.status.connected` az `active` flag-et olvassa (a provider
   * csatlakoztatva van-e a bot notify-folyamhoz). A kettő ELTÉRHET:
   * a provider aktív (figyel), de a bot még nem fut (stopped state).
   *
   * Phase 39 Fix #39 (TUI responsiveness): összehasonlítjuk a JELENLEGIT az
   * ÚJ state-tel mély egyenlőséggel (`stateEquals`). Ha minden mező
   * megegyezik, NEM cseréljük a referenciát ÉS NEM hívunk
   * notifyListeners()-t. Ha bármi változott, új referenciát építünk és
   * notify-olunk. Ez megakadályozza, hogy a `useSyncExternalStore`
   * felesleges re-rendert triggereljen (ami a `useInput` callback closure-jét
   * instabillá tenné), ÉS a keypress handler elvesztéséhez vezetne
   * magas notification rate esetén. A `lastUpdate` timestamp KIHAGYÁSA
   * az összehasonlításból: az minden híváskor más (Date.now()), de a UI-t
   * nem érdekli a ms-pontos update idő.
   */
  private refreshFromBot(): void {
    const engine = this.lastEngineState;
    const now = Date.now();

    if (engine === null) {
      // A bot még nem adott state-et — induló state frissítése.
      // A tickers-et a symbol-order alapján építjük (még ha nincs
      // is rájuk pozíció — a TUI ticker-panelje azonnal mutatja
      // a bot által figyelt symbol-okat, price=0 placeholder-rel).
      const tickers = buildTickers([], this.tickerSymbolOrder);
      const candidate: TuiBotState = {
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
      };
      if (stateEqualsIgnoringTimestamp(this.currentState, candidate)) {
        // Nincs változás — ne cseréljük a referenciát, ne notify-oljunk.
        // A lastUpdate itt szándékosan kimarad (UI-nak nem kell ms-pontosság).
        return;
      }
      this.currentState = candidate;
      this.notifyListeners();
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

    const candidate: TuiBotState = {
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
      paused: this.currentState.paused,
      killSwitchThresholdPct: this.currentState.killSwitchThresholdPct,
    };
    if (stateEqualsIgnoringTimestamp(this.currentState, candidate)) {
      // A status.lastUpdate ms-enként változna, de a UI-t nem érdekli —
      // a többi mező (positions, history, statistics, tickers) referenciája
      // is csak a tényleges változásnál cserélődik. Ha minden más egyezik,
      // nem cserélünk referenciát és nem notify-olunk.
      return;
    }
    this.currentState = candidate;
    this.notifyListeners();
  }

  /**
   * `notifyListeners` — a TUI listener-eit értesíti a state-változásról.
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
  // Tesztelési segédletek (a wire-up probe-hoz)
  // --------------------------------------------------------------------------

  /**
   * `getLastEngineState` — a legutolsó bot `BotState`, amit a provider
   * látott. A wire-up probe teszt ezzel ellenőrzi, hogy a provider
   * TÉNYLEGESEN kapja-e a bot frissítéseit.
   */
  public getLastEngineState(): EngineBotState | null {
    return this.lastEngineState;
  }
}
