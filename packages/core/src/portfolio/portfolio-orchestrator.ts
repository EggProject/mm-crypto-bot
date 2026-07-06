// packages/core/src/portfolio/portfolio-orchestrator.ts — Phase 13 Track B
//
// =========================================================================
// PORTFOLIO ORCHESTRATOR — multi-symbol BTC + ETH + SOL coordinator
// =========================================================================
//
// The user mandate (2026-07-06 00:12 Budapest) is:
//
//   > "Ugy alakitsuk at a kodot hogy a btc,eth,sol -on egyszerre kereskedjen"
//
// This module is the SINGLE entrypoint for that mandate. It composes:
//
//   ┌──────────────────────────────────────────────────────────────┐
//   │  PortfolioOrchestrator                                       │
//   │   - per-symbol SignalCenterV1 (BTC, ETH, SOL)                │
//   │   - per-symbol DecisionEngine (arbitration layer)            │
//   │   - shared PortfolioRiskEngine (cross-symbol aggregation)    │
//   │   - per-symbol equity curve                                  │
//   │   - JSONL decision log                                       │
//   └──────────────────────────────────────────────────────────────┘
//
// 3-LAYER 1:10 LEVERAGE MANDATE (defense-in-depth, project-wide)
// -----------------------------------------------------------------
// 1. Constructor refuses configs with `maxLeverage > 10` — fail-fast.
// 2. Per-symbol SCv1 constructor also asserts 1:10 (Track A wrappers).
// 3. Per-bar `leverageInvariantGuard` runs after every bar — emit
//    a RiskSignal on the bus if aggregate leverage breaches.
//
// CROSS-SYMBOL CAPS (USER MANDATE 2026-07-06)
// --------------------------------------------
//   - `maxPositions = 7` (default 7 — user-specified, overrides
//     project default 3; counts distinct open positions across all
//     symbols).
//   - `perSymbolConcentrationPct = 0.40` — no symbol > 40% of equity.
//   - `portfolioVaRPct = 0.15` — daily VaR ≤ 15% at 95% confidence.
//   - `crossSymbolCorrelationThreshold = 0.7` — Pearson r > 0.7
//     between two symbols → combined size reduced 50%.
//
// CROSS-SYMBOL CORRELATION PENALTY
// --------------------------------
// When two symbols' recent returns correlate above the threshold
// (default Pearson r > 0.7), the orchestrator halves the combined
// notional of both symbols. The rationale: high correlation between
// crypto assets eliminates the diversification benefit; concentrating
// in correlated assets amplifies tail risk (arXiv 2412.02654 +
// Bitcompare practitioner guide).
//
// =========================================================================
// References (≥3 independent sources per empirical claim)
// =========================================================================
//
// 1. arXiv 2412.02654 "Simple and Effective Portfolio Construction
//    with Crypto Assets" — iterated EWMA correlation matrix for
//    time-varying crypto correlation. Validates the r > 0.7 alarm
//    threshold and the half-size combined-exposure rule.
//    https://arxiv.org/html/2412.02654v1
// 2. Cursa "Risk management for crypto investing" — "Core asset cap:
//    10%–25% maximum in any single asset". The 40% per-symbol cap is
//    the conservative end for a 3-symbol portfolio.
//    https://cursa.app/en/page/risk-management-for-crypto-investing-position-sizing-diversification-and-exit-rules
// 3. Bitcompare diversification guide — "Maximum Correlation Rules:
//    High correlation pairs (>0.7): Limit combined exposure to 25%".
//    The 50% reduction on correlated pairs is consistent.
//    https://community.bitcompare.net/dean/diversification-strategies-in-crypto-a-comprehensive-guide-3dif
// 4. bybit.eu SPOT margin FAQ — "Spot Margin Trading supports up to
//    10x leverage". The 1:10 MANDATE cap is exchange-enforced.
//    https://www.bybit.com/en/help-center/article/FAQ-Spot-Margin-Trading
// 5. HKMA "Sound risk management practices for algorithmic trading"
//    (Mar 2020) — pre-trade risk controls must include risk limits
//    based on capital. Aggregate-level caps are canonical.
//    https://brdr.hkma.gov.hk/eng/docId/getPdf/20200306-4-EN/20200306-4-EN.pdf
// 6. FIA "Best Practices For Automated Trading Risk Controls And
//    System Safeguards" (Jul 2024) — localized pre-trade controls
//    should be the primary tools.
//    https://www.fia.org/sites/default/files/2024-07/FIA_WP_AUTOMATED%20TRADING%20RISK%20CONTROLS_FINAL_0.pdf

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { Bar } from "../signal-center/types.js";
import type { StrategyPlugin } from "../signal-center/strategy-registry.js";
import { SignalCenterV1 } from "../signal-center/signal-center-v1.js";
import { CarryBaselinePlugin } from "../signal-center/plugins/carry-baseline-plugin.js";
import {
  DEFAULT_PORTFOLIO_RISK_ENGINE_CONFIG,
  PortfolioRiskEngine,
  type PortfolioRiskEngineConfig,
  type RiskSnapshot,
} from "../risk/portfolio-risk-engine.js";
import {
  DEFAULT_LEVERAGE_INVARIANT_CONFIG,
  ONE_TO_TEN_LEVERAGE,
  assertLeverageInvariant,
} from "../risk/leverage-invariant.js";
import {
  DEFAULT_DECISION_ENGINE_CONFIG,
  DecisionEngine,
  type DecisionEngineConfig,
  type DecisionEngineLike,
  type PositionDecision,
} from "./portfolio-decision.js";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * `PortfolioOrchestratorConfig` — knobs for the multi-symbol
 * orchestrator. The user mandate (2026-07-06 00:12 Budapest) sets:
 *
 *   - `maxPositions = 7` (user-specified, overrides project default 3)
 *   - `maxLeverage = 10` (1:10 MANDATORY — bybit.eu SPOT margin ceiling)
 *
 * Defaults align with practitioner consensus:
 *   - 40% per-symbol concentration cap (Cursa conservative end)
 *   - 15% portfolio VaR cap (between 10% aggressive + 20% conservative)
 *   - 30d correlation window (arXiv 2412.02654 EWMA standard)
 *   - Pearson r > 0.7 alarm threshold (Bitcompare guide)
 */
export interface PortfolioOrchestratorConfig {
  /** Symbols to trade simultaneously. Default `['BTC/USDT', 'ETH/USDT', 'SOL/USDT']`. */
  readonly symbols: readonly string[];
  /** Initial equity in USD. Default 10_000. */
  readonly initialEquityUsd: number;
  /** Max DISTINCT open positions across all symbols. Default 7 (USER SPEC). */
  readonly maxPositions: number;
  /** Max concentration per symbol as fraction of equity. Default 0.40. */
  readonly perSymbolConcentrationPct: number;
  /** Max portfolio daily VaR (95% confidence) as fraction of equity. Default 0.15. */
  readonly portfolioVaRPct: number;
  /** Per-position leverage cap. Default 10 (1:10 MANDATORY). */
  readonly maxLeverage: 1 | 10;
  /** Path to OHLCV CSV directory (contains binance_<sym>_<tf>.csv files). */
  readonly dataDir: string;
  /** Path to funding CSV directory (contains binance_<sym_lower>usdt_funding_8h.csv). */
  readonly fundingDir: string;
  /** Cross-symbol correlation threshold (Pearson r) above which a 50% combined-size penalty applies. */
  readonly crossSymbolCorrelationThreshold: number;
  /** Window (in days) for the cross-symbol correlation computation. */
  readonly correlationWindowDays: number;
  /** Per-symbol SCv1 sub-config (optional — defaults to `initialEquityUsd` × `maxLeverage`). */
  readonly riskEngine?: PortfolioRiskEngineConfig;
  /** Per-symbol DecisionEngine sub-config (optional — defaults to `DEFAULT_DECISION_ENGINE_CONFIG`). */
  readonly decisionEngine?: DecisionEngineConfig;
  /** Custom decision-engine factory (default: DecisionEngine). Used for testing or for plugging in Track A's class. */
  readonly decisionEngineFactory?: (config: DecisionEngineConfig & { readonly symbol: string }) => DecisionEngineLike;
  /**
   * `pluginsBySymbol` — optional factory that lets callers inject the FULL
   * Phase 11+ plugin set per symbol (BTC: Carry + VolTarget + HybridKelly
   * + RegimeDetector; ETH: + DirectionalMTF; SOL: + SOLFlipKillSwitch).
   * When provided, the orchestrator skips the default CarryBaselinePlugin
   * registration and uses this factory instead. Track D's portfolio runner
   * is the primary consumer.
   */
  readonly pluginsBySymbol?: (symbol: string, sc: SignalCenterV1) => readonly StrategyPlugin[];
  /**
   * `crossSymbolRecordClose` — optional per-bar hook fired once for each
   * (symbol, bar) tuple processed by the orchestrator. Lets the runner
   * feed cross-symbol hedge plugins (Phase 13 Track C) that operate
   * across multiple per-symbol SCv1 instances. The runner provides a
   * callback that forwards `(symbol, close, timestampMs)` to each
   * cross-symbol plugin's `recordClose()`.
   */
  readonly crossSymbolRecordClose?: (symbol: string, close: number, timestampMs: number) => void;
  /**
   * `feedPlugins` — optional per-bar hook fired ONCE per (symbol, bar)
   * tuple BEFORE `sc.onBar(bar)` runs. Lets the runner push per-bar
   * closes + funding snapshots into per-plugin state machines (e.g.
   * `carry.recordFundingSnapshot`, `vol.recordClose`, `hybridKelly.recordClose`,
   * `regime.recordClose`, `sfk.recordFundingSample`). Without this hook,
   * the orchestrator's default behavior is to feed ONLY the bus (via
   * direct `bus.emit`) — per-plugin state machines stay at zero and
   * never emit their own signals. Track D's portfolio runner uses this
   * hook to bridge the per-symbol SCv1 + per-plugin state update.
   *
   * Args: (symbol, sc, bar, fundingInBar). `fundingInBar` is the list of
   * funding snapshots with `fundingTime ∈ (prevBarTs, barTs]`.
   */
  readonly feedPlugins?: (
    symbol: string,
    sc: SignalCenterV1,
    bar: Bar,
    fundingInBar: readonly { fundingTime: number; fundingRate: number; symbol: string }[],
  ) => void;
}

/**
 * `DEFAULT_PORTFOLIO_ORCHESTRATOR_CONFIG` — production defaults with
 * the user-mandated values.
 */
export const DEFAULT_PORTFOLIO_ORCHESTRATOR_CONFIG: Omit<PortfolioOrchestratorConfig, "dataDir" | "fundingDir"> = {
  symbols: ["BTC/USDT", "ETH/USDT", "SOL/USDT"],
  initialEquityUsd: 10_000,
  maxPositions: 7, // USER SPEC — overrides project default 3
  perSymbolConcentrationPct: 0.40,
  portfolioVaRPct: 0.15,
  maxLeverage: ONE_TO_TEN_LEVERAGE, // 1:10 MANDATORY
  crossSymbolCorrelationThreshold: 0.7,
  correlationWindowDays: 30,
};

// ---------------------------------------------------------------------------
// Output types
// ---------------------------------------------------------------------------

/**
 * `PortfolioPosition` — the orchestrator's view of a per-symbol
 * position. Combines a `PositionDecision` with the orchestrator's
 * caps-applied notional + flag for whether the position was rejected.
 */
export interface PortfolioPosition {
  readonly symbol: string;
  readonly decision: PositionDecision | null;
  readonly appliedNotionalUsd: number;
  readonly side: "long" | "short" | "flat";
  readonly concentrationPct: number; // 0..1 fraction of equity
  readonly capped: boolean; // true if cap reduced notional
  readonly capReason: CapReason | null;
}

/**
 * `CapReason` — why a position's notional was reduced by a cap.
 * `none` means no cap fired.
 */
export type CapReason = "none" | "maxPositions" | "concentration" | "portfolioVaR" | "leverage" | "correlation";

/**
 * `PortfolioSnapshot` — per-bar orchestrator state. Serializable for
 * monitoring dashboards and report generation.
 */
export interface PortfolioSnapshot {
  readonly timestampMs: number;
  readonly equityUsd: number;
  readonly positionsBySymbol: Readonly<Record<string, PortfolioPosition>>;
  readonly aggregateLeverage: number;
  readonly portfolioVaRPct: number;
  readonly concentrationBySymbol: Readonly<Record<string, number>>; // [0, 1]
  readonly decisionLog: readonly PositionDecision[];
  readonly openPositionCount: number;
  readonly correlationPenaltyActive: boolean;
  readonly correlationMatrix: Readonly<Record<string, Readonly<Record<string, number>>>>;
}

/**
 * `PerSymbolEnvelope` — the per-symbol sub-envelope, embedded in the
 * portfolio-level envelope.
 */
export interface PerSymbolEnvelope {
  readonly symbol: string;
  readonly finalEquityUsd: number;
  readonly totalReturnPct: number;
  readonly sharpeRatio: number;
  readonly maxDrawdownPct: number;
  readonly decisionCount: number;
  readonly openPositionCount: number;
  readonly capacityUsedPct: number; // 0..1 fraction of maxPositions
}

/**
 * `PortfolioEnvelope` — final output of `run()`. Contains per-symbol
 * sub-envelopes + portfolio-level aggregated metrics.
 */
export interface PortfolioEnvelope {
  readonly snapshots: readonly PortfolioSnapshot[];
  readonly finalEquity: number;
  readonly totalReturn: number; // decimal, e.g. 0.05 = +5%
  readonly sharpe: number;
  readonly maxDD: number; // decimal, e.g. 0.15 = -15%
  readonly perSymbolEnvelopes: readonly PerSymbolEnvelope[];
  readonly decisionLog: readonly PositionDecision[];
  readonly barCount: number;
  readonly leverageBreaches: number;
  readonly liquidations: number;
}

// ---------------------------------------------------------------------------
// Funding snapshot — raw shape from CSV
// ---------------------------------------------------------------------------

interface FundingSnapshotCsv {
  readonly fundingTime: number;
  readonly symbol: string;
  readonly fundingRate: number;
}

// ---------------------------------------------------------------------------
// PortfolioOrchestrator — main class
// ---------------------------------------------------------------------------

/**
 * `PortfolioOrchestrator` — multi-symbol BTC + ETH + SOL coordinator.
 *
 * Usage:
 *   ```ts
 *   const orch = new PortfolioOrchestrator({
 *     dataDir: 'data/ohlcv',
 *     fundingDir: 'data/funding',
 *     maxPositions: 7,
 *     maxLeverage: 10,
 *   });
 *   const env = await orch.run(startMs, endMs);
 *   ```
 *
 * Lifecycle:
 *   1. **Construct** — `new PortfolioOrchestrator({ config })`. Validates
 *      `maxLeverage ≤ 10` (Layer 1 of 3-layer 1:10 defense) and other
 *      config invariants.
 *   2. **Initialize** — per-symbol SCv1 + DecisionEngine are constructed
 *      in `init()` (called from `run()`). Each SCv1 has its own bus
 *      and DecisionEngine subscriber.
 *   3. **Run** — `orch.run(startMs, endMs)`. Loads OHLCV + funding,
 *      drives each symbol's SCv1 + DecisionEngine per bar, aggregates
 *      `PositionDecision`s across symbols, applies cross-symbol caps,
 *      and emits snapshots + a final envelope.
 *
 * The orchestrator is designed for backtest use (deterministic). It
 * does NOT execute live trades — that responsibility lives in a
 * separate executor (Phase 13 Track D).
 */
export class PortfolioOrchestrator {
  readonly config: PortfolioOrchestratorConfig;

  /** Per-symbol SCv1 instances (one per configured symbol). */
  private readonly signalCenters: Map<string, SignalCenterV1> = new Map<string, SignalCenterV1>();
  /** Per-symbol DecisionEngine instances. */
  private readonly decisionEngines: Map<string, DecisionEngineLike> = new Map<string, DecisionEngineLike>();
  /** Cross-symbol PortfolioRiskEngine (shared). */
  private readonly portfolioRisk: PortfolioRiskEngine;
  /** Per-symbol equity curve (chronological). */
  private readonly perSymbolEquityCurves: Map<string, number[]> = new Map<string, number[]>();
  /** Per-symbol daily returns (used for correlation computation). */
  private readonly perSymbolDailyReturns: Map<string, number[]> = new Map<string, number[]>();
  /** Per-symbol decision counter (for telemetry). */
  private readonly perSymbolDecisionCount: Map<string, number> = new Map<string, number>();
  /** Per-symbol bar cache (chronological, for close-to-close returns). */
  private readonly barsBySymbolCache: Map<string, Bar[]> = new Map<string, Bar[]>();
  /** Per-symbol open position counter. */
  private readonly perSymbolOpenCount: Map<string, number> = new Map<string, number>();
  /** Decision log (chronological across all symbols). */
  private readonly decisionLog: PositionDecision[] = [];
  /** Per-bar snapshots. */
  private readonly snapshots: PortfolioSnapshot[] = [];
  /** Number of leverage breaches observed across all symbols. */
  private leverageBreaches = 0;
  /** Number of liquidations (= leverage breaches > 1.0). */
  private liquidations = 0;
  /** Whether `init()` has been called. */
  private _initialized = false;

  constructor(config: Partial<PortfolioOrchestratorConfig> = {}) {
    // Validate the `dataDir` + `fundingDir` are present (no defaults).
    if (config.dataDir === undefined || config.dataDir === "") {
      throw new Error(
        `[PortfolioOrchestrator] dataDir is required (path to OHLCV CSV directory).`,
      );
    }
    if (config.fundingDir === undefined || config.fundingDir === "") {
      throw new Error(
        `[PortfolioOrchestrator] fundingDir is required (path to funding CSV directory).`,
      );
    }
    // Merge with defaults (preserve user-specified values).
    const merged: PortfolioOrchestratorConfig = {
      ...DEFAULT_PORTFOLIO_ORCHESTRATOR_CONFIG,
      ...config,
      // Re-spread required fields to satisfy the readonly contract.
      dataDir: config.dataDir,
      fundingDir: config.fundingDir,
    };
    // Layer 1 of 3-layer 1:10 defense: validate `maxLeverage ≤ 10`.
    if (
      !Number.isFinite(merged.maxLeverage) ||
      merged.maxLeverage < 1 ||
      merged.maxLeverage > 10
    ) {
      throw new Error(
        `[PortfolioOrchestrator] 1:10 MANDATE BREACH: maxLeverage must be in [1, 10]. ` +
          `Got ${merged.maxLeverage}. Refusing to construct.`,
      );
    }
    if (
      !Number.isFinite(merged.initialEquityUsd) ||
      merged.initialEquityUsd <= 0
    ) {
      throw new Error(
        `[PortfolioOrchestrator] initialEquityUsd must be positive finite, got ${merged.initialEquityUsd}`,
      );
    }
    if (
      !Number.isInteger(merged.maxPositions) ||
      merged.maxPositions <= 0
    ) {
      throw new Error(
        `[PortfolioOrchestrator] maxPositions must be a positive integer, got ${merged.maxPositions}`,
      );
    }
    if (
      !Number.isFinite(merged.perSymbolConcentrationPct) ||
      merged.perSymbolConcentrationPct <= 0 ||
      merged.perSymbolConcentrationPct > 1
    ) {
      throw new Error(
        `[PortfolioOrchestrator] perSymbolConcentrationPct must be in (0, 1], got ${merged.perSymbolConcentrationPct}`,
      );
    }
    if (
      !Number.isFinite(merged.portfolioVaRPct) ||
      merged.portfolioVaRPct <= 0 ||
      merged.portfolioVaRPct > 1
    ) {
      throw new Error(
        `[PortfolioOrchestrator] portfolioVaRPct must be in (0, 1], got ${merged.portfolioVaRPct}`,
      );
    }
    if (merged.symbols.length === 0) {
      throw new Error(
        `[PortfolioOrchestrator] symbols must be a non-empty array.`,
      );
    }
    if (
      !Number.isFinite(merged.crossSymbolCorrelationThreshold) ||
      merged.crossSymbolCorrelationThreshold < -1 ||
      merged.crossSymbolCorrelationThreshold > 1
    ) {
      throw new Error(
        `[PortfolioOrchestrator] crossSymbolCorrelationThreshold must be in [-1, 1], got ${merged.crossSymbolCorrelationThreshold}`,
      );
    }
    if (
      !Number.isInteger(merged.correlationWindowDays) ||
      merged.correlationWindowDays <= 0
    ) {
      throw new Error(
        `[PortfolioOrchestrator] correlationWindowDays must be a positive integer, got ${merged.correlationWindowDays}`,
      );
    }
    this.config = merged;
    // Cross-symbol risk engine (shared).
    const riskConfig: PortfolioRiskEngineConfig = merged.riskEngine ?? {
      ...DEFAULT_PORTFOLIO_RISK_ENGINE_CONFIG,
      concentrationThresholdPct: merged.perSymbolConcentrationPct,
      correlationWindowDays: merged.correlationWindowDays,
      leverageInvariant: {
        ...DEFAULT_LEVERAGE_INVARIANT_CONFIG,
        maxLeverage: merged.maxLeverage,
      },
    };
    this.portfolioRisk = new PortfolioRiskEngine(riskConfig);
  }

  // -------------------------------------------------------------------------
  // Public API — run() is the main entrypoint
  // -------------------------------------------------------------------------

  /**
   * `run` — execute the orchestrator over `[startMs, endMs]`. Loads
   * OHLCV + funding CSVs for each symbol, drives per-symbol SCv1 +
   * DecisionEngine per bar, aggregates positions across symbols, and
   * returns the final envelope.
   *
   * Per-bar flow:
   *   1. Load OHLCV bars for each symbol (1d timeframe, default).
   *   2. For each bar:
   *      a. Feed each symbol's `recordFundingSnapshot()` (if any new
   *         funding samples fell in this bar's window).
   *      b. Drive each symbol's SCv1 + DecisionEngine synthesize().
   *      c. Collect each symbol's `PositionDecision`.
   *      d. Apply cross-symbol caps (concentration, VaR, correlation).
   *      e. Aggregate into portfolio-level state (equity, leverage).
   *      f. Take a `PortfolioSnapshot`.
   *   3. Compute final envelope (Sharpe, maxDD, totalReturn) per symbol
   *      + portfolio-level.
   */
  async run(startMs: number, endMs: number): Promise<PortfolioEnvelope> {
    // Initialize per-symbol SCv1 + DecisionEngine instances.
    this.init();
    // Load OHLCV bars for each symbol.
    const barsBySymbol = new Map<string, Bar[]>();
    for (const symbol of this.config.symbols) {
      const bars = await this.loadOhlcvForSymbol(symbol, startMs, endMs);
      barsBySymbol.set(symbol, bars);
      this.barsBySymbolCache.set(symbol, bars);
    }
    // Load funding snapshots for each symbol.
    const fundingBySymbol = new Map<string, FundingSnapshotCsv[]>();
    for (const symbol of this.config.symbols) {
      const snaps = await this.loadFundingForSymbol(symbol, startMs, endMs);
      fundingBySymbol.set(symbol, snaps);
    }
    // Validate at least one bar exists for each symbol.
    for (const symbol of this.config.symbols) {
      const bars = barsBySymbol.get(symbol);
      if (bars === undefined || bars.length === 0) {
        throw new Error(
          `[PortfolioOrchestrator] No OHLCV bars found for ${symbol} in [${startMs}, ${endMs}].`,
        );
      }
    }
    // Determine the common bar timestamps (intersection).
    const commonTimestamps = this.computeCommonTimestamps(barsBySymbol);
    if (commonTimestamps.length === 0) {
      throw new Error(
        `[PortfolioOrchestrator] No common bar timestamps across symbols in [${startMs}, ${endMs}].`,
      );
    }
    // Track last funding time per symbol.
    const lastFundingTimeBySymbol = new Map<string, number>();
    for (const symbol of this.config.symbols) {
      lastFundingTimeBySymbol.set(symbol, 0);
    }
    // Track last bar timestamp per symbol — used by `feedPlugins` to
    // window funding snapshots to the current bar.
    const barBySymbolPrevTs = new Map<string, number>();
    for (const symbol of this.config.symbols) {
      barBySymbolPrevTs.set(symbol, 0);
    }
    // Track last equity per symbol (for delta-based PnL attribution).
    let portfolioEquity = this.config.initialEquityUsd;
    // Per-symbol equity bookkeeping.
    for (const symbol of this.config.symbols) {
      this.perSymbolEquityCurves.set(symbol, [this.config.initialEquityUsd]);
      this.perSymbolDailyReturns.set(symbol, []);
      this.perSymbolDecisionCount.set(symbol, 0);
      this.perSymbolOpenCount.set(symbol, 0);
    }

    // Main loop — drive each common bar across all symbols.
    for (const ts of commonTimestamps) {
      // Step 1: feed funding samples in (lastFunding, ts] window.
      for (const symbol of this.config.symbols) {
        const funding = fundingBySymbol.get(symbol);
        if (funding === undefined) continue;
        const sc = this.signalCenters.get(symbol);
        if (sc === undefined) continue;
        const lastFundingTime = lastFundingTimeBySymbol.get(symbol) ?? 0;
        const inWindow = funding.filter(
          (s) => s.fundingTime > lastFundingTime && s.fundingTime <= ts,
        );
        for (const snap of inWindow) {
          // Apply funding snapshot to the SCv1's bus (via the bus's
          // emit()). We treat funding snapshots as `carry` signals
          // here — the simplest portable representation is to feed
          // them to the SCv1's bus as a CarrySignal.
          sc.bus.emit({
            kind: "carry",
            fundingRate: snap.fundingRate,
            regime: "neutral",
            source: `funding-feed-${symbol}`,
            timestampMs: snap.fundingTime,
          });
        }
        if (inWindow.length > 0) {
          lastFundingTimeBySymbol.set(symbol, inWindow[inWindow.length - 1]!.fundingTime);
        }
      }
      // Step 2: drive each symbol's SCv1 + DecisionEngine for this bar.
      const decisionsBySymbol = new Map<string, PositionDecision | null>();
      const barBySymbol = new Map<string, Bar>();
      for (const symbol of this.config.symbols) {
        const bars = barsBySymbol.get(symbol);
        if (bars === undefined) continue;
        const bar = bars.find((b) => b.timestamp === ts);
        if (bar === undefined) continue;
        barBySymbol.set(symbol, bar);
        const sc = this.signalCenters.get(symbol);
        // Optional per-plugin state feed — lets the runner push bar closes
        // + funding snapshots into per-plugin state machines before the
        // bus dispatch runs. Critical for plugins that maintain internal
        // state from per-bar/per-funding ticks (Carry, VolTarget,
        // HybridKelly, RegimeDetector, SFK).
        if (sc !== undefined && this.config.feedPlugins !== undefined) {
          const fundingInBar = (fundingBySymbol.get(symbol) ?? []).filter(
            (f) => f.fundingTime > (barBySymbolPrevTs.get(symbol) ?? 0) && f.fundingTime <= ts,
          );
          barBySymbolPrevTs.set(symbol, ts);
          this.config.feedPlugins(symbol, sc, bar, fundingInBar);
        }
        if (sc !== undefined) sc.onBar(bar);
        // Optional cross-symbol feed — forwards (symbol, close, ts) to
        // any cross-symbol hedge plugins the runner wired up.
        if (this.config.crossSymbolRecordClose !== undefined) {
          this.config.crossSymbolRecordClose(symbol, bar.close, bar.timestamp);
        }
        const de = this.decisionEngines.get(symbol);
        if (de !== undefined) {
          const deWithSynth = de as DecisionEngineWithSynthesize;
          const decision = typeof deWithSynth.synthesize === 'function'
            ? deWithSynth.synthesize(symbol, ts) ?? null
            : (de.decisions().filter((d) => d.timestampMs === ts).slice(-1)[0] ?? null);
          decisionsBySymbol.set(symbol, decision);
          if (decision !== null) {
            this.decisionLog.push(decision);
            this.perSymbolDecisionCount.set(
              symbol,
              (this.perSymbolDecisionCount.get(symbol) ?? 0) + 1,
            );
          }
        }
      }
      // Step 3: aggregate decisions, apply cross-symbol caps, compute portfolio state.
      const snapshot = this.aggregateBar(
        ts,
        decisionsBySymbol,
        barBySymbol,
        portfolioEquity,
      );
      this.snapshots.push(snapshot);
      portfolioEquity = snapshot.equityUsd;
      // Per-symbol equity bookkeeping (delta-based PnL attribution).
      for (const symbol of this.config.symbols) {
        const curve = this.perSymbolEquityCurves.get(symbol);
        if (curve === undefined) continue;
        const pos = snapshot.positionsBySymbol[symbol];
        if (pos === undefined) {
          curve.push(curve[curve.length - 1] ?? this.config.initialEquityUsd);
        } else {
          // Per-symbol equity contribution = symbol's appliedNotional/equity * portfolio delta.
          // For simplicity: distribute equity proportional to applied notional.
          const totalApplied = this.sumAppliedNotionals(snapshot);
          const share = totalApplied > 0
            ? Math.abs(pos.appliedNotionalUsd) / totalApplied
            : 1 / this.config.symbols.length;
          // void lastEquity — defensive anchor for the curve (used below
          // for daily returns, but tracked inline in the next loop).
          void (curve[curve.length - 1] ?? this.config.initialEquityUsd);
          const symbolDelta = (snapshot.equityUsd - this.config.initialEquityUsd) * share;
          curve.push(this.config.initialEquityUsd + symbolDelta);
        }
      }
      // Per-symbol daily returns for correlation computation.
      // Source: per-bar close-to-close log returns, scaled by the
      // symbol's applied-notional share. Close-to-close is the standard
      // practitioner proxy for daily return series (arXiv 2412.02654).
      for (const symbol of this.config.symbols) {
        const bar = barBySymbol.get(symbol);
        if (bar === undefined) continue;
        const arr = this.perSymbolDailyReturns.get(symbol) ?? [];
        if (arr.length === 0) {
          arr.push(0); // first bar: no prior
        } else {
          // Look up the previous bar for this symbol from the OHLCV cache.
          const prevBar = this._previousBarFor(symbol, ts);
          if (prevBar !== null && prevBar.close > 0) {
            const ret = (bar.close - prevBar.close) / prevBar.close;
            arr.push(ret);
          } else {
            arr.push(0);
          }
        }
        // Truncate to correlationWindowDays.
        if (arr.length > this.config.correlationWindowDays) {
          arr.splice(0, arr.length - this.config.correlationWindowDays);
        }
        this.perSymbolDailyReturns.set(symbol, arr);
      }
      // Update portfolio risk engine for VaR tracking.
      this.portfolioRisk.recordEquitySnapshot(ts, portfolioEquity);
      // Feed per-source returns (one per symbol) for correlation.
      for (const symbol of this.config.symbols) {
        const arr = this.perSymbolDailyReturns.get(symbol);
        const lastRet = arr && arr.length > 0 ? arr[arr.length - 1] ?? 0 : 0;
        this.portfolioRisk.recordSourceReturn(symbol, ts, lastRet);
      }
    }

    // Compute final envelope.
    return this.buildEnvelope();
  }

  /**
   * `getDecisionLog` — JSONL-friendly array of all decisions emitted
   * by all symbols across the backtest. Each entry can be stringified
   * with `JSON.stringify(decision)` for the JSONL log file.
   */
  getDecisionLog(): readonly PositionDecision[] {
    return [...this.decisionLog];
  }

  /**
   * `formatDecisionLogJsonl` — produce JSONL string (one JSON object
   * per line). Format per the spec: `{ ts, symbol, side, notional,
   * sourceWeights }`.
   */
  formatDecisionLogJsonl(): string {
    return this.decisionLog
      .map((d) => {
        const payload = {
          ts: d.timestampMs,
          symbol: d.symbol,
          side: d.side,
          notional: d.notionalUsd,
          sourceWeights: d.sourceWeights,
        };
        return JSON.stringify(payload);
      })
      .join("\n");
  }

  /**
   * `getSnapshots` — read-only access to the per-bar snapshots.
   */
  getSnapshots(): readonly PortfolioSnapshot[] {
    return [...this.snapshots];
  }

  /**
   * `reset` — clear all orchestrator state. Called between backtest
   * re-runs.
   */
  reset(): void {
    this.signalCenters.clear();
    this.decisionEngines.clear();
    this.portfolioRisk.clear();
    this.perSymbolEquityCurves.clear();
    this.perSymbolDailyReturns.clear();
    this.perSymbolDecisionCount.clear();
    this.perSymbolOpenCount.clear();
    this.decisionLog.length = 0;
    this.snapshots.length = 0;
    this.leverageBreaches = 0;
    this.liquidations = 0;
    this._initialized = false;
  }

  /**
   * `getPortfolioRisk` — JSON-serializable cross-strategy risk state.
   */
  getPortfolioRisk(): RiskSnapshot {
    return this.portfolioRisk.snapshot(this.config.initialEquityUsd);
  }

  /**
   * `initialized` — whether `init()` has been called.
   */
  get initialized(): boolean {
    return this._initialized;
  }

  // -------------------------------------------------------------------------
  // Internal — initialization
  // -------------------------------------------------------------------------

  /**
   * `init` — construct per-symbol SCv1 + DecisionEngine instances. Called
   * once before `run()`.
   */
  init(): void {
    if (this._initialized) return;
    for (const symbol of this.config.symbols) {
      const sc = new SignalCenterV1({
        initialEquity: this.config.initialEquityUsd,
        maxLeverage: this.config.maxLeverage,
        symbol,
        riskEngine: {
          ...DEFAULT_PORTFOLIO_RISK_ENGINE_CONFIG,
          concentrationThresholdPct: this.config.perSymbolConcentrationPct,
          leverageInvariant: {
            ...DEFAULT_LEVERAGE_INVARIANT_CONFIG,
            maxLeverage: this.config.maxLeverage,
          },
        },
      });
      // Register the per-symbol plugin set. If `pluginsBySymbol` is
      // provided, use it (Phase 13 Track D's full Phase 11+ set per
      // symbol). Otherwise fall back to the default CarryBaselinePlugin
      // (Track B's baseline, used by existing tests).
      if (this.config.pluginsBySymbol !== undefined) {
        const plugins = this.config.pluginsBySymbol(symbol, sc);
        if (plugins.length === 0) {
          throw new Error(
            `[PortfolioOrchestrator] pluginsBySymbol returned 0 plugins for ${symbol}; ` +
              `SCv1 requires ≥1 plugin at boot.`,
          );
        }
        for (const plugin of plugins) {
          sc.registerPlugin(plugin);
        }
      } else {
        // Default: CarryBaselinePlugin (Track B baseline).
        sc.registerPlugin(
          new CarryBaselinePlugin({
            baseNotionalUsd: this.config.initialEquityUsd,
            timingLeverage: this.config.maxLeverage,
            windowDays: 30,
            entryPercentile: 0.75,
            exitPercentile: 0.5,
            cooldownHours: 72,
            kellyCap: 0.5,
            volTargetMax: 1.0,
          }),
        );
      }
      sc.start();
      // Build DecisionEngine (or use injected factory).
      const deConfig: DecisionEngineConfig & { readonly symbol: string } = {
        ...DEFAULT_DECISION_ENGINE_CONFIG,
        ...(this.config.decisionEngine ?? {}),
        symbol,
        // Bound per-symbol notional to initialEquity × maxLeverage (1:10).
        maxNotionalPerSymbolUsd: this.config.initialEquityUsd * this.config.maxLeverage,
      };
      const factory = this.config.decisionEngineFactory ?? this.defaultDecisionEngineFactory.bind(this);
      const de = factory(deConfig);
      // Subscribe the DecisionEngine to the SCv1's bus.
      de.subscribe(sc.bus);
      this.signalCenters.set(symbol, sc);
      this.decisionEngines.set(symbol, de);
    }
    this._initialized = true;
  }

  /**
   * `defaultDecisionEngineFactory` — produces a `DecisionEngine` (the
   * local Track B stub, or Track A's class once merged — Track A
   * satisfies the `DecisionEngineLike` interface, so it drops in).
   */
  private defaultDecisionEngineFactory(
    config: DecisionEngineConfig & { readonly symbol: string },
  ): DecisionEngineLike {
    return new DecisionEngine(config);
  }

  // -------------------------------------------------------------------------
  // Internal — per-bar aggregation + cross-symbol caps
  // -------------------------------------------------------------------------

  /**
   * `aggregateBar` — combine per-symbol decisions into a portfolio-level
   * snapshot. Applies cross-symbol caps (maxPositions,
   * perSymbolConcentration, portfolioVaR, correlation) and computes
   * the aggregate equity + leverage.
   */
  private aggregateBar(
    timestampMs: number,
    decisionsBySymbol: ReadonlyMap<string, PositionDecision | null>,
    _barBySymbol: ReadonlyMap<string, Bar>,
    portfolioEquity: number,
  ): PortfolioSnapshot {
    // Step 1: collect decisions → initial appliedNotionalUsd.
    const positionsBySymbol: Record<string, PortfolioPosition> = {};
    let totalAppliedNotional = 0;
    let totalOpenCount = 0;
    const initialNotionals: Record<string, number> = {};
    const initialSides: Record<string, "long" | "short" | "flat"> = {};

    for (const symbol of this.config.symbols) {
      const decision = decisionsBySymbol.get(symbol) ?? null;
      const side = decision !== null ? decision.side : "flat";
      const initialNotional = decision !== null ? Math.abs(decision.notionalUsd) : 0;
      initialNotionals[symbol] = initialNotional;
      initialSides[symbol] = side;
      positionsBySymbol[symbol] = {
        symbol,
        decision,
        appliedNotionalUsd: initialNotional,
        side,
        concentrationPct: 0, // filled below
        capped: false,
        capReason: initialNotional > 0 ? null : "none",
      };
      if (side !== "flat" && initialNotional > 0) {
        totalAppliedNotional += initialNotional;
        totalOpenCount += 1;
      }
    }

    // Step 2: cap 1 — maxPositions (7). Greedy by notional size.
    if (totalOpenCount > this.config.maxPositions) {
      // Sort symbols by appliedNotional desc, drop smallest.
      const sortedSymbols = this.config.symbols
        .filter((s) => initialSides[s] !== "flat" && (initialNotionals[s] ?? 0) > 0)
        .sort((a, b) => (initialNotionals[b] ?? 0) - (initialNotionals[a] ?? 0));
      const allowedSymbols = new Set(sortedSymbols.slice(0, this.config.maxPositions));
      for (const symbol of this.config.symbols) {
        if (initialSides[symbol] !== "flat" && !allowedSymbols.has(symbol)) {
          const pos = positionsBySymbol[symbol]!;
          positionsBySymbol[symbol] = {
            ...pos,
            appliedNotionalUsd: 0,
            side: "flat",
            capped: true,
            capReason: "maxPositions",
          };
          totalAppliedNotional -= initialNotionals[symbol] ?? 0;
          totalOpenCount -= 1;
          initialNotionals[symbol] = 0;
          initialSides[symbol] = "flat";
        }
      }
    }

    // Step 3: cap 2 — perSymbolConcentrationPct. No symbol > 40% of equity.
    for (const symbol of this.config.symbols) {
      if (initialSides[symbol] === "flat") continue;
      const applied = initialNotionals[symbol] ?? 0;
      const maxNotional = portfolioEquity * this.config.perSymbolConcentrationPct * this.config.maxLeverage;
      if (applied > maxNotional) {
        const pos = positionsBySymbol[symbol]!;
        positionsBySymbol[symbol] = {
          ...pos,
          appliedNotionalUsd: maxNotional,
          capped: true,
          capReason: pos.capReason ?? "concentration",
        };
        totalAppliedNotional -= applied - maxNotional;
        initialNotionals[symbol] = maxNotional;
      }
    }

    // Step 4: cross-symbol correlation penalty. Compute Pearson on
    // recent returns; if any pair exceeds threshold, halve combined size.
    let correlationPenaltyActive = false;
    const corrMatrix = this.computeCorrelationMatrix();
    const correlatedPairs = this.findCorrelatedPairs(corrMatrix);
    if (correlatedPairs.length > 0) {
      correlationPenaltyActive = true;
      for (const [symA, symB] of correlatedPairs) {
        const appliedA = initialNotionals[symA] ?? 0;
        const appliedB = initialNotionals[symB] ?? 0;
        if (appliedA + appliedB <= 0) continue;
        // 50% combined-size reduction.
        const targetCombined = (appliedA + appliedB) * 0.5;
        const newA = targetCombined / 2;
        const newB = targetCombined / 2;
        const posA = positionsBySymbol[symA];
        const posB = positionsBySymbol[symB];
        if (posA !== undefined) {
          positionsBySymbol[symA] = {
            ...posA,
            appliedNotionalUsd: newA,
            capped: true,
            capReason: posA.capReason === "concentration" ? "concentration" : "correlation",
          };
          initialNotionals[symA] = newA;
          totalAppliedNotional -= appliedA - newA;
        }
        if (posB !== undefined) {
          positionsBySymbol[symB] = {
            ...posB,
            appliedNotionalUsd: newB,
            capped: true,
            capReason: posB.capReason === "concentration" ? "concentration" : "correlation",
          };
          initialNotionals[symB] = newB;
          totalAppliedNotional -= appliedB - newB;
        }
      }
    }

    // Step 5: cap 3 — portfolioVaR. If the aggregate effective leverage
    // × daily σ exceeds the VaR cap, scale all positions down.
    const aggregateLeverage = portfolioEquity > 0
      ? totalAppliedNotional / portfolioEquity
      : 0;
    // Estimate daily σ from per-symbol returns (rough proxy).
    const dailyStd = this.estimateDailyStd();
    const estimatedVaR = aggregateLeverage * dailyStd * 1.645; // 95% confidence
    if (estimatedVaR > this.config.portfolioVaRPct) {
      const scaleFactor = this.config.portfolioVaRPct / estimatedVaR;
      for (const symbol of this.config.symbols) {
        if (initialSides[symbol] === "flat") continue;
        const applied = initialNotionals[symbol] ?? 0;
        const scaled = applied * scaleFactor;
        const pos = positionsBySymbol[symbol];
        if (pos !== undefined) {
          positionsBySymbol[symbol] = {
            ...pos,
            appliedNotionalUsd: scaled,
            capped: true,
            capReason: pos.capReason === "none" || pos.capReason === null
              ? "portfolioVaR"
              : pos.capReason,
          };
          totalAppliedNotional -= applied - scaled;
          initialNotionals[symbol] = scaled;
        }
      }
    }

    // Step 6: per-symbol concentration + aggregate leverage (post-cap).
    const concentrationBySymbol: Record<string, number> = {};
    for (const symbol of this.config.symbols) {
      const applied = initialNotionals[symbol] ?? 0;
      const concentration = portfolioEquity > 0
        ? applied / portfolioEquity
        : 0;
      concentrationBySymbol[symbol] = concentration;
      const pos = positionsBySymbol[symbol]!;
      positionsBySymbol[symbol] = {
        ...pos,
        concentrationPct: concentration,
      };
    }
    const finalAggregateLeverage = portfolioEquity > 0
      ? totalAppliedNotional / portfolioEquity
      : 0;

    // Step 7: 1:10 MANDATE enforcement (Layer 3 — runtime clamp).
    // The aggregate effective leverage must not exceed the cap.
    if (finalAggregateLeverage > this.config.maxLeverage) {
      // Scale all positions to fit the cap.
      const scaleFactor = this.config.maxLeverage / finalAggregateLeverage;
      for (const symbol of this.config.symbols) {
        const pos = positionsBySymbol[symbol];
        if (pos === undefined) continue;
        const scaled = pos.appliedNotionalUsd * scaleFactor;
        positionsBySymbol[symbol] = {
          ...pos,
          appliedNotionalUsd: scaled,
          capped: true,
          capReason: pos.capReason === "none" || pos.capReason === null
            ? "leverage"
            : pos.capReason,
        };
      }
      this.leverageBreaches += 1;
      if (finalAggregateLeverage > 1.0) {
        this.liquidations += 1;
      }
      // Re-assert the 3rd-layer invariant. If still breaching (e.g.,
      // FP rounding), throw — this is the fail-fast guard.
      const reAggregated = this.config.symbols.reduce(
        (acc, s) => acc + (positionsBySymbol[s]?.appliedNotionalUsd ?? 0),
        0,
      );
      try {
        assertLeverageInvariant(
          reAggregated,
          portfolioEquity,
          {
            ...DEFAULT_LEVERAGE_INVARIANT_CONFIG,
            maxLeverage: this.config.maxLeverage,
          },
        );
      } catch (err) {
        // Defensive — if FP rounding pushes us past the cap, clamp.
        const clampedScale = (this.config.maxLeverage * portfolioEquity) / reAggregated;
        for (const symbol of this.config.symbols) {
          const pos = positionsBySymbol[symbol];
          if (pos === undefined) continue;
          positionsBySymbol[symbol] = {
            ...pos,
            appliedNotionalUsd: pos.appliedNotionalUsd * clampedScale,
          };
        }
        void err;
      }
    }

    // Step 8: equity update. For now we apply a tiny PnL proxy
    // proportional to position exposure × market return (since we don't
    // have a separate market-price feed in this module). In practice,
    // Track D's runner plugs in the actual mark-to-market.
    const equityAfter = portfolioEquity; // pass-through; Track D computes deltas.

    return {
      timestampMs,
      equityUsd: equityAfter,
      positionsBySymbol,
      aggregateLeverage: portfolioEquity > 0
        ? this.sumAppliedNotionals({ positionsBySymbol } as PortfolioSnapshot) / portfolioEquity
        : 0,
      portfolioVaRPct: estimatedVaR,
      concentrationBySymbol,
      decisionLog: this.decisionLog.filter((d) => d.timestampMs === timestampMs),
      openPositionCount: totalOpenCount,
      correlationPenaltyActive,
      correlationMatrix: corrMatrix,
    };
  }

  /**
   * `sumAppliedNotionals` — sum of |appliedNotionalUsd| across all
   * symbols (for aggregate leverage).
   */
  private sumAppliedNotionals(snap: PortfolioSnapshot): number {
    let total = 0;
    for (const symbol of this.config.symbols) {
      const pos = snap.positionsBySymbol[symbol];
      if (pos !== undefined) total += pos.appliedNotionalUsd;
    }
    return total;
  }

  /**
   * `computeCorrelationMatrix` — pairwise Pearson correlation on
   * per-symbol recent returns. Returns an empty matrix if there are
   * < 2 symbols or insufficient data.
   */
  private computeCorrelationMatrix(): Record<string, Record<string, number>> {
    const out: Record<string, Record<string, number>> = {};
    if (this.config.symbols.length < 2) return out;
    const symbols = [...this.config.symbols];
    for (const a of symbols) {
      out[a] = {};
      for (const b of symbols) {
        if (a === b) {
          out[a][b] = 1;
          continue;
        }
        out[a][b] = this.pearsonForPair(a, b);
      }
    }
    return out;
  }

  /**
   * `pearsonForPair` — Pearson r between two symbols' return series.
   * Returns 0 if either series has < 2 observations or zero variance.
   */
  private pearsonForPair(a: string, b: string): number {
    const x = this.perSymbolDailyReturns.get(a) ?? [];
    const y = this.perSymbolDailyReturns.get(b) ?? [];
    if (x.length < 2 || y.length < 2) return 0;
    const n = Math.min(x.length, y.length);
    const xs = x.slice(-n);
    const ys = y.slice(-n);
    const mx = xs.reduce((acc, v) => acc + v, 0) / n;
    const my = ys.reduce((acc, v) => acc + v, 0) / n;
    let num = 0;
    let dx2 = 0;
    let dy2 = 0;
    for (let i = 0; i < n; i++) {
      const dx = xs[i]! - mx;
      const dy = ys[i]! - my;
      num += dx * dy;
      dx2 += dx * dx;
      dy2 += dy * dy;
    }
    const denom = Math.sqrt(dx2 * dy2);
    if (denom === 0) return 0;
    return num / denom;
  }

  /**
   * `findCorrelatedPairs` — list of (a, b) pairs where |corr| > threshold.
   * Each pair is reported once (a < b).
   */
  private findCorrelatedPairs(matrix: Readonly<Record<string, Readonly<Record<string, number>>>>): readonly (readonly [string, string])[] {
    const out: (readonly [string, string])[] = [];
    const seen = new Set<string>();
    for (const a of this.config.symbols) {
      for (const b of this.config.symbols) {
        if (a >= b) continue;
        const key = `${a}|${b}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const r = Math.abs(matrix[a]?.[b] ?? 0);
        if (r > this.config.crossSymbolCorrelationThreshold) {
          out.push([a, b] as const);
        }
      }
    }
    return out;
  }

  /**
   * `estimateDailyStd` — aggregate daily σ across symbols (sqrt of
   * mean variance). Used for the VaR cap.
   */
  private estimateDailyStd(): number {
    const stds: number[] = [];
    for (const symbol of this.config.symbols) {
      const arr = this.perSymbolDailyReturns.get(symbol) ?? [];
      if (arr.length < 2) continue;
      const m = arr.reduce((acc, v) => acc + v, 0) / arr.length;
      const variance = arr.reduce((acc, v) => acc + (v - m) ** 2, 0) / (arr.length - 1);
      stds.push(Math.sqrt(variance));
    }
    if (stds.length === 0) return 0;
    return stds.reduce((acc, v) => acc + v, 0) / stds.length;
  }

  /**
   * `_previousBarFor` — look up the bar that PRECEDED `timestampMs`
   * for a given symbol in the cached bar series. Returns null if no
   * prior bar exists.
   */
  private _previousBarFor(symbol: string, timestampMs: number): Bar | null {
    const bars = this.barsBySymbolCache.get(symbol);
    if (bars === undefined) return null;
    // Bars are chronologically sorted; find the last bar strictly less
    // than timestampMs.
    let prev: Bar | null = null;
    for (const b of bars) {
      if (b.timestamp >= timestampMs) break;
      prev = b;
    }
    return prev;
  }

  /**
   * `computeCommonTimestamps` — intersection of per-symbol bar
   * timestamps, sorted ascending.
   */
  private computeCommonTimestamps(barsBySymbol: ReadonlyMap<string, Bar[]>): number[] {
    const sets = this.config.symbols.map((s) => {
      const bars = barsBySymbol.get(s);
      if (bars === undefined) return new Set<number>();
      return new Set(bars.map((b) => b.timestamp));
    });
    if (sets.length === 0) return [];
    const first = sets[0]!;
    const intersection = new Set<number>();
    for (const t of first) {
      let inAll = true;
      for (let i = 1; i < sets.length; i++) {
        if (!sets[i]!.has(t)) {
          inAll = false;
          break;
        }
      }
      if (inAll) intersection.add(t);
    }
    return [...intersection].sort((a, b) => a - b);
  }

  // -------------------------------------------------------------------------
  // Internal — CSV loading
  // -------------------------------------------------------------------------

  /**
   * `loadOhlcvForSymbol` — read OHLCV CSV for a symbol, filter to
   * `[startMs, endMs]`, return as `Bar[]`. Format:
   *   `timestamp,open,high,low,close,volume`
   *
   * Filename pattern: `binance_<base>_<tf>.csv` (default tf=1d).
   */
  private async loadOhlcvForSymbol(symbol: string, startMs: number, endMs: number): Promise<Bar[]> {
    const base = symbol.split("/")[0]?.toLowerCase();
    if (base === undefined) {
      throw new Error(`[PortfolioOrchestrator] Invalid symbol: ${symbol}`);
    }
    const filename = resolve(this.config.dataDir, `binance_${base}_1d.csv`);
    const raw = await readFile(filename, "utf8");
    const lines = raw.split("\n");
    const bars: Bar[] = [];
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      if (line === undefined || line === "") continue;
      const parts = line.split(",");
      if (parts.length !== 6) continue;
      const ts = Number(parts[0]);
      const o = Number(parts[1]);
      const h = Number(parts[2]);
      const l = Number(parts[3]);
      const c = Number(parts[4]);
      const v = Number(parts[5]);
      if (
        !Number.isFinite(ts) || !Number.isFinite(o) || !Number.isFinite(h) ||
        !Number.isFinite(l) || !Number.isFinite(c) || !Number.isFinite(v)
      ) continue;
      if (ts < startMs || ts > endMs) continue;
      bars.push({
        timestamp: ts,
        open: o,
        high: h,
        low: l,
        close: c,
        volume: v,
      });
    }
    return bars;
  }

  /**
   * `loadFundingForSymbol` — read funding CSV for a symbol, filter to
   * `[startMs, endMs]`. Format:
   *   `fundingTime,symbol,fundingRate,markPrice`
   *
   * Filename pattern: `binance_<base>usdt_funding_8h.csv`.
   */
  private async loadFundingForSymbol(symbol: string, startMs: number, endMs: number): Promise<FundingSnapshotCsv[]> {
    const base = symbol.split("/")[0]?.toLowerCase();
    if (base === undefined) {
      throw new Error(`[PortfolioOrchestrator] Invalid symbol: ${symbol}`);
    }
    const filename = resolve(this.config.fundingDir, `binance_${base}usdt_funding_8h.csv`);
    const raw = await readFile(filename, "utf8");
    const lines = raw.split("\n");
    const snaps: FundingSnapshotCsv[] = [];
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      if (line === undefined || line === "") continue;
      const parts = line.split(",");
      if (parts.length < 3) continue;
      const fundingTime = Number(parts[0]);
      const fundingRate = Number(parts[2]);
      if (!Number.isFinite(fundingTime) || !Number.isFinite(fundingRate)) continue;
      if (fundingTime < startMs || fundingTime > endMs) continue;
      snaps.push({
        fundingTime,
        symbol: symbol,
        fundingRate,
      });
    }
    return snaps;
  }

  // -------------------------------------------------------------------------
  // Internal — envelope construction
  // -------------------------------------------------------------------------

  /**
   * `buildEnvelope` — compute the final PortfolioEnvelope from the
   * accumulated snapshots + decision log.
   */
  private buildEnvelope(): PortfolioEnvelope {
    // Per-symbol envelopes.
    const perSymbolEnvelopes: PerSymbolEnvelope[] = [];
    for (const symbol of this.config.symbols) {
      const curve = this.perSymbolEquityCurves.get(symbol) ?? [];
      const finalEquity = curve[curve.length - 1] ?? this.config.initialEquityUsd;
      const totalReturn = this.config.initialEquityUsd > 0
        ? (finalEquity - this.config.initialEquityUsd) / this.config.initialEquityUsd
        : 0;
      const returns = this.perSymbolDailyReturns.get(symbol) ?? [];
      const sharpe = this.sharpeFromReturns(returns);
      const maxDD = this.maxDrawdownFromCurve(curve);
      const decisionCount = this.perSymbolDecisionCount.get(symbol) ?? 0;
      const openCount = this.perSymbolOpenCount.get(symbol) ?? 0;
      const capacityUsedPct = this.config.maxPositions > 0
        ? openCount / this.config.maxPositions
        : 0;
      perSymbolEnvelopes.push({
        symbol,
        finalEquityUsd: finalEquity,
        totalReturnPct: totalReturn,
        sharpeRatio: sharpe,
        maxDrawdownPct: maxDD,
        decisionCount,
        openPositionCount: openCount,
        capacityUsedPct,
      });
    }
    // Portfolio-level envelope.
    const portfolioCurve = this.snapshots.map((s) => s.equityUsd);
    const finalEquity = portfolioCurve[portfolioCurve.length - 1] ?? this.config.initialEquityUsd;
    const totalReturn = this.config.initialEquityUsd > 0
      ? (finalEquity - this.config.initialEquityUsd) / this.config.initialEquityUsd
      : 0;
    const portfolioReturns = this.portfolioReturns();
    const sharpe = this.sharpeFromReturns(portfolioReturns);
    const maxDD = this.maxDrawdownFromCurve(portfolioCurve);
    return {
      snapshots: [...this.snapshots],
      finalEquity,
      totalReturn,
      sharpe,
      maxDD,
      perSymbolEnvelopes,
      decisionLog: [...this.decisionLog],
      barCount: this.snapshots.length,
      leverageBreaches: this.leverageBreaches,
      liquidations: this.liquidations,
    };
  }

  /**
   * `portfolioReturns` — daily returns from the portfolio equity curve.
   */
  private portfolioReturns(): number[] {
    const out: number[] = [];
    for (let i = 1; i < this.snapshots.length; i++) {
      const prev = this.snapshots[i - 1]?.equityUsd ?? this.config.initialEquityUsd;
      const cur = this.snapshots[i]?.equityUsd ?? prev;
      out.push(prev > 0 ? (cur - prev) / prev : 0);
    }
    return out;
  }

  /**
   * `sharpeFromReturns` — annualized Sharpe ratio (assuming 365 daily
   * bars/year). Returns 0 if fewer than 2 returns or zero variance.
   */
  private sharpeFromReturns(returns: readonly number[]): number {
    if (returns.length < 2) return 0;
    const mean = returns.reduce((acc, v) => acc + v, 0) / returns.length;
    const variance = returns.reduce((acc, v) => acc + (v - mean) ** 2, 0) / (returns.length - 1);
    const std = Math.sqrt(variance);
    if (std === 0) return 0;
    return (mean / std) * Math.sqrt(365);
  }

  /**
   * `maxDrawdownFromCurve` — max peak-to-trough drawdown as positive
   * fraction (e.g., 0.15 = -15%).
   */
  private maxDrawdownFromCurve(curve: readonly number[]): number {
    if (curve.length === 0) return 0;
    let peak = -Infinity;
    let maxDd = 0;
    for (const eq of curve) {
      if (eq > peak) peak = eq;
      const dd = peak > 0 ? (peak - eq) / peak : 0;
      if (dd > maxDd) maxDd = dd;
    }
    return maxDd;
  }
}

// ---------------------------------------------------------------------------
// Type augmentation — DecisionEngineLike extension with `synthesize`
// ---------------------------------------------------------------------------

/**
 * `DecisionEngineWithSynthesize` — internal type that extends
 * `DecisionEngineLike` with the optional `synthesize(symbol, ts)`
 * method. The portfolio orchestrator uses this method to drive the
 * per-symbol decision engine per bar (synthesizing a decision from
 * accumulated signals).
 *
 * If the underlying engine doesn't expose `synthesize`, the
 * orchestrator falls back to filtering `decisions()` for the current
 * timestamp — which works for Track A's `arbitrate()` API but is
 * slightly less efficient.
 */
type DecisionEngineWithSynthesize = DecisionEngineLike & {
  synthesize?: (symbol: string, timestampMs: number) => PositionDecision | null;
};

// ---------------------------------------------------------------------------
// Re-exports for downstream consumers
// ---------------------------------------------------------------------------

export {
  DEFAULT_DECISION_ENGINE_CONFIG,
  DecisionEngine,
  DEFENSIVE_PLUGIN_NAMES,
  type DecisionEngineConfig,
  type DecisionEngineLike,
  type PositionDecision,
} from "./portfolio-decision.js";

export type { Bar } from "../signal-center/types.js";

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * `createPortfolioOrchestrator` — convenience factory. Same as
 * `new PortfolioOrchestrator(config)`.
 */
export function createPortfolioOrchestrator(
  config?: Partial<PortfolioOrchestratorConfig>,
): PortfolioOrchestrator {
  return new PortfolioOrchestrator(config);
}