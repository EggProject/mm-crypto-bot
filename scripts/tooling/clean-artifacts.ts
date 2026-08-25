import { lstat, realpath, rm } from "node:fs/promises";
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

export type CleanerLog = (message: string) => void;

export interface CleanerOptions {
  readonly expectedRepositoryRoot: string;
  readonly isDryRun: boolean;
  readonly log: CleanerLog;
  readonly rootDirectory: string;
}

export async function cleanArtifacts(options: CleanerOptions): Promise<void> {
  const root = await resolveVerifiedRepoRoot(options);
  for (const artifactPath of artifactPaths) {
    const target = await resolveSafeArtifactTarget(root, artifactPath);
    const metadata = await readTargetMetadata(target, artifactPath, options.log);
    if (metadata === undefined) {
      continue;
    }
    if (!metadata.isDirectory()) {
      throw new Error(`Refusing non-directory artifact target: ${artifactPath}`);
    }
    options.log(`${options.isDryRun ? "would-remove" : "remove"} ${artifactPath}`);
    if (!options.isDryRun) {
      await rm(target, { force: true, recursive: true });
    }
  }
}

async function resolveVerifiedRepoRoot(options: CleanerOptions): Promise<string> {
  const requestedRoot = path.resolve(options.rootDirectory);
  const expectedRoot = path.resolve(options.expectedRepositoryRoot);
  await assertNoSymlinkedComponents(requestedRoot, "repository root");
  await assertNoSymlinkedComponents(expectedRoot, "expected repository root");
  const [actualRoot, expectedRealRoot, gitRoot] = await Promise.all([
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- Path values are canonicalized then rejected if symlinked before I/O.
    realpath(requestedRoot),
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- Path values are canonicalized then rejected if symlinked before I/O.
    realpath(expectedRoot),
    getGitTopLevel(requestedRoot),
  ]);
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- Git emits the verified top-level path for the checked worktree.
  const actualGitRoot = await realpath(gitRoot);
  if (actualRoot !== expectedRealRoot || actualRoot !== actualGitRoot) {
    throw new Error("Cleaner root must be the expected Git top-level directory");
  }
  return actualRoot;
}

async function getGitTopLevel(directory: string): Promise<string> {
  const result = Bun.spawn({
    cmd: ["git", "-C", directory, "rev-parse", "--show-toplevel"],
    stderr: "pipe",
    stdout: "pipe",
  });
  if ((await result.exited) !== 0) {
    throw new Error("Cleaner root must be a Git worktree");
  }
  const output = await new Response(result.stdout).text();
  return output.trim();
}

async function resolveSafeArtifactTarget(root: string, artifactPath: string): Promise<string> {
  const target = path.resolve(root, artifactPath);
  const relativeTarget = path.relative(root, target);
  if (relativeTarget === "" || relativeTarget.startsWith("..") || path.isAbsolute(relativeTarget)) {
    throw new Error(`Unsafe artifact target: ${artifactPath}`);
  }
  await assertNoSymlinkedComponents(target, artifactPath);
  return target;
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
      if (isMissingPath(error)) {
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
): Promise<Awaited<ReturnType<typeof lstat>> | undefined> {
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

if (import.meta.main) {
  const repoRoot = new URL("../../", import.meta.url).pathname;
  await cleanArtifacts({
    expectedRepositoryRoot: repoRoot,
    isDryRun: process.argv.includes("--dry-run"),
    log: (message) => process.stdout.write(`${message}\n`),
    rootDirectory: process.cwd(),
  });
}
