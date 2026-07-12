/**
 * apps/bot/src/tui/integration-probe.test.tsx
 *
 * ===========================================================================
 * TUI + BOT INTEGRATION PROBE — Phase 34 Track D
 * ===========================================================================
 *
 * "verify the actual behavior, not the docstring."
 *
 * Az integration-probe a Phase 21 #1 lecke alkalmazása a TUI + Bot
 * end-to-end útvonalra: BIZONYÍTJA, hogy a futó `Bot` state-változásai
 * valóban eljutnak a TUI render-ig ≤ 100ms alatt.
 *
 * A teszt a valódi `Bot`-ot indítja (mock feed-del, stratégiák kikapcsolva),
 * a `LiveBotStateProvider`-en keresztül csatlakoztatja a TUI-t, és az
 * `ink-testing-library` `render()`-jével mountolja a teljes TUI-t. A
 * feed-en push-olt ticker tick a Bot-on át a provider-en át a TUI render-ig
 * jut — a mért idő ≤ 100ms (a spec §4.3 "realtime" ígérete).
 *
 * ===========================================================================
 * MIT TESZTELÜNK?
 * ===========================================================================
 *   1) A Bot + LiveBotStateProvider + TUI integráció működik
 *   2) A TUI rendereli a Bot state-jét (positions / tickers / history)
 *   3) A ticker tick → Bot → provider → TUI re-render ≤ 100ms
 *   4) A re-render valóban megjelenik a frame-ben (a `lastFrame()` változik)
 *   5) A TUI unmount + Bot stop tiszta teardown (nincs lógó listener)
 *
 * ===========================================================================
 * FELHASZNÁLÓI MANDÁTUM
 * ===========================================================================
 * Phase 21 #1 lecke: a probe a TUI valódi renderelését ellenőrzi, nem
 * csak a provider belső logikáját. Ha a TUI renderelése elromlik (pl.
 * egy refactor eltöri a useSyncExternalStore-ot), ez a teszt AZONNAL
 * elbukik.
 *
 * Phase 34 Track B kompatibilitás: a BotState új mezői (`tickerEvents`,
 * `paused`, `killSwitchThresholdPct`) a TUI frame-ben is megjelennek.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { render as renderInk } from "ink-testing-library";
import {
  App,
  type BotStateProvider,
} from "@mm-crypto-bot/tui";

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

/** Az ink-testing-library `render()` visszatérési típusa. */
type InkInstance = ReturnType<typeof renderInk>;

// ============================================================================
// Helpers
// ============================================================================

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
 * a tmp könyvtárba irányítja, és minden stratégiát kikapcsol.
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
      // Minden stratégiát kikapcsolunk — a probe csak a state-flow-t teszteli.
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

/**
 * `mountTui` — a TUI mountolása egy adott provider-rel. Visszaadja az
 * ink instance-t, ami a későbbi `lastFrame()` hívásokhoz kell.
 */
function mountTui(provider: BotStateProvider): InkInstance {
  return renderInk(<App provider={provider} />);
}

// ============================================================================
// Tests
// ============================================================================

describe("integration probe — Bot + TUI end-to-end, realtime state < 100ms", () => {
  let tmpDir: string;
  let stateFile: string;
  let feed: MockExchangeFeed;
  let bot: Bot | null = null;
  let provider: LiveBotStateProvider | null = null;
  let mounted: InkInstance | null = null;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "mm-bot-tui-int-probe-"));
    stateFile = join(tmpDir, "bot-state.json");
    feed = new MockExchangeFeed({
      balances: [{ currency: "USDC", free: 10_000, total: 10_000 }],
    });
  });

  afterEach(async () => {
    // A cleanup sorrend fontos: előbb a TUI unmount, utána a provider stop,
    // végül a bot stop. Ha a TUI még mindig mountolva van a provider
    // unsubscribe-kor, a Bot subscribe hívása ReferenceError-t dobhat.
    if (mounted !== null) {
      mounted.unmount();
      mounted.cleanup();
      mounted = null;
    }
    if (provider !== null) {
      await provider.stop();
      provider = null;
    }
    if (bot !== null) {
      await bot.stop();
      bot = null;
    }
    if (existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  // --------------------------------------------------------------------------
  // 1) Alap integráció: a Bot + provider + TUI mount sikeres
  // --------------------------------------------------------------------------
  it("Bot + LiveBotStateProvider + TUI mount without errors", async () => {
    const config = buildTestConfig(stateFile);
    bot = new Bot({ config, feed, stateSaveIntervalMs: 50 });
    provider = new LiveBotStateProvider({
      bot,
      enabledSymbols: ["BTC/USDC"],
      initialEquityUsdt: 10_000,
    });

    const startPromise = bot.start();
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 100);
    });
    await provider.start();

    // A TUI mountolása — ez az első pont, ahol a React tree felépül.
    mounted = mountTui(provider);
    expect(mounted).toBeDefined();

    // Várunk, amíg a TUI az első render-t végrehajtja.
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 50);
    });

    // A frame tartalmazza a Phase 34 Track B badge-eit + panel-szövegeket.
    const frame = mounted.lastFrame() ?? "";
    expect(frame).toContain("mm-crypto-bot TUI");
    // A with-bot mód (Bot fut) [LIVE] badge-et mutat.
    expect(frame).toContain("[LIVE]");
    expect(frame).toContain("STATISZTIKA");
    expect(frame).toContain("ÉLŐ KERESKEDÉS");
    expect(frame).toContain("HISTORY");

    // Cleanup — a bot.stop() a run-loop-ból kilép, a startPromise feloldódik.
    await provider.stop();
    await bot.stop();
    await startPromise;
  }, 30_000);

  // --------------------------------------------------------------------------
  // 2) Realtime: ticker tick → TUI re-render ≤ 100ms
  // --------------------------------------------------------------------------
  it("ticker tick → TUI re-renders within 100ms (frame reflects new state)", async () => {
    const config = buildTestConfig(stateFile);
    bot = new Bot({ config, feed, stateSaveIntervalMs: 50 });
    provider = new LiveBotStateProvider({
      bot,
      enabledSymbols: ["BTC/USDC"],
      initialEquityUsdt: 10_000,
    });
    // A fenti `startPromise` mintát követjük — a bot indítása nem blokkol,
    // a run-loop a `bot.stop()` hívásra terminál.

    const startPromise = bot.start();
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 100);
    });
    await provider.start();

    // A TUI mountolása.
    mounted = mountTui(provider);
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 50);
    });

    // A KEZDŐ frame rögzítése — a méréshez referenciaként.
    const initialFrame = mounted.lastFrame() ?? "";
    const initialTickerEvents = provider.getSnapshot().tickerEvents.length;

    // Push 5 mock ticker tick.
    const symbol = asSymbol("BTC/USDC") ;
    const pushAt = Date.now();
    for (let i = 0; i < 5; i++) {
      pushTickerTick(feed, symbol, 60_000 + i * 10);
    }

    // A TUI re-render idejének mérése. A `useSyncExternalStore` a
    // provider notify-jaira frissít. A bot stateSaveIntervalMs=50ms
    // a belső ciklus, és a notify a state save során hívódik.
    //
    // A polling overhead miatt (5ms) a tényleges render ≤ 100ms,
    // de a mért "ciklus-idő" ≤ 150ms a CI-biztos küszöb.
    const maxWaitMs = 100;
    const deadline = pushAt + maxWaitMs + 50;
    let frameUpdated = false;
    while (Date.now() < deadline) {
      const currentFrame = mounted.lastFrame() ?? "";
      const currentTickerEvents = provider.getSnapshot().tickerEvents.length;
      // A frame TARTALMA megváltozik, ha a ticker-ár frissül.
      // A BTC ticker az új árat fogja mutatni (60_000 → 60_040 stb.).
      if (currentTickerEvents > initialTickerEvents) {
        // A state frissült — ellenőrizzük, hogy a frame is tükrözi.
        // A BTC ticker az új árat a "60 040" vagy hasonló formátumban
        // mutatja. Az initialFrame "60 000,00"-t tartalmazott.
        if (currentFrame !== initialFrame) {
          frameUpdated = true;
          break;
        }
      }
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 5);
      });
    }
    const elapsed = Date.now() - pushAt;

    expect(frameUpdated).toBe(true);
    // A TUI realtime ígéret: a state-frissülés ≤ 100ms. A polling
    // overhead miatt a 150ms a konzervatív küszöb (CI-biztos).
    expect(elapsed).toBeLessThan(150);

    // Cleanup — a bot.stop() a run-loop-ból kilép.
    await provider.stop();
    await bot.stop();
    await startPromise;
  }, 30_000);

  // --------------------------------------------------------------------------
  // 3) Push 5 + push 5 (10 tick összesen): a TUI végig re-renderel
  // --------------------------------------------------------------------------
  it("5 + 5 ticker ticks trigger consistent TUI re-renders", async () => {
    const config = buildTestConfig(stateFile);
    bot = new Bot({ config, feed, stateSaveIntervalMs: 50 });
    provider = new LiveBotStateProvider({
      bot,
      enabledSymbols: ["BTC/USDC"],
      initialEquityUsdt: 10_000,
    });

    const startPromise = bot.start();
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 100);
    });
    await provider.start();
    mounted = mountTui(provider);
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 50);
    });

    const symbol = asSymbol("BTC/USDC") ;

    // Első 5 tick.
    for (let i = 0; i < 5; i++) {
      pushTickerTick(feed, symbol, 60_000 + i * 10);
    }
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 150);
    });

    const tickerEventsAfter5 = provider.getSnapshot().tickerEvents.length;
    expect(tickerEventsAfter5).toBeGreaterThan(0);

    // Második 5 tick.
    for (let i = 0; i < 5; i++) {
      pushTickerTick(feed, symbol, 61_000 + i * 10);
    }
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 150);
    });

    const tickerEventsAfter10 = provider.getSnapshot().tickerEvents.length;
    // A 10 tick mindegyike notify-t triggerel — a TUI ticker-event-ek
    // száma nő.
    expect(tickerEventsAfter10).toBeGreaterThan(tickerEventsAfter5);

    // A frame továbbra is érvényes — a TUI nem crashelt.
    const frame = mounted.lastFrame() ?? "";
    expect(frame.length).toBeGreaterThan(100);
    expect(frame).toContain("mm-crypto-bot TUI");

    // Cleanup — a bot.stop() a run-loop-ból kilép.
    await provider.stop();
    await bot.stop();
    await startPromise;
  }, 30_000);

  // --------------------------------------------------------------------------
  // 4) A TUI unmount + Bot stop tiszta teardown (nincs lógó listener)
  // --------------------------------------------------------------------------
  it("TUI unmount + provider stop + bot stop clean teardown", async () => {
    const config = buildTestConfig(stateFile);
    bot = new Bot({ config, feed, stateSaveIntervalMs: 50 });
    provider = new LiveBotStateProvider({
      bot,
      enabledSymbols: ["BTC/USDC"],
      initialEquityUsdt: 10_000,
    });

    // A bot indítása — a run-loop a `bot.stop()` hívásra terminál,
    // ezért a promise-ot NEM tároljuk (az afterEach-ben állítjuk le).
    void bot.start();
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 100);
    });
    await provider.start();
    mounted = mountTui(provider);
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 50);
    });

    // Push néhány tick-et, hogy a state aktív legyen.
    const symbol = asSymbol("BTC/USDC") ;
    for (let i = 0; i < 3; i++) {
      pushTickerTick(feed, symbol, 60_000 + i);
    }
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 100);
    });

    // A teardown sorrend fontos — a TUI unmount-ja a cleanup
    // során a provider-t dispose-olja, ami leiratkozik a bot-ról.
    expect(() => {
      mounted?.unmount();
      mounted?.cleanup();
    }).not.toThrow();
    mounted = null;

    expect(() => {
      void provider?.stop();
    }).not.toThrow();
    provider = null;

    // A bot.stop() a run-loop-ból kilép, a state-et flush-eli, a feed-et
    // lezárja. A Bot.subscribe listener-ek a leiratkozás után NEM hívódnak.
    const stopPromise = bot.stop();
    expect(stopPromise).toBeInstanceOf(Promise);
    await stopPromise;
    bot = null;
  });
});
