import { existsSync, unlinkSync, writeFileSync } from "node:fs";
// eslint-disable-next-line unicorn/import-style -- Bun's node:path declaration only exposes typed named imports under the E2E project's configured type roots.
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { createLoggingE2eArtifactRun as createArtifactRun } from "./logging-e2e-artifact-run.ts";
import { buildInstrumentedLoggingEndToEnd } from "./build-instrumented-logging-e2e.ts";
import { loadLoggingEndToEndScopeManifest } from "./logging-e2e-scope.ts";
import {
  outputRecords,
  requiredFirstName,
  requiredOutputNames,
  withArtifactRun,
  writeBundleFiles,
} from "./build-instrumented-logging-e2e.test-support.ts";

describe("instrumented logging E2E build", () => {
  it.each([
    ["missing", (names: readonly string[]) => names.slice(1), "must exactly equal required outputs", true],
    [
      "extra",
      (names: readonly string[]) => [...names, "extra.js"],
      "must exactly equal required outputs",
      true,
    ],
    [
      "duplicate",
      (names: readonly string[]) => [...names, requiredFirstName(names)],
      "duplicate basename",
      false,
    ],
  ] as const)(
    "rejects %s reported build outputs",
    async (_label, selectNames, expectedMessage, writesOutputs) => {
      const manifest = loadLoggingEndToEndScopeManifest();
      const expectedNames = requiredOutputNames(manifest);

      await withArtifactRun(async (artifactRun) => {
        await expect(
          buildInstrumentedLoggingEndToEnd({
            artifactRun,
            manifest,
            build: () => {
              const reportedNames = selectNames(expectedNames);
              if (writesOutputs) writeBundleFiles(artifactRun.paths.bundle, reportedNames);
              return Promise.resolve({
                logs: [],
                outputs: outputRecords(artifactRun.paths.bundle, reportedNames),
                success: true,
              });
            },
          }),
        ).rejects.toThrow(expectedMessage);
      });
    },
  );

  it("rejects a non-direct reported build output", async () => {
    const manifest = loadLoggingEndToEndScopeManifest();
    const expectedNames = requiredOutputNames(manifest);

    await withArtifactRun(async (artifactRun) => {
      await expect(
        buildInstrumentedLoggingEndToEnd({
          artifactRun,
          manifest,
          build: () =>
            Promise.resolve({
              logs: [],
              outputs: [
                ...outputRecords(artifactRun.paths.bundle, expectedNames.slice(1)),
                { path: join(artifactRun.paths.bundle, "nested", requiredFirstName(expectedNames)) },
              ],
              success: true,
            }),
        }),
      ).rejects.toThrow("not a direct bundle child");
    });
  });

  it("rejects adopted bundle files that differ from the reported build outputs", async () => {
    const manifest = loadLoggingEndToEndScopeManifest();
    const expectedNames = requiredOutputNames(manifest);

    await withArtifactRun(async (artifactRun) => {
      await expect(
        buildInstrumentedLoggingEndToEnd({
          artifactRun,
          manifest,
          build: () => {
            writeBundleFiles(artifactRun.paths.bundle, expectedNames.slice(1));
            return Promise.resolve({
              logs: [],
              outputs: outputRecords(artifactRun.paths.bundle, expectedNames),
              success: true,
            });
          },
        }),
      ).rejects.toThrow("adopted bundle files must exactly equal reported Bun build outputs");
    });
  });

  it("keeps the failed-build diagnostic after adopting its partial observed bundle", async () => {
    const manifest = loadLoggingEndToEndScopeManifest();
    const expectedNames = requiredOutputNames(manifest);
    const partialNames = expectedNames.slice(1);
    const diagnostic = "simulated failed build";

    await withArtifactRun(async (artifactRun) => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => false);
      try {
        await expect(
          buildInstrumentedLoggingEndToEnd({
            artifactRun,
            manifest,
            build: () => {
              writeBundleFiles(artifactRun.paths.bundle, partialNames);
              return Promise.resolve({
                logs: [{ message: diagnostic }],
                outputs: outputRecords(artifactRun.paths.bundle, partialNames),
                success: false,
              });
            },
          }),
        ).rejects.toThrow("Instrumented logging E2E Bun build failed");
        expect(errorSpy).toHaveBeenCalledWith(diagnostic);
        expect(artifactRun.adoptExternalFiles("bundle")).toEqual(partialNames);
      } finally {
        errorSpy.mockRestore();
      }
    });
  });

  it("adopts partial files after a rejected build so cleanup removes them", async () => {
    const manifest = loadLoggingEndToEndScopeManifest();
    const artifactRun = createArtifactRun();
    const partialPath = join(artifactRun.paths.bundle, "partial.js");
    const buildFailure = new Error("simulated rejected build");
    try {
      await expect(
        buildInstrumentedLoggingEndToEnd({
          artifactRun,
          manifest,
          build: () => {
            // eslint-disable-next-line security/detect-non-literal-fs-filename -- The artifact run owns this direct bundle child path.
            writeFileSync(partialPath, new Uint8Array([1]));
            return Promise.reject(buildFailure);
          },
        }),
      ).rejects.toBe(buildFailure);
      expect(artifactRun.adoptExternalFiles("bundle")).toEqual(["partial.js"]);
      artifactRun.cleanup();
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- The artifact run owns this freshly allocated root path.
      expect(existsSync(artifactRun.paths.root)).toBe(false);
    } finally {
      artifactRun.cleanup();
    }
  });

  it("preserves build failure first when rejected-build partial adoption also fails", async () => {
    const manifest = loadLoggingEndToEndScopeManifest();
    const artifactRun = createArtifactRun();
    const invalidPartialPath = join(artifactRun.paths.bundle, "invalid partial.js");
    const buildFailure = new Error("simulated rejected build");
    try {
      let thrown: unknown;
      try {
        await buildInstrumentedLoggingEndToEnd({
          artifactRun,
          manifest,
          build: () => {
            // eslint-disable-next-line security/detect-non-literal-fs-filename -- The artifact run owns this direct bundle child path.
            writeFileSync(invalidPartialPath, new Uint8Array([1]));
            return Promise.reject(buildFailure);
          },
        });
      } catch (error: unknown) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(AggregateError);
      if (!(thrown instanceof AggregateError))
        throw new Error("Expected rejected-build adoption AggregateError.");
      expect(thrown.errors[0]).toBe(buildFailure);
      expect(thrown.errors[1]).toBeInstanceOf(Error);
    } finally {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- This is the test's intentionally invalid, direct artifact child.
      if (existsSync(invalidPartialPath)) unlinkSync(invalidPartialPath);
      artifactRun.cleanup();
    }
  });
});
