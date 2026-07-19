/**
 * e2e-ct/__stories__/control-bar.stories.tsx
 *
 * ControlBar Probe components for the Playwright Component Test (CT).
 *
 * **Phase 58.5:** the real `useWebSocket` hook is aliased to a
 * mock via `playwright-ct.config.ts` `ctViteConfig.resolve.alias`.
 * The mock reads the test status from `window.__CT_STATUS__`,
 * which the test sets via `page.addInitScript()` BEFORE mounting
 * the component. This lets each test exercise a different status
 * branch of the ControlBar's `disabled = status !== "connected"`.
 */
import { ControlBar } from "../../src/components/ControlBar.js";

/**
 * Default probe — the real ControlBar with the mock
 * `useWebSocket` returning whatever `window.__CT_STATUS__` is
 * set to (defaults to "connected").
 */
export function ControlBarProbe(): React.JSX.Element {
  return (
    <div data-testid="control-bar-wrapper">
      <ControlBar />
    </div>
  );
}

/**
 * Connected-status probe — explicitly sets status="connected"
 * before mounting. The disabled branch is `status === "connected"`
 * → `disabled = false` → all 5 buttons enabled.
 */
export function ControlBarConnectedProbe(): React.JSX.Element {
  if (typeof window !== "undefined") {
    (window as unknown as { __CT_STATUS__?: string }).__CT_STATUS__ =
      "connected";
  }
  return <ControlBarProbe />;
}

/**
 * Disconnected-status probe — status="disconnected" →
 * `disabled = true` → all 5 buttons disabled.
 */
export function ControlBarDisconnectedProbe(): React.JSX.Element {
  if (typeof window !== "undefined") {
    (window as unknown as { __CT_STATUS__?: string }).__CT_STATUS__ =
      "disconnected";
  }
  return <ControlBarProbe />;
}

/**
 * Connecting-status probe — status="connecting" →
 * `disabled = true` → all 5 buttons disabled.
 */
export function ControlBarConnectingProbe(): React.JSX.Element {
  if (typeof window !== "undefined") {
    (window as unknown as { __CT_STATUS__?: string }).__CT_STATUS__ =
      "connecting";
  }
  return <ControlBarProbe />;
}

/**
 * Crashed-status probe — status="crashed" →
 * `disabled = true` → all 5 buttons disabled.
 */
export function ControlBarCrashedProbe(): React.JSX.Element {
  if (typeof window !== "undefined") {
    (window as unknown as { __CT_STATUS__?: string }).__CT_STATUS__ =
      "crashed";
  }
  return <ControlBarProbe />;
}
