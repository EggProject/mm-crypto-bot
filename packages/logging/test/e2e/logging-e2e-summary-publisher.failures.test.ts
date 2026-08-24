import coveragePackage from "istanbul-lib-coverage";
import { describe, expect, it } from "vitest";

import {
  createLoggingE2eArtifactRun as createArtifactRun,
  createNodeArtifactRunFileSystem,
  LoggingE2eArtifactError as ArtifactError,
  type ArtifactRunFileSystem,
  type LoggingE2eArtifactRun as ArtifactRun,
} from "./logging-e2e-artifact-run.ts";
import { type LoggingEndToEndCoverageSummary } from "./logging-e2e-gate.ts";
import {
  LoggingE2eSummaryPublisherError as SummaryPublisherError,
  createNodeSummaryPublisherFileSystem,
  publishLoggingEndToEndSummary,
  type SummaryPublisherFileSystem,
} from "./logging-e2e-summary-publisher.ts";
import {
  createSummaryPublisherTestHarness,
  type SummaryPublisherTestHarness,
} from "./logging-e2e-summary-publisher.test-support.ts";
import { REPOSITORY_ROOT } from "./logging-e2e-scope.ts";

const coverageSummary = coveragePackage.createCoverageMap({}).getCoverageSummary().toJSON();
const SUMMARY: LoggingEndToEndCoverageSummary = Object.freeze({
  caseIds: Object.freeze(["redaction"]),
  failures: Object.freeze([]),
  files: Object.freeze({}),
  label: "logging-subprocess-e2e",
  passed: true,
  rawFileCount: 1,
  schemaVersion: 1,
  scope: Object.freeze(["packages/logging/src/logger.ts"]),
  total: coverageSummary,
});

class FileSystemFailure extends Error {
  public constructor(public readonly code: string) {
    super(`Filesystem failure: ${code}`);
    this.name = "FileSystemFailure";
  }
}

type FileSystemOverrides = Readonly<Partial<SummaryPublisherFileSystem>>;

function metadata(kind: "directory" | "file" | "other" | "symlink", device = 9n, inode = 9n) {
  return Object.freeze({
    dev: device,
    ino: inode,
    mode: 0o700n,
    uid: 1000n,
    isDirectory: () => kind === "directory",
    isFile: () => kind === "file",
    isSymbolicLink: () => kind === "symlink",
  });
}

function createFileSystem(
  harness: SummaryPublisherTestHarness,
  overrides: FileSystemOverrides = {},
): SummaryPublisherFileSystem {
  return Object.freeze({ ...harness.fileSystem, ...overrides });
}

function withArtifactRun(action: (artifactRun: ArtifactRun) => void): void {
  const artifactRun = createArtifactRun();
  try {
    action(artifactRun);
  } finally {
    artifactRun.cleanup();
  }
}

function expectPublisherError(
  action: () => void,
  code: SummaryPublisherError["code"],
): SummaryPublisherError {
  let thrown: unknown;
  try {
    action();
  } catch (error: unknown) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(SummaryPublisherError);
  if (!(thrown instanceof SummaryPublisherError)) throw new Error("Expected a summary publisher error.");
  expect(thrown.code).toBe(code);
  return thrown;
}

describe("logging E2E summary publisher failure handling", () => {
  it.each([
    ["while opening the summary directory", 1],
    ["before temporary creation", 2],
    ["before rename", 3],
    ["after rename", 4],
  ] as const)("rejects a summary-directory identity change %s", (_label, mismatchAt) => {
    withArtifactRun((artifactRun) => {
      const harness = createSummaryPublisherTestHarness();
      let e2eLstatCalls = 0;
      const fileSystem = createFileSystem(harness, {
        lstat: (path) => {
          if (path === harness.paths.e2e) {
            e2eLstatCalls += 1;
            if (e2eLstatCalls === mismatchAt) return metadata("directory");
          }
          return harness.fileSystem.lstat(path);
        },
      });

      expectPublisherError(() => {
        publishLoggingEndToEndSummary({ artifactRun, summary: SUMMARY }, fileSystem);
      }, "IDENTITY");
    });
  });

  it.each([
    ["after temporary creation", 1],
    ["before publication", 2],
  ] as const)("rejects a temporary-file identity change %s", (_label, mismatchAt) => {
    withArtifactRun((artifactRun) => {
      const harness = createSummaryPublisherTestHarness();
      let temporaryLstatCalls = 0;
      const fileSystem = createFileSystem(harness, {
        lstat: (path) => {
          if (path.includes("/.summary.json.tmp")) {
            temporaryLstatCalls += 1;
            if (temporaryLstatCalls === mismatchAt) return metadata("file");
          }
          return harness.fileSystem.lstat(path);
        },
      });

      expectPublisherError(() => {
        publishLoggingEndToEndSummary({ artifactRun, summary: SUMMARY }, fileSystem);
      }, "IDENTITY");
    });
  });

  it("rejects an artifact source identity replacement through its public read hook", () => {
    const sourceFileSystem = createNodeArtifactRunFileSystem();
    let isReplacementObserved = false;
    const artifactFileSystem: ArtifactRunFileSystem = Object.freeze({
      ...sourceFileSystem,
      lstat: (path: string) => {
        const sourceMetadata = sourceFileSystem.lstat(path);
        if (isReplacementObserved && path.endsWith("/e2e-summary.json")) {
          isReplacementObserved = false;
          return Object.freeze({
            dev: sourceMetadata.dev,
            ino: sourceMetadata.ino + 1n,
            isDirectory: () => sourceMetadata.isDirectory(),
            isFile: () => sourceMetadata.isFile(),
            isSymbolicLink: () => sourceMetadata.isSymbolicLink(),
          });
        }
        return sourceMetadata;
      },
    });
    const artifactRun = createArtifactRun(
      {
        afterReadFileOpen: () => {
          isReplacementObserved = true;
        },
      },
      artifactFileSystem,
    );
    try {
      const harness = createSummaryPublisherTestHarness();

      let thrown: unknown;
      try {
        publishLoggingEndToEndSummary({ artifactRun, summary: SUMMARY }, harness.fileSystem);
      } catch (error: unknown) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(ArtifactError);
      if (thrown instanceof ArtifactError) expect(thrown.code).toBe("IDENTITY");
    } finally {
      artifactRun.cleanup();
    }
  });

  it("exercises the Node publisher filesystem adapter against artifact-owned files", () => {
    withArtifactRun((artifactRun) => {
      const fileSystem = createNodeSummaryPublisherFileSystem();
      const temporaryPath = fileSystem.join(artifactRun.paths.bundle, "publisher-adapter.tmp");
      const finalPath = fileSystem.join(artifactRun.paths.bundle, "publisher-adapter.json");
      const descriptor = fileSystem.open(
        temporaryPath,
        Number(fileSystem.O_WRONLY) |
          Number(fileSystem.O_CREAT) |
          Number(fileSystem.O_EXCL) |
          Number(fileSystem.O_NOFOLLOW),
        0o600,
      );
      try {
        fileSystem.write(descriptor, new Uint8Array([123]));
        fileSystem.fsync(descriptor);
        expect(fileSystem.fstat(descriptor).isFile()).toBe(true);
      } finally {
        fileSystem.close(descriptor);
      }
      expect(fileSystem.lstat(temporaryPath).isFile()).toBe(true);
      expect(() => {
        fileSystem.mkdir(artifactRun.paths.bundle, 0o700);
      }).toThrow();
      fileSystem.rename(temporaryPath, finalPath);
      fileSystem.unlink(finalPath);
    });
  });

  it.each([
    ["open", "IO"],
    ["lstat", "IO"],
    ["fstat", "IO"],
    ["mkdir", "IO"],
  ] as const)("preserves non-ENOENT %s failures", (operation, expectedCode) => {
    withArtifactRun((artifactRun) => {
      const harness = createSummaryPublisherTestHarness();
      const cause = new FileSystemFailure("EIO");
      let rootDescriptor: number | undefined;
      const fileSystem = createFileSystem(harness, {
        fstat: (descriptor) => {
          if (operation === "fstat" && descriptor === rootDescriptor) throw cause;
          return harness.fileSystem.fstat(descriptor);
        },
        lstat: (path) => {
          if (operation === "lstat" && path.includes("summary.json")) throw cause;
          return harness.fileSystem.lstat(path);
        },
        mkdir: (path, mode) => {
          if (operation === "mkdir") throw cause;
          harness.fileSystem.mkdir(path, mode);
        },
        open: (path, flags, mode) => {
          if (operation === "open") throw cause;
          const descriptor = harness.fileSystem.open(path, flags, mode);
          if (path === REPOSITORY_ROOT) rootDescriptor = descriptor;
          return descriptor;
        },
      });

      const error = expectPublisherError(() => {
        publishLoggingEndToEndSummary({ artifactRun, summary: SUMMARY }, fileSystem);
      }, expectedCode);
      expect(error.cause).toBe(cause);
    });
  });

  it.each([
    ["ELOOP", "SYMLINK"],
    ["EIO", "IO"],
  ] as const)("maps temporary-file open %s", (failureCode, expectedCode) => {
    withArtifactRun((artifactRun) => {
      const harness = createSummaryPublisherTestHarness();
      const cause = new FileSystemFailure(failureCode);
      const fileSystem = createFileSystem(harness, {
        open: (path, flags, mode) => {
          if (mode !== undefined) throw cause;
          return harness.fileSystem.open(path, flags, mode);
        },
      });

      const error = expectPublisherError(() => {
        publishLoggingEndToEndSummary({ artifactRun, summary: SUMMARY }, fileSystem);
      }, expectedCode);
      expect(error.cause).toBe(cause);
    });
  });

  it.each([
    ["zero", 0],
    ["negative", -1],
    ["too-large", 1_000_000],
  ] as const)("rejects a %s temporary write count", (_label, count) => {
    withArtifactRun((artifactRun) => {
      const harness = createSummaryPublisherTestHarness();
      const error = expectPublisherError(() => {
        publishLoggingEndToEndSummary(
          { artifactRun, summary: SUMMARY },
          createFileSystem(harness, { write: () => count }),
        );
      }, "IO");

      expect(error.cause).toBeUndefined();
      expect(harness.operations.some((operation) => operation.startsWith("unlink:"))).toBe(true);
    });
  });

  it.each([
    ["file fsync", "file"],
    ["parent fsync", "parent"],
  ] as const)("preserves a %s failure", (_label, failureTarget) => {
    withArtifactRun((artifactRun) => {
      const harness = createSummaryPublisherTestHarness();
      const cause = new FileSystemFailure("EIO");
      let temporaryDescriptor: number | undefined;
      let fsyncCalls = 0;
      const fileSystem = createFileSystem(harness, {
        fsync: (descriptor) => {
          fsyncCalls += 1;
          if (
            (failureTarget === "file" && descriptor === temporaryDescriptor) ||
            (failureTarget === "parent" && fsyncCalls === 2)
          )
            throw cause;
          harness.fileSystem.fsync(descriptor);
        },
        open: (path, flags, mode) => {
          const descriptor = harness.fileSystem.open(path, flags, mode);
          if (mode !== undefined) temporaryDescriptor = descriptor;
          return descriptor;
        },
      });

      const error = expectPublisherError(() => {
        publishLoggingEndToEndSummary({ artifactRun, summary: SUMMARY }, fileSystem);
      }, "IO");
      expect(error.cause).toBe(cause);
    });
  });

  it("cleans the temporary file after a rename failure", () => {
    withArtifactRun((artifactRun) => {
      const harness = createSummaryPublisherTestHarness();
      const cause = new FileSystemFailure("EIO");
      const error = expectPublisherError(() => {
        publishLoggingEndToEndSummary(
          { artifactRun, summary: SUMMARY },
          createFileSystem(harness, {
            rename: () => {
              throw cause;
            },
          }),
        );
      }, "IO");

      expect(error.cause).toBe(cause);
      expect(harness.operations.some((operation) => operation.startsWith("unlink:"))).toBe(true);
    });
  });

  it("safely reopens a directory after an EEXIST creation race", () => {
    withArtifactRun((artifactRun) => {
      const harness = createSummaryPublisherTestHarness();
      let isCoverageCreated = false;
      const fileSystem = createFileSystem(harness, {
        mkdir: (path, mode) => {
          if (!isCoverageCreated && path.endsWith("/coverage")) {
            isCoverageCreated = true;
            harness.setPath(harness.paths.coverage, "directory");
            throw new FileSystemFailure("EEXIST");
          }
          harness.fileSystem.mkdir(path, mode);
        },
      });

      publishLoggingEndToEndSummary({ artifactRun, summary: SUMMARY }, fileSystem);

      expect(isCoverageCreated).toBe(true);
      expect(harness.publishedContents).toBeDefined();
    });
  });

  it("reports a successful temporary close failure", () => {
    withArtifactRun((artifactRun) => {
      const harness = createSummaryPublisherTestHarness();
      const cause = new FileSystemFailure("EIO-close");
      let temporaryDescriptor: number | undefined;
      let hasThrown = false;
      const fileSystem = createFileSystem(harness, {
        close: (descriptor) => {
          harness.fileSystem.close(descriptor);
          if (descriptor === temporaryDescriptor && !hasThrown) {
            hasThrown = true;
            throw cause;
          }
        },
        open: (path, flags, mode) => {
          const descriptor = harness.fileSystem.open(path, flags, mode);
          if (mode !== undefined) temporaryDescriptor = descriptor;
          return descriptor;
        },
      });

      const error = expectPublisherError(() => {
        publishLoggingEndToEndSummary({ artifactRun, summary: SUMMARY }, fileSystem);
      }, "IO");
      expect(error.cause).toBeInstanceOf(AggregateError);
      if (error.cause instanceof AggregateError)
        expect(error.cause.errors).toMatchObject([
          expect.objectContaining({ cause, code: "IO" }),
          expect.objectContaining({ code: "EBADF" }),
        ]);
    });
  });

  it("reports a directory close failure after a successful publication", () => {
    withArtifactRun((artifactRun) => {
      const harness = createSummaryPublisherTestHarness();
      const cause = new FileSystemFailure("EIO-close-directory");
      let e2eDescriptor: number | undefined;
      const fileSystem = createFileSystem(harness, {
        close: (descriptor) => {
          harness.fileSystem.close(descriptor);
          if (descriptor === e2eDescriptor) throw cause;
        },
        open: (path, flags, mode) => {
          const descriptor = harness.fileSystem.open(path, flags, mode);
          if (mode === undefined && path.endsWith("/e2e")) e2eDescriptor = descriptor;
          return descriptor;
        },
      });

      const error = expectPublisherError(() => {
        publishLoggingEndToEndSummary({ artifactRun, summary: SUMMARY }, fileSystem);
      }, "IO");
      expect(error.cause).toBeInstanceOf(AggregateError);
      if (error.cause instanceof AggregateError) expect(error.cause.errors).toEqual([cause]);
    });
  });

  it("orders primary, temporary-cleanup, and close failures in one aggregate", () => {
    withArtifactRun((artifactRun) => {
      const harness = createSummaryPublisherTestHarness();
      const unlinkCause = new FileSystemFailure("EIO-unlink");
      const closeCause = new FileSystemFailure("EIO-close");
      let temporaryDescriptor: number | undefined;
      const fileSystem = createFileSystem(harness, {
        close: (descriptor) => {
          harness.fileSystem.close(descriptor);
          if (descriptor === temporaryDescriptor) throw closeCause;
        },
        open: (path, flags, mode) => {
          const descriptor = harness.fileSystem.open(path, flags, mode);
          if (mode !== undefined) temporaryDescriptor = descriptor;
          return descriptor;
        },
        unlink: () => {
          throw unlinkCause;
        },
        write: () => 0,
      });

      const error = expectPublisherError(() => {
        publishLoggingEndToEndSummary({ artifactRun, summary: SUMMARY }, fileSystem);
      }, "IO");
      expect(error.cause).toBeInstanceOf(AggregateError);
      if (error.cause instanceof AggregateError)
        expect(error.cause.errors).toMatchObject([
          expect.objectContaining({ code: "IO" }),
          expect.objectContaining({ cause: unlinkCause, code: "CLEANUP" }),
          closeCause,
        ]);
    });
  });

  it.each([
    [
      "fchmod failure",
      "IO",
      (harness: SummaryPublisherTestHarness) =>
        createFileSystem(harness, {
          fchmod: () => {
            throw new FileSystemFailure("EIO-fchmod");
          },
        }),
    ],
    [
      "post-fchmod identity replacement",
      "IDENTITY",
      (harness: SummaryPublisherTestHarness) =>
        createFileSystem(harness, {
          fchmod: (descriptor, mode) => {
            harness.fileSystem.fchmod(descriptor, mode);
            harness.setDirectoryIdentity(harness.paths.coverage);
          },
        }),
    ],
  ] as const)("fails closed on %s", (_label, code, createFileSystemForCase) => {
    withArtifactRun((artifactRun) => {
      const harness = createSummaryPublisherTestHarness({
        coverageMode: 0o775,
        precreateCoverageDirectories: true,
      });
      expectPublisherError(() => {
        publishLoggingEndToEndSummary({ artifactRun, summary: SUMMARY }, createFileSystemForCase(harness));
      }, code);
      expect(harness.operations.some((operation) => /^(rename|write):/.test(operation))).toBe(false);
    });
  });
});
