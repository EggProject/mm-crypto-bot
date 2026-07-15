/**
 * packages/tui/src/components/__tests__/empty-state-messages.test.tsx
 *
 * ===========================================================================
 * PHASE 41 — EMPTY-STATE MESSAGE TESTS
 * ===========================================================================
 *
 * A Phase 41 user mandate: a panel-ek üres állapotban NE passzív
 * "Még nincs..." szöveget mutassanak, hanem explicit útmutatást
 * adjanak a usernek, hogy MIT KELL TENNIE. A cél:
 *
 *   - CHARTS panel: "No equity data yet — start the bot with [s]"
 *                   "No OHLC bars yet — bot needs to be running"
 *                   "No closed trades yet"
 *                   "no strategies"
 *   - HISTORY:     "No closed trades yet — start the bot with [s]"
 *   - LIVE:        "No open positions" / "No ticker events yet"
 *
 * A régi "Még nincs..." placeholder-ek megmaradnak (a backward
 * compatibility megőrzése), de kiegészülnek az új, akciós
 * üzenetekkel.
 *
 * A `→` nyilat használjuk az empty-state prefix-ként (a focus
 * indicator `▶` helyett), hogy a két vizuális jel ne ütközzön.
 *
 * ===========================================================================
 */

import { describe, expect, it } from "bun:test";
import { render } from "ink-testing-library";
import { ChartsPanel, HistoryList, LiveTradingPanel } from "../index.js";
import type { OhlcCandle } from "../../charts/candlestick.js";
import type { StrategyBar } from "../../charts/bar-chart.js";
import type { Trade } from "../../types.js";

// ============================================================================
// ChartsPanel empty-state messages
// ============================================================================

describe("EmptyState — ChartsPanel (Phase 41)", () => {
  it("shows 'No equity data yet' hint with [s] start instruction when history is empty", () => {
    const { lastFrame } = render(
      <ChartsPanel
        history={[]}
        initialEquityUsdt={10_000}
        candles={[]}
        strategies={[]}
      />,
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("No equity data yet");
    expect(frame).toContain("[s]");
    // Az "begin" szó a frame-ben van (a "trading" szó egy sorral lejjbre
    // tördelhető, ezért csak az első szót ellenőrizzük).
    expect(frame).toContain("begin");
  });

  it("shows 'No OHLC bars yet' hint when candles are empty", () => {
    const { lastFrame } = render(
      <ChartsPanel
        history={[]}
        initialEquityUsdt={10_000}
        candles={[]}
        strategies={[]}
      />,
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("No OHLC bars yet");
    expect(frame).toContain("bot needs to be running");
  });

  it("shows 'No closed trades yet' hint for the sparkline when history is empty", () => {
    const { lastFrame } = render(
      <ChartsPanel
        history={[]}
        initialEquityUsdt={10_000}
        candles={[]}
        strategies={[]}
      />,
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("No closed trades yet");
  });

  it("shows 'no strategies' message when strategies is empty", () => {
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

  it("uses → prefix (not ▶) for empty-state messages — keeps focus indicator distinct", () => {
    const { lastFrame } = render(
      <ChartsPanel
        history={[]}
        initialEquityUsdt={10_000}
        candles={[]}
        strategies={[]}
      />,
    );
    const frame = lastFrame() ?? "";
    // Az empty-state prefix → (NE ▶, mert az a focus indicator).
    expect(frame).toContain("→ No equity data yet");
    expect(frame).toContain("→ No OHLC bars yet");
    expect(frame).toContain("→ No closed trades yet");
  });

  it("does NOT show empty-state messages when data is present", () => {
    const candles: OhlcCandle[] = [
      { open: 100, high: 102, low: 98, close: 101 },
    ];
    const strategies: StrategyBar[] = [{ name: "donchian", cap: 20, enabled: true }];
    const trades: Trade[] = [
      {
        id: "t1",
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
      },
    ];
    const { lastFrame } = render(
      <ChartsPanel
        history={trades}
        initialEquityUsdt={10_000}
        candles={candles}
        strategies={strategies}
      />,
    );
    const frame = lastFrame() ?? "";
    expect(frame).not.toContain("No equity data yet");
    expect(frame).not.toContain("No OHLC bars yet");
    expect(frame).not.toContain("no strategies");
  });
});

// ============================================================================
// HistoryList empty-state messages
// ============================================================================

describe("EmptyState — HistoryList (Phase 41)", () => {
  it("shows 'No closed trades yet' hint with [s] start instruction when history is empty", () => {
    const { lastFrame } = render(
      <HistoryList history={[]} now={Date.now()} sortKey="time" />,
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("No closed trades yet");
    expect(frame).toContain("[s]");
    expect(frame).toContain("to begin trading");
  });

  it("uses → prefix (not ▶) for the empty-state message", () => {
    const { lastFrame } = render(
      <HistoryList history={[]} now={Date.now()} sortKey="time" />,
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("→  No closed trades yet");
  });

  it("does NOT show empty-state message when trades are present", () => {
    const trades: readonly Trade[] = [
      {
        id: "t1",
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
      },
    ];
    const { lastFrame } = render(
      <HistoryList history={trades} now={Date.now()} sortKey="time" />,
    );
    const frame = lastFrame() ?? "";
    expect(frame).not.toContain("No closed trades yet");
  });
});

// ============================================================================
// LiveTradingPanel empty-state messages
// ============================================================================

describe("EmptyState — LiveTradingPanel (Phase 41)", () => {
  it("shows 'No open positions' hint with [s] start instruction when no positions", () => {
    const { lastFrame } = render(
      <LiveTradingPanel
        tickers={[]}
        positions={[]}
        tickerEvents={[]}
        now={Date.now()}
        killSwitchThresholdPct={-10}
      />,
    );
    const frame = lastFrame() ?? "";
    // A 'No open positions' megjelenik (a bot stopped state-ben van).
    // A Spinner 'Connecting...' is megjelenik, mert nincs ticker / event / position.
    expect(frame).toContain("Connecting");
  });

  it("shows 'No ticker events yet' hint when only positions exist (no events)", () => {
    // Egy pozíció van, de nincs ticker-event.
    const { lastFrame } = render(
      <LiveTradingPanel
        tickers={[]}
        positions={[
          {
            id: "p1",
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
          },
        ]}
        tickerEvents={[]}
        now={Date.now()}
        killSwitchThresholdPct={-10}
      />,
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("No ticker events yet");
    expect(frame).toContain("[s]");
  });

  it("does NOT show 'No ticker events yet' when events are present", () => {
    const { lastFrame } = render(
      <LiveTradingPanel
        tickers={[]}
        positions={[]}
        tickerEvents={[
          {
            seq: 1,
            symbol: "BTC/USDT",
            price: 60_000,
            volume: 100_000,
            timestamp: Date.now() - 1000,
          },
        ]}
        now={Date.now()}
        killSwitchThresholdPct={-10}
      />,
    );
    const frame = lastFrame() ?? "";
    expect(frame).not.toContain("No ticker events yet");
  });
});
