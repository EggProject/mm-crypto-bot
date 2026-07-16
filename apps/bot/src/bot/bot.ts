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

import type { ExchangeFeed, FeedEvent } from "@mm-crypto-bot/exchange";
import {
  MockExchangeFeed,
  createExchangeClient,
  asSymbol,
} from "@mm-crypto-bot/exchange";
import type { DydxFundingSource } from "@mm-crypto-bot/core";
import type { Logger } from "@mm-crypto-bot/shared";
import { createLogger } from "@mm-crypto-bot/shared";

import { createStrategyInstances } from "../config/strategy-registry.js";
import type { BotConfig } from "../config/schema.js";
import {
  CorrelationMatrix,
  PortfolioManager,
  PortfolioStop,
  RiskBudgetAllocator,
} from "../portfolio/index.js";

import { OrderManager } from "./order-manager.js";
import { PositionManager } from "./position-manager.js";
import { StateStore, type BotState } from "./state-store.js";
import { Telemetry, formatUptime } from "./telemetry.js";
import type { KillSwitchRegistry, KillSwitch} from "./kill-switches.js";
import { createDefaultRegistry } from "./kill-switches.js";
import {
  StrategyRunner,
  defaultSizingFn,
  type StrategyRunnerOptions,
} from "./strategy-runner.js";

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
  private orderManager: OrderManager | null = null;
  private positionManager: PositionManager | null = null;
  private stateStore: StateStore | null = null;
  private telemetry: Telemetry | null = null;
  private killSwitches: KillSwitchRegistry | null = null;
  private runner: StrategyRunner | null = null;
  // Phase 37 Track 4 — portfolió-koordináció.
  private riskBudget: RiskBudgetAllocator | null = null;
  private correlation: CorrelationMatrix | null = null;
  private portfolioStop: PortfolioStop | null = null;
  private portfolioManager: PortfolioManager | null = null;

  private startedAt = 0;
  private stopRequested = false;
  private running = false;
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
    this.running = true;
    this.startedAt = Date.now();
    this.logger.info("[bot] starting", {
      mode: this.config.bot.mode,
      exchange: this.config.exchange.id,
      strategies: Object.entries(this.config.strategies)
        .filter(([_, s]) => s.enabled)
        .map(([k]) => k),
    });
    await this.init();
    await this.run();
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
    if (!this.running) return;
    this.stopRequested = true;
    this.logger.info("[bot] stopping — graceful shutdown requested");
    // Wait briefly for the run-loop to exit. The run() finally block
    // sets `this.running = false` when the loop exits, so this loop
    // will unblock within ~50ms after `stopRequested` is observed.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- this.running is mutated cross-method (run() finally)
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
   * `getState` — a futó állapot pillanatképe. A `mm-bot status` CLI
   * (Track D), a wire-up probe teszt, és a TUI (`bot.subscribe`)
   * is használja.
   *
   * A függvény a state összeállítása után értesíti a `stateListeners`-ben
   * regisztrált feliratkozókat — a Phase 34 Track A TUI integrációhoz.
   */
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

  // --------------------------------------------------------------------------
  // Internals
  // --------------------------------------------------------------------------

  /**
   * `init` — a komponensek összeállítása. Nem indítja el a feed subscription-t.
   */
  private async init(): Promise<void> {
    // -----------------------------------------------------------------------
    // 1) Exchange feed
    // -----------------------------------------------------------------------
    if (this.options.feed !== undefined) {
      this.feed = this.options.feed;
    } else if (this.config.exchange.id === "mock" || this.config.bot.mode === "paper") {
      // Phase 38 Fix #42: paper mode always uses MockExchangeFeed (no auth
      // required). The `exchange.id` field is preserved for backward compat
      // and informational purposes, but the actual feed in paper mode is the
      // mock (with PRNG data, in-memory balance, in-memory order book).
      // Live mode requires the real `bybiteu` feed and BYBIT_API_KEY/SECRET.
      this.feed = new MockExchangeFeed();
    } else {
      this.feed = createExchangeClient({ useMock: false });
    }
    await this.feed.open();
    this.logger.info("[bot] feed opened", { exchangeId: this.feed.exchangeId });

    // -----------------------------------------------------------------------
    // 2) Balances
    // -----------------------------------------------------------------------
    const balances = await this.feed.fetchBalances();
    const usdcBalance = balances.find((b) => b.currency === "USDC");
    const initialEquity = usdcBalance?.total ?? 10_000;
    this.logger.info("[bot] initial equity", { usdc: initialEquity });

    // -----------------------------------------------------------------------
    // 3) PositionManager
    // -----------------------------------------------------------------------
    this.positionManager = new PositionManager({
      initialEquityUsd: initialEquity,
      maxPositions: this.config.risk.max_positions,
      maxLeverage: this.config.risk.max_leverage,
      logger: this.logger,
    });

    // -----------------------------------------------------------------------
    // 4) StateStore
    // -----------------------------------------------------------------------
    this.stateStore = new StateStore({
      filePath: this.config.bot.state_file,
      logger: this.logger,
    });
    this.stateStore.load();

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
      logger: this.logger,
    });

    // -----------------------------------------------------------------------
    // 6) Strategy instances
    // -----------------------------------------------------------------------
    const instances = createStrategyInstances(this.config, {
      ...(this.options.fundingSource !== undefined ? { dydxFundingSource: this.options.fundingSource } : {}),
    });
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
      portfolioManager: this.portfolioManager,
      logger: this.logger,
    });

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
    this.killSwitches.onTrigger(async () => {
      this.logger.error("[bot] kill-switch triggered — stopping bot");
      await this.stop();
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

    // Subscribe to all enabled symbols.
    for (const symbol of this.config.symbols.enabled) {
      const exchangeSymbol = asSymbol(symbol);
      const sub = await this.feed.subscribeTicker(exchangeSymbol, (event: FeedEvent) => {
        if (this.runner !== null) {
          void this.runner.onFeedEvent(event);
        }
      });
      this.feedSubscriptions.push(sub);
      this.logger.info("[bot] subscribed to ticker", { symbol });
    }

    this.logger.info("[bot] run loop started", {
      subscribedSymbols: this.config.symbols.enabled.length,
    });

    // Periodic kill-switch evaluation (heartbeat — in addition to the
    // 5s interval from init). Configurable via BotOptions for tests.
    const heartbeat = setInterval(() => {
      if (this.killSwitches !== null && this.telemetry !== null) {
        const snap = this.killSwitches.evaluate();
        this.telemetry.setEngaged(snap.engaged, snap.reasons);
        if (snap.engaged) {
          void this.stop();
        }
      }
      // Phase 37 Track 4 — portfolio-stop check + equity update. A
      // `recordEquity` a PortfolioStop-on keresztül tüzelhet, ami
      // a `PortfolioManager.executeCloseAll`-ját hívja (a trip-action
      // a konstruktorban van ráhúzva). Ha a stop tüzelt, a botot is
      // leállítjuk, hogy a user felülvizsgálhassa a helyzetet.
      if (this.portfolioManager !== null) {
        const equity = this.positionManager?.getEquity() ?? 0;
        this.portfolioManager.recordEquity(equity);
        if (this.portfolioManager.isTripped()) {
          this.logger.error("[bot] portfolio-stop tripped — stopping bot");
          void this.stop();
        }
      }
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
}
