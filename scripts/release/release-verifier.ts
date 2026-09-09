import {
  canonicalJson,
  parseSha256Sidecar,
  releaseVersion,
  requiredBunVersion,
  requiredNodeMetadataVersion,
  sha256Hex,
  type ReleaseApplication as ReleaseApp,
  type ReleaseManifestV1,
  type ReleasePayload,
  type ReleaseVerificationInput,
} from "./release-contract";
import { normalizedDosTimestamp, parseStoreZip, type ParsedStoreZipEntry } from "./zip-store";

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
const commitPattern = /^[0-9a-f]{40}$/u;
const sha256Pattern = /^[0-9a-f]{64}$/u;
const inputKeys = ["sidecarBytes", "zipBasename", "zipBytes"];
const manifestKeys = [
  "app",
  "commit",
  "configuration",
  "lockfileSha256",
  "payloads",
  "schema",
  "sourceDateEpoch",
  "target",
  "toolchain",
  "version",
];
const payloadKeys = ["bytes", "mode", "path", "sha256"];
const targetKeys = ["arch", "bunTarget", "os"];
const toolchainKeys = ["bun", "nodeMetadata"];
const configKeys = ["embedded", "external", "runtimeRootEnvironment"];

export function verifyReleaseArchive(input: ReleaseVerificationInput): Promise<ReleaseManifestV1> {
  return Promise.try(() => {
    const safeInput = readInput(input);
    verifySidecar(safeInput);
    const archive = parseArchive(safeInput.zipBytes);
    const manifest = readManifest(archive.manifest.bytes, archive.timestamp);
    verifyArchiveLayout(archive.entries, manifest, safeInput.zipBasename);
    verifyPayloads(manifest, archive.entries);
    return freezeManifest(manifest);
  });
}

interface SafeInput {
  readonly sidecarBytes: Uint8Array;
  readonly zipBasename: string;
  readonly zipBytes: Uint8Array;
}

interface ParsedArchive {
  readonly entries: readonly ParsedStoreZipEntry[];
  readonly manifest: ParsedStoreZipEntry;
  readonly timestamp: { readonly date: number; readonly time: number };
}

function readInput(value: unknown): SafeInput {
  try {
    if (!hasExactDataProperties(value, inputKeys)) throw invalid("input");
    const copiedValue = structuredClone(value);
    const sidecarBytes = copiedValue["sidecarBytes"];
    const zipBasename = copiedValue["zipBasename"];
    const zipBytes = copiedValue["zipBytes"];
    if (
      typeof zipBasename !== "string" ||
      !(sidecarBytes instanceof Uint8Array) ||
      !(zipBytes instanceof Uint8Array)
    ) {
      throw invalid("input");
    }
    return Object.freeze({
      sidecarBytes: new Uint8Array(sidecarBytes),
      zipBasename,
      zipBytes: new Uint8Array(zipBytes),
    });
  } catch {
    throw invalid("input");
  }
}

function verifySidecar(input: SafeInput): void {
  try {
    const sidecar = parseSha256Sidecar(input.sidecarBytes);
    if (sidecar.zipBasename !== input.zipBasename || sidecar.sha256 !== sha256Hex(input.zipBytes)) {
      throw new Error("mismatch");
    }
  } catch {
    throw invalid("sidecar");
  }
}

function parseArchive(zipBytes: Uint8Array): ParsedArchive {
  try {
    const parsed = parseStoreZip(zipBytes);
    const manifest = parsed.entries.find((entry) => entry.path === "manifest.json");
    if (
      manifest === undefined ||
      parsed.entries.length !== 3 ||
      parsed.entries[0]?.path !== "README.md" ||
      (parsed.entries[1]?.path !== "bin/mm-crypto-bot-bot" &&
        parsed.entries[1]?.path !== "bin/mm-crypto-bot-config-search") ||
      parsed.entries[2]?.path !== "manifest.json"
    ) {
      throw new Error("invalid layout");
    }
    return Object.freeze({
      entries: parsed.entries,
      manifest,
      timestamp: parsed.localAndCentralDosTimestamps.central,
    });
  } catch {
    throw invalid("archive");
  }
}

function readManifest(
  manifestBytes: Uint8Array,
  timestamp: { readonly date: number; readonly time: number },
): ReleaseManifestV1 {
  let parsed: unknown;
  try {
    const text = decoder.decode(manifestBytes);
    parsed = JSON.parse(text);
    const canonicalBytes = encoder.encode(canonicalJson(parsed));
    if (!areSameBytes(canonicalBytes, manifestBytes)) {
      throw new Error("noncanonical");
    }
  } catch {
    throw invalid("manifest");
  }
  const manifest = validateManifest(parsed);
  verifyTimestamp(manifest.sourceDateEpoch, timestamp);
  return manifest;
}

function validateManifest(value: unknown): ReleaseManifestV1 {
  if (!hasExactDataProperties(value, manifestKeys)) throw invalid("manifest");
  const app = value["app"];
  const commit = value["commit"];
  const lockfileSha256 = value["lockfileSha256"];
  const sourceDateEpoch = value["sourceDateEpoch"];
  if (
    typeof sourceDateEpoch !== "number" ||
    typeof commit !== "string" ||
    typeof lockfileSha256 !== "string"
  ) {
    throw invalid("manifest");
  }
  if (
    (app !== "bot" && app !== "config-search") ||
    value["schema"] !== "mm-crypto-bot.release-manifest/v1" ||
    value["version"] !== releaseVersion ||
    !commitPattern.test(commit) ||
    !sha256Pattern.test(lockfileSha256) ||
    !Number.isSafeInteger(sourceDateEpoch)
  ) {
    throw invalid("manifest");
  }
  const target = value["target"];
  const toolchain = value["toolchain"];
  if (!hasExactDataProperties(target, targetKeys) || !hasExactDataProperties(toolchain, toolchainKeys)) {
    throw invalid("manifest");
  }
  const config = value["configuration"];
  if (!hasExactDataProperties(config, configKeys)) {
    throw invalid("manifest");
  }
  const payloadValues = value["payloads"];
  if (!Array.isArray(payloadValues)) throw invalid("manifest");
  if (
    target["arch"] !== "x64" ||
    target["bunTarget"] !== "bun-linux-x64" ||
    target["os"] !== "linux" ||
    toolchain["bun"] !== requiredBunVersion ||
    toolchain["nodeMetadata"] !== requiredNodeMetadataVersion ||
    config["embedded"] !== false ||
    config["external"] !== true ||
    config["runtimeRootEnvironment"] !== "MM_CRYPTO_BOT_RUNTIME_ROOT"
  ) {
    throw invalid("manifest");
  }
  const payloads = payloadValues.map((payload) => validatePayload(payload, app));
  return Object.freeze({
    app,
    commit,
    configuration: Object.freeze({
      embedded: false,
      external: true,
      runtimeRootEnvironment: "MM_CRYPTO_BOT_RUNTIME_ROOT",
    }),
    lockfileSha256,
    payloads: Object.freeze(payloads),
    schema: "mm-crypto-bot.release-manifest/v1",
    sourceDateEpoch,
    target: Object.freeze({ arch: "x64", bunTarget: "bun-linux-x64", os: "linux" }),
    toolchain: Object.freeze({ bun: requiredBunVersion, nodeMetadata: requiredNodeMetadataVersion }),
    version: releaseVersion,
  });
}

function validatePayload(value: unknown, app: ReleaseApp): ReleasePayload {
  if (!hasExactDataProperties(value, payloadKeys)) throw invalid("payload");
  const path = value["path"];
  const mode = value["mode"];
  const byteCount = value["bytes"];
  const sha256 = value["sha256"];
  if (typeof byteCount !== "number" || typeof sha256 !== "string") throw invalid("payload");
  const executablePath = app === "bot" ? "bin/mm-crypto-bot-bot" : "bin/mm-crypto-bot-config-search";
  if (
    (path !== "README.md" && path !== executablePath) ||
    (mode !== "0644" && mode !== "0755") ||
    (path === "README.md" && mode !== "0644") ||
    (path === executablePath && mode !== "0755") ||
    !Number.isSafeInteger(byteCount) ||
    byteCount < 0 ||
    !sha256Pattern.test(sha256)
  ) {
    throw invalid("payload");
  }
  if (path === "README.md") return Object.freeze({ bytes: byteCount, mode: "0644", path, sha256 });
  return Object.freeze({ bytes: byteCount, mode: "0755", path: executablePath, sha256 });
}

function verifyTimestamp(epoch: number, timestamp: { readonly date: number; readonly time: number }): void {
  try {
    const expected = normalizedDosTimestamp(epoch);
    if (expected.date !== timestamp.date || expected.time !== timestamp.time) throw new Error("mismatch");
  } catch {
    throw invalid("timestamp");
  }
}

function verifyArchiveLayout(
  entries: readonly ParsedStoreZipEntry[],
  manifest: ReleaseManifestV1,
  zipBasename: string,
): void {
  const executablePath = `bin/mm-crypto-bot-${manifest.app}`;
  const expectedPaths = ["README.md", executablePath, "manifest.json"];
  if (
    entries.length !== expectedPaths.length ||
    entries.some((entry, index) => entry.path !== expectedPaths.at(index))
  ) {
    throw invalid("archive");
  }
  const expectedBasename = `mm-crypto-bot-${manifest.app}-${releaseVersion}-bun-linux-x64.zip`;
  if (expectedBasename !== zipBasename) throw invalid("archive");
}

function verifyPayloads(manifest: ReleaseManifestV1, entries: readonly ParsedStoreZipEntry[]): void {
  const executablePath = `bin/mm-crypto-bot-${manifest.app}`;
  const expected = [
    { mode: "0644", path: "README.md" },
    { mode: "0755", path: executablePath },
  ];
  if (manifest.payloads.length !== expected.length) throw invalid("payload");
  for (const [index, payload] of manifest.payloads.entries()) {
    const expectation = expected.at(index);
    const entry = entries.find((candidate) => candidate.path === payload.path);
    if (
      expectation === undefined ||
      entry === undefined ||
      payload.path !== expectation.path ||
      payload.mode !== expectation.mode ||
      payload.bytes !== entry.bytes.length ||
      payload.sha256 !== sha256Hex(entry.bytes)
    ) {
      throw invalid("payload");
    }
  }
}

function freezeManifest(manifest: ReleaseManifestV1): ReleaseManifestV1 {
  return Object.freeze({
    ...manifest,
    configuration: Object.freeze({ ...manifest.configuration }),
    payloads: Object.freeze(manifest.payloads.map((payload) => Object.freeze({ ...payload }))),
    target: Object.freeze({ ...manifest.target }),
    toolchain: Object.freeze({ ...manifest.toolchain }),
  });
}

function hasExactDataProperties(
  value: unknown,
  expectedKeys: readonly string[],
): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Object.getPrototypeOf(value) !== Object.prototype)
    return false;
  const keys = Reflect.ownKeys(value);
  if (
    keys.length !== expectedKeys.length ||
    keys.some((key) => typeof key !== "string" || !expectedKeys.includes(key))
  ) {
    return false;
  }
  return keys.every((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(key));
    return descriptor !== undefined && "value" in descriptor;
  });
}

function areSameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((byte, index) => byte === right.at(index));
}

function invalid(category: "input" | "sidecar" | "archive" | "manifest" | "payload" | "timestamp"): Error {
  return new Error(`invalid release ${category}`);
}
