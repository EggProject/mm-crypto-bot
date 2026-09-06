import { describe, expect, it } from "vitest";

import { ExactRational } from "@mm-crypto-bot/numeric";

import {
  ArbLatencyArtifactSnapshotError,
  ArbLatencyArtifactSnapshotRedactedCause,
  readClosedArtifactArray as readClosedArtifactArrayWithMaximum,
  readClosedArtifactRecord,
  snapshotArtifactExactRational,
  type ArbLatencyArtifactSnapshotErrorCode,
  type ArbLatencyArtifactSnapshotFailurePhase,
} from "./arb-latency-artifact-v2-snapshot-primitives.js";

const TEST_MAXIMUM_ARRAY_LENGTH = 16;

function readClosedArtifactArray(input: unknown, label: string): readonly unknown[] {
  return readClosedArtifactArrayWithMaximum(input, label, TEST_MAXIMUM_ARRAY_LENGTH);
}

function expectFailure(
  action: () => unknown,
  code: ArbLatencyArtifactSnapshotErrorCode,
): ArbLatencyArtifactSnapshotError {
  try {
    action();
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(ArbLatencyArtifactSnapshotError);
    if (error instanceof ArbLatencyArtifactSnapshotError) {
      expect(error.code).toBe(code);
      return error;
    }
  }
  throw new Error(`Expected artifact snapshot failure with ${code}.`);
}

function expectRedactedFailure(action: () => unknown, phase: ArbLatencyArtifactSnapshotFailurePhase): void {
  const failure = expectFailure(action, "REFLECTION_FAILURE");
  expect(failure.cause).toBeInstanceOf(ArbLatencyArtifactSnapshotRedactedCause);
  if (failure.cause instanceof ArbLatencyArtifactSnapshotRedactedCause) {
    expect(failure.cause.code).toBe("UNTRUSTED_ARTIFACT_INPUT");
    expect(failure.cause.phase).toBe(phase);
    expect(failure.cause.cause).toBeUndefined();
  }
  expect(`${failure.message} ${failure.cause instanceof Error ? failure.cause.message : ""}`).not.toContain(
    "SECRET=/home/private/key",
  );
}

describe("arb latency artifact v2 snapshot primitives", () => {
  it("snapshots an exact closed record without executing getters or serializers", () => {
    let getterCalls = 0;
    let serializerCalls = 0;
    const input = {
      amount: "1000",
      schema: "artifact@2",
      toJSON(): never {
        serializerCalls += 1;
        throw new Error("must not serialize");
      },
    };
    Object.defineProperty(input, "secret", {
      enumerable: true,
      get(): never {
        getterCalls += 1;
        throw new Error("must not get");
      },
    });

    expectFailure(() => readClosedArtifactRecord(input, ["amount", "schema"], "record"), "RECORD_SHAPE");
    expect(getterCalls).toBe(0);
    expect(serializerCalls).toBe(0);

    const source = { amount: "1000", schema: "artifact@2" };
    const snapshot = readClosedArtifactRecord(source, ["amount", "schema"], "record");
    source.amount = "changed";
    expect(snapshot).toEqual({ amount: "1000", schema: "artifact@2" });
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.getPrototypeOf(snapshot)).toBe(Object.prototype);
    expect(Reflect.set(snapshot, "amount", "changed")).toBe(false);
  });

  it("rejects every invalid record shape and wraps reflection failures without exposing values", () => {
    const nullInput: unknown = JSON.parse("null");
    expectFailure(() => readClosedArtifactRecord(nullInput, ["a"], "record"), "RECORD_SHAPE");
    expectFailure(() => readClosedArtifactRecord([], ["a"], "record"), "RECORD_SHAPE");
    expectFailure(() => readClosedArtifactRecord({ a: 1 }, ["a", "a"], "record"), "RECORD_SHAPE");
    expectFailure(() => readClosedArtifactRecord({ a: 1 }, [""], "record"), "RECORD_SHAPE");
    expectFailure(() => readClosedArtifactRecord({ a: 1 }, ["b"], "record"), "RECORD_SHAPE");
    expectFailure(() => readClosedArtifactRecord({ a: 1 }, ["a"], ""), "RECORD_SHAPE");
    expectFailure(
      () => readClosedArtifactRecord(Object.defineProperty({}, "a", { value: 1 }), ["a"], "record"),
      "RECORD_SHAPE",
    );
    expectFailure(
      () =>
        readClosedArtifactRecord(
          {
            get a(): unknown {
              return "secret";
            },
          },
          ["a"],
          "record",
        ),
      "RECORD_SHAPE",
    );
    expectFailure(() => readClosedArtifactRecord({ a: 1, b: 2 }, ["a"], "record"), "RECORD_SHAPE");
    expectFailure(
      () => readClosedArtifactRecord({ a: 1, [Symbol("x")]: 2 }, ["a"], "record"),
      "RECORD_SHAPE",
    );

    const reflectionCause = new Error("private value");
    const throwingProxy = new Proxy(
      { a: 1 },
      {
        ownKeys(): never {
          throw reflectionCause;
        },
      },
    );
    expectRedactedFailure(() => readClosedArtifactRecord(throwingProxy, ["a"], "record"), "RECORD_OWN_KEYS");
  });

  it("snapshots dense array entries once and preserves entry identities", () => {
    let getterCalls = 0;
    let iteratorCalls = 0;
    let serializerCalls = 0;
    const entry = { immutableIdentity: true };
    const source = [entry, "two"];
    Object.defineProperties(source, {
      [Symbol.iterator]: {
        configurable: true,
        value(): never {
          iteratorCalls += 1;
          throw new Error("must not iterate");
        },
      },
      getter: {
        configurable: true,
        get(): never {
          getterCalls += 1;
          throw new Error("must not get");
        },
      },
      toJSON: {
        configurable: true,
        value(): never {
          serializerCalls += 1;
          throw new Error("must not serialize");
        },
      },
    });
    expectFailure(() => readClosedArtifactArray(source, "array"), "ARRAY_SHAPE");
    expect(getterCalls).toBe(0);
    expect(iteratorCalls).toBe(0);
    expect(serializerCalls).toBe(0);

    const valid = [entry, "two"];
    const snapshot = readClosedArtifactArray(valid, "array");
    valid[0] = "changed";
    valid.push("three");
    expect(snapshot).toEqual([entry, "two"]);
    expect(snapshot[0]).toBe(entry);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Reflect.set(snapshot, "0", "changed")).toBe(false);
    expect(readClosedArtifactArray([], "array")).toEqual([]);
  });

  it("rejects holes, accessor entries, extras, and malformed length descriptors", () => {
    expectFailure(() => readClosedArtifactArray({}, "array"), "ARRAY_SHAPE");
    expectFailure(() => readClosedArtifactArray([], ""), "ARRAY_SHAPE");
    const allHoles: unknown[] = [undefined, undefined];
    expect(Reflect.deleteProperty(allHoles, "0")).toBe(true);
    expect(Reflect.deleteProperty(allHoles, "1")).toBe(true);
    expectFailure(() => readClosedArtifactArray(allHoles, "array"), "ARRAY_SHAPE");
    const leadingHole: unknown[] = [undefined, "value"];
    expect(Reflect.deleteProperty(leadingHole, "0")).toBe(true);
    expectFailure(() => readClosedArtifactArray(leadingHole, "array"), "ARRAY_SHAPE");
    const middleHole: unknown[] = ["first", undefined, "third"];
    expect(Reflect.deleteProperty(middleHole, "1")).toBe(true);
    expectFailure(() => readClosedArtifactArray(middleHole, "array"), "ARRAY_SHAPE");
    const trailingHole: unknown[] = ["value", undefined];
    expect(Reflect.deleteProperty(trailingHole, "1")).toBe(true);
    expectFailure(() => readClosedArtifactArray(trailingHole, "array"), "ARRAY_SHAPE");
    const trailingOmission = ["value"];
    trailingOmission.length = 3;
    expectFailure(() => readClosedArtifactArray(trailingOmission, "array"), "ARRAY_SHAPE");
    const accessor = ["value"];
    Object.defineProperty(accessor, "0", {
      configurable: true,
      get(): unknown {
        return "value";
      },
    });
    expectFailure(() => readClosedArtifactArray(accessor, "array"), "ARRAY_SHAPE");
    for (const invalidLength of ["not-a-number", -1, Infinity]) {
      const invalidLengthDescriptor = new Proxy(["value"], {
        getOwnPropertyDescriptor(target, property): PropertyDescriptor | undefined {
          if (property === "length") {
            return { configurable: false, enumerable: false, value: invalidLength, writable: true };
          }
          return Reflect.getOwnPropertyDescriptor(target, property);
        },
      });
      expectFailure(() => readClosedArtifactArray(invalidLengthDescriptor, "array"), "ARRAY_SHAPE");
    }
    const missingIndexDescriptor = new Proxy([], {
      getOwnPropertyDescriptor(target, property): PropertyDescriptor | undefined {
        if (property === "0") {
          return undefined;
        }
        return Reflect.getOwnPropertyDescriptor(target, property);
      },
      ownKeys(): ArrayLike<string | symbol> {
        return ["0", "length"];
      },
    });
    expectFailure(() => readClosedArtifactArray(missingIndexDescriptor, "array"), "ARRAY_SHAPE");
    const extra = ["value"];
    Object.defineProperty(extra, "metadata", { enumerable: false, value: "extra" });
    expectFailure(() => readClosedArtifactArray(extra, "array"), "ARRAY_SHAPE");
    expectFailure(
      () => readClosedArtifactArray(Object.assign(["value"], { "00": "extra" }), "array"),
      "ARRAY_SHAPE",
    );
    expectFailure(
      () => readClosedArtifactArray(Object.assign(["value"], { "12345678901": "extra" }), "array"),
      "ARRAY_SHAPE",
    );
    expectFailure(
      () => readClosedArtifactArray(Object.assign(["value"], { "1a": "extra" }), "array"),
      "ARRAY_SHAPE",
    );
    expectFailure(
      () => readClosedArtifactArray(Object.assign(["value"], { "4294967295": "extra" }), "array"),
      "ARRAY_SHAPE",
    );
    const symbolProperty = ["value"];
    Object.defineProperty(symbolProperty, Symbol("extra"), { value: "extra" });
    expectFailure(() => readClosedArtifactArray(symbolProperty, "array"), "ARRAY_SHAPE");
    expect(readClosedArtifactArray(Object.freeze(["value"]), "array")).toEqual(["value"]);
    expectFailure(() => readClosedArtifactArrayWithMaximum([], "array", 0), "ARRAY_SHAPE");
    expectFailure(() => readClosedArtifactArrayWithMaximum([], "array", Infinity), "ARRAY_SHAPE");
    expectFailure(() => readClosedArtifactArrayWithMaximum(["first", "second"], "array", 1), "ARRAY_SHAPE");
  });

  it("reads every accepted array descriptor exactly once and preserves hostile reflection causes", () => {
    let indexReads = 0;
    let lengthReads = 0;
    const countingProxy = new Proxy(["value"], {
      getOwnPropertyDescriptor(target, property): PropertyDescriptor | undefined {
        if (property === "0") {
          indexReads += 1;
        } else if (property === "length") {
          lengthReads += 1;
        }
        return Reflect.getOwnPropertyDescriptor(target, property);
      },
    });
    expect(readClosedArtifactArray(countingProxy, "array")).toEqual(["value"]);
    expect(indexReads).toBe(1);
    expect(lengthReads).toBe(1);

    const descriptorCause = new Error("proxy detail");
    const shiftedIndexProxy = new Proxy(["value"], {
      getOwnPropertyDescriptor(target, property): PropertyDescriptor | undefined {
        if (property === "1") {
          return { configurable: true, enumerable: true, value: "synthetic", writable: true };
        }
        return Reflect.getOwnPropertyDescriptor(target, property);
      },
      ownKeys(): ArrayLike<string | symbol> {
        return ["1", "length"];
      },
    });
    expectFailure(() => readClosedArtifactArray(shiftedIndexProxy, "array"), "ARRAY_SHAPE");

    const throwingLengthProxy = new Proxy(["value"], {
      getOwnPropertyDescriptor(_target, property): PropertyDescriptor | undefined {
        if (property === "length") {
          throw descriptorCause;
        }
        return undefined;
      },
    });
    expectRedactedFailure(
      () => readClosedArtifactArray(throwingLengthProxy, "array"),
      "ARRAY_LENGTH_DESCRIPTOR",
    );
  });

  it("redacts every untrusted reflection cause across public boundaries", () => {
    const sentinel = new Error("SECRET=/home/private/key");
    expectRedactedFailure(
      () =>
        readClosedArtifactRecord(
          new Proxy(
            { a: "value" },
            {
              ownKeys: () => {
                throw sentinel;
              },
            },
          ),
          ["a"],
          "record",
        ),
      "RECORD_OWN_KEYS",
    );
    expectRedactedFailure(
      () =>
        readClosedArtifactRecord(
          new Proxy(
            { a: "value" },
            {
              getOwnPropertyDescriptor: () => {
                throw sentinel;
              },
            },
          ),
          ["a"],
          "record",
        ),
      "RECORD_DESCRIPTOR",
    );
    expectRedactedFailure(
      () =>
        readClosedArtifactArray(
          new Proxy(["value"], {
            ownKeys: () => {
              throw sentinel;
            },
          }),
          "array",
        ),
      "ARRAY_OWN_KEYS",
    );
    const revokedRecord = Proxy.revocable({ a: "value" }, {});
    revokedRecord.revoke();
    expectRedactedFailure(
      () => readClosedArtifactRecord(revokedRecord.proxy, ["a"], "record"),
      "RECORD_OWN_KEYS",
    );
    expectRedactedFailure(
      () =>
        readClosedArtifactArray(
          new Proxy(["value"], {
            getOwnPropertyDescriptor: () => {
              throw sentinel;
            },
          }),
          "array",
        ),
      "ARRAY_LENGTH_DESCRIPTOR",
    );
    const revokedArray = Proxy.revocable(["value"], {});
    revokedArray.revoke();
    expectRedactedFailure(() => readClosedArtifactArray(revokedArray.proxy, "array"), "ARRAY_CLASSIFICATION");
    expectRedactedFailure(
      () =>
        readClosedArtifactArray(
          new Proxy(["value"], {
            getOwnPropertyDescriptor(target, key) {
              if (key === "0") throw sentinel;
              return Reflect.getOwnPropertyDescriptor(target, key);
            },
          }),
          "array",
        ),
      "ARRAY_INDEX_DESCRIPTOR",
    );
    const rationalSpoof = new Proxy(ExactRational.from("1"), {
      getPrototypeOf: () => {
        throw sentinel;
      },
    });
    const rationalFailure = expectFailure(
      () => snapshotArtifactExactRational(rationalSpoof, "rational"),
      "RATIONAL_VALUE",
    );
    expect(rationalFailure.cause).toBeInstanceOf(ArbLatencyArtifactSnapshotRedactedCause);
    if (rationalFailure.cause instanceof ArbLatencyArtifactSnapshotRedactedCause) {
      expect(rationalFailure.cause.phase).toBe("EXACT_RATIONAL_SNAPSHOT");
      expect(rationalFailure.cause.cause).toBeUndefined();
      expect(rationalFailure.cause.message).not.toContain("SECRET=/home/private/key");
    }
  });

  it("reconstructs an independent frozen exact rational and preserves numeric causes", () => {
    const source = ExactRational.from("12.5");
    const snapshot = snapshotArtifactExactRational(source, "notional");
    expect(snapshot.equals(source)).toBe(true);
    expect(snapshot).not.toBe(source);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expectFailure(() => snapshotArtifactExactRational({}, "notional"), "RATIONAL_VALUE");
    expectFailure(() => snapshotArtifactExactRational(source, ""), "RATIONAL_VALUE");

    const forged = new Proxy(source, {});
    const failure = expectFailure(() => snapshotArtifactExactRational(forged, "notional"), "RATIONAL_VALUE");
    expect(failure.cause).toBeInstanceOf(Error);
  });
});
