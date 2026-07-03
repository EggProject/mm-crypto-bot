/**
 * Scaffold-stage placeholder test.
 * Todel: a Phase 3 implementacioban ezt csereljuk ki tenyleges unit tesztekre.
 *
 * Megjegyzes: az apps/* scaffold testjei szandekosan NEM importaljak a
 * sajat index.(t)tsx-juket, mert azok CLI/Ink belepesi pontok, amik
 * modul-szinten side effect-eket futtatnak. A fedezet merese a
 * package-ekre fókuszál.
 */
import { describe, expect, it } from "bun:test";

describe(`${process.cwd().split("/").pop()} scaffold`, () => {
  it("loads", () => {
    expect(1 + 1).toBe(2);
  });
});
