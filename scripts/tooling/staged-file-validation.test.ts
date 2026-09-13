import { expect, test } from "vitest";

import {
  assertStagedValidatorSuccess,
  parseNulDelimitedPaths,
  parseStagedFileValidationArguments,
  selectLintPaths,
  stagedPathsGitArguments,
  stagedValidatorCommand,
  validatedGitOutput,
  validateStagedRepoPaths,
  worktreePathsGitArguments,
} from "./staged-file-validation-contract";

const encoder = new TextEncoder();

test("seals mode and git argv", () => {
  expect(parseStagedFileValidationArguments(["--mode=lint"])).toBe("lint");
  expect(parseStagedFileValidationArguments(["--mode=format"])).toBe("format");
  for (const arguments_ of [[], ["--mode=unknown"], [42], ["--mode=lint", "x"]]) {
    expect(() => parseStagedFileValidationArguments(arguments_)).toThrow(
      "invalid staged-file validation arguments",
    );
  }
  expect(stagedPathsGitArguments()).toEqual([
    "diff",
    "--cached",
    "--name-only",
    "-z",
    "--no-renames",
    "--diff-filter=ACMR",
    "--",
  ]);
  expect(worktreePathsGitArguments(["a.ts"])).toEqual(["diff", "--name-only", "-z", "--", "a.ts"]);
});

test("classifies raw Git and validator outcomes without a process fake", () => {
  const output = encoder.encode("path.ts\0");
  expect(
    validatedGitOutput("staged-path", { error: undefined, signal: undefined, status: 0, stdout: output }),
  ).toEqual(output);
  const failedObservations = [
    { error: new Error("ENOENT"), signal: undefined, status: undefined, stdout: undefined },
    { error: undefined, signal: "SIGTERM", status: undefined, stdout: undefined },
    { error: undefined, signal: undefined, status: 1, stdout: undefined },
  ];
  for (const observation of failedObservations) {
    expect(() => validatedGitOutput("staged-path", observation)).toThrow("Git staged-path command failed");
    expect(() => {
      assertStagedValidatorSuccess("format", observation);
    }).toThrow("Format staged-file validation failed");
  }
  expect(() =>
    validatedGitOutput("staged-path", { error: undefined, signal: undefined, status: 0, stdout: "wrong" }),
  ).toThrow("Git staged-path command failed");
  expect(() => {
    assertStagedValidatorSuccess("lint", {
      error: undefined,
      signal: undefined,
      status: 0,
      stdout: undefined,
    });
  }).not.toThrow();
});

test("parses NUL output and rejects every malformed form", () => {
  expect(parseNulDelimitedPaths(encoder.encode(""))).toEqual([]);
  expect(parseNulDelimitedPaths(encoder.encode("a.ts\0b.md\0"))).toEqual(["a.ts", "b.md"]);
  for (const output of [
    new Uint8Array([255]),
    encoder.encode("missing.ts"),
    encoder.encode("\0"),
    encoder.encode("a.ts\0\0"),
  ]) {
    expect(() => parseNulDelimitedPaths(output)).toThrow("Malformed NUL-delimited git path output");
  }
});

test("rejects unsafe paths and maps only exact validator argv", () => {
  for (const path of [
    "",
    "-option.ts",
    "inside\0name.ts",
    "/absolute.ts",
    String.raw`\absolute.ts`,
    "dir/../escape.ts",
    "dir//empty.ts",
    String.raw`dir\.\file.ts`,
  ]) {
    expect(() => {
      validateStagedRepoPaths([path]);
    }).toThrow("Unsafe staged path");
  }
  expect(() => {
    validateStagedRepoPaths(["safe/path.ts"]);
  }).not.toThrow();
  expect(selectLintPaths(["src/file.ts", "module.mts", "guide.md", "README"])).toEqual([
    "src/file.ts",
    "module.mts",
  ]);
  expect(stagedValidatorCommand("lint", ["guide.md"])).toBeUndefined();
  expect(stagedValidatorCommand("format", [])).toBeUndefined();
  expect(stagedValidatorCommand("lint", ["src/file.ts"])).toEqual([
    "node_modules/eslint/bin/eslint.js",
    "--config",
    "eslint.config.js",
    "--max-warnings=0",
    "--",
    "src/file.ts",
  ]);
  expect(stagedValidatorCommand("format", ["guide.md"])).toEqual([
    "node_modules/prettier/bin/prettier.cjs",
    "--check",
    "--ignore-unknown",
    "--",
    "guide.md",
  ]);
});
