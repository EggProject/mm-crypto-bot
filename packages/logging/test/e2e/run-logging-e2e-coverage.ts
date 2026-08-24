import { buildInstrumentedLoggingEndToEnd } from "./build-instrumented-logging-e2e.ts";
// eslint-disable-next-line unicorn/name-replacements -- Established public E2E artifact contract.
import { createLoggingE2eArtifactRun } from "./logging-e2e-artifact-run.ts";
import { collectLoggingEndToEndCoverage, printLoggingEndToEndSummary } from "./logging-e2e-gate.ts";
import { publishLoggingEndToEndSummary } from "./logging-e2e-summary-publisher.ts";
import { LOGGING_E2E_CASE_IDS, runLoggingEndToEndSubprocesses } from "./logging-e2e-runner.ts";
import { loadLoggingEndToEndScopeManifest } from "./logging-e2e-scope.ts";

// eslint-disable-next-line unicorn/name-replacements -- Established public E2E artifact contract.
import type { LoggingE2eArtifactRun } from "./logging-e2e-artifact-run.ts";
import type { LoggingEndToEndCoverageSummary } from "./logging-e2e-gate.ts";
import type { LoggingEndToEndCaseResult } from "./logging-e2e-runner.ts";
import type { LoggingEndToEndScopeManifest } from "./logging-e2e-scope.ts";

type InstrumentedLoggingEndToEndBuild = Awaited<ReturnType<typeof buildInstrumentedLoggingEndToEnd>>;

/**
 * Internal E2E orchestration dependencies. This is deliberately not part of
 * the package API: it exists to test the security-sensitive lifecycle.
 */
export interface LoggingEndToEndCoveragePort {
  readonly loadManifest: () => LoggingEndToEndScopeManifest;
  readonly createArtifactRun: () => LoggingE2eArtifactRun;
  readonly build: (request: {
    readonly artifactRun: LoggingE2eArtifactRun;
    readonly manifest: LoggingEndToEndScopeManifest;
  }) => Promise<InstrumentedLoggingEndToEndBuild>;
  readonly runSubprocesses: (options: {
    readonly childEntry: string;
    readonly preload: string;
    readonly rawDirectory: string;
    readonly rawDirectoryIdentity: Readonly<{ readonly device: bigint; readonly inode: bigint }>;
    readonly environment: Readonly<Record<string, string | undefined>>;
    readonly verifyExecutableArtifacts: () => void;
  }) => Promise<readonly LoggingEndToEndCaseResult[]>;
  readonly collect: (request: {
    readonly artifactRun: LoggingE2eArtifactRun;
    readonly manifest: LoggingEndToEndScopeManifest;
  }) => LoggingEndToEndCoverageSummary;
  readonly publish: (request: {
    readonly artifactRun: LoggingE2eArtifactRun;
    readonly summary: LoggingEndToEndCoverageSummary;
  }) => void;
  readonly print: (summary: LoggingEndToEndCoverageSummary) => void;
  readonly environment: Readonly<Record<string, string | undefined>>;
  readonly setExitCode: (exitCode: number) => void;
}

/**
 * Internal CLI boundary for the E2E coverage lifecycle. Keeping this port
 * separate lets a dedicated executable own process startup.
 */
export interface LoggingEndToEndCoverageMainPort {
  readonly run: () => Promise<void>;
  readonly writeError: (message: string) => void;
  readonly setExitCode: (exitCode: number) => void;
}

export function setLoggingEndToEndCoverageProcessExitCode(exitCode: number): void {
  process.exitCode = exitCode;
}

export function writeLoggingEndToEndCoverageMainError(message: string): void {
  console.error(message);
}

const defaultCoveragePort: LoggingEndToEndCoveragePort = Object.freeze({
  loadManifest: loadLoggingEndToEndScopeManifest,
  createArtifactRun: createLoggingE2eArtifactRun,
  build: buildInstrumentedLoggingEndToEnd,
  runSubprocesses: runLoggingEndToEndSubprocesses,
  collect: collectLoggingEndToEndCoverage,
  publish: publishLoggingEndToEndSummary,
  print: printLoggingEndToEndSummary,
  environment: process.env,
  setExitCode: setLoggingEndToEndCoverageProcessExitCode,
});

const defaultMainPort: LoggingEndToEndCoverageMainPort = Object.freeze({
  run: runLoggingEndToEndCoverage,
  writeError: writeLoggingEndToEndCoverageMainError,
  setExitCode: setLoggingEndToEndCoverageProcessExitCode,
});

function assertExactOrderedCaseIds(
  observedCaseIds: readonly string[],
  expectedCaseIds: readonly string[],
  label: string,
): void {
  if (JSON.stringify(observedCaseIds) !== JSON.stringify(expectedCaseIds)) {
    throw new Error(`${label} must equal exactly: ${expectedCaseIds.join(", ")}.`);
  }
}

function assertPrivateExecutableArtifact(
  entry: string,
  bundleDirectory: string,
  expectedName: string,
  label: string,
): void {
  if (entry !== `${bundleDirectory}/${expectedName}`) {
    throw new Error(`${label} must be the private artifact bundle direct child ${expectedName}.`);
  }
}

export async function runLoggingEndToEndCoverage(port = defaultCoveragePort): Promise<void> {
  const manifest = port.loadManifest();
  const artifactRun = port.createArtifactRun();
  let hasPrimaryError = false;
  let primaryError: unknown;

  try {
    const build = await port.build({ artifactRun, manifest });
    const results = await port.runSubprocesses({
      childEntry: build.childEntry,
      preload: build.preloadEntry,
      rawDirectory: artifactRun.paths.raw,
      rawDirectoryIdentity: artifactRun.identities.raw,
      environment: port.environment,
      verifyExecutableArtifacts: () => {
        assertPrivateExecutableArtifact(
          build.childEntry,
          artifactRun.paths.bundle,
          "logging-e2e-child.js",
          "Logging E2E child entry",
        );
        assertPrivateExecutableArtifact(
          build.preloadEntry,
          artifactRun.paths.bundle,
          "logging-e2e-preload.js",
          "Logging E2E preload entry",
        );
        artifactRun.readFile("bundle", "logging-e2e-child.js");
        artifactRun.readFile("bundle", "logging-e2e-preload.js");
      },
    });
    const adoptedRawFiles = artifactRun.adoptExternalFiles("raw");
    if (adoptedRawFiles.length !== results.length) {
      throw new Error(
        `Expected exactly ${String(results.length)} adopted logging E2E raw coverage files, received ${String(adoptedRawFiles.length)}.`,
      );
    }
    const completedCaseIds = results.map((result) => result.caseId);
    assertExactOrderedCaseIds(completedCaseIds, LOGGING_E2E_CASE_IDS, "Completed logging E2E case IDs");
    assertExactOrderedCaseIds(completedCaseIds, manifest.e2eCases, "Completed logging E2E manifest case IDs");

    const summary = port.collect({
      artifactRun,
      manifest,
    });
    port.publish({ artifactRun, summary });
    port.print(summary);
    if (!summary.passed) port.setExitCode(1);
  } catch (error: unknown) {
    hasPrimaryError = true;
    primaryError = error;
  }

  let hasCleanupError = false;
  let cleanupError: unknown;
  try {
    artifactRun.cleanup();
  } catch (error: unknown) {
    hasCleanupError = true;
    cleanupError = error;
  }

  if (hasPrimaryError && hasCleanupError) {
    throw new AggregateError(
      [primaryError, cleanupError],
      "Logging E2E coverage failed and artifact cleanup failed.",
      { cause: primaryError },
    );
  }
  if (hasPrimaryError) throw primaryError;
  if (hasCleanupError) throw cleanupError;
}

export async function runLoggingEndToEndCoverageMain(port = defaultMainPort): Promise<void> {
  try {
    await port.run();
  } catch (error: unknown) {
    port.writeError(
      `Logging subprocess E2E coverage infrastructure failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    port.setExitCode(2);
  }
}
