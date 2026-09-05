import type { ReleaseApplication as ReleaseApp } from "./release-contract";
export { encodeStoreZip } from "./zip-store-encoder";

const localFileHeaderSignature = 0x04_03_4b_50;
const centralDirectorySignature = 0x02_01_4b_50;
const endOfCentralDirectorySignature = 0x06_05_4b_50;
const zipVersion = 20;
const unixCreator = 3;
const fileTypeRegular = 0o10_0000;
const minimumDosEpoch = 315_532_800;
const maximumDosEpoch = 4_354_819_199;
const decoder = new TextDecoder("utf-8", { fatal: true });

export interface DosTimestamp {
  readonly date: number;
  readonly time: number;
}

export interface ParsedStoreZipEntry {
  readonly bytes: Uint8Array;
  readonly crc32: number;
  readonly mode: 0o644 | 0o755;
  readonly path: string;
}

export interface ParsedStoreZip {
  readonly entries: readonly ParsedStoreZipEntry[];
  readonly localAndCentralDosTimestamps: {
    readonly central: DosTimestamp;
    readonly local: DosTimestamp;
  };
}

interface CentralEntry {
  readonly compressedSize: number;
  readonly crc32: number;
  readonly localHeaderOffset: number;
  readonly mode: 0o644 | 0o755;
  readonly name: Uint8Array;
  readonly path: string;
  readonly size: number;
  readonly timestamp: DosTimestamp;
}

export function parseStoreZip(bytes: Uint8Array): ParsedStoreZip {
  const eocdOffset = bytes.length - 22;
  if (
    eocdOffset < 0 ||
    readU32(bytes, eocdOffset, "end of central directory") !== endOfCentralDirectorySignature
  ) {
    throw new Error("invalid ZIP end of central directory signature");
  }
  const diskNumber = readU16(bytes, eocdOffset + 4, "end of central directory");
  const centralStartDisk = readU16(bytes, eocdOffset + 6, "end of central directory");
  const diskEntries = readU16(bytes, eocdOffset + 8, "end of central directory");
  const entryCount = readU16(bytes, eocdOffset + 10, "end of central directory");
  const centralSize = readU32(bytes, eocdOffset + 12, "end of central directory");
  const centralOffset = readU32(bytes, eocdOffset + 16, "end of central directory");
  const commentLength = readU16(bytes, eocdOffset + 20, "end of central directory");
  if (commentLength !== 0) {
    throw new Error("ZIP comment is forbidden");
  }
  if (entryCount === 0xff_ff || centralSize === 0xff_ff_ff_ff || centralOffset === 0xff_ff_ff_ff) {
    throw new Error("ZIP64 archives are unsupported");
  }
  if (diskNumber !== 0 || centralStartDisk !== 0 || diskEntries !== entryCount) {
    throw new Error("multi-disk ZIP archives are unsupported");
  }
  if (centralOffset + centralSize !== eocdOffset || centralOffset > eocdOffset) {
    throw new Error("invalid central directory bounds");
  }

  const centralEntries = parseCentralDirectory(bytes, centralOffset, centralSize, entryCount);
  assertCommonTimestamp(centralEntries);
  const localEntries = parseLocalEntries(bytes, centralEntries, centralOffset);
  const timestamps = collectTimestampPair(centralEntries);
  return Object.freeze({ entries: Object.freeze(localEntries), localAndCentralDosTimestamps: timestamps });
}

export function normalizedDosTimestamp(sourceDateEpoch: number): DosTimestamp {
  if (!Number.isSafeInteger(sourceDateEpoch)) {
    throw new TypeError("SOURCE_DATE_EPOCH must be an exact integer");
  }
  const normalized = sourceDateEpoch - (sourceDateEpoch % 2);
  if (normalized < minimumDosEpoch || normalized > maximumDosEpoch) {
    throw new Error("SOURCE_DATE_EPOCH is outside the ZIP DOS range");
  }
  const date = new Date(normalized * 1000);
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;
  const day = date.getUTCDate();
  const hour = date.getUTCHours();
  const minute = date.getUTCMinutes();
  const second = date.getUTCSeconds();
  return Object.freeze({
    date: ((year - 1980) << 9) | (month << 5) | day,
    time: (hour << 11) | (minute << 5) | (second >> 1),
  });
}

function assertSafeAllowedPath(path: string): void {
  if (path.length === 0 || path.startsWith("/") || path.includes("\\") || path.includes("\0")) {
    throw new Error(`unsafe ZIP path: ${path}`);
  }
  const components = path.split("/");
  if (components.some((component) => component.length === 0 || component === "." || component === "..")) {
    throw new Error(`unsafe ZIP path: ${path}`);
  }
  if (path !== "README.md" && path !== "manifest.json" && !isBinaryPath(path)) {
    throw new Error(`ZIP path is not allowed: ${path}`);
  }
}

function expectedModeForPath(path: string): 0o644 | 0o755 {
  return isBinaryPath(path) ? 0o755 : 0o644;
}

function isBinaryPath(path: string): path is `bin/mm-crypto-bot-${ReleaseApp}` {
  return path === "bin/mm-crypto-bot-bot" || path === "bin/mm-crypto-bot-config-search";
}

function assertNoDuplicatePaths(entries: readonly { readonly path: string }[]): void {
  let previousPath: string | undefined;
  for (const entry of entries) {
    if (previousPath === entry.path) {
      throw new Error(`duplicate ZIP path: ${entry.path}`);
    }
    previousPath = entry.path;
  }
}

function parseCentralDirectory(
  bytes: Uint8Array,
  offset: number,
  size: number,
  count: number,
): readonly CentralEntry[] {
  const entries: CentralEntry[] = [];
  let cursor = offset;
  for (let index = 0; index < count; index += 1) {
    if (readU32(bytes, cursor, "central directory") !== centralDirectorySignature) {
      throw new Error("invalid ZIP central directory signature");
    }
    const creatorVersion = readU16(bytes, cursor + 4, "central directory");
    const requiredVersion = readU16(bytes, cursor + 6, "central directory");
    const flags = readU16(bytes, cursor + 8, "central directory");
    const compression = readU16(bytes, cursor + 10, "central directory");
    const timestamp = readTimestamp(bytes, cursor + 12, "central directory");
    const crc = readU32(bytes, cursor + 16, "central directory");
    const compressedSize = readU32(bytes, cursor + 20, "central directory");
    const sizeValue = readU32(bytes, cursor + 24, "central directory");
    const nameLength = readU16(bytes, cursor + 28, "central directory");
    const extraLength = readU16(bytes, cursor + 30, "central directory");
    const commentLength = readU16(bytes, cursor + 32, "central directory");
    const diskStart = readU16(bytes, cursor + 34, "central directory");
    const internalAttributes = readU16(bytes, cursor + 36, "central directory");
    const externalAttributes = readU32(bytes, cursor + 38, "central directory");
    const localHeaderOffset = readU32(bytes, cursor + 42, "central directory");
    assertFixedCentralMetadata(
      creatorVersion,
      requiredVersion,
      flags,
      compression,
      extraLength,
      commentLength,
      diskStart,
      internalAttributes,
    );
    if (
      compressedSize === 0xff_ff_ff_ff ||
      sizeValue === 0xff_ff_ff_ff ||
      localHeaderOffset === 0xff_ff_ff_ff
    ) {
      throw new Error("ZIP64 fields are unsupported");
    }
    const name = sliceExact(bytes, cursor + 46, nameLength, "central directory filename");
    const path = decodePath(name, "central directory");
    assertSafeAllowedPath(path);
    const mode = parseMode(externalAttributes, path);
    entries.push(
      Object.freeze({
        compressedSize,
        crc32: crc,
        localHeaderOffset,
        mode,
        name,
        path,
        size: sizeValue,
        timestamp,
      }),
    );
    cursor += 46 + nameLength;
  }
  if (cursor !== offset + size) {
    throw new Error("invalid ZIP central directory size");
  }
  assertNoDuplicatePaths(entries);
  assertSortedPaths(entries);
  return Object.freeze(entries);
}

function parseLocalEntries(
  bytes: Uint8Array,
  centralEntries: readonly CentralEntry[],
  centralOffset: number,
): readonly ParsedStoreZipEntry[] {
  const entries: ParsedStoreZipEntry[] = [];
  let cursor = 0;
  for (const centralEntry of centralEntries) {
    if (centralEntry.localHeaderOffset !== cursor) {
      throw new Error("invalid ZIP local header offset");
    }
    if (readU32(bytes, cursor, "local file header") !== localFileHeaderSignature) {
      throw new Error("invalid ZIP local file header signature");
    }
    const requiredVersion = readU16(bytes, cursor + 4, "local file header");
    const flags = readU16(bytes, cursor + 6, "local file header");
    const compression = readU16(bytes, cursor + 8, "local file header");
    const timestamp = readTimestamp(bytes, cursor + 10, "local file header");
    const crc = readU32(bytes, cursor + 14, "local file header");
    const compressedSize = readU32(bytes, cursor + 18, "local file header");
    const size = readU32(bytes, cursor + 22, "local file header");
    const nameLength = readU16(bytes, cursor + 26, "local file header");
    const extraLength = readU16(bytes, cursor + 28, "local file header");
    assertFixedLocalMetadata(requiredVersion, flags, compression, extraLength);
    const name = sliceExact(bytes, cursor + 30, nameLength, "local filename");
    const path = decodePath(name, "local file header");
    assertSafeAllowedPath(path);
    if (!isSameBytes(name, centralEntry.name) || path !== centralEntry.path) {
      throw new Error("local and central ZIP paths differ");
    }
    if (
      crc !== centralEntry.crc32 ||
      compressedSize !== centralEntry.compressedSize ||
      size !== centralEntry.size
    ) {
      throw new Error("local and central ZIP metadata differ");
    }
    if (timestamp.date !== centralEntry.timestamp.date || timestamp.time !== centralEntry.timestamp.time) {
      throw new Error("local and central ZIP timestamps differ");
    }
    if (compressedSize !== size) {
      throw new Error("ZIP STORE size mismatch");
    }
    const payloadOffset = cursor + 30 + nameLength;
    const payload = sliceExact(bytes, payloadOffset, size, "ZIP payload");
    if (crc32(payload) !== crc) {
      throw new Error("ZIP CRC mismatch");
    }
    entries.push(
      Object.freeze({ bytes: new Uint8Array(payload), crc32: crc, mode: centralEntry.mode, path }),
    );
    cursor = payloadOffset + size;
  }
  if (cursor !== centralOffset) {
    throw new Error("ZIP local entries overlap central directory");
  }
  return entries;
}

function collectTimestampPair(
  centralEntries: readonly CentralEntry[],
): ParsedStoreZip["localAndCentralDosTimestamps"] {
  const first = centralEntries[0];
  if (first === undefined) {
    return Object.freeze({
      central: Object.freeze({ date: 0, time: 0 }),
      local: Object.freeze({ date: 0, time: 0 }),
    });
  }
  const timestamp = Object.freeze({ date: first.timestamp.date, time: first.timestamp.time });
  return Object.freeze({
    central: timestamp,
    local: Object.freeze({ date: timestamp.date, time: timestamp.time }),
  });
}

function assertCommonTimestamp(entries: readonly CentralEntry[]): void {
  const first = entries[0];
  if (first === undefined) {
    return;
  }
  const commonTimestamp = timestampKey(first.timestamp);
  for (const entry of entries) {
    if (timestampKey(entry.timestamp) !== commonTimestamp) {
      throw new Error("ZIP entries must share a common timestamp");
    }
  }
}

function assertFixedCentralMetadata(
  creatorVersion: number,
  requiredVersion: number,
  flags: number,
  compression: number,
  extraLength: number,
  commentLength: number,
  diskStart: number,
  internalAttributes: number,
): void {
  if (requiredVersion !== zipVersion || creatorVersion !== ((unixCreator << 8) | zipVersion)) {
    throw new Error("unsupported ZIP version");
  }
  assertNoDataDescriptor(flags);
  if (compression !== 0) {
    throw new Error("ZIP compression is forbidden");
  }
  if (extraLength !== 0) {
    throw new Error("ZIP extra fields are forbidden");
  }
  if (commentLength !== 0) {
    throw new Error("ZIP comments are forbidden");
  }
  if (diskStart !== 0 || internalAttributes !== 0) {
    throw new Error("unsupported ZIP central directory attributes");
  }
}

function assertFixedLocalMetadata(
  requiredVersion: number,
  flags: number,
  compression: number,
  extraLength: number,
): void {
  if (requiredVersion !== zipVersion) {
    throw new Error("unsupported ZIP version");
  }
  assertNoDataDescriptor(flags);
  if (compression !== 0) {
    throw new Error("ZIP compression is forbidden");
  }
  if (extraLength !== 0) {
    throw new Error("ZIP extra fields are forbidden");
  }
}

function assertNoDataDescriptor(flags: number): void {
  if ((flags & 0x00_08) !== 0) {
    throw new Error("ZIP data descriptors are forbidden");
  }
  if (flags !== 0) {
    throw new Error("ZIP general purpose flags are forbidden");
  }
}

function parseMode(externalAttributes: number, path: string): 0o644 | 0o755 {
  const rawMode = externalAttributes >>> 16;
  const expected = fileTypeRegular | expectedModeForPath(path);
  if (rawMode !== expected || (externalAttributes & 0xff_ff) !== 0) {
    throw new Error(`invalid ZIP mode for ${path}`);
  }
  return expectedModeForPath(path);
}

function assertSortedPaths(entries: readonly CentralEntry[]): void {
  let previousPath: string | undefined;
  for (const entry of entries) {
    if (previousPath !== undefined && previousPath >= entry.path) {
      throw new Error("ZIP paths must be sorted");
    }
    previousPath = entry.path;
  }
}

function decodePath(bytes: Uint8Array, location: string): string {
  try {
    return decoder.decode(bytes);
  } catch {
    throw new Error(`invalid utf8 ZIP path in ${location}`);
  }
}

function readTimestamp(bytes: Uint8Array, offset: number, location: string): DosTimestamp {
  const timestamp = Object.freeze({
    date: readU16(bytes, offset + 2, location),
    time: readU16(bytes, offset, location),
  });
  if (!isValidDosTimestamp(timestamp)) {
    throw new Error(`invalid ZIP DOS timestamp in ${location}`);
  }
  return timestamp;
}

function isValidDosTimestamp(timestamp: DosTimestamp): boolean {
  const year = 1980 + (timestamp.date >>> 9);
  const month = (timestamp.date >>> 5) & 0x0f;
  const day = timestamp.date & 0x1f;
  const hour = timestamp.time >>> 11;
  const minute = (timestamp.time >>> 5) & 0x3f;
  const second = (timestamp.time & 0x1f) << 1;
  const normalized = new Date(Date.UTC(year, month - 1, day, hour, minute, second)).toISOString();
  const expected = `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-${day
    .toString()
    .padStart(2, "0")}T${hour.toString().padStart(2, "0")}:${minute
    .toString()
    .padStart(2, "0")}:${second.toString().padStart(2, "0")}.000Z`;
  return normalized === expected;
}

function timestampKey(timestamp: DosTimestamp): string {
  return `${String(timestamp.date)}:${String(timestamp.time)}`;
}

function readU16(bytes: Uint8Array, offset: number, location: string): number {
  // eslint-disable-next-line security/detect-object-injection -- offset is bounds-checked immediately below before either byte is used.
  const low = bytes[offset];
  const high = bytes[offset + 1];
  if (low === undefined || high === undefined) {
    throw new Error(`truncated ZIP ${location}`);
  }
  return low | (high << 8);
}

function readU32(bytes: Uint8Array, offset: number, location: string): number {
  const low = readU16(bytes, offset, location);
  const high = readU16(bytes, offset + 2, location);
  return (low | (high << 16)) >>> 0;
}

function sliceExact(bytes: Uint8Array, offset: number, length: number, location: string): Uint8Array {
  const end = offset + length;
  if (!Number.isSafeInteger(end) || offset < 0 || end > bytes.length) {
    throw new Error(`truncated ZIP ${location}`);
  }
  return bytes.slice(offset, end);
}

function isSameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => {
      // eslint-disable-next-line security/detect-object-injection -- index is bounded by left byte array iteration.
      return value === right[index];
    })
  );
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xff_ff_ff_ff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xed_b8_83_20 : 0);
    }
  }
  return (crc ^ 0xff_ff_ff_ff) >>> 0;
}
