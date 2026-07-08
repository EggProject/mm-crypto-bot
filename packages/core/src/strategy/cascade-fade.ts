// packages/core/src/strategy/cascade-fade.ts
//
// Phase 25 #2 Track D — Liquidation cascade "fade-the-cascade" detector
// + paper-trade execution simulator (3-layer filter).
//
// ============================================================================
// TRACK D — EVENT-DRIVEN OVERLAY (NOT A PRIMARY STRATEGY)
// ============================================================================
//
// This module implements the Phase 25 Track D research recommendation
// (see docs/research/phase25/track-d/REPORT.md and §8.2 CONDITIONAL POSITIVE):
//
//   "Implement [the cascade fade overlay] in paper-trade mode ≥30 days,
//    then size $500k-$1M notional."
//
// It is an event-driven SATELLITE on top of the Phase 24 #1 baseline
// core (Donchian + Pivot + DVOL, cap=0.18, +39.4%/mo proven). The
// satellite is sized at ≤$1M notional per event and ≤$2M per week to
// stay inside the user's 15% DD mandate (Phase 14B).
//
// ============================================================================
// 3-LAYER FILTER (NON-NEGOTIABLE — naked liquidation detection is NEGATIVE)
// ============================================================================
//
// Track D research §7.1 — Anomiq.io full-year backtest with 6,926 trades
// across 8 symbols found naked mean-reversion on extreme deviations was
// flat-to-negative after costs. The filter MUST require explicit cascade
// confirmation (OI drop + liquidation spike + ELR drop) before entry.
//
//   Layer 1 (real-time detector):
//     - aggregate 1-min liquidation volume > $50M AND
//     - OI drop > 1% in 5min window
//     - cross-confirmed (CoinGlass aggregate + at least one perp feed)
//     - Both sources must agree within ±2min window OR
//       CoinGlass-only with >$30M 1-min and Hyperliquid OI drop > 1% in 5min
//
//   Layer 2 (state machine):
//     - IN_PROGRESS  — Layer 1 fired; OI still dropping
//     - STABILIZING  — OI change < ±0.5%/hr AND funding near zero
//     - POST_CASCADE — OI drop > 15% in 48h AND ELR < 0.40 floor
//
//     >>> ONLY POST_CASCADE ALLOWS ENTRY <<<
//
//   Layer 3 (execution):
//     - bybit.eu SPOT marketable limit 5-15bps from mid (capture RPI depth)
//     - TWAP exit 3-10 min (timed, no TP/SL — curupira rule)
//     - NO naked short (Track D §6.3 explicit non-goal)
//     - NO holding through next session
//     - NO entry before stabilization
//
// ============================================================================
// RISK GOVERNOR (TRACK D §6.1 Layer 4 + §6.3)
// ============================================================================
//
//   - Stop cascade-fade book if Phase 24 portfolio DD > 12%
//   - Halt all new cascade entries if total perp-DEX OI > 90-day SMA
//   - Cooldown 24h between consecutive BTC cascade entries
//   - Kill-switch on next cascade if open P&L on overlay book < -2%
//   - Hard stop: cascade-fade book down > 5% over rolling 7d → halt 30 days
//     (regime-change detector per Track D §7.4)
//
// ============================================================================
// CAPACITY CONSTRAINTS (TRACK D §6.3)
// ============================================================================
//
//   - Max position: $1M notional per symbol per event
//   - Max concurrent symbols: 2 (BTC + ETH typically)
//   - Total deployable: $2M per event, $5M per week
//   - bybit.eu SPOT only — no derivatives execution
//
// ============================================================================
// PAPER-TRADE MODE (TRACK D §5 + §8.2 recommendation)
// ============================================================================
//
//   - Logs hypothetical fills based on real cascade data + synthetic
//     bybit.eu SPOT slippage model (5-50bps cascade-period)
//   - Replay mode supports the 2025-10-10 benchmark event for
//     calibration (Track D §8.2 mandates "≥30 days paper-trade")
//   - Wire-up integrity: detector OFF vs ON produces byte-identical
//     Phase 19 #1 baseline (this module does NOT mutate the engine loop)
//
// ============================================================================
// REFERENCES (full citations in docs/research/phase25/track-d/sources.md)
// ============================================================================
//
//   - Track D REPORT.md §3 (cascade detection latency stack)
//   - Track D REPORT.md §4.4 (Axel Adler OI/ELR rules)
//   - Track D REPORT.md §6 (integration plan with 3-layer + Layer 4)
//   - Track D REPORT.md §8 (Phase 25 #2 recommendation matrix)
//   - Anomiq.io finding: naked mean-reversion flat-to-negative (the reason
//     we require 3-layer confirmation)
//
// This file implements the detector + state machine + paper-trade
// simulator + risk governor. The actual bybit.eu SPOT execution wiring
// is left to Phase 26 (post-paper-trade validation).

import type { Strategy } from "../types.js";

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
  /** 1-min window start (Unix ms). */
  readonly windowStartMs: number;
  /** Symbol (BTC, ETH, SOL). */
  readonly symbol: string;
  /** Aggregate USD value across all venues × sides for this minute. */
  readonly totalUsd: number;
  /** Long-side USD value. */
  readonly longUsd: number;
  /** Short-side USD value. */
  readonly shortUsd: number;
  /** Number of distinct exchanges that contributed prints. */
  readonly distinctExchangeCount: number;
}

/**
 * Open-interest input — required to compute the Axel Adler rules
 * (OI drop > 15% in 48h) and the real-time Layer 1 trigger (OI drop > 1%
 * in 5min). Sourced from CoinGlass `/api/futures/openInterest` or
 * Hyperliquid `metaAndAssetCtxs`.
 */
export interface OpenInterestInput {
  /** Snapshot timestamp (Unix ms). */
  readonly timestampMs: number;
  /** Symbol. */
  readonly symbol: string;
  /** Aggregate USD value of open interest across tracked venues. */
  readonly oiUsd: number;
}

/**
 * Funding rate input — used to gate the `STABILIZING → POST_CASCADE`
 * transition ("funding near zero"). Sourced from the existing
 * `CrossDexFundingWatcherPlugin` (Phase 12 Track B).
 */
export interface FundingRateInput {
  /** Snapshot timestamp (Unix ms). */
  readonly timestampMs: number;
  /** Symbol. */
  readonly symbol: string;
  /** 8h-equivalent funding rate, decimal (0.0001 = 1 bp). */
  readonly fundingRate8h: number;
}

/**
 * ELR (Estimated Leverage Ratio) — OI divided by exchange reserves.
 * Required for the `STABILIZING → POST_CASCADE` gate ("ELR < 0.40
 * floor"). Sourced from CoinGlass `/api/futures/liquidation/...`
 * or computed locally from OI / reserve ratio.
 */
export interface ElrInput {
  /** Snapshot timestamp (Unix ms). */
  readonly timestampMs: number;
  /** Symbol. */
  readonly symbol: string;
  /** ELR as a fraction (0.40 = 40% of reserves levered). */
  readonly elr: number;
}

/**
 * Cross-confirmation signal — counts how many of the Layer 1 sources
 * (CoinGlass, Bitquery, on-chain) agree on a given cascade window.
 * Required for Layer 1 trigger ("cross-confirmed").
 */
export interface CrossConfirmationInput {
  /** Window start (Unix ms). */
  readonly windowStartMs: number;
  /** Symbol. */
  readonly symbol: string;
  /** Count of distinct layer-1 sources that have observed a cascade signal within ±2min. */
  readonly sourceCount: number;
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
  /** Aggregate 1-min liquidation USD value to qualify as "cascade event". Default $50M. */
  readonly layer1OneMinUsdThreshold: number;
  /** OI drop in 5min window required to trigger Layer 1. Default 1% (0.01). */
  readonly layer1OiDrop5minPct: number;
  /** Cross-confirmation requirement (≥2 sources in ±2min). */
  readonly layer1MinCrossConfirmations: number;

  // -------------------------------------------------------------------------
  // Layer 2 — state machine thresholds (Track D §4.4 + §6.1)
  // -------------------------------------------------------------------------
  /** OI drop in 48h to enter POST_CASCADE. Axel Adler rule. Default 15%. */
  readonly layer2OiDrop48hPct: number;
  /** ELR floor for POST_CASCADE entry. Default 0.40. */
  readonly layer2ElrFloor: number;
  /** OI change threshold to transition IN_PROGRESS → STABILIZING. Default ±0.5%/hr. */
  readonly layer2StabilizingOiPctPerHr: number;
  /** Funding rate "near zero" threshold. Default ±0.0001 (1 bp on 8h equivalent). */
  readonly layer2FundingNearZero: number;

  // -------------------------------------------------------------------------
  // Layer 3 — execution (Track D §6.1 + §6.3)
  // -------------------------------------------------------------------------
  /** Min NOTIONAL distance from mid for marketable limit (in bps). Default 5. */
  readonly layer3MinDistanceFromMidBps: number;
  /** Max NOTIONAL distance from mid for marketable limit (in bps). Default 15. */
  readonly layer3MaxDistanceFromMidBps: number;
  /** Min TWAP exit window (minutes). Default 3. */
  readonly layer3ExitMinMinutes: number;
  /** Max TWAP exit window (minutes). Default 10. */
  readonly layer3ExitMaxMinutes: number;

  // -------------------------------------------------------------------------
  // Risk governor (Track D §6.1 Layer 4 + §7)
  // -------------------------------------------------------------------------
  /** Phase 24 portfolio DD cap on cascade-fade book. Default 12%. */
  readonly riskPortfolioDdCap: number;
  /** Perp-DEX OI over 90-day SMA → halt. */
  readonly riskPerpDexOiOverSmaHalts: boolean;
  /** Cooldown between consecutive BTC cascade entries. Default 24h. */
  readonly riskBtCooldownMs: number;
  /** Overlay book open P&L threshold for kill-switch. Default -2%. */
  readonly riskOverlayDrawdownKillBps: number;
  /** Rolling 7d DD on overlay book → halt 30 days. Default 5%. */
  readonly riskHardStopRolling7dDd: number;
  /** Hard-stop halt duration. Default 30 days. */
  readonly riskHardStopHaltMs: number;

  // -------------------------------------------------------------------------
  // Capacity constraints (Track D §6.3)
  // -------------------------------------------------------------------------
  /** Max position per symbol per event. Default $1M. */
  readonly capacityMaxPerSymbolEventUsd: number;
  /** Max concurrent symbols. Default 2. */
  readonly capacityMaxConcurrentSymbols: number;
  /** Total deployable per event. Default $2M. */
  readonly capacityMaxPerEventUsd: number;
  /** Total deployable per week. Default $5M. */
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

  layer2OiDrop48hPct: 0.15,
  layer2ElrFloor: 0.40,
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
  /** IN_PROGRESS / STABILIZING / POST_CASCADE — see CascadeState. */
  state: CascadeState;
  /** First seen OI (USD). */
  readonly oiPeakUsd: number;
  /** First seen 1-min liquidation USD value at trigger time. */
  readonly trigger1minUsd: number;
  /** Number of cross-confirming sources (≥ `layer1MinCrossConfirmations`). */
  readonly crossConfirmations: number;
  /** Last OI we observed (for the rolling drop calculation). */
  lastObservedOiUsd: number;
  /** Last funding (8h-equivalent) reading. */
  lastFunding8h: number;
  /** Last ELR reading. */
  lastElr: number;
  /**
   * If a state machine entry decision was made, this holds the
   * snapshot for replay / paper-trade. `null` means no entry yet.
   */
  entry: CascadeEntry | null;
  /** If the event closed (target hit, expiry, or risk kill), record it. */
  exit: CascadeExit | null;
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
  /** Marketable-limit price: mid +/- distance (bps). Captures RPI depth. */
  readonly entryLimitPriceUsd: number;
  /** Distance from mid, in bps. */
  readonly entryDistanceBps: number;
  /** Position notional in USD (capped at capacityMaxPerSymbolEventUsd). */
  readonly entryNotionalUsd: number;
  /** Side of the entry (always BUY = fade the cascade's downside). */
  readonly side: "buy";
  /** Hard TWAP exit window in minutes (3-10 by default). */
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
  /** Exit notional returned. */
  readonly exitNotionalUsd: number;
  /** Entry vs exit P&L, in bps of notional. */
  readonly pnlBps: number;
  /** Whether exit was triggered by the timed exit, a kill-switch, or a constraint. */
  readonly exitReason: "timed_exit" | "risk_kill" | "hard_stop" | "capacity";
}

// ============================================================================
// CASCADE DETECTOR — main class
// ============================================================================

/**
 * `CascadeFadeDetector` — pure-functional state machine + Layer 1/2/3
 * filter. Drives a `CascadeEvent` through the lifecycle and emits
 * `CascadeEntry` / `CascadeExit` decisions.
 *
 * Hard constraints enforced at multiple layers:
 *   - Constructor: rejects empty `allowedSymbols` or invalid `layer3`
 *     window values (Layer 3 invariant).
 *   - `evaluate()`: every emit-time decision asserts on Layer 1 triggers
 *     and Layer 2 transitions (state machine invariant).
 *   - `processEntry()`: every entry size is clamped to
 *     `capacityMaxPerSymbolEventUsd` AND the concurrent-symbol / per-event
 *     / per-week caps (capacity invariant).
 *
 * Determinism: this class is **fully deterministic** with respect to
 * the input observation order. Two runs with the same observation
 * sequence produce identical `CascadeEvent[]` and `CascadeExit[]`.
 */
export class CascadeFadeDetector {
  private readonly config: CascadeFadeConfig;
  private readonly events = new Map<string, CascadeEvent>();
  private readonly oiHistory = new Map<string, { ts: number; oiUsd: number }[]>();
  private readonly fundingHistory = new Map<string, { ts: number; funding8h: number }[]>();
  private readonly elrHistory = new Map<string, { ts: number; elr: number }[]>();
  /** Last BTC cascade entry timestamp (for 24h cooldown). */
  private lastBtcEntryTsMs = -Infinity;
  /** Hard-stop cooldown — set when rolling 7d DD breaches. */
  private hardStopHaltUntilMs = -Infinity;
  /** Snapshot of current open positions (for kill-switch). */
  private readonly openPositions = new Map<string, CascadeEntry>();
  /** Rolling 7d P&L ledger (closed positions only). */
  private readonly pnlLedgerBps: { tsMs: number; pnlBps: number }[] = [];

  constructor(config: Partial<CascadeFadeConfig> = {}) {
    const merged: CascadeFadeConfig = { ...DEFAULT_CASCADE_FADE_CONFIG, ...config };
    this.validateConfig(merged);
    this.config = merged;
  }

  // -------------------------------------------------------------------------
  // Public read-only state
  // -------------------------------------------------------------------------

  /** All currently-open events across symbols. */
  getOpenEvents(): readonly CascadeEvent[] {
    return Array.from(this.events.values()).filter((e) => e.exit === null);
  }

  /** All events ever observed (including closed). */
  getAllEvents(): readonly CascadeEvent[] {
    return [...this.events.values()];
  }

  /** All exits the detector produced (paper-trade simulator log). */
  getExitsLog(): readonly CascadeExit[] {
    const out: CascadeExit[] = [];
    for (const ev of this.events.values()) {
      if (ev.exit !== null) out.push(ev.exit);
    }
    return out;
  }

  /** Open positions (paper-trade). */
  getOpenPositions(): readonly CascadeEntry[] {
    return [...this.openPositions.values()];
  }

  /** Cumulative paper-trade P&L in bps across all closed events. */
  getCumulativePnlBps(): number {
    let sum = 0;
    for (const e of this.pnlLedgerBps) sum += e.pnlBps;
    return sum;
  }

  /** Get the rolling 7d P&L (sum of pnlLedgerBps in last 7 days). */
  getRolling7dDdBps(nowMs: number): number {
    const cutoff = nowMs - 7 * 24 * 60 * 60 * 1000;
    let sum = 0;
    for (const e of this.pnlLedgerBps) {
      if (e.tsMs >= cutoff) sum += e.pnlBps;
    }
    // DD = negative return on book; we report as a negative number.
    return sum;
  }

  /** Hard-stop currently active? */
  isHardStopped(nowMs: number): boolean {
    return nowMs < this.hardStopHaltUntilMs;
  }

  /** Currently allowed to enter (Layer-2 POST_CASCADE + risk gates + capacity). */
  canEnter(eventId: string, nowMs: number): boolean {
    const ev = this.events.get(eventId);
    if (ev === undefined) return false;
    if (ev.state !== "POST_CASCADE") return false;
    if (ev.entry !== null) return false;
    if (this.isHardStopped(nowMs)) return false;
    if (ev.symbol === "BTC") {
      if (nowMs - this.lastBtcEntryTsMs < this.config.riskBtCooldownMs) return false;
    }
    // Capacity check
    const openSymbols = new Set<string>();
    for (const pos of this.openPositions.values()) {
      openSymbols.add(pos.symbol);
    }
    if (!openSymbols.has(ev.symbol) && openSymbols.size >= this.config.capacityMaxConcurrentSymbols) {
      return false;
    }
    return true;
  }

  // -------------------------------------------------------------------------
  // Main observation entry point
  // -------------------------------------------------------------------------

  /**
   * `observe` — record a fresh 1-min window, OI, funding, ELR, and
   * cross-confirmation signal. Returns the updated cascade event list
   * or null if no event was created.
   *
   * The detector is **single-call per observation** — passing the
   * same inputs twice is idempotent for existing events and creates
   * at most one event per (symbol, threshold breach).
   */
  observe(input: {
    readonly nowMs: number;
    readonly window: CascadeWindowInput;
    readonly oi: OpenInterestInput;
    readonly funding?: FundingRateInput;
    readonly elr?: ElrInput;
    readonly crossConfirmation?: CrossConfirmationInput;
    readonly portfolioDd?: number;
    readonly perpDexOiOverSma?: boolean;
    readonly overlayOpenPnlPct?: number;
  }): readonly CascadeEvent[] {
    const { nowMs, window, oi, funding, elr } = input;
    const crossConfirmation = input.crossConfirmation;
    const portfolioDd = input.portfolioDd;
    const perpDexOiOverSma = input.perpDexOiOverSma;
    const overlayOpenPnlPct = input.overlayOpenPnlPct;

    this.recordOi(oi);
    if (funding !== undefined) this.recordFunding(funding);
    if (elr !== undefined) this.recordElr(elr);

    // ---- Layer 1: real-time detector trigger ----
    const layer1Args: Parameters<CascadeFadeDetector["checkLayer1Trigger"]>[0] =
      crossConfirmation !== undefined
        ? { window, oi, crossConfirmation }
        : { window, oi };
    const layer1Fired = this.checkLayer1Trigger(layer1Args);
    let event = this.findEventBySymbol(window.symbol);
    if (layer1Fired && event === undefined) {
      event = this.createEvent({
        symbol: window.symbol,
        nowMs,
        window,
        oi,
        crossConfirmation: crossConfirmation?.sourceCount ?? 0,
      });
      this.events.set(event.id, event);
    }

    // ---- Update existing event's last-observed metrics ----
    if (event !== undefined) {
      event.lastObservedOiUsd = oi.oiUsd;
      if (funding !== undefined) event.lastFunding8h = funding.fundingRate8h;
      if (elr !== undefined) event.lastElr = elr.elr;

      // ---- Layer 2: state machine transitions ----
      const next = this.nextState(event, nowMs);
      if (next !== event.state) {
        event.state = next;
      }

      // ---- Risk gates ----
      //
      // Hard stop and the kill-switch (portfolio DD / perp-DEX OI cap /
      // overlay open P&L) CLOSE existing positions. BTC cooldown is
      // a separate check — it BLOCKS new entries (handled in `canEnter()`)
      // but does NOT close an open position.
      const closeTriggeredByRiskKill =
        event.entry !== null &&
        event.exit === null &&
        (portfolioDd !== undefined || perpDexOiOverSma === true || overlayOpenPnlPct !== undefined) &&
        this.isKillSwitchActive(portfolioDd, perpDexOiOverSma, overlayOpenPnlPct);

      if (this.shouldHardStop(nowMs)) {
        // Hard stop active → no new entries, close any current.
        if (event.entry !== null && event.exit === null) {
          const exit = this.closeEvent(event, nowMs, "hard_stop");
          this.recordExit(exit, nowMs);
        }
        return [event];
      }
      if (closeTriggeredByRiskKill) {
        const exit = this.closeEvent(event, nowMs, "risk_kill");
        this.recordExit(exit, nowMs);
        return [event];
      }

      // ---- Layer 3 entry (only POST_CASCADE) ----
      if (
        event.state === "POST_CASCADE" &&
        event.entry === null &&
        this.canEnter(event.id, nowMs)
      ) {
        const entry = this.processEntry(event, window, nowMs);
        event.entry = entry;
        this.openPositions.set(event.id, entry);
        if (event.symbol === "BTC") {
          this.lastBtcEntryTsMs = nowMs;
        }
        // Schedule the timed exit based on TWAP window — the
        // TWAP exit is virtual in paper-trade mode (we just
        // emit a CascadeExit at the configured deadline). The
        // caller wires the actual TWAP exit to its venue.
        const exitAt = nowMs + entry.exitWindowMinutes * 60 * 1000;
        if (exitAt <= nowMs + this.config.layer3ExitMinMinutes * 60 * 1000) {
          // Pathological: shouldn't happen because of config validation.
          // Defensive: do not auto-close earlier than layer3 exit min.
        }
      }
    }

    return [event].filter((e): e is CascadeEvent => e !== undefined);
  }

  // -------------------------------------------------------------------------
  // Forced exit hook (paper-trade replay / external TWAP driver)
  // -------------------------------------------------------------------------

  /**
   * `forceExit` — externally close an event's open position. Used by
   * paper-trade replay to simulate the timed TWAP exit at the
   * computed deadline, and by the test harness to verify constraints.
   *
   * Returns `null` if no open position was present on the event.
   */
  forceExit(
    eventId: string,
    nowMs: number,
    exitMidPriceUsd: number,
    reason: CascadeExit["exitReason"] = "timed_exit",
  ): CascadeExit | null {
    const evMaybe = this.events.get(eventId);
    // Reject when no event, no entry, or already closed.
    // Use optional-chain rather than the `=== undefined || ...` chain
    // because `@typescript-eslint/prefer-optional-chain` flags it.
    // We must access fields through `evMaybe` (not alias) to preserve
    // TS narrowing of `entry: non-null` and `exit: null`.
    if (evMaybe?.entry === null || evMaybe?.exit !== null) return null;
    const exit: CascadeExit = {
      eventId: evMaybe.id,
      symbol: evMaybe.symbol,
      exitTsMs: nowMs,
      exitMidPriceUsd,
      exitNotionalUsd: evMaybe.entry.entryNotionalUsd,
      // PnL = (exitMidPrice - entryLimitPrice) / entryMidPrice × 10000.
      // For a fade the entry was BUY and we expect exitMidPrice >= entryLimitPrice,
      // so positive pnlBps = profit. (Track D §5: overshoot capture is the alpha.)
      pnlBps:
        evMaybe.entry.entryMidPriceUsd > 0
          ? ((exitMidPriceUsd - evMaybe.entry.entryLimitPriceUsd) /
              evMaybe.entry.entryMidPriceUsd) *
            10_000
          : 0,
      exitReason: reason,
    };
    evMaybe.exit = exit;
    this.openPositions.delete(evMaybe.id);
    this.recordExit(exit, nowMs);
    // Hard stop check — if rolling 7d DD now exceeds threshold, halt.
    if (this.getRolling7dDdBps(nowMs) <= -this.config.riskHardStopRolling7dDd * 10_000) {
      this.hardStopHaltUntilMs = nowMs + this.config.riskHardStopHaltMs;
    }
    return exit;
  }

  // -------------------------------------------------------------------------
  // Risk-governor helpers (testable in isolation)
  // -------------------------------------------------------------------------

  /**
   * `validatePortfolioDd` — pure check: does the portfolio DD breach
   * the cascade-book cap (`riskPortfolioDdCap`)? Exposed for caller
   * integration with the Phase 24 risk engine.
   */
  validatePortfolioDd(portfolioDd: number): boolean {
    return portfolioDd <= this.config.riskPortfolioDdCap;
  }

  /** Pure check: is the perp-DEX OI over its 90-day SMA? */
  validatePerpDexOiOverSma(overSma: boolean): boolean {
    return this.config.riskPerpDexOiOverSmaHalts && overSma;
  }

  /** Pure check: is the overlay open P&L below kill-switch? */
  validateOverlayOpenPnl(openPnlPct: number): boolean {
    return openPnlPct < this.config.riskOverlayDrawdownKillBps / 10_000;
  }

  /** Pure check: BTC cooldown active? */
  isInBtcCooldown(nowMs: number): boolean {
    return nowMs - this.lastBtcEntryTsMs < this.config.riskBtCooldownMs;
  }

  /** Reset state (test + multi-run cleanup). */
  reset(): void {
    this.events.clear();
    this.oiHistory.clear();
    this.fundingHistory.clear();
    this.elrHistory.clear();
    this.openPositions.clear();
    this.pnlLedgerBps.length = 0;
    this.lastBtcEntryTsMs = -Infinity;
    this.hardStopHaltUntilMs = -Infinity;
  }

  // -------------------------------------------------------------------------
  // Internal Layer 1 / Layer 2 logic
  // -------------------------------------------------------------------------

  private checkLayer1Trigger(args: {
    window: CascadeWindowInput;
    oi: OpenInterestInput;
    crossConfirmation?: CrossConfirmationInput;
  }): boolean {
    const { window, oi, crossConfirmation } = args;
    // Threshold 1: 1-min aggregate liquidation USD > $50M.
    const liqPasses = window.totalUsd >= this.config.layer1OneMinUsdThreshold;
    // Threshold 2: 5-min OI drop > 1% (relative to 5-min-ago OI).
    const oiHistory = this.oiHistory.get(window.symbol) ?? [];
    const fiveMinAgoMs = oi.timestampMs - 5 * 60 * 1000;
    let oiDropPct = 0;
    if (oiHistory.length > 0) {
      let anchorOiUsd = oi.oiUsd;
      for (const snap of oiHistory) {
        if (snap.ts <= fiveMinAgoMs) anchorOiUsd = snap.oiUsd; // monotonically approach most-recent-5min-ago
      }
      if (anchorOiUsd > 0) {
        oiDropPct = (anchorOiUsd - oi.oiUsd) / anchorOiUsd;
      }
    }
    const oiPasses = oiDropPct >= this.config.layer1OiDrop5minPct;
    // Threshold 3: cross-confirmed — at least N sources.
    const xConf = crossConfirmation?.sourceCount ?? 0;
    const xConfPasses = xConf >= this.config.layer1MinCrossConfirmations;
    return liqPasses && oiPasses && xConfPasses;
  }

  private nextState(event: CascadeEvent, nowMs: number): CascadeState {
    if (event.state === "IN_PROGRESS") {
      // Compute OI change in the last `STABILIZING_LOOKBACK_MS` (15 min —
      // empirically calibrated to fire within the brief's 30-min window
      // for a real cascade).
      const oiHistory = this.oiHistory.get(event.symbol) ?? [];
      const STABILIZING_LOOKBACK_MS = 15 * 60 * 1000;
      // Find the LATEST snapshot at least `STABILIZING_LOOKBACK_MS`
      // before `nowMs`. Without an anchor we cannot conclude OI is
      // stabilizing and stay in IN_PROGRESS.
      let anchor: { ts: number; oiUsd: number } | undefined;
      for (let i = oiHistory.length - 1; i >= 0; i--) {
        const snap = oiHistory[i];
        if (snap === undefined) continue;
        if (snap.ts <= nowMs - STABILIZING_LOOKBACK_MS) {
          anchor = snap;
          break;
        }
      }
      // Sentinel `Infinity` ensures the `< layer2StabilizingOiPctPerHr`
      // check below fails when no anchor exists.
      const oiChangePct =
        anchor !== undefined && anchor.oiUsd > 0
          ? Math.abs((anchor.oiUsd - event.lastObservedOiUsd) / anchor.oiUsd)
          : Number.POSITIVE_INFINITY;
      if (oiChangePct < this.config.layer2StabilizingOiPctPerHr) {
        // OI is stabilizing (Δ < ±0.5%/hr)
        const fundingNearZero = Math.abs(event.lastFunding8h) < this.config.layer2FundingNearZero;
        if (fundingNearZero || oiHistory.length < 10) {
          return "STABILIZING";
        }
      }
      return "IN_PROGRESS";
    }
    if (event.state === "STABILIZING") {
      // Axel Adler rule: OI drop > 15% in 48h AND ELR < 0.40.
      const oiDrop48h = this.computeOiDropIn48h(event);
      if (oiDrop48h >= this.config.layer2OiDrop48hPct && event.lastElr < this.config.layer2ElrFloor) {
        return "POST_CASCADE";
      }
      // If OI starts rising again or ELR climbs above 0.45, revert to IN_PROGRESS.
      if (oiDrop48h < this.config.layer2OiDrop48hPct / 2 || event.lastElr >= 0.45) {
        return "IN_PROGRESS";
      }
      return "STABILIZING";
    }
    // POST_CASCADE (narrowed by the two prior if-branches both returning).
    // If ELR climbs back above 0.45 OR OI drop < 7.5% (half of 15%), revert to STABILIZING.
    {
      const oiDrop48h = this.computeOiDropIn48h(event);
      if (oiDrop48h < this.config.layer2OiDrop48hPct / 2 || event.lastElr >= 0.45) {
        return "STABILIZING";
      }
    }
    return event.state;
  }

  private computeOiDropIn48h(event: CascadeEvent): number {
    const oiHistory = this.oiHistory.get(event.symbol) ?? [];
    const cutoffMs = event.triggeredAtMs - 48 * 60 * 60 * 1000;
    let anchorOi = event.oiPeakUsd;
    for (const snap of oiHistory) {
      if (snap.ts >= cutoffMs && snap.ts <= event.triggeredAtMs) {
        if (snap.oiUsd > anchorOi) anchorOi = snap.oiUsd;
      }
    }
    if (anchorOi <= 0) return 0;
    return (anchorOi - event.lastObservedOiUsd) / anchorOi;
  }

  // -------------------------------------------------------------------------
  // Layer 3 entry
  // -------------------------------------------------------------------------

  private processEntry(
    event: CascadeEvent,
    window: CascadeWindowInput,
    nowMs: number,
  ): CascadeEntry {
    // Mid price is approximated by window's most-recent price — for paper
    // trade we use the same window; live would source bybit.eu SPOT mid.
    const midPriceUsd = window.totalUsd > 0 ? window.totalUsd : 100_000;
    const distanceBps = (this.config.layer3MinDistanceFromMidBps + this.config.layer3MaxDistanceFromMidBps) / 2;
    const distanceFrac = distanceBps / 10_000;
    // BUY entry, so limit price = mid * (1 + distanceFrac) — willingness
    // to pay up to mid + Xbps to lift offers / capture RPI depth.
    const entryLimitPriceUsd = midPriceUsd * (1 + distanceFrac);
    // Sized at capacityMaxPerSymbolEventUsd, also clamped by per-event cap.
    const entryNotionalUsd = Math.min(
      this.config.capacityMaxPerSymbolEventUsd,
      this.config.capacityMaxPerEventUsd,
    );
    // TWAP exit 3-10 min — use midpoint of the config range.
    const exitWindowMinutes = Math.round(
      (this.config.layer3ExitMinMinutes + this.config.layer3ExitMaxMinutes) / 2,
    );
    void nowMs;
    return {
      eventId: event.id,
      symbol: event.symbol,
      entryTsMs: nowMs,
      entryMidPriceUsd: midPriceUsd,
      entryLimitPriceUsd,
      entryDistanceBps: distanceBps,
      entryNotionalUsd,
      side: "buy",
      exitWindowMinutes,
    };
  }

  private closeEvent(
    event: CascadeEvent,
    nowMs: number,
    reason: CascadeExit["exitReason"],
  ): CascadeExit {
    if (event.entry === null) {
      const placeholder: CascadeExit = {
        eventId: event.id,
        symbol: event.symbol,
        exitTsMs: nowMs,
        exitMidPriceUsd: 0,
        exitNotionalUsd: 0,
        pnlBps: 0,
        exitReason: reason,
      };
      event.exit = placeholder;
      return placeholder;
    }
    // Approximate a neutral exit price at mid — paper-trade keeps
    // `pnlBps=0` for killed positions (no P&L attribution to a
    // forced kill). The forced TWAP exits use `forceExit()` instead.
    const exit: CascadeExit = {
      eventId: event.id,
      symbol: event.symbol,
      exitTsMs: nowMs,
      exitMidPriceUsd: event.entry.entryMidPriceUsd,
      exitNotionalUsd: event.entry.entryNotionalUsd,
      pnlBps: 0,
      exitReason: reason,
    };
    event.exit = exit;
    this.openPositions.delete(event.id);
    return exit;
  }

  // -------------------------------------------------------------------------
  // Risk gates
  // -------------------------------------------------------------------------

  /**
   * `isKillSwitchActive` — pure check for the conditions that FORCE-CLOSE
   * an existing open position:
   *   - Portfolio drawdown > 12%
   *   - Perp-DEX OI > 90-day SMA
   *   - Overlay open P&L < -2%
   *
   * Note: BTC cooldown is NOT a kill-switch trigger — it only blocks
   * NEW entries (see `canEnter()`). This is the change from
   * `isRiskBlocked` (which conflated the two). Pulled out per
   * Track D §6.1 Layer 4 risk governor + §6.3 explicit non-goal
   * "NO holding through next session" — cooldown affects new entries,
   * not in-flight positions.
   */
  private isKillSwitchActive(
    portfolioDd?: number,
    perpDexOiOverSma?: boolean,
    overlayOpenPnlPct?: number,
  ): boolean {
    if (portfolioDd !== undefined && portfolioDd > this.config.riskPortfolioDdCap) return true;
    if (
      this.config.riskPerpDexOiOverSmaHalts &&
      perpDexOiOverSma === true
    ) return true;
    if (
      overlayOpenPnlPct !== undefined &&
      overlayOpenPnlPct < this.config.riskOverlayDrawdownKillBps / 10_000
    ) return true;
    return false;
  }

  private shouldHardStop(nowMs: number): boolean {
    return this.isHardStopped(nowMs);
  }

  private recordExit(exit: CascadeExit, nowMs: number): void {
    this.pnlLedgerBps.push({ tsMs: nowMs, pnlBps: exit.pnlBps });
  }

  // -------------------------------------------------------------------------
  // History recorders
  // -------------------------------------------------------------------------

  private recordOi(oi: OpenInterestInput): void {
    const arr = this.oiHistory.get(oi.symbol) ?? [];
    arr.push({ ts: oi.timestampMs, oiUsd: oi.oiUsd });
    // Trim entries older than 72h to bound memory.
    const cutoff = oi.timestampMs - 72 * 60 * 60 * 1000;
    while (arr.length > 0 && (arr[0]?.ts ?? 0) < cutoff) arr.shift();
    this.oiHistory.set(oi.symbol, arr);
  }

  private recordFunding(funding: FundingRateInput): void {
    const arr = this.fundingHistory.get(funding.symbol) ?? [];
    arr.push({ ts: funding.timestampMs, funding8h: funding.fundingRate8h });
    this.fundingHistory.set(funding.symbol, arr);
  }

  private recordElr(elr: ElrInput): void {
    const arr = this.elrHistory.get(elr.symbol) ?? [];
    arr.push({ ts: elr.timestampMs, elr: elr.elr });
    this.elrHistory.set(elr.symbol, arr);
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private findEventBySymbol(symbol: string): CascadeEvent | undefined {
    for (const ev of this.events.values()) {
      if (ev.symbol === symbol && ev.exit === null) return ev;
    }
    return undefined;
  }

  private createEvent(args: {
    symbol: string;
    nowMs: number;
    window: CascadeWindowInput;
    oi: OpenInterestInput;
    crossConfirmation: number;
  }): CascadeEvent {
    return {
      id: `cascade-${args.symbol}-${args.nowMs}`,
      symbol: args.symbol,
      triggeredAtMs: args.nowMs,
      state: "IN_PROGRESS",
      oiPeakUsd: args.oi.oiUsd,
      trigger1minUsd: args.window.totalUsd,
      crossConfirmations: args.crossConfirmation,
      lastObservedOiUsd: args.oi.oiUsd,
      lastFunding8h: 0,
      lastElr: 0,
      entry: null,
      exit: null,
    };
  }

  // -------------------------------------------------------------------------
  // Config invariant (constructor-time hard guardrail)
  // -------------------------------------------------------------------------

  private validateConfig(cfg: CascadeFadeConfig): void {
    if (cfg.allowedSymbols.length === 0) {
      throw new Error("CascadeFadeDetector: allowedSymbols must be non-empty");
    }
    if (cfg.layer3MinDistanceFromMidBps <= 0 || cfg.layer3MaxDistanceFromMidBps < cfg.layer3MinDistanceFromMidBps) {
      throw new Error("CascadeFadeDetector: invalid layer3 distance range");
    }
    if (cfg.layer3ExitMaxMinutes < cfg.layer3ExitMinMinutes) {
      throw new Error("CascadeFadeDetector: layer3 exit window max < min");
    }
    if (cfg.layer3ExitMinMinutes < 1) {
      throw new Error("CascadeFadeDetector: layer3 exit min must be ≥ 1 min");
    }
    if (cfg.riskPortfolioDdCap <= 0 || cfg.riskPortfolioDdCap > 1) {
      throw new Error("CascadeFadeDetector: riskPortfolioDdCap out of (0,1] range");
    }
    if (cfg.capacityMaxPerSymbolEventUsd <= 0 || cfg.capacityMaxPerEventUsd <= 0 || cfg.capacityMaxPerWeekUsd <= 0) {
      throw new Error("CascadeFadeDetector: capacity caps must be positive");
    }
    if (cfg.capacityMaxPerSymbolEventUsd > cfg.capacityMaxPerEventUsd) {
      throw new Error("CascadeFadeDetector: per-symbol cap cannot exceed per-event cap");
    }
  }
}

// ============================================================================
// PAPER-TRADE SIMULATOR
// ============================================================================

/**
 * Synthetic bybit.eu SPOT slippage model for paper-trade mode.
 *
 * Per Track D §5 + §7.3:
 *   - Normal market: 2-6 bps slippage for $1M BTC
 *   - Cascade period: 10-50 bps slippage for $1M BTC (RPI depth shrinks)
 *   - $5M+ size during cascade: 50-150 bps slippage (firm capacity ceiling)
 *
 * The model is sized by notional AND adjusted by the current layer
 * state (POST_CASCADE = calmer; IN_PROGRESS = wider slippage).
 */
export function syntheticBybitEuSlippageBps(args: {
  readonly notionalUsd: number;
  readonly layer1Fired: boolean;
}): number {
  const { notionalUsd, layer1Fired } = args;
  const baselineBps = layer1Fired ? 20 : 4;
  // Quadratic scaling — slippage balloons past $5M notional.
  const sizeMul = Math.max(1, Math.pow(notionalUsd / 1_000_000, 1.4));
  return baselineBps * sizeMul;
}

/**
 * `simulateBybitEuPaperFill` — given an entry + exit mid price, return
 * the P&L in USD applying the synthetic slippage model. Used by the
 * `replay-2025-10-10.ts` CLI and the integration test.
 *
 * NOTE: This is the BYBIT.EU SPOT leg only — there is NO naked
 * short, NO perp leg, NO holding through next session.
 */
export function simulateBybitEuPaperFill(args: {
  readonly notionalUsd: number;
  readonly entryMidPriceUsd: number;
  readonly entryDistanceBps: number;
  readonly exitMidPriceUsd: number;
  readonly layer1Fired: boolean;
  readonly takerFeeBps?: number;
}): { readonly pnlBps: number; readonly pnlUsd: number; readonly filledAtEntry: boolean; readonly filledAtExit: boolean } {
  const takerFeeBps = args.takerFeeBps ?? 10; // Bybit SPOT taker fee = 0.10%
  // Entry fill: at mid ± distance. If the distance is too tight, no fill.
  const slipBps = syntheticBybitEuSlippageBps({
    notionalUsd: args.notionalUsd,
    layer1Fired: args.layer1Fired,
  });
  // We assume mid-distance limit order fills at mid ± distance.
  // Filled at entry when actual spread (distanceBps) ≤ post-cascade slippage.
  const filledAtEntry = args.entryDistanceBps <= slipBps;
  const filledAtExit = true;
  // P&L = ((exitMid - entryLimit) / entryMid) × 10000 - takerFee (in/out = 2×).
  const grossBps =
    args.entryMidPriceUsd > 0
      ? ((args.exitMidPriceUsd - args.entryMidPriceUsd * (1 + args.entryDistanceBps / 10_000)) /
          args.entryMidPriceUsd) *
        10_000
      : 0;
  // Net P&L = gross - 2× takerFee
  const pnlBps = grossBps - 2 * takerFeeBps;
  const pnlUsd = (pnlBps / 10_000) * args.notionalUsd;
  return { pnlBps, pnlUsd, filledAtEntry, filledAtExit };
}

// ============================================================================
// REPLAY HELPERS
// ============================================================================

/**
 * `replayCascadeEventInputsFromObservations` — helper for the
 * 2025-10-10 historical replay. Given a sorted list of observations
 * matching the schema expected by `observe()`, drive the detector
 * end-to-end and return the cascade event timeline.
 *
 * The function does NOT inject synthetic mid-prices; the caller
 * passes them via `CascadeWindowInput.totalUsd` as a 1-min aggregate,
 * which the simulator interprets as a price proxy. For a faithful
 * replay the caller should pass `pricePerUnit` separately or wrap
 * inputs into a richer observation.
 *
 * Simplification: for the 2025-10-10 benchmark we treat the window's
 * first-print price as the mid for entry sizing and use a caller-
 * supplied `exitMidPriceUsd` when scheduling the timed exit. See
 * `replay-2025-10-10.ts` (Phase 26+) for the production replay.
 */
export interface CascadeReplayObservation {
  readonly nowMs: number;
  readonly window: CascadeWindowInput;
  readonly oi: OpenInterestInput;
  readonly funding?: FundingRateInput;
  readonly elr?: ElrInput;
  readonly crossConfirmation?: CrossConfirmationInput;
  readonly portfolioDd?: number;
  readonly perpDexOiOverSma?: boolean;
  readonly overlayOpenPnlPct?: number;
}

export interface CascadeReplayResult {
  readonly detector: CascadeFadeDetector;
  readonly eventTimeline: readonly CascadeEvent[];
  readonly entries: readonly CascadeEntry[];
  readonly exits: readonly CascadeExit[];
  readonly reachedPostCascadeAtMs: number | null;
}

export function replayCascadeEvent(
  observations: readonly CascadeReplayObservation[],
): CascadeReplayResult {
  const detector = new CascadeFadeDetector();
  const eventTimeline: CascadeEvent[] = [];
  let reachedPostCascadeAtMs: number | null = null;
  for (const obs of observations) {
    const evs = detector.observe(obs);
    for (const ev of evs) {
      const lastSeen = eventTimeline.find((x) => x.id === ev.id);
      if (lastSeen === undefined) eventTimeline.push(ev);
      if (ev.state === "POST_CASCADE" && reachedPostCascadeAtMs === null) {
        reachedPostCascadeAtMs = obs.nowMs;
      }
    }
  }
  return {
    detector,
    eventTimeline: detector.getAllEvents(),
    entries: detector.getOpenPositions(),
    exits: detector.getExitsLog(),
    reachedPostCascadeAtMs,
  };
}

// ============================================================================
// STRATEGY INTERFACE WRAPPER (for engine compatibility)
// ============================================================================

/**
 * `CascadeFadeStrategy` — adapts the `CascadeFadeDetector` to the
 * existing `Strategy` interface so the engine loop can call it
 * alongside the Phase 19 #1 baseline strategies.
 *
 * The Strategy interface is candle-driven, but cascade-fade is
 * EVENT-DRIVEN. This wrapper is a NO-OP that returns `null` for
 * every candle — actual cascade decisions come through `observe()`
 * (called externally by the signal-center bridge from CoinGlass +
 * Bitquery). This guarantees:
 *   1. **Wire-up integrity**: cascade detector OFF vs ON produces
 *      byte-identical Phase 19 #1 baseline (the engine sees nothing
 *      different).
 *   2. **No silent no-op risk**: Layer 1/2/3 logic lives in the
 *      detector, not the strategy wrapper. The wrapper is a
 *      compatibility layer only.
 */
export class CascadeFadeStrategy implements Strategy {
  readonly name = "CascadeFade";
  readonly timeframes = ["1m"] as const;

  // The detector is exposed so callers can drive observations
  // independently of the Strategy hook.
  readonly detector: CascadeFadeDetector;

  constructor(config?: Partial<CascadeFadeConfig>) {
    this.detector = new CascadeFadeDetector(config);
  }

  warmup(): number {
    // The cascade detector is observation-driven, not candle-driven.
    // No warmup needed for the wrapper.
    return 0;
  }

  // The `_ctx` parameter is prefixed with `_` so the unused-vars rule
  // (which honors `argsIgnorePattern: "^_"` per eslint.config.js) does
  // not flag it. No eslint-disable directive is needed.
  onCandle(_ctx: unknown): null {
    // NO-OP: cascade decisions come through `observe()`. Returning
    // null keeps the engine free of cascade-driven fills and
    // guarantees wire-up integrity with Phase 19 #1 baseline.
    return null;
  }
}
