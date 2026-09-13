import { spawnSync } from "node:child_process";

import {
  assertStagedValidatorSuccess,
  parseNulDelimitedPaths,
  parseStagedFileValidationArguments,
  stagedPathsGitArguments,
  stagedValidatorCommand,
  validateStagedRepoPaths,
  validatedGitOutput,
  worktreePathsGitArguments,
  type RawProcessObservation,
  type StagedFileValidationMode,
} from "./staged-file-validation-contract.ts";

function observeProcess(executable: string, argv: readonly string[], cwd: string): RawProcessObservation {
  const result = spawnSync(executable, argv, { cwd, shell: false, stdio: ["ignore", "pipe", "inherit"] });
  return Object.freeze({
    error: result.error,
    signal: result.signal,
    status: result.status,
    stdout: result.stdout,
  });
}

export async function runStagedFileValidation(
  mode: StagedFileValidationMode,
  cwd = process.cwd(),
): Promise<void> {
  const stagedObservation = observeProcess("git", stagedPathsGitArguments(), cwd);
  const stagedOutput = validatedGitOutput("staged-path", stagedObservation);
  const paths = parseNulDelimitedPaths(stagedOutput);
  if (paths.length === 0) return;
  validateStagedRepoPaths(paths);
  const worktreeObservation = observeProcess("git", worktreePathsGitArguments(paths), cwd);
  const worktreeOutput = validatedGitOutput("worktree comparison", worktreeObservation);
  const worktreePaths = parseNulDelimitedPaths(worktreeOutput);
  if (worktreePaths.length > 0) {
    throw new Error(`Staged paths also differ in the worktree: ${worktreePaths.join(", ")}`);
  }
  const command = stagedValidatorCommand(mode, paths);
  if (command === undefined) return;
  assertStagedValidatorSuccess(mode, observeProcess(command[0], command.slice(1), cwd));
  await Promise.resolve();
}

export async function runStagedFileValidationEntrypoint(
  argv: readonly unknown[],
  exitCodeTarget: { exitCode: number | string | null | undefined },
  isMain: boolean,
): Promise<number | string | null | undefined> {
  if (!isMain) return exitCodeTarget.exitCode;
  try {
    await runStagedFileValidation(parseStagedFileValidationArguments(argv));
    exitCodeTarget.exitCode = 0;
  } catch {
    process.stderr.write("staged-file validation failed\n");
    exitCodeTarget.exitCode = 1;
  }
  return exitCodeTarget.exitCode;
}

process.exitCode = await runStagedFileValidationEntrypoint(process.argv.slice(2), process, import.meta.main);
