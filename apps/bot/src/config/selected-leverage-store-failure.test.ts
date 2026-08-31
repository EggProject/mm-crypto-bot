import { expect, it } from "bun:test";
import { tmpdir } from "node:os";
import path from "node:path";

import { normalizeBotConfigForValidation } from "./selected-leverage-config.js";
import { BotConfigSchema } from "./schema.js";
import { ConfigStore } from "./store.js";

function selectedLeverageConfig(mode: "paper" | "live" = "paper") {
  return BotConfigSchema.parse({ bot: { mode, selected_leverage: "2.5" } });
}

it("leaves a config without a bot section for schema validation", () => {
  const raw = { risk: { max_positions: 4 } };

  expect(normalizeBotConfigForValidation(raw)).toBe(raw);
});

it("wraps an Error raised while appending a live-mode audit record", () => {
  const store = new ConfigStore(path.join(tmpdir(), "mm-selected-leverage-audit-write.toml"), {
    readText: () => '[bot]\nmode = "paper"\n',
    appendText: () => {
      throw new Error("audit write failure");
    },
  });

  expect(() => store.writeAfterTypedLive(selectedLeverageConfig("live"), "LIVE", "paper")).toThrow(
    "audit write failure",
  );
});

it("wraps an Error raised while parsing a serialized config", () => {
  const store = new ConfigStore(path.join(tmpdir(), "mm-selected-leverage-round-trip-parse.toml"), {
    parse: () => {
      throw new Error("round-trip parse failure");
    },
  });

  expect(() => {
    store.write(selectedLeverageConfig());
  }).toThrow("round-trip parse failure");
});

it("wraps an Error raised while atomically writing a config", () => {
  const store = new ConfigStore(path.join(tmpdir(), "mm-selected-leverage-atomic-write.toml"), {
    atomicWrite: () => {
      throw new Error("atomic write failure");
    },
  });

  expect(() => {
    store.write(selectedLeverageConfig());
  }).toThrow("atomic write failure");
});
