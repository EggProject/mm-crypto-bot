/**
 * apps/bot/src/portfolio/portfolio-manager.ts
 *
 * Phase 37 Track 4 — `PortfolioManager` — a portfolió-szintű
 * koordináció központi osztálya.
 *
 * ===========================================================================
 * CÉL
 * ===========================================================================
 * A Phase 6 multi-class ensemble strategy-k portfolió-szintű
 * koordináció nélkül futottak — minden stratégia önállóan döntött
 * a méretezésről, a kill-switch-ek pedig csak az egyedi equity-re
 * figyeltek. Ez a fájl a HIÁNYZÓ PORTFOLIÓ-LEVEL DÖNTÉSHOZÓ:
 *
 *   ┌────────────────────────────────────────────────────────────┐
 *   │                     PortfolioManager                        │
 *   │                                                            │
 *   │  ┌──────────────────┐  ┌──────────────────┐  ┌──────────┐ │
 *   │  │ RiskBudget       │  │ Correlation      │  │ Portfolio│ │
 *   │  │ Allocator        │  │ Matrix           │  │ Stop     │ │
 *   │  │                  │  │                  │  │ (DD%)    │ │
 *   │  │ total_risk ×     │  │ rolling N=30     │  │          │ │
 *   │  │ weight ×         │  │ Pearson per      │  │ trip →   │ │
 *   │  │ (1-penalty)      │  │ strategy pair    │  │ CLOSE ALL│ │
 *   │  └──────────────────┘  └──────────────────┘  └──────────┘ │
 *   │         ▲                     ▲                    ▲       │
 *   │         │                     │                    │       │
 *   │     recordFill()          recordFill()        recordEquity │
 *   │         │                     │                    │       │
 *   └─────────┼─────────────────────┼────────────────────┼───────┘
 *             │                     │                    │
 *         StrategyRunner      StrategyRunner        Bot.run
 *         (signal → size)      (fill → return)      (heartbeat)
 *
 * ===========================================================================
 * ADATFOLYAM
 * ===========================================================================
 *   1) A `Bot` indítja el, és átadja neki a `RiskBudgetAllocator`,
 *      `CorrelationMatrix`, `PortfolioStop`, `PositionManager` és
 *      `OrderManager` referenciákat.
 *   2) A `StrategyRunner.handleSignal` a signal ELŐTT konzultál
 *      a `PortfolioManager`-rel:
 *        - `isTripped()` → ha igen, kihagyja az order-t.
 *        - `getBudgetFor(strategyId)` → cap-usd, méretezés.
 *   3) A `StrategyRunner` a `positionManager.recordFill` UTÁN
 *      hívja a `PortfolioManager.recordFill`-t, ami a
 *      correlation stream-be ír.
 *   4) A `Bot.run` heartbeat-je a `recordEquity(equityUsd)` hívással
 *      frissíti a `PortfolioStop` magas-víz-jelét, ami tüzelhet.
 *   5) Ha a `PortfolioStop` tüzel, a `tripAction` callback az
 *      ÖSSZES NYITOTT POZÍCIÓT MARKET ORDER-REL zárja.
 *
 * ===========================================================================
 * STATE-ELKÜLÖNÍTÉS
 * ===========================================================================
 * A `PortfolioManager` a StrategyRunnertől FÜGGETLEN — amikor a
 * circuit breaker tüzel, a `StrategyRunner` a `isTripped()`-on
 * keresztül értesül, és nem küld több order-t. A botot a
 * `Bot.stop()`-pal kell leállítani (a `PortfolioManager` nem
 * birtokolja a `Bot`-ot — az a tulajdonosi lánc a `Bot.init`-ben).
 */

import type { Logger } from "@mm-crypto-bot/shared";
import { createLogger } from "@mm-crypto-bot/shared";
import { asSymbol } from "@mm-crypto-bot/exchange";
import type { ClientOrderId, ExchangePosition, MarketMeta, Symbol as ExchangeSymbol } from "@mm-crypto-bot/exchange";

import type { OrderLifecycleEvent, OrderManager } from "../bot/order-manager.js";
import type { PositionManager, PositionSnapshot } from "../bot/position-manager.js";
import type { RiskBudgetAllocator } from "./risk-budget.js";
import type { BudgetBreakdown, StrategyRiskConfig } from "./risk-budget.js";
import type { CorrelationMatrix } from "./correlation.js";
import type { CorrelationSnapshot } from "./correlation.js";
import type { PortfolioStop } from "./portfolio-stop.js";
import type { PortfolioStopState } from "./portfolio-stop.js";

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
  /** Live kill-switches require venue position reconciliation before close. */
  readonly requireAuthoritativeEmergencyState?: boolean;
  /** Symbols in scope for venue-only spot/derivative exposure discovery. */
  readonly configuredSymbols?: readonly string[];
  /** Bounded terminal lifecycle evidence retained for late venue fills. */
  readonly terminalCloseEvidenceLimit?: number;
  readonly logger?: Logger;
}

/** Outcome of one close-all attempt.  A nonempty `unresolved` is retryable. */
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

interface PendingCloseJournal {
  readonly key: string;
  readonly clientOrderId: ClientOrderId;
  readonly symbol: ExchangeSymbol;
  readonly reason: string;
  readonly positionIds: readonly string[];
  readonly requestedQuantity: number;
}

/**
 * `PerStrategyBudget` — a `Map<strategyId, USD>` diagnostic view for
 * runtime status consumers. Detailed values are available through
 * `getBudgetBreakdowns()`.
 */
export type PerStrategyBudget = ReadonlyMap<string, number>;

/** Concrete OrderManager/PositionManager boundaries normalize all failures to Error. */
function managedErrorMessage(error: unknown): string {
  return String(Reflect.get(Object(error), "message"));
}

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
  private readonly riskBudget: RiskBudgetAllocator;
  private readonly correlation: CorrelationMatrix;
  private readonly portfolioStop: PortfolioStop;
  private readonly positionManager: PositionManager;
  private readonly orderManager: OrderManager;
  private readonly requireAuthoritativeEmergencyState: boolean;
  private readonly configuredSymbols: readonly string[];
  private readonly logger: Logger;
  private readonly terminalCloseEvidenceLimit: number;

  // Az aktív stratégiák konfigurációja (a `Bot` tölti fel induláskor,
  // és a `recordFill` / `recordEquity` közben frissül).
  private readonly strategyConfigs = new Map<string, StrategyRiskConfig>();
  // The last budget calculation is cached for read-only status consumers.
  private lastBudgets: ReadonlyMap<string, BudgetBreakdown> = new Map();
  // Latch: a close-all akció már fut-e? (a párhuzamos hívások
  // kiszűrésére — a trip callback akár többször is tüzelhet a
  // recordEquity során, de a close-all-t csak egyszer szabad indítani).
  private closeAllInFlight = false;
  // Latch: a close-all már lefutott-e? (a StrategyRunner a bot
  // leállásáig a tripped flag-en keresztül jelzi, de a tesztelhetőség
  // kedvéért külön is nyilván tartjuk).
  private closeAllExecuted = false;
  /** Pending close journal: acknowledgements survive retries and triggers. */
  private readonly pendingCloses = new Map<string, PendingCloseJournal>();
  private readonly pendingCloseByOrder = new Map<ClientOrderId, PendingCloseJournal>();
  /** Bounded terminal evidence survives journal removal and late duplicate WS updates. */
  private readonly terminalCloseEvidence = new Map<ClientOrderId, {
    readonly journal: PendingCloseJournal;
    readonly status: "closed" | "canceled";
    readonly filled: number;
  }>();
  // A close-all ígérete — a `recordEquityAndSettle` hívás várja be.
  // `null` ha még nem indult close-all.
  private closeAllPromise: Promise<CloseAllReport> | null = null;
  // Per-strategy contribution (unrealized P&L USD per strategy) —
  // a `recordEquity` híváskor frissül, a `PortfolioStop` használja.
  private perStrategyUnrealized = new Map<string, number>();

  public constructor(opts: PortfolioManagerOptions) {
    this.riskBudget = opts.riskBudget;
    this.correlation = opts.correlation;
    this.portfolioStop = opts.portfolioStop;
    this.positionManager = opts.positionManager;
    this.orderManager = opts.orderManager;
    this.requireAuthoritativeEmergencyState = opts.requireAuthoritativeEmergencyState ?? false;
    this.configuredSymbols = opts.configuredSymbols ?? [];
    this.logger = opts.logger ?? createLogger("info");
    this.terminalCloseEvidenceLimit = opts.terminalCloseEvidenceLimit ?? 5_000;
    if (!Number.isInteger(this.terminalCloseEvidenceLimit) || this.terminalCloseEvidenceLimit < 1) {
      throw new RangeError("terminalCloseEvidenceLimit must be a positive integer");
    }
    this.orderManager.onLifecycle((event) => { this.applyCloseLifecycle(event); });
    // A close-all callback-et ráhúzzuk a `PortfolioStop` trip-jére.
    // Így a stop tüzelésekor AUTOMATIKUSAN zárunk minden pozíciót.
    // Az arrow function a `this`-t lexikálisan köti, így később is
    // helyesen hívódik.
    this.portfolioStop.setTripAction(() => {
      void this.executeCloseAll();
    });
    // A `reset({clearPeak:true})` hívás a konstruktorban a
    // `PortfolioStop` belső state-jét nullázza (peak, latch).
    // Erre azért van szükség, mert a `PortfolioStop` esetleg
    // korábbi owner-öknél használt állapotot hordoz (pl. a
    // `Bot` indításakor egy korábbi session-ből).
    this.portfolioStop.reset({ clearPeak: true });
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
    return this.closeAllExecuted;
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
    this.closeAllInFlight = false;
    this.closeAllExecuted = false;
    this.perStrategyUnrealized = new Map();
    this.lastBudgets = new Map();
    this.recomputeBudgets();
  }

  // --------------------------------------------------------------------------
  // Internals
  // --------------------------------------------------------------------------

  /**
   * `recomputeBudgets` — a büdzsé-allokáció újraszámítása. A
   * `setStrategyConfig` / `recordFill` hívja. Pure function, nincs
   * side-effect a PositionManager / OrderManager felé.
   */
  private recomputeBudgets(): void {
    this.lastBudgets = this.riskBudget.computeBudgets(
      this.strategyConfigs,
      () => this.correlation.getMatrix().matrix,
    );
  }

  /**
   * `updatePerStrategyUnrealized` — a per-strategy unrealized P&L
   * frissítése a `PositionManager` aktuális állapotából. A
   * `recordEquity` híváskor fut.
   */
  private updatePerStrategyUnrealized(): void {
    const next = new Map<string, number>();
    for (const pos of this.positionManager.getPositions()) {
      const current = next.get(pos.strategy) ?? 0;
      next.set(pos.strategy, current + pos.unrealizedPnl);
    }
    this.perStrategyUnrealized = next;
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
    if (this.closeAllInFlight && this.closeAllPromise !== null) {
      // A second emergency caller (e.g. registry + PortfolioStop) must await
      // the existing attempt; returning early would let Bot.stop tear down the
      // feed while the first close/cancel requests are still running.
      return this.closeAllPromise;
    }
    if (this.closeAllExecuted) {
      return { closed: [], unresolved: [], cancelledOrders: [] };
    }
    this.closeAllInFlight = true;
    this.closeAllPromise = this.runCloseAll();
    try {
      return await this.closeAllPromise;
    } finally {
      this.closeAllInFlight = false;
    }
  }

  /**
   * `runCloseAll` — a tényleges close-all implementáció. A `closeAllPromise`
   * mezőbe kerül, hogy a tesztek / a `recordEquityAndSettle` tudjon
   * rá várakozni.
   */
  private async runCloseAll(): Promise<CloseAllReport> {
    let positions: readonly PositionSnapshot[] = this.positionManager.getPositions();
    const localPositionById = new Map(positions.map((position) => [position.id, position]));
    const cancelled = await this.orderManager.cancelTrackedOrders(new Set([...this.pendingCloses.values()].map((item) => item.clientOrderId)));
    const cancelledOrders = cancelled.filter((item) => item.error === undefined).map((item) => String(item.clientOrderId));
    const cancellationFailures = cancelled.filter((item) => item.error !== undefined).map((item) => `cancel ${String(item.clientOrderId)}: ${item.error}`);
    const venueOnlyResults: { readonly label: string; readonly closed: boolean }[] = [];
    const localJournalKeys = new Map<string, string>();
    let authoritativeFlatConfirmed = !this.requireAuthoritativeEmergencyState || this.orderManager.isPaperMode();
    if (this.requireAuthoritativeEmergencyState && !this.orderManager.isPaperMode()) {
      const symbols = [...new Set([...positions.map((position) => position.symbol), ...this.configuredSymbols.map((symbol) => asSymbol(symbol))])];
      const marketMeta = new Map<ExchangeSymbol, MarketMeta>();
      for (const symbol of symbols) {
        try {
          marketMeta.set(symbol, await this.orderManager.getMarketMeta(symbol));
        } catch (err) {
          cancellationFailures.push(`market metadata ${String(symbol)}: ${managedErrorMessage(err)}`);
        }
      }

      let exchangePositions: readonly ExchangePosition[] | undefined;
      try {
        exchangePositions = await this.orderManager.getAuthoritativePositions(symbols);
      } catch (err) {
        this.logger.warn("[portfolio-manager] derivative position reconciliation unavailable", { error: managedErrorMessage(err) });
      }

      let balances: ReadonlyMap<string, number> | undefined;
      try {
        balances = new Map((await this.orderManager.getAuthoritativeBalances()).map((balance) => [balance.currency, balance.total]));
      } catch (err) {
        cancellationFailures.push(`authoritative balances: ${managedErrorMessage(err)}`);
      }

      const derivativeLocalIds = new Map<string, string[]>();
      const spotLocalIds = new Map<ExchangeSymbol, string[]>();
      for (const local of positions) {
        const meta = marketMeta.get(local.symbol);
        if (meta?.isSpot === true) {
          if (local.side !== "long") {
            this.positionManager.reconcileVenueAbsent(local.id);
            cancellationFailures.push(`invalid local spot short removed: ${String(local.symbol)}`);
            continue;
          }
          if (balances === undefined) {
            cancellationFailures.push(`spot inventory unavailable: ${String(local.symbol)}`);
          } else if ((balances.get(meta.base) ?? 0) <= 0) {
            this.positionManager.reconcileVenueAbsent(local.id);
            this.logger.error("[portfolio-manager] stale local spot position removed", { strategy: local.strategy, symbol: String(local.symbol) });
          } else {
            const ids = spotLocalIds.get(local.symbol) ?? [];
            ids.push(local.id);
            spotLocalIds.set(local.symbol, ids);
          }
          continue;
        }

        if (exchangePositions === undefined) {
          cancellationFailures.push(`derivative position unavailable: ${String(local.symbol)}`);
          continue;
        }
        const remote = exchangePositions.find((candidate) => candidate.symbol === local.symbol && candidate.side === local.side && candidate.quantity > 0);
        if (remote === undefined) {
          // Do not submit a local-only close: it could create fresh venue exposure.
          this.positionManager.reconcileVenueAbsent(local.id);
          this.logger.error("[portfolio-manager] stale local derivative position removed", { strategy: local.strategy, symbol: String(local.symbol), side: local.side });
          continue;
        }
        const key = this.derivativeCloseKey(remote.symbol, remote.side);
        const ids = derivativeLocalIds.get(key) ?? [];
        ids.push(local.id);
        derivativeLocalIds.set(key, ids);
      }
      // In authoritative mode every venue exposure is closed exactly once.
      // Local strategy positions are merely attribution targets for fill
      // bookkeeping; they never create an additional venue order.
      positions = [];

      if (exchangePositions !== undefined) {
        for (const remote of exchangePositions) {
          const key = this.derivativeCloseKey(remote.symbol, remote.side);
          const localIds = derivativeLocalIds.get(key) ?? [];
          const closed = await this.placeVenueOnlyClose(remote, localIds);
          const attributed = localIds.length === 1 ? localPositionById.get(localIds[0]!) : undefined;
          venueOnlyResults.push({ label: attributed === undefined ? `venue/${String(remote.symbol)}/${remote.side}` : `${attributed.strategy}/${String(remote.symbol)}/${remote.side}`, closed });
        }
      }
      if (balances !== undefined) {
        for (const [symbol, meta] of marketMeta) {
          if (meta.isSpot !== true) continue;
          const venueQuantity = this.roundSpotQuantity(balances.get(meta.base) ?? 0, meta);
          if (!this.isTradableSpotQuantity(venueQuantity, meta, undefined)) continue;
          const localIds = spotLocalIds.get(symbol) ?? [];
          const closed = await this.placeVenueOnlySpotClose(symbol, venueQuantity, meta, localIds);
          const attributed = localIds.length === 1 ? localPositionById.get(localIds[0]!) : undefined;
          venueOnlyResults.push({ label: attributed === undefined ? `venue/${String(symbol)}/spot` : `${attributed.strategy}/${String(symbol)}/${attributed.side}`, closed });
        }
      }

      // Create/cancel responses are acknowledgements, not proof that venue
      // exposure is gone.  A close-all latch is therefore allowed only after
      // a fresh authoritative snapshot observes both derivatives and spot
      // inventory as flat, in addition to the local journal being empty.
      const verification = await this.verifyAuthoritativeFlat(symbols, marketMeta);
      authoritativeFlatConfirmed = verification.flat;
      cancellationFailures.push(...verification.failures);
      if (!verification.flat && verification.failures.length === 0) {
        cancellationFailures.push("authoritative venue exposure remains open");
      }
    }
    this.logger.error("[portfolio-manager] CLOSE-ALL — closing all open positions", {
      openPositions: positions.length,
      perStrategy: positions.map((p) => ({
        strategy: p.strategy,
        symbol: String(p.symbol),
        side: p.side,
        quantity: p.quantity,
        notionalUsd: p.notionalUsd,
      })),
    });
    const results = await Promise.all(positions.map(async (pos) => ({
      pos,
      closed: await this.placeCloseOrder(pos, undefined, "portfolio-stop-close", localJournalKeys.get(pos.id)),
    })));
    const unresolved = results.filter((result) => !result.closed);
    // A close acknowledgement is not completion.  Keep the latch clear when
    // any position remains, so a subsequent emergency evaluation may retry.
    this.closeAllExecuted = cancellationFailures.length === 0 && unresolved.length === 0 && venueOnlyResults.every((result) => result.closed) && authoritativeFlatConfirmed && this.positionManager.getPositions().length === 0 && this.pendingCloses.size === 0;
    if (unresolved.length > 0 || !this.closeAllExecuted) {
      this.logger.error("[portfolio-manager] CLOSE-ALL incomplete — retry remains enabled", {
        unresolved: unresolved.map(({ pos }) => ({ strategy: pos.strategy, symbol: String(pos.symbol), side: pos.side })),
      });
      return {
        closed: results.filter((result) => result.closed).map((result) => `${result.pos.strategy}/${String(result.pos.symbol)}`),
        unresolved: [...cancellationFailures, ...unresolved.map((result) => `${result.pos.strategy}/${String(result.pos.symbol)}/${result.pos.side}`), ...venueOnlyResults.filter((result) => !result.closed).map((result) => result.label)],
        cancelledOrders,
      };
    }
    this.logger.error("[portfolio-manager] CLOSE-ALL complete", {
      closedPositions: positions.length,
    });
    return { closed: [...results.map((result) => `${result.pos.strategy}/${String(result.pos.symbol)}`), ...venueOnlyResults.filter((result) => result.closed).map((result) => result.label)], unresolved: cancellationFailures, cancelledOrders };
  }

  private async verifyAuthoritativeFlat(
    symbols: readonly ExchangeSymbol[],
    marketMeta: ReadonlyMap<ExchangeSymbol, MarketMeta>,
  ): Promise<{ readonly flat: boolean; readonly failures: readonly string[] }> {
    const failures: string[] = [];
    let derivativeFlat = false;
    try {
      const positions = await this.orderManager.getAuthoritativePositions(symbols);
      derivativeFlat = positions.every((position) => !(position.quantity > 0));
    } catch (err) {
      failures.push(`authoritative position verification: ${managedErrorMessage(err)}`);
    }

    let spotFlat = false;
    try {
      const balances = new Map((await this.orderManager.getAuthoritativeBalances()).map((balance) => [balance.currency, balance.total]));
      spotFlat = [...marketMeta.values()].every((meta) => {
        if (meta.isSpot !== true) return true;
        const quantity = this.roundSpotQuantity(balances.get(meta.base) ?? 0, meta);
        return !this.isTradableSpotQuantity(quantity, meta, undefined);
      });
    } catch (err) {
      failures.push(`authoritative balance verification: ${managedErrorMessage(err)}`);
    }

    return { flat: derivativeFlat && spotFlat && failures.length === 0, failures };
  }

  /**
   * `recordEquityAndSettle` — a `recordEquity` async verziója, ami
   * a trip esetén bevárja a close-all akció befejezését. A tesztek
   * használják a szinkron viselkedés biztosítására.
   */
  public async recordEquityAndSettle(equityUsd: number): Promise<void> {
    this.recordEquity(equityUsd);
    if (this.portfolioStop.isTripped() && this.closeAllPromise !== null) {
      await this.closeAllPromise;
    }
  }

  /**
   * `placeCloseOrder` — egy pozíció záró order-jének elhelyezése.
   * A `OrderManager.placeOrder` PIACI order-t hív, ellentétes
   * oldallal, a pozíció teljes méretével.
   *
   * A pozíció manager a fill-t a normál flow-n keresztül kapja
   * meg (a feed-en a market order azonnal fill-elhet, vagy a
   * paper-mode feed-en a `setOrderStatus` hívás szimulálja).
   */
  private async placeCloseOrder(pos: PositionSnapshot, authoritativeQuantity: number | undefined, reason: string, journalKey?: string): Promise<boolean> {
    const closingSide = pos.side === "long" ? "sell" : "buy";
    const referencePrice = pos.currentPrice;
    const key = journalKey ?? `local:${pos.id}`;
    const journal = this.pendingCloses.get(key);
    if (journal !== undefined) {
      try {
        const { order, deltaFilled } = await this.orderManager.reconcileOrder(journal.clientOrderId, pos.symbol);
        this.applyCloseDelta(journal.positionIds, order, deltaFilled);
        const remaining = this.positionManager.getPositions().find((item) => item.id === pos.id);
        if (remaining === undefined) {
          this.finishCloseJournal(journal, "closed", order.filled);
          return true;
        }
        if (order.status === "open") return false;
        // Terminal partial/cancel: retry only the confirmed remainder below.
        this.finishCloseJournal(journal, order.status, order.filled);
        pos = remaining;
      } catch (err) {
        this.logger.warn("[portfolio-manager] pending close reconciliation failed", {
          positionId: pos.id, clientOrderId: journal.clientOrderId,
          error: managedErrorMessage(err),
        });
        return false;
      }
    }
    const amount = Math.min(authoritativeQuantity ?? pos.quantity, pos.quantity);
    try {
      const order = await this.orderManager.placeOrder({
        signal: {
          side: closingSide,
          confidence: 1,
          reason,
          stopLoss: 0,
          takeProfit: 0,
        },
        symbol: pos.symbol,
        amount,
        referencePrice,
        type: "market",
        reduceOnly: true,
        strategy: pos.strategy,
        leverage: pos.leverage,
        clientOrderIdHint: `pf-stop-${pos.strategy}`,
      });
      this.orderManager.recordFill(order.clientOrderId, order);
      if (order.status === "open") this.openCloseJournal({
        key, clientOrderId: order.clientOrderId, symbol: pos.symbol, reason,
        positionIds: [pos.id], requestedQuantity: amount,
      });
      if (order.filled <= 0) {
        this.logger.warn("[portfolio-manager] close acknowledged but unfilled — retaining retry", {
          strategy: pos.strategy, symbol: String(pos.symbol), clientOrderId: order.clientOrderId,
        });
        return false;
      }
      this.positionManager.recordFill({
        strategy: pos.strategy,
        symbol: pos.symbol,
        side: closingSide === "sell" ? "short" : "long",
        quantity: order.filled,
        price: order.average ?? order.price ?? referencePrice,
        leverage: pos.leverage,
        timestamp: order.updateTimestamp ?? Date.now(),
      });
      this.logger.warn("[portfolio-manager] close order placed", {
        strategy: pos.strategy,
        symbol: String(pos.symbol),
        side: pos.side,
        closingSide,
        quantity: amount,
        referencePrice,
      });
      return this.positionManager.getPositions().every((item) => item.id !== pos.id);
    } catch (err) {
      this.logger.error("[portfolio-manager] close order FAILED — position remains open", {
        strategy: pos.strategy,
        symbol: String(pos.symbol),
        side: pos.side,
        quantity: pos.quantity,
        error: managedErrorMessage(err),
      });
      return false;
    }
  }

  /** Shared close entry point for force-exit and trailing/emergency owners. */
  public async requestPositionClose(pos: PositionSnapshot, reason: string): Promise<boolean> {
    if (this.requireAuthoritativeEmergencyState && !this.orderManager.isPaperMode()) {
      try {
        const meta = await this.orderManager.getMarketMeta(pos.symbol);
        const key = meta.isSpot === true ? this.spotCloseKey(pos.symbol) : this.derivativeCloseKey(pos.symbol, pos.side);
        return await this.placeCloseOrder(pos, undefined, reason, key);
      } catch (err) {
        this.logger.error("[portfolio-manager] cannot establish authoritative close key", {
          positionId: pos.id, symbol: String(pos.symbol), error: managedErrorMessage(err),
        });
        return false;
      }
    }
    return this.placeCloseOrder(pos, undefined, reason, `local:${pos.id}`);
  }

  private applyCloseLifecycle(event: OrderLifecycleEvent): void {
    const journal = this.pendingCloseByOrder.get(event.order.clientOrderId);
    if (journal === undefined) {
      const terminal = this.terminalCloseEvidence.get(event.order.clientOrderId);
      if (terminal === undefined || event.deltaFilled <= 0) return;
      // Bybit documents late Filled/cancel races. Keep terminal ownership so a
      // late execution is still booked, then cancel any replacement close for
      // the same authoritative exposure before it can over-close.
      this.applyCloseDelta(terminal.journal.positionIds, event.order, event.deltaFilled, event.kind === "execution" ? event.execution.price : undefined);
      const replacement = this.pendingCloses.get(terminal.journal.key);
      if (replacement !== undefined && replacement.clientOrderId !== event.order.clientOrderId) {
        void this.orderManager.cancelOrder(replacement.clientOrderId, replacement.symbol).catch((err: unknown) => {
          this.logger.error("[portfolio-manager] late terminal fill replacement cancel failed", {
            key: terminal.journal.key, clientOrderId: replacement.clientOrderId,
            error: managedErrorMessage(err),
          });
        });
      }
      return;
    }
    this.applyCloseDelta(journal.positionIds, event.order, event.deltaFilled, event.kind === "execution" ? event.execution.price : undefined);
    if (event.order.status !== "open") this.finishCloseJournal(journal, event.order.status, event.order.filled);
  }

  private applyCloseDelta(positionIds: readonly string[], order: OrderLifecycleEvent["order"], deltaFilled: number, executionPrice?: number): void {
    if (deltaFilled <= 0) return;
    let unallocated = deltaFilled;
    for (const positionId of positionIds) {
      if (unallocated <= 0) break;
      const position = this.positionManager.getPositions().find((item) => item.id === positionId);
      if (position === undefined) continue;
      const closingSide = position.side === "long" ? "sell" : "buy";
      const quantity = Math.min(unallocated, position.quantity);
      this.positionManager.recordFill({
        strategy: position.strategy, symbol: position.symbol,
        side: closingSide === "sell" ? "short" : "long", quantity,
        price: executionPrice ?? order.average ?? order.price ?? position.currentPrice,
        leverage: position.leverage, timestamp: order.updateTimestamp ?? Date.now(),
      });
      unallocated -= quantity;
    }
  }

  private openCloseJournal(journal: PendingCloseJournal): void {
    this.pendingCloses.set(journal.key, journal);
    this.pendingCloseByOrder.set(journal.clientOrderId, journal);
  }

  private finishCloseJournal(journal: PendingCloseJournal, status: "closed" | "canceled", filled: number): void {
    this.pendingCloses.delete(journal.key);
    this.pendingCloseByOrder.delete(journal.clientOrderId);
    this.terminalCloseEvidence.set(journal.clientOrderId, { journal, status, filled });
    if (this.terminalCloseEvidence.size > this.terminalCloseEvidenceLimit) {
      for (const oldest of this.terminalCloseEvidence.keys()) {
        this.terminalCloseEvidence.delete(oldest);
        break;
      }
    }
  }

  /** Flattens a derivative position the venue reports but the local book lacks. */
  private async placeVenueOnlyClose(position: ExchangePosition, positionIds: readonly string[]): Promise<boolean> {
    const side = position.side === "long" ? "sell" : "buy";
    const price = position.markPrice ?? position.entryPrice;
    if (price === undefined || price <= 0) return false;
    const key = this.derivativeCloseKey(position.symbol, position.side);
    const pending = await this.reconcilePendingVenueClose(key, position.symbol);
    if (pending === "open" || pending === "unavailable") return false;
    try {
      const order = await this.orderManager.placeOrder({
        signal: { side, confidence: 1, reason: "venue-only-emergency-close", stopLoss: 0, takeProfit: 0 },
        symbol: position.symbol, amount: position.quantity, referencePrice: price, type: "market", reduceOnly: true,
        clientOrderIdHint: positionIds.length > 0 ? "pf-stop-authoritative" : "venue-emergency",
      });
      this.orderManager.recordFill(order.clientOrderId, order);
      if (order.status === "open") this.openCloseJournal({
        key, clientOrderId: order.clientOrderId, symbol: position.symbol, reason: "venue-only-emergency-close",
        positionIds, requestedQuantity: position.quantity,
      });
      this.applyCloseDelta(positionIds, order, order.filled);
      return order.filled >= position.quantity;
    } catch (err) {
      this.logger.error("[portfolio-manager] venue-only close failed", { symbol: String(position.symbol), error: managedErrorMessage(err) });
      return false;
    }
  }

  /** Sells inventory which exists at the venue but has no local position. */
  private async placeVenueOnlySpotClose(symbol: ExchangeSymbol, quantity: number, meta: MarketMeta, positionIds: readonly string[]): Promise<boolean> {
    const key = this.spotCloseKey(symbol);
    const pending = await this.reconcilePendingVenueClose(key, symbol);
    if (pending === "open" || pending === "unavailable") return false;
    try {
      const ticker = await this.orderManager.getTickerSnapshot(symbol);
      const referencePrice = ticker.bid > 0 ? ticker.bid : ticker.last;
      if (!this.isTradableSpotQuantity(quantity, meta, referencePrice)) return false;
      const order = await this.orderManager.placeOrder({
        signal: { side: "sell", confidence: 1, reason: "venue-only-spot-emergency-close", stopLoss: 0, takeProfit: 0 },
        symbol,
        amount: quantity,
        referencePrice,
        type: "market",
        // Bybit spot does not accept reduceOnly; its adapter intentionally
        // omits this flag while the sell quantity is derived from balances.
        reduceOnly: true,
        clientOrderIdHint: positionIds.length > 0 ? "pf-stop-authoritative" : "venue-spot-emergency",
      });
      this.orderManager.recordFill(order.clientOrderId, order);
      if (order.status === "open") this.openCloseJournal({
        key, clientOrderId: order.clientOrderId, symbol, reason: "venue-only-spot-emergency-close",
        positionIds, requestedQuantity: quantity,
      });
      this.applyCloseDelta(positionIds, order, order.filled);
      return order.filled >= quantity;
    } catch (err) {
      this.logger.error("[portfolio-manager] venue-only spot close failed", { symbol: String(symbol), error: managedErrorMessage(err) });
      return false;
    }
  }

  private async reconcilePendingVenueClose(key: string, symbol: ExchangeSymbol): Promise<"none" | "open" | "terminal" | "unavailable"> {
    const journal = this.pendingCloses.get(key);
    if (journal === undefined) return "none";
    try {
      const { order, deltaFilled } = await this.orderManager.reconcileOrder(journal.clientOrderId, symbol);
      this.applyCloseDelta(journal.positionIds, order, deltaFilled);
      if (order.status === "open") return "open";
      this.finishCloseJournal(journal, order.status, order.filled);
      return "terminal";
    } catch (err) {
      this.logger.warn("[portfolio-manager] pending authoritative close reconciliation failed", {
        key, clientOrderId: journal.clientOrderId, error: managedErrorMessage(err),
      });
      return "unavailable";
    }
  }

  private derivativeCloseKey(symbol: ExchangeSymbol, side: "long" | "short"): string {
    return `derivative:${String(symbol)}:${side}`;
  }

  private spotCloseKey(symbol: ExchangeSymbol): string {
    return `spot:${String(symbol)}`;
  }

  private roundSpotQuantity(quantity: number, meta: MarketMeta): number {
    if (!Number.isFinite(quantity) || quantity <= 0) return 0;
    const factor = 10 ** meta.amountPrecision;
    return Math.floor((quantity + Number.EPSILON) * factor) / factor;
  }

  private isTradableSpotQuantity(quantity: number, meta: MarketMeta, price: number | undefined): boolean {
    if (!Number.isFinite(quantity) || quantity < meta.minAmount) return false;
    return price === undefined || meta.minCost <= 0 || quantity * price >= meta.minCost;
  }
}
