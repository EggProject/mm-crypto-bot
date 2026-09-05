import type { ReleaseApplication as ReleaseApp, ReleasePayloadInput } from "./release-contract";

const text = new TextEncoder();
const local = 0x04_03_4b_50;
const central = 0x02_01_4b_50;
const end = 0x06_05_4b_50;
const version = 20;
const minEpoch = 315_532_800;
const maxEpoch = 4_354_819_199;

interface Entry {
  readonly bytes: Uint8Array;
  readonly crc32: number;
  readonly mode: 0o644 | 0o755;
  readonly name: Uint8Array;
  readonly path: string;
}

interface DosTimestamp {
  readonly date: number;
  readonly time: number;
}

export function encodeStoreZip(inputs: readonly ReleasePayloadInput[], epoch: number): Uint8Array {
  const timestamp = dosTimestamp(epoch);
  const entries = inputs.map((input) => validate(input)).toSorted(compare);
  for (let index = 1; index < entries.length; index += 1) {
    // eslint-disable-next-line security/detect-object-injection -- index is constrained by the entries length.
    if (entries[index - 1]?.path === entries[index]?.path) throw new Error("duplicate ZIP path");
  }
  const out = new Writer();
  const localEntries: { readonly entry: Entry; readonly offset: number }[] = [];
  for (const entry of entries) {
    const offset = out.length;
    localEntries.push({ entry, offset });
    u32(out, [local]);
    u16(out, [version, 0, 0, timestamp.time, timestamp.date]);
    u32(out, [entry.crc32, entry.bytes.length, entry.bytes.length]);
    u16(out, [entry.name.length, 0]);
    out.bytes(entry.name);
    out.bytes(entry.bytes);
  }
  const centralOffset = out.length;
  for (const { entry, offset } of localEntries) {
    u32(out, [central]);
    u16(out, [(3 << 8) | version, version, 0, 0, timestamp.time, timestamp.date]);
    u32(out, [entry.crc32, entry.bytes.length, entry.bytes.length]);
    u16(out, [entry.name.length, 0, 0, 0, 0]);
    u32(out, [((0o10_0000 | entry.mode) << 16) >>> 0, offset]);
    out.bytes(entry.name);
  }
  const centralSize = out.length - centralOffset;
  u32(out, [end]);
  u16(out, [0, 0, entries.length, entries.length]);
  u32(out, [centralSize, centralOffset]);
  u16(out, [0]);
  return out.result();
}

function validate(input: ReleasePayloadInput): Entry {
  const mode = isBinaryPath(input.path) ? 0o755 : 0o644;
  if (!isSafePath(input.path)) throw new Error(`unsafe ZIP path: ${input.path}`);
  if (!isAllowedPath(input.path)) throw new Error(`ZIP path is not allowed: ${input.path}`);
  if (input.mode !== mode) throw new Error(`invalid mode for ${input.path}`);
  const name = text.encode(input.path);
  size(input.bytes.length, "payload size");
  return { bytes: new Uint8Array(input.bytes), crc32: crc32(input.bytes), mode, name, path: input.path };
}

function isSafePath(path: string): boolean {
  return (
    path.length > 0 &&
    !path.startsWith("/") &&
    !path.includes("\\") &&
    !path.includes("\0") &&
    path.split("/").every((part) => part.length > 0 && part !== "." && part !== "..")
  );
}
function isAllowedPath(path: string): boolean {
  return path === "README.md" || path === "manifest.json" || isBinaryPath(path);
}
function isBinaryPath(path: string): path is `bin/mm-crypto-bot-${ReleaseApp}` {
  return path === "bin/mm-crypto-bot-bot" || path === "bin/mm-crypto-bot-config-search";
}
function compare(left: Entry, right: Entry): number {
  return left.path < right.path ? -1 : left.path > right.path ? 1 : 0;
}
function dosTimestamp(epoch: number): DosTimestamp {
  if (!Number.isSafeInteger(epoch)) throw new Error("SOURCE_DATE_EPOCH must be an exact integer");
  const value = epoch - (epoch % 2);
  if (value < minEpoch || value > maxEpoch) throw new Error("SOURCE_DATE_EPOCH is outside the ZIP DOS range");
  const date = new Date(value * 1000);
  return {
    date: ((date.getUTCFullYear() - 1980) << 9) | ((date.getUTCMonth() + 1) << 5) | date.getUTCDate(),
    time: (date.getUTCHours() << 11) | (date.getUTCMinutes() << 5) | (date.getUTCSeconds() >> 1),
  };
}
function size(value: number, label: string): void {
  assertZipU16(value, label);
}
function u16(writer: Writer, values: readonly number[]): void {
  for (const value of values) {
    size(value, "ZIP integer");
    writer.u16(value);
  }
}
function u32(writer: Writer, values: readonly number[]): void {
  for (const value of values) {
    assertZipU32(value, "ZIP integer");
    writer.u32(value);
  }
}
export function assertZipU16(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xff_fe)
    throw new RangeError(`${label} requires ZIP64`);
}
export function assertZipU32(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xff_ff_ff_fe)
    throw new RangeError(`${label} requires ZIP64`);
}
function crc32(bytes: Uint8Array): number {
  let crc = 0xff_ff_ff_ff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xed_b8_83_20 : 0);
  }
  return (crc ^ 0xff_ff_ff_ff) >>> 0;
}
class Writer {
  readonly #data: number[] = [];
  get length(): number {
    return this.#data.length;
  }
  u16(value: number): void {
    this.#data.push(value & 255, (value >>> 8) & 255);
  }
  u32(value: number): void {
    this.#data.push(value & 255, (value >>> 8) & 255, (value >>> 16) & 255, (value >>> 24) & 255);
  }
  bytes(value: Uint8Array): void {
    this.#data.push(...value);
  }
  result(): Uint8Array {
    return new Uint8Array(this.#data);
  }
}
