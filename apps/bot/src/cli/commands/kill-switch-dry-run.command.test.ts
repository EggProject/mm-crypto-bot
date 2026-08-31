import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { parseArgv } from "../argv.js";
import { createKillSwitchDryRunCommand, killSwitchDryRunCommand } from "./kill-switch-dry-run.js";
import {
  captureConsole,
  cliContext,
  makePosition,
  makeState,
  parseJsonRecord,
} from "./kill-switch-dry-run.test-support.js";

async function runCommand(argv: readonly string[]): Promise<number> {
  return killSwitchDryRunCommand(parseArgv(argv), cliContext);
}

async function writeToml(filePath: string, value: string): Promise<void> {
  await Bun.write(filePath, value);
}

async function writeState(filePath: string): Promise<void> {
  const state = makeState({ positions: [makePosition()] });
  await Bun.write(filePath, JSON.stringify(state));
}

describe("killSwitchDryRunCommand", () => {
  let consoleCapture: ReturnType<typeof captureConsole>;

  beforeEach(() => {
    consoleCapture = captureConsole();
  });
  afterEach(() => {
    consoleCapture.restore();
  });

  it("--help → 0 + usage text", async () => {
    const code = await runCommand(["kill-switch-dry-run", "--help"]);
    expect(code).toBe(0);
    const output = consoleCapture.logged.join("\n");
    expect(output).toContain("Usage: bun run apps/bot/src/index.ts kill-switch-dry-run");
    expect(output).toContain("--json");
    expect(output).toContain("--config=");
  });

  it("returns 1 when the state file does not exist (default config)", async () => {
    const directory = mkdtempSync(path.join(tmpdir(), "ksdr-no-state-"));
    const configFile = path.join(directory, "config.toml");
    const missingState = path.join(directory, "does-not-exist.json");
    await writeToml(configFile, `[bot]\nstate_file = "${missingState}"\n`);
    try {
      expect(await runCommand(["kill-switch-dry-run", "--json", `--config=${configFile}`])).toBe(1);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("returns 1 (human-readable) when the state file is missing", async () => {
    const directory = mkdtempSync(path.join(tmpdir(), "ksdr-no-state-hr-"));
    const configFile = path.join(directory, "config.toml");
    const missingState = path.join(directory, "does-not-exist.json");
    await writeToml(configFile, `[bot]\nstate_file = "${missingState}"\n`);
    try {
      expect(await runCommand(["kill-switch-dry-run", `--config=${configFile}`])).toBe(1);
      expect(consoleCapture.errored.join("\n")).toContain("state file not found");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("returns 0 + dry-run report when the state file is valid", async () => {
    const directory = mkdtempSync(path.join(tmpdir(), "ksdr-cmd-"));
    const stateFile = path.join(directory, "state.json");
    const configFile = path.join(directory, "config.toml");
    await writeState(stateFile);
    await writeToml(configFile, `[bot]\nstate_file = "${stateFile}"\n`);
    try {
      expect(await runCommand(["kill-switch-dry-run", `--config=${configFile}`])).toBe(0);
      const output = consoleCapture.logged.join("\n");
      expect(output).toContain("[kill-switch-dry-run]");
      expect(output).toContain("BTC/USDC");
      expect(output).toContain("LONG");
      expect(output).toContain("(dry-run: NO orders were sent");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("renders positive, zero, and negative valid position P&L values", async () => {
    const directory = mkdtempSync(path.join(tmpdir(), "ksdr-pnl-"));
    const stateFile = path.join(directory, "state.json");
    const configFile = path.join(directory, "config.toml");
    await writeToml(configFile, `[bot]\nstate_file = "${stateFile}"\n`);
    try {
      for (const unrealizedPnl of [1, 0, -1]) {
        const position = makePosition({ unrealizedPnl });
        const state = makeState({ positions: [position] });
        await Bun.write(stateFile, JSON.stringify(state));
        expect(await runCommand(["kill-switch-dry-run", `--config=${configFile}`])).toBe(0);
      }
      expect(consoleCapture.logged.join("\n")).toContain("est.P&L=$1.00");
      expect(consoleCapture.logged.join("\n")).toContain("est.P&L=$0.00");
      expect(consoleCapture.logged.join("\n")).toContain("est.P&L=$-1.00");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("returns 0 + JSON output in --json mode", async () => {
    const directory = mkdtempSync(path.join(tmpdir(), "ksdr-cmd-json-"));
    const stateFile = path.join(directory, "state.json");
    const configFile = path.join(directory, "config.toml");
    await writeState(stateFile);
    await writeToml(configFile, `[bot]\nstate_file = "${stateFile}"\n`);
    try {
      expect(await runCommand(["kill-switch-dry-run", "--json", `--config=${configFile}`])).toBe(0);
      const parsed = parseJsonRecord(consoleCapture.logged.join("\n"));
      expect(parsed["stateFilePath"]).toBe(stateFile);
      expect(parsed["positions"]).toBe(1);
      expect(parsed["wouldTrigger"]).toBe(false);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("returns 0 + JSON error envelope in --json mode when state file is missing", async () => {
    const directory = mkdtempSync(path.join(tmpdir(), "ksdr-no-state-json-"));
    const configFile = path.join(directory, "config.toml");
    const missingState = path.join(directory, "does-not-exist.json");
    await writeToml(configFile, `[bot]\nstate_file = "${missingState}"\n`);
    try {
      expect(await runCommand(["kill-switch-dry-run", "--json", `--config=${configFile}`])).toBe(1);
      const parsed = parseJsonRecord(consoleCapture.logged.join("\n"));
      expect(parsed["error"]).toContain("state file not found");
      expect(parsed["wouldTrigger"]).toBe(false);
      expect(parsed["positions"]).toBe(0);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("returns 2 on ConfigError (invalid config)", async () => {
    const directory = mkdtempSync(path.join(tmpdir(), "ksdr-cfg-err-"));
    const badConfig = path.join(directory, "bad.toml");
    await writeToml(badConfig, "[risk]\nmax_leverage = 99\n");
    try {
      expect(await runCommand(["kill-switch-dry-run", `--config=${badConfig}`])).toBe(2);
      expect(consoleCapture.errored.join("\n")).toContain("Config validation FAILED");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("returns 2 on file-not-found (loader wraps IO errors in ConfigError)", async () => {
    const directory = mkdtempSync(path.join(tmpdir(), "ksdr-missing-"));
    const missingConfig = path.join(directory, "no-such-config.toml");
    try {
      expect(await runCommand(["kill-switch-dry-run", `--config=${missingConfig}`])).toBe(2);
      expect(consoleCapture.errored.join("\n").length).toBeGreaterThan(0);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("returns 1 when loadBotConfig throws a non-ConfigError (defensive runtime branch)", async () => {
    const configModule = await import("../../config/index.js");
    const loadSpy = spyOn(configModule, "loadBotConfig").mockImplementation(() => {
      throw new Error("intentional non-ConfigError failure");
    });
    try {
      expect(await runCommand(["kill-switch-dry-run", "--config=/etc/mm-bot.toml"])).toBe(1);
      expect(consoleCapture.errored.join("\n")).toContain("intentional non-ConfigError failure");
    } finally {
      loadSpy.mockRestore();
    }
  });

  it("fails before loading when no runtime root resolves", async () => {
    let loadCalls = 0;
    const command = createKillSwitchDryRunCommand({
      loadConfig: () => {
        loadCalls += 1;
        throw new Error("must not load");
      },
      resolveRuntimeRoot: () => ({
        ok: false,
        error: { code: "runtime-root-missing", message: "Runtime configuration root is unavailable." },
      }),
    });

    expect(await command(parseArgv(["kill-switch-dry-run"]), cliContext)).toBe(2);
    expect(loadCalls).toBe(0);
    expect(consoleCapture.errored.join("\n")).toContain("runtime-root-missing");
  });

  it("renders an injected loader Error", async () => {
    const command = createKillSwitchDryRunCommand({
      loadConfig: () => {
        throw new Error("untrusted loader failure");
      },
    });

    expect(
      await command(parseArgv(["kill-switch-dry-run", "--config=/external/config.toml"]), cliContext),
    ).toBe(1);
    expect(consoleCapture.errored.join("\n")).toContain("untrusted loader failure");
  });
});
