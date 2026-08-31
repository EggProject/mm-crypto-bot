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

import { describe, expect, it } from "vitest";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildBotE2eChildEnvironment as createChildEnvironment } from "../../../../scripts/coverage-tools/bot-e2e-child-environment.js";

const SOURCE_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_DEFAULT_TEMPLATE = path.resolve(SOURCE_DIRECTORY, "../../../../run-bot/config/default.toml");

function createExternalRuntimeRoot(): string {
  const runtimeRoot = mkdtempSync(path.join(tmpdir(), "mm-bot-runtime-root-"));
  const configDirectory = path.join(runtimeRoot, "config");
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- configDirectory is a fixed child of this test's mkdtemp-owned root.
  mkdirSync(configDirectory);
  copyFileSync(REPOSITORY_DEFAULT_TEMPLATE, path.join(configDirectory, "default.toml"));
  return runtimeRoot;
}

/**
 * `runCli` — spawn the CLI and return the result.
 *
 * @param commandArguments Args after `bun run apps/bot/src/index.ts` (e.g. `["config", "validate"]`).
 * @param options.timeoutMs Optional timeout in ms (default 30s).
 * @returns The exit code, stdout, and stderr.
 */
async function runCli(
  commandArguments: readonly string[],
  options: {
    readonly caseId: string;
    readonly timeoutMs?: number;
    readonly environment?: Readonly<Record<string, string | undefined>>;
  },
): Promise<{ readonly code: number; readonly stdout: string; readonly stderr: string }> {
  const workspaceRoot = path.resolve(SOURCE_DIRECTORY, "../../../..");
  const entry = process.env["MM_BOT_E2E_ENTRY"] ?? path.resolve(workspaceRoot, "apps/bot/src/index.ts");
  const preload = process.env["MM_BOT_E2E_COVERAGE_PRELOAD"];
  const command =
    preload === undefined
      ? ["bun", "run", entry, ...commandArguments]
      : ["bun", "--preload", preload, entry, ...commandArguments];
  const proc = Bun.spawn({
    cmd: command,
    cwd: workspaceRoot,
    env: createChildEnvironment(
      { ...process.env, ...options.environment },
      {
        MM_BOT_E2E_ENTRY_KIND: "canonical-cli",
        MM_BOT_E2E_CASE_ID: options.caseId,
      },
    ),
    stdout: "pipe",
    stderr: "pipe",
  });

  const timeoutMs = options.timeoutMs ?? 30_000;

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

describe("CLI end-to-end", () => {
  it("mm-bot config validate fails closed when no default runtime root is supplied", async () => {
    const result = await runCli(["config", "validate"], {
      caseId: "config-runtime-root-missing",
      environment: { MM_CRYPTO_BOT_RUNTIME_ROOT: "" },
    });

    expect(result.code).toBe(2);
    expect(result.stderr).toContain("Runtime configuration root is unavailable.");
  });

  // --------------------------------------------------------------------------
  // 1) config validate with the external runtime default template
  // --------------------------------------------------------------------------
  it("mm-bot config validate loads the external runtime default template", async () => {
    const runtimeRoot = createExternalRuntimeRoot();
    try {
      const { code, stdout, stderr } = await runCli(["config", "validate"], {
        caseId: "config-validate-default",
        environment: { MM_CRYPTO_BOT_RUNTIME_ROOT: runtimeRoot },
      });
      if (code !== 0) {
        throw new Error(`expected exit 0, got ${String(code)}\nstdout: ${stdout}\nstderr: ${stderr}`);
      }
      expect(code).toBe(0);
      expect(stdout).toContain("OK");
    } finally {
      rmSync(runtimeRoot, { recursive: true, force: true });
    }
  });

  // --------------------------------------------------------------------------
  // 2) strategies command prints all registered strategies
  // --------------------------------------------------------------------------
  it("mm-bot strategies lists the configured strategies", async () => {
    const runtimeRoot = createExternalRuntimeRoot();
    try {
      const { code, stdout, stderr } = await runCli(["strategies"], {
        caseId: "strategies",
        environment: { MM_CRYPTO_BOT_RUNTIME_ROOT: runtimeRoot },
      });
      if (code !== 0) {
        throw new Error(`expected exit 0, got ${String(code)}\nstdout: ${stdout}\nstderr: ${stderr}`);
      }
      expect(code).toBe(0);
      expect(stdout).toContain("donchian_pivot_composition");
      expect(stdout).toContain("dydx_cex_carry");
      expect(stdout).toContain("cascade_fade");
      expect(stdout).toContain("funding_flip_kill_switch");
      expect(stdout).toContain("regime_detector");
      expect(stdout).toContain("[ON");
      expect(stdout).toContain("[OFF");
    } finally {
      rmSync(runtimeRoot, { recursive: true, force: true });
    }
  });

  // --------------------------------------------------------------------------
  // 3) config validate with an invalid config exits 2
  // --------------------------------------------------------------------------
  it("mm-bot config validate exits 2 on an invalid config", async () => {
    const temporaryDirectory = mkdtempSync(path.join(tmpdir(), "mm-bot-cli-e2e-"));
    const configPath = path.join(temporaryDirectory, "bad.toml");
    await Bun.write(configPath, "[risk]\nmax_leverage = 50\n");
    try {
      const { code, stderr } = await runCli(["config", "validate", `--config=${configPath}`], {
        caseId: "config-validate-invalid",
      });
      expect(code).toBe(2);
      expect(stderr).toContain("validation FAILED");
    } finally {
      try {
        rmSync(temporaryDirectory, { recursive: true, force: true });
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
    expect(stderr).toContain("bun run apps/bot/src/index.ts start --help");
  });

  it("mm-bot start rejects an unknown bot setting before runtime startup", async () => {
    const temporaryDirectory = mkdtempSync(path.join(tmpdir(), "mm-bot-cli-strict-"));
    const configPath = path.join(temporaryDirectory, "unknown-setting.toml");
    const secretSentinel = "start-config-secret-sentinel";
    await Bun.write(configPath, `[bot]\nmystery_setting = ${JSON.stringify(secretSentinel)}\n`);
    try {
      const { code, stdout, stderr } = await runCli(["start", `--config=${configPath}`], {
        caseId: "start-invalid-config",
      });
      expect(code).toBe(2);
      expect(stderr).toContain("[start] START_CONFIG_INVALID");
      expect(stdout).not.toContain(secretSentinel);
      expect(stderr).not.toContain(secretSentinel);
    } finally {
      rmSync(temporaryDirectory, { recursive: true, force: true });
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
    expect(result.stderr).toContain("Usage: bun run apps/bot/src/index.ts start");
  });

  it("mm-bot start fails closed for a mock config without an injected feed", async () => {
    const directory = mkdtempSync(path.join(tmpdir(), "mm-bot-start-mock-e2e-"));
    const configPath = path.join(directory, "mock.toml");
    const stateFile = path.join(directory, "state.json");
    await Bun.write(
      configPath,
      ["[bot]", `state_file = ${JSON.stringify(stateFile)}`, "", "[exchange]", 'id = "mock"'].join("\n"),
    );
    try {
      const result = await runCli(["start", `--config=${configPath}`], {
        caseId: "start-mock-no-feed",
      });
      expect(result.code).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain('"exchange":"mock"');
      expect(result.stderr).toContain('"event":"bot.lifecycle.starting"');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("mm-bot config show renders supported per-strategy risk limits", async () => {
    const temporaryDirectory = mkdtempSync(path.join(tmpdir(), "mm-bot-config-show-e2e-"));
    const configPath = path.join(temporaryDirectory, "strategy-risk.toml");
    await Bun.write(
      configPath,
      `[bot]\nmode = "paper"\n\n[strategies.donchian_pivot_composition]\nenabled = true\nrisk_per_trade = 0.01\nmax_positions = 2\nmin_consensus = 2\n`,
    );
    try {
      const result = await runCli(["config", "show", `--config=${configPath}`], {
        caseId: "config-show-default",
      });
      expect(result.code).toBe(0);
      expect(result.stderr).toBe("");
      expect(result.stdout).toContain(
        `[strategies.donchian_pivot_composition]\nenabled = true\ncap = 0.2\nrisk_per_trade = 0.01\nmax_positions = 2\nmin_consensus = 2`,
      );
    } finally {
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });

  it("mm-bot config without a nested command prints usage", async () => {
    const result = await runCli(["config"], { caseId: "config-missing-subcommand" });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("config <validate|show|init>");
  });

  it("mm-bot config init writes once and refuses to overwrite", async () => {
    const directory = mkdtempSync(path.join(tmpdir(), "mm-bot-config-init-e2e-"));
    const runtimeRoot = createExternalRuntimeRoot();
    const outputPath = path.join(directory, "nested", "mm-bot.toml");
    try {
      const created = await runCli(["config", "init", `--out=${outputPath}`], {
        caseId: "config-init-success",
        environment: { MM_CRYPTO_BOT_RUNTIME_ROOT: runtimeRoot },
      });
      expect(created.code).toBe(0);
      expect(created.stdout).toContain("Wrote");
      expect(await Bun.file(outputPath).exists()).toBe(true);

      const existing = await runCli(["config", "init", `--out=${outputPath}`], {
        caseId: "config-init-existing",
        environment: { MM_CRYPTO_BOT_RUNTIME_ROOT: runtimeRoot },
      });
      expect(existing.code).toBe(1);
      expect(existing.stderr).toContain("Refusing to overwrite");
    } finally {
      rmSync(directory, { recursive: true, force: true });
      rmSync(runtimeRoot, { recursive: true, force: true });
    }
  });

  it("mm-bot backtest exposes help and rejects each invalid numeric boundary", async () => {
    const help = await runCli(["backtest"], { caseId: "backtest-help" });
    expect(help.code).toBe(0);
    expect(help.stdout).toContain("Usage: bun run apps/bot/src/index.ts backtest");

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

    const trades = await runCli(
      [
        "backtest",
        "ignored",
        "--strategy=ohlc-trend",
        "--bars=600",
        "--risk-pct=0.02",
        "--initial-equity=12000",
        "--timeframe=4h",
      ],
      { caseId: "backtest-trades" },
    );
    expect(trades.code).toBe(0);
    expect(trades.stdout).toContain("Backtest complete");
    expect(trades.stdout).toContain("Timeframe: 4h");
  });
});
