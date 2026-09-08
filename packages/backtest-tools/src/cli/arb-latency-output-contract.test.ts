import { describe, expect, it } from "vitest";

import {
  ArbLatencyOutputPathError,
  ValidatedArbLatencyOutputPath,
  createArbLatencyArtifactOutputReceipt,
  parseValidatedArbLatencyOutputPath,
  type ArbLatencyArtifactOutputPort,
  type ArbLatencyOutputPathErrorCode,
} from "./arb-latency-output-contract.js";

function expectFailure(action: () => unknown, code: ArbLatencyOutputPathErrorCode): void {
  try {
    action();
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(ArbLatencyOutputPathError);
    if (error instanceof ArbLatencyOutputPathError) {
      expect(error.code).toBe(code);
    }
    return;
  }
  throw new Error(`Expected output-path operation to fail with ${code}.`);
}

function acceptOutputPort(port: ArbLatencyArtifactOutputPort): ArbLatencyArtifactOutputPort {
  return port;
}

describe("arb latency output contract", () => {
  it("parses an immutable logical JSON path and creates an exact receipt", () => {
    const outputPath = parseValidatedArbLatencyOutputPath("reports/2026/arb-latency.json");
    const receipt = createArbLatencyArtifactOutputReceipt(outputPath);

    expect(outputPath.logicalPath).toBe("reports/2026/arb-latency.json");
    expect(Object.getOwnPropertyDescriptor(outputPath, "logicalPath")).toEqual({
      configurable: false,
      enumerable: true,
      value: "reports/2026/arb-latency.json",
      writable: false,
    });
    expect(Object.isFrozen(outputPath)).toBe(true);
    expect(Reflect.set(outputPath, "logicalPath", "physical/escape.json")).toBe(false);
    expect(receipt).toEqual({
      logicalPath: "reports/2026/arb-latency.json",
      schema: "arb-latency-cli-output@2",
    });
    expect(Object.keys(receipt)).toEqual(["logicalPath", "schema"]);
    expect(JSON.stringify(receipt)).toBe(
      '{"logicalPath":"reports/2026/arb-latency.json","schema":"arb-latency-cli-output@2"}',
    );
    expect(Object.isFrozen(receipt)).toBe(true);
    expect(Reflect.set(receipt, "logicalPath", "/physical/escape.json")).toBe(false);
  });

  it("keeps the authenticated path exact when its prototype is tampered", () => {
    const outputPath = parseValidatedArbLatencyOutputPath("reports/result.json");
    const prototype = ValidatedArbLatencyOutputPath.prototype;
    const originalDescriptor = Object.getOwnPropertyDescriptor(prototype, "logicalPath");

    try {
      Object.defineProperty(prototype, "logicalPath", {
        configurable: true,
        get: () => "tampered.json",
      });
      expect(createArbLatencyArtifactOutputReceipt(outputPath).logicalPath).toBe("reports/result.json");
    } finally {
      if (originalDescriptor === undefined) {
        Reflect.deleteProperty(prototype, "logicalPath");
      } else {
        Object.defineProperty(prototype, "logicalPath", originalDescriptor);
      }
    }
  });

  it("defines an output port that receives the authenticated path and v2 artifact", () => {
    const port = acceptOutputPort({
      write(outputPath, artifact) {
        expect(artifact.schema).toBe("arb-latency-artifact@2");
        return createArbLatencyArtifactOutputReceipt(outputPath);
      },
    });

    expect(port).toHaveProperty("write");
  });

  it("rejects every non-string, empty, oversized, ambiguous, separator, and absolute input", () => {
    expectFailure(() => parseValidatedArbLatencyOutputPath(undefined), "INVALID_TYPE");
    expectFailure(() => parseValidatedArbLatencyOutputPath(""), "EMPTY_PATH");
    expectFailure(() => parseValidatedArbLatencyOutputPath("a".repeat(241)), "PATH_TOO_LONG");
    expectFailure(() => parseValidatedArbLatencyOutputPath("result\u{0}.json"), "AMBIGUOUS_CHARACTER");
    expectFailure(() => parseValidatedArbLatencyOutputPath("result name.json"), "AMBIGUOUS_CHARACTER");
    expectFailure(
      () => parseValidatedArbLatencyOutputPath(String.raw`result\name.json`),
      "BACKSLASH_SEPARATOR",
    );
    expectFailure(() => parseValidatedArbLatencyOutputPath("/result.json"), "ABSOLUTE_PATH");
    expectFailure(() => parseValidatedArbLatencyOutputPath("//server/share/result.json"), "ABSOLUTE_PATH");
    expectFailure(() => parseValidatedArbLatencyOutputPath("C:/result.json"), "WINDOWS_PATH");
    expectFailure(() => parseValidatedArbLatencyOutputPath("C:result.json"), "WINDOWS_PATH");
  });

  it("rejects empty, traversal, hidden, unsafe, trailing-dot, and reserved path segments", () => {
    expectFailure(() => parseValidatedArbLatencyOutputPath("folder//result.json"), "EMPTY_SEGMENT");
    expectFailure(() => parseValidatedArbLatencyOutputPath("folder/./result.json"), "DOT_SEGMENT");
    expectFailure(() => parseValidatedArbLatencyOutputPath("folder/../result.json"), "DOT_SEGMENT");
    expectFailure(() => parseValidatedArbLatencyOutputPath(".hidden/result.json"), "HIDDEN_SEGMENT");
    expectFailure(() => parseValidatedArbLatencyOutputPath("folder/.temp"), "HIDDEN_SEGMENT");
    expectFailure(() => parseValidatedArbLatencyOutputPath("foldeér/result.json"), "UNSAFE_SEGMENT");
    expectFailure(() => parseValidatedArbLatencyOutputPath("folder./result.json"), "UNSAFE_SEGMENT");
    expectFailure(() => parseValidatedArbLatencyOutputPath("tmp/result.json"), "RESERVED_SEGMENT");
    expectFailure(() => parseValidatedArbLatencyOutputPath("temporary/result.json"), "RESERVED_SEGMENT");
    expectFailure(() => parseValidatedArbLatencyOutputPath("CON.txt/result.json"), "RESERVED_SEGMENT");
    expectFailure(() => parseValidatedArbLatencyOutputPath("folder/result.tmp"), "RESERVED_SEGMENT");
  });

  it("requires a visible lowercase JSON filename", () => {
    expectFailure(() => parseValidatedArbLatencyOutputPath("folder/result.JSON"), "INVALID_FILENAME");
    expectFailure(() => parseValidatedArbLatencyOutputPath("folder/result.json.bak"), "INVALID_FILENAME");
  });

  it("rejects constructor bypasses and forged, plain, wrapped, and revoked proxy receipt paths", () => {
    expectFailure(
      () => Reflect.construct(ValidatedArbLatencyOutputPath, ["result.json", Symbol("forged")]),
      "UNAUTHORIZED_CONSTRUCTION",
    );
    expectFailure(
      () => createArbLatencyArtifactOutputReceipt({ logicalPath: "result.json" }),
      "UNAUTHENTICATED_PATH",
    );
    expectFailure(
      () => createArbLatencyArtifactOutputReceipt(Object.create(ValidatedArbLatencyOutputPath.prototype)),
      "UNAUTHENTICATED_PATH",
    );
    expectFailure(
      () =>
        createArbLatencyArtifactOutputReceipt(
          new Proxy(parseValidatedArbLatencyOutputPath("result.json"), {}),
        ),
      "UNAUTHENTICATED_PATH",
    );
    const revocable = Proxy.revocable(parseValidatedArbLatencyOutputPath("result.json"), {});
    revocable.revoke();
    expectFailure(() => createArbLatencyArtifactOutputReceipt(revocable.proxy), "UNAUTHENTICATED_PATH");
  });
});
