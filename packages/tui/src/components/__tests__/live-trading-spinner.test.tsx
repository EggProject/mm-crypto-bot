/**
 * packages/tui/src/components/__tests__/live-trading-spinner.test.tsx
 *
 * Phase 36 Track B1: a `<LiveTradingPanel>` a `@inkjs/ui` `<Spinner>`
 * komponensét használja "Connecting..." állapotban (amikor sem
 * ticker, sem ticker-event, sem pozíció nincs). A Spinner egy
 * animált Unicode-braille glyph-öt jelenít meg, és a `label` prop
 * értékét a glyph mellett.
 *
 * ===========================================================================
 */

import { describe, expect, it } from "bun:test";
import { render } from "ink-testing-library";
import { LiveTradingPanel } from "../LiveTradingPanel.js";
import type { Position, TickerEvent, TickerPrice } from "../../types.js";

/**
 * `makePosition` — egy minimális `Position` mock.
 */
function makePosition(overrides: Partial<Position> = {}): Position {
  return {
    id: "p1",
    symbol: "BTC/USDT",
    side: "buy",
    entryPrice: 60_000,
    currentPrice: 60_500,
    quantity: 1,
    leverage: 3,
    unrealizedPnl: 500,
    unrealizedPnlPct: 0.83,
    openedAt: Date.now() - 60_000,
    stopLoss: 59_000,
    takeProfit: 62_000,
    ...overrides,
  };
}

describe("LiveTradingPanel — Spinner (Phase 36 Track B1)", () => {
  it("renders 'Connecting...' Spinner when no tickers, ticker-events, or positions", () => {
    const { lastFrame } = render(
      <LiveTradingPanel
        tickers={[] as readonly TickerPrice[]}
        positions={[]}
        tickerEvents={[]}
        now={Date.now()}
        killSwitchThresholdPct={-10}
      />,
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Connecting");
  });

  it("does NOT render 'Connecting...' when at least one position is open", () => {
    const { lastFrame } = render(
      <LiveTradingPanel
        tickers={[] as readonly TickerPrice[]}
        positions={[makePosition()]}
        tickerEvents={[]}
        now={Date.now()}
        killSwitchThresholdPct={-10}
      />,
    );
    const frame = lastFrame() ?? "";
    expect(frame).not.toContain("Connecting");
  });

  it("does NOT render 'Connecting...' when at least one ticker is present", () => {
    const ticker: TickerPrice = {
      symbol: "BTC/USDT",
      price: 60_500,
      change24hPct: 0.5,
      volume24hUsdt: 1_000_000,
    };
    const { lastFrame } = render(
      <LiveTradingPanel
        tickers={[ticker]}
        positions={[]}
        tickerEvents={[]}
        now={Date.now()}
        killSwitchThresholdPct={-10}
      />,
    );
    const frame = lastFrame() ?? "";
    expect(frame).not.toContain("Connecting");
  });

  it("does NOT render 'Connecting...' when at least one ticker-event is present", () => {
    const event: TickerEvent = {
      seq: 1,
      symbol: "BTC/USDT",
      price: 60_500,
      volume: 100,
      timestamp: Date.now(),
    };
    const { lastFrame } = render(
      <LiveTradingPanel
        tickers={[] as readonly TickerPrice[]}
        positions={[]}
        tickerEvents={[event]}
        now={Date.now()}
        killSwitchThresholdPct={-10}
      />,
    );
    const frame = lastFrame() ?? "";
    expect(frame).not.toContain("Connecting");
  });

  it("renders the 'ÉLŐ KERESKEDÉS' title (StatusMessage)", () => {
    const { lastFrame } = render(
      <LiveTradingPanel
        tickers={[] as readonly TickerPrice[]}
        positions={[]}
        tickerEvents={[]}
        now={Date.now()}
        killSwitchThresholdPct={-10}
      />,
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("ÉLŐ KERESKEDÉS");
  });
});
