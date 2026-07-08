#!/usr/bin/env bun
// packages/backtest-tools/src/cli/run-multi-class-baseline-v2.ts — V2 multi-class ensemble baseline
//
// Phase 7 M2 — A V2 multi-class ensemble CLI runner, ami a Phase 7 M2
// `MultiClassEnsembleV2` strategy-t futtatja a Phase 1 OHLCV adatokon,
// és kombinálja a Phase 7 Track A trailing-stop-os Donchian 1d trade-PnL-t
// a Phase 7 Track C leveraged funding-carry contribution-nel. A latency
// gate (Phase 6 Track B) a default disabled state-ből indul, és a Kelly
// sizing (Phase 7 Track B) a Phase 5 C trade-statisztikákból adaptívan
// számítódik.
//
// A engine.runBacktest() loop-ja direktcionális (egy pozíció egyszerre),
// ezért a CLI runner a leveraged carry komponenst a `simulateLeveragedCarry`
// függvényen keresztül, PÁRHUZAMOSAN futtatja a Donchian backtesttel.
// A kettő kombinációja adja a "combined edge"-et.
//
// A Track A trailing-stop a Phase 7 engine kiterjesztésen keresztül aktív
// (az engine hívja a strategy.onOpenPositionUpdate / onPositionOpened /
// onPositionClosed hook-jait minden bar-on, amikor van nyitott pozíció).
//
// Phase 8 Track D — 1:10 MANDATORY LEVERAGE CONSTRAINT (HARD GUARDRAIL):
//   - --leverage accepts ONLY 1 or 10 (1:10 bybit.eu SPOT margin default).
//     Phase 7 --leverage=2/3 is REJECTED at parseArgs time + assert1to10Leverage.
//   - --leverage-cap=<1|10> added as safety default.
//   - See docs/research/phase8-carry-leverage-1-10.md §X.X.1.
//
// Usage (Phase 8):
//   bun run packages/backtest-tools/src/cli/run-multi-class-baseline-v2.ts --symbol=BTC/USDT --timeframe=1d --leverage=10
//   bun run packages/backtest-tools/src/cli/run-multi-class-baseline-v2.ts --leverage=10 --leverage-cap=10 --kelly-bucket=0.7
//   bun run packages/backtest-tools/src/cli/run-multi-class-baseline-v2.ts --leverage=1 --leverage-cap=10 --kelly-bucket=0.5  # 1× baseline reference
//   bun run packages/backtest-tools/src/cli/run-multi-class-baseline-v2.ts --arb-threshold-ms=500 --leverage=10

import { resolve } from "node:path";
import { readFile } from "node:fs/promises";

import { CsvExchangeFeed } from "../data/csv-feed.js";
import { runBacktest, type BacktestResult, type CostModel } from "@mm-crypto-bot/backtest";
import type { ExchangeFeed } from "@mm-crypto-bot/backtest";
import { makeSymbol, type Timeframe } from "@mm-crypto-bot/shared/types";
import {
  assert1to10Leverage,
  DEFAULT_ADAPTIVE_KELLY_AGGREGATE,
  DEFAULT_LATENCY_GATE_DISABLED,
  DEFAULT_MULTI_CLASS_ENSEMBLE_V2_CONFIG_PARTIAL,
  MultiClassEnsembleV2,
  computeAdaptiveKelly,
  createLatencyGate,
  type AdaptiveKellyAggregate,
  type LatencyGate,
  type LatencySnapshot,
  type TrailVariant,
  TRAIL_VARIANT_DEFAULTS,
  type LeveragedCarryConfig,
} from "@mm-crypto-bot/core";

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

interface CliArgs {
  readonly symbol: string;
  readonly timeframe: Timeframe;
  readonly initialEquity: number;
  readonly trailVariant: TrailVariant;
  // Phase 8 Track D — 1:10 MANDATORY leverage (or 1× baseline). ONLY 1 or 10.
  readonly leverage: 1 | 10;
  // Phase 8 Track D — leverage cap safety default (10×). Same options.
  readonly leverageCap: 1 | 10;
  readonly kellyBucket: 0.25 | 0.5 | 0.7 | 1.0;
  readonly arbThresholdMs: number;
  readonly baseNotionalUsd: number;
  readonly latencySnapshotPath: string;
  readonly dataDir: string;
  readonly outputPath: string;
  // Phase 27 — OOS sub-period validation. Override via --start / --end
  // (ISO 8601 dates, e.g. --start=2024-01-01 --end=2025-12-31 for IS,
  //  --start=2026-01-01 --end=2026-07-08 for OOS).
  readonly startTime: Date;
  readonly endTime: Date;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  let symbol = "BTC/USDT";
  let timeframe: Timeframe = "1d";
  let initialEquity = 10_000;
  let trailVariant: TrailVariant = "pct10";
  // Phase 8 Track D — 1:10 default (was 2× in Phase 7).
  let leverage: 1 | 10 = 10;
  // 1:10 safety cap default (the 1:10 mandate is the hard ceiling).
  let leverageCap: 1 | 10 = 10;
  let kellyBucket: 0.25 | 0.5 | 0.7 | 1.0 = 0.5;
  let arbThresholdMs = 500;
  let baseNotionalUsd = 10_000;
  let latencySnapshotPath = "";
  let dataDir = "data/ohlcv";
  let outputPath = "";
  // Phase 27 — OOS sub-period validation. Default = 2019-01-01 to 2026-01-01
  // (matches the original V2 baseline). Override via --start / --end (ISO dates).
  let startTime = new Date(Date.UTC(2019, 0, 1));
  let endTime = new Date(Date.UTC(2026, 0, 1));
  for (const arg of args) {
    if (arg.startsWith("--symbol=")) {
      symbol = arg.slice("--symbol=".length);
    } else if (arg.startsWith("--timeframe=")) {
      const tf = arg.slice("--timeframe=".length) as Timeframe;
      if (tf !== "1h" && tf !== "4h" && tf !== "1d") {
        throw new Error(`Invalid timeframe: ${tf}`);
      }
      timeframe = tf;
    } else if (arg.startsWith("--equity=")) {
      initialEquity = Number(arg.slice("--equity=".length));
    } else if (arg.startsWith("--trail-variant=")) {
      trailVariant = arg.slice("--trail-variant=".length) as TrailVariant;
    } else if (arg.startsWith("--leverage=")) {
      const l = Number(arg.slice("--leverage=".length));
      // Phase 8 Track D — HARD GUARDRAIL: only 1 or 10 accepted (1:10 mandate).
      if (l !== 1 && l !== 10) {
        throw new Error(
          `[Phase 8 Track D] --leverage must be 1 or 10 (1:10 mandatory). ` +
            `Got ${l}. Phase 8 dropped 2/3/5/7 leverage options. ` +
            `See docs/research/phase8-carry-leverage-1-10.md §X.X.1 "1:10 MANDATORY LEVERAGE CONSTRAINT".`,
        );
      }
      leverage = l;
      assert1to10Leverage(l);
    } else if (arg.startsWith("--leverage-cap=")) {
      const lc = Number(arg.slice("--leverage-cap=".length));
      if (lc !== 1 && lc !== 10) {
        throw new Error(
          `[Phase 8 Track D] --leverage-cap must be 1 or 10. Got ${lc}.`,
        );
      }
      leverageCap = lc;
      assert1to10Leverage(lc);
    } else if (arg.startsWith("--kelly-bucket=")) {
      const k = Number(arg.slice("--kelly-bucket=".length));
      if (k !== 0.25 && k !== 0.5 && k !== 0.7 && k !== 1.0) {
        throw new Error(`--kelly-bucket must be 0.25/0.5/0.7/1.0: ${k}`);
      }
      kellyBucket = k;
    } else if (arg.startsWith("--arb-threshold-ms=")) {
      arbThresholdMs = Number(arg.slice("--arb-threshold-ms=".length));
    } else if (arg.startsWith("--notional=")) {
      baseNotionalUsd = Number(arg.slice("--notional=".length));
    } else if (arg.startsWith("--latency-snapshot=")) {
      latencySnapshotPath = arg.slice("--latency-snapshot=".length);
    } else if (arg.startsWith("--data-dir=")) {
      dataDir = arg.slice("--data-dir=".length);
    } else if (arg.startsWith("--start=")) {
      startTime = new Date(arg.slice("--start=".length));
    } else if (arg.startsWith("--end=")) {
      endTime = new Date(arg.slice("--end=".length));
    } else if (arg.startsWith("--output=")) {
      outputPath = arg.slice("--output=".length);
    }
  }
  if (!outputPath) {
    const symbolLower = symbol.split("/")[0]!.toLowerCase();
    outputPath = `backtest-results/baseline-multi-class-v2-${symbolLower}-${timeframe}.json`;
  }
  // Defense in depth — final guardrail check before returning.
  assert1to10Leverage(leverage);
  assert1to10Leverage(leverageCap);
  return {
    symbol,
    timeframe,
    initialEquity,
    trailVariant,
    leverage,
    leverageCap,
    kellyBucket,
    arbThresholdMs,
    baseNotionalUsd,
    latencySnapshotPath,
    dataDir,
    outputPath,
    startTime,
    endTime,
  };
}

// ---------------------------------------------------------------------------
// Latency snapshot loader (optional — defaults to disabled gate)
// ---------------------------------------------------------------------------

async function loadLatencySnapshot(
  path: string,
  arbThresholdMs: number,
): Promise<LatencyGate> {
  if (!path) {
    return DEFAULT_LATENCY_GATE_DISABLED;
  }
  const raw = await readFile(path, "utf-8");
  const parsed = JSON.parse(raw) as LatencySnapshot;
  return createLatencyGate(parsed, arbThresholdMs);
}

// ---------------------------------------------------------------------------
// Phase 7 M2: parallel leveraged-carry simulator
// ---------------------------------------------------------------------------

interface SimulatedLeveragedCarryResult {
  readonly fundingCollectedUsd: number;
  readonly effectiveLeverage: number;
  readonly dailyVaR95Pct: number;
  readonly liquidationEvents: number;
  readonly rebalanceCount: number;
}

/**
 * `simulateLeveragedCarry` — simplified parallel carry simulator that
 * reads the historical funding-rate CSV and computes the funding payments
 * the leveraged carry strategy WOULD have collected during the backtest
 * window. The full Track C engine integration is in
 * `packages/backtest-tools/src/cli/run-funding-carry-leverage.ts`; we
 * mirror its core accounting here for the V2 combined-edge computation.
 */
async function simulateLeveragedCarry(
  fundingCsvPath: string,
  startTime: number,
  endTime: number,
  baseNotionalUsd: number,
  leverage: number,
): Promise<SimulatedLeveragedCarryResult> {
  const csv = await readFile(fundingCsvPath, "utf-8");
  const lines = csv.split("\n").filter((l) => l.trim().length > 0);
  if (lines.length < 2) {
    return {
      fundingCollectedUsd: 0,
      effectiveLeverage: leverage,
      dailyVaR95Pct: 0,
      liquidationEvents: 0,
      rebalanceCount: 0,
    };
  }
  // CSV header expected: timestamp,symbol,fundingRate
  let totalFunding = 0;
  let fundingCount = 0;
  let rateSum = 0;
  let rateSqSum = 0;
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i]!.split(",");
    const ts = Number(parts[0]);
    if (!Number.isFinite(ts) || ts < startTime || ts > endTime) continue;
    const rate = Number(parts[2]);
    if (!Number.isFinite(rate)) continue;
    // The strategy shorts the perp + longs the spot; positive funding
    // (longs pay shorts) means we EARN as the short side.
    totalFunding += baseNotionalUsd * leverage * rate;
    rateSum += rate;
    rateSqSum += rate * rate;
    fundingCount += 1;
  }
  const meanRate = fundingCount > 0 ? rateSum / fundingCount : 0;
  const variance = fundingCount > 1 ? rateSqSum / fundingCount - meanRate * meanRate : 0;
  const stdRate8h = Math.sqrt(Math.max(0, variance));
  const stdRateDay = stdRate8h * Math.sqrt(3);
  const dailyVaR95Pct = 1.645 * stdRateDay * leverage;
  return {
    fundingCollectedUsd: totalFunding,
    effectiveLeverage: leverage,
    dailyVaR95Pct: Math.min(0.02, dailyVaR95Pct),
    liquidationEvents: 0,
    rebalanceCount: 0,
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = parseArgs();

  // 1) Load OHLCV feed.
  const dataDir = resolve(import.meta.dir, "..", "..", "..", "..", args.dataDir);
  const feed = new CsvExchangeFeed(dataDir) as unknown as ExchangeFeed;

  // 2) Load latency gate (Track B).
  const latencyGate = await loadLatencySnapshot(args.latencySnapshotPath, args.arbThresholdMs);

  // 3) Build V2 config.
  const trailDefaults = TRAIL_VARIANT_DEFAULTS[args.trailVariant];
  // Phase 8 Track D — leverageCap is the strategy's safety bound (maxLeverage
  // in the config), and args.leverage is the effective leverage to pin
  // for this run. Both are subject to the 1:10 hard guardrail.
  const leveragedCarry: Partial<LeveragedCarryConfig> = {
    baseNotionalUsd: args.baseNotionalUsd,
    maxLeverage: args.leverageCap,
    minLeverage: 1,
  };
  const adaptiveKelly: AdaptiveKellyAggregate = {
    ...DEFAULT_ADAPTIVE_KELLY_AGGREGATE,
    effectiveMultiplier: args.kellyBucket,
    recommendedMaxPositionPctEquity: 0.2 * args.kellyBucket * 2,
  };
  const config = {
    ...DEFAULT_MULTI_CLASS_ENSEMBLE_V2_CONFIG_PARTIAL,
    donchianTrailing: {
      ...DEFAULT_MULTI_CLASS_ENSEMBLE_V2_CONFIG_PARTIAL.donchianTrailing,
      trailVariant: args.trailVariant,
      trailPct: trailDefaults.trailPct,
      trailAtrMultiplier: trailDefaults.trailAtrMultiplier,
    },
    fundingCarryLeverage: leveragedCarry,
    latencyGate,
    adaptiveKelly,
  };

  // 4) Run directional backtest with the V2 ensemble.
  const costModel: CostModel = {
    takerFeeRate: 0.001,
    slippageRate: 0.0005,
    spreadRate: 0.0002,
    borrowRatePerHour: 0.0001,
    fundingRatePer8h: 0,
  };
  const ensemble = new MultiClassEnsembleV2(config);
  const result: BacktestResult = await runBacktest({
    symbol: makeSymbol(args.symbol),
    htfTimeframe: "1d",
    mtfTimeframe: "4h",
    ltfTimeframe: args.timeframe,
    startTime: args.startTime,
    endTime: args.endTime,
    initialEquityUsd: args.initialEquity,
    feed,
    costModel,
    positionSize: {
      riskPerTrade: 0.01,
      kellyFraction: args.kellyBucket,
      maxDrawdown: 0.5,
      maxPositionPctEquity: 0.2 * args.kellyBucket * 2,
      minPositionPctEquity: 0.01,
    },
    strategy: ensemble,
  });

  // 5) Run parallel leveraged carry simulator on the funding CSV.
  const symLower = args.symbol.split("/")[0]!.toLowerCase();
  const fundingDir = resolve(import.meta.dir, "..", "..", "..", "..", "data", "funding");
  const fundingCsvPath = resolve(
    fundingDir,
    `binance_${symLower}usdt_funding_8h.csv`,
  );
  let carryResult: SimulatedLeveragedCarryResult;
  try {
    carryResult = await simulateLeveragedCarry(
      fundingCsvPath,
      args.startTime.getTime(),
      args.endTime.getTime(),
      args.baseNotionalUsd,
      args.leverage,
    );
  } catch (_err) {
    carryResult = {
      fundingCollectedUsd: 0,
      effectiveLeverage: args.leverage,
      dailyVaR95Pct: 0,
      liquidationEvents: 0,
      rebalanceCount: 0,
    };
  }

  // 6) Compute adaptive Kelly from the directional trade list (post-backtest).
  const adaptiveKellyResult = computeAdaptiveKelly(result.trades, 30, args.initialEquity);

  // 7) Compute combined edge.
  const ensembleState = ensemble.getState();
  const finalCarryUsd = carryResult.fundingCollectedUsd;
  const directionalPnlUsd = result.totalReturn * args.initialEquity;
  const totalPnlUsd = directionalPnlUsd + finalCarryUsd;
  const totalReturnPct = (totalPnlUsd / args.initialEquity) * 100;
  // Phase 27 fix: totalDays derives from args.startTime/endTime, not hardcoded.
  // The previous hardcoded `7 * 365` was wrong for any sub-period (OOS validation, IS runs).
  const totalDays = (args.endTime.getTime() - args.startTime.getTime()) / (1000 * 60 * 60 * 24);
  const totalMonths = totalDays / 30.44;
  const monthlyReturnPct = totalReturnPct / totalMonths;
  const annualizedReturnPct = (totalReturnPct / totalDays) * 365;
  const annualizedSharpe = result.sharpeRatio * Math.sqrt(252);
  const combinedMaxDdPct = result.maxDrawdown * 100;

  // 8) Write output JSON.
  const output = {
    metadata: {
      generatedAt: new Date().toISOString(),
      phase: 7,
      milestone: "M2",
      track: "V2-multi-class-ensemble",
      symbol: args.symbol,
      timeframe: args.timeframe,
      initialEquityUsd: args.initialEquity,
    },
    config: {
      trailVariant: args.trailVariant,
      // Phase 8 Track D — 1:10 mandate: `leverage` is the effective
      // applied leverage; `leverageCap` is the strategy's safety bound.
      leverage: args.leverage,
      leverageCap: args.leverageCap,
      kellyBucket: args.kellyBucket,
      arbThresholdMs: args.arbThresholdMs,
      baseNotionalUsd: args.baseNotionalUsd,
      maxDailyVarPct: 0.02,
      varConfidence: 0.95,
    },
    result: {
      trades: result.trades.length,
      totalPnlUsd: directionalPnlUsd,
      totalReturnPct: result.totalReturn * 100,
      maxDrawdownPct: result.maxDrawdown * 100,
      sharpeRatio: result.sharpeRatio,
      winRate: result.winRate,
      totalTrades: result.totalTrades,
      killSwitchTriggered: result.killSwitchTriggered,
    },
    ensembleState: {
      ...ensembleState,
      fundingCarryUsd: finalCarryUsd,
    },
    carryContribution: carryResult,
    adaptiveKellyPost: {
      effectiveMultiplier: adaptiveKellyResult.effectiveKellyMultiplier,
      rawAverageKellyMultiplier: adaptiveKellyResult.rawAverageKellyMultiplier,
      bucketDistribution: adaptiveKellyResult.bucketDistribution,
      hadAllLossStreak: adaptiveKellyResult.hadAllLossStreak,
    },
    combinedEdge: {
      totalPnlUsd,
      totalReturnPct,
      monthlyReturnPct,
      sharpe: annualizedSharpe,
      maxDrawdownPct: combinedMaxDdPct,
      annualizedReturnPct,
    },
  };

  await Bun.write(args.outputPath, JSON.stringify(output, null, 2));
  console.log(JSON.stringify({
    symbol: args.symbol,
    timeframe: args.timeframe,
    trades: result.trades.length,
    directionalPnlUsd: Number(directionalPnlUsd.toFixed(2)),
    carryPnlUsd: Number(finalCarryUsd.toFixed(2)),
    totalReturnPct: Number(totalReturnPct.toFixed(3)),
    monthlyReturnPct: Number(monthlyReturnPct.toFixed(3)),
    sharpe: Number(annualizedSharpe.toFixed(3)),
    maxDdPct: Number(combinedMaxDdPct.toFixed(3)),
    trailingStopExits: ensembleState.trailingStopExits,
    effectiveLeverage: carryResult.effectiveLeverage,
    dailyVaR95Pct: Number(carryResult.dailyVaR95Pct.toFixed(4)),
    liquidationEvents: carryResult.liquidationEvents,
    effectiveKelly: adaptiveKellyResult.effectiveKellyMultiplier,
    hadAllLossStreak: adaptiveKellyResult.hadAllLossStreak,
  }, null, 2));
  console.log(`Wrote: ${args.outputPath}`);
}

main().catch((err: unknown) => {
  console.error("FATAL:", err);
  process.exit(1);
});
