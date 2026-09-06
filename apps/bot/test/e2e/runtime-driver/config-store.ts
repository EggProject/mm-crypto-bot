import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { SelectedLeverage } from "@mm-crypto-bot/numeric";
import { DEFAULT_BOT_CONFIG } from "../../../src/config/defaults.js";
import type { BotConfig } from "../../../src/config/schema.js";
import {
  ConfigLiveConfirmError,
  ConfigReadError,
  ConfigStore,
  ConfigValidationError,
  getConfigStore,
  resetConfigStoreCache,
  type ConfigStoreDependencies,
} from "../../../src/config/store.js";

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

function expectError(action: () => unknown, label: string): Error {
  let didThrow = false;
  let failure: unknown;
  try {
    action();
  } catch (error: unknown) {
    didThrow = true;
    failure = error;
  }
  if (!didThrow || !(failure instanceof Error)) throw new Error(`${label} did not throw an Error`);
  return failure;
}

function expectValidationError(action: () => unknown, label: string): ConfigValidationError {
  const error = expectError(action, label);
  assertCondition(error instanceof ConfigValidationError, `${label} did not throw ConfigValidationError`);
  return error;
}

function assertExactFieldError(error: ConfigValidationError, path: string, message: string): void {
  const fieldErrors = error.fieldErrors;
  assertCondition(Object.keys(fieldErrors).length === 1, "ConfigValidationError had unexpected fields");
  const fieldEntry = Object.entries(fieldErrors).find(([field]) => field === path);
  assertCondition(fieldEntry !== undefined, `ConfigValidationError did not include ${path}`);
  const messages = fieldEntry[1];
  assertCondition(messages.length === 1, `ConfigValidationError field ${path} had unexpected messages`);
  assertCondition(messages[0] === message, `ConfigValidationError field ${path} message mismatch`);
}

function throwInjectedFailure(failure: unknown): never {
  throw failure;
}

function exerciseConfigStoreFaults(directory: string): void {
  const stateFilePath = path.join(directory, "fault.toml");
  new ConfigStore(stateFilePath).write(DEFAULT_BOT_CONFIG);
  const injectedFailures = [
    { failure: new Error("injected Error"), normalized: "injected Error", parsed: "Error: injected Error" },
    { failure: "injected string", normalized: "injected string", parsed: "injected string" },
  ] as const;
  for (const injected of injectedFailures) {
    const readError = expectError(
      () =>
        new ConfigStore(stateFilePath, {
          readText: () => throwInjectedFailure(injected.failure),
        }).read(),
      "ConfigStore read normalization",
    );
    assertCondition(
      readError instanceof ConfigReadError,
      "read normalization did not retain ConfigReadError",
    );
    assertCondition(
      readError.message === `Failed to read config file at "${stateFilePath}": ${injected.normalized}`,
      "ConfigStore read normalization message mismatch",
    );
    assertCondition(
      readError.originalCause === injected.failure,
      "ConfigStore read normalization lost the cause",
    );

    const parseError = expectError(
      () =>
        new ConfigStore(stateFilePath, {
          readText: () => "",
          parse: () => throwInjectedFailure(injected.failure),
        }).read(),
      "ConfigStore parse normalization",
    );
    assertCondition(
      parseError instanceof ConfigReadError,
      "parse normalization did not retain ConfigReadError",
    );
    assertCondition(
      parseError.message === `Failed to parse TOML at "${stateFilePath}": ${injected.parsed}`,
      "ConfigStore parse normalization message mismatch",
    );
    assertCondition(
      parseError.originalCause === injected.failure,
      "ConfigStore parse normalization lost the cause",
    );

    const roundTripError = expectError(() => {
      new ConfigStore(stateFilePath, {
        parse: () => throwInjectedFailure(injected.failure),
      }).write(DEFAULT_BOT_CONFIG);
    }, "ConfigStore round-trip normalization");
    assertCondition(
      roundTripError.message ===
        `ConfigStore.write: round-trip parse failed (smol-toml bug?): ${injected.normalized}`,
      "ConfigStore round-trip normalization message mismatch",
    );
    assertCondition(
      roundTripError.cause === injected.failure,
      "ConfigStore round-trip normalization lost the cause",
    );

    const atomicError = expectError(() => {
      new ConfigStore(stateFilePath, {
        atomicWrite: () => throwInjectedFailure(injected.failure),
      }).write(DEFAULT_BOT_CONFIG);
    }, "ConfigStore atomic normalization");
    assertCondition(
      atomicError.message === `ConfigStore.write: failed to write ${stateFilePath}: ${injected.normalized}`,
      "ConfigStore atomic normalization message mismatch",
    );
    assertCondition(
      atomicError.cause === injected.failure,
      "ConfigStore atomic normalization lost the cause",
    );
  }

  const roundTripValidation = expectValidationError(() => {
    // eslint-disable-next-line unicorn/no-null -- The E2E boundary preserves the explicit null contract under test.
    new ConfigStore(stateFilePath, { parse: () => null }).write(DEFAULT_BOT_CONFIG);
  }, "ConfigStore round-trip validation");
  assertExactFieldError(roundTripValidation, "<root>", "Expected object, received null");

  const liveConfig: BotConfig = {
    ...DEFAULT_BOT_CONFIG,
    bot: { ...DEFAULT_BOT_CONFIG.bot, mode: "live" },
  };
  for (const injected of injectedFailures) {
    const auditError = expectError(
      () =>
        new ConfigStore(stateFilePath, {
          appendText: () => throwInjectedFailure(injected.failure),
        }).writeAfterTypedLive(liveConfig, "LIVE"),
      "ConfigStore audit normalization",
    );
    assertCondition(
      auditError.message ===
        `ConfigStore.writeAfterTypedLive: failed to write audit log ${stateFilePath}.audit.log: ${injected.normalized}`,
      "ConfigStore audit normalization message mismatch",
    );
    assertCondition(auditError.cause === injected.failure, "ConfigStore audit normalization lost the cause");
  }
}

function exerciseRoundTripDivergences(directory: string): void {
  const divergenceMessage = "Serialized configuration does not exactly round-trip through the TOML codec.";
  const sameLeverageDependencies = {
    stringify: () => "serialized",
    parse: () => ({ risk: { risk_per_trade: 0.02 } }),
  } satisfies Partial<ConfigStoreDependencies>;
  const sameLeverageError = expectValidationError(() => {
    new ConfigStore(path.join(directory, "same-leverage.toml"), sameLeverageDependencies).write(
      DEFAULT_BOT_CONFIG,
    );
  }, "same selected leverage round-trip divergence");
  assertExactFieldError(sameLeverageError, "<round-trip>", divergenceMessage);
}

function exerciseLivePersistenceBoundaries(directory: string): void {
  const configPath = path.join(directory, "default-audit", "mm-bot.toml");
  const store = new ConfigStore(configPath);
  store.write(DEFAULT_BOT_CONFIG);
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- The E2E path is created beneath this process fresh temporary directory.
  assertCondition(existsSync(configPath), "ConfigStore default write did not create its parent directory");

  const liveConfig = store.validate({ bot: { mode: "live" } });
  store.writeAfterTypedLive(liveConfig, "LIVE");
  assertCondition(
    store.read().bot.selected_leverage.canonical === "10",
    "authentic selected leverage changed on disk",
  );

  // eslint-disable-next-line security/detect-non-literal-fs-filename -- The E2E audit path is derived from a fresh temporary config path.
  const auditLines = readFileSync(`${configPath}.audit.log`, "utf8").trim().split("\n");
  assertCondition(
    auditLines.length === 2,
    "default Node audit append did not record pending and committed entries",
  );
  const pendingAudit: unknown = JSON.parse(auditLines[0] ?? "");
  const committedAudit: unknown = JSON.parse(auditLines[1] ?? "");
  assertCondition(
    isAuditRecord(pendingAudit) &&
      pendingAudit["status"] === "pending" &&
      isAuditRecord(committedAudit) &&
      committedAudit["status"] === "committed",
    "default Node audit entries have unexpected statuses",
  );

  const expectedSelectedLeverageError = "Selected leverage must be an authentic SelectedLeverage value.";
  const forgedLiveConfig: unknown = {
    ...liveConfig,
    bot: { ...liveConfig.bot, selected_leverage: { canonical: "10" } },
  };
  const forgedError = expectValidationError(
    () => store.writeAfterTypedLive(forgedLiveConfig, "LIVE"),
    "forged selected leverage",
  );
  assertExactFieldError(forgedError, "bot.selected_leverage", expectedSelectedLeverageError);

  const revocableSelectedLeverage = Proxy.revocable(liveConfig.bot.selected_leverage, {});
  revocableSelectedLeverage.revoke();
  const revokedLiveConfig: unknown = {
    ...liveConfig,
    bot: { ...liveConfig.bot, selected_leverage: revocableSelectedLeverage.proxy },
  };
  const revokedError = expectValidationError(
    () => store.writeAfterTypedLive(revokedLiveConfig, "LIVE"),
    "revoked selected leverage",
  );
  assertExactFieldError(revokedError, "bot.selected_leverage", expectedSelectedLeverageError);
  assertCondition(
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- The E2E audit path is derived from a fresh temporary config path.
    readFileSync(`${configPath}.audit.log`, "utf8").trim().split("\n").length === 2,
    "rejected selected leverage wrote an audit entry",
  );

  const rejectedConfigPath = path.join(directory, "rejected-live-mm-bot.toml");
  const rejectedAuditRecords: Record<string, unknown>[] = [];
  const rejectedWriteCalls: string[] = [];
  const rejectedStore = new ConfigStore(rejectedConfigPath, {
    appendText: captureAuditRecord(rejectedAuditRecords),
    stringify: () => {
      rejectedWriteCalls.push("stringify");
      return "serialized";
    },
    atomicWrite: () => {
      rejectedWriteCalls.push("atomicWrite");
    },
  });
  const authenticNonTenLiveConfig: BotConfig = {
    ...liveConfig,
    bot: { ...liveConfig.bot, selected_leverage: SelectedLeverage.parse("3") },
  };
  const authenticNonTenError = expectValidationError(
    () => rejectedStore.writeAfterTypedLive(authenticNonTenLiveConfig, "LIVE"),
    "authentic non-10 live selected leverage",
  );
  assertExactFieldError(
    authenticNonTenError,
    "bot.selected_leverage",
    "Selected leverage must be exactly canonical 10.",
  );
  const writeRejectedConfig = (next: BotConfig): void => {
    rejectedStore.write(next);
  };
  const forgedWriteError = expectValidationError(
    () => Reflect.apply(writeRejectedConfig, undefined, [forgedLiveConfig]),
    "forged selected leverage write",
  );
  assertExactFieldError(forgedWriteError, "bot.selected_leverage", expectedSelectedLeverageError);
  assertCondition(rejectedAuditRecords.length === 0, "non-10 selected leverage wrote an audit entry");
  assertCondition(rejectedWriteCalls.length === 0, "rejected selected leverage reached config persistence");
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- The E2E target is derived from this process fresh temporary directory.
  assertCondition(!existsSync(rejectedConfigPath), "rejected selected leverage created a config target");

  const invalidLiveCandidates = [
    {
      // eslint-disable-next-line unicorn/no-null -- The public E2E boundary preserves the explicit null root contract under test.
      candidate: null,
      field: "<root>",
      message: "Expected object, received null",
    },
    {
      // eslint-disable-next-line unicorn/no-null -- The public E2E boundary preserves the explicit null bot contract under test.
      candidate: { bot: null },
      field: "bot",
      message: "Expected object, received null",
    },
    {
      candidate: { bot: { mode: "live", selected_leverage: "invalid" } },
      field: "bot.selected_leverage",
      message: "Selected leverage must be a canonical positive decimal string.",
    },
  ] as const;
  for (const [index, invalidLiveCandidate] of invalidLiveCandidates.entries()) {
    const invalidConfigPath = path.join(directory, `invalid-live-${String(index)}.toml`);
    const invalidAuditRecords: Record<string, unknown>[] = [];
    const invalidWriteCalls: string[] = [];
    const invalidStore = new ConfigStore(invalidConfigPath, {
      appendText: captureAuditRecord(invalidAuditRecords),
      stringify: () => {
        invalidWriteCalls.push("stringify");
        return "serialized";
      },
      atomicWrite: () => {
        invalidWriteCalls.push("atomicWrite");
      },
    });
    const invalidLiveError = expectValidationError(
      () => invalidStore.writeAfterTypedLive(invalidLiveCandidate.candidate, "LIVE"),
      `invalid live candidate ${String(index)}`,
    );
    assertExactFieldError(invalidLiveError, invalidLiveCandidate.field, invalidLiveCandidate.message);
    assertCondition(
      invalidAuditRecords.length === 0,
      `invalid live candidate ${String(index)} wrote an audit entry`,
    );
    assertCondition(
      invalidWriteCalls.length === 0,
      `invalid live candidate ${String(index)} reached config persistence`,
    );
    assertCondition(
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- The E2E target is derived from this process fresh temporary directory.
      !existsSync(invalidConfigPath),
      `invalid live candidate ${String(index)} created a config target`,
    );
  }

  const nonLiveError = expectError(
    () => store.writeAfterTypedLive(DEFAULT_BOT_CONFIG, "LIVE"),
    "non-live config confirmation",
  );
  assertCondition(
    nonLiveError instanceof ConfigLiveConfirmError,
    "non-live config did not reject LIVE confirmation",
  );
  assertCondition(
    nonLiveError.message === "Refusing to confirm a config whose bot.mode is not live.",
    "non-live config confirmation message mismatch",
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

    emptyStore.validate({});
    const rootValidationError = expectValidationError(() => {
      // eslint-disable-next-line unicorn/no-null -- The E2E boundary preserves the explicit null contract under test.
      emptyStore.validate(null);
    }, "root config validation");
    assertExactFieldError(rootValidationError, "<root>", "Expected object, received null");
    const fieldValidationError = expectValidationError(
      () => emptyStore.validate({ risk: { max_leverage: 15 } }),
      "field config validation",
    );
    assertExactFieldError(fieldValidationError, "risk.max_leverage", "Invalid literal value, expected 10");

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
    exerciseRoundTripDivergences(directory);
    exerciseLivePersistenceBoundaries(directory);
  } finally {
    resetConfigStoreCache();
    rmSync(directory, { recursive: true, force: true });
  }
}

export { runConfigStore };
