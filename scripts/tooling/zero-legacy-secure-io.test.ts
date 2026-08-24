import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { createZeroLegacySecureIo, zeroLegacyMaximumSourceBytes } from "./zero-legacy-secure-io.ts";

const executeFile = promisify(execFile);

async function withTemporaryRepo(operation: (repoRoot: string) => Promise<void>): Promise<void> {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "zero-legacy-secure-io-"));
  try {
    await operation(repoRoot);
  } finally {
    await rm(repoRoot, { force: true, recursive: true });
  }
}

async function assertRejected(operation: Promise<unknown>): Promise<void> {
  let didReject = false;
  try {
    await operation;
  } catch {
    didReject = true;
  }
  expect(didReject).toBeTrue();
}

test("secure IO accepts the exact source limit and rejects oversized and invalid UTF-8 sources", async () => {
  await withTemporaryRepo(async (repoRoot) => {
    const fileSystem = await import("node:fs/promises");
    const secureIo = createZeroLegacySecureIo();
    const exactPath = path.join(repoRoot, "exact.ts");
    const oversizedPath = path.join(repoRoot, "oversized.ts");
    const invalidPath = path.join(repoRoot, "invalid.ts");
    await fileSystem.writeFile(exactPath, "a".repeat(zeroLegacyMaximumSourceBytes), "utf8");
    await fileSystem.writeFile(oversizedPath, "a".repeat(zeroLegacyMaximumSourceBytes + 1), "utf8");
    await fileSystem.writeFile(invalidPath, Buffer.from([0xc3, 0x28]));

    const exactMetadata = await secureIo.inspectPath(repoRoot, exactPath);
    expect(exactMetadata?.identity).toBeDefined();
    expect(await secureIo.readUtf8(repoRoot, exactPath, exactMetadata?.identity)).toHaveLength(
      zeroLegacyMaximumSourceBytes,
    );
    const oversizedMetadata = await secureIo.inspectPath(repoRoot, oversizedPath);
    await assertRejected(secureIo.readUtf8(repoRoot, oversizedPath, oversizedMetadata?.identity));
    const invalidMetadata = await secureIo.inspectPath(repoRoot, invalidPath);
    await assertRejected(secureIo.readUtf8(repoRoot, invalidPath, invalidMetadata?.identity));
  });
});

test("secure IO fails closed when a target or ancestor identity changes after inspection", async () => {
  await withTemporaryRepo(async (repoRoot) => {
    const fileSystem = await import("node:fs/promises");
    const secureIo = createZeroLegacySecureIo();
    const targetPath = path.join(repoRoot, "target.ts");
    await fileSystem.writeFile(targetPath, "export const oldTarget = 'safe';", "utf8");
    const targetMetadata = await secureIo.inspectPath(repoRoot, targetPath);
    const replacementPath = path.join(repoRoot, "replacement.ts");
    await fileSystem.writeFile(replacementPath, "export const outsideContent = 'rejected';", "utf8");
    await fileSystem.rename(replacementPath, targetPath);
    await assertRejected(secureIo.readUtf8(repoRoot, targetPath, targetMetadata?.identity));

    const ancestorPath = path.join(repoRoot, "apps");
    const sourcePath = path.join(ancestorPath, "main.ts");
    await fileSystem.mkdir(ancestorPath);
    await fileSystem.writeFile(sourcePath, "export const oldAncestor = 'safe';", "utf8");
    const ancestorMetadata = await secureIo.inspectPath(repoRoot, sourcePath);
    const movedAncestorPath = path.join(repoRoot, "moved-apps");
    await fileSystem.rename(ancestorPath, movedAncestorPath);
    await fileSystem.mkdir(ancestorPath);
    await fileSystem.writeFile(sourcePath, "export const replacementAncestor = 'rejected';", "utf8");
    await assertRejected(secureIo.readUtf8(repoRoot, sourcePath, ancestorMetadata?.identity));
  });
});

test("secure IO rejects symlink targets and ancestors before they can contribute content", async () => {
  await withTemporaryRepo(async (repoRoot) => {
    const fileSystem = await import("node:fs/promises");
    const secureIo = createZeroLegacySecureIo();
    const outsideRoot = await mkdtemp(path.join(os.tmpdir(), "zero-legacy-secure-io-outside-"));
    try {
      const outsideSource = path.join(outsideRoot, "outside.ts");
      await fileSystem.writeFile(outsideSource, "export const outsideContent = 'rejected';", "utf8");
      const targetLink = path.join(repoRoot, "target.ts");
      const ancestorLink = path.join(repoRoot, "apps");
      await fileSystem.symlink(outsideSource, targetLink);
      await fileSystem.symlink(outsideRoot, ancestorLink);

      await assertRejected(secureIo.inspectPath(repoRoot, targetLink));
      await assertRejected(secureIo.inspectPath(repoRoot, path.join(ancestorLink, "outside.ts")));
    } finally {
      await rm(outsideRoot, { force: true, recursive: true });
    }
  });
});

test("secure IO exposes only inspected files and directories and fails closed after disappearance", async () => {
  await withTemporaryRepo(async (repoRoot) => {
    const fileSystem = await import("node:fs/promises");
    const secureIo = createZeroLegacySecureIo();
    const directoryPath = path.join(repoRoot, "apps");
    const sourcePath = path.join(directoryPath, "main.ts");
    const disappearingDirectoryPath = path.join(repoRoot, "gone-directory");
    const disappearingSourcePath = path.join(repoRoot, "gone.ts");
    const ancestorFilePath = path.join(repoRoot, "not-a-directory");

    await fileSystem.mkdir(directoryPath);
    await fileSystem.writeFile(sourcePath, "export const safe = true;", "utf8");
    await fileSystem.mkdir(disappearingDirectoryPath);
    await fileSystem.writeFile(disappearingSourcePath, "export const safe = true;", "utf8");
    await fileSystem.writeFile(ancestorFilePath, "not a directory", "utf8");

    expect(await secureIo.canonicalize(repoRoot)).toBe(repoRoot);
    expect(await secureIo.inspectPath(repoRoot, path.join(repoRoot, "missing.ts"))).toBeUndefined();
    await assertRejected(secureIo.inspectPath(repoRoot, path.join(repoRoot, "..", "outside.ts")));
    await assertRejected(secureIo.inspectPath(repoRoot, path.join(ancestorFilePath, "child.ts")));
    await assertRejected(secureIo.readDirectory(repoRoot, directoryPath));
    await assertRejected(secureIo.readUtf8(repoRoot, sourcePath));

    const directoryMetadata = await secureIo.inspectPath(repoRoot, directoryPath);
    expect(directoryMetadata?.kind).toBe("directory");
    expect(await secureIo.readDirectory(repoRoot, directoryPath, directoryMetadata?.identity)).toEqual([
      "main.ts",
    ]);
    const sourceMetadata = await secureIo.inspectPath(repoRoot, sourcePath);
    await assertRejected(secureIo.readDirectory(repoRoot, sourcePath, sourceMetadata?.identity));
    await assertRejected(secureIo.readUtf8(repoRoot, directoryPath, directoryMetadata?.identity));

    const disappearingDirectoryMetadata = await secureIo.inspectPath(repoRoot, disappearingDirectoryPath);
    await fileSystem.rmdir(disappearingDirectoryPath);
    await assertRejected(
      secureIo.readDirectory(repoRoot, disappearingDirectoryPath, disappearingDirectoryMetadata?.identity),
    );

    const disappearingSourceMetadata = await secureIo.inspectPath(repoRoot, disappearingSourcePath);
    await fileSystem.unlink(disappearingSourcePath);
    await assertRejected(
      secureIo.readUtf8(repoRoot, disappearingSourcePath, disappearingSourceMetadata?.identity),
    );
  });
});

test("secure IO returns no metadata for a removed repository root and propagates inaccessible-path failures", async () => {
  const fileSystem = await import("node:fs/promises");
  const missingRoot = await mkdtemp(path.join(os.tmpdir(), "zero-legacy-secure-io-missing-"));
  const secureIo = createZeroLegacySecureIo();
  await fileSystem.rm(missingRoot, { force: true, recursive: true });
  expect(await secureIo.inspectPath(missingRoot, missingRoot)).toBeUndefined();

  await withTemporaryRepo(async (repoRoot) => {
    const blockedDirectoryPath = path.join(repoRoot, "blocked");
    const blockedSourcePath = path.join(blockedDirectoryPath, "main.ts");
    await fileSystem.mkdir(blockedDirectoryPath);
    await fileSystem.writeFile(blockedSourcePath, "export const inaccessible = true;", "utf8");
    await fileSystem.chmod(blockedDirectoryPath, 0o000);
    try {
      await assertRejected(secureIo.inspectPath(repoRoot, blockedSourcePath));
    } finally {
      await fileSystem.chmod(blockedDirectoryPath, 0o700);
    }
  });
});

test("secure IO rejects special-file targets before they contribute scanner input", async () => {
  await withTemporaryRepo(async (repoRoot) => {
    const namedPipePath = path.join(repoRoot, "scanner-input.pipe");
    await executeFile("mkfifo", [namedPipePath]);

    await assertRejected(createZeroLegacySecureIo().inspectPath(repoRoot, namedPipePath));
  });
});
