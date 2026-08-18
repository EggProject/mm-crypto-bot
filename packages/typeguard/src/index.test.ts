import { describe, expect, expectTypeOf, it } from "vitest";
import { runInNewContext } from "node:vm";

import {
  isBoolean,
  isConstructor,
  isDate,
  isFunction,
  isInstanceOf,
  isInteger,
  isNil,
  isNonEmptyArray,
  isNumber,
  isRecord,
  isString,
} from "./index";

const callable = (): undefined => undefined;

describe("typeguard foundation", () => {
  it("narrows primitive and structural unknown values", () => {
    expect(isString("value")).toBe(true);
    expect(isString(1)).toBe(false);
    expect(isBoolean(true)).toBe(true);
    expect(isBoolean("true")).toBe(false);
    expect(isNumber(7)).toBe(true);
    expect(isNumber(Infinity)).toBe(false);
    expect(isInteger(7)).toBe(true);
    expect(isInteger(7.5)).toBe(false);
    // eslint-disable-next-line unicorn/no-null -- The guard must distinguish null from undefined.
    expect(isNil(null)).toBe(true);
    expect(isNil(undefined)).toBe(true);
    expect(isNil("value")).toBe(false);
    expect(isRecord({ value: 1 })).toBe(true);
    expect(isRecord(Object.create(null))).toBe(true);
    expect(isRecord([])).toBe(false);
    expect(isRecord(new Date(0))).toBe(false);
    expect(isRecord(new Map())).toBe(false);
    class RecordCandidate {
      public readonly kind = "candidate";
    }
    expect(isRecord(new RecordCandidate())).toBe(false);
    // eslint-disable-next-line unicorn/no-null -- The guard must distinguish null from an object.
    expect(isRecord(null)).toBe(false);
    let prototypeTrapCalls = 0;
    const prototypeTrap = new Proxy(
      {},
      {
        getPrototypeOf() {
          prototypeTrapCalls += 1;
          throw new Error("prototype unavailable");
        },
      },
    );
    expect(isRecord(prototypeTrap)).toBe(false);
    expect(prototypeTrapCalls).toBe(1);
  });

  it("narrows callable, constructor, instance, date, and array boundaries", () => {
    class Item {
      public readonly identifier = "item";
    }
    const invalidDate = new Date("invalid");

    expect(isFunction(callable)).toBe(true);
    expect(isFunction({})).toBe(false);
    expect(isConstructor(Item)).toBe(true);
    expect(isConstructor(callable)).toBe(false);
    expect(isConstructor({})).toBe(false);
    expect(isInstanceOf(new Item(), Item)).toBe(true);
    expect(isInstanceOf({}, Item)).toBe(false);
    expect(isDate(new Date(0))).toBe(true);
    const crossRealmDate: unknown = runInNewContext("new Date(0)");
    expect(isDate(crossRealmDate)).toBe(true);
    expect(isDate(invalidDate)).toBe(false);
    const datePrototypeObject: unknown = Object.create(Date.prototype);
    expect(isDate(datePrototypeObject)).toBe(false);
    expect(isDate({})).toBe(false);
    expect(isDate("date")).toBe(false);
    // eslint-disable-next-line unicorn/no-null -- The guard must reject a nil input at the date boundary.
    expect(isDate(null)).toBe(false);
    let datePrototypeTrapCalls = 0;
    const dateProxy = new Proxy(new Date(0), {
      getPrototypeOf() {
        datePrototypeTrapCalls += 1;
        throw new Error("date prototype unavailable");
      },
    });
    expect(isDate(dateProxy)).toBe(false);
    expect(datePrototypeTrapCalls).toBe(0);
    expect(isNonEmptyArray(["value"])).toBe(true);
    expect(isNonEmptyArray([])).toBe(false);

    const unknownValue: unknown = "value";
    if (isString(unknownValue)) expectTypeOf(unknownValue).toEqualTypeOf<string>();
  });
});
