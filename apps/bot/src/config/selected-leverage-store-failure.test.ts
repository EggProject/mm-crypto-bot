import { expect, it } from "bun:test";
import { tmpdir } from "node:os";
import path from "node:path";

import { normalizeBotConfigForValidation } from "./selected-leverage-config.js";
import { BotConfigSchema } from "./schema.js";
import { ConfigStore } from "./store.js";

function selectedLeverageConfig(mode: "paper" | "live" = "paper") {
  return BotConfigSchema.parse({ bot: { mode, selected_leverage: "10" } });
}

function throwInjectedFailure(failure: unknown): never {
  throw failure;
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

  expect(() => store.writeAfterTypedLive(selectedLeverageConfig("live"), "LIVE")).toThrow(
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

it("wraps a non-Error raised while appending a live-mode audit record", () => {
  const configPath = path.join(tmpdir(), "mm-selected-leverage-audit-non-error.toml");
  const store = new ConfigStore(configPath, {
    readText: () => '[bot]\nmode = "paper"\n',
    appendText: () => {
      throwInjectedFailure("audit non-Error failure");
    },
  });

  expect(() => store.writeAfterTypedLive(selectedLeverageConfig("live"), "LIVE")).toThrow(
    `ConfigStore.writeAfterTypedLive: failed to write audit log ${configPath}.audit.log: audit non-Error failure`,
  );
});

it("wraps a non-Error raised while reading a config", () => {
  const configPath = path.join(tmpdir(), "mm-selected-leverage-read-non-error.toml");
  const store = new ConfigStore(configPath, {
    readText: () => {
      throwInjectedFailure("read non-Error failure");
    },
  });

  expect(() => store.read()).toThrow(`Failed to read config file at "${configPath}": read non-Error failure`);
});

it("wraps a non-Error raised while parsing a serialized config", () => {
  const store = new ConfigStore(path.join(tmpdir(), "mm-selected-leverage-round-trip-non-error.toml"), {
    parse: () => {
      throwInjectedFailure("round-trip non-Error failure");
    },
  });

  expect(() => {
    store.write(selectedLeverageConfig());
  }).toThrow("ConfigStore.write: round-trip parse failed (smol-toml bug?): round-trip non-Error failure");
});

it("wraps a non-Error raised while atomically writing a config", () => {
  const configPath = path.join(tmpdir(), "mm-selected-leverage-atomic-non-error.toml");
  const store = new ConfigStore(configPath, {
    atomicWrite: () => {
      throwInjectedFailure("atomic non-Error failure");
    },
  });

  expect(() => {
    store.write(selectedLeverageConfig());
  }).toThrow(`ConfigStore.write: failed to write ${configPath}: atomic non-Error failure`);
});
