/**
 * apps/web/src/components/__tests__/control-helpers.test.ts
 *
 * Phase 54C: unit tests for the pure `confirmKill` helper
 * extracted from `apps/web/src/components/ControlBar.tsx`.
 *
 * Branch coverage: the `if (confirmed) send(...)` line in the
 * original handler had its FALSE branch uncovered because the
 * 53C-05 e2e test's 500ms wait races with the React 19 useEffect
 * ordering. By extracting the boolean to a pure helper, the
 * FALSE branch is now directly unit-testable.
 */

import { describe, expect, it } from "bun:test";
import { confirmKill } from "../control-helpers.js";

/** Minimal Window stub — only `.confirm` is exercised. */
function makeWindow(returns: boolean): Window {
  return {
    confirm: (_msg: string): boolean => returns,
  } as unknown as Window;
}

/** Window stub that captures the prompt text for assertion. */
function makeCapturingWindow(): {
  readonly win: Window;
  readonly getLastPrompt: () => string;
} {
  let last = "";
  const win = {
    confirm: (msg: string): boolean => {
      last = msg;
      return true;
    },
  } as unknown as Window;
  return { win, getLastPrompt: (): string => last };
}

describe("confirmKill", () => {
  it("returns true when window.confirm returns true", () => {
    expect(confirmKill(makeWindow(true))).toBe(true);
  });

  it("returns false when window.confirm returns false (the originally-uncovered branch)", () => {
    expect(confirmKill(makeWindow(false))).toBe(false);
  });

  it("uses the exact kill-switch prompt string from the original TUI", () => {
    const { win, getLastPrompt } = makeCapturingWindow();
    confirmKill(win);
    const prompt = getLastPrompt();
    // The prompt must mention KILL and the destructive intent.
    expect(prompt).toContain("KILL");
    expect(prompt).toContain("kill-switch");
    expect(prompt.toLowerCase()).toContain("halt");
  });

  it("does not throw when confirm is called with a falsy return", () => {
    expect(() => confirmKill(makeWindow(false))).not.toThrow();
  });
});
