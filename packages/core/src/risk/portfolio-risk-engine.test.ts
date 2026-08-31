import { describe, expect, test } from "bun:test";

import { DEFAULT_AGGREGATE_EFFECTIVE_EXPOSURE_LIMIT } from "./leverage-invariant.js";
import {
  DEFAULT_PORTFOLIO_RISK_ENGINE_CONFIG,
  PortfolioRiskEngine,
  type SizingSignal,
} from "./portfolio-risk-engine.js";

const DAY_MS = 86_400_000;
const BASE_CAPITAL_USD = 10_000;

function makeSizing(
  source: string,
  symbol: string,
  effectiveNotionalUsd: number,
  timestamp: number,
): SizingSignal {
  return { kind: "sizing", source, symbol, effectiveNotionalUsd, leverage: 10, timestamp };
}

function requireValue<Value>(value: Value | undefined, subject: string): Value {
  if (value === undefined) throw new Error(`Expected ${subject} to be defined.`);
  return value;
}

describe("PortfolioRiskEngine — constructor + config validation", () => {
  test("default config → constructs OK", () => {
    expect(() => new PortfolioRiskEngine()).not.toThrow();
  });

  test("invalid confidence (0) → throws", () => {
    expect(() => new PortfolioRiskEngine({ ...DEFAULT_PORTFOLIO_RISK_ENGINE_CONFIG, confidence: 0 })).toThrow(
      /confidence/,
    );
  });

  test("invalid confidence (1) → throws", () => {
    expect(() => new PortfolioRiskEngine({ ...DEFAULT_PORTFOLIO_RISK_ENGINE_CONFIG, confidence: 1 })).toThrow(
      /confidence/,
    );
  });

  test("invalid correlationWindowDays (0) → throws", () => {
    expect(
      () => new PortfolioRiskEngine({ ...DEFAULT_PORTFOLIO_RISK_ENGINE_CONFIG, correlationWindowDays: 0 }),
    ).toThrow(/correlationWindowDays/);
  });

  test("invalid concentrationThresholdPct (1.5) → throws", () => {
    expect(
      () =>
        new PortfolioRiskEngine({ ...DEFAULT_PORTFOLIO_RISK_ENGINE_CONFIG, concentrationThresholdPct: 1.5 }),
    ).toThrow(/concentrationThresholdPct/);
  });

  test("default config — leverage cap is 10 (1:10 mandate)", () => {
    const engine = new PortfolioRiskEngine();
    expect(engine.config.leverageInvariant.maxAggregateEffectiveLeverage).toBe(10);
    expect(engine.config.leverageInvariant).toBe(DEFAULT_AGGREGATE_EFFECTIVE_EXPOSURE_LIMIT);
  });
});

describe("PortfolioRiskEngine — signal ingestion", () => {
  test("sizing signal → updates positions table", () => {
    const engine = new PortfolioRiskEngine();
    engine.submitSignal(makeSizing("donchian", "BTC/USDT", 50_000, DAY_MS));
    const position = requireValue(engine.getPositions().at(0), "sizing position");
    expect(engine.getPositions()).toHaveLength(1);
    expect(position.effectiveNotionalUsd).toBe(50_000);
  });

  test("direction signal → updates positions table", () => {
    const engine = new PortfolioRiskEngine();
    engine.submitSignal({
      kind: "direction",
      source: "mtf",
      symbol: "ETH/USDT",
      side: "long",
      confidence: 0.5,
      effectiveNotionalUsd: 30_000,
      timestamp: DAY_MS,
    });
    expect(engine.getPositions()).toHaveLength(1);
  });

  test("same source+symbol → overwrites previous position", () => {
    const engine = new PortfolioRiskEngine();
    engine.submitSignal(makeSizing("donchian", "BTC/USDT", 50_000, DAY_MS));
    engine.submitSignal(makeSizing("donchian", "BTC/USDT", 60_000, DAY_MS * 2));
    const position = requireValue(engine.getPositions().at(0), "updated position");
    expect(engine.getPositions()).toHaveLength(1);
    expect(position.effectiveNotionalUsd).toBe(60_000);
  });

  test("risk signal → does NOT mutate position table", () => {
    const engine = new PortfolioRiskEngine();
    engine.submitSignal({ kind: "risk", source: "external", reason: "test", timestamp: DAY_MS });
    expect(engine.getPositions()).toHaveLength(0);
  });
});

describe("PortfolioRiskEngine — leverage invariant guard (1:10 HARD GUARDRAIL)", () => {
  test("single signal at 10× → no breach", () => {
    const engine = new PortfolioRiskEngine();
    expect(engine.submitSignal(makeSizing("donchian", "BTC/USDT", 100_000, DAY_MS))).toBeUndefined();
    expect(engine.leverageInvariantGuard(BASE_CAPITAL_USD)).toBeUndefined();
  });

  test("two signals summing to 11× → BREACH detected, RiskSignal emitted", () => {
    const engine = new PortfolioRiskEngine();
    engine.submitSignal(makeSizing("strategy-A", "BTC/USDT", 60_000, DAY_MS));
    engine.submitSignal(makeSizing("strategy-B", "ETH/USDT", 60_000, DAY_MS));
    const guardResult = engine.leverageInvariantGuard(BASE_CAPITAL_USD);
    expect(guardResult).toBeDefined();
    const guard = requireValue(guardResult, "aggregate breach signal");
    expect(guard.kind).toBe("risk");
    expect(guard.source).toBe("leverage-invariant-guard");
    expect(guard.breach).toBe(true);
    expect(guard.reason).toContain("aggregate effective-exposure limit breach");
    expect(engine.snapshot(BASE_CAPITAL_USD).numLeverageBreaches).toBeGreaterThan(0);
  });

  test("reducing signal at 9× → under cap, no breach", () => {
    const engine = new PortfolioRiskEngine();
    engine.submitSignal(makeSizing("strategy-A", "BTC/USDT", 50_000, DAY_MS));
    engine.submitSignal(makeSizing("strategy-B", "ETH/USDT", 40_000, DAY_MS));
    expect(engine.leverageInvariantGuard(BASE_CAPITAL_USD)).toBeUndefined();
  });

  test("empty bus → no breach (no positions)", () => {
    expect(new PortfolioRiskEngine().leverageInvariantGuard(BASE_CAPITAL_USD)).toBeUndefined();
  });

  test("submitSignal returns breach signal on 11× submission", () => {
    const engine = new PortfolioRiskEngine();
    engine.submitSignal(makeSizing("strategy-A", "BTC/USDT", 60_000, DAY_MS));
    const breachSignal = engine.submitSignal(makeSizing("strategy-B", "ETH/USDT", 60_000, DAY_MS));
    expect(breachSignal).toBeDefined();
    expect(requireValue(breachSignal, "submission breach signal").breach).toBe(true);
  });

  test("historical breach replay — past 11× signal stream fires guard", () => {
    const engine = new PortfolioRiskEngine();
    const events = [
      { timestamp: DAY_MS, source: "strategy-A", notionalUsd: 60_000 },
      { timestamp: DAY_MS * 2, source: "strategy-B", notionalUsd: 60_000 },
      { timestamp: DAY_MS * 3, source: "strategy-A", notionalUsd: 40_000 },
    ];
    for (const event of events) {
      engine.submitSignal(makeSizing(event.source, "BTC/USDT", event.notionalUsd, event.timestamp));
    }
    expect(engine.leverageInvariantGuard(BASE_CAPITAL_USD)).toBeUndefined();
    expect(engine.snapshot(BASE_CAPITAL_USD).numLeverageBreaches).toBeGreaterThan(0);
  });
});

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
    expect(new PortfolioRiskEngine().resolvePositionConflict("BTC/USDT")).toBe(0);
  });

  test("conflict with short + long → sign preserved from min-abs entry", () => {
    const engine = new PortfolioRiskEngine();
    engine.submitSignal(makeSizing("A", "BTC/USDT", 60_000, DAY_MS));
    engine.submitSignal(makeSizing("B", "BTC/USDT", -40_000, DAY_MS));
    const result = engine.resolvePositionConflict("BTC/USDT");
    expect(Math.abs(result)).toBe(40_000);
    expect(result).toBe(-40_000);
  });
});
