// eslint-disable-next-line unicorn/import-style -- Bun's node:path declaration only exposes typed named imports under the E2E project's configured type roots.
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";

import instrumentPackage from "istanbul-lib-instrument";

import type { LoggingEndToEndFixture } from "./logging-e2e-fixture.ts";
import {
  LOGGING_DIRECTORY,
  LOGGING_SOURCE_DIRECTORY,
  REPOSITORY_ROOT,
  absoluteRuntimeFiles,
  parseLoggingEndToEndScopeManifest,
  type LoggingEndToEndScopeManifest,
} from "./logging-e2e-scope.ts";

const createInstrumenter = instrumentPackage.createInstrumenter.bind(instrumentPackage);
const CHILD_ENTRY = resolve(REPOSITORY_ROOT, "packages/logging/test/e2e/logging-e2e-child.ts");
const PRELOAD_ENTRY = resolve(REPOSITORY_ROOT, "packages/logging/test/e2e/logging-e2e-preload.ts");
const PARSER_PLUGINS: readonly string[] = [
  "asyncGenerators",
  "bigInt",
  "classProperties",
  "classPrivateMethods",
  "classPrivateProperties",
  "dynamicImport",
  "importMeta",
  "numericSeparator",
  "objectRestSpread",
  "optionalCatchBinding",
  "topLevelAwait",
  "typescript",
];

interface InstrumentedBuildArtifact {
  readonly path: string;
}

interface InstrumentedBuildResponse {
  readonly logs: readonly { readonly message: string }[];
  readonly outputs: readonly InstrumentedBuildArtifact[];
  readonly success: boolean;
}

type InstrumentedBuildExecutor = (config: Bun.BuildConfig) => Promise<InstrumentedBuildResponse>;
type LoggingEndToEndScopeValidator = (manifest: unknown) => LoggingEndToEndScopeManifest;
type LoggingBuildSourceReader = (path: string, root: string, label: string) => Uint8Array;

const executeBunBuild: InstrumentedBuildExecutor = async (config) => Bun.build(config);

function readBuildSource(path: string): Uint8Array {
  const result = Bun.spawnSync({ cmd: ["cat", path], stderr: "pipe", stdout: "pipe" });
  if (result.exitCode !== 0) {
    throw new Error(`Cannot read logging E2E build source: ${new TextDecoder().decode(result.stderr)}.`);
  }
  return new Uint8Array(result.stdout);
}

function isWithinLoggingDirectory(absolutePath: string): boolean {
  const pathFromLoggingDirectory = relative(LOGGING_DIRECTORY, absolutePath);
  return (
    pathFromLoggingDirectory !== "" &&
    pathFromLoggingDirectory !== ".." &&
    !pathFromLoggingDirectory.startsWith(`..${sep}`) &&
    !isAbsolute(pathFromLoggingDirectory)
  );
}

function isWithinLoggingSourceDirectory(absolutePath: string): boolean {
  const pathFromLoggingSourceDirectory = relative(LOGGING_SOURCE_DIRECTORY, absolutePath);
  return (
    pathFromLoggingSourceDirectory !== "" &&
    pathFromLoggingSourceDirectory !== ".." &&
    !pathFromLoggingSourceDirectory.startsWith(`..${sep}`) &&
    !isAbsolute(pathFromLoggingSourceDirectory)
  );
}

function insertionPosition(sorted: readonly string[], name: string): number {
  for (const [position, current] of sorted.entries()) if (name < current) return position;
  return sorted.length;
}

function sortedNames(names: Iterable<string>): readonly string[] {
  const sorted: string[] = [];
  for (const name of names) sorted.splice(insertionPosition(sorted, name), 0, name);
  return Object.freeze(sorted);
}

function requiredBundleOutputNames(manifest: LoggingEndToEndScopeManifest): readonly string[] {
  const requiredOutputNames = ["logging-e2e-child.js", "logging-e2e-preload.js"];
  for (const runtimeFile of manifest.runtimeFiles) {
    if (!runtimeFile.endsWith(".ts")) {
      throw new Error(`Logging E2E runtime file does not have a TypeScript suffix: ${runtimeFile}.`);
    }
    requiredOutputNames.push(`${basename(runtimeFile, ".ts")}.js`);
  }
  const sortedRequiredOutputNames = sortedNames(requiredOutputNames);
  if (new Set(sortedRequiredOutputNames).size !== sortedRequiredOutputNames.length) {
    throw new Error(
      `Logging E2E required bundle output names collide: ${sortedRequiredOutputNames.join(", ")}.`,
    );
  }
  return sortedRequiredOutputNames;
}

function assertEmptyBundle(fixture: LoggingEndToEndFixture): void {
  const adoptedBundleFiles = fixture.listFiles("bundle");
  if (adoptedBundleFiles.length > 0) {
    throw new Error(
      `Logging E2E artifact bundle must be empty before build: ${adoptedBundleFiles.join(", ")}.`,
    );
  }
}

function observedBuildOutputNames(
  fixture: LoggingEndToEndFixture,
  buildResult: InstrumentedBuildResponse,
): readonly string[] {
  const outputNames: string[] = [];
  for (const output of buildResult.outputs) {
    const outputName = basename(output.path);
    if (dirname(output.path) !== fixture.paths.bundle) {
      throw new Error(`Logging E2E Bun build output is not a direct bundle child: ${output.path}.`);
    }
    if (outputNames.includes(outputName)) {
      throw new Error(`Logging E2E Bun build output has a duplicate basename: ${outputName}.`);
    }
    outputNames.push(outputName);
  }
  return sortedNames(outputNames);
}

function assertAdoptedBundleMatchesReportedOutputs(
  fixture: LoggingEndToEndFixture,
  reportedOutputNames: readonly string[],
): readonly string[] {
  const adoptedBundleFiles = fixture.listFiles("bundle");
  if (JSON.stringify(adoptedBundleFiles) !== JSON.stringify(reportedOutputNames)) {
    throw new Error(
      `Logging E2E adopted bundle files must exactly equal reported Bun build outputs. Adopted: ${adoptedBundleFiles.join(", ")}. Reported: ${reportedOutputNames.join(", ")}.`,
    );
  }
  return adoptedBundleFiles;
}

function assertRequiredBundleOutputs(
  reportedOutputNames: readonly string[],
  requiredOutputNames: readonly string[],
): void {
  const sortedOutputNames = reportedOutputNames;
  if (JSON.stringify(sortedOutputNames) !== JSON.stringify(requiredOutputNames)) {
    throw new Error(
      `Logging E2E Bun build outputs must exactly equal required outputs. Reported: ${sortedOutputNames.join(", ")}. Required: ${requiredOutputNames.join(", ")}.`,
    );
  }
}

function snapshotRuntimeSources(
  scopedRuntimeFiles: readonly string[],
  readSource: LoggingBuildSourceReader,
): ReadonlyMap<string, Uint8Array> {
  const snapshots = new Map<string, Uint8Array>();
  for (const runtimeFile of scopedRuntimeFiles) {
    const contents = readSource(runtimeFile, LOGGING_SOURCE_DIRECTORY, "Logging build source");
    snapshots.set(runtimeFile, new Uint8Array(contents));
  }
  return snapshots;
}

function snapshotBuildSource(
  sourceSnapshots: Map<string, Uint8Array>,
  path: string,
  root: string,
  readSource: LoggingBuildSourceReader,
): Uint8Array {
  const existingSnapshot = sourceSnapshots.get(path);
  if (existingSnapshot !== undefined) return existingSnapshot;
  const snapshot = new Uint8Array(readSource(path, root, "Logging build source"));
  sourceSnapshots.set(path, snapshot);
  return snapshot;
}

function areEqualBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  // eslint-disable-next-line security/detect-object-injection -- The index is bounded by the equal Uint8Array lengths above.
  return left.every((byte, index) => byte === right[index]);
}

function assertBuildSourcesUnchanged(
  snapshots: ReadonlyMap<string, Uint8Array>,
  readSource: LoggingBuildSourceReader,
): void {
  for (const [sourceFile, snapshot] of snapshots) {
    const current = readSource(sourceFile, LOGGING_DIRECTORY, "Logging build source");
    if (!areEqualBytes(snapshot, current)) {
      throw new Error(`Logging E2E build source changed during build: ${sourceFile}.`);
    }
  }
}

export async function buildInstrumentedLoggingEndToEnd({
  artifactRun: fixture,
  build = executeBunBuild,
  manifest,
  readSource = readBuildSource,
  validateScope = parseLoggingEndToEndScopeManifest,
}: {
  readonly artifactRun: LoggingEndToEndFixture;
  readonly build?: InstrumentedBuildExecutor;
  readonly manifest: LoggingEndToEndScopeManifest;
  readonly readSource?: LoggingBuildSourceReader;
  readonly validateScope?: LoggingEndToEndScopeValidator;
}): Promise<{
  readonly childEntry: string;
  readonly instrumentedCount: number;
  readonly preloadEntry: string;
}> {
  assertEmptyBundle(fixture);
  const requiredOutputNames = requiredBundleOutputNames(manifest);
  const scopedManifest = validateScope(manifest);
  const scopedRuntimeFiles = absoluteRuntimeFiles(scopedManifest);
  const runtimeSourceSnapshots = snapshotRuntimeSources(scopedRuntimeFiles, readSource);
  const buildSourceSnapshots = new Map<string, Uint8Array>(runtimeSourceSnapshots);
  snapshotBuildSource(buildSourceSnapshots, PRELOAD_ENTRY, LOGGING_DIRECTORY, readSource);
  const instrumentedRuntimeFiles = new Set<string>();
  let buildResult: InstrumentedBuildResponse;
  try {
    buildResult = await build({
      entrypoints: [CHILD_ENTRY, PRELOAD_ENTRY, ...scopedRuntimeFiles],
      target: "bun",
      format: "esm",
      outdir: fixture.paths.bundle,
      naming: "[name].js",
      plugins: [
        {
          name: "instrument-owned-logging-runtime",
          setup(builder) {
            builder.onLoad({ filter: /\.[cm]?ts$/u }, ({ path }) => {
              const absolutePath = resolve(path);
              if (!isWithinLoggingDirectory(absolutePath)) return;
              const runtimeSnapshot = runtimeSourceSnapshots.get(absolutePath);
              if (runtimeSnapshot === undefined) {
                if (isWithinLoggingSourceDirectory(absolutePath)) {
                  throw new Error(`Logging E2E Bun build loaded unowned runtime source: ${absolutePath}.`);
                }
                const snapshot = snapshotBuildSource(
                  buildSourceSnapshots,
                  absolutePath,
                  LOGGING_DIRECTORY,
                  readSource,
                );
                return { contents: new TextDecoder().decode(snapshot), loader: "ts" };
              }
              if (instrumentedRuntimeFiles.has(absolutePath)) {
                throw new Error(`Logging runtime source was loaded more than once: ${absolutePath}.`);
              }
              instrumentedRuntimeFiles.add(absolutePath);
              const instrumenter = createInstrumenter({
                esModules: true,
                parserPlugins: [...PARSER_PLUGINS],
                produceSourceMap: false,
              });
              return {
                contents: instrumenter.instrumentSync(
                  new TextDecoder().decode(runtimeSnapshot),
                  absolutePath,
                ),
                loader: "ts",
              };
            });
          },
        },
      ],
    });
  } catch (buildError: unknown) {
    try {
      fixture.listFiles("bundle");
    } catch (adoptionError: unknown) {
      throw new AggregateError(
        [buildError, adoptionError],
        "Instrumented logging E2E Bun build failed and partial bundle adoption failed.",
        { cause: adoptionError },
      );
    }
    throw buildError;
  }

  const reportedOutputNames = observedBuildOutputNames(fixture, buildResult);
  if (!buildResult.success) {
    assertAdoptedBundleMatchesReportedOutputs(fixture, reportedOutputNames);
    for (const log of buildResult.logs) console.error(log.message);
    throw new Error("Instrumented logging E2E Bun build failed.");
  }
  assertAdoptedBundleMatchesReportedOutputs(fixture, reportedOutputNames);
  assertRequiredBundleOutputs(reportedOutputNames, requiredOutputNames);
  validateScope(manifest);
  assertBuildSourcesUnchanged(buildSourceSnapshots, readSource);
  const missingRuntimeFiles = scopedRuntimeFiles.filter((file) => !instrumentedRuntimeFiles.has(file));
  if (missingRuntimeFiles.length > 0) {
    throw new Error(
      `Instrumented logging E2E Bun build did not load every scoped runtime source:\n${missingRuntimeFiles.join("\n")}`,
    );
  }

  return {
    childEntry: resolve(fixture.paths.bundle, "logging-e2e-child.js"),
    instrumentedCount: instrumentedRuntimeFiles.size,
    preloadEntry: resolve(fixture.paths.bundle, "logging-e2e-preload.js"),
  };
}
