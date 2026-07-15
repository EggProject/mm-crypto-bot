// packages/tui/src/app-logic.ts — az App komponens tiszta logikája
//
// A Phase 41 user mandate: 100% OWN coverage minden módosított
// fájlon. Az `App` komponens useInput kezelője rengeteg ágat
// tartalmaz (Tab / ← / → / s / p / k / r / t / ? / o / c /
// Ctrl+C / q), ÉS minden ág state-módosítást végez. Ahhoz,
// hogy az `App` 100%-os lefedettséget kapjon, a tiszta logikát
// (panel-ciklus, rendezés, keybind-dispatcher) kiemeljük
// különálló, könnyen tesztelhető függvényekbe.
//
// Az `App` komponens ezeket a függvényeket hívja — a saját
// useInput callback-jában a dispatcher eredményét használja a
// state-módosításokhoz.

import type { FocusedPanel, HistorySortKey } from "./types.js";

/**
 * `cyclePanel` — a panel-fókusz ciklikus váltása.
 *
 * A 4-panel ciklus (statistics ↔ live ↔ history ↔ charts)
 * sorrendje Tab-bal: statistics → live → history → charts → statistics.
 * Fordítva (Shift+Tab-bal / balra nyíllal):
 * statistics → charts → history → live → statistics.
 *
 * Ez a TISZTA függvény csak a `(current, direction)` → `next`
 * leképezést végzi — nincs state-módosítás, nincs side-effect.
 * Az `App` a useState setter-t hívja a visszatérési értékkel.
 */
export function cyclePanel(
  current: FocusedPanel,
  direction: 1 | -1,
): FocusedPanel {
  if (current === "statistics") return direction === 1 ? "live" : "charts";
  if (current === "live") return direction === 1 ? "history" : "statistics";
  if (current === "history") return direction === 1 ? "charts" : "live";
  // current === "charts"
  return direction === 1 ? "statistics" : "history";
}

/**
 * `cycleSortKey` — a history rendezési kulcs ciklikus váltása.
 *
 * A `time` → `pnl` → `symbol` → `time` ciklus. Tiszta függvény:
 * nincs state-módosítás, csak a `(current)` → `next` leképezés.
 */
export function cycleSortKey(current: HistorySortKey): HistorySortKey {
  if (current === "time") return "pnl";
  if (current === "pnl") return "symbol";
  return "time";
}

/**
 * `KeybindAction` — a keybind-dispatcher eredménye.
 *
 * A `useInput` callback minden egyes billentyű-leütéskor meghívja
 * a dispatchert, ami megadja, hogy MIT kell tennie az App-nak.
 * Az enum formátumú visszatérési érték segít a tesztelésben is:
 * a tesztek a `keybindAction(input, key, ctx)` hívással ellenőrzik,
 * hogy az adott billentyű a várt action-t adja-e vissza.
 */
export type KeybindAction =
  | { readonly type: "quit" }
  | { readonly type: "toggle-help" }
  | { readonly type: "close-help" }
  | { readonly type: "start-stop" }
  | { readonly type: "pause" }
  | { readonly type: "kill-confirm" }
  | { readonly type: "kill-trigger" }
  | { readonly type: "kill-cancel" }
  | { readonly type: "refresh" }
  | { readonly type: "cycle-sort" }
  | { readonly type: "open-settings" }
  | { readonly type: "select-panel"; readonly panel: FocusedPanel }
  | { readonly type: "cycle-panel"; readonly direction: 1 | -1 }
  | { readonly type: "noop" };

/**
 * `KeybindContext` — a keybind-dispatcher kontextusában szükséges
 * state-flag-ek. Az `App` a saját useState-iből állítja össze.
 */
export interface KeybindContext {
  readonly helpVisible: boolean;
  readonly killSwitch: "armed" | "confirm" | "triggered";
  readonly isTuiOnly: boolean;
  readonly settingsAvailable: boolean;
  readonly settingsOpen: boolean;
}

/**
 * `keybindAction` — a billentyű-leütés → action leképezés.
 *
 * Tiszta függvény: `(input, key, ctx)` → `KeybindAction`. Az
 * `App` a useInput callback-jában ezt hívja, és a kapott
 * action alapján végzi el a state-módosítást (a useState
 * setter-eken és a provider metódusain keresztül).
 *
 * A dispatcher a billentyű-leütés teljes kontextusát figyelembe
 * veszi:
 *   - `helpVisible=true` esetén csak a help-bezáró billentyűk
 *     hatnak (a többi "noop").
 *   - `killSwitch="confirm"` esetén csak a megerősítő / elvető
 *     billentyűk hatnak.
 *   - TUI-only módban az `s` / `p` / `k` hatástalanok.
 *   - Settings módban (`settingsOpen=true`) az `o` hatástalan
 *     (a panel már nyitva van).
 *
 * A Phase 41 fix: az Ink `useInput` a nem-nyomtatható billentyűk
 * (Escape, Tab, nyilak) esetén a `key.escape` / `key.tab` /
 * `key.leftArrow` / `key.rightArrow` flag-eket állítja be, és
 * az `input` üres string. A korábbi kód az `input === "escape"`
 * formát használta, ami sosem volt igaz — a [Esc] billentyű
 * nem működött. A javítás: a `key.escape` flag-et ellenőrizzük.
 */
export function keybindAction(
  input: string,
  key: {
    readonly ctrl?: boolean;
    readonly tab?: boolean;
    readonly escape?: boolean;
    readonly leftArrow?: boolean;
    readonly rightArrow?: boolean;
  },
  ctx: KeybindContext,
): KeybindAction {
  // Help overlay nyitva: csak a help-bezáró billentyűk hatnak.
  if (ctx.helpVisible) {
    if (input === "?" || key.escape === true || input === "q") {
      return { type: "close-help" };
    }
    return { type: "noop" };
  }

  // Kill-switch confirm prompt: csak a megerősítő / elvető
  // billentyűk hatnak.
  if (ctx.killSwitch === "confirm") {
    if (input === "i" || input === "y") {
      return { type: "kill-trigger" };
    }
    if (input === "n" || input === "q" || key.escape === true) {
      return { type: "kill-cancel" };
    }
    return { type: "noop" };
  }

  // Ctrl+C: kilépés (graceful teardown).
  if (key.ctrl === true && input === "c") {
    return { type: "quit" };
  }

  // [q] kilépés.
  if (input === "q") {
    return { type: "quit" };
  }

  // [s] start/stop — CSAK with-bot módban (TUI-only módban nincs bot).
  if (!ctx.isTuiOnly && input === "s") {
    return { type: "start-stop" };
  }

  // [p] pause/resume — CSAK with-bot módban.
  if (!ctx.isTuiOnly && input === "p") {
    return { type: "pause" };
  }

  // [k] kill-switch confirm prompt megnyitása.
  if (input === "k") {
    return { type: "kill-confirm" };
  }

  // [r] manuális frissítés.
  if (input === "r") {
    return { type: "refresh" };
  }

  // [t] history rendezési kulcs ciklikus váltása.
  if (input === "t") {
    return { type: "cycle-sort" };
  }

  // [?] help overlay toggle.
  if (input === "?") {
    return { type: "toggle-help" };
  }

  // [o] settings panel megnyitása (CSAK ha elérhető ÉS nincs nyitva).
  if (
    input === "o" &&
    ctx.settingsAvailable &&
    !ctx.settingsOpen
  ) {
    return { type: "open-settings" };
  }

  // [c] Charts panelre ugrás.
  if (input === "c") {
    return { type: "select-panel", panel: "charts" };
  }

  // [Tab] / [→] panel-fókusz váltása előre.
  if (key.tab === true) {
    return { type: "cycle-panel", direction: 1 };
  }
  if (key.rightArrow === true) {
    return { type: "cycle-panel", direction: 1 };
  }

  // [←] panel-fókusz váltása hátra.
  if (key.leftArrow === true) {
    return { type: "cycle-panel", direction: -1 };
  }

  return { type: "noop" };
}
