#!/usr/bin/env bun
// packages/backtest-tools/src/cli/run-funding-carry-leverage.ts — Phase 7 Track C
// leveraged funding-carry baseline backtest CLI runner.
//
// The runner drives a delta-neutral funding-carry simulation with leverage
// applied to the perp leg, using:
//   - Phase 1 OHLCV (BTC/ETH/SOL × 1h, 2024-01 → 2026-07)
//   - Historical funding rates from data/funding/binance_<sym>_funding_8h.csv
//   - FundingCarryLeverageStrategy for VaR-gated leverage + liquidation buffer
//   - bybit.eu SPOT-only cost model (Phase 6 carry baseline)
//
// The deliverable 9 baseline JSONs:
//   - baseline-funding-carry-leverage-{btc,eth,sol}-1h-{1,2,3}.json
//   - 3 symbols × 3 leverage variants (1×, 2×, 3×)
//
// Output JSON includes Phase 7 Track C-specific fields:
//   - leverage, avgLeverageUsed, liquidationEvents (must be 0)
//   - dailyVaR95Pct (parametric), maxDailyVaR95PctObserved
//   - fundingCollectedScaledUsd (payments at scaled notional)
//   - rebalanceCount, rebalanceCostScaledUsd
//
// Usage:
//   bun run packages/backtest-tools/src/cli/run-funding-carry-leverage.ts
//   bun run packages/backtest-tools/src/cli/run-funding-carry-leverage.ts --symbol=BTC/USDT --timeframe=1h --leverage=2
//   bun run packages/backtest-tools/src/cli/run-funding-carry-leverage.ts --output=backtest-results/baseline-funding-carry-leverage-btc-1h-2.json

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { CsvExchangeFeed } from "../data/csv-feed.js";
import type { ExchangeFeed } from "@mm-crypto-bot/backtest";
import { FundingCarryLeverageStrategy } from "@mm-crypto-bot/core";
import type { LeveragedCarryConfig, LiquidationEvent } from "@mm-crypto-bot/core";
import type { Timeframe } from "@mm-crypto-bot/shared/types";

interface CliArgs {
  readonly symbol: string;
  readonly timeframe: Timeframe;
  readonly initialEquity: number;
  readonly leverage: number; // 1, 2, 3, 5
  readonly baseNotionalUsd: number;
  readonly rebalanceThresholdPct: number;
  readonly withdrawalLatencyMinutes: number;
  readonly rebalanceCostBps: number;
  readonly varConfidence: number;
  readonly maxDailyVarPct: number;
  readonly maxLeverage: number;
  readonly outputPath: string;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  let symbol = "BTC/USDT";
  let timeframe: Timeframe = "1h";
  let initialEquity = 10_000;
  let leverage = 2;
  let baseNotionalUsd = 10_000;
  let rebalanceThresholdPct = 0.05;
  let withdrawalLatencyMinutes = 15;
  let rebalanceCostBps = 20;
  let varConfidence = 0.95;
  let maxDailyVarPct = 0.02;
  let maxLeverage = 3;
  let outputPath = "backtest-results/baseline-funding-carry-leverage-btc-1h-2.json";
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
    } else if (arg.startsWith("--leverage=")) {
      leverage = Number(arg.slice("--leverage=".length));
    } else if (arg.startsWith("--notional=")) {
      baseNotionalUsd = Number(arg.slice("--notional=".length));
    } else if (arg.startsWith("--rebalance=")) {
      rebalanceThresholdPct = Number(arg.slice("--rebalance=".length));
    } else if (arg.startsWith("--latency=")) {
      withdrawalLatencyMinutes = Number(arg.slice("--latency=".length));
    } else if (arg.startsWith("--fee-bps=")) {
      rebalanceCostBps = Number(arg.slice("--fee-bps=".length));
    } else if (arg.startsWith("--var-conf=")) {
      varConfidence = Number(arg.slice("--var-conf=".length));
    } else if (arg.startsWith("--var-cap=")) {
      maxDailyVarPct = Number(arg.slice("--var-cap=".length));
    } else if (arg.startsWith("--max-lev=")) {
      maxLeverage = Number(arg.slice("--max-lev=".length));
    } else if (arg.startsWith("--output=")) {
      outputPath = arg.slice("--output=".length);
    }
  }
  return {
    symbol,
    timeframe,
    initialEquity,
    leverage,
    baseNotionalUsd,
    rebalanceThresholdPct,
    withdrawalLatencyMinutes,
    rebalanceCostBps,
    varConfidence,
    maxDailyVarPct,
    maxLeverage,
    outputPath,
  };
}

function symbolToFileSymbol(ccxtSymbol: string): string {
  return ccxtSymbol.split("/")[0]!.toLowerCase();
}

async function loadFundingCsv(path: string): Promise<
  readonly { fundingTime: number; symbol: string; fundingRate: number }[]
> {
  const raw = await readFile(path, "utf8");
  const lines = raw.split("\n");
  const out: { fundingTime: number; symbol: string; fundingRate: number }[] = [];
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

interface LeveragePoint {
  readonly timestamp: number;
  readonly equity: number;
  readonly fundingAccruedUsd: number;
  readonly markPrice: number;
  readonly leverage: number;
  readonly dailyVaR95Pct: number;
}

interface LeverageResult {
  readonly totalReturn: number;
  readonly annualizedReturn: number;
  readonly sharpeRatio: number;
  readonly sortinoRatio: number;
  readonly maxDrawdown: number;
  readonly profitFactor: number;
  readonly winRate: number;
  readonly totalTrades: number;
  readonly fundingCollectedUsd: number;
  readonly fundingCollectedScaledUsd: number;
  readonly rebalanceCount: number;
  readonly rebalanceCostUsd: number;
  readonly fundingPeriods: number;
  readonly avgFundingRate8h: number;
  readonly positiveFundingPeriods: number;
  readonly negativeFundingPeriods: number;
  readonly zeroFundingPeriods: number;
  readonly equityCurve: readonly LeveragePoint[];
  readonly startTime: number;
  readonly endTime: number;
  readonly leverage: number;
  readonly maxLeverageUsed: number;
  readonly avgLeverageUsed: number;
  readonly initialMarginUsd: number;
  readonly maintenanceMarginUsd: number;
  readonly dailyVaR95Pct: number;
  readonly maxDailyVaR95PctObserved: number;
  readonly liquidationEvents: number;
  readonly liquidationEventTimestamps: readonly number[];
}

/**
 * `simulateLeveragedCarry` — the core leveraged delta-neutral carry
 * simulation loop. Combines:
 *   - 1h OHLCV mark-price feed
 *   - 8h Binance funding-rate snapshots
 *   - FundingCarryLeverageStrategy VaR-gated leverage + liquidation buffer
 *   - bybit.eu SPOT-only cost model
 *
 * The strategy's `state` is mutated on every step; at the end we read
 * the carry-specific metrics off the state.
 */
function simulateLeveragedCarry(opts: {
  readonly ohlcv: readonly { timestamp: number; close: number }[];
  readonly funding: readonly { fundingTime: number; symbol: string; fundingRate: number }[];
  readonly startTime: number;
  readonly endTime: number;
  readonly initialEquity: number;
  readonly config: LeveragedCarryConfig;
  readonly leverage: number;
}): LeverageResult {
  const cfg = opts.config;
  const strategy = new FundingCarryLeverageStrategy(cfg);

  // Set the explicit leverage for this run. The strategy's
  // `computeEffectiveLeverage` would normally adjust it dynamically
  // per funding-rate stability, but for the static baseline runs we
  // pin it to the requested value so the leverage comparisons (1× vs
  // 2× vs 3×) are apples-to-apples.
  strategy.setEffectiveLeverage(opts.leverage);
  const pinnedLeverage = strategy.state.currentLeverage;

  if (opts.ohlcv.length === 0) {
    throw new Error("No OHLCV candles in the requested period");
  }

  const equityCurve: LeveragePoint[] = [];
  let lastFundingTime = 0;
  let fundingPeriods = 0;
  let positiveFundingPeriods = 0;
  let negativeFundingPeriods = 0;
  let zeroFundingPeriods = 0;
  let fundingSum = 0;
  let maxVaR95PctObs = 0;
  let leverageSum = 0;
  let leverageObs = 0;
  let maxLeverageObs = pinnedLeverage;
  const liquidationEvents: LiquidationEvent[] = [];

  // Compute daily equity returns at every full day (24 hourly candles).
  const dailyEquitySnapshots: number[] = [];
  let prevDayEquity: number | null = null;

  // Synthetic delta-sensitivity for funding compounding the basis.
  // Same as Phase 6 baseline (deltaSensitivity = 0.01).
  const deltaSensitivity = 0.01;

  // Track mark-to-market equity at every funding event for the
  // post-hoc VaR computation.
  const equityReturnsForVar: number[] = [];

  for (const candle of opts.ohlcv) {
    // Funding accrual: process any funding snapshots since lastFundingTime.
    // We DON'T use the FundingRateProvider here — the loadFundingCsv result
    // is already sorted ascending by fundingTime (CSV emits in order).
    // Linear scan up to candle.timestamp is O(n_total + n_candles) and
    // trivial for our 30-month dataset (~2,700 snapshots, ~22k hourly candles).
    for (let i = fundingPeriods; i < opts.funding.length; i++) {
      const snap = opts.funding[i]!;
      if (snap.fundingTime > candle.timestamp) break;
      if (snap.fundingTime <= lastFundingTime) continue;
      const payment = strategy.accrueFundingScaled(snap.fundingRate, snap.fundingTime);
      fundingSum += snap.fundingRate;
      fundingPeriods += 1;
      if (snap.fundingRate > 0) positiveFundingPeriods += 1;
      else if (snap.fundingRate < 0) negativeFundingPeriods += 1;
      else zeroFundingPeriods += 1;
      lastFundingTime = snap.fundingTime;
      void payment;
    }

    // Update mark-to-market equity.
    const cumFundingUsd = strategy.state.fundingCollectedUsd;
    const driftUsd = cumFundingUsd * deltaSensitivity;
    const currentEquity = opts.initialEquity + strategy.totalNetPnlUsd();

    // Compute the daily return sample (for VaR computation). Once
    // every 24h, snapshot the equity vs. previous daily snapshot.
    prevDayEquity ??= currentEquity;
    dailyEquitySnapshots.push(currentEquity);
    if (dailyEquitySnapshots.length > 24) {
      const oldEq = dailyEquitySnapshots[0]!;
      if (oldEq > 0) {
        const r = (currentEquity - oldEq) / oldEq;
        equityReturnsForVar.push(r);
      }
      dailyEquitySnapshots.shift();
    }

    // Liquidation buffer check: compute the unrealized PnL of the
    // spot leg vs. the entry price (driftSensitivity approximation).
    // If margin breaches, count a liquidation event AND stop applying
    // further leverage (set leverage to min, freeze).
    const unrealizedSpotPnl = driftUsd; // conservative proxy
    const breached = strategy.checkLiquidationThreshold(unrealizedSpotPnl);
    if (breached) {
      // Record + freeze at min leverage for the rest of the run.
      liquidationEvents.push({
        timestampMs: candle.timestamp,
        markPrice: candle.close,
        leverage: strategy.state.currentLeverage,
        initialMarginUsd: strategy.state.initialMarginUsd,
        maintenanceMarginUsd: strategy.state.maintenanceMarginUsd,
        marginRatio:
          strategy.state.maintenanceMarginUsd /
          (strategy.state.initialMarginUsd + unrealizedSpotPnl),
        effectiveNotionalUsd: strategy.state.effectiveNotionalUsd,
      });
      strategy.setEffectiveLeverage(strategy.config.minLeverage);
    }

    // Rebalance check (drift-based).
    strategy.triggerRebalance(driftUsd);

    // Compute VaR for the currently effective notional.
    if (equityReturnsForVar.length >= 20) {
      const varUsd = strategy.computeDailyVaR(
        strategy.state.effectiveNotionalUsd,
        equityReturnsForVar,
      );
      const varPct =
        strategy.state.effectiveNotionalUsd > 0
          ? varUsd / strategy.state.effectiveNotionalUsd
          : 0;
      if (varPct > maxVaR95PctObs) maxVaR95PctObs = varPct;
    }

    // Track leverage usage (for avg / max).
    leverageSum += strategy.state.currentLeverage;
    leverageObs += 1;
    if (strategy.state.currentLeverage > maxLeverageObs) {
      maxLeverageObs = strategy.state.currentLeverage;
    }

    equityCurve.push({
      timestamp: candle.timestamp,
      equity: currentEquity,
      fundingAccruedUsd: cumFundingUsd,
      markPrice: candle.close,
      leverage: strategy.state.currentLeverage,
      dailyVaR95Pct: 0, // filled in at end
    });
  }

  // Final VaR snapshot on full series.
  let finalVarPct = 0;
  if (equityReturnsForVar.length >= 20) {
    const finalVarUsd = strategy.computeDailyVaR(
      strategy.state.effectiveNotionalUsd,
      equityReturnsForVar,
    );
    finalVarPct =
      strategy.state.effectiveNotionalUsd > 0
        ? finalVarUsd / strategy.state.effectiveNotionalUsd
        : 0;
  }
  strategy.state.dailyVaR95Pct = finalVarPct;
  // Back-fill the last point.
  if (equityCurve.length > 0) {
    equityCurve[equityCurve.length - 1] = {
      ...equityCurve[equityCurve.length - 1]!,
      dailyVaR95Pct: finalVarPct,
    };
  }

  // Compute metrics.
  const totalReturn = strategy.state.fundingCollectedUsd / opts.initialEquity;
  const elapsedDays = (opts.endTime - opts.startTime) / (1000 * 60 * 60 * 24);
  const years = elapsedDays / 365.25;
  const annualizedReturn = years > 0 ? (Math.pow(1 + totalReturn, 1 / years) - 1) : 0;

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
    downside.length > 1
      ? Math.sqrt(downside.reduce((a, b) => a + b ** 2, 0) / (downside.length - 1))
      : 0;
  const sortinoRatio = downStd > 0 ? (meanR / downStd) * Math.sqrt(periodsPerYear) : 0;

  // Max DD.
  let peak = equityCurve[0]?.equity ?? opts.initialEquity;
  let maxDd = 0;
  for (const p of equityCurve) {
    if (p.equity > peak) peak = p.equity;
    const dd = (peak - p.equity) / peak;
    if (dd > maxDd) maxDd = dd;
  }

  // Profit factor.
  const wins = liquidationEvents.length === 0 && strategy.state.fundingCollectedUsd >= 0 ? 1 : 0;
  const losses = liquidationEvents.length > 0 ? 1 : 0;
  const winRate = wins + losses > 0 ? wins / (wins + losses) : 0;
  const profitFactor =
    losses > 0
      ? strategy.state.fundingCollectedUsd / Math.max(Math.abs(strategy.state.rebalanceCostUsd), 1)
      : strategy.state.fundingCollectedUsd;

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
    fundingCollectedScaledUsd: strategy.state.fundingCollectedUsd, // scaled by leverage already
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
    leverage: pinnedLeverage,
    maxLeverageUsed: maxLeverageObs,
    avgLeverageUsed: leverageObs > 0 ? leverageSum / leverageObs : pinnedLeverage,
    initialMarginUsd: strategy.state.initialMarginUsd,
    maintenanceMarginUsd: strategy.state.maintenanceMarginUsd,
    dailyVaR95Pct: finalVarPct,
    maxDailyVaR95PctObserved: maxVaR95PctObs,
    liquidationEvents: liquidationEvents.length,
    liquidationEventTimestamps: liquidationEvents.map((e) => e.timestampMs),
  };
}

async function main(): Promise<void> {
  const args = parseArgs();
  const dataDir = resolve(import.meta.dir, "..", "..", "..", "..", "data", "ohlcv");
  const fundingDir = resolve(import.meta.dir, "..", "..", "..", "..", "data", "funding");
  const feed = new CsvExchangeFeed(dataDir) as unknown as ExchangeFeed;

  const startTime = new Date(Date.UTC(2024, 0, 1));
  const endTime = new Date();

  console.log(
    `[funding-carry-leverage] symbol=${args.symbol} ltf=${args.timeframe} leverage=${args.leverage}×`,
  );
  console.log(
    `[funding-carry-leverage] baseNotional=$${args.baseNotionalUsd} rebalance=${(args.rebalanceThresholdPct * 100).toFixed(1)}% latency=${args.withdrawalLatencyMinutes}min fee=${args.rebalanceCostBps}bps`,
  );
  console.log(
    `[funding-carry-leverage] VaR: conf=${(args.varConfidence * 100).toFixed(0)}% cap=${(args.maxDailyVarPct * 100).toFixed(2)}%/day  maxLev=${args.maxLeverage}×`,
  );
  console.log(`[funding-carry-leverage] period: ${startTime.toISOString()} → ${endTime.toISOString()}`);

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
  console.log(
    `[funding-carry-leverage] OHLCV candles: ${ohlcv.length}, funding snapshots in window: ${funding.length} (total CSV: ${fundingRaw.length})`,
  );

  if (funding.length === 0) {
    console.warn(`[funding-carry-leverage] ⚠ No funding snapshots in window.`);
  }

  // Sanity: requested leverage must not exceed maxLeverage.
  if (args.leverage > args.maxLeverage) {
    throw new Error(
      `Requested leverage ${args.leverage} exceeds configured maxLeverage ${args.maxLeverage}.`,
    );
  }

  // Sort funding ascending by time (the CSV is already in order, but be safe).
  const fundingSorted = [...funding].sort((a, b) => a.fundingTime - b.fundingTime);

  const cfg: LeveragedCarryConfig = {
    baseNotionalUsd: args.baseNotionalUsd,
    maxLeverage: args.maxLeverage,
    minLeverage: 1,
    rebalanceThresholdPct: args.rebalanceThresholdPct,
    withdrawalLatencyMinutes: args.withdrawalLatencyMinutes,
    rebalanceCostBps: args.rebalanceCostBps,
    varConfidence: args.varConfidence,
    maxDailyVarPct: args.maxDailyVarPct,
    varMethod: "parametric",
    minInitialMarginFraction: 0.5,
    fundingStabilityWindowDays: 30,
    fundingStabilityRefStdDev: 0.0005,
  };

  const t0 = Date.now();
  const result = simulateLeveragedCarry({
    ohlcv,
    funding: fundingSorted,
    startTime: startTime.getTime(),
    endTime: endTime.getTime(),
    initialEquity: args.initialEquity,
    config: cfg,
    leverage: args.leverage,
  });
  const elapsedMs = Date.now() - t0;

  const totalDays = (endTime.getTime() - startTime.getTime()) / (1000 * 60 * 60 * 24);
  const totalMonths = totalDays / 30.44;
  const monthlyReturn =
    result.totalReturn > 0 && totalMonths > 0
      ? Math.pow(1 + result.totalReturn, 1 / totalMonths) - 1
      : 0;

  console.log(`\n=== LEVERAGED FUNDING-CARRY RESULTS ${args.symbol} ${args.timeframe} ${args.leverage}× ===`);
  console.log(`Elapsed:                          ${elapsedMs}ms`);
  console.log(`Total return:                     ${(result.totalReturn * 100).toFixed(2)}%`);
  console.log(`Monthly avg:                      ${(monthlyReturn * 100).toFixed(2)}%/mo (over ${totalMonths.toFixed(1)} months)`);
  console.log(`Annualized:                       ${(result.annualizedReturn * 100).toFixed(2)}%`);
  console.log(`Sharpe:                           ${result.sharpeRatio.toFixed(3)}`);
  console.log(`Sortino:                          ${result.sortinoRatio.toFixed(3)}`);
  console.log(`Max DD:                           ${(result.maxDrawdown * 100).toFixed(2)}%`);
  console.log(`Profit factor:                    ${result.profitFactor.toFixed(3)}`);
  console.log(`Funding collected (scaled):       $${result.fundingCollectedScaledUsd.toFixed(2)}`);
  console.log(`Funding periods:                  ${result.fundingPeriods}`);
  console.log(`Avg funding rate 8h:              ${(result.avgFundingRate8h * 100).toFixed(4)}%`);
  console.log(`  Positive periods:               ${result.positiveFundingPeriods}`);
  console.log(`  Negative periods:               ${result.negativeFundingPeriods}`);
  console.log(`  Zero periods:                   ${result.zeroFundingPeriods}`);
  console.log(`Rebalance count:                  ${result.rebalanceCount}`);
  console.log(`Rebalance cost (scaled):          $${result.rebalanceCostUsd.toFixed(2)}`);
  console.log(`Final equity:                     $${(args.initialEquity + result.fundingCollectedScaledUsd - result.rebalanceCostUsd).toFixed(2)}`);
  console.log(`--- Phase 7 Track C risk metrics ---`);
  console.log(`Pinned leverage:                  ${result.leverage}×`);
  console.log(`Avg / max leverage used:          ${result.avgLeverageUsed.toFixed(2)}× / ${result.maxLeverageUsed}×`);
  console.log(`Initial margin:                   $${result.initialMarginUsd.toFixed(2)}`);
  console.log(`Maintenance margin:               $${result.maintenanceMarginUsd.toFixed(2)}`);
  console.log(`Daily VaR 95% (final):            ${(result.dailyVaR95Pct * 100).toFixed(4)}%`);
  console.log(`Max daily VaR 95% observed:       ${(result.maxDailyVaR95PctObserved * 100).toFixed(4)}%`);
  console.log(`Liquidation events:               ${result.liquidationEvents} (MUST be 0)`);
  if (result.liquidationEvents > 0) {
    console.error(
      `[funding-carry-leverage] ✗ ${result.liquidationEvents} liquidation events detected at ${args.leverage}× — REDUCE leverage.`,
    );
  }
  if (result.maxDailyVaR95PctObserved > args.maxDailyVarPct) {
    console.error(
      `[funding-carry-leverage] ✗ VaR cap exceeded (max observed ${(result.maxDailyVaR95PctObserved * 100).toFixed(2)}% > cap ${(args.maxDailyVarPct * 100).toFixed(2)}%)`,
    );
  }

  const fs = await import("node:fs/promises");
  const absOutput = resolve(import.meta.dir, "..", "..", "..", "..", args.outputPath);
  await fs.mkdir(resolve(import.meta.dir, "..", "..", "..", "..", "backtest-results"), {
    recursive: true,
  });
  await fs.writeFile(
    absOutput,
    JSON.stringify(
      {
        args,
        config: cfg,
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
          fundingCollectedScaledUsd: result.fundingCollectedScaledUsd,
          rebalanceCount: result.rebalanceCount,
          rebalanceCostUsd: result.rebalanceCostUsd,
          fundingPeriods: result.fundingPeriods,
          avgFundingRate8h: result.avgFundingRate8h,
          positiveFundingPeriods: result.positiveFundingPeriods,
          negativeFundingPeriods: result.negativeFundingPeriods,
          zeroFundingPeriods: result.zeroFundingPeriods,
          leverage: result.leverage,
          maxLeverageUsed: result.maxLeverageUsed,
          avgLeverageUsed: result.avgLeverageUsed,
          initialMarginUsd: result.initialMarginUsd,
          maintenanceMarginUsd: result.maintenanceMarginUsd,
          dailyVaR95Pct: result.dailyVaR95Pct,
          maxDailyVaR95PctObserved: result.maxDailyVaR95PctObserved,
          liquidationEvents: result.liquidationEvents,
          liquidationEventTimestamps: result.liquidationEventTimestamps,
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
  console.log(`[funding-carry-leverage] Saved: ${absOutput}`);
}

main().catch((err: unknown) => {
  console.error("[funding-carry-leverage] FATAL:", err);
  process.exit(1);
});
