import type { ExchangeFeed } from "@mm-crypto-bot/exchange";
import { createExchangeClient } from "@mm-crypto-bot/exchange";
import type { DydxFundingSource } from "@mm-crypto-bot/core";
import { requireLogger, type Logger } from "@mm-crypto-bot/logging";

import type { BotConfig } from "../config/schema.js";
import type { PortfolioManager } from "../portfolio/index.js";

import type { OrderManager } from "./order-manager.js";
import type { PaperOrderSimulator } from "./order-manager.types.js";
import { BotExchangeInitializer } from "./bot-exchange-initializer.js";
import { BotRuntimeAssembly } from "./bot-runtime-assembly.js";
import { BotRuntimeController } from "./bot-runtime-controller.js";
import type { PositionManager } from "./position-manager.js";
import type { StateStore } from "./state-store.js";
import { type BotState } from "./state-store.js";
import type { Telemetry } from "./telemetry.js";
import { formatUptime } from "./telemetry.js";
import type { KillSwitchRegistry, KillSwitch } from "./kill-switches.js";
import type { StrategyRunner } from "./strategy-runner.js";
import { type StrategyRunnerOptions } from "./strategy-runner.js";
import type { RiskManager } from "../risk/index.js";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Package-internal cleanup seam for the private order lifecycle.
 */
export async function stopLifecycleForCleanup(
  stopLifecycle: () => Promise<void>,
  logger: Logger,
): Promise<void> {
  try {
    await stopLifecycle();
  } catch (error) {
    logger.warn("bot.lifecycle.privatecleanup.failed", { error: errorMessage(error) });
  }
}

// ============================================================================
// Public types
// ============================================================================

/**
 * `BotOptions` — a Bot konstruktor opciói.
 *
 * - `config`          — a `loadBotConfig` által szolgáltatott `BotConfig`.
 * - `feed`            — opcionális feed override (pl. mock feed a wire-up probe-hoz).
 *                       Ha `undefined`, a `config.exchange.id` alapján
 *                       `createExchangeClient` hívódik.
 * - `fundingSource`   — opcionális `DydxFundingSource` (a `dydx_cex_carry`
 *                       stratégia számára; ha a config nem engedélyezi,
 *                       a dependency nem kell).
 * - `sizingFn`        — opcionális position-sizing override (alap: `defaultSizingFn`).
 * - `logger`          — opcionális structured logger.
 * - `stateSaveIntervalMs`   — opcionális state-save periodic interval (ms).
 *                              Default: 60_000 (60s). Tests can set 10ms.
 * - `killSwitchEvalIntervalMs` — opcionális kill-switch eval interval (ms).
 *                              Default: 5_000 (5s). Tests can set 10ms.
 * - `heartbeatIntervalMs`   — opcionális run-loop heartbeat (ms).
 *                              Default: 60_000 (60s). Tests can set 10ms.
 * - `telemetryMetricsIntervalSec` — opcionális telemetry metrics interval (sec).
 *                              Default: 60 (1 min). Tests can set 0.05.
 *                              Bypasses the Zod min:1 schema constraint.
 * - `perStrategyKillSwitches`  — opcionális extra kill-switch-ek (pl. tesztekhez).
 *                              Default: nincs. A `createDefaultRegistry` megkapja.
 */
export interface BotOptions {
  readonly config: BotConfig;
  readonly feed?: ExchangeFeed;
  readonly fundingSource?: DydxFundingSource | null;
  readonly sizingFn?: StrategyRunnerOptions["sizingFn"];
  readonly logger?: Logger;
  /**
   * `stateSaveIntervalMs` — optional persistent-state save interval in milliseconds.
   * Default: 60_000 (60s). Tests may provide a shorter interval.
   */
  readonly stateSaveIntervalMs?: number;
  readonly killSwitchEvalIntervalMs?: number;
  readonly heartbeatIntervalMs?: number;
  readonly telemetryMetricsIntervalSec?: number;
  readonly perStrategyKillSwitches?: readonly KillSwitch[];
  readonly paperOrderSimulator?: PaperOrderSimulator;
  /**
   * Paper-mode exchange construction boundary; defaults to the production Bybit EU factory.
   * Live mode always uses the internal production factory.
   */
  readonly exchangeFeedFactory?: (options: Parameters<typeof createExchangeClient>[0]) => ExchangeFeed;
  /**
  Maximum graceful run-loop drain time before forced cleanup. Default: 5 seconds.
  */
  readonly gracefulShutdownTimeoutMs?: number;
}

interface BotRunContext {
  readonly feed: ExchangeFeed;
  readonly runner: StrategyRunner;
  readonly positionManager: PositionManager;
  readonly riskManager: RiskManager;
  readonly killSwitches: KillSwitchRegistry;
  readonly telemetry: Telemetry;
  readonly portfolioManager: PortfolioManager;
  readonly emergencyHandler: (reason: string) => Promise<void>;
}

// ============================================================================
// Bot class
// ============================================================================

/**
 * `Bot` — a teljes futó bot. Az életciklusa:
 *
 * The application composition boundary injects the config and structured logger,
 * then drives start and graceful stop.
 */
export class Bot {
  private readonly config: BotConfig;
  private readonly logger: Logger;
  private readonly options: BotOptions;

  // Komponensek — az `init()` tölti fel.
  private feed: ExchangeFeed | undefined;
  private orderManager: OrderManager | undefined;
  private positionManager: PositionManager | undefined;
  private stateStore: StateStore | undefined;
  private telemetry: Telemetry | undefined;
  private runner: StrategyRunner | undefined;
  private runtimeController: BotRuntimeController | undefined;

  private startedAt = 0;
  private stopRequested = false;
  private running = false;
  private stopping = false;
  /**
  A kill latch blocks all new signal handling before shutdown begins.
  */
  private killSwitchEngaged = false;
  /**
  Single Bot-owned emergency workflow shared by every trigger source.
  */
  private emergencyPromise: Promise<void> | undefined;
  private emergencyLatched = false;
  private stateSaveInterval: ReturnType<typeof setInterval> | undefined;
  private killSwitchInterval: ReturnType<typeof setInterval> | undefined;

  // Periodic interval durations. Configurable via BotOptions for tests
  // (10ms in tests vs 60s/5s in production). The defaults below match
  // the original hardcoded values.
  private readonly stateSaveIntervalMs: number;
  private readonly killSwitchEvalIntervalMs: number;
  private readonly heartbeatIntervalMs: number;
  private readonly telemetryMetricsIntervalSec: number;
  private readonly gracefulShutdownTimeoutMs: number;
  private readonly paperExchangeFeedFactory: (
    options: Parameters<typeof createExchangeClient>[0],
  ) => ExchangeFeed;
  private readonly hasCustomExchangeFeedFactory: boolean;
  private readonly exchangeInitializer = new BotExchangeInitializer();

  public constructor(options: BotOptions) {
    this.config = options.config;
    this.options = options;
    this.logger = requireLogger(options.logger, "bot");
    this.stateSaveIntervalMs = options.stateSaveIntervalMs ?? 60_000;
    this.killSwitchEvalIntervalMs = options.killSwitchEvalIntervalMs ?? 5000;
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? 60_000;
    this.telemetryMetricsIntervalSec = options.telemetryMetricsIntervalSec ?? 60;
    this.gracefulShutdownTimeoutMs = options.gracefulShutdownTimeoutMs ?? 5000;
    this.hasCustomExchangeFeedFactory = options.exchangeFeedFactory !== undefined;
    this.paperExchangeFeedFactory = options.exchangeFeedFactory ?? createExchangeClient;
  }
  // --------------------------------------------------------------------------
  // Internals
  // --------------------------------------------------------------------------

  /**
   * `init` — a komponensek összeállítása. Nem indítja el a feed subscription-t.
   */
  private async init(): Promise<readonly [BotRunContext, BotRuntimeController]> {
    if (this.config.bot.mode === "live" && this.options.paperOrderSimulator !== undefined) {
      throw new Error("Bot: live mode prohibits paper order simulators.");
    }
    const { feed, initialEquity, preparedLiveEquity } = await this.exchangeInitializer.initialize({
      config: this.config,
      injectedFeed: this.options.feed,
      paperExchangeFeedFactory: this.paperExchangeFeedFactory,
      hasCustomExchangeFeedFactory: this.hasCustomExchangeFeedFactory,
      logger: this.logger,
      apiKey: process.env["BYBIT_API_KEY"],
      apiSecret: process.env["BYBIT_API_SECRET"],
      assignFeed: (initializedFeed) => {
        this.feed = initializedFeed;
      },
    });
    const assembly = await BotRuntimeAssembly.create({
      config: this.config,
      feed,
      initialEquity,
      ...(preparedLiveEquity !== undefined && { preparedLiveEquity }),
      fundingSource: this.options.fundingSource,
      sizingFn: this.options.sizingFn,
      perStrategyKillSwitches: this.options.perStrategyKillSwitches,
      ...(this.options.paperOrderSimulator !== undefined && {
        paperOrderSimulator: this.options.paperOrderSimulator,
      }),
      telemetryMetricsIntervalSec: this.telemetryMetricsIntervalSec,
      logger: this.logger,
      createEmergencyHandler: (portfolioManager) => this.engageEmergency.bind(this, portfolioManager),
      snapshotProvider: (positionManager, orderManager, runner) =>
        this.snapshotForTelemetry(positionManager, orderManager, runner),
    });
    const { context, orderManager, stateStore: assembledStateStore, strategyInstances } = assembly;
    const {
      positionManager,
      riskManager,
      killSwitches,
      telemetry,
      portfolioManager,
      runner,
      emergencyHandler,
    } = context;
    this.positionManager = positionManager;
    this.orderManager = orderManager;
    this.stateStore = assembledStateStore;
    this.runner = runner;
    this.telemetry = telemetry;
    const runtimeController = new BotRuntimeController({
      config: this.config,
      logger: this.logger,
      context,
      strategyInstances,
      heartbeatIntervalMs: this.heartbeatIntervalMs,
      isRunning: () => this.running,
      isStopRequested: () => this.stopRequested,
      markRunExited: () => {
        this.running = false;
      },
    });
    this.runtimeController = runtimeController;

    // -----------------------------------------------------------------------
    // 10) Periodic state-save + kill-switch evaluation
    // -----------------------------------------------------------------------
    const stateStore = this.stateStore;
    this.stateSaveInterval = setInterval(() => {
      stateStore.requestSave(this.getState());
    }, this.stateSaveIntervalMs);
    if (this.config.bot.mode !== "live") {
      this.killSwitchInterval = setInterval(() => {
        this.observeEquity(positionManager, killSwitches, riskManager);
        const snap = killSwitches.evaluate();
        telemetry.setEngaged(snap.engaged, snap.reasons);
      }, this.killSwitchEvalIntervalMs);
    }
    const runtime = {
      feed,
      runner,
      positionManager,
      riskManager,
      killSwitches,
      telemetry,
      portfolioManager,
      emergencyHandler,
    };
    return [runtime, runtimeController];
  }

  /**
  Latch, join and settle one emergency close attempt while feeds stay live.
  */
  private async engageEmergency(portfolioManager: PortfolioManager, reason: string): Promise<void> {
    if (this.emergencyPromise !== undefined) return this.emergencyPromise;
    if (this.emergencyLatched) return;
    this.killSwitchEngaged = true;
    this.runner?.pause();
    this.emergencyPromise = (async () => {
      try {
        this.logger.critical("bot.emergency.coordinator.engaged", { reason });
        const report = await portfolioManager.executeCloseAll();
        const unresolved = report.unresolved;
        this.logger.critical("bot.emergency.close.report", {
          closed: report.closed,
          unresolved,
          cancelledOrders: report.cancelledOrders,
        });
        if (unresolved.length === 0) await this.stop();
        else this.emergencyLatched = true;
      } catch (error) {
        this.emergencyLatched = true;
        throw error;
      } finally {
        if (!this.emergencyLatched) this.emergencyPromise = undefined;
      }
    })();
    return this.emergencyPromise;
  }

  /**
   * `cleanup` — graceful shutdown teendők.
   */
  private async cleanup(): Promise<void> {
    if (this.stateSaveInterval !== undefined) {
      clearInterval(this.stateSaveInterval);
      this.stateSaveInterval = undefined;
    }
    if (this.killSwitchInterval !== undefined) {
      clearInterval(this.killSwitchInterval);
      this.killSwitchInterval = undefined;
    }
    if (this.telemetry !== undefined) {
      this.telemetry.stop();
    }
    const orderManager = this.orderManager;
    if (orderManager !== undefined) {
      await stopLifecycleForCleanup(() => orderManager.stopLifecycle(), this.logger);
    }
    this.runner?.dispose();
    if (this.stateStore !== undefined) {
      try {
        this.stateStore.flush(this.getState());
      } catch (error) {
        this.logger.error("bot.state.flush.failed", {
          error: errorMessage(error),
        });
      }
    }
    if (this.feed !== undefined) {
      await this.runtimeController?.cleanupSubscriptions();
      try {
        await this.feed.close();
      } catch (error) {
        this.logger.error("bot.feed.close.failed", {
          error: errorMessage(error),
        });
      }
    }
    this.running = false;
    this.logger.info("bot.lifecycle.stopped", {
      uptime: formatUptime(Date.now() - this.startedAt),
    });
  }

  /**
   * The PositionManager is the runtime equity projection fed by every price
   * and fill event.  Forward every observation to both drawdown consumers;
   * previously the MaxDrawdownKillSwitch kept its initial value forever.
   *
   * Exchange fill/balance reconciliation may refine this projection, but it
   * must call this same method only after an authoritative update has been
   * confirmed.  This deliberately never marks a position closed itself.
   */
  private observeEquity(
    positionManager: PositionManager,
    killSwitches: KillSwitchRegistry,
    riskManager: RiskManager,
    authoritativeEquityUsd?: number,
  ): void {
    const equity = authoritativeEquityUsd ?? positionManager.getEquity();
    killSwitches.updateEquity(equity);
    riskManager.onEquityUpdate(equity);
  }

  /**
   * `snapshotForTelemetry` — a Telemetry számára összeállított pillanatkép.
   */
  private snapshotForTelemetry(
    positionManager: PositionManager,
    orderManager: OrderManager,
    runner: StrategyRunner,
  ) {
    const positions = positionManager.getPositions();
    const equity = positionManager.getEquity();
    const initialEquity = equity - positionManager.getRealizedPnl();
    const realizedPnl = positionManager.getRealizedPnl();
    const unrealizedPnl = positions.reduce((accumulator, p) => accumulator + p.unrealizedPnl, 0);
    const counters = orderManager.getCounters();
    return {
      equityUsd: equity,
      initialEquityUsd: Math.max(initialEquity, 0),
      realizedPnlUsd: realizedPnl,
      unrealizedPnlUsd: unrealizedPnl,
      drawdownPct: 0, // computed by the kill-switch; placeholder here
      openPositions: positions.length,
      maxPositions: this.config.risk.max_positions,
      counters,
      killSwitchEngaged: false,
      killSwitchReasons: [] as string[],
      uptime: Date.now() - this.startedAt,
      uptimeHuman: formatUptime(Date.now() - this.startedAt),
      activeStrategies: runner.getActiveStrategyNames(),
    };
  }

  // --------------------------------------------------------------------------
  // Lifecycle
  // --------------------------------------------------------------------------

  /**
   * `start` — az init + run szekvencia. A `Bot` indítása után a run-loop
   * a `stopRequested = true` flag-re várakozik (vagy kill-switch triggerre).
   */
  public async start(): Promise<void> {
    if (this.running) {
      throw new Error("[bot] already running");
    }
    this.stopRequested = false;
    this.stopping = false;
    this.killSwitchEngaged = false;
    this.emergencyLatched = false;
    this.emergencyPromise = undefined;
    this.running = true;
    this.startedAt = Date.now();
    this.logger.info("bot.lifecycle.starting", {
      mode: this.config.bot.mode,
      exchange: this.config.exchange.id,
      strategies: Object.entries(this.config.strategies)
        .filter(([_, s]) => s.enabled)
        .map(([k]) => k),
    });
    try {
      const [, runtimeController] = await this.init();
      await runtimeController.run();
    } catch (error) {
      // A failed initialization used to leave `running=true` and partially
      // constructed timers/feed resources behind.  Treat start as a
      // transaction: either the ready boundary is reached, or all resources
      // created so far are released and the next attempt begins cleanly.
      this.stopRequested = true;
      this.running = false;
      await this.cleanup();
      throw error;
    }
  }

  /**
   * `stop` — graceful shutdown. A `run-loop` a következő iterációban
   * kilép, és a `run()` Promise feloldódik. A `stop()` azután:
   *   - stops runtime subscriptions and timers,
   *   - flush-eli a state-store-t,
   *   - lezárja a feed-et,
   *   - leállítja a Telemetry intervalt.
   */
  public async stop(): Promise<void> {
    if (!this.running || this.stopping) return;
    this.stopping = true;
    this.stopRequested = true;
    this.logger.info("bot.lifecycle.stopping");
    // Wait briefly for the run-loop to exit. The run() finally block
    // sets `this.running = false` when the loop exits, so this loop
    // will unblock within ~50ms after `stopRequested` is observed.
    const isStillRunning = (): boolean => this.running;
    const deadline = Date.now() + this.gracefulShutdownTimeoutMs;
    while (isStillRunning() && Date.now() < deadline) {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 25);
      });
    }
    // Force-stop fallback
    if (isStillRunning()) {
      this.logger.warn("bot.lifecycle.shutdown.timeout");
      this.running = false;
    }
    await this.cleanup();
  }

  public isKillSwitchEngaged(): boolean {
    return this.killSwitchEngaged;
  }

  public getConfig(): BotConfig {
    return this.config;
  }

  public getState(): BotState {
    if (
      this.stateStore === undefined ||
      this.positionManager === undefined ||
      this.orderManager === undefined
    ) {
      throw new Error("[bot] not initialized — call start() first");
    }
    const positions = this.positionManager.getPositions();
    const counters = this.orderManager.getCounters();
    return {
      version: 1,
      savedAt: Date.now(),
      equityUsd: this.positionManager.getEquity(),
      initialEquityUsd: this.positionManager.getEquity() - this.positionManager.getRealizedPnl(),
      realizedPnlUsd: this.positionManager.getRealizedPnl(),
      positions: positions.map((position) => ({ ...position })),
      closedTrades: this.positionManager.getClosedTrades().map((trade) => ({ ...trade })),
      inFlightOrderIds: [],
      counters,
    };
  }
}
