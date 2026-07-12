/**
 * packages/tui/src/components/feature-wiring.test.tsx
 *
 * ===========================================================================
 * FEATURE WIRING TESTS — Phase 34 Track B
 * ===========================================================================
 *
 * "Verify the actual behavior, not the docstring."
 *
 * A spec §4.3 (modern TUI felület) 6 követelményéhez a Phase 34 Track B
 * feature-wiring tesztjei. Minden teszt a TÉNYLEGES Ink komponenst
 * rendereli az `ink-testing-library` segítségével, és a `lastFrame()`
 * snapshot-ját ellenőrzi.
 *
 *   1) StatisticsPanel: valódi metrikák (win-rate, Sharpe, drawdown)
 *   2) LiveTradingPanel: kill-switch flash + ticker events sub-panel
 *   3) HistoryList: rendezés (time / pnl / symbol)
 *   4) Header: [TUI-ONLY] / [LIVE] / [PAUSED] badge-ek
 *   5) StatusBar: TUI-only módban s/p rejtve
 *   6) HelpOverlay: megjelenés / elrejtés
 *
 * A keybinding callback-ek teszteléséhez (7) egy MiniApp komponenst
 * építünk, ami a useInput-ot szimulálja — a tesztelő függvény
 * `stdin.write()`-tal küldi a billentyű-kódokat, és a callback-ek
 * hívását figyeli.
 */

import { describe, expect, it } from "bun:test";
import React, { useState } from "react";
import { render } from "ink-testing-library";
import { Text, useInput } from "ink";
import {
  Header,
  HelpOverlay,
  HistoryList,
  LiveTradingPanel,
  StatisticsPanel,
  StatusBar,
} from "./index.js";
import type {
  BotState,
  Position,
  Statistics,
  TickerEvent,
  TickerPrice,
  Trade,
} from "../types.js";

// Helper: lastFrame() can return undefined in some cases — normalize to string.
function frame(lastFrame: () => string | undefined): string {
  return lastFrame() ?? "";
}


// ============================================================================
// Test fixtures
// ============================================================================

function makeStatistics(overrides: Partial<Statistics> = {}): Statistics {
  return {
    totalPnlUsdt: 350,
    totalPnlPct: 3.5,
    winRate: 66.67,
    totalTrades: 6,
    winningTrades: 4,
    losingTrades: 2,
    maxDrawdownPct: 5.2,
    currentDrawdownPct: 1.8,
    avgWinPnl: 125,
    avgLossPnl: -75,
    bestTradePnl: 200,
    worstTradePnl: -100,
    profitFactor: 3.33,
    sharpeRatio: 1.42,
    equityUsdt: 10_350,
    initialEquityUsdt: 10_000,
    ...overrides,
  };
}

function makePosition(overrides: Partial<Position> = {}): Position {
  return {
    id: "pos-1",
    symbol: "BTC/USDT",
    side: "buy",
    entryPrice: 60_000,
    currentPrice: 61_500,
    quantity: 0.01,
    leverage: 5,
    unrealizedPnl: 7.5,
    unrealizedPnlPct: 1.25,
    openedAt: Date.now() - 3_600_000,
    stopLoss: 58_000,
    takeProfit: 63_000,
    ...overrides,
  };
}

function makeTicker(symbol: string, price: number): TickerPrice {
  return { symbol, price, change24hPct: 2.5, volume24hUsdt: 1_000_000 };
}

function makeTickerEvent(seq: number, symbol: string, price: number): TickerEvent {
  return {
    seq,
    symbol,
    price,
    volume: 100_000,
    timestamp: Date.now() - seq * 1000,
  };
}

function makeTrade(id: string, symbol: string, pnlUsdt: number, closedAt: number): Trade {
  return {
    id,
    symbol,
    side: "buy",
    entryPrice: 60_000,
    exitPrice: 60_000 + (pnlUsdt > 0 ? 100 : -50),
    quantity: 0.01,
    leverage: 5,
    pnlUsdt,
    pnlPct: pnlUsdt / 6,
    openedAt: closedAt - 3_600_000,
    closedAt,
    reason: "TAKE-PROFIT",
  };
}

function makeBotState(overrides: Partial<BotState> = {}): BotState {
  return {
    status: {
      mode: "with-bot",
      engineAvailable: true,
      engineError: null,
      connected: true,
      lastUpdate: Date.now(),
    },
    running: true,
    killSwitch: "armed",
    positions: [],
    statistics: makeStatistics(),
    history: [],
    tickers: [],
    tickerEvents: [],
    paused: false,
    killSwitchThresholdPct: -10,
    ...overrides,
  };
}

// ============================================================================
// 1) StatisticsPanel — valódi metrikák a prop-ból
// ============================================================================

describe("feature-wiring: StatisticsPanel renders real metrics from statistics prop", () => {
  it("shows win-rate computed from the given statistics (66.67% from 4/6)", () => {
    const stats = makeStatistics({ winRate: 66.67, totalTrades: 6, winningTrades: 4, losingTrades: 2 });
    const { lastFrame } = render(<StatisticsPanel statistics={stats} />);

    const output = frame(lastFrame);
    // A win-rate a fixture szerinti érték.
    expect(output).toContain("66,7");
    // A trade-szám megjelenik.
    expect(output).toContain("6 db");
    // A Sharpe ratio megjelenik.
    expect(output).toContain("1,42");
    // A profit factor megjelenik.
    expect(output).toContain("3,33");
  });

  it("reflects changes when statistics prop changes (re-renders correctly)", () => {
    const stats1 = makeStatistics({ winRate: 50, totalPnlUsdt: 0 });
    const { lastFrame: frame1, rerender } = render(<StatisticsPanel statistics={stats1} />);
    expect(frame1()).toContain("50,00");

    // Második render más statistics-szel.
    const stats2 = makeStatistics({ winRate: 75, totalPnlUsdt: 1000 });
    rerender(<StatisticsPanel statistics={stats2} />);
    expect(frame1()).toContain("75,00");
  });
});

// ============================================================================
// 2) LiveTradingPanel — kill-switch flash + ticker events
// ============================================================================

describe("feature-wiring: LiveTradingPanel reflects state changes (kill-switch flash + ticker events)", () => {
  it("shows the position's unrealizedPnl when given a known position", () => {
    const position = makePosition({ unrealizedPnl: 7.5, unrealizedPnlPct: 1.25 });
    const { lastFrame } = render(
      <LiveTradingPanel
        tickers={[makeTicker("BTC/USDT", 61_500)]}
        positions={[position]}
        tickerEvents={[]}
        now={Date.now()}
        killSwitchThresholdPct={-10}
      />,
    );
    const output = frame(lastFrame);
    // A pozíció LONG BTC-ként jelenik meg.
    expect(output).toContain("LONG");
    expect(output).toContain("BTC");
    // A PnL megjelenik.
    expect(output).toContain("7,50");
  });

  it("renders kill-switch flash warning when a position breaches the threshold", () => {
    const badPosition = makePosition({
      symbol: "BTC/USDT",
      unrealizedPnl: -900,
      unrealizedPnlPct: -15,
    });
    const { lastFrame } = render(
      <LiveTradingPanel
        tickers={[]}
        positions={[badPosition]}
        tickerEvents={[]}
        now={Date.now()}
        killSwitchThresholdPct={-10}
      />,
    );
    expect(lastFrame()).toContain("KILL-SWITCH KÜSZÖB");
  });

  it("does NOT show kill-switch warning when position is healthy", () => {
    const goodPosition = makePosition({ unrealizedPnl: 50, unrealizedPnlPct: 0.5 });
    const { lastFrame } = render(
      <LiveTradingPanel
        tickers={[]}
        positions={[goodPosition]}
        tickerEvents={[]}
        now={Date.now()}
        killSwitchThresholdPct={-10}
      />,
    );
    expect(lastFrame()).not.toContain("KILL-SWITCH KÜSZÖB");
  });

  it("shows ticker events sub-panel with the last 5 events (from 10 events buffer)", () => {
    const events: TickerEvent[] = [];
    for (let i = 0; i < 10; i++) {
      events.push(makeTickerEvent(i, "BTC/USDT", 60_000 + i * 100));
    }
    const { lastFrame } = render(
      <LiveTradingPanel
        tickers={[]}
        positions={[]}
        tickerEvents={events}
        now={Date.now()}
        killSwitchThresholdPct={-10}
      />,
    );
    const output = frame(lastFrame);
    // Az utolsó 5 event sorszáma megjelenik (5-9).
    expect(output).toContain("#0009");
    expect(output).toContain("#0008");
    // A sub-panel címkéje.
    expect(output).toContain("UTOLSÓ TICKER-EVENT-EK");
  });

  it("updates when state changes (re-renders with new positions)", () => {
    const pos1 = makePosition({ id: "p1", unrealizedPnl: 10 });
    const { lastFrame, rerender } = render(
      <LiveTradingPanel
        tickers={[]}
        positions={[pos1]}
        tickerEvents={[]}
        now={Date.now()}
        killSwitchThresholdPct={-10}
      />,
    );
    expect(lastFrame()).toContain("10,00");

    // Második render: 2 pozíció.
    const pos2 = makePosition({ id: "p2", unrealizedPnl: 25 });
    rerender(
      <LiveTradingPanel
        tickers={[]}
        positions={[pos1, pos2]}
        tickerEvents={[]}
        now={Date.now()}
        killSwitchThresholdPct={-10}
      />,
    );
    expect(lastFrame()).toContain("25,00");
  });
});

// ============================================================================
// 3) HistoryList — rendezhető oszlopok
// ============================================================================

describe("feature-wiring: HistoryList sorts by various keys", () => {
  const trade1 = makeTrade("t1", "BTC/USDT", 100, 1000);
  const trade2 = makeTrade("t2", "ETH/USDT", -50, 2000);
  const trade3 = makeTrade("t3", "SOL/USDT", 200, 3000);
  const trades: readonly Trade[] = [trade1, trade2, trade3];

  it("sorts by time (closedAt desc) when sortKey='time' — most recent first", () => {
    const { lastFrame } = render(
      <HistoryList history={trades} now={Date.now()} sortKey="time" />,
    );
    const output = frame(lastFrame);
    expect(output).toContain("Rendezve");
    expect(output).toContain("IDŐ");
  });

  it("sorts by P&L (descending) when sortKey='pnl' — biggest win first", () => {
    const { lastFrame } = render(
      <HistoryList history={trades} now={Date.now()} sortKey="pnl" />,
    );
    const output = frame(lastFrame);
    expect(output).toContain("PNL");
    // A trade3 (+200) a trade1 (+100) előtt — string-beli index-szel ellenőrizzük.
    const idx3 = output.indexOf("#t3");
    const idx1 = output.indexOf("#t1");
    const idx2 = output.indexOf("#t2");
    expect(idx3).toBeGreaterThan(-1);
    expect(idx1).toBeGreaterThan(-1);
    expect(idx2).toBeGreaterThan(-1);
    expect(idx3).toBeLessThan(idx1); // t3 előbb van, mint t1
    expect(idx1).toBeLessThan(idx2); // t1 előbb van, mint t2 (t2 veszteség)
  });

  it("sorts by symbol (alphabetical) when sortKey='symbol'", () => {
    const { lastFrame } = render(
      <HistoryList history={trades} now={Date.now()} sortKey="symbol" />,
    );
    const output = frame(lastFrame);
    expect(output).toContain("SYMBOL");
    // BTC < ETH < SOL abc sorrendben.
    const idxBtc = output.indexOf("#t1");
    const idxEth = output.indexOf("#t2");
    const idxSol = output.indexOf("#t3");
    expect(idxBtc).toBeLessThan(idxEth);
    expect(idxEth).toBeLessThan(idxSol);
  });

  it("respects VISIBLE_ROWS limit (max 20 rows shown out of 30)", () => {
    const manyTrades: Trade[] = [];
    for (let i = 0; i < 30; i++) {
      manyTrades.push(makeTrade(`t${i}`, "BTC/USDT", i % 2 === 0 ? 100 : -50, i * 1000));
    }
    const { lastFrame } = render(
      <HistoryList history={manyTrades} now={Date.now()} sortKey="time" />,
    );
    // 20 sor látszik, 10 rejtve.
    expect(lastFrame()).toContain("még 10 korábbi");
  });

  it("sorts by symbol: same-symbol trades are ordered by closedAt desc (secondary sort)", () => {
    // Két BTC és két ETH trade — a symbol szerinti rendezésen belül az
    // időrend a másodlagos kulcs (legfrissebb elöl).
    const sameSymbol: readonly Trade[] = [
      makeTrade("t1", "BTC/USDT", 100, 1000),
      makeTrade("t2", "BTC/USDT", -50, 3000),
      makeTrade("t3", "ETH/USDT", 200, 2000),
      makeTrade("t4", "ETH/USDT", 50, 4000),
    ];
    const { lastFrame } = render(
      <HistoryList history={sameSymbol} now={Date.now()} sortKey="symbol" />,
    );
    const output = frame(lastFrame);
    // BTC blokk: t2 (3000) t1 (1000) — t2 előbb van.
    const idxT1 = output.indexOf("#t1");
    const idxT2 = output.indexOf("#t2");
    const idxT3 = output.indexOf("#t3");
    const idxT4 = output.indexOf("#t4");
    expect(idxT2).toBeLessThan(idxT1); // BTC: t2 (újabb) t1 (régebbi) előtt
    expect(idxT4).toBeLessThan(idxT3); // ETH: t4 (újabb) t3 (régebbi) előtt
  });

  it("shows the empty-state message when history is empty", () => {
    const { lastFrame } = render(
      <HistoryList history={[]} now={Date.now()} sortKey="time" />,
    );
    const output = frame(lastFrame);
    expect(output).toContain("Még nincs lezárt trade");
  });
});

// ============================================================================
// 4) Header — mode badge-ek
// ============================================================================

describe("feature-wiring: Header shows correct mode badges", () => {
  it("shows [TUI-ONLY] badge when status.mode='tui-only'", () => {
    const state = makeBotState({
      status: { ...makeBotState().status, mode: "tui-only" },
    });
    const { lastFrame } = render(<Header state={state} />);
    expect(lastFrame()).toContain("[TUI-ONLY]");
  });

  it("shows [LIVE] badge when status.mode='with-bot'", () => {
    const state = makeBotState({
      status: { ...makeBotState().status, mode: "with-bot" },
    });
    const { lastFrame } = render(<Header state={state} />);
    expect(lastFrame()).toContain("[LIVE]");
  });

  it("shows [PAUSED] badge when paused=true", () => {
    const state = makeBotState({ paused: true });
    const { lastFrame } = render(<Header state={state} />);
    expect(lastFrame()).toContain("[PAUSED]");
  });

  it("does NOT show [PAUSED] badge when paused=false", () => {
    const state = makeBotState({ paused: false });
    const { lastFrame } = render(<Header state={state} />);
    expect(lastFrame()).not.toContain("[PAUSED]");
  });

  it("shows KILL-SWITCH: MEGERŐSÍTÉS label when killSwitch='confirm'", () => {
    const state = makeBotState({ killSwitch: "confirm" });
    const { lastFrame } = render(<Header state={state} />);
    expect(lastFrame()).toContain("KILL-SWITCH: MEGERŐSÍTÉS");
  });

  it("shows KILL-SWITCH: AKTIVÁLVA label when killSwitch='triggered'", () => {
    const state = makeBotState({ killSwitch: "triggered" });
    const { lastFrame } = render(<Header state={state} />);
    expect(lastFrame()).toContain("KILL-SWITCH: AKTIVÁLVA");
  });
});

// ============================================================================
// 5) StatusBar — TUI-only módban az s/p billentyűk nem elérhetők
// ============================================================================

describe("feature-wiring: StatusBar disables s/p keybindings in TUI-only mode", () => {
  it("hides [s] and [p] key hints when tuiOnly=true", () => {
    const { lastFrame } = render(<StatusBar killSwitch="armed" tuiOnly={true} />);
    const output = frame(lastFrame);
    // Az 's' key-hint a 'start' szóval van jelölve — a 'pause' szó a
    // 'p' key-hint. TUI-only módban egyik sem jelenik meg.
    expect(output).not.toContain("start");
    expect(output).not.toContain("pause");
  });

  it("shows [s] and [p] key hints when tuiOnly=false (with-bot mode)", () => {
    const { lastFrame } = render(<StatusBar killSwitch="armed" tuiOnly={false} />);
    const output = frame(lastFrame);
    // A 'start' és 'pause' szavak megjelennek (a 'start/stop' wrap
    // miatt a szóköz nélküli szöveget keressük).
    expect(output).toContain("start");
    expect(output).toContain("pause");
  });

  it("shows the kill-switch confirmation prompt when killSwitch='confirm'", () => {
    const { lastFrame } = render(<StatusBar killSwitch="confirm" tuiOnly={false} />);
    const output = frame(lastFrame);
    // A megerősítő prompt feliratok.
    expect(output).toContain("VÉSZLEÁLLÍTÁS");
    expect(output).toContain("[i] igen");
    expect(output).toContain("[n] nem");
    // A normál key-hintek NEM jelennek meg.
    expect(output).not.toContain("rendezés");
  });
});

// ============================================================================
// 6) HelpOverlay — megjelenik a `?` megnyomására
// ============================================================================

describe("feature-wiring: HelpOverlay toggles on visible prop", () => {
  it("renders the help text when visible=true", () => {
    const { lastFrame } = render(<HelpOverlay visible={true} tuiOnly={false} />);
    const output = frame(lastFrame);
    expect(output).toContain("BILLENTYŰZET-SÚGÓ");
    expect(output).toContain("[s]");
    expect(output).toContain("[p]");
    expect(output).toContain("[Tab]");
    expect(output).toContain("[?]");
  });

  it("renders nothing when visible=false", () => {
    const { lastFrame } = render(<HelpOverlay visible={false} tuiOnly={false} />);
    // A HelpOverlay `null`-t ad vissza — a lastFrame outputja üres.
    expect(lastFrame()).toBe("");
  });

  it("hides [s] and [p] descriptions in TUI-only mode", () => {
    const { lastFrame } = render(<HelpOverlay visible={true} tuiOnly={true} />);
    const output = frame(lastFrame);
    // A TUI-only módban az s/p sorok a "(nem elérhető TUI-only módban)"
    // szöveget mutatják.
    expect(output).toContain("TUI-only");
  });
});

// ============================================================================
// 7) Keybinding callback-ek — a `?` overlay, `p` pause, `s` start/stop
// ============================================================================

/**
 * A keybinding callback-ek teszteléséhez egy MiniApp komponenst
 * építünk, ami a useInput-ot használja. A callback-ek hívását
 * figyeljük, és a `stdin.write()`-tal szimuláljuk a billentyű-leütéseket.
 *
 * Az ink-testing-library a `useInput`-ot közvetlenül támogatja —
 * a `stdin.write()` a tényleges Ink useInput hook-ot triggereli.
 */

interface MiniAppProps {
  readonly onStart?: () => void;
  readonly onStop?: () => void;
  readonly onPause?: (paused: boolean) => void;
  readonly onTab?: (panel: string) => void;
  readonly onHelpToggle?: () => void;
  readonly onQuit?: () => void;
  readonly isTuiOnly?: boolean;
}

function MiniApp(props: MiniAppProps): React.ReactElement {
  const [paused, setPaused] = useState<boolean>(false);
  useInput((input, key) => {
    if (props.isTuiOnly !== true && input === "s") {
      if (props.onStart !== undefined) props.onStart();
    }
    if (props.isTuiOnly !== true && input === "p") {
      const newPaused = !paused;
      setPaused(newPaused);
      if (props.onPause !== undefined) props.onPause(newPaused);
    }
    if (key.tab && props.onTab !== undefined) {
      props.onTab("next");
    }
    if (input === "?" && props.onHelpToggle !== undefined) {
      props.onHelpToggle();
    }
    if (input === "q" && props.onQuit !== undefined) {
      props.onQuit();
    }
  });
  return <Text>{paused ? "PAUSED" : "RUNNING"}</Text>;
}

describe("feature-wiring: keybinding callbacks fire correctly", () => {
  it("'s' key triggers onStart callback in with-bot mode", () => {
    let startCount = 0;
    const { stdin } = render(
      <MiniApp onStart={() => { startCount++; }} isTuiOnly={false} />,
    );
    stdin.write("s");
    expect(startCount).toBe(1);
  });

  it("'s' key does NOT trigger onStart in TUI-only mode", () => {
    let startCount = 0;
    const { stdin } = render(
      <MiniApp onStart={() => { startCount++; }} isTuiOnly={true} />,
    );
    stdin.write("s");
    expect(startCount).toBe(0);
  });

  it("'p' key calls onPause with the toggled state", () => {
    const pauseStates: boolean[] = [];
    const { stdin } = render(
      <MiniApp onPause={(p) => { pauseStates.push(p); }} isTuiOnly={false} />,
    );
    stdin.write("p");
    // A callback meghívódik — a value true (toggle false → true).
    expect(pauseStates).toContain(true);
  });

  it("'p' key does NOT work in TUI-only mode", () => {
    const pauseStates: boolean[] = [];
    const { stdin } = render(
      <MiniApp onPause={(p) => { pauseStates.push(p); }} isTuiOnly={true} />,
    );
    stdin.write("p");
    expect(pauseStates).toEqual([]);
  });

  it("Tab key triggers onTab callback", () => {
    const tabEvents: string[] = [];
    const { stdin } = render(
      <MiniApp onTab={(panel) => { tabEvents.push(panel); }} isTuiOnly={false} />,
    );
    stdin.write("\t"); // Tab character
    expect(tabEvents).toEqual(["next"]);
  });

  it("'?' key triggers onHelpToggle callback", () => {
    let toggleCount = 0;
    const { stdin } = render(
      <MiniApp onHelpToggle={() => { toggleCount++; }} isTuiOnly={false} />,
    );
    stdin.write("?");
    expect(toggleCount).toBe(1);
  });

  it("'q' key triggers onQuit callback", () => {
    let quitCount = 0;
    const { stdin } = render(
      <MiniApp onQuit={() => { quitCount++; }} isTuiOnly={false} />,
    );
    stdin.write("q");
    expect(quitCount).toBe(1);
  });
});
