/* eslint-disable security/detect-non-literal-fs-filename -- cleanup is guarded by the exact repository-owned coverage parent */
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";

import { buildBotE2eChildEnvironment as buildChildEnvironment } from "./bot-e2e-child-environment.ts";
import {
  collectBotE2eCoverage as collectCoverage,
  printBotE2eSummary as printSummary,
  writeBotE2eSummary as writeSummary,
} from "./bot-e2e-gate.ts";
import { REPOSITORY_ROOT, loadScopeManifest } from "./bot-runtime-scope.ts";
import { buildInstrumentedBotE2e as buildInstrumentedBot } from "./build-bot-e2e.ts";

const E2E_DIRECTORY = path.resolve(REPOSITORY_ROOT, "apps/bot/coverage/e2e");
const RAW_DIRECTORY = path.resolve(E2E_DIRECTORY, "raw");
const PRELOAD = path.resolve(REPOSITORY_ROOT, "scripts/coverage-tools/bot-e2e-preload.ts");
const SUMMARY = path.resolve(E2E_DIRECTORY, "summary.json");
const CANONICAL_CLI_E2E_TESTS = [
  "apps/bot/src/cli/cli-e2e.test.ts",
  "apps/bot/src/cli/cli-e2e-signal-string-failure.test.ts",
] as const;

function recreateE2EDirectory(): void {
  if (path.resolve(E2E_DIRECTORY, "..") !== path.resolve(REPOSITORY_ROOT, "apps/bot/coverage")) {
    throw new Error(`refusing to clean unexpected E2E directory: ${E2E_DIRECTORY}`);
  }
  rmSync(E2E_DIRECTORY, { recursive: true, force: true });
  mkdirSync(RAW_DIRECTORY, { recursive: true });
}

function run(
  command: string,
  arguments_: readonly string[],
  environmentOverrides: Readonly<Record<string, string>> = {},
): void {
  const result = Bun.spawnSync({
    cmd: [command, ...arguments_],
    cwd: REPOSITORY_ROOT,
    env: buildChildEnvironment(process.env, environmentOverrides),
    stdout: "inherit",
    stderr: "inherit",
  });
  if (result.exitCode !== 0) {
    throw new Error(`${[command, ...arguments_].join(" ")} exited ${String(result.exitCode)}`);
  }
}

try {
  recreateE2EDirectory();
  run("bun", [path.resolve(REPOSITORY_ROOT, "scripts/coverage-tools/verify-bot-runtime-scope.ts")]);
  const build = await buildInstrumentedBot();
  const coverageEnvironment = {
    MM_BOT_E2E_COVERAGE_PRELOAD: PRELOAD,
    MM_BOT_E2E_COVERAGE_RAW_DIR: RAW_DIRECTORY,
  };
  for (const testPath of CANONICAL_CLI_E2E_TESTS) {
    run("bun", ["test", testPath], {
      ...coverageEnvironment,
      MM_BOT_E2E_ENTRY: build.cliEntry,
      MM_BOT_E2E_START_MODULE: build.startModule,
    });
  }
  const runtimeDriverCases = loadScopeManifest().e2eCases["runtime-driver"];
  for (const caseId of runtimeDriverCases) {
    run("bun", ["--preload", PRELOAD, build.runtimeDriverEntry, caseId], {
      ...coverageEnvironment,
      MM_BOT_E2E_ENTRY_KIND: "runtime-driver",
      MM_BOT_E2E_CASE_ID: caseId,
    });
  }
  const summary = collectCoverage({ rawDirectory: RAW_DIRECTORY });
  writeSummary(summary, SUMMARY);
  printSummary(summary);
  if (!summary.passed) process.exitCode = 1;
} catch (error) {
  console.error(
    `Bot subprocess E2E coverage infrastructure failed: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 2;
}
