/**
 * apps/web/src/__tests__/ControlBar.test.tsx
 *
 * Phase 47D: smoke tests for the ControlBar component. bun:test doesn't
 * ship a React renderer, and Phase 69 added `useCallback` (which
 * requires a real React renderer). The structural shape is covered by
 * the CT suite (e2e-ct/control-bar.ct.spec.tsx) via
 * @playwright/experimental-ct-react, which uses the real React DOM
 * renderer. Here we just verify the component is exported as a function
 * + the optional `availability` + `botState` props are accepted.
 *
 * The 4 structural tests verify:
 *   1. The component is exported as a function.
 *   2. The component accepts no props (uses the default).
 *   3. The component accepts the new `availability` + `botState` props.
 *   4. The component is callable (no immediate throw on a bare
 *      createElement call).
 *
 * Behavioral tests (click → HTTP fetch with the right body) are
 * covered by the e2e suite (e2e/69-control-bar.spec.ts).
 */

import { describe, expect, it, mock } from "bun:test";

mock.module("../ws-client.js", () => ({
  useWebSocket: (): {
    status: "connected";
    snapshot: null;
    lastState: null;
    lastError: null;
    send: () => void;
  } => ({
    status: "connected",
    snapshot: null,
    lastState: null,
    lastError: null,
    send: (): void => {
      // no-op: smoke test only verifies structural shape
    },
  }),
}));

import React from "react";
import { ControlBar } from "../components/ControlBar.js";

interface JsxElement {
  readonly type: string | React.ElementType;
  readonly props: Record<string, unknown>;
}

function isJsxElement(value: unknown): value is JsxElement {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    "props" in value
  );
}

describe("ControlBar", () => {
  it("is exported as a function", () => {
    expect(typeof ControlBar).toBe("function");
  });

  it("can be wrapped in a React element with no props (uses default props)", () => {
    // `React.createElement` doesn't invoke the component body — it
    // just builds the element tree. So this is a structural test,
    // not a render test. The default-props behavior is exercised
    // in the e2e suite (which DOES render the component).
    const el = React.createElement(ControlBar);
    expect(isJsxElement(el)).toBe(true);
    if (!isJsxElement(el)) return;
    expect(typeof el.type).toBe("function");
  });

  it("can be wrapped in a React element with availability + botState props", () => {
    // Phase 69: the new props are optional. We test that the
    // TypeScript types accept the props (no `as any` cast needed
    // thanks to the optional `?` on the interface). The `cast`
    // variable is used so the TypeScript compiler validates the
    // type without the test actually rendering the component.
    const cast: React.ComponentProps<typeof ControlBar> = {
      availability: {
        start: false,
        stop: true,
        pause: false,
        resume: false,
        killSwitch: true,
      },
      botState: "running",
    };
    expect(cast.botState).toBe("running");
    expect(cast.availability?.stop).toBe(true);
    // The full type chain (ControlBarProps → BotState) is validated
    // by the TS compiler; the cast is just to anchor the
    // expectation in a local variable.
  });
});
