// packages/backtest-tools/src/data/tardis-dydx-funding.ts — Tardis.dev
// historical funding-rate fetcher for dYdX v4.
//
// Phase 25 #2 Track B — backtest validator. Pulls historical funding
// data from Tardis.dev's `derivative_ticker` CSV dataset for the
// dYdX-v4 exchange. The CSV is FREE to download without API key
// (per https://docs.tardis.dev/downloadable-csv-files/overview), as
// long as the requested file is the **first day of any month** that
// has been archived.
//
// IMPORTANT — Tardis CSV dataset coverage rules:
//   - CSV datasets for a given day are available on the next day
//     around 06:00 UTC.
//   - Historical CSV datasets for the FIRST day of each month are
//     available to download WITHOUT API key (free tier).
//   - All other days require a Tardis.dev subscription (~$50-100/mo).
//   - For dYdX v4, `derivative_ticker` is the data type that contains
//     `funding_rate` per block (1.4k-4k rows per day observed on
//     BTC-USD 2025-04-01).
//
// URL pattern (no API key):
//   https://datasets.tardis.dev/v1/dydx-v4/derivative_ticker/{YYYY}/{MM}/01/{SYM}.csv.gz
//
// Output: arrays of FundingSnapshot compatible with the existing
// `csv-feed.ts` pattern and the `FundingCarryStrategy` API.
//
// Cache: a disk-based cache at `cacheDir/<YYYY-MM-DD>/<symbol>.csv.gz`
// avoids re-fetching the same window. Cache hits are validated by
// the SHA-256 of the gzipped file (the Tardis dataset is content-
// addressed by date+symbol).

import path from "node:path";
import { Readable } from "node:stream";
import { createGunzip } from "node:zlib";

import type { FundingSnapshot } from "@mm-crypto-bot/core";
import { canonicalizeExternalDecimal, ExactRational } from "@mm-crypto-bot/numeric";

import type { DydxMarket } from "./dydx-indexer-feed.js";
import { parseDerivativeTickerCsv, type TardisDerivativeTickerRow } from "./tardis-dydx-funding-csv.js";
import {
  nodeTardisCacheFileSystem,
  readVerifiedTardisCacheReceipt,
  tardisCacheManifestPath,
  writeVerifiedTardisCache,
  type TardisCacheReceipt,
  type TardisCacheFileSystem,
} from "./tardis-dydx-funding-cache.js";

/**
dYdX v4 markets supported by the funding-carry backtest.
*/
export type TardisMarket = DydxMarket;

/**
Default Tardis dataset base URL (no API key required for monthly CSVs).
*/
export const DEFAULT_TARDIS_BASE_URL = "https://datasets.tardis.dev";

/**
Default fetch timeout in ms (Tardis datasets can be 50-80KB compressed).
*/
export const DEFAULT_FETCH_TIMEOUT_MS = 30_000;

/**
Cache subdirectory layout.
*/
export const CACHE_DIR_NAME = "tardis-dydx-v4";

export interface TardisDydxFundingConfig {
  /**
  UTC clock used to timestamp cache publication receipts.
  */
  readonly cacheClock?: TardisCacheClock;
  /**
  Restrict reads to verified local cache entries; never invoke the transport.
  */
  readonly cacheOnly?: boolean;
  /**
  Filesystem port for verified, atomic cache storage.
  */
  readonly cacheFileSystem?: TardisCacheFileSystem;
  readonly fetchPage?: TardisFetchPage;
  /**
  Base URL for Tardis datasets.
  */
  readonly baseUrl?: string;
  /**
  Local cache directory (resolved relative to cwd if relative).
  */
  readonly cacheDir?: string;
  /**
  Per-fetch timeout in milliseconds.
  */
  readonly fetchTimeoutMs?: number;
  /**
  Optional logger for diagnostics.
  */
  readonly logger?: TardisLogger;
}

export interface TardisCacheClock {
  readonly nowUtc: () => string;
}

export type TardisFetchPage = (
  request: Readonly<{ readonly url: string; readonly timeoutMs: number }>,
) => Promise<unknown>;

export interface TardisLogger {
  readonly debug: (message: string, meta?: Readonly<Record<string, unknown>>) => void;
  readonly info: (message: string, meta?: Readonly<Record<string, unknown>>) => void;
  readonly warn: (message: string, meta?: Readonly<Record<string, unknown>>) => void;
  readonly error: (message: string, meta?: Readonly<Record<string, unknown>>) => void;
}

const NOOP_LOGGER: TardisLogger = {
  debug: () => {
    void 0;
  },
  info: () => {
    void 0;
  },
  warn: () => {
    void 0;
  },
  error: () => {
    void 0;
  },
};

const nodeTardisCacheClock: TardisCacheClock = Object.freeze({ nowUtc: () => new Date().toISOString() });

const defaultFetchPage: TardisFetchPage = async ({ url, timeoutMs }) =>
  fetch(url, { signal: AbortSignal.timeout(timeoutMs) });

function validateFetchResponse(value: unknown): {
  readonly ok: boolean;
  readonly status: number;
  arrayBuffer(): Promise<ArrayBuffer>;
} {
  if (!isUnknownRecord(value)) throw new Error("Invalid Tardis transport response");
  const ok = value["ok"];
  const status = value["status"];
  const arrayBuffer = value["arrayBuffer"];
  if (typeof ok !== "boolean" || typeof status !== "number" || typeof arrayBuffer !== "function")
    throw new Error("Invalid Tardis transport response");
  return { ok, status, arrayBuffer: async () => requireArrayBuffer(await arrayBuffer.call(value)) };
}

function isUnknownRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && Object(value) === value && !Array.isArray(value);
}

function requireArrayBuffer(value: unknown): ArrayBuffer {
  if (value instanceof ArrayBuffer) return value;
  throw new Error("Invalid Tardis transport body");
}

/**
 * A single row of the Tardis `derivative_ticker` CSV dataset.
 *
 * Header (verified on actual downloaded data):
 *   exchange,symbol,timestamp,local_timestamp,funding_timestamp,
 *   funding_rate,predicted_funding_rate,open_interest,last_price,
 *   index_price,mark_price
 *
 * `timestamp` is in **microseconds** since epoch (Tardis convention).
 * `funding_timestamp` is often empty in historical replays (the Indexer
 * populates it live only).
 */
export type { TardisDerivativeTickerRow } from "./tardis-dydx-funding-csv.js";

/**
 * A consolidated hourly funding snapshot. Each entry corresponds to
 * the funding-rate value settled at the hour boundary on dYdX v4.
 */
export interface DydxHourlyFunding {
  /**
  Hour-boundary timestamp in epoch ms.
  */
  readonly fundingTime: number;
  /**
  Market symbol (e.g. "BTC-USD").
  */
  readonly symbol: string;
  /**
  Funding rate in decimal (e.g. 0.00004405 = 0.004405% per hour).
  */
  readonly fundingRate: ExactRational;
  /**
  Mark price at funding time (best-effort; undefined if unavailable).
  */
  readonly markPrice: ExactRational | undefined;
}

/**
Convert microsecond timestamp to epoch ms (Tardis convention).
*/
export function microsecondsToMs(us: number): number {
  return Math.floor(us / 1000);
}

export { parseDerivativeTickerCsv } from "./tardis-dydx-funding-csv.js";

/**
 * Aggregate raw derivative_ticker rows to hourly funding snapshots.
 *
 * dYdX v4 publishes a `funding_rate` estimate per block (~1/sec at
 * typical load). The actual SETTLED rate is set once per hour at the
 * funding-tick boundary. We bucket rows by hour (epoch_ms // 3_600_000)
 * and take the FIRST observed `funding_rate` per bucket as the
 * settlement value (which empirically matches the dYdX Indexer's
 * `/v4/historical-funding` hourly entries on the same day).
 */
export function aggregateToHourlyFunding(
  rows: readonly TardisDerivativeTickerRow[],
  market: TardisMarket,
): readonly DydxHourlyFunding[] {
  const buckets = new Map<
    number,
    { readonly rate: ExactRational; readonly mark: ExactRational | undefined }
  >();
  for (const row of rows) {
    if (row.symbol !== market) continue;
    const rate = requiredExactDecimal(row.funding_rate, "funding_rate");
    const tsMs = timestampMilliseconds(row.timestamp);
    const hourKey = Math.floor(tsMs / 3_600_000);
    if (!buckets.has(hourKey)) {
      const mark = optionalExactDecimal(row.mark_price, "mark_price");
      buckets.set(hourKey, { rate, mark });
    }
  }
  const orderedBuckets = orderedHourBuckets(buckets);
  const out: DydxHourlyFunding[] = [];
  for (const [hourKey, v] of orderedBuckets) {
    out.push({
      fundingTime: hourKey * 3_600_000,
      symbol: market,
      fundingRate: v.rate,
      markPrice: v.mark,
    });
  }
  return out;
}

function optionalExactDecimal(value: string, field: string): ExactRational | undefined {
  if (value === "") return undefined;
  return requiredExactDecimal(value, field);
}

function requiredExactDecimal(value: string, field: string): ExactRational {
  try {
    const canonical = canonicalizeExternalDecimal(value);
    if (canonical !== value) throw new Error("noncanonical");
    return ExactRational.from(canonical);
  } catch {
    throw new Error(`Tardis selected-market row has invalid ${field}`);
  }
}

function timestampMilliseconds(value: string): number {
  try {
    if (!/^(0|[1-9]\d*)$/u.test(value)) throw new Error("invalid timestamp");
    const milliseconds = BigInt(value) / 1000n;
    if (milliseconds > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("unsafe timestamp");
    return Number(milliseconds);
  } catch {
    throw new Error("Tardis selected-market row has invalid timestamp");
  }
}

function orderedHourBuckets(
  buckets: ReadonlyMap<number, { readonly rate: ExactRational; readonly mark: ExactRational | undefined }>,
): readonly (readonly [
  number,
  { readonly rate: ExactRational; readonly mark: ExactRational | undefined },
])[] {
  const ordered: [number, { readonly rate: ExactRational; readonly mark: ExactRational | undefined }][] = [];
  for (const entry of buckets) {
    const insertionIndex = ordered.findIndex(([hour]) => hour > entry[0]);
    if (insertionIndex === -1) ordered.push(entry);
    else ordered.splice(insertionIndex, 0, entry);
  }
  return ordered;
}

/**
 * `TardisDydxFundingFetcher` — wraps the Tardis.dev CSV download + cache
 * for dYdX v4 `derivative_ticker` data, exposing it as a stream of
 * hourly FundingSnapshot-compatible objects.
 *
 * Usage:
 *   const fetcher = new TardisDydxFundingFetcher({ cacheDir: "data/tardis" });
 *   const hourly = await fetcher.fetchDay(new Date("2025-04-01"), "BTC-USD");
 *   // hourly → [{ fundingTime: 1743465600000, symbol: "BTC-USD", fundingRate: 0.00004405, ... }, ...]
 */
export class TardisDydxFundingFetcher {
  private readonly cacheOnly: boolean;
  private readonly cacheClock: TardisCacheClock;
  private readonly cacheFileSystem: TardisCacheFileSystem;
  private readonly logger: TardisLogger;
  private readonly fetchPage: TardisFetchPage;
  readonly baseUrl: string;
  readonly cacheDir: string;
  readonly fetchTimeoutMs: number;

  constructor(config: TardisDydxFundingConfig = {}) {
    this.baseUrl = (config.baseUrl ?? DEFAULT_TARDIS_BASE_URL).replace(/\/$/, "");
    this.cacheDir = path.resolve(config.cacheDir ?? path.resolve(process.cwd(), ".cache", CACHE_DIR_NAME));
    this.fetchTimeoutMs = this.validateFetchTimeout(config.fetchTimeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS);
    this.cacheOnly = config.cacheOnly ?? false;
    this.cacheClock = config.cacheClock ?? nodeTardisCacheClock;
    this.cacheFileSystem = config.cacheFileSystem ?? nodeTardisCacheFileSystem;
    this.logger = config.logger ?? NOOP_LOGGER;
    this.fetchPage = config.fetchPage ?? defaultFetchPage;
  }

  private validateFetchTimeout(value: number): number {
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error(`fetchTimeoutMs must be positive finite, got ${String(value)}`);
    }
    return value;
  }

  private async fetchDayCsvWithReceipt(
    date: Date,
    market: TardisMarket,
  ): Promise<Readonly<{ readonly csv: string; readonly receipt: TardisCacheReceipt }>> {
    const url = this.buildUrl(date, market);
    const cacheFile = this.cachePath(date, market);
    const identity = { date: date.toISOString().slice(0, 10), market, url };
    const cached = await readVerifiedTardisCacheReceipt(this.cacheFileSystem, cacheFile, identity);
    if (cached !== undefined) {
      this.logger.debug("tardis-dydx cache hit", { cacheFile, url });
      const csv = await gunzipBuffer(Buffer.from(cached.contents));
      parseDerivativeTickerCsv(csv, market, date);
      return Object.freeze({ csv, receipt: cached.receipt });
    }
    if (this.cacheOnly) throw new Error(`Tardis cache entry is absent: ${cacheFile}`);
    this.logger.info("tardis-dydx downloading", { url });
    const response = validateFetchResponse(
      await this.fetchPage(Object.freeze({ url, timeoutMs: this.fetchTimeoutMs })),
    );
    if (!response.ok) {
      // Phase 35b — log the failure with warn+error so the default
      // NOOP_LOGGER methods are exercised. The throw is preserved.
      this.logger.warn("tardis-dydx non-2xx response", { url, status: response.status });
      this.logger.error("tardis-dydx fetch failed", { url, status: response.status });
      throw new Error(`Tardis dataset ${String(response.status)} for ${url}`);
    }
    const ab = await response.arrayBuffer();
    const buffer = Buffer.from(ab);
    const csv = await gunzipBuffer(buffer);
    parseDerivativeTickerCsv(csv, market, date);
    const receipt = await writeVerifiedTardisCache(
      this.cacheFileSystem,
      cacheFile,
      buffer,
      identity,
      this.cacheClock.nowUtc(),
    );
    this.logger.info("tardis-dydx cached", { cacheFile, bytes: buffer.length });
    return Object.freeze({ csv, receipt });
  }

  /**
   * Build the Tardis dataset URL for a given (date, market).
   *
   * IMPORTANT: Tardis free tier only allows the FIRST DAY of each month.
   * Calling with a non-first day will return a URL that 404s.
   */
  buildUrl(date: Date, market: TardisMarket): string {
    const y = date.getUTCFullYear();
    const m = String(date.getUTCMonth() + 1).padStart(2, "0");
    const d = String(date.getUTCDate()).padStart(2, "0");
    return `${this.baseUrl}/v1/dydx-v4/derivative_ticker/${String(y)}/${m}/${d}/${market}.csv.gz`;
  }

  /**
  Build the local cache path for a given (date, market).
  */
  cachePath(date: Date, market: string): string {
    const y = date.getUTCFullYear();
    const m = String(date.getUTCMonth() + 1).padStart(2, "0");
    const d = String(date.getUTCDate()).padStart(2, "0");
    const cacheFile = path.resolve(this.cacheDir, `${String(y)}-${m}-${d}`, `${market}.csv.gz`);
    const relativePath = path.relative(this.cacheDir, cacheFile);
    if (relativePath.startsWith(`..${path.sep}`) || path.isAbsolute(relativePath))
      throw new Error("Tardis cache path escaped its configured root");
    return cacheFile;
  }

  cacheManifestPath(date: Date, market: TardisMarket): string {
    return tardisCacheManifestPath(this.cachePath(date, market));
  }

  /**
   * Read the cached gzip file for `(date, market)` if present, else
   * download from Tardis. Returns the decompressed CSV text.
   */
  async fetchDayCsv(date: Date, market: TardisMarket): Promise<string> {
    const loaded = await this.fetchDayCsvWithReceipt(date, market);
    return loaded.csv;
  }

  /**
   * Fetch hourly funding snapshots for `market` on `date`. Returns
   * the aggregated hourly FundingSnapshot array, ready for backtest
   * ingestion.
   */
  async fetchDay(date: Date, market: TardisMarket): Promise<readonly DydxHourlyFunding[]> {
    const loaded = await this.fetchDayWithReceipt(date, market);
    return loaded.hourly;
  }

  async fetchDayWithReceipt(
    date: Date,
    market: TardisMarket,
  ): Promise<
    Readonly<{ readonly hourly: readonly DydxHourlyFunding[]; readonly receipt: TardisCacheReceipt }>
  > {
    const { csv, receipt } = await this.fetchDayCsvWithReceipt(date, market);
    const { rows } = parseDerivativeTickerCsv(csv, market, date);
    const hourly = aggregateToHourlyFunding(rows, market);
    return Object.freeze({ hourly: Object.freeze([...hourly]), receipt });
  }

  /**
   * Fetch a window of days and concatenate the hourly snapshots.
   * Useful for the Phase 25 #2 T1 backtest windows (e.g. 2025-Q1,
   * 2025-Q2, 2026-Q1).
   *
   * Each day is downloaded independently. The free tier only allows
   * the first day of each month, so this method will 404 on non-first
   * days unless a Tardis API key is supplied.
   */
  async fetchWindow(dates: readonly Date[], market: TardisMarket): Promise<readonly DydxHourlyFunding[]> {
    const out: DydxHourlyFunding[] = [];
    for (const date of dates) {
      const dayHourly = await this.fetchDay(date, market);
      out.push(...dayHourly);
    }
    return out;
  }

  /**
   * Convert hourly DydxHourlyFunding snapshots to the canonical
   * `FundingSnapshot` shape used by the existing `FundingCarryStrategy`
   * and the backtest engine.
   *
   * The fundingRate is preserved in its per-hour native unit. The
   * downstream consumer must normalize to 8h-equivalent if comparing
   * against CEX 8h funding.
   */
  toFundingSnapshots(hourly: readonly DydxHourlyFunding[]): readonly FundingSnapshot[] {
    return hourly.map((h) => {
      const snap: FundingSnapshot = {
        fundingTime: h.fundingTime,
        symbol: h.symbol,
        fundingRate: h.fundingRate,
        ...(h.markPrice !== undefined && { markPrice: h.markPrice }),
      };
      return snap;
    });
  }
}

/**
Decompress a gzip buffer to a UTF-8 string.
*/
async function gunzipBuffer(buffer: Buffer): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const source = Readable.from(buffer);
    const gz = createGunzip();
    const chunks: Buffer[] = [];
    gz.on("data", (c: Buffer) => {
      chunks.push(c);
    });
    gz.on("end", () => {
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
    gz.on("error", reject);
    source.on("error", reject);
    source.pipe(gz);
  });
}
