#!/usr/bin/env bun
// packages/backtest-tools/src/cli/run-regime-routed-ensemble.ts — Regime-Routed Ensemble baseline
//
// Phase 16 Track B+C — Composes the 4 Phase 15 retail strategies into a
// regime-routed ensemble (RegimeRoutedEnsemble) and backtests it on BTC/ETH/SOL
// M15. The ADX(14) on the 1d HTF partitions the strategy mix:
//   - ADX < 20 → "range regime" → Pivot Grid + Donchian Range fire (mean-reversion)
//   - ADX >= 20 → "trend regime" → BB Squeeze + Keltner Grid fire (breakout)
//
// Aggregation logic:
//   - 0 active sub-strategies fire → null
//   - Single signal → emit with reason tagged `[RegimeEnsemble] regime=X solo=strategy`
//   - Multi-signal consensus on same side → emit highest-confidence signal,
//     reason tagged `[RegimeEnsemble] regime=X consensus=N/2`
//   - Conflicting sides → null (defer)
//
// Használat:
//   bun run packages/backtest-tools/src/cli/run-regime-routed-ensemble.ts \
//     --symbol=BTC/USDT --timeframe=15m --min-consensus=1 \
//     --output=backtest-results/phase18-regime-ensemble-btc-15m-1of2.json
//
// Phase 18 Track A added the --min-consensus=N flag (1 = either sub-strategy
// fires -> emit, 2 = legacy Phase 16 2-of-2 strict consensus). Default 1
// lifts the BTC regime envelope from 0.00%/mo (Phase 17 kill-switch) to a
// viable positive return. To recover the legacy 2-of-2 behavior, pass
// --min-consensus=2.

import { resolve } from "node:path";

import { CsvExchangeFeed } from "../data/csv-feed.js";
import { runBacktest, type BacktestResult, type CostModel } from "@mm-crypto-bot/backtest";
import {
  RegimeRoutedEnsemble,
  DEFAULT_REGIME_ROUTED_ENSEMBLE_CONFIG,
} from "@mm-crypto-bot/core";
import type { ExchangeFeed } from "@mm-crypto-bot/backtest";
import { makeSymbol, type Timeframe } from "@mm-crypto-bot/shared/types";

interface CliArgs {
  readonly symbol: string;
  readonly timeframe: Timeframe;
  readonly initialEquity: number;
  readonly outputPath: string;
  readonly adxRangeThreshold: number;
  readonly minConsensus: number;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  let symbol = "BTC/USDT";
  let timeframe: Timeframe = "15m";
  let initialEquity = 10_000;
  let outputPath = "backtest-results/phase16-regime-ensemble-btc-15m.json";
  // Phase 16 Track B — Default 20 (Wilder 1978 canonical range/trend
  // threshold). Override via --adx-range-threshold=N (must be > 0).
  let adxRangeThreshold = 20;
  // Phase 18 Track A — Default 1 (either sub-strategy fires -> emit, lifts
  // BTC from kill-switch). Set to 2 to recover the Phase 16 2-of-2 strict
  // consensus. Override via --min-consensus=N (must be 1 or 2).
  let minConsensus = 1;
  for (const arg of args) {
    if (arg.startsWith("--symbol=")) {
      symbol = arg.slice("--symbol=".length);
    } else if (arg.startsWith("--timeframe=")) {
      const tf = arg.slice("--timeframe=".length) as Timeframe;
      // Phase 16 — Regime-Routed Ensemble runs on M15 by default (range +
      // trend sub-strategies aggregate cleanly to M15).
      if (tf !== "15m") {
        throw new Error(`Regime-Routed Ensemble baseline requires 15m timeframe, got: ${tf}`);
      }
      timeframe = tf;
    } else if (arg.startsWith("--equity=")) {
      initialEquity = Number(arg.slice("--equity=".length));
    } else if (arg.startsWith("--output=")) {
      outputPath = arg.slice("--output=".length);
    } else if (arg.startsWith("--adx-range-threshold=")) {
      adxRangeThreshold = Number(arg.slice("--adx-range-threshold=".length));
      if (!Number.isFinite(adxRangeThreshold) || adxRangeThreshold <= 0) {
        throw new Error(`--adx-range-threshold must be > 0; got: ${adxRangeThreshold}`);
      }
    } else if (arg.startsWith("--min-consensus=")) {
      minConsensus = Number(arg.slice("--min-consensus=".length));
      if (!Number.isInteger(minConsensus) || minConsensus < 1 || minConsensus > 2) {
        throw new Error(`--min-consensus must be 1 or 2; got: ${minConsensus}`);
      }
    }
  }
  return { symbol, timeframe, initialEquity, outputPath, adxRangeThreshold, minConsensus };
}

// Regime-Routed Ensemble timeline — HTF=1d, MTF=4h, LTF=15m.
// The ADX(14) is read from `mtfState.htf.adx` (engine-computed indicator).
function timeframesForRegimeEnsemble(ltf: Timeframe): { htf: Timeframe; mtf: Timeframe; ltf: Timeframe } {
  if (ltf === "15m") return { htf: "1d", mtf: "4h", ltf: "15m" };
  throw new Error(`Regime-Routed Ensemble baseline supports 15m only, got: ${ltf as string}`);
}

// bybit.eu SPOT 1:10 leverage cost model (matches Phase 14D baseline).
const COST_MODEL: CostModel = {
  takerFeeRate: 0.001, // 0.1% / side
  slippageRate: 0.0005, // 0.05% / side
  spreadRate: 0.0002, // 2 bps / side
  borrowRatePerHour: 0.0001, // 0.01%/h
  fundingRatePer8h: 0, // SPOT only
};

async function main(): Promise<void> {
  const args = parseArgs();
  const tf = timeframesForRegimeEnsemble(args.timeframe);
  const dataDir = resolve(import.meta.dir, "..", "..", "..", "..", "data", "ohlcv");
  const feed = new CsvExchangeFeed(dataDir) as unknown as ExchangeFeed;

  // RegimeRoutedEnsemble takes a partial config + LTF. We override the
  // adxRangeThreshold when the CLI flag is present and the minConsensus
  // (Phase 18 Track A: default 1 lifts BTC from kill-switch; 2 = legacy
  // 2-of-2 strict consensus).
  const ensembleConfig = {
    ...DEFAULT_REGIME_ROUTED_ENSEMBLE_CONFIG,
    adxRangeThreshold: args.adxRangeThreshold,
    minConsensus: args.minConsensus,
  };
  const strategy = new RegimeRoutedEnsemble(ensembleConfig, "15m");

  // 2024-01-01 → today (matches Phase 14/15 baseline windows).
  const startTime = new Date(Date.UTC(2024, 0, 1));
  const endTime = new Date();

  console.log(`[regime-ensemble] symbol=${args.symbol} ltf=${args.timeframe}`);
  console.log(`[regime-ensemble] timeframes: htf=${tf.htf} mtf=${tf.mtf} ltf=${tf.ltf}`);
  console.log(`[regime-ensemble] components: Pivot Grid + BB Squeeze + Donchian Range + Keltner Grid`);
  console.log(`[regime-ensemble] routing: ADX<${args.adxRangeThreshold}=range (Pivot+Donchian) | ADX>=${args.adxRangeThreshold}=trend (BB+Keltner)`);
  console.log(`[regime-ensemble] aggregation: minConsensus=${args.minConsensus} (consensus-N/2, highest-conf wins) | conflict → defer`);
  console.log(`[regime-ensemble] period: ${startTime.toISOString()} → ${endTime.toISOString()}`);
  console.log(`[regime-ensemble] initial equity: $${args.initialEquity}`);

  const result: BacktestResult = await runBacktest({
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
      kellyFraction: 0.25,
      maxDrawdown: 0.5,
      maxPositionPctEquity: 0.2,
      minPositionPctEquity: 0.01,
    },
    strategy,
  });

  // Report envelope.
  const totalDays = (endTime.getTime() - startTime.getTime()) / (1000 * 60 * 60 * 24);
  const totalMonths = totalDays / 30.44;
  const monthlyReturn = result.totalReturn > 0 ? (Math.pow(1 + result.totalReturn, 1 / totalMonths) - 1) : 0;
  const wins = result.trades.filter((t) => t.pnlUsd > 0);
  const losses = result.trades.filter((t) => t.pnlUsd < 0);
  const winRate = result.trades.length > 0 ? wins.length / result.trades.length : 0;

  console.log(`\n=== RESULTS regime-ensemble ${args.symbol} ${args.timeframe} ===`);
  console.log(`Total return:     ${(result.totalReturn * 100).toFixed(2)}%`);
  console.log(`Monthly avg:      ${(monthlyReturn * 100).toFixed(2)}%/mo (over ${totalMonths.toFixed(1)} months)`);
  console.log(`Annualized:       ${(result.annualizedReturn * 100).toFixed(2)}%`);
  console.log(`Sharpe:           ${result.sharpeRatio.toFixed(3)}`);
  console.log(`Sortino:          ${result.sortinoRatio.toFixed(3)}`);
  console.log(`Max DD:           ${(result.maxDrawdown * 100).toFixed(2)}%`);
  console.log(`Profit factor:    ${result.profitFactor.toFixed(3)}`);
  console.log(`Win rate:         ${(winRate * 100).toFixed(2)}%`);
  console.log(`Trades:           ${result.totalTrades}`);
  console.log(`Kill-switch:      ${result.killSwitchTriggered ? "yes" : "no"}`);

  if (result.trades.length > 0) {
    const avgWin = wins.length > 0 ? wins.reduce((a, t) => a + t.pnlUsd, 0) / wins.length : 0;
    const avgLoss = losses.length > 0 ? losses.reduce((a, t) => a + t.pnlUsd, 0) / losses.length : 0;
    const bestTrade = Math.max(...result.trades.map((t) => t.pnlUsd));
    const worstTrade = Math.min(...result.trades.map((t) => t.pnlUsd));
    console.log(`Avg win:          $${avgWin.toFixed(2)}`);
    console.log(`Avg loss:         $${avgLoss.toFixed(2)}`);
    console.log(`Best trade:       $${bestTrade.toFixed(2)}`);
    console.log(`Worst trade:      $${worstTrade.toFixed(2)}`);
  }

  const fs = await import("node:fs/promises");
  await fs.mkdir(resolve(import.meta.dir, "..", "..", "..", "..", "backtest-results"), { recursive: true });
  await fs.writeFile(
    resolve(import.meta.dir, "..", "..", "..", "..", args.outputPath),
    JSON.stringify(
      {
        args,
        strategy: "regime-routed-ensemble",
        components: ["pivot-grid", "bb-squeeze", "donchian-range", "keltner-grid"],
        regimeRouting: {
          rangeThreshold: args.adxRangeThreshold,
          rangeRegime: ["pivot-grid", "donchian-range"],
          trendRegime: ["bb-squeeze", "keltner-grid"],
        },
        timeframe: tf,
        monthlyReturn,
        totalMonths,
        result,
      },
      null,
      2,
    ),
    "utf8",
  );
  console.log(`\n[regime-ensemble] Saved: ${args.outputPath}`);
}

main().catch((err: unknown) => {
  console.error("[regime-ensemble] FATAL:", err);
  process.exit(1);
});
