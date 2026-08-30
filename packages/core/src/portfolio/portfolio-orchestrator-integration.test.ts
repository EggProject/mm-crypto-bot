import { beforeEach, describe, expect, test } from "bun:test";

import {
  integrationLifecycleEngine as createLifecycleEngine,
  integrationPassivePlugin as createPassivePlugin,
} from "./portfolio-orchestrator.test-support.js";
import { PortfolioRiskEngine } from "../risk/portfolio-risk-engine.js";
import {
  createPortfolioOrchestrator,
  DecisionEngine,
  PortfolioOrchestrator,
} from "./portfolio-orchestrator.js";
import { copyImmutableRiskSnapshot, marketDataFileStem } from "./portfolio-orchestrator-market-data.js";

const fixture = { directory: "/portfolio-orchestrator-integration", files: new Map<string, string>() };
const fixtureConfig = {
  dataDir: fixture.directory,
  fundingDir: fixture.directory,
  readTextFile: readFixture,
};

beforeEach(() => {
  fixture.files.clear();
});

function writeMarketFixtures(symbol: string, startTimestampMs: number): void {
  const base = symbol.split("/", 1)[0]?.toLowerCase();
  if (base === undefined) {
    throw new Error(`Missing base asset for ${symbol}.`);
  }
  const ohlcvRows = ["timestamp,open,high,low,close,volume"];
  const fundingRows = ["fundingTime,symbol,fundingRate,markPrice"];
  for (let day = 0; day < 3; day += 1) {
    const timestampMs = startTimestampMs + day * 86_400_000;
    const close = 100 + day;
    ohlcvRows.push([timestampMs, close - 1, close + 1, close - 2, close, 1000].map(String).join(","));
    fundingRows.push([timestampMs, `${base.toUpperCase()}USDT`, "0.0001", ""].map(String).join(","));
  }
  fixture.files.set(`${fixture.directory}/binance_${base}_1d.csv`, ohlcvRows.join("\n"));
  fixture.files.set(`${fixture.directory}/binance_${base}usdt_funding_8h.csv`, fundingRows.join("\n"));
}

function readFixture(root: string, fileName: string): Promise<string> {
  const raw = fixture.files.get(`${root}/${fileName}`);
  if (raw === undefined) return Promise.reject(new Error(`Missing virtual fixture ${fileName}.`));
  return Promise.resolve(raw);
}

function addEmptyDatasets(symbols: readonly string[]): void {
  for (const symbol of symbols) {
    const base = marketDataFileStem(symbol);
    fixture.files.set(`${fixture.directory}/binance_${base}_1d.csv`, "timestamp,open,high,low,close,volume");
    fixture.files.set(
      `${fixture.directory}/binance_${base}usdt_funding_8h.csv`,
      "fundingTime,symbol,fundingRate,markPrice",
    );
  }
}

describe("PortfolioOrchestrator public integration", () => {
  test("replays deterministic portfolio envelopes with symbol and snapshot ordering intact", async () => {
    const startTimestampMs = 1_700_000_000_000;
    const symbols = ["BTC/USDT", "ETH/USDT", "SOL/USDT"] as const;
    for (const symbol of symbols) writeMarketFixtures(symbol, startTimestampMs);

    const orchestrator = createPortfolioOrchestrator({
      dataDir: fixture.directory,
      fundingDir: fixture.directory,
      symbols,
      pluginsBySymbol: (symbol) => [createPassivePlugin(symbol)],
      readTextFile: readFixture,
    });

    const first = await orchestrator.run(startTimestampMs, startTimestampMs + 2 * 86_400_000);
    const replay = await orchestrator.run(startTimestampMs, startTimestampMs + 2 * 86_400_000);

    expect(first).toEqual(replay);
    expect(first.perSymbolEnvelopes.map(({ symbol }) => symbol)).toEqual([...symbols]);
    expect(first.snapshots.map(({ timestampMs }) => timestampMs)).toEqual([
      startTimestampMs,
      startTimestampMs + 86_400_000,
      startTimestampMs + 2 * 86_400_000,
    ]);
    expect(first.barCount).toBe(3);
  });

  test("fails closed for missing plugins, zero plugins, no bars, and no common timestamps", async () => {
    const symbols = ["BTC/USDT", "ETH/USDT"] as const;
    const withoutPlugins = createPortfolioOrchestrator({
      dataDir: fixture.directory,
      fundingDir: fixture.directory,
      readTextFile: readFixture,
      symbols,
    });
    expect(() => {
      withoutPlugins.init();
    }).toThrow(/No pluginsBySymbol/);
    const withEmptyPlugins = createPortfolioOrchestrator({
      dataDir: fixture.directory,
      fundingDir: fixture.directory,
      pluginsBySymbol: () => [],
      readTextFile: readFixture,
      symbols,
    });
    expect(() => {
      withEmptyPlugins.init();
    }).toThrow(/returned 0 plugins/);

    addEmptyDatasets(symbols);
    const noBars = createPortfolioOrchestrator({
      dataDir: fixture.directory,
      fundingDir: fixture.directory,
      pluginsBySymbol: (symbol) => [createPassivePlugin(symbol)],
      readTextFile: readFixture,
      symbols,
    });
    try {
      await noBars.run(1, 2);
      throw new Error("Expected no-bars run to reject.");
    } catch (error: unknown) {
      if (error instanceof Error && error.message === "Expected no-bars run to reject.") throw error;
      if (!(error instanceof Error)) throw new Error("Expected Error rejection.", { cause: error });
      expect(error.message).toMatch(/No OHLCV bars/);
    }

    writeMarketFixtures(symbols[0], 1);
    writeMarketFixtures(symbols[1], 3);
    const noCommonTimestamp = createPortfolioOrchestrator({
      dataDir: fixture.directory,
      fundingDir: fixture.directory,
      pluginsBySymbol: (symbol) => [createPassivePlugin(symbol)],
      readTextFile: readFixture,
      symbols,
    });
    try {
      await noCommonTimestamp.run(1, 172_800_003);
      throw new Error("Expected no-common-timestamp run to reject.");
    } catch (error: unknown) {
      if (error instanceof Error && error.message === "Expected no-common-timestamp run to reject.")
        throw error;
      if (!(error instanceof Error)) throw new Error("Expected Error rejection.", { cause: error });
      expect(error.message).toMatch(/No common bar timestamps/);
    }
  });

  test("retains only the configured correlation return window during a long public replay", async () => {
    const startTimestampMs = 1_700_000_000_000;
    const symbols = ["BTC/USDT", "ETH/USDT"] as const;
    for (const symbol of symbols) writeMarketFixtures(symbol, startTimestampMs);
    const orchestrator = createPortfolioOrchestrator({
      approximateCorrelationWindowDays: 2,
      dataDir: fixture.directory,
      fundingDir: fixture.directory,
      pluginsBySymbol: (symbol) => [createPassivePlugin(symbol)],
      readTextFile: readFixture,
      symbols,
    });
    const envelope = await orchestrator.run(startTimestampMs, startTimestampMs + 2 * 86_400_000);
    expect(envelope.barCount).toBe(3);
  });

  test("does not emit funding callbacks when a valid funding dataset has only its header", async () => {
    const startTimestampMs = 1_700_000_000_000;
    const symbol = "BTC/USDT";
    writeMarketFixtures(symbol, startTimestampMs);
    fixture.files.set(
      `${fixture.directory}/binance_btcusdt_funding_8h.csv`,
      "fundingTime,symbol,fundingRate,markPrice",
    );
    const fundingEvents: number[] = [];
    const orchestrator = createPortfolioOrchestrator({
      crossSymbolRecordFundingRate: (_symbol, _rate, timestampMs) => {
        fundingEvents.push(timestampMs);
      },
      dataDir: fixture.directory,
      fundingDir: fixture.directory,
      pluginsBySymbol: (candidate) => [createPassivePlugin(candidate)],
      readTextFile: readFixture,
      symbols: [symbol],
    });
    const envelope = await orchestrator.run(startTimestampMs, startTimestampMs + 2 * 86_400_000);
    expect(envelope.barCount).toBe(3);
    expect(fundingEvents).toEqual([]);
  });

  test("preserves a genuine null decision from a public synthesizing engine", async () => {
    const startTimestampMs = 1_700_000_000_000;
    const symbol = "BTC/USDT";
    writeMarketFixtures(symbol, startTimestampMs);
    fixture.files.set(
      `${fixture.directory}/binance_btcusdt_funding_8h.csv`,
      "fundingTime,symbol,fundingRate,markPrice",
    );
    const orchestrator = createPortfolioOrchestrator({
      dataDir: fixture.directory,
      decisionEngineFactory: (config) => new DecisionEngine(config),
      fundingDir: fixture.directory,
      pluginsBySymbol: (candidate) => [createPassivePlugin(candidate)],
      readTextFile: readFixture,
      symbols: [symbol],
    });
    const envelope = await orchestrator.run(startTimestampMs, startTimestampMs + 2 * 86_400_000);
    expect(envelope.decisionLog).toEqual([]);
    expect(envelope.snapshots.every((snapshot) => snapshot.openPositionCount === 0)).toBe(true);
  });

  test("rolls back each initialized symbol after a second-symbol factory, plugin, or subscription failure", () => {
    for (const failedStep of ["factory", "plugin", "subscription"] as const) {
      const events: string[] = [];
      let isFail = true;
      const orchestrator = createPortfolioOrchestrator({
        dataDir: fixture.directory,
        decisionEngineFactory: ({ symbol }) => {
          if (isFail && failedStep === "factory" && symbol === "ETH/USDT")
            throw new Error("factory failure for ETH/USDT");
          return createLifecycleEngine(
            symbol,
            events,
            isFail && failedStep === "subscription" && symbol === "ETH/USDT",
          );
        },
        fundingDir: fixture.directory,
        pluginsBySymbol: (symbol) => {
          if (isFail && failedStep === "plugin" && symbol === "ETH/USDT")
            throw new Error("plugin failure for ETH/USDT");
          return [
            createPassivePlugin(symbol, () => {
              events.push(`plugin-reset:${symbol}`);
            }),
          ];
        },
        readTextFile: readFixture,
        symbols: ["BTC/USDT", "ETH/USDT"],
      });

      expect(() => {
        orchestrator.init();
      }).toThrow(`${failedStep} failure`);
      expect(orchestrator.getBusesBySymbol()).toEqual(new Map());
      expect(orchestrator.initialized).toBe(false);
      expect(events).toContain("unsubscribe:BTC/USDT");
      expect(events).toContain("reset:BTC/USDT");

      isFail = false;
      orchestrator.init();
      expect(orchestrator.getBusesBySymbol().size).toBe(2);
      expect(events.filter((event) => event === "subscribe:BTC/USDT")).toHaveLength(2);
      expect(events.filter((event) => event === "subscribe:ETH/USDT")).toHaveLength(
        failedStep === "subscription" ? 2 : 1,
      );
    }
  });

  test("fails closed when an injected reader returns non-text data", async () => {
    const constructorConfig = {
      dataDir: fixture.directory,
      fundingDir: fixture.directory,
      pluginsBySymbol: (symbol: string) => [createPassivePlugin(symbol)],
      readTextFile: () => Promise.resolve(7),
      symbols: ["BTC/USDT"],
    };
    const constructed: unknown = Reflect.construct(PortfolioOrchestrator, [constructorConfig]);
    if (!(constructed instanceof PortfolioOrchestrator)) throw new Error("Expected portfolio orchestrator.");
    const orchestrator = constructed;
    try {
      await orchestrator.run(1, 1);
      throw new Error("Expected hostile reader to reject.");
    } catch (error: unknown) {
      if (error instanceof Error && error.message === "Expected hostile reader to reject.") throw error;
      if (!(error instanceof Error)) throw new Error("Expected an Error rejection.", { cause: error });
      expect(error.message).toMatch(/Failed to read binance_btc_1d.csv/);
      expect(error.cause).toBeInstanceOf(Error);
    }
  });

  test("constructs with the aggregate effective-exposure limit of 10", () => {
    const orchestrator = new PortfolioOrchestrator({
      ...fixtureConfig,
      maxAggregateEffectiveLeverage: 10,
      maxPositions: 7,
    });
    expect(orchestrator.config.maxPositions).toBe(7);
    expect(orchestrator.config.maxAggregateEffectiveLeverage).toBe(10);
  });

  test("copies populated risk snapshots without retaining mutable position or breach aliases", () => {
    const engine = new PortfolioRiskEngine();
    engine.submitSignal({
      effectiveNotionalUsd: 11_000,
      kind: "sizing",
      leverage: 10,
      source: "coverage",
      symbol: "BTC/USDT",
      timestamp: 1,
    });
    engine.leverageInvariantGuard(1000);
    const copied = copyImmutableRiskSnapshot(engine.snapshot(1000));
    expect(copied.positions).toHaveLength(1);
    expect(copied.leverageInvariantFires).toHaveLength(1);
  });

  test("rejects missing dataDir", () => {
    expect(() => new PortfolioOrchestrator({ fundingDir: fixtureConfig.fundingDir })).toThrow(
      /dataDir is required/,
    );
  });

  test("rejects missing fundingDir", () => {
    expect(() => new PortfolioOrchestrator({ dataDir: fixtureConfig.dataDir })).toThrow(
      /fundingDir is required/,
    );
  });

  test("rejects an aggregate effective-exposure limit above 10", () => {
    expect(() => new PortfolioOrchestrator({ ...fixtureConfig, maxAggregateEffectiveLeverage: 11 })).toThrow(
      /aggregate effective-exposure limit breach/,
    );
  });

  test("rejects an aggregate effective-exposure limit below 1", () => {
    expect(() => new PortfolioOrchestrator({ ...fixtureConfig, maxAggregateEffectiveLeverage: 0 })).toThrow(
      /aggregate effective-exposure limit breach/,
    );
  });

  test("rejects a corrupt OHLCV or funding dataset without silently dropping its row", async () => {
    const startTimestampMs = 1_700_000_000_000;
    const symbols = ["BTC/USDT", "ETH/USDT", "SOL/USDT"] as const;
    const validOhlcv = [
      "timestamp,open,high,low,close,volume",
      [startTimestampMs, 99, 101, 98, 100, 1000].map(String).join(","),
      [startTimestampMs + 86_400_000, 100, 102, 99, 101, 1000].map(String).join(","),
      [startTimestampMs + 172_800_000, 101, 103, 100, 102, 1000].map(String).join(","),
    ].join("\n");
    const validFunding = [
      "fundingTime,symbol,fundingRate,markPrice",
      [startTimestampMs, "BTCUSDT", "0.0001", 100].map(String).join(","),
    ].join("\n");
    const corruptDatasets = [
      { expected: /OHLCV CSV .* line 1/, funding: validFunding, ohlcv: `wrong,${validOhlcv}` },
      {
        expected: /OHLCV CSV .* line 2/,
        funding: validFunding,
        ohlcv: validOhlcv.replace(",99,101,98,100,1000", ",NaN,101,98,100,1000"),
      },
      {
        expected: /OHLCV CSV .* line 2/,
        funding: validFunding,
        ohlcv: validOhlcv.replace(",99,101,98,100,1000", ",Infinity,101,98,100,1000"),
      },
      {
        expected: /OHLCV CSV .* line 2/,
        funding: validFunding,
        ohlcv: validOhlcv.replace(",99,101,98,100,1000", ",99,101,98,100"),
      },
      {
        expected: /OHLCV CSV .* line 3/,
        funding: validFunding,
        ohlcv: validOhlcv.replaceAll(String(startTimestampMs + 86_400_000), () => String(startTimestampMs)),
      },
      {
        expected: /OHLCV CSV .* line 3/,
        funding: validFunding,
        ohlcv: validOhlcv.replaceAll(String(startTimestampMs + 86_400_000), () =>
          String(startTimestampMs - 1),
        ),
      },
      {
        expected: /OHLCV CSV .* line 2/,
        funding: validFunding,
        ohlcv: validOhlcv.replace(",99,101,98,100,1000", ",99,97,98,100,1000"),
      },
      {
        expected: /OHLCV CSV .* line 2/,
        funding: validFunding,
        ohlcv: validOhlcv.replace(",99,101,98,100,1000", ",99,101,98,100,-1"),
      },
      {
        expected: /funding CSV .* line 2/,
        funding: validFunding.replace("0.0001", "NaN"),
        ohlcv: validOhlcv,
      },
    ];

    for (const corrupt of corruptDatasets) {
      for (const symbol of symbols) writeMarketFixtures(symbol, startTimestampMs);
      fixture.files.set(`${fixture.directory}/binance_btc_1d.csv`, corrupt.ohlcv);
      fixture.files.set(`${fixture.directory}/binance_btcusdt_funding_8h.csv`, corrupt.funding);
      const orchestrator = createPortfolioOrchestrator({
        dataDir: fixture.directory,
        fundingDir: fixture.directory,
        pluginsBySymbol: (symbol) => [createPassivePlugin(symbol)],
        readTextFile: readFixture,
        symbols,
      });

      try {
        await orchestrator.run(startTimestampMs, startTimestampMs + 172_800_000);
        throw new Error("Expected invalid portfolio data to reject.");
      } catch (error: unknown) {
        if (error instanceof Error && error.message === "Expected invalid portfolio data to reject.")
          throw error;
        if (!(error instanceof Error)) throw new Error("Expected Error rejection.", { cause: error });
        expect(error.message).toMatch(corrupt.expected);
      }
    }
  });
});
