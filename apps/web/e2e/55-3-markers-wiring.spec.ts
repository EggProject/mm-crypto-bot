/**
 * apps/web/e2e/55-3-markers-wiring.spec.ts
 *
 * Phase 55-3: e2e tests for the new marker pipeline — WS
 * `marker` messages are accumulated per (symbol, timeframe)
 * chart key and surfaced as a "Trade markers (N)" legend item
 * on the ChartCard. Previously the marker branch in
 * `App.tsx:markersByKey = {{}}` was hardcoded empty, so the
 * `markersAreVisible(markers)` branch in ChartCard.tsx was
 * dead in the e2e suite.
 *
 * Tests target 3 e2e branches that the new wire-up unlocks:
 *   55-3-01: `markersAreVisible` TRUE branch in ChartCard.
 *   55-3-02: 2-marker accumulation in App.tsx.
 *   55-3-03: multi-symbol fanout — a single marker for a
 *     2-symbol strategy appears in BOTH chart cards.
 */

import { type Page, expect, test } from "@playwright/test";
import type { WebSocketRoute } from "@playwright/test";

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
        timeframes: ["1h"],
      },
    ],
    ohlcBootstrap: {
      BTCUSDT: { "1h": [] },
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
            timeframes: ["1h"],
          },
        ],
      }),
    });
  });
}

async function mockMultiSymbolStrategies(page: Page): Promise<void> {
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
            timeframes: ["1h"],
          },
        ],
      }),
    });
  });
}

test.describe("55-3 — wire markersByKey to the WS stream", () => {
  test("55-3-01: marker WS message → 'Trade markers (1)' legend item appears in the chart card", async ({
    page,
  }) => {
    await mockDefaultStrategies(page);

    const harness = await setupWsPeer(page);
    await page.goto("/");
    await harness.waitForWsCount(3);
    sendInitialServerMessages(harness);

    await expect(page.locator(".ep-chart-card").first()).toBeVisible({
      timeout: 5_000,
    });

    await expect(page.locator("text=Trade markers")).toHaveCount(0);

    harness.broadcast(
      JSON.stringify({
        type: "marker",
        ts: Date.now(),
        strategy: "donchian_pivot_composition",
        timeframe: "1h",
        side: "long",
        price: 100,
        label: "L1",
      }),
    );

    await expect(page.locator("text=Trade markers (1)")).toBeVisible({
      timeout: 5_000,
    });
  });

  test("55-3-02: two marker messages → 'Trade markers (2)' (marker accumulation)", async ({
    page,
  }) => {
    await mockDefaultStrategies(page);

    const harness = await setupWsPeer(page);
    await page.goto("/");
    await harness.waitForWsCount(3);
    sendInitialServerMessages(harness);

    await expect(page.locator(".ep-chart-card").first()).toBeVisible({
      timeout: 5_000,
    });

    harness.broadcast(
      JSON.stringify({
        type: "marker",
        ts: 1_700_000_000_000,
        strategy: "donchian_pivot_composition",
        timeframe: "1h",
        side: "long",
        price: 100,
        label: "L1",
      }),
    );

    await expect(page.locator("text=Trade markers (1)")).toBeVisible({
      timeout: 5_000,
    });

    // Give the rAF batcher + React render + `setMarkers` effect
    // a beat to settle before the 2nd broadcast — otherwise the
    // 2nd message might race the first state update and the
    // legend would still show "(1)".
    await page.waitForTimeout(50);

    harness.broadcast(
      JSON.stringify({
        type: "marker",
        ts: 1_700_000_100_000,
        strategy: "donchian_pivot_composition",
        timeframe: "1h",
        side: "short",
        price: 110,
        label: "S1",
      }),
    );

    await expect(page.locator("text=Trade markers (2)")).toBeVisible({
      timeout: 5_000,
    });
  });

  test("55-3-03: multi-symbol fanout — a single marker for a 2-symbol strategy appears in BOTH chart cards", async ({
    page,
  }) => {
    await mockMultiSymbolStrategies(page);

    const harness = await setupWsPeer(page);
    await page.goto("/");
    await harness.waitForWsCount(3);

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
          symbols: ["BTCUSDT", "ETHUSDT"],
          timeframes: ["1h"],
        },
      ],
      ohlcBootstrap: {
        BTCUSDT: { "1h": [] },
        ETHUSDT: { "1h": [] },
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

    await expect(page.locator(".ep-chart-card")).toHaveCount(2, {
      timeout: 5_000,
    });

    harness.broadcast(
      JSON.stringify({
        type: "marker",
        ts: 1_700_000_000_000,
        strategy: "donchian_pivot_composition",
        timeframe: "1h",
        side: "long",
        price: 100,
        label: "L1",
      }),
    );

    await expect(page.locator("text=Trade markers (1)")).toHaveCount(2, {
      timeout: 5_000,
    });
  });
});
