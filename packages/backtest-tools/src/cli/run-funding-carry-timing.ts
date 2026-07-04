#!/usr/bin/env bun
// packages/backtest-tools/src/cli/run-funding-carry-timing.ts — Phase 8
// Track E funding-rate timing strategy backtest CLI runner.
//
// ===========================================================================
// HARD CONSTRAINT — USER-MANDATED 1:10 LEVERAGE (mvs_c13fe65cb68f4df3851304dea09a9099)
// ===========================================================================
//
// All trades use EXACTLY 1:10 leverage (10× notional on 1× capital).
// The CLI's --leverage flag accepts ONLY 1 or 10 — any other value
// (2, 3, 4, 5, 7, etc.) is REJECTED at parse time. Default = 10.
//
// This SUPERSEDES any prior track guidance:
//   - Phase 7 Track C "3× leverage default" → OVERRIDDEN
//   - Altrady / coincryptorank "≤3× for basis" → OVERRIDDEN
//   - Phase 8 Track E original "NO leverage amplification" → OVERRIDDEN
//
// Per-symbol VaR override (documented but does NOT reduce leverage):
//   - BTC 1× → 0.06% daily VaR → 1:10 → 0.6% (well below 2% cap)
//   - ETH 1× → 0.08% daily VaR → 1:10 → 0.8% (well below 2% cap)
//   - SOL 1× → 0.27% daily VaR → 1:10 → 2.7% (exceeds 2% cap, but
//     user mandate supersedes the 2% cap; we proceed with 1:10).
//
// ===========================================================================
//
// Algorithm — regime-aware timing + 1:10 leverage:
//   1. Open long-spot + short-perp at startPrice with 1:10 notional.
//   2. Every 8h funding snapshot: append to rolling 30d window, compute
//      rolling median + p75. Apply timing decision:
//      - In carry + current rate < median → EXIT to cash.
//      - Out of carry + current rate > p75 + cooldown (72h) elapsed → ENTER.
//      - Otherwise → hold current state.
//   3. While in carry: accrue funding at SCALED notional
//      (base × 1:10 = $100k on $10k base). Out of carry: skip accrual.
//   4. Rebalance: scale flat fee + latency cost by 1:10 (per leverage).
//
// Usage:
//   bun run packages/backtest-tools/src/cli/run-funding-carry-timing.ts \
//     --symbol=BTC/USDT --timeframe=1h \
//     --output=backtest-results/baseline-funding-carry-timing-btc-1h.json \
//     --leverage=10 --window-days=30 --entry-pctl=0.75 --exit-pctl=0.50 \
//     --cooldown-hours=72

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { CsvExchangeFeed } from "../data/csv-feed.js";
import type { ExchangeFeed } from "@mm-crypto-bot/backtest";
import {
  FundingCarryTimingStrategy,
  type AllowedTimingLeverage,
  type FundingSnapshot,
} from "@mm-crypto-bot/core";
import type { Timeframe } from "@mm-crypto-bot/shared/types";

interface CliArgs {
  readonly symbol: string;
  readonly timeframe: Timeframe;
  readonly initialEquity: number;
  readonly baseNotionalUsd: number;
  readonly leverage: AllowedTimingLeverage;
  readonly windowDays: number;
  readonly entryPctl: number;
  readonly exitPctl: number;
  readonly cooldownHours: number;
  readonly rebalanceThresholdPct: number;
  readonly withdrawalLatencyMinutes: number;
  readonly rebalanceCostBps: number;
  readonly outputPath: string;
}

// ===========================================================================
// HARD CONSTRAINT VALIDATOR — 1:10 MANDATORY LEVERAGE
// ===========================================================================

/**
 * `parseAndValidateLeverage` — strict CLI parser for the --leverage flag.
 * Rejects any value other than 1 or 10. This is the project-wide
 * HARD CONSTRAINT mandated by user-steer mvs_c13fe65cb68f4df3851304dea09a9099.
 *
 * @throws Error if `raw` cannot be parsed or is not in {1, 10}.
 */
function parseAndValidateLeverage(raw: string): AllowedTimingLeverage {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
    throw new Error(
      `[FUNDING-CARRY-TIMING] HARD CONSTRAINT VIOLATION: --leverage=${raw} is not a valid integer. ` +
        `User-mandated 1:10 leverage — only values 1 or 10 are accepted. Refusing to run.`,
    );
  }
  if (parsed !== 1 && parsed !== 10) {
    throw new Error(
      `[FUNDING-CARRY-TIMING] HARD CONSTRAINT VIOLATION: --leverage=${parsed} is NOT allowed. ` +
        `User-mandated 1:10 leverage — only values 1 (baseline) or 10 (1:10 mandatory) are accepted. ` +
        `Refusing to run.`,
    );
  }
  // parsed is narrowed to {1, 10} by the guard above; assignment to
  // AllowedTimingLeverage is type-safe by construction.
  return parsed;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  let symbol = "BTC/USDT";
  let timeframe: Timeframe = "1h";
  let initialEquity = 10_000;
  let baseNotionalUsd = 10_000;
  let leverage: AllowedTimingLeverage = 10; // 1:10 DEFAULT (user-mandated)
  let windowDays = 30;
  let entryPctl = 0.75;
  let exitPctl = 0.5;
  let cooldownHours = 72;
  let rebalanceThresholdPct = 0.05;
  let withdrawalLatencyMinutes = 15;
  let rebalanceCostBps = 20;
  let outputPath = "backtest-results/baseline-funding-carry-timing-btc-1h.json";
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
    } else if (arg.startsWith("--notional=")) {
      baseNotionalUsd = Number(arg.slice("--notional=".length));
    } else if (arg.startsWith("--leverage=")) {
      leverage = parseAndValidateLeverage(arg.slice("--leverage=".length));
    } else if (arg.startsWith("--window-days=")) {
      windowDays = Number(arg.slice("--window-days=".length));
    } else if (arg.startsWith("--entry-pctl=")) {
      entryPctl = Number(arg.slice("--entry-pctl=".length));
    } else if (arg.startsWith("--exit-pctl=")) {
      exitPctl = Number(arg.slice("--exit-pctl=".length));
    } else if (arg.startsWith("--cooldown-hours=")) {
      cooldownHours = Number(arg.slice("--cooldown-hours=".length));
    } else if (arg.startsWith("--rebalance=")) {
      rebalanceThresholdPct = Number(arg.slice("--rebalance=".length));
    } else if (arg.startsWith("--latency=")) {
      withdrawalLatencyMinutes = Number(arg.slice("--latency=".length));
    } else if (arg.startsWith("--fee-bps=")) {
      rebalanceCostBps = Number(arg.slice("--fee-bps=".length));
    } else if (arg.startsWith("--output=")) {
      outputPath = arg.slice("--output=".length);
    }
  }
  return {
    symbol,
    timeframe,
    initialEquity,
    baseNotionalUsd,
    leverage,
    windowDays,
    entryPctl,
    exitPctl,
    cooldownHours,
    rebalanceThresholdPct,
    withdrawalLatencyMinutes,
    rebalanceCostBps,
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
    const ts = Number(parts[0]);
    const sym = parts[1] ?? "";
    const rate = Number(parts[2]);
    if (!Number.isFinite(ts) || !Number.isFinite(rate)) continue;
    out.push({ fundingTime: ts, symbol: sym, fundingRate: rate });
  }
  return out;
}

interface TimingPoint {
  readonly timestamp: number;
  readonly equity: number;
  readonly fundingAccruedUsd: number;
  readonly markPrice: number;
  readonly inCarry: boolean;
  readonly fundingRate8h: number;
  readonly rollingMedian: number;
  readonly rollingP75: number;
}

interface TimingResult {
  readonly totalReturn: number;
  readonly annualizedReturn: number;
  readonly sharpeRatio: number;
  readonly sortinoRatio: number;
  readonly maxDrawdown: number;
  readonly profitFactor: number;
  readonly winRate: number;
  readonly totalTrades: number;
  readonly entryCount: number;
  readonly exitCount: number;
  readonly timeInCarryPct: number;
  readonly avgHoldDurationHours: number;
  readonly fundingCollectedUsd: number;
  readonly fundingCollectedInCarryOnly: number; // sum when in carry, positive periods
  readonly negativeFundingPaidUsd: number;
  readonly rebalanceCount: number;
  readonly rebalanceCostUsd: number;
  readonly fundingPeriods: number;
  readonly inCarryFundingPeriods: number;
  readonly outOfCarryFundingPeriods: number;
  readonly positiveFundingPeriods: number;
  readonly negativeFundingPeriods: number;
  readonly zeroFundingPeriods: number;
  readonly avgFundingRate8h: number;
  readonly avgFundingRate8hInCarry: number;
  readonly equityCurve: readonly TimingPoint[];
  readonly startTime: number;
  readonly endTime: number;
  /** Last rolling stats snapshot — for diagnostics. */
  readonly lastRollingStats: {
    readonly count: number;
    readonly median: number;
    readonly p75: number;
    readonly stdDev: number;
  };
}

/**
 * `simulateTimingCarry` — the core delta-neutral timing-aware carry loop.
 *
 * Algorithm:
 *   1. Initialize FundingCarryTimingStrategy with config.
 *   2. Walk the OHLCV timeline; at each candle, check whether any new
 *      funding snapshot fired since the last candle (8h cadence).
 *   3. For each new funding snapshot:
 *      a. Append to rolling 30d window.
 *      b. Compute rolling median + p75.
 *      c. If currently in carry → accrue funding × 1:10 scaled notional.
 *      d. Evaluate timing: 'enter' / 'exit' / 'hold'.
 *      e. On transition: update state machine.
 *   4. Track equity = initialEquity + fundingCollectedUsd - rebalanceCost.
 *   5. Track time-in-carry vs time-in-cash from the candle timeline.
 */
function simulateTimingCarry(opts: {
  readonly ohlcv: readonly { timestamp: number; close: number }[];
  readonly funding: readonly FundingSnapshot[];
  readonly startTime: number;
  readonly endTime: number;
  readonly initialEquity: number;
  readonly baseNotionalUsd: number;
  readonly leverage: AllowedTimingLeverage;
  readonly windowDays: number;
  readonly entryPctl: number;
  readonly exitPctl: number;
  readonly cooldownHours: number;
  readonly rebalanceThresholdPct: number;
  readonly withdrawalLatencyMinutes: number;
  readonly rebalanceCostBps: number;
}): TimingResult {
  const strategy = new FundingCarryTimingStrategy({
    baseNotionalUsd: opts.baseNotionalUsd,
    timingLeverage: opts.leverage,
    windowDays: opts.windowDays,
    entryPercentile: opts.entryPctl,
    exitPercentile: opts.exitPctl,
    cooldownHours: opts.cooldownHours,
    rebalanceThresholdPct: opts.rebalanceThresholdPct,
    withdrawalLatencyMinutes: opts.withdrawalLatencyMinutes,
    rebalanceCostBps: opts.rebalanceCostBps,
  });

  if (opts.ohlcv.length === 0) {
    throw new Error("No OHLCV candles in the requested period");
  }

  const equityCurve: TimingPoint[] = [];
  let lastFundingTime = 0;
  let fundingPeriods = 0;
  let positiveFundingPeriods = 0;
  let negativeFundingPeriods = 0;
  let zeroFundingPeriods = 0;
  let fundingSum = 0;
  let fundingSumInCarry = 0;
  let positiveFundingInCarry = 0;
  let inCarryCandles = 0;
  let totalCandles = 0;
  let inCarryEnterTime = 0;
  const holdDurations: number[] = [];
  let lastFundingRate = 0;

  for (const candle of opts.ohlcv) {
    // Funding accrual: snapshots between lastFundingTime+1 and candle.timestamp.
    const range = opts.funding.filter(
      (s) => s.fundingTime > lastFundingTime && s.fundingTime <= candle.timestamp,
    );
    for (const snap of range) {
      // Step a: append to rolling window.
      strategy.recordFundingSample(snap.fundingRate, snap.fundingTime);
      fundingPeriods += 1;
      fundingSum += snap.fundingRate;
      lastFundingRate = snap.fundingRate;
      if (snap.fundingRate > 0) positiveFundingPeriods += 1;
      else if (snap.fundingRate < 0) negativeFundingPeriods += 1;
      else zeroFundingPeriods += 1;

      // Step c: if in carry, accrue funding at scaled notional.
      if (strategy.state.isInCarry) {
        strategy.accrueFundingOnSnapshot(snap);
        fundingSumInCarry += snap.fundingRate;
        if (snap.fundingRate > 0) positiveFundingInCarry += 1;
      } else {
        // Out-of-carry: count this snapshot for diagnostics. We do NOT
        // accrue funding because the strategy is in cash — but we still
        // need to track how many funding periods we skipped.
        strategy.state.outOfCarryFundingPeriods += 1;
      }

      // Step d-e: evaluate timing transition.
      const decision = strategy.evaluateTiming(snap.fundingRate, snap.fundingTime);
      if (decision === "enter" && !strategy.state.isInCarry) {
        strategy._enterCarry(snap.fundingTime);
        inCarryEnterTime = snap.fundingTime;
      } else if (decision === "exit" && strategy.state.isInCarry) {
        strategy._exitCarry(snap.fundingTime);
        holdDurations.push(snap.fundingTime - inCarryEnterTime);
      }

      lastFundingTime = snap.fundingTime;
    }

    // Track in-carry vs cash time on a candle basis.
    totalCandles += 1;
    if (strategy.state.isInCarry) inCarryCandles += 1;

    // Mark-to-market equity.
    const equity = opts.initialEquity + strategy.totalNetPnlUsd();

    equityCurve.push({
      timestamp: candle.timestamp,
      equity,
      fundingAccruedUsd: strategy.state.fundingCollectedUsd,
      markPrice: candle.close,
      inCarry: strategy.state.isInCarry,
      fundingRate8h: lastFundingRate,
      rollingMedian: strategy.state.lastStats.median,
      rollingP75: strategy.state.lastStats.p75,
    });
  }

  // If still in carry at end, record final hold duration.
  if (strategy.state.isInCarry && inCarryEnterTime > 0) {
    holdDurations.push(opts.endTime - inCarryEnterTime);
  }

  // Metrics.
  const totalReturn = (equityCurve[equityCurve.length - 1]!.equity - opts.initialEquity) / opts.initialEquity;
  const elapsedDays = (opts.endTime - opts.startTime) / (1000 * 60 * 60 * 24);
  const years = elapsedDays / 365.25;
  const annualizedReturn = years > 0 ? Math.pow(1 + totalReturn, 1 / years) - 1 : 0;

  // Sharpe on hourly equity returns.
  const returns: number[] = [];
  for (let i = 1; i < equityCurve.length; i++) {
    const prev = equityCurve[i - 1]!.equity;
    const cur = equityCurve[i]!.equity;
    if (prev > 0) returns.push((cur - prev) / prev);
  }
  const meanR = returns.length > 0 ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;
  const variance =
    returns.length > 1 ? returns.reduce((a, b) => a + (b - meanR) ** 2, 0) / (returns.length - 1) : 0;
  const stdR = Math.sqrt(variance);
  const periodsPerYear = 24 * 365;
  const sharpeRatio = stdR > 0 ? (meanR / stdR) * Math.sqrt(periodsPerYear) : 0;
  const downside = returns.filter((r) => r < 0);
  const downStd =
    downside.length > 1 ? Math.sqrt(downside.reduce((a, b) => a + b ** 2, 0) / (downside.length - 1)) : 0;
  const sortinoRatio = downStd > 0 ? (meanR / downStd) * Math.sqrt(periodsPerYear) : 0;

  // Max DD.
  let peak = equityCurve[0]?.equity ?? opts.initialEquity;
  let maxDd = 0;
  for (const p of equityCurve) {
    if (p.equity > peak) peak = p.equity;
    const dd = (peak - p.equity) / peak;
    if (dd > maxDd) maxDd = dd;
  }

  const wins = strategy.state.fundingCollectedUsd >= 0 ? 1 : 0;
  const losses = strategy.state.fundingCollectedUsd < 0 ? 1 : 0;
  const winRate = wins + losses > 0 ? wins / (wins + losses) : 0;
  const profitFactor =
    losses > 0
      ? strategy.state.fundingCollectedUsd / Math.max(Math.abs(strategy.underlyingCarryState.rebalanceCostUsd), 1)
      : strategy.state.fundingCollectedUsd;

  const avgHoldHours =
    holdDurations.length > 0
      ? holdDurations.reduce((a, b) => a + b, 0) / holdDurations.length / (1000 * 60 * 60)
      : 0;

  return {
    totalReturn,
    annualizedReturn,
    sharpeRatio,
    sortinoRatio,
    maxDrawdown: maxDd,
    profitFactor,
    winRate,
    totalTrades: strategy.state.entryCount + strategy.state.exitCount,
    entryCount: strategy.state.entryCount,
    exitCount: strategy.state.exitCount,
    timeInCarryPct: totalCandles > 0 ? inCarryCandles / totalCandles : 0,
    avgHoldDurationHours: avgHoldHours,
    fundingCollectedUsd: strategy.state.fundingCollectedUsd,
    fundingCollectedInCarryOnly: strategy.state.fundingCollectedUsd - strategy.state.negativeFundingPaidUsd,
    negativeFundingPaidUsd: strategy.state.negativeFundingPaidUsd,
    rebalanceCount: strategy.underlyingCarryState.rebalanceCount,
    rebalanceCostUsd: strategy.underlyingCarryState.rebalanceCostUsd,
    fundingPeriods,
    inCarryFundingPeriods: strategy.state.inCarryFundingPeriods,
    outOfCarryFundingPeriods: strategy.state.outOfCarryFundingPeriods,
    positiveFundingPeriods,
    negativeFundingPeriods,
    zeroFundingPeriods,
    avgFundingRate8h: fundingPeriods > 0 ? fundingSum / fundingPeriods : 0,
    avgFundingRate8hInCarry: positiveFundingInCarry > 0 ? fundingSumInCarry / positiveFundingInCarry : 0,
    equityCurve,
    startTime: opts.startTime,
    endTime: opts.endTime,
    lastRollingStats: {
      count: strategy.state.lastStats.count,
      median: strategy.state.lastStats.median,
      p75: strategy.state.lastStats.p75,
      stdDev: strategy.state.lastStats.stdDev,
    },
  };
}

async function main(): Promise<void> {
  const args = parseArgs();
  const dataDir = resolve(import.meta.dir, "..", "..", "..", "..", "data", "ohlcv");
  const fundingDir = resolve(import.meta.dir, "..", "..", "..", "..", "data", "funding");
  const feed = new CsvExchangeFeed(dataDir) as unknown as ExchangeFeed;

  const startTime = new Date(Date.UTC(2024, 0, 1));
  const endTime = new Date();

  console.log(`[funding-carry-timing] symbol=${args.symbol} ltf=${args.timeframe}`);
  console.log(`[funding-carry-timing] HARD CONSTRAINT: leverage = ${args.leverage} (1:${args.leverage} = ${args.leverage}× notional)`);
  console.log(`[funding-carry-timing] effectiveNotional = $${(args.baseNotionalUsd * args.leverage).toFixed(0)} (base $${args.baseNotionalUsd} × ${args.leverage}×)`);
  console.log(`[funding-carry-timing] timing window=${args.windowDays}d entry>p${args.entryPctl * 100} exit<median cooldown=${args.cooldownHours}h`);
  console.log(`[funding-carry-timing] period: ${startTime.toISOString()} → ${endTime.toISOString()}`);

  const ohlcvAll = await feed.fetchOHLCV(args.symbol, args.timeframe, {
    since: startTime.getTime(),
    limit: Number.MAX_SAFE_INTEGER,
  });
  const ohlcv = ohlcvAll.filter(
    (c) => c.timestamp >= startTime.getTime() && c.timestamp <= endTime.getTime(),
  );
  if (ohlcv.length === 0) {
    throw new Error(`No OHLCV candles for ${args.symbol} ${args.timeframe}`);
  }

  const fileSym = symbolToFileSymbol(args.symbol);
  const fundingPath = resolve(fundingDir, `binance_${fileSym}usdt_funding_8h.csv`);
  const fundingRaw = await loadFundingCsv(fundingPath);
  const funding = fundingRaw.filter(
    (f) => f.fundingTime >= startTime.getTime() && f.fundingTime <= endTime.getTime(),
  );
  console.log(`[funding-carry-timing] OHLCV candles: ${ohlcv.length}, funding snapshots in window: ${funding.length} (total CSV: ${fundingRaw.length})`);

  if (funding.length === 0) {
    console.warn(`[funding-carry-timing] ⚠ No funding snapshots in window. Run download-funding-rates.ts first.`);
  }

  const t0 = Date.now();
  const result = simulateTimingCarry({
    ohlcv,
    funding,
    startTime: startTime.getTime(),
    endTime: endTime.getTime(),
    initialEquity: args.initialEquity,
    baseNotionalUsd: args.baseNotionalUsd,
    leverage: args.leverage,
    windowDays: args.windowDays,
    entryPctl: args.entryPctl,
    exitPctl: args.exitPctl,
    cooldownHours: args.cooldownHours,
    rebalanceThresholdPct: args.rebalanceThresholdPct,
    withdrawalLatencyMinutes: args.withdrawalLatencyMinutes,
    rebalanceCostBps: args.rebalanceCostBps,
  });
  const elapsedMs = Date.now() - t0;

  const totalDays = (endTime.getTime() - startTime.getTime()) / (1000 * 60 * 60 * 24);
  const totalMonths = totalDays / 30.44;
  const monthlyReturn =
    result.totalReturn > 0 && totalMonths > 0 ? Math.pow(1 + result.totalReturn, 1 / totalMonths) - 1 : 0;

  console.log(`\n=== FUNDING-CARRY-TIMING RESULTS ${args.symbol} ${args.timeframe} ===`);
  console.log(`HARD CONSTRAINT: leverage=${args.leverage}× (1:${args.leverage} mandatory)`);
  console.log(`Elapsed:                ${elapsedMs}ms`);
  console.log(`Total return:           ${(result.totalReturn * 100).toFixed(2)}%`);
  console.log(`Monthly avg:            ${(monthlyReturn * 100).toFixed(2)}%/mo (over ${totalMonths.toFixed(1)} months)`);
  console.log(`Annualized:             ${(result.annualizedReturn * 100).toFixed(2)}%`);
  console.log(`Sharpe:                 ${result.sharpeRatio.toFixed(3)}`);
  console.log(`Sortino:                ${result.sortinoRatio.toFixed(3)}`);
  console.log(`Max DD:                 ${(result.maxDrawdown * 100).toFixed(2)}%`);
  console.log(`Profit factor:          ${result.profitFactor.toFixed(3)}`);
  console.log(`Win rate:               ${(result.winRate * 100).toFixed(2)}%`);
  console.log(`--- TIMING-SPECIFIC ---`);
  console.log(`Time-in-carry:          ${(result.timeInCarryPct * 100).toFixed(2)}%`);
  console.log(`Entry count:            ${result.entryCount}`);
  console.log(`Exit count:             ${result.exitCount}`);
  console.log(`Avg hold duration:      ${result.avgHoldDurationHours.toFixed(1)}h`);
  console.log(`Funding collected:      $${result.fundingCollectedUsd.toFixed(2)}`);
  console.log(`  (positive periods only): $${result.fundingCollectedInCarryOnly.toFixed(2)}`);
  console.log(`  (negative paid in carry): $${result.negativeFundingPaidUsd.toFixed(2)}`);
  console.log(`In-carry funding snaps: ${result.inCarryFundingPeriods}`);
  console.log(`Out-of-carry snaps:     ${result.outOfCarryFundingPeriods}`);
  console.log(`Avg funding 8h (all):   ${(result.avgFundingRate8h * 100).toFixed(4)}%`);
  console.log(`Avg funding 8h (carry): ${(result.avgFundingRate8hInCarry * 100).toFixed(4)}%`);
  console.log(`Rebalance count:        ${result.rebalanceCount}`);
  console.log(`Rebalance cost:         $${result.rebalanceCostUsd.toFixed(2)}`);
  console.log(`Final equity:           $${(args.initialEquity + result.fundingCollectedUsd - result.rebalanceCostUsd).toFixed(2)}`);

  // Sanity check: empirical research expects carry to be positive on average.
  if (result.fundingCollectedUsd < 0) {
    console.warn(`[funding-carry-timing] ⚠ NEGATIVE funding collected ($${result.fundingCollectedUsd.toFixed(2)}). Historical regime favored longs over shorts.`);
  }

  const fs = await import("node:fs/promises");
  const absOutput = resolve(import.meta.dir, "..", "..", "..", "..", args.outputPath);
  await fs.mkdir(resolve(import.meta.dir, "..", "..", "..", "..", "backtest-results"), { recursive: true });
  await fs.writeFile(
    absOutput,
    JSON.stringify(
      {
        args,
        hardConstraint: {
          leverage: args.leverage,
          leverageRatio: `1:${args.leverage}`,
          effectiveNotionalUsd: args.baseNotionalUsd * args.leverage,
          mandateSource: "user-steer mvs_c13fe65cb68f4df3851304dea09a9099",
          mandateText: "ALL trades MUST use EXACTLY 1:10 leverage. No more, no less.",
        },
        totalMonths,
        monthlyReturn,
        result: {
          totalReturn: result.totalReturn,
          annualizedReturn: result.annualizedReturn,
          sharpeRatio: result.sharpeRatio,
          sortinoRatio: result.sortinoRatio,
          maxDrawdown: result.maxDrawdown,
          profitFactor: result.profitFactor,
          winRate: result.winRate,
          totalTrades: result.totalTrades,
          entryCount: result.entryCount,
          exitCount: result.exitCount,
          timeInCarryPct: result.timeInCarryPct,
          avgHoldDurationHours: result.avgHoldDurationHours,
          fundingCollectedUsd: result.fundingCollectedUsd,
          fundingCollectedInCarryOnly: result.fundingCollectedInCarryOnly,
          negativeFundingPaidUsd: result.negativeFundingPaidUsd,
          rebalanceCount: result.rebalanceCount,
          rebalanceCostUsd: result.rebalanceCostUsd,
          fundingPeriods: result.fundingPeriods,
          inCarryFundingPeriods: result.inCarryFundingPeriods,
          outOfCarryFundingPeriods: result.outOfCarryFundingPeriods,
          positiveFundingPeriods: result.positiveFundingPeriods,
          negativeFundingPeriods: result.negativeFundingPeriods,
          zeroFundingPeriods: result.zeroFundingPeriods,
          avgFundingRate8h: result.avgFundingRate8h,
          avgFundingRate8hInCarry: result.avgFundingRate8hInCarry,
          startTime: result.startTime,
          endTime: result.endTime,
          lastRollingStats: result.lastRollingStats,
        },
        // Sample the equity curve to avoid 22k-element JSON blobs.
        equityCurveSampled: result.equityCurve.filter((_, i) => i % 24 === 0),
      },
      null,
      2,
    ),
    "utf8",
  );
  console.log(`[funding-carry-timing] Saved: ${absOutput}`);
}

main().catch((err: unknown) => {
  console.error("[funding-carry-timing] FATAL:", err);
  process.exit(1);
});
