import { symbolOf, type ExchangeFeed } from "@mm-crypto-bot/exchange";
import type { DydxFundingSource } from "@mm-crypto-bot/core";
import type { Logger } from "@mm-crypto-bot/logging";

import { createStrategyInstances, type BotStrategyInstance } from "../config/strategy-registry.js";
import type { BotConfig, StrategyName } from "../config/schema.js";
import {
  CorrelationMatrix,
  PortfolioManager,
  PortfolioStop,
  RiskBudgetAllocator,
} from "../portfolio/index.js";
import { RiskManager } from "../risk/index.js";
import type { KillSwitch, KillSwitchRegistry } from "./kill-switches.js";
import { createDefaultRegistry } from "./kill-switches.js";
import { MockDydxFundingSource } from "./mock-dydx-funding-source.js";
import {
  PreparedLiveEquityAuthority,
  createLiveEquityPreparationRequest,
  liveEquitySystemClock,
} from "./live-equity-authority.js";
import { OrderManager } from "./order-manager.js";
import type { PaperOrderSimulator } from "./order-manager.types.js";
import { PositionManager } from "./position-manager.js";
import { StateStore } from "./state-store.js";
import {
  StrategyRunner,
  defaultSizingFn as defaultSizingFunction,
  type StrategyRunnerOptions,
} from "./strategy-runner.js";
import { Telemetry, type TelemetrySnapshot } from "./telemetry.js";

export interface BotRuntimeContext {
  readonly feed: ExchangeFeed;
  readonly runner: StrategyRunner;
  readonly positionManager: PositionManager;
  readonly riskManager: RiskManager;
  readonly killSwitches: KillSwitchRegistry;
  readonly telemetry: Telemetry;
  readonly portfolioManager: PortfolioManager;
  readonly emergencyHandler: (reason: string) => Promise<void>;
  readonly preparedLiveEquity: PreparedLiveEquityAuthority | undefined;
}

export interface BotRuntimeAssemblyResult {
  readonly context: BotRuntimeContext;
  readonly fundingSource: DydxFundingSource | null;
  readonly orderManager: OrderManager;
  readonly stateStore: StateStore;
  readonly strategyInstances: ReadonlyMap<StrategyName, BotStrategyInstance>;
  readonly riskBudget: RiskBudgetAllocator;
  readonly correlation: CorrelationMatrix;
  readonly portfolioStop: PortfolioStop;
}

export interface BotRuntimeAssemblyOptions {
  readonly config: BotConfig;
  readonly feed: ExchangeFeed;
  readonly initialEquity: number;
  readonly preparedLiveEquity?: PreparedLiveEquityAuthority;
  readonly fundingSource: DydxFundingSource | null | undefined;
  readonly sizingFn: StrategyRunnerOptions["sizingFn"] | undefined;
  readonly perStrategyKillSwitches: readonly KillSwitch[] | undefined;
  readonly paperOrderSimulator?: PaperOrderSimulator;
  readonly telemetryMetricsIntervalSec: number;
  readonly logger: Logger;
  readonly createEmergencyHandler: (portfolioManager: PortfolioManager) => (reason: string) => Promise<void>;
  readonly snapshotProvider: (
    positionManager: PositionManager,
    orderManager: OrderManager,
    runner: StrategyRunner,
  ) => TelemetrySnapshot;
}

/**
 * Builds one immutable runtime graph after the feed and initial equity exist.
 */
export class BotRuntimeAssembly {
  public static async create(options: BotRuntimeAssemblyOptions): Promise<BotRuntimeAssemblyResult> {
    return new BotRuntimeAssembly().assemble(options);
  }

  private async assemble(options: BotRuntimeAssemblyOptions): Promise<BotRuntimeAssemblyResult> {
    const preparedLiveEquity =
      options.config.bot.mode === "live"
        ? PreparedLiveEquityAuthority.require(
            options.preparedLiveEquity,
            createLiveEquityPreparationRequest({
              feed: options.feed,
              symbols: options.config.symbols.enabled.map((symbol) => symbolOf(symbol)),
              maxAgeMs: 60_000,
              now: liveEquitySystemClock,
              maxDrawdownFraction: options.config.risk.max_drawdown_pct.toString(),
            }),
            options.initialEquity,
          )
        : undefined;
    if (options.config.bot.mode === "paper" && options.preparedLiveEquity !== undefined) {
      throw new Error("Bot: paper runtime rejects prepared live equity authority.");
    }
    const positionManager = new PositionManager({
      initialEquityUsd: options.initialEquity,
      maxPositions: options.config.risk.max_positions,
      maxLeverage: options.config.risk.max_leverage,
      aggregateExposureLimit: {
        maxAggregateEffectiveLeverage: options.config.risk.max_leverage,
        tolerance: 0,
        warnOnApproach: 0.95,
      },
      logger: options.logger,
    });
    const riskManager = new RiskManager({
      trailingStop: {
        enabled: options.config.risk.trailing_stop.enabled,
        atrPeriod: options.config.risk.trailing_stop.atr_period,
        atrMultiplier: options.config.risk.trailing_stop.atr_multiplier,
        side: options.config.risk.trailing_stop.side,
      },
      kelly: {
        enabled: options.config.risk.kelly.enabled,
        fraction: options.config.risk.kelly.fraction,
        windowSize: options.config.risk.kelly.window_size,
        minTrades: options.config.risk.kelly.min_trades,
        fallbackFraction: options.config.risk.kelly.fallback_fraction,
        maxFraction: options.config.risk.max_position_fraction,
      },
      drawdownScaler: {
        enabled: options.config.risk.drawdown_scaler.enabled,
        maxDdPct: options.config.risk.drawdown_scaler.max_dd_pct,
        initialEquity: options.initialEquity,
      },
      logger: options.logger,
    });
    positionManager.setRiskManager(riskManager);
    const stateStore = new StateStore({ filePath: options.config.bot.state_file, logger: options.logger });
    const loadedState = stateStore.load();
    if (loadedState !== null) this.restoreState(positionManager, loadedState, options.logger);
    const orderManager = new OrderManager({
      feed: options.feed,
      getPositionContext: () => positionManager.getPositionContext(),
      getReduciblePosition: (symbol, strategy) => {
        const position = positionManager
          .getPositions()
          .find((item) => item.symbol === symbol && (strategy === undefined || item.strategy === strategy));
        return position === undefined ? undefined : { side: position.side, quantity: position.quantity };
      },
      aggregateExposureLimit: {
        maxAggregateEffectiveLeverage: options.config.risk.max_leverage,
        tolerance: 0,
        warnOnApproach: 0.95,
      },
      logger: options.logger,
      paperMode: options.config.bot.mode === "paper",
      ...(preparedLiveEquity !== undefined && { liveAuthority: preparedLiveEquity.authority }),
      ...(options.paperOrderSimulator !== undefined && {
        paperOrderSimulator: options.paperOrderSimulator,
      }),
    });
    const fundingSource = this.resolveFundingSource(options);
    const instances = createStrategyInstances(options.config, {
      ...(fundingSource !== null && { dydxFundingSource: fundingSource }),
    });
    const strategyNames: StrategyName[] = [];
    instances.forEach((_, strategyName) => {
      strategyNames.push(strategyName);
    });
    options.logger.info("bot.strategy.instances.created", {
      count: instances.size,
      names: strategyNames,
    });
    const riskBudget = new RiskBudgetAllocator({
      totalRiskUsd: options.config.portfolio.total_risk_per_cycle_usd,
      correlationPenaltyThreshold: options.config.portfolio.correlation_penalty_threshold,
      logger: options.logger,
    });
    const correlation = new CorrelationMatrix({
      windowSize: options.config.portfolio.correlation_window_size,
      logger: options.logger,
    });
    const portfolioStop = new PortfolioStop({
      maxDdPct: options.config.portfolio.max_dd_pct,
      logger: options.logger,
    });
    const portfolioManager = new PortfolioManager({
      riskBudget,
      correlation,
      portfolioStop,
      positionManager,
      orderManager,
      requireAuthoritativeEmergencyState: options.config.bot.mode === "live",
      configuredSymbols: options.config.symbols.enabled,
      logger: options.logger,
    });
    for (const [strategyName, section] of Object.entries(options.config.strategies)) {
      if (!section.enabled) continue;
      const cap = (section as { readonly cap?: number }).cap ?? 0.1;
      portfolioManager.setStrategyConfig({
        strategyId: strategyName,
        weight: cap,
        riskPerTrade: options.config.risk.risk_per_trade,
      });
    }
    options.logger.info("bot.portfolio.summary", {
      enabledStrategies: instances.size,
      totalRiskUsd: riskBudget.getTotalRiskUsd(),
      correlationPenaltyThreshold: riskBudget.getCorrelationPenaltyThreshold(),
      correlationWindowSize: correlation.getWindowSize(),
      maxDdPct: portfolioStop.getMaxDdPct(),
      perStrategyBudget: Object.fromEntries(portfolioManager.getPerStrategyBudget()),
    });
    const emergencyHandler = options.createEmergencyHandler(portfolioManager);
    const runner = new StrategyRunner({
      instances,
      orderManager,
      positionManager,
      sizingFn: options.sizingFn ?? defaultSizingFunction,
      enabledSymbols: options.config.symbols.enabled,
      riskPerTrade: options.config.risk.risk_per_trade,
      maxLeverage: options.config.risk.max_leverage,
      strategyPolicies: this.strategyPolicies(options.config),
      riskManager,
      portfolioManager,
      onEmergency: emergencyHandler,
      logger: options.logger,
    });
    await orderManager.startLifecycle();
    const killSwitches = createDefaultRegistry({
      positionManager,
      maxDrawdownPct: options.config.risk.max_drawdown_pct,
      maxPositions: options.config.risk.max_positions,
      ...(options.perStrategyKillSwitches !== undefined && {
        perStrategyKillSwitches: options.perStrategyKillSwitches,
      }),
      logger: options.logger,
    });
    killSwitches.onTrigger(async (snapshot) => {
      await emergencyHandler(`kill-switch: ${snapshot.reasons.join(", ")}`);
    });
    const telemetry = new Telemetry({
      metricsIntervalSec: options.telemetryMetricsIntervalSec,
      snapshotProvider: () => options.snapshotProvider(positionManager, orderManager, runner),
      logger: options.logger,
    });
    telemetry.start();
    return {
      context: {
        feed: options.feed,
        runner,
        positionManager,
        riskManager,
        killSwitches,
        telemetry,
        portfolioManager,
        emergencyHandler,
        preparedLiveEquity,
      },
      fundingSource,
      orderManager,
      stateStore,
      strategyInstances: instances,
      riskBudget,
      correlation,
      portfolioStop,
    };
  }

  private resolveFundingSource(options: BotRuntimeAssemblyOptions): DydxFundingSource | null {
    if (options.fundingSource !== undefined) return options.fundingSource;
    // eslint-disable-next-line unicorn/no-null -- The runtime result distinguishes an intentionally absent funding source from an omitted option.
    return options.config.bot.mode === "paper" ? new MockDydxFundingSource() : null;
  }

  private restoreState(
    positionManager: PositionManager,
    loadedState: ReturnType<StateStore["load"]> extends infer State ? Exclude<State, null> : never,
    logger: Logger,
  ): void {
    const restoredClosedTrades = loadedState.closedTrades.map((trade) => ({
      ...trade,
      symbol: symbolOf(trade.symbol),
    }));
    const restoredPositions = loadedState.positions.map((position) => ({
      ...position,
      symbol: symbolOf(position.symbol),
    }));
    if (loadedState.realizedPnlUsd !== 0) positionManager.restoreRealizedPnl(loadedState.realizedPnlUsd);
    if (loadedState.closedTrades.length > 0) {
      positionManager.restoreClosedTrades(restoredClosedTrades);
    }
    if (loadedState.positions.length === 0) return;
    logger.info("bot.positions.state.restoring", {
      count: loadedState.positions.length,
      strategies: [...new Set(loadedState.positions.map((position) => position.strategy))],
    });
    for (const position of restoredPositions) positionManager.restorePosition(position);
  }

  private strategyPolicies(
    config: BotConfig,
  ): ReadonlyMap<
    StrategyName,
    NonNullable<StrategyRunnerOptions["strategyPolicies"]> extends ReadonlyMap<StrategyName, infer Policy>
      ? Policy
      : never
  > {
    return new Map(
      Object.entries(config.strategies)
        .filter(([, section]) => section.enabled)
        .map(([name, section]) => [
          name as StrategyName,
          {
            ...(section.symbols !== undefined && { symbols: section.symbols }),
            ...(section.risk_per_trade !== undefined && { riskPerTrade: section.risk_per_trade }),
            ...(section.max_positions !== undefined && { maxPositions: section.max_positions }),
          },
        ]),
    );
  }
}
