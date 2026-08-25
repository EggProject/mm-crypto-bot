import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { DEFAULT_BOT_CONFIG } from "../../../src/config/defaults.js";
import type { BotConfig } from "../../../src/config/schema.js";
import { ConfigStore, getConfigStore, resetConfigStoreCache } from "../../../src/config/store.js";

import { assertCondition, expectFailure } from "./runtime-driver-core.js";

const join = (...pathSegments: string[]): string => path.join(...pathSegments);

function throwBoundaryFailure(failure: unknown): never {
  throw failure;
}

function exerciseConfigStoreFaults(directory: string): void {
  const path = join(directory, "fault.toml");
  expectFailure(
    () =>
      new ConfigStore(path, {
        readText: () => {
          throw new Error("read Error");
        },
      }).read(),
    "ConfigStore Error read",
  );
  expectFailure(
    () =>
      new ConfigStore(path, {
        readText: () => {
          return throwBoundaryFailure("read rejection");
        },
      }).read(),
    "ConfigStore non-Error read",
  );
  expectFailure(
    () =>
      new ConfigStore(path, {
        readText: () => "ignored",
        parse: () => {
          return throwBoundaryFailure("parse rejection");
        },
      }).read(),
    "ConfigStore non-Error parse",
  );
  expectFailure(() => {
    new ConfigStore(path, {
      parse: () => {
        throw new Error("round-trip Error");
      },
    }).write(DEFAULT_BOT_CONFIG);
  }, "ConfigStore round-trip Error");
  expectFailure(() => {
    new ConfigStore(path, {
      parse: () => {
        return throwBoundaryFailure("round-trip rejection");
      },
    }).write(DEFAULT_BOT_CONFIG);
  }, "ConfigStore round-trip non-Error");
  expectFailure(() => {
    // eslint-disable-next-line unicorn/no-null -- This test verifies rejection of a null parse result.
    new ConfigStore(path, { parse: () => null }).write(DEFAULT_BOT_CONFIG);
  }, "ConfigStore round-trip validation");
  expectFailure(() => {
    new ConfigStore(path, {
      atomicWrite: () => {
        throw new Error("atomic Error");
      },
    }).write(DEFAULT_BOT_CONFIG);
  }, "ConfigStore atomic Error");
  expectFailure(() => {
    new ConfigStore(path, {
      atomicWrite: () => {
        return throwBoundaryFailure("atomic rejection");
      },
    }).write(DEFAULT_BOT_CONFIG);
  }, "ConfigStore atomic non-Error");

  const liveConfig: BotConfig = {
    ...DEFAULT_BOT_CONFIG,
    bot: { ...DEFAULT_BOT_CONFIG.bot, mode: "live" },
  };
  expectFailure(
    () =>
      new ConfigStore(path, {
        appendText: () => {
          throw new Error("audit Error");
        },
      }).writeAfterTypedLive(liveConfig, "LIVE", "paper"),
    "ConfigStore audit Error",
  );
  expectFailure(
    () =>
      new ConfigStore(path, {
        appendText: () => {
          return throwBoundaryFailure("audit rejection");
        },
      }).writeAfterTypedLive(liveConfig, "LIVE", "paper"),
    "ConfigStore audit non-Error",
  );
}

export function runConfigStore(): void {
  const directory = mkdtempSync(join(tmpdir(), "mm-bot-coverage-store-"));
  try {
    const emptyPath = join(directory, "empty.toml");
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- The path is derived from this case's fresh mkdtemp directory.
    writeFileSync(emptyPath, "", "utf8");
    const emptyStore = new ConfigStore(emptyPath);
    assertCondition(emptyStore.read().bot.mode === "paper", "empty config did not apply defaults");
    expectFailure(() => new ConfigStore(join(directory, "missing.toml")).read(), "missing config read");

    const malformedPath = join(directory, "malformed.toml");
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- The path is derived from this case's fresh mkdtemp directory.
    writeFileSync(malformedPath, "not [ valid TOML", "utf8");
    expectFailure(() => new ConfigStore(malformedPath).read(), "malformed TOML read");
    const invalidPath = join(directory, "invalid.toml");
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- The path is derived from this case's fresh mkdtemp directory.
    writeFileSync(invalidPath, "[risk]\nmax_leverage = 15\n", "utf8");
    expectFailure(() => new ConfigStore(invalidPath).read(), "invalid config read");

    emptyStore.validate(DEFAULT_BOT_CONFIG);
    // eslint-disable-next-line unicorn/no-null -- This test verifies rejection of a null root config.
    expectFailure(() => emptyStore.validate(null), "root config validation");
    expectFailure(() => emptyStore.validate({ risk: { max_leverage: 15 } }), "field config validation");

    const configPath = join(directory, "nested", "mm-bot.toml");
    const store = new ConfigStore(configPath);
    store.write(DEFAULT_BOT_CONFIG);
    store.write({ ...DEFAULT_BOT_CONFIG, risk: { ...DEFAULT_BOT_CONFIG.risk, risk_per_trade: 0.02 } });
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- The path is derived from this case's fresh mkdtemp directory.
    assertCondition(existsSync(`${configPath}.bak`), "ConfigStore did not create a backup");
    assertCondition(
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- The path is derived from this case's fresh mkdtemp directory.
      readFileSync(`${configPath}.bak`, "utf8").includes("risk_per_trade = 0.01"),
      "ConfigStore backup did not preserve the previous config",
    );

    const liveConfig: BotConfig = { ...DEFAULT_BOT_CONFIG, bot: { ...DEFAULT_BOT_CONFIG.bot, mode: "live" } };
    expectFailure(
      () => store.writeAfterTypedLive(liveConfig, "live", "paper"),
      "lowercase LIVE confirmation",
    );
    store.writeAfterTypedLive(liveConfig, "LIVE", "paper");
    store.writeAfterTypedLive(liveConfig, "LIVE", "live");
    assertCondition(
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- The path is derived from this case's fresh mkdtemp directory.
      readFileSync(`${configPath}.audit.log`, "utf8").trim().split("\n").length === 2,
      "ConfigStore audit log entry count mismatch",
    );

    store.setStrategyEnabled("regime_detector", true);
    store.setStrategySetting("donchian_pivot_composition", "cap", 0.4);
    store.setStrategySetting("dydx_cex_carry", "notional_per_leg_usd", 250_000);
    expectFailure(() => {
      store.setStrategySetting("dydx_cex_carry", "leverage", "five");
    }, "invalid strategy setting");
    store.setExchangeConfig({ slippage_pct: 0.1, fee_tier: "vip" });
    store.setSymbols(["BTC/USDC", "ETH/USDC"]);
    store.setSymbols([]);
    store.setTelemetryConfig({
      log_level: "debug",
      log_destination: "file",
      metrics_enabled: false,
      heartbeat_interval_sec: 60,
    });
    assertCondition(store.read().telemetry.log_level === "debug", "ConfigStore setter result mismatch");

    resetConfigStoreCache();
    const cachedDefault = getConfigStore();
    assertCondition(cachedDefault === getConfigStore(), "default ConfigStore was not cached");
    const cachedExplicit = getConfigStore(configPath);
    assertCondition(cachedExplicit === getConfigStore(configPath), "explicit ConfigStore was not cached");
    resetConfigStoreCache();
    assertCondition(cachedExplicit !== getConfigStore(configPath), "ConfigStore cache did not reset");
    exerciseConfigStoreFaults(directory);
  } finally {
    resetConfigStoreCache();
    rmSync(directory, { recursive: true, force: true });
  }
}
