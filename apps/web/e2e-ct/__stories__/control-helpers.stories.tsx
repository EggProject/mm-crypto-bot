/**
 * e2e-ct/__stories__/control-helpers.stories.tsx
 *
 * Playwright CT requires "test stories" — components must be defined
 * in a stories file (not inline in the test). This file exposes
 * the `ControlHelpersProbe` component for the CT runner.
 */
import { confirmKill } from "../../src/components/control-helpers.js";

export function ControlHelpersProbe(): React.JSX.Element {
  const trueWin = { confirm: () => true } as unknown as Window;
  const falseWin = { confirm: () => false } as unknown as Window;
  return (
    <div
      data-confirm-kill-true={String(confirmKill(trueWin))}
      data-confirm-kill-false={String(confirmKill(falseWin))}
    />
  );
}
