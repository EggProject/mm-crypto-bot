/**
 * apps/web/src/__tests__/ControlBar.test.tsx
 *
 * Phase 47D: smoke tests for the ControlBar component. bun:test doesn't
 * ship a React renderer, so we use `mock.module` to stub `useWebSocket`
 * (which calls real React hooks under the hood) with a plain object
 * return. The component is then safe to call as a regular function and
 * we can inspect the resulting JSX element structurally — the
 * function-shaped tree is a plain object in React 19.
 *
 * Behavioral tests (click handlers → send() with the right CONTROL
 * message) are deferred to Phase 50 when @testing-library/react is
 * added. The 4 structural tests below verify:
 *   1. The component is exported as a function.
 *   2. Calling the component returns a `<div>` with the expected class.
 *   3. The wrapper div contains exactly 5 buttons.
 *   4. The buttons are labelled Start, Stop, Pause, Resume, Kill Switch.
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

import { ControlBar } from "../components/ControlBar.js";

interface JsxElement {
  readonly type: string;
  readonly props: {
    readonly className?: string;
    readonly children?: unknown;
  };
}

function isJsxElement(value: unknown): value is JsxElement {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    "props" in value
  );
}

function getChildrenArray(element: JsxElement): readonly unknown[] {
  const children = element.props.children;
  return Array.isArray(children) ? children : [children];
}

describe("ControlBar", () => {
  it("is exported as a function", () => {
    expect(typeof ControlBar).toBe("function");
  });

  it("returns a div with className 'ep-control-bar'", () => {
    const el = ControlBar();
    expect(isJsxElement(el)).toBe(true);
    if (!isJsxElement(el)) return;
    expect(el.type).toBe("div");
    expect(el.props.className).toContain("ep-control-bar");
  });

  it("contains 5 buttons (start, stop, pause, resume, kill)", () => {
    const el = ControlBar();
    expect(isJsxElement(el)).toBe(true);
    if (!isJsxElement(el)) return;
    const children = getChildrenArray(el);
    const buttons = children.filter(
      (c): c is JsxElement => isJsxElement(c) && c.type === "button",
    );
    expect(buttons.length).toBe(5);
  });

  it("labels the 5 buttons as Start, Stop, Pause, Resume, Kill Switch", () => {
    const el = ControlBar();
    expect(isJsxElement(el)).toBe(true);
    if (!isJsxElement(el)) return;
    const children = getChildrenArray(el);
    const buttons = children.filter(
      (c): c is JsxElement => isJsxElement(c) && c.type === "button",
    );
    const labels = buttons.map((b) => b.props.children);
    expect(labels).toEqual([
      "▶ Start",
      "■ Stop",
      "⏸ Pause",
      "▶ Resume",
      "⛔ Kill Switch",
    ]);
  });
});
