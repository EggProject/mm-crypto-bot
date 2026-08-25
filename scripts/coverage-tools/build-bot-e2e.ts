/* eslint-disable security/detect-non-literal-fs-filename -- output cleanup is guarded by an exact repository-owned parent/name check */
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";

import instrumentPackage from "istanbul-lib-instrument";

import { REPOSITORY_ROOT, absoluteRuntimeFiles, loadScopeManifest } from "./bot-runtime-scope.ts";

const createInstrumenter = instrumentPackage.createInstrumenter.bind(instrumentPackage);
const OUTPUT_DIRECTORY = path.resolve(REPOSITORY_ROOT, "apps/bot/coverage/e2e/bundle");
const E2E_DIRECTORY = path.resolve(REPOSITORY_ROOT, "apps/bot/coverage/e2e");
const parserPlugins: readonly string[] = [
  "asyncGenerators",
  "bigInt",
  "classProperties",
  "classPrivateProperties",
  "classPrivateMethods",
  "dynamicImport",
  "importMeta",
  "numericSeparator",
  "objectRestSpread",
  "optionalCatchBinding",
  "topLevelAwait",
  "typescript",
];

function recreateOutputDirectory(): void {
  if (
    path.resolve(OUTPUT_DIRECTORY, "..") !== E2E_DIRECTORY ||
    path.basename(OUTPUT_DIRECTORY) !== "bundle"
  ) {
    throw new Error(`refusing to clean unexpected bundle directory: ${OUTPUT_DIRECTORY}`);
  }
  rmSync(OUTPUT_DIRECTORY, { recursive: true, force: true });
  mkdirSync(OUTPUT_DIRECTORY, { recursive: true });
}

async function buildInstrumentedBotEndToEnd(): Promise<{
  readonly cliEntry: string;
  readonly startModule: string;
  readonly runtimeDriverEntry: string;
  readonly instrumentedCount: number;
}> {
  const manifest = loadScopeManifest();
  const ownedFiles = new Set<string>(absoluteRuntimeFiles(manifest));
  const instrumentedFiles = new Set<string>();
  recreateOutputDirectory();

  const result = await Bun.build({
    entrypoints: [
      path.resolve(REPOSITORY_ROOT, "apps/bot/src/index.ts"),
      path.resolve(REPOSITORY_ROOT, "apps/bot/src/cli/commands/start.ts"),
      path.resolve(REPOSITORY_ROOT, "apps/bot/test/e2e/runtime-driver/runtime-driver.ts"),
    ],
    target: "bun",
    format: "esm",
    outdir: OUTPUT_DIRECTORY,
    naming: "[name].js",
    plugins: [
      {
        name: "instrument-owned-bot-runtime",
        setup(builder) {
          builder.onLoad({ filter: /\.[cm]?tsx?$/u }, async ({ path: filePath }) => {
            const absolutePath = path.resolve(filePath);
            if (!ownedFiles.has(absolutePath)) return;
            if (instrumentedFiles.has(absolutePath)) {
              throw new Error(`runtime source was loaded more than once: ${absolutePath}`);
            }
            instrumentedFiles.add(absolutePath);
            const instrumenter = createInstrumenter({
              esModules: true,
              produceSourceMap: false,
              parserPlugins,
            });
            return {
              contents: instrumenter.instrumentSync(await Bun.file(absolutePath).text(), absolutePath),
              loader: "ts",
            };
          });
        },
      },
    ],
  });

  if (!result.success) {
    for (const log of result.logs) console.error(log.message);
    throw new Error("instrumented Bun build failed");
  }
  const missing: string[] = [];
  for (const ownedFile of ownedFiles) {
    if (!instrumentedFiles.has(ownedFile)) missing.push(ownedFile);
  }
  if (missing.length > 0) {
    throw new Error(`instrumented Bun build did not load owned runtime files:\n${missing.join("\n")}`);
  }

  return {
    cliEntry: path.resolve(OUTPUT_DIRECTORY, "index.js"),
    startModule: path.resolve(OUTPUT_DIRECTORY, "start.js"),
    runtimeDriverEntry: path.resolve(OUTPUT_DIRECTORY, "runtime-driver.js"),
    instrumentedCount: instrumentedFiles.size,
  };
}

if (import.meta.main) {
  try {
    const result = await buildInstrumentedBotEndToEnd();
    console.log(
      `Instrumented ${String(result.instrumentedCount)} owned runtime files into ${OUTPUT_DIRECTORY}.`,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  }
}

export { buildInstrumentedBotEndToEnd as buildInstrumentedBotE2e };
