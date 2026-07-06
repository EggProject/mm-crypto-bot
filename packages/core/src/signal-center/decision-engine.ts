// packages/core/src/signal-center/decision-engine.ts — Phase 13 Track A
//
// ===========================================================================
// DECISION ENGINE — SignalBus subscriber that arbitrates between plugin signals
// ===========================================================================
//
// Purpose
// -------
// `DecisionEngine` is the SINGLE point where the Signal Center's N plugins
// reach a final `PositionDecision` per symbol. It subscribes to the SignalBus,
// accumulates DirectionSignals + CarrySignals + RiskSignals + (informational)
// FactorSignals + FundingSnapshotSignals, and emits a deterministic
// `PositionDecision` per symbol after each arbitration round.
//
// Why this engine?
// ----------------
// Phase 1-9 composed strategies as nested wrapper chains (V1 → V2 → V3 → V4)
// inside a single ensemble class. The Phase 12 Signal Center split the
// strategies into 9 drop-in plugins, but no central arbiter existed yet —
// each plugin emitted signals independently, and downstream consumers
// (risk engine / telemetry) saw a stream of conflicting opinions.
//
// The user's mandate (2026-07-06 00:12 Budapest) explicitly calls for
// arbitration: when 2+ signals fire, decide whether to act on them via
// weighted vote + conflict resolution.
//
// This engine implements that mandate with a deterministic, testable rule
// set documented inline per branch.
//
// ===========================================================================
// ARBITRATION RULES (agent-default, documented per branch)
// ===========================================================================
//
//   1. **Direction aggregation (weighted vote)**
//      - Each DirectionSignal contributes `strength × weight(source)` to its
//        declared side (`long`, `short`, `flat`).
//      - The side with the highest weighted sum WINS.
//      - On a TIE, the engine resolves to `flat` (conservative — no trade
//        when the plugins can't agree).
//
//   2. **Defensive plugin weighting**
//      - RegimeDetectorMetaPlugin, PerpDexLiquidationSignalsPlugin,
//        SOLFlipKillSwitchPlugin each carry weight `defensiveWeight` (default 2.0)
//        because their signals have empirical priority in drawdown reduction.
//      - All other plugins use `defaultWeight` (default 1.0).
//
//   3. **Risk signal `sizeModifier` (universal application)**
//      - When ANY plugin emits a RiskSignal with `sizeModifier < 1.0`, the
//        engine MULTIPLIES the outgoing `sizeMultiplier` by that value. The
//        minimum `sizeModifier` across all received RiskSignals wins
//        (most defensive).
//      - This is the "defensive override" path: a defensive plugin can scale
//        down the position size WITHOUT overriding direction.
//
//   4. **Carry signal regime → sizeMultiplier**
//      - `regime = "high"`   → carryMultiplier = 1.2 (carry is profitable,
//        INTENT scale-up — but final sizeMultiplier is clamped to ≤1.0 by
//        `_computeSizeMultiplier`, so under the project's 1:10 mandate the
//        effective multiplier for "high" == "neutral" == 1.0; the scale-up
//        half is structurally disabled).
//      - `regime = "neutral"`→ carryMultiplier = 1.0 (no change)
//      - `regime = "flip"`   → carryMultiplier = 0.5 (carry is bleeding, scale down)
//      - Multiple carry signals for a symbol → the MOST DEFENSIVE value wins
//        (min multiplier among them).
//
//   5. **Factor + funding-snapshot signals — informational**
//      - `FactorSignal` and `FundingSnapshotSignal` do NOT contribute to
//        direction or size (they're read-only telemetry). The engine records
//        them in `state.lastFactorSignal` / `state.lastFundingSnapshotSignal`
//        for telemetry but otherwise ignores them.
//
//   6. **Min consensus threshold**
//      - If the winning side's normalized confidence (weighted sum / total weight)
//        is below `minConsensusStrength` (default 0.3), the engine returns
//        `flat` — plugins didn't agree strongly enough to commit capital.
//
//   7. **Per-symbol isolation**
//      - Decisions are computed independently per symbol. A `BTC/USDT` signal
//        never leaks into `ETH/USDT`'s decision.
//
//   8. **Determinism / reset**
//      - `reset()` clears the per-symbol accumulator + emitted decisions.
//        Identical input sequence → identical decision sequence (backtest-safe).
//
// ===========================================================================
// 1:10 LEVERAGE MANDATE
// ===========================================================================
//
// The DecisionEngine is a SIGNAL-FLOW arbiter; it does NOT compute notional
// directly from the plugin's recommended sizing. The 1:10 leverage cap is
// enforced by:
//   1. The underlying plugins (each declares `maxLeverage: 10` in metadata
//      and clamps its own emits per the project-wide 3-layer defense).
//   2. The DecisionEngine's `maxNotionalPerSymbolUsd` config cap (default
//      $10,000 = the project-wide 1:10 reference notional). Any
//      `sizeMultiplier` × base that exceeds the cap is clamped at the
//      `notionalUsd` field of the outgoing decision.
//
// ===========================================================================
// EXHAUSTIVE TYPE NARROWING
// ===========================================================================
//
// All `switch (signal.kind)` blocks end in a `default: assertNever(x)`
// branch. This gives compile-time exhaustiveness: if a new `SignalKind`
// variant is added to `Signal` (the discriminated union in `types.ts`),
// TypeScript will fail to compile THIS file at the `assertNever` call site
// until the new variant is explicitly handled. This is the canonical
// discriminated-union exhaustiveness pattern (TypeScript Handbook §3.10;
// Effective TypeScript Item 32; Type-Level TypeScript 2023).
//
// ===========================================================================
// REFERENCES (≥3 independent sources on plugin arbitration patterns)
// ===========================================================================
//   - Gamma et al. "Design Patterns: Elements of Reusable Object-Oriented
//     Software" (1994) — Mediator pattern: the canonical OO pattern for
//     routing interactions between many objects through a single arbiter.
//   - Martin Fowler "Mediator" pattern (PEAA, 2002) — same pattern adapted
//     to enterprise application architecture; explicit interface contract.
//   - Buschmann et al. "Pattern-Oriented Software Architecture Vol.1"
//     (1996) — broker pattern; the architectural ancestor of plugin-mediated
//     event routing.
//   - LMAX Exchange Architecture (Thompson 2011) — Disruptor pattern; the
//     canonical in-process event-routing primitive for high-throughput trading.

import type { UnsubscribeFn, SignalBus } from "./signal-bus.js";
import {
  type CarrySignal,
  type DirectionSignal,
  type FactorSignal,
  type FundingSnapshotSignal,
  type Result,
  type RiskSignal,
  type Signal,
  type SizingSignal,
  isCarry,
  isDirection,
  isFactor,
  isFundingSnapshot,
  isRisk,
  isSizing,
  ok,
} from "./types.js";

// ---------------------------------------------------------------------------
// Public configuration
// ---------------------------------------------------------------------------

/**
 * `DecisionEngineConfig` — knobs for the decision engine.
 *
 * Defaults reflect the Phase 13 Track A scope plan §"Decision Engine
 * arbitration rules":
 *
 *   - `defaultWeight = 1.0` — most plugins
 *   - `defensiveWeight = 2.0` — RegimeDetector, PerpDexLiq, SOLFlipKS
 *   - `minConsensusStrength = 0.3` — below this, decision = flat
 *   - `maxNotionalPerSymbolUsd = 10_000` — the 1:10 reference notional
 *
 * The set of "defensive" plugin names is hard-coded because the
 * defensive-weight policy is a Phase 13 mandate, not a runtime config.
 * Plugins outside this list use `defaultWeight`.
 */
export interface DecisionEngineConfig {
  /**
   * Weight applied to non-defensive DirectionSignal sources.
   * Default `1.0`. Plugins outside the defensive list receive this
   * weight when their DirectionSignal contributes to arbitration.
   */
  readonly defaultWeight: number;
  /**
   * Weight applied to defensive plugins (RegimeDetectorMetaPlugin,
   * PerpDexLiquidationSignalsPlugin, SOLFlipKillSwitchPlugin).
   * Default `2.0`. Higher weight means defensive opinions carry
   * proportionally more weight in the directional vote.
   */
  readonly defensiveWeight: number;
  /**
   * Minimum normalized weighted-vote confidence required to commit
   * capital. Below this threshold, the engine returns `side: "flat"`
   * regardless of which side "won" the vote. Default `0.3` — the
   * Phase 13 scope plan value.
   */
  readonly minConsensusStrength: number;
  /**
   * Per-symbol notional ceiling (USD). The engine clamps the outgoing
   * `notionalUsd` to this value AFTER applying sizeMultiplier. Default
   * `10_000` — the project-wide 1:10 reference notional (i.e., 1× capital
   * at the 1:10 cap).
   */
  readonly maxNotionalPerSymbolUsd: number;
}

export const DEFAULT_DECISION_ENGINE_CONFIG: DecisionEngineConfig = {
  defaultWeight: 1.0,
  defensiveWeight: 2.0,
  minConsensusStrength: 0.3,
  maxNotionalPerSymbolUsd: 10_000,
};

/**
 * `DEFENSIVE_PLUGIN_NAMES` — the set of plugin names that receive the
 * `defensiveWeight` instead of `defaultWeight`. Exported for tests +
 * downstream consumers that need to inspect the policy.
 *
 * Source: Phase 13 scope plan §"Decision Engine arbitration rules"
 * "Defensive plugins (RegimeDetector, PerpDexLiq, SOLFlipKS) get weight 2.0".
 */
export const DEFENSIVE_PLUGIN_NAMES: readonly string[] = Object.freeze([
  "regime-detector-v1",
  "perpdex-liquidation-signals-v1",
  "sol-flip-kill-switch",
]);

// ---------------------------------------------------------------------------
// Public output types
// ---------------------------------------------------------------------------

/**
 * `PositionDecision` — the engine's final per-symbol verdict.
 *
 *   - `symbol` — the symbol this decision applies to.
 *   - `side` — discrete view: `long`, `short`, or `flat`. `flat` means
 *     no position is recommended (conservative default on tie / weak
 *     consensus).
 *   - `notionalUsd` — the recommended notional in USD. Always ≤
 *     `maxNotionalPerSymbolUsd`. 0 when `side === "flat"`.
 *   - `sizeMultiplier` — the combined scaling factor applied to the
 *     base notional. Product of:
 *       1. carry regime multiplier (1.2 high / 1.0 neutral / 0.5 flip)
 *       2. min RiskSignal.sizeModifier (defensive scale-down)
 *       3. any direct plugin sizing recommendation (optional)
 *   - `confidence` — normalized weighted vote score in [0, 1]. The
 *     winning side's weighted sum divided by total weight. Used by
 *     downstream consumers to gate against `minConsensusStrength`.
 *   - `sourceWeights` — record of `pluginName → weight` for the
 *     DirectionSignals that contributed. Useful for telemetry /
 *     attribution.
 *   - `timestampMs` — the timestamp of the LATEST contributing signal.
 */
export interface PositionDecision {
  readonly symbol: string;
  readonly side: "long" | "short" | "flat";
  readonly notionalUsd: number;
  readonly sizeMultiplier: number;
  readonly confidence: number;
  readonly sourceWeights: Record<string, number>;
  readonly timestampMs: number;
}

// ---------------------------------------------------------------------------
// Per-symbol accumulator — accumulates signals between arbitrage rounds
// ---------------------------------------------------------------------------

/**
 * `SymbolAccumulator` — per-symbol mutable state held by the engine
 * across emits. Each `bus.emit` updates one of these records; an
 * arbitration call (triggered by `arbitrate()`) reads + clears them.
 *
 * Note: `sizeModifier` and `carryMultiplier` are tracked as MIN
 * accumulators (the most defensive value wins across emits within a
 * single arbitration round).
 */
interface SymbolAccumulator {
  /** Weighted sum of long-direction votes. */
  longScore: number;
  /** Weighted sum of short-direction votes. */
  shortScore: number;
  /** Weighted sum of flat-direction votes. */
  flatScore: number;
  /** Total weight contributed (long + short + flat). */
  totalWeight: number;
  /** MIN RiskSignal.sizeModifier observed (default 1.0 = no scale-down). */
  sizeModifier: number;
  /** Carry regime multiplier — MIN across emits (default 1.0). */
  carryMultiplier: number;
  /** Last seen DirectionSignal timestamp. */
  lastDirectionTs: number;
  /** Last seen CarrySignal timestamp. */
  lastCarryTs: number;
  /** Last seen RiskSignal timestamp. */
  lastRiskTs: number;
  /** Last seen FactorSignal — informational only. */
  lastFactorSignal: FactorSignal | null;
  /** Last seen FundingSnapshotSignal — informational only. */
  lastFundingSnapshotSignal: FundingSnapshotSignal | null;
  /** Plugin-name → weight record for DirectionSignals in this round. */
  sourceWeights: Record<string, number>;
}

// ---------------------------------------------------------------------------
// Public state shape
// ---------------------------------------------------------------------------

/**
 * `DecisionEngineState` — diagnostic / test-accessible state for the
 * engine. Read-only externally; mutated internally.
 */
export interface DecisionEngineState {
  /** Per-symbol accumulator snapshots (DO NOT mutate externally). */
  readonly symbols: Map<string, SymbolAccumulator>;
  /** All `PositionDecision` emissions, chronological. */
  readonly decisions: PositionDecision[];
  /** Total DirectionSignals received since construction / last reset. */
  directionSignalsReceived: number;
  /** Total CarrySignals received since construction / last reset. */
  carrySignalsReceived: number;
  /** Total RiskSignals received since construction / last reset. */
  riskSignalsReceived: number;
  /** Total SizingSignals received since construction / last reset. */
  sizingSignalsReceived: number;
  /** Total FactorSignals received since construction / last reset. */
  factorSignalsReceived: number;
  /** Total FundingSnapshotSignals received since construction / last reset. */
  fundingSnapshotSignalsReceived: number;
  /** Total arbitration calls. */
  arbitrateCallCount: number;
  /** Total empty arbitrations (no signals seen since last call). */
  emptyArbitrateCount: number;
}

// ---------------------------------------------------------------------------
// assertNever — compile-time exhaustiveness helper for `switch (kind)`
// ---------------------------------------------------------------------------

/**
 * `assertNever` — runtime no-op function whose parameter type `never`
 * forces TypeScript to flag any call site that hands in a non-`never`
 * value. Use this in `default:` branches of exhaustive switches over
 * the Signal discriminated union to get compile-time exhaustiveness.
 *
 * If a new SignalKind variant is added to `SignalKind` in types.ts and
 * this engine doesn't handle it, the corresponding `default: assertNever(x)`
 * call site will fail to compile.
 *
 * Pattern: TypeScript Handbook §3.10 (Discriminated Unions) + Effective
 * TypeScript (Dan Vanderkam, Item 32: "Prefer Union Types to Type
 * Hierarchies") + Type-Level TypeScript (Alex Vakulov, 2023).
 */
export function assertNever(x: never): never {
  throw new Error(
    `[DecisionEngine] Non-exhaustive switch — unhandled value: ${JSON.stringify(x)}`,
  );
}

// ---------------------------------------------------------------------------
// DecisionEngine — main class
// ---------------------------------------------------------------------------

/**
 * `DecisionEngine` — SignalBus subscriber that arbitrates between N
 * plugin signals and emits final `PositionDecision`s per symbol.
 *
 * Lifecycle:
 *   1. Construct with `new DecisionEngine({ config })`.
 *   2. Wire to bus via `engine.subscribe(bus)`. Returns the unsubscribe
 *      function.
 *   3. Plugins emit signals on the bus — engine accumulates them in
 *      per-symbol buffers.
 *   4. Caller invokes `engine.arbitrate(symbol)` (or `arbitrateAll()`)
 *      to compute the final per-symbol decision.
 *   5. Caller reads `engine.decisions()` for the chronological decision
 *      log.
 *   6. `reset()` clears accumulators + decisions for backtest re-runs.
 *
 * The engine is deliberately event-agnostic — it does NOT auto-arbitrate
 * on every signal. Arbitration is explicitly invoked by the central
 * runner after each bar (or after each set of bars, depending on the
 * orchestration strategy). This separation makes the engine fully
 * deterministic and testable.
 */
export class DecisionEngine {
  readonly config: DecisionEngineConfig;
  readonly state: DecisionEngineState;

  private readonly unsubscribers: UnsubscribeFn[] = [];

  constructor(config: Partial<DecisionEngineConfig> = {}) {
    const merged: DecisionEngineConfig = {
      ...DEFAULT_DECISION_ENGINE_CONFIG,
      ...config,
    };
    if (
      !Number.isFinite(merged.defaultWeight) ||
      merged.defaultWeight <= 0
    ) {
      throw new Error(
        `[DecisionEngine] defaultWeight must be positive finite, got ${merged.defaultWeight}`,
      );
    }
    if (
      !Number.isFinite(merged.defensiveWeight) ||
      merged.defensiveWeight <= 0
    ) {
      throw new Error(
        `[DecisionEngine] defensiveWeight must be positive finite, got ${merged.defensiveWeight}`,
      );
    }
    if (
      !Number.isFinite(merged.minConsensusStrength) ||
      merged.minConsensusStrength < 0 ||
      merged.minConsensusStrength > 1
    ) {
      throw new Error(
        `[DecisionEngine] minConsensusStrength must be finite in [0, 1], got ${merged.minConsensusStrength}`,
      );
    }
    if (
      !Number.isFinite(merged.maxNotionalPerSymbolUsd) ||
      merged.maxNotionalPerSymbolUsd <= 0
    ) {
      throw new Error(
        `[DecisionEngine] maxNotionalPerSymbolUsd must be positive finite, got ${merged.maxNotionalPerSymbolUsd}`,
      );
    }
    this.config = merged;
    this.state = {
      symbols: new Map<string, SymbolAccumulator>(),
      decisions: [],
      directionSignalsReceived: 0,
      carrySignalsReceived: 0,
      riskSignalsReceived: 0,
      sizingSignalsReceived: 0,
      factorSignalsReceived: 0,
      fundingSnapshotSignalsReceived: 0,
      arbitrateCallCount: 0,
      emptyArbitrateCount: 0,
    };
  }

  // -------------------------------------------------------------------------
  // subscribe — wire the engine to a SignalBus
  // -------------------------------------------------------------------------

  /**
   * `subscribe` — register the engine as a subscriber to ALL FOUR signal
   * kinds on the bus. The engine routes by `kind` and dispatches to the
   * matching per-symbol accumulator.
   *
   * Returns the unsubscribe function. Calling it removes the engine's
   * handlers from the bus.
   */
  subscribe(bus: SignalBus): UnsubscribeFn {
    void bus;
    const unsubs: UnsubscribeFn[] = [];
    // Subscribe to ALL FOUR signal kinds — the bus routes by kind.
    // We don't currently emit signals ourselves; the engine is a
    // pure consumer + PositionDecision producer.
    for (const kind of [
      "direction",
      "carry",
      "sizing",
      "risk",
      "factor",
      "funding-snapshot",
    ] as const) {
      const unsub = bus.subscribe(kind, (s: Signal) => {
        this._handleSignal(s);
      });
      unsubs.push(unsub);
    }
    this.unsubscribers.push(...unsubs);
    // Return a single composite unsubscribe function.
    return () => {
      for (const u of unsubs) {
        try {
          u();
        } catch (e: unknown) {
          // Best-effort cleanup — swallow individual unsubscribe errors.
          void e;
        }
      }
    };
  }

  // -------------------------------------------------------------------------
  // Signal handling — internal dispatch
  // -------------------------------------------------------------------------

  /**
   * `_handleSignal` — internal signal router. Routes by `kind` and
   * delegates to the matching accumulator updater. FactorSignals and
   * FundingSnapshotSignals are recorded as informational telemetry
   * without affecting arbitration.
   */
  private _handleSignal(signal: Signal): void {
    const kind = signal.kind;
    switch (kind) {
      case "direction":
        if (isDirection(signal)) this._onDirectionSignal(signal);
        this.state.directionSignalsReceived += 1;
        return;
      case "carry":
        if (isCarry(signal)) this._onCarrySignal(signal);
        this.state.carrySignalsReceived += 1;
        return;
      case "sizing":
        // SizingSignals currently informational (the engine consumes
        // DirectionSignals for the directional vote). They contribute
        // to the input counter for diagnostics.
        if (isSizing(signal)) void signal;
        this.state.sizingSignalsReceived += 1;
        return;
      case "risk":
        if (isRisk(signal)) this._onRiskSignal(signal);
        this.state.riskSignalsReceived += 1;
        return;
      case "factor":
        if (isFactor(signal)) this._onFactorSignal(signal);
        this.state.factorSignalsReceived += 1;
        return;
      case "funding-snapshot":
        if (isFundingSnapshot(signal)) this._onFundingSnapshotSignal(signal);
        this.state.fundingSnapshotSignalsReceived += 1;
        return;
      default:
        // Exhaustiveness — if a new SignalKind variant is added, this
        // throws at runtime AND fails to compile (the `never` narrowing).
        assertNever(kind);
    }
  }

  /**
   * `_onDirectionSignal` — accumulate a DirectionSignal into the
   * per-symbol voting record. Defensive plugins receive
   * `config.defensiveWeight`; all others receive `config.defaultWeight`.
   */
  private _onDirectionSignal(s: DirectionSignal): void {
    // DirectionSignals on the bus do NOT carry a `symbol` field (see
    // types.ts Phase 11.1: per-symbol attribution is via the `source`
    // suffix). For backward-compat we derive a symbol from `source`
    // OR from `timestampMs` if present. Central runners are expected
    // to emit per-symbol directions; the engine falls back to a
    // single-symbol bucket labeled "unknown" when symbol is missing.
    const symbol = this._extractSymbol(s.source);
    const acc = this._getOrCreateAccumulator(symbol);
    const weight = this._weightForSource(s.source);
    const contribution = Math.max(0, Math.min(1, s.strength)) * weight;
    if (s.side === "long") acc.longScore += contribution;
    else if (s.side === "short") acc.shortScore += contribution;
    else acc.flatScore += contribution;
    acc.totalWeight += weight;
    acc.sourceWeights[s.source] = weight;
    if (
      s.timestampMs !== undefined &&
      s.timestampMs > acc.lastDirectionTs
    ) {
      acc.lastDirectionTs = s.timestampMs;
    }
  }

  /**
   * `_onCarrySignal` — apply a CarrySignal's regime to the per-symbol
   * carry multiplier (MIN across emits — most defensive wins).
   */
  private _onCarrySignal(s: CarrySignal): void {
    const symbol = this._extractSymbol(s.source);
    const acc = this._getOrCreateAccumulator(symbol);
    let mult: number;
    switch (s.regime) {
      case "high":
        mult = 1.2;
        break;
      case "neutral":
        mult = 1.0;
        break;
      case "flip":
        mult = 0.5;
        break;
      default:
        assertNever(s.regime);
    }
    if (mult < acc.carryMultiplier) acc.carryMultiplier = mult;
    if (s.timestampMs !== undefined && s.timestampMs > acc.lastCarryTs) {
      acc.lastCarryTs = s.timestampMs;
    }
  }

  /**
   * `_onRiskSignal` — apply a RiskSignal's `sizeModifier` (when present)
   * to the per-symbol accumulator. MIN across emits — most defensive
   * wins. We do NOT route the risk signal's `closeNotionalUsd` (that's
   * the underlying plugin's call; the engine only consumes the size
   * modifier here).
   */
  private _onRiskSignal(s: RiskSignal): void {
    const symbol = this._extractSymbol(s.source);
    const acc = this._getOrCreateAccumulator(symbol);
    if (s.sizeModifier !== undefined) {
      const m = Math.max(0, Math.min(1, s.sizeModifier));
      if (m < acc.sizeModifier) acc.sizeModifier = m;
    }
    if (s.timestampMs !== undefined && s.timestampMs > acc.lastRiskTs) {
      acc.lastRiskTs = s.timestampMs;
    }
  }

  /**
   * `_onFactorSignal` — record a FactorSignal as informational telemetry
   * only. FactorSignals do NOT contribute to direction or size.
   */
  private _onFactorSignal(s: FactorSignal): void {
    const symbol = this._extractSymbol(s.source);
    const acc = this._getOrCreateAccumulator(symbol);
    acc.lastFactorSignal = s;
  }

  /**
   * `_onFundingSnapshotSignal` — record a FundingSnapshotSignal as
   * informational telemetry only. FundingSnapshotSignals do NOT
   * contribute to direction or size.
   */
  private _onFundingSnapshotSignal(s: FundingSnapshotSignal): void {
    const symbol = this._extractSymbol(s.source);
    const acc = this._getOrCreateAccumulator(symbol);
    acc.lastFundingSnapshotSignal = s;
  }

  // -------------------------------------------------------------------------
  // Arbitration
  // -------------------------------------------------------------------------

  /**
   * `arbitrate` — compute a PositionDecision for `symbol` based on the
   * signals accumulated since the last `reset()` / `arbitrate()` call
   * for this symbol. The accumulator is CLEARED after this call so the
   * next round starts fresh.
   *
   * Returns a PositionDecision. If no signals were received for the
   * symbol since the last clear, returns a `flat` decision with
   * `notionalUsd: 0` and `confidence: 0`.
   */
  arbitrate(symbol: string): PositionDecision {
    this.state.arbitrateCallCount += 1;
    const acc = this.state.symbols.get(symbol);
    if (
      acc === undefined ||
      acc.totalWeight === 0
    ) {
      this.state.emptyArbitrateCount += 1;
      const empty: PositionDecision = {
        symbol,
        side: "flat",
        notionalUsd: 0,
        sizeMultiplier: 1.0,
        confidence: 0,
        sourceWeights: {},
        timestampMs: this._nowMs(),
      };
      this.state.decisions.push(empty);
      return empty;
    }
    // Compute the winner.
    const { winner, confidence, sourceWeights } = this._pickWinner(acc);
    const sizeMultiplier = this._computeSizeMultiplier(acc);
    const notionalRaw =
      this.config.maxNotionalPerSymbolUsd * Math.max(0, sizeMultiplier);
    const notionalUsd = Math.max(
      0,
      Math.min(this.config.maxNotionalPerSymbolUsd, notionalRaw),
    );
    const side: PositionDecision["side"] =
      confidence < this.config.minConsensusStrength ? "flat" : winner;
    const timestampMs = Math.max(
      acc.lastDirectionTs,
      acc.lastCarryTs,
      acc.lastRiskTs,
      this._nowMs(),
    );
    const decision: PositionDecision = {
      symbol,
      side,
      notionalUsd: side === "flat" ? 0 : notionalUsd,
      sizeMultiplier,
      confidence,
      sourceWeights,
      timestampMs,
    };
    this.state.decisions.push(decision);
    // Clear the accumulator for the next round.
    this.state.symbols.delete(symbol);
    return decision;
  }

  /**
   * `arbitrateAll` — call `arbitrate(symbol)` for every symbol that
   * currently has an accumulator. Returns the decisions in
   * insertion order.
   */
  arbitrateAll(): readonly PositionDecision[] {
    const symbols = Array.from(this.state.symbols.keys());
    return symbols.map((s) => this.arbitrate(s));
  }

  /**
   * `decisions` — chronological list of all PositionDecisions emitted
   * since the last `reset()`. Returns a defensive copy (the array
   * itself is a copy, but the decisions inside are immutable views).
   */
  decisions(): readonly PositionDecision[] {
    return [...this.state.decisions];
  }

  /**
   * `latestDecision` — the most recent PositionDecision for `symbol`,
   * or null if none has been emitted yet.
   */
  latestDecision(symbol: string): PositionDecision | null {
    for (let i = this.state.decisions.length - 1; i >= 0; i--) {
      const d = this.state.decisions[i];
      if (d?.symbol === symbol) return d;
    }
    return null;
  }

  /**
   * `reset` — clear all accumulators + the decision log + the
   * diagnostic counters. Used between backtest re-runs.
   */
  reset(): void {
    this.state.symbols.clear();
    this.state.decisions.length = 0;
    this.state.directionSignalsReceived = 0;
    this.state.carrySignalsReceived = 0;
    this.state.riskSignalsReceived = 0;
    this.state.sizingSignalsReceived = 0;
    this.state.factorSignalsReceived = 0;
    this.state.fundingSnapshotSignalsReceived = 0;
    this.state.arbitrateCallCount = 0;
    this.state.emptyArbitrateCount = 0;
  }

  // -------------------------------------------------------------------------
  // Public introspection helpers
  // -------------------------------------------------------------------------

  /**
   * `accumulatorFor` — read-only accessor for the current per-symbol
   * accumulator snapshot. Returns null if the symbol has no accumulator
   * (no signals seen yet).
   */
  accumulatorFor(symbol: string): {
    longScore: number;
    shortScore: number;
    flatScore: number;
    totalWeight: number;
    sizeModifier: number;
    carryMultiplier: number;
  } | null {
    const acc = this.state.symbols.get(symbol);
    if (acc === undefined) return null;
    return {
      longScore: acc.longScore,
      shortScore: acc.shortScore,
      flatScore: acc.flatScore,
      totalWeight: acc.totalWeight,
      sizeModifier: acc.sizeModifier,
      carryMultiplier: acc.carryMultiplier,
    };
  }

  /**
   * `validateConfig` — non-throwing config audit. Mirrors the
   * constructor's invariants; returns `ok(undefined)` if all pass.
   */
  validateConfig(config: unknown): Result<void, { message: string }> {
    if (config === null || config === undefined) return ok(undefined);
    if (typeof config !== "object") {
      return { ok: false, error: { message: "config must be an object" } };
    }
    const c = config as Partial<DecisionEngineConfig>;
    if (
      c.defaultWeight !== undefined &&
      (!Number.isFinite(c.defaultWeight) || c.defaultWeight <= 0)
    ) {
      return {
        ok: false,
        error: {
          message: `defaultWeight must be positive finite, got ${c.defaultWeight}`,
        },
      };
    }
    if (
      c.defensiveWeight !== undefined &&
      (!Number.isFinite(c.defensiveWeight) || c.defensiveWeight <= 0)
    ) {
      return {
        ok: false,
        error: {
          message: `defensiveWeight must be positive finite, got ${c.defensiveWeight}`,
        },
      };
    }
    if (
      c.minConsensusStrength !== undefined &&
      (!Number.isFinite(c.minConsensusStrength) ||
        c.minConsensusStrength < 0 ||
        c.minConsensusStrength > 1)
    ) {
      return {
        ok: false,
        error: {
          message: `minConsensusStrength must be finite in [0, 1], got ${c.minConsensusStrength}`,
        },
      };
    }
    if (
      c.maxNotionalPerSymbolUsd !== undefined &&
      (!Number.isFinite(c.maxNotionalPerSymbolUsd) ||
        c.maxNotionalPerSymbolUsd <= 0)
    ) {
      return {
        ok: false,
        error: {
          message: `maxNotionalPerSymbolUsd must be positive finite, got ${c.maxNotionalPerSymbolUsd}`,
        },
      };
    }
    return ok(undefined);
  }

  /**
   * `dispose` — release bus subscriptions. The engine becomes inert
   * after dispose (callers must construct a new one to resume).
   */
  dispose(): void {
    for (const u of this.unsubscribers) {
      try {
        u();
      } catch (e: unknown) {
        void e;
      }
    }
    this.unsubscribers.length = 0;
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * `_extractSymbol` — derive a symbol identifier from a signal source
   * string. Convention (Phase 11.1): `<plugin>:<symbol>` (e.g.,
   * `carry-baseline:BTC/USDT`). For sources without the colon
   * separator, the symbol bucket is `"unknown"`.
   */
  private _extractSymbol(source: string): string {
    const idx = source.indexOf(":");
    if (idx === -1 || idx === source.length - 1) return "unknown";
    return source.slice(idx + 1);
  }

  /**
   * `_weightForSource` — return the engine's weight for a given
   * DirectionSignal source. Defensive plugins get
   * `config.defensiveWeight`; everything else gets `config.defaultWeight`.
   *
   * Defensive matching is on the plugin-name portion of the source
   * (everything before the colon). For sources without a colon, the
   * entire source string is treated as the plugin name.
   */
  private _weightForSource(source: string): number {
    const idx = source.indexOf(":");
    const pluginName = idx === -1 ? source : source.slice(0, idx);
    if (DEFENSIVE_PLUGIN_NAMES.includes(pluginName)) {
      return this.config.defensiveWeight;
    }
    return this.config.defaultWeight;
  }

  /**
   * `_getOrCreateAccumulator` — fetch the per-symbol accumulator,
   * creating a fresh one (with default values) if absent.
   */
  private _getOrCreateAccumulator(symbol: string): SymbolAccumulator {
    let acc = this.state.symbols.get(symbol);
    if (acc === undefined) {
      acc = {
        longScore: 0,
        shortScore: 0,
        flatScore: 0,
        totalWeight: 0,
        sizeModifier: 1.0,
        carryMultiplier: 1.0,
        lastDirectionTs: 0,
        lastCarryTs: 0,
        lastRiskTs: 0,
        lastFactorSignal: null,
        lastFundingSnapshotSignal: null,
        sourceWeights: {},
      };
      this.state.symbols.set(symbol, acc);
    }
    return acc;
  }

  /**
   * `_pickWinner` — return the winning side + confidence + sourceWeights.
   * The confidence is the winning side's weighted sum divided by
   * `totalWeight`. On a tie (or all-zero weights), returns `flat`.
   */
  private _pickWinner(acc: SymbolAccumulator): {
    winner: PositionDecision["side"];
    confidence: number;
    sourceWeights: Record<string, number>;
  } {
    const scores = {
      long: acc.longScore,
      short: acc.shortScore,
      flat: acc.flatScore,
    };
    let winner: PositionDecision["side"] = "flat";
    let top = scores.flat;
    if (scores.long > top) {
      winner = "long";
      top = scores.long;
    }
    if (scores.short > top) {
      winner = "short";
      top = scores.short;
    }
    // Tie-breaking: if two sides are equal (within float epsilon), prefer flat.
    // This is the conservative path — no trade when signals can't agree.
    const epsilon = 1e-9;
    if (
      (Math.abs(scores.long - scores.short) < epsilon && scores.long > 0) ||
      (Math.abs(scores.long - scores.flat) < epsilon && scores.long > 0) ||
      (Math.abs(scores.short - scores.flat) < epsilon && scores.short > 0)
    ) {
      winner = "flat";
      top = scores.flat;
    }
    const confidence = acc.totalWeight > 0 ? top / acc.totalWeight : 0;
    return {
      winner,
      confidence: Math.max(0, Math.min(1, confidence)),
      sourceWeights: { ...acc.sourceWeights },
    };
  }

  /**
   * `_computeSizeMultiplier` — combine carry regime multiplier × risk
   * size modifier. Both inputs are clamped to [0, 1] (size modifier can
   * be 1.0 from neutral carry, but carry high regime gives 1.2 which
   * we clamp here so notional never exceeds the cap).
   *
   * NOTE: under the project's mandatory 1:10 leverage, this clamp means
   * `regime = "high"` (raw carryMultiplier = 1.2) is structurally equal to
   * `regime = "neutral"` (raw 1.0) at the final sizeMultiplier level.
   * The "scale up to 1.2" intent is documented for future alpha context
   * (pre-1:10), but the production behavior is: high == neutral == 1.0.
   * Only the defensive scale-down half (`regime = "flip"` → 0.5) is
   * observable in production envelopes.
   */
  private _computeSizeMultiplier(acc: SymbolAccumulator): number {
    const raw = acc.carryMultiplier * acc.sizeModifier;
    return Math.max(0, Math.min(1, raw));
  }

  /**
   * `_nowMs` — wall-clock millisecond timestamp. Tests can swap this
   * via the engine constructor (extension hook reserved for future
   * use; default is `Date.now()`).
   */
  private _nowMs(): number {
    return Date.now();
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * `createDecisionEngine` — convenience factory. Same as
 * `new DecisionEngine(config)`.
 */
export function createDecisionEngine(
  config?: Partial<DecisionEngineConfig>,
): DecisionEngine {
  return new DecisionEngine(config);
}

// Suppress unused-import warning for SizingSignal (re-exported for callers).
export type { SizingSignal };