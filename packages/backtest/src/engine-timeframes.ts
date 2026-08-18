import type { Candle } from "@mm-crypto-bot/shared/types";

export function aggregateToTimeframe(ltfCandles: readonly Candle[], targetMs: number): readonly Candle[] {
  const firstCandle = ltfCandles[0];
  if (firstCandle === undefined || targetMs <= 0) {
    return [];
  }

  const aggregatedCandles: Candle[] = [];
  let bucketStart = firstCandle.timestamp - (firstCandle.timestamp % targetMs);
  let bucket = createBucket(firstCandle, bucketStart);

  for (const candle of ltfCandles.slice(1)) {
    const bucketEnd = bucketStart + targetMs;
    if (candle.timestamp >= bucketEnd) {
      aggregatedCandles.push(bucket);
      bucketStart = candle.timestamp - (candle.timestamp % targetMs);
      bucket = createBucket(candle, bucketStart);
      continue;
    }

    bucket = extendBucket(bucket, candle);
  }

  aggregatedCandles.push(bucket);
  return aggregatedCandles;
}

export function aggregateCompleteToTimeframe(
  ltfCandles: readonly Candle[],
  ltfMs: number,
  targetMs: number,
): readonly Candle[] {
  if (targetMs < ltfMs || targetMs % ltfMs !== 0) {
    throw new Error("HTF and MTF timeframes must be whole multiples of the LTF timeframe");
  }

  const expectedCandleCount = targetMs / ltfMs;
  const buckets = new Map<number, CandleBucket>();
  for (const candle of ltfCandles) {
    const bucketStart = candle.timestamp - (candle.timestamp % targetMs);
    const bucket = buckets.get(bucketStart);
    if (bucket === undefined) {
      buckets.set(bucketStart, { candles: [candle], first: candle, last: candle });
    } else {
      bucket.candles.push(candle);
      bucket.last = candle;
    }
  }

  const completedCandles: Candle[] = [];
  for (const [bucketStart, bucket] of buckets) {
    if (
      bucket.candles.length !== expectedCandleCount ||
      !isGapFreeBucket(bucket.candles, bucketStart, ltfMs)
    ) {
      continue;
    }
    completedCandles.push({
      timestamp: bucketStart,
      open: bucket.first.open,
      high: Math.max(...bucket.candles.map((candle) => candle.high)),
      low: Math.min(...bucket.candles.map((candle) => candle.low)),
      close: bucket.last.close,
      volume: bucket.candles.reduce((totalVolume, candle) => totalVolume + candle.volume, 0),
    });
  }
  return completedCandles;
}

interface CandleBucket {
  readonly candles: Candle[];
  readonly first: Candle;
  last: Candle;
}

function createBucket(candle: Candle, timestamp: number): Candle {
  return {
    timestamp,
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
    volume: candle.volume,
  };
}

function extendBucket(bucket: Candle, candle: Candle): Candle {
  return {
    timestamp: bucket.timestamp,
    open: bucket.open,
    high: Math.max(bucket.high, candle.high),
    low: Math.min(bucket.low, candle.low),
    close: candle.close,
    volume: bucket.volume + candle.volume,
  };
}

function isGapFreeBucket(bucket: readonly Candle[], bucketStart: number, ltfMs: number): boolean {
  for (const [index, candle] of bucket.entries()) {
    if (candle.timestamp !== bucketStart + index * ltfMs) {
      return false;
    }
  }
  return true;
}
