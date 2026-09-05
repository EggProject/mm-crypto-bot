import { expect, test } from "bun:test";
import {
  createBunGitCommandRunner,
  createBunProcessCommandRunner,
  parseNulDelimitedPaths,
  runStagedFileValidation,
  selectLintPaths,
  type GitCommandResult,
  type StagedFileValidationDependencies,
} from "./staged-file-validation.ts";

const encoder = new TextEncoder();

const successfulGitResult = (paths: readonly string[]): GitCommandResult => ({
  exitCode: 0,
  stdout: encoder.encode(paths.length === 0 ? "" : `${paths.join("\0")}\0`),
});

const createDependencies = (
  gitResults: readonly GitCommandResult[],
  processExitCode = 0,
): {
  readonly dependencies: StagedFileValidationDependencies;
  readonly gitCalls: string[][];
  readonly processCalls: string[][];
} => {
  const gitCalls: string[][] = [];
  const processCalls: string[][] = [];
  let nextGitResult = 0;

  return {
    dependencies: {
      runGit: (arguments_) => {
        gitCalls.push([...arguments_]);
        const result = gitResults.at(nextGitResult);
        nextGitResult += 1;
        if (result === undefined) {
          throw new Error("Unexpected git command");
        }
        return Promise.resolve(result);
      },
      runProcess: (command) => {
        processCalls.push([...command]);
        return Promise.resolve({ exitCode: processExitCode });
      },
    },
    gitCalls,
    processCalls,
  };
};

const createRejectingDependencies = (): StagedFileValidationDependencies => ({
  runGit: (arguments_) =>
    Promise.resolve(successfulGitResult(arguments_.includes("--cached") ? ["scripts/staged.ts"] : [])),
  runProcess: () => Promise.reject(new Error("validator process unavailable")),
});

const expectRejectionMessage = async (action: () => Promise<void>, message: string): Promise<void> => {
  let actualError: unknown;
  try {
    await action();
  } catch (error: unknown) {
    actualError = error;
  }

  expect(actualError).toBeInstanceOf(Error);
  if (!(actualError instanceof Error)) {
    throw new Error("Expected staged-file validation to reject with Error");
  }
  expect(actualError.message).toBe(message);
};

test("parses NUL-delimited staged paths including spaces", () => {
  expect(parseNulDelimitedPaths(encoder.encode("src/with space.ts\0docs/readme.md\0"))).toEqual([
    "src/with space.ts",
    "docs/readme.md",
  ]);
});

test("rejects malformed NUL-delimited staged paths", () => {
  expect(() => parseNulDelimitedPaths(encoder.encode("src/missing-terminator.ts"))).toThrow(
    "Malformed NUL-delimited git path output",
  );
});

test("rejects invalid UTF-8 and empty paths in git output", () => {
  expect(() => parseNulDelimitedPaths(new Uint8Array([255]))).toThrow(
    "Malformed NUL-delimited git path output",
  );
  expect(() => parseNulDelimitedPaths(encoder.encode("\0"))).toThrow(
    "Malformed NUL-delimited git path output",
  );
});

test("selects only lint-supported extensions", () => {
  expect(
    selectLintPaths([
      "scripts/run.ts",
      "packages/module.mts",
      "web/component.tsx",
      "config/tool.cjs",
      "docs/guide.md",
      "assets/icon.svg",
      "README",
    ]),
  ).toEqual(["scripts/run.ts", "packages/module.mts", "web/component.tsx", "config/tool.cjs"]);
});

test("lint validates A/C/M and rename destinations while excluding deleted sources", async () => {
  const { dependencies, gitCalls, processCalls } = createDependencies([
    successfulGitResult([
      "added.ts",
      "copied.ts",
      "modified.ts",
      "renamed destination.ts",
      "--option-like.ts",
    ]),
    successfulGitResult([]),
  ]);

  await runStagedFileValidation("lint", dependencies);

  expect(gitCalls).toEqual([
    ["diff", "--cached", "--name-only", "-z", "--no-renames", "--diff-filter=ACMR", "--"],
    [
      "diff",
      "--name-only",
      "-z",
      "--",
      "added.ts",
      "copied.ts",
      "modified.ts",
      "renamed destination.ts",
      "--option-like.ts",
    ],
  ]);
  expect(processCalls).toEqual([
    [
      "eslint",
      "--config",
      "eslint.config.js",
      "--max-warnings=0",
      "--",
      "added.ts",
      "copied.ts",
      "modified.ts",
      "renamed destination.ts",
      "--option-like.ts",
    ],
  ]);
});

test("validates a staged added file but never receives wholly untracked paths from git", async () => {
  const { dependencies, processCalls } = createDependencies([
    successfulGitResult(["staged-added.ts"]),
    successfulGitResult([]),
  ]);

  await runStagedFileValidation("lint", dependencies);

  expect(processCalls).toEqual([
    ["eslint", "--config", "eslint.config.js", "--max-warnings=0", "--", "staged-added.ts"],
  ]);
  expect(processCalls.flat()).not.toContain("wholly-untracked.ts");
});

test("succeeds without running a validator when no staged candidates exist", async () => {
  const { dependencies, gitCalls, processCalls } = createDependencies([successfulGitResult([])]);

  await runStagedFileValidation("lint", dependencies);

  expect(gitCalls).toEqual([
    ["diff", "--cached", "--name-only", "-z", "--no-renames", "--diff-filter=ACMR", "--"],
  ]);
  expect(processCalls).toEqual([]);
});

test("format validates every staged candidate with exact direct argv", async () => {
  const { dependencies, processCalls } = createDependencies([
    successfulGitResult(["docs/with space.md", "package.json", "assets/logo.svg"]),
    successfulGitResult([]),
  ]);

  await runStagedFileValidation("format", dependencies);

  expect(processCalls).toEqual([
    [
      "prettier",
      "--check",
      "--ignore-unknown",
      "--",
      "docs/with space.md",
      "package.json",
      "assets/logo.svg",
    ],
  ]);
});

test("fails closed when git cannot list staged paths", async () => {
  const { dependencies } = createDependencies([{ exitCode: 2, stdout: encoder.encode("") }]);

  await expectRejectionMessage(
    () => runStagedFileValidation("lint", dependencies),
    "Git staged-path command failed with exit code 2",
  );
});

test("fails closed when the git runner rejects", async () => {
  const dependencies: StagedFileValidationDependencies = {
    runGit: () => Promise.reject(new Error("git process unavailable")),
    runProcess: () => Promise.resolve({ exitCode: 0 }),
  };

  await expectRejectionMessage(
    () => runStagedFileValidation("lint", dependencies),
    "Git staged-path command failed to run: Error: git process unavailable",
  );
});

test("fails closed when the worktree differs from the staged bytes", async () => {
  const { dependencies, processCalls } = createDependencies([
    successfulGitResult(["scripts/staged.ts"]),
    successfulGitResult(["scripts/staged.ts"]),
  ]);

  await expectRejectionMessage(
    () => runStagedFileValidation("lint", dependencies),
    "Staged paths also differ in the worktree: scripts/staged.ts",
  );
  expect(processCalls).toEqual([]);
});

test("fails closed when the worktree comparison git command fails", async () => {
  const { dependencies } = createDependencies([
    successfulGitResult(["scripts/staged.ts"]),
    { exitCode: 3, stdout: encoder.encode("") },
  ]);

  await expectRejectionMessage(
    () => runStagedFileValidation("lint", dependencies),
    "Git worktree comparison command failed with exit code 3",
  );
});

test("fails closed when the selected validator fails", async () => {
  const { dependencies } = createDependencies(
    [successfulGitResult(["scripts/staged.ts"]), successfulGitResult([])],
    4,
  );

  await expectRejectionMessage(
    () => runStagedFileValidation("lint", dependencies),
    "Lint staged-file validation failed with exit code 4",
  );
});

test("skips lint when staged candidates have no lint-supported extension", async () => {
  const { dependencies, processCalls } = createDependencies([
    successfulGitResult(["docs/guide.md"]),
    successfulGitResult([]),
  ]);

  await runStagedFileValidation("lint", dependencies);

  expect(processCalls).toEqual([]);
});

test("fails closed when the format validator returns a nonzero exit code", async () => {
  const { dependencies } = createDependencies(
    [successfulGitResult(["docs/guide.md"]), successfulGitResult([])],
    5,
  );

  await expectRejectionMessage(
    () => runStagedFileValidation("format", dependencies),
    "Format staged-file validation failed with exit code 5",
  );
});

test("fails closed when either selected validator runner rejects", async () => {
  await expectRejectionMessage(
    () => runStagedFileValidation("lint", createRejectingDependencies()),
    "Lint staged-file validation failed to run: Error: validator process unavailable",
  );
  await expectRejectionMessage(
    () => runStagedFileValidation("format", createRejectingDependencies()),
    "Format staged-file validation failed to run: Error: validator process unavailable",
  );
});

test("Bun git runner preserves direct argv and reads NUL output", async () => {
  const options: { readonly cmd: readonly string[]; readonly stderr: string; readonly stdout: string }[] = [];
  const runGit = createBunGitCommandRunner((commandOptions) => {
    options.push(commandOptions);
    return {
      exited: Promise.resolve(0),
      stdout: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode("staged.ts\0"));
          controller.close();
        },
      }),
    };
  });

  expect(await runGit(["diff", "--cached"])).toEqual(successfulGitResult(["staged.ts"]));
  expect(options).toEqual([{ cmd: ["git", "diff", "--cached"], stderr: "inherit", stdout: "pipe" }]);
});

test("Bun process runner preserves direct argv and child exit code", async () => {
  const options: { readonly cmd: readonly string[]; readonly stderr: string; readonly stdout: string }[] = [];
  const runProcess = createBunProcessCommandRunner((commandOptions) => {
    options.push(commandOptions);
    return { exited: Promise.resolve(8) };
  });

  const result = await runProcess(["eslint", "--", "--option-like.ts"]);
  expect(result).toEqual({ exitCode: 8 });
  expect(options).toEqual([
    { cmd: ["eslint", "--", "--option-like.ts"], stderr: "inherit", stdout: "inherit" },
  ]);
});
