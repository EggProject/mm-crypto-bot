import { adx, atr, bb, donchian, ema, rsi, supertrend, volumeMa } from "@mm-crypto-bot/core";
import type {
  BollingerBands,
  computeIndicators,
  DonchianChannel,
  IndicatorState,
  MtfState,
  SupertrendPoint,
} from "@mm-crypto-bot/core";
import type { Candle } from "@mm-crypto-bot/shared/types";

export type IndicatorConfig = Parameters<typeof computeIndicators>[3];

export interface HistoricalIndicatorTimeline {
  readonly htf: readonly IndicatorState[];
  readonly mtf: readonly IndicatorState[];
  readonly ltf: readonly IndicatorState[];
}

export class HistoricalIndicatorCursor {
  private htfIndex = -1;
  private mtfIndex = -1;

  public constructor(
    private readonly timeline: HistoricalIndicatorTimeline,
    private readonly htfCandles: readonly Candle[],
    private readonly mtfCandles: readonly Candle[],
    private readonly htfMs: number,
    private readonly mtfMs: number,
  ) {}

  private stateOrEmpty(states: readonly IndicatorState[], index: number): IndicatorState {
    return index < 0 ? { candleIndex: -1 } : this.requireState(states, index, "historical");
  }

  private requireState(states: readonly IndicatorState[], index: number, label: string): IndicatorState {
    const state = states.at(index);
    if (state === undefined) {
      throw new Error(`Missing ${label} indicator state at index ${String(index)}.`);
    }
    return state;
  }

  public stateAt(decisionTime: number, ltfIndex: number): MtfState {
    this.htfIndex = advanceClosedCandleIndex(this.htfCandles, this.htfIndex, this.htfMs, decisionTime);
    this.mtfIndex = advanceClosedCandleIndex(this.mtfCandles, this.mtfIndex, this.mtfMs, decisionTime);

    return {
      htf: this.stateOrEmpty(this.timeline.htf, this.htfIndex),
      mtf: this.stateOrEmpty(this.timeline.mtf, this.mtfIndex),
      ltf: this.requireState(this.timeline.ltf, ltfIndex, "LTF"),
    };
  }
}

export function precomputeHistoricalIndicatorTimeline(
  htfCandles: readonly Candle[],
  mtfCandles: readonly Candle[],
  ltfCandles: readonly Candle[],
  config: IndicatorConfig,
): HistoricalIndicatorTimeline {
  return {
    htf: buildHtfTimeline(htfCandles, config),
    mtf: buildMtfTimeline(mtfCandles, config),
    ltf: buildLtfTimeline(ltfCandles, config),
  };
}

function buildHtfTimeline(candles: readonly Candle[], config: IndicatorConfig): readonly IndicatorState[] {
  const donchianSeries = carryForward<DonchianChannel>(donchian(candles, config.htfDonchianPeriod));
  const supertrendSeries = carryForward<SupertrendPoint>(
    supertrend(candles, config.htfSupertrendPeriod, config.htfSupertrendMultiplier),
  );
  const fastEmaSeries = carryForward<number>(ema(candles, config.htfEmaFast));
  const slowEmaSeries = carryForward<number>(ema(candles, config.htfEmaSlow));
  const adxSeries = carryForward<number>(adx(candles, config.htfAdxPeriod));

  return candles.map((candle, index): IndicatorState => {
    const donchianValue = donchianSeries.at(index);
    const supertrendValue = supertrendSeries.at(index);
    const fastEma = fastEmaSeries.at(index);
    const slowEma = slowEmaSeries.at(index);
    const adxValue = adxSeries.at(index);
    return {
      close: candle.close,
      candleIndex: index,
      ...(donchianValue !== undefined && {
        donchianUpper: donchianValue.upper,
        donchianLower: donchianValue.lower,
      }),
      ...(supertrendValue !== undefined && {
        supertrend: supertrendValue.value,
        supertrendDir: supertrendValue.direction,
      }),
      ...(fastEma !== undefined && { ema50: fastEma }),
      ...(slowEma !== undefined && { ema200: slowEma }),
      ...(adxValue !== undefined && { adx: adxValue }),
    };
  });
}

function buildMtfTimeline(candles: readonly Candle[], config: IndicatorConfig): readonly IndicatorState[] {
  const bandsSeries = carryForward<BollingerBands>(bb(candles, config.mtfBbPeriod, config.mtfBbStddev));
  const adxSeries = carryForward<number>(adx(candles, config.mtfAdxPeriod));
  const rsiSeries = baselineCompatibleRsi(candles, config.mtfRsiPeriod);
  const donchianSeries =
    config.mtfDonchianPeriod === undefined
      ? []
      : carryForward<DonchianChannel>(donchian(candles, config.mtfDonchianPeriod));

  return candles.map((candle, index): IndicatorState => {
    const bands = bandsSeries.at(index);
    const adxValue = adxSeries.at(index);
    const rsiValue = rsiSeries.at(index);
    const donchianValue = donchianSeries.at(index);
    return {
      close: candle.close,
      candleIndex: index,
      ...(bands !== undefined && { bbUpper: bands.upper, bbLower: bands.lower, bbMiddle: bands.middle }),
      ...(adxValue !== undefined && { adx: adxValue }),
      ...(rsiValue !== undefined && { rsi: rsiValue }),
      ...(donchianValue !== undefined && {
        donchianUpper: donchianValue.upper,
        donchianLower: donchianValue.lower,
      }),
    };
  });
}

function buildLtfTimeline(candles: readonly Candle[], config: IndicatorConfig): readonly IndicatorState[] {
  const rsiSeries = baselineCompatibleRsi(candles, config.ltfRsiPeriod);
  const volumeSeries = carryForward<number>(volumeMa(candles, config.ltfVolumeMaPeriod));
  const atrSeries = carryForward<number>(atr(candles, config.ltfAtrPeriod));

  return candles.map((candle, index): IndicatorState => {
    const rsiValue = rsiSeries.at(index);
    const volumeValue = volumeSeries.at(index);
    const atrValue = atrSeries.at(index);
    return {
      close: candle.close,
      candleIndex: index,
      ...(rsiValue !== undefined && { rsi: rsiValue }),
      ...(volumeValue !== undefined && { volumeMa: volumeValue }),
      ...(atrValue !== undefined && { atr: atrValue }),
    };
  });
}

function advanceClosedCandleIndex(
  candles: readonly Candle[],
  currentIndex: number,
  timeframeMs: number,
  decisionTime: number,
): number {
  let nextIndex = currentIndex + 1;
  for (let candle = candles.at(nextIndex); candle !== undefined; candle = candles.at(nextIndex)) {
    if (candle.timestamp + timeframeMs > decisionTime) {
      break;
    }
    nextIndex += 1;
  }
  return nextIndex - 1;
}

function carryForward<T>(series: readonly (T | undefined)[]): readonly (T | undefined)[] {
  const carried: (T | undefined)[] = [];
  let latest: T | undefined;
  for (const value of series) {
    if (value !== undefined) {
      latest = value;
    }
    carried.push(latest);
  }
  return carried;
}

function baselineCompatibleRsi(candles: readonly Candle[], period: number): readonly (number | undefined)[] {
  const values = [...rsi(candles, period)];
  if (values.length <= period) {
    return carryForward<number>(values);
  }
  return carryForward<number>([...values.slice(0, period), undefined, ...values.slice(period + 1)]);
}
