export type StagedFileValidationMode = "lint" | "format";

export interface RawProcessObservation {
  readonly error: unknown;
  readonly signal: unknown;
  readonly status: unknown;
  readonly stdout: unknown;
}

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
const unsafePathComponents = new Set(["", ".", ".."]);
const decoder = new TextDecoder("utf-8", { fatal: true });

export function parseStagedFileValidationArguments(argv: readonly unknown[]): StagedFileValidationMode {
  if (argv.length !== 1 || typeof argv[0] !== "string") {
    throw new Error("invalid staged-file validation arguments");
  }
  if (argv[0] === "--mode=lint") return "lint";
  if (argv[0] === "--mode=format") return "format";
  throw new Error("invalid staged-file validation arguments");
}

export function stagedPathsGitArguments(): readonly string[] {
  return stagedPathsCommand;
}

export function worktreePathsGitArguments(paths: readonly string[]): readonly string[] {
  return ["diff", "--name-only", "-z", "--", ...paths];
}

export function parseNulDelimitedPaths(output: Uint8Array): readonly string[] {
  let text: string;
  try {
    text = decoder.decode(output);
  } catch {
    throw new Error("Malformed NUL-delimited git path output");
  }
  if (text.length === 0) return [];
  if (!text.endsWith("\0")) throw new Error("Malformed NUL-delimited git path output");
  const paths = text.slice(0, -1).split("\0");
  if (paths.some((path) => path.length === 0)) throw new Error("Malformed NUL-delimited git path output");
  return paths;
}

export function validateStagedRepoPaths(paths: readonly string[]): void {
  for (const stagedPath of paths) {
    if (
      stagedPath.length === 0 ||
      stagedPath.startsWith("-") ||
      stagedPath.includes("\0") ||
      stagedPath.startsWith("/") ||
      stagedPath.startsWith("\\") ||
      stagedPath.split(/[\\/]/u).some((component) => unsafePathComponents.has(component))
    ) {
      throw new Error("Unsafe staged path");
    }
  }
}

export function selectLintPaths(paths: readonly string[]): readonly string[] {
  return paths.filter((path) => {
    const extension = path.split(".").at(-1);
    return extension !== undefined && lintExtensions.has(extension);
  });
}

export function stagedValidatorCommand(
  mode: StagedFileValidationMode,
  paths: readonly string[],
): readonly [string, ...string[]] | undefined {
  const selectedPaths = mode === "lint" ? selectLintPaths(paths) : paths;
  if (selectedPaths.length === 0) return undefined;
  if (mode === "lint") {
    return [
      "node_modules/eslint/bin/eslint.js",
      "--config",
      "eslint.config.js",
      "--max-warnings=0",
      "--",
      ...selectedPaths,
    ];
  }
  return ["node_modules/prettier/bin/prettier.cjs", "--check", "--ignore-unknown", "--", ...paths];
}

export function validatedGitOutput(label: string, observation: RawProcessObservation): Uint8Array {
  assertSuccessfulProcess(observation, `Git ${label} command failed`);
  if (!(observation.stdout instanceof Uint8Array)) throw new Error(`Git ${label} command failed`);
  return new Uint8Array(observation.stdout);
}

export function assertStagedValidatorSuccess(
  mode: StagedFileValidationMode,
  observation: RawProcessObservation,
): void {
  assertSuccessfulProcess(
    observation,
    `${mode === "lint" ? "Lint" : "Format"} staged-file validation failed`,
  );
}

function assertSuccessfulProcess(observation: RawProcessObservation, message: string): void {
  if (observation.error !== undefined || Boolean(observation.signal) || observation.status !== 0) {
    throw new Error(message);
  }
}
