import {
  isCarry,
  isDirection,
  isFactor,
  isFundingSnapshot,
  isRisk,
  isSizing,
  type Signal,
} from "../signal-center/types.js";
import type { SignalBus, UnsubscribeFn as UnsubscribeFunction } from "../signal-center/signal-bus.js";

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
 *   - `notionalUsd` — final USD notional for this decision.
 *   - `sizeMultiplier` — combined vol × kelly × regime multiplier in [0, 1.0].
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
 *   - `maxNotionalPerSymbolUsd = 10_000` — hard cap on per-decision notional.
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
export const DEFAULT_DECISION_ENGINE_CONFIG: Readonly<DecisionEngineConfig> = Object.freeze({
  defaultWeight: 1,
  defensiveWeight: 2,
  minConsensusStrength: 0.3,
  maxNotionalPerSymbolUsd: 10_000,
});

/**
 * `DEFENSIVE_PLUGIN_NAMES` — the set of plugin names that get
 * `defensiveWeight` (2.0). Kept as a closed list — adding a new
 * defensive plugin requires updating both this set and the plugin
 * name, ensuring type-safe attribution.
 */
export const DEFENSIVE_PLUGIN_NAMES: readonly string[] = Object.freeze([
  "regime-detector-meta",
  "perpdex-liquidation-signals",
  "sol-flip-kill-switch",
  "funding-flip-kill-switch",
]);

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
  subscribe(bus: SignalBus): UnsubscribeFunction;
  /**
   * `decisions` — chronological list of decisions made so far.
   */
  decisions(): readonly PositionDecision[];
  /**
   * `latestDecision` — most recent decision for a symbol, or undefined if
   * none yet.
   */
  latestDecision(symbol: string): PositionDecision | undefined;
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
  private readonly pendingBySymbol: Map<string, Signal[]> = new Map<string, Signal[]>();
  /**
  All decisions in chronological order.
  */
  private readonly _decisions: PositionDecision[] = [];
  /**
  Unsubscribe handles for the bus subscriptions.
  */
  private readonly _unsubscribers: UnsubscribeFunction[] = [];
  /**
  Per-plugin weight cache (lazily resolved on first signal).
  */
  private readonly _weightCache = new Map<string, number>();
  /**
  Last sizeModifier seen from a defensive RiskSignal.
  */
  private _defensiveSizeModifier = 1;
  readonly config: DecisionEngineConfig;
  readonly symbol: string;

  constructor(config: Partial<DecisionEngineConfig> & { readonly symbol: string }) {
    const merged: DecisionEngineConfig = {
      ...DEFAULT_DECISION_ENGINE_CONFIG,
      ...config,
    };
    // Validate config — fail fast.
    if (!Number.isFinite(merged.defaultWeight) || merged.defaultWeight <= 0) {
      throw new Error(
        `[DecisionEngine] defaultWeight must be positive finite, got ${String(merged.defaultWeight)}`,
      );
    }
    if (!Number.isFinite(merged.defensiveWeight) || merged.defensiveWeight <= 0) {
      throw new Error(
        `[DecisionEngine] defensiveWeight must be positive finite, got ${String(merged.defensiveWeight)}`,
      );
    }
    if (
      !Number.isFinite(merged.minConsensusStrength) ||
      merged.minConsensusStrength < 0 ||
      merged.minConsensusStrength > 1
    ) {
      throw new Error(
        `[DecisionEngine] minConsensusStrength must be in [0, 1], got ${String(merged.minConsensusStrength)}`,
      );
    }
    if (!Number.isFinite(merged.maxNotionalPerSymbolUsd) || merged.maxNotionalPerSymbolUsd <= 0) {
      throw new Error(
        `[DecisionEngine] maxNotionalPerSymbolUsd must be positive finite, got ${String(merged.maxNotionalPerSymbolUsd)}`,
      );
    }
    this.config = Object.freeze({ ...merged });
    this.symbol = config.symbol;
    if (typeof this.symbol !== "string" || this.symbol.length === 0) {
      throw new Error(`[DecisionEngine] symbol must be a non-empty string`);
    }
  }

  // -------------------------------------------------------------------------
  // DecisionEngineLike interface
  // -------------------------------------------------------------------------

  // -------------------------------------------------------------------------
  // Internal — arbitration logic
  // -------------------------------------------------------------------------

  /**
   * `ingest` — push a signal into the per-symbol pending buffer. Called
   * from each bus subscription in `subscribe()`.
   */
  private ingest(signal: Signal): void {
    const attributedSymbol =
      signal.symbol ?? (signal.kind === "funding-snapshot" ? signal.asset : this.symbol);
    if (attributedSymbol !== this.symbol) return;
    const array = this.pendingBySymbol.get(attributedSymbol);
    if (array === undefined) {
      const fresh: Signal[] = [signal];
      this.pendingBySymbol.set(attributedSymbol, fresh);
    } else {
      array.push(signal);
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
  private arbitrate(symbol: string, timestampMs: number, signals: readonly Signal[]): PositionDecision {
    let longWeight = 0;
    let shortWeight = 0;
    let flatWeight = 0;
    let totalStrength = 0;
    const sourceWeights = new Map<string, number>();
    let carrySizeMultiplier = 1;
    let sizingNotional: number | undefined;
    let isForceClose = false;

    for (const s of signals) {
      if (isDirection(s)) {
        const w = this.weightFor(s.source);
        const contribution = w * s.strength;
        if (s.side === "long") longWeight += contribution;
        else if (s.side === "short") shortWeight += contribution;
        else flatWeight += contribution;
        totalStrength += contribution;
        sourceWeights.set(s.source, (sourceWeights.get(s.source) ?? 0) + contribution);
      } else if (isCarry(s)) {
        // Carry signal adjusts sizeMultiplier (does NOT veto direction).
        let regimeMult: number;
        if (s.regime === "high") regimeMult = 1.2;
        else if (s.regime === "flip") regimeMult = 0.5;
        else regimeMult = 1;
        // Compose multiplicatively — multiple carry signals should
        // multiply, not overwrite.
        carrySizeMultiplier *= regimeMult;
        // Cap carry influence at 1.5 (defensive — never scale up past
        // the carry high regime bias).
        if (carrySizeMultiplier > 1.5) carrySizeMultiplier = 1.5;
        sourceWeights.set(s.source, (sourceWeights.get(s.source) ?? 0) + this.weightFor(s.source));
      } else if (isSizing(s)) {
        // `notional` is the final sizing-plugin output. Pick the most
        // defensive proposal and never apply volMultiplier a second time.
        const candidate = Math.abs(s.notional);
        sizingNotional = sizingNotional === undefined ? candidate : Math.min(sizingNotional, candidate);
        sourceWeights.set(s.source, sourceWeights.get(s.source) ?? 0);
      } else if (isRisk(s)) {
        // Defensive RiskSignals with sizeModifier override.
        if (s.sizeModifier !== undefined && s.sizeModifier < this._defensiveSizeModifier) {
          this._defensiveSizeModifier = Math.max(0, s.sizeModifier);
        }
        if (s.breach === true || (s.closeNotionalUsd ?? 0) > 0) {
          isForceClose = true;
        }
        sourceWeights.set(s.source, (sourceWeights.get(s.source) ?? 0) + this.weightFor(s.source));
      } else if (isFactor(s) || isFundingSnapshot(s)) {
        // Informational only — never veto, never contribute to weight.
        // Touch the sourceWeights so attribution isn't lost, but at 0.
        sourceWeights.set(s.source, sourceWeights.get(s.source) ?? 0);
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

    if (isForceClose) side = "flat";

    // Sizing plugins already applied their own Kelly/vol transforms to
    // `notional`; only cross-cutting carry and risk modifiers apply here.
    const sizeMultiplier = Math.max(0, Math.min(1, carrySizeMultiplier * this._defensiveSizeModifier));

    // Notional: prefer SizingSignals' average notional, scaled by side
    // sign. If no sizing signals, derive from baseNotional × sizeMult × confidence.
    let notionalUsd: number;
    notionalUsd = sizingNotional !== undefined && sizingNotional > 0 ? sizingNotional * sizeMultiplier : 0;
    // Hard ceiling for a single decision.
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
    // Reset defensive size modifier — single-bar scope (it's per-bar
    // info, not persistent state).
    this._defensiveSizeModifier = 1;

    const decision: PositionDecision = Object.freeze({
      symbol,
      side,
      notionalUsd: Math.max(0, Math.abs(notionalUsd)) * (side === "short" ? -1 : 1),
      sizeMultiplier,
      confidence,
      sourceWeights: Object.freeze(Object.fromEntries(sourceWeights)),
      timestampMs,
    });
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

  synthesize(symbol: string, timestampMs: number): PositionDecision | undefined {
    const pending = this.pendingBySymbol.get(symbol);
    if (pending === undefined || pending.length === 0) return undefined;
    this.pendingBySymbol.set(symbol, []);
    return this.arbitrate(symbol, timestampMs, pending);
  }

  reset(): void {
    this.pendingBySymbol.clear();
    this._decisions.length = 0;
    this._weightCache.clear();
    this._defensiveSizeModifier = 1;
  }

  latestDecision(symbol: string): PositionDecision | undefined {
    let latest: PositionDecision | undefined;
    for (const decision of this._decisions) {
      if (decision.symbol === symbol) latest = decision;
    }
    return latest;
  }

  decisions(): readonly PositionDecision[] {
    return Object.freeze([...this._decisions]);
  }

  subscribe(bus: SignalBus): UnsubscribeFunction {
    const kinds = ["direction", "carry", "sizing", "risk", "factor", "funding-snapshot"] as const;
    for (const kind of kinds) {
      const unsubscribe = bus.subscribe(kind, (signal: Signal) => {
        this.ingest(signal);
      });
      this._unsubscribers.push(unsubscribe);
    }
    return () => {
      for (const unsubscribe of this._unsubscribers) {
        try {
          unsubscribe();
        } catch {
          // Best-effort cleanup.
        }
      }
      this._unsubscribers.length = 0;
    };
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
  throw new Error(`[DecisionEngine] Non-exhaustive Signal switch — unhandled kind: ${JSON.stringify(x)}`);
}

// ---------------------------------------------------------------------------
// Re-export types for downstream consumers
// ---------------------------------------------------------------------------

/**
Re-export Signal types so consumers don't need 2 imports.
*/

export {
  type CarrySignal,
  type DirectionSignal,
  type FactorSignal,
  type FundingSnapshotSignal,
  type RiskSignal,
  type SizingSignal,
} from "../signal-center/types.js";
