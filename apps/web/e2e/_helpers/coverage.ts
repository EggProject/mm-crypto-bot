/**
 * apps/web/e2e/_helpers/coverage.ts
 *
 * Shared coverage collection helper for non-dashboard spec files.
 *
 * **Problem:** `dashboard.spec.ts` collects coverage from its
 * own tests and writes the lcov report. Other spec files
 * (53C, 55-2, 56A, 57A, etc.) run their tests but their
 * `window.__coverage__` data is never included in the report.
 *
 * **Solution:** each non-dashboard spec file calls
 * `installCoverageHooks(specName)` which:
 *   1. Registers `test.afterEach` to read `window.__coverage__`
 *      and merge into a shared accumulator.
 *   2. Registers `test.afterAll` to write the accumulator to
 *      `coverage/playwright/accumulators/<specName>.json`.
 *
 * The `dashboard.spec.ts` `afterAll` reads all accumulator files
 * and merges them using `istanbul-lib-coverage`'s `createCoverageMap`
 * + `map.merge()` (UNION of covered lines/branches) before
 * writing the final report.
 *
 * **Usage in a spec file:**
 *
 *   import { test, expect } from "@playwright/test";
 *   import { installCoverageHooks } from "./_helpers/coverage.js";
 *
 *   installCoverageHooks("my-spec-name");
 *
 *   test.describe("...", () => { ... });
 */

import { type Page, test } from "@playwright/test";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// `__dirname` is `apps/web/e2e/_helpers/`, so three `..`s take us
// to `apps/web/`.
const APPS_WEB = resolve(__dirname, "../..");
const COVERAGE_DIR = resolve(APPS_WEB, "coverage/playwright");
const ACCUMULATOR_DIR = resolve(COVERAGE_DIR, "accumulators");

/** Per-spec accumulator. */
const coverageAccumulator: Record<string, unknown> = {};

/** The spec name set by the last `installCoverageHooks()` call. */
let currentSpecName = "unknown-spec";

/** Read `window.__coverage__` from the page and merge into the accumulator. */
async function collectCoverageFromPage(page: Page): Promise<void> {
  const cov = await page.evaluate(() => {
    return (
      (window as unknown as { __coverage__?: Record<string, unknown> })
        .__coverage__ ?? null
    );
  });
  if (cov === null) return;
  Object.assign(coverageAccumulator, cov);
}

/** Write the accumulator to a per-spec JSON file. */
function flushAccumulator(): void {
  mkdirSync(ACCUMULATOR_DIR, { recursive: true });
  // The `currentSpecName` is set by `installCoverageHooks(specName)`
  // which is called from each spec file. The file path is derived
  // from the spec name + a constant directory — both controlled
  // by the test, not user input.
  const filePath = resolve(ACCUMULATOR_DIR, `${currentSpecName}.json`);
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  writeFileSync(filePath, JSON.stringify(coverageAccumulator, null, 2), "utf8");
}

/**
 * `installCoverageHooks(specName)` — register the `test.afterEach`
 * and `test.afterAll` hooks for coverage collection. Call this ONCE
 * in each spec file's top-level scope (outside `test.describe`).
 *
 * The `specName` parameter is used for the accumulator file name
 * (e.g. `coverage/playwright/accumulators/<specName>.json`).
 */
export function installCoverageHooks(specName: string): void {
  currentSpecName = specName;

  test.afterEach(async ({ page }) => {
    await collectCoverageFromPage(page);
  });

  test.afterAll(() => {
    flushAccumulator();
  });
}

/**
 * `readAllAccumulators()` — read all per-spec accumulator files
 * and return the merged data. Called by `dashboard.spec.ts` in
 * its `afterAll` hook.
 */
export function readAllAccumulators(): Record<string, unknown> {
  if (!existsSync(ACCUMULATOR_DIR)) return {};
  const merged: Record<string, unknown> = {};
  for (const file of readdirSync(ACCUMULATOR_DIR)) {
    if (!file.endsWith(".json")) continue;
    try {
      // The file path is derived from the accumulator directory
      // (constant) + a `.json` file name (from `readdirSync`,
      // not user input).
      const data = JSON.parse(
        // eslint-disable-next-line security/detect-non-literal-fs-filename
        readFileSync(resolve(ACCUMULATOR_DIR, file), "utf8"),
      ) as Record<string, unknown>;
      Object.assign(merged, data);
    } catch {
      // Ignore corrupted files.
    }
  }
  return merged;
}
