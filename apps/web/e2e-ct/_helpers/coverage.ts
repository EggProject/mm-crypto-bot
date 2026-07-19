/**
 * e2e-ct/_helpers/coverage.ts
 *
 * Component Test (CT) coverage collection helper.
 *
 * Mirrors `e2e/_helpers/coverage.ts` but for the CT runner
 * (`@playwright/experimental-ct-react`). The CT spec calls
 * `installCtCoverageHooks(specName)` which:
 *   1. Registers `test.afterEach` to read `window.__coverage__`
 *      from the page and merge into a per-spec accumulator.
 *   2. Registers `test.afterAll` to write the accumulator to
 *      `coverage/ct/accumulators/<specName>.json`.
 *
 * The `merge-ct-coverage.mjs` script (see `e2e-ct/merge-ct-coverage.mjs`)
 * reads all CT accumulator files and merges them with the
 * existing E2E coverage data.
 */
import type { Page } from "@playwright/test";
import { test } from "@playwright/experimental-ct-react";
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
const APPS_WEB = resolve(__dirname, "../..");
const CT_COVERAGE_DIR = resolve(APPS_WEB, "coverage/ct");
const CT_ACCUMULATOR_DIR = resolve(CT_COVERAGE_DIR, "accumulators");

const coverageAccumulator: Record<string, unknown> = {};
let accumulatorFilePath = "";

async function collectCoverageFromPage(page: Page): Promise<void> {
  const cov = await page.evaluate(() => {
    return (
      (window as unknown as { __coverage__?: Record<string, unknown> })
        .__coverage__ ?? null
    );
  });
  if (cov === null) {
    return;
  }
  Object.assign(coverageAccumulator, cov);
}

function flushAccumulator(): void {
  if (!existsSync(CT_COVERAGE_DIR)) {
    mkdirSync(CT_COVERAGE_DIR, { recursive: true });
  }
  if (!existsSync(CT_ACCUMULATOR_DIR)) {
    mkdirSync(CT_ACCUMULATOR_DIR, { recursive: true });
  }
  // Write to the per-spec filename. The dashboard.spec.ts afterAll
  // reads the latest accumulator.
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  writeFileSync(accumulatorFilePath, JSON.stringify(coverageAccumulator, null, 2));
  // Reset for next spec by reassigning the object (no `delete`).
  for (const k of Object.keys(coverageAccumulator)) {
    // eslint-disable-next-line security/detect-object-injection
    coverageAccumulator[k] = undefined;
  }
}

export function installCtCoverageHooks(specName: string): void {
  accumulatorFilePath = resolve(CT_ACCUMULATOR_DIR, `${specName}.json`);

  test.afterEach(async ({ page }) => {
    await collectCoverageFromPage(page);
  });

  test.afterAll(() => {
    flushAccumulator();
  });
}

/**
 * `readAllCtAccumulators()` — read all per-spec CT accumulator files
 * and return the merged data. Called by the CI merge script.
 */
export function readAllCtAccumulators(): Record<string, unknown> {
  if (!existsSync(CT_ACCUMULATOR_DIR)) return {};
  const files = readdirSync(CT_ACCUMULATOR_DIR).filter((f) => f.endsWith(".json"));
  const merged: Record<string, unknown> = {};
  for (const f of files) {
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    const data = JSON.parse(readFileSync(resolve(CT_ACCUMULATOR_DIR, f), "utf-8")) as Record<string, unknown>;
    Object.assign(merged, data);
  }
  return merged;
}
