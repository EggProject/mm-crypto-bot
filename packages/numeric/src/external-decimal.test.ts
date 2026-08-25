import { describe, expect, it } from "vitest";

import { canonicalizeExternalDecimal, MAXIMUM_CANONICAL_DECIMAL_LENGTH } from "./canonical.js";
import { ExactNumericError } from "./errors.js";
import { ExactRational } from "./exact-rational.js";

const malformedExternalDecimalCases: readonly (readonly [string, ExactNumericError["code"]])[] = [
  ["", "DECIMAL_LENGTH"],
  [" 1", "DECIMAL_GRAMMAR"],
  ["1 ", "DECIMAL_GRAMMAR"],
  ["+1", "DECIMAL_GRAMMAR"],
  ["1e3", "DECIMAL_GRAMMAR"],
  ["1E3", "DECIMAL_GRAMMAR"],
  ["1,000", "DECIMAL_GRAMMAR"],
  ["1_000", "DECIMAL_GRAMMAR"],
  ["01", "DECIMAL_GRAMMAR"],
  ["-01", "DECIMAL_GRAMMAR"],
  [".1", "DECIMAL_GRAMMAR"],
  ["1.", "DECIMAL_GRAMMAR"],
  ["-", "DECIMAL_GRAMMAR"],
  ["--1", "DECIMAL_GRAMMAR"],
  ["1.2.3", "DECIMAL_GRAMMAR"],
  ["١", "DECIMAL_GRAMMAR"],
  ["１２", "DECIMAL_GRAMMAR"],
  ["-0", "DECIMAL_GRAMMAR"],
  ["-0.00", "DECIMAL_GRAMMAR"],
];

function expectExactNumericError(action: () => unknown, code: ExactNumericError["code"]): void {
  try {
    action();
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(ExactNumericError);
    if (error instanceof ExactNumericError) {
      expect(error.code).toBe(code);
      return;
    }
  }

  throw new Error(`Expected ExactNumericError with code ${code}.`);
}

describe("canonicalizeExternalDecimal", () => {
  it.each([
    ["118449.02000000", "118449.02", "5922451", "50"],
    ["1.000", "1", "1", "1"],
    ["0.0000", "0", "0", "1"],
    ["-1.2300", "-1.23", "-123", "100"],
    ["-7.000", "-7", "-7", "1"],
    ["-12", "-12", "-12", "1"],
  ])("transports %s losslessly as %s", (externalDecimal, canonicalDecimal, numerator, denominator) => {
    const result = canonicalizeExternalDecimal(externalDecimal);

    expect(result).toBe(canonicalDecimal);
    expect(ExactRational.from(result).toSnapshot()).toMatchObject({ denominator, numerator });
  });

  it("removes only trailing fractional zero padding across generated decimal components", () => {
    const integerParts = ["0", "1", "9", "123456789"];
    const significantFractions = ["1", "12", "101", "987654321"];
    const zeroPadding = ["", "0", "000000"];

    for (const integerPart of integerParts) {
      for (const significantFraction of significantFractions) {
        for (const padding of zeroPadding) {
          expect(canonicalizeExternalDecimal(`${integerPart}.${significantFraction}${padding}`)).toBe(
            `${integerPart}.${significantFraction}`,
          );
        }
      }
    }
  });

  it("accepts the exact input-length boundary without reducing its numeric value", () => {
    const maximumInteger = "1".repeat(MAXIMUM_CANONICAL_DECIMAL_LENGTH);
    const maximumPaddedInteger = `1.${"0".repeat(MAXIMUM_CANONICAL_DECIMAL_LENGTH - 2)}`;
    const maximumNegativeInteger = `-${"1".repeat(MAXIMUM_CANONICAL_DECIMAL_LENGTH)}`;
    const maximumNegativeDecimal = `-1.${"1".repeat(MAXIMUM_CANONICAL_DECIMAL_LENGTH - 2)}`;
    const excessiveNegativeDecimal = `-1.${"1".repeat(MAXIMUM_CANONICAL_DECIMAL_LENGTH - 1)}`;

    expect(canonicalizeExternalDecimal(maximumInteger)).toBe(maximumInteger);
    expect(canonicalizeExternalDecimal(maximumPaddedInteger)).toBe("1");
    expect(canonicalizeExternalDecimal(maximumNegativeInteger)).toBe(maximumNegativeInteger);
    expect(ExactRational.from(maximumNegativeInteger).toSnapshot()).toEqual({
      denominator: "1",
      numerator: maximumNegativeInteger,
      schema: "exact-rational@1",
    });
    expect(canonicalizeExternalDecimal(maximumNegativeDecimal)).toBe(maximumNegativeDecimal);
    expectExactNumericError(() => canonicalizeExternalDecimal(excessiveNegativeDecimal), "DECIMAL_LENGTH");
    expectExactNumericError(
      () => canonicalizeExternalDecimal("1".repeat(MAXIMUM_CANONICAL_DECIMAL_LENGTH + 1)),
      "DECIMAL_LENGTH",
    );
    expectExactNumericError(
      () => canonicalizeExternalDecimal(`-${"1".repeat(MAXIMUM_CANONICAL_DECIMAL_LENGTH + 1)}`),
      "DECIMAL_LENGTH",
    );
  });

  it.each([[undefined], [Reflect.getPrototypeOf(Object.prototype)], [1], [1n], [Symbol("1")], [{}], [[]]])(
    "rejects non-string external input",
    (input) => {
      expectExactNumericError(() => canonicalizeExternalDecimal(input), "INVALID_INPUT");
    },
  );

  it.each(malformedExternalDecimalCases)("rejects malformed external decimal %s", (input, code) => {
    expectExactNumericError(() => canonicalizeExternalDecimal(input), code);
  });
});
