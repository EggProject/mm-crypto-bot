import { parseArgv } from "../../../src/cli/argv.js";
import { createConfigCommand } from "../../../src/cli/commands/config.js";
import { DEFAULT_BOT_CONFIG } from "../../../src/config/defaults.js";

import { assertCondition } from "./runtime-driver-core.js";
import { runCliD02CoreBoundaries } from "./cli-boundaries-d02-core.js";
import { runCliD02ReadOnlyBoundaries } from "./cli-boundaries-d02-readonly.js";
import { runCliD02ConfigCommandBoundaries } from "./cli-boundaries-d02-config-command.js";
import { runCliD02StartBoundaries } from "./cli-boundaries-d02-start.js";
import { runCliD02BacktestBoundaries } from "./cli-boundaries-d02-backtest.js";

const unavailable = () => ({
  ok: false as const,
  error: {
    code: "runtime-root-missing" as const,
    message: "Runtime configuration root is unavailable." as const,
  },
});

const available = () => ({
  ok: true as const,
  runtimeRoot: "/external",
  configPath: "/external/config/default.toml",
});

export async function runCliCommandBoundaries(): Promise<void> {
  const context = { config: DEFAULT_BOT_CONFIG };
  const observedPaths: string[] = [];
  const command = createConfigCommand({
    loadConfig: (configPath) => {
      observedPaths.push(configPath ?? "");
      return DEFAULT_BOT_CONFIG;
    },
    resolveRuntimeRoot: available,
  });
  assertCondition(
    (await command(parseArgv(["config", "validate"]), context)) === 0,
    "config runtime-root default was not loaded",
  );
  assertCondition(observedPaths[0] === "/external/config/default.toml", "config runtime-root path mismatch");
  assertCondition(
    (await command(parseArgv(["config", "validate", "--config=/custom/config.toml"]), context)) === 0,
    "explicit config path was not accepted",
  );
  assertCondition(observedPaths[1] === "/custom/config.toml", "explicit config path was changed");
  const noRoot = createConfigCommand({
    loadConfig: () => {
      throw new Error("runtime-root failure must precede config load");
    },
    resolveRuntimeRoot: unavailable,
  });
  assertCondition(
    (await noRoot(parseArgv(["config", "show"]), context)) === 2,
    "missing runtime root was not rejected",
  );
  await runCliD02CoreBoundaries();
  await runCliD02ReadOnlyBoundaries();
  await runCliD02ConfigCommandBoundaries();
  await runCliD02StartBoundaries();
  runCliD02BacktestBoundaries();
}
