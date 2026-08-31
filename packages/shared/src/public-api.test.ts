import { describe, expect, expectTypeOf, it } from "vitest";
import {
  ExactRational,
  HistoricalCandle,
  HistoricalCost,
  HistoricalEquitySnapshot,
  HistoricalPosition,
  HistoricalTrade,
  type HistoricalTradeSnapshot,
  UtcDurationMilliseconds,
  UtcEpochMilliseconds,
} from "@mm-crypto-bot/shared";
import { clamp } from "@mm-crypto-bot/shared/utils";

describe("shared public package API", () => {
  it("exports deterministic utility functions through the public subpath", () => {
    expect(clamp(11, 0, 10)).toBe(10);
  });

  it("exports the exact historical-data value contracts from the package root", () => {
    expect(typeof ExactRational.from).toBe("function");
    expect(typeof UtcEpochMilliseconds.fromCanonical).toBe("function");
    expect(typeof UtcDurationMilliseconds.fromCanonical).toBe("function");
    expect(typeof HistoricalCandle.fromSnapshot).toBe("function");
    expect(typeof HistoricalCost.create).toBe("function");
    expect(typeof HistoricalPosition.create).toBe("function");
    expect(typeof HistoricalTrade.create).toBe("function");
    expect(typeof HistoricalEquitySnapshot.create).toBe("function");
    expectTypeOf<HistoricalTradeSnapshot>().toExtend<{
      readonly schema: "historical-trade@1";
      readonly pnl: { readonly schema: "exact-rational@1" };
    }>();
  });
});
