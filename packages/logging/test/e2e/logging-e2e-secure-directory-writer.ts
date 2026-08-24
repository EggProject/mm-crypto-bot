import { closeSync, constants, fstatSync, fsyncSync, lstatSync, openSync, writeSync } from "node:fs";
import nodePath from "node:path";
export type SecureDirectoryIdentity = Readonly<{ device: bigint; inode: bigint }>;

// eslint-disable-next-line unicorn/name-replacements -- Established public E2E secure-directory-write contract.
export type LoggingE2eSecureDirectoryWriteErrorCode =
  "E_E2E_SECURE_DIRECTORY_UNSUPPORTED" | "SYMLINK" | "TYPE" | "IDENTITY" | "EXISTS" | "IO";
// eslint-disable-next-line unicorn/name-replacements -- Established public E2E secure-directory-write contract.
export class LoggingE2eSecureDirectoryWriteError extends Error {
  public constructor(
    public readonly code: LoggingE2eSecureDirectoryWriteErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "LoggingE2eSecureDirectoryWriteError";
  }
}
interface SecureDirectoryWriterMetadata {
  readonly dev: bigint;
  readonly ino: bigint;
  isDirectory(): boolean;
  isFile(): boolean;
  isSymbolicLink(): boolean;
}
export interface SecureDirectoryWriterFileSystem {
  readonly platform: string;
  readonly O_RDONLY: unknown;
  readonly O_WRONLY: unknown;
  readonly O_DIRECTORY: unknown;
  readonly O_NOFOLLOW: unknown;
  readonly O_CREAT: unknown;
  readonly O_EXCL: unknown;
  readonly close: (descriptor: number) => void;
  readonly fstat: (descriptor: number) => SecureDirectoryWriterMetadata;
  readonly fsync: (descriptor: number) => void;
  readonly join: (...pathParts: readonly string[]) => string;
  readonly lstat: (path: string) => SecureDirectoryWriterMetadata;
  readonly open: (path: string, flags: number, mode?: number) => number;
  readonly write: (descriptor: number, contents: Uint8Array) => number;
}
export interface SecureDirectoryWriterHooks {
  readonly afterFileOpen?: (path: string) => void;
}
export interface VerifiedDirectoryWriteRequest {
  readonly directoryPath: string;
  readonly expectedDirectoryIdentity: SecureDirectoryIdentity;
  readonly fileName: string;
  readonly contents: Uint8Array;
  readonly label: string;
}
export function createNodeSecureDirectoryWriterFileSystem(): SecureDirectoryWriterFileSystem {
  return Object.freeze({
    platform: process.platform,
    O_RDONLY: constants.O_RDONLY,
    O_WRONLY: constants.O_WRONLY,
    O_DIRECTORY: constants.O_DIRECTORY,
    O_NOFOLLOW: constants.O_NOFOLLOW,
    O_CREAT: constants.O_CREAT,
    O_EXCL: constants.O_EXCL,
    close: closeSync,
    fstat: (descriptor: number) => fstatSync(descriptor, { bigint: true }),
    fsync: fsyncSync,
    join: (...pathParts: readonly string[]) => nodePath.join(...pathParts),
    lstat: (path: string) => {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- Every path is verified by descriptor and identity checks around the operation.
      return lstatSync(path, { bigint: true });
    },
    open: (path: string, flags: number, mode?: number) => {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- The directory is opened without following links; child writes use its procfd path.
      return openSync(path, flags, mode);
    },
    write: (descriptor: number, contents: Uint8Array) => writeSync(descriptor, contents),
  });
}
function fail(code: LoggingE2eSecureDirectoryWriteErrorCode, message: string, cause?: unknown): never {
  throw new LoggingE2eSecureDirectoryWriteError(code, message, cause === undefined ? undefined : { cause });
}
function isSameIdentity(left: SecureDirectoryIdentity, right: SecureDirectoryIdentity): boolean {
  return left.device === right.device && left.inode === right.inode;
}
function hasErrorCode(error: unknown, code: string): boolean {
  return error !== null && typeof error === "object" && "code" in error && error.code === code;
}
function requireSecureWriteFlags(fileSystem: SecureDirectoryWriterFileSystem): {
  readonly create: number;
  readonly directory: number;
  readonly exclusive: number;
  readonly noFollow: number;
  readonly readOnly: number;
  readonly writeOnly: number;
} {
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
    fail("E_E2E_SECURE_DIRECTORY_UNSUPPORTED", "Verified directory writes require Linux numeric open flags.");
  return Object.freeze({ create, directory, exclusive, noFollow, readOnly, writeOnly });
}
function identityFromMetadata(metadata: SecureDirectoryWriterMetadata): SecureDirectoryIdentity {
  return Object.freeze({ device: metadata.dev, inode: metadata.ino });
}
function descriptorIdentity(
  fileSystem: SecureDirectoryWriterFileSystem,
  descriptor: number,
  expectedType: "directory" | "file",
): SecureDirectoryIdentity {
  try {
    const metadata = fileSystem.fstat(descriptor);
    if (
      (expectedType === "directory" && !metadata.isDirectory()) ||
      (expectedType === "file" && !metadata.isFile())
    )
      fail("TYPE", `Opened descriptor is not a regular ${expectedType}.`);
    return identityFromMetadata(metadata);
  } catch (error: unknown) {
    if (error instanceof LoggingE2eSecureDirectoryWriteError) throw error;
    fail("IO", `Cannot inspect opened ${expectedType} descriptor.`, error);
  }
}
function pathIdentity(
  fileSystem: SecureDirectoryWriterFileSystem,
  path: string,
  expectedType: "directory" | "file",
): SecureDirectoryIdentity {
  try {
    const metadata = fileSystem.lstat(path);
    if (metadata.isSymbolicLink()) fail("SYMLINK", `Symbolic links are forbidden: ${path}.`);
    if (
      (expectedType === "directory" && !metadata.isDirectory()) ||
      (expectedType === "file" && !metadata.isFile())
    )
      fail("TYPE", `Expected a regular ${expectedType}: ${path}.`);
    return identityFromMetadata(metadata);
  } catch (error: unknown) {
    if (error instanceof LoggingE2eSecureDirectoryWriteError) throw error;
    fail("IO", `Cannot inspect ${expectedType} path: ${path}.`, error);
  }
}
function verifyDirectoryIdentity(
  fileSystem: SecureDirectoryWriterFileSystem,
  descriptor: number,
  directoryPath: string,
  expectedIdentity: SecureDirectoryIdentity,
): void {
  const openedDirectoryIdentity = descriptorIdentity(fileSystem, descriptor, "directory");
  const pathDirectoryIdentity = pathIdentity(fileSystem, directoryPath, "directory");
  if (
    !isSameIdentity(expectedIdentity, openedDirectoryIdentity) ||
    !isSameIdentity(expectedIdentity, pathDirectoryIdentity)
  )
    fail("IDENTITY", `Directory identity changed while writing: ${directoryPath}.`);
}
function verifyFileIdentity(
  fileSystem: SecureDirectoryWriterFileSystem,
  descriptor: number,
  filePath: string,
  expectedIdentity: SecureDirectoryIdentity,
): void {
  const openedFileIdentity = descriptorIdentity(fileSystem, descriptor, "file");
  const pathFileIdentity = pathIdentity(fileSystem, filePath, "file");
  if (
    !isSameIdentity(expectedIdentity, openedFileIdentity) ||
    !isSameIdentity(expectedIdentity, pathFileIdentity)
  )
    fail("IDENTITY", `File identity changed while writing: ${filePath}.`);
}
function closeDescriptors(
  fileSystem: SecureDirectoryWriterFileSystem,
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
function throwWithCloseErrors(
  primaryError: LoggingE2eSecureDirectoryWriteError,
  closeErrors: readonly unknown[],
): never {
  if (closeErrors.length === 0) throw primaryError;
  throw new LoggingE2eSecureDirectoryWriteError(primaryError.code, primaryError.message, {
    cause: new AggregateError(
      [primaryError, ...closeErrors],
      "Secure directory write and close both failed.",
    ),
  });
}
function writeAll(
  fileSystem: SecureDirectoryWriterFileSystem,
  descriptor: number,
  contents: Uint8Array,
): void {
  for (let writtenByteCount = 0; writtenByteCount < contents.byteLength;) {
    const byteCount = fileSystem.write(descriptor, contents.subarray(writtenByteCount));
    if (byteCount <= 0 || byteCount > contents.byteLength - writtenByteCount)
      fail("IO", "Cannot write the complete file contents.");
    writtenByteCount += byteCount;
  }
}
export function writeExclusiveFileToVerifiedDirectory(
  request: VerifiedDirectoryWriteRequest,
  hooks: SecureDirectoryWriterHooks = {},
  fileSystem: SecureDirectoryWriterFileSystem = createNodeSecureDirectoryWriterFileSystem(),
): SecureDirectoryIdentity {
  const { contents, directoryPath, expectedDirectoryIdentity, fileName, label } = request;
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(fileName)) fail("TYPE", `Invalid ${label} file name.`);
  const flags = requireSecureWriteFlags(fileSystem);
  let directoryDescriptor: number | undefined;
  let fileDescriptor: number | undefined;
  try {
    try {
      directoryDescriptor = fileSystem.open(directoryPath, flags.readOnly | flags.directory | flags.noFollow);
    } catch (error: unknown) {
      if (hasErrorCode(error, "ELOOP"))
        fail("SYMLINK", `Symbolic links are forbidden: ${directoryPath}.`, error);
      fail("IO", `Cannot open ${label} directory: ${directoryPath}.`, error);
    }
    verifyDirectoryIdentity(fileSystem, directoryDescriptor, directoryPath, expectedDirectoryIdentity);
    const filePath = fileSystem.join("/proc/self/fd", String(directoryDescriptor), fileName);
    try {
      fileDescriptor = fileSystem.open(
        filePath,
        flags.writeOnly | flags.create | flags.exclusive | flags.noFollow,
        0o600,
      );
    } catch (error: unknown) {
      if (hasErrorCode(error, "EEXIST")) fail("EXISTS", `File already exists: ${filePath}.`, error);
      if (hasErrorCode(error, "ELOOP")) fail("SYMLINK", `Symbolic links are forbidden: ${filePath}.`, error);
      fail("IO", `Cannot create exclusive file: ${filePath}.`, error);
    }
    const fileIdentity = descriptorIdentity(fileSystem, fileDescriptor, "file");
    hooks.afterFileOpen?.(filePath);
    verifyFileIdentity(fileSystem, fileDescriptor, filePath, fileIdentity);
    verifyDirectoryIdentity(fileSystem, directoryDescriptor, directoryPath, expectedDirectoryIdentity);
    writeAll(fileSystem, fileDescriptor, contents);
    fileSystem.fsync(fileDescriptor);
    verifyFileIdentity(fileSystem, fileDescriptor, filePath, fileIdentity);
    verifyDirectoryIdentity(fileSystem, directoryDescriptor, directoryPath, expectedDirectoryIdentity);
    const closeErrors = closeDescriptors(fileSystem, [fileDescriptor, directoryDescriptor]);
    fileDescriptor = undefined;
    directoryDescriptor = undefined;
    if (closeErrors.length > 0)
      fail(
        "IO",
        "Cannot close secure directory write descriptors.",
        closeErrors.length === 1
          ? closeErrors[0]
          : new AggregateError(closeErrors, "Multiple descriptor closes failed."),
      );
    return fileIdentity;
  } catch (error: unknown) {
    const primaryError =
      error instanceof LoggingE2eSecureDirectoryWriteError
        ? error
        : new LoggingE2eSecureDirectoryWriteError("IO", `Cannot write ${label} file.`, { cause: error });
    const closeErrors = closeDescriptors(fileSystem, [fileDescriptor, directoryDescriptor]);
    throwWithCloseErrors(primaryError, closeErrors);
  }
}
