/**
 * apps/bot/src/risk/drawdown-scaler.ts
 *
 * Phase 37 Track 1 — Drawdown-aware position scaler.
 *
 * Tracks the high-water mark of equity and computes a scale factor
 * that linearly ramps position SIZE down as drawdown deepens. The
 * scaler does NOT auto-close existing positions (that's the
 * trailing-stop's job) — it just prevents opening NEW positions
 * at full size when the portfolio is bleeding.
 *
 * Three regions, mapped to (drawdown / max_dd_pct):
 *   - normal  (0 .. 0.5)  →  scale = 1.0 (no impact)
 *   - caution (0.5 .. 0.8) → scale = 0.5 (half-size)
 *   - kill    (0.8 .. 1.0) → scale = 0.0 (block new positions)
 *
 * Above max_dd_pct the scale is also 0.0 (no new positions, let the
 * existing MaxDrawdownKillSwitch trigger to halt the bot).
 *
 * The scaler is a pure stateful component. It is fed equity samples
 * via `updateEquity(equity)`, and queried via `scaleFactor()`. The
 * `RiskManager` orchestrates the feed (every price tick, every fill).
 *
 * References (≥2 independent sources / claim):
 *   - Vince, R. (1992) "The Mathematics of Money Management" — optimal f
 *     is unstable in drawdown; standard practitioner response is to
 *     reduce size proportionally to current DD vs max-DD.
 *   - Thorp, E. (2006) "The Kelly Criterion in Blackjack..." — half-Kelly
 *     in drawdown is the practitioner sweet spot; the standard
 *     implementation halves size linearly from 1× at 0% DD to 0× at
 *     100% of max-DD.
 *   - Medium / Praxis: standard "DD scaler" pattern in CTAs / trend-
 *     followers (AHL, Man Investments) — linear ramp 1.0× → 0.0× over
 *     0..maxDD.
 *
 * IMPORTANT: this module does NOT close existing positions. The
 * TrailingStop module is responsible for that. The scaler only
 * influences the SIZE of NEW positions. The StrategyRunner asks the
 * RiskManager for a scale factor and multiplies the Kelly-suggested
 * size by it before placing an order.
 */

import type { Logger } from "@mm-crypto-bot/shared";
import { createLogger } from "@mm-crypto-bot/shared";

// ============================================================================
// Public types
// ============================================================================

/**
 * `DrawdownRegion` — the current operational region of the scaler.
 *
 *   - `"normal"`  : 0% to 50% of `max_dd_pct` reached. Full size.
 *   - `"caution"` : 50% to 80% of `max_dd_pct` reached. Half size.
 *   - `"kill"`    : 80%+ of `max_dd_pct` reached. No new positions.
 */
export type DrawdownRegion = "normal" | "caution" | "kill";

/**
 * `DrawdownScalerOptions` — the scaler configuration.
 *
 * - `enabled`        — module on/off.
 * - `maxDdPct`       — the drawdown threshold (e.g. 0.15 = 15%).
 * - `initialEquity`  — the starting equity (used to seed the high-water mark).
 * - `logger`         — optional structured logger.
 */
export interface DrawdownScalerOptions {
  readonly enabled: boolean;
  readonly maxDdPct: number;
  readonly initialEquity: number;
  readonly logger?: Logger;
}

/**
 * `DrawdownState` — read-only snapshot of the scaler state. Useful for
 * the `RiskManager` snapshot, the Telemetry, and the TUI.
 *
 * - `enabled`        — module on/off.
 * - `peakEquity`     — current high-water mark.
 * - `currentEquity`  — last seen equity.
 * - `drawdownPct`    — `(peak - current) / peak`, clamped to [0, 1].
 * - `region`         — current region.
 * - `scaleFactor`    — multiplier to apply to new position sizes (0..1).
 */
export interface DrawdownState {
  readonly enabled: boolean;
  readonly peakEquity: number;
  readonly currentEquity: number;
  readonly drawdownPct: number;
  readonly region: DrawdownRegion;
  readonly scaleFactor: number;
}

// ============================================================================
// DrawdownScaler class
// ============================================================================

/**
 * `DrawdownScaler` — tracks equity high-water mark and computes a
 * scale factor for new positions.
 *
 * State machine:
 *   updateEquity(x) → peak = max(peak, x); drawdown = (peak - x) / peak
 *                   → region = classify(drawdown / maxDdPct)
 *                   → scaleFactor = lookup(region)
 *   scaleFactor()   → return current scale factor.
 *   canOpenNew()    → return scaleFactor > 0.
 *
 * The scaler is independent of the `MaxDrawdownKillSwitch` (which is a
 * separate, kill-the-bot mechanism). The scaler is a SOFT control
 * (no new positions at full size); the kill switch is a HARD control
 * (stop the bot entirely).
 */
export class DrawdownScaler {
  private readonly enabled: boolean;
  private readonly maxDdPct: number;
  private peakEquity: number;
  private currentEquity: number;
  private readonly logger: Logger;
  private lastRegion: DrawdownRegion = "normal";

  public constructor(opts: DrawdownScalerOptions) {
    if (!Number.isFinite(opts.maxDdPct) || opts.maxDdPct <= 0 || opts.maxDdPct > 1) {
      throw new Error(
        `[drawdown-scaler] maxDdPct must be in (0, 1], got ${String(opts.maxDdPct)}`,
      );
    }
    if (!Number.isFinite(opts.initialEquity) || opts.initialEquity <= 0) {
      throw new Error(
        `[drawdown-scaler] initialEquity must be positive finite, got ${String(opts.initialEquity)}`,
      );
    }
    this.enabled = opts.enabled;
    this.maxDdPct = opts.maxDdPct;
    this.peakEquity = opts.initialEquity;
    this.currentEquity = opts.initialEquity;
    this.logger = opts.logger ?? createLogger("info");
  }

  /**
   * `updateEquity` — feed a new equity sample. Updates the high-water
   * mark, recomputes the drawdown, and (if the region changed) logs
   * the transition at INFO level.
   *
   * Negative or non-finite inputs are ignored (defensive — the bot
   * should not crash on a transient bad sample).
   */
  public updateEquity(equity: number): void {
    if (!Number.isFinite(equity) || equity <= 0) {
      return;
    }
    this.currentEquity = equity;
    if (equity > this.peakEquity) {
      this.peakEquity = equity;
    }
    const dd = this.computeDrawdownPct();
    const region = this.classify(dd);
    if (region !== this.lastRegion) {
      this.logger.info("[drawdown-scaler] region transition", {
        from: this.lastRegion,
        to: region,
        drawdownPct: dd,
        peakEquity: this.peakEquity,
        currentEquity: this.currentEquity,
      });
      this.lastRegion = region;
    }
  }

  /**
   * `scaleFactor` — the current size multiplier for new positions.
   * 1.0 in `normal`, 0.5 in `caution`, 0.0 in `kill` (or above max).
   */
  public scaleFactor(): number {
    if (!this.enabled) {
      return 1.0;
    }
    const dd = this.computeDrawdownPct();
    const region = this.classify(dd);
    return DrawdownScaler.scaleFactorForRegion(region);
  }

  /**
   * `canOpenNew` — `true` if the scaler allows opening new positions
   * (i.e. scale factor > 0).
   */
  public canOpenNew(): boolean {
    return this.scaleFactor() > 0;
  }

  /**
   * `getState` — read-only snapshot of the scaler state.
   */
  public getState(): DrawdownState {
    const dd = this.computeDrawdownPct();
    const region = this.classify(dd);
    return {
      enabled: this.enabled,
      peakEquity: this.peakEquity,
      currentEquity: this.currentEquity,
      drawdownPct: dd,
      region,
      scaleFactor: DrawdownScaler.scaleFactorForRegion(region),
    };
  }

  /**
   * `reset` — reset the high-water mark to the current equity. Useful
   * when the bot restarts and the prior peak is no longer relevant
   * (e.g. after a config reload). The current equity is the seed.
   */
  public reset(newEquity: number): void {
    if (!Number.isFinite(newEquity) || newEquity <= 0) {
      return;
    }
    this.peakEquity = newEquity;
    this.currentEquity = newEquity;
    this.lastRegion = "normal";
    this.logger.info("[drawdown-scaler] reset", { equity: newEquity });
  }

  /**
   * `computeDrawdownPct` — current drawdown as fraction (0..1).
   * Returns 0 if peak is non-positive (defensive — should not happen
   * after constructor validation).
   */
  private computeDrawdownPct(): number {
    if (this.peakEquity <= 0) {
      return 0;
    }
    const dd = (this.peakEquity - this.currentEquity) / this.peakEquity;
    return dd < 0 ? 0 : dd;
  }

  /**
   * `classify` — map a drawdown fraction to a region.
   *
   *   dd/maxDdPct ∈ [0, 0.5)   → normal
   *   dd/maxDdPct ∈ [0.5, 0.8) → caution
   *   dd/maxDdPct ∈ [0.8, ∞)   → kill
   */
  private classify(drawdownPct: number): DrawdownRegion {
    if (this.peakEquity <= 0) {
      return "normal";
    }
    const ratio = drawdownPct / this.maxDdPct;
    if (ratio < 0.5) return "normal";
    if (ratio < 0.8) return "caution";
    return "kill";
  }

  /**
   * `scaleFactorForRegion` — static lookup. Exposed as `public static`
   * so the unit test can hit every branch directly without needing to
   * simulate the equity curve.
   */
  public static scaleFactorForRegion(region: DrawdownRegion): number {
    switch (region) {
      case "normal":
        return 1.0;
      case "caution":
        return 0.5;
      case "kill":
        return 0.0;
    }
  }
}
