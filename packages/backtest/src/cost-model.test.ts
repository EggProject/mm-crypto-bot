// packages/backtest/src/cost-model.test.ts — a költség-modell unit-tesztek
//
// 100%-os coverage: minden függvény, minden ág.

import { describe, expect, it } from "bun:test";

import type { CostModel } from "./types.js";

import {
  applySlippage,
  applySpread,
  entryCost,
  exitCost,
  fundingCost,
  marginBorrowCost,
  totalTradeCost,
} from "./cost-model.js";

const DEFAULT_MODEL: CostModel = {
  takerFeeRate: 0.001,
  slippageRate: 0.0005,
  spreadRate: 0.0002,
  borrowRatePerHour: 0.0001,
};

describe("applySlippage", () => {
  it("long entry: az ár felfelé tolódik a slippage-pel", () => {
    expect(applySlippage(100, "buy", 0.001)).toBe(100.1);
  });

  it("short entry: az ár lefelé tolódik a slippage-pel", () => {
    expect(applySlippage(100, "sell", 0.001)).toBe(99.9);
  });

  it("negatív rate esetén hibát dob", () => {
    expect(() => applySlippage(100, "buy", -0.001)).toThrow();
  });
});

describe("applySpread", () => {
  it("buy oldalon: az ár felfelé tolódik a spread felével", () => {
    // 100 * (1 + 0.0002/2) = 100.01
    expect(applySpread(100, "buy", 0.0002)).toBe(100.01);
  });

  it("sell oldalon: az ár lefelé tolódik a spread felével", () => {
    // 100 * (1 - 0.0002/2) = 99.99
    expect(applySpread(100, "sell", 0.0002)).toBe(99.99);
  });

  it("negatív rate esetén hibát dob", () => {
    expect(() => applySpread(100, "buy", -0.0002)).toThrow();
  });
});

describe("entryCost / exitCost", () => {
  it("entryCost = notional * takerFeeRate", () => {
    expect(entryCost(1000, DEFAULT_MODEL)).toBe(1); // 1000 * 0.001
  });

  it("exitCost = notional * takerFeeRate (ugyanaz, mint az entry)", () => {
    expect(exitCost(1000, DEFAULT_MODEL)).toBe(1);
  });
});

describe("marginBorrowCost", () => {
  it("kiszámítja a margin-kamatot a holding időre", () => {
    // 1000 * 0.0001 * 24 = 2.4
    expect(marginBorrowCost(1000, 24, DEFAULT_MODEL)).toBeCloseTo(2.4, 10);
  });

  it("negatív holding time esetén hibát dob", () => {
    expect(() => marginBorrowCost(1000, -1, DEFAULT_MODEL)).toThrow();
  });

  it("0 holding time esetén 0 a költség", () => {
    expect(marginBorrowCost(1000, 0, DEFAULT_MODEL)).toBe(0);
  });
});

describe("fundingCost", () => {
  it("ha nincs funding rate, 0 a költség", () => {
    expect(fundingCost(1000, 24, DEFAULT_MODEL)).toBe(0);
  });

  it("ha van funding rate, kiszámítja a 8h-s fundingot", () => {
    const model: CostModel = { ...DEFAULT_MODEL, fundingRatePer8h: 0.0001 };
    // 1000 * 0.0001 * (24/8) = 0.3
    expect(fundingCost(1000, 24, model)).toBeCloseTo(0.3, 10);
  });

  it("negatív holding time esetén hibát dob (funding rate esetén)", () => {
    const model: CostModel = { ...DEFAULT_MODEL, fundingRatePer8h: 0.0001 };
    expect(() => fundingCost(1000, -1, model)).toThrow();
  });
});

describe("totalTradeCost", () => {
  it("a teljes round-trip költséget adja (fee + borrow + funding)", () => {
    const model: CostModel = { ...DEFAULT_MODEL, fundingRatePer8h: 0.0001 };
    const result = totalTradeCost(1000, 500, 24, model);
    // fees: 1000 * 0.001 * 2 = 2
    // borrow: 500 * 0.0001 * 24 = 1.2
    // funding: 1000 * 0.0001 * 3 = 0.3
    expect(result.feesUsd).toBe(2);
    expect(result.borrowUsd).toBeCloseTo(1.2, 10);
    expect(result.fundingUsd).toBeCloseTo(0.3, 10);
  });

  it("funding nélkül is helyesen működik", () => {
    const result = totalTradeCost(1000, 500, 24, DEFAULT_MODEL);
    expect(result.feesUsd).toBe(2);
    expect(result.borrowUsd).toBeCloseTo(1.2, 10);
    expect(result.fundingUsd).toBe(0);
  });
});
