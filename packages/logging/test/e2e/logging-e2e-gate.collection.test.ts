import type { FileCoverageData } from "istanbul-lib-coverage";
import { describe, expect, it, vi } from "vitest";

import { createLoggingE2eArtifactRun as createArtifactRun } from "./logging-e2e-artifact-run.ts";
import {
  collectLoggingEndToEndCoverage,
  printLoggingEndToEndSummary,
  type LoggingEndToEndCoverageSummary,
} from "./logging-e2e-gate.ts";
import { parseLoggingEndToEndScopeManifest, type LoggingEndToEndScopeManifest } from "./logging-e2e-scope.ts";

const runtimeFiles = [
  "packages/logging/src/contracts.ts",
  "packages/logging/src/index.ts",
  "packages/logging/src/serialization.ts",
  "packages/logging/src/sinks.ts",
  "packages/logging/src/structured-logger.ts",
] as const;
const caseIds = ["collection-alpha", "collection-beta"] as const;

function manifest(): LoggingEndToEndScopeManifest {
  return parseLoggingEndToEndScopeManifest(
    { schemaVersion: 1, runtimeFiles: [...runtimeFiles], e2eCases: [...caseIds] },
    { areFilesRequired: false },
  );
}

function range(): Readonly<{
  readonly start: Readonly<{ readonly line: 1; readonly column: 0 }>;
  readonly end: Readonly<{ readonly line: 1; readonly column: 1 }>;
}> {
  return { start: { line: 1, column: 0 }, end: { line: 1, column: 1 } };
}

function coverage(
  path: string,
  counts: readonly [number, number, readonly [number, number]] = [1, 1, [1, 1]],
): FileCoverageData {
  return {
    path,
    statementMap: { "0": range() },
    fnMap: { "0": { name: "covered", decl: range(), loc: range(), line: 1 } },
    branchMap: { "0": { loc: range(), type: "if", locations: [range(), range()], line: 1 } },
    s: { "0": counts[0] },
    f: { "0": counts[1] },
    b: { "0": [...counts[2]] },
  };
}

function bytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value));
}

function writeCase(
  run: ReturnType<typeof createArtifactRun>,
  caseId: string,
  pid: number,
  files: readonly string[] = runtimeFiles,
  counts: readonly [number, number, readonly [number, number]] = [1, 1, [1, 1]],
): void {
  const payload = Object.fromEntries(files.map((file) => [file, coverage(file, counts)]));
  run.writeExclusiveFile(
    "raw",
    `${caseId}-${String(pid)}.json`,
    bytes({ schemaVersion: 1, pid, caseId, coverage: payload }),
  );
}

function withRun(
  test: (run: ReturnType<typeof createArtifactRun>, scope: LoggingEndToEndScopeManifest) => void,
): void {
  const run = createArtifactRun();
  try {
    test(run, manifest());
  } finally {
    run.cleanup();
  }
}

function collectFullCoverage(): LoggingEndToEndCoverageSummary {
  const run = createArtifactRun();
  const scope = manifest();
  try {
    writeCase(run, caseIds[0], 101);
    writeCase(run, caseIds[1], 202);
    return collectLoggingEndToEndCoverage({ artifactRun: run, manifest: scope });
  } finally {
    run.cleanup();
  }
}

describe("logging E2E gate coverage collection", () => {
  it("collects complete declared case coverage in frozen manifest order", () => {
    const summary = collectFullCoverage();

    expect(summary).toMatchObject({
      schemaVersion: 1,
      label: "logging-subprocess-e2e",
      rawFileCount: 2,
      caseIds: [...caseIds],
      scope: [...runtimeFiles],
      passed: true,
      failures: [],
      total: {
        statements: { total: 5, covered: 5, skipped: 0, pct: 100 },
        branches: { total: 10, covered: 10, skipped: 0, pct: 100 },
        functions: { total: 5, covered: 5, skipped: 0, pct: 100 },
        lines: { total: 5, covered: 5, skipped: 0, pct: 100 },
      },
    });
    expect(summary.files).toEqual(
      Object.fromEntries(
        runtimeFiles.map((file) => [
          file,
          {
            statements: { total: 1, covered: 1, skipped: 0, pct: 100 },
            branches: { total: 2, covered: 2, skipped: 0, pct: 100 },
            functions: { total: 1, covered: 1, skipped: 0, pct: 100 },
            lines: { total: 1, covered: 1, skipped: 0, pct: 100 },
          },
        ]),
      ),
    );
  });

  it("rejects duplicate case evidence even when PIDs differ", () => {
    withRun((run, scope) => {
      writeCase(run, caseIds[0], 101);
      writeCase(run, caseIds[0], 202);
      expect(() => collectLoggingEndToEndCoverage({ artifactRun: run, manifest: scope })).toThrow(
        "Duplicate raw logging E2E coverage case evidence: collection-alpha.",
      );
    });
  });

  it("rejects a missing declared case", () => {
    withRun((run, scope) => {
      writeCase(run, caseIds[0], 101);
      expect(() => collectLoggingEndToEndCoverage({ artifactRun: run, manifest: scope })).toThrow(
        "Required logging E2E cases did not produce coverage: collection-beta.",
      );
    });
  });

  it("rejects missing scoped source coverage before missing case evidence", () => {
    withRun((run, scope) => {
      writeCase(run, caseIds[0], 101, [runtimeFiles[0]]);
      expect(() => collectLoggingEndToEndCoverage({ artifactRun: run, manifest: scope })).toThrow(
        "Merged logging E2E coverage is missing scoped runtime sources:",
      );
    });
  });

  it("reports statement, function, and line deficits in metric order", () => {
    withRun((run, scope) => {
      writeCase(run, caseIds[0], 101, runtimeFiles, [0, 0, [1, 1]]);
      writeCase(run, caseIds[1], 202, runtimeFiles, [0, 0, [1, 1]]);
      const summary = collectLoggingEndToEndCoverage({ artifactRun: run, manifest: scope });
      expect(summary.passed).toBe(false);
      expect(summary.failures).toEqual(["statements", "functions", "lines"]);
    });
  });

  it("reports a branch-only deficit", () => {
    withRun((run, scope) => {
      writeCase(run, caseIds[0], 101, runtimeFiles, [1, 1, [1, 0]]);
      writeCase(run, caseIds[1], 202, runtimeFiles, [1, 1, [1, 0]]);
      const summary = collectLoggingEndToEndCoverage({ artifactRun: run, manifest: scope });
      expect(summary.passed).toBe(false);
      expect(summary.failures).toEqual(["branches"]);
    });
  });

  it("prints stable pass and failure summaries", () => {
    const log = vi.spyOn(console, "log").mockImplementation((line: unknown) => {
      if (typeof line !== "string") throw new Error("Expected a textual E2E coverage summary line.");
    });
    try {
      printLoggingEndToEndSummary(collectFullCoverage());
      expect(log).toHaveBeenNthCalledWith(1, "Logging subprocess E2E coverage:");
      expect(log).toHaveBeenNthCalledWith(2, "  statements 5/5 (100%)");
      expect(log).toHaveBeenNthCalledWith(3, "  branches   10/10 (100%)");
      expect(log).toHaveBeenNthCalledWith(4, "  functions  5/5 (100%)");
      expect(log).toHaveBeenNthCalledWith(5, "  lines      5/5 (100%)");
      expect(log).toHaveBeenNthCalledWith(6, "  cases      2/2");
      expect(log).toHaveBeenNthCalledWith(7, "  gate       PASS");
      log.mockClear();
      printLoggingEndToEndSummary({ ...collectFullCoverage(), passed: false, failures: ["branches"] });
      expect(log.mock.calls.at(-1)).toEqual(["  gate       FAIL (branches)"]);
    } finally {
      log.mockRestore();
    }
  });
});
