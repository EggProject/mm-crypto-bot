import { spawnSync } from "node:child_process";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { LOGGING_E2E_CASE_IDS } from "./logging-e2e-case-contract.ts";
import { createLoggingEndToEndFixture, type LoggingEndToEndFixture } from "./logging-e2e-fixture.ts";

const fixtures: LoggingEndToEndFixture[] = [];
const preloadPath = path.resolve(import.meta.dirname, "logging-e2e-preload.ts");

afterEach(() => {
  const allocatedFixtures = [...fixtures];
  fixtures.length = 0;
  for (const fixture of allocatedFixtures) fixture.cleanup();
});

function runWithCaseId(caseId: string | undefined): { readonly exitCode: number; readonly stderr: string } {
  const fixture = createLoggingEndToEndFixture();
  fixtures.push(fixture);
  const coverageEnvironment = {
    ...process.env,
    MM_LOGGING_E2E_COVERAGE_RAW_DIR: fixture.paths.raw,
  };
  const environment =
    caseId === undefined ? coverageEnvironment : { ...coverageEnvironment, MM_LOGGING_E2E_CASE_ID: caseId };

  const result = spawnSync("bun", ["--preload", preloadPath, "-e", "void 0"], {
    cwd: path.resolve(import.meta.dirname, "../../../.."),
    env: environment,
    stdio: "pipe",
  });

  if (result.error !== undefined) {
    throw new Error("The logging E2E preload subprocess could not start.", { cause: result.error });
  }
  if (result.signal !== null) {
    throw new Error(`The logging E2E preload subprocess ended from signal ${result.signal}.`);
  }
  if (result.status === null) {
    throw new Error("The logging E2E preload subprocess ended without an exit status.");
  }

  return { exitCode: result.status, stderr: result.stderr.toString("utf8") };
}

describe("logging E2E preload case contract", () => {
  it("accepts every declared case in the exact contract order", () => {
    for (const caseId of LOGGING_E2E_CASE_IDS) {
      expect(runWithCaseId(caseId).exitCode).toBe(0);
    }
  });

  it("fails closed for undeclared and undefined case IDs", () => {
    for (const caseId of ["undeclared-case", undefined]) {
      const result = runWithCaseId(caseId);
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("MM_LOGGING_E2E_CASE_ID must be a declared logging E2E case ID.");
    }
  });
});
