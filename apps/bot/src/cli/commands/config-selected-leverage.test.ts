import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { parseArgv } from "../argv.js";
import { configCommand } from "./config.js";

describe("config show selected leverage", () => {
  let logSpy: { mockRestore: () => void };
  let output: string[] = [];

  beforeEach(() => {
    output = [];
    logSpy = spyOn(console, "log").mockImplementation((...arguments_: unknown[]) => {
      output.push(arguments_.map(String).join(" "));
    });
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it("shows canonical selected leverage as a TOML string", async () => {
    const directory = mkdtempSync(path.join(tmpdir(), "mm-cli-selected-leverage-"));
    const configPath = path.join(directory, "config.toml");
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- This exact file is a child of this test's fresh mkdtemp directory.
    writeFileSync(configPath, '[bot]\nselected_leverage = "2.5"\n', "utf8");
    try {
      const exitCode = await configCommand(parseArgv(["config", "show", `--config=${configPath}`]), {});
      expect(exitCode).toBe(0);
      expect(output.join("\n")).toContain('selected_leverage = "2.5"');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
