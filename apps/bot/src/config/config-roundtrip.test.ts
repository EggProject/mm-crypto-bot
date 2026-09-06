import { describe, expect, it } from "bun:test";

import { BotConfigSchema } from "./schema.js";

function parseJson(input: string): unknown {
  return JSON.parse(input);
}

describe("selected leverage configuration round trip", () => {
  it("serializes and reparses canonical 10 without normalization", () => {
    const configured = BotConfigSchema.parse({ bot: { mode: "paper", selected_leverage: "10" } });
    const serialized = JSON.stringify(configured);
    const reparsed = BotConfigSchema.parse(parseJson(serialized));

    expect(serialized).toContain('"selected_leverage":"10"');
    expect(reparsed.bot.selected_leverage.canonical).toBe("10");
  });
});
