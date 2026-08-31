import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DEFAULT_BOT_CONFIG } from "../../../src/config/defaults.js";
import type { BotConfig } from "../../../src/config/schema.js";
import { ConfigStore, getConfigStore, resetConfigStoreCache } from "../../../src/config/store.js";

import { assertCondition, expectFailure } from "./runtime-driver-core.js";

function isAuditRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function captureAuditRecord(
  records: Record<string, unknown>[],
): (_auditPath: string, contents: string) => void {
  return (_auditPath, contents) => {
    const parsed: unknown = JSON.parse(contents);
    if (!isAuditRecord(parsed)) throw new Error("expected a JSON object audit record");
    records.push(parsed);
  };
}

function exerciseConfigStoreFaults(directory: string): void {
  const stateFilePath = path.join(directory, "fault.toml");
  new ConfigStore(stateFilePath).write(DEFAULT_BOT_CONFIG);
  expectFailure(
    () =>
      new ConfigStore(stateFilePath, {
        readText: () => {
          throw new Error("read Error");
        },
      }).read(),
    "ConfigStore Error read",
  );
  expectFailure(() => {
    new ConfigStore(stateFilePath, {
      parse: () => {
        throw new Error("round-trip Error");
      },
    }).write(DEFAULT_BOT_CONFIG);
  }, "ConfigStore round-trip Error");
  expectFailure(() => {
    // eslint-disable-next-line unicorn/no-null -- The E2E boundary preserves the explicit null contract under test.
    new ConfigStore(stateFilePath, { parse: () => null }).write(DEFAULT_BOT_CONFIG);
  }, "ConfigStore round-trip validation");
  expectFailure(() => {
    new ConfigStore(stateFilePath, {
      atomicWrite: () => {
        throw new Error("atomic Error");
      },
    }).write(DEFAULT_BOT_CONFIG);
  }, "ConfigStore atomic Error");

  const liveConfig: BotConfig = {
    ...DEFAULT_BOT_CONFIG,
    bot: { ...DEFAULT_BOT_CONFIG.bot, mode: "live" },
  };
  expectFailure(
    () =>
      new ConfigStore(stateFilePath, {
        appendText: () => {
          throw new Error("audit Error");
        },
      }).writeAfterTypedLive(liveConfig, "LIVE"),
    "ConfigStore audit Error",
  );
}

function runConfigStore(): void {
  const directory = mkdtempSync(path.join(tmpdir(), "mm-bot-coverage-store-"));
  try {
    const emptyPath = path.join(directory, "empty.toml");
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- The E2E path is created beneath this process fresh temporary directory.
    writeFileSync(emptyPath, "", "utf8");
    const emptyStore = new ConfigStore(emptyPath);
    assertCondition(emptyStore.read().bot.mode === "paper", "empty config did not apply defaults");
    expectFailure(() => new ConfigStore(path.join(directory, "missing.toml")).read(), "missing config read");

    const malformedPath = path.join(directory, "malformed.toml");
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- The E2E path is created beneath this process fresh temporary directory.
    writeFileSync(malformedPath, "not [ valid TOML", "utf8");
    expectFailure(() => new ConfigStore(malformedPath).read(), "malformed TOML read");
    const invalidPath = path.join(directory, "invalid.toml");
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- The E2E path is created beneath this process fresh temporary directory.
    writeFileSync(invalidPath, "[risk]\nmax_leverage = 15\n", "utf8");
    expectFailure(() => new ConfigStore(invalidPath).read(), "invalid config read");

    emptyStore.validate(DEFAULT_BOT_CONFIG);
    // eslint-disable-next-line unicorn/no-null -- The E2E boundary preserves the explicit null contract under test.
    expectFailure(() => emptyStore.validate(null), "root config validation");
    expectFailure(() => emptyStore.validate({ risk: { max_leverage: 15 } }), "field config validation");

    const configPath = path.join(directory, "nested", "mm-bot.toml");
    const auditRecords: Record<string, unknown>[] = [];
    const store = new ConfigStore(configPath, { appendText: captureAuditRecord(auditRecords) });
    store.write(DEFAULT_BOT_CONFIG);
    store.write({
      ...DEFAULT_BOT_CONFIG,
      risk: { ...DEFAULT_BOT_CONFIG.risk, risk_per_trade: 0.02 },
    });
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- The E2E path is created beneath this process fresh temporary directory.
    assertCondition(existsSync(`${configPath}.bak`), "ConfigStore did not create a backup");
    assertCondition(
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- The E2E path is created beneath this process fresh temporary directory.
      readFileSync(`${configPath}.bak`, "utf8").includes("risk_per_trade = 0.01"),
      "ConfigStore backup did not preserve the previous config",
    );

    const liveConfig: BotConfig = {
      ...DEFAULT_BOT_CONFIG,
      bot: { ...DEFAULT_BOT_CONFIG.bot, mode: "live" },
    };
    expectFailure(() => store.writeAfterTypedLive(liveConfig, "live"), "lowercase LIVE confirmation");
    store.writeAfterTypedLive(liveConfig, "LIVE");
    store.writeAfterTypedLive(liveConfig, "LIVE");
    assertCondition(auditRecords.length === 4, "ConfigStore audit log entry count mismatch");
    assertCondition(
      auditRecords[1]?.["status"] === "committed" && auditRecords[3]?.["status"] === "committed",
      "ConfigStore audit log has no committed transition record",
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

export { runConfigStore };
