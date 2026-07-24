/**
 * apps/bot/src/state-feed/__tests__/ohlc-bootstrap.test.ts
 *
 * Phase 73 — tests for the historical OHLCV bootstrap helper.
 *
 * The `bootstrapOhlcStoreFromCsv` reads the `data/ohlcv/*.csv`
 * files and fills the `OhlcStore.historical` map. This module
 * tests:
 *   - `readOhlcvCsv` — CSV parsing (header validation, column
 *     count, defensive type coercion).
 *   - `listAvailableOhlcvFiles` — directory listing.
 *   - `bootstrapOhlcStoreFromCsv` — end-to-end: from disk to
 *     OhlcStore.historical; missing files, empty files, unknown
 *     symbols, defensive-copy semantics.
 *
 * Strategy: use `Bun.spawn` to create a temp dir, write CSV files
 * into it, then call the helper with the temp dir path. The test
 * cleans up the temp dir in `afterEach`.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { OhlcStore } from "../ohlc-store.js";
import {
  bootstrapOhlcStoreFromCsv,
  listAvailableOhlcvFiles,
  readOhlcvCsv,
} from "../ohlc-bootstrap.js";

// ============================================================================
// Test fixture helpers
// ============================================================================

/**
 * `setupTempDataDir` — létrehoz egy üres temp mappát, amibe a
 * teszt tetszőleges CSV fájlokat írhat. A `cleanupTempDataDir`
 * hívja a `rm`-et (a `Bun.spawn` lifecycle miatt a `bun:test`
 * `afterEach` blockjában).
 */
async function setupTempDataDir(): Promise<string> {
  const base = tmpdir();
  return await mkdtemp(join(base, "ohlc-bootstrap-test-"));
}

async function cleanupTempDataDir(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
}

/**
 * `writeOhlcvCsv` — kiír egy `binance_{sym}_{tf}.csv` fájlt a
 * megadott mappába. A tartalom a `bars` tömb alapján készül
 * (timestamp, open, high, low, close, volume — ms-ben).
 */
async function writeOhlcvCsv(
  dataDir: string,
  fileSym: string,
  tf: string,
  bars: readonly { time: number; open: number; high: number; low: number; close: number; volume: number }[],
): Promise<string> {
  const filename = `binance_${fileSym}_${tf}.csv`;
  const filepath = join(dataDir, filename);
  const lines = ["timestamp,open,high,low,close,volume"];
  for (const b of bars) {
    lines.push(`${b.time},${b.open},${b.high},${b.low},${b.close},${b.volume}`);
  }
  await writeFile(filepath, lines.join("\n") + "\n", "utf8");
  return filepath;
}

// ============================================================================
// readOhlcvCsv
// ============================================================================

describe("readOhlcvCsv", () => {
  let dataDir: string;
  beforeEach(async () => {
    dataDir = await setupTempDataDir();
  });
  afterEach(async () => {
    await cleanupTempDataDir(dataDir);
  });

  it("parses a valid CSV with the canonical header", async () => {
    const filepath = await writeOhlcvCsv(dataDir, "btc", "1h", [
      { time: 1_700_000_000_000, open: 60_000, high: 60_100, low: 59_900, close: 60_050, volume: 100 },
      { time: 1_700_003_600_000, open: 60_050, high: 60_200, low: 60_000, close: 60_150, volume: 200 },
    ]);
    const bars = await readOhlcvCsv(filepath);
    expect(bars.length).toBe(2);
    expect(bars[0]?.time).toBe(1_700_000_000_000);
    expect(bars[0]?.open).toBe(60_000);
    expect(bars[1]?.close).toBe(60_150);
  });

  it("throws when the header is not the canonical one", async () => {
    const filepath = join(dataDir, "binance_btc_1h.csv");
    await writeFile(filepath, "ts,o,h,l,c,v\n1,2,3,4,5,6\n", "utf8");
    await expect(readOhlcvCsv(filepath)).rejects.toThrow(/unexpected CSV header/);
  });

  it("skips malformed rows (wrong column count) and continues", async () => {
    const filepath = join(dataDir, "binance_btc_1h.csv");
    const content = [
      "timestamp,open,high,low,close,volume",
      "1,2,3,4,5", // too few columns
      "1,2,3,4,5,6,7", // too many columns
      "1700000000000,60000,60100,59900,60050,100", // valid
    ].join("\n") + "\n";
    await writeFile(filepath, content, "utf8");
    const bars = await readOhlcvCsv(filepath);
    expect(bars.length).toBe(1);
    expect(bars[0]?.close).toBe(60050);
  });

  it("skips rows with non-numeric / zero values", async () => {
    const filepath = join(dataDir, "binance_btc_1h.csv");
    const content = [
      "timestamp,open,high,low,close,volume",
      "0,60000,60100,59900,60050,100", // time=0 invalid
      "1700000000000,0,60100,59900,60050,100", // open=0 invalid
      "1700000000000,60000,60100,59900,60050,-1", // volume<0 invalid
      "1700000000000,60000,60100,59900,60050,100", // valid
    ].join("\n") + "\n";
    await writeFile(filepath, content, "utf8");
    const bars = await readOhlcvCsv(filepath);
    expect(bars.length).toBe(1);
  });

  it("returns an empty array when the CSV has only the header", async () => {
    const filepath = join(dataDir, "binance_btc_1h.csv");
    await writeFile(filepath, "timestamp,open,high,low,close,volume\n", "utf8");
    const bars = await readOhlcvCsv(filepath);
    expect(bars).toEqual([]);
  });
});

// ============================================================================
// listAvailableOhlcvFiles
// ============================================================================

describe("listAvailableOhlcvFiles", () => {
  let dataDir: string;
  beforeEach(async () => {
    dataDir = await setupTempDataDir();
  });
  afterEach(async () => {
    await cleanupTempDataDir(dataDir);
  });

  it("returns binance_*.csv files sorted alphabetically", async () => {
    await writeOhlcvCsv(dataDir, "btc", "1d", [
      { time: 1, open: 1, high: 1, low: 1, close: 1, volume: 1 },
    ]);
    await writeOhlcvCsv(dataDir, "eth", "1h", [
      { time: 1, open: 1, high: 1, low: 1, close: 1, volume: 1 },
    ]);
    await writeFile(join(dataDir, "MANIFEST.json"), "{}", "utf8");
    await writeFile(join(dataDir, "unrelated.txt"), "x", "utf8");

    const files = await listAvailableOhlcvFiles(dataDir);
    expect(files).toEqual(["binance_btc_1d.csv", "binance_eth_1h.csv"]);
  });

  it("returns an empty array when the data dir does not exist", async () => {
    const files = await listAvailableOhlcvFiles(join(dataDir, "does-not-exist"));
    expect(files).toEqual([]);
  });
});

// ============================================================================
// bootstrapOhlcStoreFromCsv
// ============================================================================

describe("bootstrapOhlcStoreFromCsv", () => {
  let dataDir: string;
  beforeEach(async () => {
    dataDir = await setupTempDataDir();
  });
  afterEach(async () => {
    await cleanupTempDataDir(dataDir);
  });

  it("loads CSV files for each (symbol, tf) pair into the OhlcStore", async () => {
    // 30 hónap BTC/USDT 1h adata — szimulálva
    const bars: { time: number; open: number; high: number; low: number; close: number; volume: number }[] = [];
    for (let i = 0; i < 22_100; i++) {
      const t = 1_704_067_200_000 + i * 3_600_000;
      bars.push({ time: t, open: 42_000 + i, high: 42_001 + i, low: 41_999 + i, close: 42_000 + i, volume: 100 });
    }
    await writeOhlcvCsv(dataDir, "btc", "1h", bars);
    await writeOhlcvCsv(dataDir, "btc", "4h", bars.slice(0, 5_525));
    await writeOhlcvCsv(dataDir, "btc", "1d", bars.slice(0, 921));
    await writeOhlcvCsv(dataDir, "eth", "1h", bars.slice(0, 1_000));
    await writeOhlcvCsv(dataDir, "sol", "4h", bars.slice(0, 100));

    const store = new OhlcStore();
    const result = await bootstrapOhlcStoreFromCsv(store, {
      dataDir,
      symbols: ["BTC/USDC", "ETH/USDC", "SOL/USDC"],
      timeframes: ["1h", "4h", "1d"],
    });

    expect(result.loaded).toBe(5);
    expect(result.skipped).toBe(4); // 3 symbols × 3 tfs − 5 written = 4 missing
    expect(result.totalBars).toBe(22_100 + 5_525 + 921 + 1_000 + 100);
    // A 4 missing file warning-ot ad.
    expect(result.warnings.length).toBe(4);

    // A BTC 1h history a store-ban van.
    expect(store.bufferSize("BTC/USDC", "1h")).toBe(22_100);
    const btc1h = store.getOHLC("BTC/USDC", "1h");
    expect(btc1h[0]?.time).toBe(1_704_067_200_000);
    expect(btc1h[22_099]?.time).toBe(1_704_067_200_000 + 22_099 * 3_600_000);
  });

  it("skips missing CSV files and records a warning", async () => {
    // Csak BTC 1h-t töltjük — a többi (symbol, tf) hiányzik.
    await writeOhlcvCsv(dataDir, "btc", "1h", [
      { time: 1_700_000_000_000, open: 60_000, high: 60_100, low: 59_900, close: 60_050, volume: 100 },
    ]);

    const store = new OhlcStore();
    const result = await bootstrapOhlcStoreFromCsv(store, {
      dataDir,
      symbols: ["BTC/USDC", "ETH/USDC", "SOL/USDC"],
      timeframes: ["1h", "4h", "1d"],
    });

    expect(result.loaded).toBe(1);
    expect(result.skipped).toBe(8); // 3 symbols × 3 tfs - 1 loaded = 8 skipped
    expect(result.warnings.length).toBe(8);
    expect(result.warnings[0]).toMatch(/missing binance_/);
  });

  it("returns warnings for unknown symbols (no CSV mapping)", async () => {
    const store = new OhlcStore();
    const result = await bootstrapOhlcStoreFromCsv(store, {
      dataDir,
      symbols: ["UNKNOWN/USDC"],
      timeframes: ["1h"],
    });
    expect(result.loaded).toBe(0);
    expect(result.warnings.length).toBe(1);
    expect(result.warnings[0]).toMatch(/unknown symbol UNKNOWN\/USDC/);
  });

  it("details include the (symbol, tf, bars, firstTs, lastTs) per loaded pair", async () => {
    await writeOhlcvCsv(dataDir, "btc", "1h", [
      { time: 1_700_000_000_000, open: 60_000, high: 60_100, low: 59_900, close: 60_050, volume: 100 },
      { time: 1_700_003_600_000, open: 60_050, high: 60_200, low: 60_000, close: 60_150, volume: 200 },
    ]);

    const store = new OhlcStore();
    const result = await bootstrapOhlcStoreFromCsv(store, {
      dataDir,
      symbols: ["BTC/USDC"],
      timeframes: ["1h"],
    });

    expect(result.details.length).toBe(1);
    expect(result.details[0]?.symbol).toBe("BTC/USDC");
    expect(result.details[0]?.timeframe).toBe("1h");
    expect(result.details[0]?.bars).toBe(2);
    expect(result.details[0]?.firstTs).toBe(1_700_000_000_000);
    expect(result.details[0]?.lastTs).toBe(1_700_003_600_000);
  });

  it("uses default timeframes [1h, 4h, 1d] when not specified", async () => {
    await writeOhlcvCsv(dataDir, "btc", "1h", [
      { time: 1, open: 1, high: 1, low: 1, close: 1, volume: 1 },
    ]);
    await writeOhlcvCsv(dataDir, "btc", "4h", [
      { time: 1, open: 1, high: 1, low: 1, close: 1, volume: 1 },
    ]);
    await writeOhlcvCsv(dataDir, "btc", "1d", [
      { time: 1, open: 1, high: 1, low: 1, close: 1, volume: 1 },
    ]);
    await writeOhlcvCsv(dataDir, "btc", "5m", [
      { time: 1, open: 1, high: 1, low: 1, close: 1, volume: 1 },
    ]);

    const store = new OhlcStore();
    const result = await bootstrapOhlcStoreFromCsv(store, {
      dataDir,
      symbols: ["BTC/USDC"],
      // timeframes undefined → default
    });

    expect(result.loaded).toBe(3); // 1h, 4h, 1d
    expect(result.skipped).toBe(0); // 5m-et nem kérdezzük, nem hiba
  });

  it("returns 0 loaded when the data dir has no binance_*.csv files", async () => {
    await mkdir(dataDir, { recursive: true });
    const store = new OhlcStore();
    const result = await bootstrapOhlcStoreFromCsv(store, {
      dataDir,
      symbols: ["BTC/USDC"],
    });
    expect(result.loaded).toBe(0);
    expect(result.skipped).toBe(3); // 1 symbol × 3 default tfs
  });
});
