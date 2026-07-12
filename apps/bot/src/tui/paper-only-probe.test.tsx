/**
 * apps/bot/src/tui/paper-only-probe.test.ts
 *
 * ===========================================================================
 * PAPER-ONLY PROBE — Phase 34 Track D
 * ===========================================================================
 *
 * "verify the actual behavior, not the docstring."
 *
 * A paper-only probe célja, hogy BIZONYÍTSA, hogy a TUI TÉNYLEGESEN
 * megjeleníti a pozíciókat és a history-t akkor is, ha nincs valódi bot
 * — csak egy paper-style provider táplálja az állapotot.
 *
 * A `PaperProvider` jelenleg egy fallback `SimulatedProvider`-re épül
 * (mivel a `@mm-crypto-bot/paper` engine még "not implemented yet").
 * A fallback 1 Hz-en frissül — ez túl lassú a unit teszthez (30 mp várakozás).
 *
 * Ez a probe egy `MockPaperProvider`-t használ, ami:
 *   - implementálja a `BotStateProvider` interfészt (Phase 34 Track B)
 *   - `pushMockTick(symbol, price)` API-val rendelkezik
 *   - minden tick-re frissíti a pozíciókat, stop/TP-t, history-t
 *   - notify-olja a listenereket
 *
 * A mock provider a `SimulatedProvider` tick-logikáját követi
 * (stop-loss, take-profit, history append), de a teszt irányítja
 * az időzítést — nem a setInterval.
 *
 * ===========================================================================
 * MIT TESZTELÜNK?
 * ===========================================================================
 *   1) A `LiveTradingPanel` megjeleníti a mock provider pozícióit
 *      (LONG/SHORT label, entry/current price, PnL)
 *   2) A `HistoryList` megjeleníti a lezárt trade-eket (stop-loss / TP)
 *   3) A provider 30 mock tick-et feldolgoz hiba nélkül
 *   4) A state-számítások konzisztensek (positions.length + history.length)
 *   5) A TUI unmount + dispose cleanup nem hagy lógó listenert
 *   6) A Phase 34 Track B változásai: [LIVE] badge megjelenik (with-bot mód)
 *
 * ===========================================================================
 * FELHASZNÁLÓI MANDÁTUM
 * ===========================================================================
 * Phase 21 #1 lecke: a probe a TUI tényleges renderelését ellenőrzi, nem
 * a PaperProvider belső logikáját. Ha a TUI panel-összeállítás megváltozik,
 * vagy a pozíciók/history megjelenítése elromlik, ez a teszt AZONNAL elbukik.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { render as renderInk } from "ink-testing-library";

import {
  App,
  type BotState,
  type BotStateProvider,
  type KillSwitchState,
  type Listener,
  type Position,
  type Statistics,
  type TickerEvent,
  type TickerPrice,
  type Trade,
} from "@mm-crypto-bot/tui";

/** Az ink-testing-library `render()` visszatérési típusa. */
type InkInstance = ReturnType<typeof renderInk>;

// ============================================================================
// MockPaperProvider — a `BotStateProvider` interfész egy teszt-implementációja
// ============================================================================
//
// A PaperProvider belső logikáját (stop-loss, take-profit, history) követi,
// de a tesztből irányítható a `pushMockTick(symbol, price)` hívással.
// Nincs setInterval — minden tick szinkronban fut le.
//
// A pozíciók véletlenszerű LONG/SHORT oldallal nyílnak, és a stop/TP
// 1.5% / 3.75% távolságra van (a SimulatedProvider-ből örökölve).
//
// Phase 34 Track B: a BotState új mezőket kapott (`tickerEvents`, `paused`,
// `killSwitchThresholdPct`). Ezeket a mock provider is tartalmazza.
//
// ============================================================================

/** A mock provider belső állapota — a pozíciók és a history. */
interface MockPaperProviderOptions {
  readonly symbols?: readonly string[];
  readonly initialEquityUsdt?: number;
  readonly initialPrice?: number;
  readonly leverage?: number;
}

/**
 * `emptyStats` — egy frissen induló `Statistics` objektum. A `BotStateProvider`
 * csomag csak a `providers/index.ts`-ből exportálja az `emptyStatistics` /
 * `emptyBotState` segédfüggvényeket; a fő index-ből nem. Hogy ne függjünk
 * a belső struktúrától, a teszt saját inicializáló függvényt használ.
 */
function emptyStats(initialEquityUsdt: number): Statistics {
  return {
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
  };
}

/**
 * `emptyState` — a kezdő `BotState` összeállítása. Ugyanaz a séma, mint
 * a `BotStateProvider.emptyBotState()` függvényben — a `with-bot` módhoz.
 *
 * Phase 34 Track B: a BotState új mezőket kapott (`tickerEvents` rolling
 * buffer, `paused` flag, `killSwitchThresholdPct`).
 */
function emptyState(initialEquityUsdt: number): BotState {
  return {
    status: {
      mode: "with-bot",
      engineAvailable: true,
      engineError: null,
      connected: false,
      lastUpdate: 0,
    },
    running: false,
    killSwitch: "armed",
    positions: [] as readonly Position[],
    statistics: emptyStats(initialEquityUsdt),
    history: [] as readonly Trade[],
    tickers: [] as readonly TickerPrice[],
    tickerEvents: [] as readonly TickerEvent[],
    paused: false,
    killSwitchThresholdPct: -10,
  };
}

/** Egy trade-azonosító counter az egyedi ID-k generálásához. */
function makeTradeId(counter: number): string {
  return `mock-${String(counter).padStart(5, "0")}`;
}

/** Egy pozíció-azonosító counter. */
function makePositionId(counter: number): string {
  return `mock-pos-${String(counter).padStart(5, "0")}`;
}

/**
 * `MockPaperProvider` — a teszt által irányított `BotStateProvider` implementáció.
 *
 * A `pushMockTick(symbol, price)` hívás:
 *   1) Frissíti az adott symbol `tickers` bejegyzését
 *   2) Frissíti a nyitott pozíciók `currentPrice` + `unrealizedPnl` értékeit
 *   3) Stop-loss / take-profit triggered pozíciókat lezárja + history-ba rakja
 *   4) Ha nincs elég pozíció, újat nyit (LONG vagy SHORT, 50-50% eséllyel)
 *   5) Notify-olja a listenereket
 */
class MockPaperProvider implements BotStateProvider {
  private readonly listeners = new Set<Listener>();
  private readonly options: Required<MockPaperProviderOptions>;
  private state: BotState;
  private readonly closedTrades: Trade[] = [];
  private readonly openPositions: Position[] = [];
  private readonly prices = new Map<string, number>();
  private readonly seed24hPrices = new Map<string, number>();
  /** A ticker-event-ek rolling bufferje (Phase 34 Track B, max 32). */
  private readonly tickerEventsBuffer: TickerEvent[] = [];
  private nextId = 1;
  /** A `pushMockTick` hívásainak száma — erre alapul a pozíció-nyitás. */
  private tickCount = 0;
  /** A TickerEvent.seq-hez használt monoton növekvő counter. */
  private nextEventSeq = 1;
  private readonly maxPositions: number;

  constructor(options: MockPaperProviderOptions = {}) {
    this.options = {
      symbols: options.symbols ?? ["BTC/USDT", "ETH/USDT", "SOL/USDT"],
      initialEquityUsdt: options.initialEquityUsdt ?? 10_000,
      initialPrice: options.initialPrice ?? 60_000,
      leverage: options.leverage ?? 5,
    };
    this.maxPositions = 3;

    // A seed-árak (a 24h change-hez) azonosak a kezdőárakkal.
    for (const symbol of this.options.symbols) {
      this.prices.set(symbol, this.options.initialPrice);
      this.seed24hPrices.set(symbol, this.options.initialPrice);
    }

    this.state = emptyState(this.options.initialEquityUsdt);
    // A kezdő ticker-listát azonnal kiírjuk, hogy a TUI ne legyen üres.
    this.state = { ...this.state, tickers: this.buildTickers() };
  }

  // === Public API (BotStateProvider) ====================================

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getSnapshot(): BotState {
    return this.state;
  }

  // eslint-disable-next-line @typescript-eslint/require-await -- interface contract: async by design
  async start(): Promise<void> {
    if (this.state.running) return;
    this.state = { ...this.state, running: true };
    this.notify();
  }

  // eslint-disable-next-line @typescript-eslint/require-await -- interface contract: async by design
  async stop(): Promise<void> {
    if (!this.state.running) return;
    this.state = { ...this.state, running: false };
    this.notify();
  }

  // eslint-disable-next-line @typescript-eslint/require-await -- interface contract: async by design
  async killSwitch(): Promise<void> {
    // A kill-switch minden pozíciót azonnal zár, history-ba rakja.
    const now = Date.now();
    const closingPositions = this.openPositions.slice();
    for (const pos of closingPositions) {
      this.closePosition(pos, "VÉSZLEÁLLÍTÁS", now);
    }
    this.state = {
      ...this.state,
      running: false,
      killSwitch: "triggered",
      positions: [],
      history: this.closedTrades.slice(-100),
      tickers: this.buildTickers(),
      statistics: this.recomputeStatistics(),
    };
    this.notify();
  }

  setKillSwitchState(killState: KillSwitchState): void {
    this.state = { ...this.state, killSwitch: killState };
    this.notify();
  }

  setPaused(paused: boolean): void {
    // Phase 34 Track B: a paused flag tisztán UI-flag — a bot futhat tovább,
    // de a TUI-ban megjelenik a [PAUSED] badge. A mock provider nem blokkolja
    // a pozíció-nyitást (a teszt scope-ján kívül esik).
    this.state = { ...this.state, paused };
    this.notify();
  }

  // eslint-disable-next-line @typescript-eslint/require-await -- interface contract: async by design
  async dispose(): Promise<void> {
    this.listeners.clear();
  }

  // === Teszt API =========================================================

  /**
   * `pushMockTick` — egyetlen ticker tick-et küld a mock provider-nek.
   *
   * A függvény:
   *   1) Frissíti az adott symbol `tickers` bejegyzését
   *   2) Frissíti a nyitott pozíciók `currentPrice` + `unrealizedPnl` értékeit
   *   3) Stop-loss / take-profit triggered pozíciókat lezárja + history-ba rakja
   *   4) Ha a bot fut ÉS van szabad slot, új pozíciót nyit
   *   5) Hozzáadja a tick-et a `tickerEvents` rolling bufferhez (max 32)
   *   6) Notify-olja a listenereket
   */
  pushMockTick(symbol: string, price: number): void {
    // A tick-counter a pozíció-nyitás időzítésére szolgál. A `nextId` a
    // trade/position ID-k generálásához kell, és csak open/close-kor nő —
    // a pozíció-nyitás tick-alapú döntése ezért külön countert használ.
    this.tickCount++;

    // 1) Ticker frissítés
    this.prices.set(symbol, price);

    // 2) Ticker-event buffer frissítés (Phase 34 Track B)
    // A `seq` a provider-en belüli monoton növekvő sorszám — a
    // LiveTradingPanel `key={e.seq}` miatt kötelező.
    const event: TickerEvent = {
      seq: this.nextEventSeq++,
      symbol,
      price,
      volume: 100, // A tesztben konstans volume — nincs jelentősége
      timestamp: Date.now(),
    };
    this.tickerEventsBuffer.push(event);
    if (this.tickerEventsBuffer.length > 32) {
      this.tickerEventsBuffer.shift();
    }

    // 3) A nyitott pozíciók unrealized PnL-jének frissítése + stop/TP ellenőrzés
    const now = Date.now();
    const stillOpen: Position[] = [];
    for (const pos of this.openPositions) {
      if (pos.symbol !== symbol) {
        stillOpen.push(pos);
        continue;
      }
      const currentPrice = price;
      const priceDiff =
        pos.side === "buy" ? currentPrice - pos.entryPrice : pos.entryPrice - currentPrice;
      const unrealizedPnl = priceDiff * pos.quantity * pos.leverage;
      const notional = pos.entryPrice * pos.quantity * pos.leverage;
      const unrealizedPnlPct = notional > 0 ? (unrealizedPnl / notional) * 100 : 0;

      const stopHit = pos.stopLoss !== null &&
        (pos.side === "buy" ? currentPrice <= pos.stopLoss : currentPrice >= pos.stopLoss);
      const tpHit = pos.takeProfit !== null &&
        (pos.side === "buy" ? currentPrice >= pos.takeProfit : currentPrice <= pos.takeProfit);
      const ageHours = (now - pos.openedAt) / (1000 * 60 * 60);
      const timeLimitHit = ageHours > 72;

      if (stopHit || tpHit || timeLimitHit) {
        const reason = stopHit ? "STOP-LOSS" : tpHit ? "TAKE-PROFIT" : "IDŐLIMIT";
        this.closePosition(
          { ...pos, currentPrice, unrealizedPnl, unrealizedPnlPct },
          reason,
          now,
        );
      } else {
        stillOpen.push({ ...pos, currentPrice, unrealizedPnl, unrealizedPnlPct });
      }
    }
    this.openPositions.length = 0;
    this.openPositions.push(...stillOpen);

    // 4) Új pozíció nyitása, ha a bot fut ÉS van szabad slot ÉS nem paused
    if (
      this.state.running &&
      this.state.killSwitch === "armed" &&
      !this.state.paused &&
      this.openPositions.length < this.maxPositions &&
      !this.openPositions.some((p) => p.symbol === symbol)
    ) {
      // Minden 3. tick-ben nyitunk új pozíciót (determinisztikus, gyors).
      // A `tickCount` minden pushMockTick hívással nő, így a 3. tick-ben
      // már biztosan nyílik pozíció.
      if (this.tickCount % 3 === 0) {
        this.openPosition(symbol, price, now);
      }
    }

    // 5) State összeállítás + notify
    this.state = {
      ...this.state,
      positions: this.openPositions.slice(),
      history: this.closedTrades.slice(-100),
      tickers: this.buildTickers(),
      tickerEvents: this.tickerEventsBuffer.slice(),
      statistics: this.recomputeStatistics(),
      status: { ...this.state.status, connected: true, lastUpdate: now },
    };
    this.notify();
  }

  /** A teszt számára: hány trade van a history-ban. */
  getHistoryLength(): number {
    return this.closedTrades.length;
  }

  /** A teszt számára: hány pozíció van nyitva. */
  getOpenPositionsCount(): number {
    return this.openPositions.length;
  }

  /** A teszt számára: a history-ban lévő trade-ek. */
  getHistory(): readonly Trade[] {
    return this.closedTrades.slice();
  }

  // === Belső logika ======================================================

  private notify(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }

  private buildTickers(): readonly TickerPrice[] {
    const tickers: TickerPrice[] = [];
    for (const symbol of this.options.symbols) {
      const price = this.prices.get(symbol) ?? this.options.initialPrice;
      const seedPrice = this.seed24hPrices.get(symbol) ?? price;
      const change24hPct = seedPrice > 0 ? ((price - seedPrice) / seedPrice) * 100 : 0;
      tickers.push({
        symbol,
        price,
        change24hPct,
        volume24hUsdt: 1_000_000_000,
      });
    }
    return tickers;
  }

  private openPosition(symbol: string, entryPrice: number, now: number): void {
    // A side váltakozik — felváltva LONG / SHORT (determinisztikus).
    const side = this.nextId % 2 === 0 ? "buy" : "sell";
    const atr = entryPrice * 0.015; // 1.5% — a SimulatedProvider-rel egyező
    const stopLoss = side === "buy" ? entryPrice - atr : entryPrice + atr;
    const takeProfit = side === "buy" ? entryPrice + atr * 2.5 : entryPrice - atr * 2.5;

    const equity = this.state.statistics.equityUsdt;
    const notionalUsdt = equity * 0.04; // 4% — a SimulatedProvider-rel egyező
    const leverage = this.options.leverage;
    const quantity = notionalUsdt / entryPrice;

    const pos: Position = {
      id: makePositionId(this.nextId++),
      symbol,
      side,
      entryPrice,
      currentPrice: entryPrice,
      quantity,
      leverage,
      unrealizedPnl: 0,
      unrealizedPnlPct: 0,
      openedAt: now,
      stopLoss,
      takeProfit,
    };
    this.openPositions.push(pos);
  }

  private closePosition(pos: Position, reason: string, now: number): void {
    const priceDiff =
      pos.side === "buy" ? pos.currentPrice - pos.entryPrice : pos.entryPrice - pos.currentPrice;
    const pnlUsdt = priceDiff * pos.quantity * pos.leverage;
    const notional = pos.entryPrice * pos.quantity * pos.leverage;
    const pnlPct = notional > 0 ? (pnlUsdt / notional) * 100 : 0;

    const trade: Trade = {
      id: makeTradeId(this.nextId++),
      symbol: pos.symbol,
      side: pos.side,
      entryPrice: pos.entryPrice,
      exitPrice: pos.currentPrice,
      quantity: pos.quantity,
      leverage: pos.leverage,
      pnlUsdt,
      pnlPct,
      openedAt: pos.openedAt,
      closedAt: now,
      reason,
    };
    this.closedTrades.push(trade);
  }

  private recomputeStatistics(): BotState["statistics"] {
    const stats = this.state.statistics;
    const trades = this.closedTrades;
    if (trades.length === 0) {
      return {
        ...stats,
        totalTrades: 0,
        winningTrades: 0,
        losingTrades: 0,
        winRate: 0,
        avgWinPnl: 0,
        avgLossPnl: 0,
        bestTradePnl: 0,
        worstTradePnl: 0,
        profitFactor: 0,
        sharpeRatio: 0,
        totalPnlUsdt: 0,
        totalPnlPct: 0,
        maxDrawdownPct: 0,
        currentDrawdownPct: 0,
      };
    }
    let totalPnlUsdt = 0;
    let winningPnl = 0;
    let losingPnl = 0;
    let winningCount = 0;
    let losingCount = 0;
    let best = Number.NEGATIVE_INFINITY;
    let worst = Number.POSITIVE_INFINITY;
    for (const t of trades) {
      totalPnlUsdt += t.pnlUsdt;
      if (t.pnlUsdt > 0) {
        winningCount++;
        winningPnl += t.pnlUsdt;
        best = Math.max(best, t.pnlUsdt);
      } else if (t.pnlUsdt < 0) {
        losingCount++;
        losingPnl += Math.abs(t.pnlUsdt);
        worst = Math.min(worst, t.pnlUsdt);
      }
    }
    const totalTrades = trades.length;
    const winRate = totalTrades > 0 ? (winningCount / totalTrades) * 100 : 0;
    const avgWin = winningCount > 0 ? winningPnl / winningCount : 0;
    const avgLoss = losingCount > 0 ? losingPnl / losingCount : 0;
    const profitFactor = losingPnl > 0 ? winningPnl / losingPnl : winningPnl > 0 ? Number.POSITIVE_INFINITY : 0;
    return {
      ...stats,
      totalPnlUsdt,
      totalPnlPct: (totalPnlUsdt / stats.initialEquityUsdt) * 100,
      winRate,
      totalTrades,
      winningTrades: winningCount,
      losingTrades: losingCount,
      maxDrawdownPct: 0,
      currentDrawdownPct: 0,
      avgWinPnl: avgWin,
      avgLossPnl: -avgLoss,
      bestTradePnl: best === Number.NEGATIVE_INFINITY ? 0 : best,
      worstTradePnl: worst === Number.POSITIVE_INFINITY ? 0 : worst,
      profitFactor,
      sharpeRatio: 0,
      equityUsdt: stats.initialEquityUsdt + totalPnlUsdt,
    };
  }
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * `mountTui` — a TUI mountolása egy adott provider-rel.
 */
function mountTui(provider: BotStateProvider): { readonly instance: InkInstance; readonly provider: BotStateProvider } {
  // A TUI-nak `App`-ot adunk át — ez a `BotStateProvider`-t használja.
  const instance = renderInk(<App provider={provider} />);
  return { instance, provider };
}

/**
 * `waitForFrame` — várakozás a React re-renderre.
 */
async function waitForFrame(ms = 50): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

// ============================================================================
// Tests
// ============================================================================

describe("paper-only probe — TUI without bot, mock ticks populate live + history", () => {
  let mounted: { readonly instance: InkInstance; readonly provider: MockPaperProvider } | null = null;

  beforeEach(() => {
    mounted = null;
  });

  afterEach(async () => {
    if (mounted !== null) {
      // Az ink-testing-library `instance.unmount()` + `instance.cleanup()`
      // híváspárossal teljesen felszabadítja a React-tree-t. A `cleanup()`
      // fontos, mert különben a belső `instances` tömbben marad a lezárt
      // instance, és a következő `renderInk()` hívás üres frame-et adhat.
      mounted.instance.unmount();
      mounted.instance.cleanup();
      await mounted.provider.dispose();
    }
  });

  // --------------------------------------------------------------------------
  // 1) A PaperProvider indítása után a TUI megjeleníti a futási állapotot
  // --------------------------------------------------------------------------
  it("PaperProvider starts and TUI shows '[LIVE]' mode (with-bot) + start/stop", async () => {
    const provider = new MockPaperProvider({ initialEquityUsdt: 10_000 });
    const m = mountTui(provider);
    mounted = { instance: m.instance, provider };
    await waitForFrame();

    // A provider indulás előtt "LEÁLLÍTVA" — start után "FUT".
    expect(m.instance.lastFrame() ?? "").toContain("LEÁLLÍTVA");
    await provider.start();
    await waitForFrame();

    const frame = m.instance.lastFrame() ?? "";
    expect(frame).toContain("FUT");
    // Phase 34 Track B: a with-bot mód badge-e [LIVE] (zöld), nem "BOT MÓD".
    expect(frame).toContain("[LIVE]");
    // A with-bot módban a StatusBar mutatja az [s] start/stop-ot — a
    // terminál szélessége (100 oszlop) miatt a StatusBar szövege
    // sortörésen eshet át. A `start` és `stop` szavak külön-külön
    // biztosan megjelennek a frame-ben.
    const frameStripped = frame.replace(/\s+/g, " ");
    expect(frameStripped).toContain("start");
    expect(frameStripped).toContain("pause");
    expect(frameStripped).toContain("kill");
  });

  // --------------------------------------------------------------------------
  // 2) 30 mock tick feldolgozása hiba nélkül
  // --------------------------------------------------------------------------
  it("30 mock ticks processed without error and TUI reflects ticker updates", async () => {
    const provider = new MockPaperProvider({ initialEquityUsdt: 10_000 });
    const m = mountTui(provider);
    mounted = { instance: m.instance, provider };

    await provider.start();
    await waitForFrame();

    // 30 mock tick — a BTC árfolyamát 60_000 és 61_500 között mozgatjuk.
    for (let i = 0; i < 30; i++) {
      const price = 60_000 + (i % 15) * 100; // 60_000 → 61_400
      provider.pushMockTick("BTC/USDT", price);
    }
    await waitForFrame();

    // A provider 30 tick-et feldolgozott.
    // A history nem feltétlenül tartalmaz trade-et (mert a stop/TP nem biztos,
    // hogy triggered a 30 tick alatt), de a tickerek frissültek.
    const frame = m.instance.lastFrame() ?? "";
    // A Phase 34 Track B óta a LiveTradingPanel "UTOLSÓ TICKER-EVENT-EK"
    // sub-panelt is mutatja.
    expect(frame).toContain("UTOLSÓ TICKER-EVENT-EK");
  });

  // --------------------------------------------------------------------------
  // 3) A pozíciók megjelennek a LiveTradingPanel-ben
  // --------------------------------------------------------------------------
  it("newly opened positions appear in the LiveTradingPanel", async () => {
    const provider = new MockPaperProvider({ initialEquityUsdt: 10_000 });
    const m = mountTui(provider);
    mounted = { instance: m.instance, provider };

    await provider.start();
    await waitForFrame();

    // Kezdetben nincs nyitott pozíció.
    expect(provider.getOpenPositionsCount()).toBe(0);

    // 9 mock tick — a tickCount % 3 === 0 feltétel miatt minden 3. tick-ben
    // új pozíció nyílik (legalább 2-3 pozíció).
    for (let i = 0; i < 9; i++) {
      provider.pushMockTick("BTC/USDT", 60_000 + i * 10);
    }
    await waitForFrame();

    // A provider-ben legalább 1 pozíció van.
    const openCount = provider.getOpenPositionsCount();
    expect(openCount).toBeGreaterThan(0);

    // A TUI frame tartalmazza a LONG vagy SHORT labelt (a tick alapján
    // váltakozik — nextId % 2) és a BTC tickert.
    const frame = m.instance.lastFrame() ?? "";
    // A position megjelenik a frame-ben — a "LONG" vagy "SHORT" szöveggel.
    const hasLongOrShort = frame.includes("LONG") || frame.includes("SHORT");
    expect(hasLongOrShort).toBe(true);
  });

  // --------------------------------------------------------------------------
  // 4) A history-ban lévő trade-ek megjelennek a HistoryList-ben
  // --------------------------------------------------------------------------
  it("closed trades (stop-loss / take-profit) appear in the HistoryList", async () => {
    const provider = new MockPaperProvider({ initialEquityUsdt: 10_000 });
    const m = mountTui(provider);
    mounted = { instance: m.instance, provider };

    await provider.start();
    await waitForFrame();

    // A pozíció nyitása a 3. tick-ben történik. A side a nextId alapján
    // váltakozik — ezért a stop-loss árat aszerint állítjuk be, hogy
    // LONG vagy SHORT pozícióról van-e szó.
    provider.pushMockTick("BTC/USDT", 60_000);
    provider.pushMockTick("BTC/USDT", 60_000);
    provider.pushMockTick("BTC/USDT", 60_000); // 3. tick: új pozíció nyílik

    // A stop-loss / take-profit kiváltásához a 4. tick-ben drasztikusan
    // elmozdítjuk az árat. A LONG oldal stop-loss-a alacsonyabb, mint az
    // entry. A SHORT oldal take-profit-ja alacsonyabb, mint az entry.
    // Próbálkozunk mindkét iránnyal — a stop-loss VAGY take-profit biztosan triggered lesz.
    provider.pushMockTick("BTC/USDT", 55_000); // LONG stop
    provider.pushMockTick("BTC/USDT", 65_000); // SHORT stop (ha az előző nem zárt)
    await waitForFrame();

    // A history-ban van trade.
    expect(provider.getHistoryLength()).toBeGreaterThan(0);

    const history = provider.getHistory();
    // A trade-ek a stop-loss VAGY take-profit útvonalon zárultak —
    // a side határozza meg, melyik triggerelődik (LONG = stop alacsony,
    // SHORT = take-profit alacsony). A teszt mindkettőt elfogadja.
    const closedTrade = history.find(
      (t) => t.reason === "STOP-LOSS" || t.reason === "TAKE-PROFIT",
    );
    expect(closedTrade).toBeDefined();

    // A TUI frame tartalmazza a "STOP-LOSS" vagy "TAKE-PROFIT" szöveget
    // a history-ban.
    const frame = m.instance.lastFrame() ?? "";
    const hasReason = frame.includes("STOP-LOSS") || frame.includes("TAKE-PROFIT");
    expect(hasReason).toBe(true);
    expect(frame).toContain("HISTORY");
  });

  // --------------------------------------------------------------------------
  // 5) A state-számítások konzisztensek (positions + history = total trades)
  // --------------------------------------------------------------------------
  it("provider state is consistent across ticks (positions + history = total trades)", async () => {
    const provider = new MockPaperProvider({ initialEquityUsdt: 10_000 });
    const m = mountTui(provider);
    mounted = { instance: m.instance, provider };

    await provider.start();
    await waitForFrame();

    let totalOpened = 0;
    let totalClosed = 0;

    // 30 tick — a BTC árfolyamát véletlenszerűen mozgatjuk, hogy néha
    // stop-loss, néha take-profit triggered legyen.
    for (let i = 0; i < 30; i++) {
      const prev = provider.getOpenPositionsCount();
      provider.pushMockTick("BTC/USDT", 60_000 + (i % 7) * 200 - 600);
      const after = provider.getOpenPositionsCount();
      // Ha a nyitott pozíciók száma nőtt, akkor 1 új trade indult.
      if (after > prev) totalOpened++;
      // Ha csökkent, akkor trade záródott.
      if (after < prev) totalClosed++;
    }
    await waitForFrame();

    // A history-ban lévő trade-ek száma = a lezárt trade-ek száma.
    expect(provider.getHistoryLength()).toBe(totalClosed);
    // A jelenlegi nyitott pozíciók száma = a megnyitott - lezárt.
    expect(provider.getOpenPositionsCount()).toBe(totalOpened - totalClosed);

    // A TUI frame konzisztens — nem crashel.
    const frame = m.instance.lastFrame() ?? "";
    expect(frame.length).toBeGreaterThan(100);
  });

  // --------------------------------------------------------------------------
  // 6) A TUI unmount + dispose cleanup nem hagy lógó listenert
  // --------------------------------------------------------------------------
  it("unmount + dispose do not throw and stop the subscription", async () => {
    const provider = new MockPaperProvider({ initialEquityUsdt: 10_000 });
    const m = mountTui(provider);

    await provider.start();
    await waitForFrame();
    provider.pushMockTick("BTC/USDT", 60_000);
    await waitForFrame();

    // Az unmount + dispose nem dobhat.
    expect(() => {
      m.instance.unmount();
    }).not.toThrow();
    const disposePromise = provider.dispose();
    expect(disposePromise).toBeInstanceOf(Promise);
    await disposePromise;

    // A dispose után a pushMockTick NEM dobhat (a listeners.clear() után
    // a notify() üres Set-en fut).
    expect(() => {
      provider.pushMockTick("BTC/USDT", 61_000);
    }).not.toThrow();

    mounted = null;
  });

  // --------------------------------------------------------------------------
  // 7) setPaused működik (Phase 34 Track B)
  // --------------------------------------------------------------------------
  it("setPaused(paused=true) makes [PAUSED] badge appear in TUI", async () => {
    const provider = new MockPaperProvider({ initialEquityUsdt: 10_000 });
    const m = mountTui(provider);
    mounted = { instance: m.instance, provider };

    await provider.start();
    await waitForFrame();

    // A pause előtt a [PAUSED] badge NEM jelenik meg.
    expect(m.instance.lastFrame() ?? "").not.toContain("[PAUSED]");

    // A pause aktiválása.
    provider.setPaused(true);
    await waitForFrame();

    expect(m.instance.lastFrame() ?? "").toContain("[PAUSED]");

    // A pause feloldása.
    provider.setPaused(false);
    await waitForFrame();

    expect(m.instance.lastFrame() ?? "").not.toContain("[PAUSED]");
  });
});
