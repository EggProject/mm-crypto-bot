import { expect, test } from "vitest";

import { canonicalJson, formatSha256Sidecar, sha256Hex, type ReleaseManifestV1 } from "./release-contract";
import { type ReleaseSetInput } from "./release-set-contract";
import { encodeReleaseSetZip } from "./release-set-zip";
import { verifyReleaseSetArchive } from "./release-set-verifier";
import { encodeStoreZip } from "./zip-store-encoder";

const text = new TextEncoder();

function input(app: "bot" | "config-search"): ReleaseSetInput {
  const readme = text.encode(app);
  const executable = text.encode(`${app}-binary`);
  const innerManifest: ReleaseManifestV1 = {
    app: app,
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
    sourceDateEpoch: 1_788_199_914,
    target: { arch: "x64", bunTarget: "bun-linux-x64", os: "linux" },
    toolchain: { bun: "1.3.14", nodeMetadata: "24.19.0" },
    version: "0.1.0",
  };
  const zipBytes = encodeStoreZip(
    [
      { bytes: readme, mode: 0o644, path: "README.md" },
      { bytes: executable, mode: 0o755, path: `bin/mm-crypto-bot-${app}` },
      { bytes: text.encode(canonicalJson(innerManifest)), mode: 0o644, path: "manifest.json" },
    ],
    innerManifest.sourceDateEpoch,
  );
  return {
    application: app,
    innerManifest,
    sidecarBytes: text.encode(
      formatSha256Sidecar(sha256Hex(zipBytes), `mm-crypto-bot-${app}-0.1.0-bun-linux-x64.zip`),
    ),
    zipBytes,
  };
}

function archive() {
  return encodeReleaseSetZip([input("bot"), input("config-search")]);
}

function centralOffsets(bytes: Uint8Array): readonly number[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const offsets: number[] = [];
  let offset = view.getUint32(bytes.length - 6, true);
  for (let index = 0; index < 5; index += 1) {
    offsets.push(offset);
    offset += 46 + view.getUint16(offset + 28, true);
  }
  return offsets;
}

function localOffset(bytes: Uint8Array, central: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(central + 42, true);
}

function mutate(bytes: Uint8Array, action: (view: DataView, central: readonly number[]) => void): Uint8Array {
  const result = new Uint8Array(bytes);
  action(new DataView(result.buffer), centralOffsets(result));
  return result;
}

function replaceManifest(bytes: Uint8Array, manifestBytes: Uint8Array): Uint8Array {
  const central = centralOffsets(bytes)[4];
  if (central === undefined) throw new Error("missing manifest central entry");
  const local = localOffset(bytes, central);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const centralStart = view.getUint32(bytes.byteLength - 6, true);
  const length = view.getUint32(central + 24, true);
  const start = local + 30 + view.getUint16(local + 26, true);
  const difference = manifestBytes.length - length;
  const result = new Uint8Array(bytes.length + difference);
  result.set(bytes.slice(0, start));
  result.set(manifestBytes, start);
  result.set(bytes.slice(start + length), start + manifestBytes.length);
  const mutated = new DataView(result.buffer);
  mutated.setUint32(local + 18, manifestBytes.length, true);
  mutated.setUint32(local + 22, manifestBytes.length, true);
  const shiftedCentral = central + difference;
  mutated.setUint32(shiftedCentral + 20, manifestBytes.length, true);
  mutated.setUint32(shiftedCentral + 24, manifestBytes.length, true);
  mutated.setUint32(result.byteLength - 6, centralStart + difference, true);
  return result;
}

test("verifies an independently encoded canonical outer release set", async () => {
  const current = archive();
  const central = centralOffsets(current.zipBytes)[4];
  if (central === undefined) throw new Error("missing manifest central entry");
  const local = localOffset(current.zipBytes, central);
  const view = new DataView(
    current.zipBytes.buffer,
    current.zipBytes.byteOffset,
    current.zipBytes.byteLength,
  );
  const manifestStart = local + 30 + view.getUint16(local + 26, true);
  const manifestBytes = current.zipBytes.slice(
    manifestStart,
    manifestStart + view.getUint32(central + 24, true),
  );
  const verified = await verifyReleaseSetArchive({ zipBytes: current.zipBytes });
  expect(verified.verified).toBe(true);
  expect(verified.manifest).toEqual(current.manifest);
  expect(verified.zipBytes).toEqual(current.zipBytes);
  expect(replaceManifest(current.zipBytes, manifestBytes)).toEqual(current.zipBytes);
});

test("rejects invalid input, ZIP metadata, and every noncanonical outer layout mutation", async () => {
  const current = archive();
  const broken = [
    new Uint8Array([0]),
    mutate(current.zipBytes, (view) => {
      view.setUint32(current.zipBytes.byteLength - 22, 0, true);
    }),
    mutate(current.zipBytes, (view) => {
      view.setUint16(current.zipBytes.byteLength - 14, 4, true);
      view.setUint16(current.zipBytes.byteLength - 12, 4, true);
    }),
    mutate(current.zipBytes, (view, central) => {
      const first = central[0];
      if (first === undefined) throw new Error("missing first central entry");
      view.setUint16(first + 8, 1, true);
    }),
    mutate(current.zipBytes, (view, central) => {
      const first = central[0];
      if (first === undefined) throw new Error("missing first central entry");
      view.setUint32(first + 20, 1, true);
    }),
    mutate(current.zipBytes, (view, central) => {
      const first = central[0];
      if (first === undefined) throw new Error("missing first central entry");
      view.setUint32(first + 38, 0, true);
    }),
    mutate(current.zipBytes, (view, central) => {
      const first = central[0];
      if (first === undefined) throw new Error("missing first central entry");
      const local = localOffset(current.zipBytes, first);
      const nameStart = first + 46;
      view.setUint8(nameStart + 5, "x".codePointAt(0) ?? 0);
      view.setUint8(local + 30 + 5, "x".codePointAt(0) ?? 0);
    }),
    mutate(current.zipBytes, (view, central) => {
      const first = central[0];
      if (first === undefined) throw new Error("missing first central entry");
      view.setUint16(localOffset(current.zipBytes, first) + 6, 1, true);
    }),
    mutate(current.zipBytes, (view, central) => {
      const last = central[4];
      if (last === undefined) throw new Error("missing last central entry");
      view.setUint32(last + 20, 0xff_ff_ff_ff, true);
      view.setUint32(last + 24, 0xff_ff_ff_ff, true);
    }),
  ];
  for (const zipBytes of broken)
    await expect(verifyReleaseSetArchive({ zipBytes })).rejects.toThrow("release-set archive is invalid");
  await expect(Reflect.apply(verifyReleaseSetArchive, undefined, [{ zipBytes: [] }])).rejects.toThrow(
    "release-set archive is invalid",
  );
});

test("rejects local and central timestamps that are not derived from the manifest epoch", async () => {
  const current = archive();
  const zipBytes = mutate(current.zipBytes, (view, central) => {
    for (const offset of central) {
      const local = localOffset(current.zipBytes, offset);
      view.setUint16(offset + 12, 0, true);
      view.setUint16(local + 10, 0, true);
    }
  });
  await expect(verifyReleaseSetArchive({ zipBytes })).rejects.toThrow("release-set archive is invalid");
});

test("rejects digest, sidecar, descriptor mapping, reversed-manifest, and inner identity breaks", async () => {
  const current = archive();
  const central = centralOffsets(current.zipBytes);
  const first = central[0];
  if (first === undefined) throw new Error("missing first central entry");
  const firstLocal = localOffset(current.zipBytes, first);
  const mutatedPayload = new Uint8Array(current.zipBytes);
  const payloadStart = firstLocal + 30 + new DataView(mutatedPayload.buffer).getUint16(firstLocal + 26, true);
  mutatedPayload.set([(mutatedPayload.at(payloadStart) ?? 0) ^ 1], payloadStart);

  const badSidecar = input("bot");
  const search = input("config-search");
  const incorrectSidecar = {
    ...badSidecar,
    sidecarBytes: text.encode(
      formatSha256Sidecar("f".repeat(64), "mm-crypto-bot-bot-0.1.0-bun-linux-x64.zip"),
    ),
  };
  const sidecarArchive = encodeReleaseSetZip([incorrectSidecar, search]);

  const descriptorManifest = {
    ...current.manifest,
    applications: current.manifest.applications.map((app, index) =>
      index === 0
        ? {
            ...app,
            zip: { ...app.zip, path: app.zip.path.replace("apps/bot", "apps/xot") },
          }
        : app,
    ),
  };
  const reversedManifest = {
    ...current.manifest,
    applications: current.manifest.applications.toReversed(),
  };
  const invalidDescriptorManifest = {
    ...current.manifest,
    applications: current.manifest.applications.map((app, index) =>
      index === 0 ? { ...app, zip: { ...app.zip, sha256: `g${app.zip.sha256.slice(1)}` } } : app,
    ),
  };
  const invalidTargetManifest = { ...current.manifest, target: { ...current.manifest.target, arch: "arm" } };

  const identityBot = input("bot");
  const identitySearch = input("config-search");
  const identityArchive = encodeReleaseSetZip([
    { ...identityBot, innerManifest: { ...identityBot.innerManifest, commit: "c".repeat(40) } },
    { ...identitySearch, innerManifest: { ...identitySearch.innerManifest, commit: "c".repeat(40) } },
  ]);
  for (const zipBytes of [
    mutatedPayload,
    sidecarArchive.zipBytes,
    replaceManifest(current.zipBytes, text.encode(canonicalJson(descriptorManifest))),
    replaceManifest(current.zipBytes, text.encode(canonicalJson(reversedManifest))),
    replaceManifest(current.zipBytes, text.encode(canonicalJson(invalidDescriptorManifest))),
    replaceManifest(current.zipBytes, text.encode(canonicalJson(invalidTargetManifest))),
    replaceManifest(current.zipBytes, text.encode("[]\n")),
    replaceManifest(current.zipBytes, text.encode(` ${canonicalJson(current.manifest)}`)),
    replaceManifest(current.zipBytes, text.encode(canonicalJson({ ...current.manifest, ignored: 0 }))),
    identityArchive.zipBytes,
  ]) {
    await expect(verifyReleaseSetArchive({ zipBytes })).rejects.toThrow("release-set archive is invalid");
  }
});
