/**
 * 58E — e2e tests for the LOW-HANGING imperative-class branches in
 * `ws-client.ts` (and the corresponding reducer switch arms in
 * `ws-client-state.ts`) that the existing 57A/58A/58B/58C/58D tests
 * didn't hit.
 *
 * **Background.** The `WebSocketClient` class is a thin shell over
 * the pure reducer in `ws-client-state.ts`. Every event flows
 * through `dispatch(event) → reduce(state, event) → executeEffect(effect)`.
 * The class holds the imperative bits (the socket, the reconnect
 * timer, the listener sets). The reducer is the source of truth for
 * the state machine; the class is the source of truth for the
 * imperative side effects.
 *
 * **Why this spec exists.** Earlier specs (58C-19, 58C-20, 58D-08)
 * used `page.goto("about:blank")` to trigger React unmount, which
 * dispatches `CLOSE_USER`. But the navigation destroys the page,
 * so `test.afterEach` reads the NEW (about:blank) page's
 * `window.__coverage__` — not the OLD page's. The OLD page's
 * coverage (where the CLOSE_USER dispatch happened) is lost.
 *
 * **Solution.** This spec uses the React Fiber tree to find the
 * `WebSocketClient` instance via `page.evaluate` and calls
 * `client.close()` / `client.start()` / `client.send()` directly.
 * The page stays alive, so the `test.afterEach` hook captures the
 * coverage. The fiber walk uses public React internals
 * (`__reactContainer$xxx` on the root element) and is test-only —
 * no source-code changes.
 *
 * **Targets:**
 *
 *   ws-client.ts branches (imperative class):
 *     - line 470: `if (this.reconnectHandle !== null)` in
 *                 CANCEL_RECONNECT (BOTH arms: TRUE after a
 *                 scheduled reconnect, FALSE when no reconnect
 *                 is pending)
 *     - line 477: `if (this.socket !== null)` in CLOSE_SOCKET
 *                 (BOTH arms: TRUE on first close, FALSE on
 *                 second close after the socket is already null)
 *
 *   ws-client-state.ts switch arms (pure reducer):
 *     - case "SOCKET_CLOSE" (line ~389): both arms of
 *       shouldScheduleReconnect (reachable via close() in 58E-01)
 *     - case "SOCKET_ERROR" (line 430): no-op — note that
 *       Playwright's WebSocketRoute cannot fire the WS-level
 *       `error` event, so this arm is only reachable via the
 *       reducer's `parseServerMessage` returning an error message
 *       (which is the existing test path, not the WS-error path)
 *     - case "CLOSE_USER" (line ~382): always (reachable via
 *       fiber-tree client.close() in 58E-02 / 58E-03)
 *
 *   ws-client.ts DISPATCH switch arms (line 370-398) — all 5
 *   kinds (snapshot / state / error / tick / bar) are exercised
 *   in 58E-05.
 *
 * **What this spec does NOT cover (genuinely unreachable from
 * the public API):**
 *   - The `if (this.socket !== null)` FALSE arms in SEND_PONG
 *     and SEND_RAW (lines 438 / 448) are unreachable from the
 *     public API: the reducer gates these effects on
 *     `state.socketOpen`, which is set in lockstep with
 *     `this.socket`. The two are always in sync.
 *   - The 58E-02 second close() exercises the CLOSE_SOCKET
 *     FALSE arm (line 477) by closing the client AFTER the
 *     socket is already null.
 */
import { type Page, expect, test } from "@playwright/test";
import type { WebSocketRoute } from "@playwright/test";
import { installCoverageHooks } from "./_helpers/coverage.js";

installCoverageHooks("58E-ws-client-imperative-branches");

// =============================================================================
// WsTestHarness (shared pattern from 57A / 58A / 58C / 58D)
// =============================================================================

interface PerWsState {
  readonly route: WebSocketRoute;
  sentFromPage: string[];
}

interface WsTestHarness {
  readonly getAllWs: () => readonly WebSocketRoute[];
  readonly getPerWsSentFromPage: () => readonly PerWsState[];
  readonly broadcast: (data: string) => void;
  readonly sendToWs: (ws: WebSocketRoute, data: string) => void;
  readonly closeWs: (
    ws: WebSocketRoute,
    options?: { code?: number; reason?: string },
  ) => Promise<void>;
  readonly waitForWsCount: (n: number, timeoutMs?: number) => Promise<void>;
}

async function setupWsPeer(page: Page): Promise<WsTestHarness> {
  await page.route("**/api/strategies", (route) => {
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        strategies: [
          {
            name: "donchian_pivot_composition",
            enabled: true,
            symbols: ["BTCUSDT"],
            timeframes: ["1h"],
          },
        ],
      }),
    });
  });

  const perWs: PerWsState[] = [];
  await page.routeWebSocket("ws://127.0.0.1:7913/ws", (ws) => {
    const state: PerWsState = { route: ws, sentFromPage: [] };
    ws.onMessage((msg) => {
      state.sentFromPage.push(String(msg));
    });
    perWs.push(state);
  });

  return {
    getAllWs: () => perWs.map((p) => p.route),
    getPerWsSentFromPage: () => perWs.slice(),
    broadcast: (data) => {
      for (const p of perWs) p.route.send(data);
    },
    sendToWs: (ws, data) => {
      ws.send(data);
    },
    closeWs: async (ws, options = {}) => {
      await ws.close(options);
    },
    waitForWsCount: async (n, timeoutMs = 10_000) => {
      const start = Date.now();
      while (perWs.length < n) {
        if (Date.now() - start > timeoutMs) {
          throw new Error(
            `Expected ${n} WSes but only ${perWs.length} after ${timeoutMs}ms`,
          );
        }
        await new Promise((r) => setTimeout(r, 50));
      }
    },
  };
}

async function driveToConnected(
  page: Page,
  harness: WsTestHarness,
): Promise<void> {
  const now = Date.now();
  const hello = JSON.stringify({
    type: "hello",
    ts: now,
    serverVersion: "0.1.0-test",
    protocolVersion: 1,
  });
  const snapshot = JSON.stringify({
    type: "snapshot",
    ts: now,
    snapshot: {},
    strategies: [
      {
        name: "donchian_pivot_composition",
        enabled: true,
        symbols: ["BTCUSDT"],
        timeframes: ["1h"],
      },
    ],
    ohlcBootstrap: { BTCUSDT: { "1h": [] } },
  });
  const state = JSON.stringify({
    type: "state",
    ts: now,
    snapshot: {},
    positions: [],
    closedTrades: [],
    killSwitch: "off",
    paused: false,
    statistics: { trades: 0, pnl: 0, drawdown: 0 },
  });
  harness.broadcast(hello);
  harness.broadcast(snapshot);
  harness.broadcast(state);
  await page.waitForSelector(".ep-chart-card", { timeout: 5000 }).catch(() => undefined);
}

// =============================================================================
// React Fiber Tree helper
//
// The `useWebSocket` hook stores the `WebSocketClient` instance in
// a `useRef`. The ref's `current` is the live client. We access
// the ref via the React Fiber tree:
//
//   1. The root DOM element (#root) has a `__reactContainer$xxx`
//      property (React 18's internal naming).
//   2. The container has a `stateNode.current` which is the root fiber.
//   3. The fiber tree is linked via `child` and `sibling`.
//   4. Each fiber with hooks has a `memoizedState` linked list.
//   5. A useRef hook stores the ref object in `memoizedState`;
//      the ref's `current` is the WebSocketClient.
//
// We duck-type by the presence of `close` + `start` + `send` +
// `state` + `socket` + `reconnectHandle`.
// =============================================================================

/** `RawWsClient` — the WebSocketClient instance as seen from
 *  `page.evaluate`. The test code can call `close()`, `start()`,
 *  `send(msg)`, `getStatus()` and read the private fields
 *  `socket`, `reconnectHandle`, and `state`. */
interface RawWsClient {
  readonly close: () => void;
  readonly start: () => void;
  readonly send: (msg: { type: string; [k: string]: unknown }) => void;
  readonly getStatus: () => string;
  readonly socket: unknown;
  readonly reconnectHandle: unknown;
  readonly state: {
    readonly closedByCaller: boolean;
    readonly attempt: number;
    readonly socketOpen: boolean;
    readonly status: string;
  };
}

/**
 * `withClient(page, fn)` — find the `WebSocketClient` via the
 * React fiber tree, run `fn(client)` with it, and return the
 * result. Throws if the client cannot be found.
 *
 * The fiber walk AND the function call happen in the same
 * `page.evaluate` body. We do this by passing the function
 * source as a string argument to `page.evaluate` (NOT as a
 * function expression — Playwright's `page.evaluate` doesn't
 * pass a `client` argument to a function expression; it
 * passes the result of the previous expression to the
 * expression's argument list).
 */
async function withClient<T>(
  page: Page,
  fn: (client: RawWsClient) => T,
): Promise<T> {
  // We pass the function body as a string and re-evaluate it
  // in the page context. The `RawWsClient` interface is
  // type-only — at runtime, the function body just uses the
  // duck-typed shape of the WebSocketClient.
  const fnSource = fn.toString();
  return page.evaluate(`
    (function() {
      // Walk the fiber tree to find the WebSocketClient.
      // The shape is documented in the test module's header comment.
      // The useRef hook stores the ref OBJECT in memoizedState.
      // The WebSocketClient is ref.current. We duck-type on the
      // underlying client (not the ref wrapper).
      function isWsClient(o) {
        if (typeof o !== 'object' || o === null) return false;
        return (
          typeof o.close === 'function' &&
          typeof o.start === 'function' &&
          typeof o.send === 'function' &&
          'state' in o &&
          'socket' in o &&
          'reconnectHandle' in o
        );
      }
      var rootEl = document.getElementById('root');
      if (rootEl === null) throw new Error('no #root');
      var containerKey = Object.keys(rootEl).find(function(k) {
        return k.indexOf('__reactContainer$') === 0;
      });
      if (containerKey === undefined) throw new Error('no __reactContainer$');
      var container = rootEl[containerKey];
      if (container === undefined || container.stateNode === undefined) {
        throw new Error('no container stateNode');
      }
      var rootFiber = container.stateNode.current;
      if (rootFiber == null) throw new Error('no root fiber');
      var stack = [rootFiber];
      var found = null;
      var safety = 0;
      while (stack.length > 0 && found === null) {
        if (++safety > 100000) throw new Error('fiber walk exceeded 100k');
        var f = stack.pop();
        if (f == null) continue;
        var hook = f.memoizedState;
        var hookSafety = 0;
        while (hook != null && found === null) {
          if (++hookSafety > 50) break;
          // The hook's memoizedState is the ref OBJECT. The
          // WebSocketClient is ref.current. We unwrap once.
          var refObj = hook.memoizedState;
          if (refObj != null && typeof refObj === 'object' && 'current' in refObj) {
            if (isWsClient(refObj.current)) {
              found = refObj.current;
              break;
            }
          }
          hook = hook.next;
        }
        if (f.child != null) stack.push(f.child);
        if (f.sibling != null) stack.push(f.sibling);
      }
      if (found === null) throw new Error('WebSocketClient not found');
      // Run the test's function with the found client.
      var fn = ${fnSource};
      return fn(found);
    })()
  `) as Promise<T>;
}

/**
 * `readClient(page)` — read a snapshot of the WebSocketClient's
 * private state. Used in tests to verify state transitions
 * without navigating away.
 */
async function readClient(page: Page): Promise<{
  status: string;
  hasSocket: boolean;
  hasPendingReconnect: boolean;
  closedByCaller: boolean;
  attempt: number;
}> {
  return withClient(page, (c) => ({
    status: c.state.status,
    hasSocket: c.socket !== null,
    hasPendingReconnect: c.reconnectHandle !== null,
    closedByCaller: c.state.closedByCaller,
    attempt: c.state.attempt,
  }));
}

/**
 * `findAndAct(page, action)` — find the WebSocketClient and run
 * an action on it. The action is a string snippet that
 * references `client` (the WebSocketClient) and returns a
 * result. Used to call `client.close()`, `client.start()`,
 * `client.send(...)`, etc.
 *
 * The action string is inlined into the wrapper function body
 * (NOT captured via closure) so that the wrapper can be
 * serialized and re-evaluated in the page context. The action
 * is treated as a code snippet to be evaluated with `client`
 * in scope.
 */
async function findAndAct<T>(page: Page, action: string): Promise<T> {
  // We construct a function whose body is the action string.
  // The function takes `client` and evaluates the action.
  // The `withClient` helper serializes this function via
  // `fn.toString()` and re-evaluates it in the page context.
  // Because the action is inlined in the function body, it's
  // part of the serialized string and thus available in the
  // page context.
  const fn = new Function("client", action) as (c: RawWsClient) => T;
  return withClient(page, fn);
}

// =============================================================================
// Tests
// =============================================================================

test.describe("58E — ws-client imperative-class branches", () => {
  // --------------------------------------------------------------------------
  // 58E-01: SOCKET_CLOSE arm of the reducer + reconnect scheduling
  // --------------------------------------------------------------------------
  // The class's `socket.addEventListener("close", ...)` dispatches
  // SOCKET_CLOSE. The reducer's `case "SOCKET_CLOSE"` with
  // `shouldScheduleReconnect(state) === true` increments `attempt`,
  // sets `socketOpen: false`, and emits
  // `SET_STATUS(disconnected) + SCHEDULE_RECONNECT(1_000)`. The
  // class's `SCHEDULE_RECONNECT` handler sets `this.reconnectHandle`
  // to the timer. After 1s, the timer fires and dispatches START,
  // which triggers a new CONNECT.
  //
  // This test verifies the attempt counter goes from 0 to 1
  // after the first close, and to 2 after the second close. The
  // reconnect timer is observed via the fiber tree's
  // `reconnectHandle` (non-null when scheduled).

  test("58E-01: SOCKET_CLOSE arm of reducer + reconnect cycle (attempt 0→1→2)", async ({
    page,
  }) => {
    const harness = await setupWsPeer(page);
    await page.goto("/", { waitUntil: "networkidle" });
    await harness.waitForWsCount(3, 10_000);
    await driveToConnected(page, harness);
    await page.waitForTimeout(300);

    // Baseline: attempt=0, socket exists, no pending reconnect
    let snap = await readClient(page);
    expect(snap.attempt).toBe(0);
    expect(snap.hasSocket).toBe(true);
    expect(snap.hasPendingReconnect).toBe(false);

    // First close: dispatch SOCKET_CLOSE → attempt=1, reconnect
    // scheduled
    for (const ws of harness.getAllWs()) {
      await harness.closeWs(ws, { code: 1006 });
    }

    // Wait for the status pill to transition away from "connected"
    await page
      .waitForFunction(
        () => {
          const status = document
            .querySelector(".ep-app__status-dot")
            ?.getAttribute("data-status");
          return status !== "connected" && status !== null;
        },
        undefined,
        { timeout: 3_000, polling: 50 },
      )
      .catch(() => undefined);

    snap = await readClient(page);
    expect(snap.attempt).toBe(1);
    expect(snap.hasPendingReconnect).toBe(true);
    expect(snap.status).toBe("disconnected");

    // Wait for the 1s backoff to fire
    await page.waitForTimeout(1500);

    // After the reconnect, the new WSes should be visible
    await harness.waitForWsCount(6, 5_000).catch(() => undefined);

    // Drive the new WSes to "connected" (the previous snapshot
    // was lost on reconnect)
    const newWsList = harness.getAllWs();
    const secondBatch = newWsList.slice(3);
    if (secondBatch.length > 0) {
      const now = Date.now();
      for (const ws of secondBatch) {
        harness.sendToWs(
          ws,
          JSON.stringify({
            type: "hello",
            ts: now,
            serverVersion: "0.1.0-test",
            protocolVersion: 1,
          }),
        );
        harness.sendToWs(
          ws,
          JSON.stringify({
            type: "snapshot",
            ts: now,
            snapshot: {},
            strategies: [
              {
                name: "donchian_pivot_composition",
                enabled: true,
                symbols: ["BTCUSDT"],
                timeframes: ["1h"],
              },
            ],
            ohlcBootstrap: { BTCUSDT: { "1h": [] } },
          }),
        );
      }
    }

    await page.waitForTimeout(500);

    // The status should be back to "connected" — SOCKET_OPEN
    // resets attempt to 0
    const status = await page.evaluate(() =>
      document.querySelector(".ep-app__status-dot")?.getAttribute("data-status"),
    );
    expect(status).toBe("connected");

    snap = await readClient(page);
    expect(snap.attempt).toBe(0);
    expect(snap.hasSocket).toBe(true);

    // Second close: attempt should go from 0 to 1 (SOCKET_OPEN
    // reset attempt to 0 on the reconnect)
    for (const ws of harness.getAllWs()) {
      await harness.closeWs(ws, { code: 1006 });
    }

    await page
      .waitForFunction(
        () => {
          const status = document
            .querySelector(".ep-app__status-dot")
            ?.getAttribute("data-status");
          return status !== "connected" && status !== null;
        },
        undefined,
        { timeout: 3_000, polling: 50 },
      )
      .catch(() => undefined);

    snap = await readClient(page);
    expect(snap.attempt).toBe(1);
    expect(snap.hasPendingReconnect).toBe(true);
  });

  // --------------------------------------------------------------------------
  // 58E-02: CLOSE_USER arm (via fiber tree) — exercises
  //         CANCEL_RECONNECT FALSE + CLOSE_SOCKET TRUE then FALSE
  // --------------------------------------------------------------------------
  // The fiber-tree approach: find the WebSocketClient, call close()
  // on it directly. This dispatches CLOSE_USER, which goes through
  // the reducer and produces CANCEL_RECONNECT (reconnectHandle is
  // null → FALSE arm), SET_STATUS(disconnected), and CLOSE_SOCKET
  // (this.socket is non-null → TRUE arm → socket.close() +
  // this.socket = null).
  //
  // The first close() exercises:
  //   - CLOSE_USER reducer arm
  //   - CANCEL_RECONNECT FALSE arm (no pending reconnect)
  //   - CLOSE_SOCKET TRUE arm (socket exists)
  //
  // The SECOND close() (right after, when this.socket is already
  // null) exercises:
  //   - CANCEL_RECONNECT FALSE arm again
  //   - CLOSE_SOCKET FALSE arm (socket already null) — line 477!

  test("58E-02: client.close() via fiber tree — CLOSE_USER + CANCEL_RECONNECT FALSE + CLOSE_SOCKET TRUE then FALSE", async ({
    page,
  }) => {
    const harness = await setupWsPeer(page);
    await page.goto("/", { waitUntil: "networkidle" });
    await harness.waitForWsCount(3, 10_000);
    await driveToConnected(page, harness);
    await page.waitForTimeout(300);

    // Baseline
    let snap = await readClient(page);
    expect(snap.closedByCaller).toBe(false);
    expect(snap.hasSocket).toBe(true);
    expect(snap.hasPendingReconnect).toBe(false);
    expect(snap.status).toBe("connected");

    // FIRST close() — exercises CLOSE_USER + CANCEL_RECONNECT
    // FALSE arm (no pending reconnect) + CLOSE_SOCKET TRUE arm
    // (socket exists, gets closed and nulled)
    await findAndAct(page, "client.close()");
    await page.waitForTimeout(100);

    snap = await readClient(page);
    expect(snap.closedByCaller).toBe(true);
    expect(snap.hasSocket).toBe(false);
    expect(snap.status).toBe("disconnected");

    // SECOND close() — exercises CLOSE_SOCKET FALSE arm
    // (this.socket is already null). The reducer's CLOSE_USER
    // arm runs again and emits CANCEL_RECONNECT + SET_STATUS +
    // CLOSE_SOCKET. The class's CLOSE_SOCKET handler checks
    // `if (this.socket !== null)` — this is the FALSE arm.
    await findAndAct(page, "client.close()");
    await page.waitForTimeout(100);

    snap = await readClient(page);
    expect(snap.closedByCaller).toBe(true);
    expect(snap.hasSocket).toBe(false);
    expect(snap.status).toBe("disconnected");
  });

  // --------------------------------------------------------------------------
  // 58E-03: client.close() AFTER a reconnect is scheduled — CANCEL_RECONNECT
  //         TRUE arm
  // --------------------------------------------------------------------------
  // The reducer's CLOSE_USER case always emits CANCEL_RECONNECT. The
  // class's CANCEL_RECONNECT handler checks
  // `if (this.reconnectHandle !== null)`. The TRUE arm is hit when
  // a reconnect is pending (e.g., after SOCKET_CLOSE → SCHEDULE_RECONNECT).
  //
  // Flow:
  //   1. Connect (drive to "connected").
  //   2. Close the WS → SOCKET_CLOSE → SCHEDULE_RECONNECT(1_000).
  //      reconnectHandle is now non-null.
  //   3. Call client.close() → CLOSE_USER → CANCEL_RECONNECT.
  //      The TRUE arm is hit: reconnectHandle is non-null, we
  //      clearTimeout and null it.
  //   4. After the close, the reconnect does NOT fire (it was
  //      cancelled). The status pill stays "disconnected".

  test("58E-03: client.close() after reconnect is scheduled — CANCEL_RECONNECT TRUE arm", async ({
    page,
  }) => {
    const harness = await setupWsPeer(page);
    await page.goto("/", { waitUntil: "networkidle" });
    await harness.waitForWsCount(3, 10_000);
    await driveToConnected(page, harness);
    await page.waitForTimeout(300);

    // Baseline: no pending reconnect
    let snap = await readClient(page);
    expect(snap.hasPendingReconnect).toBe(false);

    // Close all WSes to trigger SOCKET_CLOSE → SCHEDULE_RECONNECT
    for (const ws of harness.getAllWs()) {
      await harness.closeWs(ws, { code: 1006 });
    }

    // Wait for the close to be processed and the reconnect to
    // be scheduled
    await page
      .waitForFunction(
        () => {
          const status = document
            .querySelector(".ep-app__status-dot")
            ?.getAttribute("data-status");
          return status !== "connected" && status !== null;
        },
        undefined,
        { timeout: 3_000, polling: 50 },
      )
      .catch(() => undefined);

    // The reconnect should be scheduled
    snap = await readClient(page);
    expect(snap.hasPendingReconnect).toBe(true);
    expect(snap.attempt).toBe(1);

    // Now call client.close() while the reconnect is pending.
    // The CANCEL_RECONNECT TRUE arm is hit: we clearTimeout on
    // the pending reconnect.
    await findAndAct(page, "client.close()");
    await page.waitForTimeout(100);

    // After close, the reconnect is cancelled, the socket is
    // closed and nulled
    snap = await readClient(page);
    expect(snap.closedByCaller).toBe(true);
    expect(snap.hasSocket).toBe(false);
    expect(snap.hasPendingReconnect).toBe(false);
    expect(snap.status).toBe("disconnected");

    // Wait long enough for the original 1s backoff to have fired
    // (it shouldn't, because we cancelled it)
    await page.waitForTimeout(1500);

    // The status should STILL be "disconnected" — the reconnect
    // was cancelled. If the CANCEL_RECONNECT TRUE arm was NOT
    // hit, the reconnect would have fired and the status would
    // be back to "connected" (or at least "connecting").
    const status = await page.evaluate(() =>
      document.querySelector(".ep-app__status-dot")?.getAttribute("data-status"),
    );
    expect(status).toBe("disconnected");
  });

  // --------------------------------------------------------------------------
  // 58E-04: SEND_RAW TRUE arm — call client.send() when connected
  // --------------------------------------------------------------------------
  // The reducer's `case "SEND"` with `state.socketOpen === true`
  // emits `SEND_RAW(JSON.stringify(msg))`. The class's SEND_RAW
  // handler checks `if (this.socket !== null)` and sends. The
  // TRUE arm is hit when the socket exists and is open.
  //
  // We use the fiber tree to call `client.send(...)` directly
  // with a subscribe message, and verify the WS peer receives
  // the JSON-stringified payload. This exercises the SEND
  // reducer arm AND the SEND_RAW class handler.

  test("58E-04: client.send() when connected — SEND_RAW TRUE arm", async ({
    page,
  }) => {
    const harness = await setupWsPeer(page);
    await page.goto("/", { waitUntil: "networkidle" });
    await harness.waitForWsCount(3, 10_000);
    await driveToConnected(page, harness);
    await page.waitForTimeout(300);

    // Confirm the client has a socket
    const snap = await readClient(page);
    expect(snap.hasSocket).toBe(true);

    // Clear the sent-messages log so we can isolate the new send
    for (const p of harness.getPerWsSentFromPage()) {
      p.sentFromPage.length = 0;
    }

    // Call client.send() with a unique subscribe payload
    const uniqueSymbol = `BTC${Date.now()}`;
    await findAndAct(
      page,
      `client.send({ type: 'subscribe', symbol: ${JSON.stringify(uniqueSymbol)}, timeframe: '1h' })`,
    );

    await page.waitForTimeout(200);

    // The WS peer should have received the subscribe message
    const sentMessages = harness
      .getPerWsSentFromPage()
      .flatMap((p) => p.sentFromPage);
    const matchingMessages = sentMessages.filter((m) => {
      try {
        const parsed = JSON.parse(m) as {
          type?: string;
          symbol?: string;
          timeframe?: string;
        };
        return (
          parsed.type === "subscribe" && parsed.symbol === uniqueSymbol
        );
      } catch {
        return false;
      }
    });
    expect(matchingMessages.length).toBeGreaterThan(0);
  });

  // --------------------------------------------------------------------------
  // 58E-05: DISPATCH switch arms — all 5 message types
  // --------------------------------------------------------------------------
  // The class's `executeEffect` switch on `effect.type === "DISPATCH"`
  // has 5 arms: snapshot, state, error, tick, bar. Each one iterates
  // a different listener set. The existing tests cover snapshot + state
  // (via driveToConnected) and error (via dashboard.spec.ts test #18
  // for crashed state). This test directly fires all 5 message types
  // to exercise every DISPATCH arm.
  //
  // Coverage: DISPATCH switch (line 370-398) — all 5 arms.

  test("58E-05: DISPATCH switch — all 5 message types (snapshot, state, error, tick, bar)", async ({
    page,
  }) => {
    const harness = await setupWsPeer(page);
    await page.goto("/", { waitUntil: "networkidle" });
    await harness.waitForWsCount(3, 10_000);
    await driveToConnected(page, harness);
    await page.waitForTimeout(300);

    // Send a snapshot message → DISPATCH kind: "snapshot"
    const snapTs = Date.now();
    for (const ws of harness.getAllWs()) {
      harness.sendToWs(
        ws,
        JSON.stringify({
          type: "snapshot",
          ts: snapTs,
          snapshot: {},
          strategies: [
            {
              name: "donchian_pivot_composition",
              enabled: true,
              symbols: ["BTCUSDT"],
              timeframes: ["1h"],
            },
          ],
          ohlcBootstrap: { BTCUSDT: { "1h": [] } },
        }),
      );
    }
    await page.waitForTimeout(100);

    // Send a state message → DISPATCH kind: "state"
    const stateTs = Date.now();
    for (const ws of harness.getAllWs()) {
      harness.sendToWs(
        ws,
        JSON.stringify({
          type: "state",
          ts: stateTs,
          snapshot: {},
          positions: [],
          closedTrades: [],
          killSwitch: "off",
          paused: false,
          statistics: { trades: 1, pnl: 50, drawdown: 0 },
        }),
      );
    }
    await page.waitForTimeout(100);

    // Send a recoverable error → DISPATCH kind: "error" (no crash)
    for (const ws of harness.getAllWs()) {
      harness.sendToWs(
        ws,
        JSON.stringify({
          type: "error",
          ts: Date.now(),
          message: "test recoverable error",
          recoverable: true,
        }),
      );
    }
    await page.waitForTimeout(100);

    // Send a tick → DISPATCH kind: "tick"
    for (const ws of harness.getAllWs()) {
      harness.sendToWs(
        ws,
        JSON.stringify({
          type: "tick",
          ts: Date.now(),
          symbol: "BTCUSDT",
          price: 50500,
        }),
      );
    }
    await page.waitForTimeout(100);

    // Send a bar → DISPATCH kind: "bar"
    for (const ws of harness.getAllWs()) {
      harness.sendToWs(
        ws,
        JSON.stringify({
          type: "bar",
          ts: Date.now(),
          symbol: "BTCUSDT",
          timeframe: "1h",
          ohlc: {
            time: Math.floor(Date.now() / 1000),
            open: 50000,
            high: 50100,
            low: 49900,
            close: 50050,
            volume: 100,
          },
        }),
      );
    }
    await page.waitForTimeout(300);

    // The status should still be "connected" (no crash from the
    // recoverable error)
    const status = await page.evaluate(() =>
      document.querySelector(".ep-app__status-dot")?.getAttribute("data-status"),
    );
    expect(status).toBe("connected");
  });

  // --------------------------------------------------------------------------
  // 58E-06: non-recoverable error → CRASHED + CLOSE_SOCKET (reducer
  //         full error path)
  // --------------------------------------------------------------------------
  // When the server sends an error message with `recoverable: false`,
  // the reducer's `case "error"` (in reduceForParsedMessage) takes
  // the non-recoverable branch:
  //   - state.closedByCaller = true
  //   - state.status = "crashed"
  //   - state.socketOpen = false
  //   - effects: DISPATCH(error) + SET_STATUS(crashed) + CLOSE_SOCKET
  //
  // The class's CLOSE_SOCKET handler closes the underlying socket.
  // The existing dashboard.spec.ts test #18 covers this path. This
  // test verifies the same path explicitly with the fiber tree to
  // confirm the WebSocketClient's state after the crash.

  test("58E-06: non-recoverable error → CRASHED + CLOSE_SOCKET (reducer full error path)", async ({
    page,
  }) => {
    const harness = await setupWsPeer(page);
    await page.goto("/", { waitUntil: "networkidle" });
    await harness.waitForWsCount(3, 10_000);
    await driveToConnected(page, harness);
    await page.waitForTimeout(300);

    // Send a non-recoverable error
    for (const ws of harness.getAllWs()) {
      harness.sendToWs(
        ws,
        JSON.stringify({
          type: "error",
          ts: Date.now(),
          message: "non-recoverable test error",
          recoverable: false,
        }),
      );
    }
    await page.waitForTimeout(500);

    // The status should be "crashed"
    const status = await page.evaluate(() =>
      document.querySelector(".ep-app__status-dot")?.getAttribute("data-status"),
    );
    expect(status).toBe("crashed");

    // The WebSocketClient should be in a crashed state
    const snap = await readClient(page);
    expect(snap.closedByCaller).toBe(true);
    expect(snap.status).toBe("crashed");
    expect(snap.hasSocket).toBe(false);
  });

  // --------------------------------------------------------------------------
  // 58E-07: send() before the WS is fully open — exercise the SEND
  //         reducer's "socketOpen=false" branch (the existing 58-01
  //         test, but here we use the fiber tree to verify the
  //         internal state instead of just the status pill)
  // --------------------------------------------------------------------------
  // The reducer's `case "SEND"` checks `if (!state.socketOpen)`. The
  // TRUE arm (no-op) is hit when socketOpen is false.
  //
  // Flow:
  //   1. Close all WSes.
  //   2. The class sets this.socket = null and dispatches SOCKET_CLOSE.
  //   3. The reducer sets socketOpen = false.
  //   4. Within the ~1s reconnect window, call client.send().
  //   5. The reducer's SEND case returns no-op (socketOpen=false).
  //   6. The class's SEND_RAW handler is NOT invoked.

  test("58E-07: client.send() while socket is closed (before reconnect) — SEND reducer no-op arm", async ({
    page,
  }) => {
    const harness = await setupWsPeer(page);
    await page.goto("/", { waitUntil: "networkidle" });
    await harness.waitForWsCount(3, 10_000);
    await driveToConnected(page, harness);
    await page.waitForTimeout(300);

    // Confirm the client has a socket
    let snap = await readClient(page);
    expect(snap.hasSocket).toBe(true);

    // Clear the sent-messages log
    for (const p of harness.getPerWsSentFromPage()) {
      p.sentFromPage.length = 0;
    }

    // Close all WSes to trigger SOCKET_CLOSE (which sets
    // socketOpen=false in the reducer)
    for (const ws of harness.getAllWs()) {
      await harness.closeWs(ws, { code: 1006 });
    }

    // Wait for the close to propagate to the state machine
    await page.waitForTimeout(200);

    // Now the client should be in the "reconnecting" state with
    // socketOpen=false. The reconnect is scheduled (1s backoff).
    snap = await readClient(page);
    expect(snap.hasPendingReconnect).toBe(true);

    // Call client.send() — the reducer's SEND arm with
    // socketOpen=false returns no-op. The SEND_RAW effect is
    // never emitted, so the class's SEND_RAW handler is never
    // called.
    const uniqueSymbol = `SEND${Date.now()}`;
    await findAndAct(
      page,
      `client.send({ type: 'subscribe', symbol: ${JSON.stringify(uniqueSymbol)}, timeframe: '1h' })`,
    );

    // Wait briefly to allow any sent messages to be processed
    await page.waitForTimeout(200);

    // The unique subscribe should NOT appear in the sent log
    // (the SEND was a no-op)
    const sentMessages = harness
      .getPerWsSentFromPage()
      .flatMap((p) => p.sentFromPage);
    const matchingMessages = sentMessages.filter((m) => {
      try {
        const parsed = JSON.parse(m) as { symbol?: string };
        return parsed.symbol === uniqueSymbol;
      } catch {
        return false;
      }
    });
    expect(matchingMessages.length).toBe(0);
  });
});
