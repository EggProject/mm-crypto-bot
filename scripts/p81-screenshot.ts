/**
 * scripts/p81-screenshot.ts
 *
 * Phase 81: one-off browser screenshot helper. Opens the
 * running dashboard at http://127.0.0.1:7913, waits for the
 * BTC/USDC 1h chart to render with bars + the new Bollinger
 * band + daily pivot indicators, and saves a screenshot to
 * /tmp/dashboard-p81-bollinger-daily-pivot.png.
 *
 * **Why a standalone script (not a playwright spec):** the
 * screenshot is required for the Phase 81 PR body but is NOT
 * a regression test (it's a one-off capture of the current
 * browser state). Putting it in `e2e/` would mean a permanent
 * spec that always passes, which adds noise without value.
 * Putting it in `scripts/` keeps it as a maintainable
 * developer tool.
 *
 * **How to run:**
 *   1. Start the bot: `bun run mm-bot start --config=./run-bot/config/paper-backtest-verified.toml`
 *   2. Start the web: `bun run mm-bot web`
 *   3. Take the screenshot: `bun scripts/p81-screenshot.ts`
 *
 * **What the screenshot must show (per the user's Phase 81
 * mandate):**
 *   - The BTC/USDC 1h chart card.
 *   - The OHLC candles.
 *   - The Donchian band (3 lines: gold upper, slate middle, red lower).
 *   - The Bollinger band (3 lines: gold upper, slate middle, red lower).
 *   - The rolling pivot (dashed slate).
 *   - The daily pivot (dashed slate PP + green R1 + red S1).
 *   - The breakout signal markers (arrows on the candles).
 */
import { chromium, type Page } from "@playwright/test";

async function main(): Promise<void> {
  const url = "http://127.0.0.1:7913/";
  const screenshotPath = "/tmp/dashboard-p81-bollinger-daily-pivot.png";

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1400, height: 900 },
  });
  const page: Page = await context.newPage();
  page.on("console", (msg) => {
    // Surface the page's console output for easier debugging if
    // the chart fails to render. Discarded by default but the
    // hook is here for future Phase work.
    if (msg.type() === "error") {
      console.error(`[browser error] ${msg.text()}`);
    }
  });

  await page.goto(url);

  // Wait for the app to mark itself "connected" (the WebSocket
  // has received the SNAPSHOT message from the bot).
  await page.waitForSelector(".ep-app__status-dot[data-status='connected']", {
    timeout: 30_000,
  });

  // Wait for the BTC/USDC 1h chart card to mount. The
  // dashboard has 5 strategies × 3 symbols × 3 timeframes =
  // 45 cards; the BTC/USDC 1h card appears 5 times (once
  // per strategy). The user wants the ENABLED strategy
  // (donchian_pivot_composition) — that's the one with the
  // new Bollinger band + daily pivot. We scope by
  // `data-strategy-enabled="true"` AND
  // `data-strategy="donchian_pivot_composition"`.
  const card = page.locator(
    '.ep-chart-card[data-strategy="donchian_pivot_composition"][data-symbol="BTC/USDC"][data-timeframe="1h"]',
  );
  await card.waitFor({ state: "visible", timeout: 15_000 });

  // Give the chart ~2s to render the bars + indicators. The
  // Bollinger band needs 20 bars to produce a value; the
  // daily pivot needs 2. The bot ships 85638 bars of
  // bootstrap, so the indicators should be defined for the
  // entire visible window.
  await page.waitForTimeout(2_500);

  // Scroll the BTC/USDC 1h card into the viewport (the grid
  // has 5 strategies × 3 symbols × 3 timeframes = 45 cards;
  // the BTC/USDC 1h card is the FIRST card in the grid).
  await card.scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);

  // Capture the screenshot of the full card (including the
  // chrome title + range tabs + chart body). The card's
  // bounding box is captured, not the full page, so the
  // screenshot is focused on the chart the user wanted.
  await card.screenshot({ path: screenshotPath });

  // eslint-disable-next-line no-console
  console.log(`Saved screenshot to ${screenshotPath}`);

  await context.close();
  await browser.close();
}

main().catch((err) => {
  console.error("Screenshot failed:", err);
  process.exit(1);
});
