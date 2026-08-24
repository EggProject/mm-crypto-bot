import { closeSync, lstatSync } from "node:fs";
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

function expectAbsent(rootPath: string): void {
  expect(rootPath).not.toBe("");
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- This exact path was returned by this test's mkdtemp call.
  expect(() => lstatSync(rootPath)).toThrow();
}

function aggregateErrors(error: AggregateError): readonly unknown[] {
  const values: unknown = error.errors;
  if (!Array.isArray(values)) throw new Error("Expected AggregateError.errors to be an array.");
  return values;
}

describe("logging E2E artifact run construction", () => {
  it("rejects unsupported platforms before filesystem construction", () => {
    expectArtifactError(() => {
      createArtifactRun({}, createArtifactRunFileSystem({ platform: "darwin" }));
    }, "E_E2E_ARTIFACT_UNSUPPORTED");
  });

  it("preserves a temporary-directory open I/O cause", () => {
    const cause = new TestArtifactFileSystemError("EIO");
    expectArtifactError(
      () => {
        createArtifactRun(
          {},
          createArtifactRunFileSystem({
            open: () => {
              throw cause;
            },
          }),
        );
      },
      "IO",
      cause,
    );
  });

  it("closes a temporary descriptor when its metadata is not a directory", () => {
    const closedDescriptors: number[] = [];
    const fileSystem = createArtifactRunFileSystem({
      close: (descriptor) => {
        closedDescriptors.push(descriptor);
        closeSync(descriptor);
      },
      fstat: () => artifactPathMetadata("file"),
    });

    expectArtifactError(() => {
      createArtifactRun({}, fileSystem);
    }, "TYPE");
    expect(closedDescriptors).toHaveLength(1);
    expect(closedDescriptors[0]).toBeGreaterThanOrEqual(0);
  });

  it.each([
    ["symlink", artifactPathMetadata("symlink"), "SYMLINK"],
    ["file", artifactPathMetadata("file"), "TYPE"],
  ] as const)("rejects a root %s from a targeted lstat occurrence", (_kind, rootMetadata, code) => {
    const sourceFileSystem = createNodeArtifactRunFileSystem();
    let rootPath = "";
    let rootLstatCalls = 0;
    const fileSystem = createArtifactRunFileSystem({
      lstat: (path) => {
        if (path === rootPath && rootLstatCalls++ === 0) return rootMetadata;
        return sourceFileSystem.lstat(path);
      },
      mkdtemp: (prefix) => {
        rootPath = sourceFileSystem.mkdtemp(prefix);
        return rootPath;
      },
    });

    expectArtifactError(() => {
      createArtifactRun({}, fileSystem);
    }, code);
    expect(rootLstatCalls).toBe(1);
    expectAbsent(rootPath);
  });

  it("preserves a root lstat I/O cause from a targeted occurrence", () => {
    const sourceFileSystem = createNodeArtifactRunFileSystem();
    const cause = new TestArtifactFileSystemError("EIO");
    let rootPath = "";
    let rootLstatCalls = 0;
    const fileSystem = createArtifactRunFileSystem({
      lstat: (path) => {
        if (path === rootPath && rootLstatCalls++ === 0) throw cause;
        return sourceFileSystem.lstat(path);
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
    expect(rootLstatCalls).toBe(1);
    expectAbsent(rootPath);
  });

  it("rejects a root descriptor and path identity mismatch", () => {
    const sourceFileSystem = createNodeArtifactRunFileSystem();
    let rootPath = "";
    let rootLstatCalls = 0;
    const fileSystem = createArtifactRunFileSystem({
      lstat: (path) => {
        if (path === rootPath && rootLstatCalls++ === 0) return artifactPathMetadata("directory", 9n, 9n);
        return sourceFileSystem.lstat(path);
      },
      mkdtemp: (prefix) => {
        rootPath = sourceFileSystem.mkdtemp(prefix);
        return rootPath;
      },
    });

    expectArtifactError(() => {
      createArtifactRun({}, fileSystem);
    }, "IDENTITY");
    expect(rootLstatCalls).toBe(1);
    expectAbsent(rootPath);
  });

  it("closes partial descriptors and preserves a bundle-directory open I/O cause", () => {
    const sourceFileSystem = createNodeArtifactRunFileSystem();
    const cause = new TestArtifactFileSystemError("EIO");
    const closedDescriptors: number[] = [];
    let rootPath = "";
    const fileSystem = createArtifactRunFileSystem({
      close: (descriptor) => {
        closedDescriptors.push(descriptor);
        closeSync(descriptor);
      },
      mkdtemp: (prefix) => {
        rootPath = sourceFileSystem.mkdtemp(prefix);
        return rootPath;
      },
      open: (path, flags, mode) => {
        if (path.endsWith("/bundle")) throw cause;
        return mode === undefined
          ? sourceFileSystem.open(path, flags)
          : sourceFileSystem.open(path, flags, mode);
      },
    });

    expectArtifactError(
      () => {
        createArtifactRun({}, fileSystem);
      },
      "IO",
      cause,
    );
    expect(closedDescriptors).toHaveLength(3);
    expectAbsent(rootPath);
  });

  it("preserves a bundle-directory open failure when partial descriptor closing also fails", () => {
    const sourceFileSystem = createNodeArtifactRunFileSystem();
    const cause = new TestArtifactFileSystemError("EIO");
    const closeCause = new TestArtifactFileSystemError("ECLOSE");
    const closedDescriptors: number[] = [];
    let rootPath = "";
    const fileSystem = createArtifactRunFileSystem({
      close: (descriptor) => {
        closedDescriptors.push(descriptor);
        closeSync(descriptor);
        throw closeCause;
      },
      mkdtemp: (prefix) => {
        rootPath = sourceFileSystem.mkdtemp(prefix);
        return rootPath;
      },
      open: (path, flags, mode) => {
        if (path.endsWith("/bundle")) throw cause;
        return mode === undefined
          ? sourceFileSystem.open(path, flags)
          : sourceFileSystem.open(path, flags, mode);
      },
    });

    let thrown: unknown;
    try {
      createArtifactRun({}, fileSystem);
    } catch (error: unknown) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(AggregateError);
    if (!(thrown instanceof AggregateError))
      throw new Error("Expected construction rollback AggregateError.");
    const errors = aggregateErrors(thrown);
    expect(errors).toHaveLength(4);
    const primary = errors[0];
    const secondary = errors.slice(1);
    expect(primary).toBeInstanceOf(ArtifactRunError);
    if (primary instanceof ArtifactRunError) {
      expect(primary.code).toBe("IO");
      expect(primary.cause).toBe(cause);
    }
    expect(secondary).toEqual([closeCause, closeCause, closeCause]);
    expect(closedDescriptors).toHaveLength(3);
    expectAbsent(rootPath);
  });
});
