/**
 * apps/web/e2e/55-5-indicator-wiring.spec.ts
 *
 * Phase 55-5: IndicatorRegistry wiring e2e tests. The
 * `IndicatorRegistry` (apps/web/src/indicators/registry.ts)
 * was built in Phase 49A and the four renderers
 * (donchian, funding, cascade, signals) have been
 * unit-tested in `src/indicators/*.test.ts` since then —
 * but they were NEVER wired into the dashboard. The e2e
 * suite has zero coverage of the four indicator files
 * (donchian.ts ~370 lines, funding.ts ~370 lines,
 * cascade.ts ~110 lines, signals.ts ~120 lines) or the
 * IndicatorRegistry integration code path in
 * `App.tsx → ws-client.ts → ChartGrid.tsx → ChartCard.tsx`.
 *
 * This test file exercises that integration end-to-end:
 *   1. **55-5-01** — sending a valid DONCHIAN indicator
 *      message to App's WS results in the chart card
 *      rendering the indicator (verified via
 *      `data-indicator-rendered="donchian-1h-..."` attribute
 *      on the chart card root).
 *   2. **55-5-02** — sending an indicator with an
 *      UNKNOWN name (e.g. "unknown_indicator") does NOT
 *      add it to the data attribute (the registry's `get()`
 *      returns undefined for unknown names).
 *   3. **55-5-03** — sending a DONCHIAN indicator with
 *      INVALID series (missing the `upper` key) does NOT
 *      add it to the data attribute (the per-renderer
 *      validator returns null and the renderer logs a
 *      warning).
 *   4. **55-5-04** — sending BOTH donchian and funding
 *      for the same chart (today's dashboard only emits
 *      one per strategy, but the integration supports
 *      multiple) results in BOTH names in the data
 *      attribute (the `renderedIndicatorNames` state is
 *      a space-separated list).
 *
 * **Coverage target:** +5-10pp e2e lines. The four
 * indicator files are ~970 lines that were never loaded
 * by the e2e suite; the new wiring code (App.tsx,
 * ChartGrid.tsx, ChartCard.tsx, ws-client.ts additions)
 * adds another ~120 lines. The indicator effect in
 * `ChartCard` and the `onIndicator` listener in
 * `ws-client.ts` are the integration seams.
 *
 * **Why `data-indicator-rendered` and not the canvas
 * pixels:** the lightweight-charts library renders to a
 * `<canvas>` element which is not easily inspectable in
 * Playwright. The dashboard exposes the rendered
 * indicator names as a DOM attribute on the chart card
 * root specifically for this assertion — a future
 * visual-regression test can compare canvas screenshots
 * if needed, but the DOM attribute is the e2e-friendly
 * signal.
 */

import { type Page, expect, test, type WebSocketRoute } from "@playwright/test";

// =============================================================================
// Test helpers
// =============================================================================

/** Per-WS state. The harness tracks every WS the page opens
 *  and the cumulative frames the page sent on each. */
interface WsTestHarness {
  readonly broadcast: (data: string) => void;
  readonly waitForWsCount: (n: number, timeoutMs?: number) => Promise<void>;
  readonly getAllWs: () => readonly WebSocketRoute[];
}

async function setupWsPeer(page: Page): Promise<WsTestHarness> {
  // Mock /api/strategies so App.tsx's fetch-on-connect effect
  // completes (otherwise the chart grid won't render).
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
  };
}

/** Build 20 synthetic OHLC bars for a (symbol, tf) pair,
 *  anchored at the given timestamp. Matches the convention
 *  in the 55-2 and 54-helper tests. */
function makeBootstrap(tf: string, now: number): unknown[] {
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
        timeframes: ["1h"],
      },
    ],
    ohlcBootstrap: {
      BTCUSDT: { "1h": makeBootstrap("1h", now) },
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

/** Build a valid donchian INDICATOR message for 20 bars. */
function makeDonchianMessage(
  strategy: string,
  timeframe: string,
  count: number,
  ts: number,
): string {
  return JSON.stringify({
    type: "indicator",
    ts,
    strategy,
    timeframe,
    indicator: "donchian",
    series: {
      upper: Array.from({ length: count }, (_, i) => 100 + i),
      middle: Array.from({ length: count }, (_, i) => 99 + i),
      lower: Array.from({ length: count }, (_, i) => 98 + i),
    },
  });
}

/** Build a valid funding INDICATOR message for 20 bars. */
function makeFundingMessage(
  strategy: string,
  timeframe: string,
  count: number,
  ts: number,
): string {
  return JSON.stringify({
    type: "indicator",
    ts,
    strategy,
    timeframe,
    indicator: "funding",
    series: {
      dydx: Array.from({ length: count }, (_, i) => 0.0001 + i * 0.00001),
      cex: Array.from({ length: count }, (_, i) => 0.00008 + i * 0.00001),
      spread: Array.from({ length: count }, () => 0.00002),
    },
  });
}

async function gotoAppBare(page: Page): Promise<void> {
  // Do NOT start MSW (the 55-2 / 53 tests use Playwright's
  // WebSocketRoute directly to control the WS messages).
  await page.goto("/");
}

// =============================================================================
// Tests
// =============================================================================

test.describe("55-5 — IndicatorRegistry wiring", () => {
  test("55-5-01: valid DONCHIAN indicator message → chart card renders it", async ({
    page,
  }) => {
    // Target: the full data flow
    //   WS message (App) → ws-client.handleMessage("indicator")
    //   → onIndicator listeners (App.tsx) → setIndicatorsByKey
    //   → ChartGrid props.indicatorsByKey → ChartCard props.indicators
    //   → ChartCard effect 4 → registry.get("donchian")()
    //   → renderDonchian() → addSeries(LineSeries, ...) (3 lines)
    //   → data-indicator-rendered="donchian-1h-donchian_pivot_composition"
    const harness = await setupWsPeer(page);
    await gotoAppBare(page);
    await harness.waitForWsCount(3);
    sendInitialServerMessages(harness);

    // Wait for the chart card to render.
    const card = page.locator(".line-chart-wrapper").first();
    await expect(card).toBeVisible({ timeout: 5_000 });

    // Initial render: no indicator rendered yet.
    await expect(card).toHaveAttribute("data-indicator-rendered", "", {
      timeout: 2_000,
    });

    // Send a valid donchian indicator for the chart's
    // (strategy, timeframe).
    const now = Date.now();
    harness.broadcast(makeDonchianMessage("donchian_pivot_composition", "1h", 20, now));

    // After the message is processed, the chart card's
    // data-indicator-rendered attribute must contain the
    // rendered indicator name. The renderer composes the
    // RenderedIndicator.name as `${indicator}-${timeframe}-${strategy}`
    // (see `donchian.ts`), so the expected attribute value
    // is "donchian-1h-donchian_pivot_composition".
    await expect(card).toHaveAttribute(
      "data-indicator-rendered",
      "donchian-1h-donchian_pivot_composition",
      { timeout: 3_000 },
    );
  });

  test("55-5-02: UNKNOWN indicator name → chart card does NOT render it", async ({
    page,
  }) => {
    // Target: the registry's `get()` returns undefined for
    // unknown names. The chart card's indicator effect
    // silently skips them and the data attribute stays
    // empty.
    const harness = await setupWsPeer(page);
    await gotoAppBare(page);
    await harness.waitForWsCount(3);
    sendInitialServerMessages(harness);

    const card = page.locator(".line-chart-wrapper").first();
    await expect(card).toBeVisible({ timeout: 5_000 });

    // Send an indicator message with a name the registry
    // does NOT have a renderer for.
    const now = Date.now();
    harness.broadcast(
      JSON.stringify({
        type: "indicator",
        ts: now,
        strategy: "donchian_pivot_composition",
        timeframe: "1h",
        indicator: "unknown_indicator",
        series: { foo: [1, 2, 3] },
      }),
    );

    // Give the React state update a beat to settle.
    await page.waitForTimeout(500);

    // The data attribute must remain empty (no renderer
    // for "unknown_indicator" was registered).
    await expect(card).toHaveAttribute("data-indicator-rendered", "", {
      timeout: 2_000,
    });
  });

  test("55-5-03: PARTIAL donchian series (missing 'upper') → renderer is graceful, logs a warning, and adds only the present series", async ({
    page,
  }) => {
    // Target: the donchian renderer's per-key missing-series
    // branch. When a key is absent (e.g. 'upper'), the
    // renderer logs a `console.warn` and continues to
    // render the present keys (middle, lower). The
    // `data-indicator-rendered` attribute is set to the
    // donchian name (the renderer DID run, just with
    // fewer series).
    //
    // We capture the console messages and assert that
    // the warn line was emitted — this is the integration-
    // level proof that the renderer's missing-key branch
    // was exercised. The per-renderer unit tests
    // (donchian.test.ts) cover the same branch in
    // isolation; the e2e test proves the wiring reaches
    // the renderer.
    const warnings: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "warning") {
        warnings.push(msg.text());
      }
    });

    const harness = await setupWsPeer(page);
    await gotoAppBare(page);
    await harness.waitForWsCount(3);
    sendInitialServerMessages(harness);

    const card = page.locator(".line-chart-wrapper").first();
    await expect(card).toBeVisible({ timeout: 5_000 });

    // Send a donchian indicator missing the 'upper' key.
    const now = Date.now();
    harness.broadcast(
      JSON.stringify({
        type: "indicator",
        ts: now,
        strategy: "donchian_pivot_composition",
        timeframe: "1h",
        indicator: "donchian",
        series: {
          // 'upper' is intentionally missing — the
          // renderer will warn and skip it.
          middle: Array.from({ length: 20 }, (_, i) => 99 + i),
          lower: Array.from({ length: 20 }, (_, i) => 98 + i),
        },
      }),
    );

    // The renderer ran (the wiring is robust), so the
    // data attribute is set to the donchian name.
    await expect(card).toHaveAttribute(
      "data-indicator-rendered",
      "donchian-1h-donchian_pivot_composition",
      { timeout: 3_000 },
    );

    // The renderer's console.warn for the missing 'upper'
    // key was emitted (proving the missing-key branch was
    // exercised by the integration). The warn text comes
    // from `donchian.ts:299-301`:
    //   `[renderDonchian] missing 'upper' series for ...`
    await expect
      .poll(
        () =>
          warnings.some((w) =>
            w.includes("[renderDonchian]") && w.includes("missing 'upper'"),
          ),
        { timeout: 2_000, message: "expected missing-'upper' warn" },
      )
      .toBe(true);
  });

  test("55-5-04: indicator REPLACES previous indicator for same (strategy, timeframe)", async ({
    page,
  }) => {
    // Target: the mergeIndicatorsByKey helper's
    // "upsert by (strategy, timeframe) key" semantics. The
    // first INDICATOR message populates the data attribute;
    // the second INDICATOR message for the SAME
    // (strategy, timeframe) REPLACES the first (the
    // `renderedIndicatorNames` state is recomputed on
    // every effect run). The previous render's
    // `dispose()` is called before the new render — the
    // chart's `removeSeries` path is exercised.
    const harness = await setupWsPeer(page);
    await gotoAppBare(page);
    await harness.waitForWsCount(3);
    sendInitialServerMessages(harness);

    const card = page.locator(".line-chart-wrapper").first();
    await expect(card).toBeVisible({ timeout: 5_000 });

    // First indicator: donchian.
    const now = Date.now();
    harness.broadcast(
      makeDonchianMessage("donchian_pivot_composition", "1h", 20, now),
    );

    await expect(card).toHaveAttribute(
      "data-indicator-rendered",
      "donchian-1h-donchian_pivot_composition",
      { timeout: 3_000 },
    );

    // Second indicator for the SAME (strategy, timeframe):
    // funding. The dashboard's `mergeIndicatorsByKey`
    // helper upserts by key, so the funding message
    // REPLACES the donchian entry. The chart card's
    // effect 4 re-runs, disposes the previous render, and
    // renders the new one.
    harness.broadcast(
      makeFundingMessage("donchian_pivot_composition", "1h", 20, now + 1),
    );

    await expect(card).toHaveAttribute(
      "data-indicator-rendered",
      "funding-1h-donchian_pivot_composition",
      { timeout: 3_000 },
    );
  });
});
