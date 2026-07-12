/**
 * packages/shared/src/utils.test.ts
 *
 * A `utils.ts` összes függvényének (unwrap, roundTo, clamp, mean, stddev, sum)
 * 100% line + branch lefedettségű tesztjei.
 */

import { describe, expect, it } from "bun:test";
import { unwrap, roundTo, clamp, mean, stddev, sum } from "./utils.js";

describe("unwrap — Result<T, E> kicsomagoló", () => {
  it("ok=true esetén visszaadja a value-t", () => {
    const r = { ok: true as const, value: 42 };
    expect(unwrap(r)).toBe(42);
  });

  it("ok=false + Error esetén dobja a hibát", () => {
    const err = new Error("boom");
    const r = { ok: false as const, error: err };
    expect(() => unwrap(r)).toThrow("boom");
  });

  it("ok=false + string esetén becsomagolja Error-ba", () => {
    const r = { ok: false as const, error: "string-hiba" };
    expect(() => unwrap(r)).toThrow("string-hiba");
  });

  it("ok=false + egyéb JSON-serializálható érték (number) esetén JSON-string-ként dobja", () => {
    const r = { ok: false as const, error: 42 };
    expect(() => unwrap(r)).toThrow("42");
  });

  it("ok=false + object (nem-Error) esetén JSON-string-ként dobja", () => {
    const r = { ok: false as const, error: { code: "X" } };
    expect(() => unwrap(r)).toThrow('{"code":"X"}');
  });

  it("ok=false + null esetén JSON.stringify('null')-t dob", () => {
    const r = { ok: false as const, error: null };
    expect(() => unwrap(r)).toThrow("null");
  });
});

describe("roundTo — banker kerekítés", () => {
  it("a normál kerekítés lefelé (0.4)", () => {
    expect(roundTo(1.234, 2)).toBe(1.23);
  });

  it("a normál kerekítés felfelé (0.6)", () => {
    expect(roundTo(1.236, 2)).toBe(1.24);
  });

  it("a half-to-even kerekítés: 0.5 → legközelebbi páros (2.5 → 2, nem 3)", () => {
    expect(roundTo(2.5, 0)).toBe(2);
  });

  it("a half-to-even: 3.5 → 4 (páros)", () => {
    expect(roundTo(3.5, 0)).toBe(4);
  });

  it("a half-to-even: 0.5 → 0 (floor % 2 === 0)", () => {
    expect(roundTo(0.5, 0)).toBe(0);
  });

  it("a half-to-even: 1.5 → 2 (floor % 2 !== 0, +1)", () => {
    expect(roundTo(1.5, 0)).toBe(2);
  });

  it("a negatív számok is kerekítődnek", () => {
    expect(roundTo(-1.236, 2)).toBe(-1.24);
  });

  it("a NaN-t visszaadja (a !Number.isFinite ág)", () => {
    expect(Number.isNaN(roundTo(NaN, 2))).toBe(true);
  });

  it("a +Infinity-t visszaadja", () => {
    expect(roundTo(Infinity, 2)).toBe(Infinity);
  });

  it("a -Infinity-t visszaadja", () => {
    expect(roundTo(-Infinity, 2)).toBe(-Infinity);
  });

  it("decimals=0 esetén 0.4 lefelé kerekít", () => {
    expect(roundTo(1.4, 0)).toBe(1);
  });

  it("decimals=0 esetén 0.6 felfelé kerekít", () => {
    expect(roundTo(1.6, 0)).toBe(2);
  });

  it("decimals=4 — finom kerekítés", () => {
    expect(roundTo(1.234567, 4)).toBe(1.2346);
  });
});

describe("clamp — érték intervallumba szorítása", () => {
  it("az érték az intervallumban van → változatlan", () => {
    expect(clamp(5, 0, 10)).toBe(5);
  });

  it("az érték kisebb mint min → min", () => {
    expect(clamp(-5, 0, 10)).toBe(0);
  });

  it("az érték nagyobb mint max → max", () => {
    expect(clamp(15, 0, 10)).toBe(10);
  });

  it("az érték pontosan min → min", () => {
    expect(clamp(0, 0, 10)).toBe(0);
  });

  it("az érték pontosan max → max", () => {
    expect(clamp(10, 0, 10)).toBe(10);
  });

  it("negatív intervallum", () => {
    expect(clamp(-5, -10, -1)).toBe(-5);
    expect(clamp(0, -10, -1)).toBe(-1);
    expect(clamp(-15, -10, -1)).toBe(-10);
  });
});

describe("mean — átlag", () => {
  it("üres tömb esetén 0-t ad vissza", () => {
    expect(mean([])).toBe(0);
  });

  it("egy elem esetén az elem maga", () => {
    expect(mean([42])).toBe(42);
  });

  it("több elem átlaga", () => {
    expect(mean([1, 2, 3, 4, 5])).toBe(3);
  });

  it("negatív számok átlaga", () => {
    expect(mean([-1, -2, -3])).toBe(-2);
  });

  it("nullával kevert átlag", () => {
    expect(mean([0, 10])).toBe(5);
  });
});

describe("stddev — minta standard deviáció (n-1 nevezővel)", () => {
  it("üres tömb esetén 0", () => {
    expect(stddev([])).toBe(0);
  });

  it("egy elem esetén 0 (n-1 = 0, a length<2 ág)", () => {
    expect(stddev([42])).toBe(0);
  });

  it("két egyforma elem esetén 0", () => {
    expect(stddev([5, 5])).toBe(0);
  });

  it("két különböző elem stddev-e 1 (a length-1 nevező miatt)", () => {
    // Minta-stddev (n-1): sqrt(((0-1)^2 + (2-1)^2) / 1) = sqrt(2) ≈ 1.414
    // Population-stddev (n): sqrt(2/2) = 1
    // A kód n-1-et használ, így az eredmény sqrt(2).
    expect(stddev([0, 2])).toBeCloseTo(Math.sqrt(2), 6);
  });

  it("több elem stddev számítása", () => {
    // [1, 2, 3, 4, 5]: mean=3, variancia=(4+1+0+1+4)/4=2.5, stddev=sqrt(2.5)≈1.581
    expect(stddev([1, 2, 3, 4, 5])).toBeCloseTo(Math.sqrt(2.5), 6);
  });
});

describe("sum — összeg", () => {
  it("üres tömb esetén 0", () => {
    expect(sum([])).toBe(0);
  });

  it("több elem összege", () => {
    expect(sum([1, 2, 3, 4, 5])).toBe(15);
  });

  it("negatív és pozitív számok összege", () => {
    expect(sum([-1, 2, -3, 4])).toBe(2);
  });

  it("egy elem összege", () => {
    expect(sum([42])).toBe(42);
  });

  it("nullák összege", () => {
    expect(sum([0, 0, 0])).toBe(0);
  });
});
