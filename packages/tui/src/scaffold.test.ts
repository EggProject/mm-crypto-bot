/**
 * Scaffold-stage placeholder test.
 * TODO: a Phase 4 implementacioban ezt csereljuk ki tenyleges TUI
 * komponens / hook unit tesztekre (Ink `render` snapshot tesztek,
 * provider state transition tesztek).
 *
 * Megjegyzes: az `apps/*` es `packages/*` scaffold testjei szandekosan
 * NEM importaljak a sajat index.(t)tsx-juket, mert azok CLI / Ink
 * belepesi pontok, amik modul-szinten side effect-eket futtatnak
 * (pl. `if (import.meta.main) main()`). A fedezet merese a
 * komponensekre es a provider-ekre fokuszal.
 */
import { describe, expect, it } from "bun:test";

describe(`${process.cwd().split("/").pop()} scaffold`, () => {
  it("loads", () => {
    expect(1 + 1).toBe(2);
  });
});