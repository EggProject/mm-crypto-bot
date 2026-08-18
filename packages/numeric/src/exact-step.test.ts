import { describe, expect, it } from "vitest";

import { ExactNumericError } from "./errors.js";
import { assertExactMultiple, assertNonNegativeExactMultiple, isExactMultiple } from "./exact-step.js";
import { ExactRational } from "./exact-rational.js";

function expectExactNumericError(action: () => unknown, code: ExactNumericError["code"]): void {
  try {
    action();
  } catch (error: unknown) {
    if (error instanceof ExactNumericError) {
      expect(error.code).toBe(code);
      return;
    }
  }

  throw new Error(`Expected ExactNumericError with code ${code}.`);
}

describe("exact tick and lot multiples", () => {
  it("accepts positive, negative, zero, fractional, and very large exact multiples", () => {
    const step = ExactRational.from("0.125");

    expect(isExactMultiple(ExactRational.from("1.375"), step)).toBe(true);
    expect(isExactMultiple(ExactRational.from("-1.375"), step)).toBe(true);
    expect(isExactMultiple(ExactRational.from(0n), step)).toBe(true);
    expect(isExactMultiple(ExactRational.fromParts(10n ** 60n, 8n), step)).toBe(true);
    expect(isExactMultiple(ExactRational.from("0.1"), step)).toBe(false);
  });

  it("fails closed for invalid steps, mismatches, and forbidden negative quantities", () => {
    const value = ExactRational.from("1.375");
    const step = ExactRational.from("0.125");

    expect(() => {
      assertExactMultiple(value, step);
    }).not.toThrow();
    expect(() => {
      assertNonNegativeExactMultiple(value, step);
    }).not.toThrow();
    expectExactNumericError(() => {
      isExactMultiple(value, ExactRational.from(0n));
    }, "STEP_NOT_POSITIVE");
    expectExactNumericError(() => {
      isExactMultiple(value, ExactRational.from("-0.125"));
    }, "STEP_NOT_POSITIVE");
    expectExactNumericError(() => {
      assertExactMultiple(ExactRational.from("0.1"), step);
    }, "STEP_MISMATCH");
    expectExactNumericError(() => {
      assertNonNegativeExactMultiple(ExactRational.from("-0.125"), step);
    }, "VALUE_NEGATIVE");
  });
});
