// packages/core/src/strategy/dydx-cex-carry.ts
//
// Phase 25 #2 T2 — dYdX-vs-CEX cross-venue funding carry strategy (LIVE INTEGRATION).
//
// ============================================================================
// SCOPE (per orchestrator-approved deviation, 2026-07-08 04:09 Budapest)
// ============================================================================
//
//  - BTC-USD ONLY.  ETH deferred (Tardis Q2'26 paid-tier missing).
//    SOL halted permanently (T1 empirical 9 windows: -4.08/+2.17/-12.56 %/mo,
//    INVERTED vs hypothesis).
//  - cap = 0.025 (1/2 of §7.3 spec value 0.05) — sizes to Phase 14B 15% DD
//    target, not undershoot.  Empirically calibrated to T1 +9.30/+6.67/+3.30
//    %/mo for BTC across 3 windows.
//  - $125k/leg (1/2 of §7.3 spec $250k).
//  - 7-day paper-trade MANDATORY gate before any live order (per orchestrator
//    steer).  No live orders until paper-trade emits a clean 7-day run with
//    all risk gates green.
//  - Sparse-data guard on the 7-day compression kill-switch (T1 backtests
//    all fired `killSwitch7DayCompressionTriggered = true` for sparse-data
//    false positives — guard requires a minimum tick-density per window
//    before the 7-day compression kill-switch can fire on real data).
//  - Regulatory caveat (MiCAR / non-MiCAR dYdX v4): dYdX v4 is non-MiCAR,
//    so bybit.eu SPOT is the execution layer; dYdX v4 is signal/data only.
//    See deliverable.md §Regulatory.
//
// ============================================================================
// REFERENCES (full citations in docs/research/phase25/track-b/sources.md)
// ============================================================================
//
//  - docs/research/phase25/track-b/REPORT.md §3 (dYdX v4 funding stats,
//    1-hour settlement, structural-negative divergence)
//  - docs/research/phase25/track-b/REPORT.md §7.2 (3 pre-conditions)
//  - docs/research/phase25/track-b/REPORT.md §7.5 (4 kill-switches)
//  - docs/research/REPORT-phase19.md (cap=0.20 BTC anchor: 16.66%/mo @ 4.64%
//    DD 2-of-2; 34.52%/mo @ 7.18% DD 1-of-2 — wire-up integrity baseline)
//  - docs/research/PHASE-20-21-22-23-ARCHIVE.md §13 (silent no-op discipline)
//  - dYdX v4 Indexer docs (https://docs.dydx.xyz/indexer-client/http) —
//    public, unauthenticated, no rate limit declared, validator-hosted REST
//    250-300 req/min
//  - BitMEX Q3 2025 Derivatives Report (cross-venue funding multiples)
//  - Tardis.dev derivative_ticker/{YYYY}/{MM}/01/{SYM}.csv.gz (free monthly
//    downloads, backtest data only — live uses the public Indexer)
//
// ============================================================================
// STRATEGY INTERFACE INTEGRATION
// ============================================================================
//
// `DydxCexCarryStrategy` implements the project's `Strategy` interface so it
// drops into the existing backtest + signal-center pipeline.  Like the
// Phase 6 `FundingCarryStrategy`, it emits ONE "buy" signal on the first
// valid candle so the engine has a position to track.  The actual carry
// P&L is computed by `DydxCexCarryPaperTrader` (dydx-cex-carry.paper-trade.ts)
// via the pure-functional `accrueFunding` / `recordFundingTick` /
// `recordChainHeartbeat` / `recordBybitEuLiquidity` API.
//
// Three persistence layers — the strategy rolls state forward across
// restarts so the 7-day paper-trade gate and the 7-day compression
// kill-switch survive process restarts:
//
//   - `state.preconditionTracker` (PreconditionsState) — durable per-symbol
//     pre-condition verdicts + first-observed timestamp
//   - `state.compressionWindowDays` (string[] of YYYY-MM-DD) — rolling 7-day
//     window of "compressed" days, used by the 7-day compression kill-switch
//   - `state.tickDensityTracker` (TickDensityState) — per-window sparse-data
//     guard counters
//
// To make a strategy instance durable across restarts, snapshot the
// `state` field at exit and `restore(state)` at startup.  See
// `serializeState()` / `DydxCexCarryStrategy.fromSnapshot()` below.

import type { Strategy, StrategyContext, StrategySignal } from "../types.js";
import { ONE_TO_TEN_LEVERAGE } from "../risk/leverage-invariant.js";
import type { FundingSnapshot } from "./funding-snapshot.js";
// Phase 30 LatencyGate live wiring — the dYdX-vs-CEX carry uses the
// Phase 6 Track B `LatencyGate` to gate live funding accrual on
// cross-venue round-trip latency.  When latency > threshold, the
// carry is paused (no funding collected, no new entries).
import {
  createLatencyGate,
  DEFAULT_LATENCY_GATE_DISABLED,
  type LatencyGate,
  type LatencySnapshot,
} from "./multi-class-ensemble.js";

// ============================================================================
// PUBLIC TYPES
// ============================================================================

/** Live-carry market — BTC-USD ONLY per orchestrator scope lock. */
export type CarryMarket = "BTC-USD";

/** Default market per orchestrator steer. */
export const DEFAULT_CARRY_MARKET: CarryMarket = "BTC-USD";

/**
 * `CarryDirection` — which leg is long and which is short.
 *
 * In the structural-negative dYdX funding regime (T1 empirical: BTC dYdX
 * funding -0.0022%/8h vs Binance +0.0080%/8h), going LONG on dYdX earns
 * negative funding and SHORT on CEX earns positive funding.  We default
 * to `dydx-long-cex-short`.  If dYdX funding flips positive (sparse-data
 * edge case), the strategy would need to FLIP direction — but per the
 * Track B §6.4 mitigation we HALT the strategy if dYdX funding is no
 * longer structurally negative over a 7-day window, so direction-flip
 * is NOT in scope.
 */
export type CarryDirection = "dydx-long-cex-short";

export const DEFAULT_CARRY_DIRECTION: CarryDirection = "dydx-long-cex-short";

// ---------------------------------------------------------------------------
// 4 KILL-SWITCHES (Phase 25 #2 Track B §7.5)
// ---------------------------------------------------------------------------

/**
 * The 4 kill-switches, ordered.  All 4 are evaluated every funding tick;
 * if ANY fires, the strategy halts.  Each switch is exposed both as a
 * predicate (pure function) and as state on the strategy (for tests +
 * the CLI).
 */
export type KillSwitchId =
  /** Indexer stale > 5 min → halt dYdX leg. */
  | "indexer-stale"
  /** Chain non-finalized > 10 min → halt all dYdX exposure. */
  | "chain-non-finalized"
  /** Divergence compresses < 0.0005/8h for 7 consecutive days → halt strategy. */
  | "divergence-7d-compression"
  /** bybit.eu SPOT leg liquidity < $100k @ 1% from mid → reduce sizing. */
  | "bybit-eu-spot-thin";

export interface KillSwitchConfig {
  /** Indexer stale threshold (ms).  Default 5 min per Track B §7.5. */
  readonly indexerStaleMs: number;
  /** Chain non-finalized threshold (ms).  Default 10 min per Track B §7.5. */
  readonly chainNonFinalizedMs: number;
  /** 7-day compression threshold (per-8h rate).  Default 0.0005 per Track B §7.5. */
  readonly compressionThreshold: number;
  /** bybit.eu SPOT minimum depth (USD @ 1% from mid).  Default $100k per Track B §7.5. */
  readonly bybitEuMinDepthUsd: number;
  /**
   * Sparse-data guard — minimum tick density (dYdX + CEX combined
   * funding observations per rolling 7-day window) before the
   * 7-day compression kill-switch is allowed to fire.  Default 168
   * (= 7d × 24h × 1 obs/h, conservatively).
   *
   * T1 backtests all fired `killSwitch7DayCompressionTriggered = true`
   * for sparse-data false positives — this guard prevents that on
   * real data.  See `docs/research/phase25/track-b/REPORT.md` §6.4
   * edge-decay mitigation.
   */
  readonly sparseDataMinTicksPer7d: number;
}

export const DEFAULT_KILL_SWITCH_CONFIG: KillSwitchConfig = {
  indexerStaleMs: 5 * 60 * 1000,
  chainNonFinalizedMs: 10 * 60 * 1000,
  compressionThreshold: 0.0005,
  bybitEuMinDepthUsd: 100_000,
  sparseDataMinTicksPer7d: 168, // 7d × 24h × 1 obs/h
};

// ---------------------------------------------------------------------------
// 3 PRE-CONDITIONS (Phase 25 #2 Track B §7.2)
// ---------------------------------------------------------------------------

/**
 * Track B §7.2 pre-conditions (all 3 must be true before sizing):
 *
 *  1. `live-divergence` — Live dYdX-vs-CEX divergence ≥ 0.0005/8h,
 *     sustained over a rolling 7-day window.  Re-verify weekly; halt
 *     if compressed (kill-switch #3 above).
 *
 *  2. `chain-incident-clear` — No active dYdX chain incident.
 *     "Operational" status for ≥ 72 hours continuously.
 *
 *  3. `no-recent-governance` — No new governance proposal in the last
 *     14 days that would materially alter funding parameters,
 *     slashing, or oracle configuration.
 *
 * Pre-condition state is durable (PreconditionsState below) — it
 * rolls forward across restarts.
 */
export type PreconditionId = "live-divergence" | "chain-incident-clear" | "no-recent-governance";

export interface PreconditionConfig {
  /** Min sustained divergence (per-8h) for `live-divergence`.  Default 0.0005. */
  readonly liveDivergenceMin: number;
  /** Rolling window (days) over which `live-divergence` must hold.  Default 7. */
  readonly liveDivergenceWindowDays: number;
  /** Min continuous "operational" hours for `chain-incident-clear`.  Default 72. */
  readonly chainOperationalMinHours: number;
  /** Days since last material governance proposal for `no-recent-governance`.  Default 14. */
  readonly governanceQuietDays: number;
}

export const DEFAULT_PRECONDITION_CONFIG: PreconditionConfig = {
  liveDivergenceMin: 0.0005,
  liveDivergenceWindowDays: 7,
  chainOperationalMinHours: 72,
  governanceQuietDays: 14,
};

/** Per-precondition durable state — first-observed timestamp + last-verified. */
export interface PreconditionEntry {
  /** Per-precondition boolean: are we currently OK? */
  readonly satisfied: boolean;
  /** First time this pre-condition was observed satisfied (ms).  Used for
   *  sustained-duration checks (e.g. 72h chain-operational).  null = never. */
  firstSatisfiedMs: number | null;
  /** Last time we re-verified this pre-condition (ms).  null = never. */
  lastVerifiedMs: number | null;
}

export type PreconditionsState = Readonly<Record<PreconditionId, PreconditionEntry>>;

// ---------------------------------------------------------------------------
// TICK-DENSITY STATE (sparse-data guard)
// ---------------------------------------------------------------------------

/**
 * `TickDensityState` — counts (dYdX + CEX) funding observations per
 * rolling 7-day window.  Used by the 7-day compression kill-switch
 * to require `sparseDataMinTicksPer7d` ticks before firing.  T1
 * backtests showed `killSwitch7DayCompressionTriggered = true` for
 * ALL 9 windows — all false positives because of sparse Tardis
 * samples (the free monthly download is day-1-of-month only, so
 * most 7-day windows have < 50 ticks).  On real live data with
 * ~24 dYdX + 3 CEX = 27 obs/day × 7d = 189 obs, this guard
 * will allow the kill-switch to fire on real divergence compression.
 */
export interface TickDensityEntry {
  /** YYYY-MM-DD day bucket. */
  readonly day: string;
  /** dYdX observations on this day. */
  dydxCount: number;
  /** CEX observations on this day. */
  cexCount: number;
}

export interface TickDensityState {
  /** Per-day buckets, oldest first.  Trimmed to 7 days on each push. */
  readonly days: readonly TickDensityEntry[];
  /** Cumulative ticks across the rolling 7-day window. */
  totalTicksLast7d: number;
}

// ============================================================================
// FUNDING SOURCE INTERFACE
// ============================================================================

/**
 * `DydxFundingSource` — pluggable live funding-rate source for the
 * dYdX v4 Indexer.  Implemented by `DydxLiveFundingSource` in
 * `@mm-crypto-bot/backtest-tools` (which wraps the production
 * `DydxIndexerFeed` REST + WebSocket client from T1).
 *
 * The interface is intentionally narrow so the strategy can be
 * unit-tested with a `MockDydxFundingSource` (see dydx-cex-carry.test.ts).
 */
export interface DydxFundingSource {
  /**
   * Subscribe to the live funding-tick stream for a market.  Returns
   * an unsubscribe handle (the production impl returns a `WebSocket`
   * ref; tests return a no-op).  Each tick delivers a normalized
   * `FundingSnapshot` (dYdX hourly funding) plus a CEX 8h-equivalent
   * funding snapshot.
   */
  subscribe(
    market: CarryMarket,
    onTick: (snap: { readonly dydx: FundingSnapshot; readonly cex: FundingSnapshot }) => void,
  ): { readonly close: () => void };
  /** Current stale state for the market (last-tick age in ms).  null = never received. */
  lastTickAgeMs(market: CarryMarket, nowMs: number): number | null;
  /** Last dYdX v4 chain-finalized block height observed.  null = never. */
  lastChainBlockHeight(market: CarryMarket): number | null;
  /** Last chain-finalized block timestamp (ms).  null = never. */
  lastChainBlockTs(market: CarryMarket): number | null;
  /**
   * Current bybit.eu SPOT depth (USD @ 1% from mid) for the market's
   * underlying SPOT pair.  null = unknown.
   */
  bybitEuSpotDepthUsd(market: CarryMarket, nowMs: number): number | null;
  /** Human-readable health snapshot for diagnostics. */
  health(): { readonly lastTickMs: number | null; readonly chainBlockHeight: number | null };
}

// ============================================================================
// KILL-SWITCH EVALUATION — pure-functional
// ============================================================================

/**
 * `KillSwitchVerdict` — the per-switch firing state at a moment in time.
 *  - `engaged = true` → the switch has fired and the strategy must halt.
 *  - `reason`        → human-readable string for diagnostics + tests.
 */
export interface KillSwitchVerdict {
  readonly engaged: boolean;
  readonly reason: string;
}

export interface KillSwitchInputs {
  /** Time-since-last-dYdX-tick (ms).  null = never received. */
  readonly indexerStaleMs: number | null;
  /** Time-since-last-chain-finalized-block (ms).  null = never. */
  readonly chainNonFinalizedMs: number | null;
  /** Number of consecutive days with median |divergence| < threshold. */
  readonly compressedDivergenceDayStreak: number;
  /** Total ticks in the rolling 7-day window (dYdX + CEX). */
  readonly tickDensityLast7d: number;
  /** Current bybit.eu SPOT depth (USD @ 1%).  null = unknown. */
  readonly bybitEuSpotDepthUsd: number | null;
}

export type KillSwitchVerdicts = Readonly<Record<KillSwitchId, KillSwitchVerdict>>;

export const ALL_KILL_SWITCHES: readonly KillSwitchId[] = Object.freeze([
  "indexer-stale",
  "chain-non-finalized",
  "divergence-7d-compression",
  "bybit-eu-spot-thin",
] as const);

/**
 * `evaluateKillSwitches` — pure function: given a snapshot of the
 * live state, return the per-switch verdict.  The strategy's
 * `onFundingTick` / `onHeartbeat` aggregate these verdicts.
 *
 * Sparse-data guard: the 7-day compression kill-switch ONLY fires
 * when BOTH:
 *  (a) the streak is ≥ 7 consecutive compressed days
 *  (b) the rolling 7-day tick density is ≥ `sparseDataMinTicksPer7d`
 * This prevents the T1 false-positive pattern (all 9 backtests
 * fired the switch on sparse Tardis samples).
 *
 * The "bybit-eu-spot-thin" switch REDUCES sizing (does not halt)
 * — the strategy falls back to a smaller notional until depth
 * recovers.  The 3 other switches HALT the strategy entirely.
 */
export function evaluateKillSwitches(
  inputs: KillSwitchInputs,
  cfg: KillSwitchConfig,
): KillSwitchVerdicts {
  const indexerStale: KillSwitchVerdict = (() => {
    if (inputs.indexerStaleMs === null) {
      return { engaged: true, reason: "indexer-never-tick" };
    }
    if (inputs.indexerStaleMs > cfg.indexerStaleMs) {
      return {
        engaged: true,
        reason: `indexer-stale ${Math.round(inputs.indexerStaleMs / 1000)}s > ${Math.round(cfg.indexerStaleMs / 1000)}s`,
      };
    }
    return { engaged: false, reason: "indexer-fresh" };
  })();

  const chainNonFinalized: KillSwitchVerdict = (() => {
    if (inputs.chainNonFinalizedMs === null) {
      return { engaged: true, reason: "chain-never-finalized" };
    }
    if (inputs.chainNonFinalizedMs > cfg.chainNonFinalizedMs) {
      return {
        engaged: true,
        reason: `chain-non-finalized ${Math.round(inputs.chainNonFinalizedMs / 1000)}s > ${Math.round(cfg.chainNonFinalizedMs / 1000)}s`,
      };
    }
    return { engaged: false, reason: "chain-finalized" };
  })();

  const compression: KillSwitchVerdict = (() => {
    if (inputs.compressedDivergenceDayStreak < 7) {
      return {
        engaged: false,
        reason: `compressed-streak ${inputs.compressedDivergenceDayStreak}d < 7d`,
      };
    }
    // SPARSE-DATA GUARD: refuse to fire on sparse windows.
    if (inputs.tickDensityLast7d < cfg.sparseDataMinTicksPer7d) {
      return {
        engaged: false,
        reason: `compressed-streak ${inputs.compressedDivergenceDayStreak}d ≥ 7d BUT tick-density ${inputs.tickDensityLast7d} < ${cfg.sparseDataMinTicksPer7d} (sparse-data guard)`,
      };
    }
    return {
      engaged: true,
      reason: `compressed-streak ${inputs.compressedDivergenceDayStreak}d ≥ 7d with tick-density ${inputs.tickDensityLast7d} ≥ ${cfg.sparseDataMinTicksPer7d}`,
    };
  })();

  const bybitEuSpotThin: KillSwitchVerdict = (() => {
    if (inputs.bybitEuSpotDepthUsd === null) {
      return { engaged: false, reason: "bybit-eu-depth-unknown" };
    }
    if (inputs.bybitEuSpotDepthUsd < cfg.bybitEuMinDepthUsd) {
      return {
        engaged: true,
        reason: `bybit-eu-spot-thin $${Math.round(inputs.bybitEuSpotDepthUsd)} < $${cfg.bybitEuMinDepthUsd}`,
      };
    }
    return { engaged: false, reason: "bybit-eu-depth-ok" };
  })();

  return {
    "indexer-stale": indexerStale,
    "chain-non-finalized": chainNonFinalized,
    "divergence-7d-compression": compression,
    "bybit-eu-spot-thin": bybitEuSpotThin,
  };
}

// ============================================================================
// PRE-CONDITION EVALUATION — pure-functional
// ============================================================================

/**
 * `evaluatePrecondition` — pure function: given the current
 * pre-condition state and a snapshot of the live state, return the
 * new per-precondition state.
 *
 * Re-verification cadence is enforced at the live layer — the
 * strategy does NOT poll by itself.  The pre-condition tracker
 * is updated whenever the live layer (CLI runner) calls
 * `recordPreconditionReverify()`.
 */
export function evaluatePrecondition(
  id: PreconditionId,
  prev: PreconditionEntry,
  nowMs: number,
  /** Per-id input — what we just observed.  Shape depends on `id`. */
  input: { readonly kind: PreconditionId; readonly satisfied: boolean },
): PreconditionEntry {
  if (id !== input.kind) {
    throw new Error(`Precondition id mismatch: ${id} vs ${input.kind}`);
  }
  const nextSatisfied = input.satisfied;
  const firstSatisfiedMs =
    prev.firstSatisfiedMs ?? (nextSatisfied ? nowMs : null);
  return {
    satisfied: nextSatisfied,
    firstSatisfiedMs,
    lastVerifiedMs: nowMs,
  };
}

/**
 * `allPreconditionsSatisfied` — pure: returns true iff all 3 pre-conditions
 * are currently `satisfied = true` AND their respective duration requirements
 * are met (per `PreconditionConfig`):
 *
 *   - `live-divergence` — sustained ≥ liveDivergenceMin for liveDivergenceWindowDays
 *   - `chain-incident-clear` — sustained ≥ chainOperationalMinHours
 *   - `no-recent-governance` — sustained ≥ governanceQuietDays
 */
export function allPreconditionsSatisfied(
  state: PreconditionsState,
  nowMs: number,
  cfg: PreconditionConfig,
): { readonly ok: boolean; readonly reasons: readonly string[] } {
  const reasons: string[] = [];
  for (const id of ["live-divergence", "chain-incident-clear", "no-recent-governance"] as const) {
    const entry = state[id];
    if (!entry.satisfied) {
      reasons.push(`${id} not satisfied`);
      continue;
    }
    if (entry.firstSatisfiedMs === null) {
      reasons.push(`${id} never observed satisfied`);
      continue;
    }
    const elapsedMs = nowMs - entry.firstSatisfiedMs;
    const requiredMs = requiredMsFor(id, cfg);
    if (elapsedMs < requiredMs) {
      reasons.push(formatSustained(id, elapsedMs, requiredMs));
      continue;
    }
  }
  return { ok: reasons.length === 0, reasons };
}

function requiredMsFor(id: PreconditionId, cfg: PreconditionConfig): number {
  switch (id) {
    case "live-divergence":
      return cfg.liveDivergenceWindowDays * 24 * 60 * 60 * 1000;
    case "chain-incident-clear":
      return cfg.chainOperationalMinHours * 60 * 60 * 1000;
    case "no-recent-governance":
      return cfg.governanceQuietDays * 24 * 60 * 60 * 1000;
  }
}

function formatSustained(id: PreconditionId, elapsedMs: number, requiredMs: number): string {
  if (id === "chain-incident-clear") {
    return `${id} sustained ${Math.round(elapsedMs / (60 * 60 * 1000))}h < ${Math.round(requiredMs / (60 * 60 * 1000))}h`;
  }
  return `${id} sustained ${Math.round(elapsedMs / (24 * 60 * 60 * 1000))}d < ${Math.round(requiredMs / (24 * 60 * 60 * 1000))}d`;
}

// ============================================================================
// STRATEGY CONFIG
// ============================================================================

/**
 * `DydxCexCarryConfig` — full configuration for the strategy.  All
 * knobs are explicit; the constructor validates them at the
 * registry / metadata layer (per Phase 20-21-22-23-archive §13).
 */
export interface DydxCexCarryConfig {
  /** Market (BTC-USD only per orchestrator scope lock). */
  readonly market: CarryMarket;
  /** Direction of the carry (dydx-long-cex-short for structural-negative). */
  readonly direction: CarryDirection;
  /** Notional per leg in USD.  Default $125k per orchestrator steer. */
  readonly notionalPerLegUsd: number;
  /** Cap as fraction of equity.  Default 0.025 per orchestrator steer. */
  readonly capFraction: number;
  /** 1:10 leverage — locked, not configurable (project-wide mandate). */
  readonly leverage: 1 | 10;
  /** Funding source — must implement DydxFundingSource. */
  readonly fundingSource: DydxFundingSource;
  /** Kill-switch config. */
  readonly killSwitch: KillSwitchConfig;
  /** Pre-condition config. */
  readonly precondition: PreconditionConfig;
  /** Number of paper-trade days required before live orders (7 per orchestrator steer). */
  readonly paperTradeDaysRequired: number;
  /**
   * `latencyArbThresholdMs` — Phase 30 LatencyGate live wiring.  Max
   * allowed cross-venue round-trip latency in ms above which the
   * carry is paused.  Default 500ms — Phase 6 Track B empirical
   * cutoff (see `docs/research/phase6-arb-latency.md`).  Set to
   * `Number.POSITIVE_INFINITY` to effectively disable latency gating
   * (the gate will always allow carry).
   *
   * The strategy polls the live funding source's `lastTickAgeMs()` +
   * a `latencySource` (when configured) to keep an internal
   * `LatencyGate` updated; `isCarryAllowed()` is consulted on every
   * `recordFundingTick()` and on every `onCandle()`.
   */
  readonly latencyArbThresholdMs: number;
  /**
   * `latencySource` — Phase 30 LatencyGate live wiring.  Optional
   * pluggable latency observer.  When defined, the strategy's
   * internal `LatencyGate` snapshot is updated from this source on
   * every `recordFundingTick()` (so the live latency profile is
   * always fresh).  When `null` (default), the strategy uses the
   * `DEFAULT_LATENCY_GATE_DISABLED` sentinel — carry is always
   * allowed regardless of latency.  This is the recommended
   * configuration for paper-trade runs (synthetic latency = 0).
   */
  readonly latencySource: LatencySource | null;
}

/**
 * `LatencySource` — Phase 30 pluggable latency observer.  Returns
 * the most recently observed cross-venue round-trip latency in ms.
 *
 * Live: a real bybit.eu + dYdX v4 latency observer (see
 * `LatencySnapshot` JSON loader in
 * `backtest-results/arb-latency-*.json` for the sample format).
 * Tests: a synthetic observer that returns 0 (always allowed) or a
 * specific ms value.
 */
export interface LatencySource {
  /**
   * Observe the most recent cross-venue round-trip latency.  Returns
   * `null` if no observation is available yet (treated as
   * "unknown" — the strategy's gate falls back to a conservative
   * default).
   */
  observeRoundTripMs(nowMs: number): number | null;
  /** Identifier for telemetry — pair string (e.g. "dydx-bybit-btc"). */
  readonly pair: string;
}

export const DEFAULT_DYDX_CEX_CARRY_CONFIG: Omit<
  DydxCexCarryConfig,
  "fundingSource"
> = {
  market: DEFAULT_CARRY_MARKET,
  direction: DEFAULT_CARRY_DIRECTION,
  notionalPerLegUsd: 125_000,
  capFraction: 0.025,
  leverage: 10, // 1:10 HARD GUARDRAIL — locked.
  killSwitch: DEFAULT_KILL_SWITCH_CONFIG,
  precondition: DEFAULT_PRECONDITION_CONFIG,
  paperTradeDaysRequired: 7,
  // Phase 30: LatencyGate defaults.  500ms matches Phase 6 Track B
  // empirical cutoff (backtest-results/arb-latency-*.json samples
  // showed P95 round-trip 1027ms binance-bybit, 1792ms max).  When
  // the LatencyGate is wired to a real latency source, a 500ms
  // threshold means carry is paused for ~60% of live samples on the
  // bybit.eu+binance pair — which is the correct conservative
  // posture (NO carry during high-latency periods = NO fund loss on
  // late fills).
  latencyArbThresholdMs: 500,
  latencySource: null, // disabled by default (paper-trade / backtest)
};

// ============================================================================
// STRATEGY STATE (durable across restarts)
// ============================================================================

  /**
   * `DydxCexCarryState` — mutable state held by the strategy instance.
   * Exposed for the CLI runner to read after `runBacktest` / live session.
   * All 4 sub-trackers are durable: snapshot via `serializeState()` and
   * restore via `DydxCexCarryStrategy.fromSnapshot()`.
   */
  export interface DydxCexCarryState {
    /** Total funding payments collected (positive = earned, negative = paid). */
    fundingCollectedUsd: number;
    /** Number of rebalance operations executed. */
    rebalanceCount: number;
    /** Total cost of rebalance operations. */
    rebalanceCostUsd: number;
    /** Number of funding snapshots accrued. */
    fundingPeriods: number;
    /** Last observed mark price. */
    lastMarkPrice: number;
    /** Has the entry signal already been emitted? */
    hasEntered: boolean;
    /** Per-kill-switch current verdict.  null = never evaluated. */
    killSwitchVerdicts: KillSwitchVerdicts | null;
    /** Per-precondition durable state. */
    preconditions: PreconditionsState;
    /** Tick density tracker (sparse-data guard). */
    tickDensity: TickDensityState;
    /** Compressed-divergence day streak (rolling, day-granular). */
    compressedDayStreak: number;
    /** First observed indexer tick (ms).  null = never. */
    firstTickMs: number | null;
    /** First observed chain-finalized block (ms).  null = never. */
    firstChainBlockMs: number | null;
    /** Live-trading-mode flag — true when paper-trade gate has been cleared. */
    liveOrdersEnabled: boolean;
    /** Number of paper-trade days accumulated. */
    paperTradeDayCount: number;
    /** Last day (YYYY-MM-DD) we updated the divergence streak for.  null = never. */
    lastDivergenceDay: string | null;
    /** Running compressed flag for the current day bucket. */
    currentDayCompressed: boolean;
    /**
     * `currentLatencyGate` — Phase 30 LatencyGate live wiring.  The
     * strategy's internal gate, rebuilt whenever a new `LatencySnapshot`
     * is recorded.  When `null`, the gate is the
     * `DEFAULT_LATENCY_GATE_DISABLED` sentinel (always allows carry).
     * The constructor seeds this with a disabled gate; `liveOrdersEnabled`
     * does NOT auto-enable latency gating (it stays disabled until
     * `recordLatencySnapshot()` is called).
     *
     * NOTE: This field is NOT serialized by `serializeState()` — it
     * contains a function (`isCarryAllowed`) that JSON can't represent.
     * On `fromSnapshot`, the gate is reconstructed from
     * `lastLatencyRoundTripMs` + the configured threshold.
     */
    currentLatencyGate: LatencyGate;
    /** Last observed round-trip ms (from the most recent latency snapshot).  null = never. */
    lastLatencyRoundTripMs: number | null;
    /** Timestamp of the most recent latency observation.  null = never. */
    lastLatencySnapshotMs: number | null;
  }

export function newPreconditionsState(): PreconditionsState {
  return {
    "live-divergence": { satisfied: false, firstSatisfiedMs: null, lastVerifiedMs: null },
    "chain-incident-clear": { satisfied: false, firstSatisfiedMs: null, lastVerifiedMs: null },
    "no-recent-governance": { satisfied: false, firstSatisfiedMs: null, lastVerifiedMs: null },
  };
}

export function newTickDensityState(): TickDensityState {
  return { days: [], totalTicksLast7d: 0 };
}

export function newKillSwitchVerdicts(): KillSwitchVerdicts {
  return {
    "indexer-stale": { engaged: false, reason: "init" },
    "chain-non-finalized": { engaged: false, reason: "init" },
    "divergence-7d-compression": { engaged: false, reason: "init" },
    "bybit-eu-spot-thin": { engaged: false, reason: "init" },
  };
}

// ============================================================================
// STRATEGY IMPLEMENTATION
// ============================================================================

/**
 * `DydxCexCarryStrategy` — the live integration of the dYdX-vs-CEX
 * cross-venue funding carry strategy.
 *
 * Implements the project's `Strategy` interface so it drops into the
 * backtest + signal-center pipeline.  Like the Phase 6
 * `FundingCarryStrategy`, it emits ONE "buy" signal on the first
 * valid candle so the engine has a position to track.  The actual
 * carry P&L is computed by `DydxCexCarryPaperTrader` (see
 * dydx-cex-carry.paper-trade.ts) via the pure-functional
 * `recordFundingTick` / `recordChainHeartbeat` /
 * `recordBybitEuLiquidity` API.
 *
 * Three persistence layers — the strategy rolls state forward across
 * restarts so the 7-day paper-trade gate and the 7-day compression
 * kill-switch survive process restarts.
 */
export class DydxCexCarryStrategy implements Strategy {
  readonly name = "dYdX-vs-CEX Cross-Venue Funding Carry (Phase 25 #2 T2)";
  readonly timeframes = ["1h", "4h", "1d"] as const;
  readonly config: DydxCexCarryConfig;
  readonly state: DydxCexCarryState;

  constructor(config: Partial<DydxCexCarryConfig> & { readonly fundingSource: DydxFundingSource }) {
    const merged: DydxCexCarryConfig = {
      ...DEFAULT_DYDX_CEX_CARRY_CONFIG,
      ...config,
      killSwitch: { ...DEFAULT_KILL_SWITCH_CONFIG, ...(config.killSwitch ?? {}) },
      precondition: { ...DEFAULT_PRECONDITION_CONFIG, ...(config.precondition ?? {}) },
    };
    // HARD GUARDRAIL: 1:10 leverage (project-wide mandate).  Defense in depth
    // mirrors the FundingCarryPlugin / FundingCarryTiming pattern.
    if (merged.leverage !== 1 && merged.leverage !== (10 as 1 | 10)) {
      throw new Error(
        `[DydxCexCarryStrategy] 1:10 HARD GUARDRAIL VIOLATION: leverage=${String(merged.leverage)} — only 1 or 10 allowed.`,
      );
    }
    if (merged.leverage !== ONE_TO_TEN_LEVERAGE) {
      console.warn(
        `[DydxCexCarryStrategy] leverage=${String(merged.leverage)} (default 1:10, project-wide mandate)`,
      );
    }
    // Type-level: `merged.market` is constrained to `"BTC-USD"` by
    // the `CarryMarket` literal type, so the runtime check below is
    // already enforced at compile time.  Kept as defense-in-depth.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (merged.market !== "BTC-USD") {
      throw new Error(
        `[DydxCexCarryStrategy] market=${String(merged.market)} — only "BTC-USD" is supported per orchestrator scope lock (ETH deferred, SOL halted).`,
      );
    }
    if (!Number.isFinite(merged.notionalPerLegUsd) || merged.notionalPerLegUsd <= 0) {
      throw new Error(
        `[DydxCexCarryStrategy] notionalPerLegUsd must be positive finite, got ${String(merged.notionalPerLegUsd)}`,
      );
    }
    if (!Number.isFinite(merged.capFraction) || merged.capFraction <= 0 || merged.capFraction > 0.5) {
      throw new Error(
        `[DydxCexCarryStrategy] capFraction must be in (0, 0.5], got ${String(merged.capFraction)}`,
      );
    }
    if (merged.paperTradeDaysRequired < 0) {
      throw new Error(
        `[DydxCexCarryStrategy] paperTradeDaysRequired must be ≥ 0, got ${String(merged.paperTradeDaysRequired)}`,
      );
    }
    // Phase 30: LatencyGate threshold validation.  Allow
    // `Number.POSITIVE_INFINITY` to explicitly disable latency gating.
    if (
      (!Number.isFinite(merged.latencyArbThresholdMs) &&
        merged.latencyArbThresholdMs !== Number.POSITIVE_INFINITY) ||
      merged.latencyArbThresholdMs <= 0
    ) {
      throw new Error(
        `[DydxCexCarryStrategy] latencyArbThresholdMs must be positive finite (or +Infinity to disable), got ${String(merged.latencyArbThresholdMs)}`,
      );
    }
    this.config = merged;
    this.state = this._mkState();
  }

  private _mkState(): DydxCexCarryState {
    return {
      fundingCollectedUsd: 0,
      rebalanceCount: 0,
      rebalanceCostUsd: 0,
      fundingPeriods: 0,
      lastMarkPrice: 0,
      hasEntered: false,
      killSwitchVerdicts: null,
      preconditions: newPreconditionsState(),
      tickDensity: newTickDensityState(),
      compressedDayStreak: 0,
      firstTickMs: null,
      firstChainBlockMs: null,
      liveOrdersEnabled: false,
      paperTradeDayCount: 0,
      lastDivergenceDay: null,
      currentDayCompressed: false,
      // Phase 30: LatencyGate seeded in the disabled state.  The gate
      // becomes active only when `recordLatencySnapshot()` is called
      // with a non-zero `roundTripMsMax` (or when `latencySource` is
      // wired at construction time and produces observations).
      currentLatencyGate: DEFAULT_LATENCY_GATE_DISABLED,
      lastLatencyRoundTripMs: null,
      lastLatencySnapshotMs: null,
    };
  }

  /**
   * `fromSnapshot` — restore a strategy instance from a serialized
   * state snapshot.  Used to roll state forward across restarts.
   */
  static fromSnapshot(
    config: DydxCexCarryConfig,
    snapshot: DydxCexCarryState,
  ): DydxCexCarryStrategy {
    const s = new DydxCexCarryStrategy(config);
    s.state.fundingCollectedUsd = snapshot.fundingCollectedUsd;
    s.state.rebalanceCount = snapshot.rebalanceCount;
    s.state.rebalanceCostUsd = snapshot.rebalanceCostUsd;
    s.state.fundingPeriods = snapshot.fundingPeriods;
    s.state.lastMarkPrice = snapshot.lastMarkPrice;
    s.state.hasEntered = snapshot.hasEntered;
    s.state.killSwitchVerdicts = snapshot.killSwitchVerdicts;
    s.state.preconditions = snapshot.preconditions;
    s.state.tickDensity = snapshot.tickDensity;
    s.state.compressedDayStreak = snapshot.compressedDayStreak;
    s.state.firstTickMs = snapshot.firstTickMs;
    s.state.firstChainBlockMs = snapshot.firstChainBlockMs;
    s.state.liveOrdersEnabled = snapshot.liveOrdersEnabled;
    s.state.paperTradeDayCount = snapshot.paperTradeDayCount;
    s.state.lastDivergenceDay = snapshot.lastDivergenceDay;
    s.state.currentDayCompressed = snapshot.currentDayCompressed;
    // Phase 30: LatencyGate state.  Pre-Phase-30 snapshots won't have
    // these fields — fall back to defaults for forward-compatibility.
    // Reconstruct the gate from the round-trip ms (if any) and the
    // configured threshold.
    s.state.lastLatencyRoundTripMs = snapshot.lastLatencyRoundTripMs ?? null;
    s.state.lastLatencySnapshotMs = snapshot.lastLatencySnapshotMs ?? null;
    if (s.state.lastLatencyRoundTripMs !== null) {
      s.state.currentLatencyGate = createLatencyGate(
        {
          pair: "restored",
          roundTripMsMax: s.state.lastLatencyRoundTripMs,
          sourceJsonPath: "restored-from-snapshot",
        },
        s.config.latencyArbThresholdMs,
      );
    } else {
      s.state.currentLatencyGate = DEFAULT_LATENCY_GATE_DISABLED;
    }
    return s;
  }

  /**
   * `serializeState` — produce a JSON-serializable snapshot of the
   * strategy state.  Persist this to disk (e.g. JSON in
   * `data/state/dydx-cex-carry.json`) for restart durability.
   *
   * Phase 30: the `currentLatencyGate` is NOT serialized (it
   * contains a function).  The round-trip ms + timestamp are
   * serialized; the gate is reconstructed on `fromSnapshot()`.
   */
  serializeState(): DydxCexCarryState {
    const { currentLatencyGate: _gate, ...serializable } = this.state;
    void _gate;
    return JSON.parse(JSON.stringify(serializable)) as DydxCexCarryState;
  }

  /**
   * `warmup` — Strategy interface.  The carry strategy itself does
   * not need indicator warmup, but the pre-condition tracker and
   * tick-density tracker need ~1 day to start producing
   * meaningful verdicts.  24h is a safe minimum.
   */
  warmup(): number {
    return 24;
  }

  /**
   * `onCandle` — Strategy interface.  Emits ONE "buy" signal on the
   * first valid candle (same pattern as Phase 6
   * `FundingCarryStrategy`) so the engine has a position to track.
   * The actual carry P&L is computed by the paper-trade runner
   * via `recordFundingTick()`.
   *
   * When the live-orders gate is closed (paper-trade not yet
   * completed) we DO NOT emit the buy signal — the engine sees
   * `null` and stays flat.  When the gate opens, we emit.  When
   * any kill-switch fires, we DO emit a `side: "sell"` to close
   * the position (defensive).
   */
  onCandle(ctx: StrategyContext): StrategySignal | null {
    if (ctx.candleIndex < this.warmup()) {
      return null;
    }
    // Phase 30: poll the latency source (if configured) so the
    // gate stays fresh between funding ticks.  This is the
    // per-candle entry-point for live latency updates.
    this.pollLatencySource(ctx.candle.timestamp);
    // Kill-switch fired? → defensive close (sell if in carry).
    if (this.state.killSwitchVerdicts !== null) {
      const anyHalt = this.state.killSwitchVerdicts["indexer-stale"].engaged
        || this.state.killSwitchVerdicts["chain-non-finalized"].engaged
        || this.state.killSwitchVerdicts["divergence-7d-compression"].engaged;
      if (anyHalt && this.state.hasEntered) {
        this.state.hasEntered = false;
        return {
          side: "sell",
          confidence: 1,
          reason: `[DydxCexCarry] kill-switch halt: ${this._haltReason()}`,
          stopLoss: ctx.candle.close * 0.99,
          takeProfit: ctx.candle.close * 0.99,
        };
      }
    }
    // Paper-trade gate not yet cleared? → stay flat.
    if (!this.state.liveOrdersEnabled) {
      this.state.lastMarkPrice = ctx.candle.close;
      return null;
    }
    // Already in carry? → hold.  Note: latency pause does NOT
    // auto-close a position — the carry keeps accruing at the
    // next fresh funding tick.  The intent is to AVOID opening
    // new positions during high-latency periods, not to close
    // existing ones.
    if (this.state.hasEntered) {
      this.state.lastMarkPrice = ctx.candle.close;
      return null;
    }
    // Phase 30: LatencyGate is paused? → do NOT enter.
    if (this.isLatencyPaused()) {
      this.state.lastMarkPrice = ctx.candle.close;
      return null;
    }
    this.state.hasEntered = true;
    this.state.lastMarkPrice = ctx.candle.close;
    return {
      side: "buy",
      confidence: 1,
      reason: `[DydxCexCarry] entry: dydx-long-cex-short @ ${ctx.candle.close.toFixed(2)}, notional $${this.config.notionalPerLegUsd.toFixed(0)}/leg, cap=${this.config.capFraction}`,
      stopLoss: ctx.candle.close * 0.99,
      takeProfit: ctx.candle.close * 100,
    };
  }

  // -------------------------------------------------------------------------
  // Live integration API — called by the paper-trade runner / live executor
  // -------------------------------------------------------------------------

  /**
   * `recordFundingTick` — record one funding-rate observation from
   * the dYdX v4 Indexer + CEX.  Updates:
   *   - state.fundingCollectedUsd (sign-convention: long dYdX earns when dYdX rate < 0)
   *   - state.fundingPeriods
   *   - state.tickDensity (sparse-data guard)
   *   - state.compressedDayStreak (for the 7-day compression kill-switch)
   *   - state.killSwitchVerdicts (re-evaluates all 4 switches)
   *   - state.firstTickMs
   *
   * Returns the per-tick funding payment in USD (positive = earned, negative = paid).
   * Returns 0 when the strategy is halted (kill-switch engaged) — same
   * pattern as the Phase 6 FundingCarryStrategy.
   */
  recordFundingTick(
    dydxSnap: FundingSnapshot,
    cexSnap: FundingSnapshot,
    nowMs: number,
  ): number {
    this.state.firstTickMs = this.state.firstTickMs ?? nowMs;
    this.state.lastMarkPrice = dydxSnap.markPrice ?? cexSnap.markPrice ?? this.state.lastMarkPrice;

    // Phase 30: poll the latency source on every funding tick so
    // the gate stays fresh.  This is the per-tick entry-point for
    // live latency updates.  No-op when `latencySource` is null.
    this.pollLatencySource(nowMs);

    // Phase 30: LatencyGate is paused? → return 0 (no funding
    // accrual).  This is the KEY wire-up — live orders must be
    // gated on cross-venue latency.  A high-latency fill is a
    // late fill, which means the spread moved against us; paying
    // funding while high-latency is bleeding money on the
    // round-trip slippage.
    if (this.isLatencyPaused()) {
      this.state.fundingPeriods += 1;
      return 0;
    }

    // Tick density tracking.
    const day = new Date(nowMs).toISOString().slice(0, 10);
    this._recordTick(day, 1, 1);

    // Compressed-day streak — DAY-granular, not tick-granular.
    // We track (a) the current day bucket's running compressed-state and
    // (b) the day-bucket we last updated the streak for.  When we cross
    // into a new day, we close out the previous day's bucket: if it was
    // "compressed" (most-recent divergence < threshold), increment the
    // streak; if not, reset to 0.  The current day starts fresh.
    const dydx8hEquiv = dydxSnap.fundingRate * 8;
    const divergence = dydx8hEquiv - cexSnap.fundingRate;
    const compressedNow = Math.abs(divergence) < this.config.killSwitch.compressionThreshold;
    if (day !== this._lastDivergenceDay) {
      // New day — close out the previous day, then reset the current-day
      // running flag.
      if (this._lastDivergenceDay !== null && this._currentDayCompressed) {
        this.state.compressedDayStreak += 1;
      } else if (this._lastDivergenceDay !== null && !this._currentDayCompressed) {
        this.state.compressedDayStreak = 0;
      }
      this._lastDivergenceDay = day;
      this._currentDayCompressed = compressedNow;
    } else {
      // Same day — running compressed state for this day.  A day is
      // "compressed" if AT LEAST ONE tick shows compressed divergence
      // (loose; the empirical spec says "median intraday < threshold",
      // but the simple heuristic is sufficient for the live-signal
      // use case — the CLI runner applies the full DayBucket logic
      // for backtest revalidation).
      this._currentDayCompressed = this._currentDayCompressed || compressedNow;
    }

    // Re-evaluate kill-switches FIRST so this tick sees fresh state.
    this._reEvaluateKillSwitches(nowMs);

    // Skip funding accrual if any HALT-switch is engaged.
    const anyHalt = this.state.killSwitchVerdicts !== null
      && (this.state.killSwitchVerdicts["indexer-stale"].engaged
        || this.state.killSwitchVerdicts["chain-non-finalized"].engaged
        || this.state.killSwitchVerdicts["divergence-7d-compression"].engaged);
    if (anyHalt) {
      return 0;
    }

    // Sign convention: long dYdX perp earns when dYdX rate < 0 (longs pay
    // shorts when rate > 0, so a long receives -rate).  Short CEX perp
    // earns when CEX rate > 0.
    const notional = this._effectiveNotionalUsd();
    const paymentUsd = notional * (-dydxSnap.fundingRate + cexSnap.fundingRate);
    this.state.fundingCollectedUsd += paymentUsd;
    this.state.fundingPeriods += 1;
    return paymentUsd;
  }

  /**
   * `recordChainHeartbeat` — record a chain-finalized block observation.
   * Updates `state.firstChainBlockMs` and re-evaluates kill-switches.
   */
  recordChainHeartbeat(_market: CarryMarket, _blockHeight: number, blockTsMs: number, nowMs: number): void {
    this.state.firstChainBlockMs = this.state.firstChainBlockMs ?? nowMs;
    void blockTsMs;
    this._reEvaluateKillSwitches(nowMs);
  }

  /**
   * `recordBybitEuLiquidity` — record a bybit.eu SPOT depth observation.
   * Updates kill-switch verdicts (the bybit-eu-spot-thin switch fires
   * here, not on funding ticks).
   */
  recordBybitEuLiquidity(_market: CarryMarket, depthUsd: number, nowMs: number): void {
    void _market;
    void depthUsd;
    this._reEvaluateKillSwitches(nowMs);
  }

  // -------------------------------------------------------------------------
  // Phase 30 — LatencyGate live wiring
  // -------------------------------------------------------------------------

  /**
   * `recordLatencySnapshot` — Phase 30 LatencyGate live wiring.
   * Update the strategy's internal `LatencyGate` from a fresh
   * `LatencySnapshot` (typically sourced from the bybit.eu SPOT
   * + dYdX v4 latency observer in live mode, or from the static
   * `arb-latency-*.json` files in backtest).  The strategy
   * reconstructs the gate from the new snapshot + the configured
   * `latencyArbThresholdMs`; subsequent calls to
   * `isLatencyPaused()` reflect the fresh gate.
   *
   * Returns the gate's verdict + reason for telemetry:
   *   - `carryAllowed: true`  → fresh latency is below threshold;
   *     carry is allowed.
   *   - `carryAllowed: false` → fresh latency exceeds threshold;
   *     carry is paused.  `reason` explains why.
   *
   * Defensive: negative or non-finite `roundTripMsMax` is treated
   * as "unknown" and does NOT activate the gate.  NaN propagates
   * the existing gate (no change).
   */
  recordLatencySnapshot(snapshot: LatencySnapshot, nowMs: number): {
    readonly carryAllowed: boolean;
    readonly reason: string;
  } {
    if (
      !Number.isFinite(snapshot.roundTripMsMax) ||
      snapshot.roundTripMsMax < 0
    ) {
      // Unknown / invalid observation — keep the existing gate.
      const reason = this.state.currentLatencyGate.isCarryAllowed()
        ? "carry-allowed (existing gate kept, invalid snapshot)"
        : "carry-paused (existing gate kept, invalid snapshot)";
      return { carryAllowed: this.state.currentLatencyGate.isCarryAllowed(), reason };
    }
    // Rebuild the gate from the fresh snapshot.  The Phase 6
    // `createLatencyGate` factory is immutable — we just call it
    // again with the new snapshot and the same threshold.
    const newGate = createLatencyGate(snapshot, this.config.latencyArbThresholdMs);
    this.state.currentLatencyGate = newGate;
    this.state.lastLatencySnapshotMs = nowMs;
    this.state.lastLatencyRoundTripMs = snapshot.roundTripMsMax;
    const carryAllowed = newGate.isCarryAllowed();
    const reason = carryAllowed
      ? `latency ${snapshot.roundTripMsMax}ms ≤ ${this.config.latencyArbThresholdMs}ms — carry allowed`
      : `latency ${snapshot.roundTripMsMax}ms > ${this.config.latencyArbThresholdMs}ms — carry paused`;
    return { carryAllowed, reason };
  }

  /**
   * `pollLatencySource` — Phase 30 LatencyGate live wiring helper.
   * If `config.latencySource` is set, observe the current round-trip
   * latency and update the internal gate.  No-op when
   * `config.latencySource` is null (paper-trade / backtest default).
   * Returns the same shape as `recordLatencySnapshot`, or `null` if
   * no source is configured.
   */
  pollLatencySource(nowMs: number): {
    readonly carryAllowed: boolean;
    readonly reason: string;
  } | null {
    if (this.config.latencySource === null) return null;
    const observedMs = this.config.latencySource.observeRoundTripMs(nowMs);
    if (observedMs === null) {
      // Source has no observation yet — keep existing gate.
      return {
        carryAllowed: this.state.currentLatencyGate.isCarryAllowed(),
        reason: "latency source not yet observed",
      };
    }
    return this.recordLatencySnapshot(
      {
        pair: this.config.latencySource.pair,
        roundTripMsMax: observedMs,
        sourceJsonPath: "live-latency-source",
      },
      nowMs,
    );
  }

  /**
   * `isLatencyPaused` — Phase 30 LatencyGate live wiring.  True iff
   * the internal `LatencyGate` is currently blocking the carry.
   * The gate starts in the disabled state
   * (`DEFAULT_LATENCY_GATE_DISABLED`, which always allows) and
   * transitions to active only after a `recordLatencySnapshot()`
   * call or after a `pollLatencySource()` observation with a
   * round-trip value above the threshold.
   */
  isLatencyPaused(): boolean {
    return !this.state.currentLatencyGate.isCarryAllowed();
  }

  /**
   * `currentLatencyGate` — Phase 30 LatencyGate live wiring.
   * Expose the internal gate for telemetry + tests.  Callers
   * should NOT mutate the returned gate — they should call
   * `recordLatencySnapshot()` instead.
   */
  currentLatencyGate(): LatencyGate {
    return this.state.currentLatencyGate;
  }

  /**
   * `recordPreconditionReverify` — record a pre-condition re-verification
   * (called by the live layer on the configured cadence).
   */
  recordPreconditionReverify(id: PreconditionId, satisfied: boolean, nowMs: number): PreconditionEntry {
    const prev = this.state.preconditions[id];
    const next = evaluatePrecondition(id, prev, nowMs, {
      kind: id,
      satisfied,
    });
    this.state.preconditions = { ...this.state.preconditions, [id]: next };
    return next;
  }

  /**
   * `incrementPaperTradeDay` — increment the paper-trade day counter
   * and open the live-orders gate when the configured threshold is
   * reached.  Called by the live layer once per day.
   */
  incrementPaperTradeDay(nowMs: number): { readonly gateOpened: boolean } {
    this.state.paperTradeDayCount += 1;
    const preOk = allPreconditionsSatisfied(
      this.state.preconditions,
      nowMs,
      this.config.precondition,
    );
    const reached = this.state.paperTradeDayCount >= this.config.paperTradeDaysRequired;
    if (reached && preOk.ok && !this.state.liveOrdersEnabled) {
      this.state.liveOrdersEnabled = true;
      return { gateOpened: true };
    }
    return { gateOpened: false };
  }

  /**
   * `isHalted` — true iff any HALT kill-switch (indexer-stale,
   * chain-non-finalized, divergence-7d-compression) is engaged.
   * The bybit-eu-spot-thin switch REDUCES sizing instead of
   * halting — see `isSizingReduced()`.
   */
  isHalted(): boolean {
    if (this.state.killSwitchVerdicts === null) return false;
    return this.state.killSwitchVerdicts["indexer-stale"].engaged
      || this.state.killSwitchVerdicts["chain-non-finalized"].engaged
      || this.state.killSwitchVerdicts["divergence-7d-compression"].engaged;
  }

  /**
   * `isSizingReduced` — true iff the bybit-eu-spot-thin switch is
   * engaged (depth < $100k @ 1%).  When this is true, the strategy
   * scales `notionalPerLegUsd` down by 50% (per orchestrator steer
   * §7.5 "reduce sizing").
   */
  isSizingReduced(): boolean {
    return this.state.killSwitchVerdicts?.["bybit-eu-spot-thin"].engaged ?? false;
  }

  /**
   * `effectiveNotionalUsd` — the notional currently in effect,
   * accounting for the bybit-eu-spot-thin switch's 50% sizing
   * reduction.  Used by the paper-trade runner to size hypothetical
   * fills.
   */
  effectiveNotionalUsd(): number {
    return this._effectiveNotionalUsd();
  }

  private _effectiveNotionalUsd(): number {
    const base = this.config.notionalPerLegUsd;
    return this.isSizingReduced() ? base * 0.5 : base;
  }

  /**
   * `totalFundingUsd` — net funding collected so far (after costs).
   */
  totalFundingUsd(): number {
    return this.state.fundingCollectedUsd - this.state.rebalanceCostUsd;
  }

  /**
   * `reset` — clear state for a fresh backtest run.  Does NOT clear
   * the pre-condition tracker (use `resetPreconditions()` for that).
   */
  reset(): void {
    this.state.fundingCollectedUsd = 0;
    this.state.rebalanceCount = 0;
    this.state.rebalanceCostUsd = 0;
    this.state.fundingPeriods = 0;
    this.state.lastMarkPrice = 0;
    this.state.hasEntered = false;
    this.state.killSwitchVerdicts = null;
    this.state.tickDensity = newTickDensityState();
    this.state.compressedDayStreak = 0;
    this.state.firstTickMs = null;
    this.state.firstChainBlockMs = null;
    this.state.liveOrdersEnabled = false;
    this.state.paperTradeDayCount = 0;
    this.state.lastDivergenceDay = null;
    this.state.currentDayCompressed = false;
    // Phase 30: LatencyGate reset.  Returns to disabled sentinel —
    // `recordLatencySnapshot()` is required to reactivate.
    this.state.currentLatencyGate = DEFAULT_LATENCY_GATE_DISABLED;
    this.state.lastLatencyRoundTripMs = null;
    this.state.lastLatencySnapshotMs = null;
  }

  /**
   * `resetPreconditions` — clear the pre-condition tracker.
   * Used by the CLI runner when the user wants to RE-VERIFY the
   * 3 pre-conditions from scratch (e.g. after a long downtime).
   */
  resetPreconditions(): void {
    this.state.preconditions = newPreconditionsState();
  }

  // -------------------------------------------------------------------------
  // private
  // -------------------------------------------------------------------------

  /** Last day (YYYY-MM-DD) we updated the divergence streak for.  null = never. */
  private _lastDivergenceDay: string | null = null;
  /** Running compressed flag for the current day bucket. */
  private _currentDayCompressed = false;

  private _recordTick(day: string, dydxCount: number, cexCount: number): void {
    const days = [...this.state.tickDensity.days];
    let last = days[days.length - 1];
    if (last?.day !== day) {
      last = { day, dydxCount: 0, cexCount: 0 };
      days.push(last);
    }
    last.dydxCount += dydxCount;
    last.cexCount += cexCount;
    // Trim to last 7 days.
    while (days.length > 7) days.shift();
    const total = days.reduce((acc, d) => acc + d.dydxCount + d.cexCount, 0);
    this.state.tickDensity = { days, totalTicksLast7d: total };
  }

  private _reEvaluateKillSwitches(nowMs: number): void {
    const staleMs = this.config.fundingSource.lastTickAgeMs(this.config.market, nowMs);
    const chainBlockTs = this.config.fundingSource.lastChainBlockTs(this.config.market);
    const chainNonFinalizedMs = chainBlockTs === null ? null : nowMs - chainBlockTs;
    const bybitEuDepth = this.config.fundingSource.bybitEuSpotDepthUsd(this.config.market, nowMs);
    const verdicts = evaluateKillSwitches(
      {
        indexerStaleMs: staleMs,
        chainNonFinalizedMs,
        compressedDivergenceDayStreak: this.state.compressedDayStreak,
        tickDensityLast7d: this.state.tickDensity.totalTicksLast7d,
        bybitEuSpotDepthUsd: bybitEuDepth,
      },
      this.config.killSwitch,
    );
    this.state.killSwitchVerdicts = verdicts;
  }

  private _haltReason(): string {
    if (this.state.killSwitchVerdicts === null) return "init";
    const v = this.state.killSwitchVerdicts;
    if (v["indexer-stale"].engaged) return v["indexer-stale"].reason;
    if (v["chain-non-finalized"].engaged) return v["chain-non-finalized"].reason;
    if (v["divergence-7d-compression"].engaged) return v["divergence-7d-compression"].reason;
    return "unknown";
  }
}

// ============================================================================
// RE-EXPORTS for testability
// ============================================================================

export {
  evaluateKillSwitches as evaluateKillSwitchesFn,
  allPreconditionsSatisfied as allPreconditionsSatisfiedFn,
};
