import coveragePackage from "istanbul-lib-coverage";
import { describe, expect, it } from "vitest";

import { createLoggingE2eArtifactRun as createArtifactRun } from "./logging-e2e-artifact-run.ts";
import { type LoggingEndToEndCoverageSummary } from "./logging-e2e-gate.ts";
import {
  LoggingE2eSummaryPublisherError as SummaryPublisherError,
  publishLoggingEndToEndSummary,
} from "./logging-e2e-summary-publisher.ts";
import { createSummaryPublisherTestHarness } from "./logging-e2e-summary-publisher.test-support.ts";

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
const EXPECTED_CONTENTS = new TextEncoder().encode(`${JSON.stringify(SUMMARY, undefined, 2)}\n`);

function withArtifactRun(action: (artifactRun: ReturnType<typeof createArtifactRun>) => void): void {
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

describe("logging E2E summary publisher construction", () => {
  it("publishes exact artifact bytes through verified descriptor paths", () => {
    withArtifactRun((artifactRun) => {
      const harness = createSummaryPublisherTestHarness({ partialWrites: true });

      publishLoggingEndToEndSummary({ artifactRun, summary: SUMMARY }, harness.fileSystem);

      expect([...(harness.publishedContents ?? [])]).toEqual([...EXPECTED_CONTENTS]);
      expect([...artifactRun.readFile("bundle", "e2e-summary.json")]).toEqual([...EXPECTED_CONTENTS]);
      expect(harness.operations.filter((operation) => operation.startsWith("mkdir:"))).toEqual([
        `mkdir:/proc/self/fd/103/coverage:448`,
        `mkdir:/proc/self/fd/104/e2e:448`,
      ]);
      expect(harness.operations.some((operation) => operation.includes(".summary.json.tmp:384"))).toBe(true);
      expect(
        harness.operations
          .filter((operation) => operation.startsWith("write:"))
          .map((operation) => operation.split(":").at(-1)),
      ).toEqual(
        Array.from({ length: EXPECTED_CONTENTS.byteLength }, (_value, index) =>
          String(EXPECTED_CONTENTS.byteLength - index),
        ),
      );
      expect(
        harness.operations.some((operation) =>
          operation.startsWith("rename:/proc/self/fd/105/.summary.json.tmp:/proc/self/fd/105/summary.json"),
        ),
      ).toBe(true);
      expect(harness.operations.filter((operation) => operation.startsWith("fsync:")).length).toBe(2);
    });
  });

  it("restricts pre-existing output parents before writing", () => {
    withArtifactRun((artifactRun) => {
      const harness = createSummaryPublisherTestHarness({
        coverageMode: 0o775,
        precreateCoverageDirectories: true,
      });
      publishLoggingEndToEndSummary({ artifactRun, summary: SUMMARY }, harness.fileSystem);
      const firstWrite = harness.operations.findIndex((operation) => operation.startsWith("write:"));
      expect(harness.operations.filter((operation) => operation.startsWith("fchmod:")).length).toBe(2);
      expect(harness.operations.findIndex((operation) => operation.startsWith("fchmod:"))).toBeLessThan(
        firstWrite,
      );
    });
  });

  it("rejects a wrong-owner output parent before writing or renaming", () => {
    withArtifactRun((artifactRun) => {
      const harness = createSummaryPublisherTestHarness({ precreateCoverageDirectories: true });
      harness.setDirectoryMetadata(harness.paths.coverage, 1001, 0o700);
      expectPublisherError(() => {
        publishLoggingEndToEndSummary({ artifactRun, summary: SUMMARY }, harness.fileSystem);
      }, "PERMISSION");
      expect(harness.operations.some((operation) => /^(rename|write):/.test(operation))).toBe(false);
    });
  });

  it.each([
    [
      "non-Linux platform",
      () => {
        return createSummaryPublisherTestHarness({ platform: "darwin" });
      },
    ],
    [
      "create flag",
      () => {
        return createSummaryPublisherTestHarness({ flagOverride: { O_CREAT: "invalid" } });
      },
    ],
    [
      "directory flag",
      () => {
        return createSummaryPublisherTestHarness({ flagOverride: { O_DIRECTORY: "invalid" } });
      },
    ],
    [
      "exclusive flag",
      () => {
        return createSummaryPublisherTestHarness({ flagOverride: { O_EXCL: "invalid" } });
      },
    ],
    [
      "no-follow flag",
      () => {
        return createSummaryPublisherTestHarness({ flagOverride: { O_NOFOLLOW: "invalid" } });
      },
    ],
    [
      "read-only flag",
      () => {
        return createSummaryPublisherTestHarness({ flagOverride: { O_RDONLY: "invalid" } });
      },
    ],
    [
      "write-only flag",
      () => {
        return createSummaryPublisherTestHarness({ flagOverride: { O_WRONLY: "invalid" } });
      },
    ],
  ])("rejects %s before opening a filesystem descriptor", (_label, createHarness) => {
    withArtifactRun((artifactRun) => {
      const harness = createHarness();

      expectPublisherError(() => {
        publishLoggingEndToEndSummary({ artifactRun, summary: SUMMARY }, harness.fileSystem);
      }, "E_E2E_SUMMARY_UNSUPPORTED");
      expect(harness.operations).toEqual([]);
    });
  });

  it.each([
    ["intermediate symlink", "logging", "symlink", "SYMLINK"],
    ["final-parent symlink", "coverage", "symlink", "SYMLINK"],
    ["intermediate non-directory", "logging", "other", "TYPE"],
    ["final-parent non-directory", "coverage", "other", "TYPE"],
  ] as const)("rejects a %s", (_label, pathName, kind, code) => {
    withArtifactRun((artifactRun) => {
      const harness = createSummaryPublisherTestHarness();
      const path = pathName === "logging" ? harness.paths.logging : harness.paths.coverage;
      harness.setPath(path, kind);

      expectPublisherError(() => {
        publishLoggingEndToEndSummary({ artifactRun, summary: SUMMARY }, harness.fileSystem);
      }, code);
    });
  });

  it.each([
    ["symlink", "symlink", "SYMLINK"],
    ["non-regular file", "other", "TYPE"],
  ] as const)("rejects a final summary %s", (_label, kind, code) => {
    withArtifactRun((artifactRun) => {
      const harness = createSummaryPublisherTestHarness();
      harness.setPath(harness.paths.final, kind);

      expectPublisherError(() => {
        publishLoggingEndToEndSummary({ artifactRun, summary: SUMMARY }, harness.fileSystem);
      }, code);
    });
  });

  it("rejects an existing fixed temporary file without changing the final summary", () => {
    withArtifactRun((artifactRun) => {
      const harness = createSummaryPublisherTestHarness();
      const original = new Uint8Array([111, 108, 100]);
      harness.setPath(harness.paths.final, "file", original);
      harness.setPath(harness.paths.temporary, "file", new Uint8Array());

      expectPublisherError(() => {
        publishLoggingEndToEndSummary({ artifactRun, summary: SUMMARY }, harness.fileSystem);
      }, "EXISTS");
      expect([...(harness.publishedContents ?? [])]).toEqual([...original]);
    });
  });

  it("rejects a post-rename final identity mismatch", () => {
    withArtifactRun((artifactRun) => {
      const harness = createSummaryPublisherTestHarness();
      harness.setFinalIdentityMismatch();

      expectPublisherError(() => {
        publishLoggingEndToEndSummary({ artifactRun, summary: SUMMARY }, harness.fileSystem);
      }, "IDENTITY");
    });
  });
});
