import { PortfolioStop, PortfolioStopError } from "../../../src/portfolio/portfolio-stop.js";
import { CORRELATION_HARD_CAPS, CorrelationMatrix } from "../../../src/portfolio/correlation.js";
import {
  RISK_BUDGET_HARD_CAPS,
  RiskBudgetAllocator,
  type StrategyRiskConfig,
} from "../../../src/portfolio/risk-budget.js";

import { quietLogger, assertCondition, expectFailure } from "./runtime-driver-core.js";

function makeStrategyConfigs(
  entries: readonly (readonly [string, number])[],
): Map<string, StrategyRiskConfig> {
  return new Map(
    entries.map(([strategyId, weight]) => [
      strategyId,
      {
        strategyId,
        weight,
        riskPerTrade: 0.01,
      },
    ]),
  );
}

function exerciseRiskBudget(): void {
  const maximum = RISK_BUDGET_HARD_CAPS.totalRiskUsdMax;
  for (const totalRiskUsd of [NaN, 0, maximum + 1]) {
    expectFailure(
      () => new RiskBudgetAllocator({ totalRiskUsd, logger: quietLogger }),
      "invalid total risk budget",
    );
  }
  for (const correlationPenaltyThreshold of [NaN, -0.1, 1.1]) {
    expectFailure(
      () => new RiskBudgetAllocator({ totalRiskUsd: 100, correlationPenaltyThreshold, logger: quietLogger }),
      "invalid correlation threshold",
    );
  }
  const defaultAllocator = new RiskBudgetAllocator({ totalRiskUsd: maximum, logger: quietLogger });
  assertCondition(defaultAllocator.getTotalRiskUsd() === maximum, "risk budget maximum changed");
  assertCondition(
    defaultAllocator.getCorrelationPenaltyThreshold() === 0.7,
    "risk budget default threshold changed",
  );
  assertCondition(defaultAllocator.computeBudgets(new Map()).size === 0, "empty risk budget was not empty");

  const allocator = new RiskBudgetAllocator({
    totalRiskUsd: 100,
    correlationPenaltyThreshold: 0.5,
    logger: quietLogger,
  });
  const configs = makeStrategyConfigs([
    ["a", 2],
    ["b", 1],
    ["c", -1],
  ]);
  allocator.computeBudgets(configs);
  allocator.computeBudgets(
    makeStrategyConfigs([
      ["a", 0],
      ["b", -1],
    ]),
  );
  const matrix = new Map<string, ReadonlyMap<string, number>>([
    [
      "a",
      new Map([
        ["a", 1],
        ["b", -0.9],
        ["c", NaN],
        ["d", 2],
      ]),
    ],
    [
      "b",
      new Map([
        ["a", -0.9],
        ["b", 1],
      ]),
    ],
  ]);
  const budgets = allocator.computeBudgets(configs, () => matrix);
  assertCondition((budgets.get("a")?.penalty ?? 0) > 0, "correlated strategy was not penalized");

  const thresholdOne = new RiskBudgetAllocator({
    totalRiskUsd: 100,
    correlationPenaltyThreshold: 1,
    logger: quietLogger,
  });
  thresholdOne.computeBudgets(
    makeStrategyConfigs([
      ["a", 0.5],
      ["b", 0.5],
    ]),
    () =>
      new Map([
        [
          "a",
          new Map([
            ["a", 1],
            ["b", 1],
          ]),
        ],
        [
          "b",
          new Map([
            ["a", 1],
            ["b", 1],
          ]),
        ],
      ]),
  );
}

function exerciseCorrelationStreams(): void {
  expectFailure(() => new CorrelationMatrix(), "missing correlation logger");
  const defaultCorrelation = new CorrelationMatrix({ logger: quietLogger });
  assertCondition(defaultCorrelation.getWindowSize() === 30, "default correlation window changed");
  for (const windowSize of [
    NaN,
    CORRELATION_HARD_CAPS.windowSizeMin - 1,
    CORRELATION_HARD_CAPS.windowSizeMax + 1,
  ]) {
    expectFailure(
      () => new CorrelationMatrix({ windowSize, logger: quietLogger }),
      "invalid correlation window",
    );
  }
  const correlation = new CorrelationMatrix({ windowSize: 2, logger: quietLogger });
  assertCondition(correlation.getWindowSize() === 2, "correlation window accessor changed");
  assertCondition(correlation.getStrategyCount() === 0, "empty correlation matrix retained streams");
  assertCondition(correlation.getSampleCount("missing") === 0, "missing stream had samples");
  assertCondition(correlation.getCorrelation("missing", "other") === 0, "missing streams correlated");
  assertCondition(correlation.getCorrelation("missing", "missing") === 1, "self correlation changed");
  correlation.recordFill("invalid", NaN);
  correlation.recordFill("infinite", Infinity);
  assertCondition(correlation.getStrategyCount() === 0, "invalid returns polluted correlation streams");

  correlation.recordFill("constant", 0.1);
  correlation.recordFill("constant", 0.1);
  correlation.recordFill("variable", 0.1);
  correlation.recordFill("variable", 0.2);
  assertCondition(
    correlation.getCorrelation("constant", "variable") === 0,
    "constant return stream produced a fabricated correlation",
  );

  correlation.recordFill("rolling", 1);
  correlation.recordFill("rolling", 2);
  correlation.recordFill("rolling", 3);
  correlation.recordFill("parallel", 4);
  correlation.recordFill("parallel", 6);
  assertCondition(
    correlation.getSampleCount("rolling") === 2,
    "rolling stream did not evict its oldest fill",
  );
  assertCondition(
    correlation.getCorrelation("rolling", "parallel") === 1,
    "aligned finite streams did not produce their observable positive correlation",
  );
  correlation.recordFill("finite-extreme-a", Number.MAX_VALUE);
  correlation.recordFill("finite-extreme-a", -Number.MAX_VALUE);
  correlation.recordFill("finite-extreme-b", Number.MAX_VALUE);
  correlation.recordFill("finite-extreme-b", -Number.MAX_VALUE);
  assertCondition(
    correlation.getCorrelation("finite-extreme-a", "finite-extreme-b") === 0,
    "finite extreme correlation did not fail closed to an uncorrelated result",
  );
  assertCondition(
    correlation.getMatrix().sampleCounts.get("rolling") === 2,
    "correlation snapshot did not expose retained samples",
  );
  correlation.forgetStrategy("parallel");
  assertCondition(correlation.getSampleCount("parallel") === 0, "forgetStrategy retained its stream");
  correlation.reset();
  assertCondition(correlation.getStrategyCount() === 0, "correlation reset retained streams");
}

async function exercisePortfolioStop(): Promise<void> {
  new PortfolioStopError("default cause");
  new PortfolioStopError("explicit cause", new Error("cause"));
  for (const maxDdPct of [NaN, 0.005, 0.31]) {
    expectFailure(
      () => new PortfolioStop({ maxDdPct, logger: quietLogger }),
      "invalid portfolio stop threshold",
    );
  }
  const defaultStop = new PortfolioStop({ logger: quietLogger });
  expectFailure(() => new PortfolioStop(), "missing portfolio stop logger");
  const defaultArgumentStop = new PortfolioStop({ logger: quietLogger });
  assertCondition(defaultArgumentStop.getMaxDdPct() === 0.1, "portfolio stop default argument changed");
  assertCondition(defaultStop.getDrawdownPct() === 0, "empty portfolio stop drawdown changed");
  assertCondition(!defaultStop.hasReceivedAnyEquity(), "portfolio stop received phantom equity");
  defaultStop.recordEquity(NaN);
  defaultStop.recordEquity(0);
  defaultStop.recordEquity(-1);
  defaultStop.evaluate();
  defaultStop.getState();

  let trips = 0;
  const stop = new PortfolioStop({
    maxDdPct: 0.1,
    logger: quietLogger,
    tripAction: () => {
      trips += 1;
      return Promise.resolve();
    },
  });
  stop.getMaxDdPct();
  stop.getTrippedAt();
  stop.recordEquity(10_000, new Map([["strategy-a", -10]]));
  stop.recordEquity(11_000);
  stop.recordEquity(10_500);
  stop.recordEquity(9900, new Map([["strategy-b", -100]]));
  await Promise.resolve();
  assertCondition(stop.isTripped() && trips === 1, "portfolio stop did not trip once");
  stop.recordEquity(8000);
  stop.getPeakEquity();
  stop.getCurrentEquity();
  stop.getDrawdownPct();
  stop.getState();
  stop.reset();
  stop.forceTrip("manual");
  stop.forceTrip("duplicate");
  stop.reset({ clearPeak: true });
  assertCondition(!stop.hasReceivedAnyEquity(), "clear-peak reset retained equity state");
  // eslint-disable-next-line unicorn/no-null -- The E2E boundary preserves the explicit null contract under test.
  stop.setTripAction(null);
  stop.forceTrip("no-action");
  await Promise.resolve();

  const errorAction = new PortfolioStop({
    maxDdPct: 0.1,
    logger: quietLogger,
    tripAction: () => {
      throw new Error("trip Error");
    },
  });
  errorAction.forceTrip("error-action");
  const rejectionAction = new PortfolioStop({
    maxDdPct: 0.1,
    logger: quietLogger,
    tripAction: () => {
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- E2E fault injection verifies normalization of non-Error failures.
      throw "trip rejection";
    },
  });
  rejectionAction.forceTrip("rejection-action");
  await Promise.resolve();
  await Promise.resolve();
}

async function runPortfolioPrimitives(): Promise<void> {
  exerciseRiskBudget();
  exerciseCorrelationStreams();
  await exercisePortfolioStop();
}

export { runPortfolioPrimitives };
