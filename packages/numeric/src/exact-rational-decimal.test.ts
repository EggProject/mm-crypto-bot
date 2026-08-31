import { describe, expect, it } from "vitest";

import { ExactNumericError } from "./errors.js";
import { ExactRational } from "./exact-rational.js";

function expectExactNumericError(action: () => unknown, code: ExactNumericError["code"]): void {
  try {
    action();
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(ExactNumericError);
    expect(error).toMatchObject({ code });
    return;
  }

  throw new Error(`Expected ExactNumericError with code ${code}.`);
}

describe("ExactRational canonical decimal transport", () => {
  it.each<readonly [string, ExactRational, string]>([
    ["zero", ExactRational.from(0n), "0"],
    ["positive integer", ExactRational.from(42n), "42"],
    ["negative integer", ExactRational.from(-42n), "-42"],
    ["proper half", ExactRational.fromParts(1n, 2n), "0.5"],
    ["negative improper half", ExactRational.fromParts(-5n, 2n), "-2.5"],
    ["leading fractional zero", ExactRational.fromParts(1n, 20n), "0.05"],
    ["five-factor denominator", ExactRational.fromParts(1n, 25n), "0.04"],
    ["reduced terminating fraction", ExactRational.fromParts(50n, 100n), "0.5"],
    [
      "large terminating fraction",
      ExactRational.fromParts(123_456_789_123_456_789n, 8n),
      "15432098640432098.625",
    ],
  ])("serializes %s exactly without fractional padding", (_scenario, rational, expected) => {
    expect(rational.toCanonicalDecimal()).toBe(expected);
    expect(ExactRational.from(rational.toCanonicalDecimal()).equals(rational)).toBe(true);
  });

  it.each<readonly [string, bigint, bigint]>([
    ["1/3", 1n, 3n],
    ["1/6", 1n, 6n],
    ["22/7", 22n, 7n],
  ])("rejects non-terminating decimal %s", (_fraction, numerator, denominator) => {
    expectExactNumericError(
      () => ExactRational.fromParts(numerator, denominator).toCanonicalDecimal(),
      "NON_TERMINATING_DECIMAL",
    );
  });

  it("rejects an exact finite decimal that exceeds the transport budget", () => {
    const denominator = 2n ** 1023n;
    const rational = ExactRational.fromParts(1n, denominator);

    expectExactNumericError(() => rational.toCanonicalDecimal(), "DECIMAL_LENGTH");
  });

  it("rejects forged, proxied, and revoked receivers at the private brand boundary", () => {
    const proxied = new Proxy(ExactRational.from("0.5"), {});
    const revocable = Proxy.revocable(ExactRational.from("0.5"), {});
    revocable.revoke();

    expectExactNumericError(
      () => ExactRational.prototype.toCanonicalDecimal.call(Object.freeze({})),
      "INVALID_RATIONAL",
    );
    expectExactNumericError(() => proxied.toCanonicalDecimal(), "INVALID_RATIONAL");
    expectExactNumericError(
      () => ExactRational.prototype.toCanonicalDecimal.call(revocable.proxy),
      "INVALID_RATIONAL",
    );
  });
});
