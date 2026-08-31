import type { ClientOrderId, Symbol as ExchangeSymbol } from "@mm-crypto-bot/exchange";
import type { Strategy, StrategySignal } from "@mm-crypto-bot/core";
import type { Logger } from "@mm-crypto-bot/logging";

import type { StrategyName } from "../config/schema.js";
import type { PortfolioManager } from "../portfolio/index.js";
import type { RiskManager } from "../risk/index.js";
import type { OrderIntent, OrderLifecycleEvent, OrderManager } from "./order-manager.js";
import type { PositionManager } from "./position-manager.js";
import type {
  NativeProtectionInput,
  PendingOrderMetadata,
  SizingFn as StrategySizingFunction,
  StrategyRuntimePolicy,
} from "./strategy-runner.types.js";

export interface StrategyOrderLifecycleControllerOptions {
  readonly orderManager: OrderManager;
  readonly positionManager: PositionManager;
  readonly sizingFn: StrategySizingFunction;
  readonly riskPerTrade: number;
  readonly maxLeverage: number;
  readonly logger: Logger;
  readonly isOrderEmissionBlocked: () => boolean;
  readonly getRiskManager: () => RiskManager | undefined;
  readonly getPortfolioManager: () => PortfolioManager | undefined;
  readonly getRegimeSizeModifier: (symbol: ExchangeSymbol) => number;
  readonly protectionKey: (strategy: string, symbol: ExchangeSymbol) => string;
  readonly latestPriceFor: (symbol: ExchangeSymbol) => number | undefined;
  readonly installProtections: (input: NativeProtectionInput) => Promise<void>;
  readonly reconcileNativeProtections: (symbol: ExchangeSymbol) => Promise<void>;
}

/**
 * Owns signal-to-order work and pending entry reconciliation for one runner.
 */
export class StrategyOrderLifecycleController {
  private readonly pendingEntries = new Set<string>();
  private readonly pendingOrderMeta = new Map<ClientOrderId, PendingOrderMetadata>();
  private totalSignals = 0;
  private lastSignalAt: number | undefined;
  private lastSignalStrategy: StrategyName | undefined;
  private readonly perStrategyLastSignal = new Map<StrategyName, number>();

  private readonly applyBudgetCap = (
    strategyName: StrategyName,
    baseAmount: number,
    referencePrice: number,
    portfolioManager: PortfolioManager | undefined,
  ): number => {
    if (portfolioManager === undefined) return baseAmount;
    const capUsd = portfolioManager.getBudgetFor(strategyName);
    if (capUsd <= 0 || referencePrice <= 0) return 0;
    const requestedNotional = baseAmount * referencePrice;
    if (requestedNotional <= capUsd) return baseAmount;
    const scaled = capUsd / referencePrice;
    this.options.logger.debug("strategy.order.budget.reduced", {
      strategy: strategyName,
      baseAmount,
      scaledAmount: scaled,
      capUsd,
      requestedNotional,
    });
    return scaled;
  };

  private readonly notifyPositionOpened = (
    meta: PendingOrderMetadata,
    filled: number,
    price: number,
    updateTimestamp: number | undefined,
  ): void => {
    if (meta.positionOpenedNotified) return;
    meta.strategyInstance.onPositionOpened?.({
      side: meta.signal.side,
      entryTime: updateTimestamp ?? Date.now(),
      entryPrice: price,
      quantity: filled,
      stopLoss: meta.signal.stopLoss,
      takeProfit: meta.signal.takeProfit,
      holdingBars: 0,
    });
    meta.positionOpenedNotified = true;
  };

  public constructor(private readonly options: StrategyOrderLifecycleControllerOptions) {}

  public getLastSignalAt(): number | undefined {
    return this.lastSignalAt;
  }

  public getLastSignalStrategy(): StrategyName | undefined {
    return this.lastSignalStrategy;
  }

  public getTotalSignals(): number {
    return this.totalSignals;
  }

  public async handleSignal(
    strategyName: StrategyName,
    strategy: Strategy,
    signal: StrategySignal,
    symbol: ExchangeSymbol,
    referencePrice: number,
    policy: StrategyRuntimePolicy | undefined,
  ): Promise<void> {
    const effectiveLeverage = Math.min(
      this.options.maxLeverage,
      policy?.leverage ?? this.options.maxLeverage,
    );
    const entryKey = this.options.protectionKey(strategyName, symbol);
    if (this.pendingEntries.has(entryKey)) {
      this.options.logger.warn("strategy.entry.order.pending", { strategy: strategyName, symbol });
      return;
    }
    if (this.options.isOrderEmissionBlocked()) {
      this.options.logger.info("strategy.signal.paused", { strategy: strategyName, symbol });
      return;
    }
    this.totalSignals++;
    this.lastSignalAt = Date.now();
    this.lastSignalStrategy = strategyName;
    this.perStrategyLastSignal.set(strategyName, this.lastSignalAt);
    const portfolioManager = this.options.getPortfolioManager();
    if (portfolioManager?.isTripped() === true) {
      this.options.logger.warn("strategy.signal.portfoliostop.tripped", { strategy: strategyName, symbol });
      return;
    }
    if (policy?.maxPositions !== undefined) {
      const owned = this.options.positionManager
        .getPositions()
        .filter((position) => position.strategy === strategyName).length;
      if (owned >= policy.maxPositions) {
        this.options.logger.warn("strategy.signal.maxpositions.reached", {
          strategy: strategyName,
          symbol,
          maxPositions: policy.maxPositions,
        });
        return;
      }
    }
    const equity = this.options.positionManager.getEquity();
    const riskManager = this.options.getRiskManager();
    let amount: number;
    if (riskManager === undefined) {
      amount = this.options.sizingFn({
        signal,
        symbol,
        referencePrice,
        equityUsd: equity,
        riskPerTrade: policy?.riskPerTrade ?? this.options.riskPerTrade,
      });
    } else {
      const fraction = riskManager.evaluateNewPositionSize({
        equityUsd: equity,
        baseSizeFraction: policy?.riskPerTrade ?? this.options.riskPerTrade,
      });
      amount = fraction > 0 && referencePrice > 0 ? (fraction * equity) / referencePrice : 0;
    }
    if (amount <= 0) {
      this.options.logger.debug("strategy.order.sizing.zero", { strategy: strategyName, symbol });
      return;
    }
    amount *= this.options.getRegimeSizeModifier(symbol);
    if (amount <= 0) {
      this.options.logger.info("strategy.entry.regime.blocked", { strategy: strategyName, symbol });
      return;
    }
    amount = this.applyBudgetCap(strategyName, amount, referencePrice, portfolioManager);
    if (amount <= 0) {
      this.options.logger.debug("strategy.order.budget.zero", {
        strategy: strategyName,
        symbol,
        amount,
        referencePrice,
      });
      return;
    }
    const intent: OrderIntent = {
      signal,
      symbol,
      amount,
      referencePrice,
      type: "market",
      clientOrderIdHint: strategyName,
      strategy: strategyName,
      leverage: effectiveLeverage,
    };
    if (this.options.isOrderEmissionBlocked()) {
      this.options.logger.info("strategy.order.paused", { strategy: strategyName, symbol });
      return;
    }
    try {
      this.pendingEntries.add(entryKey);
      const order = await this.options.orderManager.placeOrder(intent);
      if (order.filled > 0) {
        this.options.positionManager.recordFill({
          strategy: strategyName,
          symbol,
          side: signal.side === "buy" ? "long" : "short",
          quantity: order.filled,
          price: order.average ?? order.price ?? referencePrice,
          leverage: effectiveLeverage,
          timestamp: order.updateTimestamp ?? Date.now(),
        });
        await this.options.installProtections({
          strategy: strategyName,
          symbol,
          side: signal.side === "buy" ? "long" : "short",
          quantity: order.filled,
          leverage: effectiveLeverage,
          signal,
          referencePrice: order.average ?? order.price ?? referencePrice,
        });
      }
      if (order.status !== "open") this.pendingEntries.delete(entryKey);
      if (order.status === "open") {
        this.pendingOrderMeta.set(order.clientOrderId, {
          strategy: strategyName,
          symbol,
          side: signal.side === "buy" ? "long" : "short",
          leverage: effectiveLeverage,
          signal,
          strategyInstance: strategy,
          positionOpenedNotified: order.filled > 0,
        });
      }
      this.options.orderManager.recordFill(order.clientOrderId, order);
      if (portfolioManager !== undefined) {
        portfolioManager.recordFill({ strategyId: strategyName, returnPct: 0 });
      }
      if (order.filled > 0 && strategy.onPositionOpened !== undefined) {
        strategy.onPositionOpened({
          side: signal.side,
          entryTime: order.updateTimestamp ?? Date.now(),
          entryPrice: order.average ?? order.price ?? referencePrice,
          quantity: order.filled,
          stopLoss: signal.stopLoss,
          takeProfit: signal.takeProfit,
          holdingBars: 0,
        });
      }
    } catch (error) {
      this.pendingEntries.delete(entryKey);
      this.options.logger.error("strategy.order.place.failed", {
        strategy: strategyName,
        symbol,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  public async reconcilePendingOrders(symbol: ExchangeSymbol): Promise<void> {
    await this.options.reconcileNativeProtections(symbol);
    for (const [clientOrderId, meta] of this.pendingOrderMeta) {
      if (meta.symbol !== symbol) continue;
      try {
        const { order, deltaFilled } = await this.options.orderManager.reconcileOrder(clientOrderId, symbol);
        if (deltaFilled > 0) {
          this.options.positionManager.recordFill({
            strategy: meta.strategy,
            symbol,
            side: meta.side,
            quantity: deltaFilled,
            price: order.average ?? order.price ?? this.options.latestPriceFor(symbol) ?? 0,
            leverage: meta.leverage,
            timestamp: order.updateTimestamp ?? Date.now(),
          });
          await this.options.installProtections({
            strategy: meta.strategy,
            symbol,
            side: meta.side,
            quantity: deltaFilled,
            leverage: meta.leverage,
            signal: meta.signal,
            referencePrice: order.average ?? order.price ?? this.options.latestPriceFor(symbol) ?? 0,
          });
          this.notifyPositionOpened(
            meta,
            order.filled,
            order.average ?? order.price ?? 0,
            order.updateTimestamp,
          );
        }
        if (order.status !== "open") {
          this.pendingOrderMeta.delete(clientOrderId);
          this.pendingEntries.delete(this.options.protectionKey(meta.strategy, symbol));
        }
      } catch (error) {
        this.options.logger.warn("strategy.order.pending.reconciliation.failed", {
          clientOrderId,
          symbol,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  public async applyPendingOrderLifecycle(event: OrderLifecycleEvent): Promise<boolean> {
    const { order, deltaFilled } = event;
    const pending = this.pendingOrderMeta.get(order.clientOrderId);
    if (pending === undefined) return false;
    const symbol = order.symbol;
    if (deltaFilled > 0) {
      this.options.positionManager.recordFill({
        strategy: pending.strategy,
        symbol,
        side: pending.side,
        quantity: deltaFilled,
        price:
          event.kind === "execution"
            ? event.execution.price
            : (order.average ?? order.price ?? this.options.latestPriceFor(symbol) ?? 0),
        leverage: pending.leverage,
        timestamp: order.updateTimestamp ?? Date.now(),
      });
      await this.options.installProtections({
        strategy: pending.strategy,
        symbol,
        side: pending.side,
        quantity: deltaFilled,
        leverage: pending.leverage,
        signal: pending.signal,
        referencePrice: order.average ?? order.price ?? this.options.latestPriceFor(symbol) ?? 0,
      });
      this.notifyPositionOpened(
        pending,
        order.filled,
        order.average ?? order.price ?? 0,
        order.updateTimestamp,
      );
    }
    if (order.status !== "open") {
      this.pendingOrderMeta.delete(order.clientOrderId);
      this.pendingEntries.delete(this.options.protectionKey(pending.strategy, symbol));
    }
    return true;
  }
}
