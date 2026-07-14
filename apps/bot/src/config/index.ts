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

// Phase 36 Track C1 — ConfigStore: a TUI settings panel és a
// `mm-bot config edit` parancs atomic, auditált read/write API-ja.
export {
  ConfigLiveConfirmError,
  ConfigReadError,
  ConfigStore,
  ConfigValidationError,
  getConfigStore,
  resetConfigStoreCache,
  type LiveModeAuditEntry,
} from "./store.js";
