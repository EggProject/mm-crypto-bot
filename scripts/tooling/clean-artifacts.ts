import { execFile } from "node:child_process";
import { lstat, mkdir, realpath, rm, rmdir } from "node:fs/promises";
import type { Stats } from "node:fs";
import { promisify } from "node:util";
import path from "node:path";

const artifactPaths = [
  ".turbo",
  "coverage",
  "apps/bot/dist",
  "apps/bot/coverage",
  "packages/backtest/dist",
  "packages/backtest/coverage",
  "packages/backtest-tools/dist",
  "packages/backtest-tools/coverage",
  "packages/core/dist",
  "packages/core/coverage",
  "packages/exchange/dist",
  "packages/exchange/coverage",
  "packages/paper/dist",
  "packages/paper/coverage",
  "packages/shared/dist",
  "packages/shared/coverage",
  "packages/typing/coverage",
  "packages/typeguard/coverage",
  "packages/assert/coverage",
  "packages/numeric/coverage",
  "packages/logging/coverage",
] as const;

const trustedCleanupLockName = ".clean-artifacts.trusted.lock";
const runFile = promisify(execFile);

export const trustedCleanupThreatModel =
  "trusted-cleanup cooperative exclusive maintenance only; same-privilege malicious concurrent mutation is not prevented";

export type CleanerLog = (message: string) => void;
export type CleanerMode = "inspect" | "trusted-cleanup";

export interface CleanerOptions {
  readonly expectedRepositoryRoot: string;
  readonly log: CleanerLog;
  readonly mode: CleanerMode;
  readonly rootDirectory: string;
}

export async function cleanArtifacts(options: CleanerOptions): Promise<void> {
  const root = await resolveVerifiedRepoRoot(options);
  if (options.mode === "trusted-cleanup") {
    options.log(trustedCleanupThreatModel);
    await cleanTrustedArtifacts(root, options.log);
    return;
  }

  await inspectArtifacts(root, options.log);
}

async function inspectArtifacts(root: string, log: CleanerLog): Promise<void> {
  let isCleanupRequired = false;
  for (const artifactPath of artifactPaths) {
    const target = await resolveSafeArtifactTarget(root, artifactPath);
    const metadata = await readTargetMetadata(target, artifactPath, log);
    if (metadata === undefined) {
      continue;
    }
    assertArtifactDirectory(metadata, artifactPath);
    isCleanupRequired = true;
    log(`cleanup-required ${artifactPath}`);
  }
  if (isCleanupRequired) {
    throw new Error(
      "Cleanup required for allowlisted artifacts; run clean:artifacts:trusted in a trusted exclusive worktree",
    );
  }
}

async function cleanTrustedArtifacts(root: string, log: CleanerLog): Promise<void> {
  const lockPath = path.join(root, trustedCleanupLockName);
  await acquireTrustedCleanupLock(lockPath);
  try {
    for (const artifactPath of artifactPaths) {
      const target = await resolveSafeArtifactTarget(root, artifactPath);
      const metadata = await readTargetMetadata(target, artifactPath, log);
      if (metadata === undefined) {
        continue;
      }
      assertArtifactDirectory(metadata, artifactPath);
      await revalidateTrustedDeletionTarget(root, artifactPath, target);
      await rm(target, { force: false, recursive: true });
      log(`remove ${artifactPath}`);
    }
  } finally {
    await releaseTrustedCleanupLock(lockPath);
  }
}

async function acquireTrustedCleanupLock(lockPath: string): Promise<void> {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- The lock path is an exact fixed child of the verified Git root.
  await mkdir(lockPath);
}

async function releaseTrustedCleanupLock(lockPath: string): Promise<void> {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- The lock path is the exact directory atomically created by this invocation.
  await rmdir(lockPath);
}

async function revalidateTrustedDeletionTarget(
  root: string,
  artifactPath: string,
  target: string,
): Promise<void> {
  await assertVerifiedGitRoot(root);
  await assertNoSymlinkedComponents(target, artifactPath);
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- Target is an allowlisted descendant revalidated immediately before removal.
  const metadata = await lstat(target);
  assertArtifactDirectory(metadata, artifactPath);
}

function assertArtifactDirectory(metadata: Stats, artifactPath: string): void {
  if (!metadata.isDirectory()) {
    throw new Error(`Refusing non-directory artifact target: ${artifactPath}`);
  }
}

async function resolveVerifiedRepoRoot(options: CleanerOptions): Promise<string> {
  const requestedRoot = path.resolve(options.rootDirectory);
  const expectedRoot = path.resolve(options.expectedRepositoryRoot);
  await assertNoSymlinkedComponents(requestedRoot, "repository root");
  await assertNoSymlinkedComponents(expectedRoot, "expected repository root");
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- Both roots are canonicalized only after symlink-component rejection.
  const [actualRoot, expectedRealRoot] = await Promise.all([realpath(requestedRoot), realpath(expectedRoot)]);
  if (actualRoot !== expectedRealRoot) {
    throw new Error("Cleaner root must be the expected Git top-level directory");
  }
  await assertVerifiedGitRoot(actualRoot);
  return actualRoot;
}

async function assertVerifiedGitRoot(root: string): Promise<void> {
  await assertNoSymlinkedComponents(root, "repository root");
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- The root was resolved and symlink-checked before its directory type is verified.
  const rootMetadata = await lstat(root);
  if (!rootMetadata.isDirectory()) {
    throw new Error("Cleaner root must be a directory");
  }
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- The root was resolved and symlink-checked before final identity validation.
  const [actualRoot, gitRoot] = await Promise.all([realpath(root), getGitTopLevel(root)]);
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- Git emits the verified top-level path for the checked worktree.
  const actualGitRoot = await realpath(gitRoot);
  if (actualRoot !== actualGitRoot) {
    throw new Error("Cleaner root must be the expected Git top-level directory");
  }
}

async function getGitTopLevel(directory: string): Promise<string> {
  try {
    const { stdout } = await runFile("git", ["-C", directory, "rev-parse", "--show-toplevel"]);
    return stdout.trim();
  } catch {
    throw new Error("Cleaner root must be a Git worktree");
  }
}

async function resolveSafeArtifactTarget(root: string, artifactPath: string): Promise<string> {
  const target = path.resolve(root, artifactPath);
  const relativeTarget = path.relative(root, target);
  assertSafeRelativeArtifactTarget(artifactPath, relativeTarget);
  await assertNoSymlinkedComponents(target, artifactPath);
  return target;
}

export function assertSafeRelativeArtifactTarget(artifactPath: string, relativeTarget: string): void {
  if (relativeTarget !== "" && !relativeTarget.startsWith("..") && !path.isAbsolute(relativeTarget)) {
    return;
  }
  throw new Error(`Unsafe artifact target: ${artifactPath}`);
}

async function assertNoSymlinkedComponents(target: string, label: string): Promise<void> {
  const absoluteTarget = path.resolve(target);
  const parsed = path.parse(absoluteTarget);
  const components = absoluteTarget.slice(parsed.root.length).split(path.sep).filter(Boolean);
  let currentPath = parsed.root;
  for (const component of components) {
    currentPath = path.join(currentPath, component);
    try {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- Each component is inspected solely to reject symlink traversal.
      const metadata = await lstat(currentPath);
      if (metadata.isSymbolicLink()) {
        throw new Error(`Refusing symbolic link component for ${label}: ${currentPath}`);
      }
    } catch (error: unknown) {
      if (isUnresolvablePath(error)) {
        return;
      }
      throw error;
    }
  }
}

async function readTargetMetadata(
  target: string,
  artifactPath: string,
  log: CleanerLog,
): Promise<Stats | undefined> {
  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- Target is an allowlisted descendant verified by resolveSafeArtifactTarget.
    return await lstat(target);
  } catch (error: unknown) {
    if (isMissingPath(error)) {
      log(`absent ${artifactPath}`);
      return undefined;
    }
    throw error;
  }
}

function isMissingPath(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function isUnresolvablePath(error: unknown): boolean {
  return isMissingPath(error) || (error instanceof Error && "code" in error && error.code === "ENOTDIR");
}
