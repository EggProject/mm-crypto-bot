import { expect, it } from "bun:test";
import { tmpdir } from "node:os";
import path from "node:path";

import { BotConfigSchema } from "./schema.js";
import { ConfigStore } from "./store.js";

it("detects a non-leverage TOML round-trip mismatch", () => {
  const store = new ConfigStore(
    path.join(tmpdir(), "mm-selected-leverage-generic-round-trip-mismatch.toml"),
    {
      parse: () => ({ bot: { selected_leverage: "2.5" }, risk: { max_positions: 4 } }),
    },
  );
  const config = BotConfigSchema.parse({ bot: { selected_leverage: "2.5" } });

  expect(() => {
    store.write(config);
  }).toThrow("<round-trip>");
});

it("detects a selected leverage TOML round-trip mismatch", () => {
  const store = new ConfigStore(path.join(tmpdir(), "mm-selected-leverage-round-trip-mismatch.toml"), {
    parse: () => ({ bot: { selected_leverage: "3" } }),
  });
  const config = BotConfigSchema.parse({ bot: { selected_leverage: "2.5" } });

  expect(() => {
    store.write(config);
  }).toThrow("bot.selected_leverage");
});
