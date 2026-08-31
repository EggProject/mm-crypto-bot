import { DEFAULT_BOT_CONFIG as defaultBotConfig } from "../../config/defaults.js";
import type { BotConfig } from "../../config/schema.js";
import type { ParsedArgs as ParsedArguments } from "../argv.js";
import type { CliContext } from "../router.js";

export { DEFAULT_BOT_CONFIG } from "../../config/defaults.js";
export const CLI_CONTEXT: CliContext = { config: defaultBotConfig };

export function configWithStateFile(stateFile: string): BotConfig {
  return {
    ...defaultBotConfig,
    bot: { ...defaultBotConfig.bot, state_file: stateFile },
  };
}

export function parsedArguments(
  flags: ReadonlyMap<string, string | boolean> = new Map(),
  positional: readonly string[] = [],
): ParsedArguments {
  return { subcommand: "start", flags, positional };
}

export function rejectWith(reason: unknown): Promise<never> {
  return new Promise<never>((_resolve, reject) => {
    const rejectReason: (value: unknown) => void = reject;
    rejectReason(reason);
  });
}

export async function waitUntil(isConditionMet: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!isConditionMet()) {
    if (Date.now() >= deadline) throw new Error("timed out waiting for test condition");
    await Bun.sleep(5);
  }
}
