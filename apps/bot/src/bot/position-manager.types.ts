import type { Symbol } from "@mm-crypto-bot/exchange";
import type { AggregateEffectiveExposureLimit, Position as LeveragePosition } from "@mm-crypto-bot/core";
import type { Logger } from "@mm-crypto-bot/logging";

export type PositionSide = "long" | "short";

export interface PositionSnapshot {
  readonly id: string;
  readonly strategy: string;
  readonly symbol: Symbol;
  readonly side: PositionSide;
  readonly quantity: number;
  readonly entryPrice: number;
  readonly currentPrice: number;
  readonly leverage: number;
  readonly unrealizedPnl: number;
  readonly realizedPnl: number;
  readonly openedAt: number;
  readonly notionalUsd: number;
}

export interface FillEvent {
  readonly strategy: string;
  readonly symbol: Symbol;
  readonly side: PositionSide;
  readonly quantity: number;
  readonly price: number;
  readonly leverage: number;
  readonly timestamp: number;
}

export class PositionManagerError extends Error {
  public override readonly name = "PositionManagerError";
  public override readonly cause: unknown;

  public constructor(message: string, cause?: unknown) {
    super(message);
    this.cause = cause;
    Object.setPrototypeOf(this, PositionManagerError.prototype);
  }
}

export interface PositionContext {
  readonly equityUsd: number;
  readonly positions: readonly LeveragePosition[];
}

export interface PositionManagerOptions {
  readonly initialEquityUsd: number;
  readonly maxPositions: number;
  readonly maxLeverage: number;
  readonly aggregateExposureLimit?: AggregateEffectiveExposureLimit;
  readonly logger?: Logger;
}

export interface PositionRecord {
  id: string;
  strategy: string;
  symbol: Symbol;
  side: PositionSide;
  quantity: number;
  entryPrice: number;
  currentPrice: number;
  leverage: number;
  unrealizedPnl: number;
  realizedPnl: number;
  openedAt: number;
  notionalUsd: number;
}

export interface ClosedTradeSnapshot {
  readonly strategy: string;
  readonly symbol: Symbol;
  readonly side: PositionSide;
  readonly quantity: number;
  readonly entryPrice: number;
  readonly exitPrice: number;
  readonly pnl: number;
  readonly pnlPct: number;
  readonly closedAt: number;
}

export interface RestoredPositionSnapshot {
  readonly strategy: string;
  readonly symbol: Symbol;
  readonly side: PositionSide;
  readonly quantity: number;
  readonly entryPrice: number;
  readonly currentPrice: number;
  readonly leverage: number;
  readonly unrealizedPnl: number;
  readonly realizedPnl: number;
  readonly openedAt: number;
  readonly notionalUsd: number;
}
