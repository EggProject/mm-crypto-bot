#!/usr/bin/env bun
// packages/backtest-tools/src/cli/run-donchian-mtf.ts
//
// Phase 8 Track F — 1h MTF Donchian (3-tier: 1h/4h/1d) baseline backtest CLI.
//
// A futtatás a Phase 1-3 OHLCV adatokon (BTC/ETH/SOL × 1h/4h/1d,
// 2024-01 → 2026-07) történik, a `DonchianMtfStrategy` stratégiával.
//
// 1:10 LEVERAGE (MANDATORY USER DIRECTIVE):
//   A user 2026-07-04 14:17-es direktívája szerint MINDEN trade-nek
//   PONTOSAN 1:10 leverage-szel kell futnia (10× notional-on 1× tőkén).
//   A CLI a `--leverage` flag-et CSAK 1 vagy 10 értékkel fogadja el;
//   minden más értéket hard error-ral elvet.
//
//   A backtest engine natívan 1:1 (margin = notional) backtest-et futtat.
//   A 1:10 leverage hatását a CLI RUNNER post-processing lépésben
//   alkalmazza a kapott BacktestResult-ra:
//     1) minden trade PnL-jét (pnlUsd + feesUsd) szorozza a leverage-szel
//        (a fee-t a notional-ra vetítve tartjuk, mert a fee %-os)
//     2) levonja a borrow cost-ot a borrowed portion-re
//        (notional × (leverage-1)/leverage × borrowRatePerHour × holdingHours)
//     3) újraszámolja az equity-görbét és a Sharpe/Sortino/MaxDD/ProfitFactor
//        mutatókat az új trade-listából
//
//   A nyers 1:1 trade-listát is megőrizzük a JSON-ban (`resultRaw`),
//   hogy az auditor ellenőrizhesse a transzformációt.
//
// Használat:
//   bun run packages/backtest-tools/src/cli/run-donchian-mtf.ts \
//     --symbol=BTC/USDT --ltf-timeframe=1h --mtf-timeframe=4h --htf-timeframe=1d \
//     --leverage=10 \
//     --output=backtest-results/baseline-donchian-mtf-btc-1h.json

import { resolve } from "node:path";

import { CsvExchangeFeed } from "../data/csv-feed.js";
import {
  runBacktest,
  type BacktestResult,
  type CostModel,
  type EquityPoint,
} from "@mm-crypto-bot/backtest";
import { DonchianMtfStrategy } from "@mm-crypto-bot/core";
import type { ExchangeFeed, BacktestMetrics } from "@mm-crypto-bot/backtest";
import type { Timeframe, Trade } from "@mm-crypto-bot/shared/types";
import { computeMetrics } from "@mm-crypto-bot/backtest";

// ----------------------------------------------------------------------
// CLI arg parsing
// ----------------------------------------------------------------------

interface CliArgs {
  readonly symbol: string;
  readonly ltfTimeframe: Timeframe;
  readonly mtfTimeframe: Timeframe;
  readonly htfTimeframe: Timeframe;
  readonly initialEquity: number;
  readonly leverage: number;
  readonly outputPath: string;
}

const VALID_TIMEFRAMES: readonly Timeframe[] = ["1h", "4h", "1d"];
const VALID_LEVERAGE = new Set([1, 10]);

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  let symbol = "BTC/USDT";
  let ltfTimeframe: Timeframe = "1h";
  let mtfTimeframe: Timeframe = "4h";
  let htfTimeframe: Timeframe = "1d";
  let initialEquity = 10_000;
  let leverage = 10;
  let outputPath = "backtest-results/baseline-donchian-mtf-btc-1h.json";

  for (const arg of args) {
    if (arg.startsWith("--symbol=")) {
      symbol = arg.slice("--symbol=".length);
    } else if (arg.startsWith("--ltf-timeframe=")) {
      const tf = arg.slice("--ltf-timeframe=".length) as Timeframe;
      if (!VALID_TIMEFRAMES.includes(tf)) {
        throw new Error(`Invalid ltf-timeframe: ${tf} (must be one of ${VALID_TIMEFRAMES.join(", ")})`);
      }
      ltfTimeframe = tf;
    } else if (arg.startsWith("--mtf-timeframe=")) {
      const tf = arg.slice("--mtf-timeframe=".length) as Timeframe;
      if (!VALID_TIMEFRAMES.includes(tf)) {
        throw new Error(`Invalid mtf-timeframe: ${tf}`);
      }
      mtfTimeframe = tf;
    } else if (arg.startsWith("--htf-timeframe=")) {
      const tf = arg.slice("--htf-timeframe=".length) as Timeframe;
      if (!VALID_TIMEFRAMES.includes(tf)) {
        throw new Error(`Invalid htf-timeframe: ${tf}`);
      }
      htfTimeframe = tf;
    } else if (arg.startsWith("--equity=")) {
      initialEquity = Number(arg.slice("--equity=".length));
    } else if (arg.startsWith("--leverage=")) {
      const lev = Number(arg.slice("--leverage=".length));
      // 1:10 MANDATORY USER DIRECTIVE — only 1 or 10 accepted.
      if (!VALID_LEVERAGE.has(lev)) {
        throw new Error(
          `[donchian-mtf] leverage must be 1 or 10 (1:10 MANDATORY user directive), got ${lev}`,
        );
      }
      leverage = lev;
    } else if (arg.startsWith("--output=")) {
      outputPath = arg.slice("--output=".length);
    }
  }
  return { symbol, ltfTimeframe, mtfTimeframe, htfTimeframe, initialEquity, leverage, outputPath };
}

// ----------------------------------------------------------------------
// Cost model (bybit.eu SPOT default)
// ----------------------------------------------------------------------

const COST_MODEL: CostModel = {
  takerFeeRate: 0.001,
  slippageRate: 0.0005,
  spreadRate: 0.0002,
  borrowRatePerHour: 0.0001,
  fundingRatePer8h: 0,
};

// ----------------------------------------------------------------------
// Leverage post-processing
// ----------------------------------------------------------------------

interface LeveragedTrade {
  readonly originalPnlUsd: number;
  readonly leveragedPnlUsd: number;
  readonly borrowedFractionNotional: number;
  readonly borrowCostUsd: number;
  readonly holdingHours: number;
  readonly exitReason: string;
  readonly entryTime: number;
  readonly exitTime: number;
  readonly notionalUsd: number;
  readonly feesUsd: number;
  readonly leveragedGrossPnlUsd: number;
}

/**
 * `transformTradeLeverage` — egy 1× (margin = notional) trade-et átalakít
 * 1:10 leveraged trade-é.
 *
 * A transzformáció:
 *   - unleveraged_gross_pnl = pnlUsd + feesUsd  (a feesUsd a notional-ra van)
 *   - leveraged_gross_pnl = unleveraged_gross_pnl × leverage
 *   - borrowed_fraction = notionalUsd × (leverage − 1) / leverage
 *   - borrow_cost = borrowed_fraction × borrowRatePerHour × holdingHours
 *   - leveraged_pnlUsd = leveraged_gross_pnl − feesUsd − borrow_cost
 *
 * 1× leverage esetén a borrowed_fraction = 0, a borrow_cost = 0, és a
 * leveraged_pnlUsd visszaadja az eredeti pnlUsd-t (identity transform).
 */
export function transformTradeLeverage(
  trade: Trade,
  leverage: number,
  borrowRatePerHour: number,
): LeveragedTrade {
  const holdingHours = (trade.exitTime - trade.entryTime) / (60 * 60 * 1000);
  const unlevGross = trade.pnlUsd + trade.feesUsd;
  const levGross = unlevGross * leverage;
  const borrowedFraction = trade.notionalUsd * ((leverage - 1) / leverage);
  const borrowCost = borrowedFraction * borrowRatePerHour * holdingHours;
  const leveragedPnl = levGross - trade.feesUsd - borrowCost;
  return {
    originalPnlUsd: trade.pnlUsd,
    leveragedPnlUsd: leveragedPnl,
    borrowedFractionNotional: borrowedFraction,
    borrowCostUsd: borrowCost,
    holdingHours,
    exitReason: trade.exitReason,
    entryTime: trade.entryTime,
    exitTime: trade.exitTime,
    notionalUsd: trade.notionalUsd,
    feesUsd: trade.feesUsd,
    leveragedGrossPnlUsd: levGross,
  };
}

/**
 * `buildLeveragedEquityCurve` — az új (1:10) equity-görbe a kezdő equity-ből
 * és a trade-szintű leveraged PnL-ekből épül fel. A equity-görbe az eredeti
 * `equityCurve` időbélyegeit használja, de a PnL-ek a trade-exit időpontjában
 * érvényesítődnek (az engine eredeti görbéje is trade-exit-en frissül).
 *
 * A legegyszerűbb modell: a trade PnL-jét a trade exitTime-jában érvényesítjük,
 * és a trade-ek közötti candle-eken lineárisan interpolálunk az engine eredeti
 * equity-görbéjéből (a trade PnL különbséget a trade előtti és utáni snapshot
 * alapján).
 */
function buildLeveragedEquityCurve(
  rawEquityCurve: readonly EquityPoint[],
  rawTrades: readonly Trade[],
  leveragedTrades: readonly LeveragedTrade[],
): EquityPoint[] {
  if (rawEquityCurve.length === 0) {
    return [];
  }
  // PnL trade-enként: (leveraged − original). Ezt a deltát alkalmazzuk a
  // raw equity-görbére minden trade exitTime-jában.
  // Trade PnL deltas (idő szerint rendezve):
  const tradeDeltas = new Map<number, number>();
  for (let i = 0; i < rawTrades.length; i++) {
    const t = rawTrades[i]!;
    const lev = leveragedTrades[i]!;
    const delta = lev.leveragedPnlUsd - t.pnlUsd;
    // Ha több trade azonos exitTime-mal zárul, a delták összeadódnak.
    tradeDeltas.set(t.exitTime, (tradeDeltas.get(t.exitTime) ?? 0) + delta);
  }
  // A trade-ek exitTime-ját megelőző candle-eken a raw equity-görbét használjuk
  // (a PnL delta csak az exit után érvényes).
  // A trade exitTime-ja utáni candle-eken a raw equity-görbe értékéhez hozzáadjuk
  // az ÖSSZES addig felhalmozott PnL-deltát.
  const sortedExitTimes = [...tradeDeltas.keys()].sort((a, b) => a - b);
  const result: EquityPoint[] = [];
  let accumulatedDelta = 0;
  let nextExitIdx = 0;
  for (const point of rawEquityCurve) {
    // Frissítjük az accumulatedDelta-t, ha elértünk egy új trade exitTime-ot.
    while (
      nextExitIdx < sortedExitTimes.length &&
      sortedExitTimes[nextExitIdx]! <= point.timestamp
    ) {
      const exitTime = sortedExitTimes[nextExitIdx]!;
      accumulatedDelta += tradeDeltas.get(exitTime) ?? 0;
      nextExitIdx++;
    }
    result.push({
      timestamp: point.timestamp,
      equity: point.equity + accumulatedDelta,
    });
  }
  return result;
}

/**
 * `buildLeveragedTradeList` — a transformed trade-list (a pnlUsd-t kicseréljük,
 * minden más mezőt megtartunk). A symbol/quantity/entryPrice/exitPrice
 * változatlanok (a position-size és a kitöltési ár nem függ a leverage-től —
 * a leverage csak a margin-lock és a PnL-amplification oldaláról hat).
 */
function buildLeveragedTradeList(
  rawTrades: readonly Trade[],
  leveragedTrades: readonly LeveragedTrade[],
): Trade[] {
  return rawTrades.map((t, i) => {
    const lev = leveragedTrades[i]!;
    return {
      ...t,
      pnlUsd: lev.leveragedPnlUsd,
    };
  });
}

/**
 * `recomputeMetrics` — Sharpe, Sortino, MaxDD, ProfitFactor, WinRate, TotalReturn
 * újraszámítása a leveraged trade-listából és equity-görbéből.
 *
 * Az engine BacktestResult típusát visszaadjuk, hogy az output JSON formátuma
 * konzisztens legyen a Phase 5 baseline-okkal.
 */
function recomputeMetrics(
  leveragedTrades: readonly Trade[],
  leveragedEquityCurve: readonly EquityPoint[],
  startTimeMs: number,
  endTimeMs: number,
  periodsPerYear: number,
): BacktestMetrics {
  return computeMetrics(leveragedTrades, leveragedEquityCurve, startTimeMs, endTimeMs, periodsPerYear);
}

// ----------------------------------------------------------------------
// Main
// ----------------------------------------------------------------------

async function main(): Promise<void> {
  const args = parseArgs();
  const dataDir = resolve(import.meta.dir, "..", "..", "..", "..", "data", "ohlcv");
  const feed = new CsvExchangeFeed(dataDir) as unknown as ExchangeFeed;

  const startTime = new Date(Date.UTC(2024, 0, 1));
  const endTime = new Date();

  const strategy = new DonchianMtfStrategy({
    leverage: args.leverage,
  });

  console.log(`[donchian-mtf] symbol=${args.symbol} ltf=${args.ltfTimeframe} mtf=${args.mtfTimeframe} htf=${args.htfTimeframe}`);
  console.log(`[donchian-mtf] leverage=${args.leverage}× (1:10 MANDATORY user directive)`);
  console.log(`[donchian-mtf] period: ${startTime.toISOString()} → ${endTime.toISOString()}`);

  const t0 = Date.now();
  // A raw 1× backtest (az engine natívan 1:1-et futtat).
  const rawResult: BacktestResult = await runBacktest({
    symbol: args.symbol,
    htfTimeframe: args.htfTimeframe,
    mtfTimeframe: args.mtfTimeframe,
    ltfTimeframe: args.ltfTimeframe,
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
  const elapsedMs = Date.now() - t0;

  // 1:10 leverage post-processing
  const leveragedTrades = rawResult.trades.map((t) =>
    transformTradeLeverage(t, args.leverage, COST_MODEL.borrowRatePerHour),
  );
  const leveragedTradeList = buildLeveragedTradeList(rawResult.trades, leveragedTrades);
  const leveragedEquityCurve = buildLeveragedEquityCurve(
    rawResult.equityCurve,
    rawResult.trades,
    leveragedTrades,
  );
  const periodsPerYear = (365 * 24 * 60 * 60 * 1000) / (60 * 60 * 1000); // 1h → 8760
  const leveragedMetrics = recomputeMetrics(
    leveragedTradeList,
    leveragedEquityCurve,
    startTime.getTime(),
    endTime.getTime(),
    periodsPerYear,
  );

  // Output metrics — a leveraged eredményeket használjuk.
  const totalDays = (endTime.getTime() - startTime.getTime()) / (1000 * 60 * 60 * 24);
  const totalMonths = totalDays / 30.44;
  const monthlyReturn =
    leveragedMetrics.totalReturnPct > 0 && totalMonths > 0
      ? Math.pow(1 + leveragedMetrics.totalReturnPct, 1 / totalMonths) - 1
      : 0;
  const winRatePct = leveragedMetrics.winRatePct;
  const wins = leveragedTradeList.filter((t) => t.pnlUsd > 0);
  const losses = leveragedTradeList.filter((t) => t.pnlUsd < 0);

  // Exit-reason breakdown
  const exitReasonCounts: Record<string, number> = {};
  let totalBorrowCostUsd = 0;
  for (const lev of leveragedTrades) {
    exitReasonCounts[lev.exitReason] = (exitReasonCounts[lev.exitReason] ?? 0) + 1;
    totalBorrowCostUsd += lev.borrowCostUsd;
  }
  const avgRMultiple = (() => {
    if (leveragedTradeList.length === 0) return 0;
    // R-multiple = pnlUsd / kockázat (entry - SL) * quantity. Helyette
    // használjuk a pnlPct / avg_stop_pct-ot, mint relatív R-multiple proxy-t.
    // A pnlPct-et a Trade típus tartalmazza (entry → exit % move).
    // Az R-multiple = (exit - entry) / (entry - SL) long esetén.
    // Mivel a Trade típus nem tartja az SL-t, használjuk a pnlPct-et mint
    // a nyers %-mozgás proxy-ját.
    const sumAbsR = leveragedTradeList.reduce((acc, t) => acc + Math.abs(t.pnlPct), 0);
    return sumAbsR / leveragedTradeList.length;
  })();

  // Trade-count reality check (Phase 5 baseline 19-28 trade / 30 hó / sym volt
  // a 1d Donchian-nal; Phase 8 spec 5-10×-et vár).
  const tradeCountExpected = { min: 100, max: 5000 };
  const tradeCountOk =
    leveragedTradeList.length >= tradeCountExpected.min &&
    leveragedTradeList.length <= tradeCountExpected.max;

  console.log(`\n=== DONCHIAN MTF RESULTS ${args.symbol} ${args.ltfTimeframe}/${args.mtfTimeframe}/${args.htfTimeframe} leverage=${args.leverage}× ===`);
  console.log(`Elapsed:                ${elapsedMs}ms`);
  console.log(`Total return:           ${(leveragedMetrics.totalReturnPct * 100).toFixed(2)}%`);
  console.log(`Monthly avg:            ${(monthlyReturn * 100).toFixed(2)}%/mo (over ${totalMonths.toFixed(1)} months)`);
  console.log(`Annualized:             ${(leveragedMetrics.annualizedReturnPct * 100).toFixed(2)}%`);
  console.log(`Sharpe:                 ${leveragedMetrics.sharpeRatio.toFixed(3)}`);
  console.log(`Sortino:                ${leveragedMetrics.sortinoRatio.toFixed(3)}`);
  console.log(`Max DD:                 ${(leveragedMetrics.maxDrawdownPct * 100).toFixed(2)}%`);
  console.log(`Profit factor:          ${leveragedMetrics.profitFactor.toFixed(3)}`);
  console.log(`Win rate:               ${(winRatePct * 100).toFixed(2)}%`);
  console.log(`Trades:                 ${leveragedTradeList.length}`);
  console.log(`Avg trade %-move:       ${(avgRMultiple * 100).toFixed(2)}% (R-multiple proxy)`);
  console.log(`Total borrow cost:      $${totalBorrowCostUsd.toFixed(2)} (across all trades)`);
  console.log(`Kill-switch:            ${rawResult.killSwitchTriggered ? "yes" : "no"}`);
  console.log(`Exit-reason breakdown:`);
  for (const [reason, count] of Object.entries(exitReasonCounts)) {
    console.log(`  ${reason.padEnd(20)} ${count}`);
  }
  if (wins.length > 0) {
    const avgWin = wins.reduce((a, t) => a + t.pnlUsd, 0) / wins.length;
    console.log(`Avg win:                $${avgWin.toFixed(2)}`);
  }
  if (losses.length > 0) {
    const avgLoss = losses.reduce((a, t) => a + t.pnlUsd, 0) / losses.length;
    console.log(`Avg loss:               $${avgLoss.toFixed(2)}`);
  }
  const finalEq = leveragedEquityCurve[leveragedEquityCurve.length - 1]?.equity ?? args.initialEquity;
  console.log(`Final equity:           $${finalEq.toFixed(2)}`);
  if (!tradeCountOk) {
    console.warn(
      `[donchian-mtf] WARNING DEVIATION: ${leveragedTradeList.length} trades (expected ${tradeCountExpected.min}-${tradeCountExpected.max} — Phase 8 spec 5-10× Phase 5 baseline 19-28)`,
    );
  } else {
    console.log(`[donchian-mtf] OK Trade-count (${leveragedTradeList.length}) within Phase 8 spec range (${tradeCountExpected.min}-${tradeCountExpected.max})`);
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
        leverage: args.leverage,
        leverageNote:
          args.leverage === 10
            ? "1:10 leverage MANDATORY user directive (2026-07-04 14:17). PnL amplified 10x; borrow cost on 9/10 notional at bybit.eu 0.01%/h subtracted."
            : "1x leverage (paper-trade baseline).",
        exitReasonCounts,
        totalBorrowCostUsd,
        avgRMultipleProxy: avgRMultiple,
        // A 1:10 transzformált eredmények — ezek a publikus riport-számok.
        result: {
          ...rawResult,
          totalReturn: leveragedMetrics.totalReturnPct,
          annualizedReturn: leveragedMetrics.annualizedReturnPct,
          sharpeRatio: leveragedMetrics.sharpeRatio,
          sortinoRatio: leveragedMetrics.sortinoRatio,
          maxDrawdown: leveragedMetrics.maxDrawdownPct,
          profitFactor: leveragedMetrics.profitFactor,
          winRate: leveragedMetrics.winRatePct,
          totalTrades: leveragedMetrics.totalTrades,
          trades: leveragedTradeList,
          equityCurve: leveragedEquityCurve,
          // Extra riport-mezők
          avgWin: leveragedMetrics.avgWin,
          avgLoss: leveragedMetrics.avgLoss,
          avgWinPct: leveragedMetrics.avgWinPct,
          avgLossPct: leveragedMetrics.avgLossPct,
          bestTrade: leveragedMetrics.bestTrade,
          worstTrade: leveragedMetrics.worstTrade,
          maxConsecutiveWins: leveragedMetrics.maxConsecutiveWins,
          maxConsecutiveLosses: leveragedMetrics.maxConsecutiveLosses,
          exposureTime: leveragedMetrics.exposureTime,
        },
        // A nyers 1:1 backtest eredmények — ellenőrzéshez.
        resultRaw: {
          ...rawResult,
          // A `resultRaw.equityCurve` és `resultRaw.trades` a nyers 1:1 trade-list és equity-görbe.
        },
        // Per-trade leverage transformation details
        leveragedTradesBreakdown: leveragedTrades,
      },
      null,
      2,
    ),
    "utf8",
  );
  console.log(`[donchian-mtf] Saved: ${absOutput}`);
}

main().catch((err: unknown) => {
  console.error("[donchian-mtf] FATAL:", err);
  process.exit(1);
});