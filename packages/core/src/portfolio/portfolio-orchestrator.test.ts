import { describe, expect, test } from "bun:test";

import { createSignalBus } from "../signal-center/signal-bus.js";
import {
  ok,
  type Bar,
  type CarrySignal,
  type DirectionSignal,
  type PluginState,
  type RiskSignal,
  type SizingSignal,
} from "../signal-center/types.js";
import type { StrategyPlugin } from "../signal-center/strategy-registry.js";
import {
  DEFAULT_DECISION_ENGINE_CONFIG,
  DEFENSIVE_PLUGIN_NAMES,
  DecisionEngine,
  createPortfolioOrchestrator,
  type DecisionEngineLike,
} from "./portfolio-orchestrator.js";
import { previousBarBefore } from "./portfolio-orchestrator-market-data.js";
import {
  captureRejection,
  createReenteringDecisionEngine,
  noDecision,
  noOperation,
} from "./portfolio-orchestrator.test-support.js";

const symbol = "BTC/USDT";
function createEngine(): DecisionEngine {
  return new DecisionEngine({ ...DEFAULT_DECISION_ENGINE_CONFIG, symbol });
}
function attach(engine: DecisionEngine): ReturnType<DecisionEngine["subscribe"]> {
  return engine.subscribe(createSignalBus({ scopeSymbol: symbol }));
}
function emitDirectionalInputs(engine: DecisionEngine, timestampMs: number): void {
  const bus = createSignalBus({ scopeSymbol: symbol });
  engine.subscribe(bus);
  bus.emit({
    kind: "direction",
    side: "long",
    source: "test-plugin",
    strength: 0.9,
    timestampMs,
  } satisfies DirectionSignal);
  bus.emit({
    kind: "sizing",
    kellyFraction: 0.5,
    notional: 5000,
    source: "test-plugin",
    timestampMs,
    volMultiplier: 1,
  } satisfies SizingSignal);
}
function createPassivePlugin(symbol: string): StrategyPlugin {
  return {
    metadata: {
      capitalRequirement: 1,
      edgeClass: "sizing",
      maxAggregateEffectiveLeverage: 10,
      name: `coverage-${symbol.toLowerCase().replace("/", "-")}`,
      version: "1.0.0",
    },
    onBar: (_bar: Bar, _state: PluginState): void => undefined,
    reset: (): void => undefined,
    subscribe: (): void => undefined,
    validateConfig: () => ok(undefined),
  };
}
function createCsvOrchestrator(ohlcv: string, funding: string) {
  return createPortfolioOrchestrator({
    dataDir: "/portfolio-orchestrator-coverage",
    fundingDir: "/portfolio-orchestrator-coverage",
    pluginsBySymbol: (candidate) => [createPassivePlugin(candidate)],
    readTextFile: (_root, fileName) => Promise.resolve(fileName.endsWith("_1d.csv") ? ohlcv : funding),
    symbols: [symbol],
  });
}
const validOhlcv = "timestamp,open,high,low,close,volume\n10,9,11,8,10,100";
const validFunding = "fundingTime,symbol,fundingRate,markPrice";
function createNonErrorFailure(message: string): Error & { readonly toString: () => string } {
  return { message, name: "NonErrorFailure", toString: () => message };
}
describe("PortfolioOrchestrator — DecisionEngine contract", () => {
  test("DecisionEngine constructs with valid symbol", () => {
    const engine = createEngine();
    expect(engine.symbol).toBe(symbol);
    expect(engine.decisions()).toEqual([]);
  });
  test("DecisionEngine rejects empty symbol", () => {
    expect(() => new DecisionEngine({ ...DEFAULT_DECISION_ENGINE_CONFIG, symbol: "" })).toThrow(
      /symbol must be a non-empty string/,
    );
  });
  test("DecisionEngine rejects invalid config (defaultWeight ≤ 0)", () => {
    expect(() => new DecisionEngine({ ...DEFAULT_DECISION_ENGINE_CONFIG, defaultWeight: 0, symbol })).toThrow(
      /defaultWeight must be positive finite/,
    );
  });
  test("DecisionEngine rejects invalid minConsensusStrength", () => {
    expect(
      () => new DecisionEngine({ ...DEFAULT_DECISION_ENGINE_CONFIG, minConsensusStrength: 1.5, symbol }),
    ).toThrow(/minConsensusStrength must be in \[0, 1\]/);
  });
  test("DEFENSIVE_PLUGIN_NAMES contains expected plugins", () => {
    expect(DEFENSIVE_PLUGIN_NAMES.includes("regime-detector-meta")).toBe(true);
    expect(DEFENSIVE_PLUGIN_NAMES.includes("perpdex-liquidation-signals")).toBe(true);
    expect(DEFENSIVE_PLUGIN_NAMES.includes("sol-flip-kill-switch")).toBe(true);
  });
  test("DECISION_ENGINE_CONFIG defaults match user spec", () => {
    expect(DEFAULT_DECISION_ENGINE_CONFIG).toEqual({
      defaultWeight: 1,
      defensiveWeight: 2,
      maxNotionalPerSymbolUsd: 10_000,
      minConsensusStrength: 0.3,
    });
    expect(DEFAULT_DECISION_ENGINE_CONFIG.defaultWeight).toBe(1);
    expect(DEFAULT_DECISION_ENGINE_CONFIG.defensiveWeight).toBe(2);
    expect(DEFAULT_DECISION_ENGINE_CONFIG.minConsensusStrength).toBe(0.3);
  });
  test("DecisionEngine synthesize returns undefined with no signals", () => {
    expect(createEngine().synthesize(symbol, 1000)).toBeUndefined();
  });
  test("DecisionEngine subscribe + reset lifecycle", () => {
    const engine = createEngine();
    const unsubscribe = attach(engine);
    unsubscribe();
    unsubscribe();
    engine.reset();
    expect(engine.decisions()).toEqual([]);
    expect(engine.latestDecision(symbol)).toBeFalsy();
    expect(engine.synthesize(symbol, 1000)).toBeUndefined();
  });
  test("DecisionEngine arbitrates directional signal → decision", () => {
    const engine = createEngine();
    emitDirectionalInputs(engine, 1000);
    const decision = engine.synthesize(symbol, 1000);
    expect(decision?.side).toBe("long");
    expect(decision?.timestampMs).toBe(1000);
    expect(decision?.sourceWeights["test-plugin"]).toBeGreaterThan(0);
    expect(decision?.notionalUsd).toBe(5000);
  });

  test("DecisionEngine synthesize on empty bus returns undefined", () => {
    const engine = createEngine();
    expect(engine.synthesize(symbol, 1000)).toBeUndefined();
    expect(engine.latestDecision(symbol)).toBeFalsy();
  });

  test("DecisionEngine handles carry signal regime flip", () => {
    const engine = createEngine();
    const bus = createSignalBus({ scopeSymbol: symbol });
    engine.subscribe(bus);
    bus.emit({
      kind: "direction",
      side: "long",
      source: "test-plugin",
      strength: 0.8,
      timestampMs: 2000,
    } satisfies DirectionSignal);
    bus.emit({
      fundingRate: -0.001,
      kind: "carry",
      regime: "flip",
      source: "carry-test",
      timestampMs: 2000,
    } satisfies CarrySignal);
    bus.emit({
      kind: "sizing",
      kellyFraction: 0.5,
      notional: 10_000,
      source: "test-plugin",
      timestampMs: 2000,
      volMultiplier: 1,
    } satisfies SizingSignal);
    const decision = engine.synthesize(symbol, 2000);
    expect(decision?.sizeMultiplier).toBeLessThanOrEqual(0.5);
    expect(decision?.side).toBe("long");
  });

  test("DecisionEngine applies defensive sizeModifier from RiskSignal", () => {
    const engine = createEngine();
    const bus = createSignalBus({ scopeSymbol: symbol });
    engine.subscribe(bus);
    bus.emit({
      kind: "direction",
      side: "long",
      source: "test-plugin",
      strength: 0.9,
      timestampMs: 3000,
    } satisfies DirectionSignal);
    bus.emit({
      correlationPenalty: 0,
      drawdownLimit: 0.2,
      kind: "risk",
      sizeModifier: 0.4,
      source: "regime-detector-meta",
      timestampMs: 3000,
      varDaily95: 0.02,
    } satisfies RiskSignal);
    bus.emit({
      kind: "sizing",
      kellyFraction: 0.5,
      notional: 10_000,
      source: "test-plugin",
      timestampMs: 3000,
      volMultiplier: 1,
    } satisfies SizingSignal);
    const decision = engine.synthesize(symbol, 3000);
    expect(decision?.sizeMultiplier).toBeLessThanOrEqual(0.4);
    expect(decision?.side).toBe("long");
  });

  test("DecisionEngine resets between runs", () => {
    const engine = createEngine();
    emitDirectionalInputs(engine, 4000);
    expect(engine.synthesize(symbol, 4000)).toBeTruthy();
    expect(engine.decisions()).toHaveLength(1);
    engine.reset();
    expect(engine.decisions()).toEqual([]);
  });

  test("is idempotent when init is called twice through the public lifecycle", () => {
    const orchestrator = createPortfolioOrchestrator({
      dataDir: "/portfolio-orchestrator-integration",
      fundingDir: "/portfolio-orchestrator-integration",
      pluginsBySymbol: (candidate) => [createPassivePlugin(candidate)],
      readTextFile: () => Promise.reject(new Error("Reader must not run during init.")),
      symbols: [symbol],
    });
    orchestrator.init();
    const bus = orchestrator.getBusesBySymbol().get(symbol);
    orchestrator.init();
    expect(orchestrator.getBusesBySymbol().get(symbol)).toBe(bus);
    expect(orchestrator.initialized).toBe(true);
  });

  test("wraps an injected reader failure with its deterministic source and cause", async () => {
    const orchestrator = createPortfolioOrchestrator({
      dataDir: "/virtual-data",
      fundingDir: "/virtual-funding",
      pluginsBySymbol: (candidate) => [createPassivePlugin(candidate)],
      readTextFile: () => Promise.reject(new Error("virtual reader unavailable")),
      symbols: [symbol],
    });
    const error = await captureRejection(orchestrator.run(10, 10));
    if (!(error instanceof Error)) throw new Error("Expected an Error rejection.", { cause: error });
    expect(error.message).toBe(
      "[PortfolioOrchestrator] Failed to read binance_btc_1d.csv from /virtual-data.",
    );
    expect(error.cause).toHaveProperty("message", "virtual reader unavailable");
  });

  test("public replay rejects OHLCV rows with a non-positive open", async () => {
    const orchestrator = createCsvOrchestrator(
      "timestamp,open,high,low,close,volume\n10,0,11,8,10,100",
      validFunding,
    );
    expect(await captureRejection(orchestrator.run(10, 10))).toHaveProperty(
      "message",
      expect.stringMatching(/OHLC values must be positive/),
    );
  });

  test("public replay rejects OHLCV rows with a non-positive high", async () => {
    const orchestrator = createCsvOrchestrator(
      "timestamp,open,high,low,close,volume\n10,9,0,8,10,100",
      validFunding,
    );
    expect(await captureRejection(orchestrator.run(10, 10))).toHaveProperty(
      "message",
      expect.stringMatching(/OHLC values must be positive/),
    );
  });

  test("public replay rejects OHLCV rows with a non-positive low", async () => {
    const orchestrator = createCsvOrchestrator(
      "timestamp,open,high,low,close,volume\n10,9,11,0,10,100",
      validFunding,
    );
    expect(await captureRejection(orchestrator.run(10, 10))).toHaveProperty(
      "message",
      expect.stringMatching(/OHLC values must be positive/),
    );
  });

  test("public replay rejects OHLCV rows with a non-positive close", async () => {
    const orchestrator = createCsvOrchestrator(
      "timestamp,open,high,low,close,volume\n10,9,11,8,0,100",
      validFunding,
    );
    expect(await captureRejection(orchestrator.run(10, 10))).toHaveProperty(
      "message",
      expect.stringMatching(/OHLC values must be positive/),
    );
  });

  test("public replay rejects a blank CSV row instead of silently skipping it", async () => {
    const orchestrator = createCsvOrchestrator(
      "timestamp,open,high,low,close,volume\n\n10,9,11,8,10,100",
      validFunding,
    );
    expect(await captureRejection(orchestrator.run(10, 10))).toHaveProperty(
      "message",
      expect.stringMatching(/blank data rows are not allowed/),
    );
  });

  test("public replay rejects a blank OHLCV numeric field", async () => {
    const orchestrator = createCsvOrchestrator(
      "timestamp,open,high,low,close,volume\n10,,11,8,10,100",
      validFunding,
    );
    expect(await captureRejection(orchestrator.run(10, 10))).toHaveProperty(
      "message",
      expect.stringMatching(/open must be a finite number/),
    );
  });

  test("public replay rejects a negative CSV timestamp", async () => {
    const orchestrator = createCsvOrchestrator(
      "timestamp,open,high,low,close,volume\n-1,9,11,8,10,100",
      validFunding,
    );
    expect(await captureRejection(orchestrator.run(10, 10))).toHaveProperty(
      "message",
      expect.stringMatching(/timestamp must be a non-negative safe integer/),
    );
  });

  test("public replay rejects an empty funding symbol", async () => {
    const orchestrator = createCsvOrchestrator(
      validOhlcv,
      "fundingTime,symbol,fundingRate,markPrice\n10,,0.0001,100",
    );
    expect(await captureRejection(orchestrator.run(10, 10))).toHaveProperty(
      "message",
      expect.stringMatching(/symbol must be non-empty/),
    );
  });

  test("public replay rejects funding assigned to another symbol", async () => {
    const orchestrator = createCsvOrchestrator(
      validOhlcv,
      "fundingTime,symbol,fundingRate,markPrice\n10,ETHUSDT,0.0001,100",
    );
    expect(await captureRejection(orchestrator.run(10, 10))).toHaveProperty(
      "message",
      expect.stringMatching(/symbol does not match the request/),
    );
  });

  test("public replay validates non-empty funding mark prices", async () => {
    const orchestrator = createCsvOrchestrator(
      validOhlcv,
      "fundingTime,symbol,fundingRate,markPrice\n10,BTCUSDT,0.0001,NaN",
    );
    expect(await captureRejection(orchestrator.run(10, 10))).toHaveProperty(
      "message",
      expect.stringMatching(/markPrice must be a finite number/),
    );
  });

  test("public replay accepts CRLF input and excludes rows outside the requested interval", async () => {
    const orchestrator = createCsvOrchestrator(
      "timestamp,open,high,low,close,volume\r\n0,9,11,8,10,100\r\n10,9,11,8,10,100\r\n",
      "fundingTime,symbol,fundingRate,markPrice\r\n0,BTCUSDT,0.0001,\r\n10,BTCUSDT,0.0001,\r\n",
    );
    const envelope = await orchestrator.run(10, 10);
    expect(envelope.barCount).toBe(1);
  });

  test("reset surfaces a disposer failure only after clearing observable lifecycle state", () => {
    for (const lifecycleFailure of [
      new Error("decision engine reset failure"),
      createNonErrorFailure("non-error disposal failure"),
    ]) {
      const orchestrator = createPortfolioOrchestrator({
        dataDir: "/portfolio-orchestrator-coverage",
        decisionEngineFactory: (): DecisionEngineLike => ({
          decisions: () => [],
          latestDecision: noDecision,
          reset: () => {
            throw lifecycleFailure;
          },
          subscribe: () => noOperation,
        }),
        fundingDir: "/portfolio-orchestrator-coverage",
        pluginsBySymbol: (candidate) => [createPassivePlugin(candidate)],
        readTextFile: () => Promise.reject(new Error("Reader must not run during init.")),
        symbols: [symbol],
      });
      orchestrator.init();
      expect(() => {
        orchestrator.reset();
      }).toThrow(lifecycleFailure instanceof Error ? /decision engine reset failure/ : /non-error value/);
      expect(orchestrator.initialized).toBe(false);
      expect(orchestrator.getBusesBySymbol()).toEqual(new Map());
    }
  });

  test("reset remains leak-free when a public disposer re-enters the lifecycle", () => {
    let unsubscribeCalls = 0;
    const orchestrator: ReturnType<typeof createPortfolioOrchestrator> = createPortfolioOrchestrator({
      dataDir: "/portfolio-orchestrator-coverage",
      decisionEngineFactory: () =>
        createReenteringDecisionEngine(() => {
          unsubscribeCalls += 1;
          orchestrator.reset();
        }),
      fundingDir: "/portfolio-orchestrator-coverage",
      pluginsBySymbol: (candidate) => [createPassivePlugin(candidate)],
      readTextFile: () => Promise.reject(new Error("Reader must not run during init.")),
      symbols: [symbol],
    });
    orchestrator.init();
    orchestrator.reset();
    expect(unsubscribeCalls).toBe(1);
    expect(orchestrator.initialized).toBe(false);
    expect(orchestrator.getBusesBySymbol()).toEqual(new Map());
  });

  test("previous-bar lookup returns no value when no loaded series exists", () => {
    expect(previousBarBefore(undefined, 10)).toBeUndefined();
  });
});
