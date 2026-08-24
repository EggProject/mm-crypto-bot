import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync } from "node:fs";

import { assertSafeExistingFileWithinRoot } from "./logging-e2e-path-boundary.ts";

// eslint-disable-next-line unicorn/name-replacements -- Established public E2E secure-file contract.
export type LoggingE2eSecureFileErrorCode =
  "E_E2E_SECURE_FILE_UNSUPPORTED" | "SYMLINK" | "TYPE" | "IDENTITY" | "IO";

// eslint-disable-next-line unicorn/name-replacements -- Established public E2E secure-file contract.
export class LoggingE2eSecureFileError extends Error {
  public constructor(
    public readonly code: LoggingE2eSecureFileErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "LoggingE2eSecureFileError";
  }
}

export interface SecureRegularFileIdentity {
  readonly device: bigint;
  readonly inode: bigint;
}

export interface SecureRegularFileRead {
  readonly contents: Uint8Array;
  readonly identity: SecureRegularFileIdentity;
}

export interface SecureFileReaderFileMetadata {
  readonly dev: bigint;
  readonly ino: bigint;
  isFile(): boolean;
  isSymbolicLink(): boolean;
}

export interface SecureFileReaderFileSystem {
  readonly platform: string;
  readonly O_RDONLY: unknown;
  readonly O_NOFOLLOW: unknown;
  readonly close: (descriptor: number) => void;
  readonly fstat: (descriptor: number) => SecureFileReaderFileMetadata;
  readonly lstat: (path: string) => SecureFileReaderFileMetadata;
  readonly open: (path: string, flags: number) => number;
  readonly read: (descriptor: number) => Uint8Array;
}

export interface SecureFileReaderHooks {
  readonly afterOpen?: (path: string) => void;
}

export function createNodeSecureFileReaderFileSystem(): SecureFileReaderFileSystem {
  return Object.freeze({
    platform: process.platform,
    O_RDONLY: constants.O_RDONLY,
    O_NOFOLLOW: constants.O_NOFOLLOW,
    close: (descriptor: number) => {
      closeSync(descriptor);
    },
    fstat: (descriptor: number) => fstatSync(descriptor, { bigint: true }),
    lstat: (path: string) => {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- This adapter is preceded and followed by root-boundary verification.
      return lstatSync(path, { bigint: true });
    },
    open: (path: string, flags: number) => {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- This adapter is preceded and followed by root-boundary verification.
      return openSync(path, flags);
    },
    read: (descriptor: number) => {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- The numeric descriptor is created by this adapter.
      return readFileSync(descriptor);
    },
  });
}

function fail(code: LoggingE2eSecureFileErrorCode, message: string, cause?: unknown): never {
  throw new LoggingE2eSecureFileError(code, message, cause === undefined ? undefined : { cause });
}

function isSameIdentity(left: SecureRegularFileIdentity, right: SecureRegularFileIdentity): boolean {
  return left.device === right.device && left.inode === right.inode;
}

function isSymbolicLinkOpenError(error: unknown): boolean {
  return error !== null && typeof error === "object" && "code" in error && error.code === "ELOOP";
}

function requireLinuxNoFollowSupport(fileSystem: SecureFileReaderFileSystem): {
  readonly noFollowFlag: number;
  readonly readOnlyFlag: number;
} {
  const { O_NOFOLLOW: noFollowFlag, O_RDONLY: readOnlyFlag } = fileSystem;
  if (typeof noFollowFlag !== "number" || typeof readOnlyFlag !== "number" || fileSystem.platform !== "linux")
    fail(
      "E_E2E_SECURE_FILE_UNSUPPORTED",
      "Verified regular-file reads require Linux O_RDONLY and O_NOFOLLOW support.",
    );
  return Object.freeze({ noFollowFlag, readOnlyFlag });
}

function verifyPathBoundary(path: string, root: string, label: string): void {
  try {
    assertSafeExistingFileWithinRoot(path, root, label);
  } catch (error: unknown) {
    fail("IO", `Cannot verify ${label} path boundary: ${path}.`, error);
  }
}

function descriptorIdentity(
  fileSystem: SecureFileReaderFileSystem,
  descriptor: number,
): SecureRegularFileIdentity {
  try {
    const metadata = fileSystem.fstat(descriptor);
    if (!metadata.isFile()) fail("TYPE", "Opened descriptor is not a regular file.");
    return Object.freeze({ device: metadata.dev, inode: metadata.ino });
  } catch (error: unknown) {
    if (error instanceof LoggingE2eSecureFileError) throw error;
    fail("IO", "Cannot inspect opened file descriptor.", error);
  }
}

function pathIdentity(fileSystem: SecureFileReaderFileSystem, path: string): SecureRegularFileIdentity {
  try {
    const metadata = fileSystem.lstat(path);
    if (metadata.isSymbolicLink()) fail("SYMLINK", `Symbolic links are forbidden: ${path}.`);
    if (!metadata.isFile()) fail("TYPE", `Expected a regular file: ${path}.`);
    return Object.freeze({ device: metadata.dev, inode: metadata.ino });
  } catch (error: unknown) {
    if (error instanceof LoggingE2eSecureFileError) throw error;
    fail("IO", `Cannot inspect file path: ${path}.`, error);
  }
}

function verifyFileIdentity(
  fileSystem: SecureFileReaderFileSystem,
  descriptor: number,
  path: string,
  root: string,
  label: string,
  openedIdentity: SecureRegularFileIdentity,
): void {
  verifyPathBoundary(path, root, label);
  const currentPathIdentity = pathIdentity(fileSystem, path);
  const currentDescriptorIdentity = descriptorIdentity(fileSystem, descriptor);
  if (
    !isSameIdentity(openedIdentity, currentPathIdentity) ||
    !isSameIdentity(openedIdentity, currentDescriptorIdentity)
  )
    fail("IDENTITY", `Regular-file identity changed while reading ${label}: ${path}.`);
}

function verifyFileIdentityAfterRead(
  fileSystem: SecureFileReaderFileSystem,
  descriptor: number,
  path: string,
  root: string,
  label: string,
  openedIdentity: SecureRegularFileIdentity,
): void {
  const currentDescriptorIdentity = descriptorIdentity(fileSystem, descriptor);
  verifyPathBoundary(path, root, label);
  const currentPathIdentity = pathIdentity(fileSystem, path);
  if (
    !isSameIdentity(openedIdentity, currentDescriptorIdentity) ||
    !isSameIdentity(openedIdentity, currentPathIdentity)
  )
    fail("IDENTITY", `Regular-file identity changed while reading ${label}: ${path}.`);
}

function closeAfterPrimaryError(
  fileSystem: SecureFileReaderFileSystem,
  descriptor: number,
  primaryError: LoggingE2eSecureFileError,
): never {
  try {
    fileSystem.close(descriptor);
  } catch (closeError: unknown) {
    throw new LoggingE2eSecureFileError(primaryError.code, primaryError.message, {
      cause: new AggregateError([primaryError, closeError], "Secure file read and close both failed."),
    });
  }
  throw primaryError;
}

export function readVerifiedRegularFile(
  path: string,
  root: string,
  label: string,
  hooks: SecureFileReaderHooks = {},
  fileSystem: SecureFileReaderFileSystem = createNodeSecureFileReaderFileSystem(),
): SecureRegularFileRead {
  const { noFollowFlag, readOnlyFlag } = requireLinuxNoFollowSupport(fileSystem);
  verifyPathBoundary(path, root, label);
  let descriptor: number | undefined;
  try {
    try {
      descriptor = fileSystem.open(path, readOnlyFlag | noFollowFlag);
    } catch (error: unknown) {
      if (isSymbolicLinkOpenError(error)) fail("SYMLINK", `Symbolic links are forbidden: ${path}.`, error);
      fail("IO", `Cannot open regular file: ${path}.`, error);
    }
    const identity = descriptorIdentity(fileSystem, descriptor);
    hooks.afterOpen?.(path);
    verifyFileIdentity(fileSystem, descriptor, path, root, label, identity);
    const contents = fileSystem.read(descriptor);
    verifyFileIdentityAfterRead(fileSystem, descriptor, path, root, label, identity);
    const descriptorToClose = descriptor;
    descriptor = undefined;
    fileSystem.close(descriptorToClose);
    return Object.freeze({ contents, identity });
  } catch (error: unknown) {
    const primaryError =
      error instanceof LoggingE2eSecureFileError
        ? error
        : new LoggingE2eSecureFileError("IO", `Cannot read regular file: ${path}.`, { cause: error });
    if (descriptor !== undefined) return closeAfterPrimaryError(fileSystem, descriptor, primaryError);
    throw primaryError;
  }
}
