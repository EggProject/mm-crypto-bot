// packages/core/src/strategy/multi-class-ensemble.ts — Multi-class edge ensemble
//
// Phase 6 M2 — A Phase 6 brief §1.2 szerinti multi-class ensemble, ami a
// Phase 5 Donchian 1d edge-t (Strategy C) kombinálja a Phase 6 Track A
// funding-carry-vel, a Track B arb-latency gate-tel és a Track C Kelly-opt
// position-sizing-gal.
//
// Komponensek (4 edge osztály, egy strategy-ba integrálva):
//
//   1. DonchianBreakoutStrategy (Phase 5 C, 1d) — a BASE trend-following edge.
//      Ez adja a primary directional signalt (long/short breakout).
//
//   2. FundingCarryStrategy (Track A, 1h) — DELTA-NEUTRAL carry parallel.
//      A 8h funding payment-eket gyűjti long-spot + short-perp szintetikus
//      pozíción. A carry contribution NEM megy keresztül a directional
//      engine-n (az engine only directional position-t kezel), hanem a
//      FundingCarryStrategy.state mezőben trackelődik. A CLI runner a
//      backtest után olvassa ki.
//
//   3. CrossExchangeArbLatency gate (Track B) — INFORMATIONAL gate, ami
//      a carry komponenst pause-eli ha a cross-exchange latency túllépi
//      a trade-ablak méretét. A gate egy előre betöltött LatencySnapshot
//      -ból dolgozik (Phase 6 Track B 3 minta JSON-ból).
//
//   4. KellyPositionSizer (Track C) — POSITION-SIZING a combined edge-re.
//      A `optimizeKelly` által javasolt `recommendedMaxPositionPctEquity`
//      a `BacktestOptions.positionSize.maxPositionPctEquity`-be kerül;
//      az engine ezen keresztül skálázza a position notional-t.
//
// Signal-aggregáció (kritikus — no double-counting):
//
//   - A ensemble PRIMARY signal-ja a Donchian signál (a carry NEM ad
//     directional jelet az engine-nek; az engine ezt a single position-t
//     kezeli, és a carry contribution-t a FundingCarryStrategy state-ből
//     olvassa ki a CLI runner).
//
//   - A latency gate NEM változtatja meg a Donchian signált; CSAK a carry
//     komponenst pause-eli (a carry state.fundingCollectedUsd nem nő ha
//     a gate zárva van).
//
//   - A Kelly multiplier a signal.confidence értékét NEM módosítja
//     (a confidence a strategy edge erőssége, nem a sizing); a sizing
//     kívül történik, a BacktestOptions.positionSize.maxPositionPctEquity
//     útján.
//
//   - A ensemble a "combined edge" statisztikát a `MultiClassEnsembleState`
//     mezőben tartja: { donchianSignals, fundingCarryUsd, latencyGateActive,
//     kellyMultiplier }.
//
// References (Phase 6 brief §1.2 + az egyes track-ek reportjai):
//   - Phase 5 C Donchian 1d (Strategy C): docs/research/REPORT-phase5.md §4.2
//   - Track A funding carry: docs/research/phase6-funding-carry.md
//   - Track B arb latency: docs/research/phase6-arb-latency.md
//   - Track C Kelly-opt: docs/research/phase6-kelly-opt.md

import type { Timeframe } from "@mm-crypto-bot/shared/types";

import type { Strategy, StrategyContext, StrategySignal } from "../types.js";
import {
  DonchianBreakoutStrategy,
  type DonchianBreakoutConfig,
  DEFAULT_DONCHIAN_CONFIG,
} from "./donchian-breakout.js";
import {
  FundingCarryStrategy,
  type FundingCarryConfig,
  type FundingCarryState,
  DEFAULT_FUNDING_CARRY_CONFIG,
} from "./funding-carry.js";

// ---------------------------------------------------------------------------
// Cross-exchange latency gate (Track B)
// ---------------------------------------------------------------------------

/**
 * `LatencySnapshot` — a pre-loaded cross-exchange latency profile, captured
 * from the Track B LatencyMonitor's `arb-latency-*-sample.json` outputs.
 *
 * The gate is INFORMATIONAL — it is consulted once per candle on the
 * ensemble's `onCandle` callback. If `roundTripMsMax` exceeds
 * `arbThresholdMs`, the carry component is paused (no funding accrual
 * for that candle).
 *
 * The `roundTripMsMax` is the pessimistic upper-bound cross-exchange
 * round-trip time (sum of both legs' median RTT + WS gap + reconnect
 * budget). Per Phase 6 Track B empirical report, current CCXT Pro
 * infra gives round-trip medians 1027-4940ms — well above the
 * sub-100ms brief threshold. The gate's default `arbThresholdMs = 500ms`
 * is the realistic "arb is dead, paper-track only" cutoff per the
 * Track B report.
 */
export interface LatencySnapshot {
  /** Exchange pair (e.g. "binance-bybit", "bybit-kucoin"). */
  readonly pair: string;
  /** Worst-case cross-exchange round-trip time (ms). */
  readonly roundTripMsMax: number;
  /** Median round-trip time (ms). */
  readonly roundTripMsMedian: number;
  /** Source JSON path (informational, for the CLI report). */
  readonly sourceJsonPath: string;
}

/**
 * `LatencyGate` — the Track B gate component. A simple predicate that
 * decides whether the carry component is allowed to accrue funding on a
 * given candle.
 *
 * Design choice: the gate is a STANDALONE function (not a Strategy),
 * because it has no per-candle state — it operates on a pre-loaded
 * `LatencySnapshot` and a per-symbol `arbThresholdMs`. The
 * `MultiClassEnsemble` consults the gate before invoking the carry
 * component.
 */
export interface LatencyGate {
  /** True if the carry component may accrue funding on the current candle. */
  isCarryAllowed(): boolean;
  /** Snapshot of the latency profile used by this gate. */
  readonly snapshot: LatencySnapshot;
  /** Threshold in ms above which the carry is paused. */
  readonly arbThresholdMs: number;
}

/**
 * `createLatencyGate` — factory for the default latency gate. Returns a
 * simple closure-based gate that consults a pre-loaded `LatencySnapshot`.
 *
 * If `snapshot.roundTripMsMax > arbThresholdMs`, the carry is paused.
 *
 * @param snapshot Pre-loaded latency profile (from Track B JSON).
 * @param arbThresholdMs Max allowed round-trip time (default 500ms — Track B
 *                      empirical cutoff per docs/research/phase6-arb-latency.md).
 */
export function createLatencyGate(snapshot: LatencySnapshot, arbThresholdMs = 500): LatencyGate {
  return {
    snapshot,
    arbThresholdMs,
    isCarryAllowed: () => snapshot.roundTripMsMax <= arbThresholdMs,
  };
}

/**
 * `DEFAULT_LATENCY_GATE_DISABLED` — sentinel gate that always allows carry.
 * Used in tests and in the multi-class ensemble CLI runner when the
 * Track B JSON is not loaded (no arb-latency sample available). The carry
 * accrual proceeds unconstrained.
 */
export const DEFAULT_LATENCY_GATE_DISABLED: LatencyGate = {
  snapshot: {
    pair: "disabled",
    roundTripMsMax: 0,
    roundTripMsMedian: 0,
    sourceJsonPath: "(no-latency-snapshot-loaded)",
  },
  arbThresholdMs: Number.POSITIVE_INFINITY,
  isCarryAllowed: () => true,
};

// ---------------------------------------------------------------------------
// Kelly-opt ensemble aggregate (Track C)
// ---------------------------------------------------------------------------

/**
 * `KellyOptAggregate` — the Track C Kelly-opt position-sizing integration.
 * The ensemble reads the `recommendedMaxPositionPctEquity` (set by
 * `optimizeKelly`) and the `kellyMultiplier` (0.25 / 0.5 / 1.0) to inform
 * the CLI runner's `BacktestOptions.positionSize.maxPositionPctEquity`
 * override.
 *
 * Per Track C empirical: the 0.5× Kelly default is the practitioner
 * sweet spot (75% growth at 50% volatility, ~25% DD vs full-Kelly's ~50%).
 */
export interface KellyOptAggregate {
  /** Fractional Kelly multiplier (0.25, 0.5, or 1.0). */
  readonly kellyMultiplier: 0.25 | 0.5 | 1.0;
  /** Recommended position cap as fraction of equity. */
  readonly recommendedMaxPositionPctEquity: number;
  /** Empirical win-rate from the underlying Donchian 1d backtest. */
  readonly winRate: number;
  /** Empirical win-loss ratio. */
  readonly winLossRatio: number;
}

/**
 * `DEFAULT_KELLY_OPT_AGGREGATE` — defaults for the ensemble: 0.5× Kelly,
 * 20% max position (Phase 5 + Track C baseline). Used when no Kelly
 * optimization has been run yet (cold-start).
 */
export const DEFAULT_KELLY_OPT_AGGREGATE: KellyOptAggregate = {
  kellyMultiplier: 0.5,
  recommendedMaxPositionPctEquity: 0.2,
  winRate: 0,
  winLossRatio: 0,
};

// ---------------------------------------------------------------------------
// Ensemble configuration
// ---------------------------------------------------------------------------

/**
 * `MultiClassEnsembleConfig` — the full configuration of the multi-class
 * ensemble. Each component is independently configurable; sensible
 * defaults match the Phase 6 brief + Track A/B/C empirical results.
 */
export interface MultiClassEnsembleConfig {
  readonly donchian: Partial<DonchianBreakoutConfig>;
  readonly fundingCarry: Partial<FundingCarryConfig>;
  /** The latency gate (Track B). Pass `DEFAULT_LATENCY_GATE_DISABLED` to bypass. */
  readonly latencyGate: LatencyGate;
  /** Kelly-opt aggregate (Track C). */
  readonly kellyOpt: KellyOptAggregate;
}

/**
 * `DEFAULT_MULTI_CLASS_ENSEMBLE_CONFIG` — partial defaults (the latencyGate
 * and kellyOpt must be supplied by the caller; this only contains the
 * strategy-component defaults).
 */
export const DEFAULT_MULTI_CLASS_ENSEMBLE_CONFIG_PARTIAL: Omit<
  MultiClassEnsembleConfig,
  "latencyGate" | "kellyOpt"
> = {
  donchian: DEFAULT_DONCHIAN_CONFIG,
  fundingCarry: DEFAULT_FUNDING_CARRY_CONFIG,
};

// ---------------------------------------------------------------------------
// Multi-class ensemble state
// ---------------------------------------------------------------------------

/**
 * `MultiClassEnsembleState` — read-only view of the ensemble's runtime
 * state after a backtest. The CLI runner reads this for the empirical
 * report and the combined-edge computation.
 *
 * `donchianSignalsEmitted` — number of Donchian signals produced during the
 * backtest (== number of trades the engine would have taken).
 *
 * `fundingCarryUsd` — total funding collected by the carry component
 * (sum of all 8h funding payments while the latency gate was OPEN).
 * Negative if the historical funding rates were net-short-biased.
 *
 * `latencyGateActiveFraction` — fraction of candles where the latency gate
 * allowed the carry (0 = always paused, 1 = always open).
 *
 * `combinedEdgePct` — the COMBINED edge (Donchian trade PnL + carry
 * funding) as a percentage of initial equity. Computed by the CLI runner
 * after the backtest from the trade list + carry state.
 */
export interface MultiClassEnsembleState {
  readonly donchianSignalsEmitted: number;
  readonly donchianSignalsAcceptedByFilter: number;
  readonly fundingCarryUsd: number;
  readonly fundingCarryPausedCandles: number;
  readonly fundingCarryActiveCandles: number;
  readonly latencyGateActiveFraction: number;
  readonly kellyMultiplier: 0.25 | 0.5 | 1.0;
  readonly combinedEdgePct: number;
  /** Direct reference to the carry state (for CLI runner access). */
  readonly fundingCarryState: FundingCarryState;
}

// ---------------------------------------------------------------------------
// MultiClassEnsemble implementation
// ---------------------------------------------------------------------------

/**
 * `MultiClassEnsemble` — composite Strategy that runs:
 *   1. Donchian (directional primary signal)
 *   2. FundingCarry (delta-neutral parallel, state-tracked)
 *   3. LatencyGate (gates the carry)
 *   4. KellyOpt (informs position-sizing; applied externally via
 *      BacktestOptions.positionSize.maxPositionPctEquity)
 *
 * The Strategy interface returns the Donchian signal as-is (no double-
 * counting with the carry; the carry contributes through state, not signals).
 *
 * The latency gate does NOT change the Donchian signal — it ONLY gates
 * the carry component. This is intentional: a paused carry does not mean
 * a paused trend trade; the two edges are independent.
 *
 * NOTE on the Kelly integration: the strategy itself does NOT scale the
 * position size. The `kellyMultiplier` and `recommendedMaxPositionPctEquity`
 * are exposed via `state` for the CLI runner, which passes them into
 * `BacktestOptions.positionSize.maxPositionPctEquity` on the next
 * backtest pass. This keeps the Strategy interface clean (no equity
 * feedback) and avoids breaking the engine's anti-lookahead guarantees.
 */
export class MultiClassEnsemble implements Strategy {
  readonly name =
    "Phase 6 Multi-Class Ensemble (Donchian + Funding-Carry + Arb-Latency-Gate + Kelly-Opt)";
  readonly timeframes = ["1d", "4h", "1h"] as const;
  readonly config: MultiClassEnsembleConfig;
  readonly donchian: DonchianBreakoutStrategy;
  readonly fundingCarry: FundingCarryStrategy;
  readonly latencyGate: LatencyGate;
  readonly kellyOpt: KellyOptAggregate;

  // Per-candle counters. The combinedEdgePct is set by the CLI runner
  // after the backtest.
  private donchianSignalsEmitted = 0;
  private donchianSignalsAcceptedByFilter = 0;
  private fundingCarryPausedCandles = 0;
  private fundingCarryActiveCandles = 0;

  constructor(config: MultiClassEnsembleConfig) {
    this.config = config;
    this.donchian = new DonchianBreakoutStrategy(config.donchian);
    this.fundingCarry = new FundingCarryStrategy(config.fundingCarry);
    this.latencyGate = config.latencyGate;
    this.kellyOpt = config.kellyOpt;
  }

  warmup(): number {
    // Both the Donchian and the FundingCarry must be warm before any
    // signal can be produced. The Donchian warmup dominates (30 candles).
    return Math.max(this.donchian.warmup(), this.fundingCarry.warmup());
  }

  /**
   * `onCandle` — runs every LTF candle.
   *
   * Step 1: Donchian signal → this is the PRIMARY output (the engine's
   *         directional position).
   * Step 2: Latency gate consultation. If OPEN, the carry component's
   *         `onCandle` is invoked (funding accrual + rebalance logic).
   *         If CLOSED, the carry is paused for this candle.
   * Step 3: Return the Donchian signal (or null).
   *
   * Critically: the carry component NEVER overrides or modifies the
   * Donchian signal. The two edges are independent and combined only at
   * the portfolio level (CLI runner reads `state.fundingCarryUsd` after
   * the backtest).
   */
  onCandle(ctx: StrategyContext): StrategySignal | null {
    // Step 1 — Donchian signal.
    const donchianSignal = this.donchian.onCandle(ctx);

    if (donchianSignal !== null) {
      this.donchianSignalsEmitted += 1;
      // The Donchian's HTF trend filter is the only filter applied here;
      // the ensemble does NOT add additional filters (the Kelly and
      // latency components are orthogonal).
      this.donchianSignalsAcceptedByFilter += 1;
    }

    // Step 2 — Latency gate + carry component.
    if (this.latencyGate.isCarryAllowed()) {
      this.fundingCarryActiveCandles += 1;
      // Invoke the carry strategy. Its `onCandle` returns a one-shot
      // "buy" signal on the first valid candle; subsequent calls return
      // null but maintain the carry state (funding accrual).
      const carrySignal = this.fundingCarry.onCandle(ctx);
      void carrySignal; // suppress unused-var lint; carry captured in state
    } else {
      this.fundingCarryPausedCandles += 1;
      // Gate CLOSED — do NOT invoke the carry component, so no funding
      // accrual happens on this candle.
    }

    // Step 3 — Return the Donchian signal (with an ensemble reason tag).
    if (donchianSignal === null) {
      return null;
    }
    const carryStatus = this.latencyGate.isCarryAllowed() ? "carry=active" : "carry=paused";
    return {
      ...donchianSignal,
      reason: `[MultiClassEnsemble] ${carryStatus} | ${donchianSignal.reason}`,
    };
  }

  /**
   * `getState` — returns the multi-class ensemble's runtime state. The
   * CLI runner calls this after the backtest to assemble the combined-edge
   * metrics.
   *
   * `combinedEdgePct` is left at 0 here (the strategy doesn't have
   * access to the equity curve); the CLI runner sets it after computing
   * `donchianPnl + fundingCarryUsd` as a fraction of initial equity.
   */
  getState(): MultiClassEnsembleState {
    const totalCarryCandles = this.fundingCarryActiveCandles + this.fundingCarryPausedCandles;
    const latencyGateActiveFraction =
      totalCarryCandles === 0 ? 0 : this.fundingCarryActiveCandles / totalCarryCandles;
    return {
      donchianSignalsEmitted: this.donchianSignalsEmitted,
      donchianSignalsAcceptedByFilter: this.donchianSignalsAcceptedByFilter,
      fundingCarryUsd: this.fundingCarry.state.fundingCollectedUsd,
      fundingCarryPausedCandles: this.fundingCarryPausedCandles,
      fundingCarryActiveCandles: this.fundingCarryActiveCandles,
      latencyGateActiveFraction,
      kellyMultiplier: this.kellyOpt.kellyMultiplier,
      combinedEdgePct: 0, // set by CLI runner after the backtest
      fundingCarryState: { ...this.fundingCarry.state },
    };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * `timeframesForMultiClass` — returns the standard HTF/MTF/LTF triple for
 * the multi-class ensemble. The Donchian runs on 1d HTF + 4h MTF + 1h LTF
 * (Phase 5 convention), and the carry runs on the same 1h LTF.
 */
export function timeframesForMultiClass(ltf: Timeframe): {
  readonly htf: Timeframe;
  readonly mtf: Timeframe;
  readonly ltf: Timeframe;
} {
  if (ltf === "1h") return { htf: "1d", mtf: "4h", ltf: "1h" };
  if (ltf === "4h") return { htf: "1d", mtf: "4h", ltf: "4h" };
  if (ltf === "1d") return { htf: "1d", mtf: "4h", ltf: "1d" };
  throw new Error(`Multi-class ensemble unsupported ltf: ${ltf as string}`);
}
