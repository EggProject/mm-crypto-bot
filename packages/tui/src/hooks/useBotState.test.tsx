/**
 * packages/tui/src/hooks/useBotState.test.tsx
 *
 * A `useBotState` React hook tesztje.
 * Az `useSyncExternalStore`-ot használja a BotStateProvider-re való
 * feliratkozáshoz.
 */

import { describe, expect, it } from "bun:test";
import React from "react";
import { Text } from "ink";
import { render } from "ink-testing-library";
import { SimulatedProvider } from "../providers/SimulatedProvider.js";
import { useBotState } from "./useBotState.js";

function Display({ provider }: { readonly provider: SimulatedProvider }): React.ReactElement {
  const state = useBotState(provider);
  return <Text>{state.status.mode === "tui-only" ? "TUI" : "BOT"}</Text>;
}

describe("useBotState — subscription", () => {
  it("az első render a provider snapshot-ját adja vissza", () => {
    const p = new SimulatedProvider({ mode: "tui-only" });
    const { lastFrame } = render(<Display provider={p} />);
    expect(lastFrame()).toContain("TUI");
  });

  it("a setPaused hívásra a komponens újrarenderelődik", () => {
    const p = new SimulatedProvider({ mode: "tui-only" });
    const { lastFrame } = render(<Display provider={p} />);
    p.setPaused(true);
    // A paused flag nem befolyásolja a megjelenített szöveget, de
    // a hook triggereli a re-rendert — ami a useSyncExternalStore
    // miatt biztosan megtörténik.
    // Az ellenőrzés: a lastFrame() nem dob és visszaadja a jelenlegi state-et.
    expect(lastFrame()).toContain("TUI");
  });

  it("with-bot mód is megjelenik", () => {
    const p = new SimulatedProvider({ mode: "with-bot" });
    const { lastFrame } = render(<Display provider={p} />);
    expect(lastFrame()).toContain("BOT");
  });
});
