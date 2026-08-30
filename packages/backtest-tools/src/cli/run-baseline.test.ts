// CsvExchangeFeed hermetic mapping and fixture compatibility tests.

import { describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { CsvExchangeFeed } from "../data/csv-feed.js";

type SupportedSymbol = "BTC/USDT" | "ETH/USDT" | "SOL/USDT";
type SupportedTimeframe = "1h" | "4h" | "1d" | "5m" | "15m";

interface FixtureInput {
  readonly fileName: string;
  readonly symbol: SupportedSymbol;
  readonly timeframe: SupportedTimeframe;
}

interface FixtureManifestEntry {
  readonly symbol: string;
  readonly timeframe: string;
}

interface BaselineFixture {
  readonly dataDirectory: string;
  readonly feed: CsvExchangeFeed;
}

type FixtureOutcome<T> =
  { readonly succeeded: true; readonly value: T } | { readonly succeeded: false; readonly error: unknown };

const SUPPORTED_SYMBOLS: readonly SupportedSymbol[] = ["BTC/USDT", "ETH/USDT", "SOL/USDT"];
const SUPPORTED_TIMEFRAMES: readonly SupportedTimeframe[] = ["1h", "4h", "1d", "5m", "15m"];
const FIXTURE_CSV = "timestamp,open,high,low,close,volume\n1704067200000,1,1,1,1,1\n";

function fixtureFileName(symbol: SupportedSymbol, timeframe: SupportedTimeframe): string {
  switch (symbol) {
    case "BTC/USDT": {
      return `binance_btc_${timeframe}.csv`;
    }
    case "ETH/USDT": {
      return `binance_eth_${timeframe}.csv`;
    }
    case "SOL/USDT": {
      return `binance_sol_${timeframe}.csv`;
    }
  }
}

function fixturePair(symbol: string, timeframe: string): string {
  return `${symbol}:${timeframe}`;
}

const FIXTURE_INPUTS: readonly FixtureInput[] = SUPPORTED_SYMBOLS.flatMap((symbol) =>
  SUPPORTED_TIMEFRAMES.map((timeframe) => ({
    fileName: fixtureFileName(symbol, timeframe),
    symbol,
    timeframe,
  })),
);

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFixtureManifestEntry(value: unknown): value is FixtureManifestEntry {
  return isRecord(value) && typeof value["symbol"] === "string" && typeof value["timeframe"] === "string";
}

function parseFixtureManifest(raw: string): readonly FixtureManifestEntry[] {
  const parsed: unknown = JSON.parse(raw);
  if (
    !isRecord(parsed) ||
    !Array.isArray(parsed["files"]) ||
    !parsed["files"].every(isFixtureManifestEntry)
  ) {
    throw new Error("Fixture manifest must contain a files array of symbol/timeframe entries");
  }
  return parsed["files"];
}

async function withBaselineFixture<T>(body: (fixture: BaselineFixture) => Promise<T>): Promise<T> {
  const root = await mkdtemp(path.join(tmpdir(), "mm-crypto-bot-run-baseline-"));
  let outcome: FixtureOutcome<T>;
  try {
    const manifestFiles = FIXTURE_INPUTS.map(({ symbol, timeframe }) => ({ symbol, timeframe }));
    const manifestContents = JSON.stringify({ files: manifestFiles });
    await Promise.all([
      ...FIXTURE_INPUTS.map(({ fileName }) => Bun.write(path.join(root, fileName), FIXTURE_CSV)),
      Bun.write(path.join(root, "MANIFEST.json"), manifestContents),
    ]);
    outcome = {
      succeeded: true,
      value: await body({ dataDirectory: root, feed: new CsvExchangeFeed(root) }),
    };
  } catch (error: unknown) {
    outcome = { succeeded: false, error };
  }

  try {
    await rm(root, { recursive: true, force: true });
  } catch (cleanupError: unknown) {
    if (!outcome.succeeded) {
      throw new AggregateError([outcome.error, cleanupError], "Fixture operation and cleanup both failed", {
        cause: cleanupError,
      });
    }
    throw cleanupError;
  }

  if (!outcome.succeeded) {
    throw outcome.error;
  }
  return outcome.value;
}

describe("CsvExchangeFeed hermetic timeframe mapping", () => {
  it("loads a BTC/USDT 1h candle from the fixture", async () => {
    await withBaselineFixture(async ({ feed }) => {
      const candles = await feed.fetchOHLCV("BTC/USDT", "1h", { since: 0, limit: 5 });
      expect(candles.length).toBeGreaterThan(0);
      expect(candles[0]?.timestamp).toBeGreaterThan(0);
      expect(typeof candles[0]?.close).toBe("number");
      expect(Number.isFinite(candles[0]?.close ?? NaN)).toBe(true);
    });
  });

  it("maps core timeframes for every supported symbol", async () => {
    await withBaselineFixture(async ({ feed }) => {
      const symbols = ["BTC/USDT", "ETH/USDT", "SOL/USDT"];
      const timeframes: readonly FixtureInput["timeframe"][] = ["1h", "4h", "1d"];
      for (const symbol of symbols) {
        for (const timeframe of timeframes) {
          const candles = await feed.fetchOHLCV(symbol, timeframe, { since: 0, limit: 5 });
          expect(candles.length).toBeGreaterThan(0);
        }
      }
    });
  });

  it("maps intraday timeframes for every supported symbol", async () => {
    await withBaselineFixture(async ({ feed }) => {
      const symbols = ["BTC/USDT", "ETH/USDT", "SOL/USDT"];
      const timeframes: readonly FixtureInput["timeframe"][] = ["5m", "15m"];
      for (const symbol of symbols) {
        for (const timeframe of timeframes) {
          const candles = await feed.fetchOHLCV(symbol, timeframe, { since: 0, limit: 5 });
          expect(candles.length).toBeGreaterThan(0);
        }
      }
    });
  });

  it("lists every supported symbol/timeframe fixture input in its manifest", async () => {
    await withBaselineFixture(async ({ dataDirectory }) => {
      const raw = await Bun.file(path.join(dataDirectory, "MANIFEST.json")).text();
      const manifestFiles = parseFixtureManifest(raw);
      const expectedPairs = SUPPORTED_SYMBOLS.flatMap((symbol) =>
        SUPPORTED_TIMEFRAMES.map((timeframe) => fixturePair(symbol, timeframe)),
      );
      const fixturePairs = FIXTURE_INPUTS.map(({ symbol, timeframe }) => fixturePair(symbol, timeframe));
      const expectedFileNames = FIXTURE_INPUTS.map(({ symbol, timeframe }) =>
        fixtureFileName(symbol, timeframe),
      );
      const fixtureFileNames = FIXTURE_INPUTS.map(({ fileName }) => fileName);
      const manifestPairs = manifestFiles.map(({ symbol, timeframe }) => fixturePair(symbol, timeframe));
      expect(fixturePairs).toEqual(expectedPairs);
      expect(new Set(fixturePairs).size).toBe(15);
      expect(fixtureFileNames).toEqual(expectedFileNames);
      expect(new Set(fixtureFileNames).size).toBe(15);
      expect(manifestPairs).toEqual(expectedPairs);
      expect(manifestFiles.length).toBe(15);
      const intradayTimeframes = manifestFiles.filter(
        (file) => file.timeframe === "5m" || file.timeframe === "15m",
      );
      expect(intradayTimeframes.length).toBe(6);
    });
  });
});
