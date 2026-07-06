// packages/core/src/portfolio/portfolio-decision.ts — Phase 13 Track B
//
// =========================================================================
// POSITION DECISION + DECISION ENGINE — portfolio-level arbitration
// =========================================================================
//
// The `DecisionEngine` consumes signals from a SignalBus (typically
// attached to a per-symbol `SignalCenterV1`) and emits `PositionDecision`
// events that represent the FINAL, arbitrated cross-plugin view for one
// (symbol, timestamp) tuple.
//
// This is the canonical contract for the per-symbol arbitration layer.
// Track A (`packages/core/src/signal-center/decision-engine.ts`) is the
// AUTHORITATIVE implementation — Track B's portfolio orchestrator
// accepts ANY object that satisfies this `DecisionEngineLike` interface,
// which means swapping Track A's class in here is a one-line change at
// the PortfolioOrchestrator construction site.
//
// Why a separate file in Track B?
//   - Track B needs `PositionDecision` to flow through the portfolio
//     orchestrator's aggregation layer.
//   - If Track A is not yet merged, this local stub keeps the build
//     green and the integration tests deterministic. The shapes are
//     1:1 compatible with the Track A spec from
//     `notes/phase13-scope-plan.md` §"Decision Engine arbitration rules"
//     so once Track A lands, the contract merges cleanly.
//
// =========================================================================
// ARBITRATION RULES (portable, agent-default — see Track A spec)
// =========================================================================
//
//   - Directional conflict (long + short at same symbol, same timestamp):
//     side = 'flat' if weights tie; otherwise the weighted-majority side.
//   - Risk signal `sizeModifier < 1.0`: applies to ALL outgoing decisions
//     (multiplier wins).
//   - Carry signal: high=1.2 / neutral=1.0 / flip=0.5 — applied to
//     `sizeMultiplier` (does NOT veto direction).
//   - Factor / FundingSnapshot signals: informational only, never veto.
//   - Defensive plugins (RegimeDetector, PerpDexLiq, SOLFlipKS) get weight
//     2.0 vs directional weight 1.0.
//   - Min consensus strength 0.3: below this, decision = 'flat'.
//
// =========================================================================
// References (≥3 independent sources per empirical claim)
// =========================================================================
//
// 1. Martin Fowler "Plugin" pattern (PEAA, 2002) — explicit plugin
//    interface, runtime registration, lifecycle hooks.
// 2. QuantConnect Lean Engine `Alpha` composition (consensus across
//    alphas with weights) — industry-standard pattern for multi-signal
//    trading arbitration.
// 3. LMAX Disruptor + Fowler "Event Sourcing" — SignalBus pattern used
//    here for deterministic in-process arbitration.

import {
  isCarry,
  isDirection,
  isFactor,
  isFundingSnapshot,
  isRisk,
  isSizing,
  type CarrySignal,
  type DirectionSignal,
  type FactorSignal,
  type FundingSnapshotSignal,
  type RiskSignal,
  type Signal,
  type SizingSignal,
} from "../signal-center/types.js";
import type { SignalBus, UnsubscribeFn } from "../signal-center/signal-bus.js";

// ---------------------------------------------------------------------------
// PositionDecision — the arbitrated cross-plugin view for one tuple
// ---------------------------------------------------------------------------

/**
 * `PositionDecision` — the FINAL arbitrated decision for a single
 * (symbol, timestamp) tuple. Emitted by `DecisionEngine.synthesize()`
 * (or by Track A's `DecisionEngine.onBar()`) and consumed by the
 * portfolio orchestrator.
 *
 * Fields:
 *   - `symbol` — the trading pair this decision applies to.
 *   - `side` — discrete directional view after arbitration:
 *     `long` | `short` | `flat`.
 *   - `notionalUsd` — final USD notional for this decision. Always
 *     respects the 1:10 leverage MANDATE (≤ baseCapital × maxLeverage).
 *   - `sizeMultiplier` — combined vol × kelly × regime multiplier in
 *     [0, 1.0] (1:10 mandate caps Moreira-Muir scale-up at 1.0).
 *   - `confidence` — 0..1, weighted-vote score.
 *   - `sourceWeights` — per-plugin weight map (pluginName → weight).
 *     Used for telemetry attribution + cross-symbol correlation
 *     penalty computation downstream.
 *   - `timestampMs` — bar timestamp.
 */
export interface PositionDecision {
  readonly symbol: string;
  readonly side: "long" | "short" | "flat";
  readonly notionalUsd: number;
  readonly sizeMultiplier: number;
  readonly confidence: number;
  readonly sourceWeights: Readonly<Record<string, number>>;
  readonly timestampMs: number;
}

// ---------------------------------------------------------------------------
// DecisionEngineConfig — knobs for the per-symbol arbitration layer
// ---------------------------------------------------------------------------

/**
 * `DecisionEngineConfig` — configuration for the DecisionEngine.
 *
 * Defaults reflect the Phase 13 spec:
 *   - `defaultWeight = 1.0` — directional and carry plugins.
 *   - `defensiveWeight = 2.0` — defensive plugins (RegimeDetector,
 *     PerpDexLiquidation, SOLFlipKillSwitch) get a 2× vote because
 *     they encode survival priors (per the L1/L2 kill-switch design
 *     discipline from memory).
 *   - `minConsensusStrength = 0.3` — below this, decision = 'flat'
 *     (avoids trading on weak/ambiguous signals).
 *   - `maxNotionalPerSymbolUsd = 10_000` — hard cap on per-decision
 *     notional (matches the bybit.eu SPOT margin 1:10 ceiling for a
 *     $1k equity base; user can override).
 */
export interface DecisionEngineConfig {
  readonly defaultWeight: number;
  readonly defensiveWeight: number;
  readonly minConsensusStrength: number;
  readonly maxNotionalPerSymbolUsd: number;
}

/**
 * `DEFAULT_DECISION_ENGINE_CONFIG` — production defaults.
 */
export const DEFAULT_DECISION_ENGINE_CONFIG: DecisionEngineConfig = {
  defaultWeight: 1.0,
  defensiveWeight: 2.0,
  minConsensusStrength: 0.3,
  maxNotionalPerSymbolUsd: 10_000,
};

/**
 * `DEFENSIVE_PLUGIN_NAMES` — the set of plugin names that get
 * `defensiveWeight` (2.0). Kept as a closed list — adding a new
 * defensive plugin requires updating both this set and the plugin
 * name, ensuring type-safe attribution.
 */
export const DEFENSIVE_PLUGIN_NAMES: readonly string[] = [
  "regime-detector-meta",
  "perpdex-liquidation-signals",
  "sol-flip-kill-switch",
  "funding-flip-kill-switch",
];

// ---------------------------------------------------------------------------
// DecisionEngineLike — interface Track B accepts (compatible with Track A)
// ---------------------------------------------------------------------------

/**
 * `DecisionEngineLike` — minimal interface the portfolio orchestrator
 * uses to interact with a per-symbol decision engine. Track A's
 * `DecisionEngine` class satisfies this; a stub or mock can too.
 *
 * Why an interface and not the concrete class?
 *   - Track A may ship its own class; we want to inject it without
 *     a circular import.
 *   - Tests can supply a hand-written stub without paying the cost
 *     of constructing the full SCv1 + bus.
 */
export interface DecisionEngineLike {
  /**
   * `subscribe` — register on a SignalBus. Returns an unsubscribe fn
   * (matches Track A's signature `subscribe(bus): UnsubscribeFn`).
   */
  subscribe(bus: SignalBus): UnsubscribeFn;
  /**
   * `decisions` — chronological list of decisions made so far.
   */
  decisions(): readonly PositionDecision[];
  /**
   * `latestDecision` — most recent decision for a symbol, or null if
   * none yet.
   */
  latestDecision(symbol: string): PositionDecision | null;
  /**
   * `reset` — clear all decisions (for backtest re-runs).
   */
  reset(): void;
}

// ---------------------------------------------------------------------------
// DecisionEngine — the implementation (compatible with Track A)
// ---------------------------------------------------------------------------

/**
 * `DecisionEngine` — per-symbol arbitration layer. Subscribes to a
 * SignalBus (typically the bus of the corresponding `SignalCenterV1`),
 * accumulates signals per bar timestamp, then on `synthesize()` emits
 * a `PositionDecision` representing the weighted-vote outcome.
 *
 * Lifecycle:
 *   1. **Construct** — `new DecisionEngine({ config, symbol })`.
 *   2. **Subscribe** — `engine.subscribe(bus)`. Subscribes to all four
 *      signal kinds (`direction`, `carry`, `sizing`, `risk`).
 *   3. **Drive** — caller drives `onBar()` once per bar. The engine
 *      also supports `synthesize()` which is called by the orchestrator
 *      to produce a `PositionDecision` from the accumulated signals.
 *   4. **Query** — `decisions()`, `latestDecision(symbol)`.
 *   5. **Reset** — `reset()` between backtest re-runs.
 *
 * **Implementation note:** we accumulate signals per-symbol in
 * `pendingBySymbol`. The orchestrator's per-bar loop calls
 * `synthesize(symbol, ts)` once per bar, draining the pending buffer
 * and emitting one `PositionDecision` per (symbol, bar).
 */
export class DecisionEngine implements DecisionEngineLike {
  readonly config: DecisionEngineConfig;
  /** The symbol this engine arbitrates for (single-symbol). */
  readonly symbol: string;

  /** Per-symbol pending signals, drained by `synthesize()`. */
  private readonly pendingBySymbol: Map<string, Signal[]> = new Map<string, Signal[]>();
  /** All decisions in chronological order. */
  private readonly _decisions: PositionDecision[] = [];
  /** Unsubscribe handles for the bus subscriptions. */
  private readonly _unsubscribers: UnsubscribeFn[] = [];
  /** Per-plugin weight cache (lazily resolved on first signal). */
  private readonly _weightCache = new Map<string, number>();
  /** Last sizeModifier seen from a defensive RiskSignal. */
  private _defensiveSizeModifier = 1.0;

  constructor(config: Partial<DecisionEngineConfig> & { readonly symbol: string }) {
    const merged: DecisionEngineConfig = {
      ...DEFAULT_DECISION_ENGINE_CONFIG,
      ...config,
    };
    // Validate config — fail fast.
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
        `[DecisionEngine] minConsensusStrength must be in [0, 1], got ${merged.minConsensusStrength}`,
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
    this.symbol = config.symbol;
    if (typeof this.symbol !== "string" || this.symbol.length === 0) {
      throw new Error(`[DecisionEngine] symbol must be a non-empty string`);
    }
  }

  // -------------------------------------------------------------------------
  // DecisionEngineLike interface
  // -------------------------------------------------------------------------

  /**
   * `subscribe` — register this engine on a SignalBus. The engine
   * listens for ALL signal kinds and accumulates them per-symbol.
   *
   * Returns an unsubscribe function (idempotent).
   */
  subscribe(bus: SignalBus): UnsubscribeFn {
    const kinds = ["direction", "carry", "sizing", "risk"] as const;
    for (const kind of kinds) {
      const unsub = bus.subscribe(kind, (s: Signal) => {
        this.ingest(s);
      });
      this._unsubscribers.push(unsub);
    }
    return () => {
      for (const u of this._unsubscribers) {
        try {
          u();
        } catch {
          // swallow — best-effort cleanup
        }
      }
      this._unsubscribers.length = 0;
    };
  }

  /**
   * `decisions` — defensive copy of all decisions made so far.
   */
  decisions(): readonly PositionDecision[] {
    return [...this._decisions];
  }

  /**
   * `latestDecision` — most recent decision for a symbol, or null if
   * none yet.
   */
  latestDecision(symbol: string): PositionDecision | null {
    for (let i = this._decisions.length - 1; i >= 0; i--) {
      const d = this._decisions[i];
      if (d?.symbol === symbol) return d;
    }
    return null;
  }

  /**
   * `reset` — clear all decisions + pending signals. Called between
   * backtest re-runs.
   */
  reset(): void {
    this.pendingBySymbol.clear();
    this._decisions.length = 0;
    this._weightCache.clear();
    this._defensiveSizeModifier = 1.0;
  }

  // -------------------------------------------------------------------------
  // Public API — orchestrate a bar
  // -------------------------------------------------------------------------

  /**
   * `synthesize` — drain the pending signal buffer for a symbol and
   * emit a `PositionDecision`. Returns `null` if there were no
   * signals since the last synthesize (the caller may then re-emit
   * the previous decision unchanged).
   *
   * Called by `PortfolioOrchestrator.run()` once per bar per symbol.
   */
  synthesize(symbol: string, timestampMs: number): PositionDecision | null {
    const pending = this.pendingBySymbol.get(symbol);
    if (pending === undefined || pending.length === 0) {
      return null;
    }
    // Drain — clear AFTER we've extracted the slice.
    this.pendingBySymbol.set(symbol, []);
    return this.arbitrate(symbol, timestampMs, pending);
  }

  // -------------------------------------------------------------------------
  // Internal — arbitration logic
  // -------------------------------------------------------------------------

  /**
   * `ingest` — push a signal into the per-symbol pending buffer. Called
   * from each bus subscription in `subscribe()`.
   */
  private ingest(signal: Signal): void {
    // We accept all signals — defensively skip malformed ones.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (typeof signal !== "object" || signal === null) return;
    const arr = this.pendingBySymbol.get(this.symbol);
    if (arr === undefined) {
      const fresh: Signal[] = [signal];
      this.pendingBySymbol.set(this.symbol, fresh);
    } else {
      arr.push(signal);
    }
  }

  /**
   * `arbitrate` — compute the weighted-vote outcome from a slice of
   * pending signals. Pure function over `signals` + `this` (reads
   * `_weightCache`, `_defensiveSizeModifier`).
   *
   * Step 1: aggregate directional votes (long + short + flat, each
   *   weighted by plugin weight × signal strength).
   * Step 2: carry regime → sizeMultiplier bias (high=1.2, neutral=1.0,
   *   flip=0.5).
   * Step 3: defensive RiskSignal sizeModifier overrides everything
   *   else (multiplicative composition).
   * Step 4: factor / funding-snapshot signals IGNORED (informational).
   * Step 5: notional = min(computed, maxNotionalPerSymbolUsd).
   * Step 6: if total consensus strength < minConsensusStrength →
   *   side = 'flat'.
   */
  private arbitrate(
    symbol: string,
    timestampMs: number,
    signals: readonly Signal[],
  ): PositionDecision {
    let longWeight = 0;
    let shortWeight = 0;
    let flatWeight = 0;
    let totalStrength = 0;
    const sourceWeights: Record<string, number> = {};
    let carrySizeMultiplier = 1.0;
    let sizingNotional = 0;
    let sizingNotionalCount = 0;
    // Phase 14D: SizingSignal.volMultiplier is composed via min() with
    // carrySizeMultiplier × defensiveSizeModifier. This is the
    // contract the Phase 14C research assumed — DVOL's forward-looking
    // volMultiplier scales position size during stress windows.
    let sizingVolMultiplier = 1.0;

    for (const s of signals) {
      if (isDirection(s)) {
        const w = this.weightFor(s.source);
        const contribution = w * s.strength;
        if (s.side === "long") longWeight += contribution;
        else if (s.side === "short") shortWeight += contribution;
        else flatWeight += contribution;
        totalStrength += contribution;
        sourceWeights[s.source] = (sourceWeights[s.source] ?? 0) + contribution;
      } else if (isCarry(s)) {
        // Carry signal adjusts sizeMultiplier (does NOT veto direction).
        let regimeMult: number;
        if (s.regime === "high") regimeMult = 1.2;
        else if (s.regime === "flip") regimeMult = 0.5;
        else regimeMult = 1.0;
        // Compose multiplicatively — multiple carry signals should
        // multiply, not overwrite.
        carrySizeMultiplier *= regimeMult;
        // Cap carry influence at 1.5 (defensive — never scale up past
        // the carry high regime bias).
        if (carrySizeMultiplier > 1.5) carrySizeMultiplier = 1.5;
        sourceWeights[s.source] = (sourceWeights[s.source] ?? 0) + this.weightFor(s.source);
      } else if (isSizing(s)) {
        // Average SizingSignals — keep it simple (most plugins won't
        // emit multiples per bar; this is a defensive aggregation).
        sizingNotional += s.notional;
        sizingNotionalCount += 1;
        // Phase 14D: track minimum SizingSignal.volMultiplier (defensive
        // composition). The smallest volMultiplier among all sizing
        // sources wins — DVOL's stress signal reduces position size
        // before realized vol picks up.
        if (s.volMultiplier < sizingVolMultiplier) {
          sizingVolMultiplier = s.volMultiplier;
        }
      } else if (isRisk(s)) {
        // Defensive RiskSignals with sizeModifier override.
        if (s.sizeModifier !== undefined && s.sizeModifier < this._defensiveSizeModifier) {
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
          this._defensiveSizeModifier = Math.max(0, s.sizeModifier);
        }
        sourceWeights[s.source] = (sourceWeights[s.source] ?? 0) + this.weightFor(s.source);
      } else if (isFactor(s) || isFundingSnapshot(s)) {
        // Informational only — never veto, never contribute to weight.
        // Touch the sourceWeights so attribution isn't lost, but at 0.
        sourceWeights[s.source] = sourceWeights[s.source] ?? 0;
      } else {
        // Exhaustiveness — if a new SignalKind is added, this throws
        // at compile time. Compile-time guarantee (TS strict).
        assertExhaustiveSignal(s);
      }
    }

    // Compute final side + confidence.
    let side: "long" | "short" | "flat";
    let confidence: number;
    const dominantSide =
      longWeight > shortWeight && longWeight > flatWeight
        ? "long"
        : shortWeight > longWeight && shortWeight > flatWeight
          ? "short"
          : "flat";
    if (totalStrength < this.config.minConsensusStrength) {
      side = "flat";
      confidence = totalStrength;
    } else if (dominantSide === "long" && longWeight > shortWeight) {
      side = "long";
      confidence = longWeight / Math.max(totalStrength, 1e-9);
    } else if (dominantSide === "short" && shortWeight > longWeight) {
      side = "short";
      confidence = shortWeight / Math.max(totalStrength, 1e-9);
    } else {
      side = "flat";
      confidence = 1 - Math.abs(longWeight - shortWeight) / Math.max(totalStrength, 1e-9);
    }

    // Final size multiplier — compose carry × defensive × sizingVolMultiplier
    // (min() composition: the more defensive of all three wins).
    // Phase 14D: added sizingVolMultiplier (SizingSignal min) so DVOL
    // can scale position size during acute stress.
    const sizeMultiplier = Math.max(
      0,
      Math.min(1, carrySizeMultiplier * this._defensiveSizeModifier * sizingVolMultiplier),
    );

    // Notional: prefer SizingSignals' average notional, scaled by side
    // sign. If no sizing signals, derive from baseNotional × sizeMult × confidence.
    let notionalUsd: number;
    if (sizingNotionalCount > 0 && sizingNotional > 0) {
      notionalUsd = (sizingNotional / sizingNotionalCount) * sizeMultiplier;
    } else {
      // No SizingSignals → notional = 0 (decision has no executable size).
      notionalUsd = 0;
    }
    // Hard ceiling — 1:10 MANDATE / maxNotionalPerSymbolUsd.
    if (notionalUsd > this.config.maxNotionalPerSymbolUsd) {
      notionalUsd = this.config.maxNotionalPerSymbolUsd;
    }
    // Side sign convention — long is positive notional, short negative,
    // flat is 0.
    if (side === "flat") {
      notionalUsd = 0;
    } else if (side === "short" && notionalUsd > 0) {
      notionalUsd = -notionalUsd;
    }
    // If long + negative notional (defensive override flipped it), clamp to 0.
    if (side === "long" && notionalUsd < 0) notionalUsd = 0;

    // Reset defensive size modifier — single-bar scope (it's per-bar
    // info, not persistent state).
    this._defensiveSizeModifier = 1.0;

    const decision: PositionDecision = {
      symbol,
      side,
      notionalUsd: Math.max(0, Math.abs(notionalUsd)) * (side === "short" ? -1 : 1),
      sizeMultiplier,
      confidence,
      sourceWeights,
      timestampMs,
    };
    this._decisions.push(decision);
    return decision;
  }

  /**
   * `weightFor` — look up the weight for a plugin name. Defensive
   * plugins get `defensiveWeight`, others get `defaultWeight`.
   */
  private weightFor(pluginName: string): number {
    const cached = this._weightCache.get(pluginName);
    if (cached !== undefined) return cached;
    const isDefensive = DEFENSIVE_PLUGIN_NAMES.some((n) => pluginName.startsWith(n));
    const w = isDefensive ? this.config.defensiveWeight : this.config.defaultWeight;
    this._weightCache.set(pluginName, w);
    return w;
  }
}

// ---------------------------------------------------------------------------
// Exhaustiveness helper — compile-time guard for the `Signal` discriminated union
// ---------------------------------------------------------------------------

/**
 * `assertExhaustiveSignal` — exhaustive switch guard. If a new `SignalKind`
 * is added to the bus, this function's parameter type narrows to the
 * unhandled variant and the next call site that imports it fails to
 * compile. Mirrors Track A's `assertNever` but is signal-union-typed.
 */
export function assertExhaustiveSignal(x: never): never {
  throw new Error(
    `[DecisionEngine] Non-exhaustive Signal switch — unhandled kind: ${JSON.stringify(x)}`,
  );
}

// ---------------------------------------------------------------------------
// Re-export types for downstream consumers
// ---------------------------------------------------------------------------

/** Re-export Signal types so consumers don't need 2 imports. */
export type {
  DirectionSignal,
  CarrySignal,
  SizingSignal,
  RiskSignal,
  FactorSignal,
  FundingSnapshotSignal,
};