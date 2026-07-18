/**
 * apps/web/e2e/58B-app-coverage.spec.ts
 *
 * Phase 58B: Additional e2e tests for `apps/web/src/App.tsx`
 * branches that the existing 57B / 56B / dashboard suites miss
 * under the e2e flow.
 *
 * **Targeted branches (per lcov BRDA):**
 *   - BRDA 124 — `if (!res.ok) throw new Error(...)` — HTTP error
 *     path in the /api/strategies fetch.
 *   - BRDA 128 — `if (controller.signal.aborted) return;` (post-body)
 *     — fetch succeeded but the abort signal was fired between
 *     `res.json()` and the post-await setState calls.
 *   - BRDA 149 — `if (controller.signal.aborted) return;` (catch) —
 *     the catch block sees an AbortError; the controller's
 *     signal.aborted is true so we return early (no error to
 *     surface).
 *   - BRDA 156 — `if (msg === null) return;` — the
 *     `buildFetchErrorMessage` helper returned `null` for the
 *     caught error (AbortError specifically).
 *   - BRDA 235 — `if (status === "crashed")` — the crashed banner
 *     render path.
 *   - BRDA 240 — `lastError?.message ?? strategiesError ?? ""` —
 *     the 3-way nullish-coalescing chain in `buildFeedMeta`:
 *       - branch 0: `lastError?.message` is set (WS error wins)
 *       - branch 1: `lastError` is null AND `strategiesError` is
 *         set (strategies fetch error wins)
 *
 * **Pattern:** use `page.route` to mock the REST endpoint,
 * `page.routeWebSocket` to drive the WS to "connected", and
 * broadcast typed messages to drive state transitions.
 *
 * **Coverage delta estimate:** 6 new e2e tests × ~2 new branches
 * per test = +10-12 new branch hits on App.tsx. Expected: 41.66%
 * → 75-90% branch coverage on App.tsx.
 */

import { type Page, expect, test } from "@playwright/test";
import type { WebSocketRoute } from "@playwright/test";
import { installCoverageHooks } from "./_helpers/coverage.js";

// Phase 58B: register coverage collection hooks.
installCoverageHooks("58B-app-coverage");

// =============================================================================
// Test helpers
// =============================================================================

interface WsTestHarness {
  readonly getAllWs: () => readonly WebSocketRoute[];
  readonly broadcast: (data: string) => void;
  readonly sendToWs: (ws: WebSocketRoute, data: string) => void;
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
            timeframes: ["1h", "4h"],
          },
        ],
      }),
    });
  });

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
    getAllWs: (): readonly WebSocketRoute[] => allWs,
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
    waitForWsCount,
  };
}

function makeBootstrap(symbol: string, tf: string, now: number): unknown[] {
  void symbol;
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
  return out;
}

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

async function gotoAppBare(page: Page): Promise<void> {
  await page.goto("/");
}

// =============================================================================
// Tests
// =============================================================================

test.describe("58B — App.tsx branch coverage", () => {
  test("58B-A01: /api/strategies HTTP 500 — non-OK throw path (BRDA 124 TRUE)", async ({
    page,
  }) => {
    // Targets: BRDA 124,0 (the `!res.ok` TRUE arm — HTTP error
    // throws a `new Error("HTTP 500")`). The catch block runs,
    // and `buildFetchErrorMessage` returns "HTTP 500" (msg !== null),
    // so setStrategiesError("HTTP 500") is called.
    const harness = await setupWsPeer(page);
    await page.route("**/api/strategies", (route) => {
      return route.fulfill({
        status: 500,
        contentType: "text/plain",
        body: "Internal Server Error",
      });
    });
    await gotoAppBare(page);
    await harness.waitForWsCount(3);
    sendInitialServerMessages(harness);

    await expect(page.locator(".ep-app__status-dot")).toHaveAttribute(
      "data-status",
      "connected",
      { timeout: 5_000 },
    );

    // The catch block runs and sets strategiesError. The feedMeta
    // shows "HTTP 500" via the `lastError?.message ?? strategiesError ?? ""`
    // chain (line 240 branch 1).
    await expect
      .poll(
        () => {
          return page
            .locator(".ep-feed__meta")
            .first()
            .textContent()
            .catch(() => null);
        },
        { timeout: 5_000, message: "expected feedMeta to show HTTP 500" },
      )
      .toContain("HTTP 500");
  });

  test("58B-A02: WS close during /api/strategies fetch — AbortError catch (BRDA 149, 156 TRUE)", async ({
    page,
  }) => {
    // Targets: BRDA 149 (the `if (controller.signal.aborted) return;`
    // TRUE arm in the catch block) AND BRDA 156 (the
    // `if (msg === null) return;` TRUE arm). The fetch is aborted
    // when the WS closes, the AbortError is caught, the
    // controller.signal.aborted is true, and
    // buildFetchErrorMessage returns null for AbortError.
    const harness = await setupWsPeer(page);
    const resolverRef: { current: (() => void) | null } = { current: null };
    const responseReady = new Promise<void>((resolve) => {
      resolverRef.current = resolve;
    });
    await page.route("**/api/strategies", async (route) => {
      // Wait until the test signals, then fulfill. This blocks
      // the fetch resolution until we close the WS, which triggers
      // the AbortController in the App's useEffect cleanup.
      await responseReady;
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
    await gotoAppBare(page);
    await harness.waitForWsCount(3);
    sendInitialServerMessages(harness);

    await expect(page.locator(".ep-app__status-dot")).toHaveAttribute(
      "data-status",
      "connected",
      { timeout: 5_000 },
    );

    // Close App's WS. The useEffect cleanup runs, calling
    // controller.abort(). The in-flight fetch is cancelled.
    const allWs = harness.getAllWs();
    const appWs = allWs[allWs.length - 1];
    if (appWs === undefined) throw new Error("no WSes");
    await appWs.close({ code: 1012, reason: "test" });

    await expect(page.locator(".ep-app__status-dot")).toHaveAttribute(
      "data-status",
      "disconnected",
      { timeout: 3_000 },
    );

    // Resolve the pending fetch. The abort was handled cleanly
    // (AbortError → controller.signal.aborted → return early).
    if (resolverRef.current) resolverRef.current();
    await page.waitForTimeout(500);

    // No error to surface (buildFetchErrorMessage returned null).
    // The disconnected banner is visible (status === "disconnected").
    await expect(
      page.locator('[data-testid="disconnected-banner"]'),
    ).toBeVisible();
  });

  test("58B-A03: WS error message drives feedMeta via lastError (BRDA 240,0 TRUE)", async ({
    page,
  }) => {
    // Targets: BRDA 240,0 (the `lastError?.message ?? strategiesError
    // ?? ""` chain — the WS error wins when both are set). We send
    // a recoverable error to set lastError without crashing.
    const harness = await setupWsPeer(page);
    await gotoAppBare(page);
    await harness.waitForWsCount(3);
    sendInitialServerMessages(harness);

    await expect(page.locator(".ep-app__status-dot")).toHaveAttribute(
      "data-status",
      "connected",
      { timeout: 5_000 },
    );

    // Send a recoverable WS error. lastError is set; status stays
    // "connected". The feedMeta shows the error message.
    harness.broadcast(
      JSON.stringify({
        type: "error",
        ts: Date.now(),
        message: "transient warning",
        recoverable: true,
      }),
    );

    await expect
      .poll(
        () => {
          return page
            .locator(".ep-feed__meta")
            .first()
            .textContent()
            .catch(() => null);
        },
        {
          timeout: 5_000,
          message: "expected feedMeta to show 'transient warning'",
        },
      )
      .toContain("transient warning");
  });

  test("58B-A04: /api/strategies error + WS error — lastError wins in feedMeta chain (BRDA 240,0 TRUE + 240,1 FALSE)", async ({
    page,
  }) => {
    // Targets: BRDA 240,0 (the `lastError?.message` arm) AND
    // BRDA 240,1 (the `strategiesError` arm — covered when
    // lastError is null). The chain is `lastError?.message ??
    // strategiesError ?? ""`. With BOTH set, the first wins.
    const harness = await setupWsPeer(page);
    await page.route("**/api/strategies", (route) => {
      return route.fulfill({
        status: 503,
        contentType: "text/plain",
        body: "Service Unavailable",
      });
    });
    await gotoAppBare(page);
    await harness.waitForWsCount(3);
    sendInitialServerMessages(harness);

    await expect(page.locator(".ep-app__status-dot")).toHaveAttribute(
      "data-status",
      "connected",
      { timeout: 5_000 },
    );

    // The strategies error is set (HTTP 503 → "HTTP 503").
    await expect
      .poll(
        () => {
          return page
            .locator(".ep-feed__meta")
            .first()
            .textContent()
            .catch(() => null);
        },
        {
          timeout: 5_000,
          message: "expected feedMeta to show HTTP 503 first",
        },
      )
      .toContain("HTTP 503");

    // Now send a WS error. lastError is set, lastError?.message
    // wins in the chain. The feedMeta updates to the WS error.
    harness.broadcast(
      JSON.stringify({
        type: "error",
        ts: Date.now(),
        message: "ws-error-after-fetch-error",
        recoverable: true,
      }),
    );

    await expect
      .poll(
        () => {
          return page
            .locator(".ep-feed__meta")
            .first()
            .textContent()
            .catch(() => null);
        },
        {
          timeout: 5_000,
          message: "expected feedMeta to show 'ws-error-after-fetch-error'",
        },
      )
      .toContain("ws-error-after-fetch-error");
  });

  test("58B-A05: /api/strategies returns strategies:[] — setStrategies([]) + setStrategiesError(null)", async ({
    page,
  }) => {
    // Targets: BRDA around line 145-147 (the `next.strategies !== null`
    // check + setStrategiesError in the ok branch). When the
    // fetch returns an empty strategies array, the ok branch is
    // taken, setStrategies([]) is called, and setStrategiesError(null)
    // is called.
    const harness = await setupWsPeer(page);
    await page.route("**/api/strategies", (route) => {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ strategies: [] }),
      });
    });
    await gotoAppBare(page);
    await harness.waitForWsCount(3);
    sendInitialServerMessages(harness);

    await expect(page.locator(".ep-app__status-dot")).toHaveAttribute(
      "data-status",
      "connected",
      { timeout: 5_000 },
    );

    // The strategies become []. The chart grid's empty state
    // check is: strategies.length === 0 → render the empty
    // placeholder. No feed indicators are visible.
    await expect
      .poll(
        () => page.locator(".ep-feed").count(),
        { timeout: 5_000, message: "expected 0 feed indicators" },
      )
      .toBe(0);

    // The empty state is rendered.
    await expect(page.locator(".ep-chart-grid__empty")).toBeVisible();
  });

  test("58B-A06: WS crash with lastError → render crashed banner + feedMeta (BRDA 235 TRUE, 240 lastError arm)", async ({
    page,
  }) => {
    // Targets: BRDA 235 (the `if (status === "crashed")` render
    // path) AND BRDA 240 (the lastError?.message arm with a
    // non-null message). Sending a non-recoverable error flips
    // status to "crashed" and sets lastError with the message.
    const harness = await setupWsPeer(page);
    await gotoAppBare(page);
    await harness.waitForWsCount(3);
    sendInitialServerMessages(harness);

    await expect(page.locator(".ep-app__status-dot")).toHaveAttribute(
      "data-status",
      "connected",
      { timeout: 5_000 },
    );

    // Send a non-recoverable error. Status → "crashed".
    harness.broadcast(
      JSON.stringify({
        type: "error",
        ts: Date.now(),
        message: "engine fatal",
        recoverable: false,
      }),
    );

    await expect(page.locator(".ep-app__status-dot")).toHaveAttribute(
      "data-status",
      "crashed",
      { timeout: 3_000 },
    );

    // The crashed banner is visible (BRDA 235 TRUE).
    const errorBanner = page.locator('[data-testid="error-banner"]');
    await expect(errorBanner).toBeVisible();
    await expect(errorBanner).toContainText("engine fatal");

    // The feed indicators show the error (lastError is set).
    await expect
      .poll(
        () => {
          return page
            .locator(".ep-feed__meta")
            .first()
            .textContent()
            .catch(() => null);
        },
        { timeout: 5_000, message: "expected feedMeta to show 'engine fatal'" },
      )
      .toContain("engine fatal");
  });
});
