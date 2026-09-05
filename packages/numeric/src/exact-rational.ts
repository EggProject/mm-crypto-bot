import Fraction from "fraction.js";

import {
  assertExactIntegerMagnitude,
  canonicalInteger,
  canonicalizeExternalDecimal,
  isPlainRecord,
  parseCanonicalDecimal,
  parseCanonicalInteger,
} from "./canonical.js";
import { ExactNumericError } from "./errors.js";

export interface ExactRationalSnapshot {
  readonly schema: "exact-rational@1";
  readonly numerator: string;
  readonly denominator: string;
}

interface FractionParts {
  readonly numerator: bigint;
  readonly denominator: bigint;
}

function divideExactFactors(value: bigint, factor: bigint): readonly [bigint, bigint] {
  let remaining = value;
  let count = 0n;
  while (remaining % factor === 0n) {
    remaining /= factor;
    count += 1n;
  }

  return [remaining, count];
}

function decimalDigitCount(value: string): bigint {
  let count = 0n;
  for (const _character of value) {
    count += 1n;
  }

  return count;
}

const CONSTRUCTION_CAPABILITY = Symbol("exact-rational-construction-capability");

export class ExactRational {
  public static readonly from = (input: unknown): ExactRational => {
    if (typeof input === "bigint") {
      return ExactRational.#fromParts(input, 1n);
    }

    if (typeof input === "string") {
      const [numerator, denominator] = parseCanonicalDecimal(input);
      return ExactRational.#fromParts(numerator, denominator);
    }

    throw new ExactNumericError(
      "INVALID_INPUT",
      "Exact rational input must be a canonical decimal string or bigint.",
    );
  };

  public static readonly fromParts = (numerator: unknown, denominator: unknown): ExactRational => {
    return ExactRational.#fromParts(numerator, denominator);
  };

  public static readonly fromSnapshot = (input: unknown): ExactRational => {
    try {
      return ExactRational.#fromSnapshotRecord(input);
    } catch (error: unknown) {
      if (error instanceof ExactNumericError) {
        throw error;
      }

      throw new ExactNumericError(
        "SNAPSHOT_CONTENT",
        "Exact rational snapshot could not be inspected safely.",
      );
    }
  };

  public static readonly requireAuthentic = (input: unknown): ExactRational => {
    return ExactRational.#requireInstance(input);
  };

  static {
    Object.freeze(ExactRational.prototype);
    Object.freeze(ExactRational);
  }

  static #fromParts(numerator: unknown, denominator: unknown): ExactRational {
    if (typeof numerator !== "bigint" || typeof denominator !== "bigint") {
      throw new ExactNumericError("INVALID_INPUT", "Exact rational parts must both be bigint values.");
    }

    if (denominator === 0n) {
      throw new ExactNumericError("DENOMINATOR_ZERO", "Exact rational denominator must not be zero.");
    }

    assertExactIntegerMagnitude(numerator);
    assertExactIntegerMagnitude(denominator);
    const fraction = new Fraction(numerator, denominator);
    const normalizedNumerator = fraction.s * fraction.n;
    const normalizedDenominator = fraction.d;
    assertExactIntegerMagnitude(normalizedNumerator);
    assertExactIntegerMagnitude(normalizedDenominator);
    return this.#construct({ numerator: normalizedNumerator, denominator: normalizedDenominator });
  }

  static #construct(parts: FractionParts): ExactRational {
    return new this(parts, CONSTRUCTION_CAPABILITY);
  }

  static #requireInstance(input: unknown): ExactRational {
    try {
      if (input instanceof this) {
        void input.#numerator;
        void input.#denominator;
        return input;
      }
    } catch {
      throw new ExactNumericError(
        "INVALID_RATIONAL",
        "Exact rational operation requires an ExactRational operand.",
      );
    }

    throw new ExactNumericError(
      "INVALID_RATIONAL",
      "Exact rational operation requires an ExactRational operand.",
    );
  }

  static #hasExactSnapshotKeys(input: Record<string, unknown>): boolean {
    const allowedKeys = new Set(["denominator", "numerator", "schema"]);
    const keys = Reflect.ownKeys(input);
    if (keys.length !== allowedKeys.size) {
      return false;
    }

    return keys.every((key) => {
      if (typeof key !== "string" || !allowedKeys.has(key)) {
        return false;
      }

      const descriptor = Object.getOwnPropertyDescriptor(input, key);
      return (
        descriptor?.enumerable === true &&
        Object.hasOwn(descriptor, "value") &&
        descriptor.get === undefined &&
        descriptor.set === undefined
      );
    });
  }

  static #fromSnapshotRecord(input: unknown): ExactRational {
    if (!isPlainRecord(input)) {
      throw new ExactNumericError("SNAPSHOT_CONTENT", "Exact rational snapshot must be a plain object.");
    }

    if (!this.#hasExactSnapshotKeys(input)) {
      throw new ExactNumericError("SNAPSHOT_CONTENT", "Exact rational snapshot has an invalid shape.");
    }

    if (input["schema"] !== "exact-rational@1") {
      throw new ExactNumericError("SNAPSHOT_SCHEMA", "Exact rational snapshot schema is not supported.");
    }

    const numerator = parseCanonicalInteger(input["numerator"]);
    const denominator = parseCanonicalInteger(input["denominator"]);
    if (denominator <= 0n) {
      throw new ExactNumericError("SNAPSHOT_NORMALIZATION", "Snapshot denominator must be positive.");
    }

    const rational = this.#fromParts(numerator, denominator);
    if (rational.#numerator !== numerator || rational.#denominator !== denominator) {
      throw new ExactNumericError("SNAPSHOT_NORMALIZATION", "Snapshot fraction must be normalized.");
    }

    return rational;
  }

  readonly #numerator: bigint;
  readonly #denominator: bigint;

  public readonly [Symbol.toPrimitive] = (_hint: string): never => {
    throw new ExactNumericError("IMPLICIT_COERCION", "Implicit exact rational conversion is forbidden.");
  };

  private constructor(parts: FractionParts, capability: unknown) {
    if (capability !== CONSTRUCTION_CAPABILITY) {
      throw new ExactNumericError("INVALID_RATIONAL", "Exact rational construction is not permitted.");
    }

    this.#numerator = parts.numerator;
    this.#denominator = parts.denominator;
    Object.freeze(this);
  }

  public add(other: unknown): ExactRational {
    const self = ExactRational.#requireInstance(this);
    const operand = ExactRational.#requireInstance(other);
    return ExactRational.fromParts(
      self.#numerator * operand.#denominator + operand.#numerator * self.#denominator,
      self.#denominator * operand.#denominator,
    );
  }

  public subtract(other: unknown): ExactRational {
    const self = ExactRational.#requireInstance(this);
    const operand = ExactRational.#requireInstance(other);
    return ExactRational.fromParts(
      self.#numerator * operand.#denominator - operand.#numerator * self.#denominator,
      self.#denominator * operand.#denominator,
    );
  }

  public multiply(other: unknown): ExactRational {
    const self = ExactRational.#requireInstance(this);
    const operand = ExactRational.#requireInstance(other);
    return ExactRational.fromParts(
      self.#numerator * operand.#numerator,
      self.#denominator * operand.#denominator,
    );
  }

  public divide(other: unknown): ExactRational {
    const self = ExactRational.#requireInstance(this);
    const operand = ExactRational.#requireInstance(other);
    if (operand.#numerator === 0n) {
      throw new ExactNumericError("DIVISION_ZERO", "Exact rational division by zero is forbidden.");
    }

    return ExactRational.fromParts(
      self.#numerator * operand.#denominator,
      self.#denominator * operand.#numerator,
    );
  }

  public compare(other: unknown): -1 | 0 | 1 {
    const self = ExactRational.#requireInstance(this);
    const operand = ExactRational.#requireInstance(other);
    const difference = self.#numerator * operand.#denominator - operand.#numerator * self.#denominator;
    return difference < 0n ? -1 : difference > 0n ? 1 : 0;
  }

  public equals(other: unknown): boolean {
    const self = ExactRational.#requireInstance(this);
    return self.compare(other) === 0;
  }

  public abs(): ExactRational {
    const self = ExactRational.#requireInstance(this);
    return self.#numerator < 0n ? self.negate() : self;
  }

  public negate(): ExactRational {
    const self = ExactRational.#requireInstance(this);
    return ExactRational.fromParts(-self.#numerator, self.#denominator);
  }

  public isZero(): boolean {
    return ExactRational.#requireInstance(this).#numerator === 0n;
  }

  public isNegative(): boolean {
    return ExactRational.#requireInstance(this).#numerator < 0n;
  }

  public isInteger(): boolean {
    return ExactRational.#requireInstance(this).#denominator === 1n;
  }

  public toCanonicalDecimal(): string {
    const self = ExactRational.#requireInstance(this);
    if (self.#numerator === 0n) {
      return "0";
    }

    const [denominatorWithoutTwos, twos] = divideExactFactors(self.#denominator, 2n);
    const [remainingDenominator, fives] = divideExactFactors(denominatorWithoutTwos, 5n);
    if (remainingDenominator !== 1n) {
      throw new ExactNumericError(
        "NON_TERMINATING_DECIMAL",
        "Exact rational value cannot be represented as a finite decimal.",
      );
    }

    let fractionalDigits = twos;
    if (fives > fractionalDigits) {
      fractionalDigits = fives;
    }
    const scale = 10n ** fractionalDigits;
    const numeratorMagnitude = self.#numerator < 0n ? -self.#numerator : self.#numerator;
    const scaleMultiplier = twos > fives ? 5n ** (twos - fives) : 2n ** (fives - twos);
    const scaledNumerator = numeratorMagnitude * scaleMultiplier;
    const integerPart = scaledNumerator / scale;
    const fractionalPart = scaledNumerator % scale;
    if (fractionalPart === 0n) {
      const integer = integerPart.toString();
      return canonicalizeExternalDecimal(self.#numerator < 0n ? `-${integer}` : integer);
    }

    const fraction = fractionalPart.toString();
    let leadingZeros = fractionalDigits - decimalDigitCount(fraction);
    let fractionPadding = "";
    while (leadingZeros > 0n) {
      fractionPadding += "0";
      leadingZeros -= 1n;
    }

    const unsignedDecimal = `${integerPart.toString()}.${fractionPadding}${fraction}`;
    return canonicalizeExternalDecimal(self.#numerator < 0n ? `-${unsignedDecimal}` : unsignedDecimal);
  }

  public toSnapshot(): ExactRationalSnapshot {
    const self = ExactRational.#requireInstance(this);
    return Object.freeze({
      schema: "exact-rational@1" as const,
      numerator: canonicalInteger(self.#numerator),
      denominator: canonicalInteger(self.#denominator),
    });
  }

  public toJSON(): ExactRationalSnapshot {
    return ExactRational.#requireInstance(this).toSnapshot();
  }
}
