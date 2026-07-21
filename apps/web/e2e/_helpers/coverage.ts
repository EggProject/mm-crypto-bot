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
 * **Phase 61 fix (2026-07-20):** the per-test accumulator previously
 * used `Object.assign(coverageAccumulator, cov)` which is a SHALLOW
 * merge at the per-file level. When the same source file (e.g.
 * `strategies-parser.ts`) appears in MULTIPLE test captures with
 * DIFFERENT branch hits (e.g. 58C-12 hits the "null body" TRUE arm
 * but 58C-13 only hits the FALSE arm), the LATER capture's per-file
 * coverage entry completely overwrites the earlier one. The TRUE
 * arm hit from 58C-12 is lost when 58C-13's `__coverage__` arrives
 * (its `b` map for strategies-parser only has the FALSE arm hit).
 *
 * The fix: use `istanbul-lib-coverage.createCoverageMap().merge()`
 * per file. The per-test `__coverage__` is split by file, each file
 * gets its own CoverageMap, and `merge()` does a proper per-
 * statement / per-branch UNION across all captures. Statements/
 * branches hit in ANY capture count as hit in the merged map.
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
// Same CJS interop pattern as `dashboard.spec.ts` — the default
// import is the `createCoverageMap` constructor.
import istanbulCoverage from "istanbul-lib-coverage";
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

const { createCoverageMap } = istanbulCoverage as unknown as {
  createCoverageMap: (data: unknown) => {
    merge: (other: unknown) => void;
  };
};

/** Per-spec per-file CoverageMap accumulator. Each source-file path
 *  gets its own `createCoverageMap` so `merge()` does a per-file
 *  UNION of covered lines/branches across all tests in the spec.
 *  Without this, `Object.assign` would do a SHALLOW per-file
 *  replace — the LAST test's per-file coverage wins, dropping
 *  earlier tests' coverage data on the same file. */
const fileAcc = new Map<string, ReturnType<typeof createCoverageMap>>();

/** The spec name set by the last `installCoverageHooks()` call. */
let currentSpecName = "unknown-spec";

/** Read `window.__coverage__` from the page and union-merge into
 *  the per-file accumulator. */
async function collectCoverageFromPage(page: Page): Promise<void> {
  const cov = await page.evaluate(() => {
    return (
      (window as unknown as { __coverage__?: Record<string, unknown> })
        .__coverage__ ?? null
    );
  });
  if (cov === null) return;
  // For each source file in the per-test `__coverage__` snapshot,
  // look up (or create) the per-file CoverageMap in our accumulator
  // and union-merge the snapshot's per-file entry into it. The
  // `merge()` method takes a single-file data shape (just the
  // file's entry) and updates the per-file CoverageMap in place.
  for (const [filePath, fileCov] of Object.entries(cov)) {
    const existing = fileAcc.get(filePath);
    if (existing === undefined) {
      fileAcc.set(
        filePath,
        createCoverageMap({ [filePath]: fileCov }),
      );
    } else {
      existing.merge({ [filePath]: fileCov });
    }
  }
}

/** Write the per-file accumulator to a per-spec JSON file. We
 *  flatten the per-file CoverageMap back into a flat
 *  `Record<filePath, fileCov>` so the dashboard's `afterAll` can
 *  read it with `createCoverageMap().merge()` (same pattern as
 *  e2e-ct's `readAllCtCoverageFiles`). */
function flushAccumulator(): void {
  mkdirSync(ACCUMULATOR_DIR, { recursive: true });
  const filePath = resolve(ACCUMULATOR_DIR, `${currentSpecName}.json`);
  const flat: Record<string, unknown> = {};
  for (const [filePath, map] of fileAcc.entries()) {
    // `map.data` is the internal `Record<filePath, FileCoverageData>`
    // stored on the CoverageMap instance. We extract just the
    // single entry for `filePath` (istanbul's CoverageMap is
    // per-file internally; our wrapper has one file per map).
    const dataField = (map as unknown as { data: Record<string, unknown> }).data;
    // The `filePath` keys come from Playwright's instrumentation
    // (absolute source file paths in the project), not user
    // input, so the dynamic property access is safe.
    // eslint-disable-next-line security/detect-object-injection
    const entry = dataField[filePath];
    if (entry !== undefined) {
      // eslint-disable-next-line security/detect-object-injection
      flat[filePath] = entry;
    }
  }
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  writeFileSync(filePath, JSON.stringify(flat, null, 2), "utf8");
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
 * and return the per-file-merged coverage data. Called by
 * `dashboard.spec.ts` in its `afterAll` hook.
 *
 * **Phase 61 fix:** the per-spec accumulators are now stored as
 * `Record<filePath, FileCoverageData>` (a flat map, one entry per
 * source file). We use the same per-file `createCoverageMap().merge()`
 * pattern to union-merge across all spec files for the same file
 * (e.g. `strategies-parser.ts` may be hit by both 58C tests AND
 * dashboard tests — both should contribute).
 */
export function readAllAccumulators(): Record<string, unknown> {
  if (!existsSync(ACCUMULATOR_DIR)) return {};
  // Per-file accumulator across ALL spec files. Same Map<filePath,
  // CoverageMap> pattern as `collectCoverageFromPage` — but reading
  // from disk instead of `window.__coverage__`.
  const merged = new Map<string, ReturnType<typeof createCoverageMap>>();
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
      for (const [filePath, fileCov] of Object.entries(data)) {
        const existing = merged.get(filePath);
        if (existing === undefined) {
          merged.set(
            filePath,
            createCoverageMap({ [filePath]: fileCov }),
          );
        } else {
          existing.merge({ [filePath]: fileCov });
        }
      }
    } catch {
      // Ignore corrupted files.
    }
  }
  // Flatten back to a single Record<filePath, fileCov>. The
  // dashboard's `afterAll` will then `createCoverageMap(this)`
  // and `merge()` into the base e2e map.
  const flat: Record<string, unknown> = {};
  for (const [filePath, map] of merged.entries()) {
    const dataField = (map as unknown as { data: Record<string, unknown> }).data;
    // eslint-disable-next-line security/detect-object-injection
    const entry = dataField[filePath];
    if (entry !== undefined) {
      // eslint-disable-next-line security/detect-object-injection
      flat[filePath] = entry;
    }
  }
  return flat;
}
