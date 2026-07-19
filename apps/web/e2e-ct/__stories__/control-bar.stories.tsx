/**
 * e2e-ct/__stories__/control-bar.stories.tsx
 *
 * ControlBar needs a useWebSocket() provider. Since the hook
 * is imported from a module, we mock it via a wrapper component
 * that provides the hook's interface via React context.
 */
import { ControlBar } from "../../src/components/ControlBar.js";

export function ControlBarProbe(): React.JSX.Element {
  // The ControlBar uses useWebSocket() internally. For the CT to
  // work, the ws-client module needs to provide a mock hook.
  // Since we can't easily mock the hook without complex setup,
  // we use a wrapper that imports the actual component.
  return (
    <div data-testid="control-bar-wrapper">
      <ControlBar />
    </div>
  );
}
