// packages/backtest/src/oos.ts — out-of-sample walk-forward validáció
//
// A `docs/research/selected-strategy.md` §8.1 walk-forward séma:
//   - In-sample ablak: 12 hónap
//   - Out-of-sample ablak: 3 hónap
//   - Görgetés: 1 hónapos léptetés
//   - Min 12 OOS ablak (a robosztussághoz)
//
// A backtest motor in-sample és out-of-sample módon is futtatható.
// Az OOS validáció célja: ha az in-sample Sharpe-hoz képest az OOS
// Sharpe legalább 60%-os, a stratégia élesíthető.

import { runBacktest } from "./engine.js";
import type { BacktestOptions, BacktestResult, WalkForwardConfig } from "./types.js";

/**
 `runWalkForward` — a walk-forward OOS validáció futtatása.
 A backtest motor minden OOS ablakra újrafuttatja a stratégiát, és
 összesíti az eredményeket (aggregált Sharpe, OOS/IS Sharpe arány).
*/
export async function runWalkForward(
  baseOptions: BacktestOptions,
  wf: WalkForwardConfig,
): Promise<WalkForwardResult> {
  if (wf.inSampleDays <= 0 || wf.outOfSampleDays <= 0 || wf.stepDays <= 0) {
    throw new Error("WalkForward config must have positive day values");
  }
  const inMs = wf.inSampleDays * 24 * 60 * 60 * 1000;
  const outMs = wf.outOfSampleDays * 24 * 60 * 60 * 1000;
  const stepMs = wf.stepDays * 24 * 60 * 60 * 1000;
  const start = baseOptions.startTime.getTime();
  const end = baseOptions.endTime.getTime();
  const isResults: BacktestResult[] = [];
  const oosResults: BacktestResult[] = [];
  let windowStart = start;
  while (windowStart + inMs + outMs <= end) {
    const isStart = new Date(windowStart);
    const isEnd = new Date(windowStart + inMs);
    const oosStart = isEnd;
    const oosEnd = new Date(windowStart + inMs + outMs);
    // In-sample futtatás.
    const isResult = await runBacktest({
      ...baseOptions,
      startTime: isStart,
      endTime: isEnd,
    });
    isResults.push(isResult);
    // Out-of-sample futtatás.
    const oosResult = await runBacktest({
      ...baseOptions,
      startTime: oosStart,
      endTime: oosEnd,
    });
    oosResults.push(oosResult);
    windowStart += stepMs;
  }
  if (isResults.length === 0) {
    throw new Error("No walk-forward windows in the requested period");
  }
  // Aggregált Sharpe: az OOS Sharpe-ok átlaga.
  const avgOosSharpe = average(oosResults.map((r) => r.sharpeRatio));
  const avgIsSharpe = average(isResults.map((r) => r.sharpeRatio));
  const oosIsSharpeRatio = computeOosIsRatio(avgOosSharpe, avgIsSharpe);
  return {
    isResults,
    oosResults,
    avgIsSharpe,
    avgOosSharpe,
    oosIsSharpeRatio,
    windowCount: isResults.length,
  };
}

/**
 `computeOosIsRatio` — az OOS/IS Sharpe arány kiszámítása.
 Ha az IS Sharpe <= 0 (nincs trade, vagy negatív átlag), 0-t ad vissza
 a NaN elkerülésére.
*/
export function computeOosIsRatio(avgOosSharpe: number, avgIsSharpe: number): number {
  if (avgIsSharpe <= 0) {
    return 0;
  }
  return avgOosSharpe / avgIsSharpe;
}

export interface WalkForwardResult {
  readonly isResults: readonly BacktestResult[];
  readonly oosResults: readonly BacktestResult[];
  readonly avgIsSharpe: number;
  readonly avgOosSharpe: number;
  readonly oosIsSharpeRatio: number;
  readonly windowCount: number;
}

function average(values: readonly number[]): number {
  // A `runWalkForward` garantálja, hogy a values tömb nem üres
  // (a no-window esetén kivételt dob), így a length-0 guard nem kell.
  let sum = 0;
  for (const v of values) {
    sum += v;
  }
  return sum / values.length;
}
