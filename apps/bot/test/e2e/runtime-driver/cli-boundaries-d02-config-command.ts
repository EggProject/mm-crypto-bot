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
import { ConfigError, DEFAULT_BOT_CONFIG } from "../../../src/config/index.js";

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
const RICH_CONFIG = {
  ...DEFAULT_BOT_CONFIG,
  strategies: {
    ...DEFAULT_BOT_CONFIG.strategies,
    dydx_cex_carry: {
      ...DEFAULT_BOT_CONFIG.strategies.dydx_cex_carry,
      cap: 0.1,
      leverage: 10,
      symbols: ["BTC/USDC"],
      timeframes: { htf: "1h", mtf: "15m", ltf: "5m" },
      custom_string: "value",
      custom_number: 1,
      custom_boolean: true,
      custom_array: ["value", 1],
      custom_object: { nested: "value" },
    },
  },
};

function throwUnavailable(): never {
  // eslint-disable-next-line @typescript-eslint/only-throw-error -- The injected hostile boundary may throw unknown values.
  throw "unavailable";
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

export async function runCliD02ConfigCommandBoundaries(): Promise<void> {
  await withMutedConsole(async () => {
    await exerciseConfigHandler();
    await exerciseConfigInit();
  });
}
