/**
 * Minimal raw fields consumed by the Bybit EU normalizer boundary.
 */
export interface RawTickerPayload {
  readonly ask?: number | undefined;
  readonly baseVolume?: number | undefined;
  readonly bid?: number | undefined;
  readonly last?: number | undefined;
  readonly quoteVolume?: number | undefined;
  readonly timestamp?: number | undefined;
}

export type RawOrderBookLevel = readonly [
  price?: number | undefined,
  amount?: number | undefined,
  ...extra: readonly (number | undefined)[],
];

export interface RawOrderBookPayload {
  readonly asks: readonly RawOrderBookLevel[];
  readonly bids: readonly RawOrderBookLevel[];
  readonly nonce?: number | undefined;
  readonly timestamp?: number | undefined;
}

export interface RawTradeFeePayload {
  readonly cost?: number | undefined;
  readonly currency?: string | undefined;
}

export interface RawTradePayload {
  readonly amount?: number | undefined;
  readonly fee?: RawTradeFeePayload | undefined;
  readonly id?: string | undefined;
  readonly order?: string | undefined;
  readonly price?: number | undefined;
  readonly side?: string | undefined;
  readonly symbol?: string | undefined;
  readonly timestamp?: number | undefined;
}

export interface RawMarketPrecisionPayload {
  readonly amount?: number | undefined;
  readonly price?: number | undefined;
}

export interface RawMarketLimitPayload {
  readonly min?: number | undefined;
}

export interface RawMarketLimitsPayload {
  readonly amount?: RawMarketLimitPayload | undefined;
  readonly cost?: RawMarketLimitPayload | undefined;
}

export interface RawMarketPayload {
  readonly base: string;
  readonly id?: string | undefined;
  readonly limits: RawMarketLimitsPayload;
  readonly precision: RawMarketPrecisionPayload;
  readonly quote: string;
  readonly spot?: boolean | undefined;
}

export type RawOhlcvPayload = readonly [
  timestamp: number,
  open: number,
  high: number,
  low: number,
  close: number,
  volume: number,
];

export interface RawBalanceEntryPayload {
  readonly free?: number | undefined;
  readonly total?: number | undefined;
}

export type RawBalanceValue = RawBalanceEntryPayload | number | string | undefined;

export type RawBalancesPayload = Readonly<Record<string, RawBalanceValue>>;

export interface RawPositionPayload {
  readonly contracts?: number | undefined;
  readonly entryPrice?: number | undefined;
  readonly lastUpdateTimestamp?: number | undefined;
  readonly markPrice?: number | undefined;
  readonly side?: string | undefined;
  readonly symbol?: string | undefined;
  readonly unrealizedPnl?: number | undefined;
}

export interface RawOrderPayload {
  readonly amount?: number | undefined;
  readonly average?: number | undefined;
  readonly clientOrderId?: string | undefined;
  readonly filled?: number | undefined;
  readonly id?: string | undefined;
  readonly lastUpdateTimestamp?: number | undefined;
  readonly price?: number | undefined;
  readonly side?: string | undefined;
  readonly status?: string | undefined;
  readonly symbol?: string | undefined;
  readonly timestamp?: number | undefined;
  readonly type?: string | undefined;
}
