/**
 * packages/tui/src/providers/BotStateProvider.test.ts
 *
 * A `BotStateProvider` interfész és a `emptyStatistics` / `emptyStatus`
 * / `emptyBotState` segédfüggvények 100% line + branch tesztjei.
 *
 * A tesztek a factory függvények kimenetét ellenőrzik; maga a provider
 * interfész csak típus-szinten létezik (a `SimulatedProvider` és a
 * `PaperProvider` valósítják meg).
 */

import { describe, expect, it } from "bun:test";
import {
  emptyBotState,
  emptyStatistics,
  emptyStatus,
} from "./BotStateProvider.js";

describe("emptyStatistics — induló stat panel", () => {
  it("minden mező 0 vagy a kezdő equity", () => {
    const s = emptyStatistics(10_000);
    expect(s.totalPnlUsdt).toBe(0);
    expect(s.totalPnlPct).toBe(0);
    expect(s.winRate).toBe(0);
    expect(s.totalTrades).toBe(0);
    expect(s.winningTrades).toBe(0);
    expect(s.losingTrades).toBe(0);
    expect(s.maxDrawdownPct).toBe(0);
    expect(s.currentDrawdownPct).toBe(0);
    expect(s.avgWinPnl).toBe(0);
    expect(s.avgLossPnl).toBe(0);
    expect(s.bestTradePnl).toBe(0);
    expect(s.worstTradePnl).toBe(0);
    expect(s.profitFactor).toBe(0);
    expect(s.sharpeRatio).toBe(0);
    expect(s.equityUsdt).toBe(10_000);
    expect(s.initialEquityUsdt).toBe(10_000);
  });

  it("a tetszőleges initialEquity értéket átveszi", () => {
    const s = emptyStatistics(50_000);
    expect(s.equityUsdt).toBe(50_000);
    expect(s.initialEquityUsdt).toBe(50_000);
  });
});

describe("emptyStatus — induló provider-státusz", () => {
  it("tui-only mód, nincs hiba: engineAvailable=true, connected=false", () => {
    const s = emptyStatus("tui-only");
    expect(s.mode).toBe("tui-only");
    expect(s.engineAvailable).toBe(true);
    expect(s.engineError).toBeNull();
    expect(s.connected).toBe(false);
    expect(s.lastUpdate).toBe(0);
  });

  it("with-bot mód, nincs hiba", () => {
    const s = emptyStatus("with-bot");
    expect(s.mode).toBe("with-bot");
    expect(s.engineAvailable).toBe(true);
    expect(s.engineError).toBeNull();
  });

  it("hibaüzenettel: engineAvailable=false, engineError=<msg>", () => {
    const s = emptyStatus("with-bot", "nincs paper-motor");
    expect(s.engineAvailable).toBe(false);
    expect(s.engineError).toBe("nincs paper-motor");
  });
});

describe("emptyBotState — induló teljes BotState", () => {
  it("tui-only mód, 10k equity, nincs hiba", () => {
    const b = emptyBotState("tui-only", 10_000);
    expect(b.status.mode).toBe("tui-only");
    expect(b.running).toBe(false);
    expect(b.killSwitch).toBe("armed");
    expect(b.positions).toEqual([]);
    expect(b.history).toEqual([]);
    expect(b.tickers).toEqual([]);
    expect(b.tickerEvents).toEqual([]);
    expect(b.paused).toBe(false);
    expect(b.killSwitchThresholdPct).toBe(-10);
    expect(b.statistics.equityUsdt).toBe(10_000);
  });

  it("with-bot mód, hibaüzenettel", () => {
    const b = emptyBotState("with-bot", 5_000, "engine down");
    expect(b.status.mode).toBe("with-bot");
    expect(b.status.engineError).toBe("engine down");
    expect(b.statistics.equityUsdt).toBe(5_000);
  });
});
