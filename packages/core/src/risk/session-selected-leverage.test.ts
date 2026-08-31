import { describe, expect, test } from "bun:test";

import { SelectedLeverage } from "@mm-crypto-bot/numeric";

import { assertSelectedLeverageUnchanged, freezeSelectedLeverage } from "./session-selected-leverage.js";

describe("session selected leverage", () => {
  test("keeps an exact selected leverage frozen for its session", () => {
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

  test("rejects forged, proxied, and revoked values", () => {
    const frozen = freezeSelectedLeverage(SelectedLeverage.parse("2.5"));
    const proxiedFrozen = new Proxy(frozen, {});
    const proxiedCandidate = new Proxy(SelectedLeverage.parse("2.5"), {});
    const revocableFrozen = Proxy.revocable(frozen, {});
    const nonSelectedFrozen = {};
    const fakeFrozen = {};
    const nonSelectedCandidate = {};
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
      Reflect.apply(assertSelectedLeverageUnchanged, undefined, [
        nonSelectedFrozen,
        SelectedLeverage.parse("2.5"),
      ]);
    }).toThrow("Frozen selected leverage must be an authentic session value.");
    expect(() => {
      Reflect.apply(assertSelectedLeverageUnchanged, undefined, [fakeFrozen, SelectedLeverage.parse("2.5")]);
    }).toThrow("Frozen selected leverage must be an authentic session value.");
    expect(() => {
      Reflect.apply(assertSelectedLeverageUnchanged, undefined, [frozen, nonSelectedCandidate]);
    }).toThrow("Selected leverage must be an authentic selected leverage value.");
    expect(() => {
      Reflect.apply(assertSelectedLeverageUnchanged, undefined, [frozen, fakeCandidate]);
    }).toThrow("Selected leverage must be an authentic selected leverage value.");
  });

  test("has an immutable wrapper surface", () => {
    const frozen = freezeSelectedLeverage(SelectedLeverage.parse("2.5"));
    const prototype = Reflect.getPrototypeOf(frozen);

    expect(Reflect.set(frozen, "selected", SelectedLeverage.initialBaseline)).toBe(false);
    expect(Object.isFrozen(frozen)).toBe(true);
    expect(Object.isFrozen(prototype)).toBe(true);
    expect(Object.isFrozen(frozen.constructor)).toBe(true);
    expect(frozen.selected.canonical).toBe("2.5");
  });

  test("rejects a forged wrapper constructor and selected leverage input", () => {
    const frozen = freezeSelectedLeverage(SelectedLeverage.parse("2.5"));
    const fakeCandidate = {};
    const candidatePrototype = Reflect.getPrototypeOf(SelectedLeverage.parse("2.5"));
    expect(Reflect.setPrototypeOf(fakeCandidate, candidatePrototype)).toBe(true);

    expect(() => {
      Reflect.apply(freezeSelectedLeverage, undefined, [fakeCandidate]);
    }).toThrow("Selected leverage must be an authentic selected leverage value.");
    expect(() => {
      Reflect.construct(frozen.constructor, [SelectedLeverage.parse("2.5"), Symbol("forged")]);
    }).toThrow("Frozen selected leverage construction is not permitted.");
  });
});
