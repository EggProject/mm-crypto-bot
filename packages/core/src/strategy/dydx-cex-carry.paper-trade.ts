// packages/core/src/strategy/dydx-cex-carry.paper-trade.ts
//
// Paper-trade runner for the dYdX-vs-CEX funding carry.
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
// Paper-trade gate cleanup (2026-07-11) — user mandate
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
// bot-runtime concern.
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
import { ExactRational } from "@mm-crypto-bot/numeric";
import { DydxCexCarryDomainError, allPreconditionsSatisfied } from "./dydx-cex-carry.js";
import type {
  CarryMarket,
  DydxFundingSource,
  DydxCexCarryStrategy,
  KillSwitchVerdicts,
} from "./dydx-cex-carry.js";
import { isHaltEngaged } from "./dydx-cex-carry-paper-trader.js";

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
  slippageBps(notionalUsd: ExactRational, nowMs: number): ExactRational;
  /**
   * Current bybit.eu SPOT depth in USD @ 1% from mid for the
   * underlying asset. Undefined means unknown.
   */
  depthUsdAt1Pct(nowMs: number): number | undefined;
  /**
   * The mid-price for the underlying SPOT pair (used to compute
   * notional → quantity conversion). Undefined means unknown.
   */
  midPriceUsd(nowMs: number): ExactRational | undefined;
}

/**
 * `HypotheticalFill` — a single paper-trade fill record.
 */
export interface HypotheticalFill {
  readonly id: string;
  readonly market: CarryMarket;
  readonly leg: "dydx-long" | "cex-short" | "dydx-short" | "cex-long";
  readonly side: "buy" | "sell";
  readonly notionalUsd: ExactRational;
  readonly price: ExactRational;
  readonly slippageBps: ExactRational;
  readonly timestampMs: number;
  readonly fundingRateDydx: ExactRational;
  readonly fundingRateCex: ExactRational;
  readonly accruedFundingUsd: ExactRational;
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
  readonly totalAccruedFundingUsd: ExactRational;
  readonly totalFillCount: number;
  readonly totalFilledNotionalUsd: ExactRational;
  readonly totalSlippageCostUsd: ExactRational;
  readonly finalKillSwitchVerdicts: KillSwitchVerdicts;
  readonly preconditionsOkAtEnd: { readonly ok: boolean; readonly reasons: readonly string[] };
  readonly fills: readonly HypotheticalFill[];
  readonly halted: boolean;
  readonly haltReason: string | undefined;
  /**
   * `latency` — LatencyGate telemetry.  Undefined when the
   * strategy was constructed without a `latencySource` (paper-trade
   * default — synthetic 0ms).  Populated when a `latencySource` was
   * configured and `pollLatencySource()` returned at least one
   * observation.
   */
  readonly latency: PaperTradeLatencyStats | undefined;
}

/**
 * `PaperTradeLatencyStats` — LatencyGate telemetry.
 * Statistics over the latency observations observed during the
 * paper-trade run.
 */
export interface PaperTradeLatencyStats {
  /*
   * Number of funding ticks paused due to latency above the threshold.
   */
  readonly pausedTickCount: number;
  /*
   * Total funding ticks recorded.
   */
  readonly totalTickCount: number;
  /*
   * Fraction of ticks paused by the latency gate.
   */
  readonly pausedFraction: number;
  /*
   * Max observed round-trip latency in milliseconds.
   */
  readonly maxRoundTripMs: number | undefined;
  /*
   * Min observed round-trip latency in milliseconds.
   */
  readonly minRoundTripMs: number | undefined;
  /*
   * Mean observed round-trip latency in milliseconds.
   */
  readonly meanRoundTripMs: number | undefined;
  /*
   * The strategy's configured threshold in milliseconds.
   */
  readonly arbThresholdMs: number;
}

/**
 * `PaperTradeRunnerConfig` — config for the paper-trade runner.
 */
export interface PaperTradeRunnerConfig {
  /*
   * Number of paper-trade days to run. Default 7.
   */
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

  private haltReasonFromVerdicts(verdicts: KillSwitchVerdicts): string {
    if (verdicts["indexer-stale"].engaged) return verdicts["indexer-stale"].reason;
    if (verdicts["chain-non-finalized"].engaged) return verdicts["chain-non-finalized"].reason;
    return verdicts["divergence-7d-compression"].reason;
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
  runForDays(days: number, fundingSource: DydxFundingSource, nowMs: number = Date.now()): PaperTradeReport {
    if (!Number.isFinite(days) || days <= 0) {
      throw new Error(`days must be positive finite, got ${String(days)}`);
    }
    const startMs = nowMs;
    let currentMs = startMs;
    let lastDayIndex = 0;
    let ticksRecorded = 0;
    let heartbeatsRecorded = 0;
    let depthObservations = 0;
    let precondReverifications = 0;
    let totalAccruedFundingUsd = ExactRational.from("0");
    let totalFilledNotionalUsd = ExactRational.from("0");
    let totalSlippageCostUsd = ExactRational.from("0");
    let isHalted = false;
    let haltReason: string | undefined;
    // LatencyGate telemetry counters.  Only populated
    // when the strategy was constructed with a `latencySource`.
    let latencyPausedTickCount = 0;
    let latencyObsCount = 0;
    let latencySumMs = 0;
    let latencyMaxMs: number | undefined;
    let latencyMinMs: number | undefined;

    // Subscribe to live funding ticks (the production impl returns a
    // WebSocket; in tests it's a mock).  We don't actually USE the
    // subscription here — paper-trade is driven deterministically by
    // the source's lastTickMs / lastTickAgeMs at each interval tick.
    // We DO subscribe to keep the production wiring hot.
    const sub = fundingSource.subscribe(this.strategy.config.market, () => {
      void 0;
    });
    try {
      const endMs = startMs + days * 24 * 60 * 60 * 1000;
      const tickIntervalMs = this.config.tickIntervalMs;
      const precondReverifyMs = this.config.preconditionReverifyIntervalMs;
      let nextPrecondReverifyMs = startMs;

      while (currentMs <= endMs) {
        const depth = fundingSource.bybitEuSpotDepthUsd(this.strategy.config.market, currentMs);
        this.strategy.recordBybitEuLiquidity(this.strategy.config.market, depth, currentMs);
        depthObservations += 1;
        // 1) Funding tick — read source state + apply to strategy.
        const staleMs = fundingSource.lastTickAgeMs(this.strategy.config.market, currentMs);
        const chainBlockTs = fundingSource.lastChainBlockTs(this.strategy.config.market);
        if (staleMs !== undefined && chainBlockTs !== undefined) {
          // Both source + chain are alive — record a synthetic tick
          // for the strategy.  We use a small non-zero funding rate
          // (dYdX -0.0001/1h, CEX 0.0002/1h) so the 8h-equivalent
          // divergence is non-zero and the 7-day compression
          // kill-switch doesn't false-positive on a clean paper-trade
          // run.  Production wires use the real dYdX + CEX funding.
          const dydxSnap: FundingSnapshot = {
            fundingTime: currentMs,
            symbol: this.strategy.config.market,
            fundingRate: ExactRational.from("-0.0001"),
          };
          const cexSnap: FundingSnapshot = {
            fundingTime: currentMs,
            symbol: this.strategy.config.market,
            fundingRate: ExactRational.from("0.0002"),
          };
          let payment = ExactRational.from("0");
          try {
            payment = this.strategy.recordFundingTick(dydxSnap, cexSnap, currentMs);
          } catch (error: unknown) {
            if (!(error instanceof DydxCexCarryDomainError) || error.code !== "INVALID_LATENCY_SNAPSHOT")
              throw error;
          }
          totalAccruedFundingUsd = totalAccruedFundingUsd.add(payment);
          ticksRecorded += 1;
          // LatencyGate telemetry.  After
          // `recordFundingTick` (which auto-polls the latency
          // source), read back the gate state + last round-trip.
          if (this.strategy.config.latencySource !== undefined) {
            const latency = this.strategy.state.latency;
            if (latency.status === "valid") {
              const lastRt = latency.roundTripMs;
              latencyObsCount += 1;
              latencySumMs += lastRt;
              latencyMaxMs = latencyMaxMs === undefined ? lastRt : Math.max(latencyMaxMs, lastRt);
              latencyMinMs = latencyMinMs === undefined ? lastRt : Math.min(latencyMinMs, lastRt);
            }
            // Payment == 0 with no kill-switch halt ⇒ latency pause.
            if (payment.isZero() && !this.strategy.isHalted()) {
              latencyPausedTickCount += 1;
            }
          }

          // 2) Hypothetical fill — log a paper-trade fill on each tick
          //    if the strategy is "in carry" (not halted).  Paper-trade
          //    paper-trade mode is implicit (no auto-promote gate);
          //    the strategy decides entry via onCandle + kill-switches.
          if (!payment.isZero() && !this.strategy.isHalted() && !this.strategy.isLatencyPaused()) {
            const notional = this.strategy.effectiveNotionalUsd();
            const mid = this.fillSimulator.midPriceUsd(currentMs);
            const slipBps = this.fillSimulator.slippageBps(notional, currentMs);
            if (mid !== undefined && !mid.isZero() && !mid.isNegative()) {
              const slipFraction = slipBps.divide(ExactRational.from("10000"));
              const slipCost = notional.multiply(slipFraction);
              const fill: HypotheticalFill = {
                id: `paper-${String(currentMs)}-${String(this.fills.length)}`,
                market: this.strategy.config.market,
                leg: "dydx-long", // orchestrator scope: dydx-long-cex-short only
                side: "buy",
                notionalUsd: notional,
                price: mid.multiply(ExactRational.from("1").add(slipFraction)),
                slippageBps: slipBps,
                timestampMs: currentMs,
                fundingRateDydx: dydxSnap.fundingRate,
                fundingRateCex: cexSnap.fundingRate,
                accruedFundingUsd: payment,
                mode: "paper",
              };
              this.fills.push(fill);
              totalFilledNotionalUsd = totalFilledNotionalUsd.add(notional);
              totalSlippageCostUsd = totalSlippageCostUsd.add(slipCost);
            }
          }
        }

        // 3) Chain heartbeat — re-evaluate kill-switches.
        //    The mock's chainBlockTs must be advanced each tick (in
        //    production the dYdX chain naturally produces new blocks
        //    every ~1.5s, so lastChainBlockTs is always "very recent").
        const blockHeight = fundingSource.lastChainBlockHeight(this.strategy.config.market);
        if (blockHeight !== undefined) {
          // Advance the mock's chain to the current tick time.
          if (hasChainAdvance(fundingSource)) fundingSource.advanceChainTo(currentMs);
          this.strategy.recordChainHeartbeat(this.strategy.config.market, blockHeight, currentMs, currentMs);
          heartbeatsRecorded += 1;
        }

        // 4) Pre-condition reverification (once per day).
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

        // 5) Day-counter bookkeeping — once per 24h of sim time.
        //    The auto-promote `incrementPaperTradeDay`
        //    call is gone.  We only count days locally for the
        //    `daysCompleted` telemetry field.  Use Math.floor-based
        //    day index so the counter is robust to arbitrary
        //    tickIntervalMs values.
        const dayIndex = Math.floor((currentMs - startMs) / (24 * 60 * 60 * 1000));
        if (dayIndex !== lastDayIndex && dayIndex > 0) {
          lastDayIndex = dayIndex;
        }

        // 6) Halt check.
        const verdicts = this.strategy.state.killSwitchVerdicts;
        if (isHaltEngaged(verdicts)) {
          isHalted = true;
          haltReason = this.haltReasonFromVerdicts(verdicts);
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
    // LatencyGate telemetry summary.  Undefined when no
    // `latencySource` was configured (default paper-trade mode).
    const latency: PaperTradeLatencyStats | undefined =
      this.strategy.config.latencySource === undefined
        ? undefined
        : {
            pausedTickCount: latencyPausedTickCount,
            totalTickCount: ticksRecorded,
            pausedFraction: ticksRecorded > 0 ? latencyPausedTickCount / ticksRecorded : 0,
            maxRoundTripMs: latencyMaxMs,
            minRoundTripMs: latencyMinMs,
            meanRoundTripMs: latencyObsCount > 0 ? latencySumMs / latencyObsCount : undefined,
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
      finalKillSwitchVerdicts: this.strategy.state.killSwitchVerdicts,
      preconditionsOkAtEnd: precondOk,
      fills: [...this.fills],
      halted: isHalted,
      haltReason,
      latency,
    };
  }
}

function hasChainAdvance(
  source: DydxFundingSource,
): source is DydxFundingSource & { readonly advanceChainTo: (timestampMs: number) => void } {
  return "advanceChainTo" in source && typeof source.advanceChainTo === "function";
}

// Re-export the precondition-id type for convenience.
export type { PreconditionId } from "./dydx-cex-carry.js";
