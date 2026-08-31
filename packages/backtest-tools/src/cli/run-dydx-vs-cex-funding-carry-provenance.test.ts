import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";

import {
  loadCexFundingCsv,
  loadCexFundingCsvWithReceipt,
  loadDydxHourly,
  runDydxVsCexFundingCarryCommand,
  WINDOW_DEFS,
} from "./dydx-vs-cex-carry-data.js";
import { nodeTardisCacheFileSystem, writeVerifiedTardisCache } from "../data/tardis-dydx-funding-cache.js";
import { TardisCsvBoundaryError } from "../data/tardis-dydx-funding-csv.js";

const temporaryDirectories: string[] = [];
const header =
  "exchange,symbol,timestamp,local_timestamp,funding_timestamp,funding_rate,predicted_funding_rate,open_interest,last_price,index_price,mark_price";

afterEach(async () => {
  const directories = [...temporaryDirectories];
  temporaryDirectories.length = 0;
  await Promise.all(directories.map((directory) => rm(directory, { recursive: true, force: true })));
});

async function directory(prefix: string): Promise<string> {
  const value = await mkdtemp(path.resolve(tmpdir(), prefix));
  temporaryDirectories.push(value);
  return value;
}

async function failureMessage(operation: () => Promise<unknown>): Promise<string> {
  try {
    await operation();
  } catch (error: unknown) {
    return error instanceof Error ? error.message : "unknown";
  }
  return "no failure";
}

async function writeCachedTardisDay(cacheDirectory: string, date: Date): Promise<void> {
  const day = date.toISOString().slice(0, 10);
  const filePath = path.resolve(cacheDirectory, day, "BTC-USD.csv.gz");
  const rows = Array.from({ length: 24 }, (_, index) => {
    const timestampUs = (date.getTime() + index * 3_600_000) * 1000;
    return `dydx-v4,BTC-USD,${String(timestampUs)},,,0.0001,,,,,80000`;
  });
  await writeVerifiedTardisCache(
    nodeTardisCacheFileSystem,
    filePath,
    gzipSync([header, ...rows].join("\n")),
    {
      date: day,
      market: "BTC-USD",
      url: `https://datasets.tardis.dev/v1/dydx-v4/derivative_ticker/${day.replaceAll("-", "/")}/BTC-USD.csv.gz`,
    },
    `${day}T00:00:00.000Z`,
  );
}

describe("dYdX carry provenance boundaries", () => {
  it("rejects malformed selected CEX rows while ignoring unrelated rows", async () => {
    const root = await directory("dydx-cex-strict-");
    const csvPath = path.resolve(root, "funding.csv");
    await Bun.write(
      csvPath,
      "timestamp,symbol,rate,mark\nnot-a-time,ETHUSDT,wat,wrong\n1,BTCUSDT,0.10,80000\n",
    );
    expect(await failureMessage(() => loadCexFundingCsv(csvPath, "BTCUSDT"))).toContain(
      "invalid funding rate",
    );
    await Bun.write(csvPath, "timestamp,symbol,rate,mark\ninvalid,BTCUSDT,0.1,80000\n");
    expect(await failureMessage(() => loadCexFundingCsv(csvPath, "BTCUSDT"))).toContain("invalid timestamp");
    await Bun.write(csvPath, "timestamp,symbol,rate,mark\n9007199254740992,BTCUSDT,0.1,80000\n");
    expect(await failureMessage(() => loadCexFundingCsv(csvPath, "BTCUSDT"))).toContain("invalid timestamp");
    await Bun.write(csvPath, "timestamp,symbol,rate,mark\n1,BTCUSDT,0.1,80000\n");
    const loaded = await loadCexFundingCsvWithReceipt(csvPath, "BTCUSDT");
    expect(Object.isFrozen(loaded)).toBe(true);
    expect(loaded.snapshots).toHaveLength(1);
  });

  it("propagates a malformed selected-market cache row instead of recording a skipped day", async () => {
    const root = await directory("dydx-loader-strict-");
    const date = new Date(Date.UTC(2025, 3, 1));
    const cachePath = path.resolve(root, "2025-04-01", "BTC-USD.csv.gz");
    await writeVerifiedTardisCache(
      nodeTardisCacheFileSystem,
      cachePath,
      gzipSync(`${header}\ndydx-v4,BTC-USD\n`),
      {
        date: "2025-04-01",
        market: "BTC-USD",
        url: "https://datasets.tardis.dev/v1/dydx-v4/derivative_ticker/2025/04/01/BTC-USD.csv.gz",
      },
      "2025-04-01T00:00:00.000Z",
    );
    let failure: unknown;
    try {
      await loadDydxHourly(root, "btc", [date], true);
    } catch (error: unknown) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(TardisCsvBoundaryError);
  });

  it("writes CEX input bytes and verified dYdX daily receipts into the result report", async () => {
    const root = await directory("dydx-provenance-");
    const fundingDirectory = path.resolve(root, "funding");
    const cacheDirectory = path.resolve(root, "cache");
    const outputPath = path.resolve(root, "reports", "result-{symbol}-{window}.json");
    const window = WINDOW_DEFS["2025-Q1"];
    for (const date of window.tardisDays) await writeCachedTardisDay(cacheDirectory, date);
    await Bun.write(
      path.resolve(fundingDirectory, "binance_btcusdt_funding_8h.csv"),
      `timestamp,symbol,rate,mark\n${String(window.start.getTime())},BTCUSDT,0.00005,80000\n`,
    );
    expect(
      await runDydxVsCexFundingCarryCommand([
        "--symbol=btc",
        "--window=2025-Q1",
        `--funding-csv-dir=${fundingDirectory}`,
        `--cache-dir=${cacheDirectory}`,
        `--output=${outputPath}`,
        "--skip-tardis-fetch",
      ]),
    ).toBe(0);
    const reportPath = path.resolve(root, "reports", "result-btc-2025-Q1.json");
    const report = JSON.parse(await Bun.file(reportPath).text()) as {
      readonly dataProvenance: {
        readonly cexFundingSha256: string;
        readonly dydxDayReceipts: readonly { readonly schema: string }[];
      };
    };
    expect(report.dataProvenance.cexFundingSha256).toBe(
      "8afb7c5060b0650c2de7612d0494e8b86fd20f6dc063849b0cfea99a3e13c3b7",
    );
    expect(report.dataProvenance.dydxDayReceipts).toHaveLength(window.tardisDays.length);
    expect(report.dataProvenance.dydxDayReceipts[0]?.schema).toBe("tardis-dydx-cache@2");
  });
});
