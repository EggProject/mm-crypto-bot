/**
 * apps/bot/src/bot/index.ts
 *
 * A `apps/bot/src/bot` barrel — egységes belépési pont a Bot runtime
 * komponensekhez.
 *
 * A Bot CLI és a tesztek egyetlen import-tal hozzáférnek minden
 * nyilvános osztályhoz és típushoz.
 */

export { Bot } from "./bot.js";
export type { BotOptions } from "./bot.js";

export { OrderManager, OrderManagerError } from "./order-manager.js";
export type { OrderIntent, OrderType, OrderManagerOptions, PositionSizeQuery } from "./order-manager.js";

export { PositionManager, PositionManagerError } from "./position-manager.js";
export type {
  PositionSnapshot,
  PositionSide,
  PositionManagerOptions,
  PositionContext,
  FillEvent,
} from "./position-manager.js";

export { StateStore, StateStoreError, BotStateSchema } from "./state-store.js";
export type { BotState, ClosedTradeSnapshot, StateStoreOptions } from "./state-store.js";

export { Telemetry, computeDrawdownPct, formatUptime } from "./telemetry.js";
export type { TelemetrySnapshot, TelemetryOptions } from "./telemetry.js";

export {
  KillSwitchRegistry,
  MaxDrawdownKillSwitch,
  MaxPositionsKillSwitch,
  LatencyGateKillSwitch,
  PerStrategyKillSwitch,
  createDefaultRegistry,
} from "./kill-switches.js";
export type {
  KillSwitch,
  KillSwitchVerdict,
  KillSwitchSnapshot,
  KillSwitchCallback,
  KillSwitchRegistryOptions,
} from "./kill-switches.js";

export { StrategyRunner, defaultSizingFn } from "./strategy-runner.js";
export type { SizingFn, StrategyRunnerOptions, StrategyRunnerStats } from "./strategy-runner.js";
