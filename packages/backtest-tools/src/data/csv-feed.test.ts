// packages/backtest-tools/src/data/csv-feed.test.ts — CSV-feed unit tesztek.
//
// A `CsvExchangeFeed` a Phase 3 backtest CLI-k alapja: ez tölti be a
// `data/ohlcv/*.csv` fájlokat. Ezek a tesztek a feed parsolási és
// szűrési logikáját fedik le, hálózati hozzáférés nélkül (az OHLCV
// fájlokat a `data/ohlcv/` mappa biztosítja a teszt során).

import { describe, expect, it, beforeAll, afterAll } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

import { CsvExchangeFeed } from "./csv-feed.js";

describe("CsvExchangeFeed", () => {
  let tempDir: string;
  let feed: CsvExchangeFeed;

  beforeAll(async () => {
    tempDir = mkdtempSync(resolve(tmpdir(), "csv-feed-test-"));
    await mkdir(tempDir, { recursive: true });

    // Header + 5 candles BTC 1h szintetikus adatsor.
    const csv = [
      "timestamp,open,high,low,close,volume",
      "1704067200000,42283.58,42554.57,42261.02,42475.23,1271.68",
      "1704070800000,42475.23,42775.00,42431.65,42613.56,1196.37",
      "1704074400000,42613.56,42800.00,42500.00,42750.00,1100.00",
      "1704078000000,42750.00,43000.00,42700.00,42950.00,1350.00",
      "1704081600000,42950.00,43100.00,42850.00,43050.00,1230.00",
      "",
    ].join("\n");
    await writeFile(resolve(tempDir, "binance_btc_1h.csv"), csv, "utf8");
    feed = new CsvExchangeFeed(tempDir);
  });

  it("parsesolja a headert és kihagyja az üres sorokat", async () => {
    const candles = await feed.fetchOHLCV("BTC/USDT", "1h", {});
    expect(candles.length).toBe(5);
    expect(candles[0]?.timestamp).toBe(1704067200000);
    expect(candles[0]?.close).toBe(42475.23);
    expect(candles[4]?.timestamp).toBe(1704081600000);
    expect(candles[4]?.close).toBe(43050.0);
  });

  it("a since szűrőt tiszteletben tartja (időbélyeg >= sinceMs)", async () => {
    const candles = await feed.fetchOHLCV("BTC/USDT", "1h", {
      since: 1704074400000,
    });
    expect(candles.length).toBe(3);
    expect(candles[0]?.timestamp).toBe(1704074400000);
    expect(candles[1]?.timestamp).toBe(1704078000000);
    expect(candles[2]?.timestamp).toBe(1704081600000);
  });

  it("a limit paraméter csak az első N candle-t adja vissza", async () => {
    const candles = await feed.fetchOHLCV("BTC/USDT", "1h", {
      since: 0,
      limit: 2,
    });
    expect(candles.length).toBe(2);
  });

  it("a symbol-mapping (BTC/USDT → btc) működik", async () => {
    // Csak a BTC fájl létezik a tempDir-ban; az olvasás sikeres.
    const candles = await feed.fetchOHLCV("BTC/USDT", "1h", {});
    expect(candles.length).toBe(5);
  });

  it("hiányzó fájl esetén hibát dob (a backtest motor így jelzi a konfigurációs hibát)", async () => {
    await expect(feed.fetchOHLCV("ETH/USDT", "1h", {})).rejects.toThrow();
  });

  it("a volume mező numerikus", async () => {
    const candles = await feed.fetchOHLCV("BTC/USDT", "1h", {});
    for (const c of candles) {
      expect(typeof c.volume).toBe("number");
      expect(Number.isFinite(c.volume)).toBe(true);
    }
  });

  afterAll(() => {
    if (tempDir !== undefined) {
      try {
        rmSync(tempDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
  });
});
