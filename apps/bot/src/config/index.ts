/**
 * apps/bot/src/config/index.ts
 *
 * A `apps/bot/src/config` barrel — egységes belépési pont a config
 * rendszer komponenseihez.
 *
 * Az apps/bot fogyasztói (CLI, runtime) egyetlen import-tal hozzáférnek
 * az összes config-típushoz és függvényhez:
 *   import { loadBotConfig, createStrategyInstances, ... } from "./config";
 */

export {
  BotConfigSchema,
  StrategySectionSchema,
  type BotConfig,
  type BotConfigKey,
  type StrategyName,
  type StrategySection,
} from "./schema.js";

export { DEFAULT_BOT_CONFIG } from "./defaults.js";

export {
  ConfigError,
  loadBotConfig,
} from "./loader.js";

export {
  createStrategyInstances,
  type BotDependencies,
  type BotStrategyInstance,
} from "./strategy-registry.js";
