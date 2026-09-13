import path from "node:path";

import {
  canonicalJson,
  releaseTarget,
  releaseVersion,
  requiredBunVersion,
  requiredNodeMetadataVersion,
  sha256Hex,
  type ReleaseApplication as ReleaseApp,
  type ReleaseManifestV1,
  type ReleaseManifestV2,
} from "./release-contract";
import type { ReleasePrivateDirectory } from "./release-ports";

export const releaseSetCandidatePrefix = "release-set-candidate-" as const;
export const releaseSetArchiveBasename = "mm-crypto-bot-release-set-0.1.0-bun-linux-x64.zip" as const;
export type ReleaseSetPayload = Readonly<{ bytes: number; sha256: string }>;
export type ReleaseSetArtifactDescriptor = Readonly<ReleaseSetPayload & { path: string }>;
export type ReleaseSetAppRecord<T extends ReleaseApp = ReleaseApp> = Readonly<{
  app: T;
  sidecar: ReleaseSetArtifactDescriptor;
  zip: ReleaseSetArtifactDescriptor;
}>;
export type ReleaseSetManifestV1 = Readonly<{
  applications: readonly [ReleaseSetAppRecord<"bot">, ReleaseSetAppRecord<"config-search">];
  commit: string;
  lockfileSha256: string;
  schema: "mm-crypto-bot.release-set-manifest/v1";
  sourceDateEpoch: number;
  target: ReleaseManifestV1["target"];
  toolchain: ReleaseManifestV1["toolchain"];
  version: "0.1.0";
}>;
export type ReleaseSetManifestV2 = Readonly<{
  applications: readonly [ReleaseSetAppRecord<"bot">, ReleaseSetAppRecord<"config-search">];
  commit: string;
  lockfileSha256: string;
  schema: "mm-crypto-bot.release-set-manifest/v2";
  sourceDateEpoch: number;
  target: ReleaseManifestV2["target"];
  toolchain: ReleaseManifestV2["toolchain"];
  version: "0.1.0";
}>;
export type ReleaseSetManifest = ReleaseSetManifestV1 | ReleaseSetManifestV2;
export type ReleaseSetManifestGeneration = "v1" | "v2";
export { type ReleaseSetAppRecord as ReleaseSetApplicationRecord };
export type ReleaseSetInput = Readonly<{
  application: ReleaseApp;
  innerManifest: ReleaseManifestV2;
  sidecarBytes: Uint8Array;
  zipBytes: Uint8Array;
}>;
export type ReleaseSetArchive = Readonly<{ manifest: ReleaseSetManifestV2; zipBytes: Uint8Array }>;
export type ReleaseSetPrivateCandidate = Readonly<{
  archivePath: string;
  basename: typeof releaseSetArchiveBasename;
  directory: ReleasePrivateDirectory;
  manifest: ReleaseSetManifestV2;
}>;
export type VerifiedReleaseSetArchive = Readonly<{
  manifest: ReleaseSetManifest;
  verified: true;
  zipBytes: Uint8Array;
}>;

export function deriveReleaseSetDestination(publicationRoot: string): string {
  return path.join(publicationRoot, releaseVersion, releaseTarget, releaseSetArchiveBasename);
}

export function createReleaseSetManifest(inputs: readonly ReleaseSetInput[]): ReleaseSetManifestV2 {
  const canonical = canonicalInputs(inputs);
  const first = canonical[0].innerManifest;
  for (const input of canonical) assertCommonIdentity(first, input.innerManifest);
  const records: readonly [ReleaseSetAppRecord<"bot">, ReleaseSetAppRecord<"config-search">] = [
    recordFor(canonical[0], "bot"),
    recordFor(canonical[1], "config-search"),
  ];
  return Object.freeze({
    applications: Object.freeze(records),
    commit: first.commit,
    lockfileSha256: first.lockfileSha256,
    schema: "mm-crypto-bot.release-set-manifest/v2",
    sourceDateEpoch: first.sourceDateEpoch,
    target: Object.freeze({ ...first.target }),
    toolchain: Object.freeze({ ...first.toolchain }),
    version: releaseVersion,
  });
}

export function canonicalReleaseSetManifestBytes(manifest: ReleaseSetManifest): Uint8Array {
  return new TextEncoder().encode(canonicalJson(manifest));
}

export function canonicalReleaseSetInputs(
  inputs: readonly ReleaseSetInput[],
): readonly [ReleaseSetInput, ReleaseSetInput] {
  return canonicalInputs(inputs);
}

function canonicalInputs(inputs: readonly ReleaseSetInput[]): readonly [ReleaseSetInput, ReleaseSetInput] {
  if (inputs.length !== 2) throw new TypeError("release set requires exactly two applications");
  const bot = inputs.find((input) => input.application === "bot");
  const search = inputs.find((input) => input.application === "config-search");
  if (bot === undefined || search === undefined || bot === search)
    throw new Error("invalid release-set applications");
  for (const input of [bot, search]) {
    if (!(input.zipBytes instanceof Uint8Array) || !(input.sidecarBytes instanceof Uint8Array)) {
      throw new TypeError("invalid release-set input bytes");
    }
    if (input.innerManifest.app !== input.application)
      throw new Error("release-set manifest application mismatch");
  }
  return Object.freeze([bot, search]);
}

function recordFor<TApp extends ReleaseApp>(input: ReleaseSetInput, app: TApp): ReleaseSetAppRecord<TApp> {
  const base = `mm-crypto-bot-${app}-${releaseVersion}-${releaseTarget}.zip`;
  return Object.freeze({
    app: app,
    sidecar: Object.freeze({
      bytes: input.sidecarBytes.length,
      path: `apps/${app}/${base}.sha256`,
      sha256: sha256Hex(input.sidecarBytes),
    }),
    zip: Object.freeze({
      bytes: input.zipBytes.length,
      path: `apps/${app}/${base}`,
      sha256: sha256Hex(input.zipBytes),
    }),
  });
}

function assertCommonIdentity(first: ReleaseManifestV2, next: ReleaseManifestV2): void {
  if (
    first.commit !== next.commit ||
    first.lockfileSha256 !== next.lockfileSha256 ||
    first.sourceDateEpoch !== next.sourceDateEpoch ||
    canonicalJson({ target: first.target, toolchain: first.toolchain, version: first.version }) !==
      canonicalJson({ target: next.target, toolchain: next.toolchain, version: next.version }) ||
    canonicalJson({ target: first.target, toolchain: first.toolchain, version: first.version }) !==
      canonicalJson({
        target: { arch: "x64", bunTarget: releaseTarget, os: "linux" },
        toolchain: { bun: requiredBunVersion, nodeMetadata: requiredNodeMetadataVersion },
        version: releaseVersion,
      })
  )
    throw new Error("release-set identity mismatch");
}

export function releaseSetManifestGeneration(
  outerSchema: unknown,
  innerSchema: unknown,
): ReleaseSetManifestGeneration {
  if (
    outerSchema === "mm-crypto-bot.release-set-manifest/v1" &&
    innerSchema === "mm-crypto-bot.release-manifest/v1"
  )
    return "v1";
  if (
    outerSchema === "mm-crypto-bot.release-set-manifest/v2" &&
    innerSchema === "mm-crypto-bot.release-manifest/v2"
  )
    return "v2";
  throw new Error("release-set manifest generation mismatch");
}
