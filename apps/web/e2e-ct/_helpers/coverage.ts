/**
 * e2e-ct/_helpers/coverage.ts
 *
 * Component Test (CT) coverage collection — mxschmitt `baseFixtures.ts`
 * pattern, extended with per-test capture. Phase 58.5.
 *
 * **The pattern (per the official `mxschmitt/playwright-test-coverage`
 * `ct-react-vite` branch):**
 *   1. Playwright CT's internal Vite dev server is configured with
 *      `vite-plugin-istanbul({ forceBuildInstrument: true })` via
 *      `ctViteConfig.plugins` in `playwright-ct.config.ts`. This
 *      instruments the source code at SERVE time, so every component
 *      mount runs instrumented code.
 *   2. We call `context.addInitScript()` to register a
 *      `beforeunload` handler that pushes `window.__coverage__`
 *      to a Node function via `context.exposeFunction()`.
 *   3. We also add a per-test `afterEach` hook that captures
 *      `window.__coverage__` from the current page after the
 *      test runs (Playwright CT creates a new page per test, so
 *      `beforeunload` may NOT fire on test boundaries — only on
 *      explicit navigation).
 *   4. The Node function writes each snapshot to
 *      `.nyc_output/playwright_ct_<uuid>.json`.
 *   5. The e2e `dashboard.spec.ts` `afterAll` reads the .nyc_output
 *      directory and merges the CT coverage into the final map.
 */
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import type { Page } from "@playwright/test";
import { test as baseTest, expect } from "@playwright/experimental-ct-react";

const NYC_OUTPUT_DIR = path.join(process.cwd(), ".nyc_output");

/** Augment the global Window type to include the istanbul + helper globals. */
interface CtWindow {
  __coverage__?: unknown;
  collectIstanbulCoverage?: (coverageJSON: string) => void;
}

function generateUUID(): string {
  return crypto.randomBytes(16).toString("hex");
}

/* eslint-disable security/detect-non-literal-fs-filename */
function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}
function pathExists(p: string): boolean {
  return fs.existsSync(p);
}
function listFiles(dir: string): string[] {
  return fs.readdirSync(dir);
}
function readUtf8(p: string): string {
  return fs.readFileSync(p, "utf-8");
}
function rmFile(p: string): void {
  fs.unlinkSync(p);
}
function writeUtf8(p: string, data: string): void {
  fs.writeFileSync(p, data);
}
/* eslint-enable security/detect-non-literal-fs-filename */

/** Capture `window.__coverage__` from the page and write it to
 *  a unique file in `.nyc_output/`. Called by both the
 *  `beforeunload` handler AND the `afterEach` hook. */
async function captureAndWrite(page: Page): Promise<void> {
  try {
    const cov = await page.evaluate(() => {
      return (window as unknown as CtWindow).__coverage__;
    });
    if (cov !== undefined) {
      const json = JSON.stringify(cov);
      await page.evaluate((s: string) => {
        const w = window as unknown as CtWindow;
        if (w.collectIstanbulCoverage !== undefined) {
          w.collectIstanbulCoverage(s);
        }
      }, json);
    }
  } catch {
    // Page may have closed; nothing to capture.
  }
}

/** `afterEachCapture` — per-test capture. Playwright CT creates a
 *  new page per test (the `mount()` fixture), so we hook into
 *  `test.afterEach` to capture the page's coverage reliably. The
 *  `page` argument comes from Playwright's CT-specific fixture. */
async function afterEachCapture(
  { page }: { page: Page },
): Promise<void> {
  await captureAndWrite(page);
}

export const test = baseTest.extend({
  context: async ({ context }, use) => {
    // 1. Register a beforeunload handler in every new page in the
    //    context. This fires when the page navigates or is closed
    //    during normal browser lifecycle.
    await context.addInitScript(() => {
      window.addEventListener("beforeunload", () => {
        const w = window as unknown as CtWindow;
        const cov = w.__coverage__;
        if (cov !== undefined && w.collectIstanbulCoverage !== undefined) {
          w.collectIstanbulCoverage(JSON.stringify(cov));
        }
      });
    });
    // 2. Make sure the output directory exists.
    ensureDir(NYC_OUTPUT_DIR);
    // 3. Expose the Node function that writes the JSON.
    await context.exposeFunction(
      "collectIstanbulCoverage",
      (coverageJSON: string) => {
        if (coverageJSON !== "") {
          writeUtf8(
            path.join(
              NYC_OUTPUT_DIR,
              `playwright_ct_${generateUUID()}.json`,
            ),
            coverageJSON,
          );
        }
      },
    );
    await use(context);
    // 4. After the spec completes, do a final capture of any
    //    remaining pages' coverage.
    for (const page of context.pages()) {
      await captureAndWrite(page);
    }
  },
});

// Per-test capture: Playwright CT creates a new page per test (the
// `mount()` fixture). We hook into `test.afterEach` to capture the
// page's coverage reliably. The `page` fixture is provided by
// Playwright's CT runtime and points at the page used for the
// current test. This runs BEFORE the spec-level `use(context)`
// resumes, ensuring the page is still alive.
test.afterEach(afterEachCapture);

export { expect };

/**
 * `readAllCtCoverageFiles()` — read all .nyc_output/playwright_ct_*.json
 * files and return the merged coverage map. Called by the e2e
 * `dashboard.spec.ts` `afterAll` to merge CT coverage into the
 * final report.
 */
export function readAllCtCoverageFiles(): Record<string, unknown> {
  if (!pathExists(NYC_OUTPUT_DIR)) return {};
  const files = listFiles(NYC_OUTPUT_DIR).filter(
    (f) => f.startsWith("playwright_ct_") && f.endsWith(".json"),
  );
  const merged: Record<string, unknown> = {};
  for (const f of files) {
    try {
      const data = JSON.parse(
        readUtf8(path.join(NYC_OUTPUT_DIR, f)),
      ) as Record<string, unknown>;
      Object.assign(merged, data);
    } catch {
      // Skip malformed file
    }
  }
  return merged;
}

/**
 * `clearCtCoverageFiles()` — remove all .nyc_output/playwright_ct_*.json
 * files. Called before a fresh CT run to avoid stale data.
 */
export function clearCtCoverageFiles(): void {
  if (!pathExists(NYC_OUTPUT_DIR)) return;
  const files = listFiles(NYC_OUTPUT_DIR).filter(
    (f) => f.startsWith("playwright_ct_") && f.endsWith(".json"),
  );
  for (const f of files) {
    rmFile(path.join(NYC_OUTPUT_DIR, f));
  }
}
