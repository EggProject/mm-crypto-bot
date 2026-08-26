import { ExactRational, MAXIMUM_CANONICAL_DECIMAL_LENGTH } from "@mm-crypto-bot/numeric";

import type {
  HistoricalCandleSnapshot,
  HistoricalCostSnapshot,
  HistoricalEquitySnapshotDto,
  HistoricalPositionSide,
  HistoricalPositionSnapshot,
  HistoricalTradeSnapshot,
  UtcEpochMillisecondsSnapshot,
} from "./exact-historical-market-data-contracts.js";
import { UtcDurationMilliseconds } from "./utc-duration-milliseconds.js";
import {
  fail,
  rationalFromSnapshot,
  requireNonNegative,
  requirePositive,
  requireRational,
  requireRecord,
  requireSide,
  requireString,
  requireSymbol,
  snapshotRational,
} from "./exact-historical-market-data-validation.js";

export { ExactRational } from "@mm-crypto-bot/numeric";

export type {
  HistoricalCandleDto,
  HistoricalCandleSnapshot,
  HistoricalCostSnapshot,
  HistoricalEquitySnapshotDto,
  HistoricalPositionSide,
  HistoricalPositionSnapshot,
  HistoricalTradeSnapshot,
  UtcEpochMillisecondsSnapshot,
  UtcDurationMillisecondsSnapshot,
} from "./exact-historical-market-data-contracts.js";
export { UtcDurationMilliseconds } from "./utc-duration-milliseconds.js";

interface HistoricalPositionInput {
  readonly symbol: string;
  readonly side: HistoricalPositionSide;
  readonly openedAt: UtcEpochMilliseconds;
  readonly quantity: ExactRational;
  readonly entryPrice: ExactRational;
  readonly realizedPnl: ExactRational;
}

interface HistoricalTradeInput {
  readonly symbol: string;
  readonly side: HistoricalPositionSide;
  readonly openedAt: UtcEpochMilliseconds;
  readonly closedAt: UtcEpochMilliseconds;
  readonly quantity: ExactRational;
  readonly entryPrice: ExactRational;
  readonly exitPrice: ExactRational;
  readonly cost: HistoricalCost;
}

interface HistoricalEquityInput {
  readonly recordedAt: UtcEpochMilliseconds;
  readonly available: ExactRational;
  readonly equity: ExactRational;
  readonly positions: readonly HistoricalPosition[];
}

interface HistoricalCostInput {
  readonly quote: ExactRational;
  readonly fee: ExactRational;
}

export class UtcEpochMilliseconds {
  public static fromCanonical(input: unknown): UtcEpochMilliseconds {
    if (
      typeof input !== "string" ||
      input.length === 0 ||
      input.length > MAXIMUM_CANONICAL_DECIMAL_LENGTH ||
      (input !== "0" && !/^[1-9][0-9]*$/u.test(input))
    ) {
      return fail("UTC epoch milliseconds must be a canonical unsigned decimal string.");
    }

    return new UtcEpochMilliseconds(BigInt(input));
  }

  public static fromSnapshot(input: unknown): UtcEpochMilliseconds {
    const record = requireRecord(input, ["schema", "value"], "UTC timestamp snapshot");
    if (record["schema"] !== "utc-epoch-milliseconds@1") {
      return fail("UTC timestamp snapshot schema is unsupported.");
    }

    return this.fromCanonical(record["value"]);
  }

  readonly #value: bigint;

  public readonly [Symbol.toPrimitive] = (_hint: string): never =>
    fail("implicit UTC timestamp coercion is forbidden.");

  private constructor(value: bigint) {
    this.#value = value;
    Object.freeze(this);
  }

  public equals(other: unknown): boolean {
    return other instanceof UtcEpochMilliseconds && this.#value === other.#value;
  }

  public compare(other: unknown): -1 | 0 | 1 {
    if (!(other instanceof UtcEpochMilliseconds)) {
      return fail("UTC timestamp comparison requires UtcEpochMilliseconds.");
    }

    return this.#value < other.#value ? -1 : this.#value > other.#value ? 1 : 0;
  }

  public addMilliseconds(duration: UtcDurationMilliseconds): UtcEpochMilliseconds {
    const result = this.#value + duration.toBigInt();
    if (result < 0n) return fail("UTC timestamp addition must not produce a negative timestamp.");
    return UtcEpochMilliseconds.fromCanonical(result.toString());
  }

  public difference(other: UtcEpochMilliseconds): UtcDurationMilliseconds {
    return UtcDurationMilliseconds.fromCanonical((this.#value - other.#value).toString());
  }

  public toCanonical(): string {
    return this.#value.toString();
  }

  public toSnapshot(): UtcEpochMillisecondsSnapshot {
    return Object.freeze({ schema: "utc-epoch-milliseconds@1" as const, value: this.toCanonical() });
  }

  public toJSON(): UtcEpochMillisecondsSnapshot {
    return this.toSnapshot();
  }
}

export class HistoricalCandle {
  public static fromSnapshot(input: unknown): HistoricalCandle {
    const record = requireRecord(
      input,
      ["schema", "openTimeMs", "open", "high", "low", "close", "volume"],
      "candle snapshot",
    );
    if (record["schema"] !== "historical-candle@1") {
      return fail("candle snapshot schema is unsupported.");
    }

    return new HistoricalCandle(
      UtcEpochMilliseconds.fromSnapshot(record["openTimeMs"]),
      rationalFromSnapshot(record["open"], "candle open"),
      rationalFromSnapshot(record["high"], "candle high"),
      rationalFromSnapshot(record["low"], "candle low"),
      rationalFromSnapshot(record["close"], "candle close"),
      rationalFromSnapshot(record["volume"], "candle volume"),
    );
  }

  public readonly openTime: UtcEpochMilliseconds;
  public readonly open: ExactRational;
  public readonly high: ExactRational;
  public readonly low: ExactRational;
  public readonly close: ExactRational;
  public readonly volume: ExactRational;

  private constructor(
    openTime: UtcEpochMilliseconds,
    open: ExactRational,
    high: ExactRational,
    low: ExactRational,
    close: ExactRational,
    volume: ExactRational,
  ) {
    this.openTime = openTime;
    this.open = requireNonNegative(open, "candle open");
    this.high = requireNonNegative(high, "candle high");
    this.low = requireNonNegative(low, "candle low");
    this.close = requireNonNegative(close, "candle close");
    this.volume = requireNonNegative(volume, "candle volume");
    if (
      this.low.compare(this.open) > 0 ||
      this.low.compare(this.close) > 0 ||
      this.high.compare(this.open) < 0 ||
      this.high.compare(this.close) < 0
    ) {
      fail("candle OHLC range is invalid.");
    }

    Object.freeze(this);
  }

  public toSnapshot(): HistoricalCandleSnapshot {
    return Object.freeze({
      close: snapshotRational(this.close),
      high: snapshotRational(this.high),
      low: snapshotRational(this.low),
      open: snapshotRational(this.open),
      openTimeMs: this.openTime.toSnapshot(),
      schema: "historical-candle@1",
      volume: snapshotRational(this.volume),
    });
  }

  public toJSON(): HistoricalCandleSnapshot {
    return this.toSnapshot();
  }
}

export function parseHistoricalCandleDto(input: unknown): HistoricalCandle {
  const record = requireRecord(
    input,
    ["schema", "openTimeMs", "open", "high", "low", "close", "volume"],
    "historical candle DTO",
  );
  if (record["schema"] !== "historical-candle@1") {
    return fail("historical candle DTO schema is unsupported.");
  }

  const snapshot: HistoricalCandleSnapshot = {
    close: snapshotRational(ExactRational.from(requireString(record["close"], "candle close"))),
    high: snapshotRational(ExactRational.from(requireString(record["high"], "candle high"))),
    low: snapshotRational(ExactRational.from(requireString(record["low"], "candle low"))),
    open: snapshotRational(ExactRational.from(requireString(record["open"], "candle open"))),
    openTimeMs: UtcEpochMilliseconds.fromCanonical(record["openTimeMs"]).toSnapshot(),
    schema: "historical-candle@1",
    volume: snapshotRational(ExactRational.from(requireString(record["volume"], "candle volume"))),
  };
  return HistoricalCandle.fromSnapshot(snapshot);
}

export class HistoricalCost {
  public static create(input: HistoricalCostInput): HistoricalCost {
    return new HistoricalCost(input);
  }

  public static fromSnapshot(input: unknown): HistoricalCost {
    const record = requireRecord(input, ["schema", "quote", "fee"], "cost snapshot");
    if (record["schema"] !== "historical-cost@1") {
      return fail("cost snapshot schema is unsupported.");
    }

    return this.create({
      fee: rationalFromSnapshot(record["fee"], "cost fee"),
      quote: rationalFromSnapshot(record["quote"], "cost quote"),
    });
  }

  public readonly quote: ExactRational;
  public readonly fee: ExactRational;

  private constructor(input: HistoricalCostInput) {
    this.quote = requireNonNegative(requireRational(input.quote, "cost quote"), "cost quote");
    this.fee = requireNonNegative(requireRational(input.fee, "cost fee"), "cost fee");
    Object.freeze(this);
  }

  public toSnapshot(): HistoricalCostSnapshot {
    return Object.freeze({
      fee: snapshotRational(this.fee),
      quote: snapshotRational(this.quote),
      schema: "historical-cost@1",
    });
  }
}

export class HistoricalPosition {
  public static create(input: HistoricalPositionInput): HistoricalPosition {
    return new HistoricalPosition(input);
  }

  public static fromSnapshot(input: unknown): HistoricalPosition {
    const record = requireRecord(
      input,
      ["schema", "symbol", "side", "openedAt", "quantity", "entryPrice", "realizedPnl"],
      "position snapshot",
    );
    if (record["schema"] !== "historical-position@1") return fail("position snapshot schema is unsupported.");
    return this.create({
      entryPrice: rationalFromSnapshot(record["entryPrice"], "position entryPrice"),
      openedAt: UtcEpochMilliseconds.fromSnapshot(record["openedAt"]),
      quantity: rationalFromSnapshot(record["quantity"], "position quantity"),
      realizedPnl: rationalFromSnapshot(record["realizedPnl"], "position realizedPnl"),
      side: requireSide(record["side"]),
      symbol: requireSymbol(record["symbol"]),
    });
  }

  public readonly symbol: string;
  public readonly side: HistoricalPositionSide;
  public readonly openedAt: UtcEpochMilliseconds;
  public readonly quantity: ExactRational;
  public readonly entryPrice: ExactRational;
  public readonly realizedPnl: ExactRational;

  private constructor(input: HistoricalPositionInput) {
    this.symbol = requireSymbol(input.symbol);
    this.side = requireSide(input.side);
    this.openedAt = requireTimestamp(input.openedAt, "position openedAt");
    this.quantity = requirePositive(
      requireRational(input.quantity, "position quantity"),
      "position quantity",
    );
    this.entryPrice = requireNonNegative(
      requireRational(input.entryPrice, "position entryPrice"),
      "position entryPrice",
    );
    this.realizedPnl = requireRational(input.realizedPnl, "position realizedPnl");
    Object.freeze(this);
  }

  public toSnapshot(): HistoricalPositionSnapshot {
    return Object.freeze({
      entryPrice: snapshotRational(this.entryPrice),
      openedAt: this.openedAt.toSnapshot(),
      quantity: snapshotRational(this.quantity),
      realizedPnl: snapshotRational(this.realizedPnl),
      schema: "historical-position@1",
      side: this.side,
      symbol: this.symbol,
    });
  }
}

function requireTimestamp(input: UtcEpochMilliseconds, label: string): UtcEpochMilliseconds {
  try {
    input.toSnapshot();
    return input;
  } catch {
    return fail(`${label} must be an intact UtcEpochMilliseconds.`);
  }
}

function canonicalizeCost(input: HistoricalCost): HistoricalCost {
  try {
    return HistoricalCost.fromSnapshot(input.toSnapshot());
  } catch {
    return fail("trade cost must be a valid immutable historical cost.");
  }
}

function canonicalizePosition(input: HistoricalPosition): HistoricalPosition {
  try {
    return HistoricalPosition.fromSnapshot(input.toSnapshot());
  } catch {
    return fail("equity positions must be valid immutable historical positions.");
  }
}

export class HistoricalTrade {
  public static create(input: HistoricalTradeInput): HistoricalTrade {
    return new HistoricalTrade(input);
  }

  public static fromSnapshot(input: unknown): HistoricalTrade {
    const record = requireRecord(
      input,
      [
        "schema",
        "symbol",
        "side",
        "openedAt",
        "closedAt",
        "quantity",
        "entryPrice",
        "exitPrice",
        "cost",
        "pnl",
      ],
      "trade snapshot",
    );
    if (record["schema"] !== "historical-trade@1") return fail("trade snapshot schema is unsupported.");
    const trade = this.create({
      closedAt: UtcEpochMilliseconds.fromSnapshot(record["closedAt"]),
      cost: HistoricalCost.fromSnapshot(record["cost"]),
      entryPrice: rationalFromSnapshot(record["entryPrice"], "trade entryPrice"),
      exitPrice: rationalFromSnapshot(record["exitPrice"], "trade exitPrice"),
      openedAt: UtcEpochMilliseconds.fromSnapshot(record["openedAt"]),
      quantity: rationalFromSnapshot(record["quantity"], "trade quantity"),
      side: requireSide(record["side"]),
      symbol: requireSymbol(record["symbol"]),
    });
    if (!trade.pnl.equals(rationalFromSnapshot(record["pnl"], "trade pnl")))
      return fail("trade pnl does not match its exact inputs.");
    return trade;
  }

  public readonly symbol: string;
  public readonly side: HistoricalPositionSide;
  public readonly openedAt: UtcEpochMilliseconds;
  public readonly closedAt: UtcEpochMilliseconds;
  public readonly quantity: ExactRational;
  public readonly entryPrice: ExactRational;
  public readonly exitPrice: ExactRational;
  public readonly cost: HistoricalCost;
  public readonly pnl: ExactRational;

  private constructor(input: HistoricalTradeInput) {
    this.symbol = requireSymbol(input.symbol);
    this.side = requireSide(input.side);
    this.openedAt = requireTimestamp(input.openedAt, "trade openedAt");
    this.closedAt = requireTimestamp(input.closedAt, "trade closedAt");
    if (this.closedAt.compare(this.openedAt) < 0) fail("trade closedAt must be after openedAt.");
    this.quantity = requirePositive(requireRational(input.quantity, "trade quantity"), "trade quantity");
    this.entryPrice = requireNonNegative(
      requireRational(input.entryPrice, "trade entryPrice"),
      "trade entryPrice",
    );
    this.exitPrice = requireNonNegative(
      requireRational(input.exitPrice, "trade exitPrice"),
      "trade exitPrice",
    );
    this.cost = canonicalizeCost(input.cost);
    const priceDifference =
      this.side === "long"
        ? this.exitPrice.subtract(this.entryPrice)
        : this.entryPrice.subtract(this.exitPrice);
    this.pnl = priceDifference.multiply(this.quantity).subtract(this.cost.fee);
    Object.freeze(this);
  }

  public toSnapshot(): HistoricalTradeSnapshot {
    return Object.freeze({
      closedAt: this.closedAt.toSnapshot(),
      cost: this.cost.toSnapshot(),
      entryPrice: snapshotRational(this.entryPrice),
      exitPrice: snapshotRational(this.exitPrice),
      openedAt: this.openedAt.toSnapshot(),
      pnl: snapshotRational(this.pnl),
      quantity: snapshotRational(this.quantity),
      schema: "historical-trade@1",
      side: this.side,
      symbol: this.symbol,
    });
  }
}

export class HistoricalEquitySnapshot {
  public static create(input: HistoricalEquityInput): HistoricalEquitySnapshot {
    return new HistoricalEquitySnapshot(input);
  }

  public static fromSnapshot(input: unknown): HistoricalEquitySnapshot {
    const record = requireRecord(
      input,
      ["schema", "recordedAt", "available", "equity", "positions"],
      "equity snapshot",
    );
    if (record["schema"] !== "historical-equity-snapshot@1" || !Array.isArray(record["positions"]))
      return fail("equity snapshot has an invalid schema or positions.");
    return this.create({
      available: rationalFromSnapshot(record["available"], "equity available"),
      equity: rationalFromSnapshot(record["equity"], "equity"),
      positions: record["positions"].map((position) => HistoricalPosition.fromSnapshot(position)),
      recordedAt: UtcEpochMilliseconds.fromSnapshot(record["recordedAt"]),
    });
  }

  public readonly recordedAt: UtcEpochMilliseconds;
  public readonly available: ExactRational;
  public readonly equity: ExactRational;
  public readonly positions: readonly HistoricalPosition[];

  private constructor(input: HistoricalEquityInput) {
    this.recordedAt = requireTimestamp(input.recordedAt, "equity recordedAt");
    this.available = requireNonNegative(
      requireRational(input.available, "equity available"),
      "equity available",
    );
    this.equity = requireNonNegative(requireRational(input.equity, "equity"), "equity");
    if (this.available.compare(this.equity) > 0) fail("equity available must not exceed equity.");
    this.positions = Object.freeze(input.positions.map((position) => canonicalizePosition(position)));
    Object.freeze(this);
  }

  public toSnapshot(): HistoricalEquitySnapshotDto {
    return Object.freeze({
      available: snapshotRational(this.available),
      equity: snapshotRational(this.equity),
      positions: Object.freeze(this.positions.map((position) => position.toSnapshot())),
      recordedAt: this.recordedAt.toSnapshot(),
      schema: "historical-equity-snapshot@1",
    });
  }
}
