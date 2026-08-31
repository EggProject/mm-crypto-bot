import type { Symbol } from "@mm-crypto-bot/exchange";
import type { Position as LeveragePosition } from "@mm-crypto-bot/core";

import type { PositionRecord, PositionSide } from "./position-manager.types.js";

export function createPositionId(strategy: string, symbol: Symbol, side: PositionSide): string {
  return `${strategy}:${symbol}:${side}`;
}

export function calculatePnl(
  side: PositionSide,
  entryPrice: number,
  exitPrice: number,
  quantity: number,
): number {
  const priceDifference = side === "long" ? exitPrice - entryPrice : entryPrice - exitPrice;
  return priceDifference * quantity;
}

export function calculateUnrealizedPnl(record: PositionRecord): number {
  return calculatePnl(record.side, record.entryPrice, record.currentPrice, record.quantity);
}

export function createLeveragePositions(records: Iterable<PositionRecord>): readonly LeveragePosition[] {
  return Array.from(records, (record) => ({
    symbol: record.symbol,
    source: record.strategy,
    effectiveNotionalUsd:
      record.side === "long" ? record.notionalUsd * record.leverage : -(record.notionalUsd * record.leverage),
  }));
}

export function calculateAggregateNotional(records: Iterable<PositionRecord>): number {
  let total = 0;
  for (const record of records) {
    total += Math.abs(record.notionalUsd * record.leverage);
  }
  return total;
}

export function calculateUnrealizedPnlTotal(records: Iterable<PositionRecord>): number {
  let total = 0;
  for (const record of records) {
    total += record.unrealizedPnl;
  }
  return total;
}
