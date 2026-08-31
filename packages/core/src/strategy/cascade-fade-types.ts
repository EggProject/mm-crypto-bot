// ============================================================================
// CASCADE STATE MACHINE
// ============================================================================

/**
 * The 3-state cascade lifecycle. ONLY `POST_CASCADE` allows entry.
 *
 *   IN_PROGRESS → STABILIZING → POST_CASCADE
 *
 * Transitions:
 *   IN_PROGRESS  → STABILIZING  : OI change < ±0.5%/hr AND funding near zero
 *   STABILIZING  → POST_CASCADE : OI drop > 15% in 48h AND ELR < 0.40 floor
 *   POST_CASCADE → (entry)      : timed exit within 3-10 min via Layer 3
 *
 * A cascade can also return from POST_CASCADE to STABILIZING if OI
 * rebounds or ELR climbs back above the 0.45 ceiling; in that case
 * no new entries are accepted until POST_CASCADE is re-entered.
 */
export type CascadeState = "IN_PROGRESS" | "STABILIZING" | "POST_CASCADE";

// ============================================================================
// INPUT TYPES — sourced from coinglass-liquidation-ws.ts and bitquery-grpc.ts
// ============================================================================

/**
 * Snapshot of `Liquidation1MinWindow` data, passed in by the caller
 * (paper-trade replay or live WebSocket bridge). This is the minimal
 * subset needed to drive the cascade detector.
 */
export interface CascadeWindowInput {
  /**
  1-min window start (Unix ms).
  */
  readonly windowStartMs: number;
  /**
  Symbol (BTC, ETH, SOL).
  */
  readonly symbol: string;
  /**
  Aggregate USD value across all venues × sides for this minute.
  */
  readonly totalUsd: number;
  /**
  Tradable bybit.eu spot mid in USD. Required before an entry can be built.
  */
  readonly midPriceUsd?: number;
  /**
  Long-side USD value.
  */
  readonly longUsd: number;
  /**
  Short-side USD value.
  */
  readonly shortUsd: number;
  /**
  Number of distinct exchanges that contributed prints.
  */
  readonly distinctExchangeCount: number;
}

/**
 * Open-interest input — required to compute the Axel Adler rules
 * (OI drop > 15% in 48h) and the real-time Layer 1 trigger (OI drop > 1%
 * in 5min). Sourced from CoinGlass `/api/futures/openInterest` or
 * Hyperliquid `metaAndAssetCtxs`.
 */
export interface OpenInterestInput {
  /**
  Snapshot timestamp (Unix ms).
  */
  readonly timestampMs: number;
  /**
  Symbol.
  */
  readonly symbol: string;
  /**
  Aggregate USD value of open interest across tracked venues.
  */
  readonly oiUsd: number;
}

/**
 * Funding rate input — used to gate the `STABILIZING → POST_CASCADE`
 * transition ("funding near zero"). Sourced from the existing
 * `CrossDexFundingWatcherPlugin` (Phase 12 Track B).
 */
export interface FundingRateInput {
  /**
  Snapshot timestamp (Unix ms).
  */
  readonly timestampMs: number;
  /**
  Symbol.
  */
  readonly symbol: string;
  /**
  8h-equivalent funding rate, decimal (0.0001 = 1 bp).
  */
  readonly fundingRate8h: number;
}

/**
 * ELR (Estimated Leverage Ratio) — OI divided by exchange reserves.
 * Required for the `STABILIZING → POST_CASCADE` gate ("ELR < 0.40
 * floor"). Sourced from CoinGlass `/api/futures/liquidation/...`
 * or computed locally from OI / reserve ratio.
 */
export interface ElrInput {
  /**
  Snapshot timestamp (Unix ms).
  */
  readonly timestampMs: number;
  /**
  Symbol.
  */
  readonly symbol: string;
  /**
  ELR as a fraction (0.40 = 40% of reserves levered).
  */
  readonly elr: number;
}

/**
 * Provider identifier for a single cross-confirmation source. The
 * strict-list keeps the typechecker honest — adding a new provider
 * means extending this union and the detector's `PROVIDER_DIVERSITY_GROUPS`
 * map at once.
 */
export type CrossConfirmationProvider =
  "coinglass_v4" | "bitquery_hl" | "goldrush_hl" | "binance_perp" | "okx_perp" | "bybit_perp" | "other";

/**
 * `CascadeCrossSource` — one observation reported by a single provider
 * for a single 1-min cascade window. The detector requires
 * - same symbol across all sources
 * - windowStartMs within `layer1CrossConfirmWindowMs` of the trigger window
 * - distinct provider values (provider diversity)
 * - count ≥ `layer1MinCrossConfirmations`
 *
 * Verifier Check 2 (attempt 1): a BTC event was previously created
 * with `crossConfirmation { symbol: ETH, windowStartMs: T0-3h,
 * sourceCount: 2 }`. The new shape forces the caller to provide
 * per-source detail and the predicate is checked inside
 * `checkLayer1Trigger` rather than a numeric count flag.
 */
export interface CascadeCrossSource {
  readonly provider: CrossConfirmationProvider;
  /**
  Symbol reported by this source (must equal the trigger symbol across all sources).
  */
  readonly symbol: string;
  /**
  Window start (Unix ms) this source observed.
  */
  readonly windowStartMs: number;
}

/**
 * Cross-confirmation input for Layer 1 trigger. The detector validates
 * sources[] inside `checkLayer1Trigger` — never trust a numeric
 * `sourceCount` flag without per-source evidence.
 */
export interface CrossConfirmationInput {
  readonly sources: readonly CascadeCrossSource[];
}

/**
 * Provider groups: providers in the same group are considered
 * "the same source" for diversity purposes. CoinGlass aggregates 30+
 * exchanges but it's still ONE source; each individual perp venue is
 * another source (with the perp venues grouped together so we don't
 * require 3+ different perp venues).
 *
 * Per Track D §6.1, the brief is satisfied when ≥2 sources agree
 * within ±60s, with the strict interpretation that "CoinGlass + one perp
 * feed" is the canonical config.
 */
export const PROVIDER_DIVERSITY_GROUPS: Readonly<Record<CrossConfirmationProvider, string>> = {
  coinglass_v4: "aggregator",
  bitquery_hl: "perp",
  goldrush_hl: "perp",
  binance_perp: "perp",
  okx_perp: "perp",
  bybit_perp: "perp",
  other: "other",
};

/**
 * Risk snapshot — the system-side context the strategy reads at entry
 * time. All 5 risk governor gates (Track D §6.1 Layer 4) read from
 * this view. The detector refuses to emit an entry when ANY kill-switch
 * is active (verifier Check 1, attempt 1 fix).
 */
export interface RiskSnapshotInput {
  /**
  Phase 24 portfolio drawdown in [0, 1]. Detected when > riskPortfolioDdCap.
  */
  readonly portfolioDd?: number;
  /**
  Is the perp-DEX aggregate OI over its 90-day SMA?
  */
  readonly perpDexOiOverSma?: boolean;
  /**
  Overlay-book open P&L as a fraction (negative = loss). Detected when < -2%.
  */
  readonly overlayOpenPnlPct?: number;
}

// ============================================================================
// DETECTOR CONFIG
// ============================================================================

/**
 * Configuration for the cascade detector. Defaults are baked from
 * Track D REPORT.md §6.1 + §7 + §8.2.
 *
 * The defaults below form the **empirically-validated baseline**.
 * Tune with caution — every change is a deviance from Track D's
 * research findings.
 */
export interface CascadeFadeConfig {
  // -------------------------------------------------------------------------
  // Layer 1 — real-time detector thresholds (Track D §6.1)
  // -------------------------------------------------------------------------
  /**
  Aggregate 1-min liquidation USD value to qualify as "cascade event". Default $50M.
  */
  readonly layer1OneMinUsdThreshold: number;
  /**
  OI drop in 5min window required to trigger Layer 1. Default 1% (0.01).
  */
  readonly layer1OiDrop5minPct: number;
  /**
   * Cross-confirmation requirement (≥2 sources).
   * Distinct providers must agree within `layer1CrossConfirmWindowMs`
   * of each other on the same symbol. Default 2.
   */
  readonly layer1MinCrossConfirmations: number;
  /**
   * Window-time tolerance for cross-confirmation sources, in ms.
   * Default 60_000 (60s). The brief explicitly forbids ±3h windows —
   * only sources within this tight band count.
   */
  readonly layer1CrossConfirmWindowMs: number;

  // -------------------------------------------------------------------------
  // Layer 2 — state machine thresholds (Track D §4.4 + §6.1)
  // -------------------------------------------------------------------------
  /**
  OI drop in 48h to enter POST_CASCADE. Axel Adler rule. Default 15%.
  */
  readonly layer2OiDrop48hPct: number;
  /**
  ELR floor for POST_CASCADE entry. Default 0.40.
  */
  readonly layer2ElrFloor: number;
  /**
  OI change threshold to transition IN_PROGRESS → STABILIZING. Default ±0.5%/hr.
  */
  readonly layer2StabilizingOiPctPerHr: number;
  /**
  Funding rate "near zero" threshold. Default ±0.0001 (1 bp on 8h equivalent).
  */
  readonly layer2FundingNearZero: number;

  // -------------------------------------------------------------------------
  // Layer 3 — execution (Track D §6.1 + §6.3)
  // -------------------------------------------------------------------------
  /**
  Min NOTIONAL distance from mid for marketable limit (in bps). Default 5.
  */
  readonly layer3MinDistanceFromMidBps: number;
  /**
  Max NOTIONAL distance from mid for marketable limit (in bps). Default 15.
  */
  readonly layer3MaxDistanceFromMidBps: number;
  /**
  Min TWAP exit window (minutes). Default 3.
  */
  readonly layer3ExitMinMinutes: number;
  /**
  Max TWAP exit window (minutes). Default 10.
  */
  readonly layer3ExitMaxMinutes: number;

  // -------------------------------------------------------------------------
  // Risk governor (Track D §6.1 Layer 4 + §7)
  // -------------------------------------------------------------------------
  /**
  Phase 24 portfolio DD cap on cascade-fade book. Default 12%.
  */
  readonly riskPortfolioDdCap: number;
  /**
  Perp-DEX OI over 90-day SMA → halt.
  */
  readonly riskPerpDexOiOverSmaHalts: boolean;
  /**
  Cooldown between consecutive BTC cascade entries. Default 24h.
  */
  readonly riskBtCooldownMs: number;
  /**
  Overlay book open P&L threshold for kill-switch. Default -2%.
  */
  readonly riskOverlayDrawdownKillBps: number;
  /**
  Rolling 7d DD on overlay book → halt 30 days. Default 5%.
  */
  readonly riskHardStopRolling7dDd: number;
  /**
  Hard-stop halt duration. Default 30 days.
  */
  readonly riskHardStopHaltMs: number;

  // -------------------------------------------------------------------------
  // Capacity constraints (Track D §6.3)
  // -------------------------------------------------------------------------
  /**
  Max position per symbol per event. Default $1M.
  */
  readonly capacityMaxPerSymbolEventUsd: number;
  /**
  Max concurrent symbols. Default 2.
  */
  readonly capacityMaxConcurrentSymbols: number;
  /**
  Total deployable per event. Default $2M.
  */
  readonly capacityMaxPerEventUsd: number;
  /**
  Total deployable per week. Default $5M.
  */
  readonly capacityMaxPerWeekUsd: number;

  // -------------------------------------------------------------------------
  // Symbols allowed (BTC + ETH baseline)
  // -------------------------------------------------------------------------
  readonly allowedSymbols: readonly string[];
}

export const DEFAULT_CASCADE_FADE_CONFIG: CascadeFadeConfig = {
  layer1OneMinUsdThreshold: 50_000_000,
  layer1OiDrop5minPct: 0.01,
  layer1MinCrossConfirmations: 2,
  layer1CrossConfirmWindowMs: 60_000,

  layer2OiDrop48hPct: 0.15,
  layer2ElrFloor: 0.4,
  layer2StabilizingOiPctPerHr: 0.005,
  layer2FundingNearZero: 0.0001,

  layer3MinDistanceFromMidBps: 5,
  layer3MaxDistanceFromMidBps: 15,
  layer3ExitMinMinutes: 3,
  layer3ExitMaxMinutes: 10,

  riskPortfolioDdCap: 0.12,
  riskPerpDexOiOverSmaHalts: true,
  riskBtCooldownMs: 24 * 60 * 60 * 1000,
  riskOverlayDrawdownKillBps: -200, // -2% in bps
  riskHardStopRolling7dDd: 0.05,
  riskHardStopHaltMs: 30 * 24 * 60 * 60 * 1000,

  capacityMaxPerSymbolEventUsd: 1_000_000,
  capacityMaxConcurrentSymbols: 2,
  capacityMaxPerEventUsd: 2_000_000,
  capacityMaxPerWeekUsd: 5_000_000,

  allowedSymbols: ["BTC", "ETH"] as const,
};

// ============================================================================
// INTERNAL STATE
// ============================================================================

/**
 * One cascade event record — produced when the Layer 1 trigger fires
 * and held until the entry is closed (or the state machine rewinds).
 */
export interface CascadeEvent {
  readonly id: string;
  readonly symbol: string;
  readonly triggeredAtMs: number;
  /**
  IN_PROGRESS / STABILIZING / POST_CASCADE — see CascadeState.
  */
  state: CascadeState;
  /**
  First seen OI (USD).
  */
  readonly oiPeakUsd: number;
  /**
  First seen 1-min liquidation USD value at trigger time.
  */
  readonly trigger1minUsd: number;
  /**
  Number of cross-confirming sources (≥ `layer1MinCrossConfirmations`).
  */
  readonly crossConfirmations: number;
  /**
  Last OI we observed (for the rolling drop calculation).
  */
  lastObservedOiUsd: number;
  /**
  Last funding (8h-equivalent) reading.
  */
  lastFunding8h: number;
  /**
  Last ELR reading.
  */
  lastElr: number;
  /**
   * If a state machine entry decision was made, this holds the
   * snapshot for replay / paper-trade. `undefined` means no entry yet.
   */
  entry: CascadeEntry | undefined;
  /**
  If the event closed (target hit, expiry, or risk kill), record it.
  */
  exit: CascadeExit | undefined;
}

/**
 * One cascade entry decision — what Layer 3 would have placed at
 * bybit.eu SPOT in paper-trade mode.
 */
export interface CascadeEntry {
  readonly eventId: string;
  readonly symbol: string;
  readonly entryTsMs: number;
  readonly entryMidPriceUsd: number;
  /**
  Marketable-limit price: mid +/- distance (bps). Captures RPI depth.
  */
  readonly entryLimitPriceUsd: number;
  /**
  Distance from mid, in bps.
  */
  readonly entryDistanceBps: number;
  /**
  Position notional in USD (capped at capacityMaxPerSymbolEventUsd).
  */
  readonly entryNotionalUsd: number;
  /**
  Side of the entry (always BUY = fade the cascade's downside).
  */
  readonly side: "buy";
  /**
  Hard TWAP exit window in minutes (3-10 by default).
  */
  readonly exitWindowMinutes: number;
}

/**
 * One cascade exit — what the paper-trade simulator would have closed
 * at the end of the TWAP window.
 */
export interface CascadeExit {
  readonly eventId: string;
  readonly symbol: string;
  readonly exitTsMs: number;
  readonly exitMidPriceUsd: number;
  /**
  Exit notional returned.
  */
  readonly exitNotionalUsd: number;
  /**
  Entry vs exit P&L, in bps of notional.
  */
  readonly pnlBps: number;
  /**
  Whether exit was triggered by the timed exit, a kill-switch, or a constraint.
  */
  readonly exitReason: "timed_exit" | "risk_kill" | "hard_stop" | "capacity";
}
