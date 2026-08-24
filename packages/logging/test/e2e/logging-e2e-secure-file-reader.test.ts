import {
  closeSync,
  fstatSync,
  lstatSync,
  mkdtempSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import nodePath from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";

import {
  LoggingE2eSecureFileError as SecureFileError,
  readVerifiedRegularFile,
  type LoggingE2eSecureFileErrorCode as SecureFileErrorCode,
  type SecureFileReaderFileMetadata,
  type SecureFileReaderFileSystem,
} from "./logging-e2e-secure-file-reader.ts";

const LABEL = "secure reader test";
const OPENED_DESCRIPTOR = 37;
const ORIGINAL_BYTES = new Uint8Array([111, 108, 100]);
const REPLACEMENT_BYTES = new Uint8Array([110, 101, 119]);

class FileSystemFailure extends Error {
  public constructor(public readonly code: string) {
    super(`Filesystem failure: ${code}`);
  }
}

interface FreshFile {
  readonly filePath: string;
  readonly rootPath: string;
}

type SecureFileReaderFileSystemOverrides = Readonly<Partial<SecureFileReaderFileSystem>>;

function metadata(
  kind: "file" | "symlink" | "other" = "file",
  device = 1n,
  inode = 1n,
): SecureFileReaderFileMetadata {
  return Object.freeze({
    dev: device,
    ino: inode,
    isFile: () => kind === "file",
    isSymbolicLink: () => kind === "symlink",
  });
}

function createFileSystem(overrides: SecureFileReaderFileSystemOverrides = {}): SecureFileReaderFileSystem {
  return Object.freeze({
    O_NOFOLLOW: 131_072,
    O_RDONLY: 0,
    close: (descriptor: number) => descriptor,
    fstat: (_descriptor: number) => metadata(),
    lstat: (_path: string) => metadata(),
    open: (_path: string, _flags: number) => OPENED_DESCRIPTOR,
    platform: "linux",
    read: (_descriptor: number) => ORIGINAL_BYTES,
    ...overrides,
  });
}

function expectSecureError(
  action: () => void,
  code: SecureFileErrorCode,
  expectedCause?: unknown,
): SecureFileError {
  let thrown: unknown;
  try {
    action();
  } catch (error: unknown) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(SecureFileError);
  if (!(thrown instanceof SecureFileError)) throw new Error("Expected a secure file reader error.");
  expect(thrown.code).toBe(code);
  if (expectedCause !== undefined) expect(thrown.cause).toBe(expectedCause);
  return thrown;
}

function withFreshFile<T>(contents: Uint8Array, action: (freshFile: FreshFile) => T): T {
  const rootPath = mkdtempSync(nodePath.join(tmpdir(), "logging-secure-reader-"));
  const filePath = nodePath.join(rootPath, "input.json");
  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- This exact path is contained by this test's fresh directory.
    writeFileSync(filePath, contents);
    return action(Object.freeze({ filePath, rootPath }));
  } finally {
    rmSync(rootPath, { force: true, recursive: true });
  }
}

describe("logging E2E secure file reader", () => {
  it("reads exact bytes from a fresh regular file and freezes the result identity", () => {
    withFreshFile(ORIGINAL_BYTES, ({ filePath, rootPath }) => {
      const result = readVerifiedRegularFile(filePath, rootPath, LABEL);

      expect([...result.contents]).toEqual([...ORIGINAL_BYTES]);
      expect(Object.isFrozen(result)).toBe(true);
      expect(Object.isFrozen(result.identity)).toBe(true);
      expect(typeof result.identity.device).toBe("bigint");
      expect(typeof result.identity.inode).toBe("bigint");
    });
  });

  it.each([
    ["platform", createFileSystem({ platform: "darwin" })],
    ["read-only flag", createFileSystem({ O_RDONLY: "invalid" })],
    ["no-follow flag", createFileSystem({ O_NOFOLLOW: "invalid" })],
  ] as const)("rejects unsupported %s before opening a file", (_scenario, fileSystem) => {
    let openCalls = 0;
    const countedFileSystem = createFileSystem({
      ...fileSystem,
      open: (_path, _flags) => {
        openCalls += 1;
        return OPENED_DESCRIPTOR;
      },
    });

    expectSecureError(
      () => readVerifiedRegularFile("/unused", "/unused", LABEL, {}, countedFileSystem),
      "E_E2E_SECURE_FILE_UNSUPPORTED",
    );
    expect(openCalls).toBe(0);
  });

  it("wraps path-boundary rejection as an I/O error with its cause", () => {
    withFreshFile(ORIGINAL_BYTES, ({ rootPath }) => {
      const boundaryCause = expectSecureError(
        () =>
          readVerifiedRegularFile(`${rootPath}-outside/input.json`, rootPath, LABEL, {}, createFileSystem()),
        "IO",
      ).cause;

      expect(boundaryCause).toBeInstanceOf(Error);
    });
  });

  it.each([
    ["a symlink open error", new FileSystemFailure("ELOOP"), "SYMLINK"],
    ["a generic open error", new FileSystemFailure("EIO"), "IO"],
  ] as const)("preserves %s without closing an unopened descriptor", (_scenario, cause, code) => {
    withFreshFile(ORIGINAL_BYTES, ({ filePath, rootPath }) => {
      let closeCalls = 0;
      const error = expectSecureError(
        () =>
          readVerifiedRegularFile(
            filePath,
            rootPath,
            LABEL,
            {},
            createFileSystem({
              close: (_descriptor) => {
                closeCalls += 1;
              },
              open: (_path, _flags) => {
                throw cause;
              },
            }),
          ),
        code,
        cause,
      );

      expect(error.cause).toBe(cause);
      expect(closeCalls).toBe(0);
    });
  });

  it.each([
    ["a non-file descriptor", createFileSystem({ fstat: (_descriptor) => metadata("other") }), "TYPE"],
    [
      "a descriptor inspection failure",
      createFileSystem({
        fstat: (_descriptor) => {
          throw new FileSystemFailure("EIO");
        },
      }),
      "IO",
    ],
  ] as const)("closes a descriptor after %s", (_scenario, baseFileSystem, code) => {
    withFreshFile(ORIGINAL_BYTES, ({ filePath, rootPath }) => {
      const closedDescriptors: number[] = [];
      const error = expectSecureError(
        () =>
          readVerifiedRegularFile(
            filePath,
            rootPath,
            LABEL,
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
      expect(closedDescriptors).toEqual([OPENED_DESCRIPTOR]);
    });
  });

  it.each([
    ["a symlink path", createFileSystem({ lstat: (_path) => metadata("symlink") }), "SYMLINK"],
    ["a non-file path", createFileSystem({ lstat: (_path) => metadata("other") }), "TYPE"],
    [
      "a path inspection failure",
      createFileSystem({
        lstat: (_path) => {
          throw new FileSystemFailure("EIO");
        },
      }),
      "IO",
    ],
  ] as const)("closes a descriptor after %s", (_scenario, baseFileSystem, code) => {
    withFreshFile(ORIGINAL_BYTES, ({ filePath, rootPath }) => {
      const closedDescriptors: number[] = [];
      const error = expectSecureError(
        () =>
          readVerifiedRegularFile(
            filePath,
            rootPath,
            LABEL,
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
      expect(closedDescriptors).toEqual([OPENED_DESCRIPTOR]);
    });
  });

  it("detects a real rename and replacement after open without reading replacement bytes", () => {
    withFreshFile(ORIGINAL_BYTES, ({ filePath, rootPath }) => {
      const movedPath = nodePath.join(rootPath, "opened-original.json");
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- This exact path belongs to this test's fresh directory.
      const openedMetadata = lstatSync(filePath, { bigint: true });
      const replacementMetadata = metadata("file", openedMetadata.dev + 1n, openedMetadata.ino + 1n);
      let lstatCalls = 0;
      let observedRead: Uint8Array | undefined;
      let closeCalls = 0;
      const fileSystem = createFileSystem({
        close: (descriptor) => {
          closeCalls += 1;
          closeSync(descriptor);
        },
        fstat: (descriptor) => fstatSync(descriptor, { bigint: true }),
        lstat: (_path) => {
          lstatCalls += 1;
          if (lstatCalls === 1) return metadata("file", openedMetadata.dev, openedMetadata.ino);
          return replacementMetadata;
        },
        open: (path, flags) => {
          // eslint-disable-next-line security/detect-non-literal-fs-filename -- This path is the already boundary-verified fresh test file.
          return openSync(path, flags);
        },
        read: (descriptor) => {
          // eslint-disable-next-line security/detect-non-literal-fs-filename -- This descriptor was opened by this test's injected secure-file port.
          observedRead = readFileSync(descriptor);
          return observedRead;
        },
      });

      const error = expectSecureError(
        () =>
          readVerifiedRegularFile(
            filePath,
            rootPath,
            LABEL,
            {
              afterOpen: (openedPath) => {
                // eslint-disable-next-line security/detect-non-literal-fs-filename -- This exact path belongs to this test's fresh directory.
                renameSync(openedPath, movedPath);
                // eslint-disable-next-line security/detect-non-literal-fs-filename -- This exact path belongs to this test's fresh directory.
                writeFileSync(openedPath, REPLACEMENT_BYTES);
              },
            },
            fileSystem,
          ),
        "IDENTITY",
      );

      expect([...(observedRead ?? [])]).toEqual([...ORIGINAL_BYTES]);
      expect([...(observedRead ?? [])]).not.toEqual([...REPLACEMENT_BYTES]);
      expect(error.cause).toBeUndefined();
      expect(closeCalls).toBe(1);
    });
  });

  it("detects an opened-path identity mismatch", () => {
    withFreshFile(ORIGINAL_BYTES, ({ filePath, rootPath }) => {
      const error = expectSecureError(
        () =>
          readVerifiedRegularFile(
            filePath,
            rootPath,
            LABEL,
            {},
            createFileSystem({ lstat: (_path) => metadata("file", 2n, 2n) }),
          ),
        "IDENTITY",
      );

      expect(error.message).toContain("identity changed");
    });
  });

  it("preserves a read I/O failure", () => {
    withFreshFile(ORIGINAL_BYTES, ({ filePath, rootPath }) => {
      const cause = new FileSystemFailure("EIO");
      expectSecureError(
        () =>
          readVerifiedRegularFile(
            filePath,
            rootPath,
            LABEL,
            {},
            createFileSystem({
              read: (_descriptor) => {
                throw cause;
              },
            }),
          ),
        "IO",
        cause,
      );
    });
  });

  it("detects descriptor identity change after reading", () => {
    withFreshFile(ORIGINAL_BYTES, ({ filePath, rootPath }) => {
      let fstatCalls = 0;
      expectSecureError(
        () =>
          readVerifiedRegularFile(
            filePath,
            rootPath,
            LABEL,
            {},
            createFileSystem({
              fstat: (_descriptor) => {
                fstatCalls += 1;
                return fstatCalls === 3 ? metadata("file", 2n, 2n) : metadata();
              },
            }),
          ),
        "IDENTITY",
      );
    });
  });

  it("detects path identity change after reading", () => {
    withFreshFile(ORIGINAL_BYTES, ({ filePath, rootPath }) => {
      let lstatCalls = 0;
      expectSecureError(
        () =>
          readVerifiedRegularFile(
            filePath,
            rootPath,
            LABEL,
            {},
            createFileSystem({
              lstat: (_path) => {
                lstatCalls += 1;
                return lstatCalls === 2 ? metadata("file", 2n, 2n) : metadata();
              },
            }),
          ),
        "IDENTITY",
      );
    });
  });

  it("preserves a successful-read close failure", () => {
    withFreshFile(ORIGINAL_BYTES, ({ filePath, rootPath }) => {
      const cause = new FileSystemFailure("EIO");
      expectSecureError(
        () =>
          readVerifiedRegularFile(
            filePath,
            rootPath,
            LABEL,
            {},
            createFileSystem({
              close: (_descriptor) => {
                throw cause;
              },
            }),
          ),
        "IO",
        cause,
      );
    });
  });

  it.each([
    ["TYPE", createFileSystem({ fstat: (_descriptor) => metadata("other") })],
    ["IDENTITY", createFileSystem({ lstat: (_path) => metadata("file", 2n, 2n) })],
  ] as const)("preserves a primary %s error when close also fails", (code, baseFileSystem) => {
    withFreshFile(ORIGINAL_BYTES, ({ filePath, rootPath }) => {
      const closeCause = new FileSystemFailure("EIO");
      const error = expectSecureError(
        () =>
          readVerifiedRegularFile(
            filePath,
            rootPath,
            LABEL,
            {},
            createFileSystem({
              ...baseFileSystem,
              close: (_descriptor) => {
                throw closeCause;
              },
            }),
          ),
        code,
      );

      expect(error.message).toContain(code === "TYPE" ? "not a regular file" : "identity changed");
      expect(error.cause).toBeInstanceOf(AggregateError);
      if (!(error.cause instanceof AggregateError))
        throw new Error("Expected aggregate close failure cause.");
      expect(error.cause.errors).toHaveLength(2);
      expect(error.cause.errors[0]).toBeInstanceOf(SecureFileError);
      expect(error.cause.errors[1]).toBe(closeCause);
    });
  });
});
