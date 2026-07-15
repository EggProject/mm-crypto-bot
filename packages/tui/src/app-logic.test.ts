/**
 * packages/tui/src/app-logic.test.ts
 *
 * ===========================================================================
 * PHASE 41 — APP PURE LOGIC TESTS
 * ===========================================================================
 *
 * Az `App` komponens useInput kezelője rengeteg ágat tartalmaz,
 * amit nehéz a `ink-testing-library`-vel 100%-osan lefedni (a
 * `useInput` csak valódi keypress-ekre reagál). Hogy a Phase 41
 * "100% OWN coverage minden módosított fájlon" mandate teljesüljön,
 * a tiszta logikát (`cyclePanel`, `cycleSortKey`, `keybindAction`)
 * kiemeltük az `app-logic.ts` modulba, és itt unit-tesztekkel
 * 100%-osan lefedjük.
 *
 * Az `App` komponens ezeket a függvényeket hívja — a tesztek
 * a függvények visszatérési értékét ellenőrzik, nem a React
 * state-változásokat.
 *
 * ===========================================================================
 */

import { describe, expect, it } from "bun:test";
import { cyclePanel, cycleSortKey, keybindAction } from "./app-logic.js";
import type { FocusedPanel, HistorySortKey } from "./types.js";

// ============================================================================
// cyclePanel — panel fókusz ciklikus váltása
// ============================================================================

describe("cyclePanel — Phase 41 (extracted from App)", () => {
  it("cycles forward: statistics → live → history → charts → statistics", () => {
    let panel: FocusedPanel = "statistics";
    panel = cyclePanel(panel, 1);
    expect(panel).toBe("live");
    panel = cyclePanel(panel, 1);
    expect(panel).toBe("history");
    panel = cyclePanel(panel, 1);
    expect(panel).toBe("charts");
    panel = cyclePanel(panel, 1);
    expect(panel).toBe("statistics");
  });

  it("cycles backward: statistics → charts → history → live → statistics", () => {
    let panel: FocusedPanel = "statistics";
    panel = cyclePanel(panel, -1);
    expect(panel).toBe("charts");
    panel = cyclePanel(panel, -1);
    expect(panel).toBe("history");
    panel = cyclePanel(panel, -1);
    expect(panel).toBe("live");
    panel = cyclePanel(panel, -1);
    expect(panel).toBe("statistics");
  });

  it("covers all 4 panel × 2 direction = 8 transition cases (forward)", () => {
    expect(cyclePanel("statistics", 1)).toBe("live");
    expect(cyclePanel("live", 1)).toBe("history");
    expect(cyclePanel("history", 1)).toBe("charts");
    expect(cyclePanel("charts", 1)).toBe("statistics");
  });

  it("covers all 4 panel × 2 direction = 8 transition cases (backward)", () => {
    expect(cyclePanel("statistics", -1)).toBe("charts");
    expect(cyclePanel("charts", -1)).toBe("history");
    expect(cyclePanel("history", -1)).toBe("live");
    expect(cyclePanel("live", -1)).toBe("statistics");
  });
});

// ============================================================================
// cycleSortKey — history rendezési kulcs ciklikus váltása
// ============================================================================

describe("cycleSortKey — Phase 41 (extracted from App)", () => {
  it("cycles: time → pnl → symbol → time", () => {
    let key: HistorySortKey = "time";
    key = cycleSortKey(key);
    expect(key).toBe("pnl");
    key = cycleSortKey(key);
    expect(key).toBe("symbol");
    key = cycleSortKey(key);
    expect(key).toBe("time");
  });

  it("covers all 3 sort key cases", () => {
    expect(cycleSortKey("time")).toBe("pnl");
    expect(cycleSortKey("pnl")).toBe("symbol");
    expect(cycleSortKey("symbol")).toBe("time");
  });
});

// ============================================================================
// keybindAction — billentyű → action dispatcher
// ============================================================================

describe("keybindAction — Phase 41 (extracted from App)", () => {
  // Az alapértelmezett ctx — a "normál" mód (with-bot, no help, no kill-confirm).
  const baseCtx = {
    helpVisible: false,
    killSwitch: "armed" as const,
    isTuiOnly: false,
    settingsAvailable: true,
    settingsOpen: false,
  };
  const emptyKey = {};

  describe("quit action", () => {
    it("[q] triggers 'quit'", () => {
      expect(keybindAction("q", emptyKey, baseCtx).type).toBe("quit");
    });

    it("[Ctrl+C] triggers 'quit'", () => {
      expect(keybindAction("c", { ctrl: true }, baseCtx).type).toBe("quit");
    });
  });

  describe("help overlay", () => {
    it("[?] triggers 'toggle-help' when help is not visible", () => {
      expect(keybindAction("?", emptyKey, baseCtx).type).toBe("toggle-help");
    });

    it("[?] triggers 'close-help' when help IS visible", () => {
      const ctx = { ...baseCtx, helpVisible: true };
      expect(keybindAction("?", emptyKey, ctx).type).toBe("close-help");
    });

    it("[Esc] triggers 'close-help' when help IS visible (via key.escape flag)", () => {
      const ctx = { ...baseCtx, helpVisible: true };
      expect(keybindAction("", { escape: true }, ctx).type).toBe("close-help");
    });

    it("[q] triggers 'close-help' (NOT 'quit') when help IS visible", () => {
      const ctx = { ...baseCtx, helpVisible: true };
      expect(keybindAction("q", emptyKey, ctx).type).toBe("close-help");
    });

    it("any other key triggers 'noop' when help is visible", () => {
      const ctx = { ...baseCtx, helpVisible: true };
      expect(keybindAction("s", emptyKey, ctx).type).toBe("noop");
      expect(keybindAction("x", emptyKey, ctx).type).toBe("noop");
    });
  });

  describe("kill-switch confirm prompt", () => {
    const ctx = { ...baseCtx, killSwitch: "confirm" as const };

    it("[i] triggers 'kill-trigger'", () => {
      expect(keybindAction("i", emptyKey, ctx).type).toBe("kill-trigger");
    });

    it("[y] triggers 'kill-trigger' (alt shortcut)", () => {
      expect(keybindAction("y", emptyKey, ctx).type).toBe("kill-trigger");
    });

    it("[n] triggers 'kill-cancel'", () => {
      expect(keybindAction("n", emptyKey, ctx).type).toBe("kill-cancel");
    });

    it("[q] triggers 'kill-cancel' (NOT 'quit') in confirm prompt", () => {
      expect(keybindAction("q", emptyKey, ctx).type).toBe("kill-cancel");
    });

    it("[Esc] triggers 'kill-cancel' in confirm prompt (via key.escape flag)", () => {
      expect(keybindAction("", { escape: true }, ctx).type).toBe("kill-cancel");
    });

    it("any other key triggers 'noop' in confirm prompt", () => {
      expect(keybindAction("s", emptyKey, ctx).type).toBe("noop");
      expect(keybindAction("x", emptyKey, ctx).type).toBe("noop");
    });
  });

  describe("with-bot mode keybinds", () => {
    it("[s] triggers 'start-stop' in with-bot mode", () => {
      expect(keybindAction("s", emptyKey, baseCtx).type).toBe("start-stop");
    });

    it("[s] triggers 'noop' in TUI-only mode", () => {
      const ctx = { ...baseCtx, isTuiOnly: true };
      expect(keybindAction("s", emptyKey, ctx).type).toBe("noop");
    });

    it("[p] triggers 'pause' in with-bot mode", () => {
      expect(keybindAction("p", emptyKey, baseCtx).type).toBe("pause");
    });

    it("[p] triggers 'noop' in TUI-only mode", () => {
      const ctx = { ...baseCtx, isTuiOnly: true };
      expect(keybindAction("p", emptyKey, ctx).type).toBe("noop");
    });

    it("[k] triggers 'kill-confirm'", () => {
      expect(keybindAction("k", emptyKey, baseCtx).type).toBe("kill-confirm");
    });

    it("[r] triggers 'refresh'", () => {
      expect(keybindAction("r", emptyKey, baseCtx).type).toBe("refresh");
    });

    it("[t] triggers 'cycle-sort'", () => {
      expect(keybindAction("t", emptyKey, baseCtx).type).toBe("cycle-sort");
    });
  });

  describe("settings panel", () => {
    it("[o] triggers 'open-settings' when settingsAvailable=true and settingsOpen=false", () => {
      expect(keybindAction("o", emptyKey, baseCtx).type).toBe("open-settings");
    });

    it("[o] triggers 'noop' when settingsAvailable=false (no consumer prop)", () => {
      const ctx = { ...baseCtx, settingsAvailable: false };
      expect(keybindAction("o", emptyKey, ctx).type).toBe("noop");
    });

    it("[o] triggers 'noop' when settingsOpen=true (already open)", () => {
      const ctx = { ...baseCtx, settingsOpen: true };
      expect(keybindAction("o", emptyKey, ctx).type).toBe("noop");
    });
  });

  describe("panel selection / cycling", () => {
    it("[c] triggers 'select-panel' with panel='charts'", () => {
      const action = keybindAction("c", emptyKey, baseCtx);
      expect(action.type).toBe("select-panel");
      if (action.type === "select-panel") {
        expect(action.panel).toBe("charts");
      }
    });

    it("[Tab] triggers 'cycle-panel' direction=1 (forward)", () => {
      const action = keybindAction("", { tab: true }, baseCtx);
      expect(action.type).toBe("cycle-panel");
      if (action.type === "cycle-panel") {
        expect(action.direction).toBe(1);
      }
    });

    it("[→] triggers 'cycle-panel' direction=1 (forward)", () => {
      const action = keybindAction("", { rightArrow: true }, baseCtx);
      expect(action.type).toBe("cycle-panel");
      if (action.type === "cycle-panel") {
        expect(action.direction).toBe(1);
      }
    });

    it("[←] triggers 'cycle-panel' direction=-1 (backward)", () => {
      const action = keybindAction("", { leftArrow: true }, baseCtx);
      expect(action.type).toBe("cycle-panel");
      if (action.type === "cycle-panel") {
        expect(action.direction).toBe(-1);
      }
    });
  });

  describe("noop fallback", () => {
    it("unknown keys trigger 'noop'", () => {
      expect(keybindAction("x", emptyKey, baseCtx).type).toBe("noop");
      expect(keybindAction("z", emptyKey, baseCtx).type).toBe("noop");
      expect(keybindAction("1", emptyKey, baseCtx).type).toBe("noop");
    });
  });
});
