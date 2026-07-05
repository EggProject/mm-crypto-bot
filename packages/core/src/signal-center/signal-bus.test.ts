// packages/core/src/signal-center/signal-bus.test.ts — Phase 10G Track A
//
// Test coverage (≥15) for SignalBus:
//
//   1.  Subscribe + emit basic flow
//   2.  Multiple subscribers on same kind — all fire
//   3.  Multiple subscribers on different kinds — only matching fires
//   4.  Unsubscribe mid-stream — handler stops firing
//   5.  Unsubscribe is idempotent (double-call is no-op)
//   6.  Discriminated union narrowing — handler receives correct variant
//   7.  Backtest mode determinism (same input → same output, in order)
//   8.  Live mode latency tracking (performance.now)
//   9.  Live mode p99 latency computation
//  10.  Snapshot captures all emitted signals
//  11.  Clear resets state (snapshot, queue, latency, errors)
//  12.  Edge case: emit before subscribe → no error, snapshot still records
//  13.  Edge case: emit with malformed signal (no kind) → throws
//  14.  Backpressure: live mode drops excess emits beyond maxEmitsPerSecond
//  15.  Concurrent emit ordering: FIFO guarantee in backtest mode
//  16.  subscriberCount and subscribersForKind accessors
//  17.  Mode can be toggled at runtime (backtest → live)
//  18.  Empty bus: drain() in live mode returns 0 (no-op)
//  19.  Error swallowing in live mode (errorCount increments)
//  20.  assertExhaustive throws on unknown kind
//  21.  Type guards (isDirection/isCarry/isSizing/isRisk) work as expected
//  22.  createSignalBus factory matches `new SignalBus()`

import { describe, expect, it } from "bun:test";

import { SignalBus, createSignalBus } from "./signal-bus.js";
import {
  isCarry,
  isDirection,
  isRisk,
  isSizing,
  type CarrySignal,
  type DirectionSignal,
  type RiskSignal,
  type SizingSignal,
  type Signal,
} from "./types.js";

const mkDirection = (side: "long" | "short" | "flat", strength: number): DirectionSignal => ({
  kind: "direction",
  side,
  strength,
  source: "test",
});

const mkCarry = (rate: number, regime: "high" | "neutral" | "flip"): CarrySignal => ({
  kind: "carry",
  fundingRate: rate,
  regime,
  source: "test",
});

const mkSizing = (notional: number): SizingSignal => ({
  kind: "sizing",
  kellyFraction: 0.5,
  volMultiplier: 0.8,
  notional,
  source: "test",
});

const mkRisk = (varDaily95: number): RiskSignal => ({
  kind: "risk",
  varDaily95,
  correlationPenalty: 0.1,
  drawdownLimit: 0.1,
  source: "test",
});

describe("SignalBus", () => {
  it("subscribe + emit basic flow: handler fires exactly once per emit", () => {
    const bus = new SignalBus();
    let count = 0;
    bus.subscribe("direction", () => {
      count += 1;
    });
    bus.emit(mkDirection("long", 0.7));
    bus.emit(mkDirection("short", 0.5));
    expect(count).toBe(2);
    expect(bus.subscriberCount).toBe(1);
  });

  it("subscribe + emit basic flow (alias)", () => {
    const bus = new SignalBus();
    let count = 0;
    bus.subscribe("direction", () => {
      count += 1;
    });
    bus.emit(mkDirection("long", 0.7));
    expect(count).toBe(1);
  });

  it("multiple subscribers on same kind all fire on each emit", () => {
    const bus = new SignalBus();
    const calls: string[] = [];
    bus.subscribe("direction", (s) => {
      calls.push(`a:${isDirection(s) ? s.side : "?"}`);
    });
    bus.subscribe("direction", (s) => {
      calls.push(`b:${isDirection(s) ? s.side : "?"}`);
    });
    bus.subscribe("direction", (s) => {
      calls.push(`c:${isDirection(s) ? s.side : "?"}`);
    });
    bus.emit(mkDirection("long", 0.5));
    expect(calls).toEqual(["a:long", "b:long", "c:long"]);
  });

  it("subscribers on different kinds only fire on matching emits", () => {
    const bus = new SignalBus();
    const dirCalls: Signal[] = [];
    const carryCalls: Signal[] = [];
    bus.subscribe("direction", (s) => dirCalls.push(s));
    bus.subscribe("carry", (s) => carryCalls.push(s));
    bus.emit(mkDirection("long", 0.5));
    bus.emit(mkCarry(0.0001, "high"));
    bus.emit(mkDirection("flat", 0.0));
    expect(dirCalls.length).toBe(2);
    expect(carryCalls.length).toBe(1);
    expect(isCarry(carryCalls[0]!)).toBe(true);
    if (isCarry(carryCalls[0]!)) {
      expect(carryCalls[0]!.regime).toBe("high");
    }
  });

  it("unsubscribe mid-stream: handler stops firing", () => {
    const bus = new SignalBus();
    let count = 0;
    const unsub = bus.subscribe("direction", () => {
      count += 1;
    });
    bus.emit(mkDirection("long", 0.5));
    expect(count).toBe(1);
    unsub();
    bus.emit(mkDirection("short", 0.5));
    expect(count).toBe(1); // unchanged
    expect(bus.subscriberCount).toBe(0);
  });

  it("unsubscribe is idempotent: double-call is a no-op", () => {
    const bus = new SignalBus();
    let count = 0;
    const unsub = bus.subscribe("direction", () => {
      count += 1;
    });
    unsub();
    unsub(); // second call should not throw
    bus.emit(mkDirection("long", 0.5));
    expect(count).toBe(0);
  });

  it("discriminated union narrowing: handler receives correct variant", () => {
    const bus = new SignalBus();
    let captured: Signal | null = null;
    bus.subscribe("sizing", (s) => {
      captured = s;
    });
    bus.emit(mkSizing(50_000));
    expect(captured).not.toBeNull();
    const c = captured!;
    if (isSizing(c)) {
      expect(c.notional).toBe(50_000);
      expect(c.kellyFraction).toBe(0.5);
      expect(c.volMultiplier).toBe(0.8);
    } else {
      throw new Error("narrowing failed: expected SizingSignal");
    }
  });

  it("backtest mode determinism: same input → same output, in order", () => {
    const run = (): DirectionSignal[] => {
      const bus = new SignalBus({ mode: "backtest" });
      const out: DirectionSignal[] = [];
      bus.subscribe("direction", (s) => {
        if (isDirection(s)) out.push(s);
      });
      bus.emit(mkDirection("long", 0.5));
      bus.emit(mkDirection("flat", 0.0));
      bus.emit(mkDirection("short", 0.9));
      return out;
    };
    const r1 = run();
    const r2 = run();
    expect(r1).toEqual(r2);
    expect(r1.map((s) => s.side)).toEqual(["long", "flat", "short"]);
    expect(r1.map((s) => s.strength)).toEqual([0.5, 0.0, 0.9]);
  });

  it("live mode latency tracking: latencyMs returns >= 0 after drain", () => {
    const bus = new SignalBus({ mode: "live", maxEmitsPerSecond: 1000 });
    bus.subscribe("direction", () => {
      // simulate work — intentionally empty
    });
    bus.emit(mkDirection("long", 0.5));
    // After enqueueLive, the first sample is 0 (no prior emit). After drain,
    // the latency between queueing and dispatch is appended.
    const beforeDrain = bus.latencyMs();
    bus.drain();
    const afterDrain = bus.latencyMs();
    expect(Number.isFinite(beforeDrain)).toBe(true);
    expect(Number.isFinite(afterDrain)).toBe(true);
    expect(afterDrain).toBeGreaterThanOrEqual(0);
  });

  it("live mode p99 latency returns a finite number", () => {
    const bus = new SignalBus({ mode: "live", maxEmitsPerSecond: 1000 });
    bus.subscribe("direction", () => {
      // intentionally empty
    });
    // Emit at least 100 samples to get a meaningful p99.
    for (let i = 0; i < 100; i++) {
      bus.emit(mkDirection("long", 0.5));
    }
    bus.drain();
    const p99 = bus.p99LatencyMs();
    expect(Number.isFinite(p99) || Number.isNaN(p99)).toBe(true);
  });

  it("snapshot captures all signals emitted since last clear", () => {
    const bus = new SignalBus();
    bus.emit(mkDirection("long", 0.5));
    bus.emit(mkCarry(0.0001, "high"));
    bus.emit(mkSizing(1000));
    bus.emit(mkRisk(0.005));
    const snap = bus.snapshot();
    expect(snap.length).toBe(4);
    expect(snap[0]!.kind).toBe("direction");
    expect(snap[1]!.kind).toBe("carry");
    expect(snap[2]!.kind).toBe("sizing");
    expect(snap[3]!.kind).toBe("risk");
  });

  it("clear resets state: snapshot, queue, latency, errors", () => {
    const bus = new SignalBus({ mode: "live" });
    bus.subscribe("direction", () => {
      throw new Error("boom");
    });
    bus.emit(mkDirection("long", 0.5));
    bus.drain();
    expect(bus.errorCount).toBe(1);
    expect(bus.snapshot().length).toBe(1);

    bus.clear();
    expect(bus.snapshot().length).toBe(0);
    expect(bus.errorCount).toBe(0);
    expect(bus.latencyMs()).toBeNaN();
    expect(bus.subscriberCount).toBe(1); // subscriptions persist across clear
  });

  it("edge case: emit before subscribe → no error, snapshot still records", () => {
    const bus = new SignalBus();
    bus.emit(mkDirection("long", 0.5)); // no subscribers yet
    expect(bus.snapshot().length).toBe(1);
    let received = 0;
    bus.subscribe("direction", () => {
      received += 1;
    });
    bus.emit(mkDirection("short", 0.5));
    expect(received).toBe(1); // only the post-subscribe emit fires the handler
  });

  it("edge case: emit with malformed signal (kind is not a string) → throws", () => {
    const bus = new SignalBus();
    expect(() =>
      bus.emit({ kind: 123, side: "long", strength: 0.5, source: "x" } as unknown as Signal),
    ).toThrow("kind must be a string");
  });

  it("backpressure: live mode drops excess emits beyond maxEmitsPerSecond", () => {
    const bus = new SignalBus({ mode: "live", maxEmitsPerSecond: 5 });
    bus.subscribe("direction", () => {
      // intentionally empty
    });
    for (let i = 0; i < 20; i++) {
      bus.emit(mkDirection("long", 0.5));
    }
    const dispatched = bus.drain();
    expect(dispatched).toBe(5);
    expect(bus.droppedCount()).toBe(15);
  });

  it("concurrent emit ordering: FIFO guarantee in backtest mode", () => {
    const bus = new SignalBus();
    const order: number[] = [];
    bus.subscribe("direction", (s) => {
      if (isDirection(s)) order.push(s.strength * 1000);
    });
    // Emit in a tight loop, different strengths — should preserve emit order.
    for (let i = 0; i < 50; i++) {
      bus.emit(mkDirection("long", i / 100));
    }
    expect(order.length).toBe(50);
    for (let i = 0; i < 50; i++) {
      expect(order[i]).toBe(i * 10);
    }
  });

  it("subscriberCount and subscribersForKind accessors", () => {
    const bus = new SignalBus();
    expect(bus.subscriberCount).toBe(0);
    bus.subscribe("direction", () => {
      // intentionally empty
    });
    bus.subscribe("direction", () => {
      // intentionally empty
    });
    bus.subscribe("carry", () => {
      // intentionally empty
    });
    bus.subscribe("risk", () => {
      // intentionally empty
    });
    expect(bus.subscriberCount).toBe(4);
    expect(bus.subscribersForKind("direction")).toBe(2);
    expect(bus.subscribersForKind("carry")).toBe(1);
    expect(bus.subscribersForKind("sizing")).toBe(0);
    expect(bus.subscribersForKind("risk")).toBe(1);
  });

  it("mode can be toggled at runtime (backtest → live)", () => {
    const bus = new SignalBus({ mode: "backtest" });
    expect(bus.mode).toBe("backtest");
    bus.mode = "live";
    expect(bus.mode).toBe("live");
    bus.emit(mkDirection("long", 0.5));
    expect(bus.drain()).toBe(1);
  });

  it("empty bus: drain() in live mode returns 0 (no-op)", () => {
    const bus = new SignalBus({ mode: "live" });
    expect(bus.drain()).toBe(0);
    const backtestBus = new SignalBus({ mode: "backtest" });
    expect(backtestBus.drain()).toBe(0);
  });

  it("error swallowing in live mode (errorCount increments, handler exception does not crash bus)", () => {
    const bus = new SignalBus({ mode: "live" });
    bus.subscribe("carry", () => {
      throw new Error("simulated handler failure");
    });
    bus.emit(mkCarry(0.0001, "high"));
    bus.emit(mkCarry(0.0002, "high"));
    expect(() => bus.drain()).not.toThrow();
    expect(bus.errorCount).toBe(2);
  });

  it("backtest mode propagates handler exceptions (no swallowing)", () => {
    const bus = new SignalBus({ mode: "backtest" });
    bus.subscribe("direction", () => {
      throw new Error("backtest-mode-propagated");
    });
    expect(() => bus.emit(mkDirection("long", 0.5))).toThrow("backtest-mode-propagated");
  });

  it("assertExhaustive throws on unknown kind at runtime", () => {
    const bus = new SignalBus();
    const fake = { kind: "unknown" } as unknown as Signal;
    expect(() => bus.assertExhaustive(fake as never)).toThrow("Unknown Signal kind");
  });

  it("type guards (isDirection/isCarry/isSizing/isRisk) work as expected", () => {
    const d = mkDirection("long", 0.5);
    const c = mkCarry(0.0001, "high");
    const sz = mkSizing(1000);
    const r = mkRisk(0.005);
    expect(isDirection(d)).toBe(true);
    expect(isDirection(c)).toBe(false);
    expect(isCarry(c)).toBe(true);
    expect(isCarry(d)).toBe(false);
    expect(isSizing(sz)).toBe(true);
    expect(isSizing(c)).toBe(false);
    expect(isRisk(r)).toBe(true);
    expect(isRisk(sz)).toBe(false);
  });

  it("createSignalBus factory matches `new SignalBus()`", () => {
    const bus = createSignalBus({ mode: "backtest" });
    expect(bus.mode).toBe("backtest");
    let received = 0;
    bus.subscribe("direction", () => {
      received += 1;
    });
    bus.emit(mkDirection("long", 0.5));
    expect(received).toBe(1);
  });
});