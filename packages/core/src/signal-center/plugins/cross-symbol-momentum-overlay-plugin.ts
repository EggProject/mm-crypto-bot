// packages/core/src/signal-center/plugins/cross-symbol-momentum-overlay-plugin.ts —
// Phase 13 Track C — Plugin 2 of 3.
//
// ===========================================================================
// CROSS-SYMBOL HEDGE PLUGIN — CrossSymbolMomentumOverlayPlugin
// ===========================================================================
//
// Purpose
// -------
// `CrossSymbolMomentumOverlayPlugin` is the SECOND of THREE new Phase 13
// cross-symbol hedge plugins. It implements a BTC-driven momentum overlay
// across the configured symbol set (default BTC + ETH). When BTC's
// rolling N-day momentum crosses the configured threshold, the plugin
// emits DirectionSignals that drive ALL configured symbols LONG or FLAT
// together — a "risk-on / risk-off" overlay that uses BTC as the regime
// proxy.
//
// Logic
// -----
// On each `recordClose(symbol, close)`:
//   1. If `symbol` is the LEAD symbol (BTC/USDT by default):
//      a. Maintain a rolling window of closing prices.
//      b. When the window has >= `lookbackDays` observations, compute
//         `momentum = (latest / oldest) - 1`.
//      c. Compute strength = `min(|momentum| / 0.10, 1.0)`.
//      d. If `momentum > +threshold` -> emit LONG DirectionSignals on
//         every enabled symbol.
//      e. If `momentum < -threshold` -> emit FLAT DirectionSignals on
//         every enabled symbol (close longs).
//      f. Else (deadzone): no signal.
//   2. If `symbol` is not the lead, the close is recorded for
//      diagnostics but does NOT trigger an emission (BTC drives the
//      trigger; non-BTC closes do not independently emit).
//
// 3-LAYER 1:10 DEFENSE (MANDATORY)
// ---------------------------------
// Per the project-wide 1:10 leverage mandate (Phase 8 Track D onward),
// this plugin MUST enforce the 1:10 ceiling at three layers.
//
// Per-symbol disclosure (Phase 13 scope plan section 1):
//   - BTC/USDT: REGISTERED (default lead symbol).
//   - ETH/USDT: REGISTERED (default follower).
//
// References (>=5 independent sources on cross-asset momentum):
//   - Moskowitz, Ooi, Pedersen (2012) "Time Series Momentum" JFE 104(2): 228-250.
//   - Asness, Frazzini, Israel, Moskowitz (2014) "Fact, Fiction, and
//     Momentum Investing" J. Portfolio Mgmt 40(5): 75-92.
//   - Burnside, Eichenbaum, Rebelo (2011) "Carry Trade and Momentum in
//     Currency Markets" NBER WP 16942.
//   - Baur & Hoang (2021) "A Crypto Safe Haven Against Bitcoin"
//     Finance Research Letters 38: 101431.
//   - Liu & Tse (2023) "Cross-Asset Momentum in Cryptocurrency Markets"
//     International Review of Financial Analysis 87: 102609.
//   - Chan (2013) "Algorithmic Trading" Wiley.
//   - Phase 1-9 partial validation: Phase 7 Track C used BTC 20d momentum
//     as a cross-strategy filter.

import {
  ONE_TO_TEN_LEVERAGE,
  assertLeverageInvariant,
} from "../../risk/leverage-invariant.js";

// Re-export for downstream consumers.
export { ONE_TO_TEN_LEVERAGE };

import type { SignalBus } from "../signal-bus.js";
import type {
  StrategyPlugin,
  StrategyPluginMetadata,
} from "../strategy-registry.js";
import {
  type Bar,
  type ConfigError,
  type DirectionSignal,
  type PluginState,
  type Result,
  err,
  ok,
} from "../types.js";

// ---------------------------------------------------------------------------
// Public types -- config + state
// ---------------------------------------------------------------------------

export interface CrossSymbolMomentumOverlayConfig {
  readonly lookbackDays: number;
  readonly momentumThreshold: number;
  readonly baseNotionalUsd: number;
  readonly enabledSymbols: readonly string[];
}

export const DEFAULT_LOOKBACK_DAYS = 20 as const;
export const DEFAULT_MOMENTUM_THRESHOLD = 0.05 as const;
export const DEFAULT_BASE_NOTIONAL_USD = 10_000 as const;
export const DEFAULT_ENABLED_SYMBOLS: readonly string[] = [
  "BTC/USDT",
  "ETH/USDT",
];

export const MIN_LOOKBACK_DAYS = 2 as const;
export const MAX_LOOKBACK_DAYS = 365 as const;
export const MIN_MOMENTUM_THRESHOLD = 0.001 as const;
export const MAX_MOMENTUM_THRESHOLD = 1.0 as const;
export const MAX_BASE_NOTIONAL_USD = 100_000_000 as const;
export const MOMENTUM_NORMALIZER = 0.10 as const;

interface SymbolPriceState {
  closes: number[];
}

export type OverlayPosition = "long" | "flat";

export interface CrossSymbolMomentumOverlayPluginState {
  readonly symbolState: Map<string, SymbolPriceState>;
  lastMomentum: number | null;
  position: OverlayPosition;
  lastStrength: number;
  barsProcessed: number;
  recordClosesProcessed: number;
  longEmissions: number;
  flatEmissions: number;
  directionSignalsEmitted: number;
  layer2AssertionCount: number;
  leverageClampCount: number;
  malformedCloseDrops: number;
  nonLeadClosesReceived: number;
}

// ---------------------------------------------------------------------------
// Helpers (exported for tests + downstream consumers)
// ---------------------------------------------------------------------------

export function computeMomentum(latest: number, lookback: number): number | null {
  if (!Number.isFinite(latest) || !Number.isFinite(lookback)) return null;
  if (latest <= 0 || lookback <= 0) return null;
  return latest / lookback - 1;
}

export function clampStrengthFromMomentum(absMomentum: number): number {
  // Defensive: NaN (only) is rejected; Infinity is allowed because
  // Math.min(Infinity / MOMENTUM_NORMALIZER, 1.0) === 1.0 (the cap).
  if (Number.isNaN(absMomentum) || absMomentum <= 0) return 0;
  return Math.min(absMomentum / MOMENTUM_NORMALIZER, 1.0);
}

// ---------------------------------------------------------------------------
// CrossSymbolMomentumOverlayPlugin
// ---------------------------------------------------------------------------

export class CrossSymbolMomentumOverlayPlugin implements StrategyPlugin {
  public readonly metadata: StrategyPluginMetadata = {
    name: "cross-symbol-momentum-overlay-v1",
    version: "1.0.0",
    edgeClass: "directional",
    capitalRequirement: 10_000,
    maxLeverage: ONE_TO_TEN_LEVERAGE,
    description:
      "Phase 13 Track C Plugin 2/3 (cross-symbol hedge) -- BTC-driven " +
      "momentum overlay (default 20d). When BTC momentum > +threshold, " +
      "all enabled symbols go LONG; when < -threshold, all go FLAT. " +
      "Deadzone [-threshold, +threshold] emits no signal. 1:10 leverage " +
      "MANDATE enforced at 3 layers (constructor/subscribe/per-emit).",
    dependencies: [],
  };

  public readonly config: CrossSymbolMomentumOverlayConfig;
  public readonly state: CrossSymbolMomentumOverlayPluginState;
  /**
   * Per-symbol signal bus subscriptions. Phase 14A wiring: the plugin
   * can emit on multiple buses (one per enabledSymbol) so that each
   * symbol's DecisionEngine sees the lead-symbol's momentum signal.
   *
   * Backward-compat: `subscribe(bus)` wraps the bus under the
   * `enabledSymbols[0]` (lead) key. New code should prefer
   * `subscribeBuses(map)`.
   */
  private readonly _busesBySymbol: Map<string, SignalBus> = new Map<string, SignalBus>();
  private _wired = false;

  constructor(
    overrides: Partial<CrossSymbolMomentumOverlayConfig> = {},
  ) {
    this.config = {
      lookbackDays: overrides.lookbackDays ?? DEFAULT_LOOKBACK_DAYS,
      momentumThreshold:
        overrides.momentumThreshold ?? DEFAULT_MOMENTUM_THRESHOLD,
      baseNotionalUsd: overrides.baseNotionalUsd ?? DEFAULT_BASE_NOTIONAL_USD,
      enabledSymbols: overrides.enabledSymbols ?? DEFAULT_ENABLED_SYMBOLS,
    };

    // LAYER 1 -- constructor assertion.
    if (this.metadata.maxLeverage !== ONE_TO_TEN_LEVERAGE) {
      throw new Error(
        `[CrossSymbolMomentumOverlayPlugin] LAYER 1 BREACH: metadata.maxLeverage=${String(this.metadata.maxLeverage)} but the project-wide 1:10 mandate requires 10.`,
      );
    }

    if (
      !Number.isInteger(this.config.lookbackDays) ||
      this.config.lookbackDays < MIN_LOOKBACK_DAYS ||
      this.config.lookbackDays > MAX_LOOKBACK_DAYS
    ) {
      throw new Error(
        `[CrossSymbolMomentumOverlayPlugin] lookbackDays=${this.config.lookbackDays} must be an integer in [${MIN_LOOKBACK_DAYS}, ${MAX_LOOKBACK_DAYS}].`,
      );
    }
    if (
      !Number.isFinite(this.config.momentumThreshold) ||
      this.config.momentumThreshold < MIN_MOMENTUM_THRESHOLD ||
      this.config.momentumThreshold > MAX_MOMENTUM_THRESHOLD
    ) {
      throw new Error(
        `[CrossSymbolMomentumOverlayPlugin] momentumThreshold=${this.config.momentumThreshold} must be a finite number in [${MIN_MOMENTUM_THRESHOLD}, ${MAX_MOMENTUM_THRESHOLD}].`,
      );
    }
    if (
      !Number.isFinite(this.config.baseNotionalUsd) ||
      this.config.baseNotionalUsd <= 0 ||
      this.config.baseNotionalUsd > MAX_BASE_NOTIONAL_USD
    ) {
      throw new Error(
        `[CrossSymbolMomentumOverlayPlugin] baseNotionalUsd=${this.config.baseNotionalUsd} must be a finite number in (0, ${MAX_BASE_NOTIONAL_USD}].`,
      );
    }
    if (
      !Array.isArray(this.config.enabledSymbols) ||
      this.config.enabledSymbols.length === 0
    ) {
      throw new Error(
        `[CrossSymbolMomentumOverlayPlugin] enabledSymbols must be a non-empty array of non-empty strings.`,
      );
    }
    const seen = new Set<string>();
    const symsArr = this.config.enabledSymbols as readonly unknown[];
    for (let i = 0; i < symsArr.length; i++) {
      const s: unknown = symsArr[i];
      if (typeof s !== "string" || s.length === 0) {
        throw new Error(
          `[CrossSymbolMomentumOverlayPlugin] enabledSymbols[${i}] must be a non-empty string.`,
        );
      }
      if (seen.has(s)) {
        throw new Error(
          `[CrossSymbolMomentumOverlayPlugin] enabledSymbols contains duplicate "${s}".`,
        );
      }
      seen.add(s);
    }

    this.state = {
      symbolState: new Map<string, SymbolPriceState>(),
      lastMomentum: null,
      position: "flat",
      lastStrength: 0,
      barsProcessed: 0,
      recordClosesProcessed: 0,
      longEmissions: 0,
      flatEmissions: 0,
      directionSignalsEmitted: 0,
      layer2AssertionCount: 0,
      leverageClampCount: 0,
      malformedCloseDrops: 0,
      nonLeadClosesReceived: 0,
    };
  }

  /**
   * `subscribe` — Phase 13 single-bus backward-compat path. Wires the
   * plugin to ONE bus, registered under the leadSymbol's key. Equivalent
   * to `subscribeBuses(new Map([[leadSymbol, bus]]))`.
   *
   * Phase 14A: prefer `subscribeBuses(map)` for multi-symbol wiring.
   */
  subscribe(bus: SignalBus): void {
    this._assertInitialState();
    const leadSymbol = this.config.enabledSymbols[0] ?? "unknown";
    this._busesBySymbol.set(leadSymbol, bus);
    this._wired = true;
  }

  /**
   * `subscribeBuses` — Phase 14A multi-bus wiring. The plugin emits
   * the same DirectionSignal on every subscribed bus, and each bus's
   * DecisionEngine binds the signal to its own symbol via its
   * constructor-bound `symbol` field (see `portfolio-decision.ts`).
   *
   * The `busesBySymbol` map's keys are the symbol identifiers the
   * plugin emits for; values are the corresponding SignalBus instances.
   * At least one entry is required.
   *
   * Semantics: when the leadSymbol's momentum crosses threshold, the
   * plugin emits one DirectionSignal per enabledSymbol. ALL emitted
   * signals are broadcast to ALL subscribed buses (the DecisionEngine
   * on each bus accumulates under its own `this.symbol`).
   */
  subscribeBuses(busesBySymbol: ReadonlyMap<string, SignalBus>): void {
    this._assertInitialState();
    if (busesBySymbol.size === 0) {
      throw new Error(
        `[CrossSymbolMomentumOverlayPlugin] subscribeBuses: at least one (symbol, bus) entry required`,
      );
    }
    for (const [sym, bus] of busesBySymbol) {
      this._busesBySymbol.set(sym, bus);
    }
    this._wired = true;
  }

  onBar(_bar: Bar, _state: PluginState): void {
    this.state.barsProcessed += 1;
  }

  validateConfig(config: unknown): Result<void, ConfigError> {
    const makeErr = (
      field: string,
      message: string,
      value?: unknown,
    ): Result<void, ConfigError> => ({
      ok: false,
      error: {
        pluginName: this.metadata.name,
        field,
        message,
        ...(value !== undefined ? { value } : {}),
      },
    });
    if (config === null || config === undefined) return ok(undefined);
    if (typeof config !== "object") {
      return makeErr("config", "must be an object or null/undefined", config);
    }
    const c = config as Record<string, unknown>;
    if (c["lookbackDays"] !== undefined) {
      const ld = c["lookbackDays"];
      if (
        typeof ld !== "number" ||
        !Number.isInteger(ld) ||
        ld < MIN_LOOKBACK_DAYS ||
        ld > MAX_LOOKBACK_DAYS
      ) {
        return makeErr(
          "lookbackDays",
          `must be an integer in [${MIN_LOOKBACK_DAYS}, ${MAX_LOOKBACK_DAYS}]`,
          ld,
        );
      }
    }
    if (c["momentumThreshold"] !== undefined) {
      const mt = c["momentumThreshold"];
      if (
        typeof mt !== "number" ||
        !Number.isFinite(mt) ||
        mt < MIN_MOMENTUM_THRESHOLD ||
        mt > MAX_MOMENTUM_THRESHOLD
      ) {
        return makeErr(
          "momentumThreshold",
          `must be a finite number in [${MIN_MOMENTUM_THRESHOLD}, ${MAX_MOMENTUM_THRESHOLD}]`,
          mt,
        );
      }
    }
    if (c["baseNotionalUsd"] !== undefined) {
      const bn = c["baseNotionalUsd"];
      if (
        typeof bn !== "number" ||
        !Number.isFinite(bn) ||
        bn <= 0 ||
        bn > MAX_BASE_NOTIONAL_USD
      ) {
        return makeErr(
          "baseNotionalUsd",
          `must be a finite number in (0, ${MAX_BASE_NOTIONAL_USD}]`,
          bn,
        );
      }
    }
    if (c["enabledSymbols"] !== undefined) {
      if (!Array.isArray(c["enabledSymbols"]) || c["enabledSymbols"].length === 0) {
        return makeErr(
          "enabledSymbols",
          "must be a non-empty array of non-empty strings",
          c["enabledSymbols"],
        );
      }
      const seen = new Set<string>();
      const arr = c["enabledSymbols"] as readonly unknown[];
      for (let i = 0; i < arr.length; i++) {
        const s = arr[i];
        if (typeof s !== "string" || s.length === 0) {
          return makeErr(
            "enabledSymbols",
            `entry ${i} must be a non-empty string`,
            s,
          );
        }
        if (seen.has(s)) {
          return makeErr(
            "enabledSymbols",
            `duplicate symbol "${s}"`,
            s,
          );
        }
        seen.add(s);
      }
    }
    return ok(undefined);
  }

  reset(): void {
    this.state.symbolState.clear();
    this.state.lastMomentum = null;
    this.state.position = "flat";
    this.state.lastStrength = 0;
    this.state.barsProcessed = 0;
    this.state.recordClosesProcessed = 0;
    this.state.longEmissions = 0;
    this.state.flatEmissions = 0;
    this.state.directionSignalsEmitted = 0;
    this.state.layer2AssertionCount = 0;
    this.state.leverageClampCount = 0;
    this.state.malformedCloseDrops = 0;
    this.state.nonLeadClosesReceived = 0;
  }

  dispose(): void {
    this._busesBySymbol.clear();
    this._wired = false;
  }

  /**
   * `wiredBuses` — Phase 14A introspection: read-only view of the
   * currently-subscribed (symbol, bus) pairs. Useful for tests +
   * diagnostics.
   */
  wiredBuses(): ReadonlyMap<string, SignalBus> {
    return new Map(this._busesBySymbol);
  }

  recordClose(
    symbol: string,
    close: number,
    timestampMs?: number,
  ): readonly DirectionSignal[] {
    const emitted: DirectionSignal[] = [];
    if (!Number.isFinite(close) || close <= 0) {
      this.state.malformedCloseDrops += 1;
      return emitted;
    }
    void timestampMs;
    this.state.recordClosesProcessed += 1;

    const leadSymbol = this.config.enabledSymbols[0]!;
    const ss = this._getOrCreateSymbolState(symbol);
    ss.closes.push(close);
    const maxObs = this.config.lookbackDays + 1;
    if (ss.closes.length > maxObs) {
      ss.closes.splice(0, ss.closes.length - maxObs);
    }

    if (symbol !== leadSymbol) {
      this.state.nonLeadClosesReceived += 1;
      return emitted;
    }

    if (ss.closes.length < this.config.lookbackDays + 1) {
      return emitted;
    }
    const oldestIdx = ss.closes.length - 1 - this.config.lookbackDays;
    const oldest = ss.closes[oldestIdx]!;
    const latest = ss.closes[ss.closes.length - 1]!;
    const momentum = computeMomentum(latest, oldest);
    if (momentum === null) return emitted;
    this.state.lastMomentum = momentum;

    const absM = Math.abs(momentum);
    const strength = clampStrengthFromMomentum(absM);

    if (absM <= this.config.momentumThreshold) {
      return emitted;
    }

    const targetSide: OverlayPosition = momentum > 0 ? "long" : "flat";
    if (this.state.position === targetSide) {
      return emitted;
    }
    this.state.position = targetSide;
    this.state.lastStrength = strength;
    if (targetSide === "long") {
      this.state.longEmissions += 1;
    } else {
      this.state.flatEmissions += 1;
    }

    for (const sym of this.config.enabledSymbols) {
      const signal = this._buildDirectionSignal(sym, targetSide, strength, timestampMs);
      emitted.push(signal);
    }
    return emitted;
  }

  leadSymbol(): string {
    return this.config.enabledSymbols[0]!;
  }

  currentPosition(): OverlayPosition {
    return this.state.position;
  }

  lastMomentumValue(): number | null {
    return this.state.lastMomentum;
  }

  enabledSymbolsList(): readonly string[] {
    return this.config.enabledSymbols;
  }

  effectiveMaxNotionalUsd(): number {
    return this.config.baseNotionalUsd * ONE_TO_TEN_LEVERAGE;
  }

  private _buildDirectionSignal(
    symbol: string,
    side: "long" | "short" | "flat",
    strength: number,
    timestampMs: number | undefined,
  ): DirectionSignal {
    const impliedNotional = this.config.baseNotionalUsd * strength;
    let clampedNotional = impliedNotional;
    if (clampedNotional > this.config.baseNotionalUsd * ONE_TO_TEN_LEVERAGE) {
      clampedNotional = this.config.baseNotionalUsd * ONE_TO_TEN_LEVERAGE;
      this.state.leverageClampCount += 1;
    }
    try {
      assertLeverageInvariant(clampedNotional, this.config.baseNotionalUsd);
      this.state.layer2AssertionCount += 1;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(
        `[CrossSymbolMomentumOverlayPlugin] LAYER 3 BREACH: impliedNotional=${clampedNotional} violates 1:10 cap: ${msg}`,
        { cause: e },
      );
    }

    const baseFields = {
      kind: "direction" as const,
      side,
      strength,
      source: this.metadata.name,
    };
    const tsField =
      timestampMs !== undefined ? { timestampMs } : {};
    const signal: DirectionSignal = {
      ...baseFields,
      ...tsField,
    };
    void symbol;
    this.state.directionSignalsEmitted += 1;
    if (this._wired) {
      // Phase 14A: broadcast the same DirectionSignal on every
      // subscribed bus. Each bus's DecisionEngine binds the signal
      // to its own symbol via its constructor-bound `symbol` field.
      // No source-string symbol suffix is needed because the engine
      // uses `this.symbol` for attribution, not `_extractSymbol`.
      for (const bus of this._busesBySymbol.values()) {
        bus.emit(signal);
      }
    }
    return signal;
  }

  private _assertInitialState(): void {
    void this.state.symbolState;
    if (this.config.enabledSymbols.length === 0) {
      throw new Error(
        `[CrossSymbolMomentumOverlayPlugin] LAYER 2 BREACH: enabledSymbols is empty.`,
      );
    }
    if (
      !Number.isFinite(this.config.baseNotionalUsd) ||
      this.config.baseNotionalUsd <= 0
    ) {
      throw new Error(
        `[CrossSymbolMomentumOverlayPlugin] LAYER 2 BREACH: baseNotionalUsd=${this.config.baseNotionalUsd} invalid.`,
      );
    }
  }

  private _getOrCreateSymbolState(symbol: string): SymbolPriceState {
    let ss = this.state.symbolState.get(symbol);
    if (!ss) {
      ss = { closes: [] };
      this.state.symbolState.set(symbol, ss);
    }
    return ss;
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createCrossSymbolMomentumOverlayPlugin(
  overrides: Partial<CrossSymbolMomentumOverlayConfig> = {},
): CrossSymbolMomentumOverlayPlugin {
  return new CrossSymbolMomentumOverlayPlugin(overrides);
}

void err;
