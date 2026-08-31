import { describe, expect, it } from "bun:test";
import { asSymbol } from "@mm-crypto-bot/exchange";

import { PositionManagerError } from "./position-manager.js";
import { PositionManager, RiskManager, makeSymbol } from "./position-manager.test-support.js";

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
    pm.openPosition("strategy-c", asSymbol("ETH/USDC"), "long", 1, 3000, 10);
    // Aggregate so far: 6_000 + 60_000 + 30_000 = 96_000 / 10_000 = 9.6×.
    pm.openPosition("strategy-d", asSymbol("SOL/USDC"), "long", 0.1, 150, 10);
    // Now try to add 1 BTC at 60_000: 60_000 effective.
    // Total: 96_150 + 60_000 = 156_150 / 10_000 = 15.6× → BREACH.
    expect(() => {
      pm.openPosition("strategy-e", makeSymbol(), "long", 1, 60_000, 10);
    }).toThrow(PositionManagerError);
  });

  it("fails closed when a realized loss exhausts equity before another aggregate check", () => {
    const pm = new PositionManager({
      initialEquityUsd: 100,
      maxPositions: 2,
      maxLeverage: 10,
    });
    pm.openPosition("realized-loss", makeSymbol(), "long", 9, 100, 1);
    pm.openPosition("remaining", asSymbol("ETH/USDC"), "long", 1, 100, 1);
    pm.closePosition("realized-loss", makeSymbol(), 1);

    expect(() => {
      pm.recordFill({
        strategy: "remaining",
        symbol: asSymbol("ETH/USDC"),
        side: "long",
        quantity: 0.01,
        price: 100,
        leverage: 1,
        timestamp: 1,
      });
    }).toThrow("L3 leverage check failed (equity=-791)");
  });

  it("rejects an additional same-side fill that breaches aggregate leverage", () => {
    const pm = new PositionManager({
      initialEquityUsd: 1000,
      maxPositions: 1,
      maxLeverage: 10,
    });
    pm.openPosition("same-side", makeSymbol(), "long", 9, 1000, 1);

    expect(() => {
      pm.recordFill({
        strategy: "same-side",
        symbol: makeSymbol(),
        side: "long",
        quantity: 2,
        price: 1000,
        leverage: 1,
        timestamp: 1,
      });
    }).toThrow("L3 leverage breach (recordFill same-side same-side:BTC/USDC:long)");
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
    pm.openPosition("strategy-b", asSymbol("ETH/USDC"), "long", 0.01, 3000, 1);
    expect(() => {
      pm.openPosition("strategy-c", asSymbol("SOL/USDC"), "long", 0.1, 150, 1);
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
    const context = pm.getPositionContext();
    expect(context.equityUsd).toBe(10_000);
    expect(context.positions.length).toBe(1);
    // 0.01 × 60_000 × 10 leverage = 6_000 effective notional
    expect(context.positions[0]?.effectiveNotionalUsd).toBe(6000);
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
  // 13) configured-cap accessors
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

  // ---------------------------------------------------------------------------
  // 14) risk-manager integration
  // ---------------------------------------------------------------------------
  it("setRiskManager stores the manager and feeds it on updateMarketPrice", () => {
    const pm = new PositionManager({
      initialEquityUsd: 10_000,
      maxPositions: 3,
      maxLeverage: 10,
    });
    const rm = new RiskManager({
      trailingStop: { enabled: true, atrPeriod: 14, atrMultiplier: 3, side: "both" },
      kelly: {
        enabled: false,
        fraction: 0.25,
        windowSize: 50,
        minTrades: 10,
        fallbackFraction: 0.01,
        maxFraction: 0.1,
      },
      drawdownScaler: { enabled: true, maxDdPct: 0.2, initialEquity: 10_000 },
    });
    pm.setRiskManager(rm);
    let closeIntents = 0;
    rm.onTrailingStopClose(() => {
      closeIntents++;
    });
    pm.setRiskManager(undefined);
    pm.setRiskManager(rm);
    pm.openPosition("strategy-a", makeSymbol(), "long", 0.01, 60_000, 10, 1000);
    // First tick — no breach, equity fed
    pm.updateMarketPrice(makeSymbol(), 60_500);
    // 0.01 BTC × (60_500 - 60_000) = 5 USD unrealized → equity = 10_005
    expect(rm.getDrawdownScaler().getState().currentEquity).toBe(10_005);
    // Second tick — drop below the trail (60_500 - 3*600 = 58_700)
    pm.updateMarketPrice(makeSymbol(), 58_000);
    expect(closeIntents).toBe(1);
    // A risk decision is only a close intent; local exposure remains until a
    // reduce-only execution is confirmed by the order lifecycle.
    expect(pm.getPositionCount()).toBe(1);
  });

  it("derives the trailing ATR proxy from a publicly admitted positive quantity", () => {
    const pm = new PositionManager({
      initialEquityUsd: 10_000,
      maxPositions: 3,
      maxLeverage: 10,
    });
    const rm = new RiskManager({
      trailingStop: { enabled: true, atrPeriod: 14, atrMultiplier: 3, side: "both" },
      kelly: {
        enabled: false,
        fraction: 0.25,
        windowSize: 50,
        minTrades: 10,
        fallbackFraction: 0.01,
        maxFraction: 0.1,
      },
      drawdownScaler: { enabled: false, maxDdPct: 0.2, initialEquity: 10_000 },
    });
    pm.setRiskManager(rm);
    pm.openPosition("atr-proxy", makeSymbol(), "long", 2, 50, 1, 1);

    expect(rm.getSnapshot().trailingStops[0]?.atr).toBe(0.5);
  });

  it("updateMarketPrice feeds RiskManager only when set", () => {
    const pm = new PositionManager({
      initialEquityUsd: 10_000,
      maxPositions: 3,
      maxLeverage: 10,
    });
    // No riskManager set — should be a no-op
    pm.openPosition("strategy-a", makeSymbol(), "long", 0.01, 60_000, 10, 1000);
    pm.updateMarketPrice(makeSymbol(), 60_500);
    expect(pm.getPositionCount()).toBe(1);
  });

  it("closePosition feeds Kelly sizer when riskManager is set", () => {
    const pm = new PositionManager({
      initialEquityUsd: 10_000,
      maxPositions: 3,
      maxLeverage: 10,
    });
    const rm = new RiskManager({
      trailingStop: { enabled: false, atrPeriod: 14, atrMultiplier: 3, side: "both" },
      kelly: {
        enabled: true,
        fraction: 0.25,
        windowSize: 50,
        minTrades: 5,
        fallbackFraction: 0.01,
        maxFraction: 0.1,
      },
      drawdownScaler: { enabled: false, maxDdPct: 0.2, initialEquity: 10_000 },
    });
    pm.setRiskManager(rm);
    pm.openPosition("strategy-a", makeSymbol(), "long", 0.01, 60_000, 10, 1000);
    pm.closePosition("strategy-a", makeSymbol(), 65_000, 1234);
    expect(rm.getKellySizer().getStats().trades).toBe(1);
  });

  it("rejects invalid construction and entry values while treating a duplicate open as an additional fill", () => {
    expect(() => {
      new PositionManager({ initialEquityUsd: 0, maxPositions: 1, maxLeverage: 1 });
    }).toThrow("initialEquityUsd must be positive");
    expect(() => {
      new PositionManager({ initialEquityUsd: 1, maxPositions: 0, maxLeverage: 1 });
    }).toThrow("maxPositions must be >= 1");

    const pm = new PositionManager({ initialEquityUsd: 10_000, maxPositions: 3, maxLeverage: 10 });
    expect(() => pm.openPosition("strategy-a", makeSymbol(), "long", 1, 100, 0)).toThrow("violates 1:10");
    expect(() => pm.openPosition("strategy-a", makeSymbol(), "long", 0, 100, 1)).toThrow(
      "quantity must be positive",
    );
    expect(() => pm.openPosition("strategy-a", makeSymbol(), "long", 1, 0, 1)).toThrow(
      "entryPrice must be positive",
    );

    pm.openPosition("strategy-a", makeSymbol(), "long", 1, 100, 1, 1);
    const averaged = pm.openPosition("strategy-a", makeSymbol(), "long", 1, 110, 1, 2);
    expect(averaged.quantity).toBe(2);
    expect(averaged.entryPrice).toBe(105);
  });

  it("keeps malformed fills and unknown reconciliation from changing a valid position", () => {
    const pm = new PositionManager({ initialEquityUsd: 10_000, maxPositions: 3, maxLeverage: 10 });
    const position = pm.openPosition("strategy-a", makeSymbol(), "long", 1, 100, 1, 1);

    expect(() => {
      pm.recordFill({
        strategy: "strategy-a",
        symbol: makeSymbol(),
        side: "short",
        quantity: 2,
        price: 90,
        leverage: 1,
        timestamp: 2,
      });
    }).toThrow("exceeds opposite position");
    expect(() => pm.closePosition("missing", makeSymbol(), 100)).toThrow("cannot close");

    pm.updateMarketPrice(makeSymbol(), NaN);
    pm.updateMarketPrice(asSymbol("ETH/USDC"), 100);
    expect(pm.getPosition("strategy-a", makeSymbol(), "long")?.currentPrice).toBe(100);
    expect(pm.reconcileVenueAbsent("missing")).toBe(false);
    expect(pm.reconcileVenueAbsent(position.id)).toBe(true);
    expect(pm.getPositionCount()).toBe(0);
  });

  it("permits an explicit realized-PnL restoration after a previously recorded value", () => {
    const pm = new PositionManager({ initialEquityUsd: 10_000, maxPositions: 3, maxLeverage: 10 });
    pm.restoreRealizedPnl(10);
    pm.restoreRealizedPnl(20);
    expect(pm.getRealizedPnl()).toBe(20);
  });
});
