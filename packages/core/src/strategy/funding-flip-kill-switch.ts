// packages/core/src/strategy/funding-flip-kill-switch.ts
//
// Phase 32 refactor — the original `FundingFlipKillSwitchStrategy` class
// was a wrapper around `FundingCarryTimingStrategy` (which was deleted in
// Phase 32 — see docs/research/deprecated-strategies/REPORT.md §2.7).
// The pure-functional regime detector (`computeFlipDetectorMetrics` +
// `evaluateRegime`) is preserved because `sol-flip-kill-switch-plugin.ts`
// still uses it as a portable funding-flip detector (not tied to any
// specific carry strategy).
//
// ============================================================================
// SCOPE
// ============================================================================
//
//  - Pure-functional funding-flip regime detector
//  - Per-symbol funding history → FlipDetectorMetrics → RegimeDecision
//  - Used by sol-flip-kill-switch-plugin.ts to gate the SOL carry exposure
//    (the dydx-cex-carry BTC strategy is BTC-only and does not use this
//    detector — the SOL funding environment is structurally different
//    per Phase 25 #1 + Phase 27 lessons)
//
// ============================================================================
// REFERENCES
// ============================================================================
//
//  - docs/research/phase9-funding-flip-kill-switch.md (original empirical
//    anchor; detector defaults calibrated from 30 months of BTC/ETH/SOL
//    funding data — see §4 of the REPORT)
//  - Axel Adler Jr (CryptoQuant / Binance Square) — funding-percentile regime
//  - Lo 2002 / Politis 2024 — regime-switching carry-trade theory
//  - Burnside, Eichenbaum, Rebelo 2011 — "Carry Trade" New Palgrave
//  - Bybit EU — Spot Margin 10× leverage, IMR formula, MMR 4%

// ---------------------------------------------------------------------------
// HARD CONSTRAINT VALIDATOR — 1:10 MANDATORY LEVERAGE
// ---------------------------------------------------------------------------

/** Allowed leverage values (1× baseline or 10× 1:10 bybit.eu SPOT default). */
export type AllowedKillSwitchLeverage = 1 | 10;

/** `ALLOWED_KILL_SWITCH_LEVERAGE` — frozen array of allowed values. */
export const ALLOWED_KILL_SWITCH_LEVERAGE: readonly AllowedKillSwitchLeverage[] = Object.freeze([
  1, 10,
]);

/**
 * `assert1to10Leverage` — guardrail that asserts the leverage is in
 * {1, 10}. Defense-in-depth: every Strategy constructor that sizes
 * positions must call this before sizing logic.
 *
 * @throws Error if `leverage` is not in {1, 10}.
 */
export function assert1to10Leverage(leverage: number): asserts leverage is AllowedKillSwitchLeverage {
  if (leverage !== 1 && leverage !== 10) {
    throw new Error(
      `[assert1to10Leverage] leverage=${String(leverage)} is NOT allowed. ` +
        `1:10 HARD GUARDRAIL — only values 1 (baseline) or 10 (1:10 bybit.eu SPOT margin) are accepted.`,
    );
  }
}

// ---------------------------------------------------------------------------
// Pure-functional detector helpers (testable in isolation)
// ---------------------------------------------------------------------------

/**
 * `FlipDetectorConfig` — configuration for the funding-flip regime
 * detector. Defaults calibrated from empirical analysis of 30 months of
 * BTC/ETH/SOL funding data (see §4 of docs/research/phase9-funding-flip-kill-switch.md):
 *
 *   - `flipWindowDays = 7` — rolling lookback window for sign-flip counting.
 *   - `flipThreshold = 10` — number of sign-flips in 7d that triggers
 *     "flip regime".
 *   - `negativeDominanceThreshold = 0.80` — fraction of snapshots in 7d
 *     window that must be negative to trigger "negative-dominance regime".
 *   - `persistenceDays = 5` — minimum days the kill-switch stays engaged
 *     after the last FRESH regime signal.
 *   - `extremeZscoreThreshold = 1.5` — for the volatility-z-score extreme
 *     regime.
 *   - `volWindowDays = 30` — baseline window for the z-score calculation.
 */
export interface FlipDetectorConfig {
  readonly flipWindowDays: number;
  readonly flipThreshold: number;
  readonly negativeDominanceThreshold: number;
  readonly persistenceDays: number;
  readonly extremeZscoreThreshold: number;
  readonly volWindowDays: number;
}

export const DEFAULT_FLIP_DETECTOR_CONFIG: FlipDetectorConfig = {
  flipWindowDays: 7,
  flipThreshold: 10,
  negativeDominanceThreshold: 0.8,
  persistenceDays: 5,
  extremeZscoreThreshold: 1.5,
  volWindowDays: 30,
};

/**
 * `FlipDetectorMetrics` — instantaneous detector snapshot for a given
 * timestamp, computed over the trailing window.
 */
export interface FlipDetectorMetrics {
  /** Number of sign-flips in the trailing `flipWindowDays` snapshots. */
  readonly flipCount: number;
  /** Fraction of trailing `flipWindowDays` snapshots that are negative. */
  readonly negativeDominance: number;
  /** Trailing `flipWindowDays` |rate| mean. */
  readonly absRateMean: number;
  /** Trailing `flipWindowDays` |rate| std-dev. */
  readonly absRateStdDev: number;
  /** Trailing `volWindowDays` baseline |rate| mean. */
  readonly baselineAbsRateMean: number;
  /** Trailing `volWindowDays` baseline |rate| std-dev. */
  readonly baselineAbsRateStdDev: number;
  /** Z-score of trailing 7d |rate| mean vs trailing 30d baseline. */
  readonly zscore: number;
  /** Number of snapshots in the trailing flip window. */
  readonly windowSize: number;
  /** Number of snapshots in the trailing vol window. */
  readonly baselineWindowSize: number;
}

/**
 * `computeFlipDetectorMetrics` — pure functional computation of the
 * detector state from a rolling history of funding rates.
 *
 * Returns the snapshot metrics for the trailing `flipWindowDays` window
 * and the trailing `volWindowDays` baseline. Empty / insufficient history
 * returns zero metrics (no flip regime declared).
 *
 * @param history - chronologically-ordered funding-rate history (most-recent last)
 * @param cfg     - detector config
 */
export function computeFlipDetectorMetrics(
  history: readonly number[],
  cfg: FlipDetectorConfig,
): FlipDetectorMetrics {
  if (history.length === 0) {
    return {
      flipCount: 0,
      negativeDominance: 0,
      absRateMean: 0,
      absRateStdDev: 0,
      baselineAbsRateMean: 0,
      baselineAbsRateStdDev: 0,
      zscore: 0,
      windowSize: 0,
      baselineWindowSize: 0,
    };
  }

  // 1. Sign-flip counting on trailing flipWindow (3 snapshots/day × windowDays).
  // Zero-rate snapshots are excluded from the sign-flip chain — we count
  // sign changes between CONSECUTIVE NON-ZERO snapshots.
  const flipWindowSize = cfg.flipWindowDays * 3;
  const flipSlice = history.slice(-Math.min(flipWindowSize, history.length));
  const nonZeroSlice = flipSlice.filter((r) => r !== 0);

  let flipCount = 0;
  for (let i = 1; i < nonZeroSlice.length; i++) {
    const a = nonZeroSlice[i - 1]!;
    const b = nonZeroSlice[i]!;
    if ((a > 0) !== (b > 0)) flipCount += 1;
  }

  // 2. Negative dominance — fraction of trailing window snapshots that
  // are negative.
  let negCount = 0;
  for (const r of flipSlice) {
    if (r < 0) negCount += 1;
  }
  const negativeDominance = flipSlice.length > 0 ? negCount / flipSlice.length : 0;

  // 3. |rate| statistics for trailing flip window.
  const absRates = flipSlice.map((r) => Math.abs(r));
  const absRateMean = absRates.length > 0
    ? absRates.reduce((a, b) => a + b, 0) / absRates.length
    : 0;
  const absRateVariance = absRates.length > 1
    ? absRates.reduce((a, b) => a + (b - absRateMean) ** 2, 0) / (absRates.length - 1)
    : 0;
  const absRateStdDev = Math.sqrt(absRateVariance);

  // 4. |rate| statistics for trailing vol baseline window.
  const volWindowSize = cfg.volWindowDays * 3;
  const volSlice = history.slice(-Math.min(volWindowSize, history.length));
  const volAbsRates = volSlice.map((r) => Math.abs(r));
  const baselineAbsRateMean = volAbsRates.length > 0
    ? volAbsRates.reduce((a, b) => a + b, 0) / volAbsRates.length
    : 0;
  const baselineVariance = volAbsRates.length > 1
    ? volAbsRates.reduce((a, b) => a + (b - baselineAbsRateMean) ** 2, 0) / (volAbsRates.length - 1)
    : 0;
  const baselineAbsRateStdDev = Math.sqrt(baselineVariance);

  // 5. Z-score — (flipMean - baselineMean) / baselineStdDev. If
  // baselineStdDev is 0, zscore = 0 (degenerate case, no signal).
  const zscore = baselineAbsRateStdDev > 0
    ? (absRateMean - baselineAbsRateMean) / baselineAbsRateStdDev
    : 0;

  return {
    flipCount,
    negativeDominance,
    absRateMean,
    absRateStdDev,
    baselineAbsRateMean,
    baselineAbsRateStdDev,
    zscore,
    windowSize: flipSlice.length,
    baselineWindowSize: volSlice.length,
  };
}

/**
 * `RegimeDecision` — the result of `evaluateRegime` for a given
 * `FlipDetectorMetrics` snapshot.
 */
export interface RegimeDecision {
  /** True if ANY regime (flip / negative-dominance / extreme) is active. */
  readonly regimeActive: boolean;
  /** True if the flip-count regime triggered (flipCount ≥ threshold). */
  readonly flipRegime: boolean;
  /** True if the negative-dominance regime triggered (≥ negativeDominanceThreshold). */
  readonly negativeDominanceRegime: boolean;
  /** True if the extreme z-score regime triggered (|zscore| ≥ extremeZscoreThreshold). */
  readonly extremeRegime: boolean;
  /** Human-readable reason string. */
  readonly reason: string;
}

/**
 * `evaluateRegime` — pure functional evaluation of regime state from
 * detector metrics. Returns a `RegimeDecision` that downstream consumers
 * (e.g. `sol-flip-kill-switch-plugin.ts`) use to gate carry exposure.
 */
export function evaluateRegime(
  metrics: FlipDetectorMetrics,
  cfg: FlipDetectorConfig,
): RegimeDecision {
  const flipRegime = metrics.flipCount >= cfg.flipThreshold;
  const negativeDominanceRegime =
    metrics.negativeDominance >= cfg.negativeDominanceThreshold;
  const extremeRegime = Math.abs(metrics.zscore) >= cfg.extremeZscoreThreshold;
  const regimeActive = flipRegime || negativeDominanceRegime || extremeRegime;

  const reasons: string[] = [];
  if (flipRegime) {
    reasons.push(
      `flipCount=${metrics.flipCount} ≥ ${cfg.flipThreshold} (7d window)`,
    );
  }
  if (negativeDominanceRegime) {
    reasons.push(
      `negativeDominance=${(metrics.negativeDominance * 100).toFixed(1)}% ≥ ${(cfg.negativeDominanceThreshold * 100).toFixed(0)}%`,
    );
  }
  if (extremeRegime) {
    reasons.push(
      `|zscore|=${Math.abs(metrics.zscore).toFixed(2)} ≥ ${cfg.extremeZscoreThreshold}`,
    );
  }
  const reason = regimeActive
    ? `regime-active: ${reasons.join("; ")}`
    : "regime-inactive: all metrics below thresholds";

  return {
    regimeActive,
    flipRegime,
    negativeDominanceRegime,
    extremeRegime,
    reason,
  };
}
