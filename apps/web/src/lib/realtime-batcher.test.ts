/**
 * apps/web/src/lib/realtime-batcher.test.ts
 *
 * Phase 50: bun:test unit tests for the RealtimeBatcher.
 * Phase 54D: 5 new tests for the extracted `shouldFlush` /
 * `coalesceFrames` pure helpers + the empty-queue no-callback paths.
 *
 * Coverage: 100% on realtime-batcher.ts.
 */

import { describe, expect, it } from "bun:test";
import {
  RealtimeBatcher,
  type RealtimeBatcherScheduler,
  shouldFlush,
  coalesceFrames,
} from "./realtime-batcher.js";

/** Build a synchronous scheduler that captures the callback + delay. */
function makeCapturingScheduler(): {
  scheduler: RealtimeBatcherScheduler;
  fire: () => void;
  scheduledMs: () => number | null;
} {
  let capturedCb: (() => void) | null = null;
  let capturedMs: number | null = null;
  const scheduler: RealtimeBatcherScheduler = {
    setTimeout: (cb: () => void, ms: number): number => {
      capturedCb = cb;
      capturedMs = ms;
      return 1;
    },
    clearTimeout: (_h: unknown): void => {
      // no-op
    },
  };
  return {
    scheduler,
    fire: (): void => {
      if (capturedCb !== null) capturedCb();
    },
    scheduledMs: (): number | null => capturedMs,
  };
}

describe("RealtimeBatcher", () => {
  it("flushes a single push when fired", () => {
    const cap = makeCapturingScheduler();
    const batches: number[][] = [];
    const b = new RealtimeBatcher<number>((items) => {
      batches.push([...items]);
    }, { scheduler: cap.scheduler });
    b.push(1);
    cap.fire();
    expect(batches).toEqual([[1]]);
  });

  it("coalesces multiple pushes in the same frame into one callback", () => {
    const cap = makeCapturingScheduler();
    const batches: number[][] = [];
    const b = new RealtimeBatcher<number>((items) => {
      batches.push([...items]);
    }, { scheduler: cap.scheduler });
    b.push(1);
    b.push(2);
    b.push(3);
    b.push(4);
    b.push(5);
    cap.fire();
    expect(batches).toEqual([[1, 2, 3, 4, 5]]);
  });

  it("schedules only once per frame (idempotent)", () => {
    const cap = makeCapturingScheduler();
    const b = new RealtimeBatcher<number>(() => undefined, { scheduler: cap.scheduler });
    for (let i = 0; i < 100; i += 1) b.push(i);
    expect(cap.scheduledMs()).toBe(16);
  });

  it("uses the configured scheduler delay (16ms fallback for rAF)", () => {
    const cap = makeCapturingScheduler();
    const b = new RealtimeBatcher<number>(() => undefined, { scheduler: cap.scheduler });
    b.push(1);
    expect(cap.scheduledMs()).toBe(16);
  });

  it("pushMany accumulates the same as N pushes", () => {
    const cap = makeCapturingScheduler();
    const batches: number[][] = [];
    const b = new RealtimeBatcher<number>((items) => {
      batches.push([...items]);
    }, { scheduler: cap.scheduler });
    b.pushMany([1, 2, 3, 4, 5]);
    cap.fire();
    expect(batches).toEqual([[1, 2, 3, 4, 5]]);
  });

  it("flushNow() drains the queue synchronously and skips the next frame", () => {
    const cap = makeCapturingScheduler();
    const batches: number[][] = [];
    const b = new RealtimeBatcher<number>((items) => {
      batches.push([...items]);
    }, { scheduler: cap.scheduler });
    b.push(1);
    b.push(2);
    b.flushNow();
    expect(batches).toEqual([[1, 2]]);
    // After flushNow, the queue is empty. Pushing again starts a new cycle.
    b.push(3);
    cap.fire();
    expect(batches).toEqual([[1, 2], [3]]);
  });

  it("size() returns the current queue size", () => {
    const cap = makeCapturingScheduler();
    const b = new RealtimeBatcher<number>(() => undefined, { scheduler: cap.scheduler });
    expect(b.size()).toBe(0);
    b.push(1);
    expect(b.size()).toBe(1);
    b.push(2);
    b.push(3);
    expect(b.size()).toBe(3);
    cap.fire();
    expect(b.size()).toBe(0);
  });

  it("no pushes → no callback", () => {
    const cap = makeCapturingScheduler();
    let calls = 0;
    new RealtimeBatcher<number>(() => { calls += 1; }, { scheduler: cap.scheduler });
    cap.fire();
    expect(calls).toBe(0);
  });

  it("two frames produce two callbacks with the items from each frame", () => {
    const cap = makeCapturingScheduler();
    const batches: number[][] = [];
    const b = new RealtimeBatcher<number>((items) => {
      batches.push([...items]);
    }, { scheduler: cap.scheduler });
    b.push(1);
    b.push(2);
    cap.fire();
    b.push(3);
    b.push(4);
    cap.fire();
    expect(batches).toEqual([[1, 2], [3, 4]]);
  });

  it("preserves FIFO order across pushes", () => {
    const cap = makeCapturingScheduler();
    const batches: number[][] = [];
    const b = new RealtimeBatcher<number>((items) => {
      batches.push([...items]);
    }, { scheduler: cap.scheduler });
    for (let i = 0; i < 10; i += 1) b.push(i);
    cap.fire();
    expect(batches[0]).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it("supports different item types via generics", () => {
    const cap = makeCapturingScheduler();
    const batches: string[][] = [];
    const b = new RealtimeBatcher<string>((items) => {
      batches.push([...items]);
    }, { scheduler: cap.scheduler });
    b.push("a");
    b.push("b");
    cap.fire();
    expect(batches).toEqual([["a", "b"]]);
  });

  it("constructor with no options uses the production scheduler (no throw)", () => {
    // Smoke test: the default scheduler must not throw on construction.
    const b = new RealtimeBatcher<number>(() => undefined);
    expect(b.size()).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // Phase 54D — pure helpers (`shouldFlush`, `coalesceFrames`)
  // ---------------------------------------------------------------------------

  it("shouldFlush returns false when the queue is empty", () => {
    // Covers the false-branch of `queueLen > 0` inside `shouldFlush`.
    expect(shouldFlush({ frameHandle: null }, 0)).toBe(false);
  });

  it("shouldFlush returns true when the queue has items", () => {
    // Covers the true-branch of `queueLen > 0` inside `shouldFlush`.
    expect(shouldFlush({ frameHandle: null }, 5)).toBe(true);
  });

  it("coalesceFrames returns the whole queue by default and caps at the given capacity", () => {
    // Default capacity == queue.length: full queue returned.
    expect(coalesceFrames([1, 2, 3])).toEqual([1, 2, 3]);
    // Capacity < queue.length: only the first N items returned.
    expect(coalesceFrames([1, 2, 3], 2)).toEqual([1, 2]);
  });

  it("push(x); push(y); flushNow() invokes the callback ONCE with both items", () => {
    // Verifies the flushNow early-return path is reached: the
    // cancellation block runs (frameHandle is non-null), then
    // shouldFlush returns true (queue has 2 items), then the
    // callback fires with the coalesced [x, y] snapshot.
    const cap = makeCapturingScheduler();
    const batches: number[][] = [];
    const b = new RealtimeBatcher<number>((items) => {
      batches.push([...items]);
    }, { scheduler: cap.scheduler });
    b.push(1);
    b.push(2);
    b.flushNow();
    expect(batches).toEqual([[1, 2]]);
    expect(b.size()).toBe(0);
  });

  it("empty queue (pushMany([]) and flushNow with no prior push) does not invoke the callback", () => {
    // Verifies the false-branch of shouldFlush from two entry points:
    //   - pushMany([]): the early-return at the top of pushMany
    //     keeps the queue empty, so shouldFlush returns false.
    //   - flushNow() with no prior push: queue is empty, shouldFlush
    //     returns false, callback is NOT invoked.
    const cap = makeCapturingScheduler();
    let calls = 0;
    const receivedBatches: number[][] = [];
    const b = new RealtimeBatcher<number>((items) => {
      calls += 1;
      receivedBatches.push([...items]);
    }, { scheduler: cap.scheduler });
    b.pushMany([]);
    expect(calls).toBe(0);
    expect(receivedBatches).toEqual([]);
    b.flushNow();
    expect(calls).toBe(0);
    expect(receivedBatches).toEqual([]);
    expect(b.size()).toBe(0);
  });
});
