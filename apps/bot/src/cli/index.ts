/**
 * apps/bot/src/cli/index.ts
 *
 * Phase 33 Track D + Phase 34 Track C — barrel a CLI komponensekhez.
 *
 * Az `apps/bot/src/index.ts` a CliRouter-t + az egyes subcommand
 * handler-eket ezen a barrel-en keresztül éri el.
 *
 * A Phase 34 Track C újdonsága a `color` modul exportja: a `setColorForced`
 * setter az entry-point-ból hívódik (a `--no-color` / `--color` flag-ek
 * korai feldolgozásához), a `colorize` / `isColorEnabled` / `ok` / `fail` /
 * `warn` / `dim` helper-eket pedig a subcommand-ok használják a kimenet
 * színezéséhez.
 */

export { parseArgv, type ParsedArgs } from "./argv.js";
export { CliRouter, type CliContext, type SubcommandHandler } from "./router.js";

export {
  colorize,
  isColorEnabled,
  setColorForced,
  ok,
  fail,
  warn,
  dim,
  type ColorName,
} from "./color.js";

export { startCommand } from "./commands/start.js";
export { tuiCommand } from "./commands/tui.js";
export { statusCommand } from "./commands/status.js";
export { configCommand } from "./commands/config.js";
export { strategiesCommand } from "./commands/strategies.js";
export { tradesCommand } from "./commands/trades.js";
export { killSwitchesCommand } from "./commands/kill-switches.js";
export { makeHelpCommand } from "./commands/help.js";
