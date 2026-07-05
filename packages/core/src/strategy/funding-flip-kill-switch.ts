// packages/core/src/strategy/funding-flip-kill-switch.ts — Phase 9 9D
//
// Regime detector + carry pause wrapper around `FundingCarryTimingStrategy`.
//
// Phase 8 Track E (FundingCarryTiming) empirically produced 3 negative SOL
// walk-forward OOS folds (Folds 17, 20, 21) clustered in the Q1-Q2 2026 SOL
// funding-flip regime. Empirical analysis of these 30-day windows (see
// docs/research/phase9-funding-flip-kill-switch.md §4):
//
//   Fold 17 (2025-10-29 → 2025-11-28, Sharpe -1.014):
//     52% negative snapshots, 80% of snapshots have ≥7 sign-flips in 7d
//   Fold 20 (2026-01-27 → 2026-02-26, Sharpe -3.753):
//     79% negative snapshots, 0% have ≥7 flips (persistent negative regime)
//   Fold 21 (2026-02-26 → 2026-03-28, Sharpe -3.121):
//     63% negative snapshots, 41% have ≥7 flips (mixed flip regime)
//
// The Track E timing filter partially mitigated (inCarry% on these folds
// was 6.5%-27.2%, vs 75% on a healthy fold), but the entry signals still
// fired during brief positive-funding pockets within the flip regime and
// generated small negative carry. The kill-switch's job: PAUSE the carry
// entirely during the regime so we collect zero funding and zero negative
// funding on those days.
//
// ===========================================================================
// HARD CONSTRAINT — USER-MANDATED 1:10 LEVERAGE (mvs_c13fe65cb68f4df3851304dea09a9099)
// ===========================================================================
//
// ALL trades use EXACTLY 1:10 leverage (10× notional on 1× capital, 9×
// borrowed from bybit.eu SPOT margin). The kill-switch inherits this
// constraint from the wrapped `FundingCarryTimingStrategy`. The CLI's
// --leverage flag accepts ONLY 1 or 10 — any other value is REJECTED at
// parse time. Default = 10.
//
// This SUPERSEDES any prior track guidance:
//   - Phase 7 Track C "3× leverage default" → OVERRIDDEN
//   - Altrady / coincryptorank "≤3× for basis" → OVERRIDDEN
//   - Phase 8 Track E original "NO leverage amplification" → OVERRIDDEN
//
// References (Phase 9 9D research, see docs/research/phase9-funding-flip-kill-switch.md):
//   - Axel Adler Jr (CryptoQuant / Binance Square) — funding-percentile regime
//   - Kingfisher / Button.xyz / SignalPilot — practitioner funding thresholds
//   - Lo 2002 / Politis 2024 — regime-switching carry-trade theory
//   - Burnside, Eichenbaum, Rebelo 2011 — "Carry Trade" New Palgrave
//   - Bybit EU — Spot Margin 10× leverage, IMR formula, MMR 4%

import type { FundingSnapshot } from "./funding-carry.js";
import type { Strategy, StrategyContext, StrategySignal } from "../types.js";
import {
  FundingCarryTimingStrategy,
  type AllowedTimingLeverage,
  type FundingCarryTimingConfig,
  type FundingCarryTimingState,
  type RollingWindowStats,
  ALLOWED_TIMING_LEVERAGE,
  validateTimingLeverage,
} from "./funding-carry-timing.js";

// ---------------------------------------------------------------------------
// HARD CONSTRAINT VALIDATOR — 1:10 MANDATORY LEVERAGE (re-export from Track E)
// ---------------------------------------------------------------------------

/**
 * `assert1to10Leverage` — wrapper guardrail that calls the Track E
 * `validateTimingLeverage` validator. This re-affirms the 1:10 mandatory
 * leverage constraint at the kill-switch layer in addition to the
 * underlying Track E constructor guardrail. Defense in depth.
 *
 * @throws Error if `leverage` is not in {1, 10}.
 */
export function assert1to10Leverage(leverage: number): asserts leverage is AllowedTimingLeverage {
  validateTimingLeverage(leverage);
}

/**
 * `ALLOWED_KILL_SWITCH_LEVERAGE` — same allowed set as Track E.
 * Re-exported under a strategy-specific name for clarity at the kill-switch
 * boundary. Object.freeze() prevents accidental mutation.
 */
export const ALLOWED_KILL_SWITCH_LEVERAGE: readonly AllowedTimingLeverage[] = Object.freeze([
  ...ALLOWED_TIMING_LEVERAGE,
]);

// ---------------------------------------------------------------------------
// Pure-functional detector helpers (testable in isolation)
// ---------------------------------------------------------------------------

/**
 * `FlipDetectorConfig` — configuration for the funding-flip regime
 * detector. Defaults calibrated from empirical analysis of 30 months of
 * BTC/ETH/SOL funding data (see §4 of docs/research/phase9-funding-flip-kill-switch.md):
 *
 *   - `flipWindowDays = 7` — rolling lookback window for sign-flip counting.
 *     7d covers ~21 funding snapshots at Binance 8h cadence, enough to
 *     capture a regime transition but short enough to react promptly.
 *   - `flipThreshold = 10` — number of sign-flips in 7d that triggers
 *     "flip regime". SOL's 3 negative folds (17, 21) have 32-80% of
 *     snapshots at ≥10 flips/7d; healthy SOL folds (5, 13) have 0%.
 *     Threshold 10 catches the bad folds while rejecting most healthy folds.
 *   - `negativeDominanceThreshold = 0.80` — fraction of snapshots in 7d
 *     window that must be negative to trigger "negative-dominance regime".
 *     SOL Fold 20 (worst negative fold, -3.75 Sharpe) has 79% negative
 *     snapshots; healthy SOL folds rarely exceed 60%. Threshold 0.80
 *     isolates Fold 20-class regimes.
 *   - `persistenceDays = 5` — minimum days the kill-switch stays engaged
 *     after the last FRESH regime signal. Anti-whipsaw: prevents rapidly
 *     alternating "carry on" / "carry off" within the flip regime.
 *     5d is empirically shorter than the 7d trailing window's natural
 *     persistence to avoid double-counting.
 *   - `extremeZscoreThreshold = 1.5` — for the volatility-z-score extreme
 *     regime (rarely triggered, only ~0.2% of snapshots at z≥1.5; included
 *     for completeness, can be tightened or loosened).
 *   - `volWindowDays = 30` — baseline window for the z-score calculation.
 *     30d = 90 funding snapshots; matches the Track E timing window.
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

  // 2. Negative-dominance on same window.
  let negCount = 0;
  let absSum = 0;
  for (const r of flipSlice) {
    if (r < 0) negCount += 1;
    absSum += Math.abs(r);
  }
  const negativeDominance = flipSlice.length > 0 ? negCount / flipSlice.length : 0;
  const absRateMean = flipSlice.length > 0 ? absSum / flipSlice.length : 0;
  let absRateVar = 0;
  for (const r of flipSlice) {
    absRateVar += (Math.abs(r) - absRateMean) ** 2;
  }
  absRateVar = flipSlice.length > 1 ? absRateVar / (flipSlice.length - 1) : 0;
  const absRateStdDev = Math.sqrt(absRateVar);

  // 3. Baseline 30d vol-window for z-score.
  const volWindowSize = cfg.volWindowDays * 3;
  const baselineSlice = history.slice(-Math.min(volWindowSize, history.length));
  let baseAbsSum = 0;
  for (const r of baselineSlice) baseAbsSum += Math.abs(r);
  const baselineAbsRateMean = baselineSlice.length > 0 ? baseAbsSum / baselineSlice.length : 0;
  let baseVar = 0;
  for (const r of baselineSlice) {
    baseVar += (Math.abs(r) - baselineAbsRateMean) ** 2;
  }
  baseVar = baselineSlice.length > 1 ? baseVar / (baselineSlice.length - 1) : 0;
  const baselineAbsRateStdDev = Math.sqrt(baseVar);

  // 4. Z-score: how many σ above the 30d baseline is the 7d |rate| mean?
  const zscore =
    baselineAbsRateStdDev > 0
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
    baselineWindowSize: baselineSlice.length,
  };
}

/**
 * `RegimeDecision` — the detector's verdict on whether to engage the
 * kill-switch for a given timestamp. Pure function.
 *
 * Returns:
 *   - `regimeActive` = true if EITHER flip regime OR negative-dominance
 *     regime OR extreme-volatility regime is active. When true, the
 *     kill-switch pauses carry.
 *   - `flipRegime` = flipCount >= flipThreshold
 *   - `negativeDominanceRegime` = negativeDominance >= threshold
 *   - `extremeRegime` = zscore >= extremeZscoreThreshold
 *   - `reason` = human-readable string for diagnostics
 *
 * The detector itself does NOT apply persistence — that's the wrapper's
 * job (`FundingFlipKillSwitchStrategy`). The detector emits its raw
 * per-snapshot verdict; the wrapper accumulates the persistence rule
 * across the timeline.
 */
export interface RegimeDecision {
  readonly regimeActive: boolean;
  readonly flipRegime: boolean;
  readonly negativeDominanceRegime: boolean;
  readonly extremeRegime: boolean;
  readonly reason: string;
}

export function evaluateRegime(metrics: FlipDetectorMetrics, cfg: FlipDetectorConfig): RegimeDecision {
  // Insufficient history → no regime declared.
  if (metrics.windowSize < cfg.flipWindowDays * 3 * 0.5) {
    return {
      regimeActive: false,
      flipRegime: false,
      negativeDominanceRegime: false,
      extremeRegime: false,
      reason: "insufficient-history",
    };
  }

  const flipRegime = metrics.flipCount >= cfg.flipThreshold;
  const negativeDominanceRegime = metrics.negativeDominance >= cfg.negativeDominanceThreshold;
  const extremeRegime = metrics.zscore >= cfg.extremeZscoreThreshold;
  const regimeActive = flipRegime || negativeDominanceRegime || extremeRegime;

  let reason = "calm";
  if (flipRegime) reason = `flip-regime(${metrics.flipCount}≥${cfg.flipThreshold})`;
  else if (negativeDominanceRegime)
    reason = `negative-dominance(${(metrics.negativeDominance * 100).toFixed(1)}%≥${(cfg.negativeDominanceThreshold * 100).toFixed(0)}%)`;
  else if (extremeRegime) reason = `extreme-vol(z=${metrics.zscore.toFixed(2)}≥${cfg.extremeZscoreThreshold})`;

  return { regimeActive, flipRegime, negativeDominanceRegime, extremeRegime, reason };
}

// ---------------------------------------------------------------------------
// Mutable state held by the kill-switch wrapper during a backtest run.
// ---------------------------------------------------------------------------

/**
 * `FundingFlipKillSwitchState` — mutable state of the kill-switch wrapper.
 * Exposed for the CLI runner to read after the simulation.
 */
export interface FundingFlipKillSwitchState {
  /** Trailing funding-rate history (raw 8h samples, mirrors inner carry). */
  fundingHistory: number[];
  /** Latest detector metrics snapshot. */
  lastMetrics: FlipDetectorMetrics;
  /** Latest regime decision. */
  lastRegime: RegimeDecision;
  /** True if the kill-switch is currently engaged (regime active + persistence). */
  killSwitchEngaged: boolean;
  /** Timestamp (ms) of the most recent detector signal that triggered the regime. */
  lastRegimeSignalMs: number | null;
  /** Timestamp (ms) until which the kill-switch stays engaged (regime signal + persistence). */
  killSwitchUntilMs: number | null;
  /** Number of funding snapshots during which the kill-switch was engaged. */
  carryPausedFundingPeriods: number;
  /** Number of distinct regime declarations (transitions calm→active). */
  regimeActivationCount: number;
  /** Number of distinct regime declarations (transitions active→calm). */
  regimeDeactivationCount: number;
  /** Number of times the wrapper force-exited from carry due to regime activation. */
  forcedExitCount: number;
  /** Number of times the wrapper rejected a fresh entry due to active regime. */
  blockedEntryCount: number;
  /** Number of flip-regime signals emitted (flipCount >= threshold). */
  flipRegimeSignalCount: number;
  /** Number of negative-dominance signals emitted (neg fraction >= threshold). */
  negativeDominanceSignalCount: number;
  /** Number of extreme-regime signals emitted (z-score >= threshold). */
  extremeRegimeSignalCount: number;
  /** Total funding NOT collected because the kill-switch was engaged (USD). */
  carryPausedFundingUsd: number;
}

// ---------------------------------------------------------------------------
// Kill-switch wrapper configuration
// ---------------------------------------------------------------------------

/**
 * `FundingFlipKillSwitchConfig` — config for the kill-switch wrapper.
 *
 * Inherits `baseNotionalUsd`, `timingLeverage`, `windowDays`,
 * `entryPercentile`, `exitPercentile`, `cooldownHours`,
 * `rebalanceThresholdPct`, `withdrawalLatencyMinutes`, `rebalanceCostBps`
 * from the underlying `FundingCarryTimingConfig`. Adds:
 *
 *   - `detector` — FlipDetectorConfig for thresholds (defaults in DEFAULT_FLIP_DETECTOR_CONFIG).
 *   - `killSwitchEnabled` — master switch (default true). When false, the
 *     wrapper is transparent and passes through to the underlying strategy.
 */
export interface FundingFlipKillSwitchConfig {
  readonly baseNotionalUsd: number;
  readonly timingLeverage: AllowedTimingLeverage;
  readonly windowDays: number;
  readonly entryPercentile: number;
  readonly exitPercentile: number;
  readonly cooldownHours: number;
  readonly rebalanceThresholdPct: number;
  readonly withdrawalLatencyMinutes: number;
  readonly rebalanceCostBps: number;
  readonly detector: FlipDetectorConfig;
  readonly killSwitchEnabled: boolean;
}

export const DEFAULT_FUNDING_FLIP_KILL_SWITCH_CONFIG: FundingFlipKillSwitchConfig = {
  baseNotionalUsd: 10_000,
  timingLeverage: 10, // 1:10 = 10× notional — USER-MANDATED
  windowDays: 30,
  entryPercentile: 0.75,
  exitPercentile: 0.5,
  cooldownHours: 72,
  rebalanceThresholdPct: 0.05,
  withdrawalLatencyMinutes: 15,
  rebalanceCostBps: 20,
  detector: DEFAULT_FLIP_DETECTOR_CONFIG,
  killSwitchEnabled: true,
};

// ---------------------------------------------------------------------------
// Kill-switch strategy wrapper
// ---------------------------------------------------------------------------

/**
 * `FundingFlipKillSwitchStrategy` — wraps `FundingCarryTimingStrategy` with
 * a funding-flip regime detector + persistence filter that pauses carry
 * during flip / negative-dominance / extreme-volatility regimes.
 *
 * Design:
 *
 *   1. **Detector**: rolling-7d sign-flip counter + rolling-7d negative-
 *      dominance fraction + rolling-7d |rate| z-score (vs 30d baseline).
 *
 *   2. **Regime**: kill-switch is "armed" whenever the detector emits a
 *      regime-active verdict.
 *
 *   3. **Persistence**: once armed, the kill-switch stays engaged for
 *      ≥7d after the last regime signal. Anti-whipsaw: prevents
 *      alternating carry on/off within a flip regime.
 *
 *   4. **Carry pause**: when engaged, `accrueFundingOnSnapshot()` returns
 *      0 (no funding applied), AND if the inner carry is in carry, it
 *      is force-exited to cash via `_exitCarry()`.
 *
 *   5. **Entry block**: when engaged, the underlying timing state machine
 *      is still allowed to compute enter/exit decisions (so we preserve
 *      the warmup stats), but `_enterCarry()` calls are blocked. The
 *      state machine transitions to "isInCarry=false" via forced exit
 *      but doesn't enter fresh positions.
 *
 *   6. **Hard guardrail**: 1:10 leverage only (inherited from the
 *      underlying strategy + re-validated at this layer via
 *      `assert1to10Leverage()`).
 *
 * The wrapper implements the `Strategy` interface (delegates
 * `onCandle`/`warmup` to the inner strategy) but adds:
 *   - `recordFundingSample()` — appends to history + drives the detector
 *   - `accrueFundingOnSnapshot()` — pauses when kill-switch is engaged
 *   - `evaluateTiming()` — returns "hold" when kill-switch is engaged
 *     (in addition to the inner strategy's hold/exit decisions)
 *   - `forceExitIfRegimeActive()` — explicitly exits carry when regime
 *     transitions to active while in carry
 */
export class FundingFlipKillSwitchStrategy implements Strategy {
  readonly name = "Funding-Flip Kill-Switch Strategy (Phase 9 9D, 1:10 leverage)";
  readonly timeframes = ["1h", "4h", "1d"] as const;
  readonly config: FundingFlipKillSwitchConfig;
  readonly state: FundingFlipKillSwitchState;

  /** Underlying Track E carry engine — does the timing + accrual bookkeeping. */
  readonly underlying: FundingCarryTimingStrategy;

  constructor(config: Partial<FundingFlipKillSwitchConfig> = {}) {
    const merged: FundingFlipKillSwitchConfig = {
      ...DEFAULT_FUNDING_FLIP_KILL_SWITCH_CONFIG,
      ...config,
      detector: { ...DEFAULT_FLIP_DETECTOR_CONFIG, ...(config.detector ?? {}) },
    };
    // HARD GUARDRAIL: defense in depth — reject any leverage ≠ {1, 10} BEFORE
    // passing to the underlying strategy. Both layers assert.
    assert1to10Leverage(merged.timingLeverage);
    this.config = merged;
    this.underlying = new FundingCarryTimingStrategy({
      baseNotionalUsd: merged.baseNotionalUsd,
      timingLeverage: merged.timingLeverage,
      windowDays: merged.windowDays,
      entryPercentile: merged.entryPercentile,
      exitPercentile: merged.exitPercentile,
      cooldownHours: merged.cooldownHours,
      rebalanceThresholdPct: merged.rebalanceThresholdPct,
      withdrawalLatencyMinutes: merged.withdrawalLatencyMinutes,
      rebalanceCostBps: merged.rebalanceCostBps,
    });
    this.state = {
      fundingHistory: [],
      lastMetrics: {
        flipCount: 0,
        negativeDominance: 0,
        absRateMean: 0,
        absRateStdDev: 0,
        baselineAbsRateMean: 0,
        baselineAbsRateStdDev: 0,
        zscore: 0,
        windowSize: 0,
        baselineWindowSize: 0,
      },
      lastRegime: {
        regimeActive: false,
        flipRegime: false,
        negativeDominanceRegime: false,
        extremeRegime: false,
        reason: "init",
      },
      killSwitchEngaged: false,
      lastRegimeSignalMs: null,
      killSwitchUntilMs: null,
      carryPausedFundingPeriods: 0,
      regimeActivationCount: 0,
      regimeDeactivationCount: 0,
      forcedExitCount: 0,
      blockedEntryCount: 0,
      flipRegimeSignalCount: 0,
      negativeDominanceSignalCount: 0,
      extremeRegimeSignalCount: 0,
      carryPausedFundingUsd: 0,
    };
  }

  warmup(): number {
    // Detector needs 30d baseline + 7d flip window → 30d at 24h/d = 720 candles.
    // Underlying needs 30d → 720 candles. So warmup is 720.
    return Math.max(this.underlying.warmup(), this.config.detector.volWindowDays * 24);
  }

  /**
   * `recordFundingSample` — append a new 8h funding snapshot to the
   * rolling history AND drive the flip-regime detector. Returns the
   * post-update regime decision.
   *
   ** Persistence semantics (revised to align with the brief):
   *
   *   The detector's `regimeActive` verdict at time T is based on the
   *   trailing 7d funding-rate window ending at T. The window itself
   *   provides natural persistence: regime-characteristic data must age
   *   out of the 7d window before the detector can declare "calm".
   *
   *   On top of the natural 7d window persistence, an explicit
   *   `persistenceDays` hold keeps the kill-switch engaged for an
   *   additional `persistenceDays` after the LAST regime-active signal,
   *   to handle brief calm periods WITHIN the regime (anti-whipsaw).
   *
   *   Implementation: `killSwitchUntilMs` is updated to
   *   `timestampMs + persistenceDays` on EVERY regime-active snapshot
   *   AND every calm snapshot that occurs while the persistence window
   *   is still open. Once `timestampMs >= killSwitchUntilMs` AND the
   *   detector says calm, disengage.
   */
  recordFundingSample(fundingRate: number, timestampMs: number): RegimeDecision {
    if (!Number.isFinite(fundingRate)) {
      throw new Error(`fundingRate must be finite, got ${fundingRate}`);
    }
    this.state.fundingHistory.push(fundingRate);
    // Trim to the rolling window (vol window × 3 snaps/day + buffer).
    const maxEntries = this.config.detector.volWindowDays * 3 + 8;
    if (this.state.fundingHistory.length > maxEntries) {
      this.state.fundingHistory.splice(
        0,
        this.state.fundingHistory.length - maxEntries,
      );
    }

    // Compute metrics + regime decision.
    const metrics = computeFlipDetectorMetrics(this.state.fundingHistory, this.config.detector);
    const decision = evaluateRegime(metrics, this.config.detector);
    this.state.lastMetrics = metrics;
    this.state.lastRegime = decision;

    // Track per-regime signal counts.
    if (decision.flipRegime) this.state.flipRegimeSignalCount += 1;
    if (decision.negativeDominanceRegime) this.state.negativeDominanceSignalCount += 1;
    if (decision.extremeRegime) this.state.extremeRegimeSignalCount += 1;

    const persistenceMs = this.config.detector.persistenceDays * 24 * 60 * 60 * 1000;

    if (this.config.killSwitchEnabled) {
      // Determine whether the CURRENT snapshot contributes to a regime.
      // This is the "fresh signal" — the detector's "last signal" in
      // the brief's sense (a NEW regime-characteristic observation, not
      // historical data that the trailing window still contains).
      const isFreshFlippy = this._isFreshFlippySignal();
      const isFreshNegative = fundingRate < 0;
      const isFreshExtreme =
        metrics.zscore >= this.config.detector.extremeZscoreThreshold;
      const isFreshRegimeSignal =
        (decision.flipRegime && isFreshFlippy) ||
        (decision.negativeDominanceRegime && isFreshNegative) ||
        (decision.extremeRegime && isFreshExtreme);

      if (isFreshRegimeSignal) {
        this.state.lastRegimeSignalMs = timestampMs;
        const newUntil = timestampMs + persistenceMs;
        if (this.state.killSwitchUntilMs === null || newUntil > this.state.killSwitchUntilMs) {
          this.state.killSwitchUntilMs = newUntil;
        }
        const wasEngaged = this.state.killSwitchEngaged;
        this.state.killSwitchEngaged = true;
        if (!wasEngaged) {
          this.state.regimeActivationCount += 1;
        }
      } else if (
        this.state.killSwitchUntilMs !== null &&
        timestampMs >= this.state.killSwitchUntilMs
      ) {
        if (this.state.killSwitchEngaged) {
          this.state.regimeDeactivationCount += 1;
        }
        this.state.killSwitchEngaged = false;
      }
      // Else: calm signal (no fresh regime-characteristic data) but still
      // within persistence window → stay engaged.
    }

    return decision;
  }

  /**
   * `_isFreshFlippySignal` — the CURRENT snapshot has a sign flip with
   * the PREVIOUS snapshot. This is the "fresh signal" that triggers
   * persistence extension. Pure functional helper.
   */
  private _isFreshFlippySignal(): boolean {
    const h = this.state.fundingHistory;
    if (h.length < 2) return false;
    const prev = h[h.length - 2]!;
    const cur = h[h.length - 1]!;
    if (prev === 0 || cur === 0) return false;
    return (prev > 0) !== (cur > 0);
  }

  /**
   * `isKillSwitchEngaged` — read-only accessor for the current
   * kill-switch state. The CLI runner calls this to gate
   * `accrueFundingOnSnapshot`.
   */
  isKillSwitchEngaged(timestampMs: number): boolean {
    if (!this.config.killSwitchEnabled) return false;
    if (this.state.killSwitchUntilMs === null) return false;
    if (timestampMs < this.state.killSwitchUntilMs) return true;
    return false;
  }

  /**
   * `evaluateTiming` — pure-functional decision: should we be in carry
   * or out? Returns the inner strategy's verdict, but DOWNGRADES to
   * `'hold'` if the kill-switch is engaged (no fresh entry signals
   * while engaged).
   *
   * Note: the underlying strategy's `_exitCarry()` is the cleanup path —
   * if we're in carry when the regime flips active, the wrapper calls
   * `forceExitIfRegimeActive()` to close the position.
   */
  evaluateTiming(currentFundingRate: number, timestampMs: number): "enter" | "exit" | "hold" {
    if (this.isKillSwitchEngaged(timestampMs)) {
      // While the kill-switch is engaged, we don't take new entries.
      // If already in carry, the inner strategy's exit logic still
      // applies (the wrapper's forceExitIfRegimeActive has already
      // exited on regime-activation), so state.isInCarry is false.
      // Return 'hold' to be safe.
      return "hold";
    }
    return this.underlying.evaluateTiming(currentFundingRate, timestampMs);
  }

  /**
   * `forceExitIfRegimeActive` — call after `recordFundingSample()`. If
   * the kill-switch just engaged and we're currently in carry, force
   * the underlying strategy out of carry. This is the cleanup that
   * prevents the inner strategy from collecting negative-funding while
   * the regime is active.
   */
  forceExitIfRegimeActive(timestampMs: number): boolean {
    if (!this.isKillSwitchEngaged(timestampMs)) return false;
    if (!this.underlying.state.isInCarry) return false;
    this.underlying._exitCarry(timestampMs);
    this.state.forcedExitCount += 1;
    return true;
  }

  /**
   * `accrueFundingOnSnapshot` — apply one 8h funding payment at the
   * SCALED notional (base × 1:10 leverage). When the kill-switch is
   * engaged, returns 0 and skips accrual entirely. The carry-paused
   * income (what we WOULD have earned if not paused) is tracked in
   * `state.carryPausedFundingUsd` for diagnostics, computed via the
   * pure-functional `getWouldBeFunding()` helper.
   *
   * Returns the payment in USD (positive = earned, negative = paid).
   * 0 = skipped (kill-switch engaged OR not in carry).
   */
  accrueFundingOnSnapshot(snap: FundingSnapshot, timestampMs: number): number {
    if (this.isKillSwitchEngaged(timestampMs)) {
      this.state.carryPausedFundingPeriods += 1;
      // Compute what we would have earned/paid without mutating the
      // underlying's accounting state.
      const wouldBe = this.getWouldBeFunding(snap);
      this.state.carryPausedFundingUsd += Math.abs(wouldBe);
      return 0;
    }
    // Kill-switch not engaged — delegate to underlying (which mutates
    // its own state).
    return this.underlying.accrueFundingOnSnapshot(snap);
  }

  /**
   * `getWouldBeFunding` — compute the funding payment at the SCALED
   * notional for a given snapshot, WITHOUT mutating underlying state.
   * Used by the CLI runner to track "carry paused USD" (the income
   * we forgo when the kill-switch is engaged).
   */
  getWouldBeFunding(snap: FundingSnapshot): number {
    if (!this.underlying.state.isInCarry) return 0;
    return snap.fundingRate * this.underlying.effectiveNotionalUsd;
  }

  /**
   * `onCandle` — Strategy interface implementation. Delegates to the
   * inner carry. When the kill-switch is engaged, returns null (no
   * fresh entry).
   */
  onCandle(ctx: StrategyContext): StrategySignal | null {
    if (this.isKillSwitchEngaged(ctx.candle.timestamp)) {
      return null;
    }
    return this.underlying.onCandle(ctx);
  }

  /**
   * `totalNetPnlUsd` — net PnL of the underlying strategy, minus the
   * carry-paused USD (we display the latter as a diagnostic only).
   */
  totalNetPnlUsd(): number {
    return this.underlying.totalNetPnlUsd();
  }

  /**
   * `triggerRebalanceIfNeeded` — pass-through to the underlying carry's
   * rebalance trigger. When the kill-switch is engaged, rebalance is
   * skipped (no point rebalancing a position we just exited).
   */
  triggerRebalanceIfNeeded(unrealizedDeltaUsd: number, timestampMs: number): boolean {
    if (this.isKillSwitchEngaged(timestampMs)) return false;
    return this.underlying.triggerRebalanceIfNeeded(unrealizedDeltaUsd);
  }

  /**
   * `underlyingCarryState` — read-only view of the inner Track E
   * timing strategy's state (FundingCarryTimingState). Use this for
   * timing-layer diagnostics (fundingCollectedUsd, inCarryPeriods,
   * entryCount, etc.).
   */
  get underlyingCarryState() {
    return this.underlying.state;
  }

  /**
   * `underlyingBaseCarryState` — read-only view of the deepest
   * FundingCarryStrategy state (Phase 6 Track A). Use this for
   * rebalance bookkeeping (rebalanceCount, rebalanceCostUsd), which
   * is owned by the base carry layer.
   */
  get underlyingBaseCarryState() {
    return this.underlying.underlyingBaseCarry.state;
  }

  /**
   * `reset` — clear all state for a fresh backtest run.
   */
  reset(): void {
    this.underlying.reset();
    this.state.fundingHistory = [];
    this.state.lastMetrics = {
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
    this.state.lastRegime = {
      regimeActive: false,
      flipRegime: false,
      negativeDominanceRegime: false,
      extremeRegime: false,
      reason: "reset",
    };
    this.state.killSwitchEngaged = false;
    this.state.lastRegimeSignalMs = null;
    this.state.killSwitchUntilMs = null;
    this.state.carryPausedFundingPeriods = 0;
    this.state.regimeActivationCount = 0;
    this.state.regimeDeactivationCount = 0;
    this.state.forcedExitCount = 0;
    this.state.blockedEntryCount = 0;
    this.state.flipRegimeSignalCount = 0;
    this.state.negativeDominanceSignalCount = 0;
    this.state.extremeRegimeSignalCount = 0;
    this.state.carryPausedFundingUsd = 0;
  }
}

// ---------------------------------------------------------------------------
// Public re-exports
// ---------------------------------------------------------------------------

export type { AllowedTimingLeverage, FundingCarryTimingConfig, FundingCarryTimingState, RollingWindowStats };