import {
  chmodSync,
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import nodePath from "node:path";

import { rollbackArtifactRunConstruction } from "./logging-e2e-artifact-run-construction-rollback.ts";

// eslint-disable-next-line unicorn/name-replacements -- Established public E2E artifact contract.
export type LoggingE2eArtifactErrorCode =
  "E_E2E_ARTIFACT_UNSUPPORTED" | "IDENTITY" | "SYMLINK" | "EXISTS" | "TYPE" | "IO" | "CLEANUP";
// eslint-disable-next-line unicorn/name-replacements -- Established public E2E test-infrastructure contract.
export class LoggingE2eArtifactError extends Error {
  public constructor(
    public readonly code: LoggingE2eArtifactErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "LoggingE2eArtifactError";
  }
}
// eslint-disable-next-line unicorn/name-replacements -- Established public E2E artifact contract.
export interface LoggingE2eArtifactIdentity {
  readonly device: bigint;
  readonly inode: bigint;
}
// eslint-disable-next-line unicorn/name-replacements -- Established public E2E artifact contract.
export interface LoggingE2eArtifactPaths {
  readonly root: string;
  readonly raw: string;
  readonly bundle: string;
}
// eslint-disable-next-line unicorn/name-replacements -- Established public E2E artifact contract.
export interface LoggingE2eArtifactIdentities {
  readonly root: LoggingE2eArtifactIdentity;
  readonly raw: LoggingE2eArtifactIdentity;
  readonly bundle: LoggingE2eArtifactIdentity;
}
export interface ArtifactRunPathMetadata {
  isDirectory(): boolean;
  isFile(): boolean;
  isSymbolicLink(): boolean;
  readonly dev: bigint;
  readonly ino: bigint;
}
export interface ArtifactRunFileSystem {
  readonly platform: string;
  readonly constants: Readonly<
    Record<"O_RDONLY" | "O_WRONLY" | "O_DIRECTORY" | "O_NOFOLLOW" | "O_CREAT" | "O_EXCL", number>
  >;
  readonly basename: (path: string) => string;
  readonly chmod: (path: string, mode: number) => void;
  readonly close: (descriptor: number) => void;
  readonly fstat: (descriptor: number) => ArtifactRunPathMetadata;
  readonly fsync: (descriptor: number) => void;
  readonly join: (...paths: readonly string[]) => string;
  readonly lstat: (path: string) => ArtifactRunPathMetadata;
  readonly mkdir: (path: string, mode: number) => void;
  readonly mkdtemp: (prefix: string) => string;
  readonly open: (path: string, flags: number, mode?: number) => number;
  readonly read: (descriptor: number) => Uint8Array;
  readonly readdir: (path: string) => readonly string[];
  readonly rmdir: (path: string) => void;
  readonly temporaryDirectory: () => string;
  readonly unlink: (path: string) => void;
  readonly write: (descriptor: number, contents: Uint8Array) => void;
}
// eslint-disable-next-line unicorn/name-replacements -- Established public E2E artifact contract.
export interface LoggingE2eArtifactRunHooks {
  readonly afterReadFileOpen?: (path: string) => void;
}
// eslint-disable-next-line unicorn/name-replacements -- Established public E2E artifact contract.
export interface LoggingE2eArtifactRun {
  readonly paths: LoggingE2eArtifactPaths;
  readonly identities: LoggingE2eArtifactIdentities;
  adoptExternalFiles(directory: "raw" | "bundle"): readonly string[];
  writeExclusiveFile(directory: "raw" | "bundle", fileName: string, contents: Uint8Array): void;
  readFile(directory: "raw" | "bundle", fileName: string): Uint8Array;
  revalidateDirectories(): void;
  cleanup(): void;
}
interface OpenDirectory {
  readonly descriptor: number;
  readonly identity: LoggingE2eArtifactIdentity;
  readonly path: string;
}
interface CreatedFile {
  readonly identity: LoggingE2eArtifactIdentity;
  readonly name: string;
}
const ARTIFACT_PREFIX = "mm-crypto-bot-logging-e2e-";
const PRIVATE_DIRECTORY_MODE = 0o700;
const SAFE_FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u;

export function createNodeArtifactRunFileSystem(): ArtifactRunFileSystem {
  return Object.freeze({
    platform: process.platform,
    constants,
    basename: (path: string) => nodePath.basename(path),
    chmod: (path: string, mode: number) => {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- The adapter accepts only descriptor-anchored artifact paths.
      chmodSync(path, mode);
    },
    close: (descriptor: number) => {
      closeSync(descriptor);
    },
    fstat: (descriptor: number) => fstatSync(descriptor, { bigint: true }),
    fsync: (descriptor: number) => {
      fsyncSync(descriptor);
    },
    join: (...paths: readonly string[]) => nodePath.join(...paths),
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- The adapter accepts only descriptor-anchored artifact paths.
    lstat: (path: string) => lstatSync(path, { bigint: true }),
    mkdir: (path: string, mode: number) => {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- The adapter accepts only descriptor-anchored artifact paths.
      mkdirSync(path, { mode });
    },
    mkdtemp: (prefix: string) => mkdtempSync(prefix),
    open: (path: string, flags: number, mode?: number) => {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- The adapter accepts only descriptor-anchored artifact paths.
      return mode === undefined ? openSync(path, flags) : openSync(path, flags, mode);
    },
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- The numeric descriptor is created by this adapter.
    read: (descriptor: number) => readFileSync(descriptor),
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- The adapter accepts only descriptor-anchored artifact paths.
    readdir: (path: string) => readdirSync(path),
    rmdir: (path: string) => {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- The adapter accepts only descriptor-anchored artifact paths.
      rmdirSync(path);
    },
    temporaryDirectory: () => tmpdir(),
    unlink: (path: string) => {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- The adapter accepts only descriptor-anchored artifact paths.
      unlinkSync(path);
    },
    write: (descriptor: number, contents: Uint8Array) => {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- The numeric descriptor is created by this adapter.
      writeFileSync(descriptor, contents);
    },
  });
}
function fail(code: LoggingE2eArtifactErrorCode, message: string, cause?: unknown): never {
  throw new LoggingE2eArtifactError(code, message, cause === undefined ? undefined : { cause });
}
function isSame(left: LoggingE2eArtifactIdentity, right: LoggingE2eArtifactIdentity): boolean {
  return left.device === right.device && left.inode === right.inode;
}
function isExisting(error: unknown): boolean {
  return error !== null && typeof error === "object" && "code" in error && error.code === "EEXIST";
}
function isLink(error: unknown): boolean {
  return error !== null && typeof error === "object" && "code" in error && error.code === "ELOOP";
}
function supported(fs: ArtifactRunFileSystem): void {
  const c = fs.constants;
  if (
    fs.platform !== "linux" ||
    typeof c.O_RDONLY !== "number" ||
    typeof c.O_DIRECTORY !== "number" ||
    typeof c.O_NOFOLLOW !== "number" ||
    typeof c.O_CREAT !== "number" ||
    typeof c.O_EXCL !== "number"
  )
    fail(
      "E_E2E_ARTIFACT_UNSUPPORTED",
      "Logging E2E artifacts require Linux descriptor-anchored filesystem support.",
    );
}
function fromPath(
  fs: ArtifactRunFileSystem,
  path: string,
  type: "directory" | "file",
): LoggingE2eArtifactIdentity {
  try {
    const stat = fs.lstat(path);
    if (stat.isSymbolicLink()) fail("SYMLINK", `Symbolic links are forbidden: ${path}.`);
    if ((type === "directory" && !stat.isDirectory()) || (type === "file" && !stat.isFile()))
      fail("TYPE", `Expected a regular ${type}: ${path}.`);
    return Object.freeze({ device: stat.dev, inode: stat.ino });
  } catch (error: unknown) {
    if (error instanceof LoggingE2eArtifactError) throw error;
    fail("IO", `Cannot inspect artifact path: ${path}.`, error);
  }
}
function fromDescriptor(
  fs: ArtifactRunFileSystem,
  descriptor: number,
  type: "directory" | "file",
): LoggingE2eArtifactIdentity {
  try {
    const stat = fs.fstat(descriptor);
    if ((type === "directory" && !stat.isDirectory()) || (type === "file" && !stat.isFile()))
      fail("TYPE", `Descriptor is not a regular ${type}.`);
    return Object.freeze({ device: stat.dev, inode: stat.ino });
  } catch (error: unknown) {
    if (error instanceof LoggingE2eArtifactError) throw error;
    fail("IO", "Cannot inspect artifact descriptor.", error);
  }
}
function descriptorPath(fs: ArtifactRunFileSystem, descriptor: number, child?: string): string {
  const parent = `/proc/self/fd/${String(descriptor)}`;
  return child === undefined ? parent : fs.join(parent, child);
}
function close(fs: ArtifactRunFileSystem, descriptor: number, hasPrimaryError = false): void {
  try {
    fs.close(descriptor);
  } catch (error: unknown) {
    if (!hasPrimaryError) fail("IO", "Cannot close artifact descriptor.", error);
  }
}
function openDirectory(fs: ArtifactRunFileSystem, path: string): OpenDirectory {
  let descriptor: number | undefined;
  try {
    descriptor = fs.open(path, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
    return { descriptor, identity: fromDescriptor(fs, descriptor, "directory"), path };
  } catch (error: unknown) {
    if (descriptor !== undefined) close(fs, descriptor, true);
    if (error instanceof LoggingE2eArtifactError) throw error;
    fail("IO", `Cannot open artifact directory: ${path}.`, error);
  }
}
function validName(name: string): void {
  if (!SAFE_FILE_NAME.test(name)) fail("TYPE", `Artifact file name is invalid: ${name}.`);
}
function insertionPosition(sorted: readonly string[], name: string): number {
  for (const [position, current] of sorted.entries()) if (name < current) return position;
  return sorted.length;
}
function sortedNames(names: readonly string[]): readonly string[] {
  const sorted: string[] = [];
  for (const name of names) {
    sorted.splice(insertionPosition(sorted, name), 0, name);
  }
  return Object.freeze(sorted);
}
function newDirectory(fs: ArtifactRunFileSystem, parent: OpenDirectory, name: string): OpenDirectory {
  const path = fs.join(parent.path, name);
  const anchored = descriptorPath(fs, parent.descriptor, name);
  try {
    fs.mkdir(anchored, PRIVATE_DIRECTORY_MODE);
  } catch (error: unknown) {
    fail("IO", `Cannot create artifact directory: ${path}.`, error);
  }
  try {
    return { ...openDirectory(fs, anchored), path };
  } catch (error: unknown) {
    try {
      fs.rmdir(anchored);
    } catch (rollbackError: unknown) {
      throw new AggregateError(
        [error, rollbackError],
        "Cannot safely roll back artifact directory creation.",
        { cause: rollbackError },
      );
    }
    throw error;
  }
}

// eslint-disable-next-line unicorn/name-replacements -- Established public E2E artifact factory.
export function createLoggingE2eArtifactRun(
  hooks: LoggingE2eArtifactRunHooks = {},
  fs: ArtifactRunFileSystem = createNodeArtifactRunFileSystem(),
): LoggingE2eArtifactRun {
  supported(fs);
  const temporaryPath = fs.temporaryDirectory();
  const temporary = openDirectory(fs, temporaryPath);
  let root: OpenDirectory | undefined;
  let freshRootName: string | undefined;
  let raw: OpenDirectory | undefined;
  let bundle: OpenDirectory | undefined;
  try {
    const rootPath = fs.mkdtemp(fs.join(temporaryPath, ARTIFACT_PREFIX));
    freshRootName = fs.basename(rootPath);
    fs.chmod(rootPath, PRIVATE_DIRECTORY_MODE);
    root = openDirectory(fs, descriptorPath(fs, temporary.descriptor, freshRootName));
    if (!isSame(root.identity, fromPath(fs, rootPath, "directory")))
      fail("IDENTITY", "Artifact root identity changed during creation.");
    root = { ...root, path: rootPath };
    raw = newDirectory(fs, root, "raw");
    bundle = newDirectory(fs, root, "bundle");
    const rootDirectory = root;
    const rawDirectory = raw;
    const bundleDirectory = bundle;
    const paths = Object.freeze({ root: rootPath, raw: raw.path, bundle: bundle.path });
    const identities = Object.freeze({ root: root.identity, raw: raw.identity, bundle: bundle.identity });
    const files: Readonly<Record<"raw" | "bundle", Map<string, CreatedFile>>> = Object.freeze({
      raw: new Map(),
      bundle: new Map(),
    });
    let isCleaned = false;
    const directory = (name: "raw" | "bundle"): OpenDirectory =>
      name === "raw" ? rawDirectory : bundleDirectory;
    const verify = (entry: OpenDirectory): void => {
      if (
        !isSame(entry.identity, fromDescriptor(fs, entry.descriptor, "directory")) ||
        !isSame(entry.identity, fromPath(fs, entry.path, "directory"))
      )
        fail("IDENTITY", `Artifact directory identity changed: ${entry.path}.`);
    };
    const revalidateDirectories = (): void => {
      verify(temporary);
      verify(rootDirectory);
      verify(rawDirectory);
      verify(bundleDirectory);
    };
    const adoptExternalFiles = (name: "raw" | "bundle"): readonly string[] => {
      if (isCleaned) fail("CLEANUP", "Artifact run has already been cleaned up.");
      revalidateDirectories();
      const target = directory(name);
      let entries: readonly string[];
      try {
        entries = sortedNames(fs.readdir(descriptorPath(fs, target.descriptor)));
      } catch (error: unknown) {
        fail("IO", `Cannot list external artifact files: ${target.path}.`, error);
      }
      for (const fileName of entries) {
        validName(fileName);
        const path = descriptorPath(fs, target.descriptor, fileName);
        let descriptor: number | undefined;
        let hasPrimaryError = false;
        try {
          descriptor = fs.open(path, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
          const identity = fromDescriptor(fs, descriptor, "file");
          revalidateDirectories();
          if (!isSame(identity, fromPath(fs, path, "file")))
            fail("IDENTITY", `External artifact file identity changed after opening: ${fileName}.`);
          // eslint-disable-next-line security/detect-object-injection -- The directory union selects a closed artifact registry.
          const known = files[name].get(fileName);
          if (known !== undefined && !isSame(known.identity, identity))
            fail("IDENTITY", `External artifact file identity changed since adoption: ${fileName}.`);
          // eslint-disable-next-line security/detect-object-injection -- The directory union selects a closed artifact registry.
          files[name].set(fileName, Object.freeze({ identity, name: fileName }));
        } catch (error: unknown) {
          hasPrimaryError = true;
          if (error instanceof LoggingE2eArtifactError) throw error;
          if (isLink(error))
            fail("SYMLINK", `External artifact file is a symbolic link: ${fileName}.`, error);
          fail("IO", `Cannot adopt external artifact file: ${fileName}.`, error);
        } finally {
          if (descriptor !== undefined) close(fs, descriptor, hasPrimaryError);
        }
      }
      return entries;
    };
    const writeExclusiveFile = (name: "raw" | "bundle", fileName: string, contents: Uint8Array): void => {
      if (isCleaned) fail("CLEANUP", "Artifact run has already been cleaned up.");
      validName(fileName);
      revalidateDirectories();
      const target = directory(name);
      const path = descriptorPath(fs, target.descriptor, fileName);
      let descriptor: number | undefined;
      let hasPrimaryError = false;
      try {
        descriptor = fs.open(
          path,
          fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW,
          0o600,
        );
        const identity = fromDescriptor(fs, descriptor, "file");
        revalidateDirectories();
        if (!isSame(identity, fromPath(fs, path, "file")))
          fail("IDENTITY", `Artifact file identity changed after opening: ${fileName}.`);
        fs.write(descriptor, contents);
        fs.fsync(descriptor);
        // eslint-disable-next-line security/detect-object-injection -- The directory union selects a closed artifact registry.
        files[name].set(fileName, Object.freeze({ identity, name: fileName }));
      } catch (error: unknown) {
        hasPrimaryError = true;
        if (error instanceof LoggingE2eArtifactError) throw error;
        if (isExisting(error)) fail("EXISTS", `Artifact file already exists: ${fileName}.`, error);
        if (isLink(error)) fail("SYMLINK", `Artifact file is a symbolic link: ${fileName}.`, error);
        fail("IO", `Cannot write artifact file: ${fileName}.`, error);
      } finally {
        if (descriptor !== undefined) close(fs, descriptor, hasPrimaryError);
      }
    };
    const readFile = (name: "raw" | "bundle", fileName: string): Uint8Array => {
      if (isCleaned) fail("CLEANUP", "Artifact run has already been cleaned up.");
      validName(fileName);
      revalidateDirectories();
      const target = directory(name);
      const path = descriptorPath(fs, target.descriptor, fileName);
      let descriptor: number | undefined;
      let hasPrimaryError = false;
      let contents: Uint8Array | undefined;
      try {
        descriptor = fs.open(path, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
        const identity = fromDescriptor(fs, descriptor, "file");
        // eslint-disable-next-line security/detect-object-injection -- The directory union selects a closed artifact registry.
        const known = files[name].get(fileName);
        if (known !== undefined && !isSame(known.identity, identity))
          fail("IDENTITY", `Artifact file identity changed since registration: ${fileName}.`);
        hooks.afterReadFileOpen?.(fs.join(target.path, fileName));
        revalidateDirectories();
        if (!isSame(identity, fromPath(fs, path, "file")))
          fail("IDENTITY", `Artifact file identity changed after opening: ${fileName}.`);
        contents = fs.read(descriptor);
        revalidateDirectories();
      } catch (error: unknown) {
        hasPrimaryError = true;
        if (error instanceof LoggingE2eArtifactError) throw error;
        if (isLink(error)) fail("SYMLINK", `Artifact file is a symbolic link: ${fileName}.`, error);
        fail("IO", `Cannot read artifact file: ${fileName}.`, error);
      } finally {
        if (descriptor !== undefined) close(fs, descriptor, hasPrimaryError);
      }
      return contents;
    };
    const cleanup = (): void => {
      if (isCleaned) return;
      try {
        revalidateDirectories();
        for (const name of ["raw", "bundle"] as const) {
          const target = directory(name);
          // eslint-disable-next-line security/detect-object-injection -- The directory union selects a closed artifact registry.
          const known = files[name];
          const entries = fs.readdir(descriptorPath(fs, target.descriptor));
          if (entries.length !== known.size || entries.some((entry) => !known.has(entry)))
            fail("CLEANUP", `Artifact directory contains an unknown entry: ${target.path}.`);
          for (const file of known.values())
            if (
              !isSame(file.identity, fromPath(fs, descriptorPath(fs, target.descriptor, file.name), "file"))
            )
              fail("IDENTITY", `Artifact cleanup file identity changed: ${file.name}.`);
        }
        for (const name of ["raw", "bundle"] as const) {
          const target = directory(name);
          // eslint-disable-next-line security/detect-object-injection -- The directory union selects a closed artifact registry.
          const known = files[name];
          for (const file of known.values()) fs.unlink(descriptorPath(fs, target.descriptor, file.name));
          if (fs.readdir(descriptorPath(fs, target.descriptor)).length > 0)
            fail("CLEANUP", `Artifact directory is not empty: ${target.path}.`);
        }
        close(fs, rawDirectory.descriptor);
        close(fs, bundleDirectory.descriptor);
        fs.rmdir(descriptorPath(fs, rootDirectory.descriptor, "raw"));
        fs.rmdir(descriptorPath(fs, rootDirectory.descriptor, "bundle"));
        close(fs, rootDirectory.descriptor);
        fs.rmdir(descriptorPath(fs, temporary.descriptor, fs.basename(paths.root)));
        close(fs, temporary.descriptor);
        isCleaned = true;
      } catch (error: unknown) {
        if (error instanceof LoggingE2eArtifactError) throw error;
        fail("CLEANUP", "Cannot safely clean up logging E2E artifacts.", error);
      }
    };
    // prettier-ignore -- The compact immutable surface keeps this security-critical file within its repository size limit.
    return Object.freeze({
      paths,
      identities,
      adoptExternalFiles,
      writeExclusiveFile,
      readFile,
      revalidateDirectories,
      cleanup,
    });
  } catch (error: unknown) {
    rollbackArtifactRunConstruction({
      bundle,
      fileSystem: fs,
      operations: {
        descriptorPath: (descriptor, child) => descriptorPath(fs, descriptor, child),
        failIdentity: (path) => fail("IDENTITY", `Artifact construction rollback identity changed: ${path}.`),
        fromDescriptor: (descriptor, type) => fromDescriptor(fs, descriptor, type),
        fromPath: (path, type) => fromPath(fs, path, type),
        isSame,
      },
      primary: error,
      raw,
      root,
      freshRootName,
      temporary,
    });
  }
}
