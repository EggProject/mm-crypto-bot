import type { Candle, ExitReason, Symbol, Trade } from "@mm-crypto-bot/shared/types";
import { roundTo } from "@mm-crypto-bot/shared/utils";

import {
  applySlippage,
  applySpread,
  entryCost,
  exitCost,
  fundingCost,
  marginBorrowCost,
} from "./cost-model.js";
import type { CostModel } from "./types.js";

export interface OpenPosition {
  readonly symbol: Symbol;
  readonly side: "buy" | "sell";
  readonly entryTime: number;
  readonly entryPrice: number;
  readonly quantity: number;
  readonly notionalUsd: number;
  readonly marginNotional: number;
  readonly stopLoss: number;
  readonly takeProfit: number;
  readonly entryFee: number;
  readonly entryReason: string;
}

export interface ExitDecision {
  readonly reason: ExitReason;
  readonly exitPrice: number;
}

export function checkExit(position: OpenPosition, candle: Candle, _model: CostModel): ExitDecision | null {
  if (position.side === "buy") {
    if (candle.low <= position.stopLoss) {
      return { reason: "stop_loss", exitPrice: position.stopLoss };
    }
    if (candle.high >= position.takeProfit) {
      return { reason: "take_profit", exitPrice: position.takeProfit };
    }
  } else {
    if (candle.high >= position.stopLoss) {
      return { reason: "stop_loss", exitPrice: position.stopLoss };
    }
    if (candle.low <= position.takeProfit) {
      return { reason: "take_profit", exitPrice: position.takeProfit };
    }
  }

  const holdingHours = (candle.timestamp - position.entryTime) / (60 * 60 * 1000);
  if (holdingHours < 72 || !isProfitable(position, candle.close)) {
    // eslint-disable-next-line unicorn/no-null -- The established engine contract represents an absent exit with null.
    return null;
  }
  return { reason: "time_exit", exitPrice: candle.close };
}

export function closePosition(
  position: OpenPosition,
  candle: Candle,
  exit: ExitDecision,
  model: CostModel,
): Trade {
  const exitSide = position.side === "buy" ? "sell" : "buy";
  const filledExitPrice = applySlippage(
    applySpread(exit.exitPrice, exitSide, model.spreadRate),
    exitSide,
    model.slippageRate,
  );
  const grossPnl = calculateGrossPnl(position, filledExitPrice);
  const holdingHours = (candle.timestamp - position.entryTime) / (60 * 60 * 1000);
  const borrowCost = marginBorrowCost(position.marginNotional, holdingHours, model);
  const fundCost = fundingCost(position.notionalUsd, holdingHours, model);
  const fees = entryCost(position.notionalUsd, model) + exitCost(position.notionalUsd, model);
  const totalCosts = fees + borrowCost + fundCost;
  const netPnl = grossPnl - totalCosts;

  return {
    symbol: position.symbol,
    side: position.side,
    entryTime: position.entryTime,
    entryPrice: roundTo(position.entryPrice, 8),
    exitTime: candle.timestamp,
    exitPrice: roundTo(filledExitPrice, 8),
    quantity: position.quantity,
    notionalUsd: position.notionalUsd,
    pnlUsd: netPnl,
    pnlPct: netPnl / position.notionalUsd,
    feesUsd: totalCosts,
    exitReason: exit.reason,
  };
}

export function calculateUnrealizedPnl(position: OpenPosition, candle: Candle, model: CostModel): number {
  const exitSide = position.side === "buy" ? "sell" : "buy";
  const markedExitPrice = applySlippage(
    applySpread(candle.close, exitSide, model.spreadRate),
    exitSide,
    model.slippageRate,
  );
  const holdingHours = (candle.timestamp - position.entryTime) / (60 * 60 * 1000);
  return (
    calculateGrossPnl(position, markedExitPrice) -
    marginBorrowCost(position.marginNotional, holdingHours, model) -
    fundingCost(position.notionalUsd, holdingHours, model)
  );
}

function calculateGrossPnl(position: OpenPosition, price: number): number {
  const priceDifference = position.side === "buy" ? price - position.entryPrice : position.entryPrice - price;
  return priceDifference * position.quantity;
}

function isProfitable(position: OpenPosition, price: number): boolean {
  return calculateGrossPnl(position, price) > 0;
}
