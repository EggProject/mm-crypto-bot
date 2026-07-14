/**
 * packages/tui/src/components/__tests__/charts-panel.test.tsx
 *
 * Phase 36 Track B2: a `<ChartsPanel>` a 4. panel a TUI-n.
 * A teszt a panel integrációját ellenőrzi: a 4 sub-chart
 * (equity görbe, candlestick, P&L sparkline, stratégia-breakdown)
 * mind megjelenik-e a kimenetben.
 *
 * ===========================================================================
 */

import { describe, expect, it } from "bun:test";
import { render } from "ink-testing-library";
import { ChartsPanel } from "../ChartsPanel.js";
import type { OhlcCandle } from "../../charts/candlestick.js";
import type { StrategyBar } from "../../charts/bar-chart.js";
import type { Trade } from "../../types.js";

/**
 * `makeTrade` — egy minimális `Trade` mock.
 */
function makeTrade(overrides: Partial<Trade> = {}): Trade {
  return {
    id: "t1",
    symbol: "BTC/USDT",
    side: "buy",
    entryPrice: 60_000,
    exitPrice: 61_000,
    quantity: 1,
    leverage: 3,
    pnlUsdt: 100,
    pnlPct: 1.67,
    openedAt: Date.now() - 60_000,
    closedAt: Date.now(),
    reason: "TAKE-PROFIT",
    ...overrides,
  };
}

describe("ChartsPanel (Phase 36 Track B2)", () => {
  it("renders the 'CHARTS' title", () => {
    const { lastFrame } = render(
      <ChartsPanel
        history={[]}
        initialEquityUsdt={10_000}
        candles={[]}
        strategies={[]}
      />,
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("CHARTS");
  });

  it("renders all 4 sub-chart section labels", () => {
    const { lastFrame } = render(
      <ChartsPanel
        history={[]}
        initialEquityUsdt={10_000}
        candles={[]}
        strategies={[]}
      />,
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("EQUITY GÖRBE");
    expect(frame).toContain("OHLC CANDLESTICK");
    expect(frame).toContain("P&L SPARKLINE");
    expect(frame).toContain("STRATÉGIA-BREAKDOWN");
  });

  it("renders the equity curve placeholder when history is empty", () => {
    const { lastFrame } = render(
      <ChartsPanel
        history={[]}
        initialEquityUsdt={10_000}
        candles={[]}
        strategies={[]}
      />,
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Még nincs equity-adat");
  });

  it("renders the candlestick placeholder when candles are empty", () => {
    const { lastFrame } = render(
      <ChartsPanel
        history={[]}
        initialEquityUsdt={10_000}
        candles={[]}
        strategies={[]}
      />,
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Még nincs OHLC-adat");
  });

  it("renders the sparkline placeholder when history is empty", () => {
    const { lastFrame } = render(
      <ChartsPanel
        history={[]}
        initialEquityUsdt={10_000}
        candles={[]}
        strategies={[]}
      />,
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Még nincs P&L-adat");
  });

  it("renders the 'no strategies' message when strategies is empty", () => {
    const { lastFrame } = render(
      <ChartsPanel
        history={[]}
        initialEquityUsdt={10_000}
        candles={[]}
        strategies={[]}
      />,
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("no strategies");
  });

  it("renders an equity curve when history has trades", () => {
    const trades: Trade[] = [];
    for (let i = 0; i < 20; i++) {
      trades.push(
        makeTrade({
          id: `t-${i}`,
          pnlUsdt: i % 2 === 0 ? 50 : -25,
          pnlPct: i % 2 === 0 ? 0.5 : -0.25,
          closedAt: Date.now() - (20 - i) * 1000,
        }),
      );
    }
    const { lastFrame } = render(
      <ChartsPanel
        history={trades}
        initialEquityUsdt={10_000}
        candles={[]}
        strategies={[]}
      />,
    );
    const frame = lastFrame() ?? "";
    // Az equity görbe a trade-ekből épül — a placeholder NEM jelenik meg.
    expect(frame).not.toContain("Még nincs equity-adat");
    // A görbe 20 trade-et mutat.
    expect(frame).toContain("20 trade");
  });

  it("renders candlesticks when candles are provided", () => {
    const candles: OhlcCandle[] = [];
    for (let i = 0; i < 10; i++) {
      candles.push({
        open: 100 + i,
        high: 102 + i,
        low: 98 + i,
        close: 101 + i,
      });
    }
    const { lastFrame } = render(
      <ChartsPanel
        history={[]}
        initialEquityUsdt={10_000}
        candles={candles}
        strategies={[]}
      />,
    );
    const frame = lastFrame() ?? "";
    // A candlestick megjelenik (wick + body karakterek).
    expect(frame).toMatch(/[│█▓]/);
  });

  it("renders strategy bars when strategies are provided", () => {
    const strategies: StrategyBar[] = [
      { name: "donchian", cap: 20, enabled: true },
      { name: "dydx_cex", cap: 2.5, enabled: true },
    ];
    const { lastFrame } = render(
      <ChartsPanel
        history={[]}
        initialEquityUsdt={10_000}
        candles={[]}
        strategies={strategies}
      />,
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("donchian");
    expect(frame).toContain("dydx_cex");
  });
});
