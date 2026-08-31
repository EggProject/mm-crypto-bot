import type { PivotPointGridStrategy } from "./pivot-point-grid.js";
import type { StrategyContext } from "../types.js";
import { makeSymbol, type Candle } from "@mm-crypto-bot/shared/types";

export const DAY_ZERO_START_MS = 1_699_920_000_000;
export const HTF_MS = 86_400_000;
export const LTF_MS = 15 * 60 * 1000;
const DEFAULT_CANDLE_TIMESTAMP_MS = 1_700_000_000_000;

export const makeCandle = (
  close: number,
  options?: {
    readonly timestamp?: number;
    readonly open?: number;
    readonly high?: number;
    readonly low?: number;
    readonly volume?: number;
  },
): Candle => ({
  timestamp: options?.timestamp ?? DEFAULT_CANDLE_TIMESTAMP_MS,
  open: options?.open ?? close,
  high: options?.high ?? close,
  low: options?.low ?? close,
  close,
  volume: options?.volume ?? 1000,
});

export const makeContext = (overrides: Partial<StrategyContext> = {}): StrategyContext => ({
  symbol: makeSymbol("BTC/USDT"),
  timeframe: "15m",
  candleIndex: 200,
  candle: makeCandle(100),
  mtfState: {
    htf: {},
    mtf: {},
    ltf: {},
  },
  pricePrecision: 2,
  ...overrides,
});

export function feedCandles(
  strategy: PivotPointGridStrategy,
  candles: readonly {
    readonly timestamp: number;
    readonly high: number;
    readonly low: number;
    readonly close: number;
  }[],
  candleIndexBase = 100,
): void {
  for (const [index, candle] of candles.entries()) {
    strategy.onCandle(
      makeContext({
        candleIndex: candleIndexBase + index,
        candle: makeCandle(candle.close, candle),
      }),
    );
  }
}

export function seedPivotData(strategy: PivotPointGridStrategy): void {
  const dayOneBoundaryMs = DAY_ZERO_START_MS + HTF_MS;
  const dayZeroCandles = [
    { timestamp: DAY_ZERO_START_MS, high: 101, low: 99, close: 100 },
    { timestamp: DAY_ZERO_START_MS + LTF_MS, high: 110, low: 109, close: 110 },
    { timestamp: DAY_ZERO_START_MS + 2 * LTF_MS, high: 91, low: 90, close: 90 },
    { timestamp: DAY_ZERO_START_MS + 3 * LTF_MS, high: 101, low: 99, close: 100 },
  ];
  feedCandles(strategy, dayZeroCandles);
  strategy.onCandle(
    makeContext({
      candleIndex: 104,
      candle: makeCandle(102, {
        timestamp: dayOneBoundaryMs,
        open: 102,
        high: 103,
        low: 101,
      }),
    }),
  );
}
