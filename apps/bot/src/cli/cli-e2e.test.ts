import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import "./cli-e2e-backtest.test.js";
import "./cli-e2e-core.test.js";
import "./cli-e2e-signal.test.js";

import { runCli } from "./cli-e2e-test-support.test.js";

describe("CLI runtime-root admission", () => {
  it("config validate accepts an explicit configuration path", async () => {
    const directory = mkdtempSync(path.join(tmpdir(), "mm-bot-cli-e2e-"));
    const configPath = path.join(directory, "config.toml");
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- Fresh mkdtemp descendant created in this test.
    writeFileSync(configPath, '[bot]\nmode = "paper"\n', "utf8");
    try {
      const result = await runCli(["config", "validate", `--config=${configPath}`], {
        caseId: "config-validate-default",
      });
      expect(result.code).toBe(0);
      expect(result.stdout).toContain("OK");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("config show accepts an explicit configuration path", async () => {
    const directory = mkdtempSync(path.join(tmpdir(), "mm-bot-cli-e2e-"));
    const configPath = path.join(directory, "config.toml");
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- Fresh mkdtemp descendant created in this test.
    writeFileSync(configPath, '[bot]\nmode = "paper"\n', "utf8");
    try {
      const result = await runCli(["config", "show", `--config=${configPath}`], {
        caseId: "config-show-default",
      });
      expect(result.code).toBe(0);
      expect(result.stdout).toContain("[bot]");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("rejects config validation without a runtime root before configuration loading", async () => {
    const result = await runCli(["config", "validate"], { caseId: "config-runtime-root-missing" });
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("Runtime configuration root is unavailable.");
    expect(result.stderr).toContain("runtime-root-missing");
  });
});
