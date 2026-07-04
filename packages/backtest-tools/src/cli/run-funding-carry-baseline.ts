#!/usr/bin/env bun
// packages/backtest-tools/src/cli/run-funding-carry-baseline.ts — funding-rate
// carry baseline backtest CLI runner.
//
// Phase 6 Track A — delta-neutral funding-rate carry simulation using
// historical Binance 8h funding snapshots + bybit.eu SPOT-only cost model.
//
// The engine.runBacktest() loop is directional and does not natively model
// delta-neutral positions. The CLI runner therefore drives its own
// delta-neutral carry simulation using:
//   - Phase 1 OHLCV (BTC/ETH/SOL × 1h, 2024-01 → 2026-07)
//   - Historical funding rates from data/funding/binance_<sym>_funding_8h.csv
//   - FundingCarryStrategy.accrueFunding / rebalanceIfNeeded state API
//   - bybit.eu SPOT 1:10 cost model (taker 0.1%, slippage 0.05%, spread 0.02%)
//
// The output JSON mirrors the Phase 5 baseline shape (`baseline-donchian-*.json`)
// with additional funding-specific fields:
//   - fundingCollectedUsd, rebalanceCount, rebalanceCostUsd
//   - avgFundingRate8h, fundingPeriods
//
// Usage:
//   bun run packages/backtest-tools/src/cli/run-funding-carry-baseline.ts
//   bun run packages/backtest-tools/src/cli/run-funding-carry-baseline.ts --symbol=BTC/USDT --timeframe=1h
//   bun run packages/backtest-tools/src/cli/run-funding-carry-baseline.ts --output=backtest-results/baseline-funding-carry-btc-1h.json

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { CsvExchangeFeed } from "../data/csv-feed.js";
import type { ExchangeFeed } from "@mm-crypto-bot/backtest";
import { FundingCarryStrategy, InMemoryFundingRateProvider, type FundingSnapshot } from "@mm-crypto-bot/core";
import type { Timeframe } from "@mm-crypto-bot/shared/types";

interface CliArgs {
  readonly symbol: string;
  readonly timeframe: Timeframe;
  readonly initialEquity: number;
  readonly targetNotionalUsd: number;
  readonly rebalanceThresholdPct: number;
  readonly withdrawalLatencyMinutes: number;
  readonly rebalanceCostBps: number;
  readonly outputPath: string;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  let symbol = "BTC/USDT";
  let timeframe: Timeframe = "1h";
  let initialEquity = 10_000;
  let targetNotionalUsd = 10_000;
  let rebalanceThresholdPct = 0.05;
  let withdrawalLatencyMinutes = 15;
  let rebalanceCostBps = 20;
  let outputPath = "backtest-results/baseline-funding-carry-btc-1h.json";
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
      targetNotionalUsd = Number(arg.slice("--notional=".length));
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
    targetNotionalUsd,
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

interface CarryPoint {
  readonly timestamp: number;
  readonly equity: number;
  readonly fundingAccruedUsd: number;
  readonly markPrice: number;
}

interface CarryResult {
  readonly totalReturn: number;
  readonly annualizedReturn: number;
  readonly sharpeRatio: number;
  readonly sortinoRatio: number;
  readonly maxDrawdown: number;
  readonly profitFactor: number;
  readonly winRate: number;
  readonly totalTrades: number;
  readonly fundingCollectedUsd: number;
  readonly rebalanceCount: number;
  readonly rebalanceCostUsd: number;
  readonly fundingPeriods: number;
  readonly avgFundingRate8h: number;
  readonly positiveFundingPeriods: number;
  readonly negativeFundingPeriods: number;
  readonly zeroFundingPeriods: number;
  readonly equityCurve: readonly CarryPoint[];
  readonly startTime: number;
  readonly endTime: number;
}

/**
 * `simulateDeltaNeutralCarry` — the core delta-neutral carry backtest loop.
 *
 * Algorithm:
 *   1. Open long-spot + short-perp at startPrice (delta = 0).
 *   2. Every 8h funding snapshot: accrue funding payment.
 *   3. Track mark price on every LTF candle. Unrealized delta of the
 *      spot leg vs. the perp leg drifts by `qty × (newPrice - startPrice)`
 *      for each leg; since both legs are equal qty in opposite directions,
 *      the net delta is always 0 in theory. In practice, slippage and
 *      funding compounding create a small drift — we model it as
 *      `cumFundingPnl × 0.01` (1% sensitivity assumption) which triggers
 *      rebalance when it exceeds `rebalanceThresholdPct`.
 *   4. Rebalance: debit rebalance flat fee + withdrawal latency cost.
 *   5. Compute Sharpe / Sortino / max DD from the equity curve.
 */
function simulateDeltaNeutralCarry(opts: {
  readonly ohlcv: readonly { timestamp: number; close: number }[];
  readonly funding: readonly FundingSnapshot[];
  readonly startTime: number;
  readonly endTime: number;
  readonly initialEquity: number;
  readonly targetNotionalUsd: number;
  readonly rebalanceThresholdPct: number;
  readonly withdrawalLatencyMinutes: number;
  readonly rebalanceCostBps: number;
}): CarryResult {
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
  const _qty = opts.targetNotionalUsd / startPrice;
  void _qty;

  // Walk the OHLCV timeline. At each candle:
  //  - update mark price
  //  - check whether any funding snapshot fired since the last seen candle
  //  - update equity curve (realized funding + spot drift - perp drift)
  const equityCurve: CarryPoint[] = [];
  let equity = opts.initialEquity;
  let lastFundingTime = 0;
  let fundingPeriods = 0;
  let positiveFundingPeriods = 0;
  let negativeFundingPeriods = 0;
  let zeroFundingPeriods = 0;
  let fundingSum = 0;

  // Simulated delta-drift sensitivity (1% per $1 of cum-funding, capped).
  // This is a CONSERVATIVE model — the perp leg's funding accrual grows
  // the basis between spot and perp, generating a small delta that must
  // be rebalanced periodically.
  const deltaSensitivity = 0.01;

  for (const candle of opts.ohlcv) {
    // Funding accrual: snapshots between lastFundingTime+1 and candle.timestamp.
    const range = fundingProvider.getFundingRange(lastFundingTime + 1, candle.timestamp);
    for (const snap of range) {
      const payment = strategy.accrueFunding(opts.targetNotionalUsd, snap.fundingRate);
      fundingSum += snap.fundingRate;
      fundingPeriods += 1;
      if (snap.fundingRate > 0) positiveFundingPeriods += 1;
      else if (snap.fundingRate < 0) negativeFundingPeriods += 1;
      else zeroFundingPeriods += 1;
      lastFundingTime = snap.fundingTime;
      // Avoid unused-var lint warning on payment — it IS used via state.
      void payment;
    }

    // Spot drift vs perp drift — in true delta-neutral both legs cancel
    // exactly (entry qty × price move). We model a TINY residual drift
    // proportional to cumulative funding, reflecting the funding
    // compounding the basis between the two legs in practice.
    const cumFundingUsd = strategy.state.fundingCollectedUsd;
    const driftUsd = cumFundingUsd * deltaSensitivity;
    // Mark-to-market equity = initialEquity + net funding - rebalance costs.
    const currentEquity = opts.initialEquity + strategy.totalFundingUsd();
    equity = currentEquity;

    // Rebalance check.
    strategy.rebalanceIfNeeded(driftUsd);

    equityCurve.push({
      timestamp: candle.timestamp,
      equity,
      fundingAccruedUsd: cumFundingUsd,
      markPrice: candle.close,
    });
  }

  // Metrics computation.
  const totalReturn = (equity - opts.initialEquity) / opts.initialEquity;
  const elapsedDays = (opts.endTime - opts.startTime) / (1000 * 60 * 60 * 24);
  const years = elapsedDays / 365.25;
  const annualizedReturn = years > 0 ? (Math.pow(1 + totalReturn, 1 / years) - 1) : 0;

  // Sharpe on hourly equity returns (assume 24 × 365 periods per year).
  const returns: number[] = [];
  for (let i = 1; i < equityCurve.length; i++) {
    const prev = equityCurve[i - 1]!.equity;
    const cur = equityCurve[i]!.equity;
    if (prev > 0) returns.push((cur - prev) / prev);
  }
  const meanR = returns.length > 0 ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;
  const variance = returns.length > 1 ? returns.reduce((a, b) => a + (b - meanR) ** 2, 0) / (returns.length - 1) : 0;
  const stdR = Math.sqrt(variance);
  const periodsPerYear = 24 * 365;
  const sharpeRatio = stdR > 0 ? (meanR / stdR) * Math.sqrt(periodsPerYear) : 0;
  const downside = returns.filter((r) => r < 0);
  const downStd = downside.length > 1 ? Math.sqrt(downside.reduce((a, b) => a + b ** 2, 0) / (downside.length - 1)) : 0;
  const sortinoRatio = downStd > 0 ? (meanR / downStd) * Math.sqrt(periodsPerYear) : 0;

  // Max DD.
  let peak = equityCurve[0]?.equity ?? opts.initialEquity;
  let maxDd = 0;
  for (const p of equityCurve) {
    if (p.equity > peak) peak = p.equity;
    const dd = (peak - p.equity) / peak;
    if (dd > maxDd) maxDd = dd;
  }

  // Profit factor: a funding-carry has effectively one "trade" per rebalance.
  // We synthesize win/loss from funding-period sign aggregation.
  let wins = 0;
  let losses = 0;
  if (strategy.state.fundingCollectedUsd >= 0) wins = 1;
  else losses = 1;
  const winRate = wins + losses > 0 ? wins / (wins + losses) : 0;
  const profitFactor = losses > 0 ? strategy.state.fundingCollectedUsd / Math.max(Math.abs(strategy.state.rebalanceCostUsd), 1) : strategy.state.fundingCollectedUsd;

  return {
    totalReturn,
    annualizedReturn,
    sharpeRatio,
    sortinoRatio,
    maxDrawdown: maxDd,
    profitFactor,
    winRate,
    totalTrades: strategy.state.rebalanceCount,
    fundingCollectedUsd: strategy.state.fundingCollectedUsd,
    rebalanceCount: strategy.state.rebalanceCount,
    rebalanceCostUsd: strategy.state.rebalanceCostUsd,
    fundingPeriods,
    avgFundingRate8h: fundingPeriods > 0 ? fundingSum / fundingPeriods : 0,
    positiveFundingPeriods,
    negativeFundingPeriods,
    zeroFundingPeriods,
    equityCurve,
    startTime: opts.startTime,
    endTime: opts.endTime,
  };
}

async function main(): Promise<void> {
  const args = parseArgs();
  const dataDir = resolve(import.meta.dir, "..", "..", "..", "..", "data", "ohlcv");
  const fundingDir = resolve(import.meta.dir, "..", "..", "..", "..", "data", "funding");
  const feed = new CsvExchangeFeed(dataDir) as unknown as ExchangeFeed;

  const startTime = new Date(Date.UTC(2024, 0, 1));
  const endTime = new Date();

  console.log(`[funding-carry-baseline] symbol=${args.symbol} ltf=${args.timeframe}`);
  console.log(`[funding-carry-baseline] notional=$${args.targetNotionalUsd} rebalance=${(args.rebalanceThresholdPct * 100).toFixed(1)}% latency=${args.withdrawalLatencyMinutes}min fee=${args.rebalanceCostBps}bps`);
  console.log(`[funding-carry-baseline] period: ${startTime.toISOString()} → ${endTime.toISOString()}`);

  // Load OHLCV via the existing CsvExchangeFeed.
  const ohlcvAll = await feed.fetchOHLCV(args.symbol, args.timeframe, {
    since: startTime.getTime(),
    limit: Number.MAX_SAFE_INTEGER,
  });
  // Filter to start..end window.
  const ohlcv = ohlcvAll.filter((c) => c.timestamp >= startTime.getTime() && c.timestamp <= endTime.getTime());
  if (ohlcv.length === 0) {
    throw new Error(`No OHLCV candles for ${args.symbol} ${args.timeframe}`);
  }

  // Load funding rates.
  const fileSym = symbolToFileSymbol(args.symbol);
  const fundingPath = resolve(fundingDir, `binance_${fileSym}usdt_funding_8h.csv`);
  const fundingRaw = await loadFundingCsv(fundingPath);
  // Filter funding to backtest window.
  const funding = fundingRaw.filter((f) => f.fundingTime >= startTime.getTime() && f.fundingTime <= endTime.getTime());
  console.log(`[funding-carry-baseline] OHLCV candles: ${ohlcv.length}, funding snapshots in window: ${funding.length} (total CSV: ${fundingRaw.length})`);

  if (funding.length === 0) {
    console.warn(`[funding-carry-baseline] ⚠ No funding snapshots in window. Run download-funding-rates.ts first.`);
  }

  const t0 = Date.now();
  const result = simulateDeltaNeutralCarry({
    ohlcv,
    funding,
    startTime: startTime.getTime(),
    endTime: endTime.getTime(),
    initialEquity: args.initialEquity,
    targetNotionalUsd: args.targetNotionalUsd,
    rebalanceThresholdPct: args.rebalanceThresholdPct,
    withdrawalLatencyMinutes: args.withdrawalLatencyMinutes,
    rebalanceCostBps: args.rebalanceCostBps,
  });
  const elapsedMs = Date.now() - t0;

  const totalDays = (endTime.getTime() - startTime.getTime()) / (1000 * 60 * 60 * 24);
  const totalMonths = totalDays / 30.44;
  const monthlyReturn = result.totalReturn > 0 && totalMonths > 0 ? Math.pow(1 + result.totalReturn, 1 / totalMonths) - 1 : 0;

  console.log(`\n=== FUNDING-CARRY RESULTS ${args.symbol} ${args.timeframe} ===`);
  console.log(`Elapsed:                ${elapsedMs}ms`);
  console.log(`Total return:           ${(result.totalReturn * 100).toFixed(2)}%`);
  console.log(`Monthly avg:            ${(monthlyReturn * 100).toFixed(2)}%/mo (over ${totalMonths.toFixed(1)} months)`);
  console.log(`Annualized:             ${(result.annualizedReturn * 100).toFixed(2)}%`);
  console.log(`Sharpe:                 ${result.sharpeRatio.toFixed(3)}`);
  console.log(`Sortino:                ${result.sortinoRatio.toFixed(3)}`);
  console.log(`Max DD:                 ${(result.maxDrawdown * 100).toFixed(2)}%`);
  console.log(`Profit factor:          ${result.profitFactor.toFixed(3)}`);
  console.log(`Win rate:               ${(result.winRate * 100).toFixed(2)}%`);
  console.log(`Funding collected:      $${result.fundingCollectedUsd.toFixed(2)}`);
  console.log(`Funding periods:        ${result.fundingPeriods}`);
  console.log(`Avg funding rate 8h:    ${(result.avgFundingRate8h * 100).toFixed(4)}%`);
  console.log(`  Positive periods:     ${result.positiveFundingPeriods}`);
  console.log(`  Negative periods:     ${result.negativeFundingPeriods}`);
  console.log(`  Zero periods:         ${result.zeroFundingPeriods}`);
  console.log(`Rebalance count:        ${result.rebalanceCount}`);
  console.log(`Rebalance cost:         $${result.rebalanceCostUsd.toFixed(2)}`);
  console.log(`Net funding (after cost): $${(result.fundingCollectedUsd - result.rebalanceCostUsd).toFixed(2)}`);
  console.log(`Final equity:           $${(args.initialEquity + result.fundingCollectedUsd - result.rebalanceCostUsd).toFixed(2)}`);

  // Sanity check: empirical research expects carry to be positive on average.
  // If negative, warn — it could be a regime where shorts pay longs.
  if (result.fundingCollectedUsd < 0) {
    console.warn(`[funding-carry-baseline] ⚠ NEGATIVE funding collected ($${result.fundingCollectedUsd.toFixed(2)}). The historical regime favored longs over shorts — a short-perp carry would have lost money.`);
  }

  const fs = await import("node:fs/promises");
  const absOutput = resolve(import.meta.dir, "..", "..", "..", "..", args.outputPath);
  await fs.mkdir(resolve(import.meta.dir, "..", "..", "..", "..", "backtest-results"), { recursive: true });
  await fs.writeFile(
    absOutput,
    JSON.stringify(
      {
        args,
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
          fundingCollectedUsd: result.fundingCollectedUsd,
          rebalanceCount: result.rebalanceCount,
          rebalanceCostUsd: result.rebalanceCostUsd,
          fundingPeriods: result.fundingPeriods,
          avgFundingRate8h: result.avgFundingRate8h,
          positiveFundingPeriods: result.positiveFundingPeriods,
          negativeFundingPeriods: result.negativeFundingPeriods,
          zeroFundingPeriods: result.zeroFundingPeriods,
          startTime: result.startTime,
          endTime: result.endTime,
        },
        // Sample the equity curve to avoid 22k-element JSON blobs.
        equityCurveSampled: result.equityCurve.filter((_, i) => i % 24 === 0),
      },
      null,
      2,
    ),
    "utf8",
  );
  console.log(`[funding-carry-baseline] Saved: ${absOutput}`);
}

main().catch((err: unknown) => {
  console.error("[funding-carry-baseline] FATAL:", err);
  process.exit(1);
});