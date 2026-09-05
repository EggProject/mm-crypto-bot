import { describe, expect, it } from "vitest";

import { ExactNumericError } from "./errors.js";
import { ExactRational } from "./exact-rational.js";

function expectInvalidRational(action: () => unknown): void {
  try {
    action();
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(ExactNumericError);
    if (error instanceof ExactNumericError) {
      expect(error.code).toBe("INVALID_RATIONAL");
      return;
    }
  }

  throw new Error("Expected ExactNumericError with code INVALID_RATIONAL.");
}

function createForwardingBoundMethodProxy(authentic: ExactRational): ExactRational {
  return new Proxy(authentic, {
    get(_target, property) {
      switch (property) {
        case Symbol.toPrimitive: {
          return authentic[Symbol.toPrimitive].bind(authentic);
        }
        case "abs": {
          return authentic.abs.bind(authentic);
        }
        case "add": {
          return authentic.add.bind(authentic);
        }
        case "compare": {
          return authentic.compare.bind(authentic);
        }
        case "divide": {
          return authentic.divide.bind(authentic);
        }
        case "equals": {
          return authentic.equals.bind(authentic);
        }
        case "isInteger": {
          return authentic.isInteger.bind(authentic);
        }
        case "isNegative": {
          return authentic.isNegative.bind(authentic);
        }
        case "isZero": {
          return authentic.isZero.bind(authentic);
        }
        case "multiply": {
          return authentic.multiply.bind(authentic);
        }
        case "negate": {
          return authentic.negate.bind(authentic);
        }
        case "subtract": {
          return authentic.subtract.bind(authentic);
        }
        case "toCanonicalDecimal": {
          return authentic.toCanonicalDecimal.bind(authentic);
        }
        case "toJSON": {
          return authentic.toJSON.bind(authentic);
        }
        case "toSnapshot": {
          return authentic.toSnapshot.bind(authentic);
        }
        default: {
          return;
        }
      }
    },
  });
}

describe("ExactRational authentication", () => {
  it("returns the original authentic immutable exact rational", () => {
    const authentic = ExactRational.from("2.5");

    expect(ExactRational.requireAuthentic(authentic)).toBe(authentic);
    expect(Object.isFrozen(ExactRational)).toBe(true);
  });

  it("authenticates detached static calls independently of their receiver", () => {
    const authentic = ExactRational.from("2.5");
    const detachedRequireAuthentic = ExactRational.requireAuthentic;
    const fakeReceiver = Object.freeze({});

    expect(Reflect.apply(detachedRequireAuthentic, fakeReceiver, [authentic])).toBe(authentic);
    expectInvalidRational(() => Reflect.apply(detachedRequireAuthentic, fakeReceiver, [Object.freeze({})]));
  });

  it("rejects unauthentic values even when they mimic an exact rational", () => {
    const authentic = ExactRational.from("2.5");
    const forgedPrototype: object = {};
    Object.setPrototypeOf(forgedPrototype, ExactRational.prototype);
    Object.freeze(forgedPrototype);
    const bareProxy = new Proxy(authentic, {});
    const forwardingProxy = createForwardingBoundMethodProxy(authentic);
    const revocable = Proxy.revocable(authentic, {});
    revocable.revoke();

    for (const invalid of [Object.freeze({}), forgedPrototype, bareProxy, forwardingProxy, revocable.proxy]) {
      expectInvalidRational(() => ExactRational.requireAuthentic(invalid));
    }
  });
});
