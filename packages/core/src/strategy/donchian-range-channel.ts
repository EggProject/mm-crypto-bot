// packages/core/src/strategy/donchian-range-channel.ts — Donchian Range Channel
// mean-reversion strategy (Phase 15 Track C, retail M15 range family).
//
// Phase 15 thesis: range-bound / mid-frequency retail strategies work at home
// RTT (orthogonal to existing trend-following + carry + signal-center alpha
// streams). The Donchian Range Channel is the simplest possible range
// strategy — buy at the DonchianLower(HTF) rail, sell at the DonchianUpper(HTF)
// rail, stop one ATR beyond, target the opposite rail.
//
// Logic (LTF=15m, HTF=1d — from the engine's computeIndicators):
//
//   1. Read HTF Donchian(20) channel from `mtfState.htf.donchianUpper` /
//      `mtfState.htf.donchianLower`. The Donchian period is informational —
//      the actual period is set by the engine per `computeIndicators` config
//      (`htfDonchianPeriod: 20` is the project default).
//   2. Read HTF ADX(14) from `mtfState.htf.adx`.
//   3. Read LTF ATR(14) from `mtfState.ltf.atr` for stop-loss distance.
//   4. TREND FILTER: if `adx > 25` → return null (range strategy does not
//      apply in trending markets — ADX > 25 is the conventional range /
//      trend threshold; see Wilder, "New Concepts in Technical Trading
//      Systems", 1978).
//   5. ENTRY LONG:  LTF close ≤ donchianLower → `side: "buy"`,
//      `stopLoss: donchianLower - atr`, `takeProfit: donchianUpper`.
//      The 1× ATR stop places the stop just beyond the range rail.
//   6. ENTRY SHORT: LTF close ≥ donchianUpper → `side: "sell"`,
//      `stopLoss: donchianUpper + atr`, `takeProfit: donchianLower`.
//   7. MIDDLE ZONE: `donchianLower < close < donchianUpper` → no signal.
//   8. MISSING DONCHIAN OR ATR → no signal (cannot compute channel or stop).
//
// Stops are symmetric 1× ATR beyond the entered rail, so a long entered at
// donchianLower targets donchianUpper (~the range width) with a stop at
// donchianLower - atr (1× ATR beyond entry). R:R ≈ channel_width : 1× ATR
// (≈ range-dependent; tighter in low-vol regimes, wider in high-vol).
//
// Constraints:
//   - 1:10 leverage MANDATORY — strategy only emits signals; sizing is
//     engine-side (ProjectConstraint: bybit.eu SPOT ceiling).
//   - 15% DD project target, max 12 simultaneous trades (4 per symbol).
//
// References:
//   - Donchian, R. (1949) "Trading Rules for a Newly Found Discipline" —
//     the original 20-day channel.
//   - Wilder, J. W. (1978) "New Concepts in Technical Trading Systems" —
//     ADX trend-strength threshold convention.
//   - Bulkowski, "Encyclopedia of Chart Patterns" — mean-reversion stats
//     for range breakouts at the channel rails.

import { roundTo } from "@mm-crypto-bot/shared/utils";

import type { Strategy, StrategyContext, StrategySignal } from "../types.js";

export interface DonchianRangeChannelConfig {
  /**
   * Informational: the Donchian period expected on the HTF (1d) timeframe.
   * The actual period is set by the backtest engine's `computeIndicators`
   * config (`htfDonchianPeriod: 20`); this field is recorded here so the
   * strategy name + config are self-describing in reports/logs.
   */
  readonly donchianPeriod: number;
  /**
   * ADX(14) at or above this threshold is treated as a trending regime —
   * the strategy returns null in that case (range strategies lose to trends).
   * The comparison is `>=` (Wilder 1978 canonical reading: ADX 25 = the
   * trend threshold boundary).
   */
  readonly adxTrendThreshold: number;
}

export const DEFAULT_DONCHIAN_RANGE_CONFIG: DonchianRangeChannelConfig = {
  donchianPeriod: 20,
  adxTrendThreshold: 25,
};

export class DonchianRangeChannelStrategy implements Strategy {
  readonly name = "Donchian Range Channel (Phase 15 M15 range-mean-reversion)";
  readonly timeframes = ["1d", "15m"] as const;
  readonly config: DonchianRangeChannelConfig;

  constructor(config: Partial<DonchianRangeChannelConfig> = {}) {
    this.config = { ...DEFAULT_DONCHIAN_RANGE_CONFIG, ...config };
  }

  warmup(): number {
    // 30 LTF (15m) candles ≈ 7.5h — enough for the EMA50/200 HTF seeds
    // and the LTF ATR(14) to be defined when the first signal is requested.
    return 30;
  }

  onCandle(ctx: StrategyContext): StrategySignal | null {
    const { candle, candleIndex, mtfState, pricePrecision } = ctx;
    if (candleIndex < this.warmup()) {
      return null;
    }
    const htf = mtfState.htf;
    const ltf = mtfState.ltf;
    // 1) Missing Donchian rails → no signal (cannot define the channel).
    if (htf.donchianUpper === undefined || htf.donchianLower === undefined) {
      return null;
    }
    // 2) Missing ATR → no signal (cannot compute stop distance).
    if (ltf.atr === undefined) {
      return null;
    }
    // 3) Trend filter — ADX AT OR ABOVE the threshold skips the strategy.
    //    Wilder (1978) treats ADX >= 25 as the canonical trend threshold, so
    //    an ADX of exactly 25 is already "trending enough" to defeat the
    //    range-mean-reversion edge. This is the single largest pitfall of
    //    channel-reversion systems (Wilder 1978 §3): a range signal that
    //    fires inside a trend gets steam-rolled by the trend.
    if (htf.adx !== undefined && htf.adx >= this.config.adxTrendThreshold) {
      return null;
    }
    const atr = ltf.atr;
    const upper = htf.donchianUpper;
    const lower = htf.donchianLower;
    // 4) ENTRY LONG — close at-or-below the lower rail. The closing-≤
    //    rail boundary (inclusive) is the standard Donchian-mean-reversion
    //    entry trigger.
    if (candle.close <= lower) {
      const stopLoss = roundTo(lower - atr, pricePrecision);
      const takeProfit = roundTo(upper, pricePrecision);
      return {
        side: "buy",
        confidence: 1,
        reason: `Donchian-Range long: 15m close ${candle.close.toFixed(2)} <= 1d-Donchian-lower ${lower.toFixed(2)}; ADX=${htf.adx?.toFixed(2) ?? "n/a"}; ATR(14)=${atr.toFixed(2)}`,
        stopLoss,
        takeProfit,
      };
    }
    // 5) ENTRY SHORT — close at-or-above the upper rail.
    if (candle.close >= upper) {
      const stopLoss = roundTo(upper + atr, pricePrecision);
      const takeProfit = roundTo(lower, pricePrecision);
      return {
        side: "sell",
        confidence: 1,
        reason: `Donchian-Range short: 15m close ${candle.close.toFixed(2)} >= 1d-Donchian-upper ${upper.toFixed(2)}; ADX=${htf.adx?.toFixed(2) ?? "n/a"}; ATR(14)=${atr.toFixed(2)}`,
        stopLoss,
        takeProfit,
      };
    }
    // 6) Middle zone — no signal. The position-management layer
    //    (Phase 7 trailing-stop, Phase 15 ensemble) handles open positions.
    return null;
  }
}
