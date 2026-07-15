/**
 * packages/tui/src/components/__tests__/focused-panel-indicator.test.tsx
 *
 * ===========================================================================
 * PHASE 41 — FOCUSED PANEL INDICATOR TESTS
 * ===========================================================================
 *
 * A Phase 41 user mandate: a Tab-bal ciklikus panel-fókusz
 * váltáskor a user számára LEGYEN NYILVÁNVALÓ, hogy melyik
 * panel a fókuszált. A korábbi border color változás (focused=
 * true → "magentaBright" vs "magenta") túl finom volt, a user
 * nem vette észre.
 *
 * A Phase 41 kiegészítés: a fókuszált panel címéhez egy explicit
 * `▶` prefix kerül — a border color változáson túl. Ez az
 * indikátor minden panelre egységes:
 *   - StatisticsPanel: ▶ prefix + "STATISZTIKA" cím
 *   - LiveTradingPanel: ▶ prefix + "ÉLŐ KERESKEDÉS" cím
 *   - HistoryList: ▶ prefix + "HISTORY" cím
 *   - ChartsPanel: ▶ prefix + "CHARTS" cím
 *
 * A border color változás is megmarad (a kettős indikáció
 * erősebb vizuális jelet ad).
 *
 * ===========================================================================
 */

import { describe, expect, it } from "bun:test";
import { render } from "ink-testing-library";
import {
  ChartsPanel,
  HistoryList,
  LiveTradingPanel,
  StatisticsPanel,
} from "../index.js";
import type { OhlcCandle } from "../../charts/candlestick.js";
import type { StrategyBar } from "../../charts/bar-chart.js";
import type { Trade } from "../../types.js";
import type { Statistics } from "../../types.js";
import type { Position, TickerEvent, TickerPrice } from "../../types.js";

// ============================================================================
// Fixtures
// ============================================================================

function makeStatistics(): Statistics {
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
  };
}

function makeTrade(id: string): Trade {
  return {
    id,
    symbol: "BTC/USDT",
    side: "buy",
    entryPrice: 60_000,
    exitPrice: 61_000,
    quantity: 0.01,
    leverage: 5,
    pnlUsdt: 100,
    pnlPct: 1.67,
    openedAt: Date.now() - 3_600_000,
    closedAt: Date.now(),
    reason: "TAKE-PROFIT",
  };
}

function makePosition(): Position {
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

// ============================================================================
// StatisticsPanel focus indicator
// ============================================================================

describe("FocusedPanelIndicator — StatisticsPanel (Phase 41)", () => {
  it("shows ▶ prefix in the title when focused=true", () => {
    const { lastFrame } = render(<StatisticsPanel statistics={makeStatistics()} focused={true} />);
    const frame = lastFrame() ?? "";
    // A ▶ prefix megjelenik a panel címében.
    expect(frame).toContain("▶");
    // A panel címe továbbra is megjelenik.
    expect(frame).toContain("STATISZTIKA");
  });

  it("does NOT show ▶ prefix when focused=false (default)", () => {
    const { lastFrame } = render(<StatisticsPanel statistics={makeStatistics()} />);
    const frame = lastFrame() ?? "";
    // A ▶ prefix NEM jelenik meg.
    expect(frame).not.toContain("▶");
  });

  it("does NOT show ▶ prefix when focused=false (explicit)", () => {
    const { lastFrame } = render(<StatisticsPanel statistics={makeStatistics()} focused={false} />);
    const frame = lastFrame() ?? "";
    expect(frame).not.toContain("▶");
  });
});

// ============================================================================
// LiveTradingPanel focus indicator
// ============================================================================

describe("FocusedPanelIndicator — LiveTradingPanel (Phase 41)", () => {
  it("shows ▶ prefix in the title when focused=true", () => {
    const { lastFrame } = render(
      <LiveTradingPanel
        tickers={[makeTicker("BTC/USDT", 61_500)]}
        positions={[makePosition()]}
        tickerEvents={[makeTickerEvent(1, "BTC/USDT", 61_500)]}
        now={Date.now()}
        killSwitchThresholdPct={-10}
        focused={true}
      />,
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("▶");
    expect(frame).toContain("ÉLŐ KERESKEDÉS");
  });

  it("does NOT show ▶ prefix when focused=false (default)", () => {
    const { lastFrame } = render(
      <LiveTradingPanel
        tickers={[makeTicker("BTC/USDT", 61_500)]}
        positions={[]}
        tickerEvents={[]}
        now={Date.now()}
        killSwitchThresholdPct={-10}
      />,
    );
    const frame = lastFrame() ?? "";
    expect(frame).not.toContain("▶");
  });
});

// ============================================================================
// HistoryList focus indicator
// ============================================================================

describe("FocusedPanelIndicator — HistoryList (Phase 41)", () => {
  it("shows ▶ prefix in the title when focused=true", () => {
    const trades: readonly Trade[] = [makeTrade("t1")];
    const { lastFrame } = render(
      <HistoryList history={trades} now={Date.now()} sortKey="time" focused={true} />,
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("▶");
    expect(frame).toContain("HISTORY");
  });

  it("does NOT show ▶ prefix when focused=false (default)", () => {
    const { lastFrame } = render(
      <HistoryList history={[makeTrade("t1")]} now={Date.now()} sortKey="time" />,
    );
    const frame = lastFrame() ?? "";
    expect(frame).not.toContain("▶");
  });
});

// ============================================================================
// ChartsPanel focus indicator
// ============================================================================

describe("FocusedPanelIndicator — ChartsPanel (Phase 41)", () => {
  it("shows ▶ prefix in the title when focused=true", () => {
    const candles: OhlcCandle[] = [
      { open: 100, high: 102, low: 98, close: 101 },
    ];
    const strategies: StrategyBar[] = [{ name: "donchian", cap: 20, enabled: true }];
    const { lastFrame } = render(
      <ChartsPanel
        history={[makeTrade("t1")]}
        initialEquityUsdt={10_000}
        candles={candles}
        strategies={strategies}
        focused={true}
      />,
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("▶");
    expect(frame).toContain("CHARTS");
  });

  it("does NOT show ▶ prefix when focused=false (default)", () => {
    const { lastFrame } = render(
      <ChartsPanel
        history={[]}
        initialEquityUsdt={10_000}
        candles={[]}
        strategies={[]}
      />,
    );
    const frame = lastFrame() ?? "";
    expect(frame).not.toContain("▶");
  });
});
