/**
 * apps/web/src/lib/subscription.test.ts
 *
 * Phase 48B: bun:test unit tests for `subscription.ts`.
 *
 * Coverage target: **100% line + branch coverage** on subscription.ts.
 * The lib is pure (no React, no DOM, no I/O) so a single bun:test file
 * with describe/it/expect blocks is enough.
 *
 * The test groups mirror the public API:
 *   - `chartKeyToString` / `chartKeyFromString` — round-trip + edge cases
 *   - `computeSubscriptionDiff` — null prev, empty current, identical
 *     prev/current, 50% overlap, dedup, order
 *   - `applySubscriptionDiff` — pure, idempotent subscribe, silent
 *     unsubscribe of missing key, mixed messages
 *   - `initialSubscriptionState` — empty Set
 */

import { describe, expect, it } from "bun:test";

import {
  applySubscriptionDiff,
  chartKeyFromString,
  chartKeyToString,
  computeSubscriptionDiff,
  initialSubscriptionState,
  type ChartKey,
  type SubscriptionMessage,
  type SubscriptionState,
} from "./subscription.js";

// ============================================================================
// Fixtures
// ============================================================================

const K_BTC_1H: ChartKey = { symbol: "BTC/USDC", timeframe: "1h" };
const K_BTC_4H: ChartKey = { symbol: "BTC/USDC", timeframe: "4h" };
const K_ETH_1H: ChartKey = { symbol: "ETH/USDC", timeframe: "1h" };
const K_ETH_4H: ChartKey = { symbol: "ETH/USDC", timeframe: "4h" };
const K_SOL_1H: ChartKey = { symbol: "SOL/USDC", timeframe: "1h" };

// ============================================================================
// chartKeyToString
// ============================================================================

describe("chartKeyToString", () => {
  it("encodes symbol|timeframe with a pipe separator", () => {
    expect(chartKeyToString(K_BTC_1H)).toBe("BTC/USDC|1h");
  });

  it("preserves the slash inside the symbol", () => {
    expect(chartKeyToString(K_ETH_4H)).toBe("ETH/USDC|4h");
  });

  it("encodes an empty symbol with a leading pipe", () => {
    expect(chartKeyToString({ symbol: "", timeframe: "1h" })).toBe("|1h");
  });

  it("encodes an empty timeframe with a trailing pipe", () => {
    expect(chartKeyToString({ symbol: "BTC/USDC", timeframe: "" })).toBe("BTC/USDC|");
  });
});

// ============================================================================
// chartKeyFromString
// ============================================================================

describe("chartKeyFromString", () => {
  it("decodes a typical key", () => {
    expect(chartKeyFromString("BTC/USDC|1h")).toEqual(K_BTC_1H);
  });

  it("returns null for a string without a pipe", () => {
    expect(chartKeyFromString("no-pipe")).toBeNull();
  });

  it("returns null for an empty string", () => {
    expect(chartKeyFromString("")).toBeNull();
  });

  it("decodes a key with an empty timeframe (trailing pipe)", () => {
    expect(chartKeyFromString("BTC/USDC|")).toEqual({
      symbol: "BTC/USDC",
      timeframe: "",
    });
  });

  it("decodes a key with an empty symbol (leading pipe)", () => {
    expect(chartKeyFromString("|1h")).toEqual({
      symbol: "",
      timeframe: "1h",
    });
  });

  it("uses the FIRST pipe as the separator (later pipes are kept in timeframe)", () => {
    // Defensive: ha bármi okból egy timeframe "|" karaktert tartalmazna,
    // a parser a második "|"-tól kezdve a timeframe részeként kezeli.
    // (A mi használatunkban a timeframe-ek sosem tartalmaznak pipe-ot,
    // de a parser ezt az élő esetet is korrekt kezeli.)
    expect(chartKeyFromString("BTC/USDC|1h|sub")).toEqual({
      symbol: "BTC/USDC",
      timeframe: "1h|sub",
    });
  });

  it("round-trips with chartKeyToString", () => {
    const roundTrip = (k: ChartKey): ChartKey => {
      const parsed = chartKeyFromString(chartKeyToString(k));
      if (parsed === null) throw new Error("expected non-null");
      return parsed;
    };
    expect(roundTrip(K_BTC_1H)).toEqual(K_BTC_1H);
    expect(roundTrip(K_ETH_4H)).toEqual(K_ETH_4H);
    expect(roundTrip({ symbol: "BTC/USDC", timeframe: "" })).toEqual({
      symbol: "BTC/USDC",
      timeframe: "",
    });
    expect(roundTrip({ symbol: "", timeframe: "1h" })).toEqual({
      symbol: "",
      timeframe: "1h",
    });
  });
});

// ============================================================================
// computeSubscriptionDiff
// ============================================================================

describe("computeSubscriptionDiff", () => {
  it("null prev + 1 current → 1 SUBSCRIBE", () => {
    const out = computeSubscriptionDiff(null, [K_BTC_1H]);
    expect(out).toEqual([
      { type: "subscribe", symbol: "BTC/USDC", timeframe: "1h" },
    ]);
  });

  it("null prev + N current → N SUBSCRIBE messages (in current order)", () => {
    const out = computeSubscriptionDiff(null, [K_BTC_1H, K_ETH_1H, K_SOL_1H]);
    expect(out).toEqual([
      { type: "subscribe", symbol: "BTC/USDC", timeframe: "1h" },
      { type: "subscribe", symbol: "ETH/USDC", timeframe: "1h" },
      { type: "subscribe", symbol: "SOL/USDC", timeframe: "1h" },
    ]);
  });

  it("empty current + N prev → N UNSUBSCRIBE messages (in prev order)", () => {
    const out = computeSubscriptionDiff([K_BTC_1H, K_ETH_1H, K_SOL_1H], []);
    expect(out).toEqual([
      { type: "unsubscribe", symbol: "BTC/USDC", timeframe: "1h" },
      { type: "unsubscribe", symbol: "ETH/USDC", timeframe: "1h" },
      { type: "unsubscribe", symbol: "SOL/USDC", timeframe: "1h" },
    ]);
  });

  it("null prev + empty current → empty array (no work to do)", () => {
    const out = computeSubscriptionDiff(null, []);
    expect(out).toEqual([]);
  });

  it("empty prev + empty current → empty array", () => {
    const out = computeSubscriptionDiff([], []);
    expect(out).toEqual([]);
  });

  it("identical prev + current → empty array (no diff)", () => {
    const out = computeSubscriptionDiff(
      [K_BTC_1H, K_ETH_1H],
      [K_BTC_1H, K_ETH_1H],
    );
    expect(out).toEqual([]);
  });

  it("identical prev + current in different order → empty array", () => {
    // A sorrend a Set-en belül nem számít — a diff csak a tartalomra figyel.
    const out = computeSubscriptionDiff(
      [K_BTC_1H, K_ETH_1H],
      [K_ETH_1H, K_BTC_1H],
    );
    expect(out).toEqual([]);
  });

  it("50% overlap → mix of SUBSCRIBE and UNSUBSCRIBE", () => {
    // prev = [BTC/1h, ETH/1h], current = [ETH/1h, SOL/1h]
    // → UNSUBSCRIBE BTC/1h, SUBSCRIBE SOL/1h
    const out = computeSubscriptionDiff(
      [K_BTC_1H, K_ETH_1H],
      [K_ETH_1H, K_SOL_1H],
    );
    expect(out).toEqual([
      { type: "unsubscribe", symbol: "BTC/USDC", timeframe: "1h" },
      { type: "subscribe", symbol: "SOL/USDC", timeframe: "1h" },
    ]);
  });

  it("emits UNSUBSCRIBE first, SUBSCRIBE second (detached-then-attached)", () => {
    // prev = [BTC/1h, BTC/4h], current = [ETH/1h, SOL/1h]
    // → UNSUBSCRIBE × 2 (in prev order), then SUBSCRIBE × 2 (in current order)
    const out = computeSubscriptionDiff(
      [K_BTC_1H, K_BTC_4H],
      [K_ETH_1H, K_SOL_1H],
    );
    expect(out).toEqual([
      { type: "unsubscribe", symbol: "BTC/USDC", timeframe: "1h" },
      { type: "unsubscribe", symbol: "BTC/USDC", timeframe: "4h" },
      { type: "subscribe", symbol: "ETH/USDC", timeframe: "1h" },
      { type: "subscribe", symbol: "SOL/USDC", timeframe: "1h" },
    ]);
  });

  it("mixed flow: some kept, some added, some removed, in correct order", () => {
    // prev = [BTC/1h, BTC/4h, ETH/1h]
    // current = [BTC/1h, ETH/1h, ETH/4h, SOL/1h]
    // → kept: BTC/1h, ETH/1h
    // → unsubscribed: BTC/4h
    // → subscribed: ETH/4h, SOL/1h
    const out = computeSubscriptionDiff(
      [K_BTC_1H, K_BTC_4H, K_ETH_1H],
      [K_BTC_1H, K_ETH_1H, K_ETH_4H, K_SOL_1H],
    );
    expect(out).toEqual([
      { type: "unsubscribe", symbol: "BTC/USDC", timeframe: "4h" },
      { type: "subscribe", symbol: "ETH/USDC", timeframe: "4h" },
      { type: "subscribe", symbol: "SOL/USDC", timeframe: "1h" },
    ]);
  });

  it("deduplicates duplicate keys in prev (UNSUBSCRIBE fires once)", () => {
    const out = computeSubscriptionDiff(
      [K_BTC_1H, K_BTC_1H, K_ETH_1H, K_BTC_1H],
      [],
    );
    expect(out).toEqual([
      { type: "unsubscribe", symbol: "BTC/USDC", timeframe: "1h" },
      { type: "unsubscribe", symbol: "ETH/USDC", timeframe: "1h" },
    ]);
  });

  it("deduplicates duplicate keys in current (SUBSCRIBE fires once)", () => {
    const out = computeSubscriptionDiff(null, [
      K_BTC_1H,
      K_BTC_1H,
      K_ETH_1H,
      K_BTC_1H,
    ]);
    expect(out).toEqual([
      { type: "subscribe", symbol: "BTC/USDC", timeframe: "1h" },
      { type: "subscribe", symbol: "ETH/USDC", timeframe: "1h" },
    ]);
  });

  it("preserves prev order even with duplicates (first occurrence wins)", () => {
    // A prev sorrendje: BTC, ETH, BTC, SOL. Dedup után: BTC, ETH, SOL.
    const out = computeSubscriptionDiff(
      [K_BTC_1H, K_ETH_1H, K_BTC_1H, K_SOL_1H],
      [],
    );
    expect(out.map((m) => m.symbol)).toEqual(["BTC/USDC", "ETH/USDC", "SOL/USDC"]);
  });

  it("preserves current order even with duplicates (first occurrence wins)", () => {
    // A current sorrendje: BTC, ETH, BTC, SOL. Dedup után: BTC, ETH, SOL.
    const out = computeSubscriptionDiff(null, [
      K_BTC_1H,
      K_ETH_1H,
      K_BTC_1H,
      K_SOL_1H,
    ]);
    expect(out.map((m) => m.symbol)).toEqual(["BTC/USDC", "ETH/USDC", "SOL/USDC"]);
  });

  it("is pure: does not mutate the input arrays", () => {
    const prev: ChartKey[] = [K_BTC_1H, K_ETH_1H];
    const current: ChartKey[] = [K_ETH_1H, K_SOL_1H];
    const prevBefore = JSON.stringify(prev);
    const currentBefore = JSON.stringify(current);
    computeSubscriptionDiff(prev, current);
    expect(JSON.stringify(prev)).toBe(prevBefore);
    expect(JSON.stringify(current)).toBe(currentBefore);
  });

  it("is deterministic: same input → same output (called twice)", () => {
    const a = computeSubscriptionDiff(
      [K_BTC_1H, K_BTC_4H, K_ETH_1H],
      [K_BTC_1H, K_ETH_1H, K_ETH_4H, K_SOL_1H],
    );
    const b = computeSubscriptionDiff(
      [K_BTC_1H, K_BTC_4H, K_ETH_1H],
      [K_BTC_1H, K_ETH_1H, K_ETH_4H, K_SOL_1H],
    );
    expect(a).toEqual(b);
  });
});

// ============================================================================
// applySubscriptionDiff
// ============================================================================

describe("applySubscriptionDiff", () => {
  it("empty state + SUBSCRIBE → state contains the key", () => {
    const initial = initialSubscriptionState();
    const out = applySubscriptionDiff(initial, [
      { type: "subscribe", symbol: "BTC/USDC", timeframe: "1h" },
    ]);
    expect(out.subscribed.has("BTC/USDC|1h")).toBe(true);
    expect(out.subscribed.size).toBe(1);
  });

  it("empty state + N SUBSCRIBE → state contains all N keys", () => {
    const initial = initialSubscriptionState();
    const out = applySubscriptionDiff(initial, [
      { type: "subscribe", symbol: "BTC/USDC", timeframe: "1h" },
      { type: "subscribe", symbol: "ETH/USDC", timeframe: "1h" },
      { type: "subscribe", symbol: "SOL/USDC", timeframe: "1h" },
    ]);
    expect(out.subscribed.size).toBe(3);
    expect(out.subscribed.has("BTC/USDC|1h")).toBe(true);
    expect(out.subscribed.has("ETH/USDC|1h")).toBe(true);
    expect(out.subscribed.has("SOL/USDC|1h")).toBe(true);
  });

  it("SUBSCRIBE of an existing key is idempotent (no duplicate)", () => {
    const initial: SubscriptionState = {
      subscribed: new Set(["BTC/USDC|1h"]),
    };
    const out = applySubscriptionDiff(initial, [
      { type: "subscribe", symbol: "BTC/USDC", timeframe: "1h" },
    ]);
    expect(out.subscribed.size).toBe(1);
    expect(out.subscribed.has("BTC/USDC|1h")).toBe(true);
  });

  it("UNSUBSCRIBE of an existing key → state no longer contains the key", () => {
    const initial: SubscriptionState = {
      subscribed: new Set(["BTC/USDC|1h", "ETH/USDC|1h"]),
    };
    const out = applySubscriptionDiff(initial, [
      { type: "unsubscribe", symbol: "BTC/USDC", timeframe: "1h" },
    ]);
    expect(out.subscribed.has("BTC/USDC|1h")).toBe(false);
    expect(out.subscribed.has("ETH/USDC|1h")).toBe(true);
    expect(out.subscribed.size).toBe(1);
  });

  it("UNSUBSCRIBE of a non-existing key is a silent success", () => {
    const initial: SubscriptionState = {
      subscribed: new Set(["ETH/USDC|1h"]),
    };
    const out = applySubscriptionDiff(initial, [
      { type: "unsubscribe", symbol: "BTC/USDC", timeframe: "1h" },
    ]);
    expect(out.subscribed.size).toBe(1);
    expect(out.subscribed.has("ETH/USDC|1h")).toBe(true);
  });

  it("mixed SUBSCRIBE + UNSUBSCRIBE → final state is correct", () => {
    const initial: SubscriptionState = {
      subscribed: new Set(["BTC/USDC|1h", "ETH/USDC|1h"]),
    };
    const out = applySubscriptionDiff(initial, [
      { type: "unsubscribe", symbol: "BTC/USDC", timeframe: "1h" },
      { type: "subscribe", symbol: "SOL/USDC", timeframe: "1h" },
      { type: "unsubscribe", symbol: "ETH/USDC", timeframe: "1h" },
      { type: "subscribe", symbol: "BTC/USDC", timeframe: "4h" },
    ]);
    expect(out.subscribed.has("BTC/USDC|1h")).toBe(false);
    expect(out.subscribed.has("ETH/USDC|1h")).toBe(false);
    expect(out.subscribed.has("SOL/USDC|1h")).toBe(true);
    expect(out.subscribed.has("BTC/USDC|4h")).toBe(true);
    expect(out.subscribed.size).toBe(2);
  });

  it("empty messages + any state → returns a state with the same contents", () => {
    const initial: SubscriptionState = {
      subscribed: new Set(["BTC/USDC|1h"]),
    };
    const out = applySubscriptionDiff(initial, []);
    expect(out.subscribed.has("BTC/USDC|1h")).toBe(true);
    expect(out.subscribed.size).toBe(1);
  });

  it("is pure: does not mutate the input state", () => {
    const initial: SubscriptionState = {
      subscribed: new Set(["BTC/USDC|1h"]),
    };
    const initialSnapshot = new Set(initial.subscribed);
    applySubscriptionDiff(initial, [
      { type: "unsubscribe", symbol: "BTC/USDC", timeframe: "1h" },
      { type: "subscribe", symbol: "ETH/USDC", timeframe: "1h" },
    ]);
    // The input Set must be byte-identical.
    expect(initial.subscribed).toEqual(initialSnapshot);
  });

  it("is pure: does not return the same Set instance (new Set every call)", () => {
    const initial: SubscriptionState = {
      subscribed: new Set<string>(),
    };
    const out = applySubscriptionDiff(initial, [
      { type: "subscribe", symbol: "BTC/USDC", timeframe: "1h" },
    ]);
    // The output Set is a new instance — mutating it must not affect
    // the input. We cast to the mutable `Set<string>` here because
    // the public type exposes `ReadonlySet<string>` (immutable view
    // by contract), but the runtime is a real `Set` that we want to
    // assert the independence of.
    const outMut = out.subscribed as Set<string>;
    outMut.add("X");
    expect(initial.subscribed.has("X")).toBe(false);
  });

  it("composes with computeSubscriptionDiff (round-trip)", () => {
    // A diff kiszámolása + alkalmazása utáni state pontosan az új
    // kulcsokat tartalmazza (a dedup után).
    const prev: ChartKey[] = [K_BTC_1H, K_BTC_4H, K_ETH_1H];
    const current: ChartKey[] = [K_BTC_1H, K_ETH_1H, K_ETH_4H, K_SOL_1H];
    const messages: readonly SubscriptionMessage[] = computeSubscriptionDiff(
      prev,
      current,
    );

    const startState: SubscriptionState = {
      subscribed: new Set([
        chartKeyToString(K_BTC_1H),
        chartKeyToString(K_BTC_4H),
        chartKeyToString(K_ETH_1H),
      ]),
    };
    const next = applySubscriptionDiff(startState, messages);
    expect(next.subscribed.has(chartKeyToString(K_BTC_1H))).toBe(true);
    expect(next.subscribed.has(chartKeyToString(K_BTC_4H))).toBe(false);
    expect(next.subscribed.has(chartKeyToString(K_ETH_1H))).toBe(true);
    expect(next.subscribed.has(chartKeyToString(K_ETH_4H))).toBe(true);
    expect(next.subscribed.has(chartKeyToString(K_SOL_1H))).toBe(true);
    expect(next.subscribed.size).toBe(4);
  });
});

// ============================================================================
// initialSubscriptionState
// ============================================================================

describe("initialSubscriptionState", () => {
  it("returns a state with an empty Set", () => {
    const s = initialSubscriptionState();
    expect(s.subscribed).toBeInstanceOf(Set);
    expect(s.subscribed.size).toBe(0);
  });

  it("each call returns an independent Set (no shared state)", () => {
    const a = initialSubscriptionState();
    const b = initialSubscriptionState();
    // Cast to mutable Set — the public type is ReadonlySet, but the
    // runtime is a real Set that we want to assert the independence of.
    (a.subscribed as Set<string>).add("X");
    expect(b.subscribed.has("X")).toBe(false);
  });
});
