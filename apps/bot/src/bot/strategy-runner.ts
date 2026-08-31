/**
 * apps/bot/src/bot/strategy-runner.ts
 *
 * Phase 33 Track C — `StrategyRunner` — a futó stratégiák + signal-
 * center plugin-ok esemény-loopja.
 *
 * ===========================================================================
 * FELELŐSSÉGEK
 * ===========================================================================
 *   1) Nyilvántartja az aktív stratégiákat + plugin-okat (a Track B
 *      `createStrategyInstances` Map-jéből jön).
 *   2) A feed-en érkező `FeedEvent`-et átalakítja a megfelelő formátumra:
 *      - `ohlcv` event → `StrategyContext` (candle + HTF/MTF/LTF indikátorok).
 *      - `ticker` event → market price update (a PositionManager `updateMarketPrice`).
 *      - `trade` event → figyelmen kívül hagyjuk (a StrategySignal a primary trigger).
 *   3) A `Strategy.onCandle` visszatérési `StrategySignal`-ját átadja
 *      az `OrderManager.placeOrder`-nek.
 *   4) Per-strategy state: utolsó signal idő, utolsó candle timestamp.
 *
 * ===========================================================================
 * TERVEZÉS
 * ===========================================================================
 * A StrategyRunner nem tartja a HTF/MTF indikátor-állapotot (a
 * `DonchianPivotComposition` saját maga számolja az M15-ön — lásd
 * `packages/core/src/strategy/donchian-pivot-composition.ts`). A
 * `StrategyContext` HTF/MTF mezői `undefined` maradnak, mert a
 * jelenlegi production stratégiák (Phase 18+) M15-native-ok. A
 * future track-ek (M5 breakout, M1 grid) kerülnek ide.
 *
 * A signal-center plugin-ok (`StrategyPlugin`) a `SignalBus`-on
 * keresztül kapják a feed-et — itt a jelenlegi fázisban NEM
 * iratkozunk fel a bus-ra (a Phase 11+ drop-in-ek jelenleg backtest-
 * only-k, lásd Phase 32 cleanup). A StrategyRunner a `kind: "strategy"`
 * instance-okra koncentrál; a `kind: "plugin"` instance-ok
 * nyilvántartva vannak, de a jelen fázisban nem aktívak (a Phase 33
 * scope plan §"Track C" ezt írja elő).
 */

import type { ClientOrderId, FeedEvent, Symbol as ExchangeSymbol } from "@mm-crypto-bot/exchange";
import { assertDefined } from "@mm-crypto-bot/assert";
import { requireLogger, type Logger } from "@mm-crypto-bot/logging";
import type { Brand } from "@mm-crypto-bot/shared";

import type { StrategyName } from "../config/schema.js";
import type { BotStrategyInstance } from "../config/strategy-registry.js";
import type { RiskManager } from "../risk/index.js";
import type { PortfolioManager } from "../portfolio/index.js";
import type { OrderLifecycleEvent, OrderManager } from "./order-manager.js";
import type { PositionManager, PositionSnapshot } from "./position-manager.js";
import type { BotState } from "./state-store.js";
import { StrategyRunnerEventSerializer } from "./strategy-runner.event-serializer.js";
import { StrategyMarketEventController } from "./strategy-runner-market-event-controller.js";
import { StrategyNativeProtectionController } from "./strategy-runner-native-protection-controller.js";
import { StrategyOrderLifecycleController } from "./strategy-runner-order-lifecycle-controller.js";
import { StrategyPaperProtectionController } from "./strategy-runner-paper-protection-controller.js";
import { StrategyPluginRiskController } from "./strategy-runner-plugin-risk-controller.js";
import type {
  NativeProtectionGroup,
  NativeProtectionInput,
  SizingFn as StrategySizingFunction,
  StrategyRunnerOptions,
  StrategyRunnerStats,
  StrategyRuntimePolicy,
} from "./strategy-runner.types.js";

export type {
  SizingFn,
  StrategyRunnerOptions,
  StrategyRunnerStats,
  StrategyRuntimePolicy,
} from "./strategy-runner.types.js";

// ============================================================================
// StrategyRunner class
// ============================================================================

/**
 * `StrategyRunner` — a futó stratégiák + plugin-ok esemény-loopja.
 *
 * A `Bot.run()` ciklusban minden bejövő `FeedEvent`-et a `onFeedEvent()`
 * metóduson keresztül dolgoz fel. Az OHLCV event-eket candle-ökké
 * alakítja, és minden `kind: "strategy"` instance `onCandle`-jét
 * meghívja. A visszakapott `StrategySignal`-t az OrderManager-re bízza.
 */
export class StrategyRunner {
  private readonly instances: ReadonlyMap<StrategyName, BotStrategyInstance>;
  private readonly orderManager: OrderManager;
  private readonly positionManager: PositionManager;
  private readonly sizingFn: StrategySizingFunction;
  private readonly enabledSymbols: ReadonlySet<ExchangeSymbol>;
  private readonly strategyPolicies: ReadonlyMap<StrategyName, StrategyRuntimePolicy>;
  private readonly portfolioManager: PortfolioManager | undefined;
  private readonly onEmergency: ((reason: string) => void | Promise<void>) | undefined;
  private readonly logger: Logger;
  private paused = false;
  private pluginsDisposed = false;

  // Sizing constants
  private readonly riskPerTrade: number;
  private readonly maxLeverage: number;
  /**
  Same-symbol event work is chained so an awaiting placement cannot race a second bar.
  */
  private readonly symbolWork = new Map<ExchangeSymbol, Promise<void>>();
  private readonly eventSerializer = new StrategyRunnerEventSerializer(this.symbolWork);
  /**
  Each post-fill native protective order is independently reconciled.
  */
  private readonly nativeProtectionController: StrategyNativeProtectionController;
  private readonly pluginRiskController: StrategyPluginRiskController;
  private readonly marketEventController: StrategyMarketEventController;
  private readonly orderLifecycleController: StrategyOrderLifecycleController;
  private readonly paperProtectionController: StrategyPaperProtectionController;
  private readonly unsubscribeOrderLifecycle: () => void;

  private readonly isOrderEmissionBlocked = (): boolean => this.paused || this.pluginsDisposed;

  private readonly requestTrailingStopClose = async (
    positionId: string,
    closePrice: number,
    reason: string,
  ): Promise<void> => {
    await this.pluginRiskController.requestTrailingStopClose(positionId, closePrice, reason);
  };

  private readonly findOpenPosition = (
    strategyName: StrategyName,
    symbol: ExchangeSymbol,
  ): PositionSnapshot | undefined => {
    for (const position of this.positionManager.getPositions()) {
      if (position.strategy === strategyName && position.symbol === symbol) return position;
    }
    return undefined;
  };

  private readonly requireLatestPrice = (symbol: ExchangeSymbol): number => {
    const latestPrice = this.marketEventController.getLatestPrice(symbol);
    assertDefined(latestPrice, "native protection lifecycle is missing its prior market price");
    return latestPrice;
  };

  private readonly protectionKey = (strategy: string, symbol: ExchangeSymbol): string =>
    this.paperProtectionController.protectionKey(strategy, symbol);

  /**
   * `riskManager` — Phase 37 Track 1. Optional. If set, the runner
   * queries `riskManager.evaluateNewPositionSize(...)` BEFORE
   * calling `sizingFn`, and uses the returned fraction (after
   * dividing by `referencePrice` and multiplying by `equity`).
   * If unset, the established `sizingFn` path is used.
   */
  private riskManager: RiskManager | undefined;

  public constructor(options: StrategyRunnerOptions) {
    this.instances = options.instances;
    this.orderManager = options.orderManager;
    this.positionManager = options.positionManager;
    this.sizingFn = options.sizingFn;
    this.enabledSymbols = new Set(
      options.enabledSymbols.map((s) => s as Brand<string, "ExchangeSymbol"> as unknown as ExchangeSymbol),
    );
    this.strategyPolicies = options.strategyPolicies ?? new Map();
    this.riskPerTrade = options.riskPerTrade ?? 0.01;
    this.maxLeverage = options.maxLeverage ?? 1;
    if (!Number.isFinite(this.maxLeverage) || this.maxLeverage <= 0) {
      throw new Error(
        `[strategy-runner] maxLeverage must be positive finite, got ${String(this.maxLeverage)}`,
      );
    }
    for (const [strategy, policy] of this.strategyPolicies) {
      if (policy.leverage !== undefined && (!Number.isFinite(policy.leverage) || policy.leverage <= 0)) {
        throw new Error(
          `[strategy-runner] ${strategy} leverage must be positive finite, got ${String(policy.leverage)}`,
        );
      }
    }
    this.riskManager = options.riskManager;
    this.portfolioManager = options.portfolioManager ?? undefined;
    this.onEmergency = options.onEmergency;
    this.logger = requireLogger(options.logger, "strategy-runner");
    this.paperProtectionController = new StrategyPaperProtectionController({
      orderManager: this.orderManager,
      positionManager: this.positionManager,
    });
    this.marketEventController = new StrategyMarketEventController({
      instances: this.instances,
      positionManager: this.positionManager,
      enabledSymbols: this.enabledSymbols,
      strategyPolicies: this.strategyPolicies,
      logger: this.logger,
      isOrderEmissionBlocked: () => this.isOrderEmissionBlocked(),
      reconcilePendingOrders: async (symbol) => this.orderLifecycleController.reconcilePendingOrders(symbol),
      reconcileRiskCloses: async (symbol) => this.pluginRiskController.reconcileRiskCloses(symbol),
      processPlugins: async (symbol, timeframe, bar) =>
        this.pluginRiskController.processPlugins(symbol, timeframe, bar),
      findOpenPosition: (strategyName, symbol) => this.findOpenPosition(strategyName, symbol),
      enforceProtection: async (strategyName, strategy, position, candle) =>
        this.paperProtectionController.enforceProtection(strategyName, strategy, position, candle),
      getPortfolioManager: () => this.portfolioManager,
      requestTrailingStopClose: async (positionId, closePrice, reason) =>
        this.requestTrailingStopClose(positionId, closePrice, reason),
      handleSignal: async (strategyName, strategy, signal, symbol, referencePrice, policy) =>
        this.orderLifecycleController.handleSignal(
          strategyName,
          strategy,
          signal,
          symbol,
          referencePrice,
          policy,
        ),
    });
    this.pluginRiskController = new StrategyPluginRiskController({
      instances: this.instances,
      orderManager: this.orderManager,
      positionManager: this.positionManager,
      enabledSymbols: this.enabledSymbols,
      logger: this.logger,
      isOrderEmissionBlocked: () => this.isOrderEmissionBlocked(),
      pause: () => {
        this.pause();
      },
      getRiskManager: () => this.riskManager,
      getPortfolioManager: () => this.portfolioManager,
      getOnEmergency: () => this.onEmergency,
      latestPriceFor: (symbol) => this.marketEventController.getLatestPrice(symbol),
      notifyStrategyClosed: (strategyName, reason) => {
        this.notifyStrategyClosed(strategyName, reason);
      },
    });
    this.nativeProtectionController = new StrategyNativeProtectionController({
      orderManager: this.orderManager,
      positionManager: this.positionManager,
      portfolioManager: this.portfolioManager,
      logger: this.logger,
      findOpenPosition: this.findOpenPosition,
      protectionKey: (strategyName, symbol) => this.protectionKey(strategyName, symbol),
      latestPriceFor: (symbol) => this.marketEventController.getLatestPrice(symbol),
      recordPendingRiskClose: (positionId, clientOrderId) => {
        this.pluginRiskController.recordPendingRiskClose(positionId, clientOrderId);
      },
      setPaperProtection: (key, protection) => {
        this.paperProtectionController.setPaperProtection(key, protection);
      },
    });
    this.orderLifecycleController = new StrategyOrderLifecycleController({
      orderManager: this.orderManager,
      positionManager: this.positionManager,
      sizingFn: this.sizingFn,
      riskPerTrade: this.riskPerTrade,
      maxLeverage: this.maxLeverage,
      logger: this.logger,
      isOrderEmissionBlocked: () => this.isOrderEmissionBlocked(),
      getRiskManager: () => this.riskManager,
      getPortfolioManager: () => this.portfolioManager,
      getRegimeSizeModifier: (symbol) => this.pluginRiskController.getRegimeSizeModifier(symbol),
      protectionKey: (strategy, symbol) => this.protectionKey(strategy, symbol),
      latestPriceFor: (symbol) => this.marketEventController.getLatestPrice(symbol),
      installProtections: async (input) => this.installProtections(input),
      reconcileNativeProtections: async (symbol) => this.reconcileNativeProtections(symbol),
    });
    this.unsubscribeOrderLifecycle = this.orderManager.onLifecycle((event) => {
      void this.onOrderLifecycle(event);
    });
    this.pluginRiskController.start();
    this.riskManager?.onTrailingStopClose((event) => {
      void this.requestTrailingStopClose(event.positionId, event.closePrice, event.reason);
    });
  }

  private async onOrderLifecycle(event: OrderLifecycleEvent): Promise<void> {
    const symbol = event.order.symbol;
    await this.eventSerializer.enqueue(symbol, async () => this.applyOrderLifecycle(event));
  }

  private async applyOrderLifecycle(event: OrderLifecycleEvent): Promise<void> {
    const { order, deltaFilled } = event;
    if (await this.orderLifecycleController.applyPendingOrderLifecycle(event)) return;
    const symbol = order.symbol;
    const protection = this.nativeProtectionController.getNativeProtection(order.clientOrderId);
    if (protection !== undefined) {
      const group = this.nativeProtectionController.getGroup(this.protectionKey(protection.strategy, symbol));
      if (deltaFilled > 0) {
        const position = this.findOpenPosition(protection.strategy, symbol);
        if (position !== undefined) {
          const closingSide = protection.side === "long" ? "sell" : "buy";
          this.positionManager.recordFill({
            strategy: protection.strategy,
            symbol,
            side: closingSide === "sell" ? "short" : "long",
            quantity: Math.min(deltaFilled, position.quantity),
            price:
              event.kind === "execution"
                ? event.execution.price
                : (order.average ?? order.price ?? this.requireLatestPrice(symbol)),
            leverage: protection.leverage,
            timestamp: order.updateTimestamp ?? Date.now(),
          });
        }
        const remaining = this.findOpenPosition(protection.strategy, symbol);
        if (remaining === undefined) this.notifyStrategyClosed(protection.strategy, protection.kind);
        if (group !== undefined) {
          group.desired =
            remaining === undefined
              ? undefined
              : {
                  strategy: protection.strategy,
                  symbol,
                  side: protection.side,
                  quantity: remaining.quantity,
                  leverage: protection.leverage,
                  signal: protection.signal,
                  referencePrice: remaining.currentPrice,
                };
        }
      }
      if (group !== undefined && order.status !== "open")
        this.retireProtectionLeg(group, order.clientOrderId);
      if (group !== undefined && deltaFilled > 0) await this.requestProtectionCancellation(group);
      if (group !== undefined) await this.settleProtectionGroup(group);
      return;
    }
    this.pluginRiskController.applyRiskCloseLifecycle(event);
  }

  private notifyStrategyClosed(strategyName: string, reason: string): void {
    const instance = this.instances.get(strategyName as StrategyName);
    if (instance?.kind === "strategy") instance.instance.onPositionClosed?.(reason);
  }

  private async installProtections(input: NativeProtectionInput): Promise<void> {
    await this.nativeProtectionController.installProtections(input);
  }

  private async reconcileNativeProtections(symbol: ExchangeSymbol): Promise<void> {
    await this.nativeProtectionController.reconcileNativeProtections(symbol);
  }

  private async requestProtectionCancellation(group: NativeProtectionGroup): Promise<void> {
    await this.nativeProtectionController.requestProtectionCancellation(group);
  }

  private retireProtectionLeg(group: NativeProtectionGroup, id: ClientOrderId): void {
    this.nativeProtectionController.retireProtectionLeg(group, id);
  }

  private async settleProtectionGroup(group: NativeProtectionGroup): Promise<void> {
    await this.nativeProtectionController.settleProtectionGroup(group);
  }

  /**
   * `setRiskManager` — Phase 37 Track 1 wiring. Attach / detach the
   * `RiskManager` that recomputes position size before every order.
   * Detach with `null` to revert to the established `sizingFn` path.
   */
  public setRiskManager(rm: RiskManager | null): void {
    this.riskManager = rm ?? undefined;
  }

  /**
  Stop accepting feed work and, independently, block order emission.
  */
  public pause(): void {
    this.paused = true;
  }

  /**
  Resume normal event handling after an operator-initiated pause.
  */
  public resume(): void {
    if (!this.pluginsDisposed) this.paused = false;
  }

  public isPaused(): boolean {
    return this.paused;
  }

  /**
  Release enabled plugin subscriptions exactly once during Bot cleanup.
  */
  public dispose(): void {
    if (this.pluginsDisposed) return;
    this.pluginsDisposed = true;
    this.paused = true;
    this.unsubscribeOrderLifecycle();
    this.pluginRiskController.dispose();
  }

  // --------------------------------------------------------------------------
  // Event loop
  // --------------------------------------------------------------------------

  /**
   * `onFeedEvent` — a feed-en érkező event feldolgozása.
   *
   * - `ticker`   → frissíti a `latestPrice` cache-t, és a
   *                PositionManager `updateMarketPrice`-ját hívja.
   * - `ohlcv`    → a candle-t `StrategyContext`-té alakítja, és
   *                minden `kind: "strategy"` instance `onCandle`-jét
   *                meghívja. A nem-null `StrategySignal`-t az
   *                OrderManager-re bízza.
   * - `orderbook`/`trade` → figyelmen kívül hagyjuk a jelen fázisban
   *   (a StrategySignal a primary trigger, nem a microstructure).
   */
  public async onFeedEvent(event: FeedEvent): Promise<void> {
    if (event.kind === "ohlcv") {
      await this.eventSerializer.enqueue(event.payload.symbol, async () =>
        this.marketEventController.onFeedEventSerial(event),
      );
      return;
    }
    await this.marketEventController.onFeedEventSerial(event);
  }

  /**
   * `getStats` — a runner statisztikái.
   */
  public getStats(): StrategyRunnerStats {
    const activeStrategies: StrategyName[] = [];
    this.instances.forEach((_instance, strategyName) => {
      activeStrategies.push(strategyName);
    });
    return {
      activeStrategies,
      totalSignals: this.orderLifecycleController.getTotalSignals(),
      // eslint-disable-next-line unicorn/no-null -- public serialized stats contract uses explicit null for no observed signal.
      lastSignalAt: this.orderLifecycleController.getLastSignalAt() ?? null,
      // eslint-disable-next-line unicorn/no-null -- public serialized stats contract uses explicit null for no observed signal.
      lastSignalStrategy: this.orderLifecycleController.getLastSignalStrategy() ?? null,
      ticksProcessed: this.marketEventController.getTicksProcessed(),
    };
  }

  /**
   * `getActiveStrategyNames` — az aktív stratégiák nevei.
   */
  public getActiveStrategyNames(): readonly StrategyName[] {
    const activeStrategies: StrategyName[] = [];
    this.instances.forEach((_instance, strategyName) => {
      activeStrategies.push(strategyName);
    });
    return activeStrategies;
  }
}

// ============================================================================
// Position-sizing helpers
// ============================================================================

/**
 * `defaultSizingFn` — a legegyszerűbb sizing: equity × risk_per_trade
 * / referencePrice. A `Bot` default-ja; a `mm-bot` CLI override-olhatja
 * (a Phase 33 Track D CLI-ban).
 */
// eslint-disable-next-line unicorn/name-replacements -- defaultSizingFn is an established public API contract.
export const defaultSizingFn: StrategySizingFunction = (parameters) => {
  const { referencePrice, equityUsd, riskPerTrade } = parameters;
  if (referencePrice <= 0) return 0;
  return (equityUsd * riskPerTrade) / referencePrice;
};

/**
 * `appendRunnerStatsToState` — a runner statisztikáit hozzáfűzi a
 * `BotState`-hez (külön mezők nélkül, a counters-en keresztül).
 */
export function runnerStatsToState(_stats: StrategyRunnerStats, state: BotState): BotState {
  return {
    ...state,
    counters: state.counters,
  };
}
