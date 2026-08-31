// packages/core/src/strategy/composite.test.ts — unit tests

import { describe, expect, it } from "bun:test";

import { makeSymbol } from "@mm-crypto-bot/shared/types";

import { CompositeStrategy } from "./composite.js";
import type { Strategy, StrategyContext, StrategySignal } from "../types.js";

const baseCandle = (close: number) => ({
  timestamp: 1_700_000_000_000,
  open: close,
  high: close * 1.01,
  low: close * 0.99,
  close,
  volume: 1000,
});

const makeContext = (overrides: Partial<StrategyContext> = {}): StrategyContext => ({
  symbol: makeSymbol("BTC/USDT"),
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

/**
Strategy collaborator that always returns a fixed signal or undefined.
*/
class MockStrategy implements Strategy {
  private readonly nextSignal: StrategySignal | undefined;
  readonly name: string;
  readonly timeframes = ["1d", "4h", "1h"] as const;
  readonly warmupReturn: number;
  constructor(name: string, signal: StrategySignal | undefined, warmupReturn = 100) {
    this.name = name;
    this.nextSignal = signal;
    this.warmupReturn = warmupReturn;
  }
  warmup(): number {
    return this.warmupReturn;
  }
  onCandle(_context: StrategyContext): StrategySignal | undefined {
    return this.nextSignal;
  }
}

const NO_SIGNAL = undefined;

describe("CompositeStrategy", () => {
  it("warmup is the max of both components' warmup", () => {
    const a = new MockStrategy("A", undefined, 100);
    const b = new MockStrategy("B", undefined, 250);
    const composite = new CompositeStrategy({
      component1: a,
      component2: b,
      useTrendFilter: true,
      agreementConfidenceBoost: 0.05,
    });
    expect(composite.warmup()).toBe(250);
  });

  it("both components undefined → composite undefined", () => {
    const a = new MockStrategy("A", undefined);
    const b = new MockStrategy("B", undefined);
    const composite = new CompositeStrategy({
      component1: a,
      component2: b,
      useTrendFilter: true,
      agreementConfidenceBoost: 0.05,
    });
    const context = makeContext();
    expect(composite.onCandle(context)).toBeUndefined();
  });

  it("trend-filter ON: absent trend blocks MR signal (no MR-only trades)", () => {
    const a = new MockStrategy("trend", undefined); // no trend signal
    const b = new MockStrategy("mr", {
      side: "buy",
      confidence: 1,
      reason: "MR long",
      stopLoss: 95,
      takeProfit: 110,
    });
    const composite = new CompositeStrategy({
      component1: a,
      component2: b,
      useTrendFilter: true,
      agreementConfidenceBoost: 0.05,
    });
    const context = makeContext();
    expect(composite.onCandle(context)).toBeUndefined();
  });

  it("trend-filter ON: trend LONG, absent MR → composite LONG (trend alone)", () => {
    const a = new MockStrategy("trend", {
      side: "buy",
      confidence: 0.9,
      reason: "trend up",
      stopLoss: 95,
      takeProfit: 110,
    });
    const b = new MockStrategy("mr", undefined);
    const composite = new CompositeStrategy({
      component1: a,
      component2: b,
      useTrendFilter: true,
      agreementConfidenceBoost: 0.05,
    });
    const context = makeContext();
    const signal = composite.onCandle(context);
    expect(signal).not.toBeNull();
    expect(signal?.side).toBe("buy");
  });

  it("trend-filter ON: trend LONG, MR LONG → composite LONG (agreement, MR trigger)", () => {
    const a = new MockStrategy("trend", {
      side: "buy",
      confidence: 0.9,
      reason: "trend up",
      stopLoss: 95,
      takeProfit: 110,
    });
    const b = new MockStrategy("mr", {
      side: "buy",
      confidence: 0.85,
      reason: "BB long",
      stopLoss: 96,
      takeProfit: 109,
    });
    const composite = new CompositeStrategy({
      component1: a,
      component2: b,
      useTrendFilter: true,
      agreementConfidenceBoost: 0.05,
    });
    const context = makeContext();
    const signal = composite.onCandle(context);
    expect(signal).not.toBeNull();
    expect(signal?.side).toBe("buy");
    // MR trigger dominates (more specific), confidence boosted
    expect(signal?.reason).toContain("Composite AGREEMENT");
    expect(signal?.confidence).toBeCloseTo(0.9, 2);
    expect(signal?.stopLoss).toBe(96);
    expect(signal?.takeProfit).toBe(109);
  });

  it("trend-filter ON: trend LONG, MR SHORT → TREND WINS, MR filtered out", () => {
    const a = new MockStrategy("trend", {
      side: "buy",
      confidence: 0.9,
      reason: "trend up",
      stopLoss: 95,
      takeProfit: 110,
    });
    const b = new MockStrategy("mr", {
      side: "sell",
      confidence: 0.85,
      reason: "BB short",
      stopLoss: 105,
      takeProfit: 90,
    });
    const composite = new CompositeStrategy({
      component1: a,
      component2: b,
      useTrendFilter: true,
      agreementConfidenceBoost: 0.05,
    });
    const context = makeContext();
    const signal = composite.onCandle(context);
    expect(signal).not.toBeNull();
    expect(signal?.side).toBe("buy");
    expect(signal?.reason).toContain("Composite TREND FILTER");
    // Trend signal wins (its stopLoss/TP are kept)
    expect(signal?.stopLoss).toBe(95);
    expect(signal?.takeProfit).toBe(110);
  });

  it("trend-filter ON: trend SHORT, MR LONG → TREND WINS (short)", () => {
    const a = new MockStrategy("trend", {
      side: "sell",
      confidence: 0.9,
      reason: "trend down",
      stopLoss: 105,
      takeProfit: 90,
    });
    const b = new MockStrategy("mr", {
      side: "buy",
      confidence: 0.85,
      reason: "BB long",
      stopLoss: 96,
      takeProfit: 109,
    });
    const composite = new CompositeStrategy({
      component1: a,
      component2: b,
      useTrendFilter: true,
      agreementConfidenceBoost: 0.05,
    });
    const context = makeContext();
    const signal = composite.onCandle(context);
    expect(signal?.side).toBe("sell");
    expect(signal?.reason).toContain("TREND FILTER");
  });

  it("trend-filter OFF (OR voting): component1 alone wins", () => {
    const a = new MockStrategy("A", {
      side: "buy",
      confidence: 0.9,
      reason: "A signal",
      stopLoss: 95,
      takeProfit: 110,
    });
    const b = new MockStrategy("B", undefined);
    const composite = new CompositeStrategy({
      component1: a,
      component2: b,
      useTrendFilter: false,
      agreementConfidenceBoost: 0.05,
    });
    const context = makeContext();
    const signal = composite.onCandle(context);
    expect(signal?.side).toBe("buy");
    expect(signal?.reason).toBe("A signal"); // passthrough
  });

  it("trend-filter OFF: component2 alone wins when component1 is absent", () => {
    const a = new MockStrategy("A", undefined);
    const b = new MockStrategy("B", {
      side: "sell",
      confidence: 0.85,
      reason: "B signal",
      stopLoss: 105,
      takeProfit: 90,
    });
    const composite = new CompositeStrategy({
      component1: a,
      component2: b,
      useTrendFilter: false,
      agreementConfidenceBoost: 0.05,
    });
    const context = makeContext();
    const signal = composite.onCandle(context);
    expect(signal?.side).toBe("sell");
    expect(signal?.reason).toBe("B signal"); // passthrough
  });

  it("agreement confidence boost caps at 1.0", () => {
    const a = new MockStrategy("trend", {
      side: "buy",
      confidence: 1,
      reason: "t",
      stopLoss: 95,
      takeProfit: 110,
    });
    const b = new MockStrategy("mr", {
      side: "buy",
      confidence: 1,
      reason: "m",
      stopLoss: 96,
      takeProfit: 109,
    });
    const composite = new CompositeStrategy({
      component1: a,
      component2: b,
      useTrendFilter: true,
      agreementConfidenceBoost: 0.5,
    });
    const context = makeContext();
    const signal = composite.onCandle(context);
    // 1.0 + 0.5 = 1.5, capped at 1.0
    expect(signal?.confidence).toBeLessThanOrEqual(1);
  });

  it("works with stub components", () => {
    // The composite smoke test uses stub Strategy implementations to verify
    // the composite pattern independently of concrete strategy selection.
    // Production composite usage is via DonchianPivotComposition.
    const stubTrend: Strategy = {
      name: "stub-trend",
      timeframes: ["1d"] as const,
      warmup: () => 0,
      onCandle: () => NO_SIGNAL,
    };
    const stubCarry: Strategy = {
      name: "stub-carry",
      timeframes: ["1d"] as const,
      warmup: () => 0,
      onCandle: () => NO_SIGNAL,
    };
    const composite = new CompositeStrategy({
      component1: stubTrend,
      component2: stubCarry,
      useTrendFilter: true,
      agreementConfidenceBoost: 0.05,
    });
    const context = makeContext({
      candleIndex: 300,
      candle: baseCandle(95),
      mtfState: {
        htf: { ema50: 105, ema200: 100 },
        mtf: { bbLower: 96, bbUpper: 110, bbMiddle: 103, adx: 20 },
        ltf: { atr: 2 },
      },
    });
    const signal = composite.onCandle(context);
    expect(signal === undefined || typeof signal === "object").toBe(true);

    const malformedResult = (result: unknown): Strategy =>
      new Proxy(new MockStrategy("untrusted", NO_SIGNAL), {
        get(target, property, receiver) {
          if (property === "onCandle") return () => result;
          const value: unknown = Reflect.get(target, property, receiver);
          return value;
        },
      });
    const failClosed = (component1: Strategy): void => {
      const guarded = new CompositeStrategy({
        component1,
        component2: new MockStrategy("valid", NO_SIGNAL),
        useTrendFilter: false,
        agreementConfidenceBoost: 0.05,
      });
      expect(() => guarded.onCandle(context)).toThrow(/CompositeStrategy callback result/);
    };

    const nullResult: unknown = JSON.parse("null");
    failClosed(malformedResult(nullResult));
    failClosed(malformedResult(42));
    failClosed(malformedResult({ side: "buy" }));
    failClosed(
      malformedResult({ side: "hold", confidence: 0.8, reason: "bad side", stopLoss: 95, takeProfit: 110 }),
    );
    const zeroConfidenceSignal: StrategySignal = {
      side: "buy",
      confidence: 0,
      reason: "documented zero confidence",
      stopLoss: 95,
      takeProfit: 110,
    };
    const zeroConfidenceComposite = new CompositeStrategy({
      component1: new MockStrategy("zero-confidence", zeroConfidenceSignal),
      component2: new MockStrategy("absent", NO_SIGNAL),
      useTrendFilter: false,
      agreementConfidenceBoost: 0.05,
    });
    expect(zeroConfidenceComposite.onCandle(context)).toEqual(zeroConfidenceSignal);
    failClosed(
      malformedResult({
        side: "buy",
        confidence: 2,
        reason: "bad confidence",
        stopLoss: 95,
        takeProfit: 110,
      }),
    );
    failClosed(malformedResult({ side: "buy", confidence: 0.8, reason: "", stopLoss: 95, takeProfit: 110 }));
    failClosed(
      malformedResult({ side: "buy", confidence: 0.8, reason: "bad price", stopLoss: -1, takeProfit: 110 }),
    );
    failClosed(
      malformedResult({ side: "buy", confidence: 0.8, reason: "wrong buy", stopLoss: 110, takeProfit: 95 }),
    );
    failClosed(
      malformedResult({ side: "sell", confidence: 0.8, reason: "wrong sell", stopLoss: 95, takeProfit: 110 }),
    );
    failClosed(
      malformedResult(
        new Proxy(
          { side: "buy", confidence: 0.8, reason: "hostile", stopLoss: 95, takeProfit: 110 },
          {
            get() {
              throw new Error("hostile result property access");
            },
          },
        ),
      ),
    );

    const revocable = Proxy.revocable(new MockStrategy("revoked", NO_SIGNAL), {});
    revocable.revoke();
    failClosed(revocable.proxy);

    const callbackThrowing = new Proxy(new MockStrategy("throwing", NO_SIGNAL), {
      get(target, property, receiver) {
        if (property === "onCandle") throw new Error("callback unavailable");
        const value: unknown = Reflect.get(target, property, receiver);
        return value;
      },
    });
    failClosed(callbackThrowing);

    const unnamed = new Proxy(
      new MockStrategy("named", {
        side: "buy",
        confidence: 0.8,
        reason: "valid",
        stopLoss: 95,
        takeProfit: 110,
      }),
      {
        get(target, property, receiver) {
          if (property === "name") return "";
          const value: unknown = Reflect.get(target, property, receiver);
          return value;
        },
      },
    );
    const nameGuard = new CompositeStrategy({
      component1: unnamed,
      component2: new MockStrategy("valid", {
        side: "buy",
        confidence: 0.8,
        reason: "valid",
        stopLoss: 95,
        takeProfit: 110,
      }),
      useTrendFilter: true,
      agreementConfidenceBoost: 0.05,
    });
    expect(() => nameGuard.onCandle(context)).toThrow(/name must be a non-empty string/);

    const unreadableName = new Proxy(
      new MockStrategy("named", {
        side: "buy",
        confidence: 0.8,
        reason: "valid",
        stopLoss: 95,
        takeProfit: 110,
      }),
      {
        get(target, property, receiver) {
          if (property === "name") throw new Error("name unavailable");
          const value: unknown = Reflect.get(target, property, receiver);
          return value;
        },
      },
    );
    const unreadableNameGuard = new CompositeStrategy({
      component1: unreadableName,
      component2: new MockStrategy("valid", {
        side: "buy",
        confidence: 0.8,
        reason: "valid",
        stopLoss: 95,
        takeProfit: 110,
      }),
      useTrendFilter: true,
      agreementConfidenceBoost: 0.05,
    });
    expect(() => unreadableNameGuard.onCandle(context)).toThrow(/name was unreadable/);

    const absentOr = new CompositeStrategy({
      component1: new MockStrategy("absent-one", NO_SIGNAL),
      component2: new MockStrategy("absent-two", NO_SIGNAL),
      useTrendFilter: false,
      agreementConfidenceBoost: 0.05,
    });
    expect(absentOr.onCandle(context)).toBeUndefined();
  });
});
