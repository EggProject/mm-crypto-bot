/**
 * apps/bot/src/cli/commands/help.ts
 *
 * Phase 33 Track D — `mm-bot help` subcommand.
 *
 * Prints the global help table. Equivalent to running with no subcommand
 * (which also prints help), but explicit.
 *
 * Returns 1 (no work was done — same as the no-subcommand path).
 */

import type { CliContext, CliRouter, SubcommandHandler } from "../router.js";

/**
 * `helpCommand` — the `mm-bot help` handler.
 *
 * The router reference is reachable via the closure in `index.ts`, but
 * we don't need it here — the router has already set up `printHelp` for
 * the global help. We just call it.
 *
 * To avoid a circular dep, we accept the router as a closure-bound
 * argument. The `index.ts` wires:
 *   router.register("help", "Show help", (args, ctx) => helpCommand(args, ctx, router));
 */
export function makeHelpCommand(router: CliRouter): SubcommandHandler {
  return async (_args, _ctx: CliContext) => {
    await Promise.resolve();
    router.printHelp("");
    return 1;
  };
}
