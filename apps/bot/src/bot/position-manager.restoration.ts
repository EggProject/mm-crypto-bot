import { createPositionId } from "./position-manager.calculations.js";
import {
  PositionManagerError,
  type ClosedTradeSnapshot,
  type PositionRecord,
  type RestoredPositionSnapshot,
} from "./position-manager.types.js";

const MAXIMUM_CLOSED_TRADES = 1000;

export function createRestoredPosition(snapshot: RestoredPositionSnapshot): PositionRecord {
  if (snapshot.quantity <= 0) {
    throw new PositionManagerError(
      `[position-manager] restorePosition: quantity must be positive, got ${String(snapshot.quantity)}`,
    );
  }
  if (snapshot.entryPrice <= 0) {
    throw new PositionManagerError(
      `[position-manager] restorePosition: entryPrice must be positive, got ${String(snapshot.entryPrice)}`,
    );
  }
  if (snapshot.leverage < 1 || snapshot.leverage > 10) {
    throw new PositionManagerError(
      `[position-manager] restorePosition: leverage=${String(snapshot.leverage)} violates 1:10 MANDATE (must be 1..10)`,
    );
  }
  return {
    id: createPositionId(snapshot.strategy, snapshot.symbol, snapshot.side),
    strategy: snapshot.strategy,
    symbol: snapshot.symbol,
    side: snapshot.side,
    quantity: snapshot.quantity,
    entryPrice: snapshot.entryPrice,
    currentPrice: snapshot.currentPrice,
    leverage: snapshot.leverage,
    unrealizedPnl: snapshot.unrealizedPnl,
    realizedPnl: snapshot.realizedPnl,
    openedAt: snapshot.openedAt,
    notionalUsd: snapshot.notionalUsd,
  };
}

export function retainLatestClosedTrades(
  trades: readonly ClosedTradeSnapshot[],
): readonly ClosedTradeSnapshot[] {
  return trades.length > MAXIMUM_CLOSED_TRADES ? trades.slice(trades.length - MAXIMUM_CLOSED_TRADES) : trades;
}
