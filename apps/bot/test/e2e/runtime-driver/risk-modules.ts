import type { Logger } from "@mm-crypto-bot/shared";

import { DrawdownScaler } from "../../../src/risk/drawdown-scaler.js";
import { KellySizer, computeStats, kellyFraction } from "../../../src/risk/kelly.js";
import { RiskManager } from "../../../src/risk/risk-manager.js";
import { TrailingStopManager } from "../../../src/risk/trailing-stop.js";

import { assertCondition, expectFailure, quietLogger, withoutLogger } from "./runtime-driver-core.js";

function exerciseTrailingStops(): void {
  const config = {
    enabled: true,
    atrPeriod: 14,
    atrMultiplier: 2,
    side: "both" as const,
    logger: quietLogger,
  };
  expectFailure(() => new TrailingStopManager({ ...config, atrMultiplier: NaN }), "NaN ATR multiplier");
  expectFailure(() => new TrailingStopManager({ ...config, atrMultiplier: 0 }), "zero ATR multiplier");
  expectFailure(() => new TrailingStopManager({ ...config, atrPeriod: 1.5 }), "fractional ATR period");
  expectFailure(() => new TrailingStopManager({ ...config, atrPeriod: 0 }), "zero ATR period");

  const disabled = new TrailingStopManager({ ...config, enabled: false });
  expectFailure(() => disabled.arm("disabled", "long", 100, 2), "disabled trailing stop");
  assertCondition(!disabled.isEnabled(), "disabled trailing stop reported enabled");

  const manager = new TrailingStopManager(config);
  new TrailingStopManager(withoutLogger(config));
  expectFailure(() => manager.arm("bad-price-nan", "long", NaN, 2), "NaN entry price");
  expectFailure(() => manager.arm("bad-price-zero", "long", 0, 2), "zero entry price");
  expectFailure(() => manager.arm("bad-atr-nan", "long", 100, NaN), "NaN arm ATR");
  expectFailure(() => manager.arm("bad-atr-zero", "long", 100, 0), "zero arm ATR");

  manager.evaluate({ positionId: "missing", side: "long", currentPrice: 100, atr: 2 });
  manager.arm("long", "long", 100, 2);
  manager.arm("short", "short", 100, 2);
  manager.getState("long");
  manager.getState("missing");
  manager.getAllStates();
  assertCondition(manager.shouldTrackSide("long"), "both-side filter rejected long");
  const longOnly = new TrailingStopManager({ ...config, side: "long" });
  assertCondition(longOnly.shouldTrackSide("long"), "long filter rejected long");
  assertCondition(!longOnly.shouldTrackSide("short"), "long filter accepted short");
  manager.updateAtr("missing", 2);
  manager.updateAtr("long", NaN);
  manager.updateAtr("long", 0);
  manager.updateAtr("long", 1);
  manager.updateAtr("short", 1);
  manager.evaluate({ positionId: "long", side: "long", currentPrice: NaN, atr: 1 });
  manager.evaluate({ positionId: "long", side: "long", currentPrice: 0, atr: 1 });
  manager.evaluate({ positionId: "long", side: "long", currentPrice: 101, atr: NaN });
  manager.evaluate({ positionId: "long", side: "long", currentPrice: 101, atr: 0 });
  manager.evaluate({ positionId: "long", side: "long", currentPrice: 110, atr: 2 });
  manager.evaluate({ positionId: "long", side: "long", currentPrice: 108, atr: 2 });
  const longClose = manager.evaluate({ positionId: "long", side: "long", currentPrice: 105, atr: 2 });
  assertCondition(longClose.kind === "close", "long trail did not close");
  manager.evaluate({ positionId: "short", side: "short", currentPrice: 90, atr: 2 });
  manager.evaluate({ positionId: "short", side: "short", currentPrice: 92, atr: 2 });
  const shortClose = manager.evaluate({ positionId: "short", side: "short", currentPrice: 95, atr: 2 });
  assertCondition(shortClose.kind === "close", "short trail did not close");
  manager.disarm("long");
  manager.disarm("long");
  assertCondition(manager.getAtrPeriod() === 14, "ATR period changed");
}

function exerciseDrawdownScaler(): void {
  const config = { enabled: true, maxDdPct: 0.2, initialEquity: 1000, logger: quietLogger };
  expectFailure(() => new DrawdownScaler({ ...config, maxDdPct: NaN }), "NaN drawdown cap");
  expectFailure(() => new DrawdownScaler({ ...config, maxDdPct: 0 }), "zero drawdown cap");
  expectFailure(() => new DrawdownScaler({ ...config, maxDdPct: 1.1 }), "large drawdown cap");
  expectFailure(() => new DrawdownScaler({ ...config, initialEquity: NaN }), "NaN initial equity");
  expectFailure(() => new DrawdownScaler({ ...config, initialEquity: 0 }), "zero initial equity");
  const disabled = new DrawdownScaler({ ...withoutLogger(config), enabled: false });
  assertCondition(disabled.scaleFactor() === 1, "disabled drawdown scaler changed size");
  const scaler = new DrawdownScaler(config);
  scaler.updateEquity(NaN);
  scaler.updateEquity(0);
  scaler.updateEquity(1100);
  scaler.updateEquity(1000);
  assertCondition(scaler.scaleFactor() === 1, "normal drawdown scale mismatch");
  scaler.updateEquity(950);
  assertCondition(scaler.scaleFactor() === 0.5, "caution drawdown scale mismatch");
  scaler.updateEquity(900);
  assertCondition(!scaler.canOpenNew(), "kill drawdown allowed a position");
  scaler.getState();
  scaler.reset(NaN);
  scaler.reset(0);
  scaler.reset(1200);
  assertCondition(scaler.canOpenNew(), "reset drawdown did not reopen sizing");
  DrawdownScaler.scaleFactorForRegion("normal");
  DrawdownScaler.scaleFactorForRegion("caution");
  DrawdownScaler.scaleFactorForRegion("kill");
}

function throwBaselineFault(failure: Error | string): never {
  // eslint-disable-next-line @typescript-eslint/only-throw-error -- Exercises callback handling when the thrown value is not an Error.
  throw failure;
}

function makeKelly(isEnabled: boolean, logger: Logger | undefined = quietLogger): KellySizer {
  return new KellySizer({
    enabled: isEnabled,
    fraction: 0.5,
    windowSize: 3,
    minTrades: 2,
    fallbackFraction: 0.01,
    maxFraction: 0.2,
    logger,
  });
}

function exerciseKelly(): void {
  for (const winRate of [NaN, -0.1, 1.1]) {
    expectFailure(() => kellyFraction(winRate, 1), "invalid Kelly win rate");
  }
  for (const ratio of [NaN, -1]) {
    expectFailure(() => kellyFraction(0.5, ratio), "invalid Kelly ratio");
  }
  kellyFraction(0.5, 0);
  kellyFraction(0.2, 1);
  kellyFraction(1, 0.5);
  computeStats([]);
  computeStats([{ pnlUsd: 0, closedAt: 1 }]);
  computeStats([{ pnlUsd: 10, closedAt: 1 }]);
  computeStats([{ pnlUsd: -5, closedAt: 1 }]);
  computeStats([
    { pnlUsd: 10, closedAt: 1 },
    { pnlUsd: -5, closedAt: 2 },
  ]);

  const base = {
    enabled: true,
    fraction: 0.5,
    windowSize: 3,
    minTrades: 2,
    fallbackFraction: 0.01,
    maxFraction: 0.2,
    logger: quietLogger,
  };
  for (const fraction of [NaN, 0, 1.1])
    expectFailure(() => new KellySizer({ ...base, fraction }), "invalid Kelly fraction");
  for (const windowSize of [1.5, 0])
    expectFailure(() => new KellySizer({ ...base, windowSize }), "invalid Kelly window");
  for (const minTrades of [1.5, 0])
    expectFailure(() => new KellySizer({ ...base, minTrades }), "invalid Kelly minimum");
  for (const fallbackFraction of [NaN, -0.1, 1.1])
    expectFailure(() => new KellySizer({ ...base, fallbackFraction }), "invalid Kelly fallback");
  for (const maxFraction of [NaN, 0, 1.1])
    expectFailure(() => new KellySizer({ ...base, maxFraction }), "invalid Kelly maximum");

  const disabled = makeKelly(false, undefined);
  assertCondition(disabled.recommendedSize() === 0, "disabled Kelly returned size");
  disabled.getStats();
  new KellySizer(withoutLogger(base));
  const kelly = makeKelly(true);
  assertCondition(kelly.recommendedSize() === 0.01, "Kelly cold-start fallback mismatch");
  kelly.recordClosedTrade({ pnlUsd: NaN, closedAt: 0 });
  kelly.recordClosedTrade({ pnlUsd: -10, closedAt: 1 });
  kelly.getStats();
  kelly.recordClosedTrade({ pnlUsd: -10, closedAt: 2 });
  assertCondition(kelly.recommendedSize() === 0, "no-edge Kelly returned size");
  kelly.getStats();
  kelly.recordClosedTrade({ pnlUsd: 100, closedAt: 3 });
  kelly.recordClosedTrade({ pnlUsd: 100, closedAt: 4 });
  assertCondition(kelly.recommendedSize() <= 0.2, "Kelly maximum cap failed");
  kelly.getStats();
  kelly.reset();
  assertCondition(kelly.isEnabled(), "enabled Kelly reported disabled");
}

function riskConfig(isEnabled: boolean) {
  return {
    trailingStop: { enabled: isEnabled, atrPeriod: 14, atrMultiplier: 2, side: "both" as const },
    kelly: {
      enabled: isEnabled,
      fraction: 0.5,
      windowSize: 3,
      minTrades: 2,
      fallbackFraction: 0,
      maxFraction: 0.2,
    },
    drawdownScaler: { enabled: isEnabled, maxDdPct: 0.2, initialEquity: 1000 },
    logger: quietLogger,
  };
}

function exerciseRiskManager(): void {
  const disabled = new RiskManager(withoutLogger(riskConfig(false)));
  disabled.armTrailingStop("disabled", "long", 100, 2);
  assertCondition(
    disabled.evaluateNewPositionSize({ equityUsd: 1000, baseSizeFraction: 0.02 }) === 0.02,
    "disabled risk sizing changed base size",
  );
  const longOnly = new RiskManager({
    ...riskConfig(true),
    trailingStop: { enabled: true, atrPeriod: 14, atrMultiplier: 2, side: "long" },
  });
  longOnly.armTrailingStop("filtered", "short", 100, 2);
  const manager = new RiskManager(riskConfig(true));
  let callbacks = 0;
  manager.onTrailingStopClose(() => {
    callbacks += 1;
  });
  manager.onTrailingStopClose(() => {
    throw new Error("callback Error");
  });
  manager.onTrailingStopClose(() => {
    return throwBaselineFault("callback rejection");
  });
  manager.armTrailingStop("long", "long", 100, 2);
  manager.onTick({ positionId: "long", side: "long", currentPrice: 110, atr: 2, timestamp: 1 });
  manager.getSnapshot();
  manager.onTick({ positionId: "long", side: "long", currentPrice: 105, atr: 2, timestamp: 2 });
  assertCondition(callbacks === 1, "risk close callback count mismatch");
  manager.disarmTrailingStop("long");
  manager.onTradeClosed(-10, 1);
  manager.onTradeClosed(-10, 2);
  assertCondition(
    manager.evaluateNewPositionSize({ equityUsd: 1000, baseSizeFraction: 0.02 }) === 0,
    "no-edge Kelly returned risk size",
  );
  manager.onTradeClosed(100, 3);
  manager.onTradeClosed(100, 4);
  assertCondition(
    manager.evaluateNewPositionSize({ equityUsd: 1000, baseSizeFraction: 0.02 }) > 0,
    "active Kelly returned zero size",
  );
  manager.onEquityUpdate(800);
  assertCondition(
    manager.evaluateNewPositionSize({ equityUsd: 800, baseSizeFraction: 0.02 }) === 0,
    "kill drawdown returned risk size",
  );
  manager.getSnapshot();
  manager.getDrawdownScaler();
  manager.getKellySizer();
  manager.getTrailingStopManager();
}

export function runRiskModules(): void {
  exerciseTrailingStops();
  exerciseDrawdownScaler();
  exerciseKelly();
  exerciseRiskManager();
}
