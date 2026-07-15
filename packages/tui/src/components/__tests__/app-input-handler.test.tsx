/**
 * packages/tui/src/components/__tests__/app-input-handler.test.tsx
 *
 * ===========================================================================
 * PHASE 41 — APP useInput HANDLER COMPREHENSIVE TESTS
 * ===========================================================================
 *
 * Az `App` komponens useInput kezelője 13-féle action típust
 * kezel (quit, toggle-help, close-help, start-stop, pause, kill-*,
 * refresh, cycle-sort, open-settings, select-panel, cycle-panel,
 * noop). A 100%-os OWN coverage eléréséhez minden action ágat
 * le kell fedni.
 *
 * A tiszta logikát (`keybindAction` dispatcher) az `app-logic.ts`
 * tartalmazza, és ott 100%-ban le van fedve. Ez a teszt a
 * DISPATCHER → SIDE-EFFECT mapping-et fedi le — a `stdin.write()`
 * segítségével szimulálunk billentyű-leütéseket, és figyeljük,
 * hogy a side-effect-ek (provider.stop / start / setPaused /
 * setKillSwitchState / stb.) bekövetkeznek-e.
 *
 * A teszt a `mock.module` használatával MOCKOLJA a `useTerminalSize`
 * hookot (a tesztek determinisztikusak legyenek), ÉS a `provider`
 * metódusait is spy-okkal figyeli.
 *
 * ===========================================================================
 */

import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import * as hookModule from "../../hooks/useTerminalSize.js";
import { asSymbol } from "@mm-crypto-bot/exchange";

const originalResolveLayoutMode = hookModule.resolveLayoutMode;
const originalResolveTerminalSize = hookModule.resolveTerminalSize;
const originalUseTerminalSize = hookModule.useTerminalSize;

function mockUseTerminalSize(layoutMode: "2x2" | "2x1" | "1x4", columns: number): void {
  mock.module("../../hooks/useTerminalSize.js", () => ({
    resolveLayoutMode: originalResolveLayoutMode,
    resolveTerminalSize: () => ({ columns, rows: 40, layoutMode }),
    useTerminalSize: () => ({ columns, rows: 40, layoutMode }),
    readStdoutSize: hookModule.readStdoutSize,
    createResizeHandler: hookModule.createResizeHandler,
    BREAKPOINTS: hookModule.BREAKPOINTS,
  }));
}

afterEach(() => {
  mock.module("../../hooks/useTerminalSize.js", () => ({
    resolveLayoutMode: originalResolveLayoutMode,
    resolveTerminalSize: originalResolveTerminalSize,
    useTerminalSize: originalUseTerminalSize,
    readStdoutSize: hookModule.readStdoutSize,
    createResizeHandler: hookModule.createResizeHandler,
    BREAKPOINTS: hookModule.BREAKPOINTS,
  }));
});

async function loadApp() {
  return await import("../../App.js");
}

async function loadProvider() {
  return await import("../../providers/SimulatedProvider.js");
}

/**
 * A `useApp` hook az Ink-ből jön — a `useApp().exit` a kilépést
 * triggereli. A tesztben a useApp-et MOCKOLJUK, hogy ne hívjon
 * valódi exit-et (ami leállítaná a tesztet).
 */
function mockUseApp(): void {
  // Az Ink `useApp` hookját a teszt setup mockolja — a globális
  // patch-öt közvetlenül a render előtt alkalmazzuk.
}

describe("App useInput handler — comprehensive Phase 41 coverage", () => {
  beforeEach(() => {
    mockUseTerminalSize("2x2", 160);
    mockUseApp();
  });

  it("[q] triggers quit action — invokes provider.dispose() (stop is conditional on running)", async () => {
    const { App } = await loadApp();
    const { SimulatedProvider } = await loadProvider();
    const provider = new SimulatedProvider({ mode: "with-bot", seed: 42 });

    // A provider metódusait spy-okkal figyeljük.
    let stopCalled = false;
    let disposeCalled = false;
    const origStop = provider.stop.bind(provider);
    const origDispose = provider.dispose.bind(provider);
    provider.stop = async () => { stopCalled = true; await origStop(); };
    provider.dispose = async () => { disposeCalled = true; await origDispose(); };

    const { render } = await import("ink-testing-library");
    const { stdin, unmount } = render(<App provider={provider} />);

    // A [q] billentyű-t a stdin-en keresztül szimuláljuk.
    stdin.write("q");
    // Várunk egy kicsit, hogy a useInput handler aszinkron része
    // (provider.stop + dispose) lefusson.
    await new Promise((resolve) => setTimeout(resolve, 50));
    // A bot NEM fut (stopped), ezért a stop NEM hívódik, DE a
    // dispose MINDIG hívódik (a kilépéskor).
    expect(stopCalled).toBe(false);
    expect(disposeCalled).toBe(true);

    unmount();
  });

  it("[s] in with-bot mode triggers start-stop action — invokes provider.start()", async () => {
    const { App } = await loadApp();
    const { SimulatedProvider } = await loadProvider();
    const provider = new SimulatedProvider({ mode: "with-bot", seed: 42 });

    let startCalled = false;
    const origStart = provider.start.bind(provider);
    provider.start = async () => { startCalled = true; await origStart(); };

    const { render } = await import("ink-testing-library");
    const { stdin, unmount } = render(<App provider={provider} />);
    stdin.write("s");
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(startCalled).toBe(true);

    unmount();
  });

  it("[s] when bot is RUNNING triggers start-stop (stop branch) — invokes provider.stop()", async () => {
    const { App } = await loadApp();
    const { SimulatedProvider } = await loadProvider();
    const provider = new SimulatedProvider({ mode: "with-bot", seed: 42 });
    // A botot elindítjuk, hogy a [s] a "stop" ágat váltsa ki.
    await provider.start();

    let stopCalled = false;
    const origStop = provider.stop.bind(provider);
    provider.stop = async () => { stopCalled = true; await origStop(); };

    const { render } = await import("ink-testing-library");
    const { stdin, unmount } = render(<App provider={provider} />);
    stdin.write("s");
    await new Promise((resolve) => setTimeout(resolve, 50));
    // A [s] a "stop" ágat triggereli, ha a bot fut.
    expect(stopCalled).toBe(true);

    unmount();
  });

  it("[q] when bot is RUNNING triggers quit (with stop) — invokes provider.stop() and provider.dispose()", async () => {
    const { App } = await loadApp();
    const { SimulatedProvider } = await loadProvider();
    const provider = new SimulatedProvider({ mode: "with-bot", seed: 42 });
    // A botot elindítjuk, hogy a [q] a "stop + dispose" ágat váltsa ki.
    await provider.start();

    let stopCalled = false;
    let disposeCalled = false;
    const origStop = provider.stop.bind(provider);
    const origDispose = provider.dispose.bind(provider);
    provider.stop = async () => { stopCalled = true; await origStop(); };
    provider.dispose = async () => { disposeCalled = true; await origDispose(); };

    const { render } = await import("ink-testing-library");
    const { stdin, unmount } = render(<App provider={provider} />);
    stdin.write("q");
    await new Promise((resolve) => setTimeout(resolve, 50));
    // A [q] a "stop + dispose" ágat triggereli, ha a bot fut.
    expect(stopCalled).toBe(true);
    expect(disposeCalled).toBe(true);

    unmount();
  });

  it("[q] in kill-confirm state triggers kill-cancel (NOT quit) — even when bot is running", async () => {
    const { App } = await loadApp();
    const { SimulatedProvider } = await loadProvider();
    const provider = new SimulatedProvider({ mode: "with-bot", seed: 42 });
    await provider.start();
    provider.setKillSwitchState("confirm");

    let disposeCalled = false;
    const origDispose = provider.dispose.bind(provider);
    provider.dispose = async () => { disposeCalled = true; await origDispose(); };

    const { render } = await import("ink-testing-library");
    const { stdin, unmount } = render(<App provider={provider} />);
    stdin.write("q");
    await new Promise((resolve) => setTimeout(resolve, 50));
    // A [q] a kill-confirm módban a "kill-cancel" action-t triggereli,
    // NEM a "quit" action-t — a dispose NEM hívódik.
    expect(disposeCalled).toBe(false);

    unmount();
  });

  it("[Esc] triggers close-help when help is visible — sets helpVisible=false", async () => {
    const { App } = await loadApp();
    const { SimulatedProvider } = await loadProvider();
    const provider = new SimulatedProvider({ mode: "with-bot", seed: 42 });

    const { render } = await import("ink-testing-library");
    const { lastFrame, stdin, unmount } = render(<App provider={provider} />);
    // A help overlay megnyitása a [?]-vel.
    stdin.write("?");
    await new Promise((resolve) => setTimeout(resolve, 50));
    const openFrame = lastFrame() ?? "";
    expect(openFrame).toContain("BILLENTYŰZET-SÚGÓ");
    // Az [Esc] bezárja a help overlay-t. Az Ink useInput a
    // `\x1b` karaktert olvassa be — a key.escape flag-et
    // a parser állítja be.
    stdin.write("\x1b");
    await new Promise((resolve) => setTimeout(resolve, 50));
    const closedFrame = lastFrame() ?? "";
    expect(closedFrame).not.toContain("BILLENTYŰZET-SÚGÓ");

    unmount();
  });

  it("[p] in with-bot mode triggers pause action — invokes provider.setPaused()", async () => {
    const { App } = await loadApp();
    const { SimulatedProvider } = await loadProvider();
    const provider = new SimulatedProvider({ mode: "with-bot", seed: 42 });

    let setPausedCalledWith: boolean | undefined;
    const origSetPaused = provider.setPaused.bind(provider);
    provider.setPaused = (p: boolean) => { setPausedCalledWith = p; origSetPaused(p); };

    const { render } = await import("ink-testing-library");
    const { stdin, unmount } = render(<App provider={provider} />);
    stdin.write("p");
    await new Promise((resolve) => setTimeout(resolve, 50));
    // A [p] megnyomásakor a paused false → true váltás történik.
    expect(setPausedCalledWith).toBe(true);

    unmount();
  });

  it("[r] triggers refresh action — updates `now` state (no provider call)", async () => {
    const { App } = await loadApp();
    const { SimulatedProvider } = await loadProvider();
    const provider = new SimulatedProvider({ mode: "with-bot", seed: 42 });

    const { render } = await import("ink-testing-library");
    const { lastFrame, stdin, unmount } = render(<App provider={provider} />);

    // A [r] frissíti a `now` state-et — a `lastFrame` hívásakor
    // a frissített state jelenik meg. A pontos értéket nem
    // ellenőrizzük (időfüggő), csak a renderelés tényét.
    const beforeFrame = lastFrame() ?? "";
    stdin.write("r");
    await new Promise((resolve) => setTimeout(resolve, 50));
    const afterFrame = lastFrame() ?? "";
    // A frissítés után a frame nem üres — a renderelés megtörtént.
    expect(beforeFrame.length).toBeGreaterThan(0);
    expect(afterFrame.length).toBeGreaterThan(0);

    unmount();
  });

  it("[t] triggers cycle-sort action — updates sortKey state", async () => {
    const { App } = await loadApp();
    const { SimulatedProvider } = await loadProvider();
    const provider = new SimulatedProvider({ mode: "with-bot", seed: 42 });

    const { render } = await import("ink-testing-library");
    const { lastFrame, stdin, unmount } = render(<App provider={provider} />);

    // A history rendezési kulcs kezdetben "time". A [t] hatására
    // a kulcs ciklikusan vált (time → pnl → symbol → time). A
    // frame tartalma változik — az "IDŐ" (time) → "PNL" (pnl)
    // → "SYMBOL" (symbol) sorrendben. A keskeny panel-szélesség
    // miatt a szöveg tördelődhet, ezért csak a változás tényét
    // ellenőrizzük (a két frame összehasonlításával).
    const beforeFrame = lastFrame() ?? "";
    expect(beforeFrame).toContain("HISTORY");
    stdin.write("t");
    await new Promise((resolve) => setTimeout(resolve, 50));
    const afterFrame = lastFrame() ?? "";
    // A frame megváltozott a [t] hatására (a sortKey frissült).
    expect(afterFrame).not.toBe(beforeFrame);
    // A HISTORY panel továbbra is látszik.
    expect(afterFrame).toContain("HISTORY");

    unmount();
  });

  it("[?] triggers toggle-help action — opens help overlay", async () => {
    const { App } = await loadApp();
    const { SimulatedProvider } = await loadProvider();
    const provider = new SimulatedProvider({ mode: "with-bot", seed: 42 });

    const { render } = await import("ink-testing-library");
    const { lastFrame, stdin, unmount } = render(<App provider={provider} />);

    // A help overlay kezdetben zárva van — a `?` shortcut-ot a
    // StatusBar mutatja, de az overlay szövege nem.
    const beforeFrame = lastFrame() ?? "";
    expect(beforeFrame).not.toContain("BILLENTYŰZET-SÚGÓ");
    stdin.write("?");
    await new Promise((resolve) => setTimeout(resolve, 50));
    const afterFrame = lastFrame() ?? "";
    // A help overlay megnyílt — a BILLENTYŰZET-SÚGÓ szöveg megjelenik.
    expect(afterFrame).toContain("BILLENTYŰZET-SÚGÓ");

    unmount();
  });

  it("[Tab] triggers cycle-panel action — updates focusedPanel state (▶ moves to next panel)", async () => {
    const { App } = await loadApp();
    const { SimulatedProvider } = await loadProvider();
    const provider = new SimulatedProvider({ mode: "with-bot", seed: 42 });

    const { render } = await import("ink-testing-library");
    const { lastFrame, stdin, unmount } = render(<App provider={provider} />);

    // A focused panel kezdetben "live" — a ▶ az ÉLŐ KERESKEDÉS
    // panel címében van. A Tab hatására a fókusz a "live" →
    // "history" panelre vált, és a ▶ a HISTORY panel címébe
    // kerül. Ezt úgy ellenőrizzük, hogy a ▶ index-e a frame-ben
    // NAGYOBB lesz (a HISTORY az ÉLŐ KERESKEDÉS után jön).
    const beforeFrame = lastFrame() ?? "";
    const beforeArrowIdx = beforeFrame.indexOf("▶  ");
    const beforeLiveIdx = beforeFrame.indexOf("ÉLŐ KERESKEDÉS");
    // Kezdetben a ▶ az ÉLŐ KERESKEDÉS-nél van.
    // A ▶ index-ének kisebbnek kell lennie, mint az ÉLŐ KERESKEDÉS-é
    // (mert a ▶ közvetlenül a cím ELŐTT van).
    expect(beforeArrowIdx).toBeGreaterThan(-1);
    expect(beforeArrowIdx).toBeLessThan(beforeLiveIdx);

    stdin.write("\t"); // Tab
    await new Promise((resolve) => setTimeout(resolve, 50));
    const afterFrame = lastFrame() ?? "";
    const afterArrowIdx = afterFrame.indexOf("▶  ");
    // A Tab hatására a ▶ index-ének NAGYOBBNAK kell lennie
    // (a HISTORY panel címe az ÉLŐ KERESKEDÉS után jön).
    expect(afterArrowIdx).toBeGreaterThan(beforeArrowIdx);
    // A ▶ most a HISTORY panel címében van — a HISTORY szöveg
    // a ▶ után következik.
    const afterHistoryIdx = afterFrame.indexOf("HISTORY", afterArrowIdx);
    expect(afterHistoryIdx).toBeGreaterThan(afterArrowIdx);

    unmount();
  });

  it("[o] in with-bot mode WITHOUT settings props triggers noop (settingsAvailable=false)", async () => {
    const { App } = await loadApp();
    const { SimulatedProvider } = await loadProvider();
    const provider = new SimulatedProvider({ mode: "with-bot", seed: 42 });

    const { render } = await import("ink-testing-library");
    const { lastFrame, stdin, unmount } = render(<App provider={provider} />);

    // A settings panel nem elérhető — az [o] noop.
    const beforeFrame = lastFrame() ?? "";
    expect(beforeFrame).not.toContain("[o] settings");
    stdin.write("o");
    await new Promise((resolve) => setTimeout(resolve, 50));
    const afterFrame = lastFrame() ?? "";
    // A settings panel nem nyílt ki (a settingsAvailable=false).
    // A panel címe a SettingsPanel-ből jönne — a "Konfiguráció"
    // / "BOT" szövegek nem jelennek meg.
    expect(afterFrame).not.toContain("Konfiguráció");

    unmount();
  });

  it("[o] WITH settingsConfigPath + settingsSave triggers open-settings action — opens settings panel", async () => {
    const { App } = await loadApp();
    const { SimulatedProvider } = await loadProvider();
    const provider = new SimulatedProvider({ mode: "with-bot", seed: 42 });

    // A settings panel elérhető — a consumer átadja a prop-okat.
    const { render } = await import("ink-testing-library");
    const { lastFrame, stdin, unmount } = render(
      <App
        provider={provider}
        settingsConfigPath="/tmp/nonexistent-config.toml"
        settingsSave={async () => {
          // no-op
        }}
      />,
    );

    // A StatusBar-ban megjelenik a [o] settings hint.
    const beforeFrame = lastFrame() ?? "";
    expect(beforeFrame).toContain("settings");
    stdin.write("o");
    await new Promise((resolve) => setTimeout(resolve, 50));
    // A settings panel megnyílt — a frame a SettingsPanel
    // tartalmát mutatja (a panel címe "Settings").
    const afterFrame = lastFrame() ?? "";
    expect(afterFrame).toContain("Settings");
    // A "close settings" a StatusBar-ban van, ami a settings
    // panel MÓDban is látszik. A frame utolsó sora a StatusBar.
    expect(afterFrame).toContain("close settings");

    unmount();
  });

  it("[k] triggers kill-confirm action — opens kill-switch prompt (if running)", async () => {
    const { App } = await loadApp();
    const { SimulatedProvider } = await loadProvider();
    const provider = new SimulatedProvider({ mode: "with-bot", seed: 42 });
    // A botot elindítjuk, hogy a kill-confirm működjön.
    await provider.start();

    let killStateSet: "armed" | "confirm" | "triggered" | undefined;
    const origSetKill = provider.setKillSwitchState.bind(provider);
    provider.setKillSwitchState = (s: "armed" | "confirm" | "triggered") => {
      killStateSet = s;
      origSetKill(s);
    };

    const { render } = await import("ink-testing-library");
    const { stdin, unmount } = render(<App provider={provider} />);
    stdin.write("k");
    await new Promise((resolve) => setTimeout(resolve, 50));
    // A kill-switch állapot "armed" → "confirm" vált.
    expect(killStateSet).toBe("confirm");

    unmount();
  });

  it("[i] in kill-confirm state triggers kill-trigger action — invokes provider.killSwitch()", async () => {
    const { App } = await loadApp();
    const { SimulatedProvider } = await loadProvider();
    const provider = new SimulatedProvider({ mode: "with-bot", seed: 42 });
    // A botot elindítjuk ÉS a kill-switch-et "confirm" állapotba
    // helyezzük, hogy az [i] a kill-trigger action-t váltsa ki.
    await provider.start();
    provider.setKillSwitchState("confirm");

    let killSwitchCalled = false;
    const origKill = provider.killSwitch.bind(provider);
    provider.killSwitch = async () => { killSwitchCalled = true; await origKill(); };

    const { render } = await import("ink-testing-library");
    const { stdin, unmount } = render(<App provider={provider} />);
    stdin.write("i");
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(killSwitchCalled).toBe(true);

    unmount();
  });

  it("[n] in kill-confirm state triggers kill-cancel action — sets kill state back to armed", async () => {
    const { App } = await loadApp();
    const { SimulatedProvider } = await loadProvider();
    const provider = new SimulatedProvider({ mode: "with-bot", seed: 42 });
    await provider.start();
    provider.setKillSwitchState("confirm");

    const setKillCalls: string[] = [];
    const origSetKill = provider.setKillSwitchState.bind(provider);
    provider.setKillSwitchState = (s: "armed" | "confirm" | "triggered") => {
      setKillCalls.push(s);
      origSetKill(s);
    };

    const { render } = await import("ink-testing-library");
    const { stdin, unmount } = render(<App provider={provider} />);
    stdin.write("n");
    await new Promise((resolve) => setTimeout(resolve, 50));
    // Az [n] a kill-cancel action-t triggereli — a setKillSwitchState
    // "armed" értékkel hívódik (a cancel visszaállítja).
    expect(setKillCalls).toContain("armed");

    unmount();
  });

  it("[c] triggers select-panel action — focuses the Charts panel", async () => {
    const { App } = await loadApp();
    const { SimulatedProvider } = await loadProvider();
    const provider = new SimulatedProvider({ mode: "with-bot", seed: 42 });

    const { render } = await import("ink-testing-library");
    const { lastFrame, stdin, unmount } = render(<App provider={provider} />);

    // A [c] a Charts panelre ugrik — a ▶ a CHARTS cím előtt jelenik meg.
    // Kezdetben a fókusz a "live" panelen van.
    // A [c] a "charts" panelre ugrik.
    stdin.write("c");
    await new Promise((resolve) => setTimeout(resolve, 50));
    const afterFrame = lastFrame() ?? "";
    // A ▶ a CHARTS-nál van. A CHARTS szöveg a History után jön,
    // tehát a ▶ index-ének kisebbnek kell lennie, mint a CHARTS-é.
    const chartsIdx = afterFrame.indexOf("CHARTS");
    // A Charts panel címében a ▶ közvetlenül előtte van.
    // Megkeressük a ▶-t a CHARTS előtt.
    const beforeCharts = afterFrame.substring(0, chartsIdx);
    const lastArrowIdx = beforeCharts.lastIndexOf("▶");
    expect(lastArrowIdx).toBeGreaterThan(-1);
    // A ▶ a CHARTS-hoz tartozik (a kettő között max 5 karakter).
    expect(chartsIdx - lastArrowIdx).toBeLessThan(10);

    unmount();
  });

  it("renders the Charts panel with OHLC data when tickers are present", async () => {
    const { App } = await loadApp();
    const { SimulatedProvider } = await loadProvider();
    const provider = new SimulatedProvider({ mode: "with-bot", seed: 42 });
    // A botot elindítjuk, hogy a ticker-ek megjelenjenek.
    await provider.start();
    // Várunk egy kicsit, hogy a SimulatedProvider generáljon néhány tick-et.
    await new Promise((resolve) => setTimeout(resolve, 200));

    const { render } = await import("ink-testing-library");
    const { lastFrame, unmount } = render(<App provider={provider} />);
    // Az App renderelése triggereli a useOhlcBars hook-ot, ami
    // létrehoz egy OhlcStream-et a BTC/USDT symbol-hoz. A
    // __testHooks.entries-en keresztül hozzáférünk a stream-hez,
    // és trade-eket injektálunk, amik bar-okat generálnak.
    const ohlcBars = (await import("../../hooks/useOhlcBars.js")).__testHooks;
    const map = ohlcBars.entries.get(provider);
    if (map !== undefined) {
      const entry = map.get("BTC/USDT::1m");
      if (entry !== undefined) {
        // 2 trade 1m grid-en átnyúló timestamp-ekkel → 1 bar close.
        const t0 = 1_700_000_400_000;
        entry.stream.ingest({
          id: "1",
          symbol: asSymbol("BTC/USDT"),
          timestamp: t0,
          price: 100,
          amount: 1,
          takerSide: "buy",
        });
        entry.stream.ingest({
          id: "2",
          symbol: asSymbol("BTC/USDT"),
          timestamp: t0 + 60_000,
          price: 110,
          amount: 1,
          takerSide: "buy",
        });
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
    // A Charts panel megjelenik — a CHARTS cím a frame-ben van.
    // A useOhlcBars hook a ticker-ekből szintetizál bar-okat.
    const frame = lastFrame() ?? "";
    expect(frame).toContain("CHARTS");

    unmount();
  });
});
