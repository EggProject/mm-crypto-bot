import {
  closeSync,
  constants,
  fchmodSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  renameSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import nodePath from "node:path";

// eslint-disable-next-line unicorn/name-replacements -- Established public E2E artifact contract.
import { type LoggingE2eArtifactRun } from "./logging-e2e-artifact-run.ts";
import { type LoggingEndToEndCoverageSummary } from "./logging-e2e-gate.ts";
import { REPOSITORY_ROOT } from "./logging-e2e-scope.ts";

const PRIVATE_DIRECTORY_MODE = 0o700;
const PRIVATE_FILE_MODE = 0o600;
const SUMMARY_FILE_NAME = "summary.json";
const TEMPORARY_FILE_NAME = ".summary.json.tmp";
const ARTIFACT_FILE_NAME = "e2e-summary.json";
const COVERAGE_DIRECTORY_PARTS = ["packages", "logging", "coverage", "e2e"] as const;

// eslint-disable-next-line unicorn/name-replacements -- Established public E2E summary-publish contract.
export type LoggingE2eSummaryPublisherErrorCode =
  "E_E2E_SUMMARY_UNSUPPORTED" | "SYMLINK" | "TYPE" | "IDENTITY" | "PERMISSION" | "EXISTS" | "IO" | "CLEANUP";

// eslint-disable-next-line unicorn/name-replacements -- Established public E2E summary-publish contract.
export class LoggingE2eSummaryPublisherError extends Error {
  public constructor(
    public readonly code: LoggingE2eSummaryPublisherErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "LoggingE2eSummaryPublisherError";
  }
}
interface SummaryPublisherMetadata {
  readonly dev: bigint;
  readonly ino: bigint;
  readonly mode: bigint;
  readonly uid: bigint;
  isDirectory(): boolean;
  isFile(): boolean;
  isSymbolicLink(): boolean;
}
export interface SummaryPublisherFileSystem {
  readonly platform: string;
  readonly O_RDONLY: unknown;
  readonly O_WRONLY: unknown;
  readonly O_DIRECTORY: unknown;
  readonly O_NOFOLLOW: unknown;
  readonly O_CREAT: unknown;
  readonly O_EXCL: unknown;
  readonly close: (descriptor: number) => void;
  readonly fchmod: (descriptor: number, mode: number) => void;
  readonly fstat: (descriptor: number) => SummaryPublisherMetadata;
  readonly fsync: (descriptor: number) => void;
  readonly getUid?: () => number;
  readonly join: (...parts: readonly string[]) => string;
  readonly lstat: (path: string) => SummaryPublisherMetadata;
  readonly mkdir: (path: string, mode: number) => void;
  readonly open: (path: string, flags: number, mode?: number) => number;
  readonly rename: (source: string, destination: string) => void;
  readonly unlink: (path: string) => void;
  readonly write: (descriptor: number, contents: Uint8Array) => number;
}

interface DirectoryHandle {
  readonly descriptor: number;
  readonly identity: DirectoryIdentity;
  readonly path: string;
}
interface DirectoryIdentity {
  readonly device: bigint;
  readonly inode: bigint;
}

interface SecureFlags {
  readonly create: number;
  readonly directory: number;
  readonly exclusive: number;
  readonly noFollow: number;
  readonly readOnly: number;
  readonly writeOnly: number;
}

export function createNodeSummaryPublisherFileSystem(): SummaryPublisherFileSystem {
  return Object.freeze({
    platform: process.platform,
    O_RDONLY: constants.O_RDONLY,
    O_WRONLY: constants.O_WRONLY,
    O_DIRECTORY: constants.O_DIRECTORY,
    O_NOFOLLOW: constants.O_NOFOLLOW,
    O_CREAT: constants.O_CREAT,
    O_EXCL: constants.O_EXCL,
    close: closeSync,
    fchmod: fchmodSync,
    fstat: (descriptor: number) => fstatSync(descriptor, { bigint: true }),
    fsync: fsyncSync,
    ...(process.getuid !== undefined && { getUid: process.getuid }),
    join: (...parts: readonly string[]) => nodePath.join(...parts),
    lstat: (path: string) => {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- The publisher uses descriptor-anchored paths and verifies each identity.
      return lstatSync(path, { bigint: true });
    },
    mkdir: (path: string, mode: number) => {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- The publisher creates only descriptor-anchored coverage directories.
      mkdirSync(path, { mode });
    },
    open: (path: string, flags: number, mode?: number) => {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- The publisher uses descriptor-anchored paths and O_NOFOLLOW.
      return openSync(path, flags, mode);
    },
    rename: (source: string, destination: string) => {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- Both paths are children of the same verified descriptor-anchored directory.
      renameSync(source, destination);
    },
    unlink: (path: string) => {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- The path is the publisher-created descriptor-anchored temporary file.
      unlinkSync(path);
    },
    write: (descriptor: number, contents: Uint8Array) => writeSync(descriptor, contents),
  });
}

function fail(code: LoggingE2eSummaryPublisherErrorCode, message: string, cause?: unknown): never {
  throw new LoggingE2eSummaryPublisherError(code, message, cause === undefined ? undefined : { cause });
}

function hasErrorCode(error: unknown, code: string): boolean {
  return error !== null && typeof error === "object" && "code" in error && error.code === code;
}

function isSameIdentity(left: DirectoryIdentity, right: DirectoryIdentity): boolean {
  return left.device === right.device && left.inode === right.inode;
}

function identity(metadata: SummaryPublisherMetadata): DirectoryIdentity {
  return Object.freeze({ device: metadata.dev, inode: metadata.ino });
}

function requireFlags(fileSystem: SummaryPublisherFileSystem): SecureFlags {
  const {
    O_CREAT: create,
    O_DIRECTORY: directory,
    O_EXCL: exclusive,
    O_NOFOLLOW: noFollow,
    O_RDONLY: readOnly,
    O_WRONLY: writeOnly,
  } = fileSystem;
  if (
    typeof create !== "number" ||
    typeof directory !== "number" ||
    typeof exclusive !== "number" ||
    typeof noFollow !== "number" ||
    typeof readOnly !== "number" ||
    typeof writeOnly !== "number" ||
    fileSystem.platform !== "linux"
  )
    fail("E_E2E_SUMMARY_UNSUPPORTED", "Summary publishing requires Linux numeric descriptor flags.");
  return Object.freeze({ create, directory, exclusive, noFollow, readOnly, writeOnly });
}

function requireCurrentUid(fileSystem: SummaryPublisherFileSystem): bigint {
  const getUid = fileSystem.getUid;
  if (getUid === undefined)
    fail("E_E2E_SUMMARY_UNSUPPORTED", "Summary publishing requires a Linux current user identifier.");
  const uid = getUid();
  if (!Number.isSafeInteger(uid) || uid < 0)
    fail("E_E2E_SUMMARY_UNSUPPORTED", "Summary publishing requires a Linux current user identifier.");
  return BigInt(uid);
}

function descriptorPath(fileSystem: SummaryPublisherFileSystem, descriptor: number, child: string): string {
  return fileSystem.join(`/proc/self/fd/${String(descriptor)}`, child);
}

function descriptorIdentity(
  fileSystem: SummaryPublisherFileSystem,
  descriptor: number,
  expectedType: "directory" | "file",
): DirectoryIdentity {
  try {
    const metadata = fileSystem.fstat(descriptor);
    if (
      (expectedType === "directory" && !metadata.isDirectory()) ||
      (expectedType === "file" && !metadata.isFile())
    )
      fail("TYPE", `Descriptor is not a regular ${expectedType}.`);
    return identity(metadata);
  } catch (error: unknown) {
    if (error instanceof LoggingE2eSummaryPublisherError) throw error;
    fail("IO", `Cannot inspect ${expectedType} descriptor.`, error);
  }
}

function pathIdentity(
  fileSystem: SummaryPublisherFileSystem,
  path: string,
  expectedType: "directory" | "file",
): DirectoryIdentity {
  try {
    const metadata = fileSystem.lstat(path);
    if (metadata.isSymbolicLink()) fail("SYMLINK", `Symbolic links are forbidden: ${path}.`);
    if (
      (expectedType === "directory" && !metadata.isDirectory()) ||
      (expectedType === "file" && !metadata.isFile())
    )
      fail("TYPE", `Expected a regular ${expectedType}: ${path}.`);
    return identity(metadata);
  } catch (error: unknown) {
    if (error instanceof LoggingE2eSummaryPublisherError) throw error;
    fail("IO", `Cannot inspect ${expectedType} path: ${path}.`, error);
  }
}

function verifyDirectory(fileSystem: SummaryPublisherFileSystem, directory: DirectoryHandle): void {
  const opened = descriptorIdentity(fileSystem, directory.descriptor, "directory");
  const linked = pathIdentity(fileSystem, directory.path, "directory");
  if (!isSameIdentity(directory.identity, opened) || !isSameIdentity(directory.identity, linked))
    fail("IDENTITY", `Directory identity changed: ${directory.path}.`);
}

function verifyPublisherDirectoryPermissions(
  fileSystem: SummaryPublisherFileSystem,
  directory: DirectoryHandle,
  currentUid: bigint,
): void {
  let opened: SummaryPublisherMetadata;
  try {
    opened = fileSystem.fstat(directory.descriptor);
  } catch (error: unknown) {
    fail("IO", `Cannot inspect summary directory permissions: ${directory.path}.`, error);
  }
  if (opened.uid !== currentUid)
    fail("PERMISSION", `Summary directory is not owned by the current user: ${directory.path}.`);
  try {
    fileSystem.fchmod(directory.descriptor, PRIVATE_DIRECTORY_MODE);
  } catch (error: unknown) {
    fail("IO", `Cannot restrict summary directory permissions: ${directory.path}.`, error);
  }
  verifyDirectory(fileSystem, directory);
  let linked: SummaryPublisherMetadata;
  try {
    opened = fileSystem.fstat(directory.descriptor);
    linked = fileSystem.lstat(directory.path);
  } catch (error: unknown) {
    fail("IO", `Cannot recheck summary directory permissions: ${directory.path}.`, error);
  }
  if (
    !isSameIdentity(directory.identity, identity(opened)) ||
    !isSameIdentity(directory.identity, identity(linked))
  )
    fail("IDENTITY", `Directory identity changed while restricting permissions: ${directory.path}.`);
  if (
    opened.uid !== currentUid ||
    linked.uid !== currentUid ||
    (opened.mode & 0o077n) !== 0n ||
    (linked.mode & 0o077n) !== 0n
  )
    fail("PERMISSION", `Summary directory permissions are not private: ${directory.path}.`);
}

function openDirectory(
  fileSystem: SummaryPublisherFileSystem,
  flags: SecureFlags,
  anchoredPath: string,
  verifiedPath: string,
): DirectoryHandle {
  let descriptor: number | undefined;
  try {
    descriptor = fileSystem.open(anchoredPath, flags.readOnly | flags.directory | flags.noFollow);
    const directory = Object.freeze({
      descriptor,
      identity: descriptorIdentity(fileSystem, descriptor, "directory"),
      path: verifiedPath,
    });
    const linkedIdentity = pathIdentity(fileSystem, verifiedPath, "directory");
    if (!isSameIdentity(directory.identity, linkedIdentity))
      fail("IDENTITY", `Directory identity changed: ${verifiedPath}.`);
    return directory;
  } catch (error: unknown) {
    if (descriptor !== undefined) closeAfterFailure(fileSystem, descriptor);
    if (error instanceof LoggingE2eSummaryPublisherError) throw error;
    if (hasErrorCode(error, "ELOOP"))
      fail("SYMLINK", `Symbolic links are forbidden: ${verifiedPath}.`, error);
    fail("IO", `Cannot open summary directory: ${verifiedPath}.`, error);
  }
}

function openOrCreateDirectory(
  fileSystem: SummaryPublisherFileSystem,
  flags: SecureFlags,
  parent: DirectoryHandle,
  name: string,
  currentUid: bigint,
): DirectoryHandle {
  verifyDirectory(fileSystem, parent);
  const anchoredPath = descriptorPath(fileSystem, parent.descriptor, name);
  const verifiedPath = fileSystem.join(parent.path, name);
  try {
    const existingDirectory = openDirectory(fileSystem, flags, anchoredPath, verifiedPath);
    verifyPublisherDirectoryPermissions(fileSystem, existingDirectory, currentUid);
    return existingDirectory;
  } catch (error: unknown) {
    if (
      !(error instanceof LoggingE2eSummaryPublisherError) ||
      error.code !== "IO" ||
      !hasErrorCode(error.cause, "ENOENT")
    )
      throw error;
  }
  try {
    fileSystem.mkdir(anchoredPath, PRIVATE_DIRECTORY_MODE);
  } catch (error: unknown) {
    if (!hasErrorCode(error, "EEXIST"))
      fail("IO", `Cannot create summary directory: ${verifiedPath}.`, error);
  }
  verifyDirectory(fileSystem, parent);
  const directory = openDirectory(fileSystem, flags, anchoredPath, verifiedPath);
  verifyPublisherDirectoryPermissions(fileSystem, directory, currentUid);
  return directory;
}

function openExistingDirectory(
  fileSystem: SummaryPublisherFileSystem,
  flags: SecureFlags,
  parent: DirectoryHandle,
  name: string,
): DirectoryHandle {
  verifyDirectory(fileSystem, parent);
  return openDirectory(
    fileSystem,
    flags,
    descriptorPath(fileSystem, parent.descriptor, name),
    fileSystem.join(parent.path, name),
  );
}

function closeAfterFailure(fileSystem: SummaryPublisherFileSystem, descriptor: number): void {
  try {
    fileSystem.close(descriptor);
  } catch {
    // Preserve the earlier error.
  }
}

function closeDescriptors(
  fileSystem: SummaryPublisherFileSystem,
  descriptors: readonly (number | undefined)[],
): readonly unknown[] {
  const closeErrors: unknown[] = [];
  for (const descriptor of descriptors) {
    if (descriptor === undefined) continue;
    try {
      fileSystem.close(descriptor);
    } catch (error: unknown) {
      closeErrors.push(error);
    }
  }
  return closeErrors;
}

function writeAll(fileSystem: SummaryPublisherFileSystem, descriptor: number, contents: Uint8Array): void {
  for (let offset = 0; offset < contents.byteLength;) {
    const byteCount = fileSystem.write(descriptor, contents.subarray(offset));
    if (byteCount <= 0 || byteCount > contents.byteLength - offset)
      fail("IO", "Cannot write the complete summary contents.");
    offset += byteCount;
  }
}

function verifyExistingSummary(fileSystem: SummaryPublisherFileSystem, summaryPath: string): void {
  try {
    pathIdentity(fileSystem, summaryPath, "file");
  } catch (error: unknown) {
    if (
      error instanceof LoggingE2eSummaryPublisherError &&
      error.code === "IO" &&
      hasErrorCode(error.cause, "ENOENT")
    )
      return;
    throw error;
  }
}

function cleanupTemporary(
  fileSystem: SummaryPublisherFileSystem,
  temporaryPath: string,
): LoggingE2eSummaryPublisherError | undefined {
  try {
    fileSystem.unlink(temporaryPath);
    return undefined;
  } catch (error: unknown) {
    return new LoggingE2eSummaryPublisherError("CLEANUP", "Cannot remove temporary summary file.", {
      cause: error,
    });
  }
}

function closedDirectoryDescriptors(directories: readonly DirectoryHandle[]): readonly number[] {
  const descriptors: number[] = [];
  for (const directory of directories) descriptors.unshift(directory.descriptor);
  return descriptors;
}

export function publishLoggingEndToEndSummary(
  request: Readonly<{ artifactRun: LoggingE2eArtifactRun; summary: LoggingEndToEndCoverageSummary }>,
  fileSystem: SummaryPublisherFileSystem = createNodeSummaryPublisherFileSystem(),
): void {
  const encodedSummary = new TextEncoder().encode(`${JSON.stringify(request.summary, undefined, 2)}\n`);
  request.artifactRun.writeExclusiveFile("bundle", ARTIFACT_FILE_NAME, encodedSummary);
  const verifiedContents = request.artifactRun.readFile("bundle", ARTIFACT_FILE_NAME);
  const flags = requireFlags(fileSystem);
  const currentUid = requireCurrentUid(fileSystem);
  const directories: DirectoryHandle[] = [];
  let temporaryDescriptor: number | undefined;
  let createdTemporaryPath: string | undefined;
  let primaryError: LoggingE2eSummaryPublisherError | undefined;
  try {
    let parent = openDirectory(fileSystem, flags, REPOSITORY_ROOT, REPOSITORY_ROOT);
    directories.push(parent);
    for (const [position, name] of COVERAGE_DIRECTORY_PARTS.entries()) {
      parent =
        position < 2
          ? openExistingDirectory(fileSystem, flags, parent, name)
          : openOrCreateDirectory(fileSystem, flags, parent, name, currentUid);
      directories.push(parent);
    }
    const summaryDirectory = parent;
    for (const directory of directories) verifyDirectory(fileSystem, directory);
    const summaryPath = descriptorPath(fileSystem, summaryDirectory.descriptor, SUMMARY_FILE_NAME);
    const temporaryPath = descriptorPath(fileSystem, summaryDirectory.descriptor, TEMPORARY_FILE_NAME);
    verifyExistingSummary(fileSystem, summaryPath);
    try {
      temporaryDescriptor = fileSystem.open(
        temporaryPath,
        flags.writeOnly | flags.create | flags.exclusive | flags.noFollow,
        PRIVATE_FILE_MODE,
      );
      createdTemporaryPath = temporaryPath;
    } catch (error: unknown) {
      if (hasErrorCode(error, "EEXIST")) fail("EXISTS", "Temporary summary file already exists.", error);
      if (hasErrorCode(error, "ELOOP")) fail("SYMLINK", "Temporary summary file is a symbolic link.", error);
      fail("IO", "Cannot create temporary summary file.", error);
    }
    const temporaryIdentity = descriptorIdentity(fileSystem, temporaryDescriptor, "file");
    if (!isSameIdentity(temporaryIdentity, pathIdentity(fileSystem, temporaryPath, "file")))
      fail("IDENTITY", "Temporary summary file identity changed after creation.");
    writeAll(fileSystem, temporaryDescriptor, verifiedContents);
    fileSystem.fsync(temporaryDescriptor);
    if (!isSameIdentity(temporaryIdentity, pathIdentity(fileSystem, temporaryPath, "file")))
      fail("IDENTITY", "Temporary summary file identity changed before publication.");
    for (const directory of directories) verifyDirectory(fileSystem, directory);
    fileSystem.close(temporaryDescriptor);
    temporaryDescriptor = undefined;
    fileSystem.rename(temporaryPath, summaryPath);
    createdTemporaryPath = undefined;
    for (const directory of directories) verifyDirectory(fileSystem, directory);
    if (!isSameIdentity(temporaryIdentity, pathIdentity(fileSystem, summaryPath, "file")))
      fail("IDENTITY", "Published summary file identity changed after rename.");
    fileSystem.fsync(summaryDirectory.descriptor);
  } catch (error: unknown) {
    primaryError =
      error instanceof LoggingE2eSummaryPublisherError
        ? error
        : new LoggingE2eSummaryPublisherError("IO", "Cannot publish logging E2E summary.", { cause: error });
  }
  let cleanupError: LoggingE2eSummaryPublisherError | undefined;
  if (primaryError !== undefined && createdTemporaryPath !== undefined)
    cleanupError = cleanupTemporary(fileSystem, createdTemporaryPath);
  const closeErrors = closeDescriptors(fileSystem, [
    temporaryDescriptor,
    ...closedDirectoryDescriptors(directories),
  ]);
  if (primaryError === undefined) {
    if (closeErrors.length === 0) return;
    fail(
      "IO",
      "Cannot finish logging E2E summary publication.",
      new AggregateError(closeErrors, "Summary descriptor close failed."),
    );
  }
  const secondaryErrors: unknown[] = [];
  if (cleanupError !== undefined) secondaryErrors.push(cleanupError);
  for (const closeError of closeErrors) secondaryErrors.push(closeError);
  if (secondaryErrors.length === 0) throw primaryError;
  throw new LoggingE2eSummaryPublisherError(primaryError.code, primaryError.message, {
    cause: new AggregateError(
      [primaryError, ...secondaryErrors],
      "Summary publication failed and cleanup or descriptor close also failed.",
    ),
  });
}
