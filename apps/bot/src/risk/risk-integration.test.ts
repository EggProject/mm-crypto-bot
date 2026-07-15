/**
 * apps/bot/src/risk/risk-integration.test.ts
 *
 * Integration test for the Phase 37 Track 1 adaptive risk management
 * modules. Wires the `RiskManager` into a mock `PositionManager` and
 * simulates a price series to verify:
 *
 *   1. The trailing stop fires on a long-position drawdown.
 *   2. The Kelly sizer returns a non-zero size after enough warmup trades.
 *   3. The drawdown scaler blocks new positions in the kill region.
 *   4. The orchestrator composites the three modules correctly.
 *
 * This test does NOT import the live `Bot` class — it uses the
 * `PositionManager` directly (which is the surface the RiskManager
 * interacts with via callbacks). The full `Bot` integration is
 * exercised in the live wire-up tests.
 */

import { describe, expect, it } from "bun:test";
import { asSymbol, type Symbol as ExchangeSymbol } from "@mm-crypto-bot/exchange";

import { PositionManager } from "../bot/position-manager.js";
import { RiskManager } from "./risk-manager.js";

function makeSymbol(): ExchangeSymbol {
  return asSymbol("BTC/USDC") as unknown as ExchangeSymbol;
}

interface ScenarioStep {
  readonly label: string;
  readonly price: number;
  readonly atr: number;
}

describe("RiskManager integration", () => {
  it("trailing stop fires close callback when price breaches the trail", () => {
    const pm = new PositionManager({ initialEquityUsd: 10_000, maxPositions: 3, maxLeverage: 10 });
    const rm = new RiskManager({
      trailingStop: { enabled: true, atrPeriod: 14, atrMultiplier: 3.0, side: "both" },
      kelly: { enabled: false, fraction: 0.25, windowSize: 50, minTrades: 10, fallbackFraction: 0.01, maxFraction: 0.1 },
      drawdownScaler: { enabled: false, maxDdPct: 0.20, initialEquity: 10_000 },
    });

    pm.openPosition("strategy-a", makeSymbol(), "long", 0.01, 60_000, 10, 1_000);
    rm.armTrailingStop("strategy-a:BTC/USDC:long", "long", 60_000, 100);

    const closeEvents: { positionId: string; closePrice: number; reason: string }[] = [];
    rm.onTrailingStopClose((e) => closeEvents.push(e));

    // Simulate: 60_500 (favorable) → 60_100 (breach)
    const steps: ScenarioStep[] = [
      { label: "favorable move", price: 60_500, atr: 100 },
      { label: "breach", price: 60_100, atr: 100 },
    ];
    for (const step of steps) {
      const decision = rm.onTick({
        positionId: "strategy-a:BTC/USDC:long",
        side: "long",
        currentPrice: step.price,
        atr: step.atr,
      });
      if (decision.kind === "close") {
        const pnl = pm.closePosition("strategy-a", makeSymbol(), decision.closePrice, 2_000);
        rm.disarmTrailingStop("strategy-a:BTC/USDC:long");
        expect(pnl).toBeDefined();
      }
    }

    expect(closeEvents.length).toBe(1);
    expect(closeEvents[0]?.closePrice).toBe(60_200);
    expect(pm.getPositionCount()).toBe(0);
  });

  it("Kelly sizer returns a sized position after warmup trades", () => {
    const rm = new RiskManager({
      trailingStop: { enabled: false, atrPeriod: 14, atrMultiplier: 3.0, side: "both" },
      kelly: { enabled: true, fraction: 0.25, windowSize: 50, minTrades: 10, fallbackFraction: 0.01, maxFraction: 0.1 },
      drawdownScaler: { enabled: false, maxDdPct: 0.20, initialEquity: 10_000 },
    });
    // Cold start: 5 trades → fallbackFraction 0.01
    for (let i = 0; i < 5; i++) rm.onTradeClosed(100, i);
    const sizeCold = rm.evaluateNewPositionSize({ equityUsd: 10_000, baseSizeFraction: 0.05 });
    expect(sizeCold).toBeCloseTo(0.01, 6);

    // Hot: 12 wins, 2 losses → p≈0.857, b=2 → full=0.786, 0.25×=0.196, capped at 0.10
    for (let i = 0; i < 7; i++) rm.onTradeClosed(100, 100 + i);
    for (let i = 0; i < 2; i++) rm.onTradeClosed(-50, 200 + i);
    const sizeHot = rm.evaluateNewPositionSize({ equityUsd: 10_000, baseSizeFraction: 0.05 });
    expect(sizeHot).toBeCloseTo(0.1, 6);
  });

  it("drawdown scaler blocks new positions in kill region", () => {
    const rm = new RiskManager({
      trailingStop: { enabled: false, atrPeriod: 14, atrMultiplier: 3.0, side: "both" },
      kelly: { enabled: false, fraction: 0.25, windowSize: 50, minTrades: 10, fallbackFraction: 0.01, maxFraction: 0.1 },
      drawdownScaler: { enabled: true, maxDdPct: 0.20, initialEquity: 10_000 },
    });
    // Simulate equity drop → kill region
    rm.onEquityUpdate(8_000); // -20% from 10_000 = 100% of 20% → kill
    const size = rm.evaluateNewPositionSize({ equityUsd: 8_000, baseSizeFraction: 0.05 });
    expect(size).toBe(0);
    expect(rm.getSnapshot().canOpenNewPosition).toBe(false);
  });

  it("orchestrator: trail fires + Kelly size + drawdown scale combine correctly", () => {
    const pm = new PositionManager({ initialEquityUsd: 10_000, maxPositions: 3, maxLeverage: 10 });
    const rm = new RiskManager({
      trailingStop: { enabled: true, atrPeriod: 14, atrMultiplier: 3.0, side: "both" },
      kelly: { enabled: true, fraction: 0.25, windowSize: 50, minTrades: 5, fallbackFraction: 0.01, maxFraction: 0.1 },
      drawdownScaler: { enabled: true, maxDdPct: 0.20, initialEquity: 10_000 },
    });
    // Pre-warm Kelly with 7 wins + 3 losses → active region
    for (let i = 0; i < 7; i++) rm.onTradeClosed(100, i);
    for (let i = 0; i < 3; i++) rm.onTradeClosed(-100, 100 + i);
    // Pre-warm equity to 11_000 (new peak) so drawdown scaler is normal
    rm.onEquityUpdate(11_000);
    // size = 0.1 × 1.0 = 0.1
    const size1 = rm.evaluateNewPositionSize({ equityUsd: 11_000, baseSizeFraction: 0.05 });
    expect(size1).toBeCloseTo(0.1, 6);

    // Now a 10% drawdown → caution region → size halved
    rm.onEquityUpdate(9_900); // -10% from 11_000 = 50% of 20% → caution
    const size2 = rm.evaluateNewPositionSize({ equityUsd: 9_900, baseSizeFraction: 0.05 });
    expect(size2).toBeCloseTo(0.05, 6);

    // 18% drawdown → kill region → size 0
    rm.onEquityUpdate(9_020); // -18% from 11_000 = 90% of 20% → kill
    const size3 = rm.evaluateNewPositionSize({ equityUsd: 9_020, baseSizeFraction: 0.05 });
    expect(size3).toBe(0);

    // The trailing stop on a long position still works independently.
    pm.openPosition("strategy-a", makeSymbol(), "long", 0.01, 60_000, 10, 1_000);
    rm.armTrailingStop("strategy-a:BTC/USDC:long", "long", 60_000, 100);
    const closes: { closePrice: number }[] = [];
    rm.onTrailingStopClose((e) => closes.push({ closePrice: e.closePrice }));
    rm.onTick({ positionId: "strategy-a:BTC/USDC:long", side: "long", currentPrice: 60_500, atr: 100 });
    rm.onTick({ positionId: "strategy-a:BTC/USDC:long", side: "long", currentPrice: 60_100, atr: 100 });
    expect(closes.length).toBe(1);
    expect(closes[0]?.closePrice).toBe(60_200);
  });

  it("short-side trailing stop fires on upward breach", () => {
    const pm = new PositionManager({ initialEquityUsd: 10_000, maxPositions: 3, maxLeverage: 10 });
    const rm = new RiskManager({
      trailingStop: { enabled: true, atrPeriod: 14, atrMultiplier: 3.0, side: "both" },
      kelly: { enabled: false, fraction: 0.25, windowSize: 50, minTrades: 10, fallbackFraction: 0.01, maxFraction: 0.1 },
      drawdownScaler: { enabled: false, maxDdPct: 0.20, initialEquity: 10_000 },
    });
    pm.openPosition("strategy-a", makeSymbol(), "short", 0.01, 60_000, 10, 1_000);
    rm.armTrailingStop("strategy-a:BTC/USDC:short", "short", 60_000, 100);
    const closes: { closePrice: number }[] = [];
    rm.onTrailingStopClose((e) => closes.push({ closePrice: e.closePrice }));
    // Move favorably down
    rm.onTick({ positionId: "strategy-a:BTC/USDC:short", side: "short", currentPrice: 59_500, atr: 100 });
    // Pop up through the trail
    rm.onTick({ positionId: "strategy-a:BTC/USDC:short", side: "short", currentPrice: 59_900, atr: 100 });
    expect(closes.length).toBe(1);
    expect(closes[0]?.closePrice).toBe(59_800);
  });

  it("getSnapshot returns a coherent picture", () => {
    const rm = new RiskManager({
      trailingStop: { enabled: true, atrPeriod: 14, atrMultiplier: 3.0, side: "both" },
      kelly: { enabled: true, fraction: 0.25, windowSize: 50, minTrades: 5, fallbackFraction: 0.01, maxFraction: 0.1 },
      drawdownScaler: { enabled: true, maxDdPct: 0.20, initialEquity: 10_000 },
    });
    rm.armTrailingStop("a", "long", 60_000, 100);
    rm.onEquityUpdate(11_000);
    for (let i = 0; i < 7; i++) rm.onTradeClosed(100, i);
    for (let i = 0; i < 3; i++) rm.onTradeClosed(-100, 100 + i);
    const snap = rm.getSnapshot();
    expect(snap.canOpenNewPosition).toBe(true);
    expect(snap.trailingStops.length).toBe(1);
    expect(snap.kelly.region).toBe("active");
    expect(snap.drawdown.region).toBe("normal");
  });
});
