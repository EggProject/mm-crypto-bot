import { canonicalJson, formatSha256Sidecar, parseSha256Sidecar, sha256Hex } from "./release-contract";

interface TestExpectation {
  toBe(expected: unknown): void;
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

describe("release contract helpers", () => {
  test("canonical JSON sorts record keys recursively and ends with one LF", () => {
    // eslint-disable-next-line unicorn/no-null -- canonical JSON must accept null.
    expect(canonicalJson({ z: [true, { b: 2, a: 1 }], a: null })).toBe(
      '{\n  "a": null,\n  "z": [\n    true,\n    {\n      "a": 1,\n      "b": 2\n    }\n  ]\n}\n',
    );
  });

  test("canonical JSON uses deterministic UTF-16 code-unit ordering for non-ASCII keys", () => {
    expect(canonicalJson({ "\u{E000}": 1, "😀": 2 })).toBe('{\n  "😀": 2,\n  "": 1\n}\n');
  });

  test("canonical JSON rejects values outside its exact data domain", () => {
    expect(() => canonicalJson(1.5)).toThrow("integer");
    expect(() => canonicalJson(NaN)).toThrow("finite");
    expect(() => canonicalJson(new Date(0))).toThrow("plain record");
    expect(() => canonicalJson(undefined)).toThrow("plain record");
  });

  test("SHA-256 uses lowercase hexadecimal", () => {
    expect(sha256Hex(new TextEncoder().encode("abc"))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  test("sidecar formatting and parsing require one exact ASCII line", () => {
    const digest = "a".repeat(64);
    const sidecar = `${digest}  sample.zip\n`;

    expect(formatSha256Sidecar(digest, "sample.zip")).toBe(sidecar);
    expect(parseSha256Sidecar(new TextEncoder().encode(sidecar))).toEqual({
      sha256: digest,
      zipBasename: "sample.zip",
    });
  });

  test("sidecar parsing rejects malformed digest, whitespace, and filename", () => {
    expect(() => formatSha256Sidecar("A".repeat(64), "x.zip")).toThrow("sidecar");
    expect(() => parseSha256Sidecar(new TextEncoder().encode("A".repeat(64) + "  x.zip\n"))).toThrow(
      "sidecar",
    );
    expect(() => parseSha256Sidecar(new TextEncoder().encode("a".repeat(64) + " x.zip\n"))).toThrow(
      "sidecar",
    );
    expect(() => parseSha256Sidecar(new TextEncoder().encode("a".repeat(64) + "  dir/x.zip\n"))).toThrow(
      "sidecar",
    );
  });

  test("sidecar formatting and parsing reject non-ASCII, control, and path basenames", () => {
    const digest = "a".repeat(64);
    const invalidBasenames = [
      "caf\u{E9}.zip",
      "bad\0.zip",
      "bad\u{1F}.zip",
      "bad\r.zip",
      "bad\n.zip",
      "dir/x.zip",
      String.raw`dir\x.zip`,
      "x",
      "not-a-zip",
    ];

    for (const basename of invalidBasenames) {
      expect(() => formatSha256Sidecar(digest, basename)).toThrow("sidecar");
      expect(() => parseSha256Sidecar(new TextEncoder().encode(`${digest}  ${basename}\n`))).toThrow(
        "sidecar",
      );
    }
  });
});
