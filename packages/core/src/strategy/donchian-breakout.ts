// packages/core/src/strategy/donchian-breakout.ts — Donchian volatility breakout
//
// Phase 5 — kiegészítő trend-following komponens. Az always-in trend-following
// (EMA cross) crossover-triggerénél más entry-logikát ad: a Donchian 20-period
// felső/alsó sávjának áttörése + volume filter.
//
// Mechanika (Arconomy ETH-spec alapján, BTC/ETH/SOL-ra kalibrálva):
//   - LTF (1h) close > MTF (4h) Donchian(20) upper + volume > 1.5× avg → LONG
//   - LTF (1h) close < MTF (4h) Donchian(20) lower + volume > 1.5× avg → SHORT
//   - Stop-loss: entry close -/+ 1.5 × ATR(14) (Arconomy spec)
//   - Take-profit: 3 × ATR(14) → 2:1 R:R minimum
//   - HTF trend-direction szűrő (opcionális, config): ha EMA50 < EMA200 a 1d-n,
//     a long jelzéseket elvetjük (downtrend filter); ha uptrend, short jelzéseket vethetjük el
//
// A Phase 5 brief §1.3-ban leírt "Strategy C" komponens.
//
// References:
//   - Boring Edge: BTC Donchian 8.5y CAGR 48.2%, 41 trades, 46.3% WR, 5.3× W/L
//   - Stratbase: BTC System 2 (55/20) 2020-2024: 18 trades, 44% WR, PF 1.72
//   - Arconomy: ETH 15m Donchian + volume + ATR-stop, 2:1 R:R minimum
//   - Arxum: BTC 1D 20-period breakout alone: 49% WR, R:R 1.8, DD 41%
//     + 55-period trend filter: 56% WR, R:R 2.1, DD 31%
//   - Dev.to 49-strategies: donchian_breakout: Sharpe 1.06, return 320%
//   - Doc: docs/research/phase5-strategy-selection.md §2.C

import { roundTo } from "@mm-crypto-bot/shared/utils";

import type { Strategy, StrategyContext, StrategySignal } from "../types.js";

export interface DonchianBreakoutConfig {
  /** Donchian channel period on MTF (default 20). */
  readonly donchianPeriod: number;
  /** Volume multiplier for breakout confirmation (default 1.5). */
  readonly volumeConfirmMultiplier: number;
  /** ATR multiplier for stop-loss distance (default 1.5). */
  readonly stopAtrMultiplier: number;
  /** ATR multiplier for take-profit distance (default 4.5 — 3:1 R:R with 1.5× stop). */
  readonly tpAtrMultiplier: number;
  /** If true, only trade in HTF trend direction (long in uptrend, short in downtrend). */
  readonly useHtfTrendFilter: boolean;
}

export const DEFAULT_DONCHIAN_CONFIG: DonchianBreakoutConfig = {
  donchianPeriod: 20,
  volumeConfirmMultiplier: 1.5,
  stopAtrMultiplier: 1.5,
  tpAtrMultiplier: 4.5,
  useHtfTrendFilter: true,
};

export class DonchianBreakoutStrategy implements Strategy {
  readonly name = "Donchian Volatility Breakout (Phase 5)";
  readonly timeframes = ["1d", "4h", "1h"] as const;
  readonly config: DonchianBreakoutConfig;

  constructor(config: Partial<DonchianBreakoutConfig> = {}) {
    this.config = { ...DEFAULT_DONCHIAN_CONFIG, ...config };
  }

  warmup(): number {
    // Donchian(20) needs 20 1h candles + volume MA(20) + buffer
    return 30;
  }

  /**
   `onCandle` — LTF-en (1h) hívódik. A `mtfState.htf` az 1d Donchian(20)-at adja (computeIndicators csak HTF-en szamitja).
     A `mtfState.ltf` az LTF ATR(14) és volume MA(20)-at adja. A Donchian a HTF (1d) indikátor-allapotban van (computeIndicators mtf-en nem szamitja).

     A signál logika:
       1. HTF (1d) Donchian(20) upper/lower + LTF close breakout detection
       2. Volume filter: candle.volume > volumeConfirmMultiplier × volumeMa
       3. Opcionális HTF trend filter: EMA50 > EMA200 → long-only; < → short-only
       4. Stop = entry close -/+ stopAtrMultiplier × ATR
       5. TP = entry close +/- tpAtrMultiplier × ATR (3:1 R:R)
   */
  onCandle(ctx: StrategyContext): StrategySignal | null {
    const { candle, candleIndex, mtfState, pricePrecision } = ctx;

    if (candleIndex < this.warmup()) {
      return null;
    }


    const mtf = mtfState.mtf;
    const ltf = mtfState.ltf;
    const htf = mtfState.htf;

    // HTF 1d Donchian(20) — computeIndicators only computes Donchian on the
    // HTF (1d) timeframe (see packages/core/src/indicators/index.ts). The MTF
    // 4h state has BB/RSI/ADX but no Donchian. Using HTF Donchian gives a
    // 20-day breakout signal — fewer but stronger trades than 4h.
    if (mtf.donchianUpper === undefined || mtf.donchianLower === undefined) {
      return null;
    }
    if (ltf.atr === undefined || ltf.atr <= 0) {
      return null;
    }
    if (ltf.volumeMa === undefined) {
      return null;
    }

    const { volumeConfirmMultiplier, stopAtrMultiplier, tpAtrMultiplier, useHtfTrendFilter } = this.config;
    const close = candle.close;
    const atr = ltf.atr;
    const volumeConfirm = candle.volume > ltf.volumeMa * volumeConfirmMultiplier;

    // HTF trend direction (for optional filter)
    let htfTrendClear: "up" | "down" | "neutral" = "neutral";
    if (htf.ema50 !== undefined && htf.ema200 !== undefined) {
      const gap = (htf.ema50 - htf.ema200) / htf.ema200;
      if (gap > 0.001) htfTrendClear = "up";
      else if (gap < -0.001) htfTrendClear = "down";
    }

    // LONG breakout: close > upper AND volume confirm
    if (close > mtf.donchianUpper && volumeConfirm) {
      if (useHtfTrendFilter && htfTrendClear === "down") {
        // Downtrend — filter out long signal
        return null;
      }
      return {
        side: "buy",
        confidence: 0.9,
        reason: `Donchian breakout LONG: close ${close.toFixed(2)} > upper ${mtf.donchianUpper.toFixed(2)}, vol=${candle.volume.toFixed(2)} (avg=${ltf.volumeMa.toFixed(2)}) ×${volumeConfirmMultiplier}`,
        stopLoss: roundTo(close - atr * stopAtrMultiplier, pricePrecision),
        takeProfit: roundTo(close + atr * tpAtrMultiplier, pricePrecision),
      };
    }

    // SHORT breakout: close < lower AND volume confirm
    if (close < mtf.donchianLower && volumeConfirm) {
      if (useHtfTrendFilter && htfTrendClear === "up") {
        // Uptrend — filter out short signal
        return null;
      }
      return {
        side: "sell",
        confidence: 0.9,
        reason: `Donchian breakout SHORT: close ${close.toFixed(2)} < lower ${mtf.donchianLower.toFixed(2)}, vol=${candle.volume.toFixed(2)} (avg=${ltf.volumeMa.toFixed(2)}) ×${volumeConfirmMultiplier}`,
        stopLoss: roundTo(close + atr * stopAtrMultiplier, pricePrecision),
        takeProfit: roundTo(close - atr * tpAtrMultiplier, pricePrecision),
      };
    }

    return null;
  }
}
