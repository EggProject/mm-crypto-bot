import type { ExactRationalSnapshot } from "@mm-crypto-bot/numeric";

export interface UtcEpochMillisecondsSnapshot {
  readonly schema: "utc-epoch-milliseconds@1";
  readonly value: string;
}

export interface UtcDurationMillisecondsSnapshot {
  readonly schema: "utc-duration-milliseconds@1";
  readonly value: string;
}

export interface HistoricalCandleDto {
  readonly schema: "historical-candle@1";
  readonly openTimeMs: string;
  readonly open: string;
  readonly high: string;
  readonly low: string;
  readonly close: string;
  readonly volume: string;
}

export interface HistoricalCandleSnapshot {
  readonly schema: "historical-candle@1";
  readonly openTimeMs: UtcEpochMillisecondsSnapshot;
  readonly open: ExactRationalSnapshot;
  readonly high: ExactRationalSnapshot;
  readonly low: ExactRationalSnapshot;
  readonly close: ExactRationalSnapshot;
  readonly volume: ExactRationalSnapshot;
}

export interface HistoricalCostSnapshot {
  readonly schema: "historical-cost@1";
  readonly quote: ExactRationalSnapshot;
  readonly fee: ExactRationalSnapshot;
}

export type HistoricalPositionSide = "long" | "short";

export interface HistoricalPositionSnapshot {
  readonly schema: "historical-position@1";
  readonly symbol: string;
  readonly side: HistoricalPositionSide;
  readonly openedAt: UtcEpochMillisecondsSnapshot;
  readonly quantity: ExactRationalSnapshot;
  readonly entryPrice: ExactRationalSnapshot;
  readonly realizedPnl: ExactRationalSnapshot;
}

export interface HistoricalTradeSnapshot {
  readonly schema: "historical-trade@1";
  readonly symbol: string;
  readonly side: HistoricalPositionSide;
  readonly openedAt: UtcEpochMillisecondsSnapshot;
  readonly closedAt: UtcEpochMillisecondsSnapshot;
  readonly quantity: ExactRationalSnapshot;
  readonly entryPrice: ExactRationalSnapshot;
  readonly exitPrice: ExactRationalSnapshot;
  readonly cost: HistoricalCostSnapshot;
  readonly pnl: ExactRationalSnapshot;
}

export interface HistoricalEquitySnapshotDto {
  readonly schema: "historical-equity-snapshot@1";
  readonly recordedAt: UtcEpochMillisecondsSnapshot;
  readonly available: ExactRationalSnapshot;
  readonly equity: ExactRationalSnapshot;
  readonly positions: readonly HistoricalPositionSnapshot[];
}
