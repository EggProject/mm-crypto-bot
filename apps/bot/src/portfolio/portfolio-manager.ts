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

import type { OrderManager } from "../bot/order-manager.js";
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
  readonly logger?: Logger;
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
 * `PerStrategyBudget` — a `Map<strategyId, USD>` nézet a TUI / CLI
 * számára. A részletes `BudgetBreakdown` a `getBudgetBreakdowns()`-on
 * keresztül érhető el.
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
  private readonly riskBudget: RiskBudgetAllocator;
  private readonly correlation: CorrelationMatrix;
  private readonly portfolioStop: PortfolioStop;
  private readonly positionManager: PositionManager;
  private readonly orderManager: OrderManager;
  private readonly logger: Logger;

  // Az aktív stratégiák konfigurációja (a `Bot` tölti fel induláskor,
  // és a `recordFill` / `recordEquity` közben frissül).
  private readonly strategyConfigs = new Map<string, StrategyRiskConfig>();
  // Az utolsó büdzsé-számítás eredménye (a TUI / getPerStrategyBudget
  // ezt olvassa, nem számol újra minden híváskor).
  private lastBudgets: ReadonlyMap<string, BudgetBreakdown> = new Map();
  // Latch: a close-all akció már fut-e? (a párhuzamos hívások
  // kiszűrésére — a trip callback akár többször is tüzelhet a
  // recordEquity során, de a close-all-t csak egyszer szabad indítani).
  private closeAllInFlight = false;
  // Latch: a close-all már lefutott-e? (a StrategyRunner a bot
  // leállásáig a tripped flag-en keresztül jelzi, de a tesztelhetőség
  // kedvéért külön is nyilván tartjuk).
  private closeAllExecuted = false;
  // A close-all ígérete — a `recordEquityAndSettle` hívás várja be.
  // `null` ha még nem indult close-all.
  private closeAllPromise: Promise<void> | null = null;
  // Per-strategy contribution (unrealized P&L USD per strategy) —
  // a `recordEquity` híváskor frissül, a `PortfolioStop` használja.
  private perStrategyUnrealized = new Map<string, number>();

  public constructor(opts: PortfolioManagerOptions) {
    this.riskBudget = opts.riskBudget;
    this.correlation = opts.correlation;
    this.portfolioStop = opts.portfolioStop;
    this.positionManager = opts.positionManager;
    this.orderManager = opts.orderManager;
    this.logger = opts.logger ?? createLogger("info");
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
  // Read-only API (StrategyRunner, TUI, CLI)
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
   * `getPerStrategyBudget` — az összes stratégia büdzséje USD-ben.
   * A TUI / `mm-bot status` használja.
   */
  public getPerStrategyBudget(): PerStrategyBudget {
    const out = new Map<string, number>();
    for (const [id, b] of this.lastBudgets) {
      out.set(id, b.finalBudgetUsd);
    }
    return out;
  }

  /**
   * `getBudgetBreakdowns` — az egyes stratégiák RÉSZLETES büdzsé-
   * bontása (súly, max korreláció, penalty, raw/final USD). A TUI
   * debug-panel és a `mm-bot strategies` parancs használja.
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
  public async executeCloseAll(): Promise<void> {
    if (this.closeAllInFlight || this.closeAllExecuted) {
      return;
    }
    this.closeAllInFlight = true;
    this.closeAllPromise = this.runCloseAll();
    try {
      await this.closeAllPromise;
    } finally {
      this.closeAllInFlight = false;
    }
  }

  /**
   * `runCloseAll` — a tényleges close-all implementáció. A `closeAllPromise`
   * mezőbe kerül, hogy a tesztek / a `recordEquityAndSettle` tudjon
   * rá várakozni.
   */
  private async runCloseAll(): Promise<void> {
    const positions: readonly PositionSnapshot[] = this.positionManager.getPositions();
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
    for (const pos of positions) {
      await this.placeCloseOrder(pos);
    }
    this.closeAllExecuted = true;
    this.logger.error("[portfolio-manager] CLOSE-ALL complete", {
      closedPositions: positions.length,
    });
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
  private async placeCloseOrder(pos: PositionSnapshot): Promise<void> {
    const closingSide = pos.side === "long" ? "sell" : "buy";
    const referencePrice = pos.currentPrice > 0 ? pos.currentPrice : pos.entryPrice;
    try {
      await this.orderManager.placeOrder({
        signal: {
          side: closingSide,
          confidence: 1,
          reason: "portfolio-stop-close",
          stopLoss: 0,
          takeProfit: 0,
        },
        symbol: pos.symbol,
        amount: pos.quantity,
        referencePrice,
        type: "market",
        clientOrderIdHint: `pf-stop-${pos.strategy}`,
      });
      this.logger.warn("[portfolio-manager] close order placed", {
        strategy: pos.strategy,
        symbol: String(pos.symbol),
        side: pos.side,
        closingSide,
        quantity: pos.quantity,
        referencePrice,
      });
    } catch (err) {
      this.logger.error("[portfolio-manager] close order FAILED — position remains open", {
        strategy: pos.strategy,
        symbol: String(pos.symbol),
        side: pos.side,
        quantity: pos.quantity,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
