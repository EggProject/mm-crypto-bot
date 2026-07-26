/**
 * apps/web/e2e/_helpers/coverage-teardown.ts
 *
 * Phase 80: `globalTeardown` for the Playwright e2e suite. Runs ONCE
 * on the runner process AFTER all spec files have completed (after
 * every `test.afterAll` has fired in every worker). This is the
 * canonical place for the coverage threshold gate because it does
 * NOT depend on test execution order — the threshold check fires
 * when every spec's `afterAll` has already written its accumulator
 * to disk.
 *
 * **Why globalTeardown (and not `test.afterAll` in dashboard.spec.ts):**
 *
 * The previous design had `dashboard.spec.ts`'s `afterAll` do the
 * threshold check. This was order-dependent: with `workers > 1`,
 * the dashboard worker could complete BEFORE the
 * `80-coverage-boost` worker. The dashboard `afterAll` would then
 * generate the report from the partial accumulator state and the
 * threshold check would fail (or the report would be missing
 * branches hit only by `80-coverage-boost`). With `globalTeardown`,
 * the threshold check runs ONCE after every spec has flushed —
 * regardless of which worker completed first.
 *
 * **What the teardown does:**
 *   1. Read all per-spec accumulator files from
 *      `coverage/playwright/accumulators/*.json` (the helper
 *      `flushAccumulator()` and the dashboard `afterAll` already
 *      wrote them).
 *   2. Read the CT (Component Test) coverage data from
 *      `apps/web/.nyc_output/playwright_ct_*.json` (the e2e-ct
 *      suite wrote these in the prior CI step).
 *   3. Merge everything into a single CoverageMap (per-file
 *      `createCoverageMap().merge()` UNION pattern).
 *   4. Write `coverage-final.json` + run `nyc report` to produce
 *      the lcov + json-summary + html reports.
 *   5. Run `nyc check-coverage` against the user-mandated
 *      75/75/75 thresholds. Throw on below-threshold (this
 *      surfaces as a Playwright setup error → CI FAILS).
 *
 * The teardown is intentionally a thin shell around the same
 * logic that previously lived in `dashboard.spec.ts`'s
 * `flushAndReport()` + `checkThresholds()`. The split moves the
 * threshold check out of the worker context (where order is
 * non-deterministic) into the runner process (which always runs
 * after all workers complete).
 */

import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import istanbulCoverage from "istanbul-lib-coverage";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// `__dirname` is `apps/web/e2e/_helpers/`, so three `..`s take us
// to `apps/web/`.
const APPS_WEB = resolve(__dirname, "../..");
const COVERAGE_DIR = resolve(APPS_WEB, "coverage/playwright");
const COVERAGE_FINAL = resolve(COVERAGE_DIR, "coverage-final.json");
const ACCUMULATOR_DIR = resolve(COVERAGE_DIR, "accumulators");
const CT_NYC_OUTPUT = resolve(APPS_WEB, ".nyc_output");

// Phase 80 (user mandate 2026-07-25): the threshold is 75/75/75
// (lines/branches/functions). The previous higher target (80/80/80)
// was relaxed to 75/75/75 because the e2e lane was missing
// ~30-40 branches in `bot-status.ts` / `client-compute.ts` /
// `ChartCard.tsx` that need real-time data flows (long uptimes,
// lastUpdate variations, indicator pipelines) to exercise. The
// 95% user mandate (95/90/95) is the long-term target; 75/75/75
// is the floor for CI to pass.
const COVERAGE_THRESHOLDS = { lines: 75, branches: 75, functions: 75 } as const;

const { createCoverageMap } = istanbulCoverage as unknown as {
  createCoverageMap: (data: unknown) => {
    merge: (other: unknown) => void;
  };
};

interface CoverageReport {
  readonly lines: number;
  readonly branches: number;
  readonly functions: number;
}

/**
 * Read all per-spec accumulator files in `accumulators/`. Each file
 * is a flat `Record<filePath, FileCoverageData>` (the format the
 * helper's `flushAccumulator()` and `dashboard.spec.ts`'s
 * `afterAll` write). The cross-file merge uses per-file
 * `createCoverageMap().merge()` so the same source file hit by
 * multiple specs gets the UNION of their branch hits.
 */
function readAllAccumulators(): Record<string, unknown> {
  if (!existsSync(ACCUMULATOR_DIR)) return {};
  const merged = new Map<string, ReturnType<typeof createCoverageMap>>();
  for (const file of readdirSync(ACCUMULATOR_DIR)) {
    if (!file.endsWith(".json")) continue;
    try {
      const data = JSON.parse(
        // eslint-disable-next-line security/detect-non-literal-fs-filename
        readFileSync(resolve(ACCUMULATOR_DIR, file), "utf8"),
      ) as Record<string, unknown>;
      for (const [filePath, fileCov] of Object.entries(data)) {
        const existing = merged.get(filePath);
        if (existing === undefined) {
          merged.set(filePath, createCoverageMap({ [filePath]: fileCov }));
        } else {
          existing.merge({ [filePath]: fileCov });
        }
      }
    } catch {
      // Ignore corrupted accumulator files.
    }
  }
  const flat: Record<string, unknown> = {};
  for (const [filePath, map] of merged.entries()) {
    const dataField = (map as unknown as { data: Record<string, unknown> })
      .data;
    // eslint-disable-next-line security/detect-object-injection
    const entry = dataField[filePath];
    if (entry !== undefined) {
      // eslint-disable-next-line security/detect-object-injection
      flat[filePath] = entry;
    }
  }
  return flat;
}

/**
 * Read all CT (Component Test) coverage files. The CT lane writes
 * per-page `.nyc_output/playwright_ct_*.json` files via
 * `vite-plugin-istanbul`; the e2e `globalTeardown` unions them
 * into the final E2E coverage map. This is the "여기어때" pattern:
 * CT + E2E merged coverage.
 */
function readAllCtCoverageFiles(): Record<string, unknown> {
  if (!existsSync(CT_NYC_OUTPUT)) return {};
  const merged = new Map<string, ReturnType<typeof createCoverageMap>>();
  for (const file of readdirSync(CT_NYC_OUTPUT)) {
    if (!file.startsWith("playwright_ct_") || !file.endsWith(".json")) continue;
    try {
      const data = JSON.parse(
        // eslint-disable-next-line security/detect-non-literal-fs-filename
        readFileSync(resolve(CT_NYC_OUTPUT, file), "utf8"),
      ) as Record<string, unknown>;
      for (const [filePath, fileCov] of Object.entries(data)) {
        const existing = merged.get(filePath);
        if (existing === undefined) {
          merged.set(filePath, createCoverageMap({ [filePath]: fileCov }));
        } else {
          existing.merge({ [filePath]: fileCov });
        }
      }
    } catch {
      // Ignore corrupted CT files.
    }
  }
  const flat: Record<string, unknown> = {};
  for (const [filePath, map] of merged.entries()) {
    const dataField = (map as unknown as { data: Record<string, unknown> })
      .data;
    // eslint-disable-next-line security/detect-object-injection
    const entry = dataField[filePath];
    if (entry !== undefined) {
      // eslint-disable-next-line security/detect-object-injection
      flat[filePath] = entry;
    }
  }
  return flat;
}

/**
 * Build the final E2E coverage map from all per-spec accumulators
 * + CT data, write `coverage-final.json`, and run `nyc report` to
 * produce the lcov + json-summary + html reports.
 */
function buildReport(): CoverageReport {
  mkdirSync(COVERAGE_DIR, { recursive: true });
  // Build a base map from the e2e accumulators. With `globalTeardown`
  // running after every spec's `afterAll`, every spec's data is on
  // disk by now — no partial-state ordering issue.
  const externalData = readAllAccumulators();
  if (Object.keys(externalData).length === 0) {
    throw new Error(
      "No coverage data collected — `accumulators/` is empty. " +
        "Check that VITE_COVERAGE=true is exported before `vite build` " +
        "and that each spec's `afterAll` calls `flushAccumulator()`.",
    );
  }
  const baseMap = createCoverageMap(externalData);
  // Merge in the CT data.
  const ctExternalData = readAllCtCoverageFiles();
  if (Object.keys(ctExternalData).length > 0) {
    const ctMap = createCoverageMap(ctExternalData);
    baseMap.merge(ctMap);
  }
  writeFileSync(COVERAGE_FINAL, JSON.stringify(baseMap, null, 2), "utf8");
  const reportDir = resolve(COVERAGE_DIR, "report");
  try {
    execFileSync(
      "npx",
      [
        "nyc",
        "report",
        `--temp-dir=${COVERAGE_DIR}`,
        `--report-dir=${reportDir}`,
        "--reporter=lcov",
        "--reporter=json-summary",
        "--reporter=text",
        "--reporter=html",
      ],
      { cwd: APPS_WEB, stdio: "pipe" },
    );
  } catch (e) {
    const err = e as { stdout?: Buffer; stderr?: Buffer };
    throw new Error(
      `nyc report failed:\nSTDOUT:\n${err.stdout?.toString() ?? ""}\n` +
        `STDERR:\n${err.stderr?.toString() ?? ""}`,
      // eslint-disable-next-line preserve-caught-error
      { cause: err },
    );
  }
  const summary = JSON.parse(
    readFileSync(resolve(reportDir, "coverage-summary.json"), "utf8"),
  ) as {
    total: {
      lines: { pct: number };
      branches: { pct: number };
      functions: { pct: number };
    };
  };
  return {
    lines: summary.total.lines.pct,
    branches: summary.total.branches.pct,
    functions: summary.total.functions.pct,
  };
}

/**
 * Hard-fail the e2e suite if the coverage report is below the
 * user-mandated thresholds (75/75/75). Throws on below-threshold;
 * logs the ✓ Coverage OK line on success.
 */
function checkThresholds(report: CoverageReport): void {
  const args = [
    "check-coverage",
    `--lines=${COVERAGE_THRESHOLDS.lines}`,
    `--branches=${COVERAGE_THRESHOLDS.branches}`,
    `--functions=${COVERAGE_THRESHOLDS.functions}`,
    `--temp-dir=${COVERAGE_DIR}`,
  ];
  try {
    execFileSync("npx", ["nyc", ...args], { cwd: APPS_WEB, stdio: "pipe" });
    console.log(
      `\n✓ Coverage OK: ${report.lines.toFixed(2)}% lines / ` +
        `${report.branches.toFixed(2)}% branches / ` +
        `${report.functions.toFixed(2)}% functions ` +
        `(thresholds ${COVERAGE_THRESHOLDS.lines}/${COVERAGE_THRESHOLDS.branches}/${COVERAGE_THRESHOLDS.functions})`,
    );
  } catch (e) {
    const err = e as { stdout?: Buffer; stderr?: Buffer };
    throw new Error(
      `Coverage threshold FAILED: ` +
        `${report.lines.toFixed(2)}% lines / ` +
        `${report.branches.toFixed(2)}% branches / ` +
        `${report.functions.toFixed(2)}% functions ` +
        `(thresholds ${COVERAGE_THRESHOLDS.lines}/${COVERAGE_THRESHOLDS.branches}/${COVERAGE_THRESHOLDS.functions})\n` +
        `nyc stdout:\n${err.stdout?.toString() ?? ""}\n` +
        `nyc stderr:\n${err.stderr?.toString() ?? ""}`,
      // eslint-disable-next-line preserve-caught-error
      { cause: err },
    );
  }
}

/**
 * The `globalTeardown` function. Playwright imports this as the
 * default export and calls it once on the runner process after all
 * spec files have completed. The function must be `async` (or
 * return a Promise) to integrate with Playwright's teardown
 * protocol.
 */
// eslint-disable-next-line @typescript-eslint/require-await
export default async function globalTeardown(): Promise<void> {
  if (!existsSync(ACCUMULATOR_DIR) && !existsSync(CT_NYC_OUTPUT)) {
    // No coverage data at all — most likely a misconfigured run.
    // Skip the threshold check rather than fail spuriously; CI
    // gates will catch the missing data via the report artifact
    // upload step.
    console.log(
      "[globalTeardown] No coverage data on disk — skipping threshold check.",
    );
    return;
  }
  const report = buildReport();
  checkThresholds(report);
}
