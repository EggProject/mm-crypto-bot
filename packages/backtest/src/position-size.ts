// packages/backtest/src/position-size.ts — Kelly-alapú position sizing
//
// A kiválasztott stratégia (§5) szerinti position-sizing:
//   1. risk_per_trade = 1% equity (alap)
//   2. Kelly frakció = 1/4 (alap)
//   3. position_notional = (equity * risk_per_trade) / stop_distance_pct
//   4. position_notional clamp [min_position_pct_equity, max_position_pct_equity]
//
// A Kelly-frakció alkalmazása: a position_notional a Kelly-limit
// és a fix fractional risk közül a kisebb (konzervatív megközelítés).
// A historikus trade-statisztikák a backtest után kalkulálódnak
// (w = win rate, r = avg win / avg loss), és egy `kellyFraction`
// szorzóval skálázódnak.

import type { PositionSizeConfig } from "./types.js";

/**
 `stopDistancePct` — a stop-loss távolság százalékban. A backtest az
 entry ár és a stop-loss ár alapján számolja ki.
*/
export function stopDistancePct(entryPrice: number, stopPrice: number): number {
  if (entryPrice <= 0) {
    throw new Error(`Entry price must be positive: ${entryPrice}`);
  }
  if (stopPrice <= 0) {
    throw new Error(`Stop price must be positive: ${stopPrice}`);
  }
  return Math.abs(entryPrice - stopPrice) / entryPrice;
}

/**
 `positionNotionalUsd` — a position notional értéke USD-ben.
 A formula: notional = (equity * riskPerTrade) / stopDistancePct
 A Kelly-limit és a min/max clamp együtt alkalmazódik.

   notional = clamp(
     min(equity * riskPerTrade / stopDistancePct, equity * kellyMaxPct),
     equity * minPositionPctEquity,
     equity * maxPositionPctEquity
   )

 A Kelly-limit a `kellyFraction` * a Kelly%-ból jön, de mivel a
 backtest indulásakor még nincs historikus statisztika, ez a backtest
 a `risk_per_trade` fix értéket használja (a Kelly-frakció a backtest
 UTÁN számolódik, paper-trade fázisban).
*/
export function positionNotionalUsd(
  equityUsd: number,
  entryPrice: number,
  stopPrice: number,
  config: PositionSizeConfig,
): number {
  if (equityUsd <= 0) {
    throw new Error(`Equity must be positive: ${equityUsd}`);
  }
  const stopPct = stopDistancePct(entryPrice, stopPrice);
  // Ha a stop az entry-vel megegyezik (vagy nagyon közel van), a position
  // size végtelen lenne — egy minimum stop-távolságot alkalmazunk (0.1%)
  // a numerikus stabilitás érdekében.
  const effectiveStopPct = stopPct <= 0 ? 0.001 : stopPct;
  // A klasszikus formula: notional = (equity * riskPerTrade) / stopPct
  let notional = (equityUsd * config.riskPerTrade) / effectiveStopPct;
  // Max position clamp: ne legyen a position notional az equity
  // maxPositionPct%-ánál nagyobb.
  const maxNotional = equityUsd * config.maxPositionPctEquity;
  if (notional > maxNotional) {
    notional = maxNotional;
  }
  // Min position clamp: a fee-költségek fedezésére.
  const minNotional = equityUsd * config.minPositionPctEquity;
  if (notional < minNotional) {
    notional = minNotional;
  }
  return notional;
}

/**
 `kellyFraction` — a Kelly % kiszámítása a historikus trade-statisztikákból.
 Kelly% = W − (1 − W) / R, ahol W = win rate, R = avg win / avg loss.
 Ez a backtest UTÁN alkalmazandó (paper-trade fázisban), nem a
 position-sizing-ban.
*/
export function kellyFraction(winRate: number, avgWinLossRatio: number): number {
  if (winRate < 0 || winRate > 1) {
    throw new Error(`Win rate must be in [0, 1]: ${winRate}`);
  }
  if (avgWinLossRatio <= 0) {
    throw new Error(`Avg win/loss ratio must be positive: ${avgWinLossRatio}`);
  }
  // Kelly% = W - (1-W)/R
  const kellyPct = winRate - (1 - winRate) / avgWinLossRatio;
  // Negatív Kelly% esetén 0-t adunk vissza (ne shortoljuk a Kelly-t).
  if (kellyPct < 0) {
    return 0;
  }
  return kellyPct;
}

/**
 `kellyPositionFraction` — a Kelly-alapú position fraction.
 A `kellyFraction` * `kellySizeMultiplier` szorzóval skálázódik
 (1/4-Kelly = 0.25 szorzó).
*/
export function kellyPositionFraction(
  winRate: number,
  avgWinLossRatio: number,
  kellySizeMultiplier: number,
): number {
  if (kellySizeMultiplier < 0 || kellySizeMultiplier > 1) {
    throw new Error(`Kelly multiplier must be in [0, 1]: ${kellySizeMultiplier}`);
  }
  return kellyFraction(winRate, avgWinLossRatio) * kellySizeMultiplier;
}
