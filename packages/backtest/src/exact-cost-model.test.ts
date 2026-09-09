import { describe, expect, it } from "vitest";

import { ExactRational } from "@mm-crypto-bot/shared";

import {
  applyExactSlippage,
  applyExactSpread,
  exactEntryFee,
  exactFundingCost,
  exactMarginBorrowCost,
  exactRoundTripFee,
  type ExactCostModel,
} from "./exact-cost-model.js";

const model: ExactCostModel = Object.freeze({
  borrowRatePerHour: ExactRational.from("0.0001"),
  fundingRatePer8h: ExactRational.from("0.0002"),
  slippageRate: ExactRational.from("0.001"),
  spreadRate: ExactRational.from("0.0002"),
  takerFeeRate: ExactRational.from("0.001"),
});

function expectExact(value: ExactRational, numerator: string, denominator: string): void {
  expect(value.toSnapshot()).toEqual({ denominator, numerator, schema: "exact-rational@1" });
}

describe("exact historical cost model", () => {
  it("applies slippage and half-spread without binary floating point", () => {
    expectExact(applyExactSlippage(ExactRational.from("100"), "buy", model.slippageRate), "1001", "10");
    expectExact(applyExactSlippage(ExactRational.from("100"), "sell", model.slippageRate), "999", "10");
    expectExact(applyExactSpread(ExactRational.from("100"), "buy", model.spreadRate), "10001", "100");
    expectExact(applyExactSpread(ExactRational.from("100"), "sell", model.spreadRate), "9999", "100");
  });

  it("charges exact fee, borrow, and funding by bigint duration", () => {
    expectExact(exactRoundTripFee(ExactRational.from("1000"), model), "2", "1");
    expectExact(exactMarginBorrowCost(ExactRational.from("500"), 7_200_000n, model), "1", "10");
    expectExact(exactFundingCost(ExactRational.from("1000"), 28_800_000n, model), "1", "5");
    expectExact(
      exactFundingCost(ExactRational.from("1000"), 28_800_000n, {
        ...model,
        fundingRatePer8h: ExactRational.from("0"),
      }),
      "0",
      "1",
    );
  });

  it("fails closed for negative duration and negative rates", () => {
    expect(() => exactMarginBorrowCost(ExactRational.from("1"), -1n, model)).toThrow("duration");
    expect(() => applyExactSlippage(ExactRational.from("1"), "buy", ExactRational.from("-0.1"))).toThrow(
      "rate",
    );
  });

  it("rejects forged and proxied rationals before custom methods can affect a calculation", () => {
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
      Reflect.apply(exactEntryFee, undefined, [
        ExactRational.from("1"),
        { ...model, takerFeeRate: proxiedRate },
      ]);
    }).toThrow("Exact rational operation requires an ExactRational operand.");
    expect(wasProxiedMethodAccessed).toBe(false);
  });

  it("rejects an invalid JavaScript order side instead of treating it as a sell", () => {
    expect(() => {
      Reflect.apply(applyExactSlippage, undefined, [ExactRational.from("100"), "hold", model.slippageRate]);
    }).toThrow("Order side must be buy or sell.");
  });
});
