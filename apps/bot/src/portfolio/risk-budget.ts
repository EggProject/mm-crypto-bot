/**
 * apps/bot/src/portfolio/risk-budget.ts
 *
 * Phase 37 Track 4 — `RiskBudgetAllocator` — a multi-strategy portfolio
 * risk-budget elosztó.
 *
 * ===========================================================================
 * CÉL
 * ===========================================================================
 * A Phase 6 multi-class ensemble strategy-k PORTFOLIO-LEVEL kockázat-
 * kezelés nélkül futottak — minden stratégia önállóan méretezte magát
 * az equity × risk_per_trade alapján. A carry-trade stratégiák (két
 * `dydx_cex_carry` variáns, vagy egy carry + egy funding-flip) erősen
 * korrelálnak (0.6-0.9 a közös funding-rate faktor miatt), és a
 * korrelálatlanul méretezett pozíciók a portfolió-DD-t a vártnál
 * jobban megdobhatják.
 *
 * Az `RiskBudgetAllocator` bevezeti a PORTFOLIO-LEVEL kockázati
 * költségvetést:
 *
 *   total_risk * weight * (1 - correlation_penalty)
 *
 * ahol:
 *   - `total_risk`          — a ciklusonkénti max új kockázat (USD).
 *   - `weight`              — a stratégia saját súlya (0..1).
 *   - `correlation_penalty` — a stratégia max korrelációja a többi
 *                              aktív stratégiával, levágva [0..1]-re
 *                              és a threshold fölé normalizálva.
 *
 * Ha két carry-stratégia korrelációja 0.9, és a threshold 0.7, akkor
 *   penalty = (0.9 - 0.7) / (1 - 0.7) = 0.2 / 0.3 = 0.667
 * és a büdzsé 33.3%-ára csökken. Ha a harmadik stratégia korrelálatlan
 * (0.1), az ő büdzséje változatlan marad.
 *
 * ===========================================================================
 * HASZNÁLAT
 * ===========================================================================
 *   const allocator = new RiskBudgetAllocator({ totalRiskUsd, ... });
 *   const budgets = allocator.computeBudgets(correlationMatrix);
 *   const maxForThisStrategy = budgets.get("dydx_cex_carry") ?? 0;
 *   if (requestedSize > maxForThisStrategy) {
 *     scaleDown(requestedSize, maxForThisStrategy);
 *   }
 */

import type { Logger } from "@mm-crypto-bot/shared";
import { createLogger } from "@mm-crypto-bot/shared";

// ============================================================================
// Public types
// ============================================================================

/**
 * `StrategyRiskConfig` — egy stratégia súlya + saját risk_per_trade.
 *
 * - `strategyId`    — a stratégia egyedi azonosítója (a registry kulcsa).
 * - `weight`        — a portfolióban betöltött relatív súly (0..1).
 *                     Az összes aktív stratégia súlyának összege
 *                     tipikusan 1.0 — ez a "teljes költségvetés"
 *                     allokációja. A `computeBudgets` normalizálja,
 *                     ha az összeg nem 1.
 * - `riskPerTrade`  — a stratégia saját risk_per_trade-je (0..1).
 *                     A `computeBudgets` figyelembe veszi, de a
 *                     tényleges méretezés a `StrategyRunner`-ben
 *                     történik (a büdzsé csak egy CAP, nem a kért méret).
 */
export interface StrategyRiskConfig {
  readonly strategyId: string;
  readonly weight: number;
  readonly riskPerTrade: number;
}

/**
 * `RiskBudgetOptions` — az allocator konfigurációja.
 *
 * - `totalRiskUsd`               — a portfolió ciklusonkénti max új
 *                                   kockázata (USD). Hard cap: 10_000.
 * - `correlationPenaltyThreshold` — a korreláció küszöb (0..1). Ha a
 *                                   két stratégia korrelációja >= ez,
 *                                   penalty-t kap. Default: 0.7.
 *                                   A (1 - threshold) normalizálja a
 *                                   penalty-t: 0.7 → 0.3, 0.9 → 0.1.
 * - `logger`                     — opcionális structured logger.
 */
export interface RiskBudgetOptions {
  readonly totalRiskUsd: number;
  readonly correlationPenaltyThreshold?: number;
  readonly logger?: Logger;
}

/**
 * `CorrelationProvider` — a korreláció-mátrixot szolgáltató callback.
 * A `PortfolioManager` hívja meg minden `computeBudgets` híváskor.
 * Visszatérés: `Map<strategyId, Map<strategyId, correlation>>` —
 * a diagonális 1.0, a mátrix szimmetrikus.
 *
 * A `Map` használata (objektum helyett) azért, mert a kulcsok tetszőleges
 * strategyId string-ek, és a TypeScript `Record<string, ...>` típusa
 * nem biztosítja a `undefined`-mentes iterációt.
 */
export type CorrelationProvider = () => ReadonlyMap<string, ReadonlyMap<string, number>>;

/**
 * `BudgetBreakdown` — az allokáció részletes magyarázata. A TUI /
 * `mm-bot status` / `mm-bot strategies` parancsok ezt használják
 * debuggolásra.
 *
 * - `strategyId`     — a stratégia azonosítója.
 * - `weight`         — a normalizált súly (0..1).
 * - `maxCorrelation` — a többi aktív stratégiával vett max abszolút
 *                       korreláció. 0 ha a stratégia egyedül van.
 * - `penalty`        — a kiszámított penalty (0..1).
 * - `rawBudgetUsd`   — a súly alapján járó büdzsé (USD).
 * - `finalBudgetUsd` — a penalty utáni tényleges büdzsé (USD).
 */
export interface BudgetBreakdown {
  readonly strategyId: string;
  readonly weight: number;
  readonly maxCorrelation: number;
  readonly penalty: number;
  readonly rawBudgetUsd: number;
  readonly finalBudgetUsd: number;
}

/**
 * `Hard caps` — a `RiskBudgetAllocator` biztonsági határértékei.
 *
 * A `total_risk_per_cycle_usd` MAX 10 000 — a user a Phase 6-ban
 * kimondta, hogy a bot nem méretez több kockázatot 10k USD-nél
 * ciklusonként, függetlenül a súlyoktól. A threshold pedig 0..1,
 * mert a korreláció értékkészlete [-1, 1], és a threshold feletti
 * értékeket normalizáljuk.
 */
export const RISK_BUDGET_HARD_CAPS = {
  /** A `total_risk_per_cycle_usd` abszolút maximuma (USD). */
  totalRiskUsdMax: 10_000,
  /** A `correlation_penalty_threshold` minimuma. */
  correlationPenaltyThresholdMin: 0,
  /** A `correlation_penalty_threshold` maximuma. */
  correlationPenaltyThresholdMax: 1,
} as const;

// ============================================================================
// RiskBudgetAllocator class
// ============================================================================

/**
 * `RiskBudgetAllocator` — a portfolió-szintű kockázati költségvetés
 * allokátora. A `Bot` indítja el, és a `StrategyRunner.tick()` ELŐTT
 * hívódik, hogy a kért méretet a büdzséhez skálázza.
 *
 * A class **immutable** a konstrukció után: a `totalRiskUsd` és a
 * `correlationPenaltyThreshold` a konstruktorban finalizálódik. A
 * `computeBudgets()` pure function (csak a bemeneti mátrixtól függ),
 * így a `PortfolioManager` akár minden tick-en újraszámolhatja.
 */
export class RiskBudgetAllocator {
  private readonly totalRiskUsd: number;
  private readonly correlationPenaltyThreshold: number;
  private readonly logger: Logger;

  public constructor(opts: RiskBudgetOptions) {
    if (!Number.isFinite(opts.totalRiskUsd) || opts.totalRiskUsd <= 0) {
      throw new RangeError(
        `[risk-budget] totalRiskUsd must be positive and finite, got ${String(opts.totalRiskUsd)}`,
      );
    }
    if (opts.totalRiskUsd > RISK_BUDGET_HARD_CAPS.totalRiskUsdMax) {
      throw new RangeError(
        `[risk-budget] totalRiskUsd=${String(opts.totalRiskUsd)} exceeds hard cap ${String(RISK_BUDGET_HARD_CAPS.totalRiskUsdMax)}`,
      );
    }
    const threshold = opts.correlationPenaltyThreshold ?? 0.7;
    if (
      !Number.isFinite(threshold) ||
      threshold < RISK_BUDGET_HARD_CAPS.correlationPenaltyThresholdMin ||
      threshold > RISK_BUDGET_HARD_CAPS.correlationPenaltyThresholdMax
    ) {
      throw new RangeError(
        `[risk-budget] correlationPenaltyThreshold must be in [0..1], got ${String(threshold)}`,
      );
    }
    this.totalRiskUsd = opts.totalRiskUsd;
    this.correlationPenaltyThreshold = threshold;
    this.logger = opts.logger ?? createLogger("info");
  }

  /**
   * `getTotalRiskUsd` — a konfigurált teljes ciklus-kockázat (USD).
   */
  public getTotalRiskUsd(): number {
    return this.totalRiskUsd;
  }

  /**
   * `getCorrelationPenaltyThreshold` — a konfigurált threshold.
   */
  public getCorrelationPenaltyThreshold(): number {
    return this.correlationPenaltyThreshold;
  }

  /**
   * `computeBudgets` — kiszámítja az egyes stratégiák ciklus-büdzséjét.
   *
   *   1) Normalizálja a súlyokat (ha az összegük nem 1, de > 0).
   *   2) Minden stratégiához megkeresi a max abszolút korrelációt
   *      a többi aktív stratégiával.
   *   3) Kiszámítja a penalty-t:
   *        - 0 ha a max korreláció < threshold
   *        - (max - threshold) / (1 - threshold) ha >= threshold
   *   4) Visszaadja a büdzsé-t: `total * weight * (1 - penalty)`.
   *
   * A `correlationProvider` opcionális — ha `undefined`, minden
   * korreláció 0 (penalty = 0), és a büdzsé = total * weight.
   *
   * @returns A `Map<strategyId, BudgetBreakdown>` — a teljes
   *          allokáció részletes bontásban. A `finalBudgetUsd` mező
   *          a ténylegesen felhasználható USD ciklusonként.
   */
  public computeBudgets(
    configs: ReadonlyMap<string, StrategyRiskConfig>,
    correlationProvider?: CorrelationProvider,
  ): ReadonlyMap<string, BudgetBreakdown> {
    const result = new Map<string, BudgetBreakdown>();

    // -----------------------------------------------------------------------
    // 1) Pre-flight: ha nincs aktív stratégia, üres map.
    // -----------------------------------------------------------------------
    if (configs.size === 0) {
      return result;
    }

    // -----------------------------------------------------------------------
    // 2) Súlyok normalizálása.
    // -----------------------------------------------------------------------
    const weightSum = [...configs.values()].reduce((acc, c) => acc + Math.max(0, c.weight), 0);
    const normalize = weightSum > 0 ? 1 / weightSum : 1 / configs.size;

    // -----------------------------------------------------------------------
    // 3) Korreláció-mátrix előkészítése (csak ha van provider).
    // -----------------------------------------------------------------------
    const matrix = correlationProvider?.();

    // -----------------------------------------------------------------------
    // 4) Allocator loop.
    // -----------------------------------------------------------------------
    for (const [strategyId, cfg] of configs) {
      const normalizedWeight = Math.max(0, cfg.weight) * normalize;
      const rawBudget = this.totalRiskUsd * normalizedWeight;
      const maxCorr = matrix === undefined ? 0 : this.maxAbsoluteCorrelation(strategyId, matrix, configs);
      const penalty = this.computePenalty(maxCorr);
      const finalBudget = rawBudget * (1 - penalty);
      result.set(strategyId, {
        strategyId,
        weight: normalizedWeight,
        maxCorrelation: maxCorr,
        penalty,
        rawBudgetUsd: rawBudget,
        finalBudgetUsd: finalBudget,
      });
    }

    this.logger.debug("[risk-budget] budgets computed", {
      totalRiskUsd: this.totalRiskUsd,
      threshold: this.correlationPenaltyThreshold,
      strategies: [...result.values()].map((b) => ({
        id: b.strategyId,
        weight: b.weight,
        maxCorr: b.maxCorrelation,
        penalty: b.penalty,
        budget: b.finalBudgetUsd,
      })),
    });

    return result;
  }

  /**
   * `maxAbsoluteCorrelation` — egy adott stratégia max ABSZOLÚT
   * korrelációja a többi aktív stratégiával.
   *
   * A `corr` abszolút értékét használjuk, mert a carry-trade
   * portfóliónál a negatív korreláció (ellentétes kitettség) is
   * kockázat-redukáló hatású — a sign nem számít, csak a MAGNITÚDÓ.
   *
   * Edge case: ha a stratégia egyedül van (vagy minden mással 0
   * a korreláció), visszatér 0-val → nincs penalty.
   */
  private maxAbsoluteCorrelation(
    strategyId: string,
    matrix: ReadonlyMap<string, ReadonlyMap<string, number>>,
    configs: ReadonlyMap<string, StrategyRiskConfig>,
  ): number {
    const ownRow = matrix.get(strategyId);
    if (ownRow === undefined) {
      return 0;
    }
    let max = 0;
    for (const otherId of configs.keys()) {
      if (otherId === strategyId) continue;
      const corr = ownRow.get(otherId);
      if (corr === undefined || !Number.isFinite(corr)) continue;
      const abs = Math.abs(corr);
      if (abs > max) {
        max = abs;
      }
    }
    return max;
  }

  /**
   * `computePenalty` — a korreláció-alapú büntetés kiszámítása.
   *
   *   corr < threshold     → 0 (nincs penalty)
   *   corr >= threshold    → (corr - threshold) / (1 - threshold)
   *   threshold === 1      → 0 vagy 1 (különleges eset)
   *
   * A threshold=1 esetén a (1-1) nullával való osztás NaN-t adna —
   * ezt külön lekezeljük: ha threshold=1, a penalty 0 (senki nem
   * éri el a küszöböt, hiszen a max korreláció 1).
   */
  private computePenalty(maxCorrelation: number): number {
    if (maxCorrelation < this.correlationPenaltyThreshold) {
      return 0;
    }
    const span = 1 - this.correlationPenaltyThreshold;
    if (span <= 0) {
      // threshold = 1 → senki nem kaphat penalty-t.
      return 0;
    }
    const raw = (maxCorrelation - this.correlationPenaltyThreshold) / span;
    // Clamp [0..1] — a korreláció elvileg [-1..1], de az abszolút
    // érték [0..1], és a threshold [0..1], tehát a raw is [0..1].
    return Math.max(0, Math.min(1, raw));
  }
}
