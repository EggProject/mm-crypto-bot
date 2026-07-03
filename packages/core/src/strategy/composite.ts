// packages/core/src/strategy/composite.ts — Composite multi-strategy ensemble
//
// Phase 5 — A multi-strategy ensemble (StrategyArena 2026 60/40 MR/TF alapján,
// Sharpe 1.58 / -9.2% DD empirikus referencia). Két komponenst kombinál:
//   - Component 1 (trend): a Phase 5 always-in trend-following,
//     biztosítja a TREND DIRECTION szűrőt
//   - Component 2 (signal): a Phase 4 mean-reversion BB,
//     biztosítja az ENTRY TRIGGERT (BB lower/upper touch)
//
// Trend-filter logika (kritikus — a Phase 4 mean-reversion stop-loss
// dominancia 73-82%-át a trend-piac ellen irányú short jelzések okozták):
//   - Ha trend (component1) NULL → egyik jelzést sem fogadjuk el (nincs trend)
//   - Ha trend LONG és MR LONG → mindkettő LONG, composite LONG
//   - Ha trend LONG és MR SHORT → MR jelzést ELVETJÜK (trend hosszabb távú), composite LONG
//   - Ha trend SHORT és MR SHORT → mindkettő SHORT, composite SHORT
//   - Ha trend SHORT és MR LONG → MR jelzést ELVETJÜK, composite SHORT
//   - Ha trend LONG/SHORT és MR NULL → composite a trend signált követi
//
// A Phase 5 brief §1.3-ban leírt "Strategy B" komponens.
//
// References:
//   - StrategyArena 2026: 60% MR + 40% Trend BTC 12-month composite:
//     +23.8% PnL, Sharpe 1.58, max DD -9.2% (lowest of any mix tested)
//   - SSRN Multi-Strategy Portfolios (académiai paper)
//   - Price Action Lab 2023: trend + MR ensemble "boosts Sharpe significantly"
//   - Doc: docs/research/phase5-strategy-selection.md §2.B

import type { Strategy, StrategyContext, StrategySignal } from "../types.js";

export interface CompositeStrategyConfig {
  readonly component1: Strategy;
  readonly component2: Strategy;
  /** If true (default), component2 signals are filtered by component1 direction. */
  readonly useTrendFilter: boolean;
  /** Confidence boost when both components agree on the same direction. */
  readonly agreementConfidenceBoost: number;
}

export const DEFAULT_COMPOSITE_CONFIG: Omit<CompositeStrategyConfig, "component1" | "component2"> = {
  useTrendFilter: true,
  agreementConfidenceBoost: 0.05,
};

export class CompositeStrategy implements Strategy {
  readonly name = "Phase 5 Composite (Trend-filtered MR+TF ensemble)";
  readonly timeframes = ["1d", "4h", "1h"] as const;
  readonly config: CompositeStrategyConfig;

  constructor(config: CompositeStrategyConfig) {
    this.config = config;
  }

  warmup(): number {
    // Both components must be warm before ensemble can produce signals
    return Math.max(
      this.config.component1.warmup(),
      this.config.component2.warmup(),
    );
  }

  /**
   `onCandle` — LTF-en (1h) hívódik. Meghívja mindkét komponenst, majd
     a trend-filter logika alapján kombinálja a jelzéseket.

     A signal-kombináció az alábbi szabályok szerint működik (trend-filter ON):
       1. Ha component1 signal == null → composite signal == null (no trend)
       2. Ha component2 signal == null → composite follows component1 (trend alone)
       3. Ha mindkettő ad signalt:
          - component1.side === component2.side → composite follows component2
            (MR trigger dominál, mert specifikusabb entry)
            + agreementConfidenceBoost bizalomban
          - component1.side !== component2.side → composite follows component1,
            component2 signal elvetve (trend védelem)

     Ha trend-filter OFF: bármelyik komponens signalt ad → composite követi azt
     (OR voting).
   */
  onCandle(ctx: StrategyContext): StrategySignal | null {
    const { component1, component2, useTrendFilter, agreementConfidenceBoost } = this.config;
    const name1 = component1.name;
    const name2 = component2.name;

    const sig1 = component1.onCandle(ctx);
    const sig2 = component2.onCandle(ctx);

    if (!useTrendFilter) {
      // OR voting: bármelyik
      if (sig1 !== null) return sig1;
      if (sig2 !== null) return sig2;
      return null;
    }

    // Trend-filter ON
    if (sig1 === null) {
      // No trend signal — no entry (trend-filter protects against MR-only trades)
      return null;
    }

    if (sig2 === null) {
      // Only trend signal — follow trend
      return sig1;
    }

    // Both signals present
    if (sig1.side === sig2.side) {
      // Agreement — follow MR (more specific trigger), boost confidence
      return {
        ...sig2,
        confidence: Math.min(1, sig2.confidence + agreementConfidenceBoost),
        reason: `Composite AGREEMENT (${name1} + ${name2}, both ${sig1.side.toUpperCase()}): ${sig2.reason}`,
      };
    }

    // Disagreement — TREND WINS, MR filtered out
    return {
      ...sig1,
      reason: `Composite TREND FILTER (${name1} ${sig1.side.toUpperCase()} overrides ${name2} ${sig2.side.toUpperCase()}): ${sig1.reason}`,
    };
  }
}
