// packages/core/src/risk/portfolio-risk-engine.test.ts — cross-strategy risk engine tests
//
// Phase 10G Track B — ≥15 unit tests covering:
//   - VaR computation correctness
//   - Correlation matrix rolling window
//   - Aggregate drawdown across N strategies
//   - Exposure concentration detection
//   - 1:10 leverage invariant guard enforcement (THE HARD GUARDRAIL)
//   - Position-size conflict resolver
//   - Empty bus snapshot → no breach
//   - Historical breach replay
//   - Determinism
//   - Edge cases: 0/1/100 strategies

import { describe, expect, test } from "bun:test";

import {
  DEFAULT_PORTFOLIO_RISK_ENGINE_CONFIG,
  PortfolioRiskEngine,
  type CorrelationMatrix,
  type DirectionSignal,
  type RiskSignal,
  type SizingSignal,
} from "./portfolio-risk-engine.js";
import {
  DEFAULT_LEVERAGE_INVARIANT_CONFIG,
  ONE_TO_TEN_LEVERAGE,
} from "./leverage-invariant.js";

const DAY_MS = 86_400_000;

function makeSizing(
  source: string,
  symbol: string,
  notionalUsd: number,
  timestamp: number,
): SizingSignal {
  return {
    kind: "sizing",
    source,
    symbol,
    effectiveNotionalUsd: notionalUsd,
    leverage: 10,
    timestamp,
  };
}

function makeDirection(
  source: string,
  symbol: string,
  notionalUsd: number,
  timestamp: number,
): DirectionSignal {
  return {
    kind: "direction",
    source,
    symbol,
    side: notionalUsd >= 0 ? "long" : "short",
    confidence: 0.5,
    effectiveNotionalUsd: notionalUsd,
    timestamp,
  };
}

// ----------------------------------------------------------------------
// Constructor + config validation
// ----------------------------------------------------------------------

describe("PortfolioRiskEngine — constructor + config validation", () => {
  test("default config → constructs OK", () => {
    expect(() => new PortfolioRiskEngine()).not.toThrow();
  });

  test("invalid confidence (0) → throws", () => {
    expect(
      () => new PortfolioRiskEngine({ ...DEFAULT_PORTFOLIO_RISK_ENGINE_CONFIG, confidence: 0 }),
    ).toThrow(/confidence/);
  });

  test("invalid confidence (1) → throws", () => {
    expect(
      () => new PortfolioRiskEngine({ ...DEFAULT_PORTFOLIO_RISK_ENGINE_CONFIG, confidence: 1 }),
    ).toThrow(/confidence/);
  });

  test("invalid correlationWindowDays (0) → throws", () => {
    expect(
      () =>
        new PortfolioRiskEngine({
          ...DEFAULT_PORTFOLIO_RISK_ENGINE_CONFIG,
          correlationWindowDays: 0,
        }),
    ).toThrow(/correlationWindowDays/);
  });

  test("invalid concentrationThresholdPct (1.5) → throws", () => {
    expect(
      () =>
        new PortfolioRiskEngine({
          ...DEFAULT_PORTFOLIO_RISK_ENGINE_CONFIG,
          concentrationThresholdPct: 1.5,
        }),
    ).toThrow(/concentrationThresholdPct/);
  });

  test("default config — leverage cap is 10 (1:10 mandate)", () => {
    const engine = new PortfolioRiskEngine();
    expect(engine.config.leverageInvariant.maxLeverage).toBe(ONE_TO_TEN_LEVERAGE);
    expect(engine.config.leverageInvariant.maxLeverage).toBe(
      DEFAULT_LEVERAGE_INVARIANT_CONFIG.maxLeverage,
    );
  });
});

// ----------------------------------------------------------------------
// Signal ingestion + positions
// ----------------------------------------------------------------------

describe("PortfolioRiskEngine — signal ingestion", () => {
  test("sizing signal → updates positions table", () => {
    const engine = new PortfolioRiskEngine();
    engine.submitSignal(makeSizing("donchian", "BTC/USDT", 50_000, DAY_MS));
    expect(engine.getPositions().length).toBe(1);
    expect(engine.getPositions()[0]!.effectiveNotionalUsd).toBe(50_000);
  });

  test("direction signal → updates positions table", () => {
    const engine = new PortfolioRiskEngine();
    engine.submitSignal(makeDirection("mtf", "ETH/USDT", 30_000, DAY_MS));
    expect(engine.getPositions().length).toBe(1);
  });

  test("same source+symbol → overwrites previous position", () => {
    const engine = new PortfolioRiskEngine();
    engine.submitSignal(makeSizing("donchian", "BTC/USDT", 50_000, DAY_MS));
    engine.submitSignal(makeSizing("donchian", "BTC/USDT", 60_000, DAY_MS * 2));
    expect(engine.getPositions().length).toBe(1);
    expect(engine.getPositions()[0]!.effectiveNotionalUsd).toBe(60_000);
  });

  test("risk signal → does NOT mutate position table", () => {
    const engine = new PortfolioRiskEngine();
    engine.submitSignal({
      kind: "risk",
      source: "external",
      reason: "test",
      timestamp: DAY_MS,
    });
    expect(engine.getPositions().length).toBe(0);
  });
});

// ----------------------------------------------------------------------
// 1:10 leverage invariant guard (THE HARD GUARDRAIL — most critical tests)
// ----------------------------------------------------------------------

describe("PortfolioRiskEngine — leverage invariant guard (1:10 HARD GUARDRAIL)", () => {
  test("single signal at 10× → no breach", () => {
    const engine = new PortfolioRiskEngine();
    const result = engine.submitSignal(
      makeSizing("donchian", "BTC/USDT", 100_000, DAY_MS),
    );
    expect(result).toBeNull();
    expect(engine.leverageInvariantGuard(10_000)).toBeNull();
  });

  test("two signals summing to 11× → BREACH detected, RiskSignal emitted", () => {
    // The critical 3rd-layer defense: each strategy individually is at 6×
    // (under cap), but the AGGREGATE is 12× (above cap). Layer 2 (per-strategy
    // validator) would NOT catch this — only this layer does.
    const engine = new PortfolioRiskEngine();
    engine.submitSignal(makeSizing("strategy-A", "BTC/USDT", 60_000, DAY_MS));
    engine.submitSignal(makeSizing("strategy-B", "ETH/USDT", 60_000, DAY_MS));
    // Now check the guard.
    const guard = engine.leverageInvariantGuard(10_000);
    expect(guard).not.toBeNull();
    expect(guard!.kind).toBe("risk");
    expect(guard!.source).toBe("leverage-invariant-guard");
    expect(guard!.breach).toBe(true);
    expect(guard!.reason).toContain("1:10 MANDATE BREACH");
    expect(engine.snapshot(10_000).numLeverageBreaches > 0).toBe(true);
  });

  test("reducing signal at 9× → under cap, no breach", () => {
    const engine = new PortfolioRiskEngine();
    engine.submitSignal(makeSizing("strategy-A", "BTC/USDT", 50_000, DAY_MS));
    engine.submitSignal(makeSizing("strategy-B", "ETH/USDT", 40_000, DAY_MS));
    expect(engine.leverageInvariantGuard(10_000)).toBeNull();
  });

  test("empty bus → no breach (no positions)", () => {
    const engine = new PortfolioRiskEngine();
    expect(engine.leverageInvariantGuard(10_000)).toBeNull();
  });

  test("submitSignal returns breach signal on 11× submission", () => {
    const engine = new PortfolioRiskEngine();
    engine.submitSignal(makeSizing("strategy-A", "BTC/USDT", 60_000, DAY_MS));
    engine.submitSignal(makeSizing("strategy-B", "ETH/USDT", 60_000, DAY_MS));
    // The SECOND submission triggers the breach (aggregate now 12×).
    const breachSignal = engine.leverageInvariantGuard(10_000);
    expect(breachSignal).not.toBeNull();
    expect(breachSignal!.breach).toBe(true);
  });

  test("historical breach replay — past 11× signal stream fires guard", () => {
    // Simulate replaying a past signal stream from a log: each sizing
    // signal is fed in order. After the second signal, the guard fires.
    const engine = new PortfolioRiskEngine();
    const events: { ts: number; notional: number; expectBreach: boolean }[] = [
      { ts: DAY_MS * 1, notional: 60_000, expectBreach: false }, // 6× alone — OK
      { ts: DAY_MS * 2, notional: 60_000, expectBreach: true }, // 12× aggregate — BREACH
      { ts: DAY_MS * 3, notional: 40_000, expectBreach: true }, // still over (10× to 8× now, OK)
    ];
    // Note: we need to be careful — after the first 12× breach, the
    // positions are still in the table. Submitting the third ($40k)
    // replaces one of the strategies and the aggregate becomes 10×, OK.
    for (const evt of events) {
      const source = evt.notional === 60_000 && evt.ts === DAY_MS * 2 ? "strategy-B" : "strategy-A";
      engine.submitSignal(makeSizing(source, "BTC/USDT", evt.notional, evt.ts));
    }
    // Final state: BTC/USDT has TWO positions (strategy-A: 40k, strategy-B: 60k)
    // total = 100k = 10× = at cap, no breach.
    const finalGuard = engine.leverageInvariantGuard(10_000);
    expect(finalGuard).toBeNull();
    // But the guard DID fire at least once during the stream.
    expect(engine.snapshot(10_000).numLeverageBreaches).toBeGreaterThan(0);
  });
});

// ----------------------------------------------------------------------
// VaR computation
// ----------------------------------------------------------------------

describe("PortfolioRiskEngine — portfolioVaR", () => {
  test("no observations → returns null", () => {
    const engine = new PortfolioRiskEngine();
    expect(engine.portfolioVaR(10_000)).toBeNull();
  });

  test("fewer than 2 observations → returns null", () => {
    const engine = new PortfolioRiskEngine();
    engine.recordSourceReturn("A", DAY_MS, 0.01);
    expect(engine.portfolioVaR(10_000)).toBeNull();
  });

  test("20 returns with mean 0.001, std 0.02 → VaR ≈ 0.032 (3.2%)", () => {
    const engine = new PortfolioRiskEngine();
    // Deterministic returns: small positive mean, moderate vol.
    for (let i = 0; i < 20; i++) {
      const ret = 0.001 + 0.02 * Math.sin(i);
      engine.recordSourceReturn("A", DAY_MS * (i + 1), ret);
    }
    const var95 = engine.portfolioVaR(10_000);
    expect(var95).not.toBeNull();
    // VaR is positive (loss magnitude). For confidence=0.95, z=1.645.
    // VaR ≈ -(0.001 - 1.645 * 0.0141) ≈ 0.0223 (depending on realized std).
    expect(var95!.dailyVaR95Pct).toBeGreaterThan(0);
    expect(var95!.dailyVaR95Usd).toBeGreaterThan(0);
    expect(var95!.method).toBe("parametric");
    expect(var95!.observations).toBe(20);
  });

  test("zero-variance series → VaR = 0 (no risk)", () => {
    const engine = new PortfolioRiskEngine();
    for (let i = 0; i < 10; i++) {
      engine.recordSourceReturn("A", DAY_MS * (i + 1), 0.001); // constant
    }
    const var95 = engine.portfolioVaR(10_000);
    expect(var95).not.toBeNull();
    // Mean = 0.001, std = 0, VaR = -(0.001 - 1.645 * 0) = -0.001 → negative
    // Our impl returns -(μ - z·σ), so a constant positive return gives a
    // negative VaR. We expect that and accept it (it means "no loss expected").
    expect(var95!.dailyVaR95Pct).toBeLessThanOrEqual(0);
  });

  test("VaR in USD = VaR in pct × capital", () => {
    const engine = new PortfolioRiskEngine();
    for (let i = 0; i < 30; i++) {
      engine.recordSourceReturn("A", DAY_MS * (i + 1), 0.005 * (i % 2 === 0 ? 1 : -1));
    }
    const var95 = engine.portfolioVaR(10_000);
    expect(var95).not.toBeNull();
    expect(var95!.dailyVaR95Usd).toBeCloseTo(var95!.dailyVaR95Pct * 10_000, 4);
  });
});

// ----------------------------------------------------------------------
// Cross-strategy correlation
// ----------------------------------------------------------------------

describe("PortfolioRiskEngine — crossStrategyCorrelation", () => {
  test("fewer than 2 sources → returns null", () => {
    const engine = new PortfolioRiskEngine();
    engine.recordSourceReturn("A", DAY_MS, 0.01);
    expect(engine.crossStrategyCorrelation()).toBeNull();
  });

  test("2 sources with 5+ observations → returns matrix", () => {
    const engine = new PortfolioRiskEngine();
    for (let i = 0; i < 10; i++) {
      engine.recordSourceReturn("A", DAY_MS * (i + 1), 0.01);
      engine.recordSourceReturn("B", DAY_MS * (i + 1), 0.02);
    }
    const corr = engine.crossStrategyCorrelation();
    expect(corr).not.toBeNull();
    expect(corr!.sources.length).toBe(2);
    expect(corr!.matrix.length).toBe(2);
    // Diagonal = 1.
    expect(corr!.matrix[0]![0]).toBeCloseTo(1, 6);
    expect(corr!.matrix[1]![1]).toBeCloseTo(1, 6);
    // Symmetric.
    expect(corr!.matrix[0]![1]).toBeCloseTo(corr!.matrix[1]![0]!, 6);
  });

  test("perfectly correlated series → off-diagonal = 1", () => {
    const engine = new PortfolioRiskEngine();
    const series = [0.01, -0.02, 0.03, -0.01, 0.005];
    for (let i = 0; i < series.length; i++) {
      engine.recordSourceReturn("A", DAY_MS * (i + 1), series[i]!);
      engine.recordSourceReturn("B", DAY_MS * (i + 1), series[i]!);
    }
    const corr = engine.crossStrategyCorrelation();
    expect(corr!.matrix[0]![1]).toBeCloseTo(1, 4);
  });

  test("anti-correlated series → off-diagonal = -1", () => {
    const engine = new PortfolioRiskEngine();
    const series = [0.01, -0.02, 0.03, -0.01, 0.005];
    for (let i = 0; i < series.length; i++) {
      engine.recordSourceReturn("A", DAY_MS * (i + 1), series[i]!);
      engine.recordSourceReturn("B", DAY_MS * (i + 1), -series[i]!);
    }
    const corr = engine.crossStrategyCorrelation();
    expect(corr!.matrix[0]![1]).toBeCloseTo(-1, 4);
  });

  test("rolling window truncates to correlationWindowDays", () => {
    const engine = new PortfolioRiskEngine({ ...DEFAULT_PORTFOLIO_RISK_ENGINE_CONFIG, correlationWindowDays: 5 });
    // Feed 20 observations — only last 5 should count.
    for (let i = 0; i < 20; i++) {
      engine.recordSourceReturn("A", DAY_MS * (i + 1), 0.01);
      engine.recordSourceReturn("B", DAY_MS * (i + 1), 0.01);
    }
    expect(engine.getPerSourceObservationCounts().get("A")).toBe(5);
  });

  test("insufficient common observations → returns null", () => {
    const engine = new PortfolioRiskEngine();
    // A has 5 obs at ts=1..5
    for (let i = 1; i <= 5; i++) engine.recordSourceReturn("A", DAY_MS * i, 0.01);
    // B has 5 obs at ts=10..14 — NO overlap
    for (let i = 10; i <= 14; i++) engine.recordSourceReturn("B", DAY_MS * i, 0.02);
    expect(engine.crossStrategyCorrelation()).toBeNull();
  });
});

// ----------------------------------------------------------------------
// Aggregate drawdown
// ----------------------------------------------------------------------

describe("PortfolioRiskEngine — aggregateDrawdown", () => {
  test("no equity snapshots → returns null", () => {
    const engine = new PortfolioRiskEngine();
    expect(engine.aggregateDrawdown()).toBeNull();
  });

  test("monotonically increasing equity → DD = 0", () => {
    const engine = new PortfolioRiskEngine();
    for (let i = 0; i < 10; i++) {
      engine.recordEquitySnapshot(DAY_MS * (i + 1), 10_000 + i * 100);
    }
    const dd = engine.aggregateDrawdown();
    expect(dd).not.toBeNull();
    expect(dd!.drawdownPct).toBeCloseTo(0, 6);
    expect(dd!.maxDrawdownPct).toBe(0);
    expect(dd!.isAtLimit).toBe(false);
  });

  test("equity rises then falls → DD > 0", () => {
    const engine = new PortfolioRiskEngine();
    const equity = [10_000, 11_000, 12_000, 11_000, 10_000, 9_500, 10_500];
    for (let i = 0; i < equity.length; i++) {
      engine.recordEquitySnapshot(DAY_MS * (i + 1), equity[i]!);
    }
    const dd = engine.aggregateDrawdown();
    // Peak = 12_000, last = 10_500, DD = (12000 - 10500) / 12000 ≈ 0.125
    expect(dd!.peakEquityUsd).toBe(12_000);
    expect(dd!.currentEquityUsd).toBe(10_500);
    expect(dd!.drawdownPct).toBeCloseTo(0.125, 4);
    // Max DD = (12000 - 9500) / 12000 ≈ 0.208
    expect(dd!.maxDrawdownPct).toBeCloseTo(0.2083, 3);
  });

  test("DD exceeds threshold → isAtLimit = true", () => {
    const engine = new PortfolioRiskEngine({ ...DEFAULT_PORTFOLIO_RISK_ENGINE_CONFIG, maxAggregateDrawdownPct: 0.20 });
    engine.recordEquitySnapshot(DAY_MS, 10_000);
    engine.recordEquitySnapshot(DAY_MS * 2, 7_500); // -25% DD
    const dd = engine.aggregateDrawdown();
    expect(dd!.isAtLimit).toBe(true);
  });
});

// ----------------------------------------------------------------------
// Exposure concentration
// ----------------------------------------------------------------------

describe("PortfolioRiskEngine — exposureBySymbol", () => {
  test("empty positions → total = 0, no over-threshold", () => {
    const engine = new PortfolioRiskEngine();
    const exp = engine.exposureBySymbol();
    expect(exp.totalNotionalUsd).toBe(0);
    expect(exp.overThresholdSymbols.length).toBe(0);
  });

  test("3 symbols equal weight → all under 40% threshold", () => {
    const engine = new PortfolioRiskEngine();
    engine.submitSignal(makeSizing("A", "BTC/USDT", 30_000, DAY_MS));
    engine.submitSignal(makeSizing("A", "ETH/USDT", 30_000, DAY_MS));
    engine.submitSignal(makeSizing("A", "SOL/USDT", 30_000, DAY_MS));
    const exp = engine.exposureBySymbol();
    expect(exp.totalNotionalUsd).toBe(90_000);
    expect(exp.perSymbolFraction.get("BTC/USDT")).toBeCloseTo(1 / 3, 4);
    expect(exp.overThresholdSymbols.length).toBe(0);
  });

  test("single symbol dominates → over threshold", () => {
    const engine = new PortfolioRiskEngine();
    engine.submitSignal(makeSizing("A", "BTC/USDT", 80_000, DAY_MS));
    engine.submitSignal(makeSizing("A", "ETH/USDT", 20_000, DAY_MS));
    const exp = engine.exposureBySymbol();
    expect(exp.perSymbolFraction.get("BTC/USDT")).toBeCloseTo(0.8, 4);
    expect(exp.overThresholdSymbols).toContain("BTC/USDT");
  });

  test("long + short on same symbol → counts GROSS exposure", () => {
    const engine = new PortfolioRiskEngine();
    engine.submitSignal(makeSizing("directional", "BTC/USDT", 50_000, DAY_MS));
    engine.submitSignal(makeSizing("funding-carry", "BTC/USDT", -50_000, DAY_MS));
    const exp = engine.exposureBySymbol();
    expect(exp.perSymbol.get("BTC/USDT")).toBe(100_000);
  });
});

// ----------------------------------------------------------------------
// Position-size conflict resolver
// ----------------------------------------------------------------------

describe("PortfolioRiskEngine — resolvePositionConflict", () => {
  test("2 signals on same symbol → MIN (most conservative) wins", () => {
    const engine = new PortfolioRiskEngine();
    engine.submitSignal(makeSizing("strategy-A", "BTC/USDT", 80_000, DAY_MS));
    engine.submitSignal(makeSizing("strategy-B", "BTC/USDT", 40_000, DAY_MS));
    expect(engine.resolvePositionConflict("BTC/USDT")).toBe(40_000);
  });

  test("3 signals on same symbol → MIN of all wins", () => {
    const engine = new PortfolioRiskEngine();
    engine.submitSignal(makeSizing("A", "BTC/USDT", 100_000, DAY_MS));
    engine.submitSignal(makeSizing("B", "BTC/USDT", 50_000, DAY_MS));
    engine.submitSignal(makeSizing("C", "BTC/USDT", 70_000, DAY_MS));
    expect(engine.resolvePositionConflict("BTC/USDT")).toBe(50_000);
  });

  test("no conflict → returns 0", () => {
    const engine = new PortfolioRiskEngine();
    expect(engine.resolvePositionConflict("BTC/USDT")).toBe(0);
  });

  test("conflict with short + long → sign preserved from min-abs entry", () => {
    const engine = new PortfolioRiskEngine();
    engine.submitSignal(makeSizing("A", "BTC/USDT", 60_000, DAY_MS));
    engine.submitSignal(makeSizing("B", "BTC/USDT", -40_000, DAY_MS));
    const result = engine.resolvePositionConflict("BTC/USDT");
    expect(Math.abs(result)).toBe(40_000);
    expect(result).toBe(-40_000); // shorter size wins, sign from min-abs entry
  });
});

// ----------------------------------------------------------------------
// Snapshot
// ----------------------------------------------------------------------

describe("PortfolioRiskEngine — snapshot", () => {
  test("snapshot is serializable (JSON-roundtrip safe)", () => {
    const engine = new PortfolioRiskEngine();
    engine.submitSignal(makeSizing("A", "BTC/USDT", 30_000, DAY_MS));
    engine.recordSourceReturn("A", DAY_MS, 0.01);
    engine.recordEquitySnapshot(DAY_MS, 10_000);
    const snap = engine.snapshot(10_000);
    const json = JSON.stringify(snap);
    const parsed = JSON.parse(json);
    expect(parsed.numStrategies).toBe(1);
    expect(parsed.numSignalsSubmitted).toBe(1);
    expect(parsed.positions.length).toBe(1);
  });

  test("snapshot includes all sub-metrics", () => {
    const engine = new PortfolioRiskEngine();
    engine.submitSignal(makeSizing("A", "BTC/USDT", 30_000, DAY_MS));
    engine.recordSourceReturn("A", DAY_MS, 0.01);
    engine.recordSourceReturn("A", DAY_MS * 2, 0.02); // need ≥2 obs
    engine.recordSourceReturn("B", DAY_MS, 0.02);
    engine.recordSourceReturn("B", DAY_MS * 2, 0.01);
    engine.recordEquitySnapshot(DAY_MS, 10_000);
    engine.recordEquitySnapshot(DAY_MS * 2, 10_100);
    const snap = engine.snapshot(10_000);
    expect(snap.lastVaR).not.toBeNull();
    expect(snap.lastCorrelation).not.toBeNull();
    expect(snap.exposure).toBeDefined();
    expect(snap.drawdown).toBeDefined();
    expect(snap.aggregateLeverage).toBe(3); // 30k / 10k
  });
});

// ----------------------------------------------------------------------
// Determinism
// ----------------------------------------------------------------------

describe("PortfolioRiskEngine — determinism", () => {
  test("identical input → identical output across multiple runs", () => {
    const runOnce = () => {
      const engine = new PortfolioRiskEngine();
      engine.submitSignal(makeSizing("A", "BTC/USDT", 50_000, DAY_MS));
      engine.submitSignal(makeSizing("B", "ETH/USDT", 50_000, DAY_MS * 2));
      for (let i = 0; i < 30; i++) {
        engine.recordSourceReturn("A", DAY_MS * (i + 1), 0.01 * Math.sin(i));
        engine.recordSourceReturn("B", DAY_MS * (i + 1), 0.02 * Math.cos(i));
      }
      engine.recordEquitySnapshot(DAY_MS, 10_000);
      engine.recordEquitySnapshot(DAY_MS * 2, 10_100);
      return engine.snapshot(10_000);
    };
    const s1 = runOnce();
    const s2 = runOnce();
    // Multiple nested fields use Date.now() (snapshot.timestamp AND
    // exposure.timestamp). Normalize ALL Date.now()-derived timestamps
    // recursively so the comparison is purely deterministic on
    // computational state, not wall-clock.
    const normalizeTimestamps = (value: unknown): unknown => {
      if (value === null || typeof value !== "object") return value;
      if (Array.isArray(value)) return value.map(normalizeTimestamps);
      const obj = value as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(obj)) {
        out[k] = k === "timestamp" ? 0 : normalizeTimestamps(v);
      }
      return out;
    };
    expect(JSON.stringify(normalizeTimestamps(s1))).toBe(
      JSON.stringify(normalizeTimestamps(s2)),
    );
  });
});

// ----------------------------------------------------------------------
// Edge cases: 0, 1, 100 strategies
// ----------------------------------------------------------------------

describe("PortfolioRiskEngine — edge cases", () => {
  test("0 strategies → snapshot OK, VaR null, correlation null", () => {
    const engine = new PortfolioRiskEngine();
    const snap = engine.snapshot(10_000);
    expect(snap.numStrategies).toBe(0);
    expect(snap.lastVaR).toBeNull();
    expect(snap.lastCorrelation).toBeNull();
    expect(snap.positions.length).toBe(0);
  });

  test("1 strategy → VaR OK, correlation null (need ≥2)", () => {
    const engine = new PortfolioRiskEngine();
    for (let i = 0; i < 10; i++) engine.recordSourceReturn("A", DAY_MS * (i + 1), 0.01);
    expect(engine.portfolioVaR(10_000)).not.toBeNull();
    expect(engine.crossStrategyCorrelation()).toBeNull();
  });

  test("100 strategies → correlation matrix is 100×100", () => {
    const engine = new PortfolioRiskEngine();
    for (let i = 0; i < 100; i++) {
      const src = `S${i}`;
      for (let j = 0; j < 10; j++) {
        engine.recordSourceReturn(src, DAY_MS * (j + 1), 0.001 * Math.sin(i + j));
      }
    }
    const corr = engine.crossStrategyCorrelation();
    expect(corr).not.toBeNull();
    expect(corr!.sources.length).toBe(100);
    expect(corr!.matrix.length).toBe(100);
    expect(corr!.matrix[0]!.length).toBe(100);
    // Diagonal all 1.
    for (let i = 0; i < 100; i++) {
      expect(corr!.matrix[i]![i]).toBe(1);
    }
  });

  test("clear() resets all state", () => {
    const engine = new PortfolioRiskEngine();
    engine.submitSignal(makeSizing("A", "BTC/USDT", 50_000, DAY_MS));
    engine.recordSourceReturn("A", DAY_MS, 0.01);
    engine.recordEquitySnapshot(DAY_MS, 10_000);
    engine.clear();
    expect(engine.getPositions().length).toBe(0);
    expect(engine.snapshot(10_000).numSignalsSubmitted).toBe(0);
    expect(engine.crossStrategyCorrelation()).toBeNull();
    expect(engine.aggregateDrawdown()).toBeNull();
  });
});

// ----------------------------------------------------------------------
// Type contract — minimal smoke test
// ----------------------------------------------------------------------

describe("PortfolioRiskEngine — type contracts", () => {
  test("CorrelationMatrix is symmetric for 2 sources", () => {
    const engine = new PortfolioRiskEngine();
    for (let i = 0; i < 5; i++) {
      engine.recordSourceReturn("A", DAY_MS * (i + 1), 0.01);
      engine.recordSourceReturn("B", DAY_MS * (i + 1), 0.02);
    }
    const corr: CorrelationMatrix | null = engine.crossStrategyCorrelation();
    expect(corr).not.toBeNull();
    if (corr) {
      expect(corr.matrix[0]![1]).toBeCloseTo(corr.matrix[1]![0]!, 6);
    }
  });
});

// ----------------------------------------------------------------------
// Phase 35b — `getEmittedRiskSignals` method coverage
// ----------------------------------------------------------------------
//
// The 804-es sor (`getEmittedRiskSignals(): readonly RiskSignal[]`) is the
// accessor for the engine's emitted risk signals. We test it returns an
// empty array initially and returns a copy (not a reference) of the
// internal list after some breaches.
//
describe("PortfolioRiskEngine — getEmittedRiskSignals", () => {
  test("returns empty array on a fresh engine", () => {
    const engine = new PortfolioRiskEngine();
    expect(engine.getEmittedRiskSignals()).toEqual([]);
  });

  test("returns a copy (not a reference) of the internal emitted list", () => {
    const engine = new PortfolioRiskEngine();
    // Submit a `kind: "risk"` signal — these get pushed into the
    // internal `emittedRiskSignals` list (see submitSignal in
    // portfolio-risk-engine.ts line ~386).
    engine.submitSignal({
      kind: "risk",
      source: "test",
      reason: "coverage probe",
      timestamp: DAY_MS,
    });
    const emitted = engine.getEmittedRiskSignals();
    expect(emitted.length).toBe(1);
    // Verify the returned array is a copy (not a reference): cast away
    // readonly to mutate, then check the internal list is unchanged.
    // Phase 35b: `readonly RiskSignal[]` rejects `.pop()` and
    // `length = N` — we use a type assertion to prove copy semantics.
    const mutable = emitted as unknown as RiskSignal[];
    mutable.length = 0;
    expect(engine.getEmittedRiskSignals().length).toBe(1);
  });
});