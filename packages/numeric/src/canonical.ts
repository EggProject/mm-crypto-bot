import { ExactNumericError } from "./errors.js";

/**
 * One resource bound for every exact-rational integer component.
 */
export const MAXIMUM_EXACT_INTEGER_DIGITS = 1024;
export const MAXIMUM_CANONICAL_DECIMAL_LENGTH = MAXIMUM_EXACT_INTEGER_DIGITS;
const EXCLUSIVE_MAXIMUM_EXACT_INTEGER_MAGNITUDE = 10n ** 1024n;

export function assertExactIntegerMagnitude(value: bigint): void {
  if (
    value >= EXCLUSIVE_MAXIMUM_EXACT_INTEGER_MAGNITUDE ||
    value <= -EXCLUSIVE_MAXIMUM_EXACT_INTEGER_MAGNITUDE
  ) {
    throw new ExactNumericError(
      "MAGNITUDE_LIMIT",
      "Exact rational integer magnitude exceeds the allowed digit bound.",
    );
  }
}

function isAsciiDigit(character: string): boolean {
  return character >= "0" && character <= "9";
}

function hasOnlyAsciiDigits(input: string): boolean {
  for (let index = 0; index < input.length; index += 1) {
    if (!isAsciiDigit(input.charAt(index))) {
      return false;
    }
  }

  return true;
}

function isCanonicalUnsignedInteger(input: string): boolean {
  if (input === "0") {
    return true;
  }

  return input.length > 0 && !input.startsWith("0") && hasOnlyAsciiDigits(input);
}

function isCanonicalDecimal(input: string): boolean {
  const unsignedInput = input.startsWith("-") ? input.slice(1) : input;
  const decimalSeparatorIndex = unsignedInput.indexOf(".");
  if (decimalSeparatorIndex === -1) {
    return isCanonicalUnsignedInteger(unsignedInput);
  }

  const integerPart = unsignedInput.slice(0, decimalSeparatorIndex);
  const fractionPart = unsignedInput.slice(decimalSeparatorIndex + 1);
  return (
    isCanonicalUnsignedInteger(integerPart) &&
    fractionPart.length > 0 &&
    hasOnlyAsciiDigits(fractionPart) &&
    fractionPart.at(-1) !== "0"
  );
}

function isCanonicalInteger(input: string): boolean {
  if (input === "0") {
    return true;
  }

  const unsignedInput = input.startsWith("-") ? input.slice(1) : input;
  return isCanonicalUnsignedInteger(unsignedInput);
}

export function parseCanonicalDecimal(input: string): readonly [bigint, bigint] {
  if (input.length === 0) {
    throw new ExactNumericError("DECIMAL_LENGTH", "Canonical decimal length is outside the allowed bound.");
  }

  if (input.length > MAXIMUM_CANONICAL_DECIMAL_LENGTH) {
    throw new ExactNumericError("DECIMAL_LENGTH", "Canonical decimal length is outside the allowed bound.");
  }

  if (input === "-0" || !isCanonicalDecimal(input)) {
    throw new ExactNumericError("DECIMAL_GRAMMAR", "Input is not a canonical decimal string.");
  }

  const isNegative = input.startsWith("-");
  const unsignedInput = isNegative ? input.slice(1) : input;
  const decimalSeparatorIndex = unsignedInput.indexOf(".");
  const integerPart =
    decimalSeparatorIndex === -1 ? unsignedInput : unsignedInput.slice(0, decimalSeparatorIndex);
  const fractionPart = decimalSeparatorIndex === -1 ? "" : unsignedInput.slice(decimalSeparatorIndex + 1);
  const numerator = BigInt(`${integerPart}${fractionPart}`);
  const denominator = 10n ** BigInt(fractionPart.length);

  return [isNegative ? -numerator : numerator, denominator];
}

export function parseCanonicalInteger(input: unknown): bigint {
  if (typeof input !== "string") {
    throw new ExactNumericError("SNAPSHOT_CONTENT", "Snapshot integer is not canonical.");
  }

  if (input.length === 0 || input.length > MAXIMUM_CANONICAL_DECIMAL_LENGTH) {
    throw new ExactNumericError("SNAPSHOT_CONTENT", "Snapshot integer is outside the allowed bound.");
  }

  if (input === "-0" || !isCanonicalInteger(input)) {
    throw new ExactNumericError("SNAPSHOT_CONTENT", "Snapshot integer is not canonical.");
  }

  return BigInt(input);
}

export function canonicalInteger(value: bigint): string {
  return value.toString();
}

function hasNativeObjectConstructor(prototype: object): boolean {
  const descriptor = Object.getOwnPropertyDescriptor(prototype, "constructor");
  if (
    descriptor === undefined ||
    !Object.hasOwn(descriptor, "value") ||
    typeof descriptor.value !== "function" ||
    Reflect.get(descriptor.value, "prototype") !== prototype
  ) {
    return false;
  }

  return Function.prototype.toString.call(descriptor.value) === Function.prototype.toString.call(Object);
}

export function isPlainRecord(input: unknown): input is Record<string, unknown> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return false;
  }

  try {
    const prototype = Reflect.getPrototypeOf(input);
    return prototype === null || hasNativeObjectConstructor(prototype);
  } catch {
    return false;
  }
}
