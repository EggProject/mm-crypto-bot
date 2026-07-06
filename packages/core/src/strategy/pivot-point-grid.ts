// packages/core/src/strategy/pivot-point-grid.ts — Pivot-Point range-mean-reversion
// strategy on M15 LTF.
//
// Phase 15 Track B Strategy #1 — pivot-anchored grid using the previous
// daily candle's range. Pivots are deterministic (no parameter fitting
// other than the three Fibonacci multipliers), and work uniformly across
// instruments and regimes.
//
// Pivot point math (the brief's spec, see Phase 15 plan §2 / docstring):
//
//   PP  = (H + L + C) / 3                   ← classic pivot mean
//   R1/S1  = PP ± 0.382 × (H - L)          ← Fibonacci inner bands
//   R2/S2  = PP ± 0.618 × (H - L)          ← Fibonacci outer bands
//   R3/S3  = PP ± 1.000 × (H - L)          ← 1× range extremes
//
// Entry logic (mean-reversion to PP):
//
//   close ≤ S2     → buy    (deep overshoot)        SL = S3, TP = PP, conf = 1.0
//   S2 < close ≤ S1 → buy    (shallow overshoot)    SL = S2, TP = PP, conf = 0.7
//   close ≥ R2     → sell   (deep overbought)       SL = R3, TP = PP, conf = 1.0
//   R1 ≤ close < R2 → sell   (shallow overbought)   SL = R2, TP = PP, conf = 0.7
//   S1 < close < R1 → no signal (middle zone)
//
// HTF (1d) candle reconstruction from LTF (15m) candles:
//
//   The Strategy interface does not expose HTF OHLC directly. We
//   accumulate the running high/low/close of the in-progress 1d candle
//   from the 15m candles, and at each LTF candle whose timestamp is
//   exactly aligned to a 1d boundary (timestamp % 86_400_000 === 0),
//   we COMMIT the just-finished 1d candle's H/L/C to the previous-day
//   slots BEFORE resetting the accumulator for the new day.
//
//   Sizing (1:10) is engine-side — this strategy only emits signals.
//
// References:
//   - Bulkowski, "Encyclopedia of Chart Patterns" — pivot support/resistance
//   - Person, "A Complete Guide to Technical Trading Tactics" — pivot math
//   - Bulkowski 50 EMA / S&P pivots — Fibonacci 0.382/0.618/1.000 bands
//   - Cryptohopper / QuantifiedStrategies — daily pivot bounce setup

import { roundTo } from "@mm-crypto-bot/shared/utils";

import type { Strategy, StrategyContext, StrategySignal } from "../types.js";

/**
 * `PivotPointGridConfig` — configuration for the Pivot Point Grid
 * strategy. The three multipliers are applied to (H - L) of the
 * previous HTF candle to construct the S1/S2/S3 and R1/R2/R3 bands.
 *
 * `maxPositionPctEquity` is the Phase 16 productionization cap. Pivot
 * Grid's mean-reversion entries stack across successive S/R levels; at
 * the engine's default `positionSize.maxPositionPctEquity = 0.20` the
 * strategy can compound winners beyond realistic capital caps. We
 * scale the emitted signal's `confidence` by
 * `min(1.0, maxPositionPctEquity / engineMaxPositionPctEquity)` so
 * the engine-side `positionSize.maxPositionPctEquity` constraint is
 * enforced. Default `0.04` matches the project's productionization
 * envelope target (~+20-50%/mo with 4% per-trade equity cap).
 */
export interface PivotPointGridConfig {
  /** Fibonacci 1 multiplier — inner band multiplier (default 0.382). */
  readonly multiplierFib1: number;
  /** Fibonacci 2 multiplier — outer band multiplier (default 0.618). */
  readonly multiplierFib2: number;
  /** Fibonacci 3 multiplier — extreme band multiplier (default 1.000). */
  readonly multiplierFib3: number;
  /**
   * Per-trade equity cap (Phase 16 productionization). The emitted
   * signal's `confidence` is scaled by `cap / engineMaxPositionPctEquity`
   * so the engine-side `positionSize.maxPositionPctEquity` constraint
   * is enforced. Range: (0, 1.0]. Default `0.04`. Setting `1.0` keeps
   * legacy (uncapped) behavior.
   */
  readonly maxPositionPctEquity: number;
}

/**
 * `DEFAULT_PIVOT_GRID_CONFIG` — classical Fibonacci pivot multipliers
 * with the Phase 16 productionization cap.
 *
 * `maxPositionPctEquity: 0.04` — Phase 16 productionization envelope
 * (4% per-trade equity cap, matches the board's "realistic +20-50%/mo"
 * target under 1:10 leverage on bybit.eu SPOT).
 */
export const DEFAULT_PIVOT_GRID_CONFIG: PivotPointGridConfig = {
  multiplierFib1: 0.382,
  multiplierFib2: 0.618,
  multiplierFib3: 1.000,
  maxPositionPctEquity: 0.04,
};

/**
 * `ENGINE_MAX_POSITION_PCT_EQUITY` — the engine-side default cap that
 * `positionSize.maxPositionPctEquity` enforces. Pivot Grid's confidence
 * scaling uses this as the denominator when computing the per-emit
 * `capScale`. The engine's default cap (0.20) reflects the pre-Phase-16
 * baseline; Phase 16 scales the strategy down to 0.04 (or any custom
 * `maxPositionPctEquity`) so the engine's cap is honored.
 *
 * In future phases this may become a `ctx.engineConfig` field; for
 * Phase 16 we use a hard-coded constant matching the engine's default.
 */
const ENGINE_MAX_POSITION_PCT_EQUITY = 0.2;

/** HTF window length in milliseconds (one UTC day). */
const HTF_MS = 86_400_000;

export class PivotPointGridStrategy implements Strategy {
  readonly name = "Pivot Point Grid (Phase 15 M15 range-mean-reversion)";
  readonly timeframes = ["1d", "15m"] as const;
  readonly config: PivotPointGridConfig;

  // ---------------------------------------------------------------------------
  // HTF (1d) candle state — accumulated from LTF (15m) candles.
  // The "current" slots hold the in-progress HTF candle's H/L/C; the
  // "previous" slots hold the committed H/L/C of the most recently
  // finished HTF candle. Pivot points are computed from prev*.
  // ---------------------------------------------------------------------------

  private currHtfHigh: number | undefined;
  private currHtfLow: number | undefined;
  private currHtfClose: number | undefined;
  private prevHtfHigh: number | undefined;
  private prevHtfLow: number | undefined;
  private prevHtfClose: number | undefined;

  /**
   * `committedPrevHtfAtLeastOnce` — true after the strategy has committed
   * at least one full HTF (1d) candle. Until this is true, the strategy
   * has no previous-day data to compute pivots from, and `onCandle` returns
   * null. Exposed for tests to assert the boundary-detection contract.
   */
  committedPrevHtfAtLeastOnce = false;

  constructor(config: Partial<PivotPointGridConfig> = {}) {
    this.config = { ...DEFAULT_PIVOT_GRID_CONFIG, ...config };
  }

  /**
   * `warmup` — 100 LTF (15m) candles. 96 candles cover a full 1d HTF
   * bucket; 4 candles of buffer ensure at least one HTF-boundary candle
   * has been seen (so prev* is populated) before the strategy can fire.
   */
  warmup(): number {
    return 100;
  }

  /**
   * `onCandle` — invoked on each LTF (15m) candle. Updates the HTF
   * accumulator first, then emits a mean-reversion signal if the LTF
   * close is at or beyond the configured bands of the previous-day pivot.
   *
   * Always returns `null` when:
   *   - `candleIndex` is below `warmup()` (engine warmup gate)
   *   - No committed previous HTF candle exists yet
   *   - The close is inside the inner bands (S1 < close < R1, middle zone)
   *
   * Phase 16 productionization: every emitted signal has its
   * `confidence` field scaled by `capScale = min(1.0, maxPositionPctEquity
   * / ENGINE_MAX_POSITION_PCT_EQUITY)`. This makes the strategy honor
   * the configured per-trade equity cap while leaving the engine's
   * position-sizing as the sole hard enforcement layer.
   */
  onCandle(ctx: StrategyContext): StrategySignal | null {
    const { candle, candleIndex, pricePrecision } = ctx;

    if (candleIndex < this.warmup()) {
      return null;
    }

    // -----------------------------------------------------------------------
    // HTF accumulator update — boundary detection at 1d rollup.
    // -----------------------------------------------------------------------
    if (candle.timestamp % HTF_MS === 0) {
      // This 15m candle starts a new 1d bucket. The currently-accumulated
      // H/L/C slots represent the just-finished 1d candle's values, so we
      // commit them to prev* BEFORE resetting for the new bucket.
      // (If the accumulator is undefined — first candle happens to land on
      // a boundary — we skip the commit and just start fresh.)
      if (
        this.currHtfHigh !== undefined &&
        this.currHtfLow !== undefined &&
        this.currHtfClose !== undefined
      ) {
        this.prevHtfHigh = this.currHtfHigh;
        this.prevHtfLow = this.currHtfLow;
        this.prevHtfClose = this.currHtfClose;
        this.committedPrevHtfAtLeastOnce = true;
      }
      // Reset accumulator — this candle is the FIRST of the new HTF bucket.
      this.currHtfHigh = candle.high;
      this.currHtfLow = candle.low;
      this.currHtfClose = candle.close;
    } else {
      // Inside an HTF bucket — extend the running H/L/C with this LTF candle.
      if (this.currHtfHigh === undefined || this.currHtfLow === undefined) {
        this.currHtfHigh = candle.high;
        this.currHtfLow = candle.low;
      } else {
        if (candle.high > this.currHtfHigh) this.currHtfHigh = candle.high;
        if (candle.low < this.currHtfLow) this.currHtfLow = candle.low;
      }
      // Last candle's close wins for the in-progress HTF close.
      this.currHtfClose = candle.close;
    }

    // Need a committed previous HTF candle for pivots.
    if (
      this.prevHtfHigh === undefined ||
      this.prevHtfLow === undefined ||
      this.prevHtfClose === undefined
    ) {
      return null;
    }

    const H = this.prevHtfHigh;
    const L = this.prevHtfLow;
    const C = this.prevHtfClose;
    const range = H - L;
    const PP = (H + L + C) / 3;

    const { multiplierFib1: f1, multiplierFib2: f2, multiplierFib3: f3 } = this.config;

    const R1 = PP + f1 * range;
    const R2 = PP + f2 * range;
    const R3 = PP + f3 * range;
    const S1 = PP - f1 * range;
    const S2 = PP - f2 * range;
    const S3 = PP - f3 * range;

    const close = candle.close;

    // -----------------------------------------------------------------------
    // Phase 16 productionization — scale confidence down to honor
    // `config.maxPositionPctEquity`. We compute `capScale` ONCE per emit
    // (the cap is config-level, not signal-level), then apply it to the
    // raw confidence that each branch emits.
    // -----------------------------------------------------------------------
    const capScale = Math.min(
      1.0,
      this.config.maxPositionPctEquity / ENGINE_MAX_POSITION_PCT_EQUITY,
    );

    /**
     * `applyCap` — scale a candidate signal's confidence by `capScale`.
     * Keeps all other signal fields (side / reason / stopLoss / takeProfit)
     * unchanged. The cap NEVER amplifies: when
     * `maxPositionPctEquity >= ENGINE_MAX_POSITION_PCT_EQUITY`,
     * `capScale = 1.0` and the signal is emitted unchanged (legacy mode).
     */
    const applyCap = (raw: StrategySignal): StrategySignal => {
      if (capScale === 1.0) return raw;
      return {
        ...raw,
        confidence: raw.confidence * capScale,
      };
    };

    // -----------------------------------------------------------------------
    // Mean-reversion entry — check the deeper bands first so an exact tie
    // at S2 lands on the deep case (confidence 1.0) rather than S1 (0.7).
    // -----------------------------------------------------------------------

    // LONG — close at or below S2 (deep overshoot) → highest confidence.
    if (close <= S2) {
      return applyCap({
        side: "buy",
        confidence: 1.0,
        reason: `PivotGrid LONG (deep): close ${close.toFixed(2)} <= S2 ${S2.toFixed(2)}, PP=${PP.toFixed(2)}`,
        stopLoss: roundTo(S3, pricePrecision),
        takeProfit: roundTo(PP, pricePrecision),
      });
    }

    // LONG — S2 < close <= S1 (shallow overshoot) → lower confidence.
    if (close <= S1) {
      return applyCap({
        side: "buy",
        confidence: 0.7,
        reason: `PivotGrid LONG: close ${close.toFixed(2)} <= S1 ${S1.toFixed(2)}, PP=${PP.toFixed(2)}`,
        stopLoss: roundTo(S2, pricePrecision),
        takeProfit: roundTo(PP, pricePrecision),
      });
    }

    // SHORT — close at or above R2 (deep overbought) → highest confidence.
    if (close >= R2) {
      return applyCap({
        side: "sell",
        confidence: 1.0,
        reason: `PivotGrid SHORT (deep): close ${close.toFixed(2)} >= R2 ${R2.toFixed(2)}, PP=${PP.toFixed(2)}`,
        stopLoss: roundTo(R3, pricePrecision),
        takeProfit: roundTo(PP, pricePrecision),
      });
    }

    // SHORT — R1 <= close < R2 (shallow overbought) → lower confidence.
    if (close >= R1) {
      return applyCap({
        side: "sell",
        confidence: 0.7,
        reason: `PivotGrid SHORT: close ${close.toFixed(2)} >= R1 ${R1.toFixed(2)}, PP=${PP.toFixed(2)}`,
        stopLoss: roundTo(R2, pricePrecision),
        takeProfit: roundTo(PP, pricePrecision),
      });
    }

    // Middle zone — S1 < close < R1 — no signal.
    return null;
  }
}
