/**
 * Phase 81: real-bot debugging spec.
 */

import { test, expect } from "@playwright/test";

test("debug: see what messages the dashboard receives", async ({ page }) => {
  const messages: string[] = [];
  page.on("console", (msg) => {
    messages.push(`[${msg.type()}] ${msg.text()}`);
  });
  page.on("websocket", (ws) => {
    console.log(`[ws] opened: ${ws.url()}`);
    ws.on("framesent", (frame) => {
      console.log(`[ws] sent: ${String(frame.payload).slice(0, 200)}`);
    });
    ws.on("framereceived", (frame) => {
      console.log(`[ws] received: ${String(frame.payload).slice(0, 200)}`);
    });
    ws.on("close", () => console.log(`[ws] closed`));
  });
  page.on("request", (req) => {
    if (req.url().includes("/api/")) {
      console.log(`[http] ${req.method()} ${req.url()}`);
    }
  });
  page.on("response", (res) => {
    if (res.url().includes("/api/")) {
      console.log(`[http] ${String(res.status())} ${res.url()}`);
    }
  });

  await page.goto("http://127.0.0.1:7913/");
  await expect(page.locator(".ep-app__status-dot")).toHaveAttribute(
    "data-status",
    "connected",
    { timeout: 15_000 },
  );

  console.log("--- initial state banner ---");
  const banner = page.locator('[data-testid="bot-status-banner"]');
  const text = await banner.textContent();
  const state = await banner.getAttribute("data-bot-state");
  console.log(`[p81] banner text: ${String(text)}`);
  console.log(`[p81] banner data-bot-state: ${String(state)}`);

  await page.waitForTimeout(2000);
  console.log("--- after 2s wait ---");

  // Click Start.
  const startBtn = page.locator('[data-testid="control-bar-start"]');
  if (await startBtn.isEnabled()) {
    await startBtn.click();
    await page.waitForTimeout(3000);
    console.log("--- after Start click + 3s wait ---");
  }

  // Output all console messages.
  console.log(`--- captured ${String(messages.length)} console messages ---`);
  for (const m of messages.slice(0, 20)) {
    console.log(m);
  }
});
