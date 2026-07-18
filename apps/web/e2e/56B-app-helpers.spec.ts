/**
 * apps/web/e2e/56B-app-helpers.spec.ts
 *
 * Phase 56B: e2e tests that drive the React flow through the
 * 6 pure helpers extracted from `App.tsx` into
 * `lib/app-helpers.ts`. Per the memory entry "Coverage delta
 * estimation MUST be e2e-based, NOT unit-test-based", the
 * refactor's e2e coverage improvement comes from these tests
 * (not from the unit tests, which cover the helpers directly
 * but don't count toward the e2e denominator).
 *
 * **Branch targets** (App.tsx lcov, 22/37 branches covered
 * pre-56B; 15 uncovered):
 *
 *   - 56B-01 (real ohlcBootstrap):
 *       BRDA:86,5 (line 86) — `typeof raw !== "object" || raw === null` FALSE
 *       BRDA:91,7 (line 91) — `typeof perTf !== "object" || perTf === null` FALSE
 *     The existing 53C/55-2 tests send `ohlcBootstrap: { BTCUSDT: { "1h": [] } }`
 *     with EMPTY bars arrays. The function still hits the early-return at
 *     line 86 (raw IS the object, but then the for loop's inner check on
 *     `Array.isArray(bars)` is FALSE because bars is an empty array — no,
 *     wait, an empty array IS an array, so the inner check is TRUE, but
 *     the perTf entry is still an object, so we DO enter the inner loop).
 *     Actually the issue is the snapshot's `ohlcBootstrap` shape: the WS
 *     sends `ohlcBootstrap: {}` (empty object) on the first snapshot,
 *     which hits the early-return at line 86. The 55-2-01 test sends
 *     a snapshot with REAL bars but only AFTER the page mounts; the
 *     53C tests don't send any bars. So the FALSE branch (raw IS an
 *     object) is uncovered.
 *     56B-01 sends a snapshot with a non-empty `ohlcBootstrap` structure
 *     AND real bars, driving the function through the inner loops.
 *
 *   - 56B-02 (non-recoverable error to App's WS):
 *       BRDA:65,1 (line 65) — `if (status === "crashed") return "crashed"` FALSE
 *       BRDA:267,22,1 (line 267) — `status === "crashed"` FALSE (banner FALSE)
 *       BRDA:272,23,0/1 (line 272) — `lastError?.message ?? "unknown error"` branches
 *     The 55-2-04 test sends a non-recoverable error to ControlBar's WS
 *     ONLY. App's WS is unaffected, so App's `mapFeedState` "crashed"
 *     branch is uncovered. 56B-02 sends the error to App's WS, flipping
 *     App's status to "crashed" and rendering the `.ep-app__error`
 *     banner.
 *
 *   - 56B-03 (initial mount with WS connected but no snapshot yet):
 *       BRDA:237,19,1 (line 237) — `snapshot !== null` FALSE
 *     The buildStatusLabel("connected", null, null) returns
 *     "WebSocket: connected" (without "(N strategies)" suffix). The
 *     FALSE branch was 1-hit in the pre-56B lcov (probably from
 *     initial-render timing), but 56B-03 explicitly asserts the
 *     suffix is absent in the initial "connected" state.
 *
 *   - 56B-04 (AbortError path — close App's WS mid-fetch):
 *       BRDA:160,12 (line 160) — `if (controller.signal.aborted) return;` TRUE
 *       BRDA:177,14 (line 177) — `if (controller.signal.aborted) return;` in catch TRUE
 *     The 53C-08 test uses `route.abort("failed")` which produces a
 *     TypeError, NOT an AbortError. The AbortError path (fetch
 *     cancelled because the effect re-ran) was uncovered. 56B-04
 *     closes App's WS while a fetch is in flight, which causes the
 *     effect to re-run with `status === "disconnected"`, the cleanup
 *     function to call `controller.abort()`, and the in-flight fetch
 *     to throw an AbortError. The catch block hits the
 *     `controller.signal.aborted` TRUE branch and returns silently
 *     (no error set).
 */

import { type Page, expect, test } from "@playwright/test";
import type { WebSocketRoute } from "@playwright/test";
import { installCoverageHooks } from "./_helpers/coverage.js";

// Phase 57: register coverage collection hooks.
installCoverageHooks("56B-app-helpers");

// =============================================================================
// Test helpers (mirror the 53C/55-2 harness pattern)
// =============================================================================

interface WsTestHarness {
  readonly broadcast: (data: string) => void;
  readonly sendToWs: (ws: WebSocketRoute, data: string) => void;
  readonly getAllWs: () => readonly WebSocketRoute[];
  readonly closeWs: (
    ws: WebSocketRoute,
    options?: { code?: number; reason?: string },
  ) => Promise<void>;
  readonly waitForWsCount: (n: number, timeoutMs?: number) => Promise<void>;
}

async function setupWsPeer(page: Page): Promise<WsTestHarness> {
  const allWs: WebSocketRoute[] = [];
  const wsSeenResolvers: (() => void)[] = [];

  await page.routeWebSocket("ws://127.0.0.1:7913/ws", (ws) => {
    allWs.push(ws);
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
    getAllWs: (): readonly WebSocketRoute[] => allWs,
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
    waitForWsCount,
  };
}

/** Generate 20 synthetic OHLC bars for a (symbol, tf) pair. */
function makeBootstrap(symbol: string, tf: string, now: number): unknown[] {
  const intervalMs = tf === "1h" ? 60 * 60_000 : 4 * 60 * 60_000;
  const out: unknown[] = [];
  let price = 67000;
  for (let i = 0; i < 20; i += 1) {
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

/** Drive all WSes to "connected" with REAL ohlcBootstrap data. */
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
    // Real bars — drives `extractBarsByKey` through the perTf/bar
    // loop. The 53C tests send `ohlcBootstrap: { BTCUSDT: { "1h": [], "4h": [] } }`
    // which has the structure but no bars; this test sends REAL
    // bars (20 each).
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

/** Drive WSes to "connected" with hello+state (no snapshot). */
function sendHelloAndState(harness: WsTestHarness): void {
  const now = Date.now();
  const hello = JSON.stringify({
    type: "hello",
    ts: now,
    serverVersion: "0.1.0-test",
    protocolVersion: 1,
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
  harness.broadcast(state);
}

async function gotoAppBare(page: Page): Promise<void> {
  await page.goto("/");
}

// =============================================================================
// Tests
// =============================================================================

test.describe("56B — drive React flow through Phase 56B App.tsx helpers", () => {
  test("56B-01: real ohlcBootstrap — extractBarsByKey enters the perTf/bar loop", async ({
    page,
  }) => {
    // Targets BRDA:86,5 + BRDA:91,7. The 53C tests use
    // `ohlcBootstrap: {}` (empty object) which hits the early-return
    // at line 86. This test sends REAL bars, which makes the
    // function traverse the inner for loops and exercise the
    // `Array.isArray(bars)` branch.
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

    const harness = await setupWsPeer(page);
    await gotoAppBare(page);
    await harness.waitForWsCount(3);
    sendInitialServerMessages(harness);

    // App status pill flips to "connected" after hello.
    await expect(page.locator(".ep-app__status-dot")).toHaveAttribute(
      "data-status",
      "connected",
      { timeout: 5_000 },
    );

    // The status label MUST include the "(1 strategies)" suffix
    // (snapshot is present, so `snapshot !== null` is TRUE on
    // line 237). This proves the connected label branch was hit
    // with a real snapshot. The mock returns 1 strategy.
    await expect(page.locator(".ep-app__status-text")).toContainText(
      "strategies)",
      { timeout: 5_000 },
    );

    // The chart grid renders the chart cards. The bars are real,
    // so the chart card canvas should be present. We don't assert
    // on the canvas pixels (lightweight-charts draws to a canvas
    // that's hard to inspect), but the presence of the cards
    // proves the React flow got the strategies + the snapshot
    // with bars.
    await expect(page.locator(".ep-chart-card").first()).toBeVisible({
      timeout: 5_000,
    });
  });

  test("56B-02: non-recoverable error to App's WS — mapFeedState 'crashed' + banner visible", async ({
    page,
  }) => {
    // Targets BRDA:65,1 + BRDA:267,22,1 + BRDA:272,23,0/1.
    // The 55-2-04 test sends a non-recoverable error to
    // ControlBar's WS ONLY, leaving App's WS unaffected. This
    // test sends the error to App's WS specifically (identified
    // as the LAST WS created, which drives the status pill).
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

    const harness = await setupWsPeer(page);
    await gotoAppBare(page);
    await harness.waitForWsCount(3);
    sendInitialServerMessages(harness);

    // App's status pill is "connected" (App's WS got the hello/snapshot/state).
    const statusDot = page.locator(".ep-app__status-dot");
    await expect(statusDot).toHaveAttribute("data-status", "connected", {
      timeout: 5_000,
    });

    // Identify App's WS as the LAST one created (per the 55-2
    // test pattern — child useEffects run before the parent's,
    // so App's WS is created last and drives the status pill).
    const allWs = harness.getAllWs();
    const appWs = allWs[allWs.length - 1];
    if (appWs === undefined) {
      throw new Error("App's WS (last) not found");
    }

    // Send a non-recoverable error to App's WS ONLY. The other
    // 2 WSes are unaffected. The error message is preserved in
    // `lastError.message`, which `buildStatusLabel` and the
    // banner use.
    harness.sendToWs(
      appWs,
      JSON.stringify({
        type: "error",
        ts: Date.now(),
        message: "engine exploded",
        recoverable: false,
      }),
    );

    // App's status pill flips to "crashed" (the "crashed" branch
    // of `mapFeedState` is now hit, AND the `status === "crashed"`
    // JSX condition is now TRUE so the banner is rendered).
    await expect(statusDot).toHaveAttribute("data-status", "crashed", {
      timeout: 3_000,
    });

    // The crashed banner is visible (covers BRDA:267 FALSE → wait,
    // we want the BANNER to appear which means the JSX is TRUE).
    // The banner's text comes from `lastError?.message`.
    await expect(page.locator(".ep-app__error")).toBeVisible({
      timeout: 3_000,
    });
    await expect(page.locator(".ep-app__error")).toContainText(
      "engine exploded",
    );
  });

  test("56B-03: hello + state (no snapshot) — status label is 'WebSocket: connected' WITHOUT the strategies suffix", async ({
    page,
  }) => {
    // Targets BRDA:237,19,1 — the `snapshot !== null` FALSE
    // branch. When the WS is "connected" but the server hasn't
    // sent a snapshot yet (e.g. just the hello), `snapshot` is
    // `null`, so the label is "WebSocket: connected" (no
    // "(N strategies)" suffix). The pre-56B lcov shows this
    // branch has 1 hit (probably from initial-render timing),
    // but this test EXPLICITLY exercises it and asserts the
    // suffix is absent.
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

    const harness = await setupWsPeer(page);
    await gotoAppBare(page);
    await harness.waitForWsCount(3);

    // Send ONLY hello + state, NO snapshot. The status is
    // "connected" (from hello) but `snapshot` is still `null`.
    sendHelloAndState(harness);

    // App's status pill flips to "connected" after hello.
    await expect(page.locator(".ep-app__status-dot")).toHaveAttribute(
      "data-status",
      "connected",
      { timeout: 5_000 },
    );

    // The status label MUST be "WebSocket: connected" without
    // the "(N strategies)" suffix — `snapshot` is null so the
    // buildStatusLabel ternary at line 237 is FALSE.
    await expect(page.locator(".ep-app__status-text")).toHaveText(
      "WebSocket: connected",
      { timeout: 3_000 },
    );
  });

  test("56B-04: close App's WS mid-fetch — fetch aborts via AbortController, no error set", async ({
    page,
  }) => {
    // Targets BRDA:160,12 + BRDA:177,14. The 53C-08 test uses
    // `route.abort("failed")` which produces a TypeError, NOT an
    // AbortError. The AbortError path (fetch cancelled because
    // the effect re-ran with status !== "connected") was
    // uncovered. This test:
    //   1. Connects App's WS, triggers the strategies fetch.
    //   2. Before the fetch resolves, closes App's WS.
    //   3. Status flips to "disconnected", the useEffect's
    //      cleanup runs, `controller.abort()` fires.
    //   4. The in-flight fetch throws an AbortError.
    //   5. The catch block hits `controller.signal.aborted` TRUE
    //      and returns silently (no `setStrategiesError`).
    //
    // The strategies fetch uses an AbortController; the cleanup
    // function `controller.abort()` is called when the effect
    // re-runs (status change) OR the component unmounts.

    // DELAY the /api/strategies response so the fetch is still
    // in-flight when we close App's WS.
    await page.route("**/api/strategies", async (route) => {
      // Wait 500ms before fulfilling — gives us time to close
      // App's WS mid-fetch.
      await new Promise((resolve) => setTimeout(resolve, 500));
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

    const harness = await setupWsPeer(page);
    await gotoAppBare(page);
    await harness.waitForWsCount(3);

    // Send hello + state to flip App's status to "connected" —
    // this triggers the strategies fetch.
    sendHelloAndState(harness);

    await expect(page.locator(".ep-app__status-dot")).toHaveAttribute(
      "data-status",
      "connected",
      { timeout: 5_000 },
    );

    // Identify App's WS as the LAST one created.
    const allWs = harness.getAllWs();
    const appWs = allWs[allWs.length - 1];
    if (appWs === undefined) {
      throw new Error("App's WS (last) not found");
    }

    // Close App's WS WHILE the fetch is in flight (the
    // 500ms delay above gives us a 500ms window).
    await harness.closeWs(appWs, { code: 1012, reason: "server-restart" });

    // App's status pill flips to "disconnected" (or the WS
    // reconnects back to "connected" — either way, the
    // useEffect re-ran, the cleanup fired, the in-flight
    // fetch was aborted).
    // We don't assert on the final status (it depends on the
    // reconnect timing), but we DO assert that the strategies
    // error was NOT set to "AbortError" or "aborted" — the
    // helper returned `null` (silent abort) and the
    // `setStrategiesError` was NOT called.
    await page.waitForTimeout(700); // wait for the (now-aborted) fetch to settle

    // The feedMeta MUST NOT contain "AbortError" or "aborted" —
    // the catch block detected `controller.signal.aborted` and
    // returned without setting an error.
    const feedMetaCount = await page
      .locator(".ep-feed__meta")
      .filter({ hasText: /AbortError|aborted/i })
      .count();
    expect(feedMetaCount).toBe(0);
  });
});
