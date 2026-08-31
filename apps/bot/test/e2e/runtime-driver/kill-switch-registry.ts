import { asSymbol } from "@mm-crypto-bot/exchange";

import {
  _rebrandSymbolString,
  createDefaultRegistry,
  KillSwitchRegistry,
  LatencyGateKillSwitch,
  MaxDrawdownKillSwitch,
  MaxPositionsKillSwitch,
  PerStrategyKillSwitch,
} from "../../../src/bot/kill-switches.js";
import { PositionManager } from "../../../src/bot/position-manager.js";

import { assertCondition, RecordingLogger } from "./runtime-driver-core.js";

function createPositionManager(maxPositions = 3): PositionManager {
  return new PositionManager({
    initialEquityUsd: 10_000,
    maxPositions,
    maxLeverage: 10,
    logger: new RecordingLogger(),
  });
}

function restorePosition(manager: PositionManager, strategy: string, symbol: string): void {
  manager.restorePosition({
    strategy,
    symbol: asSymbol(symbol),
    side: "long",
    quantity: 0.01,
    entryPrice: 100,
    currentPrice: 100,
    leverage: 1,
    unrealizedPnl: 0,
    realizedPnl: 0,
    openedAt: 1,
    notionalUsd: 1,
  });
}

function callbackCount(state: Readonly<{ readonly count: number }>): number {
  return state.count;
}

async function exerciseRegistry(): Promise<void> {
  const drawdownWithoutPeak = new MaxDrawdownKillSwitch({ maxDrawdownPct: 0.15, initialEquity: 0 });
  assertCondition(!drawdownWithoutPeak.evaluate().engaged, "zero peak must remain clear");
  const drawdown = new MaxDrawdownKillSwitch({ maxDrawdownPct: 0.15, initialEquity: 10_000 });
  drawdown.updateEquity(12_000);
  drawdown.updateEquity(10_200);
  assertCondition(drawdown.evaluate().engaged, "peak-following drawdown must engage");
  drawdown.updateEquity(12_000);
  assertCondition(!drawdown.evaluate().engaged, "recovered drawdown must clear");

  const positions = createPositionManager(1);
  const maxPositions = new MaxPositionsKillSwitch({ positionManager: positions, softCapFraction: 1 });
  assertCondition(maxPositions.evaluate().reason.includes("< max"), "empty positions must be below cap");
  restorePosition(positions, "donchian_pivot_composition", "BTC/USDC");
  assertCondition(maxPositions.evaluate().reason.includes("approaching"), "cap equality must only warn");
  restorePosition(positions, "dydx_cex_carry", "ETH/USDC");
  assertCondition(maxPositions.evaluate().engaged, "exceeded position cap must engage");

  const allowedLatency = new LatencyGateKillSwitch({
    gate: { isCarryAllowed: () => true, arbThresholdMs: 500 },
  });
  const blockedLatency = new LatencyGateKillSwitch({
    gate: { isCarryAllowed: () => false, arbThresholdMs: 500 },
  });
  const disabledLatency = new LatencyGateKillSwitch({
    gate: { isCarryAllowed: () => false, arbThresholdMs: Infinity },
  });
  assertCondition(!allowedLatency.evaluate().engaged, "allowed latency must clear");
  assertCondition(blockedLatency.evaluate().engaged, "blocked latency must engage");
  assertCondition(!disabledLatency.evaluate().engaged, "disabled latency must clear");

  let isStrategyEngaged = false;
  const defaultStrategySwitch = new PerStrategyKillSwitch({
    id: "strategy-default",
    description: "default strategy switch",
    engaged: () => isStrategyEngaged,
  });
  const customStrategySwitch = new PerStrategyKillSwitch({
    id: "strategy-custom",
    description: "custom strategy switch",
    engaged: () => true,
    reason: () => "custom reason",
  });
  assertCondition(
    defaultStrategySwitch.evaluate().reason.includes("clear"),
    "clear strategy reason mismatch",
  );
  isStrategyEngaged = true;
  assertCondition(
    defaultStrategySwitch.evaluate().reason.includes("engaged"),
    "default strategy reason mismatch",
  );
  assertCondition(
    customStrategySwitch.evaluate().reason === "custom reason",
    "custom strategy reason mismatch",
  );

  const logger = new RecordingLogger();
  const registry = new KillSwitchRegistry({ switches: [drawdown, customStrategySwitch], logger });
  const callbackState = { count: 0 };
  registry.onTrigger(() => {
    callbackState.count += 1;
  });
  registry.onTrigger(() => {
    throw new Error("scripted callback failure");
  });
  registry.onTrigger(() => {
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- E2E fault injection verifies non-Error callback normalization.
    throw "scripted callback string failure";
  });
  registry.updateEquity(NaN);
  registry.updateEquity(-1);
  registry.updateEquity(12_000);
  const first = registry.evaluate();
  await Bun.sleep(0);
  registry.evaluate();
  assertCondition(first.engaged && first.reasons.length > 0, "registry must aggregate engagement");
  assertCondition(callbackState.count === 1, "registry must trigger callbacks exactly once");
  assertCondition(
    logger.entries.filter((entry) => entry.message === "risk.killswitch.callback.failed").length === 2,
    "callback failure must be logged",
  );
  assertCondition(
    logger.entries.filter((entry) => entry.message === "risk.killswitch.equity.invalid").length === 2,
    "invalid equity must log",
  );
  registry.reset();
  registry.evaluate();
  await Bun.sleep(0);
  assertCondition(callbackCount(callbackState) === 2, "reset must permit a new trigger");
  assertCondition(registry.getSnapshot().engaged, "registry snapshot must persist latest result");
  assertCondition(
    registry.getSwitchIds().join(",") === "max-drawdown,strategy-custom",
    "switch IDs mismatch",
  );

  const defaults = createDefaultRegistry({
    positionManager: createPositionManager(),
    maxDrawdownPct: 0.15,
    maxPositions: 3,
    latencyGate: { isCarryAllowed: () => true, arbThresholdMs: 500 },
    perStrategyKillSwitches: [defaultStrategySwitch],
    logger: new RecordingLogger(),
  });
  assertCondition(defaults.getSwitchIds().length === 4, "default registry must add optional switches");
  const defaultsWithoutOptionalSwitches = createDefaultRegistry({
    positionManager: createPositionManager(),
    maxDrawdownPct: 0.15,
    maxPositions: 3,
    logger: new RecordingLogger(),
  });
  assertCondition(
    defaultsWithoutOptionalSwitches.getSwitchIds().length === 2,
    "default registry must omit absent optional switches",
  );
  assertCondition(_rebrandSymbolString("BTC/USDC") === asSymbol("BTC/USDC"), "symbol rebrand mismatch");
}

export async function runKillSwitchRegistry(): Promise<void> {
  await exerciseRegistry();
}
