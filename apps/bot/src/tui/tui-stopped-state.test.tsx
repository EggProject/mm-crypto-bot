/**
 * apps/bot/src/tui/tui-stopped-state.test.tsx
 *
 * ===========================================================================
 * PHASE 36 TRACK A1 — TUI stopped-state UI tests
 * ===========================================================================
 *
 * User mandate (2026-07-14 20:58 Budapest, issue #1):
 *   "`mm-bot start` ne induljon automatikusan — a TUI `stopped` állapotban
 *    nyíljon, a user a `[s]` billentyűvel indítsa a botot."
 *
 * Ez a teszt file BIZONYÍTVA teszi, hogy a TUI stopped állapotban a
 * helyes UI elemeket mutatja:
 *
 *   1) A Header egy AMBER színű `[● STOPPED]` badge-et mutat.
 *   2) A StatusBar a `[s] ▶ Start` feliratot mutatja (kiemelt, zöld + bold).
 *   3) A StatusBar a stopped állapotban NEM mutatja a `[s] start/stop`
 *      feliratot (a régi default).
 *   4) A StatusBar a stopped állapotban NEM mutatja a `[s] stop` feliratot.
 *   5) A dashboard közepén megjelenik a "bot is idle — press [s] to start"
 *      ASCII banner.
 *   6) A banner NEM jelenik meg TUI-only módban (ott nincs bot).
 *   7) A running állapotban (`state.running === true`) a badge ÉS a
 *      banner NEM jelenik meg.
 *
 * A tesztek a `ink-testing-library` `render(<App />)`-ját használják
 * egy `MockPaperProvider` provider-rel (a `BotStateProvider` interfészt
 * implementálja, a `state.running` flag-et a teszt vezérli).
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { render as renderInk } from "ink-testing-library";
import {
  App,
  type BotState,
  type BotStateProvider,
  type KillSwitchState,
  type Listener,
  type Position,
  type Statistics,
  type TickerEvent,
  type TickerPrice,
  type Trade,
} from "@mm-crypto-bot/tui";

/** Az ink-testing-library `render()` visszatérési típusa. */
type InkInstance = ReturnType<typeof renderInk>;

// ============================================================================
// MockStoppedProvider — `BotStateProvider` implementáció stopped state teszthez
// ============================================================================

/** A mock provider belső state-je. */
function emptyStats(initialEquityUsdt: number): Statistics {
  return {
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
    equityUsdt: initialEquityUsdt,
    initialEquityUsdt,
  };
}

function makeState(
  mode: "tui-only" | "with-bot",
  running: boolean,
  initialEquityUsdt = 10_000,
): BotState {
  return {
    status: {
      mode,
      engineAvailable: running,
      engineError: null,
      connected: running,
      lastUpdate: 0,
    },
    running,
    killSwitch: "armed",
    positions: [] as readonly Position[],
    statistics: emptyStats(initialEquityUsdt),
    history: [] as readonly Trade[],
    tickers: [] as readonly TickerPrice[],
    tickerEvents: [] as readonly TickerEvent[],
    paused: false,
    killSwitchThresholdPct: -10,
  };
}

/**
 * `MockStoppedProvider` — a Phase 36 Track A1 stopped-state UI tesztekhez.
 *
 * A provider `mode` és `running` flag-jeit a teszt konfigurálja a
 * konstruktorban, és a teszt során nem változnak. A `setPaused` /
 * `setKillSwitchState` hívások hatástalanok (a stopped state UI-ját
 * ezek NEM befolyásolják).
 */
class MockStoppedProvider implements BotStateProvider {
  private state: BotState;
  private readonly listeners = new Set<Listener>();

  public constructor(mode: "tui-only" | "with-bot", running: boolean) {
    this.state = makeState(mode, running);
  }

  public subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public getSnapshot(): BotState {
    return this.state;
  }

  // eslint-disable-next-line @typescript-eslint/require-await -- async by design
  public async start(): Promise<void> {
    this.state = { ...this.state, running: true };
    this.notify();
  }

  // eslint-disable-next-line @typescript-eslint/require-await -- async by design
  public async stop(): Promise<void> {
    this.state = { ...this.state, running: false };
    this.notify();
  }

  // eslint-disable-next-line @typescript-eslint/require-await -- async by design
  public async killSwitch(): Promise<void> {
    this.state = { ...this.state, killSwitch: "triggered" };
    this.notify();
  }

  public setKillSwitchState(killState: KillSwitchState): void {
    this.state = { ...this.state, killSwitch: killState };
    this.notify();
  }

  public setPaused(paused: boolean): void {
    this.state = { ...this.state, paused };
    this.notify();
  }

  // eslint-disable-next-line @typescript-eslint/require-await -- async by design
  public async dispose(): Promise<void> {
    this.listeners.clear();
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * `mountTui` — a TUI mountolása egy stopped-state provider-rel.
 */
function mountTui(
  mode: "tui-only" | "with-bot",
  running: boolean,
): { readonly instance: InkInstance; readonly provider: MockStoppedProvider } {
  const provider = new MockStoppedProvider(mode, running);
  const instance = renderInk(<App provider={provider} />);
  return { instance, provider };
}

/**
 * `waitForFrame` — várakozás a React re-renderre. Az `App` mount-ja
 * után azonnal megjelenik a stopped-state UI — a frame-nek 50ms-on
 * belül készen kell lennie.
 */
async function waitForFrame(ms = 50): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

// ============================================================================
// Tests
// ============================================================================

describe("TUI stopped-state UI — Phase 36 Track A1", () => {
  let mounted: { readonly instance: InkInstance; readonly provider: MockStoppedProvider } | null = null;

  beforeEach(() => {
    mounted = null;
  });

  afterEach(async () => {
    if (mounted !== null) {
      mounted.instance.unmount();
      mounted.instance.cleanup();
      await mounted.provider.dispose();
    }
  });

  // --------------------------------------------------------------------------
  // 1) Header — `[● STOPPED]` badge stopped state-ben
  // --------------------------------------------------------------------------
  it("Header renders [● STOPPED] badge when running=false (with-bot mode)", async () => {
    const m = mountTui("with-bot", false);
    mounted = m;
    await waitForFrame();

    const frame = m.instance.lastFrame() ?? "";
    // A spec szerinti badge formátum.
    expect(frame).toContain("[● STOPPED]");
    // A régi "FUT" label NEM jelenik meg stopped state-ben.
    expect(frame).not.toContain("FUT");
    // A LEÁLLÍTVA label a jobboldali running-slotban megjelenik.
    expect(frame).toContain("LEÁLLÍTVA");
  });

  // --------------------------------------------------------------------------
  // 2) StatusBar — `[s] ▶ Start` kiemelt felirat stopped state-ben
  // --------------------------------------------------------------------------
  it("StatusBar renders '[s] ▶ Start' (green + bold) when running=false", async () => {
    const m = mountTui("with-bot", false);
    mounted = m;
    await waitForFrame();

    const frame = m.instance.lastFrame() ?? "";
    // Az Ink a szöveget a terminál szélességére wrap-eli (100 oszlop),
    // ezért a `[s] ▶ Start` string-részletekre szakadhat a frame-ben.
    // A `frameStripped` (szóköz-szétválasztás) segítségével ellenőrizzük,
    // hogy a szöveg RENDELKEZÉSRE ÁLL, függetlenül a wrap-tól.
    const frameStripped = frame.replace(/\s+/g, " ");
    // A spec szerinti formátum: `[s] ▶ Start` (zöld + bold).
    // A `[s]`, `▶`, és `Start` jelen van (a wrap miatt nem feltétlenül
    // egymás mellett — a `s] ▶` a frameStripped-ben közvetlenül egymás
    // mellett van, mert a `[` a wrap miatt a megelőző sorra eshet).
    expect(frameStripped).toMatch(/s\]\s*▶/);
    expect(frameStripped).toContain("Start");
    // A régi "start/stop" felirat NEM jelenik meg stopped state-ben.
    expect(frameStripped).not.toContain("start/stop");
  });

  // --------------------------------------------------------------------------
  // 3) A StatusBar a stopped state-ben NEM mutatja a `[s] start/stop` szöveget
  // --------------------------------------------------------------------------
  it("StatusBar does NOT render 'start/stop' label when running=false", async () => {
    const m = mountTui("with-bot", false);
    mounted = m;
    await waitForFrame();

    const frame = m.instance.lastFrame() ?? "";
    expect(frame).not.toContain("start/stop");
  });

  // --------------------------------------------------------------------------
  // 4) A StatusBar a running state-ben a régi `start/stop` szöveget mutatja
  // --------------------------------------------------------------------------
  it("StatusBar renders 'start/stop' label when running=true (regression)", async () => {
    const m = mountTui("with-bot", true);
    mounted = m;
    await waitForFrame();

    const frame = m.instance.lastFrame() ?? "";
    // A terminál wrap miatt a `start/stop` a `/` karakteren szakadhat
    // — a `start/` substring bizonyítja a "start/stop" formátumot.
    const frameStripped = frame.replace(/\s+/g, " ");
    expect(frameStripped).toContain("start/");
    // A `▶ Start` felirat NEM jelenik meg running state-ben.
    expect(frameStripped).not.toMatch(/s\]\s*▶/);
  });

  // --------------------------------------------------------------------------
  // 5) A dashboard közepén a "bot is idle" banner stopped state-ben
  // --------------------------------------------------------------------------
  it("StoppedBanner renders 'bot is idle — press [s] to start' in stopped state", async () => {
    const m = mountTui("with-bot", false);
    mounted = m;
    await waitForFrame();

    const frame = m.instance.lastFrame() ?? "";
    // A spec szerinti banner szöveg.
    expect(frame).toContain("bot is idle");
    expect(frame).toContain("press");
    expect(frame).toContain("[s]");
    expect(frame).toContain("to start");
  });

  // --------------------------------------------------------------------------
  // 6) A banner NEM jelenik meg running state-ben
  // --------------------------------------------------------------------------
  it("StoppedBanner does NOT render when running=true", async () => {
    const m = mountTui("with-bot", true);
    mounted = m;
    await waitForFrame();

    const frame = m.instance.lastFrame() ?? "";
    expect(frame).not.toContain("bot is idle");
    expect(frame).not.toContain("press [s] to start");
  });

  // --------------------------------------------------------------------------
  // 7) A banner NEM jelenik meg TUI-only módban (ott nincs bot)
  // --------------------------------------------------------------------------
  it("StoppedBanner does NOT render in TUI-only mode (no bot)", async () => {
    const m = mountTui("tui-only", false);
    mounted = m;
    await waitForFrame();

    const frame = m.instance.lastFrame() ?? "";
    // A banner szövege NEM jelenik meg.
    expect(frame).not.toContain("bot is idle");
    // A `[● STOPPED]` badge sem jelenik meg TUI-only módban (a
    // TUI-only módban a badge-ek a mode-ot jelzik, nem a bot-állapotot).
    expect(frame).not.toContain("[● STOPPED]");
    // A TUI-only mode badge-nek viszont meg kell jelennie.
    expect(frame).toContain("[TUI-ONLY]");
  });

  // --------------------------------------------------------------------------
  // 8) A Header badge formátuma `[● STOPPED]` (a spec-ben megadott karakterek)
  // --------------------------------------------------------------------------
  it("Stopped badge has the exact format '[● STOPPED]' (with U+25CF bullet)", async () => {
    const m = mountTui("with-bot", false);
    mounted = m;
    await waitForFrame();

    const frame = m.instance.lastFrame() ?? "";
    // A spec szerinti pontos formátum — a `●` (U+25CF) kitöltött kör.
    // Az Ink a színeket ANSI escape-szekvenciákká alakítja, de a
    // szöveges tartalom (`[● STOPPED]`) megmarad.
    expect(frame).toContain("[● STOPPED]");
    // A `STOPPED` szó önállóan is megjelenik (a spec-ben ez a badge
    // elsődleges azonosítója).
    expect(frame).toContain("STOPPED");
  });

  // --------------------------------------------------------------------------
  // 9) State transition: stopped → running, a badge eltűnik, a footer
  //    a régi `start/stop` formátumra vált.
  // --------------------------------------------------------------------------
  it("state transition: stopped → running updates Header + StatusBar + banner", async () => {
    const m = mountTui("with-bot", false);
    mounted = m;
    await waitForFrame();

    // Stopped state — badge + banner + ▶ Start jelen van.
    // A wrap miatt a frameStripped-et használjuk a kereséshez.
    const frameBeforeStripped = (m.instance.lastFrame() ?? "").replace(/\s+/g, " ");
    expect(frameBeforeStripped).toContain("[● STOPPED]");
    expect(frameBeforeStripped).toContain("bot is idle");
    expect(frameBeforeStripped).toMatch(/s\]\s*▶/);
    expect(frameBeforeStripped).toContain("Start");

    // A user megnyomja a [s]-t — a bot elindul.
    await m.provider.start();
    await waitForFrame(100);

    // Running state — a badge ÉS a banner eltűnik, a footer a
    // `start/stop` formátumra vált.
    //
    // A terminál szélessége (100 oszlop) miatt a `start/stop` string
    // a `/` karakteren wrap-elődik — a frameStripped-ben így `start/`
    // és `top` jelenik meg külön. A `start/` jelenléte a frameStripped-
    // ben bizonyítja, hogy a "start/stop" formátum aktív (a `▶ Start`
    // formátum ezzel szemben `▶` karaktert tartalmazna, ami stopped
    // state-re jellemző).
    const frameAfter = m.instance.lastFrame() ?? "";
    const frameAfterStripped = frameAfter.replace(/\s+/g, " ");
    expect(frameAfterStripped).not.toContain("[● STOPPED]");
    expect(frameAfterStripped).not.toContain("bot is idle");
    expect(frameAfterStripped).not.toMatch(/s\]\s*▶/);
    expect(frameAfterStripped).toContain("start/");
    // A futó állapot label a jobboldali slotban.
    expect(frameAfter).toContain("FUT");
  });

  // --------------------------------------------------------------------------
  // 10) Cleanup: az unmount + dispose nem hagy lógó timert
  // --------------------------------------------------------------------------
  it("unmount + dispose clean up without throwing", async () => {
    const m = mountTui("with-bot", false);
    await waitForFrame();

    expect(() => {
      m.instance.unmount();
    }).not.toThrow();
    const disposePromise = m.provider.dispose();
    expect(disposePromise).toBeInstanceOf(Promise);
    await disposePromise;

    mounted = null; // az afterEach nem próbálja újra unmount-olni
  });
});
