// packages/core/src/strategy/ohlc-trend.ts — OHLC-trend (EMA 50/200 + RSI + ATR stops)
//
// Phase 37 Track 3 — new OHLC-based trend-following strategy.
//
// This strategy is intentionally DIFFERENT from the existing core strategies
// (Donchian-Pivot, Cascade-Fade, etc.) which use a `MtfState` aggregate
// fed by the backtest engine's `computeIndicators` helper. The OHLC-trend
// strategy operates on a single bar series (1h by default) and computes
// its own indicators (EMA 50, EMA 200, RSI 14, ATR 14) directly.
//
// The reason for the divergence: this strategy is designed to be DRIVEN
// BY THE `OhlcStream` class (`@mm/exchange`). The bar stream comes from
// the live trade tape (1m aggregation → 1h rollup) or from a historical
// fixture replay. The backtest path is the historical-replay variant
// (see the fixture test).
//
// SIGNAL LOGIC (per the user mandate 2026-07-15 12:07 Budapest):
//
//   1. Compute EMA(50) and EMA(200) over the available close-prices.
//   2. Compute RSI(14) and ATR(14) (Wilder-smoothing) over the same series.
//   3. **GOLDEN CROSS** (long entry):  on bar `t`, EMA50[t-1] < EMA200[t-1]
//      AND EMA50[t] > EMA200[t]  AND  RSI(14)[t] < 70 (NOT overbought).
//   4. **DEATH CROSS** (short entry):  EMA50[t-1] > EMA200[t-1]
//      AND EMA50[t] < EMA200[t]  AND  RSI(14)[t] > 30 (NOT oversold).
//   5. POSITION SIZING (per the user mandate):  ATR(14)[t] * 1.5 stop-loss,
//      3:1 reward-to-risk (TP distance = 3 × SL distance).
//
// Why these specific values?  50/200 EMA is the canonical "golden cross"
// combination used by every retail platform (TradingView, StockCharts,
// Investopedia).  RSI(14) overbought/oversold thresholds (70/30) are
// Wilder's original 1978 cutoffs — they filter out "trend-chasing" entries
// where the EMA has already run too far.  ATR(14) * 1.5 stop is 1.5× the
// recent average true range, which is the conventional "give the trade
// some breathing room" stop (Kaufman, "Trading Systems and Methods", 2013).
//
// References:
//   - Wilder, J. W. (1978) "New Concepts in Technical Trading Systems"
//     — RSI(14) thresholds (70/30) and ATR(14) smoothing.
//   - Kaufman, P. J. (2013) "Trading Systems and Methods" — ATR-based stops.
//   - Bulkowski, T. "Encyclopedia of Chart Patterns" — golden cross stats.

import { ema, rsi, atr } from "../indicators/index.js";
import type { Candle, Side, Timeframe } from "@mm-crypto-bot/shared/types";
import { TIMEFRAME_MS } from "@mm-crypto-bot/shared/types";
import { roundTo } from "@mm-crypto-bot/shared/utils";

/** Configuration for `OhlcTrendStrategy`. */
export interface OhlcTrendConfig {
  /** Fast EMA period. Default 50. */
  readonly fastEma: number;
  /** Slow EMA period. Default 200. */
  readonly slowEma: number;
  /** RSI smoothing period. Default 14. */
  readonly rsiPeriod: number;
  /** ATR smoothing period. Default 14. */
  readonly atrPeriod: number;
  /** ATR stop-loss multiplier. Default 1.5. */
  readonly atrStopMultiplier: number;
  /** Risk-to-reward ratio (TP distance / SL distance). Default 3.0. */
  readonly rewardToRisk: number;
  /** Timeframe the strategy operates on. Default "1h". */
  readonly timeframe: Timeframe;
  /**
   * Cross-detection lookback. A cross counts as "active" if it happened
   * within the last `crossLookback` bars (default 1 = strict crossover
   * on the most recent bar). Larger values relax the entry timing
   * (useful when you don't want to miss the move while still in the
   * "fresh cross" zone). Per the spec the default is 1, matching the
   * canonical golden-cross / death-cross definition.
   */
  readonly crossLookback: number;
}

export const DEFAULT_OHLC_TREND_CONFIG: OhlcTrendConfig = {
  fastEma: 50,
  slowEma: 200,
  rsiPeriod: 14,
  atrPeriod: 14,
  atrStopMultiplier: 1.5,
  rewardToRisk: 3,
  timeframe: "1h",
  crossLookback: 1,
};

/** A signal emitted by the strategy. */
export interface OhlcTrendSignal {
  readonly side: Side;
  readonly confidence: number;
  readonly reason: string;
  readonly entryPrice: number;
  readonly stopLoss: number;
  readonly takeProfit: number;
  readonly timestamp: number;
  readonly fastEma: number;
  readonly slowEma: number;
  readonly rsi: number;
  readonly atr: number;
}

/** Callback that returns the bar history for `timeframe` (and before `since` if set). */
export type GetOhlcBars = (since?: number) => readonly Candle[];

/**
 * `OhlcTrendStrategy` — the OHLC-based trend-following strategy.
 *
 * Usage (live):
 *
 *   const strat = new OhlcTrendStrategy({ timeframe: "1h" });
 *   const signal = strat.onBars(stream.getBars("BTC/USDT", "1h"));
 *   if (signal !== null) placeOrder(signal);
 *
 * Usage (backtest):
 *
 *   const strat = new OhlcTrendStrategy();
 *   for (const candle of historicalCandles) {
 *     const bars = historicalCandles.filter(c => c.timestamp <= candle.timestamp);
 *     const signal = strat.onBars(bars);
 *     if (signal !== null) enterTrade(signal);
 *   }
 *
 * The strategy is **stateless across calls** (every `onBars` invocation
 * is independent). This makes it trivially testable AND safe to use in
 * the TUI Charts panel (which calls it on every bar close).
 */
export class OhlcTrendStrategy {
  readonly config: OhlcTrendConfig;
  readonly name: string;

  constructor(config: Partial<OhlcTrendConfig> = {}) {
    this.config = { ...DEFAULT_OHLC_TREND_CONFIG, ...config };
    this.name = `OHLC-Trend (EMA${this.config.fastEma}/${this.config.slowEma} + RSI${this.config.rsiPeriod} + ATR${this.config.atrPeriod}x${this.config.atrStopMultiplier}, ${this.config.timeframe})`;
  }

  /**
   * `warmup` — how many bars the strategy needs before it can emit a
   * signal. Equal to the slow-EMA period (200 by default) since that's
   * the longest indicator warmup.
   */
  warmup(): number {
    return this.config.slowEma;
  }

  /**
   * `requiredTimeframeMs` — the timeframe (in ms) this strategy
   * requires. Used by the backtest engine to filter out candles of
   * the wrong resolution.
   */
  requiredTimeframeMs(): number {
    return TIMEFRAME_MS[this.config.timeframe];
  }

  /**
   * `onBars` — given a chronological bar history, return the latest
   * signal (or `null` if no signal is generated on the most-recent bar).
   *
   * The `bars` MUST be sorted by timestamp ascending. The most recent
   * bar is `bars[bars.length - 1]`.
   *
   * Returns `null` when:
   *   - `bars.length < slowEma` (warmup not yet complete)
   *   - Any of EMA50, EMA200, RSI(14), ATR(14) is undefined on the
   *     cross bar (defensive)
   *   - No crossover occurred within the last `crossLookback` bars
   *   - The RSI filter rejects the signal at the cross bar
   *     (overbought for long, oversold for short)
   *
   * The signal's `entryPrice`, `timestamp`, `rsi`, `atr`, `fastEma`,
   * `slowEma` fields all reflect the CROSS BAR, not the latest bar.
   * This matches the spec ("Long entry: 50 EMA crosses above 200 EMA
   * + RSI(14) < 70") — the entry decision is made at the cross, and
   * the stop/TP are computed from the cross-bar's ATR and price.
   */
  onBars(bars: readonly Candle[]): OhlcTrendSignal | null {
    const n = bars.length;
    if (n < this.config.slowEma) return null;
    // 1) Compute indicators over the full series.  We use the whole
    //    history so the EMA "phase" matches what a real engine would
    //    see (per `computeIndicators`).
    const fastEmaSeries = ema(bars, this.config.fastEma);
    const slowEmaSeries = ema(bars, this.config.slowEma);
    const rsiSeries = rsi(bars, this.config.rsiPeriod);
    const atrSeries = atr(bars, this.config.atrPeriod);
    // 2) Cross detection — walk back up to `crossLookback` bars to find
    //    the most-recent cross. A "cross" happens at index `i` when
    //    fast[i-1] and slow[i-1] are on the OPPOSITE side of each other
    //    than fast[i] and slow[i].
    const lookback = Math.max(1, this.config.crossLookback);
    let crossIdx = -1;
    let crossUp = false;
    for (let off = 0; off < lookback; off++) {
      const i = n - 1 - off;
      if (i < 1) break;
      const fastI = fastEmaSeries[i];
      const slowI = slowEmaSeries[i];
      const fastPrev = fastEmaSeries[i - 1];
      const slowPrev = slowEmaSeries[i - 1];
      if (fastI === undefined || slowI === undefined || fastPrev === undefined || slowPrev === undefined) {
        continue;
      }
      if (fastPrev <= slowPrev && fastI > slowI) {
        crossIdx = i;
        crossUp = true;
        break;
      }
      if (fastPrev >= slowPrev && fastI < slowI) {
        crossIdx = i;
        crossUp = false;
        break;
      }
    }
    if (crossIdx === -1) {
      return null;
    }
    // 3) Read the cross-bar's indicators and candle.
    const crossBar = bars[crossIdx]!;
    const crossFast = fastEmaSeries[crossIdx]!;
    const crossSlow = slowEmaSeries[crossIdx]!;
    const crossRsi = rsiSeries[crossIdx];
    const crossAtr = atrSeries[crossIdx];
    if (crossRsi === undefined || crossAtr === undefined) {
      return null;
    }
    // 4) RSI filter — at the cross bar.
    if (crossUp && crossRsi >= 70) return null;
    if (!crossUp && crossRsi <= 30) return null;
    // 5) Position sizing — ATR(cross bar) * multiplier stop, R:R reward.
    const stopDistance = crossAtr * this.config.atrStopMultiplier;
    const entryPrice = crossBar.close;
    const pricePrecision = pricePrecisionOf(entryPrice);
    if (crossUp) {
      const stopLoss = roundTo(entryPrice - stopDistance, pricePrecision);
      const takeProfit = roundTo(entryPrice + stopDistance * this.config.rewardToRisk, pricePrecision);
      return {
        side: "buy",
        confidence: 1,
        reason: `OHLC-Trend golden cross: EMA${this.config.fastEma} ${crossFast.toFixed(2)} > EMA${this.config.slowEma} ${crossSlow.toFixed(2)}; RSI(${this.config.rsiPeriod})=${crossRsi.toFixed(2)}; ATR(${this.config.atrPeriod})=${crossAtr.toFixed(2)}`,
        entryPrice: roundTo(entryPrice, pricePrecision),
        stopLoss,
        takeProfit,
        timestamp: crossBar.timestamp,
        fastEma: crossFast,
        slowEma: crossSlow,
        rsi: crossRsi,
        atr: crossAtr,
      };
    }
    // crossDown
    const stopLoss = roundTo(entryPrice + stopDistance, pricePrecision);
    const takeProfit = roundTo(entryPrice - stopDistance * this.config.rewardToRisk, pricePrecision);
    return {
      side: "sell",
      confidence: 1,
      reason: `OHLC-Trend death cross: EMA${this.config.fastEma} ${crossFast.toFixed(2)} < EMA${this.config.slowEma} ${crossSlow.toFixed(2)}; RSI(${this.config.rsiPeriod})=${crossRsi.toFixed(2)}; ATR(${this.config.atrPeriod})=${crossAtr.toFixed(2)}`,
      entryPrice: roundTo(entryPrice, pricePrecision),
      stopLoss,
      takeProfit,
      timestamp: crossBar.timestamp,
      fastEma: crossFast,
      slowEma: crossSlow,
      rsi: crossRsi,
      atr: crossAtr,
    };
  }
}

/**
 * `pricePrecisionOf` — heuristic price-precision picker for the
 * `roundTo` rounding. BTC/ETH use 2 decimals, SOL uses 3, anything
 * below 1 USD uses 6 (stablecoins, micro-caps). This matches the
 * `Symbol.precision` defaults used by the existing backtest engine.
 */
function pricePrecisionOf(price: number): number {
  if (price >= 1000) return 2;
  if (price >= 1) return 4;
  return 6;
}
