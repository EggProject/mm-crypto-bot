import { PortfolioStop, PortfolioStopError } from "../../../src/portfolio/portfolio-stop.js";
import {
  RISK_BUDGET_HARD_CAPS,
  RiskBudgetAllocator,
  type StrategyRiskConfig,
} from "../../../src/portfolio/risk-budget.js";

import { assertCondition, expectFailure, quietLogger } from "./runtime-driver-core.js";

function throwBaselineFault(failure: Error | string): never {
  // eslint-disable-next-line @typescript-eslint/only-throw-error -- Exercises callback handling when the thrown value is not an Error.
  throw failure;
}

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
    expectFailure(() => new RiskBudgetAllocator({ totalRiskUsd }), "invalid total risk budget");
  }
  for (const correlationPenaltyThreshold of [NaN, -0.1, 1.1]) {
    expectFailure(
      () => new RiskBudgetAllocator({ totalRiskUsd: 100, correlationPenaltyThreshold }),
      "invalid correlation threshold",
    );
  }
  const defaultAllocator = new RiskBudgetAllocator({ totalRiskUsd: maximum });
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

async function exercisePortfolioStop(): Promise<void> {
  new PortfolioStopError("default cause");
  new PortfolioStopError("explicit cause", new Error("cause"));
  for (const maxDdPct of [NaN, 0.005, 0.31]) {
    expectFailure(() => new PortfolioStop({ maxDdPct }), "invalid portfolio stop threshold");
  }
  const defaultStop = new PortfolioStop();
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
  // eslint-disable-next-line unicorn/no-null -- The public clear-action contract accepts null and has no undefined alternative.
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
      return throwBaselineFault("trip rejection");
    },
  });
  rejectionAction.forceTrip("rejection-action");
  await Promise.resolve();
  await Promise.resolve();
}

export async function runPortfolioPrimitives(): Promise<void> {
  exerciseRiskBudget();
  await exercisePortfolioStop();
}
