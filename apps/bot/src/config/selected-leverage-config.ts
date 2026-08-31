import { SelectedLeverage } from "@mm-crypto-bot/numeric";
import { z } from "zod";

import type { BotConfig } from "./schema.js";

export const SelectedLeverageConfigSchema = z
  .string()
  .default("10")
  .transform((value, context) => {
    try {
      return SelectedLeverage.parse(value);
    } catch {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Selected leverage must be a canonical positive decimal string.",
      });
      return z.NEVER;
    }
  });

export type TomlSerializableBotConfig = Omit<BotConfig, "bot"> & {
  readonly bot: Omit<BotConfig["bot"], "selected_leverage"> & {
    readonly selected_leverage: string;
  };
};

export function canonicalSelectedLeverage(value: unknown): string {
  try {
    if (!(value instanceof SelectedLeverage)) {
      throw new TypeError("Selected leverage is not authentic.");
    }
    return value.canonical;
  } catch {
    throw new TypeError("Selected leverage must be an authentic selected leverage value.");
  }
}

export function toTomlSerializableBotConfig(config: BotConfig): TomlSerializableBotConfig {
  return {
    ...config,
    bot: {
      ...config.bot,
      selected_leverage: canonicalSelectedLeverage(config.bot.selected_leverage),
    },
  };
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function normalizeBotConfigForValidation(value: unknown): unknown {
  if (!isObjectRecord(value)) return value;

  try {
    const bot = Reflect.get(value, "bot");
    if (!isObjectRecord(bot)) return value;
    const selectedLeverage = Reflect.get(bot, "selected_leverage");
    if (selectedLeverage === undefined || typeof selectedLeverage === "string") return value;

    return {
      ...value,
      bot: {
        ...bot,
        selected_leverage: canonicalSelectedLeverage(selectedLeverage),
      },
    };
  } catch {
    throw new TypeError("Selected leverage configuration could not be safely read.");
  }
}
