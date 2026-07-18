/**
 * apps/web/e2e/53-killswitch.spec.ts
 *
 * Phase 53C: Kill-switch coverage. The `ControlBar.onKillSwitch`
 * handler in `apps/web/src/components/ControlBar.tsx`:
 *
 *   1. Calls `window.confirm("...KILL...")`.
 *   2. If confirmed: `send({ type: "control", command: "kill_switch" })`.
 *   3. If declined: no-op.
 *
 * The existing e2e tests in `e2e/dashboard.spec.ts` use
 * `page.on("dialog", d => d.dismiss())` (test 06) and
 * `page.on("dialog", d => d.accept())` (test 13). Both patterns
 * hit the dialog EVENT but do NOT deterministically control the
 * `addInitScript` mock-confirm path.
 *
 * These tests use `addInitScript(() => { window.confirm = () => true/false })`
 * to deterministically mock the confirm result BEFORE the React
 * app mounts, then asserts on the WS message stream.
 *
 *   - Test 1: `window.confirm = () => true` + click → assert
 *     a `{type:"control", command:"kill_switch"}` is sent on at
 *     least one WS (the ControlBar's WS).
 *   - Test 2: `window.confirm = () => false` + click → assert
 *     NO control command is sent on any WS.
 *
 * **Architecture note:** the apps/web dashboard has 3
 * `useWebSocket()` consumers (App, ControlBar, PositionsTable),
 * each with its own WebSocket connection. The ControlBar's
 * `send()` (used by the kill switch) goes to the ControlBar's
 * WS — but we don't need to identify which one. We capture
 * messages on ALL WSes and check if any of them has the
 * kill_switch command. The App + PositionsTable don't have
 * kill switch buttons, so they won't send it.
 */

import { type Page, expect, test } from "@playwright/test";
import type { WebSocketRoute } from "@playwright/test";

// =============================================================================
// Test helpers
// =============================================================================

/** Minimal shape of a parsed control command. */
interface ParsedControl {
  readonly type: "control";
  readonly command: string;
  readonly paused?: boolean;
  readonly confirm?: boolean;
}

interface WsTestHarness {
  readonly getAllWs: () => readonly WebSocketRoute[];
  readonly getSentFromPage: () => readonly string[];
  readonly broadcast: (data: string) => void;
  readonly waitForWsCount: (n: number, timeoutMs?: number) => Promise<void>;
}

async function setupWsPeer(page: Page): Promise<WsTestHarness> {
  // Mock /api/strategies so the chart grid renders.
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

/**
 * `extractControlCommands(messages)` — parse the cumulative
 * `sentFromPage` log and return just the control commands.
 */
function extractControlCommands(
  messages: readonly string[],
): readonly ParsedControl[] {
  const out: ParsedControl[] = [];
  for (const m of messages) {
    try {
      const parsed = JSON.parse(m) as {
        type?: string;
        command?: string;
        paused?: boolean;
        confirm?: boolean;
      };
      if (
        parsed.type === "control" &&
        typeof parsed.command === "string"
      ) {
        out.push({
          type: "control",
          command: parsed.command,
          paused: parsed.paused,
          confirm: parsed.confirm,
        });
      }
    } catch {
      // ignore non-JSON frames
    }
  }
  return out;
}

// =============================================================================
// Tests
// =============================================================================

test.describe("53C — Kill-switch confirm branches", () => {
  test("53C-04 — confirm=true: clicking Kill Switch sends {type:'control', command:'kill_switch'}", async ({
    page,
  }) => {
    // Mock `window.confirm` to return `true` BEFORE the React app
    // mounts. The `addInitScript` callback runs in the browser
    // context before any page scripts (including main.tsx).
    await page.addInitScript(() => {
      window.confirm = (): boolean => true;
    });

    const harness = await setupWsPeer(page);
    await page.goto("/");
    await harness.waitForWsCount(3);
    sendInitialServerMessages(harness);

    await expect(page.locator(".ep-app__status-dot")).toHaveAttribute(
      "data-status",
      "connected",
      { timeout: 5_000 },
    );
    const killBtn = page.locator(
      '.ep-control-bar__btn--danger:has-text("Kill Switch")',
    );
    await expect(killBtn).toBeEnabled();

    const sentBefore = harness.getSentFromPage().length;
    await killBtn.click();

    // The ControlBar's `send` is called with
    // `{type: "control", command: "kill_switch"}`. This goes to
    // the ControlBar's WS (one of the 3 active). We check the
    // cumulative message log across all WSes.
    await expect
      .poll(
        () =>
          extractControlCommands(
            harness.getSentFromPage().slice(sentBefore),
          ).some((c) => c.command === "kill_switch"),
        { timeout: 3_000, message: "expected kill_switch control command" },
      )
      .toBe(true);
  });

  test("53C-05 — confirm=false: clicking Kill Switch sends NO control command", async ({
    page,
  }) => {
    // Mock `window.confirm` to return `false` (refuse the kill).
    await page.addInitScript(() => {
      window.confirm = (): boolean => false;
    });

    const harness = await setupWsPeer(page);
    await page.goto("/");
    await harness.waitForWsCount(3);
    sendInitialServerMessages(harness);

    await expect(page.locator(".ep-app__status-dot")).toHaveAttribute(
      "data-status",
      "connected",
      { timeout: 5_000 },
    );
    const killBtn = page.locator(
      '.ep-control-bar__btn--danger:has-text("Kill Switch")',
    );
    await expect(killBtn).toBeEnabled();

    const sentBefore = harness.getSentFromPage().length;
    await killBtn.click();

    // Give the click a beat to fire and any synchronous send() to
    // propagate. After that, the control-commands array should
    // NOT contain a kill_switch.
    await page.waitForTimeout(500);

    const commands = extractControlCommands(
      harness.getSentFromPage().slice(sentBefore),
    );
    const hasKillSwitch = commands.some(
      (c) => c.command === "kill_switch",
    );
    expect(hasKillSwitch).toBe(false);
  });
});
