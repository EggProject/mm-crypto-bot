import { describe, expect, it } from "bun:test";
import { makeSymbol, type Candle } from "@mm-crypto-bot/shared";
import type { PositionManagementContext, Strategy, StrategyContext } from "./index.js";

const candle: Candle = {
  timestamp: 0,
  open: 100,
  high: 100,
  low: 100,
  close: 100,
  volume: 1,
};

const strategyContext: StrategyContext = {
  symbol: makeSymbol("BTC/USDC"),
  timeframe: "1m",
  candleIndex: 0,
  candle,
  mtfState: { htf: {}, mtf: {}, ltf: {} },
  pricePrecision: 2,
};

const positionManagementContext: PositionManagementContext = {
  openPosition: {
    side: "buy",
    entryTime: 0,
    entryPrice: 100,
    quantity: 1,
    stopLoss: 90,
    takeProfit: 110,
    holdingBars: 0,
  },
  candle,
  candleIndex: 0,
  mtfState: { htf: {}, mtf: {}, ltf: {} },
  pricePrecision: 2,
};

function createAbsenceStrategy(): Strategy {
  return {
    name: "absence-contract",
    timeframes: ["1m"],
    onCandle: (_context) => {
      return;
    },
    onOpenPositionUpdate: (_context) => {
      return;
    },
    warmup: () => 0,
  };
}

describe("Strategy public absence contract", () => {
  it("uses undefined for absent entry signals and position updates", () => {
    const strategy = createAbsenceStrategy();
    expect(strategy.onCandle(strategyContext)).toBeUndefined();

    if (strategy.onOpenPositionUpdate === undefined) {
      throw new Error("Expected the public position-update callback to be present");
    }

    expect(strategy.onOpenPositionUpdate(positionManagementContext)).toBeUndefined();
  });
});
