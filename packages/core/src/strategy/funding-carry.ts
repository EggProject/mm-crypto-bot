// packages/core/src/strategy/funding-carry.ts — Delta-neutral funding-rate carry
//
// Phase 6 Track A — A funding-rate carry "strategy" that simulates a
// delta-neutral position (long-spot + short-perpetual) and collects the
// 8h funding payments from the perpetual leg.
//
// The Strategy interface is designed for directional trading: on each
// candle the strategy returns a buy/sell signal that the engine converts
// into a position with stop-loss / take-profit / time-exit. A delta-neutral
// carry position is fundamentally different — there is no directional view,
// no stop-loss, no take-profit, no time-exit. The carry position is opened
// once and held for the duration of the backtest, collecting funding every
// 8 hours.
//
// To stay compatible with the existing `Strategy` interface and the engine
// loop, this implementation:
//
//   1. Emits ONE "buy" signal on the first candle after `warmup()`, with
//      stop-loss / take-profit set far away so the engine never closes the
//      position on a stop or TP. The `end_of_data` exit at the end of the
//      backtest is the only legitimate exit path.
//
//   2. Exposes a SEPARATE pure-functional funding-accrual API that the
//      `run-funding-carry-baseline.ts` CLI runner uses for the actual
//      delta-neutral carry simulation:
//        - `accrueFunding(notional, fundingRate)` — adds funding payment
//        - `applyWithdrawalLatency(notional, minutes)` — debit cost
//        - `rebalanceIfNeeded(delta, threshold)` — rebalance trigger
//
// The reason for this two-layer design: the backtest engine does not
// natively model delta-neutral positions or per-snapshot funding. The
// CLI runner drives the carry simulation externally while the Strategy
// instance exposes a clean, testable accrual API.
//
// References (Phase 6 research, see docs/research/phase6-funding-carry.md):
//   - Bybit Institutional (2025) — delta-neutral carry +31.23%/year avg
//   - Binance Funding Rate FAQ — 8h funding interval, ±0.05% damper
//   - bagtester / ainvest / ScienceDirect — empirical carry edge estimates
//   - MiCAR (EU) 2023/1114 — bybit.eu SPOT-only for retail, no perps
//   - Cross-exchange withdrawal latency: 5-30 min baseline (Binance/Bybit)
//
// Strategy params:
//   - `targetNotionalUsd` — position size in USD (long spot + short perp)
//   - `rebalanceThresholdPct` — delta drift that triggers a rebalance
//   - `withdrawalLatencyMinutes` — assumed transfer latency (cost debit)
//   - `fundingRateDataProvider` — pluggable historical funding rate source

import type { Strategy, StrategyContext, StrategySignal } from "../types.js";

/**
 * A single historical funding-rate snapshot from a perpetual venue.
 * `fundingTime` is the Unix epoch in milliseconds; `fundingRate` is
 * decimal (0.0001 = 1 bps = 0.01% per 8h snapshot). Mark price is
 * optional metadata.
 */
export interface FundingSnapshot {
  readonly fundingTime: number;
  readonly symbol: string;
  readonly fundingRate: number;
  readonly markPrice?: number;
}

/**
 * Pluggable data source for historical funding rates. The default
 * implementation reads from a CSV at `data/funding/binance_<sym>_funding_8h.csv`
 * (see `download-funding-rates.ts`).
 */
export interface FundingRateProvider {
  /** Returns the funding snapshot closest to (or exactly at) `timestampMs`. */
  getFundingAt(timestampMs: number): FundingSnapshot | null;
  /** All snapshots in the given time range. */
  getFundingRange(startMs: number, endMs: number): readonly FundingSnapshot[];
}

export interface FundingCarryConfig {
  /** Target notional for both legs (spot long + perp short), in USD. */
  readonly targetNotionalUsd: number;
  /** Delta drift (as fraction of notional) that triggers a rebalance. */
  readonly rebalanceThresholdPct: number;
  /** Assumed cross-exchange withdrawal latency in minutes (cost debit). */
  readonly withdrawalLatencyMinutes: number;
  /** Cost in bps per rebalance operation (transfer + slippage + fees). */
  readonly rebalanceCostBps: number;
}

export const DEFAULT_FUNDING_CARRY_CONFIG: FundingCarryConfig = {
  targetNotionalUsd: 10_000,
  rebalanceThresholdPct: 0.05,
  withdrawalLatencyMinutes: 15,
  rebalanceCostBps: 20,
};

/**
 * Mutable state held by the strategy during a backtest run. The CLI
 * runner reads these fields after `runBacktest` to assemble the
 * carry-specific metrics.
 */
export interface FundingCarryState {
  /** Total funding payments collected (positive = earned, negative = paid). */
  fundingCollectedUsd: number;
  /** Number of rebalance operations executed (transfers between venues). */
  rebalanceCount: number;
  /** Total cost of rebalance operations (slippage + transfer + latency). */
  rebalanceCostUsd: number;
  /** Latest mark price observed (used to compute unrealized delta). */
  lastMarkPrice: number;
  /** Unrealized delta of the spot leg vs. the perp leg (in USD). */
  unrealizedDeltaUsd: number;
  /** Has the entry signal already been emitted? */
  hasEntered: boolean;
}

/**
 * `FundingCarryStrategy` — Strategy interface implementation that models
 * a delta-neutral funding-rate carry position. See file header for the
 * two-layer design rationale.
 */
export class FundingCarryStrategy implements Strategy {
  readonly name = "Delta-Neutral Funding Carry (Phase 6 Track A)";
  readonly timeframes = ["1h", "4h", "1d"] as const;
  readonly config: FundingCarryConfig;
  readonly state: FundingCarryState;

  constructor(config: Partial<FundingCarryConfig> = {}) {
    this.config = { ...DEFAULT_FUNDING_CARRY_CONFIG, ...config };
    this.state = {
      fundingCollectedUsd: 0,
      rebalanceCount: 0,
      rebalanceCostUsd: 0,
      lastMarkPrice: 0,
      unrealizedDeltaUsd: 0,
      hasEntered: false,
    };
  }

  warmup(): number {
    // Just a few candles — the strategy itself doesn't need indicator
    // warmup. The CLI runner drives the carry simulation externally.
    return 10;
  }

  /**
   * `onCandle` — emit ONE "buy" signal on the first valid candle so the
   * engine has a position to track through the backtest. The stop-loss
   * and take-profit are set far away (effectively unreachable) so the
   * position is closed only via the engine's `end_of_data` exit. The
   * CLI runner reads `this.state` after the backtest to assemble the
   * delta-neutral carry metrics.
   */
  onCandle(ctx: StrategyContext): StrategySignal | null {
    if (ctx.candleIndex < this.warmup()) {
      return null;
    }
    if (this.state.hasEntered) {
      // Already in the carry — hold the position through the backtest.
      this.state.lastMarkPrice = ctx.candle.close;
      return null;
    }
    this.state.hasEntered = true;
    this.state.lastMarkPrice = ctx.candle.close;
    // Stop-loss 99% below entry — never triggered.
    // Take-profit 99× entry — never triggered.
    return {
      side: "buy",
      confidence: 1,
      reason: `Funding-carry entry: long-spot + short-perp delta-neutral @ ${ctx.candle.close.toFixed(2)}, notional $${this.config.targetNotionalUsd.toFixed(0)}`,
      stopLoss: ctx.candle.close * 0.01,
      takeProfit: ctx.candle.close * 100,
    };
  }

  // ---------------------------------------------------------------------------
  // Pure-functional carry simulation API (used by the CLI runner).
  // ---------------------------------------------------------------------------

  /**
   * `accrueFunding` — apply one 8h funding payment to the strategy state.
   * For a SHORT perp position: positive funding rate → earn; negative → pay.
   * The sign convention matches Binance: fundingRate > 0 means longs pay
   * shorts, so a short perp EARNs `notional × fundingRate`.
   *
   * Returns the USD amount accrued (positive = earned, negative = paid).
   */
  accrueFunding(notionalUsd: number, fundingRate: number): number {
    if (!Number.isFinite(notionalUsd) || notionalUsd <= 0) {
      throw new Error(`notionalUsd must be positive, got ${notionalUsd}`);
    }
    if (!Number.isFinite(fundingRate)) {
      throw new Error(`fundingRate must be finite, got ${fundingRate}`);
    }
    // Short perp earns when funding > 0, pays when funding < 0.
    const paymentUsd = notionalUsd * fundingRate;
    this.state.fundingCollectedUsd += paymentUsd;
    return paymentUsd;
  }

  /**
   * `applyWithdrawalLatency` — debit the cost of cross-exchange withdrawal
   * latency during a rebalance. The cost is modeled as the opportunity
   * cost of capital tied up during the transfer window, prorated by
   * the borrow rate. A conservative `costUsd` is added to rebalanceCost.
   *
   * The latency window is `withdrawalLatencyMinutes / 60` hours. We use
   * the config borrowRatePerHour × latency × notional as the cost basis.
   *
   * `borrowRatePerHour` defaults to the bybit.eu SPOT 0.01%/h assumption
   * (consistent with the Phase 5 cost model).
   */
  applyWithdrawalLatency(
    notionalUsd: number,
    borrowRatePerHour = 0.0001,
  ): number {
    const latencyHours = this.config.withdrawalLatencyMinutes / 60;
    const costUsd = notionalUsd * borrowRatePerHour * latencyHours;
    this.state.rebalanceCostUsd += costUsd;
    return costUsd;
  }

  /**
   * `rebalanceIfNeeded` — trigger a rebalance when the spot-vs-perp
   * delta exceeds the configured threshold. The rebalance costs:
   *   1. `rebalanceCostBps` flat fee (transfer + slippage)
   *   2. `withdrawalLatency` opportunity cost (via applyWithdrawalLatency)
   *
   * Returns `true` if a rebalance was triggered, `false` otherwise.
   */
  rebalanceIfNeeded(unrealizedDeltaUsd: number): boolean {
    this.state.unrealizedDeltaUsd = unrealizedDeltaUsd;
    const driftFraction = Math.abs(unrealizedDeltaUsd) / this.config.targetNotionalUsd;
    if (driftFraction < this.config.rebalanceThresholdPct) {
      return false;
    }
    // Rebalance triggered — debit both cost components.
    const flatFee = (this.config.rebalanceCostBps / 10_000) * this.config.targetNotionalUsd;
    this.state.rebalanceCostUsd += flatFee;
    this.applyWithdrawalLatency(this.config.targetNotionalUsd);
    this.state.rebalanceCount += 1;
    this.state.unrealizedDeltaUsd = 0;
    return true;
  }

  /**
   * `totalFundingUsd` — net funding collected so far (after costs).
   */
  totalFundingUsd(): number {
    return this.state.fundingCollectedUsd - this.state.rebalanceCostUsd;
  }

  /**
   * `reset` — clear state for a fresh backtest run. The CLI runner
   * invokes this between symbol runs.
   */
  reset(): void {
    this.state.fundingCollectedUsd = 0;
    this.state.rebalanceCount = 0;
    this.state.rebalanceCostUsd = 0;
    this.state.lastMarkPrice = 0;
    this.state.unrealizedDeltaUsd = 0;
    this.state.hasEntered = false;
  }
}

// ---------------------------------------------------------------------------
// Helper: simple in-memory funding rate provider for tests + CLI runner.
// ---------------------------------------------------------------------------

/**
 * `InMemoryFundingRateProvider` — minimal FundingRateProvider backed by
 * a sorted array of `FundingSnapshot`. Used in unit tests and as the
 * default provider in the CLI runner (which loads the CSV into memory).
 */
export class InMemoryFundingRateProvider implements FundingRateProvider {
  private readonly snapshots: readonly FundingSnapshot[];

  constructor(snapshots: readonly FundingSnapshot[]) {
    // Sort ascending by fundingTime so the binary search works.
    const sorted = [...snapshots].sort((a, b) => a.fundingTime - b.fundingTime);
    this.snapshots = sorted;
  }

  getFundingAt(timestampMs: number): FundingSnapshot | null {
    if (this.snapshots.length === 0) return null;
    // Binary search for the snapshot whose fundingTime <= timestampMs.
    let lo = 0;
    let hi = this.snapshots.length - 1;
    let candidate: FundingSnapshot | null = null;
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      const s = this.snapshots[mid]!;
      if (s.fundingTime <= timestampMs) {
        candidate = s;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return candidate;
  }

  getFundingRange(startMs: number, endMs: number): readonly FundingSnapshot[] {
    return this.snapshots.filter((s) => s.fundingTime >= startMs && s.fundingTime <= endMs);
  }

  size(): number {
    return this.snapshots.length;
  }
}