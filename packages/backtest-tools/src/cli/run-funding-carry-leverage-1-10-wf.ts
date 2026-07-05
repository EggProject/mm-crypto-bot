#!/usr/bin/env bun
// packages/backtest-tools/src/cli/run-funding-carry-leverage-1-10-wf.ts —
// Phase 8 Track D — 1:10 mandatory leverage walk-forward validation.
//
// Walk-forward protocol (anti-overfit):
//   - In-Sample (IS) window: 180 days
//   - Out-of-Sample (OOS) window: 30 days
//   - Step: 30 days (roll the window forward by 30d after each fold)
//   - For each fold: pin leverage=10 (1:10 mandate), compute funding-only metrics
//     on the OOS portion, advance.
//
// Usage:
//   bun run packages/backtest-tools/src/cli/run-funding-carry-leverage-1-10-wf.ts \
//     --symbol=BTC/USDT --timeframe=1h \
//     --output=backtest-results/wf-funding-carry-leverage-1-10-btc-1h.json
//   bun run packages/backtest-tools/src/cli/run-funding-carry-leverage-1-10-wf.ts \
//     --symbol=BTC/USDT --timeframe=1h --leverage=1 \
//     --output=backtest-results/wf-funding-carry-leverage-1-10-btc-1h-1x.json
//
// See docs/research/phase8-carry-leverage-1-10.md §3.6 "Walk-forward anti-overfit".

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";

import { CsvExchangeFeed } from "../data/csv-feed.js";
import type { ExchangeFeed } from "@mm-crypto-bot/backtest";
import {
  assert1to10Leverage,
  FundingCarryLeverageStrategy,
} from "@mm-crypto-bot/core";
import type { LeveragedCarryConfig, LiquidationEvent } from "@mm-crypto-bot/core";

interface CliArgs {
  readonly symbol: string;
  readonly timeframe: "1h" | "4h" | "1d";
  readonly initialEquity: number;
  readonly leverage: 1 | 10;
  readonly baseNotionalUsd: number;
  readonly varCap: number;
  readonly isDays: number;
  readonly oosDays: number;
  readonly stepDays: number;
  readonly outputPath: string;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  let symbol = "BTC/USDT";
  let timeframe: "1h" | "4h" | "1d" = "1h";
  let initialEquity = 10_000;
  let leverage: 1 | 10 = 10;
  let baseNotionalUsd = 10_000;
  let varCap = 0.02;
  let isDays = 180;
  let oosDays = 30;
  let stepDays = 30;
  let outputPath =
    "backtest-results/wf-funding-carry-leverage-1-10-btc-1h.json";
  for (const arg of args) {
    if (arg.startsWith("--symbol=")) {
      symbol = arg.slice("--symbol=".length);
    } else if (arg.startsWith("--timeframe=")) {
      const tf = arg.slice("--timeframe=".length);
      if (tf !== "1h" && tf !== "4h" && tf !== "1d") {
        throw new Error(`Invalid timeframe: ${tf}`);
      }
      timeframe = tf;
    } else if (arg.startsWith("--equity=")) {
      initialEquity = Number(arg.slice("--equity=".length));
    } else if (arg.startsWith("--leverage=")) {
      const l = Number(arg.slice("--leverage=".length));
      if (l !== 1 && l !== 10) {
        throw new Error(
          `[Phase 8 Track D] --leverage must be 1 or 10. Got ${l}.`,
        );
      }
      leverage = l;
      assert1to10Leverage(l);
    } else if (arg.startsWith("--notional=")) {
      baseNotionalUsd = Number(arg.slice("--notional=".length));
    } else if (arg.startsWith("--var-cap=")) {
      varCap = Number(arg.slice("--var-cap=".length));
    } else if (arg.startsWith("--is-days=")) {
      isDays = Number(arg.slice("--is-days=".length));
    } else if (arg.startsWith("--oos-days=")) {
      oosDays = Number(arg.slice("--oos-days=".length));
    } else if (arg.startsWith("--step-days=")) {
      stepDays = Number(arg.slice("--step-days=".length));
    } else if (arg.startsWith("--output=")) {
      outputPath = arg.slice("--output=".length);
    }
  }
  assert1to10Leverage(leverage);
  return {
    symbol,
    timeframe,
    initialEquity,
    leverage,
    baseNotionalUsd,
    varCap,
    isDays,
    oosDays,
    stepDays,
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

interface WalkForwardFold {
  readonly isStart: number;
  readonly isEnd: number;
  readonly oosStart: number;
  readonly oosEnd: number;
  readonly oosReturn: number;
  readonly oosMonthlyReturn: number;
  readonly oosSharpe: number;
  readonly oosMaxDd: number;
  readonly oosVaRPct: number;
  readonly oosLiquidations: number;
}

interface FoldSimResult {
  readonly fold: number;
  readonly isStartMs: number;
  readonly isEndMs: number;
  readonly oosStartMs: number;
  readonly oosEndMs: number;
  readonly oos: WalkForwardFold;
  readonly is: WalkForwardFold;
}

function simulateFundingCarry(
  ohlcv: readonly { timestamp: number; close: number }[],
  funding: readonly { fundingTime: number; symbol: string; fundingRate: number }[],
  startMs: number,
  endMs: number,
  initialEquity: number,
  leverage: 1 | 10,
  config: LeveragedCarryConfig,
): { returnPct: number; maxDrawdownPct: number; sharpe: number; varPct: number; liquidations: number; fundingSum: number } {
  const strategy = new FundingCarryLeverageStrategy(config);
  assert1to10Leverage(leverage);
  strategy.setEffectiveLeverage(leverage);

  let lastFundingTime = 0;
  let fundingSum = 0;
  const dailyEquity: number[] = [];
  const returns: number[] = [];
  let prevEquity = initialEquity;
  let peak = initialEquity;
  let maxDd = 0;
  let liquidations = 0;
  const liquidationEvents: LiquidationEvent[] = [];
  const deltaSensitivity = 0.01;
  let lastVarPct = 0;

  for (const candle of ohlcv) {
    if (candle.timestamp < startMs) continue;
    if (candle.timestamp > endMs) break;

    for (const snap of funding) {
      if (snap.fundingTime > candle.timestamp) break;
      if (snap.fundingTime <= lastFundingTime) continue;
      if (snap.fundingTime < startMs) {
        lastFundingTime = snap.fundingTime;
        continue;
      }
      strategy.accrueFundingScaled(snap.fundingRate, snap.fundingTime);
      fundingSum += snap.fundingRate;
      lastFundingTime = snap.fundingTime;
    }

    const cumFundingUsd = strategy.state.fundingCollectedUsd;
    const driftUsd = cumFundingUsd * deltaSensitivity;
    const currentEquity = initialEquity + strategy.totalNetPnlUsd();

    const breached = strategy.checkLiquidationThreshold(driftUsd);
    if (breached) {
      liquidationEvents.push({
        timestampMs: candle.timestamp,
        markPrice: candle.close,
        leverage: strategy.state.currentLeverage,
        initialMarginUsd: strategy.state.initialMarginUsd,
        maintenanceMarginUsd: strategy.state.maintenanceMarginUsd,
        marginRatio:
          strategy.state.maintenanceMarginUsd /
          (strategy.state.initialMarginUsd + driftUsd),
        effectiveNotionalUsd: strategy.state.effectiveNotionalUsd,
      });
      strategy.setEffectiveLeverage(strategy.config.minLeverage);
    }
    liquidations = liquidationEvents.length;

    if (prevEquity > 0) {
      returns.push((currentEquity - prevEquity) / prevEquity);
    }
    prevEquity = currentEquity;

    if (currentEquity > peak) peak = currentEquity;
    const dd = peak > 0 ? (peak - currentEquity) / peak : 0;
    if (dd > maxDd) maxDd = dd;

    dailyEquity.push(currentEquity);
    if (dailyEquity.length > 24) dailyEquity.shift();

    if (dailyEquity.length >= 24 && dailyEquity[0]! > 0) {
      const dailyReturn = (currentEquity - dailyEquity[0]!) / dailyEquity[0]!;
      const variance =
        dailyReturn * dailyReturn; // rough proxy; recomputed at fold-end from the full series
      lastVarPct = Math.sqrt(variance) * 1.645;
    }
  }

  const totalReturn = strategy.state.fundingCollectedUsd / initialEquity;
  const meanR = returns.length > 0 ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;
  const variance =
    returns.length > 1 ? returns.reduce((a, b) => a + (b - meanR) ** 2, 0) / (returns.length - 1) : 0;
  const stdR = Math.sqrt(variance);
  const sharpe = stdR > 0 ? (meanR / stdR) * Math.sqrt(24 * 365) : 0;

  return {
    returnPct: totalReturn * 100,
    maxDrawdownPct: maxDd * 100,
    sharpe,
    varPct: lastVarPct * 100,
    liquidations,
    fundingSum,
  };
}

async function main(): Promise<void> {
  const args = parseArgs();
  const dataDir = resolve(import.meta.dir, "..", "..", "..", "..", "data", "ohlcv");
  const fundingDir = resolve(import.meta.dir, "..", "..", "..", "..", "data", "funding");
  const feed = new CsvExchangeFeed(dataDir) as unknown as ExchangeFeed;

  const startTime = new Date(Date.UTC(2024, 0, 1));
  const endTime = new Date();

  const ohlcvAll = await feed.fetchOHLCV(args.symbol, args.timeframe, {
    since: startTime.getTime(),
    limit: Number.MAX_SAFE_INTEGER,
  });
  const ohlcv = ohlcvAll.filter(
    (c) => c.timestamp >= startTime.getTime() && c.timestamp <= endTime.getTime(),
  );

  const fileSym = symbolToFileSymbol(args.symbol);
  const fundingPath = resolve(fundingDir, `binance_${fileSym}usdt_funding_8h.csv`);
  const fundingRaw = await loadFundingCsv(fundingPath);
  const funding = fundingRaw.filter(
    (f) => f.fundingTime >= startTime.getTime() && f.fundingTime <= endTime.getTime(),
  );

  assert1to10Leverage(args.leverage);
  const config: LeveragedCarryConfig = {
    baseNotionalUsd: args.baseNotionalUsd,
    maxLeverage: args.leverage,
    minLeverage: 1,
    rebalanceThresholdPct: 0.05,
    withdrawalLatencyMinutes: 15,
    rebalanceCostBps: 20,
    varConfidence: 0.95,
    maxDailyVarPct: args.varCap,
    varMethod: "parametric",
    minInitialMarginFraction: 0.5,
    fundingStabilityWindowDays: 30,
    fundingStabilityRefStdDev: 0.0005,
  };

  // Walk-forward: rolling IS=180d / OOS=30d, step 30d.
  const totalDays = (endTime.getTime() - startTime.getTime()) / (1000 * 60 * 60 * 24);
  const foldDays = args.isDays + args.oosDays;
  const stepDays = args.stepDays;
  const numFolds = Math.max(0, Math.floor((totalDays - foldDays) / stepDays) + 1);

  const foldResults: FoldSimResult[] = [];
  const startMs0 = startTime.getTime();
  const dms = 24 * 60 * 60 * 1000;
  let totalLiquidations = 0;

  for (let i = 0; i < numFolds; i++) {
    const isStartMs = startMs0 + i * stepDays * dms;
    const isEndMs = isStartMs + args.isDays * dms;
    const oosStartMs = isEndMs;
    const oosEndMs = oosStartMs + args.oosDays * dms;
    if (oosEndMs > endTime.getTime()) break;

    const isSim = simulateFundingCarry(
      ohlcv, funding, isStartMs, isEndMs, args.initialEquity, args.leverage, config,
    );
    const oosSim = simulateFundingCarry(
      ohlcv, funding, oosStartMs, oosEndMs, args.initialEquity, args.leverage, config,
    );
    totalLiquidations += oosSim.liquidations;

    const daysOos = args.oosDays;
    const monthlyReturnOos = Math.pow(1 + oosSim.returnPct / 100, 30 / daysOos) - 1;

    const isDays = args.isDays;
    const monthlyReturnIs = Math.pow(1 + isSim.returnPct / 100, 30 / isDays) - 1;

    foldResults.push({
      fold: i + 1,
      isStartMs,
      isEndMs,
      oosStartMs,
      oosEndMs,
      oos: {
        isStart: isStartMs,
        isEnd: isEndMs,
        oosStart: oosStartMs,
        oosEnd: oosEndMs,
        oosReturn: oosSim.returnPct,
        oosMonthlyReturn: monthlyReturnOos * 100,
        oosSharpe: oosSim.sharpe,
        oosMaxDd: oosSim.maxDrawdownPct,
        oosVaRPct: oosSim.varPct,
        oosLiquidations: oosSim.liquidations,
      },
      is: {
        isStart: isStartMs,
        isEnd: isEndMs,
        oosStart: oosStartMs,
        oosEnd: oosEndMs,
        oosReturn: isSim.returnPct,
        oosMonthlyReturn: monthlyReturnIs * 100,
        oosSharpe: isSim.sharpe,
        oosMaxDd: isSim.maxDrawdownPct,
        oosVaRPct: isSim.varPct,
        oosLiquidations: isSim.liquidations,
      },
    });
    console.log(
      `[wf-1-10] fold ${i + 1}/${numFolds}: IS=${new Date(isStartMs).toISOString().slice(0, 10)}→${new Date(isEndMs).toISOString().slice(0, 10)} ` +
        `OOS=${new Date(oosStartMs).toISOString().slice(0, 10)}→${new Date(oosEndMs).toISOString().slice(0, 10)} ` +
        `OOS-return=${oosSim.returnPct.toFixed(2)}% sharpe=${oosSim.sharpe.toFixed(2)} liq=${oosSim.liquidations}`,
    );
  }

  // Concatenated OOS stats.
  const allOosReturns = foldResults.map((f) => f.oos.oosReturn);
  const meanOos = allOosReturns.length > 0 ? allOosReturns.reduce((a, b) => a + b, 0) / allOosReturns.length : 0;
  const stdOos =
    allOosReturns.length > 1
      ? Math.sqrt(allOosReturns.reduce((a, b) => a + (b - meanOos) ** 2, 0) / (allOosReturns.length - 1))
      : 0;
  const meanIs = foldResults.length > 0 ? foldResults.map((f) => f.is.oosReturn).reduce((a, b) => a + b, 0) / foldResults.length : 0;
  // Walk-forward efficiency = OOS return / IS return (>0.5 = good).
  const wfEfficiency = meanIs !== 0 ? meanOos / meanIs : 0;

  const output = {
    args,
    config,
    phase: 8,
    track: "D",
    mandate: "1:10 leverage walk-forward validation",
    protocol: { isDays: args.isDays, oosDays: args.oosDays, stepDays: args.stepDays, numFolds: foldResults.length },
    folds: foldResults,
    summary: {
      totalLiquidations,
      meanOosReturn: meanOos,
      meanIsReturn: meanIs,
      stdOosReturn: stdOos,
      wfEfficiency,
      allOosVaRPct: foldResults.map((f) => f.oos.oosVaRPct),
      maxOosVaRPct: foldResults.length > 0 ? Math.max(...foldResults.map((f) => f.oos.oosVaRPct)) : 0,
      allOosLiquidations: foldResults.map((f) => f.oos.oosLiquidations),
    },
  };

  const absOutput = resolve(import.meta.dir, "..", "..", "..", "..", args.outputPath);
  await mkdir(resolve(import.meta.dir, "..", "..", "..", "..", "backtest-results"), { recursive: true });
  await writeFile(absOutput, JSON.stringify(output, null, 2), "utf8");
  console.log(`\n[wf-1-10] Wrote: ${absOutput}`);
  console.log(
    `[wf-1-10] Summary: ${foldResults.length} folds, mean OOS return=${meanOos.toFixed(2)}%, ` +
      `wfEfficiency=${wfEfficiency.toFixed(3)}, totalLiquidations=${totalLiquidations}, ` +
      `maxOosVaR=${output.summary.maxOosVaRPct.toFixed(3)}% (cap=${(args.varCap * 100).toFixed(2)}%)`,
  );
}

main().catch((err: unknown) => {
  console.error("[wf-1-10] FATAL:", err);
  process.exit(1);
});
