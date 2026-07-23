// scripts/verify-phase-67-paper-mode-browser.mjs
// Phase 67 verification — browser screenshot of paper-mode dashboard
// with the position-skip fix in place.
//
// Run from the project root (where Playwright is installed via apps/web):
//   bunx --bun node /Users/kiscsicska/projects/mm-crypto-bot/scripts/verify-phase-67-paper-mode-browser.mjs

import { chromium } from "playwright";
import { writeFileSync } from "node:fs";

const URL = process.env["SCREENSHOT_URL"] || "http://127.0.0.1:7913/";
const OUT = process.env["SCREENSHOT_OUT"] || "/tmp/dashboard-p67-paper-mode.png";
const WAIT_MS = Number(process.env["SCREENSHOT_WAIT_MS"] || "8000");

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1600, height: 1000 },
  deviceScaleFactor: 1,
});
const page = await context.newPage();

const consoleLines = [];
const pageErrors = [];
page.on("console", (msg) => {
  consoleLines.push(`[${msg.type()}] ${msg.text()}`);
});
page.on("pageerror", (err) => {
  pageErrors.push(`[pageerror] ${err.message}`);
});

await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 15_000 });
await page.waitForTimeout(WAIT_MS);

const status = await page.evaluate(() => {
  const candidates = [
    document.body.innerText.match(/(connected|disconnected|connecting|crashed)/i),
  ].filter(Boolean);
  const prices = Array.from(document.querySelectorAll("[data-price]")).map(
    (el) => el.getAttribute("data-price"),
  );
  // Extract any visible "position" or "kill-switch" related text
  const text = document.body.innerText;
  return {
    title: document.title,
    bodyTextSample: text.slice(0, 2000),
    connectionMatches: candidates.map((m) => m[0]),
    prices,
    hasKillSwitchText: /kill.?switch/i.test(text),
    hasOpenPositionText: /position|open/i.test(text),
  };
});

const screenshot = await page.screenshot({ fullPage: true });
writeFileSync(OUT, screenshot);

const report = {
  url: URL,
  outputPath: OUT,
  title: status.title,
  bodyTextSample: status.bodyTextSample,
  connectionMatches: status.connectionMatches,
  pricesCount: status.prices.length,
  pricesSample: status.prices.slice(0, 10),
  hasKillSwitchText: status.hasKillSwitchText,
  hasOpenPositionText: status.hasOpenPositionText,
  consoleLines: consoleLines.slice(0, 20),
  pageErrors,
};

console.log(JSON.stringify(report, null, 2));
await browser.close();
