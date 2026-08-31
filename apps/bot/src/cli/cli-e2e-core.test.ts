import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { runCli } from "./cli-e2e-test-support.test.js";

describe("CLI end-to-end", () => {
  // --------------------------------------------------------------------------
  // 2) strategies command prints all registered strategies
  // --------------------------------------------------------------------------
  it("mm-bot strategies lists the configured strategies", async () => {
    const directory = mkdtempSync(path.join(tmpdir(), "mm-bot-strategies-e2e-"));
    const configPath = path.join(directory, "config.toml");
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- Fresh mkdtemp descendant created in this test.
    writeFileSync(configPath, '[bot]\nmode = "paper"\n', "utf8");
    try {
      const { code, stdout, stderr } = await runCli(["strategies", `--config=${configPath}`], {
        caseId: "strategies",
      });
      if (code !== 0)
        throw new Error(`expected exit 0, got ${String(code)}\nstdout: ${stdout}\nstderr: ${stderr}`);
      expect(code).toBe(0);
      expect(stdout).toContain("donchian_pivot_composition");
      expect(stdout).toContain("dydx_cex_carry");
      expect(stdout).toContain("cascade_fade");
      expect(stdout).toContain("funding_flip_kill_switch");
      expect(stdout).toContain("regime_detector");
      expect(stdout).toContain("[ON");
      expect(stdout).toContain("[OFF");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  // --------------------------------------------------------------------------
  // 3) config validate with an invalid config exits 2
  // --------------------------------------------------------------------------
  it("mm-bot config validate exits 2 on an invalid config", async () => {
    const directory = mkdtempSync(path.join(tmpdir(), "mm-bot-cli-e2e-"));
    const configPath = path.join(directory, "bad.toml");
    await Bun.write(configPath, "[risk]\nmax_leverage = 50\n");
    try {
      const { code, stderr } = await runCli(["config", "validate", `--config=${configPath}`], {
        caseId: "config-validate-invalid",
      });
      expect(code).toBe(2);
      expect(stderr).toContain("validation FAILED");
    } finally {
      try {
        rmSync(directory, { recursive: true, force: true });
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
    expect(stderr).not.toContain("uses defaults if absent");
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
    const directory = mkdtempSync(path.join(tmpdir(), "mm-bot-cli-strict-"));
    const configPath = path.join(directory, "unknown-setting.toml");
    await Bun.write(configPath, "[bot]\nmystery_setting = true\n");
    try {
      const { code, stderr } = await runCli(["start", `--config=${configPath}`], {
        caseId: "start-invalid-config",
      });
      expect(code).toBe(2);
      expect(stderr).toContain("[start] START_CONFIG_INVALID");
    } finally {
      rmSync(directory, { recursive: true, force: true });
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
      expect(result.stderr).toContain('"event":"bot.lifecycle.run.failed"');
      expect(result.stderr).toContain("MockExchangeFeed is test-only");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

it("mm-bot config without a nested command prints usage", async () => {
  const result = await runCli(["config"], { caseId: "config-missing-subcommand" });
  expect(result.code).toBe(1);
  expect(result.stderr).toContain("config <validate|show|init>");
});

it("mm-bot config init writes once and refuses to overwrite", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "mm-bot-config-init-e2e-"));
  const outputPath = path.join(directory, "nested", "mm-bot.toml");
  const sourcePath = path.join(directory, "source.toml");
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- Fresh mkdtemp descendant created in this test.
  writeFileSync(sourcePath, '[bot]\nmode = "paper"\n', "utf8");
  try {
    const created = await runCli(["config", "init", `--config=${sourcePath}`, `--out=${outputPath}`], {
      caseId: "config-init-success",
    });
    expect(created.code).toBe(0);
    expect(created.stdout).toContain("Wrote");
    expect(await Bun.file(outputPath).exists()).toBe(true);

    const existing = await runCli(["config", "init", `--config=${sourcePath}`, `--out=${outputPath}`], {
      caseId: "config-init-existing",
    });
    expect(existing.code).toBe(1);
    expect(existing.stderr).toContain("Refusing to overwrite");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
