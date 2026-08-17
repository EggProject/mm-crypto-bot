/* eslint-disable security/detect-non-literal-fs-filename -- raw output is equality-checked against the repository-owned directory */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { dropBotE2eCredentialsFromProcessEnvironment } from "./bot-e2e-child-environment.ts";
import { REPOSITORY_ROOT } from "./bot-runtime-scope.ts";
import { installOutboundNetworkGuard } from "./bot-runtime-network-guard.ts";

dropBotE2eCredentialsFromProcessEnvironment();
const networkGuard = installOutboundNetworkGuard();

const EXPECTED_RAW_DIRECTORY = resolve(REPOSITORY_ROOT, "apps/bot/coverage/e2e/raw");
const rawDirectory = process.env["MM_BOT_E2E_COVERAGE_RAW_DIR"];
const entryKind = process.env["MM_BOT_E2E_ENTRY_KIND"];
const caseId = process.env["MM_BOT_E2E_CASE_ID"];

if (rawDirectory === undefined || resolve(rawDirectory) !== EXPECTED_RAW_DIRECTORY) {
  throw new Error("MM_BOT_E2E_COVERAGE_RAW_DIR must be the repository-owned E2E raw directory");
}
if (entryKind !== "canonical-cli" && entryKind !== "runtime-driver") {
  throw new Error("MM_BOT_E2E_ENTRY_KIND is invalid");
}
function isCaseId(value: string): boolean {
  return (
    value.length > 0 &&
    value
      .split("-")
      .every(
        (part) =>
          part.length > 0 &&
          Array.from(part).every(
            (character) => (character >= "a" && character <= "z") || (character >= "0" && character <= "9"),
          ),
      )
  );
}

if (caseId === undefined || !isCaseId(caseId)) {
  throw new Error("MM_BOT_E2E_CASE_ID is invalid");
}

let flushed = false;
let networkDiagnosticsWritten = false;

function enforceNetworkGuard(): void {
  if (networkGuard.attempts.length === 0 || networkDiagnosticsWritten) return;
  networkDiagnosticsWritten = true;
  if (process.exitCode === undefined || process.exitCode === 0) process.exitCode = 86;
  void process.stderr.write(
    `[bot-e2e-network-guard] blocked attempt ledger: ${networkGuard.attempts.join(", ")}\n`,
  );
}

function flushCoverage(): void {
  if (flushed) return;
  flushed = true;
  const coverage: unknown = Object.getOwnPropertyDescriptor(globalThis, "__coverage__")?.value as unknown;
  if (coverage === undefined || coverage === null || typeof coverage !== "object") return;
  mkdirSync(EXPECTED_RAW_DIRECTORY, { recursive: true });
  const output = resolve(EXPECTED_RAW_DIRECTORY, `${String(process.pid)}.json`);
  writeFileSync(
    output,
    `${JSON.stringify({
      schemaVersion: 1,
      pid: process.pid,
      entryKind,
      caseId,
      coverage: coverage as Record<string, unknown>,
    })}\n`,
    { encoding: "utf8", flag: "wx", mode: 0o600 },
  );
}

process.once("beforeExit", () => {
  enforceNetworkGuard();
  flushCoverage();
});
process.once("exit", () => {
  enforceNetworkGuard();
  flushCoverage();
});
