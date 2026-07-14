/**
 * packages/tui/src/components/__tests__/statistics-panel-status-message.test.tsx
 *
 * Phase 36 Track B1: a `<StatisticsPanel>` címe `<StatusMessage>`
 * formátumban jelenik meg (a Phase 36 user mandate "richer visuals"
 * részeként). Ez a teszt a StatusMessage bekötését ellenőrzi.
 *
 * ===========================================================================
 */

import { describe, expect, it } from "bun:test";
import { render } from "ink-testing-library";
import { StatisticsPanel } from "../StatisticsPanel.js";
import type { Statistics } from "../../types.js";

/**
 * `makeStatistics` — egy minimális `Statistics` mock, amivel a
 * `<StatisticsPanel>` renderelhető.
 */
function makeStatistics(overrides: Partial<Statistics> = {}): Statistics {
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
    equityUsdt: 10_000,
    initialEquityUsdt: 10_000,
    ...overrides,
  };
}

describe("StatisticsPanel — StatusMessage title (Phase 36 Track B1)", () => {
  it("renders the 'STATISZTIKA' title via StatusMessage", () => {
    const stats = makeStatistics();
    const { lastFrame } = render(<StatisticsPanel statistics={stats} />);
    const frame = lastFrame() ?? "";
    expect(frame).toContain("STATISZTIKA");
  });

  it("renders the Összesített PnL label", () => {
    const stats = makeStatistics({ totalPnlUsdt: 1234.56, totalPnlPct: 12.3 });
    const { lastFrame } = render(<StatisticsPanel statistics={stats} />);
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Összesített PnL");
  });

  it("renders the Win rate label", () => {
    const stats = makeStatistics({ winRate: 67.5 });
    const { lastFrame } = render(<StatisticsPanel statistics={stats} />);
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Win rate");
  });

  it("renders the Trade-szám label", () => {
    const stats = makeStatistics({ totalTrades: 42 });
    const { lastFrame } = render(<StatisticsPanel statistics={stats} />);
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Trade-szám");
  });

  it("renders 'Max drawdown' label", () => {
    const stats = makeStatistics({ maxDrawdownPct: 8.5 });
    const { lastFrame } = render(<StatisticsPanel statistics={stats} />);
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Max drawdown");
  });

  it("renders 'Profit factor' label with infinity symbol when profitFactor is POSITIVE_INFINITY", () => {
    const stats = makeStatistics({ profitFactor: Number.POSITIVE_INFINITY });
    const { lastFrame } = render(<StatisticsPanel statistics={stats} />);
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Profit factor");
    expect(frame).toContain("∞");
  });

  it("renders 'Sharpe ratio' label", () => {
    const stats = makeStatistics({ sharpeRatio: 1.85 });
    const { lastFrame } = render(<StatisticsPanel statistics={stats} />);
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Sharpe ratio");
  });

  it("renders the 'Aktuális DD' label", () => {
    const stats = makeStatistics({ currentDrawdownPct: 3.5 });
    const { lastFrame } = render(<StatisticsPanel statistics={stats} />);
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Aktuális DD");
  });

  it("renders the 'Nyert / Vesztett' label with win/loss split", () => {
    const stats = makeStatistics({ winningTrades: 7, losingTrades: 3 });
    const { lastFrame } = render(<StatisticsPanel statistics={stats} />);
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Nyert / Vesztett");
    expect(frame).toContain("7");
    expect(frame).toContain("3");
  });
});
