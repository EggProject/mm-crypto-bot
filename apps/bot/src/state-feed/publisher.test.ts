/**
 * apps/bot/src/state-feed/publisher.test.ts
 *
 * ============================================================================
 * PHASE 44 — TUI REMOVAL + STATE-FEED PUBLISHER TESTS
 * ============================================================================
 *
 * Ezek a tesztek a `LiveStatePublisher` osztályt fedik le (a volt
 * `LiveBotStateProvider` Phase 44-es átnevezés utáni verzióját).
 *
 * Két fő terület:
 *
 *   1) HELPER UNIT TESZTEK — a `mapSide` / `mapPosition` / `mapClosedTrade`
 *      függvények unit-teszt szintű fedezete. Ezek a publikus
 *      mapping helper-ek, amelyek a Bot engine state-et a state-feed
 *      snapshot formátumra konvertálják.
 *
 *   2) RUNNING-FLAG DECOUPLING TESZTEK (Phase 38 Fix #38 öröksége) —
 *      a `provider.start()` NEM állítja a `running` flag-et `true`-ra;
 *      csak a `markBotStarted()` / `markBotStopped()` hívásai számítanak.
 *      A `state.status.engineAvailable` / `state.status.connected` a
 *      publisher `active` flag-jét követi, nem a `botRunning`-ot.
 *
 *   3) EVENTEMITER-LIKE API TESZTEK (Phase 45 preview) — az új
 *      `addEventListener` / `emit` metódusok. A `snapshot`, `started`,
 *      `stopped`, `kill-switch`, `paused`, `engine-error` event-ek
 *      értesítik a listener-eket.
 *
 *   4) `setEngineError` TESZTEK (Phase 43 Track 2 öröksége) — a
 *      `setEngineError(message)` beállítja a `state.status.engineError`
 *      mezőt, és notify-olja a listener-eket.
 *
 * A TUI helper-ek (Ink `useSyncExternalStore` subscribe/unsubscribe) a
 * Phase 44-gyel kikerültek — a backward-compat `subscribe(listener)`
 * metódus még elérhető, de az új API az `addEventListener`.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { MockExchangeFeed } from "@mm-crypto-bot/exchange";

import { Bot } from "../bot/bot.js";
import { DEFAULT_BOT_CONFIG } from "../config/defaults.js";
import type { BotConfig } from "../config/schema.js";
import type { BotState, ClosedTradeSnapshot } from "../bot/state-store.js";

import {
  LiveStatePublisher,
  mapClosedTrade,
  mapPosition,
  mapSide,
  stateEqualsIgnoringTimestamp,
  type StateFeedKillSwitchState,
  type StateFeedSnapshot,
} from "./publisher.js";

// (A `pushTickerTick` helper a korábbi TUI wire-up-probe tesztből
// származott — a Phase 44-gyel a TUI tesztek törlődtek, így ez a
// helper feleslegessé vált. Ha a jövőben state-feed wire-up tesztek
// kellenek, újra bevezethetjük.)

/**
 * `buildTestConfig` — a default configból indul, de a state-fájlt
 * a tmp könyvtárba irányítja.
 */
function buildTestConfig(stateFile: string): BotConfig {
  return {
    ...DEFAULT_BOT_CONFIG,
    bot: {
      ...DEFAULT_BOT_CONFIG.bot,
      state_file: stateFile,
      log_level: "error",
    },
    exchange: {
      ...DEFAULT_BOT_CONFIG.exchange,
      id: "mock",
    },
    symbols: {
      enabled: ["BTC/USDC"],
    },
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

/** Egy minimal EnginePosition a típus-szintű teszteléshez. */
function makeEnginePosition(overrides: Partial<BotState["positions"][number]> = {}): BotState["positions"][number] {
  return {
    id: "test:long:BTC/USDC",
    strategy: "test",
    symbol: "BTC/USDC" as BotState["positions"][number]["symbol"],
    side: "long",
    entryPrice: 60_000,
    quantity: 0.01,
    leverage: 5,
    notionalUsd: 600,
    unrealizedPnl: 50,
    unrealizedPnlPct: 8.33,
    openedAt: 1000,
    closedAt: null,
    currentPrice: 61_000,
    pnlPct: 8.33,
    ...overrides,
  } as BotState["positions"][number];
}

/** Egy minimal `ClosedTradeSnapshot`. */
function makeClosedTrade(overrides: Partial<ClosedTradeSnapshot> = {}): ClosedTradeSnapshot {
  return {
    id: "test:trade-1",
    strategy: "test",
    symbol: "BTC/USDC" as ClosedTradeSnapshot["symbol"],
    side: "long",
    entryPrice: 60_000,
    exitPrice: 60_500,
    quantity: 0.01,
    pnl: 5,
    pnlPct: 0.83,
    openedAt: 1000,
    closedAt: 2000,
    reason: "exit",
    ...overrides,
  } as ClosedTradeSnapshot;
}

// ============================================================================
// mapSide
// ============================================================================

describe("mapSide", () => {
  it("long → buy", () => {
    expect(mapSide("long")).toBe("buy");
  });

  it("short → sell", () => {
    expect(mapSide("short")).toBe("sell");
  });
});

// ============================================================================
// mapPosition
// ============================================================================

describe("mapPosition", () => {
  it("uses notionalUsd when positive (normal case)", () => {
    const sf = mapPosition(makeEnginePosition({ notionalUsd: 600, unrealizedPnl: 50 }));
    expect(sf.side).toBe("buy");
    expect(sf.id).toBe("test:long:BTC/USDC");
    expect(sf.symbol).toBe("BTC/USDC");
    expect(sf.entryPrice).toBe(60_000);
    expect(sf.currentPrice).toBe(61_000);
    expect(sf.quantity).toBe(0.01);
    expect(sf.leverage).toBe(5);
    expect(sf.unrealizedPnl).toBe(50);
    expect(sf.unrealizedPnlPct).toBeCloseTo(8.333, 2);
    expect(sf.openedAt).toBe(1000);
    expect(sf.stopLoss).toBeNull();
    expect(sf.takeProfit).toBeNull();
  });

  it("falls back to entryPrice*quantity when notionalUsd is 0", () => {
    const sf = mapPosition(makeEnginePosition({ notionalUsd: 0, unrealizedPnl: 30 }));
    expect(sf.unrealizedPnlPct).toBeCloseTo(5.0, 2);
  });

  it("returns 0% PnL when notional is 0 (zero-quantity edge case)", () => {
    const sf = mapPosition(
      makeEnginePosition({ notionalUsd: 0, entryPrice: 0, quantity: 0, unrealizedPnl: 100 }),
    );
    expect(sf.unrealizedPnlPct).toBe(0);
  });

  it("maps side correctly for both directions", () => {
    const longPos = mapPosition(makeEnginePosition({ side: "long" }));
    const shortPos = mapPosition(makeEnginePosition({ side: "short" }));
    expect(longPos.side).toBe("buy");
    expect(shortPos.side).toBe("sell");
  });
});

// ============================================================================
// mapClosedTrade
// ============================================================================

describe("mapClosedTrade", () => {
  it("builds a state-feed Trade from a ClosedTradeSnapshot", () => {
    const sf = mapClosedTrade(makeClosedTrade(), 0);
    expect(sf.id).toBe("test-BTC/USDC-long-2000-0");
    expect(sf.symbol).toBe("BTC/USDC");
    expect(sf.side).toBe("buy");
    expect(sf.entryPrice).toBe(60_000);
    expect(sf.exitPrice).toBe(60_500);
    expect(sf.quantity).toBe(0.01);
    expect(sf.leverage).toBe(1);
    expect(sf.pnlUsdt).toBe(5);
    expect(sf.pnlPct).toBe(0.83);
    expect(sf.openedAt).toBe(2000 - 60 * 60 * 1000);
    expect(sf.closedAt).toBe(2000);
    expect(sf.reason).toBe("test");
  });

  it("index is included in the id (disambiguates same-timestamp trades)", () => {
    const a = mapClosedTrade(makeClosedTrade({ id: "trade-x" }), 7);
    const b = mapClosedTrade(makeClosedTrade({ id: "trade-x" }), 8);
    expect(a.id).not.toBe(b.id);
    expect(a.id).toContain("-7");
    expect(b.id).toContain("-8");
  });

  it("maps short side to sell", () => {
    const sf = mapClosedTrade(makeClosedTrade({ side: "short" }), 0);
    expect(sf.side).toBe("sell");
  });
});

// ============================================================================
// stateEqualsIgnoringTimestamp
// ============================================================================

describe("stateEqualsIgnoringTimestamp", () => {
  it("returns true for identical snapshots (lastUpdate difference is ignored)", () => {
    const a: StateFeedSnapshot = {
      ...makeBaseSnapshot(),
      status: { mode: "with-bot", engineAvailable: true, engineError: null, connected: true, lastUpdate: 1000 },
    };
    const b: StateFeedSnapshot = {
      ...a,
      status: { ...a.status, lastUpdate: 2000 },
    };
    expect(stateEqualsIgnoringTimestamp(a, b)).toBe(true);
  });

  it("returns false when status.engineAvailable changes", () => {
    const a = makeBaseSnapshot();
    const b: StateFeedSnapshot = {
      ...a,
      status: { ...a.status, engineAvailable: !a.status.engineAvailable },
    };
    expect(stateEqualsIgnoringTimestamp(a, b)).toBe(false);
  });

  it("returns false when running flag changes", () => {
    const a = makeBaseSnapshot();
    const b: StateFeedSnapshot = { ...a, running: !a.running };
    expect(stateEqualsIgnoringTimestamp(a, b)).toBe(false);
  });

  it("returns false when positions array length changes", () => {
    const a = makeBaseSnapshot();
    const b: StateFeedSnapshot = {
      ...a,
      positions: [mapPosition(makeEnginePosition())],
    };
    expect(stateEqualsIgnoringTimestamp(a, b)).toBe(false);
  });
});

/** Helper: a tesztekhez használt base snapshot. */
function makeBaseSnapshot(): StateFeedSnapshot {
  return {
    status: {
      mode: "with-bot",
      engineAvailable: false,
      engineError: null,
      connected: false,
      lastUpdate: 0,
    },
    running: false,
    killSwitch: "armed",
    positions: [],
    statistics: {
      totalPnlUsdt: 0,
      totalPnlPct: 0,
      winRate: 0,
      totalTrades: 0,
      winningTrades: 0,
      losingTrades: 0,
      maxDrawdownPct: 0,
      currentDrawdownPct: 0,
      avgWinPnl: 0,
      avgLossPnl: 0,
      bestTradePnl: 0,
      worstTradePnl: 0,
      profitFactor: 0,
      sharpeRatio: 0,
      equityUsdt: 10_000,
      initialEquityUsdt: 10_000,
    },
    history: [],
    tickers: [],
    tickerEvents: [],
    paused: false,
    killSwitchThresholdPct: -10,
  };
}

// ============================================================================
// LiveStatePublisher — running-flag decoupling (Phase 38 Fix #38 öröksége)
// ============================================================================

describe("LiveStateProvider — running-flag decoupling", () => {
  let tmpDir: string;
  let stateFile: string;
  let feed: MockExchangeFeed;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "mm-bot-publisher-running-flag-"));
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

  it("BUG REPRO: provider.start() without markBotStarted() must report state.running === false", async () => {
    const config = buildTestConfig(stateFile);
    const bot = new Bot({ config, feed, stateSaveIntervalMs: 100 });
    const provider = new LiveStatePublisher({
      bot,
      enabledSymbols: ["BTC/USDC"],
      initialEquityUsdt: 10_000,
    });

    await provider.start();

    const snap = provider.getSnapshot();
    expect(snap.running).toBe(false);
    expect(snap.status.engineAvailable).toBe(true);
    expect(snap.status.connected).toBe(true);

    await provider.dispose();
  });

  it("INTEGRATION: markBotStarted/Stopped controls state.running", async () => {
    const config = buildTestConfig(stateFile);
    const bot = new Bot({ config, feed, stateSaveIntervalMs: 100 });
    const provider = new LiveStatePublisher({
      bot,
      enabledSymbols: ["BTC/USDC"],
      initialEquityUsdt: 10_000,
    });

    await provider.start();
    expect(provider.getSnapshot().running).toBe(false);

    const startPromise = bot.start();
    await new Promise<void>((r) => {
      setTimeout(r, 50);
    });
    provider.markBotStarted();
    expect(provider.getSnapshot().running).toBe(true);
    expect(provider.getSnapshot().status.engineAvailable).toBe(true);
    expect(provider.getSnapshot().status.connected).toBe(true);

    provider.markBotStopped();
    expect(provider.getSnapshot().running).toBe(false);

    await bot.stop();
    await startPromise;
    await provider.dispose();
  });

  it("markBotStarted() is idempotent — calling it twice keeps state.running=true", async () => {
    const config = buildTestConfig(stateFile);
    const bot = new Bot({ config, feed, stateSaveIntervalMs: 100 });
    const provider = new LiveStatePublisher({
      bot,
      enabledSymbols: ["BTC/USDC"],
      initialEquityUsdt: 10_000,
    });

    await provider.start();
    provider.markBotStarted();
    expect(provider.getSnapshot().running).toBe(true);
    provider.markBotStarted();
    expect(provider.getSnapshot().running).toBe(true);
    provider.markBotStopped();
    expect(provider.getSnapshot().running).toBe(false);
    provider.markBotStopped();
    expect(provider.getSnapshot().running).toBe(false);

    await provider.dispose();
  });

  it("markBotStarted/Stopped notify TUI listeners", async () => {
    const config = buildTestConfig(stateFile);
    const bot = new Bot({ config, feed, stateSaveIntervalMs: 100 });
    const provider = new LiveStatePublisher({
      bot,
      enabledSymbols: ["BTC/USDC"],
      initialEquityUsdt: 10_000,
    });

    await provider.start();

    let notifyCount = 0;
    const seenRunning: boolean[] = [];
    const unsubscribe = provider.subscribe(() => {
      notifyCount++;
      seenRunning.push(provider.getSnapshot().running);
    });

    provider.markBotStarted();
    provider.markBotStopped();
    await new Promise<void>((r) => {
      setTimeout(r, 10);
    });

    expect(notifyCount).toBeGreaterThanOrEqual(2);
    expect(seenRunning[seenRunning.length - 1]).toBe(false);

    unsubscribe();
    await provider.dispose();
  });
});

// ============================================================================
// LiveStateProvider — setEngineError (Phase 43 Track 2 öröksége)
// ============================================================================

describe("LiveStateProvider — setEngineError", () => {
  function createTestProvider(): LiveStatePublisher {
    // A teszt-szintű publisher-nek nincs valódi bot, csak a
    // state-mapping logikát teszteli.
    const bot = {
      subscribe: () => () => undefined,
      getState: () => null,
      stop: async () => undefined,
    } as unknown as Bot;
    return new LiveStatePublisher({ bot });
  }

  it("setEngineError(message) sets state.status.engineError and notifies listeners", () => {
    const provider = createTestProvider();
    let notifyCount = 0;
    provider.subscribe(() => {
      notifyCount += 1;
    });

    expect(provider.getSnapshot().status.engineError).toBeNull();

    provider.setEngineError("DydxFundingSource missing");
    expect(provider.getSnapshot().status.engineError).toBe("DydxFundingSource missing");
    expect(notifyCount).toBe(1);
  });

  it("setEngineError(null) clears the error (recovery flow)", () => {
    const provider = createTestProvider();
    provider.setEngineError("initial error");
    expect(provider.getSnapshot().status.engineError).toBe("initial error");

    provider.setEngineError(null);
    expect(provider.getSnapshot().status.engineError).toBeNull();
  });

  it("setEngineError is idempotent — same message does NOT re-notify", () => {
    const provider = createTestProvider();
    let notifyCount = 0;
    provider.subscribe(() => {
      notifyCount += 1;
    });

    provider.setEngineError("err");
    provider.setEngineError("err");
    provider.setEngineError("err");
    expect(notifyCount).toBe(1);
  });

  it("setEngineError with a DIFFERENT message DOES re-notify", () => {
    const provider = createTestProvider();
    let notifyCount = 0;
    provider.subscribe(() => {
      notifyCount += 1;
    });

    provider.setEngineError("err1");
    provider.setEngineError("err2");
    expect(notifyCount).toBe(2);
    expect(provider.getSnapshot().status.engineError).toBe("err2");
  });
});

// ============================================================================
// LiveStateProvider — EventEmitter-like API (Phase 45 preview)
// ============================================================================

describe("LiveStateProvider — EventEmitter-like API (Phase 45 preview)", () => {
  function createTestProvider(): LiveStatePublisher {
    const bot = {
      subscribe: () => () => undefined,
      getState: () => null,
      stop: async () => undefined,
    } as unknown as Bot;
    return new LiveStatePublisher({ bot });
  }

  it("addEventListener registers a callback that receives the emitted event", () => {
    const provider = createTestProvider();
    const events: string[] = [];
    const unsub = provider.addEventListener((e) => {
      events.push(e.type);
    });

    provider.emit({ type: "started" });
    provider.emit({ type: "stopped" });

    expect(events).toEqual(["started", "stopped"]);

    unsub();
  });

  it("the returned unsubscribe function removes the listener (idempotent)", () => {
    const provider = createTestProvider();
    let count = 0;
    const unsub = provider.addEventListener(() => {
      count++;
    });

    provider.emit({ type: "started" });
    expect(count).toBe(1);

    unsub();
    provider.emit({ type: "started" });
    expect(count).toBe(1);

    // A második unsubscribe hívás is no-op (idempotens).
    unsub();
    provider.emit({ type: "started" });
    expect(count).toBe(1);
  });

  it("a throwing listener does not stop other listeners from receiving events", () => {
    const provider = createTestProvider();
    let goodCount = 0;
    provider.addEventListener(() => {
      throw new Error("intentional listener failure");
    });
    provider.addEventListener(() => {
      goodCount++;
    });

    provider.emit({ type: "started" });
    provider.emit({ type: "stopped" });

    expect(goodCount).toBe(2);
  });

  it("markBotStarted emits a 'started' event, markBotStopped emits a 'stopped' event", () => {
    const provider = createTestProvider();
    const events: string[] = [];
    provider.addEventListener((e) => {
      events.push(e.type);
    });

    provider.markBotStarted();
    provider.markBotStopped();

    expect(events).toContain("started");
    expect(events).toContain("stopped");
  });

  it("setPaused emits a 'paused' event with the new paused value", () => {
    const provider = createTestProvider();
    let lastPaused: boolean | null = null;
    provider.addEventListener((e) => {
      if (e.type === "paused") lastPaused = e.paused;
    });

    provider.setPaused(true);
    expect(lastPaused).toBe(true);

    provider.setPaused(false);
    expect(lastPaused).toBe(false);
  });

  it("setEngineError emits an 'engine-error' event with the new message", () => {
    const provider = createTestProvider();
    const messages: (string | null)[] = [];
    provider.addEventListener((e) => {
      if (e.type === "engine-error") messages.push(e.message);
    });

    provider.setEngineError("first error");
    provider.setEngineError("second error");
    provider.setEngineError(null);

    expect(messages).toEqual(["first error", "second error", null]);
  });

  it("setKillSwitchState emits a 'kill-switch' event with the new state", () => {
    const provider = createTestProvider();
    const states: StateFeedKillSwitchState[] = [];
    provider.addEventListener((e) => {
      if (e.type === "kill-switch") states.push(e.state);
    });

    provider.setKillSwitchState("confirm");
    provider.setKillSwitchState("triggered");
    provider.setKillSwitchState("armed");

    expect(states).toEqual(["confirm", "triggered", "armed"]);
  });

  it("dispose() removes all event listeners", () => {
    const provider = createTestProvider();
    let count = 0;
    provider.addEventListener(() => {
      count++;
    });

    void provider.dispose();
    provider.emit({ type: "started" });

    expect(count).toBe(0);
  });
});

// ============================================================================
// LiveStateProvider — stop() + killSwitch() + getLastEngineState()
// ============================================================================

describe("LiveStateProvider — stop, killSwitch, getLastEngineState", () => {
  function createStopProvider(): {
    provider: LiveStatePublisher;
    stopCalls: number;
    subscribed: boolean;
  } {
    const stopCalls = { count: 0 };
    const subState = { active: false };
    const bot = {
      subscribe: (_listener: unknown) => {
        subState.active = true;
        return () => {
          subState.active = false;
        };
      },
      getState: () => null,
      stop: async () => {
        stopCalls.count++;
      },
    } as unknown as Bot;
    const provider = new LiveStatePublisher({ bot });
    return {
      provider,
      get stopCalls() {
        return stopCalls.count;
      },
      get subscribed() {
        return subState.active;
      },
    };
  }

  it("stop() is a no-op when the provider is not active", async () => {
    const ctx = createStopProvider();
    // No start() — provider is not active.
    await ctx.provider.stop();
    expect(ctx.stopCalls).toBe(0);
  });

  it("stop() forwards to bot.stop(), sets botRunning=false, and unsubscribes", async () => {
    const ctx = createStopProvider();
    await ctx.provider.start();
    expect(ctx.subscribed).toBe(true);

    // Mark running so the stop() path is exercised.
    ctx.provider.markBotStarted();
    expect(ctx.provider.getSnapshot().running).toBe(true);

    await ctx.provider.stop();
    expect(ctx.stopCalls).toBe(1);
    expect(ctx.provider.getSnapshot().running).toBe(false);
    expect(ctx.subscribed).toBe(false);
  });

  it("stop() swallows bot.stop() errors gracefully", async () => {
    const bot = {
      subscribe: () => () => undefined,
      getState: () => null,
      stop: async () => {
        throw new Error("intentional bot.stop() failure");
      },
    } as unknown as Bot;
    const provider = new LiveStatePublisher({ bot });
    await provider.start();
    provider.markBotStarted();
    // A stop() hívás NEM szabad, hogy dobjon — a catch blokk elnyeli
    // a bot.stop() hibáját.
    await expect(provider.stop()).resolves.toBeUndefined();
    expect(provider.getSnapshot().running).toBe(false);
  });

  it("killSwitch() triggers the kill-switch state, stops the bot, and unsubscribes", async () => {
    const ctx = createStopProvider();
    await ctx.provider.start();
    expect(ctx.subscribed).toBe(true);

    await ctx.provider.killSwitch();

    expect(ctx.stopCalls).toBe(1);
    expect(ctx.provider.getSnapshot().killSwitch).toBe("triggered");
    expect(ctx.provider.getSnapshot().running).toBe(false);
    expect(ctx.subscribed).toBe(false);
  });

  it("killSwitch() swallows bot.stop() errors gracefully", async () => {
    const bot = {
      subscribe: () => () => undefined,
      getState: () => null,
      stop: async () => {
        throw new Error("intentional bot.stop() failure");
      },
    } as unknown as Bot;
    const provider = new LiveStatePublisher({ bot });
    await provider.start();
    // A killSwitch() NEM szabad, hogy dobjon — a catch blokk elnyeli
    // a bot.stop() hibáját.
    await expect(provider.killSwitch()).resolves.toBeUndefined();
    expect(provider.getSnapshot().killSwitch).toBe("triggered");
  });

  it("getLastEngineState() returns null when the bot has not yet published", () => {
    const ctx = createStopProvider();
    expect(ctx.provider.getLastEngineState()).toBeNull();
  });

  it("getLastEngineState() returns the bot's last state after a subscribe-notify", async () => {
    const engineState = {
      version: 1,
      savedAt: 1000,
      realizedPnlUsd: 0,
      unrealizedPnlUsd: 0,
      equityUsd: 10_000,
      initialEquityUsd: 10_000,
      positions: [],
      closedTrades: [],
    } as const;
    const captured: unknown[] = [];
    const bot = {
      subscribe: (listener: unknown) => {
        captured.push(listener);
        return () => undefined;
      },
      getState: () => null,
      stop: async () => undefined,
    } as unknown as Bot;
    const provider = new LiveStatePublisher({ bot });
    await provider.start();
    // A captured listener a `subscribeToBot` által regisztrált callback.
    const listener = captured[0] as (state: typeof engineState) => void;
    expect(listener).toBeDefined();
    listener(engineState);
    expect(provider.getLastEngineState()).toBe(engineState);
  });
});

// ============================================================================
// LiveStateProvider — Phase 45 event publication API
// ============================================================================

describe("LiveStateProvider — Phase 45 publish methods", () => {
  function createTestProvider(): LiveStatePublisher {
    const bot = {
      subscribe: () => () => undefined,
      getState: () => null,
      stop: async () => undefined,
    } as unknown as Bot;
    return new LiveStatePublisher({ bot });
  }

  it("publishTick emits a 'tick' event with symbol + price", () => {
    const provider = createTestProvider();
    let received: { symbol: string; price: number } | null = null;
    provider.addEventListener((e) => {
      if (e.type === "tick") received = { symbol: e.symbol, price: e.price };
    });
    provider.publishTick("BTC/USDC", 60_123.45);
    expect(received).not.toBeNull();
    expect(received!.symbol).toBe("BTC/USDC");
    expect(received!.price).toBe(60_123.45);
  });

  it("publishBar emits a 'bar' event with symbol + tf + ohlc", () => {
    const provider = createTestProvider();
    let received: unknown = null;
    provider.addEventListener((e) => {
      if (e.type === "bar") received = e;
    });
    const ohlc = { time: 1000, open: 60_100, high: 60_150, low: 60_080, close: 60_123.45, volume: 12.5 };
    provider.publishBar("BTC/USDC", "1h", ohlc);
    expect(received).not.toBeNull();
    const r = received as { symbol: string; timeframe: string; ohlc: typeof ohlc };
    expect(r.symbol).toBe("BTC/USDC");
    expect(r.timeframe).toBe("1h");
    expect(r.ohlc).toEqual(ohlc);
  });

  it("publishIndicator emits an 'indicator' event with all fields", () => {
    const provider = createTestProvider();
    let received: unknown = null;
    provider.addEventListener((e) => {
      if (e.type === "indicator") received = e;
    });
    const series = { upper: [60_200], lower: [59_800], middle: [60_000] };
    provider.publishIndicator("BTC/USDC", "donchian_pivot_composition", "1h", "donchian", series);
    expect(received).not.toBeNull();
    const r = received as {
      symbol: string;
      strategy: string;
      timeframe: string;
      indicator: string;
      series: typeof series;
    };
    expect(r.symbol).toBe("BTC/USDC");
    expect(r.strategy).toBe("donchian_pivot_composition");
    expect(r.timeframe).toBe("1h");
    expect(r.indicator).toBe("donchian");
    expect(r.series).toEqual(series);
  });

  it("publishMarker emits a 'marker' event with all fields", () => {
    const provider = createTestProvider();
    let received: unknown = null;
    provider.addEventListener((e) => {
      if (e.type === "marker") received = e;
    });
    provider.publishMarker("BTC/USDC", "donchian_pivot_composition", "1h", "long", 60_100, "ENTER_LONG");
    expect(received).not.toBeNull();
    const r = received as {
      symbol: string;
      strategy: string;
      timeframe: string;
      side: string;
      price: number;
      label: string;
    };
    expect(r.symbol).toBe("BTC/USDC");
    expect(r.strategy).toBe("donchian_pivot_composition");
    expect(r.timeframe).toBe("1h");
    expect(r.side).toBe("long");
    expect(r.price).toBe(60_100);
    expect(r.label).toBe("ENTER_LONG");
  });

  it("publishState emits a 'state' event with the current snapshot", () => {
    const provider = createTestProvider();
    let received: unknown = null;
    provider.addEventListener((e) => {
      if (e.type === "state") received = e;
    });
    provider.publishState();
    expect(received).not.toBeNull();
    const r = received as { snapshot: StateFeedSnapshot };
    expect(r.snapshot).toBe(provider.getSnapshot());
  });

  it("publishError emits an 'error' event with message + recoverable", () => {
    const provider = createTestProvider();
    let received: unknown = null;
    provider.addEventListener((e) => {
      if (e.type === "error") received = e;
    });
    provider.publishError("DydxFundingSource missing", true);
    expect(received).not.toBeNull();
    const r = received as { message: string; recoverable: boolean };
    expect(r.message).toBe("DydxFundingSource missing");
    expect(r.recoverable).toBe(true);
  });
});
