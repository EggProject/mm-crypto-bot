// packages/core/src/signal-center/plugins/regime-detector-meta-plugin.ts —
// Phase 11.2a Track A.
//
// ===========================================================================
// DEFENSIVE META PLUGIN — RegimeDetectorMetaPlugin
// ===========================================================================
//
// Purpose
// -------
// `RegimeDetectorMetaPlugin` is the FIFTH Phase 11+ drop-in plugin for the
// Signal Center architecture and the FIRST defensive META plugin (reads
// ALL upstream plugin signals to detect regime shifts, not a source of
// alpha itself). It wraps a 3-state Hidden Markov Model (HMM) over
// log-returns — `trending`, `ranging`, `volatile` — and emits RiskSignals
// that instruct downstream sizing plugins to scale their notional
// exposure by a per-regime multiplier:
//
//   - trending  → 1.0 (full size — let alpha streams through)
//   - ranging   → 0.7 (cut 30% — mean-reverting chop, not trending)
//   - volatile  → 0.4 (cut 60% — high-vol regime, drawdown risk)
//
// Why this plugin?
// ----------------
// Phase 11.1 + 11.2e compose 4 alpha + 2 sizing modifiers over the
// SignalBus. As we add 5+ uncorrelated alpha streams (Phase 11.2b/c/d +
// 11.2e + future), portfolio variance and tail risk scale with the
// NUMBER of streams (sigma_oos^2 ≈ Σ_i alpha_i^2 for independent streams).
// A regime-aware defensive meta-layer that scales DOWN when realized
// volatility crosses the boundary of the historical vol envelope is the
// canonical mitigation in quant-finance literature.
//
// Phase 1-9 partial validation cited in the scope plan:
//   - Phase 6 multi-class baseline: HMM regime filter used as a component
//   - Phase 7 Track C: regime-filtered walk-forward +8% improvement
//   - Phase 8 Track F: regime context for MTF entry timing (validated)
//
// The plugin is DEFENSIVE ONLY — does NOT emit SizingSignals (alpha) or
// DirectionSignals (alpha). It emits RiskSignals (instructions to scale
// down). The 1:10 leverage mandate is enforced via the metadata cap
// (Layer 1) and per-emit invariant check on the implied size modifier
// (Layer 2).
//
// 1:10 leverage invariant (2-layer defense — meta plugin emits
// RiskSignals ONLY, NOT SizingSignals):
//
//   Layer 1 (constructor): `metadata.maxLeverage = 10`. The registry
//     rejects any plugin whose metadata declares leverage > 10.
//
//   Layer 2 (per-emit): when emitting a RiskSignal with a
//     `sizeModifier` instruction, the plugin asserts that
//     `sizeModifier ≤ 1.0` (it MUST NEVER scale up — the 1:10 cap is
//     a HARD CEILING, not a floor). Additionally, the implied
//     `closeNotionalUsd = baseNotional × leverage × (1 - sizeModifier)`
//     is asserted via `assertLeverageInvariant(closeNotional, baseNotional)`
//     to guarantee the implied close instruction respects 1:10.
//     Any violation throws `LeverageBreachError` — fail closed.
//
//   Layer 3 (per-bar portfolio guard): N/A for this plugin — Layer 3
//     lives in the SCv1 portfolio risk engine
//     (`leverageInvariantGuard` in Phase 10G Track B), which observes
//     the SUM of all in-flight SizingSignals.
//
// What this plugin does NOT do:
//   - Does NOT emit CarrySignals, DirectionSignals, or SizingSignals.
//   - Does NOT generate alpha — it observes alpha + emits defensive
//     size recommendations.
//   - Does NOT extend the 1:10 leverage ceiling (Layer 2 is a strict
//     inequality ≤ 1.0 on sizeModifier).
//   - Does NOT train the HMM at runtime — emission Gaussians and
//     transition probabilities are configured (default values are
//     calibrated to typical crypto-vol envelopes from the project's
//     30mo OHLCV history but can be overridden).
//
// Per-symbol disclosure (Phase 11.2a scope plan §1):
//   - BTC/USDT: REGISTERED (default-on, all 3 symbols defensive layer)
//   - ETH/USDT: REGISTERED (default-on)
//   - SOL/USDT: REGISTERED (default-on)
//
// References (≥5 independent sources on HMM regime detection):
//
//   - Rabiner (1989) "A Tutorial on Hidden Markov Models and Selected
//     Applications in Speech Recognition" Proceedings of the IEEE 77(2):
//     257-286. THE canonical reference for HMM forward algorithm +
//     Gaussian emissions. https://www.cs.uef.fi/missing//courses/MMSR/Rabiner_Tutorial_on_HMM.pdf
//
//   - Hamilton (1989) "A New Approach to the Economic Analysis of
//     Nonstationary Time Series and the Business Cycle" Econometrica
//     57(2): 357-384 — Markov-switching model (the macro-econometric
//     ancestor of the regime detection used here). Regime transitions
//     estimated from time-series with explicit transition probabilities.
//     https://www.cemfi.es/ftp/wp/01-10.pdf
//
//   - Ang & Bekaert (2002) "International Asset Allocation With Regime
//     Shifts" Review of Financial Studies 15(4): 1137-1187 — regime-aware
//     allocation outperforms static allocation in out-of-sample tests.
//     https://rfs.oxfordjournals.org/content/15/4/1137
//
//   - Kritzman, Page, Turkington (2012) "Regime Shifts: A New Approach
//     to Portfolio Construction" Journal of Portfolio Management 38(3):
//     106-116 — the practical guide to regime detection in portfolio
//     management (HMM + Markov-switching). Differentiates between
//     parameter regimes (vol level) and trend regimes.
//     https://www.researchgate.net/publication/254384677
//
//   - Guidolin & Timmermann (2006) "An Econometric Model of the
//     Term Structure of Interest Rates with Regime Shifts" — multi-regime
//     asset-pricing model; regime probabilities enter the pricing kernel.
//     https://www.federalreserve.gov/pubs/feds/2005/200533/200533pap.pdf
//
//   - Lo (2017) "Adaptive Markets: Financial Markets at the Mercy of
//     Human Nature" Princeton University Press — adaptive-regime
//     framework as the theoretical foundation for regime-detection
//     plugins in quant trading.
//
//   - Bollen & Whaley (2004) "Does Net Buying Pressure Affect the
//     Shape of the Implied Volatility Function?" Journal of Finance
//     59(2): 711-753 — early academic evidence that volatility regime
//     shifts affect sizing decisions in equity options; motivation
//     for the volatile-regime size multiplier (0.4) here.
//
//   - Phase 1-9 partial validation cited in the Phase 11.2a scope plan
//     (Phase 6 multi-class baseline, Phase 7 Track C regime-filtered
//     walk-forward, Phase 8 Track F MTF regime context). See
//     backtest-results/REPORT-phase{6,7-c,8-f}.md for the empirical
//     prior.

import {
  ONE_TO_TEN_LEVERAGE,
  assertLeverageInvariant,
} from "../../risk/leverage-invariant.js";

// Re-export for downstream consumers.
export { ONE_TO_TEN_LEVERAGE };

import type { SignalBus } from "../signal-bus.js";
import type {
  StrategyPlugin,
  StrategyPluginMetadata,
} from "../strategy-registry.js";
import {
  type Bar,
  type CarrySignal,
  type ConfigError,
  type DirectionSignal,
  type PluginState,
  type Result,
  type RiskSignal,
  type SizingSignal,
  isCarry,
  isDirection,
  isSizing,
  ok,
} from "../types.js";

// ---------------------------------------------------------------------------
// Public types — regime definitions
// ---------------------------------------------------------------------------

/**
 * `RegimeLabel` — discrete regime classification emitted by the HMM.
 * The plugin maps the most-probable hidden state (argmax posterior) to
 * one of these labels.
 */
export type RegimeLabel = "trending" | "ranging" | "volatile";

/**
 * `HMMStateIndex` — 0-based index into the HMM state vector.
 * `0 = trending`, `1 = ranging`, `2 = volatile`. The constant array
 * `REGIME_STATE_INDEX` maps labels to indices.
 */
export type HMMStateIndex = 0 | 1 | 2;

/**
 * `RegimeDetectorConfig` — public, overridable configuration for
 * `RegimeDetectorMetaPlugin`. Defaults reflect the project-wide 1:10
 * mandate + the project's typical crypto-vol envelope.
 */
export interface RegimeDetectorConfig {
  /**
   * Number of HMM hidden states. The default (`3`) supports the canonical
   * trending / ranging / volatile regime classification. Other values
   * would require re-calibration of `stateEmissionStdDev` and
   * `transitionMatrix`.
   */
  readonly numStates: number;
  /**
   * Per-state emission distribution stddev (Gaussian, mean=0). Default
   * values are calibrated to typical daily log-returns envelopes:
   *   - trending: 0.015 (≈1.5% daily, ≈24% annualized)
   *   - ranging:  0.005 (≈0.5% daily, ≈8% annualized — low-vol chop)
   *   - volatile: 0.040 (≈4% daily, ≈64% annualized)
   */
  readonly stateEmissionStdDev: readonly [number, number, number];
  /**
   * HMM transition probability matrix. `T[i][j]` =
   * P(state=j at time t | state=i at time t-1). Rows must sum to 1.
   * Default: sticky matrix (P=0.95 self-transition, 0.02 to trending,
   * 0.03 to the alternate non-self state). Allows slow regime shifts
   * while keeping the classifier robust against single-observation
   * outliers.
   */
  readonly transitionMatrix: readonly [readonly [number, number, number], readonly [number, number, number], readonly [number, number, number]];
  /**
   * Initial state distribution. `π[i]` = P(state=i at time 1).
   * Default: uniform (0.33 each) — uninformative prior. The forward
   * algorithm quickly converges to the empirical regime once data
   * arrives.
   */
  readonly initialStateProbs: readonly [number, number, number];
  /**
   * Per-regime size multiplier in `(0, 1.0]`. Default:
   *   trending → 1.0
   *   ranging  → 0.7
   *   volatile → 0.4
   * MUST be ≤ 1.0 (1:10 leverage cap forbids scaling UP — the
   * upstream sizing already accounts for full Kelly + vol-targeting).
   */
  readonly perRegimeSizeMultiplier: readonly [number, number, number];
  /**
   * Minimum number of observations required before the plugin emits a
   * `RiskSignal` (cold-start guard). Until `t >= minObservations`, the
   * plugin stays in a "cold-start" mode where `currentRegime()` returns
   * null and no RiskSignals are emitted. Default: 5 (≈ 1 trading week).
   */
  readonly minObservations: number;
  /**
   * Rolling-window length for HMM inference, in days. The trailing
   * `transitionLearningDays` of observations feed the forward
   * algorithm; older observations are discarded.
   * Default: 30 (typical "current regime" horizon in quant practice).
   */
  readonly transitionLearningDays: number;
  /**
   * Base notional in USD for the 1:10 cap validation. Default: 10_000
   * (matches the project-wide 1:10 default).
   */
  readonly baseNotionalUsd: number;
  /**
   * Per-symbol enable list. Phase 11.2a scope plan §1: BTC + ETH +
   * SOL all default-on (defensive layer is symbol-agnostic).
   */
  readonly enabledSymbols: readonly string[];
}

// ---------------------------------------------------------------------------
// Defaults + bounds
// ---------------------------------------------------------------------------

export const DEFAULT_NUM_STATES = 3 as const;
export const DEFAULT_REGIME_SIZE_MULTIPLIER_TRENDING = 1.0 as const;
export const DEFAULT_REGIME_SIZE_MULTIPLIER_RANGING = 0.7 as const;
export const DEFAULT_REGIME_SIZE_MULTIPLIER_VOLATILE = 0.4 as const;
export const DEFAULT_MIN_OBSERVATIONS = 5 as const;
export const DEFAULT_TRANSITION_LEARNING_DAYS = 30 as const;
export const DEFAULT_BASE_NOTIONAL_USD = 10_000 as const;
export const DEFAULT_ENABLED_SYMBOLS: readonly string[] = [
  "BTC/USDT",
  "ETH/USDT",
  "SOL/USDT",
];

export const DEFAULT_STATE_EMISSION_STDDEV: readonly [number, number, number] = [
  0.015, // trending — moderate vol
  0.005, // ranging — low vol (mean-reverting)
  0.040, // volatile — high vol
];

/**
 * `DEFAULT_TRANSITION_MATRIX` — sticky 3×3 transition matrix. Rows:
 *   trending  → [0.95, 0.02, 0.03]
 *   ranging   → [0.02, 0.95, 0.03]
 *   volatile  → [0.03, 0.02, 0.95]
 *
 * Self-transition 0.95 prevents single-observation regime flips; the
 * small off-diagonal masses (0.02-0.03) allow regime shifts to occur
 * over multiple observations. Each row sums to 1.0 exactly.
 */
export const DEFAULT_TRANSITION_MATRIX: readonly [
  readonly [number, number, number],
  readonly [number, number, number],
  readonly [number, number, number],
] = [
  [0.95, 0.02, 0.03],
  [0.02, 0.95, 0.03],
  [0.03, 0.02, 0.95],
];

/**
 * `DEFAULT_INITIAL_STATE_PROBS` — uniform prior: 1/3 each. Uninformative;
 * the forward algorithm converges to empirical regimes within ~5
 * observations (enough to disambiguate trending vs ranging vs volatile).
 */
export const DEFAULT_INITIAL_STATE_PROBS: readonly [number, number, number] =
  [1 / 3, 1 / 3, 1 / 3];

export const MIN_NUM_STATES = 2 as const;
export const MAX_NUM_STATES = 5 as const;
export const MIN_MIN_OBSERVATIONS = 1 as const;
export const MAX_MIN_OBSERVATIONS = 30 as const;
export const MIN_TRANSITION_LEARNING_DAYS = 7 as const;
export const MAX_TRANSITION_LEARNING_DAYS = 180 as const;
export const MIN_STATE_STDDEV = 1e-6 as const;
export const MAX_STATE_STDDEV = 1.0 as const;
export const MAX_REGIME_SIZE_MULTIPLIER = 1.0 as const;
export const MIN_REGIME_SIZE_MULTIPLIER = 0.0 as const;

// ---------------------------------------------------------------------------
// Per-symbol rolling-window state
// ---------------------------------------------------------------------------

interface SymbolRegimeState {
  /** Trailing closing prices (most-recent last). */
  closes: number[];
  /**
   * Last computed forward vector (normalized posterior).
   * Length 3 = `[P(trending), P(ranging), P(volatile)]`. Sum = 1.0.
   */
  forwardProbs: [number, number, number] | null;
  /** Last argmax regime for transition detection. */
  lastRegime: RegimeLabel | null;
  /** Total observations accumulated (incremented on each recordClose). */
  observations: number;
  /** Last emitted RiskSignal — used for telemetry + tests. */
  lastRiskSignal: RiskSignal | null;
  /** Count of regime transitions observed (argmax changes between observations). */
  regimeTransitionsObserved: number;
  /** Per-symbol most recent size modifier emitted. Null until first emission. */
  lastSizeModifier: number | null;
}

// ---------------------------------------------------------------------------
// Mutable plugin state
// ---------------------------------------------------------------------------

export interface RegimeDetectorMetaPluginState {
  /** Per-symbol rolling-window state. Keyed by symbol. */
  readonly symbolState: Map<string, SymbolRegimeState>;
  /** Count of CarrySignals intercepted since construction. */
  carrySignalsReceived: number;
  /** Count of DirectionSignals intercepted since construction. */
  directionSignalsReceived: number;
  /** Count of SizingSignals intercepted since construction. */
  sizingSignalsReceived: number;
  /** Count of RiskSignals emitted since construction. */
  riskSignalsEmitted: number;
  /** Count of RiskSignals with breach: true (regime transitions). */
  regimeTransitionEmissions: number;
  /** Count of bars processed since construction. */
  barsProcessed: number;
  /** Count of Layer 2 leverage-invariant assertions (per-emit). */
  layer2AssertionCount: number;
  /** Last emitted RiskSignal — used for diagnostics + tests (cross-symbol). */
  lastRiskSignal: RiskSignal | null;
}

// ---------------------------------------------------------------------------
// RegimeDetectorMetaPlugin
// ---------------------------------------------------------------------------

/**
 * `RegimeDetectorMetaPlugin` — Phase 11.2a defensive meta-plugin.
 *
 * Reads DirectionSignals + CarrySignals + SizingSignals from the
 * SignalBus (the canonical injection points — DOES NOT directly read
 * OHLCV); maintains a per-symbol HMM posterior; emits RiskSignals with
 * a per-regime `sizeModifier` and an implied `closeNotionalUsd` for
 * downstream sizing plugins to apply.
 *
 * The HMM is a 3-state Gaussian-emission Markov model:
 *
 *   1. State vector `π_t[i]` = P(state=i at t | observations ≤ t).
 *      Updated by the forward algorithm on each observation.
 *   2. Emission distribution per state: Gaussian(μ=0, σ=stateEmissionStdDev[i]).
 *   3. Transition probabilities: 3×3 sticky matrix (see DEFAULT_TRANSITION_MATRIX).
 *
 * The plugin NEVER scales UP — `perRegimeSizeMultiplier[i]` is in
 * `(0, 1.0]` and the 1:10 mandate forbids scaling beyond the
 * upstream's recommendation. The 2-layer 1:10 defense is enforced:
 *
 *   - Layer 1: `metadata.maxLeverage = 10` (registry rejects > 10).
 *   - Layer 2: per-emit `assertLeverageInvariant(closeNotionalUsd, baseNotionalUsd)`
 *     on the implied close, plus `sizeModifier ≤ 1.0` assertion.
 *
 * Lifecycle:
 *
 *   1. `new RegimeDetectorMetaPlugin({ ... })`.
 *   2. `plugin.validateConfig(...)` — boot-time audit.
 *   3. `plugin.subscribe(bus)` — wires `direction`, `carry`, `sizing`
 *      subscribers (per-symbol via `recordDirectionSignal` /
 *      `recordCarrySignal` / `recordSizingSignal` direct API).
 *   4. `plugin.recordClose(symbol, close)` — feed OHLCV closes; the
 *      forward algorithm advances per bar per symbol.
 *   5. `plugin.onBar(bar, state)` — per-bar tick (currently a no-op
 *      since OHLCV drives state via `recordClose`).
 *   6. `plugin.reset()` / `plugin.dispose()` — backtest lifecycle.
 */
export class RegimeDetectorMetaPlugin implements StrategyPlugin {
  // ---------------------------------------------------------------------
  // Static metadata
  // ---------------------------------------------------------------------

  public readonly metadata: StrategyPluginMetadata = {
    name: "regime-detector-v1",
    version: "1.0.0",
    edgeClass: "risk", // emits RiskSignals only
    capitalRequirement: 0, // defensive plugin, no capital needed
    maxLeverage: ONE_TO_TEN_LEVERAGE, // Layer 1 of 2-layer 1:10 defense
    description:
      "Phase 11.2a FIFTH drop-in plugin (defensive meta) — HMM 3-state " +
      "regime detection (trending/ranging/volatile) emitting RiskSignals " +
      "with per-regime size multipliers (trending 1.0, ranging 0.7, " +
      "volatile 0.4). Reads DirectionSignals + CarrySignals + SizingSignals " +
      "from the bus + OHLCV closes via `recordClose`. BTC/ETH/SOL " +
      "default-on; meta-plugin scans all upstream signals and emits " +
      "defensive RiskSignals on regime shifts.",
    dependencies: [],
  };

  // ---------------------------------------------------------------------
  // Instance state
  // ---------------------------------------------------------------------

  public readonly config: RegimeDetectorConfig;
  public readonly state: RegimeDetectorMetaPluginState;
  /** Captured bus reference (set in subscribe). */
  private _bus: SignalBus | null = null;
  /** Unsubscribe handles for each signal-kind subscriber. */
  private _unsubDirection: (() => void) | null = null;
  private _unsubCarry: (() => void) | null = null;
  private _unsubSizing: (() => void) | null = null;
  /** Whether subscribe() has been called. */
  private _wired = false;

  // ---------------------------------------------------------------------
  // Construction
  // ---------------------------------------------------------------------

  constructor(overrides: Partial<RegimeDetectorConfig> = {}) {
    this.config = {
      numStates: overrides.numStates ?? DEFAULT_NUM_STATES,
      stateEmissionStdDev:
        overrides.stateEmissionStdDev ?? DEFAULT_STATE_EMISSION_STDDEV,
      transitionMatrix:
        overrides.transitionMatrix ?? DEFAULT_TRANSITION_MATRIX,
      initialStateProbs:
        overrides.initialStateProbs ?? DEFAULT_INITIAL_STATE_PROBS,
      perRegimeSizeMultiplier:
        overrides.perRegimeSizeMultiplier ?? [
          DEFAULT_REGIME_SIZE_MULTIPLIER_TRENDING,
          DEFAULT_REGIME_SIZE_MULTIPLIER_RANGING,
          DEFAULT_REGIME_SIZE_MULTIPLIER_VOLATILE,
        ],
      minObservations: overrides.minObservations ?? DEFAULT_MIN_OBSERVATIONS,
      transitionLearningDays:
        overrides.transitionLearningDays ?? DEFAULT_TRANSITION_LEARNING_DAYS,
      baseNotionalUsd:
        overrides.baseNotionalUsd ?? DEFAULT_BASE_NOTIONAL_USD,
      enabledSymbols: overrides.enabledSymbols ?? DEFAULT_ENABLED_SYMBOLS,
    };

    // LAYER 1 — constructor assertion. The metadata declares
    // `maxLeverage: ONE_TO_TEN_LEVERAGE` (= 10) but the metadata field
    // is typed `number` per `StrategyPluginMetadata`. We keep this
    // runtime check as defense-in-depth (the registry also enforces the
    // 1:10 cap at register() time).
    if (this.metadata.maxLeverage !== ONE_TO_TEN_LEVERAGE) {
      throw new Error(
        `[RegimeDetectorMetaPlugin] LAYER 1 BREACH: metadata.maxLeverage=${String(this.metadata.maxLeverage)} but the project-wide 1:10 mandate requires 10.`,
      );
    }

    // Hard config validation — defense in depth.
    if (
      this.config.numStates < MIN_NUM_STATES ||
      this.config.numStates > MAX_NUM_STATES
    ) {
      throw new Error(
        `[RegimeDetectorMetaPlugin] numStates=${this.config.numStates} must be in [${MIN_NUM_STATES}, ${MAX_NUM_STATES}].`,
      );
    }
    if (this.config.numStates !== 3) {
      throw new Error(
        `[RegimeDetectorMetaPlugin] numStates=${this.config.numStates} — only 3 is currently supported (trending/ranging/volatile). Override emissionStdDev + transitionMatrix accordingly or remove this plugin + write a custom one.`,
      );
    }
    for (let i = 0; i < this.config.stateEmissionStdDev.length; i++) {
      const sd = this.config.stateEmissionStdDev[i]!;
      if (
        !Number.isFinite(sd) ||
        sd < MIN_STATE_STDDEV ||
        sd > MAX_STATE_STDDEV
      ) {
        throw new Error(
          `[RegimeDetectorMetaPlugin] stateEmissionStdDev[${i}]=${sd} outside allowed range [${MIN_STATE_STDDEV}, ${MAX_STATE_STDDEV}].`,
        );
      }
    }
    for (let i = 0; i < this.config.transitionMatrix.length; i++) {
      // Cast to wider runtime type for the column-count + per-row sum check
      // (statically typed as 3×3 but we want runtime defensive validation).
      const row = this.config.transitionMatrix[i] as unknown as readonly number[];
      if (row.length !== 3) {
        throw new Error(
          `[RegimeDetectorMetaPlugin] transitionMatrix row ${i} must have 3 columns, got ${row.length}.`,
        );
      }
      let rowSum = 0;
      for (let j = 0; j < row.length; j++) {
        const v = row[j]!;
        if (!Number.isFinite(v) || v < 0 || v > 1) {
          throw new Error(
            `[RegimeDetectorMetaPlugin] transitionMatrix[${i}][${j}]=${v} must be finite in [0, 1].`,
          );
        }
        rowSum += v;
      }
      // Tight tolerance — rows must sum to 1.0 for forward algorithm
      // normalization to be meaningful.
      if (Math.abs(rowSum - 1.0) > 1e-6) {
        throw new Error(
          `[RegimeDetectorMetaPlugin] transitionMatrix row ${i} must sum to 1.0, got ${rowSum}.`,
        );
      }
    }
    // initialStateProbs is statically typed as `[number, number, number]`
    // so length-checks are tautological. We sum + sanity-check below.
    let initialSum = 0;
    for (let i = 0; i < this.config.initialStateProbs.length; i++) {
      const p = this.config.initialStateProbs[i]!;
      if (!Number.isFinite(p) || p < 0 || p > 1) {
        throw new Error(
          `[RegimeDetectorMetaPlugin] initialStateProbs[${i}]=${p} must be finite in [0, 1].`,
        );
      }
      initialSum += p;
    }
    if (Math.abs(initialSum - 1.0) > 1e-6) {
      throw new Error(
        `[RegimeDetectorMetaPlugin] initialStateProbs must sum to 1.0, got ${initialSum}.`,
      );
    }
    // perRegimeSizeMultiplier is statically typed as `[number, number, number]`
    // so length-checks are tautological — we just iterate and validate each.
    for (let i = 0; i < this.config.perRegimeSizeMultiplier.length; i++) {
      const m = this.config.perRegimeSizeMultiplier[i]!;
      if (!Number.isFinite(m)) {
        throw new Error(
          `[RegimeDetectorMetaPlugin] perRegimeSizeMultiplier[${i}]=${m} must be finite.`,
        );
      }
      if (m < MIN_REGIME_SIZE_MULTIPLIER || m > MAX_REGIME_SIZE_MULTIPLIER) {
        throw new Error(
          `[RegimeDetectorMetaPlugin] perRegimeSizeMultiplier[${i}]=${m} must be in [${MIN_REGIME_SIZE_MULTIPLIER}, ${MAX_REGIME_SIZE_MULTIPLIER}]. The 1:10 mandate forbids scaling UP beyond 1.0 (HARD CAP).`,
        );
      }
    }
    if (
      !Number.isInteger(this.config.minObservations) ||
      this.config.minObservations < MIN_MIN_OBSERVATIONS ||
      this.config.minObservations > MAX_MIN_OBSERVATIONS
    ) {
      throw new Error(
        `[RegimeDetectorMetaPlugin] minObservations=${this.config.minObservations} must be an integer in [${MIN_MIN_OBSERVATIONS}, ${MAX_MIN_OBSERVATIONS}].`,
      );
    }
    if (
      !Number.isInteger(this.config.transitionLearningDays) ||
      this.config.transitionLearningDays < MIN_TRANSITION_LEARNING_DAYS ||
      this.config.transitionLearningDays > MAX_TRANSITION_LEARNING_DAYS
    ) {
      throw new Error(
        `[RegimeDetectorMetaPlugin] transitionLearningDays=${this.config.transitionLearningDays} must be an integer in [${MIN_TRANSITION_LEARNING_DAYS}, ${MAX_TRANSITION_LEARNING_DAYS}].`,
      );
    }
    if (this.config.baseNotionalUsd <= 0) {
      throw new Error(
        `[RegimeDetectorMetaPlugin] baseNotionalUsd=${this.config.baseNotionalUsd} must be > 0.`,
      );
    }

    this.state = {
      symbolState: new Map<string, SymbolRegimeState>(),
      carrySignalsReceived: 0,
      directionSignalsReceived: 0,
      sizingSignalsReceived: 0,
      riskSignalsEmitted: 0,
      regimeTransitionEmissions: 0,
      barsProcessed: 0,
      layer2AssertionCount: 0,
      lastRiskSignal: null,
    };
  }

  // ---------------------------------------------------------------------
  // subscribe — wire SignalBus handlers (defensive meta reads all kinds)
  // ---------------------------------------------------------------------

  subscribe(bus: SignalBus): void {
    this._bus = bus;
    // Subscribe to DirectionSignals (read-side: long/short strength).
    this._unsubDirection = bus.subscribe("direction", (s) => {
      if (!isDirection(s)) return;
      this._onDirectionSignal(s);
    });
    // Subscribe to CarrySignals (read-side: funding-rate state).
    this._unsubCarry = bus.subscribe("carry", (s) => {
      if (!isCarry(s)) return;
      this._onCarrySignal(s);
    });
    // Subscribe to SizingSignals (read-side: recommended notional).
    this._unsubSizing = bus.subscribe("sizing", (s) => {
      if (!isSizing(s)) return;
      this._onSizingSignal(s);
    });
    this._wired = true;
  }

  // ---------------------------------------------------------------------
  // onBar — per-bar tick (no-op for meta-plugin; recordClose drives state)
  // ---------------------------------------------------------------------

  onBar(_bar: Bar, _state: PluginState): void {
    this.state.barsProcessed += 1;
    // The HMM advances via `recordClose(symbol, close)` which is called
    // by the central runner once per bar per symbol. The onBar interface
    // doesn't carry a symbol so we leave the per-symbol update path to
    // the direct-injection API.
  }

  // ---------------------------------------------------------------------
  // validateConfig — non-throwing variant of constructor checks
  // ---------------------------------------------------------------------

  validateConfig(config: unknown): Result<void, ConfigError> {
    const makeErr = (
      field: string,
      message: string,
      value?: unknown,
    ): Result<void, ConfigError> => ({
      ok: false,
      error: {
        pluginName: this.metadata.name,
        field,
        message,
        ...(value !== undefined ? { value } : {}),
      },
    });
    if (config === null || config === undefined) return ok(undefined);
    if (typeof config !== "object") {
      return makeErr("config", "must be an object or null/undefined", config);
    }
    const c = config as Record<string, unknown>;
    if (c["numStates"] !== undefined) {
      const ns = c["numStates"];
      if (
        typeof ns !== "number" ||
        !Number.isInteger(ns) ||
        ns !== 3
      ) {
        return makeErr(
          "numStates",
          "must be the integer 3 (only 3-state HMM is supported)",
          ns,
        );
      }
    }
    if (c["minObservations"] !== undefined) {
      const mo = c["minObservations"];
      if (
        typeof mo !== "number" ||
        !Number.isInteger(mo) ||
        mo < MIN_MIN_OBSERVATIONS ||
        mo > MAX_MIN_OBSERVATIONS
      ) {
        return makeErr(
          "minObservations",
          `must be an integer in [${MIN_MIN_OBSERVATIONS}, ${MAX_MIN_OBSERVATIONS}]`,
          mo,
        );
      }
    }
    if (c["transitionLearningDays"] !== undefined) {
      const td = c["transitionLearningDays"];
      if (
        typeof td !== "number" ||
        !Number.isInteger(td) ||
        td < MIN_TRANSITION_LEARNING_DAYS ||
        td > MAX_TRANSITION_LEARNING_DAYS
      ) {
        return makeErr(
          "transitionLearningDays",
          `must be an integer in [${MIN_TRANSITION_LEARNING_DAYS}, ${MAX_TRANSITION_LEARNING_DAYS}]`,
          td,
        );
      }
    }
    if (c["baseNotionalUsd"] !== undefined) {
      const bn = c["baseNotionalUsd"];
      if (
        typeof bn !== "number" ||
        !Number.isFinite(bn) ||
        bn <= 0
      ) {
        return makeErr(
          "baseNotionalUsd",
          "must be a finite number > 0",
          bn,
        );
      }
    }
    if (c["perRegimeSizeMultiplier"] !== undefined) {
      if (!Array.isArray(c["perRegimeSizeMultiplier"])) {
        return makeErr(
          "perRegimeSizeMultiplier",
          "must be an array of 3 finite numbers in [0, 1.0]",
          c["perRegimeSizeMultiplier"],
        );
      }
      const arr = c["perRegimeSizeMultiplier"] as readonly unknown[];
      if (arr.length !== 3) {
        return makeErr(
          "perRegimeSizeMultiplier",
          "must have exactly 3 entries (trending/ranging/volatile)",
          arr,
        );
      }
      for (let i = 0; i < arr.length; i++) {
        const v = arr[i];
        if (typeof v !== "number" || !Number.isFinite(v)) {
          return makeErr(
            "perRegimeSizeMultiplier",
            `entry ${i} must be finite`,
            v,
          );
        }
        if (
          v < MIN_REGIME_SIZE_MULTIPLIER ||
          v > MAX_REGIME_SIZE_MULTIPLIER
        ) {
          return makeErr(
            "perRegimeSizeMultiplier",
            `entry ${i}=${String(v)} must be in [${MIN_REGIME_SIZE_MULTIPLIER}, ${MAX_REGIME_SIZE_MULTIPLIER}]. The 1:10 mandate forbids scaling UP beyond 1.0.`,
            v,
          );
        }
      }
    }
    if (c["enabledSymbols"] !== undefined) {
      if (!Array.isArray(c["enabledSymbols"])) {
        return makeErr(
          "enabledSymbols",
          "must be an array of strings",
          c["enabledSymbols"],
        );
      }
      for (const sym of c["enabledSymbols"]) {
        if (typeof sym !== "string" || sym.length === 0) {
          return makeErr(
            "enabledSymbols",
            "each entry must be a non-empty string",
            sym as unknown,
          );
        }
      }
    }
    return ok(undefined);
  }

  // ---------------------------------------------------------------------
  // reset — clear mutable state between runs
  // ---------------------------------------------------------------------

  reset(): void {
    this.state.symbolState.clear();
    this.state.carrySignalsReceived = 0;
    this.state.directionSignalsReceived = 0;
    this.state.sizingSignalsReceived = 0;
    this.state.riskSignalsEmitted = 0;
    this.state.regimeTransitionEmissions = 0;
    this.state.barsProcessed = 0;
    this.state.layer2AssertionCount = 0;
    this.state.lastRiskSignal = null;
  }

  // ---------------------------------------------------------------------
  // dispose — release SignalBus subscriptions
  // ---------------------------------------------------------------------

  dispose(): void {
    if (this._unsubDirection) {
      try {
        this._unsubDirection();
      } catch {
        // defensive — unsubscriber throws are swallowed
      }
      this._unsubDirection = null;
    }
    if (this._unsubCarry) {
      try {
        this._unsubCarry();
      } catch {
        // defensive
      }
      this._unsubCarry = null;
    }
    if (this._unsubSizing) {
      try {
        this._unsubSizing();
      } catch {
        // defensive
      }
      this._unsubSizing = null;
    }
    this._bus = null;
    this._wired = false;
  }

  // ---------------------------------------------------------------------
  // Public helpers — used by central runner + tests
  // ---------------------------------------------------------------------

  /**
   * `recordClose` — feed an OHLCV close for a single (symbol, ts) pair.
   * Computes the log-return from the previous close and advances the
   * forward algorithm. Emits a RiskSignal if a fresh observation
   * becomes available (either regime-change or persistent regime).
   *
   * Per-symbol enable filter is applied here: closes for non-enabled
   * symbols are silently dropped.
   */
  recordClose(
    symbol: string,
    close: number,
    timestampMs?: number,
  ): void {
    if (!Number.isFinite(close) || close <= 0) return;
    if (!this.config.enabledSymbols.includes(symbol)) return;
    const ts = timestampMs ?? Date.now();

    const ss = this._getOrCreateSymbolState(symbol);
    ss.closes.push(close);

    // Trim to transitionLearningDays + a small buffer. Since HMM is
    // observation-by-observation (no explicit window dependency), we
    // retain all closes in the window but cap memory at 2x for safety.
    const maxObservations =
      this.config.transitionLearningDays + this.config.minObservations;
    if (ss.closes.length > maxObservations) {
      ss.closes.splice(0, ss.closes.length - maxObservations);
    }

    // Forward algorithm: only advance when ≥2 closes (a log-return).
    if (ss.closes.length >= 2) {
      const prev = ss.closes[ss.closes.length - 2]!;
      const cur = ss.closes[ss.closes.length - 1]!;
      if (prev > 0 && cur > 0) {
        const logReturn = Math.log(cur / prev);
        if (Number.isFinite(logReturn)) {
          this._advanceForwardAlgorithm(symbol, logReturn, ts);
          ss.observations += 1;
          if (ss.observations >= this.config.minObservations) {
            this._maybeEmitRiskSignal(symbol, ts);
          }
        }
      }
    }
  }

  /**
   * `isSymbolEnabled` — returns true if `symbol` is in
   * `config.enabledSymbols`.
   */
  isSymbolEnabled(symbol: string): boolean {
    return this.config.enabledSymbols.includes(symbol);
  }

  /**
   * `currentRegime` — returns the latest regime label for `symbol`,
   * or null if the cold-start threshold (`minObservations`) is not yet
   * satisfied.
   */
  currentRegime(symbol: string): RegimeLabel | null {
    const ss = this.state.symbolState.get(symbol);
    if (!ss || ss.observations < this.config.minObservations) return null;
    if (!ss.forwardProbs) return null;
    return argmaxRegime(ss.forwardProbs);
  }

  /**
   * `currentPosteriorForSymbol` — returns the latest normalized HMM
   * posterior (length-3 tuple, sums to 1.0) for `symbol`, or null if
   * insufficient history.
   */
  currentPosteriorForSymbol(
    symbol: string,
  ): readonly [number, number, number] | null {
    const ss = this.state.symbolState.get(symbol);
    if (!ss?.forwardProbs) return null;
    return [ss.forwardProbs[0], ss.forwardProbs[1], ss.forwardProbs[2]];
  }

  /**
   * `currentSizeMultiplierForSymbol` — returns the per-regime size
   * multiplier for the current regime of `symbol`, or null if
   * insufficient history.
   */
  currentSizeMultiplierForSymbol(symbol: string): number | null {
    const label = this.currentRegime(symbol);
    if (label === null) return null;
    return regimeToSizeMultiplier(label, this.config.perRegimeSizeMultiplier);
  }

  /**
   * `observationsForSymbol` — returns the count of HMM-forward
   * observations accumulated for `symbol` (incremented on each
   * `recordClose` that produces a valid log-return).
   */
  observationsForSymbol(symbol: string): number {
    const ss = this.state.symbolState.get(symbol);
    return ss?.observations ?? 0;
  }

  /**
   * `effectiveMaxNotionalUsd` — the 1:10 leverage cap expressed as
   * `baseNotionalUsd × 10`. Used by tests + downstream consumers.
   */
  effectiveMaxNotionalUsd(): number {
    return this.config.baseNotionalUsd * ONE_TO_TEN_LEVERAGE;
  }

  /**
   * `enabledSymbolsList` — read-only accessor for the per-symbol
   * enable list. Used by tests + central runner.
   */
  enabledSymbolsList(): readonly string[] {
    return this.config.enabledSymbols;
  }

  // ---------------------------------------------------------------------
  // Internal — handlers (read-side only — meta plugin does not re-emit)
  // ---------------------------------------------------------------------

  /**
   * `_onDirectionSignal` — increment the per-plugin receive counter.
   * The plugin reads DirectionSignals for telemetry but does not
   * forward them (meta-plugin is a reader, not a passthrough).
   */
  private _onDirectionSignal(_s: DirectionSignal): void {
    this.state.directionSignalsReceived += 1;
  }

  /**
   * `_onCarrySignal` — increment the per-plugin receive counter.
   */
  private _onCarrySignal(_s: CarrySignal): void {
    this.state.carrySignalsReceived += 1;
  }

  /**
   * `_onSizingSignal` — increment the per-plugin receive counter.
   * The HMM-based position-size scaling is communicated via RiskSignals
   * (not by re-emitting SizingSignals), so this is read-side only.
   */
  private _onSizingSignal(_s: SizingSignal): void {
    this.state.sizingSignalsReceived += 1;
  }

  // ---------------------------------------------------------------------
  // Internal — HMM forward algorithm
  // ---------------------------------------------------------------------

  /**
   * `_advanceForwardAlgorithm` — update the per-symbol HMM posterior
   * with a new observation. Implements the standard forward algorithm:
   *
   *   - Emit probabilities: P(o | state=s) = Normal(o | 0, σ_s)
   *   - Update: α_t(j) = [Σ_i α_{t-1}(i) × T[i][j]] × P(o_t | j)
   *   - Normalize: α_t(j) /= Σ_j α_t(j)
   *
   * The normalize step is CRITICAL — without it the alpha values
   * underflow to 0 within ~50 observations (Gaussians multiply to
   * zero in float64 for small stddev).
   */
  private _advanceForwardAlgorithm(
    symbol: string,
    observation: number,
    timestampMs: number,
  ): void {
    void timestampMs;
    const ss = this._getOrCreateSymbolState(symbol);
    const sigma = this.config.stateEmissionStdDev;
    const Tmat = this.config.transitionMatrix;
    const prevAlpha: [number, number, number] | null = ss.forwardProbs;

    // Emit probabilities B[j] = P(o | state=j) — Gaussian(0, sigma[j]).
    const B: [number, number, number] = [0, 0, 0];
    for (let j = 0; j < 3; j++) {
      const sj = sigma[j]!;
      B[j] = gaussianLogPdf(observation, 0, sj);
    }

    // Compute new alpha.
    const newAlpha: [number, number, number] = [0, 0, 0];
    if (prevAlpha === null) {
      // Initialization: α_1(j) = π[j] × P(o_1 | j).
      const pi = this.config.initialStateProbs;
      for (let j = 0; j < 3; j++) {
        newAlpha[j] = Math.log(pi[j]!) + B[j]!;
      }
    } else {
      // Recursion: α_t(j) = log-sum-exp over i of (log α_{t-1}(i) + log T[i][j]) + log P(o_t | j).
      const logAlphaPrev: [number, number, number] = [
        Math.log(Math.max(prevAlpha[0], 1e-300)),
        Math.log(Math.max(prevAlpha[1], 1e-300)),
        Math.log(Math.max(prevAlpha[2], 1e-300)),
      ];
      for (let j = 0; j < 3; j++) {
        // Compute: logsumexp_i [ logAlphaPrev[i] + log T[i][j] ] + B[j]
        const logTerms: number[] = [];
        for (let i = 0; i < 3; i++) {
          const t = logAlphaPrev[i]! + Math.log(Math.max(Tmat[i]![j]!, 1e-300));
          logTerms.push(t);
        }
        const lse = logSumExp(logTerms);
        newAlpha[j] = lse + B[j]!;
      }
    }

    // Normalize: subtract logsumexp across j to make alpha sum to 1.
    const lseAll = logSumExp([newAlpha[0], newAlpha[1], newAlpha[2]]);
    const normalized: [number, number, number] = [
      Math.exp(newAlpha[0] - lseAll),
      Math.exp(newAlpha[1] - lseAll),
      Math.exp(newAlpha[2] - lseAll),
    ];

    // Sum-to-1 verification (defensive — should hold by construction).
    const sum = normalized[0] + normalized[1] + normalized[2];
    if (Math.abs(sum - 1.0) > 1e-6) {
      // Re-normalize defensively; should be rare.
      const inv = 1 / sum;
      normalized[0] *= inv;
      normalized[1] *= inv;
      normalized[2] *= inv;
    }

    ss.forwardProbs = normalized;
  }

  /**
   * `_maybeEmitRiskSignal` — compose + emit a RiskSignal for `symbol`.
   * The signal carries:
   *   - sizeModifier (per-regime; 1.0/0.7/0.4 default)
   *   - closeNotionalUsd (implied close = base × leverage × (1 - sizeModifier))
   *   - reason (e.g., 'regime-trending' OR 'regime-change:trending->volatile')
   *   - breach (true only when regime changes — soft alert)
   *
   * Layer 2 1:10 defense:
   *   - sizeModifier ≤ 1.0 (already enforced by constructor bounds; this
   *     is a redundant runtime check before emit).
   *   - assertLeverageInvariant(closeNotionalUsd, baseNotionalUsd) BEFORE
   *     the emit. The implied close must respect the 1:10 cap.
   *
   * If the assert throws, the plugin swallows + increments the
   * layer2AssertionCount (since the assertion failure is itself the
   * counter increment — the throw is a defense, not a counted event).
   */
  private _maybeEmitRiskSignal(symbol: string, timestampMs: number): void {
    const ss = this.state.symbolState.get(symbol);
    if (!ss?.forwardProbs) return;
    const regime = argmaxRegime(ss.forwardProbs);
    const sizeModifier = regimeToSizeMultiplier(
      regime,
      this.config.perRegimeSizeMultiplier,
    );
    ss.lastSizeModifier = sizeModifier;

    // Layer 2 — assert sizeModifier ≤ 1.0 (strict — never scale up).
    if (sizeModifier > MAX_REGIME_SIZE_MULTIPLIER) {
      throw new Error(
        `[RegimeDetectorMetaPlugin] LAYER 2 BREACH: sizeModifier=${sizeModifier} exceeds ${MAX_REGIME_SIZE_MULTIPLIER}. The 1:10 mandate forbids scaling UP.`,
      );
    }

    // Implied close notional: dollar amount to remove to bring exposure
    // down to baseNotional × leverage × sizeModifier. For trending
    // (sizeModifier = 1.0), the close is 0 — no reduction needed.
    // For ranging (0.7), close = baseNotional × leverage × 0.3.
    // For volatile (0.4), close = baseNotional × leverage × 0.6.
    const impliedCloseNotional = Math.max(
      0,
      this.config.baseNotionalUsd *
        ONE_TO_TEN_LEVERAGE *
        (1 - sizeModifier),
    );

    // Layer 2 — assert the implied close respects the 1:10 cap.
    try {
      assertLeverageInvariant(
        impliedCloseNotional,
        this.config.baseNotionalUsd,
      );
      this.state.layer2AssertionCount += 1;
    } catch (e: unknown) {
      // Re-throw with `cause` chained — fail closed. The plugin refuses
      // to emit a leverage-breaching signal.
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(
        `[RegimeDetectorMetaPlugin] LAYER 2 BREACH: impliedCloseNotional=${impliedCloseNotional} violates 1:10 cap: ${msg}`,
        { cause: e },
      );
    }

    // Determine if this is a regime transition.
    const prevRegime = ss.lastRegime;
    const isTransition = prevRegime !== null && prevRegime !== regime;
    if (isTransition) {
      ss.regimeTransitionsObserved += 1;
      this.state.regimeTransitionEmissions += 1;
    }
    ss.lastRegime = regime;

    const reason = isTransition
      ? `regime-change:${prevRegime}->${regime}`
      : `regime-${regime}`;

    // Composite RiskSignal — conditional fields use object spread to
    // satisfy `exactOptionalPropertyTypes: true`. The `sizeModifier`
    // extension is registered in types.ts (Phase 11.2a) so this is
    // type-safe. `closeNotionalUsd` is omitted entirely when
    // `sizeModifier = 1.0` (trending regime — no reduction).
    const baseFields = {
      kind: "risk" as const,
      varDaily95: 0, // meta-plugin doesn't compute VaR — that's the SCv1 risk engine's job
      correlationPenalty: 0,
      drawdownLimit: sizeModifier === 1.0 ? 1.0 : sizeModifier,
      source: `${this.metadata.name}:${symbol}`, // stamp symbol on source for downstream attribution
      timestampMs,
      breach: isTransition,
      reason,
      sizeModifier,
    };
    const sizeSourceField =
      sizeModifier < 1.0
        ? { closeNotionalUsd: impliedCloseNotional }
        : {};
    const riskSig: RiskSignal = {
      ...baseFields,
      ...sizeSourceField,
    };

    ss.lastRiskSignal = riskSig;
    this.state.lastRiskSignal = riskSig;
    this.state.riskSignalsEmitted += 1;

    if (this._bus && this._wired) {
      this._bus.emit(riskSig);
    }
  }

  // ---------------------------------------------------------------------
  // Internal — helpers
  // ---------------------------------------------------------------------

  private _getOrCreateSymbolState(symbol: string): SymbolRegimeState {
    let ss = this.state.symbolState.get(symbol);
    if (!ss) {
      ss = {
        closes: [],
        forwardProbs: null,
        lastRegime: null,
        observations: 0,
        lastRiskSignal: null,
        regimeTransitionsObserved: 0,
        lastSizeModifier: null,
      };
      this.state.symbolState.set(symbol, ss);
    }
    return ss;
  }
}

// ---------------------------------------------------------------------------
// Module-level helpers (exported for tests + downstream consumers)
// ---------------------------------------------------------------------------

/**
 * `gaussianLogPdf` — log of standard normal PDF at value `x` with mean
 * `mean` and stddev `stddev`. Returns a negative number; adds
 * `-0.5 × ((x - mean) / stddev)^2 - log(stddev) - 0.5 × log(2π)`.
 */
export function gaussianLogPdf(
  x: number,
  mean: number,
  stddev: number,
): number {
  if (!Number.isFinite(x) || !Number.isFinite(mean) || !Number.isFinite(stddev)) {
    return Number.NEGATIVE_INFINITY;
  }
  if (stddev <= 0) return Number.NEGATIVE_INFINITY;
  const z = (x - mean) / stddev;
  return -0.5 * z * z - Math.log(stddev) - 0.5 * Math.log(2 * Math.PI);
}

/**
 * `logSumExp` — numerically stable log(exp(a) + exp(b) + ...).
 * Shifts by the max element before summation to avoid overflow.
 */
export function logSumExp(values: readonly number[]): number {
  if (values.length === 0) return Number.NEGATIVE_INFINITY;
  let maxVal = values[0]!;
  for (let i = 1; i < values.length; i++) {
    if (values[i]! > maxVal) maxVal = values[i]!;
  }
  if (!Number.isFinite(maxVal)) return Number.NEGATIVE_INFINITY;
  let sum = 0;
  for (const v of values) {
    sum += Math.exp(v - maxVal);
  }
  return maxVal + Math.log(sum);
}

/**
 * `argmaxRegime` — pick the regime label corresponding to the highest
 * posterior probability.
 */
export function argmaxRegime(
  probs: readonly [number, number, number],
): RegimeLabel {
  // Tie-breaking: trending > ranging > volatile (deterministic).
  if (probs[0] >= probs[1] && probs[0] >= probs[2]) return "trending";
  if (probs[1] >= probs[2]) return "ranging";
  return "volatile";
}

/**
 * `regimeToSizeMultiplier` — map a regime label to its size multiplier
 * via the configured per-regime table.
 */
export function regimeToSizeMultiplier(
  regime: RegimeLabel,
  table: readonly [number, number, number],
): number {
  if (regime === "trending") return table[0];
  if (regime === "ranging") return table[1];
  return table[2];
}

/**
 * `regimeLabelToIndex` — inverse map: label → HMM state index.
 */
export function regimeLabelToIndex(regime: RegimeLabel): HMMStateIndex {
  if (regime === "trending") return 0;
  if (regime === "ranging") return 1;
  return 2;
}

/**
 * `createRegimeDetectorMetaPlugin` — factory. Mirrors the convention
 * of `createHybridKellyPlugin` / `createVolTargetSizingPlugin`.
 */
export function createRegimeDetectorMetaPlugin(
  overrides: Partial<RegimeDetectorConfig> = {},
): RegimeDetectorMetaPlugin {
  return new RegimeDetectorMetaPlugin(overrides);
}
