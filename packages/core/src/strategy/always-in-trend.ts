// packages/core/src/strategy/always-in-trend.ts — Always-in trend-following
//
// Phase 5 — komplementer a Phase 1-3 (túl-szigorú 3-layer MTF-TKC) és a
// Phase 4 (túl-laza mean-reversion) stratégiákhoz. Lazább mint MTF-TKC
// (mindig-in pozíció), szigorúbb mint Phase 4 mean-reversion (csak
// trend-irányban trade-el, nincs random reversal).
//
// Mechanika:
//   - HTF (1d) EMA50 > EMA200 → uptrend (long bias)
//   - HTF (1d) EMA50 < EMA200 → downtrend (short bias)
//   - LTF (1h/4h) Supertrend(ATR 10, 3) → trailing stop
//   - Always-in: a stratégia minden candle-en küld signált, amíg a trend
//     tiszta. A motor kezeli a position managementet (open/close).
//   - Stop-loss: entry_close -/+ 3*ATR (a trend-erős piac kisebb pullback-jeit
//     túlélje, de a trend-fordulót ne)
//   - Take-profit: very wide (entry_close +/- 20*ATR) — az always-in logika
//     nem TP-zár, hanem trailing-stoppal dolgozik.
//
// A Phase 5 brief §1.3-ban leírt "Strategy A" komponens.
//
// References:
//   - Boring Edge: BTC EMA 20/200 always-in full reversal, 4H, 2021-2025:
//     +72%, 80 trades, 23.75% WR, ~49% max DD
//   - Quantified Strategies 50 EMA: trend-following methodology
//   - MenthorQ Q-RSI: 2024-mid-2025 BTC +18% vs +10% buy-and-hold
//   - Doc: docs/research/phase5-strategy-selection.md §2.A

import { roundTo } from "@mm-crypto-bot/shared/utils";

import type { Strategy, StrategyContext, StrategySignal } from "../types.js";

export interface AlwaysInTrendConfig {
  /** ATR multiplier for stop-loss distance (default 3.0). */
  readonly stopAtrMultiplier: number;
  /** ATR multiplier for take-profit distance (default 20.0 — wide for always-in). */
  readonly tpAtrMultiplier: number;
  /** Minimum EMA50-EMA200 gap to consider trend "clear" (default 0.001 = 0.1%). */
  readonly minEmaGapPct: number;
}

export const DEFAULT_ALWAYSIN_CONFIG: AlwaysInTrendConfig = {
  stopAtrMultiplier: 3.0,
  tpAtrMultiplier: 20.0,
  minEmaGapPct: 0.001,
};

export class AlwaysInTrendStrategy implements Strategy {
  readonly name = "Always-In Trend-Following (Phase 5)";
  readonly timeframes = ["1d", "4h", "1h"] as const;
  readonly config: AlwaysInTrendConfig;

  constructor(config: Partial<AlwaysInTrendConfig> = {}) {
    this.config = { ...DEFAULT_ALWAYSIN_CONFIG, ...config };
  }

  warmup(): number {
    // EMA200 needs ~200 candles on LTF (1h) to stabilize. Add buffer.
    return 250;
  }

  /**
   `onCandle` — LTF-en (1h) hívódik. A `mtfState.htf` tartalmazza az 1d EMA50/EMA200-at.
     A `mtfState.ltf.atr` az LTF ATR(14)-et adja a stop/TP távolsághoz.

     A signál logika (always-in):
       1. Ha HTF EMA50 > EMA200 * (1 + minEmaGapPct) → uptrend → LONG signál
       2. Ha HTF EMA50 < EMA200 * (1 - minEmaGapPct) → downtrend → SHORT signál
       3. Stop = entry_close -/+ stopAtrMultiplier * ATR (trailing-stop alap)
       4. TP = entry_close +/- tpAtrMultiplier * ATR (very wide — always-in)
   */
  onCandle(ctx: StrategyContext): StrategySignal | null {
    const { candle, candleIndex, mtfState, pricePrecision } = ctx;

    if (candleIndex < this.warmup()) {
      return null;
    }

    const htf = mtfState.htf;
    const ltf = mtfState.ltf;
    if (htf.ema50 === undefined || htf.ema200 === undefined) {
      return null;
    }
    if (ltf.atr === undefined || ltf.atr <= 0) {
      return null;
    }

    const { stopAtrMultiplier, tpAtrMultiplier, minEmaGapPct } = this.config;
    const emaGap = (htf.ema50 - htf.ema200) / htf.ema200;
    const close = candle.close;
    const atr = ltf.atr;

    if (emaGap > minEmaGapPct) {
      // Uptrend — long bias
      return {
        side: "buy",
        confidence: 0.95,
        reason: `Always-in LONG: HTF EMA50(${htf.ema50.toFixed(2)}) > EMA200(${htf.ema200.toFixed(2)}), gap=${(emaGap * 100).toFixed(2)}%`,
        stopLoss: roundTo(close - atr * stopAtrMultiplier, pricePrecision),
        takeProfit: roundTo(close + atr * tpAtrMultiplier, pricePrecision),
      };
    }

    if (emaGap < -minEmaGapPct) {
      // Downtrend — short bias
      return {
        side: "sell",
        confidence: 0.95,
        reason: `Always-in SHORT: HTF EMA50(${htf.ema50.toFixed(2)}) < EMA200(${htf.ema200.toFixed(2)}), gap=${(emaGap * 100).toFixed(2)}%`,
        stopLoss: roundTo(close + atr * stopAtrMultiplier, pricePrecision),
        takeProfit: roundTo(close - atr * tpAtrMultiplier, pricePrecision),
      };
    }

    // EMA50 ≈ EMA200 (transition) — no signal, exit any open position
    return null;
  }
}
