import { ExactNumericError } from "./errors.js";
import { ExactRational } from "./exact-rational.js";

function requirePositiveStep(step: ExactRational): void {
  if (step.compare(ExactRational.from(0n)) <= 0) {
    throw new ExactNumericError("STEP_NOT_POSITIVE", "Exact step must be strictly positive.");
  }
}

export function isExactMultiple(value: ExactRational, step: ExactRational): boolean {
  requirePositiveStep(step);
  return value.divide(step).isInteger();
}

export function assertExactMultiple(value: ExactRational, step: ExactRational): void {
  if (!isExactMultiple(value, step)) {
    throw new ExactNumericError("STEP_MISMATCH", "Exact value is not a multiple of the required step.");
  }
}

export function assertNonNegativeExactMultiple(value: ExactRational, step: ExactRational): void {
  if (value.isNegative()) {
    throw new ExactNumericError("VALUE_NEGATIVE", "Exact value must not be negative.");
  }

  assertExactMultiple(value, step);
}
