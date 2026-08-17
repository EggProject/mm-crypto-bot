/* eslint-disable security/detect-non-literal-fs-filename -- cleanup is guarded by the exact repository-owned coverage parent */
import { mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";

import { buildBotE2eChildEnvironment } from "./bot-e2e-child-environment.ts";
import { collectBotE2eCoverage, printBotE2eSummary, writeBotE2eSummary } from "./bot-e2e-gate.ts";
import { REPOSITORY_ROOT, loadScopeManifest } from "./bot-runtime-scope.ts";
import { buildInstrumentedBotE2e } from "./build-bot-e2e.ts";

const E2E_DIRECTORY = resolve(REPOSITORY_ROOT, "apps/bot/coverage/e2e");
const RAW_DIRECTORY = resolve(E2E_DIRECTORY, "raw");
const PRELOAD = resolve(REPOSITORY_ROOT, "scripts/coverage-tools/bot-e2e-preload.ts");
const SUMMARY = resolve(E2E_DIRECTORY, "summary.json");

function recreateE2eDirectory(): void {
  if (resolve(E2E_DIRECTORY, "..") !== resolve(REPOSITORY_ROOT, "apps/bot/coverage")) {
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
    env: buildBotE2eChildEnvironment(process.env, environmentOverrides),
    stdout: "inherit",
    stderr: "inherit",
  });
  if (result.exitCode !== 0) {
    throw new Error(`${[command, ...arguments_].join(" ")} exited ${String(result.exitCode)}`);
  }
}

try {
  recreateE2eDirectory();
  run("bun", [resolve(REPOSITORY_ROOT, "scripts/coverage-tools/verify-bot-runtime-scope.ts")]);
  const build = await buildInstrumentedBotE2e();
  const coverageEnvironment = {
    MM_BOT_E2E_COVERAGE_PRELOAD: PRELOAD,
    MM_BOT_E2E_COVERAGE_RAW_DIR: RAW_DIRECTORY,
  };
  run("bun", ["test", "apps/bot/src/cli/cli-e2e.test.ts"], {
    ...coverageEnvironment,
    MM_BOT_E2E_ENTRY: build.cliEntry,
    MM_BOT_E2E_START_MODULE: build.startModule,
  });
  for (const caseId of loadScopeManifest().e2eCases["runtime-driver"]) {
    run("bun", ["--preload", PRELOAD, build.runtimeDriverEntry, caseId], {
      ...coverageEnvironment,
      MM_BOT_E2E_ENTRY_KIND: "runtime-driver",
      MM_BOT_E2E_CASE_ID: caseId,
    });
  }
  const summary = collectBotE2eCoverage({ rawDirectory: RAW_DIRECTORY });
  writeBotE2eSummary(summary, SUMMARY);
  printBotE2eSummary(summary);
  if (!summary.passed) process.exitCode = 1;
} catch (error) {
  console.error(
    `Bot subprocess E2E coverage infrastructure failed: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 2;
}
