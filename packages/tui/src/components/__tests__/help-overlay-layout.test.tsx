/**
 * packages/tui/src/components/__tests__/help-overlay-layout.test.tsx
 *
 * ===========================================================================
 * PHASE 41 — HELP OVERLAY LAYOUT/EMPTY-STATE TESTS
 * ===========================================================================
 *
 * A Phase 41 kiegészítés: a HelpOverlay mostantól megjeleníti
 *   - az aktuális `LayoutMode`-ot (2x2 / 2x1 / 1x4)
 *   - a layout váltás szabályait (melyik szélesség melyik módot adja)
 *   - a fontosabb empty-state tippeket
 *   - az új `[o]` settings keybindet (ha a settings panel elérhető)
 *   - a `[c]` Charts shortcutot
 *   - az `[Esc]` bezáró billentyűt
 *
 * ===========================================================================
 */

import { describe, expect, it } from "bun:test";
import { render } from "ink-testing-library";
import { HelpOverlay } from "../HelpOverlay.js";

describe("HelpOverlay — Phase 41 layout & empty-state info", () => {
  it("renders the current layout mode label (2x2 GRID)", () => {
    const { lastFrame } = render(
      <HelpOverlay visible={true} tuiOnly={false} layoutMode="2x2" />,
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("LAYOUT");
    expect(frame).toContain("2×2 GRID");
  });

  it("renders the current layout mode label (2x1 GRID)", () => {
    const { lastFrame } = render(
      <HelpOverlay visible={true} tuiOnly={false} layoutMode="2x1" />,
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("2×1 GRID");
  });

  it("renders the current layout mode label (1x4 STACKED)", () => {
    const { lastFrame } = render(
      <HelpOverlay visible={true} tuiOnly={false} layoutMode="1x4" />,
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("1×4 STACKED");
  });

  it("renders layout breakpoint description (≥120 col, 80-119 col, <80 col)", () => {
    const { lastFrame } = render(
      <HelpOverlay visible={true} tuiOnly={false} layoutMode="2x2" />,
    );
    const frame = lastFrame() ?? "";
    // A töréspontok a súgóban is megjelennek.
    expect(frame).toContain("120");
    expect(frame).toContain("80");
  });

  it("renders the EMPTY STATE TIPPEK section with the 3 main tips", () => {
    const { lastFrame } = render(
      <HelpOverlay visible={true} tuiOnly={false} layoutMode="2x2" />,
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("EMPTY STATE TIPPEK");
    expect(frame).toContain("Charts üres");
    expect(frame).toContain("History üres");
    expect(frame).toContain("Live Trading üres");
  });

  it("renders the [o] settings keybind when settingsAvailable=true", () => {
    const { lastFrame } = render(
      <HelpOverlay
        visible={true}
        tuiOnly={false}
        layoutMode="2x2"
        settingsAvailable={true}
      />,
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("[o]");
    expect(frame).toContain("Settings panel");
  });

  it("does NOT render the [o] settings keybind when settingsAvailable=false (default)", () => {
    const { lastFrame } = render(
      <HelpOverlay visible={true} tuiOnly={false} layoutMode="2x2" />,
    );
    const frame = lastFrame() ?? "";
    // A [o] keybind csak akkor jelenik meg, ha a settings panel elérhető.
    // A default `settingsAvailable=false`, így a sor nem jelenik meg.
    expect(frame).not.toContain("Settings panel");
  });

  it("renders the [c] Charts shortcut (Phase 41 explicit)", () => {
    const { lastFrame } = render(
      <HelpOverlay visible={true} tuiOnly={false} layoutMode="2x2" />,
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("[c]");
    expect(frame).toContain("Charts");
  });

  it("renders the [Esc] close keybind", () => {
    const { lastFrame } = render(
      <HelpOverlay visible={true} tuiOnly={false} layoutMode="2x2" />,
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("[Esc]");
  });

  it("does NOT render the layout section when layoutMode is undefined (backward compat)", () => {
    const { lastFrame } = render(
      <HelpOverlay visible={true} tuiOnly={false} />,
    );
    const frame = lastFrame() ?? "";
    // A LAYOUT szakasz csak akkor jelenik meg, ha a layoutMode prop meg van adva.
    expect(frame).not.toContain("LAYOUT (Phase 41)");
  });

  it("still hides [s]/[p] descriptions in TUI-only mode (backward compat)", () => {
    const { lastFrame } = render(
      <HelpOverlay visible={true} tuiOnly={true} layoutMode="2x2" />,
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("TUI-only");
  });

  it("returns null when visible=false (backward compat)", () => {
    const { lastFrame } = render(
      <HelpOverlay visible={false} tuiOnly={false} layoutMode="2x2" />,
    );
    expect(lastFrame()).toBe("");
  });
});
