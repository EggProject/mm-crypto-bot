// packages/core/src/strategy/composite.test.ts — unit tesztek

import { describe, expect, it } from "bun:test";

import { CompositeStrategy } from "./composite.js";
import { DonchianMtfStrategy } from "./donchian-mtf.js";
import { FundingCarryLeverageStrategy } from "./funding-carry-leverage.js";
import type { Strategy, StrategyContext, StrategySignal } from "../types.js";

const baseCandle = (close: number) => ({
  timestamp: 1_700_000_000_000,
  open: close,
  high: close * 1.01,
  low: close * 0.99,
  close,
  volume: 1000,
});

const makeCtx = (overrides: Partial<StrategyContext> = {}): StrategyContext => ({
  symbol: "BTC/USDT" as never,
  timeframe: "1h",
  candleIndex: 300,
  candle: baseCandle(100),
  mtfState: {
    htf: {},
    mtf: {},
    ltf: {},
  },
  pricePrecision: 2,
  ...overrides,
});

/** Mock Strategy that always returns a fixed signal or null. */
class MockStrategy implements Strategy {
  readonly name: string;
  readonly timeframes = ["1d", "4h", "1h"] as const;
  readonly warmupReturn: number;
  private readonly nextSignal: StrategySignal | null;
  constructor(name: string, signal: StrategySignal | null, warmupReturn = 100) {
    this.name = name;
    this.nextSignal = signal;
    this.warmupReturn = warmupReturn;
  }
  warmup(): number {
    return this.warmupReturn;
  }
  onCandle(_ctx: StrategyContext): StrategySignal | null {
    return this.nextSignal;
  }
}

describe("CompositeStrategy", () => {
  it("warmup is the max of both components' warmup", () => {
    const a = new MockStrategy("A", null, 100);
    const b = new MockStrategy("B", null, 250);
    const composite = new CompositeStrategy({ component1: a, component2: b, useTrendFilter: true, agreementConfidenceBoost: 0.05 });
    expect(composite.warmup()).toBe(250);
  });

  it("both components null → composite null", () => {
    const a = new MockStrategy("A", null);
    const b = new MockStrategy("B", null);
    const composite = new CompositeStrategy({ component1: a, component2: b, useTrendFilter: true, agreementConfidenceBoost: 0.05 });
    const ctx = makeCtx();
    expect(composite.onCandle(ctx)).toBeNull();
  });

  it("trend-filter ON: trend null blocks MR signal (no MR-only trades)", () => {
    const a = new MockStrategy("trend", null); // no trend signal
    const b = new MockStrategy("mr", { side: "buy", confidence: 1, reason: "MR long", stopLoss: 95, takeProfit: 110 });
    const composite = new CompositeStrategy({ component1: a, component2: b, useTrendFilter: true, agreementConfidenceBoost: 0.05 });
    const ctx = makeCtx();
    expect(composite.onCandle(ctx)).toBeNull();
  });

  it("trend-filter ON: trend LONG, MR null → composite LONG (trend alone)", () => {
    const a = new MockStrategy("trend", { side: "buy", confidence: 0.9, reason: "trend up", stopLoss: 95, takeProfit: 110 });
    const b = new MockStrategy("mr", null);
    const composite = new CompositeStrategy({ component1: a, component2: b, useTrendFilter: true, agreementConfidenceBoost: 0.05 });
    const ctx = makeCtx();
    const signal = composite.onCandle(ctx);
    expect(signal).not.toBeNull();
    expect(signal?.side).toBe("buy");
  });

  it("trend-filter ON: trend LONG, MR LONG → composite LONG (agreement, MR trigger)", () => {
    const a = new MockStrategy("trend", { side: "buy", confidence: 0.9, reason: "trend up", stopLoss: 95, takeProfit: 110 });
    const b = new MockStrategy("mr", { side: "buy", confidence: 0.85, reason: "BB long", stopLoss: 96, takeProfit: 109 });
    const composite = new CompositeStrategy({ component1: a, component2: b, useTrendFilter: true, agreementConfidenceBoost: 0.05 });
    const ctx = makeCtx();
    const signal = composite.onCandle(ctx);
    expect(signal).not.toBeNull();
    expect(signal?.side).toBe("buy");
    // MR trigger dominates (more specific), confidence boosted
    expect(signal?.reason).toContain("Composite AGREEMENT");
    expect(signal?.confidence).toBeCloseTo(0.90, 2);
    expect(signal?.stopLoss).toBe(96);
    expect(signal?.takeProfit).toBe(109);
  });

  it("trend-filter ON: trend LONG, MR SHORT → TREND WINS, MR filtered out", () => {
    const a = new MockStrategy("trend", { side: "buy", confidence: 0.9, reason: "trend up", stopLoss: 95, takeProfit: 110 });
    const b = new MockStrategy("mr", { side: "sell", confidence: 0.85, reason: "BB short", stopLoss: 105, takeProfit: 90 });
    const composite = new CompositeStrategy({ component1: a, component2: b, useTrendFilter: true, agreementConfidenceBoost: 0.05 });
    const ctx = makeCtx();
    const signal = composite.onCandle(ctx);
    expect(signal).not.toBeNull();
    expect(signal?.side).toBe("buy");
    expect(signal?.reason).toContain("Composite TREND FILTER");
    // Trend signal wins (its stopLoss/TP are kept)
    expect(signal?.stopLoss).toBe(95);
    expect(signal?.takeProfit).toBe(110);
  });

  it("trend-filter ON: trend SHORT, MR LONG → TREND WINS (short)", () => {
    const a = new MockStrategy("trend", { side: "sell", confidence: 0.9, reason: "trend down", stopLoss: 105, takeProfit: 90 });
    const b = new MockStrategy("mr", { side: "buy", confidence: 0.85, reason: "BB long", stopLoss: 96, takeProfit: 109 });
    const composite = new CompositeStrategy({ component1: a, component2: b, useTrendFilter: true, agreementConfidenceBoost: 0.05 });
    const ctx = makeCtx();
    const signal = composite.onCandle(ctx);
    expect(signal?.side).toBe("sell");
    expect(signal?.reason).toContain("TREND FILTER");
  });

  it("trend-filter OFF (OR voting): component1 alone wins", () => {
    const a = new MockStrategy("A", { side: "buy", confidence: 0.9, reason: "A signal", stopLoss: 95, takeProfit: 110 });
    const b = new MockStrategy("B", null);
    const composite = new CompositeStrategy({ component1: a, component2: b, useTrendFilter: false, agreementConfidenceBoost: 0.05 });
    const ctx = makeCtx();
    const signal = composite.onCandle(ctx);
    expect(signal?.side).toBe("buy");
    expect(signal?.reason).toBe("A signal"); // passthrough
  });

  it("trend-filter OFF: component2 alone wins when component1 null", () => {
    const a = new MockStrategy("A", null);
    const b = new MockStrategy("B", { side: "sell", confidence: 0.85, reason: "B signal", stopLoss: 105, takeProfit: 90 });
    const composite = new CompositeStrategy({ component1: a, component2: b, useTrendFilter: false, agreementConfidenceBoost: 0.05 });
    const ctx = makeCtx();
    const signal = composite.onCandle(ctx);
    expect(signal?.side).toBe("sell");
    expect(signal?.reason).toBe("B signal"); // passthrough
  });

  it("agreement confidence boost caps at 1.0", () => {
    const a = new MockStrategy("trend", { side: "buy", confidence: 1.0, reason: "t", stopLoss: 95, takeProfit: 110 });
    const b = new MockStrategy("mr", { side: "buy", confidence: 1.0, reason: "m", stopLoss: 96, takeProfit: 109 });
    const composite = new CompositeStrategy({ component1: a, component2: b, useTrendFilter: true, agreementConfidenceBoost: 0.5 });
    const ctx = makeCtx();
    const signal = composite.onCandle(ctx);
    // 1.0 + 0.5 = 1.5, capped at 1.0
    expect(signal?.confidence).toBeLessThanOrEqual(1.0);
  });

  it("works with real DonchianMtfStrategy + FundingCarryLeverageStrategy (smoke test)", () => {
    // Phase 27 cleanup: replaced AlwaysInTrendStrategy (deleted) + MeanReversionBbStrategy (deleted)
    // with surviving strategies DonchianMtf + FundingCarryLeverage.
    const trend = new DonchianMtfStrategy();
    const carry = new FundingCarryLeverageStrategy();
    const composite = new CompositeStrategy({ component1: trend, component2: carry, useTrendFilter: true, agreementConfidenceBoost: 0.05 });
    const ctx = makeCtx({
      candleIndex: 300,
      candle: baseCandle(95),
      mtfState: {
        htf: { ema50: 105, ema200: 100 },
        mtf: { bbLower: 96, bbUpper: 110, bbMiddle: 103, adx: 20 },
        ltf: { atr: 2.0 },
      },
    });
    const signal = composite.onCandle(ctx);
    // CompositeStrategy with non-aligned components may return null; we only assert non-crash.
    expect(signal === null || typeof signal === "object").toBe(true);
  });
});
