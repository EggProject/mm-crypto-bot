import { requireLogger, type Logger } from "@mm-crypto-bot/logging";

import type { OrderManager } from "../bot/order-manager.js";
import type { PositionManager, PositionSnapshot } from "../bot/position-manager.js";
import type { RiskBudgetAllocator } from "./risk-budget.js";
import type { BudgetBreakdown, StrategyRiskConfig } from "./risk-budget.js";
import type { CorrelationMatrix } from "./correlation.js";
import type { CorrelationSnapshot } from "./correlation.js";
import type { PortfolioStop } from "./portfolio-stop.js";
import type { PortfolioStopState } from "./portfolio-stop.js";
import { PortfolioCloseCoordinator } from "./portfolio-close-coordinator.js";
import { PortfolioCloseLifecycle } from "./portfolio-close-lifecycle.js";

// ============================================================================
// Public types
// ============================================================================

/**
 * `PortfolioManagerOptions` — az orchestrator konfigurációja.
 *
 * - `riskBudget`       — a `RiskBudgetAllocator` instance.
 * - `correlation`      — a `CorrelationMatrix` instance.
 * - `portfolioStop`    — a `PortfolioStop` instance (a trip-callback
 *                          ide van horgonyozva).
 * - `positionManager`  — a pozíció-nyilvántartó (a close-all és a
 *                          per-strategy contribution forrása).
 * - `orderManager`     — az order-végrehajtó (a close-all hívja).
 * - `logger`           — opcionális structured logger.
 */
export interface PortfolioManagerOptions {
  readonly riskBudget: RiskBudgetAllocator;
  readonly correlation: CorrelationMatrix;
  readonly portfolioStop: PortfolioStop;
  readonly positionManager: PositionManager;
  readonly orderManager: OrderManager;
  /**
  Live kill-switches require venue position reconciliation before close.
  */
  readonly requireAuthoritativeEmergencyState?: boolean;
  /**
  Symbols in scope for venue-only spot/derivative exposure discovery.
  */
  readonly configuredSymbols?: readonly string[];
  /**
  Bounded terminal lifecycle evidence retained for late venue fills.
  */
  readonly terminalCloseEvidenceLimit?: number;
  readonly logger?: Logger;
}

/**
Outcome of one close-all attempt.  A nonempty `unresolved` is retryable.
*/
export interface CloseAllReport {
  readonly closed: readonly string[];
  readonly unresolved: readonly string[];
  readonly cancelledOrders: readonly string[];
}

/**
 * `RecordFillInput` — a `recordFill` hívás argumentumai.
 *
 * - `strategyId`  — a kitöltést végző stratégia.
 * - `returnPct`   — a trade return-je SZÁZALÉKBAN (pl. 0.02 = +2%).
 *                    A correlation-stream ezt tárolja.
 */
export interface RecordFillInput {
  readonly strategyId: string;
  readonly returnPct: number;
}

/**
 * `PerStrategyBudget` — a `Map<strategyId, USD>` diagnostic view for
 * runtime status consumers. Detailed values are available through
 * `getBudgetBreakdowns()`.
 */
export type PerStrategyBudget = ReadonlyMap<string, number>;

/**
 * `PortfolioState` — a teljes portfolió-szintű pillanatkép. A
 * `Bot.getState()`-be is bekerülhet (a Phase 37+ scope plan), illetve
 * a `mm-bot status` parancs használja.
 */
export interface PortfolioState {
  readonly perStrategyBudgetUsd: ReadonlyMap<string, number>;
  readonly budgetBreakdowns: ReadonlyMap<string, BudgetBreakdown>;
  readonly correlation: CorrelationSnapshot;
  readonly stopState: PortfolioStopState;
  readonly strategyRiskConfigs: ReadonlyMap<string, StrategyRiskConfig>;
  readonly isTripped: boolean;
}

// ============================================================================
// PortfolioManager class
// ============================================================================

/**
 * `PortfolioManager` — a portfolió-szintű koordináció SINGLE SOURCE
 * OF TRUTH-ja.
 *
 * A `Bot` indítja el a `Bot.init()` során, és a `StrategyRunner`
 * a `Bot.init()`-ben kapja meg a referenciát.
 */

export class PortfolioManager {
  private readonly correlation: CorrelationMatrix;
  private readonly closeCoordinator: PortfolioCloseCoordinator;
  private readonly closeLifecycle: PortfolioCloseLifecycle;
  private readonly portfolioStop: PortfolioStop;
  private readonly positionManager: PositionManager;
  private readonly requireAuthoritativeEmergencyState: boolean;
  private readonly riskBudget: RiskBudgetAllocator;
  private readonly logger: Logger;
  private readonly strategyConfigs = new Map<string, StrategyRiskConfig>();
  private lastBudgets: ReadonlyMap<string, BudgetBreakdown> = new Map();
  private perStrategyUnrealized = new Map<string, number>();

  public constructor(options: PortfolioManagerOptions) {
    this.correlation = options.correlation;
    this.portfolioStop = options.portfolioStop;
    this.positionManager = options.positionManager;
    this.requireAuthoritativeEmergencyState = options.requireAuthoritativeEmergencyState ?? false;
    this.riskBudget = options.riskBudget;
    this.logger = requireLogger(options.logger, "portfolio-manager");
    const terminalCloseEvidenceLimit = options.terminalCloseEvidenceLimit ?? 5000;
    if (!Number.isSafeInteger(terminalCloseEvidenceLimit) || terminalCloseEvidenceLimit < 1) {
      throw new RangeError("terminalCloseEvidenceLimit must be a positive integer");
    }
    this.closeLifecycle = new PortfolioCloseLifecycle({
      logger: this.logger,
      orderManager: options.orderManager,
      positionManager: this.positionManager,
      terminalCloseEvidenceLimit,
    });
    this.closeCoordinator = new PortfolioCloseCoordinator({
      closeLifecycle: this.closeLifecycle,
      configuredSymbols: options.configuredSymbols ?? [],
      logger: this.logger,
      orderManager: options.orderManager,
      positionManager: this.positionManager,
      requireAuthoritativeEmergencyState: this.requireAuthoritativeEmergencyState,
    });
    options.orderManager.onLifecycle((event) => {
      this.closeLifecycle.applyCloseLifecycle(event);
    });
    this.portfolioStop.setTripAction(() => {
      void this.executeCloseAll();
    });
    this.portfolioStop.reset({ clearPeak: true });
  }

  private recomputeBudgets(): void {
    this.lastBudgets = this.riskBudget.computeBudgets(
      this.strategyConfigs,
      () => this.correlation.getMatrix().matrix,
    );
  }

  private updatePerStrategyUnrealized(): void {
    const next = new Map<string, number>();
    for (const position of this.positionManager.getPositions()) {
      const current = next.get(position.strategy) ?? 0;
      next.set(position.strategy, current + position.unrealizedPnl);
    }
    this.perStrategyUnrealized = next;
  }

  // --------------------------------------------------------------------------
  // Configuration / introspection
  // --------------------------------------------------------------------------

  /**
   * `setStrategyConfig` — egy stratégia konfigurációjának regisztrálása
   * vagy frissítése. A `Bot` hívja induláskor, és a `mm-bot strategies`
   * parancsban a user által szerkesztett config-ok betöltésekor.
   */
  public setStrategyConfig(config: StrategyRiskConfig): void {
    this.strategyConfigs.set(config.strategyId, config);
    this.recomputeBudgets();
  }

  /**
   * `removeStrategyConfig` — egy stratégia eltávolítása (kikapcsoláskor).
   * A correlation-stream is törlődik.
   */
  public removeStrategyConfig(strategyId: string): void {
    this.strategyConfigs.delete(strategyId);
    this.correlation.forgetStrategy(strategyId);
    this.recomputeBudgets();
  }

  /**
   * `getStrategyConfigs` — az aktív stratégia-konfigurációk pillanatképe.
   */
  public getStrategyConfigs(): ReadonlyMap<string, StrategyRiskConfig> {
    return new Map(this.strategyConfigs);
  }

  // --------------------------------------------------------------------------
  // Read-only API for StrategyRunner and runtime diagnostics
  // --------------------------------------------------------------------------

  /**
   * `isTripped` — a circuit breaker LATCHED flag-je.
   * A `StrategyRunner.handleSignal` a signal ELŐTT ellenőrzi, és
   * kihagyja az order-t, ha `true`.
   */
  public isTripped(): boolean {
    return this.portfolioStop.isTripped();
  }

  /**
   * `getBudgetFor` — egy adott stratégia ciklus-büdzséje (USD).
   * A `StrategyRunner.handleSignal` a sizing UTÁN hívja, hogy a
   * kért méretet ehhez a cap-hez skálázza. 0 = nincs büdzsé (skip).
   */
  public getBudgetFor(strategyId: string): number {
    return this.lastBudgets.get(strategyId)?.finalBudgetUsd ?? 0;
  }

  /**
   * `getPerStrategyBudget` returns every strategy's current budget in USD.
   * Runtime status and monitoring consumers use this snapshot.
   */
  public getPerStrategyBudget(): PerStrategyBudget {
    const out = new Map<string, number>();
    for (const [id, b] of this.lastBudgets) {
      out.set(id, b.finalBudgetUsd);
    }
    return out;
  }

  /**
   * `getBudgetBreakdowns` exposes each strategy's detailed allocation:
   * weight, maximum correlation, penalty, and raw/final USD values. Diagnostic
   * tooling and the `mm-bot strategies` command use this view.
   */
  public getBudgetBreakdowns(): ReadonlyMap<string, BudgetBreakdown> {
    return this.lastBudgets;
  }

  /**
   * `getCorrelationMatrix` — a görgető korreláció-mátrix pillanatképe.
   */
  public getCorrelationMatrix(): CorrelationSnapshot {
    return this.correlation.getMatrix();
  }

  /**
   * `getStopState` — a `PortfolioStop` pillanatképe.
   */
  public getStopState(): PortfolioStopState {
    return this.portfolioStop.getState();
  }

  /**
   * `getPortfolioState` — a teljes portfolió-szintű állapot. A
   * `Bot.getState()`-be kerül, és a `mm-bot status` is ezt írja ki.
   */
  public getPortfolioState(): PortfolioState {
    return {
      perStrategyBudgetUsd: this.getPerStrategyBudget(),
      budgetBreakdowns: this.getBudgetBreakdowns(),
      correlation: this.getCorrelationMatrix(),
      stopState: this.getStopState(),
      strategyRiskConfigs: this.getStrategyConfigs(),
      isTripped: this.isTripped(),
    };
  }

  /**
   * `didExecuteCloseAll` — a close-all lefutott-e már (a tesztek
   * ellenőrzik, hogy a circuit breaker valóban zárta a pozíciókat).
   */
  public didExecuteCloseAll(): boolean {
    return this.closeCoordinator.didExecuteCloseAll();
  }

  // --------------------------------------------------------------------------
  // Event handlers (Bot / StrategyRunner hívja)
  // --------------------------------------------------------------------------

  /**
   * `recordFill` — egy trade return rögzítése. A `StrategyRunner`
   * hívja a `positionManager.recordFill` UTÁN.
   *
   * A metódus:
   *   1) A correlation stream-be írja a return-t.
   *   2) Újraszámolja a büdzsé-allokációt (az új korreláció
   *      megváltoztathatja a penalty-t).
   */
  public recordFill(input: RecordFillInput): void {
    this.correlation.recordFill(input.strategyId, input.returnPct);
    this.recomputeBudgets();
  }

  /**
   * `recordEquity` — a portfolió equity-jének frissítése. A `Bot`
   * heartbeat-je hívja (vagy a `positionManager.getEquity()` observer).
   *
   * A metódus:
   *   1) Frissíti a per-strategy unrealized P&L-t a nyitott pozíciókból.
   *   2) Átadja a `PortfolioStop`-nak, ami tüzelhet.
   */
  public recordEquity(equityUsd: number): void {
    this.updatePerStrategyUnrealized();
    this.portfolioStop.recordEquity(equityUsd, this.perStrategyUnrealized);
  }

  /**
   * `reset` — a teljes portfolió-állapot törlése (újraindításkor).
   * A latch-ek (trip, closeAllExecuted) nullázódnak, a peak is.
   */
  public reset(): void {
    this.portfolioStop.reset({ clearPeak: true });
    this.correlation.reset();
    this.closeCoordinator.reset();
    this.perStrategyUnrealized = new Map();
    this.lastBudgets = new Map();
    this.recomputeBudgets();
  }

  /**
   * `executeCloseAll` — a SAFETY-CRITICAL close-all akció. A
   * `PortfolioStop` trip-jére hívódik (a konstruktorban horgonyozzuk
   * be a `reset()` után, de a tényleges horgonyzás a `Bot.init`-ben
   * történik, amikor a `PositionManager` és `OrderManager` már él).
   *
   * A metódus:
   *   1) Iterálja a `PositionManager` nyitott pozícióit.
   *   2) Minden pozícióra piaci CLOSE order-t helyez el az
   *      `OrderManager`-en keresztül (oldal = ellentétes, típus = market).
   *   3) Latcheli a `closeAllExecuted` flag-et (a StrategyRunner
   *      a bot leállásáig nem küld új order-t).
   *
   * A `closeAllInFlight` latch megakadályozza, hogy párhuzamosan
   * fussanak a close-all akciók (a `recordEquity` akár többször is
   * triggerelheti a trip-et, ha a `peakEquityUsd` frissítésekor
   * átmenetileg magas a drawdown).
   */

  public async executeCloseAll(): Promise<CloseAllReport> {
    return this.closeCoordinator.executeCloseAll();
  }

  public async recordEquityAndSettle(equityUsd: number): Promise<void> {
    this.recordEquity(equityUsd);
    await this.closeCoordinator.awaitIfTripped(this.portfolioStop.isTripped());
  }

  public async requestPositionClose(pos: PositionSnapshot, reason: string): Promise<boolean> {
    return this.closeLifecycle.requestPositionClose(pos, reason, this.requireAuthoritativeEmergencyState);
  }
}
