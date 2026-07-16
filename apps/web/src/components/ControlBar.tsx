import React from "react";
import { useWebSocket } from "../ws-client.js";

/**
 * `ControlBar` — sticky bottom bar with the 4 main control buttons.
 *
 * - Start: dispatches `{type: "control", command: "start"}` — boots the bot
 *   if it isn't already running.
 * - Stop: dispatches `{type: "control", command: "stop"}` — graceful shutdown.
 * - Pause/Resume: dispatches `{type: "control", command: "pause", paused}` —
 *   toggles the bot's internal pause flag (the TUI's "p" key equivalent).
 * - Kill Switch: dispatches `{type: "control", command: "kill_switch"}` —
 *   immediate halt. Requires a typed "KILL" confirmation (mirrors the
 *   deleted TUI's LiveConfirm.tsx flow).
 *
 * The bar is sticky at the bottom of the viewport. The buttons are gold
 * (`--ep-accent`) for the primary action, gray for secondary.
 *
 * Phase 47D: initial implementation. Behavioral tests (click → send) are
 * deferred to Phase 50 when @testing-library/react is added.
 */
export function ControlBar(): React.JSX.Element {
  const { status, send } = useWebSocket();

  const onStart = (): void => {
    send({ type: "control", command: "start" });
  };
  const onStop = (): void => {
    send({ type: "control", command: "stop" });
  };
  const onPause = (): void => {
    send({ type: "control", command: "pause", paused: true });
  };
  const onResume = (): void => {
    send({ type: "control", command: "pause", paused: false });
  };
  const onKillSwitch = (): void => {
    const confirmed = window.confirm(
      "Type KILL to confirm kill-switch. This will halt all open positions and stop the bot immediately.",
    );
    if (confirmed) {
      send({ type: "control", command: "kill_switch" });
    }
  };

  const disabled = status !== "connected";

  return (
    <div className="ep-control-bar">
      <button
        className="ep-control-bar__btn ep-control-bar__btn--primary"
        onClick={onStart}
        disabled={disabled}
        type="button"
      >
        ▶ Start
      </button>
      <button
        className="ep-control-bar__btn"
        onClick={onStop}
        disabled={disabled}
        type="button"
      >
        ■ Stop
      </button>
      <button
        className="ep-control-bar__btn"
        onClick={onPause}
        disabled={disabled}
        type="button"
      >
        ⏸ Pause
      </button>
      <button
        className="ep-control-bar__btn"
        onClick={onResume}
        disabled={disabled}
        type="button"
      >
        ▶ Resume
      </button>
      <button
        className="ep-control-bar__btn ep-control-bar__btn--danger"
        onClick={onKillSwitch}
        disabled={disabled}
        type="button"
      >
        ⛔ Kill Switch
      </button>
    </div>
  );
}
