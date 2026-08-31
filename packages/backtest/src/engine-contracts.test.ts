import { describe, expect, it } from "bun:test";

import type {
  PositionManagementContext,
  PositionUpdate,
  Strategy,
  StrategyContext,
  StrategySignal,
} from "@mm-crypto-bot/core";
import type { Candle } from "@mm-crypto-bot/shared/types";

import { runBacktest } from "./engine.js";
import { HOUR_MS, makeBacktestOptions, makeCandle, requireFirst } from "./engine-scenarios.test-support.js";
import type { BacktestOptions } from "./types.js";

class PriceLevelPriorityStrategy implements Strategy {
  private emittedSignal = false;

  public readonly name = "price-level-priority";
  public readonly timeframes = ["1h"] as const;
  public readonly updateContexts: PositionManagementContext[] = [];

  onCandle(context: StrategyContext): StrategySignal | undefined {
    if (this.emittedSignal) {
      return undefined;
    }
    this.emittedSignal = true;
    return {
      side: "buy",
      confidence: 1,
      reason: "price-level-priority",
      stopLoss: context.candle.close - 10,
      takeProfit: context.candle.close + 30,
    };
  }

  onOpenPositionUpdate(context: PositionManagementContext): PositionUpdate | undefined {
    this.updateContexts.push(context);
    return this.updateContexts.length === 1 ? { newStopLoss: 95, newTakeProfit: 105 } : undefined;
  }

  warmup(): number {
    return 0;
  }
}

class ContractInvalidResultStrategy implements Strategy {
  public readonly name = "contract-invalid-result";
  public readonly timeframes = ["1h"] as const;

  public constructor(private readonly result: unknown) {
    Object.defineProperty(this, "onCandle", {
      configurable: true,
      value: () => this.result,
    });
  }

  onCandle(_context: StrategyContext): StrategySignal | undefined {
    return undefined;
  }

  warmup(): number {
    return 0;
  }
}

class ContractInvalidPositionUpdateStrategy implements Strategy {
  private emittedSignal = false;

  public readonly name = "contract-invalid-position-update";
  public readonly timeframes = ["1h"] as const;

  public constructor() {
    Object.defineProperty(this, "onOpenPositionUpdate", {
      configurable: true,
      value: () => /unexpected-position-update/.exec(""),
    });
  }

  onCandle(context: StrategyContext): StrategySignal | undefined {
    if (this.emittedSignal) {
      return undefined;
    }
    this.emittedSignal = true;
    return {
      side: "buy",
      confidence: 1,
      reason: "contract-invalid-position-update",
      stopLoss: context.candle.close - 10,
      takeProfit: context.candle.close + 30,
    };
  }

  onOpenPositionUpdate(_context: PositionManagementContext): PositionUpdate | undefined {
    return undefined;
  }

  warmup(): number {
    return 0;
  }
}

function makePriorityCandles(): Candle[] {
  return [
    makeCandle(0, 100, { high: 101, low: 99 }),
    makeCandle(HOUR_MS, 100, { high: 101, low: 99 }),
    makeCandle(2 * HOUR_MS, 100, { high: 104, low: 92 }),
  ];
}

function makeInvalidResultOptions(result: unknown) {
  const candles = makePriorityCandles();
  return makeBacktestOptions(candles, new ContractInvalidResultStrategy(result), {
    endTime: new Date(3 * HOUR_MS),
  });
}

async function expectContractError(options: BacktestOptions): Promise<void> {
  let receivedError: unknown;
  try {
    await runBacktest(options);
  } catch (error: unknown) {
    receivedError = error;
  }
  expect(receivedError).toBeInstanceOf(Error);
  if (receivedError instanceof Error) {
    expect(receivedError.message).toBe("Strategy.onCandle must return a StrategySignal or undefined.");
  }
}

async function expectPositionUpdateContractError(options: BacktestOptions): Promise<void> {
  let receivedError: unknown;
  try {
    await runBacktest(options);
  } catch (error: unknown) {
    receivedError = error;
  }
  expect(receivedError).toBeInstanceOf(Error);
  if (receivedError instanceof Error) {
    expect(receivedError.message).toBe(
      "Strategy.onOpenPositionUpdate must return a PositionUpdate or undefined.",
    );
  }
}

describe("runBacktest contract boundaries", () => {
  it("uses the take-profit price level as the authoritative same-update position snapshot", async () => {
    const strategy = new PriceLevelPriorityStrategy();
    const result = await runBacktest(
      makeBacktestOptions(makePriorityCandles(), strategy, { endTime: new Date(3 * HOUR_MS) }),
    );

    const secondUpdate = strategy.updateContexts.at(1);
    expect(secondUpdate?.openPosition.stopLoss).toBe(90);
    expect(secondUpdate?.openPosition.takeProfit).toBe(105);
    expect(requireFirst(result.trades, "trade").exitReason).toBe("end_of_data");
  });

  it("fails closed when a strategy returns undefined instead of null or a signal", async () => {
    const result = await runBacktest(makeInvalidResultOptions(undefined));
    expect(result.totalTrades).toBe(0);
  });

  it("fails closed when a strategy returns null instead of undefined or a signal", async () => {
    await expectContractError(makeInvalidResultOptions(/unexpected-signal/.exec("")));
  });

  it("fails closed when an open-position callback returns null instead of undefined or an update", async () => {
    await expectPositionUpdateContractError(
      makeBacktestOptions(makePriorityCandles(), new ContractInvalidPositionUpdateStrategy(), {
        endTime: new Date(3 * HOUR_MS),
      }),
    );
  });

  it("fails closed when a strategy signal omits side", async () => {
    await expectContractError(
      makeInvalidResultOptions({ confidence: 1, reason: "missing-side", stopLoss: 90, takeProfit: 110 }),
    );
  });

  it("fails closed when a strategy signal contains an invalid side", async () => {
    await expectContractError(
      makeInvalidResultOptions({
        side: "hold",
        confidence: 1,
        reason: "invalid-side",
        stopLoss: 90,
        takeProfit: 110,
      }),
    );
  });
});
