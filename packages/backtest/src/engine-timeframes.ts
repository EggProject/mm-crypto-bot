import type { Candle } from "@mm-crypto-bot/shared/types";

export function aggregateToTimeframe(ltfCandles: readonly Candle[], targetMs: number): readonly Candle[] {
  const firstCandle = ltfCandles[0];
  if (firstCandle === undefined || targetMs <= 0) {
    return [];
  }

  const aggregatedCandles: Candle[] = [];
  let bucket: Candle | undefined;
  let bucketStart = firstCandle.timestamp - (firstCandle.timestamp % targetMs);

  for (const candle of ltfCandles) {
    const bucketEnd = bucketStart + targetMs;
    if (candle.timestamp >= bucketEnd) {
      if (bucket !== undefined) {
        aggregatedCandles.push(bucket);
      }
      bucketStart = candle.timestamp - (candle.timestamp % targetMs);
      bucket = createBucket(candle, bucketStart);
      continue;
    }

    bucket = bucket === undefined ? createBucket(candle, bucketStart) : extendBucket(bucket, candle);
  }

  if (bucket === undefined) {
    throw new Error("A non-empty candle sequence must produce a timeframe bucket.");
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
  const buckets = new Map<number, Candle[]>();
  for (const candle of ltfCandles) {
    const bucketStart = candle.timestamp - (candle.timestamp % targetMs);
    const bucket = buckets.get(bucketStart);
    if (bucket === undefined) {
      buckets.set(bucketStart, [candle]);
    } else {
      bucket.push(candle);
    }
  }

  const completedCandles: Candle[] = [];
  for (const [bucketStart, bucket] of buckets) {
    if (bucket.length !== expectedCandleCount || !isGapFreeBucket(bucket, bucketStart, ltfMs)) {
      continue;
    }
    const firstCandle = bucket[0];
    const lastCandle = bucket.at(-1);
    if (firstCandle === undefined || lastCandle === undefined) {
      throw new Error("A complete timeframe bucket must contain boundary candles.");
    }
    completedCandles.push({
      timestamp: bucketStart,
      open: firstCandle.open,
      high: Math.max(...bucket.map((candle) => candle.high)),
      low: Math.min(...bucket.map((candle) => candle.low)),
      close: lastCandle.close,
      volume: bucket.reduce((totalVolume, candle) => totalVolume + candle.volume, 0),
    });
  }
  return completedCandles;
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
