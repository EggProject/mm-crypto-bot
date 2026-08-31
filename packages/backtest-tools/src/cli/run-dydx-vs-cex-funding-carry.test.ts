import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

import type { FundingSnapshot } from "@mm-crypto-bot/core";
import { ExactRational } from "@mm-crypto-bot/numeric";

import type { DydxHourlyFunding } from "../data/tardis-dydx-funding.js";
import {
  assessDydxCoverage,
  DYDX_COVERAGE_GATE,
  loadCexFundingCsv,
  loadDydxHourly,
  parseCliArguments as parseArguments,
  runDydxVsCexFundingCarryCommand,
  WINDOW_DEFS,
} from "./dydx-vs-cex-carry-data.js";
import type { TardisFetchPage } from "../data/tardis-dydx-funding.js";
import { nodeTardisCacheFileSystem, writeVerifiedTardisCache } from "../data/tardis-dydx-funding-cache.js";
import { simulateDydxVsCexCarry } from "./dydx-vs-cex-carry-simulation.js";

const exact = (value: string): ExactRational => ExactRational.from(value);
const temporaryDirectories: string[] = [];
const projectRoot = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..");

afterEach(async () => {
  const directories = [...temporaryDirectories];
  temporaryDirectories.length = 0;
  await Promise.all(directories.map((directory) => rm(directory, { recursive: true, force: true })));
});

function hourly(fundingTime: number, fundingRate: string): DydxHourlyFunding {
  return { fundingTime, symbol: "BTC-USD", fundingRate: exact(fundingRate), markPrice: exact("80000") };
}

function cex(fundingTime: number, fundingRate: string): FundingSnapshot {
  return { fundingTime, symbol: "BTCUSDT", fundingRate: exact(fundingRate), markPrice: exact("80000") };
}

async function invokeCli(argv: readonly string[]): Promise<{
  readonly exitCode: number;
  readonly stderr: string;
  readonly stdout: string;
}> {
  const processResult = Bun.spawn(
    ["bun", "packages/backtest-tools/src/cli/run-dydx-vs-cex-funding-carry.ts", ...argv],
    { cwd: projectRoot, stdout: "pipe", stderr: "pipe" },
  );
  const [exitCode, stdout, stderr] = await Promise.all([
    processResult.exited,
    new Response(processResult.stdout).text(),
    new Response(processResult.stderr).text(),
  ]);
  return { exitCode, stdout, stderr };
}

async function writeCachedTardisDay(cacheDirectory: string, date: Date): Promise<void> {
  const day = date.toISOString().slice(0, 10);
  const filePath = path.resolve(cacheDirectory, day, "BTC-USD.csv.gz");
  const header =
    "exchange,symbol,timestamp,local_timestamp,funding_timestamp,funding_rate,predicted_funding_rate,open_interest,last_price,index_price,mark_price";
  const dailyHours = Array.from({ length: 24 }, (_, index) => {
    const timestampUs = (date.getTime() + index * 3_600_000) * 1000;
    return `dydx-v4,BTC-USD,${String(timestampUs)},,,0.0001,,,,,80000`;
  });
  const csv = [header, ...dailyHours].join("\n");
  await writeVerifiedTardisCache(
    nodeTardisCacheFileSystem,
    filePath,
    gzipSync(csv),
    {
      date: day,
      market: "BTC-USD",
      url: `https://datasets.tardis.dev/v1/dydx-v4/derivative_ticker/${day.replaceAll("-", "/")}/BTC-USD.csv.gz`,
    },
    `${day}T00:00:00.000Z`,
  );
}

describe("dYdX carry CLI boundaries", () => {
  it("parses only positive finite operational values", () => {
    expect(parseArguments(["--symbol=ETH", "--window=2026-Q1", "--equity=1000"]).symbol).toBe("eth");
    expect(() => parseArguments(["--notional=NaN"])).toThrow("canonical positive decimal");
    expect(() => parseArguments(["--latency=0"])).toThrow("canonical positive decimal");
  });

  it("preserves canonical financial CLI text without a binary-float conversion", () => {
    const parsed = parseArguments(["--equity=9007199254740993"]);
    expect(parsed.initialEquity).toBe("9007199254740993");
    expect(() => parseArguments(["--equity=01000"])).toThrow("canonical positive decimal");
  });

  it("parses every supported operational override and rejects unknown identifiers", () => {
    const parsed = parseArguments([
      "--symbol=sol",
      "--window=2026-Q2",
      "--equity=1000",
      "--notional=10000",
      "--rebalance-bps=5",
      "--latency=1",
      "--funding-csv-dir=/tmp/funding",
      "--cache-dir=/tmp/cache",
      "--output=result-{symbol}-{window}.json",
      "--skip-tardis-fetch",
    ]);
    expect(parsed).toMatchObject({
      symbol: "sol",
      window: "2026-Q2",
      initialEquity: "1000",
      targetNotionalUsd: "10000",
      rebalanceCostBps: "5",
      withdrawalLatencyMinutes: "1",
      skipTardisFetch: true,
    });
    expect(() => parseArguments(["--symbol=xrp"])).toThrow("Invalid --symbol");
    expect(() => parseArguments(["--window=2030-Q1"])).toThrow("Invalid --window");
    expect(() => parseArguments(["--unknown"])).toThrow("Unknown arg");
  });

  it("builds every supported window from contiguous Tardis days", () => {
    for (const window of Object.values(WINDOW_DEFS)) {
      expect(window.start).toBeInstanceOf(Date);
      expect(window.end.getTime()).toBeGreaterThan(window.start.getTime());
      expect(window.tardisDays[0]?.getTime()).toBe(window.start.getTime());
      expect(window.tardisDays.at(-1)?.getTime()).toBe(window.end.getTime());
    }
  });

  it("requires independent hourly and daily dYdX coverage", () => {
    const start = Date.UTC(2025, 0, 1);
    const end = start + 10 * 3_600_000;
    const sparse = [hourly(start, "0.0001")];
    const coverage = assessDydxCoverage(sparse, start, end);
    expect(coverage.sufficient).toBe(false);
    expect(coverage.reasons).toEqual(["hourly_coverage_below_threshold"]);
    expect(DYDX_COVERAGE_GATE.minimumHourlyRatio).toBe(0.9);
    expect(
      assessDydxCoverage(
        Array.from({ length: 9 }, (_, index) => hourly(start + index * 3_600_000, "0.0001")),
        start,
        end,
      ).sufficient,
    ).toBe(true);
  });

  it("rejects an invalid coverage interval", () => {
    expect(() => assessDydxCoverage([], 1, 1)).toThrow("positive finite");
  });

  it("reports both coverage reasons when concentrated observations are insufficient", () => {
    const start = Date.UTC(2025, 0, 1);
    const end = start + 10 * 86_400_000;
    const concentrated = Array.from({ length: 192 }, (_, index) =>
      hourly(start + index * 3_600_000, "0.0001"),
    );
    const coverage = assessDydxCoverage(concentrated, start, end);
    expect(coverage.hourlyCoverageRatio).toBe(0.8);
    expect(coverage.reasons).toEqual(["hourly_coverage_below_threshold", "daily_coverage_below_threshold"]);
  });

  it("excludes observations outside the requested coverage interval", () => {
    const start = Date.UTC(2025, 0, 1);
    const end = start + 3_600_000;
    const coverage = assessDydxCoverage(
      [hourly(start - 1, "0.0001"), hourly(end, "0.0001"), hourly(start, "0.0001")],
      start,
      end,
    );
    expect(coverage.observedHourlySlots).toBe(1);
    expect(coverage.observedDays).toBe(1);
  });
});

describe("dYdX carry exact consumers", () => {
  it("keeps funding accrual, costs, and equity exact", () => {
    const time = Date.UTC(2025, 3, 1);
    const result = simulateDydxVsCexCarry({
      dydxHourly: [hourly(time, "0.0001")],
      cex8h: [cex(time, "0.00005")],
      startTime: time,
      endTime: time + 3_600_000,
      initialEquity: "10000",
      targetNotionalUsd: "100000",
      rebalanceCostBps: "20",
      withdrawalLatencyMinutes: "15",
    });
    expect(result.fundingCollectedUsd.equals(exact("-5"))).toBe(true);
    expect(result.equityCurve[0]?.equity.equals(exact("9995"))).toBe(true);
    expect(result.totalReturn.equals(exact("-0.0005"))).toBe(true);
    expect(result.monthlyCarry).toBeUndefined();
  });

  it("does not synthesize a binary rate from an exact decimal snapshot", () => {
    const time = Date.UTC(2025, 3, 1);
    const result = simulateDydxVsCexCarry({
      dydxHourly: [hourly(time, "-0.0000000000000000001")],
      cex8h: [],
      startTime: time,
      endTime: time + 3_600_000,
      initialEquity: "10000",
      targetNotionalUsd: "100000",
      rebalanceCostBps: "20",
      withdrawalLatencyMinutes: "15",
    });
    expect(result.fundingCollectedUsd.equals(exact("0.00000000000001"))).toBe(true);
  });

  it("rejects invalid numeric configuration before replay", () => {
    const time = Date.UTC(2025, 3, 1);
    expect(() =>
      simulateDydxVsCexCarry({
        dydxHourly: [],
        cex8h: [],
        startTime: time,
        endTime: time + 1,
        initialEquity: "10000",
        targetNotionalUsd: "Infinity",
        rebalanceCostBps: "20",
        withdrawalLatencyMinutes: "15",
      }),
    ).toThrow("targetNotionalUsd");
    expect(() =>
      simulateDydxVsCexCarry({
        dydxHourly: [],
        cex8h: [],
        startTime: time,
        endTime: time + 1,
        initialEquity: "10000",
        targetNotionalUsd: "100000",
        rebalanceCostBps: "20",
        withdrawalLatencyMinutes: "15",
        normalizedMetricsAllowed: false,
      }),
    ).toThrow("sufficient dYdX coverage");
  });

  it("handles rebalancing and seven-day compression exactly", () => {
    const start = Date.UTC(2025, 3, 1);
    const hourlyRates = Array.from({ length: 7 }, (_, index) =>
      hourly(start + index * 86_400_000, "0.00001"),
    );
    const compressed = simulateDydxVsCexCarry({
      dydxHourly: hourlyRates,
      cex8h: hourlyRates.map((row) => cex(row.fundingTime, "0.00008")),
      startTime: start,
      endTime: start + 8 * 86_400_000,
      initialEquity: "1000",
      targetNotionalUsd: "10000",
      rebalanceCostBps: "1",
      withdrawalLatencyMinutes: "1",
    });
    expect(compressed.killSwitch7DayCompressionTriggered).toBe(true);
    expect(compressed.compressedDivergenceDays).toBe(7);
    expect(compressed.avgDydx8hEquiv.equals(exact("0.00008"))).toBe(true);
    const rebalanced = simulateDydxVsCexCarry({
      dydxHourly: [],
      cex8h: [cex(start, "100")],
      startTime: start,
      endTime: start + 1,
      initialEquity: "1000",
      targetNotionalUsd: "10000",
      rebalanceCostBps: "1",
      withdrawalLatencyMinutes: "1",
    });
    expect(rebalanced.rebalanceCount).toBe(1);
  });

  it("orders unsorted funding inputs before calculating exact medians", () => {
    const start = Date.UTC(2025, 3, 1);
    const result = simulateDydxVsCexCarry({
      dydxHourly: [hourly(start + 3_600_000, "0.0001"), hourly(start, "0.0002")],
      cex8h: [cex(start + 3_600_000, "0"), cex(start, "0")],
      startTime: start,
      endTime: start + 2 * 3_600_000,
      initialEquity: "1000",
      targetNotionalUsd: "10000",
      rebalanceCostBps: "1",
      withdrawalLatencyMinutes: "1",
    });
    expect(result.medianDydx8hEquiv.equals(exact("0.0012"))).toBe(true);
  });

  it("counts negative CEX payments as losses and has a zero win rate without events", () => {
    const start = Date.UTC(2025, 3, 1);
    const options = {
      startTime: start,
      endTime: start + 1,
      initialEquity: "1000",
      targetNotionalUsd: "10000",
      rebalanceCostBps: "1",
      withdrawalLatencyMinutes: "1",
    };
    expect(
      simulateDydxVsCexCarry({ ...options, dydxHourly: [], cex8h: [cex(start, "-0.1")] }).winRate.equals(
        exact("0"),
      ),
    ).toBe(true);
    expect(simulateDydxVsCexCarry({ ...options, dydxHourly: [], cex8h: [] }).winRate.equals(exact("0"))).toBe(
      true,
    );
  });
});

describe("CEX CSV exact boundary", () => {
  it("parses raw decimal strings exactly and rejects malformed rows", async () => {
    const directory = await mkdtemp(path.resolve(tmpdir(), "dydx-carry-"));
    temporaryDirectories.push(directory);
    const csvPath = path.resolve(directory, "funding.csv");
    await Bun.write(
      csvPath,
      "timestamp,symbol,rate,mark\n1,BTCUSDT,0.0000000000000000001,80000\n2,ETHUSDT,wat,80001\n\n3,ETHUSDT,0.1,1\nnot-a-time,ETHUSDT,0.1,1\n4,BTCUSDT,0.2,\n",
    );
    const rows = await loadCexFundingCsv(csvPath, "BTCUSDT");
    expect(rows).toHaveLength(2);
    expect(rows[0]?.fundingRate.equals(exact("0.0000000000000000001"))).toBe(true);
    expect(rows[0]?.markPrice?.equals(exact("80000"))).toBe(true);
    expect(rows[1]?.fundingRate.equals(exact("0.2"))).toBe(true);
    expect(rows[1]?.markPrice).toBeUndefined();
  });
});

describe("dYdX hourly loader transport boundary", () => {
  it("makes zero transport calls in cache-only mode and records absent days", async () => {
    const directory = await mkdtemp(path.resolve(tmpdir(), "dydx-loader-"));
    temporaryDirectories.push(directory);
    let callCount = 0;
    const fetchPage: TardisFetchPage = () => {
      callCount += 1;
      return Promise.reject(new Error("transport must not be called"));
    };
    const dates = [new Date(Date.UTC(2025, 3, 1)), new Date(Date.UTC(2025, 4, 1))];
    const loaded = await loadDydxHourly(directory, "btc", dates, true, fetchPage);
    expect(callCount).toBe(0);
    expect(loaded.hourly).toEqual([]);
    expect(loaded.skippedDays).toEqual(["2025-04-01", "2025-05-01"]);
  });

  it("fails closed per day for malformed transport responses without skip mode", async () => {
    const directory = await mkdtemp(path.resolve(tmpdir(), "dydx-loader-malformed-"));
    temporaryDirectories.push(directory);
    const loaded = await loadDydxHourly(directory, "eth", [new Date(Date.UTC(2025, 5, 1))], false, () =>
      Promise.resolve({ ok: "yes", status: 200, arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)) }),
    );
    expect(loaded.hourly).toEqual([]);
    expect(loaded.skippedDays).toEqual(["2025-06-01"]);
  });

  it("uses SOL market data and stringifies non-Error transport failures", async () => {
    const directory = await mkdtemp(path.resolve(tmpdir(), "dydx-loader-sol-"));
    temporaryDirectories.push(directory);
    const rejected = await loadDydxHourly(directory, "sol", [new Date(Date.UTC(2025, 6, 1))], false, () =>
      Promise.reject(new Error("offline")),
    );
    expect(rejected).toEqual({ hourly: [], receipts: [], skippedDays: ["2025-07-01"] });
  });
});

describe("dYdX carry command process boundary", () => {
  it("sikeresen lefut: a CEX CSV + Tardis cache alapján kimenti az output JSON-t", async () => {
    const directory = await mkdtemp(path.resolve(tmpdir(), "dydx-cli-complete-"));
    temporaryDirectories.push(directory);
    const fundingDirectory = path.resolve(directory, "funding");
    const cacheDirectory = path.resolve(directory, "cache");
    const outputPath = path.resolve(directory, "reports", "result-{symbol}-{window}.json");
    const firstQuarter = WINDOW_DEFS["2025-Q1"];
    for (const date of firstQuarter.tardisDays) await writeCachedTardisDay(cacheDirectory, date);
    await Bun.write(
      path.resolve(fundingDirectory, "binance_btcusdt_funding_8h.csv"),
      `timestamp,symbol,rate,mark\n${String(firstQuarter.start.getTime())},BTCUSDT,0.00005,80000\n`,
    );

    const exitCode = await runDydxVsCexFundingCarryCommand([
      "--symbol=btc",
      "--window=2025-Q1",
      `--funding-csv-dir=${fundingDirectory}`,
      `--cache-dir=${cacheDirectory}`,
      `--output=${outputPath}`,
      "--skip-tardis-fetch",
    ]);
    const resolvedOutput = path.resolve(directory, "reports", "result-btc-2025-Q1.json");
    const output = JSON.parse(await Bun.file(resolvedOutput).text()) as {
      readonly coverage: { readonly sufficient: boolean };
      readonly dydxHourlyCount: number;
    };

    expect(exitCode).toBe(0);
    expect(output.coverage.sufficient).toBe(true);
    expect(output.dydxHourlyCount).toBe(2160);
  });

  it("fails closed without output when three authentic daily cache files cannot cover a quarter", async () => {
    const directory = await mkdtemp(path.resolve(tmpdir(), "dydx-cli-process-"));
    temporaryDirectories.push(directory);
    const fundingDirectory = path.resolve(directory, "funding");
    const cacheDirectory = path.resolve(directory, "cache");
    const firstQuarter = WINDOW_DEFS["2025-Q1"];
    for (const date of firstQuarter.tardisDays.slice(0, 3)) await writeCachedTardisDay(cacheDirectory, date);
    await Bun.write(
      path.resolve(fundingDirectory, "binance_btcusdt_funding_8h.csv"),
      `timestamp,symbol,rate,mark\n${String(firstQuarter.start.getTime())},BTCUSDT,0.00005,80000\n`,
    );
    const templatedOutput = path.resolve(directory, "reports", "result-{symbol}-{window}.json");
    const command = [
      "--symbol=btc",
      "--window=2025-Q1",
      `--funding-csv-dir=${fundingDirectory}`,
      `--cache-dir=${cacheDirectory}`,
      `--output=${templatedOutput}`,
      "--skip-tardis-fetch",
    ];
    const result = await invokeCli(command);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("INSUFFICIENT_COVERAGE");
    expect(await Bun.file(path.resolve(directory, "reports", "result-btc-2025-Q1.json")).exists()).toBe(
      false,
    );
    const literalOutput = path.resolve(directory, "reports", "literal.json");
    expect(
      await runDydxVsCexFundingCarryCommand([
        ...command.filter((argument) => !argument.startsWith("--output=")),
        `--output=${literalOutput}`,
      ]),
    ).toBe(2);
    expect(await Bun.file(literalOutput).exists()).toBe(false);
  });

  it("reports help, invalid arguments, and missing CEX input as public command results", async () => {
    const directory = await mkdtemp(path.resolve(tmpdir(), "dydx-cli-empty-"));
    temporaryDirectories.push(directory);
    const fundingDirectory = path.resolve(directory, "empty-funding");
    await Bun.write(
      path.resolve(fundingDirectory, "binance_btcusdt_funding_8h.csv"),
      "timestamp,symbol,rate,mark\n",
    );
    expect(await runDydxVsCexFundingCarryCommand(["--help"])).toBe(0);
    expect(await runDydxVsCexFundingCarryCommand(["--not-a-real-argument"])).toBe(1);
    expect(
      await runDydxVsCexFundingCarryCommand([
        "--symbol=btc",
        "--window=2025-Q1",
        `--funding-csv-dir=${fundingDirectory}`,
        `--cache-dir=${path.resolve(directory, "cache")}`,
      ]),
    ).toBe(1);
  });
});
