// scripts/csv-feed.ts — CSV-alapú ExchangeFeed implementáció a backtest-hez.
//
// A `data/ohlcv/*.csv` fájlokat olvassa, és a `packages/backtest/src/types.ts`
// `ExchangeFeed` interfészét valósítja meg. A feed:
//
//   - A `since` paramétert tiszteletben tartja (időbélyeg-szűrés)
//   - A `limit` paramétert tiszteletben tartja (sor-limitáció)
//   - Symbol-mapping: "BTC/USDT" → binance_btc_<timeframe>.csv
//
// A feed a `packages/backtest` csomagtól FÜGGETLEN (csak a shared
// `Candle` típust használja), hogy a letöltési logika tiszta maradjon.

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { Candle, Timeframe } from "@mm-crypto-bot/shared/types";

export interface ExchangeFeedLike {
  fetchOHLCV(
    symbol: string,
    timeframe: Timeframe,
    options: { readonly since?: number; readonly limit?: number },
  ): Promise<readonly Candle[]>;
}

const TIMEFRAME_TO_FILE_SUFFIX: Readonly<Record<Timeframe, string>> = {
  "1m": "1m",
  "5m": "5m",
  "15m": "15m",
  "1h": "1h",
  "4h": "4h",
  "1d": "1d",
};

function symbolToFileSymbol(ccxtSymbol: string): string {
  // "BTC/USDT" → "btc"; "ETH/USDC" → "eth"; "SOL/USDT" → "sol".
  // A CSV-fájlok neve kicsi, tehát lowercase + base-only.
  const base = ccxtSymbol.split("/")[0];
  if (base === undefined) {
    throw new Error(`Invalid symbol: ${ccxtSymbol}`);
  }
  return base.toLowerCase();
}

/**
 * `CsvExchangeFeed` — a CSV-alapú feed implementáció. A `dataDir`
 * a `data/ohlcv/` mappára kell mutasson.
 */
export class CsvExchangeFeed implements ExchangeFeedLike {
  private readonly dataDir: string;
  private readonly cache = new Map<string, readonly Candle[]>();

  constructor(dataDir: string) {
    this.dataDir = dataDir;
  }

  private async loadAll(symbol: string, timeframe: Timeframe): Promise<readonly Candle[]> {
    const key = `${symbol}:${timeframe}`;
    const cached = this.cache.get(key);
    if (cached !== undefined) return cached;
    const fileSymbol = symbolToFileSymbol(symbol);
    const suffix = TIMEFRAME_TO_FILE_SUFFIX[timeframe];
    const filename = resolve(this.dataDir, `binance_${fileSymbol}_${suffix}.csv`);
    const raw = await readFile(filename, "utf8");
    const lines = raw.split("\n");
    // Header skip: timestamp,open,high,low,close,volume
    const candles: Candle[] = [];
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      if (line === undefined || line === "") continue;
      const parts = line.split(",");
      if (parts.length !== 6) continue;
      const ts = Number(parts[0]);
      const o = Number(parts[1]);
      const h = Number(parts[2]);
      const l = Number(parts[3]);
      const c = Number(parts[4]);
      const v = Number(parts[5]);
      if (Number.isNaN(ts) || Number.isNaN(o) || Number.isNaN(h) || Number.isNaN(l) || Number.isNaN(c) || Number.isNaN(v)) {
        continue;
      }
      candles.push({ timestamp: ts, open: o, high: h, low: l, close: c, volume: v });
    }
    this.cache.set(key, candles);
    return candles;
  }

  async fetchOHLCV(
    symbol: string,
    timeframe: Timeframe,
    options: { readonly since?: number; readonly limit?: number } = {},
  ): Promise<readonly Candle[]> {
    const all = await this.loadAll(symbol, timeframe);
    const sinceMs = options.since ?? 0;
    let filtered: readonly Candle[] = all;
    if (sinceMs > 0) {
      filtered = all.filter((c) => c.timestamp >= sinceMs);
    }
    if (options.limit !== undefined && options.limit > 0) {
      filtered = filtered.slice(0, options.limit);
    }
    return filtered;
  }
}