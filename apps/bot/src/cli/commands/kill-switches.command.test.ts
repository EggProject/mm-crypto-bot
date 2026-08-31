import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { parseArgv } from "../argv.js";
import { captureConsole, cliContext } from "./kill-switch-dry-run.test-support.js";
import { getConfigPath, isJsonOutputRequested } from "./kill-switch-command-options.js";
import { killSwitchesCommand } from "./kill-switches.js";

describe("killSwitchesCommand", () => {
  let consoleCapture: ReturnType<typeof captureConsole>;

  beforeEach(() => {
    consoleCapture = captureConsole();
  });

  afterEach(() => {
    consoleCapture.restore();
    vi.restoreAllMocks();
  });

  it("lists every configured switch with its arming state", async () => {
    const result = await killSwitchesCommand(
      parseArgv(["kill-switches", "--config=run-bot/config/default.toml"]),
      cliContext,
    );

    expect(result).toBe(0);
    const output = consoleCapture.logged.join("\n");
    expect(output).toContain("Kill-switches: 4 registered");
    expect(output).toContain("max-drawdown");
    expect(output).toContain("max-positions");
    expect(output).toContain("latency-gate");
    expect(output).toContain("per-strategy");
    expect(output).toContain("Last trigger reason");
  });

  it("reports a rejected configuration as a validation error", async () => {
    const directory = mkdtempSync(path.join(tmpdir(), "kill-switches-invalid-"));
    const configPath = path.join(directory, "config.toml");
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- The test creates this bounded temporary path itself.
    writeFileSync(configPath, "[risk]\nmax_leverage = 11\n", "utf8");
    try {
      const result = await killSwitchesCommand(
        parseArgv(["kill-switches", `--config=${configPath}`]),
        cliContext,
      );

      expect(result).toBe(2);
      expect(consoleCapture.errored.join("\n")).toContain("Config validation FAILED");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("reports unexpected configuration loading errors without suppressing their message", async () => {
    const configModule = await import("../../config/index.js");
    vi.spyOn(configModule, "loadBotConfig").mockImplementation(() => {
      throw new Error("configuration I/O failure");
    });

    const result = await killSwitchesCommand(
      parseArgv(["kill-switches", "--config=/etc/mm-bot.toml"]),
      cliContext,
    );

    expect(result).toBe(1);
    expect(consoleCapture.errored.join("\n")).toContain("configuration I/O failure");
  });

  it("parses only explicit nonempty config and truthy JSON flags", () => {
    expect(getConfigPath(new Map([["config", ""]]))).toBeUndefined();
    expect(getConfigPath(new Map([["config", true]]))).toBeUndefined();
    expect(getConfigPath(new Map([["config", "/external/config.toml"]]))).toBe("/external/config.toml");
    expect(isJsonOutputRequested(new Map([["json", true]]))).toBe(true);
    expect(isJsonOutputRequested(new Map([["json", false]]))).toBe(false);
    expect(isJsonOutputRequested(new Map([["json", "false"]]))).toBe(false);
    expect(isJsonOutputRequested(new Map([["json", "0"]]))).toBe(false);
    expect(isJsonOutputRequested(new Map([["json", "true"]]))).toBe(true);
  });
});
