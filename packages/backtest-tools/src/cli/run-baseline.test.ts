// packages/backtest-tools/src/cli/run-baseline.test.ts — a Phase 1 OHLCV
// integrációs smoke tesztje.
//
// A Phase 1 (`packages/backtest-tools/src/cli/download-ohlcv.ts`) outputja
// a `data/ohlcv/` mappa. Phase 15-től 15 CSV van (BTC/ETH/SOL × 1h/4h/1d/5m/15m,
// 2024-01 → 2026-07-06). Ezek a tesztek biztosítják, hogy a feed integráció
// helyes, és az OHLCV adatok elérhetők a backtest motor számára minden
// támogatott timeframe-en.

import { describe, expect, it } from "bun:test";
import { resolve } from "node:path";

import { CsvExchangeFeed } from "../data/csv-feed.js";

const PROJECT_ROOT = resolve(import.meta.dir, "..", "..", "..", "..");
const OHLCV_DIR = resolve(PROJECT_ROOT, "data", "ohlcv");

describe("CsvExchangeFeed — Phase 1+15 OHLCV integráció", () => {
  const feed = new CsvExchangeFeed(OHLCV_DIR);

  it("BTC/USDT 1h candle-eket tölt be (sample)", async () => {
    const candles = await feed.fetchOHLCV("BTC/USDT", "1h", { since: 0, limit: 5 });
    expect(candles.length).toBeGreaterThan(0);
    expect(candles[0]?.timestamp).toBeGreaterThan(0);
    expect(typeof candles[0]?.close).toBe("number");
    expect(Number.isFinite(candles[0]?.close ?? NaN)).toBe(true);
  });

  it("Phase 1 timeframes (1h/4h/1d) minden symbol-on elérhetők", async () => {
    const symbols = ["BTC/USDT", "ETH/USDT", "SOL/USDT"] as const;
    const timeframes = ["1h", "4h", "1d"] as const;
    for (const symbol of symbols) {
      for (const tf of timeframes) {
        const candles = await feed.fetchOHLCV(symbol, tf, { since: 0, limit: 5 });
        expect(candles.length).toBeGreaterThan(0);
      }
    }
  });

  it("Phase 15 timeframes (5m/15m) minden symbol-on elérhetők", async () => {
    const symbols = ["BTC/USDT", "ETH/USDT", "SOL/USDT"] as const;
    const timeframes = ["5m", "15m"] as const;
    for (const symbol of symbols) {
      for (const tf of timeframes) {
        const candles = await feed.fetchOHLCV(symbol, tf, { since: 0, limit: 5 });
        expect(candles.length).toBeGreaterThan(0);
      }
    }
  });

  it("a MANIFEST.json minden fájlra hivatkozik (Phase 1: 9 + Phase 15: 6 = 15)", async () => {
    const fs = await import("node:fs/promises");
    const raw = await fs.readFile(resolve(OHLCV_DIR, "MANIFEST.json"), "utf8");
    const manifest = JSON.parse(raw) as {
      readonly files: readonly { readonly symbol: string; readonly timeframe: string }[];
    };
    // Phase 1: BTC/ETH/SOL × 1h/4h/1d = 9 fájl
    // Phase 15: BTC/ETH/SOL × 5m/15m = 6 új fájl
    // Összesen: 15
    expect(manifest.files.length).toBe(15);
    const phase15Tfs = manifest.files.filter((f) => f.timeframe === "5m" || f.timeframe === "15m");
    expect(phase15Tfs.length).toBe(6);
  });
});
