import nodePath from "node:path";

import { REPOSITORY_ROOT } from "./logging-e2e-scope.ts";
import { type SummaryPublisherFileSystem } from "./logging-e2e-summary-publisher.ts";

export type SummaryPublisherPathKind = "directory" | "file" | "other" | "symlink";
type SummaryPublisherFlagName = "O_CREAT" | "O_DIRECTORY" | "O_EXCL" | "O_NOFOLLOW" | "O_RDONLY" | "O_WRONLY";

interface TestPathEntry {
  readonly device: bigint;
  readonly inode: bigint;
  readonly kind: SummaryPublisherPathKind;
  readonly contents: Uint8Array;
  readonly mode: number;
  readonly uid: number;
}

class TestSummaryPublisherFileSystemError extends Error {
  public constructor(public readonly code: string) {
    super(`Test summary publisher filesystem error: ${code}`);
    this.name = "TestSummaryPublisherFileSystemError";
  }
}

function metadata(entry: TestPathEntry) {
  return Object.freeze({
    dev: entry.device,
    ino: entry.inode,
    mode: BigInt(entry.mode),
    uid: BigInt(entry.uid),
    isDirectory: () => entry.kind === "directory",
    isFile: () => entry.kind === "file",
    isSymbolicLink: () => entry.kind === "symlink",
  });
}

function cloneBytes(contents: Uint8Array): Uint8Array {
  return new Uint8Array(contents);
}

export interface SummaryPublisherTestHarness {
  readonly fileSystem: SummaryPublisherFileSystem;
  readonly operations: readonly string[];
  readonly paths: Readonly<{
    readonly coverage: string;
    readonly e2e: string;
    readonly final: string;
    readonly logging: string;
    readonly packages: string;
    readonly temporary: string;
  }>;
  readonly publishedContents: Uint8Array | undefined;
  setDirectoryIdentity(path: string): void;
  setDirectoryMetadata(path: string, uid: number, mode: number): void;
  setFinalIdentityMismatch(): void;
  setPath(path: string, kind: SummaryPublisherPathKind, contents?: Uint8Array): void;
}

export function createSummaryPublisherTestHarness(
  options: Readonly<{
    readonly flagOverride?: Readonly<Partial<Record<SummaryPublisherFlagName, unknown>>>;
    readonly platform?: string;
    readonly partialWrites?: boolean;
    readonly precreateCoverageDirectories?: boolean;
    readonly uid?: number;
    readonly coverageMode?: number;
  }> = {},
): SummaryPublisherTestHarness {
  const paths = Object.freeze({
    coverage: nodePath.join(REPOSITORY_ROOT, "packages", "logging", "coverage"),
    e2e: nodePath.join(REPOSITORY_ROOT, "packages", "logging", "coverage", "e2e"),
    final: nodePath.join(REPOSITORY_ROOT, "packages", "logging", "coverage", "e2e", "summary.json"),
    logging: nodePath.join(REPOSITORY_ROOT, "packages", "logging"),
    packages: nodePath.join(REPOSITORY_ROOT, "packages"),
    temporary: nodePath.join(REPOSITORY_ROOT, "packages", "logging", "coverage", "e2e", ".summary.json.tmp"),
  });
  const entries = new Map<string, TestPathEntry>();
  const descriptors = new Map<number, string>();
  const operations: string[] = [];
  let nextDescriptor = 101;
  let nextInode = 1001n;
  const currentUid = options.uid ?? 1000;
  let isFinalIdentityMismatched = false;
  const addEntry = (
    path: string,
    kind: SummaryPublisherPathKind,
    contents = new Uint8Array(),
    mode = kind === "directory" ? 0o700 : 0o600,
    uid = currentUid,
  ): void => {
    entries.set(
      path,
      Object.freeze({ device: 1n, inode: nextInode++, kind, contents: cloneBytes(contents), mode, uid }),
    );
  };
  for (const path of [REPOSITORY_ROOT, paths.packages, paths.logging]) addEntry(path, "directory");
  if (options.precreateCoverageDirectories) {
    addEntry(paths.coverage, "directory", new Uint8Array(), options.coverageMode);
    addEntry(paths.e2e, "directory", new Uint8Array(), options.coverageMode);
  }

  const pathForDescriptorPath = (path: string): string => {
    const descriptorPrefix = "/proc/self/fd/";
    if (!path.startsWith(descriptorPrefix)) return path;
    const pathParts = path.slice(descriptorPrefix.length).split("/");
    const descriptorText = pathParts.shift();
    if (descriptorText === undefined || descriptorText.length === 0)
      throw new TestSummaryPublisherFileSystemError("EBADF");
    const descriptor = Number(descriptorText);
    const parent = descriptors.get(descriptor);
    if (parent === undefined) throw new TestSummaryPublisherFileSystemError("EBADF");
    return pathParts.length === 0 ? parent : nodePath.join(parent, ...pathParts);
  };
  const requireEntry = (path: string): TestPathEntry => {
    const entry = entries.get(path);
    if (entry === undefined) throw new TestSummaryPublisherFileSystemError("ENOENT");
    return entry;
  };
  const open = (path: string, _flags: number, mode?: number): number => {
    const canonicalPath = pathForDescriptorPath(path);
    operations.push(`open:${path}:${String(mode)}`);
    if (mode === undefined) {
      const entry = requireEntry(canonicalPath);
      if (entry.kind === "symlink") throw new TestSummaryPublisherFileSystemError("ELOOP");
      const descriptor = nextDescriptor++;
      descriptors.set(descriptor, canonicalPath);
      return descriptor;
    }
    if (entries.has(canonicalPath)) throw new TestSummaryPublisherFileSystemError("EEXIST");
    addEntry(canonicalPath, "file", new Uint8Array(), mode);
    const descriptor = nextDescriptor++;
    descriptors.set(descriptor, canonicalPath);
    return descriptor;
  };
  const flags = Object.freeze({
    O_CREAT: 64,
    O_DIRECTORY: 65_536,
    O_EXCL: 128,
    O_NOFOLLOW: 131_072,
    O_RDONLY: 0,
    O_WRONLY: 1,
    ...options.flagOverride,
  });
  const fileSystem: SummaryPublisherFileSystem = Object.freeze({
    O_CREAT: flags.O_CREAT,
    O_DIRECTORY: flags.O_DIRECTORY,
    O_EXCL: flags.O_EXCL,
    O_NOFOLLOW: flags.O_NOFOLLOW,
    O_RDONLY: flags.O_RDONLY,
    O_WRONLY: flags.O_WRONLY,
    close: (descriptor: number) => {
      operations.push(`close:${String(descriptor)}`);
      if (!descriptors.delete(descriptor)) throw new TestSummaryPublisherFileSystemError("EBADF");
    },
    fchmod: (descriptor: number, mode: number) => {
      operations.push(`fchmod:${String(descriptor)}:${String(mode)}`);
      const path = descriptors.get(descriptor);
      if (path === undefined) throw new TestSummaryPublisherFileSystemError("EBADF");
      const entry = requireEntry(path);
      entries.set(path, Object.freeze({ ...entry, mode }));
    },
    fstat: (descriptor: number) => {
      operations.push(`fstat:${String(descriptor)}`);
      const path = descriptors.get(descriptor);
      if (path === undefined) throw new TestSummaryPublisherFileSystemError("EBADF");
      return metadata(requireEntry(path));
    },
    fsync: (descriptor: number) => {
      operations.push(`fsync:${String(descriptor)}`);
      if (!descriptors.has(descriptor)) throw new TestSummaryPublisherFileSystemError("EBADF");
    },
    getUid: () => currentUid,
    join: (...pathParts: readonly string[]) => nodePath.join(...pathParts),
    lstat: (path: string) => {
      const canonicalPath = pathForDescriptorPath(path);
      operations.push(`lstat:${path}`);
      const entry = requireEntry(canonicalPath);
      if (isFinalIdentityMismatched && canonicalPath === paths.final && entry.kind === "file") {
        return metadata(Object.freeze({ ...entry, inode: entry.inode + 1n }));
      }
      return metadata(entry);
    },
    mkdir: (path: string, mode: number) => {
      const canonicalPath = pathForDescriptorPath(path);
      operations.push(`mkdir:${path}:${String(mode)}`);
      if (entries.has(canonicalPath)) throw new TestSummaryPublisherFileSystemError("EEXIST");
      addEntry(canonicalPath, "directory", new Uint8Array(), mode);
    },
    open,
    platform: options.platform ?? "linux",
    rename: (source: string, destination: string) => {
      const canonicalSource = pathForDescriptorPath(source);
      const canonicalDestination = pathForDescriptorPath(destination);
      operations.push(`rename:${source}:${destination}`);
      const entry = requireEntry(canonicalSource);
      entries.delete(canonicalSource);
      entries.set(canonicalDestination, entry);
    },
    unlink: (path: string) => {
      const canonicalPath = pathForDescriptorPath(path);
      operations.push(`unlink:${path}`);
      if (!entries.delete(canonicalPath)) throw new TestSummaryPublisherFileSystemError("ENOENT");
    },
    write: (descriptor: number, contents: Uint8Array) => {
      operations.push(`write:${String(descriptor)}:${String(contents.byteLength)}`);
      const path = descriptors.get(descriptor);
      if (path === undefined) throw new TestSummaryPublisherFileSystemError("EBADF");
      const entry = requireEntry(path);
      const byteCount = options.partialWrites && contents.byteLength > 0 ? 1 : contents.byteLength;
      const writtenContents = contents.subarray(0, byteCount);
      const nextContents = new Uint8Array([...entry.contents, ...writtenContents]);
      entries.set(
        path,
        Object.freeze({
          ...entry,
          contents: nextContents,
        }),
      );
      return byteCount;
    },
  });
  return Object.freeze({
    fileSystem,
    operations,
    paths,
    get publishedContents() {
      const entry = entries.get(paths.final);
      return entry === undefined ? undefined : cloneBytes(entry.contents);
    },
    setFinalIdentityMismatch: () => {
      isFinalIdentityMismatched = true;
    },
    setDirectoryIdentity: (path: string) => {
      const entry = requireEntry(path);
      entries.set(path, Object.freeze({ ...entry, inode: nextInode++ }));
    },
    setDirectoryMetadata: (path: string, uid: number, mode: number) => {
      const entry = requireEntry(path);
      entries.set(path, Object.freeze({ ...entry, mode, uid }));
    },
    setPath: (path: string, kind: SummaryPublisherPathKind, contents = new Uint8Array()) => {
      addEntry(path, kind, contents);
    },
  });
}
