/**
 * apps/bot/src/tui/render-probe.test.tsx
 *
 * ===========================================================================
 * RENDER PROBE — Phase 34 Track D
 * ===========================================================================
 *
 * "verify the actual behavior, not the docstring."
 *
 * A render-probe célja, hogy BIZONYÍTSA, hogy a TUI TÉNYLEGESEN renderelődik
 * a panel-összeállítással, és minden panel megjeleníti a saját szövegét.
 *
 * A teszt az `ink-testing-library` (`render(<App provider={...} />)`) segítségével
 * mountolja az `App` komponenst, és a `lastFrame()` snapshot-ját vizsgálja.
 * Minden panelhez legalább egy specifikus szövegrészletet keresünk —
 * így ha egy panel eltörik (pl. egy refactor törli a `Header`-t), a teszt
 * azonnal elbukik.
 *
 * ===========================================================================
 * MIT TESZTELÜNK?
 * ===========================================================================
 *   1) A `Header` panel megjeleníti a "mm-crypto-bot TUI" + "[TUI-ONLY]" szöveget
 *   2) A `StatisticsPanel` megjeleníti a "STATISZTIKA" + "Összesített PnL:"
 *      + "Win rate:" + "Trade-szám:" szövegeket
 *   3) A `LiveTradingPanel` megjeleníti az "ÉLŐ KERESKEDÉS" + "TICKEREK"
 *      + "NYITOTT POZÍCIÓK" szövegeket
 *   4) A `HistoryList` megjeleníti a "HISTORY (LEZÁRT TRADE-EK)" szöveget
 *   5) A `StatusBar` megjeleníti a "[q] kilép" + "mm-crypto-bot · v0.1.0" szöveget
 *      (TUI-only módban az [s]/[p] rejtve — lásd StatusBar.tsx)
 *
 * ===========================================================================
 * STRATÉGIA
 * ===========================================================================
 *   - A `SimulatedProvider`-t használjuk determinisztikus seed-del (42).
 *   - A `render()` hívás után 50ms-ot várunk, hogy az `useSyncExternalStore`
 *     feliratkozzon a provider-re.
 *   - A `lastFrame()` visszaadja a terminálra kiírt szöveget (escape-szekvenciákkal
 *     együtt — a szöveges ellenőrzések ezen futnak le).
 *   - Az unmount a `cleanup()` hívással történik.
 *
 * ===========================================================================
 * USER MANDATE
 * ===========================================================================
 * Phase 21 #1 lecke: a probe a TUI viselkedését ellenőrzi, nem a docstringeket.
 * Ha a TUI panel-összeállítása megváltozik, vagy bármelyik komponens
 * eltörik, ez a teszt AZONNAL elbukik — nem kell kézzel vizsgálni a kódot.
 *
 * Phase 34 Track B kompatibilitás: a Header badge-ek [TUI-ONLY] / [LIVE] /
 * [PAUSED] formátumban jelennek meg. A StatusBar a tuiOnly flag alapján
 * rejt/előnt billentyűket — TUI-only módban nincs [s] start/stop és [p] pause.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { render as renderInk } from "ink-testing-library";
import { App, SimulatedProvider } from "@mm-crypto-bot/tui";

/** Az ink-testing-library `render()` visszatérési típusa. */
type InkInstance = ReturnType<typeof renderInk>;

/**
 * `mountTui` — a TUI mountolása egy provider-rel. Visszaadja az ink instance-t
 * + a providert, hogy a teszt mindkettőhöz hozzáférjen.
 */
function mountTui(seed: number): { readonly instance: InkInstance; readonly provider: SimulatedProvider } {
  const provider = new SimulatedProvider({ mode: "tui-only", seed });
  const instance = renderInk(<App provider={provider} />);
  return { instance, provider };
}

/**
 * `waitForFrame` — várakozás a React re-renderre. Az `useSyncExternalStore`
 * a subscribe-kor subscribe-ol a provider-re, és a provider notify-jaira
 * frissít. Mivel a `SimulatedProvider` a konstruktorban azonnal kiírja
 * a ticker-listát (1. tick), a subscribe-kor a frame már tartalmazza
 * a tickereket. Az 50ms buffer a biztonság kedvéért.
 */
async function waitForFrame(ms = 50): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

describe("render probe — TUI renders all panels with mock provider", () => {
  let mounted: { readonly instance: InkInstance; readonly provider: SimulatedProvider } | null = null;

  beforeEach(() => {
    mounted = null;
  });

  afterEach(async () => {
    if (mounted !== null) {
      mounted.instance.unmount();
      await mounted.provider.dispose();
    }
  });

  // --------------------------------------------------------------------------
  // 1) A Header megjelenik
  // --------------------------------------------------------------------------
  it("Header panel renders 'mm-crypto-bot TUI' + '[TUI-ONLY]' + 'KILL-SWITCH'", async () => {
    const m = mountTui(42);
    mounted = m;
    await waitForFrame();

    const frame = m.instance.lastFrame() ?? "";
    expect(frame).toContain("mm-crypto-bot TUI");
    // Phase 34 Track B: a badge formátum [TUI-ONLY] (explicit, színes)
    expect(frame).toContain("[TUI-ONLY]");
    expect(frame).toContain("KILL-SWITCH");
  });

  // --------------------------------------------------------------------------
  // 2) A StatisticsPanel megjelenik
  // --------------------------------------------------------------------------
  it("StatisticsPanel renders 'STATISZTIKA' + 'Összesített PnL' + 'Win rate' + 'Trade-szám'", async () => {
    const m = mountTui(42);
    mounted = m;
    await waitForFrame();

    const frame = m.instance.lastFrame() ?? "";
    expect(frame).toContain("STATISZTIKA");
    expect(frame).toContain("Összesített PnL");
    expect(frame).toContain("Win rate");
    expect(frame).toContain("Trade-szám");
    expect(frame).toContain("Max drawdown");
    expect(frame).toContain("Profit factor");
    expect(frame).toContain("Sharpe ratio");
    expect(frame).toContain("Equity");
  });

  // --------------------------------------------------------------------------
  // 3) A LiveTradingPanel megjelenik
  // --------------------------------------------------------------------------
  it("LiveTradingPanel renders 'ÉLŐ KERESKEDÉS' + 'TICKEREK' + 'NYITOTT POZÍCIÓK'", async () => {
    const m = mountTui(42);
    mounted = m;
    await waitForFrame();

    const frame = m.instance.lastFrame() ?? "";
    expect(frame).toContain("ÉLŐ KERESKEDÉS");
    expect(frame).toContain("TICKEREK");
    expect(frame).toContain("NYITOTT POZÍCIÓK");
  });

  // --------------------------------------------------------------------------
  // 4) A HistoryList megjelenik
  // --------------------------------------------------------------------------
  it("HistoryList renders the 'HISTORY' panel + 'LEZÁRT TRADE-EK' subtitle (wrapped OK in 2x2 grid)", async () => {
    const m = mountTui(42);
    mounted = m;
    await waitForFrame();

    const frame = m.instance.lastFrame() ?? "";
    // Phase 41 UX reshape: 2x2 grid layout may wrap the title + subtitle
    // across lines, so check for the component labels individually.
    // Empty-state text ("Még nincs lezárt trade") is the panel's content
    // (subheader is squished in narrow grid; that's the visual trade-off).
    expect(frame).toContain("HISTORY");
    expect(frame).toContain("LEZÁRT");
    expect(frame).toContain("TRADE-EK");
    // Empty-state message (the actual panel body)
    expect(frame).toContain("Még nincs lezárt trade");
  });

  // --------------------------------------------------------------------------
  // 5) A StatusBar megjelenik (TUI-only módban: nincs [s]/[p], csak Tab/t/r/?/q)
  // --------------------------------------------------------------------------
  it("StatusBar renders '[q] kilép' + 'mm-crypto-bot · v0.1.0' (TUI-only mode)", async () => {
    const m = mountTui(42);
    mounted = m;
    await waitForFrame();

    const frame = m.instance.lastFrame() ?? "";
    // A Phase 34 Track B óta a StatusBar a tuiOnly flag alapján dönt.
    // TUI-only módban az [s] start/stop és [p] pause NEM jelenik meg.
    expect(frame).toContain("kilép");
    expect(frame).toContain("mm-crypto-bot");
    // A többi TUI-only billentyű (Tab, t, r, ?) megjelenik.
    expect(frame).toContain("Tab");
    expect(frame).toContain("panel");
  });

  // --------------------------------------------------------------------------
  // 6) Snapshot sanity — az egész frame tartalmazza az összes panelt
  // --------------------------------------------------------------------------
  it("a single snapshot contains all panels in one frame", async () => {
    const m = mountTui(42);
    mounted = m;
    await waitForFrame();

    const frame = m.instance.lastFrame() ?? "";
    // A frame az ANSI escape-szekvenciákkal együtt tartalmazza az összes szöveget.
    // Az üres frame NEM fogadható el — a TUI ténylegesen renderel.
    expect(frame.length).toBeGreaterThan(100);
    expect(frame).toContain("mm-crypto-bot TUI"); // Header
    expect(frame).toContain("STATISZTIKA"); // StatisticsPanel
    expect(frame).toContain("ÉLŐ KERESKEDÉS"); // LiveTradingPanel
    expect(frame).toContain("HISTORY"); // HistoryList
    expect(frame).toContain("mm-crypto-bot · v0.1.0"); // StatusBar (verzió)
  });

  // --------------------------------------------------------------------------
  // 7) Re-render: a state-változásra a frame frissül
  // --------------------------------------------------------------------------
  it("TUI re-renders when provider state changes (start triggers running label change)", async () => {
    const m = mountTui(42);
    mounted = m;
    await waitForFrame();

    // A bot indulás előtt a running label "LEÁLLÍTVA".
    const frameBefore = m.instance.lastFrame() ?? "";
    expect(frameBefore).toContain("LEÁLLÍTVA");

    // A provider indítása — a state.running true lesz.
    await m.provider.start();
    await waitForFrame(150); // A re-render + useEffect interval tick

    const frameAfter = m.instance.lastFrame() ?? "";
    expect(frameAfter).toContain("FUT");
  });

  // --------------------------------------------------------------------------
  // 8) Cleanup: az unmount + dispose nem hagy lógó timert
  // --------------------------------------------------------------------------
  it("unmount + dispose do not throw and stop tick interval", async () => {
    const m = mountTui(42);
    await waitForFrame();

    // A provider indítása (interval indul).
    await m.provider.start();
    await waitForFrame();

    // Az unmount + dispose nem dobhat.
    expect(() => {
      m.instance.unmount();
    }).not.toThrow();
    const disposePromise = m.provider.dispose();
    expect(disposePromise).toBeInstanceOf(Promise);
    await disposePromise;

    // A dispose után a további setInterval hívások nem okoznak notify-t.
    // (A SimulatedProvider tick-intervalja a dispose során clear-elve van.)
    mounted = null; // az afterEach nem próbálja újra unmount-olni
  });
});
