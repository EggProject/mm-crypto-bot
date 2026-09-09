import { describe, expect, it } from "vitest";

import { ExactRational } from "@mm-crypto-bot/shared";

import * as exactCostModelModule from "./exact-cost-model.js";
import {
  applyExactSlippage,
  applyExactSpread,
  exactEntryFee,
  exactFundingCost,
  exactMarginBorrowCost,
  exactRoundTripFee,
} from "./exact-cost-model.js";
import type { ExactCostModel } from "./exact-cost-model.js";

function exactCostModelConfig(): object {
  return {
    borrowRatePerHour: ExactRational.from("0.0001"),
    fundingRatePer8h: ExactRational.from("0.0002"),
    slippageRate: ExactRational.from("0.001"),
    spreadRate: ExactRational.from("0.0002"),
    takerFeeRate: ExactRational.from("0.001"),
  };
}

interface ExactCostModelFactory {
  new (config: never, capability: never): object;
  create(input: unknown): ExactCostModel;
  requireAuthentic(input: unknown): ExactCostModel;
}

function isExactCostModelFactory(input: unknown): input is ExactCostModelFactory {
  return (
    typeof input === "function" &&
    typeof Reflect.get(input, "create") === "function" &&
    typeof Reflect.get(input, "requireAuthentic") === "function"
  );
}

function createExactCostModel(input: unknown): ExactCostModel {
  const factory = Reflect.get(exactCostModelModule, "ExactCostModel");
  expect(isExactCostModelFactory(factory)).toBe(true);
  if (!isExactCostModelFactory(factory)) {
    throw new Error("ExactCostModel factory is unavailable.");
  }
  return factory.create(input);
}

function requireExactCostModel(input: unknown): ExactCostModel {
  const factory = Reflect.get(exactCostModelModule, "ExactCostModel");
  expect(isExactCostModelFactory(factory)).toBe(true);
  if (!isExactCostModelFactory(factory)) {
    throw new Error("ExactCostModel factory is unavailable.");
  }
  return factory.requireAuthentic(input);
}

function isExactCostModelAuthenticator(input: unknown): input is (input: unknown) => ExactCostModel {
  return typeof input === "function";
}

function exactCostModelAuthenticator(): (input: unknown) => ExactCostModel {
  const factory = Reflect.get(exactCostModelModule, "ExactCostModel");
  if (!isExactCostModelFactory(factory)) {
    throw new Error("ExactCostModel factory is unavailable.");
  }
  const authenticator = Reflect.get(factory, "requireAuthentic");
  if (!isExactCostModelAuthenticator(authenticator)) {
    throw new Error("ExactCostModel authenticator is unavailable.");
  }
  return authenticator;
}

function exactCostModelPrototype(model: ExactCostModel): object {
  const prototype: unknown = Object.getPrototypeOf(model);
  if (typeof prototype !== "object" || prototype === null) {
    throw new Error("ExactCostModel prototype is unavailable.");
  }
  return prototype;
}

function expectExact(value: ExactRational, numerator: string, denominator: string): void {
  expect(value.toSnapshot()).toEqual({ denominator, numerator, schema: "exact-rational@1" });
}

describe("exact historical cost model", () => {
  it("applies slippage and half-spread without binary floating point", () => {
    const model = createExactCostModel(exactCostModelConfig());
    expectExact(applyExactSlippage(ExactRational.from("100"), "buy", model.slippageRate), "1001", "10");
    expectExact(applyExactSlippage(ExactRational.from("100"), "sell", model.slippageRate), "999", "10");
    expectExact(applyExactSpread(ExactRational.from("100"), "buy", model.spreadRate), "10001", "100");
    expectExact(applyExactSpread(ExactRational.from("100"), "sell", model.spreadRate), "9999", "100");
  });

  it("rejects zero input prices and non-positive sell adjustments", () => {
    expect(() => applyExactSlippage(ExactRational.from("0"), "buy", ExactRational.from("0"))).toThrow(
      "price",
    );
    expect(() => applyExactSlippage(ExactRational.from("1"), "sell", ExactRational.from("1"))).toThrow(
      "adjusted price factor",
    );
    expect(() => applyExactSpread(ExactRational.from("1"), "sell", ExactRational.from("2"))).toThrow(
      "adjusted price factor",
    );
  });

  it("rejects sell adjustments above the exact positive-factor boundary", () => {
    const invalidSellAdjustments = [
      {
        calculate: (): ExactRational =>
          applyExactSlippage(ExactRational.from("1"), "sell", ExactRational.from("1.1")),
        name: "slippage above one",
      },
      {
        calculate: (): ExactRational =>
          applyExactSpread(ExactRational.from("1"), "sell", ExactRational.from("2.1")),
        name: "spread above two",
      },
    ];

    for (const invalidSellAdjustment of invalidSellAdjustments) {
      expect(invalidSellAdjustment.calculate, invalidSellAdjustment.name).toThrow("adjusted price factor");
    }
  });

  it("authenticates immutable rate models from an untrusted configuration boundary", () => {
    const model = createExactCostModel(exactCostModelConfig());
    expect(Object.isFrozen(model)).toBe(true);
    expect(Object.isFrozen(model.takerFeeRate)).toBe(true);
    expect(requireExactCostModel(model)).toBe(model);
    expect(Reflect.set(model, "takerFeeRate", ExactRational.from("1"))).toBe(false);
    expectExact(model.takerFeeRate, "1", "1000");
  });

  it("rejects missing, extra, accessor, forged, proxied, and invalid model rates without getter access", () => {
    expect(() => createExactCostModel(undefined)).toThrow("configuration");

    const missingRate = { ...exactCostModelConfig() };
    Reflect.deleteProperty(missingRate, "takerFeeRate");
    expect(() => createExactCostModel(missingRate)).toThrow("configuration");

    const symbolRate = { ...exactCostModelConfig() };
    Reflect.deleteProperty(symbolRate, "takerFeeRate");
    Object.defineProperty(symbolRate, Symbol("unexpectedRate"), {
      enumerable: true,
      value: ExactRational.from("0"),
    });
    expect(() => createExactCostModel(symbolRate)).toThrow("configuration");

    expect(() =>
      createExactCostModel({ ...exactCostModelConfig(), unexpectedRate: ExactRational.from("0") }),
    ).toThrow("configuration");

    const nonPlainRate = { ...exactCostModelConfig() };
    Object.setPrototypeOf(nonPlainRate, Date.prototype);
    expect(() => createExactCostModel(nonPlainRate)).toThrow("configuration");

    const descriptorFailingRate = new Proxy(exactCostModelConfig(), {
      getOwnPropertyDescriptor: (): never => {
        throw new Error("descriptor inspection must fail closed");
      },
    });
    expect(() => createExactCostModel(descriptorFailingRate)).toThrow("configuration");

    let getterCallCount = 0;
    const accessorRate = { ...exactCostModelConfig() };
    Object.defineProperty(accessorRate, "takerFeeRate", {
      enumerable: true,
      get: (): ExactRational => {
        getterCallCount += 1;
        return ExactRational.from("0.001");
      },
    });
    expect(() => createExactCostModel(accessorRate)).toThrow("configuration");
    expect(getterCallCount).toBe(0);

    const forgedRate = {};
    Object.setPrototypeOf(forgedRate, ExactRational.prototype);
    expect(() => createExactCostModel({ ...exactCostModelConfig(), takerFeeRate: forgedRate })).toThrow(
      "Exact rational",
    );

    const proxiedRate = new Proxy(ExactRational.from("0.001"), {
      get: (): never => {
        throw new Error("proxy property access must not occur");
      },
    });
    expect(() => createExactCostModel({ ...exactCostModelConfig(), takerFeeRate: proxiedRate })).toThrow(
      "Exact rational",
    );

    expect(() =>
      createExactCostModel({ ...exactCostModelConfig(), borrowRatePerHour: ExactRational.from("-0.1") }),
    ).toThrow("borrow rate");
    expect(() =>
      createExactCostModel({ ...exactCostModelConfig(), slippageRate: ExactRational.from("1") }),
    ).toThrow("slippage rate");
    expect(() =>
      createExactCostModel({ ...exactCostModelConfig(), spreadRate: ExactRational.from("2") }),
    ).toThrow("spread rate");

    const excessiveModelRates = [
      {
        config: { ...exactCostModelConfig(), slippageRate: ExactRational.from("1.1") },
        error: "slippage rate",
        name: "slippage rate above one",
      },
      {
        config: { ...exactCostModelConfig(), spreadRate: ExactRational.from("2.1") },
        error: "spread rate",
        name: "spread rate above two",
      },
    ];
    for (const excessiveModelRate of excessiveModelRates) {
      expect(() => createExactCostModel(excessiveModelRate.config), excessiveModelRate.name).toThrow(
        excessiveModelRate.error,
      );
    }

    const negativeModelRates = [
      {
        config: { ...exactCostModelConfig(), takerFeeRate: ExactRational.from("-0.1") },
        error: "taker fee rate",
        name: "taker fee rate",
      },
      {
        config: { ...exactCostModelConfig(), slippageRate: ExactRational.from("-0.1") },
        error: "slippage rate",
        name: "slippage rate",
      },
      {
        config: { ...exactCostModelConfig(), spreadRate: ExactRational.from("-0.1") },
        error: "spread rate",
        name: "spread rate",
      },
      {
        config: { ...exactCostModelConfig(), borrowRatePerHour: ExactRational.from("-0.1") },
        error: "borrow rate",
        name: "borrow rate",
      },
    ];
    for (const negativeModelRate of negativeModelRates) {
      expect(() => createExactCostModel(negativeModelRate.config), negativeModelRate.name).toThrow(
        negativeModelRate.error,
      );
    }

    const factory = Reflect.get(exactCostModelModule, "ExactCostModel");
    expect(isExactCostModelFactory(factory)).toBe(true);
    if (!isExactCostModelFactory(factory)) {
      throw new Error("ExactCostModel factory is unavailable.");
    }
    expect(() => {
      Reflect.construct(factory, [exactCostModelConfig(), Symbol("forged-construction-capability")]);
    }).toThrow("construction");
  });

  it("rejects forged and proxied models before property access", () => {
    const model = createExactCostModel(exactCostModelConfig());
    let forgedModelGetterCalls = 0;
    const forgedModel = {};
    Object.setPrototypeOf(forgedModel, exactCostModelPrototype(model));
    Object.defineProperty(forgedModel, "takerFeeRate", {
      get: (): ExactRational => {
        forgedModelGetterCalls += 1;
        return ExactRational.from("1");
      },
    });
    expect(() => {
      Reflect.apply(exactEntryFee, undefined, [ExactRational.from("1"), forgedModel]);
    }).toThrow("Exact cost model");
    expect(forgedModelGetterCalls).toBe(0);

    const proxiedModel = new Proxy(model, {
      get: (): never => {
        throw new Error("proxy property access must not occur");
      },
    });
    expect(() => Reflect.apply(exactEntryFee, undefined, [ExactRational.from("1"), proxiedModel])).toThrow(
      "Exact cost model",
    );
  });

  it("rejects trapping and revoked model proxies without prototype traversal", () => {
    const model = createExactCostModel(exactCostModelConfig());
    const authenticator = exactCostModelAuthenticator();
    const factory = Reflect.get(exactCostModelModule, "ExactCostModel");
    if (!isExactCostModelFactory(factory)) {
      throw new Error("ExactCostModel factory is unavailable.");
    }
    let prototypeTrapCallCount = 0;
    const trappingProxy = new Proxy(model, {
      getPrototypeOf: (): object => {
        prototypeTrapCallCount += 1;
        return exactCostModelPrototype(model);
      },
    });

    expect(() => Reflect.apply(authenticator, factory, [trappingProxy])).toThrow("Exact cost model");
    expect(prototypeTrapCallCount).toBe(0);

    const revocableProxy = Proxy.revocable(model, {});
    revocableProxy.revoke();
    expect(() => Reflect.apply(authenticator, factory, [revocableProxy.proxy])).toThrow("Exact cost model");
  });

  it("uses lexical model identity when the authenticator is detached", () => {
    const model = createExactCostModel(exactCostModelConfig());
    const authenticator = exactCostModelAuthenticator();
    const fakeReceiver = Object.freeze({});

    expect(Reflect.apply(authenticator, fakeReceiver, [model])).toBe(model);
    expect(() => Reflect.apply(authenticator, fakeReceiver, [{}])).toThrow("Exact cost model");
  });

  it("charges exact fee and borrow costs by bigint duration", () => {
    const model = createExactCostModel(exactCostModelConfig());
    expectExact(exactRoundTripFee(ExactRational.from("1000"), model), "2", "1");
    expectExact(exactMarginBorrowCost(ExactRational.from("500"), 7_200_000n, model), "1", "10");
  });

  it("charges signed funding by long or short side", () => {
    const positiveRate = createExactCostModel({
      ...exactCostModelConfig(),
      fundingRatePer8h: ExactRational.from("0.0002"),
    });
    expectExact(exactFundingCost(ExactRational.from("1000"), 28_800_000n, positiveRate, "long"), "1", "5");
    expectExact(exactFundingCost(ExactRational.from("1000"), 28_800_000n, positiveRate, "short"), "-1", "5");

    const negativeRate = createExactCostModel({
      ...exactCostModelConfig(),
      fundingRatePer8h: ExactRational.from("-0.0002"),
    });
    expectExact(exactFundingCost(ExactRational.from("1000"), 28_800_000n, negativeRate, "long"), "-1", "5");
    expectExact(exactFundingCost(ExactRational.from("1000"), 28_800_000n, negativeRate, "short"), "1", "5");
    expectExact(exactFundingCost(ExactRational.from("1000"), 3_600_000n, positiveRate, "long"), "1", "40");
  });

  it("returns exact zero funding for both position sides", () => {
    const zeroFunding = createExactCostModel({
      ...exactCostModelConfig(),
      fundingRatePer8h: ExactRational.from("0"),
    });
    expectExact(exactFundingCost(ExactRational.from("1000"), 28_800_000n, zeroFunding, "long"), "0", "1");
    expectExact(exactFundingCost(ExactRational.from("1000"), 28_800_000n, zeroFunding, "short"), "0", "1");
  });

  it("fails closed for invalid sides, negative durations, and negative notionals", () => {
    const model = createExactCostModel(exactCostModelConfig());
    expect(() => exactMarginBorrowCost(ExactRational.from("1"), -1n, model)).toThrow("duration");
    expect(() => exactFundingCost(ExactRational.from("1"), -1n, model, "long")).toThrow("duration");
    expect(() => exactFundingCost(ExactRational.from("-1"), 1n, model, "long")).toThrow("notional");
    expect(() => {
      Reflect.apply(exactFundingCost, undefined, [ExactRational.from("1"), 1n, model, "flat"]);
    }).toThrow("Position side");
    expect(() => applyExactSlippage(ExactRational.from("1"), "buy", ExactRational.from("-0.1"))).toThrow(
      "rate",
    );
  });

  it("rejects forged and proxied rationals before custom methods can affect a calculation", () => {
    const model = createExactCostModel(exactCostModelConfig());
    let forgedMethodCallCount = 0;
    const forgedRational = {
      isNegative: (): boolean => {
        forgedMethodCallCount += 1;
        return false;
      },
      multiply: (): ExactRational => {
        forgedMethodCallCount += 1;
        return ExactRational.from("999");
      },
    };
    Object.setPrototypeOf(forgedRational, ExactRational.prototype);

    expect(() => {
      Reflect.apply(applyExactSlippage, undefined, [forgedRational, "buy", model.slippageRate]);
    }).toThrow("Exact rational operation requires an ExactRational operand.");
    expect(forgedMethodCallCount).toBe(0);

    let wasProxiedMethodAccessed = false;
    const proxiedRate = new Proxy(ExactRational.from("0.1"), {
      get: (_target, property): unknown => {
        if (property === "isNegative" || property === "multiply") {
          wasProxiedMethodAccessed = true;
          return (): boolean => false;
        }

        return undefined;
      },
    });

    expect(() => {
      Reflect.apply(applyExactSlippage, undefined, [ExactRational.from("1"), "buy", proxiedRate]);
    }).toThrow("Exact rational operation requires an ExactRational operand.");
    expect(wasProxiedMethodAccessed).toBe(false);
  });

  it("rejects an invalid JavaScript order side instead of treating it as a sell", () => {
    const model = createExactCostModel(exactCostModelConfig());
    expect(() => {
      Reflect.apply(applyExactSlippage, undefined, [ExactRational.from("100"), "hold", model.slippageRate]);
    }).toThrow("Order side must be buy or sell.");
  });
});
