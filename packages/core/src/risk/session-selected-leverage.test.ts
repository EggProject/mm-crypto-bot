import { describe, expect, test } from "bun:test";

import { SelectedLeverage } from "@mm-crypto-bot/numeric";

import { assertSelectedLeverageUnchanged, freezeSelectedLeverage } from "./session-selected-leverage.js";

describe("session selected leverage", () => {
  test("accepts separately parsed exact equal selected leverage", () => {
    const frozen = freezeSelectedLeverage(SelectedLeverage.parse("2.5"));

    expect(() => {
      assertSelectedLeverageUnchanged(frozen, SelectedLeverage.parse("2.5"));
    }).not.toThrow();
    expect(frozen.selected.canonical).toBe("2.5");
  });

  test("rejects a changed selected leverage", () => {
    const frozen = freezeSelectedLeverage(SelectedLeverage.initialBaseline);

    expect(() => {
      assertSelectedLeverageUnchanged(frozen, SelectedLeverage.parse("2.5"));
    }).toThrow("Selected leverage is immutable for a session.");
  });

  test("rejects reflection replacement of the frozen selection", () => {
    const frozen = freezeSelectedLeverage(SelectedLeverage.parse("2.5"));

    expect(Reflect.set(frozen, "selected", SelectedLeverage.initialBaseline)).toBe(false);
    expect(Reflect.defineProperty(frozen, "selected", { value: SelectedLeverage.initialBaseline })).toBe(
      false,
    );
    expect(Object.isFrozen(frozen)).toBe(true);
    expect(frozen.selected.canonical).toBe("2.5");
  });

  test("rejects proxy, revoked, and forged wrapper or candidate values before comparison", () => {
    const frozen = freezeSelectedLeverage(SelectedLeverage.parse("2.5"));
    const proxiedFrozen = new Proxy(frozen, {});
    const proxiedCandidate = new Proxy(SelectedLeverage.parse("2.5"), {});
    const revocableFrozen = Proxy.revocable(frozen, {});
    const fakeFrozen = {};
    const fakeCandidate = {};
    const frozenPrototype = Reflect.getPrototypeOf(frozen);
    const candidatePrototype = Reflect.getPrototypeOf(SelectedLeverage.parse("2.5"));
    expect(Reflect.setPrototypeOf(fakeFrozen, frozenPrototype)).toBe(true);
    expect(Reflect.setPrototypeOf(fakeCandidate, candidatePrototype)).toBe(true);
    revocableFrozen.revoke();

    expect(() => {
      assertSelectedLeverageUnchanged(proxiedFrozen, SelectedLeverage.parse("2.5"));
    }).toThrow("Frozen selected leverage must be an authentic session value.");
    expect(() => {
      assertSelectedLeverageUnchanged(frozen, proxiedCandidate);
    }).toThrow("Selected leverage must be an authentic selected leverage value.");
    expect(() => {
      assertSelectedLeverageUnchanged(revocableFrozen.proxy, SelectedLeverage.parse("2.5"));
    }).toThrow("Frozen selected leverage must be an authentic session value.");
    expect(() => {
      Reflect.apply(assertSelectedLeverageUnchanged, undefined, [fakeFrozen, SelectedLeverage.parse("2.5")]);
    }).toThrow("Frozen selected leverage must be an authentic session value.");
    expect(() => {
      Reflect.apply(assertSelectedLeverageUnchanged, undefined, [frozen, fakeCandidate]);
    }).toThrow("Selected leverage must be an authentic selected leverage value.");
  });

  test("freezes the internal wrapper type surface", () => {
    const frozen = freezeSelectedLeverage(SelectedLeverage.parse("2.5"));
    const prototype = Reflect.getPrototypeOf(frozen);

    if (prototype === null) {
      throw new TypeError("Frozen selected leverage has no prototype.");
    }

    expect(Object.isFrozen(prototype)).toBe(true);
    expect(Object.isFrozen(frozen.constructor)).toBe(true);
    expect(Reflect.set(prototype, "selected", SelectedLeverage.initialBaseline)).toBe(false);
  });

  test("rejects direct construction through the reflected private wrapper constructor", () => {
    const frozen = freezeSelectedLeverage(SelectedLeverage.parse("2.5"));

    expect(() => {
      Reflect.construct(frozen.constructor, [SelectedLeverage.parse("2.5"), Symbol("forged")]);
    }).toThrow("Frozen selected leverage construction is not permitted.");
  });

  test("rejects a non-selected-leverage candidate at the runtime boundary", () => {
    const frozen = freezeSelectedLeverage(SelectedLeverage.parse("2.5"));

    expect(() => {
      Reflect.apply(assertSelectedLeverageUnchanged, undefined, [frozen, {}]);
    }).toThrow("Selected leverage must be an authentic selected leverage value.");
  });
});
