import { describe, expect, it } from "vitest";

import * as numeric from "@mm-crypto-bot/numeric";

const internalSubpath = "@mm-crypto-bot/numeric/src/exact-rational";

describe("numeric public API", () => {
  it("exports exact values without exposing raw Fraction", async () => {
    const rational = numeric.ExactRational.from("3");

    expect(rational.toSnapshot()).toMatchObject({ numerator: "3", denominator: "1" });
    expect(numeric.ExactRational.requireAuthentic(rational)).toBe(rational);
    expect(numeric.ExactRational.from("0.5").toCanonicalDecimal()).toBe("0.5");
    expect(numeric.canonicalizeExternalDecimal("3.000")).toBe("3");
    expect(Object.hasOwn(numeric, "Fraction")).toBe(false);
    await expect(import("@mm-crypto-bot/numeric")).resolves.toHaveProperty("ExactRational");
    await expect(import("@mm-crypto-bot/numeric")).resolves.toHaveProperty("canonicalizeExternalDecimal");
    await expect(import(internalSubpath)).rejects.toThrow();
  });

  it("exports selected leverage only from the package root", async () => {
    expect(numeric.SelectedLeverage.parse("2.5").canonical).toBe("2.5");
    await expect(import("@mm-crypto-bot/numeric")).resolves.toHaveProperty("SelectedLeverage");
  });
});
