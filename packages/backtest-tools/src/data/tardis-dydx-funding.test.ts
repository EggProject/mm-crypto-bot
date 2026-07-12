// packages/backtest-tools/src/data/tardis-dydx-funding.test.ts — Tardis.dev
// dYdX v4 fetcher unit tests.

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { gzipSync } from "node:zlib";

import {
  aggregateToHourlyFunding,
  CACHE_DIR_NAME,
  DEFAULT_TARDIS_BASE_URL,
  microsecondsToMs,
  parseDerivativeTickerCsv,
  TardisDydxFundingFetcher,
} from "./tardis-dydx-funding.js";

describe("microsecondsToMs", () => {
  it("konvertálja a Tardis-féle microsect epoch ms-re", () => {
    expect(microsecondsToMs(1_700_000_000_000_000)).toBe(1_700_000_000_000);
    expect(microsecondsToMs(1_700_000_000_123_456)).toBe(1_700_000_000_123);
  });
});

describe("parseDerivativeTickerCsv", () => {
  it("helyesen parsolja a header-t és a sorokat", () => {
    const csv = [
      "exchange,symbol,timestamp,local_timestamp,funding_timestamp,funding_rate,predicted_funding_rate,open_interest,last_price,index_price,mark_price",
      "dydx-v4,BTC-USD,1743465600448717,1743465600448717,,0.00004405208333333333,,760.6049,,,82546.76734",
      "dydx-v4,BTC-USD,1743465610072177,1743465610072177,,0.00004405208333333333,,760.6049,82570,,82495.67226",
      "",
    ].join("\n");
    const { header, rows } = parseDerivativeTickerCsv(csv);
    expect(header.length).toBe(11);
    expect(header[0]).toBe("exchange");
    expect(rows.length).toBe(2);
    expect(rows[0]?.symbol).toBe("BTC-USD");
    expect(rows[0]?.funding_rate).toBe("0.00004405208333333333");
    expect(rows[0]?.mark_price).toBe("82546.76734");
  });

  it("kihagyja az üres és rövid sorokat", () => {
    const csv = [
      "exchange,symbol,timestamp,local_timestamp,funding_timestamp,funding_rate,predicted_funding_rate,open_interest,last_price,index_price,mark_price",
      "dydx-v4,BTC-USD,1,2,3,4,5,6,7,8,9",
      "garbage,short",
      "",
    ].join("\n");
    const { rows } = parseDerivativeTickerCsv(csv);
    expect(rows.length).toBe(1);
  });
});

describe("aggregateToHourlyFunding", () => {
  it("24 órás napon 24 hourly snapshotot ad", () => {
    const rows = [];
    for (let h = 0; h < 24; h++) {
      const tsMs = Date.UTC(2025, 3, 1, h, 0, 0);
      const tsUs = tsMs * 1000;
      for (let s = 0; s < 60; s++) {
        rows.push({
          exchange: "dydx-v4",
          symbol: "BTC-USD",
          timestamp: String(tsUs + s * 1_000_000),
          local_timestamp: "",
          funding_timestamp: "",
          funding_rate: h < 12 ? "0.0001" : "-0.0001",
          predicted_funding_rate: "",
          open_interest: "1000",
          last_price: "80000",
          index_price: "",
          mark_price: h < 12 ? "80100" : "79900",
        });
      }
    }
    const hourly = aggregateToHourlyFunding(rows, "BTC-USD");
    expect(hourly.length).toBe(24);
    expect(hourly[0]?.fundingTime).toBe(Date.UTC(2025, 3, 1, 0, 0, 0));
    expect(hourly[0]?.fundingRate).toBeCloseTo(0.0001, 8);
    expect(hourly[12]?.fundingRate).toBeCloseTo(-0.0001, 8);
  });

  it("figyelmen kívül hagyja a többi market sorait", () => {
    const rows = [
      {
        exchange: "dydx-v4",
        symbol: "ETH-USD",
        timestamp: String(Date.UTC(2025, 3, 1, 0, 0, 0) * 1000),
        local_timestamp: "",
        funding_timestamp: "",
        funding_rate: "0.0001",
        predicted_funding_rate: "",
        open_interest: "",
        last_price: "",
        index_price: "",
        mark_price: "",
      },
      {
        exchange: "dydx-v4",
        symbol: "BTC-USD",
        timestamp: String(Date.UTC(2025, 3, 1, 1, 0, 0) * 1000),
        local_timestamp: "",
        funding_timestamp: "",
        funding_rate: "0.0002",
        predicted_funding_rate: "",
        open_interest: "",
        last_price: "",
        index_price: "",
        mark_price: "",
      },
    ];
    const hourly = aggregateToHourlyFunding(rows, "BTC-USD");
    expect(hourly.length).toBe(1);
    expect(hourly[0]?.fundingRate).toBeCloseTo(0.0002, 8);
  });
});

describe("TardisDydxFundingFetcher — URL + cache layout", () => {
  it("a helyes dataset URL-t építi", () => {
    const fetcher = new TardisDydxFundingFetcher();
    const url = fetcher.buildUrl(new Date(Date.UTC(2025, 3, 1)), "BTC-USD");
    expect(url).toBe(`${DEFAULT_TARDIS_BASE_URL}/v1/dydx-v4/derivative_ticker/2025/04/01/BTC-USD.csv.gz`);
  });

  it("a cache path a cacheDir alá esik", () => {
    const tmpDir = mkdtempSync(resolve(tmpdir(), "tardis-"));
    const fetcher = new TardisDydxFundingFetcher({ cacheDir: tmpDir });
    const cachePath = fetcher.cachePath(new Date(Date.UTC(2025, 3, 1)), "BTC-USD");
    expect(cachePath).toContain(CACHE_DIR_NAME === CACHE_DIR_NAME ? tmpDir : "");
    expect(cachePath).toContain("2025-04-01");
    expect(cachePath).toContain("BTC-USD.csv.gz");
  });

  it("validálja a fetchTimeoutMs értéket", () => {
    expect(() => new TardisDydxFundingFetcher({ fetchTimeoutMs: 0 })).toThrow();
    expect(() => new TardisDydxFundingFetcher({ fetchTimeoutMs: -1 })).toThrow();
  });

  it("a baseUrl trailing slash-t normalizálja", () => {
    const fetcher = new TardisDydxFundingFetcher({ baseUrl: "https://example.com/" });
    expect(fetcher.baseUrl).toBe("https://example.com");
  });
});

describe("TardisDydxFundingFetcher — toFundingSnapshots", () => {
  it("konvertálja a DydxHourlyFunding-ot FundingSnapshot-tá", () => {
    const fetcher = new TardisDydxFundingFetcher();
    const hourly = [
      {
        fundingTime: 1_700_000_000_000,
        symbol: "BTC-USD",
        fundingRate: 0.000044,
        markPrice: 82500,
      },
      {
        fundingTime: 1_700_003_600_000,
        symbol: "BTC-USD",
        fundingRate: -0.000031,
        markPrice: null,
      },
    ];
    const snaps = fetcher.toFundingSnapshots(hourly);
    expect(snaps.length).toBe(2);
    expect(snaps[0]?.markPrice).toBe(82500);
    expect(snaps[1]?.markPrice).toBeUndefined();
  });
});

describe("TardisDydxFundingFetcher — fetchDay (cache + network)", () => {
  let tempDir: string;
  const realFetch = globalThis.fetch;

  beforeAll(() => {
    tempDir = mkdtempSync(resolve(tmpdir(), "tardis-fetch-"));
  });
  afterAll(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
    globalThis.fetch = realFetch;
  });

  it("returns cached CSV (gzip) if cache file exists", async () => {
    // Pre-populate the cache.
    const date = new Date(Date.UTC(2025, 3, 1));
    const fetcher = new TardisDydxFundingFetcher({ cacheDir: tempDir });
    const cacheFile = fetcher.cachePath(date, "BTC-USD");
    mkdirSync(resolve(cacheFile, ".."), { recursive: true });
    const csv = [
      "exchange,symbol,timestamp,local_timestamp,funding_timestamp,funding_rate,predicted_funding_rate,open_interest,last_price,index_price,mark_price",
      "dydx-v4,BTC-USD,1743465600448717,1743465600448717,,0.0001,,760.6,,,82500.0",
    ].join("\n");
    writeFileSync(cacheFile, gzipSync(csv));

    const result = await fetcher.fetchDay(date, "BTC-USD");
    expect(result.length).toBe(1);
    expect(result[0]?.symbol).toBe("BTC-USD");
    expect(result[0]?.fundingRate).toBeCloseTo(0.0001, 8);
    expect(result[0]?.markPrice).toBe(82500);
  });

  it("downloads from network and caches when not cached", async () => {
    const date = new Date(Date.UTC(2025, 3, 2));
    const fetcher = new TardisDydxFundingFetcher({ cacheDir: tempDir });
    const csv = [
      "exchange,symbol,timestamp,local_timestamp,funding_timestamp,funding_rate,predicted_funding_rate,open_interest,last_price,index_price,mark_price",
      "dydx-v4,BTC-USD,1743552000000000,1743552000000000,,0.0002,,800,,,82100.0",
    ].join("\n");
    globalThis.fetch = (async () =>
      new Response(gzipSync(csv), {
        status: 200,
        headers: { "Content-Type": "application/gzip" },
      })) as unknown as typeof fetch;

    const result = await fetcher.fetchDay(date, "BTC-USD");
    expect(result.length).toBe(1);
    // Cache file should now exist.
    const cacheFile = fetcher.cachePath(date, "BTC-USD");
    expect(existsSync(cacheFile)).toBe(true);
  });

  it("throws on non-2xx response", async () => {
    const date = new Date(Date.UTC(2025, 3, 3));
    const fetcher = new TardisDydxFundingFetcher({ cacheDir: tempDir });
    globalThis.fetch = (async () =>
      new Response("not found", { status: 404 })) as unknown as typeof fetch;
    await expect(fetcher.fetchDay(date, "BTC-USD")).rejects.toThrow(/Tardis dataset 404/);
  });
});

describe("TardisDydxFundingFetcher — fetchWindow", () => {
  it("concatenates hourly snapshots across multiple days", async () => {
    const csvDay1 = [
      "exchange,symbol,timestamp,local_timestamp,funding_timestamp,funding_rate,predicted_funding_rate,open_interest,last_price,index_price,mark_price",
      "dydx-v4,BTC-USD,1743465600000000,1743465600000000,,0.0001,,760,,,82500",
    ].join("\n");
    const csvDay2 = [
      "exchange,symbol,timestamp,local_timestamp,funding_timestamp,funding_rate,predicted_funding_rate,open_interest,last_price,index_price,mark_price",
      "dydx-v4,BTC-USD,1743552000000000,1743552000000000,,0.0002,,800,,,82600",
    ].join("\n");
    const realFetch = globalThis.fetch;
    let call = 0;
    globalThis.fetch = (async () => {
      const body = call === 0 ? gzipSync(csvDay1) : gzipSync(csvDay2);
      call += 1;
      return new Response(body, { status: 200 });
    }) as unknown as typeof fetch;
    try {
      const fetcher = new TardisDydxFundingFetcher({ cacheDir: mkdtempSync(resolve(tmpdir(), "tardis-fw-")) });
      const dates = [
        new Date(Date.UTC(2025, 3, 1)),
        new Date(Date.UTC(2025, 3, 2)),
      ];
      const result = await fetcher.fetchWindow(dates, "BTC-USD");
      expect(result.length).toBe(2);
      expect(call).toBe(2);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it("returns empty array for empty dates list", async () => {
    const fetcher = new TardisDydxFundingFetcher({ cacheDir: mkdtempSync(resolve(tmpdir(), "tardis-fw-empty-")) });
    const result = await fetcher.fetchWindow([], "BTC-USD");
    expect(result.length).toBe(0);
  });
});