import { createSignalBus } from "../signal-center/signal-bus.js";
import { describe, expect, test } from "bun:test";
import {
  DecisionEngine,
  DEFENSIVE_PLUGIN_NAMES,
  DEFAULT_DECISION_ENGINE_CONFIG,
} from "./portfolio-decision.js";
import type { DecisionEngineLike, PositionDecision } from "./portfolio-decision.js";
import { PortfolioOrchestrator } from "./portfolio-orchestrator.js";
import { calculateAggregateBar } from "./portfolio-orchestrator-analytics.js";
import {
  captureRejection,
  integrationPassivePlugin,
  noOperation,
} from "./portfolio-orchestrator.test-support.js";

const timestampMs = 1_700_000_000_000;

function decision(symbol: string, notionalUsd: number): PositionDecision {
  return {
    confidence: 1,
    notionalUsd,
    side: notionalUsd === 0 ? "flat" : notionalUsd > 0 ? "long" : "short",
    sizeMultiplier: 1,
    sourceWeights: { safety: 1 },
    symbol,
    timestampMs,
  };
}

function aggregate(decisionsBySymbol: ReadonlyMap<string, PositionDecision | undefined>) {
  const symbols: string[] = [];
  const decisionsForTimestamp: PositionDecision[] = [];
  for (const [symbol, candidate] of decisionsBySymbol) {
    symbols.push(symbol);
    if (candidate !== undefined) decisionsForTimestamp.push(candidate);
  }
  return calculateAggregateBar({
    correlationThreshold: 0.8,
    decisionsBySymbol,
    decisionsForTimestamp,
    maxAggregateEffectiveLeverage: 10,
    maxPositions: 2,
    perSymbolConcentrationPct: 1,
    portfolioEquity: 1000,
    returnsBySymbol: new Map([
      ["BTC/USDT", [0, 1]],
      ["ETH/USDT", [0, 1]],
    ]),
    symbols,
    timestampMs,
  });
}

function fixtureReader(root: string, fileName: string): Promise<string> {
  const files = new Map<string, string>([
    [
      "/report-only-data/binance_btc_1d.csv",
      `timestamp,open,high,low,close,volume\n${String(timestampMs)},99,101,98,100,1000`,
    ],
    ["/report-only-funding/binance_btcusdt_funding_8h.csv", "fundingTime,symbol,fundingRate,markPrice"],
  ]);
  const content = files.get(`${root}/${fileName}`);
  if (content === undefined) return Promise.reject(new Error(`Missing fixture ${fileName}.`));
  return Promise.resolve(content);
}

class InjectedDecisionEngine implements DecisionEngineLike {
  constructor(private readonly candidate: PositionDecision) {}

  decisions(): readonly PositionDecision[] {
    return [];
  }

  latestDecision(): PositionDecision | undefined {
    return undefined;
  }

  reset(): void {
    return;
  }

  subscribe(): () => void {
    return noOperation;
  }

  synthesize(): PositionDecision {
    return this.candidate;
  }
}

class UntrustedDecisionEngine implements DecisionEngineLike {
  constructor(private readonly candidate: unknown) {}

  decisions(): readonly PositionDecision[] {
    return [];
  }

  latestDecision(): PositionDecision | undefined {
    return undefined;
  }

  reset(): void {
    return;
  }

  subscribe(): () => void {
    return noOperation;
  }

  synthesize(): unknown {
    return this.candidate;
  }
}

function orchestratorFor(candidate: PositionDecision): PortfolioOrchestrator {
  return orchestratorForEngine(new InjectedDecisionEngine(candidate));
}

function orchestratorForUntrusted(candidate: unknown): PortfolioOrchestrator {
  return orchestratorForEngine(new UntrustedDecisionEngine(candidate));
}

function orchestratorForEngine(decisionEngine: DecisionEngineLike): PortfolioOrchestrator {
  return new PortfolioOrchestrator({
    dataDir: "/report-only-data",
    decisionEngineFactory: () => decisionEngine,
    fundingDir: "/report-only-funding",
    pluginsBySymbol: (symbol) => [integrationPassivePlugin(symbol)],
    readTextFile: fixtureReader,
    symbols: ["BTC/USDT"],
  });
}

class GetterDecisionEngine implements DecisionEngineLike {
  readonly candidate = decision("BTC/USDT", 1);
  readonly receiverToken = Object.freeze({});
  synthesizeCalls = 0;
  synthesizeReads = 0;

  decisions(): readonly PositionDecision[] {
    return [];
  }

  latestDecision(): PositionDecision | undefined {
    return undefined;
  }

  reset(): void {
    return;
  }

  subscribe(): () => void {
    return noOperation;
  }

  get synthesize(): (symbol: string, timestamp: number) => PositionDecision {
    this.synthesizeReads += 1;
    const receiverToken = this.receiverToken;
    return function synthesizeWithAuthenticReceiver(
      this: GetterDecisionEngine,
      _symbol: string,
      _timestamp: number,
    ): PositionDecision {
      if (this.receiverToken !== receiverToken) throw new Error("unexpected synthesize receiver");
      this.synthesizeCalls += 1;
      return this.candidate;
    };
  }
}

class ThrowingHistoryDecisionEngine implements DecisionEngineLike {
  decisions(): readonly PositionDecision[] {
    throw new Error("history getter failure");
  }

  latestDecision(): PositionDecision | undefined {
    return undefined;
  }

  reset(): void {
    return;
  }

  subscribe(): () => void {
    return noOperation;
  }
}

class ThrowingSynthesisDecisionEngine implements DecisionEngineLike {
  decisions(): readonly PositionDecision[] {
    return [];
  }

  latestDecision(): PositionDecision | undefined {
    return undefined;
  }

  reset(): void {
    return;
  }

  subscribe(): () => void {
    return noOperation;
  }

  synthesize(): PositionDecision {
    throw new Error("synthesize invocation failure");
  }
}

class RevokedSynthesisDecisionEngine implements DecisionEngineLike {
  decisions(): readonly PositionDecision[] {
    return [];
  }

  latestDecision(): PositionDecision | undefined {
    return undefined;
  }

  reset(): void {
    return;
  }

  subscribe(): () => void {
    return noOperation;
  }

  get synthesize(): (symbol: string, timestamp: number) => PositionDecision {
    const revocable = Proxy.revocable(function revokedSynthesis(): PositionDecision {
      return decision("BTC/USDT", 1);
    }, {});
    revocable.revoke();
    return revocable.proxy;
  }
}

const invalidCandidates: readonly (readonly [string, PositionDecision])[] = [
  ["NaN notional", { ...decision("BTC/USDT", 1), notionalUsd: NaN }],
  ["infinite notional", { ...decision("BTC/USDT", 1), notionalUsd: Infinity }],
  ["wrong symbol", { ...decision("BTC/USDT", 1), symbol: "ETH/USDT" }],
  ["wrong timestamp", { ...decision("BTC/USDT", 1), timestampMs: timestampMs + 1 }],
  ["incoherent side", { ...decision("BTC/USDT", 1), side: "flat" }],
  ["invalid size multiplier", { ...decision("BTC/USDT", 1), sizeMultiplier: 2 }],
  ["invalid confidence", { ...decision("BTC/USDT", 1), confidence: -1 }],
  ["blank source weight key", { ...decision("BTC/USDT", 1), sourceWeights: { " ": 1 } }],
  ["negative source weight", { ...decision("BTC/USDT", 1), sourceWeights: { safety: -1 } }],
];

const sourceWeightsWithAccessor = Object.defineProperty({}, "safety", {
  enumerable: true,
  get(): number {
    return 1;
  },
});

describe("Portfolio report-only approximate analytics", () => {
  test("correlated unequal notionals remain byte-for-byte unchanged", () => {
    const result = aggregate(
      new Map([
        ["BTC/USDT", decision("BTC/USDT", 100)],
        ["ETH/USDT", decision("ETH/USDT", 10)],
      ]),
    );

    expect(result.snapshot.positionsBySymbol["BTC/USDT"]?.appliedNotionalUsd).toBe(100);
    expect(result.snapshot.positionsBySymbol["ETH/USDT"]?.appliedNotionalUsd).toBe(10);
    expect(result.snapshot.approximateAnalytics.correlationThresholdExceeded).toBe(true);
  });

  test("extreme estimated VaR reports without changing positions", () => {
    const result = aggregate(
      new Map([
        ["BTC/USDT", decision("BTC/USDT", 100)],
        ["ETH/USDT", decision("ETH/USDT", 10)],
      ]),
    );

    expect(result.snapshot.approximateAnalytics.estimatedVaRPct).toBeGreaterThan(0);
    expect(
      Object.values(result.snapshot.positionsBySymbol).map(({ appliedNotionalUsd }) => appliedNotionalUsd),
    ).toEqual([100, 10]);
  });

  test("publishes approximate analytics only in its deeply frozen subtree", () => {
    const result = aggregate(new Map([["BTC/USDT", decision("BTC/USDT", 100)]]));

    expect("portfolioVaRPct" in result.snapshot).toBe(false);
    expect("correlationMatrix" in result.snapshot).toBe(false);
    expect("correlationPenaltyActive" in result.snapshot).toBe(false);
    expect(Reflect.set(result.snapshot.approximateAnalytics, "estimatedVaRPct", 0)).toBe(false);
    expect(
      Reflect.set(result.snapshot.approximateAnalytics.correlationMatrix["BTC/USDT"] ?? {}, "BTC/USDT", 0),
    ).toBe(false);
  });
});

describe("DecisionEngine immutable public state", () => {
  test("defaults, plugin names, instance config, decisions, and source weights are frozen copies", () => {
    const callerConfig = { defaultWeight: 3, symbol: "BTCUSDT" };
    const engine = new DecisionEngine(callerConfig);
    callerConfig.defaultWeight = 9;

    expect(Reflect.set(DEFAULT_DECISION_ENGINE_CONFIG, "defaultWeight", 9)).toBe(false);
    expect(Reflect.set(DEFENSIVE_PLUGIN_NAMES, 0, "mutated")).toBe(false);
    expect(Reflect.set(engine.config, "defaultWeight", 9)).toBe(false);
    expect(engine.config.defaultWeight).toBe(3);
    expect(Object.isFrozen(engine.decisions())).toBe(true);
  });

  test("returns a deeply frozen decision and decision list", () => {
    const engine = new DecisionEngine({ symbol: "BTCUSDT" });
    const bus = createSignalBus();
    engine.subscribe(bus);
    bus.emit({ kind: "direction", side: "long", source: "freeze-check", strength: 1, timestampMs });
    const returned = engine.synthesize("BTCUSDT", timestampMs);
    if (returned === undefined) throw new Error("Expected a synthesized decision.");

    expect(Reflect.set(returned, "notionalUsd", 1)).toBe(false);
    expect(Reflect.set(returned.sourceWeights, "freeze-check", 0)).toBe(false);
    expect(Reflect.set(engine.decisions(), 0, returned)).toBe(false);
  });
});

describe("Portfolio decision boundary", () => {
  test.each(invalidCandidates)(
    "rejects injected %s before decision log or snapshots mutate",
    async (_label, candidate) => {
      const orchestrator = orchestratorFor(candidate);

      const error = await captureRejection(orchestrator.run(timestampMs, timestampMs));
      expect(error).toBeInstanceOf(Error);
      if (!(error instanceof Error)) throw new Error("Expected an Error rejection.");
      expect(error.message).toMatch(/Portfolio decision boundary/);
      expect(orchestrator.getDecisionLog()).toEqual([]);
      expect(orchestrator.getSnapshots()).toEqual([]);
    },
  );

  test("wraps a hostile decision getter with its cause before state mutation", async () => {
    const hostile = decision("BTC/USDT", 1);
    Object.defineProperty(hostile, "symbol", {
      enumerable: true,
      get(): string {
        throw new Error("hostile symbol getter");
      },
    });
    const orchestrator = orchestratorFor(hostile);

    const error = await captureRejection(orchestrator.run(timestampMs, timestampMs));
    expect(error).toBeInstanceOf(Error);
    if (!(error instanceof Error)) throw new Error("Expected an Error rejection.");
    expect(error.message).toContain("Portfolio decision boundary");
    expect(error.cause).toBeInstanceOf(Error);
    if (!(error.cause instanceof Error)) throw new Error("Expected the hostile getter as the cause.");
    expect(error.cause.message).toBe("hostile symbol getter");
    expect(orchestrator.getDecisionLog()).toEqual([]);
    expect(orchestrator.getSnapshots()).toEqual([]);
  });

  test("wraps a revoked decision proxy before state mutation", async () => {
    const revocable = Proxy.revocable(decision("BTC/USDT", 1), {});
    revocable.revoke();
    const orchestrator = orchestratorFor(revocable.proxy);

    const error = await captureRejection(orchestrator.run(timestampMs, timestampMs));
    expect(error).toBeInstanceOf(Error);
    if (!(error instanceof Error)) throw new Error("Expected an Error rejection.");
    expect(error.message).toMatch(/Portfolio decision boundary/);
    expect(orchestrator.getDecisionLog()).toEqual([]);
    expect(orchestrator.getSnapshots()).toEqual([]);
  });

  test("reads a dynamic synthesize method once and invokes it with the engine receiver", async () => {
    const engine = new GetterDecisionEngine();
    const orchestrator = orchestratorForEngine(engine);

    await orchestrator.run(timestampMs, timestampMs);

    expect(engine.synthesizeReads).toBe(1);
    expect(engine.synthesizeCalls).toBe(1);
    expect(orchestrator.getDecisionLog()).toHaveLength(1);
  });

  test("normalizes a throwing decision history before state mutation", async () => {
    const orchestrator = orchestratorForEngine(new ThrowingHistoryDecisionEngine());
    const error = await captureRejection(orchestrator.run(timestampMs, timestampMs));

    expect(error).toBeInstanceOf(Error);
    if (!(error instanceof Error)) throw new Error("Expected an Error rejection.");
    expect(error.message).toContain("Portfolio decision boundary");
    expect(error.cause).toBeInstanceOf(Error);
    expect(orchestrator.getDecisionLog()).toEqual([]);
    expect(orchestrator.getSnapshots()).toEqual([]);
  });

  test("normalizes a throwing synthesize getter before state mutation", async () => {
    const throwingGetter = new InjectedDecisionEngine(decision("BTC/USDT", 1));
    Object.defineProperty(throwingGetter, "synthesize", {
      enumerable: true,
      get(): never {
        throw new Error("synthesize getter failure");
      },
    });
    const orchestrator = orchestratorForEngine(throwingGetter);
    const error = await captureRejection(orchestrator.run(timestampMs, timestampMs));
    expect(error).toBeInstanceOf(Error);
    if (!(error instanceof Error)) throw new Error("Expected an Error rejection.");
    expect(error.message).toContain("Portfolio decision boundary");
    expect(error.cause).toBeInstanceOf(Error);
    expect(orchestrator.getDecisionLog()).toEqual([]);
    expect(orchestrator.getSnapshots()).toEqual([]);
  });

  test("normalizes a throwing synthesize invocation before state mutation", async () => {
    const orchestrator = orchestratorForEngine(new ThrowingSynthesisDecisionEngine());
    const error = await captureRejection(orchestrator.run(timestampMs, timestampMs));

    expect(error).toBeInstanceOf(Error);
    if (!(error instanceof Error)) throw new Error("Expected an Error rejection.");
    expect(error.message).toContain("Portfolio decision boundary");
    expect(error.cause).toBeInstanceOf(Error);
    expect(orchestrator.getDecisionLog()).toEqual([]);
    expect(orchestrator.getSnapshots()).toEqual([]);
  });

  test("normalizes a revoked synthesize proxy before state mutation", async () => {
    const orchestrator = orchestratorForEngine(new RevokedSynthesisDecisionEngine());
    const error = await captureRejection(orchestrator.run(timestampMs, timestampMs));

    expect(error).toBeInstanceOf(Error);
    if (!(error instanceof Error)) throw new Error("Expected an Error rejection.");
    expect(error.message).toContain("Portfolio decision boundary");
    expect(error.cause).toBeInstanceOf(Error);
    expect(orchestrator.getDecisionLog()).toEqual([]);
    expect(orchestrator.getSnapshots()).toEqual([]);
  });

  test.each([
    ["non-object decision", 1],
    ["invalid side", { ...decision("BTC/USDT", 1), side: "sideways" }],
    ["incoherent short side", { ...decision("BTC/USDT", 1), side: "short" }],
    ["non-plain source weights", { ...decision("BTC/USDT", 1), sourceWeights: new Map() }],
    ["source weight accessor", { ...decision("BTC/USDT", 1), sourceWeights: sourceWeightsWithAccessor }],
  ])("rejects injected %s before state mutation", async (_label, candidate) => {
    const orchestrator = orchestratorForUntrusted(candidate);
    const error = await captureRejection(orchestrator.run(timestampMs, timestampMs));

    expect(error).toBeInstanceOf(Error);
    if (!(error instanceof Error)) throw new Error("Expected an Error rejection.");
    expect(error.message).toContain("Portfolio decision boundary");
    expect(orchestrator.getDecisionLog()).toEqual([]);
    expect(orchestrator.getSnapshots()).toEqual([]);
  });
});
