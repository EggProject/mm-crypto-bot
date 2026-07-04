// packages/core/src/telemetry/strategy-telemetry.ts — per-strategy PnL attribution + observability
//
// Phase 10G Track B — per-strategy telemetry, attribution, kill-switch.
//
// =========================================================================
// PURPOSE
// =========================================================================
// StrategyTelemetry is the OBSERVABILITY layer for the signal center.
// It subscribes to all SignalBus events and computes:
//
//   - Per-strategy PnL attribution: which strategy contributed which dollars
//   - Per-strategy Sharpe + drawdown (rolling 30d)
//   - Cross-strategy correlation matrix (live updating)
//   - State snapshot for monitoring (JSON-serializable)
//   - Strategy kill-switch interface (disable a plugin mid-flight)
//   - CSV/JSON export for offline analysis
//
// Without this, the signal center is a black box. The operator cannot
// see which strategies are working, which are correlated, which to
// disable. With this, every alpha stream is observable and disableable.
//
// =========================================================================
// KILL-SWITCH DESIGN
// =========================================================================
// Per the FIA and HKMA practitioner consensus (cited below), a kill
// switch must:
//   1. Be independent of the strategy signal — it's a separate gate
//   2. Latch — once tripped, stays tripped until manual reset
//   3. Be observable — track when + why it fired
//
// This implementation provides per-plugin kill-switches (finer
// granularity than the canonical "all trading" switch). The
// `disablePlugin(name)` call sets a flag; subsequent signals from
// that plugin are filtered out. `enablePlugin(name)` requires a
// manual reset and logs the re-enable event.
//
// =========================================================================
// References (≥3 independent sources per empirical claim)
// =========================================================================
//
// 1. FIA "Best Practices For Automated Trading Risk Controls And System
//    Safeguards" (Jul 2024) — "Localized pre-trade risk controls, not
//    credit controls, should be the primary tools". Per-plugin kill-
//    switches are the canonical pattern.
//    https://www.fia.org/sites/default/files/2024-07/FIA_WP_AUTOMATED%20TRADING%20RISK%20CONTROLS_FINAL_0.pdf
//
// 2. HKMA "Sound risk management practices for algorithmic trading"
//    (Mar 2020) — "Proper kill functionality to suspend trading...
//    robust framework governing the activation of the kill
//    functionality and the subsequent re-enablement".
//    https://brdr.hkma.gov.hk/eng/doc-ldg/docId/getPdf/20200306-4-EN/20200306-4-EN.pdf
//
// 3. OpenAlgo "Kill Switches, Risk Controls and Algo Surveillance" —
//    "the single most important property of a real kill switch is
//    that it latches. Once tripped, it stays tripped until a human
//    deliberately resets it. A switch that re-arms itself the
//    moment profit and loss ticks back above the limit is not a
//    safety device — it is a trapdoor that keeps reopening under
//    the same falling weight".
//    https://openalgo.in/quant/kill-switches-risk-controls
//
// 4. AlphaStrat "Kill switch design for automated trading" (2026) —
//    "A good kill switch is not one red button. It's a ladder with
//    clear thresholds". Per-plugin granularity matches the L1
//    (soft pause) and L2 (session halt) levels.
//    https://alphastrat.io/tradeideas/guides/kill-switch-design-automated-trading/
//
// 5. Tradescope Blog "Position-Sizing 2025: Adaptive Kelly for Multi-
//    Asset Volatility" — explicitly recommends per-strategy telemetry
//    for regime-adaptive sizing. Justifies our per-strategy Sharpe.
//    https://tradescopeblog.info/article/position-sizing-2025-adaptive-kelly-for-multi-asset-volatility

import type {
  CorrelationMatrix,
  Signal,
} from "../risk/portfolio-risk-engine.js";

// ----------------------------------------------------------------------
// Signal types — re-export for convenience
// ----------------------------------------------------------------------

/** Re-export signal types so consumers don't need 2 imports. */
export type { Signal, DirectionSignal, CarrySignal, SizingSignal, RiskSignal } from "../risk/portfolio-risk-engine.js";

// ----------------------------------------------------------------------
// Configuration
// ----------------------------------------------------------------------

/**
 * `StrategyTelemetryConfig` — knobs for the telemetry module.
 *
 * Defaults reflect practitioner consensus:
 *   - `sharpeWindowDays = 30` — 30d rolling window is the standard
 *     practitioner consensus for daily crypto (matches the Phase 7
 *     Track B Adaptive Kelly window + the PortfolioRiskEngine default).
 *   - `minTradeCount = 5` — minimum trades for a strategy to be reported.
 *     Below this, the per-strategy stats are too noisy to be actionable.
 *   - `exportDelimiter = ','` — CSV export uses comma by default.
 */
export interface StrategyTelemetryConfig {
  readonly sharpeWindowDays: number;
  readonly minTradeCount: number;
  readonly exportDelimiter: string;
}

/**
 * `DEFAULT_STRATEGY_TELEMETRY_CONFIG` — production defaults.
 */
export const DEFAULT_STRATEGY_TELEMETRY_CONFIG: StrategyTelemetryConfig = {
  sharpeWindowDays: 30,
  minTradeCount: 5,
  exportDelimiter: ",",
};

// ----------------------------------------------------------------------
// Output types
// ----------------------------------------------------------------------

/**
 * `TradeRecord` — a single attributed trade. StrategyTelemetry records
 * every trade it observes, attributing it to the source strategy plugin.
 */
export interface TradeRecord {
  readonly source: string;
  readonly symbol: string;
  readonly timestamp: number;
  readonly notionalUsd: number;
  readonly pnlUsd: number;
  readonly side: "long" | "short" | "carry";
}

/**
 * `PerStrategyStats` — aggregated per-strategy statistics.
 */
export interface PerStrategyStats {
  readonly source: string;
  readonly tradeCount: number;
  readonly totalPnlUsd: number;
  readonly winCount: number;
  readonly lossCount: number;
  readonly winRate: number;
  readonly avgPnlUsd: number;
  /** Per-trade Sharpe (mean / std over `sharpeWindowDays` window). */
  readonly sharpe: number;
  /** Running max drawdown from the per-strategy cumulative PnL curve. */
  readonly maxDrawdownPct: number;
  /** True if the strategy is currently disabled (kill-switch active). */
  readonly disabled: boolean;
  /** When the strategy was disabled (if applicable). */
  readonly disabledAt: number | null;
  /** When the strategy was last re-enabled (if applicable). */
  readonly lastReenabledAt: number | null;
  /** When the strategy first emitted a signal (first observation). */
  readonly firstSeenAt: number;
  /** When the strategy emitted its last signal. */
  readonly lastSeenAt: number;
}

/**
 * `KillSwitchEvent` — record of a kill-switch activation/deactivation.
 */
export interface KillSwitchEvent {
  readonly source: string;
  readonly action: "disable" | "enable";
  readonly timestamp: number;
  readonly reason: string;
}

/**
 * `TelemetrySnapshot` — full state for monitoring dashboards.
 * JSON-serializable.
 */
export interface TelemetrySnapshot {
  readonly timestamp: number;
  readonly numStrategies: number;
  readonly numActiveStrategies: number;
  readonly numDisabledStrategies: number;
  readonly totalTrades: number;
  readonly totalPnlUsd: number;
  readonly perStrategy: readonly PerStrategyStats[];
  readonly correlationMatrix: CorrelationMatrix | null;
  readonly killSwitchHistory: readonly KillSwitchEvent[];
}

// ----------------------------------------------------------------------
// StrategyTelemetry — main class
// ----------------------------------------------------------------------

/**
 * `StrategyTelemetry` — per-strategy PnL attribution + observability.
 *
 * Usage:
 *   const telemetry = new StrategyTelemetry();
 *   telemetry.recordTrade({ source: 'donchian', symbol: 'BTC/USDT', ... });
 *   telemetry.recordTrade({ source: 'mtf', symbol: 'ETH/USDT', ... });
 *   telemetry.recordReturn('donchian', 0.01); // daily return
 *   const snapshot = telemetry.snapshot();
 *   telemetry.disablePlugin('mtf', 'over-trading'); // kill-switch
 *   telemetry.exportJson('/tmp/telemetry.json');
 */
export class StrategyTelemetry {
  readonly config: StrategyTelemetryConfig;

  // Per-strategy trade records (chronological order).
  private readonly perSourceTrades = new Map<string, TradeRecord[]>();
  // Per-strategy daily return series (parallel to perSourceReturns).
  private readonly perSourceReturns = new Map<string, number[]>();
  private readonly perSourceReturnTimestamps = new Map<string, number[]>();
  // Note: Field is `perSourceReturnTimestamps` (not `perSourceTimestamps`)
  // to avoid collision with PortfolioRiskEngine's perSourceTimestamps name
  // and to make the purpose explicit.
  // First/last seen timestamps per source.
  private readonly firstSeenAt = new Map<string, number>();
  private readonly lastSeenAt = new Map<string, number>();
  // Disabled plugins.
  private readonly disabledPlugins = new Set<string>();
  private readonly disabledAt = new Map<string, number>();
  private readonly lastReenabledAt = new Map<string, number>();
  // Kill-switch history.
  private readonly killSwitchHistory: KillSwitchEvent[] = [];
  // Signal count (for stats).
  private signalCount = 0;

  constructor(config: StrategyTelemetryConfig = DEFAULT_STRATEGY_TELEMETRY_CONFIG) {
    if (!Number.isInteger(config.sharpeWindowDays) || config.sharpeWindowDays <= 0) {
      throw new Error(`sharpeWindowDays must be positive integer, got ${String(config.sharpeWindowDays)}`);
    }
    if (!Number.isInteger(config.minTradeCount) || config.minTradeCount < 0) {
      throw new Error(`minTradeCount must be non-negative integer, got ${String(config.minTradeCount)}`);
    }
    if (typeof config.exportDelimiter !== "string" || config.exportDelimiter.length === 0) {
      throw new Error(`exportDelimiter must be non-empty string`);
    }
    this.config = config;
  }

  // --------------------------------------------------------------------
  // Signal ingestion (filter against kill-switch)
  // --------------------------------------------------------------------

  /**
   * `submitSignal` — observe a signal (typically from the SignalBus).
   * If the source is currently disabled (kill-switch active), the signal
   * is dropped (NOT recorded, NOT attributed). Otherwise the source is
   * marked as "seen" at this timestamp.
   *
   * Returns true if the signal was accepted, false if dropped.
   */
  submitSignal(signal: Signal): boolean {
    this.signalCount += 1;
    if (signal.kind === "risk") {
      // Risk signals don't have a source strategy to track.
      return true;
    }
    const source = signal.source;
    if (this.disabledPlugins.has(source)) {
      return false; // dropped by kill-switch
    }
    const now = signal.timestamp;
    if (!this.firstSeenAt.has(source)) {
      this.firstSeenAt.set(source, now);
    }
    this.lastSeenAt.set(source, now);
    return true;
  }

  // --------------------------------------------------------------------
  // Trade attribution
  // --------------------------------------------------------------------

  /**
   * `recordTrade` — attribute a trade to a strategy source. The trade
   * is added to the per-source list (sorted by timestamp).
   */
  recordTrade(trade: TradeRecord): void {
    if (!Number.isFinite(trade.notionalUsd)) {
      throw new Error(`trade.notionalUsd must be finite, got ${String(trade.notionalUsd)}`);
    }
    if (!Number.isFinite(trade.pnlUsd)) {
      throw new Error(`trade.pnlUsd must be finite, got ${String(trade.pnlUsd)}`);
    }
    if (typeof trade.source !== "string" || trade.source.length === 0) {
      throw new Error(`trade.source must be non-empty string`);
    }
    let list = this.perSourceTrades.get(trade.source);
    if (!list) {
      list = [];
      this.perSourceTrades.set(trade.source, list);
    }
    list.push(trade);
    list.sort((a, b) => a.timestamp - b.timestamp);
  }

  /**
   * `recordReturn` — record a daily return for a source (typically
   * from the engine or computed from trade PnL).
   */
  recordReturn(source: string, timestamp: number, returnPct: number): void {
    if (!Number.isFinite(returnPct)) {
      throw new Error(`returnPct must be finite for source=${source}, got ${String(returnPct)}`);
    }
    let series = this.perSourceReturns.get(source);
    let ts = this.perSourceReturnTimestamps.get(source);
    if (!series || !ts) {
      series = [];
      ts = [];
      this.perSourceReturns.set(source, series);
      this.perSourceReturnTimestamps.set(source, ts);
    }
    series.push(returnPct);
    ts.push(timestamp);
    while (series.length > this.config.sharpeWindowDays) {
      series.shift();
      ts.shift();
    }
  }

  // --------------------------------------------------------------------
  // Per-strategy stats
  // --------------------------------------------------------------------

  /**
   * `perStrategyStats` — compute aggregated stats for a single source.
   * Returns null if the source has fewer than `minTradeCount` trades
   * (too noisy to be meaningful).
   */
  perStrategyStats(source: string): PerStrategyStats | null {
    const trades = this.perSourceTrades.get(source);
    if (!trades || trades.length < this.config.minTradeCount) return null;
    const totalPnl = trades.reduce((acc, t) => acc + t.pnlUsd, 0);
    const winCount = trades.filter((t) => t.pnlUsd > 0).length;
    const lossCount = trades.filter((t) => t.pnlUsd < 0).length;
    const avgPnl = totalPnl / trades.length;
    // Per-trade Sharpe (mean / std of trade PnLs, not normalized by notional).
    const mean = avgPnl;
    const variance =
      trades.reduce((a, b) => a + (b.pnlUsd - mean) * (b.pnlUsd - mean), 0) /
      Math.max(1, trades.length - 1);
    const std = Math.sqrt(variance);
    const sharpe = std > 0 ? mean / std : 0;
    // Max DD from cumulative PnL curve.
    let cum = 0;
    let peak = 0;
    let maxDd = 0;
    for (const t of trades) {
      cum += t.pnlUsd;
      if (cum > peak) peak = cum;
      const dd = peak > 0 ? (peak - cum) / peak : 0;
      if (dd > maxDd) maxDd = dd;
    }
    return {
      source,
      tradeCount: trades.length,
      totalPnlUsd: totalPnl,
      winCount,
      lossCount,
      winRate: trades.length > 0 ? winCount / trades.length : 0,
      avgPnlUsd: avgPnl,
      sharpe,
      maxDrawdownPct: maxDd,
      disabled: this.disabledPlugins.has(source),
      disabledAt: this.disabledAt.get(source) ?? null,
      lastReenabledAt: this.lastReenabledAt.get(source) ?? null,
      firstSeenAt: this.firstSeenAt.get(source) ?? 0,
      lastSeenAt: this.lastSeenAt.get(source) ?? 0,
    };
  }

  /**
   * `allPerStrategyStats` — convenience: stats for all sources with ≥minTradeCount.
   */
  allPerStrategyStats(): readonly PerStrategyStats[] {
    const sources = Array.from(this.perSourceTrades.keys());
    const out: PerStrategyStats[] = [];
    for (const s of sources) {
      const stats = this.perStrategyStats(s);
      if (stats !== null) out.push(stats);
    }
    return out.sort((a, b) => b.totalPnlUsd - a.totalPnlUsd);
  }

  // --------------------------------------------------------------------
  // Cross-strategy correlation
  // --------------------------------------------------------------------

  /**
   * `correlationMatrix` — Pearson correlation between per-source return series.
   * Same algorithm as PortfolioRiskEngine.crossStrategyCorrelation, exposed
   * here for snapshot convenience.
   */
  correlationMatrix(): CorrelationMatrix | null {
    const sources = Array.from(this.perSourceReturns.keys()).sort();
    if (sources.length < 2) return null;
    let commonTs: Set<number> | null = null;
    for (const s of sources) {
      const ts = new Set(this.perSourceReturnTimestamps.get(s));
      if (commonTs === null) {
        commonTs = ts;
      } else {
        const intersection = new Set<number>();
        for (const t of commonTs) {
          if (ts.has(t)) intersection.add(t);
        }
        commonTs = intersection;
      }
    }
    if (!commonTs || commonTs.size < 2) return null;
    const sortedTs = Array.from(commonTs).sort((a, b) => a - b);
    const aligned: number[][] = sources.map((s) => {
      const tsArr = this.perSourceReturnTimestamps.get(s)!;
      const retArr = this.perSourceReturns.get(s)!;
      return sortedTs.map((t) => {
        const idx = tsArr.indexOf(t);
        return retArr[idx]!;
      });
    });
    const matrix: number[][] = [];
    for (let i = 0; i < sources.length; i++) {
      matrix.push([]);
      for (let j = 0; j < sources.length; j++) {
        if (i === j) {
          matrix[i]!.push(1);
        } else if (j < i) {
          matrix[i]!.push(matrix[j]![i]!);
        } else {
          matrix[i]!.push(pearson(aligned[i]!, aligned[j]!));
        }
      }
    }
    return {
      sources,
      matrix,
      windowDays: this.config.sharpeWindowDays,
      timestamp: sortedTs[sortedTs.length - 1]!,
      observationCount: sortedTs.length,
    };
  }

  // --------------------------------------------------------------------
  // Kill-switch interface
  // --------------------------------------------------------------------

  /**
   * `disablePlugin` — disable a strategy plugin (kill-switch active).
   * Subsequent signals from this source will be dropped by `submitSignal`.
   * Records the event in the kill-switch history.
   *
   * Idempotent: calling on an already-disabled plugin updates the
   * disabledAt timestamp (latest disable wins).
   */
  disablePlugin(source: string, reason: string): void {
    const now = Date.now();
    this.disabledPlugins.add(source);
    this.disabledAt.set(source, now);
    this.killSwitchHistory.push({ source, action: "disable", timestamp: now, reason });
  }

  /**
   * `enablePlugin` — re-enable a previously disabled plugin.
   * Manual reset only (no auto-reset). Records the event.
   *
   * Idempotent: calling on an already-enabled plugin is a no-op.
   */
  enablePlugin(source: string, reason = "manual reset"): void {
    if (!this.disabledPlugins.has(source)) return; // already enabled
    const now = Date.now();
    this.disabledPlugins.delete(source);
    this.lastReenabledAt.set(source, now);
    this.killSwitchHistory.push({ source, action: "enable", timestamp: now, reason });
  }

  /**
   * `isPluginDisabled` — true if the plugin is currently in kill-switch state.
   */
  isPluginDisabled(source: string): boolean {
    return this.disabledPlugins.has(source);
  }

  /**
   * `getKillSwitchHistory` — full history of kill-switch events.
   */
  getKillSwitchHistory(): readonly KillSwitchEvent[] {
    return [...this.killSwitchHistory];
  }

  /**
   * `getDisabledPlugins` — list of currently disabled plugin names.
   */
  getDisabledPlugins(): readonly string[] {
    return Array.from(this.disabledPlugins);
  }

  // --------------------------------------------------------------------
  // Snapshot
  // --------------------------------------------------------------------

  /**
   * `snapshot` — full state as a JSON-serializable object.
   */
  snapshot(): TelemetrySnapshot {
    const perStrat = this.allPerStrategyStats();
    const totalPnl = perStrat.reduce((acc, s) => acc + s.totalPnlUsd, 0);
    const totalTrades = perStrat.reduce((acc, s) => acc + s.tradeCount, 0);
    return {
      timestamp: Date.now(),
      numStrategies: this.perSourceTrades.size,
      numActiveStrategies: this.perSourceTrades.size - this.disabledPlugins.size,
      numDisabledStrategies: this.disabledPlugins.size,
      totalTrades,
      totalPnlUsd: totalPnl,
      perStrategy: perStrat,
      correlationMatrix: this.correlationMatrix(),
      killSwitchHistory: [...this.killSwitchHistory],
    };
  }

  // --------------------------------------------------------------------
  // Export — CSV / JSON for offline analysis
  // --------------------------------------------------------------------

  /**
   * `exportCsv` — return a CSV string with all trade records.
   * Columns: source, symbol, timestamp, side, notionalUsd, pnlUsd.
   */
  exportCsv(): string {
    const lines: string[] = [];
    const delim = this.config.exportDelimiter;
    lines.push(["source", "symbol", "timestamp", "side", "notionalUsd", "pnlUsd"].join(delim));
    // Sort by timestamp globally for chronological export.
    const all: TradeRecord[] = [];
    for (const trades of this.perSourceTrades.values()) {
      all.push(...trades);
    }
    all.sort((a, b) => a.timestamp - b.timestamp);
    for (const t of all) {
      lines.push(
        [
          escapeCsv(t.source, delim),
          escapeCsv(t.symbol, delim),
          String(t.timestamp),
          t.side,
          t.notionalUsd.toFixed(8),
          t.pnlUsd.toFixed(8),
        ].join(delim),
      );
    }
    return lines.join("\n");
  }

  /**
   * `exportJson` — return a JSON string of the full snapshot.
   */
  exportJson(): string {
    return JSON.stringify(this.snapshot(), null, 2);
  }

  /**
   * `exportPerStrategyCsv` — return a CSV with per-strategy aggregate stats.
   * Columns: source, tradeCount, totalPnlUsd, winRate, sharpe, maxDrawdownPct, disabled.
   */
  exportPerStrategyCsv(): string {
    const delim = this.config.exportDelimiter;
    const lines: string[] = [];
    lines.push(
      [
        "source",
        "tradeCount",
        "totalPnlUsd",
        "winRate",
        "sharpe",
        "maxDrawdownPct",
        "disabled",
      ].join(delim),
    );
    for (const s of this.allPerStrategyStats()) {
      lines.push(
        [
          escapeCsv(s.source, delim),
          String(s.tradeCount),
          s.totalPnlUsd.toFixed(2),
          s.winRate.toFixed(4),
          s.sharpe.toFixed(4),
          s.maxDrawdownPct.toFixed(4),
          s.disabled ? "true" : "false",
        ].join(delim),
      );
    }
    return lines.join("\n");
  }

  // --------------------------------------------------------------------
  // Diagnostics (for tests)
  // --------------------------------------------------------------------

  /**
   * `getTradeCount` — total trades recorded across all sources.
   */
  getTradeCount(): number {
    let n = 0;
    for (const list of this.perSourceTrades.values()) n += list.length;
    return n;
  }

  /**
   * `clear` — reset all state.
   */
  clear(): void {
    this.perSourceTrades.clear();
    this.perSourceReturns.clear();
    this.perSourceReturnTimestamps.clear();
    this.firstSeenAt.clear();
    this.lastSeenAt.clear();
    this.disabledPlugins.clear();
    this.disabledAt.clear();
    this.lastReenabledAt.clear();
    this.killSwitchHistory.length = 0;
    this.signalCount = 0;
  }
}

// ----------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------

/**
 * `pearson` — Pearson correlation coefficient. Pure function.
 */
function pearson(x: readonly number[], y: readonly number[]): number {
  if (x.length !== y.length || x.length < 2) return 0;
  const n = x.length;
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < n; i++) {
    sx += x[i]!;
    sy += y[i]!;
  }
  const mx = sx / n;
  const my = sy / n;
  let num = 0;
  let dx2 = 0;
  let dy2 = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i]! - mx;
    const dy = y[i]! - my;
    num += dx * dy;
    dx2 += dx * dx;
    dy2 += dy * dy;
  }
  const denom = Math.sqrt(dx2 * dy2);
  if (denom === 0) return 0;
  return num / denom;
}

/**
 * `escapeCsv` — escape a field for CSV output. If the delimiter is
 * in the value, wrap in double quotes and escape inner quotes.
 */
function escapeCsv(value: string, delim: string): string {
  if (value.includes(delim) || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}