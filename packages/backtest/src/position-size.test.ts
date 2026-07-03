// packages/backtest/src/position-size.test.ts — a position-sizing unit-tesztek

import { describe, expect, it } from "bun:test";

import { DEFAULT_POSITION_SIZE } from "./types.js";

import { kellyFraction, kellyPositionFraction, positionNotionalUsd, stopDistancePct } from "./position-size.js";

describe("stopDistancePct", () => {
  it("long pozíció: stop a belépő alatt", () => {
    // entry=100, stop=95 → 5%
    expect(stopDistancePct(100, 95)).toBe(0.05);
  });

  it("short pozíció: stop a belépő felett", () => {
    // entry=100, stop=105 → 5%
    expect(stopDistancePct(100, 105)).toBe(0.05);
  });

  it("entry ≤ 0 esetén hibát dob", () => {
    expect(() => stopDistancePct(0, 95)).toThrow();
  });

  it("stop ≤ 0 esetén hibát dob", () => {
    expect(() => stopDistancePct(100, 0)).toThrow();
  });
});

describe("positionNotionalUsd", () => {
  it("a klasszikus Kelly-formula szerinti notional-t adja", () => {
    // equity=10000, riskPerTrade=0.01, stop=5%
    // notional = 10000 * 0.01 / 0.05 = 2000
    const notional = positionNotionalUsd(10000, 100, 95, DEFAULT_POSITION_SIZE);
    expect(notional).toBe(2000);
  });

  it("a max position clamp érvényesül, ha a notional túl nagy", () => {
    // equity=10000, stop=0.1% (kis stop) → notional = 10000 * 0.01 / 0.001 = 100000
    // max = 10000 * 0.2 = 2000
    const notional = positionNotionalUsd(10000, 100, 99.9, DEFAULT_POSITION_SIZE);
    expect(notional).toBe(2000);
  });

  it("a min position clamp érvényesül, ha a notional túl kicsi", () => {
    // equity=10000, stop=99% → notional = 10000 * 0.01 / 0.99 = 101.01
    // min = 10000 * 0.01 = 100
    const notional = positionNotionalUsd(10000, 100, 1, DEFAULT_POSITION_SIZE);
    expect(notional).toBe(101.01010101010101);
  });

  it("a min position clamp érvényesül, ha a stop nagyon messze van (notional < min)", () => {
    // equity=10000, entry=100, stop=300 (200% felette)
    // stopDistancePct = 200/100 = 2.0
    // notional = 10000 * 0.01 / 2 = 50
    // min = 100
    // A min clamp érvényesül.
    const notional = positionNotionalUsd(10000, 100, 300, DEFAULT_POSITION_SIZE);
    expect(notional).toBe(100);
  });

  it("a stop == entry esetén egy minimum stop-távolságot alkalmaz", () => {
    // stop=100 (megegyezik az entry-vel) → 0.1% minimum stop-távolság
    // notional = 10000 * 0.01 / 0.001 = 100000
    // max = 2000
    const notional = positionNotionalUsd(10000, 100, 100, DEFAULT_POSITION_SIZE);
    expect(notional).toBe(2000);
  });

  it("equity ≤ 0 esetén hibát dob", () => {
    expect(() => positionNotionalUsd(0, 100, 95, DEFAULT_POSITION_SIZE)).toThrow();
  });
});

describe("kellyFraction", () => {
  it("a klasszikus Kelly-képlet", () => {
    // W=0.35, R=4 → Kelly = 0.35 - 0.65/4 = 0.1875
    expect(kellyFraction(0.35, 4)).toBeCloseTo(0.1875, 10);
  });

  it("negatív Kelly% esetén 0-t ad", () => {
    // W=0.10, R=1 → Kelly = 0.10 - 0.90/1 = -0.80 → 0
    expect(kellyFraction(0.1, 1)).toBe(0);
  });

  it("win rate < 0 esetén hibát dob", () => {
    expect(() => kellyFraction(-0.1, 4)).toThrow();
  });

  it("win rate > 1 esetén hibát dob", () => {
    expect(() => kellyFraction(1.1, 4)).toThrow();
  });

  it("R ≤ 0 esetén hibát dob", () => {
    expect(() => kellyFraction(0.5, 0)).toThrow();
  });
});

describe("kellyPositionFraction", () => {
  it("a Kelly% és a szorzó szorzatát adja", () => {
    // Kelly = 0.1875, szorzó = 0.25 → 0.046875
    expect(kellyPositionFraction(0.35, 4, 0.25)).toBeCloseTo(0.046875, 10);
  });

  it("negatív Kelly% esetén 0-t ad", () => {
    expect(kellyPositionFraction(0.1, 1, 0.25)).toBe(0);
  });

  it("szorzó < 0 esetén hibát dob", () => {
    expect(() => kellyPositionFraction(0.5, 4, -0.1)).toThrow();
  });

  it("szorzó > 1 esetén hibát dob", () => {
    expect(() => kellyPositionFraction(0.5, 4, 1.1)).toThrow();
  });
});
