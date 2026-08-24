import { lstatSync } from "node:fs";
import nodePath from "node:path";
import { describe, expect, it } from "vitest";

import {
  createLoggingE2eArtifactRun as createArtifactRun,
  type LoggingE2eArtifactRun as ArtifactRun,
} from "./logging-e2e-artifact-run.ts";
import {
  createNodeSecureDirectoryWriterFileSystem,
  LoggingE2eSecureDirectoryWriteError as SecureDirectoryWriteError,
  writeExclusiveFileToVerifiedDirectory,
  type LoggingE2eSecureDirectoryWriteErrorCode as SecureDirectoryWriteErrorCode,
  type SecureDirectoryWriterFileSystem,
} from "./logging-e2e-secure-directory-writer.ts";

const DIRECTORY_DESCRIPTOR = 71;
const FILE_DESCRIPTOR = 72;
const DIRECTORY_PATH = "/verified-directory";
const LABEL = "secure directory writer test";
const RAW_BYTES = new Uint8Array([114, 97, 119]);

class FileSystemFailure extends Error {
  public constructor(public readonly code: string) {
    super(`Filesystem failure: ${code}`);
  }
}

type MetadataKind = "directory" | "file" | "symlink" | "other";
type SecureDirectoryWriterFileSystemOverrides = Readonly<Partial<SecureDirectoryWriterFileSystem>>;

function metadata(kind: MetadataKind, device = 1n, inode = 1n) {
  return Object.freeze({
    dev: device,
    ino: inode,
    isDirectory: () => kind === "directory",
    isFile: () => kind === "file",
    isSymbolicLink: () => kind === "symlink",
  });
}

function createFileSystem(
  overrides: SecureDirectoryWriterFileSystemOverrides = {},
): SecureDirectoryWriterFileSystem {
  return Object.freeze({
    O_CREAT: 64,
    O_DIRECTORY: 65_536,
    O_EXCL: 128,
    O_NOFOLLOW: 131_072,
    O_RDONLY: 0,
    O_WRONLY: 1,
    close: (descriptor: number) => descriptor,
    fstat: (descriptor: number) => metadata(descriptor === DIRECTORY_DESCRIPTOR ? "directory" : "file"),
    fsync: (descriptor: number) => descriptor,
    join: (...pathParts: readonly string[]) => nodePath.join(...pathParts),
    lstat: (path: string) => metadata(path === DIRECTORY_PATH ? "directory" : "file"),
    open: (_path: string, _flags: number, mode?: number) =>
      mode === undefined ? DIRECTORY_DESCRIPTOR : FILE_DESCRIPTOR,
    platform: "linux",
    write: (_descriptor: number, contents: Uint8Array) => contents.byteLength,
    ...overrides,
  });
}

function createRequest(contents: Uint8Array, fileName = "record.json") {
  return Object.freeze({
    contents,
    directoryPath: DIRECTORY_PATH,
    expectedDirectoryIdentity: Object.freeze({ device: 1n, inode: 1n }),
    fileName,
    label: LABEL,
  });
}

function expectSecureError(
  action: () => void,
  code: SecureDirectoryWriteErrorCode,
  expectedCause?: unknown,
): SecureDirectoryWriteError {
  let thrown: unknown;
  try {
    action();
  } catch (error: unknown) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(SecureDirectoryWriteError);
  if (!(thrown instanceof SecureDirectoryWriteError))
    throw new Error("Expected a secure directory writer error.");
  expect(thrown.code).toBe(code);
  if (expectedCause !== undefined) expect(thrown.cause).toBe(expectedCause);
  return thrown;
}

function requireNumericFlag(flag: unknown, label: string): number {
  if (typeof flag !== "number") throw new Error(`${label} must be numeric for this test.`);
  return flag;
}

function withArtifactRun(action: (artifactRun: ArtifactRun) => void): void {
  const artifactRun = createArtifactRun();
  try {
    action(artifactRun);
  } finally {
    artifactRun.cleanup();
  }
}

describe("logging E2E secure directory writer", () => {
  it("writes, exclusively preserves, adopts, reads, and cleans a real raw artifact", () => {
    withArtifactRun((artifactRun) => {
      const sourceFileSystem = createNodeSecureDirectoryWriterFileSystem();
      const openCalls: {
        readonly descriptor: number;
        readonly flags: number;
        readonly mode: number | undefined;
        readonly path: string;
      }[] = [];
      const fileSystem = createFileSystem({
        ...sourceFileSystem,
        open: (path, flags, mode) => {
          const descriptor = sourceFileSystem.open(path, flags, mode);
          openCalls.push(Object.freeze({ descriptor, flags, mode, path }));
          return descriptor;
        },
      });
      const request = Object.freeze({
        contents: RAW_BYTES,
        directoryPath: artifactRun.paths.raw,
        expectedDirectoryIdentity: artifactRun.identities.raw,
        fileName: "raw.json",
        label: LABEL,
      });

      const identity = writeExclusiveFileToVerifiedDirectory(request, {}, fileSystem);

      expect(Object.isFrozen(identity)).toBe(true);
      expect(typeof identity.device).toBe("bigint");
      expect(typeof identity.inode).toBe("bigint");
      expect(openCalls).toHaveLength(2);
      const [directoryOpen, fileOpen] = openCalls;
      if (directoryOpen === undefined || fileOpen === undefined)
        throw new Error("The real writer must open both the directory and file.");
      expect(directoryOpen.path).toBe(artifactRun.paths.raw);
      expect(directoryOpen.flags).toBe(
        requireNumericFlag(sourceFileSystem.O_RDONLY, "O_RDONLY") |
          requireNumericFlag(sourceFileSystem.O_DIRECTORY, "O_DIRECTORY") |
          requireNumericFlag(sourceFileSystem.O_NOFOLLOW, "O_NOFOLLOW"),
      );
      expect(fileOpen.path).toBe(`/proc/self/fd/${String(directoryOpen.descriptor)}/raw.json`);
      expect(fileOpen.mode).toBe(0o600);
      expect(fileOpen.flags).toBe(
        requireNumericFlag(sourceFileSystem.O_WRONLY, "O_WRONLY") |
          requireNumericFlag(sourceFileSystem.O_CREAT, "O_CREAT") |
          requireNumericFlag(sourceFileSystem.O_EXCL, "O_EXCL") |
          requireNumericFlag(sourceFileSystem.O_NOFOLLOW, "O_NOFOLLOW"),
      );
      expectSecureError(() => writeExclusiveFileToVerifiedDirectory(request, {}, fileSystem), "EXISTS");
      expect(artifactRun.adoptExternalFiles("raw")).toEqual(["raw.json"]);
      expect([...artifactRun.readFile("raw", "raw.json")]).toEqual([...RAW_BYTES]);
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- This exact artifact path was created through the public writer API.
      expect(lstatSync(nodePath.join(artifactRun.paths.raw, "raw.json")).mode & 0o777).toBe(0o600);
    });
  });

  it("creates and adopts an empty file without calling write", () => {
    withArtifactRun((artifactRun) => {
      const sourceFileSystem = createNodeSecureDirectoryWriterFileSystem();
      let writeCalls = 0;
      const fileSystem = createFileSystem({
        ...sourceFileSystem,
        write: (descriptor, contents) => {
          writeCalls += 1;
          return sourceFileSystem.write(descriptor, contents);
        },
      });

      writeExclusiveFileToVerifiedDirectory(
        Object.freeze({
          contents: new Uint8Array(),
          directoryPath: artifactRun.paths.raw,
          expectedDirectoryIdentity: artifactRun.identities.raw,
          fileName: "empty.json",
          label: LABEL,
        }),
        {},
        fileSystem,
      );

      expect(writeCalls).toBe(0);
      expect(artifactRun.adoptExternalFiles("raw")).toEqual(["empty.json"]);
      expect([...artifactRun.readFile("raw", "empty.json")]).toEqual([]);
    });
  });

  it("rejects an escaping file name before opening a descriptor", () => {
    let openCalls = 0;
    expectSecureError(
      () =>
        writeExclusiveFileToVerifiedDirectory(
          createRequest(RAW_BYTES, "../escape.json"),
          {},
          createFileSystem({
            open: (_path, _flags, _mode) => {
              openCalls += 1;
              return DIRECTORY_DESCRIPTOR;
            },
          }),
        ),
      "TYPE",
    );
    expect(openCalls).toBe(0);
  });

  it.each([
    ["platform", createFileSystem({ platform: "darwin" })],
    ["read-only flag", createFileSystem({ O_RDONLY: "invalid" })],
    ["write-only flag", createFileSystem({ O_WRONLY: "invalid" })],
    ["directory flag", createFileSystem({ O_DIRECTORY: "invalid" })],
    ["no-follow flag", createFileSystem({ O_NOFOLLOW: "invalid" })],
    ["create flag", createFileSystem({ O_CREAT: "invalid" })],
    ["exclusive flag", createFileSystem({ O_EXCL: "invalid" })],
  ] as const)("rejects unsupported %s before opening a directory", (_scenario, baseFileSystem) => {
    let openCalls = 0;
    const fileSystem = createFileSystem({
      ...baseFileSystem,
      open: (_path, _flags, _mode) => {
        openCalls += 1;
        return DIRECTORY_DESCRIPTOR;
      },
    });

    expectSecureError(
      () => writeExclusiveFileToVerifiedDirectory(createRequest(RAW_BYTES), {}, fileSystem),
      "E_E2E_SECURE_DIRECTORY_UNSUPPORTED",
    );
    expect(openCalls).toBe(0);
  });

  it.each([
    ["a symlink", new FileSystemFailure("ELOOP"), "SYMLINK"],
    ["an I/O failure", new FileSystemFailure("EIO"), "IO"],
  ] as const)("maps directory open %s without file side effects", (_scenario, cause, code) => {
    let openCalls = 0;
    let writeCalls = 0;
    const error = expectSecureError(
      () =>
        writeExclusiveFileToVerifiedDirectory(
          createRequest(RAW_BYTES),
          {},
          createFileSystem({
            open: (_path, _flags, _mode) => {
              openCalls += 1;
              throw cause;
            },
            write: (_descriptor, _contents) => {
              writeCalls += 1;
              return 0;
            },
          }),
        ),
      code,
      cause,
    );
    expect(error.cause).toBe(cause);
    expect(openCalls).toBe(1);
    expect(writeCalls).toBe(0);
  });

  it.each([
    ["a non-directory descriptor", createFileSystem({ fstat: (_descriptor) => metadata("other") }), "TYPE"],
    [
      "a directory descriptor inspection failure",
      createFileSystem({
        fstat: (_descriptor) => {
          throw new FileSystemFailure("EIO");
        },
      }),
      "IO",
    ],
  ] as const)("closes the directory after %s", (_scenario, baseFileSystem, code) => {
    const closedDescriptors: number[] = [];
    const error = expectSecureError(
      () =>
        writeExclusiveFileToVerifiedDirectory(
          createRequest(RAW_BYTES),
          {},
          createFileSystem({
            ...baseFileSystem,
            close: (descriptor) => {
              closedDescriptors.push(descriptor);
            },
          }),
        ),
      code,
    );
    if (code === "IO") expect(error.cause).toBeInstanceOf(FileSystemFailure);
    expect(closedDescriptors).toEqual([DIRECTORY_DESCRIPTOR]);
  });

  it.each([
    ["a symlink directory path", createFileSystem({ lstat: (_path) => metadata("symlink") }), "SYMLINK"],
    ["a non-directory path", createFileSystem({ lstat: (_path) => metadata("other") }), "TYPE"],
    [
      "a directory path inspection failure",
      createFileSystem({
        lstat: (_path) => {
          throw new FileSystemFailure("EIO");
        },
      }),
      "IO",
    ],
  ] as const)("closes the directory after %s", (_scenario, baseFileSystem, code) => {
    const closedDescriptors: number[] = [];
    const error = expectSecureError(
      () =>
        writeExclusiveFileToVerifiedDirectory(
          createRequest(RAW_BYTES),
          {},
          createFileSystem({
            ...baseFileSystem,
            close: (descriptor) => {
              closedDescriptors.push(descriptor);
            },
          }),
        ),
      code,
    );
    if (code === "IO") expect(error.cause).toBeInstanceOf(FileSystemFailure);
    expect(closedDescriptors).toEqual([DIRECTORY_DESCRIPTOR]);
  });

  it("rejects a directory descriptor identity mismatch before creating a file", () => {
    let fileOpenCalls = 0;
    expectSecureError(
      () =>
        writeExclusiveFileToVerifiedDirectory(
          createRequest(RAW_BYTES),
          {},
          createFileSystem({
            fstat: (descriptor) =>
              descriptor === DIRECTORY_DESCRIPTOR ? metadata("directory", 2n, 2n) : metadata("file"),
            open: (_path, _flags, mode) => {
              if (mode !== undefined) fileOpenCalls += 1;
              return mode === undefined ? DIRECTORY_DESCRIPTOR : FILE_DESCRIPTOR;
            },
          }),
        ),
      "IDENTITY",
    );
    expect(fileOpenCalls).toBe(0);
  });

  it("rejects a directory identity change after file opening before writing", () => {
    let directoryFstatCalls = 0;
    let fileOpenCalls = 0;
    let writeCalls = 0;
    expectSecureError(
      () =>
        writeExclusiveFileToVerifiedDirectory(
          createRequest(RAW_BYTES),
          {},
          createFileSystem({
            fstat: (descriptor) => {
              if (descriptor === FILE_DESCRIPTOR) return metadata("file");
              directoryFstatCalls += 1;
              return directoryFstatCalls === 2 ? metadata("directory", 2n, 2n) : metadata("directory");
            },
            open: (_path, _flags, mode) => {
              if (mode !== undefined) fileOpenCalls += 1;
              return mode === undefined ? DIRECTORY_DESCRIPTOR : FILE_DESCRIPTOR;
            },
            write: (_descriptor, _contents) => {
              writeCalls += 1;
              return RAW_BYTES.byteLength;
            },
          }),
        ),
      "IDENTITY",
    );
    expect(directoryFstatCalls).toBe(2);
    expect(fileOpenCalls).toBe(1);
    expect(writeCalls).toBe(0);
  });
});
