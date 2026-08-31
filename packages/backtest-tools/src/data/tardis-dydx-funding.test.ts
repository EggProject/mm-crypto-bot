import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";

import { ExactRational } from "@mm-crypto-bot/numeric";

import {
  aggregateToHourlyFunding,
  microsecondsToMs,
  parseDerivativeTickerCsv,
  TardisDydxFundingFetcher,
} from "./tardis-dydx-funding.js";
import {
  nodeTardisCacheFileSystem,
  readVerifiedTardisCache,
  tardisCacheManifestPath,
  writeVerifiedTardisCache,
  type TardisCacheFileSystem,
} from "./tardis-dydx-funding-cache.js";

const exact = (value: string): ExactRational => ExactRational.from(value);
const header =
  "exchange,symbol,timestamp,local_timestamp,funding_timestamp,funding_rate,predicted_funding_rate,open_interest,last_price,index_price,mark_price";
const temporaryDirectories: string[] = [];

afterEach(async () => {
  const directories = [...temporaryDirectories];
  temporaryDirectories.length = 0;
  await Promise.all(directories.map((directory) => rm(directory, { recursive: true, force: true })));
});

function gzipResponse(csv: string) {
  const bytes = gzipSync(csv);
  return {
    ok: true,
    status: 200,
    arrayBuffer: () =>
      Promise.resolve(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)),
  };
}

async function temporaryCache(): Promise<string> {
  const directory = await mkdtemp(path.resolve(tmpdir(), "tardis-dydx-"));
  temporaryDirectories.push(directory);
  return directory;
}

async function failureMessage(operation: () => Promise<unknown>): Promise<string> {
  try {
    await operation();
  } catch (error: unknown) {
    return error instanceof Error ? error.message : "unknown";
  }
  return "no failure";
}

class MemoryTardisCacheFileSystem implements TardisCacheFileSystem {
  readonly files = new Map<string, Uint8Array>();
  readonly writes: string[] = [];

  read(filePath: string): Promise<Uint8Array | undefined> {
    const contents = this.files.get(filePath);
    return Promise.resolve(contents === undefined ? undefined : new Uint8Array(contents));
  }

  writeAtomically(filePath: string, contents: Uint8Array): Promise<void> {
    this.writes.push(filePath);
    this.files.set(filePath, new Uint8Array(contents));
    return Promise.resolve();
  }
}

describe("Tardis dYdX exact funding parser", () => {
  it("rejects an unexpected header and malformed selected rows while ignoring an unrelated short row", async () => {
    const cacheDirectory = await temporaryCache();
    const date = new Date(Date.UTC(2025, 3, 1));
    let cacheIndex = 0;
    const fetchDay = (csv: string) =>
      new TardisDydxFundingFetcher({
        cacheDir: path.resolve(cacheDirectory, String(cacheIndex++)),
        fetchPage: () => Promise.resolve(gzipResponse(csv)),
      }).fetchDay(date, "BTC-USD");
    expect(await failureMessage(() => fetchDay("wrong,header\n"))).toContain("unexpected header");
    const unrelated = await fetchDay(
      `${header}\ndydx-v4,ETH-USD\ndydx-v4,BTC-USD,1743465600000000,,,0.1,,,,,80000\n`,
    );
    expect(unrelated).toHaveLength(1);
    expect(await failureMessage(() => fetchDay(`${header}\ndydx-v4,BTC-USD\n`))).toContain(
      "incomplete selected-market row",
    );
    expect(
      await failureMessage(() => fetchDay(`${header}\ndydx-v4,BTC-USD,1743465600000000,,,0.10,,,,,80000\n`)),
    ).toContain("invalid funding_rate");
  });

  it("rejects a selected-market timestamp outside the requested UTC day", async () => {
    const cacheDirectory = await temporaryCache();
    const date = new Date(Date.UTC(2025, 3, 1));
    const nextDayTimestampUs = String((date.getTime() + 86_400_000) * 1000);
    const fetcher = new TardisDydxFundingFetcher({
      cacheDir: cacheDirectory,
      fetchPage: () =>
        Promise.resolve(gzipResponse(`${header}\ndydx-v4,BTC-USD,${nextDayTimestampUs},,,0.1,,,,,80000\n`)),
    });
    expect(await failureMessage(() => fetcher.fetchDay(date, "BTC-USD"))).toContain(
      "outside requested UTC day",
    );
  });
  it("preserves canonical high precision raw funding and mark prices", () => {
    const timestamp = Date.UTC(2025, 3, 1) * 1000;
    const csv = `${header}\ndydx-v4,BTC-USD,${String(timestamp)},,,0.0000000000000000001,,,,,80000\n`;
    const hourly = aggregateToHourlyFunding(parseDerivativeTickerCsv(csv).rows, "BTC-USD");
    expect(hourly).toHaveLength(1);
    expect(hourly[0]?.fundingRate.equals(exact("0.0000000000000000001"))).toBe(true);
    expect(hourly[0]?.markPrice?.equals(exact("80000"))).toBe(true);
  });

  it("rejects malformed selected-market funding rows instead of dropping them", () => {
    const csv = `${header}\ndydx-v4,BTC-USD,1743465600000000,,,NaN,,,,,80000\n`;
    expect(() => aggregateToHourlyFunding(parseDerivativeTickerCsv(csv).rows, "BTC-USD")).toThrow(
      "invalid funding_rate",
    );
  });

  it("does not cross-contaminate another market or a later hour", () => {
    const first = Date.UTC(2025, 3, 1) * 1000;
    const csv = [
      header,
      `dydx-v4,ETH-USD,${String(first)},,,0.1,,,,,1`,
      `dydx-v4,BTC-USD,${String(first)},,,0.1,,,,,1`,
      `dydx-v4,BTC-USD,${String(first + 3_600_000_000)},,,0.2,,,,,2`,
    ].join("\n");
    const hourly = aggregateToHourlyFunding(parseDerivativeTickerCsv(csv).rows, "BTC-USD");
    expect(
      hourly.map((row) => row.fundingRate.equals(exact("0.1")) || row.fundingRate.equals(exact("0.2"))),
    ).toEqual([true, true]);
  });

  it("handles quoted fields and keeps the first valid selected-market row per hour", () => {
    const first = Date.UTC(2025, 3, 1) * 1000;
    const csv = [
      header,
      "dydx-v4,BTC-USD," + String(first) + ",,,0.1,,,,,",
      `dydx-v4,BTC-USD,${String(first + 1)},,,0.2,,,,,2`,
      "too-short",
      "",
    ].join("\n");
    const parsed = parseDerivativeTickerCsv(csv);
    expect(parsed.header).toHaveLength(11);
    expect(parsed.rows).toHaveLength(2);
    const hourly = aggregateToHourlyFunding(parsed.rows, "BTC-USD");
    expect(hourly).toHaveLength(1);
    expect(hourly[0]?.fundingRate.equals(exact("0.1"))).toBe(true);
    expect(hourly[0]?.markPrice).toBeUndefined();
  });

  it("rejects selected-market rows with quoted-field edge cases or invalid timestamps", () => {
    const first = Date.UTC(2025, 3, 1) * 1000;
    const quoted = `${header}\ndydx-v4,"BTC-USD",${String(first)},,,0.1,,,,,80000\n`;
    expect(parseDerivativeTickerCsv(quoted).rows[0]?.symbol).toBe("BTC-USD");
    const badTimestamp = `${header}\ndydx-v4,BTC-USD,not-a-time,,,0.1,,,,,80000\n`;
    expect(() => aggregateToHourlyFunding(parseDerivativeTickerCsv(badTimestamp).rows, "BTC-USD")).toThrow(
      "invalid timestamp",
    );
    const unsafeTimestamp = `${header}\ndydx-v4,BTC-USD,9007199254740992000,,,0.1,,,,,80000\n`;
    expect(() => aggregateToHourlyFunding(parseDerivativeTickerCsv(unsafeTimestamp).rows, "BTC-USD")).toThrow(
      "invalid timestamp",
    );
    const noncanonicalRate = `${header}\ndydx-v4,BTC-USD,${String(first)},,,0.10,,,,,80000\n`;
    expect(() =>
      aggregateToHourlyFunding(parseDerivativeTickerCsv(noncanonicalRate).rows, "BTC-USD"),
    ).toThrow("invalid funding_rate");
  });

  it("rejects a malformed header deterministically without numeric fabrication", () => {
    expect(() => parseDerivativeTickerCsv("\nx")).toThrow("unexpected header");
  });

  it("rejects selected fields that overflow or cannot form canonical external values", () => {
    const requestedDay = new Date(Date.UTC(2025, 3, 1));
    const invalidValues = [
      `dydx-v4,BTC-USD,not-a-time,,,0.1,,,,,80000`,
      `dydx-v4,BTC-USD,9007199254740992000,,,0.1,,,,,80000`,
      `dydx-v4,BTC-USD,1743465600000000,,,NaN,,,,,80000`,
    ];
    for (const value of invalidValues) {
      expect(() => parseDerivativeTickerCsv(`${header}\n${value}`, "BTC-USD", requestedDay)).toThrow();
    }
    expect(() =>
      parseDerivativeTickerCsv(
        `${header}\ndydx-v4,BTC-USD,1743465600000000,,,0.1,,,,,80000`,
        "BTC-USD",
        new Date(NaN),
      ),
    ).toThrow("invalid timestamp");
  });

  it("validates every selected-market CSV boundary before interpreting selected fields", () => {
    const requestedDay = new Date(Date.UTC(2025, 3, 1));
    const valid = "dydx-v4,BTC-USD,1,,,0.1,,,,,80000";
    expect(parseDerivativeTickerCsv(`${header}\n${valid}`, "BTC-USD").rows).toHaveLength(1);
    expect(() => parseDerivativeTickerCsv('"')).toThrow("invalid header");
    expect(() => parseDerivativeTickerCsv(`${header}\ndydx-v4,"BTC-USD`)).toThrow("cannot identify");
    expect(() => parseDerivativeTickerCsv(`${header}\ndydx-v4`, "BTC-USD", requestedDay)).toThrow(
      "cannot identify",
    );
    expect(() =>
      parseDerivativeTickerCsv(
        `${header}\ndydx-v4,BTC-USD,1743379200000000,,,0.1,,,,,80000`,
        "BTC-USD",
        requestedDay,
      ),
    ).toThrow("outside requested UTC day");
    expect(parseDerivativeTickerCsv(`${header}\ndydx-v4,ETH-USD`).rows).toEqual([]);
  });

  it("orders out-of-order hourly buckets before emitting canonical snapshots", () => {
    const first = Date.UTC(2025, 3, 1) * 1000;
    const csv = [
      header,
      `dydx-v4,BTC-USD,${String(first + 3_600_000_000)},,,0.2,,,,,2`,
      `dydx-v4,BTC-USD,${String(first)},,,0.1,,,,,1`,
    ].join("\n");
    const hourly = aggregateToHourlyFunding(parseDerivativeTickerCsv(csv).rows, "BTC-USD");
    expect(hourly.map((row) => row.fundingTime)).toEqual([first / 1000, first / 1000 + 3_600_000]);
  });
});

describe("Tardis fetcher deterministic helpers", () => {
  it("rejects every cache receipt provenance mismatch and returns frozen verified receipts", async () => {
    const cacheFileSystem = new MemoryTardisCacheFileSystem();
    const cachePath = "/cache/BTC-USD.csv.gz";
    const identity = { date: "2025-04-01", market: "BTC-USD", url: "https://example.test/data" };
    const receipt = await writeVerifiedTardisCache(
      cacheFileSystem,
      cachePath,
      new Uint8Array([1]),
      identity,
      "2025-04-01T00:00:00.000Z",
    );
    expect(receipt.schema).toBe("tardis-dydx-cache@2");
    expect(Object.isFrozen(receipt)).toBe(true);
    expect(await readVerifiedTardisCache(cacheFileSystem, cachePath, identity)).toEqual(new Uint8Array([1]));
    const mismatches: readonly Readonly<Record<string, unknown>>[] = [
      { ...receipt, provider: "wrong" },
      { ...receipt, schema: "tardis-dydx-cache@1" },
      { ...receipt, url: "https://wrong.test/data" },
      { ...receipt, date: "2025-04-02" },
      { ...receipt, market: "ETH-USD" },
      { ...receipt, sha256: "0".repeat(64) },
      { ...receipt, byteLength: 2 },
      { ...receipt, cacheWriteUtc: "2025-04-01T00:00:00Z" },
    ];
    for (const manifest of mismatches) {
      cacheFileSystem.files.set(
        tardisCacheManifestPath(cachePath),
        new TextEncoder().encode(JSON.stringify(manifest)),
      );
      expect(
        await failureMessage(() => readVerifiedTardisCache(cacheFileSystem, cachePath, identity)),
      ).toContain("does not verify cache content");
    }
  });
  it("rejects malformed manifests and propagates non-not-found cache I/O failures", async () => {
    const cacheFileSystem = new MemoryTardisCacheFileSystem();
    const cachePath = "/cache/BTC-USD.csv.gz";
    const identity = { date: "2025-04-01", market: "BTC-USD", url: "https://example.test/data" };
    cacheFileSystem.files.set(cachePath, new Uint8Array([1]));
    cacheFileSystem.files.set(tardisCacheManifestPath(cachePath), new TextEncoder().encode("not-json"));
    expect(
      await failureMessage(() => readVerifiedTardisCache(cacheFileSystem, cachePath, identity)),
    ).toContain("manifest is invalid");
    cacheFileSystem.files.set(
      tardisCacheManifestPath(cachePath),
      new TextEncoder().encode('{"schema":"tardis-dydx-cache@1","extra":true}'),
    );
    expect(
      await failureMessage(() => readVerifiedTardisCache(cacheFileSystem, cachePath, identity)),
    ).toContain("manifest is invalid");
    cacheFileSystem.files.set(tardisCacheManifestPath(cachePath), new TextEncoder().encode("null"));
    expect(
      await failureMessage(() => readVerifiedTardisCache(cacheFileSystem, cachePath, identity)),
    ).toContain("manifest is invalid");
    cacheFileSystem.files.delete(tardisCacheManifestPath(cachePath));
    expect(
      await failureMessage(() => readVerifiedTardisCache(cacheFileSystem, cachePath, identity)),
    ).toContain("missing its manifest");
    const directory = await temporaryCache();
    expect(await failureMessage(() => nodeTardisCacheFileSystem.read(directory))).not.toBe("no failure");
  });
  it("converts microseconds and builds a date-partitioned URL", () => {
    expect(microsecondsToMs(1_700_000_000_123_456)).toBe(1_700_000_000_123);
    const fetcher = new TardisDydxFundingFetcher({ cacheDir: "/tmp/dydx-tardis" });
    const firstOfApril = new Date(Date.UTC(2025, 3, 1));
    expect(fetcher.buildUrl(firstOfApril, "BTC-USD")).toContain("/2025/04/01/BTC-USD.csv.gz");
    expect(fetcher.cachePath(firstOfApril, "BTC-USD")).toContain("2025-04-01");
    expect(() => fetcher.cachePath(firstOfApril, "../../../../outside")).toThrow(
      "escaped its configured root",
    );
  });

  it("rejects a nonpositive fetch timeout before any transport operation", () => {
    expect(() => new TardisDydxFundingFetcher({ fetchTimeoutMs: 0 })).toThrow("positive finite");
    expect(() => new TardisDydxFundingFetcher({ fetchTimeoutMs: Infinity })).toThrow("positive finite");
  });

  it("loads a cached gzip without invoking its injected transport", async () => {
    const cacheDirectory = await temporaryCache();
    const firstOfApril = new Date(Date.UTC(2025, 3, 1));
    const fetcher = new TardisDydxFundingFetcher({
      cacheDir: cacheDirectory,
      fetchPage: () => Promise.reject(new Error("network must not be read on a cache hit")),
    });
    const csv = `${header}\ndydx-v4,BTC-USD,1743465600000000,,,0.0001,,,,,80000\n`;
    const cachePath = fetcher.cachePath(firstOfApril, "BTC-USD");
    await writeVerifiedTardisCache(
      nodeTardisCacheFileSystem,
      cachePath,
      gzipSync(csv),
      {
        date: "2025-04-01",
        market: "BTC-USD",
        url: fetcher.buildUrl(firstOfApril, "BTC-USD"),
      },
      "2025-04-01T00:00:00.000Z",
    );
    const loaded = await fetcher.fetchDay(firstOfApril, "BTC-USD");
    expect(loaded).toHaveLength(1);
    expect(loaded[0]?.fundingRate.equals(exact("0.0001"))).toBe(true);
    expect(fetcher.toFundingSnapshots(loaded)[0]?.markPrice?.equals(exact("80000"))).toBe(true);
    expect(await fetcher.fetchDayCsv(firstOfApril, "BTC-USD")).toContain(header);
  });

  it("freezes validated transport inputs, caches a successful response, and converts snapshots", async () => {
    const cacheDirectory = await temporaryCache();
    const date = new Date(Date.UTC(2025, 3, 1));
    let requestedUrl = "";
    const fetcher = new TardisDydxFundingFetcher({
      baseUrl: "https://example.test/",
      cacheDir: cacheDirectory,
      fetchTimeoutMs: 123,
      fetchPage: (request) => {
        expect(Object.isFrozen(request)).toBe(true);
        expect(request.timeoutMs).toBe(123);
        requestedUrl = request.url;
        return Promise.resolve(
          gzipResponse(`${header}\ndydx-v4,BTC-USD,1743465600000000,,,0.0000000000000000001,,,,,\n`),
        );
      },
    });
    const hourly = await fetcher.fetchDay(date, "BTC-USD");
    expect(requestedUrl).toBe("https://example.test/v1/dydx-v4/derivative_ticker/2025/04/01/BTC-USD.csv.gz");
    expect(hourly[0]?.markPrice).toBeUndefined();
    const snapshots = fetcher.toFundingSnapshots(hourly);
    expect(snapshots[0]?.fundingRate.equals(exact("0.0000000000000000001"))).toBe(true);
    expect(snapshots[0]?.markPrice).toBeUndefined();
    expect(await Bun.file(fetcher.cachePath(date, "BTC-USD")).exists()).toBe(true);
  });

  it("uses the typed atomic cache port and rejects content that no longer matches its manifest", async () => {
    const cacheFileSystem = new MemoryTardisCacheFileSystem();
    const date = new Date(Date.UTC(2025, 3, 1));
    const fetcher = new TardisDydxFundingFetcher({
      cacheDir: "/cache-root",
      cacheFileSystem,
      fetchPage: () =>
        Promise.resolve(gzipResponse(`${header}\ndydx-v4,BTC-USD,1743465600000000,,,0.0001,,,,,80000\n`)),
    });
    const cachePath = fetcher.cachePath(date, "BTC-USD");
    await fetcher.fetchDay(date, "BTC-USD");
    expect(cacheFileSystem.writes).toEqual([cachePath, fetcher.cacheManifestPath(date, "BTC-USD")]);
    cacheFileSystem.files.set(cachePath, new Uint8Array([1, 2, 3]));
    let errorMessage = "";
    try {
      await fetcher.fetchDay(date, "BTC-USD");
    } catch (error: unknown) {
      errorMessage = error instanceof Error ? error.message : "unknown";
    }
    expect(errorMessage).toContain("does not verify cache content");
  });

  it("fails closed in the default transport before a network request for an invalid configured URL", async () => {
    const cacheDirectory = await temporaryCache();
    const fetcher = new TardisDydxFundingFetcher({ baseUrl: ":", cacheDir: cacheDirectory });
    let isRejected = false;
    try {
      await fetcher.fetchDay(new Date(Date.UTC(2025, 3, 1)), "BTC-USD");
    } catch {
      isRejected = true;
    }
    expect(isRejected).toBe(true);
  });

  it("fails closed for rejected, non-OK, malformed, and non-gzip transport output", async () => {
    const date = new Date(Date.UTC(2025, 3, 1));
    const cases: readonly [string, () => Promise<unknown>][] = [
      ["rejected", () => Promise.reject(new Error("offline"))],
      [
        "status",
        () =>
          Promise.resolve({ ok: false, status: 503, arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)) }),
      ],
      ["non-object", () => Promise.resolve("not-a-response")],
      [
        "malformed",
        () => Promise.resolve({ ok: true, status: 200, arrayBuffer: () => Promise.resolve("not-buffer") }),
      ],
      [
        "gzip",
        () =>
          Promise.resolve({
            ok: true,
            status: 200,
            arrayBuffer: () => Promise.resolve(new TextEncoder().encode("raw").buffer),
          }),
      ],
    ];
    for (const [name, fetchPage] of cases) {
      const cacheDirectory = await temporaryCache();
      const fetcher = new TardisDydxFundingFetcher({
        cacheDir: cacheDirectory,
        fetchPage: () => fetchPage(),
      });
      let isRejected = false;
      try {
        await fetcher.fetchDayCsv(date, "BTC-USD");
      } catch {
        isRejected = true;
      }
      expect(isRejected, name).toBe(true);
    }
  });

  it("concatenates independently fetched days in its public window operation", async () => {
    const cacheDirectory = await temporaryCache();
    let rate = "0.1";
    const fetcher = new TardisDydxFundingFetcher({
      cacheDir: cacheDirectory,
      fetchPage: () => {
        const timestamp = rate === "0.1" ? "1743465600000000" : "1746057600000000";
        const response = gzipResponse(`${header}\ndydx-v4,BTC-USD,${timestamp},,,${rate},,,,,80000\n`);
        rate = "0.2";
        return Promise.resolve(response);
      },
    });
    const hourly = await fetcher.fetchWindow(
      [new Date(Date.UTC(2025, 3, 1)), new Date(Date.UTC(2025, 4, 1))],
      "BTC-USD",
    );
    expect(
      hourly.map((row) => row.fundingRate.equals(exact("0.1")) || row.fundingRate.equals(exact("0.2"))),
    ).toEqual([true, true]);
  });
});
