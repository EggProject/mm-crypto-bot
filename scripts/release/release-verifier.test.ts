import { describe, expect, test } from "vitest";

import {
  canonicalJson,
  formatSha256Sidecar,
  sha256Hex,
  type ReleaseApplication as ReleaseApp,
  type ReleaseManifestV1,
} from "./release-contract";
import { verifyReleaseArchive } from "./release-verifier";
import { encodeStoreZip, parseStoreZip } from "./zip-store";

const encoder = new TextEncoder();
const epoch = 1_788_199_915;
const commit = "a".repeat(40);
const lockfileSha256 = "b".repeat(64);

function bytes(text: string): Uint8Array {
  return encoder.encode(text);
}

function fixture(app: ReleaseApp, manifestChange?: (manifest: ReleaseManifestV1) => unknown) {
  const readme = bytes(`README for ${app}\n`);
  const executable = bytes(`executable ${app}\n`);
  const executablePath = `bin/mm-crypto-bot-${app}` as const;
  const manifest: ReleaseManifestV1 = {
    app,
    commit,
    configuration: { embedded: false, external: true, runtimeRootEnvironment: "MM_CRYPTO_BOT_RUNTIME_ROOT" },
    lockfileSha256,
    payloads: [
      { bytes: readme.length, mode: "0644", path: "README.md", sha256: sha256Hex(readme) },
      { bytes: executable.length, mode: "0755", path: executablePath, sha256: sha256Hex(executable) },
    ],
    schema: "mm-crypto-bot.release-manifest/v1",
    sourceDateEpoch: epoch,
    target: { arch: "x64", bunTarget: "bun-linux-x64", os: "linux" },
    toolchain: { bun: "1.3.14", nodeMetadata: "24.19.0" },
    version: "0.1.0",
  };
  const changedManifest = manifestChange?.(manifest) ?? manifest;
  const manifestBytes = bytes(canonicalJson(changedManifest));
  return archive(app, manifestBytes);
}

function archive(app: ReleaseApp, manifestBytes: Uint8Array) {
  const readme = bytes(`README for ${app}\n`);
  const executable = bytes(`executable ${app}\n`);
  const executablePath = `bin/mm-crypto-bot-${app}` as const;
  const zipBytes = encodeStoreZip(
    [
      { bytes: readme, mode: 0o644, path: "README.md" },
      { bytes: executable, mode: 0o755, path: executablePath },
      { bytes: manifestBytes, mode: 0o644, path: "manifest.json" },
    ],
    epoch,
  );
  const zipBasename = `mm-crypto-bot-${app}-0.1.0-bun-linux-x64.zip`;
  return {
    sidecarBytes: bytes(formatSha256Sidecar(sha256Hex(zipBytes), zipBasename)),
    zipBasename,
    zipBytes,
  };
}

function withZip(input: ReturnType<typeof fixture>, zipBytes: Uint8Array) {
  return {
    ...input,
    sidecarBytes: bytes(formatSha256Sidecar(sha256Hex(zipBytes), input.zipBasename)),
    zipBytes,
  };
}

function mutate(bytesValue: Uint8Array, offset: number, value: number): Uint8Array {
  const copy = new Uint8Array(bytesValue);
  copy.set([value], offset);
  return copy;
}

function centralOffset(zipBytes: Uint8Array): number {
  const offset = zipBytes.length - 6;
  return (
    required(zipBytes.at(offset)) |
    (required(zipBytes.at(offset + 1)) << 8) |
    (required(zipBytes.at(offset + 2)) << 16) |
    (required(zipBytes.at(offset + 3)) << 24)
  );
}

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("test fixture is incomplete");
  return value;
}

async function rejects(input: Parameters<typeof verifyReleaseArchive>[0], category: string): Promise<void> {
  try {
    await verifyReleaseArchive(input);
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(Error);
    expect(error).toHaveProperty("message", `invalid release ${category}`);
    return;
  }
  throw new Error("verification unexpectedly succeeded");
}

describe("verifyReleaseArchive", () => {
  test("returns isolated frozen manifests for both supported applications", async () => {
    // Catches returning parsed manifest identity or accepting the wrong application executable.
    for (const app of ["bot", "config-search"] as const) {
      const input = fixture(app);
      const result = await verifyReleaseArchive(input);
      input.zipBytes[0] = required(input.zipBytes[0]) ^ 1;
      expect(result).toMatchObject({ app, sourceDateEpoch: epoch, version: "0.1.0" });
      expect(Object.isFrozen(result)).toBe(true);
      expect(Object.isFrozen(result.configuration)).toBe(true);
      expect(Object.isFrozen(result.payloads)).toBe(true);
      expect(Object.isFrozen(required(result.payloads[0]))).toBe(true);
    }
  });

  test("rejects malformed and mismatched SHA-256 sidecars", async () => {
    // Catches skipping exact sidecar parsing, basename comparison, or raw ZIP hashing.
    const input = fixture("bot");
    await rejects({ ...input, sidecarBytes: bytes(`A${"a".repeat(63)}  ${input.zipBasename}\n`) }, "sidecar");
    await rejects({ ...input, sidecarBytes: bytes(`${"a".repeat(64)}  other.zip\n`) }, "sidecar");
    await rejects({ ...input, sidecarBytes: bytes(`${"a".repeat(64)}  ${input.zipBasename}\n`) }, "sidecar");
    const mismatchedBasename = "mm-crypto-bot-config-search-0.1.0-bun-linux-x64.zip";
    const zipSha256 = sha256Hex(input.zipBytes);
    const mismatchedSidecar = formatSha256Sidecar(zipSha256, mismatchedBasename);
    await rejects(
      {
        ...input,
        sidecarBytes: bytes(mismatchedSidecar),
        zipBasename: mismatchedBasename,
      },
      "archive",
    );
  });

  test("maps parser structural, CRC, and forbidden-path failures to archive", async () => {
    // Catches failing to independently parse ZIP structure or accepting corrupted/unknown entries.
    const input = fixture("bot");
    const invalidSignature = mutate(input.zipBytes, 0, 0);
    await rejects(withZip(input, invalidSignature), "archive");
    const invalidCrc = mutate(input.zipBytes, 14, required(input.zipBytes.at(14)) ^ 1);
    await rejects(withZip(input, invalidCrc), "archive");
    const offset = centralOffset(input.zipBytes);
    await rejects(withZip(input, mutate(input.zipBytes, offset + 42, 1)), "archive");
    await rejects(withZip(input, mutate(input.zipBytes, 30, 0x53)), "archive");
  });

  test("rejects missing layouts, wrong executable, and wrong parser mode", async () => {
    // Catches accepting an incomplete three-entry layout, app/executable mismatch, or incorrect mode.
    const input = fixture("bot");
    const parsed = parseStoreZip(input.zipBytes);
    const readme = parsed.entries.find((entry) => entry.path === "README.md");
    const manifest = parsed.entries.find((entry) => entry.path === "manifest.json");
    expect(readme).toBeDefined();
    expect(manifest).toBeDefined();
    const partial = encodeStoreZip(
      [
        { bytes: required(readme).bytes, mode: 0o644, path: "README.md" },
        { bytes: required(manifest).bytes, mode: 0o644, path: "manifest.json" },
      ],
      epoch,
    );
    await rejects(withZip(input, partial), "archive");
    const wrongExecutable = fixture("config-search", (manifest) => ({
      ...manifest,
      app: "bot",
      payloads: [
        required(manifest.payloads[0]),
        { ...required(manifest.payloads[1]), path: "bin/mm-crypto-bot-bot" },
      ],
    }));
    await rejects(wrongExecutable, "archive");
    const wrongMode = mutate(input.zipBytes, centralOffset(input.zipBytes) + 40, 0xed);
    await rejects(withZip(input, wrongMode), "archive");
  });

  test("rejects malformed UTF-8, malformed JSON, and noncanonical manifest bytes", async () => {
    // Catches tolerant manifest decoding, parsing, or normalization instead of exact canonical bytes.
    await rejects(archive("bot", new Uint8Array([0xff])), "manifest");
    await rejects(archive("bot", bytes("{")), "manifest");
    await rejects(archive("bot", bytes('{"app":"bot"}\n')), "manifest");
  });

  test("rejects every fixed manifest schema invariant", async () => {
    // Catches any missing fixed schema, version, digest, epoch, target, toolchain, or configuration check.
    const changes: readonly ((manifest: ReleaseManifestV1) => unknown)[] = [
      (manifest) => ({ ...manifest, schema: "wrong" }),
      (manifest) => ({ ...manifest, app: "wrong" }),
      (manifest) => ({ ...manifest, version: "0.1.1" }),
      (manifest) => ({ ...manifest, commit: "A".repeat(40) }),
      (manifest) => ({ ...manifest, commit: 1 }),
      (manifest) => ({ ...manifest, lockfileSha256: "B".repeat(64) }),
      (manifest) => ({ ...manifest, lockfileSha256: 1 }),
      (manifest) => ({ ...manifest, sourceDateEpoch: "1788199915" }),
      (manifest) => ({ ...manifest, sourceDateEpoch: epoch + 2 }),
      (manifest) => ({ ...manifest, target: { ...manifest.target, arch: "arm64" } }),
      (manifest) => ({ ...manifest, target: {} }),
      (manifest) => ({ ...manifest, toolchain: { ...manifest.toolchain, bun: "1.3.15" } }),
      (manifest) => ({ ...manifest, toolchain: {} }),
      (manifest) => ({ ...manifest, configuration: { ...manifest.configuration, external: false } }),
      (manifest) => ({ ...manifest, configuration: { embedded: false, external: true } }),
      (manifest) => ({ ...manifest, extra: true }),
      (manifest) => {
        const { commit: _commit, ...withoutCommit } = manifest;
        return withoutCommit;
      },
    ];
    for (const change of changes.slice(0, 8)) await rejects(fixture("bot", change), "manifest");
    await rejects(fixture("bot", required(changes[8])), "timestamp");
    for (const change of changes.slice(9)) await rejects(fixture("bot", change), "manifest");
  });

  test("rejects payload ordering, count, path, mode, byte count, digest, and self-listing", async () => {
    // Catches accepting payload metadata that does not exactly describe README plus the executable.
    await rejects(
      fixture("bot", (manifest) => ({ ...manifest, payloads: {} })),
      "manifest",
    );
    const changes: readonly ((manifest: ReleaseManifestV1) => unknown)[] = [
      (manifest) => ({ ...manifest, payloads: manifest.payloads.toReversed() }),
      (manifest) => ({ ...manifest, payloads: [required(manifest.payloads[0])] }),
      (manifest) => ({ ...manifest, payloads: [{}, required(manifest.payloads[1])] }),
      (manifest) => ({
        ...manifest,
        payloads: [
          { ...required(manifest.payloads[0]), path: "manifest.json" },
          required(manifest.payloads[1]),
        ],
      }),
      (manifest) => ({
        ...manifest,
        payloads: [{ ...required(manifest.payloads[0]), mode: "0755" }, required(manifest.payloads[1])],
      }),
      (manifest) => ({
        ...manifest,
        payloads: [{ ...required(manifest.payloads[0]), bytes: 0 }, required(manifest.payloads[1])],
      }),
      (manifest) => ({
        ...manifest,
        payloads: [{ ...required(manifest.payloads[0]), bytes: "0" }, required(manifest.payloads[1])],
      }),
      (manifest) => ({
        ...manifest,
        payloads: [
          { ...required(manifest.payloads[0]), sha256: "0".repeat(64) },
          required(manifest.payloads[1]),
        ],
      }),
      (manifest) => ({
        ...manifest,
        payloads: [{ ...required(manifest.payloads[0]), sha256: 0 }, required(manifest.payloads[1])],
      }),
    ];
    for (const change of changes) await rejects(fixture("bot", change), "payload");
  });

  test("rejects malformed JavaScript-boundary objects and accessors", async () => {
    // Catches trusting structural TypeScript types instead of validating own data properties at runtime.
    const input = fixture("bot");
    const extra = { ...input, unexpected: true };
    await rejects(extra, "input");
    Object.setPrototypeOf(input, {});
    await rejects(input, "input");
    const accessor = fixture("bot");
    Object.defineProperty(accessor, "zipBytes", { enumerable: true, get: () => accessor.sidecarBytes });
    await rejects(accessor, "input");
    const wrongSidecarType = fixture("bot");
    Object.defineProperty(wrongSidecarType, "sidecarBytes", { value: "not-bytes" });
    await rejects(wrongSidecarType, "input");
    const wrongBasenameType = fixture("bot");
    Object.defineProperty(wrongBasenameType, "zipBasename", { value: new Uint8Array() });
    await rejects(wrongBasenameType, "input");
    const wrongZipType = fixture("bot");
    Object.defineProperty(wrongZipType, "zipBytes", { value: "not-bytes" });
    await rejects(wrongZipType, "input");
  });
});
