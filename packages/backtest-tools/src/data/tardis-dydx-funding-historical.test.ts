import { afterEach, describe, expect, it } from "bun:test";
import { rm } from "node:fs/promises";
import { gzipSync } from "node:zlib";

import { ExactRational } from "@mm-crypto-bot/numeric";

import {
  aggregateToHourlyFunding,
  microsecondsToMs,
  parseDerivativeTickerCsv,
  TardisDydxFundingFetcher,
} from "./tardis-dydx-funding.js";
import { loadDydxHourly } from "../cli/dydx-vs-cex-carry-data.js";

const header =
  "exchange,symbol,timestamp,local_timestamp,funding_timestamp,funding_rate,predicted_funding_rate,open_interest,last_price,index_price,mark_price";
const date = new Date(Date.UTC(2025, 3, 1));
const temporaryCacheRoots = [
  "/tmp/tardis-historical-download",
  "/tmp/tardis-historical-cache",
  "/tmp/tardis-historical-many",
];

afterEach(async () => {
  await Promise.all(temporaryCacheRoots.map((directory) => rm(directory, { recursive: true, force: true })));
});

function csv(rows: readonly string[]): string {
  return [header, ...rows].join("\n");
}
function row(hour: number, rate = "0.1"): string {
  return `dydx-v4,BTC-USD,${String((date.getTime() + hour * 3_600_000) * 1000)},,,${rate},,,,,80000`;
}
function gzipResponse(body: string) {
  const bytes = gzipSync(body);
  return {
    ok: true,
    status: 200,
    arrayBuffer: () =>
      Promise.resolve(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)),
  };
}
async function isFailure(operation: () => Promise<unknown>): Promise<boolean> {
  try {
    await operation();
  } catch {
    return true;
  }
  return false;
}

describe("restored Tardis historical public scenarios", () => {
  it("konvertálja a Tardis-féle microsect epoch ms-re", () => {
    expect(microsecondsToMs(1_700_000_000_123_456)).toBe(1_700_000_000_123);
  });
  it("helyesen parsolja a header-t és a sorokat", () => {
    const parsed = parseDerivativeTickerCsv(csv([row(0)]));
    expect(parsed.rows).toHaveLength(1);
  });
  it("kihagyja az üres és rövid sorokat", () => {
    expect(parseDerivativeTickerCsv(`${header}\n\nshort\n`).rows).toEqual([]);
  });
  it("figyelmen kívül hagyja a többi market sorait", () => {
    const parsed = parseDerivativeTickerCsv(csv([row(0).replace("BTC-USD", "ETH-USD")]));
    expect(aggregateToHourlyFunding(parsed.rows, "BTC-USD")).toEqual([]);
  });
  it("24 órás napon 24 hourly snapshotot ad", () => {
    const rows = Array.from({ length: 24 }, (_, hour) => row(hour));
    const parsed = parseDerivativeTickerCsv(csv(rows));
    expect(aggregateToHourlyFunding(parsed.rows, "BTC-USD")).toHaveLength(24);
  });
  it("a helyes dataset URL-t építi", () => {
    expect(new TardisDydxFundingFetcher({ cacheDir: "/tmp/cache" }).buildUrl(date, "BTC-USD")).toContain(
      "/2025/04/01/BTC-USD.csv.gz",
    );
  });
  it("a baseUrl trailing slash-t normalizálja", () => {
    expect(
      new TardisDydxFundingFetcher({ cacheDir: "/tmp/cache", baseUrl: "https://data.test/" }).buildUrl(
        date,
        "BTC-USD",
      ),
    ).toContain("https://data.test/v1/");
  });
  it("a cache path a cacheDir alá esik", () => {
    expect(new TardisDydxFundingFetcher({ cacheDir: "/tmp/cache" }).cachePath(date, "BTC-USD")).toContain(
      "/tmp/cache/2025-04-01",
    );
  });
  it("validálja a fetchTimeoutMs értéket", () => {
    expect(() => new TardisDydxFundingFetcher({ cacheDir: "/tmp/cache", fetchTimeoutMs: 0 })).toThrow();
  });
  it("throws on non-2xx response", async () => {
    const fetcher = new TardisDydxFundingFetcher({
      cacheDir: "/tmp/cache",
      fetchPage: () =>
        Promise.resolve({ ok: false, status: 500, arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)) }),
    });
    expect(await isFailure(() => fetcher.fetchDay(date, "BTC-USD"))).toBe(true);
  });
  it("downloads from network and caches when not cached", async () => {
    const payload = gzipResponse(csv([row(0)]));
    const fetcher = new TardisDydxFundingFetcher({
      cacheDir: "/tmp/tardis-historical-download",
      fetchPage: () => Promise.resolve(payload),
    });
    const hourly = await fetcher.fetchDay(date, "BTC-USD");
    expect(hourly).toHaveLength(1);
  });
  it("returns cached CSV (gzip) if cache file exists", async () => {
    const payload = gzipResponse(csv([row(0)]));
    const fetcher = new TardisDydxFundingFetcher({
      cacheDir: "/tmp/tardis-historical-cache",
      fetchPage: () => Promise.resolve(payload),
    });
    await fetcher.fetchDay(date, "BTC-USD");
    const hourly = await fetcher.fetchDay(date, "BTC-USD");
    expect(hourly).toHaveLength(1);
  });
  it("returns empty array for empty dates list", async () => {
    const loaded = await loadDydxHourly("/tmp/tardis-historical-empty", "btc", [], true);
    expect(loaded.hourly).toEqual([]);
  });
  it("concatenates hourly snapshots across multiple days", async () => {
    const nextDay = new Date(date.getTime() + 86_400_000);
    let isNextDay = false;
    const loaded = await loadDydxHourly("/tmp/tardis-historical-many", "btc", [date, nextDay], false, () => {
      const payload = gzipResponse(csv([row(isNextDay ? 24 : 0)]));
      isNextDay = true;
      return Promise.resolve(payload);
    });
    expect(loaded.hourly).toHaveLength(2);
  });
  it("konvertálja a DydxHourlyFunding-ot FundingSnapshot-tá", () => {
    const result = new TardisDydxFundingFetcher({ cacheDir: "/tmp/cache" }).toFundingSnapshots([
      {
        fundingTime: 1,
        symbol: "BTC-USD",
        fundingRate: ExactRational.from("0.1"),
        markPrice: ExactRational.from("80000"),
      },
    ]);
    expect(result[0]?.symbol).toBe("BTC-USD");
  });
});
