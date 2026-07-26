/**
 * Manual screenshot script for Phase 81 — start a real browser,
 * navigate to the dashboard, take a screenshot, click Start, take
 * another screenshot, click Stop, take another.
 */

import { test, expect } from "@playwright/test";

const SCREENSHOT_DIR = "/tmp/p81-screenshots";

test("Phase 81 real-bot screenshot: stopped → running → stopped", async ({
  page,
}) => {
  // The dashboard polls /api/status on mount (the bootstrap fetch +
  // a 30s slow-poll fallback when the WS is down). We rely on the
  // REAL bot's HTTP + WS endpoints, so no mocks.
  await page.goto("http://127.0.0.1:7913/");

  // Wait for WS connect.
  await expect(page.locator(".ep-app__status-dot")).toHaveAttribute(
    "data-status",
    "connected",
    { timeout: 15_000 },
  );

  // Wait for the status banner to appear.
  const banner = page.locator('[data-testid="bot-status-banner"]');
  await expect(banner).toBeVisible({ timeout: 5_000 });

  // Screenshot 1: initial state (stopped).
  await page.screenshot({
    path: `${SCREENSHOT_DIR}/01-initial-stopped.png`,
    fullPage: true,
  });
  console.log(`[p81] screenshot 1: initial state`);

  // The Start button should be enabled.
  const startBtn = page.locator('[data-testid="control-bar-start"]');
  await expect(startBtn).toBeEnabled();
  const t0 = Date.now();
  await startBtn.click();

  // The banner should flip to 'running' WITHIN 2 SECONDS.
  await expect(banner).toHaveAttribute("data-bot-state", "running", {
    timeout: 2_000,
  });
  const elapsed = Date.now() - t0;
  console.log(`[p81] Start click → banner update took ${String(elapsed)}ms`);

  // Screenshot 2: running.
  await page.screenshot({
    path: `${SCREENSHOT_DIR}/02-running.png`,
    fullPage: true,
  });

  // Click Stop.
  const stopBtn = page.locator('[data-testid="control-bar-stop"]');
  await expect(stopBtn).toBeEnabled();
  const t1 = Date.now();
  await stopBtn.click();
  await expect(banner).toHaveAttribute("data-bot-state", "stopped", {
    timeout: 2_000,
  });
  const elapsed2 = Date.now() - t1;
  console.log(`[p81] Stop click → banner update took ${String(elapsed2)}ms`);

  // Screenshot 3: stopped.
  await page.screenshot({
    path: `${SCREENSHOT_DIR}/03-stopped.png`,
    fullPage: true,
  });

  console.log(`[p81] all screenshots saved to ${SCREENSHOT_DIR}`);
});
