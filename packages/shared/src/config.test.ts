/**
 * packages/shared/src/config.test.ts
 *
 * A `loadConfig()` és a `loadAppConfig()` függvények 100% line + branch
 * lefedettségű tesztjei. A `Zod`-validáció forward tesztelést kap
 * (default értékek, env override, érvénytelen input).
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  AppConfigSchema,
  ExchangeFeeConfigSchema,
  PortfolioConfigSchema,
  RiskConfigSchema,
  loadAppConfig,
  loadConfig,
} from "./config.js";
import type { BacktestAppConfig, BacktestRiskConfig, StrategyConfig } from "./config.js";

describe("loadConfig — backtest config betöltése", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    // Visszaállítjuk az eredeti env-et minden teszt után.
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) {
        // A `delete` szükséges a teszt izolációhoz — az ESLint
        // `no-dynamic-delete` szabálya alól a teszt kivételt kap.
        // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
        delete process.env[key];
      }
    }
    for (const [key, value] of Object.entries(originalEnv)) {
      process.env[key] = value;
    }
  });

  it("default értékek: env='paper', logLevel='info', ccxtRateLimitMs=100", () => {
    delete process.env["BUN_ENV"];
    delete process.env["LOG_LEVEL"];
    delete process.env["CCXT_RATE_LIMIT_MS"];
    const cfg = loadConfig();
    expect(cfg.env).toBe("paper");
    expect(cfg.logLevel).toBe("info");
    expect(cfg.ccxtRateLimitMs).toBe(100);
  });

  it("BUN_ENV=live → env='live'", () => {
    process.env["BUN_ENV"] = "live";
    const cfg = loadConfig();
    expect(cfg.env).toBe("live");
  });

  it("LOG_LEVEL env-ből felülírható", () => {
    process.env["LOG_LEVEL"] = "debug";
    const cfg = loadConfig();
    expect(cfg.logLevel).toBe("debug");
  });

  it("CCXT_RATE_LIMIT_MS env-ből parsolódik", () => {
    process.env["CCXT_RATE_LIMIT_MS"] = "250";
    const cfg = loadConfig();
    expect(cfg.ccxtRateLimitMs).toBe(250);
  });

  it("STRATEGY_* TIMEFRAME env-k felülírják a strategy-t", () => {
    process.env["STRATEGY_HTF_TIMEFRAME"] = "4h";
    process.env["STRATEGY_MTF_TIMEFRAME"] = "1h";
    process.env["STRATEGY_LTF_TIMEFRAME"] = "15m";
    const cfg = loadConfig();
    expect(cfg.strategy.htfTimeframe).toBe("4h");
    expect(cfg.strategy.mtfTimeframe).toBe("1h");
    expect(cfg.strategy.ltfTimeframe).toBe("15m");
  });

  it("STRATEGY_RISK_PER_TRADE / KELLY_FRACTION / MAX_DRAWDOWN env-k felülírják a risk-ot", () => {
    process.env["STRATEGY_RISK_PER_TRADE"] = "0.02";
    process.env["STRATEGY_KELLY_FRACTION"] = "0.5";
    process.env["STRATEGY_MAX_DRAWDOWN"] = "0.25";
    const cfg = loadConfig();
    expect(cfg.risk.riskPerTrade).toBe(0.02);
    expect(cfg.risk.kellyFraction).toBe(0.5);
    expect(cfg.risk.maxDrawdown).toBe(0.25);
  });

  it("a default strategy 1d/4h/1h", () => {
    delete process.env["STRATEGY_HTF_TIMEFRAME"];
    delete process.env["STRATEGY_MTF_TIMEFRAME"];
    delete process.env["STRATEGY_LTF_TIMEFRAME"];
    const cfg = loadConfig();
    expect(cfg.strategy.htfTimeframe).toBe("1d");
    expect(cfg.strategy.mtfTimeframe).toBe("4h");
    expect(cfg.strategy.ltfTimeframe).toBe("1h");
  });

  it("a default risk 0.01/0.25/0.15", () => {
    delete process.env["STRATEGY_RISK_PER_TRADE"];
    delete process.env["STRATEGY_KELLY_FRACTION"];
    delete process.env["STRATEGY_MAX_DRAWDOWN"];
    const cfg = loadConfig();
    expect(cfg.risk.riskPerTrade).toBe(0.01);
    expect(cfg.risk.kellyFraction).toBe(0.25);
    expect(cfg.risk.maxDrawdown).toBe(0.15);
  });
});

describe("loadAppConfig — trading app config betöltése", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) {
        // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
        delete process.env[key];
      }
    }
    for (const [key, value] of Object.entries(originalEnv)) {
      process.env[key] = value;
    }
  });

  it("default értékek: mode='paper', exchange='bybiteu', logLevel='info'", () => {
    delete process.env["MODE"];
    delete process.env["EXCHANGE"];
    delete process.env["LOG_LEVEL"];
    const cfg = loadAppConfig();
    expect(cfg.mode).toBe("paper");
    expect(cfg.exchange).toBe("bybiteu");
    expect(cfg.logLevel).toBe("info");
  });

  it("MODE=live → mode='live'", () => {
    process.env["MODE"] = "live";
    const cfg = loadAppConfig();
    expect(cfg.mode).toBe("live");
  });

  it("EXCHANGE=binance → exchange='binance'", () => {
    process.env["EXCHANGE"] = "binance";
    const cfg = loadAppConfig();
    expect(cfg.exchange).toBe("binance");
  });

  it("EXCHANGE=okx → exchange='okx'", () => {
    process.env["EXCHANGE"] = "okx";
    const cfg = loadAppConfig();
    expect(cfg.exchange).toBe("okx");
  });

  it("SPOT_TAKER_FEE env override", () => {
    process.env["SPOT_TAKER_FEE"] = "0.002";
    const cfg = loadAppConfig();
    expect(cfg.fee.spotTakerFee).toBe(0.002);
  });

  it("SPOT_MAKER_FEE env override", () => {
    process.env["SPOT_MAKER_FEE"] = "0.0015";
    const cfg = loadAppConfig();
    expect(cfg.fee.spotMakerFee).toBe(0.0015);
  });

  it("BORROW_RATE_PER_DAY env override", () => {
    process.env["BORROW_RATE_PER_DAY"] = "0.0003";
    const cfg = loadAppConfig();
    expect(cfg.fee.borrowRatePerDay).toBe(0.0003);
  });

  it("a fee default értékei megmaradnak, ha nincs env", () => {
    delete process.env["SPOT_TAKER_FEE"];
    delete process.env["SPOT_MAKER_FEE"];
    delete process.env["BORROW_RATE_PER_DAY"];
    const cfg = loadAppConfig();
    expect(cfg.fee.spotTakerFee).toBe(0.001);
    expect(cfg.fee.spotMakerFee).toBe(0.001);
    expect(cfg.fee.borrowRatePerDay).toBe(0.0002);
    expect(cfg.fee.liquidationFee).toBe(0.02);
    expect(cfg.fee.maintenanceMarginRatio).toBe(1.0);
  });

  it("a symbols default: BTC/USDC, ETH/USDC, SOL/USDC", () => {
    const cfg = loadAppConfig();
    expect(cfg.symbols).toEqual(["BTC/USDC", "ETH/USDC", "SOL/USDC"]);
  });

  it("a portfolio default allokáció: BTC 50% / ETH 30% / SOL 20%", () => {
    const cfg = loadAppConfig();
    expect(cfg.portfolio.allocations.BTC).toBe(0.5);
    expect(cfg.portfolio.allocations.ETH).toBe(0.3);
    expect(cfg.portfolio.allocations.SOL).toBe(0.2);
  });

  it("a risk default: 1% risk, 1/4-Kelly, 15% DD, 3 pozíció, 3x leverage", () => {
    const cfg = loadAppConfig();
    expect(cfg.risk.riskPerTrade).toBe(0.01);
    expect(cfg.risk.kellyFraction).toBe(0.25);
    expect(cfg.risk.maxDrawdownPct).toBe(0.15);
    expect(cfg.risk.maxPositions).toBe(3);
    expect(cfg.risk.maxLeverage).toBe(3);
  });

  it("az env={} üres objektum is használható (test-scope isolation)", () => {
    const cfg = loadAppConfig({});
    expect(cfg.mode).toBe("paper");
  });
});

describe("AppConfigSchema — Zod validáció", () => {
  it("a default Zod parse sikeres", () => {
    const cfg = AppConfigSchema.parse({});
    expect(cfg.mode).toBe("paper");
  });

  it("a mode='backtest' is elfogadott", () => {
    const cfg = AppConfigSchema.parse({ mode: "backtest" });
    expect(cfg.mode).toBe("backtest");
  });

  it("a mode='invalid' Zod hibát dob", () => {
    expect(() => AppConfigSchema.parse({ mode: "invalid" })).toThrow();
  });

  it("a spotTakerFee > 0.1 Zod hibát dob (max 0.1)", () => {
    expect(() => AppConfigSchema.parse({ fee: { spotTakerFee: 0.5 } })).toThrow();
  });

  it("a spotTakerFee < 0 Zod hibát dob (min 0)", () => {
    expect(() => AppConfigSchema.parse({ fee: { spotTakerFee: -0.1 } })).toThrow();
  });

  it("a riskPerTrade > 0.05 Zod hibát dob", () => {
    expect(() => AppConfigSchema.parse({ risk: { riskPerTrade: 0.5 } })).toThrow();
  });

  it("a maxLeverage > 10 Zod hibát dob (bybit.eu constraint)", () => {
    expect(() => AppConfigSchema.parse({ risk: { maxLeverage: 50 } })).toThrow();
  });

  it("a maxLeverage < 1 Zod hibát dob", () => {
    expect(() => AppConfigSchema.parse({ risk: { maxLeverage: 0 } })).toThrow();
  });
});

describe("ExchangeFeeConfigSchema — Zod validáció", () => {
  it("a default parse sikeres", () => {
    const f = ExchangeFeeConfigSchema.parse({});
    expect(f.spotTakerFee).toBe(0.001);
  });

  it("a liquidationFee > 0.1 hibát dob", () => {
    expect(() => ExchangeFeeConfigSchema.parse({ liquidationFee: 0.5 })).toThrow();
  });

  it("a maintenanceMarginRatio < 0.01 hibát dob", () => {
    expect(() =>
      ExchangeFeeConfigSchema.parse({ maintenanceMarginRatio: 0.001 }),
    ).toThrow();
  });

  it("a maintenanceMarginRatio > 1 hibát dob", () => {
    expect(() =>
      ExchangeFeeConfigSchema.parse({ maintenanceMarginRatio: 1.5 }),
    ).toThrow();
  });
});

describe("RiskConfigSchema — Zod validáció", () => {
  it("a default parse sikeres", () => {
    const r = RiskConfigSchema.parse({});
    expect(r.riskPerTrade).toBe(0.01);
  });

  it("a riskPerTrade < 0.001 hibát dob", () => {
    expect(() => RiskConfigSchema.parse({ riskPerTrade: 0.0001 })).toThrow();
  });

  it("a kellyFraction < 0.05 hibát dob", () => {
    expect(() => RiskConfigSchema.parse({ kellyFraction: 0.01 })).toThrow();
  });

  it("a kellyFraction > 1 hibát dob", () => {
    expect(() => RiskConfigSchema.parse({ kellyFraction: 2 })).toThrow();
  });

  it("a maxDrawdownPct < 0.01 hibát dob", () => {
    expect(() => RiskConfigSchema.parse({ maxDrawdownPct: 0.001 })).toThrow();
  });

  it("a maxDrawdownPct > 0.5 hibát dob", () => {
    expect(() => RiskConfigSchema.parse({ maxDrawdownPct: 1 })).toThrow();
  });

  it("a maxPositions nem-egész hibát dob", () => {
    expect(() => RiskConfigSchema.parse({ maxPositions: 3.5 })).toThrow();
  });

  it("a maxPositions < 1 hibát dob", () => {
    expect(() => RiskConfigSchema.parse({ maxPositions: 0 })).toThrow();
  });

  it("a maxPositions > 20 hibát dob", () => {
    expect(() => RiskConfigSchema.parse({ maxPositions: 21 })).toThrow();
  });
});

describe("PortfolioConfigSchema — Zod validáció", () => {
  it("a default parse sikeres", () => {
    const p = PortfolioConfigSchema.parse({});
    expect(p.allocations.BTC).toBe(0.5);
  });

  it("BTC allokáció > 1 hibát dob", () => {
    expect(() =>
      PortfolioConfigSchema.parse({ allocations: { BTC: 1.5 } }),
    ).toThrow();
  });

  it("BTC allokáció < 0 hibát dob", () => {
    expect(() =>
      PortfolioConfigSchema.parse({ allocations: { BTC: -0.1 } }),
    ).toThrow();
  });
});

describe("Type exports", () => {
  it("a BacktestAppConfig, BacktestRiskConfig, StrategyConfig típusok importálhatók", () => {
    // Type-only check: ha ezek a típusok nem léteznének, a fordítás megbukna.
    const cfg: BacktestAppConfig = {
      env: "paper",
      logLevel: "info",
      ccxtRateLimitMs: 100,
      strategy: { htfTimeframe: "1d", mtfTimeframe: "4h", ltfTimeframe: "1h" } as StrategyConfig,
      risk: { riskPerTrade: 0.01, kellyFraction: 0.25, maxDrawdown: 0.15 } as BacktestRiskConfig,
    };
    expect(cfg.env).toBe("paper");
  });
});
