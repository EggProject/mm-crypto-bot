#!/usr/bin/env bun

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  DEFAULT_SOL_FLIP_KILL_SWITCH_PLUGIN_CONFIG,
  SignalBus,
  SOLFlipKillSwitchPlugin,
  type RiskSignal,
  type SOLFlipKillSwitchPluginConfig,
} from "@mm-crypto-bot/core";

const FUNDING_INTERVAL_MS = 8 * 60 * 60 * 1000;

export interface FundingRow {
  readonly fundingTime: number;
  readonly symbol: string;
  readonly fundingRate: number;
  readonly markPrice: number | null;
}

export interface SolFlipCliArgs {
  readonly inputPath: string;
  readonly outputPath: string;
  readonly startTime: Date;
  readonly endTime: Date;
  readonly pluginConfig: SOLFlipKillSwitchPluginConfig;
}

function positiveNumber(flag: string, raw: string, allowZero = false): number {
  const value = Number(raw);
  if (!Number.isFinite(value) || (allowZero ? value < 0 : value <= 0)) {
    throw new Error(`${flag} must be ${allowZero ? "non-negative" : "positive"}, got: ${raw}`);
  }
  return value;
}

export function parseArgs(argv: readonly string[] = process.argv.slice(2)): SolFlipCliArgs {
  let inputPath = resolve(process.cwd(), "data", "funding", "binance_solusdt_funding_8h.csv");
  let outputPath = "backtest-results/sol-flip-funding-replay.json";
  let startTime = new Date(Date.UTC(2024, 0, 1));
  let endTime = new Date();
  let pluginConfig: SOLFlipKillSwitchPluginConfig = {
    ...DEFAULT_SOL_FLIP_KILL_SWITCH_PLUGIN_CONFIG,
    enabledSymbols: ["SOL/USDT"],
  };

  for (const arg of argv) {
    const [flag, raw = ""] = arg.split("=", 2);
    switch (flag) {
      case "--input":
        inputPath = resolve(raw);
        break;
      case "--output":
        outputPath = raw;
        break;
      case "--start":
        startTime = new Date(raw);
        break;
      case "--end":
        endTime = new Date(raw);
        break;
      case "--sign-flip-window-days":
        pluginConfig = { ...pluginConfig, signFlipWindowDays: positiveNumber(flag, raw) };
        break;
      case "--extreme-sigma-threshold":
        pluginConfig = { ...pluginConfig, extremeSigmaThreshold: positiveNumber(flag, raw, true) };
        break;
      case "--persistence-days":
        pluginConfig = { ...pluginConfig, persistenceDays: positiveNumber(flag, raw, true) };
        break;
      case "--vol-window-days":
        pluginConfig = { ...pluginConfig, volWindowDays: positiveNumber(flag, raw) };
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!Number.isFinite(startTime.getTime()) || !Number.isFinite(endTime.getTime()) || startTime >= endTime) {
    throw new Error("--start and --end must define a valid increasing interval");
  }
  return { inputPath, outputPath, startTime, endTime, pluginConfig };
}

export function parseFundingCsv(raw: string): readonly FundingRow[] {
  const rows: FundingRow[] = [];
  const lines = raw.split("\n");
  for (let index = 1; index < lines.length; index++) {
    const line = lines[index];
    if (line === undefined || line.trim() === "") continue;
    const parts = line.split(",");
    if (parts.length < 3) continue;
    const fundingTime = Number(parts[0]);
    const symbol = parts[1] ?? "";
    const fundingRate = Number(parts[2]);
    const markRaw = parts[3];
    if (!Number.isFinite(fundingTime) || !Number.isFinite(fundingRate) || symbol !== "SOLUSDT") continue;
    rows.push({
      fundingTime,
      symbol,
      fundingRate,
      markPrice:
        markRaw !== undefined && markRaw !== "" && Number.isFinite(Number(markRaw)) ? Number(markRaw) : null,
    });
  }
  return rows.sort((a, b) => a.fundingTime - b.fundingTime);
}

export function replayFunding(
  rows: readonly FundingRow[],
  config: SOLFlipKillSwitchPluginConfig,
): {
  readonly metrics: Record<string, number | boolean | null>;
  readonly finalDetectorMetrics: SOLFlipKillSwitchPlugin["state"]["lastMetrics"];
  readonly finalRegime: SOLFlipKillSwitchPlugin["state"]["lastRegime"];
  readonly riskEvents: readonly RiskSignal[];
} {
  const bus = new SignalBus({ mode: "backtest" });
  const plugin = new SOLFlipKillSwitchPlugin(config);
  plugin.subscribe(bus);
  let regimeActiveSnapshots = 0;
  let flipRegimeSnapshots = 0;
  let negativeDominanceSnapshots = 0;
  let extremeRegimeSnapshots = 0;
  let positiveSamples = 0;
  let negativeSamples = 0;
  let zeroSamples = 0;
  let rawSignFlips = 0;
  let previousNonZeroRate: number | null = null;
  let absRateSum = 0;
  let maxAbsRate = 0;

  for (const row of rows) {
    if (row.fundingRate > 0) positiveSamples += 1;
    else if (row.fundingRate < 0) negativeSamples += 1;
    else zeroSamples += 1;
    if (row.fundingRate !== 0) {
      if (previousNonZeroRate !== null && previousNonZeroRate > 0 !== row.fundingRate > 0) rawSignFlips += 1;
      previousNonZeroRate = row.fundingRate;
    }
    const absRate = Math.abs(row.fundingRate);
    absRateSum += absRate;
    maxAbsRate = Math.max(maxAbsRate, absRate);
    const decision = plugin.recordFundingSample("SOL/USDT", row.fundingRate, row.fundingTime);
    if (decision.regimeActive) regimeActiveSnapshots += 1;
    if (decision.flipRegime) flipRegimeSnapshots += 1;
    if (decision.negativeDominanceRegime) negativeDominanceSnapshots += 1;
    if (decision.extremeRegime) extremeRegimeSnapshots += 1;
  }

  const riskEvents = bus.snapshot().filter((signal): signal is RiskSignal => signal.kind === "risk");
  const lastTimestamp = rows[rows.length - 1]?.fundingTime ?? 0;
  const metrics = {
    sampleCount: rows.length,
    positiveSamples,
    negativeSamples,
    zeroSamples,
    rawSignFlips,
    meanAbsFundingRate: rows.length > 0 ? absRateSum / rows.length : 0,
    maxAbsFundingRate: maxAbsRate,
    regimeActiveSnapshots,
    regimeActiveRatio: rows.length > 0 ? regimeActiveSnapshots / rows.length : 0,
    flipRegimeSnapshots,
    negativeDominanceSnapshots,
    extremeRegimeSnapshots,
    regimeActivationCount: plugin.state.regimeActivationCount,
    regimeDeactivationCount: plugin.state.regimeDeactivationCount,
    carryPausedFundingPeriods: plugin.state.carryPausedFundingPeriods,
    riskSignalCount: plugin.state.riskSignalCount,
    riskSignalBreachCount: plugin.state.riskSignalBreachCount,
    leverageAssertionCount: plugin.state.leverageAssertionCount,
    finalKillSwitchEngaged: rows.length > 0 ? plugin.isKillSwitchEngaged(lastTimestamp) : false,
    pnlUsd: null,
    totalReturn: null,
    annualizedReturn: null,
    sharpeRatio: null,
    maxDrawdown: null,
    profitFactor: null,
  };
  const result = {
    metrics,
    finalDetectorMetrics: plugin.state.lastMetrics,
    finalRegime: plugin.state.lastRegime,
    riskEvents,
  };
  plugin.dispose();
  return result;
}

export async function main(): Promise<void> {
  const args = parseArgs();
  const allRows = parseFundingCsv(await readFile(args.inputPath, "utf8"));
  const rows = allRows.filter(
    (row) => row.fundingTime >= args.startTime.getTime() && row.fundingTime < args.endTime.getTime(),
  );
  if (rows.length === 0)
    throw new Error(`No real SOLUSDT funding rows in requested interval: ${args.inputPath}`);
  const replay = replayFunding(rows, args.pluginConfig);
  const expectedSlots = Math.ceil((args.endTime.getTime() - args.startTime.getTime()) / FUNDING_INTERVAL_MS);
  const coverageRatio = rows.length / expectedSlots;
  const output = {
    args,
    plugin: "sol-flip-kill-switch",
    pluginRole: "defensive_risk_overlay",
    pnlApplicability: {
      applicable: false,
      reason: "SOLFlip is a defensive funding-regime overlay, not a standalone alpha or position owner",
    },
    data: {
      sourceKind: "downloaded_binance_funding_csv",
      synthetic: false,
      path: args.inputPath,
      expectedCadenceHours: 8,
      sampleCount: rows.length,
      expectedSlots,
      coverageRatio,
      firstFundingTime: rows[0]?.fundingTime ?? null,
      lastFundingTime: rows[rows.length - 1]?.fundingTime ?? null,
    },
    ...replay,
    generatedAt: new Date().toISOString(),
  };
  const absOutput = resolve(process.cwd(), args.outputPath);
  await mkdir(resolve(absOutput, ".."), { recursive: true });
  await writeFile(absOutput, JSON.stringify(output, null, 2), "utf8");
  console.log(
    `[sol-flip] real Binance funding rows=${rows.length} coverage=${(coverageRatio * 100).toFixed(2)}%`,
  );
  console.log(
    `[sol-flip] activations=${replay.metrics["regimeActivationCount"]} riskEvents=${replay.riskEvents.length}`,
  );
  console.log(`[sol-flip] PnL/DD: N/A (defensive overlay, not standalone alpha)`);
  console.log(`[sol-flip] Saved: ${absOutput}`);
}

export function handleFatal(error: unknown): void {
  console.error("[sol-flip] FATAL:", error);
  process.exitCode = 1;
}

if (import.meta.main) {
  main().catch(handleFatal);
}
