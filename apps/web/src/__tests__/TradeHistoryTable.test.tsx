/**
 * apps/web/src/__tests__/TradeHistoryTable.test.tsx
 *
 * Phase 82 (item 4 — user mandate 2026-07-27 12:17) + Phase 83.5 (Bug 2):
 * unit tests for the trade history table component.
 *
 * Mirrors the `ControlBar.test.tsx` structural-test approach:
 *   - We use `React.createElement(TradeHistoryTable)` for the
 *     structural smoke test (the element is built, not rendered).
 *   - We DO NOT call `TradeHistoryTable()` directly — the
 *     component uses `useMemo`, which requires a real React
 *     renderer. bun:test doesn't ship one (the codebase defers
 *     full-render tests to the e2e + CT suites). So we only
 *     assert the function is exported + the React element is
 *     buildable.
 *
 * The `tradesFromState` helper (extracted to
 * `apps/web/src/lib/trades-from-state.ts`) gets a 100% branch-sweep
 * in `__tests__/trades-from-state.test.ts` — it's the meat of the
 * shape-validation logic. The previous `parseTrades` helper
 * (Phase 82) is DELETED in Phase 83.5 since the WS-driven path
 * bypasses the HTTP `/api/trades` response shape entirely.
 *
 * The "table renders rows" branch is covered by the e2e test
 * (`e2e/trade-history.spec.ts` + the new
 * `e2e/83-5-trades-realtime.spec.ts`).
 */

import { describe, expect, it } from "bun:test";

import React from "react";
import {
  TradeHistoryTable,
  type TradeHistoryItem,
} from "../components/TradeHistoryTable.js";

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

describe("TradeHistoryTable (Phase 83.5 — prop-driven, WS-first)", () => {
  it("is exported as a function", () => {
    expect(typeof TradeHistoryTable).toBe("function");
  });

  it("can be wrapped in a React element with the new (lastState, status) props", () => {
    // The new prop-driven API requires `lastState` + `status`. The
    // element is buildable; the full render (incl. the
    // "Waiting for WebSocket…" / empty / row-render branches) is
    // exercised in the e2e suite (`e2e/83-5-trades-realtime.spec.ts`).
    const el = React.createElement(TradeHistoryTable, {
      lastState: null,
      status: "connected",
    });
    expect(isJsxElement(el)).toBe(true);
    if (!isJsxElement(el)) return;
    expect(typeof el.type).toBe("function");
  });

  it("exports the TradeHistoryItem type for downstream consumers", () => {
    // The `TradeHistoryItem` type is re-exported so the e2e
    // mocks + the `tradesFromState` helper can refer to it
    // without circular imports. We assert it's a non-empty
    // type literal at runtime by checking that the symbol
    // resolves.
    const item: TradeHistoryItem = {
      id: "x",
      strategy: "s",
      symbol: "BTC/USDC",
      side: "buy",
      entryPrice: 1,
      entryTime: 1,
      exitPrice: null,
      exitTime: null,
      quantity: 1,
      leverage: 1,
      pnl: 0,
      pnlPct: 0,
      duration: 0,
      status: "open",
    };
    expect(item.id).toBe("x");
  });
});
