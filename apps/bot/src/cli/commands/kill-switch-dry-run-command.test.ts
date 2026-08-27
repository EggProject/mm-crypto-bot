import { describe, expect, it, spyOn } from "bun:test";

import { parseArgv } from "../argv.js";
import { DEFAULT_BOT_CONFIG } from "../../config/defaults.js";
import { ConfigError } from "../../config/index.js";

import { createKillSwitchDryRunCommand } from "./kill-switch-dry-run-command.js";

const resolution = () => ({
  ok: true as const,
  runtimeRoot: "/external",
  configPath: "/external/config.toml",
});

describe("createKillSwitchDryRunCommand", () => {
  const loadedState = {
    version: 1 as const,
    savedAt: 1,
    equityUsd: 10_000,
    initialEquityUsd: 10_000,
    realizedPnlUsd: 0,
    positions: [],
    closedTrades: [],
    inFlightOrderIds: [],
    counters: { placed: 0, filled: 0, cancelled: 0, rejected: 0 },
  };
  it("returns a sanitized configuration exit before loading state when no runtime root is available", async () => {
    const errorSpy = spyOn(console, "error").mockImplementation((message: unknown) => {
      void message;
    });
    let isLoaded = false;
    try {
      const command = createKillSwitchDryRunCommand({
        loadConfig: () => {
          isLoaded = true;
          return DEFAULT_BOT_CONFIG;
        },
        resolveRuntimeRoot: () => ({
          ok: false,
          error: { code: "runtime-root-missing", message: "Runtime configuration root is unavailable." },
        }),
      });
      const code = await command(parseArgv(["kill-switch-dry-run"]), { config: DEFAULT_BOT_CONFIG });
      expect(code).toBe(2);
      expect(isLoaded).toBe(false);
      expect(errorSpy).toHaveBeenCalledWith(
        "Runtime configuration root is unavailable. (runtime-root-missing)",
      );
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("uses an explicit config path without invoking the runtime-root resolver", async () => {
    const command = createKillSwitchDryRunCommand({
      loadConfig: (configPath) => {
        expect(configPath).toBe("/external/config.toml");
        return {
          ...DEFAULT_BOT_CONFIG,
          bot: { ...DEFAULT_BOT_CONFIG.bot, state_file: "/missing-state.json" },
        };
      },
      resolveRuntimeRoot: () => {
        throw new Error("explicit configuration must bypass runtime-root resolution");
      },
    });
    const errorSpy = spyOn(console, "error").mockImplementation((message: unknown) => {
      void message;
    });
    try {
      const code = await command(parseArgv(["kill-switch-dry-run", "--config=/external/config.toml"]), {
        config: DEFAULT_BOT_CONFIG,
      });
      expect(code).toBe(1);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("prints help and maps configuration failures to their stable exits", async () => {
    const output: string[] = [];
    const logSpy = spyOn(console, "log").mockImplementation((message: unknown) => {
      output.push(String(message));
    });
    const errorSpy = spyOn(console, "error").mockImplementation((message: unknown) => {
      output.push(String(message));
    });
    try {
      const help = createKillSwitchDryRunCommand();
      expect(await help(parseArgv(["kill-switch-dry-run", "--help"]), { config: DEFAULT_BOT_CONFIG })).toBe(
        0,
      );
      expect(output.join("\n")).toContain("Usage:");
      const failureRoot = () => ({
        ok: true as const,
        runtimeRoot: "/external",
        configPath: "/external/config.toml",
      });
      const invalid = createKillSwitchDryRunCommand({
        loadConfig: () => {
          throw new ConfigError("invalid", "bot", []);
        },
        resolveRuntimeRoot: failureRoot,
      });
      expect(await invalid(parseArgv(["kill-switch-dry-run"]), { config: DEFAULT_BOT_CONFIG })).toBe(2);
      const unexpected = createKillSwitchDryRunCommand({
        loadConfig: () => {
          throw new Error("unexpected");
        },
        resolveRuntimeRoot: failureRoot,
      });
      expect(await unexpected(parseArgv(["kill-switch-dry-run"]), { config: DEFAULT_BOT_CONFIG })).toBe(1);
    } finally {
      logSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });

  it("renders successful human and JSON reports from an injected state", async () => {
    const output: string[] = [];
    const logSpy = spyOn(console, "log").mockImplementation((message: unknown) => {
      output.push(String(message));
    });
    try {
      const command = createKillSwitchDryRunCommand({
        loadConfig: () => DEFAULT_BOT_CONFIG,
        loadState: () => ({ state: loadedState, error: undefined }),
        resolveRuntimeRoot: () => ({
          ok: true,
          runtimeRoot: "/external",
          configPath: "/external/config.toml",
        }),
      });
      expect(await command(parseArgv(["kill-switch-dry-run"]), { config: DEFAULT_BOT_CONFIG })).toBe(0);
      expect(output.join("\n")).toContain("NO AUTO-TRIGGER");
      output.length = 0;
      expect(
        await command(parseArgv(["kill-switch-dry-run", "--json"]), { config: DEFAULT_BOT_CONFIG }),
      ).toBe(0);
      expect(JSON.parse(output.join("\n"))).toMatchObject({ positions: 0, wouldTrigger: false });
    } finally {
      logSpy.mockRestore();
    }
  });

  it("renders an unavailable state as a JSON error envelope", async () => {
    const output: string[] = [];
    const logSpy = spyOn(console, "log").mockImplementation((message: unknown) => {
      output.push(String(message));
    });
    try {
      const command = createKillSwitchDryRunCommand({
        loadConfig: () => DEFAULT_BOT_CONFIG,
        loadState: () => ({ state: undefined, error: "state unavailable" }),
        resolveRuntimeRoot: () => ({
          ok: true,
          runtimeRoot: "/external",
          configPath: "/external/config.toml",
        }),
      });
      expect(
        await command(parseArgv(["kill-switch-dry-run", "--json"]), { config: DEFAULT_BOT_CONFIG }),
      ).toBe(1);
      expect(JSON.parse(output.join("\n"))).toMatchObject({ error: "state unavailable", positions: 0 });
    } finally {
      logSpy.mockRestore();
    }
  });

  it("interprets string JSON flags and preserves non-Error load failures", async () => {
    const output: string[] = [];
    const logSpy = spyOn(console, "log").mockImplementation((message: unknown) => {
      output.push(String(message));
    });
    const errorSpy = spyOn(console, "error").mockImplementation((message: unknown) => {
      output.push(String(message));
    });
    try {
      const stateUnavailable = createKillSwitchDryRunCommand({
        loadConfig: () => DEFAULT_BOT_CONFIG,
        loadState: () => ({ state: undefined, error: undefined }),
        resolveRuntimeRoot: resolution,
      });
      expect(
        await stateUnavailable(parseArgv(["kill-switch-dry-run", "--json=false"]), {
          config: DEFAULT_BOT_CONFIG,
        }),
      ).toBe(1);
      expect(output.join("\n")).toContain("State: <unavailable>");

      output.length = 0;
      expect(
        await stateUnavailable(parseArgv(["kill-switch-dry-run", "--json=true"]), {
          config: DEFAULT_BOT_CONFIG,
        }),
      ).toBe(1);
      expect(JSON.parse(output.join("\n"))).toMatchObject({ error: "state is unavailable", positions: 0 });

      output.length = 0;
      const stringFailure = createKillSwitchDryRunCommand({
        loadConfig: () => {
          // eslint-disable-next-line @typescript-eslint/only-throw-error -- Exercises the public non-Error configuration loading boundary.
          throw "unavailable configuration";
        },
        resolveRuntimeRoot: resolution,
      });
      expect(await stringFailure(parseArgv(["kill-switch-dry-run"]), { config: DEFAULT_BOT_CONFIG })).toBe(1);
      expect(output.join("\n")).toContain("Failed to load config: unavailable configuration");
    } finally {
      logSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });
});
