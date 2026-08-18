import Fraction from "fraction.js";

import {
  assertExactIntegerMagnitude,
  canonicalInteger,
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

export class ExactRational {
  public static from(input: unknown): ExactRational {
    if (typeof input === "bigint") {
      return this.fromParts(input, 1n);
    }

    if (typeof input === "string") {
      const [numerator, denominator] = parseCanonicalDecimal(input);
      return this.fromParts(numerator, denominator);
    }

    throw new ExactNumericError(
      "INVALID_INPUT",
      "Exact rational input must be a canonical decimal string or bigint.",
    );
  }

  public static fromParts(numerator: unknown, denominator: unknown): ExactRational {
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
    return new this({ numerator: normalizedNumerator, denominator: normalizedDenominator });
  }

  public static fromSnapshot(input: unknown): ExactRational {
    try {
      return this.fromSnapshotRecord(input);
    } catch (error: unknown) {
      if (error instanceof ExactNumericError) {
        throw error;
      }

      throw new ExactNumericError(
        "SNAPSHOT_CONTENT",
        "Exact rational snapshot could not be inspected safely.",
      );
    }
  }

  private static requireInstance(input: unknown): ExactRational {
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

  private static hasExactSnapshotKeys(input: Record<string, unknown>): boolean {
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

  private static fromSnapshotRecord(input: unknown): ExactRational {
    if (!isPlainRecord(input)) {
      throw new ExactNumericError("SNAPSHOT_CONTENT", "Exact rational snapshot must be a plain object.");
    }

    if (!this.hasExactSnapshotKeys(input)) {
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

    const rational = this.fromParts(numerator, denominator);
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

  private constructor(parts: FractionParts) {
    this.#numerator = parts.numerator;
    this.#denominator = parts.denominator;
    Object.freeze(this);
  }

  public add(other: unknown): ExactRational {
    const self = ExactRational.requireInstance(this);
    const operand = ExactRational.requireInstance(other);
    return ExactRational.fromParts(
      self.#numerator * operand.#denominator + operand.#numerator * self.#denominator,
      self.#denominator * operand.#denominator,
    );
  }

  public subtract(other: unknown): ExactRational {
    const self = ExactRational.requireInstance(this);
    const operand = ExactRational.requireInstance(other);
    return ExactRational.fromParts(
      self.#numerator * operand.#denominator - operand.#numerator * self.#denominator,
      self.#denominator * operand.#denominator,
    );
  }

  public multiply(other: unknown): ExactRational {
    const self = ExactRational.requireInstance(this);
    const operand = ExactRational.requireInstance(other);
    return ExactRational.fromParts(
      self.#numerator * operand.#numerator,
      self.#denominator * operand.#denominator,
    );
  }

  public divide(other: unknown): ExactRational {
    const self = ExactRational.requireInstance(this);
    const operand = ExactRational.requireInstance(other);
    if (operand.#numerator === 0n) {
      throw new ExactNumericError("DIVISION_ZERO", "Exact rational division by zero is forbidden.");
    }

    return ExactRational.fromParts(
      self.#numerator * operand.#denominator,
      self.#denominator * operand.#numerator,
    );
  }

  public compare(other: unknown): -1 | 0 | 1 {
    const self = ExactRational.requireInstance(this);
    const operand = ExactRational.requireInstance(other);
    const difference = self.#numerator * operand.#denominator - operand.#numerator * self.#denominator;
    return difference < 0n ? -1 : difference > 0n ? 1 : 0;
  }

  public equals(other: unknown): boolean {
    const self = ExactRational.requireInstance(this);
    return self.compare(other) === 0;
  }

  public abs(): ExactRational {
    const self = ExactRational.requireInstance(this);
    return self.#numerator < 0n ? self.negate() : self;
  }

  public negate(): ExactRational {
    const self = ExactRational.requireInstance(this);
    return ExactRational.fromParts(-self.#numerator, self.#denominator);
  }

  public isZero(): boolean {
    return ExactRational.requireInstance(this).#numerator === 0n;
  }

  public isNegative(): boolean {
    return ExactRational.requireInstance(this).#numerator < 0n;
  }

  public isInteger(): boolean {
    return ExactRational.requireInstance(this).#denominator === 1n;
  }

  public toSnapshot(): ExactRationalSnapshot {
    const self = ExactRational.requireInstance(this);
    return Object.freeze({
      schema: "exact-rational@1" as const,
      numerator: canonicalInteger(self.#numerator),
      denominator: canonicalInteger(self.#denominator),
    });
  }

  public toJSON(): ExactRationalSnapshot {
    return ExactRational.requireInstance(this).toSnapshot();
  }
}
