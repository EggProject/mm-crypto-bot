// packages/core/src/types.ts — a `@mm-crypto-bot/core` domain típusai
//
// A kiválasztott stratégia (MTF-Trend-Konfluencia Kompozit v1.0)
// belső típusai. Ezek a típusok a stratégia-motor és a backtest
// motor közös "nyelvtanát" adják.
//
// Specifikáció: docs/research/selected-strategy.md

import type { Candle, Side, Symbol, Timeframe } from "@mm-crypto-bot/shared/types";

/**
 `IndicatorState` — a multi-timeframe indikátor-állapot. A stratégia-motor
 minden timeframe-re nyilvántartja az aktuális indikátor-értékeket, és
 a HTF/MTF/LTF rétegek az `mtfState` aggregate-en keresztül kommunikálnak.

 - `close` — a forrás-gyertya záróára (a Donchian/BB összehasonlításokhoz).
 - `candleIndex` — a forrás-gyertya sorszáma a feed-en belül.
 - `donchianUpper` / `donchianLower` — Donchian(20) csatorna (HTF).
 - `supertrend` — Supertrend(10, 3.0) vonal (HTF).
 - `supertrendDir` — `+1` up, `-1` down (HTF).
 - `ema50` / `ema200` — EMA 50 és 200 periódussal (HTF).
 - `bbUpper` / `bbLower` / `bbMiddle` — Bollinger Bands(20, 2σ) (MTF).
 - `adx` — ADX(14) (HTF + MTF).
 - `rsi` — RSI(14) (MTF + LTF).
 - `atr` — ATR(14) (LTF, a stop-loss távolsághoz).
 - `volumeMa` — Volume MA(20) (LTF, trigger-konfirmáció).

 Bármelyik mező `undefined`, ha a számításhoz nincs elég korábbi gyertya
 (az indikátor "bemelegedési" periódusában vagyunk).
*/
export interface IndicatorState {
  readonly close?: number;
  readonly candleIndex?: number;
  readonly donchianUpper?: number;
  readonly donchianLower?: number;
  readonly supertrend?: number;
  readonly supertrendDir?: 1 | -1;
  readonly ema50?: number;
  readonly ema200?: number;
  readonly bbUpper?: number;
  readonly bbLower?: number;
  readonly bbMiddle?: number;
  readonly adx?: number;
  readonly rsi?: number;
  readonly atr?: number;
  readonly volumeMa?: number;
}

/**
 `MtfState` — a három időkeret-állapot összessége. A stratégia-motor a
 `MtfTrendConfluenceStrategy.onCandle` hívásakor kapja meg (az LTF-en),
 és ezen keresztül éri el a HTF és MTF indikátor-értékeket is.
*/
export interface MtfState {
  readonly htf: IndicatorState;
  readonly mtf: IndicatorState;
  readonly ltf: IndicatorState;
}

/**
 `StrategyContext` — a `Strategy.onCandle` callback bemenete.
 Az LTF-en hívódik meg, de a `mtfState` tartalmazza a HTF és MTF
 indikátor-értékeket is.

 - `symbol` — a kereskedett eszköz (BTC/USDC, ETH/USDC, SOL/USDC).
 - `timeframe` — mindig az LTF (a stratégia a LTF-en triggerel).
 - `candleIndex` — az aktuális LTF gyertya sorszáma a feed-en belül.
 - `candle` — az aktuális LTF gyertya OHLCV adata.
 - `mtfState` — a HTF + MTF + LTF indikátor-állapot.
 - `pricePrecision` — a `roundTo` tizedesjegye az árakhoz (BTC=2, ETH=2, SOL=3).
*/
export interface StrategyContext {
  readonly symbol: Symbol;
  readonly timeframe: Timeframe;
  readonly candleIndex: number;
  readonly candle: Candle;
  readonly mtfState: MtfState;
  readonly pricePrecision: number;
}

/**
 `StrategySignal` — a `Strategy.onCandle` kimenete. Ha a stratégia
 long/short jelet akar adni, visszaadja ezt a típust; ha nincs jel,
 `null`-t ad vissza.

 - `side` — `buy` (long) vagy `sell` (short).
 - `confidence` — 0..1 közötti érték, a jel erőssége. A backtest a
   position-size-ot nem skálázza ezzel, de a riportban rögzíti.
 - `reason` — magyar/angol szöveges indoklás a debug-hoz és a trade-listához.
 - `stopLoss` — javasolt stop-loss ár (LTF ATR(14) alapján).
 - `takeProfit` — javasolt take-profit ár (R:R = 1:2.5 a stop-távolsággal).
*/
export interface StrategySignal {
  readonly side: Side;
  readonly confidence: number;
  readonly reason: string;
  readonly stopLoss: number;
  readonly takeProfit: number;
}

/**
 `Strategy` — egy kereskedési stratégia absztrakciója. A backtest
 motor ezen az interfészen keresztül kommunikál a konkrét stratégiával.
*/
export interface Strategy {
  readonly name: string;
  readonly timeframes: readonly Timeframe[];
  /**
   Új LTF gyertya esetén hívódik. `null` = nincs jelzés.
   A motor a `mtfState`-et előre feltölti a legutóbbi HTF/MTF/LTF
   indikátor-értékekkel — a stratégia nem saját maga számolja azokat.
  */
  onCandle(ctx: StrategyContext): StrategySignal | null;
  /**
   `warmup` — visszaadja, hogy hány LTF gyertyára van szükség a HTF
   indikátorok (EMA 200) bemelegedéséhez. A backtest az első
   `warmup` gyertyán még nem adhat ki jelet.
  */
  warmup(): number;
}

/**
 `StrategyConfig` — a `MtfTrendConfluenceStrategy` konfigurációs paraméterei.
 A teljes specifikáció a `selected-strategy.md` §2-ben és §3-4-ben.
*/
export interface MtfTrendConfluenceConfig {
  /** HTF indikátor-periódusok (Donchian, Supertrend, EMA, ADX). */
  readonly htf: {
    readonly donchianPeriod: number;
    readonly supertrendPeriod: number;
    readonly supertrendMultiplier: number;
    readonly emaFast: number;
    readonly emaSlow: number;
    readonly adxPeriod: number;
    readonly adxThreshold: number;
  };
  /** MTF indikátor-periódusok (BB, ADX, RSI). */
  readonly mtf: {
    readonly bbPeriod: number;
    readonly bbStddev: number;
    readonly adxPeriod: number;
    readonly adxThreshold: number;
    readonly rsiPeriod: number;
    readonly rsiLongThreshold: number;
    readonly rsiShortThreshold: number;
  };
  /** LTF indikátor-periódusok (RSI, VolumeMA, ATR). */
  readonly ltf: {
    readonly rsiPeriod: number;
    readonly rsiLongCross: number;
    readonly rsiShortCross: number;
    readonly volumeMaPeriod: number;
    readonly volumeConfirmMultiplier: number;
    readonly atrPeriod: number;
    readonly atrStopMultiplier: number;
    readonly atrTpRMultiple: number;
  };
  /** Belépési/kilépési R:R és trailing stop paraméterek. */
  readonly risk: {
    readonly stopAtrMultiplier: number;
    readonly takeProfitRMultiple: number;
    readonly timeExitHours: number;
  };
}

export const DEFAULT_MTF_CONFIG: MtfTrendConfluenceConfig = {
  htf: {
    donchianPeriod: 20,
    supertrendPeriod: 10,
    supertrendMultiplier: 3.0,
    emaFast: 50,
    emaSlow: 200,
    adxPeriod: 14,
    adxThreshold: 20,
  },
  mtf: {
    bbPeriod: 20,
    bbStddev: 2.0,
    adxPeriod: 14,
    adxThreshold: 20,
    rsiPeriod: 14,
    rsiLongThreshold: 35,
    rsiShortThreshold: 65,
  },
  ltf: {
    rsiPeriod: 14,
    rsiLongCross: 30,
    rsiShortCross: 70,
    volumeMaPeriod: 20,
    volumeConfirmMultiplier: 1.2,
    atrPeriod: 14,
    atrStopMultiplier: 1.5,
    atrTpRMultiple: 2.5,
  },
  risk: {
    stopAtrMultiplier: 1.5,
    takeProfitRMultiple: 2.5,
    timeExitHours: 72,
  },
};
