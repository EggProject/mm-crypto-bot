import { PortfolioStop } from "../../../src/portfolio/portfolio-stop.js";
import { CorrelationMatrix } from "../../../src/portfolio/correlation.js";
import { PortfolioManager } from "../../../src/portfolio/portfolio-manager.js";
import { RiskBudgetAllocator } from "../../../src/portfolio/risk-budget.js";

import { assertCondition, quietLogger } from "./runtime-driver-core.js";
import {
  makePortfolioSymbol,
  SequencedFillFeed,
  ImmediateFillFeed,
  makePortfolioStack,
  registerPortfolioStrategies,
} from "./runtime-driver-portfolio-fixtures.js";

function expectTerminalEvidenceLimitFailure(
  terminalCloseEvidenceLimit: number,
  positionManager: Awaited<ReturnType<typeof makePortfolioStack>>["positionManager"],
  orderManager: Awaited<ReturnType<typeof makePortfolioStack>>["orderManager"],
  label: string,
): void {
  try {
    new PortfolioManager({
      riskBudget: new RiskBudgetAllocator({ totalRiskUsd: 100, logger: quietLogger }),
      correlation: new CorrelationMatrix({ logger: quietLogger }),
      portfolioStop: new PortfolioStop({ logger: quietLogger }),
      positionManager,
      orderManager,
      terminalCloseEvidenceLimit,
      logger: quietLogger,
    });
  } catch (error) {
    assertCondition(
      error instanceof RangeError &&
        error.message === "terminalCloseEvidenceLimit must be a positive integer",
      `${label} did not reach terminal-evidence validation`,
    );
    return;
  }
  throw new Error(`${label} accepted an invalid terminal-evidence limit`);
}

async function runPortfolioManagerPaper(): Promise<void> {
  const symbol = makePortfolioSymbol();
  const stack = await makePortfolioStack({
    totalRiskUsd: 1000,
    threshold: 0.5,
    maxDdPct: 0.1,
    paperMode: true,
  });
  try {
    assertCondition(!stack.portfolioManager.isTripped(), "fresh portfolio was tripped");
    assertCondition(stack.portfolioManager.getBudgetFor("missing") === 0, "unknown strategy received budget");
    registerPortfolioStrategies(stack, [
      ["a", 0.5],
      ["b", 0.5],
    ]);
    stack.portfolioManager.setStrategyConfig({ strategyId: "a", weight: 0.6, riskPerTrade: 0.01 });
    assertCondition(
      stack.portfolioManager.getPerStrategyBudget().size === 2,
      "portfolio budget size mismatch",
    );
    assertCondition(
      stack.portfolioManager.getBudgetBreakdowns().size === 2,
      "portfolio breakdown size mismatch",
    );
    assertCondition(
      stack.portfolioManager.getStrategyConfigs().get("a")?.weight === 0.6,
      "portfolio config update failed",
    );
    for (let index = 0; index < 20; index += 1) {
      stack.portfolioManager.recordFill({ strategyId: "a", returnPct: index * 0.001 });
      stack.portfolioManager.recordFill({ strategyId: "b", returnPct: index * 0.001 });
    }
    assertCondition(
      stack.portfolioManager.getBudgetFor("a") < 600,
      "correlation did not reduce portfolio budget",
    );
    assertCondition(
      stack.portfolioManager.getCorrelationMatrix().sampleCounts.get("a") === 20,
      "portfolio correlation sample mismatch",
    );
    stack.portfolioManager.removeStrategyConfig("b");
    assertCondition(!stack.portfolioManager.getStrategyConfigs().has("b"), "portfolio config removal failed");

    stack.positionManager.openPosition("a", symbol, "long", 0.01, 60_000, 10, 1);
    stack.positionManager.openPosition("b", symbol, "short", 0.01, 60_000, 10, 1);
    stack.portfolioManager.recordEquity(100_000);
    assertCondition(
      stack.portfolioManager.getStopState().peakEquityUsd === 100_000,
      "portfolio peak mismatch",
    );
    const firstClose = stack.portfolioManager.executeCloseAll();
    const concurrentClose = stack.portfolioManager.executeCloseAll();
    const [firstReport, concurrentReport] = await Promise.all([firstClose, concurrentClose]);
    assertCondition(firstReport.unresolved.length === 0, "paper portfolio close was unresolved");
    assertCondition(concurrentReport.unresolved.length === 0, "concurrent portfolio close diverged");
    assertCondition(
      stack.positionManager.getPositionCount() === 0,
      "paper portfolio close retained positions",
    );
    assertCondition(stack.portfolioManager.didExecuteCloseAll(), "paper portfolio close did not latch");
    const noOp = await stack.portfolioManager.executeCloseAll();
    assertCondition(noOp.closed.length === 0, "latched portfolio close was not a no-op");

    stack.portfolioManager.reset();
    assertCondition(!stack.portfolioManager.isTripped(), "portfolio reset retained stop latch");
    assertCondition(!stack.portfolioManager.didExecuteCloseAll(), "portfolio reset retained close latch");
    assertCondition(
      stack.portfolioManager.getPortfolioState().perStrategyBudgetUsd.size === 1,
      "portfolio reset lost strategy config",
    );
    stack.portfolioManager.recordEquity(100_000);
    await stack.portfolioManager.recordEquityAndSettle(95_000);
    assertCondition(!stack.portfolioManager.isTripped(), "normal drawdown tripped portfolio");
    await stack.portfolioManager.recordEquityAndSettle(80_000);
    assertCondition(
      stack.portfolioManager.getPortfolioState().isTripped,
      "portfolio trip state was not exposed",
    );

    expectTerminalEvidenceLimitFailure(
      0,
      stack.positionManager,
      stack.orderManager,
      "zero terminal evidence bound",
    );
    expectTerminalEvidenceLimitFailure(
      1.5,
      stack.positionManager,
      stack.orderManager,
      "fractional terminal evidence bound",
    );
    expectTerminalEvidenceLimitFailure(
      NaN,
      stack.positionManager,
      stack.orderManager,
      "non-finite terminal evidence bound",
    );
  } finally {
    await stack.feed.close();
  }

  for (const pricing of ["average", "price", "position"] as const) {
    const feed = new ImmediateFillFeed(pricing);
    const pricingStack = await makePortfolioStack({ feed });
    try {
      const side = pricing === "average" ? "short" : "long";
      const position = pricingStack.positionManager.openPosition(pricing, symbol, side, 0.01, 60_000, 10, 1);
      assertCondition(
        await pricingStack.portfolioManager.requestPositionClose(position, pricing),
        `${pricing} close did not settle`,
      );
      assertCondition(
        pricingStack.positionManager.getPositionCount() === 0,
        `${pricing} close retained position`,
      );
    } finally {
      await feed.close();
    }
  }

  const sequencedFeed = new SequencedFillFeed([1, 0], {});
  const sequencedStack = await makePortfolioStack({ feed: sequencedFeed });
  try {
    sequencedStack.positionManager.openPosition("closed", symbol, "long", 0.01, 60_000, 10, 1);
    sequencedStack.positionManager.openPosition("unresolved", symbol, "short", 0.01, 60_000, 10, 1);
    const report = await sequencedStack.portfolioManager.executeCloseAll();
    assertCondition(report.closed.includes("closed/BTC/USDC"), "mixed close report omitted closed position");
    assertCondition(
      report.unresolved.includes("unresolved/BTC/USDC/short"),
      "mixed close report omitted unresolved position",
    );
  } finally {
    await sequencedFeed.close();
  }
}

export { runPortfolioManagerPaper };
