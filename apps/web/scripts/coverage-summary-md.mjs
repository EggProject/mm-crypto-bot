#!/usr/bin/env node
/**
 * apps/web/scripts/coverage-summary-md.mjs
 *
 * Read a nyc `coverage-summary.json` and emit a Markdown table
 * suitable for `echo ... >> $GITHUB_STEP_SUMMARY`. The job
 * summary is rendered as Markdown on the GitHub Actions run
 * page (https://docs.github.com/en/actions/using-workflows/workflow-commands-for-github-actions#adding-a-job-summary).
 *
 * Usage:
 *   node coverage-summary-md.mjs <coverage-summary.json> [section-title]
 *
 * If the file is missing, emits a placeholder row so the
 * step summary is never empty.
 *
 * The emitted table format:
 *   ## {section-title or "Coverage"}
 *
 *   | Metric | Coverage |
 *   | --- | --- |
 *   | Lines | NN.NN% |
 *   | Branches | NN.NN% |
 *   | Functions | NN.NN% |
 *
 *   ### Per-file
 *
 *   | File | Lines | Branches | Functions |
 *   | --- | --- | --- | --- |
 *   | path/to/file.ts | NN.NN% | NN.NN% | NN.NN% |
 *   ...
 *
 * Phase 63: per user mandate 2026-07-21 ("github ci coverage
 * summary ures ... summary-ba kiirva tablazatban a report").
 */
import fs from "node:fs";
import path from "node:path";

const arg = process.argv[2];
const title = process.argv[3] ?? "Coverage";

if (!arg) {
  console.error("usage: coverage-summary-md.mjs <coverage-summary.json> [title]");
  process.exit(2);
}

const filePath = path.resolve(arg);
if (!fs.existsSync(filePath)) {
  console.log(`## ${title}`);
  console.log();
  console.log("_no coverage data found at " + arg + "_");
  process.exit(0);
}

let data;
try {
  data = JSON.parse(fs.readFileSync(filePath, "utf8"));
} catch (e) {
  console.log(`## ${title}`);
  console.log();
  console.log("_failed to parse coverage summary: " + String(e).slice(0, 200) + "_");
  process.exit(0);
}

const fmt = (pct) => {
  if (typeof pct !== "number") return "—";
  return pct.toFixed(2) + "%";
};

// Trim the long CI runner path to "src/..." for readability.
function trimPath(p) {
  const idx = p.indexOf("/apps/web/src/");
  if (idx >= 0) return p.slice(idx + "/apps/web/".length);
  const idx2 = p.indexOf("/src/");
  if (idx2 >= 0) return p.slice(idx2 + 1);
  return p;
}

const total = data.total ?? data; // nyc may use either shape

console.log(`## ${title}`);
console.log();
console.log("| Metric | Coverage |");
console.log("| --- | --- |");
console.log(`| Lines | ${fmt(total.lines?.pct)} |`);
console.log(`| Branches | ${fmt(total.branches?.pct)} |`);
console.log(`| Functions | ${fmt(total.functions?.pct)} |`);
console.log(`| Statements | ${fmt(total.statements?.pct ?? total.lines?.pct)} |`);
console.log();

console.log("### Per-file");
console.log();
console.log("| File | Lines | Branches | Functions |");
console.log("| --- | --- | --- | --- |");

// Sort files by absolute path (stable ordering)
const files = Object.keys(data).filter((k) => k !== "total").sort();
for (const file of files) {
  const c = data[file];
  if (!c || typeof c.lines?.pct !== "number") continue;
  console.log(
    `| \`${trimPath(file)}\` | ${fmt(c.lines.pct)} | ${fmt(c.branches?.pct)} | ${fmt(c.functions?.pct)} |`,
  );
}
console.log();
