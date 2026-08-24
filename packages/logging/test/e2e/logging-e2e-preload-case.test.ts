import { spawnSync } from "node:child_process";
import { lstatSync, mkdtempSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
// eslint-disable-next-line unicorn/import-style -- Bun's node:path declaration only exposes typed named imports under the E2E project's configured type roots.
import { join, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { LOGGING_E2E_CASE_IDS } from "./logging-e2e-case-contract.ts";

const temporaryDirectories: string[] = [];
const preloadPath = resolve(import.meta.dirname, "logging-e2e-preload.ts");

afterEach(() => {
  const directories = [...temporaryDirectories];
  temporaryDirectories.length = 0;
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- Test-owned directories are created by this test and removed after each case.
  for (const directory of directories) rmdirSync(directory);
});

function runWithCaseId(caseId: string | undefined): { readonly exitCode: number; readonly stderr: string } {
  const rawDirectory = mkdtempSync(join(tmpdir(), "logging-e2e-preload-case-"));
  temporaryDirectories.push(rawDirectory);
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- The test just created this private temporary directory.
  const identity = lstatSync(rawDirectory, { bigint: true });
  const coverageEnvironment = {
    ...process.env,
    MM_LOGGING_E2E_COVERAGE_RAW_DEVICE: identity.dev.toString(),
    MM_LOGGING_E2E_COVERAGE_RAW_DIR: rawDirectory,
    MM_LOGGING_E2E_COVERAGE_RAW_INODE: identity.ino.toString(),
  };
  const environment =
    caseId === undefined ? coverageEnvironment : { ...coverageEnvironment, MM_LOGGING_E2E_CASE_ID: caseId };

  const result = spawnSync("bun", ["--preload", preloadPath, "-e", "void 0"], {
    cwd: resolve(import.meta.dirname, "../../../.."),
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
