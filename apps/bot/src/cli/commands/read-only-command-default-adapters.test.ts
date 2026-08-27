import { describe, expect, it, spyOn } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { parseArgv } from "../argv.js";
import type { CliContext, SubcommandHandler } from "../router.js";
import { DEFAULT_BOT_CONFIG } from "../../config/defaults.js";

import { killSwitchesCommand } from "./kill-switches.js";
import { statusCommand } from "./status.js";
import { strategiesCommand } from "./strategies.js";
import { tradesCommand } from "./trades.js";

const CLI_CONTEXT: CliContext = { config: DEFAULT_BOT_CONFIG };

async function capture(
  command: SubcommandHandler,
  arguments_: readonly string[],
): Promise<{ readonly code: number; readonly output: string }> {
  const lines: string[] = [];
  const log = spyOn(console, "log").mockImplementation((...values: unknown[]) => {
    lines.push(values.map(String).join(" "));
  });
  const error = spyOn(console, "error").mockImplementation((...values: unknown[]) => {
    lines.push(values.map(String).join(" "));
  });
  try {
    return { code: await command(parseArgv(arguments_), CLI_CONTEXT), output: lines.join("\n") };
  } finally {
    log.mockRestore();
    error.mockRestore();
  }
}

describe("read-only command default adapters", () => {
  it("loads an external runtime config and state through every default command adapter", async () => {
    const runtimeRoot = mkdtempSync(path.join(tmpdir(), "mm-runtime-root-"));
    const configDirectory = path.join(runtimeRoot, "config");
    const stateFile = path.join(runtimeRoot, "state.json");
    const previousRuntimeRoot = process.env["MM_CRYPTO_BOT_RUNTIME_ROOT"];
    try {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- The directory is a child of this test's fresh mkdtemp root.
      mkdirSync(configDirectory);
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- The file is a child of this test's fresh mkdtemp root.
      writeFileSync(
        path.join(configDirectory, "default.toml"),
        `[bot]\nstate_file = "${stateFile}"\n`,
        "utf8",
      );
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- The file is a child of this test's fresh mkdtemp root.
      writeFileSync(
        stateFile,
        JSON.stringify({
          version: 1,
          savedAt: 0,
          equityUsd: 1000,
          initialEquityUsd: 1000,
          realizedPnlUsd: 0,
          positions: [],
          closedTrades: [],
          inFlightOrderIds: [],
          counters: { placed: 0, filled: 0, cancelled: 0, rejected: 0 },
        }),
        "utf8",
      );
      process.env["MM_CRYPTO_BOT_RUNTIME_ROOT"] = runtimeRoot;

      const statusResult = await capture(statusCommand, ["status"]);
      const tradesResult = await capture(tradesCommand, ["trades"]);
      const strategiesResult = await capture(strategiesCommand, ["strategies"]);
      const switchesResult = await capture(killSwitchesCommand, ["kill-switches"]);
      expect([statusResult.code, tradesResult.code, strategiesResult.code, switchesResult.code]).toEqual([
        0, 0, 0, 0,
      ]);
      expect(statusResult.output).toContain("State file:");
      expect(tradesResult.output).toContain("(no trades)");
    } finally {
      if (previousRuntimeRoot === undefined) delete process.env["MM_CRYPTO_BOT_RUNTIME_ROOT"];
      else process.env["MM_CRYPTO_BOT_RUNTIME_ROOT"] = previousRuntimeRoot;
      rmSync(runtimeRoot, { recursive: true, force: true });
    }
  });
});
