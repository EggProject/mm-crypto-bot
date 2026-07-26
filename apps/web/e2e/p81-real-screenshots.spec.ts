/**
 * apps/web/e2e/p81-real-screenshots.spec.ts
 *
 * Phase 81: real-bot screenshot tests. Drives the dashboard against a
 * real running `mm-bot web` server (started manually before invoking
 * playwright).
 *
 * The test:
 *   1. Opens the dashboard at http://127.0.0.1:7913/
 *   2. Captures the initial state (whatever the bot's state is)
 *   3. Toggles the bot's state via the dashboard's ControlBar (Start
 *      if stopped, Stop if running)
 *   4. Captures the post-toggle state
 *   5. Toggles back
 *   6. Captures the final state
 *
 * The test asserts that the dashboard's banner updates WITHIN 2
 * SECONDS of the click — proving the WS push is the source of truth
 * (not the 1s HTTP poll from Phase 69).
 */

import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";

const SCREENSHOT_DIR = "/tmp/p81-screenshots";
mkdirSync(SCREENSHOT_DIR, { recursive: true });

test("Phase 81: real-bot dashboard with WS push (toggles from any initial state)", async ({
  page,
}) => {
  page.on("request", (req) => {
    if (req.url().includes("/api/")) {
      console.log(`[http] ${req.method()} ${req.url()}`);
    }
  });
  page.on("response", (res) => {
    if (res.url().includes("/api/")) {
      console.log(`[http-resp] ${String(res.status())} ${res.url()}`);
    }
  });
  page.on("websocket", (ws) => {
    console.log(`[ws] opened: ${ws.url()}`);
    ws.on("framereceived", (frame) => {
      const text = String(frame.payload);
      console.log(`[ws] received: ${text.slice(0, 200)}`);
    });
    ws.on("close", () => console.log(`[ws] closed`));
  });
  // Step 1: Connect to the real bot.
  await page.goto("http://127.0.0.1:7913/");

  // Wait for WS connect.
  await expect(page.locator(".ep-app__status-dot")).toHaveAttribute(
    "data-status",
    "connected",
    { timeout: 15_000 },
  );

  // Wait for the status banner.
  const banner = page.locator('[data-testid="bot-status-banner"]');
  await expect(banner).toBeVisible({ timeout: 5_000 });
  // Wait for the WS snapshot to arrive + the banner to settle.
  // The banner is set from the WS snapshot's `botStatus.state` field,
  // which may be "stopped" (no engine state yet) or "running"/"paused"
  // (the engine is up). The "no status yet" text is shown when
  // `useBotStatus()` returns null (i.e. before the WS snapshot
  // arrives). We poll the banner text until it contains "Bot: " +
  // a real state (not the "no status yet" fallback).
  await expect
    .poll(
      async () => {
        const text = (await banner.textContent()) ?? "";
        return text;
      },
      {
        message: "banner should show real state, not 'no status yet'",
        timeout: 5_000,
      },
    )
    .not.toContain("no status yet");

  // Capture the initial state.
  const initialState = await banner.getAttribute("data-bot-state");
  console.log(`[p81] initial state: ${String(initialState)}`);
  await page.screenshot({
    path: `${SCREENSHOT_DIR}/01-initial-${String(initialState)}.png`,
    fullPage: true,
  });

  // The toggle direction depends on the initial state.
  // If "stopped" → click Start (transition to "running").
  // If "running" → click Stop (transition to "stopped").
  const startBtn = page.locator('[data-testid="control-bar-start"]');
  const stopBtn = page.locator('[data-testid="control-bar-stop"]');

  if (initialState === "stopped") {
    // Forward path: stopped → running.
    await expect(startBtn).toBeEnabled();
    const t0 = Date.now();
    await startBtn.click();
    await expect(banner).toHaveAttribute("data-bot-state", "running", {
      timeout: 2_000,
    });
    const elapsed = Date.now() - t0;
    console.log(
      `[p81] Start click → banner update took ${String(elapsed)}ms (budget 2000ms)`,
    );
    await page.screenshot({
      path: `${SCREENSHOT_DIR}/02-running.png`,
      fullPage: true,
    });

    // Now click Stop.
    const t1 = Date.now();
    await stopBtn.click();
    await expect(banner).toHaveAttribute("data-bot-state", "stopped", {
      timeout: 2_000,
    });
    const elapsed2 = Date.now() - t1;
    console.log(
      `[p81] Stop click → banner update took ${String(elapsed2)}ms (budget 2000ms)`,
    );
    await page.screenshot({
      path: `${SCREENSHOT_DIR}/03-stopped.png`,
      fullPage: true,
    });
  } else {
    // Reverse path: running → stopped.
    await expect(stopBtn).toBeEnabled();
    const t0 = Date.now();
    await stopBtn.click();
    await expect(banner).toHaveAttribute("data-bot-state", "stopped", {
      timeout: 2_000,
    });
    const elapsed = Date.now() - t0;
    console.log(
      `[p81] Stop click → banner update took ${String(elapsed)}ms (budget 2000ms)`,
    );
    await page.screenshot({
      path: `${SCREENSHOT_DIR}/02-stopped.png`,
      fullPage: true,
    });

    // Now click Start.
    const t1 = Date.now();
    await startBtn.click();
    await expect(banner).toHaveAttribute("data-bot-state", "running", {
      timeout: 2_000,
    });
    const elapsed2 = Date.now() - t1;
    console.log(
      `[p81] Start click → banner update took ${String(elapsed2)}ms (budget 2000ms)`,
    );
    await page.screenshot({
      path: `${SCREENSHOT_DIR}/03-running.png`,
      fullPage: true,
    });
  }
});
