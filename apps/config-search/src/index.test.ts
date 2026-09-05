import { describe, expect, it } from "bun:test";

import { runConfigSearchCli, runConfigSearchCliEntrypoint } from "./index.js";

function runCli(
  arguments_: readonly string[],
): Readonly<{ exitCode: number; stderr: string; stdout: string }> {
  let stdout = "";
  let stderr = "";

  const exitCode = runConfigSearchCli(arguments_, {
    writeStderr(value: string): void {
      stderr += value;
    },
    writeStdout(value: string): void {
      stdout += value;
    },
  });

  return { exitCode, stderr, stdout };
}

describe("config-search CLI", () => {
  it("reports the unavailable result for no arguments", () => {
    expect(runCli([])).toEqual({
      exitCode: 1,
      stderr: "",
      stdout:
        '{"available":false,"code":"CONFIG_SEARCH_UNAVAILABLE","operation":"config-search","reason":"exact-strategy-run-corridor-unavailable","schema":"mm-crypto-bot.config-search.result/v1"}\n',
    });
  });

  it("reports the unavailable result for the status command", () => {
    expect(runCli(["--status"])).toEqual({
      exitCode: 1,
      stderr: "",
      stdout:
        '{"available":false,"code":"CONFIG_SEARCH_UNAVAILABLE","operation":"config-search","reason":"exact-strategy-run-corridor-unavailable","schema":"mm-crypto-bot.config-search.result/v1"}\n',
    });
  });

  it("renders deterministic help", () => {
    expect(runCli(["--help"])).toEqual({
      exitCode: 0,
      stderr: "",
      stdout: "Usage: mm-crypto-bot-config-search [--status | --help]\n",
    });
  });

  it("rejects unsupported arguments on stderr", () => {
    expect(runCli(["--run"])).toEqual({
      exitCode: 2,
      stderr: "config-search: unsupported argument\n",
      stdout: "",
    });
  });

  it("sets the process exit code only for a direct entrypoint", () => {
    const originalExitCode = process.exitCode;
    let stdout = "";

    try {
      const output = {
        writeStderr: (_value: string): undefined => undefined,
        writeStdout(value: string): void {
          stdout += value;
        },
      };
      const importedModuleExitCode = runConfigSearchCliEntrypoint(false, ["--status"], output);
      expect(importedModuleExitCode === originalExitCode).toBe(true);
      expect(stdout).toBe("");

      const executableExitCode = runConfigSearchCliEntrypoint(true, ["--help"], output);
      expect(executableExitCode).toBe(0);
      expect(stdout).toBe("Usage: mm-crypto-bot-config-search [--status | --help]\n");
    } finally {
      process.exitCode = originalExitCode ?? 0;
    }
  });
});
