/**
 * apps/bot/src/cli/cli-e2e.test.ts
 *
 * Phase 33 Track D — end-to-end CLI tests.
 *
 * These tests spawn the CLI as a subprocess and verify exit codes +
 * stdout/stderr output. They are slower than unit tests (each spawn
 * is a fresh `bun` process) so we keep the count small and only
 * cover the critical paths:
 *
 *   1. `mm-bot config validate --config=...` exits 0 + stdout contains "OK"
 *   2. `mm-bot strategies` exits 0 + stdout contains strategy names
 *   3. `mm-bot config validate --config=<bad>` exits 2
 *   4. `mm-bot help` exits 1 + stderr contains usage
 *   5. `mm-bot --help` exits 1 + stderr contains usage
 *   6. `mm-bot config --help` exits 1 + stderr contains validate/show/init
 *   7. `mm-bot nonexistent` exits 1 + stderr contains "Unknown subcommand"
 *
 * The CLI is invoked via `bun run apps/bot/src/index.ts <subcommand> ...`
 * from the workspace root, which is the canonical invocation pattern.
 *
 * The test uses `Bun.spawn` and reads `stdout` + `stderr` to completion
 * with a timeout. We do NOT mock the CLI internals — this is a true
 * end-to-end check.
 */

import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { buildBotE2eChildEnvironment } from "../../../../scripts/coverage-tools/bot-e2e-child-environment.ts";

/**
 * `runCli` — spawn the CLI and return the result.
 *
 * @param args   Args after `bun run apps/bot/src/index.ts` (e.g. `["config", "validate"]`).
 * @param opts.timeoutMs  Optional timeout in ms (default 30s).
 * @returns The exit code, stdout, and stderr.
 */
async function runCli(
  args: readonly string[],
  opts: { readonly caseId: string; readonly timeoutMs?: number },
): Promise<{ readonly code: number; readonly stdout: string; readonly stderr: string }> {
  const workspaceRoot = resolve(import.meta.dir, "../../../..");
  const entry = process.env["MM_BOT_E2E_ENTRY"] ?? resolve(workspaceRoot, "apps/bot/src/index.ts");
  const preload = process.env["MM_BOT_E2E_COVERAGE_PRELOAD"];
  const cmd = preload === undefined
    ? ["bun", "run", entry, ...args]
    : ["bun", "--preload", preload, entry, ...args];
  const proc = Bun.spawn({
    cmd,
    cwd: workspaceRoot,
    env: buildBotE2eChildEnvironment(process.env, {
      MM_BOT_E2E_ENTRY_KIND: "canonical-cli",
      MM_BOT_E2E_CASE_ID: opts.caseId,
    }),
    stdout: "pipe",
    stderr: "pipe",
  });

  const timeoutMs = opts.timeoutMs ?? 30_000;

  // We race the process against a timeout. If the process exits first,
  // we cancel the timer. If the timer fires first, we kill the process.
  const timer = setTimeout(() => {
    try {
      proc.kill();
    } catch {
      // best-effort
    }
  }, timeoutMs);

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  clearTimeout(timer);

  return { code: exitCode, stdout, stderr };
}

async function waitForFile(path: string, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await Bun.file(path).exists())) {
    if (Date.now() >= deadline) throw new Error(`timed out waiting for ${path}`);
    await Bun.sleep(10);
  }
}

describe("CLI end-to-end", () => {
  // --------------------------------------------------------------------------
  // 1) config validate with the canonical default.toml
  //    Phase 52D: relocated to `run-bot/config/default.toml` (52B
  //    relocation finalized; 52D makes it the canonical default).
  // --------------------------------------------------------------------------
  it("mm-bot config validate --config=run-bot/config/default.toml exits 0 with OK", async () => {
    const { code, stdout, stderr } = await runCli([
      "config",
      "validate",
      "--config=run-bot/config/default.toml",
    ], { caseId: "config-validate-default" });
    if (code !== 0) {
      // Surface stderr in the failure message for debuggability.
      throw new Error(`expected exit 0, got ${String(code)}\nstdout: ${stdout}\nstderr: ${stderr}`);
    }
    expect(code).toBe(0);
    expect(stdout).toContain("OK");
  });

  // --------------------------------------------------------------------------
  // 2) strategies command prints all registered strategies
  // --------------------------------------------------------------------------
  it("mm-bot strategies lists the configured strategies", async () => {
    const { code, stdout, stderr } = await runCli(["strategies"], { caseId: "strategies" });
    if (code !== 0) {
      throw new Error(`expected exit 0, got ${String(code)}\nstdout: ${stdout}\nstderr: ${stderr}`);
    }
    expect(code).toBe(0);
    // The default config has 5 strategies.
    expect(stdout).toContain("donchian_pivot_composition");
    expect(stdout).toContain("dydx_cex_carry");
    expect(stdout).toContain("cascade_fade");
    expect(stdout).toContain("funding_flip_kill_switch");
    expect(stdout).toContain("regime_detector");
    // And the OFF / ON markers.
    expect(stdout).toContain("[ON");
    expect(stdout).toContain("[OFF");
  });

  // --------------------------------------------------------------------------
  // 3) config validate with an invalid config exits 2
  // --------------------------------------------------------------------------
  it("mm-bot config validate exits 2 on an invalid config", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mm-bot-cli-e2e-"));
    const path = join(dir, "bad.toml");
    await Bun.write(path, "[risk]\nmax_leverage = 50\n");
    try {
      const { code, stderr } = await runCli(["config", "validate", `--config=${path}`], {
        caseId: "config-validate-invalid",
      });
      expect(code).toBe(2);
      expect(stderr).toContain("validation FAILED");
    } finally {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // best-effort
      }
    }
  });

  // --------------------------------------------------------------------------
  // 4) help subcommand prints usage to stderr
  // --------------------------------------------------------------------------
  it("mm-bot help prints usage and exits 1", async () => {
    const { code, stderr } = await runCli(["help"], { caseId: "help" });
    expect(code).toBe(1);
    expect(stderr).toContain("Usage");
    expect(stderr).toContain("start");
    expect(stderr).toContain("strategies");
  });

  // --------------------------------------------------------------------------
  // 5) --help at the top level prints usage
  // --------------------------------------------------------------------------
  it("mm-bot --help prints usage and exits 1", async () => {
    const { code, stderr } = await runCli(["--help"], { caseId: "global-help" });
    expect(code).toBe(1);
    expect(stderr).toContain("Usage");
  });

  it("mm-bot applies an explicit color override before routing", async () => {
    const { code, stderr } = await runCli(["help", "--color"], { caseId: "global-color" });
    expect(code).toBe(1);
    expect(stderr).toContain("Usage");
  });

  // --------------------------------------------------------------------------
  // 6) config --help lists the sub-subcommands
  // --------------------------------------------------------------------------
  it("mm-bot config --help lists validate/show/init", async () => {
    const { code, stderr } = await runCli(["config", "--help"], { caseId: "config-help" });
    expect(code).toBe(1);
    expect(stderr).toContain("validate");
    expect(stderr).toContain("show");
    expect(stderr).toContain("init");
  });

  // --------------------------------------------------------------------------
  // 7) unknown subcommand → exits 1 + "Unknown subcommand" in stderr
  // --------------------------------------------------------------------------
  it("mm-bot nonexistent exits 1 with an error message", async () => {
    const { code, stderr } = await runCli(["nonexistent"], { caseId: "unknown-command" });
    expect(code).toBe(1);
    expect(stderr).toContain("Unknown subcommand");
  });

  it("mm-bot start rejects an unknown option with actionable help", async () => {
    const { code, stderr } = await runCli(["start", "--mystery-option"], {
      caseId: "start-unknown-option",
    });
    expect(code).toBe(1);
    expect(stderr).toContain("Unknown start option");
    expect(stderr).toContain("mm-bot start --help");
  });

  it("mm-bot start rejects an unknown bot setting before runtime startup", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mm-bot-cli-strict-"));
    const path = join(dir, "unknown-setting.toml");
    await Bun.write(path, "[bot]\nmystery_setting = true\n");
    try {
      const { code, stderr } = await runCli(["start", `--config=${path}`], {
        caseId: "start-invalid-config",
      });
      expect(code).toBe(2);
      expect(stderr).toContain("Config validation FAILED");
      expect(stderr).toContain("bot");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("mm-bot start validates required values and positional arguments", async () => {
    const missingConfig = await runCli(["start", "--config"], {
      caseId: "start-missing-config-path",
    });
    expect(missingConfig.code).toBe(1);
    expect(missingConfig.stderr).toContain("requires a non-empty path");

    const colorValue = await runCli(["start", "--color=always"], {
      caseId: "start-invalid-color-value",
    });
    expect(colorValue.code).toBe(1);
    expect(colorValue.stderr).toContain("does not accept a value");

    const positional = await runCli(["start", "extra"], {
      caseId: "start-unexpected-argument",
    });
    expect(positional.code).toBe(1);
    expect(positional.stderr).toContain("Unexpected start argument");
  });

  it("mm-bot start --no-color --help prints the headless usage", async () => {
    const result = await runCli(["start", "--no-color", "--help"], {
      caseId: "start-help-no-color",
    });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("Usage: mm-bot start");
  });

  it("mm-bot start fails closed for a mock config without an injected feed", async () => {
    const directory = mkdtempSync(join(tmpdir(), "mm-bot-start-mock-e2e-"));
    const configPath = join(directory, "mock.toml");
    const stateFile = join(directory, "state.json");
    await Bun.write(configPath, [
      "[bot]",
      `state_file = ${JSON.stringify(stateFile)}`,
      "",
      "[exchange]",
      'id = "mock"',
    ].join("\n"));
    try {
      const result = await runCli(["start", `--config=${configPath}`], {
        caseId: "start-mock-no-feed",
      });
      expect(result.code).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain('"exchange":"mock"');
      expect(await Bun.file(`${stateFile}.log`).text()).toContain("MockExchangeFeed is test-only");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("mm-bot config show prints the effective default config", async () => {
    const result = await runCli(["config", "show", "--config=run-bot/config/default.toml"], {
      caseId: "config-show-default",
    });
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("[bot]");
    expect(result.stdout).toContain("[strategies.donchian_pivot_composition]");
  });

  it("mm-bot config without a nested command prints usage", async () => {
    const result = await runCli(["config"], { caseId: "config-missing-subcommand" });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("config <validate|show|init>");
  });

  it("mm-bot config init writes once and refuses to overwrite", async () => {
    const directory = mkdtempSync(join(tmpdir(), "mm-bot-config-init-e2e-"));
    const outputPath = join(directory, "nested", "mm-bot.toml");
    try {
      const created = await runCli(["config", "init", `--out=${outputPath}`], {
        caseId: "config-init-success",
      });
      expect(created.code).toBe(0);
      expect(created.stdout).toContain("Wrote");
      expect(await Bun.file(outputPath).exists()).toBe(true);

      const existing = await runCli(["config", "init", `--out=${outputPath}`], {
        caseId: "config-init-existing",
      });
      expect(existing.code).toBe(1);
      expect(existing.stderr).toContain("Refusing to overwrite");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("mm-bot backtest exposes help and rejects each invalid numeric boundary", async () => {
    const help = await runCli(["backtest"], { caseId: "backtest-help" });
    expect(help.code).toBe(0);
    expect(help.stdout).toContain("Usage: mm-bot backtest");

    const bars = await runCli(["backtest", "ohlc-trend", "--bars=49"], {
      caseId: "backtest-invalid-bars",
    });
    expect(bars.code).toBe(1);
    expect(bars.stderr).toContain("Invalid --bars");

    const risk = await runCli(["backtest", "ohlc-trend", "--risk-pct=2"], {
      caseId: "backtest-invalid-risk",
    });
    expect(risk.code).toBe(1);
    expect(risk.stderr).toContain("Invalid --risk-pct");

    const equity = await runCli(["backtest", "ohlc-trend", "--initial-equity=0"], {
      caseId: "backtest-invalid-equity",
    });
    expect(equity.code).toBe(1);
    expect(equity.stderr).toContain("Invalid --initial-equity");
  });

  it("mm-bot backtest covers unknown, no-trade, and traded fixture results", async () => {
    const unknown = await runCli(["backtest", "missing-strategy"], {
      caseId: "backtest-unknown-strategy",
    });
    expect(unknown.code).toBe(1);
    expect(unknown.stderr).toContain("Unknown strategy");

    const noTrades = await runCli(["backtest", "ohlc-trend", "--bars=100"], {
      caseId: "backtest-no-trades",
    });
    expect(noTrades.code).toBe(0);
    expect(noTrades.stdout).toContain("No trades were triggered");

    const trades = await runCli([
      "backtest",
      "ignored",
      "--strategy=ohlc-trend",
      "--bars=600",
      "--risk-pct=0.02",
      "--initial-equity=12000",
      "--timeframe=4h",
    ], { caseId: "backtest-trades" });
    expect(trades.code).toBe(0);
    expect(trades.stdout).toContain("Backtest complete");
    expect(trades.stdout).toContain("Timeframe: 4h");
  });

  it("runHeadless receives a real subprocess SIGTERM and exits after cleanup", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mm-bot-signal-e2e-"));
    const stateFile = join(dir, "state.json");
    const readyFile = join(dir, "ready");
    const cleanupFile = join(dir, "cleanup");
    const workspaceRoot = resolve(import.meta.dir, "../../../..");
    const startModule = process.env["MM_BOT_E2E_START_MODULE"]
      ?? resolve(workspaceRoot, "apps/bot/src/cli/commands/start.ts");
    const defaultsModule = resolve(workspaceRoot, "apps/bot/src/config/defaults.ts");
    const source = [
      `import { runHeadless } from ${JSON.stringify(startModule)};`,
      `import { DEFAULT_BOT_CONFIG } from ${JSON.stringify(defaultsModule)};`,
      "const stopped = Promise.withResolvers();",
      `const config = { ...DEFAULT_BOT_CONFIG, bot: { ...DEFAULT_BOT_CONFIG.bot, state_file: ${JSON.stringify(stateFile)} } };`,
      "const bot = {",
      `  start: async () => { await Bun.write(${JSON.stringify(readyFile)}, "ready"); await stopped.promise; },`,
      `  stop: async () => { await Bun.write(${JSON.stringify(cleanupFile)}, "done"); await Bun.sleep(100); stopped.resolve(); },`,
      "};",
      "const code = await runHeadless(bot, config);",
      "process.exit(code);",
    ].join("\n");
    const preload = process.env["MM_BOT_E2E_COVERAGE_PRELOAD"];
    const proc = Bun.spawn({
      cmd: preload === undefined ? ["bun", "--eval", source] : ["bun", "--preload", preload, "--eval", source],
      cwd: workspaceRoot,
      env: buildBotE2eChildEnvironment(process.env, {
        MM_BOT_E2E_ENTRY_KIND: "canonical-cli",
        MM_BOT_E2E_CASE_ID: "signal-graceful",
      }),
      stdout: "pipe",
      stderr: "pipe",
    });
    const timer = setTimeout(() => {
      proc.kill("SIGKILL");
    }, 25_000);
    try {
      await waitForFile(readyFile, 15_000);
      proc.kill("SIGTERM");
      await waitForFile(cleanupFile, 5_000);
      proc.kill("SIGINT");
      const [stdout, stderr, code] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);
      expect(code).toBe(0);
      expect(stdout).toBe("");
      expect(stderr).toBe("");
      expect(await Bun.file(cleanupFile).text()).toBe("done");
      expect(await Bun.file(`${stateFile}.log`).text()).toContain("received SIGTERM");
    } finally {
      clearTimeout(timer);
      if (proc.exitCode === null) proc.kill("SIGKILL");
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);

  it("runHeadless returns one when subprocess SIGTERM cleanup fails", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mm-bot-failed-signal-e2e-"));
    const stateFile = join(dir, "state.json");
    const readyFile = join(dir, "ready");
    const cleanupFile = join(dir, "cleanup-attempted");
    const workspaceRoot = resolve(import.meta.dir, "../../../..");
    const startModule = process.env["MM_BOT_E2E_START_MODULE"]
      ?? resolve(workspaceRoot, "apps/bot/src/cli/commands/start.ts");
    const defaultsModule = resolve(workspaceRoot, "apps/bot/src/config/defaults.ts");
    const source = [
      `import { runHeadless } from ${JSON.stringify(startModule)};`,
      `import { DEFAULT_BOT_CONFIG } from ${JSON.stringify(defaultsModule)};`,
      "const stopped = Promise.withResolvers();",
      `const config = { ...DEFAULT_BOT_CONFIG, bot: { ...DEFAULT_BOT_CONFIG.bot, state_file: ${JSON.stringify(stateFile)} } };`,
      "const bot = {",
      `  start: async () => { await Bun.write(${JSON.stringify(readyFile)}, "ready"); await stopped.promise; },`,
      `  stop: async () => { await Bun.write(${JSON.stringify(cleanupFile)}, "attempted"); stopped.resolve(); throw new Error("stop rejected"); },`,
      "};",
      "const code = await runHeadless(bot, config);",
      "process.exit(code);",
    ].join("\n");
    const preload = process.env["MM_BOT_E2E_COVERAGE_PRELOAD"];
    const proc = Bun.spawn({
      cmd: preload === undefined ? ["bun", "--eval", source] : ["bun", "--preload", preload, "--eval", source],
      cwd: workspaceRoot,
      env: buildBotE2eChildEnvironment(process.env, {
        MM_BOT_E2E_ENTRY_KIND: "canonical-cli",
        MM_BOT_E2E_CASE_ID: "signal-cleanup-failure",
      }),
      stdout: "pipe",
      stderr: "pipe",
    });
    const timer = setTimeout(() => {
      proc.kill("SIGKILL");
    }, 25_000);
    try {
      await waitForFile(readyFile, 15_000);
      proc.kill("SIGTERM");
      const [stdout, stderr, code] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);
      expect(code).toBe(1);
      expect(stdout).toBe("");
      expect(stderr).toBe("");
      expect(await Bun.file(cleanupFile).text()).toBe("attempted");
      expect(await Bun.file(`${stateFile}.log`).text()).toContain(
        "graceful shutdown failed: stop rejected",
      );
    } finally {
      clearTimeout(timer);
      if (proc.exitCode === null) proc.kill("SIGKILL");
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);

  it("runHeadless renders a non-Error cleanup failure from a real subprocess signal", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mm-bot-string-signal-e2e-"));
    const stateFile = join(dir, "state.json");
    const readyFile = join(dir, "ready");
    const cleanupFile = join(dir, "cleanup-attempted");
    const workspaceRoot = resolve(import.meta.dir, "../../../..");
    const startModule = process.env["MM_BOT_E2E_START_MODULE"]
      ?? resolve(workspaceRoot, "apps/bot/src/cli/commands/start.ts");
    const defaultsModule = resolve(workspaceRoot, "apps/bot/src/config/defaults.ts");
    const source = [
      `import { runHeadless } from ${JSON.stringify(startModule)};`,
      `import { DEFAULT_BOT_CONFIG } from ${JSON.stringify(defaultsModule)};`,
      "const stopped = Promise.withResolvers();",
      `const config = { ...DEFAULT_BOT_CONFIG, bot: { ...DEFAULT_BOT_CONFIG.bot, state_file: ${JSON.stringify(stateFile)} } };`,
      "const bot = {",
      `  start: async () => { await Bun.write(${JSON.stringify(readyFile)}, "ready"); await stopped.promise; },`,
      `  stop: async () => { await Bun.write(${JSON.stringify(cleanupFile)}, "attempted"); stopped.resolve(); throw "plain stop rejection"; },`,
      "};",
      "const code = await runHeadless(bot, config);",
      "process.exit(code);",
    ].join("\n");
    const preload = process.env["MM_BOT_E2E_COVERAGE_PRELOAD"];
    const proc = Bun.spawn({
      cmd: preload === undefined ? ["bun", "--eval", source] : ["bun", "--preload", preload, "--eval", source],
      cwd: workspaceRoot,
      env: buildBotE2eChildEnvironment(process.env, {
        MM_BOT_E2E_ENTRY_KIND: "canonical-cli",
        MM_BOT_E2E_CASE_ID: "signal-cleanup-string-failure",
      }),
      stdout: "pipe",
      stderr: "pipe",
    });
    const timer = setTimeout(() => { proc.kill("SIGKILL"); }, 25_000);
    try {
      await waitForFile(readyFile, 15_000);
      proc.kill("SIGTERM");
      const [stdout, stderr, code] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);
      expect(code).toBe(1);
      expect(stdout).toBe("");
      expect(stderr).toBe("");
      expect(await Bun.file(cleanupFile).text()).toBe("attempted");
      expect(await Bun.file(`${stateFile}.log`).text()).toContain("graceful shutdown failed: plain stop rejection");
    } finally {
      clearTimeout(timer);
      if (proc.exitCode === null) proc.kill("SIGKILL");
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);
});
