import {
  canonicalReleaseSetInputs,
  canonicalReleaseSetManifestBytes,
  createReleaseSetManifest,
  type ReleaseSetArchive,
  type ReleaseSetInput,
} from "./release-set-contract";

const text = new TextEncoder();
const local = 0x04_03_4b_50;
const central = 0x02_01_4b_50;
const end = 0x06_05_4b_50;

export function compareReleaseSetPaths(left: string, right: string): number {
  return Number(left > right) - Number(left < right);
}

export function encodeReleaseSetZip(inputs: readonly ReleaseSetInput[]): ReleaseSetArchive {
  const canonical = canonicalReleaseSetInputs(inputs);
  const manifest = createReleaseSetManifest(canonical);
  const entries = [
    { bytes: canonical[0].sidecarBytes, path: manifest.applications[0].sidecar.path },
    { bytes: canonical[0].zipBytes, path: manifest.applications[0].zip.path },
    { bytes: canonical[1].sidecarBytes, path: manifest.applications[1].sidecar.path },
    { bytes: canonical[1].zipBytes, path: manifest.applications[1].zip.path },
    { bytes: canonicalReleaseSetManifestBytes(manifest), path: "release-set-manifest.json" },
  ].toSorted((a, b) => compareReleaseSetPaths(a.path, b.path));
  const stamp = dos(manifest.sourceDateEpoch);
  const locals = entries.reduce(
    (size, entry) => size + 30 + text.encode(entry.path).length + entry.bytes.length,
    0,
  );
  const total = locals + entries.reduce((size, entry) => size + 46 + text.encode(entry.path).length, 0) + 22;
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  let offset = 0;
  const positioned = entries.map((entry) => ({ entry, position: 0 }));
  for (const positionedEntry of positioned) {
    const { entry } = positionedEntry;
    const name = text.encode(entry.path);
    positionedEntry.position = offset;
    header(view, offset, local, stamp, crc(entry.bytes), entry.bytes.length, name.length, 0);
    out.set(name, offset + 30);
    out.set(entry.bytes, offset + 30 + name.length);
    offset += 30 + name.length + entry.bytes.length;
  }
  const centralOffset = offset;
  for (const { entry, position } of positioned) {
    const name = text.encode(entry.path);
    centralHeader(view, offset, stamp, crc(entry.bytes), entry.bytes.length, name.length, position);
    out.set(name, offset + 46);
    offset += 46 + name.length;
  }
  view.setUint32(offset, end, true);
  view.setUint16(offset + 8, entries.length, true);
  view.setUint16(offset + 10, entries.length, true);
  view.setUint32(offset + 12, offset - centralOffset, true);
  view.setUint32(offset + 16, centralOffset, true);
  return Object.freeze({ manifest, zipBytes: out });
}

function header(
  view: DataView,
  offset: number,
  signature: number,
  stamp: { date: number; time: number },
  checksum: number,
  size: number,
  nameLength: number,
  extra: number,
): void {
  view.setUint32(offset, signature, true);
  view.setUint16(offset + 4, 20, true);
  view.setUint16(offset + 6, 0, true);
  view.setUint16(offset + 8, 0, true);
  view.setUint16(offset + 10, stamp.time, true);
  view.setUint16(offset + 12, stamp.date, true);
  view.setUint32(offset + 14, checksum, true);
  view.setUint32(offset + 18, size, true);
  view.setUint32(offset + 22, size, true);
  view.setUint16(offset + 26, nameLength, true);
  view.setUint16(offset + 28, extra, true);
}
function centralHeader(
  view: DataView,
  offset: number,
  stamp: { date: number; time: number },
  checksum: number,
  size: number,
  nameLength: number,
  localOffset: number,
): void {
  view.setUint32(offset, central, true);
  view.setUint16(offset + 4, 0x03_14, true);
  view.setUint16(offset + 6, 20, true);
  view.setUint16(offset + 8, 0, true);
  view.setUint16(offset + 10, 0, true);
  view.setUint16(offset + 12, stamp.time, true);
  view.setUint16(offset + 14, stamp.date, true);
  view.setUint32(offset + 16, checksum, true);
  view.setUint32(offset + 20, size, true);
  view.setUint32(offset + 24, size, true);
  view.setUint16(offset + 28, nameLength, true);
  view.setUint16(offset + 30, 0, true);
  view.setUint16(offset + 32, 0, true);
  view.setUint16(offset + 34, 0, true);
  view.setUint16(offset + 36, 0, true);
  view.setUint32(offset + 38, (0o10_0644 << 16) >>> 0, true);
  view.setUint32(offset + 42, localOffset, true);
}
function dos(epoch: number): { date: number; time: number } {
  const value = epoch - (epoch % 2);
  if (!Number.isSafeInteger(value) || value < 315_532_800 || value > 4_354_819_199)
    throw new Error("release-set epoch outside ZIP DOS range");
  const d = new Date(value * 1000);
  return {
    date: ((d.getUTCFullYear() - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate(),
    time: (d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | (d.getUTCSeconds() >> 1),
  };
}
function crc(bytes: Uint8Array): number {
  let value = 0xff_ff_ff_ff;
  for (const byte of bytes) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit += 1) value = (value >>> 1) ^ (value & 1 ? 0xed_b8_83_20 : 0);
  }
  return (value ^ 0xff_ff_ff_ff) >>> 0;
}
