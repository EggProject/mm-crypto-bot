#!/usr/bin/env bun
// packages/backtest-tools/src/cli/run-arb-latency.ts — Cross-exchange arb latency backtest
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

import { randomUUID } from "node:crypto";
import path from "node:path";

import ccxt, { type Exchange as CcxtExchange } from "ccxt";

import { StderrJsonSink, StructuredLogger, type Logger, type UtcClock } from "@mm-crypto-bot/logging";
import { resolveCcxtPackageVersion } from "./ccxt-package-provenance.js";
import {
  assessDeploymentReadiness,
  estimateArbLatencyMs,
  roundStatsForJson,
  summarizeOpportunities,
  type SpreadOpportunity,
} from "./arb-latency-calculations.js";
import {
  LatencyMonitor,
  isSupportedExchangeId,
  round2,
  type SupportedExchangeId,
} from "@mm-crypto-bot/exchange";

// === CLI arg parsing ===

interface CliArguments {
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

// eslint-disable-next-line unicorn/no-exports-in-scripts -- The executable exposes its explicit execution output port for embedded callers.
export interface ArbLatencyCliOutput {
  readonly writeLine: (line: string) => void;
}

// eslint-disable-next-line unicorn/no-exports-in-scripts -- The executable accepts infrastructure only through this explicit dependency port.
export interface ArbLatencyCliDependencies {
  readonly argv: readonly string[];
  readonly collectSpreadSamples: typeof collectSpreadSamples;
  readonly createLatencyMonitor: () => Pick<LatencyMonitor, "start">;
  readonly logger: Logger;
  readonly output: ArbLatencyCliOutput;
  readonly resolveCcxtPackageVersion: () => Promise<string>;
}

class CliArgumentsValidationError extends Error {
  public constructor() {
    super("CLI argument validation failed");
    this.name = "CliArgumentsValidationError";
  }
}

function failCliArgumentsValidation(): never {
  throw new CliArgumentsValidationError();
}

class SystemUtcClock implements UtcClock {
  public now(): Date {
    return new Date();
  }
}

function createRuntimeLogger(): StructuredLogger {
  const runId = randomUUID();
  return new StructuredLogger({
    clock: new SystemUtcClock(),
    context: { component: "arb-latency", correlationId: runId, runId },
    maximumBufferedRecords: 256,
    sink: new StderrJsonSink(),
  });
}

function createCliDependencies(logger: Logger): ArbLatencyCliDependencies {
  return {
    argv: process.argv.slice(2),
    collectSpreadSamples,
    createLatencyMonitor: () => new LatencyMonitor(),
    logger,
    output: {
      writeLine: (line) => {
        process.stdout.write(`${line}\n`);
      },
    },
    resolveCcxtPackageVersion,
  };
}

function formatNumber(value: number): string {
  return value.toString();
}

function parseArguments(argv: readonly string[]): CliArguments {
  let exchangeA: SupportedExchangeId | undefined;
  let exchangeB: SupportedExchangeId | undefined;
  let symbol = "BTC/USDT";
  let durationMs = 30_000;
  let rttIntervalMs = 500;
  let isMeasureReconnect = true;
  let minSpreadBps = 5;
  let tradeNotionalUsd = 10_000;
  let outputPath = "backtest-results/arb-latency-sample.json";

  for (const argument of argv) {
    if (argument.startsWith("--exchange-a=")) {
      const v = argument.slice("--exchange-a=".length);
      if (!isSupportedExchangeId(v)) {
        failCliArgumentsValidation();
      }
      exchangeA = v;
    } else if (argument.startsWith("--exchange-b=")) {
      const v = argument.slice("--exchange-b=".length);
      if (!isSupportedExchangeId(v)) {
        failCliArgumentsValidation();
      }
      exchangeB = v;
    } else if (argument.startsWith("--symbol=")) {
      symbol = argument.slice("--symbol=".length);
    } else if (argument.startsWith("--duration-ms=")) {
      durationMs = Number(argument.slice("--duration-ms=".length));
      if (!Number.isFinite(durationMs) || durationMs < 1000) {
        failCliArgumentsValidation();
      }
    } else if (argument.startsWith("--rtt-interval-ms=")) {
      rttIntervalMs = Number(argument.slice("--rtt-interval-ms=".length));
    } else if (argument === "--measure-reconnect") {
      isMeasureReconnect = true;
    } else if (argument === "--no-reconnect") {
      isMeasureReconnect = false;
    } else if (argument.startsWith("--min-spread-bps=")) {
      minSpreadBps = Number(argument.slice("--min-spread-bps=".length));
    } else if (argument.startsWith("--trade-notional-usd=")) {
      tradeNotionalUsd = Number(argument.slice("--trade-notional-usd=".length));
    } else if (argument.startsWith("--output=")) {
      outputPath = argument.slice("--output=".length);
    }
  }

  if (exchangeA === undefined) {
    failCliArgumentsValidation();
  }
  if (exchangeB === undefined) {
    failCliArgumentsValidation();
  }
  if (exchangeA === exchangeB) {
    failCliArgumentsValidation();
  }

  return {
    exchangeA,
    exchangeB,
    symbol,
    durationMs,
    rttIntervalMs,
    measureReconnect: isMeasureReconnect,
    minSpreadBps,
    tradeNotionalUsd,
    outputPath,
  };
}

// === Spread arb opportunity detection ===

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
  const factory = Reflect.get(ccxt.pro, id);
  if (!isCcxtExchangeFactory(factory)) {
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

function isCcxtExchangeFactory(
  value: unknown,
): value is new (options: Record<string, unknown>) => CcxtExchange {
  return typeof value === "function";
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
      const [tickerA, tickerB] = await Promise.all([a.fetchTicker(symbol), b.fetchTicker(symbol)]);
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
          const isProfitableAfterLatency = bestSpreadBps >= 10; // egyszerűsített: ha >=10bps, akár az arb latency-val is nyerő
          const theoreticalPnlUsd = isProfitableAfterLatency
            ? (bestSpreadBps / 10_000) * tradeNotionalUsd * 2
            : 0;
          opportunities.push({
            timestamp: t0,
            exchangeA: { id: exchangeA, bid: bidA, ask: askA },
            exchangeB: { id: exchangeB, bid: bidB, ask: askB },
            crossSpreadBps: round2(bestSpreadBps),
            profitableAfterLatency: isProfitableAfterLatency,
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

// === Main ===

// eslint-disable-next-line unicorn/no-exports-in-scripts -- Embedded callers use this same production CLI execution path.
export async function runArbLatencyCli(dependencies: ArbLatencyCliDependencies): Promise<void> {
  const arguments_ = parseArguments(dependencies.argv);
  dependencies.logger.info("arb.latency.backtest.started", { configurationStatus: "validated" });

  // A LatencyMonitor és a spread mintavétel PÁRHUZAMOSAN futnak.
  const monitor = dependencies.createLatencyMonitor();
  const startTime = Date.now();

  const [latencyResult, spreadResult] = await Promise.all([
    monitor.start({
      exchangeIds: [arguments_.exchangeA, arguments_.exchangeB],
      symbol: arguments_.symbol,
      durationMs: arguments_.durationMs,
      rttIntervalMs: arguments_.rttIntervalMs,
      measureReconnect: arguments_.measureReconnect,
      forcedDisconnectAtMs: Math.floor(arguments_.durationMs / 2),
    }),
    dependencies.collectSpreadSamples(
      arguments_.exchangeA,
      arguments_.exchangeB,
      arguments_.symbol,
      arguments_.durationMs,
      arguments_.rttIntervalMs,
      arguments_.minSpreadBps,
      arguments_.tradeNotionalUsd,
    ),
  ]);

  const statsA = latencyResult.statsByExchange[arguments_.exchangeA];
  const statsB = latencyResult.statsByExchange[arguments_.exchangeB];
  const arbLatencyMs = estimateArbLatencyMs(statsA, statsB);

  // Második kör: a mért arb latency-val újraszámoljuk az opportunity-ket,
  // ha az első kör óta eltelt idő lehetővé teszi.
  const opportunitiesWithMeasuredLatency = spreadResult.opportunities.map((o: SpreadOpportunity) => {
    const isProfitableAfterLatency = o.crossSpreadBps >= arbLatencyMs / 10; // 1ms latency ≈ 1 bps spread threshold (heurisztikus)
    return {
      ...o,
      profitableAfterLatency: isProfitableAfterLatency,
      theoreticalPnlUsd: isProfitableAfterLatency
        ? round2(
            (o.crossSpreadBps / 10_000) * arguments_.tradeNotionalUsd * 2 -
              (arbLatencyMs / 1000) * 0.001 * arguments_.tradeNotionalUsd,
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

  dependencies.logger.info("arb.latency.backtest.completed", {
    arbLatencyMs: formatNumber(round2(arbLatencyMs)),
    elapsedMs: formatNumber(elapsed),
    exchangeALatency: {
      gapMedianMs: formatNumber(round2(statsA.gapMedianMs)),
      gapP95Ms: formatNumber(round2(statsA.gapP95Ms)),
      reconnectCount: formatNumber(statsA.reconnectCount),
      reconnectMedianMs: formatNumber(round2(statsA.reconnectMedianMs)),
      rttMedianMs: formatNumber(round2(statsA.rttMedianMs)),
      rttP95Ms: formatNumber(round2(statsA.rttP95Ms)),
      rttP99Ms: formatNumber(round2(statsA.rttP99Ms)),
    },
    exchangeBLatency: {
      gapMedianMs: formatNumber(round2(statsB.gapMedianMs)),
      gapP95Ms: formatNumber(round2(statsB.gapP95Ms)),
      reconnectCount: formatNumber(statsB.reconnectCount),
      reconnectMedianMs: formatNumber(round2(statsB.reconnectMedianMs)),
      rttMedianMs: formatNumber(round2(statsB.rttMedianMs)),
      rttP95Ms: formatNumber(round2(statsB.rttP95Ms)),
      rttP99Ms: formatNumber(round2(statsB.rttP99Ms)),
    },
    monthlyPnlEstimateUsd: formatNumber(readiness.monthlyPnlEstimateUsd),
    readinessReasoning: readiness.reasoning,
    readinessVerdict: readiness.verdict,
    spreadAnalysis: {
      maxSpreadBps: formatNumber(opportunitySummary.maxSpreadBps),
      medianSpreadBps: formatNumber(opportunitySummary.medianSpreadBps),
      profitableCount: formatNumber(opportunitySummary.profitableCount),
      profitableRatePercent: formatNumber(round2(opportunitySummary.profitableRate * 100)),
      totalSamples: formatNumber(opportunitySummary.totalSamples),
      totalTheoreticalPnlUsd: formatNumber(opportunitySummary.totalTheoreticalPnlUsd),
    },
  });

  // === JSON output ===

  const output = {
    metadata: {
      generatedAt: new Date().toISOString(),
      cliArgs: arguments_,
      elapsedMs: elapsed,
      ccxtVersion: await dependencies.resolveCcxtPackageVersion(),
    },
    exchanges: {
      [arguments_.exchangeA]: {
        stats: roundStatsForJson(statsA),
      },
      [arguments_.exchangeB]: {
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
      measurementWindow: `${formatNumber(arguments_.durationMs)}ms`,
      sampleCount: latencyResult.samples.length,
      rttMethod: "REST fetchTicker (public endpoint)",
      messageGapMethod: "WS watchOrderBook (public endpoint)",
      reconnectMethod: "forced close() + loadMarkets() mid-measurement",
      percentileMethod: "nearest-rank",
      sourceDocs: "https://docs.ccxt.com/docs/pro-manual, docs/research/phase6-arb-latency.md",
    },
  };

  const fs = await import("node:fs/promises");
  const absOutput = path.resolve(import.meta.dir, "..", "..", "..", "..", arguments_.outputPath);
  await fs.mkdir(path.resolve(absOutput, ".."), { recursive: true });
  await fs.writeFile(absOutput, JSON.stringify(output, undefined, 2), "utf8");
  dependencies.output.writeLine(
    JSON.stringify({ outputPath: absOutput, schema: "arb-latency-cli-output@1" }),
  );
  dependencies.logger.info("arb.latency.output.saved", { schema: "arb-latency-cli-output@1" });
}

if (import.meta.main) {
  const logger = createRuntimeLogger();
  let exitCode = 0;
  try {
    await runArbLatencyCli(createCliDependencies(logger));
  } catch (error: unknown) {
    const failure =
      error instanceof CliArgumentsValidationError
        ? { failureCategory: "configuration", failureCode: "INVALID_CLI_ARGUMENTS" }
        : { failureCategory: "execution", failureCode: "BACKTEST_EXECUTION_FAILED" };
    try {
      logger.error("arb.latency.backtest.failed", failure);
    } catch {
      // Failure logging must not prevent the primary failure outcome.
    }
    exitCode = 1;
  } finally {
    try {
      await logger.shutdown();
    } catch {
      exitCode = 1;
    }
  }
  process.exitCode = exitCode;
}
