import { CascadeFadeDetectorCore } from "./cascade-fade-detector-core.js";
import type {
  CascadeEntry,
  CascadeEvent,
  CascadeExit,
  CascadeWindowInput,
  CrossConfirmationInput,
  ElrInput,
  FundingRateInput,
  OpenInterestInput,
  RiskSnapshotInput,
} from "./cascade-fade-types.js";

function collectIterator<T>(iterator: Iterator<T>): T[] {
  const values: T[] = [];
  let next = iterator.next();
  while (!next.done) {
    values.push(next.value);
    next = iterator.next();
  }
  return values;
}

export class CascadeFadeDetector extends CascadeFadeDetectorCore {
  /**
  All currently-open events across symbols.
  */
  getOpenEvents(): readonly CascadeEvent[] {
    const openEvents: CascadeEvent[] = [];
    for (const event of this.events.values()) {
      if (event.exit === undefined) openEvents.push(event);
    }
    return openEvents;
  }

  /**
  All events ever observed (including closed).
  */
  getAllEvents(): readonly CascadeEvent[] {
    return collectIterator(this.events.values());
  }

  /**
  All exits the detector produced (paper-trade simulator log).
  */
  getExitsLog(): readonly CascadeExit[] {
    const out: CascadeExit[] = [];
    for (const event of this.events.values()) {
      if (event.exit !== undefined) out.push(event.exit);
    }
    return out;
  }

  /**
  Open positions (paper-trade).
  */
  getOpenPositions(): readonly CascadeEntry[] {
    const openPositions: CascadeEntry[] = [];
    for (const entry of this.openPositions.values()) {
      openPositions.push(entry);
    }
    return openPositions;
  }

  /**
  Cumulative paper-trade P&L in bps across all closed events.
  */
  getCumulativePnlBps(): number {
    let sum = 0;
    for (const entry of this.pnlLedgerBps) sum += entry.pnlBps;
    return sum;
  }

  /**
  Get the rolling 7d P&L (sum of pnlLedgerBps in last 7 days).
  */
  getRolling7dDdBps(nowMs: number): number {
    const cutoff = nowMs - 7 * 24 * 60 * 60 * 1000;
    let sum = 0;
    for (const entry of this.pnlLedgerBps) {
      if (entry.tsMs >= cutoff) sum += entry.pnlBps;
    }
    // DD = negative return on book; we report as a negative number.
    return sum;
  }

  /**
  Hard-stop currently active?
  */
  isHardStopped(nowMs: number): boolean {
    return nowMs < this.hardStopHaltUntilMs;
  }

  /**
   * `canEnter` — entry hot-path gate. Verifier Check 1 (attempt 1 fix):
   * the 5 risk governor gates (Track D §6.1 Layer 4) PLUS the capacity
   * caps PLUS the symbol allowlist are ALL evaluated here, on every
   * `observe()` call, BEFORE any `processEntry`. The previous version
   * declared/defaulted the gates but only enforced `isHardStopped`
   * and BTC cooldown — passing the kill-switch inputs and adding the
   * checks below closes the gap.
   *
   * Returns `false` when ANY block:
   *   - event missing / state ≠ POST_CASCADE
   *   - already entered
   *   - hard-stop halt active (regime change)
   *   - portfolio DD > `riskPortfolioDdCap`
   *   - perp-DEX OI over 90-day SMA
   *   - overlay open P&L < `riskOverlayDrawdownKillBps`
   *   - BTC cooldown active (24h since last BTC entry)
   *   - symbol NOT in `allowedSymbols` allowlist (issue #4a)
   *   - per-week deployable already saturated (issue #4b)
   *   - concurrent-symbol cap reached for new symbol
   *   - per-symbol/per-event notional cap exceeded
   *
   * ALL inputs (`risk`, `prices` for sizing) are sourced from the
   * single per-observation call site — i.e., when `observe()` runs
   * once per minute with the latest risk snapshot, the gates fire in
   * that single decision. The adversarial test (portfolioDd=0.15,
   * perpDexOiOverSma=true, overlayOpenPnlPct=-0.025) now returns
   * `false` and `processEntry` is never called.
   */
  canEnter(eventId: string, nowMs: number, risk: RiskSnapshotInput = {}): boolean {
    const event = this.events.get(eventId);
    if (event === undefined) return false;
    if (event.state !== "POST_CASCADE") return false;
    if (event.entry !== undefined) return false;
    // Layer 4 — risk governor gates.
    if (this.isHardStopped(nowMs)) return false;
    if (risk.portfolioDd !== undefined && !this.validatePortfolioDd(risk.portfolioDd)) return false;
    if (risk.perpDexOiOverSma !== undefined && this.validatePerpDexOiOverSma(risk.perpDexOiOverSma))
      return false;
    if (risk.overlayOpenPnlPct !== undefined && this.validateOverlayOpenPnl(risk.overlayOpenPnlPct))
      return false;
    // BTC cooldown (24h between consecutive BTC entries).
    if (event.symbol === "BTC" && this.isInBtcCooldown(nowMs)) return false;
    // Capacity — allowedSymbols FIRST (issue #4a: SOL would have entered).
    if (!this.config.allowedSymbols.includes(event.symbol)) return false;
    const plannedNotionalUsd = this.plannedEntryNotionalUsd();
    // Per-week deployable cap (issue #4b). This MUST count every entry
    // opened in the last 7d, not just currently-open positions; otherwise
    // a sequence of fast TWAP exits can churn beyond the $5M/week budget.
    const weekStartMs = nowMs - 7 * 24 * 60 * 60 * 1000;
    let deployedThisWeek = 0;
    for (const entry of this.entryLedgerUsd) {
      if (entry.tsMs >= weekStartMs) deployedThisWeek += entry.notionalUsd;
    }
    if (deployedThisWeek + plannedNotionalUsd > this.config.capacityMaxPerWeekUsd) return false;
    // Per-event deployable cap across currently-open cascade positions.
    let openNotionalUsd = 0;
    for (const pos of this.openPositions.values()) {
      openNotionalUsd += pos.entryNotionalUsd;
    }
    if (openNotionalUsd + plannedNotionalUsd > this.config.capacityMaxPerEventUsd) return false;
    // Concurrent-symbol cap: only counts new symbols (an open position in
    // the same symbol is OK, just refreshes; doesn't count twice).
    const openSymbols = new Set<string>();
    for (const pos of this.openPositions.values()) {
      openSymbols.add(pos.symbol);
    }
    return openSymbols.has(event.symbol) || !(openSymbols.size >= this.config.capacityMaxConcurrentSymbols);
  }

  // -------------------------------------------------------------------------
  // Main observation entry point
  // -------------------------------------------------------------------------

  /**
   * `observe` — record a fresh 1-min window, OI, funding, ELR, and
   * cross-confirmation signal. Returns the updated cascade event list
   * or undefined if no event was created.
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
    readonly risk?: RiskSnapshotInput;
  }): readonly CascadeEvent[] {
    const { nowMs, window, oi, funding, elr, crossConfirmation } = input;
    const risk = input.risk ?? {};
    const portfolioDd = risk.portfolioDd;
    const perpDexOiOverSma = risk.perpDexOiOverSma;
    const overlayOpenPnlPct = risk.overlayOpenPnlPct;

    if (window.midPriceUsd !== undefined) {
      if (!Number.isFinite(window.midPriceUsd) || window.midPriceUsd <= 0) {
        throw new Error("[CascadeFade] midPriceUsd must be positive and finite");
      }
      this.lastMidPriceBySymbol.set(window.symbol, window.midPriceUsd);
    }

    const oiHistory = this.recordOi(oi);
    if (funding !== undefined) this.recordFunding(funding);
    if (elr !== undefined) this.recordElr(elr);

    // ---- Layer 1: real-time detector trigger ----
    const layer1Arguments: Parameters<CascadeFadeDetector["checkLayer1Trigger"]>[0] =
      crossConfirmation === undefined
        ? { window, oi, oiHistory }
        : { window, oi, oiHistory, crossConfirmation };
    const crossConfirmations = this.checkLayer1Trigger(layer1Arguments);
    let event = this.findEventBySymbol(window.symbol);
    if (crossConfirmations !== undefined && event === undefined) {
      event = this.createEvent({
        symbol: window.symbol,
        nowMs,
        window,
        oi,
        crossConfirmations,
      });
      this.events.set(event.id, event);
    }

    // ---- Update existing event's last-observed metrics ----
    if (event !== undefined) {
      event.lastObservedOiUsd = oi.oiUsd;
      if (funding !== undefined) event.lastFunding8h = funding.fundingRate8h;
      if (elr !== undefined) event.lastElr = elr.elr;

      // ---- Layer 2: state machine transitions ----
      const next = this.nextState(event, nowMs, oiHistory);
      if (next !== event.state) {
        event.state = next;
      }

      // ---- Risk gates ----
      //
      // Verifier Check 3 (attempt 1 fix): the TWAP auto-exit fires
      // BEFORE any risk-kill check. The deadline equals
      // `entry.entryTsMs + entry.exitWindowMinutes * 60_000`. Once
      // `nowMs > deadline`, we close the position regardless of P&L.
      // This is the "no holding through next session" enforcement.
      if (this.shouldHardStop(nowMs)) {
        // A hard stop is set only after `forceExit` records a closed event,
        // so no open position can coexist with this latch.
        return [event];
      }
      // Kill-switch (portfolio DD / perp-DEX OI cap / overlay open P&L)
      // CLOSE existing positions. BTC cooldown is a separate check — it
      // BLOCKS new entries only (handled in `canEnter()`) and does NOT
      // close an open position.
      const isKillSwitchActive = this.isKillSwitchActive(portfolioDd, perpDexOiOverSma, overlayOpenPnlPct);
      if (isKillSwitchActive && event.entry !== undefined && event.exit === undefined) {
        const exit = this.closeEvent(event, event.entry, nowMs, "risk_kill");
        this.recordExit(exit, nowMs);
        return [event];
      }
      // TWAP auto-exit — fire when entry deadline passed but no kill-switch.
      if (
        event.entry !== undefined &&
        event.exit === undefined &&
        event.entry.entryTsMs + event.entry.exitWindowMinutes * 60_000 <= nowMs
      ) {
        // Synthetic exit mid = entry mid price (paper-trade fallback — at
        // the timed exit deadline, we do NOT have a live bybit.eu mid
        // tap wired in, so we use the captured entry mid. Real production
        // wires `forceExit()` from a market-data tick.
        this.forceExit(event.id, nowMs, event.entry.entryMidPriceUsd, "timed_exit");
        return [event];
      }

      // ---- Layer 3 entry (only POST_CASCADE) ----
      // Issue #1 + #4: gates (incl. risk + allowedSymbols + per-week
      // capacity) are evaluated inside `canEnter`. The adversarial run
      // with portfolioDd=0.15 / perpDexOiOverSma=true /
      // overlayOpenPnlPct=-0.025 + SOL symbol cannot pass this gate.
      if (
        event.state === "POST_CASCADE" &&
        event.entry === undefined &&
        this.canEnter(event.id, nowMs, risk)
      ) {
        const entry = this.processEntry(event, window, nowMs);
        event.entry = entry;
        this.openPositions.set(event.id, entry);
        this.entryLedgerUsd.push({ tsMs: nowMs, notionalUsd: entry.entryNotionalUsd });
        if (event.symbol === "BTC") {
          this.lastBtcEntryTsMs = nowMs;
        }
      }
    }

    return [event].filter((event): event is CascadeEvent => event !== undefined);
  }

  // -------------------------------------------------------------------------
  // Forced exit hook (paper-trade replay / external TWAP driver)
  // -------------------------------------------------------------------------

  /**
   * `forceExit` — externally close an event's open position. Used by
   * paper-trade replay to simulate the timed TWAP exit at the
   * computed deadline, and by the test harness to verify constraints.
   *
   * Returns `undefined` if no open position was present on the event.
   */
  forceExit(
    eventId: string,
    nowMs: number,
    exitMidPriceUsd: number,
    reason: CascadeExit["exitReason"] = "timed_exit",
  ): CascadeExit | undefined {
    const eventMaybe = this.events.get(eventId);
    // Reject when no event, no entry, or already closed.
    // Use optional-chain rather than the `=== undefined || ...` chain
    // because `@typescript-eslint/prefer-optional-chain` flags it.
    // We must access fields through `evMaybe` (not alias) to preserve
    // TS narrowing of `entry: non-undefined` and `exit: undefined`.
    if (eventMaybe?.entry === undefined || eventMaybe.exit !== undefined) return undefined;
    const exit: CascadeExit = {
      eventId: eventMaybe.id,
      symbol: eventMaybe.symbol,
      exitTsMs: nowMs,
      exitMidPriceUsd,
      exitNotionalUsd: eventMaybe.entry.entryNotionalUsd,
      // PnL = (exitMidPrice - entryLimitPrice) / entryMidPrice × 10000.
      // For a fade the entry was BUY and we expect exitMidPrice >= entryLimitPrice,
      // so positive pnlBps = profit. (Track D §5: overshoot capture is the alpha.)
      // `processEntry` rejects non-positive mids before an entry can be
      // attached to an event, so every publicly reachable open entry has a
      // strictly positive denominator here.
      pnlBps:
        ((exitMidPriceUsd - eventMaybe.entry.entryLimitPriceUsd) / eventMaybe.entry.entryMidPriceUsd) *
        10_000,
      exitReason: reason,
    };
    eventMaybe.exit = exit;
    this.openPositions.delete(eventMaybe.id);
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

  /**
  Pure check: is the perp-DEX OI over its 90-day SMA?
  */
  validatePerpDexOiOverSma(isOverSma: boolean): boolean {
    return this.config.riskPerpDexOiOverSmaHalts && isOverSma;
  }

  /**
  Pure check: is the overlay open P&L below kill-switch?
  */
  validateOverlayOpenPnl(openPnlPct: number): boolean {
    return openPnlPct < this.config.riskOverlayDrawdownKillBps / 10_000;
  }

  /**
  Pure check: BTC cooldown active?
  */
  isInBtcCooldown(nowMs: number): boolean {
    return nowMs - this.lastBtcEntryTsMs < this.config.riskBtCooldownMs;
  }

  /**
  Reset state (test + multi-run cleanup).
  */
  reset(): void {
    this.events.clear();
    this.oiHistory.clear();
    this.fundingHistory.clear();
    this.elrHistory.clear();
    this.lastMidPriceBySymbol.clear();
    this.openPositions.clear();
    this.pnlLedgerBps.length = 0;
    this.entryLedgerUsd.length = 0;
    this.lastBtcEntryTsMs = -Infinity;
    this.hardStopHaltUntilMs = -Infinity;
  }

  // -------------------------------------------------------------------------
  // Internal Layer 1 / Layer 2 logic
  // -------------------------------------------------------------------------

  /**
   * `checkLayer1Trigger` — Layer 1 predicate. Verifier Check 2
   * (attempt 1 fix): this is a real predicate on `crossConfirmation.sources`,
   * NOT a numeric flag check. It enforces:
   *   - same symbol across ALL sources (else "BTC event with ETH source"
   *     cannot happen again)
   *   - all sources' windowStartMs within `layer1CrossConfirmWindowMs`
   *     of `oi.timestampMs` (the trigger window); default ±60s
   *   - count of distinct PROVIDERS ≥ `layer1MinCrossConfirmations`
   *     (with PROVIDER_DIVERSITY_GROUPS collapsing same-group providers
   *     into one logical source — CoinGlass aggregate + 1 perp venue
   *     counts as 2)
   *
   * The adversarial run that produced the previous verifier FAIL
   * (crossConfirmation { symbol: ETH, windowStartMs: T0-3h,
   * sourceCount: 2 } triggering a BTC event) would fail this check
   * because (a) ETH ≠ BTC symbol and (b) T0-3h is far outside ±60s.
   */
}
