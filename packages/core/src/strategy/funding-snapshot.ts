// packages/core/src/strategy/funding-snapshot.ts
//
// Canonical funding-rate observation shared by carry strategy components.

import type { ExactRational } from "@mm-crypto-bot/numeric";

/**
 * `FundingSnapshot` — a single funding-rate observation from a venue.
 *
 * The `fundingTime` is the timestamp when the funding payment settled
 * (8h cadence on Binance, 1h cadence on dYdX v4). The `fundingRate`
 * is the per-period rate represented without binary-float loss.
 *
 * `markPrice` is optional — not all venues emit it. The carry PnL
 * uses `fundingRate × notional`; `markPrice` is informational for
 * mark-to-market accounting.
 */
export interface FundingSnapshot {
  readonly fundingTime: number;
  readonly symbol: string;
  readonly fundingRate: ExactRational;
  readonly markPrice?: ExactRational;
}
