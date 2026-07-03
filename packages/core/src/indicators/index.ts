// packages/core/src/indicators/index.ts — indikátor-re-export
//
// Az indikátor-függvények egyetlen belépési ponton keresztül érhetők el
// a `@mm-crypto-bot/core` fogyasztói számára. Az `index.ts` nem tartalmaz
// implementációt — csak az újra-exportálást végzi.
//
// Specifikáció: docs/research/selected-strategy.md §2.

export { ema, lastEma } from "./ema.js";
export { rsi, lastRsi } from "./rsi.js";
export { atr, lastAtr } from "./atr.js";
export { bb, lastBb } from "./bb.js";
export type { BollingerBands } from "./bb.js";
export { adx, lastAdx } from "./adx.js";
export { donchian, lastDonchian } from "./donchian.js";
export type { DonchianChannel } from "./donchian.js";
export { supertrend, lastSupertrend } from "./supertrend.js";
export type { SupertrendPoint } from "./supertrend.js";
export { volumeMa, lastVolumeMa } from "./volume-ma.js";

import { adx } from "./adx.js";
import { atr } from "./atr.js";
import { bb } from "./bb.js";
import { donchian } from "./donchian.js";
import { ema } from "./ema.js";
import { rsi } from "./rsi.js";
import { supertrend } from "./supertrend.js";
import { volumeMa } from "./volume-ma.js";

import type { Candle } from "@mm-crypto-bot/shared/types";

import type { IndicatorState } from "../types.js";

/**
 `computeIndicators` — a HTF / MTF / LTF teljes indikátor-készletének
 kiszámítása egyetlen függvényhívásban. A backtest motor ezt hívja
 minden új HTF/MTF/LTF gyertyánál, és az eredményt eltárolja a
 `MtfState`-ben.

 A függvény **determinisztikus** — nincs belső állapot, csak a
 bemeneti candle-sorozat határozza meg az eredményt.
*/
export function computeIndicators(
  htfCandles: readonly Candle[],
  mtfCandles: readonly Candle[],
  ltfCandles: readonly Candle[],
  config: {
    readonly htfDonchianPeriod: number;
    readonly htfSupertrendPeriod: number;
    readonly htfSupertrendMultiplier: number;
    readonly htfEmaFast: number;
    readonly htfEmaSlow: number;
    readonly htfAdxPeriod: number;
    readonly mtfBbPeriod: number;
    readonly mtfBbStddev: number;
    readonly mtfAdxPeriod: number;
    readonly mtfRsiPeriod: number;
    readonly mtfDonchianPeriod?: number;
    readonly ltfRsiPeriod: number;
    readonly ltfVolumeMaPeriod: number;
    readonly ltfAtrPeriod: number;
  },
): { htf: IndicatorState; mtf: IndicatorState; ltf: IndicatorState } {
  // HTF indikátorok — a legutolsó definialt ertekre van szuksegunk.
  const htfDonchian = donchian(htfCandles, config.htfDonchianPeriod);
  const htfSupertrend = supertrend(
    htfCandles,
    config.htfSupertrendPeriod,
    config.htfSupertrendMultiplier,
  );
  const htfEma50 = ema(htfCandles, config.htfEmaFast);
  const htfEma200 = ema(htfCandles, config.htfEmaSlow);
  const htfAdxSeries = adx(htfCandles, config.htfAdxPeriod);
  // A `lastX` segedfuggvenyek a sor legutolso definialt erteket adjak vissza.
  const lastDon = pickLast(htfDonchian);
  const lastSt = pickLast(htfSupertrend);
  // A HTF candle-ok kozul az utolsot hasznaljuk a `close` mezohoz — a
  // backtest motor pedig osszekoti a LTF candle-t a legutolso HTF candle-lel.
  const lastHtf = htfCandles[htfCandles.length - 1];
  const htf: IndicatorState = {
    ...(lastHtf ? { close: lastHtf.close } : {}),
    candleIndex: htfCandles.length - 1,
    ...(lastDon ? { donchianUpper: lastDon.upper, donchianLower: lastDon.lower } : {}),
    ...(lastSt ? { supertrend: lastSt.value, supertrendDir: lastSt.direction } : {}),
    ...pickNumberField("ema50", pickLastNumber(htfEma50)),
    ...pickNumberField("ema200", pickLastNumber(htfEma200)),
    ...pickNumberField("adx", pickLastNumber(htfAdxSeries)),
  };
  // MTF indikátorok.
  const mtfBb = bb(mtfCandles, config.mtfBbPeriod, config.mtfBbStddev);
  const mtfAdxSeries = adx(mtfCandles, config.mtfAdxPeriod);
  const mtfRsi = rsi(mtfCandles, config.mtfRsiPeriod);
  const lastBb = pickLast(mtfBb);
  // MTF Donchian (optional — Phase 5 DonchianBreakoutStrategy használja).
  const mtfDonchian =
    config.mtfDonchianPeriod !== undefined
      ? donchian(mtfCandles, config.mtfDonchianPeriod)
      : [];
  const lastMtfDon = pickLast(mtfDonchian);
  const lastMtf = mtfCandles[mtfCandles.length - 1];
  const mtf: IndicatorState = {
    ...(lastMtf ? { close: lastMtf.close } : {}),
    candleIndex: mtfCandles.length - 1,
    ...(lastBb
      ? { bbUpper: lastBb.upper, bbLower: lastBb.lower, bbMiddle: lastBb.middle }
      : {}),
    ...pickNumberField("adx", pickLastNumber(mtfAdxSeries)),
    ...pickNumberField("rsi", pickLastNumber(mtfRsi)),
    ...(lastMtfDon
      ? { donchianUpper: lastMtfDon.upper, donchianLower: lastMtfDon.lower }
      : {}),
  };
  // LTF indikátorok.
  const ltfRsi = rsi(ltfCandles, config.ltfRsiPeriod);
  const ltfVolMa = volumeMa(ltfCandles, config.ltfVolumeMaPeriod);
  const ltfAtr = atr(ltfCandles, config.ltfAtrPeriod);
  const lastLtf = ltfCandles[ltfCandles.length - 1];
  const ltf: IndicatorState = {
    ...(lastLtf ? { close: lastLtf.close } : {}),
    candleIndex: ltfCandles.length - 1,
    ...pickNumberField("rsi", pickLastNumber(ltfRsi)),
    ...pickNumberField("volumeMa", pickLastNumber(ltfVolMa)),
    ...pickNumberField("atr", pickLastNumber(ltfAtr)),
  };
  return { htf, mtf, ltf };
}

/**
 `pickNumberField` — ha az érték definiált, visszaadja a `{[key]: value}`
 objektumot; ha undefined, üres objektumot. Segít elkerülni a
 `exactOptionalPropertyTypes: true` miatti `undefined` típusú property
 hibákat.
*/
// eslint-disable-next-line @typescript-eslint/consistent-indexed-object-style -- mapped type jobban fejezi ki az opcionális K kulcsot, mint a Record
type OptionalNumberField<K extends string> = { readonly [P in K]?: number };

function pickNumberField<K extends string>(
  key: K,
  value: number | undefined,
): OptionalNumberField<K> {
  return value !== undefined ? ({ [key]: value } as OptionalNumberField<K>) : {};
}

/**
 `pickLast` — egy `T | undefined` sor legutolso definialt eleme.
 Altalanos seged a belső indikátor-pipeline-hoz; a backtest motor
 ritkán hasznalja kozvetlenul.
*/
function pickLast<T>(series: readonly (T | undefined)[]): T | undefined {
  for (let i = series.length - 1; i >= 0; i--) {
    const v = series[i];
    if (v !== undefined) {
      return v;
    }
  }
  return undefined;
}

/**
 `pickLastNumber` — a `pickLast` numerikus specializalasa. A 100%-os
 coverage miatt kell kulon fuggvenykent, hogy a return-tipus explicit legyen.
*/
function pickLastNumber(series: readonly (number | undefined)[]): number | undefined {
  for (let i = series.length - 1; i >= 0; i--) {
    const v = series[i];
    if (v !== undefined) {
      return v;
    }
  }
  return undefined;
}
