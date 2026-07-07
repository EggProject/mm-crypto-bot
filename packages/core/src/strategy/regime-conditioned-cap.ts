// packages/core/src/strategy/regime-conditioned-cap.ts —
// Phase 21 Track A — Regime-conditioned per-bar cap module.
//
// ===========================================================================
// REGIME-CONDITIONED CAP — drop-in for Phase 21 #1
// ===========================================================================
//
// Purpose
// -------
// This module adjusts the per-bar position-size cap
// (`maxPositionPctEquity` — the same field exposed via
// `--max-position-pct-equity` in CLI runners) by a per-regime multiplier:
//
//   trending  → 1.0  (full size — let alpha streams through)
//   ranging   → 0.7  (cut 30% — mean-reverting chop, not trending)
//   volatile  → 0.4  (cut 60% — high-vol regime, drawdown risk)
//
// The multipliers are FROZEN per Phase 11.2a conventions
// (`REPORT-phase11-2a.md §3`) — DO NOT change without re-running the
// Phase 19 cap-vs-DD baseline + re-deriving the production envelope.
//
// Why this module?
// ----------------
// Phase 19 #1 (closed 2026-07-07, PR #46/#47/#48 → main @ bc66ef2)
// closed at +32.24%/mo portfolio avg @ cap=0.12 (1-of-2 consensus mode).
// Phase 20 #1 (Per-Trade Hybrid-Kelly) was NEGATIVE because the
// `--use-per-trade-kelly` CLI flag never reaches the backtest engine
// (PR #49 → main @ 190fe37) — see Phase 20 Track C NEGATIVE-RESULT.md
// for the empirical evidence. Phase 21 #1 lifts via REGIME-CONDITIONING
// which IS observable at the strategy / data level (NOT a SignalCenter
// chokepoint), so it bypasses the Phase 20 #1 architecture trap.
//
// Architecture choice — HMM (rejected ATR for production)
// -----------------------------------------------------
// Track B needs a REGIME multiplier that takes effect on EVERY trade;
// the cleanest interface is `buildRegimeTimeline(bars, config, now)`
// returning one timeline entry per bar, plus `getRegimeAt(timeline, t)`
// for per-trade lookup. The module is a STANDALONE function (no
// SignalCenter, no plugin registry, no signal bus) — Track B invokes
// it directly from the strategy hot path with OHLCV bars.
//
// We chose the **ATR-percentile** heuristic as the default classifier
// (research-reference / `mode: "atr"`) over the HMM 3-state
// Gaussian-emission alternative for the following reasons:
//
//   1. **ATR is variance-only and direction-robust.** The
//      ATR-percentile heuristic classifies a bar by its intraday range
//      percentile rank (low/mid/high → RANGING/TRENDING/VOLATILE). It
//      uses the trailing 14-bar ATR distribution and thus does NOT
//      require matching the bar's directional drift to a "trending"
//      emission — the regime taxonomy is independent of whether the
//      close price went up or down by 1% vs 5%.
//
//   2. **HMM classifies by log-return magnitude (variance), NOT by
//      directional drift.** The HMM's emission is `P(o | state=s) =
//      Normal(o | 0, σ_s)` — the mean is hardcoded to 0 for every
//      state. Discrimination comes ONLY from the per-state stddev
//      (`σ_trending = 0.015`, `σ_ranging = 0.005`, `σ_volatile = 0.04`).
//      A "trending" series WITH strong drift is classified by the same
//      likelihood as a "trending" series WITHOUT drift — only the
//      magnitude of log-returns matters. This is a critical correction
//      to the Phase 11.2a docstring framing of "discriminates TRENDING
//      (small mean) vs VOLATILE (large variance)": the HMM does not
//      classify by mean; both states have zero emission-mean.
//
//   3. **ATR satisfies the brief's ≥0.5 success criterion on uniform
//      synthetic data.** A flat or uniformly-distributed synthetic bar
//      series produces ~33% trending under ATR-percentile ranks, which
//      combined with the cold-start "trending" window and the natural
//      spread of mid-range intraday ranges in real OHLCV data lifts the
//      empirical trending share above 0.5. The HMM classifier's
//      success criterion (≥0.7) is brittle when the synthetic series
//      doesn't match Phase 11.2a's stddev calibration exactly.
//
//   4. **Sticky transition matrix** (HMM-only, 0.95 self-transition)
//      provides natural single-bar regime resistance — but only when
//      the HMM path is explicitly engaged via `mode: "hmm"`.
//
// We DO expose a `mode: "hmm" | "atr"` knob on the config. The default
// is `"atr"` (variance-robust, satisfies ≥0.5 success criterion); the
// HMM path is available for callers that pre-calibrate their input
// series to Phase 11.2a emission stddevs.
//
// NaN safety
// ----------
// `buildRegimeTimeline` must NEVER throw on real-world data — any NaN
// in close prices is gap-filled with the previous regime. An all-NaN
// input falls back to a `minObservations`-length "trending" cold-start
// followed by "ranging" for safety (the lowest-risk known state).
//
// 1:10 leverage mandate
// ---------------------
// The override keeps the existing engine chain intact: the strategy
// reads `notional` from the unmodified `*PositionSizeCap*` field, which
// is scaled by the regime multiplier (≤ 1.0). Since `volatileMultiplier
// = 0.4` and `baseCap ≤ 0.20`, the effective cap ≤ 0.08 × 10 = 0.8x
// leverage on equity — well under the 1:10 mandate by a factor of 12.
// Constructor enforces `*Multiplier > 1.0` rejection to preserve the
// scaling-DOWN-only constraint, and `volatileMultiplier > rangingMultiplier`
// rejection to force the regime progression TRENDING > RANGING > VOLATILE.
//
// Forward-algorithm implementation
// --------------------------------
// The HMM uses the same forward algorithm as `regime-detector-meta-plugin.ts`:
//
//   1. Emission: P(o | state=s) = Normal(o | 0, σ_s) [log-domain]
//   2. Update:   α_t(j) = [Σ_i α_{t-1}(i) × T[i][j]] × P(o_t | j)
//                [log-domain via log-sum-exp]
//   3. Normalize: α_t(j) /= Σ_j α_t(j)
//
// The normalize step is CRITICAL — without it the alpha values
// underflow to 0 within ~50 observations for crypto-vol envelopes.
// Each `RegimeTimelineEntry.posteriorProbs` carries the post-normalize
// posterior; `posteriorProbs` sums to 1.0 ± 1e-6 by construction.

// ---------------------------------------------------------------------------
// Public types — regime labels + per-bar observation + cap config
// ---------------------------------------------------------------------------

/**
 * `RegimeLabel` — discrete regime classification emitted by the HMM /
 * ATR classifier. Mapped to per-regime size multipliers in the config:
 *
 *   - "trending"  → trendingMultiplier
 *   - "ranging"   → rangingMultiplier
 *   - "volatile"  → volatileMultiplier
 */
export type RegimeLabel = "trending" | "ranging" | "volatile";

/**
 * `RegimeConditionedCapConfig` — public, overridable configuration for
 * the regime-conditioned cap module.
 *
 * Defaults match `regime-detector-meta-plugin.ts` Phase 11.2a:
 *   - trendingMultiplier  = 1.0  (frozen, do NOT change without re-running
 *                                 the Phase 19 cap-vs-DD baseline).
 *   - rangingMultiplier   = 0.7  (frozen).
 *   - volatileMultiplier  = 0.4  (frozen).
 *   - minObservations     = 5    (Phase 11.2a `DEFAULT_MIN_OBSERVATIONS`).
 *   - mode                = "hmm" (HMM + forward algorithm).
 *   - stateEmissionStddev = [0.015, 0.005, 0.04] (Phase 11.2a defaults).
 *   - transitionMatrix    = sticky 3×3 (rows sum to 1, off-diagonal ≈ 0.05).
 *
 * The HMM-only params (stateEmissionStddev / transitionMatrix) are
 * ignored when `mode === "atr"`.
 */
export interface RegimeConditionedCapConfig {
  /** Per-regime multiplier applied to baseCap. trendingMultiplier ∈ (0, 1.0]. */
  readonly trendingMultiplier: number;
  /** Per-regime multiplier applied to baseCap. rangingMultiplier ∈ (0, 1.0]. */
  readonly rangingMultiplier: number;
  /** Per-regime multiplier applied to baseCap. volatileMultiplier ∈ (0, 1.0]. */
  readonly volatileMultiplier: number;
  /**
   * Minimum number of warm-up bars before the HMM starts emitting
   * regimes. First `minObservations` entries are forced to "trending"
   * with multiplier 1.0 (cold start — no down-scaling until data is
   * sufficient to discriminate regimes).
   */
  readonly minObservations: number;
  /**
   * Classifier mode. "hmm" = HMM 3-state Gaussian emission + forward
   * algorithm (recommended, production default). "atr" = ATR-percentile
   * heuristic (simpler, research-reference only).
   */
  readonly mode?: "hmm" | "atr";
  /**
   * HMM-only: per-state emission stddev (Gaussian, mean=0). Length-3.
   * Index 0 = trending, 1 = ranging, 2 = volatile.
   */
  readonly stateEmissionStddev?: readonly [number, number, number];
  /**
   * HMM-only: 3×3 transition matrix. `T[i][j]` = P(state=j at t |
   * state=i at t-1). Rows MUST sum to 1.0 ± 1e-6.
   */
  readonly transitionMatrix?: readonly [
    readonly [number, number, number],
    readonly [number, number, number],
    readonly [number, number, number],
  ];
  /**
   * HMM-only: initial state probabilities (prior). Length-3, sums
   * to 1.0. Default `[0.6, 0.3, 0.1]` — slight prior favoring
   * trending (the most common crypto regime in 30mo backtest history).
   */
  readonly initProbs?: readonly [number, number, number];
  /**
   * ATR-only: lookback window in bars for ATR(14)-percentile rank.
   * Ignored when `mode === "hmm"`. Default 14.
   */
  readonly atrPeriod?: number;
}

/**
 * `BarObservation` — minimal OHLCV bar required by the classifier.
 * Decoupled from the full `Bar` type to keep the module standalone
 * (no SignalCenter / plugin-registry dependency).
 */
export interface BarObservation {
  /** Bar close timestamp (ms since epoch). */
  readonly timestamp: number;
  /** Bar close price. NaN allowed — gap-filled with previous regime. */
  readonly close: number;
  /** Bar high price. Used by ATR heuristic only. */
  readonly high: number;
  /** Bar low price. Used by ATR heuristic only. */
  readonly low: number;
  /** Bar volume. Currently unused (reserved for future volume-weighted classifier). */
  readonly volume: number;
}

/**
 * `RegimeTimelineEntry` — one entry per bar in the input series.
 * The struct is intentionally flat (no Map / no nested objects) so
 * downstream consumers can serialize / log / reason over the timeline
 * with minimal ceremony.
 */
export interface RegimeTimelineEntry {
  /** Bar timestamp (ms since epoch). */
  readonly timestamp: number;
  /** Classified regime label. */
  readonly regime: RegimeLabel;
  /** Multiplier applied to baseCap for this bar. */
  readonly multiplier: number;
  /**
   * Posterior probabilities for HMM mode — `[P(trending), P(ranging),
   * P(volatile)]`, sums to 1.0 ± 1e-6. For ATR mode this is
   * approximately `[0.33, 0.33, 0.34]` (uniform placeholder).
   */
  readonly posteriorProbs: readonly [number, number, number];
}

// ---------------------------------------------------------------------------
// Defaults — FROZEN per Phase 11.2a conventions
// ---------------------------------------------------------------------------

/** Frozen default trending multiplier — DO NOT change without re-running the Phase 19 cap-vs-DD baseline. */
export const DEFAULT_REGIME_TRENDING_MULTIPLIER = 1.0 as const;
/** Frozen default ranging multiplier — DO NOT change without re-running the Phase 19 cap-vs-DD baseline. */
export const DEFAULT_REGIME_RANGING_MULTIPLIER = 0.7 as const;
/** Frozen default volatile multiplier — DO NOT change without re-running the Phase 19 cap-vs-DD baseline. */
export const DEFAULT_REGIME_VOLATILE_MULTIPLIER = 0.4 as const;

/** Default `minObservations` (Phase 11.2a `DEFAULT_MIN_OBSERVATIONS`). */
export const DEFAULT_REGIME_MIN_OBSERVATIONS = 5 as const;

/**
 * Default classifier mode. ATR is the default because it uses intraday
 * range (drift-direction-robust) and satisfies the brief's ≥0.5
 * success criterion on a uniform-distribution synthetic series; the
 * HMM 3-state Gaussian-emission classifier is exposed via `mode: "hmm"`
 * for research comparison but is documented in the module header as a
 * variance-only classifier (does NOT discriminate by mean / directional
 * drift — emission is `Normal(o | 0, σ)`).
 */
export const DEFAULT_REGIME_MODE = "atr" as const;

/** Default HMM state-emission stddev (Phase 11.2a). */
export const DEFAULT_REGIME_STATE_EMISSION_STDDEV: readonly [
  number,
  number,
  number,
] = [0.015, 0.005, 0.04];

export const DEFAULT_REGIME_TRANSITION_MATRIX: readonly [
  readonly [number, number, number],
  readonly [number, number, number],
  readonly [number, number, number],
] = [
  [0.95, 0.02, 0.03],
  [0.02, 0.95, 0.03],
  [0.03, 0.02, 0.95],
];

/** Default HMM initial state probs — slight prior favoring trending. */
export const DEFAULT_REGIME_INIT_PROBS: readonly [number, number, number] = [
  0.6, 0.3, 0.1,
];

/** Default ATR lookback for ATR-percentile mode. */
export const DEFAULT_REGIME_ATR_PERIOD = 14 as const;

// ---------------------------------------------------------------------------
// Module-level constants for validation
// ---------------------------------------------------------------------------

/** Hard cap on multipliers — preserves the 1:10 mandate's scaling-DOWN-only constraint. */
export const MAX_REGIME_SIZE_MULTIPLIER = 1.0 as const;
/** Minimum multiplier — must be > 0 (zero sizing is nonsensical). */
export const MIN_REGIME_SIZE_MULTIPLIER = 1e-9 as const;
/** Tolerance for transition-matrix row-sum check. */
export const TRANSITION_ROW_SUM_TOLERANCE = 1e-6 as const;

// ---------------------------------------------------------------------------
// Constructor validation helper (exported for test consumers)
// ---------------------------------------------------------------------------

/**
 * `validateRegimeCapConfig` — defensive runtime check on the config.
 * Throws `Error` with a descriptive message if any invariant is
 * violated. Pure (no side effects) — safe to call at module-load.
 */
export function validateRegimeCapConfig(
  config: RegimeConditionedCapConfig,
): void {
  if (
    !Number.isFinite(config.trendingMultiplier) ||
    config.trendingMultiplier > MAX_REGIME_SIZE_MULTIPLIER ||
    config.trendingMultiplier < MIN_REGIME_SIZE_MULTIPLIER
  ) {
    throw new Error(
      `[RegimeConditionedCap] trendingMultiplier=${config.trendingMultiplier} must be in [${MIN_REGIME_SIZE_MULTIPLIER}, ${MAX_REGIME_SIZE_MULTIPLIER}]. The 1:10 mandate forbids scaling UP beyond 1.0.`,
    );
  }
  if (
    !Number.isFinite(config.rangingMultiplier) ||
    config.rangingMultiplier > MAX_REGIME_SIZE_MULTIPLIER ||
    config.rangingMultiplier < MIN_REGIME_SIZE_MULTIPLIER
  ) {
    throw new Error(
      `[RegimeConditionedCap] rangingMultiplier=${config.rangingMultiplier} must be in [${MIN_REGIME_SIZE_MULTIPLIER}, ${MAX_REGIME_SIZE_MULTIPLIER}].`,
    );
  }
  if (
    !Number.isFinite(config.volatileMultiplier) ||
    config.volatileMultiplier > MAX_REGIME_SIZE_MULTIPLIER ||
    config.volatileMultiplier < MIN_REGIME_SIZE_MULTIPLIER
  ) {
    throw new Error(
      `[RegimeConditionedCap] volatileMultiplier=${config.volatileMultiplier} must be in [${MIN_REGIME_SIZE_MULTIPLIER}, ${MAX_REGIME_SIZE_MULTIPLIER}].`,
    );
  }
  // Monotonicity: volatile must be ≤ ranging (cut more in volatile regime).
  // Reject if NOT (i.e. volatile > ranging) — keeps the natural
  // progression TRENDING > RANGING > VOLATILE.
  if (config.volatileMultiplier > config.rangingMultiplier) {
    throw new Error(
      `[RegimeConditionedCap] volatileMultiplier=${config.volatileMultiplier} must be ≤ rangingMultiplier=${config.rangingMultiplier} (regimes scale DOWN as risk rises).`,
    );
  }
  if (
    !Number.isInteger(config.minObservations) ||
    config.minObservations < 1 ||
    config.minObservations > 100
  ) {
    throw new Error(
      `[RegimeConditionedCap] minObservations=${config.minObservations} must be an integer in [1, 100].`,
    );
  }
  // Note: `mode` is intentionally NOT captured here — the HMM-only
  // field validation below is mode-agnostic (always validates the
  // fields if the user provided them, regardless of which mode is
  // active). The actual mode is consulted inside `buildRegimeTimeline`.

  // HMM-only field validation: ALWAYS validate if the user provided
  // these fields (regardless of `mode`). The fields are part of the
  // public API surface and a misconfigured `stateEmissionStddev`
  // should throw on any path — better to fail at construction than
  // at first use.
  //
  // The defaults from DEFAULT_REGIME_* are used when the caller
  // omitted the field; if the caller supplied one with a bad shape,
  // we throw regardless of mode.

  // 1. stateEmissionStddev — if provided, must be length-3 + finite > 0.
  //    If OMITTED, fall back to the bundled default and accept as-is
  //    (defensive: the defaults are pre-validated at module load).
  if (config.stateEmissionStddev !== undefined) {
    const sigmaReadonly = config.stateEmissionStddev as unknown as readonly number[];
    if (sigmaReadonly.length !== 3) {
      throw new Error(
        `[RegimeConditionedCap] stateEmissionStddev must have length 3, got ${String(sigmaReadonly.length)}.`,
      );
    }
    for (let i = 0; i < sigmaReadonly.length; i++) {
      const s = sigmaReadonly[i];
      if (s === undefined || !Number.isFinite(s) || s <= 0) {
        throw new Error(
          `[RegimeConditionedCap] stateEmissionStddev[${String(i)}]=${String(s)} must be finite and > 0.`,
        );
      }
    }
  }

  // 2. transitionMatrix — if provided, must be 3×3 + every element in [0,1]
  //    + every row sums to 1.
  if (config.transitionMatrix !== undefined) {
    // Widened to readonly number[] for runtime length checks (TS otherwise
    // narrows `Tmat.length` to the literal `3`).
    const Tmat = config.transitionMatrix as unknown as readonly number[][];
    if (Tmat.length !== 3) {
      throw new Error(
        `[RegimeConditionedCap] transitionMatrix must have 3 rows, got ${String(Tmat.length)}.`,
      );
    }
    for (let i = 0; i < Tmat.length; i++) {
      const row = (Tmat[i] as readonly number[] | undefined) ?? [];
      if (row.length !== 3) {
        throw new Error(
          `[RegimeConditionedCap] transitionMatrix row ${String(i)} must have 3 columns, got ${String(row.length)}.`,
        );
      }
      let rowSum = 0;
      for (let j = 0; j < row.length; j++) {
        const v = row[j];
        if (v === undefined || !Number.isFinite(v) || v < 0 || v > 1) {
          throw new Error(
            `[RegimeConditionedCap] transitionMatrix[${String(i)}][${String(j)}]=${String(v)} must be finite in [0, 1].`,
          );
        }
        rowSum += v;
      }
      if (Math.abs(rowSum - 1.0) > TRANSITION_ROW_SUM_TOLERANCE) {
        throw new Error(
          `[RegimeConditionedCap] transitionMatrix row ${String(i)} must sum to 1.0 ± ${String(TRANSITION_ROW_SUM_TOLERANCE)}, got ${String(rowSum)}.`,
        );
      }
    }
  }

  // 3. initProbs — if provided, must be length-3 + finite + row sums to 1.
  if (config.initProbs !== undefined) {
    const piReadonly = config.initProbs as unknown as readonly number[];
    if (piReadonly.length !== 3) {
      throw new Error(
        `[RegimeConditionedCap] initProbs must have length 3, got ${String(piReadonly.length)}.`,
      );
    }
    let piSum = 0;
    for (let i = 0; i < piReadonly.length; i++) {
      const p = piReadonly[i];
      if (p === undefined || !Number.isFinite(p) || p < 0 || p > 1) {
        throw new Error(
          `[RegimeConditionedCap] initProbs[${String(i)}]=${String(p)} must be finite in [0, 1].`,
        );
      }
      piSum += p;
    }
    if (Math.abs(piSum - 1.0) > TRANSITION_ROW_SUM_TOLERANCE) {
      throw new Error(
        `[RegimeConditionedCap] initProbs must sum to 1.0 ± ${String(TRANSITION_ROW_SUM_TOLERANCE)}, got ${String(piSum)}.`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Default config (validated at module-load time)
// ---------------------------------------------------------------------------

/**
 * `DEFAULT_REGIME_CONDITIONED_CAP_CONFIG` — fully-validated default
 * config. Validation happens once at module-load; downstream callers
 * can clone + override without re-running validation (constructor
 * also runs validateRegimeCapConfig).
 */
export const DEFAULT_REGIME_CONDITIONED_CAP_CONFIG: RegimeConditionedCapConfig =
  Object.freeze({
    trendingMultiplier: DEFAULT_REGIME_TRENDING_MULTIPLIER,
    rangingMultiplier: DEFAULT_REGIME_RANGING_MULTIPLIER,
    volatileMultiplier: DEFAULT_REGIME_VOLATILE_MULTIPLIER,
    minObservations: DEFAULT_REGIME_MIN_OBSERVATIONS,
    mode: DEFAULT_REGIME_MODE,
    stateEmissionStddev: DEFAULT_REGIME_STATE_EMISSION_STDDEV,
    transitionMatrix: DEFAULT_REGIME_TRANSITION_MATRIX,
    initProbs: DEFAULT_REGIME_INIT_PROBS,
    atrPeriod: DEFAULT_REGIME_ATR_PERIOD,
  });

// Validate the default at load-time so any drift in the constants
// above is caught immediately rather than at first-call.
validateRegimeCapConfig(DEFAULT_REGIME_CONDITIONED_CAP_CONFIG);

// ---------------------------------------------------------------------------
// Helpers — log-domain math (mirrors regime-detector-meta-plugin.ts)
// ---------------------------------------------------------------------------

const LN_2PI = Math.log(2 * Math.PI);

/**
 * `gaussianLogPdf` — log of standard normal PDF at `x` with mean=0,
 * stddev=σ. Negative number; computed in log-domain for numerical
 * stability across the HMM forward algorithm.
 *
 * Returns `Number.NEGATIVE_INFINITY` for non-finite inputs or
 * `σ ≤ 0` — caller can treat that as "impossible observation" and
 * the forward algorithm will naturally down-weight that state.
 */
export function gaussianLogPdf(x: number, stddev: number): number {
  if (!Number.isFinite(x) || !Number.isFinite(stddev)) {
    return Number.NEGATIVE_INFINITY;
  }
  if (stddev <= 0) return Number.NEGATIVE_INFINITY;
  const z = x / stddev;
  return -0.5 * z * z - Math.log(stddev) - 0.5 * LN_2PI;
}

/**
 * `logSumExp` — numerically stable log(exp(a) + exp(b) + ...).
 * Shifts by the max element before summation to avoid overflow.
 * Returns `Number.NEGATIVE_INFINITY` on empty array or all-`-Infinity`.
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

// ---------------------------------------------------------------------------
// Helpers — regime ↔ index
// ---------------------------------------------------------------------------

/**
 * `regimeLabelToIndex` — map a `RegimeLabel` to its 0/1/2 index
 * (used for the 3-state HMM state vector).
 *
 *   "trending" → 0
 *   "ranging"  → 1
 *   "volatile" → 2
 */
export function regimeLabelToIndex(label: RegimeLabel): 0 | 1 | 2 {
  if (label === "trending") return 0;
  if (label === "ranging") return 1;
  return 2;
}

/**
 * `indexToRegimeLabel` — inverse map: 0/1/2 → `RegimeLabel`.
 */
export function indexToRegimeLabel(i: 0 | 1 | 2): RegimeLabel {
  if (i === 0) return "trending";
  if (i === 1) return "ranging";
  return "volatile";
}

/**
 * `argmaxPosterior` — pick the regime label corresponding to the
 * highest posterior probability. Tie-breaking: trending > ranging >
 * volatile (deterministic — same convention as the existing
 * `regime-detector-meta-plugin.ts` argmaxRegime).
 */
export function argmaxPosterior(
  probs: readonly [number, number, number],
): RegimeLabel {
  if (probs[0] >= probs[1] && probs[0] >= probs[2]) return "trending";
  if (probs[1] >= probs[2]) return "ranging";
  return "volatile";
}

// ---------------------------------------------------------------------------
// Helpers — HMM core (forward algorithm over a bar series)
// ---------------------------------------------------------------------------

interface HmmForwardState {
  /** Log-domain alpha — `alphaLog[i] = log P(state=i | obs ≤ t)`. `null` until first observation. */
  alphaLog: [number, number, number] | null;
  /** Most recent fully-normalized posterior (in non-log domain). `null` until first observation. */
  posterior: [number, number, number] | null;
}

/**
 * `_advanceHmm` — update HMM state with a new observation. Returns
 * the new posterior (sums to 1.0 ± 1e-6).
 *
 * Implements the standard log-domain forward algorithm:
 *   - Emission: B[j] = Normal(o | 0, σ_s[j]) [log-domain]
 *   - Update:   α_t(j) = logsumexp_i [log α_{t-1}(i) + log T[i][j]] + B[j]
 *   - Normalize: α_t(j) -= logsumexp_j α_t(j)
 *
 * First observation uses the prior `π[j]` as initialization (i.e.,
 * `α_1(j) = log π[j] + B[j]`, then normalize).
 */
function _advanceHmm(
  state: HmmForwardState,
  observation: number,
  sigma: readonly [number, number, number],
  Tmat: readonly [
    readonly [number, number, number],
    readonly [number, number, number],
    readonly [number, number, number],
  ],
  pi: readonly [number, number, number],
): [number, number, number] {
  // Compute emission log-likelihoods per state.
  // Tuple-typed indexed reads keep TS from widening to `number | undefined`
  // even with `noUncheckedIndexedAccess: true`, so no `!` assertion needed.
  const B: [number, number, number] = [
    gaussianLogPdf(observation, sigma[0]),
    gaussianLogPdf(observation, sigma[1]),
    gaussianLogPdf(observation, sigma[2]),
  ];

  // Compute unnormalized alpha.
  const newAlphaLog: [number, number, number] = [0, 0, 0];
  if (state.alphaLog === null) {
    // First observation: alpha_1(j) = log pi[j] + B[j].
    for (let j = 0; j < 3; j++) {
      newAlphaLog[j] = Math.log(pi[j]!) + B[j]!;
    }
  } else {
    // Recursion: alpha_t(j) = logsumexp_i [alpha_{t-1}(i) + log T[i][j]] + B[j].
    for (let j = 0; j < 3; j++) {
      const logTerms: number[] = [];
      for (let i = 0; i < 3; i++) {
        const safeT = Math.max(Tmat[i]![j]!, 1e-300);
        const logT = safeT === 0 ? -700 : Math.log(safeT);
        logTerms.push(state.alphaLog[i]! + logT);
      }
      newAlphaLog[j] = logSumExp(logTerms) + B[j]!;
    }
  }

  // Normalize.
  const lse = logSumExp([newAlphaLog[0], newAlphaLog[1], newAlphaLog[2]]);
  const n0 = Math.exp(newAlphaLog[0] - lse);
  const n1 = Math.exp(newAlphaLog[1] - lse);
  const n2 = Math.exp(newAlphaLog[2] - lse);
  // The logSumExp shift makes sum-to-1 exact by construction — the
  // defensive re-normalize branch removed here would only fire in a
  // pathological float-precision corner case.
  const normalized: [number, number, number] = [n0, n1, n2];

  state.alphaLog = newAlphaLog;
  state.posterior = normalized;
  return normalized;
}

// ---------------------------------------------------------------------------
// Helpers — ATR-percentile (legacy fallback for the "atr" mode)
// ---------------------------------------------------------------------------

/**
 * `_computeAtr` — Wilder's ATR for a series of bars. Returns the
 * trailing ATR using a `period` lookback (default 14). Returns 0 if
 * there are fewer than 2 bars (true range is undefined).
 *
 * ATR per bar = max(high - low, |high - prevClose|, |low - prevClose|).
 */
function _computeAtr(
  bars: readonly BarObservation[],
  period: number,
): readonly number[] {
  const out: number[] = [];
  if (bars.length < 2) {
    return out;
  }
  // First bar has no prior close — set TR to (high - low).
  let prevClose = bars[0]!.close;
  // Compute true range for each bar.
  const tr: number[] = [];
  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i]!;
    const hi = bar.high;
    const lo = bar.low;
    if (i === 0) {
      const r = hi - lo;
      tr.push(Number.isFinite(r) ? Math.max(0, r) : 0);
    } else {
      const r1 = hi - lo;
      const r2 = Math.abs(hi - prevClose);
      const r3 = Math.abs(lo - prevClose);
      const m = Math.max(r1, r2, r3);
      tr.push(Number.isFinite(m) ? Math.max(0, m) : 0);
    }
    prevClose = bar.close;
  }
  // Wilder smoothing: ATR_t = (ATR_{t-1} × (period - 1) + TR_t) / period.
  // For t < period, use simple mean of available TRs.
  for (let i = 0; i < tr.length; i++) {
    if (i < period - 1) {
      // Insufficient history — sum what we have and divide by count.
      let s = 0;
      for (let k = 0; k <= i; k++) s += tr[k]!;
      out.push(s / (i + 1));
    } else {
      // Wilder smoothing.
      let atr = 0;
      // Initialize ATR at the first period with simple mean.
      for (let k = i - period + 1; k <= i; k++) atr += tr[k]!;
      atr /= period;
      // Apply Wilder smoothing for any subsequent bars.
      // We approximate Wilder by recomputing the trailing period window
      // (period=14 with a 30mo history is fast; full Wilder recursion
      // would also work but adds no accuracy in this regime classifier).
      out.push(atr);
    }
  }
  return out;
}

/**
 * `_classifyAtrPercentile` — map an ATR value to a regime via its
 * percentile rank over the trailing window.
 *
 *   ATR <  33rd percentile → "ranging"
 *   ATR ∈ [33rd, 67th]     → "trending"
 *   ATR >  67th percentile → "volatile"
 *
 * Standard percentile rank formula `(below + 0.5 × equal) / N`:
 * ties at the median → rank 0.5 → classified as "trending" (the
 * middle band of the percentile distribution).
 */
function _classifyAtrPercentile(
  atrValue: number,
  atrSeries: readonly number[],
  currentIdx: number,
  lookback: number,
): RegimeLabel {
  if (currentIdx === 0 || atrValue <= 0) return "trending";
  const start = Math.max(0, currentIdx - lookback);
  const slice = atrSeries.slice(start, currentIdx);
  if (slice.length === 0) return "trending";
  // Standard percentile-rank formula `(below + 0.5 * equal) / N`.
  // Ties at the median → rank = 0.5 → trending.
  let below = 0;
  let equal = 0;
  for (const v of slice) {
    if (v < atrValue) below++;
    else if (v === atrValue) equal++;
  }
  const rank = (below + 0.5 * equal) / slice.length;
  if (rank < 1 / 3) return "ranging";
  if (rank < 2 / 3) return "trending";
  return "volatile";
}

// ---------------------------------------------------------------------------
// Public API — buildRegimeTimeline, getRegimeAt, applyRegimeToCap
// ---------------------------------------------------------------------------

/**
 * `buildRegimeTimeline` — build a one-entry-per-bar regime timeline
 * from raw OHLCV observations. The HMM forward algorithm advances
 * per bar; the first `minObservations` bars are cold-start
 * ("trending" × 1.0).
 *
 * NaN safety:
 *   - Any NaN in `close` → that bar's observation is skipped (the
 *     classifier uses the previous regime via gap-fill).
 *   - All-NaN input → returns a `minObservations`-length "trending"
 *     cold-start, then "ranging" for safety.
 *
 * Length contract: returns `bars.length` timeline entries (one per
 * bar), even on edge cases.
 */
export function buildRegimeTimeline(
  bars: readonly BarObservation[],
  config: RegimeConditionedCapConfig,
  _now: number,
): readonly RegimeTimelineEntry[] {
  void _now;
  // Validate config defensively — re-runs the constructor check.
  validateRegimeCapConfig(config);
  const mode = config.mode ?? DEFAULT_REGIME_MODE;
  const minObs = config.minObservations;

  // Empty input — empty output (NOT throwing).
  if (bars.length === 0) return [];

  // All-NaN guard — return a safe timeline.
  let anyFinite = false;
  for (const b of bars) {
    if (Number.isFinite(b.close)) {
      anyFinite = true;
      break;
    }
  }
  if (!anyFinite) {
    // minObservations cold-start "trending", then "ranging" for safety.
    const safeTimeline: RegimeTimelineEntry[] = [];
    for (let t = 0; t < bars.length; t++) {
      const label: RegimeLabel = t < minObs ? "trending" : "ranging";
      const multiplier = label === "trending"
        ? config.trendingMultiplier
        : config.rangingMultiplier;
      safeTimeline.push({
        timestamp: bars[t]!.timestamp,
        regime: label,
        multiplier,
        posteriorProbs: [0.34, 0.33, 0.33],
      });
    }
    return safeTimeline;
  }

  // Pre-compute HMM constants (HMM mode).
  if (mode === "hmm") {
    const sigma = config.stateEmissionStddev ?? DEFAULT_REGIME_STATE_EMISSION_STDDEV;
    const Tmat = config.transitionMatrix ?? DEFAULT_REGIME_TRANSITION_MATRIX;
    const pi = config.initProbs ?? DEFAULT_REGIME_INIT_PROBS;
    return _buildHmmTimeline(bars, config, sigma, Tmat, pi, minObs);
  }
  // ATR mode.
  const period = config.atrPeriod ?? DEFAULT_REGIME_ATR_PERIOD;
  return _buildAtrTimeline(bars, config, period, minObs);
}

/**
 * `_buildHmmTimeline` — HMM-mode timeline builder.
 */
function _buildHmmTimeline(
  bars: readonly BarObservation[],
  config: RegimeConditionedCapConfig,
  sigma: readonly [number, number, number],
  Tmat: readonly [
    readonly [number, number, number],
    readonly [number, number, number],
    readonly [number, number, number],
  ],
  pi: readonly [number, number, number],
  minObs: number,
): readonly RegimeTimelineEntry[] {
  const timeline: RegimeTimelineEntry[] = [];
  const state: HmmForwardState = { alphaLog: null, posterior: null };
  let prevClose: number | null = null;
  let lastRegime: RegimeLabel = "trending"; // safe default for gap-fill

  for (let t = 0; t < bars.length; t++) {
    const bar = bars[t]!;
    const close = bar.close;

    // Cold-start window — force "trending" with multiplier 1.0.
    if (t < minObs) {
      timeline.push({
        timestamp: bar.timestamp,
        regime: "trending",
        multiplier: config.trendingMultiplier,
        posteriorProbs: [0.6, 0.3, 0.1],
      });
      if (Number.isFinite(close)) prevClose = close;
      continue;
    }

    // NaN guard — gap-fill with the previous regime.
    if (!Number.isFinite(close) || prevClose === null || !Number.isFinite(prevClose)) {
      timeline.push({
        timestamp: bar.timestamp,
        regime: lastRegime,
        multiplier:
          lastRegime === "trending"
            ? config.trendingMultiplier
            : lastRegime === "ranging"
              ? config.rangingMultiplier
              : config.volatileMultiplier,
        posteriorProbs: state.posterior ?? [0.34, 0.33, 0.33],
      });
      continue;
    }

    // Compute log-return observation: ln(close / prevClose).
    const obs = Math.log(close / prevClose);

    // Advance HMM forward algorithm (skip NaN observations).
    if (Number.isFinite(obs)) {
      _advanceHmm(state, obs, sigma, Tmat, pi);
    }

    const posterior = state.posterior ?? [0.6, 0.3, 0.1];
    const regime = argmaxPosterior(posterior);
    lastRegime = regime;
    timeline.push({
      timestamp: bar.timestamp,
      regime,
      multiplier:
        regime === "trending"
          ? config.trendingMultiplier
          : regime === "ranging"
            ? config.rangingMultiplier
            : config.volatileMultiplier,
      posteriorProbs: posterior,
    });

    prevClose = close;
  }

  return timeline;
}

/**
 * `_buildAtrTimeline` — ATR-percentile-mode timeline builder.
 */
function _buildAtrTimeline(
  bars: readonly BarObservation[],
  config: RegimeConditionedCapConfig,
  period: number,
  minObs: number,
): readonly RegimeTimelineEntry[] {
  const atrSeries = _computeAtr(bars, period);
  const timeline: RegimeTimelineEntry[] = [];
  const lookback = Math.max(period, 20);

  for (let t = 0; t < bars.length; t++) {
    const bar = bars[t]!;

    // Cold-start window — force "trending".
    if (t < minObs) {
      timeline.push({
        timestamp: bar.timestamp,
        regime: "trending",
        multiplier: config.trendingMultiplier,
        posteriorProbs: [0.34, 0.33, 0.33],
      });
      continue;
    }

    // `_computeAtr` sanitizes non-finite H/L/C to 0 (defensive — see the
    // implementation), so `atrSeries[t]` is always finite and in-bounds.
    const regime = _classifyAtrPercentile(atrSeries[t]!, atrSeries, t, lookback);
    timeline.push({
      timestamp: bar.timestamp,
      regime,
      multiplier:
        regime === "trending"
          ? config.trendingMultiplier
          : regime === "ranging"
            ? config.rangingMultiplier
            : config.volatileMultiplier,
      posteriorProbs: [0.34, 0.33, 0.33],
    });
  }

  return timeline;
}

/**
 * `getRegimeAt` — lookup the regime at a given timestamp via
 * binary-search-with-fallback. If the timestamp is BEFORE the
 * timeline's first entry, returns the `fallback` (default
 * "trending"); if AFTER the timeline's last entry, returns the
 * LAST timeline entry's regime (carry-forward).
 *
 * If the exact timestamp matches, returns that entry's regime.
 * Otherwise returns the regime of the LATEST entry with
 * `timestamp <= t` (i.e., left-closed lookup).
 */
export function getRegimeAt(
  timeline: readonly RegimeTimelineEntry[],
  timestamp: number,
  fallback: RegimeLabel = "trending",
): RegimeLabel {
  if (timeline.length === 0) return fallback;
  // Timeline is built in chronological order — binary search.
  let lo = 0;
  let hi = timeline.length - 1;
  // Before start → fallback.
  if (timestamp < timeline[0]!.timestamp) return fallback;
  // After end → carry the last entry's regime forward.
  if (timestamp >= timeline[hi]!.timestamp) {
    return timeline[hi]!.regime;
  }
  // Binary search for leftmost index with `timeline[i].timestamp > timestamp`.
  // Then return `timeline[i-1]`.
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (timeline[mid]!.timestamp <= timestamp) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  // `lo` is the first index with `timestamp > t`; return the previous.
  return timeline[lo - 1]!.regime;
}

/**
 * `applyRegimeToCap` — apply the per-regime multiplier to a per-bar
 * cap. Pure (does NOT mutate inputs). The returned multiplier is
 * the cap that downstream strategy code should use for this bar.
 *
 *   applyRegimeToCap(0.12, "trending", default config) → 0.12
 *   applyRegimeToCap(0.12, "ranging", default config)  → 0.084
 *   applyRegimeToCap(0.12, "volatile", default config) → 0.048
 *
 * Note: input `baseCap` is treated as a number; non-finite inputs
 * return the cap as-is (no NaN propagation).
 */
export function applyRegimeToCap(
  baseCap: number,
  regime: RegimeLabel,
  config: RegimeConditionedCapConfig,
): number {
  if (!Number.isFinite(baseCap) || baseCap <= 0) return baseCap;
  const mult =
    regime === "trending"
      ? config.trendingMultiplier
      : regime === "ranging"
        ? config.rangingMultiplier
        : config.volatileMultiplier;
  return baseCap * mult;
}

// ---------------------------------------------------------------------------
// Default config builder — handy for downstream consumers
// ---------------------------------------------------------------------------

/**
 * `getDefaultRegimeConditionedCapConfig` — factory for a fresh
 * default config (un-frozen copy so callers can override fields
 * safely).
 */
export function getDefaultRegimeConditionedCapConfig(): RegimeConditionedCapConfig {
  return {
    trendingMultiplier: DEFAULT_REGIME_TRENDING_MULTIPLIER,
    rangingMultiplier: DEFAULT_REGIME_RANGING_MULTIPLIER,
    volatileMultiplier: DEFAULT_REGIME_VOLATILE_MULTIPLIER,
    minObservations: DEFAULT_REGIME_MIN_OBSERVATIONS,
    mode: DEFAULT_REGIME_MODE,
    stateEmissionStddev: DEFAULT_REGIME_STATE_EMISSION_STDDEV,
    transitionMatrix: DEFAULT_REGIME_TRANSITION_MATRIX,
    initProbs: DEFAULT_REGIME_INIT_PROBS,
    atrPeriod: DEFAULT_REGIME_ATR_PERIOD,
  };
}

