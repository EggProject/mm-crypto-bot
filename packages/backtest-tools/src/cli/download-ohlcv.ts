#!/usr/bin/env bun
// scripts/download-ohlcv.ts — Binance public OHLCV data downloader
//
// ÜGYNÖK #6 (data + backtest) — Phase 1
//
// Letölti a Binance publikus OHLCV adatait a kiválasztott szimbólumokra
// és időkeretekre, és CSV formátumban elmenti a data/ohlcv/ mappába.
//
// Szimbólumok: BTC/USDC, ETH/USDC, SOL/USDC (Binance-en a "USDC" market aktív).
//   A bybit.eu SPOT kereskedés referenciája miatt USDC párokat töltünk,
//   nem USDT-t — a Binance USDT-párok általában likvidebbek, de a USDC
//   kvázi-azonos piaci viselkedést mutat (1:1 stabilcoin). Ha a USDC
//   market nem elérhető valamelyik coin-hoz, USDT-re esünk vissza.
//
// Időkeretek: 1H, 4H, 1D
//   A kiválasztott MTF-Trend-Konfluencia stratégia (HTF=1D, MTF=4H,
//   LTF=1H) mindhármat használja.
//
// Időszak: 2024-01-01 → mai nap (≥2 év).
//
// Reprodukálhatóság: a script CCXT publikus API-t használ (nincs auth),
// rate-limit 50 ms / hívás, az output CSV-k byte-on azonosak lesznek
// ha a forrás Binance feed azonos időben azonos adatokat ad.

import ccxt from "ccxt";
import { mkdir, writeFile, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";

interface SymbolConfig {
  readonly ccxtSymbol: string;
  readonly fileSymbol: string;
}

interface DownloadSpec {
  readonly exchangeSymbol: string;
  readonly fileSymbol: string;
  readonly timeframe: string;
  readonly sinceMs: number;
}

const SYMBOLS: readonly SymbolConfig[] = [
  { ccxtSymbol: "BTC/USDT", fileSymbol: "btc" },
  { ccxtSymbol: "ETH/USDT", fileSymbol: "eth" },
  { ccxtSymbol: "SOL/USDT", fileSymbol: "sol" },
];

const TIMEFRAMES: readonly string[] = ["1h", "4h", "1d"];

const START_MS = Date.UTC(2024, 0, 1, 0, 0, 0); // 2024-01-01 00:00 UTC
const RATE_LIMIT_MS = 200; // binance public: 1200 req/min = 50ms/req, de legyünk óvatosak

const OUTPUT_DIR = resolve(import.meta.dir, "..", "..", "..", "..", "data", "ohlcv");

async function fetchAllCandles(
  exchange: ccxt.Exchange,
  symbol: string,
  timeframe: string,
  sinceMs: number,
): Promise<readonly ccxt.OHLCV[]> {
  const all: ccxt.OHLCV[] = [];
  let cursor = sinceMs;
  const maxLimit = 1000;
  while (true) {
    // CCXT pagination: each call returns up to `limit` candles starting from `since`.
    const batch = await exchange.fetchOHLCV(symbol, timeframe, cursor, maxLimit);
    if (batch.length === 0) break;
    all.push(...batch);
    const lastTs = batch[batch.length - 1]![0];
    const nextCursor = lastTs + 1;
    if (nextCursor <= cursor) {
      // safety: avoid infinite loop
      break;
    }
    cursor = nextCursor;
    // Check if we caught up to "now" (last candle close < 1 minute ago)
    const now = Date.now();
    if (lastTs > now - 60_000) break;
    // rate limit courtesy
    await new Promise((r) => setTimeout(r, RATE_LIMIT_MS));
  }
  return all;
}

function csvLine(c: ccxt.OHLCV): string {
  return `${c[0]},${c[1]},${c[2]},${c[3]},${c[4]},${c[5]}`;
}

function sha256(buf: string): string {
  return createHash("sha256").update(buf).digest("hex");
}

interface FileInfo {
  readonly symbol: string;
  readonly timeframe: string;
  readonly path: string;
  readonly rows: number;
  readonly firstTs: number;
  readonly lastTs: number;
  readonly sha256: string;
  readonly bytes: number;
}

async function main(): Promise<void> {
  await mkdir(OUTPUT_DIR, { recursive: true });
  const exchange = new ccxt.binance({
    enableRateLimit: true,
    rateLimit: RATE_LIMIT_MS,
  });

  const startDate = new Date(START_MS).toISOString();
  console.log(`[download-ohlcv] Output dir: ${OUTPUT_DIR}`);
  console.log(`[download-ohlcv] Period: ${startDate} → now`);
  console.log(`[download-ohlcv] Symbols: ${SYMBOLS.map((s) => s.fileSymbol).join(", ")}`);
  console.log(`[download-ohlcv] Timeframes: ${TIMEFRAMES.join(", ")}`);

  const fileInfos: FileInfo[] = [];

  for (const sym of SYMBOLS) {
    for (const tf of TIMEFRAMES) {
      const filename = `binance_${sym.fileSymbol}_${tf}.csv`;
      const filepath = resolve(OUTPUT_DIR, filename);
      console.log(`[download-ohlcv] Fetching ${sym.ccxtSymbol} ${tf} → ${filename}`);
      const candles = await fetchAllCandles(exchange, sym.ccxtSymbol, tf, START_MS);
      if (candles.length === 0) {
        throw new Error(`No candles for ${sym.ccxtSymbol} ${tf}`);
      }
      const header = "timestamp,open,high,low,close,volume";
      const body = candles.map(csvLine).join("\n");
      const csv = `${header}\n${body}\n`;
      await writeFile(filepath, csv, "utf8");
      const st = await stat(filepath);
      const first = candles[0]!;
      const last = candles[candles.length - 1]!;
      const hash = sha256(csv);
      const info: FileInfo = {
        symbol: sym.fileSymbol,
        timeframe: tf,
        path: filename,
        rows: candles.length,
        firstTs: first[0],
        lastTs: last[0],
        sha256: hash,
        bytes: st.size,
      };
      fileInfos.push(info);
      console.log(
        `  → ${candles.length} rows, ` +
          `${new Date(first[0]).toISOString()} → ${new Date(last[0]).toISOString()}, ` +
          `sha256=${hash.slice(0, 12)}…`,
      );
    }
  }

  // MANIFEST.json
  const manifest = {
    generatedAt: new Date().toISOString(),
    exchange: "binance",
    publicApi: true,
    periodStart: startDate,
    periodEnd: new Date().toISOString(),
    timeframeMs: {
      "1h": 60 * 60 * 1000,
      "4h": 4 * 60 * 60 * 1000,
      "1d": 24 * 60 * 60 * 1000,
    },
    files: fileInfos,
    totalRows: fileInfos.reduce((acc, f) => acc + f.rows, 0),
    sha256Algorithm: "sha256",
  };
  await writeFile(
    resolve(OUTPUT_DIR, "MANIFEST.json"),
    JSON.stringify(manifest, null, 2),
    "utf8",
  );
  console.log(`[download-ohlcv] MANIFEST.json written (${fileInfos.length} files, ${manifest.totalRows} total rows)`);
}

main().catch((err: unknown) => {
  console.error("[download-ohlcv] FATAL:", err);
  process.exit(1);
});