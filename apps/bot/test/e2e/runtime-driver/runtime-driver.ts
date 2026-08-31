import { assertCondition, placeOrderLedger } from "./runtime-driver-core.js";
import { runBotCleanupFaults, runBotOrderRisk } from "./bot-cleanup-and-order-risk.js";
import { runBotLifecycleFactory } from "./bot-lifecycle-factory.js";
import { runBotRestoreTelemetry, runBotLiveReconciliation } from "./bot-state-and-telemetry.js";
import { runBotSubscriptions } from "./bot-subscriptions.js";
import { runCliBoundaries } from "./cli-boundaries.js";
import { runCliCommandBoundaries } from "./cli-boundaries-config.js";
import { runConfigStore } from "./config-store.js";
import { runFundingSource } from "./funding-source.js";
import { runKillSwitchCommands } from "./kill-switch-commands.js";
import { runKillSwitchRegistry } from "./kill-switch-registry.js";
import { runLifecycleSmoke } from "./lifecycle-smoke.js";
import { runPortfolioManagerAuthoritative } from "./portfolio-manager-authoritative.js";
import { runPortfolioManagerLifecycle } from "./portfolio-manager-lifecycle.js";
import { runPortfolioManagerPaper } from "./portfolio-manager-paper.js";
import { runPortfolioPrimitives } from "./portfolio-primitives.js";
import { runRiskModules } from "./risk-modules.js";
import { runStrategyRunnerProtections } from "./strategy-runner-protections.js";
import { runStrategyRunnerMarketLifecycle } from "./strategy-runner-market-lifecycle.js";
import { runStrategyRunnerOrderFlow } from "./strategy-runner-order-flow.js";
import { runStrategyRunnerRiskLifecycle } from "./strategy-runner-risk-lifecycle.js";
import { runStrategyRegistryBoundaries } from "./strategy-registry-boundaries.js";
import { runPositionManagerBoundaries } from "./position-manager-boundaries.js";
import { runStateStoreBoundaries } from "./state-store-boundaries.js";
import { runStrategyRunnerPluginRisk } from "./strategy-runner-plugin-risk.js";
import { runStrategyRunnerPluginRiskCoverage } from "./strategy-runner-plugin-risk-coverage.js";
import { runStrategyRunnerPluginRiskCoverageLifecycle } from "./strategy-runner-plugin-risk-coverage-lifecycle.js";
import { runOrderManagerBoundaries } from "./order-manager-boundaries.js";
import { runNativeProtectionRetry } from "./native-protection-retry.js";
import { runNativeProtectionFailsafe } from "./native-protection-failsafe.js";
import { runStrategyRunnerFacadeCoverage } from "./strategy-runner-facade-coverage.js";
import { runStrategyRunnerOrderLifecycleBoundaries } from "./strategy-runner-order-lifecycle-boundaries.js";
import { getInstalledOutboundNetworkGuard } from "../../../../../scripts/coverage-tools/bot-runtime-network-guard.js";

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
  case "kill-switch-commands": {
    await runKillSwitchCommands();
    break;
  }
  case "kill-switch-registry": {
    await runKillSwitchRegistry();
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
  case "strategy-runner-protections": {
    await runStrategyRunnerProtections();
    break;
  }
  case "strategy-runner-market-lifecycle": {
    await runStrategyRunnerMarketLifecycle();
    break;
  }
  case "strategy-runner-order-flow": {
    await runStrategyRunnerOrderFlow();
    break;
  }
  case "strategy-runner-risk-lifecycle": {
    await runStrategyRunnerRiskLifecycle();
    break;
  }
  case "strategy-registry-boundaries": {
    runStrategyRegistryBoundaries();
    break;
  }
  case "position-manager-boundaries": {
    runPositionManagerBoundaries();
    break;
  }
  case "state-store-boundaries": {
    await runStateStoreBoundaries();
    break;
  }
  case "strategy-runner-plugin-risk": {
    await runStrategyRunnerPluginRisk();
    break;
  }
  case "strategy-runner-plugin-risk-coverage": {
    await runStrategyRunnerPluginRiskCoverage();
    break;
  }
  case "strategy-runner-plugin-risk-coverage-lifecycle": {
    await runStrategyRunnerPluginRiskCoverageLifecycle();
    break;
  }
  case "order-manager-boundaries": {
    await runOrderManagerBoundaries();
    break;
  }
  case "native-protection-retry": {
    await runNativeProtectionRetry();
    break;
  }
  case "native-protection-failsafe": {
    await runNativeProtectionFailsafe();
    break;
  }
  case "strategy-runner-facade-coverage": {
    await runStrategyRunnerFacadeCoverage();
    break;
  }
  case "strategy-runner-order-lifecycle-boundaries": {
    await runStrategyRunnerOrderLifecycleBoundaries();
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
  "strategy-runner-protections",
  "native-protection-failsafe",
  "strategy-runner-order-lifecycle-boundaries",
]);
if (orderExerciseCases.has(caseId)) {
  assertCondition(placeOrderLedger.length > 0, `${caseId} did not exercise the injected placeOrder boundary`);
} else {
  assertCondition(placeOrderLedger.length === 0, `${caseId} unexpectedly exercised placeOrder`);
}
networkGuard.assertNoAttempts();
