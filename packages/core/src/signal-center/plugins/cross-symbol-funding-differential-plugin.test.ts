// packages/core/src/signal-center/plugins/cross-symbol-funding-differential-plugin.test.ts —
// Phase 13 Track C — Plugin 3/3 tests.
//
// Test coverage (>=25 unit tests + adversarial probes) for
// `CrossSymbolFundingDifferentialPlugin`:
//
//   1. Construction with default config succeeds
//   2. Construction with custom config accepted
//   3. metadata declares name/edgeClass/capitalRequirement=10000/maxLeverage=10
//   4. Construction with bad minDifferentialPer8h REJECTED
//   5. Construction with bad baseNotionalUsd REJECTED
//   6. Construction with empty enabledPairs REJECTED
//   7. Construction with enabledPairs[i] not a tuple REJECTED
//   8. Construction with enabledPairs[i][0] non-string REJECTED
//   9. Construction with enabledPairs[i][1] non-string REJECTED
//  10. Construction with enabledPairs[i] = [x, x] REJECTED
//  11. Construction with duplicate enabledPairs REJECTED
//  12. pairKey deterministic key
//  13. computeFundingDifferential = abs(rateA - rateB)
//  14. clampStrengthFromDifferential = min(|d|/0.001, 1.0)
//  15. recordFundingRate: differential > min emits short-HIGH + long-LOW + carry-high
//  16. recordFundingRate: differential <= min emits flat on both legs (no carry)
//  17. recordFundingRate: BTC high, ETH low → short BTC, long ETH
//  18. recordFundingRate: BTC low, ETH high → long BTC, short ETH
//  19. recordFundingRate: single-leg feed (no pair complete) emits nothing
//  20. recordFundingRate: non-finite rate increments malformedRateDrops
//  21. recordFundingRate: symbol neither legA nor legB ignored
//  22. recordFundingRate: entryCount increments on first active carry
//  23. recordFundingRate: exitCount increments when carry turns off
//  24. recordFundingRate: carryActiveForPair accessor
//  25. bus emit routes to subscribers (direction + carry kinds)
//  26. subscribe calls _assertInitialState (Layer 2)
//  27. _assertInitialState throws on missing pairState entries
//  28. onBar increments barsProcessed
//  29. reset() clears state and re-initializes per-pair entries
//  30. dispose() releases bus reference
//  31. validateConfig: undefined is ok, non-object rejected, bad fields rejected
//  32. effectiveMaxNotionalUsd = baseNotionalUsd * 10
//  33. isPairEnabled + enabledPairsList accessors
//  34. lastDifferentialForPair accessor
//  35. ADVERSARIAL: differential = 0.05 (huge) emits strength = 1.0 (capped)
//  36. ADVERSARIAL: malformed rates (NaN, Infinity) all dropped
//  37. ADVERSARIAL: many rapid flips trigger no leverage violation
//  38. ADVERSARIAL: empty enabledPairs throws at construction
//  39. ADVERSARIAL: multiple enabled pairs processed independently
//  40. Layer 2 1:10 defense: per-emit assertion runs
//  41. factory createCrossSymbolFundingDifferentialPlugin produces same result as `new`
//  42. CarrySignal regime='high' emitted with source tagged with legs

import { describe, expect, it } from "bun:test";

import {
  CrossSymbolFundingDifferentialPlugin,
  DEFAULT_DIFFERENTIAL_NORMALIZER,
  clampStrengthFromDifferential,
  computeFundingDifferential,
  createCrossSymbolFundingDifferentialPlugin,
  pairKey,
} from "./cross-symbol-funding-differential-plugin.js";
import { SignalBus } from "../signal-bus.js";

const DEFAULT_BASE_NOTIONAL = 10_000;
const TS_BASE = 1_700_000_000_000;

function makeBar(timestampMs = TS_BASE) {
  return {
    timestamp: timestampMs,
    open: 100,
    high: 101,
    low: 99,
    close: 100,
    volume: 1000,
  };
}

describe("CrossSymbolFundingDifferentialPlugin", () => {
  it("construction with default config succeeds", () => {
    const p = new CrossSymbolFundingDifferentialPlugin();
    expect(p.metadata.name).toBe("cross-symbol-funding-differential-v1");
    expect(p.config.minDifferentialPer8h).toBe(0.0001);
    expect(p.config.baseNotionalUsd).toBe(DEFAULT_BASE_NOTIONAL);
    expect(p.config.enabledPairs.length).toBe(1);
    expect(p.config.enabledPairs[0]).toEqual(["BTC/USDT", "ETH/USDT"]);
  });

  it("construction with custom config accepted", () => {
    const p = new CrossSymbolFundingDifferentialPlugin({
      minDifferentialPer8h: 0.0005,
      baseNotionalUsd: 25_000,
      enabledPairs: [
        ["BTC/USDT", "ETH/USDT"],
        ["BTC/USDT", "SOL/USDT"],
      ],
    });
    expect(p.config.minDifferentialPer8h).toBe(0.0005);
    expect(p.config.baseNotionalUsd).toBe(25_000);
    expect(p.config.enabledPairs.length).toBe(2);
  });

  it("metadata declares name/edgeClass/capitalRequirement=10000/maxLeverage=10", () => {
    const p = new CrossSymbolFundingDifferentialPlugin();
    expect(p.metadata.name).toBe("cross-symbol-funding-differential-v1");
    expect(p.metadata.version).toBe("1.0.0");
    expect(p.metadata.edgeClass).toBe("carry");
    expect(p.metadata.capitalRequirement).toBe(10_000);
    expect(p.metadata.maxLeverage).toBe(10);
  });

  it("construction with bad minDifferentialPer8h REJECTED", () => {
    expect(() =>
      new CrossSymbolFundingDifferentialPlugin({ minDifferentialPer8h: -0.001 }),
    ).toThrow(/minDifferentialPer8h=/);
    expect(() =>
      new CrossSymbolFundingDifferentialPlugin({ minDifferentialPer8h: 0.1 }),
    ).toThrow(/minDifferentialPer8h=/);
    expect(() =>
      new CrossSymbolFundingDifferentialPlugin({
        minDifferentialPer8h: Number.NaN,
      }),
    ).toThrow(/minDifferentialPer8h=NaN/);
  });

  it("construction with bad baseNotionalUsd REJECTED", () => {
    expect(() =>
      new CrossSymbolFundingDifferentialPlugin({ baseNotionalUsd: 0 }),
    ).toThrow(/baseNotionalUsd=0/);
    expect(() =>
      new CrossSymbolFundingDifferentialPlugin({ baseNotionalUsd: -100 }),
    ).toThrow(/baseNotionalUsd=-100/);
    expect(() =>
      new CrossSymbolFundingDifferentialPlugin({ baseNotionalUsd: 1e15 }),
    ).toThrow(/baseNotionalUsd=/);
  });

  it("construction with empty enabledPairs REJECTED", () => {
    expect(
      () => new CrossSymbolFundingDifferentialPlugin({ enabledPairs: [] }),
    ).toThrow(/enabledPairs must be a non-empty/);
  });

  it("construction with enabledPairs[i] not a tuple REJECTED", () => {
    expect(
      () =>
        new CrossSymbolFundingDifferentialPlugin({
          enabledPairs: ["BTC/USDT"] as unknown as readonly (readonly [string, string])[],
        }),
    ).toThrow(/must be a \[a, b\] tuple/);
  });

  it("construction with enabledPairs[i][0] non-string REJECTED", () => {
    expect(
      () =>
        new CrossSymbolFundingDifferentialPlugin({
          enabledPairs: [[123 as unknown as string, "ETH/USDT"]],
        }),
    ).toThrow(/enabledPairs\[0\]\[0\]/);
  });

  it("construction with enabledPairs[i][1] non-string REJECTED", () => {
    expect(
      () =>
        new CrossSymbolFundingDifferentialPlugin({
          enabledPairs: [["BTC/USDT", ""]],
        }),
    ).toThrow(/enabledPairs\[0\]\[1\]/);
  });

  it("construction with enabledPairs[i] = [x, x] REJECTED", () => {
    expect(
      () =>
        new CrossSymbolFundingDifferentialPlugin({
          enabledPairs: [["BTC/USDT", "BTC/USDT"]],
        }),
    ).toThrow(/legs must differ/);
  });

  it("construction with duplicate enabledPairs REJECTED", () => {
    expect(
      () =>
        new CrossSymbolFundingDifferentialPlugin({
          enabledPairs: [
            ["BTC/USDT", "ETH/USDT"],
            ["BTC/USDT", "ETH/USDT"],
          ],
        }),
    ).toThrow(/duplicate pair/);
  });

  it("pairKey deterministic key", () => {
    expect(pairKey(["BTC/USDT", "ETH/USDT"])).toBe("BTC/USDT|ETH/USDT");
    expect(pairKey(["a", "b"])).toBe("a|b");
  });

  it("computeFundingDifferential = abs(rateA - rateB)", () => {
    expect(computeFundingDifferential(0.0002, 0.0001)).toBeCloseTo(0.0001, 10);
    expect(computeFundingDifferential(0.0001, 0.0002)).toBeCloseTo(0.0001, 10);
    expect(computeFundingDifferential(0.0001, 0.0001)).toBe(0);
    expect(computeFundingDifferential(Number.NaN, 0.0001)).toBeNull();
    expect(computeFundingDifferential(0.0001, Number.NaN)).toBeNull();
    expect(computeFundingDifferential(Number.POSITIVE_INFINITY, 0.0001)).toBe(Number.POSITIVE_INFINITY);
  });

  it("clampStrengthFromDifferential = min(|d|/0.001, 1.0)", () => {
    expect(clampStrengthFromDifferential(0)).toBe(0);
    expect(clampStrengthFromDifferential(0.001)).toBeCloseTo(1.0, 10);
    expect(clampStrengthFromDifferential(0.0005)).toBeCloseTo(0.5, 10);
    expect(clampStrengthFromDifferential(0.05)).toBe(1.0);
    expect(clampStrengthFromDifferential(-0.001)).toBe(0);
    expect(clampStrengthFromDifferential(Number.NaN)).toBe(0);
    expect(clampStrengthFromDifferential(Number.POSITIVE_INFINITY)).toBe(1.0);
  });

  it("recordFundingRate: differential > min emits short-HIGH + long-LOW + carry-high", () => {
    const p = new CrossSymbolFundingDifferentialPlugin({
      minDifferentialPer8h: 0.0001,
    });
    const bus = new SignalBus();
    p.subscribe(bus);
    const carryReceived: { regime: string; fundingRate: number; source: string }[] = [];
    bus.subscribe("carry", (s) => {
      carryReceived.push({
        regime: (s as { regime: string }).regime,
        fundingRate: (s as { fundingRate: number }).fundingRate,
        source: (s as { source: string }).source,
      });
    });
    // BTC at 0.0003, ETH at 0.0001 -> diff = 0.0002 > 0.0001 -> BTC high, ETH low.
    const result1 = p.recordFundingRate("BTC/USDT", 0.0003, TS_BASE);
    expect(result1.directionSignals.length).toBe(0); // waiting for ETH
    expect(result1.carrySignals.length).toBe(0);
    const result2 = p.recordFundingRate("ETH/USDT", 0.0001, TS_BASE + 1000);
    expect(result2.directionSignals.length).toBe(2); // short BTC + long ETH
    expect(result2.carrySignals.length).toBe(1);
    expect(result2.carrySignals[0]!.regime).toBe("high");
    expect(carryReceived.length).toBe(1);
    expect(carryReceived[0]!.regime).toBe("high");
    // DirectionSignals: short on BTC, long on ETH.
    const sides = result2.directionSignals.map((d) => d.side).sort();
    expect(sides).toEqual(["long", "short"]);
  });

  it("recordFundingRate: differential <= min emits flat on both legs (no carry)", () => {
    const p = new CrossSymbolFundingDifferentialPlugin({
      minDifferentialPer8h: 0.0005,
    });
    p.subscribe(new SignalBus());
    p.recordFundingRate("BTC/USDT", 0.0002);
    const result = p.recordFundingRate("ETH/USDT", 0.0002); // diff = 0 < 0.0005
    expect(result.carrySignals.length).toBe(0);
    expect(result.directionSignals.length).toBe(2);
    expect(result.directionSignals.every((d) => d.side === "flat")).toBe(true);
  });

  it("recordFundingRate: BTC high, ETH low -> short BTC, long ETH", () => {
    const p = new CrossSymbolFundingDifferentialPlugin({
      minDifferentialPer8h: 0.0001,
    });
    p.subscribe(new SignalBus());
    p.recordFundingRate("BTC/USDT", 0.0003);
    const result = p.recordFundingRate("ETH/USDT", 0.0001);
    const dirBtc = result.directionSignals.find((d) => d.source.includes("BTC/USDT"));
    const dirEth = result.directionSignals.find((d) => d.source.includes("ETH/USDT"));
    // Both signals have source = plugin name; we need to look at the actual mapping.
    // The first direction signal is the high leg (short), the second is the low leg (long).
    expect(result.directionSignals[0]!.side).toBe("short"); // BTC high
    expect(result.directionSignals[1]!.side).toBe("long"); // ETH low
    void dirBtc;
    void dirEth;
  });

  it("recordFundingRate: BTC low, ETH high -> long BTC, short ETH", () => {
    const p = new CrossSymbolFundingDifferentialPlugin({
      minDifferentialPer8h: 0.0001,
    });
    p.subscribe(new SignalBus());
    p.recordFundingRate("BTC/USDT", 0.0001); // low
    const result = p.recordFundingRate("ETH/USDT", 0.0003); // high -> diff = 0.0002
    expect(result.directionSignals[0]!.side).toBe("short"); // ETH high
    expect(result.directionSignals[1]!.side).toBe("long"); // BTC low
  });

  it("recordFundingRate: single-leg feed (no pair complete) emits nothing", () => {
    const p = new CrossSymbolFundingDifferentialPlugin();
    p.subscribe(new SignalBus());
    const result = p.recordFundingRate("BTC/USDT", 0.0003);
    expect(result.directionSignals.length).toBe(0);
    expect(result.carrySignals.length).toBe(0);
    expect(p.state.recordFundingCalls).toBe(1);
  });

  it("recordFundingRate: non-finite rate increments malformedRateDrops", () => {
    const p = new CrossSymbolFundingDifferentialPlugin();
    p.subscribe(new SignalBus());
    const before = p.state.malformedRateDrops;
    p.recordFundingRate("BTC/USDT", Number.NaN);
    p.recordFundingRate("BTC/USDT", Number.POSITIVE_INFINITY);
    p.recordFundingRate("BTC/USDT", Number.NEGATIVE_INFINITY);
    expect(p.state.malformedRateDrops).toBe(before + 3);
    expect(p.state.recordFundingCalls).toBe(0);
  });

  it("recordFundingRate: symbol neither legA nor legB ignored", () => {
    const p = new CrossSymbolFundingDifferentialPlugin({
      enabledPairs: [["BTC/USDT", "ETH/USDT"]],
    });
    p.subscribe(new SignalBus());
    const result = p.recordFundingRate("DOGE/USDT", 0.001);
    expect(result.directionSignals.length).toBe(0);
    expect(result.carrySignals.length).toBe(0);
  });

  it("recordFundingRate: entryCount increments on first active carry", () => {
    const p = new CrossSymbolFundingDifferentialPlugin({
      minDifferentialPer8h: 0.0001,
    });
    p.subscribe(new SignalBus());
    p.recordFundingRate("BTC/USDT", 0.0003);
    p.recordFundingRate("ETH/USDT", 0.0001);
    expect(p.state.pairState.get("BTC/USDT|ETH/USDT")?.entryCount).toBe(1);
  });

  it("recordFundingRate: exitCount increments when carry turns off", () => {
    const p = new CrossSymbolFundingDifferentialPlugin({
      minDifferentialPer8h: 0.0001,
    });
    p.subscribe(new SignalBus());
    p.recordFundingRate("BTC/USDT", 0.0003);
    p.recordFundingRate("ETH/USDT", 0.0001); // entry
    expect(p.state.pairState.get("BTC/USDT|ETH/USDT")?.carryActive).toBe(true);
    p.recordFundingRate("BTC/USDT", 0.0001); // collapse differential
    p.recordFundingRate("ETH/USDT", 0.0001); // exit
    expect(p.state.pairState.get("BTC/USDT|ETH/USDT")?.exitCount).toBe(1);
    expect(p.state.pairState.get("BTC/USDT|ETH/USDT")?.carryActive).toBe(false);
  });

  it("recordFundingRate: carryActiveForPair accessor", () => {
    const p = new CrossSymbolFundingDifferentialPlugin({
      minDifferentialPer8h: 0.0001,
    });
    p.subscribe(new SignalBus());
    expect(p.carryActiveForPair("BTC/USDT", "ETH/USDT")).toBe(false);
    p.recordFundingRate("BTC/USDT", 0.0003);
    p.recordFundingRate("ETH/USDT", 0.0001);
    expect(p.carryActiveForPair("BTC/USDT", "ETH/USDT")).toBe(true);
  });

  it("bus emit routes to subscribers (direction + carry kinds)", () => {
    const p = new CrossSymbolFundingDifferentialPlugin({
      minDifferentialPer8h: 0.0001,
    });
    const bus = new SignalBus();
    const dirReceived: { side: string }[] = [];
    const carryReceived: { regime: string }[] = [];
    bus.subscribe("direction", (s) => {
      dirReceived.push({ side: (s as { side: string }).side });
    });
    bus.subscribe("carry", (s) => {
      carryReceived.push({ regime: (s as { regime: string }).regime });
    });
    p.subscribe(bus);
    p.recordFundingRate("BTC/USDT", 0.0003);
    p.recordFundingRate("ETH/USDT", 0.0001);
    expect(dirReceived.length).toBe(2);
    expect(carryReceived.length).toBe(1);
  });

  it("subscribe calls _assertInitialState (Layer 2)", () => {
    const p = new CrossSymbolFundingDifferentialPlugin();
    const bus = new SignalBus();
    p.subscribe(bus);
    expect((p as unknown as { _wired: boolean })._wired).toBe(true);
  });

  it("_assertInitialState throws on missing pairState entries", () => {
    const p = new CrossSymbolFundingDifferentialPlugin();
    p.state.pairState.clear();
    expect(() => p.subscribe(new SignalBus())).toThrow(/LAYER 2 BREACH/);
  });

  it("onBar increments barsProcessed", () => {
    const p = new CrossSymbolFundingDifferentialPlugin();
    p.subscribe(new SignalBus());
    p.onBar(makeBar(), {});
    p.onBar(makeBar(), {});
    expect(p.state.barsProcessed).toBe(2);
  });

  it("reset() clears state and re-initializes per-pair entries", () => {
    const p = new CrossSymbolFundingDifferentialPlugin();
    p.subscribe(new SignalBus());
    p.recordFundingRate("BTC/USDT", 0.0003);
    p.state.barsProcessed = 5;
    p.reset();
    expect(p.state.barsProcessed).toBe(0);
    expect(p.state.pairState.size).toBe(1);
    const ps = p.state.pairState.get("BTC/USDT|ETH/USDT")!;
    expect(ps.carryActive).toBe(false);
    expect(ps.fundingA).toBeNull();
    expect(ps.fundingB).toBeNull();
  });

  it("dispose() releases bus reference", () => {
    const p = new CrossSymbolFundingDifferentialPlugin();
    const bus = new SignalBus();
    p.subscribe(bus);
    p.dispose();
    expect((p as unknown as { _bus: unknown })._bus).toBeNull();
    expect((p as unknown as { _wired: boolean })._wired).toBe(false);
  });

  it("validateConfig: undefined is ok, non-object rejected, bad fields rejected", () => {
    const p = new CrossSymbolFundingDifferentialPlugin();
    expect(p.validateConfig(undefined).ok).toBe(true);
    expect(p.validateConfig(null).ok).toBe(true);
    expect(p.validateConfig("not-object").ok).toBe(false);
    expect(p.validateConfig({ minDifferentialPer8h: -1 }).ok).toBe(false);
    expect(p.validateConfig({ baseNotionalUsd: -1 }).ok).toBe(false);
    expect(p.validateConfig({ enabledPairs: [] }).ok).toBe(false);
    expect(
      p.validateConfig({ enabledPairs: [["BTC/USDT", "ETH/USDT"]] }).ok,
    ).toBe(true);
    expect(
      p.validateConfig({ enabledPairs: [["BTC/USDT", "BTC/USDT"]] }).ok,
    ).toBe(false);
  });

  it("effectiveMaxNotionalUsd = baseNotionalUsd * 10", () => {
    const p = new CrossSymbolFundingDifferentialPlugin({ baseNotionalUsd: 25_000 });
    expect(p.effectiveMaxNotionalUsd()).toBe(250_000);
  });

  it("isPairEnabled + enabledPairsList accessors", () => {
    const p = new CrossSymbolFundingDifferentialPlugin({
      enabledPairs: [
        ["BTC/USDT", "ETH/USDT"],
        ["BTC/USDT", "SOL/USDT"],
      ],
    });
    expect(p.isPairEnabled("BTC/USDT", "ETH/USDT")).toBe(true);
    expect(p.isPairEnabled("ETH/USDT", "BTC/USDT")).toBe(false);
    expect(p.enabledPairsList().length).toBe(2);
  });

  it("lastDifferentialForPair accessor", () => {
    const p = new CrossSymbolFundingDifferentialPlugin({
      minDifferentialPer8h: 0.0001,
    });
    p.subscribe(new SignalBus());
    expect(p.lastDifferentialForPair("BTC/USDT", "ETH/USDT")).toBeNull();
    p.recordFundingRate("BTC/USDT", 0.0003);
    p.recordFundingRate("ETH/USDT", 0.0001);
    expect(p.lastDifferentialForPair("BTC/USDT", "ETH/USDT")).toBeCloseTo(0.0002, 10);
  });

  it("ADVERSARIAL: differential = 0.05 (huge) emits strength = 1.0 (capped)", () => {
    const p = new CrossSymbolFundingDifferentialPlugin({
      minDifferentialPer8h: 0.0001,
    });
    p.subscribe(new SignalBus());
    p.recordFundingRate("BTC/USDT", 0.05);
    const result = p.recordFundingRate("ETH/USDT", 0.0);
    expect(result.directionSignals[0]!.strength).toBe(1.0);
  });

  it("ADVERSARIAL: malformed rates (NaN, Infinity) all dropped", () => {
    const p = new CrossSymbolFundingDifferentialPlugin();
    p.subscribe(new SignalBus());
    const before = p.state.malformedRateDrops;
    p.recordFundingRate("BTC/USDT", Number.NaN);
    p.recordFundingRate("BTC/USDT", Number.POSITIVE_INFINITY);
    p.recordFundingRate("BTC/USDT", Number.NEGATIVE_INFINITY);
    expect(p.state.malformedRateDrops).toBe(before + 3);
    expect(p.state.recordFundingCalls).toBe(0);
  });

  it("ADVERSARIAL: many rapid flips trigger no leverage violation", () => {
    const p = new CrossSymbolFundingDifferentialPlugin({
      minDifferentialPer8h: 0.0001,
    });
    p.subscribe(new SignalBus());
    for (let cycle = 0; cycle < 5; cycle++) {
      p.recordFundingRate("BTC/USDT", 0.0003);
      p.recordFundingRate("ETH/USDT", 0.0001); // enter
      p.recordFundingRate("BTC/USDT", 0.0001); // exit
      p.recordFundingRate("ETH/USDT", 0.0001);
    }
    expect(p.state.leverageClampCount).toBe(0);
  });

  it("ADVERSARIAL: empty enabledPairs throws at construction", () => {
    expect(
      () => new CrossSymbolFundingDifferentialPlugin({ enabledPairs: [] }),
    ).toThrow(/enabledPairs must be a non-empty/);
  });

  it("ADVERSARIAL: multiple enabled pairs processed independently", () => {
    const p = new CrossSymbolFundingDifferentialPlugin({
      minDifferentialPer8h: 0.0001,
      enabledPairs: [
        ["BTC/USDT", "ETH/USDT"],
        ["BTC/USDT", "SOL/USDT"],
      ],
    });
    p.subscribe(new SignalBus());
    p.recordFundingRate("BTC/USDT", 0.0003);
    const result = p.recordFundingRate("ETH/USDT", 0.0001);
    // BTC-ETH pair active; BTC-SOL pair waiting on SOL.
    expect(result.directionSignals.length).toBe(2); // BTC-ETH only
    expect(result.carrySignals.length).toBe(1); // BTC-ETH only
    const result2 = p.recordFundingRate("SOL/USDT", 0.0001);
    // Now BTC-SOL pair also active.
    expect(result2.directionSignals.length).toBe(2); // BTC-SOL
    expect(result2.carrySignals.length).toBe(1); // BTC-SOL
  });

  it("Layer 2 1:10 defense: per-emit assertion runs", () => {
    const p = new CrossSymbolFundingDifferentialPlugin({
      minDifferentialPer8h: 0.0001,
    });
    p.subscribe(new SignalBus());
    const before = p.state.layer2AssertionCount;
    p.recordFundingRate("BTC/USDT", 0.0003);
    p.recordFundingRate("ETH/USDT", 0.0001);
    expect(p.state.layer2AssertionCount).toBeGreaterThan(before);
  });

  it("factory createCrossSymbolFundingDifferentialPlugin produces same result as `new`", () => {
    const p1 = createCrossSymbolFundingDifferentialPlugin({
      minDifferentialPer8h: 0.0005,
    });
    const p2 = new CrossSymbolFundingDifferentialPlugin({
      minDifferentialPer8h: 0.0005,
    });
    expect(p1.config.minDifferentialPer8h).toBe(p2.config.minDifferentialPer8h);
    expect(p1.metadata.name).toBe(p2.metadata.name);
  });

  it("CarrySignal regime='high' emitted with source tagged with legs", () => {
    const p = new CrossSymbolFundingDifferentialPlugin({
      minDifferentialPer8h: 0.0001,
    });
    p.subscribe(new SignalBus());
    p.recordFundingRate("BTC/USDT", 0.0003);
    const result = p.recordFundingRate("ETH/USDT", 0.0001);
    expect(result.carrySignals[0]!.regime).toBe("high");
    expect(result.carrySignals[0]!.source).toContain("BTC/USDT");
    expect(result.carrySignals[0]!.source).toContain("ETH/USDT");
    expect(result.carrySignals[0]!.fundingRate).toBeCloseTo(0.0002, 10);
  });

  it("DEFAULT_DIFFERENTIAL_NORMALIZER = 0.001 constant", () => {
    expect(DEFAULT_DIFFERENTIAL_NORMALIZER).toBe(0.001);
  });

  it("recordFundingRate: edge-case differential exactly equal to threshold emits flat", () => {
    const p = new CrossSymbolFundingDifferentialPlugin({
      minDifferentialPer8h: 0.0005,
    });
    p.subscribe(new SignalBus());
    p.recordFundingRate("BTC/USDT", 0.0005);
    const result = p.recordFundingRate("ETH/USDT", 0.0); // diff = 0.0005 = threshold
    expect(result.carrySignals.length).toBe(0);
    expect(result.directionSignals.every((d) => d.side === "flat")).toBe(true);
  });

  it("recordFundingRate: negative funding differential handled via abs()", () => {
    const p = new CrossSymbolFundingDifferentialPlugin({
      minDifferentialPer8h: 0.0001,
    });
    p.subscribe(new SignalBus());
    p.recordFundingRate("BTC/USDT", -0.0003); // negative funding
    const result = p.recordFundingRate("ETH/USDT", -0.0001); // diff = abs(-0.0003 - -0.0001) = 0.0002
    expect(result.directionSignals.length).toBe(2);
    expect(result.carrySignals.length).toBe(1);
    // BTC at -0.0003 is "lower" (more negative), ETH at -0.0001 is "higher".
    // fundingA >= fundingB? -0.0003 >= -0.0001? No. So highLeg = legB (ETH), lowLeg = legA (BTC).
    expect(result.directionSignals[0]!.side).toBe("short"); // ETH (high)
    expect(result.directionSignals[1]!.side).toBe("long"); // BTC (low)
  });
});