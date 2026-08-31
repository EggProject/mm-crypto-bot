import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import nodePath from "node:path";

import { DEFAULT_BOT_CONFIG } from "../../config/defaults.js";
import { parseArgv } from "../argv.js";

import { configCommand, createConfigCommand, runConfigInit, type ConfigFileBoundary } from "./config.js";

const fileSystem = await import("node:fs");
const defaultTemplatePath = nodePath.resolve("run-bot/config/default.toml");

/**
 * `runConfig` — helper that runs the `config` subcommand with the given
 * argv. Returns the exit code.
 */
async function runConfig(argv: readonly string[]): Promise<number> {
  const parsed = parseArgv(argv);
  return configCommand(parsed, {});
}

function createNonErrorFailure(message: string): Error & { readonly toString: () => string } {
  return {
    name: "NonErrorFailure",
    message,
    toString: () => message,
  };
}

describe("configCommand", () => {
  // Capture console output so we can assert on it.
  let restoreOutputSpies: (() => void) | undefined;
  let logged: string[] = [];
  let errored: string[] = [];

  beforeEach(() => {
    logged = [];
    errored = [];
    const logSpy = spyOn(console, "log").mockImplementation((...values: unknown[]) => {
      logged.push(values.map((value) => (typeof value === "string" ? value : String(value))).join(" "));
    });
    const errorSpy = spyOn(console, "error").mockImplementation((...values: unknown[]) => {
      errored.push(values.map((value) => (typeof value === "string" ? value : String(value))).join(" "));
    });
    restoreOutputSpies = () => {
      logSpy.mockRestore();
      errorSpy.mockRestore();
    };
  });

  afterEach(() => {
    restoreOutputSpies?.();
  });

  // --------------------------------------------------------------------------
  // 1) validate with a valid TOML → returns 0 + "OK"
  // --------------------------------------------------------------------------
  it("validate returns 0 with a valid config file", async () => {
    const directory = mkdtempSync(nodePath.join(tmpdir(), "bot-config-"));
    const configPath = nodePath.join(directory, "valid.toml");
    fileSystem.writeFileSync(
      configPath,
      `
[bot]
mode = "paper"
log_level = "info"

[risk]
risk_per_trade = 0.01
max_leverage = 10
`,
      "utf8",
    );
    try {
      const code = await runConfig(["config", "validate", `--config=${configPath}`]);
      expect(code).toBe(0);
      const text = logged.join("\n");
      expect(text).toContain("OK");
      expect(text).toContain(`config: ${configPath}`);
      expect(text).not.toContain("config: <defaults>");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  // --------------------------------------------------------------------------
  // 2) validate with max_leverage=15 → returns 2
  // --------------------------------------------------------------------------
  it("validate returns 2 on invalid config (max_leverage=15)", async () => {
    const directory = mkdtempSync(nodePath.join(tmpdir(), "bot-config-"));
    const configPath = nodePath.join(directory, "bad.toml");
    fileSystem.writeFileSync(
      configPath,
      `
[risk]
max_leverage = 15
`,
      "utf8",
    );
    try {
      const code = await runConfig(["config", "validate", `--config=${configPath}`]);
      expect(code).toBe(2);
      const text = errored.join("\n");
      expect(text).toContain("validation FAILED");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  // --------------------------------------------------------------------------
  // 3) validate with no --config → fails closed when no runtime root resolves
  // --------------------------------------------------------------------------
  it("validate fails before loading when no default runtime root is available", async () => {
    let loadCalls = 0;
    const command = createConfigCommand({
      loadConfig: () => {
        loadCalls += 1;
        return DEFAULT_BOT_CONFIG;
      },
      resolveRuntimeRoot: () => ({
        ok: false,
        error: { code: "runtime-root-missing", message: "Runtime configuration root is unavailable." },
      }),
    });

    expect(await command(parseArgv(["config", "validate"]), {})).toBe(2);
    expect(loadCalls).toBe(0);
  });

  it("validate loads and reports the resolved external runtime-root path", async () => {
    const runtimeConfigPath = "/var/lib/mm-bot/config/default.toml";
    const command = createConfigCommand({
      loadConfig: (configPath) => {
        expect(configPath).toBe(runtimeConfigPath);
        return DEFAULT_BOT_CONFIG;
      },
      resolveRuntimeRoot: () => ({ ok: true, runtimeRoot: "/var/lib/mm-bot", configPath: runtimeConfigPath }),
    });

    expect(await command(parseArgv(["config", "validate"]), {})).toBe(0);
    expect(logged.join("\n")).toContain(`config: ${runtimeConfigPath}`);
    expect(logged.join("\n")).not.toContain("config: <defaults>");
  });

  it("show prints the effective config as TOML", async () => {
    const code = await runConfig(["config", "show", `--config=${defaultTemplatePath}`]);
    expect(code).toBe(0);
    const text = logged.join("\n");
    expect(text).toContain("[bot]");
    expect(text).toContain("[risk]");
    expect(text).toContain("[strategies.");
    expect(text).toContain("max_leverage = 10");
    expect(text).not.toContain("sandbox =");
    expect(text).toContain("notional_per_leg_usd = 125000");
    expect(text).toContain("max_notional_per_event_usd = 1000000");
    expect(text).toContain("cooldown_hours = 24");
  });

  // --------------------------------------------------------------------------
  // 5) show fails (return 2) on invalid config
  // --------------------------------------------------------------------------
  it("show returns 2 on invalid config", async () => {
    const directory = mkdtempSync(nodePath.join(tmpdir(), "bot-config-"));
    const configPath = nodePath.join(directory, "bad.toml");
    fileSystem.writeFileSync(
      configPath,
      `
[risk]
max_leverage = 50
`,
      "utf8",
    );
    try {
      const code = await runConfig(["config", "show", `--config=${configPath}`]);
      expect(code).toBe(2);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  // --------------------------------------------------------------------------
  // 6) init --out=/tmp/... writes a file
  // --------------------------------------------------------------------------
  it("init --out=<path> writes a default config file", async () => {
    const directory = mkdtempSync(nodePath.join(tmpdir(), "bot-config-init-"));
    const out = nodePath.join(directory, "out.toml");
    try {
      const code = await runConfig(["config", "init", `--config=${defaultTemplatePath}`, `--out=${out}`]);
      expect(code).toBe(0);
      expect(fileSystem.existsSync(out)).toBe(true);
      const content = fileSystem.readFileSync(out, "utf8");
      expect(content.length).toBeGreaterThan(0);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  // --------------------------------------------------------------------------
  // 7) init refuses to overwrite an existing file
  // --------------------------------------------------------------------------
  it("init refuses to overwrite an existing file", async () => {
    const directory = mkdtempSync(nodePath.join(tmpdir(), "bot-config-init-"));
    const out = nodePath.join(directory, "exists.toml");
    fileSystem.writeFileSync(out, "existing-content", "utf8");
    try {
      const code = await runConfig(["config", "init", `--config=${defaultTemplatePath}`, `--out=${out}`]);
      expect(code).toBe(1);
      // File content is unchanged
      expect(fileSystem.readFileSync(out, "utf8")).toBe("existing-content");
      const text = errored.join("\n");
      expect(text).toContain("Refusing to overwrite");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("init uses its default output path independently of cwd", async () => {
    // The target is deliberately CWD-relative, but the canonical source
    // template must be resolved relative to the module. This regression
    // catches suite-order/process.chdir leakage in the init path.
    const directory = mkdtempSync(nodePath.join(tmpdir(), "bot-config-init-cwd-"));
    const originalCwd = process.cwd();
    try {
      process.chdir(directory);
      const code = await runConfig(["config", "init", `--config=${defaultTemplatePath}`]);
      expect(code).toBe(0);
      expect(fileSystem.existsSync(nodePath.join(directory, "mm-bot.toml"))).toBe(true);
      expect(fileSystem.readFileSync(nodePath.join(directory, "mm-bot.toml"), "utf8").length).toBeGreaterThan(
        0,
      );
    } finally {
      process.chdir(originalCwd);
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
  // 12) show rejects an unknown strategy field
  // --------------------------------------------------------------------------
  it("show returns 2 and reports an unknown strategy field", async () => {
    const directory = mkdtempSync(nodePath.join(tmpdir(), "bot-config-unknown-strategy-field-"));
    const configPath = nodePath.join(directory, "invalid.toml");
    fileSystem.writeFileSync(
      configPath,
      `
[strategies.donchian_pivot_composition]
enabled = true
custom_string = "hello-world"
`,
      "utf8",
    );
    try {
      const code = await runConfig(["config", "show", `--config=${configPath}`]);
      expect(code).toBe(2);
      const text = errored.join("\n");
      expect(text).toContain("Config validation FAILED:");
      expect(text).toContain("strategies.donchian_pivot_composition");
      expect(text).toContain("Unrecognized key(s) in object: 'custom_string'");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  // --------------------------------------------------------------------------
  // 13) show with timeframes set on a strategy
  // --------------------------------------------------------------------------
  it("show renders timeframes block when htf/mtf/ltf are set", async () => {
    const directory = mkdtempSync(nodePath.join(tmpdir(), "bot-config-timeframes-"));
    const configPath = nodePath.join(directory, "tf.toml");
    fileSystem.writeFileSync(
      configPath,
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
      const code = await runConfig(["config", "show", `--config=${configPath}`]);
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
  // 14) validate with an unreadable file (non-ConfigError) → returns 1
  // --------------------------------------------------------------------------
  it("validate returns 1 on non-ConfigError (e.g. file system error)", async () => {
    const directory = mkdtempSync(nodePath.join(tmpdir(), "bot-config-unreadable-"));
    const configPath = nodePath.join(directory, "unreadable.toml");
    fileSystem.writeFileSync(configPath, "valid-toml-content", "utf8");
    fileSystem.chmodSync(configPath, 0o000);
    try {
      const code = await runConfig(["config", "validate", `--config=${configPath}`]);
      // On macOS root can read 0o000, but most CI runners cannot. Accept
      // either 1 (non-ConfigError path) or 2 (ConfigError path) — both
      // are non-zero, which is what matters for a failed validate.
      expect(code).not.toBe(0);
    } finally {
      fileSystem.chmodSync(configPath, 0o644);
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
    const mock = spyOn(loader, "loadBotConfig").mockImplementation(() => {
      throw new Error("simulated runtime failure");
    });
    try {
      const code = await runConfig(["config", "validate", `--config=${defaultTemplatePath}`]);
      expect(code).toBe(1);
      const text = errored.join("\n");
      expect(text).toContain("Unexpected error");
      expect(text).toContain("simulated runtime failure");
    } finally {
      mock.mockRestore();
    }
  });

  it("show returns 1 when the loader throws a non-ConfigError", async () => {
    const loader = await import("../../config/loader.js");
    const mock = spyOn(loader, "loadBotConfig").mockImplementation(() => {
      throw new Error("simulated runtime failure");
    });
    try {
      const code = await runConfig(["config", "show", `--config=${defaultTemplatePath}`]);
      expect(code).toBe(1);
      const text = errored.join("\n");
      expect(text).toContain("Unexpected error");
    } finally {
      mock.mockRestore();
    }
  });

  it("renders non-Error loader failures for validate and show", async () => {
    const loader = await import("../../config/loader.js");
    const mock = spyOn(loader, "loadBotConfig").mockImplementation(() => {
      throw createNonErrorFailure("plain loader failure");
    });
    try {
      expect(await runConfig(["config", "validate", `--config=${defaultTemplatePath}`])).toBe(1);
      expect(await runConfig(["config", "show", `--config=${defaultTemplatePath}`])).toBe(1);
      expect(errored.join("\n")).toContain("plain loader failure");
    } finally {
      mock.mockRestore();
    }
  });

  // --------------------------------------------------------------------------
  // 15c) init writes to a path where the parent is a file (writeFile fails)
  // --------------------------------------------------------------------------
  it("init returns 1 when parent of --out is an existing file (write fails)", async () => {
    const directory = mkdtempSync(nodePath.join(tmpdir(), "bot-config-init-fail-"));
    // Create a file that will be the "parent dir" of the output path.
    const blocker = nodePath.join(directory, "blocker");
    fileSystem.writeFileSync(blocker, "I am a file, not a directory", "utf8");
    // The output path's parent is `blocker`, which is a file → mkdir or
    // writeFile will fail with ENOTDIR.
    const out = nodePath.join(blocker, "out.toml");
    try {
      const code = await runConfig(["config", "init", `--config=${defaultTemplatePath}`, `--out=${out}`]);
      expect(code).toBe(1);
      const text = errored.join("\n");
      expect(text).toContain("Failed to write");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("init renders a non-Error boundary write failure", () => {
    const directory = mkdtempSync(nodePath.join(tmpdir(), "bot-config-init-boundary-fail-"));
    const out = nodePath.join(directory, "out.toml");
    const source = nodePath.join(directory, "source.toml");
    const boundary: ConfigFileBoundary = {
      exists: (candidatePath) => candidatePath === source || candidatePath === directory,
      read: () => '[bot]\nmode = "paper"\n',
      ensureDirectory: () => {
        // The in-memory boundary records no directory state for this failure test.
      },
      write: () => {
        throw createNonErrorFailure("plain write failure");
      },
    };
    try {
      expect(runConfigInit(out, source, boundary)).toBe(1);
      expect(errored.join("\n")).toContain("plain write failure");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("init returns 1 when its configured template file is missing", () => {
    const directory = mkdtempSync(nodePath.join(tmpdir(), "bot-config-init-template-missing-"));
    const out = nodePath.join(directory, "out.toml");
    try {
      const code = runConfigInit(out, nodePath.join(directory, "missing-template.toml"));
      expect(code).toBe(1);
      expect(fileSystem.existsSync(out)).toBe(false);
      expect(errored.join("\n")).toContain("Could not locate the runtime config template.");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("init rejects an invalid template path at the file boundary", () => {
    const directory = mkdtempSync(nodePath.join(tmpdir(), "bot-config-init-template-invalid-"));
    const out = nodePath.join(directory, "out.toml");
    try {
      expect(() => runConfigInit(out, "\0")).toThrow("normalized absolute path");
      expect(fileSystem.existsSync(out)).toBe(false);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("init auto-creates parent directories for nested --out path", async () => {
    const directory = mkdtempSync(nodePath.join(tmpdir(), "bot-config-init-nested-"));
    const out = nodePath.join(directory, "deeply", "nested", "path", "out.toml");
    try {
      const code = await runConfig(["config", "init", `--config=${defaultTemplatePath}`, `--out=${out}`]);
      expect(code).toBe(0);
      expect(fileSystem.existsSync(out)).toBe(true);
      const content = fileSystem.readFileSync(out, "utf8");
      expect(content.length).toBeGreaterThan(0);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
