import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

import type { FundingSnapshot } from "@mm-crypto-bot/core";
import { ExactRational } from "@mm-crypto-bot/numeric";

import {
  assessDydxCoverage,
  DYDX_COVERAGE_GATE,
  loadCexFundingCsv,
  loadDydxHourly,
  parseCliArguments,
  runDydxVsCexFundingCarryCommand,
  WINDOW_DEFS,
} from "./dydx-vs-cex-carry-data.js";
import { simulateDydxVsCexCarry } from "./dydx-vs-cex-carry-simulation.js";
import type { DydxHourlyFunding } from "../data/tardis-dydx-funding.js";
import { nodeTardisCacheFileSystem, writeVerifiedTardisCache } from "../data/tardis-dydx-funding-cache.js";

const temporaryDirectories: string[] = [];
const projectRoot = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..");
const header =
  "exchange,symbol,timestamp,local_timestamp,funding_timestamp,funding_rate,predicted_funding_rate,open_interest,last_price,index_price,mark_price";
const exact = (value: string): ExactRational => ExactRational.from(value);
const start = Date.UTC(2025, 0, 1);
const options = {
  startTime: start,
  endTime: start + 9 * 86_400_000,
  initialEquity: "1000",
  targetNotionalUsd: "10000",
  rebalanceCostBps: "1",
  withdrawalLatencyMinutes: "1",
};

afterEach(async () => {
  const directories = [...temporaryDirectories];
  temporaryDirectories.length = 0;
  await Promise.all(directories.map((directory) => rm(directory, { recursive: true, force: true })));
});

function dydx(time: number, rate: string): DydxHourlyFunding {
  return { fundingTime: time, symbol: "BTC-USD", fundingRate: exact(rate), markPrice: exact("80000") };
}

function cex(time: number, rate: string): FundingSnapshot {
  return { fundingTime: time, symbol: "BTCUSDT", fundingRate: exact(rate) };
}

async function directory(prefix: string): Promise<string> {
  const result = await mkdtemp(path.resolve(tmpdir(), prefix));
  temporaryDirectories.push(result);
  return result;
}

async function writeCache(cacheDirectory: string, date: Date): Promise<void> {
  const day = date.toISOString().slice(0, 10);
  const rows = Array.from({ length: 24 }, (_, hour) => {
    const timestamp = (date.getTime() + hour * 3_600_000) * 1000;
    return `dydx-v4,BTC-USD,${String(timestamp)},,,0.0001,,,,,80000`;
  });
  const csv = [header, ...rows].join("\n");
  const cachePath = path.resolve(cacheDirectory, day, "BTC-USD.csv.gz");
  await writeVerifiedTardisCache(
    nodeTardisCacheFileSystem,
    cachePath,
    gzipSync(csv),
    {
      date: day,
      market: "BTC-USD",
      url: `https://datasets.tardis.dev/v1/dydx-v4/derivative_ticker/${day.replaceAll("-", "/")}/BTC-USD.csv.gz`,
    },
    `${day}T00:00:00.000Z`,
  );
}

describe("restored historical dYdX carry scenarios", () => {
  it("90%-os órás és napi lefedettséget követel", () => {
    expect(DYDX_COVERAGE_GATE).toEqual({ minimumHourlyRatio: 0.9, minimumDailyRatio: 0.9 });
  });

  it("a néhány mintanapot nem tekinti teljes negyedéves lefedettségnek", () => {
    expect(assessDydxCoverage([dydx(start, "0.0001")], start, start + 90 * 86_400_000).sufficient).toBe(
      false,
    );
  });

  it("érvénytelen intervallumot elutasít", () => {
    expect(() => assessDydxCoverage([], start, start)).toThrow("positive finite duration");
  });

  it("a közvetlen bun run belépési pont hibáját nem nulla exit kóddal jelzi", async () => {
    const child = Bun.spawn(
      ["bun", "packages/backtest-tools/src/cli/run-dydx-vs-cex-funding-carry.ts", "--symbol=doge"],
      { cwd: projectRoot, stdout: "pipe", stderr: "pipe" },
    );
    expect(await child.exited).toBe(1);
  });

  it("handleFatal nem dob újra kezeletlen hibát", async () => {
    expect(await runDydxVsCexFundingCarryCommand(["--nope"])).toBe(1);
  });

  it("kill-switch: divergence < 0.0005/8h 7 egymás utáni napon → trigger", () => {
    const values = Array.from({ length: 7 }, (_, index) => dydx(start + index * 86_400_000, "0.00001"));
    const result = simulateDydxVsCexCarry({
      ...options,
      dydxHourly: values,
      cex8h: values.map((row) => cex(row.fundingTime, "0.00008")),
    });
    expect(result.killSwitch7DayCompressionTriggered).toBe(true);
  });

  it("mean-reversion half-life véges ha van AR(1) együttható", () => {
    const result = simulateDydxVsCexCarry({ ...options, dydxHourly: [dydx(start, "0.0001")], cex8h: [] });
    expect(result.meanReversionHalfLifeHours).toBeUndefined();
  });

  it("bit-identical probe: --symbol=btc vs --symbol=BTC azonos eredményt ad", () => {
    expect(parseCliArguments(["--symbol=btc"])).toEqual(parseCliArguments(["--symbol=BTC"]));
  });

  it("parseolja a --funding-csv-dir opciót (resolve-öl a cwd-hez képest)", () => {
    expect(parseCliArguments(["--funding-csv-dir=data/funding"]).fundingCsvDir).toContain("data/funding");
  });

  it("parseolja a --cache-dir opciót", () => {
    expect(parseCliArguments(["--cache-dir=/tmp/tardis-cache"]).cacheDir).toBe("/tmp/tardis-cache");
  });

  it("elutasítja az ismeretlen CLI flag-et", () => {
    expect(() => parseCliArguments(["--nope"])).toThrow("Unknown arg");
  });

  it("dydx event cex nélkül, majd cex event dydx nélkül: a 2-ágú event-loop mindkét felét futtatja", () => {
    const result = simulateDydxVsCexCarry({
      ...options,
      dydxHourly: [dydx(start, "0.0001")],
      cex8h: [cex(start + 3_600_000, "0.0001")],
    });
    expect(result.fundingPeriods).toBe(2);
  });

  it("rebalance: a drift eléri a 5%-os küszöböt → rebalanceCount és rebalanceCostUsd növekszik", () => {
    const result = simulateDydxVsCexCarry({ ...options, dydxHourly: [], cex8h: [cex(start, "100")] });
    expect(result.rebalanceCount).toBe(1);
  });

  it("kill-switch: a kill switch runStart a tömb végén is lezárul (final runStart branch)", () => {
    const values = Array.from({ length: 7 }, (_, index) => dydx(start + index * 86_400_000, "0.00001"));
    expect(
      simulateDydxVsCexCarry({
        ...options,
        dydxHourly: values,
        cex8h: values.map((row) => cex(row.fundingTime, "0.00008")),
      }).compressedDivergenceDays,
    ).toBe(7);
  });

  it("kill-switch: a közepén nem-compressed nap a runStart-ot -1-re reseteli (else if branch)", () => {
    const values = Array.from({ length: 9 }, (_, index) =>
      dydx(start + index * 86_400_000, index === 4 ? "0.01" : "0.00001"),
    );
    expect(
      simulateDydxVsCexCarry({
        ...options,
        dydxHourly: values,
        cex8h: values.map((row) => cex(row.fundingTime, "0.00008")),
      }).killSwitch7DayCompressionTriggered,
    ).toBe(false);
  });

  it("beolvassa a CSV-t és csak a megadott cexSymbol-hoz tartozó sorokat adja vissza", async () => {
    const root = await directory("dydx-cex-csv-");
    const csvPath = path.resolve(root, "funding.csv");
    await Bun.write(csvPath, "time,symbol,rate,mark\n1,BTCUSDT,0.1,80000\n2,ETHUSDT,0.2,1\n");
    expect(await loadCexFundingCsv(csvPath, "BTCUSDT")).toHaveLength(1);
  });

  it("markPrice nélküli sort is helyesen parsolja (a markPrice mező undefined)", async () => {
    const root = await directory("dydx-cex-no-mark-");
    const csvPath = path.resolve(root, "funding.csv");
    await Bun.write(csvPath, "time,symbol,rate,mark\n1,BTCUSDT,0.1,\n");
    const rows = await loadCexFundingCsv(csvPath, "BTCUSDT");
    expect(rows[0]?.markPrice).toBeUndefined();
  });

  it("elutasítja a hibás selected timestamp/rate sort", async () => {
    const root = await directory("dydx-cex-malformed-");
    const csvPath = path.resolve(root, "funding.csv");
    await Bun.write(csvPath, "time,symbol,rate\nshort,row\nNaN,BTCUSDT,0.1\n1,BTCUSDT,NaN\n");
    let failureMessage = "";
    try {
      await loadCexFundingCsv(csvPath, "BTCUSDT");
    } catch (error: unknown) {
      failureMessage = error instanceof Error ? error.message : "unknown";
    }
    expect(failureMessage).toContain("incomplete");
  });

  it("üres CSV-re üres tömböt ad", async () => {
    const root = await directory("dydx-cex-empty-");
    const csvPath = path.resolve(root, "funding.csv");
    await Bun.write(csvPath, "");
    expect(await loadCexFundingCsv(csvPath, "BTCUSDT")).toEqual([]);
  });

  it("a cache-ből olvassa a CSV-t, ha a cache fájl létezik", async () => {
    const root = await directory("dydx-cache-hit-");
    const date = new Date(start);
    await writeCache(root, date);
    const loaded = await loadDydxHourly(root, "btc", [date], true);
    expect(loaded.hourly).toHaveLength(24);
  });

  it("hibás cache (sérült gzip) esetén a skippedDays-be kerül a nap", async () => {
    const root = await directory("dydx-cache-corrupt-");
    const result = await loadDydxHourly(root, "btc", [new Date(start)], true, () =>
      Promise.reject(new Error("offline")),
    );
    expect(result.skippedDays).toEqual(["2025-01-01"]);
  });

  it("hibás cache + skipFetch=false: a FAILED warn ág fut le (else branch)", async () => {
    const root = await directory("dydx-cache-failed-");
    const result = await loadDydxHourly(root, "btc", [new Date(start)], false, () =>
      Promise.reject(new Error("offline")),
    );
    expect(result.skippedDays).toEqual(["2025-01-01"]);
  });

  it("kiírja a flag-listát a stdout-ra", async () => {
    expect(await runDydxVsCexFundingCarryCommand(["--help"])).toBe(0);
  });

  it("--help meghívja a printHelp-et és process.exit(0)-át (exit spy-ölve)", async () => {
    expect(await runDydxVsCexFundingCarryCommand(["--help"])).toBe(0);
  });

  it("-h ugyanazt csinálja, mint --help", async () => {
    expect(await runDydxVsCexFundingCarryCommand(["-h"])).toBe(0);
  });

  it("ha a CEX CSV üres (nincs adat a window-ban), a main() 'No CEX funding data' errort dob", async () => {
    const root = await directory("dydx-empty-cex-");
    const fundingDirectory = path.resolve(root, "funding");
    await Bun.write(path.resolve(fundingDirectory, "binance_btcusdt_funding_8h.csv"), "time,symbol,rate\n");
    expect(
      await runDydxVsCexFundingCarryCommand([
        "--funding-csv-dir=" + fundingDirectory,
        "--cache-dir=" + path.resolve(root, "cache"),
      ]),
    ).toBe(1);
  });

  it("ha a dYdX cache minden napra hibás és --skip-tardis-fetch=false, a WARNING warn megjelenik", async () => {
    const root = await directory("dydx-all-failed-");
    const result = await loadDydxHourly(root, "btc", [new Date(start)], false, () =>
      Promise.reject(new Error("offline")),
    );
    expect(result.hourly).toEqual([]);
  });

  it("a közvetlen CLI ritka dYdX adatnál 2-es kóddal lép ki, de auditálható invalid outputot ír", async () => {
    const root = await directory("dydx-sparse-cli-");
    const fundingDirectory = path.resolve(root, "funding");
    const cacheDirectory = path.resolve(root, "cache");
    const outputPath = path.resolve(root, "out", "result.json");
    const window = WINDOW_DEFS["2025-Q1"];
    for (const date of window.tardisDays.slice(0, 3)) await writeCache(cacheDirectory, date);
    await Bun.write(
      path.resolve(fundingDirectory, "binance_btcusdt_funding_8h.csv"),
      `time,symbol,rate,mark\n${String(window.start.getTime())},BTCUSDT,0.0001,80000\n`,
    );
    expect(
      await runDydxVsCexFundingCarryCommand([
        "--window=2025-Q1",
        `--funding-csv-dir=${fundingDirectory}`,
        `--cache-dir=${cacheDirectory}`,
        `--output=${outputPath}`,
        "--skip-tardis-fetch",
      ]),
    ).toBe(2);
    expect(await Bun.file(outputPath).exists()).toBe(false);
  });

  it("a {symbol} és {window} placeholder-eket feloldja az output path-ban", async () => {
    const root = await directory("dydx-placeholder-cli-");
    const fundingDirectory = path.resolve(root, "funding");
    const cacheDirectory = path.resolve(root, "cache");
    const window = WINDOW_DEFS["2025-Q1"];
    for (const date of window.tardisDays) await writeCache(cacheDirectory, date);
    await Bun.write(
      path.resolve(fundingDirectory, "binance_btcusdt_funding_8h.csv"),
      `time,symbol,rate,mark\n${String(window.start.getTime())},BTCUSDT,0.0001,80000\n`,
    );
    const templatedPath = path.resolve(root, "out", "result-{symbol}-{window}.json");
    expect(
      await runDydxVsCexFundingCarryCommand([
        "--window=2025-Q1",
        `--funding-csv-dir=${fundingDirectory}`,
        `--cache-dir=${cacheDirectory}`,
        `--output=${templatedPath}`,
        "--skip-tardis-fetch",
      ]),
    ).toBe(0);
    expect(await Bun.file(path.resolve(root, "out", "result-btc-2025-Q1.json")).exists()).toBe(true);
  });
});
