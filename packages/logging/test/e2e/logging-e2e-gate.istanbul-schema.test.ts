import { describe, expect, it } from "vitest";

import {
  createGateTestRun,
  jsonBytes,
  minimalFileCoverage,
  validEnvelope,
} from "./logging-e2e-gate.test-support.ts";

type GateRun = ReturnType<typeof createGateTestRun>;

function withRun(test: (run: GateRun) => void): void {
  const run = createGateTestRun();
  try {
    test(run);
  } finally {
    run.cleanup();
  }
}

function validFilename(run: GateRun): string {
  return `${run.caseId}-${String(run.pid)}.json`;
}

function coveragePath(run: GateRun): string {
  const coverage = validEnvelope(run)["coverage"];
  if (coverage === null || typeof coverage !== "object" || Array.isArray(coverage)) {
    throw new Error("Expected the valid envelope to contain an object coverage payload.");
  }
  const path = Object.keys(coverage).at(0);
  if (path === undefined) throw new Error("Expected the valid envelope to contain a coverage path.");
  return path;
}

function envelopeWithFileCoverage(run: GateRun, fileCoverage: unknown): Readonly<Record<string, unknown>> {
  const path = coveragePath(run);
  return Object.freeze({ ...validEnvelope(run), coverage: Object.freeze({ [path]: fileCoverage }) });
}

function validFileCoverage(run: GateRun): Readonly<Record<string, unknown>> {
  return Object.freeze({ ...minimalFileCoverage(coveragePath(run)) });
}

function rejectsFileCoverage(
  transform: (fileCoverage: Readonly<Record<string, unknown>>, run: GateRun) => unknown,
  expectedMessage: string,
): void {
  withRun((run) => {
    const fileCoverage = validFileCoverage(run);
    const transformedCoverage = transform(fileCoverage, run);
    const envelope = envelopeWithFileCoverage(run, transformedCoverage);
    const contents = jsonBytes(envelope);
    run.write(validFilename(run), contents);
    expect(() => run.collect()).toThrow(expectedMessage);
  });
}

function location(line: unknown, column: unknown): Readonly<Record<string, unknown>> {
  return Object.freeze({ line, column });
}

function range(start: unknown, end: unknown): Readonly<Record<string, unknown>> {
  return Object.freeze({ start, end });
}

function validRange(): Readonly<Record<string, unknown>> {
  return range(location(1, 0), location(1, 1));
}

function functionMapping(
  overrides: Readonly<Record<string, unknown>> = {},
): Readonly<Record<string, unknown>> {
  return Object.freeze({ name: "fn", decl: validRange(), loc: validRange(), line: 1, ...overrides });
}

function branchMapping(overrides: Readonly<Record<string, unknown>> = {}): Readonly<Record<string, unknown>> {
  return Object.freeze({ loc: validRange(), type: "if", locations: [], line: 1, ...overrides });
}

describe("logging E2E gate Istanbul schema boundary", () => {
  it("rejects invalid statement locations, ranges, and maps", () => {
    const invalidLocations: readonly [unknown, string][] = [
      ["not-an-object", "statementMap.0.start must be a JSON object."],
      [Object.freeze({ line: 1 }), "statementMap.0.start must contain exactly: line, column."],
      [location(-1, 0), "statementMap.0.start.line must be a non-negative safe integer."],
      [
        location(Number.MAX_SAFE_INTEGER + 1, 0),
        "statementMap.0.start.line must be a non-negative safe integer.",
      ],
      [location("1", 0), "statementMap.0.start.line must be a non-negative safe integer."],
      [location(1, -1), "statementMap.0.start.column must be a non-negative safe integer."],
      [
        location(1, Number.MAX_SAFE_INTEGER + 1),
        "statementMap.0.start.column must be a non-negative safe integer.",
      ],
      [location(1, "0"), "statementMap.0.start.column must be a non-negative safe integer."],
      [location(0, 0), "statementMap.0.start.line must be positive."],
    ];
    for (const [invalidLocation, expectedMessage] of invalidLocations) {
      rejectsFileCoverage(
        (fileCoverage) => ({
          ...fileCoverage,
          statementMap: Object.freeze({ "0": range(invalidLocation, location(1, 1)) }),
        }),
        expectedMessage,
      );
    }

    const invalidRanges: readonly [unknown, string][] = [
      ["not-an-object", "statementMap.0 must be a JSON object."],
      [Object.freeze({ start: location(1, 0) }), "statementMap.0 must contain exactly: start, end."],
    ];
    for (const [invalidRange, expectedMessage] of invalidRanges) {
      rejectsFileCoverage(
        (fileCoverage) => ({ ...fileCoverage, statementMap: Object.freeze({ "0": invalidRange }) }),
        expectedMessage,
      );
    }
    rejectsFileCoverage(
      (fileCoverage) => ({ ...fileCoverage, statementMap: [] }),
      "statementMap must be a JSON object.",
    );
  });

  it("rejects invalid function maps and function mappings", () => {
    rejectsFileCoverage((fileCoverage) => ({ ...fileCoverage, fnMap: [] }), "fnMap must be a JSON object.");
    const invalidFunctions: readonly [unknown, string][] = [
      [Object.freeze({}), "fnMap.0 must contain exactly: name, decl, loc, line."],
      [functionMapping({ name: 1 }), "fnMap.0.name must be a string."],
      [functionMapping({ line: 0 }), "fnMap.0.line must be positive."],
      [functionMapping({ decl: [] }), "fnMap.0.decl must be a JSON object."],
      [functionMapping({ loc: [] }), "fnMap.0.loc must be a JSON object."],
    ];
    for (const [invalidFunction, expectedMessage] of invalidFunctions) {
      rejectsFileCoverage(
        (fileCoverage) => ({ ...fileCoverage, fnMap: Object.freeze({ "0": invalidFunction }) }),
        expectedMessage,
      );
    }
  });

  it("rejects invalid branch maps, branch mappings, and counters", () => {
    rejectsFileCoverage(
      (fileCoverage) => ({ ...fileCoverage, branchMap: [] }),
      "branchMap must be a JSON object.",
    );
    const invalidBranches: readonly [unknown, string][] = [
      [Object.freeze({}), "branchMap.0 must contain exactly: loc, type, locations, line."],
      [branchMapping({ type: "" }), "branchMap.0.type must be a non-empty string."],
      [branchMapping({ type: 1 }), "branchMap.0.type must be a non-empty string."],
      [branchMapping({ locations: {} }), "branchMap.0.locations must be an array."],
      [branchMapping({ line: 0 }), "branchMap.0.line must be positive."],
      [branchMapping({ loc: [] }), "branchMap.0.loc must be a JSON object."],
      [branchMapping({ locations: [undefined] }), "branchMap.0.locations.0 must be a JSON object."],
      [
        branchMapping({ locations: [Object.freeze({ start: { unexpected: true }, end: {} })] }),
        "branchMap.0.locations.0.start must contain exactly: line, column.",
      ],
    ];
    for (const [invalidBranch, expectedMessage] of invalidBranches) {
      rejectsFileCoverage(
        (fileCoverage) => ({ ...fileCoverage, branchMap: Object.freeze({ "0": invalidBranch }) }),
        expectedMessage,
      );
    }
    const invalidStatementCounters: readonly [unknown, string][] = [
      [-1, "s.0 must be a non-negative safe integer."],
      [Number.MAX_SAFE_INTEGER + 1, "s.0 must be a non-negative safe integer."],
      ["1", "s.0 must be a non-negative safe integer."],
    ];
    for (const [counter, expectedMessage] of invalidStatementCounters) {
      rejectsFileCoverage(
        (fileCoverage) => ({ ...fileCoverage, s: Object.freeze({ "0": counter }) }),
        expectedMessage,
      );
    }
    rejectsFileCoverage((fileCoverage) => ({ ...fileCoverage, s: [] }), "s must be a JSON object.");
    rejectsFileCoverage((fileCoverage) => ({ ...fileCoverage, f: [] }), "f must be a JSON object.");
    const invalidFunctionCounters: readonly unknown[] = [-1, Number.MAX_SAFE_INTEGER + 1, "1"];
    for (const counter of invalidFunctionCounters) {
      rejectsFileCoverage(
        (fileCoverage) => ({ ...fileCoverage, f: Object.freeze({ "0": counter }) }),
        "f.0 must be a non-negative safe integer.",
      );
    }
    rejectsFileCoverage((fileCoverage) => ({ ...fileCoverage, b: [] }), "b must be a JSON object.");
    rejectsFileCoverage(
      (fileCoverage) => ({ ...fileCoverage, b: Object.freeze({ "0": {} }) }),
      "b.0 must be an array.",
    );
    const invalidBranchCounters: readonly unknown[] = [-1, Number.MAX_SAFE_INTEGER + 1, "1"];
    for (const counter of invalidBranchCounters) {
      rejectsFileCoverage(
        (fileCoverage) => ({ ...fileCoverage, b: Object.freeze({ "0": [counter] }) }),
        "b.0.0 must be a non-negative safe integer.",
      );
    }
  });

  it("uses valid branch locations and rejects path and scope violations", () => {
    withRun((run) => {
      const fileCoverage = validFileCoverage(run);
      const loc = validRange();
      const branchMap = Object.freeze({
        "0": branchMapping({ locations: [Object.freeze({ start: {}, end: {} })] }),
        "1": branchMapping({ locations: [loc] }),
      });
      run.write(
        validFilename(run),
        jsonBytes(envelopeWithFileCoverage(run, { ...fileCoverage, branchMap, b: { "0": [1], "1": [1] } })),
      );
      expect(() => run.collect()).toThrow("Merged logging E2E coverage is missing scoped runtime sources:");
    });
    rejectsFileCoverage(
      (fileCoverage) => ({ ...fileCoverage, path: "relative.ts" }),
      "path must equal its scoped coverage filename.",
    );
    rejectsFileCoverage(
      (fileCoverage) => ({ ...fileCoverage, path: 1 }),
      "path must equal its scoped coverage filename.",
    );
    withRun((run) => {
      const path = "/tmp/out-of-scope.ts";
      const coverage = Object.freeze({ [path]: minimalFileCoverage(path) });
      const envelope = Object.freeze({ ...validEnvelope(run), coverage });
      const contents = jsonBytes(envelope);
      run.write(validFilename(run), contents);
      expect(() => run.collect()).toThrow(
        "Raw logging E2E coverage contains an out-of-scope file: /tmp/out-of-scope.ts.",
      );
    });
  });
});
