/**
 * apps/bot/src/bot/position-manager.test.ts
 *
 * A `PositionManager` unit tesztjei — nyitás / zárás / L3 leverage check /
 * max-positions enforcement.
 */

import { describe, expect, it } from "bun:test";
import { asSymbol, type Symbol as ExchangeSymbol } from "@mm-crypto-bot/exchange";

import { PositionManager, PositionManagerError } from "./position-manager.js";

function makeSymbol(): ExchangeSymbol {
  return asSymbol("BTC/USDC") as unknown as ExchangeSymbol;
}

describe("PositionManager", () => {
  // ---------------------------------------------------------------------------
  // 1) openPosition registers a new position
  // ---------------------------------------------------------------------------
  it("openPosition registers a new position", () => {
    const pm = new PositionManager({
      initialEquityUsd: 10_000,
      maxPositions: 3,
      maxLeverage: 10,
    });
    const snap = pm.openPosition("strategy-a", makeSymbol(), "long", 0.01, 60_000, 10);
    expect(snap.id).toBe(`strategy-a:BTC/USDC:long`);
    expect(snap.quantity).toBe(0.01);
    expect(snap.entryPrice).toBe(60_000);
    expect(snap.notionalUsd).toBe(600);
    expect(pm.getPositionCount()).toBe(1);
  });

  // ---------------------------------------------------------------------------
  // 2) L3 leverage check: rejects aggregate > 1:10
  // ---------------------------------------------------------------------------
  it("openPosition rejects order that would breach 1:10 (L3)", () => {
    // Use a separate manager with max=5 so we can pack positions up to
    // the leverage cap without hitting the maxPositions check first.
    const pm = new PositionManager({
      initialEquityUsd: 10_000,
      maxPositions: 5,
      maxLeverage: 10,
    });
    pm.openPosition("strategy-a", makeSymbol(), "long", 0.01, 60_000, 10);
    pm.openPosition("strategy-b", makeSymbol(), "long", 0.1, 60_000, 10);
    pm.openPosition(
      "strategy-c",
      asSymbol("ETH/USDC") as unknown as ExchangeSymbol,
      "long",
      1.0,
      3_000,
      10,
    );
    // Aggregate so far: 6_000 + 60_000 + 30_000 = 96_000 / 10_000 = 9.6×.
    pm.openPosition(
      "strategy-d",
      asSymbol("SOL/USDC") as unknown as ExchangeSymbol,
      "long",
      0.1,
      150,
      10,
    );
    // Now try to add 1 BTC at 60_000: 60_000 effective.
    // Total: 96_150 + 60_000 = 156_150 / 10_000 = 15.6× → BREACH.
    expect(() => {
      pm.openPosition("strategy-e", makeSymbol(), "long", 1.0, 60_000, 10);
    }).toThrow(PositionManagerError);
  });

  // ---------------------------------------------------------------------------
  // 3) Max positions enforcement
  // ---------------------------------------------------------------------------
  it("openPosition throws when maxPositions is reached", () => {
    const pm = new PositionManager({
      initialEquityUsd: 1_000_000,
      maxPositions: 2,
      maxLeverage: 10,
    });
    pm.openPosition("strategy-a", makeSymbol(), "long", 0.01, 60_000, 1);
    pm.openPosition(
      "strategy-b",
      asSymbol("ETH/USDC") as unknown as ExchangeSymbol,
      "long",
      0.01,
      3_000,
      1,
    );
    expect(() => {
      pm.openPosition(
        "strategy-c",
        asSymbol("SOL/USDC") as unknown as ExchangeSymbol,
        "long",
        0.1,
        150,
        1,
      );
    }).toThrow(/maxPositions cap/);
  });

  // ---------------------------------------------------------------------------
  // 4) maxLeverage 11 throws (config validation)
  // ---------------------------------------------------------------------------
  it("constructor rejects maxLeverage > 10 (1:10 MANDATE)", () => {
    expect(() => {
      new PositionManager({
        initialEquityUsd: 10_000,
        maxPositions: 3,
        maxLeverage: 11,
      });
    }).toThrow(PositionManagerError);
  });

  // ---------------------------------------------------------------------------
  // 5) maxLeverage 0 throws
  // ---------------------------------------------------------------------------
  it("constructor rejects maxLeverage < 1", () => {
    expect(() => {
      new PositionManager({
        initialEquityUsd: 10_000,
        maxPositions: 3,
        maxLeverage: 0,
      });
    }).toThrow(PositionManagerError);
  });

  // ---------------------------------------------------------------------------
  // 6) closePosition returns P&L
  // ---------------------------------------------------------------------------
  it("closePosition returns P&L on close", () => {
    const pm = new PositionManager({
      initialEquityUsd: 10_000,
      maxPositions: 3,
      maxLeverage: 10,
    });
    pm.openPosition("strategy-a", makeSymbol(), "long", 0.01, 60_000, 10);
    const pnl = pm.closePosition("strategy-a", makeSymbol(), 65_000);
    // 0.01 × (65_000 - 60_000) = 50
    expect(pnl).toBe(50);
    expect(pm.getPositionCount()).toBe(0);
    expect(pm.getRealizedPnl()).toBe(50);
  });

  // ---------------------------------------------------------------------------
  // 7) updateMarketPrice updates unrealized PnL
  // ---------------------------------------------------------------------------
  it("updateMarketPrice updates unrealized PnL", () => {
    const pm = new PositionManager({
      initialEquityUsd: 10_000,
      maxPositions: 3,
      maxLeverage: 10,
    });
    pm.openPosition("strategy-a", makeSymbol(), "long", 0.01, 60_000, 10);
    pm.updateMarketPrice(makeSymbol(), 62_000);
    const pos = pm.getPosition("strategy-a", makeSymbol(), "long");
    expect(pos?.unrealizedPnl).toBe(20);
  });

  // ---------------------------------------------------------------------------
  // 8) getEquity = initial + realized + unrealized
  // ---------------------------------------------------------------------------
  it("getEquity = initialEquity + realizedPnl + unrealizedPnl", () => {
    const pm = new PositionManager({
      initialEquityUsd: 10_000,
      maxPositions: 3,
      maxLeverage: 10,
    });
    expect(pm.getEquity()).toBe(10_000);
    pm.openPosition("strategy-a", makeSymbol(), "long", 0.01, 60_000, 10);
    pm.updateMarketPrice(makeSymbol(), 62_000);
    // 10_000 + 0 + 20 = 10_020
    expect(pm.getEquity()).toBe(10_020);
  });

  // ---------------------------------------------------------------------------
  // 9) getPositionContext returns the correct aggregate
  // ---------------------------------------------------------------------------
  it("getPositionContext returns equity + positions", () => {
    const pm = new PositionManager({
      initialEquityUsd: 10_000,
      maxPositions: 3,
      maxLeverage: 10,
    });
    pm.openPosition("strategy-a", makeSymbol(), "long", 0.01, 60_000, 10);
    const ctx = pm.getPositionContext();
    expect(ctx.equityUsd).toBe(10_000);
    expect(ctx.positions.length).toBe(1);
    // 0.01 × 60_000 × 10 leverage = 6_000 effective notional
    expect(ctx.positions[0]?.effectiveNotionalUsd).toBe(6_000);
  });

  // ---------------------------------------------------------------------------
  // 10) recordFill on existing same-side position averages entry price
  // ---------------------------------------------------------------------------
  it("recordFill same-side averages entry price", () => {
    const pm = new PositionManager({
      initialEquityUsd: 10_000,
      maxPositions: 3,
      maxLeverage: 10,
    });
    pm.recordFill({
      strategy: "strategy-a",
      symbol: makeSymbol(),
      side: "long",
      quantity: 0.01,
      price: 60_000,
      leverage: 10,
      timestamp: 1,
    });
    pm.recordFill({
      strategy: "strategy-a",
      symbol: makeSymbol(),
      side: "long",
      quantity: 0.01,
      price: 70_000,
      leverage: 10,
      timestamp: 2,
    });
    const pos = pm.getPosition("strategy-a", makeSymbol(), "long");
    // Average: (0.01 × 60k + 0.01 × 70k) / 0.02 = 65_000
    expect(pos?.entryPrice).toBe(65_000);
    expect(pos?.quantity).toBe(0.02);
  });

  // ---------------------------------------------------------------------------
  // 11) recordFill opposite-side closes the position
  // ---------------------------------------------------------------------------
  it("recordFill opposite-side closes the position", () => {
    const pm = new PositionManager({
      initialEquityUsd: 10_000,
      maxPositions: 3,
      maxLeverage: 10,
    });
    pm.openPosition("strategy-a", makeSymbol(), "long", 0.01, 60_000, 10);
    pm.recordFill({
      strategy: "strategy-a",
      symbol: makeSymbol(),
      side: "short",
      quantity: 0.01,
      price: 62_000,
      leverage: 10,
      timestamp: 2,
    });
    expect(pm.getPositionCount()).toBe(0);
    // PnL: (62_000 - 60_000) × 0.01 = +20 (long, price went up).
    expect(pm.getRealizedPnl()).toBe(20);
  });

  // ---------------------------------------------------------------------------
  // 12) closedTrades are recorded
  // ---------------------------------------------------------------------------
  it("closedTrades records close events", () => {
    const pm = new PositionManager({
      initialEquityUsd: 10_000,
      maxPositions: 3,
      maxLeverage: 10,
    });
    pm.openPosition("strategy-a", makeSymbol(), "long", 0.01, 60_000, 10);
    pm.closePosition("strategy-a", makeSymbol(), 65_000, 1234);
    const closed = pm.getClosedTrades();
    expect(closed.length).toBe(1);
    expect(closed[0]?.pnl).toBe(50);
    expect(closed[0]?.closedAt).toBe(1234);
  });

  // ---------------------------------------------------------------------------
  // 13) getMaxPositions / getMaxLeverage accessors (Phase 34 coverage fixup)
  // ---------------------------------------------------------------------------
  it("getMaxPositions returns the configured cap", () => {
    const pm = new PositionManager({
      initialEquityUsd: 10_000,
      maxPositions: 7,
      maxLeverage: 10,
    });
    expect(pm.getMaxPositions()).toBe(7);
  });

  it("getMaxLeverage returns the configured cap (1:10 MANDATE L3)", () => {
    const pm = new PositionManager({
      initialEquityUsd: 10_000,
      maxPositions: 3,
      maxLeverage: 5,
    });
    expect(pm.getMaxLeverage()).toBe(5);
  });
});
