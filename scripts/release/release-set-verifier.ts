import { canonicalJson, parseSha256Sidecar, sha256Hex, type ReleaseManifestV1 } from "./release-contract";
import {
  canonicalReleaseSetManifestBytes,
  type ReleaseSetAppRecord,
  type ReleaseSetManifestV1,
  type VerifiedReleaseSetArchive,
} from "./release-set-contract";
import { verifyReleaseArchive } from "./release-verifier";

const decoder = new TextDecoder("utf-8", { fatal: true });
const expectedNames = [
  "apps/bot/mm-crypto-bot-bot-0.1.0-bun-linux-x64.zip",
  "apps/bot/mm-crypto-bot-bot-0.1.0-bun-linux-x64.zip.sha256",
  "apps/config-search/mm-crypto-bot-config-search-0.1.0-bun-linux-x64.zip",
  "apps/config-search/mm-crypto-bot-config-search-0.1.0-bun-linux-x64.zip.sha256",
  "release-set-manifest.json",
];

export async function verifyReleaseSetArchive(input: {
  readonly zipBytes: Uint8Array;
}): Promise<VerifiedReleaseSetArchive> {
  try {
    if (!(input.zipBytes instanceof Uint8Array)) throw new Error("input");
    const entries = parse(input.zipBytes);
    if (!hasExpectedLayout(entries)) throw new Error("layout");
    const manifestEntry = entries[4];
    const raw = JSON.parse(decoder.decode(manifestEntry.bytes)) as unknown;
    if (canonicalJson(raw) !== decoder.decode(manifestEntry.bytes)) throw new Error("canonical");
    const manifest = validateManifest(raw);
    const canonical = canonicalReleaseSetManifestBytes(manifest);
    if (!isSameBytes(canonical, manifestEntry.bytes)) throw new Error("manifest");
    const epoch = dos(manifest.sourceDateEpoch);
    if (
      entries.some(
        (entry) =>
          entry.date !== epoch.date ||
          entry.time !== epoch.time ||
          entry.localDate !== epoch.date ||
          entry.localTime !== epoch.time,
      )
    )
      throw new Error("timestamp");
    const inner: ReleaseManifestV1[] = [];
    for (const record of manifest.applications) {
      const zip = entries.find((entry) => entry.path === record.zip.path);
      const sidecar = entries.find((entry) => entry.path === record.sidecar.path);
      if (
        zip === undefined ||
        sidecar === undefined ||
        zip.bytes.length !== record.zip.bytes ||
        sidecar.bytes.length !== record.sidecar.bytes ||
        sha256Hex(zip.bytes) !== record.zip.sha256 ||
        sha256Hex(sidecar.bytes) !== record.sidecar.sha256
      )
        throw new Error("digest");
      const parsed = parseSha256Sidecar(sidecar.bytes);
      if (parsed.sha256 !== sha256Hex(zip.bytes) || parsed.zipBasename !== record.zip.path.split("/").at(-1))
        throw new Error("sidecar");
      inner.push(
        await verifyReleaseArchive({
          sidecarBytes: sidecar.bytes,
          zipBasename: parsed.zipBasename,
          zipBytes: zip.bytes,
        }),
      );
    }
    if (!hasSameIdentity(manifest, inner)) throw new Error("identity");
    return Object.freeze({ manifest, verified: true, zipBytes: new Uint8Array(input.zipBytes) });
  } catch {
    throw new Error("release-set archive is invalid");
  }
}

interface Entry {
  readonly bytes: Uint8Array;
  readonly date: number;
  readonly localDate: number;
  readonly localTime: number;
  readonly mode: number;
  readonly path: string;
  readonly time: number;
}
function hasExpectedLayout(
  entries: readonly Entry[],
): entries is readonly [Entry, Entry, Entry, Entry, Entry] {
  return (
    entries.length === 5 &&
    entries.every((entry, index) => entry.path === expectedNames.at(index) && entry.mode === 0o644)
  );
}
function parse(bytes: Uint8Array): readonly Entry[] {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 22) throw new Error("ZIP");
  const eocd = bytes.length - 22;
  if (v.getUint32(eocd, true) !== 0x06_05_4b_50) throw new Error("ZIP");
  const count = v.getUint16(eocd + 10, true);
  const central = v.getUint32(eocd + 16, true);
  let offset = central;
  const entries: Entry[] = [];
  for (let index = 0; index < count; index += 1) {
    if (
      v.getUint32(offset, true) !== 0x02_01_4b_50 ||
      v.getUint16(offset + 8, true) !== 0 ||
      v.getUint16(offset + 10, true) !== 0 ||
      v.getUint16(offset + 30, true) !== 0 ||
      v.getUint16(offset + 32, true) !== 0
    )
      throw new Error("central");
    const size = v.getUint32(offset + 24, true);
    if (size !== v.getUint32(offset + 20, true)) throw new Error("store");
    const length = v.getUint16(offset + 28, true);
    const local = v.getUint32(offset + 42, true);
    const name = decoder.decode(bytes.slice(offset + 46, offset + 46 + length));
    if (
      v.getUint32(local, true) !== 0x04_03_4b_50 ||
      v.getUint16(local + 6, true) !== 0 ||
      v.getUint16(local + 8, true) !== 0 ||
      v.getUint16(local + 28, true) !== 0 ||
      decoder.decode(bytes.slice(local + 30, local + 30 + length)) !== name
    )
      throw new Error("local");
    const payload = bytes.slice(local + 30 + length, local + 30 + length + size);
    if (payload.length !== size) throw new Error("payload");
    entries.push(
      Object.freeze({
        bytes: payload,
        date: v.getUint16(offset + 14, true),
        localDate: v.getUint16(local + 12, true),
        localTime: v.getUint16(local + 10, true),
        mode: (v.getUint32(offset + 38, true) >>> 16) & 0o7777,
        path: name,
        time: v.getUint16(offset + 12, true),
      }),
    );
    offset += 46 + length;
  }
  return entries;
}
function validateManifest(value: unknown): ReleaseSetManifestV1 {
  if (
    !isRecord(value) ||
    value["schema"] !== "mm-crypto-bot.release-set-manifest/v1" ||
    value["version"] !== "0.1.0" ||
    !Array.isArray(value["applications"]) ||
    value["applications"].length !== 2 ||
    typeof value["commit"] !== "string" ||
    typeof value["lockfileSha256"] !== "string" ||
    typeof value["sourceDateEpoch"] !== "number" ||
    !isRecord(value["target"]) ||
    !isRecord(value["toolchain"])
  )
    throw new Error("manifest");
  const apps = value["applications"];
  const bot = app(apps[0], "bot");
  const search = app(apps[1], "config-search");
  const target = value["target"];
  const toolchain = value["toolchain"];
  if (
    target["arch"] !== "x64" ||
    target["bunTarget"] !== "bun-linux-x64" ||
    target["os"] !== "linux" ||
    toolchain["bun"] !== "1.3.14" ||
    toolchain["nodeMetadata"] !== "24.19.0" ||
    !Number.isSafeInteger(value["sourceDateEpoch"])
  )
    throw new Error("manifest");
  const canonicalApps: readonly [ReleaseSetAppRecord<"bot">, ReleaseSetAppRecord<"config-search">] = [
    bot,
    search,
  ];
  return Object.freeze({
    applications: Object.freeze(canonicalApps),
    commit: value["commit"],
    lockfileSha256: value["lockfileSha256"],
    schema: "mm-crypto-bot.release-set-manifest/v1",
    sourceDateEpoch: value["sourceDateEpoch"],
    target: Object.freeze({ arch: "x64", bunTarget: "bun-linux-x64", os: "linux" }),
    toolchain: Object.freeze({ bun: "1.3.14", nodeMetadata: "24.19.0" }),
    version: "0.1.0",
  });
}
function app<TApp extends "bot" | "config-search">(value: unknown, app_: TApp): ReleaseSetAppRecord<TApp> {
  if (!isRecord(value) || value["app"] !== app_) throw new Error("manifest");
  return Object.freeze({
    app: app_,
    sidecar: descriptor(value["sidecar"]),
    zip: descriptor(value["zip"]),
  });
}
function descriptor(value: unknown): Readonly<{ bytes: number; path: string; sha256: string }> {
  if (
    !isRecord(value) ||
    typeof value["bytes"] !== "number" ||
    !Number.isSafeInteger(value["bytes"]) ||
    value["bytes"] < 0 ||
    typeof value["path"] !== "string" ||
    typeof value["sha256"] !== "string" ||
    !/^[0-9a-f]{64}$/u.test(value["sha256"])
  )
    throw new Error("manifest");
  return Object.freeze({ bytes: value["bytes"], path: value["path"], sha256: value["sha256"] });
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isSameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((byte, index) => byte === b.at(index));
}
function dos(epoch: number): { date: number; time: number } {
  const value = epoch - (epoch % 2);
  const d = new Date(value * 1000);
  return {
    date: ((d.getUTCFullYear() - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate(),
    time: (d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | (d.getUTCSeconds() >> 1),
  };
}
function hasSameIdentity(set: ReleaseSetManifestV1, inner: readonly ReleaseManifestV1[]): boolean {
  return (
    inner.length === 2 &&
    inner.every(
      (manifest, index) =>
        manifest.app === set.applications.at(index)?.app &&
        manifest.commit === set.commit &&
        manifest.lockfileSha256 === set.lockfileSha256 &&
        manifest.sourceDateEpoch === set.sourceDateEpoch,
    )
  );
}
