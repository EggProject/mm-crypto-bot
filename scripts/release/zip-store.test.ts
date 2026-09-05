import type { ReleasePayloadInput } from "./release-contract";
import { encodeStoreZip, normalizedDosTimestamp, parseStoreZip } from "./zip-store";
import { assertZipU16, assertZipU32, calculateStoreZip32Layout } from "./zip-store-encoder";

interface TestExpectation {
  toEqual(expected: unknown): void;
  toThrow(expected?: string | RegExp): void;
}

interface TestRuntimeApi {
  describe(name: string, run: () => void): void;
  expect(actual: unknown): TestExpectation;
  test(name: string, run: () => void): void;
}

const isRecord = (candidate: unknown): candidate is Record<string, unknown> =>
  typeof candidate === "object" && candidate !== null;

const isTestRuntimeApi = (candidate: unknown): candidate is TestRuntimeApi => {
  if (!isRecord(candidate)) {
    return false;
  }
  const { describe, expect, test } = candidate;
  return typeof describe === "function" && typeof expect === "function" && typeof test === "function";
};

const testRuntime: unknown = await import(typeof Bun === "undefined" ? "vitest" : "bun:test");
if (!isTestRuntimeApi(testRuntime)) {
  throw new Error("The selected test runtime does not expose the required API.");
}

const describe = (name: string, run: () => void): void => {
  testRuntime.describe(name, run);
};
const expect = (actual: unknown): TestExpectation => testRuntime.expect(actual);
const test = (name: string, run: () => void): void => {
  testRuntime.test(name, run);
};

const encoder = new TextEncoder();
const DOS_EPOCH = 315_532_800;

function payload(path: string, mode: 0o644 | 0o755, text = ""): ReleasePayloadInput {
  return { bytes: encoder.encode(text), mode, path };
}

function binaryPayload(path: string, bytes: Uint8Array): ReleasePayloadInput {
  return { bytes, mode: 0o755, path };
}

function mutatingCopy(bytes: Uint8Array, offset: number, value: number): Uint8Array {
  const copy = new Uint8Array(bytes);
  // eslint-disable-next-line security/detect-object-injection -- test mutation offset is controlled by fixture layout.
  copy[offset] = value;
  return copy;
}

function writeU16(bytes: Uint8Array, offset: number, value: number): Uint8Array {
  return mutatingCopy(mutatingCopy(bytes, offset, value & 0xff), offset + 1, value >>> 8);
}

function writeU32(bytes: Uint8Array, offset: number, value: number): Uint8Array {
  let mutated = bytes;
  for (let index = 0; index < 4; index += 1) {
    mutated = mutatingCopy(mutated, offset + index, (value >>> (index * 8)) & 0xff);
  }
  return mutated;
}

function replaceBytes(bytes: Uint8Array, start: number, end: number, replacement: Uint8Array): Uint8Array {
  const result = new Uint8Array(bytes.length - (end - start) + replacement.length);
  result.set(bytes.slice(0, start));
  result.set(replacement, start);
  result.set(bytes.slice(end), start + replacement.length);
  return result;
}

function readU16(bytes: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 2 > bytes.length) {
    throw new Error("test fixture is truncated");
  }
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(offset, true);
}

function readU32(bytes: Uint8Array, offset: number): number {
  return readU16(bytes, offset) | (readU16(bytes, offset + 2) << 16);
}

function eocdOffset(bytes: Uint8Array): number {
  return bytes.length - 22;
}

function centralOffset(bytes: Uint8Array): number {
  return readU32(bytes, eocdOffset(bytes) + 16) >>> 0;
}

function centralSize(bytes: Uint8Array): number {
  return readU32(bytes, eocdOffset(bytes) + 12) >>> 0;
}

function centralRecordLength(bytes: Uint8Array, offset: number): number {
  return 46 + readU16(bytes, offset + 28);
}

function malformedDuplicateCentralNames(archive: Uint8Array): Uint8Array {
  const directoryOffset = centralOffset(archive);
  const secondRecordOffset = directoryOffset + centralRecordLength(archive, directoryOffset);
  const originalNameLength = readU16(archive, secondRecordOffset + 28);
  const replacementName = encoder.encode("README.md");
  let mutated = replaceBytes(
    archive,
    secondRecordOffset + 46,
    secondRecordOffset + 46 + originalNameLength,
    replacementName,
  );
  mutated = writeU16(mutated, secondRecordOffset + 28, replacementName.length);
  return writeU32(
    mutated,
    eocdOffset(mutated) + 12,
    centralSize(archive) - (originalNameLength - replacementName.length),
  );
}

function localNameThatDiffersFromCentral(archive: Uint8Array): Uint8Array {
  const replacementName = encoder.encode("bin/mm-crypto-bot-bot");
  const originalNameLength = readU16(archive, 26);
  let mutated = replaceBytes(archive, 30, 30 + originalNameLength, replacementName);
  mutated = writeU16(mutated, 26, replacementName.length);
  return writeU32(
    mutated,
    eocdOffset(mutated) + 16,
    centralOffset(archive) + replacementName.length - originalNameLength,
  );
}

function reverseCentralDirectoryEntries(archive: Uint8Array): Uint8Array {
  const directoryOffset = centralOffset(archive);
  const firstLength = centralRecordLength(archive, directoryOffset);
  const directoryEnd = directoryOffset + centralSize(archive);
  const first = archive.slice(directoryOffset, directoryOffset + firstLength);
  const second = archive.slice(directoryOffset + firstLength, directoryEnd);
  const reversed = new Uint8Array(second.length + first.length);
  reversed.set(second);
  reversed.set(first, second.length);
  return replaceBytes(archive, directoryOffset, directoryEnd, reversed);
}

function differingSecondEntryTimestamp(archive: Uint8Array): Uint8Array {
  const directoryOffset = centralOffset(archive);
  const secondRecordOffset = directoryOffset + centralRecordLength(archive, directoryOffset);
  const secondLocalOffset = readU32(archive, secondRecordOffset + 42) >>> 0;
  let mutated = writeU16(archive, secondRecordOffset + 12, 1);
  mutated = writeU16(mutated, secondLocalOffset + 10, 1);
  return mutated;
}

function zip64CentralSize(archive: Uint8Array): Uint8Array {
  let mutated = archive;
  for (const offset of [archive.length - 10, archive.length - 9, archive.length - 8, archive.length - 7]) {
    mutated = mutatingCopy(mutated, offset, 0xff);
  }
  return mutated;
}

describe("deterministic ZIP STORE encoding", () => {
  test("rejects every out-of-range LE integer primitive without allocation", () => {
    for (const value of [-1, 1.5, 0xff_ff]) {
      expect(() => {
        assertZipU16(value, "field");
      }).toThrow("ZIP64");
    }
    for (const value of [-1, 1.5, 0xff_ff_ff_ff]) {
      expect(() => {
        assertZipU32(value, "field");
      }).toThrow("ZIP64");
    }
    assertZipU16(0xff_fe, "field");
    assertZipU32(0xff_ff_ff_fe, "field");
  });
  test("writes the fixed empty README fixture with Unix mode and STORE metadata", () => {
    const archive = encodeStoreZip([payload("README.md", 0o644)], DOS_EPOCH);

    expect(archive).toEqual(
      new Uint8Array([
        0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x21, 0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x09, 0x00, 0x00, 0x00, 0x52, 0x45, 0x41, 0x44,
        0x4d, 0x45, 0x2e, 0x6d, 0x64, 0x50, 0x4b, 0x01, 0x02, 0x14, 0x03, 0x14, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x21, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x09,
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xa4, 0x81, 0x00, 0x00, 0x00, 0x00,
        0x52, 0x45, 0x41, 0x44, 0x4d, 0x45, 0x2e, 0x6d, 0x64, 0x50, 0x4b, 0x05, 0x06, 0x00, 0x00, 0x00, 0x00,
        0x01, 0x00, 0x01, 0x00, 0x37, 0x00, 0x00, 0x00, 0x27, 0x00, 0x00, 0x00, 0x00, 0x00,
      ]),
    );
  });

  test("encodes an executable payload larger than the U16 ZIP field limit with U32 sizes", () => {
    const executable = new Uint8Array(65_535);
    executable[0] = 0x7f;
    const archive = encodeStoreZip([binaryPayload("bin/mm-crypto-bot-bot", executable)], DOS_EPOCH);
    const directoryOffset = centralOffset(archive);

    expect({
      centralCompressedSize: readU32(archive, directoryOffset + 20) >>> 0,
      centralUncompressedSize: readU32(archive, directoryOffset + 24) >>> 0,
      localCompressedSize: readU32(archive, 18) >>> 0,
      localUncompressedSize: readU32(archive, 22) >>> 0,
    }).toEqual({
      centralCompressedSize: 65_535,
      centralUncompressedSize: 65_535,
      localCompressedSize: 65_535,
      localUncompressedSize: 65_535,
    });
    expect(
      parseStoreZip(archive).entries.map(({ bytes, mode, path }) => ({
        byteLength: bytes.byteLength,
        mode,
        path,
      })),
    ).toEqual([{ byteLength: 65_535, mode: 0o755, path: "bin/mm-crypto-bot-bot" }]);
  });

  test("rejects ZIP32 layouts whose local, central, or archive extents reach a ZIP64 sentinel", () => {
    expect(() => calculateStoreZip32Layout([{ nameLength: 1, payloadLength: 0xff_ff_ff_e0 }])).toThrow(
      "local file data extent",
    );
    expect(() => calculateStoreZip32Layout([{ nameLength: 1, payloadLength: 0xff_ff_ff_df }])).toThrow(
      "central directory extent",
    );
    expect(() => calculateStoreZip32Layout([{ nameLength: 1, payloadLength: 0xff_ff_ff_b0 }])).toThrow(
      "archive extent",
    );
  });

  test("sorts entries and preserves CRC, payload bytes, and exact modes", () => {
    const archive = encodeStoreZip(
      [
        payload("manifest.json", 0o644, "{}\n"),
        payload("bin/mm-crypto-bot-bot", 0o755, "run"),
        payload("README.md", 0o644, "read\n"),
      ],
      DOS_EPOCH,
    );

    expect(parseStoreZip(archive).entries).toEqual([
      { bytes: encoder.encode("read\n"), crc32: 3_784_942_889, mode: 0o644, path: "README.md" },
      { bytes: encoder.encode("run"), crc32: 1_349_952_704, mode: 0o755, path: "bin/mm-crypto-bot-bot" },
      { bytes: encoder.encode("{}\n"), crc32: 3_718_361_094, mode: 0o644, path: "manifest.json" },
    ]);
  });

  test("normalizes odd source epoch identically in local and central headers", () => {
    const epoch = 1_788_199_915;
    const archive = encodeStoreZip([payload("README.md", 0o644)], epoch);

    expect(parseStoreZip(archive).localAndCentralDosTimestamps).toEqual({
      central: normalizedDosTimestamp(epoch),
      local: normalizedDosTimestamp(epoch),
    });
  });

  test("rejects unsafe, unknown, duplicate, and noncanonical payloads", () => {
    const invalidPaths = [
      "",
      "/README.md",
      String.raw`README\.md`,
      "README\u{0}.md",
      ".",
      "../README.md",
      "a/./b",
    ];

    for (const path of invalidPaths) {
      expect(() => encodeStoreZip([payload(path, 0o644)], DOS_EPOCH)).toThrow("unsafe");
    }
    expect(() => encodeStoreZip([payload("source.ts", 0o644)], DOS_EPOCH)).toThrow("allowed");
    expect(() =>
      encodeStoreZip([payload("README.md", 0o644), payload("README.md", 0o644)], DOS_EPOCH),
    ).toThrow("duplicate");
    expect(() => encodeStoreZip([payload("README.md", 0o755)], DOS_EPOCH)).toThrow("mode");
    expect(() => encodeStoreZip([payload("bin/mm-crypto-bot-bot", 0o644)], DOS_EPOCH)).toThrow("mode");
  });

  test("rejects noninteger and DOS-range source epochs after exact normalization", () => {
    expect(() => encodeStoreZip([payload("README.md", 0o644)], 1.5)).toThrow("integer");
    expect(() => encodeStoreZip([payload("README.md", 0o644)], DOS_EPOCH - 1)).toThrow("DOS");
    expect(() => encodeStoreZip([payload("README.md", 0o644)], 4_354_819_200)).toThrow("DOS");
  });

  test("rejects a non-ASCII payload path before emitting ZIP bytes", () => {
    expect(() => encodeStoreZip([payload("README.md\u{301}", 0o644)], DOS_EPOCH)).toThrow("allowed");
  });
});

describe("independent ZIP STORE parsing", () => {
  test("rejects an archive that is shorter than its end-directory record", () => {
    expect(() => parseStoreZip(new Uint8Array())).toThrow("end of central directory signature");
  });

  test("rejects noninteger and out-of-range parsed DOS timestamp source epochs", () => {
    expect(() => normalizedDosTimestamp(1.5)).toThrow("integer");
    expect(() => normalizedDosTimestamp(DOS_EPOCH - 1)).toThrow("DOS");
  });

  test("rejects malformed local, central, and end-directory metadata through public bytes", () => {
    const archive = encodeStoreZip([payload("README.md", 0o644, "x")], DOS_EPOCH);
    const central = 40;
    const end = archive.length - 22;
    const cases: readonly [number, number][] = [
      [end + 4, 1],
      [end + 16, 1],
      [central, 0],
      [central + 6, 21],
      [central + 34, 1],
      [central + 36, 1],
      [central + 20, 0xff],
      [0, 0],
      [4, 21],
      [6, 1],
      [10, 1],
      [18, 2],
      [30, 0x4d],
    ];
    for (const [offset, value] of cases) {
      expect(() => {
        parseStoreZip(mutatingCopy(archive, offset, value));
      }).toThrow();
    }
  });

  test("parses a structurally valid empty STORE archive without writer validation", () => {
    const archive = encodeStoreZip([], DOS_EPOCH);

    expect(parseStoreZip(archive)).toEqual({
      entries: [],
      localAndCentralDosTimestamps: {
        central: { date: 0, time: 0 },
        local: { date: 0, time: 0 },
      },
    });
  });

  test("rejects invalid signatures, compression, fields, descriptors, comments, and ZIP64", () => {
    const archive = encodeStoreZip([payload("README.md", 0o644)], DOS_EPOCH);
    const centralOffset = 39;

    expect(() => parseStoreZip(mutatingCopy(archive, 0, 0))).toThrow("signature");
    expect(() => parseStoreZip(mutatingCopy(archive, 8, 8))).toThrow("compression");
    expect(() => parseStoreZip(mutatingCopy(archive, 28, 1))).toThrow("extra");
    expect(() => parseStoreZip(mutatingCopy(archive, 6, 8))).toThrow("descriptor");
    expect(() => parseStoreZip(mutatingCopy(archive, archive.length - 2, 1))).toThrow("comment");
    const zip64Size = zip64CentralSize(archive);
    expect(() => parseStoreZip(zip64Size)).toThrow("ZIP64");
    expect(() => parseStoreZip(mutatingCopy(archive, centralOffset + 42, 0xff))).toThrow("offset");
  });

  test("rejects local-central metadata mismatches, unsafe paths, duplicate paths, and mode drift", () => {
    const archive = encodeStoreZip(
      [payload("README.md", 0o644), payload("manifest.json", 0o644, "{}\n")],
      DOS_EPOCH,
    );
    const centralOffset = 85;

    const corruptCrc = mutatingCopy(mutatingCopy(archive, 14, 1), centralOffset + 16, 1);
    expect(() => parseStoreZip(corruptCrc)).toThrow("CRC");
    expect(() => parseStoreZip(mutatingCopy(archive, centralOffset + 46, 0x2f))).toThrow("unsafe");
    expect(() => parseStoreZip(mutatingCopy(archive, centralOffset + 46, 0xff))).toThrow("utf8");
    expect(() => parseStoreZip(mutatingCopy(archive, centralOffset + 40, 0xed))).toThrow("mode");
  });

  test("rejects central metadata variants and malformed central directory records", () => {
    const archive = encodeStoreZip([payload("README.md", 0o644)], DOS_EPOCH);
    const directoryOffset = centralOffset(archive);

    expect(() => parseStoreZip(mutatingCopy(archive, directoryOffset + 10, 8))).toThrow("compression");
    expect(() => parseStoreZip(mutatingCopy(archive, directoryOffset + 30, 1))).toThrow("extra");
    expect(() => parseStoreZip(mutatingCopy(archive, directoryOffset + 32, 1))).toThrow("comments");
    expect(() => parseStoreZip(writeU32(archive, directoryOffset + 20, 0xff_ff_ff_ff))).toThrow("ZIP64");
    let oversizedDirectory = replaceBytes(
      archive,
      eocdOffset(archive),
      eocdOffset(archive),
      new Uint8Array([0]),
    );
    oversizedDirectory = writeU32(
      oversizedDirectory,
      eocdOffset(oversizedDirectory) + 12,
      centralSize(archive) + 1,
    );
    expect(() => parseStoreZip(oversizedDirectory)).toThrow("central directory size");
    expect(() => parseStoreZip(writeU16(archive, directoryOffset + 28, 0xff))).toThrow("truncated");
  });

  test("rejects unsafe central path components and duplicate central paths", () => {
    const oneEntry = encodeStoreZip([payload("README.md", 0o644)], DOS_EPOCH);
    const unsafeComponent = replaceBytes(
      oneEntry,
      centralOffset(oneEntry) + 46,
      centralOffset(oneEntry) + 55,
      encoder.encode("./......."),
    );
    expect(() => parseStoreZip(unsafeComponent)).toThrow("unsafe");

    const twoEntries = encodeStoreZip(
      [payload("README.md", 0o644), payload("manifest.json", 0o644)],
      DOS_EPOCH,
    );
    expect(() => parseStoreZip(malformedDuplicateCentralNames(twoEntries))).toThrow("duplicate");
  });

  test("rejects local names and metadata that differ from their central counterparts", () => {
    const archive = encodeStoreZip([payload("README.md", 0o644)], DOS_EPOCH);
    expect(() => parseStoreZip(localNameThatDiffersFromCentral(archive))).toThrow("paths differ");

    const changedSize = writeU32(writeU32(archive, 18, 1), centralOffset(archive) + 20, 1);
    expect(() => parseStoreZip(changedSize)).toThrow("STORE size mismatch");
  });

  test("rejects nonempty local space in an otherwise empty archive", () => {
    const archive = encodeStoreZip([], DOS_EPOCH);
    let mutated = replaceBytes(archive, 0, 0, new Uint8Array([0]));
    mutated = writeU32(mutated, eocdOffset(mutated) + 16, 1);
    expect(() => parseStoreZip(mutated)).toThrow("overlap");
  });

  test("rejects central directory entries that are not UTF-16 sorted", () => {
    const archive = encodeStoreZip([payload("README.md", 0o644), payload("manifest.json", 0o644)], DOS_EPOCH);
    expect(() => parseStoreZip(reverseCentralDirectoryEntries(archive))).toThrow("sorted");
  });

  test("rejects a central directory record that ends before all fixed fields", () => {
    const empty = encodeStoreZip([], DOS_EPOCH);
    let malformed = replaceBytes(empty, 0, 0, new Uint8Array([0x50, 0x4b, 0x01, 0x02]));
    const end = eocdOffset(malformed);
    malformed = writeU16(malformed, end + 8, 0x21);
    malformed = writeU16(malformed, end + 10, 0x21);
    malformed = writeU32(malformed, end + 12, 4);
    malformed = writeU32(malformed, end + 16, 0);
    expect(() => parseStoreZip(malformed)).toThrow("truncated ZIP central directory");
  });

  test("rejects invalid local and central DOS timestamp fields", () => {
    const archive = encodeStoreZip([payload("README.md", 0o644)], DOS_EPOCH);
    const directoryOffset = centralOffset(archive);
    const cases: readonly [number, number][] = [
      [10, 24 << 11],
      [12, 0],
      [directoryOffset + 12, 60 << 5],
      [directoryOffset + 14, 0],
    ];

    for (const [offset, value] of cases) {
      expect(() => parseStoreZip(writeU16(archive, offset, value))).toThrow("DOS timestamp");
    }
  });

  test("rejects a later local and central timestamp that differs from the common archive timestamp", () => {
    const archive = encodeStoreZip([payload("README.md", 0o644), payload("manifest.json", 0o644)], DOS_EPOCH);
    expect(() => parseStoreZip(differingSecondEntryTimestamp(archive))).toThrow("common timestamp");
  });
});
