import type { ClientOrderId, Symbol as ExchangeSymbol } from "@mm-crypto-bot/exchange";
import type { Strategy, StrategySignal } from "@mm-crypto-bot/core";
import type { Logger } from "@mm-crypto-bot/logging";

import type { StrategyName } from "../config/schema.js";
import type { BotStrategyInstance } from "../config/strategy-registry.js";
import type { RiskManager } from "../risk/index.js";
import type { PortfolioManager } from "../portfolio/index.js";
import type { OrderManager } from "./order-manager.js";
import type { PositionManager } from "./position-manager.js";

export interface StrategyRunnerOptions {
  readonly instances: ReadonlyMap<StrategyName, BotStrategyInstance>;
  readonly orderManager: OrderManager;
  readonly positionManager: PositionManager;
  readonly sizingFn: SizingFn;
  readonly enabledSymbols: readonly string[];
  readonly riskPerTrade?: number;
  readonly maxLeverage?: number;
  readonly strategyPolicies?: ReadonlyMap<StrategyName, StrategyRuntimePolicy>;
  readonly riskManager?: RiskManager;
  readonly portfolioManager?: PortfolioManager | null;
  readonly onEmergency?: (reason: string) => void | Promise<void>;
  readonly logger?: Logger;
}

export interface StrategyRuntimePolicy {
  readonly symbols?: readonly string[];
  readonly riskPerTrade?: number;
  readonly maxPositions?: number;
  readonly leverage?: number;
}

// eslint-disable-next-line unicorn/name-replacements -- SizingFn is an established public API contract.
export type SizingFn = (parameters: {
  readonly signal: StrategySignal;
  readonly symbol: ExchangeSymbol;
  readonly referencePrice: number;
  readonly equityUsd: number;
  readonly riskPerTrade: number;
}) => number;

export interface StrategyRunnerStats {
  readonly activeStrategies: readonly string[];
  readonly totalSignals: number;
  readonly lastSignalAt: number | null;
  readonly lastSignalStrategy: StrategyName | null;
  readonly ticksProcessed: number;
}

export interface NativeProtectionInput {
  readonly strategy: StrategyName;
  readonly symbol: ExchangeSymbol;
  readonly side: "long" | "short";
  readonly quantity: number;
  readonly leverage: number;
  readonly signal: StrategySignal;
  readonly referencePrice: number;
}

export interface NativeProtectionGroup {
  readonly key: string;
  readonly strategy: StrategyName;
  readonly symbol: ExchangeSymbol;
  readonly active: Set<ClientOrderId>;
  readonly cancelPending: Set<ClientOrderId>;
  desired: NativeProtectionInput | undefined;
  failSafe: NativeProtectionInput | undefined;
  installing: boolean;
}

export interface PendingOrderMetadata {
  readonly strategy: StrategyName;
  readonly symbol: ExchangeSymbol;
  readonly side: "long" | "short";
  readonly leverage: number;
  readonly signal: StrategySignal;
  readonly strategyInstance: Strategy;
  positionOpenedNotified: boolean;
}
