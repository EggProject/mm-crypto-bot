import path from "node:path";

import {
  canonicalJson,
  sha256Hex,
  type ReleaseApplication as ReleaseApp,
  type ReleaseManifestV2,
} from "./release-contract";
import {
  releaseSetArchiveBasename,
  releaseSetCandidatePrefix,
  type ReleaseSetInput,
  type ReleaseSetPrivateCandidate,
} from "./release-set-contract";
import type { ReleaseDependencies } from "./release-ports";
import { verifyReleaseArchive } from "./release-verifier";
import { encodeReleaseSetZip } from "./release-set-zip";

const releaseSetInputKeys = new Set(["application", "innerManifest", "sidecarBytes", "zipBytes"]);

interface ReleaseSetInputSnapshot {
  readonly application: ReleaseApp;
  readonly suppliedManifestJson: string;
  readonly sidecarBytes: Uint8Array;
  readonly sourceSidecarBytes: Uint8Array;
  readonly sourceZipBytes: Uint8Array;
  readonly zipBytes: Uint8Array;
}

export async function assembleReleaseSetCandidate(
  dependencies: ReleaseDependencies,
  inputs: readonly ReleaseSetInput[],
): Promise<ReleaseSetPrivateCandidate> {
  const snapshots = inputs.map((input) => snapshotReleaseSetInput(input));
  const verifiedInputs = await Promise.all(
    snapshots.map(async (snapshot) => {
      const manifest = await verifyReleaseArchive({
        sidecarBytes: snapshot.sidecarBytes,
        zipBasename: `mm-crypto-bot-${snapshot.application}-0.1.0-bun-linux-x64.zip`,
        zipBytes: snapshot.zipBytes,
      });
      if (manifest.schema !== "mm-crypto-bot.release-manifest/v2")
        throw new Error("release-set authenticated manifest mismatch");
      return Object.freeze({
        manifest,
        snapshot,
      });
    }),
  );
  const authenticatedInputs = verifiedInputs.map(({ manifest, snapshot }) => {
    assertSourceBytesUnchanged(snapshot);
    return withAuthenticatedManifest(snapshot, manifest);
  });
  const archive = encodeReleaseSetZip(authenticatedInputs);
  const directory = await dependencies.fileSystem.mkdtemp({
    parentDirectory: dependencies.temporaryRoot,
    prefix: releaseSetCandidatePrefix,
  });
  if (!isExpectedDirectory(dependencies.temporaryRoot, directory.path))
    throw new Error("release-set candidate directory escapes private root");
  const archivePath = path.join(directory.path, releaseSetArchiveBasename);
  try {
    await dependencies.fileSystem.writeFile(archivePath, archive.zipBytes, 0o644);
    return Object.freeze({
      archivePath,
      basename: releaseSetArchiveBasename,
      directory,
      manifest: archive.manifest,
    });
  } catch (error: unknown) {
    try {
      await dependencies.fileSystem.removePrivateDirectory(directory);
    } catch {
      throw new Error("release-set private candidate cleanup failed");
    }
    throw error;
  }
}

function snapshotReleaseSetInput(value: unknown): ReleaseSetInputSnapshot {
  try {
    if (!hasExactOwnDataKeys(value)) throw new TypeError("invalid release-set input");
    const app = readOwnDataProperty(value, "application");
    const suppliedManifest = readOwnDataProperty(value, "innerManifest");
    const sourceSidecarBytes = readOwnDataProperty(value, "sidecarBytes");
    const sourceZipBytes = readOwnDataProperty(value, "zipBytes");
    if (
      (app !== "bot" && app !== "config-search") ||
      !(sourceSidecarBytes instanceof Uint8Array) ||
      !(sourceZipBytes instanceof Uint8Array)
    ) {
      throw new TypeError("invalid release-set input");
    }
    const sidecarBytes = new Uint8Array(sourceSidecarBytes);
    const zipBytes = new Uint8Array(sourceZipBytes);
    const suppliedManifestJson = canonicalJson(structuredClone(suppliedManifest));
    return Object.freeze({
      application: app,
      sidecarBytes,
      sourceSidecarBytes,
      sourceZipBytes,
      suppliedManifestJson,
      zipBytes,
    });
  } catch {
    throw new TypeError("invalid release-set input");
  }
}

function hasExactOwnDataKeys(value: unknown): value is object {
  if (typeof value !== "object" || value === null || Object.getPrototypeOf(value) !== Object.prototype)
    return false;
  const keys = Reflect.ownKeys(value);
  return (
    keys.length === releaseSetInputKeys.size &&
    keys.every((key) => typeof key === "string" && releaseSetInputKeys.has(key))
  );
}

function readOwnDataProperty(value: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (descriptor === undefined || !("value" in descriptor)) throw new TypeError("invalid release-set input");
  return descriptor.value;
}

function assertSourceBytesUnchanged(snapshot: ReleaseSetInputSnapshot): void {
  if (
    sha256Hex(snapshot.sourceSidecarBytes) !== sha256Hex(snapshot.sidecarBytes) ||
    sha256Hex(snapshot.sourceZipBytes) !== sha256Hex(snapshot.zipBytes)
  ) {
    throw new TypeError("invalid release-set input");
  }
}

function withAuthenticatedManifest(
  snapshot: ReleaseSetInputSnapshot,
  manifest: ReleaseManifestV2,
): ReleaseSetInput {
  if (snapshot.suppliedManifestJson !== canonicalJson(manifest)) {
    throw new Error("release-set authenticated manifest mismatch");
  }
  return Object.freeze({
    application: snapshot.application,
    innerManifest: manifest,
    sidecarBytes: snapshot.sidecarBytes,
    zipBytes: snapshot.zipBytes,
  });
}

function isExpectedDirectory(root: string, directory: string): boolean {
  const base = path.basename(directory);
  return (
    path.dirname(directory) === root &&
    base.startsWith(releaseSetCandidatePrefix) &&
    base.length > releaseSetCandidatePrefix.length
  );
}
