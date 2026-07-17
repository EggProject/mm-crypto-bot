/**
 * apps/web/e2e/53-strategies-errors.spec.ts
 *
 * Phase 53C: /api/strategies error-path coverage. The dashboard
 * fetches `GET http://127.0.0.1:7913/api/strategies` on every WS
 * connect. The error paths in `App.tsx`'s `useEffect` are:
 *
 *   1. Non-OK status (e.g. HTTP 500) → `strategiesError = "HTTP 500"`.
 *   2. Malformed response shape (no `strategies` array) →
 *      `strategiesError = "invalid /api/strategies response shape"`.
 *   3. Network error (fetch aborts / fails) →
 *      `strategiesError = e.message` (e.g. "Failed to fetch").
 *
 * In all three cases, the `feedMeta` prop in `App.tsx` is set to
 * the error string, and the `ChartCard` renders it in
 * `<span className="ep-feed__meta">{feedMeta}</span>`.
 *
 * The MSW worker is NOT started. We use `page.route` for
 * /api/strategies to return the desired failure, and
 * `page.routeWebSocket` to drive the WS to "connected" (so the
 * App's useEffect runs and triggers the fetch).
 */

import { type Page, expect, test } from "@playwright/test";
import type { WebSocketRoute } from "@playwright/test";

// =============================================================================
// Test helpers
// =============================================================================

interface WsTestHarness {
  readonly broadcast: (data: string) => void;
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
    waitForWsCount,
  };
}

/** `sendInitialServerMessages(harness)` — drive all WSes to "connected". */
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
      BTCUSDT: { "1h": [], "4h": [] },
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

test.describe("53C — /api/strategies error branches", () => {
  test("53C-06 — HTTP 500: .ep-feed__meta shows 'HTTP 500'", async ({
    page,
  }) => {
    // Mock /api/strategies with a 500 status.
    await page.route("**/api/strategies", (route) => {
      return route.fulfill({
        status: 500,
        contentType: "text/plain",
        body: "Internal Server Error",
      });
    });

    const harness = await setupWsPeer(page);
    await gotoAppBare(page);
    await harness.waitForWsCount(3);
    sendInitialServerMessages(harness);

    await expect
      .poll(
        () =>
          page
            .locator(".ep-feed__meta")
            .filter({ hasText: /HTTP 500/ })
            .count(),
        { timeout: 5_000, message: "expected .ep-feed__meta to show HTTP 500" },
      )
      .toBeGreaterThan(0);
  });

  test("53C-07 — wrong shape: .ep-feed__meta shows 'invalid /api/strategies response shape'", async ({
    page,
  }) => {
    // Mock /api/strategies with HTTP 200 but the wrong JSON shape
    // (no `strategies` array). The dashboard's validation in
    // App.tsx catches this and sets `strategiesError = "invalid
    // /api/strategies response shape"`.
    await page.route("**/api/strategies", (route) => {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ wrong: "shape", no_strategies_field: true }),
      });
    });

    const harness = await setupWsPeer(page);
    await gotoAppBare(page);
    await harness.waitForWsCount(3);
    sendInitialServerMessages(harness);

    await expect
      .poll(
        () =>
          page
            .locator(".ep-feed__meta")
            .filter({ hasText: /invalid.*response shape/ })
            .count(),
        {
          timeout: 5_000,
          message: "expected .ep-feed__meta to show 'invalid response shape'",
        },
      )
      .toBeGreaterThan(0);
  });

  test("53C-08 — abort('failed'): .ep-feed__meta shows the fetch error", async ({
    page,
  }) => {
    // Mock /api/strategies to abort the request (network failure).
    // The dashboard's catch block stores the error message in
    // `strategiesError`. In Chromium, an aborted request results
    // in a TypeError with message "Failed to fetch" — we assert
    // the meta contains "fetch" (case-insensitive) to be
    // version-resilient.
    await page.route("**/api/strategies", (route) => {
      return route.abort("failed");
    });

    const harness = await setupWsPeer(page);
    await gotoAppBare(page);
    await harness.waitForWsCount(3);
    sendInitialServerMessages(harness);

    await expect
      .poll(
        () =>
          page
            .locator(".ep-feed__meta")
            .filter({ hasText: /fetch/i })
            .count(),
        {
          timeout: 5_000,
          message: "expected .ep-feed__meta to contain a fetch error",
        },
      )
      .toBeGreaterThan(0);
  });
});
