// packages/core/src/strategy/keltner-grid.ts — Volatility-Adaptive Grid
// (Keltner-channel-anchored) Phase 15 Track C retail strategy (M5 timeframe).
//
// Phase 15 thesis: range-bound / mid-frequency retail strategies work at home
// RTT (orthogonal to existing trend-following + carry + signal-center alpha
// streams). The Keltner Grid is the second of two channel-/grid-style
// strategies in Phase 15 — complementary to the Donchian Range Channel.
// Where the Donchian Range Channel uses HTF rails and the ADX trend filter
// for a coarse reversion edge, the Keltner Grid uses an inline-computed
// EMA20 + LTF ATR(14) to define a TIGHTER, ATR-resizing channel and places
// a 5-level grid inside it. The grid auto-resizes with realized volatility
// — narrow channels fire fewer / closer signals, wide channels spread the
// same scaling across more space. The result is a self-tuning range-harvest
// strategy that performs evenly across the volatility spectrum.
//
// Logic (LTF=5m, MTF=1h — from the engine's computeIndicators):
//
//   1. KELTNER CHANNEL — `upper = ema20 + kMultiplier × atr`,
//      `lower = ema20 - kMultiplier × atr`. `kMultiplier` defaults to
//      1.5 (Keltner 1960 original convention; Chester Keltner's "How To
//      Make Money In Commodities" used 1.5 as the centre ATR multiple).
//   2. EMA20 — `IndicatorState` exposes ema50/ema200 but NOT ema20.
//      We compute EMA20 inline in the strategy using cumulative state:
//      seed = SMA of the FIRST 20 closes, subsequent values advance via
//      the standard EMA recursion (`α × close + (1 − α) × prev_ema`,
//      α = 2/21 ≈ 0.0952). A ring buffer holds the last 20 closes for
//      diagnostic inspection.
//   3. GRID — `gridLevelCount` (default 5) evenly-spaced fraction points
//      across [0, (N−1)/N] of the band, starting at the lower rail. With
//      the default N=5 the fractions are [0.0, 0.2, 0.4, 0.6, 0.8] from
//      lower (i.e. 5 levels at `i / N` of the range, NOT including the
//      upper rail). The upper rail is intentionally excluded as a grid
//      level so the regime filter stays clean — touching the upper rail
//      would otherwise hijack the signal-channel logic.
//   4. REGIME — long bias when `close > ema20`, short bias when
//      `close < ema20`. At `close === ema20` → transition zone, no signal.
//   5. ENTRY LONG — regime=long AND close touches one of the lower
//      3 grid levels (fractions 0.2/0.4/0.6 from lower). Touch =
//      |close − level| ≤ tolerance where
//      `tolerance = range / (2 × (N − 1))` (half-spacing).
//   6. ENTRY SHORT — regime=short AND close touches one of the upper
//      3 grid levels (fractions 0.4/0.6/0.8 from lower).
//   7. STOPS / TARGETS — stop = band rail ± 0.5 × atr (half-ATR outside
//      the entered rail); target = ema20 (mean-reversion destination).
//      Confidence 0.7 (slightly below Donchian Range Channel's 1.0
//      because the grid fires more frequently and each single signal
//      carries lower per-trade conviction).
//
// Constraints:
//   - 1:10 leverage MANDATORY — strategy only emits signals; sizing is
//     engine-side (ProjectConstraint: bybit.eu SPOT ceiling).
//   - 15% DD project target, max 12 simultaneous trades (4 per symbol).
//   - No `onOpenPositionUpdate` / `onPositionOpened` / `onPositionClosed`
//     hooks — the Keltner Grid uses a simple single-entry single-target
//     structure; position management is delegated to the Phase 7
//     trailing-stop engine or the Phase 15 simple-retail-ensemble wrapper.
//
// References:
//   - Keltner, C. (1960) "How To Make Money In Commodities" — original
//     1.5× ATR channel construction.
//   - EMA recursion: `EMA_t = α × close_t + (1 − α) × EMA_{t-1}` with
//     `α = 2 / (period + 1)` (TradingView / Wilder convention).

import { roundTo } from "@mm-crypto-bot/shared/utils";

import type { Strategy, StrategyContext, StrategySignal } from "../types.js";

/**
 * `KeltnerGridConfig` — configuration parameters for the Keltner
 * Volatility-Adaptive Grid strategy.
 */
export interface KeltnerGridConfig {
  /** Keltner channel multiplier — `upper = ema20 + k × atr`, `lower = ema20 − k × atr`. Default 1.5 (Keltner 1960). */
  readonly kMultiplier: number;
  /** Number of grid levels evenly placed inside the Keltner band. Default 5. */
  readonly gridLevelCount: number;
  /** ATR period — informational, matches the engine's LTF ATR(14). */
  readonly atrPeriod: number;
}

export const DEFAULT_KELTNER_GRID_CONFIG: KeltnerGridConfig = {
  kMultiplier: 1.5,
  gridLevelCount: 5,
  atrPeriod: 14,
};

/** `DEFAULT_EMA_PERIOD` — period of the inline EMA (matches the project default). */
const DEFAULT_EMA_PERIOD = 20;

/**
 * `KeltnerGridStrategy` — Phase 15 Track C retail M5 grid strategy.
 *
 * The strategy uses an inline-computed EMA20 (cumulative state: one
 * recursion step per close). The warmup is `30 M5 candles ≈ 2.5h` —
 * enough for both the EMA20 to seed (20 candles) and a few additional
 * candles for the grid logic to receive stable regime/level signals.
 *
 * Signal logic is exposed via `computeSignal(close, ema20, atr, precision)`
 * for testability — it does NOT mutate state and accepts the EMA20 as a
 * parameter. `onCandle` is the wiring: it advances the EMA state, then
 * delegates to `computeSignal`.
 */
export class KeltnerGridStrategy implements Strategy {
  readonly name = "Keltner Volatility-Adaptive Grid (Phase 15 M5 grid)";
  readonly timeframes = ["1h", "5m"] as const;
  readonly config: KeltnerGridConfig;
  /** Last `emaPeriod` LTF closes (rolling, diagnostic). */
  private readonly closeRingBuffer: number[] = [];
  /** Number of closes observed so far. */
  private closesSeen = 0;
  /** Running sum of the FIRST `emaPeriod` closes (for the SMA seed). */
  private seedSum = 0;
  /** Current EMA value (undefined until seed window completes). */
  private lastEma20: number | undefined = undefined;

  constructor(config: Partial<KeltnerGridConfig> = {}) {
    this.config = { ...DEFAULT_KELTNER_GRID_CONFIG, ...config };
  }

  warmup(): number {
    // 30 LTF (5m) candles ≈ 2.5h — covers the EMA20 seed window (20
    // closes) plus a buffer for the ATR(14) seed + a few grid signals.
    return 30;
  }

  /**
   * `pushClose` — append a new LTF close to the ring buffer (capped at
   * `emaPeriod` entries) AND advance the cumulative EMA state by one
   * recursion step.
   *
   * Standard EMA recursion:
   *   `EMA_t = α × close_t + (1 − α) × EMA_{t-1}`
   *   `α = 2 / (period + 1)` (for period=20, α ≈ 0.0952)
   * Seed: SMA of the FIRST `emaPeriod` closes.
   *
   * Visible for tests; not part of the Strategy interface.
   */
  pushClose(close: number, emaPeriod = DEFAULT_EMA_PERIOD): void {
    this.closesSeen += 1;
    this.closeRingBuffer.push(close);
    if (this.closeRingBuffer.length > emaPeriod) {
      this.closeRingBuffer.shift();
    }
    if (this.closesSeen <= emaPeriod) {
      // Seed window — accumulate for the SMA.
      this.seedSum += close;
      if (this.closesSeen === emaPeriod) {
        this.lastEma20 = this.seedSum / emaPeriod;
      }
      return;
    }
    // Recursion step.
    if (this.lastEma20 === undefined) {
      this.lastEma20 = close;
      return;
    }
    const alpha = 2 / (emaPeriod + 1);
    this.lastEma20 = close * alpha + this.lastEma20 * (1 - alpha);
  }

  /**
   * `computeEma20` — return the current EMA(20) value, or `undefined`
   * if fewer than 20 closes have been observed. O(1) read — the value
   * is maintained cumulatively (one recursion step per close).
   */
  computeEma20(emaPeriod = DEFAULT_EMA_PERIOD): number | undefined {
    if (this.closesSeen < emaPeriod) {
      return undefined;
    }
    return this.lastEma20;
  }

  /**
   * `gridFractions` — fraction points for grid levels relative to the
   * band. For default N=5 the fractions are [0, 0.2, 0.4, 0.6, 0.8]
   * from lower (i.e. level `i` sits at fraction `i/N` of the band).
   */
  gridFractions(): readonly number[] {
    const n = this.config.gridLevelCount;
    if (n <= 0) {
      return [];
    }
    const out: number[] = [];
    for (let i = 0; i < n; i++) {
      out.push(i / n);
    }
    return out;
  }

  /**
   * `longTriggerFractions` — fractions of the band that produce long
   * signals for the long-bias regime. For default N=5 these are
   * [0.2, 0.4, 0.6] — the 3 internal levels closest to the lower rail,
   * excluding the rail itself.
   */
  longTriggerFractions(): readonly number[] {
    const n = this.config.gridLevelCount;
    if (n < 2) {
      return [];
    }
    const out: number[] = [];
    // Skip index 0 (lower rail), take up to 3 of the next internal
    // levels (or all of them if fewer than 4 internal levels exist).
    const end = Math.min(4, n);
    for (let i = 1; i < end; i++) {
      out.push(i / n);
    }
    return out;
  }

  /**
   * `shortTriggerFractions` — fractions of the band that produce short
   * signals for the short-bias regime. For default N=5 these are
   * [0.4, 0.6, 0.8] — the 3 internal levels closest to the upper
   * rail, excluding the rail itself.
   */
  shortTriggerFractions(): readonly number[] {
    const n = this.config.gridLevelCount;
    if (n < 2) {
      return [];
    }
    const out: number[] = [];
    // Take the 3 highest internal levels (indices n-3, n-2, n-1 for
    // N≥4), excluding the lower rail. For smaller N we take whatever
    // internal levels exist (always at least 1 since n≥2).
    const start = Math.max(1, n - 3);
    for (let i = start; i < n; i++) {
      out.push(i / n);
    }
    return out;
  }

  /**
   * `computeSignal` — determine the signal to emit given the current
   * close, EMA20, ATR, and price precision. PURE: no state mutation.
   *
   * Exposed for testability so unit tests can verify the level / touch /
   * regime logic without contending with the cumulative-EMA state
   * machine. Live `onCandle` delegates here after advancing the EMA.
   */
  computeSignal(
    close: number,
    ema20: number,
    atr: number,
    pricePrecision: number,
  ): StrategySignal | null {
    const k = this.config.kMultiplier;
    const upper = ema20 + k * atr;
    const lower = ema20 - k * atr;
    const range = upper - lower;
    if (range <= 0) {
      return null;
    }
    const touchTolerance = range / (2 * (this.config.gridLevelCount - 1));
    if (close > ema20) {
      const longFractions = this.longTriggerFractions();
      for (const frac of longFractions) {
        const level = lower + frac * range;
        if (Math.abs(close - level) <= touchTolerance) {
          return {
            side: "buy",
            confidence: 0.7,
            reason: `Keltner-Grid long: 5m close ${close.toFixed(pricePrecision)} touched level ${(frac * 100).toFixed(0)}% (${level.toFixed(pricePrecision)}) below EMA20 ${ema20.toFixed(pricePrecision)}, K=${k}, ATR(14)=${atr.toFixed(pricePrecision)}`,
            stopLoss: roundTo(lower - 0.5 * atr, pricePrecision),
            takeProfit: roundTo(ema20, pricePrecision),
          };
        }
      }
      return null;
    }
    if (close < ema20) {
      const shortFractions = this.shortTriggerFractions();
      for (const frac of shortFractions) {
        const level = lower + frac * range;
        if (Math.abs(close - level) <= touchTolerance) {
          return {
            side: "sell",
            confidence: 0.7,
            reason: `Keltner-Grid short: 5m close ${close.toFixed(pricePrecision)} touched level ${(frac * 100).toFixed(0)}% (${level.toFixed(pricePrecision)}) above EMA20 ${ema20.toFixed(pricePrecision)}, K=${k}, ATR(14)=${atr.toFixed(pricePrecision)}`,
            stopLoss: roundTo(upper + 0.5 * atr, pricePrecision),
            takeProfit: roundTo(ema20, pricePrecision),
          };
        }
      }
      return null;
    }
    return null;
  }

  onCandle(ctx: StrategyContext): StrategySignal | null {
    const { candle, candleIndex, mtfState, pricePrecision } = ctx;

    // 1) Advance the EMA cumulatively (state update happens BEFORE any
    //    early returns — the EMA state must be consistent across calls
    //    regardless of whether a signal is emitted).
    this.pushClose(candle.close);

    // 2) Warmup gate.
    if (candleIndex < this.warmup()) {
      return null;
    }

    // 3) EMA seed-window guard.
    const ema20 = this.computeEma20();
    if (ema20 === undefined) {
      return null;
    }

    // 4) Missing ATR → no signal (cannot compute channel or stop distance).
    const ltf = mtfState.ltf;
    if (ltf.atr === undefined) {
      return null;
    }

    // 5) Delegate to the pure signal computer.
    return this.computeSignal(candle.close, ema20, ltf.atr, pricePrecision);
  }
}
