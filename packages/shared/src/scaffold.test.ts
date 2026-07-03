/**
 * Scaffold-stage placeholder test.
 * A `Phase 3 strategy + backtest` PR hozza a valódi teszteket (a
 * `core/src/indicators/*.test.ts` és a `backtest/src/*.test.ts` fájlokban);
 * ez a placeholder azért maradt, hogy a `bun run test` a Phase 3 PR előtt
 * is zöld legyen minden package-ben.
 */
import { describe, expect, it } from "bun:test";
import "./index.js";

describe(`${process.cwd().split("/").pop()} scaffold`, () => {
  it("loads", () => {
    expect(1 + 1).toBe(2);
  });
});