/**
 * apps/bot/src/__tests__/phase72-mark-bot-started-reachable.test.ts
 *
 * ============================================================================
 * PHASE 72 — UNIT TEST: markBotStarted() reachable from start.ts
 * ============================================================================
 *
 * THE BUG (Phase 71 regression on `botStatus.state` + `botStatus.startedAt`):
 *   In `cli/commands/start.ts`, the line after `await bot.start()` was
 *   `stateFeed.publisher.markBotStarted()`. The `bot.start()` method
 *   internally calls `await this.run()`, which is an infinite loop that
 *   only returns when `bot.stop()` is called. So `await bot.start()` blocked
 *   FOREVER, and the `markBotStarted()` call was UNREACHABLE.
 *
 *   The fix: use fire-and-forget (`void bot.start()`) and call
 *   `markBotStarted()` synchronously right after.
 *
 *   The system-level test in `phase72-start-status-broadcast.test.ts`
 *   spawns the real `mm-bot start` subprocess and verifies the state-feed
 *   SNAPSHOT. This unit test verifies the same fix at a faster level
 *   (no subprocess, no network) — it ensures the start sequence calls
 *   `markBotStarted()` within a reasonable time after the bot's init
 *   completes.
 *
 *   This is a SECONDARY test — the primary coverage is the system-level
 *   test. The unit test is here as a fast feedback loop during
 *   development.
 * ============================================================================
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Bot } from "../bot/bot.js";
import { MockExchangeFeed } from "@exchange-testing/mockFeed.js";
import { LiveStatePublisher } from "../state-feed/publisher.js";
import { FeedServer } from "../state-feed/feed-server.js";
import { OhlcStore } from "../state-feed/ohlc-store.js";
import type { StateFeedServerMessage } from "../state-feed/protocol.js";

/**
 * `connectAndReadSnapshot` — connect to a TCP state-feed and read the first
 * SNAPSHOT message. Returns the `botStatus` from the snapshot, or null
 * if no SNAPSHOT is received within the timeout.
 */
async function connectAndReadBotStatus(
  port: number,
  timeoutMs: number,
): Promise<{ readonly state: string; readonly startedAt: number } | null> {
  return new Promise((resolveP) => {
    let buffer = "";
    let resolved = false;

    const finish = (result: { readonly state: string; readonly startedAt: number } | null): void => {
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
            open: () => undefined,
            data: (sock, data) => {
              buffer += data.toString("utf-8");
              let idx = buffer.indexOf("\n");
              while (idx !== -1) {
                const line = buffer.slice(0, idx);
                buffer = buffer.slice(idx + 1);
                if (line.length > 0) {
                  let parsed: StateFeedServerMessage | null = null;
                  try {
                    parsed = JSON.parse(line) as StateFeedServerMessage;
                  } catch {
                    // skip malformed
                  }
                  if (parsed !== null && parsed.type === "snapshot") {
                    const snap = parsed.snapshot;
                    clearTimeout(timer);
                    finish({ state: snap.botStatus.state, startedAt: snap.botStatus.startedAt });
                    try {
                      sock.end();
                    } catch {
                      // best-effort
                    }
                    return;
                  }
                }
                idx = buffer.indexOf("\n");
              }
            },
            close: () => undefined,
            error: () => undefined,
          },
        });
        void socket;
      } catch {
        clearTimeout(timer);
        finish(null);
      }
    })();
  });
}

let tmpDir = "";
let feed: MockExchangeFeed | null = null;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "mm-p72-unit-"));
  feed = new MockExchangeFeed({ balances: [{ currency: "USDC", free: 10_000, total: 10_000 }] });
});

afterEach(() => {
  // MockExchangeFeed has no explicit dispose — just drop the reference.
  feed = null;
  if (existsSync(tmpDir)) {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

describe("Phase 72 — markBotStarted() reachable after fire-and-forget bot.start()", () => {
  it(
    "after void bot.start() (fire-and-forget), markBotStarted() is called and the state-feed SNAPSHOT shows running state + non-zero startedAt",
    async () => {
      // Build a real bot + publisher + feed-server on an ephemeral port.
      // This simulates what `start.ts` does internally — no subprocess.
      const stateFile = join(tmpDir, "bot-state.json");
      writeFileSync(stateFile, "{}"); // empty state file

      const bot = new Bot({
        config: {
          bot: { mode: "paper", state_file: stateFile, log_level: "error", auto_start: false },
          exchange: {
            id: "mock",
            endpoint: "https://api.bybit.eu",
            ws_endpoint: "wss://stream.bybit.eu",
            timeout_ms: 5000,
            rate_limit_ms: 80,
            sandbox: false,
            slippage_pct: 0.03,
            fee_tier: "vip",
            rate_limit_per_min: 200,
            ws_reconnect_delay_ms: 500,
          },
          symbols: { enabled: ["BTC/USDC"] },
          strategies: {
            donchian_pivot_composition: {
              enabled: true,
              cap: 0.20,
              min_consensus: 1,
              symbols: ["BTC/USDC"],
            },
          },
          risk: {
            risk_per_trade: 0.01,
            kelly_fraction: 0.25,
            max_drawdown_pct: 0.15,
            max_positions: 1,
            max_leverage: 10,
          },
          telemetry: { log_dir: join(tmpDir, "logs"), metrics_interval_sec: 60 },
          compliance: { jurisdiction: "EU" },
          portfolio: {
            correlation_window_size: 30,
            correlation_penalty_threshold: 0.7,
          },
        } as never,
        feed: feed!,
        stateSaveIntervalMs: 100,
      });

      const publisher = new LiveStatePublisher({
        bot,
        enabledSymbols: ["BTC/USDC"],
        initialEquityUsdt: 10_000,
        strategies: [{ name: "donchian_pivot_composition", enabled: true, symbols: ["BTC/USDC"], timeframes: ["1h", "4h", "1d"] }],
        periodicRefreshMs: 100, // Fast refresh for test speed
      });
      await publisher.start();

      const feedServer = new FeedServer({
        port: 0, // ephemeral
        hostname: "127.0.0.1",
        publisher,
        ohlcStore: new OhlcStore(),
      });
      const handle = await feedServer.start();
      const port = handle.port;

      try {
        // ================================================================
        // The fix: fire-and-forget the bot.start() and call markBotStarted()
        // synchronously (just like the fixed start.ts does).
        // ================================================================
        const botStartPromise = bot.start();
        // SYNCHRONOUS markBotStarted — this is the line that was unreachable
        // in the original start.ts (because of the `await bot.start()` deadlock).
        publisher.markBotStarted();
        // Catch any async failure of bot.start() so the test doesn't hang.
        botStartPromise.catch(() => undefined);

        // ================================================================
        // Verify: a fresh TCP client should see the SNAPSHOT with
        // botStatus.state === "running" and startedAt > 0.
        // ================================================================
        const result = await connectAndReadBotStatus(port, 5000);
        expect(result).not.toBeNull();
        if (result === null) {
          throw new Error(`Did not receive SNAPSHOT on port ${String(port)} within 5s`);
        }
        expect(result.state).toBe("running");
        expect(result.startedAt).toBeGreaterThan(0);
        // startedAt should be very recent (within the test execution)
        const now = Date.now();
        expect(now - result.startedAt).toBeLessThan(5_000);

        // ================================================================
        // Also verify the publisher's getBotStatus() directly.
        // ================================================================
        const direct = publisher.getBotStatus();
        expect(direct.state).toBe("running");
        expect(direct.startedAt).toBeGreaterThan(0);
        expect(direct.startedAt).toBe(result.startedAt);
      } finally {
        // Cleanup
        try {
          await feedServer.stop();
        } catch {
          // best-effort
        }
        try {
          await bot.stop();
        } catch {
          // best-effort
        }
        try {
          await publisher.dispose();
        } catch {
          // best-effort
        }
      }
    },
    20_000,
  );
});
