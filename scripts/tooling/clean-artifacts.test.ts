import { execFile } from "node:child_process";
import { expect, test } from "bun:test";
import { access, mkdtemp, mkdir, rmdir, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { assertSafeRelativeArtifactTarget, cleanArtifacts } from "./clean-artifacts.ts";

const runFile = promisify(execFile);

const createGitRepo = async (prefix: string): Promise<string> => {
  const rootDirectory = await mkdtemp(path.join(tmpdir(), prefix));
  await runFile("git", ["init", "--quiet", rootDirectory]);
  return rootDirectory;
};

const isPathPresent = async (target: string): Promise<boolean> => {
  try {
    await access(target);
    return true;
  } catch (error: unknown) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
};

const discardLog = (): void => void 0;

const writeFixtureFile = async (target: string, contents: string): Promise<void> => {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- Temporary fixture path is isolated under the OS temp directory.
  await mkdir(path.dirname(target), { recursive: true });
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- Temporary fixture path is isolated under the OS temp directory.
  await writeFile(target, contents);
};

const runUntrustedDependencyProbe = (rootDirectory: string): Promise<{ readonly stdout: string }> => {
  const cleanerModuleUrl = JSON.stringify(new URL("clean-artifacts.ts", import.meta.url).href);
  const serializedRootDirectory = JSON.stringify(rootDirectory);
  const program = `const { cleanArtifacts } = await import(${cleanerModuleUrl}); await cleanArtifacts({ dependencies: { fileSystem: { lstat: async () => { throw new Error("untrusted injected lstat"); } } }, expectedRepositoryRoot: ${serializedRootDirectory}, log: () => {}, mode: "inspect", rootDirectory: ${serializedRootDirectory} });`;
  return runFile("bun", ["--eval", program]);
};

const cleanFixture = async (
  rootDirectory: string,
  mode: "inspect" | "trusted-cleanup",
  logs: string[],
): Promise<void> =>
  cleanArtifacts({
    expectedRepositoryRoot: rootDirectory,
    mode,
    log: (message) => {
      logs.push(message);
    },
    rootDirectory,
  });

const expectFailure = async (operation: Promise<unknown>, message: string): Promise<void> => {
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

test("inspection reports cleanup-required without deleting allowlisted or user-owned paths", async () => {
  const rootDirectory = await createGitRepo("mm-cleaner-");
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- Temporary fixture path is isolated under the OS temp directory.
  await mkdir(path.join(rootDirectory, "coverage"));
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- Temporary fixture path is isolated under the OS temp directory.
  await writeFile(path.join(rootDirectory, "coverage", "result.txt"), "coverage");
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- Temporary fixture path is isolated under the OS temp directory.
  await writeFile(path.join(rootDirectory, "unknown.txt"), "keep");
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- Temporary fixture path is isolated under the OS temp directory.
  await mkdir(path.join(rootDirectory, "data", "reports"), { recursive: true });
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- Temporary fixture path is isolated under the OS temp directory.
  await mkdir(path.join(rootDirectory, "state"));
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- Temporary fixture path is isolated under the OS temp directory.
  await mkdir(path.join(rootDirectory, "logs"));
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- Temporary fixture path is isolated under the OS temp directory.
  await mkdir(path.join(rootDirectory, "node_modules"));
  await writeFixtureFile(path.join(rootDirectory, "data", "reports", "keep.txt"), "keep");
  await writeFixtureFile(path.join(rootDirectory, "state", "keep.txt"), "keep");
  await writeFixtureFile(path.join(rootDirectory, "logs", "keep.txt"), "keep");
  await writeFixtureFile(path.join(rootDirectory, "node_modules", "keep.txt"), "keep");
  const logs: string[] = [];
  await expectFailure(cleanFixture(rootDirectory, "inspect", logs), "Cleanup required");
  expect(logs).toContain("cleanup-required coverage");
  expect(await isPathPresent(path.join(rootDirectory, "coverage", "result.txt"))).toBe(true);
  expect(await isPathPresent(path.join(rootDirectory, "unknown.txt"))).toBe(true);
  expect(await isPathPresent(path.join(rootDirectory, "data", "reports", "keep.txt"))).toBe(true);
  expect(await isPathPresent(path.join(rootDirectory, "state", "keep.txt"))).toBe(true);
  expect(await isPathPresent(path.join(rootDirectory, "logs", "keep.txt"))).toBe(true);
  expect(await isPathPresent(path.join(rootDirectory, "node_modules", "keep.txt"))).toBe(true);
});

test("dry-run inspection also fails closed when cleanup is required", async () => {
  const rootDirectory = await createGitRepo("mm-cleaner-dry-run-");
  await writeFixtureFile(path.join(rootDirectory, "coverage", "result.txt"), "coverage");
  const logs: string[] = [];

  await expectFailure(cleanFixture(rootDirectory, "inspect", logs), "Cleanup required");

  expect(logs).toContain("cleanup-required coverage");
  expect(await isPathPresent(path.join(rootDirectory, "coverage", "result.txt"))).toBe(true);
});

test("inspection succeeds idempotently when no allowlisted artifact is present", async () => {
  const rootDirectory = await createGitRepo("mm-cleaner-clean-");
  const logs: string[] = [];

  await cleanFixture(rootDirectory, "inspect", logs);

  expect(logs).toContain("absent coverage");
});

test("inspection mode does not remove artifacts before explicit trusted cleanup", async () => {
  const rootDirectory = await createGitRepo("mm-cleaner-explicit-mode-");
  await writeFixtureFile(path.join(rootDirectory, "coverage", "result.txt"), "coverage");

  await expectFailure(cleanFixture(rootDirectory, "inspect", []), "Cleanup required");
  expect(await isPathPresent(path.join(rootDirectory, "coverage", "result.txt"))).toBe(true);

  await cleanFixture(rootDirectory, "trusted-cleanup", []);
  expect(await isPathPresent(path.join(rootDirectory, "coverage"))).toBe(false);
});

test("caller-provided filesystem dependencies cannot bypass intermediate symbolic-link rejection", async () => {
  const rootDirectory = await createGitRepo("mm-cleaner-untrusted-dependency-");
  const outsideDirectory = await mkdtemp(path.join(tmpdir(), "mm-cleaner-untrusted-outside-"));
  await writeFixtureFile(path.join(outsideDirectory, "backtest", "dist", "result.txt"), "coverage");
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- The symlink fixture is isolated under the OS temp directory.
  await symlink(outsideDirectory, path.join(rootDirectory, "packages"));

  await expectFailure(
    runUntrustedDependencyProbe(rootDirectory),
    "Refusing symbolic link component for packages/backtest/dist",
  );
  expect(await isPathPresent(path.join(outsideDirectory, "backtest", "dist", "result.txt"))).toBe(true);
});

test("relative artifact target safety guard rejects root, parent, and absolute paths", () => {
  expect(() => {
    assertSafeRelativeArtifactTarget("coverage", "coverage");
  }).not.toThrow();
  expect(() => {
    assertSafeRelativeArtifactTarget("coverage", "");
  }).toThrow("Unsafe artifact target: coverage");
  expect(() => {
    assertSafeRelativeArtifactTarget("coverage", "../outside");
  }).toThrow("Unsafe artifact target: coverage");
  expect(() => {
    assertSafeRelativeArtifactTarget("coverage", "/outside");
  }).toThrow("Unsafe artifact target: coverage");
});

test("inspection preserves an ENOTDIR metadata error from a real temporary fixture", async () => {
  const rootDirectory = await createGitRepo("mm-cleaner-enotdir-");
  await writeFixtureFile(path.join(rootDirectory, "packages", "backtest"), "not a directory");

  await expectFailure(cleanFixture(rootDirectory, "inspect", []), "ENOTDIR");
});

test("cleaner rejects non-Git and nested invocation roots", async () => {
  const nonGitRoot = await mkdtemp(path.join(tmpdir(), "mm-cleaner-non-git-"));
  await expectFailure(cleanFixture(nonGitRoot, "inspect", []), "Cleaner root must be a Git worktree");

  const rootDirectory = await createGitRepo("mm-cleaner-nested-");
  const nestedDirectory = path.join(rootDirectory, "nested");
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- Temporary fixture path is isolated under the OS temp directory.
  await mkdir(nestedDirectory);
  await expectFailure(
    cleanArtifacts({
      expectedRepositoryRoot: rootDirectory,
      mode: "inspect",
      log: discardLog,
      rootDirectory: nestedDirectory,
    }),
    "Cleaner root must be the expected Git top-level directory",
  );

  await expectFailure(
    cleanArtifacts({
      expectedRepositoryRoot: nestedDirectory,
      mode: "inspect",
      log: discardLog,
      rootDirectory: nestedDirectory,
    }),
    "Cleaner root must be the expected Git top-level directory",
  );

  const fileRoot = path.join(rootDirectory, "not-a-directory");
  await writeFixtureFile(fileRoot, "not a directory");
  await expectFailure(
    cleanArtifacts({
      expectedRepositoryRoot: fileRoot,
      mode: "inspect",
      log: discardLog,
      rootDirectory: fileRoot,
    }),
    "Cleaner root must be a directory",
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
    cleanFixture(rootDirectory, "trusted-cleanup", []),
    "Refusing symbolic link component for coverage",
  );
  expect(await isPathPresent(path.join(outsideDirectory, "keep.txt"))).toBe(true);

  const intermediateRoot = await createGitRepo("mm-cleaner-intermediate-");
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- Temporary fixture path is isolated under the OS temp directory.
  await symlink(outsideDirectory, path.join(intermediateRoot, "packages"));
  await expectFailure(
    cleanFixture(intermediateRoot, "trusted-cleanup", []),
    "Refusing symbolic link component for packages/backtest/dist",
  );
  expect(await isPathPresent(path.join(outsideDirectory, "keep.txt"))).toBe(true);
});

test("trusted cleanup deletes only allowlisted directories and is idempotent", async () => {
  const rootDirectory = await createGitRepo("mm-cleaner-idempotent-");
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- Temporary fixture path is isolated under the OS temp directory.
  await mkdir(path.join(rootDirectory, "coverage"));
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- Temporary fixture path is isolated under the OS temp directory.
  await writeFile(path.join(rootDirectory, "coverage", "result.txt"), "coverage");
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- Temporary fixture path is isolated under the OS temp directory.
  await writeFile(path.join(rootDirectory, "unknown.txt"), "keep");
  const firstRunLogs: string[] = [];
  await cleanFixture(rootDirectory, "trusted-cleanup", firstRunLogs);
  const secondRunLogs: string[] = [];
  await cleanFixture(rootDirectory, "trusted-cleanup", secondRunLogs);

  expect(firstRunLogs).toContain(
    "trusted-cleanup cooperative exclusive maintenance only; same-privilege malicious concurrent mutation is not prevented",
  );
  expect(firstRunLogs).toContain("remove coverage");
  expect(secondRunLogs).toContain("absent coverage");
  expect(await isPathPresent(path.join(rootDirectory, "coverage"))).toBe(false);
  expect(await isPathPresent(path.join(rootDirectory, "unknown.txt"))).toBe(true);
});

test("trusted cleanup rejects a cooperative lock collision without deleting artifacts", async () => {
  const rootDirectory = await createGitRepo("mm-cleaner-lock-");
  await writeFixtureFile(path.join(rootDirectory, "coverage", "result.txt"), "coverage");
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- Temporary fixture path is isolated under the OS temp directory.
  await mkdir(path.join(rootDirectory, ".clean-artifacts.trusted.lock"));

  await expectFailure(cleanFixture(rootDirectory, "trusted-cleanup", []), "EEXIST");

  expect(await isPathPresent(path.join(rootDirectory, "coverage", "result.txt"))).toBe(true);
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- Temporary fixture path is isolated under the OS temp directory.
  await rmdir(path.join(rootDirectory, ".clean-artifacts.trusted.lock"));
});

test("trusted cleanup releases its lock after a validation failure", async () => {
  const rootDirectory = await createGitRepo("mm-cleaner-lock-release-");
  await writeFixtureFile(path.join(rootDirectory, "coverage"), "not a directory");

  await expectFailure(
    cleanFixture(rootDirectory, "trusted-cleanup", []),
    "Refusing non-directory artifact target: coverage",
  );

  expect(await isPathPresent(path.join(rootDirectory, ".clean-artifacts.trusted.lock"))).toBe(false);
  expect(await isPathPresent(path.join(rootDirectory, "coverage"))).toBe(true);
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- Temporary fixture path is isolated under the OS temp directory.
  await unlink(path.join(rootDirectory, "coverage"));
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- Temporary fixture path is isolated under the OS temp directory.
  await mkdir(path.join(rootDirectory, "coverage"));
  await cleanFixture(rootDirectory, "trusted-cleanup", []);
  expect(await isPathPresent(path.join(rootDirectory, "coverage"))).toBe(false);
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
    await writeFixtureFile(path.join(rootDirectory, coverageDirectory, "result.txt"), coverageDirectory);
  }
  await writeFixtureFile(path.join(rootDirectory, "unknown.txt"), "keep");

  const dryRunLogs: string[] = [];
  await expectFailure(cleanFixture(rootDirectory, "inspect", dryRunLogs), "Cleanup required");
  for (const coverageDirectory of coverageDirectories) {
    expect(dryRunLogs).toContain(`cleanup-required ${coverageDirectory}`);
    expect(await isPathPresent(path.join(rootDirectory, coverageDirectory, "result.txt"))).toBe(true);
  }

  const removalLogs: string[] = [];
  await cleanFixture(rootDirectory, "trusted-cleanup", removalLogs);
  const absenceLogs: string[] = [];
  await cleanFixture(rootDirectory, "trusted-cleanup", absenceLogs);
  for (const coverageDirectory of coverageDirectories) {
    expect(removalLogs).toContain(`remove ${coverageDirectory}`);
    expect(absenceLogs).toContain(`absent ${coverageDirectory}`);
    expect(await isPathPresent(path.join(rootDirectory, coverageDirectory))).toBe(false);
  }
  expect(await isPathPresent(path.join(rootDirectory, "unknown.txt"))).toBe(true);
});
