import { spawnSync } from "node:child_process";

import {
  REPOSITORY_ROOT,
  loadScopeManifest,
  missingModifiedRuntimeFiles,
  type BotRuntimeScopeManifest,
} from "./bot-runtime-scope.ts";

const BOT_SOURCE_PATH = "apps/bot/src";
const MAX_GIT_OUTPUT_BYTES = 4 * 1024 * 1024;
const COMMIT_REVISION_SUFFIX = "^{commit}";

export interface ScopeDiffOptions {
  readonly repositoryRoot?: string;
  readonly baseRevision?: string;
  readonly continuousIntegration?: boolean;
}

type Environment = Readonly<Record<string, string | undefined>>;

export interface ScopeVerificationPorts {
  readonly environment: Environment;
  readonly loadManifest: () => BotRuntimeScopeManifest;
  readonly collectChangedBotSourceFiles: (options: ScopeDiffOptions) => readonly string[];
  readonly missingModifiedRuntimeFiles: (
    manifestFiles: readonly string[],
    changedFiles: readonly string[],
  ) => readonly string[];
  readonly writeStandardError: (message: string) => void;
  readonly writeStandardOutput: (message: string) => void;
}

export interface ExitCodeTarget {
  exitCode?: string | number | null | undefined;
}

function runGit(repoRoot: string, arguments_: readonly string[]): string {
  const result = spawnSync("git", arguments_, {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: MAX_GIT_OUTPUT_BYTES,
  });
  if (result.status !== 0) {
    const diagnostic = [result.stderr, result.stdout].join("\n").trim();
    throw new Error(`git ${arguments_.join(" ")} failed: ${diagnostic}`);
  }
  return result.stdout;
}

function parsePaths(output: string): readonly string[] {
  return output.split(/\r?\n/u).filter((path) => path.length > 0);
}

function resolveMergeBase(repoRoot: string, baseRevision: string): string {
  runGit(repoRoot, ["rev-parse", "--verify", `${baseRevision}${COMMIT_REVISION_SUFFIX}`]);
  return runGit(repoRoot, ["merge-base", baseRevision, "HEAD"]).trim();
}

function changedPaths(repoRoot: string, leftRevision: string, rightRevision?: string): readonly string[] {
  const revisions = rightRevision === undefined ? [leftRevision] : [leftRevision, rightRevision];
  return parsePaths(
    runGit(repoRoot, ["diff", "--name-only", "--diff-filter=ACMR", ...revisions, "--", BOT_SOURCE_PATH]),
  );
}

function compareByCodeUnit(left: string, right: string): number {
  return Number(left > right) - Number(left < right);
}

export function collectChangedBotSourceFiles({
  repositoryRoot: repoRoot = REPOSITORY_ROOT,
  baseRevision,
  continuousIntegration = false,
}: ScopeDiffOptions = {}): readonly string[] {
  if (continuousIntegration && (baseRevision === undefined || baseRevision.length === 0)) {
    throw new Error("MM_BOT_COVERAGE_BASE is required in CI");
  }

  const paths = new Set<string>();
  if (baseRevision !== undefined && baseRevision.length > 0) {
    const mergeBase = resolveMergeBase(repoRoot, baseRevision);
    for (const path of changedPaths(repoRoot, mergeBase, "HEAD")) paths.add(path);
  }
  for (const path of changedPaths(repoRoot, "HEAD")) paths.add(path);
  const untrackedPaths = parsePaths(
    runGit(repoRoot, ["ls-files", "--others", "--exclude-standard", "--", BOT_SOURCE_PATH]),
  );
  for (const path of untrackedPaths) {
    paths.add(path);
  }
  return [...paths].toSorted(compareByCodeUnit);
}

export function isContinuousIntegration(environment: Environment): boolean {
  return environment["CI"] === "true" || environment["GITHUB_ACTIONS"] === "true";
}

export function createDefaultScopeVerificationPorts(): ScopeVerificationPorts {
  return {
    environment: process.env,
    loadManifest: loadScopeManifest,
    collectChangedBotSourceFiles,
    missingModifiedRuntimeFiles,
    writeStandardError: (message) => {
      console.error(message);
    },
    writeStandardOutput: (message) => {
      console.log(message);
    },
  };
}

export function verifyBotRuntimeScope(ports: ScopeVerificationPorts): void {
  const manifest = ports.loadManifest();
  const baseRevision = ports.environment["MM_BOT_COVERAGE_BASE"];
  const changedFiles = ports.collectChangedBotSourceFiles({
    ...(baseRevision !== undefined && { baseRevision }),
    continuousIntegration: isContinuousIntegration(ports.environment),
  });
  const missing = ports.missingModifiedRuntimeFiles(manifest.runtimeFiles, changedFiles);
  if (missing.length > 0) {
    throw new Error(
      `Coverage scope is missing changed bot runtime files:\n${missing.map((file) => `  - ${file}`).join("\n")}`,
    );
  }
  ports.writeStandardOutput(
    `Coverage scope verified: ${String(manifest.runtimeFiles.length)} owned runtime files; no changed runtime file is missing.`,
  );
}

export function runBotRuntimeScopeCli(ports: ScopeVerificationPorts): 0 | 2 {
  try {
    verifyBotRuntimeScope(ports);
    return 0;
  } catch (error) {
    ports.writeStandardError(
      `Coverage scope verification failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    return 2;
  }
}

export function runDefaultBotRuntimeScopeCli(): 0 | 2 {
  return runBotRuntimeScopeCli(createDefaultScopeVerificationPorts());
}

export function runBotRuntimeScopeEntrypoint(
  isDirectExecution: boolean,
  runCommand: () => 0 | 2,
  exitCodeTarget: ExitCodeTarget,
): 0 | 2 | undefined {
  if (!isDirectExecution) return undefined;
  const exitCode = runCommand();
  exitCodeTarget.exitCode = exitCode;
  return exitCode;
}

export const botRuntimeScopeCliEntrypoint = runBotRuntimeScopeEntrypoint(
  import.meta.main,
  runDefaultBotRuntimeScopeCli,
  process,
);
