/**
 * apps/web/e2e/55-2-3ws-architecture.spec.ts
 *
 * Phase 55-2: 3-WS architecture coverage. The apps/web dashboard
 * has THREE `useWebSocket()` consumers — `App`, `ControlBar`, and
 * `PositionsTable` — each maintaining its own WebSocket connection
 * to `ws://127.0.0.1:7913/ws`. The existing 53C-* tests only
 * exercise App's WS (the one that drives the visible status pill
 * and the disconnected/crashed banners). The other 2 WSes —
 * ControlBar's and PositionsTable's — have their own
 * `WebSocketClient` instances and therefore their own close
 * handlers, reconnect logic, and error paths.
 *
 * The 53C test file documents the WS creation order:
 *   - Child useEffects run BEFORE the parent's.
 *   - The JSX tree has `<PositionsTable />` inside `main` and
 *     `<ControlBar />` as a sibling of `main`. React mounts
 *     them in JSX order, so:
 *       WS[0] = PositionsTable  (first useWebSocket child to mount)
 *       WS[1] = ControlBar       (sibling of main, second)
 *       WS[2] = App              (parent useEffect, last)
 *   - App's WS is the one driving the status pill (verified
 *     empirically in 53C).
 *
 * **Identification strategy:** we don't hardcode WS indices in
 * the per-component tests (55-2-02, 55-2-03, 55-2-04). Instead,
 * we identify ControlBar's WS by clicking the Start button and
 * matching the per-WS onMessage log for a `{"type":"control",
 * "command":"start"}` frame (ControlBar is the only component
 * with that button). App's WS is identified as the LAST one
 * created (drives the status pill). PositionsTable's WS is the
 * remaining one.
 *
 * **Per-WS message log:** the harness tracks `received: string[]`
 * per `WebSocketRoute` so we can assert that a broadcast reached
 * ALL 3 WSes (test 55-2-05) and that a state message sent to a
 * specific subset of WSes did NOT reach the closed one
 * (test 55-2-03). The cumulative `sentFromPage` log from 53C is
 * preserved for backwards-compat with the kill-switch test
 * pattern.
 *
 * **Coverage target:** +5-10pp branches in `ws-client.ts`. The
 * close handler's `shouldScheduleReconnect` predicate and the
 * `nextBackoffMs` cap branch are exercised per-WS instance
 * (3 WSes × reconnect = 3 close-handler runs per test). The
 * `case "error":` non-recoverable branch and the `case "ping":`
 * auto-pong branch are similarly exercised per-WS.
 *
 * **Mount order caveat:** the tests that depend on knowing which
 * WS belongs to which component (55-2-02, 55-2-03, 55-2-04) do
 * NOT hardcode the order. They identify ControlBar's WS
 * dynamically (via the Start button), and identify PositionsTable's
 * WS by elimination. If React's mount order ever changes, these
 * tests will continue to pass — they'll just take a different
 * route through the assertions.
 */

import { type Page, expect, test } from "@playwright/test";
import type { WebSocketRoute } from "@playwright/test";
import { installCoverageHooks } from "./_helpers/coverage.js";

// Phase 57: register coverage collection hooks.
installCoverageHooks("55-2-3ws-architecture");

// =============================================================================
// Test helpers
// =============================================================================

/** Per-WS state — the cumulative list of frames the page SENT on
 *  this specific WS (recorded via Playwright's
 *  `WebSocketRoute.onMessage`, which fires for messages the page
 *  sent to the server). Naming uses the test's perspective:
 *  the test plays the server role, so "sent by the page" is what
 *  the test "received" — but for the ping/pong round-trip
 *  assertion it's clearer to call this `sentFromPage` (what the
 *  page sent in response to a server-initiated frame). */
interface PerWsState {
  readonly route: WebSocketRoute;
  /** Frames the page sent on this WS, in delivery order.
   *  Mutable — we append to it from the routeWebSocket
   *  callback. The harness getter exposes it as `readonly` via
   *  the `ReadonlyArray` return type, but the internal array
   *  itself needs to be mutable. */
  sentFromPage: string[];
}

interface WsTestHarness {
  /** All `WebSocketRoute` instances the page has opened so far. */
  readonly getAllWs: () => readonly WebSocketRoute[];
  /** Cumulative log of every frame the page sent on ANY WS. */
  readonly getSentFromPage: () => readonly string[];
  /** Per-WS log — one entry per WS, with the frames the page sent
   *  on that specific WS. */
  readonly getPerWsSentFromPage: () => readonly PerWsState[];
  /** Send `data` to every active WS. Closed WSes are skipped. */
  readonly broadcast: (data: string) => void;
  /** Send `data` to ONE specific WS. Closed WSes are caught. */
  readonly sendToWs: (ws: WebSocketRoute, data: string) => void;
  /** Close ONE specific WS. */
  readonly closeWs: (
    ws: WebSocketRoute,
    options?: { code?: number; reason?: string },
  ) => Promise<void>;
  /** Close every active WS. */
  readonly closeAll: (
    options?: { code?: number; reason?: string },
  ) => Promise<void>;
  /** Wait until at least `n` WSes have been opened. */
  readonly waitForWsCount: (n: number, timeoutMs?: number) => Promise<void>;
}

async function setupWsPeer(page: Page): Promise<WsTestHarness> {
  // Mock /api/strategies so App.tsx's fetch-on-connect effect
  // completes (otherwise the chart grid won't render and the
  // status pill transition tests become unreliable).
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
            timeframes: ["1h", "4h"],
          },
        ],
      }),
    });
  });

  const allWs: WebSocketRoute[] = [];
  const sentFromPage: string[] = [];
  const perWs: PerWsState[] = [];
  const wsSeenResolvers: (() => void)[] = [];

  await page.routeWebSocket("ws://127.0.0.1:7913/ws", (ws) => {
    allWs.push(ws);
    const state: PerWsState = { route: ws, sentFromPage: [] };
    perWs.push(state);
    ws.onMessage((data) => {
      const s = data.toString();
      sentFromPage.push(s);
      state.sentFromPage.push(s);
    });
    for (const r of wsSeenResolvers.splice(0)) r();
  });

  const waitForWsCount = async (
    n: number,
    timeoutMs = 5_000,
  ): Promise<void> => {
    if (allWs.length >= n) return;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, timeoutMs);
      wsSeenResolvers.push(() => {
        if (allWs.length >= n) {
          clearTimeout(timer);
          resolve();
        }
      });
    });
  };

  return {
    getAllWs: (): readonly WebSocketRoute[] => allWs,
    getSentFromPage: (): readonly string[] => sentFromPage,
    getPerWsSentFromPage: (): readonly PerWsState[] => perWs,
    broadcast: (data: string): void => {
      for (const w of allWs) {
        try {
          w.send(data);
        } catch {
          // best-effort
        }
      }
    },
    sendToWs: (ws: WebSocketRoute, data: string): void => {
      try {
        ws.send(data);
      } catch {
        // best-effort
      }
    },
    closeWs: async (
      ws: WebSocketRoute,
      options?: { code?: number; reason?: string },
    ): Promise<void> => {
      try {
        await ws.close(options);
      } catch {
        // best-effort
      }
    },
    closeAll: async (
      options?: { code?: number; reason?: string },
    ): Promise<void> => {
      for (const w of allWs) {
        try {
          await w.close(options);
        } catch {
          // best-effort
        }
      }
    },
    waitForWsCount,
  };
}

/** Generate 20 synthetic OHLC bars for a (symbol, tf) pair.
 *  Mirrors the bootstrap in the 53C test file. */
function makeBootstrap(symbol: string, tf: string, now: number): unknown[] {
  const intervalMs = tf === "1h" ? 60 * 60_000 : 4 * 60 * 60_000;
  const out: unknown[] = [];
  let price = 67000;
  for (let i = 0; i < 20; i++) {
    const t = now - (19 - i) * intervalMs;
    const open = price;
    const delta = ((i * 7 + 3) % 11) - 5;
    price = Math.max(1, price + delta * 10);
    const close = price;
    out.push({
      time: t,
      open,
      high: Math.max(open, close) + 5,
      low: Math.min(open, close) - 5,
      close,
      volume: 100 + i,
    });
  }
  void symbol;
  return out;
}

/** Drive all WSes to "connected" so the App status pill flips. */
function sendInitialServerMessages(harness: WsTestHarness): void {
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
        timeframes: ["1h", "4h"],
      },
    ],
    ohlcBootstrap: {
      BTCUSDT: {
        "1h": makeBootstrap("BTCUSDT", "1h", now),
        "4h": makeBootstrap("BTCUSDT", "4h", now),
      },
    },
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
}

/**
 * `identifyControlBarWs` — click the Start button and return the
 * WS that received a `{"type":"control","command":"start"}` frame.
 * ControlBar is the only component in the dashboard that sends
 * control commands, so this uniquely identifies its WS.
 */
async function identifyControlBarWs(
  harness: WsTestHarness,
  page: Page,
): Promise<WebSocketRoute> {
  const startBtn = page.locator(
    '.ep-control-bar__btn:has-text("Start")',
  );
  await expect(startBtn).toBeEnabled({ timeout: 5_000 });

  await startBtn.click();

  // The Start button's `onClick` calls `send({type:"control",
  // command:"start"})` which forwards to ControlBar's WS. Wait
  // until at least one WS has sent a frame containing
  // `command: "start"`.
  await expect
    .poll(
      () =>
        harness.getPerWsSentFromPage().some((p) =>
          p.sentFromPage.some((m) => {
            try {
              const parsed = JSON.parse(m) as {
                type?: string;
                command?: string;
              };
              return (
                parsed.type === "control" && parsed.command === "start"
              );
            } catch {
              return false;
            }
          }),
        ),
      { timeout: 3_000, message: "expected Start command on a WS" },
    )
    .toBe(true);

  const found = harness.getPerWsSentFromPage().find((p) =>
    p.sentFromPage.some((m) => {
      try {
        const parsed = JSON.parse(m) as {
          type?: string;
          command?: string;
        };
        return parsed.type === "control" && parsed.command === "start";
      } catch {
        return false;
      }
    }),
  );
  if (found === undefined) {
    throw new Error("ControlBar's WS not found in per-WS log");
  }
  return found.route;
}

/** Build a `state` message with a single open position. */
function stateWithPosition(): string {
  return JSON.stringify({
    type: "state",
    ts: Date.now(),
    snapshot: {},
    positions: [
      {
        id: "pos-test-1",
        symbol: "BTCUSDT",
        side: "long",
        entryPrice: 67000,
        currentPrice: 67500,
        quantity: 0.5,
        leverage: 5,
        unrealizedPnl: 250,
        unrealizedPnlPct: 0.75,
        openedAt: Date.now() - 60_000,
      },
    ],
    closedTrades: [],
    killSwitch: "off",
    paused: false,
    statistics: { trades: 0, pnl: 0, drawdown: 0 },
  });
}

async function gotoAppBare(page: Page): Promise<void> {
  // Same as 53C: do NOT start MSW. We want the page's
  // `new WebSocket(url)` to land on our Playwright-controlled
  // route, not the MSW handler.
  await page.goto("/");
}

// =============================================================================
// Tests
// =============================================================================

test.describe("55-2 — 3-WS architecture coverage", () => {
  test("55-2-01 — dashboard mount opens 3 WSes (App, ControlBar, PositionsTable)", async ({
    page,
  }) => {
    const harness = await setupWsPeer(page);
    await gotoAppBare(page);

    // The dashboard has 3 useWebSocket consumers. Each opens its
    // own connection on mount. We wait for all 3 to be captured
    // by the route handler.
    await harness.waitForWsCount(3, 5_000);

    // Exactly 3 WSes — not 2, not 4. The 53C test file confirms
    // the count empirically (3 = App + ControlBar + PositionsTable).
    expect(harness.getAllWs().length).toBe(3);
  });

  test("55-2-02 — close ControlBar's WS: App status stays 'connected', buttons disabled", async ({
    page,
  }) => {
    const harness = await setupWsPeer(page);
    await gotoAppBare(page);
    await harness.waitForWsCount(3);
    sendInitialServerMessages(harness);

    // App's status pill should be "connected" (driven by App's WS).
    const statusDot = page.locator(".ep-app__status-dot");
    await expect(statusDot).toHaveAttribute("data-status", "connected", {
      timeout: 5_000,
    });

    // Identify ControlBar's WS by clicking Start. The button is
    // currently enabled (status === "connected" on ControlBar's WS).
    const controlBarWs = await identifyControlBarWs(harness, page);

    // Close ONLY ControlBar's WS. The other 2 (App, PositionsTable)
    // stay open. The close event fires on the page's
    // WebSocketClient; the close handler sets status to
    // "disconnected" and schedules a 1s reconnect.
    await harness.closeWs(controlBarWs, {
      code: 1012,
      reason: "server-restart",
    });

    // App's status pill (driven by App's WS, which is unaffected)
    // MUST stay "connected". This proves the WSes are
    // independent — closing one does not affect the others.
    await expect(statusDot).toHaveAttribute("data-status", "connected", {
      timeout: 3_000,
    });

    // ControlBar's `disabled` prop is `status !== "connected"`,
    // so as soon as ControlBar's WS goes "disconnected" the
    // buttons become disabled. Catch the disabled window BEFORE
    // the 1s backoff reconnect fires (after which the buttons
    // re-enable). The 1.5s timeout is well within the 1s
    // backoff + a few ms for the React re-render.
    const startBtn = page.locator(
      '.ep-control-bar__btn:has-text("Start")',
    );
    await expect(startBtn).toBeDisabled({ timeout: 1_500 });
  });

  test("55-2-03 — close PositionsTable's WS: App status stays 'connected', PositionsTable stays empty", async ({
    page,
  }) => {
    const harness = await setupWsPeer(page);
    await gotoAppBare(page);
    await harness.waitForWsCount(3);
    sendInitialServerMessages(harness);

    const statusDot = page.locator(".ep-app__status-dot");
    await expect(statusDot).toHaveAttribute("data-status", "connected", {
      timeout: 5_000,
    });

    // Identify ControlBar's WS so we can pick PositionsTable's
    // by elimination (App's WS is the LAST one created and
    // drives the status pill).
    const controlBarWs = await identifyControlBarWs(harness, page);
    const allWs = harness.getAllWs();
    const appWs = allWs[allWs.length - 1];
    if (appWs === undefined) {
      throw new Error("App's WS (last) not found");
    }
    const positionsTableWs = allWs.find(
      (w) => w !== controlBarWs && w !== appWs,
    );
    if (positionsTableWs === undefined) {
      throw new Error("PositionsTable's WS not found by elimination");
    }

    // Close ONLY PositionsTable's WS. App and ControlBar stay open.
    await harness.closeWs(positionsTableWs, {
      code: 1012,
      reason: "server-restart",
    });

    // Send a state-with-positions ONLY to the 2 still-open WSes
    // (App + ControlBar). PositionsTable's WS is closed, so it
    // will not receive this state. This proves the WSes are
    // independent — sending a state to App+ControlBar does NOT
    // leak to PositionsTable.
    const statePos = stateWithPosition();
    harness.sendToWs(appWs, statePos);
    harness.sendToWs(controlBarWs, statePos);

    // App's status pill stays "connected" (App's WS got the state,
    // status is unaffected by message content).
    await expect(statusDot).toHaveAttribute("data-status", "connected", {
      timeout: 3_000,
    });

    // PositionsTable's WS is closed and didn't get the new state,
    // so its React `lastState` still has `positions: []` (from the
    // initial broadcast). It continues to render the empty state.
    await expect(
      page.locator(".ep-positions--empty"),
    ).toBeVisible({ timeout: 3_000 });
  });

  test("55-2-04 — non-recoverable error to ControlBar's WS only: App stays 'connected', buttons disabled", async ({
    page,
  }) => {
    const harness = await setupWsPeer(page);
    await gotoAppBare(page);
    await harness.waitForWsCount(3);
    sendInitialServerMessages(harness);

    const statusDot = page.locator(".ep-app__status-dot");
    await expect(statusDot).toHaveAttribute("data-status", "connected", {
      timeout: 5_000,
    });

    // Identify ControlBar's WS.
    const controlBarWs = await identifyControlBarWs(harness, page);

    // Send a NON-recoverable error to ControlBar's WS ONLY. The
    // other 2 WSes do not see this message. ControlBar's WS
    // `handleMessage("error")` branch:
    //   1. Notifies error listeners.
    //   2. Sets `closedByCaller = true` (no reconnect).
    //   3. Sets status to "crashed".
    //   4. Closes the socket.
    harness.sendToWs(
      controlBarWs,
      JSON.stringify({
        type: "error",
        ts: Date.now(),
        message: "ControlBar-only FATAL",
        recoverable: false,
      }),
    );

    // App's status pill (driven by App's WS, which is unaffected)
    // MUST stay "connected". The error did not reach App's WS,
    // so App's status is unchanged.
    await expect(statusDot).toHaveAttribute("data-status", "connected", {
      timeout: 3_000,
    });

    // ControlBar's `disabled` prop is `status !== "connected"`.
    // After the non-recoverable error, ControlBar's status is
    // "crashed" → buttons disabled. This state is terminal
    // (no reconnect for crashed clients), so the disabled
    // window is stable indefinitely.
    const startBtn = page.locator(
      '.ep-control-bar__btn:has-text("Start")',
    );
    await expect(startBtn).toBeDisabled({ timeout: 3_000 });
  });

  test("55-2-05 — single broadcast reaches all 3 WSes (each WS sends a pong)", async ({
    page,
  }) => {
    const harness = await setupWsPeer(page);
    await gotoAppBare(page);
    await harness.waitForWsCount(3);
    sendInitialServerMessages(harness);

    await expect(page.locator(".ep-app__status-dot")).toHaveAttribute(
      "data-status",
      "connected",
      { timeout: 5_000 },
    );

    // **Why ping/pong:** Playwright's `WebSocketRoute.onMessage`
    // fires for messages the PAGE sent (client→server), not for
    // messages the page received (server→client). So we cannot
    // directly observe what the page received — but we can use
    // the auto-pong round-trip as a proxy. The `ws-client.ts`
    // `case "ping":` branch auto-responds with
    // `{type:"pong", ts:<original>}` IF (and only if) the ping
    // was received. So if a pong with our unique ts appears in
    // a WS's per-WS sent log, the ping reached that WS.

    // Build a unique ping with a distinctive ts. Use a value
    // that can't collide with Date.now() (the real server never
    // uses such a large ts in the test's lifetime).
    const uniqueTs = 9_999_999_999;
    const uniquePing = JSON.stringify({ type: "ping", ts: uniqueTs });
    harness.broadcast(uniquePing);

    // All 3 WSes must have sent a pong carrying the unique ts.
    // This proves the broadcast reached each of the 3 WSes —
    // a pong cannot be sent without the preceding ping being
    // received by the WSClient.
    await expect
      .poll(
        () => {
          let countWithPong = 0;
          for (const p of harness.getPerWsSentFromPage()) {
            const hasPong = p.sentFromPage.some((m) => {
              try {
                const parsed = JSON.parse(m) as {
                  type?: string;
                  ts?: number;
                };
                return parsed.type === "pong" && parsed.ts === uniqueTs;
              } catch {
                return false;
              }
            });
            if (hasPong) countWithPong += 1;
          }
          return countWithPong;
        },
        {
          timeout: 3_000,
          message: "expected all 3 WSes to send a pong with ts=9999999999",
        },
      )
      .toBe(3);
  });
});
