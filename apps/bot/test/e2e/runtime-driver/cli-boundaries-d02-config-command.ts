import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { parseArgv } from "../../../src/cli/argv.js";
import {
  createConfigCommand,
  runConfigInit,
  type ConfigFileBoundary,
} from "../../../src/cli/commands/config.js";
import type { CliContext } from "../../../src/cli/router.js";
import {
  BotConfigSchema,
  ConfigError,
  DEFAULT_BOT_CONFIG,
  loadBotConfig,
} from "../../../src/config/index.js";

import { assertCondition } from "./runtime-driver-core.js";

const CONTEXT: CliContext = { config: DEFAULT_BOT_CONFIG };
const ROOT = { ok: true as const, runtimeRoot: "/external", configPath: "/external/config/default.toml" };
const MISSING_ROOT = {
  ok: false as const,
  error: {
    code: "runtime-root-missing" as const,
    message: "Runtime configuration root is unavailable." as const,
  },
};
const RICH_CONFIG = BotConfigSchema.parse({
  ...DEFAULT_BOT_CONFIG,
  bot: {
    mode: DEFAULT_BOT_CONFIG.bot.mode,
    log_level: DEFAULT_BOT_CONFIG.bot.log_level,
    state_file: DEFAULT_BOT_CONFIG.bot.state_file,
    selected_leverage: "10",
  },
  strategies: {
    ...DEFAULT_BOT_CONFIG.strategies,
    dydx_cex_carry: {
      ...DEFAULT_BOT_CONFIG.strategies.dydx_cex_carry,
      cap: 0.1,
      symbols: ["BTC/USDC"],
      timeframes: { htf: "1h", mtf: "15m", ltf: "5m" },
    },
  },
});
const TOML_ESCAPED_STRING_CONFIG = BotConfigSchema.parse({
  ...DEFAULT_BOT_CONFIG,
  bot: {
    mode: DEFAULT_BOT_CONFIG.bot.mode,
    log_level: DEFAULT_BOT_CONFIG.bot.log_level,
    state_file: '/external/quote-"-slash-\\-tab-\t-delete-\u{7F}.json',
    selected_leverage: DEFAULT_BOT_CONFIG.bot.selected_leverage.canonical,
  },
});
const TOML_UNSUPPORTED_CONTROL_CONFIG = BotConfigSchema.parse({
  ...DEFAULT_BOT_CONFIG,
  bot: {
    mode: DEFAULT_BOT_CONFIG.bot.mode,
    log_level: DEFAULT_BOT_CONFIG.bot.log_level,
    state_file: "/external/control-\u{1}.json",
    selected_leverage: DEFAULT_BOT_CONFIG.bot.selected_leverage.canonical,
  },
});

function throwUnavailable(): never {
  // eslint-disable-next-line @typescript-eslint/only-throw-error -- The injected hostile boundary may throw unknown values.
  throw "unavailable";
}

function expectConfigError(operation: () => void, expectedPath: string, label: string): void {
  try {
    operation();
  } catch (error) {
    assertCondition(error instanceof ConfigError, `${label} did not throw ConfigError`);
    assertCondition(error.path === expectedPath, `${label} path mismatch`);
    return;
  }
  throw new Error(`${label} unexpectedly succeeded`);
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

async function exerciseConfigHandler(): Promise<void> {
  const valid = createConfigCommand({ loadConfig: () => DEFAULT_BOT_CONFIG, resolveRuntimeRoot: () => ROOT });
  assertCondition(
    (await valid(parseArgv(["config", "validate"]), CONTEXT)) === 0,
    "config validate rejected default config",
  );
  assertCondition(
    (await valid(parseArgv(["config", "show"]), CONTEXT)) === 0,
    "config show rejected default config",
  );
  const rich = createConfigCommand({ loadConfig: () => RICH_CONFIG, resolveRuntimeRoot: () => ROOT });
  assertCondition(
    (await rich(parseArgv(["config", "show"]), CONTEXT)) === 0,
    "config show rejected rich config",
  );
  const escapedString = createConfigCommand({
    loadConfig: () => TOML_ESCAPED_STRING_CONFIG,
    resolveRuntimeRoot: () => ROOT,
  });
  assertCondition(
    (await escapedString(parseArgv(["config", "show"]), CONTEXT)) === 0,
    "config show rejected TOML-escaped state-file characters",
  );
  const unsupportedControl = createConfigCommand({
    loadConfig: () => TOML_UNSUPPORTED_CONTROL_CONFIG,
    resolveRuntimeRoot: () => ROOT,
  });
  assertCondition(
    (await unsupportedControl(parseArgv(["config", "show"]), CONTEXT)) === 1,
    "config show accepted a state-file character Bun TOML cannot represent",
  );
  assertCondition(
    (await valid(parseArgv(["config", "--help"]), CONTEXT)) === 1,
    "config help returned wrong exit",
  );
  assertCondition(
    (await valid(parseArgv(["config", "unknown"]), CONTEXT)) === 1,
    "config accepted unknown nested command",
  );
  const configFailure = createConfigCommand({
    loadConfig: () => {
      throw new ConfigError("invalid", "bot", []);
    },
    resolveRuntimeRoot: () => ROOT,
  });
  assertCondition(
    (await configFailure(parseArgv(["config", "validate"]), CONTEXT)) === 2,
    "config did not map ConfigError",
  );
  assertCondition(
    (await configFailure(parseArgv(["config", "show"]), CONTEXT)) === 2,
    "config show did not map ConfigError",
  );
  const hostile = createConfigCommand({
    loadConfig: throwUnavailable,
    resolveRuntimeRoot: () => ROOT,
  });
  assertCondition(
    (await hostile(parseArgv(["config", "validate"]), CONTEXT)) === 1,
    "config did not map hostile failure",
  );
  assertCondition(
    (await hostile(parseArgv(["config", "show"]), CONTEXT)) === 1,
    "config show did not map hostile failure",
  );
  const unexpected = createConfigCommand({
    loadConfig: () => {
      throw new Error("unavailable");
    },
    resolveRuntimeRoot: () => ROOT,
  });
  assertCondition(
    (await unexpected(parseArgv(["config", "validate"]), CONTEXT)) === 1,
    "config validate did not map Error failure",
  );
  assertCondition(
    (await unexpected(parseArgv(["config", "show"]), CONTEXT)) === 1,
    "config show did not map Error failure",
  );
  const noRoot = createConfigCommand({ resolveRuntimeRoot: () => MISSING_ROOT });
  for (const command of ["validate", "show", "init"]) {
    assertCondition(
      (await noRoot(parseArgv(["config", command]), CONTEXT)) === 2,
      "config accepted missing root",
    );
  }
  const observedOutPaths: (string | undefined)[] = [];
  const init = createConfigCommand({
    initConfig: (outPath) => {
      observedOutPaths.push(outPath);
      return 0;
    },
    resolveRuntimeRoot: () => ROOT,
  });
  for (const argv of [
    ["config", "init"],
    ["config", "init", "--out"],
    ["config", "init", "--out="],
    ["config", "init", "--out=/external/output.toml"],
  ]) {
    assertCondition((await init(parseArgv(argv), CONTEXT)) === 0, "config init dispatch failed");
  }
  assertCondition(
    observedOutPaths[0] === undefined &&
      observedOutPaths[1] === undefined &&
      observedOutPaths[2] === undefined &&
      observedOutPaths[3] === "/external/output.toml",
    "config init did not normalize output flags",
  );
}

async function exerciseConfigInit(): Promise<void> {
  const directory = mkdtempSync(path.join(tmpdir(), "mm-d02-config-"));
  const templateDirectory = path.join(directory, "config");
  const template = path.join(templateDirectory, "default.toml");
  const output = path.join(directory, "nested", "output.toml");
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- Fresh mkdtemp descendant.
  mkdirSync(templateDirectory);
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- Fresh mkdtemp descendant.
  writeFileSync(template, '[bot]\nmode = "paper"\n', "utf8");
  try {
    assertCondition(runConfigInit(output, template) === 0, "config init could not create a nested output");
    assertCondition(runConfigInit(output, template) === 1, "config init overwrote an existing output");
    const missingOutput = path.join(directory, "missing-output.toml");
    const missingTemplate = path.join(directory, "missing.toml");
    assertCondition(
      runConfigInit(missingOutput, missingTemplate) === 1,
      "config init accepted missing template",
    );
    let isMalformedSourceRejected = false;
    try {
      runConfigInit(missingOutput, "\0");
    } catch {
      isMalformedSourceRejected = true;
    }
    assertCondition(isMalformedSourceRejected, "config init accepted a malformed source boundary");
    const failures: readonly [ConfigFileBoundary, string][] = [
      [
        {
          exists: (filePath) => filePath === template || filePath === directory,
          read: () => "template",
          ensureDirectory: () => {
            throw new Error("unexpected directory creation");
          },
          write: () => {
            throw new Error("write denied");
          },
        },
        "Error",
      ],
      [
        {
          exists: (filePath) => filePath === template || filePath === directory,
          read: () => "template",
          ensureDirectory: () => {
            throw new Error("unexpected directory creation");
          },
          write: () => {
            // eslint-disable-next-line @typescript-eslint/only-throw-error -- The injected hostile filesystem boundary may throw unknown values.
            throw "write denied";
          },
        },
        "unknown",
      ],
    ];
    for (const [boundary, description] of failures) {
      assertCondition(
        runConfigInit(path.join(directory, `failure-${description}.toml`), template, boundary) === 1,
        "config init did not map a write failure",
      );
    }
    const previousDirectory = process.cwd();
    try {
      process.chdir(directory);
      assertCondition(runConfigInit(undefined, template) === 0, "config init did not use its default output");
    } finally {
      process.chdir(previousDirectory);
    }
    const command = createConfigCommand({
      resolveRuntimeRoot: () => ({ ok: true as const, runtimeRoot: directory, configPath: template }),
    });
    const handlerOutput = path.join(directory, "handler-output.toml");
    const handlerArguments = parseArgv(["config", "init", `--out=${handlerOutput}`]);
    assertCondition(
      (await command(handlerArguments, CONTEXT)) === 0,
      "config command init did not use external template",
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function exerciseConfigLoader(): void {
  const paper = loadBotConfig(undefined, { BUN_ENV: "paper", LOG_LEVEL: "debug" });
  assertCondition(
    paper.bot.mode === "paper" && paper.bot.log_level === "debug",
    "paper environment overrides failed",
  );
  const unsupportedLogLevel = loadBotConfig(undefined, { LOG_LEVEL: "verbose" });
  assertCondition(
    unsupportedLogLevel.bot.log_level === DEFAULT_BOT_CONFIG.bot.log_level,
    "unsupported log level changed the default",
  );
  expectConfigError(
    () => loadBotConfig(undefined, { BUN_ENV: "live" }),
    "BUN_ENV",
    "live environment activation",
  );

  const directory = mkdtempSync(path.join(tmpdir(), "mm-d02-loader-"));
  try {
    const valid = path.join(directory, "valid.toml");
    const malformed = path.join(directory, "malformed.toml");
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- Fresh mkdtemp descendant.
    writeFileSync(valid, '[bot]\nlog_level = "warn"\n', "utf8");
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- Fresh mkdtemp descendant.
    writeFileSync(malformed, "[bot]\nlog_level =", "utf8");
    assertCondition(loadBotConfig(valid).bot.log_level === "warn", "file config override failed");
    expectConfigError(
      () => loadBotConfig(path.join(directory, "missing.toml")),
      "<file>",
      "missing config file",
    );
    expectConfigError(() => loadBotConfig(malformed), "<toml-parse>", "malformed TOML");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

export async function runCliD02ConfigCommandBoundaries(): Promise<void> {
  await withMutedConsole(async () => {
    await exerciseConfigHandler();
    await exerciseConfigInit();
    exerciseConfigLoader();
  });
}
