// packages/core/src/strategy/donchian-mtf.ts — 1h MTF Donchian with 4h filter + 1d supertrend
//
// Phase 8 Track F — a proper 3-tier multi-timeframe Donchian breakout signal.
// The Phase 5 baseline used only 1d Donchian (low trade count, slow signal);
// pure 1h Donchian is too noisy (Phase 5 baseline-donchian-btc-1h returned
// -17.99% / 268 trades / 0.28 WR). This strategy combines:
//
//   LTF (1h): entry trigger  — 1h close > 4h Donchian(20) upper band
//                                (engine's mtfDonchianUpper, computed on 4h bars)
//   MTF (4h): trend filter   — 4h close > 4h Donchian(20) upper band
//                                (the breakout must be fresh, not just stale)
//   HTF (1d): supertrend OK  — 1d close > 1d Supertrend(10, 3.0) value
//                                (supertrend below close = uptrend confirmed)
//
// Why MTF (4h) Donchian for the LTF entry trigger:
//   The engine's computeIndicators() only computes Donchian on HTF and MTF
//   timeframes (no LTF Donchian option). The Phase 5 DonchianBreakoutStrategy
//   solved this the same way: the 1h trigger checks the MTF (4h) Donchian
//   upper band. Functionally this is "1h close > 20-period-high on 4h bars"
//   = "1h close > last 80 hours high" — a well-established MTF breakout
//   pattern documented across MTF literature (see references below).
//
// Long-only — matches bybit.eu SPOT-only mode (MiCAR; no short selling of
// spot inventory). This is also the only direction that historically
// produced positive expected value at 1h timeframe (Phase 5 baseline: long
// side net positive on 1d; Phase 5 1h: both directions net negative).
//
// Risk management:
//   - Stop-loss:   entry close - 1.5 × LTF ATR(14)
//   - Take-profit: entry close + 3.0 × LTF ATR(14)  (3:1 R:R with 1.5× stop)
//   - Time-exit:   168 LTF bars (168h = 7 days) — forced via onOpenPositionUpdate
//                  hook when holdingBars >= maxHoldBars; this OVERRIDES the
//                  engine's 72h profit-only time_exit (engine.ts:444).
//
// Leverage (1:10 MANDATORY user directive):
//   The strategy itself is leverage-agnostic. The CLI runner enforces
//   the user-mandated 1:10 (10× notional on 1× capital) by post-processing
//   the raw backtest result (multiply PnL by leverage, subtract borrow
//   cost on the borrowed 9/10 portion at bybit.eu 0.01%/h). The
//   `leverage` config field is exposed so the CLI can validate and the
//   deployed strategy can refuse non-conforming values.
//
// References (≥2 independent / claim):
//   - Quantpedia "How to Design a Simple Multi-Timeframe Trend Strategy
//     on Bitcoin" — MTF trend-following baseline, HTF trend filter
//     combined with LTF Donchian breakout entry.
//     https://quantpedia.com/how-to-design-a-simple-multi-timeframe-trend-strategy-on-bitcoin/
//   - Dev.to "I Backtested 49 Crypto Trading Strategies" — multi_timeframe
//     Sharpe 1.50, 100% WR on 3-year data (best in set). Confirms MTF
//     dominates single-timeframe on crypto.
//     https://dev.to/jay_dakhani/i-backtested-49-crypto-trading-strategies-here-are-the-results-4mnp
//   - CoinXSight "Multi-Timeframe Confluence Trading Strategy" — three-
//     timeframe standard; HTF trend + MTF setup + LTF trigger.
//     https://coinxsight.com/multi-timeframe-confluence-trading-strategy/
//   - Stratbase "ATR Trailing-Stop Strategies Compared" — ATR-based stops
//     outperform fixed-% by 8% return / 5% DD reduction on BTC 2019-2025;
//     3:1 R:R with ATR sizing is the practitioner sweet spot.
//     https://stratbase.ai/en/blog/trailing-stop-strategies-compared/
//   - arXiv 2412.14361 (2024) "Walk-Forward Analysis" — 5y IS / 1y OOS /
//     1y step rolling validation for anti-overfit; the Phase 8 WF design
//     uses 180d IS / 30d OOS / 30d step (scaled down for 30-month dataset).
//     https://arxiv.org/pdf/2412.14361
//   - Boring Edge BTC Donchian 8.5y — CAGR 48.2%, 41 trades, 46.3% WR,
//     5.3× W/L (HTF-only baseline reference for comparison).
//   - QuantPedia ATR(10) trailing stop on US stocks trend system —
//     19.3% CAGR across 24,000 securities, 22 years (Wilcox & Crittenden).
//     https://quantpedia.com/strategies/trend-following-effect-in-stocks/
//   - arXiv 2512.12924 (2024) walk-forward validation — 34-window rolling
//     WF gold standard for small-sample crypto strategies.
//     https://arxiv.org/html/2512.12924v1
//   - Phase 5 + Phase 7 reports — empirical ceiling for bybit.eu 1d
//     Donchian edge (~0.07%/mo) and multi-class V2 ensemble (+2.09%/mo
//     carry-dominated). Justifies why a 1h MTF Donchian with 3-tier
//     filters is the next-best directional lever before options vol surface
//     or market-making edge classes.
//
// Specifikáció: docs/research/phase8-1h-mtf-donchian.md (Track F brief).

import { roundTo } from "@mm-crypto-bot/shared/utils";

import type {
  OpenPositionSnapshot,
  PositionManagementContext,
  PositionUpdate,
  Strategy,
  StrategyContext,
  StrategySignal,
} from "../types.js";

/**
 * A `DonchianMtfConfig` a 3-tier MTF Donchian breakout stratégia paraméterei.
 *
 * A default értékek a Phase 8 Track F brief-ből jönnek:
 *   - `donchianPeriod = 20` — Donchian csatorna hossza (HTF-en és MTF-en)
 *   - `mtfDonchianPeriod = 20` — MTF-en is 20 (konzisztens a Phase 5-tel)
 *   - `stopAtrMultiplier = 1.5` — ATR-stop távolság (Arconomy / Phase 5 default)
 *   - `tpAtrMultiplier = 3.0` — ATR-TP távolság (3:1 R:R az 1.5× stop-hoz)
 *   - `atrPeriod = 14` — ATR lookback (hagyományos 14)
 *   - `maxHoldBars = 168` — 168h = 7 nap (user spec; engine 72h profit-only
 *     time_exit felülírása a onOpenPositionUpdate hook-on keresztül)
 *   - `leverage = 10` — 1:10 leverage MANDATORY (user directive); a CLI
 *     elfogad 1-et vagy 10-et, minden más értéket elvet
 */
export interface DonchianMtfConfig {
  readonly donchianPeriod: number;
  readonly mtfDonchianPeriod: number;
  readonly stopAtrMultiplier: number;
  readonly tpAtrMultiplier: number;
  readonly atrPeriod: number;
  readonly maxHoldBars: number;
  /** 1:10 leverage MANDATORY. Csak 1 vagy 10 elfogadott — minden más értéket a CLI/runtime elvet. */
  readonly leverage: number;
}

/**
 * `DEFAULT_DONCHIAN_MTF_CONFIG` — a Phase 8 Track F default konfiguráció.
 * Minden érték a brief-ből + a Phase 5 baseline konvenciókból származik.
 */
export const DEFAULT_DONCHIAN_MTF_CONFIG: DonchianMtfConfig = {
  donchianPeriod: 20,
  mtfDonchianPeriod: 20,
  stopAtrMultiplier: 1.5,
  tpAtrMultiplier: 3.0,
  atrPeriod: 14,
  maxHoldBars: 168,
  leverage: 10,
};

/**
 * `DonchianMtfStrategy` — 3-tier multi-timeframe Donchian breakout signal.
 *
 * Implementáció:
 *   1. `onCandle` — minden LTF (1h) gyertyán hívódik. Három feltétel
 *      együttes teljesülése esetén ad long entry jelet:
 *        a) LTF entry trigger: candle.close > mtf.donchianUpper
 *        b) MTF trend filter:  mtf.close > mtf.donchianUpper
 *        c) HTF supertrend OK: htf.close > htf.supertrend
 *      A stop-loss és take-profit az LTF ATR(14)-ből számítódik.
 *   2. `onPositionOpened` — position-management state inicializálás (HWM,
 *      max-hold counter reset). A HWM-et itt nem használjuk trailing-stop-ra
 *      (az 1d Phase 7 Track A trailing-stop tapasztalatai szerint a 72h-os
 *      profit-time_exit pre-emptálja a trailing-stop trigger-eket).
 *   3. `onOpenPositionUpdate` — max-hold enforcement: ha holdingBars >=
 *      maxHoldBars, forceExit = true (reason = "time_exit"). Ez felülírja
 *      az engine 72h-s profit-only time_exit-jét.
 *   4. `onPositionClosed` — state cleanup.
 *
 * Long-only enforcement: a signal csak `side: "buy"`-t ad vissza soha,
 * így short jel nem keletkezhet. A signal.side: "sell" ágat a metódus
 * szándékosan nem tartalmazza.
 */
export class DonchianMtfStrategy implements Strategy {
  readonly name = "Donchian MTF (1h/4h/1d, long-only)";
  readonly timeframes = ["1d", "4h", "1h"] as const;
  readonly config: DonchianMtfConfig;

  // State a time-exit és HWM tracking-hez.
  private positionHwm: number | null = null;
  private positionEntryPrice: number | null = null;

  constructor(config: Partial<DonchianMtfConfig> = {}) {
    this.config = { ...DEFAULT_DONCHIAN_MTF_CONFIG, ...config };
    // A leverage-ot runtime validáljuk — a CLI is ellenőrzi, de itt is
    // hard guard van, hogy a strategy bármilyen hívóval szemben konzervatív
    // maradjon.
    if (this.config.leverage !== 1 && this.config.leverage !== 10) {
      throw new Error(
        `[donchian-mtf] leverage must be 1 or 10 (1:10 MANDATORY user directive), got ${this.config.leverage}`,
      );
    }
  }

  warmup(): number {
    // A HTF-en Supertrend(10, 3.0) + a MTF-en Donchian(20) + LTF ATR(14)
    // együttesen ~30 LTF candle-t igényelnek. Az engine a HTF EMA200-at
    // a computeIndicators-on belül compute-olja, de a strategy oldaláról
    // nincs rá szükségünk (csak supertrend kell a HTF-ről).
    return 30;
  }

  /**
   * `onCandle` — LTF (1h) entry signal. Három feltétel együttes teljesülése
   * esetén ad long entry jelet. Minden más esetben `null`.
   *
   * A jel-zés logikája:
   *   1. Warmup check: a LTF ATR(14) és Donchian-ok csak a warmup után
   *      definiáltak — előtte nem adunk jelet.
   *   2. LTF entry trigger: `candle.close > mtfState.mtf.donchianUpper`.
   *      A 4h Donchian(20) upper band = a legutóbbi 80 óra legmagasabb
   *      csúcsa. Az 1h close efölötti zárás egy friss kitörést jelez.
   *   3. MTF trend filter: `mtfState.mtf.close > mtfState.mtf.donchianUpper`.
   *      A 4h candle-nak IS a saját Donchian sávja felett kell zárnia —
   *      ezzel kiszűrjük a "LTF kitörés, de MTF már visszafordult" esetet.
   *   4. HTF supertrend OK: `mtfState.htf.close > mtfState.htf.supertrend`.
   *      Ha a 1d Supertrend vonal a záróár alatt van, a HTF trend up.
   *      (A `supertrendDir === 1` redundáns, de a close > supertrend
   *      közvetlenül olvasható az IndicatorState-ből.)
   *   5. Stop-Loss: `candle.close - stopAtrMultiplier × LTF ATR(14)`
   *   6. Take-Profit: `candle.close + tpAtrMultiplier × LTF ATR(14)`
   *      (3:1 R:R 1.5× stop-pal).
   */
  onCandle(ctx: StrategyContext): StrategySignal | null {
    const { candle, candleIndex, mtfState, pricePrecision } = ctx;
    if (candleIndex < this.warmup()) {
      return null;
    }
    const mtf = mtfState.mtf;
    const htf = mtfState.htf;
    const ltf = mtfState.ltf;

    // 1) LTF ATR(14) kell a SL/TP számításhoz — ha undefined vagy ≤0, nincs jel.
    if (ltf.atr === undefined || ltf.atr <= 0) {
      return null;
    }
    // 2) MTF Donchian upper — a LTF entry trigger és a MTF trend filter alapja.
    if (mtf.donchianUpper === undefined) {
      return null;
    }
    // 3) HTF Supertrend — a HTF trend filter alapja.
    if (htf.supertrend === undefined) {
      return null;
    }

    // 1. LTF entry trigger: 1h close > MTF (4h) Donchian(20) upper band.
    const ltfTrigger = candle.close > mtf.donchianUpper;
    if (!ltfTrigger) {
      return null;
    }
    // 2. MTF trend filter: 4h close > MTF (4h) Donchian(20) upper band.
    if (mtf.close === undefined || mtf.close <= mtf.donchianUpper) {
      return null;
    }
    // 3. HTF supertrend OK: 1d close > 1d Supertrend (uptrend).
    if (htf.close === undefined || htf.close <= htf.supertrend) {
      return null;
    }

    // Mind a három feltétel teljesül — long entry jel.
    const stopLoss = roundTo(candle.close - this.config.stopAtrMultiplier * ltf.atr, pricePrecision);
    const takeProfit = roundTo(candle.close + this.config.tpAtrMultiplier * ltf.atr, pricePrecision);
    return {
      side: "buy",
      confidence: 0.9,
      reason: `Donchian-MTF long: 1h close ${candle.close.toFixed(2)} > 4h-Donchian-upper ${mtf.donchianUpper.toFixed(2)}; 4h close ${mtf.close.toFixed(2)} > 4h-Don-upper; 1d close ${htf.close.toFixed(2)} > 1d-supertrend ${htf.supertrend.toFixed(2)}; ATR(14)=${ltf.atr.toFixed(2)}, SL=${stopLoss}, TP=${takeProfit}`,
      stopLoss,
      takeProfit,
    };
  }

  /**
   * `onPositionOpened` — entry-kor reseteljük a position-management state-et.
   * A HWM-et itt az entry-árra állítjuk, bár a Phase 8 spec nem kér trailing-stopot
   * — a HWM track-et future-proof-ként tartjuk meg (Phase 7 Track A tapasztalatai).
   */
  onPositionOpened(snapshot: OpenPositionSnapshot): void {
    this.positionHwm = snapshot.entryPrice;
    this.positionEntryPrice = snapshot.entryPrice;
  }

  /**
   * `onOpenPositionUpdate` — per-bar position management.
   *
   *   1) Max-hold enforcement: ha a `holdingBars` eléri a `maxHoldBars`
   *      limitet (168h = 168 LTF bar), forceExit = true (reason = "time_exit").
   *      Ez felülírja az engine 72h-s profit-only time_exit-jét: a Phase 8
   *      spec minden trade-et 168h után zár, függetlenül a PnL-től.
   *   2) HWM frissítés (long): max(HWM, candle.high).
   *
   * Nincs trailing-stop update ebben a verzióban — a Phase 7 Track A
   * tapasztalatai alapján a 72h-s profit-time_exit pre-emptálja a trailing-stop
   * trigger-eket, és a Phase 8 spec kifejezetten 168h max-hold-ot kér.
   */
  onOpenPositionUpdate(ctx: PositionManagementContext): PositionUpdate | null {
    const { openPosition, candle } = ctx;

    // HWM frissítés long pozícióknál (a future-proof state-et karbantartjuk).
    if (this.positionHwm === null || this.positionEntryPrice === null) {
      return null;
    }
    if (openPosition.side === "buy") {
      this.positionHwm = Math.max(this.positionHwm, candle.high);
    } else {
      this.positionHwm = Math.min(this.positionHwm, candle.low);
    }

    // Max-hold enforcement — 168h (7 days) after entry, forceExit regardless of PnL.
    if (this.config.maxHoldBars > 0 && openPosition.holdingBars >= this.config.maxHoldBars) {
      return {
        forceExit: true,
        reason: "time_exit",
      };
    }
    return null;
  }

  /**
   * `onPositionClosed` — state cleanup (HWM + entry price reset).
   */
  onPositionClosed(_reason: string): void {
    this.positionHwm = null;
    this.positionEntryPrice = null;
  }
}