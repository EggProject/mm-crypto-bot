#!/usr/bin/env node
/**
 * scripts/merge-coverage.mjs
 *
 * ===========================================================================
 * PHASE 35 TRACK F — MERGED COVERAGE REPORT
 * ===========================================================================
 *
 * Merges per-package lcov.info files (one per `bun test --coverage` run) into
 * a single repository-wide report.
 *
 * Pipeline:
 *   1. Glob lcov.info files under apps/<pkg>/coverage and packages/<pkg>/coverage.
 *   2. For each lcov, parse line-based records (one per `SF:` block, delimited
 *      by `end_of_record`).
 *   3. Resolve each `SF:` path to ABSOLUTE — the lcov emits RELATIVE paths
 *      like `src/bot/bot.ts`, relative to the test runner's cwd. Since
 *      different packages use different cwds, two lcovs reporting the same
 *      file (e.g. a shared lib) must be matched on the absolute path.
 *   4. Group records by absolute path. Merge hits per line/function/branch.
 *   5. Emit ONE merged `coverage/merged/lcov.info` (relative-to-repo paths
 *      so the report is portable across machines).
 *   6. Emit `coverage/merged/coverage-summary.json` (istanbul-style:
 *      `total` block + per-file blocks with line/branch/function/statement
 *      totals, covered, pct).
 *   7. Print a text summary to stdout (line %, branch %, funcs %, files).
 *   8. Emit a basic HTML report at `coverage/merged/html/index.html` with
 *      a per-file table (line %, branch %, uncovered line ranges) and a
 *      file-detail view (line-by-line, color-coded).
 *
 * No external deps. Pure Node.js (>= 18). Bun also runs this fine.
 *
 * Why this exists:
 *   Bun 1.3.14's test coverage only emits `text` and `lcov` reporters
 *   (no JSON, no v8 raw). To get a single merged report, we parse lcov,
 *   which is a stable, line-based, well-documented format that's been
 *   around since 2009.
 *
 * Usage:
 *   node scripts/merge-coverage.mjs [--root <repo-root>] [--out <coverage-dir>]
 *
 * Defaults: --root = parent of this script's parent, --out = <root>/coverage/merged
 *
 * ===========================================================================
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve, dirname, basename } from "node:path";
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
    if (a === "--root" || a === "-r") {
      args.root = argv[++i];
    } else if (a === "--out" || a === "-o") {
      args.out = argv[++i];
    } else if (a === "--help" || a === "-h") {
      console.log(
        "Usage: node merge-coverage.mjs [--root <repo>] [--out <coverage-dir>]",
      );
      process.exit(0);
    }
  }
  return args;
}

const args = parseArgs(process.argv);
const REPO_ROOT = args.root ? resolve(args.root) : resolve(__dirname, "..");
const OUT_DIR = args.out ? resolve(args.out) : join(REPO_ROOT, "coverage", "merged");
const LCOV_OUT = join(OUT_DIR, "lcov.info");
const JSON_OUT = join(OUT_DIR, "coverage-summary.json");
const HTML_DIR = join(OUT_DIR, "html");
const HTML_OUT = join(HTML_DIR, "index.html");

// ---------------------------------------------------------------------------
// Lcov parsing
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} LcovRecord
 * @property {string} sf       absolute path to the source file
 * @property {string} testCwd  cwd of the test run that produced this record
 * @property {Map<number, number>} da           line -> hit count
 * @property {Map<string, {name: string, line: number, hits: number}>} fnda  fn -> data
 * @property {Map<string, number>} brda  `${line}:${block}:${branch}` -> hits
 * @property {number} bunFNF   bun-only: FNF summary (no per-function FN records)
 * @property {number} bunFNH   bun-only: FNH summary
 */

/** Parse a single lcov file. Returns LcovRecord[]. */
function parseLcov(text) {
  /** @type {LcovRecord[]} */
  const records = [];
  let cur = null;
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (line === "" || line === "TN:") continue;
    if (line.startsWith("SF:")) {
      if (cur !== null) {
        records.push(cur);
      }
      cur = {
        sf: line.slice(3),
        da: new Map(),
        fnda: new Map(),
        brda: new Map(),
        bunFNF: 0,
        bunFNH: 0,
      };
      continue;
    }
    if (line === "end_of_record") {
      if (cur !== null) {
        records.push(cur);
        cur = null;
      }
      continue;
    }
    if (cur === null) continue;
    if (line.startsWith("DA:")) {
      const rest = line.slice(3);
      const comma = rest.indexOf(",");
      if (comma < 0) continue;
      const ln = Number.parseInt(rest.slice(0, comma), 10);
      const hits = Number.parseInt(rest.slice(comma + 1), 10);
      if (Number.isFinite(ln)) {
        cur.da.set(ln, (cur.da.get(ln) ?? 0) + hits);
      }
    } else if (line.startsWith("FNDA:")) {
      // FNDA:<hits>,<name>
      const rest = line.slice(5);
      const comma = rest.indexOf(",");
      if (comma < 0) continue;
      const hits = Number.parseInt(rest.slice(0, comma), 10);
      const name = rest.slice(comma + 1);
      // Bun emits FNDA WITHOUT the function line (different from istanbul)
      // We key by name only.
      const key = `name:${name}`;
      const prev = cur.fnda.get(key);
      cur.fnda.set(key, {
        name,
        line: prev?.line ?? -1,
        hits: (prev?.hits ?? 0) + (Number.isFinite(hits) ? hits : 0),
      });
    } else if (line.startsWith("FN:")) {
      // FN:<line>,<name>
      const rest = line.slice(3);
      const comma = rest.indexOf(",");
      if (comma < 0) continue;
      const ln = Number.parseInt(rest.slice(0, comma), 10);
      const name = rest.slice(comma + 1);
      const key = `name:${name}`;
      const prev = cur.fnda.get(key);
      cur.fnda.set(key, {
        name,
        line: ln,
        hits: prev?.hits ?? 0,
      });
    } else     if (line.startsWith("BRDA:")) {
      // BRDA:<line>,<block>,<branch>,<hits>
      const parts = line.slice(5).split(",");
      if (parts.length < 4) continue;
      const ln = parts[0];
      const block = parts[1];
      const branch = parts[2];
      const hitsStr = parts[3];
      const hits = hitsStr === "-" ? 0 : Number.parseInt(hitsStr, 10);
      const key = `${ln}:${block}:${branch}`;
      cur.brda.set(key, (cur.brda.get(key) ?? 0) + (Number.isFinite(hits) ? hits : 0));
    } else if (line.startsWith("FNF:")) {
      // Bun-only: FNF summary without per-function FN records. We take
      // the MAX across contributing lcovs (a function is "found" if
      // any run saw it).
      const n = Number.parseInt(line.slice(4), 10);
      if (Number.isFinite(n)) {
        cur.bunFNF = Math.max(cur.bunFNF, n);
      }
    } else if (line.startsWith("FNH:")) {
      // Bun-only: FNH summary. Take the MAX across lcovs.
      const h = Number.parseInt(line.slice(4), 10);
      if (Number.isFinite(h)) {
        cur.bunFNH = Math.max(cur.bunFNH, h);
      }
    }
  }
  if (cur !== null) {
    records.push(cur);
  }
  return records;
}

/** Find all `coverage/lcov.info` files under the repo's apps/ and packages/ subtrees. */
function findLcovFiles(root) {
  /** @type {string[]} */
  const out = [];
  for (const top of ["apps", "packages"]) {
    const topPath = join(root, top);
    if (!existsSync(topPath)) continue;
    for (const entry of readdirSync(topPath)) {
      const pkgDir = join(topPath, entry);
      let st;
      try {
        st = statSync(pkgDir);
      } catch {
        continue;
      }
      if (!st.isDirectory()) continue;
      const lcov = join(pkgDir, "coverage", "lcov.info");
      if (existsSync(lcov)) {
        out.push(lcov);
      }
    }
  }
  return out.sort();
}

/**
 * Resolve a lcov SF: path to absolute.
 *
 * Bun emits paths like `src/bot/bot.ts` (relative to the test cwd, which is
 * the package directory). The cwd can also be one level up if the test was
 * run with a different path. We try:
 *   1. As-is relative to the package dir
 *   2. As-is relative to the repo root
 *   3. As-is relative to monorepo root (parent of the package)
 * Whichever resolves to an existing file wins.
 */
function resolveSfPath(sfRaw, pkgDir, repoRoot) {
  if (sfRaw.startsWith("/")) {
    return sfRaw;
  }
  const candidates = [
    resolve(pkgDir, sfRaw),
    resolve(repoRoot, sfRaw),
    resolve(dirname(pkgDir), sfRaw),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  // Fall back to the most likely (pkgDir-relative). The merge report
  // still groups by this synthetic key, so the HTML report can detect
  // missing files and mark them appropriately.
  return candidates[0];
}

/**
 * Merge per-package lcov records by absolute SF path.
 *
 * @param {Array<{file: string, records: LcovRecord[]}>} perPkg
 * @param {string} repoRoot
 * @returns {Map<string, MergedFile>}
 */
function mergeByAbsolutePath(perPkg, repoRoot) {
  /** @typedef {{absPath: string, relPath: string, da: Map<number, number>, fnda: Map<string, {name: string, line: number, hits: number}>, brda: Map<string, number>, fnLines: Map<string, number>, totalDa: number, bunFNF: number, bunFNH: number}} MergedFile */
  /** @type {Map<string, MergedFile>} */
  const merged = new Map();

  for (const { file, records } of perPkg) {
    // The test runner cwd is the package directory (the parent of `coverage/`).
    const pkgDir = dirname(dirname(file));
    for (const rec of records) {
      const abs = resolveSfPath(rec.sf, pkgDir, repoRoot);
      let m = merged.get(abs);
      if (m === undefined) {
        m = {
          absPath: abs,
          relPath: relative(repoRoot, abs),
          da: new Map(),
          fnda: new Map(),
          brda: new Map(),
          fnLines: new Map(),
          totalDa: 0,
          bunFNF: 0,
          bunFNH: 0,
        };
        merged.set(abs, m);
      }
      for (const [ln, hits] of rec.da) {
        // For line coverage, we care about whether the line was hit, not
        // how many times. Use MAX across contributing lcovs.
        m.da.set(ln, Math.max(m.da.get(ln) ?? 0, hits));
      }
      for (const [key, fn] of rec.fnda) {
        const prev = m.fnda.get(key);
        if (prev === undefined) {
          m.fnda.set(key, { ...fn });
          if (fn.line >= 0) {
            m.fnLines.set(fn.name, fn.line);
          }
        } else {
          // MAX hits per function across runs.
          prev.hits = Math.max(prev.hits, fn.hits);
          if (fn.line >= 0 && prev.line < 0) {
            prev.line = fn.line;
            m.fnLines.set(fn.name, fn.line);
          }
        }
      }
      for (const [key, hits] of rec.brda) {
        // MAX hits per branch decision across runs.
        m.brda.set(key, Math.max(m.brda.get(key) ?? 0, hits));
      }
      // Bun-only: FNF/FNH are aggregate counts, not per-function. Take the
      // MAX across contributing lcovs (a function is "found" if any run
      // saw it; same for "hit").
      m.bunFNF = Math.max(m.bunFNF, rec.bunFNF);
      m.bunFNH = Math.max(m.bunFNH, rec.bunFNH);
    }
  }

  // Compute total DA line count per file (LF).
  for (const m of merged.values()) {
    m.totalDa = m.da.size;
  }
  return merged;
}

// ---------------------------------------------------------------------------
// Emission: lcov, summary JSON, text
// ---------------------------------------------------------------------------

/** Serialize merged map → lcov.info text. */
function emitLcov(merged) {
  /** @type {string[]} */
  const lines = [];
  for (const m of merged.values()) {
    lines.push("TN:");
    lines.push(`SF:${m.relPath}`);
    // FN: lines (one per function)
    const sortedFns = [...m.fnda.values()].sort((a, b) => {
      if (a.line !== b.line) return a.line - b.line;
      return a.name.localeCompare(b.name);
    });
    for (const fn of sortedFns) {
      if (fn.line >= 0) {
        lines.push(`FN:${fn.line},${fn.name}`);
      }
    }
    // FNF: prefer the bun summary (if > 0) over the per-fnda count. Bun's
    // lcov doesn't emit per-function FN records, so fnda is empty and
    // m.fnda.size would be 0. The bun summary carries the right count.
    const fnf = m.bunFNF > 0 ? m.bunFNF : m.fnda.size;
    const hitFnsLocal = [...m.fnda.values()].filter((f) => f.hits > 0).length;
    // FNH: prefer bun summary; fall back to per-fnda hit count.
    const fnh = m.bunFNH > 0 ? m.bunFNH : hitFnsLocal;
    lines.push(`FNF:${fnf}`);
    lines.push(`FNH:${fnh}`);
    // FNDA: hits
    for (const fn of sortedFns) {
      lines.push(`FNDA:${fn.hits},${fn.name}`);
    }
    // DA: lines
    const sortedLines = [...m.da.entries()].sort((a, b) => a[0] - b[0]);
    for (const [ln, hits] of sortedLines) {
      lines.push(`DA:${ln},${hits}`);
    }
    const totalLines = m.da.size;
    const hitLines = [...m.da.values()].filter((h) => h > 0).length;
    lines.push(`LF:${totalLines}`);
    lines.push(`LH:${hitLines}`);
    // BRDA
    const sortedBr = [...m.brda.entries()].sort((a, b) => {
      const [la] = a[0].split(":");
      const [lb] = b[0].split(":");
      return Number(la) - Number(lb);
    });
    for (const [key, hits] of sortedBr) {
      lines.push(`BRDA:${key.replace(/:/g, ",")},${hits}`);
    }
    const totalBr = m.brda.size;
    const hitBr = [...m.brda.values()].filter((h) => h > 0).length;
    lines.push(`BRF:${totalBr}`);
    lines.push(`BRH:${hitBr}`);
    lines.push("end_of_record");
    lines.push("");
  }
  return lines.join("\n");
}

/** Compute summary JSON (istanbul-style). */
function emitSummary(merged) {
  const perFile = {};
  let totLines = 0,
    hitLines = 0,
    totBr = 0,
    hitBr = 0,
    totFn = 0,
    hitFn = 0;

  for (const m of merged.values()) {
    const lh = [...m.da.values()].filter((h) => h > 0).length;
    const lf = m.da.size;
    const brh = [...m.brda.values()].filter((h) => h > 0).length;
    const brf = m.brda.size;
    // Bun's lcov doesn't include per-function FN records, so fnda is empty
    // and m.fnda.size would be 0. Use the bun summary (bunFNF) when present.
    const fnhLocal = [...m.fnda.values()].filter((f) => f.hits > 0).length;
    const fnh = m.bunFNH > 0 ? m.bunFNH : fnhLocal;
    const fnf = m.bunFNF > 0 ? m.bunFNF : m.fnda.size;
    totLines += lf;
    hitLines += lh;
    totBr += brf;
    hitBr += brh;
    totFn += fnf;
    hitFn += fnh;
    perFile[m.relPath] = {
      lines: { total: lf, covered: lh, pct: pct(lh, lf), skipped: 0 },
      statements: { total: lf, covered: lh, pct: pct(lh, lf), skipped: 0 },
      functions: { total: fnf, covered: fnh, pct: pct(fnh, fnf), skipped: 0 },
      branches: { total: brf, covered: brh, pct: pct(brh, brf), skipped: 0 },
    };
  }

  return {
    total: {
      lines: { total: totLines, covered: hitLines, pct: pct(hitLines, totLines), skipped: 0 },
      statements: { total: totLines, covered: hitLines, pct: pct(hitLines, totLines), skipped: 0 },
      functions: { total: totFn, covered: hitFn, pct: pct(hitFn, totFn), skipped: 0 },
      branches: { total: totBr, covered: hitBr, pct: pct(hitBr, totBr), skipped: 0 },
    },
    fileCount: merged.size,
    files: perFile,
  };
}

function pct(num, den) {
  if (den === 0) return 100;
  return Math.round((num / den) * 10000) / 100;
}

// ---------------------------------------------------------------------------
// HTML report
// ---------------------------------------------------------------------------

/** Read a source file as an array of lines (1-indexed for rendering). */
function readSourceLines(absPath) {
  if (!existsSync(absPath)) return null;
  const text = readFileSync(absPath, "utf8");
  // Split on \n; we don't need to handle \r\n specifically since line
  // numbers in lcov are 1-indexed and refer to logical lines.
  const lines = text.split("\n");
  return lines;
}

function escapeHtml(s) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function emitHtml(merged, summary, repoRoot) {
  // We render the merged map sorted by file path, with the summary at top.
  const files = [...merged.values()].sort((a, b) => a.relPath.localeCompare(b.relPath));

  /** @type {string[]} */
  const rows = [];
  for (const m of files) {
    const lh = [...m.da.values()].filter((h) => h > 0).length;
    const lf = m.da.size;
    const brh = [...m.brda.values()].filter((h) => h > 0).length;
    const brf = m.brda.size;
    const fnh = [...m.fnda.values()].filter((f) => f.hits > 0).length;
    const fnf = m.fnda.size;
    const uncoveredLines = [...m.da.entries()]
      .filter(([, h]) => h === 0)
      .map(([ln]) => ln)
      .sort((a, b) => a - b);
    const uncoveredStr =
      uncoveredLines.length === 0
        ? "<em>none</em>"
        : uncoveredLines
            .slice(0, 30)
            .map(String)
            .join(", ") + (uncoveredLines.length > 30 ? ` … (+${uncoveredLines.length - 30})` : "");
    const fileId = `file-${files.indexOf(m)}`;
    rows.push(`
      <tr>
        <td><a href="#${fileId}">${escapeHtml(m.relPath)}</a></td>
        <td class="num">${pct(lh, lf).toFixed(2)}%</td>
        <td class="num">${pct(brh, brf).toFixed(2)}%</td>
        <td class="num">${pct(fnh, fnf).toFixed(2)}%</td>
        <td>${uncoveredStr}</td>
      </tr>`);
  }

  /** @type {string[]} */
  const fileDetails = [];
  for (const [idx, m] of files.entries()) {
    const fileId = `file-${idx}`;
    const sourceLines = readSourceLines(m.absPath);
    /** @type {string[]} */
    const lineRows = [];
    if (sourceLines === null) {
      lineRows.push(
        `<tr><td colspan="3" style="text-align:center; color:#888">Source file not available on disk</td></tr>`,
      );
    } else {
      for (let i = 1; i <= sourceLines.length; i++) {
        const hits = m.da.get(i);
        let cls = "miss";
        let hitsStr = "0";
        if (hits !== undefined && hits > 0) {
          cls = "hit";
          hitsStr = String(hits);
        } else if (hits === undefined) {
          // Line not in lcov → either non-executable (comment, blank) or
          // outside the test reach. We mark as neutral.
          cls = "neutral";
          hitsStr = "—";
        }
        const code = escapeHtml(sourceLines[i - 1] ?? "");
        lineRows.push(
          `<tr class="${cls}"><td class="ln">${i}</td><td class="hits">${hitsStr}</td><td class="code"><pre>${code || "&nbsp;"}</pre></td></tr>`,
        );
      }
    }
    fileDetails.push(`
      <section id="${fileId}" class="file-detail">
        <h2>${escapeHtml(m.relPath)}</h2>
        <p>
          <a href="#top">↑ back to summary</a>
          · lines: ${pct([...m.da.values()].filter((h) => h > 0).length, m.da.size).toFixed(2)}%
          · branches: ${pct([...m.brda.values()].filter((h) => h > 0).length, m.brda.size).toFixed(2)}%
          · funcs: ${pct([...m.fnda.values()].filter((f) => f.hits > 0).length, m.fnda.size).toFixed(2)}%
        </p>
        <table class="source"><tbody>${lineRows.join("")}</tbody></table>
      </section>`);
  }

  const t = summary.total;
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>mm-crypto-bot — merged coverage</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 2em; color: #1a1a1a; }
    h1 { margin-bottom: 0.2em; }
    .meta { color: #666; margin-bottom: 1.5em; }
    table { border-collapse: collapse; width: 100%; }
    th, td { padding: 4px 8px; text-align: left; border-bottom: 1px solid #eee; }
    th { background: #f5f5f5; }
    td.num { text-align: right; font-variant-numeric: tabular-nums; }
    .summary-cards { display: flex; gap: 1em; margin: 1em 0 2em; }
    .card { flex: 1; padding: 1em; border: 1px solid #ddd; border-radius: 6px; }
    .card .pct { font-size: 2em; font-weight: bold; }
    .card .label { color: #666; text-transform: uppercase; font-size: 0.8em; }
    .file-detail { margin: 3em 0; }
    .file-detail h2 { border-bottom: 2px solid #ccc; padding-bottom: 0.2em; }
    table.source { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 0.9em; }
    table.source td { padding: 1px 4px; vertical-align: top; }
    table.source td.ln { color: #999; text-align: right; width: 4em; }
    table.source td.hits { text-align: right; width: 3em; color: #666; }
    tr.hit { background: #e8f5e9; }
    tr.hit td.hits { color: #2e7d32; }
    tr.miss { background: #ffebee; }
    tr.miss td.hits { color: #c62828; font-weight: bold; }
    tr.neutral td { color: #aaa; }
    pre { margin: 0; white-space: pre-wrap; }
    a { color: #1565c0; text-decoration: none; }
    a:hover { text-decoration: underline; }
  </style>
</head>
<body id="top">
  <h1>mm-crypto-bot — merged coverage report</h1>
  <p class="meta">Generated by <code>scripts/merge-coverage.mjs</code> · ${new Date().toISOString()}</p>
  <div class="summary-cards">
    <div class="card"><div class="pct">${t.lines.pct.toFixed(2)}%</div><div class="label">Lines (${t.lines.covered} / ${t.lines.total})</div></div>
    <div class="card"><div class="pct">${t.branches.pct.toFixed(2)}%</div><div class="label">Branches (${t.branches.covered} / ${t.branches.total})</div></div>
    <div class="card"><div class="pct">${t.functions.pct.toFixed(2)}%</div><div class="label">Functions (${t.functions.covered} / ${t.functions.total})</div></div>
    <div class="card"><div class="pct">${summary.fileCount}</div><div class="label">Files measured</div></div>
  </div>
  <h2>Files</h2>
  <table>
    <thead>
      <tr><th>File</th><th class="num">Lines %</th><th class="num">Branches %</th><th class="num">Funcs %</th><th>Uncovered lines</th></tr>
    </thead>
    <tbody>${rows.join("")}</tbody>
  </table>
  ${fileDetails.join("")}
</body>
</html>
`;
  return html;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const lcovFiles = findLcovFiles(REPO_ROOT);
  if (lcovFiles.length === 0) {
    console.error("ERROR: no lcov.info files found.");
    console.error("  Looked under: apps/*/coverage/lcov.info and packages/*/coverage/lcov.info");
    console.error("  Run `bun run coverage` (turbo) first to generate per-package lcov files.");
    process.exit(1);
  }
  console.error(`[merge-coverage] Found ${lcovFiles.length} lcov file(s):`);
  for (const f of lcovFiles) {
    console.error(`  - ${relative(REPO_ROOT, f)}`);
  }

  /** @type {Array<{file: string, records: LcovRecord[]}>} */
  const perPkg = [];
  for (const file of lcovFiles) {
    const text = readFileSync(file, "utf8");
    const records = parseLcov(text);
    perPkg.push({ file, records });
    console.error(
      `  ${basename(dirname(dirname(file)))}: ${records.length} record(s)`,
    );
  }

  const merged = mergeByAbsolutePath(perPkg, REPO_ROOT);
  console.error(`[merge-coverage] Merged into ${merged.size} unique file(s).`);

  mkdirSync(OUT_DIR, { recursive: true });
  mkdirSync(HTML_DIR, { recursive: true });

  const lcovText = emitLcov(merged);
  writeFileSync(LCOV_OUT, lcovText, "utf8");
  console.error(`[merge-coverage] Wrote ${relative(REPO_ROOT, LCOV_OUT)}`);

  const summary = emitSummary(merged);
  writeFileSync(JSON_OUT, JSON.stringify(summary, null, 2), "utf8");
  console.error(`[merge-coverage] Wrote ${relative(REPO_ROOT, JSON_OUT)}`);

  const html = emitHtml(merged, summary, REPO_ROOT);
  writeFileSync(HTML_OUT, html, "utf8");
  console.error(`[merge-coverage] Wrote ${relative(REPO_ROOT, HTML_OUT)}`);

  // Print text summary to stdout.
  const t = summary.total;
  const bar = (n) => {
    const filled = Math.round(n / 5);
    return "█".repeat(filled) + "░".repeat(20 - filled);
  };
  console.log("");
  console.log("======================================================================");
  console.log("  MERGED COVERAGE REPORT — mm-crypto-bot");
  console.log("======================================================================");
  console.log(
    `  Lines      ${bar(t.lines.pct).padEnd(20)}  ${t.lines.pct.toFixed(2)}%  (${t.lines.covered} / ${t.lines.total})`,
  );
  console.log(
    `  Branches   ${bar(t.branches.pct).padEnd(20)}  ${t.branches.pct.toFixed(2)}%  (${t.branches.covered} / ${t.branches.total})`,
  );
  console.log(
    `  Functions  ${bar(t.functions.pct).padEnd(20)}  ${t.functions.pct.toFixed(2)}%  (${t.functions.covered} / ${t.functions.total})`,
  );
  console.log(`  Files measured: ${summary.fileCount}`);
  console.log("");
  console.log(`  LCOV:    coverage/merged/lcov.info`);
  console.log(`  JSON:    coverage/merged/coverage-summary.json`);
  console.log(`  HTML:    coverage/merged/html/index.html`);
  console.log("======================================================================");
}

main();
