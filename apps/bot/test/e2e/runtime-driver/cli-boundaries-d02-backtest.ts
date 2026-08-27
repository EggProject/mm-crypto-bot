import type { OhlcTrendSignal } from "@mm-crypto-bot/core";
import type { Candle } from "@mm-crypto-bot/shared/types";

import { applyClose, checkSlTpHit } from "../../../src/cli/commands/backtest.js";

import { assertCondition } from "./runtime-driver-core.js";

const BUY_SIGNAL: OhlcTrendSignal = {
  side: "buy",
  confidence: 1,
  reason: "public-boundary",
  entryPrice: 100,
  stopLoss: 95,
  takeProfit: 115,
  timestamp: 1,
  fastEma: 0,
  slowEma: 0,
  rsi: 0,
  atr: 0,
};

const SELL_SIGNAL: OhlcTrendSignal = {
  ...BUY_SIGNAL,
  side: "sell",
  stopLoss: 105,
  takeProfit: 85,
};

function candle(high: number, low: number): Candle {
  return { timestamp: 2, open: 100, high, low, close: 100, volume: 0 };
}

function createTradeState() {
  return { equity: 10_000, peakEquity: 10_000, maxDD: 0, wins: 0, losses: 0, trades: 0 };
}

export function runCliD02BacktestBoundaries(): void {
  const buyPosition = { signal: BUY_SIGNAL, entryPrice: 100 };
  const sellPosition = { signal: SELL_SIGNAL, entryPrice: 100 };
  assertCondition(checkSlTpHit(candle(120, 94), buyPosition) === 95, "buy stop loss did not take priority");
  assertCondition(checkSlTpHit(candle(116, 96), buyPosition) === 115, "buy take profit was not detected");
  assertCondition(checkSlTpHit(candle(110, 96), buyPosition) === null, "buy no-hit candle closed a position");
  assertCondition(
    checkSlTpHit(candle(106, 90), sellPosition) === 105,
    "sell stop loss did not take priority",
  );
  assertCondition(checkSlTpHit(candle(100, 84), sellPosition) === 85, "sell take profit was not detected");
  assertCondition(
    checkSlTpHit(candle(103, 90), sellPosition) === null,
    "sell no-hit candle closed a position",
  );

  const zeroRiskDistance = { signal: { ...BUY_SIGNAL, stopLoss: 100 }, entryPrice: 100 };
  const state = createTradeState();
  applyClose(zeroRiskDistance, 120, 0.01, state);
  assertCondition(state.trades === 1 && state.equity === 10_000, "zero-risk trade changed equity");
}
