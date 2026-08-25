import { expect, test } from "bun:test";
import { mkdtemp, mkdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { cleanArtifacts } from "./clean-artifacts.ts";

const createGitRepo = async (prefix: string): Promise<string> => {
  const rootDirectory = await mkdtemp(path.join(tmpdir(), prefix));
  const processResult = Bun.spawn({ cmd: ["git", "init", "--quiet", rootDirectory] });
  expect(await processResult.exited).toBe(0);
  return rootDirectory;
};

const cleanFixture = async (rootDirectory: string, isDryRun: boolean, logs: string[]): Promise<void> =>
  cleanArtifacts({
    expectedRepositoryRoot: rootDirectory,
    isDryRun,
    log: (message) => {
      logs.push(message);
    },
    rootDirectory,
  });

const expectFailure = async (operation: Promise<void>, message: string): Promise<void> => {
  try {
    await operation;
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(Error);
    if (error instanceof Error) {
      expect(error.message).toContain(message);
    }
    return;
  }
  throw new Error(`Expected failure: ${message}`);
};

test("cleaner is dry-run safe and allowlist-only", async () => {
  const rootDirectory = await createGitRepo("mm-cleaner-");
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- Temporary fixture path is isolated under the OS temp directory.
  await mkdir(path.join(rootDirectory, "coverage"));
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- Temporary fixture path is isolated under the OS temp directory.
  await writeFile(path.join(rootDirectory, "coverage", "result.txt"), "coverage");
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- Temporary fixture path is isolated under the OS temp directory.
  await writeFile(path.join(rootDirectory, "unknown.txt"), "keep");
  const logs: string[] = [];
  await cleanFixture(rootDirectory, true, logs);
  expect(logs).toContain("would-remove coverage");
  expect(await Bun.file(path.join(rootDirectory, "coverage", "result.txt")).exists()).toBe(true);
  expect(await Bun.file(path.join(rootDirectory, "unknown.txt")).exists()).toBe(true);
});

test("cleaner rejects non-Git and nested invocation roots", async () => {
  const nonGitRoot = await mkdtemp(path.join(tmpdir(), "mm-cleaner-non-git-"));
  await expectFailure(cleanFixture(nonGitRoot, true, []), "Cleaner root must be a Git worktree");

  const rootDirectory = await createGitRepo("mm-cleaner-nested-");
  const nestedDirectory = path.join(rootDirectory, "nested");
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- Temporary fixture path is isolated under the OS temp directory.
  await mkdir(nestedDirectory);
  await expectFailure(
    cleanArtifacts({
      expectedRepositoryRoot: rootDirectory,
      isDryRun: true,
      log: () => {
        // This negative test does not require log assertions.
      },
      rootDirectory: nestedDirectory,
    }),
    "Cleaner root must be the expected Git top-level directory",
  );
});

test("cleaner rejects final and intermediate symbolic-link paths", async () => {
  const rootDirectory = await createGitRepo("mm-cleaner-link-");
  const outsideDirectory = await mkdtemp(path.join(tmpdir(), "mm-cleaner-outside-"));
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- Temporary fixture path is isolated under the OS temp directory.
  await writeFile(path.join(outsideDirectory, "keep.txt"), "keep");
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- Temporary fixture path is isolated under the OS temp directory.
  await symlink(outsideDirectory, path.join(rootDirectory, "coverage"));
  await expectFailure(
    cleanFixture(rootDirectory, false, []),
    "Refusing symbolic link component for coverage",
  );
  expect(await Bun.file(path.join(outsideDirectory, "keep.txt")).exists()).toBe(true);

  const intermediateRoot = await createGitRepo("mm-cleaner-intermediate-");
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- Temporary fixture path is isolated under the OS temp directory.
  await symlink(outsideDirectory, path.join(intermediateRoot, "packages"));
  await expectFailure(
    cleanFixture(intermediateRoot, false, []),
    "Refusing symbolic link component for packages/backtest/dist",
  );
  expect(await Bun.file(path.join(outsideDirectory, "keep.txt")).exists()).toBe(true);
});

test("cleaner removes only allowlisted fixtures and is idempotent", async () => {
  const rootDirectory = await createGitRepo("mm-cleaner-idempotent-");
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- Temporary fixture path is isolated under the OS temp directory.
  await mkdir(path.join(rootDirectory, "coverage"));
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- Temporary fixture path is isolated under the OS temp directory.
  await writeFile(path.join(rootDirectory, "coverage", "result.txt"), "coverage");
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- Temporary fixture path is isolated under the OS temp directory.
  await writeFile(path.join(rootDirectory, "unknown.txt"), "keep");
  const firstRunLogs: string[] = [];
  await cleanFixture(rootDirectory, false, firstRunLogs);
  const secondRunLogs: string[] = [];
  await cleanFixture(rootDirectory, false, secondRunLogs);

  expect(firstRunLogs).toContain("remove coverage");
  expect(secondRunLogs).toContain("absent coverage");
  expect(await Bun.file(path.join(rootDirectory, "coverage")).exists()).toBe(false);
  expect(await Bun.file(path.join(rootDirectory, "unknown.txt")).exists()).toBe(true);
});

test("cleaner handles every foundation coverage directory without removing unknown content", async () => {
  const rootDirectory = await createGitRepo("mm-cleaner-foundation-");
  const coverageDirectories = [
    "packages/typing/coverage",
    "packages/typeguard/coverage",
    "packages/assert/coverage",
    "packages/numeric/coverage",
    "packages/logging/coverage",
  ] as const;
  for (const coverageDirectory of coverageDirectories) {
    await Bun.write(path.join(rootDirectory, coverageDirectory, "result.txt"), coverageDirectory);
  }
  await Bun.write(path.join(rootDirectory, "unknown.txt"), "keep");

  const dryRunLogs: string[] = [];
  await cleanFixture(rootDirectory, true, dryRunLogs);
  for (const coverageDirectory of coverageDirectories) {
    expect(dryRunLogs).toContain(`would-remove ${coverageDirectory}`);
    expect(await Bun.file(path.join(rootDirectory, coverageDirectory, "result.txt")).exists()).toBe(true);
  }

  const removalLogs: string[] = [];
  await cleanFixture(rootDirectory, false, removalLogs);
  const absenceLogs: string[] = [];
  await cleanFixture(rootDirectory, false, absenceLogs);
  for (const coverageDirectory of coverageDirectories) {
    expect(removalLogs).toContain(`remove ${coverageDirectory}`);
    expect(absenceLogs).toContain(`absent ${coverageDirectory}`);
    expect(await Bun.file(path.join(rootDirectory, coverageDirectory)).exists()).toBe(false);
  }
  expect(await Bun.file(path.join(rootDirectory, "unknown.txt")).exists()).toBe(true);
});
