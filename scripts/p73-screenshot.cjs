const pkg = require("/Users/kiscsicska/projects/mm-crypto-bot/.worktrees/wt-phase73/node_modules/.bun/playwright-core@1.61.1/node_modules/playwright-core/index.js");
const { chromium } = pkg;
const fs = require("node:fs");

(async () => {
  const ts = new Date()
    .toISOString()
    .replace(/[:.]/g, "")
    .replace(/T/, "-")
    .slice(0, 15);
  const outPath = `/tmp/dashboard-p73-real-${ts}.png`;

  const browser = await chromium.launch({
    executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 2200 } });
  const page = await ctx.newPage();

  page.on("console", (msg) => {
    if (msg.type() === "error" || msg.type() === "warning") {
      console.log(`[browser ${msg.type()}]`, msg.text());
    }
  });
  page.on("pageerror", (err) => {
    console.log("[pageerror]", err.message);
  });

  console.log(`[p73] navigating to http://127.0.0.1:7913/`);
  await page.goto("http://127.0.0.1:7913/", { waitUntil: "domcontentloaded", timeout: 30000 });

  console.log("[p73] waiting for 9 .line-chart-wrapper elements");
  await page.waitForFunction(
    () => document.querySelectorAll(".line-chart-wrapper").length >= 9,
    { timeout: 30000 },
  );

  console.log("[p73] waiting for chart canvases to mount");
  await page.waitForFunction(
    () => {
      const bodies = document.querySelectorAll(".line-chart-wrapper__body");
      if (bodies.length < 1) return false;
      const firstBody = bodies[0];
      return firstBody !== null && firstBody !== undefined && firstBody.querySelector("canvas") !== null;
    },
    { timeout: 30000 },
  );

  // Wait 10 seconds for the chart engine to fully render the data
  await page.waitForTimeout(10000);

  const chartInfo = await page.evaluate(() => {
    const wrappers = document.querySelectorAll(".line-chart-wrapper");
    const result = {
      wrapperCount: wrappers.length,
      legendCount: document.querySelectorAll(".line-chart-wrapper__legend").length,
      canvasCount: document.querySelectorAll("canvas").length,
      firstChart: null,
    };
    const first = wrappers[0];
    if (first !== null && first !== undefined) {
      const body = first.querySelector(".line-chart-wrapper__body");
      if (body !== null) {
        const canvas = body.querySelector("canvas");
        if (canvas !== null) {
          result.firstChart = {
            symbol: first.getAttribute("data-symbol"),
            timeframe: first.getAttribute("data-timeframe"),
            bodyH: body.clientHeight,
            canvasW: canvas.width,
            canvasH: canvas.height,
            dataLength: canvas.toDataURL().length,
          };
        }
      }
    }
    return result;
  });
  console.log("[p73] chart info:", JSON.stringify(chartInfo, null, 2));

  await page.screenshot({ path: outPath, fullPage: true });
  const size = fs.statSync(outPath);
  console.log(`[p73] screenshot saved: ${outPath} (${size.size} bytes)`);

  if (chartInfo.legendCount > 0) {
    throw new Error(
      `Phase 73 bug 1+2 NOT fixed: ${chartInfo.legendCount} .line-chart-wrapper__legend elements present`,
    );
  }
  if (chartInfo.canvasCount < 9) {
    throw new Error(
      `Expected ≥9 canvases, got ${chartInfo.canvasCount}`,
    );
  }

  await browser.close();
  console.log("[p73] PASS");
})().catch((err) => {
  console.error("[p73] FAIL:", err);
  process.exit(1);
});
