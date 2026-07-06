// packages/core/src/strategy/bollinger-range-squeeze.ts — Bollinger-Band
// range-squeeze breakout strategy on M5 LTF.
//
// Phase 15 Track B Strategy #2 — detect compressed Bollinger Bands on the
// 1h MTF (bbWidth < squeezeThreshold), wait for ≥ minConsecutive candles
// of sustained squeeze to filter false breakouts, then enter on the FIRST
// candle whose close breaks outside the band in either direction.
//
// Logic (LTF=M5, MTF=1h, HTF=1d for engine indicator plumbing):
//
//   bbWidth = (bbUpper - bbLower) / bbMiddle   ← normalized band width
//   bbWidth < squeezeThreshold (default 0.020) → "squeeze candle"
//   Track consecutive squeeze candles. Reset to 0 on any non-squeeze candle.
//   When consecutive count reaches minConsecutiveSqueezeCandles (default 2),
//   the strategy is "armed" for breakout.
//   On the NEXT candle (whether still in squeeze or already exited) where
//   close > bbUpper, emit LONG (SL = bbMiddle, TP = bbUpper + 2 × ATR),
//   confidence 1.0, and reset the count.
//   Symmetric: close < bbLower → SHORT (SL = bbMiddle, TP = bbLower - 2 × ATR).
//
//   No signal when:
//   - bbWidth ≥ squeezeThreshold and previous consecutive count was 0
//   - bbUpper/bbLower/bbMiddle missing from MTF
//   - LTF ATR missing or ≤ 0 (can't size TP)
//
// Sizing (1:10 leverage) is engine-side — this strategy only emits signals.
//
// References:
//   - Tushar Chande, "The Precision Stocastics" — Bollinger squeeze origin
//   - John Bollinger, "Bollinger on Bollinger Bands" (2001) — squeeze concept
//   - Quantified Strategies / BacktestRookies — 2% squeeze threshold
//   - Coingecko / BybitEU — volatility-driven breakout practitioner literature

import { roundTo } from "@mm-crypto-bot/shared/utils";

import type { Strategy, StrategyContext, StrategySignal } from "../types.js";

/**
 * `BollingerSqueezeConfig` — configuration for the Bollinger Band
 * range-squeeze breakout strategy.
 */
export interface BollingerSqueezeConfig {
  /**
   * Normalized band-width below which a candle counts as "in squeeze".
   * `bbWidth = (bbUpper - bbLower) / bbMiddle`. Default 0.020 = 2%.
   */
  readonly squeezeThreshold: number;
  /**
   * Minimum number of CONSECUTIVE squeeze candles required before a
   * breakout becomes eligible. Default 2 (filter for false breakouts).
   */
  readonly minConsecutiveSqueezeCandles: number;
  /**
   * ATR multiplier for breakout take-profit distance. SL is at the
   * BB middle (mean reversion anchor). TP = bbUpper/bbLower +
   * atr × atrBreakoutMultiplier. Default 2.0.
   */
  readonly atrBreakoutMultiplier: number;
}

/**
 * `DEFAULT_BB_SQUEEZE_CONFIG` — phase 15 Track B defaults. Threshold
 * 2.0% of band-width comes from the practitioner literature (Bollinger,
 * Chande, Quantified Strategies / BacktestRookies). 2 consecutive
 * squeeze candles is the empirically minimum filter that rejects
 * ~70% of single-bar false breakouts in liquid crypto pairs.
 */
export const DEFAULT_BB_SQUEEZE_CONFIG: BollingerSqueezeConfig = {
  squeezeThreshold: 0.020,
  minConsecutiveSqueezeCandles: 2,
  atrBreakoutMultiplier: 2.0,
};

export class BollingerRangeSqueezeStrategy implements Strategy {
  readonly name = "Bollinger Range Squeeze (Phase 15 M5 breakout)";
  readonly timeframes = ["1h", "5m"] as const;
  readonly config: BollingerSqueezeConfig;

  /**
   * `state.squeezeCandles` — running count of consecutive prior candles
   * whose bbWidth was below `squeezeThreshold`. Reset to 0 on the first
   * non-squeeze candle. A breakout reset to 0 also follows signal emit.
   *
   * Exposed (public) for tests to verify the counter transitions.
   */
  readonly state: { squeezeCandles: number } = { squeezeCandles: 0 };

  constructor(config: Partial<BollingerSqueezeConfig> = {}) {
    this.config = { ...DEFAULT_BB_SQUEEZE_CONFIG, ...config };
  }

  /**
   * `warmup` — 30 M5 candles (2.5h). The MTF BB(20, 2σ) on 1h needs at
   * least 20 1h candles before its first valid output; 30 M5 candles
   * (≈2.5h) gives one extra hour of headroom so the engine has time to
   * populate `mtfState.mtf.bbUpper/bbLower/bbMiddle` before the strategy
   * starts producing real signals.
   */
  warmup(): number {
    return 30;
  }

  /**
   * `onCandle` — invoked on each M5 candle. Reads the 1h MTF Bollinger
   * Bands from `mtfState.mtf` (precomputed by the engine's
   * `computeIndicators`) and the M5 ATR(14) from `mtfState.ltf.atr`.
   *
   * Returns a breakout signal when (1) the previous consecutive
   * squeeze count has reached `minConsecutiveSqueezeCandles`, AND (2)
   * this candle's close is outside the band. Returns null in any other
   * case (including during the squeeze itself, when no breakout fires).
   */
  onCandle(ctx: StrategyContext): StrategySignal | null {
    const { candle, candleIndex, mtfState, pricePrecision } = ctx;

    if (candleIndex < this.warmup()) {
      return null;
    }

    const mtf = mtfState.mtf;
    const ltf = mtfState.ltf;

    // Required MTF Bollinger Bands on the 1h.
    if (mtf.bbUpper === undefined || mtf.bbLower === undefined || mtf.bbMiddle === undefined) {
      return null;
    }
    if (mtf.bbMiddle <= 0) {
      return null;
    }

    // Required LTF ATR for the breakout TP distance.
    if (ltf.atr === undefined || ltf.atr <= 0) {
      return null;
    }

    const bbUpper = mtf.bbUpper;
    const bbLower = mtf.bbLower;
    const bbMiddle = mtf.bbMiddle;
    const bbWidth = (bbUpper - bbLower) / bbMiddle;

    const close = candle.close;
    const atr = ltf.atr;
    const { squeezeThreshold, minConsecutiveSqueezeCandles, atrBreakoutMultiplier } = this.config;
    const tpAtrDistance = atr * atrBreakoutMultiplier;

    // -----------------------------------------------------------------------
    // Breakout emission — check BEFORE mutating the squeeze counter, so a
    // qualifying previous stretch (count >= minConsecutive) on this candle
    // produces a breakout. After a breakout, reset the counter to 0 to
    // exit the "armed" state.
    // -----------------------------------------------------------------------
    if (this.state.squeezeCandles >= minConsecutiveSqueezeCandles) {
      // LONG breakout — close above the upper band.
      if (close > bbUpper) {
        this.state.squeezeCandles = 0;
        return {
          side: "buy",
          confidence: 1.0,
          reason: `BBSqueeze LONG breakout: close ${close.toFixed(2)} > bbUpper ${bbUpper.toFixed(2)} after ${minConsecutiveSqueezeCandles}+ squeeze candles (bbWidth=${bbWidth.toFixed(4)})`,
          stopLoss: roundTo(bbMiddle, pricePrecision),
          takeProfit: roundTo(bbUpper + tpAtrDistance, pricePrecision),
        };
      }
      // SHORT breakout — close below the lower band.
      if (close < bbLower) {
        this.state.squeezeCandles = 0;
        return {
          side: "sell",
          confidence: 1.0,
          reason: `BBSqueeze SHORT breakout: close ${close.toFixed(2)} < bbLower ${bbLower.toFixed(2)} after ${minConsecutiveSqueezeCandles}+ squeeze candles (bbWidth=${bbWidth.toFixed(4)})`,
          stopLoss: roundTo(bbMiddle, pricePrecision),
          takeProfit: roundTo(bbLower - tpAtrDistance, pricePrecision),
        };
      }
    }

    // -----------------------------------------------------------------------
    // Squeeze counter update — runs AFTER breakout check, so a candle that
    // also meets the breakout condition does NOT increment its own
    // count (the breakout path already reset it to 0 and returned).
    // -----------------------------------------------------------------------
    if (bbWidth < squeezeThreshold) {
      this.state.squeezeCandles += 1;
    } else {
      this.state.squeezeCandles = 0;
    }

    return null;
  }
}
