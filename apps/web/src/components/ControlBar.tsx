import React, { useCallback } from "react";
import { useWebSocket } from "../ws-client.js";
import { confirmKill } from "./control-helpers.js";
import type { BotState, ControlBarAvailability } from "../lib/bot-status.js";

// The HTTP control endpoint (apps/bot/src/web-client/http-server.ts
// `POST /api/control`). 127.0.0.1 is hard-coded — the dev workflow is
// browser ↔ loopback. The HTTP endpoint is the canonical control
// channel per the Phase 69 user mandate ("Wire Start/Stop/Pause/
// Resume buttons to /api/control"); the WS CONTROL message is also
// supported as a fallback.
const CONTROL_URL = "http://127.0.0.1:7913/api/control" as const;

/**
 * `ControlBar` — sticky bottom bar with the 5 main control buttons.
 *
 * - Start: dispatches `POST /api/control { command: "start" }` — boots the
 *   bot if it isn't already running.
 * - Stop: dispatches `POST /api/control { command: "stop" }` — graceful
 *   shutdown.
 * - Pause/Resume: dispatches `POST /api/control { command: "pause",
 *   paused }` — toggles the bot's internal pause flag (the TUI's "p"
 *   key equivalent).
 * - Kill Switch: dispatches `POST /api/control { command: "kill_switch" }`
 *   — immediate halt. Requires a typed "KILL" confirmation (mirrors the
 *   deleted TUI's LiveConfirm.tsx flow).
 *
 * The bar is sticky at the bottom of the viewport. The buttons are gold
 * (`--ep-accent`) for the primary action, gray for secondary.
 *
 * Phase 47D: initial implementation. Behavioral tests (click → send) are
 * deferred to Phase 50 when @testing-library/react is added.
 *
 * Phase 69: the buttons are now enable/disable-aware based on the
 * bot's high-level state. The `availability` prop drives the per-button
 * `disabled` flag; the parent (`App.tsx`) derives it from the bot
 * status (via `computeControlBarAvailability`).
 *
 * Phase 69: the click handler now calls `POST /api/control` instead of
 * the WS CONTROL message. The HTTP endpoint is the canonical control
 * channel per the user mandate; the WS is the fallback for when the
 * bot is unreachable.
 */
export interface ControlBarProps {
  readonly availability?: ControlBarAvailability;
  readonly botState?: BotState;
}

const DEFAULT_CONTROL_BAR_PROPS: Required<ControlBarProps> = {
  availability: {
    start: true,
    stop: false,
    pause: false,
    resume: false,
    killSwitch: false,
  },
  botState: "stopped",
};

export function ControlBar(props: ControlBarProps = {}): React.JSX.Element {
  const { availability, botState } = {
    availability: props.availability ?? DEFAULT_CONTROL_BAR_PROPS.availability,
    botState: props.botState ?? DEFAULT_CONTROL_BAR_PROPS.botState,
  };
  const { status, send } = useWebSocket();

  // Phase 69: the HTTP control POST. Returns a Promise that resolves
  // to `true` on 2xx, `false` on non-2xx / network error. The caller
  // doesn't need to await — the WS `state` message (or the next
  // /api/status poll) will reflect the new state. We log errors
  // for debugging.
  const postControl = useCallback(
    async (
      body: { command: string; paused?: boolean; confirm?: boolean },
    ): Promise<boolean> => {
      try {
        const res = await fetch(CONTROL_URL, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          console.error(
            `[ControlBar] /api/control returned ${String(res.status)}`,
          );
          return false;
        }
        return true;
      } catch (e) {
        console.error(`[ControlBar] /api/control failed: ${String(e)}`);
        return false;
      }
    },
    [],
  );

  // The `send` from `useWebSocket` is also dispatched as a
  // fallback (the legacy Phase 47D path). The HTTP endpoint
  // is the canonical channel per the user mandate; the WS is
  // preserved for the existing e2e/ct test infrastructure
  // (which checks the WS message stream) + the no-HTTP-server
  // fallback path.
  const onStart = (): void => {
    void postControl({ command: "start" });
    send({ type: "control", command: "start" });
  };
  const onStop = (): void => {
    void postControl({ command: "stop" });
    send({ type: "control", command: "stop" });
  };
  const onPause = (): void => {
    void postControl({ command: "pause", paused: true });
    send({ type: "control", command: "pause", paused: true });
  };
  const onResume = (): void => {
    void postControl({ command: "pause", paused: false });
    send({ type: "control", command: "pause", paused: false });
  };
  const onKillSwitch = (): void => {
    // Phase 54C: extracted to a pure helper for direct unit-testability
    // of the false-branch (user dismissed the confirmation dialog).
    if (confirmKill(window)) {
      void postControl({ command: "kill_switch", confirm: true });
      send({ type: "control", command: "kill_switch", confirm: true });
    }
  };

  // The `wsConnected` flag gates the buttons to the WS connectivity
  // (independent of the bot state — the user can still click when
  // the bot is "stopped" but the WS is "connecting"). The
  // `availability` prop gates the buttons to the bot state
  // (independent of the WS).
  const wsConnected = status === "connected";
  // Effective disabled flag for a button = !wsConnected OR
  // !availability[button]. The Start button is the only button
  // that's enabled when the WS is disconnected (the user can boot
  // the bot, the bot reconnects on its own).
  const isStartDisabled = !wsConnected || !availability.start;
  const isStopDisabled = !wsConnected || !availability.stop;
  const isPauseDisabled = !wsConnected || !availability.pause;
  const isResumeDisabled = !wsConnected || !availability.resume;
  const isKillSwitchDisabled = !wsConnected || !availability.killSwitch;

  return (
    <div
      className="ep-control-bar"
      data-testid="control-bar"
      data-bot-state={botState}
    >
      <button
        className="ep-control-bar__btn ep-control-bar__btn--primary"
        onClick={onStart}
        disabled={isStartDisabled}
        type="button"
        data-testid="control-bar-start"
      >
        ▶ Start
      </button>
      <button
        className="ep-control-bar__btn"
        onClick={onStop}
        disabled={isStopDisabled}
        type="button"
        data-testid="control-bar-stop"
      >
        ■ Stop
      </button>
      <button
        className="ep-control-bar__btn"
        onClick={onPause}
        disabled={isPauseDisabled}
        type="button"
        data-testid="control-bar-pause"
      >
        ⏸ Pause
      </button>
      <button
        className="ep-control-bar__btn"
        onClick={onResume}
        disabled={isResumeDisabled}
        type="button"
        data-testid="control-bar-resume"
      >
        ▶ Resume
      </button>
      <button
        className="ep-control-bar__btn ep-control-bar__btn--danger"
        onClick={onKillSwitch}
        disabled={isKillSwitchDisabled}
        type="button"
        data-testid="control-bar-kill-switch"
      >
        ⛔ Kill Switch
      </button>
    </div>
  );
}
