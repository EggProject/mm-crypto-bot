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
 *      - Nyitott pozíciók opcionális zárása (config.bot.close_positions_on_shutdown).
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
import type { StateFeedHandle } from "../state-feed/index.js";
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
   * `stateSaveIntervalMs` — opcionális state-save periodic interval (ms).
   * Default: 60_000 (60s). A Bot `getState()` hívása ekkor fut le
   * periodikusan, ami értesíti a `stateListeners`-ben regisztrált
   * feliratkozókat (pl. a TUI). A wire-up probe teszt 100 ms-re
   * állítja a gyors notify-verifikáció kedvéért.
   */
  readonly stateSaveIntervalMs?: number;
  readonly killSwitchEvalIntervalMs?: number;
  readonly heartbeatIntervalMs?: number;
  readonly telemetryMetricsIntervalSec?: number;
  readonly perStrategyKillSwitches?: readonly KillSwitch[];
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
  private killSwitches: KillSwitchRegistry | null = null;
  private runner: StrategyRunner | null = null;
  private riskManager: RiskManager | null = null;
  private strategyInstances: ReadonlyMap<StrategyName, BotStrategyInstance> | null = null;
  // Phase 66: state-feed handle set externally by `start.ts` BEFORE `bot.start()`.
  // The `run()` OHLCV/ticker callback publishes bars + tickers here.
  // Without this, the web client dashboard shows "No charts configured".
  private stateFeed: StateFeedHandle | null = null;
  /**
   * Readiness listeners are notified exactly after critical initialization
   * succeeds and immediately before the long-lived market-data run loop.
   * The CLI uses this boundary to publish `running`; `start()` itself does
   * not resolve until shutdown, so it is not a readiness signal.
   */
  private readonly initializedListeners = new Set<() => void>();
  // Phase 37 Track 4 — portfolió-koordináció.
  private riskBudget: RiskBudgetAllocator | null = null;
  private correlation: CorrelationMatrix | null = null;
  private portfolioStop: PortfolioStop | null = null;
  private portfolioManager: PortfolioManager | null = null;

  private startedAt = 0;
  private stopRequested = false;
  private running = false;
  private stopping = false;
  private paused = false;
  /** A kill latch blocks all new signal handling before shutdown begins. */
  private killSwitchEngaged = false;
  /** Single Bot-owned emergency workflow shared by every trigger source. */
  private emergencyPromise: Promise<void> | null = null;
  private readonly feedSubscriptions: number[] = [];
  private stateSaveInterval: ReturnType<typeof setInterval> | null = null;
  private killSwitchInterval: ReturnType<typeof setInterval> | null = null;

  // -------------------------------------------------------------------------
  // State-change subscribers (Phase 34 Track A — TUI integration)
  // -------------------------------------------------------------------------
  // The TUI subscribes to Bot state changes via `bot.subscribe(listener)`.
  // The set is COPIED before each iteration (copy-on-write) so listeners
  // may safely unsubscribe during their own callback (e.g. when the TUI
  // unmounts on `[q]` and the cleanup runs the unsubscribe synchronously).
  private readonly stateListeners = new Set<(state: BotState) => void>();

  // Periodic interval durations. Configurable via BotOptions for tests
  // (10ms in tests vs 60s/5s in production). The defaults below match
  // the original hardcoded values.
  private readonly stateSaveIntervalMs: number;
  private readonly killSwitchEvalIntervalMs: number;
  private readonly heartbeatIntervalMs: number;
  private authoritativeEquityUsd: number | null = null;
  private authorityReconciliationInFlight = false;
  private readonly telemetryMetricsIntervalSec: number;

  public constructor(options: BotOptions) {
    this.config = options.config;
    this.options = options;
    this.logger = options.logger ?? createLogger(options.config.bot.log_level);
    this.stateSaveIntervalMs = options.stateSaveIntervalMs ?? 60_000;
    this.killSwitchEvalIntervalMs = options.killSwitchEvalIntervalMs ?? 5_000;
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? 60_000;
    this.telemetryMetricsIntervalSec = options.telemetryMetricsIntervalSec ?? 60;
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
    this.paused = false;
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
      await this.init();
      this.notifyInitialized();
      await this.run();
    } catch (err) {
      // A failed initialization used to leave `running=true` and partially
      // constructed timers/feed resources behind.  Treat start as a
      // transaction: either the ready boundary is reached, or all resources
      // created so far are released and the next attempt begins cleanly.
      this.stopRequested = true;
      this.running = false;
      try {
        await this.cleanup();
      } catch (cleanupErr) {
        this.logger.warn("[bot] startup rollback cleanup failed", {
          error: cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr),
        });
      }
      throw err;
    }
  }

  /**
   * Subscribe to the one-shot readiness boundary of the current or a future
   * start attempt.  A listener is deliberately invoked synchronously: the
   * caller can publish a coherent external state before `run()` accepts its
   * first market-data event.  Listener failures abort startup and therefore
   * receive the same rollback guarantees as any other initialization failure.
   */
  public onInitialized(listener: () => void): () => void {
    this.initializedListeners.add(listener);
    return () => {
      this.initializedListeners.delete(listener);
    };
  }

  /**
   * `stop` — graceful shutdown. A `run-loop` a következő iterációban
   * kilép, és a `run()` Promise feloldódik. A `stop()` azután:
   *   - lezárja a nyitott pozíciókat (ha a config kéri),
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
    const deadline = Date.now() + 5_000;
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

  /**
   * Pause only the trading engine. Market-data subscriptions remain open so
   * the dashboard stays current, but the runner rejects both newly received
   * events and any signal that reaches the order-emission boundary after the
   * pause has been requested.
   */
  public pause(): void {
    if (this.killSwitchEngaged) {
      this.logger.warn("[bot] pause requested after kill-switch — engine remains latched");
      return;
    }
    this.paused = true;
    this.runner?.pause();
    this.logger.info("[bot] trading engine paused");
  }

  /** Resume processing after an operator pause. A kill-switch latch cannot be resumed. */
  public resume(): void {
    if (this.killSwitchEngaged) {
      this.logger.warn("[bot] resume rejected — kill-switch is engaged");
      return;
    }
    this.paused = false;
    this.runner?.resume();
    this.logger.info("[bot] trading engine resumed");
  }

  public isPaused(): boolean {
    return this.paused;
  }

  public isKillSwitchEngaged(): boolean {
    return this.killSwitchEngaged;
  }

  /**
   * `getState` — a futó állapot pillanatképe. A `mm-bot status` CLI
   * (Track D), a wire-up probe teszt, és a TUI (`bot.subscribe`)
   * is használja.
   *
   * A függvény a state összeállítása után értesíti a `stateListeners`-ben
   * regisztrált feliratkozókat — a Phase 34 Track A TUI integrációhoz.
   */
  /**
   * `getConfig` — visszaadja a bot indításakor használt `BotConfig`-ot.
   * Phase 43 Track 3: a `startCommand.runTui` használja a log-fájl
   * path-jának levezetéséhez (`<state_file>.log`). Read-only accessor —
   * a config mezőit a CLI rétegben nem módosítjuk (a settings panel
   * ír, de az a TOML fájlon át, nem ezen az objektumon).
   */
  public getConfig(): BotConfig {
    return this.config;
  }

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
    this.notifyStateListeners(state);
    return state;
  }

  /**
   * `subscribe` — feliratkozás a state-változásokra.
   *
   * Minden `getState()` híváskor (és a periodikus state-save során)
   * a listener megkapja a friss `BotState` pillanatképet. A TUI ezen
   * a csatornán kapja a realtime frissítéseket.
   *
   * @param listener A state-változásra figyelő callback.
   * @returns Egy `unsubscribe` függvény — a hívó ezzel szüntetheti meg
   *          a feliratkozást. A függvény idempotens.
   */
  public subscribe(listener: (state: BotState) => void): () => void {
    this.stateListeners.add(listener);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      this.stateListeners.delete(listener);
    };
  }

  /**
   * `notifyStateListeners` — belső segédfüggvény. Copy-on-write
   * iterálás: a Set-ből készítünk egy másolatot, és a másolaton
   * hívjuk a listenereket. Így egy listener biztonságosan
   * leiratkozhat a saját callbackje közben.
   *
   * A listener-ek kivételeit elkapjuk és logoljuk — egy hibás
   * listener nem állíthatja le a többi értesítését.
   */
  private notifyStateListeners(state: BotState): void {
    if (this.stateListeners.size === 0) return;
    for (const listener of [...this.stateListeners]) {
      try {
        listener(state);
      } catch (err) {
        this.logger.warn("[bot] state listener threw — continuing", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  /** Notify the startup-ready boundary without retaining stale listeners. */
  private notifyInitialized(): void {
    for (const listener of [...this.initializedListeners]) {
      listener();
    }
  }

  // --------------------------------------------------------------------------
  // Internals
  // --------------------------------------------------------------------------

  /**
   * `init` — a komponensek összeállítása. Nem indítja el a feed subscription-t.
   */
  private async init(): Promise<void> {
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
    if (this.options.feed !== undefined) {
      // Az `options.feed` az egyetlen TESZT-CSATORNA a mock feed-hez
      // (a unit/integration tesztek ezen keresztül injectelik a
      // `MockExchangeFeed`-et, lásd `apps/bot/src/bot/bot.test.ts`).
      // Production kódból a `MockExchangeFeed` NEM érhető el (a fájl a
      // `__testing__/` almappában van, nem exportálódik a public
      // surface-en) — lásd a PHASE 66 ENFORCEMENT blokkot a
      // `packages/exchange/src/index.ts` fájlban.
      this.feed = this.options.feed;
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
        this.feed = createExchangeClient({
          override: { apiKey: "", secret: "" },
          rateLimitMs: this.config.exchange.rate_limit_ms,
          sandbox: this.config.exchange.sandbox,
          timeoutMs: this.config.exchange.timeout_ms,
          ...(this.config.exchange.endpoint !== undefined ? { endpoint: this.config.exchange.endpoint } : {}),
          ...(this.config.exchange.ws_endpoint !== undefined ? { wsEndpoint: this.config.exchange.ws_endpoint } : {}),
        });
      } else {
        this.feed = createExchangeClient({
          rateLimitMs: this.config.exchange.rate_limit_ms,
          sandbox: this.config.exchange.sandbox,
          timeoutMs: this.config.exchange.timeout_ms,
          ...(this.config.exchange.endpoint !== undefined ? { endpoint: this.config.exchange.endpoint } : {}),
          ...(this.config.exchange.ws_endpoint !== undefined ? { wsEndpoint: this.config.exchange.ws_endpoint } : {}),
        });
      }
    }
    await this.feed.open();
    this.logger.info("[bot] feed opened", { exchangeId: this.feed.exchangeId });

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
      const balances = await this.feed.fetchBalances();
      const usdcBalance = balances.find((b) => b.currency === "USDC");
      initialEquity = usdcBalance?.total ?? 10_000;
      this.logger.info("[bot] initial equity", { usdc: initialEquity });
    }

    // -----------------------------------------------------------------------
    // 3) PositionManager
    // -----------------------------------------------------------------------
    this.positionManager = new PositionManager({
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

    // All adaptive-risk modules remain disabled by their schema defaults, so
    // attaching this sidecar preserves legacy sizing when the user has not
    // opted in.  When enabled, both the runner and PositionManager observe
    // the same instance (Kelly/drawdown sizing + trailing-stop lifecycle).
    this.riskManager = new RiskManager({
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
    this.positionManager.setRiskManager(this.riskManager);

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
        this.positionManager.restoreRealizedPnl(loadedState.realizedPnlUsd);
      }
      // 2) closed trades history — a P&L history konzisztenciájához
      if (loadedState.closedTrades.length > 0) {
        this.positionManager.restoreClosedTrades(
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
          try {
            this.positionManager.restorePosition({
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
          } catch (err) {
            this.logger.error(
              "[bot] failed to restore position from state — skipping",
              {
                strategy: p.strategy,
                symbol: p.symbol,
                side: p.side,
                error: err instanceof Error ? err.message : String(err),
              },
            );
            // A restore HIBÁJA NEM ÁLLÍTJA LE A BOTOT. A Phase 68 tanulsága:
            // ha egy pozíciót nem sikerül visszatölteni (pl. séma-eltérés
            // miatt), a bot inkább induljon el a maradék state-tel, mintsem
            // crasheljen. A skip-elt pozíciót a user manuálisan lezárhatja.
          }
        }
      }
    }

    // -----------------------------------------------------------------------
    // 5) OrderManager
    // -----------------------------------------------------------------------
    // Defensive guard — `this.feed` was assigned non-null above.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- this.feed was set to non-null at the top of init()
    if (this.feed === null) {
      throw new Error("[bot] feed is null after init");
    }
    const positionManager = this.positionManager;
    this.orderManager = new OrderManager({
      feed: this.feed,
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
    this.portfolioManager = new PortfolioManager({
      riskBudget: this.riskBudget,
      correlation: this.correlation,
      portfolioStop: this.portfolioStop,
      positionManager: this.positionManager,
      orderManager: this.orderManager,
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
      this.portfolioManager.setStrategyConfig({
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
      perStrategyBudget: Object.fromEntries(this.portfolioManager.getPerStrategyBudget()),
    });

    // -----------------------------------------------------------------------
    // 7) StrategyRunner
    // -----------------------------------------------------------------------
    this.runner = new StrategyRunner({
      instances,
      orderManager: this.orderManager,
      positionManager: this.positionManager,
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
      riskManager: this.riskManager,
      portfolioManager: this.portfolioManager,
      onEmergency: (reason) => this.engageEmergency(reason),
      logger: this.logger,
    });
    // Authenticated private order/execution streams are the primary source of
    // fill progress.  They are started after all lifecycle consumers exist,
    // and remain alive through emergency close coordination.
    await this.orderManager.startLifecycle();

    // -----------------------------------------------------------------------
    // 8) KillSwitchRegistry
    // -----------------------------------------------------------------------
    this.killSwitches = createDefaultRegistry({
      positionManager: this.positionManager,
      maxDrawdownPct: this.config.risk.max_drawdown_pct,
      maxPositions: this.config.risk.max_positions,
      ...(this.options.perStrategyKillSwitches !== undefined
        ? { perStrategyKillSwitches: this.options.perStrategyKillSwitches }
        : {}),
      logger: this.logger,
    });
    this.killSwitches.onTrigger(async (snapshot) => {
      await this.engageEmergency(`kill-switch: ${snapshot.reasons.join(", ")}`);
    });

    // -----------------------------------------------------------------------
    // 9) Telemetry
    // -----------------------------------------------------------------------
    this.telemetry = new Telemetry({
      logDir: this.config.telemetry.log_dir,
      metricsIntervalSec: this.telemetryMetricsIntervalSec,
      snapshotProvider: () => this.snapshotForTelemetry(),
      logger: this.logger,
    });
    this.telemetry.start();

    // -----------------------------------------------------------------------
    // 10) Periodic state-save + kill-switch evaluation
    // -----------------------------------------------------------------------
    this.stateSaveInterval = setInterval(() => {
      if (this.stateStore !== null) {
        this.stateStore.requestSave(this.getState());
      }
    }, this.stateSaveIntervalMs);
    this.killSwitchInterval = setInterval(() => {
      if (this.killSwitches !== null && this.telemetry !== null) {
        this.observeEquity();
        const snap = this.killSwitches.evaluate();
        this.telemetry.setEngaged(snap.engaged, snap.reasons);
      }
    }, this.killSwitchEvalIntervalMs);
  }

  /**
   * `run` — a feed subscription + run-loop. A loop a `stopRequested`
   * flag-re várakozik, vagy a kill-switch trigger-ére.
   */
  private async run(): Promise<void> {
    if (this.feed === null || this.runner === null) {
      throw new Error("[bot] init() must be called before run()");
    }

    // Subscribe to all enabled symbols (ticker + OHLCV per timeframe). The
    // dashboard needs the standard chart bars, while strategies need their
    // own configured/native timeframes (notably Donchian's 15m LTF).  Build
    // a per-symbol set so overlapping strategy configs never create duplicate
    // CCXT subscriptions.
    const timeframesBySymbol = this.subscriptionTimeframesBySymbol();
    for (const symbol of this.config.symbols.enabled) {
      const exchangeSymbol = asSymbol(symbol);
      // Ticker (real-time price)
      const tickerSub = await this.feed.subscribeTicker(exchangeSymbol, (event: FeedEvent) => {
        if (this.runner !== null) {
          void this.runner.onFeedEvent(event);
        }
        // Phase 83.6: also publish the tick to the state-feed so the
        // web dashboard's chart grid can update the in-progress
        // bar's close/high/low in real-time (not just on bar
        // boundaries). The 4Hz broadcast throttle in
        // `state-feed/feed-server.ts` handles per-client
        // rate-limiting; for bybit.eu the `fetchTicker` 1Hz polling
        // fallback is the production ceiling, but the wire-up is
        // correct for any future `watchTicker`-native CCXT Pro.
        if (event.kind === "ticker" && this.stateFeed !== null) {
          this.stateFeed.publisher.publishTick(
            event.payload.symbol,
            event.payload.last,
          );
        } else if (event.kind === "ticker") {
          this.logger.warn(
            "[bot] ticker event but stateFeed is null — tick dropped",
            { symbol: event.payload.symbol },
          );
        }
      });
      this.feedSubscriptions.push(tickerSub);
      this.logger.info("[bot] subscribed to ticker", { symbol });

      // OHLCV per timeframe (chart bars + enabled strategy requirements)
      for (const timeframe of timeframesBySymbol.get(symbol) ?? []) {
        try {
          const ohlcvSub = await this.feed.subscribeOhlcv(
            exchangeSymbol,
            timeframe,
            (event: FeedEvent) => {
              if (this.runner !== null) {
                void this.runner.onFeedEvent(event);
              }
              // Phase 66: also publish to the state-feed so the web
              // client chart grid gets the bars. The candle is
              // CCXT-format [time, open, high, low, close, volume] and
              // publishBar expects the named-field ohlc shape.
              if (event.kind === "ohlcv" && this.stateFeed !== null) {
                const { symbol: s, timeframe: tf, candle } = event.payload;
                const [time, open, high, low, close, volume] = candle as unknown as [
                  number,
                  number,
                  number,
                  number,
                  number,
                  number,
                ];
                this.stateFeed.publisher.publishBar(s, tf, {
                  time,
                  open,
                  high,
                  low,
                  close,
                  volume,
                });
                this.logger.info("[bot] published bar", {
                  symbol: s,
                  timeframe: tf,
                  close,
                });
              } else if (event.kind === "ohlcv") {
                this.logger.warn(
                  "[bot] ohlcv event but stateFeed is null — bar dropped",
                  { symbol: event.payload.symbol, timeframe: event.payload.timeframe },
                );
              }
            },
          );
          this.feedSubscriptions.push(ohlcvSub);
          this.logger.info("[bot] subscribed to ohlcv", { symbol, timeframe });
        } catch (err) {
          this.logger.warn(
            `[bot] OHLCV subscribe failed for ${symbol}/${timeframe}`,
            { error: err instanceof Error ? err.message : String(err) },
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
      void this.runHeartbeat();
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
  private async runHeartbeat(): Promise<void> {
      await this.reconcileAuthoritativeEquity();
      if (this.killSwitches !== null && this.telemetry !== null) {
        this.observeEquity(this.authoritativeEquityUsd ?? undefined);
        const snap = this.killSwitches.evaluate();
        this.telemetry.setEngaged(snap.engaged, snap.reasons);
        if (snap.engaged) {
          await this.engageEmergency(`registry: ${snap.reasons.join(", ")}`);
        }
      }
      // Phase 37 Track 4 — portfolio-stop check + equity update. A
      // `recordEquity` a PortfolioStop-on keresztül tüzelhet, ami
      // a `PortfolioManager.executeCloseAll`-ját hívja (a trip-action
      // a konstruktorban van ráhúzva). Ha a stop tüzelt, a botot is
      // leállítjuk, hogy a user felülvizsgálhassa a helyzetet.
      if (this.portfolioManager !== null) {
        const equity = this.authoritativeEquityUsd ?? this.positionManager?.getEquity() ?? 0;
        this.portfolioManager.recordEquity(equity);
        if (this.portfolioManager.isTripped()) {
          await this.engageEmergency("portfolio-stop");
        }
      }
  }

  /** Latch, join and settle one emergency close attempt while feeds stay live. */
  private async engageEmergency(reason: string): Promise<void> {
    if (this.emergencyPromise !== null) return this.emergencyPromise;
    this.killSwitchEngaged = true;
    this.paused = true;
    this.runner?.pause();
    this.emergencyPromise = (async () => {
      this.logger.error("[bot] emergency coordinator engaged", { reason });
      const report = await this.portfolioManager?.executeCloseAll();
      const unresolved = report?.unresolved ?? ["portfolio manager unavailable"];
      this.logger.error("[bot] emergency close report", {
        closed: report?.closed ?? [], unresolved, cancelledOrders: report?.cancelledOrders ?? [],
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
   * The historical 1h/4h/1d dashboard series are retained.  For every
   * enabled strategy we additionally include its constructed strategy-native
   * timeframes and its TOML `htf`/`mtf`/`ltf` overrides.  A strategy that
   * declares `symbols` only contributes to the intersection with the bot's
   * enabled symbols; otherwise it applies to all active symbols.
   */
  private subscriptionTimeframesBySymbol(): ReadonlyMap<string, readonly Timeframe[]> {
    const chartTimeframes: readonly Timeframe[] = ["1h", "4h", "1d"];
    const bySymbol = new Map<string, Set<Timeframe>>();
    for (const symbol of this.config.symbols.enabled) {
      bySymbol.set(symbol, new Set(chartTimeframes));
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
      this.logger.warn("[bot] private lifecycle cleanup failed", { error: err instanceof Error ? err.message : String(err) });
    }
    this.runner?.dispose();
    if (this.stateStore !== null) {
      try {
        this.stateStore.flush(this.getState());
      } catch (err) {
        this.logger.error("[bot] state flush failed", {
          error: err instanceof Error ? err.message : String(err),
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
          error: err instanceof Error ? err.message : String(err),
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
  private observeEquity(authoritativeEquityUsd?: number): void {
    if (this.positionManager === null) return;
    const equity = authoritativeEquityUsd ?? this.positionManager.getEquity();
    this.killSwitches?.updateEquity(equity);
    this.riskManager?.onEquityUpdate(equity);
  }

  /**
   * Live reconciliation values the venue balance, spot inventory, and
   * derivative UPL without adding derivative notional (which would double
   * count collateral).  A failed query leaves the previous observation intact.
   */
  private async reconcileAuthoritativeEquity(): Promise<void> {
    if (this.config.bot.mode !== "live" || this.feed === null || this.authorityReconciliationInFlight) return;
    this.authorityReconciliationInFlight = true;
    try {
      const balances = await this.feed.fetchBalances();
      let equity = balances.find((balance) => balance.currency === "USDC")?.total ?? 0;
      let derivativePositions: readonly ExchangePosition[] = [];
      if (this.feed.fetchPositions !== undefined) {
        try {
          derivativePositions = await this.feed.fetchPositions(this.config.symbols.enabled as never);
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
        const market = await this.feed.fetchMarketMeta(asSymbol(symbolText));
        if (market.isSpot !== true || market.base === "USDC") continue;
        const amount = balances.find((balance) => balance.currency === market.base)?.total ?? 0;
        if (amount <= 0) continue;
        const ticker = await this.feed.fetchTickerSnapshot(asSymbol(symbolText));
        equity += amount * ticker.last;
      }
      if (Number.isFinite(equity) && equity > 0) {
        this.authoritativeEquityUsd = equity;
        this.observeEquity(equity);
      }
    } catch (err) {
      this.logger.warn("[bot] authoritative equity reconciliation failed", { error: err instanceof Error ? err.message : String(err) });
    } finally {
      this.authorityReconciliationInFlight = false;
    }
  }

  /**
   * `snapshotForTelemetry` — a Telemetry számára összeállított pillanatkép.
   */
  private snapshotForTelemetry() {
    if (this.positionManager === null || this.orderManager === null) {
      throw new Error("[bot] not initialized");
    }
    const positions = this.positionManager.getPositions();
    const equity = this.positionManager.getEquity();
    const initialEquity = equity - this.positionManager.getRealizedPnl();
    const realizedPnl = this.positionManager.getRealizedPnl();
    const unrealizedPnl = positions.reduce((acc, p) => acc + p.unrealizedPnl, 0);
    const counters = this.orderManager.getCounters();
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
      activeStrategies: this.runner?.getActiveStrategyNames() ?? [],
    };
  }

  /**
   * Phase 66: `attachStateFeed` — the `start.ts` calls this AFTER
   * `attachStateFeed(bot, ...)` returns, so the OHLCV/ticker callback
   * inside `run()` can publish bars + state to the state-feed TCP
   * socket, which the web client dashboard subscribes to.
   *
   * Without this wiring, the `this.stateFeed` field stays `null` and
   * the `if (event.kind === "ohlcv" && this.stateFeed !== null)`
   * guard drops every bar — the dashboard shows "No charts configured".
   */
  public attachStateFeed(handle: StateFeedHandle): void {
    this.stateFeed = handle;
    this.logger.info("[bot] state-feed handle attached");
  }
}
