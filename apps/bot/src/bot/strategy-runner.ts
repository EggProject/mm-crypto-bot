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

import type { ClientOrderId, FeedEvent, Ohlcv, Symbol as ExchangeSymbol } from "@mm-crypto-bot/exchange";
import type {
  Bar,
  CarryMarket,
  DydxFundingSource,
  FundingSnapshot,
  Strategy,
  StrategyContext,
  StrategySignal,
} from "@mm-crypto-bot/core";
import { adx, lastAdx, SignalBus } from "@mm-crypto-bot/core";
import type { UnsubscribeFn } from "@mm-crypto-bot/core";
import type { Candle, Logger } from "@mm-crypto-bot/shared";
import { createLogger } from "@mm-crypto-bot/shared";
import type { Brand } from "@mm-crypto-bot/shared";

import type { StrategyName } from "../config/schema.js";
import type { BotStrategyInstance } from "../config/strategy-registry.js";
import type { RiskManager } from "../risk/index.js";
import type { PortfolioManager } from "../portfolio/index.js";
import type { OrderIntent, OrderLifecycleEvent, OrderManager } from "./order-manager.js";
import type { PositionManager, PositionSnapshot } from "./position-manager.js";
import type { BotState } from "./state-store.js";

// ============================================================================
// Public types
// ============================================================================

/**
 * `StrategyRunnerOptions` — a runner konfigurációja.
 *
 * - `instances`           — a `createStrategyInstances` Map-je.
 * - `orderManager`        — a kitöltendő OrderManager.
 * - `positionManager`     — a nyilvántartó.
 * - `sizingFn`            — a position-sizing függvény (signal + symbol + price → qty).
 * - `enabledSymbols`      — a `config.symbols.enabled` listája.
 * - `riskManager`         — opcionális Phase 37 Track 1 `RiskManager`.
 *                          Ha be van állítva, a Kelly + drawdown scaler
 *                          által javasolt mérettel írja felül a
 *                          `sizingFn` kimenetét.
 * - `portfolioManager`    — opcionális `PortfolioManager` (Phase 37
 *                            Track 4). Ha megadva, a sizing a
 *                            portfolió-büdzsé CAP-jét is figyelembe
 *                            veszi, és a `recordFill` a korreláció-
 *                            mátrixot is frissíti.
 * - `logger`              — opcionális structured logger.
 */
export interface StrategyRunnerOptions {
  readonly instances: ReadonlyMap<StrategyName, BotStrategyInstance>;
  readonly orderManager: OrderManager;
  readonly positionManager: PositionManager;
  readonly sizingFn: SizingFn;
  readonly enabledSymbols: readonly string[];
  /** Global default, overridden per strategy by `strategyPolicies`. */
  readonly riskPerTrade?: number;
  /** Global leverage cap/selected default from `[risk].max_leverage`. */
  readonly maxLeverage?: number;
  /** Runtime-enforced strategy constraints.  A missing policy means global defaults only. */
  readonly strategyPolicies?: ReadonlyMap<StrategyName, StrategyRuntimePolicy>;
  readonly riskManager?: RiskManager;
  readonly portfolioManager?: PortfolioManager | null;
  /** Bot-owned emergency coordinator. Called only after the runner latches synchronously. */
  readonly onEmergency?: (reason: string) => void | Promise<void>;
  readonly logger?: Logger;
}

/** The runtime projection of the per-strategy TOML risk/symbol overrides. */
export interface StrategyRuntimePolicy {
  readonly symbols?: readonly string[];
  readonly riskPerTrade?: number;
  readonly maxPositions?: number;
  readonly leverage?: number;
}

/**
 * `SizingFn` — a position-sizing függvény. A `Bot` adja át, és
 * tipikusan a `risk_per_trade × equity / referencePrice` mintát
 * követi. A `referencePrice` azonnali piaci ár.
 */
export type SizingFn = (params: {
  readonly signal: StrategySignal;
  readonly symbol: ExchangeSymbol;
  readonly referencePrice: number;
  readonly equityUsd: number;
  readonly riskPerTrade: number;
}) => number;

/**
 * `StrategyRunnerStats` — a runner statisztikái. A Telemetry / a
 * `Bot.getState()` használja.
 */
export interface StrategyRunnerStats {
  readonly activeStrategies: readonly string[];
  readonly totalSignals: number;
  readonly lastSignalAt: number | null;
  readonly lastSignalStrategy: StrategyName | null;
  readonly ticksProcessed: number;
}

interface NativeProtectionInput {
  readonly strategy: StrategyName;
  readonly symbol: ExchangeSymbol;
  readonly side: "long" | "short";
  readonly quantity: number;
  readonly leverage: number;
  readonly signal: StrategySignal;
  readonly referencePrice: number;
}

interface NativeProtectionGroup {
  readonly key: string;
  readonly strategy: StrategyName;
  readonly symbol: ExchangeSymbol;
  readonly active: Set<ClientOrderId>;
  readonly cancelPending: Set<ClientOrderId>;
  desired: NativeProtectionInput | null;
  failSafe: NativeProtectionInput | null;
  installing: boolean;
}

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
  private readonly sizingFn: SizingFn;
  private readonly enabledSymbols: ReadonlySet<ExchangeSymbol>;
  private readonly strategyPolicies: ReadonlyMap<StrategyName, StrategyRuntimePolicy>;
  private readonly portfolioManager: PortfolioManager | null;
  private readonly onEmergency: ((reason: string) => void | Promise<void>) | null;
  private readonly logger: Logger;
  private totalSignals = 0;
  private lastSignalAt: number | null = null;
  private lastSignalStrategy: StrategyName | null = null;
  private ticksProcessed = 0;
  private readonly perStrategyLastSignal = new Map<StrategyName, number>();
  // Cached per-strategy latest close price (for sizing reference).
  private readonly latestPrice = new Map<ExchangeSymbol, number>();
  /** Shared live SignalBus for enabled StrategyPlugin instances. */
  private readonly pluginBus = new SignalBus({ mode: "live" });
  private readonly pluginBusUnsubscribers: UnsubscribeFn[] = [];
  private readonly fundingSourceClosers: (() => void)[] = [];
  /** Latest HMM regime sizing multiplier per enabled symbol; absent means 1.0. */
  private readonly regimeSizeModifiers = new Map<ExchangeSymbol, number>();
  private pluginClosePromise: Promise<void> | null = null;
  private paused = false;
  private pluginsDisposed = false;

  // Sizing constants
  private readonly riskPerTrade: number;
  private readonly maxLeverage: number;
  /** Per symbol/timeframe closed bars; never shares a close across timeframes. */
  private readonly bars = new Map<string, readonly Candle[]>();
  /** Same-symbol event work is chained so an awaiting placement cannot race a second bar. */
  private readonly symbolWork = new Map<ExchangeSymbol, Promise<void>>();
  /** Confirmed-entry protection, keyed by strategy+symbol.  Stop wins if one bar touches both levels. */
  private readonly protections = new Map<string, { readonly side: "long" | "short"; readonly stopLoss: number; readonly takeProfit: number }>();
  /** Each post-fill native protective order is independently reconciled. */
  private readonly nativeProtections = new Map<ClientOrderId, {
    readonly sibling: ClientOrderId | undefined; readonly strategy: StrategyName; readonly symbol: ExchangeSymbol;
    readonly side: "long" | "short"; readonly leverage: number; readonly kind: "stop_loss" | "take_profit";
    readonly signal: StrategySignal; readonly referencePrice: number;
  }>();
  /** Superseded legs stay attributable until private terminal evidence. */
  private readonly supersededNativeProtections = new Set<ClientOrderId>();
  /** Serialized owner state for each strategy/symbol protection pair. */
  private readonly nativeProtectionGroups = new Map<string, NativeProtectionGroup>();
  /** Entry idempotency: retained for an unfilled live acknowledgement. */
  private readonly pendingEntries = new Set<string>();
  private readonly pendingOrderMeta = new Map<ClientOrderId, {
    readonly strategy: StrategyName; readonly symbol: ExchangeSymbol; readonly side: "long" | "short";
    readonly leverage: number; readonly signal: StrategySignal; readonly strategyInstance: Strategy;
    positionOpenedNotified: boolean;
  }>();
  /** Trailing-stop close intents are retained until confirmed execution. */
  private readonly pendingRiskCloses = new Map<string, ClientOrderId | null>();
  private readonly unsubscribeOrderLifecycle: () => void;

  /**
   * `riskManager` — Phase 37 Track 1. Optional. If set, the runner
   * queries `riskManager.evaluateNewPositionSize(...)` BEFORE
   * calling `sizingFn`, and uses the returned fraction (after
   * dividing by `referencePrice` and multiplying by `equity`).
   * If unset, the legacy `sizingFn` path is used.
   */
  private riskManager: RiskManager | null = null;

  public constructor(opts: StrategyRunnerOptions) {
    this.instances = opts.instances;
    this.orderManager = opts.orderManager;
    this.positionManager = opts.positionManager;
    this.sizingFn = opts.sizingFn;
    this.enabledSymbols = new Set(
      opts.enabledSymbols.map((s) => s as Brand<string, "ExchangeSymbol"> as unknown as ExchangeSymbol),
    );
    this.strategyPolicies = opts.strategyPolicies ?? new Map();
    this.riskPerTrade = opts.riskPerTrade ?? 0.01;
    this.maxLeverage = opts.maxLeverage ?? 1;
    if (!Number.isFinite(this.maxLeverage) || this.maxLeverage <= 0) {
      throw new Error(`[strategy-runner] maxLeverage must be positive finite, got ${String(this.maxLeverage)}`);
    }
    for (const [strategy, policy] of this.strategyPolicies) {
      if (policy.leverage !== undefined && (!Number.isFinite(policy.leverage) || policy.leverage <= 0)) {
        throw new Error(`[strategy-runner] ${strategy} leverage must be positive finite, got ${String(policy.leverage)}`);
      }
    }
    this.riskManager = opts.riskManager ?? null;
    this.portfolioManager = opts.portfolioManager ?? null;
    this.onEmergency = opts.onEmergency ?? null;
    this.logger = opts.logger ?? createLogger("info");
    this.unsubscribeOrderLifecycle = this.orderManager.onLifecycle((event) => {
      void this.onOrderLifecycle(event);
    });
    this.startPlugins();
    this.startFundingSources();
    this.riskManager?.onTrailingStopClose((event) => {
      void this.requestTrailingStopClose(event.positionId, event.closePrice, event.reason);
    });
  }

  /**
   * `setRiskManager` — Phase 37 Track 1 wiring. Attach / detach the
   * `RiskManager` that recomputes position size before every order.
   * Detach with `null` to revert to the legacy `sizingFn` path.
   */
  public setRiskManager(rm: RiskManager | null): void {
    this.riskManager = rm;
  }

  /** Stop accepting feed work and, independently, block order emission. */
  public pause(): void {
    this.paused = true;
  }

  /** Resume normal event handling after an operator-initiated pause. */
  public resume(): void {
    if (!this.pluginsDisposed) this.paused = false;
  }

  public isPaused(): boolean {
    return this.paused;
  }

  /** Release enabled plugin subscriptions exactly once during Bot cleanup. */
  public dispose(): void {
    if (this.pluginsDisposed) return;
    this.pluginsDisposed = true;
    this.paused = true;
    this.unsubscribeOrderLifecycle();
    for (const instance of this.instances.values()) {
      if (instance.kind !== "plugin") continue;
      try {
        instance.instance.dispose?.();
      } catch (err) {
        this.logger.warn("[strategy-runner] plugin dispose threw", {
          plugin: instance.name,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    for (const unsubscribe of this.pluginBusUnsubscribers.splice(0)) unsubscribe();
    for (const close of this.fundingSourceClosers.splice(0)) {
      try {
        close();
      } catch (err) {
        this.logger.warn("[strategy-runner] funding subscription close threw", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    this.pluginBus.clear();
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
      const prior = this.symbolWork.get(event.payload.symbol) ?? Promise.resolve();
      const work = prior.catch(() => undefined).then(async () => this.onFeedEventSerial(event));
      this.symbolWork.set(event.payload.symbol, work);
      try {
        await work;
      } finally {
        if (this.symbolWork.get(event.payload.symbol) === work) this.symbolWork.delete(event.payload.symbol);
      }
      return;
    }
    await this.onFeedEventSerial(event);
  }

  /** The serialized implementation.  Public callers always go through the per-symbol gate above. */
  private async onFeedEventSerial(event: FeedEvent): Promise<void> {
    if (this.paused || this.pluginsDisposed) {
      this.logger.debug("[strategy-runner] feed event skipped while paused", { kind: event.kind });
      return;
    }
    this.ticksProcessed++;
    if (event.kind === "ticker") {
      const t = event.payload;
      if (this.enabledSymbols.has(t.symbol)) {
        this.latestPrice.set(t.symbol, t.last);
        this.positionManager.updateMarketPrice(t.symbol, t.last);
        await this.reconcilePendingOrders(t.symbol);
        await this.reconcileRiskCloses(t.symbol);
      }
      return;
    }
    if (event.kind === "ohlcv") {
      const { symbol, timeframe, candle } = event.payload;
      if (!this.enabledSymbols.has(symbol)) {
        return;
      }
      this.latestPrice.set(symbol, candle[4]); // close price
      this.positionManager.updateMarketPrice(symbol, candle[4]);
      this.recordClosedBar(symbol, timeframe, this.toCandle(candle));
      await this.processPlugins(symbol, timeframe, {
        timestamp: candle[0],
        open: candle[1],
        high: candle[2],
        low: candle[3],
        close: candle[4],
        volume: candle[5],
      });
      // A risk plugin can synchronously latch Pause while the SignalBus drains.
      // Never continue into the strategy loop on the breach candle.
      if (this.isOrderEmissionBlocked()) return;
      for (const instance of this.instances.values()) {
        if (instance.kind !== "strategy") continue;
        const strategyName = instance.name;
        const strategy = instance.instance;
        const policy = this.strategyPolicies.get(strategyName);
        if (policy?.symbols !== undefined && !policy.symbols.includes(String(symbol))) continue;
        // A strategy is only allowed to make a decision on its configured LTF.
        // HTF/MTF bars update its separate state above, but cannot produce entries.
        const decisionTimeframe = strategy.timeframes[strategy.timeframes.length - 1];
        if (timeframe !== decisionTimeframe) continue;
        const ctx = this.makeContext(symbol, timeframe, candle, strategy.timeframes);
        try {
          // Phase 67: position-check BEFORE the new-signal path.
          // The `Strategy.onCandle` contract (packages/core/src/types.ts:185)
          // states it is called only when NO open position exists for the
          // (strategy, symbol). The runner MUST honor this contract —
          // otherwise the strategy emits a fresh signal every LTF candle
          // and the runner opens (or averages into) positions until the
          // `max_positions` cap triggers the kill-switch in 2-3 minutes
          // (the "donchian_pivot_composition never-closes" bug).
          //
          // We ALWAYS call `onCandle` (below) to keep the strategy's
          // internal indicator state fresh (Donchian channel, Pivot grid
          // levels, etc.). The position-check only gates the
          // new-signal → placeOrder path.
          const existingPosition = this.findOpenPosition(strategyName, symbol);

          if (existingPosition !== null) {
            if (await this.enforceProtection(strategyName, strategy, existingPosition, candle)) {
              continue;
            }
            strategy.onCandleObserved?.(ctx);
            // Position is open. Two paths:
            //   1. The strategy may implement `onOpenPositionUpdate` for
            //      per-bar position management (trailing-stop override,
            //      time-based exit, etc.). If it returns `forceExit: true`,
            //      we close the position at the candle close.
            //   2. Otherwise, skip the new-signal path entirely. The
            //      position can still be closed by:
            //        - SL/TP fill (OrderManager-side checks)
            //        - Trailing stop (RiskManager — Phase 37 Track 1)
            //        - Portfolio stop (PortfolioManager)
            // The position is NOT closed by the runner's own logic.
            if (strategy.onOpenPositionUpdate !== undefined) {
              const update = strategy.onOpenPositionUpdate({
                openPosition: {
                  side: existingPosition.side === "long" ? "buy" : "sell",
                  entryTime: existingPosition.openedAt,
                  entryPrice: existingPosition.entryPrice,
                  quantity: existingPosition.quantity,
                  // Phase 67: `stopLoss` / `takeProfit` / `holdingBars`
                  // are NOT tracked by `PositionManager` (they live in
                  // the strategy's own state or the original signal).
                  // Pass 0 — strategies that care about these should
                  // implement their own tracking. The `RiskManager`
                  // trailing-stop uses its own internal state, so this
                  // is a no-op for the currently wired strategies.
                  stopLoss: 0,
                  takeProfit: 0,
                  holdingBars: 0,
                },
                candle: this.toCandle(candle),
                candleIndex: this.ticksProcessed,
                mtfState: ctx.mtfState,
                pricePrecision: 2,
              });
              if (update !== null && update.forceExit === true) {
                const exitPrice = update.exitPrice ?? candle[4];
                if (this.portfolioManager !== null) {
                  const closed = await this.portfolioManager.requestPositionClose(existingPosition, update.reason ?? "force_exit");
                  if (closed) strategy.onPositionClosed?.(update.reason ?? "force_exit");
                  continue;
                }
                await this.requestTrailingStopClose(existingPosition.id, exitPrice, update.reason ?? "force_exit");
                continue;
              }
            }
            this.logger.debug("[strategy-runner] position open — skipping new signal", {
              strategy: strategyName,
              symbol,
              existingSide: existingPosition.side,
            });
            continue;
          }

          // No open position — call `onCandle` and act on the signal.
          const signal = strategy.onCandle(ctx);
          if (signal !== null) {
            await this.handleSignal(
              strategyName,
              strategy,
              signal,
                symbol,
                candle[4],
                policy,
            );
          }
        } catch (err) {
          this.logger.error("[strategy-runner] onCandle threw", {
            strategy: instance.name,
            symbol,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
      return;
    }
    // orderbook / trade — no-op in this phase.
  }

  /**
   * `getStats` — a runner statisztikái.
   */
  public getStats(): StrategyRunnerStats {
    return {
      activeStrategies: [...this.instances.keys()],
      totalSignals: this.totalSignals,
      lastSignalAt: this.lastSignalAt,
      lastSignalStrategy: this.lastSignalStrategy,
      ticksProcessed: this.ticksProcessed,
    };
  }

  /**
   * `getActiveStrategyNames` — az aktív stratégiák nevei.
   */
  public getActiveStrategyNames(): readonly StrategyName[] {
    return [...this.instances.keys()];
  }

  // --------------------------------------------------------------------------
  // Internals
  // --------------------------------------------------------------------------

  /** Wire every enabled plugin to the shared live SignalBus at startup. */
  private startPlugins(): void {
    const started: Extract<BotStrategyInstance, { readonly kind: "plugin" }>[] = [];
    try {
      // Risk plugins are defensive order producers.  A breach goes through
      // PortfolioManager's normal cancel/reduce-only lifecycle; informational
      // regime updates remain telemetry-only.  A source suffix after ':' is
      // treated as symbol attribution and rejected unless the bot enabled it.
      this.pluginBusUnsubscribers.push(this.pluginBus.subscribe("risk", (signal) => {
        if (signal.kind !== "risk" || this.isOrderEmissionBlocked()) return;
        if (signal.source.startsWith("regime-detector-v1:")) {
          const attributed = signal.source.slice(signal.source.lastIndexOf(":") + 1) as ExchangeSymbol;
          const modifier = signal.sizeModifier;
          if (
            !this.enabledSymbols.has(attributed) || modifier === undefined ||
            !Number.isFinite(modifier) || modifier < 0 || modifier > 1
          ) {
            this.paused = true;
            throw new Error(`[strategy-runner] invalid regime sizing signal source=${signal.source} modifier=${String(modifier)}`);
          }
          this.regimeSizeModifiers.set(attributed, modifier);
          return;
        }
        if (signal.breach !== true) return;
        const attributed = signal.source.includes(":") ? signal.source.slice(signal.source.lastIndexOf(":") + 1) : undefined;
        if (attributed !== undefined && !this.enabledSymbols.has(attributed as ExchangeSymbol)) {
          this.logger.warn("[strategy-runner] plugin risk signal blocked for disabled symbol", { source: signal.source, symbol: attributed });
          return;
        }
        if ((this.portfolioManager === null && this.onEmergency === null) || this.pluginClosePromise !== null) return;
        // SignalBus dispatch is synchronous. Latch before starting any async
        // cancellation/close work so this same candle cannot emit an entry.
        this.paused = true;
        const emergency = this.onEmergency !== null
          ? Promise.resolve(this.onEmergency(`plugin-risk: ${signal.source}`))
          : this.portfolioManager!.executeCloseAll();
        this.pluginClosePromise = emergency
          .then(() => undefined)
          .finally(() => { this.pluginClosePromise = null; });
      }));
      for (const instance of this.instances.values()) {
        if (instance.kind !== "plugin") continue;
        instance.instance.subscribe(this.pluginBus);
        started.push(instance);
        this.logger.info("[strategy-runner] plugin subscribed", {
          plugin: instance.name,
        });
      }
    } catch (err) {
      // Do not leave a half-wired plugin graph alive if a plugin rejects its
      // startup lifecycle.  Startup then fails loudly instead of silently
      // running an enabled safety plugin as inert.
      for (const instance of started) {
        try {
          instance.instance.dispose?.();
        } catch {
          // best-effort rollback; retain the original startup error
        }
      }
      throw err;
    }
  }

  /** Own live dYdX funding subscriptions for the same lifetime as the runner. */
  private startFundingSources(): void {
    for (const instance of this.instances.values()) {
      if (instance.kind !== "strategy" || instance.name !== "dydx_cex_carry") continue;
      const strategy = instance.instance as Strategy & {
        readonly config: {
          readonly market: CarryMarket;
          readonly fundingSource: DydxFundingSource;
        };
        recordFundingTick(dydx: FundingSnapshot, cex: FundingSnapshot, nowMs: number): number;
      };
      const subscription = strategy.config.fundingSource.subscribe(
        strategy.config.market,
        ({ dydx, cex }) => {
          const observedAt = Math.max(dydx.fundingTime, cex.fundingTime);
          const nowMs = Number.isFinite(observedAt) && observedAt >= 0 ? observedAt : Date.now();
          try {
            strategy.recordFundingTick(dydx, cex, nowMs);
          } catch (err) {
            this.logger.error("[strategy-runner] dYdX funding tick rejected", {
              strategy: instance.name,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        },
      );
      this.fundingSourceClosers.push(() => {
        subscription.close();
      });
      this.logger.info("[strategy-runner] dYdX funding source subscribed", {
        market: strategy.config.market,
      });
    }
  }

  /** Convert a trailing-stop decision into a deduplicated reduce-only intent. */
  private async requestTrailingStopClose(positionId: string, closePrice: number, reason: string): Promise<void> {
    if (this.isOrderEmissionBlocked() || this.pendingRiskCloses.has(positionId)) return;
    const position = this.positionManager.getPositions().find((item) => item.id === positionId);
    if (position === undefined) return;
    this.pendingRiskCloses.set(positionId, null);
    if (this.portfolioManager !== null) {
      try {
        const closed = await this.portfolioManager.requestPositionClose(position, reason);
        if (closed) this.riskManager?.disarmTrailingStop(positionId);
      } finally {
        this.pendingRiskCloses.delete(positionId);
      }
      return;
    }
    const closingSide = position.side === "long" ? "sell" : "buy";
    try {
      const order = await this.orderManager.placeOrder({
        signal: { side: closingSide, confidence: 1, reason, stopLoss: 0, takeProfit: 0 },
        symbol: position.symbol, amount: position.quantity, referencePrice: closePrice, type: "market",
        reduceOnly: true, strategy: position.strategy, leverage: position.leverage,
        clientOrderIdHint: `${position.strategy}-trailing-stop`,
      });
      this.orderManager.recordFill(order.clientOrderId, order);
      if (order.filled > 0) {
        this.positionManager.recordFill({
          strategy: position.strategy, symbol: position.symbol,
          side: closingSide === "sell" ? "short" : "long", quantity: Math.min(order.filled, position.quantity),
          price: order.average ?? order.price ?? closePrice, leverage: position.leverage,
          timestamp: order.updateTimestamp ?? Date.now(),
        });
      }
      const remaining = this.positionManager.getPositions().find((item) => item.id === positionId);
      if (remaining === undefined) {
        this.riskManager?.disarmTrailingStop(positionId);
        this.pendingRiskCloses.delete(positionId);
        this.notifyStrategyClosed(position.strategy, reason);
      } else if (order.status === "open") {
        this.pendingRiskCloses.set(positionId, order.clientOrderId);
      } else {
        // Terminal reject/cancel/partial completion is retryable on the next
        // trailing decision; never erase the remaining local position.
        this.pendingRiskCloses.delete(positionId);
      }
    } catch (err) {
      this.pendingRiskCloses.delete(positionId);
      this.logger.error("[strategy-runner] trailing-stop close failed; retry enabled", {
        positionId, error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /** REST recovery for pending trailing closes; private updates call this too. */
  private async reconcileRiskCloses(symbol: ExchangeSymbol): Promise<void> {
    for (const [positionId, clientOrderId] of [...this.pendingRiskCloses]) {
      if (clientOrderId === null) continue;
      const position = this.positionManager.getPositions().find((item) => item.id === positionId);
      if (position === undefined) {
        this.riskManager?.disarmTrailingStop(positionId);
        this.pendingRiskCloses.delete(positionId);
        continue;
      }
      if (position.symbol !== symbol) continue;
      try {
        const { order, deltaFilled } = await this.orderManager.reconcileOrder(clientOrderId, symbol);
        if (deltaFilled > 0) {
          const closingSide = position.side === "long" ? "sell" : "buy";
          this.positionManager.recordFill({
            strategy: position.strategy, symbol, side: closingSide === "sell" ? "short" : "long",
            quantity: Math.min(deltaFilled, position.quantity), price: order.average ?? order.price ?? this.latestPrice.get(symbol) ?? position.currentPrice,
            leverage: position.leverage, timestamp: order.updateTimestamp ?? Date.now(),
          });
        }
        const remaining = this.positionManager.getPositions().find((item) => item.id === positionId);
        if (remaining === undefined) {
          this.riskManager?.disarmTrailingStop(positionId);
          this.pendingRiskCloses.delete(positionId);
          this.notifyStrategyClosed(position.strategy, "risk_close");
        } else if (order.status !== "open") {
          this.pendingRiskCloses.delete(positionId);
        }
      } catch (err) {
        this.logger.warn("[strategy-runner] trailing close reconciliation failed", { positionId, error: err instanceof Error ? err.message : String(err) });
      }
    }
  }

  /** Drive plugin per-bar work and dispatch its queued live-bus signals. */
  private async processPlugins(symbol: ExchangeSymbol, timeframe: string, bar: Bar): Promise<void> {
    for (const instance of this.instances.values()) {
      if (instance.kind !== "plugin") continue;
      try {
        if (instance.name === "regime_detector" && timeframe === "1d") {
          const regime = instance.instance as unknown as {
            recordClose(symbol: string, close: number, timestampMs: number): void;
          };
          regime.recordClose(String(symbol), bar.close, bar.timestamp);
        }
        // Plugins own their mutable state; current built-ins expose it as a
        // public `state` property.  The interface intentionally accepts
        // unknown, so plugins without one receive undefined safely.
        const pluginState = (instance.instance as unknown as { state?: unknown }).state;
        await instance.instance.onBar(bar, pluginState);
      } catch (err) {
        this.logger.error("[strategy-runner] plugin onBar threw", {
          plugin: instance.name,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    this.pluginBus.drain();
  }

  /** Kept as a boundary method so future awaited sizing/risk steps cannot bypass Pause. */
  private isOrderEmissionBlocked(): boolean {
    return this.paused || this.pluginsDisposed;
  }

  /**
   * `findOpenPosition` — az adott (strategy, symbol) párhoz tartozó
   * nyitott pozíció keresése (long VAGY short). A Phase 67
   * position-skip fix használja: ha van nyitott pozíció, a runner
   * NEM nyit újat (a `Strategy.onCandle` kontrakt értelmében).
   *
   * Phase 67: a `PositionManager` csak a (strategy, symbol, side)
   * azonosítójú pozíciókat tárolja (`positionId` formátum:
   * `<strategy>:<symbol>:<side>` — lásd `position-manager.ts:668`).
   * Egy adott (strategy, symbol) kombóra tehát max 1 long + 1 short
   * lehet, de a gyakorlatban a legtöbb stratégia csak 1 oldalt használ.
   * A `getPositions()` segítségével iterálunk, mert nincs dedikált
   * `getAllPositionsFor(strategy, symbol)` API.
   *
   * @returns A `PositionSnapshot` (a `getPositions()` által készített
   *          másolat) vagy `null` ha nincs nyitott pozíció.
   */
  private findOpenPosition(
    strategyName: StrategyName,
    symbol: ExchangeSymbol,
  ): PositionSnapshot | null {
    for (const p of this.positionManager.getPositions()) {
      if (p.strategy === strategyName && p.symbol === symbol) {
        return p;
      }
    }
    return null;
  }

  /**
   * `handleSignal` — egy `StrategySignal` feldolgozása: sizing → intent → place.
   *
   * Phase 37 Track 4 — a sizing a `PortfolioManager` büdzsé-CAP-jéhez
   * igazodik:
   *   1) Ha a circuit breaker tüzel (`portfolioManager.isTripped()`),
   *      a signal kihagyásra kerül — semmilyen új order nem indul.
   *   2) A büdzsé (USD) a `getBudgetFor(strategyName)` — ha 0 vagy
   *      kisebb mint a kért notional, a méret a büdzsé / ár arányára
   *      skálázódik (vagy skip, ha a büdzsé 0).
   */
  private async handleSignal(
    strategyName: StrategyName,
    strategy: Strategy,
    signal: StrategySignal,
    symbol: ExchangeSymbol,
    referencePrice: number,
    policy: StrategyRuntimePolicy | undefined,
  ): Promise<void> {
    const effectiveLeverage = Math.min(this.maxLeverage, policy?.leverage ?? this.maxLeverage);
    const entryKey = this.protectionKey(strategyName, symbol);
    if (this.pendingEntries.has(entryKey)) {
      this.logger.warn("[strategy-runner] entry suppressed — order already pending", { strategy: strategyName, symbol });
      return;
    }
    if (this.isOrderEmissionBlocked()) {
      this.logger.info("[strategy-runner] signal skipped — engine is paused", {
        strategy: strategyName,
        symbol,
      });
      return;
    }
    this.totalSignals++;
    this.lastSignalAt = Date.now();
    this.lastSignalStrategy = strategyName;
    this.perStrategyLastSignal.set(strategyName, this.lastSignalAt);

    // Phase 37 Track 4 — circuit breaker check. Ha a portfolio-stop
    // tüzelt, a StrategyRunner NEM küld új order-t (a bot leállásáig).
    if (this.portfolioManager?.isTripped() === true) {
      this.logger.warn("[strategy-runner] portfolio-stop tripped — skipping signal", {
        strategy: strategyName,
        symbol,
      });
      return;
    }
    if (policy?.maxPositions !== undefined) {
      const owned = this.positionManager.getPositions().filter((position) => position.strategy === strategyName).length;
      if (owned >= policy.maxPositions) {
        this.logger.warn("[strategy-runner] per-strategy max_positions reached — skipping signal", {
          strategy: strategyName, symbol, maxPositions: policy.maxPositions,
        });
        return;
      }
    }

    // Sizing — Phase 37 Track 1 (RiskManager) + Track 4 (Portfolio budget cap)
    const equity = this.positionManager.getEquity();
    let amount: number;
    if (this.riskManager !== null) {
      // Phase 37 Track 1 — query the RiskManager for the final
      // size fraction. If it returns 0, the drawdown scaler or
      // Kelly says "do not open" — respect that.
      const baseFraction = policy?.riskPerTrade ?? this.riskPerTrade;
      const fraction = this.riskManager.evaluateNewPositionSize({
        equityUsd: equity,
        baseSizeFraction: baseFraction,
      });
      amount = fraction > 0 && referencePrice > 0
        ? (fraction * equity) / referencePrice
        : 0;
    } else {
      amount = this.sizingFn({
        signal,
        symbol,
        referencePrice,
        equityUsd: equity,
        riskPerTrade: policy?.riskPerTrade ?? this.riskPerTrade,
      });
    }
    if (amount <= 0) {
      this.logger.debug("[strategy-runner] sizing returned 0 — skipping order", {
        strategy: strategyName,
        symbol,
      });
      return;
    }

    amount *= this.regimeSizeModifiers.get(symbol) ?? 1;
    if (amount <= 0) {
      this.logger.info("[strategy-runner] regime sizing modifier blocked entry", {
        strategy: strategyName,
        symbol,
      });
      return;
    }

    // Phase 37 Track 4 — büdzsé-CAP alkalmazása. A kért notional
    // (amount * referencePrice) nem haladhatja meg a
    // `portfolioManager.getBudgetFor(strategyName)`-et.
    amount = this.applyBudgetCap(
      strategyName,
      amount,
      referencePrice,
    );
    if (amount <= 0) {
      this.logger.debug("[strategy-runner] budget cap shrunk amount to 0 — skipping", {
        strategy: strategyName,
        symbol,
        amount,
        referencePrice,
      });
      return;
    }

    // Build OrderIntent
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
    // This second gate closes the pause-in-flight window: the event may have
    // entered before Pause, but it must not reach the side-effect boundary.
    if (this.isOrderEmissionBlocked()) {
      this.logger.info("[strategy-runner] order emission skipped — engine is paused", {
        strategy: strategyName,
        symbol,
      });
      return;
    }
    try {
      this.pendingEntries.add(entryKey);
      const order = await this.orderManager.placeOrder(intent);
      // A create-order response is an acknowledgement, not a fill.  Book
      // only exchange-confirmed cumulative filled quantity at its actual
      // average.  An open/zero-filled acknowledgement remains in-flight.
      if (order.filled > 0) {
        this.positionManager.recordFill({
          strategy: strategyName,
          symbol,
          side: signal.side === "buy" ? "long" : "short",
          quantity: order.filled,
          price: order.average ?? order.price ?? referencePrice,
          leverage: effectiveLeverage,
          timestamp: order.updateTimestamp ?? Date.now(),
        });
        await this.installProtections({
          strategy: strategyName, symbol, side: signal.side === "buy" ? "long" : "short",
          quantity: order.filled, leverage: effectiveLeverage, signal,
          referencePrice: order.average ?? order.price ?? referencePrice,
        });
      }
      if (order.status !== "open") this.pendingEntries.delete(entryKey);
      if (order.status === "open") {
        this.pendingOrderMeta.set(order.clientOrderId, {
          strategy: strategyName, symbol, side: signal.side === "buy" ? "long" : "short",
          leverage: effectiveLeverage, signal, strategyInstance: strategy,
          positionOpenedNotified: order.filled > 0,
        });
      }
      this.orderManager.recordFill(order.clientOrderId, order);
      // Phase 37 Track 4 — a portfolió-menedzser is megkapja a fill-t
      // (a korreláció-stream frissítéséhez). A return% itt 0, mert
      // ez egy NYITÓ fill (nincs realizált P&L); a ZÁRÓ fill a
      // position-manager-en keresztül a position teljes zárásakor
      // kerül rögzítésre — a StrategyRunner a `Bot.run` heartbeat-
      // jében kérdezi le a `closedTrades` listát és hívja a
      // `portfolioManager.recordFill`-t a ZÁRÁS pillanatában.
      if (this.portfolioManager !== null) {
        this.portfolioManager.recordFill({ strategyId: strategyName, returnPct: 0 });
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
    } catch (err) {
      this.pendingEntries.delete(entryKey);
      this.logger.error("[strategy-runner] order placement failed", {
        strategy: strategyName,
        symbol,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /** Poll only pending orders for this symbol; one bounded fetch per order per tick. */
  private async reconcilePendingOrders(symbol: ExchangeSymbol): Promise<void> {
    await this.reconcileNativeProtections(symbol);
    for (const [clientOrderId, meta] of [...this.pendingOrderMeta]) {
      if (meta.symbol !== symbol) continue;
      try {
        const { order, deltaFilled } = await this.orderManager.reconcileOrder(clientOrderId, symbol);
        if (deltaFilled > 0) {
          this.positionManager.recordFill({
            strategy: meta.strategy, symbol, side: meta.side, quantity: deltaFilled,
            price: order.average ?? order.price ?? this.latestPrice.get(symbol) ?? 0,
            leverage: meta.leverage, timestamp: order.updateTimestamp ?? Date.now(),
          });
          await this.installProtections({
            strategy: meta.strategy, symbol, side: meta.side, quantity: deltaFilled, leverage: meta.leverage,
            signal: meta.signal, referencePrice: order.average ?? order.price ?? this.latestPrice.get(symbol) ?? 0,
          });
          if (!meta.positionOpenedNotified) {
            meta.strategyInstance.onPositionOpened?.({
              side: meta.signal.side, entryTime: order.updateTimestamp ?? Date.now(),
              entryPrice: order.average ?? order.price ?? 0, quantity: order.filled,
              stopLoss: meta.signal.stopLoss, takeProfit: meta.signal.takeProfit, holdingBars: 0,
            });
            meta.positionOpenedNotified = true;
          }
        }
        if (order.status !== "open") {
          this.pendingOrderMeta.delete(clientOrderId);
          this.pendingEntries.delete(this.protectionKey(meta.strategy, symbol));
        }
      } catch (err) {
        this.logger.warn("[strategy-runner] pending order reconciliation failed; retaining safety gate", {
          clientOrderId, symbol, error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  /** Private order/execution progress uses the same per-symbol serializer as market data. */
  private async onOrderLifecycle(event: OrderLifecycleEvent): Promise<void> {
    const symbol = event.order.symbol;
    const previous = this.symbolWork.get(symbol) ?? Promise.resolve();
    const work = previous.catch(() => undefined).then(async () => this.applyOrderLifecycle(event));
    this.symbolWork.set(symbol, work);
    try { await work; } finally { if (this.symbolWork.get(symbol) === work) this.symbolWork.delete(symbol); }
  }

  private async applyOrderLifecycle(event: OrderLifecycleEvent): Promise<void> {
    const { order, deltaFilled } = event;
    const symbol = order.symbol;
    const pending = this.pendingOrderMeta.get(order.clientOrderId);
    if (pending !== undefined) {
      if (deltaFilled > 0) {
        this.positionManager.recordFill({
          strategy: pending.strategy, symbol, side: pending.side, quantity: deltaFilled,
          price: event.kind === "execution" ? event.execution.price : order.average ?? order.price ?? this.latestPrice.get(symbol) ?? 0,
          leverage: pending.leverage, timestamp: order.updateTimestamp ?? Date.now(),
        });
        await this.installProtections({
          strategy: pending.strategy, symbol, side: pending.side, quantity: deltaFilled,
          leverage: pending.leverage, signal: pending.signal,
          referencePrice: order.average ?? order.price ?? this.latestPrice.get(symbol) ?? 0,
        });
        if (!pending.positionOpenedNotified) {
          pending.strategyInstance.onPositionOpened?.({
            side: pending.signal.side, entryTime: order.updateTimestamp ?? Date.now(),
            entryPrice: order.average ?? order.price ?? 0, quantity: order.filled,
            stopLoss: pending.signal.stopLoss, takeProfit: pending.signal.takeProfit, holdingBars: 0,
          });
          pending.positionOpenedNotified = true;
        }
      }
      if (order.status !== "open") {
        this.pendingOrderMeta.delete(order.clientOrderId);
        this.pendingEntries.delete(this.protectionKey(pending.strategy, symbol));
      }
      return;
    }
    const protection = this.nativeProtections.get(order.clientOrderId);
    if (protection !== undefined) {
      const group = this.nativeProtectionGroups.get(this.protectionKey(protection.strategy, symbol));
      if (deltaFilled > 0) {
        const position = this.findOpenPosition(protection.strategy, symbol);
        if (position !== null) {
          const closingSide = protection.side === "long" ? "sell" : "buy";
          this.positionManager.recordFill({
            strategy: protection.strategy, symbol, side: closingSide === "sell" ? "short" : "long",
            quantity: Math.min(deltaFilled, position.quantity),
            price: event.kind === "execution" ? event.execution.price : order.average ?? order.price ?? this.latestPrice.get(symbol) ?? position.currentPrice,
            leverage: protection.leverage, timestamp: order.updateTimestamp ?? Date.now(),
          });
        }
        const remaining = this.findOpenPosition(protection.strategy, symbol);
        if (remaining === null) this.notifyStrategyClosed(protection.strategy, protection.kind);
        if (group !== undefined) {
          group.desired = remaining === null ? null : {
            strategy: protection.strategy, symbol, side: protection.side, quantity: remaining.quantity,
            leverage: protection.leverage, signal: protection.signal, referencePrice: remaining.currentPrice,
          };
        }
      }
      if (group !== undefined && order.status !== "open") this.retireProtectionLeg(group, order.clientOrderId);
      if (group !== undefined && deltaFilled > 0) await this.requestProtectionCancellation(group);
      if (group !== undefined) await this.settleProtectionGroup(group);
      return;
    }
    for (const [positionId, clientOrderId] of this.pendingRiskCloses) {
      if (clientOrderId !== order.clientOrderId) continue;
      const position = this.positionManager.getPositions().find((item) => item.id === positionId);
      if (position !== undefined && deltaFilled > 0) {
        const closingSide = position.side === "long" ? "sell" : "buy";
        this.positionManager.recordFill({
          strategy: position.strategy, symbol, side: closingSide === "sell" ? "short" : "long",
          quantity: Math.min(deltaFilled, position.quantity),
          price: event.kind === "execution" ? event.execution.price : order.average ?? order.price ?? position.currentPrice,
          leverage: position.leverage, timestamp: order.updateTimestamp ?? Date.now(),
        });
      }
      const remaining = this.positionManager.getPositions().find((item) => item.id === positionId);
      if (remaining === undefined) {
        this.riskManager?.disarmTrailingStop(positionId);
        this.pendingRiskCloses.delete(positionId);
        if (position !== undefined) this.notifyStrategyClosed(position.strategy, "risk_close");
      } else if (order.status !== "open") {
        this.pendingRiskCloses.delete(positionId);
      }
      return;
    }
  }

  private barKey(symbol: ExchangeSymbol, timeframe: string): string {
    return `${String(symbol)}\u0000${timeframe}`;
  }

  private notifyStrategyClosed(strategyName: string, reason: string): void {
    const instance = this.instances.get(strategyName as StrategyName);
    if (instance?.kind === "strategy") instance.instance.onPositionClosed?.(reason);
  }

  private protectionKey(strategy: string, symbol: ExchangeSymbol): string {
    return `${strategy}\u0000${String(symbol)}`;
  }

  /**
   * Creates separate venue-side TP and SL only after a real entry fill.
   * Paper preserves deterministic candle simulation; live uses V5 conditionals.
   * A failure after exposure triggers an immediate reduce-only fail-safe close.
   */
  private async installProtections(input: NativeProtectionInput): Promise<void> {
    if (input.quantity <= 0 || (input.signal.stopLoss <= 0 && input.signal.takeProfit <= 0)) return;
    if (this.orderManager.isPaperMode()) {
      this.protections.set(this.protectionKey(input.strategy, input.symbol), {
        side: input.side, stopLoss: input.signal.stopLoss, takeProfit: input.signal.takeProfit,
      });
      return;
    }
    const current = this.findOpenPosition(input.strategy, input.symbol);
    const desired = current === null ? null : { ...input, quantity: current.quantity, referencePrice: current.currentPrice || input.referencePrice };
    if (desired === null || desired.quantity <= 0) return;
    const key = this.protectionKey(input.strategy, input.symbol);
    const existing = this.nativeProtectionGroups.get(key);
    if (existing !== undefined) {
      existing.desired = desired;
      if (existing.active.size > 0 || existing.cancelPending.size > 0) {
        await this.requestProtectionCancellation(existing);
        return;
      }
      await this.settleProtectionGroup(existing);
      return;
    }
    const group: NativeProtectionGroup = {
      key, strategy: input.strategy, symbol: input.symbol,
      active: new Set(), cancelPending: new Set(), desired, failSafe: null, installing: false,
    };
    this.nativeProtectionGroups.set(key, group);
    await this.settleProtectionGroup(group);
  }

  /** Install one pair only when every previous leg has private terminal proof. */
  private async createProtectionPair(group: NativeProtectionGroup, input: NativeProtectionInput): Promise<void> {
    const current = this.findOpenPosition(input.strategy, input.symbol);
    const protectedQuantity = current?.quantity ?? 0;
    if (protectedQuantity <= 0 || (input.signal.stopLoss <= 0 && input.signal.takeProfit <= 0)) return;
    const closingSide = input.side === "long" ? "sell" : "buy";
    const created: { readonly id: ClientOrderId; readonly kind: "stop_loss" | "take_profit" }[] = [];
    try {
      for (const [kind, triggerPrice] of [["stop_loss", input.signal.stopLoss], ["take_profit", input.signal.takeProfit]] as const) {
        if (triggerPrice <= 0) continue;
        const order = await this.orderManager.placeOrder({
          signal: { side: closingSide, confidence: 1, reason: `native_${kind}`, stopLoss: 0, takeProfit: 0 },
          symbol: input.symbol, amount: protectedQuantity, referencePrice: input.referencePrice, type: "market",
          reduceOnly: true, strategy: input.strategy, protectiveKind: kind, triggerPrice,
          leverage: input.leverage,
          clientOrderIdHint: `${input.strategy}-${kind}`,
        });
        created.push({ id: order.clientOrderId, kind });
      }
      for (const item of created) {
        group.active.add(item.id);
        this.nativeProtections.set(item.id, {
          sibling: created.find((candidate) => candidate.id !== item.id)?.id,
          strategy: input.strategy, symbol: input.symbol, side: input.side, leverage: input.leverage, kind: item.kind,
          signal: input.signal, referencePrice: input.referencePrice,
        });
      }
    } catch (err) {
      for (const item of created) {
        group.active.add(item.id);
        this.nativeProtections.set(item.id, {
          sibling: created.find((candidate) => candidate.id !== item.id)?.id,
          strategy: input.strategy, symbol: input.symbol, side: input.side, leverage: input.leverage, kind: item.kind,
          signal: input.signal, referencePrice: input.referencePrice,
        });
      }
      group.desired = null;
      group.failSafe = input;
      this.logger.error("[strategy-runner] native protection placement failed — reducing exposed fill", {
        strategy: input.strategy, symbol: input.symbol, error: err instanceof Error ? err.message : String(err),
      });
      await this.requestProtectionCancellation(group);
      await this.settleProtectionGroup(group);
    }
  }

  private async failSafeClose(input: NativeProtectionInput): Promise<void> {
    const position = this.findOpenPosition(input.strategy, input.symbol);
    if (position === null) return;
    if (this.portfolioManager !== null) {
      await this.portfolioManager.requestPositionClose(position, "protection_setup_failed");
      return;
    }
    const closingSide = position.side === "long" ? "sell" : "buy";
    const order = await this.orderManager.placeOrder({
      signal: { side: closingSide, confidence: 1, reason: "protection_setup_failed", stopLoss: 0, takeProfit: 0 },
      symbol: input.symbol, amount: position.quantity, referencePrice: input.referencePrice, type: "market",
      reduceOnly: true, strategy: input.strategy, clientOrderIdHint: `${input.strategy}-protection-failsafe`,
    });
    if (order.filled <= 0) {
      this.pendingRiskCloses.set(position.id, order.clientOrderId);
      this.logger.error("[strategy-runner] fail-safe close acknowledged but unfilled — reconciliation retained", {
        strategy: input.strategy, symbol: input.symbol, clientOrderId: order.clientOrderId,
      });
      return;
    }
    this.positionManager.recordFill({
      strategy: input.strategy, symbol: input.symbol, side: closingSide === "sell" ? "short" : "long",
      quantity: order.filled, price: order.average ?? order.price ?? input.referencePrice,
      leverage: input.leverage, timestamp: order.updateTimestamp ?? Date.now(),
    });
  }

  private async reconcileNativeProtections(symbol: ExchangeSymbol): Promise<void> {
    for (const [id, meta] of [...this.nativeProtections]) {
      if (meta.symbol !== symbol) continue;
      const owner = this.nativeProtectionGroups.get(this.protectionKey(meta.strategy, symbol));
      // A create/cancel REST ACK is not terminal evidence on Bybit.  While a
      // cancel is pending, only the authenticated private order stream may
      // retire the leg (including Filled/cancel races).
      if (owner?.cancelPending.has(id) === true) continue;
      try {
        const { order, deltaFilled } = await this.orderManager.reconcileOrder(id, symbol);
        if (deltaFilled > 0) {
          const closingSide = meta.side === "long" ? "sell" : "buy";
          const position = this.findOpenPosition(meta.strategy, symbol);
          if (position !== null) this.positionManager.recordFill({
            strategy: meta.strategy, symbol, side: closingSide === "sell" ? "short" : "long", quantity: Math.min(deltaFilled, position.quantity),
            price: order.average ?? order.price ?? this.latestPrice.get(symbol) ?? 0,
            leverage: meta.leverage, timestamp: order.updateTimestamp ?? Date.now(),
          });
          const remaining = this.findOpenPosition(meta.strategy, symbol);
          const group = this.nativeProtectionGroups.get(this.protectionKey(meta.strategy, symbol));
          if (group !== undefined) {
            group.desired = remaining === null ? null : {
              strategy: meta.strategy, symbol, side: meta.side, quantity: remaining.quantity,
              leverage: meta.leverage, signal: meta.signal, referencePrice: remaining.currentPrice,
            };
            await this.requestProtectionCancellation(group);
          }
        }
        const group = this.nativeProtectionGroups.get(this.protectionKey(meta.strategy, symbol));
        if (group !== undefined && order.status !== "open") this.retireProtectionLeg(group, id);
        if (group !== undefined && group.desired !== null && group.active.size > 0) await this.requestProtectionCancellation(group);
        if (group !== undefined) await this.settleProtectionGroup(group);
      } catch (err) {
        this.logger.warn("[strategy-runner] native protection reconciliation failed", { id, error: err instanceof Error ? err.message : String(err) });
      }
    }
  }

  /** Request cancellation, but keep every leg authoritative until private terminal proof. */
  private async requestProtectionCancellation(group: NativeProtectionGroup): Promise<void> {
    for (const id of [...group.active]) {
      if (group.cancelPending.has(id)) continue;
      group.cancelPending.add(id);
      try {
        await this.orderManager.cancelOrder(id, group.symbol);
      } catch (err) {
        group.cancelPending.delete(id);
        this.logger.warn("[strategy-runner] protection cancel unresolved; old leg remains authoritative", {
          id, strategy: group.strategy, symbol: group.symbol, error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  private retireProtectionLeg(group: NativeProtectionGroup, id: ClientOrderId): void {
    group.active.delete(id);
    group.cancelPending.delete(id);
    this.supersededNativeProtections.add(id);
    while (this.supersededNativeProtections.size > 1_000) {
      const oldest = this.supersededNativeProtections.values().next().value;
      if (oldest === undefined) break;
      this.supersededNativeProtections.delete(oldest);
      this.nativeProtections.delete(oldest);
    }
  }

  private async settleProtectionGroup(group: NativeProtectionGroup): Promise<void> {
    if (group.installing || group.active.size > 0 || group.cancelPending.size > 0) return;
    if (group.failSafe !== null) {
      const failSafe = group.failSafe;
      group.failSafe = null;
      await this.failSafeClose(failSafe);
      this.nativeProtectionGroups.delete(group.key);
      return;
    }
    const desired = group.desired;
    group.desired = null;
    if (desired === null) {
      this.nativeProtectionGroups.delete(group.key);
      return;
    }
    group.installing = true;
    try {
      await this.createProtectionPair(group, desired);
    } finally {
      group.installing = false;
    }
    if (group.active.size === 0 && group.cancelPending.size === 0) {
      await this.settleProtectionGroup(group);
    }
  }

  /**
   * Deterministic OHLC protection rule: stop has priority when a single
   * closed bar touches both stop and target (conservative, no best-case
   * intrabar assumption).  A gap fills at the bar open, otherwise at the
   * trigger.  The actual reduction is always an OrderManager reduce-only
   * order; local state changes only on a confirmed fill.
   */
  private async enforceProtection(
    strategyName: StrategyName,
    strategy: Strategy,
    position: PositionSnapshot,
    candle: Ohlcv,
  ): Promise<boolean> {
    const protection = this.protections.get(this.protectionKey(strategyName, position.symbol));
    if (protection === undefined) return false;
    const stopHit = protection.side === "long"
      ? protection.stopLoss > 0 && candle[3] <= protection.stopLoss
      : protection.stopLoss > 0 && candle[2] >= protection.stopLoss;
    const targetHit = protection.side === "long"
      ? protection.takeProfit > 0 && candle[2] >= protection.takeProfit
      : protection.takeProfit > 0 && candle[3] <= protection.takeProfit;
    if (!stopHit && !targetHit) return false;
    const stop = stopHit; // stop wins same-bar ambiguity
    const trigger = stop ? protection.stopLoss : protection.takeProfit;
    const fillPrice = protection.side === "long"
      ? (stop ? Math.min(candle[1], trigger) : Math.max(candle[1], trigger))
      : (stop ? Math.max(candle[1], trigger) : Math.min(candle[1], trigger));
    const closingSide = position.side === "long" ? "sell" : "buy";
    const order = await this.orderManager.placeOrder({
      signal: { side: closingSide, confidence: 1, reason: stop ? "stop_loss" : "take_profit", stopLoss: 0, takeProfit: 0 },
      symbol: position.symbol, amount: position.quantity, referencePrice: fillPrice, type: "market",
      reduceOnly: true, strategy: strategyName, clientOrderIdHint: `${strategyName}-${stop ? "sl" : "tp"}`,
    });
    this.orderManager.recordFill(order.clientOrderId, order);
    if (order.filled <= 0) return true;
    this.positionManager.recordFill({
      strategy: strategyName, symbol: position.symbol, side: closingSide === "sell" ? "short" : "long",
      quantity: order.filled, price: order.average ?? order.price ?? fillPrice,
      leverage: position.leverage, timestamp: order.updateTimestamp ?? Date.now(),
    });
    if (order.filled >= position.quantity) {
      this.protections.delete(this.protectionKey(strategyName, position.symbol));
      strategy.onPositionClosed?.(stop ? "stop_loss" : "take_profit");
    }
    return true;
  }

  private recordClosedBar(symbol: ExchangeSymbol, timeframe: string, candle: Candle): void {
    const key = this.barKey(symbol, timeframe);
    const current = this.bars.get(key) ?? [];
    if (current.at(-1)?.timestamp === candle.timestamp) return;
    // bounded history covers Donchian(20), ATR(14), and prevents unbounded live growth
    this.bars.set(key, [...current, candle].slice(-256));
  }

  private makeContext(
    symbol: ExchangeSymbol,
    timeframe: StrategyContext["timeframe"],
    candle: Ohlcv,
    frames: readonly StrategyContext["timeframe"][],
  ): StrategyContext {
    const htf = frames[0] ?? timeframe;
    const mtf = frames.length > 2 ? frames[1] ?? timeframe : timeframe;
    const ltf = frames.at(-1) ?? timeframe;
    return {
      symbol: symbol as unknown as StrategyContext["symbol"],
      timeframe,
      candleIndex: this.ticksProcessed,
      candle: this.toCandle(candle),
      mtfState: {
        htf: this.indicators(symbol, htf),
        mtf: this.indicators(symbol, mtf),
        ltf: this.indicators(symbol, ltf),
      },
      pricePrecision: 2,
    };
  }

  private indicators(symbol: ExchangeSymbol, timeframe: string): StrategyContext["mtfState"]["ltf"] {
    const bars = this.bars.get(this.barKey(symbol, timeframe)) ?? [];
    const last = bars.at(-1);
    if (last === undefined) return {};
    const state: {
      close?: number; candleIndex?: number; donchianUpper?: number; donchianLower?: number; atr?: number; adx?: number;
    } = { close: last.close, candleIndex: bars.length };
    if (bars.length >= 20) {
      const window = bars.slice(-20);
      state.donchianUpper = Math.max(...window.map((bar) => bar.high));
      state.donchianLower = Math.min(...window.map((bar) => bar.low));
    }
    if (bars.length >= 15) {
      const tr = bars.slice(-15).slice(1).map((bar, index) => {
        const previous = bars[bars.length - 15 + index]!;
        return Math.max(bar.high - bar.low, Math.abs(bar.high - previous.close), Math.abs(bar.low - previous.close));
      });
      state.atr = tr.reduce((sum, value) => sum + value, 0) / tr.length;
    }
    const adxValue = lastAdx(adx(bars, 14));
    if (adxValue !== undefined) state.adx = adxValue;
    return state;
  }

  /**
   * `applyBudgetCap` — a kért méretet a portfolió-büdzsé CAP-jéhez
   * skálázza. Ha a CAP kisebb mint a kért notional, a méret a CAP
   * / referencePrice arányára csökken. Ha a CAP 0, a visszatérés 0
   * (a hívó kihagyja az order-t).
   *
   * A CAP nélküli esetben (nincs PortfolioManager vagy a büdzsé
   * nagyobb mint a kért notional) a baseAmount változatlanul
   * visszatér.
   */
  private applyBudgetCap(
    strategyName: StrategyName,
    baseAmount: number,
    referencePrice: number,
  ): number {
    if (this.portfolioManager === null) {
      return baseAmount;
    }
    const capUsd = this.portfolioManager.getBudgetFor(strategyName);
    if (capUsd <= 0 || referencePrice <= 0) {
      return 0;
    }
    const requestedNotional = baseAmount * referencePrice;
    if (requestedNotional <= capUsd) {
      return baseAmount;
    }
    const scaled = capUsd / referencePrice;
    this.logger.debug("[strategy-runner] budget cap shrunk order", {
      strategy: strategyName,
      baseAmount,
      scaledAmount: scaled,
      capUsd,
      requestedNotional,
    });
    return scaled;
  }

  /**
   * `toCandle` — az OHLCV tuple-ből `Candle` típust készít.
   */
  private toCandle(ohlcv: readonly [number, number, number, number, number, number]): Candle {
    return {
      timestamp: ohlcv[0],
      open: ohlcv[1],
      high: ohlcv[2],
      low: ohlcv[3],
      close: ohlcv[4],
      volume: ohlcv[5],
    };
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
export const defaultSizingFn: SizingFn = (params) => {
  const { referencePrice, equityUsd, riskPerTrade } = params;
  if (referencePrice <= 0) return 0;
  return (equityUsd * riskPerTrade) / referencePrice;
};

/**
 * `appendRunnerStatsToState` — a runner statisztikáit hozzáfűzi a
 * `BotState`-hez (külön mezők nélkül, a counters-en keresztül).
 */
export function runnerStatsToState(
  _stats: StrategyRunnerStats,
  state: BotState,
): BotState {
  return {
    ...state,
    counters: state.counters,
  };
}
