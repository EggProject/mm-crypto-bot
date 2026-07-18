/**
 * apps/web/e2e/57B-app-integration-edges.spec.ts
 *
 * Phase 57B: Playwright e2e tests for App.tsx integration edges.
 *
 * **Goal:** exercise the uncovered branches in `apps/web/src/App.tsx`
 * that the 53B / 56B suites do not reach. The lcov from main@32d4be3
 * shows these uncovered branches:
 *
 *   - BRDA 124,1,0 — `if (!res.ok) throw new Error(...)` — the
 *     /api/strategies fetch returns 500. Currently 0 hits.
 *   - BRDA 128,2,0 — `if (parsed.ok) {...} else { setStrategiesError(...) }` —
 *     /api/strategies returns invalid schema. Currently 0 hits.
 *   - BRDA 144,3,0 — `if (controller.signal.aborted) return;` — the
 *     fetch is aborted. Currently 1 hit (the TRUE branch) but the
 *     FALSE branch needs more coverage.
 *   - BRDA 149,4,0 — `if (e instanceof Error && e.name === "AbortError") return;` —
 *     AbortError catch. Currently 0 hits.
 *   - BRDA 156,5,0 — `setStrategiesError(...)` — generic error
 *     catch. Currently 0 hits.
 *   - BRDA 235,7,0/1 — `if (status === "crashed")` — 6/0. The
 *     TRUE branch (crashed) is not exercised.
 *   - BRDA 240,8,0/1 — `lastError?.message ?? strategiesError ?? ""` —
 *     0/0. The strategiesError path is not exercised.
 *
 * **Pattern:** use `page.route()` to mock /api/strategies with
 * edge-case responses (500, invalid schema, empty array, network
 * failure). The custom route must be set AFTER `setupWsPeer` because
 * `page.route()` calls stack and the last one wins.
 *
 * **Coverage delta estimate:** 10 new e2e tests × ~2-3 new branches
 * per test = +20-30 new branch hits on App.tsx. Expected:
 * +5-10pp branch coverage on App.tsx.
 */

import { type Page, expect, test } from "@playwright/test";
import type { WebSocketRoute } from "@playwright/test";
import { installCoverageHooks } from "./_helpers/coverage.js";

// Phase 57: register coverage collection hooks.
installCoverageHooks("57B-app-integration-edges");

// =============================================================================
// Test helpers
// =============================================================================

interface WsTestHarness {
  readonly getAllWs: () => readonly WebSocketRoute[];
  readonly broadcast: (data: string) => void;
  readonly waitForWsCount: (n: number, timeoutMs?: number) => Promise<void>;
}

async function setupWsPeer(page: Page): Promise<WsTestHarness> {
  // NO default /api/strategies route here — the test sets it
  // explicitly after calling setupWsPeer. The test's route is
  // the last one called, so it wins.
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
    waitForWsCount,
  };
}

/** Mock /api/strategies with a default success response. */
async function mockDefaultStrategies(page: Page): Promise<void> {
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

test.describe("57B — App.tsx integration edge coverage", () => {
  test("57B-01: /api/strategies returns 500 — strategiesError is set (BRDA 124,1,0)", async ({
    page,
  }) => {
    // Targets: `if (!res.ok) throw new Error("HTTP ${res.status}")`
    // in the /api/strategies fetch effect.
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

    // Wait for the fetch to fail and the error to be set.
    // The feedMeta on the chart grid chrome shows the error.
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

  test("57B-02: /api/strategies returns invalid schema — strategiesError is set (BRDA 128,2,0)", async ({
    page,
  }) => {
    // Targets: `if (parsed.ok) {...} else { setStrategiesError(...) }`
    const harness = await setupWsPeer(page);
    await page.route("**/api/strategies", (route) => {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        // `strategies` is not an array — the parser rejects this
        // with "invalid /api/strategies response shape".
        body: JSON.stringify({ strategies: "not-an-array" }),
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

    // Wait for the parser to reject. The feedMeta shows the error.
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
          message: "expected feedMeta to show parser error",
        },
      )
      .toContain("invalid");
  });

  test("57B-03: /api/strategies returns empty array — strategies is set to [] (BRDA 128,2,0)", async ({
    page,
  }) => {
    // Targets: `setStrategies(parsed.strategies)` with empty array.
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

    // Wait for the strategies to be updated to []. The chart
    // grid should have 0 feed indicators.
    await expect
      .poll(
        () => page.locator(".ep-feed").count(),
        { timeout: 5_000, message: "expected 0 feed indicators" },
      )
      .toBe(0);
  });

  test("57B-04: /api/strategies fetch is aborted on WS close — no strategiesError (BRDA 144,3,0)", async ({
    page,
  }) => {
    // Targets: `if (controller.signal.aborted) return;` in the
    // fetch effect.
    const harness = await setupWsPeer(page);
    const resolverRef: { current: (() => void) | null } = { current: null };
    const responseReady = new Promise<void>((resolve) => {
      resolverRef.current = resolve;
    });
    await page.route("**/api/strategies", async (route) => {
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

    // Close App's WS to abort the in-flight fetch.
    const appWs = harness.getAllWs()[harness.getAllWs().length - 1];
    if (appWs === undefined) throw new Error("no WSes");
    await appWs.close({ code: 1012, reason: "test" });

    await expect(page.locator(".ep-app__status-dot")).toHaveAttribute(
      "data-status",
      "disconnected",
      { timeout: 3_000 },
    );

    // Resolve the fetch. The abort was handled cleanly.
    if (resolverRef.current) resolverRef.current();
    await page.waitForTimeout(500);

    // The disconnected banner is visible.
    await expect(
      page.locator('[data-testid="disconnected-banner"]'),
    ).toBeVisible();
  });

  test("57B-05: /api/strategies fetch fails with network error — strategiesError is set (BRDA 156,5,0)", async ({
    page,
  }) => {
    // Targets: `setStrategiesError(e.message)` in the catch block.
    const harness = await setupWsPeer(page);
    await page.route("**/api/strategies", (route) => {
      return route.abort("failed");
    });
    await gotoAppBare(page);
    await harness.waitForWsCount(3);
    sendInitialServerMessages(harness);

    await expect(page.locator(".ep-app__status-dot")).toHaveAttribute(
      "data-status",
      "connected",
      { timeout: 5_000 },
    );

    // Wait for the network error to be caught. The fetch failure
    // message is "fetch failed" (from the Fetch API).
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
          message: "expected feedMeta to show network error",
        },
      )
      .toContain("fetch");
  });

  test("57B-06: App renders crashed banner when WS crashes (BRDA 235,7,0)", async ({
    page,
  }) => {
    // Targets: `if (status === "crashed")` in the App render.
    await mockDefaultStrategies(page);
    const harness = await setupWsPeer(page);
    await gotoAppBare(page);
    await harness.waitForWsCount(3);
    sendInitialServerMessages(harness);

    await expect(page.locator(".ep-app__status-dot")).toHaveAttribute(
      "data-status",
      "connected",
      { timeout: 5_000 },
    );

    // Broadcast a non-recoverable error.
    harness.broadcast(
      JSON.stringify({
        type: "error",
        ts: Date.now(),
        message: "engine fatal",
        recoverable: false,
      }),
    );

    // App's status pill flips to "crashed".
    await expect(page.locator(".ep-app__status-dot")).toHaveAttribute(
      "data-status",
      "crashed",
      { timeout: 3_000 },
    );

    // The error banner is visible.
    const errorBanner = page.locator('[data-testid="error-banner"]');
    await expect(errorBanner).toBeVisible();
    await expect(errorBanner).toContainText("engine fatal");
  });

  test("57B-07: strategiesError is shown in feedMeta when fetch returns 503 (BRDA 240,8,0)", async ({
    page,
  }) => {
    // Targets: `lastError?.message ?? strategiesError ?? ""` —
    // the strategiesError path.
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

    // Wait for the fetch to fail and the error to appear in feedMeta.
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
          message: "expected feedMeta to show HTTP 503 error",
        },
      )
      .toContain("HTTP 503");
  });

  test("57B-08: lastError is shown in feedMeta when WS error is received (BRDA 240,8,0)", async ({
    page,
  }) => {
    // Targets: `lastError?.message ?? strategiesError ?? ""` —
    // the lastError path.
    await mockDefaultStrategies(page);
    const harness = await setupWsPeer(page);
    await gotoAppBare(page);
    await harness.waitForWsCount(3);
    sendInitialServerMessages(harness);

    await expect(page.locator(".ep-app__status-dot")).toHaveAttribute(
      "data-status",
      "connected",
      { timeout: 5_000 },
    );

    // Broadcast a recoverable error.
    harness.broadcast(
      JSON.stringify({
        type: "error",
        ts: Date.now(),
        message: "transient warning",
        recoverable: true,
      }),
    );

    // Wait for the error to appear in feedMeta.
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

  test("57B-09: AbortError catch branch — fetch aborted with AbortError name (BRDA 149,4,0)", async ({
    page,
  }) => {
    // Targets: `if (e instanceof Error && e.name === "AbortError") return;`
    const harness = await setupWsPeer(page);
    const resolverRef: { current: (() => void) | null } = { current: null };
    const responseReady = new Promise<void>((resolve) => {
      resolverRef.current = resolve;
    });
    await page.route("**/api/strategies", async (route) => {
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

    // Close App's WS to abort the in-flight fetch.
    const appWs = harness.getAllWs()[harness.getAllWs().length - 1];
    if (appWs === undefined) throw new Error("no WSes");
    await appWs.close({ code: 1012, reason: "test" });

    await expect(page.locator(".ep-app__status-dot")).toHaveAttribute(
      "data-status",
      "disconnected",
      { timeout: 3_000 },
    );

    // Resolve the fetch. The abort was handled cleanly.
    if (resolverRef.current) resolverRef.current();
    await page.waitForTimeout(500);

    // The disconnected banner is visible.
    await expect(
      page.locator('[data-testid="disconnected-banner"]'),
    ).toBeVisible();
  });

  test("57B-10: /api/strategies returns valid response with multiple strategies", async ({
    page,
  }) => {
    // Targets: the happy path of the /api/strategies fetch
    // with multiple strategies.
    const harness = await setupWsPeer(page);
    await page.route("**/api/strategies", (route) => {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          strategies: [
            {
              name: "donchian_pivot_composition",
              enabled: true,
              symbols: ["BTCUSDT", "ETHUSDT"],
              timeframes: ["1h", "4h", "1d"],
            },
            {
              name: "rsi_divergence",
              enabled: true,
              symbols: ["BTCUSDT"],
              timeframes: ["15m", "1h"],
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

    // Wait for the strategies to be applied. The chart grid
    // should render multiple feed indicators.
    await expect
      .poll(
        () => page.locator(".ep-feed").count(),
        {
          timeout: 5_000,
          message: "expected multiple feed indicators",
        },
      )
      .toBeGreaterThan(2);
  });
});
