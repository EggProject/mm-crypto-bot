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
  const headerLines = [
    `# Backtest riport — ${symbol}`,
    "",
    `Időszak: ${new Date(result.startTime).toISOString()} → ${new Date(result.endTime).toISOString()}`,
    `Kezdő equity: $${(result.equityCurve.at(0)?.equity ?? 0).toFixed(2)}`,
    `Végső equity: $${(result.equityCurve.at(-1)?.equity ?? 0).toFixed(2)}`,
    "",
    "## Teljesítmény-mutatók",
    `- Teljes hozam: ${(metrics.totalReturnPct * 100).toFixed(2)}%`,
    `- Évesített hozam: ${(metrics.annualizedReturnPct * 100).toFixed(2)}%`,
    `- Sharpe ratio: ${metrics.sharpeRatio.toFixed(3)} (minimum: 1.0)`,
    `- Sortino ratio: ${formatNumber(metrics.sortinoRatio)}`,
    `- Max drawdown: ${(metrics.maxDrawdownPct * 100).toFixed(2)}% (maximum: 30%)`,
    `- Profit factor: ${formatNumber(metrics.profitFactor)}`,
    `- Win rate: ${(metrics.winRatePct * 100).toFixed(2)}% (minimum: 30%)`,
    `- Trade-ek száma: ${String(metrics.totalTrades)}`,
    `- Avg win: $${metrics.avgWin.toFixed(2)} (${(metrics.avgWinPct * 100).toFixed(2)}%)`,
    `- Avg loss: $${metrics.avgLoss.toFixed(2)} (${(metrics.avgLossPct * 100).toFixed(2)}%)`,
    `- Best trade: $${metrics.bestTrade.toFixed(2)}`,
    `- Worst trade: $${metrics.worstTrade.toFixed(2)}`,
    `- Max consecutive wins: ${String(metrics.maxConsecutiveWins)}`,
    `- Max consecutive losses: ${String(metrics.maxConsecutiveLosses)}`,
    `- Exposure time: ${(metrics.exposureTime * 100).toFixed(2)}%`,
    `- Kill-switch triggered: ${result.killSwitchTriggered ? "igen" : "nem"}`,
  ];
  const evaluationLines = [
    `  ${check(metrics.sharpeRatio >= 1, "Sharpe ratio >= 1.0")}`,
    `  ${check(metrics.maxDrawdownPct <= 0.3, "Max drawdown <= 30%")}`,
    `  ${check(metrics.winRatePct >= 0.3, "Win rate >= 30%")}`,
    `  ${check(metrics.profitFactor >= 1.3, "Profit factor >= 1.3")}`,
  ];
  const tradeLines = result.trades.map((trade) => formatTradeLine(trade));
  const summary = [
    ...headerLines,
    "",
    "## Értékelés",
    ...evaluationLines,
    "",
    "## Trade-lista",
    ...tradeLines,
  ].join("\n");
  return {
    summary,
    result,
    metrics,
  };
}

/**
 `formatJsonReport` — a riport JSON formátumban.
*/
export function formatJsonReport(report: BacktestReport): string {
  return JSON.stringify(report, undefined, 2);
}

/**
 `formatTradeListCsv` — a trade-lista CSV formátumban.
*/
export function formatTradeListCsv(result: BacktestResult): string {
  const header =
    "entryTime,exitTime,side,symbol,entryPrice,exitPrice,quantity,notionalUsd,pnlUsd,pnlPct,feesUsd,exitReason";
  const rows = result.trades.map((trade) => formatCsvTrade(trade));
  return [header, ...rows].join("\n");
}

function check(isSatisfied: boolean, label: string): string {
  return isSatisfied ? `✓ ${label}` : `✗ ${label} (NEM TELJESÜL)`;
}

function formatNumber(n: number): string {
  if (n === Infinity) {
    return "∞";
  }
  return n.toFixed(3);
}

function formatTradeLine(trade: BacktestResult["trades"][number]): string {
  return (
    `  ${new Date(trade.entryTime).toISOString()} ${trade.side} @ $${trade.entryPrice.toFixed(2)} → ` +
    `$${trade.exitPrice.toFixed(2)} (${trade.exitReason}): PnL=$${trade.pnlUsd.toFixed(2)} ` +
    `(${(trade.pnlPct * 100).toFixed(2)}%), fees=$${trade.feesUsd.toFixed(2)}`
  );
}

function formatCsvTrade(trade: BacktestResult["trades"][number]): string {
  return [
    new Date(trade.entryTime).toISOString(),
    new Date(trade.exitTime).toISOString(),
    trade.side,
    trade.symbol,
    String(trade.entryPrice),
    String(trade.exitPrice),
    String(trade.quantity),
    String(trade.notionalUsd),
    String(trade.pnlUsd),
    String(trade.pnlPct),
    String(trade.feesUsd),
    trade.exitReason,
  ].join(",");
}
