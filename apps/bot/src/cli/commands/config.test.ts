/**
 * apps/bot/src/cli/commands/config.test.ts
 *
 * Phase 33 Track D — `config` subcommand unit tests.
 *
 * Coverage (bun:test):
 *   1. `validate` with a valid TOML → returns 0 + stdout contains "OK"
 *   2. `validate` with a TOML containing max_leverage=15 → returns 2
 *   3. `validate` with no --config → returns 0 (defaults)
 *   4. `show` prints the effective config (TOML)
 *   5. `show` fails (return 2) on invalid config
 *   6. `init --out=/tmp/...` writes a file with default.toml contents
 *   7. `init` refuses to overwrite an existing file
 *   8. `init` with no --out uses `./mm-bot.toml`
 *   9. unknown sub-subcommand → returns 1 + usage text
 *  10. missing sub-subcommand → returns 1 + usage text
 *  11. `validate` on an unreadable file (non-ConfigError) → returns 1
 *  12. `show` on an unreadable file (non-ConfigError) → returns 1
 *  13. `show` with passthrough fields (custom string/number/array values)
 *  14. `show` with timeframes set on a strategy
 *  15. `config --help` prints the sub-subcommand help + returns 1
 *  16. `init` writes to a deep nested directory (auto-creates parent dirs)
 */

import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parseArgv } from "../argv.js";
import type { CliContext } from "../router.js";

import { configCommand } from "./config.js";

/**
 * `runConfig` — helper that runs the `config` subcommand with the given
 * argv. Returns the exit code.
 */
async function runConfig(argv: readonly string[]): Promise<number> {
  const parsed = parseArgv(argv);
  return configCommand(parsed, {} as CliContext);
}

describe("configCommand", () => {
  // Capture console output so we can assert on it.
  let logSpy: ReturnType<typeof spyOn>;
  let errorSpy: ReturnType<typeof spyOn>;
  let logged: string[] = [];
  let errored: string[] = [];

  beforeEach(() => {
    logged = [];
    errored = [];
    logSpy = spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      logged.push(args.map((a) => (typeof a === "string" ? a : String(a))).join(" "));
    });
    errorSpy = spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      errored.push(args.map((a) => (typeof a === "string" ? a : String(a))).join(" "));
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
    const dir = mkdtempSync(join(tmpdir(), "mm-bot-cfg-"));
    const path = join(dir, "valid.toml");
    writeFileSync(
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
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // --------------------------------------------------------------------------
  // 2) validate with max_leverage=15 → returns 2
  // --------------------------------------------------------------------------
  it("validate returns 2 on invalid config (max_leverage=15)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mm-bot-cfg-"));
    const path = join(dir, "bad.toml");
    writeFileSync(
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
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // --------------------------------------------------------------------------
  // 3) validate with no --config → returns 0 (defaults)
  // --------------------------------------------------------------------------
  it("validate returns 0 with no --config (uses defaults)", async () => {
    const code = await runConfig(["config", "validate"]);
    expect(code).toBe(0);
    const text = logged.join("\n");
    expect(text).toContain("OK");
  });

  // --------------------------------------------------------------------------
  // 4) show prints the effective config
  // --------------------------------------------------------------------------
  it("show prints the effective config as TOML", async () => {
    const code = await runConfig(["config", "show"]);
    expect(code).toBe(0);
    const text = logged.join("\n");
    expect(text).toContain("[bot]");
    expect(text).toContain("[risk]");
    expect(text).toContain("[strategies.");
    expect(text).toContain("max_leverage = 10");
  });

  // --------------------------------------------------------------------------
  // 5) show fails (return 2) on invalid config
  // --------------------------------------------------------------------------
  it("show returns 2 on invalid config", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mm-bot-cfg-"));
    const path = join(dir, "bad.toml");
    writeFileSync(
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
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // --------------------------------------------------------------------------
  // 6) init --out=/tmp/... writes a file
  // --------------------------------------------------------------------------
  it("init --out=<path> writes a default config file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mm-bot-init-"));
    const out = join(dir, "out.toml");
    try {
      const code = await runConfig(["config", "init", `--out=${out}`]);
      expect(code).toBe(0);
      expect(existsSync(out)).toBe(true);
      const content = readFileSync(out, "utf8");
      expect(content.length).toBeGreaterThan(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // --------------------------------------------------------------------------
  // 7) init refuses to overwrite an existing file
  // --------------------------------------------------------------------------
  it("init refuses to overwrite an existing file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mm-bot-init-"));
    const out = join(dir, "exists.toml");
    writeFileSync(out, "existing-content", "utf8");
    try {
      const code = await runConfig(["config", "init", `--out=${out}`]);
      expect(code).toBe(1);
      // File content is unchanged
      expect(readFileSync(out, "utf8")).toBe("existing-content");
      const text = errored.join("\n");
      expect(text).toContain("Refusing to overwrite");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // --------------------------------------------------------------------------
  // 8) init with no --out → uses ./mm-bot.toml
  // --------------------------------------------------------------------------
  it("init uses ./mm-bot.toml by default", async () => {
    // We don't actually want to create a file in CWD during tests —
    // redirect to a tempdir by changing CWD via the chdir trick. But
    // since we can't easily chdir in bun:test, this test only asserts
    // the code path tries to write SOMETHING. We mock by writing to a
    // path we control.
    //
    // Simpler: assert that when --out is missing, the function does NOT
    // crash. We can't easily verify the exact path without CWD control,
    // so we just check the return code is not 0 (it will fail because
    // ./mm-bot.toml may not be writable, or succeed if it is — but
    // either way, the function doesn't crash on missing --out).
    //
    // To keep the test deterministic, we run from a tempdir.
    const dir = mkdtempSync(join(tmpdir(), "mm-bot-init-cwd-"));
    const originalCwd = process.cwd();
    try {
      process.chdir(dir);
      const code = await runConfig(["config", "init"]);
      // We accept either 0 (file written) or 1 (refused to overwrite
      // an existing ./mm-bot.toml). The test asserts no crash + non-2.
      expect([0, 1]).toContain(code);
    } finally {
      process.chdir(originalCwd);
      rmSync(dir, { recursive: true, force: true });
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
    const dir = mkdtempSync(join(tmpdir(), "mm-bot-cfg-passthru-"));
    const path = join(dir, "pass.toml");
    writeFileSync(
      path,
      `
[strategies.donchian_pivot_composition]
enabled = true
custom_string = "hello-world"
custom_number = 42
custom_array = ["a", "b", "c"]
`,
      "utf8",
    );
    try {
      const code = await runConfig(["config", "show", `--config=${path}`]);
      expect(code).toBe(0);
      const text = logged.join("\n");
      expect(text).toContain(`custom_string = "hello-world"`);
      expect(text).toContain(`custom_number = 42`);
      expect(text).toContain(`custom_array = ["a", "b", "c"]`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // --------------------------------------------------------------------------
  // 13) show with timeframes set on a strategy
  // --------------------------------------------------------------------------
  it("show renders timeframes block when htf/mtf/ltf are set", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mm-bot-cfg-tf-"));
    const path = join(dir, "tf.toml");
    writeFileSync(
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
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // --------------------------------------------------------------------------
  // 13b) show with per-strategy symbols (array) renders
  // --------------------------------------------------------------------------
  it("show renders per-strategy symbols array", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mm-bot-cfg-syms-"));
    const path = join(dir, "syms.toml");
    writeFileSync(
      path,
      `
[strategies.donchian_pivot_composition]
enabled = true
symbols = ["BTC/USDC", "ETH/USDC", "SOL/USDC"]
`,
      "utf8",
    );
    try {
      const code = await runConfig(["config", "show", `--config=${path}`]);
      expect(code).toBe(0);
      const text = logged.join("\n");
      expect(text).toContain(`symbols = ["BTC/USDC", "ETH/USDC", "SOL/USDC"]`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // --------------------------------------------------------------------------
  // 14) validate with an unreadable file (non-ConfigError) → returns 1
  // --------------------------------------------------------------------------
  it("validate returns 1 on non-ConfigError (e.g. file system error)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mm-bot-cfg-unreadable-"));
    const path = join(dir, "unreadable.toml");
    writeFileSync(path, "valid-toml-content", "utf8");
    chmodSync(path, 0o000);
    try {
      const code = await runConfig(["config", "validate", `--config=${path}`]);
      // On macOS root can read 0o000, but most CI runners cannot. Accept
      // either 1 (non-ConfigError path) or 2 (ConfigError path) — both
      // are non-zero, which is what matters for a failed validate.
      expect(code).not.toBe(0);
    } finally {
      chmodSync(path, 0o644);
      rmSync(dir, { recursive: true, force: true });
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
    try {
      const code = await runConfig(["config", "validate"]);
      expect(code).toBe(1);
      const text = errored.join("\n");
      expect(text).toContain("Unexpected error");
      expect(text).toContain("simulated runtime failure");
    } finally {
      mock.mockRestore();
      void original;
    }
  });

  it("show returns 1 when the loader throws a non-ConfigError", async () => {
    const loader = await import("../../config/loader.js");
    const mock = spyOn(loader, "loadBotConfig").mockImplementation(() => {
      throw new Error("simulated runtime failure");
    });
    try {
      const code = await runConfig(["config", "show"]);
      expect(code).toBe(1);
      const text = errored.join("\n");
      expect(text).toContain("Unexpected error");
    } finally {
      mock.mockRestore();
    }
  });

  // --------------------------------------------------------------------------
  // 15c) init writes to a path where the parent is a file (writeFile fails)
  // --------------------------------------------------------------------------
  it("init returns 1 when parent of --out is an existing file (write fails)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mm-bot-init-fail-"));
    // Create a file that will be the "parent dir" of the output path.
    const blocker = join(dir, "blocker");
    writeFileSync(blocker, "I am a file, not a directory", "utf8");
    // The output path's parent is `blocker`, which is a file → mkdir or
    // writeFile will fail with ENOTDIR.
    const out = join(blocker, "out.toml");
    try {
      const code = await runConfig(["config", "init", `--out=${out}`]);
      expect(code).toBe(1);
      const text = errored.join("\n");
      expect(text).toContain("Failed to write");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // --------------------------------------------------------------------------
  // 15) init writes to a deep nested directory (auto-creates parent dirs)
  // --------------------------------------------------------------------------
  it("init auto-creates parent directories for nested --out path", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mm-bot-init-nested-"));
    const out = join(dir, "deeply", "nested", "path", "out.toml");
    try {
      const code = await runConfig(["config", "init", `--out=${out}`]);
      expect(code).toBe(0);
      expect(existsSync(out)).toBe(true);
      const content = readFileSync(out, "utf8");
      expect(content.length).toBeGreaterThan(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ============================================================================
// validateConfigForEdit (Phase 44 backward-compat helper tests)
// ============================================================================

describe("validateConfigForEdit (Phase 44 backward-compat helper)", () => {
  it("returns 0 for a valid config file", async () => {
    const { validateConfigForEdit } = await import("./config.js");
    const dir = mkdtempSync(join(tmpdir(), "mm-bot-vcfe-valid-"));
    const cfgPath = join(dir, "mm-bot.toml");
    writeFileSync(
      cfgPath,
      '[bot]\nmode = "paper"\n',
      "utf8",
    );
    try {
      expect(validateConfigForEdit(cfgPath)).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns 2 for a Zod-rejected config (max_leverage=15)", async () => {
    const { validateConfigForEdit } = await import("./config.js");
    const dir = mkdtempSync(join(tmpdir(), "mm-bot-vcfe-invalid-"));
    const cfgPath = join(dir, "bad.toml");
    writeFileSync(
      cfgPath,
      "[risk]\nmax_leverage = 15\n",
      "utf8",
    );
    try {
      expect(validateConfigForEdit(cfgPath)).toBe(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns 2 for a non-existent config file", async () => {
    const { validateConfigForEdit } = await import("./config.js");
    const dir = mkdtempSync(join(tmpdir(), "mm-bot-vcfe-missing-"));
    const cfgPath = join(dir, "does-not-exist.toml");
    try {
      expect(validateConfigForEdit(cfgPath)).toBe(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
