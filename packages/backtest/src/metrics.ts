// packages/backtest/src/metrics.ts — backtest metrikak (Sharpe, Sortino, DD, stb.)
//
// A `docs/research/selected-strategy.md` §8.2 minimum-mutatok:
//   - Sharpe >= 1.0
//   - Max DD <= 30%
//   - Win rate >= 30%
//   - Profit factor >= 1.3
//   - OOS/IS Sharpe >= 0.6
//   - Recovery factor >= 1.5
//
// A metrikak a trade-listabol es az equity-gorbe alapjan szamitodnak.

import { mean, stddev, sum } from "@mm-crypto-bot/shared/utils";

import type { Trade } from "@mm-crypto-bot/shared/types";

import type { BacktestMetrics, EquityPoint } from "./types.js";

/**
 `tradeReturns` — a trade-ek PnL%-os hozamait adja vissza.
*/
export function tradeReturns(trades: readonly Trade[]): readonly number[] {
  return trades.map((t) => t.pnlPct);
}

/**
 `equityReturns` — az equity-gorbe periodus-hozamait adja.
*/
export function equityReturns(equityCurve: readonly EquityPoint[]): readonly number[] {
  if (equityCurve.length < 2) {
    return [];
  }
  const out: number[] = [];
  for (let i = 1; i < equityCurve.length; i++) {
    const prev = equityCurve[i - 1]!.equity;
    const cur = equityCurve[i]!.equity;
    if (prev > 0) {
      out.push((cur - prev) / prev);
    }
  }
  return out;
}

/**
 `sharpeRatio` — az evesitett Sharpe-ratio.
*/
export function sharpeRatio(returns: readonly number[], periodsPerYear: number): number {
  if (returns.length < 2) {
    return 0;
  }
  const m = mean(returns);
  const s = stddev(returns);
  if (s === 0) {
    return 0;
  }
  return (m / s) * Math.sqrt(periodsPerYear);
}

/**
 `sortinoRatio` — az evesitett Sortino-ratio. Csak a negativ hozamok
 szorasat veszi figyelembe.
*/
export function sortinoRatio(returns: readonly number[], periodsPerYear: number): number {
  if (returns.length < 2) {
    return 0;
  }
  const m = mean(returns);
  const negatives = returns.filter((r) => r < 0);
  if (negatives.length === 0) {
    return Number.POSITIVE_INFINITY;
  }
  let sumSq = 0;
  for (const r of negatives) {
    sumSq += r * r;
  }
  const downsideDev = Math.sqrt(sumSq / negatives.length);
  return (m / downsideDev) * Math.sqrt(periodsPerYear);
}

/**
 `maxDrawdown` — a maximalis drawdown (a legnagyobb equity-csokkenes
 a cspcshoz kepest). 0 es 1 kozotti ertek.
*/
export function maxDrawdown(equityCurve: readonly EquityPoint[]): number {
  if (equityCurve.length === 0) {
    return 0;
  }
  let peak = equityCurve[0]!.equity;
  let maxDd = 0;
  for (const point of equityCurve) {
    if (point.equity > peak) {
      peak = point.equity;
    }
    if (peak > 0) {
      const dd = (peak - point.equity) / peak;
      if (dd > maxDd) {
        maxDd = dd;
      }
    }
  }
  return maxDd;
}

/**
 `profitFactor` — a nyereseg/veszteseg arany.
*/
export function profitFactor(trades: readonly Trade[]): number {
  let wins = 0;
  let losses = 0;
  for (const t of trades) {
    if (t.pnlUsd > 0) {
      wins += t.pnlUsd;
    } else if (t.pnlUsd < 0) {
      losses += -t.pnlUsd;
    }
  }
  if (losses === 0) {
    if (wins === 0) {
      return 0;
    }
    return Number.POSITIVE_INFINITY;
  }
  return wins / losses;
}

/**
 `winRate` — a nyero trade-ek aranya (0 es 1 kozott).
*/
export function winRate(trades: readonly Trade[]): number {
  if (trades.length === 0) {
    return 0;
  }
  const wins = trades.filter((t) => t.pnlUsd > 0).length;
  return wins / trades.length;
}

/**
 `maxConsecutive` — a leghosszabb nyero/vesztes trade-sorozat.
*/
export function maxConsecutive(trades: readonly Trade[]): {
  readonly maxConsecutiveWins: number;
  readonly maxConsecutiveLosses: number;
} {
  let maxWins = 0;
  let maxLosses = 0;
  let curWins = 0;
  let curLosses = 0;
  for (const t of trades) {
    if (t.pnlUsd > 0) {
      curWins += 1;
      curLosses = 0;
      if (curWins > maxWins) {
        maxWins = curWins;
      }
    } else if (t.pnlUsd < 0) {
      curLosses += 1;
      curWins = 0;
      if (curLosses > maxLosses) {
        maxLosses = curLosses;
      }
    } else {
      curWins = 0;
      curLosses = 0;
    }
  }
  return { maxConsecutiveWins: maxWins, maxConsecutiveLosses: maxLosses };
}

/**
 `exposureTime` — a trade-ek holding idejenek osszege / a backtest
 teljes idotartama.
*/
export function exposureTime(
  trades: readonly Trade[],
  startTimeMs: number,
  endTimeMs: number,
): number {
  if (endTimeMs <= startTimeMs) {
    return 0;
  }
  if (trades.length === 0) {
    return 0;
  }
  let totalHoldMs = 0;
  for (const t of trades) {
    if (t.exitTime > t.entryTime) {
      totalHoldMs += t.exitTime - t.entryTime;
    }
  }
  return Math.min(1, totalHoldMs / (endTimeMs - startTimeMs));
}

/**
 `computeMetrics` — az osszes metrikat egyetlen hivasban szamitja ki.
*/
export function computeMetrics(
  trades: readonly Trade[],
  equityCurve: readonly EquityPoint[],
  startTimeMs: number,
  endTimeMs: number,
  periodsPerYear: number,
): BacktestMetrics {
  const eqReturns = equityReturns(equityCurve);
  const initialEquity = equityCurve.length > 0 ? equityCurve[0]!.equity : 0;
  const finalEquity = equityCurve.length > 0 ? equityCurve[equityCurve.length - 1]!.equity : initialEquity;
  const totalReturnPct = initialEquity > 0 ? (finalEquity - initialEquity) / initialEquity : 0;
  const years = (endTimeMs - startTimeMs) / (365 * 24 * 60 * 60 * 1000);
  const annualizedReturnPct = years > 0 ? Math.pow(1 + totalReturnPct, 1 / years) - 1 : 0;
  const wins = trades.filter((t) => t.pnlUsd > 0);
  const losses = trades.filter((t) => t.pnlUsd < 0);
  const avgWin = wins.length > 0 ? sum(wins.map((t) => t.pnlUsd)) / wins.length : 0;
  const avgLoss = losses.length > 0 ? sum(losses.map((t) => -t.pnlUsd)) / losses.length : 0;
  const avgWinPct = wins.length > 0 ? sum(wins.map((t) => t.pnlPct)) / wins.length : 0;
  const avgLossPct = losses.length > 0 ? sum(losses.map((t) => -t.pnlPct)) / losses.length : 0;
  const bestTrade = trades.length > 0 ? Math.max(...trades.map((t) => t.pnlUsd)) : 0;
  const worstTrade = trades.length > 0 ? Math.min(...trades.map((t) => t.pnlUsd)) : 0;
  const consec = maxConsecutive(trades);
  return {
    totalReturnPct,
    annualizedReturnPct,
    sharpeRatio: sharpeRatio(eqReturns, periodsPerYear),
    sortinoRatio: sortinoRatio(eqReturns, periodsPerYear),
    maxDrawdownPct: maxDrawdown(equityCurve),
    profitFactor: profitFactor(trades),
    winRatePct: winRate(trades),
    totalTrades: trades.length,
    avgWin,
    avgLoss,
    avgWinPct,
    avgLossPct,
    bestTrade,
    worstTrade,
    maxConsecutiveWins: consec.maxConsecutiveWins,
    maxConsecutiveLosses: consec.maxConsecutiveLosses,
    exposureTime: exposureTime(trades, startTimeMs, endTimeMs),
  };
}
