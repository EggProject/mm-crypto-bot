import { createHash } from "node:crypto";

// eslint-disable-next-line unicorn/name-replacements -- public release contract name is specified by the approved design.
export const releaseApplications = ["bot", "config-search"] as const;
export const releaseTarget = "bun-linux-x64" as const;
export const legacyRequiredBunVersion = "1.3.14" as const;
export const legacyRequiredNodeMetadataVersion = "24.19.0" as const;
export const requiredBunVersion = "1.4.2" as const;
export const requiredNodeMetadataVersion = "24.21.0" as const;
export const releaseVersion = "0.1.0" as const;

// eslint-disable-next-line unicorn/name-replacements -- public release contract name is specified by the approved design.
export type ReleaseApplication = (typeof releaseApplications)[number];
export type ReleaseTarget = typeof releaseTarget;

export interface ReleasePayload {
  readonly bytes: number;
  readonly mode: "0644" | "0755";
  readonly path: "README.md" | `bin/mm-crypto-bot-${ReleaseApplication}`;
  readonly sha256: string;
}

export interface ReleaseManifestBase {
  readonly app: ReleaseApplication;
  readonly commit: string;
  readonly configuration: {
    readonly embedded: false;
    readonly external: true;
    readonly runtimeRootEnvironment: "MM_CRYPTO_BOT_RUNTIME_ROOT";
  };
  readonly lockfileSha256: string;
  readonly payloads: readonly ReleasePayload[];
  readonly sourceDateEpoch: number;
  readonly target: {
    readonly arch: "x64";
    readonly bunTarget: ReleaseTarget;
    readonly os: "linux";
  };
  readonly version: typeof releaseVersion;
}

export interface ReleaseManifestV1 extends ReleaseManifestBase {
  readonly schema: "mm-crypto-bot.release-manifest/v1";
  readonly toolchain: {
    readonly bun: typeof legacyRequiredBunVersion;
    readonly nodeMetadata: typeof legacyRequiredNodeMetadataVersion;
  };
}

export interface ReleaseManifestV2 extends ReleaseManifestBase {
  readonly schema: "mm-crypto-bot.release-manifest/v2";
  readonly toolchain: {
    readonly bun: typeof requiredBunVersion;
    readonly nodeMetadata: typeof requiredNodeMetadataVersion;
  };
}

export type ReleaseManifest = ReleaseManifestV1 | ReleaseManifestV2;

export interface ReleasePayloadInput {
  readonly bytes: Uint8Array;
  readonly mode: 0o644 | 0o755;
  readonly path: string;
}

export interface ReleasePrivateCandidate {
  readonly directory: string;
  readonly sidecarPath: string;
  readonly zipPath: string;
}

export interface ReleaseAssemblyResult {
  readonly candidate: ReleasePrivateCandidate;
  readonly manifest: ReleaseManifestV2;
}

export interface ReleaseVerificationInput {
  readonly sidecarBytes: Uint8Array;
  readonly zipBasename: string;
  readonly zipBytes: Uint8Array;
}

export interface ExtractedRelease {
  readonly executablePath: string;
  readonly manifest: ReleaseManifest;
  readonly rootDirectory: string;
}

export interface ConfigSearchOutput {
  readonly writeStderr: (text: string) => void;
  readonly writeStdout: (text: string) => void;
}

interface ParsedSha256Sidecar {
  readonly sha256: string;
  readonly zipBasename: string;
}

type CanonicalJson = boolean | null | number | string | readonly CanonicalJson[] | CanonicalJsonRecord;

interface CanonicalJsonRecord {
  readonly [key: string]: CanonicalJson;
}

const lowercaseSha256 = /^[0-9a-f]{64}$/u;

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function canonicalJson(value: unknown): string {
  return `${JSON.stringify(sortJson(value), undefined, 2)}\n`;
}

export function formatSha256Sidecar(sha256: string, zipBasename: string): string {
  if (!lowercaseSha256.test(sha256) || !isZipBasename(zipBasename)) {
    throw new Error("invalid SHA-256 sidecar");
  }
  return `${sha256}  ${zipBasename}\n`;
}

export function parseSha256Sidecar(bytes: Uint8Array): ParsedSha256Sidecar {
  const decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  const sha256 = decoded.slice(0, 64);
  const zipBasename = decoded.slice(66, -1);
  if (
    decoded.length !== 67 + zipBasename.length ||
    decoded.slice(64, 66) !== "  " ||
    !decoded.endsWith("\n") ||
    !lowercaseSha256.test(sha256) ||
    !isZipBasename(zipBasename)
  ) {
    throw new Error("invalid SHA-256 sidecar");
  }
  return Object.freeze({ sha256, zipBasename });
}

function isZipBasename(value: string): boolean {
  if (value.length <= 4 || !value.endsWith(".zip")) {
    return false;
  }
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (
      codePoint === undefined ||
      codePoint === 0x2f ||
      codePoint === 0x5c ||
      codePoint < 0x20 ||
      codePoint > 0x7e
    ) {
      return false;
    }
  }
  return true;
}

function sortJson(value: unknown): CanonicalJson {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("canonical JSON requires finite numbers");
    }
    if (!Number.isSafeInteger(value)) {
      throw new TypeError("canonical JSON requires integer numbers");
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => sortJson(item));
  }
  if (!isPlainRecord(value)) {
    throw new Error("canonical JSON requires a plain record");
  }
  return Object.fromEntries(
    Object.keys(value)
      // eslint-disable-next-line unicorn/require-array-sort-compare -- default sort is the required UTF-16 code-unit ordering.
      .toSorted()
      // eslint-disable-next-line security/detect-object-injection -- keys originate from a validated plain record.
      .map((key) => [key, sortJson(value[key])]),
  );
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
