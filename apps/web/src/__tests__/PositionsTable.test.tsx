/**
 * apps/web/src/__tests__/PositionsTable.test.tsx
 *
 * Phase 47D: smoke tests for the PositionsTable. Same approach as
 * ControlBar.test.tsx — `mock.module` stubs `useWebSocket` so the
 * component can be called as a regular function and we can inspect
 * the resulting JSX element. The test verifies the empty-positions
 * branch (the default mock returns `lastState: null`).
 *
 * Behavioral tests (rows render with the correct columns, click → send
 * the right CONTROL message) are deferred to Phase 50 when
 * @testing-library/react is added.
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

import { PositionsTable } from "../components/PositionsTable.js";

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

describe("PositionsTable", () => {
  it("is exported as a function", () => {
    expect(typeof PositionsTable).toBe("function");
  });

  it("returns the 'No open positions' div when lastState has no positions", () => {
    // With the mock returning lastState: null, the component takes
    // the empty-positions branch and returns a div with class
    // 'ep-positions ep-positions--empty'.
    const el = PositionsTable();
    expect(isJsxElement(el)).toBe(true);
    if (!isJsxElement(el)) return;
    expect(el.type).toBe("div");
    expect(el.props.className).toContain("ep-positions--empty");
  });
});
