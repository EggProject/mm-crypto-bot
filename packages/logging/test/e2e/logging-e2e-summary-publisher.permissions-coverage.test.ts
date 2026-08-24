import coveragePackage from "istanbul-lib-coverage";
import { describe, expect, it } from "vitest";

import { createLoggingE2eArtifactRun as createArtifactRun } from "./logging-e2e-artifact-run.ts";
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

function createFileSystem(
  harness: SummaryPublisherTestHarness,
  overrides: FileSystemOverrides,
): SummaryPublisherFileSystem {
  return Object.freeze({ ...harness.fileSystem, ...overrides });
}

function withArtifactRun(action: (artifactRun: ReturnType<typeof createArtifactRun>) => void): void {
  const artifactRun = createArtifactRun();
  try {
    action(artifactRun);
  } finally {
    artifactRun.cleanup();
  }
}

function publishWith(
  fileSystem: SummaryPublisherFileSystem,
  action: (error: SummaryPublisherError | undefined) => void,
): void {
  withArtifactRun((artifactRun) => {
    let thrown: SummaryPublisherError | undefined;
    try {
      publishLoggingEndToEndSummary({ artifactRun, summary: SUMMARY }, fileSystem);
    } catch (error: unknown) {
      if (error instanceof SummaryPublisherError) thrown = error;
      else throw error;
    }
    action(thrown);
  });
}

describe("logging E2E summary publisher permission coverage", () => {
  it("exposes the current Node process uid through its public filesystem adapter", () => {
    const fileSystem = createNodeSummaryPublisherFileSystem();
    const expectedUid = typeof process.getuid === "function" ? process.getuid() : undefined;

    expect(fileSystem.getUid?.()).toBe(expectedUid);
  });

  it("rejects an absent uid callback before mutable filesystem work", () => {
    const harness = createSummaryPublisherTestHarness();
    const { getUid: _discardedGetUid, ...fileSystemWithoutUid } = harness.fileSystem;

    publishWith(Object.freeze(fileSystemWithoutUid), (error) => {
      expect(error?.code).toBe("E_E2E_SUMMARY_UNSUPPORTED");
      expect(harness.operations.filter((operation) => /^(rename|write):/.test(operation))).toHaveLength(0);
    });
  });

  it.each([
    ["negative", -1],
    ["unsafe", Number.MAX_SAFE_INTEGER + 1],
  ] as const)("rejects a %s uid before mutable filesystem work", (_label, uid) => {
    const harness = createSummaryPublisherTestHarness();

    publishWith(createFileSystem(harness, { getUid: () => uid }), (error) => {
      expect(error?.code).toBe("E_E2E_SUMMARY_UNSUPPORTED");
      expect(harness.operations).toEqual([]);
    });
  });

  it("maps an initial output-parent permission fstat failure to IO", () => {
    const harness = createSummaryPublisherTestHarness({ precreateCoverageDirectories: true });
    const cause = new FileSystemFailure("EIO-initial-fstat");
    let coverageDescriptor: number | undefined;
    let coverageFstatCalls = 0;
    const fileSystem = createFileSystem(harness, {
      fstat: (descriptor) => {
        if (descriptor === coverageDescriptor) {
          coverageFstatCalls += 1;
          if (coverageFstatCalls === 2) throw cause;
        }
        return harness.fileSystem.fstat(descriptor);
      },
      open: (path, flags, mode) => {
        const descriptor = harness.fileSystem.open(path, flags, mode);
        if (path.endsWith("/coverage")) coverageDescriptor = descriptor;
        return descriptor;
      },
    });

    publishWith(fileSystem, (error) => {
      expect(error?.code).toBe("IO");
      expect(error?.cause).toBe(cause);
      expect(harness.operations.some((operation) => /^(rename|write):/.test(operation))).toBe(false);
    });
  });

  it.each(["fstat", "lstat"] as const)("maps a post-fchmod %s failure to IO", (operation) => {
    const harness = createSummaryPublisherTestHarness({ precreateCoverageDirectories: true });
    const cause = new FileSystemFailure(`EIO-post-fchmod-${operation}`);
    let isCoverageTightened = false;
    let coverageDescriptor: number | undefined;
    let postFchmodFstatCalls = 0;
    let postFchmodLstatCalls = 0;
    const fileSystem = createFileSystem(harness, {
      fchmod: (descriptor, mode) => {
        harness.fileSystem.fchmod(descriptor, mode);
        if (descriptor === coverageDescriptor) isCoverageTightened = true;
      },
      fstat: (descriptor) => {
        if (isCoverageTightened && descriptor === coverageDescriptor) {
          postFchmodFstatCalls += 1;
          if (operation === "fstat" && postFchmodFstatCalls === 2) throw cause;
        }
        return harness.fileSystem.fstat(descriptor);
      },
      lstat: (path) => {
        if (isCoverageTightened && path === harness.paths.coverage) {
          postFchmodLstatCalls += 1;
          if (operation === "lstat" && postFchmodLstatCalls === 2) throw cause;
        }
        return harness.fileSystem.lstat(path);
      },
      open: (path, flags, mode) => {
        const descriptor = harness.fileSystem.open(path, flags, mode);
        if (path.endsWith("/coverage")) coverageDescriptor = descriptor;
        return descriptor;
      },
    });

    publishWith(fileSystem, (error) => {
      expect(error?.code).toBe("IO");
      expect(error?.cause).toBe(cause);
      expect(harness.operations.some((entry) => /^(rename|write):/.test(entry))).toBe(false);
    });
  });

  it.each([
    ["opened uid", 1001, 0o700],
    ["linked uid", 1001, 0o700],
    ["opened mode", 1000, 0o755],
    ["linked mode", 1000, 0o755],
  ] as const)("rejects a non-private post-fchmod %s", (target, uid, mode) => {
    const harness = createSummaryPublisherTestHarness({ precreateCoverageDirectories: true });
    const shouldAlterLinkedMetadata = target === "linked uid" || target === "linked mode";
    const shouldAlterOpenedMetadata = target === "opened uid" || target === "opened mode";
    let coverageDescriptor: number | undefined;
    let isCoverageTightened = false;
    let postFchmodFstatCalls = 0;
    let postFchmodLstatCalls = 0;
    const fileSystem = createFileSystem(harness, {
      fchmod: (descriptor, requestedMode) => {
        harness.fileSystem.fchmod(descriptor, requestedMode);
        if (descriptor === coverageDescriptor) isCoverageTightened = true;
      },
      fstat: (descriptor) => {
        const result = harness.fileSystem.fstat(descriptor);
        if (descriptor !== coverageDescriptor || !isCoverageTightened) return result;
        postFchmodFstatCalls += 1;
        if (postFchmodFstatCalls === 2 && shouldAlterOpenedMetadata)
          return Object.freeze({ ...result, mode: BigInt(mode), uid: BigInt(uid) });
        return result;
      },
      lstat: (path) => {
        const result = harness.fileSystem.lstat(path);
        if (path !== harness.paths.coverage) return result;
        if (!isCoverageTightened) return result;
        postFchmodLstatCalls += 1;
        if (postFchmodLstatCalls === 2 && shouldAlterLinkedMetadata)
          return Object.freeze({ ...result, mode: BigInt(mode), uid: BigInt(uid) });
        return result;
      },
      open: (path, flags, requestedMode) => {
        const descriptor = harness.fileSystem.open(path, flags, requestedMode);
        if (path.endsWith("/coverage")) coverageDescriptor = descriptor;
        return descriptor;
      },
    });

    publishWith(fileSystem, (error) => {
      expect(error?.code).toBe("PERMISSION");
      expect(harness.operations.some((operation) => /^(rename|write):/.test(operation))).toBe(false);
    });
  });

  it.each(["opened", "linked"] as const)("rejects a one-sided post-fchmod %s identity mismatch", (target) => {
    const harness = createSummaryPublisherTestHarness({ precreateCoverageDirectories: true });
    let coverageDescriptor: number | undefined;
    let isCoverageTightened = false;
    let postFchmodFstatCalls = 0;
    let postFchmodLstatCalls = 0;
    const fileSystem = createFileSystem(harness, {
      fchmod: (descriptor, mode) => {
        harness.fileSystem.fchmod(descriptor, mode);
        if (descriptor === coverageDescriptor) isCoverageTightened = true;
      },
      fstat: (descriptor) => {
        const result = harness.fileSystem.fstat(descriptor);
        if (descriptor !== coverageDescriptor || !isCoverageTightened) return result;
        postFchmodFstatCalls += 1;
        if (target === "opened" && postFchmodFstatCalls === 2)
          return Object.freeze({ ...result, ino: result.ino + 1n });
        return result;
      },
      lstat: (path) => {
        const result = harness.fileSystem.lstat(path);
        if (path !== harness.paths.coverage) return result;
        if (!isCoverageTightened) return result;
        postFchmodLstatCalls += 1;
        if (target === "linked" && postFchmodLstatCalls === 2)
          return Object.freeze({ ...result, ino: result.ino + 1n });
        return result;
      },
      open: (path, flags, mode) => {
        const descriptor = harness.fileSystem.open(path, flags, mode);
        if (path.endsWith("/coverage")) coverageDescriptor = descriptor;
        return descriptor;
      },
    });

    publishWith(fileSystem, (error) => {
      expect(error?.code).toBe("IDENTITY");
      expect(harness.operations.some((operation) => /^(rename|write):/.test(operation))).toBe(false);
    });
  });
});
