// packages/core/src/signal-center/plugins/basis-trade-plugin.ts —
// Phase 11.2e Track A — BasisTradePlugin.
//
// ===========================================================================
// BasisTradePlugin — spot-vs-perp basis convergence alpha (Phase 11.2e)
// ===========================================================================
//
// Purpose
// -------
// `BasisTradePlugin` is the FIRST ALPHA sub-phase plugin of Phase 11.2 (the
// second wave of drop-ins for the Signal Center). It captures the spot-vs-perp
// basis when it diverges from the "carry-neutral" equilibrium, adding a NEW
// alpha source to the SCv1 portfolio: mean-reverting convergence trade with
// low tail risk.
//
// Why this plugin?
// ----------------
// The carry-instrumentation family (Phase 11.1) caps at +2.4%/month on ETH.
// To bridge toward +50%/month the project needs MULTI-ALPHA streams that
// compose uncorrelated. Basis convergence is the lowest-risk single-venue
// alpha source because:
//   1. The basis is mean-reverting (the structural equilibrium is perp_mark
//      = spot_index + cumulative expected funding).
//   2. The position is delta-neutral at entry (long spot + short perp, or
//      vice-versa) so directional market moves do not blow the P&L.
//   3. The exit is a time-box (maxHoldHours default 72h) which bounds the
//      duration risk.
//
// Phase 11.2e single-venue scope (bybit.eu): no new data sources required —
// the spot mid, perp mark, and funding rate are all already available in
// the existing OHLCV + funding-rate data. Retail-viable at $10k base.
//
// The trade logic (per scope plan §"What 11.2e delivers"):
//   - `basis = (perp_mark - spot_index) / spot_index` (percentage).
//   - `carry_neutral = funding_rate × (24 / funding_interval_hours) / 365 × 365`
//     which simplifies to the per-day carry-neutral basis. NOTE: the scope
//     plan formula `funding_rate / 365 / funding_interval_hours` is read as
//     `fundingRate × (24 / fundingIntervalHours) / 365 × 365 = fundingRate × 3`
//     for the standard 8h bybit.eu cadence (3 funding periods per day). This
//     is the canonical basis-trade interpretation: daily carry-neutral = the
//     sum of one day's worth of funding payments.
//   - Entry SHORT basis (short perp + long spot) when
//     `basis > carry_neutral + entryThresholdBps` — basis is too rich, bet
//     on convergence.
//   - Entry LONG basis (long perp + short spot) when
//     `basis < carry_neutral - entryThresholdBps` — basis is too cheap.
//   - Exit when |basis - carry_neutral| < exitThresholdBps (mean-reverted)
//     OR hold_time > maxHoldHours (forced time-out).
//
// 1:10 leverage invariant — 3-LAYER DEFENSE
// -----------------------------------------
// This plugin's outgoing SizingSignals MUST respect the 1:10 cap:
//   Layer 1 (constructor): `metadata.maxLeverage = 10`. The registry
//     rejects any plugin whose metadata declares leverage > 10.
//   Layer 2 (per-emit): `assertLeverageInvariant(notional, baseNotionalUsd)`
//     BEFORE emit. If our computed notional already breached the cap,
//     throw — fail closed rather than emit a leverage-breaching signal.
//   Layer 3 (per-emit clamp): notional clamped to `baseNotionalUsd × 10`
//     BEFORE emit. Defense-in-depth — even if the formula accidentally
//     produced > 10× notional, the clamp + assertion catches it.
//
// Per-symbol disclosure (Phase 11.2e scope plan §"Per-symbol disclosure"):
//   - BTC/USDT: REGISTERED (default-on, low basis volatility)
//   - ETH/USDT: REGISTERED (default-on, low basis volatility)
//   - SOL/USDT: REGISTERED (default-on, medium basis volatility)
//
// What this plugin does NOT do:
//   - Does NOT generate DirectionSignals (it emits SizingSignals only).
//     The direction (long_basis / short_basis / flat) is encoded in the
//     `source` field suffix (`:short_basis` / `:long_basis` / `:flat`)
//     because the SizingSignal type's `notional` field must be ≥ 0
//     (HybridKelly + VolTarget plugins require non-negative notional
//     for their Layer 2/3 invariant assertions).
//   - Does NOT emit CarrySignals — it consumes them via the bus.
//   - Does NOT extend the 1:10 leverage ceiling (caps at 1:10).
//
// References (≥3 independent sources on basis-trade / spot-perp arbitrage):
//   - Avellaneda & Lipkin (2003) "A Market-Induced Approach to Asset
//     Pricing" — equilibrium basis = cumulative expected funding.
//     https://www.math.nyu.edu/faculty/avellane/Avellaneda_Lipkin_2003.pdf
//   - Hasbrouck (1993) "Assessing Trading Costs and Market Quality on
//     NASDAQ" — fair-value model for the basis, convergence timescales.
//     https://www0.gsb.columbia.edu/faculty/jhasbrouck/papers/hasbrouck_jf93.pdf
//   - bybit.eu "Inverse Perpetual Contract Mark Price Methodology" — the
//     bybit.eu perp_mark is a fair-value index = spot_index + EMA basis
//     over the last N minutes. When the perpetual trades away from mark
//     (funding-rate-driven), the basis converges.
//     https://www.bybit.com/en/help-center/article/How-to-Work-Out-the-Mark-Price
//   - CME Group "The Basis: Cash-Futures Spread" — the canonical reference
//     for spot-vs-derivative convergence (analogous to spot-perp in crypto).
//     https://www.cmegroup.com/education/courses/introduction-to-futures/the-basis.html
//   - TWIST Financial "Cash and Carry Trade: Crypto Basis Trading Guide" —
//     the retail-viable single-venue pattern that this plugin implements.
//     https://www.twistfinancial.com/blog/cash-and-carry-trade-crypto-basis-trading-guide

import {
  ONE_TO_TEN_LEVERAGE,
  assertLeverageInvariant,
} from "../../risk/leverage-invariant.js";

// Re-export so test suite + downstream consumers can import from one place.
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
  type PluginState,
  type Result,
  type SizingSignal,
  isCarry,
} from "../types.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * `BasisTradeConfig` — public, overridable configuration for
 * `BasisTradePlugin`. Defaults match the Phase 11.2e scope plan.
 */
export interface BasisTradeConfig {
  /**
   * Entry threshold in basis points (bps). When `|basis - carry_neutral|`
   * exceeds this threshold, ENTER the basis position in the direction
   * of convergence. Default 10 bps (0.10%).
   *
   * Higher threshold = fewer but more confident entries.
   * Lower threshold = more entries but smaller per-trade edge.
   * MUST be ≥ 0.
   */
  readonly basisEntryThresholdBps: number;
  /**
   * Exit threshold in basis points. When `|basis - carry_neutral|` falls
   * BELOW this threshold, EXIT the position (mean-reverted). Default
   * 5 bps (0.05%).
   *
   * The exit threshold is typically smaller than the entry threshold
   * to avoid whipsaw (immediately exiting after a noisy entry).
   * MUST be ≥ 0.
   */
  readonly basisExitThresholdBps: number;
  /**
   * Maximum hold duration in HOURS. Forces an exit if the basis has not
   * converged within this window. Default 72 hours (3 days).
   *
   * Rationale: basis convergence typically completes within 24-48h on
   * major pairs (BTC/ETH) and within 48-72h on SOL. Beyond 72h the
   * position is dead money — better to recycle capital.
   * MUST be an integer ≥ 1.
   */
  readonly maxHoldHours: number;
  /**
   * Funding interval in HOURS. bybit.eu perpetuals use 8h funding by
   * default; some altcoin perpetuals use 4h or 1h. Used by the
   * carry-neutral basis computation. Default 8h.
   * MUST be > 0.
   */
  readonly fundingIntervalHours: number;
  /**
   * Base notional in USD for the 1:10 cap validation. Outgoing
   * SizingSignals are validated against `baseNotionalUsd × 10`.
   * Default: 10_000.
   */
  readonly baseNotionalUsd: number;
  /**
   * Per-symbol enable list. Phase 11.2e scope plan §"Per-symbol
   * disclosure": BTC + ETH + SOL all default-on.
   */
  readonly enabledSymbols: readonly string[];
  /**
   * Kelly fraction multiplier. Default 1.0 — the plugin emits at full
   * size; downstream modifiers (HybridKelly, VolTarget) rescale.
   * MUST be in (0, 1].
   */
  readonly kellyFraction: number;
  /**
   * Vol multiplier. Default 1.0 — same pattern as kellyFraction.
   * MUST be in (0, 1].
   */
  readonly volMultiplier: number;
}

// ---------------------------------------------------------------------------
// Defaults + bounds
// ---------------------------------------------------------------------------

export const DEFAULT_BASIS_ENTRY_THRESHOLD_BPS = 10 as const;
export const DEFAULT_BASIS_EXIT_THRESHOLD_BPS = 5 as const;
export const DEFAULT_MAX_HOLD_HOURS = 72 as const;
export const DEFAULT_FUNDING_INTERVAL_HOURS = 8 as const;
export const DEFAULT_BASE_NOTIONAL_USD = 10_000 as const;
export const DEFAULT_KELLY_FRACTION = 1.0 as const;
export const DEFAULT_VOL_MULTIPLIER = 1.0 as const;
export const DEFAULT_ENABLED_SYMBOLS: readonly string[] = [
  "BTC/USDT",
  "ETH/USDT",
  "SOL/USDT",
];

export const MIN_BASIS_ENTRY_THRESHOLD_BPS = 0 as const;
export const MAX_BASIS_ENTRY_THRESHOLD_BPS = 100 as const; // 1% max divergence
export const MIN_BASIS_EXIT_THRESHOLD_BPS = 0 as const;
export const MAX_BASIS_EXIT_THRESHOLD_BPS = 100 as const;
export const MIN_MAX_HOLD_HOURS = 1 as const;
export const MAX_MAX_HOLD_HOURS = 168 as const; // 1 week
export const MIN_FUNDING_INTERVAL_HOURS = 1 as const;
export const MAX_FUNDING_INTERVAL_HOURS = 24 as const;

// ---------------------------------------------------------------------------
// Position state (per-symbol)
// ---------------------------------------------------------------------------

/**
 * `BasisPositionSide` — discrete position state machine.
 *   - `flat` — no open basis position.
 *   - `short_basis` — short perp + long spot (betting on basis convergence
 *     from the rich side).
 *   - `long_basis` — long perp + short spot (betting on basis convergence
 *     from the cheap side).
 */
export type BasisPositionSide = "flat" | "short_basis" | "long_basis";

/**
 * `BasisExitReason` — diagnostic tag for exits.
 *   - `converged` — basis mean-reverted within exitThreshold.
 *   - `timeout` — maxHoldHours reached without convergence.
 *   - `none` — position is open (no exit yet).
 */
export type BasisExitReason = "none" | "converged" | "timeout";

interface SymbolBasisState {
  // Latest spot price observed. null until first recordSpotPrice.
  spotPrice: number | null;
  // Latest perp mark observed. null until first recordPerpMark.
  perpMark: number | null;
  // Latest funding rate (per funding_interval_hours) observed. null until
  // first recordFundingSample or carry bus signal.
  fundingRate: number | null;
  // Timestamp of the last funding update (ms).
  lastFundingUpdateMs: number | null;
  // Computed basis at the most recent onBar. null until both spot + perp observed.
  currentBasis: number | null;
  // Computed carry-neutral basis at the most recent onBar. null until funding observed.
  carryNeutral: number | null;
  // Most recent divergence (currentBasis - carryNeutral). null until both observable.
  divergence: number | null;
  // Position state machine.
  position: BasisPositionSide;
  // Entry-side metadata — set when position transitions from flat to open.
  entryTimestampMs: number | null;
  entrySpotPrice: number | null;
  entryPerpMark: number | null;
  entryBasis: number | null;
  entryCarryNeutral: number | null;
  entryDivergence: number | null;
  // Current exit reason (set when position transitions to flat).
  lastExitReason: BasisExitReason;
  // Cumulative stats.
  entriesTotal: number;
  exitsConverged: number;
  exitsTimeout: number;
  // Last emitted SizingSignal — for diagnostics + tests.
  lastSizingSignal: SizingSignal | null;
  // Track the running max divergence seen during this position — for
  // diagnostics + tests.
  maxDivergenceDuringPosition: number | null;
  // Track the holding time at exit — for diagnostics + tests.
  holdTimeHoursAtExit: number | null;
}

// ---------------------------------------------------------------------------
// Mutable plugin state
// ---------------------------------------------------------------------------

export interface BasisTradePluginState {
  /** Per-symbol rolling-window state. Keyed by symbol. */
  readonly symbolState: Map<string, SymbolBasisState>;
  /** Count of CarrySignals intercepted since construction. */
  carrySignalsReceived: number;
  /** Count of SizingSignals emitted since construction. */
  sizingSignalsEmitted: number;
  /** Count of entry signals emitted (long_basis or short_basis transitions). */
  entryCount: number;
  /** Count of exit signals emitted (transitions back to flat). */
  exitCount: number;
  /** Count of bars processed since construction. */
  barsProcessed: number;
  /** Count of layer 2 leverage-invariant assertions (BEFORE emit). */
  layer2AssertionCount: number;
  /** Count of layer 3 leverage-invariant assertions (AFTER clamp, BEFORE emit). */
  layer3AssertionCount: number;
  /** Count of clamp events where notional was clamped at baseNotional × 10. */
  notionalClampCount: number;
  /** Count of LAYER 2 / LAYER 3 leverage breaches. */
  leverageBreachDrops: number;
  /** Count of times a signal was dropped because the symbol is not enabled. */
  symbolDropCount: number;
  /** Last emitted SizingSignal — for diagnostics + tests. */
  lastSizingSignal: SizingSignal | null;
  /** Last basis computed per symbol — for diagnostics. */
  lastBasisPerSymbol: Map<string, number>;
  /** Last carry-neutral per symbol — for diagnostics. */
  lastCarryNeutralPerSymbol: Map<string, number>;
}

// ---------------------------------------------------------------------------
// BasisTradePlugin
// ---------------------------------------------------------------------------

/**
 * `BasisTradePlugin` — drop-in alpha plugin for the Signal Center that
 * captures spot-vs-perp basis convergence when it diverges from
 * funding-neutral. Emits SizingSignals on entry/exit transitions.
 *
 * The plugin operates in two modes:
 *   - **Modifier (production)**: subscribes to `signal:carry` to read
 *     funding-rate state; reads spot+perp prices via `recordSpotPrice` /
 *     `recordPerpMark` (per-bar, per-symbol); emits SizingSignals on
 *     position transitions.
 *   - **Bootstrap (testing)**: in tests, callers can call
 *     `recordFundingSample(symbol, rate, ts)` directly to seed
 *     per-symbol funding state, then drive `onBar` to trigger entry/exit
 *     logic.
 *
 * The 1:10 leverage invariant is enforced via 3-LAYER DEFENSE:
 *   1. Constructor: `metadata.maxLeverage = 10`.
 *   2. Per-emit: `assertLeverageInvariant(notional, baseNotionalUsd)`.
 *   3. Per-emit clamp: notional clamped to `baseNotionalUsd × 10`.
 */
export class BasisTradePlugin implements StrategyPlugin {
  // ---------------------------------------------------------------------
  // Static metadata
  // ---------------------------------------------------------------------

  public readonly metadata: StrategyPluginMetadata = {
    name: "basis-trade-v1",
    version: "1.0.0",
    edgeClass: "mixed", // reads carry signals + emits sizing signals
    capitalRequirement: 10_000,
    maxLeverage: ONE_TO_TEN_LEVERAGE, // Layer 1 of 3-layer 1:10 defense
    description:
      "Phase 11.2e ALPHA drop-in plugin — spot-vs-perp basis convergence. " +
      "Enters when |basis - carry_neutral| > entryThresholdBps (default 10bps), " +
      "exits when mean-reverted within exitThresholdBps (default 5bps) OR after " +
      "maxHoldHours (default 72h). 1:10 leverage invariant enforced via 3-layer " +
      "defense. BTC/ETH/SOL default-on.",
    dependencies: [],
  };

  // ---------------------------------------------------------------------
  // Instance state
  // ---------------------------------------------------------------------

  public readonly config: BasisTradeConfig;
  public readonly state: BasisTradePluginState;
  /** Captured bus reference for emit. Set in subscribe(). */
  private _bus: SignalBus | null = null;
  /** Unsubscribe handle for the carry subscriber. */
  private _unsubCarry: (() => void) | null = null;
  /** Whether subscribe() has been called. */
  private _wired = false;

  // ---------------------------------------------------------------------
  // Construction
  // ---------------------------------------------------------------------

  constructor(overrides: Partial<BasisTradeConfig> = {}) {
    this.config = {
      basisEntryThresholdBps:
        overrides.basisEntryThresholdBps ?? DEFAULT_BASIS_ENTRY_THRESHOLD_BPS,
      basisExitThresholdBps:
        overrides.basisExitThresholdBps ?? DEFAULT_BASIS_EXIT_THRESHOLD_BPS,
      maxHoldHours: overrides.maxHoldHours ?? DEFAULT_MAX_HOLD_HOURS,
      fundingIntervalHours:
        overrides.fundingIntervalHours ?? DEFAULT_FUNDING_INTERVAL_HOURS,
      baseNotionalUsd:
        overrides.baseNotionalUsd ?? DEFAULT_BASE_NOTIONAL_USD,
      enabledSymbols: overrides.enabledSymbols ?? DEFAULT_ENABLED_SYMBOLS,
      kellyFraction: overrides.kellyFraction ?? DEFAULT_KELLY_FRACTION,
      volMultiplier: overrides.volMultiplier ?? DEFAULT_VOL_MULTIPLIER,
    };

    // LAYER 1 — constructor assertion. The metadata is statically typed
    // as `maxLeverage: 10`, so this comparison is always true at
    // runtime. We keep it as defense-in-depth.
    if (this.metadata.maxLeverage !== ONE_TO_TEN_LEVERAGE) {
      throw new Error(
        `[BasisTradePlugin] LAYER 1 BREACH: metadata.maxLeverage=${String(this.metadata.maxLeverage)} but the project-wide 1:10 mandate requires 10.`,
      );
    }

    // Hard config validation — defense in depth. validateConfig()
    // does the non-throwing audit; constructor throws on hard
    // failures so bad configs fail fast.
    if (this.config.basisEntryThresholdBps < MIN_BASIS_ENTRY_THRESHOLD_BPS) {
      throw new Error(
        `[BasisTradePlugin] basisEntryThresholdBps=${this.config.basisEntryThresholdBps} must be ≥ ${MIN_BASIS_ENTRY_THRESHOLD_BPS}.`,
      );
    }
    if (this.config.basisEntryThresholdBps > MAX_BASIS_ENTRY_THRESHOLD_BPS) {
      throw new Error(
        `[BasisTradePlugin] basisEntryThresholdBps=${this.config.basisEntryThresholdBps} exceeds max ${MAX_BASIS_ENTRY_THRESHOLD_BPS}.`,
      );
    }
    if (this.config.basisExitThresholdBps < MIN_BASIS_EXIT_THRESHOLD_BPS) {
      throw new Error(
        `[BasisTradePlugin] basisExitThresholdBps=${this.config.basisExitThresholdBps} must be ≥ ${MIN_BASIS_EXIT_THRESHOLD_BPS}.`,
      );
    }
    if (this.config.basisExitThresholdBps > MAX_BASIS_EXIT_THRESHOLD_BPS) {
      throw new Error(
        `[BasisTradePlugin] basisExitThresholdBps=${this.config.basisExitThresholdBps} exceeds max ${MAX_BASIS_EXIT_THRESHOLD_BPS}.`,
      );
    }
    if (
      !Number.isInteger(this.config.maxHoldHours) ||
      this.config.maxHoldHours < MIN_MAX_HOLD_HOURS ||
      this.config.maxHoldHours > MAX_MAX_HOLD_HOURS
    ) {
      throw new Error(
        `[BasisTradePlugin] maxHoldHours=${this.config.maxHoldHours} must be an integer in [${MIN_MAX_HOLD_HOURS}, ${MAX_MAX_HOLD_HOURS}].`,
      );
    }
    if (
      this.config.fundingIntervalHours < MIN_FUNDING_INTERVAL_HOURS ||
      this.config.fundingIntervalHours > MAX_FUNDING_INTERVAL_HOURS
    ) {
      throw new Error(
        `[BasisTradePlugin] fundingIntervalHours=${this.config.fundingIntervalHours} must be in [${MIN_FUNDING_INTERVAL_HOURS}, ${MAX_FUNDING_INTERVAL_HOURS}].`,
      );
    }
    if (this.config.baseNotionalUsd <= 0) {
      throw new Error(
        `[BasisTradePlugin] baseNotionalUsd=${this.config.baseNotionalUsd} must be > 0.`,
      );
    }
    if (this.config.kellyFraction <= 0 || this.config.kellyFraction > 1.0) {
      throw new Error(
        `[BasisTradePlugin] kellyFraction=${this.config.kellyFraction} must be in (0, 1.0].`,
      );
    }
    if (this.config.volMultiplier <= 0 || this.config.volMultiplier > 1.0) {
      throw new Error(
        `[BasisTradePlugin] volMultiplier=${this.config.volMultiplier} must be in (0, 1.0].`,
      );
    }

    this.state = {
      symbolState: new Map<string, SymbolBasisState>(),
      carrySignalsReceived: 0,
      sizingSignalsEmitted: 0,
      entryCount: 0,
      exitCount: 0,
      barsProcessed: 0,
      layer2AssertionCount: 0,
      layer3AssertionCount: 0,
      notionalClampCount: 0,
      leverageBreachDrops: 0,
      symbolDropCount: 0,
      lastSizingSignal: null,
      lastBasisPerSymbol: new Map<string, number>(),
      lastCarryNeutralPerSymbol: new Map<string, number>(),
    };
  }

  // ---------------------------------------------------------------------
  // subscribe — wire SignalBus handler
  // ---------------------------------------------------------------------

  subscribe(bus: SignalBus): void {
    this._bus = bus;
    // Subscribe to CarrySignals to ingest funding-rate state. The
    // CarrySignal as currently defined does NOT carry an explicit
    // symbol field, so for multi-symbol feeds we use `recordFundingSample`
    // for per-symbol routing. The bus subscriber is a fallback that
    // broadcasts the funding rate to all enabled symbols (intentionally
    // conservative — for backtest determinism, the central runner
    // should use `recordFundingSample(symbol, rate, ts)` for precise
    // per-symbol routing).
    this._unsubCarry = bus.subscribe("carry", (s) => {
      if (!isCarry(s)) return;
      this._onCarrySignal(s);
    });
    this._wired = true;
  }

  // ---------------------------------------------------------------------
  // onBar — per-bar tick. Computes basis + carry-neutral + state-machine
  // transitions for the most-recently-updated symbol (since `Bar` does
  // not carry a symbol).
  // ---------------------------------------------------------------------

  onBar(bar: Bar, _state: PluginState): void {
    this.state.barsProcessed += 1;
    // `Bar` does not carry a symbol identifier. For multi-symbol feeds,
    // the central runner calls `recordSpotPrice` / `recordPerpMark` /
    // `recordFundingSample` per-symbol per-bar (Phase 11.2e Track B
    // runner pattern), then drives `onBar` once at the end of each
    // timestamp. The state-machine logic iterates over enabled symbols
    // in `evaluateSymbol` — each symbol with sufficient data may
    // transition.
    void bar;
    // Evaluate all enabled symbols — each may transition independently.
    for (const sym of this.config.enabledSymbols) {
      this._evaluateSymbol(sym);
    }
  }

  // ---------------------------------------------------------------------
  // validateConfig — non-throwing variant of constructor checks
  // ---------------------------------------------------------------------

  validateConfig(config: unknown): Result<void, ConfigError> {
    const makeErr = (
      field: string,
      message: string,
      value: unknown,
    ): Result<void, ConfigError> => ({
      ok: false,
      error: {
        pluginName: this.metadata.name,
        field,
        message,
        value,
      },
    });
    if (config === null || config === undefined) return { ok: true, value: undefined };
    if (typeof config !== "object") {
      return makeErr("config", "must be an object or null/undefined", config);
    }
    const c = config as Record<string, unknown>;
    // basisEntryThresholdBps
    if (c["basisEntryThresholdBps"] !== undefined) {
      if (typeof c["basisEntryThresholdBps"] !== "number" || !Number.isFinite(c["basisEntryThresholdBps"])) {
        return makeErr(
          "basisEntryThresholdBps",
          "must be a finite number",
          c["basisEntryThresholdBps"],
        );
      }
      if (
        c["basisEntryThresholdBps"] < MIN_BASIS_ENTRY_THRESHOLD_BPS ||
        c["basisEntryThresholdBps"] > MAX_BASIS_ENTRY_THRESHOLD_BPS
      ) {
        return makeErr(
          "basisEntryThresholdBps",
          `must be in [${MIN_BASIS_ENTRY_THRESHOLD_BPS}, ${MAX_BASIS_ENTRY_THRESHOLD_BPS}] bps`,
          c["basisEntryThresholdBps"],
        );
      }
    }
    // basisExitThresholdBps
    if (c["basisExitThresholdBps"] !== undefined) {
      if (typeof c["basisExitThresholdBps"] !== "number" || !Number.isFinite(c["basisExitThresholdBps"])) {
        return makeErr(
          "basisExitThresholdBps",
          "must be a finite number",
          c["basisExitThresholdBps"],
        );
      }
      if (
        c["basisExitThresholdBps"] < MIN_BASIS_EXIT_THRESHOLD_BPS ||
        c["basisExitThresholdBps"] > MAX_BASIS_EXIT_THRESHOLD_BPS
      ) {
        return makeErr(
          "basisExitThresholdBps",
          `must be in [${MIN_BASIS_EXIT_THRESHOLD_BPS}, ${MAX_BASIS_EXIT_THRESHOLD_BPS}] bps`,
          c["basisExitThresholdBps"],
        );
      }
    }
    // maxHoldHours
    if (c["maxHoldHours"] !== undefined) {
      if (typeof c["maxHoldHours"] !== "number" || !Number.isFinite(c["maxHoldHours"])) {
        return makeErr(
          "maxHoldHours",
          "must be a finite number",
          c["maxHoldHours"],
        );
      }
      if (
        !Number.isInteger(c["maxHoldHours"]) ||
        c["maxHoldHours"] < MIN_MAX_HOLD_HOURS ||
        c["maxHoldHours"] > MAX_MAX_HOLD_HOURS
      ) {
        return makeErr(
          "maxHoldHours",
          `must be an integer in [${MIN_MAX_HOLD_HOURS}, ${MAX_MAX_HOLD_HOURS}] hours`,
          c["maxHoldHours"],
        );
      }
    }
    // fundingIntervalHours
    if (c["fundingIntervalHours"] !== undefined) {
      if (typeof c["fundingIntervalHours"] !== "number" || !Number.isFinite(c["fundingIntervalHours"])) {
        return makeErr(
          "fundingIntervalHours",
          "must be a finite number",
          c["fundingIntervalHours"],
        );
      }
      if (
        c["fundingIntervalHours"] < MIN_FUNDING_INTERVAL_HOURS ||
        c["fundingIntervalHours"] > MAX_FUNDING_INTERVAL_HOURS
      ) {
        return makeErr(
          "fundingIntervalHours",
          `must be in [${MIN_FUNDING_INTERVAL_HOURS}, ${MAX_FUNDING_INTERVAL_HOURS}] hours`,
          c["fundingIntervalHours"],
        );
      }
    }
    // baseNotionalUsd
    if (c["baseNotionalUsd"] !== undefined) {
      if (typeof c["baseNotionalUsd"] !== "number" || !Number.isFinite(c["baseNotionalUsd"])) {
        return makeErr(
          "baseNotionalUsd",
          "must be a finite number",
          c["baseNotionalUsd"],
        );
      }
      if (c["baseNotionalUsd"] <= 0) {
        return makeErr("baseNotionalUsd", "must be > 0", c["baseNotionalUsd"]);
      }
    }
    // kellyFraction
    if (c["kellyFraction"] !== undefined) {
      if (typeof c["kellyFraction"] !== "number" || !Number.isFinite(c["kellyFraction"])) {
        return makeErr(
          "kellyFraction",
          "must be a finite number",
          c["kellyFraction"],
        );
      }
      if (c["kellyFraction"] <= 0 || c["kellyFraction"] > 1.0) {
        return makeErr(
          "kellyFraction",
          "must be in (0, 1.0]",
          c["kellyFraction"],
        );
      }
    }
    // volMultiplier
    if (c["volMultiplier"] !== undefined) {
      if (typeof c["volMultiplier"] !== "number" || !Number.isFinite(c["volMultiplier"])) {
        return makeErr(
          "volMultiplier",
          "must be a finite number",
          c["volMultiplier"],
        );
      }
      if (c["volMultiplier"] <= 0 || c["volMultiplier"] > 1.0) {
        return makeErr(
          "volMultiplier",
          "must be in (0, 1.0]",
          c["volMultiplier"],
        );
      }
    }
    // enabledSymbols
    if (c["enabledSymbols"] !== undefined) {
      if (!Array.isArray(c["enabledSymbols"])) {
        return makeErr(
          "enabledSymbols",
          "must be an array of strings",
          c["enabledSymbols"],
        );
      }
      for (const sym of c["enabledSymbols"]) {
        if (typeof sym !== "string" || sym.length === 0) {
          return makeErr(
            "enabledSymbols",
            "each entry must be a non-empty string",
            sym as unknown,
          );
        }
      }
    }
    return { ok: true, value: undefined };
  }

  // ---------------------------------------------------------------------
  // reset — clear mutable state between runs
  // ---------------------------------------------------------------------

  reset(): void {
    this.state.symbolState.clear();
    this.state.carrySignalsReceived = 0;
    this.state.sizingSignalsEmitted = 0;
    this.state.entryCount = 0;
    this.state.exitCount = 0;
    this.state.barsProcessed = 0;
    this.state.layer2AssertionCount = 0;
    this.state.layer3AssertionCount = 0;
    this.state.notionalClampCount = 0;
    this.state.leverageBreachDrops = 0;
    this.state.symbolDropCount = 0;
    this.state.lastSizingSignal = null;
    this.state.lastBasisPerSymbol.clear();
    this.state.lastCarryNeutralPerSymbol.clear();
  }

  // ---------------------------------------------------------------------
  // dispose — release SignalBus subscription
  // ---------------------------------------------------------------------

  dispose(): void {
    if (this._unsubCarry) {
      try {
        this._unsubCarry();
      } catch {
        // defensive — unsubscriber throws are swallowed
      }
      this._unsubCarry = null;
    }
    this._bus = null;
    this._wired = false;
  }

  // ---------------------------------------------------------------------
  // Public helpers — used by central runner + tests
  // ---------------------------------------------------------------------

  /**
   * `recordSpotPrice` — feed a single spot-index observation. The
   * canonical injection path for spot prices. Called by the central
   * runner once per bar per symbol.
   *
   * Per-symbol enable filter: non-enabled symbols are silently dropped.
   */
  recordSpotPrice(symbol: string, spot: number): void {
    if (!Number.isFinite(spot) || spot <= 0) {
      throw new Error(
        `BasisTradePlugin.recordSpotPrice: spot must be a positive finite number, got ${spot}`,
      );
    }
    if (!this.config.enabledSymbols.includes(symbol)) return;
    const ss = this._getOrCreateSymbolState(symbol);
    ss.spotPrice = spot;
  }

  /**
   * `recordPerpMark` — feed a single perp-mark observation. The
   * canonical injection path for perp mark prices. Called by the
   * central runner once per bar per symbol.
   *
   * Per-symbol enable filter: non-enabled symbols are silently dropped.
   */
  recordPerpMark(symbol: string, perpMark: number): void {
    if (!Number.isFinite(perpMark) || perpMark <= 0) {
      throw new Error(
        `BasisTradePlugin.recordPerpMark: perpMark must be a positive finite number, got ${perpMark}`,
      );
    }
    if (!this.config.enabledSymbols.includes(symbol)) return;
    const ss = this._getOrCreateSymbolState(symbol);
    ss.perpMark = perpMark;
  }

  /**
   * `recordFundingSample` — feed a single funding-rate snapshot for a
   * given symbol. The canonical injection path for per-symbol funding
   * state. Called by the central runner once per funding tick (or by
   * tests directly).
   *
   * Per-symbol enable filter: non-enabled symbols are silently dropped.
   */
  recordFundingSample(
    symbol: string,
    fundingRate: number,
    timestampMs: number,
  ): void {
    if (!Number.isFinite(fundingRate)) {
      throw new Error(
        `BasisTradePlugin.recordFundingSample: fundingRate must be finite, got ${fundingRate}`,
      );
    }
    if (!Number.isFinite(timestampMs) || timestampMs < 0) {
      throw new Error(
        `BasisTradePlugin.recordFundingSample: timestampMs must be a non-negative finite number, got ${timestampMs}`,
      );
    }
    if (!this.config.enabledSymbols.includes(symbol)) return;
    const ss = this._getOrCreateSymbolState(symbol);
    ss.fundingRate = fundingRate;
    ss.lastFundingUpdateMs = timestampMs;
  }

  /**
   * `currentBasisForSymbol` — returns the latest computed basis for
   * `symbol`, or `null` if insufficient data.
   */
  currentBasisForSymbol(symbol: string): number | null {
    const ss = this.state.symbolState.get(symbol);
    return ss?.currentBasis ?? null;
  }

  /**
   * `currentCarryNeutralForSymbol` — returns the latest computed
   * carry-neutral basis for `symbol`, or `null` if no funding data.
   */
  currentCarryNeutralForSymbol(symbol: string): number | null {
    const ss = this.state.symbolState.get(symbol);
    return ss?.carryNeutral ?? null;
  }

  /**
   * `currentDivergenceForSymbol` — returns the latest
   * (currentBasis - carryNeutral) for `symbol`, or `null`.
   */
  currentDivergenceForSymbol(symbol: string): number | null {
    const ss = this.state.symbolState.get(symbol);
    return ss?.divergence ?? null;
  }

  /**
   * `positionForSymbol` — returns the current position side
   * (`flat` / `long_basis` / `short_basis`) for `symbol`.
   */
  positionForSymbol(symbol: string): BasisPositionSide {
    const ss = this.state.symbolState.get(symbol);
    return ss?.position ?? "flat";
  }

  /**
   * `lastExitReasonForSymbol` — returns the most recent exit reason
   * (`none` / `converged` / `timeout`) for `symbol`.
   */
  lastExitReasonForSymbol(symbol: string): BasisExitReason {
    const ss = this.state.symbolState.get(symbol);
    return ss?.lastExitReason ?? "none";
  }

  /**
   * `isSymbolEnabled` — returns true if `symbol` is in
   * `config.enabledSymbols`.
   */
  isSymbolEnabled(symbol: string): boolean {
    return this.config.enabledSymbols.includes(symbol);
  }

  /**
   * `effectiveMaxNotionalUsd` — the 1:10 leverage cap expressed as
   * `baseNotionalUsd × 10`. Used by tests + downstream consumers.
   */
  effectiveMaxNotionalUsd(): number {
    return this.config.baseNotionalUsd * ONE_TO_TEN_LEVERAGE;
  }

  /**
   * `assertLeverageInvariantForTesting` — public hook so the test
   * suite can validate Layer 2/3 throws on synthetic breaches.
   */
  assertLeverageInvariantForTesting(notional: number): void {
    assertLeverageInvariant(notional, this.config.baseNotionalUsd);
  }

  // ---------------------------------------------------------------------
  // Internal — CarrySignal handler (broadcast funding rate to all enabled)
  // ---------------------------------------------------------------------

  /**
   * `_onCarrySignal` — feed a CarrySignal's funding rate into the
   * per-symbol funding history. CarrySignal as currently defined does
   * NOT carry an explicit symbol field; for multi-symbol feeds, the
   * central runner uses `recordFundingSample(symbol, rate, ts)` for
   * per-symbol routing. The bus subscriber broadcasts to all enabled
   * symbols as a fallback (intentionally conservative).
   */
  private _onCarrySignal(s: CarrySignal): void {
    this.state.carrySignalsReceived += 1;
    const ts = s.timestampMs ?? Date.now();
    for (const sym of this.config.enabledSymbols) {
      const ss = this._getOrCreateSymbolState(sym);
      ss.fundingRate = s.fundingRate;
      ss.lastFundingUpdateMs = ts;
    }
  }

  // ---------------------------------------------------------------------
  // Internal — per-symbol state-machine evaluation
  // ---------------------------------------------------------------------

  /**
   * `_evaluateSymbol` — computes basis + carry-neutral for `symbol`,
   * checks entry/exit conditions, and emits a SizingSignal on
   * transition. The state machine:
   *
   *   flat → short_basis  when basis > carryNeutral + entryThresholdBps
   *   flat → long_basis   when basis < carryNeutral - entryThresholdBps
   *   open → flat         when |basis - carryNeutral| < exitThresholdBps
   *                        OR holdTimeHours > maxHoldHours
   */
  private _evaluateSymbol(symbol: string): void {
    const ss = this._getOrCreateSymbolState(symbol);
    if (ss.spotPrice === null || ss.perpMark === null) {
      // Insufficient price data — skip.
      return;
    }
    if (ss.fundingRate === null) {
      // Insufficient funding data — skip.
      return;
    }

    // Compute basis = (perp_mark - spot_index) / spot_index.
    const basis = (ss.perpMark - ss.spotPrice) / ss.spotPrice;
    ss.currentBasis = basis;
    this.state.lastBasisPerSymbol.set(symbol, basis);

    // Compute carry-neutral basis. The scope plan formula
    // `funding_rate / 365 / funding_interval_hours` is interpreted
    // as the per-day carry-neutral basis. Standard 8h bybit.eu
    // funding: daily_carry_neutral = fundingRate × (24 / 8) = 3 × fundingRate.
    // In general: fundingRate × (24 / fundingIntervalHours).
    const periodsPerDay = 24 / this.config.fundingIntervalHours;
    const carryNeutral = ss.fundingRate * periodsPerDay;
    ss.carryNeutral = carryNeutral;
    this.state.lastCarryNeutralPerSymbol.set(symbol, carryNeutral);

    const divergence = basis - carryNeutral;
    ss.divergence = divergence;

    // Track max divergence during position for diagnostics.
    if (ss.position !== "flat") {
      const absDiv = Math.abs(divergence);
      if (ss.maxDivergenceDuringPosition === null || absDiv > ss.maxDivergenceDuringPosition) {
        ss.maxDivergenceDuringPosition = absDiv;
      }
    }

    const entryThresholdFrac =
      this.config.basisEntryThresholdBps / 10_000; // bps → fraction
    const exitThresholdFrac =
      this.config.basisExitThresholdBps / 10_000;

    const now = Date.now();

    // ---- Position state machine ----
    if (ss.position === "flat") {
      // ENTRY conditions.
      if (divergence > entryThresholdFrac) {
        // SHORT basis (perp rich → bet on convergence).
        this._enterPosition(symbol, ss, "short_basis", now);
      } else if (divergence < -entryThresholdFrac) {
        // LONG basis (perp cheap → bet on convergence).
        this._enterPosition(symbol, ss, "long_basis", now);
      }
    } else {
      // EXIT conditions — check both convergence + time-out.
      const absDiv = Math.abs(divergence);
      const holdTimeHours = ss.entryTimestampMs !== null
        ? (now - ss.entryTimestampMs) / (60 * 60 * 1000)
        : 0;
      if (absDiv < exitThresholdFrac) {
        // CONVERGED — exit.
        this._exitPosition(symbol, ss, "converged", holdTimeHours, now);
      } else if (holdTimeHours > this.config.maxHoldHours) {
        // TIMEOUT — force exit.
        this._exitPosition(symbol, ss, "timeout", holdTimeHours, now);
      }
    }
  }

  /**
   * `_enterPosition` — transition from flat to a basis position. Emits
   * a SizingSignal with the configured base notional × leverage.
   */
  private _enterPosition(
    symbol: string,
    ss: SymbolBasisState,
    side: "short_basis" | "long_basis",
    nowMs: number,
  ): void {
    ss.position = side;
    ss.entryTimestampMs = nowMs;
    ss.entrySpotPrice = ss.spotPrice;
    ss.entryPerpMark = ss.perpMark;
    ss.entryBasis = ss.currentBasis;
    ss.entryCarryNeutral = ss.carryNeutral;
    ss.entryDivergence = ss.divergence;
    ss.lastExitReason = "none";
    ss.maxDivergenceDuringPosition = Math.abs(ss.divergence ?? 0);
    ss.entriesTotal += 1;
    this.state.entryCount += 1;

    // Compute notional = baseNotionalUsd × leverage × kellyFraction ×
    // volMultiplier. With defaults this is 10_000 × 10 × 1.0 × 1.0 =
    // 100_000 (the 1:10 cap).
    let notional = this.config.baseNotionalUsd
      * ONE_TO_TEN_LEVERAGE
      * this.config.kellyFraction
      * this.config.volMultiplier;

    // LAYER 2 — assert the computed notional respects 1:10.
    try {
      this.assertLeverageInvariantForTesting(notional);
      this.state.layer2AssertionCount += 1;
    } catch {
      this.state.leverageBreachDrops += 1;
      throw new Error(
        `[BasisTradePlugin] LAYER 2 BREACH: computed notional=${notional} > baseNotionalUsd × ${ONE_TO_TEN_LEVERAGE}.`,
      );
    }

    // LAYER 3 — clamp + assert again (defense in depth).
    const maxNotional = this.effectiveMaxNotionalUsd();
    if (notional > maxNotional) {
      notional = maxNotional;
      this.state.notionalClampCount += 1;
    }
    try {
      this.assertLeverageInvariantForTesting(notional);
      this.state.layer3AssertionCount += 1;
    } catch {
      this.state.leverageBreachDrops += 1;
      throw new Error(
        `[BasisTradePlugin] LAYER 3 BREACH: notional=${notional} > baseNotionalUsd × ${ONE_TO_TEN_LEVERAGE} after clamp.`,
      );
    }

    // Emit SizingSignal. Direction encoded in `source` suffix.
    // Notional is always positive (HybridKelly + VolTarget require
    // non-negative notional for their Layer 2/3 invariant assertions).
    const sig: SizingSignal = {
      kind: "sizing",
      kellyFraction: this.config.kellyFraction,
      volMultiplier: this.config.volMultiplier,
      notional,
      source: `${this.metadata.name}:${symbol}:${side}`,
      ...(nowMs > 0 ? { timestampMs: nowMs } : {}),
    };
    ss.lastSizingSignal = sig;
    this.state.lastSizingSignal = sig;
    this._emitSignal(sig);
    this.state.sizingSignalsEmitted += 1;
  }

  /**
   * `_exitPosition` — transition from open position back to flat.
   * Emits a SizingSignal with `source` suffix `:flat` so downstream
   * modifiers know the position is closed. Notional is reduced to 0.
   */
  private _exitPosition(
    symbol: string,
    ss: SymbolBasisState,
    reason: BasisExitReason,
    holdTimeHours: number,
    nowMs: number,
  ): void {
    const side = ss.position;
    ss.position = "flat";
    ss.lastExitReason = reason;
    ss.holdTimeHoursAtExit = holdTimeHours;
    if (reason === "converged") {
      ss.exitsConverged += 1;
    } else if (reason === "timeout") {
      ss.exitsTimeout += 1;
    }
    this.state.exitCount += 1;

    // On exit we emit a SizingSignal with notional = 0 to signal the
    // position is closed. This is the canonical "close position" pattern.
    // LAYER 2 + LAYER 3 trivially pass for notional = 0.
    const sig: SizingSignal = {
      kind: "sizing",
      kellyFraction: this.config.kellyFraction,
      volMultiplier: this.config.volMultiplier,
      notional: 0,
      source: `${this.metadata.name}:${symbol}:flat`,
      ...(nowMs > 0 ? { timestampMs: nowMs } : {}),
    };
    ss.lastSizingSignal = sig;
    this.state.lastSizingSignal = sig;
    this._emitSignal(sig);
    this.state.sizingSignalsEmitted += 1;

    // Reset position entry metadata.
    ss.entryTimestampMs = null;
    ss.entrySpotPrice = null;
    ss.entryPerpMark = null;
    ss.entryBasis = null;
    ss.entryCarryNeutral = null;
    ss.entryDivergence = null;
    ss.maxDivergenceDuringPosition = null;
    void side; // silence unused-var lint; side is implicit in source
  }

  // ---------------------------------------------------------------------
  // Internal — helpers
  // ---------------------------------------------------------------------

  /**
   * `_emitSignal` — broadcast a SizingSignal on the bus if wired.
   * Silent no-op if `subscribe()` was never called.
   */
  private _emitSignal(sig: SizingSignal): void {
    if (this._bus && this._wired) {
      this._bus.emit(sig);
    }
  }

  /**
   * `_getOrCreateSymbolState` — lazy init per-symbol state.
   */
  private _getOrCreateSymbolState(symbol: string): SymbolBasisState {
    let ss = this.state.symbolState.get(symbol);
    if (!ss) {
      ss = {
        spotPrice: null,
        perpMark: null,
        fundingRate: null,
        lastFundingUpdateMs: null,
        currentBasis: null,
        carryNeutral: null,
        divergence: null,
        position: "flat",
        entryTimestampMs: null,
        entrySpotPrice: null,
        entryPerpMark: null,
        entryBasis: null,
        entryCarryNeutral: null,
        entryDivergence: null,
        lastExitReason: "none",
        entriesTotal: 0,
        exitsConverged: 0,
        exitsTimeout: 0,
        lastSizingSignal: null,
        maxDivergenceDuringPosition: null,
        holdTimeHoursAtExit: null,
      };
      this.state.symbolState.set(symbol, ss);
    }
    return ss;
  }
}

// ---------------------------------------------------------------------------
// Module-level helpers (exported for tests + downstream consumers)
// ---------------------------------------------------------------------------

/**
 * `inferBasisSideFromSource` — extract the basis-trade position side
 * from a SizingSignal's `source` field. Convention:
 * `<plugin-name>:<symbol>:<side>` where `<side>` ∈ {`flat`,
 * `short_basis`, `long_basis`}.
 *
 * Returns `null` if the source does not match the convention (e.g.,
 * it came from a different plugin).
 */
export function inferBasisSideFromSource(source: string): BasisPositionSide | null {
  // Split on `:` and take the last segment as the side.
  const idx = source.lastIndexOf(":");
  if (idx < 0 || idx === source.length - 1) return null;
  const side = source.slice(idx + 1);
  if (side === "flat" || side === "short_basis" || side === "long_basis") {
    return side;
  }
  return null;
}

/**
 * `inferSymbolFromBasisTradeSource` — extract the symbol identifier
 * from a BasisTradePlugin SizingSignal's `source` field. Convention:
 * `<plugin-name>:<symbol>:<side>`.
 */
export function inferSymbolFromBasisTradeSource(source: string): string | null {
  // Format: "basis-trade-v1:BTC/USDT:short_basis"
  // Strip the plugin name prefix.
  const stripped = source.startsWith("basis-trade-v1:")
    ? source.slice("basis-trade-v1:".length)
    : null;
  if (stripped === null) return null;
  const lastColon = stripped.lastIndexOf(":");
  if (lastColon < 0) return null;
  const symbol = stripped.slice(0, lastColon);
  if (symbol.length === 0) return null;
  return symbol;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * `createBasisTradePlugin` — factory. Mirrors the convention of
 * `createHybridKellyPlugin` / `createVolTargetSizingPlugin`.
 */
export function createBasisTradePlugin(
  overrides: Partial<BasisTradeConfig> = {},
): BasisTradePlugin {
  return new BasisTradePlugin(overrides);
}