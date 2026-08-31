import type { ClientOrderId, Symbol as ExchangeSymbol } from "@mm-crypto-bot/exchange";
import type { Bar, CarryMarket, DydxFundingSource, FundingSnapshot, Strategy } from "@mm-crypto-bot/core";
import type { ExactRational } from "@mm-crypto-bot/numeric";
import { SignalBus } from "@mm-crypto-bot/core";
import type { UnsubscribeFn } from "@mm-crypto-bot/core";
import type { Logger } from "@mm-crypto-bot/logging";

import type { StrategyName } from "../config/schema.js";
import type { BotStrategyInstance } from "../config/strategy-registry.js";
import type { PortfolioManager } from "../portfolio/index.js";
import type { RiskManager } from "../risk/index.js";
import type { OrderLifecycleEvent, OrderManager } from "./order-manager.js";
import type { PositionManager } from "./position-manager.js";

interface FundingStrategy extends Strategy {
  readonly config: {
    readonly market: CarryMarket;
    readonly fundingSource: DydxFundingSource;
  };
  recordFundingTick(dydx: FundingSnapshot, cex: FundingSnapshot, nowMs: number): ExactRational;
}

interface RegimeDetectorPlugin {
  recordClose(symbol: string, close: number, timestampMs: number): void;
}

function isRegimeDetectorPlugin(plugin: object): plugin is RegimeDetectorPlugin {
  return "recordClose" in plugin && typeof plugin.recordClose === "function";
}

function pluginState(plugin: object): unknown {
  return "state" in plugin ? plugin.state : undefined;
}

function isFundingStrategy(strategy: Strategy): strategy is FundingStrategy {
  const candidate: unknown = strategy;
  if (
    typeof candidate !== "object" ||
    candidate === null ||
    !("config" in candidate) ||
    !("recordFundingTick" in candidate)
  )
    return false;
  if (typeof candidate.recordFundingTick !== "function") return false;
  const config = candidate.config;
  return (
    typeof config === "object" &&
    config !== null &&
    "market" in config &&
    "fundingSource" in config &&
    typeof config.market === "string" &&
    typeof config.fundingSource === "object" &&
    config.fundingSource !== null &&
    "subscribe" in config.fundingSource &&
    typeof config.fundingSource.subscribe === "function"
  );
}

export interface StrategyPluginRiskControllerOptions {
  readonly instances: ReadonlyMap<StrategyName, BotStrategyInstance>;
  readonly orderManager: OrderManager;
  readonly positionManager: PositionManager;
  readonly enabledSymbols: ReadonlySet<ExchangeSymbol>;
  readonly logger: Logger;
  readonly isOrderEmissionBlocked: () => boolean;
  readonly pause: () => void;
  readonly getRiskManager: () => RiskManager | undefined;
  readonly getPortfolioManager: () => PortfolioManager | undefined;
  readonly getOnEmergency: () => ((reason: string) => void | Promise<void>) | undefined;
  readonly latestPriceFor: (symbol: ExchangeSymbol) => number | undefined;
  readonly notifyStrategyClosed: (strategyName: string, reason: string) => void;
}

/**
 * Owns plugin, funding, and trailing-risk-close state for one runner.
 */
export class StrategyPluginRiskController {
  private readonly pluginBus = new SignalBus({ mode: "live" });
  private readonly pluginBusUnsubscribers: UnsubscribeFn[] = [];
  private readonly fundingSourceClosers: (() => void)[] = [];
  private readonly regimeSizeModifiers = new Map<ExchangeSymbol, number>();
  private readonly pendingRiskCloses = new Map<string, ClientOrderId | undefined>();
  private pluginClosePromise: Promise<void> | undefined;

  public constructor(private readonly options: StrategyPluginRiskControllerOptions) {}

  private startPlugins(): void {
    const started: Extract<BotStrategyInstance, { readonly kind: "plugin" }>[] = [];
    try {
      this.pluginBusUnsubscribers.push(
        this.pluginBus.subscribe("risk", (signal) => {
          if (signal.kind !== "risk" || this.options.isOrderEmissionBlocked()) return;
          if (signal.source.startsWith("regime-detector-v1:")) {
            const attributed = signal.source.slice(signal.source.lastIndexOf(":") + 1) as ExchangeSymbol;
            const modifier = signal.sizeModifier;
            if (
              modifier === undefined ||
              !this.options.enabledSymbols.has(attributed) ||
              !Number.isFinite(modifier) ||
              modifier < 0 ||
              modifier > 1
            ) {
              this.options.pause();
              throw new Error(
                `[strategy-runner] invalid regime sizing signal source=${signal.source} modifier=${String(modifier)}`,
              );
            }
            this.regimeSizeModifiers.set(attributed, modifier);
            return;
          }
          if (signal.breach !== true) return;
          const attributed = signal.source.includes(":")
            ? signal.source.slice(signal.source.lastIndexOf(":") + 1)
            : undefined;
          if (attributed !== undefined && !this.options.enabledSymbols.has(attributed as ExchangeSymbol)) {
            this.options.logger.warn("strategy.plugin.risk.disabledsymbol", {
              source: signal.source,
              symbol: attributed,
            });
            return;
          }
          this.startEmergencyClose(signal.source);
        }),
      );
      for (const instance of this.options.instances.values()) {
        if (instance.kind !== "plugin") continue;
        instance.instance.subscribe(this.pluginBus);
        started.push(instance);
        this.options.logger.info("strategy.plugin.subscribed", { plugin: instance.name });
      }
    } catch (error) {
      for (const instance of started) {
        try {
          instance.instance.dispose?.();
        } catch {
          // best-effort rollback; retain the original startup error
        }
      }
      throw error;
    }
  }

  private startEmergencyClose(source: string): void {
    if (this.pluginClosePromise !== undefined) return;
    const portfolioManager = this.options.getPortfolioManager();
    const onEmergency = this.options.getOnEmergency();
    if (onEmergency !== undefined) {
      this.options.pause();
      const emergency = Promise.resolve(onEmergency(`plugin-risk: ${source}`));
      this.pluginClosePromise = this.trackEmergencyClose(emergency);
      return;
    }
    if (portfolioManager === undefined) return;
    this.options.pause();
    this.pluginClosePromise = this.trackEmergencyClose(portfolioManager.executeCloseAll());
  }

  private async trackEmergencyClose(emergency: Promise<unknown>): Promise<void> {
    try {
      await emergency;
    } finally {
      this.pluginClosePromise = undefined;
    }
  }

  private startFundingSources(): void {
    for (const instance of this.options.instances.values()) {
      if (instance.kind !== "strategy" || instance.name !== "dydx_cex_carry") continue;
      if (!isFundingStrategy(instance.instance)) {
        this.options.pause();
        throw new Error("[strategy-runner] dydx_cex_carry has an invalid funding strategy contract");
      }
      const strategy = instance.instance;
      const subscription = strategy.config.fundingSource.subscribe(
        strategy.config.market,
        ({ dydx, cex }) => {
          const observedAt = Math.max(dydx.fundingTime, cex.fundingTime);
          const nowMs = Number.isFinite(observedAt) && observedAt >= 0 ? observedAt : Date.now();
          try {
            strategy.recordFundingTick(dydx, cex, nowMs);
          } catch (error) {
            this.options.logger.error("strategy.funding.tick.rejected", {
              strategy: instance.name,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        },
      );
      this.fundingSourceClosers.push(() => {
        subscription.close();
      });
      this.options.logger.info("strategy.funding.source.subscribed", { market: strategy.config.market });
    }
  }

  public start(): void {
    this.startPlugins();
    this.startFundingSources();
  }

  public dispose(): void {
    for (const instance of this.options.instances.values()) {
      if (instance.kind !== "plugin") continue;
      try {
        instance.instance.dispose?.();
      } catch (error) {
        this.options.logger.warn("strategy.plugin.dispose.failed", {
          plugin: instance.name,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    for (const unsubscribe of this.pluginBusUnsubscribers) unsubscribe();
    this.pluginBusUnsubscribers.length = 0;
    for (const close of this.fundingSourceClosers) {
      try {
        close();
      } catch (error) {
        this.options.logger.warn("strategy.funding.subscription.close.failed", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    this.fundingSourceClosers.length = 0;
    this.pluginBus.clear();
  }

  public getRegimeSizeModifier(symbol: ExchangeSymbol): number {
    return this.regimeSizeModifiers.get(symbol) ?? 1;
  }

  public recordPendingRiskClose(positionId: string, clientOrderId: ClientOrderId): void {
    this.pendingRiskCloses.set(positionId, clientOrderId);
  }

  public async requestTrailingStopClose(
    positionId: string,
    closePrice: number,
    reason: string,
  ): Promise<void> {
    if (this.options.isOrderEmissionBlocked() || this.pendingRiskCloses.has(positionId)) return;
    const position = this.options.positionManager.getPositions().find((item) => item.id === positionId);
    if (position === undefined) return;
    this.pendingRiskCloses.set(positionId, undefined);
    const portfolioManager = this.options.getPortfolioManager();
    if (portfolioManager !== undefined) {
      try {
        const isClosed = await portfolioManager.requestPositionClose(position, reason);
        if (isClosed) this.options.getRiskManager()?.disarmTrailingStop(positionId);
      } finally {
        this.pendingRiskCloses.delete(positionId);
      }
      return;
    }
    const closingSide = position.side === "long" ? "sell" : "buy";
    try {
      const order = await this.options.orderManager.placeOrder({
        signal: { side: closingSide, confidence: 1, reason, stopLoss: 0, takeProfit: 0 },
        symbol: position.symbol,
        amount: position.quantity,
        referencePrice: closePrice,
        type: "market",
        reduceOnly: true,
        strategy: position.strategy,
        leverage: position.leverage,
        clientOrderIdHint: `${position.strategy}-trailing-stop`,
      });
      this.options.orderManager.recordFill(order.clientOrderId, order);
      if (order.filled > 0) {
        this.options.positionManager.recordFill({
          strategy: position.strategy,
          symbol: position.symbol,
          side: closingSide === "sell" ? "short" : "long",
          quantity: Math.min(order.filled, position.quantity),
          price: order.average ?? order.price ?? closePrice,
          leverage: position.leverage,
          timestamp: order.updateTimestamp ?? Date.now(),
        });
      }
      const remaining = this.options.positionManager.getPositions().find((item) => item.id === positionId);
      if (remaining === undefined) {
        this.options.getRiskManager()?.disarmTrailingStop(positionId);
        this.pendingRiskCloses.delete(positionId);
        this.options.notifyStrategyClosed(position.strategy, reason);
      } else if (order.status === "open") {
        this.pendingRiskCloses.set(positionId, order.clientOrderId);
      } else {
        this.pendingRiskCloses.delete(positionId);
      }
    } catch (error) {
      this.pendingRiskCloses.delete(positionId);
      this.options.logger.error("strategy.trailingstop.close.failed", {
        positionId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  public async reconcileRiskCloses(symbol: ExchangeSymbol): Promise<void> {
    for (const [positionId, clientOrderId] of this.pendingRiskCloses) {
      if (clientOrderId === undefined) continue;
      const position = this.options.positionManager.getPositions().find((item) => item.id === positionId);
      if (position === undefined) {
        this.options.getRiskManager()?.disarmTrailingStop(positionId);
        this.pendingRiskCloses.delete(positionId);
        continue;
      }
      if (position.symbol !== symbol) continue;
      try {
        const { order, deltaFilled } = await this.options.orderManager.reconcileOrder(clientOrderId, symbol);
        if (deltaFilled > 0) {
          const closingSide = position.side === "long" ? "sell" : "buy";
          this.options.positionManager.recordFill({
            strategy: position.strategy,
            symbol,
            side: closingSide === "sell" ? "short" : "long",
            quantity: Math.min(deltaFilled, position.quantity),
            price:
              order.average ?? order.price ?? this.options.latestPriceFor(symbol) ?? position.currentPrice,
            leverage: position.leverage,
            timestamp: order.updateTimestamp ?? Date.now(),
          });
        }
        const remaining = this.options.positionManager.getPositions().find((item) => item.id === positionId);
        if (remaining === undefined) {
          this.options.getRiskManager()?.disarmTrailingStop(positionId);
          this.pendingRiskCloses.delete(positionId);
          this.options.notifyStrategyClosed(position.strategy, "risk_close");
        } else if (order.status !== "open") {
          this.pendingRiskCloses.delete(positionId);
        }
      } catch (error) {
        this.options.logger.warn("strategy.trailingstop.reconciliation.failed", {
          positionId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  public async processPlugins(symbol: ExchangeSymbol, timeframe: string, bar: Bar): Promise<void> {
    for (const instance of this.options.instances.values()) {
      if (instance.kind !== "plugin") continue;
      try {
        if (timeframe === "1d" && instance.name === "regime_detector") {
          if (!isRegimeDetectorPlugin(instance.instance)) {
            throw new Error("[strategy-runner] regime detector is missing recordClose");
          }
          instance.instance.recordClose(symbol, bar.close, bar.timestamp);
        }
        await instance.instance.onBar(bar, pluginState(instance.instance));
      } catch (error) {
        this.options.logger.error("strategy.plugin.bar.handler.failed", {
          plugin: instance.name,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    this.pluginBus.drain();
  }

  public applyRiskCloseLifecycle(event: OrderLifecycleEvent): boolean {
    const { order, deltaFilled } = event;
    for (const [positionId, clientOrderId] of this.pendingRiskCloses) {
      if (clientOrderId !== order.clientOrderId) continue;
      const position = this.options.positionManager.getPositions().find((item) => item.id === positionId);
      if (position !== undefined && deltaFilled > 0) {
        const closingSide = position.side === "long" ? "sell" : "buy";
        this.options.positionManager.recordFill({
          strategy: position.strategy,
          symbol: order.symbol,
          side: closingSide === "sell" ? "short" : "long",
          quantity: Math.min(deltaFilled, position.quantity),
          price:
            event.kind === "execution"
              ? event.execution.price
              : (order.average ?? order.price ?? position.currentPrice),
          leverage: position.leverage,
          timestamp: order.updateTimestamp ?? Date.now(),
        });
      }
      const remaining = this.options.positionManager.getPositions().find((item) => item.id === positionId);
      if (remaining === undefined) {
        this.options.getRiskManager()?.disarmTrailingStop(positionId);
        this.pendingRiskCloses.delete(positionId);
        if (position !== undefined) this.options.notifyStrategyClosed(position.strategy, "risk_close");
      } else if (order.status !== "open") {
        this.pendingRiskCloses.delete(positionId);
      }
      return true;
    }
    return false;
  }
}
