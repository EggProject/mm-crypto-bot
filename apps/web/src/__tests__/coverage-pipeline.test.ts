/* eslint-disable security/detect-non-literal-fs-filename -- isolated test temp directories */
import { afterEach, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  assertCoverageInputs,
  buildReport,
  checkThresholds,
  type CoveragePaths,
} from "../../e2e/_helpers/coverage-teardown.js";

const temporaryRoots: string[] = [];

function temporaryRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "web-coverage-pipeline-"));
  temporaryRoots.push(root);
  return root;
}

function temporaryAppRoot(): { readonly appDir: string; readonly root: string } {
  const appDir = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const root = mkdtempSync(join(appDir, ".coverage-pipeline-test-"));
  temporaryRoots.push(root);
  return { appDir, root };
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("coverage pipeline freshness gates", () => {
  it("fails when both CT and E2E accumulator stores are empty", () => {
    expect(() => assertCoverageInputs({}, {})).toThrow("No fresh CT or E2E coverage");
  });

  it("removes stale merged output before a producer failure", () => {
    const appDir = temporaryRoot();
    const staleOutput = join(appDir, "coverage", "playwright", "coverage-final.json");
    mkdirSync(dirname(staleOutput), { recursive: true });
    writeFileSync(staleOutput, '{"stale":true}');

    const testFile = fileURLToPath(import.meta.url);
    const script = resolve(dirname(testFile), "../../scripts/run-e2e-all.sh");
    const result = spawnSync("bash", [script], {
      env: {
        ...process.env,
        MM_E2E_APP_DIR: appDir,
        MM_E2E_BUN_BIN: "/bin/false",
      },
      encoding: "utf8",
    });

    expect(result.status).not.toBe(0);
    expect(existsSync(staleOutput)).toBe(false);
  });

  it("accepts fresh valid accumulators and passes the real 75/75/75 gate", () => {
    const { appDir, root } = temporaryAppRoot();
    const coverageDir = join(root, "coverage", "playwright");
    const accumulatorDir = join(coverageDir, "accumulators");
    const ctNycOutput = join(root, ".nyc_output");
    mkdirSync(accumulatorDir, { recursive: true });
    mkdirSync(ctNycOutput, { recursive: true });

    const sourcePath = join(root, "fresh-source.ts");
    writeFileSync(sourcePath, "export const covered = true;\n");
    const location = {
      start: { line: 1, column: 0 },
      end: { line: 1, column: 28 },
    };
    writeFileSync(
      join(accumulatorDir, "fresh.json"),
      JSON.stringify({
        [sourcePath]: {
          path: sourcePath,
          statementMap: { 0: location },
          fnMap: { 0: { name: "covered", decl: location, loc: location, line: 1 } },
          branchMap: {
            0: { line: 1, type: "if", loc: location, locations: [location, location] },
          },
          s: { 0: 1 },
          f: { 0: 1 },
          b: { 0: [1, 1] },
        },
      }),
    );

    const paths: CoveragePaths = {
      appDir,
      coverageDir,
      accumulatorDir,
      ctNycOutput,
    };
    const report = buildReport(paths);
    expect(report).toEqual({ lines: 100, branches: 100, functions: 100 });
    expect(() => checkThresholds(report, paths)).not.toThrow();
  });
});
