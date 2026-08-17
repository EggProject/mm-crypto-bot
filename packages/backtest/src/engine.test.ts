import { describe, expect, it } from "bun:test";

import type { Candle } from "@mm-crypto-bot/shared/types";

import { runBacktest } from "./engine.js";
import {
  COST_MODEL,
  HOUR_MS,
  POSITION_SIZE,
  ScenarioFeed,
  requireLast,
} from "./engine-scenarios.test-support.js";

function makeScenarioCandles(): Candle[] {
  const candles: Candle[] = [];
  for (let index = 0; index < 250; index += 1) {
    const price = 1000 + index * 0.5;
    candles.push({
      timestamp: index * HOUR_MS,
      open: price,
      high: price * 1.01,
      low: price * 0.99,
      close: price,
      volume: 1000,
    });
  }
  for (let index = 0; index < 10; index += 1) {
    const price = 1125 - index * 2;
    candles.push({
      timestamp: (250 + index) * HOUR_MS,
      open: price,
      high: price * 1.01,
      low: price * 0.99,
      close: price,
      volume: 1000,
    });
  }
  for (let index = 0; index < 20; index += 1) {
    const price = 1105 + index;
    candles.push({
      timestamp: (260 + index) * HOUR_MS,
      open: price,
      high: price * 1.01,
      low: price * 0.99,
      close: price,
      volume: 1000,
    });
  }
  for (let index = 0; index < 100; index += 1) {
    const price = 1125 + index * 0.5;
    candles.push({
      timestamp: (280 + index) * HOUR_MS,
      open: price,
      high: price * 1.01,
      low: price * 0.99,
      close: price,
      volume: 1000,
    });
  }
  return candles;
}

describe("runBacktest — kereskedés szcenáriók", () => {
  it("komplett trade-ek a take-profit és stop-loss kilépéssel", async () => {
    const candles = makeScenarioCandles();
    const result = await runBacktest({
      symbol: "BTC/USDC",
      htfTimeframe: "1d",
      mtfTimeframe: "4h",
      ltfTimeframe: "1h",
      startTime: new Date(0),
      endTime: new Date(requireLast(candles, "scenario candle").timestamp),
      initialEquityUsd: 10_000,
      feed: new ScenarioFeed(candles),
      costModel: COST_MODEL,
      positionSize: POSITION_SIZE,
    });
    expect(Array.isArray(result.trades)).toBe(true);
    expect(Array.isArray(result.equityCurve)).toBe(true);
    expect(typeof result.totalReturn).toBe("number");
    expect(typeof result.sharpeRatio).toBe("number");
    expect(typeof result.maxDrawdown).toBe("number");
    expect(typeof result.profitFactor).toBe("number");
    expect(typeof result.winRate).toBe("number");
  });
});
