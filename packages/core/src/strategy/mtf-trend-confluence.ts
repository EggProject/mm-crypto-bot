// packages/core/src/strategy/mtf-trend-confluence.ts — MTF-Trend-Konfluencia Kompozit v1.0
//
// A kiválasztott stratégia implementációja. Három rétegből épül fel:
//
//   HTF (1D) — trend-szűrő: Donchian(20) + Supertrend(10, 3.0) + EMA(50/200) + ADX(14)
//   MTF (4H) — setup-kereső: Bollinger Bands(20, 2σ) + ADX(14) + RSI(14)
//   LTF (1H) — trigger: RSI(14) cross-back + Volume MA(20) + ATR(14)
//
// A belépés CSAK akkor történik meg, ha mindhárom réteg egyetért:
//   1. HTF a trade irányába mutat (trend-felol oldal).
//   2. MTF-en van egy pullback setup (BB-szél + RSI-szél + ADX > 20).
//   3. LTF-en a trigger beérkezik (RSI cross-back + volumen-konfirmáció).
//
// A stop-loss és take-profit az LTF ATR(14) és egy R:R arány alapján
// számítódik. A kilépés a backtest motor felelőssége (a stratégia csak
// belépési jelzést ad).
//
// Specifikáció: docs/research/selected-strategy.md §3-§4.

import { roundTo } from "@mm-crypto-bot/shared/utils";

import { DEFAULT_MTF_CONFIG } from "../types.js";
import type {
  IndicatorState,
  MtfTrendConfluenceConfig,
  Strategy,
  StrategyContext,
  StrategySignal,
} from "../types.js";

/**
 `MtfTrendConfluenceStrategy` — a kiválasztott MTF-TKC v1.0 stratégia.

 A stratégia **stateful**: nyilvántartja az előző LTF-gyertya RSI-értékét,
 mert a cross-back triggert csak az előző értékhez képest lehet detektálni.

 A `onCandle` metódus mindig az LTF-en hívódik, de a `MtfState` tartalmazza
 a HTF és MTF indikátor-értékeit is (a backtest motor előre kiszámolja
 és átadja). Ezzel a stratégia nem foglalkozik saját maga az
 indikátor-számítással — a tiszta szeparáció megkönnyíti a unit-tesztelést.
*/
export class MtfTrendConfluenceStrategy implements Strategy {
  readonly name = "MTF-Trend-Konfluencia Kompozit v1.0";
  readonly timeframes = ["1d", "4h", "1h"] as const;
  readonly config: MtfTrendConfluenceConfig;

  // A cross-back trigger detektálásához szükséges állapot.
  // Az első LTF gyertyán még nincs előző RSI — ekkor nincs jelzés.
  private prevLtfRsi: number | undefined;

  constructor(config: MtfTrendConfluenceConfig = DEFAULT_MTF_CONFIG) {
    this.config = config;
  }

  /**
   `warmup` — visszaadja, hogy hány LTF gyertyára van szükség a HTF
   indikátorok (EMA 200) bemelegedéséhez. A backtest az első
   `warmup` gyertyán még nem adhat ki jelet.

   A legszélesebb ablak a HTF-en az EMA 200, de a Donchian/Supertrend
   is 20-as periódussal dolgozik. A HTF candle-ok LTF-be váltva
   `200 * 24` LTF gyertyát jelentenek (24 LTF gyertya / HTF nap 1 órás
   idősíkon). Hozzáadunk egy biztonsági puffert.
  */
  warmup(): number {
    return this.config.htf.emaSlow * 24 + 24;
  }

  /**
   `onCandle` — az LTF gyertyán hívódik. Visszaadja a belépési jelet vagy
   `null`-t, ha nincs setup.

   A jel-zés logikája:
     1. HTF trend-szűrő ellenőrzése (long/short).
     2. MTF setup ellenőrzése.
     3. LTF trigger ellenőrzése (RSI cross-back + volumen).
     4. Stop-loss és take-profit kiszámítása az LTF ATR(14) alapján.
  */
  onCandle(ctx: StrategyContext): StrategySignal | null {
    const { mtfState, candle, candleIndex, pricePrecision } = ctx;
    // A bemelegedési periódus alatt (az első `warmup()` candle-ben) nem adunk jelet.
    // A backtest motor ezt nem ellenőrzi, mert a mtfState-ben lévő értékek
    // a `undefined`-sé válással jelzik a "még nincs elég adat" állapotot.
    if (candleIndex < this.warmup()) {
      this.prevLtfRsi = mtfState.ltf.rsi;
      return null;
    }
    // 1) HTF trend-szűrő: a három jelzés közül legalább az egyiknek stimmelnie kell,
    //    ÉS az EMA-szerkezetnek is meg kell felelnie, ÉS az ADX > küszöb.
    const longHtf = isLongTrend(mtfState.htf, this.config.htf);
    const shortHtf = isShortTrend(mtfState.htf, this.config.htf);
    if (!longHtf && !shortHtf) {
      this.prevLtfRsi = mtfState.ltf.rsi;
      return null;
    }
    // 2) MTF setup: pullback a BB-szélhez + RSI a küszöbön túl + ADX > 20.
    // A pullback-ot a MTF záróárhoz hasonlítjuk (mtfState.mtf.close),
    // mert a multi-timeframe setup a MTF-en mért, nem a LTF-en.
    const longMtf = isLongSetup(mtfState.mtf, this.config.mtf);
    const shortMtf = isShortSetup(mtfState.mtf, this.config.mtf);
    if (longHtf && !longMtf) {
      this.prevLtfRsi = mtfState.ltf.rsi;
      return null;
    }
    if (shortHtf && !shortMtf) {
      this.prevLtfRsi = mtfState.ltf.rsi;
      return null;
    }
    // 3) LTF trigger: RSI cross-back (prev alatt, most fölött) + volumen-konfirmáció.
    const currentRsi = mtfState.ltf.rsi;
    if (currentRsi === undefined || this.prevLtfRsi === undefined) {
      this.prevLtfRsi = currentRsi;
      return null;
    }
    const atrValue = mtfState.ltf.atr;
    const volMa = mtfState.ltf.volumeMa;
    if (atrValue === undefined || volMa === undefined) {
      this.prevLtfRsi = currentRsi;
      return null;
    }
    const longTrigger =
      this.prevLtfRsi <= this.config.ltf.rsiLongCross && currentRsi > this.config.ltf.rsiLongCross;
    const shortTrigger =
      this.prevLtfRsi >= this.config.ltf.rsiShortCross && currentRsi < this.config.ltf.rsiShortCross;
    // Volumen-konfirmáció: a trigger gyertya volumene >= 1.2 * VolumeMA(20).
    const volumeOk = candle.volume >= this.config.ltf.volumeConfirmMultiplier * volMa;
    // Középvonal-visszatérés: a LTF candle close a BB_middle fölé (long) / alá (short).
    const bbMid = mtfState.mtf.bbMiddle;
    const midOkLong = bbMid !== undefined && candle.close > bbMid;
    const midOkShort = bbMid !== undefined && candle.close < bbMid;
    if (longHtf && longMtf && longTrigger && volumeOk && midOkLong) {
      const stopLoss = candle.close - this.config.risk.stopAtrMultiplier * atrValue;
      const risk = candle.close - stopLoss;
      const takeProfit = candle.close + this.config.risk.takeProfitRMultiple * risk;
      this.prevLtfRsi = currentRsi;
      return {
        side: "buy",
        confidence: 1,
        reason: "MTF-TKC long: HTF trend + MTF pullback + LTF cross-back + volume + BB mid",
        stopLoss: roundTo(stopLoss, pricePrecision),
        takeProfit: roundTo(takeProfit, pricePrecision),
      };
    }
    if (shortHtf && shortMtf && shortTrigger && volumeOk && midOkShort) {
      const stopLoss = candle.close + this.config.risk.stopAtrMultiplier * atrValue;
      const risk = stopLoss - candle.close;
      const takeProfit = candle.close - this.config.risk.takeProfitRMultiple * risk;
      this.prevLtfRsi = currentRsi;
      return {
        side: "sell",
        confidence: 1,
        reason: "MTF-TKC short: HTF trend + MTF pullback + LTF cross-back + volume + BB mid",
        stopLoss: roundTo(stopLoss, pricePrecision),
        takeProfit: roundTo(takeProfit, pricePrecision),
      };
    }
    // Nincs jelzés — frissítjük az előző RSI-t a következő gyertyához.
    this.prevLtfRsi = currentRsi;
    return null;
  }
}

/**
 `isLongTrend` — a HTF indikátor-állapotból megállapítja, hogy a trend
 long irányba mutat-e. A kiválasztott specifikáció §3.1 szerint:
   - close > Donchian_upper(20) VAGY Supertrend irány = up
   - ÉS close > EMA(50) ÉS EMA(50) > EMA(200)
   - ÉS ADX > 20

 A HTF close-t a `IndicatorState.close` mező tartalmazza (a backtest
 motor biztosítja, hogy ez a legutolsó HTF candle záróára legyen).
*/
function isLongTrend(htf: IndicatorState, cfg: MtfTrendConfluenceConfig["htf"]): boolean {
  if (htf.close === undefined) return false;
  if (htf.donchianUpper === undefined) return false;
  if (htf.ema50 === undefined || htf.ema200 === undefined) return false;
  if (htf.adx === undefined) return false;
  // Az ADX csak a trend *erősségét* méri — a trend-irányt a Donchian
  // és/vagy a Supertrend adja. A specifikáció a "VAGY" kapcsolatot írja
  // elő, de a biztonság kedvéért megköveteljük, hogy legalább az egyik
  // stimmeljen.
  if (htf.adx <= cfg.adxThreshold) return false;
  if (!(htf.ema50 > htf.ema200)) return false;
  // A "close > Donchian_upper" VAGY "Supertrend irány = up" — a
  // kettő közül legalább az egyiknek teljesülnie kell.
  const donchianBreakout = htf.close > htf.donchianUpper;
  const supertrendUp = htf.supertrendDir === 1;
  return donchianBreakout || supertrendUp;
}

/**
 `isShortTrend` — a HTF short trend detektálása. A long feltétel tükörképe.
*/
function isShortTrend(htf: IndicatorState, cfg: MtfTrendConfluenceConfig["htf"]): boolean {
  if (htf.close === undefined) return false;
  if (htf.donchianLower === undefined) return false;
  if (htf.ema50 === undefined || htf.ema200 === undefined) return false;
  if (htf.adx === undefined) return false;
  if (htf.adx <= cfg.adxThreshold) return false;
  if (!(htf.ema50 < htf.ema200)) return false;
  const donchianBreakdown = htf.close < htf.donchianLower;
  const supertrendDown = htf.supertrendDir === -1;
  return donchianBreakdown || supertrendDown;
}

/**
 `isLongSetup` — a MTF pullback-setup long irányba. A specifikáció §3.1:
   - close <= BB_lower(20, 2σ)  (pullback a BB alsó sávhoz)
   - ÉS RSI(14, 4H) <= 35
   - ÉS ADX(14, 4H) > 20

 A `mtf.close` (a backtest motor biztositja) a legutolso MTF candle
 zaroara — ehhez hasonlitjuk a BB savokat.
*/
function isLongSetup(
  mtf: IndicatorState,
  cfg: MtfTrendConfluenceConfig["mtf"],
): boolean {
  if (mtf.bbLower === undefined) return false;
  if (mtf.rsi === undefined) return false;
  if (mtf.adx === undefined) return false;
  if (mtf.adx <= cfg.adxThreshold) return false;
  if (mtf.rsi > cfg.rsiLongThreshold) return false;
  if (mtf.close === undefined) return false;
  if (!(mtf.close <= mtf.bbLower)) return false;
  return true;
}

/**
 `isShortSetup` — a MTF pullback-setup short irányba.
*/
function isShortSetup(
  mtf: IndicatorState,
  cfg: MtfTrendConfluenceConfig["mtf"],
): boolean {
  if (mtf.bbUpper === undefined) return false;
  if (mtf.rsi === undefined) return false;
  if (mtf.adx === undefined) return false;
  if (mtf.adx <= cfg.adxThreshold) return false;
  if (mtf.rsi < cfg.rsiShortThreshold) return false;
  if (mtf.close === undefined) return false;
  if (!(mtf.close >= mtf.bbUpper)) return false;
  return true;
}
