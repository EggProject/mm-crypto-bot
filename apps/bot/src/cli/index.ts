/**
 * apps/bot/src/cli/index.ts
 *
 * Phase 33 Track D — barrel a CLI komponensekhez.
 *
 * Az `apps/bot/src/index.ts` a CliRouter-t + az egyes subcommand
 * handler-eket ezen a barrel-en keresztül éri el.
 */

export { parseArgv, type ParsedArgs } from "./argv.js";
export { CliRouter, type CliContext, type SubcommandHandler } from "./router.js";

export { startCommand } from "./commands/start.js";
export { statusCommand } from "./commands/status.js";
export { configCommand } from "./commands/config.js";
export { strategiesCommand } from "./commands/strategies.js";
export { tradesCommand } from "./commands/trades.js";
export { killSwitchesCommand } from "./commands/kill-switches.js";
export { makeHelpCommand } from "./commands/help.js";
