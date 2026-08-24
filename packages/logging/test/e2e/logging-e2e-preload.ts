// eslint-disable-next-line unicorn/import-style -- Bun's node:path declaration only exposes typed named imports under the E2E project's configured type roots.
import { isAbsolute } from "node:path";

import { LOGGING_E2E_CASE_IDS, type LoggingEndToEndCaseId } from "./logging-e2e-case-contract.ts";
import {
  writeExclusiveFileToVerifiedDirectory,
  type VerifiedDirectoryWriteRequest,
} from "./logging-e2e-secure-directory-writer.ts";

type LoggingEndToEndPreloadEvent = "beforeExit" | "exit";

export interface LoggingEndToEndPreloadEnvironment {
  readonly rawDirectory: string | undefined;
  readonly rawDevice: string | undefined;
  readonly rawInode: string | undefined;
  readonly caseId: string | undefined;
}

export interface LoggingEndToEndPreloadPort {
  readonly environment: LoggingEndToEndPreloadEnvironment;
  readonly registerOnce: (event: LoggingEndToEndPreloadEvent, callback: () => void) => void;
  readonly readCoverageDescriptor: () => PropertyDescriptor | undefined;
  readonly pid: number;
  readonly writeExclusiveFile: (request: VerifiedDirectoryWriteRequest) => void;
}

function readRawDirectory(port: LoggingEndToEndPreloadPort): string {
  const candidate = port.environment.rawDirectory;
  if (candidate === undefined || candidate.length === 0 || !isAbsolute(candidate)) {
    throw new Error("MM_LOGGING_E2E_COVERAGE_RAW_DIR must be a non-empty absolute path.");
  }
  return candidate;
}

function parseCanonicalNonnegativeDecimalEnvironmentVariable(
  value: string | undefined,
  variableName: string,
): bigint {
  if (value === undefined || !/^(?:0|[1-9][0-9]*)$/u.test(value)) {
    throw new Error(`${variableName} must be a canonical nonnegative decimal BigInt.`);
  }
  return BigInt(value);
}

function readExpectedDirectoryIdentity(
  port: LoggingEndToEndPreloadPort,
): Readonly<{ device: bigint; inode: bigint }> {
  return Object.freeze({
    device: parseCanonicalNonnegativeDecimalEnvironmentVariable(
      port.environment.rawDevice,
      "MM_LOGGING_E2E_COVERAGE_RAW_DEVICE",
    ),
    inode: parseCanonicalNonnegativeDecimalEnvironmentVariable(
      port.environment.rawInode,
      "MM_LOGGING_E2E_COVERAGE_RAW_INODE",
    ),
  });
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

/**
 * Installs the process-local E2E coverage writer through an explicit infrastructure port.
 */
export function installLoggingEndToEndPreload(port: LoggingEndToEndPreloadPort): void {
  const rawDirectory = readRawDirectory(port);
  const expectedDirectoryIdentity = readExpectedDirectoryIdentity(port);
  const caseId = readDeclaredCaseId(port);
  let hasCoverageBeenWritten = false;

  const writeCoverageOnce = (): void => {
    if (hasCoverageBeenWritten) return;
    hasCoverageBeenWritten = true;
    const coveragePayload: unknown = port.readCoverageDescriptor()?.value;
    if (!isCoveragePayload(coveragePayload)) return;
    const contents = new TextEncoder().encode(
      `${JSON.stringify({
        schemaVersion: 1,
        pid: port.pid,
        caseId,
        coverage: coveragePayload,
      })}\n`,
    );
    port.writeExclusiveFile({
      directoryPath: rawDirectory,
      expectedDirectoryIdentity,
      fileName: `${caseId}-${String(port.pid)}.json`,
      contents,
      label: "Logging E2E raw coverage",
    });
  };

  port.registerOnce("beforeExit", writeCoverageOnce);
  port.registerOnce("exit", writeCoverageOnce);
}

const defaultPort: LoggingEndToEndPreloadPort = Object.freeze({
  environment: Object.freeze({
    rawDirectory: process.env["MM_LOGGING_E2E_COVERAGE_RAW_DIR"],
    rawDevice: process.env["MM_LOGGING_E2E_COVERAGE_RAW_DEVICE"],
    rawInode: process.env["MM_LOGGING_E2E_COVERAGE_RAW_INODE"],
    caseId: process.env["MM_LOGGING_E2E_CASE_ID"],
  }),
  registerOnce: (event: LoggingEndToEndPreloadEvent, callback: () => void): void => {
    process.once(event, callback);
  },
  readCoverageDescriptor: (): PropertyDescriptor | undefined =>
    Object.getOwnPropertyDescriptor(globalThis, "__coverage__"),
  pid: process.pid,
  writeExclusiveFile: (request: VerifiedDirectoryWriteRequest): void => {
    writeExclusiveFileToVerifiedDirectory(request);
  },
});

installLoggingEndToEndPreload(defaultPort);
