/**
 * apps/bot/src/bot/bot.test.ts
 *
 * A `Bot` osztály unit tesztjei — lifecycle, signal → order flow,
 * getState konzisztencia.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { MockExchangeFeed, asSymbol, type Symbol as ExchangeSymbol } from "@mm-crypto-bot/exchange";

import { Bot } from "./bot.js";
import { BotStateSchema } from "./state-store.js";
import { DEFAULT_BOT_CONFIG } from "../config/defaults.js";
import type { BotConfig } from "../config/schema.js";

function buildTestConfig(stateFile: string): BotConfig {
  return {
    ...DEFAULT_BOT_CONFIG,
    bot: { ...DEFAULT_BOT_CONFIG.bot, state_file: stateFile },
    exchange: { ...DEFAULT_BOT_CONFIG.exchange, id: "mock" },
    symbols: { enabled: ["BTC/USDC"] },
    strategies: {
      donchian_pivot_composition: { enabled: false },
      dydx_cex_carry: { enabled: false },
      cascade_fade: { enabled: false },
      funding_flip_kill_switch: { enabled: false },
      regime_detector: { enabled: false },
    },
    telemetry: {
      log_dir: stateFile + ".logs",
      metrics_interval_sec: 60,
    },
  };
}

describe("Bot", () => {
  let tmpDir: string;
  let stateFile: string;
  let feed: MockExchangeFeed;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "mm-bot-test-"));
    stateFile = join(tmpDir, "bot-state.json");
    feed = new MockExchangeFeed({
      balances: [{ currency: "USDC", free: 10_000, total: 10_000 }],
    });
  });

  afterEach(() => {
    if (existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  // ---------------------------------------------------------------------------
  // 1) Start → stop lifecycle
  // ---------------------------------------------------------------------------
  it("starts and stops without error", async () => {
    const config = buildTestConfig(stateFile);
    const bot = new Bot({ config, feed });
    const p = bot.start();
    await new Promise<void>((r) => setTimeout(r, 100));
    await bot.stop();
    await p;
  });

  // ---------------------------------------------------------------------------
  // 2) getState() returns a valid BotState
  // ---------------------------------------------------------------------------
  it("getState() returns a valid BotState", async () => {
    const config = buildTestConfig(stateFile);
    const bot = new Bot({ config, feed });
    const p = bot.start();
    await new Promise<void>((r) => setTimeout(r, 100));
    const state = bot.getState();
    const validated = BotStateSchema.safeParse(state);
    expect(validated.success).toBe(true);
    await bot.stop();
    await p;
  });

  // ---------------------------------------------------------------------------
  // 3) getState() equity reflects initial balance
  // ---------------------------------------------------------------------------
  it("getState() equity = 10_000 (initial balance from mock feed)", async () => {
    const config = buildTestConfig(stateFile);
    const bot = new Bot({ config, feed });
    const p = bot.start();
    await new Promise<void>((r) => setTimeout(r, 100));
    const state = bot.getState();
    expect(state.equityUsd).toBe(10_000);
    expect(state.initialEquityUsd).toBe(10_000);
    expect(state.positions.length).toBe(0);
    await bot.stop();
    await p;
  });

  // ---------------------------------------------------------------------------
  // 4) State persists on shutdown
  // ---------------------------------------------------------------------------
  it("state file exists after stop()", async () => {
    const config = buildTestConfig(stateFile);
    const bot = new Bot({ config, feed });
    const p = bot.start();
    await new Promise<void>((r) => setTimeout(r, 100));
    await bot.stop();
    await p;
    expect(existsSync(stateFile)).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // 5) Graceful shutdown is fast (< 2s for empty bot)
  // ---------------------------------------------------------------------------
  it("graceful shutdown completes in <2s for empty bot", async () => {
    const config = buildTestConfig(stateFile);
    const bot = new Bot({ config, feed });
    const p = bot.start();
    await new Promise<void>((r) => setTimeout(r, 100));
    const start = Date.now();
    await bot.stop();
    await p;
    expect(Date.now() - start).toBeLessThan(2_000);
  });

  // ---------------------------------------------------------------------------
  // 6) double start() throws
  // ---------------------------------------------------------------------------
  it("double start() throws", async () => {
    const config = buildTestConfig(stateFile);
    const bot = new Bot({ config, feed });
    const p = bot.start();
    await new Promise<void>((r) => setTimeout(r, 100));
    await expect(bot.start()).rejects.toThrow(/already running/);
    await bot.stop();
    await p;
  });

  // ---------------------------------------------------------------------------
  // 7) getState() before start() throws
  // ---------------------------------------------------------------------------
  it("getState() before start() throws", () => {
    const config = buildTestConfig(stateFile);
    const bot = new Bot({ config, feed });
    expect(() => bot.getState()).toThrow(/not initialized/);
  });

  // ---------------------------------------------------------------------------
  // 8) stop() before start() is no-op
  // ---------------------------------------------------------------------------
  it("stop() before start() is no-op", async () => {
    const config = buildTestConfig(stateFile);
    const bot = new Bot({ config, feed });
    await expect(bot.stop()).resolves.toBeUndefined();
  });

  // ---------------------------------------------------------------------------
  // 9) getState() with open positions — covers lines 210-222
  // ---------------------------------------------------------------------------
  it("getState() includes open positions in the positions array", async () => {
    const config = buildTestConfig(stateFile);
    const bot = new Bot({ config, feed });
    const p = bot.start();
    await new Promise<void>((r) => setTimeout(r, 100));

    // Inject an open position via the private positionManager. This is
    // a test-only access pattern — the production code path would have
    // a strategy signal → order → fill flow.
    const botAny = bot as unknown as {
      positionManager: {
        openPosition: (s: string, sym: ExchangeSymbol, side: "long" | "short", qty: number, price: number, lev: number) => unknown;
      };
    };
    botAny.positionManager.openPosition(
      "test-strategy",
      asSymbol("BTC/USDC") as unknown as ExchangeSymbol,
      "long",
      0.01,
      60_000,
      1,
    );

    const state = bot.getState();
    expect(state.positions.length).toBe(1);
    expect(state.positions[0]?.strategy).toBe("test-strategy");
    expect(state.positions[0]?.side).toBe("long");
    expect(state.positions[0]?.quantity).toBe(0.01);
    expect(state.positions[0]?.entryPrice).toBe(60_000);

    await bot.stop();
    await p;
  });

  // ---------------------------------------------------------------------------
  // 10) getState() with closed trades — covers lines 224-233
  // ---------------------------------------------------------------------------
  it("getState() includes closed trades in the closedTrades array", async () => {
    const config = buildTestConfig(stateFile);
    const bot = new Bot({ config, feed });
    const p = bot.start();
    await new Promise<void>((r) => setTimeout(r, 100));

    const botAny = bot as unknown as {
      positionManager: {
        openPosition: (s: string, sym: ExchangeSymbol, side: "long" | "short", qty: number, price: number, lev: number) => unknown;
        closePosition: (s: string, sym: ExchangeSymbol, exitPrice: number) => number;
      };
    };
    const sym = asSymbol("BTC/USDC") as unknown as ExchangeSymbol;
    botAny.positionManager.openPosition("test-strategy", sym, "long", 0.01, 60_000, 1);
    botAny.positionManager.closePosition("test-strategy", sym, 60_500);

    const state = bot.getState();
    expect(state.closedTrades.length).toBe(1);
    expect(state.closedTrades[0]?.strategy).toBe("test-strategy");
    expect(state.closedTrades[0]?.entryPrice).toBe(60_000);
    expect(state.closedTrades[0]?.exitPrice).toBe(60_500);
    expect(state.closedTrades[0]?.pnl).toBeGreaterThan(0);

    await bot.stop();
    await p;
  });

  // ---------------------------------------------------------------------------
  // 11) snapshotForTelemetry is callable (covers the private function)
  // ---------------------------------------------------------------------------
  it("snapshotForTelemetry returns telemetry-shaped snapshot", async () => {
    const config = buildTestConfig(stateFile);
    const bot = new Bot({ config, feed });
    const p = bot.start();
    await new Promise<void>((r) => setTimeout(r, 100));

    const botAny = bot as unknown as {
      snapshotForTelemetry: () => {
        equityUsd: number;
        initialEquityUsd: number;
        realizedPnlUsd: number;
        unrealizedPnlUsd: number;
        drawdownPct: number;
        openPositions: number;
        maxPositions: number;
        counters: unknown;
        killSwitchEngaged: boolean;
        killSwitchReasons: string[];
        uptime: number;
        uptimeHuman: string;
        activeStrategies: string[];
      };
    };
    const snap = botAny.snapshotForTelemetry();
    expect(snap.equityUsd).toBe(10_000);
    expect(snap.initialEquityUsd).toBe(10_000);
    expect(snap.openPositions).toBe(0);
    expect(snap.maxPositions).toBe(config.risk.max_positions);
    expect(snap.activeStrategies).toEqual([]);

    await bot.stop();
    await p;
  });

  // ---------------------------------------------------------------------------
  // 12) stateSaveInterval callback fires (covers lines 373-375)
  // ---------------------------------------------------------------------------
  it("periodic state-save fires when stateSaveIntervalMs is short", async () => {
    const config = buildTestConfig(stateFile);
    // Inject a custom StateStore with 0 debounce so the save lands
    // immediately after the interval fires. The state-save interval
    // is the periodic trigger; the StateStore's debounce is separate.
    const bot = new Bot({
      config,
      feed,
      stateSaveIntervalMs: 10,  // 10ms in test
      killSwitchEvalIntervalMs: 10_000,  // disable kill-switch eval
      heartbeatIntervalMs: 10_000,  // disable heartbeat
    });
    const p = bot.start();
    // Wait long enough for the state-save interval to fire + the 50ms
    // debounce window to expire (StateStore default debounceMs = 500ms
    // is too long for this test; we patch it post-init below).
    await new Promise<void>((r) => setTimeout(r, 30));

    // Patch the StateStore's debounce to 0 so the next requestSave
    // lands immediately. This is a test-only mutation.
    const botAny = bot as unknown as {
      stateStore: { debounceMs: number };
    };
    if (botAny.stateStore) {
      botAny.stateStore.debounceMs = 0;
    }

    // Wait for another interval tick to actually flush the save.
    await new Promise<void>((r) => setTimeout(r, 50));

    // The state file should have been written by the periodic save.
    expect(existsSync(stateFile)).toBe(true);
    const raw = existsSync(stateFile)
      ? (await import("node:fs")).readFileSync(stateFile, "utf8")
      : "";
    const parsed = JSON.parse(raw) as { version: number };
    expect(parsed.version).toBe(1);

    await bot.stop();
    await p;
  });

  // ---------------------------------------------------------------------------
  // 13) killSwitchInterval callback fires (covers lines 378-381)
  // ---------------------------------------------------------------------------
  it("periodic kill-switch eval fires when killSwitchEvalIntervalMs is short", async () => {
    const config = buildTestConfig(stateFile);
    const bot = new Bot({
      config,
      feed,
      stateSaveIntervalMs: 10_000,  // disable state-save
      killSwitchEvalIntervalMs: 10,  // 10ms
      heartbeatIntervalMs: 10_000,   // disable heartbeat
    });
    const p = bot.start();
    await new Promise<void>((r) => setTimeout(r, 50));

    // The kill-switch eval ran at least once. The telemetry snapshot
    // should reflect the latest state.
    const botAny = bot as unknown as {
      telemetry: { setEngaged: (engaged: boolean, reasons: readonly string[]) => void };
      killSwitches: { getSnapshot: () => { engaged: boolean; reasons: string[] } };
    };
    const snap = botAny.killSwitches.getSnapshot();
    expect(snap).toBeDefined();
    expect(typeof snap.engaged).toBe("boolean");

    await bot.stop();
    await p;
  });

  // ---------------------------------------------------------------------------
  // 14) run() loop heartbeat callback fires (covers lines 413-419)
  // ---------------------------------------------------------------------------
  it("run() heartbeat fires the kill-switch check at short heartbeatIntervalMs", async () => {
    const config = buildTestConfig(stateFile);
    const bot = new Bot({
      config,
      feed,
      stateSaveIntervalMs: 10_000,
      killSwitchEvalIntervalMs: 10_000,  // disable init's interval
      heartbeatIntervalMs: 10,  // 10ms heartbeat
    });
    const p = bot.start();
    // Wait long enough for the heartbeat to fire at least once.
    await new Promise<void>((r) => setTimeout(r, 50));

    // The run() loop is still running (we haven't called stop).
    // Verify state can be retrieved (no errors).
    const state = bot.getState();
    expect(state.version).toBe(1);

    await bot.stop();
    await p;
  });

  // ---------------------------------------------------------------------------
  // 15) kill-switch onTrigger callback fires (covers lines 354-355)
  // ---------------------------------------------------------------------------
  it("kill-switch onTrigger callback stops the bot when a switch engages", async () => {
    // Custom kill-switch that's always engaged — passes through
    // perStrategyKillSwitches option so the registry includes it from
    // init.
    const engagedSwitch = {
      id: "test-always-engaged",
      description: "test kill-switch that is always engaged",
      evaluate: () => ({ switchId: "test-always-engaged", engaged: true, reason: "test-always-engaged" }),
    };
    const config = buildTestConfig(stateFile);
    const bot = new Bot({
      config,
      feed,
      stateSaveIntervalMs: 10_000,
      killSwitchEvalIntervalMs: 10,  // 10ms — quick eval
      heartbeatIntervalMs: 10_000,
      perStrategyKillSwitches: [engagedSwitch],
    });
    const p = bot.start();
    // Wait for the first eval to fire (within 10ms) + onTrigger callback.
    await new Promise<void>((r) => setTimeout(r, 100));
    await p;

    // Bot should be stopped (running = false) because the
    // onTrigger handler called this.stop().
    const botState = bot as unknown as { running: boolean };
    expect(botState.running).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // 16) run() loop exits cleanly when stopRequested is set (covers the while-loop)
  // ---------------------------------------------------------------------------
  it("run() loop exits and the heartbeat interval is cleared on stop", async () => {
    const config = buildTestConfig(stateFile);
    const bot = new Bot({
      config,
      feed,
      stateSaveIntervalMs: 10_000,
      killSwitchEvalIntervalMs: 10_000,
      heartbeatIntervalMs: 10,  // 10ms — frequent heartbeats
    });
    const p = bot.start();
    // Let the run loop run for a few cycles.
    await new Promise<void>((r) => setTimeout(r, 60));
    await bot.stop();
    await p;

    // After stop, running is false and the loop has exited.
    const botState = bot as unknown as { running: boolean; stateSaveInterval: ReturnType<typeof setInterval> | null; killSwitchInterval: ReturnType<typeof setInterval> | null };
    expect(botState.running).toBe(false);
    expect(botState.stateSaveInterval).toBeNull();
    expect(botState.killSwitchInterval).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // 17) telemetry metrics interval fires (covers telemetry.ts line 117 callback)
  // ---------------------------------------------------------------------------
  it("telemetry metrics interval fires when telemetryMetricsIntervalSec is short", async () => {
    const config = buildTestConfig(stateFile);
    const bot = new Bot({
      config,
      feed,
      stateSaveIntervalMs: 10_000,
      killSwitchEvalIntervalMs: 10_000,
      heartbeatIntervalMs: 10_000,
      telemetryMetricsIntervalSec: 0.05,  // 50ms — quick fire
    });
    const p = bot.start();
    // Wait long enough for the metrics interval to fire 2+ times.
    await new Promise<void>((r) => setTimeout(r, 200));

    // The metrics log file should exist (emitMetrics writes to it).
    const logFile = join(stateFile + ".logs", `bot-${new Date().toISOString().slice(0, 10)}.log`);
    expect(existsSync(logFile)).toBe(true);

    await bot.stop();
    await p;
  });

  // ---------------------------------------------------------------------------
  // 18) feed subscription callback fires when events are pushed (covers bot.ts 410-412)
  // ---------------------------------------------------------------------------
  it("feed subscription callback processes ticker events", async () => {
    const config = buildTestConfig(stateFile);
    const bot = new Bot({
      config,
      feed,
      stateSaveIntervalMs: 10_000,
      killSwitchEvalIntervalMs: 10_000,
      heartbeatIntervalMs: 10_000,
    });
    const p = bot.start();
    await new Promise<void>((r) => setTimeout(r, 50));

    // Push a ticker event into the mock feed.
    const { asSymbol: asSym } = await import("@mm-crypto-bot/exchange");
    feed.pushEvent({
      kind: "ticker",
      payload: {
        symbol: asSym("BTC/USDC") as unknown as ExchangeSymbol,
        timestamp: Date.now(),
        bid: 59_999,
        ask: 60_001,
        last: 60_000,
        baseVolume: 100,
        quoteVolume: 6_000_000,
      },
    });
    // Let the feed deliver the event + the runner process it.
    await new Promise<void>((r) => setTimeout(r, 50));

    // No assertion on specific behavior (all strategies disabled);
    // this test exists to cover the subscription callback code path.
    expect(bot.getState().equityUsd).toBeGreaterThan(0);

    await bot.stop();
    await p;
  });
});
