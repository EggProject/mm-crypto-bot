// packages/backtest/src/report.ts — a backtest riport generator
//
// A `runBacktest` eredményéből strukturált riportot készít:
//   1. Összefoglaló szöveg (emberi olvasásra)
//   2. A metrikák JSON-formátumban
//   3. A trade-lista CSV-formátumban (részletes riport)

import type { BacktestMetrics, BacktestReport, BacktestResult } from "./types.js";

/**
 `formatReport` — egy BacktestResult-ből strukturált riportot készít.
 Az emberi olvasásra szánt összefoglaló a `selected-strategy.md` §8.2
 minimum-mutatók alapján értékel.
*/
export function formatReport(
  result: BacktestResult,
  metrics: BacktestMetrics,
  symbol: string,
): BacktestReport {
  const lines: string[] = [];
  lines.push(`# Backtest riport — ${symbol}`);
  lines.push("");
  lines.push(`Időszak: ${new Date(result.startTime).toISOString()} → ${new Date(result.endTime).toISOString()}`);
  lines.push(`Kezdő equity: $${(result.equityCurve[0]?.equity ?? 0).toFixed(2)}`);
  lines.push(`Végső equity: $${(result.equityCurve[result.equityCurve.length - 1]?.equity ?? 0).toFixed(2)}`);
  lines.push("");
  lines.push("## Teljesítmény-mutatók");
  lines.push(`- Teljes hozam: ${(metrics.totalReturnPct * 100).toFixed(2)}%`);
  lines.push(`- Évesített hozam: ${(metrics.annualizedReturnPct * 100).toFixed(2)}%`);
  lines.push(`- Sharpe ratio: ${metrics.sharpeRatio.toFixed(3)} (minimum: 1.0)`);
  lines.push(`- Sortino ratio: ${formatNumber(metrics.sortinoRatio)}`);
  lines.push(`- Max drawdown: ${(metrics.maxDrawdownPct * 100).toFixed(2)}% (maximum: 30%)`);
  lines.push(`- Profit factor: ${formatNumber(metrics.profitFactor)}`);
  lines.push(`- Win rate: ${(metrics.winRatePct * 100).toFixed(2)}% (minimum: 30%)`);
  lines.push(`- Trade-ek száma: ${metrics.totalTrades}`);
  lines.push(`- Avg win: $${metrics.avgWin.toFixed(2)} (${(metrics.avgWinPct * 100).toFixed(2)}%)`);
  lines.push(`- Avg loss: $${metrics.avgLoss.toFixed(2)} (${(metrics.avgLossPct * 100).toFixed(2)}%)`);
  lines.push(`- Best trade: $${metrics.bestTrade.toFixed(2)}`);
  lines.push(`- Worst trade: $${metrics.worstTrade.toFixed(2)}`);
  lines.push(`- Max consecutive wins: ${metrics.maxConsecutiveWins}`);
  lines.push(`- Max consecutive losses: ${metrics.maxConsecutiveLosses}`);
  lines.push(`- Exposure time: ${(metrics.exposureTime * 100).toFixed(2)}%`);
  lines.push(`- Kill-switch triggered: ${result.killSwitchTriggered ? "igen" : "nem"}`);
  lines.push("");
  // Minősítés a minimum-mutatók alapján.
  lines.push("## Értékelés");
  const checks: string[] = [];
  checks.push(`  ${check(metrics.sharpeRatio >= 1.0, "Sharpe ratio >= 1.0")}`);
  checks.push(`  ${check(metrics.maxDrawdownPct <= 0.3, "Max drawdown <= 30%")}`);
  checks.push(`  ${check(metrics.winRatePct >= 0.3, "Win rate >= 30%")}`);
  checks.push(`  ${check(metrics.profitFactor >= 1.3, "Profit factor >= 1.3")}`);
  lines.push(...checks);
  lines.push("");
  // Trade-lista.
  lines.push("## Trade-lista");
  for (const t of result.trades) {
    lines.push(
      `  ${new Date(t.entryTime).toISOString()} ${t.side} @ $${t.entryPrice.toFixed(2)} → ` +
        `$${t.exitPrice.toFixed(2)} (${t.exitReason}): PnL=$${t.pnlUsd.toFixed(2)} ` +
        `(${((t.pnlPct) * 100).toFixed(2)}%), fees=$${t.feesUsd.toFixed(2)}`,
    );
  }
  return {
    summary: lines.join("\n"),
    result,
    metrics,
  };
}

/**
 `formatJsonReport` — a riport JSON formátumban.
*/
export function formatJsonReport(report: BacktestReport): string {
  return JSON.stringify(report, null, 2);
}

/**
 `formatTradeListCsv` — a trade-lista CSV formátumban.
*/
export function formatTradeListCsv(result: BacktestResult): string {
  const header = "entryTime,exitTime,side,symbol,entryPrice,exitPrice,quantity,notionalUsd,pnlUsd,pnlPct,feesUsd,exitReason";
  const rows = result.trades.map((t) =>
    `${new Date(t.entryTime).toISOString()},${new Date(t.exitTime).toISOString()},${t.side},${t.symbol},` +
      `${t.entryPrice},${t.exitPrice},${t.quantity},${t.notionalUsd},${t.pnlUsd},${t.pnlPct},${t.feesUsd},${t.exitReason}`,
  );
  return [header, ...rows].join("\n");
}

function check(ok: boolean, label: string): string {
  return ok ? `✓ ${label}` : `✗ ${label} (NEM TELJESÜL)`;
}

function formatNumber(n: number): string {
  if (n === Number.POSITIVE_INFINITY) {
    return "∞";
  }
  return n.toFixed(3);
}
