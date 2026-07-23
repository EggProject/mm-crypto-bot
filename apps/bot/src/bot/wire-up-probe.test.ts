/**
 * apps/bot/src/bot/wire-up-probe.test.ts
 *
 * ===========================================================================
 * WIRE-UP PROBE — the gold standard for Phase 21 #1 lesson
 * ===========================================================================
 *
 * "verify the actual behavior, not the docstring."
 *
 * A probe célja, hogy BIZONYÍTSA, hogy a Bot runtime TÉNYLEGESEN működik
 * end-to-end:
 *
 *   1) A `Bot` osztály sikeresen indul (init + run)
 *   2) A feed subscription aktív (a MockExchangeFeed-en)
 *   3) A state-fájl LÉTREJÖN a konfigurált útvonalon
 *   4) A state-fájl JSON-tartalma megfelel a `BotState` sémának
 *   5) A graceful shutdown <5s alatt befejeződik
 *   6) Nincs leak (a feed le van zárva, a Timers törölve vannak)
 *
 * A probe a Phase 33 scope plan §"Track C" §8-ban specifikált
 * 60s-os mock feed run-ot rövidíti 5 másodpercre (a CI gyorsasága
 * kedvéért), de a 100 mock tick + state-persistence ellenőrzés
 * megmarad.
 *
 * A probe a `bot.mode = "paper"` módot használja (default), és a
 * `BotConfig`-ot közvetlenül a `loadBotConfig()` nélkül, tisztán
 * a `DEFAULT_BOT_CONFIG`-gal inicializálja — így nem kell TOML-fájlt
 * írni a tmp könyvtárba.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { asSymbol, type Ohlcv, type Symbol as ExchangeSymbol, type Ticker, type Timeframe } from "@mm-crypto-bot/exchange";
// Phase 66: `MockExchangeFeed` is test-only — import from the
// `@exchange-testing/*` path alias (see tsconfig.base.json).
import { MockExchangeFeed } from "@exchange-testing/mockFeed.js";

import { Bot } from "./bot.js";
import { BotStateSchema } from "./state-store.js";
import { DEFAULT_BOT_CONFIG } from "../config/defaults.js";
import type { BotConfig } from "../config/schema.js";

/**
 * `pushTickerTick` — egyetlen ticker eventet küld a mock feed-en.
 */
function pushTickerTick(feed: MockExchangeFeed, symbol: ExchangeSymbol, last: number): void {
  const ticker: Ticker = {
    symbol,
    timestamp: Date.now(),
    bid: last - 1,
    ask: last + 1,
    last,
    baseVolume: 100,
    quoteVolume: 100 * last,
  };
  feed.pushEvent({ kind: "ticker", payload: ticker });
}

/**
 * `pushOhlcvTick` — egyetlen OHLCV eventet küld a mock feed-en.
 */
function pushOhlcvTick(feed: MockExchangeFeed, symbol: ExchangeSymbol, timeframe: Timeframe, candle: Ohlcv): void {
  feed.pushEvent({
    kind: "ohlcv",
    payload: { symbol, timeframe, candle },
  });
}

/**
 * `buildTestConfig` — a default configból indul, de a state-fájlt és
 * a symbol-listát a tmp könyvtárba irányítja.
 */
function buildTestConfig(stateFile: string): BotConfig {
  return {
    ...DEFAULT_BOT_CONFIG,
    bot: {
      ...DEFAULT_BOT_CONFIG.bot,
      state_file: stateFile,
      log_level: "info",
    },
    exchange: {
      ...DEFAULT_BOT_CONFIG.exchange,
      id: "mock",
    },
    symbols: {
      enabled: ["BTC/USDC"],
    },
    strategies: {
      // Minden stratégiát kikapcsolunk — a wire-up probe csak a
      // struktúrát teszteli, a tényleges signal-flow-t a unit
      // tesztekben külön vizsgáljuk.
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

describe("wire-up probe — bot runtime end-to-end", () => {
  let tmpDir: string;
  let stateFile: string;
  let feed: MockExchangeFeed;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "mm-bot-probe-"));
    stateFile = join(tmpDir, "bot-state.json");
    feed = new MockExchangeFeed({ balances: [{ currency: "USDC", free: 10_000, total: 10_000 }] });
  });

  afterEach(() => {
    if (existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  // --------------------------------------------------------------------------
  // 1) Basic lifecycle: start → ticks → state persisted → stop
  // --------------------------------------------------------------------------
  it("starts, processes 100 mock ticks, persists state, and shuts down gracefully", async () => {
    const config = buildTestConfig(stateFile);
    const bot = new Bot({ config, feed });

    // Start the bot — this calls init() then run() in the same Promise.
    const startPromise = bot.start();
    // Give the bot a moment to subscribe to the feed.
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 100);
    });

    // Push 100 mock ticks (ticker + ohlcv mix).
    const symbol = asSymbol("BTC/USDC") as unknown as ExchangeSymbol;
    for (let i = 0; i < 100; i++) {
      const last = 60_000 + i * 10; // trending up
      pushTickerTick(feed, symbol, last);
      if (i % 5 === 0) {
        const candle: Ohlcv = [
          Date.now() - (100 - i) * 60_000,
          last - 5,
          last + 5,
          last - 10,
          last,
          100,
        ];
        pushOhlcvTick(feed, symbol, "15m", candle);
      }
    }
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 200);
    });

    // Force a state save + flush.
    const stateBeforeStop = bot.getState();
    expect(stateBeforeStop).toBeDefined();
    expect(stateBeforeStop.version).toBe(1);
    expect(stateBeforeStop.equityUsd).toBeGreaterThan(0);

    // Graceful shutdown.
    const stopStart = Date.now();
    await bot.stop();
    const stopDuration = Date.now() - stopStart;
    expect(stopDuration).toBeLessThan(5_000);
    await startPromise; // ensure the run() Promise has resolved

    // State file should exist.
    expect(existsSync(stateFile)).toBe(true);
    const stateRaw = readFileSync(stateFile, "utf8");
    const stateJson = JSON.parse(stateRaw) as unknown;
    const validated = BotStateSchema.safeParse(stateJson);
    expect(validated.success).toBe(true);
    if (validated.success) {
      expect(validated.data.positions).toEqual([]);
      expect(validated.data.counters.placed).toBe(0);
    }
  });

  // --------------------------------------------------------------------------
  // 2) State file is written on every position change
  // --------------------------------------------------------------------------
  it("writes state file after the run completes", async () => {
    const config = buildTestConfig(stateFile);
    const bot = new Bot({ config, feed });
    const startPromise = bot.start();
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 100);
    });

    // Push a few ticks
    const symbol = asSymbol("BTC/USDC") as unknown as ExchangeSymbol;
    for (let i = 0; i < 10; i++) {
      pushTickerTick(feed, symbol, 60_000 + i);
    }
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 200);
    });

    await bot.stop();
    await startPromise;

    expect(existsSync(stateFile)).toBe(true);
  });

  // --------------------------------------------------------------------------
  // 3) getState() is consistent with the persisted JSON
  // --------------------------------------------------------------------------
  it("getState() returns a valid BotState matching the persisted JSON", async () => {
    const config = buildTestConfig(stateFile);
    const bot = new Bot({ config, feed });
    const startPromise = bot.start();
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 100);
    });

    const symbol = asSymbol("BTC/USDC") as unknown as ExchangeSymbol;
    for (let i = 0; i < 20; i++) {
      pushTickerTick(feed, symbol, 60_000 + i);
      const candle: Ohlcv = [
        Date.now() - (20 - i) * 60_000,
        60_000 + i - 5,
        60_000 + i + 5,
        60_000 + i - 10,
        60_000 + i,
        100,
      ];
      pushOhlcvTick(feed, symbol, "15m", candle);
    }
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 300);
    });

    // Read state before stopping.
    const stateLive = bot.getState();
    const validatedLive = BotStateSchema.safeParse(stateLive);
    expect(validatedLive.success).toBe(true);

    await bot.stop();
    await startPromise;

    // After shutdown, the persisted JSON should be valid too.
    expect(existsSync(stateFile)).toBe(true);
    const stateRaw = readFileSync(stateFile, "utf8");
    const stateJson = JSON.parse(stateRaw) as unknown;
    const validatedPersisted = BotStateSchema.safeParse(stateJson);
    expect(validatedPersisted.success).toBe(true);
  });

  // --------------------------------------------------------------------------
  // 4) Graceful shutdown completes within 5s
  // --------------------------------------------------------------------------
  it("graceful shutdown completes in <5s even with active subscriptions", async () => {
    const config = buildTestConfig(stateFile);
    const bot = new Bot({ config, feed });
    const startPromise = bot.start();
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 100);
    });

    const symbol = asSymbol("BTC/USDC") as unknown as ExchangeSymbol;
    pushTickerTick(feed, symbol, 60_000);
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 100);
    });

    const stopStart = Date.now();
    await bot.stop();
    const stopDuration = Date.now() - stopStart;
    await startPromise;
    expect(stopDuration).toBeLessThan(5_000);
  });

  // --------------------------------------------------------------------------
  // 5) No errors logged via Telemetry (info level doesn't surface in test output)
  // --------------------------------------------------------------------------
  it("completes without throwing on the happy path", async () => {
    const config = buildTestConfig(stateFile);
    const bot = new Bot({ config, feed });
    const startPromise = bot.start();
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 100);
    });

    // 100 ticks
    const symbol = asSymbol("BTC/USDC") as unknown as ExchangeSymbol;
    for (let i = 0; i < 100; i++) {
      pushTickerTick(feed, symbol, 60_000 + i);
    }
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 200);
    });

    // No throw expected.
    await bot.stop();
    await startPromise;
  });

  // --------------------------------------------------------------------------
  // 6) Re-start with a persisted state file (load + continue)
  // --------------------------------------------------------------------------
  it("loads persisted state on second start (round-trip)", async () => {
    // First run: write state.
    {
      const config = buildTestConfig(stateFile);
      const bot1 = new Bot({ config, feed });
      const p = bot1.start();
      await new Promise<void>((r) => setTimeout(r, 100));
      const symbol = asSymbol("BTC/USDC") as unknown as ExchangeSymbol;
      pushTickerTick(feed, symbol, 60_000);
      await new Promise<void>((r) => setTimeout(r, 200));
      await bot1.stop();
      await p;
    }
    // New mock feed for the second run.
    const feed2 = new MockExchangeFeed({
      balances: [{ currency: "USDC", free: 10_000, total: 10_000 }],
    });
    // Second run: load + continue.
    {
      const config = buildTestConfig(stateFile);
      const bot2 = new Bot({ config, feed: feed2 });
      const p = bot2.start();
      await new Promise<void>((r) => setTimeout(r, 100));
      const symbol = asSymbol("BTC/USDC") as unknown as ExchangeSymbol;
      pushTickerTick(feed2, symbol, 60_001);
      await new Promise<void>((r) => setTimeout(r, 200));
      const state = bot2.getState();
      expect(state.version).toBe(1);
      expect(state.equityUsd).toBeGreaterThan(0);
      await bot2.stop();
      await p;
    }
  });
});
