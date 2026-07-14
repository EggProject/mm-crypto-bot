/**
 * packages/tui/src/components/__tests__/status-bar-keys.test.tsx
 *
 * Phase 36 Track B1: a `<StatusBar>` a `@matthesketh/ink-status-bar`
 * `<StatusBar items={...} />` komponensét használja. A teszt a
 * keybinding-hint-ek megjelenését ellenőrzi minden módban
 * (TUI-only / with-bot, running / stopped).
 *
 * ===========================================================================
 */

import { describe, expect, it } from "bun:test";
import { render } from "ink-testing-library";
import { StatusBar } from "../StatusBar.js";

describe("StatusBar — @matthesketh/ink-status-bar (Phase 36 Track B1)", () => {
  it("renders [q] kilép in with-bot + running mode", () => {
    const { lastFrame } = render(<StatusBar killSwitch="armed" tuiOnly={false} running={true} />);
    const frame = lastFrame() ?? "";
    expect(frame).toContain("q");
    expect(frame).toContain("kilép");
  });

  it("renders [s] start/stop in with-bot + running mode", () => {
    const { lastFrame } = render(<StatusBar killSwitch="armed" tuiOnly={false} running={true} />);
    const frame = lastFrame() ?? "";
    expect(frame).toContain("s");
    expect(frame).toContain("start/stop");
  });

  it("renders [s] ▶ Start in with-bot + stopped mode (Phase 36 Track A1 highlight)", () => {
    const { lastFrame } = render(<StatusBar killSwitch="armed" tuiOnly={false} running={false} />);
    const frame = lastFrame() ?? "";
    expect(frame).toContain("s");
    expect(frame).toContain("Start");
    expect(frame).toContain("▶");
  });

  it("renders [p] pause in with-bot mode", () => {
    const { lastFrame } = render(<StatusBar killSwitch="armed" tuiOnly={false} running={true} />);
    const frame = lastFrame() ?? "";
    expect(frame).toContain("p");
    expect(frame).toContain("pause");
  });

  it("renders [k] kill in with-bot mode", () => {
    const { lastFrame } = render(<StatusBar killSwitch="armed" tuiOnly={false} running={true} />);
    const frame = lastFrame() ?? "";
    expect(frame).toContain("k");
    expect(frame).toContain("kill");
  });

  it("renders [Tab] panel in both modes", () => {
    const { lastFrame: frameWithBot } = render(<StatusBar killSwitch="armed" tuiOnly={false} running={true} />);
    expect(frameWithBot() ?? "").toContain("Tab");
    expect(frameWithBot() ?? "").toContain("panel");
    const { lastFrame: frameTuiOnly } = render(<StatusBar killSwitch="armed" tuiOnly={true} running={true} />);
    expect(frameTuiOnly() ?? "").toContain("Tab");
    expect(frameTuiOnly() ?? "").toContain("panel");
  });

  it("renders [?] help in both modes", () => {
    const { lastFrame: frameWithBot } = render(<StatusBar killSwitch="armed" tuiOnly={false} running={true} />);
    expect(frameWithBot() ?? "").toContain("?");
    expect(frameWithBot() ?? "").toContain("help");
    const { lastFrame: frameTuiOnly } = render(<StatusBar killSwitch="armed" tuiOnly={true} running={true} />);
    expect(frameTuiOnly() ?? "").toContain("?");
    expect(frameTuiOnly() ?? "").toContain("help");
  });

  it("does NOT render [s] / [p] / [k] in tui-only mode (no bot to control)", () => {
    const { lastFrame } = render(<StatusBar killSwitch="armed" tuiOnly={true} running={true} />);
    const frame = lastFrame() ?? "";
    expect(frame).not.toContain("start/stop");
    expect(frame).not.toContain("pause");
    expect(frame).not.toContain("kill");
  });

  it("renders the kill-switch confirmation prompt when killSwitch='confirm'", () => {
    const { lastFrame } = render(<StatusBar killSwitch="confirm" tuiOnly={false} running={true} />);
    const frame = lastFrame() ?? "";
    expect(frame).toContain("VÉSZLEÁLLÍTÁS");
    expect(frame).toContain("igen");
    expect(frame).toContain("nem");
  });

  it("renders 'mm-crypto-bot · v0.1.0' as the version footer", () => {
    const { lastFrame } = render(<StatusBar killSwitch="armed" tuiOnly={false} running={true} />);
    const frame = lastFrame() ?? "";
    expect(frame).toContain("mm-crypto-bot");
    expect(frame).toContain("v0.1.0");
  });
});
