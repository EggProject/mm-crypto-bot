#!/usr/bin/env bun
// packages/backtest-tools/src/cli/run-multi-class-baseline.ts — Multi-class ensemble baseline
//
// Phase 6 M2 — A multi-class ensemble CLI runner, ami a Phase 6 M2
// `MultiClassEnsemble` strategy-t futtatja a Phase 1 OHLCV adatokon,
// és kombinálja a Donchian 1d trade-PnL-t a Phase 6 Track A funding-carry
// contribution-nel. A latency gate (Track B) a Track B minták JSON-ból
// töltődik, és a Kelly-opt sizing (Track C) a Phase 5 C trade-statisztikákból.
//
// A engine.runBacktest() loop-ja direktcionális (egy pozíció egyszerre),
// ezért a CLI runner a carry komponenst a `simulateDeltaNeutralCarry`
// függvényen keresztül, PÁRHUZAMOSAN futtatja a Donchian backtesttel.
// A kettő kombinációja adja a "combined edge"-et.
//
// Usage:
//   bun run packages/backtest-tools/src/cli/run-multi-class-baseline.ts
//   bun run packages/backtest-tools/src/cli/run-multi-class-baseline.ts --symbol=BTC/USDT --timeframe=1d
//   bun run packages/backtest-tools/src/cli/run-multi-class-baseline.ts --output=backtest-results/baseline-multi-class-btc-1d.json
//   bun run packages/backtest-tools/src/cli/run-multi-class-baseline.ts --kelly-fraction=0.5 --arb-threshold-ms=500

import { resolve } from "node:path";
import { readFile } from "node:fs/promises";

import { CsvExchangeFeed } from "../data/csv-feed.js";
import { runBacktest, type BacktestResult, type CostModel } from "@mm-crypto-bot/backtest";
import type { ExchangeFeed } from "@mm-crypto-bot/backtest";
import { makeSymbol, type Timeframe } from "@mm-crypto-bot/shared/types";
import {
  FundingCarryStrategy,
  InMemoryFundingRateProvider,
  MultiClassEnsemble,
  createLatencyGate,
  DEFAULT_KELLY_OPT_AGGREGATE,
  DEFAULT_LATENCY_GATE_DISABLED,
  DEFAULT_MULTI_CLASS_ENSEMBLE_CONFIG_PARTIAL,
  type FundingSnapshot,
  type KellyFraction,
  type LatencySnapshot,
  timeframesForMultiClass,
} from "@mm-crypto-bot/core";

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

interface CliArgs {
  readonly symbol: string;
  readonly timeframe: Timeframe;
  readonly initialEquity: number;
  readonly kellyFraction: KellyFraction;
  readonly arbThresholdMs: number;
  readonly targetNotionalUsd: number;
  readonly latencySnapshotPath: string;
  readonly outputPath: string;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  let symbol = "BTC/USDT";
  let timeframe: Timeframe = "1d";
  let initialEquity = 10_000;
  let kellyFraction: KellyFraction = 0.5;
  let arbThresholdMs = 500;
  let targetNotionalUsd = 10_000;
  let latencySnapshotPath = "";
  let outputPath = "";
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
    } else if (arg.startsWith("--kelly-fraction=")) {
      const kf = Number(arg.slice("--kelly-fraction=".length));
      if (kf !== 0.25 && kf !== 0.5 && kf !== 1.0) {
        throw new Error(`--kelly-fraction must be 0.25 / 0.5 / 1.0: ${kf}`);
      }
      kellyFraction = kf;
    } else if (arg.startsWith("--arb-threshold-ms=")) {
      arbThresholdMs = Number(arg.slice("--arb-threshold-ms=".length));
    } else if (arg.startsWith("--notional=")) {
      targetNotionalUsd = Number(arg.slice("--notional=".length));
    } else if (arg.startsWith("--latency-snapshot=")) {
      latencySnapshotPath = arg.slice("--latency-snapshot=".length);
    } else if (arg.startsWith("--output=")) {
      outputPath = arg.slice("--output=".length);
    }
  }
  if (!outputPath) {
    const symbolLower = symbol.split("/")[0]!.toLowerCase();
    outputPath = `backtest-results/baseline-multi-class-${symbolLower}-${timeframe}.json`;
  }
  return {
    symbol,
    timeframe,
    initialEquity,
    kellyFraction,
    arbThresholdMs,
    targetNotionalUsd,
    latencySnapshotPath,
    outputPath,
  };
}

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
    const fundingTimeRaw = parts[0];
    const symbolRaw = parts[1];
    const fundingRateRaw = parts[2];
    if (fundingTimeRaw === undefined || symbolRaw === undefined || fundingRateRaw === undefined) continue;
    const fundingTime = Number(fundingTimeRaw);
    const fundingRate = Number(fundingRateRaw);
    if (!Number.isFinite(fundingTime) || !Number.isFinite(fundingRate)) continue;
    out.push({
      fundingTime,
      symbol: symbolRaw,
      fundingRate,
    });
  }
  return out;
}

async function loadLatencySnapshot(path: string): Promise<LatencySnapshot | null> {
  if (!path) return null;
  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    // The Track B JSON has a `summary` field with per-pair latency stats.
    const summary = parsed["summary"] as Record<string, unknown> | undefined;
    if (!summary) return null;
    const rtt = summary["roundTripMs"] as Record<string, number> | undefined;
    if (!rtt) return null;
    return {
      pair: (parsed["symbol"] as string | undefined) ?? "unknown",
      roundTripMsMax: rtt["max"] ?? 0,
      roundTripMsMedian: rtt["median"] ?? 0,
      sourceJsonPath: path,
    };
  } catch (err) {
    console.warn(`[multi-class-baseline] failed to load latency snapshot from ${path}:`, err);
    return null;
  }
}

const COST_MODEL: CostModel = {
  takerFeeRate: 0.001,
  slippageRate: 0.0005,
  spreadRate: 0.0002,
  borrowRatePerHour: 0.0001,
  fundingRatePer8h: 0,
};

// ---------------------------------------------------------------------------
// Carry simulation (parallel to the Donchian engine backtest)
// ---------------------------------------------------------------------------

interface CarrySimResult {
  readonly fundingCollectedUsd: number;
  readonly rebalanceCount: number;
  readonly rebalanceCostUsd: number;
  readonly fundingPeriods: number;
  readonly positiveFundingPeriods: number;
  readonly negativeFundingPeriods: number;
  readonly zeroFundingPeriods: number;
  readonly avgFundingRate8h: number;
  readonly netFundingUsd: number;
  readonly startTime: number;
  readonly endTime: number;
  readonly pausedCandles: number;
  readonly activeCandles: number;
  readonly latencyGateActiveFraction: number;
}

function simulateCarryParallel(opts: {
  readonly ohlcv: readonly { timestamp: number; close: number }[];
  readonly funding: readonly FundingSnapshot[];
  readonly startTime: number;
  readonly endTime: number;
  readonly initialEquity: number;
  readonly targetNotionalUsd: number;
  readonly rebalanceThresholdPct: number;
  readonly withdrawalLatencyMinutes: number;
  readonly rebalanceCostBps: number;
  readonly latencyGateActive: boolean;
}): CarrySimResult {
  const fundingProvider = new InMemoryFundingRateProvider(opts.funding);
  const strategy = new FundingCarryStrategy({
    targetNotionalUsd: opts.targetNotionalUsd,
    rebalanceThresholdPct: opts.rebalanceThresholdPct,
    withdrawalLatencyMinutes: opts.withdrawalLatencyMinutes,
    rebalanceCostBps: opts.rebalanceCostBps,
  });

  if (opts.ohlcv.length === 0) {
    throw new Error("No OHLCV candles in the requested period");
  }
  const startPrice = opts.ohlcv[0]!.close;
  void startPrice;

  let lastFundingTime = 0;
  let fundingPeriods = 0;
  let positiveFundingPeriods = 0;
  let negativeFundingPeriods = 0;
  let zeroFundingPeriods = 0;
  let fundingSum = 0;
  const deltaSensitivity = 0.01;
  let pausedCandles = 0;
  let activeCandles = 0;

  for (const candle of opts.ohlcv) {
    // Latency gate: if the gate is CLOSED for this backtest (cross-exchange
    // round-trip > arbThresholdMs), skip funding accrual for this candle.
    if (!opts.latencyGateActive) {
      pausedCandles += 1;
      continue;
    }
    activeCandles += 1;
    const range = fundingProvider.getFundingRange(lastFundingTime + 1, candle.timestamp);
    for (const snap of range) {
      const payment = strategy.accrueFunding(opts.targetNotionalUsd, snap.fundingRate);
      fundingSum += snap.fundingRate;
      fundingPeriods += 1;
      if (snap.fundingRate > 0) positiveFundingPeriods += 1;
      else if (snap.fundingRate < 0) negativeFundingPeriods += 1;
      else zeroFundingPeriods += 1;
      lastFundingTime = snap.fundingTime;
      void payment;
    }
    const cumFundingUsd = strategy.state.fundingCollectedUsd;
    const driftUsd = cumFundingUsd * deltaSensitivity;
    strategy.rebalanceIfNeeded(driftUsd);
  }

  const netFundingUsd = strategy.totalFundingUsd();
  const totalCandles = activeCandles + pausedCandles;
  const latencyGateActiveFraction = totalCandles === 0 ? 0 : activeCandles / totalCandles;

  return {
    fundingCollectedUsd: strategy.state.fundingCollectedUsd,
    rebalanceCount: strategy.state.rebalanceCount,
    rebalanceCostUsd: strategy.state.rebalanceCostUsd,
    fundingPeriods,
    positiveFundingPeriods,
    negativeFundingPeriods,
    zeroFundingPeriods,
    avgFundingRate8h: fundingPeriods > 0 ? fundingSum / fundingPeriods : 0,
    netFundingUsd,
    startTime: opts.startTime,
    endTime: opts.endTime,
    pausedCandles,
    activeCandles,
    latencyGateActiveFraction,
  };
}

// ---------------------------------------------------------------------------
// Kelly position-sizing derivation (Phase 5 baseline stats + Track C formula)
// ---------------------------------------------------------------------------

/**
 * `deriveKellyCap` — derives the position-sizing cap from the Phase 5
 * baseline trade stats (win rate / W-L ratio) using the Track C Kelly
 * formula. We use a FIXED default since the ensemble is run on its own
 * 1d candle stream; the underlying Donchian 1d stats from Phase 5 C
 * (BTC 50% WR / 0.7 R; ETH 50% WR / 1.2 R; SOL 53% WR / 0.8 R) are
 * applied as the empirical priors.
 */
function deriveKellyCap(symbol: string, kellyFraction: KellyFraction): number {
  // Track C empirical results: `optimizeKelly` gives the recommended
  // maxPositionPctEquity per symbol × Kelly multiplier. We use the
  // Phase 6 Track C sensitivity runs (0.5x default → scaled per
  // multiplier) as the ground-truth Kelly sizing.
  //
  // Track C empirical (0.5x Kelly, from docs/research/phase6-kelly-opt.md §4.2):
  //   - BTC: cappedKelly 2.54%  (raw Kelly negative, floor at 2.54%)
  //   - ETH: cappedKelly 8.60%
  //   - SOL: cappedKelly 11.71%
  //
  // We scale linearly with `kellyFraction` (0.25 / 0.5 / 1.0):
  //   - 0.25x → multiply by 0.5 of the 0.5x value
  //   - 0.5x  → use the table values directly
  //   - 1.0x  → multiply by 2 of the 0.5x value
  //
  // Reference: docs/research/phase6-kelly-opt.md §4.2 + run-kelly-opt.ts
  // `runKellyOptBacktest` for the engine integration.
  const trackC_0_5x: Record<string, number> = {
    "BTC/USDT": 0.0254,
    "ETH/USDT": 0.0860,
    "SOL/USDT": 0.1171,
  };
  const tableVal = trackC_0_5x[symbol] ?? 0.05;
  // Linear scale: 0.25x → 0.5× tableVal; 0.5x → tableVal; 1.0x → 2× tableVal.
  const scale = kellyFraction === 0.25 ? 0.5 : kellyFraction === 1.0 ? 2.0 : 1.0;
  const scaled = tableVal * scale;
  // Risk-cap at 20% (per Phase 5 / Track C defaults)
  return Math.min(0.20, scaled);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

interface CombinedResult {
  readonly args: CliArgs;
  readonly donchian: {
    readonly totalReturn: number;
    readonly monthlyReturn: number;
    readonly annualizedReturn: number;
    readonly sharpeRatio: number;
    readonly sortinoRatio: number;
    readonly maxDrawdown: number;
    readonly profitFactor: number;
    readonly winRate: number;
    readonly totalTrades: number;
    readonly finalEquity: number;
  };
  readonly carry: CarrySimResult;
  readonly combined: {
    readonly totalReturn: number;
    readonly monthlyReturn: number;
    readonly annualizedReturn: number;
    readonly sharpeRatio: number;
    readonly maxDrawdown: number;
    readonly finalEquity: number;
    readonly edgeContributionPctDonchian: number;
    readonly edgeContributionPctCarry: number;
    readonly carryActive: boolean;
    readonly kellyMultiplier: KellyFraction;
  };
  readonly latencySnapshot: LatencySnapshot | null;
  readonly timestamp: number;
}

async function main(): Promise<void> {
  const args = parseArgs();
  const tf = timeframesForMultiClass(args.timeframe);
  const dataDir = resolve(import.meta.dir, "..", "..", "..", "..", "data", "ohlcv");
  const fundingDir = resolve(import.meta.dir, "..", "..", "..", "..", "data", "funding");
  const feed = new CsvExchangeFeed(dataDir) as unknown as ExchangeFeed;

  const startTime = new Date(Date.UTC(2024, 0, 1));
  const endTime = new Date();

  // Load latency snapshot (optional). If absent → use DISABLED gate.
  let latencySnapshot: LatencySnapshot | null = null;
  let latencySnapshotPath = args.latencySnapshotPath;
  if (!latencySnapshotPath) {
    // Default: pick the matching Track B JSON for the symbol.
    const fileSym = symbolToFileSymbol(args.symbol).toUpperCase();
    const trackBDir = resolve(import.meta.dir, "..", "..", "..", "..", "backtest-results");
    const candidates = [
      `arb-latency-binance-bybit-${fileSym.toLowerCase()}-sample.json`,
      `arb-latency-binance-kucoin-${fileSym.toLowerCase()}-sample.json`,
      `arb-latency-bybit-kucoin-${fileSym.toLowerCase()}-sample.json`,
    ];
    for (const c of candidates) {
      try {
        const resolved = resolve(trackBDir, c);
        const _test = await readFile(resolved, "utf8");
        void _test;
        latencySnapshotPath = resolved;
        latencySnapshot = await loadLatencySnapshot(resolved);
        break;
      } catch {
        // Try next.
      }
    }
  } else {
    latencySnapshot = await loadLatencySnapshot(latencySnapshotPath);
  }
  const latencyGate = latencySnapshot
    ? createLatencyGate(latencySnapshot, args.arbThresholdMs)
    : DEFAULT_LATENCY_GATE_DISABLED;

  // Derive Kelly cap from Phase 5 C empirical stats.
  const recommendedMaxPositionPctEquity = deriveKellyCap(args.symbol, args.kellyFraction);
  const kellyOpt = {
    ...DEFAULT_KELLY_OPT_AGGREGATE,
    kellyMultiplier: args.kellyFraction,
    recommendedMaxPositionPctEquity,
  };

  console.log(`[multi-class-baseline] symbol=${args.symbol} ltf=${args.timeframe}`);
  console.log(`[multi-class-baseline] period: ${startTime.toISOString()} → ${endTime.toISOString()}`);
  console.log(
    `[multi-class-baseline] latency gate: ` +
      `pair=${latencySnapshot?.pair ?? "DISABLED"}, ` +
      `roundTripMax=${latencySnapshot?.roundTripMsMax ?? "n/a"}ms, ` +
      `arbThreshold=${args.arbThresholdMs}ms, ` +
      `gate=${latencyGate.isCarryAllowed() ? "OPEN" : "CLOSED"}`,
  );
  console.log(
    `[multi-class-baseline] Kelly: multiplier=${args.kellyFraction}, ` +
      `maxPos=${(recommendedMaxPositionPctEquity * 100).toFixed(2)}%`,
  );

  // Construct the ensemble strategy.
  const ensemble = new MultiClassEnsemble({
    ...DEFAULT_MULTI_CLASS_ENSEMBLE_CONFIG_PARTIAL,
    fundingCarry: {
      targetNotionalUsd: args.targetNotionalUsd,
      rebalanceThresholdPct: 0.05,
      withdrawalLatencyMinutes: 15,
      rebalanceCostBps: 20,
    },
    latencyGate,
    kellyOpt,
  });

  // === Phase A: Donchian backtest via engine ===
  const t0 = Date.now();
  const donchianResult: BacktestResult = await runBacktest({
    symbol: makeSymbol(args.symbol),
    htfTimeframe: tf.htf,
    mtfTimeframe: tf.mtf,
    ltfTimeframe: tf.ltf,
    startTime,
    endTime,
    initialEquityUsd: args.initialEquity,
    feed,
    costModel: COST_MODEL,
    positionSize: {
      riskPerTrade: 0.01,
      kellyFraction: args.kellyFraction,
      maxDrawdown: 0.5, // disable kill-switch for diagnostic run
      maxPositionPctEquity: recommendedMaxPositionPctEquity,
      minPositionPctEquity: 0.01,
    },
    strategy: ensemble,
  });
  const ensembleState = ensemble.getState();
  const elapsedMs = Date.now() - t0;

  // === Phase B: Carry simulation parallel to the Donchian backtest ===
  const fileSym = symbolToFileSymbol(args.symbol);
  const fundingPath = resolve(fundingDir, `binance_${fileSym}usdt_funding_8h.csv`);
  let funding: readonly FundingSnapshot[] = [];
  try {
    const fundingRaw = await loadFundingCsv(fundingPath);
    // Filter to the backtest window (Track A convention) so the carry
    // simulation matches the same time range as the Donchian backtest.
    funding = fundingRaw.filter(
      (f) => f.fundingTime >= startTime.getTime() && f.fundingTime <= endTime.getTime(),
    );
    if (funding.length === 0) {
      console.warn(`[multi-class-baseline] ⚠ No funding snapshots in window. Carry will be 0.`);
    }
  } catch {
    console.warn(`[multi-class-baseline] ⚠ No funding CSV at ${fundingPath} — carry will be 0.`);
  }
  const ohlcvAll = await feed.fetchOHLCV(args.symbol, args.timeframe, {
    since: startTime.getTime(),
    limit: Number.MAX_SAFE_INTEGER,
  });
  const ohlcv = ohlcvAll.filter(
    (c) => c.timestamp >= startTime.getTime() && c.timestamp <= endTime.getTime(),
  );
  const carryResult = simulateCarryParallel({
    ohlcv,
    funding,
    startTime: startTime.getTime(),
    endTime: endTime.getTime(),
    initialEquity: args.initialEquity,
    targetNotionalUsd: args.targetNotionalUsd,
    rebalanceThresholdPct: 0.05,
    withdrawalLatencyMinutes: 15,
    rebalanceCostBps: 20,
    latencyGateActive: latencyGate.isCarryAllowed(),
  });

  // === Phase C: Combine ===
  const totalDays = (endTime.getTime() - startTime.getTime()) / (1000 * 60 * 60 * 24);
  const totalMonths = totalDays / 30.44;
  const donchianMonthlyReturn =
    donchianResult.totalReturn > 0 && totalMonths > 0
      ? Math.pow(1 + donchianResult.totalReturn, 1 / totalMonths) - 1
      : 0;
  const finalEquity = args.initialEquity + donchianResult.totalReturn * args.initialEquity + carryResult.netFundingUsd;
  const combinedTotalReturn = (finalEquity - args.initialEquity) / args.initialEquity;
  const combinedMonthlyReturn =
    combinedTotalReturn > 0 && totalMonths > 0
      ? Math.pow(1 + combinedTotalReturn, 1 / totalMonths) - 1
      : 0;
  const combinedAnnualizedReturn = totalMonths > 0
    ? Math.pow(1 + combinedTotalReturn, 12 / totalMonths) - 1
    : 0;

  // Combined Sharpe (rough): blend the two edge components.
  // Use the carry's variance ~ 0 (deterministic funding), so combined
  // Sharpe ≈ donchianSharpe (the carry adds return without proportional vol).
  const combinedSharpe = donchianResult.sharpeRatio;

  // Combined max DD: take the worst of the two components (no hedging).
  // Combined max DD: take the worst of the two components (no hedging).
  // The carry component has near-zero drawdown (delta-neutral, deterministic
  // funding), so combinedMaxDd ≈ donchianResult.maxDrawdown.
  const combinedMaxDd = donchianResult.maxDrawdown;

  // Edge contribution percentages.
  const donchianContributionPct = (donchianResult.totalReturn * args.initialEquity) / (combinedTotalReturn * args.initialEquity) * 100;
  const carryContributionPct = (carryResult.netFundingUsd) / (combinedTotalReturn * args.initialEquity) * 100;

  const wins = donchianResult.trades.filter((t) => t.pnlUsd > 0);
  const winRate = donchianResult.trades.length > 0 ? wins.length / donchianResult.trades.length : 0;

  console.log(`\n=== MULTI-CLASS ENSEMBLE RESULTS ${args.symbol} ${args.timeframe} ===`);
  console.log(`Elapsed:                  ${elapsedMs}ms`);
  console.log(`Donchian 1d:`);
  console.log(`  Total return:           ${(donchianResult.totalReturn * 100).toFixed(2)}%`);
  console.log(`  Monthly avg:            ${(donchianMonthlyReturn * 100).toFixed(4)}%/mo (over ${totalMonths.toFixed(1)} months)`);
  console.log(`  Sharpe:                 ${donchianResult.sharpeRatio.toFixed(3)}`);
  console.log(`  Max DD:                 ${(donchianResult.maxDrawdown * 100).toFixed(2)}%`);
  console.log(`  Win rate:               ${(winRate * 100).toFixed(2)}%`);
  console.log(`  Trades:                 ${donchianResult.totalTrades}`);
  console.log(`Carry component:`);
  console.log(`  Funding collected:      $${carryResult.fundingCollectedUsd.toFixed(2)}`);
  console.log(`  Net funding:            $${carryResult.netFundingUsd.toFixed(2)}`);
  console.log(`  Rebalance count:        ${carryResult.rebalanceCount}`);
  console.log(`  Funding periods:        ${carryResult.fundingPeriods}`);
  console.log(`  Avg rate 8h:            ${(carryResult.avgFundingRate8h * 100).toFixed(4)}%`);
  console.log(`  Gate active fraction:   ${(carryResult.latencyGateActiveFraction * 100).toFixed(2)}%`);
  console.log(`Combined edge:`);
  console.log(`  Total return:           ${(combinedTotalReturn * 100).toFixed(2)}%`);
  console.log(`  Monthly avg:            ${(combinedMonthlyReturn * 100).toFixed(4)}%/mo`);
  console.log(`  Annualized:             ${(combinedAnnualizedReturn * 100).toFixed(2)}%`);
  console.log(`  Sharpe:                 ${combinedSharpe.toFixed(3)}`);
  console.log(`  Max DD:                 ${(combinedMaxDd * 100).toFixed(2)}%`);
  console.log(`  Final equity:           $${finalEquity.toFixed(2)}`);
  console.log(`  Edge contribution:      Donchian=${donchianContributionPct.toFixed(2)}%, Carry=${carryContributionPct.toFixed(2)}%`);

  const combined: CombinedResult = {
    args,
    donchian: {
      totalReturn: donchianResult.totalReturn,
      monthlyReturn: donchianMonthlyReturn,
      annualizedReturn: donchianResult.annualizedReturn,
      sharpeRatio: donchianResult.sharpeRatio,
      sortinoRatio: donchianResult.sortinoRatio,
      maxDrawdown: donchianResult.maxDrawdown,
      profitFactor: donchianResult.profitFactor,
      winRate,
      totalTrades: donchianResult.totalTrades,
      finalEquity: args.initialEquity + donchianResult.totalReturn * args.initialEquity,
    },
    carry: carryResult,
    combined: {
      totalReturn: combinedTotalReturn,
      monthlyReturn: combinedMonthlyReturn,
      annualizedReturn: combinedAnnualizedReturn,
      sharpeRatio: combinedSharpe,
      maxDrawdown: combinedMaxDd,
      finalEquity,
      edgeContributionPctDonchian: donchianContributionPct,
      edgeContributionPctCarry: carryContributionPct,
      carryActive: latencyGate.isCarryAllowed(),
      kellyMultiplier: args.kellyFraction,
    },
    latencySnapshot,
    timestamp: Date.now(),
  };

  // Write JSON (Phase 5/6 baseline schema).
  const fs = await import("node:fs/promises");
  const absOutput = resolve(import.meta.dir, "..", "..", "..", "..", args.outputPath);
  await fs.mkdir(resolve(import.meta.dir, "..", "..", "..", "..", "backtest-results"), { recursive: true });
  await fs.writeFile(
    absOutput,
    JSON.stringify(combined, null, 2),
    "utf8",
  );
  console.log(`[multi-class-baseline] Saved: ${absOutput}`);

  // Also surface the ensemble state to stdout for verification.
  console.log(`\nEnsemble state:`);
  console.log(`  donchianSignalsEmitted:      ${ensembleState.donchianSignalsEmitted}`);
  console.log(`  donchianSignalsAccepted:     ${ensembleState.donchianSignalsAcceptedByFilter}`);
  console.log(`  fundingCarryActiveCandles:   ${ensembleState.fundingCarryActiveCandles}`);
  console.log(`  fundingCarryPausedCandles:   ${ensembleState.fundingCarryPausedCandles}`);
  console.log(`  latencyGateActiveFraction:   ${(ensembleState.latencyGateActiveFraction * 100).toFixed(2)}%`);
}

main().catch((err: unknown) => {
  console.error("[multi-class-baseline] FATAL:", err);
  process.exit(1);
});
