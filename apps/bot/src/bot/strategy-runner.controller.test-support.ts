import { RecordingLogger } from "@logging-testing";

import { StrategyNativeProtectionController } from "./strategy-runner-native-protection-controller.js";
import { StrategyPluginRiskController } from "./strategy-runner-plugin-risk-controller.js";
import type { OrderManager } from "./order-manager.js";
import type { PositionManager } from "./position-manager.js";
import type { NativeProtectionInput } from "./strategy-runner.types.js";
import type { StrategyName } from "../config/schema.js";
import type { ClientOrderId, Symbol as ExchangeSymbol } from "@mm-crypto-bot/exchange";
import type { PortfolioManager } from "../portfolio/portfolio-manager.js";
import type { RiskManager } from "../risk/risk-manager.js";

const unavailable = undefined;

function noOperation(): void {
  return;
}

function absentRiskManager(): RiskManager | undefined {
  return unavailable;
}

function absentPortfolioManager(): PortfolioManager | undefined {
  return unavailable;
}

function absentEmergencyHandler(): ((reason: string) => void | Promise<void>) | undefined {
  return unavailable;
}

function absentLatestPrice(): number | undefined {
  return unavailable;
}

function nativeProtectionKey(strategy: string, symbol: ExchangeSymbol): string {
  return `${strategy}:${symbol}`;
}

export async function requestTrailingStopClose(
  dependencies: { readonly orderManager: OrderManager; readonly positionManager: PositionManager },
  positionId: string,
  closePrice: number,
  reason: string,
): Promise<void> {
  const controller = new StrategyPluginRiskController({
    instances: new Map(),
    orderManager: dependencies.orderManager,
    positionManager: dependencies.positionManager,
    enabledSymbols: new Set(),
    logger: new RecordingLogger(),
    isOrderEmissionBlocked: () => false,
    pause: noOperation,
    getRiskManager: absentRiskManager,
    getPortfolioManager: absentPortfolioManager,
    getOnEmergency: absentEmergencyHandler,
    latestPriceFor: absentLatestPrice,
    notifyStrategyClosed: noOperation,
  });
  await controller.requestTrailingStopClose(positionId, closePrice, reason);
}

export function createNativeProtectionHarness(
  orderManager: OrderManager,
  positionManager: PositionManager,
): {
  readonly install: (input: NativeProtectionInput) => Promise<void>;
  readonly settleTerminal: (
    strategy: StrategyName,
    symbol: ExchangeSymbol,
    orderId: ClientOrderId,
  ) => Promise<void>;
} {
  const controller = new StrategyNativeProtectionController({
    orderManager,
    positionManager,
    portfolioManager: undefined,
    logger: new RecordingLogger(),
    findOpenPosition: (strategy, symbol) =>
      positionManager
        .getPositions()
        .find((position) => position.strategy === strategy && position.symbol === symbol),
    protectionKey: nativeProtectionKey,
    latestPriceFor: absentLatestPrice,
    recordPendingRiskClose: noOperation,
    setPaperProtection: noOperation,
  });
  return {
    install: async (input) => controller.installProtections(input),
    settleTerminal: async (strategy, symbol, orderId) => {
      const group = controller.getGroup(nativeProtectionKey(strategy, symbol));
      if (group === undefined) return;
      controller.retireProtectionLeg(group, orderId);
      await controller.settleProtectionGroup(group);
    },
  };
}
