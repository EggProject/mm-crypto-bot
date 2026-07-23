// scripts/verify-phase-66-real-browser.mjs
// Phase 66 — Real-browser screenshot verification of the paper-mode dashboard
// connected to the bybit.eu state-feed (port 7924) and web bridge (port 7925).
//
// Run from apps/web/ where Playwright + browsers are installed:
//   bunx --bun playwright install chromium  # one-time
//   bunx --bun node /Users/kiscsicska/projects/mm-crypto-bot/scripts/verify-phase-66-real-browser.mjs

import { chromium } from "playwright";
import { writeFileSync } from "node:fs";

const URL = process.env["SCREENSHOT_URL"] || "http://127.0.0.1:7925/";
const OUT = process.env["SCREENSHOT_OUT"] || "/tmp/dashboard-p66-final.png";
const WAIT_MS = Number(process.env["SCREENSHOT_WAIT_MS"] || "12000");

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1600, height: 1000 },
  deviceScaleFactor: 1,
});
const page = await context.newPage();

const consoleLines = [];
page.on("console", (msg) => {
  consoleLines.push(`[${msg.type()}] ${msg.text()}`);
});
page.on("pageerror", (err) => {
  consoleLines.push(`[pageerror] ${err.message}`);
});

await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 15_000 });
await page.waitForTimeout(WAIT_MS);

const status = await page.evaluate(() => {
  // Look for connection-status indicator in the DOM.
  const candidates = [
    document.body.innerText.match(/(connected|disconnected|connecting|crashed)/i),
  ].filter(Boolean);
  const prices = Array.from(document.querySelectorAll("[data-price]")).map(
    (el) => el.getAttribute("data-price"),
  );
  return {
    title: document.title,
    bodyTextSample: document.body.innerText.slice(0, 1500),
    connectionMatches: candidates.map((m) => m[0]),
    prices,
  };
});

const screenshot = await page.screenshot({ fullPage: true });
writeFileSync(OUT, screenshot);
console.log(`Wrote screenshot to ${OUT} (${screenshot.length} bytes)`);
console.log("Connection indicators found:", status.connectionMatches);
console.log("Prices (data-price):", status.prices);
console.log("Title:", status.title);
console.log("Console messages:");
for (const line of consoleLines.slice(0, 40)) {
  console.log("  " + line);
}

await browser.close();
