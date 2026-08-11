import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { runBacktest, runWalkForward, type BacktestResult, type CostModel } from "@mm-crypto-bot/backtest";
import { DonchianPivotComposition, DEFAULT_DONCHIAN_PIVOT_COMPOSITION_CONFIG } from "@mm-crypto-bot/core";
import { makeSymbol } from "@mm-crypto-bot/shared/types";

import { CsvExchangeFeed } from "../data/csv-feed.js";

export interface WorkflowArgs {
  readonly symbol: string;
  readonly startTime: Date;
  readonly endTime: Date;
  readonly initialEquityUsd: number;
  readonly dataDir: string;
  readonly output: string;
}

export const COST_MODEL: CostModel = {
  takerFeeRate: 0.001,
  slippageRate: 0.0005,
  spreadRate: 0.0002,
  borrowRatePerHour: 0.0001,
  fundingRatePer8h: 0,
};

const ROOT = resolve(import.meta.dir, "..", "..", "..", "..");

export function parseWorkflowArgs(argv: readonly string[], defaultOutput: string): WorkflowArgs {
  let symbol = "BTC/USDT";
  let startTime = new Date(Date.UTC(2024, 0, 1));
  let endTime = new Date();
  let initialEquityUsd = 10_000;
  let dataDir = resolve(ROOT, "data", "ohlcv");
  let output = defaultOutput;
  for (const arg of argv) {
    if (arg.startsWith("--symbol=")) symbol = arg.slice("--symbol=".length);
    else if (arg.startsWith("--start=")) startTime = new Date(arg.slice("--start=".length));
    else if (arg.startsWith("--end=")) endTime = new Date(arg.slice("--end=".length));
    else if (arg.startsWith("--equity=")) initialEquityUsd = Number(arg.slice("--equity=".length));
    else if (arg.startsWith("--data-dir=")) dataDir = resolve(arg.slice("--data-dir=".length));
    else if (arg.startsWith("--output=")) output = arg.slice("--output=".length);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (Number.isNaN(startTime.getTime()) || Number.isNaN(endTime.getTime()) || startTime >= endTime) {
    throw new Error("--start and --end must be valid dates with start before end");
  }
  if (!Number.isFinite(initialEquityUsd) || initialEquityUsd <= 0) {
    throw new Error("--equity must be a positive number");
  }
  return { symbol, startTime, endTime, initialEquityUsd, dataDir, output };
}

export async function runCompositionBacktest(
  args: WorkflowArgs,
  maxPositionPctEquity = 0.2,
): Promise<BacktestResult> {
  return runBacktest({
    symbol: makeSymbol(args.symbol),
    htfTimeframe: "1d",
    mtfTimeframe: "4h",
    ltfTimeframe: "15m",
    startTime: args.startTime,
    endTime: args.endTime,
    initialEquityUsd: args.initialEquityUsd,
    feed: new CsvExchangeFeed(args.dataDir),
    costModel: COST_MODEL,
    positionSize: {
      riskPerTrade: 0.01,
      kellyFraction: 0.25,
      maxDrawdown: 0.15,
      maxPositionPctEquity,
      minPositionPctEquity: 0.01,
    },
    strategy: new DonchianPivotComposition(DEFAULT_DONCHIAN_PIVOT_COMPOSITION_CONFIG, "15m"),
  });
}

export async function runCompositionWalkForward(
  args: WorkflowArgs,
  inSampleDays: number,
  outOfSampleDays: number,
  stepDays: number,
) {
  const feed = new CsvExchangeFeed(args.dataDir);
  return runWalkForward({
    symbol: makeSymbol(args.symbol),
    htfTimeframe: "1d",
    mtfTimeframe: "4h",
    ltfTimeframe: "15m",
    startTime: args.startTime,
    endTime: args.endTime,
    initialEquityUsd: args.initialEquityUsd,
    feed,
    costModel: COST_MODEL,
    positionSize: {
      riskPerTrade: 0.01,
      kellyFraction: 0.25,
      maxDrawdown: 0.15,
      maxPositionPctEquity: 0.2,
      minPositionPctEquity: 0.01,
    },
    strategy: new DonchianPivotComposition(DEFAULT_DONCHIAN_PIVOT_COMPOSITION_CONFIG, "15m"),
  }, { inSampleDays, outOfSampleDays, stepDays });
}

export async function writeWorkflowOutput(output: string, value: unknown): Promise<void> {
  const outputPath = resolve(ROOT, output);
  await mkdir(resolve(outputPath, ".."), { recursive: true });
  await writeFile(outputPath, JSON.stringify(value, null, 2), "utf8");
}

export function workflowHelp(name: string, extra: readonly string[] = []): string {
  return [
    `${name} — historical Donchian/Pivot backtest workflow`,
    "",
    "Common flags:",
    "  --symbol=BTC/USDT       Market symbol (default: BTC/USDT)",
    "  --start=ISO_DATE        Completed candle must open >= start (default: 2024-01-01 UTC)",
    "  --end=ISO_DATE          Completed candle must close <= end (default: now)",
    "  --equity=10000          Initial USD equity",
    "  --data-dir=PATH         OHLCV CSV directory",
    "  --output=PATH           JSON output path",
    ...extra,
  ].join("\n");
}
