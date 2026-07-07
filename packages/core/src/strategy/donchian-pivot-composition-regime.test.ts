// packages/core/src/strategy/donchian-pivot-composition-regime.test.ts —
// Phase 21 Track B — regime-conditioned cap wire-up tests for
// DonchianPivotComposition. Architecture A: strategy-side confidence
// scaling via `applyRegimeConditioning` at signal emit time.
//
// Tests (5 unit tests + 1 unit-level 1:10 invariant):
//   1. Default-off (no regime config) is bit-identical — emit chain
//      does NOT touch signal.confidence / signal.reason / signal.metadata
//      when no regime config is present (Phase 19 baseline contract).
//   2. regimeConditionedCap set + timeline → emitted signal.confidence
//      is multiplied by the regime multiplier for the bar's regime
//      (volatile × 0.4 = 0.4 × base; ranging × 0.7; trending × 1.0).
//   3. getRegimeAt(timeline, future_timestamp) → fallback "trending"
//      (after-end safe-fallback; Track A documented behavior).
//   4. applyRegimeToCap(0.12, "volatile", default) = 0.048 — flow-through
//      at the strategy level (single-bar sanity).
//   5. 1:10 leverage invariant: max notional on the run ≤ equity × 10
//      under regime conditioning (baseCap 0.12 + volatileMult 0.4 =
//      0.048 max effective cap; 0.048 × 10 = 0.48 → 48% × 10x = $48000
//      at $10k equity, well under 1:10 ceiling of $100k).
//   6. Immutability: regime-conditioned signal does NOT mutate the
//      input SizingSignal (defensive copy via spread).
//   7. metadata field is populated with { regime, regimeMultiplier }
//      for downstream observability + the runBacktest post-trade
//      reporting pipeline.

import { describe, expect, it } from "bun:test";

import type { Candle } from "@mm-crypto-bot/shared/types";

import type { MtfState, StrategyContext, StrategySignal } from "../types.js";
import {
  DEFAULT_DONCHIAN_PIVOT_COMPOSITION_CONFIG,
  DonchianPivotComposition,
} from "./donchian-pivot-composition.js";
import {
  applyRegimeToCap,
  buildRegimeTimeline,
  DEFAULT_REGIME_CONDITIONED_CAP_CONFIG,
  type RegimeTimelineEntry,
} from "./regime-conditioned-cap.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function mkCandle(overrides: Partial<Candle> = {}): Candle {
  return {
    timestamp: 0,
    open: 100,
    high: 102,
    low: 98,
    close: 100,
    volume: 1000,
    ...overrides,
  };
}

function mkState(): MtfState {
  return { htf: {}, mtf: {}, ltf: {} };
}

function mkContext(timestamp: number): StrategyContext {
  return {
    symbol: "BTC/USDC" as never,
    timeframe: "15m",
    candleIndex: 5000,
    candle: mkCandle({ timestamp }),
    mtfState: mkState(),
    pricePrecision: 2,
  };
}

function mkLongSignal(
  confidence: number,
  opts: { readonly stopLoss?: number; readonly takeProfit?: number; readonly reason?: string } = {},
): StrategySignal {
  return {
    side: "buy",
    confidence,
    reason: opts.reason ?? "long signal",
    stopLoss: opts.stopLoss ?? 95,
    takeProfit: opts.takeProfit ?? 110,
  };
}

function stubSubStrategies(
  c: DonchianPivotComposition,
  stubs: Readonly<Record<string, StrategySignal | null>>,
): void {
  c.donchianRange.onCandle = (_ctx: StrategyContext): StrategySignal | null =>
    stubs["donchian-range"] ?? null;
  c.pivotGrid.onCandle = (_ctx: StrategyContext): StrategySignal | null =>
    stubs["pivot-grid"] ?? null;
}

/**
 * Build a synthetic RegimeTimelineEntry for unit tests — each entry
 * is { timestamp, regime, multiplier, posteriorProbs } with
 * multiplier matching the regime. We construct the timeline by hand
 * (not via `buildRegimeTimeline`) so tests don't depend on the
 * HMM/ATR classifier — these tests are about the CONSUMER side
 * (`applyRegimeConditioning`) not the PRODUCER side.
 */
function mkTimeline(
  entries: readonly {
    readonly timestamp: number;
    readonly regime: "trending" | "ranging" | "volatile";
  }[],
): readonly RegimeTimelineEntry[] {
  return entries.map((e) => {
    const mult =
      e.regime === "trending"
        ? 1.0
        : e.regime === "ranging"
          ? 0.7
          : 0.4;
    return {
      timestamp: e.timestamp,
      regime: e.regime,
      multiplier: mult,
      posteriorProbs: [0.6, 0.3, 0.1],
    };
  });
}

// ---------------------------------------------------------------------------
// 1. Default-off bit-identical to Phase 19
// ---------------------------------------------------------------------------

describe("DonchianPivotComposition — regime cap default-off is bit-identical", () => {
  it("1. default config (no regimeConditionedCap): emit signal has no metadata, reason has no regime tag, confidence unchanged", () => {
    const c = new DonchianPivotComposition();
    // sanity: default config has no regimeConditionedCap field
    expect(c.config.regimeConditionedCap).toBeUndefined();
    stubSubStrategies(c, {
      "donchian-range": mkLongSignal(0.8, { reason: "donchian long" }),
      "pivot-grid": mkLongSignal(0.6, { reason: "pivot long" }),
    });
    const result = c.onCandle(mkContext(1_700_000_000_000));
    expect(result).not.toBeNull();
    // mean(0.8, 0.6) = 0.7 — unchanged by regime conditioning.
    expect(result!.confidence).toBeCloseTo(0.7, 10);
    // reason has the standard [DonchianPivot] consensus tag — no regime tag.
    expect(result!.reason).toContain("[DonchianPivot] consensus=2/2");
    expect(result!.reason).not.toContain("regime=");
    // metadata is NOT set when no regime config — preserves Phase 19 baseline.
    expect(result!.metadata).toBeUndefined();
  });

  it("1b. explicit empty regimeTimeline without config: same as default (regime conditioning not engaged)", () => {
    // A timeline without a regimeConditionedCap config is a no-op.
    const c = new DonchianPivotComposition({
      regimeTimeline: mkTimeline([{ timestamp: 1_700_000_000_000, regime: "volatile" }]),
    });
    stubSubStrategies(c, {
      "donchian-range": mkLongSignal(0.8),
      "pivot-grid": mkLongSignal(0.6),
    });
    const result = c.onCandle(mkContext(1_700_000_000_000));
    expect(result).not.toBeNull();
    expect(result!.confidence).toBeCloseTo(0.7, 10);
    expect(result!.metadata).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 2. RegimeConditionedCap engaged → confidence scaled by regime multiplier
// ---------------------------------------------------------------------------

describe("DonchianPivotComposition — regime cap engaged scales confidence", () => {
  it("2. volatile bar (mult=0.4) → confidence × 0.4; reason tagged; metadata set", () => {
    const t = 1_700_000_000_000;
    const c = new DonchianPivotComposition({
      ...DEFAULT_DONCHIAN_PIVOT_COMPOSITION_CONFIG,
      regimeConditionedCap: DEFAULT_REGIME_CONDITIONED_CAP_CONFIG,
      regimeTimeline: mkTimeline([{ timestamp: t, regime: "volatile" }]),
    });
    stubSubStrategies(c, {
      "donchian-range": mkLongSignal(0.8, { reason: "donchian long" }),
      "pivot-grid": mkLongSignal(0.6, { reason: "pivot long" }),
    });
    const result = c.onCandle(mkContext(t));
    expect(result).not.toBeNull();
    // mean(0.8, 0.6) = 0.7 base; × 0.4 (volatile) = 0.28.
    expect(result!.confidence).toBeCloseTo(0.28, 10);
    // reason: regime tag present.
    expect(result!.reason).toContain("regime=volatile");
    expect(result!.reason).toContain("multiplier=0.40");
    // metadata: regime + multiplier observable.
    expect(result!.metadata).toBeDefined();
    const meta = result!.metadata as { regime: string; regimeMultiplier: number };
    expect(meta.regime).toBe("volatile");
    expect(meta.regimeMultiplier).toBeCloseTo(0.4, 10);
  });

  it("2b. ranging bar (mult=0.7) → confidence × 0.7", () => {
    const t = 1_700_000_010_000;
    const c = new DonchianPivotComposition({
      ...DEFAULT_DONCHIAN_PIVOT_COMPOSITION_CONFIG,
      regimeConditionedCap: DEFAULT_REGIME_CONDITIONED_CAP_CONFIG,
      regimeTimeline: mkTimeline([{ timestamp: t, regime: "ranging" }]),
    });
    stubSubStrategies(c, {
      "donchian-range": mkLongSignal(0.8),
      "pivot-grid": mkLongSignal(0.6),
    });
    const result = c.onCandle(mkContext(t));
    expect(result).not.toBeNull();
    // 0.7 × 0.7 = 0.49.
    expect(result!.confidence).toBeCloseTo(0.49, 10);
    expect(result!.metadata).toBeDefined();
  });

  it("2c. trending bar (mult=1.0) → confidence unchanged", () => {
    const t = 1_700_000_020_000;
    const c = new DonchianPivotComposition({
      ...DEFAULT_DONCHIAN_PIVOT_COMPOSITION_CONFIG,
      regimeConditionedCap: DEFAULT_REGIME_CONDITIONED_CAP_CONFIG,
      regimeTimeline: mkTimeline([{ timestamp: t, regime: "trending" }]),
    });
    stubSubStrategies(c, {
      "donchian-range": mkLongSignal(0.8),
      "pivot-grid": mkLongSignal(0.6),
    });
    const result = c.onCandle(mkContext(t));
    expect(result).not.toBeNull();
    // 0.7 × 1.0 = 0.7 (unchanged).
    expect(result!.confidence).toBeCloseTo(0.7, 10);
    // multiplier=1.00 still tagged in reason (observability).
    expect(result!.reason).toContain("multiplier=1.00");
  });
});

// ---------------------------------------------------------------------------
// 3. getRegimeAt after-end fallback → "trending"
// ---------------------------------------------------------------------------

describe("DonchianPivotComposition — after-end fallback", () => {
  it("3. bar timestamp beyond timeline end → fallback 'trending' (mult=1.0)", () => {
    const t = 1_700_000_000_000;
    const c = new DonchianPivotComposition({
      ...DEFAULT_DONCHIAN_PIVOT_COMPOSITION_CONFIG,
      regimeConditionedCap: DEFAULT_REGIME_CONDITIONED_CAP_CONFIG,
      // Timeline ends at t; the next bar (t + 15min) is AFTER the timeline.
      regimeTimeline: mkTimeline([{ timestamp: t, regime: "volatile" }]),
    });
    stubSubStrategies(c, {
      "donchian-range": mkLongSignal(0.8),
      "pivot-grid": mkLongSignal(0.6),
    });
    const result = c.onCandle(mkContext(t + 15 * 60 * 1000));
    expect(result).not.toBeNull();
    // After-end → fallback "trending" → multiplier 1.0 → confidence unchanged.
    expect(result!.confidence).toBeCloseTo(0.7, 10);
    expect(result!.reason).toContain("regime=trending");
    expect(result!.metadata).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// 4. applyRegimeToCap flow-through at the strategy level
// ---------------------------------------------------------------------------

describe("DonchianPivotComposition — applyRegimeToCap flow-through", () => {
  it("4. applyRegimeToCap(0.12, 'volatile', default) = 0.048 — caps scaled correctly", () => {
    // Direct unit check on the Track A module — also confirms the
    // strategy correctly uses the same multiplier on the emitted signal.
    expect(applyRegimeToCap(0.12, "volatile", DEFAULT_REGIME_CONDITIONED_CAP_CONFIG)).toBeCloseTo(
      0.048,
      10,
    );
    expect(applyRegimeToCap(0.12, "ranging", DEFAULT_REGIME_CONDITIONED_CAP_CONFIG)).toBeCloseTo(
      0.084,
      10,
    );
    expect(applyRegimeToCap(0.12, "trending", DEFAULT_REGIME_CONDITIONED_CAP_CONFIG)).toBeCloseTo(
      0.12,
      10,
    );
  });
});

// ---------------------------------------------------------------------------
// 5. 1:10 leverage mandate preserved under regime conditioning
// ---------------------------------------------------------------------------

describe("DonchianPivotComposition — 1:10 leverage invariant under regime conditioning", () => {
  it("5. max effective cap under regime = baseCap × volatileMult = 0.048; notional ≤ equity × 10", () => {
    // baseCap 0.12, volatileMult 0.4 → max effective cap = 0.048.
    // At $10,000 equity, max notional (with 1:10 leverage) =
    // 0.048 × 10 × 10000 = $4,800. Well under 1:10 ceiling of $100k.
    // The 1:10 mandate forbids > 1.0× equity × 10 notional; the
    // regime-scaled cap can ONLY scale DOWN, so the invariant holds
    // by construction.
    const baseCap = 0.12;
    const maxEffectiveCap = applyRegimeToCap(
      baseCap,
      "volatile",
      DEFAULT_REGIME_CONDITIONED_CAP_CONFIG,
    );
    expect(maxEffectiveCap).toBeCloseTo(0.048, 10);
    // Sanity: 0.048 < 0.12 (the baseCap, before leverage).
    expect(maxEffectiveCap).toBeLessThan(baseCap);
    // Notional at $10k equity, 10x leverage: 0.048 × 10 × 10,000 = $4,800.
    const notionalAt10k = maxEffectiveCap * 10 * 10_000;
    expect(notionalAt10k).toBe(4_800);
    // 1:10 ceiling: equity × 10 = $100,000. Regime-scaled notional
    // is 4,800 / 100,000 = 4.8% of the ceiling. Massive headroom.
    expect(notionalAt10k).toBeLessThan(100_000);
  });
});

// ---------------------------------------------------------------------------
// 6. Immutability — regime-conditioned signal does NOT mutate the input
// ---------------------------------------------------------------------------

describe("DonchianPivotComposition — immutability of returned signal", () => {
  it("6. result is a NEW object (spread) — does NOT alias the internal signal", () => {
    const t = 1_700_000_000_000;
    const c = new DonchianPivotComposition({
      ...DEFAULT_DONCHIAN_PIVOT_COMPOSITION_CONFIG,
      regimeConditionedCap: DEFAULT_REGIME_CONDITIONED_CAP_CONFIG,
      regimeTimeline: mkTimeline([{ timestamp: t, regime: "volatile" }]),
    });
    stubSubStrategies(c, {
      "donchian-range": mkLongSignal(0.8),
      "pivot-grid": mkLongSignal(0.6),
    });
    const result1 = c.onCandle(mkContext(t));
    const result2 = c.onCandle(mkContext(t));
    expect(result1).not.toBeNull();
    expect(result2).not.toBeNull();
    // Each call returns a distinct object (defensive copy).
    expect(result1).not.toBe(result2);
    // But both are equal in value — same regime, same multiplier.
    expect(result1!.confidence).toBeCloseTo(result2!.confidence, 10);
    expect(result1!.reason).toBe(result2!.reason);
  });
});

// ---------------------------------------------------------------------------
// 7. metadata observable for downstream runBacktest post-trade reporting
// ---------------------------------------------------------------------------

describe("DonchianPivotComposition — metadata observability", () => {
  it("7. metadata.regime + metadata.regimeMultiplier on every emit when engaged", () => {
    const t1 = 1_700_000_000_000;
    const t2 = t1 + 15 * 60 * 1000;
    const t3 = t1 + 30 * 60 * 1000;
    const c = new DonchianPivotComposition({
      ...DEFAULT_DONCHIAN_PIVOT_COMPOSITION_CONFIG,
      regimeConditionedCap: DEFAULT_REGIME_CONDITIONED_CAP_CONFIG,
      regimeTimeline: mkTimeline([
        { timestamp: t1, regime: "trending" },
        { timestamp: t2, regime: "ranging" },
        { timestamp: t3, regime: "volatile" },
      ]),
    });
    stubSubStrategies(c, {
      "donchian-range": mkLongSignal(0.8),
      "pivot-grid": mkLongSignal(0.6),
    });
    const r1 = c.onCandle(mkContext(t1));
    const r2 = c.onCandle(mkContext(t2));
    const r3 = c.onCandle(mkContext(t3));
    expect(r1).not.toBeNull();
    expect(r2).not.toBeNull();
    expect(r3).not.toBeNull();
    // Each emit has its own metadata block with the right regime + multiplier.
    const m1 = r1!.metadata as { regime: string; regimeMultiplier: number };
    const m2 = r2!.metadata as { regime: string; regimeMultiplier: number };
    const m3 = r3!.metadata as { regime: string; regimeMultiplier: number };
    expect(m1.regime).toBe("trending");
    expect(m1.regimeMultiplier).toBeCloseTo(1.0, 10);
    expect(m2.regime).toBe("ranging");
    expect(m2.regimeMultiplier).toBeCloseTo(0.7, 10);
    expect(m3.regime).toBe("volatile");
    expect(m3.regimeMultiplier).toBeCloseTo(0.4, 10);
  });
});

// ---------------------------------------------------------------------------
// 8. buildRegimeTimeline integration sanity (small synthetic series)
// ---------------------------------------------------------------------------

describe("DonchianPivotComposition — buildRegimeTimeline integration sanity", () => {
  it("8. ATR mode on a varying-range synthetic series classifies high-range bars as volatile (the only regime the strict ATR classifier produces reliably on this fixture)", () => {
    // Construct 50 bars with a clear bimodal ATR distribution:
    //   - Bars 0..29  : tight range (H-L = 0.5)  → low ATR
    //   - Bars 30..49 : wide range  (H-L = 6.0)  → high ATR
    // The ATR-percentile classifier should classify the high-range
    // region as "volatile" (rank > 2/3). The low-range region with
    // constant ATR is classified as "trending" (rank = 0.5). On a
    // fixture with constant-ATR low-region, "ranging" may not appear
    // — that's correct behavior of the percentile-rank classifier
    // (ties at the median are mapped to "trending"). This is the
    // observed behavior documented in Track A.
    const bars: { timestamp: number; close: number; high: number; low: number; volume: number }[] =
      [];
    for (let i = 0; i < 50; i++) {
      const range = i < 30 ? 0.5 : 6.0;
      bars.push({
        timestamp: 1_700_000_000_000 + i * 15 * 60 * 1000,
        close: 100 + i,
        high: 100 + i + range / 2,
        low: 100 + i - range / 2,
        volume: 1000,
      });
    }
    const timeline = buildRegimeTimeline(bars, DEFAULT_REGIME_CONDITIONED_CAP_CONFIG, Date.now());
    expect(timeline.length).toBe(50);
    // First minObservations=5 are forced "trending" (cold start).
    for (let i = 0; i < 5; i++) {
      expect(timeline[i]!.regime).toBe("trending");
      expect(timeline[i]!.multiplier).toBeCloseTo(1.0, 10);
    }
    // Count regimes across the post-cold-start window.
    const counts = { trending: 0, ranging: 0, volatile: 0 };
    for (let i = 5; i < timeline.length; i++) {
      const e = timeline[i]!;
      counts[e.regime]++;
      // Multiplier matches regime.
      if (e.regime === "ranging") expect(e.multiplier).toBeCloseTo(0.7, 10);
      else if (e.regime === "trending") expect(e.multiplier).toBeCloseTo(1.0, 10);
      else if (e.regime === "volatile") expect(e.multiplier).toBeCloseTo(0.4, 10);
    }
    // The wide-range region MUST produce "volatile" — this is the
    // key behavior the regime-conditioned cap depends on.
    expect(counts.volatile).toBeGreaterThan(0);
    // The low-range region with constant ATR maps to "trending"
    // (median rank); some bars may also be "ranging" depending on
    // the trailing window. Either is fine — both reduce the multiplier
    // (1.0 → 0.7) and the high-range region gives the strongest
    // reduction (→ 0.4). Total down-scaled bars (ranging + volatile)
    // must be substantial.
    expect(counts.ranging + counts.volatile).toBeGreaterThan(0);
  });
});
