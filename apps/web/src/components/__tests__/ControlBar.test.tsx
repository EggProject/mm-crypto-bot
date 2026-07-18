/**
 * apps/web/src/components/__tests__/ControlBar.test.tsx
 *
 * Phase 55-1: React Testing Library behavioral tests for the
 * ControlBar component. Builds on the structural smoke tests in
 * `apps/web/src/__tests__/ControlBar.test.tsx` (Phase 47D) by
 * driving click events through RTL and asserting the `send()`
 * callback was called with the right CONTROL message.
 *
 * The 5 buttons:
 *   - Start   → { type: "control", command: "start" }
 *   - Stop    → { type: "control", command: "stop" }
 *   - Pause   → { type: "control", command: "pause", paused: true }
 *   - Resume  → { type: "control", command: "pause", paused: false }
 *   - Kill    → { type: "control", command: "kill_switch" }
 *
 * Disabled state: when `status !== "connected"`, all 5 buttons
 * are disabled.
 *
 * Kill switch guard: the button calls `window.confirm(...)` via
 * `confirmKill(window)`. If the user dismisses, `send()` is NOT
 * called. We test both branches by overriding `window.confirm`.
 */

import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

// ---------------------------------------------------------------------------
// Mock the useWebSocket hook. The factory returns a function that reads
// a mutable `mockState` so each test can vary the WS state without
// re-importing the module.
// ---------------------------------------------------------------------------

const sent: unknown[] = [];
let mockStatus: "disconnected" | "connecting" | "connected" | "crashed" =
  "connected";

mock.module("../../ws-client.js", () => ({
  useWebSocket: () => ({
    status: mockStatus,
    snapshot: null,
    lastState: null,
    lastError: null,
    lastTick: null,
    lastBar: null,
    send: (msg: unknown): void => {
      sent.push(msg);
    },
  }),
}));

const { ControlBar } = await import("../ControlBar.js");

beforeEach(() => {
  sent.length = 0;
  mockStatus = "connected";
});

afterEach(() => {
  cleanup();
});

describe("ControlBar (RTL)", () => {
  it("renders a div with className 'ep-control-bar'", () => {
    const { container } = render(<ControlBar />);
    const root = container.querySelector(".ep-control-bar");
    expect(root).not.toBeNull();
  });

  it("renders exactly 5 buttons", () => {
    render(<ControlBar />);
    const buttons = screen.getAllByRole("button");
    expect(buttons.length).toBe(5);
  });

  it("labels the 5 buttons as Start, Stop, Pause, Resume, Kill Switch", () => {
    render(<ControlBar />);
    expect(screen.getByText(/Start/)).not.toBeNull();
    expect(screen.getByText(/Stop/)).not.toBeNull();
    expect(screen.getByText(/Pause/)).not.toBeNull();
    expect(screen.getByText(/Resume/)).not.toBeNull();
    expect(screen.getByText(/Kill Switch/)).not.toBeNull();
  });

  it("marks the Start button as primary (gold) and the Kill button as danger", () => {
    render(<ControlBar />);
    const startBtn = screen.getByText(/Start/).closest("button");
    const killBtn = screen.getByText(/Kill Switch/).closest("button");
    expect(startBtn?.className).toContain("ep-control-bar__btn--primary");
    expect(killBtn?.className).toContain("ep-control-bar__btn--danger");
  });

  it("disables all 5 buttons when status is 'disconnected'", () => {
    mockStatus = "disconnected";
    render(<ControlBar />);
    const buttons = screen.getAllByRole("button");
    for (const b of buttons) {
      expect((b as HTMLButtonElement).disabled).toBe(true);
    }
  });

  it("disables all 5 buttons when status is 'connecting'", () => {
    mockStatus = "connecting";
    render(<ControlBar />);
    const buttons = screen.getAllByRole("button");
    for (const b of buttons) {
      expect((b as HTMLButtonElement).disabled).toBe(true);
    }
  });

  it("disables all 5 buttons when status is 'crashed'", () => {
    mockStatus = "crashed";
    render(<ControlBar />);
    const buttons = screen.getAllByRole("button");
    for (const b of buttons) {
      expect((b as HTMLButtonElement).disabled).toBe(true);
    }
  });

  it("enables all 5 buttons when status is 'connected'", () => {
    render(<ControlBar />);
    const buttons = screen.getAllByRole("button");
    for (const b of buttons) {
      expect((b as HTMLButtonElement).disabled).toBe(false);
    }
  });

  it("clicking Start dispatches { type:'control', command:'start' }", () => {
    render(<ControlBar />);
    const btn = screen.getByText(/Start/).closest("button");
    if (btn === null) throw new Error("Start button not found");
    fireEvent.click(btn);
    expect(sent).toEqual([{ type: "control", command: "start" }]);
  });

  it("clicking Stop dispatches { type:'control', command:'stop' }", () => {
    render(<ControlBar />);
    const btn = screen.getByText(/Stop/).closest("button");
    if (btn === null) throw new Error("Stop button not found");
    fireEvent.click(btn);
    expect(sent).toEqual([{ type: "control", command: "stop" }]);
  });

  it("clicking Pause dispatches { type:'control', command:'pause', paused:true }", () => {
    render(<ControlBar />);
    const btn = screen.getByText(/Pause/).closest("button");
    if (btn === null) throw new Error("Pause button not found");
    fireEvent.click(btn);
    expect(sent).toEqual([
      { type: "control", command: "pause", paused: true },
    ]);
  });

  it("clicking Resume dispatches { type:'control', command:'pause', paused:false }", () => {
    render(<ControlBar />);
    const btn = screen.getByText(/Resume/).closest("button");
    if (btn === null) throw new Error("Resume button not found");
    fireEvent.click(btn);
    expect(sent).toEqual([
      { type: "control", command: "pause", paused: false },
    ]);
  });

  it("clicking Kill Switch with window.confirm=true dispatches kill_switch", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).window.confirm = (): boolean => true;
    render(<ControlBar />);
    const btn = screen.getByText(/Kill Switch/).closest("button");
    if (btn === null) throw new Error("Kill Switch button not found");
    fireEvent.click(btn);
    expect(sent).toEqual([{ type: "control", command: "kill_switch" }]);
  });

  it("clicking Kill Switch with window.confirm=false does NOT dispatch kill_switch (the originally-uncovered branch)", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).window.confirm = (): boolean => false;
    render(<ControlBar />);
    const btn = screen.getByText(/Kill Switch/).closest("button");
    if (btn === null) throw new Error("Kill Switch button not found");
    fireEvent.click(btn);
    expect(sent).toEqual([]);
  });

  it("shows the kill-switch prompt text to the user", () => {
    let promptText = "";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).window.confirm = (msg: string): boolean => {
      promptText = msg;
      return true;
    };
    render(<ControlBar />);
    const btn = screen.getByText(/Kill Switch/).closest("button");
    if (btn === null) throw new Error("Kill Switch button not found");
    fireEvent.click(btn);
    expect(promptText).toContain("KILL");
  });

  it("does not throw when the buttons are clicked rapidly in sequence", () => {
    render(<ControlBar />);
    const startBtn = screen.getByText(/Start/).closest("button");
    const stopBtn = screen.getByText(/Stop/).closest("button");
    if (startBtn === null || stopBtn === null) {
      throw new Error("Buttons not found");
    }
    fireEvent.click(startBtn);
    fireEvent.click(stopBtn);
    fireEvent.click(startBtn);
    expect(sent.length).toBe(3);
    expect(sent[0]).toEqual({ type: "control", command: "start" });
    expect(sent[1]).toEqual({ type: "control", command: "stop" });
    expect(sent[2]).toEqual({ type: "control", command: "start" });
  });
});
