import { rmdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  createLoggingE2eArtifactRun as createArtifactRun,
  createNodeArtifactRunFileSystem,
  LoggingE2eArtifactError as ArtifactRunError,
} from "./logging-e2e-artifact-run.ts";
import {
  artifactPathMetadata,
  createArtifactRunFileSystem,
  TestArtifactFileSystemError,
} from "./logging-e2e-artifact-run.test-support.ts";

function capture(action: () => void): unknown {
  try {
    action();
  } catch (error: unknown) {
    return error;
  }
  throw new Error("Expected the action to throw.");
}

function errorsOf(error: AggregateError): readonly unknown[] {
  const errors: unknown = error.errors;
  if (!Array.isArray(errors)) throw new Error("Expected AggregateError.errors to be an array.");
  return errors;
}

function expectArtifactError(error: unknown, code: "IDENTITY" | "IO", cause?: unknown): ArtifactRunError {
  expect(error).toBeInstanceOf(ArtifactRunError);
  if (!(error instanceof ArtifactRunError)) throw new Error("Expected a logging artifact error.");
  expect(error.code).toBe(code);
  if (cause !== undefined) expect(error.cause).toBe(cause);
  return error;
}

function removePartialRoot(rootPath: string, childName: string): void {
  if (rootPath === "") return;
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- This exact child belongs to the fresh root created by this test.
  rmdirSync(`${rootPath}/${childName}`);
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- This exact path was returned by this test's mkdtemp call.
  rmdirSync(rootPath);
}

describe("logging E2E artifact construction rollback coverage", () => {
  it("preserves the directory-open primary error before its failed immediate rollback", () => {
    const sourceFileSystem = createNodeArtifactRunFileSystem();
    const openCause = new TestArtifactFileSystemError("EOPEN");
    const rollbackCause = new TestArtifactFileSystemError("ERMDIR");
    let rawDescriptor = -1;
    let rootPath = "";
    const fileSystem = createArtifactRunFileSystem({
      fstat: (descriptor) => {
        if (descriptor === rawDescriptor) throw openCause;
        return sourceFileSystem.fstat(descriptor);
      },
      mkdtemp: (prefix) => {
        rootPath = sourceFileSystem.mkdtemp(prefix);
        return rootPath;
      },
      open: (path, flags, mode) => {
        const descriptor =
          mode === undefined ? sourceFileSystem.open(path, flags) : sourceFileSystem.open(path, flags, mode);
        if (path.endsWith("/raw")) rawDescriptor = descriptor;
        return descriptor;
      },
      rmdir: (path) => {
        if (path.endsWith("/raw")) throw rollbackCause;
        sourceFileSystem.rmdir(path);
      },
    });

    try {
      const thrown = capture(() => {
        createArtifactRun({}, fileSystem);
      });
      expect(thrown).toBeInstanceOf(AggregateError);
      if (!(thrown instanceof AggregateError))
        throw new Error("Expected construction rollback AggregateError.");
      const outer = errorsOf(thrown);
      expect(outer[0]).toBeInstanceOf(AggregateError);
      if (!(outer[0] instanceof AggregateError))
        throw new Error("Expected immediate rollback AggregateError.");
      expect(outer[0].cause).toBe(rollbackCause);
      const immediate = errorsOf(outer[0]);
      expectArtifactError(immediate[0], "IO", openCause);
      expect(immediate[1]).toBe(rollbackCause);
    } finally {
      removePartialRoot(rootPath, "raw");
    }
  });

  it("preserves an identity rollback failure and does not remove that directory", () => {
    const sourceFileSystem = createNodeArtifactRunFileSystem();
    const lateCause = new TestArtifactFileSystemError("EOPEN");
    let rawDescriptor = -1;
    let bundleDescriptor = -1;
    let rawFstatCalls = 0;
    let rawRmdirCalls = 0;
    let rootPath = "";
    const fileSystem = createArtifactRunFileSystem({
      fstat: (descriptor) => {
        if (descriptor === bundleDescriptor) throw lateCause;
        if (descriptor === rawDescriptor) {
          rawFstatCalls += 1;
          if (rawFstatCalls > 1) return artifactPathMetadata("directory", 9n, 9n);
        }
        return sourceFileSystem.fstat(descriptor);
      },
      mkdtemp: (prefix) => {
        rootPath = sourceFileSystem.mkdtemp(prefix);
        return rootPath;
      },
      open: (path, flags, mode) => {
        const descriptor =
          mode === undefined ? sourceFileSystem.open(path, flags) : sourceFileSystem.open(path, flags, mode);
        if (path.endsWith("/raw")) rawDescriptor = descriptor;
        if (path.endsWith("/bundle")) bundleDescriptor = descriptor;
        return descriptor;
      },
      rmdir: (path) => {
        if (path.endsWith("/raw")) rawRmdirCalls += 1;
        sourceFileSystem.rmdir(path);
      },
    });

    try {
      const thrown = capture(() => {
        createArtifactRun({}, fileSystem);
      });
      expect(thrown).toBeInstanceOf(AggregateError);
      if (!(thrown instanceof AggregateError))
        throw new Error("Expected construction rollback AggregateError.");
      const errors = errorsOf(thrown);
      expectArtifactError(errors[0], "IO", lateCause);
      expectArtifactError(errors[1], "IDENTITY");
      expect(rawRmdirCalls).toBe(0);
    } finally {
      removePartialRoot(rootPath, "raw");
    }
  });

  it("closes the temporary descriptor and preserves mkdtemp failure before a root name exists", () => {
    const sourceFileSystem = createNodeArtifactRunFileSystem();
    const primary = new TestArtifactFileSystemError("EMKDTEMP");
    const closedDescriptors: number[] = [];
    const fileSystem = createArtifactRunFileSystem({
      close: (descriptor) => {
        closedDescriptors.push(descriptor);
        sourceFileSystem.close(descriptor);
      },
      mkdtemp: () => {
        throw primary;
      },
    });

    expect(
      capture(() => {
        createArtifactRun({}, fileSystem);
      }),
    ).toBe(primary);
    expect(closedDescriptors).toHaveLength(1);
  });
});
