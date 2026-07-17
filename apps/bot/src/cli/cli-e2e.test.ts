/**
 * apps/bot/src/cli/cli-e2e.test.ts
 *
 * Phase 33 Track D — end-to-end CLI tests.
 *
 * These tests spawn the CLI as a subprocess and verify exit codes +
 * stdout/stderr output. They are slower than unit tests (each spawn
 * is a fresh `bun` process) so we keep the count small and only
 * cover the critical paths:
 *
 *   1. `mm-bot config validate --config=...` exits 0 + stdout contains "OK"
 *   2. `mm-bot strategies` exits 0 + stdout contains strategy names
 *   3. `mm-bot config validate --config=<bad>` exits 2
 *   4. `mm-bot help` exits 1 + stderr contains usage
 *   5. `mm-bot --help` exits 1 + stderr contains usage
 *   6. `mm-bot config --help` exits 1 + stderr contains validate/show/init
 *   7. `mm-bot nonexistent` exits 1 + stderr contains "Unknown subcommand"
 *
 * The CLI is invoked via `bun run apps/bot/src/index.ts <subcommand> ...`
 * from the workspace root, which is the canonical invocation pattern.
 *
 * The test uses `Bun.spawn` and reads `stdout` + `stderr` to completion
 * with a timeout. We do NOT mock the CLI internals — this is a true
 * end-to-end check.
 */

import { describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * `runCli` — spawn the CLI and return the result.
 *
 * @param args   Args after `bun run apps/bot/src/index.ts` (e.g. `["config", "validate"]`).
 * @param opts.timeoutMs  Optional timeout in ms (default 30s).
 * @returns The exit code, stdout, and stderr.
 */
async function runCli(
  args: readonly string[],
  opts: { readonly timeoutMs?: number } = {},
): Promise<{ readonly code: number; readonly stdout: string; readonly stderr: string }> {
  const workspaceRoot = resolve(import.meta.dir, "../../../..");
  const entry = resolve(workspaceRoot, "apps/bot/src/index.ts");
  const proc = Bun.spawn({
    cmd: ["bun", "run", entry, ...args],
    cwd: workspaceRoot,
    env: { ...process.env },
    stdout: "pipe",
    stderr: "pipe",
  });

  const timeoutMs = opts.timeoutMs ?? 30_000;

  // We race the process against a timeout. If the process exits first,
  // we cancel the timer. If the timer fires first, we kill the process.
  const timer = setTimeout(() => {
    try {
      proc.kill();
    } catch {
      // best-effort
    }
  }, timeoutMs);

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  clearTimeout(timer);

  return { code: exitCode ?? 1, stdout, stderr };
}

describe("CLI end-to-end", () => {
  // --------------------------------------------------------------------------
  // 1) config validate with the canonical default.toml
  //    Phase 52D: relocated to `run-bot/config/default.toml` (52B
  //    relocation finalized; 52D makes it the canonical default).
  // --------------------------------------------------------------------------
  it("mm-bot config validate --config=run-bot/config/default.toml exits 0 with OK", async () => {
    const { code, stdout, stderr } = await runCli([
      "config",
      "validate",
      "--config=run-bot/config/default.toml",
    ]);
    if (code !== 0) {
      // Surface stderr in the failure message for debuggability.
      throw new Error(`expected exit 0, got ${String(code)}\nstdout: ${stdout}\nstderr: ${stderr}`);
    }
    expect(code).toBe(0);
    expect(stdout).toContain("OK");
  });

  // --------------------------------------------------------------------------
  // 2) strategies command prints all registered strategies
  // --------------------------------------------------------------------------
  it("mm-bot strategies lists the configured strategies", async () => {
    const { code, stdout, stderr } = await runCli(["strategies"]);
    if (code !== 0) {
      throw new Error(`expected exit 0, got ${String(code)}\nstdout: ${stdout}\nstderr: ${stderr}`);
    }
    expect(code).toBe(0);
    // The default config has 5 strategies.
    expect(stdout).toContain("donchian_pivot_composition");
    expect(stdout).toContain("dydx_cex_carry");
    expect(stdout).toContain("cascade_fade");
    expect(stdout).toContain("funding_flip_kill_switch");
    expect(stdout).toContain("regime_detector");
    // And the OFF / ON markers.
    expect(stdout).toContain("[ON");
    expect(stdout).toContain("[OFF");
  });

  // --------------------------------------------------------------------------
  // 3) config validate with an invalid config exits 2
  // --------------------------------------------------------------------------
  it("mm-bot config validate exits 2 on an invalid config", async () => {
    // We write a tiny invalid config to a temp file, then validate it.
    const dir = `/tmp/mm-bot-e2e-${Date.now().toString(36)}`;
    const path = `${dir}/bad.toml`;
    mkdirSync(dir, { recursive: true });
    writeFileSync(path, "[risk]\nmax_leverage = 50\n", "utf8");
    try {
      const { code, stderr } = await runCli(["config", "validate", `--config=${path}`]);
      expect(code).toBe(2);
      expect(stderr).toContain("validation FAILED");
    } finally {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // best-effort
      }
    }
  });

  // --------------------------------------------------------------------------
  // 4) help subcommand prints usage to stderr
  // --------------------------------------------------------------------------
  it("mm-bot help prints usage and exits 1", async () => {
    const { code, stderr } = await runCli(["help"]);
    expect(code).toBe(1);
    expect(stderr).toContain("Usage");
    expect(stderr).toContain("start");
    expect(stderr).toContain("strategies");
  });

  // --------------------------------------------------------------------------
  // 5) --help at the top level prints usage
  // --------------------------------------------------------------------------
  it("mm-bot --help prints usage and exits 1", async () => {
    const { code, stderr } = await runCli(["--help"]);
    expect(code).toBe(1);
    expect(stderr).toContain("Usage");
  });

  // --------------------------------------------------------------------------
  // 6) config --help lists the sub-subcommands
  // --------------------------------------------------------------------------
  it("mm-bot config --help lists validate/show/init", async () => {
    const { code, stderr } = await runCli(["config", "--help"]);
    expect(code).toBe(1);
    expect(stderr).toContain("validate");
    expect(stderr).toContain("show");
    expect(stderr).toContain("init");
  });

  // --------------------------------------------------------------------------
  // 7) unknown subcommand → exits 1 + "Unknown subcommand" in stderr
  // --------------------------------------------------------------------------
  it("mm-bot nonexistent exits 1 with an error message", async () => {
    const { code, stderr } = await runCli(["nonexistent"]);
    expect(code).toBe(1);
    expect(stderr).toContain("Unknown subcommand");
  });
});
