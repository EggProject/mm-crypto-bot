import { type FileCoverageData } from "istanbul-lib-coverage";

import { createLoggingE2eArtifactRun as createArtifactRun } from "./logging-e2e-artifact-run.ts";
import { collectLoggingEndToEndCoverage } from "./logging-e2e-gate.ts";
import {
  absoluteRuntimeFiles,
  loadLoggingEndToEndScopeManifest,
  type LoggingEndToEndScopeManifest,
} from "./logging-e2e-scope.ts";

export interface GateTestRun {
  readonly caseId: string;
  readonly manifest: LoggingEndToEndScopeManifest;
  readonly pid: number;
  readonly collect: () => ReturnType<typeof collectLoggingEndToEndCoverage>;
  readonly write: (filename: string, contents: Uint8Array) => void;
  readonly cleanup: () => void;
}

function firstManifestCase(manifest: LoggingEndToEndScopeManifest): string {
  const caseId = manifest.e2eCases.at(0);
  if (caseId === undefined) throw new Error("Expected the logging E2E manifest to declare a case.");
  return caseId;
}

function firstRuntimeFile(manifest: LoggingEndToEndScopeManifest): string {
  const runtimeFile = absoluteRuntimeFiles(manifest).at(0);
  if (runtimeFile === undefined)
    throw new Error("Expected the logging E2E manifest to declare a runtime file.");
  return runtimeFile;
}

function location(
  line: number,
  column: number,
): Readonly<{ readonly line: number; readonly column: number }> {
  return Object.freeze({ line, column });
}

function range(): Readonly<{
  readonly start: Readonly<{ readonly line: number; readonly column: number }>;
  readonly end: Readonly<{ readonly line: number; readonly column: number }>;
}> {
  return Object.freeze({ start: location(1, 0), end: location(1, 1) });
}

export function minimalFileCoverage(path: string): FileCoverageData {
  return {
    path,
    statementMap: { "0": range() },
    fnMap: {},
    branchMap: {},
    s: { "0": 1 },
    f: {},
    b: {},
  };
}

export function validEnvelope(
  run: Pick<GateTestRun, "caseId" | "manifest" | "pid">,
): Readonly<Record<string, unknown>> {
  const runtimeFile = firstRuntimeFile(run.manifest);
  return {
    schemaVersion: 1,
    pid: run.pid,
    caseId: run.caseId,
    coverage: { [runtimeFile]: minimalFileCoverage(runtimeFile) },
  };
}

export function jsonBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value));
}

export function createGateTestRun(): GateTestRun {
  const artifactRun = createArtifactRun();
  const manifest = loadLoggingEndToEndScopeManifest();
  const caseId = firstManifestCase(manifest);
  const pid = 123;
  return {
    caseId,
    manifest,
    pid,
    collect: () => collectLoggingEndToEndCoverage({ artifactRun, manifest }),
    write: (filename, contents) => {
      artifactRun.writeExclusiveFile("raw", filename, contents);
    },
    cleanup: () => {
      artifactRun.cleanup();
    },
  };
}
