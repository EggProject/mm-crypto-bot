import { describe, expect, it } from "vitest";

import {
  ExactRational,
  HistoricalCandle,
  HistoricalCost,
  HistoricalEquitySnapshot,
  HistoricalPosition,
  HistoricalTrade,
  UtcDurationMilliseconds,
  UtcEpochMilliseconds,
  parseHistoricalCandleDto,
} from "./exact-historical-market-data.js";

const openTime = UtcEpochMilliseconds.fromCanonical("1722470400000");
const closeTime = UtcEpochMilliseconds.fromCanonical("1722470460000");
const invalidSnapshot = (): Record<string, never> => ({});

function withInvalidSnapshot<T extends object>(input: T): T {
  return new Proxy(input, { get: () => invalidSnapshot });
}

describe("UtcEpochMilliseconds", () => {
  it("accepts an unsigned canonical BigInt transport string and serializes it exactly", () => {
    const timestamp = UtcEpochMilliseconds.fromCanonical("0");

    expect(timestamp.toCanonical()).toBe("0");
    expect(timestamp.toSnapshot()).toEqual({ schema: "utc-epoch-milliseconds@1", value: "0" });
  });

  it.each(["", "+1", "01", "-1", "1.0", "1e3", "1_000", " 1"])(
    "rejects noncanonical UTC epoch input %s",
    (input) => {
      expect(() => UtcEpochMilliseconds.fromCanonical(input)).toThrow("canonical unsigned decimal");
    },
  );

  it("rejects non-string and malformed timestamp snapshots", () => {
    expect(() => UtcEpochMilliseconds.fromCanonical(1n)).toThrow("canonical unsigned decimal");
    expect(() =>
      UtcEpochMilliseconds.fromSnapshot({ schema: "utc-epoch-milliseconds@2", value: "1" }),
    ).toThrow("schema");
    expect(() =>
      UtcEpochMilliseconds.fromSnapshot({ schema: "utc-epoch-milliseconds@1", value: "01" }),
    ).toThrow("canonical unsigned decimal");
  });

  it("adds and subtracts immutable exact bigint durations without negative timestamps", () => {
    const timestamp = UtcEpochMilliseconds.fromCanonical("10");
    const forward = UtcDurationMilliseconds.fromCanonical("5");
    const backward = UtcDurationMilliseconds.fromCanonical("-3");

    expect(timestamp.addMilliseconds(forward).toCanonical()).toBe("15");
    expect(timestamp.addMilliseconds(backward).toCanonical()).toBe("7");
    expect(timestamp.difference(UtcEpochMilliseconds.fromCanonical("13")).toCanonical()).toBe("-3");
    expect(forward.toSnapshot()).toEqual({ schema: "utc-duration-milliseconds@1", value: "5" });
    expect(UtcDurationMilliseconds.fromSnapshot(forward.toSnapshot()).equals(forward)).toBe(true);
    expect(Object.isFrozen(forward)).toBe(true);
    expect(() => timestamp.addMilliseconds(UtcDurationMilliseconds.fromCanonical("-11"))).toThrow(
      "negative timestamp",
    );
    expect(() => UtcDurationMilliseconds.fromCanonical("-0")).toThrow("canonical integer");
    expect(() => UtcDurationMilliseconds.fromCanonical("+1")).toThrow("canonical integer");
    expect(() =>
      UtcDurationMilliseconds.fromSnapshot({ schema: "utc-duration-milliseconds@2", value: "1" }),
    ).toThrow("schema");
  });

  it("guards comparisons, equality, JSON serialization, and hostile snapshots", () => {
    const timestamp = UtcEpochMilliseconds.fromCanonical("2");
    expect(timestamp.equals(UtcEpochMilliseconds.fromCanonical("3"))).toBe(false);
    expect(timestamp.compare(UtcEpochMilliseconds.fromCanonical("1"))).toBe(1);
    expect(timestamp.compare(UtcEpochMilliseconds.fromCanonical("2"))).toBe(0);
    expect(() => timestamp.compare("2")).toThrow("comparison");
    expect(timestamp.toJSON()).toEqual(timestamp.toSnapshot());
    expect(() => timestamp[Symbol.toPrimitive]("string")).toThrow("implicit UTC");
    expect(() => UtcEpochMilliseconds.fromSnapshot(undefined)).toThrow("shape");
    expect(() =>
      UtcEpochMilliseconds.fromSnapshot({ schema: "utc-epoch-milliseconds@1", value: "1", extra: "x" }),
    ).toThrow("shape");
    expect(() =>
      UtcEpochMilliseconds.fromSnapshot(
        new Proxy(
          {},
          {
            ownKeys: () => {
              throw new Error("trap");
            },
          },
        ),
      ),
    ).toThrow("shape");
    expect(() =>
      UtcEpochMilliseconds.fromSnapshot(
        new Proxy(
          {},
          {
            getPrototypeOf: () => {
              throw new Error("trap");
            },
          },
        ),
      ),
    ).toThrow("shape");
  });
});

describe("HistoricalCandle external DTO boundary", () => {
  it("parses the canonical OHLCV DTO into immutable exact values", () => {
    const candle = parseHistoricalCandleDto({
      close: "100.25",
      high: "101",
      low: "99.5",
      open: "100",
      openTimeMs: "1722470400000",
      schema: "historical-candle@1",
      volume: "12.5",
    });

    expect(candle.openTime.equals(openTime)).toBe(true);
    expect(candle.close.equals(ExactRational.from("100.25"))).toBe(true);
    expect(candle.toSnapshot()).toEqual({
      close: { denominator: "4", numerator: "401", schema: "exact-rational@1" },
      high: { denominator: "1", numerator: "101", schema: "exact-rational@1" },
      low: { denominator: "2", numerator: "199", schema: "exact-rational@1" },
      open: { denominator: "1", numerator: "100", schema: "exact-rational@1" },
      openTimeMs: { schema: "utc-epoch-milliseconds@1", value: "1722470400000" },
      schema: "historical-candle@1",
      volume: { denominator: "2", numerator: "25", schema: "exact-rational@1" },
    });
    expect(Object.isFrozen(candle)).toBe(true);
    expect(Object.isFrozen(candle.toSnapshot())).toBe(true);
  });

  it.each([
    {
      close: "100",
      high: "99",
      low: "98",
      open: "100",
      openTimeMs: "1",
      schema: "historical-candle@1",
      volume: "1",
    },
    {
      close: "100",
      high: "101",
      low: "99",
      open: "102",
      openTimeMs: "1",
      schema: "historical-candle@1",
      volume: "1",
    },
    {
      close: "100",
      high: "101",
      low: "99",
      open: "100",
      openTimeMs: "1",
      schema: "historical-candle@1",
      volume: "-1",
    },
    {
      close: "100",
      high: "101",
      low: "99",
      open: "100",
      openTimeMs: "01",
      schema: "historical-candle@1",
      volume: "1",
    },
    {
      close: "100e0",
      high: "101",
      low: "99",
      open: "100",
      openTimeMs: "1",
      schema: "historical-candle@1",
      volume: "1",
    },
    {
      close: "100",
      high: "101",
      low: "99",
      open: "100",
      openTimeMs: "1",
      schema: "historical-candle@2",
      volume: "1",
    },
  ])("rejects invalid candle input %#", (input) => {
    expect(() => parseHistoricalCandleDto(input)).toThrow();
  });

  it("rejects hostile and malformed snapshot structures while preserving JSON behavior", () => {
    const candle = parseHistoricalCandleDto({
      close: "1",
      high: "1",
      low: "1",
      open: "1",
      openTimeMs: "1",
      schema: "historical-candle@1",
      volume: "0",
    });
    expect(candle.toJSON()).toEqual(candle.toSnapshot());
    expect(() => HistoricalCandle.fromSnapshot({ schema: "historical-candle@2" })).toThrow();
    expect(() =>
      HistoricalCandle.fromSnapshot({
        close: {},
        high: {},
        low: {},
        open: {},
        openTimeMs: {},
        schema: "historical-candle@1",
        volume: {},
      }),
    ).toThrow("snapshot");
    expect(() =>
      HistoricalCandle.fromSnapshot({
        ...candle.toSnapshot(),
        schema: "historical-candle@2",
      }),
    ).toThrow("schema");
    expect(() =>
      parseHistoricalCandleDto({
        close: "1",
        high: "1",
        low: "1",
        open: 1,
        openTimeMs: "1",
        schema: "historical-candle@1",
        volume: "1",
      }),
    ).toThrow("string");
    expect(() =>
      parseHistoricalCandleDto({
        close: "1",
        high: "1",
        low: "1",
        open: "1",
        openTimeMs: "1",
        schema: "historical-candle@1",
        unexpected: "1",
      }),
    ).toThrow("shape");
  });
});

describe("exact historical backtest contracts", () => {
  it("serializes immutable cost, position, trade, and equity domain snapshots exactly", () => {
    const cost = HistoricalCost.create({ fee: ExactRational.from("1"), quote: ExactRational.from("10.5") });
    const position = HistoricalPosition.create({
      entryPrice: ExactRational.from("100"),
      openedAt: openTime,
      quantity: ExactRational.from("2"),
      realizedPnl: ExactRational.from("0"),
      side: "long",
      symbol: "BTC/USDT",
    });
    const trade = HistoricalTrade.create({
      closedAt: closeTime,
      cost,
      entryPrice: ExactRational.from("100"),
      exitPrice: ExactRational.from("105"),
      openedAt: openTime,
      quantity: ExactRational.from("2"),
      side: "long",
      symbol: "BTC/USDT",
    });
    const equity = HistoricalEquitySnapshot.create({
      available: ExactRational.from("50"),
      equity: ExactRational.from("60"),
      positions: [position],
      recordedAt: closeTime,
    });

    expect(cost.quote.multiply(ExactRational.from("2")).equals(ExactRational.from("21"))).toBe(true);
    expect(position.toSnapshot().schema).toBe("historical-position@1");
    expect(trade.toSnapshot().pnl).toEqual({ denominator: "1", numerator: "9", schema: "exact-rational@1" });
    expect(equity.toSnapshot()).toMatchObject({ schema: "historical-equity-snapshot@1" });
    expect(
      HistoricalCandle.fromSnapshot(
        parseHistoricalCandleDto({
          close: "1",
          high: "1",
          low: "1",
          open: "1",
          openTimeMs: "1",
          schema: "historical-candle@1",
          volume: "0",
        }).toSnapshot(),
      ).toSnapshot(),
    ).toMatchObject({ schema: "historical-candle@1" });
    expect(HistoricalPosition.fromSnapshot(position.toSnapshot()).toSnapshot()).toEqual(
      position.toSnapshot(),
    );
    expect(HistoricalTrade.fromSnapshot(trade.toSnapshot()).toSnapshot()).toEqual(trade.toSnapshot());
    expect(HistoricalEquitySnapshot.fromSnapshot(equity.toSnapshot()).toSnapshot()).toEqual(
      equity.toSnapshot(),
    );
  });

  it("detaches forged nested cost and position snapshots at public constructor boundaries", () => {
    const cost = HistoricalCost.create({ fee: ExactRational.from("1"), quote: ExactRational.from("10") });
    let forgedFee = "1";
    const forgedCost = new Proxy(cost, {
      get: (_target, property) =>
        property === "toSnapshot"
          ? () => ({ ...cost.toSnapshot(), fee: ExactRational.from(forgedFee).toSnapshot() })
          : undefined,
    });
    const trade = HistoricalTrade.create({
      closedAt: closeTime,
      cost: forgedCost,
      entryPrice: ExactRational.from("10"),
      exitPrice: ExactRational.from("11"),
      openedAt: openTime,
      quantity: ExactRational.from("1"),
      side: "long",
      symbol: "BTC/USDT",
    });
    forgedFee = "9";
    expect(trade.cost.fee.equals(ExactRational.from("1"))).toBe(true);
    expect(() =>
      HistoricalTrade.create({
        closedAt: closeTime,
        cost: withInvalidSnapshot(cost),
        entryPrice: ExactRational.from("10"),
        exitPrice: ExactRational.from("11"),
        openedAt: openTime,
        quantity: ExactRational.from("1"),
        side: "long",
        symbol: "BTC/USDT",
      }),
    ).toThrow("valid immutable historical cost");

    const position = HistoricalPosition.create({
      entryPrice: ExactRational.from("10"),
      openedAt: openTime,
      quantity: ExactRational.from("1"),
      realizedPnl: ExactRational.from("0"),
      side: "long",
      symbol: "BTC/USDT",
    });
    let forgedSymbol = "BTC/USDT";
    const forgedPosition = new Proxy(position, {
      get: (_target, property) =>
        property === "toSnapshot" ? () => ({ ...position.toSnapshot(), symbol: forgedSymbol }) : undefined,
    });
    const equity = HistoricalEquitySnapshot.create({
      available: ExactRational.from("1"),
      equity: ExactRational.from("1"),
      positions: [forgedPosition],
      recordedAt: openTime,
    });
    forgedSymbol = "ETH/USDT";
    expect(equity.positions[0]?.symbol).toBe("BTC/USDT");
    expect(() =>
      HistoricalEquitySnapshot.create({
        available: ExactRational.from("1"),
        equity: ExactRational.from("1"),
        positions: [withInvalidSnapshot(position)],
        recordedAt: openTime,
      }),
    ).toThrow("valid immutable historical positions");
  });

  it("fails closed on impossible position, trade, and equity values", () => {
    expect(() =>
      HistoricalPosition.create({
        entryPrice: ExactRational.from("1"),
        openedAt: openTime,
        quantity: ExactRational.from("-1"),
        realizedPnl: ExactRational.from("0"),
        side: "long",
        symbol: "BTC/USDT",
      }),
    ).toThrow("quantity");
    expect(() =>
      HistoricalTrade.create({
        closedAt: openTime,
        cost: HistoricalCost.create({ fee: ExactRational.from("0"), quote: ExactRational.from("1") }),
        entryPrice: ExactRational.from("1"),
        exitPrice: ExactRational.from("1"),
        openedAt: closeTime,
        quantity: ExactRational.from("1"),
        side: "long",
        symbol: "BTC/USDT",
      }),
    ).toThrow("after");
    expect(() =>
      HistoricalEquitySnapshot.create({
        available: ExactRational.from("3"),
        equity: ExactRational.from("2"),
        positions: [],
        recordedAt: openTime,
      }),
    ).toThrow("available");
  });

  it("covers exact cost, short-trade, snapshot, and structural failure boundaries", () => {
    expect(() =>
      HistoricalCost.create({ fee: ExactRational.from("-1"), quote: ExactRational.from("1") }),
    ).toThrow("fee");
    expect(() => HistoricalCost.fromSnapshot({ fee: {}, quote: {}, schema: "historical-cost@1" })).toThrow(
      "snapshot",
    );
    expect(() =>
      HistoricalCost.fromSnapshot({
        fee: ExactRational.from("0").toSnapshot(),
        quote: ExactRational.from("0").toSnapshot(),
        schema: "historical-cost@2",
      }),
    ).toThrow("schema");
    expect(() =>
      HistoricalPosition.fromSnapshot({
        entryPrice: {},
        openedAt: {},
        quantity: {},
        realizedPnl: {},
        schema: "historical-position@1",
        side: "sideways",
        symbol: " BTC",
      }),
    ).toThrow();
    expect(() =>
      HistoricalPosition.fromSnapshot({
        entryPrice: ExactRational.from("1").toSnapshot(),
        openedAt: openTime.toSnapshot(),
        quantity: ExactRational.from("1").toSnapshot(),
        realizedPnl: ExactRational.from("0").toSnapshot(),
        schema: "historical-position@2",
        side: "long",
        symbol: "BTC/USDT",
      }),
    ).toThrow("schema");
    expect(() =>
      HistoricalPosition.fromSnapshot({
        entryPrice: ExactRational.from("1").toSnapshot(),
        openedAt: openTime.toSnapshot(),
        quantity: ExactRational.from("1").toSnapshot(),
        realizedPnl: ExactRational.from("0").toSnapshot(),
        schema: "historical-position@1",
        side: "sideways",
        symbol: "BTC/USDT",
      }),
    ).toThrow("side");
    expect(() =>
      HistoricalPosition.fromSnapshot({
        entryPrice: ExactRational.from("1").toSnapshot(),
        openedAt: openTime.toSnapshot(),
        quantity: ExactRational.from("1").toSnapshot(),
        realizedPnl: ExactRational.from("0").toSnapshot(),
        schema: "historical-position@1",
        side: "long",
        symbol: " BTC/USDT",
      }),
    ).toThrow("symbol");
    expect(() =>
      HistoricalCost.create({
        fee: ExactRational.from("0"),
        quote: new Proxy(ExactRational.from("1"), {}),
      }),
    ).toThrow("intact");
    expect(() =>
      HistoricalPosition.create({
        entryPrice: ExactRational.from("1"),
        openedAt: new Proxy(openTime, {}),
        quantity: ExactRational.from("1"),
        realizedPnl: ExactRational.from("0"),
        side: "long",
        symbol: "BTC/USDT",
      }),
    ).toThrow("intact");
    const short = HistoricalTrade.create({
      closedAt: closeTime,
      cost: HistoricalCost.create({ fee: ExactRational.from("0"), quote: ExactRational.from("1") }),
      entryPrice: ExactRational.from("5"),
      exitPrice: ExactRational.from("3"),
      openedAt: openTime,
      quantity: ExactRational.from("2"),
      side: "short",
      symbol: "BTC/USDT",
    });
    expect(short.pnl.equals(ExactRational.from("4"))).toBe(true);
    expect(() =>
      HistoricalTrade.fromSnapshot({ ...short.toSnapshot(), schema: "historical-trade@2" }),
    ).toThrow("schema");
    const invalidPnl = { ...short.toSnapshot(), pnl: ExactRational.from("5").toSnapshot() };
    expect(() => HistoricalTrade.fromSnapshot(invalidPnl)).toThrow("pnl");
    expect(() =>
      HistoricalEquitySnapshot.fromSnapshot({
        available: {},
        equity: {},
        positions: {},
        recordedAt: {},
        schema: "historical-equity-snapshot@1",
      }),
    ).toThrow("positions");
  });
});
