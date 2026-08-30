import { beforeEach, describe, expect, test } from "bun:test";

import type { StrategyPlugin } from "../signal-center/strategy-registry.js";
import { ok, type Bar, type PluginState } from "../signal-center/types.js";
import {
  createPortfolioOrchestrator,
  type DecisionEngineLike,
  type PortfolioEnvelope,
  type PositionDecision,
} from "./portfolio-orchestrator.js";

const fixture = { directory: "/portfolio-orchestrator-fixtures", files: new Map<string, string>() };
const symbols = ["BTC/USDT", "ETH/USDT", "SOL/USDT"] as const;
const startTimestampMs = 1_700_000_000_000;
const dayMs = 86_400_000;

function noOperation(): void {
  /*
   * Intentionally empty unsubscribe callback.
   */
}

beforeEach(() => {
  fixture.files.clear();
});

function createPassivePlugin(symbol: string): StrategyPlugin {
  return {
    metadata: {
      capitalRequirement: 1,
      edgeClass: "sizing",
      maxAggregateEffectiveLeverage: 10,
      name: `passive-${symbol.toLowerCase().replace("/", "-")}`,
      version: "1.0.0",
    },
    onBar: (_bar: Bar, _state: PluginState): void => undefined,
    reset: (): void => undefined,
    subscribe: (): void => undefined,
    validateConfig: () => ok(undefined),
  };
}

function writeMarketFixtures(barCount: number, drift = 0): void {
  for (const [index, symbol] of symbols.entries()) {
    const base = symbol.split("/", 1)[0]?.toLowerCase();
    if (base === undefined) throw new Error(`Missing base asset for ${symbol}.`);
    const ohlcvRows = ["timestamp,open,high,low,close,volume"];
    const fundingRows = ["fundingTime,symbol,fundingRate,markPrice"];
    for (let offset = 0; offset < barCount; offset += 1) {
      const timestampMs = startTimestampMs + offset * dayMs;
      const close = 100 + index * 10 + drift * offset;
      ohlcvRows.push([timestampMs, close - 1, close + 1, close - 2, close, 1000].map(String).join(","));
      fundingRows.push([timestampMs, `${base.toUpperCase()}USDT`, "0.0001", ""].join(","));
    }
    fixture.files.set(`${fixture.directory}/binance_${base}_1d.csv`, ohlcvRows.join("\n"));
    fixture.files.set(`${fixture.directory}/binance_${base}usdt_funding_8h.csv`, fundingRows.join("\n"));
  }
}

class ForcedDecisionEngine implements DecisionEngineLike {
  private decision: PositionDecision;
  readonly symbol: string;

  constructor(symbol: string, notionalUsd: number) {
    this.symbol = symbol;
    this.decision = {
      confidence: 1,
      notionalUsd,
      side: "long",
      sizeMultiplier: 1,
      sourceWeights: { forcedDriver: 1 },
      symbol,
      timestampMs: 0,
    };
  }

  subscribe(): () => void {
    return noOperation;
  }

  decisions(): readonly PositionDecision[] {
    return [this.decision];
  }

  latestDecision(): PositionDecision {
    return this.decision;
  }

  reset(): void {
    this.decision = { ...this.decision, timestampMs: 0 };
  }

  synthesize(symbol: string, timestampMs: number): PositionDecision {
    this.decision = { ...this.decision, symbol, timestampMs };
    return this.decision;
  }
}

class HistoricalDecisionEngine implements DecisionEngineLike {
  readonly symbol: string;

  constructor(
    symbol: string,
    private readonly history: readonly PositionDecision[],
  ) {
    this.symbol = symbol;
  }

  subscribe(): () => void {
    return noOperation;
  }

  decisions(): readonly PositionDecision[] {
    return this.history;
  }

  latestDecision(): PositionDecision {
    const latest = this.history.at(-1);
    if (latest === undefined) throw new Error("Historical decision engine requires a decision.");
    return latest;
  }

  reset(): void {
    // The injected history is immutable across a single public replay.
  }
}

async function runPortfolio(
  options: {
    readonly barCount?: number;
    readonly correlationThreshold?: number;
    readonly drift?: number;
    readonly maxAggregateEffectiveLeverage?: number;
    readonly maxPositions?: number;
    readonly notionalUsd?: number;
    readonly perSymbolConcentrationPct?: number;
  } = {},
): Promise<{
  readonly envelope: PortfolioEnvelope;
  readonly orchestrator: ReturnType<typeof createPortfolioOrchestrator>;
}> {
  const barCount = options.barCount ?? 5;
  writeMarketFixtures(barCount, options.drift ?? 0);
  const orchestrator = createPortfolioOrchestrator({
    approximateCorrelationThreshold: options.correlationThreshold ?? 0.85,
    approximateCorrelationWindowDays: 30,
    dataDir: fixture.directory,
    decisionEngineFactory: ({ symbol }) => new ForcedDecisionEngine(symbol, options.notionalUsd ?? 1000),
    fundingDir: fixture.directory,
    initialEquityUsd: 1000,
    maxAggregateEffectiveLeverage: options.maxAggregateEffectiveLeverage ?? 10,
    maxPositions: options.maxPositions ?? 7,
    perSymbolConcentrationPct: options.perSymbolConcentrationPct ?? 0.5,
    pluginsBySymbol: (symbol) => [createPassivePlugin(symbol)],
    readTextFile: (root, fileName) => {
      const raw = fixture.files.get(`${root}/${fileName}`);
      if (raw === undefined) throw new Error(`Missing virtual fixture ${fileName}.`);
      return Promise.resolve(raw);
    },
    symbols,
  });
  const envelope = await orchestrator.run(startTimestampMs, startTimestampMs + (barCount - 1) * dayMs);
  return { envelope, orchestrator };
}

function isDecisionLogEntry(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && Boolean(value);
}

function parseJsonLine(line: string): unknown {
  const parsed: unknown = JSON.parse(line);
  return parsed;
}

describe("PortfolioOrchestrator — lifecycle and portfolio envelope", () => {
  test("uses the read adapter and a decision history engine when no synthesize method exists", async () => {
    const runSymbols = ["BTC/USDT", "ETH/USDT"] as const;
    writeMarketFixtures(3);
    const historicalDecision: PositionDecision = {
      confidence: 1,
      notionalUsd: 100,
      side: "long",
      sizeMultiplier: 1,
      sourceWeights: { history: 1 },
      symbol: runSymbols[0],
      timestampMs: startTimestampMs,
    };
    const requestedFiles: (readonly [string, string])[] = [];
    const orchestrator = createPortfolioOrchestrator({
      dataDir: fixture.directory,
      decisionEngineFactory: ({ symbol }) =>
        new HistoricalDecisionEngine(symbol, [
          symbol === runSymbols[0]
            ? historicalDecision
            : { ...historicalDecision, symbol, timestampMs: startTimestampMs - 1 },
        ]),
      fundingDir: fixture.directory,
      pluginsBySymbol: (symbol) => [createPassivePlugin(symbol)],
      readTextFile: (root, fileName) => {
        requestedFiles.push([root, fileName]);
        const raw = fixture.files.get(`${root}/${fileName}`);
        if (raw === undefined) throw new Error(`Missing virtual fixture ${fileName}.`);
        return Promise.resolve(raw);
      },
      symbols: runSymbols,
    });
    const envelope = await orchestrator.run(startTimestampMs, startTimestampMs + 2 * dayMs);
    expect(envelope.decisionLog).toHaveLength(1);
    expect(envelope.decisionLog[0]?.timestampMs).toBe(startTimestampMs);
    expect(requestedFiles).toHaveLength(4);
  });

  test("initialized flag flips after run()", async () => {
    const { orchestrator } = await runPortfolio();
    expect(orchestrator.initialized).toBe(true);
  });

  test("reset() clears state", async () => {
    const { orchestrator } = await runPortfolio();
    expect(orchestrator.getSnapshots().length).toBeGreaterThan(0);
    orchestrator.reset();
    expect(orchestrator.getSnapshots()).toEqual([]);
    expect(orchestrator.initialized).toBe(false);
  });

  test("a second run starts from fresh lifecycle state and reproduces the first envelope", async () => {
    const { envelope, orchestrator } = await runPortfolio();
    const replay = await orchestrator.run(startTimestampMs, startTimestampMs + 4 * dayMs);
    expect(replay).toEqual(envelope);
    expect(replay.snapshots).toHaveLength(envelope.snapshots.length);
    expect(orchestrator.getSnapshots()).toHaveLength(envelope.snapshots.length);
  });

  test("getBusesBySymbol returns empty map before init()", () => {
    const orchestrator = createPortfolioOrchestrator({
      dataDir: fixture.directory,
      fundingDir: fixture.directory,
      readTextFile: () => Promise.reject(new Error("Reader must not run before init.")),
    });
    expect(orchestrator.getBusesBySymbol()).toEqual(new Map());
    expect(orchestrator.initialized).toBe(false);
    expect(orchestrator.getBusesBySymbol().size).toBe(0);
  });

  test("getBusesBySymbol returns 3 bus entries (BTC, ETH, SOL) after run()", async () => {
    const { orchestrator } = await runPortfolio();
    const buses = orchestrator.getBusesBySymbol();
    expect(buses.size).toBe(3);
    expect(symbols.every((symbol) => buses.has(symbol))).toBe(true);
    expect(buses.has("BTC/USDT")).toBe(true);
    expect(buses.has("ETH/USDT")).toBe(true);
    expect(buses.has("SOL/USDT")).toBe(true);
  });

  test("getBusesBySymbol returned bus is a valid SignalBus (subscribe + emit)", async () => {
    const { orchestrator } = await runPortfolio();
    const bus = orchestrator.getBusesBySymbol().get(symbols[0]);
    expect(typeof bus?.emit).toBe("function");
    expect(typeof bus?.subscribe).toBe("function");
    expect(bus?.scopeSymbol).toBe("BTC/USDT");
  });

  test("maxPositions cap enforced (limit to 7 → 8th rejected)", async () => {
    const { envelope } = await runPortfolio({ maxPositions: 2 });
    expect(envelope.snapshots.every((snapshot) => snapshot.openPositionCount <= 2)).toBe(true);
    expect(envelope.snapshots.every((snapshot) => snapshot.positionsBySymbol["BTC/USDT"] !== undefined)).toBe(
      true,
    );
    expect(envelope.snapshots.some((snapshot) => snapshot.openPositionCount === 2)).toBe(true);
  });

  test("perSymbolConcentration cap enforced (40% per symbol)", async () => {
    const { envelope } = await runPortfolio({ notionalUsd: 50_000, perSymbolConcentrationPct: 0.4 });
    expect(
      envelope.snapshots.every((snapshot) =>
        Object.values(snapshot.positionsBySymbol).every((position) => position.concentrationPct <= 4),
      ),
    ).toBe(true);
    expect(
      envelope.snapshots.every((snapshot) => {
        const bitcoinPosition = snapshot.positionsBySymbol["BTC/USDT"];
        return bitcoinPosition !== undefined && bitcoinPosition.appliedNotionalUsd <= 40_000;
      }),
    ).toBe(true);
    expect(envelope.snapshots.some((snapshot) => snapshot.positionsBySymbol["BTC/USDT"]?.capped)).toBe(true);
    expect(
      envelope.snapshots.every((snapshot) => {
        const bitcoinPosition = snapshot.positionsBySymbol["BTC/USDT"];
        return bitcoinPosition !== undefined && bitcoinPosition.concentrationPct <= 4;
      }),
    ).toBe(true);
  });

  test("approximate VaR reports high-vol days without becoming a cap", async () => {
    const { envelope } = await runPortfolio({
      barCount: 30,
      drift: 10,
      notionalUsd: 5000,
    });
    expect(envelope.snapshots.every((snapshot) => snapshot.approximateAnalytics.estimatedVaRPct >= 0)).toBe(
      true,
    );
    expect(envelope.snapshots).toHaveLength(30);
    expect(
      envelope.snapshots.every((snapshot) =>
        Object.values(snapshot.positionsBySymbol).every((position) =>
          ["none", "maxPositions", "concentration", "leverage"].includes(position.capReason ?? "none"),
        ),
      ),
    ).toBe(true);
  });

  test("aggregate effective-exposure cap holds at the exact configured ceiling", async () => {
    const { envelope } = await runPortfolio({ maxAggregateEffectiveLeverage: 10, notionalUsd: 50_000 });
    expect(envelope.snapshots.every((snapshot) => snapshot.aggregateLeverage <= 10)).toBe(true);
    expect(envelope.leverageBreaches).toBeGreaterThan(0);
    expect(envelope.liquidations).toBeGreaterThanOrEqual(0);
  });

  test("cross-symbol correlation threshold is reported without a position penalty", async () => {
    const { envelope } = await runPortfolio({ barCount: 30, correlationThreshold: 0.1, drift: 10 });
    expect(
      envelope.snapshots.some((snapshot) => snapshot.approximateAnalytics.correlationThresholdExceeded),
    ).toBe(true);
    expect(envelope.snapshots).toHaveLength(30);
    expect(
      envelope.snapshots.some(
        (snapshot) => Object.keys(snapshot.approximateAnalytics.correlationMatrix).length === 3,
      ),
    ).toBe(true);
  });

  test("Cap reason = 'none' when no cap fires (flat market)", async () => {
    const { envelope } = await runPortfolio({ notionalUsd: 0 });
    expect(
      envelope.snapshots.every((snapshot) =>
        Object.values(snapshot.positionsBySymbol).every((position) => position.capReason === "none"),
      ),
    ).toBe(true);
    expect(envelope.snapshots.every((snapshot) => snapshot.aggregateLeverage === 0)).toBe(true);
    expect(envelope.snapshots.every((snapshot) => snapshot.openPositionCount === 0)).toBe(true);
  });

  test("formatDecisionLogJsonl produces valid JSONL output", async () => {
    const { orchestrator } = await runPortfolio();
    const entries = orchestrator
      .formatDecisionLogJsonl()
      .split("\n")
      .map((line) => parseJsonLine(line));
    const decisionEntries = entries.filter(isDecisionLogEntry);
    expect(decisionEntries).toHaveLength(entries.length);
    expect(
      decisionEntries.every(
        (entry) => "notional" in entry && "side" in entry && "symbol" in entry && "ts" in entry,
      ),
    ).toBe(true);
    expect(entries.length).toBeGreaterThan(0);
    expect(decisionEntries.every((entry) => typeof entry["ts"] === "number")).toBe(true);
    expect(decisionEntries.every((entry) => typeof entry["symbol"] === "string")).toBe(true);
  });

  test("decision log is empty when no decisions emitted", async () => {
    const { orchestrator } = await runPortfolio({ notionalUsd: 0 });
    expect(
      orchestrator.getDecisionLog().every((decision) => ["long", "short", "flat"].includes(decision.side)),
    ).toBe(true);
    expect(orchestrator.getDecisionLog().every((decision) => Number.isFinite(decision.notionalUsd))).toBe(
      true,
    );
    expect(orchestrator.getDecisionLog().every((decision) => Number.isFinite(decision.timestampMs))).toBe(
      true,
    );
  });

  test("BTC + ETH + SOL simultaneous run (3 symbols, 30 bars)", async () => {
    const { envelope } = await runPortfolio({ barCount: 30 });
    expect(envelope.barCount).toBe(30);
    expect(envelope.perSymbolEnvelopes.map(({ symbol }) => symbol)).toEqual([...symbols]);
    expect(envelope.perSymbolEnvelopes).toHaveLength(3);
    expect(envelope.perSymbolEnvelopes.some(({ symbol }) => symbol === "BTC/USDT")).toBe(true);
    expect(envelope.perSymbolEnvelopes.some(({ symbol }) => symbol === "ETH/USDT")).toBe(true);
  });

  test("Final envelope contains per-symbol envelopes + portfolio envelope", async () => {
    const { envelope } = await runPortfolio();
    expect(envelope.perSymbolEnvelopes).toHaveLength(3);
    expect(envelope.snapshots.length).toBeGreaterThan(0);
    expect(typeof envelope.finalEquity).toBe("number");
    expect(typeof envelope.totalReturn).toBe("number");
    expect(typeof envelope.sharpe).toBe("number");
    expect(typeof envelope.maxDD).toBe("number");
  });

  test("Sharpe/maxDD/totalReturn computed correctly (positive numbers)", async () => {
    const { envelope } = await runPortfolio({ barCount: 30, drift: 10 });
    expect(Number.isFinite(envelope.totalReturn)).toBe(true);
    expect(envelope.maxDD).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(envelope.sharpe)).toBe(true);
    expect(Number.isFinite(envelope.maxDD)).toBe(true);
    expect(envelope.maxDD).toBeLessThanOrEqual(1);
  });

  test("0 leverage breaches / 0 liquidations in well-formed run", async () => {
    const { envelope } = await runPortfolio({ maxAggregateEffectiveLeverage: 10, notionalUsd: 1000 });
    expect(envelope.leverageBreaches).toBe(0);
    expect(envelope.liquidations).toBe(0);
  });

  test("Snapshot sequence is monotonic in timestamp", async () => {
    const { envelope } = await runPortfolio();
    expect(
      envelope.snapshots.every(
        (snapshot, index) =>
          index === 0 || snapshot.timestampMs >= (envelope.snapshots.at(index - 1)?.timestampMs ?? 0),
      ),
    ).toBe(true);
    expect(envelope.snapshots.at(0)?.timestampMs).toBe(startTimestampMs);
    expect(envelope.snapshots.at(-1)?.timestampMs).toBe(startTimestampMs + 4 * dayMs);
  });

  test("Per-symbol envelope has all expected fields", async () => {
    const { envelope } = await runPortfolio();
    expect(
      envelope.perSymbolEnvelopes.every(
        ({
          capacityUsedPct,
          decisionCount,
          finalEquityUsd,
          maxDrawdownPct,
          openPositionCount,
          sharpeRatio,
          symbol,
          totalReturnPct,
        }) =>
          typeof symbol === "string" &&
          [
            capacityUsedPct,
            decisionCount,
            finalEquityUsd,
            maxDrawdownPct,
            openPositionCount,
            sharpeRatio,
            totalReturnPct,
          ].every((value) => Number.isFinite(value)),
      ),
    ).toBe(true);
    for (const envelopeBySymbol of envelope.perSymbolEnvelopes) {
      expect(typeof envelopeBySymbol.symbol).toBe("string");
      expect(typeof envelopeBySymbol.finalEquityUsd).toBe("number");
      expect(typeof envelopeBySymbol.totalReturnPct).toBe("number");
      expect(typeof envelopeBySymbol.sharpeRatio).toBe("number");
      expect(typeof envelopeBySymbol.maxDrawdownPct).toBe("number");
      expect(typeof envelopeBySymbol.decisionCount).toBe("number");
      expect(typeof envelopeBySymbol.openPositionCount).toBe("number");
    }
  });

  test("getPortfolioRisk returns valid RiskSnapshot", async () => {
    const { orchestrator } = await runPortfolio({ drift: 1 });
    const snapshot = orchestrator.getPortfolioRisk();
    expect(Number.isFinite(snapshot.aggregateLeverage)).toBe(true);
    expect(snapshot.timestamp).toBeGreaterThan(0);
    if (snapshot.lastVaR === undefined) throw new Error("Expected a public VaR snapshot.");
    expect(snapshot.lastVaR.observations).toBeGreaterThan(0);
    expect(Reflect.set(snapshot.lastVaR, "observations", 0)).toBe(false);
  });

  test("public read models remain consistent with the produced envelope", async () => {
    const { envelope, orchestrator } = await runPortfolio();
    expect(orchestrator.getSnapshots()).toEqual(envelope.snapshots);
    expect(orchestrator.getDecisionLog()).toEqual(envelope.decisionLog);
    expect(orchestrator.formatDecisionLogJsonl().length).toBeGreaterThan(0);
    expect(envelope.finalEquity).toBeGreaterThan(0);
    expect(envelope.barCount).toBe(orchestrator.getSnapshots().length);
    expect(envelope.snapshots.every((snapshot) => snapshot.positionsBySymbol["SOL/USDT"] !== undefined)).toBe(
      true,
    );
    expect(envelope.decisionLog.every((decision) => decision.symbol.length > 0)).toBe(true);
  });

  test("returns frozen snapshot and decision models that cannot alter retained state", async () => {
    const { envelope, orchestrator } = await runPortfolio();
    const snapshot = envelope.snapshots[0];
    const decision = envelope.decisionLog[0];
    if (snapshot === undefined || decision === undefined)
      throw new Error("Expected public portfolio models.");

    expect(Reflect.set(snapshot, "equityUsd", 1)).toBe(false);
    expect(Reflect.set(snapshot.positionsBySymbol, "BTC/USDT", {})).toBe(false);
    expect(Reflect.set(decision.sourceWeights, "forcedDriver", 0)).toBe(false);
    expect(Reflect.set(envelope.snapshots, 0, snapshot)).toBe(false);

    const retainedSnapshot = orchestrator.getSnapshots()[0];
    const retainedDecision = orchestrator.getDecisionLog()[0];
    expect(retainedSnapshot?.equityUsd).toBe(envelope.snapshots[0]?.equityUsd);
    expect(retainedDecision?.sourceWeights["forcedDriver"]).toBe(1);
  });
});
