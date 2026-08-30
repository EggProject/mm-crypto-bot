import { describe, expect, test } from "bun:test";

import type { StrategyPlugin } from "../signal-center/strategy-registry.js";
import { ok, type Bar, type PluginState } from "../signal-center/types.js";
import { DEFAULT_PORTFOLIO_ORCHESTRATOR_CONFIG, PortfolioOrchestrator } from "./portfolio-orchestrator.js";
import {
  buildPortfolioMetrics,
  calculateAggregateBar,
  immutableRiskEngineConfig,
} from "./portfolio-orchestrator-analytics.js";
import {
  immutableDecisionEngineConfig,
  requirePortfolioInvariant,
} from "./portfolio-orchestrator-market-data.js";
import type { PositionDecision } from "./portfolio-orchestrator.js";
import {
  captureRejection,
  noDecision,
  noOperation,
  portfolioConfig as config,
  portfolioDecision as decision,
  portfolioFixtureDirectories as fixtureDirectories,
} from "./portfolio-orchestrator.test-support.js";

function passivePlugin(symbol: string): StrategyPlugin {
  return {
    metadata: {
      capitalRequirement: 1,
      edgeClass: "sizing",
      maxAggregateEffectiveLeverage: 10,
      name: symbol,
      version: "1",
    },
    onBar: (_bar: Bar, _state: PluginState): void => undefined,
    reset: (): void => undefined,
    subscribe: (): void => undefined,
    validateConfig: () => ok(undefined),
  };
}

function aggregate(
  decisionsBySymbol: ReadonlyMap<string, PositionDecision | undefined>,
  overrides: Partial<Parameters<typeof calculateAggregateBar>[0]> = {},
) {
  const decisionsForTimestamp: PositionDecision[] = [];
  const symbols: string[] = [];
  for (const [symbol, candidate] of decisionsBySymbol) {
    symbols.push(symbol);
    if (candidate !== undefined) decisionsForTimestamp.push(candidate);
  }
  return calculateAggregateBar({
    correlationThreshold: 0.8,
    decisionsBySymbol,
    decisionsForTimestamp,
    maxAggregateEffectiveLeverage: 10,
    maxPositions: 3,
    perSymbolConcentrationPct: 1,
    portfolioEquity: 100,
    returnsBySymbol: new Map(symbols.map((symbol) => [symbol, []])),
    symbols,
    timestampMs: 1,
    ...overrides,
  });
}

describe("PortfolioOrchestrator — construction + config validation", () => {
  test("constructs with default config (excluding dataDir/fundingDir)", () => {
    const orchestrator = new PortfolioOrchestrator(config());
    expect(orchestrator.config).toMatchObject(DEFAULT_PORTFOLIO_ORCHESTRATOR_CONFIG);
    expect(orchestrator.config.symbols).toEqual(["BTC/USDT", "ETH/USDT", "SOL/USDT"]);
    expect(orchestrator.config.initialEquityUsd).toBe(1000);
    expect(orchestrator.config.maxPositions).toBe(7);
    expect(orchestrator.config.perSymbolConcentrationPct).toBe(0.5);
    expect(orchestrator.config.maxAggregateEffectiveLeverage).toBe(10);
    expect(orchestrator.config.approximateCorrelationThreshold).toBe(0.85);
    expect(orchestrator.config.approximateCorrelationWindowDays).toBe(30);
  });

  test("DEFAULT_PORTFOLIO_ORCHESTRATOR_CONFIG has user-mandated values", () => {
    expect(DEFAULT_PORTFOLIO_ORCHESTRATOR_CONFIG).toMatchObject({
      approximateCorrelationThreshold: 0.85,
      approximateCorrelationWindowDays: 30,
      initialEquityUsd: 1000,
      maxAggregateEffectiveLeverage: 10,
      maxPositions: 7,
      perSymbolConcentrationPct: 0.5,
      symbols: ["BTC/USDT", "ETH/USDT", "SOL/USDT"],
    });
    expect(DEFAULT_PORTFOLIO_ORCHESTRATOR_CONFIG.maxPositions).toBe(7);
    expect(DEFAULT_PORTFOLIO_ORCHESTRATOR_CONFIG.maxAggregateEffectiveLeverage).toBe(10);
  });

  test("rejects blank data roots before lifecycle construction", () => {
    expect(() => new PortfolioOrchestrator(config({ dataDir: " " }))).toThrow(
      /dataDir must be a non-empty path/,
    );
    expect(() => new PortfolioOrchestrator(config({ fundingDir: " " }))).toThrow(
      /fundingDir must be a non-empty path/,
    );
  });

  test("requires an injected root and file-name text reader", () => {
    expect(
      () =>
        new PortfolioOrchestrator({
          dataDir: fixtureDirectories.data,
          fundingDir: fixtureDirectories.funding,
        }),
    ).toThrow(/readTextFile is required/);
  });

  test("reads valid virtual datasets through the injected root and file-name reader", async () => {
    const files = new Map<string, string>([
      [
        `${fixtureDirectories.data}/binance_btc_1d.csv`,
        "timestamp,open,high,low,close,volume\n10,9,11,8,10,100",
      ],
      [
        `${fixtureDirectories.funding}/binance_btcusdt_funding_8h.csv`,
        "fundingTime,symbol,fundingRate,markPrice",
      ],
    ]);
    const requests: (readonly [string, string])[] = [];
    const orchestrator = new PortfolioOrchestrator({
      dataDir: fixtureDirectories.data,
      fundingDir: fixtureDirectories.funding,
      pluginsBySymbol: (symbol) => [passivePlugin(symbol)],
      readTextFile: (root, fileName) => {
        requests.push([root, fileName]);
        const raw = files.get(`${root}/${fileName}`);
        if (raw === undefined) return Promise.reject(new Error(`Missing virtual fixture ${fileName}.`));
        return Promise.resolve(raw);
      },
      symbols: ["BTC/USDT"],
    });

    const envelope = await orchestrator.run(10, 10);
    expect(envelope).toMatchObject({ barCount: 1 });
    expect(requests).toEqual([
      [fixtureDirectories.data, "binance_btc_1d.csv"],
      [fixtureDirectories.funding, "binance_btcusdt_funding_8h.csv"],
    ]);
  });

  test("preserves both reader and lifecycle cleanup failures from a public run", async () => {
    const orchestrator = new PortfolioOrchestrator({
      dataDir: fixtureDirectories.data,
      decisionEngineFactory: () => ({
        decisions: () => [],
        latestDecision: noDecision,
        reset: () => {
          throw new Error("cleanup failure");
        },
        subscribe: () => noOperation,
      }),
      fundingDir: fixtureDirectories.funding,
      pluginsBySymbol: (symbol) => [passivePlugin(symbol)],
      readTextFile: () => Promise.reject(new Error("reader failure")),
      symbols: ["BTC/USDT"],
    });

    expect(await captureRejection(orchestrator.run(10, 10))).toBeInstanceOf(AggregateError);
  });

  test("raises the existing invariant error when a required internal value is absent", () => {
    expect(() => {
      requirePortfolioInvariant(undefined, "coverage value");
    }).toThrow(/coverage value/);
  });

  test("rejects invalid maxPositions", () => {
    expect(() => new PortfolioOrchestrator(config({ maxPositions: 0 }))).toThrow(
      /maxPositions must be a positive integer/,
    );
  });

  test("rejects invalid perSymbolConcentrationPct", () => {
    expect(() => new PortfolioOrchestrator(config({ perSymbolConcentrationPct: 1.5 }))).toThrow(
      /perSymbolConcentrationPct/,
    );
  });

  test("rejects an invalid approximate correlation reporting threshold", () => {
    expect(() => new PortfolioOrchestrator(config({ approximateCorrelationThreshold: 1.1 }))).toThrow(
      /approximateCorrelationThreshold/,
    );
  });

  test("rejects empty symbols array", () => {
    expect(() => new PortfolioOrchestrator(config({ symbols: [] }))).toThrow(
      /symbols must be a non-empty array/,
    );
  });

  test("rejects symbols that cannot name a canonical market dataset", () => {
    expect(() => new PortfolioOrchestrator(config({ symbols: ["BTC-USDT"] }))).toThrow(
      /symbols must contain canonical BASE\/QUOTE pairs/,
    );
  });

  test("rejects blank, whitespace-padded, duplicate, and non-string symbols before plugin setup", () => {
    const invalidSymbolLists = [
      [""],
      [" ".repeat(3)],
      [" BTC/USDT"],
      ["BTC/USDT "],
      ["BTC/USDT", "BTC/USDT"],
    ];
    let pluginFactoryCalls = 0;
    for (const symbols of invalidSymbolLists) {
      expect(
        () =>
          new PortfolioOrchestrator(
            config({
              pluginsBySymbol: () => {
                pluginFactoryCalls += 1;
                return [];
              },
              symbols,
            }),
          ),
      ).toThrow(/symbols/);
    }
    const nonStringConfig = {
      dataDir: fixtureDirectories.data,
      fundingDir: fixtureDirectories.funding,
      readTextFile: (_root: string, _fileName: string) => Promise.reject(new Error("Not reached.")),
      symbols: [7],
    };
    expect(() => {
      Reflect.construct(PortfolioOrchestrator, [nonStringConfig]);
    }).toThrow(/symbols/);
    expect(pluginFactoryCalls).toBe(0);
  });

  test("defensively copies and freezes the caller configuration graph", () => {
    const symbols = ["BTC/USDT"];
    const riskEngine = {
      concentrationThresholdPct: 0.5,
      confidence: 0.95,
      correlationWindowDays: 30,
      leverageInvariant: { maxAggregateEffectiveLeverage: 10, tolerance: 0.000001, warnOnApproach: 0.95 },
      maxAggregateDrawdownPct: 0.2,
    };
    const orchestrator = new PortfolioOrchestrator(config({ riskEngine, symbols }));

    symbols[0] = "ETH/USDT";
    riskEngine.leverageInvariant.maxAggregateEffectiveLeverage = 1;

    expect(orchestrator.config.symbols).toEqual(["BTC/USDT"]);
    expect(orchestrator.config.riskEngine?.leverageInvariant.maxAggregateEffectiveLeverage).toBe(10);
    expect(Reflect.set(orchestrator.config.symbols, 0, "SOL/USDT")).toBe(false);
    if (orchestrator.config.riskEngine === undefined) throw new Error("Expected stored risk configuration.");
    expect(
      Reflect.set(orchestrator.config.riskEngine.leverageInvariant, "maxAggregateEffectiveLeverage", 1),
    ).toBe(false);
  });

  test("validates every public portfolio configuration boundary", () => {
    const invalidConfigs = [
      { initialEquityUsd: NaN },
      { initialEquityUsd: 1000.0001 },
      { initialEquityUsd: 10_000 },
      { approximateCorrelationWindowDays: 0 },
      { approximateCorrelationThreshold: 1.1 },
      { approximateCorrelationThreshold: -1.1 },
      { perSymbolConcentrationPct: 0 },
      { maxPositions: 1.5 },
    ];
    for (const invalidConfig of invalidConfigs)
      expect(() => new PortfolioOrchestrator(config(invalidConfig))).toThrow(/PortfolioOrchestrator/);
  });

  test("copies optional nested decision and risk configuration without caller aliases", () => {
    const decisionEngine = { defaultWeight: 2 };
    const riskEngine = {
      concentrationThresholdPct: 0.5,
      confidence: 0.95,
      correlationWindowDays: 30,
      leverageInvariant: { maxAggregateEffectiveLeverage: 10, tolerance: 0.000001, warnOnApproach: 0.95 },
      maxAggregateDrawdownPct: 0.2,
    };
    const storedDecisionEngine = immutableDecisionEngineConfig(decisionEngine);
    const storedRiskEngine = immutableRiskEngineConfig(riskEngine);
    expect(immutableDecisionEngineConfig(undefined)).toBeUndefined();
    immutableRiskEngineConfig(undefined);
    if (storedDecisionEngine === undefined) throw new Error("Expected decision configuration.");
    decisionEngine.defaultWeight = 3;
    riskEngine.leverageInvariant.tolerance = 0.1;
    expect(storedDecisionEngine.defaultWeight).toBe(2);
    expect(storedRiskEngine.leverageInvariant.tolerance).toBe(0.000001);
    expect(Reflect.set(storedDecisionEngine, "defaultWeight", 3)).toBe(false);
    expect(Reflect.set(storedRiskEngine.leverageInvariant, "tolerance", 0.1)).toBe(false);
  });

  test("stores a valid optional decision engine configuration as an immutable copy", () => {
    const decisionEngine = { defaultWeight: 2 };
    const orchestrator = new PortfolioOrchestrator(config({ decisionEngine }));
    decisionEngine.defaultWeight = 3;
    expect(orchestrator.config.decisionEngine?.defaultWeight).toBe(2);
    expect(Reflect.set(orchestrator.config.decisionEngine ?? {}, "defaultWeight", 3)).toBe(false);
  });

  test("applies max position, concentration, and leverage limits while correlation and VaR only report", () => {
    const btc = decision("BTC/USDT", 100);
    const eth = decision("ETH/USDT", 100);
    const sol = decision("SOL/USDT", 100);
    const positions = new Map<string, PositionDecision | undefined>([
      [btc.symbol, btc],
      [eth.symbol, eth],
      [sol.symbol, sol],
    ]);
    const maxPositions = aggregate(positions, { maxPositions: 1 });
    expect(maxPositions.snapshot.openPositionCount).toBe(1);
    expect(maxPositions.snapshot.positionsBySymbol["SOL/USDT"]?.capReason).toBe("maxPositions");
    const reorderedMaxPositions = aggregate(
      new Map([
        [btc.symbol, btc],
        [eth.symbol, decision(eth.symbol, 200)],
        [sol.symbol, sol],
      ]),
      { maxPositions: 1 },
    );
    expect(reorderedMaxPositions.snapshot.positionsBySymbol[eth.symbol]?.side).toBe("long");

    const concentration = aggregate(new Map([[btc.symbol, decision(btc.symbol, 200)]]), {
      perSymbolConcentrationPct: 0.1,
    });
    expect(concentration.snapshot.positionsBySymbol[btc.symbol]?.capReason).toBe("concentration");

    const correlated = aggregate(
      new Map([
        [btc.symbol, btc],
        [eth.symbol, eth],
      ]),
      {
        correlationThreshold: 0.1,
        returnsBySymbol: new Map([
          [btc.symbol, [0, 0.1, 0.2]],
          [eth.symbol, [0, 0.1, 0.2]],
        ]),
      },
    );
    expect(correlated.snapshot.approximateAnalytics.correlationThresholdExceeded).toBe(true);
    expect(correlated.snapshot.positionsBySymbol[btc.symbol]?.capReason).toBeUndefined();

    const variableLimited = aggregate(new Map([[btc.symbol, btc]]), {
      returnsBySymbol: new Map([[btc.symbol, [0, 1, -1]]]),
    });
    expect(variableLimited.snapshot.approximateAnalytics.estimatedVaRPct).toBeGreaterThan(0);
    expect(variableLimited.snapshot.positionsBySymbol[btc.symbol]?.capReason).toBeUndefined();

    const leverageLimited = aggregate(
      new Map([
        [btc.symbol, btc],
        [eth.symbol, eth],
      ]),
      {
        maxAggregateEffectiveLeverage: 1,
      },
    );
    expect(leverageLimited.isLeverageBreached).toBe(true);
    expect(leverageLimited.snapshot.aggregateLeverage).toBe(1);
    expect(leverageLimited.snapshot.positionsBySymbol[btc.symbol]?.capReason).toBe("leverage");
  });

  test("builds analytics envelopes for populated per-symbol histories", () => {
    const snapshot = aggregate(new Map([["BTC/USDT", decision("BTC/USDT", 0)]])).snapshot;
    const populated = buildPortfolioMetrics({
      decisionCountBySymbol: new Map([["BTC/USDT", 1]]),
      decisionLog: [decision("BTC/USDT", 100)],
      equityCurves: new Map([["BTC/USDT", [1000, 900, 1100]]]),
      initialEquityUsd: 1000,
      leverageBreaches: 1,
      liquidations: 1,
      maxPositions: 2,
      openCountBySymbol: new Map([["BTC/USDT", 1]]),
      returnsBySymbol: new Map([["BTC/USDT", [0.1, -0.1]]]),
      snapshots: [
        { ...snapshot, equityUsd: 1000 },
        { ...snapshot, equityUsd: 900 },
        { ...snapshot, equityUsd: 1100 },
      ],
      symbols: ["BTC/USDT"],
    });
    expect(populated.totalReturn).toBe(0.1);
    expect(populated.maxDD).toBeGreaterThan(0);
    expect(populated.sharpe).not.toBe(0);
  });

  test("scales two capped open positions without changing an undefined flat symbol", () => {
    const result = aggregate(
      new Map([
        ["BTC/USDT", decision("BTC/USDT", 200)],
        ["ETH/USDT", decision("ETH/USDT", 200)],
        ["SOL/USDT", undefined],
      ]),
      { maxAggregateEffectiveLeverage: 1 },
    );
    expect(result.isLeverageBreached).toBe(true);
    expect(result.snapshot.positionsBySymbol["SOL/USDT"]).toMatchObject({
      appliedNotionalUsd: 0,
      capReason: "none",
      side: "flat",
    });
    expect(result.snapshot.aggregateLeverage).toBe(1);
  });
});
