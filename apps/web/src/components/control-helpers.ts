/**
 * apps/web/src/components/control-helpers.ts
 *
 * Phase 54C: pure helpers extracted from ControlBar.tsx for
 * direct unit-testability. These have no React, no DOM event
 * handlers, no `this` — they take a `Window` (or just the
 * `confirm` function) and return the boolean the original
 * inline code would have produced.
 *
 * The original `onKillSwitch` handler did:
 *   const confirmed = window.confirm("...KILL...");
 *   if (confirmed) send({ type: "control", command: "kill_switch" });
 *
 * The branch coverage counter never ticked for the `false` arm
 * because the e2e test pattern (53C-05) drives the click but
 * the 500ms wait + WS message extraction races with the React
 * 19 useEffect ordering, and the second click handler invocation
 * in the harness happens after the assertion window. Extracting
 * `confirmKill` to a pure helper makes the false-branch directly
 * unit-testable without the React/e2e harness.
 */

/**
 * `confirmKill(win)` — shows the kill-switch confirmation dialog
 * and returns the user's choice.
 *
 * Returns `true` only if the user explicitly accepted the
 * confirmation (e.g. typed KILL and pressed OK). Returns `false`
 * if the user dismissed the dialog or hit Cancel.
 *
 * Pure: takes a `Window`-shaped object (only `.confirm` is read),
 * returns a boolean. No side effects beyond the prompt.
 */
export function confirmKill(win: Window): boolean {
  return win.confirm(
    "Type KILL to confirm kill-switch. This will halt all open positions and stop the bot immediately.",
  );
}
