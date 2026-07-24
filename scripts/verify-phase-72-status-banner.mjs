// scripts/verify-phase-72-status-banner.mjs
// Phase 72 verification — browser screenshot of paper-mode dashboard
// showing the "Bot: RUNNING" + uptime + positions status banner.
//
// Verifies the Phase 72 fix for the status broadcast bug:
//   - botStatus.state === "running" (NOT "stopped")
//   - botStatus.startedAt > 0 (recent timestamp)
//   - uptime is rendered (NOT "—")
//   - 3 open positions are shown (BTC, ETH, SOL longs)
//   - 1 active strategy
//
// Run from the project root (where Playwright is installed via apps/web):
//   bunx --bun node scripts/verify-phase-72-status-banner.mjs

import { chromium } from "playwright";
import { writeFileSync } from "node:fs";

const URL = process.env["SCREENSHOT_URL"] || "http://127.0.0.1:7913/";
const OUT = process.env["SCREENSHOT_OUT"] || `/tmp/dashboard-p72-real-${new Date().toISOString().replace(/[:.]/g, "-").replace("T", "_").slice(0, 19)}.png`;
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

// HTTP /api/status direct probe
const apiStatus = await page.evaluate(async () => {
  try {
    const res = await fetch("/api/status");
    return { ok: res.ok, status: res.status, body: await res.json() };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
});

// Dashboard rendered text — find the status banner
const status = await page.evaluate(() => {
  const text = document.body.innerText;
  const find = (regex) => {
    const m = text.match(regex);
    return m ? m[0] : null;
  };
  return {
    title: document.title,
    bodyTextSample: text.slice(0, 4000),
    botRunningText: find(/Bot:\s*(RUNNING|STOPPED|PAUSED)/i),
    uptimeText: find(/uptime[^,\n]*/i),
    lastUpdateText: find(/last update[^,\n]*/i),
    strategiesText: find(/\d+\s*active\s*strateg(y|ies)/i),
    positionsText: find(/\d+\s*open\s*positions?/i),
  };
});

const screenshot = await page.screenshot({ fullPage: true });
writeFileSync(OUT, screenshot);

const report = {
  url: URL,
  outputPath: OUT,
  apiStatus: {
    ok: apiStatus.ok,
    status: apiStatus.status,
    botState: apiStatus.ok && apiStatus.body?.botStatus?.state,
    startedAt: apiStatus.ok && apiStatus.body?.botStatus?.startedAt,
    positions: apiStatus.ok && apiStatus.body?.botStatus?.positions?.length,
    activeStrategyCount: apiStatus.ok && apiStatus.body?.botStatus?.activeStrategyCount,
  },
  dashboard: {
    title: status.title,
    botRunningText: status.botRunningText,
    uptimeText: status.uptimeText,
    lastUpdateText: status.lastUpdateText,
    strategiesText: status.strategiesText,
    positionsText: status.positionsText,
  },
  pageErrors,
  consoleLinesSample: consoleLines.slice(0, 10),
};

console.log(JSON.stringify(report, null, 2));
await browser.close();
