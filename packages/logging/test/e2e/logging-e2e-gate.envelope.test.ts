import { describe, expect, it } from "vitest";

import { createGateTestRun, jsonBytes, validEnvelope } from "./logging-e2e-gate.test-support.ts";

function withRun(test: (run: ReturnType<typeof createGateTestRun>) => void): void {
  const run = createGateTestRun();
  try {
    test(run);
  } finally {
    run.cleanup();
  }
}

function validFilename(run: ReturnType<typeof createGateTestRun>): string {
  return `${run.caseId}-${String(run.pid)}.json`;
}

function expectGateRejects(filename: string, contents: Uint8Array, expectedMessage: string): void {
  withRun((run) => {
    run.write(filename, contents);
    expect(() => run.collect()).toThrow(expectedMessage);
  });
}

describe("logging E2E gate coverage envelope boundary", () => {
  it("rejects non-JSON, delimiterless, zero-PID, non-decimal, and unsafe raw filenames", () => {
    withRun((run) => {
      const contents = jsonBytes(validEnvelope(run));
      for (const filename of [
        "coverage.txt",
        "coverage.json",
        `${run.caseId}-0.json`,
        `${run.caseId}-x.json`,
        `${run.caseId}-9007199254740992.json`,
      ]) {
        expectGateRejects(filename, contents, `Unexpected raw logging E2E coverage filename: ${filename}.`);
      }
      expect(() => {
        run.write("unsafe name-1.json", contents);
      }).toThrow("Artifact file name is invalid: unsafe name-1.json.");
    });
  });

  it("rejects empty, oversized, and malformed raw JSON", () => {
    withRun((run) => {
      run.write(validFilename(run), new Uint8Array());
      expect(() => run.collect()).toThrow(
        `Raw logging E2E coverage file has an invalid size: ${validFilename(run)}.`,
      );
    });
    withRun((run) => {
      run.write(validFilename(run), new Uint8Array(32 * 1024 * 1024 + 1));
      expect(() => run.collect()).toThrow(
        `Raw logging E2E coverage file has an invalid size: ${validFilename(run)}.`,
      );
    });
    expectGateRejects(
      "case-123.json",
      new Uint8Array([123]),
      "Malformed raw logging E2E coverage JSON case-123.json.",
    );
  });

  it("rejects non-object and non-exact coverage envelopes", () => {
    withRun((run) => {
      expectGateRejects(validFilename(run), jsonBytes([]), "must be a JSON object.");
      expectGateRejects(
        validFilename(run),
        jsonBytes({ ...validEnvelope(run), extra: true }),
        "must contain exactly:",
      );
      const { coverage, ...withoutCoverage } = validEnvelope(run);
      expectGateRejects(validFilename(run), jsonBytes(withoutCoverage), "must contain exactly:");
      void coverage;
    });
  });

  it("rejects an invalid schema version and invalid PID fields", () => {
    withRun((run) => {
      expectGateRejects(
        validFilename(run),
        jsonBytes({ ...validEnvelope(run), schemaVersion: 2 }),
        "schemaVersion is invalid",
      );
      for (const pid of ["123", 124, 0, Number.MAX_SAFE_INTEGER + 1]) {
        expectGateRejects(
          validFilename(run),
          jsonBytes({ ...validEnvelope(run), pid }),
          "PID does not match its filename",
        );
      }
    });
  });

  it("rejects case-ID type, filename mismatch, and undeclared identifiers", () => {
    withRun((run) => {
      const otherCaseId = run.manifest.e2eCases.find((caseId) => caseId !== run.caseId);
      if (otherCaseId === undefined) throw new Error("Expected a second declared logging E2E case.");
      expectGateRejects(
        `${otherCaseId}-${String(run.pid)}.json`,
        jsonBytes(validEnvelope(run)),
        "case ID is invalid",
      );
      for (const caseId of [123, `${run.caseId}-other`]) {
        expectGateRejects(
          validFilename(run),
          jsonBytes({ ...validEnvelope(run), caseId }),
          "case ID is invalid",
        );
      }
    });
  });

  it("rejects non-object and empty coverage payloads", () => {
    withRun((run) => {
      expectGateRejects(
        validFilename(run),
        jsonBytes({ ...validEnvelope(run), coverage: [] }),
        "must be a JSON object.",
      );
      expectGateRejects(
        validFilename(run),
        jsonBytes({ ...validEnvelope(run), coverage: {} }),
        "payload is empty",
      );
    });
  });

  it("accepts a valid envelope through parsing before the complete-gate check", () => {
    withRun((run) => {
      run.write(validFilename(run), jsonBytes(validEnvelope(run)));
      expect(() => run.collect()).toThrow("Merged logging E2E coverage is missing scoped runtime sources:");
    });
  });
});
