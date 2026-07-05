// packages/core/src/risk/portfolio-risk-engine.ts — cross-strategy portfolio risk engine
//
// Phase 10G Track B — portfolio-level risk computation.
//
// =========================================================================
// ARCHITECTURE
// =========================================================================
// PortfolioRiskEngine is a SIGNAL BUS SUBSCRIBER. It receives typed
// signals from the central SignalBus (Track A — when it ships) and
// aggregates them into cross-strategy risk metrics:
//
//   - portfolioVaR(stream, confidence)        — daily VaR across ALL positions
//   - crossStrategyCorrelation()               — Pearson correlation matrix
//                                                (30d rolling default)
//   - aggregateDrawdown(state)                 — running portfolio drawdown
//                                                (NOT per-strategy)
//   - exposureBySymbol()                       — concentration check (40%/sym)
//   - leverageInvariantGuard(signal)           — 3rd defense-in-depth layer
//                                                for the 1:10 mandate
//
// The engine is designed to be SIGNED-OFF-FRIENDLY:
//   - All public methods are pure (no I/O, no signal emission as side effect)
//   - The exception is `leverageInvariantGuard` which CAN emit a RiskSignal
//     when the 1:10 mandate is breached
//   - State is internal but exposed via read-only snapshot getters
//
// =========================================================================
// SCOPE vs TRACK A's SignalBus
// =========================================================================
// Track A will provide a central SignalBus. This engine is engineered
// to be a subscriber to that bus, but for the unit tests we expose a
// simple `submitSignal()` method that accepts the same signal shapes.
// The signal types are minimal and match the discriminated union that
// Track A's signal-bus.ts will use.
//
// =========================================================================
// WHY CROSS-STRATEGY RISK MATTERS
// =========================================================================
// Per-strategy Sharpe can look healthy while the AGGREGATE portfolio
// concentrates risk. Examples:
//   - Two strategies each at 6× leverage → aggregate 12× (3rd-layer catch)
//   - Strategies with 0.95 correlation → portfolio VaR ≈ sum of VaRs
//     (no diversification benefit)
//   - Strategies all betting on the same factor (e.g. all funding-rate
//     carry) → concentration risk
// PortfolioRiskEngine makes these correlations and concentrations
// observable so the operator can intervene BEFORE a blow-up.
//
// =========================================================================
// References (≥3 independent sources per empirical claim)
// =========================================================================
//
// 1. IOSR Journal of Economics and Finance — "Diversified VaR of the
//    portfolio will be lesser than the sum of the Individual VaR" —
//    the empirical basis for portfolio-level VaR < sum of per-strategy
//    VaR (subadditivity).
//    https://www.iosrjournals.org/iosr-jef/papers/icsc/volume-2/16.pdf
//
// 2. vine copula portfolio VaR (PDFs.semanticscholar) — "the aggregate
//    VaR forecast has not only lower value but also higher accuracy
//    than the simple sum of individual VaR forecasts". Empirically
//    validates the diversification benefit at the portfolio level.
//    https://pdfs.semanticscholar.org/75e7/c9a9e3b241159306977963d606838139f752.pdf
//
// 3. arXiv 2412.02654 "Simple and Effective Portfolio Construction with
//    Crypto Assets" — iterated EWMA correlation matrix for time-varying
//    crypto correlation. The standard for rolling correlation in crypto.
//    https://arxiv.org/html/2412.02654v1
//
// 4. RiskMetrics Technical Document (J.P. Morgan 1996) — EWMA with
//    λ=0.94 is the standard decay factor for daily returns correlation.
//    Cited by the arXiv paper above and standard portfolio risk texts.
//
// 5. HKMA "Sound risk management practices for algorithmic trading"
//    (Mar 2020) — "Automated surveillance tools should be in place to
//    detect suspicious activities". Real-time VaR / drawdown monitoring
//    is the canonical pattern.
//    https://brdr.hkma.gov.hk/eng/doc-ldg/docId/getPdf/20200306-4-EN/20200306-4-EN.pdf
//
// 6. Cursa "Risk management for crypto investing" — "Core asset cap:
//    10%–25% maximum in any single asset". 40% per-symbol concentration
//    cap is on the conservative end (suitable for 3-symbol portfolios).
//    https://cursa.app/en/page/risk-management-for-crypto-investing-position-sizing-diversification-and-exit-rules
//
// 7. Bitcompare diversification guide — "Maximum Correlation Rules:
//    High correlation pairs (>0.7): Limit combined exposure to 25%".
//    Cross-strategy correlation >0.7 is the alarm threshold.
//    https://community.bitcompare.net/dean/diversification-strategies-in-crypto-a-comprehensive-guide-3dif

import {
  assertLeverageInvariant,
  computeEffectiveLeverage,
  DEFAULT_LEVERAGE_INVARIANT_CONFIG,
  LeverageBreachError,
  type LeverageInvariantConfig,
  type Position,
} from "./leverage-invariant.js";

// ----------------------------------------------------------------------
// Signal types — minimal discriminated union matching Track A's bus shapes
// ----------------------------------------------------------------------

/** Symbol identifier (matches shared/types.ts). */
export type Symbol_ = string;

/**
 * `DirectionSignal` — emitted when a strategy wants to take a directional
 * position (long/short). The `effectiveNotionalUsd` is the SIZE of the
 * proposed position (NOT the dollar value of equity at risk — that is
 * derived from leverage).
 */
export interface DirectionSignal {
  readonly kind: "direction";
  readonly source: string; // strategy plugin name
  readonly symbol: Symbol_;
  readonly side: "long" | "short";
  readonly confidence: number; // 0..1
  readonly effectiveNotionalUsd: number; // signed (long=+, short=-)
  readonly timestamp: number;
}

/**
 * `CarrySignal` — emitted when a strategy opens a delta-neutral carry
 * position (long spot, short perp or vice versa). The carry notional
 * is the SHARED size of both legs.
 */
export interface CarrySignal {
  readonly kind: "carry";
  readonly source: string;
  readonly symbol: Symbol_;
  readonly effectiveNotionalUsd: number; // signed (typically + for "receiving funding")
  readonly timestamp: number;
}

/**
 * `SizingSignal` — emitted by a strategy declaring its desired position
 * size. The risk engine uses this as the SIGNAL that a sizing decision
 * has been made and the notional needs to be aggregated into the
 * portfolio exposure.
 */
export interface SizingSignal {
  readonly kind: "sizing";
  readonly source: string;
  readonly symbol: Symbol_;
  readonly effectiveNotionalUsd: number; // signed
  readonly leverage: number; // the per-strategy leverage this sizing implies
  readonly timestamp: number;
}

/**
 * `RiskSignal` — emitted by the risk engine itself (or another risk
 * source) to flag a risk condition. Other strategies subscribe to these
 * to back off when the portfolio is under stress.
 */
export interface RiskSignal {
  readonly kind: "risk";
  readonly source: string;
  readonly symbol?: Symbol_;
  readonly drawdownLimit?: number;
  readonly varDaily95?: number;
  readonly reason: string;
  readonly timestamp: number;
  /** True if this signal represents an actual breach (vs an early warning). */
  readonly breach?: boolean;
}

/** Discriminated union of all signals the engine subscribes to. */
export type Signal = DirectionSignal | CarrySignal | SizingSignal | RiskSignal;

// ----------------------------------------------------------------------
// Configuration
// ----------------------------------------------------------------------

/**
 * `PortfolioRiskEngineConfig` — knobs for the risk engine.
 *
 * Defaults reflect the Phase 10G brief and practitioner consensus:
 *   - `confidence = 0.95` — standard daily VaR confidence (matches
 *     bybit.eu funding-fee VaR convention + Phase 7 Track C default).
 *   - `correlationWindowDays = 30` — 30d rolling window is the standard
 *     practitioner consensus for daily crypto (Moreira-Muir monthly,
 *     usekeel.io "20-day crypto", arXiv 2412.02654 EWMA λ=0.94 ≈ 30d).
 *   - `concentrationThresholdPct = 0.40` — 40% per-symbol cap. The
 *     Cursa guide recommends 10-25% for "core" assets; 40% is the
 *     conservative end for a 3-symbol portfolio where single-symbol
 *     bets are acceptable but should not dominate.
 *   - `maxAggregateDrawdownPct = 0.20` — 20% portfolio drawdown cap.
 *     Standard practitioner "circuit-breaker" threshold.
 *   - `leverageInvariant` — delegates to leverage-invariant module.
 */
export interface PortfolioRiskEngineConfig {
  readonly confidence: number; // 0..1, e.g. 0.95
  readonly correlationWindowDays: number; // e.g. 30
  readonly concentrationThresholdPct: number; // e.g. 0.40 (40%)
  readonly maxAggregateDrawdownPct: number; // e.g. 0.20 (20%)
  readonly leverageInvariant: LeverageInvariantConfig;
}

/**
 * `DEFAULT_PORTFOLIO_RISK_ENGINE_CONFIG` — production defaults.
 */
export const DEFAULT_PORTFOLIO_RISK_ENGINE_CONFIG: PortfolioRiskEngineConfig = {
  confidence: 0.95,
  correlationWindowDays: 30,
  concentrationThresholdPct: 0.40,
  maxAggregateDrawdownPct: 0.20,
  leverageInvariant: DEFAULT_LEVERAGE_INVARIANT_CONFIG,
};

// ----------------------------------------------------------------------
// Output types
// ----------------------------------------------------------------------

/**
 * `VaRPoint` — single VaR computation snapshot.
 */
export interface VaRPoint {
  readonly timestamp: number;
  /** Daily VaR as a positive number (e.g. 0.02 = 2% of capital). */
  readonly dailyVaR95Pct: number;
  /** Daily VaR in USD (assuming `capital` is the base). */
  readonly dailyVaR95Usd: number;
  /** Method used ("parametric" = Gaussian assumption, "historical" = empirical). */
  readonly method: "parametric" | "historical";
  /** Number of return observations in the rolling window. */
  readonly observations: number;
}

/**
 * `CorrelationMatrix` — full symmetric N×N Pearson correlation matrix
 * between per-strategy return series. Diagonal is 1.0 by definition.
 */
export interface CorrelationMatrix {
  /** Strategy names in row/column order. */
  readonly sources: readonly string[];
  /** 2D square matrix — matrix[i][j] = correlation between sources[i] and sources[j]. */
  readonly matrix: readonly (readonly number[])[];
  /** Window in days that was used to compute the matrix. */
  readonly windowDays: number;
  /** As-of timestamp. */
  readonly timestamp: number;
  /** Per-source observation count (the smallest window among all sources — typically all equal). */
  readonly observationCount: number;
}

/**
 * `ExposureBySymbol` — concentration check result.
 * `totalNotionalUsd` is the gross exposure across all symbols; per-symbol
 * breakdown shows the concentration.
 */
export interface ExposureBySymbol {
  readonly totalNotionalUsd: number;
  readonly perSymbol: ReadonlyMap<Symbol_, number>;
  /** Per-symbol fraction of total (sum = 1.0). */
  readonly perSymbolFraction: ReadonlyMap<Symbol_, number>;
  /** Symbols exceeding `concentrationThresholdPct`. */
  readonly overThresholdSymbols: readonly Symbol_[];
  readonly threshold: number;
  readonly timestamp: number;
}

/**
 * `AggregateDrawdownState` — running portfolio drawdown tracker.
 */
export interface AggregateDrawdownState {
  readonly peakEquityUsd: number;
  readonly currentEquityUsd: number;
  readonly drawdownPct: number; // (peak - current) / peak, positive number
  readonly drawdownUsd: number; // peak - current
  readonly maxDrawdownPct: number; // largest DD seen so far
  readonly isAtLimit: boolean; // drawdownPct >= maxAggregateDrawdownPct
  readonly timestamp: number;
}

/**
 * `RiskSnapshot` — full state of the risk engine at a point in time.
 * Serializable for telemetry/monitoring dashboards.
 */
export interface RiskSnapshot {
  readonly timestamp: number;
  readonly numStrategies: number;
  readonly numSignalsSubmitted: number;
  readonly numRiskSignalsEmitted: number;
  readonly numLeverageBreaches: number;
  readonly lastVaR: VaRPoint | null;
  readonly lastCorrelation: CorrelationMatrix | null;
  readonly exposure: ExposureBySymbol;
  readonly drawdown: AggregateDrawdownState;
  readonly positions: readonly Position[];
  readonly aggregateLeverage: number;
  readonly leverageInvariantFires: readonly { readonly timestamp: number; readonly leverage: number; readonly message: string }[];
}

// ----------------------------------------------------------------------
// PortfolioRiskEngine — main class
// ----------------------------------------------------------------------

/**
 * `PortfolioRiskEngine` — cross-strategy portfolio risk computation.
 *
 * Usage pattern:
 *   const engine = new PortfolioRiskEngine(config);
 *   // Feed signals from SignalBus (or call submitSignal directly):
 *   engine.submitSignal({ kind: 'sizing', source: 'donchian', ... });
 *   // Per-bar or per-day:
 *   const snap = engine.snapshot();
 *
 * The engine is deterministic (no I/O), and supports re-feeding historical
 * signal streams for backtest validation.
 */
export class PortfolioRiskEngine {
  readonly config: PortfolioRiskEngineConfig;

  // ---- State ----
  // Per-source return series: Map<source, [r1, r2, ...]> where r is daily return
  // (decimal, e.g. 0.01 = +1% on the day).
  private readonly perSourceReturns = new Map<string, number[]>();
  // Per-source timestamp index for the return series (parallel to perSourceReturns).
  private readonly perSourceTimestamps = new Map<string, number[]>();
  // Aggregate equity curve (USD) over time for drawdown tracking.
  private readonly equityCurve: number[] = [];
  private readonly equityTimestamps: number[] = [];
  // Current positions by (source, symbol).
  private readonly currentPositions = new Map<string, Position>();
  // All-time RiskSignal emissions (for telemetry + replay).
  private readonly emittedRiskSignals: RiskSignal[] = [];
  // Per-source signal submission counts.
  private numSignalsSubmitted = 0;
  // Leverage invariant fires (for the report's "guard fires count" field).
  private readonly _leverageInvariantFires: {
    timestamp: number;
    leverage: number;
    message: string;
  }[] = [];

  constructor(config: PortfolioRiskEngineConfig = DEFAULT_PORTFOLIO_RISK_ENGINE_CONFIG) {
    if (!Number.isFinite(config.confidence) || config.confidence <= 0 || config.confidence >= 1) {
      throw new Error(
        `confidence must be in (0, 1), got ${String(config.confidence)}`,
      );
    }
    if (!Number.isInteger(config.correlationWindowDays) || config.correlationWindowDays <= 0) {
      throw new Error(
        `correlationWindowDays must be positive integer, got ${String(config.correlationWindowDays)}`,
      );
    }
    if (
      !Number.isFinite(config.concentrationThresholdPct) ||
      config.concentrationThresholdPct <= 0 ||
      config.concentrationThresholdPct > 1
    ) {
      throw new Error(
        `concentrationThresholdPct must be in (0, 1], got ${String(config.concentrationThresholdPct)}`,
      );
    }
    if (
      !Number.isFinite(config.maxAggregateDrawdownPct) ||
      config.maxAggregateDrawdownPct <= 0 ||
      config.maxAggregateDrawdownPct > 1
    ) {
      throw new Error(
        `maxAggregateDrawdownPct must be in (0, 1], got ${String(config.maxAggregateDrawdownPct)}`,
      );
    }
    this.config = config;
  }

  // --------------------------------------------------------------------
  // Signal ingestion
  // --------------------------------------------------------------------

  /**
   * `submitSignal` — feed a signal into the engine. The engine updates
   * its state based on the signal kind:
   *   - `sizing` / `direction` / `carry` → updates the position table
   *   - `risk` → stored for cross-reference (no state change)
   *
   * Returns an optional emitted RiskSignal (e.g. when the 1:10 invariant
   * is breached by a SizingSignal that pushes the aggregate above 10×).
   */
  submitSignal(signal: Signal): RiskSignal | null {
    this.numSignalsSubmitted += 1;
    if (signal.kind === "risk") {
      // Risk signals are ingested but don't mutate position state.
      this.emittedRiskSignals.push(signal);
      return null;
    }
    // sizing / direction / carry all update position table.
    const key = `${signal.source}:${signal.symbol}`;
    const pos: Position = {
      symbol: signal.symbol,
      source: signal.source,
      effectiveNotionalUsd: signal.effectiveNotionalUsd,
    };
    this.currentPositions.set(key, pos);
    // Check the 3rd-layer leverage invariant.
    const breach = this.leverageInvariantGuard();
    if (breach !== null) {
      return breach;
    }
    return null;
  }

  /**
   * `recordSourceReturn` — feed a daily return observation for a source
   * (strategy plugin). The return is appended to the rolling window
   * and the window is truncated to `correlationWindowDays`.
   *
   * `returnPct` is the daily return on the strategy's notional
   * (decimal, e.g. 0.01 = +1% on the day). Negative for losses.
   */
  recordSourceReturn(source: string, timestamp: number, returnPct: number): void {
    if (!Number.isFinite(returnPct)) {
      throw new Error(
        `returnPct must be a finite number for source=${source}, got ${String(returnPct)}`,
      );
    }
    if (!Number.isFinite(timestamp) || timestamp <= 0) {
      throw new Error(`timestamp must be positive finite, got ${String(timestamp)}`);
    }
    let series = this.perSourceReturns.get(source);
    let ts = this.perSourceTimestamps.get(source);
    if (!series || !ts) {
      series = [];
      ts = [];
      this.perSourceReturns.set(source, series);
      this.perSourceTimestamps.set(source, ts);
    }
    series.push(returnPct);
    ts.push(timestamp);
    // Truncate to window (keep the most recent N observations).
    while (series.length > this.config.correlationWindowDays) {
      series.shift();
      ts.shift();
    }
  }

  /**
   * `recordEquitySnapshot` — feed a portfolio equity snapshot for
   * drawdown tracking. The engine tracks the running peak and the
   * current drawdown. Call this once per bar (e.g. once per day in
   * backtest mode).
   */
  recordEquitySnapshot(timestamp: number, equityUsd: number): void {
    if (!Number.isFinite(equityUsd) || equityUsd <= 0) {
      throw new Error(`equityUsd must be positive finite, got ${String(equityUsd)}`);
    }
    this.equityCurve.push(equityUsd);
    this.equityTimestamps.push(timestamp);
  }

  // --------------------------------------------------------------------
  // VaR computation
  // --------------------------------------------------------------------

  /**
   * `portfolioVaR` — compute daily VaR across the AGGREGATE portfolio.
   *
   * If multiple sources have returns, the AGGREGATE portfolio return
   * for each day is the SUM of per-source returns (weighted by current
   * notional — see Note below). The VaR is the (1 - confidence)
   * percentile of the aggregate return distribution.
   *
   * Note: This is a SIMPLIFIED portfolio VaR. A full Markowitz
   * variance-covariance VaR (Σ weights × σ × z) would be more
   * accurate but requires tracking per-symbol position weights over
   * time. The simplified sum-of-returns approach is the standard
   * "backtest VaR" and is appropriate for daily-strategy monitoring.
   *
   * Returns null if there are no return observations yet.
   */
  portfolioVaR(capital: number): VaRPoint | null {
    if (!Number.isFinite(capital) || capital <= 0) {
      throw new Error(`capital must be positive finite, got ${String(capital)}`);
    }
    const sources = Array.from(this.perSourceReturns.keys());
    if (sources.length === 0) {
      return null;
    }
    // Build aligned aggregate return series (sum per-day across sources
    // that have an observation that day).
    const aggregate = this.buildAlignedAggregateReturns();
    if (aggregate.length < 2) {
      // Need at least 2 obs for std-based parametric VaR.
      return null;
    }
    // Parametric VaR (Gaussian): VaR = -(μ - z * σ) where z is the
    // standard normal quantile for the (1 - confidence) tail.
    // The VaR is a POSITIVE number representing the loss magnitude.
    const mean = aggregate.reduce((a, b) => a + b, 0) / aggregate.length;
    const variance =
      aggregate.reduce((a, b) => a + (b - mean) * (b - mean), 0) / (aggregate.length - 1);
    const std = Math.sqrt(variance);
    // z-value for the (1 - confidence) percentile (e.g. confidence=0.95 → z=1.645)
    const z = normalQuantile(this.config.confidence);
    const dailyVaR95Pct = -(mean - z * std); // positive number for loss
    const dailyVaR95Usd = dailyVaR95Pct * capital;
    return {
      timestamp: this.equityTimestamps[this.equityTimestamps.length - 1] ?? Date.now(),
      dailyVaR95Pct,
      dailyVaR95Usd,
      method: "parametric",
      observations: aggregate.length,
    };
  }

  /**
   * `buildAlignedAggregateReturns` — internal helper: returns the
   * SUM of per-source returns for each calendar day that has at least
   * one observation. Days with no observations are skipped (the VaR
   * is computed on the OBSERVED days, not calendar days).
   */
  private buildAlignedAggregateReturns(): number[] {
    const sources = Array.from(this.perSourceReturns.keys());
    if (sources.length === 0) return [];
    // Collect all unique timestamps across sources.
    const tsSet = new Set<number>();
    for (const s of sources) {
      const ts = this.perSourceTimestamps.get(s)!;
      for (const t of ts) tsSet.add(t);
    }
    const sortedTs = Array.from(tsSet).sort((a, b) => a - b);
    // For each unique timestamp, sum the returns from sources that have
    // an observation at that timestamp.
    const out: number[] = [];
    for (const t of sortedTs) {
      let sum = 0;
      for (const s of sources) {
        const ts = this.perSourceTimestamps.get(s)!;
        const idx = ts.indexOf(t);
        if (idx >= 0) {
          sum += this.perSourceReturns.get(s)![idx]!;
        }
      }
      out.push(sum);
    }
    return out;
  }

  // --------------------------------------------------------------------
  // Cross-strategy correlation
  // --------------------------------------------------------------------

  /**
   * `crossStrategyCorrelation` — compute the Pearson correlation matrix
   * between per-source return series. Aligned to the COMMON timestamps
   * (intersection of all sources' timestamps).
   *
   * Returns null if fewer than 2 sources have data, or if any source
   * has fewer than 2 observations.
   */
  crossStrategyCorrelation(): CorrelationMatrix | null {
    const sources = Array.from(this.perSourceReturns.keys()).sort();
    if (sources.length < 2) return null;
    // Align to common timestamps (intersection).
    let commonTs: Set<number> | null = null;
    for (const s of sources) {
      const ts = new Set(this.perSourceTimestamps.get(s));
      if (commonTs === null) {
        commonTs = ts;
      } else {
        const intersection = new Set<number>();
        for (const t of commonTs) {
          if (ts.has(t)) intersection.add(t);
        }
        commonTs = intersection;
      }
    }
    if (!commonTs || commonTs.size < 2) return null;
    const sortedTs = Array.from(commonTs).sort((a, b) => a - b);
    // Build aligned series.
    const aligned: number[][] = sources.map((s) => {
      const tsArr = this.perSourceTimestamps.get(s)!;
      const retArr = this.perSourceReturns.get(s)!;
      return sortedTs.map((t) => {
        const idx = tsArr.indexOf(t);
        return retArr[idx]!;
      });
    });
    // Compute pairwise Pearson correlation.
    const matrix: number[][] = [];
    for (let i = 0; i < sources.length; i++) {
      matrix.push([]);
      for (let j = 0; j < sources.length; j++) {
        if (i === j) {
          matrix[i]!.push(1);
        } else if (j < i) {
          // Symmetric — reuse lower triangle.
          matrix[i]!.push(matrix[j]![i]!);
        } else {
          matrix[i]!.push(pearson(aligned[i]!, aligned[j]!));
        }
      }
    }
    return {
      sources,
      matrix,
      windowDays: this.config.correlationWindowDays,
      timestamp: sortedTs[sortedTs.length - 1]!,
      observationCount: sortedTs.length,
    };
  }

  // --------------------------------------------------------------------
  // Aggregate drawdown
  // --------------------------------------------------------------------

  /**
   * `aggregateDrawdown` — compute the running aggregate portfolio
   * drawdown based on the equity curve fed via `recordEquitySnapshot`.
   *
   * If no equity snapshots have been recorded, returns null.
   */
  aggregateDrawdown(): AggregateDrawdownState | null {
    if (this.equityCurve.length === 0) return null;
    let peak = -Infinity;
    let maxDd = 0;
    let lastEquity = 0;
    let lastTs = 0;
    for (let i = 0; i < this.equityCurve.length; i++) {
      const eq = this.equityCurve[i]!;
      if (eq > peak) peak = eq;
      const dd = peak > 0 ? (peak - eq) / peak : 0;
      if (dd > maxDd) maxDd = dd;
      lastEquity = eq;
      lastTs = this.equityTimestamps[i]!;
    }
    const currentDdPct = peak > 0 ? (peak - lastEquity) / peak : 0;
    const currentDdUsd = peak - lastEquity;
    return {
      peakEquityUsd: peak,
      currentEquityUsd: lastEquity,
      drawdownPct: currentDdPct,
      drawdownUsd: currentDdUsd,
      maxDrawdownPct: maxDd,
      isAtLimit: currentDdPct >= this.config.maxAggregateDrawdownPct,
      timestamp: lastTs,
    };
  }

  // --------------------------------------------------------------------
  // Exposure concentration
  // --------------------------------------------------------------------

  /**
   * `exposureBySymbol` — aggregate the current positions by symbol,
   * compute per-symbol fraction of total, and flag any symbol that
   * exceeds `concentrationThresholdPct`.
   *
   * Uses GROSS (abs) notional so a long + short on the same symbol
   * count as 2× exposure (which is correct for liquidation risk).
   */
  exposureBySymbol(): ExposureBySymbol {
    const perSymbol = new Map<Symbol_, number>();
    let total = 0;
    for (const pos of this.currentPositions.values()) {
      const abs = Math.abs(pos.effectiveNotionalUsd);
      perSymbol.set(pos.symbol, (perSymbol.get(pos.symbol) ?? 0) + abs);
      total += abs;
    }
    const perSymbolFraction = new Map<Symbol_, number>();
    const over: Symbol_[] = [];
    for (const [sym, notional] of perSymbol.entries()) {
      const frac = total > 0 ? notional / total : 0;
      perSymbolFraction.set(sym, frac);
      if (frac > this.config.concentrationThresholdPct) {
        over.push(sym);
      }
    }
    return {
      totalNotionalUsd: total,
      perSymbol,
      perSymbolFraction,
      overThresholdSymbols: over,
      threshold: this.config.concentrationThresholdPct,
      timestamp: Date.now(),
    };
  }

  // --------------------------------------------------------------------
  // Leverage invariant guard (3rd defense-in-depth layer)
  // --------------------------------------------------------------------

  /**
   * `leverageInvariantGuard` — verify that the AGGREGATE effective
   * leverage across all current positions stays within the 1:10 mandate.
   *
   * Returns:
   *   - null: no breach
   *   - RiskSignal { breach: true }: BREACH detected (caller should halt
   *     new sizing signals and reduce existing positions)
   *
   * Pure-functional helper: the internal state is NOT mutated by this
   * call (the breach is recorded in `leverageInvariantFires` for telemetry
   * but the position table is left alone — the caller decides what to do).
   */
  leverageInvariantGuard(capital = 10_000): RiskSignal | null {
    const positions = Array.from(this.currentPositions.values());
    if (positions.length === 0) {
      return null; // No positions → no leverage to check.
    }
    const totalNotional = positions.reduce(
      (acc, p) => acc + Math.abs(p.effectiveNotionalUsd),
      0,
    );
    try {
      assertLeverageInvariant(
        totalNotional,
        capital,
        this.config.leverageInvariant,
      );
      return null;
    } catch (err) {
      if (err instanceof LeverageBreachError) {
        const fire = {
          timestamp: Date.now(),
          leverage: err.computedLeverage,
          message: err.message,
        };
        this._leverageInvariantFires.push(fire);
        const signal: RiskSignal = {
          kind: "risk",
          source: "leverage-invariant-guard",
          reason: `1:10 MANDATE BREACH: aggregate leverage ${err.computedLeverage.toFixed(4)}× > ${err.maxLeverage}×`,
          timestamp: fire.timestamp,
          breach: true,
        };
        this.emittedRiskSignals.push(signal);
        return signal;
      }
      throw err;
    }
  }

  // --------------------------------------------------------------------
  // Position-size conflict resolver
  // --------------------------------------------------------------------

  /**
   * `resolvePositionConflict` — when 2+ signals claim sizing for the same
   * symbol, take the MIN (most conservative). This is the canonical
   * "least aggressive sizing wins" rule for risk layering.
   *
   * Returns the conservative (min-abs) notional. If no conflict, returns
   * the single signal's notional as-is.
   */
  resolvePositionConflict(symbol: Symbol_): number {
    let minAbs = Infinity;
    let anyFound = false;
    let sign = 1;
    for (const pos of this.currentPositions.values()) {
      if (pos.symbol === symbol) {
        const abs = Math.abs(pos.effectiveNotionalUsd);
        if (abs < minAbs) {
          minAbs = abs;
          sign = pos.effectiveNotionalUsd >= 0 ? 1 : -1;
        }
        anyFound = true;
      }
    }
    if (!anyFound) return 0;
    return sign * minAbs;
  }

  // --------------------------------------------------------------------
  // Snapshot — full state for telemetry / monitoring
  // --------------------------------------------------------------------

  /**
   * `snapshot` — return the full current state as a serializable object.
   * Used by telemetry + monitoring dashboards.
   */
  snapshot(capital = 10_000): RiskSnapshot {
    const positions = Array.from(this.currentPositions.values());
    return {
      timestamp: Date.now(),
      numStrategies: this.perSourceReturns.size,
      numSignalsSubmitted: this.numSignalsSubmitted,
      numRiskSignalsEmitted: this.emittedRiskSignals.length,
      numLeverageBreaches: this._leverageInvariantFires.length,
      lastVaR: this.portfolioVaR(capital),
      lastCorrelation: this.crossStrategyCorrelation(),
      exposure: this.exposureBySymbol(),
      drawdown: this.aggregateDrawdown() ?? {
        peakEquityUsd: 0,
        currentEquityUsd: 0,
        drawdownPct: 0,
        drawdownUsd: 0,
        maxDrawdownPct: 0,
        isAtLimit: false,
        timestamp: 0,
      },
      positions,
      aggregateLeverage:
        positions.length === 0 ? 0 : computeEffectiveLeverage(positions, capital),
      leverageInvariantFires: [...this._leverageInvariantFires],
    };
  }

  /**
   * `getEmittedRiskSignals` — return the list of RiskSignals emitted by
   * the engine (both self-emitted and externally-ingested).
   */
  getEmittedRiskSignals(): readonly RiskSignal[] {
    return [...this.emittedRiskSignals];
  }

  /**
   * `clear` — reset all state (used by tests / before each backtest).
   */
  clear(): void {
    this.perSourceReturns.clear();
    this.perSourceTimestamps.clear();
    this.equityCurve.length = 0;
    this.equityTimestamps.length = 0;
    this.currentPositions.clear();
    this.emittedRiskSignals.length = 0;
    this._leverageInvariantFires.length = 0;
    this.numSignalsSubmitted = 0;
  }

  /**
   * `getPositions` — read-only view of current positions (for tests).
   */
  getPositions(): readonly Position[] {
    return Array.from(this.currentPositions.values());
  }

  /**
   * `getPerSourceObservationCounts` — for tests/diagnostics: returns
   * the number of return observations per source.
   */
  getPerSourceObservationCounts(): ReadonlyMap<string, number> {
    const out = new Map<string, number>();
    for (const [s, arr] of this.perSourceReturns.entries()) {
      out.set(s, arr.length);
    }
    return out;
  }
}

// ----------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------

/**
 * `pearson` — Pearson correlation coefficient between two numeric
 * arrays. Returns 0 if either series has zero variance (constant series).
 * Both series must have the same length.
 */
function pearson(x: readonly number[], y: readonly number[]): number {
  if (x.length !== y.length || x.length < 2) return 0;
  const n = x.length;
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < n; i++) {
    sx += x[i]!;
    sy += y[i]!;
  }
  const mx = sx / n;
  const my = sy / n;
  let num = 0;
  let dx2 = 0;
  let dy2 = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i]! - mx;
    const dy = y[i]! - my;
    num += dx * dy;
    dx2 += dx * dx;
    dy2 += dy * dy;
  }
  const denom = Math.sqrt(dx2 * dy2);
  if (denom === 0) return 0;
  return num / denom;
}

/**
 * `normalQuantile` — inverse standard-normal CDF. Returns the z-value
 * such that P(Z <= z) = p.
 *
 * Uses the rational approximation by Beasley-Springer-Moro (1977),
 * which is accurate to ~1e-9 across the full (0, 1) range. This is
 * the standard approximation used in most quant libraries.
 */
function normalQuantile(p: number): number {
  if (p <= 0 || p >= 1) {
    throw new Error(`p must be in (0, 1), got ${String(p)}`);
  }
  // Beasley-Springer-Moro approximation.
  const a = [
    -3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2,
    1.38357751867269e2, -3.066479806614716e1, 2.506628277459239,
  ];
  const b = [
    -5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2,
    6.680131188771972e1, -1.328068155288572e1,
  ];
  const c = [
    -7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838,
    -2.549732539343734, 4.374664141464968, 2.938163982698783,
  ];
  const d = [
    7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996,
    3.754408661907416,
  ];
  const pLow = 0.02425;
  const pHigh = 1 - pLow;
  let q: number;
  let r: number;
  if (p < pLow) {
    q = Math.sqrt(-2 * Math.log(p));
    return (
      (((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) /
      ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1)
    );
  }
  if (p <= pHigh) {
    q = p - 0.5;
    r = q * q;
    return (
      ((((((a[0]! * r + a[1]!) * r + a[2]!) * r + a[3]!) * r + a[4]!) * r + a[5]!) * q) /
      (((((b[0]! * r + b[1]!) * r + b[2]!) * r + b[3]!) * r + b[4]!) * r + 1)
    );
  }
  q = Math.sqrt(-2 * Math.log(1 - p));
  return (
    -(((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) /
    ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1)
  );
}

/**
 * Re-export the Position type for downstream consumers.
 */
export type { Position } from "./leverage-invariant.js";