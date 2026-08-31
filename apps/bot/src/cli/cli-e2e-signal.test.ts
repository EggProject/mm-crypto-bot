import { describe, expect, it } from "bun:test";
import { fileURLToPath } from "node:url";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { buildBotE2eChildEnvironment as buildChildEnvironment } from "../../../../scripts/coverage-tools/bot-e2e-child-environment.js";

import { waitForFile } from "./cli-e2e-test-support.test.js";

const STRUCTURED_LOGGER_SOURCE = [
  'import { StderrJsonSink, StructuredLogger } from "@mm-crypto-bot/logging";',
  'const logger = new StructuredLogger({ clock: { now: () => new Date(0) }, context: { component: "bot", correlationId: "signal-e2e", runId: "signal-e2e" }, sink: new StderrJsonSink(), threshold: "debug" });',
].join("\n");

describe("CLI signal end-to-end", () => {
  it("runHeadless receives a real subprocess SIGTERM and exits after cleanup", async () => {
    const directory = mkdtempSync(path.join(tmpdir(), "mm-bot-signal-e2e-"));
    const stateFile = path.join(directory, "state.json");
    const readyFile = path.join(directory, "ready");
    const cleanupFile = path.join(directory, "cleanup");
    const workspaceRoot = fileURLToPath(new URL("../../../..", import.meta.url));
    const startModule =
      process.env["MM_BOT_E2E_START_MODULE"] ??
      path.resolve(workspaceRoot, "apps/bot/src/cli/commands/start.ts");
    const defaultsModule = path.resolve(workspaceRoot, "apps/bot/src/config/defaults.ts");
    const source = [
      `import { runHeadless } from ${JSON.stringify(startModule)};`,
      `import { DEFAULT_BOT_CONFIG } from ${JSON.stringify(defaultsModule)};`,
      STRUCTURED_LOGGER_SOURCE,
      "const stopped = Promise.withResolvers();",
      `const config = { ...DEFAULT_BOT_CONFIG, bot: { ...DEFAULT_BOT_CONFIG.bot, state_file: ${JSON.stringify(stateFile)} } };`,
      "const bot = {",
      `  start: async () => { await Bun.write(${JSON.stringify(readyFile)}, "ready"); await stopped.promise; },`,
      `  stop: async () => { await Bun.write(${JSON.stringify(cleanupFile)}, "done"); await Bun.sleep(100); stopped.resolve(); },`,
      "};",
      "const code = await runHeadless(bot, config, logger);",
      "await logger.shutdown();",
      "process.exit(code);",
    ].join("\n");
    const preload = process.env["MM_BOT_E2E_COVERAGE_PRELOAD"];
    const proc = Bun.spawn({
      cmd:
        preload === undefined ? ["bun", "--eval", source] : ["bun", "--preload", preload, "--eval", source],
      cwd: workspaceRoot,
      env: buildChildEnvironment(process.env, {
        MM_BOT_E2E_ENTRY_KIND: "canonical-cli",
        MM_BOT_E2E_CASE_ID: "signal-graceful",
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
      await waitForFile(cleanupFile, 5000);
      proc.kill("SIGINT");
      const [stdout, stderr, code] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);
      expect(code).toBe(0);
      expect(stdout).toBe("");
      expect(stderr).toContain('"event":"bot.lifecycle.signal.received"');
      expect(stderr).toContain('"event":"bot.lifecycle.shutdown.completed"');
      expect(stderr).toContain('"signal":"SIGTERM"');
      expect(await Bun.file(cleanupFile).text()).toBe("done");
    } finally {
      clearTimeout(timer);
      if (proc.exitCode === null) proc.kill("SIGKILL");
      rmSync(directory, { recursive: true, force: true });
    }
  }, 30_000);

  it("runHeadless returns one when subprocess SIGTERM cleanup fails", async () => {
    const directory = mkdtempSync(path.join(tmpdir(), "mm-bot-failed-signal-e2e-"));
    const stateFile = path.join(directory, "state.json");
    const readyFile = path.join(directory, "ready");
    const cleanupFile = path.join(directory, "cleanup-attempted");
    const workspaceRoot = fileURLToPath(new URL("../../../..", import.meta.url));
    const startModule =
      process.env["MM_BOT_E2E_START_MODULE"] ??
      path.resolve(workspaceRoot, "apps/bot/src/cli/commands/start.ts");
    const defaultsModule = path.resolve(workspaceRoot, "apps/bot/src/config/defaults.ts");
    const source = [
      `import { runHeadless } from ${JSON.stringify(startModule)};`,
      `import { DEFAULT_BOT_CONFIG } from ${JSON.stringify(defaultsModule)};`,
      STRUCTURED_LOGGER_SOURCE,
      "const stopped = Promise.withResolvers();",
      `const config = { ...DEFAULT_BOT_CONFIG, bot: { ...DEFAULT_BOT_CONFIG.bot, state_file: ${JSON.stringify(stateFile)} } };`,
      "const bot = {",
      `  start: async () => { await Bun.write(${JSON.stringify(readyFile)}, "ready"); await stopped.promise; },`,
      `  stop: async () => { await Bun.write(${JSON.stringify(cleanupFile)}, "attempted"); stopped.resolve(); throw new Error("stop rejected"); },`,
      "};",
      "const code = await runHeadless(bot, config, logger);",
      "await logger.shutdown();",
      "process.exit(code);",
    ].join("\n");
    const preload = process.env["MM_BOT_E2E_COVERAGE_PRELOAD"];
    const proc = Bun.spawn({
      cmd:
        preload === undefined ? ["bun", "--eval", source] : ["bun", "--preload", preload, "--eval", source],
      cwd: workspaceRoot,
      env: buildChildEnvironment(process.env, {
        MM_BOT_E2E_ENTRY_KIND: "canonical-cli",
        MM_BOT_E2E_CASE_ID: "signal-cleanup-failure",
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
      expect(stderr).toContain('"event":"bot.lifecycle.shutdown.failed"');
      expect(stderr).toContain("stop rejected");
      expect(await Bun.file(cleanupFile).text()).toBe("attempted");
    } finally {
      clearTimeout(timer);
      if (proc.exitCode === null) proc.kill("SIGKILL");
      rmSync(directory, { recursive: true, force: true });
    }
  }, 30_000);

  it("runHeadless renders a non-Error cleanup failure from a real subprocess signal", async () => {
    const directory = mkdtempSync(path.join(tmpdir(), "mm-bot-string-signal-e2e-"));
    const stateFile = path.join(directory, "state.json");
    const readyFile = path.join(directory, "ready");
    const cleanupFile = path.join(directory, "cleanup-attempted");
    const workspaceRoot = fileURLToPath(new URL("../../../..", import.meta.url));
    const startModule =
      process.env["MM_BOT_E2E_START_MODULE"] ??
      path.resolve(workspaceRoot, "apps/bot/src/cli/commands/start.ts");
    const defaultsModule = path.resolve(workspaceRoot, "apps/bot/src/config/defaults.ts");
    const source = [
      `import { runHeadless } from ${JSON.stringify(startModule)};`,
      `import { DEFAULT_BOT_CONFIG } from ${JSON.stringify(defaultsModule)};`,
      STRUCTURED_LOGGER_SOURCE,
      "const stopped = Promise.withResolvers();",
      `const config = { ...DEFAULT_BOT_CONFIG, bot: { ...DEFAULT_BOT_CONFIG.bot, state_file: ${JSON.stringify(stateFile)} } };`,
      "const bot = {",
      `  start: async () => { await Bun.write(${JSON.stringify(readyFile)}, "ready"); await stopped.promise; },`,
      `  stop: async () => { await Bun.write(${JSON.stringify(cleanupFile)}, "attempted"); stopped.resolve(); throw "plain stop rejection"; },`,
      "};",
      "const code = await runHeadless(bot, config, logger);",
      "await logger.shutdown();",
      "process.exit(code);",
    ].join("\n");
    const preload = process.env["MM_BOT_E2E_COVERAGE_PRELOAD"];
    const proc = Bun.spawn({
      cmd:
        preload === undefined ? ["bun", "--eval", source] : ["bun", "--preload", preload, "--eval", source],
      cwd: workspaceRoot,
      env: buildChildEnvironment(process.env, {
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
      expect(stderr).toContain('"event":"bot.lifecycle.shutdown.failed"');
      expect(stderr).toContain("plain stop rejection");
      expect(await Bun.file(cleanupFile).text()).toBe("attempted");
    } finally {
      clearTimeout(timer);
      if (proc.exitCode === null) proc.kill("SIGKILL");
      rmSync(directory, { recursive: true, force: true });
    }
  }, 30_000);
});
