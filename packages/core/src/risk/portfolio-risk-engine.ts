import {
  assertAggregateEffectiveExposureLimit,
  computeEffectiveLeverage,
  DEFAULT_AGGREGATE_EFFECTIVE_EXPOSURE_LIMIT,
  AggregateEffectiveExposureLimitBreachError,
  type AggregateEffectiveExposureLimit,
  type Position,
} from "./leverage-invariant.js";
import {
  calculateAggregateDrawdown,
  calculateCrossStrategyCorrelation,
  calculateExposureBySymbol,
  calculatePortfolioVaR,
  resolveConservativePositionNotional,
} from "./portfolio-risk-engine-statistics.js";

const StandardError = Error;

export type Symbol_ = string;

export interface DirectionSignal {
  readonly kind: "direction";
  readonly source: string; // strategy plugin name
  readonly symbol: Symbol_;
  readonly side: "long" | "short";
  readonly confidence: number; // 0..1
  readonly effectiveNotionalUsd: number; // signed (long=+, short=-)
  readonly timestamp: number;
}

export interface CarrySignal {
  readonly kind: "carry";
  readonly source: string;
  readonly symbol: Symbol_;
  readonly effectiveNotionalUsd: number; // signed (typically + for "receiving funding")
  readonly timestamp: number;
}

export interface SizingSignal {
  readonly kind: "sizing";
  readonly source: string;
  readonly symbol: Symbol_;
  readonly effectiveNotionalUsd: number; // signed
  readonly leverage: number; // the per-strategy leverage this sizing implies
  readonly timestamp: number;
}

export interface RiskSignal {
  readonly kind: "risk";
  readonly source: string;
  readonly symbol?: Symbol_;
  readonly drawdownLimit?: number;
  readonly varDaily95?: number;
  readonly reason: string;
  readonly timestamp: number;
  // True if this signal represents an actual breach rather than an early warning.
  readonly breach?: boolean;
}

export type Signal = DirectionSignal | CarrySignal | SizingSignal | RiskSignal;

export interface PortfolioRiskEngineConfig {
  readonly confidence: number; // 0..1, e.g. 0.95
  readonly correlationWindowDays: number; // e.g. 30
  readonly concentrationThresholdPct: number; // e.g. 0.40 (40%)
  readonly maxAggregateDrawdownPct: number; // e.g. 0.20 (20%)
  readonly leverageInvariant: AggregateEffectiveExposureLimit;
}

export const DEFAULT_PORTFOLIO_RISK_ENGINE_CONFIG: PortfolioRiskEngineConfig = {
  confidence: 0.95,
  correlationWindowDays: 30,
  concentrationThresholdPct: 0.4,
  maxAggregateDrawdownPct: 0.2,
  leverageInvariant: DEFAULT_AGGREGATE_EFFECTIVE_EXPOSURE_LIMIT,
};

export interface VaRPoint {
  readonly timestamp: number;
  // Daily VaR as a positive number, for example 0.02 for 2% of capital.
  readonly dailyVaR95Pct: number;
  // Daily VaR in USD using capital as the base.
  readonly dailyVaR95Usd: number;
  // Method used for the calculation.
  readonly method: "parametric" | "historical";
  // Number of return observations in the rolling window.
  readonly observations: number;
}

export interface CorrelationMatrix {
  // Strategy names in row and column order.
  readonly sources: readonly string[];
  // A square correlation matrix in the same order as sources.
  readonly matrix: readonly (readonly number[])[];
  // Window in days used to compute the matrix.
  readonly windowDays: number;
  // As-of timestamp.
  readonly timestamp: number;
  // Per-source observation count.
  readonly observationCount: number;
}

export interface ExposureBySymbol {
  readonly totalNotionalUsd: number;
  readonly perSymbol: ReadonlyMap<Symbol_, number>;
  // Per-symbol fraction of total.
  readonly perSymbolFraction: ReadonlyMap<Symbol_, number>;
  // Symbols exceeding the configured concentration threshold.
  readonly overThresholdSymbols: readonly Symbol_[];
  readonly threshold: number;
  readonly timestamp: number;
}

export interface AggregateDrawdownState {
  readonly peakEquityUsd: number;
  readonly currentEquityUsd: number;
  readonly drawdownPct: number; // (peak - current) / peak, positive number
  readonly drawdownUsd: number; // peak - current
  readonly maxDrawdownPct: number; // largest DD seen so far
  readonly isAtLimit: boolean; // drawdownPct >= maxAggregateDrawdownPct
  readonly timestamp: number;
}

export interface RiskSnapshot {
  readonly timestamp: number;
  readonly numStrategies: number;
  readonly numSignalsSubmitted: number;
  readonly numRiskSignalsEmitted: number;
  readonly numLeverageBreaches: number;
  readonly lastVaR: VaRPoint | undefined;
  readonly lastCorrelation: CorrelationMatrix | undefined;
  readonly exposure: ExposureBySymbol;
  readonly drawdown: AggregateDrawdownState;
  readonly positions: readonly Position[];
  readonly aggregateLeverage: number;
  readonly leverageInvariantFires: readonly {
    readonly timestamp: number;
    readonly leverage: number;
    readonly message: string;
  }[];
}

export class PortfolioRiskEngine {
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

  readonly config: PortfolioRiskEngineConfig;

  constructor(config: PortfolioRiskEngineConfig = DEFAULT_PORTFOLIO_RISK_ENGINE_CONFIG) {
    if (!Number.isFinite(config.confidence) || config.confidence <= 0 || config.confidence >= 1) {
      throw new Error(`confidence must be in (0, 1), got ${String(config.confidence)}`);
    }
    if (!Number.isSafeInteger(config.correlationWindowDays) || config.correlationWindowDays <= 0) {
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

  submitSignal(signal: Signal): RiskSignal | undefined {
    this.numSignalsSubmitted += 1;
    if (signal.kind === "risk") {
      // Risk signals are ingested but don't mutate position state.
      this.emittedRiskSignals.push(signal);
      return undefined;
    }
    // sizing / direction / carry all update position table.
    const key = `${signal.source}:${signal.symbol}`;
    const pos: Position = {
      symbol: signal.symbol,
      source: signal.source,
      effectiveNotionalUsd: signal.effectiveNotionalUsd,
    };
    this.currentPositions.set(key, pos);
    const breach = this.leverageInvariantGuard();
    if (breach !== undefined) {
      return breach;
    }
    return undefined;
  }

  recordSourceReturn(source: string, timestamp: number, returnPct: number): void {
    if (!Number.isFinite(returnPct)) {
      throw new StandardError(
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

  recordEquitySnapshot(timestamp: number, equityUsd: number): void {
    if (!Number.isFinite(equityUsd) || equityUsd <= 0) {
      throw new Error(`equityUsd must be positive finite, got ${String(equityUsd)}`);
    }
    this.equityCurve.push(equityUsd);
    this.equityTimestamps.push(timestamp);
  }

  portfolioVaR(capital: number): VaRPoint | undefined {
    if (!Number.isFinite(capital) || capital <= 0) {
      throw new Error(`capital must be positive finite, got ${String(capital)}`);
    }
    const statistics = calculatePortfolioVaR(
      this.perSourceReturns,
      this.perSourceTimestamps,
      this.config.confidence,
      capital,
    );
    if (statistics === undefined) {
      return undefined;
    }
    return {
      timestamp: this.equityTimestamps.at(-1) ?? Date.now(),
      dailyVaR95Pct: statistics.dailyVaR95Pct,
      dailyVaR95Usd: statistics.dailyVaR95Usd,
      method: "parametric",
      observations: statistics.observations,
    };
  }

  crossStrategyCorrelation(): CorrelationMatrix | undefined {
    const statistics = calculateCrossStrategyCorrelation(this.perSourceReturns, this.perSourceTimestamps);
    if (statistics === undefined) {
      return undefined;
    }
    return {
      sources: statistics.sources,
      matrix: statistics.matrix,
      windowDays: this.config.correlationWindowDays,
      timestamp: statistics.timestamp,
      observationCount: statistics.observationCount,
    };
  }

  aggregateDrawdown(): AggregateDrawdownState | undefined {
    return calculateAggregateDrawdown(
      this.equityCurve,
      this.equityTimestamps,
      this.config.maxAggregateDrawdownPct,
    );
  }

  exposureBySymbol(): ExposureBySymbol {
    const statistics = calculateExposureBySymbol(this.getPositions(), this.config.concentrationThresholdPct);
    return {
      totalNotionalUsd: statistics.totalNotionalUsd,
      perSymbol: statistics.perSymbol,
      perSymbolFraction: statistics.perSymbolFraction,
      overThresholdSymbols: statistics.overThresholdSymbols,
      threshold: this.config.concentrationThresholdPct,
      timestamp: Date.now(),
    };
  }

  // --------------------------------------------------------------------
  // Leverage invariant guard (3rd defense-in-depth layer)
  // --------------------------------------------------------------------

  /**
   * `leverageInvariantGuard` — verify that the AGGREGATE effective
   * leverage across all current positions stays within the aggregate effective-exposure limit.
   *
   * Returns:
   *   - undefined: no breach
   *   - RiskSignal { breach: true }: BREACH detected (caller should halt
   *     new sizing signals and reduce existing positions)
   *
   * Pure-functional helper: the internal state is NOT mutated by this
   * call (the breach is recorded in `leverageInvariantFires` for telemetry
   * but the position table is left alone — the caller decides what to do).
   */
  leverageInvariantGuard(capital = 10_000): RiskSignal | undefined {
    const positions = this.getPositions();
    if (positions.length === 0) {
      return undefined;
    }
    const totalNotional = positions.reduce(
      (accumulator, position) => accumulator + Math.abs(position.effectiveNotionalUsd),
      0,
    );
    try {
      assertAggregateEffectiveExposureLimit(totalNotional, capital, this.config.leverageInvariant);
      return undefined;
    } catch (error) {
      if (error instanceof AggregateEffectiveExposureLimitBreachError) {
        const fire = {
          timestamp: Date.now(),
          leverage: error.computedEffectiveLeverage,
          message: error.message,
        };
        this._leverageInvariantFires.push(fire);
        const signal: RiskSignal = {
          kind: "risk",
          source: "leverage-invariant-guard",
          reason: `aggregate effective-exposure limit breach: aggregate effective leverage ${error.computedEffectiveLeverage.toFixed(4)}× > ${String(error.maxAggregateEffectiveLeverage)}×`,
          timestamp: fire.timestamp,
          breach: true,
        };
        this.emittedRiskSignals.push(signal);
        return signal;
      }
      throw error;
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
    return resolveConservativePositionNotional(this.getPositions(), symbol);
  }

  // --------------------------------------------------------------------
  // Snapshot — full state for telemetry / monitoring
  // --------------------------------------------------------------------

  /**
   * `snapshot` — return the full current state as a serializable object.
   * Used by telemetry + monitoring dashboards.
   */
  snapshot(capital = 10_000): RiskSnapshot {
    const positions = this.getPositions();
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
      aggregateLeverage: positions.length === 0 ? 0 : computeEffectiveLeverage(positions, capital),
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
    const positions: Position[] = [];
    this.currentPositions.forEach((position) => {
      positions.push(position);
    });
    return positions;
  }

  /**
   * `getPerSourceObservationCounts` — for tests/diagnostics: returns
   * the number of return observations per source.
   */
  getPerSourceObservationCounts(): ReadonlyMap<string, number> {
    const out = new Map<string, number>();
    for (const [source, returns] of this.perSourceReturns) {
      out.set(source, returns.length);
    }
    return out;
  }
}

/**
 * Re-export the Position type for downstream consumers.
 */
export type { Position } from "./leverage-invariant.js";
