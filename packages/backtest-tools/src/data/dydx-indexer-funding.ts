import type { FundingSnapshot } from "@mm-crypto-bot/core";
import { canonicalizeExternalDecimal, ExactRational } from "@mm-crypto-bot/numeric";

import type { DydxMarket, DydxWsChannelBatchData, DydxWsChannelData } from "./dydx-indexer-feed.js";

export interface DydxTradingEntry {
  readonly fundingRate?: unknown;
  readonly markPrice?: unknown;
  readonly oraclePrice?: unknown;
}

export type DydxTradingMap = Readonly<Record<string, DydxTradingEntry>>;

export interface DydxIndexerFetchResponse {
  readonly ok: boolean;
  readonly status: number;
  readonly statusText: string;
  json(): Promise<unknown>;
}

export type DydxIndexerFetchPage = (
  request: Readonly<{ readonly url: string; readonly timeoutMs: number }>,
) => Promise<unknown>;

export interface DydxIndexerWebSocket {
  readonly readyState: number;
  addEventListener(type: string, listener: (event: Event) => void): void;
  send(data: string): void;
  close(): void;
}

export type DydxIndexerWebSocketFactory = (url: string) => DydxIndexerWebSocket;

export interface DydxHistoricalFundingRow {
  readonly ticker: string;
  readonly rate: string;
  readonly price: string | undefined;
  readonly effectiveAt: string;
}

export function exactDecimalOrUndefined(value: unknown): ExactRational | undefined {
  if (typeof value !== "string") return undefined;
  try {
    const canonical = canonicalizeExternalDecimal(value);
    return canonical === value ? ExactRational.from(canonical) : undefined;
  } catch {
    return undefined;
  }
}

export function exactOptionalMarkPrice(value: unknown): { readonly markPrice?: ExactRational } {
  const markPrice = exactDecimalOrUndefined(value);
  return markPrice === undefined ? {} : { markPrice };
}

export function validateIndexerFetchResponse(value: unknown): DydxIndexerFetchResponse {
  if (!isRecord(value)) throw new Error("Invalid dYdX Indexer transport response");
  const { ok, status, statusText, json } = value;
  if (
    typeof ok !== "boolean" ||
    typeof status !== "number" ||
    typeof statusText !== "string" ||
    !isJsonMethod(json)
  )
    throw new Error("Invalid dYdX Indexer transport response");
  return { ok, status, statusText, json: () => Promise.resolve(json.call(value)) };
}

export function parseIndexerWsMessage(value: unknown): DydxWsChannelData | DydxWsChannelBatchData | undefined {
  if (!isRecord(value) || value["channel"] !== "v4_markets" || typeof value["id"] !== "string") return undefined;
  const contents = value["contents"];
  if (contents === undefined) return { channel: "v4_markets", id: value["id"] };
  if (isTradingContents(contents)) return { channel: "v4_markets", id: value["id"], contents };
  if (isBatchTradingContents(contents)) return { channel: "v4_markets", id: value["id"], contents };
  return undefined;
}

export function websocketText(value: unknown): string {
  if (!isRecord(value)) return "";
  const data = value["data"];
  return typeof data === "string" ? data : "";
}

export function websocketErrorMessage(value: unknown): string {
  if (!isRecord(value)) return "unknown";
  const message = value["message"];
  return typeof message === "string" ? message : "unknown";
}

export function extractTradingMap(
  message: DydxWsChannelData | DydxWsChannelBatchData,
): DydxTradingMap | undefined {
  const contents = message.contents;
  if (contents === undefined) return undefined;
  if (isBatchContents(contents)) return contents.at(0)?.trading;
  return contents.trading;
}

function isBatchContents(value: unknown): value is readonly { readonly trading?: DydxTradingMap }[] {
  return Array.isArray(value);
}

function isTradingContents(value: unknown): value is { readonly trading?: DydxTradingMap } {
  return isRecord(value) && (value["trading"] === undefined || isTradingMap(value["trading"]));
}

function isBatchTradingContents(value: unknown): value is readonly { readonly trading?: DydxTradingMap }[] {
  return Array.isArray(value) && value.every(isTradingContents);
}

function isTradingMap(value: unknown): value is DydxTradingMap {
  if (!isRecord(value)) return false;
  return Object.values(value).every(isRecord);
}

export function tradingForMarket(
  trading: DydxTradingMap,
  market: DydxMarket,
): DydxTradingEntry | undefined {
  if (market === "BTC-USD") return trading["BTC-USD"];
  if (market === "ETH-USD") return trading["ETH-USD"];
  return trading["SOL-USD"];
}

export function parseFundingUpdate(
  message: DydxWsChannelData | DydxWsChannelBatchData,
  market: DydxMarket,
  nowMs: number,
): FundingSnapshot | undefined {
  const trading = extractTradingMap(message);
  if (trading === undefined) return undefined;
  const entry = tradingForMarket(trading, market);
  const fundingRate = entry?.fundingRate === undefined ? undefined : exactDecimalOrUndefined(entry.fundingRate);
  const markPrice = entry?.markPrice === undefined ? undefined : exactDecimalOrUndefined(entry.markPrice);
  if (fundingRate === undefined) return undefined;
  const hasInvalidMarkPrice = markPrice === undefined && entry?.markPrice !== undefined;
  if (hasInvalidMarkPrice) return undefined;
  return {
    fundingTime: nowMs,
    symbol: market,
    fundingRate,
    ...(markPrice !== undefined && { markPrice }),
  };
}

export function historicalFundingRows(value: unknown): readonly DydxHistoricalFundingRow[] {
  if (!isRecord(value)) throw new Error("Invalid dYdX historical funding response");
  const rawRows = value["historicalFunding"];
  if (!Array.isArray(rawRows))
    throw new Error("Invalid dYdX historical funding response");
  const rows: DydxHistoricalFundingRow[] = [];
  for (const entry of rawRows) {
    if (!isRecord(entry)) throw new Error("Invalid dYdX historical funding row");
    const ticker = requiredString(entry["ticker"], "ticker");
    const rate = requiredString(entry["rate"], "rate");
    const effectiveAt = requiredString(entry["effectiveAt"], "effectiveAt");
    const price = entry["price"] === undefined ? undefined : requiredString(entry["price"], "price");
    rows.push({ ticker, rate, price, effectiveAt });
  }
  return Object.freeze(rows);
}

export function historicalFundingSnapshot(
  row: DydxHistoricalFundingRow,
  effectiveAfterMs: number | undefined,
): FundingSnapshot | undefined {
  if (effectiveAfterMs !== undefined) {
    const candidateTime = Date.parse(row.effectiveAt);
    if (candidateTime < effectiveAfterMs) return undefined;
  }
  const fundingTime = Date.parse(row.effectiveAt);
  if (!Number.isFinite(fundingTime)) return undefined;
  const fundingRate = exactDecimalOrUndefined(row.rate);
  if (fundingRate === undefined) return undefined;
  const markPrice = row.price === undefined ? undefined : exactDecimalOrUndefined(row.price);
  const hasInvalidMarkPrice = markPrice === undefined && row.price !== undefined;
  if (hasInvalidMarkPrice) return undefined;
  return {
    fundingTime,
    symbol: row.ticker,
    fundingRate,
    ...(markPrice !== undefined && { markPrice }),
  };
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && Object(value) === value && !Array.isArray(value);
}

function isJsonMethod(value: unknown): value is { call(receiver: Readonly<Record<string, unknown>>): unknown } {
  return typeof value === "function";
}

function requiredString(candidate: unknown, field: string): string {
  if (typeof candidate !== "string") throw new Error(`Invalid dYdX historical funding ${field}`);
  return candidate;
}
