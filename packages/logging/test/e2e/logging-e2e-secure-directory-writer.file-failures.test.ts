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

const CONTENTS = new Uint8Array([115, 101, 99, 117, 114, 101]);
const LABEL = "secure directory writer file failure test";

class FileSystemFailure extends Error {
  public constructor(public readonly code: string) {
    super(`Filesystem failure: ${code}`);
  }
}

type MetadataKind = "directory" | "file" | "other" | "symlink";
type FileSystemOverrides = Readonly<Partial<SecureDirectoryWriterFileSystem>>;

function metadata(kind: MetadataKind, device = 1n, inode = 1n) {
  return Object.freeze({
    dev: device,
    ino: inode,
    isDirectory: () => kind === "directory",
    isFile: () => kind === "file",
    isSymbolicLink: () => kind === "symlink",
  });
}

function createFileSystem(overrides: FileSystemOverrides = {}): SecureDirectoryWriterFileSystem {
  return Object.freeze({ ...createNodeSecureDirectoryWriterFileSystem(), ...overrides });
}

function request(artifactRun: ArtifactRun, fileName = "record.json", contents = CONTENTS) {
  return Object.freeze({
    contents,
    directoryPath: artifactRun.paths.raw,
    expectedDirectoryIdentity: artifactRun.identities.raw,
    fileName,
    label: LABEL,
  });
}

function expectSecureError(
  action: () => void,
  code: SecureDirectoryWriteErrorCode,
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
  return thrown;
}

function withArtifactRun(action: (artifactRun: ArtifactRun) => void): void {
  const artifactRun = createArtifactRun();
  try {
    action(artifactRun);
  } finally {
    artifactRun.adoptExternalFiles("raw");
    artifactRun.adoptExternalFiles("bundle");
    artifactRun.cleanup();
  }
}

describe("logging E2E secure directory writer file failures", () => {
  it.each([
    ["EEXIST", "EXISTS"],
    ["ELOOP", "SYMLINK"],
    ["EIO", "IO"],
  ] as const)("maps file open %s to %s without write or fsync", (failureCode, expectedCode) => {
    withArtifactRun((artifactRun) => {
      const sourceFileSystem = createNodeSecureDirectoryWriterFileSystem();
      const cause = new FileSystemFailure(failureCode);
      let fsyncCalls = 0;
      let writeCalls = 0;
      const fileSystem = createFileSystem({
        fsync: (descriptor) => {
          fsyncCalls += 1;
          sourceFileSystem.fsync(descriptor);
        },
        open: (path, flags, mode) => {
          if (mode !== undefined) throw cause;
          return sourceFileSystem.open(path, flags, mode);
        },
        write: (descriptor, contents) => {
          writeCalls += 1;
          return sourceFileSystem.write(descriptor, contents);
        },
      });

      const error = expectSecureError(
        () => writeExclusiveFileToVerifiedDirectory(request(artifactRun), {}, fileSystem),
        expectedCode,
      );

      expect(error.cause).toBe(cause);
      expect(writeCalls).toBe(0);
      expect(fsyncCalls).toBe(0);
    });
  });

  it.each([
    ["a non-file descriptor", "TYPE"],
    ["a file descriptor inspection failure", "IO"],
  ] as const)("rejects %s before write", (scenario, expectedCode) => {
    withArtifactRun((artifactRun) => {
      const sourceFileSystem = createNodeSecureDirectoryWriterFileSystem();
      const inspectionCause = new FileSystemFailure("EIO");
      let writeCalls = 0;
      let fileDescriptor: number | undefined;
      const fileSystem = createFileSystem({
        fstat: (descriptor) => {
          if (descriptor !== fileDescriptor) return sourceFileSystem.fstat(descriptor);
          if (scenario === "a non-file descriptor") return metadata("other");
          throw inspectionCause;
        },
        open: (path, flags, mode) => {
          const descriptor = sourceFileSystem.open(path, flags, mode);
          if (mode !== undefined) fileDescriptor = descriptor;
          return descriptor;
        },
        write: (descriptor, contents) => {
          writeCalls += 1;
          return sourceFileSystem.write(descriptor, contents);
        },
      });

      const error = expectSecureError(
        () => writeExclusiveFileToVerifiedDirectory(request(artifactRun), {}, fileSystem),
        expectedCode,
      );

      if (expectedCode === "IO") expect(error.cause).toBe(inspectionCause);
      expect(writeCalls).toBe(0);
    });
  });

  it.each([
    ["a symlink", "SYMLINK"],
    ["a non-file", "TYPE"],
    ["an inspection failure", "IO"],
  ] as const)("maps afterFileOpen file path %s", (scenario, expectedCode) => {
    withArtifactRun((artifactRun) => {
      const sourceFileSystem = createNodeSecureDirectoryWriterFileSystem();
      const inspectionCause = new FileSystemFailure("EIO");
      let writeCalls = 0;
      let openedFilePath: string | undefined;
      const fileSystem = createFileSystem({
        lstat: (path) => {
          if (path !== openedFilePath) return sourceFileSystem.lstat(path);
          if (scenario === "a symlink") return metadata("symlink");
          if (scenario === "a non-file") return metadata("other");
          throw inspectionCause;
        },
        write: (descriptor, contents) => {
          writeCalls += 1;
          return sourceFileSystem.write(descriptor, contents);
        },
      });

      const error = expectSecureError(
        () =>
          writeExclusiveFileToVerifiedDirectory(
            request(artifactRun, "after-open.json"),
            {
              afterFileOpen: (openedPath) => {
                expect(openedPath).toContain("/proc/self/fd/");
                openedFilePath = openedPath;
              },
            },
            fileSystem,
          ),
        expectedCode,
      );

      if (expectedCode === "IO") expect(error.cause).toBe(inspectionCause);
      expect(writeCalls).toBe(0);
    });
  });

  it("rejects a descriptor identity mismatch after file open before writing", () => {
    withArtifactRun((artifactRun) => {
      const sourceFileSystem = createNodeSecureDirectoryWriterFileSystem();
      let fileDescriptor: number | undefined;
      let fileFstatCalls = 0;
      let writeCalls = 0;
      const fileSystem = createFileSystem({
        fstat: (descriptor) => {
          if (descriptor !== fileDescriptor) return sourceFileSystem.fstat(descriptor);
          fileFstatCalls += 1;
          return fileFstatCalls === 1 ? sourceFileSystem.fstat(descriptor) : metadata("file", 9n, 9n);
        },
        open: (path, flags, mode) => {
          const descriptor = sourceFileSystem.open(path, flags, mode);
          if (mode !== undefined) fileDescriptor = descriptor;
          return descriptor;
        },
        write: (descriptor, contents) => {
          writeCalls += 1;
          return sourceFileSystem.write(descriptor, contents);
        },
      });

      expectSecureError(
        () =>
          writeExclusiveFileToVerifiedDirectory(request(artifactRun, "identity-open.json"), {}, fileSystem),
        "IDENTITY",
      );
      expect(writeCalls).toBe(0);
    });
  });

  it("writes one-byte chunks, fsyncs, adopts, reads, and cleans a real file when hooks are absent", () => {
    withArtifactRun((artifactRun) => {
      const sourceFileSystem = createNodeSecureDirectoryWriterFileSystem();
      let fsyncCalls = 0;
      const writeLengths: number[] = [];
      const fileSystem = createFileSystem({
        fsync: (descriptor) => {
          fsyncCalls += 1;
          sourceFileSystem.fsync(descriptor);
        },
        write: (descriptor, contents) => {
          writeLengths.push(contents.byteLength);
          return sourceFileSystem.write(descriptor, contents.subarray(0, 1));
        },
      });

      writeExclusiveFileToVerifiedDirectory(request(artifactRun, "partial.json"), {}, fileSystem);

      expect(writeLengths).toEqual([6, 5, 4, 3, 2, 1]);
      expect(fsyncCalls).toBe(1);
      expect(artifactRun.adoptExternalFiles("raw")).toEqual(["partial.json"]);
      expect([...artifactRun.readFile("raw", "partial.json")]).toEqual([...CONTENTS]);
    });
  });

  it.each([
    ["zero", 0],
    ["more than remains", CONTENTS.byteLength + 1],
  ] as const)("rejects an invalid %s write count and cleans the external file", (_scenario, byteCount) => {
    withArtifactRun((artifactRun) => {
      const error = expectSecureError(
        () =>
          writeExclusiveFileToVerifiedDirectory(
            request(artifactRun, "invalid-count.json"),
            {},
            createFileSystem({
              write: (_descriptor, _contents) => byteCount,
            }),
          ),
        "IO",
      );

      expect(error.cause).toBeUndefined();
      expect(artifactRun.adoptExternalFiles("raw")).toEqual(["invalid-count.json"]);
      expect([...artifactRun.readFile("raw", "invalid-count.json")]).toEqual([]);
    });
  });

  it.each([
    ["write", "IO"],
    ["fsync", "IO"],
  ] as const)("preserves a %s failure as the I/O cause", (operation, expectedCode) => {
    withArtifactRun((artifactRun) => {
      const sourceFileSystem = createNodeSecureDirectoryWriterFileSystem();
      const cause = new FileSystemFailure("EIO");
      const fileSystem = createFileSystem({
        fsync: (descriptor) => {
          if (operation === "fsync") throw cause;
          sourceFileSystem.fsync(descriptor);
        },
        write: (descriptor, contents) => {
          if (operation === "write") throw cause;
          return sourceFileSystem.write(descriptor, contents);
        },
      });

      const error = expectSecureError(
        () =>
          writeExclusiveFileToVerifiedDirectory(request(artifactRun, `${operation}.json`), {}, fileSystem),
        expectedCode,
      );
      expect(error.cause).toBe(cause);
      expect(artifactRun.adoptExternalFiles("raw")).toEqual([`${operation}.json`]);
    });
  });

  it.each([
    ["descriptor", "IDENTITY"],
    ["path", "IDENTITY"],
  ] as const)("detects a post-write file %s identity change", (identitySource, expectedCode) => {
    withArtifactRun((artifactRun) => {
      const sourceFileSystem = createNodeSecureDirectoryWriterFileSystem();
      let fileDescriptor: number | undefined;
      let fileFstatCalls = 0;
      let fileLstatCalls = 0;
      let openedFilePath: string | undefined;
      const fileSystem = createFileSystem({
        fstat: (descriptor) => {
          if (descriptor !== fileDescriptor) return sourceFileSystem.fstat(descriptor);
          fileFstatCalls += 1;
          if (identitySource === "descriptor" && fileFstatCalls === 3) return metadata("file", 9n, 9n);
          return sourceFileSystem.fstat(descriptor);
        },
        lstat: (path) => {
          if (path !== openedFilePath) return sourceFileSystem.lstat(path);
          fileLstatCalls += 1;
          if (identitySource === "path" && fileLstatCalls === 2) return metadata("file", 9n, 9n);
          return sourceFileSystem.lstat(path);
        },
        open: (path, flags, mode) => {
          const descriptor = sourceFileSystem.open(path, flags, mode);
          if (mode !== undefined) {
            fileDescriptor = descriptor;
            openedFilePath = path;
          }
          return descriptor;
        },
      });

      expectSecureError(
        () => writeExclusiveFileToVerifiedDirectory(request(artifactRun, "post-write.json"), {}, fileSystem),
        expectedCode,
      );
    });
  });

  it.each([
    ["file", "only-file-close.json"],
    ["directory", "only-directory-close.json"],
    ["both", "both-close.json"],
  ] as const)(
    "reports successful %s close failure after closing underlying descriptors",
    (failureTarget, fileName) => {
      withArtifactRun((artifactRun) => {
        const sourceFileSystem = createNodeSecureDirectoryWriterFileSystem();
        const fileCloseCause = new FileSystemFailure("EIO-file");
        const directoryCloseCause = new FileSystemFailure("EIO-directory");
        let directoryDescriptor: number | undefined;
        let fileDescriptor: number | undefined;
        const fileSystem = createFileSystem({
          close: (descriptor) => {
            sourceFileSystem.close(descriptor);
            if (descriptor === fileDescriptor && (failureTarget === "file" || failureTarget === "both"))
              throw fileCloseCause;
            if (
              descriptor === directoryDescriptor &&
              (failureTarget === "directory" || failureTarget === "both")
            )
              throw directoryCloseCause;
          },
          open: (path, flags, mode) => {
            const descriptor = sourceFileSystem.open(path, flags, mode);
            if (mode === undefined) directoryDescriptor = descriptor;
            else fileDescriptor = descriptor;
            return descriptor;
          },
        });

        const error = expectSecureError(
          () => writeExclusiveFileToVerifiedDirectory(request(artifactRun, fileName), {}, fileSystem),
          "IO",
        );

        if (failureTarget === "both") {
          expect(error.cause).toBeInstanceOf(AggregateError);
          if (error.cause instanceof AggregateError)
            expect(error.cause).toMatchObject({ errors: [fileCloseCause, directoryCloseCause] });
        } else expect(error.cause).toBe(failureTarget === "file" ? fileCloseCause : directoryCloseCause);
        expect(artifactRun.adoptExternalFiles("raw")).toEqual([fileName]);
        expect([...artifactRun.readFile("raw", fileName)]).toEqual([...CONTENTS]);
      });
    },
  );

  it.each([
    ["TYPE", "primary-type.json"],
    ["IDENTITY", "primary-identity.json"],
  ] as const)("preserves primary %s when both descriptor closes fail", (primaryCode, fileName) => {
    withArtifactRun((artifactRun) => {
      const sourceFileSystem = createNodeSecureDirectoryWriterFileSystem();
      const fileCloseCause = new FileSystemFailure("EIO-file");
      const directoryCloseCause = new FileSystemFailure("EIO-directory");
      let directoryDescriptor: number | undefined;
      let fileDescriptor: number | undefined;
      let fileFstatCalls = 0;
      const fileSystem = createFileSystem({
        close: (descriptor) => {
          sourceFileSystem.close(descriptor);
          if (descriptor === fileDescriptor) throw fileCloseCause;
          if (descriptor === directoryDescriptor) throw directoryCloseCause;
        },
        fstat: (descriptor) => {
          if (descriptor !== fileDescriptor) return sourceFileSystem.fstat(descriptor);
          fileFstatCalls += 1;
          if (primaryCode === "TYPE") return metadata("other");
          return fileFstatCalls === 1 ? sourceFileSystem.fstat(descriptor) : metadata("file", 9n, 9n);
        },
        open: (path, flags, mode) => {
          const descriptor = sourceFileSystem.open(path, flags, mode);
          if (mode === undefined) directoryDescriptor = descriptor;
          else fileDescriptor = descriptor;
          return descriptor;
        },
      });

      const error = expectSecureError(
        () => writeExclusiveFileToVerifiedDirectory(request(artifactRun, fileName), {}, fileSystem),
        primaryCode,
      );

      expect(error.cause).toBeInstanceOf(AggregateError);
      if (error.cause instanceof AggregateError)
        expect(error.cause).toMatchObject({
          errors: [expect.objectContaining({ code: primaryCode }), fileCloseCause, directoryCloseCause],
        });
    });
  });

  it.each([
    ["write", "unexpected-write.json"],
    ["fsync", "unexpected-fsync.json"],
  ] as const)("covers the outer I/O wrapper for an untyped %s failure", (operation, fileName) => {
    withArtifactRun((artifactRun) => {
      const sourceFileSystem = createNodeSecureDirectoryWriterFileSystem();
      const cause = new Error(`Unexpected ${operation} failure.`);
      const fileSystem = createFileSystem({
        fsync: (descriptor) => {
          if (operation === "fsync") throw cause;
          sourceFileSystem.fsync(descriptor);
        },
        write: (descriptor, contents) => {
          if (operation === "write") throw cause;
          return sourceFileSystem.write(descriptor, contents);
        },
      });

      const error = expectSecureError(
        () => writeExclusiveFileToVerifiedDirectory(request(artifactRun, fileName), {}, fileSystem),
        "IO",
      );
      expect(error.cause).toBe(cause);
    });
  });
});
