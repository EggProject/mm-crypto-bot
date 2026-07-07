// packages/backtest-tools/src/data/csv-funding-rate-feed.ts —
// Phase 22 Track A — CSV-backed implementation of the `FundingRateFeed`
// interface declared by the `FundingRateCarryComposition` strategy
// (packages/core/src/strategy/funding-rate-carry-composition.ts).
//
// ===========================================================================
// PHASE 22 TRACK A — FUNDING-RATE CARRY COMPOSITION (CSV FEED)
// ===========================================================================
//
// Purpose
// -------
// The funding-rate carry composition strategy (Track A) needs a historical
// funding-rate feed to compute a DirectionSignal at each M15 bar. The CSV
// form of the feed is the backtest-side implementation — the live side
// would hit a REST/WebSocket endpoint (out of scope for Phase 22).
//
// Schema
// ------
// The CSV MUST have a header row containing (at minimum) the columns:
//
//   timestamp, symbol, fundingRate
//
// In practice the historical funding files at `data/funding/binance_*_funding_8h.csv`
// use the slightly different header `fundingTime,symbol,fundingRate,markPrice`.
// For maximum flexibility this loader accepts EITHER:
//
//   - `timestamp`  (brief's nominal schema)  — required
//   - `fundingTime` (legacy / actual data)   — required
//
// Extra columns (e.g., `markPrice`) are tolerated and ignored. The column
// order is fixed — the loader does NOT reorder columns. Missing required
// columns throw with a clear error (NO silent defaults — Phase 20 lesson).
//
// Funding-rate units
// ------------------
// `fundingRate` is in DECIMAL form (0.0001 = 1 bp = 0.01% per 8h funding
// interval). This matches the existing funding-rate CSV files in
// `data/funding/` and the existing `FundingSnapshot.fundingRate` convention
// (packages/core/src/strategy/funding-carry.ts). The brief's "must be in
// percent per 8h" wording is interpreted as "the underlying quantity is a
// per-8h funding event; the numeric encoding is decimal (0.0001 = 0.01%)".
//
// Look-up semantics
// -----------------
// The carry strategy calls `getFundingRateAt(timestampMs)` at every M15
// bar. Funding is published every 8h, so M15 bars see STALE data — the
// lookup returns the most recent funding event AT OR BEFORE the query
// timestamp. This is "8h-stale" by design (the brief documents this) and
// is consistent with how production bots consume funding from a live feed
// (no lookahead bias: the future funding rate is not yet known).
//
//   - timestamp BEFORE any data → throws (Phase 20 lesson: NO silent zero)
//   - timestamp AFTER all data   → returns the last known value
//                                   (carry-forward; documented in deliverable)
//
// References
// ----------
//   - `docs/research/REPORT-phase21.md` §8 — funding-rate carry leg priority
//   - `docs/research/PHASE-20-21-ARCHIVE.md` §7 — CLI flags must work or error
//   - `packages/core/src/strategy/funding-rate-carry-composition.ts` — Feed interface
//   - Binance Funding Rate FAQ — 8h funding interval, decimal encoding
//   - bybit.eu SPOT — no perps available (MiCAR EU 2023/1114) → no live feed
//                      in Phase 22; CSV-only

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import type {
  FundingRateEntry,
  FundingRateFeed,
  FundingRateFeedConfig,
} from "@mm-crypto-bot/core";

// ---------------------------------------------------------------------------
// CSV header parsing
// ---------------------------------------------------------------------------

/**
 * `CsvHeaderMap` — the parsed column-name → column-index map from a CSV
 * header row. Used by `parseCsvRow` to extract the right field from each
 * line. `null` for `timestampIndex` means the file is malformed (missing
 * the timestamp column entirely); `parseCsvRow` throws in that case.
 */
interface CsvHeaderMap {
  readonly timestampIndex: number;
  readonly symbolIndex: number;
  readonly fundingRateIndex: number;
}

/**
 * `parseCsvHeader` — parse the first row of a CSV into a typed header map.
 *
 * The function is INTOLERANT of:
 *   - empty header lines (throws)
 *   - missing `timestamp` / `fundingTime` column (throws with column name)
 *   - missing `symbol` column (throws)
 *   - missing `fundingRate` column (throws)
 *
 * It is TOLERANT of:
 *   - extra columns (e.g., `markPrice`) — they are silently ignored
 *   - whitespace around column names — trimmed
 *   - either `timestamp` or `fundingTime` (whichever is found first wins;
 *     exact-match preferred)
 */
function parseCsvHeader(headerLine: string): CsvHeaderMap {
  if (headerLine === "") {
    throw new Error(
      `CsvFundingRateFeed: CSV file is empty (no header row). Expected columns: timestamp/fundingTime, symbol, fundingRate`,
    );
  }
  const cells = headerLine.split(",").map((c) => c.trim());
  // Find timestamp column — prefer exact "timestamp", fallback to "fundingTime".
  const tsIdx = cells.indexOf("timestamp");
  const ftIdx = cells.indexOf("fundingTime");
  const timestampIndex = tsIdx !== -1 ? tsIdx : ftIdx;
  if (timestampIndex === -1) {
    throw new Error(
      `CsvFundingRateFeed: CSV header missing required timestamp column. Expected one of [timestamp, fundingTime], got [${cells.join(", ")}]`,
    );
  }
  const symbolIndex = cells.indexOf("symbol");
  if (symbolIndex === -1) {
    throw new Error(
      `CsvFundingRateFeed: CSV header missing required 'symbol' column. Got [${cells.join(", ")}]`,
    );
  }
  const fundingRateIndex = cells.indexOf("fundingRate");
  if (fundingRateIndex === -1) {
    throw new Error(
      `CsvFundingRateFeed: CSV header missing required 'fundingRate' column. Got [${cells.join(", ")}]`,
    );
  }
  return { timestampIndex, symbolIndex, fundingRateIndex };
}

/**
 * `parseCsvRow` — parse a single data row using a pre-computed header map.
 * Returns `null` for empty / whitespace-only lines (treated as no-op).
 * Throws on:
 *   - too few columns (row truncated)
 *   - non-numeric `timestamp` or `fundingRate`
 */
function parseCsvRow(
  line: string,
  headerMap: CsvHeaderMap,
  lineNumber: number,
): FundingRateEntry | null {
  if (line.trim() === "") return null;
  const cells = line.split(",");
  const maxIdx = Math.max(headerMap.timestampIndex, headerMap.symbolIndex, headerMap.fundingRateIndex);
  if (cells.length <= maxIdx) {
    throw new Error(
      `CsvFundingRateFeed: malformed CSV row at line ${lineNumber}: expected at least ${maxIdx + 1} columns, got ${cells.length}: "${line}"`,
    );
  }
  const tsRaw = cells[headerMap.timestampIndex];
  const symRaw = cells[headerMap.symbolIndex];
  const rateRaw = cells[headerMap.fundingRateIndex];
  if (tsRaw === undefined || symRaw === undefined || rateRaw === undefined) {
    throw new Error(
      `CsvFundingRateFeed: missing cell at line ${lineNumber} (parseHeader split error): "${line}"`,
    );
  }
  const timestamp = Number(tsRaw.trim());
  const fundingRate = Number(rateRaw.trim());
  if (!Number.isFinite(timestamp)) {
    throw new Error(
      `CsvFundingRateFeed: non-numeric timestamp at line ${lineNumber}: "${tsRaw}"`,
    );
  }
  if (!Number.isFinite(fundingRate)) {
    throw new Error(
      `CsvFundingRateFeed: non-numeric fundingRate at line ${lineNumber}: "${rateRaw}"`,
    );
  }
  return {
    timestamp,
    symbol: symRaw.trim(),
    fundingRate,
  };
}

// ---------------------------------------------------------------------------
// CsvFundingRateFeed
// ---------------------------------------------------------------------------

/**
 * `CsvFundingRateFeed` — concrete `FundingRateFeed` backed by a CSV file on
 * disk. The constructor reads the file synchronously during init and stores
 * the parsed entries in memory (sorted by timestamp, ascending).
 *
 * Threading model: the constructor does file I/O via `node:fs/promises` —
 * it returns a `Promise<CsvFundingRateFeed>`. The factory function
 * `CsvFundingRateFeed.load(config)` is the recommended entry point; the
 * raw constructor is exposed for tests that need to inject already-parsed
 * data (bypassing the disk read).
 *
 * CSV schema: see file header. The loader accepts `timestamp` or
 * `fundingTime` as the time-column header. Extra columns are ignored.
 *
 * Error behavior: any malformed CSV (missing column, missing file, empty
 * file, non-numeric values) throws a descriptive `Error` — NEVER returns
 * silently empty / zero. This is the Phase 20 #1 NOT-silent-no-op defense.
 */
export class CsvFundingRateFeed implements FundingRateFeed {
  private readonly config: FundingRateFeedConfig;
  private readonly entries: readonly FundingRateEntry[];

  private constructor(config: FundingRateFeedConfig, entries: readonly FundingRateEntry[]) {
    this.config = config;
    this.entries = entries;
  }

  /**
   * `load` — async factory: read the CSV from disk, parse it, validate the
   * symbol filter, return a ready-to-query `CsvFundingRateFeed`.
   *
   * Throws (NO silent default) on:
   *   - missing file (ENOENT)
   *   - empty file
   *   - malformed header (missing required column)
   *   - non-numeric values in any data row
   *   - no rows matching the requested `symbol`
   */
  static async load(config: FundingRateFeedConfig): Promise<CsvFundingRateFeed> {
    const csvPath = resolve(config.csvPath);
    const raw: string = await readFile(csvPath, "utf8");
    const lines = raw.split("\n");
    if (lines.length === 0 || (lines.length === 1 && (lines[0] ?? "").trim() === "")) {
      throw new Error(
        `CsvFundingRateFeed: CSV file at ${csvPath} is empty (no header row)`,
      );
    }
    const headerLine = lines[0];
    if (headerLine === undefined || headerLine.trim() === "") {
      throw new Error(
        `CsvFundingRateFeed: CSV file at ${csvPath} is empty (no header row)`,
      );
    }
    const headerMap = parseCsvHeader(headerLine);

    // Parse all data rows.
    const all: FundingRateEntry[] = [];
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      if (line === undefined) continue;
      const parsed = parseCsvRow(line, headerMap, i + 1);
      if (parsed !== null) all.push(parsed);
    }
    if (all.length === 0) {
      throw new Error(
        `CsvFundingRateFeed: CSV file at ${csvPath} has a header but no data rows`,
      );
    }

    // Filter by symbol.
    const filtered = all.filter((e) => e.symbol === config.symbol);
    if (filtered.length === 0) {
      throw new Error(
        `CsvFundingRateFeed: CSV file at ${csvPath} contains no rows for symbol '${config.symbol}' (found symbols: ${uniqueSymbols(all)})`,
      );
    }

    // Sort by timestamp ASC (binary search assumes sorted input).
    filtered.sort((a, b) => a.timestamp - b.timestamp);

    return new CsvFundingRateFeed({ ...config, csvPath }, filtered);
  }

  /**
   * `fromEntries` — sync factory for tests / fixtures. Bypasses disk I/O.
   * No validation beyond ensuring the entries array is non-empty and the
   * symbol filter matches at least one entry.
   */
  static fromEntries(config: FundingRateFeedConfig, entries: readonly FundingRateEntry[]): CsvFundingRateFeed {
    if (entries.length === 0) {
      throw new Error(
        `CsvFundingRateFeed.fromEntries: entries array is empty for symbol '${config.symbol}'`,
      );
    }
    const filtered = entries.filter((e) => e.symbol === config.symbol);
    if (filtered.length === 0) {
      throw new Error(
        `CsvFundingRateFeed.fromEntries: no entries match symbol '${config.symbol}'`,
      );
    }
    const sorted = [...filtered].sort((a, b) => a.timestamp - b.timestamp);
    return new CsvFundingRateFeed(config, sorted);
  }

  /**
   * `getFundingRateAt` — return the funding rate of the most recent entry
   * at or before `timestampMs`. Binary search over the sorted entries.
   *
   * Throws if `timestampMs` is strictly less than the earliest entry
   * (Phase 20 lesson: NO silent zero). Returns the last entry's rate if
   * `timestampMs` is after all data (carry-forward; documented in
   * deliverable §missing-data-behavior).
   */
  getFundingRateAt(timestampMs: number): number {
    if (this.entries.length === 0) {
      // Should never happen (constructor throws on empty) — defensive.
      throw new Error(
        `CsvFundingRateFeed: feed for '${this.config.symbol}' has no entries`,
      );
    }
    const first = this.entries[0]!;
    if (timestampMs < first.timestamp) {
      throw new Error(
        `CsvFundingRateFeed.getFundingRateAt: query timestamp ${timestampMs} is before the earliest known funding event ${first.timestamp} for symbol '${this.config.symbol}'`,
      );
    }
    // Binary search: find rightmost entry with timestamp <= query.
    let lo = 0;
    let hi = this.entries.length - 1;
    let result = this.entries[0]!;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const entry = this.entries[mid]!;
      if (entry.timestamp <= timestampMs) {
        result = entry;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return result.fundingRate;
  }

  /**
   * `getFundingRateHistory` — return all entries within `[startTime, endTime]`
   * inclusive on both ends. Returns a fresh array (caller cannot mutate
   * internal state). Used for offline analysis and the Edge-INVARIANCE
   * pre-flight check.
   */
  getFundingRateHistory(startTime: number, endTime: number): readonly FundingRateEntry[] {
    if (startTime > endTime) {
      throw new Error(
        `CsvFundingRateFeed.getFundingRateHistory: startTime ${startTime} > endTime ${endTime}`,
      );
    }
    return this.entries.filter((e) => e.timestamp >= startTime && e.timestamp <= endTime);
  }

  /**
   * `size` — number of entries held in memory. Exposed for tests +
   * monitoring.
   */
  size(): number {
    return this.entries.length;
  }

  /**
   * `symbol` — the symbol this feed was constructed for. Exposed for
   * tests + monitoring.
   */
  symbol(): string {
    return this.config.symbol;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * `uniqueSymbols` — collect distinct symbol names from an entries array.
 * Used for diagnostic error messages when the requested symbol is missing.
 */
function uniqueSymbols(entries: readonly FundingRateEntry[]): string {
  const set = new Set<string>();
  for (const e of entries) set.add(e.symbol);
  return [...set].join(", ");
}