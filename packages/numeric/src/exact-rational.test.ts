import { runInNewContext } from "node:vm";

import { describe, expect, it, vi } from "vitest";

import { MAXIMUM_CANONICAL_DECIMAL_LENGTH, MAXIMUM_EXACT_INTEGER_DIGITS } from "./canonical.js";
import { ExactNumericError } from "./errors.js";
import { ExactRational, type ExactRationalSnapshot } from "./exact-rational.js";

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

function createSnapshot(): ExactRationalSnapshot {
  return { denominator: "1", numerator: "1", schema: "exact-rational@1" };
}

function retainUnknown(value: unknown): unknown {
  return value;
}

function fakeObjectConstructor(): string {
  return "not native";
}

function createNullPrototypeObject(): object {
  const nullPrototype = Reflect.getPrototypeOf(Object.prototype);
  if (nullPrototype !== null) {
    throw new Error("Object.prototype must have a null prototype.");
  }

  const result: object = {};
  Object.setPrototypeOf(result, nullPrototype);
  return result;
}

function withNonEnumerableSnapshotField(field: keyof ExactRationalSnapshot): ExactRationalSnapshot {
  const snapshot = createSnapshot();

  switch (field) {
    case "denominator": {
      Object.defineProperty(snapshot, "denominator", { enumerable: false, value: snapshot.denominator });
      break;
    }
    case "numerator": {
      Object.defineProperty(snapshot, "numerator", { enumerable: false, value: snapshot.numerator });
      break;
    }
    case "schema": {
      Object.defineProperty(snapshot, "schema", { enumerable: false, value: snapshot.schema });
      break;
    }
  }

  return snapshot;
}

describe("ExactRational canonical input and snapshots", () => {
  it("normalizes canonical decimals and bigint parts without precision loss", () => {
    expect(ExactRational.from("-12.34").toSnapshot()).toEqual({
      schema: "exact-rational@1",
      numerator: "-617",
      denominator: "50",
    });
    expect(ExactRational.fromParts(10_000_000_000_000_000_000_000_000_000n, -20n).toSnapshot()).toEqual({
      schema: "exact-rational@1",
      numerator: "-500000000000000000000000000",
      denominator: "1",
    });
  });

  it("rejects noncanonical, unbounded, and nonexact external input", () => {
    for (const input of ["", " 1", "+1", "1e3", "01", "1.0", ".1", "-0", "NaN", "1/2"]) {
      expectExactNumericError(
        () => ExactRational.from(input),
        input.length === 0 ? "DECIMAL_LENGTH" : "DECIMAL_GRAMMAR",
      );
    }

    expectExactNumericError(
      () => ExactRational.from("1".repeat(MAXIMUM_CANONICAL_DECIMAL_LENGTH + 1)),
      "DECIMAL_LENGTH",
    );
    expectExactNumericError(() => ExactRational.from(1), "INVALID_INPUT");
    expectExactNumericError(() => ExactRational.fromParts(1n, 0n), "DENOMINATOR_ZERO");
    expectExactNumericError(() => ExactRational.fromParts(1, 2n), "INVALID_INPUT");
  });

  it("serializes only versioned normalized snapshots", () => {
    const rational = ExactRational.from("0.125");
    const snapshot = rational.toSnapshot();

    expect(Object.isFrozen(rational)).toBe(true);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(JSON.stringify(rational)).toBe(JSON.stringify(snapshot));
    expect(ExactRational.fromSnapshot(snapshot).equals(rational)).toBe(true);
    expect(
      ExactRational.fromSnapshot({
        denominator: "1",
        numerator: "-1",
        schema: "exact-rational@1",
      }).toSnapshot(),
    ).toMatchObject({ denominator: "1", numerator: "-1" });
    expect(
      ExactRational.fromSnapshot({
        denominator: "1",
        numerator: "0",
        schema: "exact-rational@1",
      }).toSnapshot(),
    ).toMatchObject({ denominator: "1", numerator: "0" });
    const nullPrototypeSnapshot = { denominator: "1", numerator: "1", schema: "exact-rational@1" };
    const nullPrototype = Reflect.getPrototypeOf(Object.prototype);
    Object.setPrototypeOf(nullPrototypeSnapshot, nullPrototype);
    expect(ExactRational.fromSnapshot(nullPrototypeSnapshot).toSnapshot()).toMatchObject({
      denominator: "1",
      numerator: "1",
    });
    const crossRealmSnapshot = retainUnknown(
      runInNewContext('({ denominator: "1", numerator: "1", schema: "exact-rational@1" })'),
    );
    expect(ExactRational.fromSnapshot(crossRealmSnapshot).toSnapshot()).toMatchObject({
      denominator: "1",
      numerator: "1",
    });

    expectExactNumericError(() => ExactRational.fromSnapshot(undefined), "SNAPSHOT_CONTENT");
    expectExactNumericError(
      () => ExactRational.fromSnapshot({ denominator: "2", numerator: "1", schema: "exact-rational@2" }),
      "SNAPSHOT_SCHEMA",
    );
    expectExactNumericError(
      () => ExactRational.fromSnapshot({ denominator: "2", numerator: "01", schema: "exact-rational@1" }),
      "SNAPSHOT_CONTENT",
    );
    expectExactNumericError(
      () => ExactRational.fromSnapshot({ denominator: "-2", numerator: "1", schema: "exact-rational@1" }),
      "SNAPSHOT_NORMALIZATION",
    );
    expectExactNumericError(
      () => ExactRational.fromSnapshot({ denominator: "2", numerator: "2", schema: "exact-rational@1" }),
      "SNAPSHOT_NORMALIZATION",
    );
    expectExactNumericError(
      () =>
        ExactRational.fromSnapshot({
          denominator: "1",
          numerator: "1",
          schema: "exact-rational@1",
          value: "extra",
        }),
      "SNAPSHOT_CONTENT",
    );
    expectExactNumericError(
      () => ExactRational.fromSnapshot({ denominator: "1", numerator: "1", unexpected: "extra" }),
      "SNAPSHOT_CONTENT",
    );
    expectExactNumericError(
      () => ExactRational.fromSnapshot({ denominator: "1", numerator: 1n, schema: "exact-rational@1" }),
      "SNAPSHOT_CONTENT",
    );
    expectExactNumericError(
      () =>
        ExactRational.fromSnapshot({
          denominator: "1".repeat(MAXIMUM_CANONICAL_DECIMAL_LENGTH + 1),
          numerator: "1",
          schema: "exact-rational@1",
        }),
      "SNAPSHOT_CONTENT",
    );
    expectExactNumericError(
      () =>
        ExactRational.fromSnapshot({
          denominator: "1",
          numerator: "1".repeat(MAXIMUM_CANONICAL_DECIMAL_LENGTH + 1),
          schema: "exact-rational@1",
        }),
      "SNAPSHOT_CONTENT",
    );
  });

  it("round-trips the largest negative snapshot numerator within the transport budget", () => {
    const maximumMagnitude = 10n ** BigInt(MAXIMUM_EXACT_INTEGER_DIGITS) - 1n;
    const negativeMaximum = ExactRational.fromParts(-maximumMagnitude, 1n);

    expect(ExactRational.fromSnapshot(negativeMaximum.toSnapshot()).equals(negativeMaximum)).toBe(true);
    expectExactNumericError(
      () =>
        ExactRational.fromSnapshot({
          denominator: "1",
          numerator: `-${"1".repeat(MAXIMUM_CANONICAL_DECIMAL_LENGTH + 1)}`,
          schema: "exact-rational@1",
        }),
      "SNAPSHOT_CONTENT",
    );
  });

  it("fails closed for adversarial prototype, own-key, descriptor, and getter traps", () => {
    const prototypeTrap = new Proxy(
      {},
      {
        getPrototypeOf(): object | null {
          throw new Error("prototype trap");
        },
      },
    );
    const ownKeysTrap = new Proxy(
      {},
      {
        ownKeys(): ArrayLike<string | symbol> {
          throw new Error("own keys trap");
        },
      },
    );
    const getterTrap = new Proxy(
      { denominator: "1", numerator: "1", schema: "exact-rational@1" },
      {
        get(): unknown {
          throw new Error("getter trap");
        },
      },
    );
    const accessorSnapshot = Object.defineProperties(
      {},
      {
        denominator: { enumerable: true, value: "1" },
        numerator: { enumerable: true, value: "1" },
        schema: { enumerable: true, get: () => "exact-rational@1" },
      },
    );
    const invalidKeyTrap = new Proxy(
      {},
      {
        ownKeys(): ArrayLike<string | symbol> {
          return ["denominator", "numerator", "unexpected"];
        },
      },
    );

    expectExactNumericError(() => ExactRational.fromSnapshot(prototypeTrap), "SNAPSHOT_CONTENT");
    expectExactNumericError(() => ExactRational.fromSnapshot(ownKeysTrap), "SNAPSHOT_CONTENT");
    expectExactNumericError(() => ExactRational.fromSnapshot(getterTrap), "SNAPSHOT_CONTENT");
    expectExactNumericError(() => ExactRational.fromSnapshot(accessorSnapshot), "SNAPSHOT_CONTENT");
    expectExactNumericError(() => ExactRational.fromSnapshot(invalidKeyTrap), "SNAPSHOT_CONTENT");
  });

  it("rejects symbol and non-enumerable snapshot keys", () => {
    const marker = Symbol("marker");
    const symbolSnapshot = {
      denominator: "1",
      numerator: "1",
      schema: "exact-rational@1",
      [marker]: "extra",
    };
    const nonEnumerableSnapshot = { denominator: "1", numerator: "1", schema: "exact-rational@1" };
    Object.defineProperty(nonEnumerableSnapshot, "hidden", { enumerable: false, value: "extra" });

    expectExactNumericError(() => ExactRational.fromSnapshot(symbolSnapshot), "SNAPSHOT_CONTENT");
    expectExactNumericError(() => ExactRational.fromSnapshot(nonEnumerableSnapshot), "SNAPSHOT_CONTENT");
  });

  it.each<keyof ExactRationalSnapshot>(["schema", "numerator", "denominator"])(
    "rejects a non-enumerable required %s property",
    (field) => {
      const snapshot = withNonEnumerableSnapshotField(field);

      expectExactNumericError(() => ExactRational.fromSnapshot(snapshot), "SNAPSHOT_CONTENT");
    },
  );

  it("accepts only null or realm-native Object prototypes before validating snapshot keys", () => {
    class SnapshotContainer {
      public readonly kind = "container";
    }

    const customPrototypeSnapshot = createSnapshot();
    Object.setPrototypeOf(customPrototypeSnapshot, {});
    const nullParentCustomPrototype = createNullPrototypeObject();
    Object.defineProperty(fakeObjectConstructor, "prototype", { value: nullParentCustomPrototype });
    Object.defineProperty(nullParentCustomPrototype, "constructor", {
      configurable: true,
      value: fakeObjectConstructor,
    });
    const fakeConstructorSnapshot = createSnapshot();
    Object.setPrototypeOf(fakeConstructorSnapshot, nullParentCustomPrototype);
    const symbolTagSnapshot = createSnapshot();
    Object.defineProperty(symbolTagSnapshot, Symbol.toStringTag, { enumerable: false, value: "Object" });

    for (const input of [
      new Date(),
      new Map(),
      new SnapshotContainer(),
      customPrototypeSnapshot,
      fakeConstructorSnapshot,
      symbolTagSnapshot,
    ]) {
      expectExactNumericError(() => ExactRational.fromSnapshot(input), "SNAPSHOT_CONTENT");
    }
  });
});

describe("ExactRational arithmetic and conversion boundary", () => {
  it("performs exact arithmetic with independently specified results", () => {
    const left = ExactRational.from("2.5");
    const right = ExactRational.from("0.75");

    expect(left.add(right).toSnapshot()).toMatchObject({ numerator: "13", denominator: "4" });
    expect(left.subtract(right).toSnapshot()).toMatchObject({ numerator: "7", denominator: "4" });
    expect(left.multiply(right).toSnapshot()).toMatchObject({ numerator: "15", denominator: "8" });
    expect(left.divide(right).toSnapshot()).toMatchObject({ numerator: "10", denominator: "3" });
    expect(left.compare(right)).toBe(1);
    expect(right.compare(left)).toBe(-1);
    expect(left.compare(ExactRational.fromParts(5n, 2n))).toBe(0);
    expect(left.equals(ExactRational.from("2.5"))).toBe(true);
    expect(left.abs()).toBe(left);
    expect(ExactRational.from("-2.5").abs().toSnapshot()).toMatchObject({ numerator: "5", denominator: "2" });
    expect(left.negate().toSnapshot()).toMatchObject({ numerator: "-5", denominator: "2" });
  });

  it("distinguishes zero, sign, and integer states", () => {
    const zero = ExactRational.from(0n);
    const negative = ExactRational.from("-1.5");

    expect(zero.isZero()).toBe(true);
    expect(negative.isZero()).toBe(false);
    expect(negative.isNegative()).toBe(true);
    expect(zero.isNegative()).toBe(false);
    expect(ExactRational.from(7n).isInteger()).toBe(true);
    expect(negative.isInteger()).toBe(false);
  });

  it("rejects zero division and non-rational operation operands", () => {
    const rational = ExactRational.from(1n);

    expectExactNumericError(() => rational.divide(ExactRational.from(0n)), "DIVISION_ZERO");
    expectExactNumericError(() => rational.add(new Date()), "INVALID_RATIONAL");
    const operandProxy = new Proxy(
      {},
      {
        getPrototypeOf(): object | null {
          throw new Error("operand prototype trap");
        },
      },
    );
    expectExactNumericError(() => rational.add(operandProxy), "INVALID_RATIONAL");
  });

  it("maps proxy-wrapped rational private-field failures to INVALID_RATIONAL", () => {
    const rational = ExactRational.from(1n);
    const proxyOperand = new Proxy(ExactRational.from(2n), {});

    expectExactNumericError(() => rational.add(proxyOperand), "INVALID_RATIONAL");
    expectExactNumericError(() => rational.compare(proxyOperand), "INVALID_RATIONAL");
  });

  it.each<readonly [string, (receiver: ExactRational) => unknown]>([
    ["add", (receiver) => receiver.add(ExactRational.from(1n))],
    ["subtract", (receiver) => receiver.subtract(ExactRational.from(1n))],
    ["multiply", (receiver) => receiver.multiply(ExactRational.from(1n))],
    ["divide", (receiver) => receiver.divide(ExactRational.from(1n))],
    ["compare", (receiver) => receiver.compare(ExactRational.from(1n))],
    ["equals", (receiver) => receiver.equals(ExactRational.from(1n))],
    ["abs", (receiver) => receiver.abs()],
    ["negate", (receiver) => receiver.negate()],
    ["isZero", (receiver) => receiver.isZero()],
    ["isNegative", (receiver) => receiver.isNegative()],
    ["isInteger", (receiver) => receiver.isInteger()],
    ["toSnapshot", (receiver) => receiver.toSnapshot()],
    ["toJSON", (receiver) => receiver.toJSON()],
  ])("maps proxy receiver %s to INVALID_RATIONAL", (_methodName, invoke) => {
    const receiverProxy = new Proxy(ExactRational.from(1n), {});

    expectExactNumericError(() => invoke(receiverProxy), "INVALID_RATIONAL");
  });

  it("keeps proxy implicit conversion explicitly forbidden", () => {
    const receiverProxy = new Proxy(ExactRational.from(1n), {});

    expectExactNumericError(() => Number(receiverProxy), "IMPLICIT_COERCION");
  });

  it("rejects every implicit primitive conversion", () => {
    const rational = ExactRational.from("1.25");

    expectExactNumericError(() => Number(rational), "IMPLICIT_COERCION");
    expectExactNumericError(() => rational[Symbol.toPrimitive]("string"), "IMPLICIT_COERCION");
  });

  it("enforces one exact integer-digit bound before and after normalization", () => {
    const exclusiveMagnitudeBound = 10n ** BigInt(MAXIMUM_EXACT_INTEGER_DIGITS);
    const maximumMagnitude = exclusiveMagnitudeBound - 1n;
    const overMaximumMagnitude = exclusiveMagnitudeBound;
    const inverseMaximum = ExactRational.fromParts(1n, maximumMagnitude);

    expect(ExactRational.fromParts(maximumMagnitude, 1n).toSnapshot()).toMatchObject({
      denominator: "1",
      numerator: maximumMagnitude.toString(),
    });
    expect(ExactRational.fromParts(-maximumMagnitude, 1n).isNegative()).toBe(true);
    expect(ExactRational.fromParts(0n, maximumMagnitude).isZero()).toBe(true);
    expect(ExactRational.fromParts(1n, maximumMagnitude).toSnapshot()).toMatchObject({
      denominator: maximumMagnitude.toString(),
      numerator: "1",
    });
    expectExactNumericError(() => ExactRational.fromParts(overMaximumMagnitude, 1n), "MAGNITUDE_LIMIT");
    expectExactNumericError(() => ExactRational.fromParts(-overMaximumMagnitude, 1n), "MAGNITUDE_LIMIT");
    expectExactNumericError(() => ExactRational.fromParts(1n, overMaximumMagnitude), "MAGNITUDE_LIMIT");
    expectExactNumericError(() => ExactRational.fromParts(1n, -overMaximumMagnitude), "MAGNITUDE_LIMIT");
    expectExactNumericError(
      () =>
        ExactRational.fromParts(maximumMagnitude, 1n).multiply(ExactRational.fromParts(maximumMagnitude, 1n)),
      "MAGNITUDE_LIMIT",
    );
    expectExactNumericError(
      () => ExactRational.fromParts(maximumMagnitude, 1n).add(ExactRational.fromParts(maximumMagnitude, 1n)),
      "MAGNITUDE_LIMIT",
    );
    expectExactNumericError(
      () => ExactRational.fromParts(maximumMagnitude, 1n).divide(inverseMaximum),
      "MAGNITUDE_LIMIT",
    );
  });

  it("rejects oversized direct parts before text serialization", () => {
    const oversizedMagnitude = 10n ** 8192n;
    const toStringSpy = vi.spyOn(BigInt.prototype, "toString");

    try {
      expectExactNumericError(() => ExactRational.fromParts(oversizedMagnitude, 1n), "MAGNITUDE_LIMIT");
      expect(toStringSpy).not.toHaveBeenCalled();
    } finally {
      toStringSpy.mockRestore();
    }
  });
});
