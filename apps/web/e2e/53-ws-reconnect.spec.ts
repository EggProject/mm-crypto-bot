/**
 * apps/web/e2e/53-ws-reconnect.spec.ts
 *
 * Phase 53C: WebSocket reconnect + error-path coverage. Uses
 * `page.routeWebSocket()` (Playwright 1.48+) to be the WS peer
 * directly, bypassing MSW. The MSW worker is NOT started for
 * these tests — we want the network layer to land on the
 * Playwright-controlled WebSocket, not the MSW WS handler.
 *
 * **Architecture note (Phase 53C discovery):** the apps/web
 * dashboard has 3 `useWebSocket()` consumers (App, ControlBar,
 * PositionsTable), each with its own WebSocket connection. The
 * page's `data-status` pill is driven by App's WS (created LAST
 * because React runs child useEffects before parent useEffects).
 * To make the visible UI transitions reliable, we broadcast
 * server messages to ALL active WS routes — the App's WS will
 * drive the pill, the others will silently process and not
 * affect the DOM (their state lives in a different React
 * component).
 *
 * Tests:
 *   1. ping → pong: peer sends `{type:"ping", ts:42}` to all WSes
 *      and asserts at least one WS sends back
 *      `{type:"pong", ts:42}`.
 *   2. clean close → reconnect: peer closes all WSes with
 *      `code:1012` and asserts the status pill transitions
 *      through disconnected → connecting.
 *   3. non-recoverable error → crashed: peer sends
 *      `{type:"error", recoverable:false}` to all WSes and
 *      asserts the status pill becomes "crashed" + the error
 *      banner is visible.
 *
 * The `/api/strategies` REST endpoint is mocked via `page.route`
 * so the chart grid renders the chrome and `feedMeta` is visible.
 */

import { type Page, expect, test } from "@playwright/test";
import type { WebSocketRoute } from "@playwright/test";

// =============================================================================
// Test helpers
// =============================================================================

/**
 * `makeBootstrap` — generate 20 synthetic OHLC bars for a
 * (symbol, tf) pair. Mirrors the MSW handler in `e2e/mocks/handlers.ts`
 * so the chart grid renders with the same shape it does in the
 * MSW-mocked e2e tests.
 */
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

/**
 * `WsTestHarness` — the test peer. Tracks every WebSocket the
 * page opens (the dashboard has 3 `useWebSocket` consumers:
 * App, ControlBar, PositionsTable). Provides:
 *   - `getAllWs()` — the array of all WebSocketRoute handles
 *     seen so far (mutates as reconnects create new connections).
 *   - `getSentFromPage()` — the cumulative list of messages
 *     the page has sent on ANY of its WSes (for ping/pong assertions).
 *   - `broadcast(message)` — send the same message to all
 *     active WSes (so the App's WS — the one driving the status
 *     pill — receives it).
 *   - `closeAll(opts)` — close all active WSes.
 *   - `waitForWsCount(n)` — wait until N WSes have been opened
 *     (defaults to 3 for the standard dashboard mount).
 */
interface WsTestHarness {
  readonly getAllWs: () => readonly WebSocketRoute[];
  readonly getSentFromPage: () => readonly string[];
  readonly broadcast: (data: string) => void;
  readonly closeAll: (options?: { code?: number; reason?: string }) => Promise<void>;
  readonly waitForWsCount: (n: number, timeoutMs?: number) => Promise<void>;
}

async function setupWsPeer(page: Page): Promise<WsTestHarness> {
  // Mock the REST endpoint that App.tsx fetches on connect.
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
  const wsSeenResolvers: (() => void)[] = [];

  await page.routeWebSocket("ws://127.0.0.1:7913/ws", (ws) => {
    allWs.push(ws);
    ws.onMessage((data) => {
      sentFromPage.push(data.toString());
    });
    // Wake up any waitForWsCount callers.
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
    broadcast: (data: string): void => {
      for (const w of allWs) {
        try {
          w.send(data);
        } catch {
          // best-effort — a closed WS may throw
        }
      }
    },
    closeAll: async (options?: { code?: number; reason?: string }): Promise<void> => {
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

/**
 * `sendInitialServerMessages(harness)` — send HELLO + SNAPSHOT +
 * STATE to all active WSes so the client's `useWebSocket()`
 * transitions to "connected". Without these, the client sits at
 * "connecting" forever and subsequent assertions on the status
 * pill fail.
 */
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
  // NOTE: we intentionally do NOT set `window.MSW_STARTED = true`
  // — that would cause main.tsx to start the MSW worker, which
  // patches the global WebSocket. With MSW active, the page's
  // `new WebSocket(url)` call would land on the MSW handler
  // (because @mswjs/interceptors installs BEFORE Chromium's
  // network layer is queried), not on our Playwright-controlled
  // routeWebSocket peer. Skipping MSW gives Playwright full
  // control over the WS interaction.
  await page.goto("/");
}

// =============================================================================
// Tests
// =============================================================================

test.describe("53C — WS reconnect + error path coverage", () => {
  test("53C-01 — peer ping → client responds with pong carrying the same ts", async ({
    page,
  }) => {
    const harness = await setupWsPeer(page);
    await gotoAppBare(page);
    await harness.waitForWsCount(3);

    // Drive all WSes to "connected".
    sendInitialServerMessages(harness);
    await expect(page.locator(".ep-app__status-dot")).toHaveAttribute(
      "data-status",
      "connected",
      { timeout: 5_000 },
    );

    const sentBeforePong = harness.getSentFromPage().length;

    // Send PING to all WSes. The page's WS client auto-responds
    // with a PONG carrying the same `ts`. We just need ONE pong.
    harness.broadcast(
      JSON.stringify({ type: "ping", ts: 42 }),
    );

    await expect
      .poll(() => harness.getSentFromPage().slice(sentBeforePong), {
        timeout: 3_000,
        message: "expected client to send a PONG with ts=42",
      })
      .toContain(JSON.stringify({ type: "pong", ts: 42 }));
  });

  test("53C-02 — peer close → status pill transitions through disconnected", async ({
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

    // Close all WSes with code 1012 (server restart). The App's
    // WS close handler will:
    //   1. Set status to "disconnected" (synchronous transition).
    //   2. Schedule a reconnect with the next backoff delay.
    //   3. After the backoff elapses, set status to "connecting"
    //      and re-open the WS.
    await harness.closeAll({ code: 1012, reason: "server-restart" });

    // The status pill should leave "connected" — it goes to
    // "disconnected" first (the close handler), then "connecting"
    // when the reconnect timer fires.
    await expect(statusDot).not.toHaveAttribute("data-status", "connected", {
      timeout: 5_000,
    });
    await expect(page.locator('[data-testid="disconnected-banner"]')).toBeVisible();

    // Wait for the backoff timer (1s) to fire and the reconnect
    // attempt to start. The status pill should flip to
    // "connecting" or "connected" (whichever the reconnect
    // produces — Playwright re-fires the route for new
    // connections, so the reconnect should succeed).
    await expect
      .poll(() => statusDot.getAttribute("data-status"), { timeout: 5_000 })
      .toMatch(/connecting|connected/);
  });

  test("53C-03 — peer error(recoverable=false) → status='crashed' + error banner", async ({
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

    // Broadcast a non-recoverable error to all WSes. The App's
    // WS `handleMessage("error")` branch will:
    //   1. Emit to error listeners.
    //   2. Set `closedByCaller = true` (to prevent reconnect).
    //   3. Set status to "crashed".
    //   4. Close the socket.
    harness.broadcast(
      JSON.stringify({
        type: "error",
        ts: Date.now(),
        message: "FATAL",
        recoverable: false,
      }),
    );

    await expect(statusDot).toHaveAttribute("data-status", "crashed", {
      timeout: 3_000,
    });

    // The error banner is visible with the error message.
    const errorBanner = page.locator('[data-testid="error-banner"]');
    await expect(errorBanner).toBeVisible();
    await expect(errorBanner).toContainText("FATAL");
  });
});
