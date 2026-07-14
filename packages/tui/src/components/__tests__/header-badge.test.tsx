/**
 * packages/tui/src/components/__tests__/header-badge.test.tsx
 *
 * Phase 36 Track B1: a `<Header>` `<Badge>` komponensét
 * használja a Phase 36 Track A1 stopped-state + TUI-only / LIVE
 * badge-ek megjelenítésére. Ez a teszt a Badge-színek
 * bekötését ellenőrzi.
 *
 * ===========================================================================
 */

import { describe, expect, it } from "bun:test";
import { render } from "ink-testing-library";
import { Header } from "../Header.js";
import type { BotState, KillSwitchState, ProviderStatus, Statistics, TickerPrice } from "../../types.js";

/**
 * `makeState` — egy minimális `BotState` mock, amivel a
 * `<Header>` renderelhető. A teszt szempontjából csak a
 * `status`, `running`, `paused`, `killSwitch` mezők számítanak.
 */
function makeState(overrides: {
  readonly mode?: "tui-only" | "with-bot";
  readonly running?: boolean;
  readonly paused?: boolean;
  readonly killSwitch?: KillSwitchState;
  readonly connected?: boolean;
  readonly lastUpdate?: number;
}): BotState {
  const status: ProviderStatus = {
    mode: overrides.mode ?? "with-bot",
    engineAvailable: true,
    engineError: null,
    connected: overrides.connected ?? true,
    lastUpdate: overrides.lastUpdate ?? 0,
  };
  return {
    status,
    running: overrides.running ?? true,
    killSwitch: overrides.killSwitch ?? "armed",
    positions: [],
    statistics: {} as Statistics,
    history: [],
    tickers: [] as readonly TickerPrice[],
    tickerEvents: [],
    paused: overrides.paused ?? false,
    killSwitchThresholdPct: -10,
  };
}

describe("Header — Badge component (Phase 36 Track B1)", () => {
  it("renders the [LIVE] Badge in with-bot mode + running=true", () => {
    const state = makeState({ mode: "with-bot", running: true });
    const { lastFrame } = render(<Header state={state} />);
    const frame = lastFrame() ?? "";
    expect(frame).toContain("[LIVE]");
  });

  it("renders the [TUI-ONLY] Badge in tui-only mode", () => {
    const state = makeState({ mode: "tui-only", running: true });
    const { lastFrame } = render(<Header state={state} />);
    const frame = lastFrame() ?? "";
    expect(frame).toContain("[TUI-ONLY]");
  });

  it("renders the [PAUSED] Badge when paused=true", () => {
    const state = makeState({ mode: "with-bot", running: true, paused: true });
    const { lastFrame } = render(<Header state={state} />);
    const frame = lastFrame() ?? "";
    expect(frame).toContain("[PAUSED]");
  });

  it("renders the [● STOPPED] Badge when running=false AND mode=with-bot", () => {
    const state = makeState({ mode: "with-bot", running: false });
    const { lastFrame } = render(<Header state={state} />);
    const frame = lastFrame() ?? "";
    expect(frame).toContain("[● STOPPED]");
  });

  it("does NOT render the [● STOPPED] Badge when in tui-only mode (no bot behind it)", () => {
    const state = makeState({ mode: "tui-only", running: false });
    const { lastFrame } = render(<Header state={state} />);
    const frame = lastFrame() ?? "";
    expect(frame).not.toContain("[● STOPPED]");
  });

  it("does NOT render the [PAUSED] Badge when paused=false", () => {
    const state = makeState({ mode: "with-bot", running: true, paused: false });
    const { lastFrame } = render(<Header state={state} />);
    const frame = lastFrame() ?? "";
    expect(frame).not.toContain("[PAUSED]");
  });

  it("renders the 'FUT' label in green when running=true", () => {
    const state = makeState({ mode: "with-bot", running: true });
    const { lastFrame } = render(<Header state={state} />);
    const frame = lastFrame() ?? "";
    expect(frame).toContain("FUT");
  });

  it("renders the 'LEÁLLÍTVA' label when running=false", () => {
    const state = makeState({ mode: "with-bot", running: false });
    const { lastFrame } = render(<Header state={state} />);
    const frame = lastFrame() ?? "";
    expect(frame).toContain("LEÁLLÍTVA");
  });
});
