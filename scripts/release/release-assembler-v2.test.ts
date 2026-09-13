import { describe, expect, test } from "vitest";

import {
  canonicalJson,
  formatSha256Sidecar,
  legacyRequiredBunVersion,
  legacyRequiredNodeMetadataVersion,
  requiredBunVersion,
  requiredNodeMetadataVersion,
  sha256Hex,
  type ReleaseApplication as ReleaseApp,
  type ReleaseManifest,
} from "./release-contract";
import { assembleRelease } from "./release-assembler";
import { fixture } from "./release-assembler.test-support";
import { verifyReleaseArchive } from "./release-verifier";
import { parseStoreZip } from "./zip-store";
import { encodeStoreZip } from "./zip-store-encoder";

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
const epoch = 1_788_199_915;

function archiveFor(app: ReleaseApp, manifest: unknown) {
  const readme = encoder.encode(`README for ${app}\n`);
  const executable = encoder.encode(`executable ${app}\n`);
  const executablePath = `bin/mm-crypto-bot-${app}`;
  const manifestBytes = encoder.encode(canonicalJson(manifest));
  const zipBytes = encodeStoreZip(
    [
      { bytes: readme, mode: 0o644, path: "README.md" },
      { bytes: executable, mode: 0o755, path: executablePath },
      { bytes: manifestBytes, mode: 0o644, path: "manifest.json" },
    ],
    epoch,
  );
  const zipBasename = `mm-crypto-bot-${app}-0.1.0-bun-linux-x64.zip`;
  const zipSha256 = sha256Hex(zipBytes);
  const sidecar = formatSha256Sidecar(zipSha256, zipBasename);
  return Object.freeze({
    sidecarBytes: encoder.encode(sidecar),
    zipBasename,
    zipBytes,
  });
}

function manifestFor(app: ReleaseApp, schema: ReleaseManifest["schema"]): ReleaseManifest {
  const readme = encoder.encode(`README for ${app}\n`);
  const executable = encoder.encode(`executable ${app}\n`);
  const base = {
    app,
    commit: "a".repeat(40),
    configuration: {
      embedded: false as const,
      external: true as const,
      runtimeRootEnvironment: "MM_CRYPTO_BOT_RUNTIME_ROOT" as const,
    },
    lockfileSha256: "b".repeat(64),
    payloads: [
      { bytes: readme.length, mode: "0644" as const, path: "README.md" as const, sha256: sha256Hex(readme) },
      {
        bytes: executable.length,
        mode: "0755" as const,
        path: `bin/mm-crypto-bot-${app}` as const,
        sha256: sha256Hex(executable),
      },
    ],
    sourceDateEpoch: epoch,
    target: { arch: "x64" as const, bunTarget: "bun-linux-x64" as const, os: "linux" as const },
    version: "0.1.0" as const,
  };
  if (schema === "mm-crypto-bot.release-manifest/v1") {
    return {
      ...base,
      schema,
      toolchain: { bun: legacyRequiredBunVersion, nodeMetadata: legacyRequiredNodeMetadataVersion },
    };
  }
  return {
    ...base,
    schema,
    toolchain: { bun: requiredBunVersion, nodeMetadata: requiredNodeMetadataVersion },
  };
}

function manifestFromCandidate(current: ReturnType<typeof fixture>): unknown {
  const write = current.fileSystem.writeOperations.find((operation) => operation.path.endsWith(".zip"));
  if (write === undefined) throw new Error("test fixture did not receive ZIP output");
  const manifest = parseStoreZip(write.bytes).entries.find((entry) => entry.path === "manifest.json");
  if (manifest === undefined) throw new Error("test fixture ZIP did not contain a manifest");
  return JSON.parse(decoder.decode(manifest.bytes));
}

describe("release assembly V2", () => {
  test("emits only the current V2 schema and exact current toolchain", async () => {
    const current = fixture();

    const result = await assembleRelease(current.dependencies, "bot");
    const manifest = manifestFromCandidate(current);

    expect(result.manifest.schema).toBe("mm-crypto-bot.release-manifest/v2");
    expect(result.manifest.toolchain).toEqual({
      bun: requiredBunVersion,
      nodeMetadata: requiredNodeMetadataVersion,
    });
    expect(manifest).toMatchObject({
      schema: "mm-crypto-bot.release-manifest/v2",
      toolchain: { bun: "1.4.2", nodeMetadata: "24.21.0" },
    });
  });

  test("keeps exact historical V1 verification while accepting an exact V2 contract", async () => {
    const legacy = await verifyReleaseArchive(
      archiveFor("bot", manifestFor("bot", "mm-crypto-bot.release-manifest/v1")),
    );
    const current = await verifyReleaseArchive(
      archiveFor("config-search", manifestFor("config-search", "mm-crypto-bot.release-manifest/v2")),
    );

    expect(legacy).toMatchObject({
      schema: "mm-crypto-bot.release-manifest/v1",
      toolchain: { bun: "1.3.14", nodeMetadata: "24.19.0" },
    });
    expect(current).toMatchObject({
      schema: "mm-crypto-bot.release-manifest/v2",
      toolchain: { bun: "1.4.2", nodeMetadata: "24.21.0" },
    });
  });

  test("rejects unknown and mixed schema or toolchain generations", async () => {
    const legacy = manifestFor("bot", "mm-crypto-bot.release-manifest/v1");
    const current = manifestFor("bot", "mm-crypto-bot.release-manifest/v2");
    const malformed: readonly unknown[] = [
      { ...legacy, schema: "mm-crypto-bot.release-manifest/v2" },
      { ...current, schema: "mm-crypto-bot.release-manifest/v1" },
      { ...current, toolchain: { bun: "1.3.14", nodeMetadata: "24.19.0" } },
      { ...current, schema: "mm-crypto-bot.release-manifest/v3" },
      { ...current, toolchain: { ...current.toolchain, unexpected: true } },
    ];

    for (const manifest of malformed) {
      await expect(verifyReleaseArchive(archiveFor("bot", manifest))).rejects.toThrow(
        "invalid release manifest",
      );
    }
  });
});
