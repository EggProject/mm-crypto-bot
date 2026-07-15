/**
 * packages/tui/src/components/__tests__/status-bar-settings-hint.test.tsx
 *
 * ===========================================================================
 * PHASE 41 — STATUSBAR SETTINGS HINT TESTS
 * ===========================================================================
 *
 * A Phase 41 kiegészítés: a `StatusBar` kapott két új prop-ot
 * (`settingsAvailable`, `settingsOpen`), amik a settings panel
 * elérhetőségét + nyitott állapotát jelzik. A `[o]` key-hint
 * CSAK akkor jelenik meg, ha `settingsAvailable === true`,
 * ÉS a label a `settingsOpen` alapján változik:
 *   - settingsOpen=false: "settings"
 *   - settingsOpen=true:  "close settings"
 *
 * A backward compatibility megőrzése: az alapértelmezett érték
 * `settingsAvailable=false` — a korábbi fogyasztók (akik nem
 * adták át a settings prop-okat) továbbra is a settings-hint
 * nélküli key-listát látják.
 *
 * ===========================================================================
 */

import { describe, expect, it } from "bun:test";
import { render } from "ink-testing-library";
import { StatusBar } from "../StatusBar.js";

describe("StatusBar — settings discoverability (Phase 41)", () => {
  it("does NOT show [o] hint when settingsAvailable=false (default — backward compat)", () => {
    const { lastFrame } = render(<StatusBar killSwitch="armed" tuiOnly={false} running={true} />);
    const frame = lastFrame() ?? "";
    // A "settings" szó nem jelenik meg — a backward compatibility megőrizve.
    expect(frame).not.toContain("settings");
  });

  it("does NOT show [o] hint when settingsAvailable=false (explicit, even with settingsOpen=true)", () => {
    const { lastFrame } = render(
      <StatusBar
        killSwitch="armed"
        tuiOnly={false}
        running={true}
        settingsAvailable={false}
        settingsOpen={true}
      />,
    );
    const frame = lastFrame() ?? "";
    expect(frame).not.toContain("settings");
  });

  it("shows [o] settings hint when settingsAvailable=true and settingsOpen=false", () => {
    const { lastFrame } = render(
      <StatusBar
        killSwitch="armed"
        tuiOnly={false}
        running={true}
        settingsAvailable={true}
        settingsOpen={false}
      />,
    );
    const frame = lastFrame() ?? "";
    // A "settings" szó megjelenik (a label-ben).
    expect(frame).toContain("settings");
    // A "close settings" NEM jelenik meg (mert a panel zárva van).
    expect(frame).not.toContain("close settings");
  });

  it("shows [o] close settings hint when settingsAvailable=true and settingsOpen=true", () => {
    const { lastFrame } = render(
      <StatusBar
        killSwitch="armed"
        tuiOnly={false}
        running={true}
        settingsAvailable={true}
        settingsOpen={true}
      />,
    );
    const frame = lastFrame() ?? "";
    // A "close settings" szöveg megjelenik — a user lássa, hogy a [o]
    // jelenleg a panelt ZÁRJA be.
    expect(frame).toContain("close settings");
  });

  it("shows [o] hint in TUI-only mode too (settings panel is consumer-agnostic)", () => {
    const { lastFrame } = render(
      <StatusBar
        killSwitch="armed"
        tuiOnly={true}
        running={true}
        settingsAvailable={true}
        settingsOpen={false}
      />,
    );
    const frame = lastFrame() ?? "";
    // A TUI-only módban a settings panel továbbra is elérhető, ha a
    // consumer átadta a prop-okat. A [o] hint megjelenik.
    expect(frame).toContain("settings");
  });

  it("preserves all existing keybinds when settingsAvailable=true (no key removed)", () => {
    const { lastFrame } = render(
      <StatusBar
        killSwitch="armed"
        tuiOnly={false}
        running={true}
        settingsAvailable={true}
        settingsOpen={false}
      />,
    );
    const frame = lastFrame() ?? "";
    // Az összes korábbi key-hint továbbra is megjelenik.
    expect(frame).toContain("s");
    expect(frame).toContain("start");
    expect(frame).toContain("p");
    expect(frame).toContain("pause");
    expect(frame).toContain("k");
    expect(frame).toContain("kill");
    expect(frame).toContain("Tab");
    expect(frame).toContain("t");
    expect(frame).toContain("rendezés");
    expect(frame).toContain("r");
    expect(frame).toContain("frissít");
    expect(frame).toContain("?");
    expect(frame).toContain("help");
    expect(frame).toContain("q");
    expect(frame).toContain("kilép");
    // A settings hint is megjelenik.
    expect(frame).toContain("settings");
  });

  it("does NOT show [o] in tui-only mode when settingsAvailable=false (no change to baseline)", () => {
    const { lastFrame } = render(
      <StatusBar killSwitch="armed" tuiOnly={true} running={true} />,
    );
    const frame = lastFrame() ?? "";
    // A baseline TUI-only + no-settings: semmi settings-szöveg.
    expect(frame).not.toContain("settings");
  });
});
