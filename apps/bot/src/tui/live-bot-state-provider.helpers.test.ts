/**
 * apps/bot/src/tui/live-bot-state-provider.helpers.test.ts
 *
 * ============================================================================
 * HELPER UNIT TESTS — Phase 34 coverage fixup
 * ============================================================================
 *
 * Ezek a tesztek a `live-bot-state-provider.ts` belső helper függvényeit
 * (`mapSide`, `mapPosition`, `mapClosedTrade`) egységteszt-szinten
 * fedik le. Az eredeti `wire-up-probe.test.ts` integration teszt soha
 * nem hívja ezeket a helper-eket (mert nincs valódi position / closed
 * trade a bot-on), így a coverage 89.87% volt a fájlon.
 *
 * A user mandate "100% line+branch coverage on apps/bot" → ezek a
 * tesztek hozzák a fájlt 100%-ra.
 *
 * Pattern: export internal helpers + dedicated unit test file.
 *   - Előny: gyors, determinisztikus, edge-case-ek könnyen fedhetők
 *   - Kompromisszum: az export-ok az internal API-t is elérhetővé teszik
 *     (de a fájl külön kommentben dokumentálja, hogy internal-but-testable)
 */

import { describe, expect, it } from "bun:test";

import type { BotState, ClosedTradeSnapshot } from "../bot/state-store.js";

import { mapClosedTrade, mapPosition, mapSide } from "./live-bot-state-provider.js";

/**
 * Készít egy minimal EnginePosition-t a típus-szintű teszteléshez.
 * Az `as unknown as` a típus-szintű cast — a helper csak a mezőket olvassa.
 */
function makeEnginePosition(overrides: Partial<BotState["positions"][number]> = {}): BotState["positions"][number] {
  return {
    id: "test:long:BTC/USDC",
    strategy: "test",
    symbol: "BTC/USDC" as BotState["positions"][number]["symbol"],
    side: "long",
    entryPrice: 60_000,
    quantity: 0.01,
    leverage: 5,
    notionalUsd: 600,
    unrealizedPnl: 50,
    unrealizedPnlPct: 8.33,
    openedAt: 1000,
    closedAt: null,
    currentPrice: 61_000,
    pnlPct: 8.33,
    ...overrides,
  } as BotState["positions"][number];
}

/**
 * Készít egy minimal `ClosedTradeSnapshot`-ot.
 */
function makeClosedTrade(overrides: Partial<ClosedTradeSnapshot> = {}): ClosedTradeSnapshot {
  return {
    id: "test:trade-1",
    strategy: "test",
    symbol: "BTC/USDC" as ClosedTradeSnapshot["symbol"],
    side: "long",
    entryPrice: 60_000,
    exitPrice: 60_500,
    quantity: 0.01,
    pnl: 5,
    pnlPct: 0.83,
    openedAt: 1000,
    closedAt: 2000,
    reason: "exit",
    ...overrides,
  } as ClosedTradeSnapshot;
}

describe("mapSide", () => {
  it("long → buy", () => {
    expect(mapSide("long")).toBe("buy");
  });

  it("short → sell", () => {
    expect(mapSide("short")).toBe("sell");
  });
});

describe("mapPosition", () => {
  it("uses notionalUsd when positive (normal case)", () => {
    const tui = mapPosition(makeEnginePosition({ notionalUsd: 600, unrealizedPnl: 50 }));
    expect(tui.side).toBe("buy");
    expect(tui.id).toBe("test:long:BTC/USDC");
    expect(tui.symbol).toBe("BTC/USDC");
    expect(tui.entryPrice).toBe(60_000);
    expect(tui.currentPrice).toBe(61_000);
    expect(tui.quantity).toBe(0.01);
    expect(tui.leverage).toBe(5);
    expect(tui.unrealizedPnl).toBe(50);
    expect(tui.unrealizedPnlPct).toBeCloseTo(8.333, 2); // 50/600 * 100
    expect(tui.openedAt).toBe(1000);
    expect(tui.stopLoss).toBeNull();
    expect(tui.takeProfit).toBeNull();
  });

  it("falls back to entryPrice*quantity when notionalUsd is 0", () => {
    // notional = 60_000 * 0.01 = 600 (fallback value)
    const tui = mapPosition(makeEnginePosition({ notionalUsd: 0, unrealizedPnl: 30 }));
    expect(tui.unrealizedPnlPct).toBeCloseTo(5.0, 2); // 30/600 * 100
  });

  it("returns 0% PnL when notional is 0 (zero-quantity edge case)", () => {
    // notional = 0 (no fallback possible: 0 * 0 = 0)
    const tui = mapPosition(
      makeEnginePosition({ notionalUsd: 0, entryPrice: 0, quantity: 0, unrealizedPnl: 100 }),
    );
    expect(tui.unrealizedPnlPct).toBe(0);
  });

  it("maps side correctly for both directions", () => {
    const longPos = mapPosition(makeEnginePosition({ side: "long" }));
    const shortPos = mapPosition(makeEnginePosition({ side: "short" }));
    expect(longPos.side).toBe("buy");
    expect(shortPos.side).toBe("sell");
  });
});

describe("mapClosedTrade", () => {
  it("builds a TUI Trade from a ClosedTradeSnapshot", () => {
    const tui = mapClosedTrade(makeClosedTrade(), 0);
    expect(tui.id).toBe("test-BTC/USDC-long-2000-0");
    expect(tui.symbol).toBe("BTC/USDC");
    expect(tui.side).toBe("buy");
    expect(tui.entryPrice).toBe(60_000);
    expect(tui.exitPrice).toBe(60_500);
    expect(tui.quantity).toBe(0.01);
    expect(tui.leverage).toBe(1); // Bot nem tárolja → 1
    expect(tui.pnlUsdt).toBe(5);
    expect(tui.pnlPct).toBe(0.83);
    expect(tui.openedAt).toBe(2000 - 60 * 60 * 1000); // Heurisztika: closedAt - 1h
    expect(tui.closedAt).toBe(2000);
    expect(tui.reason).toBe("test"); // A bot.strategy mezőt használja
  });

  it("index is included in the id (disambiguates same-timestamp trades)", () => {
    const a = mapClosedTrade(makeClosedTrade({ id: "trade-x" }), 7);
    const b = mapClosedTrade(makeClosedTrade({ id: "trade-x" }), 8);
    expect(a.id).not.toBe(b.id);
    expect(a.id).toContain("-7");
    expect(b.id).toContain("-8");
  });

  it("maps short side to sell", () => {
    const tui = mapClosedTrade(makeClosedTrade({ side: "short" }), 0);
    expect(tui.side).toBe("sell");
  });
});
