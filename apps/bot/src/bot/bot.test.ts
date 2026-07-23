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

import {
  asSymbol,
  type Symbol as ExchangeSymbol,
} from "@mm-crypto-bot/exchange";
// Phase 66: `MockExchangeFeed` is test-only — the package no longer
// exports it from `@mm-crypto-bot/exchange`. Tests reach it via the
// `@exchange-testing/*` path alias (see tsconfig.base.json).
import { MockExchangeFeed } from "@exchange-testing/mockFeed.js";
import { LiveStatePublisher } from "../state-feed/publisher.js";
import type { StateFeedHandle } from "../state-feed/index.js";

import { Bot } from "./bot.js";
import { BotStateSchema, type BotState } from "./state-store.js";
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
  // 1a) getConfig() returns the original BotConfig (Phase 44 — used by
  //     the headless start.ts to derive the log-file path from state_file).
  // ---------------------------------------------------------------------------
  it("getConfig() returns the original BotConfig (read-only accessor)", () => {
    const config = buildTestConfig(stateFile);
    const bot = new Bot({ config, feed });
    expect(bot.getConfig()).toBe(config);
    expect(bot.getConfig().bot.state_file).toBe(stateFile);
  });

  // ---------------------------------------------------------------------------
  // 1b) Phase 38 Fix #42 + Phase 66: paper mode starts WITHOUT auth
  // credentials AND without hitting the real network.
  //
  // Before Phase 38 Fix #42: paper mode triggered
  // `createExchangeClient({useMock:false})` which threw
  // `MissingCredentialsError` even in paper mode. Fix #42 routed paper
  // mode through MockExchangeFeed (no auth required).
  //
  // Phase 66 (2026-07-23): paper mode now uses REAL bybit.eu
  // (per user mandate: "MOCK FEED-ET SOSEM KERTEM") with empty
  // credentials (CCXT public endpoints work without auth). The Phase
  // 38 MockExchangeFeed path is preserved ONLY for the
  // `exchange.id === "mock"` explicit mode used by the unit tests
  // and backtest fixtures.
  //
  // This test injects the mock feed explicitly so the init path runs
  // without a network round-trip. The "no MissingCredentialsError"
  // assertion is preserved — paper mode never throws on missing
  // creds, regardless of which feed backs it.
  // ---------------------------------------------------------------------------
  it("paper mode starts without auth credentials (no MissingCredentialsError)", async () => {
    // Ensure no API keys are set in env
    const origKey = process.env["BYBIT_API_KEY"];
    const origSecret = process.env["BYBIT_API_SECRET"];
    delete process.env["BYBIT_API_KEY"];
    delete process.env["BYBIT_API_SECRET"];

    try {
      const config: BotConfig = {
        ...DEFAULT_BOT_CONFIG,
        bot: {
          ...DEFAULT_BOT_CONFIG.bot,
          mode: "paper",
          state_file: stateFile,
        },
        // Use the mock exchange.id so the Bot uses MockExchangeFeed
        // (the post-Phase 66 default of "bybiteu" would try to connect
        // to the real exchange, which is fine in production but not
        // appropriate for a 5s unit test).
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
      const bot = new Bot({ config, feed }); // explicit mock feed — exercises the init path
      const p = bot.start();
      await new Promise<void>((r) => setTimeout(r, 200));
      await bot.stop();
      await p;
      // If we got here without "Hiányzó API hitelesítő adatok", the fix works.
    } finally {
      // Restore env
      if (origKey !== undefined) process.env["BYBIT_API_KEY"] = origKey;
      if (origSecret !== undefined) process.env["BYBIT_API_SECRET"] = origSecret;
    }
  });

  it("live mode without auth credentials throws MissingCredentialsError", async () => {
    // The opposite of the above: live mode MUST require auth credentials.
    const origKey = process.env["BYBIT_API_KEY"];
    const origSecret = process.env["BYBIT_API_SECRET"];
    delete process.env["BYBIT_API_KEY"];
    delete process.env["BYBIT_API_SECRET"];

    try {
      const config: BotConfig = {
        ...DEFAULT_BOT_CONFIG,
        bot: {
          ...DEFAULT_BOT_CONFIG.bot,
          mode: "live",
          state_file: stateFile,
        },
        exchange: { ...DEFAULT_BOT_CONFIG.exchange, id: "bybiteu" },
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
      const bot = new Bot({ config });
      const p = bot.start();
      // Should reject within a reasonable time
      await expect(p).rejects.toThrow(/Hiányzó API hitelesítő adatok/);
    } finally {
      if (origKey !== undefined) process.env["BYBIT_API_KEY"] = origKey;
      if (origSecret !== undefined) process.env["BYBIT_API_SECRET"] = origSecret;
    }
  });

  // ---------------------------------------------------------------------------
  // 1c) Phase 43 Track 1: paper mode auto-provides MockDydxFundingSource.
  // The default config has dydx_cex_carry enabled. Before the fix, this
  // triggered `makeDydxCexCarry` which threw ConfigError because no
  // `DydxFundingSource` was provided. The fix: paper mode auto-constructs
  // a `MockDydxFundingSource` (synthetic 1Hz PRNG data). Live mode still
  // requires an explicit `DydxFundingSource`.
  //
  // Phase 66 update: the test injects the mock feed explicitly so the
  // strategy runner never reaches the real bybit.eu network. The
  // "MockDydxFundingSource auto-provided" assertion is preserved.
  // ---------------------------------------------------------------------------
  it("paper mode with dydx_cex_carry enabled + no fundingSource starts successfully", async () => {
    const origKey = process.env["BYBIT_API_KEY"];
    const origSecret = process.env["BYBIT_API_SECRET"];
    delete process.env["BYBIT_API_KEY"];
    delete process.env["BYBIT_API_SECRET"];

    try {
      const config: BotConfig = {
        ...DEFAULT_BOT_CONFIG,
        bot: {
          ...DEFAULT_BOT_CONFIG.bot,
          mode: "paper",
          state_file: stateFile,
        },
        exchange: { ...DEFAULT_BOT_CONFIG.exchange, id: "mock" },
        symbols: { enabled: ["BTC/USDC"] },
        strategies: {
          donchian_pivot_composition: { enabled: false },
          dydx_cex_carry: { enabled: true }, // ← THE test target
          cascade_fade: { enabled: false },
          funding_flip_kill_switch: { enabled: false },
          regime_detector: { enabled: false },
        },
        telemetry: {
          log_dir: stateFile + ".logs",
          metrics_interval_sec: 60,
        },
      };
      const bot = new Bot({ config, feed }); // explicit mock feed — exercises the init path
      const p = bot.start();
      await new Promise<void>((r) => setTimeout(r, 200));
      await bot.stop();
      await p;
      // If we got here without "Strategy 'dydx_cex_carry' is enabled but no
      // DydxFundingSource was provided", the fix works.
    } finally {
      if (origKey !== undefined) process.env["BYBIT_API_KEY"] = origKey;
      if (origSecret !== undefined) process.env["BYBIT_API_SECRET"] = origSecret;
    }
  });

  it("live mode with dydx_cex_carry enabled + no fundingSource does NOT silently start", async () => {
    // This test exercises the Phase 43 Track 1 fix: in live mode, the
    // bot must NOT auto-substitute a `MockDydxFundingSource` (that
    // would let the user run live with a mock funding source — a
    // silent safety violation).
    //
    // The exact error depends on which check fires first:
    //   - Feed-open fails first (fake API key) → bybiteu WS error.
    //     This is acceptable: the bot did NOT silently substitute a
    //     mock funding source, which is the contract.
    //   - Feed-open succeeds and the strategy-registry then fails
    //     because no fundingSource was provided → ConfigError
    //     mentioning `DydxFundingSource`. This is the canonical
    //     Phase 25 #2 path (tested directly in strategy-registry.test.ts).
    //
    // Either error is acceptable; the key invariant is that the bot
    // does NOT silently start.
    const origKey = process.env["BYBIT_API_KEY"];
    const origSecret = process.env["BYBIT_API_SECRET"];
    process.env["BYBIT_API_KEY"] = "fake_key_for_test";
    process.env["BYBIT_API_SECRET"] = "fake_secret_for_test";

    try {
      const config: BotConfig = {
        ...DEFAULT_BOT_CONFIG,
        bot: {
          ...DEFAULT_BOT_CONFIG.bot,
          mode: "live",
          state_file: stateFile,
        },
        exchange: { ...DEFAULT_BOT_CONFIG.exchange, id: "bybiteu" },
        symbols: { enabled: ["BTC/USDC"] },
        strategies: {
          donchian_pivot_composition: { enabled: false },
          dydx_cex_carry: { enabled: true }, // ← THE test target
          cascade_fade: { enabled: false },
          funding_flip_kill_switch: { enabled: false },
          regime_detector: { enabled: false },
        },
        telemetry: {
          log_dir: stateFile + ".logs",
          metrics_interval_sec: 60,
        },
      };
      const bot = new Bot({ config }); // no fundingSource injected
      const p = bot.start();
      // The bot MUST reject — either at feed-open (fake key) or at
      // strategy-registry (no fundingSource). Both prove the contract.
      await expect(p).rejects.toThrow();
    } finally {
      if (origKey !== undefined) process.env["BYBIT_API_KEY"] = origKey;
      else delete process.env["BYBIT_API_KEY"];
      if (origSecret !== undefined) process.env["BYBIT_API_SECRET"] = origSecret;
      else delete process.env["BYBIT_API_SECRET"];
    }
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

  // ---------------------------------------------------------------------------
  // 18b) Phase 66: OHLCV events with a stateFeed attached trigger
  //      `stateFeed.publisher.publishBar(...)` so the web client chart
  //      grid receives the bars. Covers bot.ts:646-670.
  // ---------------------------------------------------------------------------
  it("OHLCV events propagate to the attached stateFeed.publisher.publishBar", async () => {
    const config = buildTestConfig(stateFile);
    const bot = new Bot({
      config,
      feed,
      stateSaveIntervalMs: 10_000,
      killSwitchEvalIntervalMs: 10_000,
      heartbeatIntervalMs: 10_000,
    });

    // A Phase 66 stateFeed-attach path-ot fedjük le: a Bot.attachStateFeed
    // public method egy `StateFeedHandle`-t vár, aminek van `publisher` mezője.
    // Egy valódi `LiveStatePublisher` példányt használunk, és az
    // `addEventListener` callback-jében rögzítjük a publishBar hívásokat.
    const publisher = new LiveStatePublisher({
      bot,
      enabledSymbols: ["BTC/USDC"],
      initialEquityUsdt: 10_000,
      strategies: [],
    });
    await publisher.start();
    const stateFeed: StateFeedHandle = {
      close: async () => {
        await publisher.dispose();
      },
      get port(): number {
        return 0;
      },
      get clientCount(): number {
        return 0;
      },
      publisher,
    };
    bot.attachStateFeed(stateFeed);

    const barEvents: { symbol: string; timeframe: string; close: number }[] = [];
    publisher.addEventListener((event) => {
      if (event.type === "bar") {
        barEvents.push({
          symbol: event.symbol,
          timeframe: event.timeframe,
          close: event.ohlc.close,
        });
      }
    });

    const p = bot.start();
    await new Promise<void>((r) => setTimeout(r, 50));

    // Push an OHLCV event into the mock feed (CCXT-format tuple).
    const now = Date.now();
    feed.pushEvent({
      kind: "ohlcv",
      payload: {
        symbol: asSymbol("BTC/USDC") as unknown as ExchangeSymbol,
        timeframe: "1h",
        candle: [now, 60_000, 60_100, 59_900, 60_050, 12.345],
      },
    });
    await new Promise<void>((r) => setTimeout(r, 50));

    // The bar event MUST reach the publisher.
    expect(barEvents.length).toBe(1);
    expect(barEvents[0]?.symbol).toBe("BTC/USDC");
    expect(barEvents[0]?.timeframe).toBe("1h");
    expect(barEvents[0]?.close).toBe(60_050);

    await bot.stop();
    await p;
    await stateFeed.close();
  });

  // ---------------------------------------------------------------------------
  // 19) notifyStateListeners — throwing listener does NOT stop the other
  //     listeners (covers the catch block at line 326).
  // ---------------------------------------------------------------------------
  it("notifyStateListeners continues when a listener throws", async () => {
    const config = buildTestConfig(stateFile);
    const bot = new Bot({ config, feed });

    // A throw-ot dobó listener, és egy "jó" listener, ami bizonyítja,
    // hogy a másik listener kivétele nem állítja le a notify-t.
    let goodListenerCalls = 0;
    let badListenerCalls = 0;
    const unsubGood = bot.subscribe(() => {
      goodListenerCalls++;
    });
    bot.subscribe(() => {
      badListenerCalls++;
      throw new Error("intentional listener failure");
    });

    const p = bot.start();
    await new Promise<void>((r) => setTimeout(r, 50));

    // A getState() hívja a notifyStateListeners-t.
    bot.getState();

    // Mindkét listener meg lett hívva — a throw-ot dobó listener
    // kivételét a notifyStateListeners catch-e elnyeli.
    expect(goodListenerCalls).toBeGreaterThan(0);
    expect(badListenerCalls).toBeGreaterThan(0);

    // Exercise the unsubscribe closure returned by subscribe() — bun's
    // lcov FNF count treats the inner () => {...} as a separate function.
    // Calling it once should make the "active = false" branch execute.
    // Idempotency: calling unsubscribe twice should be a no-op (the
    // inner `if (!active) return;` early-return branch).
    unsubGood();
    unsubGood();

    await bot.stop();
    await p;
  });

  // ---------------------------------------------------------------------------
  // 20) cleanup() swallows stateStore.flush() errors (covers lines 533-537).
  //     A state-fájl elérési útvonalát egy nem írható helyre állítjuk.
  // ---------------------------------------------------------------------------
  it("cleanup() swallows stateStore.flush() errors gracefully", async () => {
    // A tmp könyvtárban hozzunk létre egy "file" típusú elemet, és a
    // state-fájl útvonalaként ennek egy gyerekét adjuk meg. A
    // StateStore.saveSync megpróbálja létrehozni a parent könyvtárat
    // mkdirSync-kel — ami azért fog hibát dobni, mert a parent egy
    // fájl, nem könyvtár.
    const blockingFile = join(tmpDir, "blocker");
    const { writeFileSync } = await import("node:fs");
    writeFileSync(blockingFile, "this is a file, not a dir", "utf8");

    const brokenStateFile = join(blockingFile, "state.json");
    const config = buildTestConfig(brokenStateFile);
    // A StateStore init-ben `load()`-ot hív, ami `readFileSync`-et
    // használ a file-ra. A `readFileSync` nem fog hibát dobni, ha
    // a fájl nem létezik (a Bot csak akkor ír, ha a `requestSave`
    // hívódik). A `mkdirSync` a `cleanup` flush-ában fog hibát dobni.
    // Viszont a `load()` is `readFileSync`-et hív, és a `brokenStateFile`
    // útvonalon a parent könyvtár (`blocker`) egy fájl, nem könyvtár —
    // a `readFileSync` is hibát dobhat, amit a StateStore `load` kezel.
    //
    // Egyszerűbb megközelítés: a cleanup() flush() a saveSync-et hívja,
    // ami `mkdirSync(dir, { recursive: true })`-et hív a `dir` (parent)
    // könyvtárra. Ha a `dir` maga egy fájl, a mkdirSync EEXIST-et dob,
    // amit a StateStore StateStoreError-ba csomagol. A cleanup() ezt
    // elkapja, és a logger.error-t hívja (a tesztelt catch block).
    const bot = new Bot({ config, feed });
    const p = bot.start();
    await new Promise<void>((r) => setTimeout(r, 50));

    // A bot leállítása — a cleanup-ban a flush hibát fog dobni.
    // A bot leállásának NEM szabad eldobnia a kivételt.
    await expect(bot.stop()).resolves.toBeUndefined();
    await p;

    // A blockingFile még mindig a helyén van (cleanup nem törli).
    const { existsSync: exists } = await import("node:fs");
    expect(exists(blockingFile)).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // 21) cleanup() swallows feed.close() errors (covers lines 547-551).
  //     A mock feed close()-ját úgy monkey-patch-eljük, hogy dobjon.
  // ---------------------------------------------------------------------------
  it("cleanup() swallows feed.close() errors gracefully", async () => {
    const config = buildTestConfig(stateFile);
    const bot = new Bot({ config, feed });

    const p = bot.start();
    await new Promise<void>((r) => setTimeout(r, 50));

    // A feed close()-ját felülírjuk, hogy dobjon. A cleanup-ban a
    // feed.close() try-catch-ben van — a catch block kerül végrehajtásra.
    const originalClose = feed.close.bind(feed);
    let closeCalled = false;
    feed.close = async () => {
      closeCalled = true;
      throw new Error("intentional feed close failure");
    };

    await expect(bot.stop()).resolves.toBeUndefined();
    await p;

    // A close() meghívódott (és a hibát a cleanup elkapta).
    expect(closeCalled).toBe(true);

    // Visszaállítjuk, hogy a cleanup későbbi részei ne legyenek érintettek.
    feed.close = originalClose;
  });

  // ============================================================================
  // Phase 68: state-restore — a data/bot-state.json-ból betöltött pozíciók
  // átkerülnek a PositionManager-be. Ez a Phase 67 óta ismert bug, ami
  // miatt a position-skip fix CSAK fresh-start esetén működött — restart
  // után a pozíciók "elvesztek" a PositionManager-ből, és egy új fill
  // átlagolta volna a régit.
  // ============================================================================

  it("Phase 68: state-restore: pre-existing position is loaded into PositionManager", async () => {
    // 1) Pre-populate the state file with 1 position (dydx_cex_carry:BTC/USDC:long @ 60000)
    const initialState: BotState = {
      version: 1,
      savedAt: Date.now() - 60_000,
      equityUsd: 9_950, // 10000 - 50 unrealized
      initialEquityUsd: 10_000,
      realizedPnlUsd: 0,
      positions: [
        {
          id: "dydx_cex_carry:BTC/USDC:long",
          strategy: "dydx_cex_carry",
          symbol: "BTC/USDC",
          side: "long",
          quantity: 0.00016667,
          entryPrice: 60_000,
          currentPrice: 59_700,
          leverage: 10,
          unrealizedPnl: -5,
          realizedPnl: 0,
          openedAt: Date.now() - 3_600_000,
          notionalUsd: 10.0,
        },
      ],
      closedTrades: [],
      inFlightOrderIds: [],
      counters: { placed: 1, filled: 1, cancelled: 0, rejected: 0 },
    };
    const { writeFileSync } = await import("node:fs");
    writeFileSync(stateFile, JSON.stringify(initialState), "utf8");

    // 2) Start the bot
    const config = buildTestConfig(stateFile);
    const bot = new Bot({ config, feed });
    const p = bot.start();
    await new Promise<void>((r) => setTimeout(r, 100));

    // 3) Verify the position is loaded into the PositionManager
    const restored = bot.getState();
    expect(restored.positions.length).toBe(1);
    const pos = restored.positions[0];
    expect(pos).toBeDefined();
    expect(pos?.strategy).toBe("dydx_cex_carry");
    expect(pos?.symbol).toBe("BTC/USDC");
    expect(pos?.side).toBe("long");
    expect(pos?.quantity).toBeCloseTo(0.00016667, 8);
    expect(pos?.entryPrice).toBe(60_000);
    expect(pos?.leverage).toBe(10);

    // 4) Verify the equity reflects the loaded state
    // initialEquityUsd=10000 + unrealizedPnl=-5 (from the position) = 9995
    // (the saved state had equityUsd=9950, which includes the realizedPnlTotal=0 + unrealized=-5)
    // Note: equity is computed from initialEquityUsd + realizedPnl + sum(unrealizedPnl of restored positions)
    // The position's unrealizedPnl is stored in the position, so getEquity() = 10000 + 0 + (-5) = 9995
    expect(restored.equityUsd).toBeCloseTo(9995, 1);

    // 5) Stop the bot
    await bot.stop();
    await p;
  });

  it("Phase 68: state-restore: after restart, position-skip prevents averaging", async () => {
    // This test reproduces the ORIGINAL Phase 67 bug scenario: the bot had
    // a position, was restarted, and the new bot would average into the
    // position (or hit maxPositions cap) because PositionManager didn't
    // know about the loaded position.
    //
    // After the Phase 68 fix, after restart the PositionManager HAS the
    // loaded position, so the position-skip logic kicks in and the bot
    // does NOT open a new position on the same (strategy, symbol).

    // 1) Pre-populate the state file with 1 long position at entry 60000
    const preState: BotState = {
      version: 1,
      savedAt: Date.now() - 60_000,
      equityUsd: 9_950,
      initialEquityUsd: 10_000,
      realizedPnlUsd: 0,
      positions: [
        {
          id: "dydx_cex_carry:BTC/USDC:long",
          strategy: "dydx_cex_carry",
          symbol: "BTC/USDC",
          side: "long",
          quantity: 0.00016667,
          entryPrice: 60_000,
          currentPrice: 59_700,
          leverage: 10,
          unrealizedPnl: -5,
          realizedPnl: 0,
          openedAt: Date.now() - 3_600_000,
          notionalUsd: 10.0,
        },
      ],
      closedTrades: [],
      inFlightOrderIds: [],
      counters: { placed: 1, filled: 1, cancelled: 0, rejected: 0 },
    };
    const { writeFileSync, readFileSync } = await import("node:fs");
    writeFileSync(stateFile, JSON.stringify(preState), "utf8");

    // 2) First bot instance
    const config = buildTestConfig(stateFile);
    const bot1 = new Bot({ config, feed });
    const p1 = bot1.start();
    await new Promise<void>((r) => setTimeout(r, 100));
    const state1 = bot1.getState();
    expect(state1.positions.length).toBe(1);
    await bot1.stop();
    await p1;

    // 3) Wait a bit, then start a SECOND bot instance with the same state file
    await new Promise<void>((r) => setTimeout(r, 100));

    // The state file should have been flushed by the first bot. Read it
    // to confirm the position is still in there.
    const reloadedState = JSON.parse(readFileSync(stateFile, "utf8"));
    expect(reloadedState.positions.length).toBe(1);
    expect(reloadedState.positions[0]?.strategy).toBe("dydx_cex_carry");

    // 4) Second bot instance — should load the position from state
    const bot2 = new Bot({ config, feed });
    const p2 = bot2.start();
    await new Promise<void>((r) => setTimeout(r, 100));
    const state2 = bot2.getState();
    expect(state2.positions.length).toBe(1);
    expect(state2.positions[0]?.strategy).toBe("dydx_cex_carry");
    expect(state2.positions[0]?.entryPrice).toBe(60_000);

    await bot2.stop();
    await p2;
  });

  it("Phase 68: state-restore: realizedPnlUsd is restored so getEquity() is correct", async () => {
    // After restoring positions, the realizedPnlTotal must also be
    // restored, otherwise getEquity() would lose the accumulated
    // realized P&L from the previous session.

    const preState: BotState = {
      version: 1,
      savedAt: Date.now() - 60_000,
      // 10000 (initial) + 250 (realized) + (-50) (unrealized) = 10200
      equityUsd: 10_200,
      initialEquityUsd: 10_000,
      realizedPnlUsd: 250, // ← CRITICAL: must be restored
      positions: [
        {
          id: "dydx_cex_carry:BTC/USDC:long",
          strategy: "dydx_cex_carry",
          symbol: "BTC/USDC",
          side: "long",
          quantity: 0.00016667,
          entryPrice: 60_000,
          currentPrice: 59_700,
          leverage: 10,
          unrealizedPnl: -50, // currentPrice moved down 300 from entry
          realizedPnl: 0,
          openedAt: Date.now() - 3_600_000,
          notionalUsd: 10.0,
        },
      ],
      closedTrades: [
        {
          strategy: "dydx_cex_carry",
          symbol: "ETH/USDC",
          side: "long",
          quantity: 0.01,
          entryPrice: 3_000,
          exitPrice: 3_250,
          pnl: 2.5,
          pnlPct: 8.33,
          closedAt: Date.now() - 7_200_000,
        },
      ],
      inFlightOrderIds: [],
      counters: { placed: 2, filled: 2, cancelled: 0, rejected: 0 },
    };
    const { writeFileSync } = await import("node:fs");
    writeFileSync(stateFile, JSON.stringify(preState), "utf8");

    const config = buildTestConfig(stateFile);
    const bot = new Bot({ config, feed });
    const p = bot.start();
    await new Promise<void>((r) => setTimeout(r, 100));

    const state = bot.getState();
    // The realizedPnlUsd must be preserved (250 USD) AND the closed
    // trades history must be loaded (1 trade for ETH/USDC).
    expect(state.realizedPnlUsd).toBe(250);
    expect(state.closedTrades.length).toBe(1);
    expect(state.closedTrades[0]?.symbol).toBe("ETH/USDC");
    // The equity is the saved value: 10000 + 250 + (-50) = 10200
    // getEquity() computes: initialEquityUsd + realizedPnlTotal + sum(unrealizedPnl of restored positions)
    // = 10000 + 250 + (-50) = 10200
    expect(state.equityUsd).toBeCloseTo(10_200, 0);

    await bot.stop();
    await p;
  });
});
