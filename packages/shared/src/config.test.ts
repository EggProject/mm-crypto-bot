/**
 * packages/shared/src/config.test.ts
 *
 * A `loadConfig()` és a `loadAppConfig()` függvények 100% line + branch
 * lefedettségű tesztjei. A `Zod`-validáció forward tesztelést kap
 * (default értékek, env override, érvénytelen input).
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  AppConfigSchema,
  ExchangeFeeConfigSchema,
  PortfolioConfigSchema,
  RiskConfigSchema,
  loadAppConfig,
  loadConfig,
} from "./config.js";
import type { BacktestAppConfig, BacktestRiskConfig, StrategyConfig } from "./config.js";

interface ConfigEnvironmentSnapshot {
  readonly bunEnvironment: string | undefined;
  readonly logLevel: string | undefined;
  readonly ccxtRateLimitMilliseconds: string | undefined;
  readonly strategyHigherTimeframe: string | undefined;
  readonly strategyMediumTimeframe: string | undefined;
  readonly strategyLowerTimeframe: string | undefined;
  readonly strategyRiskPerTrade: string | undefined;
  readonly strategyKellyFraction: string | undefined;
  readonly strategyMaximumDrawdown: string | undefined;
  readonly mode: string | undefined;
  readonly exchange: string | undefined;
  readonly spotTakerFee: string | undefined;
  readonly spotMakerFee: string | undefined;
  readonly borrowRatePerDay: string | undefined;
}

const emptyConfigEnvironment: ConfigEnvironmentSnapshot = {
  bunEnvironment: undefined,
  logLevel: undefined,
  ccxtRateLimitMilliseconds: undefined,
  strategyHigherTimeframe: undefined,
  strategyMediumTimeframe: undefined,
  strategyLowerTimeframe: undefined,
  strategyRiskPerTrade: undefined,
  strategyKellyFraction: undefined,
  strategyMaximumDrawdown: undefined,
  mode: undefined,
  exchange: undefined,
  spotTakerFee: undefined,
  spotMakerFee: undefined,
  borrowRatePerDay: undefined,
};

type MutableConfigEnvironment = NodeJS.ProcessEnv & {
  BUN_ENV?: string;
  LOG_LEVEL?: string;
  CCXT_RATE_LIMIT_MS?: string;
  STRATEGY_HTF_TIMEFRAME?: string;
  STRATEGY_MTF_TIMEFRAME?: string;
  STRATEGY_LTF_TIMEFRAME?: string;
  STRATEGY_RISK_PER_TRADE?: string;
  STRATEGY_KELLY_FRACTION?: string;
  STRATEGY_MAX_DRAWDOWN?: string;
  MODE?: string;
  EXCHANGE?: string;
  SPOT_TAKER_FEE?: string;
  SPOT_MAKER_FEE?: string;
  BORROW_RATE_PER_DAY?: string;
};

const configEnvironment: MutableConfigEnvironment = process.env;

function captureConfigEnvironment(): ConfigEnvironmentSnapshot {
  return {
    bunEnvironment: configEnvironment.BUN_ENV,
    logLevel: configEnvironment.LOG_LEVEL,
    ccxtRateLimitMilliseconds: configEnvironment.CCXT_RATE_LIMIT_MS,
    strategyHigherTimeframe: configEnvironment.STRATEGY_HTF_TIMEFRAME,
    strategyMediumTimeframe: configEnvironment.STRATEGY_MTF_TIMEFRAME,
    strategyLowerTimeframe: configEnvironment.STRATEGY_LTF_TIMEFRAME,
    strategyRiskPerTrade: configEnvironment.STRATEGY_RISK_PER_TRADE,
    strategyKellyFraction: configEnvironment.STRATEGY_KELLY_FRACTION,
    strategyMaximumDrawdown: configEnvironment.STRATEGY_MAX_DRAWDOWN,
    mode: configEnvironment.MODE,
    exchange: configEnvironment.EXCHANGE,
    spotTakerFee: configEnvironment.SPOT_TAKER_FEE,
    spotMakerFee: configEnvironment.SPOT_MAKER_FEE,
    borrowRatePerDay: configEnvironment.BORROW_RATE_PER_DAY,
  };
}

function restoreEnvironmentValue(
  value: string | undefined,
  set: (value: string) => void,
  unset: () => void,
): void {
  if (value === undefined) {
    unset();
  } else {
    set(value);
  }
}

function restoreConfigEnvironment(snapshot: ConfigEnvironmentSnapshot): void {
  restoreEnvironmentValue(
    snapshot.bunEnvironment,
    (value) => (configEnvironment.BUN_ENV = value),
    () => delete configEnvironment.BUN_ENV,
  );
  restoreEnvironmentValue(
    snapshot.logLevel,
    (value) => (configEnvironment.LOG_LEVEL = value),
    () => delete configEnvironment.LOG_LEVEL,
  );
  restoreEnvironmentValue(
    snapshot.ccxtRateLimitMilliseconds,
    (value) => (configEnvironment.CCXT_RATE_LIMIT_MS = value),
    () => delete configEnvironment.CCXT_RATE_LIMIT_MS,
  );
  restoreEnvironmentValue(
    snapshot.strategyHigherTimeframe,
    (value) => (configEnvironment.STRATEGY_HTF_TIMEFRAME = value),
    () => delete configEnvironment.STRATEGY_HTF_TIMEFRAME,
  );
  restoreEnvironmentValue(
    snapshot.strategyMediumTimeframe,
    (value) => (configEnvironment.STRATEGY_MTF_TIMEFRAME = value),
    () => delete configEnvironment.STRATEGY_MTF_TIMEFRAME,
  );
  restoreEnvironmentValue(
    snapshot.strategyLowerTimeframe,
    (value) => (configEnvironment.STRATEGY_LTF_TIMEFRAME = value),
    () => delete configEnvironment.STRATEGY_LTF_TIMEFRAME,
  );
  restoreEnvironmentValue(
    snapshot.strategyRiskPerTrade,
    (value) => (configEnvironment.STRATEGY_RISK_PER_TRADE = value),
    () => delete configEnvironment.STRATEGY_RISK_PER_TRADE,
  );
  restoreEnvironmentValue(
    snapshot.strategyKellyFraction,
    (value) => (configEnvironment.STRATEGY_KELLY_FRACTION = value),
    () => delete configEnvironment.STRATEGY_KELLY_FRACTION,
  );
  restoreEnvironmentValue(
    snapshot.strategyMaximumDrawdown,
    (value) => (configEnvironment.STRATEGY_MAX_DRAWDOWN = value),
    () => delete configEnvironment.STRATEGY_MAX_DRAWDOWN,
  );
  restoreEnvironmentValue(
    snapshot.mode,
    (value) => (configEnvironment.MODE = value),
    () => delete configEnvironment.MODE,
  );
  restoreEnvironmentValue(
    snapshot.exchange,
    (value) => (configEnvironment.EXCHANGE = value),
    () => delete configEnvironment.EXCHANGE,
  );
  restoreEnvironmentValue(
    snapshot.spotTakerFee,
    (value) => (configEnvironment.SPOT_TAKER_FEE = value),
    () => delete configEnvironment.SPOT_TAKER_FEE,
  );
  restoreEnvironmentValue(
    snapshot.spotMakerFee,
    (value) => (configEnvironment.SPOT_MAKER_FEE = value),
    () => delete configEnvironment.SPOT_MAKER_FEE,
  );
  restoreEnvironmentValue(
    snapshot.borrowRatePerDay,
    (value) => (configEnvironment.BORROW_RATE_PER_DAY = value),
    () => delete configEnvironment.BORROW_RATE_PER_DAY,
  );
}

describe("loadConfig — backtest config betöltése", () => {
  const originalEnvironment = captureConfigEnvironment();

  afterEach(() => {
    restoreConfigEnvironment(originalEnvironment);
  });

  it("default értékek: env='paper', logLevel='info', ccxtRateLimitMs=100", () => {
    delete process.env["BUN_ENV"];
    delete process.env["LOG_LEVEL"];
    delete process.env["CCXT_RATE_LIMIT_MS"];
    const config = loadConfig();
    expect(config.env).toBe("paper");
    expect(config.logLevel).toBe("info");
    expect(config.ccxtRateLimitMs).toBe(100);
  });

  it("BUN_ENV=live → env='live'", () => {
    process.env["BUN_ENV"] = "live";
    const config = loadConfig();
    expect(config.env).toBe("live");
  });

  it("LOG_LEVEL env-ből felülírható", () => {
    process.env["LOG_LEVEL"] = "debug";
    const config = loadConfig();
    expect(config.logLevel).toBe("debug");
  });

  it("CCXT_RATE_LIMIT_MS env-ből parsolódik", () => {
    process.env["CCXT_RATE_LIMIT_MS"] = "250";
    const config = loadConfig();
    expect(config.ccxtRateLimitMs).toBe(250);
  });

  it("preserves the accepted decimal-prefix rate limit format", () => {
    process.env["CCXT_RATE_LIMIT_MS"] = "250ms";
    expect(loadConfig().ccxtRateLimitMs).toBe(250);
  });

  it("STRATEGY_* TIMEFRAME env-k felülírják a strategy-t", () => {
    process.env["STRATEGY_HTF_TIMEFRAME"] = "4h";
    process.env["STRATEGY_MTF_TIMEFRAME"] = "1h";
    process.env["STRATEGY_LTF_TIMEFRAME"] = "15m";
    const config = loadConfig();
    expect(config.strategy.htfTimeframe).toBe("4h");
    expect(config.strategy.mtfTimeframe).toBe("1h");
    expect(config.strategy.ltfTimeframe).toBe("15m");
  });

  it("STRATEGY_RISK_PER_TRADE / KELLY_FRACTION / MAX_DRAWDOWN env-k felülírják a risk-ot", () => {
    process.env["STRATEGY_RISK_PER_TRADE"] = "0.02";
    process.env["STRATEGY_KELLY_FRACTION"] = "0.5";
    process.env["STRATEGY_MAX_DRAWDOWN"] = "0.25";
    const config = loadConfig();
    expect(config.risk.riskPerTrade).toBe(0.02);
    expect(config.risk.kellyFraction).toBe(0.5);
    expect(config.risk.maxDrawdown).toBe(0.25);
  });

  it("preserves the accepted decimal-prefix risk format", () => {
    process.env["STRATEGY_RISK_PER_TRADE"] = "0.02risk";
    expect(loadConfig().risk.riskPerTrade).toBe(0.02);
  });

  it("a default strategy 1d/4h/1h", () => {
    delete process.env["STRATEGY_HTF_TIMEFRAME"];
    delete process.env["STRATEGY_MTF_TIMEFRAME"];
    delete process.env["STRATEGY_LTF_TIMEFRAME"];
    const config = loadConfig();
    expect(config.strategy.htfTimeframe).toBe("1d");
    expect(config.strategy.mtfTimeframe).toBe("4h");
    expect(config.strategy.ltfTimeframe).toBe("1h");
  });

  it("a default risk 0.01/0.25/0.15", () => {
    delete process.env["STRATEGY_RISK_PER_TRADE"];
    delete process.env["STRATEGY_KELLY_FRACTION"];
    delete process.env["STRATEGY_MAX_DRAWDOWN"];
    const config = loadConfig();
    expect(config.risk.riskPerTrade).toBe(0.01);
    expect(config.risk.kellyFraction).toBe(0.25);
    expect(config.risk.maxDrawdown).toBe(0.15);
  });
});

describe("loadAppConfig — trading app config betöltése", () => {
  const originalEnvironment = captureConfigEnvironment();

  beforeEach(() => {
    restoreConfigEnvironment(emptyConfigEnvironment);
  });

  afterEach(() => {
    restoreConfigEnvironment(originalEnvironment);
  });

  it("default értékek: mode='paper', exchange='bybiteu', logLevel='info'", () => {
    delete process.env["MODE"];
    delete process.env["EXCHANGE"];
    delete process.env["LOG_LEVEL"];
    const config = loadAppConfig();
    expect(config.mode).toBe("paper");
    expect(config.exchange).toBe("bybiteu");
    expect(config.logLevel).toBe("info");
  });

  it("MODE=live → mode='live'", () => {
    process.env["MODE"] = "live";
    const config = loadAppConfig();
    expect(config.mode).toBe("live");
  });

  it("EXCHANGE=binance → exchange='binance'", () => {
    process.env["EXCHANGE"] = "binance";
    const config = loadAppConfig();
    expect(config.exchange).toBe("binance");
  });

  it("EXCHANGE=okx → exchange='okx'", () => {
    process.env["EXCHANGE"] = "okx";
    const config = loadAppConfig();
    expect(config.exchange).toBe("okx");
  });

  it("SPOT_TAKER_FEE env override", () => {
    process.env["SPOT_TAKER_FEE"] = "0.002";
    const config = loadAppConfig();
    expect(config.fee.spotTakerFee).toBe(0.002);
  });

  it("SPOT_MAKER_FEE env override", () => {
    process.env["SPOT_MAKER_FEE"] = "0.0015";
    const config = loadAppConfig();
    expect(config.fee.spotMakerFee).toBe(0.0015);
  });

  it("BORROW_RATE_PER_DAY env override", () => {
    process.env["BORROW_RATE_PER_DAY"] = "0.0003";
    const config = loadAppConfig();
    expect(config.fee.borrowRatePerDay).toBe(0.0003);
  });

  it("a fee default értékei megmaradnak, ha nincs env", () => {
    delete process.env["SPOT_TAKER_FEE"];
    delete process.env["SPOT_MAKER_FEE"];
    delete process.env["BORROW_RATE_PER_DAY"];
    const config = loadAppConfig();
    expect(config.fee.spotTakerFee).toBe(0.001);
    expect(config.fee.spotMakerFee).toBe(0.001);
    expect(config.fee.borrowRatePerDay).toBe(0.0002);
    expect(config.fee.liquidationFee).toBe(0.02);
    expect(config.fee.maintenanceMarginRatio).toBe(1);
  });

  it("a symbols default: BTC/USDC, ETH/USDC, SOL/USDC", () => {
    const config = loadAppConfig();
    expect(config.symbols).toEqual(["BTC/USDC", "ETH/USDC", "SOL/USDC"]);
  });

  it("a portfolio default allokáció: BTC 50% / ETH 30% / SOL 20%", () => {
    const config = loadAppConfig();
    expect(config.portfolio.allocations.BTC).toBe(0.5);
    expect(config.portfolio.allocations.ETH).toBe(0.3);
    expect(config.portfolio.allocations.SOL).toBe(0.2);
  });

  it("a risk default: 1% risk, 1/4-Kelly, 15% DD, 3 pozíció, 3x leverage", () => {
    const config = loadAppConfig();
    expect(config.risk.riskPerTrade).toBe(0.01);
    expect(config.risk.kellyFraction).toBe(0.25);
    expect(config.risk.maxDrawdownPct).toBe(0.15);
    expect(config.risk.maxPositions).toBe(3);
    expect(config.risk.maxLeverage).toBe(3);
  });

  it("az env={} üres objektum is használható (test-scope isolation)", () => {
    const config = loadAppConfig({});
    expect(config.mode).toBe("paper");
  });
});

describe("AppConfigSchema — Zod validáció", () => {
  it("a default Zod parse sikeres", () => {
    const config = AppConfigSchema.parse({});
    expect(config.mode).toBe("paper");
  });

  it("a mode='backtest' is elfogadott", () => {
    const config = AppConfigSchema.parse({ mode: "backtest" });
    expect(config.mode).toBe("backtest");
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
    expect(() => ExchangeFeeConfigSchema.parse({ maintenanceMarginRatio: 0.001 })).toThrow();
  });

  it("a maintenanceMarginRatio > 1 hibát dob", () => {
    expect(() => ExchangeFeeConfigSchema.parse({ maintenanceMarginRatio: 1.5 })).toThrow();
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
    expect(() => PortfolioConfigSchema.parse({ allocations: { BTC: 1.5 } })).toThrow();
  });

  it("BTC allokáció < 0 hibát dob", () => {
    expect(() => PortfolioConfigSchema.parse({ allocations: { BTC: -0.1 } })).toThrow();
  });
});

describe("Type exports", () => {
  it("a BacktestAppConfig, BacktestRiskConfig, StrategyConfig típusok importálhatók", () => {
    // Type-only check: ha ezek a típusok nem léteznének, a fordítás megbukna.
    const config: BacktestAppConfig = {
      env: "paper",
      logLevel: "info",
      ccxtRateLimitMs: 100,
      strategy: { htfTimeframe: "1d", mtfTimeframe: "4h", ltfTimeframe: "1h" } satisfies StrategyConfig,
      risk: { riskPerTrade: 0.01, kellyFraction: 0.25, maxDrawdown: 0.15 } satisfies BacktestRiskConfig,
    };
    expect(config.env).toBe("paper");
  });
});
