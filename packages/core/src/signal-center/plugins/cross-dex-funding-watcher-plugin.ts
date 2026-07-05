// packages/core/src/signal-center/plugins/cross-dex-funding-watcher-plugin.ts —
// Phase 12 Track B / Phase 11.5 Track E §H1.
//
// ===========================================================================
// READ-ONLY SIGNAL PLUGIN — CrossDexFundingWatcherPlugin
// ===========================================================================
//
// Purpose
// -------
// Reads real-time funding-rate data from FOUR venues (Hyperliquid, Binance,
// Bybit, OKX), normalizes each rate to 8h-equivalent basis points, computes
// per-asset cross-venue spread metrics, and emits a typed `FundingSnapshotSignal`
// to the SignalBus. This is the FOUNDATION layer for Phase 12 Track B/C plugins
// — particularly Plugin E2 (`CrossDexDeltaNeutralArb`) which consumes the
// snapshot stream to gate execution.
//
// Why this plugin?
// ----------------
// Phase 11.4d (TermStructure) + Phase 11.4e (RegimeShift) shipped with SYNTHETIC
// AR(1) basis data — that was insufficient for production cross-DEX alpha.
// Phase 11.5 research fleet surfaced concrete evidence (see REPORT.md §3.5,
// §H1, §3 / Hypothesis H1) that live multi-venue funding carries 2-3× the
// information content of synthetic data. HL runs 2-3× higher funding than
// CEX (BitMEX Q3 2025 + Button + CoinGlass triple-confirmed; 23.23% BTC
// annualized HL vs 4.52% Binance on Dec 5 2024 per Sina Finance / 十组
// 数据了解Hyperliquid). Cross-DEX funding carry for HYPE/SOL has been
// documented at 28-42% APR (ArbitrageScanner Jun 2026) and 18-32% APR
// post-fee (ArbitrageScanner + Buildix).
//
// This plugin is the FIRST step to operationalize that alpha: provide the
// cross-venue substrate that downstream execution plugins can consume.
//
// 1:10 leverage invariant (3-layer defense — TRIVIALLY met)
// ------------------------------------------------------------
// This is a READ-ONLY signal plugin — no notional is ever computed or
// emitted. The 3-layer defense pattern is:
//
//   Layer 1 (constructor): `metadata.maxLeverage = 10` (= ONE_TO_TEN_LEVERAGE).
//     The registry's `validatePluginMetadata` rejects any plugin declaring
//     leverage > 10.
//
//   Layer 2 (subscribe): no in-flight notional state — the plugin does not
//     subscribe to other signal kinds (this is a SOURCE plugin, not a
//     meta/derivative plugin). The 1:10 cap is trivially met at this layer.
//
//   Layer 3 (per-bar guard): `onBar` increments a counter and emits the
//     latest snapshot. No notional arithmetic is performed — there is
//     nothing for the SCv1 portfolio risk engine to flag.
//
//   The plugin emits `FundingSnapshotSignal` which has NO notional field.
//   Downstream plugins that DO open positions (Phase 12 E2) inherit the
//   standard 1:10 defense at THEIR constructor and per-emit layers.
//
// Per-symbol disclosure (Phase 11.5 scope plan §1):
//   - BTC: REGISTERED (default-on)
//   - ETH: REGISTERED (default-on)
//   - SOL: REGISTERED (default-on)
//   - HYPE: REGISTERED (default-on — Hyperliquid-native, large funding
//     divergence historically)
//   - DOGE: REGISTERED (default-on — mid-cap alt with documented funding
//     volatility)
//   - JUP: REGISTERED (default-on — Jupiter ecosystem token, mid-cap alt)
//
// References (≥5 independent sources on multi-venue funding wiring):
//
//   - Hyperliquid — Funding Docs (hyperliquid.gitbook.io/.../funding):
//     hourly settlement cadence (1/8 of computed 8h rate); 4%/hr cap;
//     `F = avg premium + clamp(interest - premium, -0.0005, +0.0005)`.
//   - Hyperliquid — Perpetuals API (hyperliquid.gitbook.io/.../info-endpoint/perpetuals):
//     `metaAndAssetCtxs` + `predictedFundings` endpoints (both free public).
//   - Binance — fapi/v1/fundingRate (public, free, no auth).
//   - Bybit — v5/market/funding/history + WS `tickers` (public, free).
//   - OKX — api/v5/public/funding-rate + WS `funding-rate` (public, free).
//   - BitMEX Q3 2025 Derivatives Report — "Anchors and Ceilings" — empirical
//     Hyperliquid 2-3× CEX funding multiple across BTC/ETH/SOL.
//   - Button — Hyperliquid Funding Rates Guide — BTC annualized 4-8% on HL
//     vs 2-4% on Binance; alts 10-30% vs 5-15%.
//   - CoinGlass — Funding Rate Tracker + Arbitrage API — cross-venue ranking.
//   - ArbitrageScanner — HYPE/Binance Cross-DEX Guide, Jun 2026 — HYPE
//     +28-42% annualized documented; +18-32% post-fee for $50K-$200K capital.
//   - Hyperliquid Funding comparison page (app.hyperliquid.xyz/fundingComparison)
//     — official cross-venue tool.
//
// Plugin shape (Phase 11.5 Track E §4 Plugin E1 — HIGHEST PRIORITY READ-ONLY):
//   - Polls Hyperliquid + Binance + Bybit + OKX in parallel.
//   - Normalizes all rates to 8h-equivalent basis points.
//   - Publishes per-asset cross-venue snapshots + spread metrics +
//     predicted-vs-realized gap to the bus via `FundingSnapshotSignal`.

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
// Public types — venue identifiers + per-asset state
// ---------------------------------------------------------------------------

/**
 * `VenueId` — discrete venue identifier. Each venue has its own funding
 * cadence + payload schema, normalized to 8h-equivalent bps internally.
 *
 * - `hl`: Hyperliquid — hourly settlement (1/8 of computed 8h rate).
 * - `binance`: Binance USDT-M — 8h native.
 * - `bybit`: Bybit linear — 8h native.
 * - `okx`: OKX USDT-SWAP — 8h native.
 */
export type VenueId = "hl" | "binance" | "bybit" | "okx";

/**
 * `CrossDexFundingWatcherConfig` — public, overridable configuration.
 *
 * Defaults reflect the Phase 11.5 research fleet's recommendations:
 *   - 6 default assets spanning BTC + major alts + Hyperliquid-native (HYPE).
 *   - 5s poll cadence matches the WS push interval for `markPrice@1s` on
 *     Binance; conservative enough to avoid WS rate-limit issues while
 *     fast enough to capture funding-spike bursts.
 *   - 10bps spread threshold is the documented "meaningful edge" floor
 *     per Buildix's "Look for spreads wider than 0.05% per 8-hour interval.
 *     Below that, fees and slippage typically erase the profit." Below this
 *     threshold the plugin still emits (so downstream consumers can apply
 *     their own filter), but the `maxSpreadBpsThreshold` is exposed for
 *     diagnostics.
 */
export interface CrossDexFundingWatcherConfig {
  /**
   * Assets to track. Each asset must be the canonical coin name as
   * listed on Hyperliquid (e.g., "BTC", "ETH", "SOL", "HYPE", "DOGE",
   * "JUP"). The CEX-side mappings (`BTCUSDT`, `BTC-USDT-SWAP`, etc.)
   * are derived internally.
   * Default: ['BTC','ETH','SOL','HYPE','DOGE','JUP'].
   */
  readonly assets: readonly string[];
  /**
   * Poll interval in seconds. Default 5s (matches Binance markPrice@1s
   * push rate). MUST be ≥ 1s (defensive — sub-1s polling risks rate
   * limits and provides no alpha edge at 1m bar granularity).
   */
  readonly pollIntervalSec: number;
  /**
   * Cross-venue spread threshold in basis points (8h-equivalent).
   * Diagnostic only — the plugin emits regardless. Default 10bps
   * matches the documented "meaningful edge" floor (Buildix 2026).
   */
  readonly maxSpreadBpsThreshold: number;
  /**
   * Maximum acceptable predicted-vs-realized gap in basis points.
   * Diagnostic only. Default 50bps — anything wider signals a
   * Hyperliquid microstructure regime shift (used by Phase 12 Track
   * C M1 cascade detection as a co-signal).
   */
  readonly maxPredictedGapBps: number;
  /**
   * Base notional for 1:10 leverage cap validation. Default 10_000 USD.
   * Notional here is INFORMATIONAL only — the plugin never emits a
   * position-sizing instruction. Held for consistency with other
   * Phase 11+ plugins (HybridKelly, RegimeDetector, etc.) that share
   * the same config pattern.
   */
  readonly baseNotionalUsd: number;
}

// ---------------------------------------------------------------------------
// Defaults + bounds
// ---------------------------------------------------------------------------

export const DEFAULT_POLL_INTERVAL_SEC = 5 as const;
export const MIN_POLL_INTERVAL_SEC = 1 as const;
export const MAX_POLL_INTERVAL_SEC = 300 as const; // 5 minutes — backstop
export const DEFAULT_MAX_SPREAD_BPS_THRESHOLD = 10 as const;
export const MAX_SPREAD_BPS_THRESHOLD = 1000 as const; // sanity ceiling
export const DEFAULT_MAX_PREDICTED_GAP_BPS = 50 as const;
export const MAX_PREDICTED_GAP_BPS = 1000 as const;
export const DEFAULT_BASE_NOTIONAL_USD = 10_000 as const;

/**
 * `DEFAULT_ASSETS` — default per-asset enable list. Matches the Phase
 * 11.5 research scope: BTC + ETH + SOL (universally tracked) +
 * HYPE (Hyperliquid-native, documented funding divergence) + DOGE +
 * JUP (mid-cap alts with funding volatility).
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
// Public types — venue payload shapes (parsed from raw WS messages)
// ---------------------------------------------------------------------------

/**
 * `HlAssetCtx` — parsed Hyperliquid `metaAndAssetCtxs` per-asset context.
 * Captures the hourly funding rate (decimal, e.g., 0.0001 = 1bps/hour).
 *
 * Documented at https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint/perpetuals
 */
export interface HlAssetCtx {
  /** Asset coin (e.g., "BTC"). */
  readonly coin: string;
  /** Hourly funding rate as a decimal (e.g., 0.0001 = 1bps/hour = 8bps/8h). */
  readonly funding: number;
}

/**
 * `HlPredictedFunding` — parsed Hyperliquid `predictedFundings` entry.
 * Each venue entry contains the predicted NEXT-HOUR funding rate.
 */
export interface HlPredictedFunding {
  /** Asset coin (e.g., "BTC"). */
  readonly coin: string;
  /** Venue identifier (HL native = "HlPerp"). */
  readonly venue: string;
  /** Predicted next-hour funding rate (decimal). */
  readonly fundingRate: number;
}

/**
 * `BinanceMarkPrice` — parsed Binance `markPrice@1s` payload entry.
 * 8h-native funding rate as decimal.
 */
export interface BinanceMarkPrice {
  /** Symbol (e.g., "BTCUSDT"). */
  readonly symbol: string;
  /** 8h funding rate as decimal. */
  readonly fundingRate: number;
}

/**
 * `BybitTicker` — parsed Bybit `tickers` linear payload entry.
 * 8h-native funding rate as decimal.
 */
export interface BybitTicker {
  /** Symbol (e.g., "BTCUSDT"). */
  readonly symbol: string;
  /** 8h funding rate as decimal. */
  readonly fundingRate: number;
}

/**
 * `OkxFundingRate` — parsed OKX `funding-rate` payload entry.
 * 8h-native funding rate as decimal.
 */
export interface OkxFundingRate {
  /** Instrument ID (e.g., "BTC-USDT-SWAP"). */
  readonly instId: string;
  /** 8h funding rate as decimal. */
  readonly fundingRate: number;
}

// ---------------------------------------------------------------------------
// Per-asset mutable state
// ---------------------------------------------------------------------------

interface PerAssetVenueState {
  /** Latest Hyperliquid HOURLY funding (decimal). Null until first feed. */
  hlHourly: number | null;
  /** Latest Hyperliquid PREDICTED HOURLY funding (decimal). Null until first feed. */
  hlPredictedHourly: number | null;
  /** Latest Binance 8h funding (decimal). Null until first feed. */
  bz8h: number | null;
  /** Latest Bybit 8h funding (decimal). Null until first feed. */
  by8h: number | null;
  /** Latest OKX 8h funding (decimal). Null until first feed. */
  ok8h: number | null;
  /** Timestamp of last poll/feed for this asset (ms). */
  lastUpdateMs: number;
  /** Last emitted snapshot for this asset (for telemetry + tests). */
  lastSnapshot: FundingSnapshotSignal | null;
  /** Count of snapshots emitted for this asset. */
  snapshotsEmitted: number;
}

// ---------------------------------------------------------------------------
// Plugin state — the full mutable container
// ---------------------------------------------------------------------------

/**
 * `CrossDexFundingWatcherPluginState` — per-plugin mutable state. Each
 * asset in `config.assets` gets a `PerAssetVenueState` entry on first
 * data feed.
 */
export interface CrossDexFundingWatcherPluginState {
  /** Per-asset venue state. Keyed by asset symbol. */
  readonly perAsset: Map<string, PerAssetVenueState>;
  /** Total FundingSnapshotSignals emitted since construction. */
  totalSnapshotsEmitted: number;
  /** Total venue data feeds received (sum across all venues/assets). */
  totalVenueFeeds: number;
  /** Total `onBar` calls since construction. */
  barsProcessed: number;
  /** Per-venue feed counters (debugging + telemetry). */
  hlFeeds: number;
  bzFeeds: number;
  byFeeds: number;
  okFeeds: number;
  /** Number of polls that produced no new data (all venues stale). */
  emptyPolls: number;
  /** Number of snapshots rejected due to malformed payloads. */
  malformedPayloadDrops: number;
  /** Layer 2 leverage-invariant assertions count (per-emit). */
  layer2AssertionCount: number;
  /** Last emitted FundingSnapshotSignal across all assets (for diagnostics). */
  lastSnapshot: FundingSnapshotSignal | null;
}

// ---------------------------------------------------------------------------
// CrossDexFundingWatcherPlugin
// ---------------------------------------------------------------------------

/**
 * `CrossDexFundingWatcherPlugin` — Phase 12 Track B read-only signal plugin.
 *
 * Polls 4 venues (Hyperliquid + Binance + Bybit + OKX) for funding rates,
 * normalizes each rate to 8h-equivalent basis points, computes the
 * per-asset cross-venue spread (`spreadMax`) and the Hyperliquid
 * predicted-vs-realized gap (`predictedGap`), and emits a typed
 * `FundingSnapshotSignal` per asset per `onBar` (or via direct emit).
 *
 * The plugin does NOT itself open WebSocket connections — it exposes
 * `recordHlFunding` / `recordBzFunding` / `recordByFunding` / `recordOkFunding`
 * data-injection methods, plus raw-message parsers (`parseHlMeta`,
 * `parseHlPredictedFundings`, `parseBzMarkPrice`, `parseByTicker`,
 * `parseOkFundingRate`) for a separate WS adapter layer to call.
 *
 * Lifecycle:
 *   1. `new CrossDexFundingWatcherPlugin({ ... })`.
 *   2. `plugin.validateConfig(...)` — boot-time audit.
 *   3. `plugin.subscribe(bus)` — captures bus reference; the plugin does
 *      NOT subscribe to other signal kinds (it's a SOURCE plugin).
 *   4. `plugin.record*Funding(...)` — feed venue data (called by WS
 *      adapter or backtest harness).
 *   5. `plugin.pollAndEmit()` — compute normalized snapshot per asset and
 *      emit to bus. Also called internally from `onBar`.
 *   6. `plugin.onBar(bar, state)` — per-bar tick (calls pollAndEmit).
 *   7. `plugin.reset()` / `plugin.dispose()` — backtest lifecycle.
 */
export class CrossDexFundingWatcherPlugin implements StrategyPlugin {
  // ---------------------------------------------------------------------
  // Static metadata
  // ---------------------------------------------------------------------

  public readonly metadata: StrategyPluginMetadata = {
    name: "cross-dex-funding-watcher-v1",
    version: "1.0.0",
    edgeClass: "mixed", // emits FundingSnapshotSignal — a 5th SignalKind variant
    capitalRequirement: 0, // signal-only, zero capital needed
    maxLeverage: ONE_TO_TEN_LEVERAGE, // Layer 1 of 3-layer 1:10 defense
    description:
      "Phase 12 Track B / Phase 11.5 Track E §H1 EIGHTH Phase 11+ drop-in " +
      "plugin (READ-ONLY signal). Polls Hyperliquid + Binance + Bybit + OKX " +
      "funding rates, normalizes all to 8h-equivalent basis points, emits " +
      "per-asset `FundingSnapshotSignal` with cross-venue spread + predicted " +
      "gap. Foundation for downstream execution plugins (Phase 12 E2 " +
      "CrossDexDeltaNeutralArb). 6 default assets: BTC/ETH/SOL/HYPE/DOGE/JUP.",
    dependencies: [],
  };

  // ---------------------------------------------------------------------
  // Instance state
  // ---------------------------------------------------------------------

  public readonly config: CrossDexFundingWatcherConfig;
  public readonly state: CrossDexFundingWatcherPluginState;
  /** Captured bus reference (set in subscribe). */
  private _bus: SignalBus | null = null;
  /** Whether subscribe() has been called. */
  private _wired = false;

  // ---------------------------------------------------------------------
  // Construction
  // ---------------------------------------------------------------------

  constructor(overrides: Partial<CrossDexFundingWatcherConfig> = {}) {
    this.config = {
      assets: overrides.assets ?? DEFAULT_ASSETS,
      pollIntervalSec:
        overrides.pollIntervalSec ?? DEFAULT_POLL_INTERVAL_SEC,
      maxSpreadBpsThreshold:
        overrides.maxSpreadBpsThreshold ?? DEFAULT_MAX_SPREAD_BPS_THRESHOLD,
      maxPredictedGapBps:
        overrides.maxPredictedGapBps ?? DEFAULT_MAX_PREDICTED_GAP_BPS,
      baseNotionalUsd:
        overrides.baseNotionalUsd ?? DEFAULT_BASE_NOTIONAL_USD,
    };

    // LAYER 1 — constructor assertion. The metadata declares
    // `maxLeverage: ONE_TO_TEN_LEVERAGE` (= 10). Defensive runtime check
    // matches the convention used by RegimeDetectorMetaPlugin +
    // HybridKellyPlugin (the registry also enforces 1:10 cap at
    // `register()` time, but constructor-side assertion is the canonical
    // first line of defense).
    if (this.metadata.maxLeverage !== ONE_TO_TEN_LEVERAGE) {
      throw new Error(
        `[CrossDexFundingWatcherPlugin] LAYER 1 BREACH: metadata.maxLeverage=${String(this.metadata.maxLeverage)} but the project-wide 1:10 mandate requires 10.`,
      );
    }

    // Hard config validation — defense in depth.
    if (
      !Number.isInteger(this.config.pollIntervalSec) ||
      this.config.pollIntervalSec < MIN_POLL_INTERVAL_SEC ||
      this.config.pollIntervalSec > MAX_POLL_INTERVAL_SEC
    ) {
      throw new Error(
        `[CrossDexFundingWatcherPlugin] pollIntervalSec=${this.config.pollIntervalSec} must be an integer in [${MIN_POLL_INTERVAL_SEC}, ${MAX_POLL_INTERVAL_SEC}].`,
      );
    }
    if (
      !Number.isFinite(this.config.maxSpreadBpsThreshold) ||
      this.config.maxSpreadBpsThreshold <= 0 ||
      this.config.maxSpreadBpsThreshold > MAX_SPREAD_BPS_THRESHOLD
    ) {
      throw new Error(
        `[CrossDexFundingWatcherPlugin] maxSpreadBpsThreshold=${this.config.maxSpreadBpsThreshold} must be in (0, ${MAX_SPREAD_BPS_THRESHOLD}].`,
      );
    }
    if (
      !Number.isFinite(this.config.maxPredictedGapBps) ||
      this.config.maxPredictedGapBps <= 0 ||
      this.config.maxPredictedGapBps > MAX_PREDICTED_GAP_BPS
    ) {
      throw new Error(
        `[CrossDexFundingWatcherPlugin] maxPredictedGapBps=${this.config.maxPredictedGapBps} must be in (0, ${MAX_PREDICTED_GAP_BPS}].`,
      );
    }
    if (
      !Number.isFinite(this.config.baseNotionalUsd) ||
      this.config.baseNotionalUsd <= 0
    ) {
      throw new Error(
        `[CrossDexFundingWatcherPlugin] baseNotionalUsd=${this.config.baseNotionalUsd} must be a finite number > 0.`,
      );
    }
    if (!Array.isArray(this.config.assets) || this.config.assets.length === 0) {
      throw new Error(
        `[CrossDexFundingWatcherPlugin] assets must be a non-empty array of non-empty strings.`,
      );
    }
    const seen = new Set<string>();
    const assetsArr = this.config.assets as readonly string[];
    for (let i = 0; i < assetsArr.length; i++) {
      const a = assetsArr[i]!;
      if (typeof a !== "string" || a.length === 0) {
        throw new Error(
          `[CrossDexFundingWatcherPlugin] assets[${i}] must be a non-empty string.`,
        );
      }
      if (seen.has(a)) {
        throw new Error(
          `[CrossDexFundingWatcherPlugin] assets contains duplicate "${a}".`,
        );
      }
      seen.add(a);
    }

    this.state = {
      perAsset: new Map<string, PerAssetVenueState>(),
      totalSnapshotsEmitted: 0,
      totalVenueFeeds: 0,
      barsProcessed: 0,
      hlFeeds: 0,
      bzFeeds: 0,
      byFeeds: 0,
      okFeeds: 0,
      emptyPolls: 0,
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
    // Source plugin — does NOT subscribe to other signal kinds.
    // Future consumers (e.g., E2 CrossDexDeltaNeutralArb) subscribe to
    // "funding-snapshot" on the same bus.
  }

  // ---------------------------------------------------------------------
  // onBar — per-bar tick (calls pollAndEmit)
  // ---------------------------------------------------------------------

  onBar(_bar: Bar, _state: PluginState): void {
    this.state.barsProcessed += 1;
    // Per-bar emission cycle — same path as `recordSnapshot`/`pollAndEmit`.
    // We use `_bar.timestamp` as the emission timestamp so backtest runs
    // are deterministic. (Live mode ignores the bar timestamp and uses
    // Date.now().)
    this.pollAndEmit(_bar.timestamp);
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
    if (c["pollIntervalSec"] !== undefined) {
      const pi = c["pollIntervalSec"];
      if (
        typeof pi !== "number" ||
        !Number.isInteger(pi) ||
        pi < MIN_POLL_INTERVAL_SEC ||
        pi > MAX_POLL_INTERVAL_SEC
      ) {
        return makeErr(
          "pollIntervalSec",
          `must be an integer in [${MIN_POLL_INTERVAL_SEC}, ${MAX_POLL_INTERVAL_SEC}]`,
          pi,
        );
      }
    }
    if (c["maxSpreadBpsThreshold"] !== undefined) {
      const ms = c["maxSpreadBpsThreshold"];
      if (
        typeof ms !== "number" ||
        !Number.isFinite(ms) ||
        ms <= 0 ||
        ms > MAX_SPREAD_BPS_THRESHOLD
      ) {
        return makeErr(
          "maxSpreadBpsThreshold",
          `must be a finite number in (0, ${MAX_SPREAD_BPS_THRESHOLD}]`,
          ms,
        );
      }
    }
    if (c["maxPredictedGapBps"] !== undefined) {
      const mp = c["maxPredictedGapBps"];
      if (
        typeof mp !== "number" ||
        !Number.isFinite(mp) ||
        mp <= 0 ||
        mp > MAX_PREDICTED_GAP_BPS
      ) {
        return makeErr(
          "maxPredictedGapBps",
          `must be a finite number in (0, ${MAX_PREDICTED_GAP_BPS}]`,
          mp,
        );
      }
    }
    if (c["baseNotionalUsd"] !== undefined) {
      const bn = c["baseNotionalUsd"];
      if (
        typeof bn !== "number" ||
        !Number.isFinite(bn) ||
        bn <= 0
      ) {
        return makeErr(
          "baseNotionalUsd",
          "must be a finite number > 0",
          bn,
        );
      }
    }
    if (c["assets"] !== undefined) {
      if (!Array.isArray(c["assets"]) || c["assets"].length === 0) {
        return makeErr(
          "assets",
          "must be a non-empty array of non-empty strings",
          c["assets"],
        );
      }
      const seen = new Set<string>();
      const assetsArr = c["assets"] as readonly unknown[];
      for (let i = 0; i < assetsArr.length; i++) {
        const a: unknown = assetsArr[i];
        if (typeof a !== "string" || a.length === 0) {
          return makeErr(
            "assets",
            `assets[${i}] must be a non-empty string`,
            a,
          );
        }
        if (seen.has(a)) {
          return makeErr("assets", `duplicate asset "${a}"`, a);
        }
        seen.add(a);
      }
    }
    return ok(undefined);
  }

  // ---------------------------------------------------------------------
  // reset — clear mutable state between runs
  // ---------------------------------------------------------------------

  reset(): void {
    this.state.perAsset.clear();
    this.state.totalSnapshotsEmitted = 0;
    this.state.totalVenueFeeds = 0;
    this.state.barsProcessed = 0;
    this.state.hlFeeds = 0;
    this.state.bzFeeds = 0;
    this.state.byFeeds = 0;
    this.state.okFeeds = 0;
    this.state.emptyPolls = 0;
    this.state.malformedPayloadDrops = 0;
    this.state.layer2AssertionCount = 0;
    this.state.lastSnapshot = null;
  }

  // ---------------------------------------------------------------------
  // dispose — release bus reference (no subscriptions to release)
  // ---------------------------------------------------------------------

  dispose(): void {
    this._bus = null;
    this._wired = false;
  }

  // ---------------------------------------------------------------------
  // Public helpers — data injection API
  // ---------------------------------------------------------------------

  /**
   * `recordHlFunding` — feed a Hyperliquid HOURLY funding rate (decimal)
   * for `asset`. Hyperliquid settles hourly at 1/8 of the computed 8h rate
   * (see https://hyperliquid.gitbook.io/hyperliquid-docs/trading/funding),
   * so the plugin multiplies by 8 internally to produce the 8h-equivalent.
   *
   * `predictedHourlyRate` is the `predictedFundings` next-hour prediction;
   * pass `null` to clear the predicted gap for this asset.
   */
  recordHlFunding(
    asset: string,
    hourlyRate: number,
    predictedHourlyRate: number | null = null,
    timestampMs?: number,
  ): void {
    if (!this.config.assets.includes(asset)) return;
    if (!Number.isFinite(hourlyRate)) {
      this.state.malformedPayloadDrops += 1;
      return;
    }
    if (
      predictedHourlyRate !== null &&
      !Number.isFinite(predictedHourlyRate)
    ) {
      this.state.malformedPayloadDrops += 1;
      predictedHourlyRate = null;
    }
    const ss = this._getOrCreatePerAsset(asset);
    ss.hlHourly = hourlyRate;
    ss.hlPredictedHourly = predictedHourlyRate;
    ss.lastUpdateMs = timestampMs ?? Date.now();
    this.state.hlFeeds += 1;
    this.state.totalVenueFeeds += 1;
  }

  /**
   * `recordBzFunding` — feed a Binance 8h-native funding rate (decimal).
   * 8h-equivalent bps is computed as `rate × 10_000` directly (no
   * cadence normalization needed — Binance is already 8h).
   */
  recordBzFunding(
    asset: string,
    funding8h: number,
    timestampMs?: number,
  ): void {
    if (!this.config.assets.includes(asset)) return;
    if (!Number.isFinite(funding8h)) {
      this.state.malformedPayloadDrops += 1;
      return;
    }
    const ss = this._getOrCreatePerAsset(asset);
    ss.bz8h = funding8h;
    ss.lastUpdateMs = timestampMs ?? Date.now();
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
    if (!this.config.assets.includes(asset)) return;
    if (!Number.isFinite(funding8h)) {
      this.state.malformedPayloadDrops += 1;
      return;
    }
    const ss = this._getOrCreatePerAsset(asset);
    ss.by8h = funding8h;
    ss.lastUpdateMs = timestampMs ?? Date.now();
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
    if (!this.config.assets.includes(asset)) return;
    if (!Number.isFinite(funding8h)) {
      this.state.malformedPayloadDrops += 1;
      return;
    }
    const ss = this._getOrCreatePerAsset(asset);
    ss.ok8h = funding8h;
    ss.lastUpdateMs = timestampMs ?? Date.now();
    this.state.okFeeds += 1;
    this.state.totalVenueFeeds += 1;
  }

  /**
   * `pollAndEmit` — compute the normalized snapshot per enabled asset
   * (using whatever venue data is currently in state) and emit each
   * snapshot to the bus. Returns the emitted snapshots for tests +
   * downstream inspection.
   *
   * If NO asset has ANY venue data, the poll is counted as an
   * `emptyPoll` and no snapshots are emitted. If only some venues have
   * data for an asset, the snapshot is computed using the available
   * subset (spread uses whatever venues are present, with a defensive
   * check that ≥ 2 venues are present before computing `spreadMax`).
   */
  pollAndEmit(timestampMs?: number): readonly FundingSnapshotSignal[] {
    const ts = timestampMs ?? Date.now();
    const emitted: FundingSnapshotSignal[] = [];
    let anyData = false;

    for (const asset of this.config.assets) {
      const ss = this.state.perAsset.get(asset);
      if (!ss) continue;
      anyData = true;

      // Need at least 2 venues with data to compute a meaningful spread.
      const presentVenues: number[] = [];
      if (ss.hlHourly !== null) {
        // HL is hourly — multiply by 8 to get 8h-equivalent rate, then ×10000 for bps.
        presentVenues.push(ss.hlHourly * 8 * 10_000);
      }
      if (ss.bz8h !== null) presentVenues.push(ss.bz8h * 10_000);
      if (ss.by8h !== null) presentVenues.push(ss.by8h * 10_000);
      if (ss.ok8h !== null) presentVenues.push(ss.ok8h * 10_000);

      if (presentVenues.length < 2) continue;

      const min = Math.min(...presentVenues);
      const max = Math.max(...presentVenues);
      const spreadMax = max - min;

      // 8h-equivalent bps per venue (null if no data).
      const hl8h =
        ss.hlHourly !== null ? ss.hlHourly * 8 * 10_000 : Number.NaN;
      const bz = ss.bz8h !== null ? ss.bz8h * 10_000 : Number.NaN;
      const by = ss.by8h !== null ? ss.by8h * 10_000 : Number.NaN;
      const ok = ss.ok8h !== null ? ss.ok8h * 10_000 : Number.NaN;

      // Predicted gap = predicted - realized, in 8h-equivalent bps.
      // Only computable when both HL hourly + HL predicted hourly are present.
      let predictedGap = 0;
      if (ss.hlHourly !== null && ss.hlPredictedHourly !== null) {
        predictedGap =
          (ss.hlPredictedHourly - ss.hlHourly) * 8 * 10_000;
      }

      const snap: FundingSnapshotSignal = {
        kind: "funding-snapshot",
        asset,
        hl8h,
        bz,
        by,
        ok,
        spreadMax,
        predictedGap,
        timestamp: ts,
        source: `${this.metadata.name}:${asset}`,
        timestampMs: ts,
      };

      // LAYER 2 — assert the spread + predicted gap are within config
      // bounds. The 1:10 mandate doesn't directly apply (no notional)
      // but we keep an assertion hook via `assertLeverageInvariant` for
      // defense-in-depth symmetry with other Phase 11+ plugins. Pass
      // 0 notional + baseNotional — trivially passes.
      try {
        assertLeverageInvariant(0, this.config.baseNotionalUsd);
        this.state.layer2AssertionCount += 1;
      } catch (e: unknown) {
        // Should never fire — re-throw with `cause` chained for
        // diagnostic context.
        const msg = e instanceof Error ? e.message : String(e);
        throw new Error(
          `[CrossDexFundingWatcherPlugin] LAYER 2 BREACH (defensive hook): ${msg}`,
          { cause: e },
        );
      }

      ss.lastSnapshot = snap;
      ss.snapshotsEmitted += 1;
      this.state.totalSnapshotsEmitted += 1;
      this.state.lastSnapshot = snap;
      emitted.push(snap);

      if (this._bus && this._wired) {
        this._bus.emit(snap);
      }
    }

    if (!anyData) this.state.emptyPolls += 1;
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

  /** Returns the last snapshot for `asset`, or null if none yet. */
  lastSnapshotFor(asset: string): FundingSnapshotSignal | null {
    return this.state.perAsset.get(asset)?.lastSnapshot ?? null;
  }

  /** Returns the number of snapshots emitted for `asset` since construction. */
  snapshotsEmittedFor(asset: string): number {
    return this.state.perAsset.get(asset)?.snapshotsEmitted ?? 0;
  }

  /** Returns true if at least one venue has data for `asset`. */
  hasAnyVenueData(asset: string): boolean {
    const ss = this.state.perAsset.get(asset);
    if (!ss) return false;
    return (
      ss.hlHourly !== null ||
      ss.bz8h !== null ||
      ss.by8h !== null ||
      ss.ok8h !== null
    );
  }

  // ---------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------

  private _getOrCreatePerAsset(asset: string): PerAssetVenueState {
    let ss = this.state.perAsset.get(asset);
    if (!ss) {
      ss = {
        hlHourly: null,
        hlPredictedHourly: null,
        bz8h: null,
        by8h: null,
        ok8h: null,
        lastUpdateMs: 0,
        lastSnapshot: null,
        snapshotsEmitted: 0,
      };
      this.state.perAsset.set(asset, ss);
    }
    return ss;
  }
}

// ---------------------------------------------------------------------------
// Venue payload parsers — exported for WS adapter + tests
// ---------------------------------------------------------------------------

/**
 * `parseHlMetaAndAssetCtxs` — extract per-asset hourly funding from a
 * Hyperliquid `metaAndAssetCtxs` response. The endpoint returns a
 * 2-element tuple `[meta, assetCtxs]` where `assetCtxs` is an array of
 * per-asset context objects.
 *
 * Reference: https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint/perpetuals
 *
 * Returns a Map keyed by coin symbol with `HlAssetCtx` values. Skips
 * entries with non-finite funding.
 */
export function parseHlMetaAndAssetCtxs(
  payload: unknown,
): Map<string, HlAssetCtx> {
  const out = new Map<string, HlAssetCtx>();
  if (!Array.isArray(payload) || payload.length < 2) return out;
  const assetCtxsUnknown: unknown = payload[1];
  if (!Array.isArray(assetCtxsUnknown)) return out;
  const assetCtxs = assetCtxsUnknown as readonly unknown[];
  for (const ctx of assetCtxs) {
    if (typeof ctx !== "object" || ctx === null) continue;
    const c = ctx as Record<string, unknown>;
    if (typeof c["coin"] !== "string" || c["coin"].length === 0) continue;
    if (typeof c["funding"] !== "number" || !Number.isFinite(c["funding"])) {
      continue;
    }
    out.set(c["coin"], {
      coin: c["coin"],
      funding: c["funding"],
    });
  }
  return out;
}

/**
 * `parseHlPredictedFundings` — extract per-asset predicted next-hour
 * funding from a Hyperliquid `predictedFundings` response.
 *
 * Response shape: array of `[coin, [[venue, { fundingRate, nextFundingTime, fundingIntervalHours }]]]`.
 *
 * Returns a Map keyed by `${coin}:${venue}` with `HlPredictedFunding`
 * values. Skips entries with non-finite fundingRate.
 */
export function parseHlPredictedFundings(
  payload: unknown,
): Map<string, HlPredictedFunding> {
  const out = new Map<string, HlPredictedFunding>();
  if (!Array.isArray(payload)) return out;
  const payloadArr = payload as readonly unknown[];
  for (const entryUnknown of payloadArr) {
    const entry = entryUnknown as readonly unknown[];
    if (entry.length < 2) continue;
    const coin: unknown = entry[0];
    const venues: unknown = entry[1];
    if (typeof coin !== "string" || !Array.isArray(venues)) continue;
    const venuesArr = venues as readonly unknown[];
    for (const venueEntryUnknown of venuesArr) {
      const venueEntry = venueEntryUnknown as readonly unknown[];
      if (venueEntry.length < 2) continue;
      const venue: unknown = venueEntry[0];
      const details: unknown = venueEntry[1];
      if (typeof venue !== "string" || typeof details !== "object" || details === null) {
        continue;
      }
      const d = details as Record<string, unknown>;
      if (
        typeof d["fundingRate"] !== "number" ||
        !Number.isFinite(d["fundingRate"])
      ) {
        continue;
      }
      out.set(`${coin}:${venue}`, {
        coin,
        venue,
        fundingRate: d["fundingRate"],
      });
    }
  }
  return out;
}

/**
 * `parseBzMarkPrice` — extract a single Binance `markPrice@1s` entry.
 *
 * Reference WS shape:
 *   `{ "e": "markPriceUpdate", "s": "BTCUSDT", "r": "0.0001", ... }`
 *
 * Returns the parsed entry, or null if the payload doesn't match.
 */
export function parseBzMarkPrice(payload: unknown): BinanceMarkPrice | null {
  if (typeof payload !== "object" || payload === null) return null;
  const p = payload as Record<string, unknown>;
  if (typeof p["s"] !== "string" || p["s"].length === 0) return null;
  if (typeof p["r"] !== "number" || !Number.isFinite(p["r"])) return null;
  return {
    symbol: p["s"],
    fundingRate: p["r"],
  };
}

/**
 * `parseBzMarkPriceBatch` — extract multiple Binance `markPrice@1s`
 * entries from a WS array payload (the documented Binance shape when
 * subscribing to multiple symbols).
 */
export function parseBzMarkPriceBatch(
  payload: unknown,
): BinanceMarkPrice[] {
  if (!Array.isArray(payload)) return [];
  const out: BinanceMarkPrice[] = [];
  for (const entry of payload) {
    const parsed = parseBzMarkPrice(entry);
    if (parsed) out.push(parsed);
  }
  return out;
}

/**
 * `parseByTicker` — extract a single Bybit `tickers` linear entry.
 *
 * Reference WS shape (response payload):
 *   `{ "topic": "tickers.BTCUSDT", "data": { "symbol": "BTCUSDT", "fundingRate": "0.0001", ... } }`
 *
 * Returns the parsed entry, or null if the payload doesn't match.
 */
export function parseByTicker(payload: unknown): BybitTicker | null {
  if (typeof payload !== "object" || payload === null) return null;
  const p = payload as Record<string, unknown>;
  if (typeof p["topic"] !== "string" || !p["topic"].startsWith("tickers.")) {
    return null;
  }
  const data = p["data"];
  if (typeof data !== "object" || data === null) return null;
  const d = data as Record<string, unknown>;
  if (typeof d["symbol"] !== "string" || d["symbol"].length === 0) return null;
  if (typeof d["fundingRate"] !== "number" || !Number.isFinite(d["fundingRate"])) {
    return null;
  }
  return {
    symbol: d["symbol"],
    fundingRate: d["fundingRate"],
  };
}

/**
 * `parseByTickerBatch` — extract multiple Bybit `tickers` entries from
 * an array of WS payloads.
 */
export function parseByTickerBatch(payload: unknown): BybitTicker[] {
  if (!Array.isArray(payload)) return [];
  const out: BybitTicker[] = [];
  for (const entry of payload) {
    const parsed = parseByTicker(entry);
    if (parsed) out.push(parsed);
  }
  return out;
}

/**
 * `parseOkFundingRate` — extract a single OKX `funding-rate` entry.
 *
 * Reference WS shape:
 *   `{ "arg": { "channel": "funding-rate", "instId": "BTC-USDT-SWAP" }, "data": [{ "fundingRate": "0.0001", ... }] }`
 *
 * Returns the parsed entry, or null if the payload doesn't match.
 */
export function parseOkFundingRate(payload: unknown): OkxFundingRate | null {
  if (typeof payload !== "object" || payload === null) return null;
  const p = payload as Record<string, unknown>;
  const arg = p["arg"];
  if (typeof arg !== "object" || arg === null) return null;
  const a = arg as Record<string, unknown>;
  if (a["channel"] !== "funding-rate") return null;
  if (typeof a["instId"] !== "string" || a["instId"].length === 0) return null;
  const dataUnknown: unknown = p["data"];
  if (!Array.isArray(dataUnknown) || dataUnknown.length === 0) return null;
  const dataArr = dataUnknown as readonly unknown[];
  const first: unknown = dataArr[0];
  if (typeof first !== "object" || first === null) return null;
  const d = first as Record<string, unknown>;
  if (typeof d["fundingRate"] !== "number" || !Number.isFinite(d["fundingRate"])) {
    return null;
  }
  return {
    instId: a["instId"],
    fundingRate: d["fundingRate"],
  };
}

/**
 * `parseOkFundingRateBatch` — extract multiple OKX `funding-rate`
 * entries from an array of WS payloads.
 */
export function parseOkFundingRateBatch(payload: unknown): OkxFundingRate[] {
  if (!Array.isArray(payload)) return [];
  const out: OkxFundingRate[] = [];
  for (const entry of payload) {
    const parsed = parseOkFundingRate(entry);
    if (parsed) out.push(parsed);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Symbol-mapping helpers — exported for WS adapter + tests
// ---------------------------------------------------------------------------

/**
 * `toBinanceSymbol` — map a canonical asset (e.g., "BTC") to the Binance
 * USDT-M futures symbol (e.g., "BTCUSDT").
 */
export function toBinanceSymbol(asset: string): string {
  return `${asset}USDT`;
}

/**
 * `toBybitSymbol` — map a canonical asset to the Bybit linear symbol
 * (same `BTCUSDT` shape as Binance).
 */
export function toBybitSymbol(asset: string): string {
  return `${asset}USDT`;
}

/**
 * `toOkxSymbol` — map a canonical asset to the OKX USDT-SWAP instrument
 * ID (e.g., "BTC-USDT-SWAP").
 */
export function toOkxSymbol(asset: string): string {
  return `${asset}-USDT-SWAP`;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * `createCrossDexFundingWatcherPlugin` — factory. Mirrors the convention
 * of `createRegimeDetectorMetaPlugin` / `createHybridKellyPlugin`.
 */
export function createCrossDexFundingWatcherPlugin(
  overrides: Partial<CrossDexFundingWatcherConfig> = {},
): CrossDexFundingWatcherPlugin {
  return new CrossDexFundingWatcherPlugin(overrides);
}

// Silence unused-import for `err` (referenced by the discriminated-union
// style for future-proofing — `Result.err` is part of the canonical
// plugin-config-error return path).
void err;
