import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import type { BotState } from "../../../src/bot/state-store.js";
import { parseArgv } from "../../../src/cli/argv.js";
import {
  buildClosures,
  buildReport,
  createKillSwitchDryRunCommand,
  formatJsonLogLines,
  formatTelegramAlert,
  killSwitchDryRunCommand,
  loadState,
  printHumanReadable,
  printJson,
  shouldTrigger,
} from "../../../src/cli/commands/kill-switch-dry-run.js";
import {
  getConfigPath,
  isJsonOutputRequested,
} from "../../../src/cli/commands/kill-switch-command-options.js";
import { loadValidatedStateSnapshot } from "../../../src/cli/commands/kill-switch-state-file.js";
import { killSwitchesCommand } from "../../../src/cli/commands/kill-switches.js";
import { DEFAULT_BOT_CONFIG } from "../../../src/config/defaults.js";
import { ConfigError } from "../../../src/config/loader.js";
import type { CliContext } from "../../../src/cli/router.js";

import { assertCondition } from "./runtime-driver-core.js";

const CLI_CONTEXT: CliContext = { config: DEFAULT_BOT_CONFIG };

function makePosition(overrides: Partial<BotState["positions"][number]> = {}): BotState["positions"][number] {
  return {
    id: "position-1",
    strategy: "donchian_pivot_composition",
    symbol: "BTC/USDC",
    side: "long",
    quantity: 0.5,
    entryPrice: 30_000,
    currentPrice: 31_000,
    leverage: 5,
    unrealizedPnl: 500,
    realizedPnl: 0,
    openedAt: 1_700_000_000_000,
    notionalUsd: 15_000,
    ...overrides,
  };
}

function makeState(overrides: Partial<BotState> = {}): BotState {
  const base: BotState = {
    version: 1,
    savedAt: 1_700_000_000_000,
    equityUsd: 10_000,
    initialEquityUsd: 10_000,
    realizedPnlUsd: 0,
    positions: [],
    closedTrades: [],
    inFlightOrderIds: [],
    counters: { placed: 0, filled: 0, cancelled: 0, rejected: 0 },
  };
  return { ...base, ...overrides, counters: { ...base.counters, ...overrides.counters } };
}

function withCapturedConsole<T>(operation: () => T): {
  readonly result: T;
  readonly logged: readonly string[];
  readonly errored: readonly string[];
} {
  const logged: string[] = [];
  const errored: string[] = [];
  const originalLog = console.log;
  const originalError = console.error;
  console.log = (...values: unknown[]): void => {
    logged.push(values.map(String).join(" "));
  };
  console.error = (...values: unknown[]): void => {
    errored.push(values.map(String).join(" "));
  };
  try {
    return { result: operation(), logged, errored };
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
}

async function withCapturedConsoleAsync<T>(
  operation: () => Promise<T>,
): Promise<{ readonly result: T; readonly logged: readonly string[]; readonly errored: readonly string[] }> {
  const logged: string[] = [];
  const errored: string[] = [];
  const originalLog = console.log;
  const originalError = console.error;
  console.log = (...values: unknown[]): void => {
    logged.push(values.map(String).join(" "));
  };
  console.error = (...values: unknown[]): void => {
    errored.push(values.map(String).join(" "));
  };
  try {
    return { result: await operation(), logged, errored };
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
}

async function writeText(filePath: string, value: string): Promise<void> {
  await Bun.write(filePath, value);
}

function parseJsonRecord(value: string): Readonly<Record<string, unknown>> {
  const parsed: unknown = JSON.parse(value);
  if (!isRecord(parsed)) {
    throw new Error("expected a JSON object");
  }
  return parsed;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exerciseOptionAndPureBoundaries(): void {
  assertCondition(getConfigPath(new Map()) === undefined, "missing config must be undefined");
  assertCondition(
    getConfigPath(new Map([["config", true]])) === undefined,
    "boolean config must be undefined",
  );
  assertCondition(getConfigPath(new Map([["config", ""]])) === undefined, "empty config must be undefined");
  assertCondition(
    getConfigPath(new Map([["config", "config.toml"]])) === "config.toml",
    "config must be retained",
  );
  assertCondition(!isJsonOutputRequested(new Map()), "missing JSON flag must be false");
  assertCondition(isJsonOutputRequested(new Map([["json", true]])), "boolean JSON flag must be true");
  assertCondition(!isJsonOutputRequested(new Map([["json", false]])), "false JSON flag must be false");
  assertCondition(!isJsonOutputRequested(new Map([["json", ""]])), "empty JSON flag must be false");
  assertCondition(!isJsonOutputRequested(new Map([["json", "false"]])), "false string must be false");
  assertCondition(!isJsonOutputRequested(new Map([["json", "0"]])), "zero string must be false");
  assertCondition(isJsonOutputRequested(new Map([["json", "true"]])), "true string must be true");

  const long = makePosition();
  const short = makePosition({
    id: "position-2",
    symbol: "ETH/USDC",
    side: "short",
    quantity: 2,
    unrealizedPnl: -50,
  });
  const closures = buildClosures(makeState({ positions: [long, short] }));
  assertCondition(closures.length === 2 && closures[1]?.side === "short", "closures must retain positions");
  assertCondition(
    formatTelegramAlert([], 0, 0, 1_700_000_000_000, "/tmp/state.json").includes("positions=0"),
    "empty alert mismatch",
  );
  assertCondition(
    formatTelegramAlert(closures, 17_000, 450, 1_700_000_000_000, "/tmp/state.json").includes(
      "ETH/USDC SHORT",
    ),
    "position alert mismatch",
  );
  assertCondition(
    formatJsonLogLines([], 0, 0, 1, "/tmp/state.json").length === 1,
    "empty JSON lines mismatch",
  );
  assertCondition(
    formatJsonLogLines(closures, 17_000, 450, 1, "/tmp/state.json").length === 3,
    "position JSON lines mismatch",
  );
  assertCondition(!shouldTrigger(makeState({ equityUsd: 5000 }), 0.15), "no positions must not trigger");
  assertCondition(
    shouldTrigger(makeState({ equityUsd: 8500, positions: [long] }), 0.15),
    "threshold drawdown must trigger",
  );
  assertCondition(
    !shouldTrigger(makeState({ equityUsd: 9000, positions: [long] }), 0.15),
    "within budget must not trigger",
  );
  assertCondition(
    !shouldTrigger(makeState({ equityUsd: 0, initialEquityUsd: 0, positions: [long] }), 0.15),
    "zero initial equity must not trigger",
  );

  const triggeringReport = buildReport({
    state: makeState({ equityUsd: 7000, positions: [long, short] }),
    stateFilePath: "/tmp/state.json",
    configPath: "/tmp/config.toml",
    maxDrawdownPct: 0.15,
    generatedAt: 1,
  });
  const nonTriggeringReport = buildReport({
    state: makeState(),
    stateFilePath: "/tmp/state.json",
    configPath: undefined,
    maxDrawdownPct: 0.15,
    generatedAt: 1,
  });
  assertCondition(
    triggeringReport.wouldTrigger && triggeringReport.totalNotionalUsd === 30_000,
    "triggering report mismatch",
  );
  assertCondition(
    !nonTriggeringReport.wouldTrigger && nonTriggeringReport.closures.length === 0,
    "non-triggering report mismatch",
  );
  const human = withCapturedConsole(() => {
    printHumanReadable(triggeringReport);
    printHumanReadable(nonTriggeringReport);
  });
  assertCondition(
    human.logged.join("\n").includes("WOULD TRIGGER"),
    "human report must show triggered verdict",
  );
  assertCondition(
    human.logged.join("\n").includes("no open positions"),
    "human report must show empty positions",
  );
  const json = withCapturedConsole(() => {
    printJson(triggeringReport);
  });
  assertCondition(parseJsonRecord(json.logged[0] ?? "{}")["positions"] === 2, "JSON report mismatch");
}

async function exerciseStateAndCommandBoundaries(): Promise<void> {
  const directory = mkdtempSync(path.join(tmpdir(), "mm-bot-kill-switch-e2e-"));
  const statePath = path.join(directory, "state.json");
  const invalidJsonPath = path.join(directory, "invalid.json");
  const invalidStatePath = path.join(directory, "invalid-state.json");
  const configPath = path.join(directory, "config.toml");
  const invalidConfigPath = path.join(directory, "invalid-config.toml");
  const nonTableRiskConfigPath = path.join(directory, "non-table-risk.toml");
  const carryConfigPath = path.join(directory, "carry-config.toml");
  try {
    assertCondition(loadValidatedStateSnapshot("").error !== undefined, "empty state path must fail");
    assertCondition(
      loadValidatedStateSnapshot("\0state.json").error !== undefined,
      "NUL state path must fail",
    );
    assertCondition(loadValidatedStateSnapshot(".").error !== undefined, "dot state path must fail");
    assertCondition(
      loadValidatedStateSnapshot(path.join(directory, "missing.json")).error?.includes("not found") === true,
      "missing state must fail",
    );
    assertCondition(
      loadState(directory).error?.includes("failed to read") === true,
      "directory state must fail",
    );
    await writeText(invalidJsonPath, "{");
    assertCondition(
      loadState(invalidJsonPath).error?.includes("invalid JSON") === true,
      "invalid JSON must fail",
    );
    await writeText(invalidStatePath, JSON.stringify({ version: 99 }));
    assertCondition(
      loadState(invalidStatePath).error?.includes("schema invalid") === true,
      "invalid state schema must fail",
    );
    const state = makeState({
      positions: [
        makePosition({ unrealizedPnl: 0 }),
        makePosition({ id: "position-2", side: "short", unrealizedPnl: -10 }),
      ],
    });
    await writeText(statePath, JSON.stringify(state));
    assertCondition(loadState(statePath).state?.positions.length === 2, "valid state must load");
    await writeText(configPath, `[bot]\nstate_file = ${JSON.stringify(statePath)}\n`);
    await writeText(
      carryConfigPath,
      `[bot]\nstate_file = ${JSON.stringify(statePath)}\n\n[strategies.dydx_cex_carry]\nenabled = true\n`,
    );
    await writeText(invalidConfigPath, "[risk]\nmax_leverage = 99\n");
    await writeText(nonTableRiskConfigPath, "risk = 1\n");

    const help = await withCapturedConsoleAsync(() =>
      killSwitchDryRunCommand(parseArgv(["kill-switch-dry-run", "--help"]), CLI_CONTEXT),
    );
    assertCondition(help.result === 0 && help.logged.join("\n").includes("--json"), "dry-run help mismatch");
    const human = await withCapturedConsoleAsync(() =>
      killSwitchDryRunCommand(parseArgv(["kill-switch-dry-run", `--config=${configPath}`]), CLI_CONTEXT),
    );
    assertCondition(
      human.result === 0 && human.logged.join("\n").includes("Would-be closures"),
      "human dry-run mismatch",
    );
    const json = await withCapturedConsoleAsync(() =>
      killSwitchDryRunCommand(
        parseArgv(["kill-switch-dry-run", "--json", `--config=${configPath}`]),
        CLI_CONTEXT,
      ),
    );
    assertCondition(
      json.result === 0 && parseJsonRecord(json.logged[0] ?? "{}")["positions"] === 2,
      "JSON dry-run mismatch",
    );
    const missingStateConfig = path.join(directory, "missing-state.toml");
    await writeText(
      missingStateConfig,
      `[bot]\nstate_file = ${JSON.stringify(path.join(directory, "missing.json"))}\n`,
    );
    const missingHuman = await withCapturedConsoleAsync(() =>
      killSwitchDryRunCommand(
        parseArgv(["kill-switch-dry-run", `--config=${missingStateConfig}`]),
        CLI_CONTEXT,
      ),
    );
    assertCondition(
      missingHuman.result === 1 && missingHuman.errored.join("\n").includes("unavailable"),
      "missing human state mismatch",
    );
    const missingJson = await withCapturedConsoleAsync(() =>
      killSwitchDryRunCommand(
        parseArgv(["kill-switch-dry-run", "--json", `--config=${missingStateConfig}`]),
        CLI_CONTEXT,
      ),
    );
    assertCondition(
      missingJson.result === 1 && parseJsonRecord(missingJson.logged[0] ?? "{}")["positions"] === 0,
      "missing JSON state mismatch",
    );
    const invalidConfig = await withCapturedConsoleAsync(() =>
      killSwitchDryRunCommand(
        parseArgv(["kill-switch-dry-run", `--config=${invalidConfigPath}`]),
        CLI_CONTEXT,
      ),
    );
    assertCondition(
      invalidConfig.result === 2 &&
        invalidConfig.errored.join("\n").includes("Config validation FAILED") &&
        invalidConfig.errored.join("\n").includes("risk.max_leverage"),
      "invalid config mismatch",
    );
    const nonTableRiskConfig = await withCapturedConsoleAsync(() =>
      killSwitchDryRunCommand(
        parseArgv(["kill-switch-dry-run", `--config=${nonTableRiskConfigPath}`]),
        CLI_CONTEXT,
      ),
    );
    assertCondition(
      nonTableRiskConfig.result === 2 &&
        nonTableRiskConfig.errored.join("\n").includes("Config validation FAILED") &&
        nonTableRiskConfig.errored.join("\n").includes("risk"),
      "non-table risk config did not preserve a strict validation diagnostic",
    );
    const rootMissing = createKillSwitchDryRunCommand({
      resolveRuntimeRoot: () => ({
        ok: false as const,
        error: {
          code: "runtime-root-missing" as const,
          message: "Runtime configuration root is unavailable.",
        },
      }),
    });
    assertCondition(
      (await rootMissing(parseArgv(["kill-switch-dry-run"]), CLI_CONTEXT)) === 2,
      "dry-run accepted a missing runtime root",
    );
    const configValidationFailure = createKillSwitchDryRunCommand({
      loadConfig: () => {
        throw new ConfigError("invalid injected config", "risk", []);
      },
      resolveRuntimeRoot: () => ({ ok: true as const, runtimeRoot: directory, configPath }),
    });
    const configValidationOutput = await withCapturedConsoleAsync(() =>
      configValidationFailure(parseArgv(["kill-switch-dry-run"]), CLI_CONTEXT),
    );
    assertCondition(
      configValidationOutput.result === 2 &&
        configValidationOutput.errored.join("\n").includes("invalid injected config"),
      "dry-run did not preserve the config validation failure",
    );
    for (const failure of [new Error("injected load error"), "injected load string"] as const) {
      const command = createKillSwitchDryRunCommand({
        loadConfig: () => {
          // eslint-disable-next-line @typescript-eslint/only-throw-error -- E2E fault injection verifies public normalization of a hostile loader boundary.
          throw failure;
        },
        resolveRuntimeRoot: () => ({ ok: true as const, runtimeRoot: directory, configPath }),
      });
      const output = await withCapturedConsoleAsync(() =>
        command(parseArgv(["kill-switch-dry-run"]), CLI_CONTEXT),
      );
      assertCondition(
        output.result === 1 &&
          output.errored.join("\n").includes(failure instanceof Error ? failure.message : failure),
        "dry-run did not preserve an unexpected config load failure",
      );
    }

    const switchSuccess = await withCapturedConsoleAsync(() =>
      killSwitchesCommand(parseArgv(["kill-switches", `--config=${configPath}`]), CLI_CONTEXT),
    );
    assertCondition(
      switchSuccess.result === 0 && switchSuccess.logged.join("\n").includes("4 registered"),
      "kill switches success mismatch",
    );
    const switchCarry = await withCapturedConsoleAsync(() =>
      killSwitchesCommand(parseArgv(["kill-switches", `--config=${carryConfigPath}`]), CLI_CONTEXT),
    );
    assertCondition(
      switchCarry.result === 0 && switchCarry.logged.join("\n").includes("per-strategy"),
      "enabled carry switch mismatch",
    );
    const switchFailure = await withCapturedConsoleAsync(() =>
      killSwitchesCommand(parseArgv(["kill-switches", `--config=${invalidConfigPath}`]), CLI_CONTEXT),
    );
    assertCondition(
      switchFailure.result === 2 && switchFailure.errored.join("\n").includes("Config validation FAILED"),
      "kill switches config failure mismatch",
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

export async function runKillSwitchCommands(): Promise<void> {
  exerciseOptionAndPureBoundaries();
  await exerciseStateAndCommandBoundaries();
}
