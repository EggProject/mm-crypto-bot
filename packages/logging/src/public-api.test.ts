import { describe, expect, it } from "vitest";

import { StructuredLogger } from "@mm-crypto-bot/logging";
import loggingManifest from "../package.json" with { type: "json" };

const internalSubpath = "@mm-crypto-bot/logging/src/structured-logger";
const loggingPackageRoot = "@mm-crypto-bot/logging";
const testHelperSubpathSegment = "testing";
const testHelperSubpath = `${loggingPackageRoot}/${testHelperSubpathSegment}`;

describe("logging public API", () => {
  it("exports the structured logger only through the package boundary", async () => {
    expect(StructuredLogger).toBeTypeOf("function");
    await expect(import("@mm-crypto-bot/logging")).resolves.toHaveProperty("StructuredLogger");
    await expect(import(internalSubpath)).rejects.toThrow();
  });

  it("does not expose test helpers through the package manifest or exports", async () => {
    expect(loggingManifest.exports).toEqual({ ".": "./src/index.ts" });
    expect(loggingManifest.exports).not.toHaveProperty("./testing");
    await expect(import(testHelperSubpath)).rejects.toThrow();
  });
});
