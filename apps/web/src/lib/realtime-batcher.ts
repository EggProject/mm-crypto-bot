/**
 * apps/web/src/lib/realtime-batcher.ts
 *
 * Phase 50: `requestAnimationFrame` batching for high-frequency WS messages.
 *
 * The state-feed WS pushes ~60Hz tick messages and 1Hz bar messages. Without
 * batching, every tick would trigger a React `setState`, which would queue a
 * re-render that React would still coalesce into a single paint — but the
 * per-tick `setState` call itself does work (dispatcher overhead, the
 * state diff, the prop walking). Batching collapses N pushes within a
 * single animation frame into ONE callback invocation, which then makes a
 * single `setState` call.
 *
 * **Architecture:**
 *   - The class is pure: no React, no DOM, no I/O. The callback is the
 *     only side-effect boundary.
 *   - `requestAnimationFrame` is preferred (browser-aligned with paint),
 *     but a `setTimeout(cb, 16)` fallback is used in Node test environments
 *     where `requestAnimationFrame` is undefined.
 *   - Idempotency: a frame is scheduled at most ONCE per queueing cycle.
 *     A burst of 100 `push()` calls within the same frame produces ONE
 *     callback with 100 items.
 *   - The queue is FIFO (preserves arrival order across the batch).
 *
 * **Cross-environment support:** we read `requestAnimationFrame` from
 * `globalThis` at construction time. Tests that need synchronous
 * control can pass a `scheduler` option (similar to the ws-client's
 * scheduler injection). This keeps the production hot path lean
 * (one global lookup per constructor) while making the batcher
 * 100% unit-testable without fake-timer libraries.
 *
 * **The scheduler interface mirrors `ws-client.ts`:** `setTimeout`-like
 *  `(cb, ms) => handle` and `clearTimeout`-like `(handle) => void`.
 *  This consistency lets us reuse the test pattern from `ws-client.test.ts`.
 */

export type BatchedCallback<T> = (items: readonly T[]) => void;

export interface RealtimeBatcherScheduler {
  readonly setTimeout: (cb: () => void, ms: number) => unknown;
  readonly clearTimeout: (handle: unknown) => void;
}

export interface RealtimeBatcherOptions {
  /**
   * Override the scheduler (test-friendly). Production code uses
   * `requestAnimationFrame` with a `setTimeout` fallback. When
   * provided, the scheduler's `setTimeout` is used as the rAF
   * shim — this lets tests inject a synchronous or microtask
   * scheduler without monkey-patching the global `requestAnimationFrame`.
   */
  readonly scheduler?: RealtimeBatcherScheduler;
}

const SET_TIMEOUT_SCHEDULER: RealtimeBatcherScheduler = {
  setTimeout: (cb, ms): ReturnType<typeof setTimeout> => {
    return setTimeout(cb, ms);
  },
  clearTimeout: (h): void => {
    clearTimeout(h as ReturnType<typeof setTimeout>);
  },
};

/**
 * `RealtimeBatcher<T>` — accumulates `push(item)` calls and flushes
 * them in `requestAnimationFrame` (or a `setTimeout` fallback for
 * Node test environments without `requestAnimationFrame`).
 *
 * The callback is invoked at most once per frame with all items
 * pushed during that frame. Calling `push()` 100 times in the
 * same synchronous tick produces ONE callback with 100 items.
 *
 * `flushNow()` drains the queue synchronously and cancels any
 * pending frame. Used by tests + on hook unmount.
 */
export class RealtimeBatcher<T> {
  private readonly callback: BatchedCallback<T>;
  private readonly scheduler: RealtimeBatcherScheduler;

  private queue: T[] = [];
  private frameHandle: unknown = null;

  constructor(
    callback: BatchedCallback<T>,
    options: RealtimeBatcherOptions = {},
  ) {
    this.callback = callback;
    // If the caller provided a scheduler, use it. Otherwise build
    // the production default: prefer `requestAnimationFrame`, fall
    // back to a 16ms `setTimeout` shim for Node-shaped test envs.
    this.scheduler = options.scheduler ?? buildProductionScheduler();
  }

  /**
   * `push(item)` — enqueue one item. If a frame is not already
   * scheduled, schedule one. The frame will fire with all items
   * pushed before it.
   */
  push(item: T): void {
    this.queue.push(item);
    this.ensureFrameScheduled();
  }

  /**
   * `pushMany(items)` — enqueue many items in one call. Equivalent
   * to looping `push(item)` but avoids the per-item `frameHandle`
   * check.
   */
  pushMany(items: readonly T[]): void {
    if (items.length === 0) return;
    for (const item of items) {
      this.queue.push(item);
    }
    this.ensureFrameScheduled();
  }

  /**
   * `flushNow()` — synchronously invoke the callback with the
   * current queue, then clear the queue. Cancels any pending
   * scheduled frame. Idempotent: calling on an empty queue is
   * a no-op (the callback is NOT invoked).
   *
   * Used by:
   *   - Tests: to assert on the queue contents without waiting
   *     for a real frame.
   *   - The `useWebSocket` hook on unmount: drain any remaining
   *     ticks so the React state is consistent with the last
   *     batch the page received.
   */
  flushNow(): void {
    if (this.frameHandle !== null) {
      this.scheduler.clearTimeout(this.frameHandle);
      this.frameHandle = null;
    }
    if (shouldFlush({ frameHandle: this.frameHandle }, this.queue.length)) {
      const items = coalesceFrames(this.queue);
      this.queue = [];
      this.callback(items);
    }
  }

  /**
   * `size()` — current queue depth. For tests + observability.
   * Returns 0 after a flush.
   */
  size(): number {
    return this.queue.length;
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  /** Schedule a frame if one is not already in flight. */
  private ensureFrameScheduled(): void {
    if (this.frameHandle !== null) return;
    this.frameHandle = this.scheduler.setTimeout((): void => {
      this.frameHandle = null;
      this.flush();
    }, 16);
  }

  /** `flush()` — drain the queue, invoking the callback exactly once. */
  private flush(): void {
    if (!shouldFlush({ frameHandle: this.frameHandle }, this.queue.length)) return;
    // Move the queue to a local so a callback that pushes more items
    // starts a NEW batch (the next frame will see those new items).
    // This is the "snapshot the batch at flush time" semantics — it
    // matches the browser's natural microtask + paint ordering.
    const items = coalesceFrames(this.queue);
    this.queue = [];
    this.callback(items);
  }
}

/**
 * `buildProductionScheduler()` — return the default scheduler.
 *
 * If `requestAnimationFrame` is defined (browser / jsdom), use it —
 * `clearTimeout` is a no-op for rAF handles in browsers but harmless
 * when the rAF callback has already nulled `frameHandle`. We need
 * the rAF path because the production code wants the callback to
 * fire IN THE PAINT, not 16ms after the last push.
 *
 * If `requestAnimationFrame` is undefined (raw Node — `bun test`
 * runs in Node-shaped env), fall back to `setTimeout(cb, 16)`. This
 * approximates a 60Hz rAF cadence. Tests that need finer control
 * pass `options.scheduler`.
 *
 * The `globalThis` cast is needed because `requestAnimationFrame`
 * is a browser API not declared in the Node lib types. At runtime
 * the function is either present (browser + jsdom) or `undefined`
 * (raw Node).
 */
function buildProductionScheduler(): RealtimeBatcherScheduler {
  const raf = (
    globalThis as unknown as {
      requestAnimationFrame?: (cb: () => void) => unknown;
    }
  ).requestAnimationFrame;
  if (typeof raf === "function") {
    return {
      setTimeout: (cb): unknown => raf(cb),
      // The `clearTimeout` is a no-op for rAF handles in the
      // browser; the rAF callback nulls `frameHandle` itself
      // before running, so the "double-fire" risk is zero.
      clearTimeout: (_h): void => {
        // intentionally a no-op — see comment above
      },
    };
  }
  // Node fallback: a 16ms `setTimeout` approximates a 60Hz rAF
  // cadence. Tests that need finer control pass `options.scheduler`.
  return SET_TIMEOUT_SCHEDULER;
}

/**
 * `shouldFlush(state, queueLen)` — pure predicate that decides whether
 * the current queue should be drained. The `state` arg is the
 * batcher's relevant state (currently just `frameHandle`); the helper
 * is structured as a predicate over state + queue length so the
 * decision can be unit-tested without instantiating a
 * `RealtimeBatcher` (and so future rAF / visibility / batch-size
 * policies can extend it without rewriting the call sites).
 *
 * Phase 54D: today the rule is simply "drain if there's anything in
 * the queue". The `frameHandle` is part of the contract so callers
 * pass a post-cancel snapshot of state — the helper doesn't read
 * the handle today, but the parameter is here so the same helper
 * can grow to honor "skip if a frame is in flight" without
 * touching the call sites.
 */
export function shouldFlush(
  _state: { frameHandle: unknown },
  queueLen: number,
): boolean {
  return queueLen > 0;
}

/**
 * `coalesceFrames<T>(queue, capacity?)` — pure helper that returns
 * the items to flush, capped at `capacity` (default: the whole
 * queue). The slice is a defensive copy so the callback can mutate
 * it without corrupting the batcher's state.
 *
 * Phase 54D: `capacity` defaults to `queue.length` (i.e. "flush
 * everything queued"). The parameter is here so future policies
 * (max-batch-size, sampling) can plug in without touching the
 * call sites.
 */
export function coalesceFrames<T>(queue: T[], capacity = queue.length): T[] {
  return queue.slice(0, capacity);
}
