// packages/core/src/signal-center/monolith-wrappers/cross-venue-funding-divergence-plugin.ts
// — Phase 25 #2 T4 / Track C
//
// ===========================================================================
// READ-ONLY SIGNAL-POOL PLUGIN — CrossVenueFundingDivergencePlugin
// ===========================================================================
//
// Purpose
// -------
// Aggregates per-venue × per-symbol funding-rate data from SIX venues
// (Hyperliquid + dYdX + Binance + Bybit + OKX + Bitget), buckets each
// (venue, symbol) tuple into 1-minute windows, and emits a typed
// `FundingSnapshotSignal` per symbol per closed bucket with the
// divergence metric `divergenceBps` = max - min across all venues that
// reported within the bucket.
//
// This is the FOUNDATION layer for Phase 25 #2 Track C regime indicators
// — the divergence metric feeds downstream regime classifiers that
// distinguish "convergent funding" (all venues near-parity → low
// divergence → carry-strategy-friendly regime) from "fragmented funding"
// (large cross-venue gap → high divergence → stress / cascade-risk
// regime). See Phase 25 #2 brief for the consuming Track A / B
// components.
//
// Why 6 venues?
// -------------
// - HL + dYdX — perpetual DEX cohort (hourly settlement; documented
//   funding divergence from CEX carry).
// - Binance + Bybit + OKX + Bitget — CEX USDT-M cohort (8h native
//   settlement; the dominant spot-margin pricing venues).
// Together the 6-venue set captures the full HYBRID funding landscape:
// DEX premium vs CEX spot-margin basis. The legacy
// `CrossDexFundingWatcherPlugin` covers only 4 of these (HL + BZ + BY
// + OKX); this plugin EXTENDS the coverage to dYdX + Bitget and adds
// the explicit 1-minute bucketed divergence metric.
//
// 1:10 leverage invariant (3-layer defense — TRIVIALLY met)
// ----------------------------------------------------------
// This is a READ-ONLY signal-pool plugin — no notional is ever computed
// or emitted. The 3-layer defense pattern is:
//
//   Layer 1 (constructor): `metadata.maxLeverage = 10` (= ONE_TO_TEN_LEVERAGE).
//     The registry's `validatePluginMetadata` rejects any plugin
//     declaring leverage > 10.
//
//   Layer 2 (subscribe): no in-flight notional state — the plugin does
//     not subscribe to other signal kinds (this is a SOURCE plugin, not
//     a meta/derivative plugin). The 1:10 cap is trivially met.
//
//   Layer 3 (per-emit): each emitted snapshot has zero notional
//     (`divergenceBps` is information, not a position instruction).
//     The plugin still calls `assertLeverageInvariant(0, baseNotional)`
//     on every emit as a defensive symmetry hook (mirroring the
//     `CrossDexFundingWatcherPlugin` convention).
//
// Bucket aggregation semantics
// -----------------------------
//   - 1-minute buckets aligned to wall-clock minutes (e.g.,
//     12:00:00.000 → 12:00:59.999).
//   - Within a bucket, the plugin retains the LATEST rate reported by
//     each venue for each symbol (last-write-wins per venue per
//     bucket). No averaging — divergence is computed on the most
//     recent snapshot per venue.
//   - When the bucket boundary crosses (or `pollAndEmit()` is called
//     with a timestamp > bucketStartMs + 60_000), the bucket CLOSES:
//     the plugin computes divergence across all venues that reported
//     during the bucket window and emits a snapshot.
//   - If < 2 venues reported during the bucket, the bucket is
//     dropped (no emit — same convention as
//     `CrossDexFundingWatcherPlugin`).
//
// Read-only guarantee
// -------------------
// The plugin NEVER:
//   - Places an order.
//   - Computes a position size.
//   - Reads a `SizingSignal` to derive sizing.
//   - Persists state outside its own in-memory `Map` (no DB writes).
// The plugin's sole output is the typed `FundingSnapshotSignal` on the
// SignalBus, carrying zero notional impact.
//
// References (≥5 independent sources on multi-venue funding wiring):
//   - Hyperliquid — Funding Docs (hyperliquid.gitbook.io/.../funding):
//     hourly settlement cadence (1/8 of computed 8h rate); 4%/hr cap;
//     `F = avg premium + clamp(interest - premium, -0.0005, +0.0005)`.
//   - dYdX v4 — Perpetuals Funding Rate docs (dydx.exchange/v4-docs):
//     hourly settlement; per-market funding rate; `funding_rate =
//     (mark - index) / 8` per hour. (Free public API.)
//   - Binance — fapi/v1/fundingRate (public, free, no auth). 8h native.
//   - Bybit — v5/market/funding/history + WS `tickers` (public, free).
//     8h native.
//   - OKX — api/v5/public/funding-rate + WS `funding-rate` (public,
//     free). 8h native.
//   - Bitget — v2/mix/market/tickers (public, free). 8h native.
//   - BitMEX Q3 2025 Derivatives Report — "Anchors and Ceilings" —
//     empirical Hyperliquid 2-3× CEX funding multiple across
//     BTC/ETH/SOL.
//   - CoinGlass — Funding Rate Tracker + Arbitrage API — cross-venue
//     ranking; documented 6-venue funding spread dashboards.
//   - Button — Hyperliquid Funding Rates Guide — BTC annualized 4-8%
//     on HL vs 2-4% on Binance; alts 10-30% vs 5-15%.

import {
  ONE_TO_TEN_LEVERAGE,
  assertLeverageInvariant,
} from "../../risk/leverage-invariant.js";

// Re-export the leverage constant for downstream consumers (mirrors the
// pattern used by RegimeDetectorMetaPlugin and HybridKellyPlugin).
export { ONE_TO_TEN_LEVERAGE };

import type { SignalBus } from "../signal-bus.js";
import type {
  StrategyPlugin,
  StrategyPluginMetadata,
} from "../strategy-registry.js";
import {
  type Bar,
  type ConfigError,
  type FundingSnapshotSignal,
  type PluginState,
  type Result,
  err,
  ok,
} from "../types.js";

// ---------------------------------------------------------------------------
// Public types — venue identifiers + bucket size + raw inputs
// ---------------------------------------------------------------------------

/**
 * `VenueId` — discrete venue identifier. Each venue has its own
 * funding cadence + payload schema, normalized to 8h-equivalent bps
 * internally.
 *
 *   - `hl` — Hyperliquid — hourly settlement (1/8 of computed 8h rate).
 *   - `dydx` — dYdX v4 — hourly settlement (1/8 of computed 8h rate).
 *   - `binance` — Binance USDT-M — 8h native.
 *   - `bybit` — Bybit linear — 8h native.
 *   - `okx` — OKX USDT-SWAP — 8h native.
 *   - `bitget` — Bitget USDT-M — 8h native.
 */
export type VenueId =
  | "hl"
  | "dydx"
  | "binance"
  | "bybit"
  | "okx"
  | "bitget";

/**
 * `CrossVenueFundingDivergenceConfig` — public, overridable configuration.
 *
 * Defaults reflect the Phase 25 #2 Track C scope:
 *   - 6 default assets spanning BTC + major alts + Hyperliquid-native
 *     (HYPE).
 *   - 60-second bucket size aligns with the 1-minute resolution
 *     mandated by the brief.
 *   - 10bps divergence threshold is the documented "meaningful edge"
 *     floor (Buildix 2026).
 */
export interface CrossVenueFundingDivergenceConfig {
  /**
   * Assets to track. Each asset is the canonical coin name as listed
   * on Hyperliquid / dYdX (e.g., "BTC", "ETH", "SOL", "HYPE",
   * "DOGE", "JUP"). The CEX-side mappings are derived internally by
   * the venue adapter layer.
   *
   * Default: ['BTC','ETH','SOL','HYPE','DOGE','JUP'].
   */
  readonly assets: readonly string[];

  /**
   * Bucket size in milliseconds. The brief specifies 1-minute
   * (60_000 ms) buckets. Defensive bounds: [1_000, 3_600_000]
   * (1s..1h). Default 60_000.
   */
  readonly bucketSizeMs: number;

  /**
   * Cross-venue divergence threshold in basis points (8h-equivalent).
   * Diagnostic only — the plugin emits regardless. Default 10bps
   * matches the documented "meaningful edge" floor.
   */
  readonly divergenceThresholdBps: number;

  /**
   * Maximum acceptable divergence in bps. Diagnostic only — emit
   * proceeds regardless. Default 1000bps as sanity ceiling.
   */
  readonly maxDivergenceBps: number;

  /**
   * Base notional for 1:10 leverage cap validation. Default 10_000 USD.
   * Informational only — the plugin never emits a position-sizing
   * instruction. Held for consistency with other Phase 11+ plugins
   * (HybridKelly, RegimeDetector, CrossDexFundingWatcher) that share
   * the same config pattern.
   */
  readonly baseNotionalUsd: number;

  /**
   * Enable list of venues. By default ALL 6 venues are active. Setting
   * this to a subset (e.g., for a 4-venue regression test against
   * `CrossDexFundingWatcherPlugin`) disables the rest. The plugin
   * will only aggregate data for venues in this list.
   *
   * Default: ['hl','dydx','binance','bybit','okx','bitget'].
   */
  readonly venues: readonly VenueId[];
}

// ---------------------------------------------------------------------------
// Defaults + bounds
// ---------------------------------------------------------------------------

export const DEFAULT_BUCKET_SIZE_MS = 60_000 as const; // 1-minute bucket (brief)
export const MIN_BUCKET_SIZE_MS = 1_000 as const; // 1 second
export const MAX_BUCKET_SIZE_MS = 3_600_000 as const; // 1 hour
export const DEFAULT_DIVERGENCE_THRESHOLD_BPS = 10 as const;
export const MIN_DIVERGENCE_THRESHOLD_BPS = 0 as const;
export const MAX_DIVERGENCE_THRESHOLD_BPS = 1000 as const;
export const DEFAULT_BASE_NOTIONAL_USD = 10_000 as const;
export const DEFAULT_VENUES: readonly VenueId[] = [
  "hl",
  "dydx",
  "binance",
  "bybit",
  "okx",
  "bitget",
];

/**
 * `DEFAULT_ASSETS` — default per-asset enable list. Matches the
 * Phase 11.5 research scope plus the Phase 25 #2 brief: BTC + ETH +
 * SOL (universally tracked) + HYPE (Hyperliquid-native, documented
 * funding divergence) + DOGE + JUP (mid-cap alts with funding
 * volatility).
 */
export const DEFAULT_ASSETS: readonly string[] = [
  "BTC",
  "ETH",
  "SOL",
  "HYPE",
  "DOGE",
  "JUP",
];

// ---------------------------------------------------------------------------
// Per-(symbol × venue) bucket state
// ---------------------------------------------------------------------------

/**
 * `VenueSlotState` — mutable per-(symbol, venue) bucket slot. Holds
 * the latest funding rate reported by a venue within the current
 * 1-minute bucket window.
 */
export interface VenueSlotState {
  /** Latest rate as a DECIMAL (not bps). Null until first feed. */
  rateDecimal: number | null;
  /** Wall-clock ms of last feed. 0 until first feed. */
  lastFeedMs: number;
}

/**
 * `PerAssetBucketState` — mutable per-symbol state across all 6 venue
 * slots + the active bucket window.
 */
export interface PerAssetBucketState {
  /** Per-venue latest rate within the active bucket. */
  readonly slots: Readonly<Record<VenueId, VenueSlotState>>;
  /** Wall-clock ms start of the active bucket (aligned to bucketSize). */
  bucketStartMs: number;
  /** Last emitted snapshot for this symbol (telemetry + tests). */
  lastSnapshot: FundingSnapshotSignal | null;
  /** Count of snapshots emitted for this symbol since construction. */
  snapshotsEmitted: number;
  /** Count of buckets that closed with < 2 venues reporting (dropped). */
  insufficientVenueBuckets: number;
  /** Count of buckets that closed with ≥ 2 venues reporting (emitted). */
  emittedBuckets: number;
  /** Hidden HL predicted-hourly slot — used to populate predictedGap. */
  hlPredictedHourly: number | null;
}

// ---------------------------------------------------------------------------
// Plugin state — the full mutable container
// ---------------------------------------------------------------------------

/**
 * `CrossVenueFundingDivergencePluginState` — per-plugin mutable state.
 * Each asset in `config.assets` gets a `PerAssetBucketState` entry on
 * first data feed.
 */
export interface CrossVenueFundingDivergencePluginState {
  /** Per-symbol state. Keyed by canonical coin name. */
  readonly perAsset: Map<string, PerAssetBucketState>;
  /** Total snapshots emitted since construction. */
  totalSnapshotsEmitted: number;
  /** Total venue data feeds received (sum across all venues/symbols). */
  totalVenueFeeds: number;
  /** Total `onBar` calls since construction. */
  barsProcessed: number;
  /** Total bucket closes since construction. */
  totalBucketCloses: number;
  /** Per-venue feed counters (telemetry). */
  hlFeeds: number;
  dydxFeeds: number;
  bzFeeds: number;
  byFeeds: number;
  okFeeds: number;
  bitgetFeeds: number;
  /** Number of feeds rejected due to NaN/Infinity rate input. */
  malformedPayloadDrops: number;
  /** Layer 2 leverage-invariant assertions count (per-emit). */
  layer2AssertionCount: number;
  /** Last emitted FundingSnapshotSignal across all symbols (diagnostics). */
  lastSnapshot: FundingSnapshotSignal | null;
}

// ---------------------------------------------------------------------------
// Helpers — venue list + 8h-equivalent bps normalization
// ---------------------------------------------------------------------------

/**
 * `ALL_VENUES` — exhaustive list of supported venues. Used for default
 * config + iteration over the per-asset slots map.
 */
export const ALL_VENUES: readonly VenueId[] = DEFAULT_VENUES;

/**
 * `isVenueId` — type guard. Returns `true` iff `s` is one of the 6
 * supported venue identifiers. Useful for validating dynamic venue
 * inputs.
 */
export function isVenueId(s: string): s is VenueId {
  return (
    s === "hl" ||
    s === "dydx" ||
    s === "binance" ||
    s === "bybit" ||
    s === "okx" ||
    s === "bitget"
  );
}

/**
 * `isVenueEnabled` — true iff `venue` is in the configured enable
 * list. Centralized so per-feed methods share the same gate.
 */
function isVenueEnabled(
  venues: readonly VenueId[],
  venue: VenueId,
): boolean {
  for (const v of venues) {
    if (v === venue) return true;
  }
  return false;
}

/**
 * `floorToBucketMs` — align `tsMs` DOWN to the nearest bucket
 * boundary of size `bucketSizeMs`. Example: with 60_000 ms buckets,
 * 12:34:17.500 → 12:34:00.000.
 */
export function floorToBucketMs(tsMs: number, bucketSizeMs: number): number {
  return Math.floor(tsMs / bucketSizeMs) * bucketSizeMs;
}

/**
 * `rateDecimalToBps8h` — convert a funding rate from its native cadence
 * to 8h-equivalent basis points.
 *
 *   - `hl` / `dydx` — input is HOURLY rate as decimal; output is
 *     8h-equivalent bps = hourly × 8 × 10_000.
 *   - `binance` / `bybit` / `okx` / `bitget` — input is 8h-native rate
 *     as decimal; output is 8h-equivalent bps = 8h × 10_000.
 */
export function rateDecimalToBps8h(
  rateDecimal: number,
  venue: VenueId,
): number {
  if (venue === "hl" || venue === "dydx") {
    return rateDecimal * 8 * 10_000;
  }
  return rateDecimal * 10_000;
}

// ---------------------------------------------------------------------------
// CrossVenueFundingDivergencePlugin
// ---------------------------------------------------------------------------

/**
 * `CrossVenueFundingDivergencePlugin` — Phase 25 #2 T4 / Track C
 * read-only signal-pool plugin.
 *
 * Aggregates per-venue × per-symbol funding rates from SIX venues
 * (Hyperliquid + dYdX + Binance + Bybit + OKX + Bitget), buckets each
 * (venue, symbol) into 1-minute windows, and emits a typed
 * `FundingSnapshotSignal` per symbol per closed bucket with the
 * explicit `divergenceBps` metric = max - min across all venues that
 * reported within the bucket.
 *
 * Like its 4-venue sibling `CrossDexFundingWatcherPlugin`, this
 * plugin does NOT itself open WebSocket connections — it exposes
 * `recordHlFunding` / `recordDydxFunding` / `recordBzFunding` /
 * `recordByFunding` / `recordOkFunding` / `recordBitgetFunding`
 * data-injection methods, plus raw-message parsers for a separate
 * venue adapter layer to call.
 *
 * Lifecycle:
 *   1. `new CrossVenueFundingDivergencePlugin({ ... })`.
 *   2. `plugin.validateConfig(...)` — boot-time audit.
 *   3. `plugin.subscribe(bus)` — captures bus reference; the plugin
 *      does NOT subscribe to other signal kinds (it's a SOURCE plugin).
 *   4. `plugin.record*Funding(...)` — feed venue data (called by venue
 *      adapter or backtest harness).
 *   5. `plugin.pollAndEmit(timestampMs)` — close any buckets whose
 *      window has ended and emit a snapshot per symbol that crossed
 *      the 2-venue reporting threshold. Also called internally from
 *      `onBar`.
 *   6. `plugin.onBar(bar, state)` — per-bar tick (calls pollAndEmit).
 *   7. `plugin.reset()` / `plugin.dispose()` — backtest lifecycle.
 */
export class CrossVenueFundingDivergencePlugin implements StrategyPlugin {
  // ---------------------------------------------------------------------
  // Static metadata
  // ---------------------------------------------------------------------

  public readonly metadata: StrategyPluginMetadata = {
    name: "cross-venue-funding-divergence-v1",
    version: "1.0.0",
    edgeClass: "mixed", // emits FundingSnapshotSignal (with extra 6-venue fields)
    capitalRequirement: 0, // signal-only, zero capital needed
    maxLeverage: ONE_TO_TEN_LEVERAGE, // Layer 1 of 3-layer 1:10 defense
    description:
      "Phase 25 #2 T4 / Track C signal-pool plugin (READ-ONLY). " +
      "Aggregates per-venue funding rates from SIX venues (Hyperliquid + " +
      "dYdX + Binance + Bybit + OKX + Bitget), buckets each (venue, " +
      "symbol) into 1-minute windows, and emits per-symbol " +
      "`FundingSnapshotSignal` with explicit `divergenceBps` = max - min " +
      "across all venues reporting within the bucket. Powers the Track C " +
      "regime indicator for convergent-vs-fragmented funding classification.",
    dependencies: [],
  };

  // ---------------------------------------------------------------------
  // Instance state
  // ---------------------------------------------------------------------

  public readonly config: CrossVenueFundingDivergenceConfig;
  public readonly state: CrossVenueFundingDivergencePluginState;
  /** Captured bus reference (set in subscribe). */
  private _bus: SignalBus | null = null;
  /** Whether subscribe() has been called. */
  private _wired = false;

  // ---------------------------------------------------------------------
  // Construction
  // ---------------------------------------------------------------------

  constructor(
    overrides: Partial<CrossVenueFundingDivergenceConfig> = {},
  ) {
    this.config = {
      assets: overrides.assets ?? DEFAULT_ASSETS,
      bucketSizeMs: overrides.bucketSizeMs ?? DEFAULT_BUCKET_SIZE_MS,
      divergenceThresholdBps:
        overrides.divergenceThresholdBps ?? DEFAULT_DIVERGENCE_THRESHOLD_BPS,
      maxDivergenceBps:
        overrides.maxDivergenceBps ?? MAX_DIVERGENCE_THRESHOLD_BPS,
      baseNotionalUsd: overrides.baseNotionalUsd ?? DEFAULT_BASE_NOTIONAL_USD,
      venues: overrides.venues ?? DEFAULT_VENUES,
    };

    // LAYER 1 — constructor assertion. The metadata declares
    // `maxLeverage: ONE_TO_TEN_LEVERAGE` (= 10). Defensive runtime
    // check matches the convention used by every other Phase 11+
    // read-only plugin.
    if (this.metadata.maxLeverage !== ONE_TO_TEN_LEVERAGE) {
      throw new Error(
        `[CrossVenueFundingDivergencePlugin] LAYER 1 BREACH: metadata.maxLeverage=${String(this.metadata.maxLeverage)} but the project-wide 1:10 mandate requires 10.`,
      );
    }

    // Hard config validation — defense in depth.
    if (
      !Number.isFinite(this.config.bucketSizeMs) ||
      !Number.isInteger(this.config.bucketSizeMs) ||
      this.config.bucketSizeMs < MIN_BUCKET_SIZE_MS ||
      this.config.bucketSizeMs > MAX_BUCKET_SIZE_MS
    ) {
      throw new Error(
        `[CrossVenueFundingDivergencePlugin] bucketSizeMs=${this.config.bucketSizeMs} must be an integer in [${MIN_BUCKET_SIZE_MS}, ${MAX_BUCKET_SIZE_MS}].`,
      );
    }
    if (
      !Number.isFinite(this.config.divergenceThresholdBps) ||
      this.config.divergenceThresholdBps < MIN_DIVERGENCE_THRESHOLD_BPS ||
      this.config.divergenceThresholdBps > MAX_DIVERGENCE_THRESHOLD_BPS
    ) {
      throw new Error(
        `[CrossVenueFundingDivergencePlugin] divergenceThresholdBps=${this.config.divergenceThresholdBps} must be in [${MIN_DIVERGENCE_THRESHOLD_BPS}, ${MAX_DIVERGENCE_THRESHOLD_BPS}].`,
      );
    }
    if (
      !Number.isFinite(this.config.maxDivergenceBps) ||
      this.config.maxDivergenceBps <= 0
    ) {
      throw new Error(
        `[CrossVenueFundingDivergencePlugin] maxDivergenceBps=${this.config.maxDivergenceBps} must be a finite number > 0.`,
      );
    }
    if (this.config.divergenceThresholdBps > this.config.maxDivergenceBps) {
      throw new Error(
        `[CrossVenueFundingDivergencePlugin] divergenceThresholdBps=${this.config.divergenceThresholdBps} must be <= maxDivergenceBps=${this.config.maxDivergenceBps}.`,
      );
    }
    if (
      !Number.isFinite(this.config.baseNotionalUsd) ||
      this.config.baseNotionalUsd <= 0
    ) {
      throw new Error(
        `[CrossVenueFundingDivergencePlugin] baseNotionalUsd=${this.config.baseNotionalUsd} must be a finite number > 0.`,
      );
    }
    if (!Array.isArray(this.config.assets) || this.config.assets.length === 0) {
      throw new Error(
        `[CrossVenueFundingDivergencePlugin] assets must be a non-empty array of non-empty strings.`,
      );
    }
    const seenAssets = new Set<string>();
    const assetsArr = this.config.assets as readonly string[];
    for (let i = 0; i < assetsArr.length; i++) {
      const a = assetsArr[i]!;
      if (typeof a !== "string" || a.length === 0) {
        throw new Error(
          `[CrossVenueFundingDivergencePlugin] assets[${i}] must be a non-empty string.`,
        );
      }
      if (seenAssets.has(a)) {
        throw new Error(
          `[CrossVenueFundingDivergencePlugin] assets contains duplicate "${a}".`,
        );
      }
      seenAssets.add(a);
    }
    if (
      !Array.isArray(this.config.venues) ||
      this.config.venues.length === 0
    ) {
      throw new Error(
        `[CrossVenueFundingDivergencePlugin] venues must be a non-empty array of valid VenueId literals.`,
      );
    }
    const seenVenues = new Set<VenueId>();
    const venuesArr = this.config.venues as readonly string[];
    for (let i = 0; i < venuesArr.length; i++) {
      const v = venuesArr[i]!;
      if (!isVenueId(v)) {
        throw new Error(
          `[CrossVenueFundingDivergencePlugin] venues[${i}]="${v}" is not a valid VenueId (expected one of ${ALL_VENUES.join(", ")}).`,
        );
      }
      if (seenVenues.has(v)) {
        throw new Error(
          `[CrossVenueFundingDivergencePlugin] venues contains duplicate "${v}".`,
        );
      }
      seenVenues.add(v);
    }

    this.state = {
      perAsset: new Map<string, PerAssetBucketState>(),
      totalSnapshotsEmitted: 0,
      totalVenueFeeds: 0,
      barsProcessed: 0,
      totalBucketCloses: 0,
      hlFeeds: 0,
      dydxFeeds: 0,
      bzFeeds: 0,
      byFeeds: 0,
      okFeeds: 0,
      bitgetFeeds: 0,
      malformedPayloadDrops: 0,
      layer2AssertionCount: 0,
      lastSnapshot: null,
    };
  }

  // ---------------------------------------------------------------------
  // subscribe — capture bus reference (source plugin, no inbound subs)
  // ---------------------------------------------------------------------

  subscribe(bus: SignalBus): void {
    this._bus = bus;
    this._wired = true;
  }

  // ---------------------------------------------------------------------
  // onBar — per-bar tick (calls pollAndEmit)
  // ---------------------------------------------------------------------

  onBar(bar: Bar, _state: PluginState): void {
    this.state.barsProcessed += 1;
    this.pollAndEmit(bar.timestamp);
  }

  // ---------------------------------------------------------------------
  // validateConfig — non-throwing boot-time audit
  // ---------------------------------------------------------------------

  validateConfig(config: unknown): Result<void, ConfigError> {
    if (config === null || config === undefined) return ok(undefined);
    if (typeof config !== "object") {
      return err({
        pluginName: this.metadata.name,
        field: "config",
        message: `config must be an object, got ${typeof config}`,
        value: config,
      });
    }
    const c = config as Partial<CrossVenueFundingDivergenceConfig>;
    if (c.bucketSizeMs !== undefined) {
      if (
        !Number.isInteger(c.bucketSizeMs) ||
        c.bucketSizeMs < MIN_BUCKET_SIZE_MS ||
        c.bucketSizeMs > MAX_BUCKET_SIZE_MS
      ) {
        return err({
          pluginName: this.metadata.name,
          field: "bucketSizeMs",
          message: `bucketSizeMs must be an integer in [${MIN_BUCKET_SIZE_MS}, ${MAX_BUCKET_SIZE_MS}].`,
          value: c.bucketSizeMs,
        });
      }
    }
    if (c.divergenceThresholdBps !== undefined) {
      if (
        !Number.isFinite(c.divergenceThresholdBps) ||
        c.divergenceThresholdBps < MIN_DIVERGENCE_THRESHOLD_BPS ||
        c.divergenceThresholdBps > MAX_DIVERGENCE_THRESHOLD_BPS
      ) {
        return err({
          pluginName: this.metadata.name,
          field: "divergenceThresholdBps",
          message: `divergenceThresholdBps must be in [${MIN_DIVERGENCE_THRESHOLD_BPS}, ${MAX_DIVERGENCE_THRESHOLD_BPS}].`,
          value: c.divergenceThresholdBps,
        });
      }
    }
    if (c.assets !== undefined) {
      if (!Array.isArray(c.assets) || c.assets.length === 0) {
        return err({
          pluginName: this.metadata.name,
          field: "assets",
          message: "assets must be a non-empty array",
          value: c.assets,
        });
      }
    }
    return ok(undefined);
  }

  // ---------------------------------------------------------------------
  // reset — clear mutable state between backtest re-runs
  // ---------------------------------------------------------------------

  reset(): void {
    this.state.perAsset.clear();
    this.state.totalSnapshotsEmitted = 0;
    this.state.totalVenueFeeds = 0;
    this.state.barsProcessed = 0;
    this.state.totalBucketCloses = 0;
    this.state.hlFeeds = 0;
    this.state.dydxFeeds = 0;
    this.state.bzFeeds = 0;
    this.state.byFeeds = 0;
    this.state.okFeeds = 0;
    this.state.bitgetFeeds = 0;
    this.state.malformedPayloadDrops = 0;
    this.state.layer2AssertionCount = 0;
    this.state.lastSnapshot = null;
  }

  // ---------------------------------------------------------------------
  // dispose — release bus reference
  // ---------------------------------------------------------------------

  dispose(): void {
    this._bus = null;
    this._wired = false;
  }

  // ---------------------------------------------------------------------
  // Data injection — record*Funding methods
  // ---------------------------------------------------------------------

  /**
   * `recordHlFunding` — feed a Hyperliquid HOURLY funding rate
   * (decimal). Internally multiplied by 8 × 10_000 to produce
   * 8h-equivalent bps.
   *
   * `hlPredictedHourly` (optional) — Hyperliquid predicted NEXT-HOUR
   * rate (decimal). Used to populate `predictedGap` on the next emit.
   * Pass `null` to clear the predicted value.
   */
  recordHlFunding(
    asset: string,
    fundingHourly: number,
    hlPredictedHourly: number | null = null,
    timestampMs?: number,
  ): void {
    if (!isVenueEnabled(this.config.venues, "hl")) return;
    if (!this.config.assets.includes(asset)) return;
    if (!Number.isFinite(fundingHourly)) {
      this.state.malformedPayloadDrops += 1;
      return;
    }
    const ss = this._getOrCreatePerAsset(asset, timestampMs);
    ss.slots.hl.rateDecimal = fundingHourly;
    ss.slots.hl.lastFeedMs = timestampMs ?? Date.now();
    if (hlPredictedHourly !== null && !Number.isFinite(hlPredictedHourly)) {
      this.state.malformedPayloadDrops += 1;
    } else {
      ss.hlPredictedHourly = hlPredictedHourly;
    }
    this.state.hlFeeds += 1;
    this.state.totalVenueFeeds += 1;
  }

  /**
   * `recordDydxFunding` — feed a dYdX v4 HOURLY funding rate
   * (decimal). Internally multiplied by 8 × 10_000 to produce
   * 8h-equivalent bps.
   */
  recordDydxFunding(
    asset: string,
    fundingHourly: number,
    timestampMs?: number,
  ): void {
    if (!isVenueEnabled(this.config.venues, "dydx")) return;
    if (!this.config.assets.includes(asset)) return;
    if (!Number.isFinite(fundingHourly)) {
      this.state.malformedPayloadDrops += 1;
      return;
    }
    const ss = this._getOrCreatePerAsset(asset, timestampMs);
    ss.slots.dydx.rateDecimal = fundingHourly;
    ss.slots.dydx.lastFeedMs = timestampMs ?? Date.now();
    this.state.dydxFeeds += 1;
    this.state.totalVenueFeeds += 1;
  }

  /**
   * `recordBzFunding` — feed a Binance 8h-native funding rate
   * (decimal). No cadence normalization needed — Binance is already 8h.
   */
  recordBzFunding(
    asset: string,
    funding8h: number,
    timestampMs?: number,
  ): void {
    if (!isVenueEnabled(this.config.venues, "binance")) return;
    if (!this.config.assets.includes(asset)) return;
    if (!Number.isFinite(funding8h)) {
      this.state.malformedPayloadDrops += 1;
      return;
    }
    const ss = this._getOrCreatePerAsset(asset, timestampMs);
    ss.slots.binance.rateDecimal = funding8h;
    ss.slots.binance.lastFeedMs = timestampMs ?? Date.now();
    this.state.bzFeeds += 1;
    this.state.totalVenueFeeds += 1;
  }

  /**
   * `recordByFunding` — feed a Bybit 8h-native funding rate (decimal).
   */
  recordByFunding(
    asset: string,
    funding8h: number,
    timestampMs?: number,
  ): void {
    if (!isVenueEnabled(this.config.venues, "bybit")) return;
    if (!this.config.assets.includes(asset)) return;
    if (!Number.isFinite(funding8h)) {
      this.state.malformedPayloadDrops += 1;
      return;
    }
    const ss = this._getOrCreatePerAsset(asset, timestampMs);
    ss.slots.bybit.rateDecimal = funding8h;
    ss.slots.bybit.lastFeedMs = timestampMs ?? Date.now();
    this.state.byFeeds += 1;
    this.state.totalVenueFeeds += 1;
  }

  /**
   * `recordOkFunding` — feed an OKX 8h-native funding rate (decimal).
   */
  recordOkFunding(
    asset: string,
    funding8h: number,
    timestampMs?: number,
  ): void {
    if (!isVenueEnabled(this.config.venues, "okx")) return;
    if (!this.config.assets.includes(asset)) return;
    if (!Number.isFinite(funding8h)) {
      this.state.malformedPayloadDrops += 1;
      return;
    }
    const ss = this._getOrCreatePerAsset(asset, timestampMs);
    ss.slots.okx.rateDecimal = funding8h;
    ss.slots.okx.lastFeedMs = timestampMs ?? Date.now();
    this.state.okFeeds += 1;
    this.state.totalVenueFeeds += 1;
  }

  /**
   * `recordBitgetFunding` — feed a Bitget 8h-native funding rate
   * (decimal).
   */
  recordBitgetFunding(
    asset: string,
    funding8h: number,
    timestampMs?: number,
  ): void {
    if (!isVenueEnabled(this.config.venues, "bitget")) return;
    if (!this.config.assets.includes(asset)) return;
    if (!Number.isFinite(funding8h)) {
      this.state.malformedPayloadDrops += 1;
      return;
    }
    const ss = this._getOrCreatePerAsset(asset, timestampMs);
    ss.slots.bitget.rateDecimal = funding8h;
    ss.slots.bitget.lastFeedMs = timestampMs ?? Date.now();
    this.state.bitgetFeeds += 1;
    this.state.totalVenueFeeds += 1;
  }

  // ---------------------------------------------------------------------
  // pollAndEmit — close expired buckets and emit snapshots
  // ---------------------------------------------------------------------

  /**
   * `pollAndEmit` — for each tracked asset, close any buckets whose
   * window has ended (relative to `timestampMs`) and emit a snapshot
   * per asset whose bucket had ≥ 2 venues reporting. Returns the
   * emitted snapshots.
   *
   * Bucket boundary detection: a bucket CLOSES when the call's
   * `timestampMs` is >= (bucketStartMs + bucketSizeMs). The emit
   * carries the closed bucket's `bucketStartMs` so downstream
   * consumers can reconstruct the window.
   *
   * If NO asset has ANY venue data, the poll is a no-op (no buckets
   * were ever opened). If a bucket had only one venue reporting,
   * the snapshot is NOT emitted (need ≥ 2 venues for meaningful
   * divergence).
   */
  pollAndEmit(timestampMs?: number): readonly FundingSnapshotSignal[] {
    const ts = timestampMs ?? Date.now();
    const emitted: FundingSnapshotSignal[] = [];

    for (const asset of this.config.assets) {
      const ss = this.state.perAsset.get(asset);
      if (!ss) continue;

      // Has the bucket CLOSED? If `ts` is still within the current
      // bucket window (ts < bucketStart + bucketSize), skip — bucket
      // is still accumulating.
      const bucketEnd = ss.bucketStartMs + this.config.bucketSizeMs;
      if (ts < bucketEnd) {
        continue;
      }

      // Bucket closed. Compute divergence across all venues that
      // reported within the bucket window.
      const presentBps: number[] = [];
      let hl8h = Number.NaN;
      let dydx8h = Number.NaN;
      let bz8h = Number.NaN;
      let by8h = Number.NaN;
      let ok8h = Number.NaN;
      let bitget8h = Number.NaN;

      if (
        isVenueEnabled(this.config.venues, "hl") &&
        ss.slots.hl.rateDecimal !== null
      ) {
        const v = rateDecimalToBps8h(ss.slots.hl.rateDecimal, "hl");
        hl8h = v;
        presentBps.push(v);
      }
      if (
        isVenueEnabled(this.config.venues, "dydx") &&
        ss.slots.dydx.rateDecimal !== null
      ) {
        const v = rateDecimalToBps8h(ss.slots.dydx.rateDecimal, "dydx");
        dydx8h = v;
        presentBps.push(v);
      }
      if (
        isVenueEnabled(this.config.venues, "binance") &&
        ss.slots.binance.rateDecimal !== null
      ) {
        const v = rateDecimalToBps8h(ss.slots.binance.rateDecimal, "binance");
        bz8h = v;
        presentBps.push(v);
      }
      if (
        isVenueEnabled(this.config.venues, "bybit") &&
        ss.slots.bybit.rateDecimal !== null
      ) {
        const v = rateDecimalToBps8h(ss.slots.bybit.rateDecimal, "bybit");
        by8h = v;
        presentBps.push(v);
      }
      if (
        isVenueEnabled(this.config.venues, "okx") &&
        ss.slots.okx.rateDecimal !== null
      ) {
        const v = rateDecimalToBps8h(ss.slots.okx.rateDecimal, "okx");
        ok8h = v;
        presentBps.push(v);
      }
      if (
        isVenueEnabled(this.config.venues, "bitget") &&
        ss.slots.bitget.rateDecimal !== null
      ) {
        const v = rateDecimalToBps8h(
          ss.slots.bitget.rateDecimal,
          "bitget",
        );
        bitget8h = v;
        presentBps.push(v);
      }

      this.state.totalBucketCloses += 1;

      if (presentBps.length < 2) {
        // Insufficient data — drop the bucket and advance the window.
        ss.insufficientVenueBuckets += 1;
        ss.bucketStartMs = floorToBucketMs(ts, this.config.bucketSizeMs);
        // Clear slots so the next bucket starts fresh.
        for (const v of ALL_VENUES) {
          ss.slots[v].rateDecimal = null;
          ss.slots[v].lastFeedMs = 0;
        }
        ss.hlPredictedHourly = null;
        continue;
      }

      const max = Math.max(...presentBps);
      const min = Math.min(...presentBps);
      const divergenceBps = max - min;

      // Predicted gap: only computable when HL has both realized +
      // predicted. Mirrors the convention of CrossDexFundingWatcherPlugin.
      let predictedGap = 0;
      if (ss.slots.hl.rateDecimal !== null && ss.hlPredictedHourly !== null) {
        predictedGap =
          (ss.hlPredictedHourly - ss.slots.hl.rateDecimal) * 8 * 10_000;
      }

      // Spreadmax across the legacy 4 fields (HL + BZ + BY + OK) is
      // retained for backward compat with `CrossDexFundingWatcherPlugin`
      // consumers. Computed from the present subset, NaN if absent.
      const legacyFour: number[] = [];
      if (Number.isFinite(hl8h)) legacyFour.push(hl8h);
      if (Number.isFinite(bz8h)) legacyFour.push(bz8h);
      if (Number.isFinite(by8h)) legacyFour.push(by8h);
      if (Number.isFinite(ok8h)) legacyFour.push(ok8h);
      const spreadMax =
        legacyFour.length >= 2
          ? Math.max(...legacyFour) - Math.min(...legacyFour)
          : divergenceBps;

      // LAYER 2 — defensive hook: assert 1:10 invariant with 0 notional
      // (matches the convention of every other read-only Phase 11+
      // plugin). Trivially passes but keeps the assertion counter
      // advancing for symmetry with `CrossDexFundingWatcherPlugin`.
      try {
        assertLeverageInvariant(0, this.config.baseNotionalUsd);
        this.state.layer2AssertionCount += 1;
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        throw new Error(
          `[CrossVenueFundingDivergencePlugin] LAYER 2 BREACH (defensive hook): ${msg}`,
          { cause: e },
        );
      }

      // Build the snapshot. With exactOptionalPropertyTypes, we
      // conditionally include optional fields rather than setting
      // them to undefined.
      const bucketStartMs = ss.bucketStartMs;
      const snap: FundingSnapshotSignal = {
        kind: "funding-snapshot",
        asset,
        hl8h,
        bz: bz8h,
        by: by8h,
        ok: ok8h,
        spreadMax,
        predictedGap,
        timestamp: ts,
        source: `${this.metadata.name}:${asset}`,
        timestampMs: ts,
        divergenceBps,
        bucketStartMs,
      };
      // Conditionally attach dYdX / Bitget raw values — only when the
      // venue reported during the bucket.
      if (Number.isFinite(dydx8h)) {
        (snap as { dydx8h?: number }).dydx8h = dydx8h;
      }
      if (Number.isFinite(bitget8h)) {
        (snap as { bitget8h?: number }).bitget8h = bitget8h;
      }

      ss.lastSnapshot = snap;
      ss.snapshotsEmitted += 1;
      ss.emittedBuckets += 1;
      this.state.totalSnapshotsEmitted += 1;
      this.state.lastSnapshot = snap;
      emitted.push(snap);

      // Advance bucket window to the next boundary aligned to `ts`.
      ss.bucketStartMs = floorToBucketMs(ts, this.config.bucketSizeMs);
      // Clear slots so the next bucket starts fresh.
      for (const v of ALL_VENUES) {
        ss.slots[v].rateDecimal = null;
        ss.slots[v].lastFeedMs = 0;
      }
      ss.hlPredictedHourly = null;

      if (this._bus && this._wired) {
        this._bus.emit(snap);
      }
    }

    return emitted;
  }

  // ---------------------------------------------------------------------
  // Public accessors
  // ---------------------------------------------------------------------

  /** Returns the list of enabled assets. */
  enabledAssets(): readonly string[] {
    return this.config.assets;
  }

  /** Returns true if `asset` is in the configured enable list. */
  isAssetEnabled(asset: string): boolean {
    return this.config.assets.includes(asset);
  }

  /** Returns the list of enabled venues. */
  enabledVenues(): readonly VenueId[] {
    return this.config.venues;
  }

  /** Returns the last snapshot for `asset`, or null if none yet. */
  lastSnapshotFor(asset: string): FundingSnapshotSignal | null {
    return this.state.perAsset.get(asset)?.lastSnapshot ?? null;
  }

  /** Returns the number of snapshots emitted for `asset` since construction. */
  snapshotsEmittedFor(asset: string): number {
    return this.state.perAsset.get(asset)?.snapshotsEmitted ?? 0;
  }

  /** Returns the number of buckets that closed for `asset` with insufficient venue data. */
  insufficientVenueBucketsFor(asset: string): number {
    return this.state.perAsset.get(asset)?.insufficientVenueBuckets ?? 0;
  }

  /** Returns the number of buckets that closed for `asset` with ≥ 2 venues. */
  emittedBucketsFor(asset: string): number {
    return this.state.perAsset.get(asset)?.emittedBuckets ?? 0;
  }

  /** Returns true if at least one venue has reported for `asset`. */
  hasAnyVenueData(asset: string): boolean {
    const ss = this.state.perAsset.get(asset);
    if (!ss) return false;
    for (const v of ALL_VENUES) {
      if (ss.slots[v].rateDecimal !== null) return true;
    }
    return false;
  }

  /** Returns the bucket size in ms. */
  bucketSizeMs(): number {
    return this.config.bucketSizeMs;
  }

  /** Returns the active bucket start (ms) for `asset`, or null if no state yet. */
  bucketStartMsFor(asset: string): number | null {
    return this.state.perAsset.get(asset)?.bucketStartMs ?? null;
  }

  // ---------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------

  private _getOrCreatePerAsset(
    asset: string,
    timestampMs?: number,
  ): PerAssetBucketState {
    let ss = this.state.perAsset.get(asset);
    if (ss !== undefined) return ss;
    const ts = timestampMs ?? Date.now();
    ss = {
      slots: {
        hl: { rateDecimal: null, lastFeedMs: 0 },
        dydx: { rateDecimal: null, lastFeedMs: 0 },
        binance: { rateDecimal: null, lastFeedMs: 0 },
        bybit: { rateDecimal: null, lastFeedMs: 0 },
        okx: { rateDecimal: null, lastFeedMs: 0 },
        bitget: { rateDecimal: null, lastFeedMs: 0 },
      },
      bucketStartMs: floorToBucketMs(ts, this.config.bucketSizeMs),
      lastSnapshot: null,
      snapshotsEmitted: 0,
      insufficientVenueBuckets: 0,
      emittedBuckets: 0,
      hlPredictedHourly: null,
    };
    this.state.perAsset.set(asset, ss);
    return ss;
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * `createCrossVenueFundingDivergencePlugin` — convenience factory.
 * Same as `new CrossVenueFundingDivergencePlugin(opts)`.
 */
export function createCrossVenueFundingDivergencePlugin(
  overrides?: Partial<CrossVenueFundingDivergenceConfig>,
): CrossVenueFundingDivergencePlugin {
  return new CrossVenueFundingDivergencePlugin(overrides);
}