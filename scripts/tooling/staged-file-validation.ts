export interface GitCommandResult {
  readonly exitCode: number;
  readonly stdout: Uint8Array;
}

export interface ProcessCommandResult {
  readonly exitCode: number;
}

export type GitCommandRunner = (arguments_: readonly string[]) => Promise<GitCommandResult>;
export type ProcessCommandRunner = (command: readonly string[]) => Promise<ProcessCommandResult>;

export interface BunGitProcess {
  readonly exited: Promise<number>;
  readonly stdout: ReadableStream<Uint8Array>;
}

export interface BunProcess {
  readonly exited: Promise<number>;
}

export type BunGitCommandSpawn = (options: {
  readonly cmd: readonly string[];
  readonly stderr: "inherit";
  readonly stdout: "pipe";
}) => BunGitProcess;

export type BunProcessCommandSpawn = (options: {
  readonly cmd: readonly string[];
  readonly stderr: "inherit";
  readonly stdout: "inherit";
}) => BunProcess;

export interface StagedFileValidationDependencies {
  readonly runGit: GitCommandRunner;
  readonly runProcess: ProcessCommandRunner;
}

export type StagedFileValidationMode = "lint" | "format";

const stagedPathsCommand = [
  "diff",
  "--cached",
  "--name-only",
  "-z",
  "--no-renames",
  "--diff-filter=ACMR",
  "--",
] as const;

const lintExtensions = new Set(["js", "mjs", "cjs", "ts", "tsx", "mts", "cts"]);
const decoder = new TextDecoder("utf-8", { fatal: true });

const commandErrorMessage = String;

export function parseNulDelimitedPaths(output: Uint8Array): readonly string[] {
  let text: string;
  try {
    text = decoder.decode(output);
  } catch (error: unknown) {
    throw new Error(`Malformed NUL-delimited git path output: ${commandErrorMessage(error)}`, {
      cause: error,
    });
  }

  if (text.length === 0) {
    return [];
  }

  if (!text.endsWith("\0")) {
    throw new Error("Malformed NUL-delimited git path output: missing terminating NUL");
  }

  const paths = text.slice(0, -1).split("\0");
  if (paths.some((path) => path.length === 0)) {
    throw new Error("Malformed NUL-delimited git path output: empty path");
  }

  return paths;
}

export function selectLintPaths(paths: readonly string[]): readonly string[] {
  return paths.filter((path) => {
    const extension = path.split(".").at(-1);
    return extension !== undefined && lintExtensions.has(extension);
  });
}

const runGitPaths = async (
  label: string,
  arguments_: readonly string[],
  runGit: GitCommandRunner,
): Promise<readonly string[]> => {
  let result: GitCommandResult;
  try {
    result = await runGit(arguments_);
  } catch (error: unknown) {
    throw new Error(`Git ${label} command failed to run: ${commandErrorMessage(error)}`, { cause: error });
  }

  if (result.exitCode !== 0) {
    throw new Error(`Git ${label} command failed with exit code ${String(result.exitCode)}`);
  }

  return parseNulDelimitedPaths(result.stdout);
};

const runValidator = async (
  mode: StagedFileValidationMode,
  paths: readonly string[],
  runProcess: ProcessCommandRunner,
): Promise<void> => {
  const selectedPaths = mode === "lint" ? selectLintPaths(paths) : paths;
  if (selectedPaths.length === 0) {
    return;
  }

  const command =
    mode === "lint"
      ? ["eslint", "--config", "eslint.config.js", "--max-warnings=0", "--", ...selectedPaths]
      : ["prettier", "--check", "--ignore-unknown", "--", ...paths];

  let result: ProcessCommandResult;
  try {
    result = await runProcess(command);
  } catch (error: unknown) {
    throw new Error(
      `${mode === "lint" ? "Lint" : "Format"} staged-file validation failed to run: ${commandErrorMessage(error)}`,
      { cause: error },
    );
  }

  if (result.exitCode !== 0) {
    throw new Error(
      `${mode === "lint" ? "Lint" : "Format"} staged-file validation failed with exit code ${String(result.exitCode)}`,
    );
  }
};

export async function runStagedFileValidation(
  mode: StagedFileValidationMode,
  dependencies: StagedFileValidationDependencies,
): Promise<void> {
  const stagedPaths = await runGitPaths("staged-path", stagedPathsCommand, dependencies.runGit);
  if (stagedPaths.length === 0) {
    return;
  }

  const worktreePaths = await runGitPaths(
    "worktree comparison",
    ["diff", "--name-only", "-z", "--", ...stagedPaths],
    dependencies.runGit,
  );
  if (worktreePaths.length > 0) {
    throw new Error(`Staged paths also differ in the worktree: ${worktreePaths.join(", ")}`);
  }

  await runValidator(mode, stagedPaths, dependencies.runProcess);
}

export const createBunGitCommandRunner =
  (spawn: BunGitCommandSpawn): GitCommandRunner =>
  async (arguments_) => {
    const child = spawn({ cmd: ["git", ...arguments_], stderr: "inherit", stdout: "pipe" });
    const [exitCode, output] = await Promise.all([child.exited, new Response(child.stdout).arrayBuffer()]);
    return { exitCode, stdout: new Uint8Array(output) };
  };

export const createBunProcessCommandRunner =
  (spawn: BunProcessCommandSpawn): ProcessCommandRunner =>
  async (command) => {
    const child = spawn({ cmd: command, stderr: "inherit", stdout: "inherit" });
    return { exitCode: await child.exited };
  };
