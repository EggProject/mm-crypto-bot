import { expect, test } from "vitest";
import { canonicalJson, formatSha256Sidecar, sha256Hex, type ReleaseManifestV1 } from "./release-contract";
import { createReleaseSetManifest } from "./release-set-contract";
import { compareReleaseSetPaths, encodeReleaseSetZip } from "./release-set-zip";
import { verifyReleaseSetArchive } from "./release-set-verifier";
import { encodeStoreZip } from "./zip-store-encoder";

const text = new TextEncoder();
const epoch = 1_788_199_914;
const localHeader = 0x04_03_4b_50;

function localEntryPaths(zipBytes: Uint8Array): string[] {
  const paths: string[] = [];
  const view = new DataView(zipBytes.buffer, zipBytes.byteOffset, zipBytes.byteLength);
  let offset = 0;
  while (view.getUint32(offset, true) === localHeader) {
    const byteLength = view.getUint32(offset + 18, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const nameStart = offset + 30;
    const nameEnd = nameStart + nameLength;
    paths.push(new TextDecoder().decode(zipBytes.subarray(nameStart, nameEnd)));
    offset = nameEnd + extraLength + byteLength;
  }
  return paths;
}

function input(app: "bot" | "config-search") {
  const readme = text.encode(app);
  const executable = text.encode(`${app}-exe`);
  const manifest: ReleaseManifestV1 = {
    app,
    commit: "a".repeat(40),
    configuration: { embedded: false, external: true, runtimeRootEnvironment: "MM_CRYPTO_BOT_RUNTIME_ROOT" },
    lockfileSha256: "b".repeat(64),
    payloads: [
      { bytes: readme.length, mode: "0644", path: "README.md", sha256: sha256Hex(readme) },
      {
        bytes: executable.length,
        mode: "0755",
        path: `bin/mm-crypto-bot-${app}`,
        sha256: sha256Hex(executable),
      },
    ],
    schema: "mm-crypto-bot.release-manifest/v1",
    sourceDateEpoch: epoch,
    target: { arch: "x64", bunTarget: "bun-linux-x64", os: "linux" },
    toolchain: { bun: "1.3.14", nodeMetadata: "24.19.0" },
    version: "0.1.0",
  };
  const zipBytes = encodeStoreZip(
    [
      { bytes: readme, mode: 0o644, path: "README.md" },
      { bytes: executable, mode: 0o755, path: `bin/mm-crypto-bot-${app}` },
      { bytes: text.encode(canonicalJson(manifest)), mode: 0o644, path: "manifest.json" },
    ],
    epoch,
  );
  return {
    application: app,
    innerManifest: manifest,
    sidecarBytes: text.encode(
      formatSha256Sidecar(sha256Hex(zipBytes), `mm-crypto-bot-${app}-0.1.0-bun-linux-x64.zip`),
    ),
    zipBytes,
  } as const;
}
test("canonicalizes permutations into a five-entry independently verifiable STORE ZIP", async () => {
  const bot = input("bot");
  const search = input("config-search");
  const left = encodeReleaseSetZip([bot, search]);
  const right = encodeReleaseSetZip([search, bot]);
  expect(left.zipBytes).toEqual(right.zipBytes);
  expect(createReleaseSetManifest([search, bot]).applications.map((entry) => entry.app)).toEqual([
    "bot",
    "config-search",
  ]);
  const verified = await verifyReleaseSetArchive({ zipBytes: left.zipBytes });
  expect(verified.manifest.applications).toHaveLength(2);
});

test("rejects a shared epoch that cannot be represented by the ZIP DOS timestamp", () => {
  const bot = input("bot");
  const search = input("config-search");
  const oldBot = { ...bot, innerManifest: { ...bot.innerManifest, sourceDateEpoch: 1 } };
  const oldSearch = { ...search, innerManifest: { ...search.innerManifest, sourceDateEpoch: 1 } };
  expect(() => encodeReleaseSetZip([oldBot, oldSearch])).toThrow("outside ZIP DOS range");
});

test("orders release-set entry names by UTF-16 code units, not runtime collation", () => {
  // U+00E4 sorts after ASCII z by UTF-16 code unit, while locale collation is environment-dependent.
  expect(compareReleaseSetPaths("\u{E4}", "z")).toBeGreaterThan(0);
  expect(compareReleaseSetPaths("apps/bot", "apps/config-search")).toBeLessThan(0);
  expect(compareReleaseSetPaths("release-set-manifest.json", "release-set-manifest.json")).toBe(0);
});

test("writes all five outer local entries in the approved UTF-16 code-unit order", () => {
  const archive = encodeReleaseSetZip([input("config-search"), input("bot")]);
  expect(localEntryPaths(archive.zipBytes)).toEqual([
    "apps/bot/mm-crypto-bot-bot-0.1.0-bun-linux-x64.zip",
    "apps/bot/mm-crypto-bot-bot-0.1.0-bun-linux-x64.zip.sha256",
    "apps/config-search/mm-crypto-bot-config-search-0.1.0-bun-linux-x64.zip",
    "apps/config-search/mm-crypto-bot-config-search-0.1.0-bun-linux-x64.zip.sha256",
    "release-set-manifest.json",
  ]);
});
