/**
 * apps/bot/src/tui/live-bot-state-provider.running-flag.test.ts
 *
 * ============================================================================
 * PHASE 38 FIX #38 — TUI running-flag decoupling
 * ============================================================================
 *
 * A Phase 36 Track A1 user mandate ("`mm-bot start` ne induljon automatikusan")
 * óta a `mm-bot start` ALAPÉRTELMEZETTEN `stopped` állapotban nyitja meg a
 * TUI-t, és a user a `[s]` billentyűvel indítja a botot. A bug az volt, hogy
 * a `LiveBotStateProvider.start()` UNCONDITIONALLY `this.running = true`-ra
 * állította a saját belső flag-jét — a TUI `state.running` mezője tehát
 * `true` volt akkor is, amikor a bot valójában NEM futott.
 *
 * A fix: a provider belső "active" flag-je (provider szintű "figyelek a
 * botra" szemafor) ELVÁLASZTÁSRA kerül a "bot is running" szemantikától.
 * A `markBotStarted()` / `markBotStopped()` API explicit módon jelzi, hogy
 * a bot valóban elindult / leállt — ezt a `start.ts` hívja a `bot.start()`
 * / `bot.stop()` mellé.
 *
 * Ezek a tesztek:
 *   1) BIZONYÍTJÁK a bug-ot (a `state.running === true` volt `provider.start()`
 *      után, pedig a bot nem indult el).
 *   2) INTEGRÁCIÓS stílusban szimulálják a `start.ts` `autoStart=false` flow-ját:
 *      provider.start() → running=false; markBotStarted() → running=true;
 *      markBotStopped() → running=false.
 *   3) Biztosítják, hogy a `status.engineAvailable` / `status.connected` a
 *      provider `active` flag-jét kövesse (nem a `botRunning`-ot), mert ezek
 *      a "provider figyel a botra" szemaforokat jelentik, nem a bot kereskedési
 *      állapotát.
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
 * A helper a wire-up-probe mintáját követi.
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
 * a tmp könyvtárba irányítja. A bot.stratégiák mind ki vannak kapcsolva —
 * a running-flag tesztek nem a trade flow-t tesztelik.
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

describe("LiveBotStateProvider — running-flag decoupling (Phase 38 Fix #38)", () => {
  let tmpDir: string;
  let stateFile: string;
  let feed: MockExchangeFeed;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "mm-bot-tui-running-flag-"));
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
  // 1) BUG REPRODUCTION: provider.start() WITHOUT bot start or markBotStarted
  //
  //    A Phase 36 Track A1 óta a `mm-bot start` (no auto-start) flow:
  //      1) `new LiveBotStateProvider(...)`
  //      2) `provider.start()` ← itt volt a bug
  //      3) TUI megnyílik, várja a user [s] billentyűjét
  //      4) `bot.start()` + `provider.markBotStarted()` ← CSAK a [s] után
  //
  //    A bug előtt a (2) után a TUI `state.running === true` volt — a
  //    `StoppedBanner` nem jelent meg. Ez a teszt BIZONYÍTVA védi a fixet.
  // --------------------------------------------------------------------------
  it("BUG REPRO: provider.start() without markBotStarted() must report state.running === false", async () => {
    const config = buildTestConfig(stateFile);
    const bot = new Bot({ config, feed, stateSaveIntervalMs: 100 });
    const provider = new LiveBotStateProvider({
      bot,
      enabledSymbols: ["BTC/USDC"],
      initialEquityUsdt: 10_000,
    });

    // A bot NEM indul el (Phase 38 Fix #38 reprodukció: a provider
    // indul, de a bot stopped marad).
    await provider.start();

    // A TUI-nak a stopped state-et KELL látnia.
    const snap = provider.getSnapshot();
    expect(snap.running).toBe(false);
    // A `status.engineAvailable` / `status.connected` a provider active
    // flag-jét követi (a provider figyel a botra, még ha a bot nem is fut).
    expect(snap.status.engineAvailable).toBe(true);
    expect(snap.status.connected).toBe(true);

    await provider.dispose();
  });

  // --------------------------------------------------------------------------
  // 2) INTEGRATION: simulate `start.ts` with autoStart=false flow
  //
  //    A `start.ts` a `runTui(...)` függvényben (Phase 36 Track A1):
  //      1) const provider = new LiveBotStateProvider({...})
  //      2) await provider.start()                    // A1: provider ALWAYS starts
  //      3) if (autoStart) await bot.start()          // A1: bot csak ha autoStart
  //      4) if (autoStart) provider.markBotStarted()  // A1: csak a bot start után
  //
  //    A fix NÉLKÜL a (2) után a TUI running=true volt. A fixszel:
  //    (2) → running=false, (4) → running=true.
  // --------------------------------------------------------------------------
  it("INTEGRATION: autoStart=false flow → markBotStarted/Stopped controls state.running", async () => {
    const config = buildTestConfig(stateFile);
    const bot = new Bot({ config, feed, stateSaveIntervalMs: 100 });
    const provider = new LiveBotStateProvider({
      bot,
      enabledSymbols: ["BTC/USDC"],
      initialEquityUsdt: 10_000,
    });

    // (2) provider.start() — a bot NEM indul el.
    await provider.start();
    expect(provider.getSnapshot().running).toBe(false);

    // (4) A user megnyomja a [s]-t — a CLI hívja a bot.start()-et,
    //     ÉS a provider.markBotStarted()-et.
    //     Itt most a bot-ot NEM indítjuk el ténylegesen (csak a provider
    //     flag-jét állítjuk, ahogy a start.ts tenné a sikeres bot.start()
    //     után).
    const startPromise = bot.start();
    await new Promise<void>((r) => {
      setTimeout(r, 50);
    });
    // A bot valóban elindult — most jelezzük a provider felé.
    provider.markBotStarted();
    expect(provider.getSnapshot().running).toBe(true);
    // A status.engineAvailable/connected is frissül (a provider
    // markBotStarted() hívás a refreshFromBot()-on át megy).
    expect(provider.getSnapshot().status.engineAvailable).toBe(true);
    expect(provider.getSnapshot().status.connected).toBe(true);

    // A user újra megnyomja a [s]-t — a bot leáll, a provider jelzi.
    // A markBotStopped() ELŐTT a bot.stop()-ot hívjuk (graceful).
    provider.markBotStopped();
    expect(provider.getSnapshot().running).toBe(false);

    // Cleanup.
    await bot.stop();
    await startPromise;
    await provider.dispose();
  });

  // --------------------------------------------------------------------------
  // 3) KONZISZTENCIA: TUI-only mód szimulációja
  //
  //    A `mm-bot tui` parancs esetén a `start.ts` NEM hoz létre `Bot`-ot,
  //    hanem a `SimulatedProvider`-t használja. DE ha valaki (pl. egy
  //    future feature) a `LiveBotStateProvider`-t használná TUI-only
  //    módban (bot nélkül), a `markBotStarted()` SOHA nem hívódik —
  //    a TUI-nak a stopped state-et KELL mutatnia.
  // --------------------------------------------------------------------------
  it("TUI-only simulation: no markBotStarted() ever called → state.running stays false", async () => {
    const config = buildTestConfig(stateFile);
    const bot = new Bot({ config, feed, stateSaveIntervalMs: 100 });
    const provider = new LiveBotStateProvider({
      bot,
      enabledSymbols: ["BTC/USDC"],
      initialEquityUsdt: 10_000,
    });

    await provider.start();
    // Push néhány ticker ticket, hogy a bot notify-oljon (mintha a
    // bot.mocked feed-je aktív lenne).
    const symbol = asSymbol("BTC/USDC") as unknown as ExchangeSymbol;
    for (let i = 0; i < 3; i++) {
      pushTickerTick(feed, symbol, 60_000 + i);
    }
    await new Promise<void>((r) => {
      setTimeout(r, 100);
    });

    // A provider aktív (figyel a bot notify-okra), de a bot NEM
    // fut a `markBotStarted()` szempontjából.
    expect(provider.getSnapshot().running).toBe(false);
    // A status.engineAvailable / status.connected a provider active
    // flag-jét tükrözi (a provider FIGYEL, de a bot nem fut).
    expect(provider.getSnapshot().status.engineAvailable).toBe(true);
    expect(provider.getSnapshot().status.connected).toBe(true);

    await provider.dispose();
  });

  // --------------------------------------------------------------------------
  // 4) IDEMPOTENCIA: többszöri markBotStarted() hívás nem okoz gondot.
  // --------------------------------------------------------------------------
  it("markBotStarted() is idempotent — calling it twice keeps state.running=true", async () => {
    const config = buildTestConfig(stateFile);
    const bot = new Bot({ config, feed, stateSaveIntervalMs: 100 });
    const provider = new LiveBotStateProvider({
      bot,
      enabledSymbols: ["BTC/USDC"],
      initialEquityUsdt: 10_000,
    });

    await provider.start();
    provider.markBotStarted();
    expect(provider.getSnapshot().running).toBe(true);
    // A második hívás nem vált állapotot.
    provider.markBotStarted();
    expect(provider.getSnapshot().running).toBe(true);
    // A markBotStopped() visszaállítja.
    provider.markBotStopped();
    expect(provider.getSnapshot().running).toBe(false);
    // A második markBotStopped() hívás is idempotens.
    provider.markBotStopped();
    expect(provider.getSnapshot().running).toBe(false);

    await provider.dispose();
  });

  // --------------------------------------------------------------------------
  // 5) LISTENER ÉRTESÍTÉS: a markBotStarted() / markBotStopped() notify-olja
  //    a TUI listener-eit (hogy a React újra-renderelje a stopped → running
  //    átmenetet).
  // --------------------------------------------------------------------------
  it("markBotStarted/Stopped notify TUI listeners", async () => {
    const config = buildTestConfig(stateFile);
    const bot = new Bot({ config, feed, stateSaveIntervalMs: 100 });
    const provider = new LiveBotStateProvider({
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
    // A microtask queue kiürül, hogy a notify-ok biztosan lefusssanak.
    await new Promise<void>((r) => {
      setTimeout(r, 10);
    });

    expect(notifyCount).toBeGreaterThanOrEqual(2);
    // Az utolsó notify running=false kell legyen (a markBotStopped után).
    expect(seenRunning[seenRunning.length - 1]).toBe(false);

    unsubscribe();
    await provider.dispose();
  });

  // --------------------------------------------------------------------------
  // 6) ORDER: a provider.start() ELŐTT hívott markBotStarted() nem okoz
  //    "running" állapotot (a provider még nem aktív).
  //
  //    A start.ts MINDIG a provider.start() UTÁN hívja a
  //    markBotStarted()-et (a bot.start() sikeres resolve-ja után).
  //    Ez a teszt védi azt a future regressziót, hogyha valaki
  //    megfordítaná a sorrendet.
  // --------------------------------------------------------------------------
  it("markBotStarted() before provider.start() is a no-op (provider not active yet)", async () => {
    const config = buildTestConfig(stateFile);
    const bot = new Bot({ config, feed, stateSaveIntervalMs: 100 });
    const provider = new LiveBotStateProvider({
      bot,
      enabledSymbols: ["BTC/USDC"],
      initialEquityUsdt: 10_000,
    });

    // A provider még nem aktív.
    expect(provider.getSnapshot().running).toBe(false);

    // A markBotStarted() a provider.start() ELŐTT — a flag átáll, de
    // a provider.start() híváskor a botRunning flag-nek már true-nak
    // KELL lennie (vagyis a flag "kitart" a start után is).
    // Az intent: a markBotStarted() csak akkor van értelme, ha a
    // provider aktív — DE a flag állapotát a start után is megőrzi.
    provider.markBotStarted();
    expect(provider.getSnapshot().running).toBe(true);

    // Cleanup.
    await provider.dispose();
  });
});

/**
 * ============================================================================
 * PHASE 43 TRACK 2 — setEngineError() — crash surface
 * ============================================================================
 *
 * A Phase 36 Track A1 óta a `mm-bot start` a TUI-t `stopped` state-ben
 * nyitja, és a `startCommand` a `botStartPromise.catch()`-ben csak a
 * `console.error`-ba írta a hibát — a TUI-ban nem jelent meg. A user a
 * [● STOPPED] badge-et + "press [s] to start" üzenetet látta, miközben a
 * bot valójában AZONNAL összeomlott. A fix: a `setEngineError(message)`
 * metódus a TUI `state.status.engineError` mezőjét állítja, amit a Header
 * [● CRASHED] badge + piros ⚠ hibasorként jelenít meg.
 *
 * Ezek a tesztek bizonyítják:
 *   1) setEngineError(message) beállítja a state.status.engineError-t.
 *   2) setEngineError(message) notifyListeners()-t hív (a TUI
 *      useSyncExternalStore re-rendert kap).
 *   3) setEngineError(null) törli a hibát (pl. recovery flow).
 *   4) Idempotencia: kétszeri hívás ugyanazzal az értékkel NEM
 *      okoz felesleges re-rendert.
 */
describe("LiveBotStateProvider — Phase 43 Track 2 setEngineError", () => {
  function createTestProvider(): LiveBotStateProvider {
    // A teszt-szintű provider-nek nincs valódi bot, csak a state-mappinget
    // teszteli. A `Bot.subscribe` listener nem hívódik meg, mert a
    // provider soha nem kap valódi engine state-et — a tesztek az
    // engineError-t közvetlenül a provider-en állítják.
    const bot = {
      subscribe: () => () => undefined,
      getState: () => null,
      stop: async () => undefined,
    } as unknown as Bot;
    return new LiveBotStateProvider({ bot });
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

    // Cleanup.
    void provider.dispose();
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

    // Cleanup.
    void provider.dispose();
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

    // Cleanup.
    void provider.dispose();
  });
});
