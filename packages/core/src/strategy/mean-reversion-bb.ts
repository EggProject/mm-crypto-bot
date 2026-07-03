// packages/core/src/strategy/mean-reversion-bb.ts — Aggressive MTF Bollinger
// Band mean-reversion strategy.
//
// Phase 4 — aggressive backtest against the +100%/month target on
// bybit.eu SPOT 1:10 margin. Rationale:
//
// The Phase 1-3 MTF-Trend-Konfluencia strategy was too restrictive
// (3-layer confluence, MTF long setup = 0% on BTC 1h 2024-01 → 2026-07).
// This strategy does the OPPOSITE: it trades MANY signals, with high
// win-rate single trades, accepting small winners and tight stops.
//
// Logic (LTF=1h, MTF=4h, HTF=1d — from the engine's computeIndicators):
//
//   - ENTRY LONG:  LTF candle close <= MTF bbLower (4h 20-period BB)
//                  → market is "oversold" on the 4h timeframe
//   - EXIT LONG:   LTF candle close >= MTF bbMiddle (4h BB middle)
//                  → mean reversion completed
//   - ENTRY SHORT: LTF candle close >= MTF bbUpper (4h)
//   - EXIT SHORT:  LTF candle close <= MTF bbMiddle
//
//   - Stop-loss: -1% of entry price (tight, mechanical)
//   - Take-profit: at MTF bbMiddle (mean reversion target)
//
// Expected behavior on BTC/ETH/SOL 2024-01 → 2026-07: 50-200 trades
// per month on each symbol with this single-instrument signal. Win-rate
// expectation: 55-65% (mean-reversion tends to recover ~50% of the
// oversold move on average).
//
// References:
//   - Bulkowski, "Encyclopedia of Chart Patterns" (mean reversion stats)
//   - MTF BB construction: Bollinger, J. (2001) "Bollinger on Bollinger Bands"
//   - Implementation note: leverage is implicit on bybit.eu SPOT 1:10 —
//     this strategy only affects entry-exit timing; the multipler comes
//     from the trade-notional / equity ratio in the position-size module.

import { roundTo } from "@mm-crypto-bot/shared/utils";

import type { Strategy, StrategyContext, StrategySignal } from "../types.js";

export interface MeanReversionBbConfig {
  /** Stop loss percentage of entry price (e.g. 0.01 = 1%). */
  readonly stopLossPct: number;
}

export const DEFAULT_MR_CONFIG: MeanReversionBbConfig = {
  stopLossPct: 0.01,
};

export class MeanReversionBbStrategy implements Strategy {
  readonly name = "MTF-BB Mean-Reversion (Phase 4 aggressive)";
  readonly timeframes = ["1d", "4h", "1h"] as const;
  readonly config: MeanReversionBbConfig;

  constructor(config: MeanReversionBbConfig = DEFAULT_MR_CONFIG) {
    this.config = config;
  }

  warmup(): number {
    // Az MTF BB(20, 2σ) 20 zárásból számít — 4h × 20 = 80h. Adjunk hozzá puffert.
    return 96;
  }

  /**
   `onCandle` — LTF-en hívódik (1h). A `mtfState.mtf` tartalmazza a 4h BB-t.

   A signál logikája:
     1. MTF BB alsó sávját érintő LTF close → long jelzés.
     2. MTF BB felső sávját érintő LTF close → short jelzés.
     3. Stop-loss a belépési ár -1%-a (roundTo precision alapján).
     4. Take-profit a BB middle (mean-reversion cél).
   */
  onCandle(ctx: StrategyContext): StrategySignal | null {
    const { candle, candleIndex, mtfState, pricePrecision } = ctx;

    if (candleIndex < this.warmup()) {
      return null;
    }

    const mtf = mtfState.mtf;
    if (mtf.bbLower === undefined || mtf.bbUpper === undefined || mtf.bbMiddle === undefined) {
      return null;
    }
    if (mtf.adx !== undefined && mtf.adx > 35) {
      // Erős trendben a BB mean reversion fals sok jelet ad — ADX > 35-ön
      // inkább ne kereskedjünk (a BB szél átlyukadása trend-kezdetet jelent).
      return null;
    }

    const slPct = this.config.stopLossPct;

    // LONG: LTF close <= MTF bbLower → belépünk, cél a BB middle, stop -1%
    if (candle.close <= mtf.bbLower) {
      const stopLoss = roundTo(candle.close * (1 - slPct), pricePrecision);
      const takeProfit = roundTo(mtf.bbMiddle, pricePrecision);
      return {
        side: "buy",
        confidence: 1,
        reason: `MR-BB long: LTF close ${candle.close.toFixed(2)} <= MTF bbLower ${mtf.bbLower.toFixed(2)}`,
        stopLoss,
        takeProfit,
      };
    }

    // SHORT: LTF close >= MTF bbUpper → belépünk, cél a BB middle, stop -1%
    if (candle.close >= mtf.bbUpper) {
      const stopLoss = roundTo(candle.close * (1 + slPct), pricePrecision);
      const takeProfit = roundTo(mtf.bbMiddle, pricePrecision);
      return {
        side: "sell",
        confidence: 1,
        reason: `MR-BB short: LTF close ${candle.close.toFixed(2)} >= MTF bbUpper ${mtf.bbUpper.toFixed(2)}`,
        stopLoss,
        takeProfit,
      };
    }

    return null;
  }
}
