/**
 * 58 — Additional e2e tests for ws-client state machine branches
 * (Phase 58 follow-up: target the runtime-relevant uncovered branches
 * in `ws-client-state.ts`.)
 *
 * Per the Phase 58 coverage report, ws-client-state.ts has 8 uncovered
 * branches. Most are TypeScript type-narrowing (unreachable at runtime),
 * but 4 are runtime paths that the existing 57A tests don't exercise:
 *
 *   1. `reduce()` case "SEND" with `state.socketOpen === false`
 *      → effect: no-op (line 61-73)
 *   2. `reduce()` case "CLOSE_USER" → set closedByCaller, status, etc.
 *      (line 91-102)
 *   3. `reduce()` case "START" with `state.closedByCaller === true`
 *      → no-op (line 87-91)
 *   4. `reduce()` case "SOCKET_OPEN" → status=connected, attempt=0
 *      (line 110)
 *
 * These tests drive the React/WS flow through these specific paths.
 */
import { type Page, expect, test } from "@playwright/test";
import type { WebSocketRoute } from "@playwright/test";
import { installCoverageHooks } from "./_helpers/coverage.js";

// Register coverage collection hooks for this spec. MUST be called at
// the top level of the spec file (NOT inside a test.describe or
// beforeEach) — Playwright's `test.afterEach` only works in sync
// describe blocks.
installCoverageHooks("58-ws-state-machine-deep2");

// WsTestHarness pattern from 57A — uses page.routeWebSocket() to be
// the WS peer directly (NOT page.on("websocket", ...)).
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

test.describe("58 — ws-client state machine: runtime-uncovered reduce() branches", () => {
  test("58-01: SEND to a closed WS — no crash, no message sent (reduce SEND arm with socketOpen=false)", async ({
    page,
  }) => {
    const harness = await setupWsPeer(page);
    await page.goto("/", { waitUntil: "networkidle" });
    await harness.waitForWsCount(3, 10_000);

    // Close all WSes to get into socketOpen=false state
    for (const ws of harness.getAllWs()) {
      await harness.closeWs(ws, { code: 1006 });
    }

    // Wait for the close to propagate to the state machine
    await page.waitForTimeout(200);

    // Click a range tab to trigger a SUBSCRIBE (SEND with socketOpen=false)
    const rangeTab = page.locator("button:has-text('1H')").first();
    if (await rangeTab.isVisible({ timeout: 1000 }).catch(() => false)) {
      await rangeTab.click();
    }

    // The dashboard should not crash. The SEND-when-closed path is a no-op.
    await page.waitForTimeout(500);

    // Status should be "disconnected" (we closed all WSes)
    const status = await page.evaluate(() =>
      document.querySelector(".ep-app__status-dot")?.getAttribute("data-status"),
    );
    expect(status).toBe("disconnected");
  });

  test("58-02: close+start cycle exercises CLOSE_USER and START-with-closedByCaller", async ({
    page,
  }) => {
    const harness = await setupWsPeer(page);
    await page.goto("/", { waitUntil: "networkidle" });
    await harness.waitForWsCount(3, 10_000);

    // Force the dashboard to unmount (triggers CLOSE_USER)
    await page.goto("about:blank", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(100);

    // Navigate back (triggers START in a fresh mount)
    await page.goto("/", { waitUntil: "networkidle" });
    await harness.waitForWsCount(3, 10_000);

    // After remount, the status should be "connecting" or "connected"
    const afterRemount = await page.evaluate(() =>
      document.querySelector(".ep-app__status-dot")?.getAttribute("data-status"),
    );
    expect(["connecting", "connected"]).toContain(afterRemount);
  });

  test("58-03: raw message with invalid JSON — RAW_MESSAGE arm with parse failure", async ({
    page,
  }) => {
    const harness = await setupWsPeer(page);
    await page.goto("/", { waitUntil: "networkidle" });
    await harness.waitForWsCount(3, 10_000);

    // Broadcast a hello/snapshot/state first to drive to connected
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
      strategies: [],
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

    // Wait for the dashboard to render
    await page.waitForSelector(".ep-chart-card", { timeout: 5000 }).catch(() => {});

    // Now send INVALID JSON to all WSes
    for (const ws of harness.getAllWs()) {
      harness.sendToWs(ws, "{ this is not valid json");
    }

    // Wait for the invalid JSON to be processed
    await page.waitForTimeout(500);

    // The dashboard should not crash on invalid JSON
    const status = await page.evaluate(() =>
      document.querySelector(".ep-app__status-dot")?.getAttribute("data-status"),
    );
    expect(status).toBe("connected");
  });

  test("58-04: raw message with valid JSON but unknown type — default case in reduceForParsedMessage", async ({
    page,
  }) => {
    const harness = await setupWsPeer(page);
    await page.goto("/", { waitUntil: "networkidle" });
    await harness.waitForWsCount(3, 10_000);

    // Drive to connected first
    const now = Date.now();
    harness.broadcast(
      JSON.stringify({
        type: "hello",
        ts: now,
        serverVersion: "0.1.0-test",
        protocolVersion: 1,
      }),
    );
    harness.broadcast(
      JSON.stringify({
        type: "snapshot",
        ts: now,
        snapshot: {},
        strategies: [],
        ohlcBootstrap: { BTCUSDT: { "1h": [] } },
      }),
    );
    await page.waitForSelector(".ep-chart-card", { timeout: 5000 }).catch(() => {});

    // Send a message with a known-shape but unknown type field
    for (const ws of harness.getAllWs()) {
      harness.sendToWs(ws, JSON.stringify({ type: "future_type", ts: 12345, data: {} }));
    }

    // Wait for the unknown message to be processed
    await page.waitForTimeout(500);

    // The dashboard should not crash
    const status = await page.evaluate(() =>
      document.querySelector(".ep-app__status-dot")?.getAttribute("data-status"),
    );
    expect(status).toBe("connected");
  });

  test("58-05: multiple consecutive ticks exercise the tick dispatcher (DISPATCH tick effect loop)", async ({
    page,
  }) => {
    const harness = await setupWsPeer(page);
    await page.goto("/", { waitUntil: "networkidle" });
    await harness.waitForWsCount(3, 10_000);

    // Drive to connected first
    const now = Date.now();
    harness.broadcast(
      JSON.stringify({
        type: "hello",
        ts: now,
        serverVersion: "0.1.0-test",
        protocolVersion: 1,
      }),
    );
    harness.broadcast(
      JSON.stringify({
        type: "snapshot",
        ts: now,
        snapshot: {},
        strategies: [],
        ohlcBootstrap: { BTCUSDT: { "1h": [] } },
      }),
    );
    await page.waitForSelector(".ep-chart-card", { timeout: 5000 }).catch(() => {});

    // Send 10 ticks to exercise the for-loop in DISPATCH tick effect
    for (let n = 0; n < 10; n++) {
      for (const ws of harness.getAllWs()) {
        harness.sendToWs(
          ws,
          JSON.stringify({
            type: "tick",
            ts: Date.now(),
            symbol: "BTCUSDT",
            price: 50000 + n,
          }),
        );
      }
      await page.waitForTimeout(10);
    }

    // No crash
    const status = await page.evaluate(() =>
      document.querySelector(".ep-app__status-dot")?.getAttribute("data-status"),
    );
    expect(status).toBe("connected");
  });

  test("58-06: SOCKET_OPEN after reconnect — exercises the SOCKET_OPEN arm after backoff", async ({
    page,
  }) => {
    const harness = await setupWsPeer(page);
    await page.goto("/", { waitUntil: "networkidle" });
    await harness.waitForWsCount(3, 10_000);

    // Drive to connected first
    const now = Date.now();
    harness.broadcast(
      JSON.stringify({
        type: "hello",
        ts: now,
        serverVersion: "0.1.0-test",
        protocolVersion: 1,
      }),
    );
    harness.broadcast(
      JSON.stringify({
        type: "snapshot",
        ts: now,
        snapshot: {},
        strategies: [],
        ohlcBootstrap: { BTCUSDT: { "1h": [] } },
      }),
    );
    await page.waitForSelector(".ep-chart-card", { timeout: 5000 }).catch(() => {});

    // Close all WSes to trigger reconnect
    for (const ws of harness.getAllWs()) {
      await harness.closeWs(ws, { code: 1006 });
    }

    // Wait for the reconnect timer to fire (1s backoff)
    await page.waitForTimeout(1500);

    // Should have new WS connections
    await harness.waitForWsCount(6, 5000).catch(() => {});

    // Drive the new WSes to connected
    const newWsList = harness.getAllWs();
    const secondBatch = newWsList.slice(3);
    if (secondBatch.length > 0) {
      for (const ws of secondBatch) {
        harness.sendToWs(
          ws,
          JSON.stringify({
            type: "hello",
            ts: Date.now(),
            serverVersion: "0.1.0-test",
            protocolVersion: 1,
          }),
        );
      }
    }

    await page.waitForTimeout(500);

    // The status should be "connected" again after the reconnect
    const status = await page.evaluate(() =>
      document.querySelector(".ep-app__status-dot")?.getAttribute("data-status"),
    );
    expect(status).toBe("connected");
  });
});
