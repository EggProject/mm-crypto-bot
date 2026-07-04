#!/usr/bin/env bun
// packages/backtest-tools/src/cli/download-funding-rates.ts — historical
// funding-rate downloader from Binance public API.
//
// Phase 6 Track A — The funding-rate carry backtest needs 8h funding
// snapshots for BTC/ETH/SOL covering 2024-01 → 2026-07. We download the
// data from `https://fapi.binance.com/fapi/v1/fundingRate` and persist
// to `data/funding/binance_<sym>_funding_8h.csv`.
//
// Usage:
//   bun run packages/backtest-tools/src/cli/download-funding-rates.ts
//   bun run packages/backtest-tools/src/cli/download-funding-rates.ts --symbols=BTCUSDT,ETHUSDT,SOLUSDT
//   bun run packages/backtest-tools/src/cli/download-funding-rates.ts --start=2024-01-01 --end=2026-07-04

import { resolve } from "node:path";

const DEFAULT_SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT"] as const;
const FUNDING_API = "https://fapi.binance.com/fapi/v1/fundingRate";
const PAGE_LIMIT = 1000;
const RATE_LIMIT_SLEEP_MS = 250;

interface CliArgs {
  readonly symbols: readonly string[];
  readonly startMs: number;
  readonly endMs: number;
  readonly outDir: string;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  let symbols: readonly string[] = DEFAULT_SYMBOLS;
  let startMs = Date.parse("2024-01-01T00:00:00Z");
  let endMs = Date.now();
  let outDir = resolve(import.meta.dir, "..", "..", "..", "..", "data", "funding");
  for (const arg of args) {
    if (arg.startsWith("--symbols=")) {
      symbols = arg.slice("--symbols=".length).split(",").map((s) => s.trim().toUpperCase());
    } else if (arg.startsWith("--start=")) {
      startMs = Date.parse(arg.slice("--start=".length));
    } else if (arg.startsWith("--end=")) {
      endMs = Date.parse(arg.slice("--end=".length));
    } else if (arg.startsWith("--out=")) {
      outDir = resolve(arg.slice("--out=".length));
    }
  }
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs >= endMs) {
    throw new Error(`Invalid time range: start=${startMs} end=${endMs}`);
  }
  return { symbols, startMs, endMs, outDir };
}

interface FundingRow {
  fundingTime: number;
  symbol: string;
  fundingRate: number;
  markPrice: string;
}

async function fetchPage(symbol: string, startMs: number, endMs: number): Promise<readonly FundingRow[]> {
  const url = `${FUNDING_API}?symbol=${symbol}&startTime=${startMs}&endTime=${endMs}&limit=${PAGE_LIMIT}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) {
    throw new Error(`Binance API ${res.status}: ${await res.text()}`);
  }
  const data = (await res.json()) as FundingRow[];
  if (!Array.isArray(data)) {
    throw new Error(`Unexpected response shape for ${symbol}: ${JSON.stringify(data).slice(0, 200)}`);
  }
  return data;
}

async function downloadSymbol(symbol: string, startMs: number, endMs: number, outFile: string): Promise<number> {
  const rows: FundingRow[] = [];
  let cursor = startMs;
  while (cursor < endMs) {
    const page = await fetchPage(symbol, cursor, endMs);
    if (page.length === 0) break;
    rows.push(...page);
    const lastTs = page[page.length - 1]!.fundingTime;
    if (lastTs <= cursor) break; // safety
    cursor = lastTs + 1;
    if (page.length < PAGE_LIMIT) break;
    await new Promise((r) => setTimeout(r, RATE_LIMIT_SLEEP_MS));
  }
  const fs = await import("node:fs/promises");
  await fs.mkdir(resolve(outFile, ".."), { recursive: true });
  const header = "fundingTime,symbol,fundingRate,markPrice\n";
  const body = rows
    .map((r) => `${r.fundingTime},${r.symbol},${r.fundingRate},${r.markPrice}`)
    .join("\n");
  await fs.writeFile(outFile, header + body + "\n", "utf8");
  return rows.length;
}

async function main(): Promise<void> {
  const args = parseArgs();
  console.log(`[download-funding-rates] symbols=${args.symbols.join(",")}`);
  console.log(`[download-funding-rates] period=${new Date(args.startMs).toISOString()} → ${new Date(args.endMs).toISOString()}`);
  console.log(`[download-funding-rates] outDir=${args.outDir}`);

  const t0 = Date.now();
  for (const sym of args.symbols) {
    const lower = sym.toLowerCase();
    const outFile = resolve(args.outDir, `binance_${lower}_funding_8h.csv`);
    try {
      const count = await downloadSymbol(sym, args.startMs, args.endMs, outFile);
      console.log(`[download-funding-rates] ✓ ${sym}: ${count} snapshots → ${outFile}`);
    } catch (err) {
      console.error(`[download-funding-rates] ✗ ${sym}: ${(err as Error).message}`);
    }
  }
  const elapsedMs = Date.now() - t0;
  console.log(`[download-funding-rates] Done in ${elapsedMs}ms`);
}

main().catch((err: unknown) => {
  console.error("[download-funding-rates] FATAL:", err);
  process.exit(1);
});