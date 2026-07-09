// packages/backtest-tools/src/data/live-latency-source.ts
//
// Phase 30 — Live latency observer for the dYdX-vs-CEX cross-venue
// funding carry strategy.  Bridges the Phase 6 Track B
// `arb-latency-*.json` sample format (see
// `backtest-results/arb-latency-binance-bybit-btc-sample.json`)
// and the strategy's `LatencySource` interface.

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { LatencySource } from "@mm-crypto-bot/core";

interface ArbLatencyJson {
  readonly metadata?: {
    readonly cliArgs?: {
      readonly exchangeA?: string;
      readonly exchangeB?: string;
      readonly symbol?: string;
    };
  };
  readonly exchanges?: Readonly<Record<string, {
    readonly stats?: { readonly rttMaxMs?: number; readonly rttP95Ms?: number };
  }>>;
  readonly arbLatency?: { readonly roundTripP95Ms?: number };
}

export class JsonLatencySource implements LatencySource {
  readonly pair: string;
  readonly sourceJsonPath: string;
  readonly maxRoundTripMs: number | null;
  readonly p95RoundTripMs: number | null;

  constructor(sourceJsonPath: string) {
    this.sourceJsonPath = sourceJsonPath;
    this.maxRoundTripMs = null;
    this.p95RoundTripMs = null;
    this.pair = "unknown";
  }

  static async load(sourceJsonPath: string): Promise<JsonLatencySource> {
    const absPath = resolve(sourceJsonPath);
    const raw = await readFile(absPath, "utf8");
    const parsed = JSON.parse(raw) as ArbLatencyJson;
    const source = new JsonLatencySource(sourceJsonPath);
    const exchangeA = parsed.metadata?.cliArgs?.exchangeA;
    const exchangeB = parsed.metadata?.cliArgs?.exchangeB;
    const symbol = parsed.metadata?.cliArgs?.symbol ?? "unknown";
    const symbolSlug = symbol.replace("/", "-").toLowerCase().replace("usdt", "");
    (source as { pair: string }).pair =
      exchangeA && exchangeB
        ? `${exchangeA}-${exchangeB}-${symbolSlug}`
        : `unknown-${symbolSlug}`;
    const aMax = parsed.exchanges?.[exchangeA ?? ""]?.stats?.rttMaxMs;
    const bMax = parsed.exchanges?.[exchangeB ?? ""]?.stats?.rttMaxMs;
    const candidates: number[] = [];
    if (typeof aMax === "number") candidates.push(aMax);
    if (typeof bMax === "number") candidates.push(bMax);
    (source as { maxRoundTripMs: number | null }).maxRoundTripMs =
      candidates.length > 0 ? Math.max(...candidates) : null;
    (source as { p95RoundTripMs: number | null }).p95RoundTripMs =
      typeof parsed.arbLatency?.roundTripP95Ms === "number"
        ? parsed.arbLatency.roundTripP95Ms
        : null;
    return source;
  }

  observeRoundTripMs(_nowMs: number): number | null {
    return this.maxRoundTripMs;
  }
}

export class ConstantLatencySource implements LatencySource {
  readonly pair: string;
  readonly roundTripMs: number;

  constructor(pair: string, roundTripMs: number) {
    this.pair = pair;
    this.roundTripMs = roundTripMs;
  }

  observeRoundTripMs(_nowMs: number): number {
    return this.roundTripMs;
  }
}
