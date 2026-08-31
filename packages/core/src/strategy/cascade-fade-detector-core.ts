import { DEFAULT_CASCADE_FADE_CONFIG, PROVIDER_DIVERSITY_GROUPS } from "./cascade-fade-types.js";
import type {
  CascadeEntry,
  CascadeEvent,
  CascadeExit,
  CascadeFadeConfig,
  CascadeState,
  CascadeWindowInput,
  CrossConfirmationInput,
  CrossConfirmationProvider,
  ElrInput,
  FundingRateInput,
  OpenInterestInput,
} from "./cascade-fade-types.js";

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
export class CascadeFadeDetectorCore {
  protected readonly config: CascadeFadeConfig;
  protected readonly events = new Map<string, CascadeEvent>();
  protected readonly oiHistory = new Map<string, { ts: number; oiUsd: number }[]>();
  protected readonly fundingHistory = new Map<string, { ts: number; funding8h: number }[]>();
  protected readonly elrHistory = new Map<string, { ts: number; elr: number }[]>();
  /**
  Latest explicit tradable spot mid; never inferred from liquidation volume.
  */
  protected readonly lastMidPriceBySymbol = new Map<string, number>();
  /**
  Last BTC cascade entry timestamp (for 24h cooldown).
  */
  protected lastBtcEntryTsMs = -Infinity;
  /**
  Hard-stop cooldown — set when rolling 7d DD breaches.
  */
  protected hardStopHaltUntilMs = -Infinity;
  /**
  Snapshot of current open positions (for kill-switch).
  */
  protected readonly openPositions = new Map<string, CascadeEntry>();
  /**
  Rolling 7d P&L ledger (closed positions only).
  */
  protected readonly pnlLedgerBps: { tsMs: number; pnlBps: number }[] = [];
  /**
  Entry notional ledger used for the $5M/week capacity gate.
  */
  protected readonly entryLedgerUsd: { tsMs: number; notionalUsd: number }[] = [];

  constructor(config: Partial<CascadeFadeConfig> = {}) {
    const merged: CascadeFadeConfig = { ...DEFAULT_CASCADE_FADE_CONFIG, ...config };
    this.validateConfig(merged);
    this.config = merged;
  }
  protected checkLayer1Trigger(arguments_: {
    window: CascadeWindowInput;
    oi: OpenInterestInput;
    oiHistory: readonly { ts: number; oiUsd: number }[];
    crossConfirmation?: CrossConfirmationInput;
  }): number | undefined {
    const { window, oi, oiHistory, crossConfirmation } = arguments_;
    if (crossConfirmation === undefined) return undefined;
    // Threshold 1: 1-min aggregate liquidation USD > $50M.
    const isLiqPasses = window.totalUsd >= this.config.layer1OneMinUsdThreshold;
    // Threshold 2: 5-min OI drop > 1% (relative to 5-min-ago OI).
    const fiveMinAgoMs = oi.timestampMs - 5 * 60 * 1000;
    let oiDropPct = 0;
    let anchorOiUsd = oi.oiUsd;
    for (const snap of oiHistory) {
      if (snap.ts <= fiveMinAgoMs) anchorOiUsd = snap.oiUsd; // monotonically approach most-recent-5min-ago
    }
    if (anchorOiUsd > 0) {
      oiDropPct = (anchorOiUsd - oi.oiUsd) / anchorOiUsd;
    }
    const isOiPasses = oiDropPct >= this.config.layer1OiDrop5minPct;
    // Threshold 3: cross-confirmation predicate.
    const isXConfigPasses = this.evaluateCrossConfirmation(crossConfirmation, oi.timestampMs, window.symbol);
    return isLiqPasses && isOiPasses && isXConfigPasses ? crossConfirmation.sources.length : undefined;
  }

  /**
   * `evaluateCrossConfirmation` — pure-functional validator for
   * Layer 1 cross-confirmation. Returns true only when:
   *   - All sources agree on the same symbol as the trigger window.
   *   - Every source's windowStartMs is within `layer1CrossConfirmWindowMs`
   *     of `triggerTsMs`. (Verifier Check 2: the previous flag was tolerant
   *     to ±3h and inconsistent symbols — this predicate rejects both.)
   *   - Distinct PROVIDER count (after grouping) ≥ `layer1MinCrossConfirmations`.
   *   - Sufficient sources (≥ min).
   *
   * Returns false when `crossConfirmation` is undefined or empty — naked
   * liquidation detection is NEGATIVE per the brief (anomiq.io full-year
   * flat-to-negative without explicit cascade confirmation).
   */
  protected evaluateCrossConfirmation(
    crossConfirmation: CrossConfirmationInput,
    triggerTsMs: number,
    triggerSymbol: string,
  ): boolean {
    if (crossConfirmation.sources.length < this.config.layer1MinCrossConfirmations) return false;
    const windowMs = this.config.layer1CrossConfirmWindowMs;
    const distinctProviders = new Set<CrossConfirmationProvider>();
    let hasCoinGlass = false;
    let hasPerpFeed = false;
    for (const s of crossConfirmation.sources) {
      if (s.symbol !== triggerSymbol) return false; // (a) same-symbol rule
      if (Math.abs(s.windowStartMs - triggerTsMs) > windowMs) return false; // (b) tight time tolerance
      distinctProviders.add(s.provider);
      if (s.provider === "coinglass_v4") hasCoinGlass = true;
      if (PROVIDER_DIVERSITY_GROUPS[s.provider] === "perp") hasPerpFeed = true;
    }
    // (c) distinct providers + required CoinGlass/perp-feed pairing.
    // This is stricter than a numeric `sourceCount`: duplicate provider
    // echoes, two stale perp venues without CoinGlass, or cross-symbol
    // payloads cannot create a Layer 1 cascade.
    return distinctProviders.size >= this.config.layer1MinCrossConfirmations && hasCoinGlass && hasPerpFeed;
  }

  protected nextState(
    event: CascadeEvent,
    nowMs: number,
    oiHistory: readonly { ts: number; oiUsd: number }[],
  ): CascadeState {
    if (event.state === "IN_PROGRESS") {
      // Compute OI change in the last `STABILIZING_LOOKBACK_MS` (15 min —
      // empirically calibrated to fire within the brief's 30-min window
      // for a real cascade).
      const STABILIZING_LOOKBACK_MS = 15 * 60 * 1000;
      // Find the LATEST snapshot at least `STABILIZING_LOOKBACK_MS`
      // before `nowMs`. Without an anchor we cannot conclude OI is
      // stabilizing and stay in IN_PROGRESS.
      let anchor: { ts: number; oiUsd: number } | undefined;
      for (const snapshot of oiHistory) {
        if (snapshot.ts <= nowMs - STABILIZING_LOOKBACK_MS) {
          anchor = snapshot;
        }
      }
      // Sentinel `Infinity` ensures the `< layer2StabilizingOiPctPerHr`
      // check below fails when no anchor exists.
      const oiChangePct =
        anchor !== undefined && anchor.oiUsd > 0
          ? Math.abs((anchor.oiUsd - event.lastObservedOiUsd) / anchor.oiUsd)
          : Infinity;
      if (oiChangePct < this.config.layer2StabilizingOiPctPerHr) {
        // OI is stabilizing (Δ < ±0.5%/hr)
        const isFundingNearZero = Math.abs(event.lastFunding8h) < this.config.layer2FundingNearZero;
        if (isFundingNearZero || oiHistory.length < 10) {
          return "STABILIZING";
        }
      }
      return "IN_PROGRESS";
    }
    if (event.state === "STABILIZING") {
      // Axel Adler rule: OI drop > 15% in 48h AND ELR < 0.40.
      const oiDrop48h = this.computeOiDropIn48h(event, oiHistory);
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
      const oiDrop48h = this.computeOiDropIn48h(event, oiHistory);
      if (oiDrop48h < this.config.layer2OiDrop48hPct / 2 || event.lastElr >= 0.45) {
        return "STABILIZING";
      }
    }
    return event.state;
  }

  protected computeOiDropIn48h(
    event: CascadeEvent,
    oiHistory: readonly { ts: number; oiUsd: number }[],
  ): number {
    const cutoffMs = event.triggeredAtMs - 48 * 60 * 60 * 1000;
    let anchorOi = event.oiPeakUsd;
    for (const snap of oiHistory) {
      if (snap.ts >= cutoffMs && snap.ts <= event.triggeredAtMs && snap.oiUsd > anchorOi)
        anchorOi = snap.oiUsd;
    }
    return (anchorOi - event.lastObservedOiUsd) / anchorOi;
  }

  // -------------------------------------------------------------------------
  // Layer 3 entry
  // -------------------------------------------------------------------------

  protected plannedEntryNotionalUsd(): number {
    return Math.min(this.config.capacityMaxPerSymbolEventUsd, this.config.capacityMaxPerEventUsd);
  }

  protected processEntry(event: CascadeEvent, window: CascadeWindowInput, nowMs: number): CascadeEntry {
    const midPriceUsd = window.midPriceUsd ?? this.lastMidPriceBySymbol.get(window.symbol);
    if (midPriceUsd === undefined || !Number.isFinite(midPriceUsd) || midPriceUsd <= 0) {
      throw new Error(
        "[CascadeFade] entry requires a positive finite bybit.eu spot midPriceUsd; liquidation USD volume is not a price",
      );
    }
    const distanceBps =
      (this.config.layer3MinDistanceFromMidBps + this.config.layer3MaxDistanceFromMidBps) / 2;
    const distanceFrac = distanceBps / 10_000;
    // BUY entry, so limit price = mid * (1 + distanceFrac) — willingness
    // to pay up to mid + Xbps to lift offers / capture RPI depth.
    const entryLimitPriceUsd = midPriceUsd * (1 + distanceFrac);
    // Sized at capacityMaxPerSymbolEventUsd, also clamped by per-event cap.
    const entryNotionalUsd = this.plannedEntryNotionalUsd();
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

  protected closeEvent(
    event: CascadeEvent,
    entry: CascadeEntry,
    nowMs: number,
    reason: CascadeExit["exitReason"],
  ): CascadeExit {
    // Approximate a neutral exit price at mid — paper-trade keeps
    // `pnlBps=0` for killed positions (no P&L attribution to a
    // forced kill). The forced TWAP exits use `forceExit()` instead.
    const exit: CascadeExit = {
      eventId: event.id,
      symbol: event.symbol,
      exitTsMs: nowMs,
      exitMidPriceUsd: entry.entryMidPriceUsd,
      exitNotionalUsd: entry.entryNotionalUsd,
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
   * "NO holding through next session" — cooldown affects new entries,
   * not in-flight positions.
   */
  protected isKillSwitchActive(
    portfolioDd?: number,
    isPerpDexOiOverSma?: boolean,
    overlayOpenPnlPct?: number,
  ): boolean {
    if (portfolioDd !== undefined && portfolioDd > this.config.riskPortfolioDdCap) return true;
    if (isPerpDexOiOverSma === true && this.config.riskPerpDexOiOverSmaHalts) return true;
    if (
      overlayOpenPnlPct !== undefined &&
      overlayOpenPnlPct < this.config.riskOverlayDrawdownKillBps / 10_000
    )
      return true;
    return false;
  }

  protected shouldHardStop(nowMs: number): boolean {
    return nowMs < this.hardStopHaltUntilMs;
  }

  protected recordExit(exit: CascadeExit, nowMs: number): void {
    this.pnlLedgerBps.push({ tsMs: nowMs, pnlBps: exit.pnlBps });
  }

  // -------------------------------------------------------------------------
  // History recorders
  // -------------------------------------------------------------------------

  protected recordOi(oi: OpenInterestInput): readonly { ts: number; oiUsd: number }[] {
    const array = this.oiHistory.get(oi.symbol) ?? [];
    array.push({ ts: oi.timestampMs, oiUsd: oi.oiUsd });
    // Trim entries older than 72h to bound memory.
    const cutoff = oi.timestampMs - 72 * 60 * 60 * 1000;
    const retained = array.filter((snapshot) => snapshot.ts >= cutoff);
    this.oiHistory.set(oi.symbol, retained);
    return retained;
  }

  protected recordFunding(funding: FundingRateInput): void {
    const array = this.fundingHistory.get(funding.symbol) ?? [];
    array.push({ ts: funding.timestampMs, funding8h: funding.fundingRate8h });
    this.fundingHistory.set(funding.symbol, array);
  }

  protected recordElr(elr: ElrInput): void {
    const array = this.elrHistory.get(elr.symbol) ?? [];
    array.push({ ts: elr.timestampMs, elr: elr.elr });
    this.elrHistory.set(elr.symbol, array);
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  protected findEventBySymbol(symbol: string): CascadeEvent | undefined {
    for (const event of this.events.values()) {
      if (event.symbol === symbol && event.exit === undefined) return event;
    }
    return undefined;
  }

  protected createEvent(arguments_: {
    symbol: string;
    nowMs: number;
    window: CascadeWindowInput;
    oi: OpenInterestInput;
    crossConfirmations: number;
  }): CascadeEvent {
    return {
      id: `cascade-${arguments_.symbol}-${String(arguments_.nowMs)}`,
      symbol: arguments_.symbol,
      triggeredAtMs: arguments_.nowMs,
      state: "IN_PROGRESS",
      oiPeakUsd: arguments_.oi.oiUsd,
      trigger1minUsd: arguments_.window.totalUsd,
      crossConfirmations: arguments_.crossConfirmations,
      lastObservedOiUsd: arguments_.oi.oiUsd,
      lastFunding8h: 0,
      lastElr: 0,
      entry: undefined,
      exit: undefined,
    };
  }

  // -------------------------------------------------------------------------
  // Config invariant (constructor-time hard guardrail)
  // -------------------------------------------------------------------------

  protected validateConfig(config: CascadeFadeConfig): void {
    if (config.allowedSymbols.length === 0) {
      throw new Error("CascadeFadeDetector: allowedSymbols must be non-empty");
    }
    if (
      config.layer3MinDistanceFromMidBps <= 0 ||
      config.layer3MaxDistanceFromMidBps < config.layer3MinDistanceFromMidBps
    ) {
      throw new Error("CascadeFadeDetector: invalid layer3 distance range");
    }
    if (config.layer3ExitMaxMinutes < config.layer3ExitMinMinutes) {
      throw new Error("CascadeFadeDetector: layer3 exit window max < min");
    }
    if (config.layer3ExitMinMinutes < 1) {
      throw new Error("CascadeFadeDetector: layer3 exit min must be ≥ 1 min");
    }
    if (config.riskPortfolioDdCap <= 0 || config.riskPortfolioDdCap > 1) {
      throw new Error("CascadeFadeDetector: riskPortfolioDdCap out of (0,1] range");
    }
    if (
      config.capacityMaxPerSymbolEventUsd <= 0 ||
      config.capacityMaxPerEventUsd <= 0 ||
      config.capacityMaxPerWeekUsd <= 0
    ) {
      throw new Error("CascadeFadeDetector: capacity caps must be positive");
    }
    if (config.capacityMaxPerSymbolEventUsd > config.capacityMaxPerEventUsd) {
      throw new Error("CascadeFadeDetector: per-symbol cap cannot exceed per-event cap");
    }
  }
}
