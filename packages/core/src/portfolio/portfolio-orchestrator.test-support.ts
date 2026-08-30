import type { StrategyPlugin } from "../signal-center/strategy-registry.js";
import { ok, type Bar, type PluginState } from "../signal-center/types.js";
import type {
  DecisionEngineLike,
  PortfolioOrchestrator,
  PositionDecision,
} from "./portfolio-orchestrator.js";

export async function captureRejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error: unknown) {
    return error;
  }
  throw new Error("Expected a rejected promise.");
}

export function noDecision(): undefined {
  return;
}

export function noOperation(): void {
  return;
}

export const portfolioFixtureDirectories = { data: "/tmp/portfolio-data", funding: "/tmp/portfolio-funding" };

function missingPortfolioFixture(_root: string, fileName: string): Promise<string> {
  return Promise.reject(new Error(`Missing virtual fixture ${fileName}.`));
}

type OrchestratorConfig = ConstructorParameters<typeof PortfolioOrchestrator>[0];
export function portfolioConfig(overrides: Partial<OrchestratorConfig> = {}): OrchestratorConfig {
  return {
    dataDir: portfolioFixtureDirectories.data,
    fundingDir: portfolioFixtureDirectories.funding,
    readTextFile: missingPortfolioFixture,
    ...overrides,
  };
}
export function integrationPassivePlugin(symbol: string, onReset: () => void = noOperation): StrategyPlugin {
  return {
    metadata: {
      capitalRequirement: 1,
      edgeClass: "sizing",
      maxAggregateEffectiveLeverage: 10,
      name: `passive-${symbol.toLowerCase().replace("/", "-")}`,
      version: "1.0.0",
    },
    onBar: (_bar: Bar, _state: PluginState): void => undefined,
    reset: onReset,
    subscribe: noOperation,
    validateConfig: () => ok(undefined),
  };
}

export function integrationLifecycleEngine(
  symbol: string,
  events: string[],
  isFailOnSubscribe: boolean,
): DecisionEngineLike {
  return {
    decisions: () => [],
    latestDecision: noDecision,
    reset: () => {
      events.push(`reset:${symbol}`);
    },
    subscribe: () => {
      events.push(`subscribe:${symbol}`);
      if (isFailOnSubscribe) throw new Error(`subscription failure for ${symbol}`);
      return () => {
        events.push(`unsubscribe:${symbol}`);
      };
    },
  };
}

export function portfolioDecision(symbol: string, notionalUsd: number): PositionDecision {
  return {
    confidence: 1,
    notionalUsd,
    side: "long",
    sizeMultiplier: 1,
    sourceWeights: { coverage: 1 },
    symbol,
    timestampMs: 1,
  };
}

export function createReenteringDecisionEngine(onUnsubscribe: () => void): DecisionEngineLike {
  return {
    decisions: () => [],
    latestDecision: noDecision,
    reset: noOperation,
    subscribe: () => onUnsubscribe,
  };
}
