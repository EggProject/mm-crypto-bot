/**
 * apps/bot/src/__tests__/phase72-start-status-broadcast.test.ts
 *
 * ============================================================================
 * PHASE 72 — SYSTEM-LEVEL STATUS BROADCAST REGRESSION TEST
 * ============================================================================
 *
 * THE BUG (Phase 71 regression on `botStatus.state` + `botStatus.startedAt`):
 *   The dashboard's `/api/status` endpoint reads from a CACHED snapshot
 *   (`ctx.snapshot.botStatus` in `web-client/http-server.ts:288`). The cache
 *   is updated via the state-feed's SNAPSHOT broadcast. The `markBotStarted()`
 *   call sets the publisher's `botRunning=true` and `lastStartedAt=Date.now()`,
 *   which triggers a SNAPSHOT broadcast with `botStatus.state === "running"`.
 *
 *   BUT in `cli/commands/start.ts:353`, the original code did
 *   `await bot.start()`. Inside `Bot.start()`:
 *
 *       public async start(): Promise<void> {
 *         ...
 *         await this.init();
 *         await this.run();   // ← infinite loop
 *       }
 *
 *   The `run()` method is an infinite loop that only returns when
 *   `bot.stop()` is called. So `await bot.start()` blocked FOREVER, and the
 *   `markBotStarted()` call (which was on the line right after the `await`)
 *   was UNREACHABLE. The publisher's `botRunning` flag stayed `false`
 *   forever, and the dashboard's `state: "stopped"` / `startedAt: 0` was
 *   a permanent condition, NOT a transient state.
 *
 *   This is the user-mandated "real process restart" test that catches the
 *   deadlock. It is NOT a unit test of the publisher (that would not catch
 *   the start.ts:353 await deadlock). It is NOT a unit test of the HTTP
 *   handler (that would not catch the start.ts:353 await deadlock). It
 *   spawns the actual `mm-bot start` subprocess and verifies the
 *   state-feed receives the correct `botStatus` in the SNAPSHOT.
 *
 *   The test:
 *     1) Writes a temp config file (ephemeral state file path, paper mode,
 *        real bybit.eu feed)
 *     2) Spawns `bun run apps/bot/src/index.ts start --config=<temp>`
 *        with MM_BOT_FEED_PORT=<ephemeral port> and MM_BOT_HTTP_PORT=0
 *        (we DON'T spawn the web — we connect directly to the state-feed)
 *     3) Waits for the state-feed TCP socket to be listening on the
 *        ephemeral port (5s timeout)
 *     4) Connects via raw TCP, reads the HELLO + first SNAPSHOT message
 *     5) Asserts `snapshot.botStatus.state === "running"` AND
 *        `snapshot.botStatus.startedAt > 0`
 *     6) Cleans up (kill subprocess, delete temp config + state file)
 *
 *   If the start.ts:353 deadlock regresses, the test fails because:
 *     - `markBotStarted()` is never called
 *     - The SNAPSHOT's `botStatus.state` stays "stopped"
 *     - The SNAPSHOT's `botStatus.startedAt` stays 0
 *
 *   The test is SLOW (15-30s) because the bot must connect to bybit.eu
 *   to fully initialize. This is a known tradeoff for system-level
 *   coverage. The user explicitly mandated "real process restart"
 *   coverage (not just unit tests), so the slowness is accepted.
 * ============================================================================
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// ============================================================================
// Test helpers
// ============================================================================

/**
 * `spawnBot` — spawn the actual `mm-bot start` subprocess and return the
 * process handle. The bot is started in the given CWD with the given env.
 */
function spawnBot(opts: {
  readonly workspaceRoot: string;
  readonly configPath: string;
  readonly feedPort: number;
}): { readonly proc: ReturnType<typeof Bun.spawn>; } {
  const entry = resolve(opts.workspaceRoot, "apps/bot/src/index.ts");
  const proc = Bun.spawn({
    cmd: ["bun", "run", entry, "start", `--config=${opts.configPath}`],
    cwd: opts.workspaceRoot,
    env: {
      ...process.env,
      MM_BOT_FEED_PORT: String(opts.feedPort),
      // A bot log-redirect elkerülése érdekében — a stdout-ot
      // közvetlenül a spawn pipe olvassa.
      NO_COLOR: "1",
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  return { proc };
}

/**
 * `waitForTcpPort` — poll a TCP port until it accepts connections, or
 * timeout. Returns true if the port became available.
 */
async function waitForTcpPort(host: string, port: number, timeoutMs: number): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const socket = await Bun.connect({
        hostname: host,
        port,
        socket: {
          open: (sock) => {
            sock.end();
          },
          data: () => undefined,
          close: () => undefined,
          error: () => undefined,
        },
      });
      // The connect succeeded — port is listening
      try {
        socket.end();
      } catch {
        // best-effort
      }
      return true;
    } catch {
      // Not yet listening — wait and retry
      await Bun.sleep(100);
    }
  }
  return false;
}

/**
 * `connectAndReadSnapshot` — connect to the state-feed TCP port and read
 * the HELLO + first SNAPSHOT messages. Returns the parsed SNAPSHOT
 * payload (or null if the connection failed or no SNAPSHOT was received
 * within the timeout).
 */
async function connectAndReadSnapshot(
  port: number,
  timeoutMs: number,
): Promise<{ readonly botStatus: { readonly state: string; readonly startedAt: number } } | null> {
  return new Promise((resolveP) => {
    let buffer = "";
    let snapshotReceived: { readonly botStatus: { readonly state: string; readonly startedAt: number } } | null = null;
    let resolved = false;

    const finish = (result: { readonly botStatus: { readonly state: string; readonly startedAt: number } } | null): void => {
      if (resolved) return;
      resolved = true;
      resolveP(result);
    };

    const timer = setTimeout(() => {
      finish(null);
    }, timeoutMs);

    void (async () => {
      try {
        const socket = await Bun.connect({
          hostname: "127.0.0.1",
          port,
          socket: {
            open: () => {
              // Connection opened — nothing to do, just wait for data
            },
            data: (sock, data) => {
              buffer += data.toString("utf-8");
              let idx = buffer.indexOf("\n");
              while (idx !== -1) {
                const line = buffer.slice(0, idx);
                buffer = buffer.slice(idx + 1);
                if (line.length > 0) {
                  let parsed: { readonly type?: string; readonly [k: string]: unknown } | null = null;
                  try {
                    parsed = JSON.parse(line) as { readonly type?: string; readonly [k: string]: unknown };
                  } catch {
                    // malformed line — skip
                  }
                  if (parsed !== null && typeof parsed.type === "string") {
                    if (parsed.type === "hello") {
                      // HELLO received — keep waiting for the SNAPSHOT.
                    } else if (parsed.type === "snapshot") {
                      const snap = (parsed["snapshot"] ?? null) as { readonly botStatus?: { readonly state?: string; readonly startedAt?: number } } | null;
                      if (snap !== null && snap.botStatus !== undefined) {
                        snapshotReceived = {
                          botStatus: {
                            state: typeof snap.botStatus.state === "string" ? snap.botStatus.state : "unknown",
                            startedAt: typeof snap.botStatus.startedAt === "number" ? snap.botStatus.startedAt : 0,
                          },
                        };
                        clearTimeout(timer);
                        finish(snapshotReceived as never);
                        try {
                          sock.end();
                        } catch {
                          // best-effort
                        }
                        return;
                      }
                    }
                  }
                }
                idx = buffer.indexOf("\n");
              }
            },
            close: () => undefined,
            error: () => undefined,
          },
        });
        // Keep the socket reference alive
        void socket;
      } catch {
        clearTimeout(timer);
        finish(null);
      }
    })();
  });
}

// ============================================================================
// Test setup
// ============================================================================

let tmpDir = "";
let workspaceRoot = "";
let testConfigPath = "";
let ephemeralFeedPort = 0;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "mm-p72-status-"));
  workspaceRoot = resolve(import.meta.dir, "../../../..");

  // Ephemeral port — high enough to not conflict with the live bot on 7914.
  // Use a random base in the 30k-40k range.
  ephemeralFeedPort = 30_000 + Math.floor(Math.random() * 10_000);

  // Write a paper-mode config that points to a temp state file.
  // Uses the real bybiteu feed (paper mode with no API key works for
  // public endpoints per Phase 66 fix). The config mirrors the
  // canonical `run-bot/config/paper-backtest-verified.toml` to ensure
  // the same Zod validation passes.
  const stateFile = join(tmpDir, "bot-state.json");
  testConfigPath = join(tmpDir, "paper-test.toml");
  const configContent = `# Phase 72 test config — paper mode, real bybit.eu, ephemeral state file
[bot]
mode = "paper"
log_level = "info"
state_file = "${stateFile}"

[exchange]
id = "bybiteu"
endpoint = "https://api.bybit.eu"
ws_endpoint = "wss://stream.bybit.eu"
timeout_ms = 5000
rate_limit_ms = 80
sandbox = false
slippage_pct = 0.03
fee_tier = "vip"
rate_limit_per_min = 200
ws_reconnect_delay_ms = 500

[compliance]
jurisdiction = "EU"

[symbols]
enabled = ["BTC/USDC", "ETH/USDC", "SOL/USDC"]

[risk]
risk_per_trade = 0.01
kelly_fraction = 0.25
max_drawdown_pct = 0.15
max_positions = 3
max_leverage = 10

[strategies.donchian_pivot_composition]
enabled = true
cap = 0.20
min_consensus = 2
symbols = ["BTC/USDC", "ETH/USDC", "SOL/USDC"]

[telemetry]
log_dir = "${tmpDir}/logs"
metrics_interval_sec = 60
`;
  writeFileSync(testConfigPath, configContent);
});

afterEach(() => {
  if (existsSync(tmpDir)) {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ============================================================================
// Test
// ============================================================================

describe("Phase 72 — start.ts:353 markBotStarted() reachability (system-level)", () => {
  it(
    "spawning 'mm-bot start' makes the state-feed SNAPSHOT show botStatus.state === 'running' + startedAt > 0 (regression for the start.ts:353 await deadlock)",
    async () => {
      // 1) Spawn the actual mm-bot start subprocess.
      const { proc } = spawnBot({
        workspaceRoot,
        configPath: testConfigPath,
        feedPort: ephemeralFeedPort,
      });

      // Drain stderr in the background to /tmp so we can debug if the test fails.
      const stderrLogPath = `/tmp/mm-p72-stderr-${Date.now()}.log`;
      const stderrStream = Bun.file(stderrLogPath).writer();
      const stderrReader = (async () => {
        const reader = (proc.stderr as ReadableStream<Uint8Array>).getReader();
        const decoder = new TextDecoder();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const text = decoder.decode(value, { stream: true });
            await stderrStream.write(text);
            await stderrStream.flush();
          }
        } catch {
          // best-effort
        } finally {
          try {
            reader.releaseLock();
          } catch {
            // best-effort
          }
          await stderrStream.close();
        }
      })();
      void stderrReader;

      // Cleanup helper — kill the bot subprocess on test exit.
      const cleanup = async (): Promise<void> => {
        try {
          proc.kill("SIGTERM");
        } catch {
          // best-effort
        }
        // Give it 2s to exit gracefully, then force-kill
        await Promise.race([
          proc.exited,
          new Promise<void>((r) => {
            setTimeout(r, 2_000);
          }),
        ]);
        try {
          proc.kill("SIGKILL");
        } catch {
          // best-effort
        }
      };

      try {
        // 2) Wait for the state-feed TCP socket to listen on the ephemeral port.
        //    The bot init takes 3-5s (bybit.eu feed open, OHLCV subscribe),
        //    so we give it 15s.
        const portReady = await waitForTcpPort("127.0.0.1", ephemeralFeedPort, 15_000);
        expect(portReady).toBe(true);
        if (!portReady) {
          // Port never came up — read the bot's stderr to help debugging
          throw new Error(
            `state-feed port ${String(ephemeralFeedPort)} did not become available within 15s. Bot stderr at: ${stderrLogPath}`,
          );
        }

        // 3) Connect to the state-feed and read the HELLO + first SNAPSHOT.
        //    The HELLO is sent immediately on connect. The SNAPSHOT is the
        //    first SNAPSHOT message after HELLO. The 15s timeout covers
        //    the bot's bybit.eu feed init + the periodic refresh cycle.
        const result = await connectAndReadSnapshot(ephemeralFeedPort, 15_000);
        expect(result).not.toBeNull();
        if (result === null) {
          throw new Error(
            `Did not receive HELLO + SNAPSHOT within 15s on port ${String(ephemeralFeedPort)}`,
          );
        }

        // 4) THE REGRESSION ASSERTION:
        //    If start.ts:353 was `await bot.start()` (the original bug),
        //    markBotStarted() would never be called, and the SNAPSHOT's
        //    botStatus would be:
        //      - state: "stopped" (botRunning=false)
        //      - startedAt: 0
        //    The fix (fire-and-forget + synchronous markBotStarted) ensures
        //    the SNAPSHOT's botStatus reflects the running state immediately
        //    after the state-feed is up.
        const { state, startedAt } = result.botStatus;
        expect(state).toBe("running");
        expect(startedAt).toBeGreaterThan(0);
        // The startedAt should be a recent timestamp — within the last
        // 60 seconds (allowing for slow bot init in CI).
        const now = Date.now();
        expect(startedAt).toBeLessThanOrEqual(now);
        expect(now - startedAt).toBeLessThan(60_000);
      } finally {
        await cleanup();
      }
    },
    60_000, // 60s test timeout (bot init + state propagation)
  );
});
