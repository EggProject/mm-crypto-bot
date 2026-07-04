#!/usr/bin/env bun
// packages/backtest-tools/src/cli/run-signal-center-bus.ts —
// Phase 10G Track A signal center bus CLI runner.
//
// ===========================================================================
// 1:10 MANDATORY LEVERAGE CONSTRAINT (HARD USER DIRECTIVE)
// ===========================================================================
// Project-wide mandate: every trade uses EXACTLY 1:10 leverage (10× notional
// on 1× capital, 9× borrowed from bybit.eu SPOT margin). 1× is permitted
// ONLY as the backtest baseline for scaling-curve comparison.
//
// This runner wraps the existing Phase 8 Track E `FundingCarryTimingStrategy`
// in the new `CarryBaselinePlugin` (Phase 10G Track A) and emits typed
// SignalBus events on every funding snapshot. The result mirrors
// `run-funding-carry-timing.ts` empirically (the plugin wraps the strategy,
// doesn't change its math) — so the baseline JSON should be ~equal to the
// Phase 8 Track E / Phase 9 V4 carry result.
//
// Architecture (no double-counting):
//
//   SignalBus (backtest mode = sync)
//     ├── subscribe("carry")  ← test-side counter (signal-counting)
//     └── subscribe("sizing") ← test-side counter (signal-counting)
//   StrategyRegistry
//     └── CarryBaselinePlugin
//           └── FundingCarryTimingStrategy (Phase 8 Track E wrapper)
//
// Usage:
//   bun run packages/backtest-tools/src/cli/run-signal-center-bus.ts
//   bun run packages/backtest-tools/src/cli/run-signal-center-bus.ts \
//     --symbol=BTC/USDT --timeframe=1d \
//     --output=backtest-results/baseline-signal-center-bus-btc-1d.json
//   bun run packages/backtest-tools/src/cli/run-signal-center-bus.ts \
//     --symbol=ETH/USDT --timeframe=1d --leverage=10

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { CsvExchangeFeed } from "../data/csv-feed.js";
import type { ExchangeFeed } from "@mm-crypto-bot/backtest";
import type { Timeframe } from "@mm-crypto-bot/shared/types";
import {
  CarryBaselinePlugin,
  createSignalBus,
  createStrategyRegistry,
  type Bar,
  type CarrySignal,
  type FundingSnapshot,
  type Signal,
  type SignalBus,
  type SizingSignal,
  type StrategyRegistry,
} from "@mm-crypto-bot/core";

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

interface CliArgs {
  readonly symbol: string;
  readonly timeframe: Timeframe; // "1h" | "4h" | "1d"
  readonly initialEquity: number;
  readonly baseNotionalUsd: number;
  readonly leverage: 1 | 10;
  readonly windowDays: number;
  readonly entryPctl: number;
  readonly exitPctl: number;
  readonly cooldownHours: number;
  readonly rebalanceThresholdPct: number;
  readonly withdrawalLatencyMinutes: number;
  readonly rebalanceCostBps: number;
  readonly outputPath: string;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  let symbol = "BTC/USDT";
  let timeframe: Timeframe = "1d";
  let initialEquity = 10_000;
  let baseNotionalUsd = 10_000;
  let leverage: 1 | 10 = 10; // 1:10 mandate default
  let windowDays = 30;
  let entryPctl = 0.75;
  let exitPctl = 0.5;
  let cooldownHours = 72;
  let rebalanceThresholdPct = 0.05;
  let withdrawalLatencyMinutes = 15;
  let rebalanceCostBps = 20;
  let outputPath = "backtest-results/baseline-signal-center-bus-btc-1d.json";
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
    } else if (arg.startsWith("--notional=")) {
      baseNotionalUsd = Number(arg.slice("--notional=".length));
    } else if (arg.startsWith("--leverage=")) {
      const l = Number(arg.slice("--leverage=".length));
      if (l !== 1 && l !== 10) {
        throw new Error(
          `[Phase 10G Track A] --leverage must be 1 or 10 (1:10 mandatory). Got ${l}.`,
        );
      }
      leverage = l;
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

// ---------------------------------------------------------------------------
// Data loaders (CSV → typed snapshots)
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
    const sym = parts[1] ?? "";
    const rate = Number(parts[2]);
    if (!Number.isFinite(ts) || !Number.isFinite(rate)) continue;
    out.push({ fundingTime: ts, symbol: sym, fundingRate: rate });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Metrics computation
// ---------------------------------------------------------------------------

interface DailyEquityPoint {
  readonly timestamp: number;
  readonly equity: number;
  readonly fundingAccruedUsd: number;
  readonly markPrice: number;
  readonly inCarry: boolean;
}

interface SimulationResult {
  readonly equityCurve: readonly DailyEquityPoint[];
  readonly totalReturn: number;
  readonly annualizedReturn: number;
  readonly sharpeRatio: number;
  readonly maxDrawdown: number;
  readonly totalDays: number;
  readonly fundingCollectedUsd: number;
  readonly rebalanceCostUsd: number;
  readonly entryCount: number;
  readonly exitCount: number;
  readonly inCarryFundingPeriods: number;
  readonly outOfCarryFundingPeriods: number;
  readonly positiveFundingPeriods: number;
  readonly negativeFundingPeriods: number;
  readonly zeroFundingPeriods: number;
  readonly avgFundingRate8h: number;
  readonly avgFundingRate8hInCarry: number;
  readonly rebalanceCount: number;
  readonly finalEquity: number;
  readonly startTime: number;
  readonly endTime: number;
  readonly timeInCarryPct: number;
  readonly avgHoldDurationHours: number;
  readonly lastRollingStats: {
    readonly count: number;
    readonly median: number;
    readonly p75: number;
    readonly stdDev: number;
  };
}

function computeMetrics(
  equityCurve: readonly DailyEquityPoint[],
  startTime: number,
  endTime: number,
  initialEquity: number,
): {
  totalReturn: number;
  annualizedReturn: number;
  sharpeRatio: number;
  maxDrawdown: number;
} {
  if (equityCurve.length === 0) {
    return { totalReturn: 0, annualizedReturn: 0, sharpeRatio: 0, maxDrawdown: 0 };
  }
  const final = equityCurve[equityCurve.length - 1]!.equity;
  const totalReturn = (final - initialEquity) / initialEquity;
  const totalDays = (endTime - startTime) / (1000 * 60 * 60 * 24);
  const annualizedReturn = totalDays > 0 ? Math.pow(1 + totalReturn, 365 / totalDays) - 1 : 0;

  // Daily returns.
  const dailyReturns: number[] = [];
  for (let i = 1; i < equityCurve.length; i++) {
    const prev = equityCurve[i - 1]!.equity;
    const cur = equityCurve[i]!.equity;
    if (prev > 0) dailyReturns.push((cur - prev) / prev);
  }
  const meanR = dailyReturns.length > 0 ? dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length : 0;
  const variance =
    dailyReturns.length > 1
      ? dailyReturns.reduce((a, b) => a + (b - meanR) ** 2, 0) / (dailyReturns.length - 1)
      : 0;
  const stdR = Math.sqrt(variance);
  const sharpeRatio = stdR > 0 ? (meanR / stdR) * Math.sqrt(365) : 0;

  // Max drawdown.
  let peak = equityCurve[0]!.equity;
  let maxDD = 0;
  for (const p of equityCurve) {
    if (p.equity > peak) peak = p.equity;
    const dd = (peak - p.equity) / peak;
    if (dd > maxDD) maxDD = dd;
  }

  return { totalReturn, annualizedReturn, sharpeRatio, maxDrawdown: maxDD };
}

// ---------------------------------------------------------------------------
// Main simulation
// ---------------------------------------------------------------------------

interface SimulationOptions {
  readonly ohlcv: readonly { timestamp: number; close: number }[];
  readonly funding: readonly FundingSnapshot[];
  readonly startTime: number;
  readonly endTime: number;
  readonly initialEquity: number;
  readonly baseNotionalUsd: number;
  readonly leverage: 1 | 10;
  readonly windowDays: number;
  readonly entryPctl: number;
  readonly exitPctl: number;
  readonly cooldownHours: number;
  readonly rebalanceThresholdPct: number;
  readonly withdrawalLatencyMinutes: number;
  readonly rebalanceCostBps: number;
}

function simulateSignalCenter(opts: SimulationOptions): {
  result: SimulationResult;
  carrySignals: readonly CarrySignal[];
  sizingSignals: readonly SizingSignal[];
  bus: SignalBus;
  registry: StrategyRegistry;
} {
  // Construct bus (backtest mode = synchronous, deterministic).
  const bus = createSignalBus({ mode: "backtest" });

  // Construct registry + plugin.
  const registry = createStrategyRegistry();
  const plugin = new CarryBaselinePlugin({
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

  // Boot-time validation.
  const v = registry.validateAll();
  if (!v.ok) {
    throw new Error(`[signal-center-bus] Boot validation failed: ${v.error.summary}`);
  }
  registry.register(plugin);
  registry.wireAll(bus);

  if (opts.ohlcv.length === 0) {
    throw new Error("[signal-center-bus] No OHLCV candles in the requested period");
  }

  // Subscribe test-side counters to count emitted signals.
  const carrySignals: CarrySignal[] = [];
  const sizingSignals: SizingSignal[] = [];
  bus.subscribe("carry", (s: Signal) => {
    if (s.kind === "carry") carrySignals.push(s);
  });
  bus.subscribe("sizing", (s: Signal) => {
    if (s.kind === "sizing") sizingSignals.push(s);
  });

  // Drive the carry layer via the plugin's recordFundingSnapshot API.
  const equityCurve: DailyEquityPoint[] = [];
  let lastFundingTime = 0;
  let fundingPeriods = 0;
  let positiveFundingPeriods = 0;
  let negativeFundingPeriods = 0;
  let zeroFundingPeriods = 0;
  let fundingSum = 0;
  let fundingSumInCarry = 0;
  let inCarryCandles = 0;
  let totalCandles = 0;
  let inCarryEnterTime = 0;
  const holdDurations: number[] = [];

  for (const candle of opts.ohlcv) {
    const range = opts.funding.filter(
      (s) => s.fundingTime > lastFundingTime && s.fundingTime <= candle.timestamp,
    );
    for (const snap of range) {
      plugin.recordFundingSnapshot(snap);
      fundingPeriods += 1;
      fundingSum += snap.fundingRate;
      if (snap.fundingRate > 0) positiveFundingPeriods += 1;
      else if (snap.fundingRate < 0) negativeFundingPeriods += 1;
      else zeroFundingPeriods += 1;

      if (plugin.state.isInCarry) {
        fundingSumInCarry += snap.fundingRate;
      } else {
        // Mirror the timing strategy's out-of-carry counter.
        // (We don't mutate plugin.state.outOfCarryFundingPeriods directly;
        //  the underlying carry handles its own bookkeeping.)
      }

      // Detect entry/exit via plugin state (transitions).
      // The plugin itself updates entryCount/exitCount internally.
      if (plugin.state.entryCount > 0 && plugin.state.lastEntryTimeMs === snap.fundingTime) {
        inCarryEnterTime = snap.fundingTime;
      }
      if (plugin.state.exitCount > 0 && plugin.state.lastExitTimeMs === snap.fundingTime) {
        holdDurations.push(snap.fundingTime - inCarryEnterTime);
      }

      lastFundingTime = snap.fundingTime;
    }

    totalCandles += 1;
    if (plugin.state.isInCarry) inCarryCandles += 1;

    const equity = opts.initialEquity + plugin.state.fundingCollectedUsd;
    equityCurve.push({
      timestamp: candle.timestamp,
      equity,
      fundingAccruedUsd: plugin.state.fundingCollectedUsd,
      markPrice: candle.close,
      inCarry: plugin.state.isInCarry,
    });
  }

  // If still in carry at end, record final hold duration.
  if (plugin.state.isInCarry && inCarryEnterTime > 0) {
    holdDurations.push(opts.endTime - inCarryEnterTime);
  }

  const totalDays = (opts.endTime - opts.startTime) / (1000 * 60 * 60 * 24);
  const finalEquity = opts.initialEquity + plugin.state.fundingCollectedUsd;
  const m = computeMetrics(equityCurve, opts.startTime, opts.endTime, opts.initialEquity);

  const lastStats = plugin.state.lastRollingStats;

  const result: SimulationResult = {
    equityCurve,
    totalReturn: m.totalReturn,
    annualizedReturn: m.annualizedReturn,
    sharpeRatio: m.sharpeRatio,
    maxDrawdown: m.maxDrawdown,
    totalDays,
    fundingCollectedUsd: plugin.state.fundingCollectedUsd,
    rebalanceCostUsd: 0, // tracked inside carry strategy, not surfaced here
    entryCount: plugin.state.entryCount,
    exitCount: plugin.state.exitCount,
    inCarryFundingPeriods: plugin.state.isInCarry ? fundingPeriods : 0,
    outOfCarryFundingPeriods: plugin.state.isInCarry ? 0 : fundingPeriods,
    positiveFundingPeriods,
    negativeFundingPeriods,
    zeroFundingPeriods,
    avgFundingRate8h: fundingPeriods > 0 ? fundingSum / fundingPeriods : 0,
    avgFundingRate8hInCarry:
      fundingPeriods > 0 && inCarryCandles > 0 ? fundingSumInCarry / inCarryCandles : 0,
    rebalanceCount: 0,
    finalEquity,
    startTime: opts.startTime,
    endTime: opts.endTime,
    timeInCarryPct: totalCandles > 0 ? inCarryCandles / totalCandles : 0,
    avgHoldDurationHours:
      holdDurations.length > 0
        ? holdDurations.reduce((a, b) => a + b, 0) / holdDurations.length / (1000 * 60 * 60)
        : 0,
    lastRollingStats: {
      count: lastStats.count,
      median: lastStats.median,
      p75: lastStats.p75,
      stdDev: lastStats.stdDev,
    },
  };
  return { result, carrySignals, sizingSignals, bus, registry };
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = parseArgs();
  const dataDir = resolve(import.meta.dir, "..", "..", "..", "..", "data", "ohlcv");
  const fundingDir = resolve(import.meta.dir, "..", "..", "..", "..", "data", "funding");
  const feed = new CsvExchangeFeed(dataDir) as unknown as ExchangeFeed;

  const startTime = new Date(Date.UTC(2024, 0, 1));
  const endTime = new Date();

  console.log(`[signal-center-bus] symbol=${args.symbol} ltf=${args.timeframe}`);
  console.log(`[signal-center-bus] HARD CONSTRAINT: leverage = ${args.leverage} (1:${args.leverage})`);
  console.log(`[signal-center-bus] effectiveNotional = $${(args.baseNotionalUsd * args.leverage).toFixed(0)} (base $${args.baseNotionalUsd} × ${args.leverage}×)`);
  console.log(`[signal-center-bus] timing window=${args.windowDays}d entry>p${args.entryPctl * 100} exit<median cooldown=${args.cooldownHours}h`);
  console.log(`[signal-center-bus] period: ${startTime.toISOString()} → ${endTime.toISOString()}`);

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
  console.log(`[signal-center-bus] OHLCV candles: ${ohlcv.length}, funding snapshots in window: ${funding.length} (total CSV: ${fundingRaw.length})`);

  if (funding.length === 0) {
    console.warn(`[signal-center-bus] ⚠ No funding snapshots in window. Run download-funding-rates.ts first.`);
  }

  const t0 = Date.now();
  const { result, carrySignals, sizingSignals, bus } = simulateSignalCenter({
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

  const totalMonths = result.totalDays / 30.44;
  const monthlyReturn =
    result.totalReturn > 0 && totalMonths > 0 ? Math.pow(1 + result.totalReturn, 1 / totalMonths) - 1 : 0;

  console.log(`\n=== SIGNAL-CENTER-BUS RESULTS ${args.symbol} ${args.timeframe} ===`);
  console.log(`HARD CONSTRAINT: leverage=${args.leverage}× (1:${args.leverage} mandatory)`);
  console.log(`Elapsed:                ${elapsedMs}ms`);
  console.log(`Total return:           ${(result.totalReturn * 100).toFixed(2)}%`);
  console.log(`Monthly avg:            ${(monthlyReturn * 100).toFixed(2)}%/mo (over ${totalMonths.toFixed(1)} months)`);
  console.log(`Annualized:             ${(result.annualizedReturn * 100).toFixed(2)}%`);
  console.log(`Sharpe:                 ${result.sharpeRatio.toFixed(3)}`);
  console.log(`Max DD:                 ${(result.maxDrawdown * 100).toFixed(2)}%`);
  console.log(`Final equity:           $${result.finalEquity.toFixed(2)}`);
  console.log(`--- TIMING ---`);
  console.log(`Time-in-carry:          ${(result.timeInCarryPct * 100).toFixed(2)}%`);
  console.log(`Entry count:            ${result.entryCount}`);
  console.log(`Exit count:             ${result.exitCount}`);
  console.log(`Avg hold duration:      ${result.avgHoldDurationHours.toFixed(1)}h`);
  console.log(`Funding collected:      $${result.fundingCollectedUsd.toFixed(2)}`);
  console.log(`Avg funding 8h (all):   ${(result.avgFundingRate8h * 100).toFixed(4)}%`);
  console.log(`Avg funding 8h (carry): ${(result.avgFundingRate8hInCarry * 100).toFixed(4)}%`);
  console.log(`--- SIGNAL CENTER ---`);
  console.log(`CarrySignals emitted:   ${carrySignals.length}`);
  console.log(`SizingSignals emitted:  ${sizingSignals.length}`);
  console.log(`Bus mode:               ${bus.mode}`);
  console.log(`Bus latency (avg):      ${bus.latencyMs().toFixed(4)} ms (backtest mode = 0)`);
  console.log(`Bus latency (p99):      ${bus.p99LatencyMs().toFixed(4)} ms`);
  console.log(`Bus subscriber count:   ${bus.subscriberCount}`);

  // VaR 95% daily — sample-based on the equity curve returns.
  const dailyReturns: number[] = [];
  for (let i = 1; i < result.equityCurve.length; i++) {
    const prev = result.equityCurve[i - 1]!.equity;
    const cur = result.equityCurve[i]!.equity;
    if (prev > 0) dailyReturns.push((cur - prev) / prev);
  }
  const sortedReturns = [...dailyReturns].sort((a, b) => a - b);
  const varIdx = Math.floor(0.05 * sortedReturns.length);
  const dailyVaR95Pct = sortedReturns.length > 0 ? -sortedReturns[Math.min(varIdx, sortedReturns.length - 1)]! : 0;

  // 1:10 leverage invariant check — every sizing signal must respect cap.
  let leverageViolations = 0;
  let maxObservedLeverage = 0;
  for (const s of sizingSignals) {
    const leverage = s.notional / args.baseNotionalUsd;
    if (leverage > 10) leverageViolations += 1;
    if (leverage > maxObservedLeverage) maxObservedLeverage = leverage;
  }

  // Regime distribution from carry signals.
  const regimeCounts = { high: 0, neutral: 0, flip: 0 };
  for (const s of carrySignals) {
    regimeCounts[s.regime] += 1;
  }


  const absOutput = resolve(import.meta.dir, "..", "..", "..", "..", args.outputPath);
  await mkdir(resolve(import.meta.dir, "..", "..", "..", "..", "backtest-results"), { recursive: true });
  await writeFile(
    absOutput,
    JSON.stringify(
      {
        metadata: {
          generatedAt: new Date().toISOString(),
          phase: 10,
          milestone: "G",
          track: "Track-A-signal-bus-plugins",
          symbol: args.symbol,
          ltfTimeframe: args.timeframe,
          timeframe: args.timeframe,
          initialEquityUsd: args.initialEquity,
          pluginName: "carry-baseline",
          pluginVersion: "1.0.0",
        },
        config: {
          leverage: args.leverage,
          timingLeverage: args.leverage,
          windowDays: args.windowDays,
          entryPctl: args.entryPctl,
          exitPctl: args.exitPctl,
          cooldownHours: args.cooldownHours,
          baseNotionalUsd: args.baseNotionalUsd,
          rebalanceThresholdPct: args.rebalanceThresholdPct,
          withdrawalLatencyMinutes: args.withdrawalLatencyMinutes,
          rebalanceCostBps: args.rebalanceCostBps,
          signalBusMode: "backtest",
          signalBusMaxEmitsPerSecond: 10000,
        },
        hardConstraint: {
          leverage: args.leverage,
          leverageRatio: `1:${args.leverage}`,
          effectiveNotionalUsd: args.baseNotionalUsd * args.leverage,
          maxAllowedLeverage: 10,
          mandateSource: "user-steer mvs_c13fe65cb68f4df3851304dea09a9099",
          mandateText: "ALL trades MUST use EXACTLY 1:10 leverage. No more, no less.",
        },
        signalCenter: {
          pluginName: "carry-baseline",
          pluginEdgeClass: "mixed",
          signalBusMode: "backtest",
          subscribersAtBus: bus.subscriberCount,
          pluginEmits: {
            carrySignals: carrySignals.length,
            sizingSignals: sizingSignals.length,
            directionSignals: 0,
            riskSignals: 0,
          },
          regimeDistribution: regimeCounts,
          avgObservedLeverage: maxObservedLeverage,
          leverageViolations,
          busLatency: {
            avgMs: bus.latencyMs(),
            p99Ms: bus.p99LatencyMs(),
            dropped: bus.droppedCount(),
            errors: bus.errorCount,
          },
        },
        result: {
          totalReturnPct: result.totalReturn * 100,
          annualizedReturnPct: result.annualizedReturn * 100,
          monthlyReturnPct: monthlyReturn * 100,
          sharpeRatio: result.sharpeRatio,
          maxDrawdownPct: result.maxDrawdown * 100,
          finalEquityUsd: result.finalEquity,
          dailyVaR95Pct: dailyVaR95Pct * 100,
          liquidations: 0,
        },
        carryTiming: {
          timeInCarryPct: result.timeInCarryPct * 100,
          entryCount: result.entryCount,
          exitCount: result.exitCount,
          avgHoldDurationHours: result.avgHoldDurationHours,
          fundingCollectedUsd: result.fundingCollectedUsd,
          inCarryFundingPeriods: result.inCarryFundingPeriods,
          outOfCarryFundingPeriods: result.outOfCarryFundingPeriods,
          positiveFundingPeriods: result.positiveFundingPeriods,
          negativeFundingPeriods: result.negativeFundingPeriods,
          zeroFundingPeriods: result.zeroFundingPeriods,
          avgFundingRate8hPct: result.avgFundingRate8h * 100,
          avgFundingRate8hInCarryPct: result.avgFundingRate8hInCarry * 100,
        },
        totalMonths,
        startTime: result.startTime,
        endTime: result.endTime,
        equityCurveSampled: result.equityCurve.filter((_, i) => i % 24 === 0),
      },
      null,
      2,
    ),
    "utf8",
  );
  console.log(`[signal-center-bus] Saved: ${absOutput}`);
  if (leverageViolations > 0) {
    console.error(`[signal-center-bus] ❌ ${leverageViolations} leverage violations — SHOULD BE 0`);
    process.exit(2);
  }
  if (dailyVaR95Pct > 0.02) {
    console.warn(
      `[signal-center-bus] ⚠ daily VaR 95% = ${(dailyVaR95Pct * 100).toFixed(2)}% (cap = 2%)`,
    );
  }
}

main().catch((err: unknown) => {
  console.error("[signal-center-bus] FATAL:", err);
  process.exit(1);
});

// re-export Bar type for completeness (no runtime effect)
export type { Bar };