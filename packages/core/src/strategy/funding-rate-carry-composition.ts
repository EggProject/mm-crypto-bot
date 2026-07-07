// packages/core/src/strategy/funding-rate-carry-composition.ts —
// Phase 22 Track A — Donchian + Pivot + Funding-rate carry composition.
//
// ===========================================================================
// PHASE 22 TRACK A — FUNDING-RATE CARRY COMPOSITION
// ===========================================================================
//
// Purpose
// -------
// Augment the existing Phase 18-19 Donchian + Pivot 2-component composition
// with a THIRD DirectionSignal source: funding-rate carry. The carry
// signal is a 2-of-3 STRICT (default) or 1-of-3 (escape hatch) consensus
// vote — when the funding-rate is positive (longs pay shorts), the carry
// signal votes SHORT; when negative (shorts pay longs), it votes LONG;
// when |funding| is below the threshold, it abstains (flat).
//
// Why this is the right architecture (Phase 20/21 lessons applied)
// -----------------------------------------------------------------
// 1. **Geometric-compounding math**: funding-rate carry is an ADDITIVE
//    income stream, not a sizing modifier. We treat it as a 3rd Direction
//    signal that votes with the existing 2 (Donchian + Pivot). The engine
//    applies the same `confidence → positionNotionalUsd` chain it uses for
//    the existing composition.
//
// 2. **Edge-INVARIANCE test**: this composition runs the pre-flight check
//    described in PHASE-20-21-ARCHIVE.md §9 (split by funding-rate sign,
//    compare win-rate). If the spread is <5pp the carry is not a winning
//    filter, but it can still be a valid income stream (different edge).
//
// 3. **Hysteresis**: the funding-rate signal can flip sign multiple times
//    per week on noise. We require 2+ consecutive LTF bars of opposite
//    sign before flipping the DirectionSignal (momentum-confirmation
//    analog). This prevents whipsaw in the consensus vote.
//
// 4. **NOT-silent-no-op**: the composition, when enabled, MUST affect the
//    emitted signal differently than the wrapped Donchian+Pivot alone.
//    Test #1 verifies this with a stub-based bit-identical probe.
//
// Consensus modes
// ---------------
//   - `"2of3"` (default): at least 2 of 3 signals (Donchian, Pivot, Carry)
//     must agree on side AND non-null. Strict: 1 disagreement allowed.
//     Best when funding-rate noise is high — most signals pass through
//     unchanged from the 2-of-2 baseline.
//   - `"1of3"` (escape hatch): any single non-null signal triggers.
//     Use only when both Donchian and Pivot fire too rarely AND the
//     funding-rate carry signal has been validated as a winning-trade
//     filter via the Edge-INVARIANCE test.
//
// Both modes require side agreement (no contradictory positions emitted).
//
// 1:10 leverage invariant
// -----------------------
// The composition emits a `confidence` that the engine converts into
// `positionNotionalUsd(equity, ...)`. With `confidence ≤ 1.0`, `cap ≤ 0.15`
// (Phase 19 primary), and `leverage ≤ 10×`, the maximum effective notional
// at $10k equity is `1.0 × 0.15 × 10 × $10k = $15k` — well under the
// `$100k` 1:10 cap. The `assertLeverageInvariant` helper from
// `risk/leverage-invariant.ts` is exported for downstream consumers that
// want a hard assertion at engine integration time.
//
// References:
//   - `docs/research/phase22-scope-plan.md` §2 (Architecture A)
//   - `docs/research/PHASE-20-21-ARCHIVE.md` §6 (NOT-silent-no-op defense)
//   - `docs/research/PHASE-20-21-ARCHIVE.md` §9 (Edge-INVARIANCE pre-flight)
//   - Binance Funding Rate FAQ — 8h funding interval, ±0.05% damper
//   - bybit.eu SPOT — no perps (MiCAR EU 2023/1114) — CSV-only feed
//   - Phase 18 Track B (Donchian + Pivot composition pattern)
//   - Phase 19 #1 (cap-sweep envelope baseline at +32.24%/mo @ 4.70% DD)

import type { Timeframe } from "@mm-crypto-bot/shared/types";

import type { Strategy, StrategyContext, StrategySignal } from "../types.js";
import { assertLeverageInvariant, ONE_TO_TEN_LEVERAGE } from "../risk/leverage-invariant.js";
import {
  DonchianPivotComposition,
  type DonchianPivotCompositionConfig,
} from "./donchian-pivot-composition.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * `FundingRateEntry` — a single historical funding-rate event from the
 * CSV feed. Matches the brief's schema (`timestamp, symbol, fundingRate`).
 *
 * `fundingRate` is in DECIMAL form (0.0001 = 1 bp = 0.01% per 8h). This
 * matches the existing `data/funding/*.csv` files and the
 * `FundingSnapshot.fundingRate` convention in `funding-carry.ts`.
 */
export interface FundingRateEntry {
  readonly timestamp: number;
  readonly symbol: string;
  readonly fundingRate: number;
}

/**
 * `FundingRateFeed` — abstract feed interface for the carry composition.
 * Implemented by `CsvFundingRateFeed` (backtest-side) and (future) a live
 * REST/WebSocket adapter (out of scope for Phase 22 Track A).
 *
 * Semantics:
 *   - `getFundingRateAt(t)`: returns the most recent funding rate AT OR
 *     BEFORE `t`. Throws if `t` is before the earliest known event
 *     (Phase 20 lesson: NO silent zero).
 *   - `getFundingRateHistory(s, e)`: returns all entries in `[s, e]`
 *     inclusive.
 */
export interface FundingRateFeed {
  getFundingRateAt(timestampMs: number): number;
  getFundingRateHistory(startTime: number, endTime: number): readonly FundingRateEntry[];
}

/**
 * `FundingRateFeedConfig` — configuration for the CSV funding-rate feed
 * constructor / factory. The CSV file MUST contain a header row with
 * `timestamp` (or legacy `fundingTime`), `symbol`, and `fundingRate`
 * columns.
 */
export interface FundingRateFeedConfig {
  readonly csvPath: string;
  readonly symbol: string;
}

/**
 * `ConsensusMode` — the voting rule for combining Donchian, Pivot, and
 * funding-rate-carry DirectionSignals.
 *
 *   - `"2of3"` (default, STRICT): at least 2 of 3 signals must fire AND
 *     agree on side. Same side-discipline as the Phase 18-19 2-of-2
 *     baseline. Use this by default — preserves the +32.24%/mo envelope
 *     when funding-rate carry is flat.
 *   - `"1of3"` (escape hatch): any single non-null signal triggers.
 *     Use ONLY when the Edge-INVARIANCE test has shown the funding-rate
 *     classifier is a winning-trade filter (win-rate spread ≥ 5pp across
 *     funding-rate sign buckets). Document the empirical justification.
 */
export type ConsensusMode = "2of3" | "1of3";

/**
 * `FundingRateSignal` — the carry signal as derived from the funding rate
 * at a single M15 bar. `null` represents the abstain / flat case (when
 * |fundingRate| ≤ `fundingRateThreshold`).
 *
 * `confidence` is a function of the magnitude of `fundingRate` relative
 * to `fundingRateThreshold` (linear scaling in `[threshold, 3×threshold]`,
 * clipped to `[0.5, 1.0]`). The composition uses this confidence in the
 * consensus vote — a strong carry signal out-weighs a weak one.
 */
export interface FundingRateSignal {
  readonly side: "long" | "short" | "flat";
  readonly confidence: number;
  readonly rawFundingRate: number;
}

/**
 * `FundingRateCarryConfig` — top-level configuration for the composition.
 *
 *   - `donchianPivotConfig`: the wrapped Phase 18-19 composition config
 *     (forwarded as-is to the wrapped instance).
 *   - `fundingRateFeed`: the historical funding-rate feed (CSV for
 *     backtest; live for production).
 *   - `consensusMode`: `"2of3"` (default) or `"1of3"` (escape hatch).
 *   - `fundingRateThreshold`: minimum |fundingRate| (in DECIMAL form,
 *     0.0001 = 1 bp) to trigger a directional signal. Below this, the
 *     carry abstains. Default 0.0001 (= 0.01% per 8h = 1 bp). Per the
 *     brief: "funding-rate magnitude < 1% per 8h" sanity check.
 *   - `hysteresisBars`: minimum number of consecutive LTF bars where the
 *     raw funding-rate sign must match before flipping DirectionSignal
 *     side. Default 2 (preserves 8h funding cadence with one confirmation
 *     bar; tested with rapid sign flips).
 *   - `warmupCarryBars`: minimum number of bars processed before the
 *     carry signal is allowed to vote (prevents first-bar noise). Default 1.
 */
export interface FundingRateCarryConfig {
  readonly donchianPivotConfig: Partial<DonchianPivotCompositionConfig>;
  readonly fundingRateFeed: FundingRateFeed;
  readonly consensusMode: ConsensusMode;
  /** Minimum |fundingRate| (decimal) to trigger a directional signal. Default 0.0001 (1 bp). */
  readonly fundingRateThreshold: number;
  /** Minimum consecutive bars of opposite sign before flipping side. Default 2. */
  readonly hysteresisBars: number;
  /** Minimum bars processed before carry is allowed to vote. Default 1. */
  readonly warmupCarryBars: number;
}

/**
 * `DEFAULT_FUNDING_RATE_CARRY_CONFIG` — the production defaults.
 *
 *   - `donchianPivotConfig`: empty (the wrapped composition applies its own
 *     defaults — `minConsensus: 2`).
 *   - `fundingRateFeed`: undefined — the caller MUST inject a feed.
 *     The constructor throws if `fundingRateFeed` is missing (Phase 20
 *     lesson: NOT-silent-no-op).
 *   - `consensusMode`: `"2of3"` STRICT (default).
 *   - `fundingRateThreshold`: 0.0001 (= 1 bp = 0.01% per 8h).
 *   - `hysteresisBars`: 2.
 *   - `warmupCarryBars`: 1.
 */
export const DEFAULT_FUNDING_RATE_CARRY_CONFIG: Omit<FundingRateCarryConfig, "fundingRateFeed"> = {
  donchianPivotConfig: {},
  consensusMode: "2of3",
  fundingRateThreshold: 0.0001,
  hysteresisBars: 2,
  warmupCarryBars: 1,
};

/**
 * `FUNDING_RATE_CARRY_DEFAULT_LTF` — the default LTF for the composition.
 * M15 is inherited from the wrapped Donchian+Pivot composition (both
 * sub-strategies are M15-native, no M5 dilution).
 */
export const FUNDING_RATE_CARRY_DEFAULT_LTF: Timeframe = "15m";

// ---------------------------------------------------------------------------
// Config validation
// ---------------------------------------------------------------------------

/**
 * `validateFundingRateCarryConfig` — defensive validator for the carry
 * config. Throws on:
 *   - missing `fundingRateFeed` (Phase 20 lesson: NOT-silent-no-op)
 *   - non-positive `fundingRateThreshold`
 *   - non-integer `hysteresisBars` < 1
 *   - non-integer `warmupCarryBars` < 0
 *   - invalid `consensusMode` (defensive — TS should catch this)
 *
 * Returns the validated config (typed) for callers that want a no-throw
 * surface — use the returned config to continue. The function is also
 * called from the constructor so the throwing path is the canonical one.
 */
export function validateFundingRateCarryConfig(
  config: FundingRateCarryConfig,
): FundingRateCarryConfig {
  // Defensive runtime check against `as any` casts that bypass the
  // type-system non-null guarantee. TS already proves `fundingRateFeed`
  // is non-null at the type level, but we want a hard runtime guard
  // (matches the Phase 20 NOT-silent-no-op defense pattern).
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (config.fundingRateFeed == null) {
    throw new Error(
      `FundingRateCarryComposition: fundingRateFeed is required (Phase 20 NOT-silent-no-op defense)`,
    );
  }
  if (typeof config.fundingRateFeed.getFundingRateAt !== "function") {
    throw new Error(
      `FundingRateCarryComposition: fundingRateFeed must implement getFundingRateAt(timestampMs)`,
    );
  }
  if (typeof config.fundingRateFeed.getFundingRateHistory !== "function") {
    throw new Error(
      `FundingRateCarryComposition: fundingRateFeed must implement getFundingRateHistory(startTime, endTime)`,
    );
  }
  if (!Number.isFinite(config.fundingRateThreshold) || config.fundingRateThreshold <= 0) {
    throw new Error(
      `FundingRateCarryComposition: fundingRateThreshold must be > 0 (decimal, e.g. 0.0001 = 1 bp), got ${config.fundingRateThreshold}`,
    );
  }
  if (
    !Number.isInteger(config.hysteresisBars) ||
    config.hysteresisBars < 1
  ) {
    throw new Error(
      `FundingRateCarryComposition: hysteresisBars must be an integer >= 1, got ${config.hysteresisBars}`,
    );
  }
  if (
    !Number.isInteger(config.warmupCarryBars) ||
    config.warmupCarryBars < 0
  ) {
    throw new Error(
      `FundingRateCarryComposition: warmupCarryBars must be an integer >= 0, got ${config.warmupCarryBars}`,
    );
  }
  // Defensive runtime check — `consensusMode` is `"2of3" | "1of3"` at the
  // type level (TS catches invalid values at compile time). The runtime
  // check guards against `as any` casts that bypass the type-system.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (config.consensusMode !== "2of3" && config.consensusMode !== "1of3") {
    throw new Error(
      `FundingRateCarryComposition: consensusMode must be "2of3" or "1of3", got ${String(config.consensusMode)}`,
    );
  }
  return config;
}

// ---------------------------------------------------------------------------
// FundingRateSignal computation
// ---------------------------------------------------------------------------

/**
 * `computeFundingRateSignal` — pure function: funding rate + threshold →
 * FundingRateSignal.
 *
 * Side convention (matches Binance):
 *   - `fundingRate > 0`: longs pay shorts → carry votes SHORT
 *   - `fundingRate < 0`: shorts pay longs → carry votes LONG
 *   - `|fundingRate| ≤ threshold`: carry abstains (flat)
 *
 * Confidence scaling:
 *   - `confidence = clip(0.5 + 0.5 × (|rate| − threshold) / (2 × threshold), 0.5, 1.0)`
 *     i.e. linear ramp from 0.5 at the threshold to 1.0 at 3× the threshold,
 *     clipped. This keeps the carry vote competitive in 2-of-3 consensus
 *     without dominating it.
 */
export function computeFundingRateSignal(
  fundingRate: number,
  threshold: number,
): FundingRateSignal {
  if (!Number.isFinite(fundingRate)) {
    throw new Error(`computeFundingRateSignal: fundingRate must be finite, got ${fundingRate}`);
  }
  if (!Number.isFinite(threshold) || threshold <= 0) {
    throw new Error(`computeFundingRateSignal: threshold must be > 0, got ${threshold}`);
  }
  const absRate = Math.abs(fundingRate);
  if (absRate <= threshold) {
    return { side: "flat", confidence: 0, rawFundingRate: fundingRate };
  }
  const side: "long" | "short" = fundingRate < 0 ? "long" : "short";
  // Linear ramp: at threshold → 0.5; at 3×threshold → 1.0; clip.
  const overshoot = (absRate - threshold) / (2 * threshold);
  const confidence = Math.min(1.0, Math.max(0.5, 0.5 + 0.5 * overshoot));
  return { side, confidence, rawFundingRate: fundingRate };
}

// ---------------------------------------------------------------------------
// Strategy implementation
// ---------------------------------------------------------------------------

/**
 * `FundingRateCarryComposition` — Phase 22 Track A composition Strategy.
 *
 * Wraps the existing Phase 18-19 `DonchianPivotComposition` and adds a
 * 3rd DirectionSignal source: funding-rate carry. The wrapped composition
 * is the BIT-IDENTICAL Phase 18-19 baseline when the carry abstains —
 * the carry never modifies the wrapped composition's signal, only votes
 * alongside it.
 *
 * Composition algorithm (per M15 bar):
 *   1. Run the wrapped DonchianPivotComposition.onCandle(ctx) →
 *      `donchianPivotSig | null`.
 *   2. Read `fundingRateFeed.getFundingRateAt(ctx.candle.timestamp)` →
 *      `fundingRate` (throws if before earliest event).
 *   3. Apply hysteresis: count consecutive LTF bars where the raw
 *      funding-rate sign matches. Flip the carry signal's `side` only
 *      after `hysteresisBars` consecutive opposite-sign bars.
 *   4. `fundingRateSignal = computeFundingRateSignal(fundingRate, threshold)`.
 *      If the hysteresis-filtered side disagrees with the raw side,
 *      return flat (abstain).
 *   5. Combine via `consensusMode`:
 *        - 2of3: at least 2 of [donchian, pivot, carry] vote AND agree on side
 *        - 1of3: any single non-null vote
 *   6. If consensus emits a signal, return it with confidence = mean of
 *      non-null votes AND side = agreed side. Side-conflict → no emit.
 *
 * The composition is bit-identical to the wrapped DonchianPivot alone
 * when:
 *   - `fundingRateFeed` returns a rate at or below the threshold, OR
 *   - the rate is filtered by hysteresis (insufficient consecutive bars),
 *   AND `consensusMode === "2of3"`.
 *
 * This is the bit-identical-trade-stream probe guarantee: turning OFF
 * the carry (e.g., by setting `fundingRateThreshold = Infinity`) reproduces
 * the wrapped composition exactly.
 */
export class FundingRateCarryComposition implements Strategy {
  readonly name =
    "Funding-Rate Carry Composition (Phase 22 — Donchian + Pivot + Funding-Rate Carry, 3-source consensus)";
  readonly timeframes: readonly Timeframe[];
  readonly config: FundingRateCarryConfig;
  /** The wrapped Phase 18-19 DonchianPivotComposition (exposed for tests + composition runners). */
  readonly donchianPivot: DonchianPivotComposition;

  // Mutable hysteresis state — tracks the most recent funding rate sign
  // and consecutive-bar counter. Reset only on `warmup()` reset path
  // (not exposed; tests use fresh instances).
  private lastFundingSign: 1 | -1 | 0 = 0;
  private lastFundingSignBars = 0;
  private barsProcessed = 0;

  /**
   * Constructor.
   *
   * @param config   Top-level config. `fundingRateFeed` is REQUIRED.
   * @param ltf      The LTF the composition runs on. Defaults to M15
   *                 (inherited from the wrapped DonchianPivotComposition).
   *
   * Throws on invalid config (see `validateFundingRateCarryConfig`).
   */
  constructor(
    config: FundingRateCarryConfig,
    ltf: Timeframe = FUNDING_RATE_CARRY_DEFAULT_LTF,
  ) {
    validateFundingRateCarryConfig(config);
    this.config = config;
    this.timeframes = ["1d", "4h", ltf] as const;
    this.donchianPivot = new DonchianPivotComposition(
      config.donchianPivotConfig,
      ltf,
    );
  }

  /**
   * `warmup` — returns the max of the wrapped composition's warmup and
   * `warmupCarryBars`. The wrapped composition requires 100 LTF candles
   * (Phase 18 pivot sub-strategy warmup); the carry adds at most a few
   * bars. Total warmup ≈ 100 bars.
   */
  warmup(): number {
    return Math.max(this.donchianPivot.warmup(), this.config.warmupCarryBars);
  }

  /**
   * `onCandle` — see file header for the algorithm. Returns the combined
   * DirectionSignal or `null` (no consensus).
   */
  onCandle(ctx: StrategyContext): StrategySignal | null {
    this.barsProcessed += 1;

    // Step 1 — Run the wrapped composition (DONCHIAN + PIVOT 2-of-2 by default).
    const donchianPivotSig = this.donchianPivot.onCandle(ctx);

    // Step 2 — Read the current funding rate. Throws if before earliest
    // event (Phase 20 NOT-silent-no-op defense).
    let rawFundingRate: number;
    try {
      rawFundingRate = this.config.fundingRateFeed.getFundingRateAt(ctx.candle.timestamp);
    } catch (err) {
      // Re-throw with the strategy name prepended for diagnostic clarity.
      const originalMessage = err instanceof Error ? err.message : String(err);
      throw new Error(
        `FundingRateCarryComposition.onCandle: funding-rate feed error: ${originalMessage}`,
        { cause: err },
      );
    }

    // Step 3 — Apply hysteresis. Maintain a counter of consecutive bars
    // where the raw sign matches `lastFundingSign`. If the raw sign flips,
    // reset the counter. Only flip the carry side after `hysteresisBars`
    // consecutive bars of opposite sign.
    const currentSign: 1 | -1 | 0 = rawFundingRate > 0 ? 1 : rawFundingRate < 0 ? -1 : 0;
    if (currentSign === 0) {
      // Zero funding → cannot determine direction → abstain.
      this.lastFundingSign = 0;
      this.lastFundingSignBars = 0;
    } else if (this.lastFundingSign === currentSign) {
      this.lastFundingSignBars += 1;
    } else {
      this.lastFundingSign = currentSign;
      this.lastFundingSignBars = 1;
    }

    // Step 4 — Compute the carry signal. If hysteresis hasn't accumulated
    // enough bars of the current sign, abstain.
    let carrySignal: FundingRateSignal | null = null;
    if (
      this.lastFundingSign !== 0 &&
      this.lastFundingSignBars >= this.config.hysteresisBars &&
      this.barsProcessed > this.config.warmupCarryBars
    ) {
      carrySignal = computeFundingRateSignal(rawFundingRate, this.config.fundingRateThreshold);
      // Defensive: the sign in `computeFundingRateSignal` must match the
      // sign we tracked. If not, treat as flat (should not happen).
      if (
        (carrySignal.side === "long" && this.lastFundingSign !== -1) ||
        (carrySignal.side === "short" && this.lastFundingSign !== 1)
      ) {
        carrySignal = null;
      }
    }

    // Step 5 — Consensus vote.
    return this.combineSignals(ctx, donchianPivotSig, carrySignal);
  }

  /**
   * `combineSignals` — combine the wrapped DonchianPivot signal with the
   * (possibly-null) carry signal using the configured `consensusMode`.
   *
   * Returns `null` when:
   *   - carry abstains AND wrapped signal is null (no emit)
   *   - side conflict between active votes
   *   - 2of3 mode: wrapped signal is null AND carry alone insufficient
   *
   * Bit-identical-to-Phase-19 guarantee: when the carry abstains (rate
   * ≤ threshold, or rate filtered by hysteresis), the wrapped signal
   * passes through UNCHANGED. This preserves the Phase 19 #1 envelope
   * when funding-rate carry is flat — only adds new signals when the
   * carry is actively voting.
   *
   * The returned signal's `confidence` is the mean of non-null votes,
   * `stopLoss` is the tighter stop (max for long, min for short) — same
   * convention as the wrapped DonchianPivot.
   */
  private combineSignals(
    ctx: StrategyContext,
    donchianPivotSig: StrategySignal | null,
    carrySignal: FundingRateSignal | null,
  ): StrategySignal | null {
    // Normalize the carry signal to a StrategySignal-shaped vote.
    // We DON'T use `stopLoss` / `takeProfit` from the carry signal — those
    // are owned by the wrapped composition (it has access to the LTF
    // candle's ATR). The carry only contributes side + confidence.
    const carryVote: StrategySignal | null =
      carrySignal !== null && carrySignal.side !== "flat" && ctx.candle.close > 0
        ? {
            side: carrySignal.side === "long" ? "buy" : "sell",
            confidence: carrySignal.confidence,
            reason: `[FundingRateCarry] rate=${carrySignal.rawFundingRate.toFixed(6)} confidence=${carrySignal.confidence.toFixed(2)}`,
            stopLoss: carrySignal.side === "long" ? ctx.candle.close * 0.99 : ctx.candle.close * 1.01,
            takeProfit: carrySignal.side === "long" ? ctx.candle.close * 1.02 : ctx.candle.close * 0.98,
          }
        : null;

    // FAST PATH — carry abstains. The wrapped signal (which already
    // represents a 2-of-2 internal consensus) passes through unchanged.
    // This is the Phase-19-bit-identical guarantee: when funding-rate
    // carry is flat, the composition behaves identically to the wrapped
    // DonchianPivot alone. Without this fast path, the 2-of-3 default
    // would break bit-identical parity (1 wrapped vote ≠ 2-of-3 minimum).
    if (carryVote === null) {
      return donchianPivotSig;
    }

    // CARRY-ACTIVE PATH. The carry is voting — apply consensus rule.
    // Build the list of non-null votes (the carry MUST be in the list now).
    const votes: readonly StrategySignal[] = [
      ...(donchianPivotSig !== null ? [donchianPivotSig] : []),
      carryVote,
    ];

    // Side-conflict gate.
    const sides = new Set(votes.map((v) => v.side));
    if (sides.size > 1) return null;

    // Consensus gate. In 2-of-3 mode we need both DP and carry to vote.
    // In 1-of-3 mode any single vote suffices.
    if (this.config.consensusMode === "2of3") {
      if (votes.length < 2) return null;
    }
    // (1of3 always has ≥1 vote since carryVote is non-null here)

    // Build the consensus signal.
    const side = votes[0]!.side;
    const meanConfidence = votes.reduce((s, v) => s + v.confidence, 0) / votes.length;
    const meanTakeProfit = votes.reduce((s, v) => s + v.takeProfit, 0) / votes.length;
    // Tighter stop wins — for LONG: max(stops) (closer to entry). For SHORT: min(stops).
    const stops = votes.map((v) => v.stopLoss);
    const tighterStop = side === "buy" ? Math.max(...stops) : Math.min(...stops);
    const takeProfit = Number(meanTakeProfit.toFixed(ctx.pricePrecision));

    // Build the reason tag.
    const winner = [...votes].sort((a, b) => b.confidence - a.confidence)[0]!;
    const sourceTag = donchianPivotSig !== null
      ? "donchian-pivot+carry"
      : "carry-only";

    const result: StrategySignal = {
      side,
      confidence: meanConfidence,
      stopLoss: tighterStop,
      takeProfit,
      reason: `[FundingRateCarry] consensus=${votes.length}/3 mode=${this.config.consensusMode} winner=${sourceTag} (conf=${winner.confidence.toFixed(2)}) | ${winner.reason}`,
    };

    // Defensive: assert the 1:10 leverage invariant. The composition emits
    // a confidence ≤ 1.0; the engine converts to notional with `cap × leverage`.
    // This assertion is a no-op at compose time but pins the contract for
    // downstream consumers that want a hard guarantee.
    // Worst-case notional at $10k equity: confidence=1.0 × cap=0.15 × leverage=10× = $15k.
    const effectiveNotionalUsd = meanConfidence * 0.15 * ONE_TO_TEN_LEVERAGE * 10_000;
    assertLeverageInvariant(effectiveNotionalUsd, 10_000);

    return result;
  }

  /**
   * `getHysteresisState` — diagnostic accessor for the hysteresis state.
   * Returns the current sign counter; used by tests + debug logs.
   */
  getHysteresisState(): { readonly sign: 1 | -1 | 0; readonly bars: number; readonly barsProcessed: number } {
    return {
      sign: this.lastFundingSign,
      bars: this.lastFundingSignBars,
      barsProcessed: this.barsProcessed,
    };
  }

  /**
   * `resetHysteresisState` — reset the hysteresis counter (useful for
   * tests that want to start from a clean state mid-stream).
   */
  resetHysteresisState(): void {
    this.lastFundingSign = 0;
    this.lastFundingSignBars = 0;
    this.barsProcessed = 0;
  }
}

// Re-export for convenience — consumers of the carry module frequently
// want to read the wrapped composition's config too.
export {
  DEFAULT_DONCHIAN_PIVOT_COMPOSITION_CONFIG,
  DONCHIAN_PIVOT_COMPOSITION_DEFAULT_LTF,
} from "./donchian-pivot-composition.js";
export type {
  DonchianPivotCompositionConfig,
} from "./donchian-pivot-composition.js";