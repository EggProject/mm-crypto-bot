import { assembleRelease } from "./release-assembler";
import {
  canonicalJson,
  sha256Hex,
  type ReleaseApplication as ReleaseApp,
  type ReleasePrivateCandidate,
} from "./release-contract";
import type { ReleaseDependencies } from "./release-ports";
import {
  readVerifiedPrivateCandidate,
  smokeVerifiedRelease,
  type VerifiedPrivateCandidateArchive,
} from "./release-smoke";

export interface VerifiedPrivateReleaseCandidate {
  readonly manifest: VerifiedPrivateCandidateArchive["manifest"];
  readonly sidecarBytes: Uint8Array;
  readonly zipBytes: Uint8Array;
}

export async function verifyPrivateReleaseCandidate(
  dependencies: ReleaseDependencies,
  artifact: ReleasePrivateCandidate,
): Promise<VerifiedPrivateReleaseCandidate> {
  try {
    const verified = await readVerifiedPrivateCandidate(dependencies, artifact);
    return Object.freeze({
      manifest: verified.manifest,
      sidecarBytes: new Uint8Array(verified.sidecarBytes),
      zipBytes: new Uint8Array(verified.zipBytes),
    });
  } catch {
    throw new Error("release private candidate reproducibility verification failed");
  }
}

export async function assertPrivateCandidateReproducibility(
  dependencies: ReleaseDependencies,
  app_: unknown,
): Promise<void> {
  const app = appValue(app_);
  let candidates: readonly ReleasePrivateCandidate[] = [];
  try {
    const first = await assemblePrivate(dependencies, app);
    candidates = [first];
    const second = await assemblePrivate(dependencies, app);
    candidates = [first, second];
    const firstVerified = await verifyPrivateReleaseCandidate(dependencies, first);
    const secondVerified = await verifyPrivateReleaseCandidate(dependencies, second);
    if (!isSameCandidate(app, firstVerified, secondVerified)) {
      throw new Error("release private candidate reproducibility mismatch");
    }
    await smokePrivate(dependencies, first);
    await smokePrivate(dependencies, second);
  } finally {
    await removeCandidates(dependencies, candidates);
  }
}

export async function assertAllPrivateCandidateReproducibility(
  dependencies: ReleaseDependencies,
): Promise<void> {
  await assertPrivateCandidateReproducibility(dependencies, "bot");
  await assertPrivateCandidateReproducibility(dependencies, "config-search");
}

function appValue(value: unknown): ReleaseApp {
  if (value === "bot" || value === "config-search") return value;
  throw new Error("release private candidate reproducibility assembly failed");
}

async function assemblePrivate(
  dependencies: ReleaseDependencies,
  app: ReleaseApp,
): Promise<ReleasePrivateCandidate> {
  try {
    const result = await assembleRelease(dependencies, app);
    return result.candidate;
  } catch {
    throw new Error("release private candidate reproducibility assembly failed");
  }
}

function isSameCandidate(
  app: ReleaseApp,
  first: VerifiedPrivateReleaseCandidate,
  second: VerifiedPrivateReleaseCandidate,
): boolean {
  return (
    first.manifest.app === app &&
    second.manifest.app === app &&
    areEqualBytes(first.zipBytes, second.zipBytes) &&
    areEqualBytes(first.sidecarBytes, second.sidecarBytes) &&
    sha256Hex(first.zipBytes) === sha256Hex(second.zipBytes) &&
    canonicalJson(first.manifest) === canonicalJson(second.manifest)
  );
}

function areEqualBytes(first: Uint8Array, second: Uint8Array): boolean {
  return first.length === second.length && first.every((byte, index) => byte === second.at(index));
}

async function smokePrivate(
  dependencies: ReleaseDependencies,
  candidate: ReleasePrivateCandidate,
): Promise<void> {
  try {
    await smokeVerifiedRelease(dependencies, candidate);
  } catch {
    throw new Error("release private candidate reproducibility smoke failed");
  }
}

async function removeCandidates(
  dependencies: ReleaseDependencies,
  candidates: readonly ReleasePrivateCandidate[],
): Promise<void> {
  let hasFailure = false;
  for (const candidate of candidates) {
    try {
      await dependencies.fileSystem.removePrivateDirectory(Object.freeze({ path: candidate.directory }));
    } catch {
      hasFailure = true;
    }
  }
  if (hasFailure) throw new Error("release private candidate cleanup failed");
}
