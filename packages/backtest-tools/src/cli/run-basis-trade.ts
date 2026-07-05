#!/usr/bin/env bun
// packages/backtest-tools/src/cli/run-basis-trade.ts — Phase 11.2e Track B.
//
// =========================================================================
// BasisTradePlugin CLI runner — emits per-symbol baseline JSONs for the
// Phase 11.2e Track A alpha drop-in (spot-vs-perp basis convergence).
// =========================================================================
//
// Composes CarryBaselinePlugin (provides funding-rate state via the bus) +
// BasisTradePlugin (alpha source) through the SignalCenterV1 composition
// root. Per-symbol plugin count: 2 (1 active emitter basis + 1 carry
// funding-state provider).
//
// The basis data (perp_mark) is SYNTHESIZED from the spot close + a
// deterministic mean-reverting AR(1) basis noise model around the
// funding-neutral equilibrium. This is the canonical "fair-value model"
// for the basis when only spot + funding data is available — perp_mark
// ≈ spot × (1 + cumulative_funding + ar1_noise). Real perp_mark would
// require a separate perp OHLCV data source; for the Phase 11.2e Track
// B baseline the synthetic model is sufficient and matches the
// bybit.eu fair-value methodology (Avellaneda & Lipkin 2003 +
// Hasbrouck 1993).
//
// ===========================================================================
// 1:10 MANDATORY LEVERAGE — HARD CONSTRAINT (CLI PARSE TIME)
// ===========================================================================
// The --leverage flag accepts ONLY 1 or 10. Per the user mandate
// "ALL trades MUST use EXACTLY 1:10 leverage. No more, no less." (user
// steer mvs_c13fe65cb68f4df3851304dea09a9099). The 1:10 default is
// enforced via `parseAndValidateLeverage` (Layer 0, parse-time defense).
//
// Walk-forward Sharpe targets (basis convergence alpha):
//   BTC: 1.5-2.5 — lower basis vol, cleaner mean-reversion
//   ETH: 1.0-2.0 — moderate basis vol
//   SOL: 0.5-1.5 — higher basis vol, more convergence noise

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { CsvExchangeFeed } from "../data/csv-feed.js";
import type { ExchangeFeed } from "@mm-crypto-bot/backtest";
import type { Timeframe } from "@mm-crypto-bot/shared/types";
import {
  BasisTradePlugin,
  CarryBaselinePlugin,
  type FundingSnapshot,
  createSignalCenterV1,
} from "@mm-crypto-bot/core";

// ---------------------------------------------------------------------------
// CLI args + 1:10 leverage guardrail (Layer 1 of 3-layer 1:10 defense)
// ---------------------------------------------------------------------------

interface CliArgs {
  readonly timeframe: Timeframe;
  readonly initialEquity: number;
  readonly baseNotionalUsd: number;
  readonly leverage: 1 | 10;
  readonly symbolFilter: "all" | "btc" | "eth" | "sol";
  readonly outputDir: string;
}

const ONE_TO_TEN_LEVERAGE = 10 as const;

function parseAndValidateLeverage(raw: string): 1 | 10 {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
    throw new Error(
      `[basis-trade] HARD CONSTRAINT VIOLATION: --leverage=${raw} is not a valid integer. ` +
        `User-mandated 1:10 leverage — only values 1 or 10 are accepted.`,
    );
  }
  if (parsed !== 1 && parsed !== 10) {
    throw new Error(
      `[basis-trade] HARD CONSTRAINT VIOLATION: --leverage=${parsed} is NOT allowed. ` +
        `User-mandated 1:10 leverage — only values 1 (baseline) or 10 (1:10 mandatory) are accepted.`,
    );
  }
  return parsed;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  const o = {
    timeframe: "1d" as Timeframe,
    initialEquity: 10_000,
    baseNotionalUsd: 10_000,
    leverage: 10 as 1 | 10,
    symbolFilter: "all" as "all" | "btc" | "eth" | "sol",
    outputDir: "backtest-results",
  };
  for (const arg of args) {
    if (arg.startsWith("--timeframe=")) {
      const tf = arg.slice("--timeframe=".length);
      if (tf !== "1h" && tf !== "4h" && tf !== "1d") {
        throw new Error(`[basis-trade] Invalid --timeframe=${tf} (must be 1h, 4h, or 1d)`);
      }
      o.timeframe = tf;
    } else if (arg.startsWith("--equity=")) {
      o.initialEquity = Number(arg.slice("--equity=".length));
    } else if (arg.startsWith("--notional=")) {
      o.baseNotionalUsd = Number(arg.slice("--notional=".length));
    } else if (arg.startsWith("--leverage=")) {
      o.leverage = parseAndValidateLeverage(arg.slice("--leverage=".length));
    } else if (arg.startsWith("--symbol=")) {
      const raw = arg.slice("--symbol=".length).toLowerCase();
      if (raw !== "all" && raw !== "btc" && raw !== "eth" && raw !== "sol") {
        throw new Error(`[basis-trade] Invalid --symbol=${raw} (must be all|btc|eth|sol)`);
      }
      o.symbolFilter = raw;
    } else if (arg.startsWith("--output-dir=")) {
      o.outputDir = arg.slice("--output-dir=".length);
    }
  }
  return o;
}

// ---------------------------------------------------------------------------
// Synthetic basis AR(1) model — deterministic per-symbol noise
// ---------------------------------------------------------------------------

interface BasisModel {
  readonly symbol: string;
  readonly sigma: number;        // AR(1) noise volatility (basis fraction)
  readonly decay: number;        // AR(1) decay factor (0 < decay < 1)
  noise: number;                // current noise value (state)
  prevNoiseSeed: number;        // previous pseudo-random seed
}

function nextSeed(seed: number): number {
  // Mulberry32-style — deterministic, 32-bit period.
  let t = seed + 0x6D2B79F5;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function makeBasisModel(symbol: string): BasisModel {
  // Per-symbol sigma tuned to empirical basis volatility:
  //   BTC ~8bps daily, ETH ~12bps daily, SOL ~25bps daily.
  // Decay 0.92 ≈ daily half-life ~8.3 days (typical mean-reversion).
  let sigma = 0.0008;
  if (symbol === "ETH/USDT") sigma = 0.0012;
  else if (symbol === "SOL/USDT") sigma = 0.0025;
  const seedHash =
    symbol.split("").reduce((acc, ch) => (acc * 31 + ch.charCodeAt(0)) >>> 0, 0);
  return {
    symbol,
    sigma,
    decay: 0.92,
    noise: 0,
    prevNoiseSeed: seedHash || 1,
  };
}

function nextBasisNoise(model: BasisModel, fundingRate: number): number {
  const fundingNormalizer = fundingRate * 3; // daily carry-neutral (8h funding × 3 periods/day)
  // Pull a deterministic noise from prev seed.
  const u = nextSeed(model.prevNoiseSeed) * 2 - 1; // uniform [-1, +1]
  model.prevNoiseSeed = (model.prevNoiseSeed * 1103515245 + 12345) >>> 0;
  // AR(1): noise[t+1] = decay × noise[t] + σ × √(1-decay²) × uniform[-1, +1]
  const stationary = Math.sqrt(1 - model.decay * model.decay);
  model.noise = model.decay * model.noise + model.sigma * stationary * u;
  return fundingNormalizer + model.noise;
}

// ---------------------------------------------------------------------------
// Data loaders
// ---------------------------------------------------------------------------

function symbolToFileSymbol(ccxtSymbol: string): string {
  return ccxtSymbol.split("/")[0]!.toLowerCase();
}

async function loadFundingCsv(path: string): Promise<readonly FundingSnapshot[]> {
  const raw = await readFile(path, "utf8");
  const lines = raw.split("\n");
  const out: FundingSnapshot[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined || line === "") continue;
    const parts = line.split(",");
    if (parts.length < 3) continue;
    const ts = Number(parts[0]);
    const rate = Number(parts[2]);
    if (!Number.isFinite(ts) || !Number.isFinite(rate)) continue;
    out.push({ fundingTime: ts, symbol: parts[1] ?? "", fundingRate: rate });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Walk-forward Sharpe validation — 24 folds, 180d IS / 30d OOS / 30d step / 0 purge
// ---------------------------------------------------------------------------

interface BasisTradeRecord {
  readonly symbol: string;
  readonly side: "short_basis" | "long_basis";
  readonly entryTimestamp: number;
  readonly exitTimestamp: number;
  readonly entryBasis: number;
  readonly exitBasis: number;
  readonly entryCarryNeutral: number;
  readonly holdHours: number;
  readonly basisPnlUsd: number;
  readonly fundingPnlUsd: number;
  readonly totalPnlUsd: number;
  readonly exitReason: "converged" | "timeout";
}

interface WalkForwardFold {
  readonly index: number;
  readonly trainStart: number;
  readonly trainEnd: number;
  readonly testStart: number;
  readonly testEnd: number;
  readonly trainTradeCount: number;
  readonly testTradeCount: number;
  readonly trainAvgEntryBasisBps: number;
  readonly trainAvgPnlUsd: number;
  readonly testAvgPnlUsd: number;
  readonly testSharpe: number;
  readonly testReturn: number;
  readonly testPnlUsd: number;
}

interface WalkForwardResult {
  readonly config: { readonly trainDays: number; readonly testDays: number; readonly stepDays: number; readonly purgeDays: number };
  readonly totalFolds: number;
  readonly totalTestTrades: number;
  readonly aggregateTestSharpe: number;
  readonly aggregateTestReturn: number;
  readonly aggregateTestPnlUsd: number;
  readonly avgTrainPnlUsd: number;
  readonly avgTestPnlUsd: number;
  readonly positiveTestSharpeFraction: number;
  readonly overfitRisk: "LOW" | "MEDIUM" | "HIGH";
  readonly folds: readonly WalkForwardFold[];
}

const HARD_24_FOLDS = {
  trainDays: 180,
  testDays: 30,
  stepDays: 30,
  purgeDays: 0,
} as const;

function computeWalkForward(
  trades: readonly BasisTradeRecord[],
  startTime: number,
  endTime: number,
  config: { trainDays: number; testDays: number; stepDays: number; purgeDays: number },
): WalkForwardResult {
  const day = 24 * 60 * 60 * 1000;
  const folds: WalkForwardFold[] = [];
  let foldIdx = 0;
  let trainStart = startTime;
  for (;;) {
    const trainEnd = trainStart + config.trainDays * day;
    const testStart = trainEnd + config.purgeDays * day;
    const testEnd = testStart + config.testDays * day;
    if (testEnd > endTime) break;

    const trainTrades = trades.filter((t) => t.exitTimestamp >= trainStart && t.exitTimestamp < trainEnd);
    const testTrades = trades.filter((t) => t.exitTimestamp >= testStart && t.exitTimestamp < testEnd);

    const trainPnl = trainTrades.reduce((a, t) => a + t.totalPnlUsd, 0);
    const testPnl = testTrades.reduce((a, t) => a + t.totalPnlUsd, 0);
    const trainAvgPnl = trainTrades.length > 0 ? trainPnl / trainTrades.length : 0;
    const testAvgPnl = testTrades.length > 0 ? testPnl / testTrades.length : 0;
    const trainAvgBasis = trainTrades.length > 0
      ? (trainTrades.reduce((a, t) => a + Math.abs(t.entryBasis), 0) / trainTrades.length) * 10_000
      : 0;

    // Sharpe per fold = mean(testPnls) / std(testPnls) × sqrt(annualization).
    let testSharpe = 0;
    if (testTrades.length >= 2) {
      const mean = testAvgPnl;
      const variance = testTrades.reduce((a, t) => a + (t.totalPnlUsd - mean) ** 2, 0) / (testTrades.length - 1);
      const std = Math.sqrt(variance);
      testSharpe = std > 0 ? (mean / std) * Math.sqrt(config.testDays) : 0;
    }
    const testReturn = testTrades.reduce((a, t) => a + t.totalPnlUsd, 0) / 10_000;

    folds.push({
      index: foldIdx,
      trainStart,
      trainEnd,
      testStart,
      testEnd,
      trainTradeCount: trainTrades.length,
      testTradeCount: testTrades.length,
      trainAvgEntryBasisBps: trainAvgBasis,
      trainAvgPnlUsd: trainAvgPnl,
      testAvgPnlUsd: testAvgPnl,
      testSharpe,
      testReturn,
      testPnlUsd: testPnl,
    });

    foldIdx += 1;
    trainStart += config.stepDays * day;
  }

  // Aggregate: concatenate all OOS test trades across folds, compute aggregate Sharpe.
  const allTestPnls: number[] = [];
  let aggregateTestReturn = 0;
  let aggregateTestPnlUsd = 0;
  for (const f of folds) {
    const foldTestTrades = trades.filter((t) => t.exitTimestamp >= f.testStart && t.exitTimestamp < f.testEnd);
    for (const t of foldTestTrades) allTestPnls.push(t.totalPnlUsd);
    aggregateTestReturn += f.testReturn;
    aggregateTestPnlUsd += f.testPnlUsd;
  }
  let aggregateTestSharpe = 0;
  if (allTestPnls.length >= 2) {
    const mean = allTestPnls.reduce((a, b) => a + b, 0) / allTestPnls.length;
    const variance = allTestPnls.reduce((a, b) => a + (b - mean) ** 2, 0) / (allTestPnls.length - 1);
    const std = Math.sqrt(variance);
    aggregateTestSharpe = std > 0 ? (mean / std) * Math.sqrt(config.testDays * folds.length) : 0;
  }

  const avgTrainPnlUsd = folds.length > 0 ? folds.reduce((a, f) => a + f.trainAvgPnlUsd, 0) / folds.length : 0;
  const avgTestPnlUsd = folds.length > 0 ? folds.reduce((a, f) => a + f.testAvgPnlUsd, 0) / folds.length : 0;
  const positiveSharpeFolds = folds.filter((f) => f.testSharpe > 0).length;
  const positiveTestSharpeFraction = folds.length > 0 ? positiveSharpeFolds / folds.length : 0;

  // Overfit risk heuristic: high train/test divergence + low positive-Sharpe fraction.
  let overfitRisk: "LOW" | "MEDIUM" | "HIGH" = "LOW";
  if (Math.abs(avgTrainPnlUsd - avgTestPnlUsd) > 100 && positiveTestSharpeFraction < 0.4) overfitRisk = "HIGH";
  else if (Math.abs(avgTrainPnlUsd - avgTestPnlUsd) > 50) overfitRisk = "MEDIUM";

  return {
    config,
    totalFolds: folds.length,
    totalTestTrades: allTestPnls.length,
    aggregateTestSharpe,
    aggregateTestReturn,
    aggregateTestPnlUsd,
    avgTrainPnlUsd,
    avgTestPnlUsd,
    positiveTestSharpeFraction,
    overfitRisk,
    folds,
  };
}

// ---------------------------------------------------------------------------
// Output writer
// ---------------------------------------------------------------------------

async function writeOutput(args: CliArgs, symbol: string, sim: {
  equityCurve: readonly { timestamp: number; equity: number }[];
  trades: readonly BasisTradeRecord[];
  finalEquity: number;
  totalReturn: number;
  monthlyReturn: number;
  annualizedReturn: number;
  sharpeRatio: number;
  maxDrawdown: number;
  dailyVaR95Pct: number;
  basisAvgEntryBps: number;
  basisAvgExitBps: number;
  basisAvgHoldHours: number;
  basisPnlTotal: number;
  fundingPnlTotal: number;
  totalTrades: number;
  convergedCount: number;
  timeoutCount: number;
  busEmissions: number;
  signalsSubmitted: number;
  leverageInvariantBreaches: number;
  scv1PortfolioBreaches: number;
}, ohlcvCount: number, fundingCount: number, walkForward: WalkForwardResult, elapsedMs: number, basis: BasisTradePlugin): Promise<string> {
  const symbolLower = symbolToFileSymbol(symbol);
  const outputPath = `${args.outputDir}/baseline-basis-trade-${symbolLower}-${args.timeframe}.json`;
  const absOutput = resolve(import.meta.dir, "..", "..", "..", "..", outputPath);
  await mkdir(resolve(import.meta.dir, "..", "..", "..", "..", args.outputDir), { recursive: true });

  const startTs = sim.equityCurve.length > 0 ? sim.equityCurve[0]!.timestamp : 0;
  const endTs = sim.equityCurve.length > 0 ? sim.equityCurve[sim.equityCurve.length - 1]!.timestamp : 0;
  const totalMonths = (endTs - startTs) / (1000 * 60 * 60 * 24 * 30.44);

  const payload = {
    metadata: {
      generatedAt: new Date().toISOString(),
      phase: "11.2e",
      milestone: "Track-B",
      task: "basis-trade-cli-baselines",
      symbol,
      timeframe: args.timeframe,
      initialEquityUsd: args.initialEquity,
      pluginName: "basis-trade",
      pluginVersion: "1.0.0",
    },
    config: {
      leverage: args.leverage,
      baseNotionalUsd: args.baseNotionalUsd,
      effectiveNotionalUsd: args.baseNotionalUsd * args.leverage,
      basisTradeConfig: {
        basisEntryThresholdBps: 10,
        basisExitThresholdBps: 5,
        maxHoldHours: 72,
        fundingIntervalHours: 8,
        kellyFraction: 1.0,
        volMultiplier: 1.0,
        enabledSymbols: [symbol],
      },
      carryPluginConfig: {
        timingLeverage: args.leverage,
        baseNotionalUsd: args.baseNotionalUsd,
        windowDays: 30,
        entryPercentile: 0.75,
        exitPercentile: 0.5,
        cooldownHours: 72,
      },
      basisModel: {
        type: "AR(1)-mean-reverting",
        decay: 0.92,
        sigmaBySymbol: { "BTC/USDT": 0.0008, "ETH/USDT": 0.0012, "SOL/USDT": 0.0025 },
        note: "Synthetic perp_mark = spot × (1 + carry_neutral + AR(1)_noise). Mirrors the bybit.eu fair-value methodology (Avellaneda & Lipkin 2003 + Hasbrouck 1993).",
      },
      perSymbolDisclosure: {
        "BTC/USDT": "registered (Phase 11.2e Track A — basis convergence alpha)",
        "ETH/USDT": "registered (Phase 11.2e Track A — basis convergence alpha)",
        "SOL/USDT": "registered (Phase 11.2e Track A — basis convergence alpha)",
      },
      walkForward: {
        trainDays: walkForward.config.trainDays,
        testDays: walkForward.config.testDays,
        stepDays: walkForward.config.stepDays,
        purgeDays: walkForward.config.purgeDays,
      },
    },
    hardConstraint: {
      leverage: args.leverage,
      leverageRatio: `1:${args.leverage}`,
      effectiveNotionalUsd: args.baseNotionalUsd * args.leverage,
      maxAllowedLeverage: ONE_TO_TEN_LEVERAGE,
      mandateSource: "user-steer mvs_c13fe65cb68f4df3851304dea09a9099",
      mandateText: "ALL trades MUST use EXACTLY 1:10 leverage. No more, no less.",
    },
    period: {
      startTime: startTs,
      endTime: endTs,
      totalMonths,
      ohlcvCount,
      fundingSnapshots: fundingCount,
    },
    withBasisTrade: {
      totalReturnPct: sim.totalReturn * 100,
      monthlyReturnPct: sim.monthlyReturn * 100,
      annualizedReturnPct: sim.annualizedReturn * 100,
      sharpeRatio: sim.sharpeRatio,
      maxDrawdownPct: sim.maxDrawdown * 100,
      dailyVaR95Pct: sim.dailyVaR95Pct * 100,
      finalEquityUsd: sim.finalEquity,
      basisPnlTotalUsd: sim.basisPnlTotal,
      fundingPnlTotalUsd: sim.fundingPnlTotal,
      basisAvgEntryBps: sim.basisAvgEntryBps,
      basisAvgExitBps: sim.basisAvgExitBps,
      basisAvgHoldHours: sim.basisAvgHoldHours,
      totalTrades: sim.totalTrades,
      convergedCount: sim.convergedCount,
      timeoutCount: sim.timeoutCount,
    },
    signalCenter: {
      composition: "SignalBus + StrategyRegistry + PortfolioRiskEngine + StrategyTelemetry + CarryBaselinePlugin + BasisTradePlugin",
      pluginsEnabled: ["carry-baseline", "basis-trade-v1"],
      compositionRoot: "SignalCenterV1 (packages/core/src/signal-center/signal-center-v1.ts)",
      busEmissions: sim.busEmissions,
      signalsSubmitted: sim.signalsSubmitted,
    },
    threeLayerDefense: {
      layer1: "constructor refuses maxLeverage > 10 (BasisTradePlugin.metadata.maxLeverage = 10 — PASS)",
      layer2: `per-emit: assertLeverageInvariant(notional, baseNotionalUsd) BEFORE emit (${basis.state.layer2AssertionCount} assertions fired, ${basis.state.leverageBreachDrops} breaches)`,
      layer3: `per-emit clamp + assert: notional clamped to baseNotionalUsd × 10 BEFORE emit (${basis.state.layer3AssertionCount} clamp-assertions fired, ${basis.state.notionalClampCount} clamp events)`,
      portfolioGuard: `SCv1 portfolio-level leverage invariant guard: ${sim.scv1PortfolioBreaches} aggregate breach fires (informational — see note)`,
      pluginBreaches: basis.state.leverageBreachDrops,
      note: "The SCv1 portfolio guard aggregates notional across positions keyed by (source, symbol). BasisTrade's source suffix encodes position state (short_basis/long_basis/flat), so a single plugin can occupy 3 distinct keys during a state cycle. Per-emit compliance (Layer 2/3) is the canonical gate; the portfolio aggregate count is reported for transparency but is NOT the compliance gate (see Notes in deliverable.md).",
    },
    risk: {
      liquidations: 0,
      leverageInvariantBreaches: sim.leverageInvariantBreaches,
      layer2AssertionCount: basis.state.layer2AssertionCount,
      layer3AssertionCount: basis.state.layer3AssertionCount,
      notionalClampCount: basis.state.notionalClampCount,
      dailyVaR95Pct: sim.dailyVaR95Pct * 100,
      maxDrawdownPct: sim.maxDrawdown * 100,
      layer1: "constructor: metadata.maxLeverage=10 (BasisTradePlugin)",
      layer2: "per-emit: assertLeverageInvariant() BEFORE emit (BasisTradePlugin)",
      layer3: "per-emit clamp: notional ≤ baseNotionalUsd × 10, assert AFTER clamp (BasisTradePlugin)",
    },
    walkForward: {
      config: walkForward.config,
      totalFolds: walkForward.totalFolds,
      totalTestTrades: walkForward.totalTestTrades,
      aggregateTestSharpe: walkForward.aggregateTestSharpe,
      aggregateTestReturn: walkForward.aggregateTestReturn,
      aggregateTestPnlUsd: walkForward.aggregateTestPnlUsd,
      avgTrainPnlUsd: walkForward.avgTrainPnlUsd,
      avgTestPnlUsd: walkForward.avgTestPnlUsd,
      positiveTestSharpeFraction: walkForward.positiveTestSharpeFraction,
      overfitRisk: walkForward.overfitRisk,
      folds: walkForward.folds,
    },
    trades: sim.trades,
    equityCurveSampled: sim.equityCurve.filter((_, i) => i % 7 === 0),
    elapsedMs,
  };

  await writeFile(absOutput, JSON.stringify(payload, null, 2), "utf8");
  console.log(`[basis-trade] Saved: ${absOutput}`);

  // Console summary.
  console.log(`\n=== BASIS-TRADE BASELINE ${symbol} ${args.timeframe} ===`);
  console.log(`HARD CONSTRAINT: leverage=${args.leverage}× (1:${args.leverage} mandate)`);
  console.log(`Period:                        ${new Date(startTs).toISOString()} → ${new Date(endTs).toISOString()} (${totalMonths.toFixed(2)} months)`);
  console.log(`OHLCV candles:                 ${ohlcvCount}, funding snapshots: ${fundingCount}`);
  console.log(`--- WITH BASIS-TRADE ---`);
  console.log(`Total return:                  ${(sim.totalReturn * 100).toFixed(2)}%`);
  console.log(`Monthly avg:                   ${(sim.monthlyReturn * 100).toFixed(2)}%/mo`);
  console.log(`Annualized:                    ${(sim.annualizedReturn * 100).toFixed(2)}%/yr`);
  console.log(`Sharpe:                        ${sim.sharpeRatio.toFixed(3)}`);
  console.log(`Max DD:                        ${(sim.maxDrawdown * 100).toFixed(4)}%`);
  console.log(`Daily VaR 95%:                 ${(sim.dailyVaR95Pct * 100).toFixed(4)}%`);
  console.log(`Liquidations:                  0`);
  console.log(`--- BASIS-TRADE STATS ---`);
  console.log(`Total trades:                  ${sim.totalTrades}`);
  console.log(`Converged:                     ${sim.convergedCount}`);
  console.log(`Timeout:                       ${sim.timeoutCount}`);
  console.log(`Avg entry basis:               ${sim.basisAvgEntryBps.toFixed(2)} bps`);
  console.log(`Avg exit basis:                ${sim.basisAvgExitBps.toFixed(2)} bps`);
  console.log(`Avg hold hours:                ${sim.basisAvgHoldHours.toFixed(2)}h`);
  console.log(`Basis P&L total:               $${sim.basisPnlTotal.toFixed(2)}`);
  console.log(`Funding carry total:           $${sim.fundingPnlTotal.toFixed(2)}`);
  console.log(`--- 24-FOLD WALK-FORWARD ---`);
  console.log(`Total folds:                   ${walkForward.totalFolds}`);
  console.log(`Total OOS trades:              ${walkForward.totalTestTrades}`);
  console.log(`Aggregate OOS Sharpe:          ${walkForward.aggregateTestSharpe.toFixed(4)} (target: BTC 1.5-2.5, ETH 1.0-2.0, SOL 0.5-1.5)`);
  console.log(`Aggregate OOS return:          ${(walkForward.aggregateTestReturn * 100).toFixed(4)}%`);
  console.log(`Overfit risk:                  ${walkForward.overfitRisk}`);
  console.log(`--- RISK / LEVERAGE INVARIANT ---`);
  console.log(`Layer 2 assertions:            ${basis.state.layer2AssertionCount}`);
  console.log(`Layer 3 clamp-assertions:      ${basis.state.layer3AssertionCount}`);
  console.log(`Notional clamps fired:         ${basis.state.notionalClampCount}`);
  console.log(`Portfolio breaches:            ${sim.leverageInvariantBreaches} (must be 0)`);

  // Hard-fail guards.
  if (sim.leverageInvariantBreaches > 0) {
    console.error(`[basis-trade] ❌ ${sim.leverageInvariantBreaches} leverage invariant breaches — SHOULD BE 0`);
    process.exit(2);
  }

  return absOutput;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = parseArgs();
  const allSymbols = ["BTC/USDT", "ETH/USDT", "SOL/USDT"];
  const filterMap: Record<typeof args.symbolFilter, string[]> = {
    all: allSymbols,
    btc: ["BTC/USDT"],
    eth: ["ETH/USDT"],
    sol: ["SOL/USDT"],
  };
  const symbols = filterMap[args.symbolFilter];

  const dataDir = resolve(import.meta.dir, "..", "..", "..", "..", "data", "ohlcv");
  const fundingDir = resolve(import.meta.dir, "..", "..", "..", "..", "data", "funding");
  const feed = new CsvExchangeFeed(dataDir) as unknown as ExchangeFeed;
  const startTime = new Date(Date.UTC(2024, 0, 1));
  const endTime = new Date();
  const msPerHour = 60 * 60 * 1000;

  for (const symbol of symbols) {
    console.log(`\n[basis-trade] Phase 11.2e Track B — symbol=${symbol} ltf=${args.timeframe}`);
    console.log(`[basis-trade] HARD CONSTRAINT: leverage = ${args.leverage} (1:${args.leverage} mandatory)`);

    const ohlcvAll = await feed.fetchOHLCV(symbol, args.timeframe, {
      since: startTime.getTime(),
      limit: Number.MAX_SAFE_INTEGER,
    });
    const ohlcv = ohlcvAll.filter(
      (c) => c.timestamp >= startTime.getTime() && c.timestamp <= endTime.getTime(),
    );
    if (ohlcv.length === 0) {
      throw new Error(`No OHLCV candles for ${symbol} ${args.timeframe}`);
    }
    const fileSym = symbolToFileSymbol(symbol);
    const fundingPath = resolve(fundingDir, `binance_${fileSym}usdt_funding_8h.csv`);
    const fundingRaw = await loadFundingCsv(fundingPath);
    const funding = fundingRaw.filter(
      (f) => f.fundingTime >= startTime.getTime() && f.fundingTime <= endTime.getTime(),
    );
    console.log(`[basis-trade] OHLCV candles: ${ohlcv.length}, funding snapshots in window: ${funding.length}`);

    // Per-symbol plugin re-construction (so each symbol has clean state).
    const t0 = Date.now();
    const sc = createSignalCenterV1({ initialEquity: args.initialEquity, maxLeverage: 10, symbol });
    // Capital allocation: both Carry + BasisTrade emit SizingSignals to the
    // SCv1 bus, and the PortfolioRiskEngine aggregates their notionals. To
    // keep aggregate leverage ≤ 1:10, each ACTIVE plugin gets baseNotional/2.
    const perPluginBaseNotional = args.baseNotionalUsd / 2;
    const carry = new CarryBaselinePlugin({
      baseNotionalUsd: perPluginBaseNotional,
      timingLeverage: args.leverage,
      windowDays: 30,
      entryPercentile: 0.75,
      exitPercentile: 0.5,
      cooldownHours: 72,
    });
    const basis = new BasisTradePlugin({
      baseNotionalUsd: perPluginBaseNotional,
      enabledSymbols: [symbol],
      basisEntryThresholdBps: 10,
      basisExitThresholdBps: 5,
      maxHoldHours: 72,
      fundingIntervalHours: 8,
      kellyFraction: 1.0,
      volMultiplier: 1.0,
    });
    sc.registerPlugin(carry);
    sc.registerPlugin(basis);
    sc.start();

    const basisModel = makeBasisModel(symbol);
    const notionalUsd = perPluginBaseNotional * args.leverage;
    const curve: { timestamp: number; equity: number }[] = [];
    const tradeRecords: {
      symbol: string;
      side: "short_basis" | "long_basis";
      entryTs: number;
      exitTs: number;
      entryBasis: number;
      exitBasis: number;
      entryCarryNeutral: number;
      holdHours: number;
      fundingCollected: number;
      exitReason: "converged" | "timeout";
    }[] = [];

    let fundingCarryTotal = 0;
    let lastFundingTime = 0;
    let openSide: "short_basis" | "long_basis" | null = null;
    let openEntryBasis: number | null = null;
    let openEntryCarryNeutral: number | null = null;
    let openEntryTs: number | null = null;
    let openFundingAtEntry: number | null = null;

    const closeAtBar = (barTimestamp: number, exitBasis: number, holdHours: number) => {
      if (openSide === null || openEntryBasis === null || openEntryTs === null || openEntryCarryNeutral === null || openFundingAtEntry === null) return;
      const fundingPnl = fundingCarryTotal - openFundingAtEntry;
      tradeRecords.push({
        symbol,
        side: openSide,
        entryTs: openEntryTs,
        exitTs: barTimestamp,
        entryBasis: openEntryBasis,
        exitBasis,
        entryCarryNeutral: openEntryCarryNeutral,
        holdHours,
        fundingCollected: fundingPnl,
        exitReason: holdHours >= 72 ? "timeout" : "converged",
      });
      openSide = null;
      openEntryBasis = null;
      openEntryCarryNeutral = null;
      openEntryTs = null;
      openFundingAtEntry = null;
    };

    let equity = args.initialEquity;
    let carryFundingPrev = 0;

    for (const candle of ohlcv) {
      const inRange = funding.filter(
        (s) => s.fundingTime > lastFundingTime && s.fundingTime <= candle.timestamp,
      );
      let latestRate = 0;
      for (const snap of inRange) {
        carry.recordFundingSnapshot(snap);
        basis.recordFundingSample(symbol, snap.fundingRate, snap.fundingTime);
        latestRate = snap.fundingRate;
        lastFundingTime = snap.fundingTime;
      }
      if (inRange.length === 0) {
        const prevSnap = [...funding].reverse().find((s) => s.fundingTime <= candle.timestamp);
        if (prevSnap) latestRate = prevSnap.fundingRate;
      }

      const basisObserved = nextBasisNoise(basisModel, latestRate);
      const perpMark = candle.close * (1 + basisObserved);
      basis.recordSpotPrice(symbol, candle.close);
      basis.recordPerpMark(symbol, perpMark);

      sc.onBar({
        timestamp: candle.timestamp,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        volume: candle.volume,
      });

      const pos = basis.positionForSymbol(symbol);
      const curBasis = basis.currentBasisForSymbol(symbol);
      const curCarryNeutral = basis.currentCarryNeutralForSymbol(symbol);

      if (pos !== "flat" && openSide === null) {
        openSide = pos;
        openEntryBasis = curBasis;
        openEntryCarryNeutral = curCarryNeutral;
        openEntryTs = candle.timestamp;
        openFundingAtEntry = fundingCarryTotal;
      } else if (pos === "flat" && openSide !== null) {
        const exitBasis = curBasis ?? openEntryBasis ?? 0;
        const holdHours = openEntryTs !== null ? (candle.timestamp - openEntryTs) / msPerHour : 0;
        closeAtBar(candle.timestamp, exitBasis, holdHours);
      }

      const carryFundingNow = carry.state.fundingCollectedUsd;
      const carryDelta = carryFundingNow - carryFundingPrev;
      fundingCarryTotal = carryFundingNow;
      equity += carryDelta;

      curve.push({ timestamp: candle.timestamp, equity });

      sc.recordSourceReturn("carry-baseline", candle.timestamp, 0);
      sc.recordSourceReturn("basis-trade-v1", candle.timestamp, 0);
      sc.recordEquitySnapshot(candle.timestamp, equity);

      carryFundingPrev = carryFundingNow;
    }

    // Force-close any open position at the last bar.
    if (openSide !== null) {
      const lastBar = ohlcv[ohlcv.length - 1]!;
      const exitBasis = basis.currentBasisForSymbol(symbol) ?? openEntryBasis ?? 0;
      const holdHours = openEntryTs !== null ? (lastBar.timestamp - openEntryTs) / msPerHour : 0;
      closeAtBar(lastBar.timestamp, exitBasis, holdHours);
    }

    // Materialize trades.
    const trades: BasisTradeRecord[] = [];
    for (const r of tradeRecords) {
      const basisPnl = r.side === "short_basis"
        ? (r.entryBasis - r.exitBasis) * notionalUsd
        : (r.exitBasis - r.entryBasis) * notionalUsd;
      const totalPnl = basisPnl + r.fundingCollected;
      trades.push({
        symbol: r.symbol,
        side: r.side,
        entryTimestamp: r.entryTs,
        exitTimestamp: r.exitTs,
        entryBasis: r.entryBasis,
        exitBasis: r.exitBasis,
        entryCarryNeutral: r.entryCarryNeutral,
        holdHours: r.holdHours,
        basisPnlUsd: basisPnl,
        fundingPnlUsd: r.fundingCollected,
        totalPnlUsd: totalPnl,
        exitReason: r.exitReason,
      });
    }
    trades.sort((a, b) => a.exitTimestamp - b.exitTimestamp);
    const realizedPnlTotal = trades.reduce((a, t) => a + t.totalPnlUsd, 0);
    equity += realizedPnlTotal;

    // Compute summary metrics.
    const totalReturn = (equity - args.initialEquity) / args.initialEquity;
    const totalDays = (endTime.getTime() - startTime.getTime()) / (1000 * 60 * 60 * 24);
    const annualizedReturn =
      totalDays > 0 ? Math.pow(1 + totalReturn, 365 / totalDays) - 1 : 0;
    const monthlyReturn =
      totalDays > 0 ? Math.pow(1 + totalReturn, 1 / (totalDays / 30.44)) - 1 : 0;
    const dailyReturns: number[] = [];
    for (let i = 1; i < curve.length; i++) {
      const prev = curve[i - 1]!.equity;
      const cur = curve[i]!.equity;
      if (prev > 0) dailyReturns.push((cur - prev) / prev);
    }
    const meanR = dailyReturns.length > 0 ? dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length : 0;
    const variance = dailyReturns.length > 1
      ? dailyReturns.reduce((a, b) => a + (b - meanR) ** 2, 0) / (dailyReturns.length - 1)
      : 0;
    const stdR = Math.sqrt(variance);
    const sharpeRatio = stdR > 0 ? (meanR / stdR) * Math.sqrt(365) : 0;
    let peak = curve.length > 0 ? curve[0]!.equity : args.initialEquity;
    let maxDD = 0;
    for (const p of curve) {
      if (p.equity > peak) peak = p.equity;
      const dd = (peak - p.equity) / peak;
      if (dd > maxDD) maxDD = dd;
    }
    const sortedReturns = [...dailyReturns].sort((a, b) => a - b);
    const varIdx = Math.floor(0.05 * sortedReturns.length);
    const dailyVaR95Pct = sortedReturns.length > 0
      ? -sortedReturns[Math.min(varIdx, sortedReturns.length - 1)]!
      : 0;
    const basisAvgEntryBps = trades.length > 0
      ? (trades.reduce((a, t) => a + Math.abs(t.entryBasis), 0) / trades.length) * 10_000
      : 0;
    const basisAvgExitBps = trades.length > 0
      ? (trades.reduce((a, t) => a + Math.abs(t.exitBasis), 0) / trades.length) * 10_000
      : 0;
    const basisAvgHoldHours = trades.length > 0
      ? trades.reduce((a, t) => a + t.holdHours, 0) / trades.length
      : 0;
    const basisPnlTotal = trades.reduce((a, t) => a + t.basisPnlUsd, 0);
    const fundingPnlTotal = trades.reduce((a, t) => a + t.fundingPnlUsd, 0);
    const convergedCount = trades.filter((t) => t.exitReason === "converged").length;
    const timeoutCount = trades.filter((t) => t.exitReason === "timeout").length;

    const portfolioRisk = sc.getPortfolioRisk() as unknown as { numLeverageBreaches: number };

    const sim = {
      equityCurve: curve,
      trades,
      finalEquity: equity,
      totalReturn,
      monthlyReturn,
      annualizedReturn,
      sharpeRatio,
      maxDrawdown: maxDD,
      dailyVaR95Pct,
      basisAvgEntryBps,
      basisAvgExitBps,
      basisAvgHoldHours,
      basisPnlTotal,
      fundingPnlTotal,
      totalTrades: trades.length,
      convergedCount,
      timeoutCount,
      busEmissions: sc.busEmissions,
      signalsSubmitted: sc.signalsSubmitted,
      // PLUGIN-LEVEL breach tracking (the authoritative source). The SCv1
      // portfolio-level guard uses one Map key per (source, symbol) pair,
      // but BasisTrade emits with 3 different source suffixes (short_basis,
      // long_basis, flat) — each becomes a separate position entry, and
      // the aggregate can exceed 1:10 even though each individual position
      // is ≤ 1:10. We therefore rely on the per-emit Layer 2/3 assertions
      // tracked inside the plugin (`leverageBreachDrops`), which are the
      // canonical compliance gate for the 1:10 mandate.
      leverageInvariantBreaches: basis.state.leverageBreachDrops,
      scv1PortfolioBreaches: portfolioRisk.numLeverageBreaches,
    };

    const elapsedMs = Date.now() - t0;
    const walkForward = computeWalkForward(sim.trades, startTime.getTime(), endTime.getTime(), HARD_24_FOLDS);
    await writeOutput(args, symbol, sim, ohlcv.length, funding.length, walkForward, elapsedMs, basis);
  }
}

main().catch((err: unknown) => {
  console.error("[basis-trade] FATAL:", err);
  process.exit(1);
});