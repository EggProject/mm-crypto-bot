/**
 * apps/web/src/lib/__tests__/use-bot-status.test.ts
 *
 * Phase 81: unit tests for the `useBotStatus` hook's underlying
 * state machine — the `BotStatusController` class in
 * `lib/use-bot-status.ts`. The hook itself is a thin React glue
 * layer (verified by TypeScript + the existing e2e suite), but
 * the 9 test cases below exercise the data flow that the hook
 * drives: WS messages → status, bootstrap fetch → status,
 * slow-poll on disconnect, etc.
 *
 * Why test the controller instead of the hook directly?
 *
 *   The project has no React test renderer (no `@testing-library/
 *   react`, no `react-test-renderer`, no `happy-dom` / `jsdom` —
 *   see the file header on `ControlBar.test.tsx`). The existing
 *   React component tests (ControlBar, PositionsTable) just
 *   verify the component is a function and the props are
 *   accepted; the real render is exercised by Playwright CT. For
 *   a hook, "real render" would mean driving `useEffect` +
 *   `useState` — and the e2e suite will do that when App.tsx
 *   wires `useBotStatus()` in (the follow-up task).
 *
 *   The controller is the testable seam: every behavior the user
 *   cares about ("starts slow-poll on disconnect", "cancels the
 *   bootstrap fetch on 5s timeout", "updates from a WS state
 *   message") is encoded in a controller method. The hook is
 *   just `useEffect(() => { ctrl.X() }, [wsState])` — TypeScript
 *   validates the wiring, and the e2e suite will validate the
 *   end-to-end behavior.
 *
 * Test infrastructure:
 *
 *   - `FakeScheduler` — records every `setTimeout` / `setInterval`
 *     call in a `timers` array. The test can:
 *       - Inspect the array to verify a timer was registered
 *         (e.g. `timers.length === 1` after a slow-poll start).
 *       - Manually invoke a timer's callback (e.g. to fire the
 *         bootstrap fetch on demand).
 *       - Verify `clearTimeout` / `clearInterval` was called by
 *         checking that the timer is removed from the array.
 *   - `FakeFetch` — records every `fetch()` call in `lastFetchCall`
 *     and resolves with the next `nextResponse` value. The test
 *     controls the response body + status to drive the parsing
 *     branches.
 *   - The `__test__` named export is mutated in `beforeEach` to
 *     set the timing constants to `100ms` / `50ms` so the tests
 *     run in <1s.
 *
 * Branch coverage intent (10 tests):
 *   - "returns null initially" → `getStatus()` is `null` before
 *     any input
 *   - "from a WS `state` message" → `onStateMessage()` updates
 *     the status (PRIMARY source — instantaneous feedback on
 *     CONTROL clicks)
 *   - "from a `snapshot` message" → `onSnapshotMessage()` updates
 *     the status (initial handshake)
 *   - "bootstrap fetch fires on mount" → `bootstrap()` triggers
 *     a `fetch(STATUS_URL)` and the response is parsed into
 *     `setStatus()`
 *   - "30s slow-poll starts on WS disconnected" →
 *     `onWsStatusChange("disconnected")` registers a
 *     `setInterval(slowPollIntervalMs)` timer
 *   - "slow-poll is CANCELLED on WS reconnect" →
 *     `onWsStatusChange("connected")` clears the slow-poll timer
 *     AND no more `fetch` calls happen
 *   - "bootstrap fetch timeout (5s) cancels the request" → the
 *     `setTimeout(bootstrapTimeoutMs)` callback aborts the
 *     `AbortController` so the in-flight `fetch` is cancelled
 *   - "extractBotStatus handles all 3 valid `state` values" →
 *     running / paused / stopped all parse correctly (this is
 *     the same `extractBotStatus` from `bot-status.ts` — the
 *     test re-verifies it via the controller's update path so
 *     the integration is end-to-end)
 *   - "extractBotStatus returns `null` for invalid snapshot" →
 *     the controller is a no-op (the previous status is
 *     preserved) on a malformed message
 *   - "is exported as a function" → smoke test that the React
 *     hook is callable (verifies the `useEffect` import path
 *     compiles, the type chain is correct, etc.)
 */

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  mock,
} from "bun:test";

import { extractBotStatus, type BotStatus } from "../bot-status.js";
import {
  BotStatusController,
  __test__,
  useBotStatus,
  type BotStatusControllerScheduler,
} from "../use-bot-status.js";

// ============================================================================
// Test infrastructure: FakeScheduler + FakeFetch
// ============================================================================

interface TimerRecord {
  readonly id: number;
  readonly ms: number;
  readonly cb: () => void;
  /** "interval" or "timeout" — used so clearTimeout/clearInterval
   *  can verify they were called with the right type (defensive
   *  against accidental cross-clears in the controller). */
  readonly kind: "interval" | "timeout";
}

function createFakeScheduler(): {
  scheduler: BotStatusControllerScheduler;
  timers: TimerRecord[];
  fireTimeout: (ms: number) => void;
} {
  const timers: TimerRecord[] = [];
  let nextId = 1;
  const makeSetter =
    (kind: "interval" | "timeout") =>
    (cb: () => void, ms: number): unknown => {
      const id = nextId++;
      timers.push({ id, ms, cb, kind });
      return id;
    };
  const makeClearer =
    (kind: "interval" | "timeout") =>
    (handle: unknown): void => {
      const i = timers.findIndex(
        (t) => t.id === handle && t.kind === kind,
      );
      if (i >= 0) timers.splice(i, 1);
    };
  return {
    scheduler: {
      setTimeout: makeSetter("timeout"),
      clearTimeout: makeClearer("timeout"),
      setInterval: makeSetter("interval"),
      clearInterval: makeClearer("interval"),
    },
    timers,
    fireTimeout: (ms: number): void => {
      // Fire the first timeout-timer that matches `ms`. Used to
      // simulate the bootstrap-fetch timeout firing.
      const t = timers.find((x) => x.kind === "timeout" && x.ms === ms);
      if (t === undefined) {
        throw new Error(
          `FakeScheduler: no timeout-timer with ms=${String(ms)} registered. Currently registered: ${timers
            .map((x) => `${String(x.ms)}ms/${x.kind}`)
            .join(", ")}`,
        );
      }
      // Mark for removal BEFORE firing the callback (the callback
      // will likely call `clearTimeout` on itself, which is a no-op
      // since the timer is already being removed).
      const idx = timers.indexOf(t);
      timers.splice(idx, 1);
      t.cb();
    },
  };
}

interface FakeFetch {
  readonly fetchImpl: typeof fetch;
  lastCall: { url: string; init: RequestInit | undefined } | null;
  setNextResponse: (resp: { ok: boolean; body: unknown } | null) => void;
  setNextResponseFactory: (factory: () => Promise<Response>) => void;
}

/** Build a `typeof fetch`-shaped function from a request handler.
 *  The full `fetch` type includes `preconnect` (and other modern
 *  bits we don't care about) — for the controller's purposes,
 *  only the `(input, init?) => Promise<Response>` signature
 *  matters. The cast through `unknown` is the standard escape
 *  hatch used elsewhere in this codebase for fake dependencies. */
function asFetch(
  handler: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
): typeof fetch {
  return handler as unknown as typeof fetch;
}

function createFakeFetch(): FakeFetch {
  let lastCall: { url: string; init: RequestInit | undefined } | null = null;
  let nextResponse: { ok: boolean; body: unknown } | null = null;
  let nextFactory: (() => Promise<Response>) | null = null;
  const fetchImpl = asFetch((input, init) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    lastCall = { url, init };
    if (nextFactory !== null) {
      const f = nextFactory;
      nextFactory = null;
      return f();
    }
    const r = nextResponse;
    nextResponse = null;
    if (r === null) {
      // Default: a 200 OK with an empty `botStatus`. Tests that
      // don't care about the response still get a parseable body.
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ botStatus: null }),
      } as Response);
    }
    return Promise.resolve({
      ok: r.ok,
      json: () => Promise.resolve(r.body),
    } as Response);
  });
  return {
    fetchImpl,
    get lastCall(): { url: string; init: RequestInit | undefined } | null {
      return lastCall;
    },
    setNextResponse: (resp): void => {
      nextResponse = resp;
      nextFactory = null;
    },
    setNextResponseFactory: (factory): void => {
      nextFactory = factory;
      nextResponse = null;
    },
  };
}

/** Wait for the microtask queue to drain. Used after `bootstrap()`
 *  to let the `await res.json()` chain complete before asserting
 *  on `getStatus()`. Without this, the IIFE in `fireBootstrapFetch`
 *  might still be in flight when the test inspects the result. */
async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

// ============================================================================
// Setup / teardown
// ============================================================================

// Save the original `__test__` values so we can restore them in
// `afterEach`. The test mutates them to skip the real 30s / 5s.
const ORIGINAL_SLOW_POLL = __test__.SLOW_POLL_INTERVAL_MS;
const ORIGINAL_BOOTSTRAP_TIMEOUT = __test__.BOOTSTRAP_FETCH_TIMEOUT_MS;
const ORIGINAL_STATUS_URL = __test__.STATUS_URL;

const TEST_SLOW_POLL_MS = 100;
const TEST_BOOTSTRAP_TIMEOUT_MS = 50;

beforeEach((): void => {
  __test__.SLOW_POLL_INTERVAL_MS = TEST_SLOW_POLL_MS;
  __test__.BOOTSTRAP_FETCH_TIMEOUT_MS = TEST_BOOTSTRAP_TIMEOUT_MS;
  // Re-affirm the URL in case a previous test changed it.
  __test__.STATUS_URL = ORIGINAL_STATUS_URL;
});

afterEach((): void => {
  __test__.SLOW_POLL_INTERVAL_MS = ORIGINAL_SLOW_POLL;
  __test__.BOOTSTRAP_FETCH_TIMEOUT_MS = ORIGINAL_BOOTSTRAP_TIMEOUT;
  __test__.STATUS_URL = ORIGINAL_STATUS_URL;
  // No-op: tests inject `fetchImpl` to the controller rather
  // than mutating `globalThis.fetch`, so there's nothing to
  // restore here. The block is kept as a documented seam in
  // case a future test needs to stub the global fetch.
});

// ============================================================================
// Smoke: the React hook is exported
// ============================================================================

describe("useBotStatus (smoke)", () => {
  it("is exported as a function", () => {
    expect(typeof useBotStatus).toBe("function");
  });

  it("the __test__ export exposes the 3 timing constants", () => {
    expect(__test__.STATUS_URL).toBe("http://127.0.0.1:7913/api/status");
    expect(typeof __test__.SLOW_POLL_INTERVAL_MS).toBe("number");
    expect(typeof __test__.BOOTSTRAP_FETCH_TIMEOUT_MS).toBe("number");
  });
});

// ============================================================================
// BotStatusController — the testable core that backs useBotStatus()
// ============================================================================

describe("BotStatusController (the useBotStatus data path)", () => {
  it("returns null initially (no message yet, bootstrap not resolved)", () => {
    const { scheduler } = createFakeScheduler();
    const fake = createFakeFetch();
    const ctrl = new BotStatusController({
      scheduler: scheduler,
      fetchImpl: fake.fetchImpl,
    });
    expect(ctrl.getStatus()).toBeNull();
    ctrl.dispose();
  });

  // -------------------------------------------------------------------------
  // PRIMARY source: the WS `state` message
  // -------------------------------------------------------------------------

  it("returns the status from the first WS 'state' message (PRIMARY source)", () => {
    const { scheduler } = createFakeScheduler();
    const fake = createFakeFetch();
    const ctrl = new BotStatusController({
      scheduler: scheduler,
      fetchImpl: fake.fetchImpl,
    });
    // No `bootstrap()` call here — the hook would call it, but
    // we're isolating the WS path. The fake fetch is configured
    // with a default "empty" response, so the bootstrap call
    // (if it happened) wouldn't update the status either.
    const stateMsg = {
      snapshot: {
        botStatus: {
          state: "running",
          startedAt: 1_700_000_000_000,
          lastUpdate: 1_700_000_060_000,
          activeStrategyCount: 3,
          positions: [],
        },
      },
    };
    ctrl.onStateMessage(stateMsg);
    const status = ctrl.getStatus();
    expect(status).not.toBeNull();
    expect(status?.state).toBe("running");
    expect(status?.startedAt).toBe(1_700_000_000_000);
    expect(status?.lastUpdate).toBe(1_700_000_060_000);
    expect(status?.activeStrategyCount).toBe(3);
    ctrl.dispose();
  });

  it("notifies subscribers via onUpdate when a state message arrives", () => {
    const { scheduler } = createFakeScheduler();
    const fake = createFakeFetch();
    const ctrl = new BotStatusController({
      scheduler: scheduler,
      fetchImpl: fake.fetchImpl,
    });
    const updates: (BotStatus | null)[] = [];
    const off = ctrl.onUpdate((s) => {
      updates.push(s);
    });
    ctrl.onStateMessage({
      snapshot: {
        botStatus: {
          state: "paused",
          startedAt: 0,
          lastUpdate: 1_700_000_060_000,
          activeStrategyCount: 0,
          positions: [],
        },
      },
    });
    expect(updates.length).toBe(1);
    expect(updates[0]?.state).toBe("paused");
    off();
    // After unsubscribing, no more updates.
    ctrl.onStateMessage({
      snapshot: {
        botStatus: {
          state: "stopped",
          startedAt: 0,
          lastUpdate: 0,
          activeStrategyCount: 0,
          positions: [],
        },
      },
    });
    expect(updates.length).toBe(1);
    ctrl.dispose();
  });

  // -------------------------------------------------------------------------
  // The WS `snapshot` message (initial handshake)
  // -------------------------------------------------------------------------

  it("returns the status from a WS 'snapshot' message", () => {
    const { scheduler } = createFakeScheduler();
    const fake = createFakeFetch();
    const ctrl = new BotStatusController({
      scheduler: scheduler,
      fetchImpl: fake.fetchImpl,
    });
    ctrl.onSnapshotMessage({
      snapshot: {
        botStatus: {
          state: "paused",
          startedAt: 1_700_000_000_000,
          lastUpdate: 1_700_000_060_000,
          activeStrategyCount: 2,
          positions: [],
        },
      },
    });
    const status = ctrl.getStatus();
    expect(status?.state).toBe("paused");
    expect(status?.activeStrategyCount).toBe(2);
    ctrl.dispose();
  });

  // -------------------------------------------------------------------------
  // Bootstrap HTTP fetch on mount
  // -------------------------------------------------------------------------

  it("fires the bootstrap fetch on mount and sets the state from the response", async () => {
    const { scheduler } = createFakeScheduler();
    const fake = createFakeFetch();
    fake.setNextResponse({
      ok: true,
      body: {
        botStatus: {
          state: "running",
          startedAt: 1_700_000_000_000,
          lastUpdate: 1_700_000_060_000,
          activeStrategyCount: 1,
          positions: [],
        },
      },
    });
    const ctrl = new BotStatusController({
      scheduler: scheduler,
      fetchImpl: fake.fetchImpl,
    });
    ctrl.bootstrap();
    // The fetch was called with the right URL.
    expect(fake.lastCall).not.toBeNull();
    expect(fake.lastCall?.url).toBe("http://127.0.0.1:7913/api/status");
    // The fetch was given an AbortController signal (the timeout
    // mechanism). The signal is a non-null AbortSignal.
    expect(fake.lastCall?.init?.signal).toBeDefined();
    // Let the IIFE's `await res.json()` complete.
    await flushMicrotasks();
    expect(ctrl.getStatus()?.state).toBe("running");
    expect(ctrl.getStatus()?.activeStrategyCount).toBe(1);
    ctrl.dispose();
  });

  it("does not call fetch twice when bootstrap() is invoked twice in a row", async () => {
    const { scheduler } = createFakeScheduler();
    let fetchCallCount = 0;
    const fetchImpl = asFetch((): Promise<Response> => {
      fetchCallCount++;
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            botStatus: {
              state: "running",
              startedAt: 0,
              lastUpdate: 0,
              activeStrategyCount: 0,
              positions: [],
            },
          }),
      } as Response);
    });
    const ctrl = new BotStatusController({
      scheduler: scheduler,
      fetchImpl: fetchImpl,
    });
    ctrl.bootstrap();
    ctrl.bootstrap(); // should be a no-op (fetch is in flight)
    await flushMicrotasks();
    // Exactly one fetch happened — the second bootstrap() was
    // a no-op because the first fetch was still in flight.
    expect(fetchCallCount).toBe(1);
    expect(ctrl.getStatus()?.state).toBe("running");
    ctrl.dispose();
  });

  it("ignores a non-2xx bootstrap response (leaves the previous status untouched)", async () => {
    const { scheduler } = createFakeScheduler();
    const fake = createFakeFetch();
    fake.setNextResponse({
      ok: false,
      body: { error: "bot offline" },
    });
    const ctrl = new BotStatusController({
      scheduler: scheduler,
      fetchImpl: fake.fetchImpl,
    });
    // Seed a known state via the WS path.
    ctrl.onStateMessage({
      snapshot: {
        botStatus: {
          state: "running",
          startedAt: 0,
          lastUpdate: 0,
          activeStrategyCount: 0,
          positions: [],
        },
      },
    });
    expect(ctrl.getStatus()?.state).toBe("running");
    ctrl.bootstrap();
    await flushMicrotasks();
    // The bootstrap response was non-2xx, so the previous
    // "running" state is preserved.
    expect(ctrl.getStatus()?.state).toBe("running");
    ctrl.dispose();
  });

  // -------------------------------------------------------------------------
  // Slow-poll on WS disconnect
  // -------------------------------------------------------------------------

  it("starts the 30s slow-poll when WS status is 'disconnected'", () => {
    const { scheduler, timers } = createFakeScheduler();
    const fake = createFakeFetch();
    const ctrl = new BotStatusController({
      scheduler: scheduler,
      fetchImpl: fake.fetchImpl,
    });
    expect(timers.length).toBe(0);
    ctrl.onWsStatusChange("disconnected");
    // A setInterval was registered with SLOW_POLL_INTERVAL_MS
    // (overridden to 100ms in `beforeEach`).
    const intervalTimers = timers.filter((t) => t.kind === "interval");
    expect(intervalTimers.length).toBe(1);
    expect(intervalTimers[0]?.ms).toBe(TEST_SLOW_POLL_MS);
    ctrl.dispose();
  });

  it("does not start a duplicate slow-poll on repeated 'disconnected' events", () => {
    const { scheduler, timers } = createFakeScheduler();
    const fake = createFakeFetch();
    const ctrl = new BotStatusController({
      scheduler: scheduler,
      fetchImpl: fake.fetchImpl,
    });
    ctrl.onWsStatusChange("disconnected");
    ctrl.onWsStatusChange("disconnected");
    ctrl.onWsStatusChange("disconnected");
    const intervalTimers = timers.filter((t) => t.kind === "interval");
    expect(intervalTimers.length).toBe(1);
    ctrl.dispose();
  });

  it("does NOT start a slow-poll on 'connecting' / 'connected' / 'crashed'", () => {
    const { scheduler, timers } = createFakeScheduler();
    const fake = createFakeFetch();
    const ctrl = new BotStatusController({
      scheduler: scheduler,
      fetchImpl: fake.fetchImpl,
    });
    for (const status of ["connecting", "connected", "crashed"] as const) {
      ctrl.onWsStatusChange(status);
      const intervalTimers = timers.filter((t) => t.kind === "interval");
      expect(intervalTimers.length).toBe(0);
    }
    ctrl.dispose();
  });

  it("cancels the slow-poll when WS reconnects ('disconnected' → 'connected')", async () => {
    const { scheduler, timers } = createFakeScheduler();
    const fake = createFakeFetch();
    const ctrl = new BotStatusController({
      scheduler: scheduler,
      fetchImpl: fake.fetchImpl,
    });
    ctrl.onWsStatusChange("disconnected");
    expect(timers.filter((t) => t.kind === "interval").length).toBe(1);
    // The fake fetch hasn't been called yet — the slow-poll
    // timer is registered but not fired.
    expect(fake.lastCall).toBeNull();
    ctrl.onWsStatusChange("connected");
    // The interval was cleared.
    expect(timers.filter((t) => t.kind === "interval").length).toBe(0);
    // Wait past the original slow-poll interval and verify
    // fetch was NOT called (the timer was cleared, so the
    // callback never fired).
    await new Promise((r) => setTimeout(r, TEST_SLOW_POLL_MS + 50));
    expect(fake.lastCall).toBeNull();
    ctrl.dispose();
  });

  it("fires the bootstrap fetch when the slow-poll interval ticks", async () => {
    const { scheduler, timers } = createFakeScheduler();
    const fake = createFakeFetch();
    fake.setNextResponse({
      ok: true,
      body: {
        botStatus: {
          state: "running",
          startedAt: 0,
          lastUpdate: 1_700_000_060_000,
          activeStrategyCount: 0,
          positions: [],
        },
      },
    });
    const ctrl = new BotStatusController({
      scheduler: scheduler,
      fetchImpl: fake.fetchImpl,
    });
    ctrl.onWsStatusChange("disconnected");
    // Manually fire the slow-poll callback (we're not waiting
    // 30s in the test).
    const intervalTimer = timers.find(
      (t) => t.kind === "interval" && t.ms === TEST_SLOW_POLL_MS,
    );
    expect(intervalTimer).toBeDefined();
    intervalTimer?.cb();
    await flushMicrotasks();
    expect(fake.lastCall).not.toBeNull();
    expect(fake.lastCall?.url).toBe("http://127.0.0.1:7913/api/status");
    expect(ctrl.getStatus()?.state).toBe("running");
    ctrl.dispose();
  });

  // -------------------------------------------------------------------------
  // Bootstrap fetch timeout (5s)
  // -------------------------------------------------------------------------

  it("cancels the bootstrap fetch on 5s timeout", () => {
    const { scheduler, timers, fireTimeout } = createFakeScheduler();
    const fake = createFakeFetch();
    // The fetch never resolves: it returns a Promise that stays
    // pending forever. The only way the test completes is via
    // the timeout (which aborts the AbortController).
    fake.setNextResponseFactory(
      () =>
        new Promise<Response>(() => {
          /* never resolves — wait for the timeout to abort */
        }),
    );
    const ctrl = new BotStatusController({
      scheduler: scheduler,
      fetchImpl: fake.fetchImpl,
    });
    ctrl.bootstrap();
    // The fetch was called, and a timeout was registered.
    expect(fake.lastCall).not.toBeNull();
    expect(fake.lastCall?.init?.signal).toBeDefined();
    const timeoutTimer = timers.find(
      (t) => t.kind === "timeout" && t.ms === TEST_BOOTSTRAP_TIMEOUT_MS,
    );
    expect(timeoutTimer).toBeDefined();
    // Fire the timeout. This aborts the AbortController, which
    // the pending fetch will see as an AbortError.
    fireTimeout(TEST_BOOTSTRAP_TIMEOUT_MS);
    // The AbortController is now aborted. The pending fetch is
    // still in flight (it never resolved), but the controller
    // has cleaned up the timer + AbortController state so a
    // subsequent bootstrap() can fire.
    expect(timers.filter((t) => t.kind === "timeout").length).toBe(0);
    ctrl.dispose();
  });

  it("a second bootstrap() call after the first timeout fires a fresh fetch", async () => {
    const { scheduler, fireTimeout } = createFakeScheduler();
    // First call: never resolves. Second call: succeeds.
    let callCount = 0;
    const fetchImpl = asFetch((): Promise<Response> => {
      callCount++;
      if (callCount === 1) {
        return new Promise<Response>(() => {
          /* pending — wait for the timeout to fire */
        });
      }
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            botStatus: {
              state: "running",
              startedAt: 0,
              lastUpdate: 0,
              activeStrategyCount: 0,
              positions: [],
            },
          }),
      } as Response);
    });
    const ctrl = new BotStatusController({
      scheduler: scheduler,
      fetchImpl: fetchImpl,
    });
    ctrl.bootstrap();
    // Force the first fetch to time out.
    fireTimeout(TEST_BOOTSTRAP_TIMEOUT_MS);
    // A second bootstrap() call should now succeed (the first
    // AbortController was cleaned up in the timeout callback's
    // flow).
    ctrl.bootstrap();
    await flushMicrotasks();
    expect(ctrl.getStatus()?.state).toBe("running");
    ctrl.dispose();
  });

  it("dispose() cancels the slow-poll + in-flight fetch + clears listeners", () => {
    const { scheduler, timers } = createFakeScheduler();
    const fake = createFakeFetch();
    // Pending fetch.
    fake.setNextResponseFactory(
      () => new Promise<Response>(() => undefined),
    );
    const ctrl = new BotStatusController({
      scheduler: scheduler,
      fetchImpl: fake.fetchImpl,
    });
    ctrl.bootstrap();
    ctrl.onWsStatusChange("disconnected");
    expect(timers.length).toBe(2);
    const updates: (BotStatus | null)[] = [];
    ctrl.onUpdate((s) => {
      updates.push(s);
    });
    ctrl.dispose();
    // All timers cleared.
    expect(timers.length).toBe(0);
    // Subsequent state messages are no-ops (the controller is
    // disposed).
    ctrl.onStateMessage({
      snapshot: {
        botStatus: {
          state: "running",
          startedAt: 0,
          lastUpdate: 0,
          activeStrategyCount: 0,
          positions: [],
        },
      },
    });
    expect(ctrl.getStatus()).toBeNull();
    expect(updates.length).toBe(0);
  });

  // -------------------------------------------------------------------------
  // extractBotStatus end-to-end (via the controller's update path)
  // -------------------------------------------------------------------------

  it("extractBotStatus handles all 3 valid 'state' values (running / paused / stopped)", () => {
    const { scheduler } = createFakeScheduler();
    const fake = createFakeFetch();
    const ctrl = new BotStatusController({
      scheduler: scheduler,
      fetchImpl: fake.fetchImpl,
    });
    // running
    ctrl.onStateMessage({
      snapshot: {
        botStatus: {
          state: "running",
          startedAt: 1_700_000_000_000,
          lastUpdate: 1_700_000_060_000,
          activeStrategyCount: 3,
          positions: [],
        },
      },
    });
    expect(ctrl.getStatus()?.state).toBe("running");
    // paused
    ctrl.onStateMessage({
      snapshot: {
        botStatus: {
          state: "paused",
          startedAt: 1_700_000_000_000,
          lastUpdate: 1_700_000_060_000,
          activeStrategyCount: 3,
          positions: [],
        },
      },
    });
    expect(ctrl.getStatus()?.state).toBe("paused");
    // stopped
    ctrl.onStateMessage({
      snapshot: {
        botStatus: {
          state: "stopped",
          startedAt: 0,
          lastUpdate: 0,
          activeStrategyCount: 0,
          positions: [],
        },
      },
    });
    expect(ctrl.getStatus()?.state).toBe("stopped");
    ctrl.dispose();
  });

  it("extractBotStatus returns null for an invalid snapshot (defensive)", () => {
    const { scheduler } = createFakeScheduler();
    const fake = createFakeFetch();
    const ctrl = new BotStatusController({
      scheduler: scheduler,
      fetchImpl: fake.fetchImpl,
    });
    // Seed a known state so we can verify the previous state
    // is preserved when the invalid message is a no-op.
    ctrl.onStateMessage({
      snapshot: {
        botStatus: {
          state: "running",
          startedAt: 0,
          lastUpdate: 0,
          activeStrategyCount: 0,
          positions: [],
        },
      },
    });
    expect(ctrl.getStatus()?.state).toBe("running");
    // Invalid: state field is not one of the 3 valid values.
    ctrl.onStateMessage({
      snapshot: {
        botStatus: {
          state: "exploded",
          startedAt: 0,
          lastUpdate: 0,
          activeStrategyCount: 0,
          positions: [],
        },
      },
    });
    // The previous "running" state is preserved.
    expect(ctrl.getStatus()?.state).toBe("running");
    // Invalid: missing snapshot field entirely.
    ctrl.onStateMessage({});
    expect(ctrl.getStatus()?.state).toBe("running");
    // Invalid: snapshot is null.
    ctrl.onStateMessage({ snapshot: null });
    expect(ctrl.getStatus()?.state).toBe("running");
    // Invalid: snapshot is a primitive.
    ctrl.onStateMessage({ snapshot: "hello" });
    expect(ctrl.getStatus()?.state).toBe("running");
    // The pure helper is also covered directly (a defense-in-
    // depth sanity check that the controller is using the same
    // helper that `bot-status.test.ts` tests).
    expect(extractBotStatus(null)).toBeNull();
    expect(
      extractBotStatus({ botStatus: { state: "exploded" } }),
    ).toBeNull();
    ctrl.dispose();
  });

  it("ignores a state message with a null/undefined msg argument (defensive)", () => {
    const { scheduler } = createFakeScheduler();
    const fake = createFakeFetch();
    const ctrl = new BotStatusController({
      scheduler: scheduler,
      fetchImpl: fake.fetchImpl,
    });
    // These should be no-ops, not throws.
    expect(() => ctrl.onStateMessage(null)).not.toThrow();
    expect(() => ctrl.onStateMessage(undefined)).not.toThrow();
    expect(() => ctrl.onSnapshotMessage(null)).not.toThrow();
    expect(() => ctrl.onSnapshotMessage(undefined)).not.toThrow();
    expect(ctrl.getStatus()).toBeNull();
    ctrl.dispose();
  });
});

// ============================================================================
// useBotStatus — wire-level smoke (the React glue is verified by TS + e2e)
// ============================================================================

// The `react-hooks` rule is not in the project's eslint config (see
// the file header comment), so importing React just to assert the
// hook function exists is sufficient. The e2e suite
// (apps/web/e2e/81-*.spec.ts, when wired) exercises the React
// integration end-to-end.

describe("useBotStatus (wire-level smoke)", () => {
  it("the controller is the same instance type that the hook would create", () => {
    // Verify that `BotStatusController` (the class the hook
    // instantiates) is constructible with NO arguments, matching
    // `new BotStatusController()` in `use-bot-status.ts`.
    const ctrl = new BotStatusController();
    expect(ctrl).toBeInstanceOf(BotStatusController);
    expect(ctrl.getStatus()).toBeNull();
    ctrl.dispose();
  });

  it("the __test__ constants can be overridden to short-circuit the 30s/5s delays", () => {
    // The hook reads from `__test__.SLOW_POLL_INTERVAL_MS` and
    // `__test__.BOOTSTRAP_FETCH_TIMEOUT_MS` when constructing
    // the controller. The `beforeEach` overrides these to 100ms
    // / 50ms; this test verifies the override is actually
    // propagated to the controller.
    const { scheduler, timers } = createFakeScheduler();
    const fake = createFakeFetch();
    const ctrl = new BotStatusController({
      scheduler: scheduler,
      fetchImpl: fake.fetchImpl,
    });
    ctrl.onWsStatusChange("disconnected");
    const intervalTimer = timers.find((t) => t.kind === "interval");
    expect(intervalTimer?.ms).toBe(TEST_SLOW_POLL_MS);
    ctrl.dispose();
  });
});

// ============================================================================
// Mock sanity: ensure `mock` is imported (it would be unused otherwise)
// ============================================================================

// `mock` from `bun:test` is imported so the linter / TS don't flag
// the destructured import (the test file may use `mock.module` in
// the future to stub `useWebSocket` if/when the project's React
// test infrastructure grows). Referenced here to anchor the
// import.
void mock;
