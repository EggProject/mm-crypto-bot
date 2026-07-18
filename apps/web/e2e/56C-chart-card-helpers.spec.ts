/**
 * apps/web/e2e/56C-chart-card-helpers.spec.ts
 *
 * Phase 56C: e2e tests that drive the React flow through the
 * 18-uncovered-branch helpers extracted from `ChartCard.tsx`
 * into `lib/chart-card-helpers.ts` (see that file's top-of-file
 * comment for the full list).
 *
 * Per the memory entry "Coverage delta estimation MUST be
 * e2e-based, NOT unit-test-based": these tests are the
 * e2e-coverage-positive contribution. The unit tests added in
 * `lib/__tests__/chart-card-helpers.test.ts` make the helper
 * file itself 100% covered, but they don't move the
 * `ChartCard.tsx` e2e denominator. THIS file does.
 *
 * **Per-test target:**
 *   - 56C-01: empty bars via WS snapshot → bars effect empty branch
 *             (BRDA 362,10 / 366,11)
 *   - 56C-02: recoverable error → feedMeta non-empty → legend meta
 *             (BRDA 515,20,2 RHS)
 *   - 56C-03: viewport resize → ResizeObserver callback fires
 *             (BRDA 445,14)
 *   - 56C-04: range tab click → isActive + handleRangeClick branches
 *             (BRDA 472,17 / 475,18)
 *   - 56C-05: close WS → feed state "disconnected" → FEED_CONFIG lookup
 *             (BRDA 478,19)
 *
 * The markers-effect branches (BRDA 343,5 / 349,8 / 352,9) are
 * unit-tested via `toSeriesMarkerMs` only — App.tsx passes
 * `markersByKey={{}}` so the React flow can't pass markers
 * through without rewiring the parent (out of scope for 56C;
 * that's 56B's territory).
 *
 * The SSR `if (typeof document === "undefined")` branch is
 * impossible in a browser e2e run; it's left uncovered in e2e
 * but the body is unit-tested via `readThemeFromElement`.
 *
 * The cleanup-statement branches (BRDA 431,12 / 432,13) are
 * covered by the existing 02 + 17 dashboard tests (the App
 * navigates away and React unmounts the chart grid). No new
 * test needed.
 */

import { type Page, expect, test } from "@playwright/test";
import type { WebSocketRoute } from "@playwright/test";
import { installCoverageHooks } from "./_helpers/coverage.js";

// Phase 57: register coverage collection hooks.
installCoverageHooks("56C-chart-card-helpers");

// =============================================================================
// Test helpers (mirror the 55-2-3ws-architecture.spec.ts pattern)
// =============================================================================

interface WsTestHarness {
  readonly broadcast: (data: string) => void;
  readonly waitForWsCount: (n: number, timeoutMs?: number) => Promise<void>;
  readonly getAllWs: () => readonly WebSocketRoute[];
  readonly closeAll: () => Promise<void>;
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
    getAllWs: (): readonly WebSocketRoute[] => allWs,
    closeAll: async (): Promise<void> => {
      for (const w of allWs) {
        try {
          await w.close();
        } catch {
          // best-effort
        }
      }
    },
  };
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

/**
 * Build synthetic OHLC bars for the bootstrap, matching the
 * 55-2 pattern. The bars use the timeframes passed in.
 *
 * `symbolBars[symbol][tf] = placeholderCount` — the placeholder
 * is the number of bars to generate for that (symbol, tf) pair.
 * The bar contents are deterministic (no randomness) so the
 * e2e tests are reproducible.
 */
function makeBootstrap(
  symbolBars: Readonly<Record<string, Readonly<Record<string, number>>>>,
  now: number,
): Record<string, Record<string, unknown[]>> {
  const out: Record<string, Record<string, unknown[]>> = {};
  for (const [symbol, byTf] of Object.entries(symbolBars)) {
    // `symbol` comes from a closed test fixture (BTCUSDT etc.),
    // not from user input, so bracket access is safe here.
    // eslint-disable-next-line security/detect-object-injection -- symbol is a known-good test fixture
    out[symbol] = {};
    for (const [tf, barCount] of Object.entries(byTf)) {
      const intervalMs = tf === "1h" ? 60 * 60_000 : 4 * 60 * 60_000;
      const list: unknown[] = [];
      let price = 67000;
      for (let i = 0; i < barCount; i++) {
        const t = now - (barCount - 1 - i) * intervalMs;
        const open = price;
        const delta = ((i * 7 + 3) % 11) - 5;
        price = Math.max(1, price + delta * 10);
        const close = price;
        list.push({
          time: t,
          open,
          high: Math.max(open, close) + 5,
          low: Math.min(open, close) - 5,
          close,
          volume: 100 + i,
        });
      }
      // `symbol` is a known-good test fixture key (e.g. "BTCUSDT"),
      // and `tf` is a known timeframe (e.g. "1h"). Both are
      // safe for bracket access — the warning is suppressed
      // on the lookup itself.
      // eslint-disable-next-line security/detect-object-injection -- symbol is a test fixture, not user input
      const tfRecord = out[symbol];
      if (tfRecord !== undefined) {
        // eslint-disable-next-line security/detect-object-injection -- tf is a known timeframe, list is a controlled local
        tfRecord[tf] = list;
      }
    }
  }
  return out;
}

/** Drive all WSes to "connected" with a default strategies config. */
function sendInitialServerMessages(
  harness: WsTestHarness,
  options: {
    readonly bootstrap?: Readonly<
      Record<string, Readonly<Record<string, number>>>
    >;
  } = {},
): void {
  const now = Date.now();
  const hello = JSON.stringify({
    type: "hello",
    ts: now,
    serverVersion: "0.1.0-test",
    protocolVersion: 1,
  });
  const bootstrap = options.bootstrap ?? {
    BTCUSDT: { "1h": 20 },
  };
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
    ohlcBootstrap: makeBootstrap(bootstrap, now),
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

test.describe("56C — drive React flow through Phase 56C helpers", () => {
  test("56C-01: empty bars via WS snapshot — bars.length === 0 branch", async ({
    page,
  }) => {
    // Targets the BRDA 362,10 branch (the `bars.length === 0` TRUE
    // path in the bars useEffect) and BRDA 366,11 (the
    // `series.setData([])` return path). The default bootstrap
    // has 20 bars per (symbol, tf), so the empty-bars branch was
    // never hit. This test sends a snapshot with an empty bar list
    // for BTCUSDT/1h.
    await mockDefaultStrategies(page);

    const harness = await setupWsPeer(page);
    await gotoAppBare(page);
    await harness.waitForWsCount(3);
    sendInitialServerMessages(harness, {
      bootstrap: { BTCUSDT: { "1h": 0 } },
    });

    // Wait for the chart card to render (even with no bars it
    // should still mount + render the chrome).
    await expect(page.locator(".ep-chart-card").first()).toBeVisible({
      timeout: 5_000,
    });

    // The card with empty bars is still visible. Assert the
    // .ep-chart-card[data-symbol="BTCUSDT"][data-timeframe="1h"]
    // element exists. (The lightweight-charts canvas inside the
    // body has no inspectable data — we just assert the card
    // mounted without crashing.)
    const card = page.locator(
      '.ep-chart-card[data-symbol="BTCUSDT"][data-timeframe="1h"]',
    );
    await expect(card).toBeVisible();

    // Status pill should be "connected" (no error from empty bars).
    await expect(page.locator(".ep-app__status-dot")).toHaveAttribute(
      "data-status",
      "connected",
    );
  });

  test("56C-02: recoverable error → feedMeta non-empty → feed meta tail visible", async ({
    page,
  }) => {
    // Targets the BRDA 515,20,2 RHS branch (the `feedMeta !== ""` path
    // in the feed-meta tail render). The default flow has feedMeta
    // as "" (no error), so the RHS was uncovered. This test sends
    // a recoverable error message to App's WS (the one driving the
    // status pill). App.tsx sets `lastError.message` to the error
    // text → `feedMeta` becomes non-empty → the chart card's
    // `.ep-feed__meta` element renders.
    await mockDefaultStrategies(page);

    const harness = await setupWsPeer(page);
    await gotoAppBare(page);
    await harness.waitForWsCount(3);
    sendInitialServerMessages(harness);

    // Status pill should be "connected" first.
    await expect(page.locator(".ep-app__status-dot")).toHaveAttribute(
      "data-status",
      "connected",
      { timeout: 5_000 },
    );

    // Send a recoverable error — the App's lastError becomes
    // non-null → feedMeta becomes the error message.
    harness.broadcast(
      JSON.stringify({
        type: "error",
        ts: Date.now(),
        message: "phase-56C recoverable: 8 ms",
        recoverable: true,
      }),
    );

    // Wait for the React re-render.
    await page.waitForTimeout(200);

    // The chart card's feed indicator should now show the meta
    // tail (.ep-feed__meta). This is the feedMeta !== "" branch
    // being exercised.
    const meta = page
      .locator(".line-chart-wrapper")
      .first()
      .locator(".ep-feed__meta");
    await expect(meta).toBeVisible({ timeout: 3_000 });
    await expect(meta).toContainText("8 ms");
  });

  test("56C-03: viewport resize → ResizeObserver callback fires → chart.applyOptions runs", async ({
    page,
  }) => {
    // Targets the BRDA 445,14 branch (the ResizeObserver callback
    // body). The default Playwright viewport is 1280×720 and never
    // resizes during a test, so the callback was never invoked.
    // This test resizes the viewport and asserts the chart card
    // survives the resize (no crash, no error).
    await mockDefaultStrategies(page);

    const harness = await setupWsPeer(page);
    await gotoAppBare(page);
    await harness.waitForWsCount(3);
    sendInitialServerMessages(harness);

    // Wait for the chart card to mount.
    await expect(page.locator(".ep-chart-card").first()).toBeVisible({
      timeout: 5_000,
    });

    // Resize the viewport. The ResizeObserver attached to the
    // chart body should fire, calling `chart.applyOptions(dims)`.
    await page.setViewportSize({ width: 1024, height: 600 });
    await page.waitForTimeout(100);
    await page.setViewportSize({ width: 1440, height: 800 });
    await page.waitForTimeout(100);

    // The chart card should still be visible (no crash from the
    // resize).
    await expect(page.locator(".ep-chart-card").first()).toBeVisible();
    // Status pill should still be "connected".
    await expect(page.locator(".ep-app__status-dot")).toHaveAttribute(
      "data-status",
      "connected",
    );
  });

  test("56C-04: range tab click → isActive flips + handleRangeClick runs", async ({
    page,
  }) => {
    // Targets the BRDA 472,17 false branch (the `r.id !==
    // effectiveActiveRange` path that renders a non-active tab) and
    // BRDA 475,18 (the `onClick={() => handleRangeClick(r.id)}` path
    // that runs on click). The default flow has the first tab
    // active, so clicking a different tab was the uncovered path.
    await mockDefaultStrategies(page);

    const harness = await setupWsPeer(page);
    await gotoAppBare(page);
    await harness.waitForWsCount(3);
    sendInitialServerMessages(harness);

    await expect(page.locator(".ep-chart-card").first()).toBeVisible({
      timeout: 5_000,
    });

    const firstCard = page.locator(".line-chart-wrapper").first();
    const tabs = firstCard.locator(".line-chart-wrapper__range-button");
    const tabCount = await tabs.count();
    expect(tabCount).toBeGreaterThan(1);

    // First tab is active (BRDA 472,17 TRUE → not what we want here).
    // Click the SECOND tab (BRDA 472,17 FALSE + 475,18 click path).
    const firstTab = tabs.first();
    const secondTab = tabs.nth(1);
    await expect(firstTab).toHaveAttribute("aria-checked", "true");
    await expect(secondTab).toHaveAttribute("aria-checked", "false");

    await secondTab.click();

    // After click, the second tab is active and the first is not.
    // This proves handleRangeClick ran + the local active state
    // updated + the isActive recomputed.
    await expect(secondTab).toHaveAttribute("aria-checked", "true");
    await expect(firstTab).toHaveAttribute("aria-checked", "false");
  });

  test("56C-05: WS close, feed state 'disconnected' / FEED_CONFIG lookup", async ({
    page,
  }) => {
    // Targets the BRDA 478,19 false branch (the FEED_CONFIG lookup
    // for non-"live" feed states). The default flow keeps the WS
    // open, so feedState stayed at "live" → only FEED_CONFIG["live"]
    // was exercised. This test closes all WSes → the App's
    // `useWebSocket` reports status="disconnected" → feedState
    // becomes "disconnected" → FEED_CONFIG["disconnected"] is looked
    // up via `feedConfigFor("disconnected", FEED_CONFIG)`.
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

    // Close all WSes - App's WS goes to "disconnected" -> feedState
    // = mapFeedState("disconnected") = "disconnected".
    await harness.closeAll();

    // Wait for the React re-render + the close handler to fire.
    await page.waitForTimeout(300);

    // Status pill should now be "disconnected".
    await expect(page.locator(".ep-app__status-dot")).toHaveAttribute(
      "data-status",
      "disconnected",
      { timeout: 3_000 },
    );

    // The chart card's feed indicator should now show "Disconnected"
    // (the FEED_CONFIG["disconnected"].label). This proves the
    // feedConfigFor lookup returned the disconnected config.
    const feed = page
      .locator(".line-chart-wrapper")
      .first()
      .locator(".ep-feed");
    await expect(feed).toHaveAttribute("data-feed-state", "disconnected");
    const label = (await feed.locator(".ep-feed__label").textContent()) ?? "";
    expect(label.trim()).toBe("Disconnected");
  });
});
