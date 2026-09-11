import { expect, test } from "vitest";
import { canonicalJson, formatSha256Sidecar, sha256Hex, type ReleaseManifestV1 } from "./release-contract";
import { createReleaseSetManifest } from "./release-set-contract";
import { encodeReleaseSetZip } from "./release-set-zip";
import { verifyReleaseSetArchive } from "./release-set-verifier";
import { encodeStoreZip } from "./zip-store-encoder";

const text = new TextEncoder();
const epoch = 1_788_199_914;
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
