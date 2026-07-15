/**
 * apps/bot/src/risk/risk-manager.ts
 *
 * Phase 37 Track 1 — `RiskManager` — the orchestrator that ties the
 * three risk modules together:
 *
 *   - `TrailingStopManager`  — per-position ATR trailing stop.
 *   - `KellySizer`           — dynamic Kelly position sizing.
 *   - `DrawdownScaler`       — equity drawdown-aware position scaler.
 *
 * The `RiskManager` does NOT own the canonical state (positions,
 * equity). The `PositionManager` does. The `RiskManager` is a
 * sidecar that:
 *
 *   1) receives `onTick({ symbol, price, atr })` events,
 *   2) feeds the trailing-stop on every tick,
 *   3) emits `close` events back to the `PositionManager` when the
 *      trailing-stop fires,
 *   4) feeds the `DrawdownScaler` with the latest equity (on every
 *      `onEquityUpdate`),
 *   5) answers `evaluateNewPositionSize(...)` for the StrategyRunner:
 *        size = kellySize × drawdownScale
 *      (returns 0 if any module says "no").
 *
 * All three modules are disabled-by-default. When disabled, they
 * behave as no-ops (the trailing-stop never arms, the Kelly returns
 * 0 / fallback, the drawdown scaler returns 1.0).
 *
 * The `RiskManager` does NOT close positions itself. It emits
 * `onTrailingStopClose(event)` callback events, and the bot's main
 * loop closes the position via the `PositionManager`.
 */

import type { Logger } from "@mm-crypto-bot/shared";
import { createLogger } from "@mm-crypto-bot/shared";

import { DrawdownScaler, type DrawdownState } from "./drawdown-scaler.js";
import { KellySizer, type KellyStats } from "./kelly.js";
import {
  TrailingStopManager,
  type TrailConfig,
  type TrailingStopDecision,
  type TrailingStopSide,
} from "./trailing-stop.js";

// ============================================================================
// Public types
// ============================================================================

/**
 * `RiskManagerConfig` — the orchestrator's full configuration. All
 * three sub-modules are optional; the `RiskManager` instantiates a
 * disabled stub for any sub-section that is missing or `enabled: false`.
 *
 * - `trailingStop`     — see `TrailConfig`.
 * - `kelly`            — see `KellyConfig`.
 * - `drawdownScaler`   — see `DrawdownScalerOptions`.
 * - `logger`           — optional structured logger.
 */
export interface RiskManagerConfig {
  readonly trailingStop: TrailConfig;
  readonly kelly: {
    readonly enabled: boolean;
    readonly fraction: number;
    readonly windowSize: number;
    readonly minTrades: number;
    readonly fallbackFraction: number;
    readonly maxFraction: number;
  };
  readonly drawdownScaler: {
    readonly enabled: boolean;
    readonly maxDdPct: number;
    readonly initialEquity: number;
  };
  readonly logger?: Logger;
}

/**
 * `TickEvent` — the input for `onTick(...)`.
 */
export interface TickEvent {
  readonly positionId: string;
  readonly side: TrailingStopSide;
  readonly currentPrice: number;
  readonly atr: number;
  readonly timestamp?: number;
}

/**
 * `NewPositionSizeRequest` — the input for `evaluateNewPositionSize(...)`.
 */
export interface NewPositionSizeRequest {
  readonly equityUsd: number;
  readonly baseSizeFraction: number;
}

/**
 * `TrailingStopCloseEvent` — emitted via the `onTrailingStopClose` callback
 * when a trail breach closes a position.
 */
export interface TrailingStopCloseEvent {
  readonly positionId: string;
  readonly side: TrailingStopSide;
  readonly closePrice: number;
  readonly reason: string;
}

/**
 * `RiskManagerCallback` — the callback type for close events.
 */
export type TrailingStopCloseCallback = (event: TrailingStopCloseEvent) => void;

/**
 * `RiskManagerSnapshot` — a read-only view of all three sub-modules.
 * Used by the Telemetry and the TUI.
 */
export interface RiskManagerSnapshot {
  readonly drawdown: DrawdownState;
  readonly kelly: KellyStats;
  readonly trailingStops: readonly {
    readonly positionId: string;
    readonly side: TrailingStopSide;
    readonly armed: boolean;
    readonly trail: number;
    readonly high: number;
    readonly atr: number;
  }[];
  readonly canOpenNewPosition: boolean;
}

// ============================================================================
// RiskManager class
// ============================================================================

/**
 * `RiskManager` — the orchestrator. Single instance per bot.
 */
export class RiskManager {
  private readonly trailingStop: TrailingStopManager;
  private readonly kelly: KellySizer;
  private readonly drawdown: DrawdownScaler;
  private readonly logger: Logger;
  private readonly closeCallbacks: TrailingStopCloseCallback[] = [];

  public constructor(config: RiskManagerConfig) {
    this.logger = config.logger ?? createLogger("info");
    this.trailingStop = new TrailingStopManager({
      ...config.trailingStop,
      logger: this.logger,
    });
    this.kelly = new KellySizer({
      enabled: config.kelly.enabled,
      fraction: config.kelly.fraction,
      windowSize: config.kelly.windowSize,
      minTrades: config.kelly.minTrades,
      fallbackFraction: config.kelly.fallbackFraction,
      maxFraction: config.kelly.maxFraction,
      logger: this.logger,
    });
    this.drawdown = new DrawdownScaler({
      enabled: config.drawdownScaler.enabled,
      maxDdPct: config.drawdownScaler.maxDdPct,
      initialEquity: config.drawdownScaler.initialEquity,
      logger: this.logger,
    });
  }

  // --------------------------------------------------------------------------
  // Public API — orchestrator methods
  // --------------------------------------------------------------------------

  /**
   * `onTrailingStopClose` — register a callback for trailing-stop
   * close events. The bot's main loop uses this to call
   * `PositionManager.closePosition(...)`.
   */
  public onTrailingStopClose(cb: TrailingStopCloseCallback): void {
    this.closeCallbacks.push(cb);
  }

  /**
   * `armTrailingStop` — arm a trailing stop for a newly opened
   * position. The caller (bot's main loop) calls this right after
   * `PositionManager.openPosition(...)`.
   */
  public armTrailingStop(positionId: string, side: TrailingStopSide, entryPrice: number, atr: number): void {
    if (!this.trailingStop.isEnabled()) return;
    if (!this.trailingStop.shouldTrackSide(side)) return;
    this.trailingStop.arm(positionId, side, entryPrice, atr);
  }

  /**
   * `disarmTrailingStop` — disarm a trailing stop for a closed
   * position. Called after `PositionManager.closePosition(...)`.
   */
  public disarmTrailingStop(positionId: string): void {
    this.trailingStop.disarm(positionId);
  }

  /**
   * `onTick` — process a new tick for an armed position. Feeds the
   * trailing-stop and (if the trail fires) emits the close event.
   */
  public onTick(event: TickEvent): TrailingStopDecision {
    const decision = this.trailingStop.evaluate(event);
    if (decision.kind === "close") {
      this.logger.info("[risk-manager] trailing-stop fired", {
        positionId: event.positionId,
        side: event.side,
        closePrice: decision.closePrice,
        reason: decision.reason,
      });
      for (const cb of this.closeCallbacks) {
        try {
          cb({
            positionId: event.positionId,
            side: event.side,
            closePrice: decision.closePrice,
            reason: decision.reason,
          });
        } catch (err) {
          this.logger.error("[risk-manager] close callback threw", {
            positionId: event.positionId,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }
    return decision;
  }

  /**
   * `onEquityUpdate` — feed the drawdown scaler with the latest
   * equity. Called on every fill and every state-store save.
   */
  public onEquityUpdate(equity: number): void {
    this.drawdown.updateEquity(equity);
  }

  /**
   * `onTradeClosed` — feed the Kelly sizer with a closed trade.
   */
  public onTradeClosed(pnlUsd: number, closedAt: number): void {
    this.kelly.recordClosedTrade({ pnlUsd, closedAt });
  }

  /**
   * `evaluateNewPositionSize` — compute the final position size
   * fraction for a new order.
   *
   * Logic:
   *   - If any module is in "no" state → return 0.
   *   - If Kelly is enabled → use Kelly.recommendedSize().
   *   - If Kelly is disabled → use `baseSizeFraction` (the static
   *     `risk_per_trade` from config).
   *   - Multiply by the drawdown scaler factor.
   *
   * @returns a position size as fraction of equity (0..1).
   */
  public evaluateNewPositionSize(request: NewPositionSizeRequest): number {
    if (!this.drawdown.canOpenNew()) {
      return 0;
    }
    const kellySize = this.kelly.isEnabled() ? this.kelly.recommendedSize() : request.baseSizeFraction;
    if (kellySize <= 0) {
      return 0;
    }
    const scaled = kellySize * this.drawdown.scaleFactor();
    return scaled;
  }

  /**
   * `getSnapshot` — read-only view of the full risk state.
   */
  public getSnapshot(): RiskManagerSnapshot {
    return {
      drawdown: this.drawdown.getState(),
      kelly: this.kelly.getStats(),
      trailingStops: this.trailingStop.getAllStates().map((s) => ({
        positionId: s.positionId,
        side: s.side,
        armed: s.armed,
        trail: s.trail,
        high: s.high,
        atr: s.atr,
      })),
      canOpenNewPosition: this.drawdown.canOpenNew(),
    };
  }

  // --------------------------------------------------------------------------
  // Sub-module accessors — used by the integration test and the bot wiring
  // --------------------------------------------------------------------------

  /** `getDrawdownScaler` — the underlying `DrawdownScaler` instance. */
  public getDrawdownScaler(): DrawdownScaler {
    return this.drawdown;
  }

  /** `getKellySizer` — the underlying `KellySizer` instance. */
  public getKellySizer(): KellySizer {
    return this.kelly;
  }

  /** `getTrailingStop` — the underlying `TrailingStopManager` instance. */
  public getTrailingStopManager(): TrailingStopManager {
    return this.trailingStop;
  }
}
