import path from "node:path";

import { LOGGING_E2E_CASE_IDS, type LoggingEndToEndCaseId } from "./logging-e2e-case-contract.ts";

type LoggingEndToEndPreloadEvent = "beforeExit" | "exit";

export interface LoggingEndToEndPreloadEnvironment {
  readonly rawDirectory: string | undefined;
  readonly caseId: string | undefined;
}

export interface LoggingEndToEndPreloadPort {
  readonly environment: LoggingEndToEndPreloadEnvironment;
  readonly registerOnce: (event: LoggingEndToEndPreloadEvent, callback: () => void) => void;
  readonly readCoverage: () => unknown;
  readonly pid: number;
  readonly writeFile: (filePath: string, contents: Uint8Array) => void;
}

function readRawDirectory(port: LoggingEndToEndPreloadPort): string {
  const candidate = port.environment.rawDirectory;
  if (candidate === undefined || candidate.length === 0 || !path.isAbsolute(candidate)) {
    throw new Error("MM_LOGGING_E2E_COVERAGE_RAW_DIR must be a non-empty absolute path.");
  }
  return candidate;
}

function isDeclaredCaseId(candidate: string): candidate is LoggingEndToEndCaseId {
  const declaredCaseIds: readonly string[] = LOGGING_E2E_CASE_IDS;
  return declaredCaseIds.includes(candidate);
}

function readDeclaredCaseId(port: LoggingEndToEndPreloadPort): LoggingEndToEndCaseId {
  const caseId = port.environment.caseId;
  if (typeof caseId !== "string" || !isDeclaredCaseId(caseId)) {
    throw new Error("MM_LOGGING_E2E_CASE_ID must be a declared logging E2E case ID.");
  }
  return caseId;
}

function isCoveragePayload(candidate: unknown): candidate is Readonly<Record<string, unknown>> {
  return candidate !== null && typeof candidate === "object" && !Array.isArray(candidate);
}

function isCoverageGlobal(candidate: unknown): candidate is { readonly __coverage__?: unknown } {
  return candidate !== null && typeof candidate === "object";
}

/**
 * Installs the process-local E2E coverage writer through an explicit infrastructure port.
 */
export function installLoggingEndToEndPreload(port: LoggingEndToEndPreloadPort): void {
  const rawDirectory = readRawDirectory(port);
  const caseId = readDeclaredCaseId(port);
  let hasCoverageBeenWritten = false;

  const writeCoverageOnce = (): void => {
    if (hasCoverageBeenWritten) return;
    hasCoverageBeenWritten = true;
    const coveragePayload = port.readCoverage();
    if (!isCoveragePayload(coveragePayload)) return;
    const contents = new TextEncoder().encode(
      `${JSON.stringify({
        schemaVersion: 1,
        pid: port.pid,
        caseId,
        coverage: coveragePayload,
      })}\n`,
    );
    port.writeFile(path.join(rawDirectory, `${caseId}-${String(port.pid)}.json`), contents);
  };

  port.registerOnce("beforeExit", writeCoverageOnce);
  port.registerOnce("exit", writeCoverageOnce);
}

const defaultPort: LoggingEndToEndPreloadPort = Object.freeze({
  environment: Object.freeze({
    rawDirectory: process.env["MM_LOGGING_E2E_COVERAGE_RAW_DIR"],
    caseId: process.env["MM_LOGGING_E2E_CASE_ID"],
  }),
  registerOnce: (event: LoggingEndToEndPreloadEvent, callback: () => void): void => {
    process.once(event, callback);
  },
  readCoverage: (): unknown => {
    const coverageGlobal: unknown = globalThis;
    if (!isCoverageGlobal(coverageGlobal)) return undefined;
    return coverageGlobal.__coverage__;
  },
  pid: process.pid,
  writeFile: (filePath: string, contents: Uint8Array): void => {
    const result = Bun.spawnSync({ cmd: ["tee", filePath], stdin: contents, stderr: "pipe", stdout: "pipe" });
    if (result.exitCode !== 0) {
      throw new Error(`Cannot write logging E2E coverage: ${new TextDecoder().decode(result.stderr)}.`);
    }
  },
});

installLoggingEndToEndPreload(defaultPort);
