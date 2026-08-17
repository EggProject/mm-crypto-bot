import { describe, expect, it } from "bun:test";

import type { Strategy, StrategyContext, StrategySignal } from "@mm-crypto-bot/core";
import type { Candle } from "@mm-crypto-bot/shared/types";

import { runBacktest } from "./engine.js";
import {
  COST_MODEL,
  HOUR_MS,
  ScenarioFeed,
  makeCandle,
  noSignal,
  requireFirst,
  requireLast,
} from "./engine-scenarios.test-support.js";
import type { BacktestOptions, BacktestResult, PositionSizeConfig } from "./types.js";

const EQUITY = 10_000;
const RISK_PER_TRADE = 0.01;
const STOP_OFFSET = 10;
const TAKE_PROFIT_OFFSET = 30;
const POSITION_SIZE: PositionSizeConfig = {
  riskPerTrade: RISK_PER_TRADE,
  kellyFraction: 0.25,
  maxDrawdown: 0.15,
  maxPositionPctEquity: 0.2,
  minPositionPctEquity: 0.01,
};

class ConfidenceStrategy implements Strategy {
  private fired = false;

  public readonly name = "confidence";
  public readonly timeframes = ["1h"] as const;

  public constructor(private readonly confidence: number) {}

  onCandle(context: StrategyContext): StrategySignal | null {
    if (this.fired) {
      return noSignal();
    }
    this.fired = true;
    const price = context.candle.close;
    return {
      side: "buy",
      confidence: this.confidence,
      reason: `confidence=${String(this.confidence)}`,
      stopLoss: price - STOP_OFFSET,
      takeProfit: price + TAKE_PROFIT_OFFSET,
    };
  }

  warmup(): number {
    return 0;
  }
}

async function runConfidenceBacktest(
  strategy: ConfidenceStrategy,
  onPositionSized?: BacktestOptions["onPositionSized"],
): Promise<BacktestResult> {
  const candles: Candle[] = Array.from({ length: 10 }, (_, index) =>
    makeCandle(index * HOUR_MS, 100 + index * 5, { high: 150, low: 95 }),
  );
  return runBacktest({
    symbol: "BTC/USDC",
    htfTimeframe: "1d",
    mtfTimeframe: "4h",
    ltfTimeframe: "1h",
    startTime: new Date(0),
    endTime: new Date(requireLast(candles, "confidence candle").timestamp),
    initialEquityUsd: EQUITY,
    feed: new ScenarioFeed(candles),
    costModel: COST_MODEL,
    positionSize: POSITION_SIZE,
    strategy,
    ...(onPositionSized !== undefined && { onPositionSized }),
  });
}

describe("runBacktest — signal.confidence wiring", () => {
  it("confidence=1.0 → riskPerTrade unchanged (full position size)", async () => {
    const result = await runConfidenceBacktest(new ConfidenceStrategy(1));
    expect(result.totalTrades).toBe(1);
    expect(requireFirst(result.trades, "trade").notionalUsd).toBeCloseTo(1000, 6);
  });

  it("reports the exact post-confidence notional through the read-only sizing observer", async () => {
    const events: Parameters<NonNullable<BacktestOptions["onPositionSized"]>>[0][] = [];
    await runConfidenceBacktest(new ConfidenceStrategy(0.5), (event) => {
      events.push(event);
    });
    const event = requireFirst(events, "position sizing event");
    expect(events).toHaveLength(1);
    expect(event).toMatchObject({ timestamp: HOUR_MS, equityUsd: EQUITY, notionalUsd: 500 });
    expect(event.signal.confidence).toBe(0.5);
  });

  it("confidence=0.7 → riskPerTrade scaled to 70% (shallow entry)", async () => {
    const result = await runConfidenceBacktest(new ConfidenceStrategy(0.7));
    expect(result.totalTrades).toBe(1);
    expect(requireFirst(result.trades, "trade").notionalUsd).toBeCloseTo(700, 6);
  });

  it("confidence=0.0 → position size hits minimum clamp (signal suppressed)", async () => {
    const result = await runConfidenceBacktest(new ConfidenceStrategy(0));
    const minimumNotional = EQUITY * POSITION_SIZE.minPositionPctEquity;
    expect(result.totalTrades).toBe(1);
    expect(requireFirst(result.trades, "trade").notionalUsd).toBeCloseTo(minimumNotional, 6);
  });

  it("confidence=0.2 → riskPerTrade scaled to 20% (Phase 16 cap effect)", async () => {
    const result = await runConfidenceBacktest(new ConfidenceStrategy(0.2));
    expect(result.totalTrades).toBe(1);
    expect(requireFirst(result.trades, "trade").notionalUsd).toBeCloseTo(200, 6);
  });

  it("confidence > 1 defensively clamped to 1.0 → notional = base ($1000), NOT max clamp ($2000)", async () => {
    const result = await runConfidenceBacktest(new ConfidenceStrategy(3));
    expect(result.totalTrades).toBe(1);
    expect(requireFirst(result.trades, "trade").notionalUsd).toBeCloseTo(1000, 6);
  });

  it("confidence < 0 defensively clamped to 0 → notional = minNotional ($100)", async () => {
    const result = await runConfidenceBacktest(new ConfidenceStrategy(-0.5));
    const minimumNotional = EQUITY * POSITION_SIZE.minPositionPctEquity;
    expect(result.totalTrades).toBe(1);
    expect(requireFirst(result.trades, "trade").notionalUsd).toBeCloseTo(minimumNotional, 6);
  });
});
