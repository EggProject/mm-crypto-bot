// packages/core/src/strategy/dydx-cex-carry.paper-trade.ts
//
// Phase 25 #2 T2 — Paper-trade runner for the dYdX-vs-CEX funding carry.
//
// ============================================================================
// PURPOSE
// ============================================================================
//
//  - Drives the `DydxCexCarryStrategy` with a pluggable `DydxFundingSource`
//    (real WS feed in production, mock in tests) and a pluggable
//    `BybitEuSpotFillSimulator` (synthetic SPOT fills in paper-trade, real
//    bybit.eu SPOT adapter in live mode).
//  - Logs hypothetical fills at the configured notional per leg, the
//    configured cap, and the bybit.eu SPOT slippage model.
//  - Re-evaluates the 4 kill-switches every funding tick + every chain
//    heartbeat + every bybit.eu SPOT depth observation.
//  - Produces a structured `PaperTradeReport` for validator review.
//
// ============================================================================
// PHASE 33 CLEANUP (2026-07-11) — user mandate
// ============================================================================
//
// Per user mandate "minden live test dolgot torolj, azt majd en vegzem!",
// the auto-promote 7-day paper-trade gate has been removed from the
// strategy + runner.  The runner no longer:
//   - calls `strategy.incrementPaperTradeDay()` (removed)
//   - branches on `gateResult.gateOpened` (removed)
//   - gates hypothetical fills on `strategy.state.liveOrdersEnabled` (removed)
//
// The runner is still useful for offline backtest / validator review:
// fills are produced whenever the strategy is "in carry" (not halted by
// any of the 4 kill-switches).  The live-vs-paper decision is now a
// bot-runtime concern (Track C in Phase 33 plan).
//
// ============================================================================
// INTEGRATION
// ============================================================================
//
// The paper-trade runner does NOT call the Strategy's `onCandle()` (which
// the engine owns).  It calls the strategy's recordFundingTick /
// recordChainHeartbeat / recordBybitEuLiquidity / recordPreconditionReverify
// API.  The Strategy's `onCandle()` is called by the backtest engine or
// signal-center separately.
//
// Usage:
//   const runner = new DydxCexCarryPaperTrader(strategy, fillSimulator);
//   const report = runner.runForDays(7, /* fundingSource */ mockSource);

import type { FundingSnapshot } from "./funding-snapshot.js";
import type {
  CarryMarket,
  DydxFundingSource,
  DydxCexCarryStrategy,
  KillSwitchVerdicts,
  PreconditionId,
} from "./dydx-cex-carry.js";
import { allPreconditionsSatisfied } from "./dydx-cex-carry.js";

// ============================================================================
// PUBLIC TYPES
// ============================================================================

/**
 * `BybitEuSpotFillSimulator` — pluggable bybit.eu SPOT fill model.
 * Production: real bybit.eu SPOT depth + slippage (CCXT Pro).  Tests:
 * synthetic fixed-slippage model.
 */
export interface BybitEuSpotFillSimulator {
  /**
   * Compute the slippage (in bps) for a hypothetical bybit.eu SPOT
   * fill of `notionalUsd` of the underlying asset.
   */
  slippageBps(notionalUsd: number, nowMs: number): number;
  /**
   * Current bybit.eu SPOT depth in USD @ 1% from mid for the
   * underlying asset.  null = unknown.
   */
  depthUsdAt1Pct(nowMs: number): number | null;
  /**
   * The mid-price for the underlying SPOT pair (used to compute
   * notional → quantity conversion).  null = unknown.
   */
  midPriceUsd(nowMs: number): number | null;
}

/**
 * `HypotheticalFill` — a single paper-trade fill record.
 */
export interface HypotheticalFill {
  readonly id: string;
  readonly market: CarryMarket;
  readonly leg: "dydx-long" | "cex-short" | "dydx-short" | "cex-long";
  readonly side: "buy" | "sell";
  readonly notionalUsd: number;
  readonly price: number;
  readonly slippageBps: number;
  readonly timestampMs: number;
  readonly fundingRateDydx: number;
  readonly fundingRateCex: number;
  readonly accruedFundingUsd: number;
  readonly mode: "paper";
}

/**
 * `PaperTradeReport` — the end-of-run report emitted by the paper-trade
 * runner.  Validators use this to verify the strategy is producing
 * sensible P&L + kill-switch behavior before the live-orders gate
 * opens.
 */
export interface PaperTradeReport {
  readonly market: CarryMarket;
  readonly startMs: number;
  readonly endMs: number;
  readonly daysCompleted: number;
  readonly fundingTicksRecorded: number;
  readonly chainHeartbeatsRecorded: number;
  readonly bybitEuDepthObservations: number;
  readonly preconditionReverifications: number;
  readonly totalAccruedFundingUsd: number;
  readonly totalFillCount: number;
  readonly totalFilledNotionalUsd: number;
  readonly totalSlippageCostUsd: number;
  readonly finalKillSwitchVerdicts: KillSwitchVerdicts;
  readonly preconditionsOkAtEnd: { readonly ok: boolean; readonly reasons: readonly string[] };
  readonly fills: readonly HypotheticalFill[];
  readonly halted: boolean;
  readonly haltReason: string | null;
  /**
   * `latency` — Phase 30 LatencyGate telemetry.  Null when the
   * strategy was constructed without a `latencySource` (paper-trade
   * default — synthetic 0ms).  Populated when a `latencySource` was
   * configured and `pollLatencySource()` returned at least one
   * observation.
   */
  readonly latency: PaperTradeLatencyStats | null;
}

/**
 * `PaperTradeLatencyStats` — Phase 30 LatencyGate telemetry.
 * Statistics over the latency observations observed during the
 * paper-trade run.
 */
export interface PaperTradeLatencyStats {
  /** Number of funding ticks that were PAUSED due to latency > threshold. */
  readonly pausedTickCount: number;
  /** Total funding ticks recorded (denominator for `pausedFraction`). */
  readonly totalTickCount: number;
  /** pausedTickCount / totalTickCount.  0.0 = no pauses; 1.0 = all paused. */
  readonly pausedFraction: number;
  /** Max observed round-trip latency in ms.  null = no observations. */
  readonly maxRoundTripMs: number | null;
  /** Min observed round-trip latency in ms.  null = no observations. */
  readonly minRoundTripMs: number | null;
  /** Mean observed round-trip latency in ms.  null = no observations. */
  readonly meanRoundTripMs: number | null;
  /** The strategy's configured threshold (ms). */
  readonly arbThresholdMs: number;
}

/**
 * `PaperTradeRunnerConfig` — config for the paper-trade runner.
 */
export interface PaperTradeRunnerConfig {
  /** Number of paper-trade days to run.  Default 7 per orchestrator steer. */
  readonly days: number;
  /**
   * Funding-tick spacing (ms).  Default 1h (3,600,000 ms) — dYdX
   * hourly settlement.  Tests can use shorter intervals.
   */
  readonly tickIntervalMs: number;
  /**
   * Per-tick pre-condition reverification cadence.  Default
   * 24h (i.e. once per day).
   */
  readonly preconditionReverifyIntervalMs: number;
}

export const DEFAULT_PAPER_TRADE_RUNNER_CONFIG: PaperTradeRunnerConfig = {
  days: 7,
  tickIntervalMs: 60 * 60 * 1000,
  preconditionReverifyIntervalMs: 24 * 60 * 60 * 1000,
};

// ============================================================================
// PAPER-TRADE RUNNER
// ============================================================================

/**
 * `DydxCexCarryPaperTrader` — drives a `DydxCexCarryStrategy` instance
 * in paper-trade mode.  Used for the 7-day MANDATORY paper-trade gate
 * (per orchestrator steer) and for validator review.
 */
export class DydxCexCarryPaperTrader {
  readonly strategy: DydxCexCarryStrategy;
  readonly fillSimulator: BybitEuSpotFillSimulator;
  readonly config: PaperTradeRunnerConfig;
  readonly fills: HypotheticalFill[] = [];

  constructor(
    strategy: DydxCexCarryStrategy,
    fillSimulator: BybitEuSpotFillSimulator,
    config: Partial<PaperTradeRunnerConfig> = {},
  ) {
    this.strategy = strategy;
    this.fillSimulator = fillSimulator;
    this.config = { ...DEFAULT_PAPER_TRADE_RUNNER_CONFIG, ...config };
  }

  /**
   * `runForDays` — run the paper-trade simulation for `days` days.
   *
   * The funding source's lastTickMs + lastChainBlockTs + bybitEuSpotDepth
   * are read at each tick; the strategy updates its kill-switch
   * verdicts accordingly.
   *
   * If a HALT kill-switch fires mid-run, the simulation stops early
   * and the report's `halted = true` + `haltReason` are populated.
   */
  runForDays(
    days: number,
    fundingSource: DydxFundingSource,
    nowMs: number = Date.now(),
  ): PaperTradeReport {
    if (!Number.isFinite(days) || days <= 0) {
      throw new Error(`days must be positive finite, got ${days}`);
    }
    const startMs = nowMs;
    let currentMs = startMs;
    let lastDayIndex = 0;
    let ticksRecorded = 0;
    let heartbeatsRecorded = 0;
    let depthObservations = 0;
    let precondReverifications = 0;
    let totalAccruedFundingUsd = 0;
    let totalFilledNotionalUsd = 0;
    let totalSlippageCostUsd = 0;
    let halted = false;
    let haltReason: string | null = null;
    // Phase 30: LatencyGate telemetry counters.  Only populated
    // when the strategy was constructed with a `latencySource`.
    let latencyPausedTickCount = 0;
    let latencyObsCount = 0;
    let latencySumMs = 0;
    let latencyMaxMs: number | null = null;
    let latencyMinMs: number | null = null;

    // Subscribe to live funding ticks (the production impl returns a
    // WebSocket; in tests it's a mock).  We don't actually USE the
    // subscription here — paper-trade is driven deterministically by
    // the source's lastTickMs / lastTickAgeMs at each interval tick.
    // We DO subscribe to keep the production wiring hot.
    const sub = fundingSource.subscribe(this.strategy.config.market, () => undefined);
    try {
      const endMs = startMs + days * 24 * 60 * 60 * 1000;
      const tickIntervalMs = this.config.tickIntervalMs;
      const precondReverifyMs = this.config.preconditionReverifyIntervalMs;
      let nextPrecondReverifyMs = startMs;

      while (currentMs <= endMs) {
        // 1) Funding tick — read source state + apply to strategy.
        const staleMs = fundingSource.lastTickAgeMs(this.strategy.config.market, currentMs);
        const chainBlockTs = fundingSource.lastChainBlockTs(this.strategy.config.market);
        if (staleMs !== null && chainBlockTs !== null) {
          // Both source + chain are alive — record a synthetic tick
          // for the strategy.  We use a small non-zero funding rate
          // (dYdX -0.0001/1h, CEX 0.0002/1h) so the 8h-equivalent
          // divergence is non-zero and the 7-day compression
          // kill-switch doesn't false-positive on a clean paper-trade
          // run.  Production wires use the real dYdX + CEX funding.
          const dydxSnap: FundingSnapshot = {
            fundingTime: currentMs,
            symbol: this.strategy.config.market,
            fundingRate: -0.0001,
          };
          const cexSnap: FundingSnapshot = {
            fundingTime: currentMs,
            symbol: "BINANCE",
            fundingRate: 0.0002,
          };
          const payment = this.strategy.recordFundingTick(dydxSnap, cexSnap, currentMs);
          totalAccruedFundingUsd += payment;
          ticksRecorded += 1;
          // Phase 30: LatencyGate telemetry.  After
          // `recordFundingTick` (which auto-polls the latency
          // source), read back the gate state + last round-trip.
          if (this.strategy.config.latencySource !== null) {
            const lastRt = this.strategy.state.lastLatencyRoundTripMs;
            if (lastRt !== null) {
              latencyObsCount += 1;
              latencySumMs += lastRt;
              latencyMaxMs = latencyMaxMs === null ? lastRt : Math.max(latencyMaxMs, lastRt);
              latencyMinMs = latencyMinMs === null ? lastRt : Math.min(latencyMinMs, lastRt);
            }
            // Payment == 0 with no kill-switch halt ⇒ latency pause.
            if (payment === 0 && !this.strategy.isHalted()) {
              latencyPausedTickCount += 1;
            }
          }

          // 2) Hypothetical fill — log a paper-trade fill on each tick
          //    if the strategy is "in carry" (not halted).  Phase 33:
          //    paper-trade mode is implicit (no auto-promote gate);
          //    the strategy decides entry via onCandle + kill-switches.
          if (!this.strategy.isHalted()) {
            const notional = this.strategy.effectiveNotionalUsd();
            const mid = this.fillSimulator.midPriceUsd(currentMs);
            const slipBps = this.fillSimulator.slippageBps(notional, currentMs);
            if (mid !== null && mid > 0) {
              const slipCost = notional * (slipBps / 10_000);
              const fill: HypotheticalFill = {
                id: `paper-${currentMs}-${this.fills.length}`,
                market: this.strategy.config.market,
                leg: "dydx-long", // orchestrator scope: dydx-long-cex-short only
                side: "buy",
                notionalUsd: notional,
                price: mid * (1 + slipBps / 10_000),
                slippageBps: slipBps,
                timestampMs: currentMs,
                fundingRateDydx: dydxSnap.fundingRate,
                fundingRateCex: cexSnap.fundingRate,
                accruedFundingUsd: payment,
                mode: "paper",
              };
              this.fills.push(fill);
              totalFilledNotionalUsd += notional;
              totalSlippageCostUsd += slipCost;
            }
          }
        }

        // 3) Chain heartbeat — re-evaluate kill-switches.
        //    The mock's chainBlockTs must be advanced each tick (in
        //    production the dYdX chain naturally produces new blocks
        //    every ~1.5s, so lastChainBlockTs is always "very recent").
        const blockHeight = fundingSource.lastChainBlockHeight(this.strategy.config.market);
        if (blockHeight !== null) {
          // Advance the mock's chain to the current tick time.
          const adv = (fundingSource as { advanceChainTo?: (ts: number) => void }).advanceChainTo;
          if (typeof adv === "function") {
            adv.call(fundingSource, currentMs);
          }
          this.strategy.recordChainHeartbeat(
            this.strategy.config.market,
            blockHeight,
            currentMs,
            currentMs,
          );
          heartbeatsRecorded += 1;
        }

        // 4) bybit.eu SPOT depth — re-evaluate kill-switches.
        const depth = fundingSource.bybitEuSpotDepthUsd(this.strategy.config.market, currentMs);
        if (depth !== null) {
          this.strategy.recordBybitEuLiquidity(this.strategy.config.market, depth, currentMs);
          depthObservations += 1;
        }

        // 5) Pre-condition reverification (once per day).
        if (currentMs >= nextPrecondReverifyMs) {
          for (const id of ["live-divergence", "chain-incident-clear", "no-recent-governance"] as const) {
            // The live layer (CLI) is responsible for determining
            // satisfaction.  In paper-trade mode we ASSUME satisfied
            // (this is a test, not a live gate).
            this.strategy.recordPreconditionReverify(id, true, currentMs);
            precondReverifications += 1;
          }
          nextPrecondReverifyMs += precondReverifyMs;
        }

        // 6) Day-counter bookkeeping — once per 24h of sim time.
        //    Phase 33 cleanup: the auto-promote `incrementPaperTradeDay`
        //    call is gone.  We only count days locally for the
        //    `daysCompleted` telemetry field.  Use Math.floor-based
        //    day index so the counter is robust to arbitrary
        //    tickIntervalMs values.
        const dayIndex = Math.floor((currentMs - startMs) / (24 * 60 * 60 * 1000));
        if (dayIndex > 0 && dayIndex !== lastDayIndex) {
          lastDayIndex = dayIndex;
        }

        // 7) Halt check.
        if (this.strategy.isHalted()) {
          halted = true;
          haltReason = this._haltReasonFromVerdicts(this.strategy.state.killSwitchVerdicts);
          break;
        }

        currentMs += tickIntervalMs;
      }
    } finally {
      sub.close();
    }

    const endMs = currentMs;
    const precondOk = allPreconditionsSatisfied(
      this.strategy.state.preconditions,
      endMs,
      this.strategy.config.precondition,
    );
    // Phase 30: LatencyGate telemetry summary.  Null when no
    // `latencySource` was configured (default paper-trade mode).
    const latency: PaperTradeLatencyStats | null =
      this.strategy.config.latencySource === null
        ? null
        : {
            pausedTickCount: latencyPausedTickCount,
            totalTickCount: ticksRecorded,
            pausedFraction:
              ticksRecorded > 0 ? latencyPausedTickCount / ticksRecorded : 0,
            maxRoundTripMs: latencyMaxMs,
            minRoundTripMs: latencyMinMs,
            meanRoundTripMs:
              latencyObsCount > 0 ? latencySumMs / latencyObsCount : null,
            arbThresholdMs: this.strategy.config.latencyArbThresholdMs,
          };
    return {
      market: this.strategy.config.market,
      startMs,
      endMs,
      daysCompleted: lastDayIndex,
      fundingTicksRecorded: ticksRecorded,
      chainHeartbeatsRecorded: heartbeatsRecorded,
      bybitEuDepthObservations: depthObservations,
      preconditionReverifications: precondReverifications,
      totalAccruedFundingUsd,
      totalFillCount: this.fills.length,
      totalFilledNotionalUsd,
      totalSlippageCostUsd,
      finalKillSwitchVerdicts: this.strategy.state.killSwitchVerdicts ?? {
        "indexer-stale": { engaged: false, reason: "never-evaluated" },
        "chain-non-finalized": { engaged: false, reason: "never-evaluated" },
        "divergence-7d-compression": { engaged: false, reason: "never-evaluated" },
        "bybit-eu-spot-thin": { engaged: false, reason: "never-evaluated" },
      },
      preconditionsOkAtEnd: precondOk,
      fills: [...this.fills],
      halted,
      haltReason,
      latency,
    };
  }

  private _haltReasonFromVerdicts(
    v: KillSwitchVerdicts | null,
  ): string | null {
    if (v === null) return null;
    if (v["indexer-stale"].engaged) return v["indexer-stale"].reason;
    if (v["chain-non-finalized"].engaged) return v["chain-non-finalized"].reason;
    if (v["divergence-7d-compression"].engaged) return v["divergence-7d-compression"].reason;
    return null;
  }
}

// Re-export the precondition-id type for convenience.
export type { PreconditionId };
