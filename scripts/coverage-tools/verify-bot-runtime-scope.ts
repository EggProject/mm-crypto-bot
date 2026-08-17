import { spawnSync } from "node:child_process";

import { REPOSITORY_ROOT, loadScopeManifest, missingModifiedRuntimeFiles } from "./bot-runtime-scope.ts";

const BOT_SOURCE_PATH = "apps/bot/src";
const MAX_GIT_OUTPUT_BYTES = 4 * 1024 * 1024;

export interface ScopeDiffOptions {
  readonly repositoryRoot?: string;
  readonly baseRevision?: string;
  readonly continuousIntegration?: boolean;
}

function runGit(repositoryRoot: string, arguments_: readonly string[]): string {
  const result = spawnSync("git", arguments_, {
    cwd: repositoryRoot,
    encoding: "utf8",
    maxBuffer: MAX_GIT_OUTPUT_BYTES,
  });
  if (result.status !== 0) {
    const diagnostic = (result.stderr || result.stdout).trim();
    throw new Error(`git ${arguments_.join(" ")} failed${diagnostic.length > 0 ? `: ${diagnostic}` : ""}`);
  }
  return result.stdout;
}

function parsePaths(output: string): readonly string[] {
  return output.split(/\r?\n/u).filter((path) => path.length > 0);
}

function resolveMergeBase(repositoryRoot: string, baseRevision: string): string {
  runGit(repositoryRoot, ["rev-parse", "--verify", `${baseRevision}^{commit}`]);
  const mergeBases = parsePaths(runGit(repositoryRoot, ["merge-base", baseRevision, "HEAD"]));
  if (mergeBases.length !== 1) {
    throw new Error(`git merge-base must return exactly one commit for ${baseRevision} and HEAD`);
  }
  const mergeBase = mergeBases[0];
  if (mergeBase === undefined) throw new Error("git merge-base returned no commit");
  return mergeBase;
}

function changedPaths(
  repositoryRoot: string,
  leftRevision: string,
  rightRevision?: string,
): readonly string[] {
  const revisions = rightRevision === undefined ? [leftRevision] : [leftRevision, rightRevision];
  return parsePaths(
    runGit(repositoryRoot, [
      "diff",
      "--name-only",
      "--diff-filter=ACMR",
      ...revisions,
      "--",
      BOT_SOURCE_PATH,
    ]),
  );
}

export function collectChangedBotSourceFiles({
  repositoryRoot = REPOSITORY_ROOT,
  baseRevision,
  continuousIntegration = false,
}: ScopeDiffOptions = {}): readonly string[] {
  if (continuousIntegration && (baseRevision === undefined || baseRevision.length === 0)) {
    throw new Error("MM_BOT_COVERAGE_BASE is required in CI");
  }

  const paths = new Set<string>();
  if (baseRevision !== undefined && baseRevision.length > 0) {
    const mergeBase = resolveMergeBase(repositoryRoot, baseRevision);
    for (const path of changedPaths(repositoryRoot, mergeBase, "HEAD")) paths.add(path);
  }
  for (const path of changedPaths(repositoryRoot, "HEAD")) paths.add(path);
  for (const path of parsePaths(
    runGit(repositoryRoot, ["ls-files", "--others", "--exclude-standard", "--", BOT_SOURCE_PATH]),
  ))
    paths.add(path);
  return [...paths].sort();
}

function isContinuousIntegration(): boolean {
  return process.env["CI"] === "true" || process.env["GITHUB_ACTIONS"] === "true";
}

export function verifyBotRuntimeScope(): void {
  const manifest = loadScopeManifest();
  const baseRevision = process.env["MM_BOT_COVERAGE_BASE"];
  const changedFiles = collectChangedBotSourceFiles({
    ...(baseRevision === undefined ? {} : { baseRevision }),
    continuousIntegration: isContinuousIntegration(),
  });
  const missing = missingModifiedRuntimeFiles(manifest.runtimeFiles, changedFiles);
  if (missing.length > 0) {
    throw new Error(
      `Coverage scope is missing changed bot runtime files:\n${missing.map((file) => `  - ${file}`).join("\n")}`,
    );
  }
  console.log(
    `Coverage scope verified: ${String(manifest.runtimeFiles.length)} owned runtime files; no changed runtime file is missing.`,
  );
}

if (import.meta.main) {
  try {
    verifyBotRuntimeScope();
  } catch (error) {
    console.error(
      `Coverage scope verification failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 2;
  }
}
