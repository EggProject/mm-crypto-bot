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
 *
 * **Phase 69:** the ControlBar now also takes optional
 * `availability` + `botState` props (driving the per-button
 * enable/disable logic). The probes below omit these props to
 * use the defaults — the `__CT_STATUS__` mock determines
 * whether the WS is "connected" (and thus the buttons are
 * enabled). The new `availability`/`botState` branches are
 * covered by the e2e suite (e2e/69-status-panel.spec.ts).
 */
import { ControlBar } from "../../src/components/ControlBar.js";

/**
 * Default probe — the real ControlBar with the mock
 * `useWebSocket` returning whatever `window.__CT_STATUS__` is
 * set to (defaults to "connected"). Phase 69: the `availability`
 * + `botState` props are set to the "running" state so the
 * default probe exercises the "all buttons enabled" branch
 * (Start disabled, Stop/Pause/Kill enabled). Tests that need
 * a different state use a different probe.
 */
export function ControlBarProbe(): React.JSX.Element {
  return (
    <div data-testid="control-bar-wrapper">
      <ControlBar
        availability={{
          start: false,
          stop: true,
          pause: true,
          resume: false,
          killSwitch: true,
        }}
        botState="running"
      />
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

/**
 * Phase 69: a probe that exercises the `botState="stopped"`
 * branch (Start enabled, others disabled). Used by the
 * "click Start" CT test, which previously assumed the
 * default ControlBarProbe was enough (back when Start was
 * always enabled in the "connected" state).
 */
export function ControlBarStoppedProbe(): React.JSX.Element {
  if (typeof window !== "undefined") {
    (window as unknown as { __CT_STATUS__?: string }).__CT_STATUS__ =
      "connected";
  }
  return (
    <div data-testid="control-bar-wrapper">
      <ControlBar
        availability={{
          start: true,
          stop: false,
          pause: false,
          resume: false,
          killSwitch: false,
        }}
        botState="stopped"
      />
    </div>
  );
}

/**
 * Phase 69: a probe that exercises the `botState="paused"`
 * branch (Resume + Kill Switch enabled, others disabled).
 * Used by the "click Resume" CT test.
 */
export function ControlBarPausedProbe(): React.JSX.Element {
  if (typeof window !== "undefined") {
    (window as unknown as { __CT_STATUS__?: string }).__CT_STATUS__ =
      "connected";
  }
  return (
    <div data-testid="control-bar-wrapper">
      <ControlBar
        availability={{
          start: false,
          stop: false,
          pause: false,
          resume: true,
          killSwitch: true,
        }}
        botState="paused"
      />
    </div>
  );
}
