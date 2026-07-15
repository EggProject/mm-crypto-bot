/**
 * apps/bot/src/risk/kelly.ts
 *
 * Phase 37 Track 1 — Dynamic Kelly position sizing for the live bot.
 *
 * Computes a position size as a fraction of bankroll, using the
 * canonical Kelly formula:
 *
 *   f* = (b × p − q) / b
 *
 *     where b = avg win / avg loss, p = win rate, q = 1 − p.
 *
 * Returns the *fractional* Kelly (default 0.25×) capped at the
 * configured `max_position_fraction`. During the cold-start period
 * (fewer than `min_trades` closed trades), returns the
 * `fallback_fraction` instead.
 *
 * This module is RUNTIME sizing, not backtest optimization. For
 * backtest-side Kelly optimization with walk-forward validation, see
 * `packages/core/src/risk/kelly-position-sizer.ts` (Phase 6 Track C).
 * The two are complementary: the backtest module tells you what the
 * historical edge IS, and this module applies a SAFE rolling estimate
 * to live sizing.
 *
 * References (≥2 independent sources / claim):
 *   - Kelly, J.L. Jr. (1956) "A New Interpretation of Information Rate",
 *     Bell System Technical Journal, 35(4): 917-926.
 *     https://www.princeton.edu/~wbialek/rome/refs/kelly_56.pdf
 *   - Thorp, E. (2006) "The Kelly Criterion in Blackjack, Sports Betting,
 *     and the Stock Market". Handbook of Asset and Liability Management.
 *     https://gwern.net/doc/statistics/decision/2006-thorp.pdf
 *   - Vince, R. (1992) "The Mathematics of Money Management" — q/b
 *     formulation; fractional Kelly indoklás.
 *   - MarketMaker.cc: 1/2 Kelly a practitioner sweet spot; 1/4 Kelly a
 *     "ruin-resistant" compromise for live trading. Half-Kelly →
 *     75% growth at 50% volatility; quarter-Kelly → 44%/25%.
 *     https://www.marketmaker.cc/kk/blog/post/kelly-criterion-strategy-sizing/
 *   - HyperTrader (2024): quarter-Kelly 72% CAGR / 21% DD vs full-Kelly
 *     142% / 58% DD a 3-year crypto backtestjükben — a quarter-Kelly
 *     a Calmar-sweet spot.
 *     https://www.hyper-quant.tech/research/kelly-criterion-position-sizing
 *
 * Design constraints:
 *   - Pure functional core (no I/O, no Date.now) so the unit tests
 *     can hit every branch deterministically.
 *   - The `KellySizer` is the STATEFUL wrapper — it accumulates
 *     closed trades, evicts the oldest when over `window_size`, and
 *     recomputes p/b on demand.
 *   - The function `kellyFraction(p, b, multiplier)` is the PURE
 *     core, exported separately for direct unit testing and for the
 *     `RiskManager` to call with rolling-window stats.
 */

import type { Logger } from "@mm-crypto-bot/shared";
import { createLogger } from "@mm-crypto-bot/shared";

// ============================================================================
// Public types
// ============================================================================

/**
 * `ClosedTrade` — a single completed trade used for Kelly estimation.
 * `pnlUsd > 0` counts as a win, `< 0` as a loss, `0` is excluded from
 * both numerator and denominator.
 */
export interface ClosedTrade {
  readonly pnlUsd: number;
  /** Trade close timestamp (epoch ms) — used for sort-stability in tests. */
  readonly closedAt: number;
}

/**
 * `KellyConfig` — the live Kelly sizer configuration.
 *
 * - `enabled`         — module on/off.
 * - `fraction`        — fractional Kelly multiplier (default 0.25).
 * - `windowSize`      — rolling window in closed trades (default 50).
 * - `minTrades`       — cold-start threshold (default 10).
 * - `fallbackFraction`— fallback size fraction used during cold start.
 * - `maxFraction`     — hard cap on the Kelly-suggested size (default 0.10).
 * - `logger`          — optional structured logger.
 */
export interface KellyConfig {
  readonly enabled: boolean;
  readonly fraction: number;
  readonly windowSize: number;
  readonly minTrades: number;
  readonly fallbackFraction: number;
  readonly maxFraction: number;
  readonly logger?: Logger;
}

/**
 * `KellyStats` — the current rolling-window statistics. Useful for
 * telemetry, TUI display, and the `RiskManager` snapshot.
 */
export interface KellyStats {
  readonly trades: number;
  readonly wins: number;
  readonly losses: number;
  readonly winRate: number;
  readonly avgWin: number;
  readonly avgLoss: number;
  readonly winLossRatio: number;
  readonly fullKelly: number;
  readonly fractionalKelly: number;
  readonly cappedKelly: number;
  readonly region: "cold-start" | "no-edge" | "active";
}

// ============================================================================
// Pure helpers (no state — exported for direct testing)
// ============================================================================

/**
 * `kellyFraction` — the pure Kelly formula.
 *
 *   f* = (b × p − q) / b
 *
 * Returns 0 if:
 *   - `winLossRatio === 0` (no losing trades — degenerate, conservative 0).
 *   - `b × p − q ≤ 0` (negative expected value — Kelly says "don't bet").
 *   - Inputs are non-finite or out of [0, 1] / [0, ∞).
 *
 * The result is clamped to [0, 1] — anything > 1 is operationally
 * meaningless (and would imply leverage).
 */
export function kellyFraction(winRate: number, winLossRatio: number): number {
  if (!Number.isFinite(winRate) || winRate < 0 || winRate > 1) {
    throw new Error(`kellyFraction: winRate must be in [0, 1]: ${String(winRate)}`);
  }
  if (!Number.isFinite(winLossRatio) || winLossRatio < 0) {
    throw new Error(
      `kellyFraction: winLossRatio must be non-negative finite: ${String(winLossRatio)}`,
    );
  }
  if (winLossRatio === 0) {
    return 0;
  }
  const q = 1 - winRate;
  const raw = (winLossRatio * winRate - q) / winLossRatio;
  if (raw <= 0) {
    return 0;
  }
  return Math.min(raw, 1);
}

/**
 * `computeStats` — derive rolling-window stats from a trade list.
 *
 * Pure function — easy to unit test deterministically.
 */
export function computeStats(trades: readonly ClosedTrade[]): {
  readonly wins: number;
  readonly losses: number;
  readonly winRate: number;
  readonly avgWin: number;
  readonly avgLoss: number;
  readonly winLossRatio: number;
} {
  if (trades.length === 0) {
    return {
      wins: 0,
      losses: 0,
      winRate: 0,
      avgWin: 0,
      avgLoss: 0,
      winLossRatio: 0,
    };
  }
  const wins: number[] = [];
  const losses: number[] = [];
  for (const t of trades) {
    if (t.pnlUsd > 0) wins.push(t.pnlUsd);
    else if (t.pnlUsd < 0) losses.push(Math.abs(t.pnlUsd));
  }
  const winRate = (wins.length + losses.length) > 0
    ? wins.length / (wins.length + losses.length)
    : 0;
  const avgWin = wins.length > 0 ? wins.reduce((a, b) => a + b, 0) / wins.length : 0;
  const avgLoss = losses.length > 0 ? losses.reduce((a, b) => a + b, 0) / losses.length : 0;
  const winLossRatio = avgLoss > 0 ? avgWin / avgLoss : 0;
  return { wins: wins.length, losses: losses.length, winRate, avgWin, avgLoss, winLossRatio };
}

// ============================================================================
// KellySizer class (stateful wrapper)
// ============================================================================

/**
 * `KellySizer` — the stateful sizer. It holds a bounded ring buffer
 * of the last N closed trades and recomputes the size on demand.
 *
 * Lifecycle:
 *   new KellySizer(config)
 *   sizer.recordClosedTrade({ pnlUsd, closedAt })  // on every close
 *   const size = sizer.recommendedSize()           // before every new order
 *
 * The class is `enabled`-aware: when disabled, `recommendedSize()`
 * returns 0 (the RiskManager / StrategyRunner should fall back to the
 * static `defaultSizingFn` in that case — see wiring in
 * `apps/bot/src/risk/risk-manager.ts`).
 */
export class KellySizer {
  private readonly enabled: boolean;
  private readonly fraction: number;
  private readonly windowSize: number;
  private readonly minTrades: number;
  private readonly fallbackFraction: number;
  private readonly maxFraction: number;
  private readonly logger: Logger;
  private trades: ClosedTrade[] = [];

  public constructor(config: KellyConfig) {
    if (!Number.isFinite(config.fraction) || config.fraction <= 0 || config.fraction > 1) {
      throw new Error(`kelly: fraction must be in (0, 1], got ${String(config.fraction)}`);
    }
    if (!Number.isInteger(config.windowSize) || config.windowSize < 1) {
      throw new Error(`kelly: windowSize must be a positive integer, got ${String(config.windowSize)}`);
    }
    if (!Number.isInteger(config.minTrades) || config.minTrades < 1) {
      throw new Error(`kelly: minTrades must be a positive integer, got ${String(config.minTrades)}`);
    }
    if (!Number.isFinite(config.fallbackFraction) || config.fallbackFraction < 0 || config.fallbackFraction > 1) {
      throw new Error(
        `kelly: fallbackFraction must be in [0, 1], got ${String(config.fallbackFraction)}`,
      );
    }
    if (!Number.isFinite(config.maxFraction) || config.maxFraction <= 0 || config.maxFraction > 1) {
      throw new Error(
        `kelly: maxFraction must be in (0, 1], got ${String(config.maxFraction)}`,
      );
    }
    this.enabled = config.enabled;
    this.fraction = config.fraction;
    this.windowSize = config.windowSize;
    this.minTrades = config.minTrades;
    this.fallbackFraction = config.fallbackFraction;
    this.maxFraction = config.maxFraction;
    this.logger = config.logger ?? createLogger("info");
  }

  /**
   * `recordClosedTrade` — append a trade to the rolling window.
   * If the window is full, the oldest trade is evicted (FIFO).
   */
  public recordClosedTrade(trade: ClosedTrade): void {
    if (!Number.isFinite(trade.pnlUsd)) {
      return;
    }
    this.trades.push(trade);
    if (this.trades.length > this.windowSize) {
      this.trades = this.trades.slice(this.trades.length - this.windowSize);
    }
  }

  /**
   * `recommendedSize` — compute the recommended position size as a
   * fraction of bankroll.
   *
   * Returns:
   *   - 0 if `enabled === false`.
   *   - `fallbackFraction` if fewer than `minTrades` closed trades.
   *   - 0 if the Kelly formula yields 0 (no edge).
   *   - `min(fractionalKelly, maxFraction)` otherwise.
   */
  public recommendedSize(): number {
    if (!this.enabled) {
      return 0;
    }
    if (this.trades.length < this.minTrades) {
      return this.fallbackFraction;
    }
    const stats = computeStats(this.trades);
    const full = kellyFraction(stats.winRate, stats.winLossRatio);
    if (full <= 0) {
      return 0;
    }
    const frac = full * this.fraction;
    return Math.min(frac, this.maxFraction);
  }

  /**
   * `getStats` — the full rolling-window snapshot. Used by the
   * `RiskManager` snapshot and the TUI for display.
   */
  public getStats(): KellyStats {
    const stats = computeStats(this.trades);
    const full = kellyFraction(stats.winRate, stats.winLossRatio);
    const frac = full * this.fraction;
    const capped = Math.min(frac, this.maxFraction);
    const region: KellyStats["region"] =
      !this.enabled
        ? "cold-start"
        : this.trades.length < this.minTrades
          ? "cold-start"
          : full <= 0
            ? "no-edge"
            : "active";
    return {
      trades: this.trades.length,
      wins: stats.wins,
      losses: stats.losses,
      winRate: stats.winRate,
      avgWin: stats.avgWin,
      avgLoss: stats.avgLoss,
      winLossRatio: stats.winLossRatio,
      fullKelly: full,
      fractionalKelly: frac,
      cappedKelly: capped,
      region,
    };
  }

  /**
   * `reset` — clear the rolling window. Useful when the bot restarts
   * and the prior history is no longer valid.
   */
  public reset(): void {
    this.trades = [];
    this.logger.info("[kelly] rolling window reset");
  }

  /**
   * `isEnabled` — convenience accessor for the `RiskManager`.
   */
  public isEnabled(): boolean {
    return this.enabled;
  }
}
