#!/usr/bin/env node
/**
 * scripts/enforce-coverage-threshold.mjs
 *
 * ===========================================================================
 * PHASE 35b — MANDATORY 100% COVERAGE THRESHOLD ENFORCEMENT
 * ===========================================================================
 *
 * The user mandate is: "100% coverage testet mondtam" — every OWN file in
 * every package must be at 100% line + function coverage. This script
 * enforces that mandate by reading the per-package lcov.info files and
 * failing (exit 1) if any OWN file is below 100% on lines OR functions.
 *
 * Why this exists separately from the merge-coverage.mjs:
 *   - The merge report computes a per-FILE and a per-PACKAGE aggregate.
 *   - The aggregate is misleading (apps/bot imports packages/core; the
 *     per-package lcov shows core files at 0% from apps/bot's perspective
 *     because apps/bot doesn't exercise all of core's symbols).
 *   - The TRUE coverage number is the per-package lcov, restricted to
 *     that package's OWN src/ files. This is the number the user
 *     mandates and the number that proves the test suite catches bugs.
 *
 * What "OWN" means:
 *   - For apps/bot: files matching `src/` (cwd-relative when bun runs
 *     coverage from apps/bot/)
 *   - For packages/<pkg>: files matching `src/`
 *   - Imported files (e.g. `../../packages/core/src/...` from apps/bot)
 *     are EXCLUDED — they belong to a different package's own-file
 *     coverage and would be double-counted.
 *
 * What this checks:
 *   1. Every per-package lcov.info must exist (the package's `bun test
 *      --coverage` must have run).
 *   2. Every OWN src/ file in that package must have line coverage = 100%
 *      AND function coverage = 100% (the bun FNF/FNH summary, not the
 *      FNDA per-function data which bun doesn't emit).
 *   3. The total must be reported as a single-line pass/fail summary.
 *
 * Usage:
 *   node scripts/enforce-coverage-threshold.mjs [--root <repo>] [--out <coverage-dir>]
 *
 * Defaults: --root = parent of this script's parent, --out = <root>/coverage
 *
 * Exit codes:
 *   0 — every OWN file is at 100% on lines + functions
 *   1 — at least one file is below 100% (printed in the report)
 *   2 — missing lcov files or invalid arguments
 *
 * ===========================================================================
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = { root: null, out: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--root" || a === "-r") args.root = argv[++i];
    else if (a === "--out" || a === "-o") args.out = argv[++i];
    else if (a === "--help" || a === "-h") {
      console.log(
        "Usage: node enforce-coverage-threshold.mjs [--root <repo>] [--out <coverage-dir>]",
      );
      process.exit(0);
    }
  }
  return args;
}

const args = parseArgs(process.argv);
const REPO_ROOT = args.root ? resolve(args.root) : resolve(__dirname, "..");
const COVERAGE_ROOT = args.out ? resolve(args.out) : join(REPO_ROOT, "coverage");

// ---------------------------------------------------------------------------
// LCOV parsing
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} LcovFile
 * @property {string} path
 * @property {string} ownPrefix    glob-like prefix that identifies "own" files
 * @property {string} label        human-readable package label
 * @property {Map<string, {lf: number, lh: number, fnf: number, fnh: number}>} files
 */

/** Parse a single lcov file. Returns a Map<filePath, {lf, lh, fnf, fnh}>. */
function parseLcov(text) {
  const files = new Map();
  let cur = null;
  for (const line of text.split("\n")) {
    if (line.startsWith("SF:")) {
      const file = line.slice(3);
      cur = { lf: 0, lh: 0, fnf: 0, fnh: 0 };
      files.set(file, cur);
    } else if (cur) {
      if (line.startsWith("LF:")) cur.lf = Number(line.slice(3));
      else if (line.startsWith("LH:")) cur.lh = Number(line.slice(3));
      else if (line.startsWith("FNF:")) cur.fnf = Number(line.slice(4));
      else if (line.startsWith("FNH:")) cur.fnh = Number(line.slice(4));
      else if (line === "end_of_record") cur = null;
    }
  }
  return files;
}

// ---------------------------------------------------------------------------
// Package discovery
// ---------------------------------------------------------------------------

/** Find all packages (apps/* and packages/*) that have a coverage/lcov.info. */
function discoverPackages(repoRoot, coverageRoot) {
  /** @type {LcovFile[]} */
  const found = [];
  for (const top of ["apps", "packages"]) {
    const topPath = join(repoRoot, top);
    if (!existsSync(topPath)) continue;
    for (const entry of readdirSync(topPath, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const pkgDir = join(topPath, entry.name);
      const lcovPath = join(pkgDir, "coverage", "lcov.info");
      if (!existsSync(lcovPath)) continue;
      // apps/bot uses cwd-relative `src/` (bun's coverage cwd is apps/bot)
      // packages/* use `src/` (cwd is the package)
      const ownPrefix = "src/";
      const label = `${top}/${entry.name}`;
      found.push({
        path: lcovPath,
        ownPrefix,
        label,
        files: parseLcov(readFileSync(lcovPath, "utf8")),
      });
    }
  }
  return found;
}

// ---------------------------------------------------------------------------
// Threshold check
// ---------------------------------------------------------------------------

/** Returns {total, fullCoverage, below100, gaps[]} for one package. */
function checkPackage(pkg) {
  let total = 0;
  let fullCoverage = 0;
  /** @type {Array<{file: string, lf: number, lh: number, fnf: number, fnh: number}>} */
  const gaps = [];
  for (const [file, m] of pkg.files) {
    // Only consider OWN files (src/ prefix), exclude test files & node_modules
    if (!file.startsWith(pkg.ownPrefix)) continue;
    if (file.includes(".test.") || file.includes(".spec.")) continue;
    if (file.includes("node_modules")) continue;
    if (m.lf === 0) continue; // empty file (interface-only) — skip
    total += 1;
    const linePct = (m.lh * 100) / m.lf;
    const fnPct = m.fnf === 0 ? 100 : (m.fnh * 100) / m.fnf;
    if (linePct === 100 && fnPct === 100) {
      fullCoverage += 1;
    } else {
      gaps.push({
        file,
        lf: m.lf,
        lh: m.lh,
        fnf: m.fnf,
        fnh: m.fnh,
        linePct,
        fnPct,
      });
    }
  }
  return { total, fullCoverage, gaps };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const packages = discoverPackages(REPO_ROOT, COVERAGE_ROOT);
  if (packages.length === 0) {
    console.error(
      "ERROR: no lcov.info files found under apps/*/coverage/ or packages/*/coverage/.",
    );
    console.error("  Run `bun run coverage` (turbo) first to generate per-package lcov files.");
    process.exit(2);
  }

  // Print header
  console.log("======================================================================");
  console.log("  COVERAGE THRESHOLD ENFORCEMENT — mm-crypto-bot");
  console.log("  Mandate: 100% line + function coverage on OWN src/ files (per package)");
  console.log("======================================================================");
  console.log();

  let totalFiles = 0;
  let totalFullCoverage = 0;
  /** @type {Array<{pkg: string, total: number, fullCoverage: number, gaps: any[]}>} */
  const failed = [];
  /** @type {Array<{pkg: string, total: number, fullCoverage: number}>} */
  const passed = [];

  for (const pkg of packages) {
    const result = checkPackage(pkg);
    totalFiles += result.total;
    totalFullCoverage += result.fullCoverage;
    if (result.gaps.length === 0) {
      passed.push({ pkg: pkg.label, total: result.total, fullCoverage: result.fullCoverage });
    } else {
      failed.push({ pkg: pkg.label, ...result });
    }
  }

  // Print per-package summary
  for (const p of passed) {
    console.log(
      `  ✓ ${p.pkg.padEnd(28)} ${String(p.fullCoverage).padStart(3)}/${String(p.total).padStart(3)} OWN files at 100% line + function`,
    );
  }
  for (const f of failed) {
    console.log(
      `  ✗ ${f.pkg.padEnd(28)} ${String(f.fullCoverage).padStart(3)}/${String(f.total).padStart(3)} OWN files at 100% line + function — ${f.gaps.length} file(s) below 100%`,
    );
  }

  console.log();
  console.log(`  Total: ${totalFullCoverage}/${totalFiles} OWN files at 100% line + function coverage`);
  console.log();

  if (failed.length === 0) {
    console.log("======================================================================");
    console.log("  ✓ PASS — 100% coverage threshold satisfied on every OWN file.");
    console.log("======================================================================");
    process.exit(0);
  }

  // Print detailed gap report
  console.log("======================================================================");
  console.log("  ✗ FAIL — 100% coverage threshold NOT satisfied");
  console.log("======================================================================");
  for (const f of failed) {
    console.log();
    console.log(`  ${f.pkg}:`);
    for (const g of f.gaps) {
      const linePct = g.linePct.toFixed(2);
      const fnPct = g.fnPct.toFixed(2);
      console.log(
        `    - ${g.file}  lines=${g.lh}/${g.lf} (${linePct}%), funcs=${g.fnh}/${g.fnf} (${fnPct}%)`,
      );
    }
  }
  console.log();
  console.log("  Fix the gaps above to satisfy the 100% coverage mandate.");
  console.log("  Do NOT add '// @ts-ignore' or '/* c8 ignore */' — write real tests.");
  console.log();
  process.exit(1);
}

main();
