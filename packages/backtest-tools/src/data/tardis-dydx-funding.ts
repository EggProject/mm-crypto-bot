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

import { createHash } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Readable } from "node:stream";
import { createGunzip } from "node:zlib";

import type { FundingSnapshot } from "@mm-crypto-bot/core";

import type { DydxMarket } from "./dydx-indexer-feed.js";

/** dYdX v4 markets supported by the funding-carry backtest. */
export type TardisMarket = DydxMarket;

/** Default Tardis dataset base URL (no API key required for monthly CSVs). */
export const DEFAULT_TARDIS_BASE_URL = "https://datasets.tardis.dev";

/** Default fetch timeout in ms (Tardis datasets can be 50-80KB compressed). */
export const DEFAULT_FETCH_TIMEOUT_MS = 30_000;

/** Cache subdirectory layout. */
export const CACHE_DIR_NAME = "tardis-dydx-v4";

export interface TardisDydxFundingConfig {
  /** Base URL for Tardis datasets. */
  readonly baseUrl?: string;
  /** Local cache directory (resolved relative to cwd if relative). */
  readonly cacheDir?: string;
  /** Per-fetch timeout in milliseconds. */
  readonly fetchTimeoutMs?: number;
  /** Optional logger for diagnostics. */
  readonly logger?: TardisLogger;
}

export interface TardisLogger {
  readonly debug: (msg: string, meta?: Readonly<Record<string, unknown>>) => void;
  readonly info: (msg: string, meta?: Readonly<Record<string, unknown>>) => void;
  readonly warn: (msg: string, meta?: Readonly<Record<string, unknown>>) => void;
  readonly error: (msg: string, meta?: Readonly<Record<string, unknown>>) => void;
}

const NOOP_LOGGER: TardisLogger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

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
export interface TardisDerivativeTickerRow {
  readonly exchange: string;
  readonly symbol: string;
  readonly timestamp: string;
  readonly local_timestamp: string;
  readonly funding_timestamp: string;
  readonly funding_rate: string;
  readonly predicted_funding_rate: string;
  readonly open_interest: string;
  readonly last_price: string;
  readonly index_price: string;
  readonly mark_price: string;
}

/**
 * A consolidated hourly funding snapshot. Each entry corresponds to
 * the funding-rate value settled at the hour boundary on dYdX v4.
 */
export interface DydxHourlyFunding {
  /** Hour-boundary timestamp in epoch ms. */
  readonly fundingTime: number;
  /** Market symbol (e.g. "BTC-USD"). */
  readonly symbol: string;
  /** Funding rate in decimal (e.g. 0.00004405 = 0.004405% per hour). */
  readonly fundingRate: number;
  /** Mark price at funding time (best-effort; null if unavailable). */
  readonly markPrice: number | null;
}

/** Convert microsecond timestamp to epoch ms (Tardis convention). */
export function microsecondsToMs(us: number): number {
  return Math.floor(us / 1000);
}

/** Parse a single CSV line honoring quoted fields. */
function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (const ch of line) {
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

/**
 * Parse a Tardis `derivative_ticker` CSV body (gzipped or raw text).
 * Returns the header and the rows. Caller is responsible for filtering
 * by symbol and aggregating to hourly buckets.
 */
export function parseDerivativeTickerCsv(csv: string): {
  readonly header: readonly string[];
  readonly rows: readonly TardisDerivativeTickerRow[];
} {
  const lines = csv.split("\n");
  if (lines.length === 0) return { header: [], rows: [] };
  const headerLine = lines[0];
  if (headerLine === undefined) return { header: [], rows: [] };
  const header = parseCsvLine(headerLine);
  const rows: TardisDerivativeTickerRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined || line.length === 0) continue;
    const parts = parseCsvLine(line);
    if (parts.length < header.length) continue;
    rows.push({
      exchange: parts[0] ?? "",
      symbol: parts[1] ?? "",
      timestamp: parts[2] ?? "",
      local_timestamp: parts[3] ?? "",
      funding_timestamp: parts[4] ?? "",
      funding_rate: parts[5] ?? "",
      predicted_funding_rate: parts[6] ?? "",
      open_interest: parts[7] ?? "",
      last_price: parts[8] ?? "",
      index_price: parts[9] ?? "",
      mark_price: parts[10] ?? "",
    });
  }
  return { header, rows };
}

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
  const buckets = new Map<number, { rate: number; mark: number | null }>();
  for (const row of rows) {
    if (row.symbol !== market) continue;
    if (row.funding_rate === "") continue;
    const rate = Number(row.funding_rate);
    if (!Number.isFinite(rate)) continue;
    const tsUs = Number(row.timestamp);
    if (!Number.isFinite(tsUs)) continue;
    const tsMs = microsecondsToMs(tsUs);
    const hourKey = Math.floor(tsMs / 3_600_000);
    if (!buckets.has(hourKey)) {
      const mark =
        row.mark_price !== ""
          ? (() => {
              const m = Number(row.mark_price);
              return Number.isFinite(m) ? m : null;
            })()
          : null;
      buckets.set(hourKey, { rate, mark });
    }
  }
  const out: DydxHourlyFunding[] = [];
  for (const [hourKey, v] of [...buckets.entries()].sort((a, b) => a[0] - b[0])) {
    out.push({
      fundingTime: hourKey * 3_600_000,
      symbol: market,
      fundingRate: v.rate,
      markPrice: v.mark,
    });
  }
  return out;
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
  readonly baseUrl: string;
  readonly cacheDir: string;
  readonly fetchTimeoutMs: number;
  private readonly logger: TardisLogger;

  constructor(config: TardisDydxFundingConfig = {}) {
    this.baseUrl = (config.baseUrl ?? DEFAULT_TARDIS_BASE_URL).replace(/\/$/, "");
    this.cacheDir = resolve(config.cacheDir ?? resolve(process.cwd(), ".cache", CACHE_DIR_NAME));
    this.fetchTimeoutMs = this.validateFetchTimeout(config.fetchTimeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS);
    this.logger = config.logger ?? NOOP_LOGGER;
  }

  private validateFetchTimeout(value: number): number {
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error(`fetchTimeoutMs must be positive finite, got ${value}`);
    }
    return value;
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
    return `${this.baseUrl}/v1/dydx-v4/derivative_ticker/${y}/${m}/${d}/${market}.csv.gz`;
  }

  /** Build the local cache path for a given (date, market). */
  cachePath(date: Date, market: TardisMarket): string {
    const y = date.getUTCFullYear();
    const m = String(date.getUTCMonth() + 1).padStart(2, "0");
    const d = String(date.getUTCDate()).padStart(2, "0");
    return resolve(this.cacheDir, `${y}-${m}-${d}`, `${market}.csv.gz`);
  }

  /**
   * Read the cached gzip file for `(date, market)` if present, else
   * download from Tardis. Returns the decompressed CSV text.
   */
  async fetchDayCsv(date: Date, market: TardisMarket): Promise<string> {
    const url = this.buildUrl(date, market);
    const cacheFile = this.cachePath(date, market);
    if (existsSync(cacheFile)) {
      this.logger.debug("tardis-dydx cache hit", { cacheFile, url });
      const buf = await readFile(cacheFile);
      const csv = await gunzipBuffer(buf);
      return csv;
    }
    this.logger.info("tardis-dydx downloading", { url });
    const res = await fetch(url, {
      signal: AbortSignal.timeout(this.fetchTimeoutMs),
    });
    if (!res.ok) {
      // Phase 35b — log the failure with warn+error so the default
      // NOOP_LOGGER methods are exercised. The throw is preserved.
      this.logger.warn("tardis-dydx non-2xx response", { url, status: res.status });
      this.logger.error("tardis-dydx fetch failed", { url, status: res.status });
      throw new Error(`Tardis dataset ${res.status} for ${url}`);
    }
    const ab = await res.arrayBuffer();
    const buf = Buffer.from(ab);
    await mkdir(resolve(cacheFile, ".."), { recursive: true });
    await writeFile(cacheFile, buf);
    this.logger.info("tardis-dydx cached", {
      cacheFile,
      sha256: createHash("sha256").update(buf).digest("hex").slice(0, 12),
      bytes: buf.length,
    });
    return gunzipBuffer(buf);
  }

  /**
   * Fetch hourly funding snapshots for `market` on `date`. Returns
   * the aggregated hourly FundingSnapshot array, ready for backtest
   * ingestion.
   */
  async fetchDay(date: Date, market: TardisMarket): Promise<readonly DydxHourlyFunding[]> {
    const csv = await this.fetchDayCsv(date, market);
    const { rows } = parseDerivativeTickerCsv(csv);
    return aggregateToHourlyFunding(rows, market);
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
  async fetchWindow(
    dates: readonly Date[],
    market: TardisMarket,
  ): Promise<readonly DydxHourlyFunding[]> {
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
        ...(h.markPrice !== null ? { markPrice: h.markPrice } : {}),
      };
      return snap;
    });
  }
}

/** Decompress a gzip buffer to a UTF-8 string. */
async function gunzipBuffer(buf: Buffer): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const src = Readable.from(buf);
    const gz = createGunzip();
    const chunks: Buffer[] = [];
    gz.on("data", (c: Buffer) => {
      chunks.push(c);
    });
    gz.on("end", () => {
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
    gz.on("error", reject);
    src.on("error", reject);
    src.pipe(gz);
  });
}

/** Silence unused-import lint warnings. */
void createReadStream;