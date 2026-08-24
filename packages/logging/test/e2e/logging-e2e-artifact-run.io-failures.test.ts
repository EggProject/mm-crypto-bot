import { unlinkSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  createLoggingE2eArtifactRun as createArtifactRun,
  createNodeArtifactRunFileSystem,
  LoggingE2eArtifactError as ArtifactRunError,
  type LoggingE2eArtifactErrorCode as ArtifactRunErrorCode,
} from "./logging-e2e-artifact-run.ts";
import {
  artifactPathMetadata,
  createArtifactRunFileSystem,
  TestArtifactFileSystemError,
} from "./logging-e2e-artifact-run.test-support.ts";

function expectArtifactError(
  action: () => void,
  code: ArtifactRunErrorCode,
  expectedCause?: unknown,
): ArtifactRunError {
  let thrown: unknown;
  try {
    action();
  } catch (error: unknown) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(ArtifactRunError);
  if (!(thrown instanceof ArtifactRunError)) throw new Error("Expected a logging artifact error.");
  expect(thrown.code).toBe(code);
  if (expectedCause !== undefined) expect(thrown.cause).toBe(expectedCause);
  return thrown;
}

function removeFreshArtifactFile(path: string): void {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- This exact path belongs to this test's fresh artifact root.
  unlinkSync(path);
}

describe("logging E2E artifact run I/O failures", () => {
  it("preserves a targeted descriptor metadata I/O cause during construction", () => {
    const sourceFileSystem = createNodeArtifactRunFileSystem();
    const cause = new TestArtifactFileSystemError("EIO");
    let descriptorChecks = 0;
    let rootPath = "";
    const fileSystem = createArtifactRunFileSystem({
      fstat: (descriptor) => {
        descriptorChecks += 1;
        if (descriptorChecks === 2) throw cause;
        return sourceFileSystem.fstat(descriptor);
      },
      mkdtemp: (prefix) => {
        rootPath = sourceFileSystem.mkdtemp(prefix);
        return rootPath;
      },
    });

    expectArtifactError(
      () => {
        createArtifactRun({}, fileSystem);
      },
      "IO",
      cause,
    );
    expect(descriptorChecks).toBe(2);
    expect(rootPath).not.toBe("");
    expect(() => sourceFileSystem.lstat(rootPath)).toThrow(/ENOENT/);
  });

  it("preserves a raw-directory mkdir I/O cause during construction", () => {
    const sourceFileSystem = createNodeArtifactRunFileSystem();
    const cause = new TestArtifactFileSystemError("EIO");
    let rootPath = "";
    const fileSystem = createArtifactRunFileSystem({
      mkdir: (path, mode) => {
        if (path.endsWith("/raw")) throw cause;
        sourceFileSystem.mkdir(path, mode);
      },
      mkdtemp: (prefix) => {
        rootPath = sourceFileSystem.mkdtemp(prefix);
        return rootPath;
      },
    });

    expectArtifactError(
      () => {
        createArtifactRun({}, fileSystem);
      },
      "IO",
      cause,
    );
    expect(rootPath).not.toBe("");
    expect(() => sourceFileSystem.lstat(rootPath)).toThrow(/ENOENT/);
  });

  it("rejects a write file identity mismatch without writing contents", () => {
    const sourceFileSystem = createNodeArtifactRunFileSystem();
    let writeCalls = 0;
    const run = createArtifactRun(
      {},
      createArtifactRunFileSystem({
        lstat: (path) =>
          path.endsWith("/record.json") ? artifactPathMetadata("file", 9n, 9n) : sourceFileSystem.lstat(path),
        write: (descriptor, contents) => {
          writeCalls += 1;
          sourceFileSystem.write(descriptor, contents);
        },
      }),
    );

    try {
      expectArtifactError(() => {
        run.writeExclusiveFile("raw", "record.json", new Uint8Array([1]));
      }, "IDENTITY");
      expect(writeCalls).toBe(0);
    } finally {
      removeFreshArtifactFile(`${run.paths.raw}/record.json`);
      run.cleanup();
    }
  });

  it("keeps a typed write descriptor metadata failure unchanged", () => {
    const sourceFileSystem = createNodeArtifactRunFileSystem();
    let writeDescriptor: number | undefined;
    const run = createArtifactRun(
      {},
      createArtifactRunFileSystem({
        fstat: (descriptor) =>
          descriptor === writeDescriptor
            ? artifactPathMetadata("directory")
            : sourceFileSystem.fstat(descriptor),
        open: (path, flags, mode) => {
          const descriptor =
            mode === undefined
              ? sourceFileSystem.open(path, flags)
              : sourceFileSystem.open(path, flags, mode);
          if (mode !== undefined) writeDescriptor = descriptor;
          return descriptor;
        },
      }),
    );

    try {
      const error = expectArtifactError(() => {
        run.writeExclusiveFile("raw", "record.json", new Uint8Array([1]));
      }, "TYPE");
      expect(error.cause).toBeUndefined();
    } finally {
      removeFreshArtifactFile(`${run.paths.raw}/record.json`);
      run.cleanup();
    }
  });

  it.each([
    ["a symbolic-link", "ELOOP", "SYMLINK"],
    ["a generic", "EIO", "IO"],
  ] as const)("maps %s write open failure without write side effects", (_label, errorCode, artifactCode) => {
    const sourceFileSystem = createNodeArtifactRunFileSystem();
    const cause = new TestArtifactFileSystemError(errorCode);
    let writeCalls = 0;
    let fsyncCalls = 0;
    const run = createArtifactRun(
      {},
      createArtifactRunFileSystem({
        fsync: () => {
          fsyncCalls += 1;
        },
        open: (path, flags, mode) => {
          if (mode !== undefined) throw cause;
          return sourceFileSystem.open(path, flags);
        },
        write: () => {
          writeCalls += 1;
        },
      }),
    );

    try {
      expectArtifactError(
        () => {
          run.writeExclusiveFile("raw", "record.json", new Uint8Array([1]));
        },
        artifactCode,
        cause,
      );
      expect(writeCalls).toBe(0);
      expect(fsyncCalls).toBe(0);
    } finally {
      run.cleanup();
    }
  });

  it.each(["write", "fsync"] as const)("preserves a %s I/O cause", (failurePoint) => {
    const sourceFileSystem = createNodeArtifactRunFileSystem();
    const cause = new TestArtifactFileSystemError("EIO");
    const run = createArtifactRun(
      {},
      createArtifactRunFileSystem({
        fsync: (descriptor) => {
          if (failurePoint === "fsync") throw cause;
          sourceFileSystem.fsync(descriptor);
        },
        write: (descriptor, contents) => {
          if (failurePoint === "write") throw cause;
          sourceFileSystem.write(descriptor, contents);
        },
      }),
    );

    try {
      expectArtifactError(
        () => {
          run.writeExclusiveFile("raw", "record.json", new Uint8Array([1]));
        },
        "IO",
        cause,
      );
    } finally {
      removeFreshArtifactFile(`${run.paths.raw}/record.json`);
      run.cleanup();
    }
  });

  it("maps a post-close write failure to I/O and permits later cleanup", () => {
    const sourceFileSystem = createNodeArtifactRunFileSystem();
    const cause = new TestArtifactFileSystemError("ECLOSE");
    let isCloseFailureEnabled = true;
    let writeDescriptor: number | undefined;
    const run = createArtifactRun(
      {},
      createArtifactRunFileSystem({
        close: (descriptor) => {
          sourceFileSystem.close(descriptor);
          if (isCloseFailureEnabled && descriptor === writeDescriptor) throw cause;
        },
        open: (path, flags, mode) => {
          const descriptor =
            mode === undefined
              ? sourceFileSystem.open(path, flags)
              : sourceFileSystem.open(path, flags, mode);
          if (mode !== undefined) writeDescriptor = descriptor;
          return descriptor;
        },
      }),
    );

    expectArtifactError(
      () => {
        run.writeExclusiveFile("raw", "record.json", new Uint8Array([1]));
      },
      "IO",
      cause,
    );
    isCloseFailureEnabled = false;
    run.cleanup();
  });

  it("preserves an existing write cause when its descriptor close also fails", () => {
    const sourceFileSystem = createNodeArtifactRunFileSystem();
    const cause = new TestArtifactFileSystemError("EEXIST");
    let writeDescriptor: number | undefined;
    const run = createArtifactRun(
      {},
      createArtifactRunFileSystem({
        close: (descriptor) => {
          sourceFileSystem.close(descriptor);
          if (descriptor === writeDescriptor) throw new TestArtifactFileSystemError("ECLOSE");
        },
        open: (path, flags, mode) => {
          const descriptor =
            mode === undefined
              ? sourceFileSystem.open(path, flags)
              : sourceFileSystem.open(path, flags, mode);
          if (mode !== undefined) writeDescriptor = descriptor;
          return descriptor;
        },
        write: () => {
          throw cause;
        },
      }),
    );

    try {
      expectArtifactError(
        () => {
          run.writeExclusiveFile("raw", "record.json", new Uint8Array([1]));
        },
        "EXISTS",
        cause,
      );
    } finally {
      removeFreshArtifactFile(`${run.paths.raw}/record.json`);
      run.cleanup();
    }
  });

  it.each([
    ["open", "IO"],
    ["descriptor metadata", "TYPE"],
    ["read", "IO"],
  ] as const)("maps a %s read failure", (failurePoint, artifactCode) => {
    const sourceFileSystem = createNodeArtifactRunFileSystem();
    const readCause = new TestArtifactFileSystemError("EIO");
    let readDescriptor: number | undefined;
    const run = createArtifactRun(
      {},
      createArtifactRunFileSystem({
        fstat: (descriptor) =>
          failurePoint === "descriptor metadata" && descriptor === readDescriptor
            ? artifactPathMetadata("directory")
            : sourceFileSystem.fstat(descriptor),
        open: (path, flags, mode) => {
          if (failurePoint === "open" && mode === undefined && path.endsWith("/record.json")) throw readCause;
          const descriptor =
            mode === undefined
              ? sourceFileSystem.open(path, flags)
              : sourceFileSystem.open(path, flags, mode);
          if (mode === undefined && path.endsWith("/record.json")) readDescriptor = descriptor;
          return descriptor;
        },
        read: (descriptor) => {
          if (failurePoint === "read") throw readCause;
          return sourceFileSystem.read(descriptor);
        },
      }),
    );

    try {
      run.writeExclusiveFile("raw", "record.json", new Uint8Array([1]));
      const error = expectArtifactError(
        () => {
          run.readFile("raw", "record.json");
        },
        artifactCode,
        failurePoint === "descriptor metadata" ? undefined : readCause,
      );
      if (failurePoint === "descriptor metadata") expect(error.cause).toBeUndefined();
    } finally {
      run.cleanup();
    }
  });

  it("rejects reads and writes after cleanup while a second cleanup is a no-op", () => {
    const run = createArtifactRun();
    run.cleanup();

    expectArtifactError(() => {
      run.writeExclusiveFile("raw", "record.json", new Uint8Array([1]));
    }, "CLEANUP");
    expectArtifactError(() => {
      run.readFile("raw", "record.json");
    }, "CLEANUP");
    expect(() => {
      run.cleanup();
    }).not.toThrow();
  });
});
