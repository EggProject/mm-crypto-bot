import { describe, expect, it } from "vitest";

import { MAXIMUM_CANONICAL_DECIMAL_LENGTH } from "./canonical.js";
import { ExactNumericError } from "./errors.js";
import { ExactRational } from "./exact-rational.js";
import { SelectedLeverage } from "./selected-leverage.js";

function expectInvalidSelectedLeverage(action: () => unknown): void {
  try {
    action();
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(ExactNumericError);
    if (error instanceof ExactNumericError) {
      expect(error.code).toBe("INVALID_INPUT");
      return;
    }
  }

  throw new Error("Expected SelectedLeverage to reject the input.");
}

describe("SelectedLeverage", () => {
  it("preserves a canonical positive decimal as an immutable exact value", () => {
    const leverage = SelectedLeverage.parse("2.5");

    expect(leverage.canonical).toBe("2.5");
    expect(leverage.exact.toSnapshot()).toEqual({
      denominator: "2",
      numerator: "5",
      schema: "exact-rational@1",
    });
    expect(leverage.toJSON()).toBe("2.5");
    expect(JSON.stringify(leverage)).toBe('"2.5"');
    expect(Object.isFrozen(leverage)).toBe(true);
  });

  it("uses exact comparisons across separately parsed instances", () => {
    const lower = SelectedLeverage.parse("2.5");
    const same = SelectedLeverage.parse("2.5");
    const higher = SelectedLeverage.parse("10");

    expect(lower.equals(same)).toBe(true);
    expect(lower.compare(same)).toBe(0);
    expect(lower.compare(higher)).toBe(-1);
    expect(higher.compare(lower)).toBe(1);
  });

  it("provides exact 10 as the immutable initial baseline", () => {
    expect(SelectedLeverage.initialBaseline.canonical).toBe("10");
    expect(SelectedLeverage.parse("10").equals(SelectedLeverage.initialBaseline)).toBe(true);
    expect(Object.isFrozen(SelectedLeverage.initialBaseline)).toBe(true);
  });

  it.each(["", " 2", "2 ", "+2", "2e0", "02", "2.0", "0", "0.0", "-2"])(
    "rejects the noncanonical or nonpositive string %j",
    (input) => {
      expect(() => SelectedLeverage.parse(input)).toThrow(ExactNumericError);
    },
  );

  it.each([
    ["number", 2],
    ["bigint", 2n],
    ["undefined", undefined],
    ["object", {}],
    ["array", []],
  ])("rejects %s non-string input", (_description, input) => {
    expect(() => SelectedLeverage.parse(input)).toThrow(ExactNumericError);
  });

  it("rejects forged construction and does not allow a dynamic parse receiver to change zero", () => {
    const forgedExact = ExactRational.from("10");
    const forgedReceiver = { zero: ExactRational.from("-1") };

    expectInvalidSelectedLeverage(() => Reflect.construct(SelectedLeverage, ["10", forgedExact]));
    expectInvalidSelectedLeverage(() =>
      Reflect.construct(SelectedLeverage, ["10", forgedExact, Symbol("forged")]),
    );
    expectInvalidSelectedLeverage(() => SelectedLeverage.parse.apply(forgedReceiver, ["0"]));
  });

  it("rejects forged, detached, and proxy instance receivers and operands", () => {
    const leverage = SelectedLeverage.parse("2.5");
    const proxied = new Proxy(leverage, {});

    expectInvalidSelectedLeverage(() => Reflect.get(Object.create(SelectedLeverage.prototype), "canonical"));
    expectInvalidSelectedLeverage(() => Reflect.get(Object.create(SelectedLeverage.prototype), "exact"));
    expectInvalidSelectedLeverage(() => SelectedLeverage.prototype.toJSON.call(undefined));
    expectInvalidSelectedLeverage(() => proxied.toJSON());
    expectInvalidSelectedLeverage(() =>
      SelectedLeverage.prototype.equals.call(leverage, Object.create(proxied)),
    );
    expectInvalidSelectedLeverage(() => leverage.compare(proxied));
  });

  it("freezes the static surface and prevents instance property mutation", () => {
    const leverage = SelectedLeverage.parse("2.5");
    const baseline = SelectedLeverage.initialBaseline;

    expect(Reflect.set(SelectedLeverage, "zero", ExactRational.from("-1"))).toBe(false);
    expect(Reflect.set(SelectedLeverage, "parse", () => SelectedLeverage.parse("2"))).toBe(false);
    expect(Reflect.set(SelectedLeverage, "initialBaseline", SelectedLeverage.parse("2"))).toBe(false);
    expect(Reflect.defineProperty(SelectedLeverage, "zero", { value: ExactRational.from("-1") })).toBe(false);
    expect(Reflect.defineProperty(SelectedLeverage, "parse", { value: () => "blocked" })).toBe(false);
    expect(
      Reflect.defineProperty(SelectedLeverage, "initialBaseline", { value: SelectedLeverage.parse("2") }),
    ).toBe(false);
    expect(Reflect.set(leverage, "canonical", "100")).toBe(false);
    expect(Reflect.set(leverage, "exact", ExactRational.from("100"))).toBe(false);
    expect(Reflect.defineProperty(leverage, "canonical", { value: "100" })).toBe(false);
    expect(Reflect.defineProperty(leverage, "exact", { value: ExactRational.from("100") })).toBe(false);
    expect(Object.hasOwn(leverage, "canonical")).toBe(false);
    expect(Object.hasOwn(leverage, "exact")).toBe(false);
    expect(SelectedLeverage.initialBaseline).toBe(baseline);
    expect(SelectedLeverage.initialBaseline.canonical).toBe("10");
    expect(leverage.canonical).toBe("2.5");
  });

  it.each([
    ["NaN", NaN],
    ["positive infinity", Infinity],
    ["negative infinity", -Infinity],
    ["negative zero", -0],
    ["null", Object.getPrototypeOf(Object.prototype)],
    ["boolean", true],
    ["function", () => "blocked"],
    ["proxy", new Proxy({}, {})],
    ["oversized decimal", "1".repeat(MAXIMUM_CANONICAL_DECIMAL_LENGTH + 1)],
  ])("rejects adversarial %s input", (_description, input) => {
    expect(() => SelectedLeverage.parse(input)).toThrow(ExactNumericError);
  });

  it("keeps zero rejected after attempted ExactRational runtime mutations", () => {
    const baseline = SelectedLeverage.initialBaseline;

    expect(Reflect.set(ExactRational.prototype, "compare", () => 1)).toBe(false);
    expect(Reflect.set(ExactRational, "from", () => Object.freeze({ compare: () => 1 }))).toBe(false);
    expect(() => SelectedLeverage.parse("0")).toThrow(ExactNumericError);
    expect(SelectedLeverage.initialBaseline).toBe(baseline);
    expect(SelectedLeverage.initialBaseline.canonical).toBe("10");
  });
});
