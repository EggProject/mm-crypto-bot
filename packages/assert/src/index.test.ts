import { describe, expect, expectTypeOf, it } from "vitest";

import {
  AssertionError,
  assertDefined,
  assertInteger,
  assertNonEmptyArray,
  assertRecord,
  assertString,
} from "./index";

describe("assert foundation", () => {
  it("narrows validated values", () => {
    const text: unknown = "value";
    const record: unknown = { value: true };
    const values: unknown = ["value"];
    const integer: unknown = 7;
    const nullable: string | undefined = "value";

    assertString(text, "text required");
    assertRecord(record, "record required");
    assertNonEmptyArray(values, "values required");
    assertInteger(integer, "integer required");
    assertDefined(nullable, "value required");

    expectTypeOf(text).toEqualTypeOf<string>();
    expectTypeOf(record).toEqualTypeOf<Record<string, unknown>>();
    expectTypeOf(values[0]).toEqualTypeOf<unknown>();
    expectTypeOf(integer).toEqualTypeOf<number>();
    expectTypeOf(nullable).toEqualTypeOf<string>();
  });

  it("throws one typed error shape for every failed assertion", () => {
    expect(() => {
      assertString(1, "text required");
    }).toThrow(AssertionError);
    expect(() => {
      assertRecord([], "record required");
    }).toThrow("record required");
    expect(() => {
      assertNonEmptyArray([], "values required");
    }).toThrow("values required");
    expect(() => {
      assertInteger(1.5, "integer required");
    }).toThrow("integer required");
    expect(() => {
      assertDefined(undefined, "value required");
    }).toThrow("value required");
  });
});
