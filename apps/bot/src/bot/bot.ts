/**
 * apps/bot/src/bot/bot.ts
 *
 * Phase 33 Track C — `Bot` — a futó mm-crypto-bot fő életciklus-osztálya.
 *
 * ===========================================================================
 * ÉLETCIKLUS
 * ===========================================================================
 *   1) `start()`:
 *      - `init()`: feed megnyitás, stratégiák példányosítása,
 *        komponensek (OrderManager, PositionManager, StateStore,
 *        Telemetry, KillSwitchRegistry) összeállítása.
 *      - `run()`: feed-re feliratkozás ticker + order book streamekre,
 *        minden tick-et a `StrategyRunner.onFeedEvent`-re irányít.
 *      - A run() a `stopRequested` flag-re várakozik, vagy a
 *        kill-switch registry trigger-ére.
 *
 *   2) `stop()`:
 *      - `runRequested = false`; a run-loop kilép a következő iterációban.
 *      - Runtime subscriptions and timers are stopped.
 *      - State finalizálás (StateStore.flush).
 *      - Feed lezárása.
 *      - Telemetry stop.
 *
 *   3) `getState()`:
 *      - Pillanatkép a futó állapotról (positions, equity, counters, kill-switch).
 *      - A `mm-bot status` CLI használja (Track D).
 *
 * ===========================================================================
 * USER MANDATE (2026-07-11 23:42 BUDAPEST)
 * ===========================================================================
 * "csinald meg ami meg hianyzik a kodbol!" — "Complete what's still missing
 * in the code!"  A user kéri, hogy a bot legyen TÉNYLEGESEN futtatható,
 * ne csak szkeleton.  Ez a fájl a teljes életciklust implementálja —
 * nem scaffold, hanem production runtime.
 *
 * ===========================================================================
 * 1:10 LEVERAGE MANDATE
 * ===========================================================================
 * A 3-layer defense-in-depth a `Bot`-on belül:
 *   L1: `loadBotConfig` Zod séma (`risk.max_leverage ≤ 10`)
 *   L2: `OrderManager.placeOrder` (pre-place assertion)
 *   L3: `PositionManager.recordFill` (post-fill assertion)
 * A `Bot` mindhármat inicializálja és futtatja.
 */

import type { ExchangeFeed, ExchangePosition, FeedEvent, Symbol as ExchangeSymbol, Timeframe } from "@mm-crypto-bot/exchange";
import {
  createExchangeClient,
  asSymbol,
} from "@mm-crypto-bot/exchange";
import type { DydxFundingSource } from "@mm-crypto-bot/core";
import type { Logger } from "@mm-crypto-bot/shared";
import { createLogger } from "@mm-crypto-bot/shared";

import { createStrategyInstances, type BotStrategyInstance } from "../config/strategy-registry.js";
import type { BotConfig, StrategyName } from "../config/schema.js";
import {
  CorrelationMatrix,
  PortfolioManager,
  PortfolioStop,
  RiskBudgetAllocator,
} from "../portfolio/index.js";

import { OrderManager } from "./order-manager.js";
import { PositionManager } from "./position-manager.js";
import { MockDydxFundingSource } from "./mock-dydx-funding-source.js";
import { StateStore, type BotState } from "./state-store.js";
import { Telemetry, formatUptime } from "./telemetry.js";
import type { KillSwitchRegistry, KillSwitch} from "./kill-switches.js";
import { createDefaultRegistry } from "./kill-switches.js";
import {
  StrategyRunner,
  defaultSizingFn,
  type StrategyRunnerOptions,
} from "./strategy-runner.js";
import { RiskManager } from "../risk/index.js";

const SUPPORTED_TIMEFRAMES: ReadonlySet<string> = new Set([
  "1m", "5m", "15m", "1h", "4h", "1d",
]);

function isSupportedTimeframe(value: string): value is Timeframe {
  return SUPPORTED_TIMEFRAMES.has(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
  /** Exchange construction boundary; defaults to the production Bybit EU factory. */
  readonly exchangeFeedFactory?: (options: Parameters<typeof createExchangeClient>[0]) => ExchangeFeed;
  /** Maximum graceful run-loop drain time before forced cleanup. Default: 5 seconds. */
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
 *   const bot = new Bot({ config });
 *   await bot.start();  // init + run
 *   // ... wait ...
 *   await bot.stop();   // graceful shutdown
 *   console.log(bot.getState());
 */
export class Bot {
  private readonly config: BotConfig;
  private readonly logger: Logger;
  private readonly options: BotOptions;

  // Komponensek — az `init()` tölti fel.
  private feed: ExchangeFeed | null = null;
  private fundingSource: DydxFundingSource | null = null;
  private orderManager: OrderManager | null = null;
  private positionManager: PositionManager | null = null;
  private stateStore: StateStore | null = null;
  private telemetry: Telemetry | null = null;
  private runner: StrategyRunner | null = null;
  private strategyInstances: ReadonlyMap<StrategyName, BotStrategyInstance> | null = null;
  // Phase 37 Track 4 — portfolió-koordináció.
  private riskBudget: RiskBudgetAllocator | null = null;
  private correlation: CorrelationMatrix | null = null;
  private portfolioStop: PortfolioStop | null = null;
  private runtime: BotRunContext | null = null;

  private startedAt = 0;
  private stopRequested = false;
  private running = false;
  private stopping = false;
  /** A kill latch blocks all new signal handling before shutdown begins. */
  private killSwitchEngaged = false;
  /** Single Bot-owned emergency workflow shared by every trigger source. */
  private emergencyPromise: Promise<void> | null = null;
  private readonly feedSubscriptions: number[] = [];
  private stateSaveInterval: ReturnType<typeof setInterval> | null = null;
  private killSwitchInterval: ReturnType<typeof setInterval> | null = null;

  // Periodic interval durations. Configurable via BotOptions for tests
  // (10ms in tests vs 60s/5s in production). The defaults below match
  // the original hardcoded values.
  private readonly stateSaveIntervalMs: number;
  private readonly killSwitchEvalIntervalMs: number;
  private readonly heartbeatIntervalMs: number;
  private authoritativeEquityUsd: number | null = null;
  private authorityReconciliationInFlight = false;
  private readonly telemetryMetricsIntervalSec: number;
  private readonly gracefulShutdownTimeoutMs: number;
  private readonly exchangeFeedFactory: (options: Parameters<typeof createExchangeClient>[0]) => ExchangeFeed;

  public constructor(options: BotOptions) {
    this.config = options.config;
    this.options = options;
    this.logger = options.logger ?? createLogger(options.config.bot.log_level);
    this.stateSaveIntervalMs = options.stateSaveIntervalMs ?? 60_000;
    this.killSwitchEvalIntervalMs = options.killSwitchEvalIntervalMs ?? 5_000;
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? 60_000;
    this.telemetryMetricsIntervalSec = options.telemetryMetricsIntervalSec ?? 60;
    this.gracefulShutdownTimeoutMs = options.gracefulShutdownTimeoutMs ?? 5_000;
    this.exchangeFeedFactory = options.exchangeFeedFactory ?? createExchangeClient;
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
    this.emergencyPromise = null;
    this.running = true;
    this.startedAt = Date.now();
    this.logger.info("[bot] starting", {
      mode: this.config.bot.mode,
      exchange: this.config.exchange.id,
      strategies: Object.entries(this.config.strategies)
        .filter(([_, s]) => s.enabled)
        .map(([k]) => k),
    });
    try {
      this.runtime = await this.init();
      await this.run(this.runtime);
    } catch (err) {
      // A failed initialization used to leave `running=true` and partially
      // constructed timers/feed resources behind.  Treat start as a
      // transaction: either the ready boundary is reached, or all resources
      // created so far are released and the next attempt begins cleanly.
      this.stopRequested = true;
      this.running = false;
      await this.cleanup();
      throw err;
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
    this.logger.info("[bot] stopping — graceful shutdown requested");
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
      this.logger.warn("[bot] graceful shutdown timeout — force-stopping");
      this.running = false;
    }
    await this.cleanup();
  }

  public isKillSwitchEngaged(): boolean {
    return this.killSwitchEngaged;
  }

  /**
   * Return the validated, read-only configuration captured at construction.
   * Runtime components use this accessor for diagnostics and verification.
   */
  public getConfig(): BotConfig {
    return this.config;
  }

  /** Build the current runtime snapshot used by persistence and status probes. */
  public getState(): BotState {
    if (this.stateStore === null || this.positionManager === null || this.orderManager === null) {
      throw new Error("[bot] not initialized — call start() first");
    }
    const positions = this.positionManager.getPositions();
    const counters = this.orderManager.getCounters();
    const state: BotState = {
      version: 1,
      savedAt: Date.now(),
      equityUsd: this.positionManager.getEquity(),
      initialEquityUsd: this.positionManager.getEquity() - this.positionManager.getRealizedPnl(),
      realizedPnlUsd: this.positionManager.getRealizedPnl(),
      positions: positions.map((p) => ({
        id: p.id,
        strategy: p.strategy,
        symbol: String(p.symbol),
        side: p.side,
        quantity: p.quantity,
        entryPrice: p.entryPrice,
        currentPrice: p.currentPrice,
        leverage: p.leverage,
        unrealizedPnl: p.unrealizedPnl,
        realizedPnl: p.realizedPnl,
        openedAt: p.openedAt,
        notionalUsd: p.notionalUsd,
      })),
      closedTrades: this.positionManager.getClosedTrades().map((t) => ({
        strategy: t.strategy,
        symbol: String(t.symbol),
        side: t.side,
        quantity: t.quantity,
        entryPrice: t.entryPrice,
        exitPrice: t.exitPrice,
        pnl: t.pnl,
        pnlPct: t.pnlPct,
        closedAt: t.closedAt,
      })),
      inFlightOrderIds: [],
      counters,
    };
    return state;
  }

  // --------------------------------------------------------------------------
  // Internals
  // --------------------------------------------------------------------------

  /**
   * `init` — a komponensek összeállítása. Nem indítja el a feed subscription-t.
   */
  private async init(): Promise<BotRunContext> {
    // Detect once at the top — used by the feed-init branch AND the
    // balances branch below. Paper mode without credentials is supported
    // (real bybit.eu market data, but no private endpoints).
    const apiKey = process.env["BYBIT_API_KEY"]?.trim();
    const apiSecret = process.env["BYBIT_API_SECRET"]?.trim();
    const hasCreds = apiKey !== undefined && apiKey.length > 0 &&
      apiSecret !== undefined && apiSecret.length > 0;

    // -----------------------------------------------------------------------
    // 1) Exchange feed
    // -----------------------------------------------------------------------
    let feed: ExchangeFeed;
    if (this.options.feed !== undefined) {
      // Az `options.feed` az egyetlen TESZT-CSATORNA a mock feed-hez
      // (a unit/integration tesztek ezen keresztül injectelik a
      // `MockExchangeFeed`-et, lásd `apps/bot/src/bot/bot.test.ts`).
      // Production kódból a `MockExchangeFeed` NEM érhető el (a fájl a
      // `__testing__/` almappában van, nem exportálódik a public
      // surface-en) — lásd a PHASE 66 ENFORCEMENT blokkot a
      // `packages/exchange/src/index.ts` fájlban.
      feed = this.options.feed;
    } else if (this.config.exchange.id === "mock") {
      // Phase 66 enforcement: `exchange.id === "mock"` a CONFIG-ban
      // ÉRVÉNYES, de a `MockExchangeFeed` osztály NEM elérhető
      // production kódból. A tesztek a `Bot`-ot `options.feed`-en
      // keresztül injectelik (lásd fentebb). Ha itt tartunk, a
      // hívó elfelejtette beadni a feed-et — ez programozási hiba,
      // nem runtime körülmény.
      throw new Error(
        "Bot: 'exchange.id = mock' in production config is not supported. " +
          "MockExchangeFeed is test-only and not importable from production code. " +
          "Tests must inject the mock feed via `new Bot({ config, feed })`. " +
          "For real exchange data, use exchange.id = 'bybiteu' (or any non-mock id).",
      );
    } else {
      // Phase 66: paper mode uses the real bybit.eu feed for market data
      // (fetchTicker, fetchOhlcv — PUBLIC endpoints, no auth). The
      // PaperTrader has its OWN fillOrder logic and never calls
      // submitOrder on the feed → no real orders are ever sent. If
      // we're in paper mode and the env vars are not set, we pass an
      // empty-credential override to skip the readExchangeCredentials()
      // throw, and skip fetchBalances below.
      if (this.config.bot.mode === "paper" && !hasCreds) {
        feed = this.exchangeFeedFactory({
          override: { apiKey: "", secret: "" },
          rateLimitMs: this.config.exchange.rate_limit_ms,
          sandbox: this.config.exchange.sandbox,
          timeoutMs: this.config.exchange.timeout_ms,
          ...(this.config.exchange.endpoint !== undefined ? { endpoint: this.config.exchange.endpoint } : {}),
          ...(this.config.exchange.ws_endpoint !== undefined ? { wsEndpoint: this.config.exchange.ws_endpoint } : {}),
        });
      } else {
        feed = this.exchangeFeedFactory({
          rateLimitMs: this.config.exchange.rate_limit_ms,
          sandbox: this.config.exchange.sandbox,
          timeoutMs: this.config.exchange.timeout_ms,
          ...(this.config.exchange.endpoint !== undefined ? { endpoint: this.config.exchange.endpoint } : {}),
          ...(this.config.exchange.ws_endpoint !== undefined ? { wsEndpoint: this.config.exchange.ws_endpoint } : {}),
        });
      }
    }
    this.feed = feed;
    await feed.open();
    this.logger.info("[bot] feed opened", { exchangeId: feed.exchangeId });

    // -----------------------------------------------------------------------
    // 2) Balances — paper mode without credentials skips the PRIVATE
    //    fetchBalances call (401 without auth) and uses the default
    //    initial equity. The PaperTrader manages its own internal balance.
    // -----------------------------------------------------------------------
    let initialEquity: number;
    if (this.config.bot.mode === "paper" && !hasCreds) {
      initialEquity = 10_000;
      this.logger.info(
        "[bot] paper mode without credentials — using default initial equity",
        { usdc: initialEquity },
      );
    } else {
      const balances = await feed.fetchBalances();
      const usdcBalance = balances.find((b) => b.currency === "USDC");
      initialEquity = usdcBalance?.total ?? 10_000;
      this.logger.info("[bot] initial equity", { usdc: initialEquity });
    }

    // -----------------------------------------------------------------------
    // 3) PositionManager
    // -----------------------------------------------------------------------
    const positionManager = new PositionManager({
      initialEquityUsd: initialEquity,
      maxPositions: this.config.risk.max_positions,
      maxLeverage: this.config.risk.max_leverage,
      leverageConfig: {
        maxLeverage: this.config.risk.max_leverage,
        tolerance: 1e-6,
        warnOnApproach: 0.95,
      },
      logger: this.logger,
    });
    this.positionManager = positionManager;

    // All adaptive-risk modules remain disabled by their schema defaults, so
    // attaching this sidecar preserves baseline sizing when the user has not
    // opted in. When enabled, both the runner and PositionManager observe
    // the same instance (Kelly/drawdown sizing + trailing-stop lifecycle).
    const riskManager = new RiskManager({
      trailingStop: {
        enabled: this.config.risk.trailing_stop.enabled,
        atrPeriod: this.config.risk.trailing_stop.atr_period,
        atrMultiplier: this.config.risk.trailing_stop.atr_multiplier,
        side: this.config.risk.trailing_stop.side,
      },
      kelly: {
        enabled: this.config.risk.kelly.enabled,
        fraction: this.config.risk.kelly.fraction,
        windowSize: this.config.risk.kelly.window_size,
        minTrades: this.config.risk.kelly.min_trades,
        fallbackFraction: this.config.risk.kelly.fallback_fraction,
        maxFraction: this.config.risk.max_position_fraction,
      },
      drawdownScaler: {
        enabled: this.config.risk.drawdown_scaler.enabled,
        maxDdPct: this.config.risk.drawdown_scaler.max_dd_pct,
        initialEquity,
      },
      logger: this.logger,
    });
    positionManager.setRiskManager(riskManager);

    // -----------------------------------------------------------------------
    // 4) StateStore
    // -----------------------------------------------------------------------
    this.stateStore = new StateStore({
      filePath: this.config.bot.state_file,
      logger: this.logger,
    });
    // Phase 68: a `load()` visszatérési értékét azonnal felhasználjuk
    // a PositionManager state-restore-hoz (a Phase 67 óta ismert bug:
    // a state-ből töltött pozíciók NEM kerültek be a PositionManager-be,
    // így restart után a Phase 67 position-skip fix nem működött).
    // A `closedTrades`-t is visszatöltjük, hogy a `getClosedTrades()` history
    // konzisztens legyen a `realizedPnlTotal`-lal.
    const loadedState = this.stateStore.load();
    if (loadedState !== null) {
      // 1) realizedPnl — vissza kell állítani, különben a getEquity() hamis értéket ad
      if (loadedState.realizedPnlUsd !== 0) {
        positionManager.restoreRealizedPnl(loadedState.realizedPnlUsd);
      }
      // 2) closed trades history — a P&L history konzisztenciájához
      if (loadedState.closedTrades.length > 0) {
        positionManager.restoreClosedTrades(
          loadedState.closedTrades.map((t) => ({
            strategy: t.strategy,
            symbol: t.symbol as unknown as ExchangeSymbol,
            side: t.side,
            quantity: t.quantity,
            entryPrice: t.entryPrice,
            exitPrice: t.exitPrice,
            pnl: t.pnl,
            pnlPct: t.pnlPct,
            closedAt: t.closedAt,
          })),
        );
      }
      // 3) nyitott pozíciók — a Phase 67 position-skip fix ettől kezdve
      //    ténylegesen működik restart után is
      if (loadedState.positions.length > 0) {
        this.logger.info("[bot] restoring positions from state", {
          count: loadedState.positions.length,
          strategies: [...new Set(loadedState.positions.map((p) => p.strategy))],
        });
        for (const p of loadedState.positions) {
          // StateStore.load() has already enforced the same positive quantity,
          // positive price and 1..10 leverage contract as restorePosition.
          positionManager.restorePosition({
            strategy: p.strategy,
            symbol: p.symbol as unknown as ExchangeSymbol,
            side: p.side,
            quantity: p.quantity,
            entryPrice: p.entryPrice,
            currentPrice: p.currentPrice,
            leverage: p.leverage,
            unrealizedPnl: p.unrealizedPnl,
            realizedPnl: p.realizedPnl,
            openedAt: p.openedAt,
            notionalUsd: p.notionalUsd,
          });
        }
      }
    }

    // -----------------------------------------------------------------------
    // 5) OrderManager
    // -----------------------------------------------------------------------
    const orderManager = new OrderManager({
      feed,
      getPositionContext: () => positionManager.getPositionContext(),
      getReduciblePosition: (symbol, strategy) => {
        const position = positionManager.getPositions().find((item) => item.symbol === symbol && (strategy === undefined || item.strategy === strategy));
        return position === undefined ? undefined : { side: position.side, quantity: position.quantity };
      },
      leverage: {
        maxLeverage: this.config.risk.max_leverage,
        tolerance: 1e-6,
        warnOnApproach: 0.95,
      },
      logger: this.logger,
      // Phase 66: paper mode skips the real feed.placeOrder (which needs
      // bybit.eu API credentials) and simulates a filled order locally.
      // Live mode (mode = "live") requires real API keys AND sets BYBIT_API_KEY.
      paperMode: this.config.bot.mode === "paper",
    });
    this.orderManager = orderManager;

    // -----------------------------------------------------------------------
    // 5.5) Phase 43 Track 1 — DydxFundingSource (paper mode auto-mock)
    // -----------------------------------------------------------------------
    // Mirrors the Phase 42 MockExchangeFeed pattern: in paper mode, the
    // `dydx_cex_carry` strategy needs a `DydxFundingSource` to compute
    // funding-rate signals.  Paper mode auto-constructs a
    // `MockDydxFundingSource` (synthetic 1Hz PRNG data, 1M USD spot
    // depth, increments chain block height per tick).
    //
    // Precedence:
    //   1) `options.fundingSource` explicit (test injection OR real
    //      `DydxLiveFundingSource` in live mode) — always wins.
    //   2) Paper mode + no explicit → auto-construct `MockDydxFundingSource`.
    //   3) Live mode + no explicit → null. The strategy-registry's
    //      `makeDydxCexCarry` throws ConfigError if `dydx_cex_carry` is
    //      enabled (preserves the Phase 25 #2 contract: live = real feed).
    if (this.options.fundingSource !== undefined) {
      this.fundingSource = this.options.fundingSource;
    } else if (this.config.bot.mode === "paper") {
      this.fundingSource = new MockDydxFundingSource();
    } else {
      this.fundingSource = null;
    }

    // -----------------------------------------------------------------------
    // 6) Strategy instances
    // -----------------------------------------------------------------------
    const instances = createStrategyInstances(this.config, {
      ...(this.fundingSource !== null ? { dydxFundingSource: this.fundingSource } : {}),
    });
    this.strategyInstances = instances;
    this.logger.info("[bot] strategy instances created", {
      count: instances.size,
      names: [...instances.keys()],
    });

    // -----------------------------------------------------------------------
    // 6.5) Phase 37 Track 4 — Portfolio coordination
    // -----------------------------------------------------------------------
    // A `RiskBudgetAllocator` + `CorrelationMatrix` + `PortfolioStop`
    // + `PortfolioManager` a portfolió-szintű kockázatkezelés
    // központi elemei. A `Bot.init()`-ben hívjuk meg őket, MIELŐTT
    // a `StrategyRunner` és a `KillSwitchRegistry` életre kel —
    // mert a `StrategyRunner` a `PortfolioManager` referenciáját
    // várja a sizing-hoz, a `KillSwitchRegistry` pedig a portfolio
    // stop állapotát olvassa.
    this.riskBudget = new RiskBudgetAllocator({
      totalRiskUsd: this.config.portfolio.total_risk_per_cycle_usd,
      correlationPenaltyThreshold: this.config.portfolio.correlation_penalty_threshold,
      logger: this.logger,
    });
    this.correlation = new CorrelationMatrix({
      windowSize: this.config.portfolio.correlation_window_size,
      logger: this.logger,
    });
    this.portfolioStop = new PortfolioStop({
      maxDdPct: this.config.portfolio.max_dd_pct,
      logger: this.logger,
    });
    const portfolioManager = new PortfolioManager({
      riskBudget: this.riskBudget,
      correlation: this.correlation,
      portfolioStop: this.portfolioStop,
      positionManager,
      orderManager,
      requireAuthoritativeEmergencyState: this.config.bot.mode === "live",
      configuredSymbols: this.config.symbols.enabled,
      logger: this.logger,
    });
    // Az aktív stratégiák büdzsé-konfigurációjának regisztrálása
    // a `PortfolioManager`-ben. A `weight` a per-strategy `cap`
    // mezőből jön (a config-ban ez az equity-frakció), a
    // `riskPerTrade` a globális `risk.risk_per_trade`-ből.
    for (const [strategyName, section] of Object.entries(this.config.strategies)) {
      if (!section.enabled) continue;
      const cap = (section as { cap?: number }).cap ?? 0.1;
      portfolioManager.setStrategyConfig({
        strategyId: strategyName,
        weight: cap,
        riskPerTrade: this.config.risk.risk_per_trade,
      });
    }
    this.logger.info("[bot] portfolio summary", {
      enabledStrategies: instances.size,
      totalRiskUsd: this.riskBudget.getTotalRiskUsd(),
      correlationPenaltyThreshold: this.riskBudget.getCorrelationPenaltyThreshold(),
      correlationWindowSize: this.correlation.getWindowSize(),
      maxDdPct: this.portfolioStop.getMaxDdPct(),
      perStrategyBudget: Object.fromEntries(portfolioManager.getPerStrategyBudget()),
    });

    // -----------------------------------------------------------------------
    // 7) StrategyRunner
    // -----------------------------------------------------------------------
    const emergencyHandler = this.engageEmergency.bind(this, portfolioManager);
    const runner = new StrategyRunner({
      instances,
      orderManager,
      positionManager,
      sizingFn: this.options.sizingFn ?? defaultSizingFn,
      enabledSymbols: this.config.symbols.enabled,
      riskPerTrade: this.config.risk.risk_per_trade,
      maxLeverage: this.config.risk.max_leverage,
      strategyPolicies: new Map(
        Object.entries(this.config.strategies)
          .filter(([, section]) => section.enabled)
          .map(([name, section]) => [name as StrategyName, {
            ...(section.symbols !== undefined ? { symbols: section.symbols } : {}),
            ...(section.risk_per_trade !== undefined ? { riskPerTrade: section.risk_per_trade } : {}),
            ...(section.max_positions !== undefined ? { maxPositions: section.max_positions } : {}),
            ...(section.leverage !== undefined ? { leverage: section.leverage } : {}),
          }]),
      ),
      riskManager,
      portfolioManager,
      onEmergency: emergencyHandler,
      logger: this.logger,
    });
    this.runner = runner;
    // Authenticated private order/execution streams are the primary source of
    // fill progress.  They are started after all lifecycle consumers exist,
    // and remain alive through emergency close coordination.
    await orderManager.startLifecycle();

    // -----------------------------------------------------------------------
    // 8) KillSwitchRegistry
    // -----------------------------------------------------------------------
    const killSwitches = createDefaultRegistry({
      positionManager,
      maxDrawdownPct: this.config.risk.max_drawdown_pct,
      maxPositions: this.config.risk.max_positions,
      ...(this.options.perStrategyKillSwitches !== undefined
        ? { perStrategyKillSwitches: this.options.perStrategyKillSwitches }
        : {}),
      logger: this.logger,
    });
    killSwitches.onTrigger(async (snapshot) => {
      await emergencyHandler(`kill-switch: ${snapshot.reasons.join(", ")}`);
    });

    // -----------------------------------------------------------------------
    // 9) Telemetry
    // -----------------------------------------------------------------------
    const telemetry = new Telemetry({
      logDir: this.config.telemetry.log_dir,
      metricsIntervalSec: this.telemetryMetricsIntervalSec,
      snapshotProvider: () => this.snapshotForTelemetry(positionManager, orderManager, runner),
      logger: this.logger,
    });
    this.telemetry = telemetry;
    telemetry.start();

    // -----------------------------------------------------------------------
    // 10) Periodic state-save + kill-switch evaluation
    // -----------------------------------------------------------------------
    const stateStore = this.stateStore;
    this.stateSaveInterval = setInterval(() => {
      stateStore.requestSave(this.getState());
    }, this.stateSaveIntervalMs);
    this.killSwitchInterval = setInterval(() => {
      this.observeEquity(positionManager, killSwitches, riskManager);
      const snap = killSwitches.evaluate();
      telemetry.setEngaged(snap.engaged, snap.reasons);
    }, this.killSwitchEvalIntervalMs);
    return { feed, runner, positionManager, riskManager, killSwitches, telemetry, portfolioManager, emergencyHandler };
  }

  /**
   * `run` — a feed subscription + run-loop. A loop a `stopRequested`
   * flag-re várakozik, vagy a kill-switch trigger-ére.
   */
  private async run(context: BotRunContext): Promise<void> {
    const { feed, runner } = context;
    // Subscribe to all enabled symbols and each active strategy's required
    // timeframes. A per-symbol set prevents duplicate exchange subscriptions.
    const timeframesBySymbol = this.subscriptionTimeframesBySymbol();
    for (const [symbol, timeframes] of timeframesBySymbol) {
      const exchangeSymbol = asSymbol(symbol);
      // Ticker (real-time price)
      const tickerSub = await feed.subscribeTicker(exchangeSymbol, (event: FeedEvent) => {
        void runner.onFeedEvent(event);
      });
      this.feedSubscriptions.push(tickerSub);
      this.logger.info("[bot] subscribed to ticker", { symbol });

      // OHLCV per enabled-strategy timeframe.
      for (const timeframe of timeframes) {
        try {
          const ohlcvSub = await feed.subscribeOhlcv(
            exchangeSymbol,
            timeframe,
            (event: FeedEvent) => {
              void runner.onFeedEvent(event);
            },
          );
          this.feedSubscriptions.push(ohlcvSub);
          this.logger.info("[bot] subscribed to ohlcv", { symbol, timeframe });
        } catch (err) {
          this.logger.warn(
            `[bot] OHLCV subscribe failed for ${symbol}/${timeframe}`,
            { error: errorMessage(err) },
          );
        }
      }
    }

    this.logger.info("[bot] run loop started", {
      subscribedSymbols: this.config.symbols.enabled.length,
    });

    // Periodic kill-switch evaluation (heartbeat — in addition to the
    // 5s interval from init). Configurable via BotOptions for tests.
    const heartbeat = setInterval(() => {
      void this.runHeartbeat(context);
    }, this.heartbeatIntervalMs);

    try {
      while (this.running && !this.stopRequested) {
        await new Promise<void>((resolve) => {
          setTimeout(resolve, 50);
        });
      }
    } finally {
      clearInterval(heartbeat);
      // Signal that the run loop has exited so `stop()` can proceed
      // to cleanup without deadlock.
      this.running = false;
    }
  }

  /** One ordered heartbeat: venue reconciliation must precede risk decisions. */
  private async runHeartbeat(context: BotRunContext): Promise<void> {
      await this.reconcileAuthoritativeEquity(context);
      this.observeEquity(
        context.positionManager,
        context.killSwitches,
        context.riskManager,
        this.authoritativeEquityUsd ?? undefined,
      );
      const snap = context.killSwitches.evaluate();
      context.telemetry.setEngaged(snap.engaged, snap.reasons);
      if (snap.engaged) {
        await context.emergencyHandler(`registry: ${snap.reasons.join(", ")}`);
      }
      // Phase 37 Track 4 — portfolio-stop check + equity update. A
      // `recordEquity` a PortfolioStop-on keresztül tüzelhet, ami
      // a `PortfolioManager.executeCloseAll`-ját hívja (a trip-action
      // a konstruktorban van ráhúzva). Ha a stop tüzelt, a botot is
      // leállítjuk, hogy a user felülvizsgálhassa a helyzetet.
      const equity = this.authoritativeEquityUsd ?? context.positionManager.getEquity();
      context.portfolioManager.recordEquity(equity);
      if (context.portfolioManager.isTripped()) {
        await context.emergencyHandler("portfolio-stop");
      }
  }

  /** Latch, join and settle one emergency close attempt while feeds stay live. */
  private async engageEmergency(portfolioManager: PortfolioManager, reason: string): Promise<void> {
    if (this.emergencyPromise !== null) return this.emergencyPromise;
    this.killSwitchEngaged = true;
    this.runner?.pause();
    this.emergencyPromise = (async () => {
      this.logger.error("[bot] emergency coordinator engaged", { reason });
      const report = await portfolioManager.executeCloseAll();
      const unresolved = report.unresolved;
      this.logger.error("[bot] emergency close report", {
        closed: report.closed, unresolved, cancelledOrders: report.cancelledOrders,
      });
      // Never tear down private reconciliation while an acknowledged close is
      // unresolved. A later heartbeat/trigger retries only after this joined
      // workflow releases.
      if (unresolved.length === 0) await this.stop();
    })().finally(() => { this.emergencyPromise = null; });
    return this.emergencyPromise;
  }

  /**
   * Resolve the OHLCV subscriptions required for each active symbol.
   *
   * For every enabled strategy we include its constructed strategy-native
   * timeframes and its TOML `htf`/`mtf`/`ltf` overrides.  A strategy that
   * declares `symbols` only contributes to the intersection with the bot's
   * enabled symbols; otherwise it applies to all active symbols.
   */
  private subscriptionTimeframesBySymbol(): ReadonlyMap<string, readonly Timeframe[]> {
    const bySymbol = new Map<string, Set<Timeframe>>();
    for (const symbol of this.config.symbols.enabled) {
      bySymbol.set(symbol, new Set());
    }
    const add = (symbol: string, timeframe: string): void => {
      if (!isSupportedTimeframe(timeframe)) return;
      bySymbol.get(symbol)?.add(timeframe);
    };
    for (const [name, section] of Object.entries(this.config.strategies) as [StrategyName, BotConfig["strategies"][StrategyName]][]) {
      if (!section.enabled) continue;
      const configuredSymbols = section.symbols?.filter((symbol) => bySymbol.has(symbol)) ?? this.config.symbols.enabled;
      const configuredTimeframes = [
        section.timeframes?.htf,
        section.timeframes?.mtf,
        section.timeframes?.ltf,
      ];
      for (const symbol of configuredSymbols) {
        for (const timeframe of configuredTimeframes) {
          if (timeframe !== undefined) add(symbol, timeframe);
        }
      }
      const instance = this.strategyInstances?.get(name);
      if (instance?.kind === "strategy") {
        for (const symbol of configuredSymbols) {
          for (const timeframe of instance.instance.timeframes) {
            add(symbol, timeframe);
          }
        }
      }
    }
    return new Map([...bySymbol].map(([symbol, timeframes]) => [symbol, [...timeframes]]));
  }

  /**
   * `cleanup` — graceful shutdown teendők.
   */
  private async cleanup(): Promise<void> {
    if (this.stateSaveInterval !== null) {
      clearInterval(this.stateSaveInterval);
      this.stateSaveInterval = null;
    }
    if (this.killSwitchInterval !== null) {
      clearInterval(this.killSwitchInterval);
      this.killSwitchInterval = null;
    }
    if (this.telemetry !== null) {
      this.telemetry.stop();
    }
    try {
      await this.orderManager?.stopLifecycle();
    } catch (err) {
      this.logger.warn("[bot] private lifecycle cleanup failed", { error: errorMessage(err) });
    }
    this.runner?.dispose();
    if (this.stateStore !== null) {
      try {
        this.stateStore.flush(this.getState());
      } catch (err) {
        this.logger.error("[bot] state flush failed", {
          error: errorMessage(err),
        });
      }
    }
    if (this.feed !== null) {
      for (const id of this.feedSubscriptions) {
        try {
          await this.feed.unsubscribe(id);
        } catch {
          // best-effort
        }
      }
      this.feedSubscriptions.length = 0;
      try {
        await this.feed.close();
      } catch (err) {
        this.logger.error("[bot] feed close failed", {
          error: errorMessage(err),
        });
      }
    }
    this.running = false;
    this.logger.info("[bot] stopped", {
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
   * Live reconciliation values the venue balance, spot inventory, and
   * derivative UPL without adding derivative notional (which would double
   * count collateral).  A failed query leaves the previous observation intact.
   */
  private async reconcileAuthoritativeEquity(context: BotRunContext): Promise<void> {
    if (this.config.bot.mode !== "live" || this.authorityReconciliationInFlight) return;
    this.authorityReconciliationInFlight = true;
    try {
      const balances = await context.feed.fetchBalances();
      let equity = balances.find((balance) => balance.currency === "USDC")?.total ?? 0;
      let derivativePositions: readonly ExchangePosition[] = [];
      if (context.feed.fetchPositions !== undefined) {
        try {
          derivativePositions = await context.feed.fetchPositions(this.config.symbols.enabled as never);
        } catch {
          // Spot categories correctly reject fetchPositions; balances below
          // are then the authoritative inventory source.
        }
      }
      // Contract notional is deliberately excluded: wallet collateral already
      // represents it, so only UPL changes account equity.  Spot inventory is
      // valued independently, including in mixed spot/derivative accounts.
      equity += derivativePositions.reduce((sum, position) => sum + (position.unrealizedPnl ?? 0), 0);
      for (const symbolText of this.config.symbols.enabled) {
        const market = await context.feed.fetchMarketMeta(asSymbol(symbolText));
        if (market.isSpot !== true || market.base === "USDC") continue;
        const amount = balances.find((balance) => balance.currency === market.base)?.total ?? 0;
        if (amount <= 0) continue;
        const ticker = await context.feed.fetchTickerSnapshot(asSymbol(symbolText));
        equity += amount * ticker.last;
      }
      if (Number.isFinite(equity) && equity > 0) {
        this.authoritativeEquityUsd = equity;
        this.observeEquity(context.positionManager, context.killSwitches, context.riskManager, equity);
      }
    } catch (err) {
      this.logger.warn("[bot] authoritative equity reconciliation failed", { error: errorMessage(err) });
    } finally {
      this.authorityReconciliationInFlight = false;
    }
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
    const unrealizedPnl = positions.reduce((acc, p) => acc + p.unrealizedPnl, 0);
    const counters = orderManager.getCounters();
    return {
      equityUsd: equity,
      initialEquityUsd: initialEquity > 0 ? initialEquity : 0,
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

}
