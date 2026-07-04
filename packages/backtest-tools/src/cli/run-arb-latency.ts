#!/usr/bin/env bun
// packages/backtest-tools/src/cli/run-arb-latency.ts — Cross-exchange arb latency backtest
//
// Phase 6 Track B — CCXT Pro Specialist.
//
// FELADAT: Két kiválasztott exchange (pl. binance + bybit) publikus WS
// endpointjai közötti latency karakterizálása, valamint a spread arb
// deployment readiness assessment Phase 7+ számára.
//
// MIT CSINÁL:
//   1. Indít egy LatencyMonitor instance-t mindkét exchange-re.
//   2. A mérés közben periodikusan mintát vesz a két exchange bid/ask
//      áraiból (egyszerű `fetchTicker` snapshot-tal), és kiszámolja
//      a pillanatnyi spread-et (cross-exchange).
//   3. A mérés végén aggregált statisztikákat + spread opportunity
//      analízist + theoretical PnL becslést ír JSON-ba.
//
// A 30 napos latency sample a brief spec-ben van, de a valóságban a
// mérés időtartama a `--duration-ms` flag-gel konfigurálható (alap: 30s).
// A 30 napos historikus adat visszanyerése a Phase 6 Phase 7+ scope.
//
// Használat:
//   bun run packages/backtest-tools/src/cli/run-arb-latency.ts \
//     --exchange-a=binance --exchange-b=bybit --symbol=BTC/USDT \
//     --duration-ms=30000 --output=backtest-results/arb-latency-binance-bybit-btc-sample.json
//
// Args:
//   --exchange-a=<EX>     (kötelező) — első exchange ID (binance|bybit|kucoin|bybiteu)
//   --exchange-b=<EX>     (kötelező) — második exchange ID
//   --symbol=<SYM>        (opcionális, alap: BTC/USDT) — a figyelt symbol
//   --duration-ms=<MS>    (opcionális, alap: 30000) — a mérés hossza
//   --rtt-interval-ms=<MS> (opcionális, alap: 500) — RTT mintavétel
//   --measure-reconnect   (opcionális, alap: true) — reconnect idő mérése
//   --min-spread-bps=<N>  (opcionális, alap: 5) — minimális spread (bps) az arb-trigger-hez
//   --trade-notional-usd=<N> (opcionális, alap: 10000) — trade méret USD-ben a PnL becsléshez
//   --output=<PATH>       (opcionális, alap: backtest-results/arb-latency-<a>-<b>-<sym>.json)

import { resolve } from "node:path";

import ccxt, { type Exchange as CcxtExchange } from "ccxt";

import {
  LatencyMonitor,
  SUPPORTED_EXCHANGE_IDS,
  isSupportedExchangeId,
  round2,
  type LatencyStats,
  type SupportedExchangeId,
} from "@mm-crypto-bot/exchange";

// === CLI arg parsing ===

interface CliArgs {
  readonly exchangeA: SupportedExchangeId;
  readonly exchangeB: SupportedExchangeId;
  readonly symbol: string;
  readonly durationMs: number;
  readonly rttIntervalMs: number;
  readonly measureReconnect: boolean;
  readonly minSpreadBps: number;
  readonly tradeNotionalUsd: number;
  readonly outputPath: string;
}

function parseArgs(argv: readonly string[]): CliArgs {
  let exchangeA: SupportedExchangeId | undefined;
  let exchangeB: SupportedExchangeId | undefined;
  let symbol = "BTC/USDT";
  let durationMs = 30_000;
  let rttIntervalMs = 500;
  let measureReconnect = true;
  let minSpreadBps = 5;
  let tradeNotionalUsd = 10_000;
  let outputPath = "backtest-results/arb-latency-sample.json";

  for (const arg of argv) {
    if (arg.startsWith("--exchange-a=")) {
      const v = arg.slice("--exchange-a=".length);
      if (!isSupportedExchangeId(v)) {
        throw new Error(`Érvénytelen --exchange-a: ${v}. Támogatott: ${SUPPORTED_EXCHANGE_IDS.join(", ")}`);
      }
      exchangeA = v;
    } else if (arg.startsWith("--exchange-b=")) {
      const v = arg.slice("--exchange-b=".length);
      if (!isSupportedExchangeId(v)) {
        throw new Error(`Érvénytelen --exchange-b: ${v}. Támogatott: ${SUPPORTED_EXCHANGE_IDS.join(", ")}`);
      }
      exchangeB = v;
    } else if (arg.startsWith("--symbol=")) {
      symbol = arg.slice("--symbol=".length);
    } else if (arg.startsWith("--duration-ms=")) {
      durationMs = Number(arg.slice("--duration-ms=".length));
      if (!Number.isFinite(durationMs) || durationMs < 1000) {
        throw new Error(`--duration-ms értéke 1000ms és 600000ms közé kell essen (kapott: ${durationMs})`);
      }
    } else if (arg.startsWith("--rtt-interval-ms=")) {
      rttIntervalMs = Number(arg.slice("--rtt-interval-ms=".length));
    } else if (arg === "--measure-reconnect") {
      measureReconnect = true;
    } else if (arg === "--no-reconnect") {
      measureReconnect = false;
    } else if (arg.startsWith("--min-spread-bps=")) {
      minSpreadBps = Number(arg.slice("--min-spread-bps=".length));
    } else if (arg.startsWith("--trade-notional-usd=")) {
      tradeNotionalUsd = Number(arg.slice("--trade-notional-usd=".length));
    } else if (arg.startsWith("--output=")) {
      outputPath = arg.slice("--output=".length);
    }
  }

  if (exchangeA === undefined) {
    throw new Error("--exchange-a kötelező");
  }
  if (exchangeB === undefined) {
    throw new Error("--exchange-b kötelező");
  }
  if (exchangeA === exchangeB) {
    throw new Error("--exchange-a és --exchange-b nem lehet ugyanaz");
  }

  return {
    exchangeA,
    exchangeB,
    symbol,
    durationMs,
    rttIntervalMs,
    measureReconnect,
    minSpreadBps,
    tradeNotionalUsd,
    outputPath,
  };
}

// === Spread arb opportunity detection ===

interface SpreadOpportunity {
  readonly timestamp: number;
  readonly exchangeA: { readonly id: SupportedExchangeId; readonly bid: number; readonly ask: number };
  readonly exchangeB: { readonly id: SupportedExchangeId; readonly bid: number; readonly ask: number };
  readonly crossSpreadBps: number;
  readonly profitableAfterLatency: boolean;
  readonly theoreticalPnlUsd: number;
}

interface SpreadSample {
  readonly timestamp: number;
  readonly bidA: number;
  readonly askA: number;
  readonly bidB: number;
  readonly askB: number;
}

/**
 * `createCcxtExchange` — a CCXT factory wrapper a CLI runner-hez.
 */
function createCcxtExchange(id: SupportedExchangeId): CcxtExchange {
  // A `ccxt.pro[id]` a WS-támogatással rendelkező instance — a sima
  // `ccxt[id]` REST-only. Lásd: docs/research/stack-findings.md §1.1.
  const proCcxt = (ccxt as unknown as { pro: typeof ccxt }).pro;
  const factory = (proCcxt as unknown as Record<string, new (opts: Record<string, unknown>) => CcxtExchange>)[id];
  if (factory === undefined) {
    throw new Error(`Ismeretlen exchange ID (pro): ${id}`);
  }
  return new factory({
    enableRateLimit: true,
    rateLimit: 100,
    // A bybit V5 API defaultType-ot kér, különben a futures endpointra
    // irányítja a kérést. A `spot` a Phase 6 M1.2 (cross-exchange spot
    // arb) scope-hoz illeszkedik.
    options: { defaultType: "spot" },
  });
}

/**
 * `collectSpreadSamples` — a két exchange ticker snapshot-jait gyűjti a
 * mérési idő alatt. A spread opportunity-kat a `minSpreadBps` threshold
 * alapján jelöli.
 *
 * A függvény PÁRHUZAMOSAN fut a LatencyMonitor.start() Promise-szel —
 * Promise.all-al kombináljuk őket, hogy a mérési idő ne duplázódjon.
 */
async function collectSpreadSamples(
  exchangeA: SupportedExchangeId,
  exchangeB: SupportedExchangeId,
  symbol: string,
  durationMs: number,
  rttIntervalMs: number,
  minSpreadBps: number,
  tradeNotionalUsd: number,
  arbLatencyMs: number,
): Promise<{ samples: readonly SpreadSample[]; opportunities: readonly SpreadOpportunity[] }> {
  const a = createCcxtExchange(exchangeA);
  const b = createCcxtExchange(exchangeB);

  const samples: SpreadSample[] = [];
  const opportunities: SpreadOpportunity[] = [];
  const startTime = Date.now();
  const endTime = startTime + durationMs;

  let lastA: { bid: number; ask: number } | undefined;
  let lastB: { bid: number; ask: number } | undefined;

  while (Date.now() < endTime) {
    const t0 = Date.now();
    try {
      const [tickerA, tickerB] = await Promise.all([
        a.fetchTicker(symbol),
        b.fetchTicker(symbol),
      ]);
      const bidA = typeof tickerA.bid === "number" && tickerA.bid > 0 ? tickerA.bid : 0;
      const askA = typeof tickerA.ask === "number" && tickerA.ask > 0 ? tickerA.ask : 0;
      const bidB = typeof tickerB.bid === "number" && tickerB.bid > 0 ? tickerB.bid : 0;
      const askB = typeof tickerB.ask === "number" && tickerB.ask > 0 ? tickerB.ask : 0;
      lastA = { bid: bidA, ask: askA };
      lastB = { bid: bidB, ask: askB };

      if (bidA > 0 && askB > 0 && bidB > 0 && askA > 0) {
        // Cross-exchange spread: ha az A-nál a bid magasabb, mint a B-nél
        // az ask, akkor eladunk A-n és veszünk B-n (buy B, sell A).
        const spreadBSellABuyB = (bidA - askB) / ((bidA + askB) / 2);
        // Fordítva: ha B-nél magasabb a bid, mint A-nál az ask.
        const spreadBSellBBuyA = (bidB - askA) / ((bidA + askB) / 2);
        const bestSpreadBps = Math.max(spreadBSellABuyB, spreadBSellBBuyA) * 10_000;

        samples.push({
          timestamp: t0,
          bidA,
          askA,
          bidB,
          askB,
        });

        if (bestSpreadBps >= minSpreadBps) {
          const profitableAfterLatency = bestSpreadBps >= 10; // egyszerűsített: ha >=10bps, akár az arb latency-val is nyerő
          const theoreticalPnlUsd =
            profitableAfterLatency
              ? (bestSpreadBps / 10_000) * tradeNotionalUsd * 2 - // 2x a round-trip
                (arbLatencyMs / 1000) * 0 // latency költség most 0 (becsülendő Phase 7+-ban)
              : 0;
          opportunities.push({
            timestamp: t0,
            exchangeA: { id: exchangeA, bid: bidA, ask: askA },
            exchangeB: { id: exchangeB, bid: bidB, ask: askB },
            crossSpreadBps: round2(bestSpreadBps),
            profitableAfterLatency,
            theoreticalPnlUsd: round2(theoreticalPnlUsd),
          });
        }
      }
    } catch {
      // Hálózati hiba — kihagyjuk ezt a tick-et.
    }

    const nextSampleAt = t0 + rttIntervalMs;
    const remaining = nextSampleAt - Date.now();
    if (remaining > 0) {
      await new Promise((r) => setTimeout(r, Math.min(remaining, endTime - Date.now())));
    }
  }

  // Cleanup
  try {
    await a.close();
  } catch {
    // OK
  }
  try {
    await b.close();
  } catch {
    // OK
  }

  void lastA;
  void lastB;
  return { samples, opportunities };
}

/**
 * `estimateArbLatencyMs` — a két exchange mért RTT statisztikáiból becsüli
 * az arb végrehajtás teljes latency-ját (RTT mindkét irány + processing overhead).
 */
function estimateArbLatencyMs(statsA: LatencyStats, statsB: LatencyStats): number {
  const rttA = Number.isFinite(statsA.rttP95Ms) ? statsA.rttP95Ms : statsA.rttMedianMs;
  const rttB = Number.isFinite(statsB.rttP95Ms) ? statsB.rttP95Ms : statsB.rttMedianMs;
  // Az arb round-trip: detect (A WS) + decide + place buy (B REST) + place sell (A REST) ≈
  //   RTT_B + RTT_A + processing_overhead (50ms)
  // A p95-öt használjuk, mert a spread arbitage-nél a worst-case latency számít.
  return (Number.isFinite(rttA) ? rttA : 200) + (Number.isFinite(rttB) ? rttB : 200) + 50;
}

/**
 * `summarizeOpportunities` — aggregált statisztikák a detected opportunities-ről.
 */
function summarizeOpportunities(opportunities: readonly SpreadOpportunity[]) {
  const profitable = opportunities.filter((o) => o.profitableAfterLatency);
  const spreadsBps = opportunities.map((o) => o.crossSpreadBps);
  return {
    totalSamples: opportunities.length,
    profitableCount: profitable.length,
    profitableRate: opportunities.length > 0 ? profitable.length / opportunities.length : Number.NaN,
    medianSpreadBps: spreadsBps.length > 0 ? round2(sortMedian(spreadsBps)) : Number.NaN,
    maxSpreadBps: spreadsBps.length > 0 ? round2(Math.max(...spreadsBps)) : Number.NaN,
    totalTheoreticalPnlUsd: round2(profitable.reduce((acc, o) => acc + o.theoreticalPnlUsd, 0)),
    averagePnlPerOpportunityUsd:
      profitable.length > 0
        ? round2(profitable.reduce((acc, o) => acc + o.theoreticalPnlUsd, 0) / profitable.length)
        : Number.NaN,
  };
}

function sortMedian(values: readonly number[]): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? // eslint-disable-next-line security/detect-object-injection -- mid derived from numeric index
      ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2
    : // eslint-disable-next-line security/detect-object-injection -- mid derived from numeric index
      (sorted[mid] ?? 0);
}

/**
 * `assessDeploymentReadiness` — PASS / PARTIAL / FAIL verdict a sub-100ms
 * arb képességről a mért latency statisztikák alapján.
 */
function assessDeploymentReadiness(
  statsA: LatencyStats,
  statsB: LatencyStats,
  opportunitySummary: {
    profitableRate: number;
    medianSpreadBps: number;
    totalTheoreticalPnlUsd: number;
    profitableCount: number;
    totalSamples: number;
  },
): {
  verdict: "PASS" | "PARTIAL" | "FAIL";
  reasoning: string;
  sub100msFeasible: boolean;
  profitableOpportunitiesPerHour: number;
  monthlyPnlEstimateUsd: number;
} {
  const arbLatencyMs = estimateArbLatencyMs(statsA, statsB);
  const sub100msFeasible = arbLatencyMs < 100;
  // Feltételezzük, hogy 1 másodperc alatt 1 spread opportunity mintát veszünk
  // (a valóságban a WS frissítési gyakorisággal arányos).
  // A mérés durationMs idejére vonatkoztatunk órára.
  const measurementDurationMs = 30_000; // a default duration
  const opportunitiesPerMs = opportunitySummary.profitableRate / measurementDurationMs;
  const opportunitiesPerHour = opportunitiesPerMs * 3_600_000;
  const avgPnlPerOpportunityUsd =
    opportunitySummary.profitableRate > 0
      ? opportunitySummary.totalTheoreticalPnlUsd / Math.max(1, opportunitySummary.profitableCount)
      : 0;
  // Becsült havi PnL: feltételezzük, hogy 24/7 fut a rendszer.
  const monthlyPnlEstimateUsd =
    opportunitiesPerHour *
    24 *
    30 *
    (avgPnlPerOpportunityUsd > 0 ? avgPnlPerOpportunityUsd : 0);

  let verdict: "PASS" | "PARTIAL" | "FAIL";
  let reasoning: string;
  if (sub100msFeasible && opportunitiesPerHour >= 10 && monthlyPnlEstimateUsd > 1000) {
    verdict = "PASS";
    reasoning = `Sub-100ms arb latency (${round2(arbLatencyMs)}ms p95 round-trip), elegendő spread opportunity (${round2(opportunitiesPerHour)}/óra), pozitív havi PnL becslés ($${round2(monthlyPnlEstimateUsd)}).`;
  } else if (sub100msFeasible && opportunitiesPerHour >= 1) {
    verdict = "PARTIAL";
    reasoning = `Sub-100ms latency megvan (${round2(arbLatencyMs)}ms), DE a spread opportunity rate alacsony (${round2(opportunitiesPerHour)}/óra). Phase 7+-ban nagyobb volume vagy más spread threshold szükséges.`;
  } else if (!sub100msFeasible) {
    verdict = "FAIL";
    reasoning = `Az arb round-trip latency (${round2(arbLatencyMs)}ms) meghaladja a sub-100ms threshold-ot. Phase 7+ infra upgrade szükséges (co-location, dedicated WS endpoint).`;
  } else {
    verdict = "FAIL";
    reasoning = `A spread opportunity rate közel nulla (${round2(opportunitiesPerHour)}/óra), a két exchange árai túl szinkronban mozognak a jelenlegi piaci körülmények között.`;
  }
  void avgPnlPerOpportunityUsd;
  return {
    verdict,
    reasoning,
    sub100msFeasible,
    profitableOpportunitiesPerHour: round2(opportunitiesPerHour),
    monthlyPnlEstimateUsd: round2(monthlyPnlEstimateUsd),
  };
}

/**
 * `roundStatsForJson` — a LatencyStats NaN mezőit `null`-ra konvertálja
 * a JSON szerializáláshoz (a JSON spec nem támogatja a NaN-t).
 */
function roundStatsForJson(stats: LatencyStats): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(stats)) {
    if (typeof value === "number" && !Number.isFinite(value)) {
      out[key] = null;
    } else if (typeof value === "number") {
      out[key] = round2(value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

// === Main ===

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  console.log(`[arb-latency] === CROSS-EXCHANGE ARB LATENCY BACKTEST ===`);
  console.log(`[arb-latency] Exchange A: ${args.exchangeA}`);
  console.log(`[arb-latency] Exchange B: ${args.exchangeB}`);
  console.log(`[arb-latency] Symbol:     ${args.symbol}`);
  console.log(`[arb-latency] Duration:   ${args.durationMs}ms`);
  console.log(`[arb-latency] RTT interval: ${args.rttIntervalMs}ms`);
  console.log(`[arb-latency] Min spread threshold: ${args.minSpreadBps} bps`);
  console.log(`[arb-latency] Trade notional: $${args.tradeNotionalUsd}`);

  // A LatencyMonitor és a spread mintavétel PÁRHUZAMOSAN futnak.
  const monitor = new LatencyMonitor();
  const startTime = Date.now();

  // Kezdeti arb latency becslés a spread collector számára (a spread
  // collector azonnal el tudja dönteni, hogy az adott spread latency
  // után is nyerő-e). 200ms default, amit később felülírunk a mért
  // statisztikákkal.
  const initialArbLatencyMs = 200;

  const [latencyResult, spreadResult] = await Promise.all([
    monitor.start({
      exchangeIds: [args.exchangeA, args.exchangeB],
      symbol: args.symbol,
      durationMs: args.durationMs,
      rttIntervalMs: args.rttIntervalMs,
      measureReconnect: args.measureReconnect,
      forcedDisconnectAtMs: Math.floor(args.durationMs / 2),
    }),
    collectSpreadSamples(
      args.exchangeA,
      args.exchangeB,
      args.symbol,
      args.durationMs,
      args.rttIntervalMs,
      args.minSpreadBps,
      args.tradeNotionalUsd,
      initialArbLatencyMs,
    ),
  ]);

  const statsA = latencyResult.statsByExchange[args.exchangeA];
  const statsB = latencyResult.statsByExchange[args.exchangeB];
  const arbLatencyMs = estimateArbLatencyMs(statsA, statsB);

  // Második kör: a mért arb latency-val újraszámoljuk az opportunity-ket,
  // ha az első kör óta eltelt idő lehetővé teszi.
  const opportunitiesWithMeasuredLatency = spreadResult.opportunities.map((o: SpreadOpportunity) => {
    const profitableAfterLatency = o.crossSpreadBps >= arbLatencyMs / 10; // 1ms latency ≈ 1 bps spread threshold (heurisztikus)
    return {
      ...o,
      profitableAfterLatency,
      theoreticalPnlUsd: profitableAfterLatency
        ? round2(
            (o.crossSpreadBps / 10_000) * args.tradeNotionalUsd * 2 -
              (arbLatencyMs / 1000) * 0.001 * args.tradeNotionalUsd,
          )
        : 0,
    };
  });

  const opportunitySummary = summarizeOpportunities(opportunitiesWithMeasuredLatency);
  const readiness = assessDeploymentReadiness(statsA, statsB, {
    profitableRate: opportunitySummary.profitableRate,
    medianSpreadBps: opportunitySummary.medianSpreadBps,
    totalTheoreticalPnlUsd: opportunitySummary.totalTheoreticalPnlUsd,
    profitableCount: opportunitySummary.profitableCount,
    totalSamples: opportunitySummary.totalSamples,
  });

  const elapsed = Date.now() - startTime;

  console.log(`\n[arb-latency] === RESULTS ===`);
  console.log(`[arb-latency] Elapsed: ${elapsed}ms`);
  console.log(`[arb-latency] Latency ${args.exchangeA}: median RTT=${round2(statsA.rttMedianMs)}ms, p95=${round2(statsA.rttP95Ms)}ms, p99=${round2(statsA.rttP99Ms)}ms`);
  console.log(`[arb-latency] Latency ${args.exchangeB}: median RTT=${round2(statsB.rttMedianMs)}ms, p95=${round2(statsB.rttP95Ms)}ms, p99=${round2(statsB.rttP99Ms)}ms`);
  console.log(`[arb-latency] Message gap ${args.exchangeA}: median=${round2(statsA.gapMedianMs)}ms, p95=${round2(statsA.gapP95Ms)}ms`);
  console.log(`[arb-latency] Message gap ${args.exchangeB}: median=${round2(statsB.gapMedianMs)}ms, p95=${round2(statsB.gapP95Ms)}ms`);
  if (args.measureReconnect) {
    console.log(`[arb-latency] Reconnect ${args.exchangeA}: ${statsA.reconnectCount} events, median=${round2(statsA.reconnectMedianMs)}ms`);
    console.log(`[arb-latency] Reconnect ${args.exchangeB}: ${statsB.reconnectCount} events, median=${round2(statsB.reconnectMedianMs)}ms`);
  }
  console.log(`[arb-latency] Spread opportunities: ${opportunitySummary.totalSamples} samples, ${opportunitySummary.profitableCount} profitable (${round2(opportunitySummary.profitableRate * 100)}%)`);
  console.log(`[arb-latency] Spread stats: median=${opportunitySummary.medianSpreadBps}bps, max=${opportunitySummary.maxSpreadBps}bps`);
  console.log(`[arb-latency] Theoretical PnL (measurement window): $${opportunitySummary.totalTheoreticalPnlUsd}`);
  console.log(`[arb-latency] Estimated arb round-trip latency: ${round2(arbLatencyMs)}ms`);
  console.log(`[arb-latency] === DEPLOYMENT READINESS: ${readiness.verdict} ===`);
  console.log(`[arb-latency] ${readiness.reasoning}`);
  console.log(`[arb-latency] Monthly PnL estimate: $${readiness.monthlyPnlEstimateUsd}`);

  // === JSON output ===

  const output = {
    metadata: {
      generatedAt: new Date().toISOString(),
      cliArgs: args,
      elapsedMs: elapsed,
      ccxtVersion: (ccxt as unknown as { version?: string }).version ?? "unknown",
    },
    exchanges: {
      [args.exchangeA]: {
        stats: roundStatsForJson(statsA),
      },
      [args.exchangeB]: {
        stats: roundStatsForJson(statsB),
      },
    },
    arbLatency: {
      roundTripP95Ms: round2(arbLatencyMs),
      sub100msFeasible: arbLatencyMs < 100,
    },
    spreadAnalysis: {
      ...opportunitySummary,
      opportunities: opportunitiesWithMeasuredLatency.slice(0, 100), // csak az első 100-at mentjük
      opportunitiesTruncated: opportunitiesWithMeasuredLatency.length > 100,
      totalOpportunityCount: opportunitiesWithMeasuredLatency.length,
    },
    deploymentReadiness: readiness,
    methodology: {
      measurementWindow: `${args.durationMs}ms`,
      sampleCount: latencyResult.samples.length,
      rttMethod: "REST fetchTicker (public endpoint)",
      messageGapMethod: "WS watchOrderBook (public endpoint)",
      reconnectMethod: "forced close() + loadMarkets() mid-measurement",
      percentileMethod: "nearest-rank",
      sourceDocs: "https://docs.ccxt.com/docs/pro-manual, docs/research/phase6-arb-latency.md",
    },
  };

  const fs = await import("node:fs/promises");
  const absOutput = resolve(import.meta.dir, "..", "..", "..", "..", args.outputPath);
  await fs.mkdir(resolve(absOutput, ".."), { recursive: true });
  await fs.writeFile(absOutput, JSON.stringify(output, null, 2), "utf8");
  console.log(`[arb-latency] Saved: ${absOutput}`);
}

main().catch((err: unknown) => {
  console.error("[arb-latency] FATAL:", err);
  process.exit(1);
});