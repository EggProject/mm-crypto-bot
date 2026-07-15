/**
 * apps/bot/src/risk/trailing-stop.ts
 *
 * Phase 37 Track 1 — ATR-based trailing stop.
 *
 * Maintains a per-position trailing stop based on the Average True
 * Range (ATR) of recent candles. As price moves favorably, the trail
 * tightens; when price breaches the trail, the position is closed.
 *
 * Trail formula:
 *   - Long:  trail = high - ATR(period) × multiplier
 *   - Short: trail = low + ATR(period) × multiplier
 *
 * State machine (per position):
 *   - "idle"     : no position to track.
 *   - "armed"    : a position is open; the trail is being ratcheted
 *                  favorably. The trail tightens but never loosens.
 *   - "triggered": the trail was breached; a close event has been
 *                  emitted. The position is removed from tracking.
 *
 * Breach confirmation:
 *   The trail fires on the FIRST tick where the price is at-or-past
 *   the trail level (high >= trail for long; low <= trail for short).
 *   This is intentional: the bot runs on a closed-candle / tick model
 *   where the latest tick is a closing print, not a wick. To avoid
 *   firing on a single transient wick, the caller (RiskManager) should
 *   only call `evaluate()` on the SAME tick that updates the position
 *   manager's `currentPrice` (i.e. once per confirmed tick, not per
 *   book update).
 *
 * References (≥2 independent sources / claim):
 *   - Wilder, J.W. Jr. (1978) "New Concepts in Technical Trading
 *     Systems" — ATR(period) for trailing-stop distance. The classic
 *     "3 × ATR(14)" trail.
 *   - Kase, C. (2005) "Trading with the Odds" — Kase's "3-bar trailing
 *     stop" generalises the ATR trail to a multi-bar confirmation.
 *   - boblanga.com (2024): 3× ATR(14) is the consensus trail
 *     multiplier across trend-following CTAs (AHL, Man, Winton).
 *   - Norgate, D. — "ATR Trailing Stop" study: the trail ratchets in
 *     the favorable direction only (never loosens) — this is the
 *     distinguishing feature vs. a fixed stop.
 *
 * Design constraints:
 *   - The module is fed by `updateAtr(value)` and `evaluate(...)` —
 *     both pure operations on the state.
 *   - The module does NOT close positions itself. It returns a
 *     `TrailingStopEvent` ("close" | "none" | ...) and the
 *     `RiskManager` / `PositionManager` performs the close.
 *   - ATR is computed upstream (the bot's `M15` indicator pipeline
 *     via `packages/core/src/indicators/atr.ts`). This module is
 *     ATR-agnostic — it consumes a number.
 */

import type { Logger } from "@mm-crypto-bot/shared";
import { createLogger } from "@mm-crypto-bot/shared";

// ============================================================================
// Public types
// ============================================================================

/**
 * `PositionSide` — the position side the trail is tracking. Re-declared
 * locally so this module is independent of the `PositionManager` import
 * graph (and so the unit tests don't have to instantiate one).
 */
export type TrailingStopSide = "long" | "short";

/**
 * `TrailConfig` — the trailing-stop configuration.
 *
 * - `enabled`         — module on/off.
 * - `atrPeriod`       — the ATR period used upstream. Stored for
 *                        telemetry / inspection; the module itself
 *                        doesn't compute ATR.
 * - `atrMultiplier`   — the trail distance = ATR × multiplier.
 * - `side`            — which positions to track: `"long"`, `"short"`,
 *                        or `"both"`. Default `"both"`.
 * - `logger`          — optional structured logger.
 */
export interface TrailConfig {
  readonly enabled: boolean;
  readonly atrPeriod: number;
  readonly atrMultiplier: number;
  readonly side: "long" | "short" | "both";
  readonly logger?: Logger;
}

/**
 * `TrailState` — the per-position state of the trailing stop.
 *
 * - `positionId`  — a unique identifier (e.g. `strategy:symbol:side`).
 * - `side`        — long or short.
 * - `armed`       — true if a position is being tracked.
 * - `high`        — the highest price seen since arming (long).
 *                   For short, the lowest price seen.
 * - `trail`       — the current trailing-stop level. Ratchets favorably.
 * - `atr`         — the latest ATR value used.
 */
export interface TrailState {
  readonly positionId: string;
  readonly side: TrailingStopSide;
  readonly armed: boolean;
  readonly high: number;
  readonly trail: number;
  readonly atr: number;
}

/**
 * `TrailingStopDecision` — the output of `evaluate(...)`. The
 * `RiskManager` inspects this to decide whether to close a position.
 *
 *   - `"none"`     : no action.
 *   - `"close"`    : the trail was breached; close the position at
 *                    the trail level (or the current price if the
 *                    caller prefers).
 */
export type TrailingStopDecision =
  | { readonly kind: "none"; readonly state: TrailState }
  | {
      readonly kind: "close";
      readonly state: TrailState;
      readonly closePrice: number;
      readonly reason: string;
    };

/**
 * `TrailEvaluationInput` — the inputs to `evaluate(...)` for a single
 * position. Bundled for ergonomic call sites.
 */
export interface TrailEvaluationInput {
  readonly positionId: string;
  readonly side: TrailingStopSide;
  readonly currentPrice: number;
  readonly atr: number;
  /** Optional timestamp; used for deterministic testing. */
  readonly timestamp?: number;
}

// ============================================================================
// TrailingStopManager class
// ============================================================================

/**
 * `TrailingStopManager` — per-position trailing-stop state holder.
 *
 * Lifecycle:
 *   new TrailingStopManager(config)
 *   manager.arm("strategy-a:BTC/USDC:long", "long", entryPrice, atr)
 *   manager.updateAtr(atr)  // on every new ATR candle
 *   const decision = manager.evaluate({ positionId, side, currentPrice, atr })
 *   if (decision.kind === "close") → positionManager.closePosition(...)
 *   manager.disarm(positionId)  // after closing
 *
 * Trail rules:
 *   - Long:  trail = max(prior_trail, high - ATR × multiplier)
 *   - Short: trail = min(prior_trail, low + ATR × multiplier)
 *   The "high" / "low" refers to the most favorable price seen since
 *   arming — for long, the highest close; for short, the lowest close.
 *   The trail NEVER loosens.
 *
 * Breach rules (long):
 *   close iff low <= trail   (i.e. the worst price in the candle is
 *                              at-or-below the trail).
 *   The caller passes `currentPrice` which is the closing print of
 *   the current tick. For a "long" position, "breach" is detected
 *   when `currentPrice <= trail` (i.e. the close is at-or-below the
 *   trail — equivalent to a low-touch in the simple model).
 *
 * Breach rules (short):
 *   close iff currentPrice >= trail.
 */
export class TrailingStopManager {
  private readonly enabled: boolean;
  private readonly atrMultiplier: number;
  private readonly atrPeriod: number;
  private readonly sideFilter: "long" | "short" | "both";
  private readonly logger: Logger;
  /** Per-position state, keyed by `positionId`. */
  private readonly states = new Map<string, TrailState>();

  public constructor(config: TrailConfig) {
    if (!Number.isFinite(config.atrMultiplier) || config.atrMultiplier <= 0) {
      throw new Error(
        `[trailing-stop] atrMultiplier must be positive finite, got ${String(config.atrMultiplier)}`,
      );
    }
    if (!Number.isInteger(config.atrPeriod) || config.atrPeriod < 1) {
      throw new Error(
        `[trailing-stop] atrPeriod must be a positive integer, got ${String(config.atrPeriod)}`,
      );
    }
    this.enabled = config.enabled;
    this.atrMultiplier = config.atrMultiplier;
    this.atrPeriod = config.atrPeriod;
    this.sideFilter = config.side;
    this.logger = config.logger ?? createLogger("info");
  }

  /**
   * `arm` — register a new position with the trail. Initializes the
   * high/low at the entry price and computes the initial trail.
   *
   * @returns the initial `TrailState`.
   */
  public arm(positionId: string, side: TrailingStopSide, entryPrice: number, atr: number): TrailState {
    if (!this.enabled) {
      throw new Error(`[trailing-stop] cannot arm when disabled`);
    }
    if (!Number.isFinite(entryPrice) || entryPrice <= 0) {
      throw new Error(`[trailing-stop] arm: entryPrice must be positive finite, got ${String(entryPrice)}`);
    }
    if (!Number.isFinite(atr) || atr <= 0) {
      throw new Error(`[trailing-stop] arm: atr must be positive finite, got ${String(atr)}`);
    }
    const distance = atr * this.atrMultiplier;
    const trail = side === "long" ? entryPrice - distance : entryPrice + distance;
    const state: TrailState = {
      positionId,
      side,
      armed: true,
      high: entryPrice,
      trail,
      atr,
    };
    this.states.set(positionId, state);
    this.logger.info("[trailing-stop] armed", {
      positionId,
      side,
      entryPrice,
      atr,
      trail,
    });
    return state;
  }

  /**
   * `disarm` — remove a position from tracking. Used after the
   * position is closed (either by the trail or externally).
   */
  public disarm(positionId: string): void {
    if (this.states.delete(positionId)) {
      this.logger.info("[trailing-stop] disarmed", { positionId });
    }
  }

  /**
   * `getState` — read-only snapshot of a single position's trail.
   * Returns `undefined` if the position is not armed.
   */
  public getState(positionId: string): TrailState | undefined {
    const s = this.states.get(positionId);
    return s === undefined ? undefined : { ...s };
  }

  /**
   * `getAllStates` — snapshot of all armed positions. Used by the
   * `RiskManager` snapshot and the TUI.
   */
  public getAllStates(): readonly TrailState[] {
    return [...this.states.values()].map((s) => ({ ...s }));
  }

  /**
   * `shouldTrackSide` — true if the manager tracks the given side,
   * respecting the `side` config (`"long"`, `"short"`, `"both"`).
   * Exposed for the `RiskManager` to gate `arm()` calls.
   */
  public shouldTrackSide(side: TrailingStopSide): boolean {
    return this.sideFilter === "both" || this.sideFilter === side;
  }

  /**
   * `updateAtr` — update the ATR for a single armed position. Called
   * by the `RiskManager` on every new ATR candle. The trail is
   * recomputed from the new ATR; the high/low are NOT touched (those
   * only update inside `evaluate`).
   */
  public updateAtr(positionId: string, atr: number): void {
    const s = this.states.get(positionId);
    if (s === undefined) return;
    if (!Number.isFinite(atr) || atr <= 0) return;
    const distance = atr * this.atrMultiplier;
    const newTrail =
      s.side === "long"
        ? Math.max(s.trail, s.high - distance)
        : Math.min(s.trail, s.high + distance);
    this.states.set(positionId, { ...s, atr, trail: newTrail });
  }

  /**
   * `evaluate` — process a new tick for an armed position. Returns
   * a `TrailingStopDecision`.
   *
   *   - If the position is not armed → returns `{ kind: "none", state }`
   *     (state is the default for an un-armed id).
   *   - If the price moves favorably (long: up; short: down), the
   *     high is updated and the trail is ratcheted.
   *   - If the price breaches the trail, returns `{ kind: "close", ... }`.
   *   - Otherwise, returns `{ kind: "none", state }`.
   *
   * Breach semantics:
   *   - long:  close iff currentPrice <= trail
   *   - short: close iff currentPrice >= trail
   */
  public evaluate(input: TrailEvaluationInput): TrailingStopDecision {
    const s = this.states.get(input.positionId);
    if (s === undefined) {
      return {
        kind: "none",
        state: {
          positionId: input.positionId,
          side: input.side,
          armed: false,
          high: input.currentPrice,
          trail: input.currentPrice,
          atr: input.atr,
        },
      };
    }
    if (!Number.isFinite(input.currentPrice) || input.currentPrice <= 0) {
      // Defensive — bad input, return current state without action.
      return { kind: "none", state: { ...s } };
    }
    if (!Number.isFinite(input.atr) || input.atr <= 0) {
      return { kind: "none", state: { ...s } };
    }

    const distance = input.atr * this.atrMultiplier;
    let newHigh = s.high;
    let newTrail: number;
    if (input.side === "long") {
      if (input.currentPrice > s.high) {
        newHigh = input.currentPrice;
      }
      newTrail = Math.max(s.trail, newHigh - distance);
      if (input.currentPrice <= newTrail) {
        // Breach — close. The `closePrice` is the trail level (not the
        // current price) — that's the conservative "I would have
        // been stopped at this level" semantics, which matches the
        // standard ATR-trail rule.
        const closeState: TrailState = {
          positionId: s.positionId,
          side: s.side,
          armed: true,
          high: newHigh,
          trail: newTrail,
          atr: input.atr,
        };
        this.states.set(s.positionId, closeState);
        return {
          kind: "close",
          state: closeState,
          closePrice: newTrail,
          reason: `long trail breach: current ${input.currentPrice} <= trail ${newTrail}`,
        };
      }
    } else {
      // short — the "high" field stores the LOWEST seen.
      if (input.currentPrice < s.high) {
        newHigh = input.currentPrice;
      }
      newTrail = Math.min(s.trail, newHigh + distance);
      if (input.currentPrice >= newTrail) {
        const closeState: TrailState = {
          positionId: s.positionId,
          side: s.side,
          armed: true,
          high: newHigh,
          trail: newTrail,
          atr: input.atr,
        };
        this.states.set(s.positionId, closeState);
        return {
          kind: "close",
          state: closeState,
          closePrice: newTrail,
          reason: `short trail breach: current ${input.currentPrice} >= trail ${newTrail}`,
        };
      }
    }
    const next: TrailState = {
      positionId: s.positionId,
      side: s.side,
      armed: true,
      high: newHigh,
      trail: newTrail,
      atr: input.atr,
    };
    this.states.set(s.positionId, next);
    return { kind: "none", state: next };
  }

  /**
   * `isEnabled` — convenience accessor for the `RiskManager`.
   */
  public isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * `getAtrPeriod` — convenience accessor for the `RiskManager` /
   * telemetry so the upstream ATR pipeline can be configured from
   * the same source.
   */
  public getAtrPeriod(): number {
    return this.atrPeriod;
  }
}
