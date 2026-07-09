// packages/core/src/strategy/funding-snapshot.ts
//
// Phase 32 — Extracted from `funding-carry.ts` (deleted) so the
// `dydx-cex-carry` strategy and its paper-trade runner can still
// import the canonical `FundingSnapshot` type. The full funding-carry
// strategy is preserved in git history at commit `bb656a1`.
//
// See `docs/research/deprecated-strategies/REPORT.md` §2.5 for the
// deletion record.

/**
 * `FundingSnapshot` — a single funding-rate observation from a venue.
 *
 * The `fundingTime` is the timestamp when the funding payment settled
 * (8h cadence on Binance, 1h cadence on dYdX v4). The `fundingRate`
 * is the per-period rate as a decimal (e.g. 0.0001 = 0.01% = 1 bps).
 *
 * `markPrice` is optional — not all venues emit it. The carry PnL
 * uses `fundingRate × notional`; `markPrice` is informational for
 * mark-to-market accounting.
 */
export interface FundingSnapshot {
  readonly fundingTime: number;
  readonly symbol: string;
  readonly fundingRate: number;
  readonly markPrice?: number;
}
