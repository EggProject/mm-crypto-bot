import { writeFileSync } from "node:fs";
// eslint-disable-next-line unicorn/import-style -- Bun's node:path declaration only exposes typed named imports under the E2E project's configured type roots.
import { basename, join } from "node:path";

import { createLoggingE2eArtifactRun as createArtifactRun } from "./logging-e2e-artifact-run.ts";
import { absoluteRuntimeFiles, type LoggingEndToEndScopeManifest } from "./logging-e2e-scope.ts";

export function sortedNames(names: readonly string[]): readonly string[] {
  const sorted: string[] = [];
  for (const name of names) {
    const insertionPosition = sorted.findIndex((current) => name < current);
    sorted.splice(insertionPosition === -1 ? sorted.length : insertionPosition, 0, name);
  }
  return Object.freeze(sorted);
}

export function requiredOutputNames(manifest: LoggingEndToEndScopeManifest): readonly string[] {
  return sortedNames([
    "logging-e2e-child.js",
    "logging-e2e-preload.js",
    ...manifest.runtimeFiles.map((runtimeFile) => `${basename(runtimeFile, ".ts")}.js`),
  ]);
}

export function outputRecords(bundleDirectory: string, names: readonly string[]) {
  return names.map((name) => ({ path: join(bundleDirectory, name) }));
}

export function writeBundleFiles(bundleDirectory: string, names: readonly string[]): void {
  for (const name of names) {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- The artifact run owns this direct bundle child path.
    writeFileSync(join(bundleDirectory, name), new Uint8Array([name.length]));
  }
}

export function requiredFirstName(names: readonly string[]): string {
  const firstName = names[0];
  if (firstName === undefined) throw new Error("Expected at least one required bundle output name.");
  return firstName;
}

export async function withArtifactRun(
  action: (artifactRun: ReturnType<typeof createArtifactRun>) => Promise<void>,
): Promise<void> {
  const artifactRun = createArtifactRun();
  try {
    await action(artifactRun);
  } finally {
    artifactRun.cleanup();
  }
}

export class TestPluginBuilder implements Bun.PluginBuilder {
  #onLoad: Bun.OnLoadCallback | undefined;

  public readonly config: Bun.PluginBuilder["config"];

  public constructor(config: Bun.BuildConfig) {
    const plugins = config.plugins;
    if (plugins === undefined) throw new Error("Expected instrumenting build plugin configuration.");
    this.config = { ...config, plugins: [...plugins] };
  }

  public async load(path: string): Promise<Bun.OnLoadResult | undefined> {
    if (this.#onLoad === undefined) throw new Error("Expected build plugin to register an onLoad callback.");
    return this.#onLoad({
      defer: () => Promise.resolve(),
      loader: "ts",
      namespace: "file",
      path,
    });
  }

  public module(_specifier: string, _callback: () => Bun.OnLoadResult | Promise<Bun.OnLoadResult>): this {
    return this;
  }

  public onBeforeParse(_constraints: Bun.PluginConstraints, _callback: Bun.OnBeforeParseCallback): this {
    return this;
  }

  public onEnd(_callback: Bun.OnEndCallback): this {
    return this;
  }

  public onLoad(_constraints: Bun.PluginConstraints, callback: Bun.OnLoadCallback): this {
    this.#onLoad = callback;
    return this;
  }

  public onResolve(_constraints: Bun.PluginConstraints, _callback: Bun.OnResolveCallback): this {
    return this;
  }

  public onStart(_callback: Bun.OnStartCallback): this {
    return this;
  }
}

export function successfulBuild(
  artifactRun: ReturnType<typeof createArtifactRun>,
  manifest: LoggingEndToEndScopeManifest,
  loadedPaths: readonly string[] = absoluteRuntimeFiles(manifest),
  observeBuilder?: (builder: TestPluginBuilder) => Promise<void>,
) {
  return async (config: Bun.BuildConfig) => {
    const firstPlugin = config.plugins?.[0];
    if (firstPlugin === undefined) throw new Error("Expected instrumenting build plugin.");
    const builder = new TestPluginBuilder(config);
    await firstPlugin.setup(builder);
    for (const path of loadedPaths) await builder.load(path);
    if (observeBuilder !== undefined) await observeBuilder(builder);
    const expectedNames = requiredOutputNames(manifest);
    writeBundleFiles(artifactRun.paths.bundle, expectedNames);
    return { logs: [], outputs: outputRecords(artifactRun.paths.bundle, expectedNames), success: true };
  };
}
