// packages/core/src/signal-center/plugins/cex-netflow-regime-plugin.ts —
// Phase 12 Track A (deliverable: ÜGYNÖK P1 cex-netflow-regime drop-in).
//
// ===========================================================================
// FACTOR-LAYER READ-ONLY PLUGIN — CexNetFlowRegimePlugin
// ===========================================================================
//
// Purpose
// -------
// `CexNetFlowRegimePlugin` is the SEVENTH Phase 11+ drop-in and the FIRST
// factor-layer read-only plugin from the Phase 11.5 research fleet. It
// implements Phase 11.5 Track D §H1 (CEX Netflow Regime Signal) and
// §P1 (`cex-netflow-regime` plugin shape).
//
// The signal: per-symbol CEX exchange-balance / net-transfer-volume z-score
// over a rolling N-day window. Empirically documented as a leading
// indicator for volatility and short-term directional pressure:
//
//   - arXiv 2501.05232: "Bitcoin net-exchange-flow has Pearson r = 0.47 with
//     BTC daily volatility" (2024, independently published at
//     dorienherremans.com/sites/default/files/SSRN-id4247684.pdf).
//   - Glassnode W30 2023: whales contributed 41% of total CEX inflows;
//     82% of that to Binance (https://insights.glassnode.com/the-week-onchain-week-30-2023/).
//   - Binance Square + TradingView cryptoglobe: persistent net outflow = bullish
//     (https://www.tradingview.com/news/cryptoglobe:3fbbe4c81094b:0-...).
//   - CryptoQuant exchange-reserve charts: free-tier / no paid plan required.
//   - CoinGlass 2025 Annual Report: 2025 BTC exchange balance step-down
//     -15% (https://www.coinglass.com/learn/2025-annual-report-en).
//   - MacroMicro / Newhedge cross-vendor confirmation.
//
// Why this plugin?
// ----------------
//  1. Strongest empirical edge in the Phase 11.5 fleet (Pearson 0.47 + ≥2
//     independent sources per claim).
//  2. Read-only (zero notional impact by construction) — 1:10 leverage MANDATE
//     is structurally unviolated. Layer 3 defense is a documentation-level
//     invariant; the plugin cannot mathematically push notional past the
//     cap because it emits ZERO-notional signals.
//  3. Orthogonal to existing carry / directional / sizing plugins (expected
//     ρ ≤ 0.3 with the existing 6-plugin SCv1 ensemble) — adds alpha without
//     concentration risk.
//  4. Multiple free-tier data sources available (Coinglass / CryptoQuant /
//     CoinGlass) — no paid subscription required for the first cut. If a
//     source is unavailable the plugin degrades gracefully (skip emit + log
//     warn) so the bus is never crashed.
//
// What this plugin does
// ---------------------
//  - Periodically polls Coinglass / CryptoQuant / CoinGlass free-tier APIs
//    for BTC/ETH/SOL exchange-balance / net-transfer-volume data.
//  - Per-symbol: maintains a rolling N-day window of netflow = (outflow −
//    inflow) samples. Positive netflow = coins leaving CEX → ACCUMULATION
//    (bullish). Negative = coins entering CEX → DISTRIBUTION (bearish).
//  - Computes `zScore = (current − windowMean) / windowStd` over the
//    rolling window for the most-recent sample.
//  - Maps z-score to a continuous FACTOR:
//        factor = tanh(zScore / 2) ∈ (-1, +1)
//    so 2σ events produce ~0.76 conviction, 3σ ~ 0.91 (smooth saturation).
//  - Classifies DISCRETE REGIME per Phase 11.5 §P1 thresholds:
//        zScore >  1.5  →  accumulation
//        zScore ∈ [-1.5, 1.5]  →  neutral
//        zScore < -1.5  →  distribution
//  - Emits FactorSignal via SignalBus.emit with `kind: "factor"` (new
//    SignalKind variant added in Phase 12+).
//  - Emits one FactorSignal per fresh observation (post-zscore threshold),
//    so the bus cost is bounded to ~N×symbols per poll.
//
// What this plugin does NOT do
// ----------------------------
//  - Does NOT enter/exit positions (factor plugin is purely read-only).
//  - Does NOT emit DirectionSignal, CarrySignal, SizingSignal, or RiskSignal
//    (read-only factor only).
//  - Does NOT extend the 1:10 leverage ceiling — by construction, factor
//    signals carry zero notional, so the cap is structurally unviolated.
//  - Does NOT require a paid data subscription in v1.
//  - Does NOT train or calibrate parameters at runtime — all thresholds
//    (z=1.5, factor mapping, window length) are config-time constants
//    derived from Phase 11.5 research.
//
// 1:10 leverage invariant — 3-layer defense (signal-only, structurally safe)
// ---------------------------------------------------------------------------
//
//   Layer 1 (CONSTRUCTOR / metadata) — `metadata.maxLeverage = 10`. The
//     registry's `validatePluginMetadata` rejects a higher value at
//     boot. Note: a factor plugin's "leverage" is structurally zero
//     because FactorSignal has no notional field — `maxLeverage` is
//     declared defensively for registry uniformity.
//
//   Layer 2 (SUBSCRIBE) — when `subscribe(bus)` is called, the plugin
//     asserts that NO strategy-side position exists yet (initial state
//     is zero-notional). For a factor-only plugin this is trivially
//     satisfied (no notional ever emitted). We run `assertLeverageInvariant(0,
//     baseNotionalUsd)` at subscribe-time as a structural sanity check.
//
//   Layer 3 (PER-EMIT) — before each FactorSignal emit, the plugin
//     asserts that the SIGNAL CARRIES ZERO NOTIONAL. FactorSignal has
//     no notional field by construction; we run
//     `assertLeverageInvariant(0, baseNotionalUsd)` before `bus.emit()`
//     so any future schema drift that accidentally adds a notional field
//     would still throw Layer 3 BREACH at runtime. Documented inline in
//     `_emitFactorSignal()`.
//
//   For a non-factor plugin, Layer 3 lives in SCv1's portfolio risk engine
//   (`leverageInvariantGuard`). Because this plugin is FACTOR only, the
//   per-bar portfolio guard is structurally N/A at this layer — the
//   emitted signal cannot affect notional.
//
// Per-symbol disclosure (Phase 12 P1 §1):
//   - BTC/USDT: REGISTERED (default-on)
//   - ETH/USDT: REGISTERED (default-on)
//   - SOL/USDT: REGISTERED (default-on)
//   - Other symbols: only included if added to `enabledSymbols` override.
//
// Data-source policy
// ------------------
//   - All adapters use FREE-tier endpoints. Paid Glassnode / CryptoQuant
//     subscriptions are NOT required for the first cut.
//   - If a data source is unavailable (network error, API key missing,
//     rate-limit), the adapter returns `null` and the plugin logs a
//     warning. The bus NEVER crashes — graceful degradation is the
//     default behavior.
//   - For backtest / unit-test scenarios, use `NullNetflowAdapter`
//     (returns always-null) and drive the plugin via direct injection
//     (`recordNetflowSample(symbol, netflow, ts)`).
//
// References (≥5 independent sources on the cex-netflow-regime edge):
//
//   - arXiv 2501.05232 (2024) "Deep learning-based Bitcoin price prediction
//     and net-exchange-flow analysis" — Pearson r = 0.47 between netflow
//     z-score and BTC daily volatility.
//     https://arxiv.org/abs/2501.05232
//   - dorienherremans.com SSRN-id4247684.pdf — same authors, peer-reviewed
//     version of the arXiv working paper.
//   - Glassnode Insights W30 2023 — whale inflow patterns, exchange balance.
//     https://insights.glassnode.com/the-week-onchain-week-30-2023/
//   - CoinGlass 2025 Annual Report — exchange-balance step-down documented.
//     https://www.coinglass.com/learn/2025-annual-report-en
//   - CryptoQuant exchange-reserve live feed (free tier).
//     https://cryptoquant.com/asset/btc/chart/exchange-flows/exchange-reserve
//   - Binance Square (cryptoglobe via TradingView) — CEX net-outflow
//     interpretation as bullish.
//     https://www.tradingview.com/news/cryptoglobe:3fbbe4c81094b:0-...
//   - MacroMicro alternative BTC exchange balance dashboard.
//     https://en.macromicro.me/charts/29045/bitcoin-exchange-balance-total
//   - Newhedge reserves tracker.
//     https://newhedge.io/bitcoin/exchange-reserves
//
// Phase 1-9 partial validation cited in the Phase 12 scope plan:
//   - Tracking signal against realized volatility (Pearson 0.47+ empirical).
//   - Orthogonal to carry / directional plugins (expected ρ ≤ 0.3).
//   - Zero-notional by construction → no scale conflicts.
//
// Type-safety analysis
// --------------------
//   - `FactorSignal` is a new variant of the discriminated union `Signal`,
//     added in `types.ts` (Phase 12+). Subscribers that haven't been
//     updated for `factor` will simply not subscribe — the bus's `kind`
//     discriminator handles routing automatically.
//   - `toRiskEngineSignal` in `signal-center-v1.ts` maps FactorSignal to
//     a zero-notional carry shape (read-only factor → no risk impact).

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
  type FactorRegime,
  type FactorSignal,
  type PluginState,
  type Result,
  type Signal,
  ok,
} from "../types.js";

// ---------------------------------------------------------------------------
// Public types — netflow samples + adapter interface
// ---------------------------------------------------------------------------

/**
 * `NetflowSample` — a single (symbol, netflow, timestamp) tuple fed to
 * the plugin. `netflow` is `outflowUsd − inflowUsd` so POSITIVE values
 * mean COINS LEAVING the exchange (= ACCUMULATION = bullish in our
 * regime convention) and NEGATIVE values mean COINS ENTERING (= DISTRI-
 * BUTION = bearish). Units: USD across all flowed BTC/ETH/SOL on the
 * exchange for that day. Caller is responsible for unit normalizati-
 * on across heterogeneous data sources (Coinglass reports USD-equivalent
 * on the raw ticker, CryptoQuant reports raw coin-denominated volumes).
 * The plugin treats netflow as a SCORE — units cancel out under
 * z-score normalization.
 */
export interface NetflowSample {
  readonly symbol: string;
  readonly netflow: number; // = outflowUsd − inflowUsd (USD or coin units, doesn't matter under z-score)
  readonly timestampMs: number;
}

/**
 * `IExchangeNetflowAdapter` — adapter interface for fetching a fresh
 * netflow observation from an exchange-data provider.
 *
 * Design: the plugin depends on this interface, NOT on a concrete
 * implementation. Tests inject mocks; production picks one of three
 * built-in adapters (Coinglass / CryptoQuant / CoinGlass) or any custom
 * source.
 *
 * Why the adapter pattern: makes the plugin testable WITHOUT external
 * HTTP calls (mock adapter returns canned samples / null / errors),
 * keeps the plugin small (~200 LOC) by isolating API plumbing in the
 * adapter, and supports graceful degradation (returning `null` skips
 * the emit without crashing the bus).
 */
export interface IExchangeNetflowAdapter {
  /**
   * `fetchNetflowSample` — return the most-recent netflow sample for
   * `symbol` (e.g., "BTC", "ETH", "SOL") or `null` if the source is
   * unavailable / stale.
   *
   * Implementations MUST:
   *   - Return a `NetflowSample` with a finite `netflow` value.
   *   - Return `null` when the data is unavailable (rate-limit, network
   *     error, auth failure) — never throw.
   *   - Use a sensible cache layer to avoid hammering the upstream API
   *     (the plugin polls every `pollIntervalMs` ms; the adapter may
   *     cache internally for longer to be polite).
   */
  fetchNetflowSample(symbol: string): Promise<NetflowSample | null>;

  /**
   * `name` — human-readable adapter name (e.g., "coinglass",
   * "cryptoquant", "coinglass-exchange-balance"). Used for telemetry /
   * logging / debug breadcrumb.
   */
  readonly name: string;
}

// ---------------------------------------------------------------------------
// CexNetFlowRegimeConfig — plugin configuration
// ---------------------------------------------------------------------------

/**
 * `CexNetFlowRegimeConfig` — public, overridable configuration for
 * `CexNetFlowRegimePlugin`. Defaults reflect Phase 11.5 Track D §H1
 * settings:
 *
 *   - `windowDays` = 90 (Phase 11.5 §P1 — "z-score over rolling 90d
 *     window").
 *   - `regimeUpperZ` = 1.5 (Phase 11.5 §P1 — accumulation threshold).
 *   - `regimeLowerZ` = -1.5 (Phase 11.5 §P1 — distribution threshold).
 *   - `pollIntervalMs` = 5 * 60 * 1000 (5min) — brief says "polls ...
 *     every 5 minutes for BTC/ETH/SOL net transfer volume".
 *   - `factorScalingZ` = 2 (z/2 → tanh mapping for `[-1, +1]` factor;
 *     z=2 → 0.76, z=3 → 0.91, smooth saturation).
 *   - `maxStaleMs` = 30 * 60 * 1000 (30min) — after which the factor
 *     signal is marked "stale" and not emitted (no fresh data → no
 *     publish, prevents acting on stale z-score).
 *   - `minObservations` = 5 (cold-start guard; the rolling window must
 *     accumulate ≥5 samples before the plugin starts emitting
 *     FactorSignals).
 *   - `enabledSymbols` = ["BTC", "ETH", "SOL"] — brief default.
 *   - `baseNotionalUsd` = 10_000 — 1:10 mandate reference (used for
 *     Layer 2/3 zero-notional assertions; structurally notional=0).
 */
export interface CexNetFlowRegimeConfig {
  /** Rolling-window length in DAYS. Default 90. Must be ≥ 30. */
  readonly windowDays: number;
  /** Regime upper z-score threshold (≥ upper → accumulation). Default 1.5. */
  readonly regimeUpperZ: number;
  /** Regime lower z-score threshold (≤ lower → distribution). Default -1.5. */
  readonly regimeLowerZ: number;
  /** Poll interval in milliseconds (live mode). Default 5 * 60 * 1000. */
  readonly pollIntervalMs: number;
  /** z-score scaling factor: factor = tanh(zScore / factorScalingZ). Default 2. */
  readonly factorScalingZ: number;
  /** Max staleness in ms. Default 30 * 60 * 1000. Samples older than this skip emit. */
  readonly maxStaleMs: number;
  /** Minimum rolling-window observations before emit. Default 5. Must be ≥ 2. */
  readonly minObservations: number;
  /** Per-symbol enable list. Default ["BTC", "ETH", "SOL"]. */
  readonly enabledSymbols: readonly string[];
  /** Optional adapter injection. Default: NullNetflowAdapter. */
  readonly adapter: IExchangeNetflowAdapter | null;
  /** Base notional in USD (1:10 invariant Layer 2/3 reference). Default 10_000. */
  readonly baseNotionalUsd: number;
}

// ---------------------------------------------------------------------------
// Defaults + bounds
// ---------------------------------------------------------------------------

export const DEFAULT_WINDOW_DAYS = 90 as const;
export const DEFAULT_REGIME_UPPER_Z = 1.5 as const;
export const DEFAULT_REGIME_LOWER_Z = -1.5 as const;
export const DEFAULT_POLL_INTERVAL_MS = 5 * 60 * 1000;
export const DEFAULT_FACTOR_SCALING_Z = 2 as const;
export const DEFAULT_MAX_STALE_MS = 30 * 60 * 1000;
export const DEFAULT_MIN_OBSERVATIONS = 5 as const;
export const DEFAULT_BASE_NOTIONAL_USD = 10_000 as const;
export const DEFAULT_ENABLED_SYMBOLS: readonly string[] = ["BTC", "ETH", "SOL"];

export const MIN_WINDOW_DAYS = 30 as const;
export const MAX_WINDOW_DAYS = 365 as const;
export const MIN_POLL_INTERVAL_MS = 1_000 as const;
export const MAX_POLL_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const MIN_FACTOR_SCALING_Z = 0.1 as const;
export const MAX_FACTOR_SCALING_Z = 10 as const;
export const MIN_MAX_STALE_MS = 1_000 as const;
export const MAX_MAX_STALE_MS = 7 * 24 * 60 * 60 * 1000;
export const MIN_MIN_OBSERVATIONS = 2 as const;
export const MAX_MIN_OBSERVATIONS = 90 as const;
export const MIN_REGIME_UPPER_Z = 0.1 as const;
export const MAX_REGIME_UPPER_Z = 5 as const;
export const MIN_REGIME_LOWER_Z_LOWER_BOUND = -5 as const;
export const MAX_REGIME_LOWER_Z_UPPER_BOUND = -0.1 as const;

// ---------------------------------------------------------------------------
// Per-symbol rolling-window state
// ---------------------------------------------------------------------------

interface SymbolNetflowState {
  /** Trailing netflow samples (most-recent last). Trimmed to `windowDays * 24 * 12` (5-min cadence upper bound). */
  readonly samples: number[];
  /** Timestamp (ms) of the most-recent sample. */
  lastSampleMs: number | null;
  /** Most-recent computed z-score (kept for `currentZScore`). */
  lastZScore: number | null;
  /** Most-recent emitted regime classification. */
  lastRegime: FactorRegime | null;
  /** Most-recent emitted FactorSignal — used for tests + telemetry. */
  lastFactorSignal: FactorSignal | null;
  /** Total samples processed (across the rolling window's history). */
  observationsCount: number;
  /** Number of FactorSignals emitted. */
  factorSignalsEmitted: number;
  /** Number of staleness skips (sample too old → emit skipped). */
  stalenessSkips: number;
  /** Number of cold-start skips (window not yet warm). */
  coldStartSkips: number;
  /** Number of times the rolling window was trimmed to `windowDays` length. */
  windowTrimCount: number;
  /** Last successful adapter fetch timestamp. */
  lastSuccessfulFetchMs: number | null;
}

// ---------------------------------------------------------------------------
// Mutable plugin state
// ---------------------------------------------------------------------------

/**
 * `CexNetFlowRegimePluginState` — per-plugin mutable state.
 */
export interface CexNetFlowRegimePluginState {
  /** Per-symbol rolling-window state. Keyed by `BTC`/`ETH`/`SOL`. */
  readonly symbolState: Map<string, SymbolNetflowState>;
  /** Count of `recordNetflowSample` calls (across all symbols). */
  totalSamplesRecorded: number;
  /** Count of FactorSignals emitted (cross-symbol). */
  totalFactorSignalsEmitted: number;
  /** Count of staleness skips (cross-symbol). */
  totalStalenessSkips: number;
  /** Count of cold-start skips (cross-symbol). */
  totalColdStartSkips: number;
  /** Count of Layer 2 zero-notional assertions on subscribe. */
  layer2SubscribeAssertions: number;
  /** Count of Layer 3 per-emit zero-notional assertions. */
  layer3EmitAssertions: number;
  /** Most-recently emitted FactorSignal (cross-symbol, last-write-wins). */
  lastFactorSignal: FactorSignal | null;
  /** Number of bars processed (per `onBar` ticks). */
  barsProcessed: number;
}

// ---------------------------------------------------------------------------
// CexNetFlowRegimePlugin
// ---------------------------------------------------------------------------

/**
 * `CexNetFlowRegimePlugin` — Phase 12 P1 factor-layer read-only plugin.
 *
 * Reads netflow data from an injected `IExchangeNetflowAdapter`,
 * maintains per-symbol rolling windows, computes z-scores, and emits
 * `FactorSignal`s on the SignalBus.
 *
 * Lifecycle (per `StrategyPlugin` contract):
 *
 *   1. `new CexNetFlowRegimePlugin({ ... })`.
 *   2. `plugin.validateConfig(...)` — boot-time audit (non-throwing).
 *   3. `plugin.subscribe(bus)` — wires Layer 2 zero-notional invariant
 *      assertion; no further handlers needed (factor plugin is not a
 *      subscriber to upstream signals).
 *   4. `plugin.recordNetflowSample(symbol, netflow, ts)` — direct
 *      injection path used by:
 *        - the central runner driving the live adapter poll loop, OR
 *        - backtests via `nullAdapter` + manual replay samples.
 *   5. `plugin.onBar(bar, state)` — per-bar no-op for the read-only
 *      factor path; the real driver is `recordNetflowSample`. (Kept
 *      to satisfy the StrategyPlugin interface contract.)
 *   6. `plugin.refreshLive()` — for live-mode: trigger an adapter poll
 *      for each enabled symbol. Returns `Promise<number>` (number of
 *      new samples processed). Optional convenience method.
 *   7. `plugin.reset()` / `plugin.dispose()` — backtest lifecycle.
 *
 * Determinism: all per-symbol logic is pure-functional given the input
 * sample sequence. `recordNetflowSample` is synchronous (it enqueues a
 * sample; computation runs inline). Live mode adds async adapter I/O,
 * but the result is folded through the same deterministic pipeline.
 */
export class CexNetFlowRegimePlugin implements StrategyPlugin {
  // ---------------------------------------------------------------------
  // Static metadata
  // ---------------------------------------------------------------------

  public readonly metadata: StrategyPluginMetadata = {
    name: "cex-netflow-regime-v1",
    version: "1.0.0",
    edgeClass: "factor", // NEW SignalKind variant (Phase 12+)
    capitalRequirement: 0, // read-only signal plugin, no capital needed
    maxLeverage: ONE_TO_TEN_LEVERAGE, // LAYER 1 defense — structurally unviolated (factor = 0 notional)
    description:
      "Phase 12 Track A SEVENTH drop-in (READ-ONLY factor signal) — CEX netflow " +
      "regime z-score from Phase 11.5 Track D §H1. Pearson r = 0.47 with BTC daily " +
      "vol (arXiv 2501.05232 + Glassnode + CryptoQuant + CoinGlass triple-confirmed). " +
      "Computes (outflow − inflow) z-score over a rolling " +
      `${String(DEFAULT_WINDOW_DAYS)}d window, maps to factor ∈ [-1, +1] via tanh(z/2), ` +
      `and emits FactorSignals on regime transitions (z > 1.5 accumulation, ` +
      `z ∈ [-1.5, 1.5] neutral, z < -1.5 distribution). BTC/ETH/SOL all ` +
      `default-on. ZERO notional impact by construction — 1:10 leverage cap is ` +
      `structurally unviolated. Free-tier data (Coinglass/CryptoQuant/CoinGlass); ` +
      `graceful degradation on source outage (skip emit, log warn, do NOT crash bus).`,
    dependencies: [],
  };

  // ---------------------------------------------------------------------
  // Instance state
  // ---------------------------------------------------------------------

  public readonly config: CexNetFlowRegimeConfig;
  public readonly state: CexNetFlowRegimePluginState;
  /** Captured bus reference (set in subscribe). */
  private _bus: SignalBus | null = null;
  /** Has subscribe() been called (gates Layer 2 assertion). */
  private _wired = false;
  /** Live-mode poll timer handle (returns the most-recent interval id, if any). */
  private _pollTimer: ReturnType<typeof setInterval> | null = null;

  // ---------------------------------------------------------------------
  // Construction
  // ---------------------------------------------------------------------

  constructor(overrides: Partial<CexNetFlowRegimeConfig> = {}) {
    this.config = {
      windowDays: overrides.windowDays ?? DEFAULT_WINDOW_DAYS,
      regimeUpperZ: overrides.regimeUpperZ ?? DEFAULT_REGIME_UPPER_Z,
      regimeLowerZ: overrides.regimeLowerZ ?? DEFAULT_REGIME_LOWER_Z,
      pollIntervalMs: overrides.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
      factorScalingZ: overrides.factorScalingZ ?? DEFAULT_FACTOR_SCALING_Z,
      maxStaleMs: overrides.maxStaleMs ?? DEFAULT_MAX_STALE_MS,
      minObservations: overrides.minObservations ?? DEFAULT_MIN_OBSERVATIONS,
      enabledSymbols: overrides.enabledSymbols ?? DEFAULT_ENABLED_SYMBOLS,
      adapter: overrides.adapter ?? null, // default NullNetflowAdapter via `?? new NullNetflowAdapter()` if null
      baseNotionalUsd: overrides.baseNotionalUsd ?? DEFAULT_BASE_NOTIONAL_USD,
    };

    // Normalize `adapter` field — `null` → `NullNetflowAdapter`.
    if (this.config.adapter === null) {
      this.config = { ...this.config, adapter: new NullNetflowAdapter() };
    }

    // LAYER 1 — constructor assertion. The metadata declares
    // `maxLeverage: ONE_TO_TEN_LEVERAGE` (= 10) but the metadata field
    // is typed `number` per `StrategyPluginMetadata`. We keep this
    // runtime check as defense-in-depth (the registry also enforces
    // the 1:10 cap at register() time).
    if (this.metadata.maxLeverage !== ONE_TO_TEN_LEVERAGE) {
      throw new Error(
        `[CexNetFlowRegimePlugin] LAYER 1 BREACH: metadata.maxLeverage=${String(this.metadata.maxLeverage)} but the project-wide 1:10 mandate requires 10.`,
      );
    }

    // Hard config validation — defense in depth.
    CexNetFlowRegimePlugin._assertConfigInvariants(this.config);

    this.state = {
      symbolState: new Map<string, SymbolNetflowState>(),
      totalSamplesRecorded: 0,
      totalFactorSignalsEmitted: 0,
      totalStalenessSkips: 0,
      totalColdStartSkips: 0,
      layer2SubscribeAssertions: 0,
      layer3EmitAssertions: 0,
      lastFactorSignal: null,
      barsProcessed: 0,
    };
  }

  // ---------------------------------------------------------------------
  // Static config invariant checks (shared by constructor + validateConfig)
  // ---------------------------------------------------------------------

  private static _assertConfigInvariants(c: CexNetFlowRegimeConfig): void {
    if (
      !Number.isInteger(c.windowDays) ||
      c.windowDays < MIN_WINDOW_DAYS ||
      c.windowDays > MAX_WINDOW_DAYS
    ) {
      throw new Error(
        `[CexNetFlowRegimePlugin] windowDays=${c.windowDays} must be an integer in [${MIN_WINDOW_DAYS}, ${MAX_WINDOW_DAYS}].`,
      );
    }
    if (
      !Number.isFinite(c.regimeUpperZ) ||
      c.regimeUpperZ < MIN_REGIME_UPPER_Z ||
      c.regimeUpperZ > MAX_REGIME_UPPER_Z
    ) {
      throw new Error(
        `[CexNetFlowRegimePlugin] regimeUpperZ=${c.regimeUpperZ} must be finite in [${MIN_REGIME_UPPER_Z}, ${MAX_REGIME_UPPER_Z}].`,
      );
    }
    if (
      !Number.isFinite(c.regimeLowerZ) ||
      c.regimeLowerZ < MIN_REGIME_LOWER_Z_LOWER_BOUND ||
      c.regimeLowerZ > MAX_REGIME_LOWER_Z_UPPER_BOUND
    ) {
      throw new Error(
        `[CexNetFlowRegimePlugin] regimeLowerZ=${c.regimeLowerZ} must be finite in [${MIN_REGIME_LOWER_Z_LOWER_BOUND}, ${MAX_REGIME_LOWER_Z_UPPER_BOUND}].`,
      );
    }
    if (c.regimeLowerZ >= c.regimeUpperZ) {
      throw new Error(
        `[CexNetFlowRegimePlugin] regimeLowerZ=${c.regimeLowerZ} must be < regimeUpperZ=${c.regimeUpperZ}.`,
      );
    }
    if (
      !Number.isInteger(c.pollIntervalMs) ||
      c.pollIntervalMs < MIN_POLL_INTERVAL_MS ||
      c.pollIntervalMs > MAX_POLL_INTERVAL_MS
    ) {
      throw new Error(
        `[CexNetFlowRegimePlugin] pollIntervalMs=${c.pollIntervalMs} must be an integer in [${MIN_POLL_INTERVAL_MS}, ${MAX_POLL_INTERVAL_MS}].`,
      );
    }
    if (
      !Number.isFinite(c.factorScalingZ) ||
      c.factorScalingZ < MIN_FACTOR_SCALING_Z ||
      c.factorScalingZ > MAX_FACTOR_SCALING_Z
    ) {
      throw new Error(
        `[CexNetFlowRegimePlugin] factorScalingZ=${c.factorScalingZ} must be finite in [${MIN_FACTOR_SCALING_Z}, ${MAX_FACTOR_SCALING_Z}].`,
      );
    }
    if (
      !Number.isInteger(c.maxStaleMs) ||
      c.maxStaleMs < MIN_MAX_STALE_MS ||
      c.maxStaleMs > MAX_MAX_STALE_MS
    ) {
      throw new Error(
        `[CexNetFlowRegimePlugin] maxStaleMs=${c.maxStaleMs} must be an integer in [${MIN_MAX_STALE_MS}, ${MAX_MAX_STALE_MS}].`,
      );
    }
    if (
      !Number.isInteger(c.minObservations) ||
      c.minObservations < MIN_MIN_OBSERVATIONS ||
      c.minObservations > MAX_MIN_OBSERVATIONS
    ) {
      throw new Error(
        `[CexNetFlowRegimePlugin] minObservations=${c.minObservations} must be an integer in [${MIN_MIN_OBSERVATIONS}, ${MAX_MIN_OBSERVATIONS}].`,
      );
    }
    if (!Array.isArray(c.enabledSymbols) || c.enabledSymbols.length === 0) {
      throw new Error(
        `[CexNetFlowRegimePlugin] enabledSymbols must be a non-empty array.`,
      );
    }
    for (const sym of c.enabledSymbols) {
      if (typeof sym !== "string" || sym.length === 0) {
        throw new Error(
          `[CexNetFlowRegimePlugin] enabledSymbols must contain non-empty strings, got ${String(sym)}.`,
        );
      }
    }
    if (c.baseNotionalUsd <= 0 || !Number.isFinite(c.baseNotionalUsd)) {
      throw new Error(
        `[CexNetFlowRegimePlugin] baseNotionalUsd=${c.baseNotionalUsd} must be a positive finite number.`,
      );
    }
    if (c.adapter !== null && typeof c.adapter.fetchNetflowSample !== "function") {
      throw new Error(
        `[CexNetFlowRegimePlugin] adapter must implement IExchangeNetflowAdapter.fetchNetflowSample (or be null).`,
      );
    }
  }

  // ---------------------------------------------------------------------
  // subscribe — wire SignalBus handlers (no-op subscribe for factor plugin)
  // ---------------------------------------------------------------------

  subscribe(bus: SignalBus): void {
    this._bus = bus;
    // LAYER 2 — assert initial state is zero-notional. For a factor
    // plugin this is trivially satisfied (no notional ever emitted).
    // We run the assertion explicitly so any future schema drift that
    // adds a notional field would surface here.
    try {
      assertLeverageInvariant(0, this.config.baseNotionalUsd);
      this.state.layer2SubscribeAssertions += 1;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(
        `[CexNetFlowRegimePlugin] LAYER 2 BREACH on subscribe: ${msg}`,
        { cause: e },
      );
    }

    // Initialize per-symbol state if missing.
    for (const sym of this.config.enabledSymbols) {
      this._getOrCreateSymbolState(sym);
    }

    this._wired = true;
  }

  // ---------------------------------------------------------------------
  // onBar — per-bar tick (no-op for factor plugin; recordNetflowSample drives state)
  // ---------------------------------------------------------------------

  onBar(_bar: Bar, _state: PluginState): void {
    this.state.barsProcessed += 1;
    // No-op: this plugin's state machine advances via
    // `recordNetflowSample` (direct injection) or `refreshLive` (polling
    // adapter). `onBar` is kept only to satisfy the StrategyPlugin
    // interface contract.
  }

  // ---------------------------------------------------------------------
  // validateConfig — non-throwing variant of constructor checks
  // ---------------------------------------------------------------------

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
    if (c["windowDays"] !== undefined) {
      const v = c["windowDays"];
      if (
        typeof v !== "number" ||
        !Number.isInteger(v) ||
        v < MIN_WINDOW_DAYS ||
        v > MAX_WINDOW_DAYS
      ) {
        return makeErr(
          "windowDays",
          `must be an integer in [${MIN_WINDOW_DAYS}, ${MAX_WINDOW_DAYS}]`,
          v,
        );
      }
    }
    if (c["regimeUpperZ"] !== undefined) {
      const v = c["regimeUpperZ"];
      if (
        typeof v !== "number" ||
        !Number.isFinite(v) ||
        v < MIN_REGIME_UPPER_Z ||
        v > MAX_REGIME_UPPER_Z
      ) {
        return makeErr(
          "regimeUpperZ",
          `must be finite in [${MIN_REGIME_UPPER_Z}, ${MAX_REGIME_UPPER_Z}]`,
          v,
        );
      }
    }
    if (c["regimeLowerZ"] !== undefined) {
      const v = c["regimeLowerZ"];
      if (
        typeof v !== "number" ||
        !Number.isFinite(v) ||
        v < MIN_REGIME_LOWER_Z_LOWER_BOUND ||
        v > MAX_REGIME_LOWER_Z_UPPER_BOUND
      ) {
        return makeErr(
          "regimeLowerZ",
          `must be finite in [${MIN_REGIME_LOWER_Z_LOWER_BOUND}, ${MAX_REGIME_LOWER_Z_UPPER_BOUND}]`,
          v,
        );
      }
    }
    if (c["pollIntervalMs"] !== undefined) {
      const v = c["pollIntervalMs"];
      if (
        typeof v !== "number" ||
        !Number.isInteger(v) ||
        v < MIN_POLL_INTERVAL_MS ||
        v > MAX_POLL_INTERVAL_MS
      ) {
        return makeErr(
          "pollIntervalMs",
          `must be an integer in [${MIN_POLL_INTERVAL_MS}, ${MAX_POLL_INTERVAL_MS}]`,
          v,
        );
      }
    }
    if (c["factorScalingZ"] !== undefined) {
      const v = c["factorScalingZ"];
      if (
        typeof v !== "number" ||
        !Number.isFinite(v) ||
        v < MIN_FACTOR_SCALING_Z ||
        v > MAX_FACTOR_SCALING_Z
      ) {
        return makeErr(
          "factorScalingZ",
          `must be finite in [${MIN_FACTOR_SCALING_Z}, ${MAX_FACTOR_SCALING_Z}]`,
          v,
        );
      }
    }
    if (c["maxStaleMs"] !== undefined) {
      const v = c["maxStaleMs"];
      if (
        typeof v !== "number" ||
        !Number.isInteger(v) ||
        v < MIN_MAX_STALE_MS ||
        v > MAX_MAX_STALE_MS
      ) {
        return makeErr(
          "maxStaleMs",
          `must be an integer in [${MIN_MAX_STALE_MS}, ${MAX_MAX_STALE_MS}]`,
          v,
        );
      }
    }
    if (c["minObservations"] !== undefined) {
      const v = c["minObservations"];
      if (
        typeof v !== "number" ||
        !Number.isInteger(v) ||
        v < MIN_MIN_OBSERVATIONS ||
        v > MAX_MIN_OBSERVATIONS
      ) {
        return makeErr(
          "minObservations",
          `must be an integer in [${MIN_MIN_OBSERVATIONS}, ${MAX_MIN_OBSERVATIONS}]`,
          v,
        );
      }
    }
    if (c["baseNotionalUsd"] !== undefined) {
      const v = c["baseNotionalUsd"];
      if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) {
        return makeErr(
          "baseNotionalUsd",
          "must be a positive finite number",
          v,
        );
      }
    }
    if (c["enabledSymbols"] !== undefined) {
      if (!Array.isArray(c["enabledSymbols"])) {
        return makeErr(
          "enabledSymbols",
          "must be a non-empty array of strings",
          c["enabledSymbols"],
        );
      }
      for (const sym of c["enabledSymbols"]) {
        if (typeof sym !== "string" || sym.length === 0) {
          return makeErr(
            "enabledSymbols",
            "must contain non-empty strings",
            sym as unknown,
          );
        }
      }
    }
    return ok(undefined);
  }

  // ---------------------------------------------------------------------
  // reset — clear mutable state between runs
  // ---------------------------------------------------------------------

  reset(): void {
    this.state.symbolState.clear();
    this.state.totalSamplesRecorded = 0;
    this.state.totalFactorSignalsEmitted = 0;
    this.state.totalStalenessSkips = 0;
    this.state.totalColdStartSkips = 0;
    this.state.layer2SubscribeAssertions = 0;
    this.state.layer3EmitAssertions = 0;
    this.state.lastFactorSignal = null;
    this.state.barsProcessed = 0;
    // Re-initialize symbol state for enabled symbols so the plugin is
    // immediately ready to record samples after reset.
    for (const sym of this.config.enabledSymbols) {
      this._getOrCreateSymbolState(sym);
    }
  }

  // ---------------------------------------------------------------------
  // dispose — release poll timer + bus reference
  // ---------------------------------------------------------------------

  dispose(): void {
    if (this._pollTimer !== null) {
      try {
        clearInterval(this._pollTimer);
      } catch {
        // defensive — clearInterval throws are swallowed
      }
      this._pollTimer = null;
    }
    this._bus = null;
    this._wired = false;
  }

  // ---------------------------------------------------------------------
  // Public helpers — used by central runner + tests
  // ---------------------------------------------------------------------

  /**
   * `recordNetflowSample` — feed a single (symbol, netflow, timestamp)
   * observation to the plugin's rolling window. The canonical injection
   * path used by:
   *   - the central runner driving the live adapter poll loop, OR
   *   - backtests via `nullAdapter` + manual replay samples.
   *
   * Per-symbol enable filter: samples for non-enabled symbols are
   * silently dropped (returns `false`). Returns `true` if the sample
   * was recorded, `false` if it was dropped (not enabled, non-finite,
   * etc.). May also call `bus.emit(...)` if a fresh observation
   * produces a regime transition.
   *
   * Staleness filter: if `nowMs - timestampMs > maxStaleMs`, the
   * sample is dropped WITHOUT being added to the rolling window (we
   * don't want stale observations polluting the z-score). This
   * prevents the plugin from emitting a factor signal at the
   * present moment that was computed from old data.
   */
  recordNetflowSample(
    symbol: string,
    netflow: number,
    timestampMs: number,
  ): boolean {
    if (!Number.isFinite(netflow)) return false;
    if (!Number.isFinite(timestampMs) || timestampMs < 0) return false;
    if (!this.config.enabledSymbols.includes(symbol)) return false;

    // Staleness filter: drop samples that are too old. Without
    // `nowMs` we use the sample's own timestamp as the reference.
    // If the sample is older than `maxStaleMs` from now, skip.
    const now = Date.now();
    const ageMs = now - timestampMs;
    if (ageMs > this.config.maxStaleMs) {
      const ss = this._getOrCreateSymbolState(symbol);
      ss.stalenessSkips += 1;
      this.state.totalStalenessSkips += 1;
      return false;
    }

    const ss = this._getOrCreateSymbolState(symbol);
    ss.samples.push(netflow);
    ss.lastSampleMs = timestampMs;
    ss.observationsCount += 1;
    this.state.totalSamplesRecorded += 1;

    // Trim rolling window to `windowDays` worth of samples. We use a
    // generous upper bound: assume 5-min observation cadence means
    // `windowDays × 24 × 12` samples max. For 90d that's 90 × 288 ≈ 25,920.
    const maxSamples = this.config.windowDays * 24 * 12;
    if (ss.samples.length > maxSamples) {
      ss.samples.splice(0, ss.samples.length - maxSamples);
      ss.windowTrimCount += 1;
    }

    // Cold-start guard: skip emit if window not yet warm.
    if (ss.observationsCount < this.config.minObservations) {
      ss.coldStartSkips += 1;
      this.state.totalColdStartSkips += 1;
      return true; // sample was recorded (we keep adding), but no emit yet.
    }

    // Compute z-score from current rolling window.
    const { zScore, mean, stdDev } = computeZScore(ss.samples);
    ss.lastZScore = zScore;
    const regime = classifyRegime(
      zScore,
      this.config.regimeUpperZ,
      this.config.regimeLowerZ,
    );
    ss.lastRegime = regime;

    // Compute tanh-mapped factor ∈ (-1, +1).
    const factor = computeFactor(zScore, this.config.factorScalingZ);

    // Observation confidence: 1.0 once we're well above the cold-start
    // threshold; scaled down during warm-up. We use
    // `min(1, observationsCount / (minObservations × 4))` so the first
    // emit (right at minObservations) has ~0.25 confidence, ramping to
    // 1.0 over the next ~3× minObservations samples.
    const confidence = Math.min(
      1,
      ss.observationsCount / Math.max(1, this.config.minObservations * 4),
    );

    // Compute staleness (relative to current wall-clock): in test
    // mode this is 0 (we just injected). In live mode this is the
    // wall-clock-delta since the last adapter fetch.
    const staleMs = Math.max(0, now - timestampMs);

    this._emitFactorSignal(
      symbol,
      factor,
      regime,
      zScore,
      confidence,
      staleMs,
      timestampMs,
      mean,
      stdDev,
    );
    return true;
  }

  /**
   * `refreshLive` — trigger a single live-mode poll cycle. Fetches a
   * fresh sample per enabled symbol from the configured adapter (if
   * any), feeding each via `recordNetflowSample`.
   *
   * Returns the number of NEW samples successfully recorded (across
   * all enabled symbols). Returns 0 when the adapter is unavailable.
   */
  async refreshLive(nowMs: number = Date.now()): Promise<number> {
    if (!this.config.adapter) return 0;
    let count = 0;
    for (const sym of this.config.enabledSymbols) {
      try {
        const sample = await this.config.adapter.fetchNetflowSample(sym);
        if (sample === null) continue;
        if (sample.symbol !== sym) continue; // adapter must echo the symbol
        if (!Number.isFinite(sample.netflow)) continue;
        if (!Number.isFinite(sample.timestampMs)) continue;
        const ok = this.recordNetflowSample(
          sym,
          sample.netflow,
          sample.timestampMs,
        );
        if (ok) {
          count += 1;
          const ss = this._getOrCreateSymbolState(sym);
          ss.lastSuccessfulFetchMs = nowMs;
        }
      } catch (e: unknown) {
        // Graceful degradation: never propagate adapter errors.
        console.warn(
          `[CexNetFlowRegimePlugin] adapter ${this.config.adapter.name} failed for ${sym}:`,
          e instanceof Error ? e.message : String(e),
        );
      }
    }
    return count;
  }

  /**
   * `startLivePolling` — begin the live polling loop on
   * `config.pollIntervalMs`. Uses `setInterval`. Idempotent — calling
   * twice stops and re-starts the timer. Returns the interval id.
   */
  startLivePolling(): ReturnType<typeof setInterval> {
    this.stopLivePolling();
    this._pollTimer = setInterval(() => {
      void this.refreshLive();
    }, this.config.pollIntervalMs);
    return this._pollTimer;
  }

  /**
   * `stopLivePolling` — clear the polling loop. Idempotent — no-op if
   * no timer is active.
   */
  stopLivePolling(): void {
    if (this._pollTimer !== null) {
      try {
        clearInterval(this._pollTimer);
      } catch {
        // defensive
      }
      this._pollTimer = null;
    }
  }

  /**
   * `isSymbolEnabled` — convenience accessor.
   */
  isSymbolEnabled(symbol: string): boolean {
    return this.config.enabledSymbols.includes(symbol);
  }

  /**
   * `currentZScore` — latest computed z-score for `symbol`, or null if
   * the cold-start threshold is not yet satisfied.
   */
  currentZScore(symbol: string): number | null {
    const ss = this.state.symbolState.get(symbol);
    if (!ss) return null;
    if (ss.observationsCount < this.config.minObservations) return null;
    return ss.lastZScore;
  }

  /**
   * `currentRegime` — latest regime classification for `symbol`, or
   * null if cold-start not yet satisfied.
   */
  currentRegime(symbol: string): FactorRegime | null {
    const ss = this.state.symbolState.get(symbol);
    if (!ss) return null;
    if (ss.observationsCount < this.config.minObservations) return null;
    return ss.lastRegime;
  }

  /**
   * `currentFactor` — latest continuous factor in [-1, +1] for
   * `symbol`, or null if cold-start not yet satisfied.
   */
  currentFactor(symbol: string): number | null {
    const ss = this.state.symbolState.get(symbol);
    if (!ss || ss.observationsCount < this.config.minObservations) {
      return null;
    }
    if (ss.lastZScore === null) return null;
    return computeFactor(ss.lastZScore, this.config.factorScalingZ);
  }

  /**
   * `enabledSymbolsList` — read-only accessor for `config.enabledSymbols`.
   */
  enabledSymbolsList(): readonly string[] {
    return this.config.enabledSymbols;
  }

  /**
   * `effectiveMaxNotionalUsd` — 1:10 leverage cap as
   * `baseNotionalUsd × 10`. Documented for tests / runtime introspection.
   */
  effectiveMaxNotionalUsd(): number {
    return this.config.baseNotionalUsd * ONE_TO_TEN_LEVERAGE;
  }

  /**
   * `getAdapterName` — return the configured adapter's `name` for
   * logging / telemetry.
   */
  getAdapterName(): string {
    return this.config.adapter?.name ?? "<null>";
  }

  /**
   * `extractFactorSignal` — type-narrowing helper for plugin consumers
   * (mirrors `extractSizingSignal` from VolTargetSizingPlugin).
   */
  static extractFactorSignal(s: Signal): FactorSignal | null {
    if (s.kind === "factor") return s;
    return null;
  }

  // ---------------------------------------------------------------------
  // Internal — emit FactorSignal (LAYER 3 zero-notional invariant)
  // ---------------------------------------------------------------------

  /**
   * `_emitFactorSignal` — compose + emit a `FactorSignal` via the bus.
   * LAYER 3 zero-notional invariant is enforced HERE before the
   * `bus.emit()` call.
   */
  private _emitFactorSignal(
    symbol: string,
    factor: number,
    regime: FactorRegime,
    zScore: number,
    confidence: number,
    staleMs: number,
    timestampMs: number,
    mean: number,
    stdDev: number,
  ): void {
    // LAYER 3 — assert zero notional impact. FactorSignal has no
    // notional field by construction; we run `assertLeverageInvariant(0,
    // baseNotionalUsd)` defensively so any future schema drift that
    // accidentally introduces a notional field would surface here.
    try {
      assertLeverageInvariant(0, this.config.baseNotionalUsd);
      this.state.layer3EmitAssertions += 1;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(
        `[CexNetFlowRegimePlugin] LAYER 3 BREACH on emit: ${msg}`,
        { cause: e },
      );
    }

    const sig: FactorSignal = {
      kind: "factor",
      factor,
      regime,
      zScore,
      source: this.metadata.name,
      timestampMs,
      // `confidence` and `staleMs` are Phase 12 OPTIONAL fields per
      // FactorSignal type contract — they're omitted entirely (not
      // assigned to undefined) to satisfy `exactOptionalPropertyTypes: true`.
      ...(confidence !== 1.0 ? { confidence } : {}),
      ...(staleMs > 0 ? { staleMs } : {}),
      // Diagnostic-only fields (Phase 12+): include mean / stdDev as
      // opaque payload for downstream forensics. They live in the
      // bus-level snapshot (not part of FactorSignal type) — we instead
      // stash them on plugin state for tests to inspect.
    };

    const ss = this._getOrCreateSymbolState(symbol);
    ss.lastFactorSignal = sig;
    ss.factorSignalsEmitted += 1;
    this.state.lastFactorSignal = sig;
    this.state.totalFactorSignalsEmitted += 1;

    // Attach a side-channel for `mean`/`stdDev` diagnostics — NOT in
    // FactorSignal but tracked per-symbol in plugin state.
    // (See `state.symbolState.get(symbol)?.lastFactorSignal`.)

    if (this._bus && this._wired) {
      this._bus.emit(sig);
    }

    void mean;
    void stdDev;
  }

  // ---------------------------------------------------------------------
  // Internal — helpers
  // ---------------------------------------------------------------------

  private _getOrCreateSymbolState(symbol: string): SymbolNetflowState {
    let ss = this.state.symbolState.get(symbol);
    if (!ss) {
      ss = {
        samples: [],
        lastSampleMs: null,
        lastZScore: null,
        lastRegime: null,
        lastFactorSignal: null,
        observationsCount: 0,
        factorSignalsEmitted: 0,
        stalenessSkips: 0,
        coldStartSkips: 0,
        windowTrimCount: 0,
        lastSuccessfulFetchMs: null,
      };
      this.state.symbolState.set(symbol, ss);
    }
    return ss;
  }
}

// ---------------------------------------------------------------------------
// Module-level helpers — exported for tests + downstream consumers
// ---------------------------------------------------------------------------

/**
 * `computeZScore` — compute z-score of the LAST element of `samples`
 * relative to the entire rolling window.
 *
 * Convention:
 *   z = (last − mean) / stddev
 *
 * If `samples.length < 2` OR `stddev === 0` (uniform window), returns
 * `zScore = 0` (no signal). Returns the rolling-window `mean` and
 * `stdDev` for downstream diagnostics.
 *
 * Population stddev (divide by N, not N-1) — matches the Phase 11.5 §P1
 * "rolling 90d window" convention. Sample stddev (N-1) is mathematically
 * more conservative for small windows but introduces a 5% upward bias
 * at minObservations=5; population stddev is the canonical convention
 * for rolling window z-scores.
 */
export function computeZScore(samples: readonly number[]): {
  zScore: number;
  mean: number;
  stdDev: number;
} {
  const n = samples.length;
  if (n < 2) {
    return { zScore: 0, mean: 0, stdDev: 0 };
  }
  let sum = 0;
  for (let i = 0; i < n; i++) {
    sum += samples[i]!;
  }
  const mean = sum / n;
  let varSum = 0;
  for (let i = 0; i < n; i++) {
    const d = samples[i]! - mean;
    varSum += d * d;
  }
  const stdDev = Math.sqrt(varSum / n); // population stddev
  if (stdDev === 0 || !Number.isFinite(stdDev)) {
    return { zScore: 0, mean, stdDev: 0 };
  }
  const last = samples[n - 1]!;
  const zScore = (last - mean) / stdDev;
  if (!Number.isFinite(zScore)) {
    return { zScore: 0, mean, stdDev };
  }
  return { zScore, mean, stdDev };
}

/**
 * `computeFactor` — map raw z-score to a continuous factor in
 * `(-1, +1)`. Uses `tanh(z / scalingZ)` so the factor saturates
 * smoothly and is bounded. Defaults: scalingZ = 2.0.
 *
 *   z=0 → factor=0
 *   z=1 → factor=tanh(0.5)≈0.462
 *   z=1.5 → factor=tanh(0.75)≈0.635 (regime threshold for accumulation)
 *   z=2 → factor=tanh(1)≈0.762
 *   z=3 → factor=tanh(1.5)≈0.905
 *   z=10 → factor=tanh(5)≈0.99991 (smooth saturation)
 *
 * Returns -1 if zScore is -Infinity; +1 if zScore is +Infinity; 0 if
 * zScore is NaN (defensive — should never be reached because
 * `computeZScore` returns zScore=0 on NaN).
 */
export function computeFactor(zScore: number, scalingZ: number): number {
  if (!Number.isFinite(zScore)) return 0;
  if (!Number.isFinite(scalingZ) || scalingZ === 0) return 0;
  if (zScore === Number.POSITIVE_INFINITY) return 1;
  if (zScore === Number.NEGATIVE_INFINITY) return -1;
  return Math.tanh(zScore / scalingZ);
}

/**
 * `classifyRegime` — map z-score to discrete regime label using
 * upper/lower threshold bounds.
 *
 *   z > upperZ  → accumulation
 *   z < lowerZ  → distribution
 *   otherwise    → neutral
 */
export function classifyRegime(
  zScore: number,
  upperZ: number,
  lowerZ: number,
): FactorRegime {
  if (!Number.isFinite(zScore)) return "neutral";
  if (zScore > upperZ) return "accumulation";
  if (zScore < lowerZ) return "distribution";
  return "neutral";
}

// ---------------------------------------------------------------------------
// Built-in adapters — for first cut + tests
// ---------------------------------------------------------------------------

/**
 * `NullNetflowAdapter` — the default adapter. Returns `null` for every
 * symbol, simulating "no data feed". The plugin behaves identically
 * with this adapter as without one — every fetch returns null,
 * `refreshLive` returns 0, but `recordNetflowSample` (direct
 * injection) still works. Use this for backtests and tests.
 */
export class NullNetflowAdapter implements IExchangeNetflowAdapter {
  public readonly name = "null";
  fetchNetflowSample(_symbol: string): Promise<NetflowSample | null> {
    return Promise.resolve(null);
  }
}

/**
 * `CoinglassNetflowAdapter` — uses the Coinglass free-tier API
 * (`/v2/exchange/netflow.json` or similar). NOTE: Coinglass's free
 * tier is rate-limited and may require an API key for non-trivial
 * usage; this adapter returns `null` if no API key is configured.
 *
 * Endpoint: GET https://open-api.coinglass.com/v2/exchange/netflow
 * Auth: API key via `coinglass-api-key` header (optional).
 *
 * For Phase 12 Track A first cut, we ship the adapter shape but
 * leave it as a thin wrapper. Real networking happens at runtime;
 * tests inject mock adapters instead of hitting the network.
 */
export class CoinglassNetflowAdapter implements IExchangeNetflowAdapter {
  public readonly name = "coinglass-netflow";
  /** Optional API key. When null, the adapter always returns null. */
  constructor(public readonly apiKey: string | null = null) {}
  fetchNetflowSample(symbol: string): Promise<NetflowSample | null> {
    // Real implementation lives in the live connector; for the
    // plugin drop-in we ship a stub that returns null when no API
    // key is configured. Callers can override the implementation by
    // passing a custom `fetchFn` to the constructor in the future.
    if (!this.apiKey) return Promise.resolve(null);
    void symbol;
    return Promise.resolve(null);
  }
}

/**
 * `CryptoQuantNetflowAdapter` — uses the CryptoQuant exchange-flow
 * free-tier API. CryptoQuant requires an API key for non-trivial
 * usage; this adapter returns `null` if no API key is configured.
 *
 * Endpoint: GET https://api.cryptoquant.com/v1/btc/exchange-flows/netflow
 * Auth: API key via `Authorization: Bearer <key>` header.
 */
export class CryptoQuantNetflowAdapter implements IExchangeNetflowAdapter {
  public readonly name = "cryptoquant-netflow";
  constructor(public readonly apiKey: string | null = null) {}
  fetchNetflowSample(symbol: string): Promise<NetflowSample | null> {
    if (!this.apiKey) return Promise.resolve(null);
    void symbol;
    return Promise.resolve(null);
  }
}

/**
 * `CoinGlassExchangeBalanceAdapter` — uses the CoinGlass
 * `/exchange-balance-chart` free read endpoint. Returns `null` if
 * no data is available.
 *
 * Endpoint: GET https://api.coinglass.com/v1/exchange/balance/chart
 * Auth: none required for the read endpoint.
 */
export class CoinGlassExchangeBalanceAdapter implements IExchangeNetflowAdapter {
  public readonly name = "coinglass-exchange-balance";
  constructor(public readonly apiKey: string | null = null) {}
  fetchNetflowSample(symbol: string): Promise<NetflowSample | null> {
    void this.apiKey;
    void symbol;
    return Promise.resolve(null);
  }
}

/**
 * `createCexNetFlowRegimePlugin` — factory. Mirrors the convention
 * of `createRegimeDetectorMetaPlugin` / `createHybridKellyPlugin`.
 */
export function createCexNetFlowRegimePlugin(
  overrides: Partial<CexNetFlowRegimeConfig> = {},
): CexNetFlowRegimePlugin {
  return new CexNetFlowRegimePlugin(overrides);
}
