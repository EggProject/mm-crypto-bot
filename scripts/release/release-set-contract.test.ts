import { expect, test } from "vitest";

import { canonicalJson, formatSha256Sidecar, sha256Hex, type ReleaseManifestV2 } from "./release-contract";
import {
  canonicalReleaseSetInputs,
  canonicalReleaseSetManifestBytes,
  createReleaseSetManifest,
  deriveReleaseSetDestination,
  releaseSetArchiveBasename,
  releaseSetCandidatePrefix,
  releaseSetManifestGeneration,
  type ReleaseSetInput,
} from "./release-set-contract";

const text = new TextEncoder();

function input(app: "bot" | "config-search"): ReleaseSetInput {
  const zipBytes = text.encode(`inner-${app}`);
  const innerManifest: ReleaseManifestV2 = {
    app: app,
    commit: "a".repeat(40),
    configuration: { embedded: false, external: true, runtimeRootEnvironment: "MM_CRYPTO_BOT_RUNTIME_ROOT" },
    lockfileSha256: "b".repeat(64),
    payloads: [],
    schema: "mm-crypto-bot.release-manifest/v2",
    sourceDateEpoch: 1_788_199_914,
    target: { arch: "x64", bunTarget: "bun-linux-x64", os: "linux" },
    toolchain: { bun: "1.4.2", nodeMetadata: "24.21.0" },
    version: "0.1.0",
  };
  return {
    application: app,
    innerManifest,
    sidecarBytes: text.encode(
      formatSha256Sidecar(sha256Hex(zipBytes), `mm-crypto-bot-${app}-0.1.0-bun-linux-x64.zip`),
    ),
    zipBytes,
  };
}

test("canonicalizes input permutations into immutable bot then config-search records", () => {
  const bot = input("bot");
  const search = input("config-search");
  const left = createReleaseSetManifest([bot, search]);
  const right = createReleaseSetManifest([search, bot]);
  expect(left).toEqual(right);
  expect(left.applications.map((record) => record.app)).toEqual(["bot", "config-search"]);
  expect(canonicalReleaseSetManifestBytes(left)).toEqual(text.encode(canonicalJson(left)));
  expect(canonicalReleaseSetInputs([search, bot])).toEqual([bot, search]);
  expect(Object.isFrozen(left)).toBe(true);
  expect(Object.isFrozen(left.applications)).toBe(true);
  expect(left.schema).toBe("mm-crypto-bot.release-set-manifest/v2");
});

test("derives the only public destination from the trusted root", () => {
  expect(deriveReleaseSetDestination("/trusted-publication")).toBe(
    `/trusted-publication/0.1.0/bun-linux-x64/${releaseSetArchiveBasename}`,
  );
  expect(releaseSetCandidatePrefix).toBe("release-set-candidate-");
});

test("derives release-set generation only from exact paired schema contracts", () => {
  expect(
    releaseSetManifestGeneration(
      "mm-crypto-bot.release-set-manifest/v1",
      "mm-crypto-bot.release-manifest/v1",
    ),
  ).toBe("v1");
  expect(
    releaseSetManifestGeneration(
      "mm-crypto-bot.release-set-manifest/v2",
      "mm-crypto-bot.release-manifest/v2",
    ),
  ).toBe("v2");
  expect(() =>
    releaseSetManifestGeneration(
      "mm-crypto-bot.release-set-manifest/v1",
      "mm-crypto-bot.release-manifest/v2",
    ),
  ).toThrow("generation mismatch");
});

test("rejects incomplete, duplicate, byte-invalid, and mismatched application inputs", () => {
  const bot = input("bot");
  const search = input("config-search");
  expect(() => createReleaseSetManifest([bot])).toThrow("exactly two");
  expect(() => createReleaseSetManifest([bot, bot])).toThrow("invalid release-set applications");
  const wrongBytes = { ...search, sidecarBytes: [] };
  expect(() => {
    Reflect.apply(createReleaseSetManifest, undefined, [[bot, wrongBytes]]);
  }).toThrow("invalid release-set input bytes");
  expect(() =>
    createReleaseSetManifest([bot, { ...search, innerManifest: { ...search.innerManifest, app: "bot" } }]),
  ).toThrow("release-set manifest application mismatch");
});

test("rejects any shared identity drift before producing a release set", () => {
  const bot = input("bot");
  const search = input("config-search");
  for (const changed of [
    { commit: "c".repeat(40) },
    { lockfileSha256: "d".repeat(64) },
    { sourceDateEpoch: 1_788_199_916 },
    { version: "0.1.1" },
    { target: { arch: "x64", bunTarget: "wrong", os: "linux" } },
    { toolchain: { bun: "1.3.15", nodeMetadata: "24.19.0" } },
  ] as const) {
    const changedSearch = { ...search, innerManifest: { ...search.innerManifest, ...changed } };
    expect(() => {
      Reflect.apply(createReleaseSetManifest, undefined, [[bot, changedSearch]]);
    }).toThrow("release-set identity mismatch");
  }
});
