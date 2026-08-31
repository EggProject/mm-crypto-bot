import { createHash } from "node:crypto";
import path from "node:path";

import type { FundingSnapshot } from "@mm-crypto-bot/core";
import { canonicalizeExternalDecimal, ExactRational } from "@mm-crypto-bot/numeric";

import type { DydxMarket } from "../data/dydx-indexer-feed.js";
import type { TardisCacheReceipt } from "../data/tardis-dydx-funding-cache.js";
import { TardisCsvBoundaryError } from "../data/tardis-dydx-funding-csv.js";
import {
  TardisDydxFundingFetcher,
  type DydxHourlyFunding,
  type TardisFetchPage,
} from "../data/tardis-dydx-funding.js";
import { simulateDydxVsCexCarry } from "./dydx-vs-cex-carry-simulation.js";

export type SymbolId = "btc" | "eth" | "sol";
export type WindowId = "2025-Q1" | "2025-Q2" | "2025-Q3" | "2025-Q4" | "2026-Q1" | "2026-Q2";
export interface WindowDefinition {
  readonly id: WindowId;
  readonly start: Date;
  readonly end: Date;
  readonly tardisDays: readonly Date[];
}
export interface CliArguments {
  readonly symbol: SymbolId;
  readonly window: WindowId;
  readonly initialEquity: string;
  readonly targetNotionalUsd: string;
  readonly rebalanceCostBps: string;
  readonly withdrawalLatencyMinutes: string;
  readonly fundingCsvDir: string;
  readonly cacheDir: string;
  readonly outputPath: string;
  readonly skipTardisFetch: boolean;
}
export interface DydxCoverageStatus {
  readonly status: "SUFFICIENT" | "INSUFFICIENT";
  readonly sufficient: boolean;
  readonly expectedHourlySlots: number;
  readonly observedHourlySlots: number;
  readonly hourlyCoverageRatio: number;
  readonly expectedDays: number;
  readonly observedDays: number;
  readonly dailyCoverageRatio: number;
  readonly minimumHourlyRatio: number;
  readonly minimumDailyRatio: number;
  readonly reasons: readonly string[];
}

export interface CexFundingCsvLoad {
  readonly sha256: string;
  readonly snapshots: readonly FundingSnapshot[];
}

type CexFundingColumns = readonly [string, string, string, string];

const DAY_MS = 86_400_000;
const SYMBOL_TO_CEX = { btc: "BTCUSDT", eth: "ETHUSDT", sol: "SOLUSDT" } as const;
const HOUR_MS = 3_600_000;
const WINDOW_IDS: ReadonlySet<string> = new Set([
  "2025-Q1",
  "2025-Q2",
  "2025-Q3",
  "2025-Q4",
  "2026-Q1",
  "2026-Q2",
]);
export const DYDX_COVERAGE_GATE = Object.freeze({ minimumHourlyRatio: 0.9, minimumDailyRatio: 0.9 });
export const WINDOW_DEFS: Readonly<Record<WindowId, WindowDefinition>> = Object.freeze({
  "2025-Q1": quarter("2025-Q1"),
  "2025-Q2": quarter("2025-Q2"),
  "2025-Q3": quarter("2025-Q3"),
  "2025-Q4": quarter("2025-Q4"),
  "2026-Q1": quarter("2026-Q1"),
  "2026-Q2": quarter("2026-Q2"),
});

export function isWindowId(value: string): value is WindowId {
  return WINDOW_IDS.has(value);
}

function quarter(id: WindowId): WindowDefinition {
  const [yearText, quarterText] = id.split("-Q", 2);
  const year = Number(yearText);
  const quarterNumber = Number(quarterText);
  const month = (quarterNumber - 1) * 3;
  const start = new Date(Date.UTC(year, month, 1));
  const end = new Date(Date.UTC(year, month + 3, 0));
  const dayCount = Math.round((end.getTime() - start.getTime()) / DAY_MS) + 1;
  return {
    id,
    start,
    end,
    tardisDays: Array.from({ length: dayCount }, (_, offset) => new Date(start.getTime() + offset * DAY_MS)),
  };
}
function canonicalPositiveDecimal(raw: string, flag: string): string {
  try {
    const canonical = canonicalizeExternalDecimal(raw);
    const value = ExactRational.from(canonical);
    if (canonical !== raw || value.compare(ExactRational.from("0")) <= 0)
      throw new Error(`${flag} must be a canonical positive decimal`);
    return canonical;
  } catch {
    throw new Error(`${flag} must be a canonical positive decimal`);
  }
}
const DEFAULTS: CliArguments = {
  symbol: "btc",
  window: "2025-Q1",
  initialEquity: "10000",
  targetNotionalUsd: "250000",
  rebalanceCostBps: "20",
  withdrawalLatencyMinutes: "15",
  fundingCsvDir: path.resolve(process.cwd(), "data", "funding"),
  cacheDir: path.resolve(process.cwd(), ".cache", "tardis-dydx-v4"),
  outputPath: "backtest-results/phase25-2-dydx-vs-cex-funding-carry-{symbol}-{window}.json",
  skipTardisFetch: false,
};

export function parseCliArguments(argv: readonly string[]): CliArguments {
  const arguments_: { -readonly [Key in keyof CliArguments]: CliArguments[Key] } = { ...DEFAULTS };
  for (const argument of argv) {
    if (argument.startsWith("--symbol=")) {
      const value = argument.slice(9).toLowerCase();
      if (value !== "btc" && value !== "eth" && value !== "sol")
        throw new Error(`Invalid --symbol: ${value}`);
      arguments_.symbol = value;
      continue;
    }
    if (argument.startsWith("--window=")) {
      const value = argument.slice(9);
      if (!isWindowId(value)) throw new Error(`Invalid --window: ${value}`);
      arguments_.window = value;
      continue;
    }
    if (argument.startsWith("--equity=")) {
      arguments_.initialEquity = canonicalPositiveDecimal(argument.slice(9), "--equity");
      continue;
    }
    if (argument.startsWith("--notional=")) {
      arguments_.targetNotionalUsd = canonicalPositiveDecimal(argument.slice(11), "--notional");
      continue;
    }
    if (argument.startsWith("--rebalance-bps=")) {
      arguments_.rebalanceCostBps = canonicalPositiveDecimal(argument.slice(16), "--rebalance-bps");
      continue;
    }
    if (argument.startsWith("--latency=")) {
      arguments_.withdrawalLatencyMinutes = canonicalPositiveDecimal(argument.slice(10), "--latency");
      continue;
    }
    if (argument.startsWith("--funding-csv-dir=")) {
      arguments_.fundingCsvDir = path.resolve(argument.slice(18));
      continue;
    }
    if (argument.startsWith("--cache-dir=")) {
      arguments_.cacheDir = path.resolve(argument.slice(12));
      continue;
    }
    if (argument.startsWith("--output=")) {
      arguments_.outputPath = argument.slice(9);
      continue;
    }
    if (argument === "--skip-tardis-fetch") {
      arguments_.skipTardisFetch = true;
      continue;
    }
    throw new Error(`Unknown arg: ${argument}`);
  }
  return arguments_;
}

export function assessDydxCoverage(
  hourly: readonly DydxHourlyFunding[],
  startTime: number,
  endTimeExclusive: number,
): DydxCoverageStatus {
  const duration = endTimeExclusive - startTime;
  if (!Number.isFinite(duration) || duration <= 0)
    throw new Error("dYdX coverage interval must have a positive finite duration");
  const expectedHourlySlots = Math.ceil(duration / HOUR_MS);
  const expectedDays = Math.ceil(duration / DAY_MS);
  const hourlySlots = new Set<number>();
  const daySlots = new Set<number>();
  for (const row of hourly) {
    if (row.fundingTime < startTime || row.fundingTime >= endTimeExclusive) continue;
    hourlySlots.add(Math.floor((row.fundingTime - startTime) / HOUR_MS));
    daySlots.add(Math.floor((row.fundingTime - startTime) / DAY_MS));
  }
  const hourlyCoverageRatio = hourlySlots.size / expectedHourlySlots;
  const dailyCoverageRatio = daySlots.size / expectedDays;
  const reasons = [
    ...(hourlyCoverageRatio < DYDX_COVERAGE_GATE.minimumHourlyRatio
      ? ["hourly_coverage_below_threshold"]
      : []),
    ...(dailyCoverageRatio < DYDX_COVERAGE_GATE.minimumDailyRatio ? ["daily_coverage_below_threshold"] : []),
  ];
  const isSufficient = reasons.length === 0;
  return {
    status: isSufficient ? "SUFFICIENT" : "INSUFFICIENT",
    sufficient: isSufficient,
    expectedHourlySlots,
    observedHourlySlots: hourlySlots.size,
    hourlyCoverageRatio,
    expectedDays,
    observedDays: daySlots.size,
    dailyCoverageRatio,
    ...DYDX_COVERAGE_GATE,
    reasons,
  };
}

export async function loadCexFundingCsv(
  filePath: string,
  cexSymbol: string,
): Promise<readonly FundingSnapshot[]> {
  const loaded = await loadCexFundingCsvWithReceipt(filePath, cexSymbol);
  return loaded.snapshots;
}

export async function loadCexFundingCsvWithReceipt(
  filePath: string,
  cexSymbol: string,
): Promise<CexFundingCsvLoad> {
  const source = Bun.file(filePath);
  const bytes = new Uint8Array(await source.arrayBuffer());
  const raw = new TextDecoder().decode(bytes);
  const snapshots: FundingSnapshot[] = [];
  for (const [lineIndex, line] of raw.split("\n").entries()) {
    if (lineIndex === 0 || line === "") continue;
    const fields = line.split(",");
    const symbol = fields[1];
    if (symbol !== cexSymbol) continue;
    if (!hasCexFundingColumns(fields)) throw new Error("CEX selected-symbol row is incomplete");
    const [timestampText, , rateText, markPriceText] = fields;
    const fundingTime = cexTimestampMilliseconds(timestampText);
    try {
      const fundingRate = cexExactDecimal(rateText, "funding rate");
      const markPrice = markPriceText === "" ? undefined : cexExactDecimal(markPriceText, "mark price");
      snapshots.push({ fundingTime, symbol, fundingRate, ...(markPrice !== undefined && { markPrice }) });
    } catch {
      throw new Error("CEX selected-symbol row has invalid funding rate");
    }
  }
  return Object.freeze({
    sha256: createHash("sha256").update(bytes).digest("hex"),
    snapshots: Object.freeze(snapshots),
  });
}

function hasCexFundingColumns(fields: readonly string[]): fields is CexFundingColumns {
  return fields.length === 4;
}

function cexTimestampMilliseconds(value: string): number {
  try {
    if (!/^(0|[1-9]\d*)$/u.test(value)) throw new Error("invalid timestamp");
    const timestamp = BigInt(value);
    if (timestamp > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("unsafe timestamp");
    return Number(timestamp);
  } catch {
    throw new Error("CEX selected-symbol row has invalid timestamp");
  }
}

function cexExactDecimal(value: string, field: string): ExactRational {
  try {
    const canonical = canonicalizeExternalDecimal(value);
    if (canonical !== value) throw new Error("noncanonical");
    return ExactRational.from(canonical);
  } catch {
    throw new Error(`CEX selected-symbol row has invalid ${field}`);
  }
}

export async function loadDydxHourly(
  cacheDirectory: string,
  symbol: SymbolId,
  dates: readonly Date[],
  isSkipFetch: boolean,
  fetchPage?: TardisFetchPage,
): Promise<{
  readonly hourly: readonly DydxHourlyFunding[];
  readonly receipts: readonly TardisCacheReceipt[];
  readonly skippedDays: readonly string[];
}> {
  const fetcher = new TardisDydxFundingFetcher({
    cacheDir: cacheDirectory,
    cacheOnly: isSkipFetch,
    ...(fetchPage !== undefined && { fetchPage }),
  });
  const market: DydxMarket = symbol === "btc" ? "BTC-USD" : symbol === "eth" ? "ETH-USD" : "SOL-USD";
  const hourly: DydxHourlyFunding[] = [];
  const receipts: TardisCacheReceipt[] = [];
  const skippedDays: string[] = [];
  for (const date of dates) {
    const dayLabel = date.toISOString().slice(0, 10);
    try {
      const loaded = await fetcher.fetchDayWithReceipt(date, market);
      hourly.push(...loaded.hourly);
      receipts.push(loaded.receipt);
      console.log(`[tardis] ${symbol} ${dayLabel}: ${String(loaded.hourly.length)} hourly snapshots`);
    } catch (error: unknown) {
      if (error instanceof TardisCsvBoundaryError) throw error;
      const message = String(error);
      console.warn(
        isSkipFetch
          ? `[tardis] ${symbol} ${dayLabel}: SKIPPED (--skip-tardis-fetch): ${message}`
          : `[tardis] ${symbol} ${dayLabel}: FAILED ${message}`,
      );
      skippedDays.push(dayLabel);
    }
  }
  return Object.freeze({
    hourly: Object.freeze(hourly),
    receipts: Object.freeze(receipts),
    skippedDays: Object.freeze(skippedDays),
  });
}

function printCommandHelp(): void {
  console.log("run-dydx-vs-cex-funding-carry --symbol=btc|eth|sol --window=YYYY-QN");
}

function reportValue(value: unknown): unknown {
  if (value instanceof ExactRational) {
    const snapshot = value.toSnapshot();
    return `${snapshot.numerator}/${snapshot.denominator}`;
  }
  if (Array.isArray(value)) return value.map((entry) => reportValue(entry));
  if (typeof value !== "object" || value === null) return value;
  const entries: [string, unknown][] = [];
  for (const [key, entry] of Object.entries(value)) entries.push([key, reportValue(entry)]);
  return Object.fromEntries(entries);
}

export async function runDydxVsCexFundingCarryCommand(argv: readonly string[]): Promise<number> {
  try {
    if (argv.includes("--help") || argv.includes("-h")) {
      printCommandHelp();
      return 0;
    }
    const arguments_ = parseCliArguments(argv);
    const window = WINDOW_DEFS[arguments_.window];
    const endTime = window.end.getTime() + DAY_MS;
    const cexPath = path.resolve(arguments_.fundingCsvDir, `binance_${arguments_.symbol}usdt_funding_8h.csv`);
    const cexInput = await loadCexFundingCsvWithReceipt(cexPath, SYMBOL_TO_CEX[arguments_.symbol]);
    const cex = cexInput.snapshots.filter(
      (row) => row.fundingTime >= window.start.getTime() && row.fundingTime < endTime,
    );
    if (cex.length === 0)
      throw new Error(
        `No CEX funding data for ${arguments_.symbol} in ${arguments_.window}. Check ${cexPath}.`,
      );
    const loaded = await loadDydxHourly(
      arguments_.cacheDir,
      arguments_.symbol,
      window.tardisDays,
      arguments_.skipTardisFetch,
    );
    const dydx = loaded.hourly.filter(
      (row) => row.fundingTime >= window.start.getTime() && row.fundingTime < endTime,
    );
    const coverage = assessDydxCoverage(dydx, window.start.getTime(), endTime);
    if (!coverage.sufficient) {
      console.error("[dydx-vs-cex] INSUFFICIENT_COVERAGE:", coverage.reasons);
      return 2;
    }
    const result = simulateDydxVsCexCarry({
      dydxHourly: dydx,
      cex8h: cex,
      startTime: window.start.getTime(),
      endTime,
      initialEquity: arguments_.initialEquity,
      targetNotionalUsd: arguments_.targetNotionalUsd,
      rebalanceCostBps: arguments_.rebalanceCostBps,
      withdrawalLatencyMinutes: arguments_.withdrawalLatencyMinutes,
      normalizedMetricsAllowed: coverage.sufficient,
    });
    const dataProvenance = Object.freeze({
      cexFundingSha256: cexInput.sha256,
      dydxDayReceipts: loaded.receipts,
    });
    const output = Object.freeze({
      arguments_,
      dataProvenance,
      result,
      coverage,
      skippedTardisDays: loaded.skippedDays,
      dydxHourlyCount: dydx.length,
      cex8hCount: cex.length,
      windowDays: (endTime - window.start.getTime()) / DAY_MS,
      fetchedAt: new Date().toISOString(),
    });
    const outputPath = arguments_.outputPath
      .split("{symbol}")
      .join(arguments_.symbol)
      .split("{window}")
      .join(arguments_.window);
    const absolutePath = path.resolve(process.cwd(), outputPath);
    await Bun.write(absolutePath, JSON.stringify(reportValue(output), undefined, 2));
    return 0;
  } catch (error: unknown) {
    console.error("[dydx-vs-cex] FATAL:", error);
    return 1;
  }
}
