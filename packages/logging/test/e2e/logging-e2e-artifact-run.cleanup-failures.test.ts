import { readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  createLoggingE2eArtifactRun as createArtifactRun,
  createNodeArtifactRunFileSystem,
  LoggingE2eArtifactError as ArtifactRunError,
  type LoggingE2eArtifactErrorCode as ArtifactRunErrorCode,
} from "./logging-e2e-artifact-run.ts";
import {
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

describe("logging E2E artifact run cleanup failures", () => {
  it("rejects an invalid file name for writes and reads without artifact-file side effects", () => {
    const sourceFileSystem = createNodeArtifactRunFileSystem();
    let fileOpenCalls = 0;
    const run = createArtifactRun(
      {},
      createArtifactRunFileSystem({
        open: (path, flags, mode) => {
          if (path.endsWith("/record.json")) fileOpenCalls += 1;
          return mode === undefined
            ? sourceFileSystem.open(path, flags)
            : sourceFileSystem.open(path, flags, mode);
        },
      }),
    );

    try {
      expectArtifactError(() => {
        run.writeExclusiveFile("raw", "../record.json", new Uint8Array([1]));
      }, "TYPE");
      expectArtifactError(() => {
        run.readFile("raw", "../record.json");
      }, "TYPE");
      expect(fileOpenCalls).toBe(0);
      expect(sourceFileSystem.readdir(run.paths.raw)).toEqual([]);
    } finally {
      run.cleanup();
    }
  });

  it("rejects an atomically replaced registered raw file without touching either content", () => {
    const run = createArtifactRun();
    const artifactPath = `${run.paths.raw}/record.json`;
    const preservedOriginalPath = `${run.paths.root}/record.json.original`;
    const originalContents = "original";
    const replacementContents = "replacement";
    let isOriginalMoved = false;
    let isReplacementCreated = false;

    try {
      run.writeExclusiveFile("raw", "record.json", new TextEncoder().encode(originalContents));
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- Both paths are exact children of this fresh artifact root.
      renameSync(artifactPath, preservedOriginalPath);
      isOriginalMoved = true;
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- The replacement is an exact fresh artifact path for this test.
      writeFileSync(artifactPath, replacementContents);
      isReplacementCreated = true;

      expectArtifactError(() => {
        run.cleanup();
      }, "IDENTITY");
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- The replacement is an exact fresh artifact path for this test.
      expect(readFileSync(artifactPath, "utf8")).toBe(replacementContents);
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- The preserved original is an exact fresh artifact path for this test.
      expect(readFileSync(preservedOriginalPath, "utf8")).toBe(originalContents);
    } finally {
      if (isReplacementCreated) {
        // eslint-disable-next-line security/detect-non-literal-fs-filename -- The replacement is an exact fresh artifact path for this test.
        unlinkSync(artifactPath);
      }
      if (isOriginalMoved) {
        // eslint-disable-next-line security/detect-non-literal-fs-filename -- Both paths are exact children of this fresh artifact root.
        renameSync(preservedOriginalPath, artifactPath);
      }
      run.cleanup();
    }
  });

  it("fails closed when the post-unlink raw readdir observes a synthetic ghost entry", () => {
    const sourceFileSystem = createNodeArtifactRunFileSystem();
    let rawDirectoryDescriptor: number | undefined;
    let rawReaddirCalls = 0;
    let isGhostEntryEnabled = true;
    const run = createArtifactRun(
      {},
      createArtifactRunFileSystem({
        open: (path, flags, mode) => {
          const descriptor =
            mode === undefined
              ? sourceFileSystem.open(path, flags)
              : sourceFileSystem.open(path, flags, mode);
          if (path.endsWith("/raw")) rawDirectoryDescriptor = descriptor;
          return descriptor;
        },
        readdir: (path) => {
          const entries = sourceFileSystem.readdir(path);
          const rawDescriptorPath = `/proc/self/fd/${String(rawDirectoryDescriptor)}`;
          if (path === rawDescriptorPath) {
            rawReaddirCalls += 1;
            if (isGhostEntryEnabled && rawReaddirCalls === 2) return [...entries, "ghost.json"];
          }
          return entries;
        },
      }),
    );

    expectArtifactError(() => {
      run.cleanup();
    }, "CLEANUP");
    expect(rawReaddirCalls).toBe(2);
    isGhostEntryEnabled = false;
    run.cleanup();
  });

  it("preserves a first cleanup readdir I/O cause and permits later cleanup", () => {
    const sourceFileSystem = createNodeArtifactRunFileSystem();
    const cause = new TestArtifactFileSystemError("EIO");
    let isFailureEnabled = true;
    const run = createArtifactRun(
      {},
      createArtifactRunFileSystem({
        readdir: (path) => {
          if (isFailureEnabled) throw cause;
          return sourceFileSystem.readdir(path);
        },
      }),
    );

    expectArtifactError(
      () => {
        run.cleanup();
      },
      "CLEANUP",
      cause,
    );
    isFailureEnabled = false;
    run.cleanup();
  });
});
