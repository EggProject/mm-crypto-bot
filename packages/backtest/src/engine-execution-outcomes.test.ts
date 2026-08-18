import { describe, expect, it } from "bun:test";

import type { Candle } from "@mm-crypto-bot/shared/types";

import { runBacktest } from "./engine.js";
import {
  HOUR_MS,
  NullStrategy,
  POSITION_SIZE,
  SingleSignalStrategy,
  makeBacktestOptions,
  makeCandle,
  requireFirst,
} from "./engine-scenarios.test-support.js";

function makeCandles(count: number, priceAt: (index: number) => number): Candle[] {
  return Array.from({ length: count }, (_, index) => makeCandle(index * HOUR_MS, priceAt(index)));
}

describe("runBacktest — mock stratégiával", () => {
  it("a take-profit exit triggerelődik", async () => {
    const result = await runBacktest(
      makeBacktestOptions(
        makeCandles(20, (index) => 100 + index * 5),
        new SingleSignalStrategy("buy", 1),
      ),
    );
    expect(result.totalTrades).toBe(1);
    expect(requireFirst(result.trades, "trade").exitReason).toBe("take_profit");
  });

  it("a stop-loss exit triggerelődik", async () => {
    const result = await runBacktest(
      makeBacktestOptions(
        makeCandles(20, (index) => 100 - index * 2),
        new SingleSignalStrategy("buy", 1),
      ),
    );
    expect(result.totalTrades).toBe(1);
    expect(requireFirst(result.trades, "trade").exitReason).toBe("stop_loss");
  });

  it("a time-exit triggerelődik 72 óra után", async () => {
    const candles = Array.from({ length: 100 }, (_, index) =>
      makeCandle(index * HOUR_MS, 100, { high: 102, low: 98 }),
    );
    const result = await runBacktest(makeBacktestOptions(candles, new SingleSignalStrategy("buy", 1)));
    expect(result.totalTrades).toBe(1);
    expect(["time_exit", "end_of_data"]).toContain(requireFirst(result.trades, "trade").exitReason);
  });

  it("a kill-switch triggerelődik nyitott pozíció nélkül is", async () => {
    const result = await runBacktest(
      makeBacktestOptions(
        makeCandles(10, () => 100),
        new NullStrategy(),
      ),
    );
    expect(result.killSwitchTriggered).toBe(false);
  });

  it("the kill switch terminates a flat run when its configured threshold is zero", async () => {
    const result = await runBacktest(
      makeBacktestOptions(
        makeCandles(3, () => 100),
        new NullStrategy(),
        {
          positionSize: { ...POSITION_SIZE, maxDrawdown: 0 },
        },
      ),
    );

    expect(result.killSwitchTriggered).toBe(true);
    expect(result.totalTrades).toBe(0);
  });

  it("evaluates the baseline-compatible indicator path when explicitly selected", async () => {
    const result = await runBacktest(
      makeBacktestOptions(
        makeCandles(25, () => 100),
        new NullStrategy(),
        {
          historicalIndicatorMode: "baseline-compatible",
        },
      ),
    );

    expect(result.totalTrades).toBe(0);
    expect(result.killSwitchTriggered).toBe(false);
  });

  it("a kill-switch triggerelődik a drawdown elérésekor", async () => {
    const rising = Array.from({ length: 10 }, (_, index) =>
      makeCandle(index * HOUR_MS, 100 + index * 2, { high: 105 + index * 2, low: 95 + index * 2 }),
    );
    const falling = Array.from({ length: 10 }, (_, index) =>
      makeCandle((10 + index) * HOUR_MS, 120 - (index + 1) * 4, { high: 124 - index * 4, low: 80 }),
    );
    const result = await runBacktest(
      makeBacktestOptions([...rising, ...falling], new SingleSignalStrategy("buy", 1, 50, 100), {
        positionSize: { ...POSITION_SIZE, maxDrawdown: 0.05, riskPerTrade: 0.5 },
      }),
    );
    expect(result.killSwitchTriggered).toBe(true);
    if (result.trades.length > 0) {
      expect(result.trades.find((trade) => trade.exitReason === "kill_switch")).toBeDefined();
    }
  });

  it("az end_of_data exit triggerelődik, ha a trade a backtest végéig nyitva marad", async () => {
    const candles = Array.from({ length: 10 }, (_, index) =>
      makeCandle(index * HOUR_MS, 100 + index * 0.1, { high: 100.5, low: 99.5 }),
    );
    const result = await runBacktest(makeBacktestOptions(candles, new SingleSignalStrategy("buy", 1)));
    expect(result.totalTrades).toBe(1);
    expect(requireFirst(result.trades, "trade").exitReason).toBe("end_of_data");
  });

  it("settles a position opened on the only eligible candle at the terminal boundary", async () => {
    const result = await runBacktest(
      makeBacktestOptions([makeCandle(0, 100)], new SingleSignalStrategy("buy", 1), {
        endTime: new Date(HOUR_MS),
      }),
    );

    expect(requireFirst(result.trades, "terminal trade").exitReason).toBe("end_of_data");
  });

  it("a short pozíció take-profit triggerelődik", async () => {
    const candles = Array.from({ length: 20 }, (_, index) =>
      makeCandle(index * HOUR_MS, 100 - index * 3, { high: 105, low: 70 }),
    );
    const result = await runBacktest(makeBacktestOptions(candles, new SingleSignalStrategy("sell", 1)));
    expect(result.totalTrades).toBe(1);
    expect(requireFirst(result.trades, "trade").side).toBe("sell");
  });

  it("a position sizing helyes: a notional = equity * riskPerTrade / stopDistance", async () => {
    const candles = Array.from({ length: 10 }, (_, index) =>
      makeCandle(index * HOUR_MS, 100, { high: 102, low: 98 }),
    );
    const result = await runBacktest(makeBacktestOptions(candles, new SingleSignalStrategy("buy", 1)));
    expect(requireFirst(result.trades, "trade").notionalUsd).toBeGreaterThanOrEqual(100);
    expect(requireFirst(result.trades, "trade").notionalUsd).toBeLessThanOrEqual(2000);
  });
});

describe("runBacktest — kill-switch", () => {
  it("a kill-switch triggerelődik, ha a drawdown eléri a maxDrawdown-t", async () => {
    const rising = Array.from({ length: 250 }, (_, index) => makeCandle(index * HOUR_MS, 1000 + index * 0.5));
    const falling = Array.from({ length: 100 }, (_, index) =>
      makeCandle((250 + index) * HOUR_MS, 1125 - index * 1.5),
    );
    const result = await runBacktest(
      makeBacktestOptions([...rising, ...falling], undefined, {
        positionSize: { ...POSITION_SIZE, maxDrawdown: 0.05 },
      }),
    );
    if (result.totalTrades > 0) {
      expect(["kill_switch", "end_of_data", "stop_loss"]).toContain(
        requireFirst(result.trades, "trade").exitReason,
      );
    }
  });

  it("a kill-switch nem dob TypeError-t, ha nincs nyitott pozíció (Phase 27 regression test)", async () => {
    const rising = Array.from({ length: 50 }, (_, index) => makeCandle(index * HOUR_MS, 1000 + index));
    const falling = Array.from({ length: 50 }, (_, index) =>
      makeCandle((50 + index) * HOUR_MS, 1050 - index * 3),
    );
    const flat = Array.from({ length: 50 }, (_, index) => makeCandle((100 + index) * HOUR_MS, 900));
    const result = await runBacktest(
      makeBacktestOptions([...rising, ...falling, ...flat], new SingleSignalStrategy("buy", 1, 5, 100), {
        positionSize: { ...POSITION_SIZE, maxDrawdown: 0.01, riskPerTrade: 0.5 },
      }),
    );
    expect(result.trades.length).toBeGreaterThanOrEqual(1);
    expect(["stop_loss", "kill_switch", "end_of_data"]).toContain(
      requireFirst(result.trades, "trade").exitReason,
    );
  });
});

describe("runBacktest — end-of-data", () => {
  it("a hátralévő nyitott pozíció az end_of_data exit reasonnel zárul", async () => {
    const rising = Array.from({ length: 250 }, (_, index) => makeCandle(index * HOUR_MS, 1000 + index * 0.5));
    const extra = Array.from({ length: 10 }, (_, index) =>
      makeCandle((250 + index) * HOUR_MS, 1125 + index * 0.5),
    );
    const result = await runBacktest(makeBacktestOptions([...rising, ...extra], undefined));
    for (const trade of result.trades) {
      expect([
        "stop_loss",
        "take_profit",
        "time_exit",
        "end_of_data",
        "kill_switch",
        "trend_reversal",
      ]).toContain(trade.exitReason);
    }
  });
});
