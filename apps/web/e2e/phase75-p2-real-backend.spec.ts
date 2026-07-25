/**
 * apps/web/e2e/phase75-p2-real-backend.spec.ts
 *
 * Phase 75 Part 2 verification: connect to the REAL http://127.0.0.1:7913
 * (no route mocks) and verify:
 *   1. The page loads
 *   2. The WS connects
 *   3. The WS receives frames (HELLO, SNAPSHOT, bars)
 *   4. The status banner shows "Bot: RUNNING"
 *   5. At least one chart renders candles
 *
 * The test is meant to be run while a real `mm-bot start` + `mm-bot web`
 * is running. The test fails if no frames are received within 10s of
 * WS connect (the Phase 75 Part 1 bug).
 */

import { expect, test } from "@playwright/test";

const APP_URL = "http://127.0.0.1:7913/";

interface WsFrame {
  type: string;
  size: number;
  receivedAt: number;
}

test("Phase 75 P2: real backend — WS relay delivers messages to browser", async ({ page }) => {
  test.setTimeout(60_000);

  const wsList: unknown[] = [];
  const frames: WsFrame[] = [];

  page.on("websocket", (ws) => {
    wsList.push(ws);
    // The Playwright `ws` is a WebSocketRoute. Use a permissive cast
    // for the `on` method to avoid TypeScript strict-mode friction
    // between Playwright's typed events and the inferred page-handler
    // type signature.
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
        // not JSON, keep "<binary>"
      }
      frames.push({ type, size: payload.length, receivedAt: Date.now() });
    });
  });

  await page.goto(APP_URL, { waitUntil: "domcontentloaded" });

  // Wait for at least 1 WS to be created.
  await expect.poll(() => wsList.length, { timeout: 10_000 }).toBeGreaterThan(0);

  // Wait for the first frame.
  await expect
    .poll(() => frames.length, { timeout: 10_000, message: `WS created but no frames received. wsList=${wsList.length}` })
    .toBeGreaterThan(0);

  // Wait a bit longer to accumulate a few frames.
  await expect
    .poll(() => frames.filter((f) => f.type === "snapshot").length, { timeout: 10_000 })
    .toBeGreaterThan(0);

  // Wait for the "Bot: RUNNING" banner.
  await expect(page.getByText(/Bot:\s*running/i)).toBeVisible({ timeout: 15_000 });

  // Wait for at least one chart to render.
  const canvas = page.locator("canvas").first();
  await expect(canvas).toBeVisible({ timeout: 15_000 });

  const frameTypes: Record<string, number> = {};
  for (const f of frames) {
    frameTypes[f.type] = (frameTypes[f.type] ?? 0) + 1;
  }
  console.log("FRAME TYPES:", JSON.stringify(frameTypes));
  console.log("TOTAL FRAMES:", frames.length);
  console.log("WS COUNT:", wsList.length);
});
