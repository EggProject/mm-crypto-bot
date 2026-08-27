import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { parseArgv } from "../../../src/cli/argv.js";
import { nodeCommandStateFilePort } from "../../../src/cli/commands/command-state-file.js";
import {
  reportConfigPathFailure,
  resolveConfigPath,
  resolveDefaultConfigPath,
  resolveDefaultRuntimeRoot,
} from "../../../src/cli/commands/config-path.js";
import { createKillSwitchDryRunCommand } from "../../../src/cli/commands/kill-switch-dry-run-command.js";
import {
  buildReport,
  printHumanReadable,
  printJson,
} from "../../../src/cli/commands/kill-switch-dry-run-report.js";
import {
  buildClosures,
  isKillSwitchWouldTriggered,
  loadState,
} from "../../../src/cli/commands/kill-switch-dry-run-state.js";
import { CliRouter, type CliContext } from "../../../src/cli/router.js";
import { DEFAULT_BOT_CONFIG } from "../../../src/config/defaults.js";
import { ConfigError } from "../../../src/config/index.js";
import { resolveRuntimeRootConfig } from "../../../src/config/runtime-root.js";

import { assertCondition } from "./runtime-driver-core.js";

const CONTEXT: CliContext = { config: DEFAULT_BOT_CONFIG };

function runtimeRootFailure() {
  return {
    ok: false as const,
    error: {
      code: "runtime-root-missing" as const,
      message: "Runtime configuration root is unavailable." as const,
    },
  };
}

function runtimeRootSuccess(root: string) {
  return { ok: true as const, runtimeRoot: root, configPath: path.join(root, "config", "default.toml") };
}

function dryRunState() {
  return {
    version: 1 as const,
    savedAt: 1_700_000_000_000,
    equityUsd: 8500,
    initialEquityUsd: 10_000,
    realizedPnlUsd: -100,
    positions: [
      {
        id: "position-1",
        strategy: "donchian_pivot_composition",
        symbol: "BTC/USDC",
        side: "long" as const,
        quantity: 1,
        entryPrice: 10_000,
        currentPrice: 9900,
        leverage: 10,
        unrealizedPnl: -100,
        realizedPnl: 0,
        openedAt: 1_700_000_000_000,
        notionalUsd: 10_000,
      },
    ],
    closedTrades: [],
    inFlightOrderIds: [],
    counters: { placed: 1, filled: 1, cancelled: 0, rejected: 0 },
  };
}

async function withMutedConsole(action: () => Promise<void>): Promise<void> {
  const originalLog = console.log;
  const originalError = console.error;
  console.log = (): void => undefined;
  console.error = (): void => undefined;
  try {
    await action();
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
}

async function exerciseRouter(): Promise<void> {
  const router = new CliRouter();
  router.register("known", "known command", (arguments_) => {
    assertCondition(arguments_.subcommand === "known", "router did not preserve a known command");
    return Promise.resolve(7);
  });
  await router.run([]);
  await router.run(["unknown"]);
  await router.run(["unknown", "--help"]);
  assertCondition((await router.run(["known", "--help"])) === 7, "router did not dispatch known help");
  router.printHelp("known");
  router.printHelp("unknown");
  router.printUnknownSubcommand("unknown");
}

function exerciseRuntimeRoot(): void {
  const fixture = mkdtempSync(path.join(tmpdir(), "mm-d02-root-"));
  const repo = path.join(fixture, "repository");
  const runtime = path.join(fixture, "runtime");
  const configDirectory = path.join(runtime, "config");
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- Fresh mkdtemp descendant.
  mkdirSync(repo);
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- Fresh mkdtemp descendant.
  mkdirSync(configDirectory, { recursive: true });
  const template = path.join(configDirectory, "default.toml");
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- Fresh mkdtemp descendant.
  writeFileSync(template, '[bot]\nmode = "paper"\n', "utf8");
  try {
    const accepted = resolveRuntimeRootConfig({
      environment: { MM_CRYPTO_BOT_RUNTIME_ROOT: runtime },
      repositoryRoot: repo,
    });
    assertCondition(
      accepted.ok && accepted.configPath === template,
      "runtime root rejected an external template",
    );
    const parentRuntime = resolveRuntimeRootConfig({
      environment: { MM_CRYPTO_BOT_RUNTIME_ROOT: fixture },
      repositoryRoot: repo,
    });
    assertCondition(!parentRuntime.ok, "runtime root accepted the repository parent");
    for (const environment of [
      undefined,
      {},
      { MM_CRYPTO_BOT_RUNTIME_ROOT: "" },
      { MM_CRYPTO_BOT_RUNTIME_ROOT: "relative" },
    ]) {
      assertCondition(
        !resolveRuntimeRootConfig({ environment, repositoryRoot: repo }).ok,
        "runtime root accepted an invalid environment",
      );
    }
    const repoLink = path.join(fixture, "repository-link");
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- Fresh mkdtemp descendants.
    symlinkSync(repo, repoLink);
    assertCondition(
      !resolveRuntimeRootConfig({
        environment: { MM_CRYPTO_BOT_RUNTIME_ROOT: repoLink },
        repositoryRoot: repo,
      }).ok,
      "runtime root accepted a repository symlink",
    );
    const escapedConfig = path.join(fixture, "escaped.toml");
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- Fresh mkdtemp descendant.
    writeFileSync(escapedConfig, '[bot]\nmode = "paper"\n', "utf8");
    rmSync(template);
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- Fresh mkdtemp descendants.
    symlinkSync(escapedConfig, template);
    assertCondition(
      !resolveRuntimeRootConfig({
        environment: { MM_CRYPTO_BOT_RUNTIME_ROOT: runtime },
        repositoryRoot: repo,
      }).ok,
      "runtime root accepted a config symlink outside the root",
    );
    rmSync(template);
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- Fresh mkdtemp descendant.
    writeFileSync(template, '[bot]\nmode = "paper"\n', "utf8");
    const accessorEnvironment: Record<string, unknown> = {};
    Object.defineProperty(accessorEnvironment, "MM_CRYPTO_BOT_RUNTIME_ROOT", {
      get: () => runtime,
    });
    assertCondition(
      !resolveRuntimeRootConfig({ environment: accessorEnvironment, repositoryRoot: repo }).ok,
      "runtime root accepted an accessor environment value",
    );
    const missing = path.join(fixture, "missing");
    assertCondition(
      !resolveRuntimeRootConfig({
        environment: { MM_CRYPTO_BOT_RUNTIME_ROOT: missing },
        repositoryRoot: repo,
      }).ok,
      "runtime root accepted a missing directory",
    );
    const noTemplate = path.join(fixture, "no-template");
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- Fresh mkdtemp descendant.
    mkdirSync(noTemplate);
    assertCondition(
      !resolveRuntimeRootConfig({
        environment: { MM_CRYPTO_BOT_RUNTIME_ROOT: noTemplate },
        repositoryRoot: repo,
      }).ok,
      "runtime root accepted a root without its default template",
    );
    const hostileEnvironment = new Proxy(
      {},
      {
        getOwnPropertyDescriptor: () => {
          throw new Error("descriptor unavailable");
        },
      },
    );
    assertCondition(
      !resolveRuntimeRootConfig({ environment: hostileEnvironment, repositoryRoot: repo }).ok,
      "runtime root accepted a hostile environment descriptor",
    );
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
}

async function exerciseDryRun(): Promise<void> {
  const state = dryRunState();
  const report = buildReport({
    state,
    stateFilePath: "/external/state.json",
    configPath: "/external/config.toml",
    maxDrawdownPct: 0.15,
    generatedAt: 1_700_000_000_000,
  });
  assertCondition(report.wouldTrigger, "dry-run did not identify breached drawdown");
  assertCondition(buildClosures(state).length === 1, "dry-run did not build a position closure");
  assertCondition(isKillSwitchWouldTriggered(state, 0.15), "dry-run threshold did not trigger");
  assertCondition(
    !isKillSwitchWouldTriggered({ ...state, initialEquityUsd: 0 }, 0.15),
    "dry-run accepted a zero initial-equity threshold",
  );
  printHumanReadable(report);
  printJson(report);
  printHumanReadable(
    buildReport({
      state: { ...state, positions: [], equityUsd: 10_000 },
      stateFilePath: "/external/state.json",
      configPath: undefined,
      maxDrawdownPct: 0.15,
      generatedAt: 1_700_000_000_000,
    }),
  );

  const temporary = mkdtempSync(path.join(tmpdir(), "mm-d02-state-"));
  const statePath = path.join(temporary, "state.json");
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- Fresh mkdtemp descendant.
  writeFileSync(statePath, JSON.stringify(state), "utf8");
  try {
    assertCondition(loadState(statePath).state !== undefined, "dry-run could not read its valid state");
    assertCondition(
      loadState(path.join(temporary, "missing.json")).error !== undefined,
      "missing state was accepted",
    );
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- Fresh mkdtemp descendant.
    writeFileSync(statePath, "not-json", "utf8");
    assertCondition(loadState(statePath).error !== undefined, "invalid JSON state was accepted");
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- Fresh mkdtemp descendant.
    writeFileSync(statePath, JSON.stringify({ version: 99 }), "utf8");
    assertCondition(loadState(statePath).error !== undefined, "schema-invalid state was accepted");
    assertCondition(
      loadState(statePath, {
        exists: () => true,
        readText: () => {
          // eslint-disable-next-line @typescript-eslint/only-throw-error -- This hostile boundary can throw unknown values.
          throw "denied";
        },
      }).error !== undefined,
      "hostile state-file read was accepted",
    );
    assertCondition(
      loadState(statePath, {
        exists: () => true,
        readText: () => {
          throw new Error("denied");
        },
      }).error !== undefined,
      "Error state-file read was accepted",
    );
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }

  const command = createKillSwitchDryRunCommand({
    loadConfig: () => ({
      ...DEFAULT_BOT_CONFIG,
      bot: { ...DEFAULT_BOT_CONFIG.bot, state_file: "/external/state.json" },
    }),
    loadState: () => ({ state, error: undefined }),
    resolveRuntimeRoot: () => runtimeRootSuccess("/external"),
  });
  assertCondition((await command(parseArgv(["kill-switch-dry-run"]), CONTEXT)) === 0, "human dry-run failed");
  assertCondition(
    (await command(parseArgv(["kill-switch-dry-run", "--json"]), CONTEXT)) === 0,
    "JSON dry-run failed",
  );
  assertCondition(
    (await command(parseArgv(["kill-switch-dry-run", "--json=false"]), CONTEXT)) === 0,
    "false JSON mode failed",
  );
  assertCondition(
    (await command(parseArgv(["kill-switch-dry-run", "--json=0"]), CONTEXT)) === 0,
    "zero JSON mode failed",
  );
  assertCondition(
    (await command(parseArgv(["kill-switch-dry-run", "--config"]), CONTEXT)) === 0,
    "bare config flag failed",
  );
  assertCondition(
    (await command(parseArgv(["kill-switch-dry-run", "--config="]), CONTEXT)) === 0,
    "empty config flag failed",
  );
  assertCondition(
    (await command(parseArgv(["kill-switch-dry-run", "--config=/external/config.toml"]), CONTEXT)) === 0,
    "explicit config flag failed",
  );
  assertCondition(
    (await createKillSwitchDryRunCommand({ resolveRuntimeRoot: runtimeRootFailure })(
      parseArgv(["kill-switch-dry-run"]),
      CONTEXT,
    )) === 2,
    "dry-run accepted a missing root",
  );
  assertCondition(
    (await createKillSwitchDryRunCommand({ resolveRuntimeRoot: () => runtimeRootSuccess("/external") })(
      parseArgv(["kill-switch-dry-run", "--help"]),
      CONTEXT,
    )) === 0,
    "dry-run help failed",
  );
  const unavailableState = createKillSwitchDryRunCommand({
    loadConfig: () => ({
      ...DEFAULT_BOT_CONFIG,
      bot: { ...DEFAULT_BOT_CONFIG.bot, state_file: "/external/state.json" },
    }),
    loadState: () => ({ state: undefined, error: undefined }),
    resolveRuntimeRoot: () => runtimeRootSuccess("/external"),
  });
  assertCondition(
    (await unavailableState(parseArgv(["kill-switch-dry-run"]), CONTEXT)) === 1,
    "dry-run accepted missing state",
  );
  assertCondition(
    (await unavailableState(parseArgv(["kill-switch-dry-run", "--json"]), CONTEXT)) === 1,
    "dry-run JSON missing-state failed",
  );
  const configFailure = createKillSwitchDryRunCommand({
    loadConfig: () => {
      throw new ConfigError("invalid", "bot", []);
    },
    resolveRuntimeRoot: () => runtimeRootSuccess("/external"),
  });
  assertCondition(
    (await configFailure(parseArgv(["kill-switch-dry-run"]), CONTEXT)) === 2,
    "dry-run did not map a config validation failure",
  );
  for (const loadConfig of [
    () => {
      throw new Error("invalid");
    },
    () => {
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- This hostile boundary can throw unknown values.
      throw "unavailable";
    },
  ]) {
    assertCondition(
      (await createKillSwitchDryRunCommand({
        loadConfig,
        resolveRuntimeRoot: () => runtimeRootSuccess("/external"),
      })(parseArgv(["kill-switch-dry-run"]), CONTEXT)) === 1,
      "dry-run did not map a config load failure",
    );
  }
}

export async function runCliD02CoreBoundaries(): Promise<void> {
  await withMutedConsole(async () => {
    await exerciseRouter();
    exerciseRuntimeRoot();
    const explicit = resolveConfigPath("/external/config.toml", runtimeRootFailure);
    assertCondition(
      explicit.ok && explicit.configPath === "/external/config.toml",
      "explicit config path changed",
    );
    reportConfigPathFailure(runtimeRootFailure());
    resolveDefaultConfigPath(undefined);
    resolveDefaultRuntimeRoot();
    const portDirectory = mkdtempSync(path.join(tmpdir(), "mm-d02-port-"));
    const portFile = path.join(portDirectory, "state.json");
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- Fresh mkdtemp descendant.
    writeFileSync(portFile, "{}", "utf8");
    try {
      assertCondition(
        nodeCommandStateFilePort.exists(portFile),
        "node state-file port did not find its file",
      );
      assertCondition(
        nodeCommandStateFilePort.readText(portFile) === "{}",
        "node state-file port could not read its file",
      );
    } finally {
      rmSync(portDirectory, { recursive: true, force: true });
    }
    await exerciseDryRun();
  });
}
