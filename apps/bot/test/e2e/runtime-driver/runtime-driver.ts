import { assertCondition, recordedOrders } from "./runtime-driver-core.js";
import { runBotCleanupFaults, runBotOrderRisk } from "./bot-cleanup-and-order-risk.js";
import { runBotLifecycleFactory } from "./bot-lifecycle-factory.js";
import { runBotLiveReconciliation, runBotRestoreTelemetry } from "./bot-state-and-telemetry.js";
import { runBotSubscriptions } from "./bot-subscriptions.js";
import { runCliBoundaries, runCliCommandBoundaries } from "./cli-boundaries.js";
import { runConfigStore } from "./config-store.js";
import { runFundingSource } from "./funding-source.js";
import { runLifecycleSmoke } from "./lifecycle-smoke.js";
import { runPortfolioManagerAuthoritative } from "./portfolio-manager-authoritative.js";
import { runPortfolioManagerLifecycle } from "./portfolio-manager-lifecycle.js";
import { runPortfolioManagerPaper } from "./portfolio-manager-paper.js";
import { runPortfolioPrimitives } from "./portfolio-primitives.js";
import { runRiskModules } from "./risk-modules.js";
import { getInstalledOutboundNetworkGuard } from "../../../../../scripts/coverage-tools/bot-runtime-network-guard.ts";

const caseId = process.argv[2];
const networkGuard = getInstalledOutboundNetworkGuard();

switch (caseId) {
  case "cli-boundaries": {
    runCliBoundaries();
    break;
  }
  case "cli-command-boundaries": {
    await runCliCommandBoundaries();
    break;
  }
  case "risk-modules": {
    runRiskModules();
    break;
  }
  case "config-store": {
    runConfigStore();
    break;
  }
  case "funding-source": {
    await runFundingSource();
    break;
  }
  case "portfolio-primitives": {
    await runPortfolioPrimitives();
    break;
  }
  case "portfolio-manager-paper": {
    await runPortfolioManagerPaper();
    break;
  }
  case "portfolio-manager-authoritative": {
    await runPortfolioManagerAuthoritative();
    break;
  }
  case "portfolio-manager-lifecycle": {
    await runPortfolioManagerLifecycle();
    break;
  }
  case "lifecycle-smoke": {
    await runLifecycleSmoke();
    break;
  }
  case "bot-lifecycle-factory": {
    await runBotLifecycleFactory();
    break;
  }
  case "bot-subscriptions": {
    await runBotSubscriptions();
    break;
  }
  case "bot-restore-telemetry": {
    await runBotRestoreTelemetry();
    break;
  }
  case "bot-live-reconciliation": {
    await runBotLiveReconciliation();
    break;
  }
  case "bot-order-risk": {
    await runBotOrderRisk();
    break;
  }
  case "bot-cleanup-faults": {
    await runBotCleanupFaults();
    break;
  }
  default: {
    throw new Error(`unknown runtime driver case: ${String(caseId)}`);
  }
}

const orderExerciseCases = new Set([
  "bot-order-risk",
  "portfolio-manager-paper",
  "portfolio-manager-authoritative",
  "portfolio-manager-lifecycle",
]);
if (orderExerciseCases.has(caseId)) {
  assertCondition(recordedOrders().length > 0, `${caseId} did not exercise the injected placeOrder boundary`);
} else {
  assertCondition(recordedOrders().length === 0, `${caseId} unexpectedly exercised placeOrder`);
}
networkGuard.assertNoAttempts();
