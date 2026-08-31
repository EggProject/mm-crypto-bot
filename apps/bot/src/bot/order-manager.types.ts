import type {
  Balance,
  ClientOrderId,
  ExchangeFeed,
  ExchangePosition,
  Execution,
  MarketMeta,
  Order,
  ProtectiveOrderKind,
  Symbol,
  Ticker,
} from "@mm-crypto-bot/exchange";
import type {
  AggregateEffectiveExposureLimit,
  Position as LeveragePosition,
  StrategySignal,
} from "@mm-crypto-bot/core";
import type { Logger } from "@mm-crypto-bot/logging";

export class OrderManagerError extends Error {
  public override readonly name = "OrderManagerError";
  public override readonly cause: unknown;

  public constructor(message: string, cause: unknown) {
    super(message);
    this.cause = cause;
    Object.setPrototypeOf(this, OrderManagerError.prototype);
  }
}

export type OrderType = "market" | "limit";

export interface OrderIntent {
  readonly signal: StrategySignal;
  readonly symbol: Symbol;
  readonly amount: number;
  readonly referencePrice: number;
  readonly type: OrderType;
  readonly limitPrice?: number;
  readonly clientOrderIdHint?: string;
  readonly reduceOnly?: boolean;
  readonly leverage?: number;
  readonly strategy?: string;
  readonly protectiveKind?: ProtectiveOrderKind;
  readonly triggerPrice?: number;
}

export interface PaperOrderSimulationInput {
  readonly intent: Readonly<OrderIntent>;
  readonly clientOrderId: ClientOrderId;
  readonly placedCount: number;
  readonly timestamp: number;
}

export type PaperOrderSimulationOutcome = "filled" | "unfilled";

export type PaperOrderSimulator = (input: PaperOrderSimulationInput) => PaperOrderSimulationOutcome;

export interface PositionSizeQuery {
  readonly equityUsd: number;
  readonly positions: readonly LeveragePosition[];
}

export interface ReduciblePosition {
  readonly side: "long" | "short";
  readonly quantity: number;
}

export type OrderLifecycleEvent =
  | { readonly kind: "order"; readonly order: Order; readonly deltaFilled: number }
  | {
      readonly kind: "execution";
      readonly order: Order;
      readonly execution: Execution;
      readonly deltaFilled: number;
    };

export type OrderLifecycleListener = (event: OrderLifecycleEvent) => void;

export interface OrderManagerOptions {
  readonly feed: ExchangeFeed;
  readonly getPositionContext: () => PositionSizeQuery;
  readonly getReduciblePosition?: (
    symbol: Symbol,
    strategy: string | undefined,
  ) => ReduciblePosition | undefined;
  readonly aggregateExposureLimit?: AggregateEffectiveExposureLimit;
  readonly logger?: Logger;
  readonly paperMode?: boolean;
  readonly paperOrderSimulator?: PaperOrderSimulator;
  readonly liveAuthority?: { readonly assertEntryAllowed: () => void };
}

export interface OrderManagerCounters {
  placed: number;
  filled: number;
  cancelled: number;
  rejected: number;
}

export interface OrderManagerAuthority {
  readonly getAuthoritativePositions: (symbols?: readonly Symbol[]) => Promise<readonly ExchangePosition[]>;
  readonly getAuthoritativeBalances: () => Promise<readonly Balance[]>;
  readonly getMarketMeta: (symbol: Symbol) => Promise<MarketMeta>;
  readonly getTickerSnapshot: (symbol: Symbol) => Promise<Ticker>;
}
