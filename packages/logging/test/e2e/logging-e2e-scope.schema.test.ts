// eslint-disable-next-line unicorn/import-style -- Bun's node:path declaration only exposes typed named imports under the E2E project's configured type roots.
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  REPOSITORY_ROOT,
  absoluteRuntimeFiles,
  isLoggingEndToEndCaseId,
  loadLoggingEndToEndScopeManifest,
  parseLoggingEndToEndScopeManifest,
  type LoggingEndToEndScopeManifest,
} from "./logging-e2e-scope.ts";

const runtimeFiles = [
  "packages/logging/src/contracts.ts",
  "packages/logging/src/index.ts",
  "packages/logging/src/serialization.ts",
  "packages/logging/src/sinks.ts",
  "packages/logging/src/structured-logger.ts",
] as const;

const e2eCases = ["scope-schema-case", "scope-schema-other"] as const;

function validManifest(
  overrides: Partial<{
    readonly schemaVersion: unknown;
    readonly runtimeFiles: unknown;
    readonly e2eCases: unknown;
  }> = {},
): unknown {
  return { schemaVersion: 1, runtimeFiles: [...runtimeFiles], e2eCases: [...e2eCases], ...overrides };
}

function parse(candidate: unknown): LoggingEndToEndScopeManifest {
  return parseLoggingEndToEndScopeManifest(candidate, { areFilesRequired: false });
}

describe("logging E2E scope manifest schema", () => {
  it("accepts the exact, frozen runtime manifest", () => {
    const candidate = Object.freeze({
      schemaVersion: 1,
      runtimeFiles: Object.freeze([...runtimeFiles]),
      e2eCases: Object.freeze([...e2eCases]),
    });

    expect(parse(candidate)).toEqual(candidate);
    expect(Object.isFrozen(candidate)).toBe(true);
    expect(Object.isFrozen(candidate.runtimeFiles)).toBe(true);
    expect(Object.isFrozen(candidate.e2eCases)).toBe(true);
  });

  it.each([
    // eslint-disable-next-line unicorn/no-null -- JSON null is an explicit rejected schema input.
    [null, "must be a JSON object"],
    [[], "must be a JSON object"],
    [{ schemaVersion: 1, runtimeFiles }, "must contain exactly"],
    [{ ...(validManifest() as object), unexpected: true }, "must contain exactly"],
    [validManifest({ schemaVersion: 2 }), "schemaVersion must equal 1"],
  ])("rejects an invalid manifest envelope", (candidate, message) => {
    expect(() => parse(candidate)).toThrow(message);
  });

  it.each([
    ["not-an-array", "must be a non-empty array"],
    [[], "must be a non-empty array"],
    [[0], "must contain non-empty strings"],
    [["/tmp/escape.ts"], "contains an unsafe path"],
    [[String.raw`packages\logging/src/contracts.ts`], "contains an unsafe path"],
    [["packages/logging/src/../src/contracts.ts"], "contains an unsafe path"],
    [["packages/typeguard/src/index.ts"], "contains a non-runtime logging source"],
    [["packages/logging/src/contracts.tsx"], "contains a non-runtime logging source"],
    [["packages/logging/src/contracts.test.ts"], "must not contain a test source"],
    [[runtimeFiles[0], runtimeFiles[0]], "contains a duplicate path"],
    [[runtimeFiles[0]], "must exactly equal the recursively discovered logging source scope"],
  ])("rejects an invalid runtimeFiles value", (invalidRuntimeFiles, message) => {
    expect(() => parse(validManifest({ runtimeFiles: invalidRuntimeFiles }))).toThrow(message);
  });

  it.each([
    ["not-an-array", "must be a non-empty array"],
    [[], "must be a non-empty array"],
    [[0], "contains an invalid case ID"],
    [["UPPERCASE"], "contains an invalid case ID"],
    [["under_score"], "contains an invalid case ID"],
    [["empty--segment"], "contains an invalid case ID"],
    [[e2eCases[0], e2eCases[0]], "contains a duplicate case ID"],
  ])("rejects an invalid e2eCases value", (invalidCaseIds, message) => {
    expect(() => parse(validManifest({ e2eCases: invalidCaseIds }))).toThrow(message);
  });

  it("resolves runtime files and looks up known case IDs", () => {
    const manifest = parse(validManifest());

    expect(absoluteRuntimeFiles(manifest)).toEqual(
      runtimeFiles.map((path) => resolve(REPOSITORY_ROOT, path)),
    );
    expect(isLoggingEndToEndCaseId(e2eCases[0], manifest)).toBe(true);
    expect(isLoggingEndToEndCaseId("not-listed", manifest)).toBe(false);
  });

  it("loads the checked-in scope manifest", () => {
    const manifest = loadLoggingEndToEndScopeManifest();

    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.runtimeFiles).toEqual(runtimeFiles);
    expect(manifest.e2eCases).toContain("public-schema-redaction");
  });
});
