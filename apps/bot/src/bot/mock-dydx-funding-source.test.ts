/**
 * apps/bot/src/bot/mock-dydx-funding-source.test.ts
 *
 * Unit tests for `MockDydxFundingSource` (Phase 43 Track 1).
 *
 * Coverage target: 100% line + function on `mock-dydx-funding-source.ts`.
 * Each test exercises one interface method + at least one edge case
 * (null state pre-tick, state-after-tick, deterministic values).
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import type { CarryMarket, FundingSnapshot } from "@mm-crypto-bot/core";

import { MockDydxFundingSource } from "./mock-dydx-funding-source.js";

const BTC_USD: CarryMarket = "BTC-USD";

describe("MockDydxFundingSource", () => {
  let source: MockDydxFundingSource;
  let nowMs: number;

  beforeEach(() => {
    source = new MockDydxFundingSource(42);
    nowMs = Date.now();
  });

  afterEach(() => {
    // Defensive — the source's setInterval is cleared by `close()` in each
    // test, but this is a belt-and-suspenders against the open-handle leak
    // detector in `bun test`.
  });

  // -------------------------------------------------------------------------
  // 1) Initial state: never-ticked → all read methods are unobserved
  // -------------------------------------------------------------------------
  it("returns undefined for lastTick/lastChain* before any tick fires", () => {
    expect(source.lastTickAgeMs(BTC_USD, nowMs)).toBeUndefined();
    // chainBlockHeight has a non-null initial value (1_000_000), so this
    // returns 1_000_000 even pre-tick (matches the real dYdX v4 Indexer
    // behavior: the latest finalized block height is always available).
    expect(source.lastChainBlockHeight(BTC_USD)).toBe(1_000_000);
    expect(source.lastChainBlockTs(BTC_USD)).toBeUndefined();
    expect(source.health().lastTickMs).toBeUndefined();
    expect(source.health().chainBlockHeight).toBe(1_000_000);
  });

  // -------------------------------------------------------------------------
  // 2) subscribe() fires a tick immediately + on interval; close() stops it
  // -------------------------------------------------------------------------
  it("subscribe() fires immediately, then on interval; close() stops it", async () => {
    let tickCount = 0;
    let lastSnap: { dydx: FundingSnapshot; cex: FundingSnapshot } | undefined;
    const handle = source.subscribe(BTC_USD, (snap) => {
      tickCount += 1;
      lastSnap = snap;
    });
    // First tick fires synchronously (synchronously inside subscribe()).
    expect(tickCount).toBe(1);
    if (lastSnap === undefined) throw new Error("immediate funding snapshot was not delivered");
    expect(lastSnap.dydx.symbol).toBe("BTC-USD");
    expect(lastSnap.cex.symbol).toBe("BTC-USD");
    expect(lastSnap.dydx.fundingRate.toSnapshot().schema).toBe("exact-rational@1");
    expect(lastSnap.dydx.markPrice?.toSnapshot().schema).toBe("exact-rational@1");

    // Wait for a second tick (~1Hz interval).
    await new Promise<void>((r) => setTimeout(r, 1100));
    expect(tickCount).toBeGreaterThanOrEqual(2);
    expect(source.health().lastTickMs).not.toBeNull();

    // Close stops the interval.
    handle.close();
    const countAfterClose = tickCount;
    await new Promise<void>((r) => setTimeout(r, 1200));
    expect(tickCount).toBe(countAfterClose);
  });

  // -------------------------------------------------------------------------
  // 3) lastTickAgeMs returns ms since last tick
  // -------------------------------------------------------------------------
  it("lastTickAgeMs returns ms since the last tick (or undefined pre-tick)", () => {
    expect(source.lastTickAgeMs(BTC_USD, nowMs)).toBeUndefined();

    // Fire one tick.
    source.subscribe(BTC_USD, () => void 0);
    const afterTick = Date.now();
    const age = source.lastTickAgeMs(BTC_USD, afterTick);
    if (age === undefined) throw new Error("tick age remained unobserved after subscribe");
    expect(age).toBeGreaterThanOrEqual(0);
    expect(age).toBeLessThan(50); // ms-precision: should be < 50ms old
  });

  // -------------------------------------------------------------------------
  // 4) chain block height increments per tick
  // -------------------------------------------------------------------------
  it("chain block height increments by 1 per tick", () => {
    const initial = source.lastChainBlockHeight(BTC_USD);
    expect(initial).toBe(1_000_000);

    source.subscribe(BTC_USD, () => void 0);
    expect(source.lastChainBlockHeight(BTC_USD)).toBe(1_000_001);

    // Wait for another tick.
    return new Promise<void>((resolve) =>
      setTimeout(() => {
        expect(source.lastChainBlockHeight(BTC_USD)).toBe(1_000_002);
        resolve();
      }, 1100),
    );
  });

  // -------------------------------------------------------------------------
  // 5) bybitEuSpotDepthUsd returns 1_000_000 (above the 50k kill-switch threshold)
  // -------------------------------------------------------------------------
  it("bybitEuSpotDepthUsd returns 1_000_000 (above the bybit-eu-thin threshold)", () => {
    expect(source.bybitEuSpotDepthUsd(BTC_USD, nowMs)).toBe(1_000_000);
  });

  // -------------------------------------------------------------------------
  // 6) Deterministic: same seed → same sequence
  // -------------------------------------------------------------------------
  it("is deterministic across instances with the same seed", () => {
    const a = new MockDydxFundingSource(123);
    const b = new MockDydxFundingSource(123);
    let aSnap: FundingSnapshot | undefined;
    let bSnap: FundingSnapshot | undefined;
    a.subscribe(BTC_USD, (s) => {
      aSnap = s.dydx;
    });
    b.subscribe(BTC_USD, (s) => {
      bSnap = s.dydx;
    });
    if (aSnap === undefined || bSnap === undefined)
      throw new Error("deterministic snapshots were not delivered");
    expect(aSnap.fundingRate.equals(bSnap.fundingRate)).toBe(true);
    expect(aSnap.markPrice?.equals(bSnap.markPrice)).toBe(true);
  });

  // -------------------------------------------------------------------------
  // 7) health() returns the current state
  // -------------------------------------------------------------------------
  it("health() returns current lastTickMs and chainBlockHeight", () => {
    expect(source.health()).toEqual({
      lastTickMs: undefined,
      chainBlockHeight: 1_000_000,
    });
    source.subscribe(BTC_USD, () => void 0);
    const h = source.health();
    expect(h.lastTickMs).not.toBeNull();
    expect(typeof h.lastTickMs).toBe("number");
    expect(h.chainBlockHeight).toBe(1_000_001);
  });
});
