import { describe, expect, it } from "bun:test";

import { PositionManagerError } from "./position-manager.js";
import { PositionManager, makeSymbol } from "./position-manager.test-support.js";

describe("PositionManager", () => {
  // State restoration

  it("Phase 68: restorePosition loads a position without cap or L3 leverage check", () => {
    const pm = new PositionManager({
      initialEquityUsd: 10_000,
      maxPositions: 1, // tight cap
      maxLeverage: 10,
    });
    // The position is restored DIRECTLY, bypassing the maxPositions cap
    // (the perzisztált state 5 pozíciót is tartalmazhat, és a config-cap
    // csökkentése NEM törölhet régi pozíciókat).
    const restored = pm.restorePosition({
      strategy: "dydx_cex_carry",
      symbol: makeSymbol(),
      side: "long",
      quantity: 0.00016667,
      entryPrice: 60_000,
      currentPrice: 59_700,
      leverage: 10,
      unrealizedPnl: -5,
      realizedPnl: 0,
      openedAt: 1_700_000_000_000,
      notionalUsd: 10,
    });
    expect(restored.strategy).toBe("dydx_cex_carry");
    expect(restored.entryPrice).toBe(60_000);
    expect(restored.unrealizedPnl).toBe(-5);
    expect(pm.getPositionCount()).toBe(1);
  });

  it("Phase 68: restorePosition does NOT count against the maxPositions cap for NEW positions", () => {
    // A restored position remains available for same-side fill aggregation.
    const pm = new PositionManager({
      initialEquityUsd: 10_000,
      maxPositions: 1, // only 1 position allowed
      maxLeverage: 10,
    });
    // Restore 1 position (no cap check).
    pm.restorePosition({
      strategy: "dydx_cex_carry",
      symbol: makeSymbol(),
      side: "long",
      quantity: 0.00016667,
      entryPrice: 60_000,
      currentPrice: 59_700,
      leverage: 10,
      unrealizedPnl: -5,
      realizedPnl: 0,
      openedAt: 1_700_000_000_000,
      notionalUsd: 10,
    });
    expect(pm.getPositionCount()).toBe(1);
    // Now try to open a NEW position for the SAME (strategy, symbol, side)
    // — same-side fill averages (no cap).
    pm.recordFill({
      strategy: "dydx_cex_carry",
      symbol: makeSymbol(),
      side: "long",
      quantity: 0.0001,
      price: 60_500,
      leverage: 10,
      timestamp: 1_700_000_001_000,
    });
    expect(pm.getPositionCount()).toBe(1); // still 1, averaged
  });

  it("Phase 68: restorePosition rejects negative quantity/price/leverage", () => {
    const pm = new PositionManager({
      initialEquityUsd: 10_000,
      maxPositions: 3,
      maxLeverage: 10,
    });
    expect(() =>
      pm.restorePosition({
        strategy: "s",
        symbol: makeSymbol(),
        side: "long",
        quantity: 0,
        entryPrice: 60_000,
        currentPrice: 60_000,
        leverage: 10,
        unrealizedPnl: 0,
        realizedPnl: 0,
        openedAt: 1,
        notionalUsd: 0,
      }),
    ).toThrow(PositionManagerError);
    expect(() =>
      pm.restorePosition({
        strategy: "s",
        symbol: makeSymbol(),
        side: "long",
        quantity: 0.01,
        entryPrice: 0,
        currentPrice: 60_000,
        leverage: 10,
        unrealizedPnl: 0,
        realizedPnl: 0,
        openedAt: 1,
        notionalUsd: 600,
      }),
    ).toThrow(PositionManagerError);
    expect(() =>
      pm.restorePosition({
        strategy: "s",
        symbol: makeSymbol(),
        side: "long",
        quantity: 0.01,
        entryPrice: 60_000,
        currentPrice: 60_000,
        leverage: 11, // > 10
        unrealizedPnl: 0,
        realizedPnl: 0,
        openedAt: 1,
        notionalUsd: 600,
      }),
    ).toThrow(PositionManagerError);
  });

  it("Phase 68: restoreRealizedPnl restores the cumulative realized P&L", () => {
    const pm = new PositionManager({
      initialEquityUsd: 10_000,
      maxPositions: 3,
      maxLeverage: 10,
    });
    pm.restoreRealizedPnl(250);
    // After restoring, getEquity() must include the 250 in the computation.
    // (No positions, so unrealizedPnl = 0; equity = 10000 + 250 = 10250)
    expect(pm.getEquity()).toBe(10_250);
    expect(pm.getRealizedPnl()).toBe(250);
  });

  it("Phase 68: restoreClosedTrades loads the history", () => {
    const pm = new PositionManager({
      initialEquityUsd: 10_000,
      maxPositions: 3,
      maxLeverage: 10,
    });
    const trades = [
      {
        strategy: "dydx_cex_carry",
        symbol: makeSymbol(),
        side: "long" as const,
        quantity: 0.01,
        entryPrice: 3000,
        exitPrice: 3250,
        pnl: 2.5,
        pnlPct: 8.33,
        closedAt: 1_700_000_000_000,
      },
      {
        strategy: "dydx_cex_carry",
        symbol: makeSymbol(),
        side: "short" as const,
        quantity: 0.01,
        entryPrice: 3500,
        exitPrice: 3400,
        pnl: 1,
        pnlPct: 2.86,
        closedAt: 1_700_001_000_000,
      },
    ];
    pm.restoreClosedTrades(trades);
    expect(pm.getClosedTrades().length).toBe(2);
    expect(pm.getClosedTrades()[0]?.pnl).toBe(2.5);
  });

  it("Phase 68: restoreClosedTrades retains the newest 1000 valid snapshots", () => {
    const pm = new PositionManager({ initialEquityUsd: 10_000, maxPositions: 3, maxLeverage: 10 });
    const symbol = makeSymbol();
    const trades = Array.from({ length: 1001 }, (_, index) => ({
      strategy: "dydx_cex_carry",
      symbol,
      side: "long" as const,
      quantity: 0.01,
      entryPrice: 3000,
      exitPrice: 3250,
      pnl: 2.5,
      pnlPct: 8.33,
      closedAt: index,
    }));
    pm.restoreClosedTrades(trades);
    expect(pm.getClosedTrades()).toHaveLength(1000);
    expect(pm.getClosedTrades()[0]?.closedAt).toBe(1);
    expect(pm.getClosedTrades().at(-1)?.closedAt).toBe(1000);
  });
});
