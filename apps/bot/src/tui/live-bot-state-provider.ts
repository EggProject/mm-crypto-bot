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
 *   status.engineAvailable   │ running flag
 *   status.engineError       │ null
 *   status.connected         │ running flag
 *   status.lastUpdate        │ Date.now() a notify időpontjában
 *   running                  │ saját running flag
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
  private running = false;
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
   * csak a provider belső state-jét inicializálja.
   *
   * A `BotStateProvider` interfész `Promise<void>` visszatérési
   * típust ír elő, ezért `async` — a jelenlegi implementációban
   * nincs `await`. A Bot.subscribe szinkron, így nem kell await.
   */
  // eslint-disable-next-line @typescript-eslint/require-await
  public async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
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
   */
  public async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;
    this.unsubscribeFromBot();
    try {
      await this.bot.stop();
    } catch {
      // A bot leállítása nem kritikus.
    }
    this.refreshFromBot();
  }

  /**
   * `killSwitch` — a TUI-ból jövő vészleállító. A botot leállítja,
   * a kill-switch state-et `triggered`-re állítja.
   */
  public async killSwitch(): Promise<void> {
    this.killSwitchState = "triggered";
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
   */
  public setKillSwitchState(state: KillSwitchState): void {
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
   */
  public setPaused(paused: boolean): void {
    this.currentState = { ...this.currentState, paused };
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
      this.currentState = {
        ...this.currentState,
        running: this.running,
        killSwitch: this.killSwitchState,
        status: {
          ...this.currentState.status,
          mode: "with-bot",
          engineAvailable: this.running,
          engineError: null,
          connected: this.running,
          lastUpdate: now,
        },
        tickers,
        tickerEvents: this.tickerEventBuffer.slice(),
      };
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

    this.currentState = {
      status: {
        mode: "with-bot",
        engineAvailable: this.running,
        engineError: null,
        connected: this.running,
        lastUpdate: now,
      },
      running: this.running,
      killSwitch: this.killSwitchState,
      positions,
      statistics,
      history,
      tickers,
      tickerEvents: this.tickerEventBuffer.slice(),
      paused: this.currentState.paused,
      killSwitchThresholdPct: this.currentState.killSwitchThresholdPct,
    };
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
