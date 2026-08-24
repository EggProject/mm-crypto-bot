import { describe, expect, it } from "vitest";

import * as numeric from "@mm-crypto-bot/numeric";

const internalSubpath = "@mm-crypto-bot/numeric/src/exact-rational";

describe("numeric public API", () => {
  it("exports exact values without exposing raw Fraction", async () => {
    expect(numeric.ExactRational.from("3").toSnapshot()).toMatchObject({ numerator: "3", denominator: "1" });
    expect(numeric.canonicalizeExternalDecimal("3.000")).toBe("3");
    expect(Object.hasOwn(numeric, "Fraction")).toBe(false);
    await expect(import("@mm-crypto-bot/numeric")).resolves.toHaveProperty("ExactRational");
    await expect(import("@mm-crypto-bot/numeric")).resolves.toHaveProperty("canonicalizeExternalDecimal");
    await expect(import(internalSubpath)).rejects.toThrow();
  });
});
