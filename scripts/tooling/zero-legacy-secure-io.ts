import path from "node:path";

export const zeroLegacyMaximumSourceBytes = 1_048_576 as const;

export type ZeroLegacySecurePathKind = "directory" | "file" | "other" | "symlink";

type SecurePathKind = "directory" | "file";

export interface ZeroLegacySecurePathMetadata {
  readonly identity?: string;
  readonly kind: ZeroLegacySecurePathKind;
}

export interface ZeroLegacySecureIo {
  readonly canonicalize: (absolutePath: string) => Promise<string>;
  readonly inspectPath: (
    repoRoot: string,
    absolutePath: string,
  ) => Promise<ZeroLegacySecurePathMetadata | undefined>;
  readonly readDirectory: (
    repoRoot: string,
    absolutePath: string,
    expectedIdentity?: string,
  ) => Promise<readonly string[]>;
  readonly readUtf8: (repoRoot: string, absolutePath: string, expectedIdentity?: string) => Promise<string>;
}

export interface ZeroLegacySecureIoStat {
  readonly dev: bigint;
  readonly ino: bigint;
  readonly size: bigint;
  readonly isDirectory: () => boolean;
  readonly isFile: () => boolean;
  readonly isSymbolicLink: () => boolean;
}

export interface ZeroLegacySecureIoFileHandle {
  readonly fd: number;
  readonly close: () => Promise<void>;
  readonly read: (
    buffer: Uint8Array,
    offset: number,
    length: number,
    position: number,
  ) => Promise<Readonly<{ bytesRead: number }>>;
  readonly stat: (options: Readonly<{ bigint: true }>) => Promise<ZeroLegacySecureIoStat>;
}

export interface ZeroLegacyReadOnlyFileSystem {
  readonly lstat: (
    absolutePath: string,
    options: Readonly<{ bigint: true }>,
  ) => Promise<ZeroLegacySecureIoStat>;
  readonly open: (absolutePath: string, flags: number) => Promise<ZeroLegacySecureIoFileHandle>;
  readonly readDirectory: (
    absolutePath: string,
    options: Readonly<{ encoding: "utf8" }>,
  ) => Promise<readonly string[]>;
  readonly realpath: (absolutePath: string) => Promise<string>;
}

export interface ZeroLegacyOpenConstants {
  readonly O_DIRECTORY: number;
  readonly O_NOFOLLOW: number;
  readonly O_RDONLY: number;
}

export interface ZeroLegacySecureIoDependencies {
  readonly fileSystem?: Partial<ZeroLegacyReadOnlyFileSystem>;
  readonly getOpenConstants?: () => Promise<ZeroLegacyOpenConstants>;
}

interface ResolvedZeroLegacySecureIoDependencies {
  readonly fileSystem: ZeroLegacyReadOnlyFileSystem;
  readonly getOpenConstants: () => Promise<ZeroLegacyOpenConstants>;
}

interface PathIdentity {
  readonly device: bigint;
  readonly inode: bigint;
  readonly kind: ZeroLegacySecurePathKind;
}

interface SecurePathIdentity extends PathIdentity {
  readonly kind: SecurePathKind;
}

interface PathSnapshot {
  readonly absolutePath: string;
  readonly identity: SecurePathIdentity;
}

type NonEmptyPathSnapshots = readonly [PathSnapshot, ...PathSnapshot[]];

const descriptorDirectory = "/proc/self/fd";

const isMissingPathError = (error: unknown): boolean =>
  error instanceof Error && "code" in error && (error.code === "ENOENT" || error.code === "ENOTDIR");

const isDescendantOrSame = (root: string, candidate: string): boolean =>
  candidate === root || candidate.startsWith(`${root}${path.sep}`);

function securePathKind(stat: ZeroLegacySecureIoStat): ZeroLegacySecurePathKind {
  if (stat.isSymbolicLink()) {
    return "symlink";
  }
  if (stat.isDirectory()) {
    return "directory";
  }
  return stat.isFile() ? "file" : "other";
}

function isSameIdentity(left: PathIdentity, right: PathIdentity): boolean {
  return left.device === right.device && left.inode === right.inode && left.kind === right.kind;
}

function snapshotIdentity(snapshots: readonly PathSnapshot[]): string {
  return snapshots
    .map(
      (snapshot) =>
        `${String(snapshot.identity.device)}:${String(snapshot.identity.inode)}:${snapshot.identity.kind}`,
    )
    .join("/");
}

function finalSnapshot(snapshots: NonEmptyPathSnapshots): PathSnapshot {
  let result = snapshots[0];
  for (const snapshot of snapshots) {
    result = snapshot;
  }
  return result;
}

function pathSegments(repoRoot: string, absolutePath: string): readonly string[] {
  const relativePath = path.relative(repoRoot, absolutePath);
  if (relativePath.length === 0) {
    return Object.freeze([]);
  }
  if (
    path.isAbsolute(relativePath) ||
    relativePath
      .split(path.sep)
      .some((segment) => segment.length === 0 || segment === "." || segment === "..")
  ) {
    throw new Error("Target is not a repository descendant");
  }
  return Object.freeze(relativePath.split(path.sep));
}

const nodeReadOnlyFileSystem: ZeroLegacyReadOnlyFileSystem = Object.freeze({
  lstat: async (absolutePath: string, _options: Readonly<{ bigint: true }>) => {
    const fileSystem = await import("node:fs/promises");
    const stat = await fileSystem.lstat(absolutePath, { bigint: true });
    return Object.freeze({
      dev: stat.dev,
      ino: stat.ino,
      isDirectory: () => stat.isDirectory(),
      isFile: () => stat.isFile(),
      isSymbolicLink: () => stat.isSymbolicLink(),
      size: stat.size,
    });
  },
  open: async (absolutePath: string, flags: number) => {
    const fileSystem = await import("node:fs/promises");
    const fileHandle = await fileSystem.open(absolutePath, flags);
    return Object.freeze({
      fd: fileHandle.fd,
      close: () => fileHandle.close(),
      read: async (buffer: Uint8Array, offset: number, length: number, position: number) => {
        const result = await fileHandle.read(buffer, offset, length, position);
        return Object.freeze({ bytesRead: result.bytesRead });
      },
      stat: async (_options: Readonly<{ bigint: true }>) => {
        const stat = await fileHandle.stat({ bigint: true });
        return Object.freeze({
          dev: stat.dev,
          ino: stat.ino,
          isDirectory: () => stat.isDirectory(),
          isFile: () => stat.isFile(),
          isSymbolicLink: () => stat.isSymbolicLink(),
          size: stat.size,
        });
      },
    });
  },
  readDirectory: async (absolutePath: string, options: Readonly<{ encoding: "utf8" }>) => {
    const fileSystem = await import("node:fs/promises");
    return fileSystem.readdir(absolutePath, options);
  },
  realpath: async (absolutePath: string) => {
    const fileSystem = await import("node:fs/promises");
    return fileSystem.realpath(absolutePath);
  },
});

const getNodeOpenConstants = async (): Promise<ZeroLegacyOpenConstants> => {
  const fileSystem = await import("node:fs");
  return Object.freeze({
    O_DIRECTORY: fileSystem.constants.O_DIRECTORY,
    O_NOFOLLOW: fileSystem.constants.O_NOFOLLOW,
    O_RDONLY: fileSystem.constants.O_RDONLY,
  });
};

const defaultDependencies: ResolvedZeroLegacySecureIoDependencies = Object.freeze({
  fileSystem: nodeReadOnlyFileSystem,
  getOpenConstants: getNodeOpenConstants,
});

async function snapshotFileSystemPath(
  fileSystem: ZeroLegacyReadOnlyFileSystem,
  absolutePath: string,
  isTarget: boolean,
): Promise<PathSnapshot | undefined> {
  let stat;
  try {
    stat = await fileSystem.lstat(absolutePath, { bigint: true });
  } catch (error: unknown) {
    if (isMissingPathError(error)) {
      return;
    }
    throw error;
  }
  const kind = securePathKind(stat);
  if (kind === "symlink" || kind === "other") {
    throw new Error("Target contains a symlink, special file, or non-directory ancestor");
  }
  if (kind === "file" && !isTarget) {
    throw new Error("Target contains a symlink, special file, or non-directory ancestor");
  }
  return Object.freeze({
    absolutePath,
    identity: Object.freeze({ device: stat.dev, inode: stat.ino, kind }),
  });
}

async function snapshotPath(
  repoRoot: string,
  absolutePath: string,
  fileSystem: ZeroLegacyReadOnlyFileSystem,
): Promise<NonEmptyPathSnapshots | undefined> {
  const segments = pathSegments(repoRoot, absolutePath);
  const paths: [string, ...string[]] = [repoRoot];
  let currentPath = repoRoot;
  for (const segment of segments) {
    currentPath = path.join(currentPath, segment);
    paths.push(currentPath);
  }
  const rootSnapshot = await snapshotFileSystemPath(fileSystem, paths[0], paths.length === 1);
  if (rootSnapshot === undefined) {
    return;
  }
  const snapshots: [PathSnapshot, ...PathSnapshot[]] = [rootSnapshot];
  const descendantPaths = paths.slice(1);
  for (const [index, descendantPath] of descendantPaths.entries()) {
    const snapshot = await snapshotFileSystemPath(
      fileSystem,
      descendantPath,
      index === descendantPaths.length - 1,
    );
    if (snapshot === undefined) {
      return;
    }
    snapshots.push(snapshot);
  }
  return Object.freeze(snapshots);
}

async function assertStableSnapshots(
  snapshots: NonEmptyPathSnapshots,
  repoRoot: string,
  fileSystem: ZeroLegacyReadOnlyFileSystem,
): Promise<void> {
  const finalPath = finalSnapshot(snapshots).absolutePath;
  const current = await snapshotPath(repoRoot, finalPath, fileSystem);
  if (current === undefined) {
    throw new Error("Target identity changed during secure operation");
  }
  const expectedIdentitiesByPath = new Map<string, SecurePathIdentity>();
  for (const snapshot of snapshots) {
    expectedIdentitiesByPath.set(snapshot.absolutePath, snapshot.identity);
  }
  for (const currentSnapshot of current) {
    const expectedIdentity = expectedIdentitiesByPath.get(currentSnapshot.absolutePath);
    if (expectedIdentity === undefined || !isSameIdentity(currentSnapshot.identity, expectedIdentity)) {
      throw new Error("Target identity changed during secure operation");
    }
  }
}

async function openedDescriptorPath(
  fileDescriptor: number,
  fileSystem: ZeroLegacyReadOnlyFileSystem,
): Promise<string> {
  return fileSystem.realpath(path.join(descriptorDirectory, String(fileDescriptor)));
}

async function withSecureDescriptor<T>(
  repoRoot: string,
  absolutePath: string,
  expectedKind: "directory" | "file",
  expectedSnapshotIdentity: string,
  action: (descriptorPath: string, fileHandle: ZeroLegacySecureIoFileHandle) => Promise<T>,
  fileSystem: ZeroLegacyReadOnlyFileSystem,
  getOpenConstants: () => Promise<ZeroLegacyOpenConstants>,
): Promise<T | undefined> {
  const snapshots = await snapshotPath(repoRoot, absolutePath, fileSystem);
  if (snapshots === undefined) {
    return;
  }
  if (snapshotIdentity(snapshots) !== expectedSnapshotIdentity) {
    throw new Error("Target identity changed before secure operation");
  }
  const expectedIdentity = finalSnapshot(snapshots).identity;
  if (expectedIdentity.kind !== expectedKind) {
    throw new Error("Target type is not permitted for this operation");
  }
  const constants = await getOpenConstants();
  const flags =
    constants.O_RDONLY | constants.O_NOFOLLOW | (expectedKind === "directory" ? constants.O_DIRECTORY : 0);
  const fileHandle = await fileSystem.open(absolutePath, flags);
  try {
    const descriptorPath = await openedDescriptorPath(fileHandle.fd, fileSystem);
    if (!isDescendantOrSame(repoRoot, descriptorPath)) {
      throw new Error("Opened target escapes repository root");
    }
    const openedStat = await fileHandle.stat({ bigint: true });
    const openedIdentity = Object.freeze({
      device: openedStat.dev,
      inode: openedStat.ino,
      kind: securePathKind(openedStat),
    });
    if (!isSameIdentity(expectedIdentity, openedIdentity)) {
      throw new Error("Target was replaced before descriptor validation");
    }
    const result = await action(descriptorPath, fileHandle);
    const finalStat = await fileHandle.stat({ bigint: true });
    const finalIdentity = Object.freeze({
      device: finalStat.dev,
      inode: finalStat.ino,
      kind: securePathKind(finalStat),
    });
    if (!isSameIdentity(openedIdentity, finalIdentity)) {
      throw new Error("Opened target identity changed during operation");
    }
    if (!isDescendantOrSame(repoRoot, await openedDescriptorPath(fileHandle.fd, fileSystem))) {
      throw new Error("Opened target escaped repository root during operation");
    }
    await assertStableSnapshots(snapshots, repoRoot, fileSystem);
    return result;
  } finally {
    await fileHandle.close();
  }
}

async function readExactSource(fileHandle: ZeroLegacySecureIoFileHandle): Promise<string> {
  const initialStat = await fileHandle.stat({ bigint: true });
  if (initialStat.size < 0n || initialStat.size > BigInt(zeroLegacyMaximumSourceBytes)) {
    throw new Error("Source exceeds the secure scanner byte limit");
  }
  const byteLength = Number(initialStat.size);
  const bytes = Buffer.alloc(byteLength);
  let offset = 0;
  while (offset < bytes.length) {
    const { bytesRead } = await fileHandle.read(bytes, offset, bytes.length - offset, offset);
    if (bytesRead === 0) {
      throw new Error("Source was truncated during secure read");
    }
    offset += bytesRead;
  }
  const finalStat = await fileHandle.stat({ bigint: true });
  if (finalStat.size !== initialStat.size) {
    throw new Error("Source size changed during secure read");
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

export function createZeroLegacySecureIo(
  dependencies: ZeroLegacySecureIoDependencies = {},
): ZeroLegacySecureIo {
  const fileSystem: ZeroLegacyReadOnlyFileSystem = Object.freeze({
    lstat: dependencies.fileSystem?.lstat ?? defaultDependencies.fileSystem.lstat,
    open: dependencies.fileSystem?.open ?? defaultDependencies.fileSystem.open,
    readDirectory: dependencies.fileSystem?.readDirectory ?? defaultDependencies.fileSystem.readDirectory,
    realpath: dependencies.fileSystem?.realpath ?? defaultDependencies.fileSystem.realpath,
  });
  const getOpenConstants = dependencies.getOpenConstants ?? defaultDependencies.getOpenConstants;
  return Object.freeze({
    canonicalize: async (absolutePath: string) => {
      return fileSystem.realpath(absolutePath);
    },
    inspectPath: async (repoRoot: string, absolutePath: string) => {
      const snapshots = await snapshotPath(repoRoot, absolutePath, fileSystem);
      if (snapshots === undefined) {
        return;
      }
      const expectedKind = finalSnapshot(snapshots).identity.kind;
      if (expectedKind === "directory") {
        await withSecureDescriptor(
          repoRoot,
          absolutePath,
          "directory",
          snapshotIdentity(snapshots),
          () => Promise.resolve(undefined),
          fileSystem,
          getOpenConstants,
        );
      } else {
        await withSecureDescriptor(
          repoRoot,
          absolutePath,
          "file",
          snapshotIdentity(snapshots),
          () => Promise.resolve(undefined),
          fileSystem,
          getOpenConstants,
        );
      }
      return Object.freeze({ identity: snapshotIdentity(snapshots), kind: expectedKind });
    },
    readDirectory: async (repoRoot: string, absolutePath: string, expectedSnapshotIdentity?: string) => {
      if (expectedSnapshotIdentity === undefined) {
        throw new Error("Secure directory enumeration requires an inspected identity");
      }
      const result = await withSecureDescriptor(
        repoRoot,
        absolutePath,
        "directory",
        expectedSnapshotIdentity,
        (descriptorPath) => fileSystem.readDirectory(descriptorPath, { encoding: "utf8" }),
        fileSystem,
        getOpenConstants,
      );
      if (result === undefined) {
        throw new Error("Directory target disappeared before secure enumeration");
      }
      return Object.freeze([...result]);
    },
    readUtf8: async (repoRoot: string, absolutePath: string, expectedSnapshotIdentity?: string) => {
      if (expectedSnapshotIdentity === undefined) {
        throw new Error("Secure source read requires an inspected identity");
      }
      const result = await withSecureDescriptor(
        repoRoot,
        absolutePath,
        "file",
        expectedSnapshotIdentity,
        async (_descriptorPath, fileHandle) => readExactSource(fileHandle),
        fileSystem,
        getOpenConstants,
      );
      if (result === undefined) {
        throw new Error("File target disappeared before secure read");
      }
      return result;
    },
  });
}
