/**
 * packages/tui/src/components/LiveConfirm.test.tsx
 *
 * Phase 36 Track C2 — `<LiveConfirm>` modal tesztek.
 *
 * A modal a case-sensitive "LIVE" string begépelésével erősíti meg
 * a `bot.mode = "live"` váltást. A tesztek a @inkjs/ui `<TextInput>`
 * onChange / onSubmit callback-jeit szimulálják (instance.stdin.write).
 *
 * Coverage:
 *   1) Render: megjelenik a "⚠ LIVE MODE" cím + a figyelmeztető szöveg
 *   2) "live" (lowercase) begépelése + Enter → onCancel hívódik
 *   3) "Live" (capitalized) begépelése + Enter → onCancel hívódik
 *   4) "LIVE" (uppercase) begépelése + Enter → onConfirm hívódik
 *   5) Esc billentyű → onCancel hívódik (a useInput-on keresztül)
 *   6) A "pending" prop true esetén a submit gomb "..."-ot mutat
 *   7) A LIVE_CONFIRM_TEXT export helyes értéke "LIVE"
 *
 * ===========================================================================
 */

import { describe, expect, it } from "bun:test";
import { render } from "ink-testing-library";

import { LiveConfirm, LIVE_CONFIRM_TEXT } from "./LiveConfirm.js";

describe("LiveConfirm (Phase 36 Track C2)", () => {
  // --------------------------------------------------------------------------
  // 1) Render: megjelenik a "⚠ LIVE MODE" cím + a figyelmeztető szöveg.
  // --------------------------------------------------------------------------
  it("renders the '⚠ LIVE MODE' title and warning text", () => {
    const instance = render(
      <LiveConfirm
        onConfirm={async () => {
          void 0;
        }}
        onCancel={() => {
          void 0;
        }}
      />,
    );
    const frame = instance.lastFrame() ?? "";
    expect(frame).toContain("⚠ LIVE MODE");
    expect(frame).toContain("REAL ORDERS");
    expect(frame).toContain("REAL MONEY");
    expect(frame).toContain("LIVE");
    instance.unmount();
  });

  // --------------------------------------------------------------------------
  // 2) "live" (lowercase) begépelése + Enter → onCancel hívódik
  //    (a "LIVE" case-sensitive — a lowercase nem elfogadható).
  // --------------------------------------------------------------------------
  it("'live' (lowercase) is rejected — onCancel fires", async () => {
    let cancelCalled = false;
    const instance = render(
      <LiveConfirm
        onConfirm={async () => {
          throw new Error("should not be called");
        }}
        onCancel={() => {
          cancelCalled = true;
        }}
      />,
    );
    await new Promise((r) => setTimeout(r, 50));
    instance.stdin.write("live");
    await new Promise((r) => setTimeout(r, 50));
    instance.stdin.write("\r"); // Enter
    await new Promise((r) => setTimeout(r, 50));
    expect(cancelCalled).toBe(true);
    instance.unmount();
  });

  // --------------------------------------------------------------------------
  // 3) "Live" (capitalized) begépelése + Enter → onCancel hívódik.
  // --------------------------------------------------------------------------
  it("'Live' (capitalized) is rejected — onCancel fires", async () => {
    let cancelCalled = false;
    const instance = render(
      <LiveConfirm
        onConfirm={async () => {
          throw new Error("should not be called");
        }}
        onCancel={() => {
          cancelCalled = true;
        }}
      />,
    );
    await new Promise((r) => setTimeout(r, 50));
    instance.stdin.write("Live");
    await new Promise((r) => setTimeout(r, 50));
    instance.stdin.write("\r");
    await new Promise((r) => setTimeout(r, 50));
    expect(cancelCalled).toBe(true);
    instance.unmount();
  });

  // --------------------------------------------------------------------------
  // 4) "LIVE" (uppercase) begépelése + Enter → onConfirm hívódik.
  // --------------------------------------------------------------------------
  it("'LIVE' (uppercase) is accepted — onConfirm fires", async () => {
    let confirmCalled = false;
    const instance = render(
      <LiveConfirm
        onConfirm={async () => {
          confirmCalled = true;
        }}
        onCancel={() => {
          throw new Error("should not be called");
        }}
      />,
    );
    await new Promise((r) => setTimeout(r, 50));
    instance.stdin.write("LIVE");
    await new Promise((r) => setTimeout(r, 50));
    instance.stdin.write("\r");
    await new Promise((r) => setTimeout(r, 50));
    expect(confirmCalled).toBe(true);
    instance.unmount();
  });

  // --------------------------------------------------------------------------
  // 5) Esc billentyű → onCancel hívódik.
  // --------------------------------------------------------------------------
  it("Esc keypress fires onCancel", async () => {
    let cancelCalled = false;
    const instance = render(
      <LiveConfirm
        onConfirm={async () => {
          throw new Error("should not be called");
        }}
        onCancel={() => {
          cancelCalled = true;
        }}
      />,
    );
    await new Promise((r) => setTimeout(r, 50));
    instance.stdin.write("\u001b"); // Esc
    await new Promise((r) => setTimeout(r, 50));
    expect(cancelCalled).toBe(true);
    instance.unmount();
  });

  // --------------------------------------------------------------------------
  // 6) A "pending" prop true esetén a submit gomb "..."-ot mutat.
  // --------------------------------------------------------------------------
  it("shows '...' submit label when pending=true", () => {
    const instance = render(
      <LiveConfirm
        onConfirm={async () => {
          void 0;
        }}
        onCancel={() => {
          void 0;
        }}
        pending
      />,
    );
    const frame = instance.lastFrame() ?? "";
    expect(frame).toContain("...");
    instance.unmount();
  });

  // --------------------------------------------------------------------------
  // 7) A LIVE_CONFIRM_TEXT export helyes értéke.
  // --------------------------------------------------------------------------
  it("LIVE_CONFIRM_TEXT export equals 'LIVE'", () => {
    expect(LIVE_CONFIRM_TEXT).toBe("LIVE");
  });

  // --------------------------------------------------------------------------
  // 8) A submit label "▶ Submit" amikor a user begépelte a "LIVE"-ot.
  // --------------------------------------------------------------------------
  it("shows '▶ Submit' label when user types 'LIVE'", async () => {
    const instance = render(
      <LiveConfirm
        onConfirm={async () => {
          void 0;
        }}
        onCancel={() => {
          void 0;
        }}
      />,
    );
    await new Promise((r) => setTimeout(r, 50));
    instance.stdin.write("LIVE");
    await new Promise((r) => setTimeout(r, 50));
    const frame = instance.lastFrame() ?? "";
    expect(frame).toContain("▶ Submit");
    instance.unmount();
  });

  // --------------------------------------------------------------------------
  // 9) A submit label "  Submit" (üres) amikor a user még nem gépelt.
  // --------------------------------------------------------------------------
  it("shows '  Submit' label (empty) initially", () => {
    const instance = render(
      <LiveConfirm
        onConfirm={async () => {
          void 0;
        }}
        onCancel={() => {
          void 0;
        }}
      />,
    );
    const frame = instance.lastFrame() ?? "";
    expect(frame).toContain("  Submit");
    instance.unmount();
  });
});
