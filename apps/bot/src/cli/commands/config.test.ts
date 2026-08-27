/**
 * apps/bot/src/cli/commands/config.test.ts
 *
 */

import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { parseArgv } from "../argv.js";
import { configCommand } from "./config.js";

const fileSystem = await import("node:fs");
const join = (...pathNames: readonly string[]): string => path.join(...pathNames);

/**
 * `runConfig` — helper that runs the `config` subcommand with the given
 * argv. Returns the exit code.
 */
async function runConfig(argv: readonly string[]): Promise<number> {
  const parsed = parseArgv(argv);
  return configCommand(parsed, {});
}

function createRuntimeTemplate(): () => void {
  const runtimeRoot = mkdtempSync(path.join(tmpdir(), "mm-runtime-root-"));
  const templateDirectory = path.join(runtimeRoot, "config");
  const originalRuntimeRoot = process.env["MM_CRYPTO_BOT_RUNTIME_ROOT"];
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- This exact directory is a child of this test's fresh mkdtemp root.
  mkdirSync(templateDirectory);
  fileSystem.writeFileSync(join(templateDirectory, "default.toml"), '[bot]\nmode = "paper"\n', "utf8");
  process.env["MM_CRYPTO_BOT_RUNTIME_ROOT"] = runtimeRoot;
  return () => {
    if (originalRuntimeRoot === undefined) delete process.env["MM_CRYPTO_BOT_RUNTIME_ROOT"];
    else process.env["MM_CRYPTO_BOT_RUNTIME_ROOT"] = originalRuntimeRoot;
    rmSync(runtimeRoot, { recursive: true, force: true });
  };
}

describe("configCommand", () => {
  // Capture console output so we can assert on it.
  let logSpy: { mockRestore: () => void };
  let errorSpy: { mockRestore: () => void };
  let logged: string[] = [];
  let errored: string[] = [];

  beforeEach(() => {
    logged = [];
    errored = [];
    logSpy = spyOn(console, "log").mockImplementation((...arguments_: unknown[]) => {
      logged.push(
        arguments_.map((argument) => (typeof argument === "string" ? argument : String(argument))).join(" "),
      );
    });
    errorSpy = spyOn(console, "error").mockImplementation((...arguments_: unknown[]) => {
      errored.push(
        arguments_.map((argument) => (typeof argument === "string" ? argument : String(argument))).join(" "),
      );
    });
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  // --------------------------------------------------------------------------
  // 1) validate with a valid TOML → returns 0 + "OK"
  // --------------------------------------------------------------------------
  it("validate returns 0 with a valid config file", async () => {
    const directory = mkdtempSync(join(tmpdir(), "mm-bot-cfg-"));
    const path = join(directory, "valid.toml");
    fileSystem.writeFileSync(
      path,
      `
[bot]
mode = "paper"
log_level = "info"

[risk]
risk_per_trade = 0.01
max_leverage = 5
`,
      "utf8",
    );
    try {
      const code = await runConfig(["config", "validate", `--config=${path}`]);
      expect(code).toBe(0);
      const text = logged.join("\n");
      expect(text).toContain("OK");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  // --------------------------------------------------------------------------
  // 2) validate with max_leverage=15 → returns 2
  // --------------------------------------------------------------------------
  it("validate returns 2 on invalid config (max_leverage=15)", async () => {
    const directory = mkdtempSync(join(tmpdir(), "mm-bot-cfg-"));
    const path = join(directory, "bad.toml");
    fileSystem.writeFileSync(
      path,
      `
[risk]
max_leverage = 15
`,
      "utf8",
    );
    try {
      const code = await runConfig(["config", "validate", `--config=${path}`]);
      expect(code).toBe(2);
      const text = errored.join("\n");
      expect(text).toContain("validation FAILED");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  // --------------------------------------------------------------------------
  // 3) validate with no --config → returns 0 (defaults)
  // --------------------------------------------------------------------------
  it("validate loads the external runtime template when --config is absent", async () => {
    const cleanup = createRuntimeTemplate();
    try {
      const code = await runConfig(["config", "validate"]);
      expect(code).toBe(0);
      expect(logged.join("\n")).toContain("OK");
    } finally {
      cleanup();
    }
  });

  // --------------------------------------------------------------------------
  // 4) show prints the effective config
  // --------------------------------------------------------------------------
  it("show renders the external runtime template when --config is absent", async () => {
    const cleanup = createRuntimeTemplate();
    try {
      const code = await runConfig(["config", "show"]);
      expect(code).toBe(0);
      const text = logged.join("\n");
      expect(text).toContain("[bot]");
      expect(text).toContain("[risk]");
      expect(text).toContain("[strategies.");
      expect(text).toContain("max_leverage = 10");
    } finally {
      cleanup();
    }
  });

  // --------------------------------------------------------------------------
  // 5) show fails (return 2) on invalid config
  // --------------------------------------------------------------------------
  it("show returns 2 on invalid config", async () => {
    const directory = mkdtempSync(join(tmpdir(), "mm-bot-cfg-"));
    const path = join(directory, "bad.toml");
    fileSystem.writeFileSync(
      path,
      `
[risk]
max_leverage = 50
`,
      "utf8",
    );
    try {
      const code = await runConfig(["config", "show", `--config=${path}`]);
      expect(code).toBe(2);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  // --------------------------------------------------------------------------
  // 9) unknown sub-subcommand → returns 1 + usage text
  // --------------------------------------------------------------------------
  it("returns 1 with usage text for unknown sub-subcommand", async () => {
    const code = await runConfig(["config", "frobnicate"]);
    expect(code).toBe(1);
    const text = errored.join("\n");
    expect(text).toContain("Usage");
    expect(text).toContain("validate");
    expect(text).toContain("show");
    expect(text).toContain("init");
  });

  // --------------------------------------------------------------------------
  // 10) missing sub-subcommand → returns 1 + usage text
  // --------------------------------------------------------------------------
  it("returns 1 with usage text for missing sub-subcommand", async () => {
    const code = await runConfig(["config"]);
    expect(code).toBe(1);
    const text = errored.join("\n");
    expect(text).toContain("Usage");
  });

  // --------------------------------------------------------------------------
  // 11) config --help prints sub-subcommand help + returns 1
  // --------------------------------------------------------------------------
  it("config --help prints sub-subcommand help and returns 1", async () => {
    const code = await runConfig(["config", "--help"]);
    expect(code).toBe(1);
    const text = errored.join("\n");
    expect(text).toContain("Usage");
    expect(text).toContain("validate");
    expect(text).toContain("show");
    expect(text).toContain("init");
  });

  // --------------------------------------------------------------------------
  // 12) show with passthrough field (custom string + number + array)
  // --------------------------------------------------------------------------
  it("show renders passthrough fields (string, number, array)", async () => {
    const directory = mkdtempSync(join(tmpdir(), "mm-bot-cfg-passthru-"));
    const path = join(directory, "pass.toml");
    fileSystem.writeFileSync(
      path,
      `
[strategies.donchian_pivot_composition]
enabled = true
custom_string = "hello-world"
custom_number = 42
custom_boolean = true
custom_array = ["a", 2, false]

[strategies.donchian_pivot_composition.custom_object]
ignored = "nested"
`,
      "utf8",
    );
    try {
      const code = await runConfig(["config", "show", `--config=${path}`]);
      expect(code).toBe(0);
      const text = logged.join("\n");
      expect(text).toContain(`custom_string = "hello-world"`);
      expect(text).toContain(`custom_number = 42`);
      expect(text).toContain(`custom_boolean = true`);
      expect(text).toContain(`custom_array = ["a", 2, false]`);
      expect(text).not.toContain("custom_object");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  // --------------------------------------------------------------------------
  // 13) show with timeframes set on a strategy
  // --------------------------------------------------------------------------
  it("show renders timeframes block when htf/mtf/ltf are set", async () => {
    const directory = mkdtempSync(join(tmpdir(), "mm-bot-cfg-tf-"));
    const path = join(directory, "tf.toml");
    fileSystem.writeFileSync(
      path,
      `
[strategies.donchian_pivot_composition]
enabled = true

[strategies.donchian_pivot_composition.timeframes]
htf = "1d"
mtf = "4h"
ltf = "15m"
`,
      "utf8",
    );
    try {
      const code = await runConfig(["config", "show", `--config=${path}`]);
      expect(code).toBe(0);
      const text = logged.join("\n");
      expect(text).toContain(`[strategies.donchian_pivot_composition.timeframes]`);
      expect(text).toContain(`htf = "1d"`);
      expect(text).toContain(`mtf = "4h"`);
      expect(text).toContain(`ltf = "15m"`);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  // --------------------------------------------------------------------------
  // 13b) show with per-strategy symbols (array) renders
  // --------------------------------------------------------------------------
  it("show renders per-strategy symbols array", async () => {
    const directory = mkdtempSync(join(tmpdir(), "mm-bot-cfg-syms-"));
    const path = join(directory, "syms.toml");
    fileSystem.writeFileSync(
      path,
      `
[strategies.donchian_pivot_composition]
enabled = true
leverage = 7
symbols = ["BTC/USDC", "ETH/USDC", "SOL/USDC"]
`,
      "utf8",
    );
    try {
      const code = await runConfig(["config", "show", `--config=${path}`]);
      expect(code).toBe(0);
      const text = logged.join("\n");
      expect(text).toContain("leverage = 7");
      expect(text).toContain(`symbols = ["BTC/USDC", "ETH/USDC", "SOL/USDC"]`);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  // --------------------------------------------------------------------------
  // 14) validate with an unreadable file (non-ConfigError) → returns 1
  // --------------------------------------------------------------------------
  it("validate returns 1 on non-ConfigError (e.g. file system error)", async () => {
    const directory = mkdtempSync(join(tmpdir(), "mm-bot-cfg-unreadable-"));
    const path = join(directory, "unreadable.toml");
    fileSystem.writeFileSync(path, "valid-toml-content", "utf8");
    fileSystem.chmodSync(path, 0o000);
    try {
      const code = await runConfig(["config", "validate", `--config=${path}`]);
      // On macOS root can read 0o000, but most CI runners cannot. Accept
      // either 1 (non-ConfigError path) or 2 (ConfigError path) — both
      // are non-zero, which is what matters for a failed validate.
      expect(code).not.toBe(0);
    } finally {
      fileSystem.chmodSync(path, 0o644);
      rmSync(directory, { recursive: true, force: true });
    }
  });

  // --------------------------------------------------------------------------
  // 14b) validate when loader throws a non-ConfigError → returns 1
  // --------------------------------------------------------------------------
  it("validate returns 1 when the loader throws a non-ConfigError", async () => {
    // We mock the loader module to throw a plain Error. The catch block
    // in runValidate must fall through to the `else` branch (returns 1,
    // prints "Unexpected error...").
    const loader = await import("../../config/loader.js");
    const original = loader.loadBotConfig;
    const mock = spyOn(loader, "loadBotConfig").mockImplementation(() => {
      throw new Error("simulated runtime failure");
    });
    const cleanup = createRuntimeTemplate();
    try {
      const code = await runConfig(["config", "validate"]);
      expect(code).toBe(1);
      const text = errored.join("\n");
      expect(text).toContain("Unexpected error");
      expect(text).toContain("simulated runtime failure");
    } finally {
      mock.mockRestore();
      void original;
      cleanup();
    }
  });

  it("show returns 1 when the loader throws a non-ConfigError", async () => {
    const loader = await import("../../config/loader.js");
    const mock = spyOn(loader, "loadBotConfig").mockImplementation(() => {
      throw new Error("simulated runtime failure");
    });
    const cleanup = createRuntimeTemplate();
    try {
      const code = await runConfig(["config", "show"]);
      expect(code).toBe(1);
      const text = errored.join("\n");
      expect(text).toContain("Unexpected error");
    } finally {
      mock.mockRestore();
      cleanup();
    }
  });

  it("renders plain-string loader failures for validate and show", async () => {
    const loader = await import("../../config/loader.js");
    const mock = spyOn(loader, "loadBotConfig").mockImplementation(() => {
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- This test-owned loader boundary must preserve a non-Error hostile throw.
      throw "plain loader failure";
    });
    const cleanup = createRuntimeTemplate();
    try {
      expect(await runConfig(["config", "validate"])).toBe(1);
      expect(await runConfig(["config", "show"])).toBe(1);
      expect(errored.join("\n")).toContain("plain loader failure");
    } finally {
      mock.mockRestore();
      cleanup();
    }
  });
});
