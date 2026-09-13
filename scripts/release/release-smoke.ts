import path from "node:path";

import {
  legacyRequiredBunVersion,
  legacyRequiredNodeMetadataVersion,
  requiredBunVersion,
  requiredNodeMetadataVersion,
  type ExtractedRelease,
  type ReleaseManifest,
  type ReleaseManifestV1,
  type ReleaseManifestV2,
  type ReleasePrivateCandidate,
} from "./release-contract";
import type { ReleaseCommandResult, ReleaseDependencies, ReleasePrivateDirectory } from "./release-ports";
import { verifyReleaseArchive } from "./release-verifier";
import { parseStoreZip } from "./zip-store";

const candidateKeys = ["directory", "sidecarPath", "zipPath"];
const privateDirectoryKeys = ["path"];
const configHelp = "Usage: mm-crypto-bot-config-search [--status | --help]\n";
const configStatus =
  '{"available":false,"code":"CONFIG_SEARCH_UNAVAILABLE","operation":"config-search","reason":"exact-strategy-run-corridor-unavailable","schema":"mm-crypto-bot.config-search.result/v1"}\n';
const botHelp = `mm-crypto-bot command-line interface

Usage: bun run apps/bot/src/index.ts <subcommand> [options]

Subcommands:
  backtest              Run a quick backtest on a deterministic OHLC fixture
  config                Validate / show / init the bot config
  help                  Show this help
  kill-switch-dry-run   Simulate the kill-switch path without sending any orders
  kill-switches         Show kill-switch state
  start                 Start the bot (headless — runs until SIGINT/SIGTERM)
  status                Show the persisted bot state
  strategies            List registered strategies + on/off state
  trades                Show recent closed trades

Run \`bun run apps/bot/src/index.ts <subcommand> --help\` for subcommand-specific options.
`;

interface CandidatePaths {
  readonly directory: string;
  readonly sidecarPath: string;
  readonly zipPath: string;
}

export interface VerifiedPrivateCandidateArchive {
  readonly manifest: ReleaseManifest;
  readonly sidecarBytes: Uint8Array;
  readonly zipBytes: Uint8Array;
}

export async function extractVerifiedRelease(
  dependencies: ReleaseDependencies,
  artifact: ReleasePrivateCandidate,
): Promise<ExtractedRelease> {
  const verified = await readVerifiedPrivateCandidate(dependencies, artifact);
  const entries = parseStoreZip(verified.zipBytes).entries;
  const payloads = extractedPayloadBytes(entries);
  return writeExtraction(
    dependencies,
    verified.manifest,
    payloads.readme,
    payloads.manifest,
    payloads.executable,
  );
}

export async function readVerifiedPrivateCandidate(
  dependencies: ReleaseDependencies,
  artifact: ReleasePrivateCandidate,
): Promise<VerifiedPrivateCandidateArchive> {
  const candidate = validateCandidate(dependencies.temporaryRoot, artifact);
  const { sidecarBytes, zipBytes } = await readCandidateBytes(dependencies, candidate);
  const manifest = await verifyReleaseArchive({
    sidecarBytes,
    zipBasename: path.basename(candidate.zipPath),
    zipBytes,
  });
  return Object.freeze({
    manifest: freezeManifest(manifest),
    sidecarBytes: new Uint8Array(sidecarBytes),
    zipBytes: new Uint8Array(zipBytes),
  });
}

export async function smokeVerifiedRelease(
  dependencies: ReleaseDependencies,
  artifact: ReleasePrivateCandidate,
): Promise<void> {
  let extracted: ExtractedRelease | undefined;
  try {
    extracted = await extractVerifiedRelease(dependencies, artifact);
    await smokeExtractedRelease(dependencies, extracted);
  } finally {
    if (extracted !== undefined) {
      await removeExtraction(dependencies, extracted.rootDirectory);
    }
  }
}

async function readCandidateBytes(
  dependencies: ReleaseDependencies,
  candidate: CandidatePaths,
): Promise<{ readonly sidecarBytes: Uint8Array; readonly zipBytes: Uint8Array }> {
  try {
    await assertRegularFile(dependencies, candidate.zipPath);
    await assertRegularFile(dependencies, candidate.sidecarPath);
    const zipBytes = new Uint8Array(await dependencies.fileSystem.readFile(candidate.zipPath));
    const sidecarBytes = new Uint8Array(await dependencies.fileSystem.readFile(candidate.sidecarPath));
    return Object.freeze({ sidecarBytes, zipBytes });
  } catch {
    throw new Error("invalid release private candidate");
  }
}

async function assertRegularFile(dependencies: ReleaseDependencies, filePath: string): Promise<void> {
  const status = await dependencies.fileSystem.lstat(filePath);
  if (!status.isRegularFile() || status.isSymbolicLink()) {
    throw new Error("candidate file is not regular");
  }
}

function validateCandidate(temporaryRoot: string, value: unknown): CandidatePaths {
  const values = exactDataValues(value, candidateKeys);
  if (values === undefined) {
    throw new Error("invalid release private candidate");
  }
  const [directory, sidecarPath, zipPath] = values;
  if (
    typeof directory !== "string" ||
    typeof zipPath !== "string" ||
    typeof sidecarPath !== "string" ||
    !isImmediateChild(temporaryRoot, directory) ||
    !isImmediateChild(directory, zipPath) ||
    sidecarPath !== `${zipPath}.sha256` ||
    !isImmediateChild(directory, sidecarPath)
  ) {
    throw new Error("invalid release private candidate");
  }
  return Object.freeze({ directory, sidecarPath, zipPath });
}

async function writeExtraction(
  dependencies: ReleaseDependencies,
  manifest: ReleaseManifest,
  readme: Uint8Array,
  manifestBytes: Uint8Array,
  executable: Uint8Array,
): Promise<ExtractedRelease> {
  let directory: ReleasePrivateDirectory | undefined;
  try {
    const rawDirectory = await dependencies.fileSystem.mkdtemp({
      parentDirectory: dependencies.temporaryRoot,
      prefix: "release-extraction-",
    });
    const rootDirectory = validateExtractionDirectory(dependencies.temporaryRoot, rawDirectory);
    directory = Object.freeze({ path: rootDirectory });
    const binaryDirectory = path.join(rootDirectory, "bin");
    const executablePath = path.join(binaryDirectory, `mm-crypto-bot-${manifest.app}`);
    await dependencies.fileSystem.mkdir(binaryDirectory, 0o755);
    await dependencies.fileSystem.writeFile(path.join(rootDirectory, "README.md"), readme, 0o644);
    await dependencies.fileSystem.writeFile(path.join(rootDirectory, "manifest.json"), manifestBytes, 0o644);
    await dependencies.fileSystem.writeFile(executablePath, executable, 0o755);
    return freezeExtractedRelease(executablePath, manifest, rootDirectory);
  } catch {
    if (directory !== undefined) {
      try {
        await dependencies.fileSystem.removePrivateDirectory(directory);
      } catch {
        throw new Error("release extraction cleanup failed");
      }
    }
    throw new Error("release extraction failed");
  }
}

function validateExtractionDirectory(temporaryRoot: string, value: unknown): string {
  const values = exactDataValues(value, privateDirectoryKeys);
  if (values === undefined) {
    throw new Error("invalid extraction directory");
  }
  const [directory] = values;
  const prefix = "release-extraction-";
  const basename = typeof directory === "string" ? path.basename(directory) : "";
  if (
    typeof directory !== "string" ||
    !isImmediateChild(temporaryRoot, directory) ||
    !basename.startsWith(prefix) ||
    basename.length <= prefix.length
  ) {
    throw new Error("invalid extraction directory");
  }
  return directory;
}

async function smokeExtractedRelease(
  dependencies: ReleaseDependencies,
  extracted: ExtractedRelease,
): Promise<void> {
  const common = ["unshare", "--user", "--map-root-user", "--net", extracted.executablePath] as const;
  const environment = Object.freeze({
    HOME: extracted.rootDirectory,
    LANG: "C",
    LC_ALL: "C",
    PATH: "/usr/bin:/bin",
    TZ: "UTC",
  });
  if (extracted.manifest.app === "bot") {
    const result = await runSmokeCommand(
      dependencies,
      [...common, "--help"],
      extracted.rootDirectory,
      environment,
    );
    if (!isBotHelpResult(result)) throw new Error("release smoke failed");
    return;
  }
  const help = await runSmokeCommand(
    dependencies,
    [...common, "--help"],
    extracted.rootDirectory,
    environment,
  );
  if (!isConfigHelpResult(help)) throw new Error("release smoke failed");
  const status = await runSmokeCommand(
    dependencies,
    [...common, "--status"],
    extracted.rootDirectory,
    environment,
  );
  if (!isConfigStatusResult(status)) throw new Error("release smoke failed");
}

async function runSmokeCommand(
  dependencies: ReleaseDependencies,
  argv: readonly string[],
  cwd: string,
  environment: Readonly<Record<string, string>>,
): Promise<ReleaseCommandResult> {
  try {
    const result = await dependencies.process.run({ argv, cwd, env: environment });
    return snapshotCommandResult(result);
  } catch {
    throw new Error("release smoke failed");
  }
}

function isBotHelpResult(result: ReleaseCommandResult): boolean {
  return result.exitCode === 1 && result.stderr === botHelp && result.stdout === "";
}

function isConfigHelpResult(result: ReleaseCommandResult): boolean {
  return result.exitCode === 0 && result.stderr === "" && result.stdout === configHelp;
}

function isConfigStatusResult(result: ReleaseCommandResult): boolean {
  return result.exitCode === 1 && result.stderr === "" && result.stdout === configStatus;
}

function snapshotCommandResult(value: unknown): ReleaseCommandResult {
  const values = exactDataValues(value, ["exitCode", "stderr", "stdout"]);
  if (values === undefined) throw new Error("invalid process result");
  const [exitCode, stderr, stdout] = values;
  if (
    typeof exitCode !== "number" ||
    typeof stderr !== "string" ||
    typeof stdout !== "string" ||
    !Number.isSafeInteger(exitCode)
  ) {
    throw new TypeError("invalid process result");
  }
  return Object.freeze({ exitCode, stderr, stdout });
}

async function removeExtraction(dependencies: ReleaseDependencies, rootDirectory: string): Promise<void> {
  try {
    await dependencies.fileSystem.removePrivateDirectory(Object.freeze({ path: rootDirectory }));
  } catch {
    throw new Error("release smoke cleanup failed");
  }
}

function freezeExtractedRelease(
  executablePath: string,
  manifest: ReleaseManifest,
  rootDirectory: string,
): ExtractedRelease {
  return Object.freeze({
    executablePath,
    manifest: freezeManifest(manifest),
    rootDirectory,
  });
}

function freezeManifest(manifest: ReleaseManifest): ReleaseManifest {
  if (manifest.schema === "mm-crypto-bot.release-manifest/v1") return freezeManifestV1(manifest);
  return freezeManifestV2(manifest);
}

function freezeManifestV1(manifest: ReleaseManifestV1): ReleaseManifestV1 {
  return Object.freeze({
    ...manifest,
    configuration: Object.freeze({ ...manifest.configuration }),
    payloads: freezePayloads(manifest.payloads),
    target: Object.freeze({ ...manifest.target }),
    toolchain: Object.freeze({
      bun: legacyRequiredBunVersion,
      nodeMetadata: legacyRequiredNodeMetadataVersion,
    }),
  });
}

function freezeManifestV2(manifest: ReleaseManifestV2): ReleaseManifestV2 {
  return Object.freeze({
    ...manifest,
    configuration: Object.freeze({ ...manifest.configuration }),
    payloads: freezePayloads(manifest.payloads),
    target: Object.freeze({ ...manifest.target }),
    toolchain: Object.freeze({ bun: requiredBunVersion, nodeMetadata: requiredNodeMetadataVersion }),
  });
}

function freezePayloads(
  payloads: ReleaseManifest["payloads"],
): readonly ReleaseManifest["payloads"][number][] {
  return Object.freeze(payloads.map((payload) => Object.freeze({ ...payload })));
}

function extractedPayloadBytes(entries: ReturnType<typeof parseStoreZip>["entries"]): {
  readonly executable: Uint8Array;
  readonly manifest: Uint8Array;
  readonly readme: Uint8Array;
} {
  let readme = new Uint8Array();
  let executable = new Uint8Array();
  let manifest = new Uint8Array();
  for (const entry of entries) {
    if (entry.path === "README.md") {
      readme = new Uint8Array(entry.bytes);
    } else if (entry.path === "manifest.json") {
      manifest = new Uint8Array(entry.bytes);
    } else {
      executable = new Uint8Array(entry.bytes);
    }
  }
  return Object.freeze({ executable, manifest, readme });
}

function isImmediateChild(parent: string, child: string): boolean {
  return path.dirname(child) === parent && path.basename(child) !== ".";
}

function exactDataValues(value: unknown, keys: readonly string[]): readonly unknown[] | undefined {
  try {
    if (typeof value !== "object" || value === null || Object.getPrototypeOf(value) !== Object.prototype) {
      return undefined;
    }
    const actualKeys = Reflect.ownKeys(value);
    if (
      actualKeys.length !== keys.length ||
      actualKeys.some((key) => typeof key !== "string" || !keys.includes(key))
    ) {
      return undefined;
    }
    const values: unknown[] = [];
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !("value" in descriptor)) return undefined;
      values.push(descriptor.value);
    }
    return Object.freeze(values);
  } catch {
    return undefined;
  }
}
