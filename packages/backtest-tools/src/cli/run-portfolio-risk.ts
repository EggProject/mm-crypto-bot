#!/usr/bin/env bun
// packages/backtest-tools/src/cli/run-portfolio-risk.ts — Phase 10G Track B
//
// Phase 10G Track B CLI runner — portfolio risk engine + per-strategy
// telemetry. Runs the V4 multi-class ensemble wrapped with the
// PortfolioRiskEngine (cross-strategy VaR + correlation + leverage guard)
// and the StrategyTelemetry (PnL attribution + kill-switch) layer.
//
// ===========================================================================
// 1:10 MANDATORY LEVERAGE CONSTRAINT (HARD USER DIRECTIVE)
// ===========================================================================
// Project-wide mandate: every trade uses EXACTLY 1:10 leverage (10× notional
// on 1× capital, 9× borrowed from bybit.eu SPOT margin). 1× permitted ONLY
// as backtest baseline. All other leverage values are REJECTED at parse time.
//
// The PortfolioRiskEngine's `leverageInvariantGuard` is the 3RD defense-
// in-depth layer for this mandate (after CLI parser + strategy constructor).
//
// ===========================================================================
// SCOPE
// ===========================================================================
// - Loads OHLCV + funding CSVs from data/ohlcv and data/funding
// - Instantiates SignalBus-less PortfolioRiskEngine + StrategyTelemetry
//   (Track A's SignalBus is not yet built; this runner wires signals
//   directly via submitSignal)
// - Wraps V4 ensemble and feeds its signals through the risk + telemetry
// - Runs the backtest, computes combined portfolio risk metrics
// - Emits JSON to backtest-results/baseline-portfolio-risk-{sym}-1d.json
//
// Usage:
//   bun run packages/backtest-tools/src/cli/run-portfolio-risk.ts
//   bun run packages/backtest-tools/src/cli/run-portfolio-risk.ts --symbol=BTC/USDT
//   bun run packages/backtest-tools/src/cli/run-portfolio-risk.ts --leverage=10

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { CsvExchangeFeed } from "../data/csv-feed.js";
import {
  runBacktest,
  type BacktestResult,
  type CostModel,
} from "@mm-crypto-bot/backtest";
import type { ExchangeFeed } from "@mm-crypto-bot/backtest";
import { makeSymbol, type Timeframe } from "@mm-crypto-bot/shared/types";
import {
  computeHybridSizer,
  computeVolTargetedSizer,
  DEFAULT_VOL_TARGET_CONFIG,
  MultiClassEnsembleV4,
  PortfolioRiskEngine,
  type RiskEngineSizingSignal as SizingSignal,
  StrategyTelemetry,
  type DailyOhlcv,
  type HybridSizerConfig,
  type HybridSizerResult,
  type MultiClassEnsembleV4Config,
  type Strategy,
  type StrategyContext,
  type VolTargetConfig,
  type VolTargetPoint,
} from "@mm-crypto-bot/core";

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

interface CliArgs {
  readonly symbol: string;
  readonly ltfTimeframe: Timeframe;
  readonly timeframe: Timeframe;
  readonly initialEquity: number;
  readonly leverage: 1 | 10;
  readonly volTarget: number;
  readonly entryPctl: number;
  readonly exitPctl: number;
  readonly windowDays: number;
  readonly cooldownHours: number;
  readonly baseNotionalUsd: number;
  readonly baseKellyFraction: number;
  readonly dataDir: string;
  readonly outputPath: string;
}

/**
 * `parseAndValidateLeverage` — HARD GUARDRAIL. Layer 1 of the 1:10
 * mandate enforcement. Accept only 1 (baseline) or 10 (1:10 mandatory).
 */
function parseAndValidateLeverage(raw: string): 1 | 10 {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
    throw new Error(
      `[PORTFOLIO-RISK] HARD CONSTRAINT VIOLATION: --leverage=${raw} is not a valid integer. ` +
        `User-mandated 1:10 leverage — only values 1 or 10 are accepted. Refusing to run.`,
    );
  }
  if (parsed !== 1 && parsed !== 10) {
    throw new Error(
      `[PORTFOLIO-RISK] HARD CONSTRAINT VIOLATION: --leverage=${parsed} is NOT allowed. ` +
        `User-mandated 1:10 leverage — only values 1 (baseline) or 10 (1:10 mandatory) are accepted. ` +
        `Refusing to run.`,
    );
  }
  return parsed;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  let symbol = "BTC/USDT";
  let ltfTimeframe: Timeframe = "1h";
  let timeframe: Timeframe = "1d";
  let initialEquity = 10_000;
  let leverage: 1 | 10 = 10;
  let volTarget = 0.02;
  let entryPctl = 0.75;
  let exitPctl = 0.5;
  let windowDays = 30;
  let cooldownHours = 72;
  let baseNotionalUsd = 10_000;
  let baseKellyFraction = 0.5;
  let dataDir = "data/ohlcv";
  let outputPath = "";
  for (const arg of args) {
    if (arg.startsWith("--symbol=")) symbol = arg.slice("--symbol=".length);
    else if (arg.startsWith("--ltf-timeframe=")) {
      const tf = arg.slice("--ltf-timeframe=".length) as Timeframe;
      if (tf !== "1h" && tf !== "4h" && tf !== "1d") {
        throw new Error(`Invalid ltf-timeframe: ${tf}`);
      }
      ltfTimeframe = tf;
    } else if (arg.startsWith("--timeframe=")) {
      const tf = arg.slice("--timeframe=".length) as Timeframe;
      if (tf !== "1h" && tf !== "4h" && tf !== "1d") {
        throw new Error(`Invalid timeframe: ${tf}`);
      }
      timeframe = tf;
    } else if (arg.startsWith("--equity=")) initialEquity = Number(arg.slice("--equity=".length));
    else if (arg.startsWith("--leverage=")) leverage = parseAndValidateLeverage(arg.slice("--leverage=".length));
    else if (arg.startsWith("--vol-target=")) volTarget = Number(arg.slice("--vol-target=".length));
    else if (arg.startsWith("--entry-pctl=")) entryPctl = Number(arg.slice("--entry-pctl=".length));
    else if (arg.startsWith("--exit-pctl=")) exitPctl = Number(arg.slice("--exit-pctl=".length));
    else if (arg.startsWith("--window-days=")) windowDays = Number(arg.slice("--window-days=".length));
    else if (arg.startsWith("--cooldown-hours=")) cooldownHours = Number(arg.slice("--cooldown-hours=".length));
    else if (arg.startsWith("--notional=")) baseNotionalUsd = Number(arg.slice("--notional=".length));
    else if (arg.startsWith("--base-kelly=")) baseKellyFraction = Number(arg.slice("--base-kelly=".length));
    else if (arg.startsWith("--data-dir=")) dataDir = arg.slice("--data-dir=".length);
    else if (arg.startsWith("--output=")) outputPath = arg.slice("--output=".length);
  }
  if (!outputPath) {
    const symbolLower = symbol.split("/")[0]!.toLowerCase();
    outputPath = `backtest-results/baseline-portfolio-risk-${symbolLower}-${timeframe}.json`;
  }
  return {
    symbol, ltfTimeframe, timeframe, initialEquity, leverage,
    volTarget, entryPctl, exitPctl, windowDays, cooldownHours,
    baseNotionalUsd, baseKellyFraction, dataDir, outputPath,
  };
}

// ---------------------------------------------------------------------------
// OHLCV + funding CSV loaders
// ---------------------------------------------------------------------------

interface DailyOhlcvRow {
  readonly timestamp: number;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
  readonly volume: number;
}

async function loadDailyOhlcvCsv(
  dataDir: string,
  symbol: string,
): Promise<readonly DailyOhlcvRow[]> {
  const symLower = symbol.split("/")[0]!.toLowerCase();
  const path = resolve(dataDir, `binance_${symLower}_1d.csv`);
  const raw = await readFile(path, "utf-8");
  const lines = raw.split("\n").filter((l) => l.trim().length > 0);
  const out: DailyOhlcvRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i]!.split(",");
    const ts = Number(parts[0]);
    const open = Number(parts[1]);
    const high = Number(parts[2]);
    const low = Number(parts[3]);
    const close = Number(parts[4]);
    const volume = Number(parts[5]);
    if (!Number.isFinite(ts) || !Number.isFinite(close)) continue;
    out.push({ timestamp: ts, open, high, low, close, volume });
  }
  return out;
}

interface FundingSnapshotCsv {
  readonly timestamp: number;
  readonly symbol: string;
  readonly fundingRate: number;
}

async function loadFundingCsv(
  dataDir: string,
  symbol: string,
): Promise<readonly FundingSnapshotCsv[]> {
  const symLower = symbol.split("/")[0]!.toLowerCase();
  const path = resolve(dataDir, "..", "funding", `binance_${symLower}usdt_funding_8h.csv`);
  const raw = await readFile(path, "utf-8");
  const lines = raw.split("\n").filter((l) => l.trim().length > 0);
  const out: FundingSnapshotCsv[] = [];
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i]!.split(",");
    const ts = Number(parts[0]);
    const rate = Number(parts[2]);
    if (!Number.isFinite(ts) || !Number.isFinite(rate)) continue;
    out.push({ timestamp: ts, symbol: parts[1] ?? symbol, fundingRate: rate });
  }
  return out;
}

function buildVolTargetLookup(
  dailyOhlcv: readonly DailyOhlcvRow[],
  volTargetConfig: VolTargetConfig,
  baseNotionalUsd: number,
): { readonly lookup: (tsMs: number) => number; readonly series: VolTargetPoint[] } {
  const ohlcv: DailyOhlcv[] = dailyOhlcv.map((r) => ({
    timestamp: r.timestamp, open: r.open, high: r.high, low: r.low, close: r.close, volume: r.volume,
  }));
  const result = computeVolTargetedSizer(ohlcv, baseNotionalUsd, volTargetConfig);
  const byTs = new Map<number, number>();
  for (const point of result.dailySeries) byTs.set(point.day, point.clampedVolMultiplier);
  const DAY_MS = 86_400_000;
  const lookup = (tsMs: number): number => {
    const dayTs = Math.floor(tsMs / DAY_MS) * DAY_MS;
    return byTs.get(dayTs) ?? 1.0;
  };
  return { lookup, series: [...result.dailySeries] };
}

function buildHybridFactorLookup(hybrid: HybridSizerResult): (tsMs: number) => number {
  const byTs = new Map<number, number>();
  for (const day of hybrid.days) byTs.set(day.day, day.effectivePositionFactor);
  const DAY_MS = 86_400_000;
  return (tsMs: number): number => {
    const dayTs = Math.floor(tsMs / DAY_MS) * DAY_MS;
    return byTs.get(dayTs) ?? hybrid.avgEffectivePositionFactor;
  };
}

// ---------------------------------------------------------------------------
// V4 wrapper strategy (injects vol-target + hybrid factor) + RISK ROUTING
// ---------------------------------------------------------------------------

/**
 * `RiskRoutingV4Strategy` — wraps V4 ensemble with:
 *   1. Per-candle vol-target + hybrid factor injection
 *   2. Per-candle SizingSignal submission to PortfolioRiskEngine
 *   3. Per-candle trade attribution to StrategyTelemetry
 *   4. Per-day equity snapshot to PortfolioRiskEngine
 */
class RiskRoutingV4Strategy implements Strategy {
  readonly name: string;
  readonly timeframes = ["1d", "4h", "1h"] as const;
  readonly ensemble: MultiClassEnsembleV4;
  private readonly volTargetLookup: (tsMs: number) => number;
  private readonly hybridFactorLookup: (tsMs: number) => number;
  private readonly riskEngine: PortfolioRiskEngine;
  private readonly telemetry: StrategyTelemetry;
  private readonly baseCapital: number;
  private lastEquityForReturn = 0;

  constructor(
    ensemble: MultiClassEnsembleV4,
    volTargetLookup: (tsMs: number) => number,
    hybridFactorLookup: (tsMs: number) => number,
    riskEngine: PortfolioRiskEngine,
    telemetry: StrategyTelemetry,
    baseCapital: number,
    initialEquity: number,
  ) {
    this.ensemble = ensemble;
    this.volTargetLookup = volTargetLookup;
    this.hybridFactorLookup = hybridFactorLookup;
    this.riskEngine = riskEngine;
    this.telemetry = telemetry;
    this.baseCapital = baseCapital;
    this.lastEquityForReturn = initialEquity;
    this.name = `RiskRouting(${ensemble.name})`;
  }

  warmup(): number {
    return this.ensemble.warmup();
  }

  onCandle(ctx: StrategyContext) {
    const mult = this.volTargetLookup(ctx.candle.timestamp);
    this.ensemble.setVolTargetMultiplier(mult);
    const factor = this.hybridFactorLookup(ctx.candle.timestamp);
    this.ensemble.setHybridPositionFactor(factor);
    // The V4 ensemble holds ONE set of positions on the same capital:
    //   - carry side: effective carry leverage × baseCapital (delta-neutral, but
    //     uses 9× notional on 1× capital = 9× leverage on capital)
    //   - directional side: sized via Track 9E hybrid factor × equity (max
    //     ~13% of equity for BTC)
    // Both share the same $10k capital base. The EFFECTIVE leverage on capital
    // is max(carry_leverage, directional_leverage) — they don't sum because
    // they share margin. We submit ONE SizingSignal per candle representing
    // the dominant exposure (the carry side, which is the larger notional).
    const carryNotional = this.ensemble.getEffectiveCarryLeverage() * this.baseCapital;
    const sig: SizingSignal = {
      kind: "sizing",
      source: "v4-ensemble",
      symbol: ctx.symbol,
      effectiveNotionalUsd: carryNotional,
      leverage: this.ensemble.getEffectiveCarryLeverage(),
      timestamp: ctx.candle.timestamp,
    };
    this.telemetry.submitSignal(sig);
    const breach = this.riskEngine.submitSignal(sig);
    if (breach !== null) {
      console.warn(`[PORTFOLIO-RISK] Breach on V4 sizing: ${breach.reason}`);
    }
    return this.ensemble.onCandle(ctx);
  }

  onOpenPositionUpdate(ctx: unknown) {
    return this.ensemble.onOpenPositionUpdate(
      ctx as Parameters<MultiClassEnsembleV4["onOpenPositionUpdate"]>[0],
    );
  }

  onPositionOpened(snap: unknown) {
    this.ensemble.onPositionOpened(
      snap as Parameters<MultiClassEnsembleV4["onPositionOpened"]>[0],
    );
  }

  onPositionClosed(reason: string) {
    this.ensemble.onPositionClosed(reason);
  }

  attributeTrade(
    symbol: string,
    timestamp: number,
    notionalUsd: number,
    pnlUsd: number,
    side: "long" | "short" | "carry",
    source: string,
  ): void {
    this.telemetry.recordTrade({
      source,
      symbol,
      timestamp,
      notionalUsd,
      pnlUsd,
      side,
    });
  }

  updateEquitySnapshot(timestamp: number, equity: number): void {
    this.riskEngine.recordEquitySnapshot(timestamp, equity);
    if (this.lastEquityForReturn > 0) {
      const ret = (equity - this.lastEquityForReturn) / this.lastEquityForReturn;
      this.riskEngine.recordSourceReturn("directional", timestamp, ret);
      this.telemetry.recordReturn("directional", timestamp, ret);
    }
    this.lastEquityForReturn = equity;
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = parseArgs();
  console.log(`[PORTFOLIO-RISK] Phase 10G Track B — symbol=${args.symbol} timeframe=${args.timeframe}`);
  console.log(`[PORTFOLIO-RISK] 1:10 MANDATORY LEVERAGE: ${args.leverage}x`);

  const dataDirAbs = resolve(import.meta.dir, "..", "..", "..", "..", args.dataDir);
  const feed = new CsvExchangeFeed(dataDirAbs) as unknown as ExchangeFeed;

  const dailyOhlcv = await loadDailyOhlcvCsv(dataDirAbs, args.symbol);
  const fundingSnapshots = await loadFundingCsv(dataDirAbs, args.symbol);

  const volTargetConfig: VolTargetConfig = { ...DEFAULT_VOL_TARGET_CONFIG, targetDailyVol: args.volTarget };
  const { lookup: volTargetLookup, series: volTargetSeries } = buildVolTargetLookup(
    dailyOhlcv, volTargetConfig, args.baseNotionalUsd,
  );
  const volTargetSummary = computeVolTargetedSizer(
    dailyOhlcv.map((r) => ({ timestamp: r.timestamp, open: r.open, high: r.high, low: r.low, close: r.close, volume: r.volume })),
    args.baseNotionalUsd, volTargetConfig,
  );

  const initialConfig: MultiClassEnsembleV4Config = {
    donchianMtf: { leverage: args.leverage },
    fundingFlipKillSwitch: {
      baseNotionalUsd: args.baseNotionalUsd,
      timingLeverage: args.leverage,
      windowDays: args.windowDays,
      entryPercentile: args.entryPctl,
      exitPercentile: args.exitPctl,
      cooldownHours: args.cooldownHours,
    },
    fundingCarryLeverage: {
      baseNotionalUsd: args.baseNotionalUsd,
      maxLeverage: args.leverage,
      minLeverage: 1,
    },
    volTargetedSizer: volTargetConfig,
  };

  // PHASE 1: baseline backtest
  console.log(`[PORTFOLIO-RISK] PHASE 1 — baseline DonchianMTF backtest`);
  const riskEngine1 = new PortfolioRiskEngine();
  const telemetry1 = new StrategyTelemetry();
  const baselineEnsemble = new MultiClassEnsembleV4(initialConfig);
  const baselineWrapper = new RiskRoutingV4Strategy(
    baselineEnsemble, volTargetLookup, () => 1.0, riskEngine1, telemetry1,
    args.baseNotionalUsd, args.initialEquity,
  );

  const costModel: CostModel = {
    takerFeeRate: 0.001,
    slippageRate: 0.0005,
    spreadRate: 0.0002,
    borrowRatePerHour: 0.0001,
    fundingRatePer8h: 0,
  };
  const startTime = new Date(Date.UTC(2024, 0, 1));
  const endTime = new Date(Date.UTC(2026, 6, 1));
  const avgMult = volTargetSummary.avgVolMultiplier;
  const baselineRecommendedMaxPos = 0.2 * avgMult;

  const baselineResult: BacktestResult = await runBacktest({
    symbol: makeSymbol(args.symbol),
    htfTimeframe: "1d",
    mtfTimeframe: "4h",
    ltfTimeframe: args.ltfTimeframe,
    startTime, endTime,
    initialEquityUsd: args.initialEquity,
    feed, costModel,
    positionSize: {
      riskPerTrade: 0.01 * avgMult,
      kellyFraction: 0.5,
      maxDrawdown: 0.5,
      maxPositionPctEquity: baselineRecommendedMaxPos,
      minPositionPctEquity: 0.01,
    },
    strategy: baselineWrapper,
  });

  let runningEquity = args.initialEquity;
  for (const t of baselineResult.trades) {
    baselineWrapper.attributeTrade(
      t.symbol, t.exitTime, t.notionalUsd, t.pnlUsd,
      t.side === "buy" ? "long" : "short", "donchian-mtf",
    );
    runningEquity += t.pnlUsd;
    baselineWrapper.updateEquitySnapshot(t.exitTime, runningEquity);
  }
  const baselineTrades = baselineResult.trades;
  console.log(`[PORTFOLIO-RISK] PHASE 1 done — ${baselineTrades.length} trades`);

  if (baselineTrades.length === 0) {
    throw new Error(`[PORTFOLIO-RISK] Baseline produced 0 trades.`);
  }

  // PHASE 2: hybrid sizer
  console.log(`[PORTFOLIO-RISK] PHASE 2 — Adaptive Kelly x VolTarget hybrid sizer`);
  const hybridConfig: HybridSizerConfig = {
    rollingWindowDays: 30,
    baseKellyFraction: args.baseKellyFraction,
    volTargetConfig, initialEquity: args.initialEquity, minTradeCount: 30,
  };
  const hybridSizer = computeHybridSizer(
    baselineTrades,
    dailyOhlcv.map((r) => ({ timestamp: r.timestamp, open: r.open, high: r.high, low: r.low, close: r.close, volume: r.volume })),
    args.baseNotionalUsd, hybridConfig,
  );
  console.log(`[PORTFOLIO-RISK] PHASE 2 done — avgFactor=${hybridSizer.avgEffectivePositionFactor.toFixed(4)}`);

  // PHASE 3: final backtest
  console.log(`[PORTFOLIO-RISK] PHASE 3 — final V4 backtest + portfolio risk routing`);
  const riskEngine = new PortfolioRiskEngine();
  const telemetry = new StrategyTelemetry();
  const finalConfig: MultiClassEnsembleV4Config = { ...initialConfig, hybridSizerResult: hybridSizer };
  const finalEnsemble = new MultiClassEnsembleV4(finalConfig);
  const hybridFactorLookup = buildHybridFactorLookup(hybridSizer);
  const finalWrapper = new RiskRoutingV4Strategy(
    finalEnsemble, volTargetLookup, hybridFactorLookup,
    riskEngine, telemetry, args.baseNotionalUsd, args.initialEquity,
  );

  const recommendedMaxPositionPctEquity = Math.min(
    0.99, args.baseKellyFraction * hybridSizer.avgEffectivePositionFactor,
  );
  finalEnsemble.setRecommendedMaxPositionPctEquity(recommendedMaxPositionPctEquity);

  const result: BacktestResult = await runBacktest({
    symbol: makeSymbol(args.symbol),
    htfTimeframe: "1d",
    mtfTimeframe: "4h",
    ltfTimeframe: args.ltfTimeframe,
    startTime, endTime,
    initialEquityUsd: args.initialEquity,
    feed, costModel,
    positionSize: {
      riskPerTrade: 0.01 * avgMult * hybridSizer.avgEffectivePositionFactor,
      kellyFraction: hybridSizer.avgKellyFraction,
      maxDrawdown: 0.5,
      maxPositionPctEquity: recommendedMaxPositionPctEquity,
      minPositionPctEquity: 0.01,
    },
    strategy: finalWrapper,
  });

  // Parallel carry simulation
  const fundingPayments: { timestamp: number; payment: number }[] = [];
  let fundingCollectedUsd = 0;
  for (const snap of fundingSnapshots) {
    if (snap.timestamp < startTime.getTime() || snap.timestamp > endTime.getTime()) continue;
    const payment = finalEnsemble.recordFundingSnapshot(snap.timestamp, snap.fundingRate);
    fundingPayments.push({ timestamp: snap.timestamp, payment });
    fundingCollectedUsd = finalEnsemble.fundingFlipKillSwitch.underlyingCarryState.fundingCollectedUsd;
    // Record per-snapshot funding return for portfolio risk engine (in basis points).
    // Snapshot return = payment / baseCapitalUsd.
    const snapReturn = args.baseNotionalUsd > 0 ? payment / args.baseNotionalUsd : 0;
    riskEngine.recordSourceReturn("funding-carry", snap.timestamp, snapReturn);
    telemetry.recordReturn("funding-carry", snap.timestamp, snapReturn);
  }

  runningEquity = args.initialEquity;
  for (const t of result.trades) {
    finalWrapper.attributeTrade(
      t.symbol, t.exitTime, t.notionalUsd, t.pnlUsd,
      t.side === "buy" ? "long" : "short", "donchian-mtf",
    );
    runningEquity += t.pnlUsd;
    finalWrapper.updateEquitySnapshot(t.exitTime, runningEquity);
  }
  if (fundingCollectedUsd !== 0) {
    telemetry.recordTrade({
      source: "funding-carry",
      symbol: args.symbol,
      timestamp: endTime.getTime(),
      notionalUsd: args.baseNotionalUsd * finalEnsemble.getEffectiveCarryLeverage(),
      pnlUsd: fundingCollectedUsd,
      side: "carry",
    });
  }

  const directionalPnlUsd = result.totalReturn * args.initialEquity;
  const carryPnlUsd = fundingCollectedUsd;
  const totalPnlUsd = directionalPnlUsd + carryPnlUsd;
  const totalReturnPct = (totalPnlUsd / args.initialEquity) * 100;
  const totalMonths = 30;
  const monthlyReturnPct = totalReturnPct / totalMonths;
  const annualizedReturnPct = (totalReturnPct / 30) * 12;
  const annualizedSharpe = result.sharpeRatio * Math.sqrt(252);

  const portfolioVaR = riskEngine.portfolioVaR(args.initialEquity);
  const correlationMatrix = riskEngine.crossStrategyCorrelation();
  const aggregateDD = riskEngine.aggregateDrawdown();
  const exposure = riskEngine.exposureBySymbol();
  const portfolioSnapshot = riskEngine.snapshot(args.initialEquity);

  const perStrategyVaR: Record<string, { dailyVaR95Pct: number; tradeCount: number }> = {};
  const perStratStats = telemetry.allPerStrategyStats();
  for (const s of perStratStats) {
    perStrategyVaR[s.source] = {
      dailyVaR95Pct: portfolioVaR?.dailyVaR95Pct ?? 0,
      tradeCount: s.tradeCount,
    };
  }

  const telemetrySnapshot = telemetry.snapshot();
  // Snapshot timestamp is end-of-backtest (for deterministic JSON comparison).

  const attribution = telemetrySnapshot.perStrategy.map((s) => ({
    source: s.source,
    tradeCount: s.tradeCount,
    totalPnlUsd: Number(s.totalPnlUsd.toFixed(2)),
    winRate: Number(s.winRate.toFixed(4)),
    sharpe: Number(s.sharpe.toFixed(4)),
    maxDrawdownPct: Number(s.maxDrawdownPct.toFixed(4)),
    disabled: s.disabled,
  }));

  const killSwitchInvocations = telemetry.getKillSwitchHistory();

  // Synthetic 11x breach test (verification that the guard fires on 12x aggregate)
  const syntheticBreachTest = (() => {
    const testEngine = new PortfolioRiskEngine();
    testEngine.submitSignal({
      kind: "sizing", source: "synthetic-A", symbol: "TEST/USDT",
      effectiveNotionalUsd: 60_000, leverage: 6, timestamp: 0,
    });
    testEngine.submitSignal({
      kind: "sizing", source: "synthetic-B", symbol: "TEST/USDT",
      effectiveNotionalUsd: 60_000, leverage: 6, timestamp: 0,
    });
    const breach = testEngine.leverageInvariantGuard(args.initialEquity);
    return {
      syntheticAggregateLeverage: 12,
      guardFired: breach !== null,
      guardMessage: breach?.reason ?? null,
    };
  })();

  if (portfolioSnapshot.aggregateLeverage > 10.5) {
    throw new Error(
      `[PORTFOLIO-RISK] 1:10 MANDATE BREACH: aggregate leverage ${portfolioSnapshot.aggregateLeverage} > 10. ` +
        `Refusing to write output.`,
    );
  }

  const output = {
    metadata: {
      generatedAt: new Date().toISOString(),
      phase: 10,
      track: "G",
      milestone: "1",
      subtrack: "B-portfolio-risk-telemetry",
      symbol: args.symbol,
      ltfTimeframe: args.ltfTimeframe,
      timeframe: args.timeframe,
      initialEquityUsd: args.initialEquity,
      leverage: args.leverage,
    },
    config: {
      leverage: args.leverage,
      volTarget: args.volTarget,
      entryPctl: args.entryPctl,
      exitPctl: args.exitPctl,
      windowDays: args.windowDays,
      cooldownHours: args.cooldownHours,
      baseNotionalUsd: args.baseNotionalUsd,
      baseKellyFraction: args.baseKellyFraction,
      portfolioRiskEngineConfig: {
        confidence: 0.95,
        correlationWindowDays: 30,
        concentrationThresholdPct: 0.40,
        maxAggregateDrawdownPct: 0.20,
      },
    },
    portfolioRisk: {
      portfolioVaR95Pct: portfolioVaR?.dailyVaR95Pct ?? null,
      portfolioVaR95Usd: portfolioVaR?.dailyVaR95Usd ?? null,
      portfolioVaRObservations: portfolioVaR?.observations ?? 0,
      aggregateDrawdownPct: aggregateDD?.drawdownPct ?? null,
      maxDrawdownPct: aggregateDD?.maxDrawdownPct ?? null,
      aggregateLeverage: portfolioSnapshot.aggregateLeverage,
      numLeverageBreaches: portfolioSnapshot.numLeverageBreaches,
      leverageInvariantFires: portfolioSnapshot.leverageInvariantFires,
    },
    perStrategyVaR,
    correlationMatrix: correlationMatrix ? {
      sources: correlationMatrix.sources,
      matrix: correlationMatrix.matrix,
      windowDays: correlationMatrix.windowDays,
      observationCount: correlationMatrix.observationCount,
      timestamp: correlationMatrix.timestamp,
    } : null,
    exposureBySymbol: {
      totalNotionalUsd: exposure.totalNotionalUsd,
      perSymbol: Object.fromEntries(exposure.perSymbol),
      perSymbolFraction: Object.fromEntries(exposure.perSymbolFraction),
      overThresholdSymbols: exposure.overThresholdSymbols,
      threshold: exposure.threshold,
    },
    leverageInvariantVerification: syntheticBreachTest,
    attribution,
    telemetry: {
      numActiveStrategies: telemetrySnapshot.numActiveStrategies,
      numDisabledStrategies: telemetrySnapshot.numDisabledStrategies,
      totalTrades: telemetrySnapshot.totalTrades,
      totalPnlUsd: telemetrySnapshot.totalPnlUsd,
      correlationMatrix: telemetrySnapshot.correlationMatrix ? {
        sources: telemetrySnapshot.correlationMatrix.sources,
        matrix: telemetrySnapshot.correlationMatrix.matrix,
        observationCount: telemetrySnapshot.correlationMatrix.observationCount,
      } : null,
    },
    killSwitchInvocations,
    ensemble: {
      trades: result.trades.length,
      totalPnlUsd: Number(directionalPnlUsd.toFixed(2)),
      totalReturnPct: result.totalReturn * 100,
      maxDrawdownPct: result.maxDrawdown * 100,
      sharpeRatio: result.sharpeRatio,
      winRate: result.winRate,
    },
    carry: {
      fundingCollectedUsd: Number(carryPnlUsd.toFixed(2)),
      fundingSnapshotsApplied: fundingPayments.filter((p) => p.payment !== 0).length,
      fundingSnapshotsSkipped: fundingPayments.filter((p) => p.payment === 0).length,
      effectiveCarryLeverage: finalEnsemble.getEffectiveCarryLeverage(),
      carryPausedFundingPeriods: finalEnsemble.fundingFlipKillSwitch.state.carryPausedFundingPeriods,
      carryPausedFundingUsd: Number(finalEnsemble.fundingFlipKillSwitch.state.carryPausedFundingUsd.toFixed(2)),
      forcedExitCount: finalEnsemble.fundingFlipKillSwitch.state.forcedExitCount,
      regimeActivationCount: finalEnsemble.fundingFlipKillSwitch.state.regimeActivationCount,
    },
    combinedEdge: {
      totalPnlUsd: Number(totalPnlUsd.toFixed(2)),
      directionalPnlUsd: Number(directionalPnlUsd.toFixed(2)),
      carryPnlUsd: Number(carryPnlUsd.toFixed(2)),
      totalReturnPct: Number(totalReturnPct.toFixed(3)),
      monthlyReturnPct: Number(monthlyReturnPct.toFixed(3)),
      annualizedReturnPct: Number(annualizedReturnPct.toFixed(3)),
      sharpe: Number(annualizedSharpe.toFixed(3)),
      maxDrawdownPct: result.maxDrawdown * 100,
      carryComponentPct: totalPnlUsd === 0 ? 0 : (carryPnlUsd / totalPnlUsd) * 100,
    },
    volTargetSeries: {
      avgMultiplier: volTargetSummary.avgVolMultiplier,
      avgRealizedDailyVol: volTargetSummary.avgRealizedDailyVol,
      avgRealizedAnnualizedVol: volTargetSummary.avgRealizedAnnualizedVol,
      upperClampFraction: volTargetSummary.upperClampFraction,
      lowerClampFraction: volTargetSummary.lowerClampFraction,
      middleFraction: volTargetSummary.middleFraction,
      totalDays: volTargetSummary.dailySeries.length,
      firstFew: volTargetSeries.slice(0, 5).map((p) => ({
        day: p.day, realizedDailyVol: p.realizedDailyVol, clampedVolMultiplier: p.clampedVolMultiplier,
      })),
      lastFew: volTargetSeries.slice(-5).map((p) => ({
        day: p.day, realizedDailyVol: p.realizedDailyVol, clampedVolMultiplier: p.clampedVolMultiplier,
      })),
    },
  };

  await Bun.write(args.outputPath, JSON.stringify(output, null, 2));

  console.log(JSON.stringify({
    symbol: args.symbol,
    timeframe: args.timeframe,
    trades: result.trades.length,
    directionalPnlUsd: Number(directionalPnlUsd.toFixed(2)),
    carryPnlUsd: Number(carryPnlUsd.toFixed(2)),
    totalReturnPct: Number(totalReturnPct.toFixed(3)),
    monthlyReturnPct: Number(monthlyReturnPct.toFixed(3)),
    portfolioVaR95Pct: portfolioVaR?.dailyVaR95Pct ?? null,
    aggregateLeverage: portfolioSnapshot.aggregateLeverage,
    numLeverageBreaches: portfolioSnapshot.numLeverageBreaches,
    aggregateDrawdownPct: aggregateDD?.drawdownPct ?? null,
    maxDrawdownPct: aggregateDD?.maxDrawdownPct ?? null,
    syntheticBreachTestFired: syntheticBreachTest.guardFired,
    numActiveStrategies: telemetrySnapshot.numActiveStrategies,
    numDisabledStrategies: telemetrySnapshot.numDisabledStrategies,
    totalTrades: telemetrySnapshot.totalTrades,
    totalPnlUsdTelemetry: telemetrySnapshot.totalPnlUsd,
    killSwitchInvocations: killSwitchInvocations.length,
  }, null, 2));
  console.log(`Wrote: ${args.outputPath}`);
}

main().catch((err: unknown) => {
  console.error("FATAL:", err);
  process.exit(1);
});
