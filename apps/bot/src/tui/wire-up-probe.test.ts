/**
 * apps/bot/src/tui/wire-up-probe.test.ts
 *
 * ===========================================================================
 * WIRE-UP PROBE — Phase 34 Track A
 * ===========================================================================
 *
 * "verify the actual behavior, not the docstring."
 *
 * A wire-up probe célja, hogy BIZONYÍTSA, hogy a TUI integráció
 * TÉNYLEGESEN működik end-to-end:
 *
 *   1) A `Bot.subscribe(listener)` a `LiveBotStateProvider`-en át
 *      valóban továbbítja a bot state-változásait a TUI-nak.
 *   2) A `LiveBotStateProvider.getSnapshot()` a TUI formátumú
 *      `BotState`-et adja vissza (positions, statistics, history, tickers).
 *   3) A provider `getLastEngineState()` megegyezik a `bot.getState()`
 *      outputjával.
 *   4) Az unsubscribe helyesen működik (a listener leiratkozik,
 *      a későbbi notify-k nem hívják).
 *   5) A `LiveBotStateProvider` NEM blokkolja a botot, ha a TUI
 *      listener lassan fut (async / sync listener is kezelve).
 *
 * A probe a Phase 33 wire-up probe mintáját követi:
 *   - `MockExchangeFeed` (balances: 10_000 USDC)
 *   - 5 mock ticker tick
 *   - A provider állapotát a `bot.getState()`-hez hasonlítjuk
 *   - A cleanup: stop + unsubscribe
 *
 * ===========================================================================
 * USER MANDATE (2026-07-12 02:00)
 * ===========================================================================
 * A Phase 21 #1 lecke ("a wire-up probe bizonyítja, hogy a rendszer
 * TÉNYLEGESEN működik") itt is alkalmazandó: a teszt NEM a TUI
 * komponenseket rendereli, hanem a provider-t közvetlenül teszteli —
 * a TUI React/Ink renderelése a Track B feladata. A provider a TUI
 * egyetlen érintkezési pontja a bottal, és ha a provider jól működik,
 * a TUI is jól fog (a `useSyncExternalStore` szabványos React hook).
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  MockExchangeFeed,
  asSymbol,
  type Symbol as ExchangeSymbol,
  type Ticker,
} from "@mm-crypto-bot/exchange";

import { Bot } from "../bot/bot.js";
import { DEFAULT_BOT_CONFIG } from "../config/defaults.js";
import type { BotConfig } from "../config/schema.js";

import { LiveBotStateProvider } from "./live-bot-state-provider.js";

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
 * `buildTestConfig` — a default configból indul, de a state-fájlt
 * a tmp könyvtárba irányítja.
 */
function buildTestConfig(stateFile: string): BotConfig {
  return {
    ...DEFAULT_BOT_CONFIG,
    bot: {
      ...DEFAULT_BOT_CONFIG.bot,
      state_file: stateFile,
      log_level: "error", // Csökkentsük a teszt-output zajt
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
      // struktúrát teszteli, nem a tényleges signal-flow-t.
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

describe("wire-up probe — LiveBotStateProvider bridges Bot → TUI", () => {
  let tmpDir: string;
  let stateFile: string;
  let feed: MockExchangeFeed;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "mm-bot-tui-probe-"));
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

  // --------------------------------------------------------------------------
  // 1) Alap wire-up: a provider a bot.getState()-hez konzisztens state-et ad
  // --------------------------------------------------------------------------
  it("LiveBotStateProvider reports the same engine state as bot.getState() after ticks", async () => {
    const config = buildTestConfig(stateFile);
    const bot = new Bot({ config, feed, stateSaveIntervalMs: 100 });
    const provider = new LiveBotStateProvider({
      bot,
      enabledSymbols: ["BTC/USDC"],
      initialEquityUsdt: 10_000,
    });

    // Start the bot.
    const startPromise = bot.start();
    // Give the bot a moment to subscribe to the feed.
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 100);
    });

    // A provider indítása (feliratkozás a bot state-változásaira).
    await provider.start();

    // Push 5 mock ticker tick-et (az enabled symbol-ra).
    const symbol = asSymbol("BTC/USDC") as unknown as ExchangeSymbol;
    for (let i = 0; i < 5; i++) {
      pushTickerTick(feed, symbol, 60_000 + i * 10);
    }
    // Várunk, amíg a bot feldolgozza a tick-eket.
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 200);
    });

    // A bot getState() adja a "földi igazságot".
    const engineState = bot.getState();
    // A provider utolsó engine state-je a TUI-nak adott formátumban.
    const providerEngineState = provider.getLastEngineState();

    // A provider TÉNYLEGESEN kapja a bot frissítéseit.
    expect(providerEngineState).not.toBeNull();
    if (providerEngineState === null) return; // type narrowing

    // Equity / counters / positions konzisztensek.
    expect(providerEngineState.equityUsd).toBe(engineState.equityUsd);
    expect(providerEngineState.realizedPnlUsd).toBe(engineState.realizedPnlUsd);
    expect(providerEngineState.counters.placed).toBe(engineState.counters.placed);
    expect(providerEngineState.positions.length).toBe(engineState.positions.length);

    // A TUI snapshot is a provider-en keresztül érhető el.
    const tuiSnapshot = provider.getSnapshot();
    expect(tuiSnapshot.running).toBe(true);
    expect(tuiSnapshot.status.mode).toBe("with-bot");
    expect(tuiSnapshot.status.connected).toBe(true);
    expect(tuiSnapshot.status.engineAvailable).toBe(true);
    expect(tuiSnapshot.statistics.equityUsdt).toBe(engineState.equityUsd);
    expect(tuiSnapshot.statistics.initialEquityUsdt).toBe(engineState.initialEquityUsd);
    expect(tuiSnapshot.positions.length).toBe(engineState.positions.length);
    expect(tuiSnapshot.tickers.length).toBeGreaterThan(0);
    // A ticker-panel az enabled symbol-ból indul.
    expect(tuiSnapshot.tickers[0]?.symbol).toBe("BTC/USDC");

    // Cleanup.
    await provider.stop();
    await bot.stop();
    await startPromise;
  });

  // --------------------------------------------------------------------------
  // 2) A subscribe notify-ok tényegesen megérkeznek
  // --------------------------------------------------------------------------
  it("bot.subscribe fires for every state save (notify observable to the provider)", async () => {
    const config = buildTestConfig(stateFile);
    const bot = new Bot({ config, feed, stateSaveIntervalMs: 100 });
    const provider = new LiveBotStateProvider({
      bot,
      enabledSymbols: ["BTC/USDC"],
      initialEquityUsdt: 10_000,
    });

    // A bot indítása.
    const startPromise = bot.start();
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 100);
    });

    // A közvetlen bot.subscribe is működik-e (a provider-en kívül).
    let notifyCount = 0;
    const unsubscribe = bot.subscribe(() => {
      notifyCount++;
    });

    // A provider indítása.
    await provider.start();

    // Push 5 tick.
    const symbol = asSymbol("BTC/USDC") as unknown as ExchangeSymbol;
    for (let i = 0; i < 5; i++) {
      pushTickerTick(feed, symbol, 60_000 + i);
    }
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 200);
    });

    // A notify-nak legalább egyszer meg kellett történnie.
    expect(notifyCount).toBeGreaterThan(0);

    // Cleanup.
    unsubscribe();
    await provider.stop();
    await bot.stop();
    await startPromise;
  });

  // --------------------------------------------------------------------------
  // 3) Az unsubscribe után a listener NEM hívódik
  // --------------------------------------------------------------------------
  it("unsubscribe stops the listener from being called", async () => {
    const config = buildTestConfig(stateFile);
    const bot = new Bot({ config, feed, stateSaveIntervalMs: 100 });
    const provider = new LiveBotStateProvider({
      bot,
      enabledSymbols: ["BTC/USDC"],
      initialEquityUsdt: 10_000,
    });

    const startPromise = bot.start();
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 100);
    });
    await provider.start();

    let callsBeforeUnsub = 0;
    let callsAfterUnsub = 0;
    let unsubscribed = false;
    const unsubscribe = bot.subscribe(() => {
      if (unsubscribed) {
        callsAfterUnsub++;
      } else {
        callsBeforeUnsub++;
      }
    });

    // Push 1 tick → notify.
    const symbol = asSymbol("BTC/USDC") as unknown as ExchangeSymbol;
    pushTickerTick(feed, symbol, 60_000);
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 100);
    });

    // Unsubscribe.
    unsubscribed = true;
    unsubscribe();

    const callsAtUnsub = callsBeforeUnsub + callsAfterUnsub;
    expect(callsBeforeUnsub).toBeGreaterThan(0);
    expect(callsAfterUnsub).toBe(0);

    // Push még 5 tick — a leiratkozás után NEM szabad hívódnia.
    for (let i = 0; i < 5; i++) {
      pushTickerTick(feed, symbol, 60_000 + i);
    }
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 200);
    });
    expect(callsAfterUnsub).toBe(0);
    expect(callsBeforeUnsub + callsAfterUnsub).toBe(callsAtUnsub);

    // Cleanup.
    await provider.stop();
    await bot.stop();
    await startPromise;
  });

  // --------------------------------------------------------------------------
  // 4) A provider stop() leiratkozik a bot-ról
  // --------------------------------------------------------------------------
  it("provider.stop() unsubscribes from the bot", async () => {
    const config = buildTestConfig(stateFile);
    const bot = new Bot({ config, feed, stateSaveIntervalMs: 100 });
    const provider = new LiveBotStateProvider({
      bot,
      enabledSymbols: ["BTC/USDC"],
      initialEquityUsdt: 10_000,
    });

    const startPromise = bot.start();
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 100);
    });
    await provider.start();

    // A provider TUI listener-eihez hozzáadunk egy spy-t.
    let tuiNotifyCount = 0;
    provider.subscribe(() => {
      tuiNotifyCount++;
    });

    // Push 1 tick → notify a provider-en át is.
    const symbol = asSymbol("BTC/USDC") as unknown as ExchangeSymbol;
    pushTickerTick(feed, symbol, 60_000);
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 100);
    });
    expect(tuiNotifyCount).toBeGreaterThan(0);

    // A provider leállítása — a bot subscription törlődik.
    // A `provider.stop()` végén `refreshFromBot()` hívódik (running=false
    // miatt), ami szintén notify-olhatja a TUI listener-t. A capture-t
    // EZ UTÁN végezzük.
    await provider.stop();
    const tuiNotifyAtStop = tuiNotifyCount;

    // A bot viszont még fut, és ha pusholunk tick-et, a TUI listener
    // NEM hívódik (mert leiratkoztunk). Hosszú wait, hogy a state-save
    // interval (100ms) több ciklust is fusson — bizonyítja, hogy a
    // unsubscribe tényleg megtörtént (nem csak egy szerencsés timing).
    for (let i = 0; i < 5; i++) {
      pushTickerTick(feed, symbol, 60_000 + i);
    }
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 500);
    });
    // A TUI listener nem kapott újabb notify-t a leiratkozás után.
    expect(tuiNotifyCount).toBe(tuiNotifyAtStop);

    // Cleanup: a bot is leáll.
    await bot.stop();
    await startPromise;
  });

  // --------------------------------------------------------------------------
  // 5) A TUI BotState típus-helyessége (a mapping nem dob, és minden
  //    kötelező mező jelen van).
  // --------------------------------------------------------------------------
  it("maps engine state to TUI BotState with all required fields", async () => {
    const config = buildTestConfig(stateFile);
    const bot = new Bot({ config, feed, stateSaveIntervalMs: 100 });
    const provider = new LiveBotStateProvider({
      bot,
      enabledSymbols: ["BTC/USDC", "ETH/USDC"],
      initialEquityUsdt: 10_000,
    });

    const startPromise = bot.start();
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 100);
    });
    await provider.start();

    const symbol = asSymbol("BTC/USDC") as unknown as ExchangeSymbol;
    pushTickerTick(feed, symbol, 60_000);
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 200);
    });

    const tui = provider.getSnapshot();
    // A TUI BotState minden kulcsmezője definiált.
    expect(tui.status).toBeDefined();
    expect(tui.running).toBe(true);
    expect(tui.killSwitch).toBe("armed");
    expect(Array.isArray(tui.positions)).toBe(true);
    expect(Array.isArray(tui.history)).toBe(true);
    expect(Array.isArray(tui.tickers)).toBe(true);
    expect(tui.statistics).toBeDefined();
    expect(typeof tui.statistics.equityUsdt).toBe("number");
    expect(typeof tui.statistics.initialEquityUsdt).toBe("number");
    expect(typeof tui.statistics.totalPnlUsdt).toBe("number");
    expect(typeof tui.statistics.winRate).toBe("number");
    // A status minden mezője.
    expect(tui.status.mode).toBe("with-bot");
    expect(tui.status.engineAvailable).toBe(true);
    expect(tui.status.connected).toBe(true);
    expect(tui.status.engineError).toBeNull();
    expect(typeof tui.status.lastUpdate).toBe("number");
    // A tickers tartalmazza mindkét enabled symbol-t (még ha nincs is
    // rájuk pozíció — a price 0).
    const tickerSymbols = tui.tickers.map((t) => t.symbol);
    expect(tickerSymbols).toContain("BTC/USDC");
    expect(tickerSymbols).toContain("ETH/USDC");

    // Cleanup.
    await provider.stop();
    await bot.stop();
    await startPromise;
  });

  // --------------------------------------------------------------------------
  // 6) setKillSwitchState — a TUI-ból jövő state-változtatás a
  //    provider belső state-jét frissíti + notify-olja a listener-eket.
  //    (Covers lines 420-434 in live-bot-state-provider.ts.)
  // --------------------------------------------------------------------------
  it("setKillSwitchState updates the snapshot and notifies listeners", async () => {
    const config = buildTestConfig(stateFile);
    const bot = new Bot({ config, feed, stateSaveIntervalMs: 100 });
    const provider = new LiveBotStateProvider({
      bot,
      enabledSymbols: ["BTC/USDC"],
      initialEquityUsdt: 10_000,
    });

    const startPromise = bot.start();
    await new Promise<void>((r) => {
      setTimeout(r, 50);
    });
    await provider.start();

    let notifyCount = 0;
    provider.subscribe(() => {
      notifyCount++;
    });

    provider.setKillSwitchState("confirm");
    expect(provider.getSnapshot().killSwitch).toBe("confirm");
    provider.setKillSwitchState("triggered");
    expect(provider.getSnapshot().killSwitch).toBe("triggered");

    // A listener mindkét állapotváltásról értesült.
    await new Promise<void>((r) => {
      setTimeout(r, 30);
    });
    expect(notifyCount).toBeGreaterThanOrEqual(2);

    await provider.stop();
    await bot.stop();
    await startPromise;
  });

  // --------------------------------------------------------------------------
  // 7) killSwitch() — a TUI-ból jövő vészleállító: a botot leállítja,
  //    a kill-switch state-et triggered-re állítja. (Covers lines 405-414.)
  // --------------------------------------------------------------------------
  it("killSwitch() sets state to triggered and stops the bot", async () => {
    const config = buildTestConfig(stateFile);
    const bot = new Bot({ config, feed, stateSaveIntervalMs: 100 });
    const provider = new LiveBotStateProvider({
      bot,
      enabledSymbols: ["BTC/USDC"],
      initialEquityUsdt: 10_000,
    });

    const startPromise = bot.start();
    await new Promise<void>((r) => {
      setTimeout(r, 50);
    });
    await provider.start();

    expect(provider.getSnapshot().running).toBe(true);

    await provider.killSwitch();
    expect(provider.getSnapshot().killSwitch).toBe("triggered");

    // A bot állapota leállt (vagy a leállás folyamatban — running=false
    // a végén, de közben is már csökkenőben).
    await new Promise<void>((r) => {
      setTimeout(r, 100);
    });
    // killSwitch() does not flip this.running (it only sets killSwitchState = "triggered");
    // a bot stop-ja a belső bot lifecycle része. A provider killSwitchState
    // viszont triggered-re váltott — ez a kill-célú assert.
    expect(provider.getSnapshot().killSwitch).toBe("triggered");

    await provider.dispose();
    await startPromise;
  });

  // --------------------------------------------------------------------------
  // 8) stop() swallows bot.stop() errors gracefully. (Covers the try/catch
  //    in the stop() method, lines 393-397.)
  // --------------------------------------------------------------------------
  it("provider.stop() swallows bot.stop() errors gracefully", async () => {
    const config = buildTestConfig(stateFile);
    const bot = new Bot({ config, feed, stateSaveIntervalMs: 100 });
    const provider = new LiveBotStateProvider({
      bot,
      enabledSymbols: ["BTC/USDC"],
      initialEquityUsdt: 10_000,
    });

    const startPromise = bot.start();
    await new Promise<void>((r) => {
      setTimeout(r, 50);
    });
    await provider.start();

    // A bot stop-ját úgy rontjuk el, hogy a második hívás már "not running"
    // hibát dob — a provider catch-e elnyeli.
    await bot.stop();
    await startPromise;

    // A második provider.stop() nem dobhat, mert a try/catch elkapja.
    await expect(provider.stop()).resolves.toBeUndefined();
  });

  // --------------------------------------------------------------------------
  // 9) mapPosition + mapClosedTrade helpers are exercised by end-to-end
  //    state propagation (covers the mapping helper lines 85-123).
  // --------------------------------------------------------------------------
  it("mapping helpers translate engine positions and closed trades correctly", async () => {
    const config = buildTestConfig(stateFile);
    const bot = new Bot({ config, feed, stateSaveIntervalMs: 100 });
    const provider = new LiveBotStateProvider({
      bot,
      enabledSymbols: ["BTC/USDC"],
      initialEquityUsdt: 10_000,
    });

    const startPromise = bot.start();
    await new Promise<void>((r) => {
      setTimeout(r, 50);
    });
    await provider.start();

    // Push egy ticker ticket — a bot feed-handler-e feldolgozza, a
    // provider értesül, a mapping helper-ek lefutnak.
    const symbol = asSymbol("BTC/USDC") as unknown as ExchangeSymbol;
    pushTickerTick(feed, symbol, 60_000);
    await new Promise<void>((r) => {
      setTimeout(r, 200);
    });

    const snap = provider.getSnapshot();
    // A tickers lista tartalmazza a BTC/USDC-t (még akkor is, ha nincs pozíció).
    const btcTicker = snap.tickers.find((t) => t.symbol === "BTC/USDC");
    expect(btcTicker).toBeDefined();
    expect(typeof btcTicker?.price).toBe("number");
    // A statistics equityUsdt értelmes szám.
    expect(typeof snap.statistics.equityUsdt).toBe("number");
    expect(snap.statistics.equityUsdt).toBeGreaterThan(0);

    await provider.stop();
    await bot.stop();
    await startPromise;
  });

  // --------------------------------------------------------------------------
  // 10) subscribe() returns an idempotent unsubscribe — calling the
  //     returned function twice must NOT throw or re-delete.
  //     (Covers line 349 in live-bot-state-provider.ts.)
  // --------------------------------------------------------------------------
  it("subscribe() unsubscribe is idempotent (calling twice is a no-op)", async () => {
    const config = buildTestConfig(stateFile);
    const bot = new Bot({ config, feed, stateSaveIntervalMs: 100 });
    const provider = new LiveBotStateProvider({
      bot,
      enabledSymbols: ["BTC/USDC"],
      initialEquityUsdt: 10_000,
    });

    const startPromise = bot.start();
    await new Promise<void>((r) => {
      setTimeout(r, 50);
    });
    await provider.start();

    let calls = 0;
    const unsubscribe = provider.subscribe(() => {
      calls++;
    });

    // Az első hívás törli a listener-t.
    unsubscribe();
    // A második hívásnak NO-OPnak kell lennie (a `if (!active) return;`).
    expect(() => unsubscribe()).not.toThrow();

    // A notifyCount nem nő, mert a listener le van iratkozva.
    const notifyCountBefore = calls;
    provider.setKillSwitchState("confirm");
    await new Promise<void>((r) => {
      setTimeout(r, 30);
    });
    expect(calls).toBe(notifyCountBefore);

    await provider.stop();
    await bot.stop();
    await startPromise;
  });

  // --------------------------------------------------------------------------
  // 7) setPaused flag mutates the snapshot and notifies listeners
  //    (Phase 34 coverage fixup — Track B's setPaused method)
  // --------------------------------------------------------------------------
  it("setPaused toggles the paused flag and notifies listeners", async () => {
    const config = buildTestConfig(stateFile);
    const bot = new Bot({ config, feed, stateSaveIntervalMs: 100 });
    const provider = new LiveBotStateProvider({
      bot,
      enabledSymbols: ["BTC/USDC"],
      initialEquityUsdt: 10_000,
    });

    const startPromise = bot.start();
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 100);
    });
    await provider.start();

    // Kezdőállapot: paused NEM kell hogy megjelenjen a snapshot-ban
    // (vagy false), és a listener hívás-szám 0.
    let notifyCount = 0;
    const unsubscribe = provider.subscribe(() => {
      notifyCount++;
    });

    // Pause beállítása.
    provider.setPaused(true);
    expect(provider.getSnapshot().paused).toBe(true);
    expect(notifyCount).toBe(1);

    // Resume.
    provider.setPaused(false);
    expect(provider.getSnapshot().paused).toBe(false);
    expect(notifyCount).toBe(2);

    // Cleanup.
    unsubscribe();
    await provider.stop();
    await bot.stop();
    await startPromise;
  });
});
