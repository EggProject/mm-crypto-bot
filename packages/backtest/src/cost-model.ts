// packages/backtest/src/cost-model.ts — a backtest költség-modell
//
// A `docs/research/selected-strategy.md` §9 alapján a backtest a
// következő költségeket modellezi:
//   - taker fee (oldalanként, a notional %-ában)
//   - slippage (oldalanként, a notional %-ában)
//   - spread (oldalanként, a notional %-ában)
//   - margin borrow (óránként, a margin notional %-ában)
//   - funding rate (8h periódus, perpetual-ra, opcionális)
//
// A teljes round-trip költség így:
//   cost = notional * (takerFeeRate * 2 + slippageRate * 2 + spreadRate * 2)
//   marginCost = margin * borrowRatePerHour * holdingHours
//   fundingCost = notional * fundingRatePer8h * (holdingHours / 8) (ha van)
//
// Specifikáció: docs/research/selected-strategy.md §9.

import type { CostModel } from "./types.js";

/**
 `applySlippage` — a piaci árhoz hozzáadja a slippage-et (long entry-nél
 felfelé, short entry-nél lefelé). A `slippageRate` a notional %-át
 jelenti, de itt az árat módosítjuk (a notional arányos az árral).
*/
export function applySlippage(price: number, side: "buy" | "sell", rate: number): number {
  if (rate < 0) {
    throw new Error(`Slippage rate cannot be negative: ${rate}`);
  }
  // Long: az entry ár magasabb (rosszabb); short: az entry ár alacsonyabb.
  return side === "buy" ? price * (1 + rate) : price * (1 - rate);
}

/**
 `applySpread` — a spread a bid/ask közti különbség. A backtest a
 spreadet a slippage-pel együtt alkalmazza: a tényleges fill ár a
 mid-ártól a spread felével tér el.
*/
export function applySpread(price: number, side: "buy" | "sell", rate: number): number {
  if (rate < 0) {
    throw new Error(`Spread rate cannot be negative: ${rate}`);
  }
  // Ugyanaz, mint a slippage: a spread fele kerül alkalmazásra.
  return side === "buy" ? price * (1 + rate / 2) : price * (1 - rate / 2);
}

/**
 `entryCost` — a teljes entry-költség számítása (fee + slippage + spread).
 A fee a notional %-ában van, a slippage és spread az árfolyamon
 alkalmazódik.
*/
export function entryCost(notionalUsd: number, model: CostModel): number {
  // A fee a notional utan szamitodik (a mar finalis notional utan).
  return notionalUsd * model.takerFeeRate;
}

/**
 `exitCost` — a kilépési költség (ugyanaz, mint az entry, mivel a
 backtest taker fee-t alkalmaz mindkét oldalon — a kiválasztott
 stratégia stop-market és limit order-eket használ, amik taker-ként
 teljesülnek a legtöbb esetben).
*/
export function exitCost(notionalUsd: number, model: CostModel): number {
  return notionalUsd * model.takerFeeRate;
}

/**
 `marginBorrowCost` — a margin-kamat költsége egy adott holding időre.
 A `marginNotional` a bróker által zárolt összeg (position / leverage).
 A `borrowRatePerHour` a teljes margin %-a óránként.
*/
export function marginBorrowCost(
  marginNotional: number,
  holdingHours: number,
  model: CostModel,
): number {
  if (holdingHours < 0) {
    throw new Error(`Holding hours cannot be negative: ${holdingHours}`);
  }
  return marginNotional * model.borrowRatePerHour * holdingHours;
}

/**
 `fundingCost` — a perpetual funding rate költsége. A funding 8 óránként
 kerül felszámításra. Ha nincs funding rate (spot-only backtest), a
 függvény 0-t ad vissza.
*/
export function fundingCost(
  notionalUsd: number,
  holdingHours: number,
  model: CostModel,
): number {
  if (!model.fundingRatePer8h) {
    return 0;
  }
  if (holdingHours < 0) {
    throw new Error(`Holding hours cannot be negative: ${holdingHours}`);
  }
  // A funding 8h-onként szamitodik fel.
  return notionalUsd * model.fundingRatePer8h * (holdingHours / 8);
}

/**
 `totalTradeCost` — egy round-trip trade teljes költsége.
 Tartalmazza az entry fee-t, exit fee-t, margin-kamatot és funding-ot.
 A slippage és spread a fill-árban maradt (az applySlippage/applySpread
 híváskor alkalmaztuk).
*/
export function totalTradeCost(
  notionalUsd: number,
  marginNotional: number,
  holdingHours: number,
  model: CostModel,
): { readonly feesUsd: number; readonly borrowUsd: number; readonly fundingUsd: number } {
  // A fee-k ketszer szamitodnak (entry + exit).
  const feesUsd = entryCost(notionalUsd, model) + exitCost(notionalUsd, model);
  const borrowUsd = marginBorrowCost(marginNotional, holdingHours, model);
  const fundingUsd = fundingCost(notionalUsd, holdingHours, model);
  return { feesUsd, borrowUsd, fundingUsd };
}
