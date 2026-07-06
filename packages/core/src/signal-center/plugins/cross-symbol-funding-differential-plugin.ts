// packages/core/src/signal-center/plugins/cross-symbol-funding-differential-plugin.ts —
// Phase 13 Track C — Plugin 3 of 3.
//
// ===========================================================================
// CROSS-SYMBOL HEDGE PLUGIN — CrossSymbolFundingDifferentialPlugin
// ===========================================================================
//
// Purpose
// -------
// `CrossSymbolFundingDifferentialPlugin` is the THIRD of THREE new Phase 13
// cross-symbol hedge plugins. It implements cross-symbol funding-rate
// arbitrage — for each enabled pair (e.g. BTC vs ETH), the plugin reads
// the latest funding rate on each leg and emits DirectionSignals that
// short the high-funding leg (you collect funding) and long the low-
// funding leg (you pay funding but at a lower rate). The net result is
// cross-neutral in notional direction with a positive funding carry.
//
// Logic
// -----
// On each `recordFundingRate(symbol, rate, timestampMs)`:
//   1. For each enabled pair (a, b):
//      - If symbol is neither a nor b -> skip.
//      - If symbol is a or b -> record the rate for that leg.
//   2. After recording, if BOTH legs of any pair have a rate available:
//      - Compute `differential = abs(fundingA - fundingB)`.
//      - If `differential > minDifferentialPer8h`:
//        - Emit DirectionSignal side='short' on HIGH leg.
//        - Emit DirectionSignal side='long' on LOW leg.
//        - Emit CarrySignal regime='high' for the pair.
//      - Else:
//        - Emit DirectionSignal side='flat' on both legs (no edge).
//
// 3-LAYER 1:10 DEFENSE (MANDATORY)
// ---------------------------------
// Per the project-wide 1:10 leverage mandate.
//
// Per-symbol disclosure (Phase 13 scope plan section 1):
//   - BTC/USDT: REGISTERED (default).
//   - ETH/USDT: REGISTERED (default).
//
// References (>=5 independent sources on cross-symbol funding arb):
//   - Bybit Institutional (2025) "Delta-Neutral Carry Strategies".
//   - bagtester / ainvest / ScienceDirect -- empirical carry edge.
//   - MiCAR (EU) 2023/1114 -- bybit.eu SPOT-only for retail, no perps.
//   - Buildix "Cross-DEX Funding Arbitrage Guide" (2026) -- spread
//     thresholds; meaningful edge > 0.05% per 8h interval.
//   - ArbitrageScanner (Jun 2026) -- HYPE/Binance 28-42% APR.
//   - CoinGlass "Funding Rate Tracker" -- cross-venue ranking.
//   - BitMEX Q3 2025 Derivatives Report "Anchors and Ceilings".
//   - Phase 1-9 partial validation: Phase 6 Track A (FundingCarryStrategy).

import {
  ONE_TO_TEN_LEVERAGE,
  assertLeverageInvariant,
} from "../../risk/leverage-invariant.js";

export { ONE_TO_TEN_LEVERAGE };

import type { SignalBus } from "../signal-bus.js";
import type {
  StrategyPlugin,
  StrategyPluginMetadata,
} from "../strategy-registry.js";
import {
  type Bar,
  type CarrySignal,
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

export type SymbolPair = readonly [string, string];

export interface CrossSymbolFundingDifferentialConfig {
  readonly minDifferentialPer8h: number;
  readonly baseNotionalUsd: number;
  readonly enabledPairs: readonly SymbolPair[];
}

export const DEFAULT_MIN_DIFFERENTIAL_PER_8H = 0.0001 as const;
export const DEFAULT_BASE_NOTIONAL_USD = 10_000 as const;
export const DEFAULT_ENABLED_PAIRS: readonly SymbolPair[] = [
  ["BTC/USDT", "ETH/USDT"],
];

export const MIN_MIN_DIFFERENTIAL = 0.0 as const;
export const MAX_MIN_DIFFERENTIAL = 0.01 as const;
export const MAX_BASE_NOTIONAL_USD = 100_000_000 as const;
export const DEFAULT_DIFFERENTIAL_NORMALIZER = 0.001 as const;

interface PairFundingState {
  fundingA: number | null;
  fundingB: number | null;
  tsAMs: number | null;
  tsBMs: number | null;
  carryActive: boolean;
  lastDifferential: number | null;
  entryCount: number;
  exitCount: number;
  lastDirectionA: DirectionSignal | null;
  lastDirectionB: DirectionSignal | null;
  lastCarrySignal: CarrySignal | null;
}

export interface CrossSymbolFundingDifferentialPluginState {
  readonly pairState: Map<string, PairFundingState>;
  recordFundingCalls: number;
  directionSignalsEmitted: number;
  carrySignalsEmitted: number;
  barsProcessed: number;
  layer2AssertionCount: number;
  leverageClampCount: number;
  malformedRateDrops: number;
  /**
   * Phase 14A: number of signals (Direction or Carry) that could not
   * be routed because no bus was subscribed for the leg's symbol.
   * Should always be 0 in production.
   */
  unroutedEmissions: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function pairKey(pair: SymbolPair): string {
  return `${pair[0]}|${pair[1]}`;
}

export function computeFundingDifferential(
  rateA: number,
  rateB: number,
): number | null {
  // Defensive: NaN rejected (only). Infinity propagates via abs().
  if (Number.isNaN(rateA) || Number.isNaN(rateB)) return null;
  return Math.abs(rateA - rateB);
}

export function clampStrengthFromDifferential(d: number): number {
  // Defensive: NaN rejected. Infinity allowed (capped at 1.0).
  if (Number.isNaN(d) || d <= 0) return 0;
  return Math.min(d / DEFAULT_DIFFERENTIAL_NORMALIZER, 1.0);
}

// ---------------------------------------------------------------------------
// CrossSymbolFundingDifferentialPlugin
// ---------------------------------------------------------------------------

export class CrossSymbolFundingDifferentialPlugin implements StrategyPlugin {
  public readonly metadata: StrategyPluginMetadata = {
    name: "cross-symbol-funding-differential-v1",
    version: "1.0.0",
    edgeClass: "carry",
    capitalRequirement: 10_000,
    maxLeverage: ONE_TO_TEN_LEVERAGE,
    description:
      "Phase 13 Track C Plugin 3/3 (cross-symbol hedge) -- cross-symbol " +
      "funding-rate carry arbitrage. Short the HIGH funding leg, long the " +
      "LOW funding leg when differential > minDifferentialPer8h. Emits " +
      "CarrySignal regime='high' alongside DirectionSignals. 1:10 leverage " +
      "MANDATE enforced at 3 layers (constructor/subscribe/per-emit).",
    dependencies: [],
  };

  public readonly config: CrossSymbolFundingDifferentialConfig;
  public readonly state: CrossSymbolFundingDifferentialPluginState;
  /**
   * Per-symbol signal bus subscriptions. Phase 14A wiring: each leg's
   * DirectionSignal routes to the bus matching that leg's symbol.
   * CarrySignals (informational) route to the high-leg's bus.
   *
   * Backward-compat: `subscribe(bus)` wraps the bus under the first
   * enabledPair's legA. New code should prefer `subscribeBuses(map)`.
   */
  private readonly _busesBySymbol: Map<string, SignalBus> = new Map();
  private _wired = false;

  constructor(
    overrides: Partial<CrossSymbolFundingDifferentialConfig> = {},
  ) {
    this.config = {
      minDifferentialPer8h:
        overrides.minDifferentialPer8h ?? DEFAULT_MIN_DIFFERENTIAL_PER_8H,
      baseNotionalUsd: overrides.baseNotionalUsd ?? DEFAULT_BASE_NOTIONAL_USD,
      enabledPairs: overrides.enabledPairs ?? DEFAULT_ENABLED_PAIRS,
    };

    if (this.metadata.maxLeverage !== ONE_TO_TEN_LEVERAGE) {
      throw new Error(
        `[CrossSymbolFundingDifferentialPlugin] LAYER 1 BREACH: metadata.maxLeverage=${String(this.metadata.maxLeverage)} but the project-wide 1:10 mandate requires 10.`,
      );
    }

    if (
      !Number.isFinite(this.config.minDifferentialPer8h) ||
      this.config.minDifferentialPer8h < MIN_MIN_DIFFERENTIAL ||
      this.config.minDifferentialPer8h > MAX_MIN_DIFFERENTIAL
    ) {
      throw new Error(
        `[CrossSymbolFundingDifferentialPlugin] minDifferentialPer8h=${this.config.minDifferentialPer8h} must be a finite number in [${MIN_MIN_DIFFERENTIAL}, ${MAX_MIN_DIFFERENTIAL}].`,
      );
    }
    if (
      !Number.isFinite(this.config.baseNotionalUsd) ||
      this.config.baseNotionalUsd <= 0 ||
      this.config.baseNotionalUsd > MAX_BASE_NOTIONAL_USD
    ) {
      throw new Error(
        `[CrossSymbolFundingDifferentialPlugin] baseNotionalUsd=${this.config.baseNotionalUsd} must be a finite number in (0, ${MAX_BASE_NOTIONAL_USD}].`,
      );
    }
    if (
      !Array.isArray(this.config.enabledPairs) ||
      this.config.enabledPairs.length === 0
    ) {
      throw new Error(
        `[CrossSymbolFundingDifferentialPlugin] enabledPairs must be a non-empty array of [a,b] tuples.`,
      );
    }
    const seenPairs = new Set<string>();
    const pairsArr = this.config.enabledPairs as readonly unknown[];
    for (let i = 0; i < pairsArr.length; i++) {
      const pRaw: unknown = pairsArr[i];
      if (!Array.isArray(pRaw) || pRaw.length !== 2) {
        throw new Error(
          `[CrossSymbolFundingDifferentialPlugin] enabledPairs[${i}] must be a [a, b] tuple of length 2.`,
        );
      }
      const pTuple = pRaw as readonly unknown[];
      const a = pTuple[0];
      const b = pTuple[1];
      if (typeof a !== "string" || a.length === 0) {
        throw new Error(
          `[CrossSymbolFundingDifferentialPlugin] enabledPairs[${i}][0] must be a non-empty string.`,
        );
      }
      if (typeof b !== "string" || b.length === 0) {
        throw new Error(
          `[CrossSymbolFundingDifferentialPlugin] enabledPairs[${i}][1] must be a non-empty string.`,
        );
      }
      if (a === b) {
        throw new Error(
          `[CrossSymbolFundingDifferentialPlugin] enabledPairs[${i}] = [${a}, ${b}] -- legs must differ.`,
        );
      }
      const key = pairKey([a, b]);
      if (seenPairs.has(key)) {
        throw new Error(
          `[CrossSymbolFundingDifferentialPlugin] enabledPairs contains duplicate pair [${a}, ${b}].`,
        );
      }
      seenPairs.add(key);
    }

    this.state = {
      pairState: new Map<string, PairFundingState>(),
      recordFundingCalls: 0,
      directionSignalsEmitted: 0,
      carrySignalsEmitted: 0,
      barsProcessed: 0,
      layer2AssertionCount: 0,
      leverageClampCount: 0,
      malformedRateDrops: 0,
      unroutedEmissions: 0,
    };

    for (const p of this.config.enabledPairs as readonly SymbolPair[]) {
      this.state.pairState.set(pairKey(p), {
        fundingA: null,
        fundingB: null,
        tsAMs: null,
        tsBMs: null,
        carryActive: false,
        lastDifferential: null,
        entryCount: 0,
        exitCount: 0,
        lastDirectionA: null,
        lastDirectionB: null,
        lastCarrySignal: null,
      });
    }
  }

  /**
   * `subscribe` — Phase 13 single-bus backward-compat path. Wires the
   * plugin to ONE bus, registered under the first enabledPair's legA.
   * Phase 14A: prefer `subscribeBuses(map)` for multi-symbol wiring.
   */
  subscribe(bus: SignalBus): void {
    this._assertInitialState();
    const firstPair = this.config.enabledPairs[0];
    const keySymbol = firstPair ? firstPair[0] : "unknown";
    this._busesBySymbol.set(keySymbol, bus);
    this._wired = true;
  }

  /**
   * `subscribeBuses` — Phase 14A multi-bus wiring. Each leg's
   * DirectionSignal routes to the bus matching that leg's symbol.
   * CarrySignals route to the high-leg's bus (where the carry is
   * "expensive" to be short — the symbol paying out funding).
   *
   * At least one entry is required.
   */
  subscribeBuses(busesBySymbol: ReadonlyMap<string, SignalBus>): void {
    this._assertInitialState();
    if (busesBySymbol.size === 0) {
      throw new Error(
        `[CrossSymbolFundingDifferentialPlugin] subscribeBuses: at least one (symbol, bus) entry required`,
      );
    }
    for (const [sym, bus] of busesBySymbol) {
      this._busesBySymbol.set(sym, bus);
    }
    this._wired = true;
  }

  /**
   * `wiredBuses` — Phase 14A introspection helper.
   */
  wiredBuses(): ReadonlyMap<string, SignalBus> {
    return new Map(this._busesBySymbol);
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
    if (c["minDifferentialPer8h"] !== undefined) {
      const md = c["minDifferentialPer8h"];
      if (
        typeof md !== "number" ||
        !Number.isFinite(md) ||
        md < MIN_MIN_DIFFERENTIAL ||
        md > MAX_MIN_DIFFERENTIAL
      ) {
        return makeErr(
          "minDifferentialPer8h",
          `must be a finite number in [${MIN_MIN_DIFFERENTIAL}, ${MAX_MIN_DIFFERENTIAL}]`,
          md,
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
    if (c["enabledPairs"] !== undefined) {
      if (!Array.isArray(c["enabledPairs"]) || c["enabledPairs"].length === 0) {
        return makeErr(
          "enabledPairs",
          "must be a non-empty array of [a, b] tuples",
          c["enabledPairs"],
        );
      }
      const seen = new Set<string>();
      const arr = c["enabledPairs"] as readonly unknown[];
      for (let i = 0; i < arr.length; i++) {
        const p = arr[i];
        if (!Array.isArray(p) || p.length !== 2) {
          return makeErr(
            "enabledPairs",
            `entry ${i} must be a [a, b] tuple of length 2`,
            p,
          );
        }
        const pTuple = p as readonly unknown[];
        const a = pTuple[0];
        const b = pTuple[1];
        if (typeof a !== "string" || a.length === 0) {
          return makeErr(
            "enabledPairs",
            `entry ${i}[0] must be a non-empty string`,
            a,
          );
        }
        if (typeof b !== "string" || b.length === 0) {
          return makeErr(
            "enabledPairs",
            `entry ${i}[1] must be a non-empty string`,
            b,
          );
        }
        if (a === b) {
          return makeErr(
            "enabledPairs",
            `entry ${i} = [${a}, ${b}] -- legs must differ`,
            p,
          );
        }
        const k = `${a}|${b}`;
        if (seen.has(k)) {
          return makeErr(
            "enabledPairs",
            `duplicate pair [${a}, ${b}]`,
            p,
          );
        }
        seen.add(k);
      }
    }
    return ok(undefined);
  }

  reset(): void {
    this.state.pairState.clear();
    for (const p of this.config.enabledPairs) {
      this.state.pairState.set(pairKey(p), {
        fundingA: null,
        fundingB: null,
        tsAMs: null,
        tsBMs: null,
        carryActive: false,
        lastDifferential: null,
        entryCount: 0,
        exitCount: 0,
        lastDirectionA: null,
        lastDirectionB: null,
        lastCarrySignal: null,
      });
    }
    this.state.recordFundingCalls = 0;
    this.state.directionSignalsEmitted = 0;
    this.state.carrySignalsEmitted = 0;
    this.state.barsProcessed = 0;
    this.state.layer2AssertionCount = 0;
    this.state.leverageClampCount = 0;
    this.state.malformedRateDrops = 0;
    this.state.unroutedEmissions = 0;
  }

  dispose(): void {
    this._busesBySymbol.clear();
    this._wired = false;
  }

  recordFundingRate(
    symbol: string,
    rate: number,
    timestampMs?: number,
  ): {
    directionSignals: readonly DirectionSignal[];
    carrySignals: readonly CarrySignal[];
  } {
    const directionSignals: DirectionSignal[] = [];
    const carrySignals: CarrySignal[] = [];
    if (!Number.isFinite(rate)) {
      this.state.malformedRateDrops += 1;
      return { directionSignals, carrySignals };
    }
    this.state.recordFundingCalls += 1;

    for (const pair of this.config.enabledPairs) {
      const [legA, legB] = pair;
      if (symbol !== legA && symbol !== legB) continue;
      const ps = this.state.pairState.get(pairKey(pair))!;
      if (symbol === legA) {
        ps.fundingA = rate;
        ps.tsAMs = timestampMs ?? null;
      } else {
        ps.fundingB = rate;
        ps.tsBMs = timestampMs ?? null;
      }
      if (ps.fundingA === null || ps.fundingB === null) continue;

      const differential = computeFundingDifferential(ps.fundingA, ps.fundingB);
      if (differential === null) continue;
      ps.lastDifferential = differential;

      if (differential > this.config.minDifferentialPer8h) {
        const highLeg = ps.fundingA >= ps.fundingB ? legA : legB;
        const lowLeg = ps.fundingA >= ps.fundingB ? legB : legA;
        if (!ps.carryActive) {
          ps.carryActive = true;
          ps.entryCount += 1;
        }
        const strength = clampStrengthFromDifferential(differential);
        const dirHigh = this._buildDirectionSignal(highLeg, "short", strength, timestampMs);
        const dirLow = this._buildDirectionSignal(lowLeg, "long", strength, timestampMs);
        ps.lastDirectionA = highLeg === legA ? dirHigh : dirLow;
        ps.lastDirectionB = lowLeg === legA ? dirLow : dirHigh;
        directionSignals.push(dirHigh, dirLow);

        const carry = this._buildCarrySignal(
          differential,
          "high",
          highLeg,
          lowLeg,
          timestampMs,
        );
        ps.lastCarrySignal = carry;
        carrySignals.push(carry);
      } else {
        if (ps.carryActive) {
          ps.carryActive = false;
          ps.exitCount += 1;
        }
        const strength = clampStrengthFromDifferential(differential);
        const dirA = this._buildDirectionSignal(legA, "flat", strength, timestampMs);
        const dirB = this._buildDirectionSignal(legB, "flat", strength, timestampMs);
        ps.lastDirectionA = dirA;
        ps.lastDirectionB = dirB;
        directionSignals.push(dirA, dirB);
      }
    }
    return { directionSignals, carrySignals };
  }

  isPairEnabled(a: string, b: string): boolean {
    return this.config.enabledPairs.some(
      (p) => p[0] === a && p[1] === b,
    );
  }

  carryActiveForPair(a: string, b: string): boolean {
    const ps = this.state.pairState.get(pairKey([a, b]));
    return ps?.carryActive ?? false;
  }

  lastDifferentialForPair(a: string, b: string): number | null {
    const ps = this.state.pairState.get(pairKey([a, b]));
    return ps?.lastDifferential ?? null;
  }

  enabledPairsList(): readonly SymbolPair[] {
    return this.config.enabledPairs;
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
        `[CrossSymbolFundingDifferentialPlugin] LAYER 3 BREACH: impliedNotional=${clampedNotional} violates 1:10 cap: ${msg}`,
        { cause: e },
      );
    }

    const baseFields = {
      kind: "direction" as const,
      side,
      strength,
      // Phase 14A: source suffixed with leg symbol for leg attribution.
      source: `${this.metadata.name}:${symbol}`,
    };
    const tsField =
      timestampMs !== undefined ? { timestampMs } : {};
    const signal: DirectionSignal = {
      ...baseFields,
      ...tsField,
    };
    this.state.directionSignalsEmitted += 1;
    if (this._wired) {
      // Phase 14A: leg-aware routing — each leg's signal goes to the
      // bus matching that leg's symbol. If no bus is wired, drop and
      // increment unroutedEmissions (defensive).
      const bus = this._busesBySymbol.get(symbol);
      if (bus !== undefined) {
        bus.emit(signal);
      } else {
        this.state.unroutedEmissions += 1;
      }
    }
    return signal;
  }

  private _buildCarrySignal(
    fundingRate: number,
    regime: "high" | "neutral" | "flip",
    highLeg: string,
    lowLeg: string,
    timestampMs: number | undefined,
  ): CarrySignal {
    const baseFields = {
      kind: "carry" as const,
      fundingRate,
      regime,
      source: `${this.metadata.name}:${highLeg}->${lowLeg}`,
    };
    const tsField =
      timestampMs !== undefined ? { timestampMs } : {};
    const signal: CarrySignal = {
      ...baseFields,
      ...tsField,
    };
    this.state.carrySignalsEmitted += 1;
    if (this._wired) {
      // Phase 14A: route the CarrySignal to the HIGH leg's bus (the
      // symbol paying funding). If neither leg has a wired bus, drop
      // and increment unroutedEmissions.
      const bus = this._busesBySymbol.get(highLeg)
        ?? this._busesBySymbol.get(lowLeg);
      if (bus !== undefined) {
        bus.emit(signal);
      } else {
        this.state.unroutedEmissions += 1;
      }
    }
    return signal;
  }

  private _assertInitialState(): void {
    void this.state.pairState;
    for (const p of this.config.enabledPairs) {
      if (!this.state.pairState.has(pairKey(p))) {
        throw new Error(
          `[CrossSymbolFundingDifferentialPlugin] LAYER 2 BREACH: pairState missing entry for [${p[0]}, ${p[1]}].`,
        );
      }
    }
    if (
      !Number.isFinite(this.config.baseNotionalUsd) ||
      this.config.baseNotionalUsd <= 0
    ) {
      throw new Error(
        `[CrossSymbolFundingDifferentialPlugin] LAYER 2 BREACH: baseNotionalUsd=${this.config.baseNotionalUsd} invalid.`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createCrossSymbolFundingDifferentialPlugin(
  overrides: Partial<CrossSymbolFundingDifferentialConfig> = {},
): CrossSymbolFundingDifferentialPlugin {
  return new CrossSymbolFundingDifferentialPlugin(overrides);
}

void err;
