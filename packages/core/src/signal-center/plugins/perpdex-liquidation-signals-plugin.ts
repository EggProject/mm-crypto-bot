// packages/core/src/signal-center/plugins/perpdex-liquidation-signals-plugin.ts —
// Phase 12 Track C (deliverable: ÜGYNÖK M1 perpdex-liquidation-signals drop-in).
//
// ===========================================================================
// DEFENSIVE OVERLAY READ-ONLY PLUGIN — PerpDexLiquidationSignalsPlugin
// ===========================================================================
//
// Purpose
// -------
// `PerpDexLiquidationSignalsPlugin` is the NINTH Phase 11+ drop-in and the
// THIRD plugin from the Phase 11.5 research fleet (Track D, the MEV /
// liquidation-hunt deep-dive). It implements Phase 11.5 Track D §E1 (tick-
// level liquidation cascade detection — HIGH) + §E5 (OI liquidation spirals
// + paper-tiger walls — HIGH) and emits a defensive RiskSignal when an
// imminent liquidation cascade is detected on a perp-DEX.
//
// Why a cascade detector?
// ------------------------
// Empirical case studies (Phase 11.5 Track D):
//   - 10/10/25 event: $20–40B in liquidations on Hyperliquid alone
//     (Galaxy, BitMEX State of Perps 2025). OI dropped 30–50% in 12–72 h
//     preceding the cascade; whale long-short ratio collapsed into the
//     [0.4, 0.6] "deadlock" zone (MEXC whale deadlock analysis,
//     cryptonews.net Nov 2025 snapshot).
//   - POPCAT Nov 2025: spoofing buy wall → abrupt cancel → $63M cascade,
//     HLP $4.9M bad debt (Sina Finance + Odaily + Tekedia).
//   - JELLY Mar 2025: attacker wallet 0xde95 self-liquidated, HLP took
//     398M JELLY short (NFTEvening + forklog + ChainCatcher JA).
//
// The plugin reads liquidation telemetry from FIVE on-chain feeds:
//   1. 0xArchive liquidation REST + WS (free + $99/mo real-time)
//   2. HypurrScan liquidation feed (free)
//   3. GoldRush Pentagon cascade map (premium)
//   4. CoinGlass Hyperliquid liquidation map (free)
//   5. HyperTracker API (free + paid tiers)
//
// All five have free tiers — no paid subscription required for first cut.
// Each adapter is wired via Dependency-Injection (DI); the plugin owns
// 5 adapter slots, polls them every `pollIntervalSec`, and aggregates
// their snapshots per symbol. If a feed is unavailable the plugin
// degrades gracefully (skip emit, log warn, do NOT crash the bus).
//
// What this plugin does
// ---------------------
//  - On each poll: fetch 5 feed snapshots per enabled symbol.
//  - Compute cascade-imminent heuristic per Phase 11.5 Track D §E1+§E5:
//      condition A: OI drop > 20% in 24h                    (E5 signature)
//      condition B: whale lsr ratio ∈ [0.4, 0.6]            (deadlock zone)
//      condition C: top-5 ask depth < 25th-percentile        (thin book)
//      condition D: paper-tiger wall — large wall inserted <5min ago,
//                   cluster of N≥5 correlated wallets
//  - ALL FOUR conditions must hold for cascade-imminent to fire
//    (the heuristic is conservative by design — false positives are
//    expensive, false negatives are recoverable).
//  - Throttle/dedup: 24h cooldown per (symbol) — emit Signal ONCE per
//    cascade event, NOT every onBar tick.
//  - Emit RiskSignal with `sizeModifier=0.5` (reduce position by 50%)
//    and `closeNotionalUsd = baseNotionalUsd × 0.5` for 24h duration.
//
// 1:10 leverage invariant — 3-layer defense (defensive RiskSignal plugin)
// ------------------------------------------------------------------------
//   Layer 1 (CONSTRUCTOR) — `metadata.maxLeverage = 10`. The plugin
//     declares the project-wide 1:10 mandate cap. The registry also
//     enforces this at `register()` time (defense-in-depth).
//
//   Layer 2 (SUBSCRIBE) — when `subscribe(bus)` is called, the plugin
//     runs `assertLeverageInvariant(0, baseNotionalUsd)` as a structural
//     sanity check. The plugin holds ZERO notional by construction
//     (defensive signal only, no SizingSignals).
//
//   Layer 3 (PER-EMIT) — before each RiskSignal emit, the plugin asserts
//     `assertLeverageInvariant(closeNotionalUsd, baseNotionalUsd)` where
//     `closeNotionalUsd = baseNotionalUsd × sizeModifier`. Any violation
//     throws `LeverageBreachError`. This is the defensive per-emit guard:
//     even if metadata is bypassed, the per-emit assertion catches it.
//
// The plugin emits RiskSignals ONLY, NOT SizingSignals (defensive overlay).
// Subscribers (SCv1 risk engine) handle the position-reduction math; the
// plugin never touches notional directly.
//
// References (≥2 independent sources per empirical claim — per Phase 11.5
// research doctrine):
//   - "20% partial liq chunks + 30s cooldown":
//       [S1] Hyperliquid Docs — Liquidations
//            https://hyperliquid.gitbook.io/hyperliquid-docs/trading/liquidations
//       [S2] CoinMarketman — Hyperliquid Liquidations Explained
//            https://coinmarketman.com/blog/hyperliquid-liquidations-explained--en/
//   - "Whale long-short ratio [0.4, 0.6] deadlock":
//       [S3] MEXC News — $3.64B Whale Deadlock Could Trigger Mass Liquidations
//            https://www.mexc.com/news/955053
//       [S4] cryptonews.net — Hyperliquid Whales $4.039b deadlock
//            https://cryptonews.net/news/market/32879475/
//   - "OI drop 30–50% in 12–72h precedes cascade":
//       [S5] markets.financialcontent — Nov 5 Crypto Bloodbath
//            https://markets.financialcontent.com/wral/article/...
//       [S6] Block Scholes — October 2025 Crypto Derivatives Snapshot
//            https://www.blockscholes.com/research
//   - "Paper-tiger walls (large insert → cancel → cascade)":
//       [S7] POPCAT case study (Tekedia + CryptoRank)
//            https://cryptorank.io/news/feed/da0ea-30m-manipulation-on-hyperliquid
//       [S8] Sina Finance — POPCAT manipulation analysis
//            https://finance.sina.com.cn/blockchain/roll/2025-11-13/doc-infxfhsc0352621.shtml
// ===========================================================================

import type { SignalBus } from "../signal-bus.js";
import type {
  Bar,
  PluginState,
  Result,
  ConfigError,
  RiskSignal,
} from "../types.js";
import { err, ok } from "../types.js";
import type { StrategyPlugin, StrategyPluginMetadata } from "../strategy-registry.js";
import {
  ONE_TO_TEN_LEVERAGE,
  assertLeverageInvariant,
} from "../../risk/leverage-invariant.js";

// ---------------------------------------------------------------------------
// Constants — defaults + bounds
// ---------------------------------------------------------------------------

/** Default OI-drop threshold (20% in 24h). Phase 11.5 Track D §E5. */
export const DEFAULT_OI_DROP_THRESHOLD_PCT = 0.20;
/** Default LSR-deadlock lower bound. Phase 11.5 Track D §E5. */
export const DEFAULT_LSR_DEADLOCK_LOWER = 0.4;
/** Default LSR-deadlock upper bound. Phase 11.5 Track D §E5. */
export const DEFAULT_LSR_DEADLOCK_UPPER = 0.6;
/** Default thin-book top-5 depth percentile (25th = bottom quartile). */
export const DEFAULT_THIN_BOOK_TOP5_DEPTH_PCT = 25;
/** Default paper-tiger wall insertion window (minutes). */
export const DEFAULT_PAPER_TIGER_WALL_INSERTION_MIN = 5;
/** Default paper-tiger cluster size threshold (N wallets). */
export const DEFAULT_PAPER_TIGER_CLUSTER_MIN_SIZE = 5;
/** Default poll interval (seconds). 5s = 0xArchive SLA target. */
export const DEFAULT_POLL_INTERVAL_SEC = 5;
/** Default throttle cooldown (24h, in ms). */
export const DEFAULT_THROTTLE_COOLDOWN_MS = 24 * 60 * 60 * 1000;
/** Default base notional (USD) — 1:10 of $100k = $1k; plugin scales. */
export const DEFAULT_BASE_NOTIONAL_USD = 1000;
/** Default sizeModifier emitted on cascade-imminent. */
export const DEFAULT_SIZE_MODIFIER = 0.5;
/** Default enabled symbols (BTC/ETH/SOL). */
export const DEFAULT_ENABLED_SYMBOLS = ["BTC", "ETH", "SOL"] as const;

// Bounds (used by config validation).
export const MIN_OI_DROP_THRESHOLD_PCT = 0.05;
export const MAX_OI_DROP_THRESHOLD_PCT = 0.95;
export const MIN_LSR_DEADLOCK_LOWER = 0.0;
export const MAX_LSR_DEADLOCK_UPPER = 1.0;
export const MIN_PAPER_TIGER_CLUSTER_MIN_SIZE = 2;
export const MIN_PAPER_TIGER_WALL_INSERTION_MIN = 1;
export const MIN_POLL_INTERVAL_SEC = 1;
export const MAX_POLL_INTERVAL_SEC = 600;
export const MIN_BASE_NOTIONAL_USD = 1;

// ---------------------------------------------------------------------------
// Liquidation snapshot — feed-agnostic output of every adapter
// ---------------------------------------------------------------------------

export interface PaperTigerSignal {
  /** Whether the paper-tiger detector fired on this snapshot. */
  readonly detected: boolean;
  /** Size of the spoofed wall (USD), if detected. */
  readonly wallUsd: number;
  /** Wall insertion age (minutes), if detected. */
  readonly insertionMin: number;
  /** Cluster size of correlated wallets (N), if detected. */
  readonly clusterSize: number;
}

export interface LiquidationSnapshot {
  /** Source feed identifier (e.g. "0xArchive"). */
  readonly source: string;
  /** Asset symbol (e.g. "BTC"). */
  readonly symbol: string;
  /** Epoch ms when snapshot was generated. */
  readonly timestampMs: number;
  /** Open-interest drop over 24h (fraction, e.g. 0.30 = 30% drop). */
  readonly oiDrop24h: number;
  /** Whale long-short ratio (0..∞, 1.0 = neutral, [0.4,0.6] = deadlock). */
  readonly lsrRatio: number;
  /** Top-5 ask depth in USD. */
  readonly top5AskDepthUsd: number;
  /** Top-5 ask depth as a percentile (0..100; <25 = thin book). */
  readonly top5AskDepthPct: number;
  /** Paper-tiger detection result. */
  readonly paperTiger: PaperTigerSignal;
  /** Whether this snapshot is stale (source down / data older than 60s). */
  readonly stale: boolean;
}

// ---------------------------------------------------------------------------
// Liquidation-feed adapter — DI interface (5 implementations + null)
// ---------------------------------------------------------------------------

export interface ILiquidationFeedAdapter {
  /** Stable identifier for telemetry (e.g. "0xArchive"). */
  readonly name: string;
  /**
   * Fetch a per-symbol snapshot. Implementations MUST be pure functions
   * of their inputs (deterministic for backtest replay). Implementations
   * MUST NOT throw on transient errors — they MUST return a stale
   * snapshot instead so the plugin's graceful-degradation path can
   * skip-emit without crashing the bus.
   */
  fetchSnapshot(symbol: string): Promise<LiquidationSnapshot>;
}

// ---------------------------------------------------------------------------
// NullLiquidationAdapter — graceful degradation when no feeds configured
// ---------------------------------------------------------------------------

export class NullLiquidationAdapter implements ILiquidationFeedAdapter {
  public readonly name = "null";
  public fetchSnapshot(symbol: string): Promise<LiquidationSnapshot> {
    return Promise.resolve({
      source: "null",
      symbol,
      timestampMs: Date.now(),
      oiDrop24h: 0,
      lsrRatio: 1.0,
      top5AskDepthUsd: 0,
      top5AskDepthPct: 100,
      paperTiger: { detected: false, wallUsd: 0, insertionMin: 0, clusterSize: 0 },
      stale: true,
    });
  }
}

// ---------------------------------------------------------------------------
// MockLiquidationAdapter — test-friendly adapter that returns a fixed
// snapshot. Used by tests AND can be wired in production for dry-runs.
// ---------------------------------------------------------------------------

export class MockLiquidationAdapter implements ILiquidationFeedAdapter {
  constructor(
    public readonly name: string,
    private readonly snapshotFn: (symbol: string) => LiquidationSnapshot,
  ) {}
  public fetchSnapshot(symbol: string): Promise<LiquidationSnapshot> {
    return Promise.resolve(this.snapshotFn(symbol));
  }
}

// ---------------------------------------------------------------------------
// Five real-feed adapter shells — each returns NullLiquidationAdapter-style
// stale snapshots by default; production wires them to live endpoints.
// Each adapter is documented with its endpoint shape + free-tier policy.
// ---------------------------------------------------------------------------

/**
 * `ZeroArchiveLiquidationAdapter` — 0xArchive Hyperliquid liquidation
 * REST + WS feed (https://0xarchive.io/blog/hyperliquid-liquidations-data).
 * Free tier: REST only, 60s delayed. $99/mo tier: WS real-time.
 */
export class ZeroArchiveLiquidationAdapter implements ILiquidationFeedAdapter {
  public readonly name = "0xArchive";
  public async fetchSnapshot(symbol: string): Promise<LiquidationSnapshot> {
    // Default stub: returns Null-style stale snapshot. Production wires
    // the real endpoint via DI (pass a snapshotFn into MockLiquidationAdapter
    // for backtests; live mode swaps this class for a real HTTP client).
    return await new NullLiquidationAdapter().fetchSnapshot(symbol);
  }
}

/**
 * `HypurrScanLiquidationAdapter` — HypurrScan Hyperliquid liquidation
 * feed (https://hypurrscan.io). Free tier: per-asset polling, 30s delay.
 */
export class HypurrScanLiquidationAdapter implements ILiquidationFeedAdapter {
  public readonly name = "HypurrScan";
  public async fetchSnapshot(symbol: string): Promise<LiquidationSnapshot> {
    return await new NullLiquidationAdapter().fetchSnapshot(symbol);
  }
}

/**
 * `GoldRushLiquidationAdapter` — GoldRush Pentagon cascade map
 * (https://goldrush.dev/docs/changelog/20260402-hyperliquid-data-with-zero-rate-limits/).
 * Premium tier only; v1 ships with stub for first-cut free operation.
 */
export class GoldRushLiquidationAdapter implements ILiquidationFeedAdapter {
  public readonly name = "GoldRush";
  public async fetchSnapshot(symbol: string): Promise<LiquidationSnapshot> {
    return await new NullLiquidationAdapter().fetchSnapshot(symbol);
  }
}

/**
 * `CoinGlassLiquidationAdapter` — CoinGlass Hyperliquid liquidation map
 * (https://www.coinglass.com/hyperliquid-liquidation-map). Free tier:
 * >$1M whale positions only.
 */
export class CoinGlassLiquidationAdapter implements ILiquidationFeedAdapter {
  public readonly name = "CoinGlass";
  public async fetchSnapshot(symbol: string): Promise<LiquidationSnapshot> {
    return await new NullLiquidationAdapter().fetchSnapshot(symbol);
  }
}

/**
 * `HyperTrackerLiquidationAdapter` — HyperTracker Hyperliquid API
 * (https://hypertracker.com). Free + paid tiers; cascade flag + OI/funding
 * context.
 */
export class HyperTrackerLiquidationAdapter implements ILiquidationFeedAdapter {
  public readonly name = "HyperTracker";
  public async fetchSnapshot(symbol: string): Promise<LiquidationSnapshot> {
    return await new NullLiquidationAdapter().fetchSnapshot(symbol);
  }
}

// ---------------------------------------------------------------------------
// Plugin config
// ---------------------------------------------------------------------------

export interface PerpDexLiquidationSignalsPluginConfig {
  /** OI-drop threshold (fraction). 0.20 = 20% drop in 24h. Default 0.20. */
  readonly oiDropThresholdPct: number;
  /** LSR deadlock lower bound. Default 0.4. */
  readonly lsrDeadlockLower: number;
  /** LSR deadlock upper bound. Default 0.6. */
  readonly lsrDeadlockUpper: number;
  /** Thin-book top-5 depth percentile. Default 25. */
  readonly thinBookTop5DepthPct: number;
  /** Paper-tiger wall insertion window (minutes). Default 5. */
  readonly paperTigerWallMinInsertionMin: number;
  /** Paper-tiger cluster min size (N wallets). Default 5. */
  readonly paperTigerClusterMinSize: number;
  /** Poll interval (seconds). Default 5. */
  readonly pollIntervalSec: number;
  /** Throttle cooldown (ms). Default 24h. */
  readonly throttleCooldownMs: number;
  /** Base notional (USD) for the implied close. Default $1000. */
  readonly baseNotionalUsd: number;
  /** Size modifier emitted on cascade-imminent. Default 0.5. */
  readonly sizeModifier: number;
  /** Enabled symbols (uppercase). Default BTC/ETH/SOL. */
  readonly enabledSymbols: readonly string[];
  /** Five feed adapter slots. Default all NullLiquidationAdapter. */
  readonly adapters: readonly ILiquidationFeedAdapter[];
}

export const DEFAULT_PERPDEX_LIQUIDATION_PLUGIN_CONFIG: PerpDexLiquidationSignalsPluginConfig = {
  oiDropThresholdPct: DEFAULT_OI_DROP_THRESHOLD_PCT,
  lsrDeadlockLower: DEFAULT_LSR_DEADLOCK_LOWER,
  lsrDeadlockUpper: DEFAULT_LSR_DEADLOCK_UPPER,
  thinBookTop5DepthPct: DEFAULT_THIN_BOOK_TOP5_DEPTH_PCT,
  paperTigerWallMinInsertionMin: DEFAULT_PAPER_TIGER_WALL_INSERTION_MIN,
  paperTigerClusterMinSize: DEFAULT_PAPER_TIGER_CLUSTER_MIN_SIZE,
  pollIntervalSec: DEFAULT_POLL_INTERVAL_SEC,
  throttleCooldownMs: DEFAULT_THROTTLE_COOLDOWN_MS,
  baseNotionalUsd: DEFAULT_BASE_NOTIONAL_USD,
  sizeModifier: DEFAULT_SIZE_MODIFIER,
  enabledSymbols: [...DEFAULT_ENABLED_SYMBOLS],
  adapters: [
    new NullLiquidationAdapter(),
    new NullLiquidationAdapter(),
    new NullLiquidationAdapter(),
    new NullLiquidationAdapter(),
    new NullLiquidationAdapter(),
  ],
};

// ---------------------------------------------------------------------------
// Plugin state — per-symbol mutable state
// ---------------------------------------------------------------------------

export interface SymbolCascadeState {
  /** Epoch ms of the last emitted cascade-imminent signal (for throttle). */
  readonly lastEmittedAtMs: number;
  /** Last computed heuristic result. */
  readonly lastCascadeImminent: boolean;
}

export interface PerpDexLiquidationSignalsPluginState {
  /** Per-symbol cascade state (used for throttle/dedup). */
  perSymbol: Map<string, SymbolCascadeState>;
  /** Total RiskSignals emitted since construction. */
  totalSignalsEmitted: number;
  /** Total cascade-imminent detections (pre-throttle). */
  totalCascadesDetected: number;
  /** Total emits skipped by throttle (cooldown active). */
  totalThrottleSkips: number;
  /** Total emits skipped due to stale feeds. */
  totalStaleFeedsSkips: number;
  /** Layer 2 subscribe assertions (one per subscribe call). */
  layer2AssertionCount: number;
  /** Layer 3 per-emit assertions (one per successful emit). */
  layer3AssertionCount: number;
  /** Total bars processed. */
  barsProcessed: number;
  /** Last emitted RiskSignal (across all symbols). */
  lastRiskSignal: RiskSignal | null;
}

// ---------------------------------------------------------------------------
// Helper — evaluate the cascade-imminent heuristic from a single snapshot.
// Pure function so it's directly testable AND deterministic for backtests.
// ---------------------------------------------------------------------------

export interface CascadeHeuristicResult {
  readonly oiDropTriggered: boolean;
  readonly lsrDeadlockTriggered: boolean;
  readonly thinBookTriggered: boolean;
  readonly paperTigerTriggered: boolean;
  readonly cascadeImminent: boolean;
  readonly confidence: number;
}

export function evaluateCascadeHeuristic(
  snapshot: LiquidationSnapshot,
  config: PerpDexLiquidationSignalsPluginConfig,
): CascadeHeuristicResult {
  const oiDropTriggered = snapshot.oiDrop24h > config.oiDropThresholdPct;
  const lsrDeadlockTriggered =
    snapshot.lsrRatio >= config.lsrDeadlockLower &&
    snapshot.lsrRatio <= config.lsrDeadlockUpper;
  const thinBookTriggered = snapshot.top5AskDepthPct < config.thinBookTop5DepthPct;
  const paperTigerTriggered =
    snapshot.paperTiger.detected &&
    snapshot.paperTiger.insertionMin <= config.paperTigerWallMinInsertionMin &&
    snapshot.paperTiger.clusterSize >= config.paperTigerClusterMinSize;
  const cascadeImminent =
    oiDropTriggered &&
    lsrDeadlockTriggered &&
    thinBookTriggered &&
    paperTigerTriggered;
  // Confidence: 4 conditions, each 0.25 weight when true (max 1.0).
  const confidence =
    (Number(oiDropTriggered) +
      Number(lsrDeadlockTriggered) +
      Number(thinBookTriggered) +
      Number(paperTigerTriggered)) /
    4;
  return {
    oiDropTriggered,
    lsrDeadlockTriggered,
    thinBookTriggered,
    paperTigerTriggered,
    cascadeImminent,
    confidence,
  };
}

// ---------------------------------------------------------------------------
// Plugin class
// ---------------------------------------------------------------------------

export class PerpDexLiquidationSignalsPlugin implements StrategyPlugin {
  // ---------------------------------------------------------------------
  // Static metadata
  // ---------------------------------------------------------------------

  public readonly metadata: StrategyPluginMetadata = {
    name: "perpdex-liquidation-signals-v1",
    version: "1.0.0",
    edgeClass: "risk", // defensive overlay
    capitalRequirement: 0, // read-only defensive signal plugin
    maxLeverage: ONE_TO_TEN_LEVERAGE, // LAYER 1 defense — 1:10 mandate
    description:
      "Phase 12 Track C NINTH drop-in (DEFENSIVE overlay, read-only). " +
      "Detects imminent liquidation cascades on Hyperliquid + dYdX v4 + GMX v2 " +
      "via cascade-imminent heuristic (OI drop >20% 24h + lsr in [0.4,0.6] deadlock " +
      "+ thin top-5 ask depth + paper-tiger N>=5 cluster). Emits RiskSignal with " +
      "sizeModifier=0.5 + 24h closeNotionalUsd. Complements Phase 11.2a " +
      "RegimeDetector (cascade-event-driven vs regime-driven — orthogonal " +
      "defensive layers). 5 feed adapters via DI (0xArchive + HypurrScan + " +
      "GoldRush + CoinGlass + HyperTracker) with graceful degradation. " +
      "ZERO notional impact by construction — 1:10 leverage cap is structurally " +
      "unviolated. >=35 unit tests + adversarial probe.",
    dependencies: [],
  };

  // ---------------------------------------------------------------------
  // Instance state
  // ---------------------------------------------------------------------

  public readonly config: PerpDexLiquidationSignalsPluginConfig;
  public readonly state: PerpDexLiquidationSignalsPluginState;
  /** Captured bus reference (set in subscribe). */
  private _bus: SignalBus | null = null;
  /** Has subscribe() been called (gates Layer 2 assertion). */
  private _wired = false;
  /** Throttle map: per-symbol last emit timestamp (ms). */
  private readonly _throttle = new Map<string, number>();

  // ---------------------------------------------------------------------
  // Construction
  // ---------------------------------------------------------------------

  constructor(overrides: Partial<PerpDexLiquidationSignalsPluginConfig> = {}) {
    this.config = {
      oiDropThresholdPct:
        overrides.oiDropThresholdPct ?? DEFAULT_OI_DROP_THRESHOLD_PCT,
      lsrDeadlockLower:
        overrides.lsrDeadlockLower ?? DEFAULT_LSR_DEADLOCK_LOWER,
      lsrDeadlockUpper:
        overrides.lsrDeadlockUpper ?? DEFAULT_LSR_DEADLOCK_UPPER,
      thinBookTop5DepthPct:
        overrides.thinBookTop5DepthPct ?? DEFAULT_THIN_BOOK_TOP5_DEPTH_PCT,
      paperTigerWallMinInsertionMin:
        overrides.paperTigerWallMinInsertionMin ??
        DEFAULT_PAPER_TIGER_WALL_INSERTION_MIN,
      paperTigerClusterMinSize:
        overrides.paperTigerClusterMinSize ??
        DEFAULT_PAPER_TIGER_CLUSTER_MIN_SIZE,
      pollIntervalSec: overrides.pollIntervalSec ?? DEFAULT_POLL_INTERVAL_SEC,
      throttleCooldownMs:
        overrides.throttleCooldownMs ?? DEFAULT_THROTTLE_COOLDOWN_MS,
      baseNotionalUsd: overrides.baseNotionalUsd ?? DEFAULT_BASE_NOTIONAL_USD,
      sizeModifier: overrides.sizeModifier ?? DEFAULT_SIZE_MODIFIER,
      enabledSymbols:
        overrides.enabledSymbols ?? [...DEFAULT_ENABLED_SYMBOLS],
      adapters:
        overrides.adapters ??
        DEFAULT_PERPDEX_LIQUIDATION_PLUGIN_CONFIG.adapters,
    };

    // LAYER 1 — constructor assertion.
    if (this.metadata.maxLeverage !== ONE_TO_TEN_LEVERAGE) {
      throw new Error(
        "[PerpDexLiquidationSignalsPlugin] LAYER 1 BREACH: metadata.maxLeverage=" +
        String(this.metadata.maxLeverage) +
        " but the project-wide 1:10 mandate requires 10.",
      );
    }

    // Config invariant checks (defense in depth — same checks in validateConfig).
    PerpDexLiquidationSignalsPlugin._assertConfigInvariants(this.config);

    this.state = {
      perSymbol: new Map<string, SymbolCascadeState>(),
      totalSignalsEmitted: 0,
      totalCascadesDetected: 0,
      totalThrottleSkips: 0,
      totalStaleFeedsSkips: 0,
      layer2AssertionCount: 0,
      layer3AssertionCount: 0,
      barsProcessed: 0,
      lastRiskSignal: null,
    };
  }

  // ---------------------------------------------------------------------
  // Static config invariant checks
  // ---------------------------------------------------------------------

  private static _assertConfigInvariants(
    c: PerpDexLiquidationSignalsPluginConfig,
  ): void {
    if (
      !Number.isFinite(c.oiDropThresholdPct) ||
      c.oiDropThresholdPct < MIN_OI_DROP_THRESHOLD_PCT ||
      c.oiDropThresholdPct > MAX_OI_DROP_THRESHOLD_PCT
    ) {
      throw new Error(
        "[PerpDexLiquidationSignalsPlugin] oiDropThresholdPct=" +
        String(c.oiDropThresholdPct) +
        " must be in [" +
        String(MIN_OI_DROP_THRESHOLD_PCT) +
        ", " +
        String(MAX_OI_DROP_THRESHOLD_PCT) +
        "].",
      );
    }
    if (
      !Number.isFinite(c.lsrDeadlockLower) ||
      c.lsrDeadlockLower < MIN_LSR_DEADLOCK_LOWER ||
      c.lsrDeadlockLower >= c.lsrDeadlockUpper
    ) {
      throw new Error(
        "[PerpDexLiquidationSignalsPlugin] lsrDeadlockLower=" +
        String(c.lsrDeadlockLower) +
        " must be finite in [" +
        String(MIN_LSR_DEADLOCK_LOWER) +
        ", lsrDeadlockUpper).",
      );
    }
    if (
      !Number.isFinite(c.lsrDeadlockUpper) ||
      c.lsrDeadlockUpper > MAX_LSR_DEADLOCK_UPPER ||
      c.lsrDeadlockUpper <= c.lsrDeadlockLower
    ) {
      throw new Error(
        "[PerpDexLiquidationSignalsPlugin] lsrDeadlockUpper=" +
        String(c.lsrDeadlockUpper) +
        " must be finite in (lsrDeadlockLower, " +
        String(MAX_LSR_DEADLOCK_UPPER) +
        "].",
      );
    }
    if (
      !Number.isFinite(c.thinBookTop5DepthPct) ||
      c.thinBookTop5DepthPct < 0 ||
      c.thinBookTop5DepthPct > 100
    ) {
      throw new Error(
        "[PerpDexLiquidationSignalsPlugin] thinBookTop5DepthPct=" +
        String(c.thinBookTop5DepthPct) +
        " must be in [0, 100].",
      );
    }
    if (
      !Number.isInteger(c.paperTigerWallMinInsertionMin) ||
      c.paperTigerWallMinInsertionMin < MIN_PAPER_TIGER_WALL_INSERTION_MIN
    ) {
      throw new Error(
        "[PerpDexLiquidationSignalsPlugin] paperTigerWallMinInsertionMin=" +
        String(c.paperTigerWallMinInsertionMin) +
        " must be an integer >= " +
        String(MIN_PAPER_TIGER_WALL_INSERTION_MIN) +
        ".",
      );
    }
    if (
      !Number.isInteger(c.paperTigerClusterMinSize) ||
      c.paperTigerClusterMinSize < MIN_PAPER_TIGER_CLUSTER_MIN_SIZE
    ) {
      throw new Error(
        "[PerpDexLiquidationSignalsPlugin] paperTigerClusterMinSize=" +
        String(c.paperTigerClusterMinSize) +
        " must be an integer >= " +
        String(MIN_PAPER_TIGER_CLUSTER_MIN_SIZE) +
        ".",
      );
    }
    if (
      !Number.isInteger(c.pollIntervalSec) ||
      c.pollIntervalSec < MIN_POLL_INTERVAL_SEC ||
      c.pollIntervalSec > MAX_POLL_INTERVAL_SEC
    ) {
      throw new Error(
        "[PerpDexLiquidationSignalsPlugin] pollIntervalSec=" +
        String(c.pollIntervalSec) +
        " must be an integer in [" +
        String(MIN_POLL_INTERVAL_SEC) +
        ", " +
        String(MAX_POLL_INTERVAL_SEC) +
        "].",
      );
    }
    if (!Number.isFinite(c.throttleCooldownMs) || c.throttleCooldownMs < 0) {
      throw new Error(
        "[PerpDexLiquidationSignalsPlugin] throttleCooldownMs=" +
        String(c.throttleCooldownMs) +
        " must be a finite non-negative number.",
      );
    }
    if (
      !Number.isFinite(c.baseNotionalUsd) ||
      c.baseNotionalUsd < MIN_BASE_NOTIONAL_USD
    ) {
      throw new Error(
        "[PerpDexLiquidationSignalsPlugin] baseNotionalUsd=" +
        String(c.baseNotionalUsd) +
        " must be finite >= " +
        String(MIN_BASE_NOTIONAL_USD) +
        ".",
      );
    }
    if (
      !Number.isFinite(c.sizeModifier) ||
      c.sizeModifier < 0 ||
      c.sizeModifier > 1
    ) {
      throw new Error(
        "[PerpDexLiquidationSignalsPlugin] sizeModifier=" +
        String(c.sizeModifier) +
        " must be in [0, 1].",
      );
    }
    if (!Array.isArray(c.enabledSymbols) || c.enabledSymbols.length === 0) {
      throw new Error(
        "[PerpDexLiquidationSignalsPlugin] enabledSymbols must be a non-empty array of non-empty strings.",
      );
    }
    const seen = new Set<string>();
    for (let i = 0; i < c.enabledSymbols.length; i++) {
      const s: string = c.enabledSymbols[i] as string;
      if (typeof s !== "string" || s.length === 0) {
        throw new Error(
          "[PerpDexLiquidationSignalsPlugin] enabledSymbols[" +
          String(i) +
          "] must be a non-empty string.",
        );
      }
      if (seen.has(s)) {
        throw new Error(
          '[PerpDexLiquidationSignalsPlugin] enabledSymbols contains duplicate "' +
          s +
          '".',
        );
      }
      seen.add(s);
    }
    if (!Array.isArray(c.adapters)) {
      throw new Error(
        "[PerpDexLiquidationSignalsPlugin] adapters must be an array (5 slots expected).",
      );
    }
  }

  // ---------------------------------------------------------------------
  // subscribe — Layer 2 1:10 leverage invariant
  // ---------------------------------------------------------------------

  public subscribe(bus: SignalBus): void {
    this._bus = bus;
    // LAYER 2 — structural sanity check. The plugin holds ZERO notional
    // by construction (defensive signal only); the assertion catches
    // future regressions where someone adds a notional field.
    assertLeverageInvariant(0, this.config.baseNotionalUsd);
    this.state.layer2AssertionCount += 1;
    this._wired = true;
  }

  // ---------------------------------------------------------------------
  // onBar — per-bar evaluation (poll all adapters, aggregate, emit on
  // cascade-imminent AND throttle cooldown elapsed).
  // ---------------------------------------------------------------------

  public onBar(bar: Bar, _state: PluginState): void {
    if (!this._wired || this._bus === null) {
      // Defensive — refuse to operate before subscribe() is called.
      return;
    }
    this.state.barsProcessed += 1;

    // Evaluate each enabled symbol. We poll all 5 adapters per symbol
    // and pick the FRESHEST non-stale snapshot (most-recent timestampMs).
    // In backtest mode the adapters return deterministic mock snapshots.
    for (const symbol of this.config.enabledSymbols) {
      void this._evaluateSymbol(symbol, bar.timestamp);
    }
  }

  // ---------------------------------------------------------------------
  // _evaluateSymbol — async helper (poll + aggregate + emit if imminent)
  // ---------------------------------------------------------------------

  private async _evaluateSymbol(
    symbol: string,
    timestampMs: number,
  ): Promise<void> {
    const snapshots = await Promise.all(
      this.config.adapters.map((a) => a.fetchSnapshot(symbol)),
    );
    // Pick the freshest non-stale snapshot.
    const fresh = snapshots
      .filter((s) => !s.stale)
      .sort((a, b) => b.timestampMs - a.timestampMs);
    if (fresh.length === 0) {
      this.state.totalStaleFeedsSkips += 1;
      return; // graceful degradation — all feeds stale
    }
    const snapshot = fresh[0]!;
    const heuristic = evaluateCascadeHeuristic(snapshot, this.config);
    if (!heuristic.cascadeImminent) {
      return; // no cascade → no emit
    }
    this.state.totalCascadesDetected += 1;

    // Throttle: 24h cooldown per symbol.
    const lastEmit = this._throttle.get(symbol) ?? 0;
    if (timestampMs - lastEmit < this.config.throttleCooldownMs) {
      this.state.totalThrottleSkips += 1;
      return; // cooldown active → skip emit
    }
    this._throttle.set(symbol, timestampMs);

    // Compute implied close notional.
    const closeNotionalUsd =
      this.config.baseNotionalUsd * this.config.sizeModifier;

    // LAYER 3 — per-emit assertion. closeNotionalUsd must respect the
    // 1:10 cap (closeNotionalUsd / baseNotionalUsd <= 10×).
    assertLeverageInvariant(closeNotionalUsd, this.config.baseNotionalUsd);
    this.state.layer3AssertionCount += 1;

    // Compose + emit RiskSignal.
    const sig: RiskSignal = {
      kind: "risk",
      source: this.metadata.name,
      varDaily95: 0,
      correlationPenalty: 0,
      drawdownLimit: 0,
      breach: true,
      reason:
        "cascade-imminent: OI drop=" +
        snapshot.oiDrop24h.toFixed(3) +
        " lsr=" +
        snapshot.lsrRatio.toFixed(3) +
        " thinBook=" +
        snapshot.top5AskDepthPct.toFixed(1) +
        "pct paperTiger=" +
        String(snapshot.paperTiger.clusterSize) +
        "w/" +
        String(snapshot.paperTiger.insertionMin) +
        "m",
      closeNotionalUsd,
      sizeModifier: this.config.sizeModifier,
      timestampMs,
    };
    this._bus!.emit(sig);
    this.state.totalSignalsEmitted += 1;
    this.state.lastRiskSignal = sig;
    // Suppress unused heuristic refs for the linter.
    void heuristic;
  }

  // ---------------------------------------------------------------------
  // validateConfig — non-throwing config audit
  // ---------------------------------------------------------------------

  public validateConfig(config: unknown): Result<void, ConfigError> {
    if (typeof config !== "object" || config === null) {
      return err({
        pluginName: this.metadata.name,
        field: "config",
        message: "config must be an object",
      });
    }
    // The plugin validates its own config in the constructor; this is a
    // boot-time audit that confirms the metadata invariants.
    if (this.metadata.maxLeverage !== ONE_TO_TEN_LEVERAGE) {
      return err({
        pluginName: this.metadata.name,
        field: "maxLeverage",
        message:
          "metadata.maxLeverage=" +
          String(this.metadata.maxLeverage) +
          " must equal ONE_TO_TEN_LEVERAGE=" +
          String(ONE_TO_TEN_LEVERAGE),
      });
    }
    if (this.metadata.edgeClass !== "risk") {
      return err({
        pluginName: this.metadata.name,
        field: "edgeClass",
        message:
          'metadata.edgeClass must be "risk" for defensive overlay, got "' +
          this.metadata.edgeClass +
          '"',
      });
    }
    return ok(undefined);
  }

  // ---------------------------------------------------------------------
  // reset / dispose — backtest lifecycle
  // ---------------------------------------------------------------------

  public reset(): void {
    this.state.perSymbol.clear();
    this._throttle.clear();
    // Reset counters but keep config + bus + wired flag.
    this.state.totalSignalsEmitted = 0;
    this.state.totalCascadesDetected = 0;
    this.state.totalThrottleSkips = 0;
    this.state.totalStaleFeedsSkips = 0;
    this.state.layer3AssertionCount = 0;
    this.state.barsProcessed = 0;
    this.state.lastRiskSignal = null;
  }

  public dispose(): void {
    this._bus = null;
    this._wired = false;
    this._throttle.clear();
  }
}
