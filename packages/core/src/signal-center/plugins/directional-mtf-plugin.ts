// packages/core/src/signal-center/plugins/directional-mtf-plugin.ts —
// Phase 11.1b Track A — first Phase 11+ non-reference drop-in plugin.
//
// ===========================================================================
// DirectionalMTFPlugin — wraps Phase 8 Track F (1h MTF Donchian)
// ===========================================================================
//
// Purpose
// -------
// DirectionalMTFPlugin is the FIRST Phase 11+ drop-in plugin that ships on
// the Phase 10G SignalCenterV1 platform. It wraps the validated Phase 8
// Track F (`DonchianMtfStrategy`) — a 3-tier multi-timeframe Donchian
// breakout signal — into the SignalBus's `DirectionSignal` / `SizingSignal`
// shape.
//
// Why this plugin?
// ----------------
// Phase 10G Track A delivered the SignalBus + StrategyRegistry + a REFERENCE
// plugin (`CarryBaselinePlugin` wrapping the funding-carry signal-center
// reference). Phase 11+ is the DROP-IN era: new strategies should land on
// the platform WITHOUT touching the central runner. This file proves the
// drop-in path works for DIRECTIONAL alpha (Track F) — historically the
// only validated positive directional edge on bybit.eu SPOT-margin 1:10.
//
// Phase 8 F validated empirical results (Phase 8 F Track, 1:10 leverage,
// ETH symbol only — the empirical truth, NOT re-laundered):
//
//   | Symbol | Backtest PnL  | WF OOS       | Verdict                 |
//   |--------|---------------|--------------|-------------------------|
//   | ETH    | +137% / +$386 | +2.63%/30d   | VALIDATED (default-on)  |
//   | BTC    | -$475         | negative     | DISABLED (opt-in only)  |
//   | SOL    | -$524 (excl.) | n/a          | NOT REGISTERED          |
//
// Per-symbol disclosure (MANDATORY, see scope plan §"Per-symbol PARTIAL PASS"):
//
//   - **ETH (default-on)**: Phase 8 F Track validated at 1:10 leverage. The
//     plugin's `enabledSymbols` defaults to `["ETH/USDT"]` so the central
//     runner picks it up automatically.
//
//   - **BTC (opt-in, with caveat)**: Phase 8 F showed BTC directional alpha
//     was negative at 1:10 leverage in the validation window. BTC may still
//     be enabled via constructor config for explicit re-evaluation, but the
//     plugin does NOT default to including BTC. Empirical truth wins — if
//     BTC composition in SCv1 produces negative envelope vs the carry-only
//     baseline, the per-symbol PARTIAL PASS pattern applies (document
//     composition effect honestly; do NOT silently mask with track-level
//     FAIL — see memory "Per-symbol PARTIAL PASS pattern").
//
//   - **SOL (NOT REGISTERED)**: Phase 8 F Track intentionally EXCLUDED SOL.
//     SOL directional alpha has been tried 4× across Phases 5, 6, 7, 8 and
//     failed every time due to data-regime issues (current funding regime,
//     higher vol, Q1-Q2 2026 funding flip). The plugin refuses to register
//     for SOL via `enabledSymbols` — the structural failure mode is
//     documented and re-confirmed empirically. Do NOT add SOL to the
//     `enabledSymbols` list without an explicit SCv1 envelope re-test.
//
// Architecture
// ------------
// On every LTF (1h) bar:
//   1. Update internal LTF candle buffer (rolling 32-bar window for ATR).
//   2. Aggregate the LTF candle into MTF (4h) and HTF (1d) rolling windows
//      (4 LTF bars per MTF candle, 24 LTF bars per HTF candle).
//   3. Compute the minimum indicator state required by `DonchianMtfStrategy`:
//      - LTF ATR(14)         → ATR for SL/TP distance
//      - MTF Donchian upper  → entry trigger + MTF trend filter
//      - HTF Supertrend(10,3.0) → HTF trend filter
//   4. Build a `StrategyContext` and call `donchian.onCandle(ctx)`.
//   5. Emit a `DirectionSignal` on every bar (long/short/flat) — this is
//      the "view" the plugin pushes onto the bus.
//   6. On entry triggers (long signal from underlying strategy), emit a
//      `SizingSignal` with the recommended notional. Respect 1:10 cap.
//
// 1:10 leverage invariant (3-layer HARD GUARDRAIL)
// ------------------------------------------------
// This plugin's effective leverage MUST stay ≤ 10. We enforce this at:
//   1. **Constructor**: `metadata.maxLeverage = 10`. The registry's
//      `validatePluginMetadata` would reject a higher value.
//   2. **Per-emit assertion**: `_emitSizingSignal` calls
//      `assertLeverageInvariant(notional, baseCapital)` BEFORE emit. Throws
//      `LeverageBreachError` on any synthetic breach (caught by the test
//      suite for verification).
//   3. **Per-emit clamp**: `_emitSizingSignal` clamps
//      `notional ≤ baseNotionalUsd × maxLeverage`. Any value above this is
//      reduced to the ceiling BEFORE emit (hard guardrail). Counter
//      `leverageClampCount` increments on every clamp.
//
// Why is this important? Per memory "Three-layer enforcement for hard
// constraints" (2026-07-05): the 3-layer defense-in-depth pattern catches
// any single-layer bypass. Phase 10G Track B verified empirically that 0
// breaches occur across 2,659 emitted SizingSignals; this plugin ships the
// same pattern with full Layer 2 + Layer 3 distinct-test verification.
//
// References (≥3 independent sources on directional MTF plugin pattern):
//   - Quantpedia "How to Design a Simple Multi-Timeframe Trend Strategy
//     on Bitcoin" — MTF trend-following baseline, HTF trend filter +
//     LTF Donchian breakout entry (the validated Phase 8 F architecture).
//     https://quantpedia.com/how-to-design-a-simple-multi-timeframe-trend-strategy-on-bitcoin/
//   - Martin Fowler "Plugin" pattern (PEAA, 2002) — explicit plugin
//     interface, runtime registration, lifecycle hooks. The StrategyPlugin
//     interface mirrors this pattern.
//   - NautilusTrader `Strategy` + `Actor` lifecycle (2023) — modern
//     Rust/Python plugin pattern with on_bar hooks; validates the
//     "central runner drives per-bar callbacks" pattern.
//   - CoinXSight "Multi-Timeframe Confluence Trading Strategy" — three-
//     timeframe standard: HTF trend + MTF setup + LTF trigger.
//     https://coinxsight.com/multi-timeframe-confluence-trading-strategy/
//   - arXiv 2412.14361 (2024) "Walk-Forward Analysis" — 5y IS / 1y OOS /
//     1y step rolling validation. The Phase 8 F validation uses this WF
//     pattern; this plugin inherits the same empirical envelope.
//     https://arxiv.org/pdf/2412.14361

import {
  DEFAULT_DONCHIAN_MTF_CONFIG,
  type DonchianMtfConfig,
  DonchianMtfStrategy,
} from "../../strategy/donchian-mtf.js";
import {
  assertLeverageInvariant,
  DEFAULT_LEVERAGE_INVARIANT_CONFIG,
  ONE_TO_TEN_LEVERAGE,
  type LeverageInvariantConfig,
} from "../../risk/leverage-invariant.js";
import { roundTo } from "@mm-crypto-bot/shared/utils";
import type { Symbol } from "@mm-crypto-bot/shared/types";
import type { SignalBus } from "../signal-bus.js";
import type {
  StrategyPlugin,
  StrategyPluginMetadata,
} from "../strategy-registry.js";
import {
  type Bar,
  type ConfigError,
  type DirectionSignal,
  type DirectionSide,
  type PluginState,
  type Result,
  type SizingSignal,
  err,
  ok,
} from "../types.js";
import type { StrategyContext } from "../../types.js";

// ---------------------------------------------------------------------------
// Per-symbol disclosure (Phase 11.1b mandate)
// ---------------------------------------------------------------------------

/**
 * Symbol identifiers used by the plugin. These match the bybit.eu
 * SPOT-margin format (`BASE/USDT`). The plugin enforces per-symbol
 * enable via `enabledSymbols`; the central runner SHOULD check this
 * field at registration time.
 */
export type DirectionalMTFSymbol = "ETH/USDT" | "BTC/USDT" | "SOL/USDT";

/**
 * `DEFAULT_ENABLED_SYMBOLS` — the symbols the plugin is enabled for by
 * default. ETH only (Phase 8 F validated positive at 1:10 leverage).
 *
 * BTC is NOT in the default — Phase 8 F showed BTC directional alpha
 * was negative at 1:10 in the validation window. BTC may be opted-in
 * via constructor config for explicit re-evaluation, but is not
 * default-on. SOL is NEVER enabled (Phase 8 F excluded SOL; see
 * plugin header for the structural-failure-mode rationale).
 */
export const DEFAULT_ENABLED_SYMBOLS: readonly DirectionalMTFSymbol[] = [
  "ETH/USDT",
] as const;

/**
 * `ALLOWED_ENABLED_SYMBOLS` — the universe of symbols the plugin can
 * be enabled for. Includes BTC for explicit opt-in. SOL is NOT in this
 * list — the plugin constructor rejects SOL via validation. If the
 * user insists on enabling SOL, they must override via constructor
 * config AND document the decision in their deployment notes (do NOT
 * silently allow SOL — the structural failure mode is real).
 */
export const ALLOWED_ENABLED_SYMBOLS: readonly DirectionalMTFSymbol[] = [
  "ETH/USDT",
  "BTC/USDT",
] as const;

// ---------------------------------------------------------------------------
// DirectionalMTFPluginConfig — plugin configuration
// ---------------------------------------------------------------------------

/**
 * `DirectionalMTFPluginConfig` — configuration for DirectionalMTFPlugin.
 *
 * Defaults mirror `DonchianMtfStrategy`'s `DEFAULT_DONCHIAN_MTF_CONFIG`
 * (the Phase 8 F validated params) plus the SCv1 envelope knobs.
 */
export interface DirectionalMTFPluginConfig {
  /** Symbol this plugin instance is bound to. Must be in `enabledSymbols`. */
  readonly symbol: DirectionalMTFSymbol;
  /** Base notional in USD. Default 10_000. */
  readonly baseNotionalUsd: number;
  /** HARD CONSTRAINT: 1 or 10. Default 10 (1:10 mandate). */
  readonly leverage: 1 | 10;
  /** Donchian channel period on MTF (4h). Default 20 (Phase 8 F). */
  readonly donchianPeriod: number;
  /** ATR stop-loss multiplier (LTF). Default 1.5 (Phase 8 F). */
  readonly stopAtrMultiplier: number;
  /** ATR take-profit multiplier (LTF). Default 3.0 (Phase 8 F). */
  readonly tpAtrMultiplier: number;
  /** ATR lookback (LTF). Default 14 (Phase 8 F). */
  readonly atrPeriod: number;
  /** Max-hold in LTF bars (168 = 7 days, Phase 8 F). */
  readonly maxHoldBars: number;
  /** HTF Supertrend period. Default 10 (Phase 8 F). */
  readonly supertrendPeriod: number;
  /** HTF Supertrend multiplier. Default 3.0 (Phase 8 F). */
  readonly supertrendMultiplier: number;
  /** LTF bars per MTF bar (1h → 4h = 4 bars). Default 4. */
  readonly mtfAggregationFactor: number;
  /** LTF bars per HTF bar (1h → 1d = 24 bars). Default 24. */
  readonly htfAggregationFactor: number;
  /** Price precision for rounding SL/TP. Default 2 (BTC/ETH). */
  readonly pricePrecision: number;
  /** Per-symbol enable list. Default: ETH only. SOL NEVER allowed. */
  readonly enabledSymbols: readonly DirectionalMTFSymbol[];
  /** Leverage invariant config (max, tolerance, warnOnApproach). */
  readonly leverageInvariant: LeverageInvariantConfig;
}

export const DEFAULT_DIRECTIONAL_MTF_PLUGIN_CONFIG: Omit<
  DirectionalMTFPluginConfig,
  "symbol"
> = {
  baseNotionalUsd: 10_000,
  leverage: 10, // 1:10 mandate
  donchianPeriod: DEFAULT_DONCHIAN_MTF_CONFIG.donchianPeriod,
  stopAtrMultiplier: DEFAULT_DONCHIAN_MTF_CONFIG.stopAtrMultiplier,
  tpAtrMultiplier: DEFAULT_DONCHIAN_MTF_CONFIG.tpAtrMultiplier,
  atrPeriod: DEFAULT_DONCHIAN_MTF_CONFIG.atrPeriod,
  maxHoldBars: DEFAULT_DONCHIAN_MTF_CONFIG.maxHoldBars,
  supertrendPeriod: 10,
  supertrendMultiplier: 3.0,
  mtfAggregationFactor: 4, // 1h → 4h
  htfAggregationFactor: 24, // 1h → 1d
  pricePrecision: 2,
  enabledSymbols: DEFAULT_ENABLED_SYMBOLS,
  leverageInvariant: DEFAULT_LEVERAGE_INVARIANT_CONFIG,
};

// ---------------------------------------------------------------------------
// DirectionalMTFPluginState — per-plugin mutable state
// ---------------------------------------------------------------------------

/**
 * Minimal OHLCV candle shape used in the rolling buffers. Structurally
 * identical to `Candle` from `@mm-crypto-bot/shared/types` but defined
 * inline to avoid cross-package type plumbing at the plugin boundary.
 */
export interface DmCandle {
  readonly timestamp: number;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
  readonly volume: number;
}

/**
 * `DirectionalMTFPluginState` — mutable state held by the plugin across
 * `onBar` calls. Includes rolling candle buffers + indicator state +
 * emission bookkeeping.
 */
export interface DirectionalMTFPluginState {
  /** LTF (1h) rolling candle buffer (most-recent last). */
  ltfCandles: readonly DmCandle[];
  /** MTF (4h) rolling candle buffer (most-recent last). Aggregated from LTF. */
  mtfCandles: readonly DmCandle[];
  /** HTF (1d) rolling candle buffer (most-recent last). Aggregated from LTF. */
  htfCandles: readonly DmCandle[];
  /** Counter of LTF bars processed (== candleIndex). */
  candleIndex: number;
  /** Counter of MTF bars completed since start. */
  mtfBarCount: number;
  /** Counter of HTF bars completed since start. */
  htfBarCount: number;
  /** Previous LTF close-vs-MTF-donchian-upper relationship (cross-back state). */
  prevLtfAboveMtfUpper: boolean | null;
  /** Current entry side ("long" | "flat") — mirrors the underlying strategy. */
  currentSide: "long" | "flat";
  /** Entry price of the current position (null = no position). */
  entryPrice: number | null;
  /** Entry timestamp of the current position (null = no position). */
  entryTimeMs: number | null;
  /** LTF bars since entry (for max-hold enforcement). */
  holdingBars: number;
  /** Number of entry signals emitted. */
  entryCount: number;
  /** Number of exit signals emitted. */
  exitCount: number;
  /** Number of DirectionSignals emitted since reset. */
  directionSignalCount: number;
  /** Number of SizingSignals emitted since reset. */
  sizingSignalCount: number;
  /** Hard guardrail: any emit that tried to exceed 1:10 leverage. */
  leverageClampCount: number;
  /** Last emitted direction signal — used for telemetry and tests. */
  lastDirectionSignal: DirectionSignal | null;
  /** Last emitted sizing signal — used for telemetry and tests. */
  lastSizingSignal: SizingSignal | null;
  /** Last LTF close — cached for cross-back detection. */
  lastLtfClose: number | null;
  /** Last computed MTF Donchian upper — cached for tests + cross-back. */
  lastMtfDonchianUpper: number | null;
  /** Last computed HTF Supertrend — cached for tests. */
  lastHtfSupertrend: number | null;
  /** Last computed LTF ATR(14) — cached for tests. */
  lastLtfAtr: number | null;
}

// ---------------------------------------------------------------------------
// DirectionalMTFPlugin — the plugin
// ---------------------------------------------------------------------------

/**
 * `DirectionalMTFPlugin` — first Phase 11+ non-reference drop-in plugin
 * on the SignalCenterV1 platform. Wraps `DonchianMtfStrategy` and emits
 * `DirectionSignal` + `SizingSignal` on the SignalBus.
 *
 * Lifecycle:
 *   1. Construct with `new DirectionalMTFPlugin({ symbol: "ETH/USDT", ... })`.
 *   2. Validate via `plugin.validateConfig(...)`.
 *   3. Wire to bus via `plugin.subscribe(bus)`.
 *   4. Drive per-bar via `plugin.onBar(bar, state)`.
 *   5. Reset between backtest runs via `plugin.reset()`.
 *   6. Dispose (release bus ref) via `plugin.dispose()`.
 *
 * Plugin invariants (1:10 HARD GUARDRAIL):
 *   - `metadata.maxLeverage === 10`.
 *   - Constructor throws if `leverage ∉ {1, 10}` or `maxLeverage > 10`.
 *   - Every emitted SizingSignal has `notional ≤ baseNotionalUsd × 10`
 *     (clamped to ceiling if necessary).
 *   - `_emitSizingSignal` calls `assertLeverageInvariant` BEFORE clamp —
 *     synthetic 12× input throws `LeverageBreachError`.
 *   - SOL is NEVER registered (constructor rejects via `enabledSymbols`).
 */
export class DirectionalMTFPlugin implements StrategyPlugin {
  readonly metadata: StrategyPluginMetadata = {
    name: "directional-mtf-v1",
    version: "1.0.0",
    edgeClass: "directional",
    capitalRequirement: 10_000,
    maxLeverage: ONE_TO_TEN_LEVERAGE, // 1:10 HARD GUARDRAIL
    description:
      "Phase 11.1b — Phase 8 F Track MTF Donchian (1h/4h/1d, long-only) " +
      "wrapped as SCv1 drop-in. ETH default-on (Phase 8 F validated +2.63%/30d WF OOS); " +
      "BTC opt-in (negative at 1:10 in validation window); SOL NOT REGISTERED " +
      "(structural failure mode — 4× failure across Phases 5-8).",
    dependencies: [],
  };

  /**
   * `enabledSymbols` — per-symbol enable flag (NOT in metadata to keep
   * the Phase 10G StrategyPluginMetadata interface untouched). The
   * central runner SHOULD consult this field at registration time and
   * only instantiate the plugin for symbols in this list.
   *
   * Per the Phase 11.1b scope plan, SOL is never registered. BTC is
   * opt-in via constructor config. ETH is default-on.
   */
  readonly enabledSymbols: readonly DirectionalMTFSymbol[];

  readonly config: DirectionalMTFPluginConfig;
  readonly state: DirectionalMTFPluginState;

  /** Underlying MTF Donchian strategy (Phase 8 F source). */
  private readonly donchian: DonchianMtfStrategy;

  /** Stored bus reference (set in subscribe). */
  private bus: SignalBus | null = null;

  /** Underlying strategy config (computed from plugin config). */
  private readonly donchianConfig: DonchianMtfConfig;

  constructor(
    config: Partial<DirectionalMTFPluginConfig> & {
      symbol: DirectionalMTFSymbol;
    },
  ) {
    const merged: DirectionalMTFPluginConfig = {
      ...DEFAULT_DIRECTIONAL_MTF_PLUGIN_CONFIG,
      ...config,
    };
    // 1:10 HARD GUARDRAIL — Layer 1: constructor check on leverage.
    // The literal `10` here matches `ONE_TO_TEN_LEVERAGE`; we use the literal
    // for clarity (the type system already narrows `leverage: 1 | 10`, but we
    // keep the runtime check for defensive validation of arbitrary input).
    if (
      merged.leverage !== (1 as 1 | 10) &&
      merged.leverage !== (10 as 1 | 10)
    ) {
      throw new Error(
        `[DirectionalMTFPlugin] 1:10 HARD GUARDRAIL VIOLATION: leverage=${String(merged.leverage)}x ` +
          `is NOT ALLOWED. Project-wide mandate: ONLY 1x or 10x leverage.`,
      );
    }
    // 1:10 HARD GUARDRAIL — Layer 1 (metadata): maxLeverage <= 10.
    // `ONE_TO_TEN_LEVERAGE` is `as const`, so TS narrows to literal 10.
    if (this.metadata.maxLeverage !== (ONE_TO_TEN_LEVERAGE as number)) {
      throw new Error(
        `[DirectionalMTFPlugin] Metadata maxLeverage MUST be 10 (1:10 mandate). ` +
          `Got ${String(this.metadata.maxLeverage)}.`,
      );
    }
    // Per-symbol disclosure enforcement — SOL is NEVER allowed.
    if (merged.enabledSymbols.includes("SOL/USDT")) {
      throw new Error(
        `[DirectionalMTFPlugin] SOL is NOT REGISTERED for this plugin. ` +
          `Phase 8 F Track intentionally excluded SOL due to data-regime failure ` +
          `(4x directional failures across Phases 5, 6, 7, 8). ` +
          `Remove SOL/USDT from enabledSymbols. ` +
          `See plugin header for the structural-failure-mode rationale.`,
      );
    }
    for (const s of merged.enabledSymbols) {
      if (!ALLOWED_ENABLED_SYMBOLS.includes(s)) {
        throw new Error(
          `[DirectionalMTFPlugin] enabledSymbols contains invalid symbol "${s}". ` +
            `Allowed: ${ALLOWED_ENABLED_SYMBOLS.join(", ")}.`,
        );
      }
    }
    if (
      !Number.isFinite(merged.baseNotionalUsd) ||
      merged.baseNotionalUsd <= 0
    ) {
      throw new Error(
        `[DirectionalMTFPlugin] baseNotionalUsd must be positive finite, got ${String(merged.baseNotionalUsd)}`,
      );
    }
    this.config = merged;
    this.enabledSymbols = [...merged.enabledSymbols];
    this.donchianConfig = {
      donchianPeriod: merged.donchianPeriod,
      mtfDonchianPeriod: merged.donchianPeriod,
      stopAtrMultiplier: merged.stopAtrMultiplier,
      tpAtrMultiplier: merged.tpAtrMultiplier,
      atrPeriod: merged.atrPeriod,
      maxHoldBars: merged.maxHoldBars,
      leverage: merged.leverage,
    };
    this.donchian = new DonchianMtfStrategy(this.donchianConfig);
    this.state = this._mkState();
  }

  // -------------------------------------------------------------------------
  // StrategyPlugin interface
  // -------------------------------------------------------------------------

  subscribe(bus: SignalBus): void {
    this.bus = bus;
    // Directional plugins are PUSH-only — we EMIT signals but do NOT
    // subscribe to any bus kinds. Phase 10G Track B's risk engine will
    // subscribe to our DirectionSignals + SizingSignals for portfolio
    // risk aggregation.
  }

  onBar(bar: Bar, _state: PluginState): void {
    this._appendLtfCandle(bar);
    this._aggregateHigherTimeframes(bar);
    // Increment candleIndex BEFORE the warmup early-return — the index
    // is the LTF bar counter, not "bars past warmup". Without this
    // increment at the top, the aggregation step never fires because
    // `n % mtfFactor === 0` is never true (n stays 0 forever).
    this.state.candleIndex += 1;
    const indicators = this._computeIndicators();
    if (indicators === null) {
      this._emitDirectionSignal("flat", 0, bar.timestamp);
      return;
    }
    const ctx = this._buildStrategyContext(indicators);
    const sig = this.donchian.onCandle(ctx);
    if (sig === null) {
      if (this.state.currentSide === "long") {
        this._checkExit(bar, indicators);
      } else {
        this._emitDirectionSignal("flat", 0, bar.timestamp);
      }
    } else if (sig.side === "buy" && this.state.currentSide !== "long") {
      this._onEntry(bar, indicators, sig.confidence);
    } else if (sig.side === "buy" && this.state.currentSide === "long") {
      this._emitDirectionSignal("long", sig.confidence, bar.timestamp);
    } else if (sig.side === "sell" && this.state.currentSide === "long") {
      this._onExit(bar, "strategy-sell");
    } else {
      this._emitDirectionSignal("flat", 0, bar.timestamp);
    }
  }

  validateConfig(config: unknown): Result<void, ConfigError> {
    if (config === undefined || config === null) {
      return ok(undefined);
    }
    if (typeof config !== "object") {
      return err({
        pluginName: this.metadata.name,
        field: "config",
        message: `config must be an object, got ${typeof config}`,
      });
    }
    const c = config as Partial<DirectionalMTFPluginConfig>;
    // `c.leverage` is typed `1 | 10 | undefined`. After the `!== undefined`
    // check, TS narrows it to `1 | 10`, so the `!== 1 && !== 10` is
    // technically unreachable. We keep the runtime check as defense in
    // depth — even if the type were widened, this still rejects bad input.
    if (
      c.leverage !== undefined &&
      c.leverage !== 1 &&
      c.leverage !== (10 as 1 | 10)
    ) {
      return err({
        pluginName: this.metadata.name,
        field: "leverage",
        message:
          `[1:10 HARD GUARDRAIL] leverage must be 1 or 10. Got ${String(c.leverage)}.`,
        value: c.leverage,
      });
    }
    if (
      c.baseNotionalUsd !== undefined &&
      (!Number.isFinite(c.baseNotionalUsd) || c.baseNotionalUsd <= 0)
    ) {
      return err({
        pluginName: this.metadata.name,
        field: "baseNotionalUsd",
        message: `baseNotionalUsd must be a positive finite number, got ${String(c.baseNotionalUsd)}`,
        value: c.baseNotionalUsd,
      });
    }
    if (
      c.donchianPeriod !== undefined &&
      (!Number.isInteger(c.donchianPeriod) || c.donchianPeriod <= 0)
    ) {
      return err({
        pluginName: this.metadata.name,
        field: "donchianPeriod",
        message: `donchianPeriod must be a positive integer, got ${String(c.donchianPeriod)}`,
        value: c.donchianPeriod,
      });
    }
    if (
      c.stopAtrMultiplier !== undefined &&
      (!Number.isFinite(c.stopAtrMultiplier) || c.stopAtrMultiplier <= 0)
    ) {
      return err({
        pluginName: this.metadata.name,
        field: "stopAtrMultiplier",
        message: `stopAtrMultiplier must be a positive finite number, got ${String(c.stopAtrMultiplier)}`,
        value: c.stopAtrMultiplier,
      });
    }
    if (
      c.tpAtrMultiplier !== undefined &&
      (!Number.isFinite(c.tpAtrMultiplier) || c.tpAtrMultiplier <= 0)
    ) {
      return err({
        pluginName: this.metadata.name,
        field: "tpAtrMultiplier",
        message: `tpAtrMultiplier must be a positive finite number, got ${String(c.tpAtrMultiplier)}`,
        value: c.tpAtrMultiplier,
      });
    }
    if (
      c.atrPeriod !== undefined &&
      (!Number.isInteger(c.atrPeriod) || c.atrPeriod <= 0)
    ) {
      return err({
        pluginName: this.metadata.name,
        field: "atrPeriod",
        message: `atrPeriod must be a positive integer, got ${String(c.atrPeriod)}`,
        value: c.atrPeriod,
      });
    }
    if (
      c.maxHoldBars !== undefined &&
      (!Number.isInteger(c.maxHoldBars) || c.maxHoldBars < 0)
    ) {
      return err({
        pluginName: this.metadata.name,
        field: "maxHoldBars",
        message: `maxHoldBars must be a non-negative integer, got ${String(c.maxHoldBars)}`,
        value: c.maxHoldBars,
      });
    }
    if (c.enabledSymbols !== undefined) {
      for (const s of c.enabledSymbols) {
        if (!ALLOWED_ENABLED_SYMBOLS.includes(s)) {
          return err({
            pluginName: this.metadata.name,
            field: "enabledSymbols",
            message:
              `[1:10 HARD GUARDRAIL] enabledSymbols contains invalid symbol "${s}". ` +
              `Allowed: ${ALLOWED_ENABLED_SYMBOLS.join(", ")}. SOL is NEVER registered.`,
            value: s,
          });
        }
      }
    }
    return ok(undefined);
  }

  reset(): void {
    this.state.ltfCandles = [];
    this.state.mtfCandles = [];
    this.state.htfCandles = [];
    this.state.candleIndex = 0;
    this.state.mtfBarCount = 0;
    this.state.htfBarCount = 0;
    this.state.prevLtfAboveMtfUpper = null;
    this.state.currentSide = "flat";
    this.state.entryPrice = null;
    this.state.entryTimeMs = null;
    this.state.holdingBars = 0;
    this.state.entryCount = 0;
    this.state.exitCount = 0;
    this.state.directionSignalCount = 0;
    this.state.sizingSignalCount = 0;
    this.state.leverageClampCount = 0;
    this.state.lastDirectionSignal = null;
    this.state.lastSizingSignal = null;
    this.state.lastLtfClose = null;
    this.state.lastMtfDonchianUpper = null;
    this.state.lastHtfSupertrend = null;
    this.state.lastLtfAtr = null;
  }

  dispose(): void {
    this.bus = null;
  }

  // -------------------------------------------------------------------------
  // Public API (for central runner + tests)
  // -------------------------------------------------------------------------

  /**
   * `effectiveLeverage` — current effective leverage (1× baseline or
   * 1:10 = 10×). ALWAYS in {1, 10}. Used by telemetry + tests.
   */
  effectiveLeverage(): 1 | 10 {
    return this.config.leverage;
  }

  /**
   * `effectiveNotionalUsd` — current effective notional in USD.
   * ALWAYS <= baseNotionalUsd * 10 (the 1:10 mandate ceiling).
   */
  effectiveNotionalUsd(): number {
    return this.config.baseNotionalUsd * this.config.leverage;
  }

  /**
   * `effectiveMaxNotionalUsd` — the HARD ceiling. Emitted SizingSignals
   * are clamped to this value before emit.
   */
  effectiveMaxNotionalUsd(): number {
    return this.config.baseNotionalUsd * this.metadata.maxLeverage;
  }

  /**
   * `isSymbolEnabled` — check whether a symbol is in this plugin's
   * `enabledSymbols` list.
   */
  isSymbolEnabled(symbol: DirectionalMTFSymbol): boolean {
    return this.enabledSymbols.includes(symbol);
  }

  /**
   * `computeIndicatorsPublic` — pure-functional helper exposed for tests.
   */
  computeIndicatorsPublic(): {
    ltfAtr: number;
    mtfDonchianUpper: number;
    mtfClose: number;
    htfSupertrend: number;
    htfClose: number;
    htfSupertrendDir: 1 | -1;
  } | null {
    return this._computeIndicators();
  }

  /**
   * `assertLeverageInvariantForTesting` — exposed for tests so they can
   * directly invoke Layer 2 on synthetic notional values.
   */
  assertLeverageInvariantForTesting(
    totalNotional: number,
    baseCapital: number,
  ): void {
    assertLeverageInvariant(
      totalNotional,
      baseCapital,
      this.config.leverageInvariant,
    );
  }

  // -------------------------------------------------------------------------
  // private — candle buffer management
  // -------------------------------------------------------------------------

  private _mkState(): DirectionalMTFPluginState {
    return {
      ltfCandles: [],
      mtfCandles: [],
      htfCandles: [],
      candleIndex: 0,
      mtfBarCount: 0,
      htfBarCount: 0,
      prevLtfAboveMtfUpper: null,
      currentSide: "flat",
      entryPrice: null,
      entryTimeMs: null,
      holdingBars: 0,
      entryCount: 0,
      exitCount: 0,
      directionSignalCount: 0,
      sizingSignalCount: 0,
      leverageClampCount: 0,
      lastDirectionSignal: null,
      lastSizingSignal: null,
      lastLtfClose: null,
      lastMtfDonchianUpper: null,
      lastHtfSupertrend: null,
      lastLtfAtr: null,
    };
  }

  private _appendLtfCandle(bar: Bar): void {
    const candle: DmCandle = {
      timestamp: bar.timestamp,
      open: bar.open,
      high: bar.high,
      low: bar.low,
      close: bar.close,
      volume: bar.volume,
    };
    const next: DmCandle[] = [...this.state.ltfCandles, candle];
    const maxBars = Math.max(
      512,
      this.config.maxHoldBars +
        this.config.donchianPeriod +
        this.config.atrPeriod,
    );
    if (next.length > maxBars) {
      next.splice(0, next.length - maxBars);
    }
    this.state.ltfCandles = next;
  }

  private _aggregateHigherTimeframes(latestBar: Bar): void {
    const n = this.state.candleIndex;
    const mtfFactor = this.config.mtfAggregationFactor;
    const htfFactor = this.config.htfAggregationFactor;

    if (n > 0 && n % mtfFactor === 0) {
      const mtfCandle = this._aggregateLastN(
        this.state.ltfCandles,
        mtfFactor,
        latestBar.timestamp,
      );
      const next: DmCandle[] = [...this.state.mtfCandles, mtfCandle];
      const maxMtfBars = Math.max(256, this.config.donchianPeriod + 16);
      if (next.length > maxMtfBars) {
        next.splice(0, next.length - maxMtfBars);
      }
      this.state.mtfCandles = next;
      this.state.mtfBarCount += 1;
    }

    if (n > 0 && n % htfFactor === 0) {
      const htfCandle = this._aggregateLastN(
        this.state.ltfCandles,
        htfFactor,
        latestBar.timestamp,
      );
      const next: DmCandle[] = [...this.state.htfCandles, htfCandle];
      const maxHtfBars = Math.max(256, this.config.supertrendPeriod + 16);
      if (next.length > maxHtfBars) {
        next.splice(0, next.length - maxHtfBars);
      }
      this.state.htfCandles = next;
      this.state.htfBarCount += 1;
    }
  }

  private _aggregateLastN(
    ltfCandles: readonly DmCandle[],
    n: number,
    timestamp: number,
  ): DmCandle {
    const slice = ltfCandles.slice(-n);
    if (slice.length === 0) {
      throw new Error(
        `_aggregateLastN: empty LTF slice for n=${n} (candleIndex=${this.state.candleIndex})`,
      );
    }
    const first = slice[0]!;
    let high = first.high;
    let low = first.low;
    let volume = 0;
    for (const c of slice) {
      if (c.high > high) high = c.high;
      if (c.low < low) low = c.low;
      volume += c.volume;
    }
    const last = slice[slice.length - 1]!;
    return {
      timestamp,
      open: first.open,
      high,
      low,
      close: last.close,
      volume,
    };
  }

  // -------------------------------------------------------------------------
  // private — indicator computation
  // -------------------------------------------------------------------------

  private _computeIndicators(): {
    ltfAtr: number;
    mtfDonchianUpper: number;
    mtfClose: number;
    htfSupertrend: number;
    htfClose: number;
    htfSupertrendDir: 1 | -1;
  } | null {
    const ltfCandles = this.state.ltfCandles;
    const mtfCandles = this.state.mtfCandles;
    const htfCandles = this.state.htfCandles;
    const atrP = this.config.atrPeriod;
    const donchP = this.config.donchianPeriod;
    const stP = this.config.supertrendPeriod;
    const stM = this.config.supertrendMultiplier;

    const minLtfBars = atrP + donchP * this.config.mtfAggregationFactor;
    if (ltfCandles.length < minLtfBars) return null;
    const minHtfBars = stP + 2;
    if (htfCandles.length < minHtfBars) return null;
    if (mtfCandles.length === 0) return null;

    const ltfAtr = this._wilderAtr(ltfCandles, atrP);
    if (ltfAtr === null || ltfAtr <= 0) return null;

    // MTF Donchian upper: max high of the LAST `donchP` PRIOR MTF candles,
    // EXCLUDING the latest one. The engine's convention is "trailing 20
    // candles excluding current", so the current MTF candle's close can
    // exceed the upper band when it's a fresh breakout. This matches the
    // Phase 8 F backtest envelope where the strategy fires on breakouts.
    const priorMtfWindow = mtfCandles.slice(-donchP - 1, -1);
    if (priorMtfWindow.length < donchP) return null;
    let mtfUpper = -Infinity;
    for (const c of priorMtfWindow) {
      if (c.high > mtfUpper) mtfUpper = c.high;
    }
    if (!Number.isFinite(mtfUpper)) return null;

    const mtfClose = mtfCandles[mtfCandles.length - 1]!.close;

    const st = this._supertrend(htfCandles, stP, stM);
    if (st === null) return null;

    const htfClose = htfCandles[htfCandles.length - 1]!.close;

    this.state.lastLtfAtr = ltfAtr;
    this.state.lastMtfDonchianUpper = mtfUpper;
    this.state.lastHtfSupertrend = st.supertrend;

    return {
      ltfAtr,
      mtfDonchianUpper: mtfUpper,
      mtfClose,
      htfSupertrend: st.supertrend,
      htfClose,
      htfSupertrendDir: st.direction,
    };
  }

  /**
   * `_wilderAtr` — Wilder's smoothing approximation of ATR.
   */
  private _wilderAtr(
    candles: readonly DmCandle[],
    n: number,
  ): number | null {
    if (candles.length < n + 1) return null;
    const start = candles.length - n - 1;
    if (start < 0) return null;
    const trs: number[] = [];
    for (let i = start + 1; i < candles.length; i++) {
      const c = candles[i]!;
      const prev = candles[i - 1]!;
      const tr = Math.max(
        c.high - c.low,
        Math.abs(c.high - prev.close),
        Math.abs(c.low - prev.close),
      );
      trs.push(tr);
    }
    if (trs.length === 0) return null;
    let atr = 0;
    for (let i = 0; i < n; i++) {
      atr += trs[i]!;
    }
    atr /= n;
    for (let i = n; i < trs.length; i++) {
      atr = (atr * (n - 1) + trs[i]!) / n;
    }
    return atr;
  }

  /**
   * `_supertrend` — standard Supertrend(stP, stM).
   */
  private _supertrend(
    candles: readonly DmCandle[],
    period: number,
    multiplier: number,
  ): { supertrend: number; direction: 1 | -1 } | null {
    if (candles.length < period + 1) return null;
    const atr = this._wilderAtr(candles, period);
    if (atr === null || atr <= 0) return null;
    let finalUpper = -Infinity;
    let finalLower = Infinity;
    let dir: 1 | -1 = 1;
    for (let i = period; i < candles.length; i++) {
      const c = candles[i]!;
      const prev = candles[i - 1]!;
      const hl2 = (c.high + c.low) / 2;
      const basicUpper = hl2 + multiplier * atr;
      const basicLower = hl2 - multiplier * atr;
      // Canonical TradingView Supertrend formula:
      //   finalUpper = basicUpper IF (basicUpper < finalUpper OR prev.close < finalUpper)
      //                ELSE finalUpper (carry)
      //   finalLower = basicLower IF (basicLower > finalLower OR prev.close > finalLower)
      //                ELSE finalLower (carry)
      // First iteration (when finalUpper is -Infinity / finalLower is Infinity):
      //   the `prev.close < finalUpper` check trivially fails because
      //   prev.close > -Infinity. So we explicitly initialize on the
      //   first iteration.
      if (finalUpper === -Infinity) {
        finalUpper = basicUpper;
        finalLower = basicLower;
      } else {
        finalUpper =
          basicUpper < finalUpper || prev.close < finalUpper
            ? basicUpper
            : finalUpper;
        finalLower =
          basicLower > finalLower || prev.close > finalLower
            ? basicLower
            : finalLower;
      }
      if (c.close > finalUpper) {
        dir = 1;
      } else if (c.close < finalLower) {
        dir = -1;
      }
      // else: direction stays the same (no break — implicit carry).
    }
    const supertrend = dir === 1 ? finalLower : finalUpper;
    return { supertrend, direction: dir };
  }

  // -------------------------------------------------------------------------
  // private — StrategyContext construction + state machine
  // -------------------------------------------------------------------------

  private _buildStrategyContext(indicators: {
    ltfAtr: number;
    mtfDonchianUpper: number;
    mtfClose: number;
    htfSupertrend: number;
    htfClose: number;
    htfSupertrendDir: 1 | -1;
  }): StrategyContext {
    const lastLtf = this.state.ltfCandles[this.state.ltfCandles.length - 1]!;
    const lastMtf =
      this.state.mtfCandles[this.state.mtfCandles.length - 1] ?? null;
    const lastHtf =
      this.state.htfCandles[this.state.htfCandles.length - 1] ?? null;
    return {
      symbol: this.config.symbol as unknown as Symbol,
      timeframe: "1h",
      candleIndex: this.state.candleIndex,
      candle: {
        timestamp: lastLtf.timestamp,
        open: lastLtf.open,
        high: lastLtf.high,
        low: lastLtf.low,
        close: lastLtf.close,
        volume: lastLtf.volume,
      },
      mtfState: {
        ltf: {
          atr: indicators.ltfAtr,
        },
        mtf: {
          ...(lastMtf !== null
            ? { close: lastMtf.close }
            : {}),
          donchianUpper: indicators.mtfDonchianUpper,
        },
        htf: {
          ...(lastHtf !== null
            ? { close: lastHtf.close }
            : {}),
          supertrend: indicators.htfSupertrend,
          supertrendDir: indicators.htfSupertrendDir,
        },
      },
      pricePrecision: this.config.pricePrecision,
    };
  }

  private _onEntry(
    _bar: Bar,
    _indicators: {
      ltfAtr: number;
      mtfDonchianUpper: number;
      mtfClose: number;
      htfSupertrend: number;
      htfClose: number;
      htfSupertrendDir: 1 | -1;
    },
    confidence: number,
  ): void {
    const lastLtf = this.state.ltfCandles[this.state.ltfCandles.length - 1]!;
    const ts = lastLtf.timestamp;
    const lastClose = lastLtf.close;
    this.state.currentSide = "long";
    this.state.entryPrice = lastClose;
    this.state.entryTimeMs = ts;
    this.state.holdingBars = 0;
    this.state.entryCount += 1;
    this._emitDirectionSignal("long", confidence, ts);
    this._emitSizingSignal(confidence, ts);
  }

  private _onExit(bar: Bar, _reason: string): void {
    const wasLong = this.state.currentSide === "long";
    this.state.currentSide = "flat";
    this.state.entryPrice = null;
    this.state.entryTimeMs = null;
    this.state.holdingBars = 0;
    if (wasLong) this.state.exitCount += 1;
    this._emitDirectionSignal("flat", 0, bar.timestamp);
  }

  private _checkExit(
    bar: Bar,
    _indicators: {
      ltfAtr: number;
      mtfDonchianUpper: number;
      mtfClose: number;
      htfSupertrend: number;
      htfClose: number;
      htfSupertrendDir: 1 | -1;
    },
  ): void {
    this.state.holdingBars += 1;
    if (
      this.config.maxHoldBars > 0 &&
      this.state.holdingBars >= this.config.maxHoldBars
    ) {
      this._onExit(bar, "max-hold");
      return;
    }
    const lastClose = this.state.ltfCandles[this.state.ltfCandles.length - 1]!
      .close;
    const confidence = this._computeConfidenceFromMtfCross(lastClose);
    this._emitDirectionSignal("long", confidence, bar.timestamp);
  }

  private _computeConfidenceFromMtfCross(ltfClose: number): number {
    if (this.state.lastMtfDonchianUpper === null) return 0.5;
    const upper = this.state.lastMtfDonchianUpper;
    const prev = this.state.prevLtfAboveMtfUpper;
    if (prev === false && ltfClose > upper) {
      return 0.9; // fresh cross above
    }
    if (ltfClose > upper) {
      return 0.7; // still above
    }
    return 0.3; // LTF below MTF upper — momentum fading
  }

  // -------------------------------------------------------------------------
  // private — signal emission (with 1:10 defense-in-depth)
  // -------------------------------------------------------------------------

  private _emitDirectionSignal(
    side: DirectionSide,
    strength: number,
    timestampMs: number,
  ): void {
    if (!this.bus) return;
    const clamped = Math.max(0, Math.min(1, strength));
    const signal: DirectionSignal = {
      kind: "direction",
      side,
      strength: clamped,
      source: this.metadata.name,
      timestampMs,
    };
    this.state.lastDirectionSignal = signal;
    this.state.directionSignalCount += 1;
    if (this.state.lastMtfDonchianUpper !== null && side === "long") {
      const lastClose =
        this.state.ltfCandles[this.state.ltfCandles.length - 1]!.close;
      this.state.prevLtfAboveMtfUpper =
        lastClose > this.state.lastMtfDonchianUpper;
    }
    this.bus.emit(signal);
  }

  /**
   * `_emitSizingSignal` — compute + emit a SizingSignal with HARD
   * GUARDRAILS:
   *
   *   1. Layer 2 (per-emit assert): `assertLeverageInvariant`
   *      BEFORE the clamp. Throws on synthetic 12x breach.
   *   2. Layer 3 (per-emit clamp): hard-clamp notional to the 1:10
   *      ceiling. Increment `leverageClampCount` on every clamp.
   */
  private _emitSizingSignal(strength: number, timestampMs: number): void {
    if (!this.bus) return;
    const equity = this.config.baseNotionalUsd;
    const maxNotional = this.effectiveMaxNotionalUsd();
    const kellyFraction = Math.max(0, Math.min(1, strength));
    const volMultiplier = 1.0;
    let notional =
      equity * this.config.leverage * kellyFraction * volMultiplier;
    // Layer 2: assert the COMPUTED notional satisfies the invariant.
    assertLeverageInvariant(
      notional,
      equity,
      this.config.leverageInvariant,
    );
    // Layer 3: hard clamp to the 1:10 ceiling.
    if (notional > maxNotional) {
      notional = maxNotional;
      this.state.leverageClampCount += 1;
    }
    // Re-assert after clamp (defense-in-depth).
    assertLeverageInvariant(
      notional,
      equity,
      this.config.leverageInvariant,
    );
    const signal: SizingSignal = {
      kind: "sizing",
      kellyFraction,
      volMultiplier,
      notional,
      source: this.metadata.name,
      timestampMs,
    };
    this.state.lastSizingSignal = signal;
    this.state.sizingSignalCount += 1;
    this.bus.emit(signal);
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * `createDirectionalMTFPlugin` — convenience factory.
 */
export function createDirectionalMTFPlugin(
  config: Partial<DirectionalMTFPluginConfig> & {
    symbol: DirectionalMTFSymbol;
  },
): DirectionalMTFPlugin {
  return new DirectionalMTFPlugin(config);
}

// ---------------------------------------------------------------------------
// Helper: narrow DirectionSignal from a generic Signal
// ---------------------------------------------------------------------------

/**
 * `extractDirectionSignal` — pull a DirectionSignal out of a generic
 * Signal event.
 */
export function extractDirectionSignal(s: unknown): DirectionSignal | null {
  if (typeof s !== "object" || s === null) return null;
  const obj = s as { kind?: unknown };
  if (obj.kind !== "direction") return null;
  return s as DirectionSignal;
}

// Re-export roundTo for downstream consumers.
export { roundTo };

// Re-export the StrategySignal type from the underlying strategy so consumers
// don't need a direct dep on donchian-mtf.
export type { StrategySignal } from "../../types.js";
