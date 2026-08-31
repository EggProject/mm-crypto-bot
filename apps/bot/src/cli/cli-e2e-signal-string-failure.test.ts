import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildBotE2eChildEnvironment as createChildEnvironment } from "../../../../scripts/coverage-tools/bot-e2e-child-environment.js";

async function waitForFile(filePath: string, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await Bun.file(filePath).exists())) {
    if (Date.now() >= deadline) throw new Error(`timed out waiting for ${filePath}`);
    await Bun.sleep(10);
  }
}

describe("CLI end-to-end", () => {
  it("runHeadless renders a non-Error cleanup failure from a real subprocess signal", async () => {
    const temporaryDirectory = mkdtempSync(path.join(tmpdir(), "mm-bot-string-signal-e2e-"));
    const stateFile = path.join(temporaryDirectory, "state.json");
    const readyFile = path.join(temporaryDirectory, "ready");
    const cleanupFile = path.join(temporaryDirectory, "cleanup-attempted");
    const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
    const startModule =
      process.env["MM_BOT_E2E_START_MODULE"] ??
      path.resolve(workspaceRoot, "apps/bot/src/cli/commands/start.ts");
    const defaultsModule = path.resolve(workspaceRoot, "apps/bot/src/config/defaults.ts");
    const source = [
      `import { runHeadless } from ${JSON.stringify(startModule)};`,
      `import { DEFAULT_BOT_CONFIG } from ${JSON.stringify(defaultsModule)};`,
      'import { createNullLogger } from "@logging-testing";',
      "const stopped = Promise.withResolvers();",
      `const config = { ...DEFAULT_BOT_CONFIG, bot: { ...DEFAULT_BOT_CONFIG.bot, state_file: ${JSON.stringify(stateFile)} } };`,
      "const bot = {",
      `  start: async () => { await Bun.write(${JSON.stringify(readyFile)}, "ready"); await stopped.promise; },`,
      `  stop: async () => { await Bun.write(${JSON.stringify(cleanupFile)}, "attempted"); stopped.resolve(); throw "plain stop rejection"; },`,
      "};",
      "const code = await runHeadless(bot, config, createNullLogger());",
      "process.exit(code);",
    ].join("\n");
    const preload = process.env["MM_BOT_E2E_COVERAGE_PRELOAD"];
    const proc = Bun.spawn({
      cmd:
        preload === undefined ? ["bun", "--eval", source] : ["bun", "--preload", preload, "--eval", source],
      cwd: workspaceRoot,
      env: createChildEnvironment(process.env, {
        MM_BOT_E2E_ENTRY_KIND: "canonical-cli",
        MM_BOT_E2E_CASE_ID: "signal-cleanup-string-failure",
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
    } finally {
      clearTimeout(timer);
      if (proc.exitCode === null) proc.kill("SIGKILL");
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  }, 30_000);
});
