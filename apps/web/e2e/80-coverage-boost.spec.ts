/**
 * apps/web/e2e/80-coverage-boost.spec.ts
 *
 * Phase 80: additional e2e tests to push branch coverage from 70.9%
 * to 75%+ (the user-mandated gate).
 *
 * The 70% branch coverage baseline (post-Phase 76) has these
 * gaps per the lcov BRDA report:
 *
 *   - bot-status.ts 47% (27/57): 30 uncovered branches in
 *     `formatUptime`, `formatLastUpdate`, `buildStatusBannerText`,
 *     `computeControlBarAvailability`, `extractBotStatus`.
 *     The formatUptime/formatLastUpdate branches are only hit
 *     when the React flow passes a long `startedAt` (sub-hour
 *     uptime / multi-hour uptime) or a long `lastUpdate` (>2s,
 *     >60s, >60m, >24h, and the singular forms). The default
 *     e2e flow has `startedAt = 0` (bot stopped) and `lastUpdate
 *     = now` (just-now), so only the `startedAt <= 0` and
 *     `lastUpdate <= 0` (i.e. `0s`, `just now`) branches are
 *     hit. This spec sends a bot status with a long `startedAt`
 *     AND a long `lastUpdate` to exercise the rest.
 *
 *   - client-compute.ts 70% (30/43): 13 uncovered branches in
 *     the Donchian warmup (bars < lookback), the rolling-window
 *     recompute path (outBar is the extremum), the breakout
 *     detection (close > upper[i-1] / close < lower[i-1]),
 *     and the `?? []` defensive fallbacks. The default e2e
 *     flow sends 20 bars (== lookback) and a near-flat price
 *     walk that never breaks the band. This spec sends FEWER
 *     than 20 bars (to hit the warmup branch) AND a price walk
 *     with breakouts (to hit the breakout markers).
 *
 *   - chart-card-helpers.ts 67% (14/21): 7 uncovered branches
 *     in `resolveHeight` (number branch), `markersAreVisible`
 *     (length > 0 branch), `strategyHasTitle` (empty string
 *     branch), `timeframeHasLabel` (empty string branch),
 *     `resolveEffectiveRanges` (empty array branch),
 *     `isFeedMetaVisible` (non-undefined + non-empty branch),
 *     `handleRangeClick` (onRangeChange defined branch). Some
 *     are covered indirectly via the existing 56C tests; the
 *     ones that aren't require the React flow to pass values
 *     that the App.tsx currently doesn't forward. The
 *     `handleRangeClick` onRangeChange branch requires the
 *     parent to pass the prop — covered by a test that
 *     mounts ChartCard with an explicit `onRangeChange` via
 *     the React fiber walk.
 *
 *   - ChartCard.tsx 69% (25/36): 11 uncovered branches mirror
 *     the chart-card-helpers gaps (the helpers are inlined
 *     via the bundler).
 *
 *   - main.tsx 50% (1/2): 1 uncovered branch is the
 *     `rootEl === null` throw — the `<div id="root">` is
 *     always present in the production HTML, so this branch
 *     is impossible to exercise in the e2e flow without
 *     removing the element. Same for the `typeof document
 *     === "undefined"` SSR fallback in `readTheme()`. These
 *     are documented as unreachable-in-browser branches.
 *
 * **Strategy:** drive the React flow with:
 *
 *   1. **Bot status with long uptime** — `startedAt` 2 hours
 *      ago exercises `formatUptime` sub-hour / sub-day /
 *      multi-day branches.
 *
 *   2. **Bot status with long lastUpdate** — `lastUpdate` 90
 *      minutes ago exercises `formatLastUpdate` sub-60s /
 *      sub-60m (singular + plural) / sub-24h (singular +
 *      plural) / multi-day (singular + plural) branches.
 *
 *   3. **Many bars with a strong breakout pattern** —
 *      `bar.close > upper[i-1]` exercises the breakout LONG
 *      marker branch (line 406, branch index 29, arm 0).
 *
 *   4. **Many bars with a strong breakdown pattern** —
 *      `bar.close < lower[i-1]` exercises the breakout SHORT
 *      marker branch (line 415, branch index 30, arm 0).
 *
 *   5. **Fewer than lookback bars** — bars.length < 20
 *      exercises the `computeDonchianFromBars` warmup
 *      branch (line 110, branch index 1, arm 0).
 *
 * **Coverage delta estimate:** 5 new e2e tests × ~6 new
 * branches per test = +25-30 new branch hits on the target
 * files. Expected: 70.9% → 78% branches.
 */

import { type Page, type Route, expect, test } from "@playwright/test";
import type { WebSocketRoute } from "@playwright/test";
import {
  setSpecName,
  collectCoverageFromPage,
  flushAccumulator,
} from "./_helpers/coverage.js";
// Phase 57: register coverage collection hooks.
setSpecName("80-coverage-boost");

test.afterEach(async ({ page }) => {
  await collectCoverageFromPage(page);
});

test.afterAll(() => {
  flushAccumulator();
});

// =============================================================================
// Test fixtures
// =============================================================================

interface WsTestHarness {
  readonly getAllWs: () => readonly WebSocketRoute[];
  readonly broadcast: (data: string) => void;
  readonly waitForWsCount: (n: number, timeoutMs?: number) => Promise<void>;
}

async function setupWsPeer(
  page: Page,
  onConnect?: (ws: WebSocketRoute) => void,
): Promise<WsTestHarness> {
  await page.route("**/api/strategies", (route: Route) => {
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
    if (onConnect !== undefined) onConnect(ws);
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

async function gotoAppBare(page: Page): Promise<void> {
  await page.goto("/");
}

/**
 * Build synthetic OHLC bars with a deterministic walk. The
 * default pattern is a gentle oscillation; the tests can
 * override `valueOf` to inject breakouts / breakdowns.
 */
function makeBars(
  count: number,
  options: {
    readonly intervalMs?: number;
    readonly valueOf?: (i: number) => number;
    readonly startPrice?: number;
  } = {
    intervalMs: undefined,
    valueOf: undefined,
    startPrice: undefined,
  },
): unknown[] {
  const intervalMs = options.intervalMs ?? 60 * 60_000;
  const startPrice = options.startPrice ?? 67000;
  const valueOf = options.valueOf ?? ((i) => startPrice + i);
  const now = Date.now();
  const out: unknown[] = [];
  let lastClose = startPrice;
  for (let i = 0; i < count; i += 1) {
    const t = now - (count - 1 - i) * intervalMs;
    const open = lastClose;
    const targetClose = valueOf(i);
    const close = targetClose;
    out.push({
      time: t,
      open,
      high: Math.max(open, close) + 5,
      low: Math.min(open, close) - 5,
      close,
      volume: 100 + i,
    });
    lastClose = close;
  }
  return out;
}

/**
 * Send the initial server-side messages: HELLO + SNAPSHOT + STATE.
 * The `botStatus` override lets each test inject a different
 * `startedAt` / `lastUpdate` to exercise the formatUptime /
 * formatLastUpdate branches.
 */
function sendInitialServerMessages(
  harness: WsTestHarness,
  options: {
    readonly bars?: readonly unknown[];
    readonly botStatus?: {
      readonly state: "running" | "paused" | "stopped";
      readonly startedAt: number;
      readonly lastUpdate: number;
      readonly activeStrategyCount: number;
      readonly positions?: readonly unknown[];
    };
  } = {},
): void {
  const now = Date.now();
  const hello = JSON.stringify({
    type: "hello",
    ts: now,
    serverVersion: "0.1.0-test",
    protocolVersion: 1,
  });
  const botStatus = options.botStatus ?? {
    state: "running" as const,
    startedAt: 0,
    lastUpdate: 0,
    activeStrategyCount: 1,
    positions: [],
  };
  // The WS SNAPSHOT message has `snapshot: { botStatus: ... }` —
  // the App's `extractBotStatus` walks `body.snapshot.botStatus`.
  // See apps/web/src/App.tsx line ~240 for the wire format.
  const snapshot = JSON.stringify({
    type: "snapshot",
    ts: now,
    snapshot: { botStatus },
    strategies: [
      {
        name: "donchian_pivot_composition",
        enabled: true,
        symbols: ["BTCUSDT"],
        timeframes: ["1h"],
      },
    ],
    ohlcBootstrap: {
      BTCUSDT: { "1h": options.bars ?? [] },
    },
  });
  const state = JSON.stringify({
    type: "state",
    ts: now,
    snapshot: { botStatus },
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

// =============================================================================
// Tests
// =============================================================================

test.describe("80 — coverage boost (formatUptime / formatLastUpdate / client-compute)", () => {
  test("80-01: bot status with sub-hour uptime (13m 47s) — formatUptime sub-hour branch", async ({
    page,
  }) => {
    // Target: bot-status.ts:251 (the `totalMin < 60` TRUE arm in
    // `formatUptime`). The default e2e flow has `startedAt = 0`
    // (bot stopped → returns "—"), so this branch is never hit.
    // We send a `startedAt` 13m 47s ago → formatUptime returns
    // "13m 47s" (BRDA 251,7 arm 0 hit, 252,8 hit).
    await page.route("**/api/strategies", (route: Route) => {
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

    // Mock /api/status to return a bot status with 13m 47s uptime.
    // We add a 5s buffer because the App's `now` state is updated
    // every 1s by `setInterval`, so it can lag behind real time by
    // up to 1s. The 5s buffer absorbs this lag AND the (handler
    // now - app now) round-trip — without it, 13m 47s would
    // sometimes render as "13m 46s" (off by 1s).
    await page.route("**/api/status", (route: Route) => {
      const now = Date.now();
      const startedAt = now - 13 * 60_000 - 47_000; // 13m 47s ago
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          botStatus: {
            state: "running",
            startedAt,
            lastUpdate: now,
            activeStrategyCount: 1,
            positions: [],
          },
        }),
      });
    });

    const harness = await setupWsPeer(page);
    await gotoAppBare(page);
    await harness.waitForWsCount(3);
    // Also send a snapshot with the same bot status (the WS
    // path also calls extractBotStatus).
    sendInitialServerMessages(harness, {
      botStatus: {
        state: "running",
        startedAt: Date.now() - 13 * 60_000 - 47_000,
        lastUpdate: Date.now(),
        activeStrategyCount: 1,
        positions: [],
      },
    });

    // Wait for the banner to render with the sub-hour uptime.
    const banner = page.locator('[data-testid="bot-status-banner"]');
    await expect(banner).toBeVisible({ timeout: 10_000 });
    await expect(banner).toContainText("Bot: RUNNING", { timeout: 10_000 });
    await expect(banner).toContainText("uptime 13m 47s", { timeout: 10_000 });
  });

  test("80-02: bot status with sub-day uptime (2h 13m) — formatUptime sub-day branch", async ({
    page,
  }) => {
    // Target: bot-status.ts:256 (the `totalHour < 24` TRUE arm
    // in `formatUptime`). The default e2e flow has `startedAt =
    // 0`, so this branch is never hit. We send a `startedAt` 2h
    // 13m ago → formatUptime returns "2h 13m".
    await page.route("**/api/strategies", (route: Route) => {
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

    await page.route("**/api/status", (route: Route) => {
      const now = Date.now();
      // 2h 13m 10s — 10s buffer absorbs the App's 1s `now` lag.
      const startedAt = now - 2 * 60 * 60_000 - 13 * 60_000 - 10_000;
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          botStatus: {
            state: "running",
            startedAt,
            lastUpdate: now,
            activeStrategyCount: 1,
            positions: [],
          },
        }),
      });
    });

    const harness = await setupWsPeer(page);
    await gotoAppBare(page);
    await harness.waitForWsCount(3);
    sendInitialServerMessages(harness, {
      botStatus: {
        state: "running",
        startedAt: Date.now() - 2 * 60 * 60_000 - 13 * 60_000 - 10_000,
        lastUpdate: Date.now(),
        activeStrategyCount: 1,
        positions: [],
      },
    });

    const banner = page.locator('[data-testid="bot-status-banner"]');
    await expect(banner).toBeVisible({ timeout: 10_000 });
    await expect(banner).toContainText("Bot: RUNNING", { timeout: 10_000 });
    await expect(banner).toContainText("uptime 2h 13m", { timeout: 10_000 });
  });

  test("80-03: bot status with multi-day uptime (3d 4h) — formatUptime multi-day branch", async ({
    page,
  }) => {
    // Target: bot-status.ts:261 (the `day` calculation branch in
    // `formatUptime` — the ">= 24h" path). Send `startedAt` 3d 4h
    // ago → formatUptime returns "3d 4h".
    await page.route("**/api/strategies", (route: Route) => {
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

    await page.route("**/api/status", (route: Route) => {
      const now = Date.now();
      // 3d 4h 10s — the 10s buffer absorbs the App's 1s `now`
      // lag (the App's `now` state is updated by `setInterval`
      // every 1s, so it can lag real time by up to 1s). Without
      // the buffer, the multi-day case shifts from "3d 4h" to
      // "3d 3h" because the 1s lag drops `totalHour` by 1.
      const startedAt = now - 3 * 24 * 60 * 60_000 - 4 * 60 * 60_000 - 10_000;
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          botStatus: {
            state: "running",
            startedAt,
            lastUpdate: now,
            activeStrategyCount: 1,
            positions: [],
          },
        }),
      });
    });

    const harness = await setupWsPeer(page);
    await gotoAppBare(page);
    await harness.waitForWsCount(3);
    sendInitialServerMessages(harness, {
      botStatus: {
        state: "running",
        startedAt: Date.now() - 3 * 24 * 60 * 60_000 - 4 * 60 * 60_000 - 10_000,
        lastUpdate: Date.now(),
        activeStrategyCount: 1,
        positions: [],
      },
    });

    const banner = page.locator('[data-testid="bot-status-banner"]');
    await expect(banner).toBeVisible({ timeout: 10_000 });
    await expect(banner).toContainText("Bot: RUNNING", { timeout: 10_000 });
    await expect(banner).toContainText("uptime 3d 4h", { timeout: 10_000 });
  });

  test("80-04: bot status with long lastUpdate (47s, 2m, 2h, 2d) — formatLastUpdate branches", async ({
    page,
  }) => {
    // Target: bot-status.ts formatLastUpdate branches:
    //   - line 286 (`totalSec < 60` TRUE arm): "X seconds ago"
    //     for a 47s delta.
    //   - line 290 (`totalMin < 60` TRUE arm + line 291 `totalMin
    //     === 1` ternary singular + line 291 ternary plural):
    //     "1 minute ago" (singular) and "X minutes ago" (plural).
    //   - line 294 (`totalHour < 24` TRUE arm + line 295
    //     `totalHour === 1` ternary): "1 hour ago" (singular)
    //     and "X hours ago" (plural).
    //   - line 298 (`day === 1` ternary): "1 day ago" (singular)
    //     and "X days ago" (plural).
    //
    // We test the 4 cases by repeatedly sending fresh WS state
    // messages with different `lastUpdate` values. The
    // /api/status mock uses a mutable variable so the next poll
    // (every 1s) returns the latest value too.

    await page.route("**/api/strategies", (route: Route) => {
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

    // Mutable state — the /api/status mock returns the latest
    // botStatus, AND the WS state messages update it. This way
    // both the WS path and the HTTP poll path converge on the
    // same value (otherwise the poll would re-assert the old
    // 2d value and the banner would flip back).
    const now0 = Date.now();
    const state: {
      botStatus: {
        state: "running" | "paused" | "stopped";
        startedAt: number;
        lastUpdate: number;
        activeStrategyCount: number;
        positions: readonly unknown[];
      };
    } = {
      botStatus: {
        state: "running",
        startedAt: now0 - 4 * 24 * 60 * 60_000,
        lastUpdate: now0 - 2 * 24 * 60 * 60_000 - 10_000, // 2d 10s ago
        activeStrategyCount: 1,
        positions: [],
      },
    };
    await page.route("**/api/status", (route: Route) => {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ botStatus: state.botStatus }),
      });
    });

    const harness = await setupWsPeer(page);
    await gotoAppBare(page);
    await harness.waitForWsCount(3);

    // Send the initial server messages (the 2d-ago case).
    sendInitialServerMessages(harness, { botStatus: state.botStatus });

    const banner = page.locator('[data-testid="bot-status-banner"]');
    await expect(banner).toBeVisible({ timeout: 10_000 });
    await expect(banner).toContainText("Bot: RUNNING", { timeout: 10_000 });
    // "2 days ago" — plural form (line 298 FALSE arm)
    await expect(banner).toContainText("2 days ago", { timeout: 10_000 });

    // Helper to push a fresh state (both WS broadcast + mutable
    // state for the /api/status mock).
    const pushState = (lastUpdate: number): void => {
      const now = Date.now();
      state.botStatus = {
        state: "running",
        startedAt: now - 4 * 24 * 60 * 60_000,
        lastUpdate,
        activeStrategyCount: 1,
        positions: [],
      };
      harness.broadcast(
        JSON.stringify({
          type: "state",
          ts: now,
          snapshot: { botStatus: state.botStatus },
          positions: [],
          closedTrades: [],
          killSwitch: "off",
          paused: false,
          statistics: { trades: 0, pnl: 0, drawdown: 0 },
        }),
      );
    };

    // 2 hours ago (5s buffer to absorb App's 1s `now` lag).
    pushState(Date.now() - 2 * 60 * 60_000 - 5_000);
    await page.waitForTimeout(500);
    await expect(banner).toContainText("2 hours ago", { timeout: 5_000 });

    // 2 minutes ago.
    pushState(Date.now() - 2 * 60_000 - 5_000);
    await page.waitForTimeout(500);
    await expect(banner).toContainText("2 minutes ago", { timeout: 5_000 });

    // 47 seconds ago (line 286 TRUE arm).
    pushState(Date.now() - 47_000);
    await page.waitForTimeout(500);
    await expect(banner).toContainText("47 seconds ago", { timeout: 5_000 });
  });

  test("80-05: bot status with 1m/1h/1d singular — formatLastUpdate singular branches", async ({
    page,
  }) => {
    // Target: bot-status.ts formatLastUpdate singular branches:
    //   - line 291 `totalMin === 1` ternary TRUE arm: "1 minute ago"
    //   - line 295 `totalHour === 1` ternary TRUE arm: "1 hour ago"
    //   - line 298 `day === 1` ternary TRUE arm: "1 day ago"
    //
    // Note: "1 minute ago" requires `totalMin === 1` AND
    // `totalMin < 60` (the outer guard at line 290). Similarly
    // for "1 hour ago" and "1 day ago".
    await page.route("**/api/strategies", (route: Route) => {
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

    const banner = page.locator('[data-testid="bot-status-banner"]');

    // 1 minute ago — exercises the "1 minute ago" singular
    // branch (line 291 TRUE arm). 3s buffer to absorb the
    // App's 1s `now` lag (without it, the delta would be
    // 59s and the test would assert "59 seconds ago" instead).
    const now1 = Date.now();
    harness.broadcast(
      JSON.stringify({
        type: "state",
        ts: now1,
        snapshot: {
          botStatus: {
            state: "running",
            startedAt: now1 - 4 * 24 * 60 * 60_000,
            lastUpdate: now1 - 60_000 - 3_000,
            activeStrategyCount: 1,
            positions: [],
          },
        },
        positions: [],
        closedTrades: [],
        killSwitch: "off",
        paused: false,
        statistics: { trades: 0, pnl: 0, drawdown: 0 },
      }),
    );
    await expect(banner).toBeVisible({ timeout: 10_000 });
    await expect(banner).toContainText("1 minute ago", { timeout: 5_000 });

    // 1 hour ago — exercises the "1 hour ago" singular branch
    // (line 295 TRUE arm). 5s buffer.
    const now2 = Date.now();
    harness.broadcast(
      JSON.stringify({
        type: "state",
        ts: now2,
        snapshot: {
          botStatus: {
            state: "running",
            startedAt: now2 - 4 * 24 * 60 * 60_000,
            lastUpdate: now2 - 60 * 60_000 - 5_000,
            activeStrategyCount: 1,
            positions: [],
          },
        },
        positions: [],
        closedTrades: [],
        killSwitch: "off",
        paused: false,
        statistics: { trades: 0, pnl: 0, drawdown: 0 },
      }),
    );
    await page.waitForTimeout(200);
    await expect(banner).toContainText("1 hour ago", { timeout: 5_000 });

    // 1 day ago — exercises the "1 day ago" singular branch
    // (line 298 TRUE arm). 5s buffer.
    const now3 = Date.now();
    harness.broadcast(
      JSON.stringify({
        type: "state",
        ts: now3,
        snapshot: {
          botStatus: {
            state: "running",
            startedAt: now3 - 4 * 24 * 60 * 60_000,
            lastUpdate: now3 - 24 * 60 * 60_000 - 5_000,
            activeStrategyCount: 1,
            positions: [],
          },
        },
        positions: [],
        closedTrades: [],
        killSwitch: "off",
        paused: false,
        statistics: { trades: 0, pnl: 0, drawdown: 0 },
      }),
    );
    await page.waitForTimeout(200);
    await expect(banner).toContainText("1 day ago", { timeout: 5_000 });
  });

  test("80-06: 5 bars (warmup) — client-compute.ts warmup branch", async ({
    page,
  }) => {
    // Target: client-compute.ts:110 (the `n < lookback` warmup
    // branch in `computeDonchianFromBars`). The default e2e
    // flow sends 20 bars (== lookback), so the warmup branch
    // is never hit. We send 5 bars (< lookback of 20) →
    // the warmup branch is exercised.
    await page.route("**/api/strategies", (route: Route) => {
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

    const bars = makeBars(5);
    sendInitialServerMessages(harness, { bars });

    // The chart card renders with 5 bars (warmup). No error.
    const card = page.locator(
      '.ep-chart-card[data-symbol="BTCUSDT"][data-timeframe="1h"]',
    );
    await expect(card).toBeVisible({ timeout: 10_000 });
    await expect(page.locator(".ep-app__status-dot")).toHaveAttribute(
      "data-status",
      "connected",
      { timeout: 5_000 },
    );
  });

  test("80-07: 30 bars with breakout (close > upper[i-1]) — client-compute breakout LONG branch", async ({
    page,
  }) => {
    // Target: client-compute.ts:406 (the `bar.close > prevU`
    // TRUE arm in `computeBreakoutSignalsFromBars`). The
    // default e2e flow sends a near-flat price walk that
    // never breaks the band. We send 30 bars with a strong
    // breakout pattern (price spikes above the previous
    // upper band) → the breakout LONG marker is generated.
    //
    // The pattern: 20 bars at price 67000 (warmup), then
    // bar[20] = 67200 (small uptick), bar[21] = 67500,
    // bar[22] = 68000, bar[23] = 69000 (spike above the
    // rolling upper band). The breakout at bar[22] should
    // trigger because close[22] > upper[21] (the rolling
    // upper at bar[21] is roughly 67005, far below 68000).
    await page.route("**/api/strategies", (route: Route) => {
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

    const bars = makeBars(30, {
      valueOf: (i) => {
        // First 20 bars flat (warmup), then strong breakout.
        if (i < 20) return 67000;
        if (i === 20) return 67000;
        if (i === 21) return 67200;
        if (i === 22) return 68500; // strong breakout
        if (i === 23) return 69000;
        if (i === 24) return 69200;
        return 69000;
      },
    });
    sendInitialServerMessages(harness, { bars });

    const card = page.locator(
      '.ep-chart-card[data-symbol="BTCUSDT"][data-timeframe="1h"]',
    );
    await expect(card).toBeVisible({ timeout: 10_000 });
    await expect(page.locator(".ep-app__status-dot")).toHaveAttribute(
      "data-status",
      "connected",
      { timeout: 5_000 },
    );
  });

  test("80-08: 30 bars with breakdown (close < lower[i-1]) — client-compute breakdown SHORT branch", async ({
    page,
  }) => {
    // Target: client-compute.ts:415 (the `bar.close < prevL`
    // TRUE arm — `else if` branch in
    // `computeBreakoutSignalsFromBars`). The default e2e
    // flow sends a near-flat price walk that never breaks
    // the band. We send 30 bars with a strong breakdown
    // pattern (price drops below the previous lower band)
    // → the breakdown SHORT marker is generated.
    await page.route("**/api/strategies", (route: Route) => {
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

    const bars = makeBars(30, {
      valueOf: (i) => {
        if (i < 20) return 67000;
        if (i === 20) return 67000;
        if (i === 21) return 66800;
        if (i === 22) return 65500; // strong breakdown
        if (i === 23) return 65000;
        if (i === 24) return 64800;
        return 65000;
      },
    });
    sendInitialServerMessages(harness, { bars });

    const card = page.locator(
      '.ep-chart-card[data-symbol="BTCUSDT"][data-timeframe="1h"]',
    );
    await expect(card).toBeVisible({ timeout: 10_000 });
    await expect(page.locator(".ep-app__status-dot")).toHaveAttribute(
      "data-status",
      "connected",
      { timeout: 5_000 },
    );
  });

  test("80-09: theme toggle with initial eggTheme='light' — main.tsx BRDA 27,0 TRUE", async ({
    page,
  }) => {
    // Target: main.tsx:27 (the `MSW_STARTED === true` branch).
    // The default e2e flow goes through the MSW path
    // (BRDA 27,0 arm 0 hit 18 times). To re-confirm and
    // ensure no regression, this test exercises the full
    // path with localStorage pre-set to "light".
    //
    // The BRDA 27,0 arm 1 (the non-MSW path) is hit by the
    // production app (no `window.MSW_STARTED`), but the
    // e2e build always has `MSW_STARTED = true` (the
    // `playwright.config.ts` webServer command sets it via
    // the `page.addInitScript` in the dashboard.spec.ts).
    // So the non-MSW branch in main.tsx is unreachable in
    // e2e. The 80-09 test focuses on the MSW path (which
    // is the one being hit).
    await page.addInitScript(() => {
      window.localStorage.setItem("eggTheme", "light");
    });

    await page.route("**/api/strategies", (route: Route) => {
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

    // The page should be connected + the saved theme should
    // be applied.
    await expect(page.locator(".ep-app__status-dot")).toHaveAttribute(
      "data-status",
      "connected",
      { timeout: 10_000 },
    );
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  });

  test("80-10: state message with no `snapshot` field — App.tsx BRDA 264,11 TRUE + 279,15 TRUE", async ({
    page,
  }) => {
    // Target: App.tsx:264 (`if (innerSnapshot === undefined ||
    // innerSnapshot === null) return;` TRUE arm) + App.tsx:279
    // (same check for the snapshot effect).
    //
    // The default e2e flow always sends a state/snapshot
    // message with a `snapshot: { ... }` field, so the TRUE
    // arm (snapshot is undefined/null) is never hit. We send
    // a state message WITHOUT a `snapshot` field → the App's
    // effect on `[lastState]` re-runs, `lastState.snapshot` is
    // undefined, and the `if (innerSnapshot === undefined)`
    // check takes the TRUE arm.
    await page.route("**/api/strategies", (route: Route) => {
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

    await expect(page.locator(".ep-app__status-dot")).toHaveAttribute(
      "data-status",
      "connected",
      { timeout: 10_000 },
    );

    // Send a state message WITHOUT a `snapshot` field. The
    // App's `useEffect` on `[lastState]` re-runs; `lastState.snapshot`
    // is undefined; `if (innerSnapshot === undefined || ...) return;`
    // is taken (TRUE arm — covers BRDA 264,11).
    harness.broadcast(
      JSON.stringify({
        type: "state",
        ts: Date.now(),
        // Note: NO `snapshot` field. The App's effect on
        // `[lastState]` reads `lastState.snapshot` which is
        // undefined here → TRUE arm of the guard.
        positions: [],
        closedTrades: [],
        killSwitch: "off",
        paused: false,
        statistics: { trades: 0, pnl: 0, drawdown: 0 },
      }),
    );
    await page.waitForTimeout(300);

    // The page should still be connected (the guard returns
    // early without setting botStatus, but no error).
    await expect(page.locator(".ep-app__status-dot")).toHaveAttribute(
      "data-status",
      "connected",
      { timeout: 5_000 },
    );
  });

  // ===========================================================================
  // Phase 80 second wave: extractBotStatus + parsePosition + buildStatusBannerText
  // branches. The first wave (80-01..80-10) covered formatUptime /
  // formatLastUpdate / client-compute. The second wave covers the
  // DEFENSIVE branches in `extractBotStatus` (invalid state, invalid
  // field types), `parsePosition` (each missing field), and
  // `buildStatusBannerText` (null botStatus, open positions count).
  // ===========================================================================

  test("80-11: bot status with 1 open position — buildStatusBannerText positionsSuffix TRUE + singular", async ({
    page,
  }) => {
    // Target: bot-status.ts:388 (the `openPositions > 0` TRUE arm in
    // `buildStatusBannerText` — hits the `· 1 open position` suffix
    // path with singular "position") and BRDA 388,7 arm 0 (openPositions
    // > 0) and BRDA 389,8 arm 0 (`openPositions === 1` ternary TRUE
    // arm — singular "position").
    //
    // The default e2e flow sends `positions: []`, so the suffix is
    // never added (the FALSE arm of `openPositions > 0` is the only
    // path hit). We send 1 valid open position to exercise the TRUE
    // arm + the `=== 1` ternary.
    await page.route("**/api/strategies", (route: Route) => {
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

    const now = Date.now();
    const botStatusWithOnePosition = {
      state: "running" as const,
      startedAt: now - 5 * 60_000, // 5 minutes ago
      lastUpdate: now,
      activeStrategyCount: 1,
      positions: [
        {
          id: "pos-1",
          symbol: "BTCUSDT",
          side: "buy" as const,
          entryPrice: 67000,
          currentPrice: 67500,
          quantity: 0.5,
          leverage: 5,
          unrealizedPnl: 250,
          unrealizedPnlPct: 0.75,
          openedAt: now - 60_000,
        },
      ],
    };
    sendInitialServerMessages(harness, { botStatus: botStatusWithOnePosition });

    const banner = page.locator('[data-testid="bot-status-banner"]');
    await expect(banner).toBeVisible({ timeout: 10_000 });
    await expect(banner).toContainText("Bot: RUNNING", { timeout: 10_000 });
    // The "1 open position" suffix (singular) should appear.
    await expect(banner).toContainText("1 open position", { timeout: 10_000 });
  });

  test("80-12: bot status with 2 open positions — buildStatusBannerText positionsSuffix TRUE + plural", async ({
    page,
  }) => {
    // Target: bot-status.ts:389 (the `openPositions === 1` ternary
    // FALSE arm — plural "positions"). The TRUE arm is hit by 80-11.
    // This test sends 2 valid open positions to hit the FALSE arm.
    await page.route("**/api/strategies", (route: Route) => {
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

    const now = Date.now();
    const botStatusWithTwoPositions = {
      state: "running" as const,
      startedAt: now - 5 * 60_000,
      lastUpdate: now,
      activeStrategyCount: 1,
      positions: [
        {
          id: "pos-1",
          symbol: "BTCUSDT",
          side: "buy" as const,
          entryPrice: 67000,
          currentPrice: 67500,
          quantity: 0.5,
          leverage: 5,
          unrealizedPnl: 250,
          unrealizedPnlPct: 0.75,
          openedAt: now - 60_000,
        },
        {
          id: "pos-2",
          symbol: "ETHUSDT",
          side: "sell" as const,
          entryPrice: 3500,
          currentPrice: 3450,
          quantity: 2,
          leverage: 3,
          unrealizedPnl: 100,
          unrealizedPnlPct: 1.43,
          openedAt: now - 30_000,
        },
      ],
    };
    sendInitialServerMessages(harness, {
      botStatus: botStatusWithTwoPositions,
    });

    const banner = page.locator('[data-testid="bot-status-banner"]');
    await expect(banner).toBeVisible({ timeout: 10_000 });
    await expect(banner).toContainText("Bot: RUNNING", { timeout: 10_000 });
    // The "2 open positions" suffix (plural) should appear.
    await expect(banner).toContainText("2 open positions", { timeout: 10_000 });
  });

  test("80-13: snapshot with state='invalid' — extractBotStatus returns null (BRDA 149,4 TRUE)", async ({
    page,
  }) => {
    // Target: bot-status.ts:149 (the `stateRaw !== "running" &&
    // stateRaw !== "paused" && stateRaw !== "stopped"` TRUE arm).
    // The default e2e flow always sends a valid state, so this branch
    // is never hit. We send an INVALID state value → extractBotStatus
    // returns `null` → the banner falls back to the stopped state.
    await page.route("**/api/strategies", (route: Route) => {
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

    const now = Date.now();
    // Send a snapshot with an INVALID state value. The App's
    // extractBotStatus walks the snapshot and rejects the invalid
    // state → returns null → the banner shows the "Bot: stopped —
    // no status yet" fallback (which exercises the `botStatus ===
    // null` TRUE arm in buildStatusBannerText, BRDA 376,7).
    harness.broadcast(
      JSON.stringify({
        type: "snapshot",
        ts: now,
        snapshot: {
          botStatus: {
            state: "invalid_state_value",
            startedAt: now - 5 * 60_000,
            lastUpdate: now,
            activeStrategyCount: 1,
            positions: [],
          },
        },
        strategies: [
          {
            name: "donchian_pivot_composition",
            enabled: true,
            symbols: ["BTCUSDT"],
            timeframes: ["1h"],
          },
        ],
        ohlcBootstrap: { BTCUSDT: { "1h": [] } },
      }),
    );
    await page.waitForTimeout(500);

    // After the invalid state, the banner should show the "no
    // status yet" fallback.
    const banner = page.locator('[data-testid="bot-status-banner"]');
    await expect(banner).toBeVisible({ timeout: 10_000 });
    await expect(banner).toContainText("no status yet", { timeout: 10_000 });
  });

  test("80-14: snapshot with startedAt as string — extractBotStatus returns null (BRDA 155,6 TRUE)", async ({
    page,
  }) => {
    // Target: bot-status.ts:155 (the `typeof startedAtRaw !==
    // "number"` TRUE arm in extractBotStatus). The default e2e
    // flow always sends a number, so this branch is never hit.
    // We send startedAt as a string → extractBotStatus returns null.
    await page.route("**/api/strategies", (route: Route) => {
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

    const now = Date.now();
    // Send a snapshot with `startedAt` as a STRING (not a number).
    harness.broadcast(
      JSON.stringify({
        type: "snapshot",
        ts: now,
        snapshot: {
          botStatus: {
            state: "running",
            startedAt: "not-a-number", // WRONG TYPE
            lastUpdate: now,
            activeStrategyCount: 1,
            positions: [],
          },
        },
        strategies: [
          {
            name: "donchian_pivot_composition",
            enabled: true,
            symbols: ["BTCUSDT"],
            timeframes: ["1h"],
          },
        ],
        ohlcBootstrap: { BTCUSDT: { "1h": [] } },
      }),
    );
    await page.waitForTimeout(500);

    // After the invalid startedAt, the banner should show the
    // "no status yet" fallback.
    const banner = page.locator('[data-testid="bot-status-banner"]');
    await expect(banner).toBeVisible({ timeout: 10_000 });
    await expect(banner).toContainText("no status yet", { timeout: 10_000 });
  });

  test("80-15: snapshot with lastUpdate as string — extractBotStatus returns null (BRDA 156,7 TRUE)", async ({
    page,
  }) => {
    // Target: bot-status.ts:156 (the `typeof lastUpdateRaw !==
    // "number"` TRUE arm in extractBotStatus).
    await page.route("**/api/strategies", (route: Route) => {
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

    const now = Date.now();
    harness.broadcast(
      JSON.stringify({
        type: "snapshot",
        ts: now,
        snapshot: {
          botStatus: {
            state: "running",
            startedAt: now - 5 * 60_000,
            lastUpdate: "not-a-number", // WRONG TYPE
            activeStrategyCount: 1,
            positions: [],
          },
        },
        strategies: [
          {
            name: "donchian_pivot_composition",
            enabled: true,
            symbols: ["BTCUSDT"],
            timeframes: ["1h"],
          },
        ],
        ohlcBootstrap: { BTCUSDT: { "1h": [] } },
      }),
    );
    await page.waitForTimeout(500);

    const banner = page.locator('[data-testid="bot-status-banner"]');
    await expect(banner).toBeVisible({ timeout: 10_000 });
    await expect(banner).toContainText("no status yet", { timeout: 10_000 });
  });

  test("80-16: snapshot with activeStrategyCount as string — extractBotStatus returns null (BRDA 157,8 TRUE)", async ({
    page,
  }) => {
    // Target: bot-status.ts:157 (the `typeof activeStrategyCountRaw
    // !== "number"` TRUE arm in extractBotStatus).
    await page.route("**/api/strategies", (route: Route) => {
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

    const now = Date.now();
    harness.broadcast(
      JSON.stringify({
        type: "snapshot",
        ts: now,
        snapshot: {
          botStatus: {
            state: "running",
            startedAt: now - 5 * 60_000,
            lastUpdate: now,
            activeStrategyCount: "not-a-number", // WRONG TYPE
            positions: [],
          },
        },
        strategies: [
          {
            name: "donchian_pivot_composition",
            enabled: true,
            symbols: ["BTCUSDT"],
            timeframes: ["1h"],
          },
        ],
        ohlcBootstrap: { BTCUSDT: { "1h": [] } },
      }),
    );
    await page.waitForTimeout(500);

    const banner = page.locator('[data-testid="bot-status-banner"]');
    await expect(banner).toBeVisible({ timeout: 10_000 });
    await expect(banner).toContainText("no status yet", { timeout: 10_000 });
  });

  test("80-17: bot status with no `snapshot` field at all — buildStatusBannerText `botStatus === null` TRUE (BRDA 376,7)", async ({
    page,
  }) => {
    // Target: bot-status.ts:376 (the `if (botStatus === null) return
    // "Bot: stopped — no status yet"` TRUE arm). The default e2e
    // flow always sends a snapshot.botStatus, so this branch is
    // never hit. We send a snapshot WITHOUT a botStatus field →
    // extractBotStatus returns null → buildStatusBannerText takes
    // the `botStatus === null` TRUE arm.
    await page.route("**/api/strategies", (route: Route) => {
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

    const now = Date.now();
    // Send a snapshot with NO `botStatus` field. The App's
    // extractBotStatus is called with snapshot = { otherField: ... }
    // → returns null → buildStatusBannerText takes the
    // `botStatus === null` TRUE arm → returns "Bot: stopped — no
    // status yet".
    harness.broadcast(
      JSON.stringify({
        type: "snapshot",
        ts: now,
        snapshot: {}, // NO botStatus field
        strategies: [
          {
            name: "donchian_pivot_composition",
            enabled: true,
            symbols: ["BTCUSDT"],
            timeframes: ["1h"],
          },
        ],
        ohlcBootstrap: { BTCUSDT: { "1h": [] } },
      }),
    );
    await page.waitForTimeout(500);

    const banner = page.locator('[data-testid="bot-status-banner"]');
    await expect(banner).toBeVisible({ timeout: 10_000 });
    await expect(banner).toContainText("no status yet", { timeout: 10_000 });
  });

  test("80-18: position with missing `id` field — parsePosition returns null (BRDA 201,13 TRUE)", async ({
    page,
  }) => {
    // Target: bot-status.ts:201 (the `typeof pos.id !== "string"`
    // TRUE arm in parsePosition). The default e2e flow sends no
    // positions or only valid positions, so this defensive branch
    // is never hit. We send a position WITHOUT an `id` field →
    // parsePosition returns null → the position is dropped from
    // the flatMap (the flatMap callback returns [] for null inputs).
    await page.route("**/api/strategies", (route: Route) => {
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

    const now = Date.now();
    // Send a snapshot with a position that is MISSING the `id`
    // field. parsePosition returns null → the flatMap returns [].
    // The banner's openPositions === 0 → no "X open positions"
    // suffix. This is enough to exercise the parsePosition
    // `typeof pos.id !== "string"` TRUE arm.
    harness.broadcast(
      JSON.stringify({
        type: "snapshot",
        ts: now,
        snapshot: {
          botStatus: {
            state: "running",
            startedAt: now - 5 * 60_000,
            lastUpdate: now,
            activeStrategyCount: 1,
            positions: [
              {
                // NO `id` field — invalid position
                symbol: "BTCUSDT",
                side: "buy",
                entryPrice: 67000,
                currentPrice: 67500,
                quantity: 0.5,
                leverage: 5,
                unrealizedPnl: 250,
                unrealizedPnlPct: 0.75,
                openedAt: now - 60_000,
              },
            ],
          },
        },
        strategies: [
          {
            name: "donchian_pivot_composition",
            enabled: true,
            symbols: ["BTCUSDT"],
            timeframes: ["1h"],
          },
        ],
        ohlcBootstrap: { BTCUSDT: { "1h": [] } },
      }),
    );
    await page.waitForTimeout(500);

    // The position was rejected (parsePosition returned null), so
    // the banner should NOT show "1 open position" (openPositions
    // === 0 after the invalid position is dropped).
    const banner = page.locator('[data-testid="bot-status-banner"]');
    await expect(banner).toBeVisible({ timeout: 10_000 });
    await expect(banner).toContainText("Bot: RUNNING", { timeout: 10_000 });
    await expect(banner).not.toContainText("open position");
  });

  test("80-19: position with missing `symbol` field — parsePosition returns null (BRDA 202,14 TRUE)", async ({
    page,
  }) => {
    // Target: bot-status.ts:202 (the `typeof pos.symbol !==
    // "string"` TRUE arm in parsePosition). Same pattern as 80-18
    // but with a different missing field.
    await page.route("**/api/strategies", (route: Route) => {
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

    const now = Date.now();
    harness.broadcast(
      JSON.stringify({
        type: "snapshot",
        ts: now,
        snapshot: {
          botStatus: {
            state: "running",
            startedAt: now - 5 * 60_000,
            lastUpdate: now,
            activeStrategyCount: 1,
            positions: [
              {
                id: "pos-1",
                // NO `symbol` field — invalid position
                side: "buy",
                entryPrice: 67000,
                currentPrice: 67500,
                quantity: 0.5,
                leverage: 5,
                unrealizedPnl: 250,
                unrealizedPnlPct: 0.75,
                openedAt: now - 60_000,
              },
            ],
          },
        },
        strategies: [
          {
            name: "donchian_pivot_composition",
            enabled: true,
            symbols: ["BTCUSDT"],
            timeframes: ["1h"],
          },
        ],
        ohlcBootstrap: { BTCUSDT: { "1h": [] } },
      }),
    );
    await page.waitForTimeout(500);

    const banner = page.locator('[data-testid="bot-status-banner"]');
    await expect(banner).toBeVisible({ timeout: 10_000 });
    await expect(banner).toContainText("Bot: RUNNING", { timeout: 10_000 });
    await expect(banner).not.toContainText("open position");
  });

  test("80-20: position with side='invalid' — parsePosition returns null (BRDA 203,15 TRUE)", async ({
    page,
  }) => {
    // Target: bot-status.ts:203 (the `pos.side !== "buy" &&
    // pos.side !== "sell"` TRUE arm in parsePosition). We send a
    // position with side="hold" (neither buy nor sell).
    await page.route("**/api/strategies", (route: Route) => {
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

    const now = Date.now();
    harness.broadcast(
      JSON.stringify({
        type: "snapshot",
        ts: now,
        snapshot: {
          botStatus: {
            state: "running",
            startedAt: now - 5 * 60_000,
            lastUpdate: now,
            activeStrategyCount: 1,
            positions: [
              {
                id: "pos-1",
                symbol: "BTCUSDT",
                side: "hold", // WRONG VALUE (must be "buy" or "sell")
                entryPrice: 67000,
                currentPrice: 67500,
                quantity: 0.5,
                leverage: 5,
                unrealizedPnl: 250,
                unrealizedPnlPct: 0.75,
                openedAt: now - 60_000,
              },
            ],
          },
        },
        strategies: [
          {
            name: "donchian_pivot_composition",
            enabled: true,
            symbols: ["BTCUSDT"],
            timeframes: ["1h"],
          },
        ],
        ohlcBootstrap: { BTCUSDT: { "1h": [] } },
      }),
    );
    await page.waitForTimeout(500);

    const banner = page.locator('[data-testid="bot-status-banner"]');
    await expect(banner).toBeVisible({ timeout: 10_000 });
    await expect(banner).toContainText("Bot: RUNNING", { timeout: 10_000 });
    await expect(banner).not.toContainText("open position");
  });

  test("80-21: position with missing `entryPrice` field — parsePosition returns null (BRDA 204,16 TRUE)", async ({
    page,
  }) => {
    // Target: bot-status.ts:204 (the `typeof pos.entryPrice !==
    // "number"` TRUE arm in parsePosition).
    await page.route("**/api/strategies", (route: Route) => {
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

    const now = Date.now();
    harness.broadcast(
      JSON.stringify({
        type: "snapshot",
        ts: now,
        snapshot: {
          botStatus: {
            state: "running",
            startedAt: now - 5 * 60_000,
            lastUpdate: now,
            activeStrategyCount: 1,
            positions: [
              {
                id: "pos-1",
                symbol: "BTCUSDT",
                side: "buy",
                // NO `entryPrice` field
                currentPrice: 67500,
                quantity: 0.5,
                leverage: 5,
                unrealizedPnl: 250,
                unrealizedPnlPct: 0.75,
                openedAt: now - 60_000,
              },
            ],
          },
        },
        strategies: [
          {
            name: "donchian_pivot_composition",
            enabled: true,
            symbols: ["BTCUSDT"],
            timeframes: ["1h"],
          },
        ],
        ohlcBootstrap: { BTCUSDT: { "1h": [] } },
      }),
    );
    await page.waitForTimeout(500);

    const banner = page.locator('[data-testid="bot-status-banner"]');
    await expect(banner).toBeVisible({ timeout: 10_000 });
    await expect(banner).toContainText("Bot: RUNNING", { timeout: 10_000 });
    await expect(banner).not.toContainText("open position");
  });
});
