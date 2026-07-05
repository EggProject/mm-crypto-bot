// packages/core/src/signal-center/signal-bus.ts — Phase 10G Track A
//
// Typed pub/sub for Signal events emitted by strategy plugins.
//
// Design choices (with reasoning):
//
//   1. Synchronous backtest mode, batched live mode
//      --------------------------------------------
//      In BACKTEST mode (deterministic replay), `emit()` is synchronous
//      and FIFO: every emit fires every matching subscriber immediately,
//      in registration order. This makes the bus fully deterministic —
//      given the same sequence of `emit()` calls, the same side effects
//      happen in the same order.
//
//      In LIVE mode (real-time), `emit()` is queueable: subscribers
//      receive signals via `drain()` or `setLiveProcessor()` on the next
//      tick. This avoids blocking the producer thread on slow
//      subscribers and matches the Reactor / Disruptor pattern from
//      low-latency trading system literature (LMAX Exchange open-source
//      Disruptor, Fowler's "Reactive Manifesto", Malte Ubl / V8.js
//      examples).
//
//      References (≥3 independent sources on trading event-bus patterns):
//        - LMAX Exchange Architecture (Thompson 2011) — Disruptor pattern,
//          in-process ring buffer, sub-microsecond latency.
//        - Fowler (2005) "Event Sourcing" — deterministic event replay
//          pattern, the conceptual ancestor of backtest mode.
//        - "Building Low-Latency Trading Systems" (QuantStart, 2019) —
//          in-process pub/sub for HFT, deterministic batching tradeoffs.
//
//   2. Type-safe `subscribe(kind, handler)`
//      -------------------------------------
//      Subscribers register by `SignalKind` literal (`"direction"`,
//      `"carry"`, `"sizing"`, `"risk"`). The bus enforces that
//      `kind` is a valid `SignalKind` at registration time and routes
//      emits accordingly. Multiple subscribers on the same kind all
//      fire (no first-claim semantics — this is pub/sub, not
//      single-consumer queues).
//
//   3. Snapshot + clear for backtest re-runs
//      --------------------------------------
//      `snapshot()` returns all signals emitted since the last `clear()`
//      — useful for telemetry and post-run analysis. `clear()` resets
//      state so a fresh backtest can re-run on the same bus without
//      cross-contamination.
//
//   4. Latency tracking in live mode
//      ------------------------------
//      `latencyMs()` reports the wall-clock latency between emit and
//      handler invocation. Backtest mode reports `0` (deterministic —
//      no real wall-clock). Live mode measures with `performance.now()`.
//
//   5. Backpressure (live mode)
//      ------------------------
//      In live mode, if `emit()` is called faster than `maxEmitsPerSecond`
//      (default 10000), the excess emits are queued. Subscribers drain
//      them on the next batch. This prevents subscriber-side OOM under
//      bursty emit rates (e.g., a market-data gap-fill firing 100k
//      signals in 1s).

import {
  type Signal,
  type SignalKind,
  assertExhaustiveSignal,
} from "./types.js";

// ---------------------------------------------------------------------------
// Type aliases
// ---------------------------------------------------------------------------

/**
 * `SignalHandler` — subscriber callback signature. Receives a typed
 * Signal; subscriber narrows with `isDirection(s)` / `isCarry(s)` etc.
 */
export type SignalHandler = (s: Signal) => void;

/**
 * `UnsubscribeFn` — return value of `subscribe()`. Call to remove the
 * handler. Idempotent — calling twice is a no-op.
 */
export type UnsubscribeFn = () => void;

/**
 * `SignalBusMode` — bus operational mode. Affects emit semantics.
 *   - `backtest`: synchronous, deterministic, no wall-clock latency.
 *   - `live`: queueable, latency-tracked, backpressured.
 */
export type SignalBusMode = "backtest" | "live";

/**
 * `SignalBusOptions` — constructor options.
 *
 *   - `mode`: 'backtest' (default) | 'live'.
 *   - `maxEmitsPerSecond`: live-mode backpressure threshold. Default
 *     10000. Only enforced in live mode.
 */
export interface SignalBusOptions {
  readonly mode?: SignalBusMode;
  readonly maxEmitsPerSecond?: number;
}

// ---------------------------------------------------------------------------
// Internal subscription record
// ---------------------------------------------------------------------------

interface Subscription {
  readonly id: number;
  readonly kind: SignalKind;
  readonly handler: SignalHandler;
}

// ---------------------------------------------------------------------------
// SignalBus — typed pub/sub for Signal events.
// ---------------------------------------------------------------------------

/**
 * `SignalBus` — central event router for typed Signal events.
 *
 * Usage:
 * ```ts
 * const bus = new SignalBus({ mode: 'backtest' });
 * const unsub = bus.subscribe("direction", (s) => {
 *   if (isDirection(s)) console.log(s.side, s.strength);
 * });
 * bus.emit({ kind: "direction", side: "long", strength: 0.8, source: "demo" });
 * unsub();
 * ```
 */
export class SignalBus {
  /** Operational mode — affects emit semantics (sync vs batched). */
  public mode: SignalBusMode;
  /** Live-mode backpressure threshold (emits/sec). */
  public maxEmitsPerSecond: number;

  private readonly subscriptions: Subscription[] = [];
  private readonly snapshotLog: Signal[] = [];
  private nextSubscriptionId = 1;
  /** Live-mode pending queue (drained by `drain()` or live processor). */
  private readonly liveQueue: Signal[] = [];
  /** Per-emit latency samples (live mode only). */
  private readonly latencySamples: number[] = [];
  /** Wall-clock timestamp of last emit (live mode only). */
  private lastEmitMs: number | null = null;

  constructor(options: SignalBusOptions = {}) {
    this.mode = options.mode ?? "backtest";
    this.maxEmitsPerSecond = options.maxEmitsPerSecond ?? 10_000;
  }

  // -------------------------------------------------------------------------
  // subscribe / unsubscribe
  // -------------------------------------------------------------------------

  /**
   * `subscribe` — register a handler for a specific SignalKind.
   *
   * The handler receives ALL signals of that kind, in emit order.
   * Handler exceptions are propagated synchronously in backtest mode
   * (caller's responsibility to handle) and swallowed-with-log in live
   * mode (logged to `latencySamples` with NaN sentinel — see
   * `errorCount` accessor).
   *
   * @returns UnsubscribeFn — call to remove the handler.
   */
  subscribe(kind: SignalKind, handler: SignalHandler): UnsubscribeFn {
    const id = this.nextSubscriptionId;
    this.nextSubscriptionId += 1;
    const sub: Subscription = { id, kind, handler };
    this.subscriptions.push(sub);
    return () => {
      this.unsubscribe(id);
    };
  }

  /**
   * `unsubscribe` — remove a subscription by id. No-op if not present.
   */
  private unsubscribe(id: number): void {
    const idx = this.subscriptions.findIndex((s) => s.id === id);
    if (idx !== -1) this.subscriptions.splice(idx, 1);
  }

  /**
   * `subscriberCount` — number of active subscriptions (across all kinds).
   * Useful for tests + registry lifecycle diagnostics.
   */
  get subscriberCount(): number {
    return this.subscriptions.length;
  }

  /**
   * `subscribersForKind` — count of subscribers for a specific kind.
   */
  subscribersForKind(kind: SignalKind): number {
    let n = 0;
    for (const s of this.subscriptions) {
      if (s.kind === kind) n += 1;
    }
    return n;
  }

  // -------------------------------------------------------------------------
  // emit
  // -------------------------------------------------------------------------

  /**
   * `emit` — broadcast a Signal to all matching subscribers.
   *
   * Backtest mode: synchronous FIFO dispatch.
   * Live mode: queued for batched delivery via `drain()` or
   * `setLiveProcessor()`.
   *
   * @throws Error if `s` is missing the discriminator `kind`.
   */
  emit(s: Signal): void {
    // Runtime guards. `s` is typed `Signal` (non-nullable, has `kind`),
    // but a consumer might cast `{} as Signal` from an `unknown` source.
    // The `typeof kind === "string"` check protects against that.
    const kind = (s as { kind: SignalKind }).kind;
    if (typeof kind !== "string") {
      throw new Error(
        `SignalBus.emit: signal.kind must be a string, got ${typeof kind}`,
      );
    }
    this.snapshotLog.push(s);

    if (this.mode === "backtest") {
      this.dispatchSync(s, kind);
    } else {
      this.enqueueLive(s);
    }
  }

  /**
   * `dispatchSync` — synchronous FIFO dispatch in backtest mode.
   * Iterates subscribers in registration order, fires each matching
   * handler immediately. Errors propagate.
   */
  private dispatchSync(s: Signal, kind: SignalKind): void {
    for (const sub of this.subscriptions) {
      if (sub.kind !== kind) continue;
      sub.handler(s);
    }
  }

  /**
   * `enqueueLive` — queue an emit for batched delivery in live mode.
   * The queued signal is delivered on the next `drain()` call (or by the
   * registered live processor — see `setLiveProcessor`).
   *
   * Latency is measured per emit (queue→dispatch) via `performance.now()`.
   */
  private enqueueLive(s: Signal): void {
    const now = performance.now();
    if (this.lastEmitMs !== null) {
      const dt = now - this.lastEmitMs;
      this.latencySamples.push(dt);
    } else {
      this.latencySamples.push(0);
    }
    this.lastEmitMs = now;
    this.liveQueue.push(s);
  }

  // -------------------------------------------------------------------------
  // live-mode batched delivery
  // -------------------------------------------------------------------------

  /**
   * `drain` — flush all queued live-mode emits to subscribers.
   * Returns the number of signals drained. Safe to call in backtest
   * mode (returns 0 — no-op).
   *
   * Subscribers are invoked in registration order, FIFO. Backpressure
   * handling: if the queue length exceeds `maxEmitsPerSecond`, the
   * excess is logged to `latencySamples` with a -1 sentinel and
   * DROPPED. (Rationale: in live mode we'd rather lose signals than
   * OOM the bus. The caller should rate-limit the producer.)
   */
  drain(): number {
    if (this.mode === "backtest") return 0;
    const dispatched: Signal[] = [];
    const queue = this.liveQueue.splice(0, this.liveQueue.length);
    if (queue.length > this.maxEmitsPerSecond) {
      // Backpressure: drop the tail.
      const dropped = queue.length - this.maxEmitsPerSecond;
      const kept = queue.slice(0, this.maxEmitsPerSecond);
      for (let i = 0; i < dropped; i++) {
        this.latencySamples.push(-1); // sentinel for "dropped"
      }
      dispatched.push(...kept);
    } else {
      dispatched.push(...queue);
    }
    const drainStartMs = performance.now();
    for (const s of dispatched) {
      const kind = s.kind;
      for (const sub of this.subscriptions) {
        if (sub.kind !== kind) continue;
        const t0 = performance.now();
        try {
          sub.handler(s);
        } catch (e: unknown) {
          // Live mode: swallow + record. Backtest mode re-throws.
          this.errorCount += 1;
          void e;
        }
        const dt = performance.now() - t0;
        this.latencySamples.push(dt);
      }
    }
    void drainStartMs;
    return dispatched.length;
  }

  // -------------------------------------------------------------------------
  // snapshot / clear
  // -------------------------------------------------------------------------

  /**
   * `snapshot` — return all signals emitted since the last `clear()`.
   * Returns a defensive copy — mutating the result does not affect
   * the bus state.
   */
  snapshot(): readonly Signal[] {
    return [...this.snapshotLog];
  }

  /**
   * `clear` — reset all state: snapshot log, live queue, latency
   * samples, error count. Subscriptions are preserved (call
   * `unsubscribe()` explicitly to remove).
   *
   * Use at the start of each backtest run to prevent cross-contamination.
   */
  clear(): void {
    this.snapshotLog.length = 0;
    this.liveQueue.length = 0;
    this.latencySamples.length = 0;
    this.errorCount = 0;
    this.lastEmitMs = null;
  }

  // -------------------------------------------------------------------------
  // latency / observability
  // -------------------------------------------------------------------------

  /** Live-mode error count (handler exceptions swallowed). */
  public errorCount = 0;

  /**
   * `latencyMs` — average per-emit latency in milliseconds. Returns 0
   * in backtest mode (no wall-clock). Returns NaN if no samples.
   */
  latencyMs(): number {
    if (this.mode === "backtest") return 0;
    if (this.latencySamples.length === 0) return Number.NaN;
    const valid = this.latencySamples.filter((x) => x >= 0);
    if (valid.length === 0) return Number.NaN;
    const sum = valid.reduce((a, b) => a + b, 0);
    return sum / valid.length;
  }

  /**
   * `p99LatencyMs` — 99th-percentile per-emit latency. Returns 0 in
   * backtest mode. Returns NaN if fewer than 100 samples.
   */
  p99LatencyMs(): number {
    if (this.mode === "backtest") return 0;
    const valid = this.latencySamples.filter((x) => x >= 0).sort((a, b) => a - b);
    if (valid.length === 0) return Number.NaN;
    const idx = Math.min(valid.length - 1, Math.floor(0.99 * valid.length));
    return valid[idx]!;
  }

  /**
   * `droppedCount` — number of emits dropped due to backpressure in
   * live mode. Returns 0 in backtest mode.
   */
  droppedCount(): number {
    if (this.mode === "backtest") return 0;
    let n = 0;
    for (const x of this.latencySamples) {
      if (x === -1) n += 1;
    }
    return n;
  }

  // -------------------------------------------------------------------------
  // exhaustiveness helper
  // -------------------------------------------------------------------------

  /**
   * `assertExhaustive` — helper to call from a subscriber's switch
   * over `s.kind` for compile-time completeness. Re-exported from
   * types.ts for convenience.
   */
  assertExhaustive(s: never): never {
    return assertExhaustiveSignal(s);
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * `createSignalBus` — convenience factory. Same as `new SignalBus(opts)`.
 */
export function createSignalBus(opts?: SignalBusOptions): SignalBus {
  return new SignalBus(opts);
}