/**
 * packages/tui/src/components/__tests__/responsive-grid-layout.test.tsx
 *
 * ===========================================================================
 * PHASE 41 — RESPONSIVE GRID LAYOUT TESTS
 * ===========================================================================
 *
 * A Phase 41 user mandate: a TUI 4 panelje NE legyen stacked (ahogy
 * a user panaszolta az iTerm2 170 széles ablakában), hanem
 * terminál-szélesség-függő grid layout:
 *
 *   - Wide (≥120 col): 2x2 grid
 *     [Statistics | Live]
 *     [History   | Charts]
 *   - Medium (80-119 col): 2x1 grid — 2 sor, 2 oszlop (mint a 2x2,
 *     csak keskenyebb panel-szélességgel)
 *     [Statistics | Live]
 *     [History   | Charts]
 *   - Narrow (<80 col): 1x4 stacked (fallback)
 *     Statistics
 *     Live
 *     History
 *     Charts
 *
 * A teszt a `useTerminalSize` hook-ot MOCKOLJA (bun:test.mock),
 * hogy a hook a kívánt layout módot adja vissza. Az App ezután
 * a `ResponsiveGrid` komponenst használja a panelek elrendezéséhez.
 *
 * Az ellenőrzés a `lastFrame()` snapshot-ján alapul:
 *
 *   - 2x2 / 2x1 módban: a 4 panel címének (STATISZTIKA, ÉLŐ,
 *     HISTORY, CHARTS) egy vonalon vagy közel kell lenniük
 *     egymáshoz (a 2 oszlop miatt).
 *   - 1x4 módban: a 4 panel címe egymás alatt van (4 külön sorban).
 *
 * A legegyszerűbb jel, hogy a 2x2 módban a panel-ek egymás mellett
 * vannak: a StatisticsPanel + LiveTradingPanel címe UGYANABBAN A
 * SORBAN jelenik meg. Ezt a `\n` karakterek számával + a panel címek
 * relatív pozíciójával ellenőrizzük.
 *
 * ===========================================================================
 */

import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";

// ---------------------------------------------------------------------------
// A `useTerminalSize` hook MOCKOLÁSA a 3 layout módhoz
// ---------------------------------------------------------------------------
//
// A `bun:test.mock` a module-ot cseréli le — a hook 3 különböző
// implementációját hozzuk létre a 3 layout módhoz. A tesztek előtt
// a megfelelő mock-ot töltjük be, a tesztek után visszaállítjuk.

import * as hookModule from "../../hooks/useTerminalSize.js";

const originalResolveLayoutMode = hookModule.resolveLayoutMode;
const originalResolveTerminalSize = hookModule.resolveTerminalSize;
const originalUseTerminalSize = hookModule.useTerminalSize;

function mockUseTerminalSize(layoutMode: "2x2" | "2x1" | "1x4", columns: number): void {
  // A hook egy TerminalSize objektumot ad vissza. A mock a
  // useWindowSize Ink hook-ot nem hívja, hanem egy fix értéket
  // ad vissza. A `resolveTerminalSize` + `resolveLayoutMode` függvényeket
  // is felülírjuk, hogy a hook belső logikája konzisztens maradjon.
  mock.module("../../hooks/useTerminalSize.js", () => ({
    resolveLayoutMode: originalResolveLayoutMode,
    resolveTerminalSize: () => ({ columns, rows: 40, layoutMode }),
    useTerminalSize: () => ({ columns, rows: 40, layoutMode }),
    BREAKPOINTS: hookModule.BREAKPOINTS,
  }));
}

afterEach(() => {
  // A mock-ot visszaállítjuk az eredeti module-re.
  mock.module("../../hooks/useTerminalSize.js", () => ({
    resolveLayoutMode: originalResolveLayoutMode,
    resolveTerminalSize: originalResolveTerminalSize,
    useTerminalSize: originalUseTerminalSize,
    BREAKPOINTS: hookModule.BREAKPOINTS,
  }));
});

// A tesztek `import`jai a mock után futnak le — ezért a `require`-t
// használjuk a dinamikus importáláshoz. Így a mock aktív lesz,
// amikor az `App` importálódik.
async function loadApp() {
  return await import("../../App.js");
}

async function loadProvider() {
  return await import("../../providers/SimulatedProvider.js");
}

// ---------------------------------------------------------------------------
// A 3 layout mód tesztje
// ---------------------------------------------------------------------------

describe("ResponsiveGrid — 2x2 layout (wide terminal, ≥120 col)", () => {
  beforeEach(() => {
    mockUseTerminalSize("2x2", 160);
  });

  it("renders Statistics + Live side-by-side (same row) when 2x2 mode is active", async () => {
    const { App } = await loadApp();
    const { SimulatedProvider } = await loadProvider();
    const provider = new SimulatedProvider({ mode: "with-bot", seed: 42 });

    const { render } = await import("ink-testing-library");
    const { lastFrame } = render(<App provider={provider} />);
    const frame = lastFrame() ?? "";

    // Mind a 4 panel címe megjelenik a frame-ben.
    expect(frame).toContain("STATISZTIKA");
    expect(frame).toContain("ÉLŐ KERESKEDÉS");
    expect(frame).toContain("HISTORY");
    expect(frame).toContain("CHARTS");

    // A 2x2 módban a felső sorban a Statistics + Live címek
    // UGYANABBAN A SORBAN vannak. A két cím közötti substring-ben
    // NEM szabad sortörésnek lennie.
    const statisticsIdx = frame.indexOf("STATISZTIKA");
    const liveIdx = frame.indexOf("ÉLŐ KERESKEDÉS");
    const historyIdx = frame.indexOf("HISTORY");

    const betweenSL = frame.substring(statisticsIdx, liveIdx);
    expect(betweenSL.indexOf("\n")).toBe(-1);

    // A History + Charts címek között sortörés van
    // (a History az alsó sorban van).
    const betweenLH = frame.substring(liveIdx, historyIdx);
    expect(betweenLH.indexOf("\n")).toBeGreaterThan(-1);
  });

  it("renders History + Charts side-by-side (same row) when 2x2 mode is active", async () => {
    const { App } = await loadApp();
    const { SimulatedProvider } = await loadProvider();
    const provider = new SimulatedProvider({ mode: "with-bot", seed: 42 });

    const { render } = await import("ink-testing-library");
    const { lastFrame } = render(<App provider={provider} />);
    const frame = lastFrame() ?? "";

    const historyIdx = frame.indexOf("HISTORY");
    const chartsIdx = frame.indexOf("CHARTS");

    // A History + Charts címek ugyanabban a sorban vannak
    // (a kettő között nincs sortörés).
    const between = frame.substring(historyIdx, chartsIdx);
    expect(between.indexOf("\n")).toBe(-1);
  });
});

describe("ResponsiveGrid — 2x1 layout (medium terminal, 80-119 col)", () => {
  beforeEach(() => {
    mockUseTerminalSize("2x1", 100);
  });

  it("still uses 2-row / 2-column structure (Statistics + Live side-by-side)", async () => {
    const { App } = await loadApp();
    const { SimulatedProvider } = await loadProvider();
    const provider = new SimulatedProvider({ mode: "with-bot", seed: 42 });

    const { render } = await import("ink-testing-library");
    const { lastFrame } = render(<App provider={provider} />);
    const frame = lastFrame() ?? "";

    // A 2x1 módban a 2x2-höz hasonló a struktúra: 2 sor, 2 oszlop.
    expect(frame).toContain("STATISZTIKA");
    expect(frame).toContain("ÉLŐ KERESKEDÉS");
    expect(frame).toContain("HISTORY");
    expect(frame).toContain("CHARTS");

    // A Statistics + Live ugyanabban a sorban.
    const statisticsIdx = frame.indexOf("STATISZTIKA");
    const liveIdx = frame.indexOf("ÉLŐ KERESKEDÉS");
    const betweenSL = frame.substring(statisticsIdx, liveIdx);
    expect(betweenSL.indexOf("\n")).toBe(-1);

    // A History + Charts ugyanabban a sorban.
    const historyIdx = frame.indexOf("HISTORY");
    const chartsIdx = frame.indexOf("CHARTS");
    const betweenHC = frame.substring(historyIdx, chartsIdx);
    expect(betweenHC.indexOf("\n")).toBe(-1);
  });
});

describe("ResponsiveGrid — 1x4 layout (narrow terminal, <80 col fallback)", () => {
  beforeEach(() => {
    mockUseTerminalSize("1x4", 60);
  });

  it("stacks all 4 panels vertically when 1x4 mode is active", async () => {
    const { App } = await loadApp();
    const { SimulatedProvider } = await loadProvider();
    const provider = new SimulatedProvider({ mode: "with-bot", seed: 42 });

    const { render } = await import("ink-testing-library");
    const { lastFrame } = render(<App provider={provider} />);
    const frame = lastFrame() ?? "";

    // Mind a 4 panel címe megjelenik.
    expect(frame).toContain("STATISZTIKA");
    expect(frame).toContain("ÉLŐ KERESKEDÉS");
    expect(frame).toContain("HISTORY");
    expect(frame).toContain("CHARTS");

    // Az 1x4 módban a panelek egymás alatt vannak — a címek
    // MINDEN KÖZÖTT van sortörés. A Statistics és a Live
    // között sortörés van.
    const statisticsIdx = frame.indexOf("STATISZTIKA");
    const liveIdx = frame.indexOf("ÉLŐ KERESKEDÉS");
    const betweenSL = frame.substring(statisticsIdx, liveIdx);
    // A Statistics + Live között sortörés van.
    expect(betweenSL.indexOf("\n")).toBeGreaterThan(-1);
  });
});
