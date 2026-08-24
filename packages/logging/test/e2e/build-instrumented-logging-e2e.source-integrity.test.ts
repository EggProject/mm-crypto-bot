// eslint-disable-next-line unicorn/import-style -- Bun's node:path declaration only exposes typed named imports under the E2E project's configured type roots.
import { join, resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { createLoggingE2eArtifactRun as createArtifactRun } from "./logging-e2e-artifact-run.ts";
import { buildInstrumentedLoggingEndToEnd } from "./build-instrumented-logging-e2e.ts";
import {
  LOGGING_SOURCE_DIRECTORY,
  REPOSITORY_ROOT,
  absoluteRuntimeFiles,
  loadLoggingEndToEndScopeManifest,
  parseLoggingEndToEndScopeManifest,
  type LoggingEndToEndScopeManifest,
} from "./logging-e2e-scope.ts";
import { readVerifiedRegularFile } from "./logging-e2e-secure-file-reader.ts";
import {
  TestPluginBuilder,
  outputRecords,
  requiredOutputNames,
  successfulBuild,
  withArtifactRun,
  writeBundleFiles,
} from "./build-instrumented-logging-e2e.test-support.ts";

describe("instrumented logging E2E build", () => {
  it("uses the default Bun build executor", async () => {
    const manifest = loadLoggingEndToEndScopeManifest();

    await withArtifactRun(async (artifactRun) => {
      const defaultBuild = vi.fn(successfulBuild(artifactRun, manifest));
      vi.stubGlobal("Bun", { build: defaultBuild });
      try {
        const build = await buildInstrumentedLoggingEndToEnd({ artifactRun, manifest });
        expect(build.instrumentedCount).toBe(manifest.runtimeFiles.length);
        expect(build.childEntry).toBe(join(artifactRun.paths.bundle, "logging-e2e-child.js"));
        expect(build.preloadEntry).toBe(join(artifactRun.paths.bundle, "logging-e2e-preload.js"));
        expect(artifactRun.adoptExternalFiles("bundle")).toEqual(requiredOutputNames(manifest));
        expect(defaultBuild).toHaveBeenCalledOnce();
      } finally {
        vi.unstubAllGlobals();
      }
    });
  });

  it("rejects a runtime manifest entry without the required TypeScript suffix", async () => {
    const artifactRun = createArtifactRun();
    const manifest: LoggingEndToEndScopeManifest = Object.freeze({
      schemaVersion: 1,
      runtimeFiles: Object.freeze(["packages/logging/src/not-typescript.tsx"]),
      e2eCases: Object.freeze(["bad-suffix"]),
    });
    try {
      await expect(buildInstrumentedLoggingEndToEnd({ artifactRun, manifest })).rejects.toThrow(
        "runtime file does not have a TypeScript suffix",
      );
    } finally {
      artifactRun.cleanup();
    }
  });

  it("rejects a pre-existing artifact bundle file before calling the build executor", async () => {
    const manifest = loadLoggingEndToEndScopeManifest();
    let buildCalls = 0;

    await withArtifactRun(async (artifactRun) => {
      writeBundleFiles(artifactRun.paths.bundle, ["leftover.js"]);
      await expect(
        buildInstrumentedLoggingEndToEnd({
          artifactRun,
          manifest,
          build: () => {
            buildCalls += 1;
            return Promise.resolve({ logs: [], outputs: [], success: true });
          },
        }),
      ).rejects.toThrow("artifact bundle must be empty before build");
      expect(buildCalls).toBe(0);
    });
  });

  it("leaves a non-logging TypeScript build input unhandled", async () => {
    const manifest = loadLoggingEndToEndScopeManifest();
    const nonLoggingPath = resolve(REPOSITORY_ROOT, "packages/typeguard/src/index.ts");

    await withArtifactRun(async (artifactRun) => {
      await expect(
        buildInstrumentedLoggingEndToEnd({
          artifactRun,
          manifest,
          build: successfulBuild(artifactRun, manifest, [], async (builder) => {
            expect(await builder.load(nonLoggingPath)).toBeUndefined();
          }),
        }),
      ).rejects.toThrow("did not load every scoped runtime source");
    });
  });

  it("loads a non-runtime logging TypeScript module without instrumentation", async () => {
    const manifest = loadLoggingEndToEndScopeManifest();
    const nonRuntimeLoggingPath = resolve(LOGGING_SOURCE_DIRECTORY, "../test/e2e/logging-e2e-child.ts");

    await withArtifactRun(async (artifactRun) => {
      await expect(
        buildInstrumentedLoggingEndToEnd({
          artifactRun,
          manifest,
          build: successfulBuild(artifactRun, manifest, [], async (builder) => {
            expect(await builder.load(nonRuntimeLoggingPath)).toMatchObject({ loader: "ts" });
          }),
        }),
      ).rejects.toThrow("did not load every scoped runtime source");
    });
  });

  it("rejects a required output-name collision before calling the build executor", async () => {
    const artifactRun = createArtifactRun();
    let buildCalls = 0;
    const manifest: LoggingEndToEndScopeManifest = Object.freeze({
      schemaVersion: 1,
      runtimeFiles: Object.freeze(["packages/logging/src/a.ts", "packages/logging/src/nested/a.ts"]),
      e2eCases: Object.freeze(["collision"]),
    });
    try {
      await expect(
        buildInstrumentedLoggingEndToEnd({
          artifactRun,
          manifest,
          build: () => {
            buildCalls += 1;
            return Promise.resolve({ logs: [], outputs: [], success: true });
          },
        }),
      ).rejects.toThrow("required bundle output names collide");
      expect(buildCalls).toBe(0);
    } finally {
      artifactRun.cleanup();
    }
  });

  it("rejects a runtime source whose bytes change after the pre-build snapshot", async () => {
    const manifest = loadLoggingEndToEndScopeManifest();
    const runtimeFiles = absoluteRuntimeFiles(manifest);
    const firstRuntimeFile = runtimeFiles[0];
    if (firstRuntimeFile === undefined) throw new Error("Expected a runtime source.");
    let sourceReads = 0;

    await withArtifactRun(async (artifactRun) => {
      await expect(
        buildInstrumentedLoggingEndToEnd({
          artifactRun,
          manifest,
          readSource: (path) => {
            sourceReads += 1;
            const isChanged = sourceReads > runtimeFiles.length && path === firstRuntimeFile;
            return {
              contents: new TextEncoder().encode(`export const snapshotProbe = ${isChanged ? "22" : "1"};`),
              identity: { device: 1n, inode: 1n },
            };
          },
          build: async (config) => {
            const firstPlugin = config.plugins?.[0];
            if (firstPlugin === undefined) throw new Error("Expected instrumenting build plugin.");
            const builder = new TestPluginBuilder(config);
            await firstPlugin.setup(builder);
            for (const runtimeFile of runtimeFiles) await builder.load(runtimeFile);
            const expectedNames = requiredOutputNames(manifest);
            writeBundleFiles(artifactRun.paths.bundle, expectedNames);
            return {
              logs: [],
              outputs: outputRecords(artifactRun.paths.bundle, expectedNames),
              success: true,
            };
          },
        }),
      ).rejects.toThrow(`Logging E2E build source changed during build: ${firstRuntimeFile}`);
      expect(sourceReads).toBeGreaterThan(runtimeFiles.length);
    });
  });

  it("rejects a successful build that skips one required runtime onLoad callback", async () => {
    const manifest = loadLoggingEndToEndScopeManifest();
    const runtimeFiles = absoluteRuntimeFiles(manifest);
    const skippedRuntimeFile = runtimeFiles[0];
    if (skippedRuntimeFile === undefined) throw new Error("Expected a runtime source.");

    await withArtifactRun(async (artifactRun) => {
      await expect(
        buildInstrumentedLoggingEndToEnd({
          artifactRun,
          manifest,
          build: async (config) => {
            const firstPlugin = config.plugins?.[0];
            if (firstPlugin === undefined) throw new Error("Expected instrumenting build plugin.");
            const builder = new TestPluginBuilder(config);
            await firstPlugin.setup(builder);
            for (const runtimeFile of runtimeFiles) {
              if (runtimeFile !== skippedRuntimeFile) await builder.load(runtimeFile);
            }
            const expectedNames = requiredOutputNames(manifest);
            writeBundleFiles(artifactRun.paths.bundle, expectedNames);
            return {
              logs: [],
              outputs: outputRecords(artifactRun.paths.bundle, expectedNames),
              success: true,
            };
          },
        }),
      ).rejects.toThrow(
        `Instrumented logging E2E Bun build did not load every scoped runtime source:\n${skippedRuntimeFile}`,
      );
    });
  });

  it("rejects a duplicated runtime source onLoad callback", async () => {
    const manifest = loadLoggingEndToEndScopeManifest();
    const runtimeFiles = absoluteRuntimeFiles(manifest);
    const firstRuntimeFile = runtimeFiles[0];
    if (firstRuntimeFile === undefined) throw new Error("Expected a runtime source.");

    await withArtifactRun(async (artifactRun) => {
      await expect(
        buildInstrumentedLoggingEndToEnd({
          artifactRun,
          manifest,
          build: async (config) => {
            const firstPlugin = config.plugins?.[0];
            if (firstPlugin === undefined) throw new Error("Expected instrumenting build plugin.");
            const builder = new TestPluginBuilder(config);
            await firstPlugin.setup(builder);
            await builder.load(firstRuntimeFile);
            await builder.load(firstRuntimeFile);
            return { logs: [], outputs: [], success: true };
          },
        }),
      ).rejects.toThrow(`Logging runtime source was loaded more than once: ${firstRuntimeFile}`);
    });
  });

  it("rejects scope validation that changes after a successful build", async () => {
    const manifest = loadLoggingEndToEndScopeManifest();
    const runtimeFiles = absoluteRuntimeFiles(manifest);
    let validationCalls = 0;

    await withArtifactRun(async (artifactRun) => {
      await expect(
        buildInstrumentedLoggingEndToEnd({
          artifactRun,
          manifest,
          validateScope: (candidate) => {
            validationCalls += 1;
            if (validationCalls === 2) throw new Error("simulated scope changed");
            return parseLoggingEndToEndScopeManifest(candidate);
          },
          build: async (config) => {
            const firstPlugin = config.plugins?.[0];
            if (firstPlugin === undefined) throw new Error("Expected instrumenting build plugin.");
            const builder = new TestPluginBuilder(config);
            await firstPlugin.setup(builder);
            for (const runtimeFile of runtimeFiles) await builder.load(runtimeFile);
            const expectedNames = requiredOutputNames(manifest);
            writeBundleFiles(artifactRun.paths.bundle, expectedNames);
            return {
              logs: [],
              outputs: outputRecords(artifactRun.paths.bundle, expectedNames),
              success: true,
            };
          },
        }),
      ).rejects.toThrow("simulated scope changed");
      expect(validationCalls).toBe(2);
    });
  });

  it("rejects an unowned logging runtime path before attempting a source read", async () => {
    const manifest = loadLoggingEndToEndScopeManifest();
    const unownedRuntimePath = resolve(LOGGING_SOURCE_DIRECTORY, "unlisted.ts");
    let unownedReads = 0;

    await withArtifactRun(async (artifactRun) => {
      await expect(
        buildInstrumentedLoggingEndToEnd({
          artifactRun,
          manifest,
          readSource: (path, root, label) => {
            if (path === unownedRuntimePath) unownedReads += 1;
            return readVerifiedRegularFile(path, root, label);
          },
          build: async (config) => {
            const firstPlugin = config.plugins?.[0];
            if (firstPlugin === undefined) throw new Error("Expected instrumenting build plugin.");
            const builder = new TestPluginBuilder(config);
            await firstPlugin.setup(builder);
            await builder.load(unownedRuntimePath);
            return { logs: [], outputs: [], success: true };
          },
        }),
      ).rejects.toThrow(`Logging E2E Bun build loaded unowned runtime source: ${unownedRuntimePath}`);
      expect(unownedReads).toBe(0);
    });
  });

  it("loads the preload only from its pre-build byte snapshot", async () => {
    const manifest = loadLoggingEndToEndScopeManifest();
    const preloadPath = resolve(REPOSITORY_ROOT, "packages/logging/test/e2e/logging-e2e-preload.ts");
    const preBuildBytes = new TextEncoder().encode("export const preloadSnapshot = 1;");
    let preloadReads = 0;

    await withArtifactRun(async (artifactRun) => {
      await buildInstrumentedLoggingEndToEnd({
        artifactRun,
        manifest,
        readSource: (path, root, label) => {
          if (path !== preloadPath) return readVerifiedRegularFile(path, root, label);
          preloadReads += 1;
          return {
            contents: preBuildBytes,
            identity: { device: 1n, inode: 1n },
          };
        },
        build: successfulBuild(artifactRun, manifest, undefined, async (builder) => {
          const loaded = await builder.load(preloadPath);
          if (loaded === undefined || !("contents" in loaded)) {
            throw new Error("Expected preload onLoad source contents.");
          }
          expect(loaded.contents).toBe(new TextDecoder().decode(preBuildBytes));
        }),
      });
      expect(preloadReads).toBeGreaterThan(1);
    });
  });

  it("rejects when the preload changes after its pre-build byte snapshot", async () => {
    const manifest = loadLoggingEndToEndScopeManifest();
    const preloadPath = resolve(REPOSITORY_ROOT, "packages/logging/test/e2e/logging-e2e-preload.ts");
    let preloadReads = 0;

    await withArtifactRun(async (artifactRun) => {
      await expect(
        buildInstrumentedLoggingEndToEnd({
          artifactRun,
          manifest,
          readSource: (path, root, label) => {
            if (path !== preloadPath) return readVerifiedRegularFile(path, root, label);
            preloadReads += 1;
            return {
              contents: new TextEncoder().encode(preloadReads === 1 ? "export const before = 1;" : "changed"),
              identity: { device: 1n, inode: 1n },
            };
          },
          build: successfulBuild(artifactRun, manifest),
        }),
      ).rejects.toThrow(`Logging E2E build source changed during build: ${preloadPath}`);
    });
  });
});
