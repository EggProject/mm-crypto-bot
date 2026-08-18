import { describe, expect, it } from "bun:test";

import type { Strategy, StrategyContext, StrategySignal } from "@mm-crypto-bot/core";
import type { Candle } from "@mm-crypto-bot/shared/types";

import { runBacktest } from "./engine.js";
import {
  CallbackStrategy,
  HOUR_MS,
  POSITION_SIZE,
  makeBacktestOptions,
  makeCandle,
  noSignal,
  requireFirst,
} from "./engine-scenarios.test-support.js";

function makeCallbackCandles(): Candle[] {
  const flat = Array.from({ length: 10 }, (_, index) => makeCandle(index * HOUR_MS, 100));
  const rising = Array.from({ length: 10 }, (_, index) =>
    makeCandle((10 + index) * HOUR_MS, 100 + (index + 1) * 5, { high: 150, low: 95 }),
  );
  return [...flat, ...rising];
}

function makeFlatCandles(): Candle[] {
  return Array.from({ length: 10 }, (_, index) => makeCandle(index * HOUR_MS, 100));
}

describe("runBacktest — strategy callbacks (coverage)", () => {
  it("onPositionOpened fires exactly once per opened position", async () => {
    const strategy = new CallbackStrategy();
    await runBacktest(
      makeBacktestOptions(makeCallbackCandles(), strategy, { endTime: new Date(20 * HOUR_MS) }),
    );
    expect(strategy.openedCount).toBe(1);
  });

  it("onPositionClosed fires when take-profit triggers (engine.ts line 178 path)", async () => {
    const strategy = new CallbackStrategy();
    const result = await runBacktest(
      makeBacktestOptions(makeCallbackCandles(), strategy, { endTime: new Date(20 * HOUR_MS) }),
    );
    expect(strategy.closedCount).toBe(1);
    expect(strategy.lastExitReason).toBe("take_profit");
    expect(requireFirst(result.trades, "trade").exitReason).toBe("take_profit");
  });

  it("onPositionClosed fires when end_of_data triggers (engine.ts line 382 path)", async () => {
    const strategy = new CallbackStrategy();
    const result = await runBacktest(
      makeBacktestOptions(makeFlatCandles(), strategy, { endTime: new Date(10 * HOUR_MS) }),
    );
    expect(strategy.closedCount).toBe(1);
    expect(strategy.lastExitReason).toBe("end_of_data");
    expect(requireFirst(result.trades, "trade").exitReason).toBe("end_of_data");
  });

  it("onPositionClosed fires when kill-switch triggers (engine.ts line 361 path)", async () => {
    const rising = Array.from({ length: 5 }, (_, index) =>
      makeCandle(index * HOUR_MS, 100 + index * 2, { high: 102 + index * 2, low: 98 + index * 2 }),
    );
    const falling = Array.from({ length: 15 }, (_, index) =>
      makeCandle((5 + index) * HOUR_MS, 110 - (index + 1) * 5, { high: 112 - index * 5, low: 60 }),
    );
    const strategy = new CallbackStrategy(0.5, 2);
    const result = await runBacktest(
      makeBacktestOptions([...rising, ...falling], strategy, {
        endTime: new Date(20 * HOUR_MS),
        positionSize: { ...POSITION_SIZE, maxDrawdown: 0.03, riskPerTrade: 0.5 },
      }),
    );
    expect(result.killSwitchTriggered).toBe(true);
    expect(strategy.closedCount).toBeGreaterThanOrEqual(1);
    expect(strategy.lastExitReason).toBe("kill_switch");
  });

  it("onOpenPositionUpdate with newStopLoss tightens the stop (engine.ts lines 186-213)", async () => {
    const strategy = new CallbackStrategy();
    strategy.updateReturn = { newStopLoss: 95 };
    const result = await runBacktest(
      makeBacktestOptions(makeFlatCandles(), strategy, { endTime: new Date(10 * HOUR_MS) }),
    );
    expect(strategy.updateCount).toBeGreaterThanOrEqual(1);
    expect(requireFirst(result.trades, "trade").exitReason).toBe("end_of_data");
  });

  it("onOpenPositionUpdate with newTakeProfit tightens the TP (engine.ts lines 215-217)", async () => {
    const strategy = new CallbackStrategy();
    strategy.updateReturn = { newTakeProfit: 105 };
    const result = await runBacktest(
      makeBacktestOptions(makeFlatCandles(), strategy, { endTime: new Date(10 * HOUR_MS) }),
    );
    expect(strategy.updateCount).toBeGreaterThanOrEqual(1);
    expect(requireFirst(result.trades, "trade").exitReason).toBe("end_of_data");
  });

  it("onOpenPositionUpdate with forceExit closes the position mid-backtest (engine.ts lines 218-232)", async () => {
    const strategy = new CallbackStrategy();
    strategy.updateReturn = { forceExit: true, exitPrice: 100, reason: "trailing_stop" };
    const result = await runBacktest(
      makeBacktestOptions(makeFlatCandles(), strategy, { endTime: new Date(10 * HOUR_MS) }),
    );
    expect(result.totalTrades).toBe(1);
    expect(requireFirst(result.trades, "trade").exitReason).toBe("trailing_stop");
    expect(strategy.lastExitReason).toBe("trailing_stop");
  });

  it("uses the documented force-exit defaults when the strategy supplies no levels", async () => {
    const strategy = new CallbackStrategy();
    strategy.updateReturn = { forceExit: true };
    const result = await runBacktest(
      makeBacktestOptions(makeFlatCandles(), strategy, { endTime: new Date(10 * HOUR_MS) }),
    );
    const trade = requireFirst(result.trades, "force-exit trade");
    expect(trade.exitReason).toBe("trailing_stop");
    expect(trade.exitPrice).toBeCloseTo(99.940005, 8);
  });
});

class ObservedStrategy implements Strategy {
  public readonly name = "observed";
  public readonly timeframes = ["1h"] as const;
  public entryCalls = 0;
  public observedCalls = 0;

  onCandle(context: StrategyContext): StrategySignal | null {
    this.entryCalls += 1;
    if (this.entryCalls > 1) {
      return noSignal();
    }
    return {
      side: "buy",
      confidence: 1,
      reason: "hold",
      stopLoss: context.candle.close * 0.1,
      takeProfit: context.candle.close * 10,
    };
  }

  onCandleObserved(): void {
    this.observedCalls += 1;
  }

  warmup(): number {
    return 0;
  }
}

describe("runBacktest — open-position state observation", () => {
  it("updates strategy state on every still-open bar without evaluating another entry", async () => {
    const strategy = new ObservedStrategy();
    const candles = Array.from({ length: 4 }, (_, index) =>
      makeCandle(index * HOUR_MS, 100, { high: 101, low: 99 }),
    );
    await runBacktest(makeBacktestOptions(candles, strategy));
    expect(strategy.entryCalls).toBe(1);
    expect(strategy.observedCalls).toBe(2);
  });
});
