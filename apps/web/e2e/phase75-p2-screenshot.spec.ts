/**
 * apps/web/e2e/phase75-p2-screenshot.spec.ts
 *
 * Take a screenshot of the dashboard while connected to the real
 * http://127.0.0.1:7913 backend. Save to /tmp/dashboard-p75-real-*.png
 * and assert that:
 *   1. The "Bot: RUNNING" banner is visible
 *   2. At least 1 chart canvas is visible
 *   3. The WS connection status is "connected"
 */

import { expect, test } from "@playwright/test";
import { copyFileSync, mkdirSync } from "node:fs";

const APP_URL = "http://127.0.0.1:7913/";

test("Phase 75 P2: real backend screenshot", async ({ page }) => {
  test.setTimeout(60_000);

  const wsList: unknown[] = [];
  const frames: { type: string; size: number }[] = [];

  page.on("websocket", (ws) => {
    wsList.push(ws);
    const route = ws as unknown as {
      on(event: "framereceived", listener: (frame: { payload?: { toString: () => string } }) => void): void;
    };
    route.on("framereceived", (frame) => {
      const payload = frame.payload?.toString() ?? "";
      let type = "<binary>";
      try {
        const obj = JSON.parse(payload) as { type?: unknown };
        if (typeof obj === "object" && obj !== null && typeof obj.type === "string") {
          type = obj.type;
        }
      } catch {
        // not JSON
      }
      frames.push({ type, size: payload.length });
    });
  });

  await page.goto(APP_URL, { waitUntil: "domcontentloaded" });

  await expect.poll(() => wsList.length, { timeout: 15_000 }).toBeGreaterThan(0);
  await expect.poll(() => frames.filter((f) => f.type === "snapshot").length, { timeout: 20_000 }).toBeGreaterThan(0);

  await expect(page.getByText(/Bot:\s*running/i)).toBeVisible({ timeout: 15_000 });

  const canvas = page.locator("canvas").first();
  await expect(canvas).toBeVisible({ timeout: 20_000 });

  await page.waitForTimeout(2_000);

  const now = new Date();
  const ts = now.toISOString().replace(/[:T]/g, "-").slice(0, 16);
  const screenshotPath = `/tmp/dashboard-p75-real-${ts}.png`;
  mkdirSync("/tmp", { recursive: true });
  await page.screenshot({ path: screenshotPath, fullPage: true });

  copyFileSync(screenshotPath, "/tmp/dashboard-p75-real.png");

  const frameTypes: Record<string, number> = {};
  for (const f of frames) {
    frameTypes[f.type] = (frameTypes[f.type] ?? 0) + 1;
  }
  console.log("FRAME TYPES:", JSON.stringify(frameTypes));
  console.log("TOTAL FRAMES:", frames.length);
  console.log("WS COUNT:", wsList.length);
  console.log("SCREENSHOT:", screenshotPath);
});
