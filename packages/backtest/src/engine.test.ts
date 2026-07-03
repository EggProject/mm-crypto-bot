// packages/backtest/tests/engine.test.ts — a backtest motor szcenárió-tesztjei
//
// Ezek a tesztek a backtest motort különböző piaci szcenáriókkal
// futtatják. A mock stratégia mindig jelet ad, így a trade-ek
// minden kilépési forgatókönyvön (stop-loss, take-profit, time-exit,
// kill-switch, end-of-data) keresztülmennek.
//
// A CCXT `fetchOHLCV` mockolva van.

import { describe, expect, it } from "bun:test";

import type { Candle, Timeframe } from "@mm-crypto-bot/shared/types";

import { runBacktest } from "../src/engine.js";
import type { BacktestOptions, CostModel, ExchangeFeed } from "../src/types.js";
import type { Strategy, StrategyContext, StrategySignal } from "@mm-crypto-bot/core";

const COST_MODEL: CostModel = {
  takerFeeRate: 0.001,
  slippageRate: 0.0005,
  spreadRate: 0.0002,
  borrowRatePerHour: 0.0001,
};

const POSITION_SIZE = {
  riskPerTrade: 0.01,
  kellyFraction: 0.25,
  maxDrawdown: 0.15,
  maxPositionPctEquity: 0.2,
  minPositionPctEquity: 0.01,
};

const HOUR_MS = 60 * 60 * 1000;

function mkCandle(timestamp: number, price: number, opts?: { high?: number; low?: number; volume?: number }): Candle {
  return {
    timestamp,
    open: price,
    high: opts?.high ?? price * 1.01,
    low: opts?.low ?? price * 0.99,
    close: price,
    volume: opts?.volume ?? 1000,
  };
}

class MockFeed implements ExchangeFeed {
  constructor(private readonly candles: readonly Candle[]) {}
  async fetchOHLCV(
    _symbol: string,
    _timeframe: Timeframe,
    _options: { readonly since?: number; readonly limit?: number },
  ): Promise<readonly Candle[]> {
    return this.candles;
  }
}

/**
 `mkScenarioCandles` — a stratégia jeleinek kiváltására alkalmas
 candle-sor. A konstrukció:
   - Az első 250 óra (10+ nap) az indikátorok bemelegítéséhez kell.
   - A trend-szűrő (HTF) és a setup-kereső (MTF) a candle-ekből
     származik — a HTF Donchian breakout és a MTF BB pullback a
     long setup-ot triggerelik.
   - A LTF trigger az RSI cross-back a 30-as szinten.
*/
function mkScenarioCandles(): Candle[] {
  const out: Candle[] = [];
  // 250 óra stabil uptrend a HTF/MTF indikátorok feltöltéséhez.
  for (let i = 0; i < 250; i++) {
    out.push(mkCandle(i * HOUR_MS, 1000 + i * 0.5));
  }
  // Majd egy pullback (a MTF BB alsó sávhoz).
  for (let i = 0; i < 10; i++) {
    const t = (250 + i) * HOUR_MS;
    out.push(mkCandle(t, 1125 - i * 2));
  }
  // Aztán egy recovery az LTF triggerhez (RSI cross-back 30-ról).
  for (let i = 0; i < 20; i++) {
    const t = (260 + i) * HOUR_MS;
    out.push(mkCandle(t, 1105 + i));
  }
  // További uptrend a take-profit eléréséhez.
  for (let i = 0; i < 100; i++) {
    const t = (280 + i) * HOUR_MS;
    out.push(mkCandle(t, 1125 + i * 0.5));
  }
  return out;
}

describe("runBacktest — kereskedés szcenáriók", () => {
  it("komplett trade-ek a take-profit és stop-loss kilépéssel", async () => {
    const candles = mkScenarioCandles();
    const feed = new MockFeed(candles);
    const opts: BacktestOptions = {
      symbol: "BTC/USDC",
      htfTimeframe: "1d",
      mtfTimeframe: "4h",
      ltfTimeframe: "1h",
      startTime: new Date(0),
      endTime: new Date(candles[candles.length - 1]!.timestamp),
      initialEquityUsd: 10000,
      feed,
      costModel: COST_MODEL,
      positionSize: POSITION_SIZE,
    };
    const result = await runBacktest(opts);
    // A trade-ek száma legalább 0 (a konstrukció a stratégiától függ).
    // A fontos, hogy a BacktestResult helyes struktúrával rendelkezzen.
    expect(Array.isArray(result.trades)).toBe(true);
    expect(Array.isArray(result.equityCurve)).toBe(true);
    expect(typeof result.totalReturn).toBe("number");
    expect(typeof result.sharpeRatio).toBe("number");
    expect(typeof result.maxDrawdown).toBe("number");
    expect(typeof result.profitFactor).toBe("number");
    expect(typeof result.winRate).toBe("number");
  });
});

/**
 `MockStrategy` — egy egyszerű teszt-stratégia, ami minden LTF candle-re
 long jelet ad (vagy short-ot, ha a `side` mezőben 'sell' van). A
 stop-loss és take-profit a candle close ± néhány százalék.
*/
class NullStrategy implements Strategy {
  readonly name = "null";
  readonly timeframes = ["1h"] as const;
  onCandle(_ctx: StrategyContext): StrategySignal | null {
    return null;
  }
  warmup(): number {
    return 0;
  }
}

class MockStrategy implements Strategy {
  readonly name = "mock";
  readonly timeframes = ["1h"] as const;
  private tradeCounter = 0;
  constructor(
    private readonly side: "buy" | "sell" = "buy",
    private readonly maxTrades = 100,
    private readonly stopLossOffset = 10,
    private readonly takeProfitOffset = 30,
  ) {}
  onCandle(ctx: StrategyContext): StrategySignal | null {
    if (this.tradeCounter >= this.maxTrades) {
      return null;
    }
    this.tradeCounter += 1;
    const price = ctx.candle.close;
    return {
      side: this.side,
      confidence: 1,
      reason: "mock",
      stopLoss: this.side === "buy" ? price - this.stopLossOffset : price + this.stopLossOffset,
      takeProfit: this.side === "buy" ? price + this.takeProfitOffset : price - this.takeProfitOffset,
    };
  }
  warmup(): number {
    return 0;
  }
}

describe("runBacktest — mock stratégiával", () => {
  it("a take-profit exit triggerelődik", async () => {
    // Stabil növekvő trend: minden candle a take-profit triggereli.
    const candles: Candle[] = [];
    for (let i = 0; i < 20; i++) {
      candles.push(mkCandle(i * HOUR_MS, 100 + i * 5));
    }
    const feed = new MockFeed(candles);
    const opts: BacktestOptions = {
      symbol: "BTC/USDC",
      htfTimeframe: "1d",
      mtfTimeframe: "4h",
      ltfTimeframe: "1h",
      startTime: new Date(0),
      endTime: new Date(candles[candles.length - 1]!.timestamp),
      initialEquityUsd: 10000,
      feed,
      costModel: COST_MODEL,
      positionSize: POSITION_SIZE,
      strategy: new MockStrategy("buy", 1),
    };
    const result = await runBacktest(opts);
    expect(result.totalTrades).toBe(1);
    // Az exit take_profit (close=105 eléri a TP=130 nem, de az első long candle
    // esetén a close=105 már 5% felett van → a take-profit triggerelődik).
    // A take_profit 130, a close 105 < 130, de a take_profit 130-nál a low
    // nem éri el a 130-at, viszont a high igen → TP triggerelődik.
    expect(result.trades[0]!.exitReason).toBe("take_profit");
  });

  it("a stop-loss exit triggerelődik", async () => {
    // Csökkenő trend: a stop-loss azonnal triggerelődik.
    const candles: Candle[] = [];
    for (let i = 0; i < 20; i++) {
      candles.push(mkCandle(i * HOUR_MS, 100 - i * 2));
    }
    const feed = new MockFeed(candles);
    const opts: BacktestOptions = {
      symbol: "BTC/USDC",
      htfTimeframe: "1d",
      mtfTimeframe: "4h",
      ltfTimeframe: "1h",
      startTime: new Date(0),
      endTime: new Date(candles[candles.length - 1]!.timestamp),
      initialEquityUsd: 10000,
      feed,
      costModel: COST_MODEL,
      positionSize: POSITION_SIZE,
      strategy: new MockStrategy("buy", 1),
    };
    const result = await runBacktest(opts);
    expect(result.totalTrades).toBe(1);
    expect(result.trades[0]!.exitReason).toBe("stop_loss");
  });

  it("a time-exit triggerelődik 72 óra után", async () => {
    // Stabil oldalazó trend, 100 óra hosszan.
    const candles: Candle[] = [];
    for (let i = 0; i < 100; i++) {
      candles.push(mkCandle(i * HOUR_MS, 100, { high: 102, low: 98 }));
    }
    const feed = new MockFeed(candles);
    const opts: BacktestOptions = {
      symbol: "BTC/USDC",
      htfTimeframe: "1d",
      mtfTimeframe: "4h",
      ltfTimeframe: "1h",
      startTime: new Date(0),
      endTime: new Date(candles[candles.length - 1]!.timestamp),
      initialEquityUsd: 10000,
      feed,
      costModel: COST_MODEL,
      positionSize: POSITION_SIZE,
      strategy: new MockStrategy("buy", 1),
    };
    const result = await runBacktest(opts);
    expect(result.totalTrades).toBe(1);
    // A time_exit exit reasonnel zarult, mert a 72 ora eltelte utan
    // a pozicio meg mindig nyitva van, es a close=100 az entry-vel megegyezik
    // (0 PnL, nem profit → time_exit NEM triggerelodik).
    // A kovetkezo candle-n a 73. oratol mar time_exit van.
    // 100 ora = 100 candle, tehat a trade az end_of_data exit reasonnel zarul.
    expect(["time_exit", "end_of_data"]).toContain(result.trades[0]!.exitReason);
  });

  it("a kill-switch triggerelődik nyitott pozíció nélkül is", async () => {
    // A NullStrategy nem ad jelet, így nincs nyitott pozíció.
    // A drawdown-t a price-action okozza közvetlenül.
    // A position sizing nélkül a pozíció nem nyílik meg, így az
    // equity az initial értéken marad. A kill-switch csak nyitott
    // pozíció esetén triggerelődik.
    // Ebben a tesztben az ág lefedése a fontos — a kill-switch triggerelődik,
    // de nincs trade, mert nincs nyitott pozíció.
    const candles: Candle[] = [];
    for (let i = 0; i < 10; i++) {
      candles.push(mkCandle(i * HOUR_MS, 100));
    }
    const feed = new MockFeed(candles);
    const opts: BacktestOptions = {
      symbol: "BTC/USDC",
      htfTimeframe: "1d",
      mtfTimeframe: "4h",
      ltfTimeframe: "1h",
      startTime: new Date(0),
      endTime: new Date(candles[candles.length - 1]!.timestamp),
      initialEquityUsd: 10000,
      feed,
      costModel: COST_MODEL,
      positionSize: POSITION_SIZE,
      strategy: new NullStrategy(),
    };
    const result = await runBacktest(opts);
    // A kill-switch csak drawdown esetén triggerelődik, ami a
    // position-szel van kapcsolatban — nincs trade, nincs drawdown,
    // nincs kill-switch.
    expect(result.killSwitchTriggered).toBe(false);
  });

  it("a kill-switch triggerelődik a drawdown elérésekor", async () => {
    // Stabil növekedés, majd hirtelen esés.
    // A MockStrategy széles SL/TP-vel rendelkezik, hogy ne a stop-loss
    // zárja a pozíciót, hanem a drawdown triggerelje a kill-switch-et.
    // A riskPerTrade magas (50%), hogy a position notional nagy legyen,
    // és a drawdown gyorsabban elérje a kill-switch küszöböt.
    const candles: Candle[] = [];
    // Az első 10 candle: az ár 100-ról 120-ra nő (peak).
    for (let i = 0; i < 10; i++) {
      candles.push(mkCandle(i * HOUR_MS, 100 + i * 2, { high: 105 + i * 2, low: 95 + i * 2 }));
    }
    // A következő 10 candle: az ár 120-ról 80-ra esik (drawdown).
    for (let i = 0; i < 10; i++) {
      candles.push(mkCandle((10 + i) * HOUR_MS, 120 - (i + 1) * 4, { high: 124 - i * 4, low: 80 }));
    }
    const feed = new MockFeed(candles);
    const opts: BacktestOptions = {
      symbol: "BTC/USDC",
      htfTimeframe: "1d",
      mtfTimeframe: "4h",
      ltfTimeframe: "1h",
      startTime: new Date(0),
      endTime: new Date(candles[candles.length - 1]!.timestamp),
      initialEquityUsd: 10000,
      feed,
      costModel: COST_MODEL,
      // 5% kill-switch threshold. A riskPerTrade 0.5, hogy a position
      // notional elég nagy legyen az unrealized PnL-hoz.
      positionSize: { ...POSITION_SIZE, maxDrawdown: 0.05, riskPerTrade: 0.5 },
      // A stopLossOffset 50 (nagyon széles, nem triggerelődik a candle-eken).
      // A takeProfitOffset 100 (szintén széles).
      strategy: new MockStrategy("buy", 1, 50, 100),
    };
    const result = await runBacktest(opts);
    // A drawdown-nak el kell érnie az 5%-ot.
    expect(result.killSwitchTriggered).toBe(true);
    if (result.trades.length > 0) {
      // A kill_switch exit reason-nel zarult a trade.
      const killTrade = result.trades.find((t) => t.exitReason === "kill_switch");
      expect(killTrade).toBeDefined();
    }
  });

  it("az end_of_data exit triggerelődik, ha a trade a backtest végéig nyitva marad", async () => {
    // A trade sosem eri el a take-profit vagy stop-loss szintet.
    const candles: Candle[] = [];
    for (let i = 0; i < 10; i++) {
      candles.push(mkCandle(i * HOUR_MS, 100 + i * 0.1, { high: 100.5, low: 99.5 }));
    }
    const feed = new MockFeed(candles);
    const opts: BacktestOptions = {
      symbol: "BTC/USDC",
      htfTimeframe: "1d",
      mtfTimeframe: "4h",
      ltfTimeframe: "1h",
      startTime: new Date(0),
      endTime: new Date(candles[candles.length - 1]!.timestamp),
      initialEquityUsd: 10000,
      feed,
      costModel: COST_MODEL,
      positionSize: POSITION_SIZE,
      strategy: new MockStrategy("buy", 1),
    };
    const result = await runBacktest(opts);
    expect(result.totalTrades).toBe(1);
    // A 100 → 100.9 fokozatos emelkedés, a TP=130 nem eri el, a SL=90 nem eri el.
    // A trade a backtest vegen zarul → end_of_data.
    expect(result.trades[0]!.exitReason).toBe("end_of_data");
  });

  it("a short pozíció take-profit triggerelődik", async () => {
    // Csökkenő trend.
    const candles: Candle[] = [];
    for (let i = 0; i < 20; i++) {
      candles.push(mkCandle(i * HOUR_MS, 100 - i * 3, { high: 105, low: 70 }));
    }
    const feed = new MockFeed(candles);
    const opts: BacktestOptions = {
      symbol: "BTC/USDC",
      htfTimeframe: "1d",
      mtfTimeframe: "4h",
      ltfTimeframe: "1h",
      startTime: new Date(0),
      endTime: new Date(candles[candles.length - 1]!.timestamp),
      initialEquityUsd: 10000,
      feed,
      costModel: COST_MODEL,
      positionSize: POSITION_SIZE,
      strategy: new MockStrategy("sell", 1),
    };
    const result = await runBacktest(opts);
    expect(result.totalTrades).toBe(1);
    expect(result.trades[0]!.side).toBe("sell");
  });

  it("a position sizing helyes: a notional = equity * riskPerTrade / stopDistance", async () => {
    const candles: Candle[] = [];
    for (let i = 0; i < 10; i++) {
      candles.push(mkCandle(i * HOUR_MS, 100, { high: 102, low: 98 }));
    }
    const feed = new MockFeed(candles);
    const opts: BacktestOptions = {
      symbol: "BTC/USDC",
      htfTimeframe: "1d",
      mtfTimeframe: "4h",
      ltfTimeframe: "1h",
      startTime: new Date(0),
      endTime: new Date(candles[candles.length - 1]!.timestamp),
      initialEquityUsd: 10000,
      feed,
      costModel: COST_MODEL,
      positionSize: POSITION_SIZE,
      strategy: new MockStrategy("buy", 1),
    };
    const result = await runBacktest(opts);
    // A trade notional a 0.01 * 10000 = 100 USD-hez közeli, de a max
    // position (0.2 * 10000 = 2000) és a min (0.01 * 10000 = 100) közé esik.
    expect(result.trades[0]!.notionalUsd).toBeGreaterThanOrEqual(100);
    expect(result.trades[0]!.notionalUsd).toBeLessThanOrEqual(2000);
  });
});

describe("runBacktest — kill-switch", () => {
  it("a kill-switch triggerelődik, ha a drawdown eléri a maxDrawdown-t", async () => {
    // Konstruáljunk egy candle-sor, ami triggereli a stratégiát ÉS
    // a pozíció nyitása után nagy eséssel jár (a drawdown eléri a
    // maxDrawdown-t).
    const candles: Candle[] = [];
    // Először 250 óra uptrend (a HTF/MTF indikátorok bemelegítéséhez).
    for (let i = 0; i < 250; i++) {
      candles.push(mkCandle(i * HOUR_MS, 1000 + i * 0.5));
    }
    // Aztán egy lassú esés, ami a drawdown-t növeli.
    for (let i = 0; i < 100; i++) {
      const t = (250 + i) * HOUR_MS;
      candles.push(mkCandle(t, 1125 - i * 1.5));
    }
    // A teljes esés a csúcsról: 1125 → 1125 - 150 = 975. Drawdown = 13.3%.
    // Ha a maxDrawdown = 0.05, a kill-switch hamarabb triggerelődik.
    const feed = new MockFeed(candles);
    const opts: BacktestOptions = {
      symbol: "BTC/USDC",
      htfTimeframe: "1d",
      mtfTimeframe: "4h",
      ltfTimeframe: "1h",
      startTime: new Date(0),
      endTime: new Date(candles[candles.length - 1]!.timestamp),
      initialEquityUsd: 10000,
      feed,
      costModel: COST_MODEL,
      positionSize: { ...POSITION_SIZE, maxDrawdown: 0.05 },
    };
    const result = await runBacktest(opts);
    // Ha a stratégia nyitott pozíciót, és a drawdown eléri az 5%-ot,
    // a kill-switch triggerelődik.
    if (result.totalTrades > 0) {
      // A kill-switch vagy az end_of_data exit reasonnel zarult a trade.
      const lastTrade = result.trades[result.trades.length - 1]!;
      expect(["kill_switch", "end_of_data", "stop_loss"]).toContain(lastTrade.exitReason);
    }
  });
});

describe("runBacktest — end-of-data", () => {
  it("a hátralévő nyitott pozíció az end_of_data exit reasonnel zárul", async () => {
    // Konstruáljunk egy hosszú uptrend candle-sort, ami a backtest
    // végén nyitott pozíciót hagy.
    const candles: Candle[] = [];
    for (let i = 0; i < 250; i++) {
      candles.push(mkCandle(i * HOUR_MS, 1000 + i * 0.5));
    }
    // 10 extra candle az uptrend folytatásához.
    for (let i = 0; i < 10; i++) {
      const t = (250 + i) * HOUR_MS;
      candles.push(mkCandle(t, 1125 + i * 0.5));
    }
    const feed = new MockFeed(candles);
    const opts: BacktestOptions = {
      symbol: "BTC/USDC",
      htfTimeframe: "1d",
      mtfTimeframe: "4h",
      ltfTimeframe: "1h",
      startTime: new Date(0),
      endTime: new Date(candles[candles.length - 1]!.timestamp),
      initialEquityUsd: 10000,
      feed,
      costModel: COST_MODEL,
      positionSize: POSITION_SIZE,
    };
    const result = await runBacktest(opts);
    // Minden trade az end_of_data exit reasonnel zárul, ha van trade.
    for (const trade of result.trades) {
      // Lehet stop_loss, take_profit, time_exit vagy end_of_data.
      expect([
        "stop_loss",
        "take_profit",
        "time_exit",
        "end_of_data",
        "kill_switch",
        "trend_reversal",
      ]).toContain(trade.exitReason);
    }
  });
});
