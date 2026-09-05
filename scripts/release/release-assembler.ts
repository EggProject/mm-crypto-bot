import path from "node:path";

import {
  canonicalJson,
  formatSha256Sidecar,
  releaseApplications as releaseApps,
  releaseTarget,
  releaseVersion,
  requiredBunVersion,
  requiredNodeMetadataVersion,
  sha256Hex,
  type ReleaseApplication as ReleaseApp,
  type ReleaseAssemblyResult,
  type ReleaseManifestV1,
  type ReleasePayload,
} from "./release-contract";
import type { ReleaseBuildIdentity, ReleaseDependencies, ReleasePrivateDirectory } from "./release-ports";
import { normalizedDosTimestamp } from "./zip-store";
import { encodeStoreZip } from "./zip-store-encoder";

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
const lowercaseCommit = /^[0-9a-f]{40}$/u;
const integerEpoch = /^(?:0|[1-9][0-9]*)$/u;

interface AppPaths {
  readonly entryPoint: string;
  readonly executableName: `mm-crypto-bot-${ReleaseApp}`;
  readonly packageJson: string;
}

export async function assertReleasePreconditions(
  dependencies: ReleaseDependencies,
): Promise<ReleaseBuildIdentity> {
  const status = await dependencies.git.porcelainStatus();
  if (status !== "") {
    throw new Error("release assembly requires a clean Git worktree");
  }

  const [commit, rawEpoch, bunVersion, nodeVersion] = await Promise.all([
    dependencies.git.headCommit(),
    dependencies.git.headCommitEpoch(),
    dependencies.toolchain.bunVersion(),
    dependencies.toolchain.nodeVersion(),
  ]);
  if (!lowercaseCommit.test(commit)) {
    throw new Error("release assembly requires a full lowercase Git commit");
  }
  if (bunVersion !== requiredBunVersion) {
    throw new Error(`release assembly requires Bun ${requiredBunVersion}`);
  }
  if (nodeVersion !== requiredNodeMetadataVersion) {
    throw new Error(`release assembly requires Node metadata ${requiredNodeMetadataVersion}`);
  }
  const sourceDateEpoch = parseCommitEpoch(rawEpoch);
  void normalizedDosTimestamp(sourceDateEpoch);

  await assertRootToolchainPins(dependencies);
  const lockfilePath = path.join(dependencies.repositoryRoot, "bun.lock");
  await assertRegularFile(dependencies, lockfilePath, "bun.lock");
  const lockfileSha256 = sha256Hex(await dependencies.fileSystem.readFile(lockfilePath));
  return Object.freeze({ commit, lockfileSha256, sourceDateEpoch });
}

export async function assembleRelease(
  dependencies: ReleaseDependencies,
  app: ReleaseApp,
): Promise<ReleaseAssemblyResult> {
  const identity = await assertReleasePreconditions(dependencies);
  await assertAppPreconditions(dependencies, app);
  return assembleValidatedRelease(dependencies, app, identity);
}

export async function assembleAllReleases(
  dependencies: ReleaseDependencies,
): Promise<readonly ReleaseAssemblyResult[]> {
  const identity = await assertReleasePreconditions(dependencies);
  for (const app of releaseApps) {
    await assertAppPreconditions(dependencies, app);
  }
  const results: ReleaseAssemblyResult[] = [];
  for (const app of releaseApps) {
    results.push(await assembleValidatedRelease(dependencies, app, identity));
  }
  return Object.freeze(results);
}

async function assembleValidatedRelease(
  dependencies: ReleaseDependencies,
  app: ReleaseApp,
  identity: ReleaseBuildIdentity,
): Promise<ReleaseAssemblyResult> {
  const paths = appPaths(dependencies.repositoryRoot, app);
  const candidateDirectory = await dependencies.fileSystem.mkdtemp({
    parentDirectory: dependencies.temporaryRoot,
    prefix: `mm-crypto-bot-${app}-candidate-`,
  });
  assertWithin(dependencies.temporaryRoot, candidateDirectory.path, "release candidate directory");
  const executablePath = path.join(candidateDirectory.path, paths.executableName);
  assertWithin(candidateDirectory.path, executablePath, "private compiler output");
  await dependencies.compiler.compile({
    entryPoint: paths.entryPoint,
    outputPath: executablePath,
    target: releaseTarget,
  });
  await assertCompilerOutput(dependencies, executablePath);
  await dependencies.fileSystem.chmod(executablePath, 0o755);
  const executableBytes = await dependencies.fileSystem.readFile(executablePath);

  const readmeBytes = encoder.encode(readme(app, paths.executableName));
  const manifest = manifestFor(app, identity, readmeBytes, executableBytes);
  const manifestBytes = encoder.encode(canonicalJson(manifest));
  const zipBytes = encodeStoreZip(
    [
      { bytes: readmeBytes, mode: 0o644, path: "README.md" },
      { bytes: executableBytes, mode: 0o755, path: `bin/${paths.executableName}` },
      { bytes: manifestBytes, mode: 0o644, path: "manifest.json" },
    ],
    identity.sourceDateEpoch,
  );
  const candidate = await writePrivateCandidate(dependencies, candidateDirectory, app, zipBytes);
  await dependencies.fileSystem.removeFile(executablePath);
  if ((await dependencies.fileSystem.inspectPath(executablePath)) !== "missing") {
    throw new Error("compiled executable remains in the private candidate");
  }
  return Object.freeze({ candidate, manifest });
}

async function assertAppPreconditions(dependencies: ReleaseDependencies, app: ReleaseApp): Promise<void> {
  const paths = appPaths(dependencies.repositoryRoot, app);
  await assertRegularFile(dependencies, paths.packageJson, `${app} package.json`);
  await assertRegularFile(dependencies, paths.entryPoint, `${app} entry point`);
  const packageVersion = versionFromPackageJson(await dependencies.fileSystem.readFile(paths.packageJson));
  if (packageVersion !== releaseVersion) {
    throw new Error(`${app} package version must be ${releaseVersion}`);
  }
}

async function assertRegularFile(
  dependencies: ReleaseDependencies,
  path: string,
  label: string,
): Promise<void> {
  const status = await dependencies.fileSystem.lstat(path);
  if (status.isSymbolicLink() || !status.isRegularFile()) {
    throw new Error(`${label} must be a regular non-symlink file`);
  }
}

async function assertCompilerOutput(
  dependencies: ReleaseDependencies,
  executablePath: string,
): Promise<void> {
  const kind = await dependencies.fileSystem.inspectPath(executablePath);
  if (kind !== "regular-file") {
    throw new Error(`compiled executable must be a regular file, received ${kind}`);
  }
}

async function assertRootToolchainPins(dependencies: ReleaseDependencies): Promise<void> {
  const packageJsonPath = path.join(dependencies.repositoryRoot, "package.json");
  const bunVersionPath = path.join(dependencies.repositoryRoot, ".bun-version");
  const nvmrcPath = path.join(dependencies.repositoryRoot, ".nvmrc");
  await assertRegularFile(dependencies, packageJsonPath, "root package.json");
  await assertRegularFile(dependencies, bunVersionPath, ".bun-version");
  await assertRegularFile(dependencies, nvmrcPath, ".nvmrc");
  assertRootPackagePins(await dependencies.fileSystem.readFile(packageJsonPath));
  assertExactFileText(
    await dependencies.fileSystem.readFile(bunVersionPath),
    `${requiredBunVersion}\n`,
    ".bun-version",
  );
  assertExactFileText(
    await dependencies.fileSystem.readFile(nvmrcPath),
    `${requiredNodeMetadataVersion}\n`,
    ".nvmrc",
  );
}

function appPaths(repoRoot: string, app: ReleaseApp): AppPaths {
  const appRoot = path.join(repoRoot, "apps", app);
  return Object.freeze({
    entryPoint: path.join(appRoot, "src", "index.ts"),
    executableName: `mm-crypto-bot-${app}`,
    packageJson: path.join(appRoot, "package.json"),
  });
}

function assertRootPackagePins(bytes: Uint8Array): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(decoder.decode(bytes));
  } catch {
    throw new Error("root package.json must contain valid JSON");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("root package.json must be an object");
  }
  if (propertyString(parsed, "packageManager") !== `bun@${requiredBunVersion}`) {
    throw new Error("root package.json packageManager must pin Bun 1.3.14");
  }
  const engines = propertyValue(parsed, "engines");
  if (typeof engines !== "object" || engines === null || Array.isArray(engines)) {
    throw new Error("root package.json engines must be an object");
  }
  if (propertyString(engines, "bun") !== requiredBunVersion) {
    throw new Error("root package.json engines.bun must pin Bun 1.3.14");
  }
  if (propertyString(engines, "node") !== requiredNodeMetadataVersion) {
    throw new Error("root package.json engines.node must pin Node metadata 24.19.0");
  }
}

function assertExactFileText(bytes: Uint8Array, expected: string, label: string): void {
  let value: string;
  try {
    value = decoder.decode(bytes);
  } catch {
    throw new Error(`${label} must exactly pin the required toolchain version`);
  }
  if (value !== expected) {
    throw new Error(`${label} must exactly pin the required toolchain version`);
  }
}

function propertyValue(record: object, key: string): unknown {
  return Object.getOwnPropertyDescriptor(record, key)?.value;
}

function propertyString(record: object, key: string): string | undefined {
  const value = propertyValue(record, key);
  return typeof value === "string" ? value : undefined;
}

function parseCommitEpoch(value: string): number {
  if (!integerEpoch.test(value)) {
    throw new TypeError("Git commit epoch must be an exact integer");
  }
  const epoch = Number(value);
  if (!Number.isSafeInteger(epoch)) {
    throw new TypeError("Git commit epoch must be an exact integer");
  }
  return epoch;
}

function versionFromPackageJson(bytes: Uint8Array): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(decoder.decode(bytes));
  } catch {
    throw new Error("application package.json must contain valid JSON");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("application package.json must be an object");
  }
  const descriptor = Object.getOwnPropertyDescriptor(parsed, "version");
  if (typeof descriptor?.value !== "string") {
    throw new TypeError("application package.json must have a string version");
  }
  return descriptor.value;
}

function manifestFor(
  app: ReleaseApp,
  identity: ReleaseBuildIdentity,
  readmeBytes: Uint8Array,
  executableBytes: Uint8Array,
): ReleaseManifestV1 {
  const payloads: readonly ReleasePayload[] = [
    Object.freeze({
      bytes: readmeBytes.length,
      mode: "0644",
      path: "README.md",
      sha256: sha256Hex(readmeBytes),
    }),
    Object.freeze({
      bytes: executableBytes.length,
      mode: "0755",
      path: binaryPayloadPath(app),
      sha256: sha256Hex(executableBytes),
    }),
  ];
  return Object.freeze({
    app,
    commit: identity.commit,
    configuration: Object.freeze({
      embedded: false,
      external: true,
      runtimeRootEnvironment: "MM_CRYPTO_BOT_RUNTIME_ROOT",
    }),
    lockfileSha256: identity.lockfileSha256,
    payloads: Object.freeze(payloads),
    schema: "mm-crypto-bot.release-manifest/v1",
    sourceDateEpoch: identity.sourceDateEpoch,
    target: Object.freeze({ arch: "x64", bunTarget: releaseTarget, os: "linux" }),
    toolchain: Object.freeze({ bun: requiredBunVersion, nodeMetadata: requiredNodeMetadataVersion }),
    version: releaseVersion,
  });
}

function binaryPayloadPath(app: ReleaseApp): ReleasePayload["path"] {
  return app === "bot" ? "bin/mm-crypto-bot-bot" : "bin/mm-crypto-bot-config-search";
}

async function writePrivateCandidate(
  dependencies: ReleaseDependencies,
  candidateDirectory: ReleasePrivateDirectory,
  app: ReleaseApp,
  zipBytes: Uint8Array,
): Promise<ReleaseAssemblyResult["candidate"]> {
  const zipBasename = `mm-crypto-bot-${app}-${releaseVersion}-${releaseTarget}.zip`;
  const zipPath = path.join(candidateDirectory.path, zipBasename);
  const sidecarPath = `${zipPath}.sha256`;
  assertWithin(candidateDirectory.path, zipPath, "candidate ZIP artifact");
  assertWithin(candidateDirectory.path, sidecarPath, "candidate sidecar artifact");
  const sidecarBytes = encoder.encode(formatSha256Sidecar(sha256Hex(zipBytes), zipBasename));
  await dependencies.fileSystem.writeFile(sidecarPath, sidecarBytes, 0o644);
  await dependencies.fileSystem.writeFile(zipPath, zipBytes, 0o644);
  return Object.freeze({ directory: candidateDirectory.path, sidecarPath, zipPath });
}

function readme(app: ReleaseApp, executableName: string): string {
  return [
    `# mm-crypto-bot ${app}`,
    "",
    `Version: ${releaseVersion}`,
    `Target: ${releaseTarget}`,
    `Executable: bin/${executableName}`,
    "",
    "All runtime configuration, secrets, state, and data are external through MM_CRYPTO_BOT_RUNTIME_ROOT.",
    "",
  ].join("\n");
}

function assertWithin(root: string, candidate: string, label: string): void {
  const relativePath = path.relative(path.resolve(root), path.resolve(candidate));
  if (
    relativePath === "" ||
    relativePath === ".." ||
    relativePath.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativePath)
  ) {
    throw new Error(`${label} escapes its allowed root`);
  }
}
