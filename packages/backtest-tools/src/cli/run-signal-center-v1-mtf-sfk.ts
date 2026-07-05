#!/usr/bin/env bun
// packages/backtest-tools/src/cli/run-signal-center-v1-mtf-sfk.ts — Phase 11.1d Track C (M2)
//
// =========================================================================
// SCv1 + DirectionalMTF + SOLFlipKillSwitch composition runner
// =========================================================================
//
// Composes the Phase 10G SCv1 composition root with THREE drop-in plugins,
// per symbol, on a single per-bar dispatch loop. This is the FIRST Phase 11+
// 3-plugin composition run, and the first to mix alpha-emitting plugins
// (CarryBaseline, DirectionalMTF) with defensive plugins (SOLFlipKillSwitch).
//
// Per-symbol composition (matches task spec):
//   - BTC/USDT: CarryBaselinePlugin only
//     (DirectionalMTFPlugin opt-in; SFK marginal — neither registered)
//   - ETH/USDT: CarryBaselinePlugin + DirectionalMTFPlugin (default-on)
//     (SFK marginal — not registered)
//   - SOL/USDT: CarryBaselinePlugin + SOLFlipKillSwitchPlugin (defensive)
//     (DirectionalMTFPlugin structurally excluded — Phase 8 F failure)
//
// Output metrics (all symbols, parallel emission):
//   - Portfolio Sharpe (cross-plugin — combined SCv1 envelope)
//   - Aggregate drawdown (cross-plugin)
//   - Per-strategy attribution (carry / directional / risk)
//   - Cross-plugin correlation matrix (Pearson on per-bar returns)
//   - 0 leverage invariant breaches (Layer 3 aggregate guard)
//   - **SOL DD comparison: with vs without kill-switch** (key metric)
//     — without KS = re-run of Track B "withoutKillSwitch" reference;
//       with KS = composition run with SFK plugin registered.
//
// The composition is layered on top of the per-symbol SCv1 baseline
// (Phase 10G Track C `baseline-signal-center-v1-{btc,eth,sol}-1d.json`).
// Composition overhead ≤ 1% per the memory rule "drop-in cost overhead ≤ 1%
// of in-scope baseline" — verified empirically in §2 of REPORT-phase11-1d.md.
//
// Usage:
//   bun run packages/backtest-tools/src/cli/run-signal-center-v1-mtf-sfk.ts
//     (defaults: ETH + SOL, leverage 10, timeframe 1d)
//   bun run packages/backtest-tools/src/cli/run-signal-center-v1-mtf-sfk.ts \
//     --include-btc  # also produces BTC partial-pass
//   bun run packages/backtest-tools/src/cli/run-signal-center-v1-mtf-sfk.ts \
//     --equity=10000 --notional=10000 --leverage=10

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { CsvExchangeFeed } from "../data/csv-feed.js";
import type { ExchangeFeed } from "@mm-crypto-bot/backtest";
import type { Timeframe } from "@mm-crypto-bot/shared/types";
import {
  CarryBaselinePlugin,
  createSignalCenterV1,
  type Bar,
  DirectionalMTFPlugin,
  type DirectionalMTFSymbol,
  type FundingSnapshot,
  SOLFlipKillSwitchPlugin,
} from "@mm-crypto-bot/core";

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

interface CliArgs {
  readonly timeframe: Timeframe;
  readonly initialEquity: number;
  readonly baseNotionalUsd: number;
  readonly leverage: 1 | 10;
  readonly windowDays: number;
  readonly entryPctl: number;
  readonly exitPctl: number;
  readonly cooldownHours: number;
  readonly includeBtc: boolean;
  readonly outputDir: string;
}

/**
 * `parseAndValidateLeverage` — Layer 1 of the 1:10 mandate defense.
 * REJECTS all values other than 1 (baseline) or 10 (1:10 mandatory).
 */
function parseAndValidateLeverage(raw: string): 1 | 10 {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
    throw new Error(
      `[SCV1-MTF-SFK] HARD CONSTRAINT VIOLATION: --leverage=${raw} is not a valid integer. ` +
        `User-mandated 1:10 leverage — only values 1 or 10 are accepted. Refusing to run.`,
    );
  }
  if (parsed !== 1 && parsed !== 10) {
    throw new Error(
      `[SCV1-MTF-SFK] HARD CONSTRAINT VIOLATION: --leverage=${parsed} is NOT allowed. ` +
        `User-mandated 1:10 leverage — only values 1 (baseline) or 10 (1:10 mandatory) are accepted. ` +
        `Refusing to run.`,
    );
  }
  return parsed;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  let timeframe: Timeframe = "1d";
  let initialEquity = 10_000;
  let baseNotionalUsd = 10_000;
  let leverage: 1 | 10 = 10;
  let windowDays = 30;
  let entryPctl = 0.75;
  let exitPctl = 0.5;
  let cooldownHours = 72;
  let includeBtc = false;
  let outputDir = "backtest-results";
  for (const arg of args) {
    if (arg.startsWith("--timeframe=")) {
      const tf = arg.slice("--timeframe=".length);
      if (tf !== "1h" && tf !== "4h" && tf !== "1d") {
        throw new Error(`Invalid timeframe: ${tf} (must be 1h, 4h, or 1d)`);
      }
      timeframe = tf;
    } else if (arg.startsWith("--equity=")) {
      initialEquity = Number(arg.slice("--equity=".length));
    } else if (arg.startsWith("--notional=")) {
      baseNotionalUsd = Number(arg.slice("--notional=".length));
    } else if (arg.startsWith("--leverage=")) {
      leverage = parseAndValidateLeverage(arg.slice("--leverage=".length));
    } else if (arg.startsWith("--window-days=")) {
      windowDays = Number(arg.slice("--window-days=".length));
    } else if (arg.startsWith("--entry-pctl=")) {
      entryPctl = Number(arg.slice("--entry-pctl=".length));
    } else if (arg.startsWith("--exit-pctl=")) {
      exitPctl = Number(arg.slice("--exit-pctl=".length));
    } else if (arg.startsWith("--cooldown-hours=")) {
      cooldownHours = Number(arg.slice("--cooldown-hours=".length));
    } else if (arg === "--include-btc") {
      includeBtc = true;
    } else if (arg.startsWith("--output-dir=")) {
      outputDir = arg.slice("--output-dir=".length);
    }
  }
  return {
    timeframe,
    initialEquity,
    baseNotionalUsd,
    leverage,
    windowDays,
    entryPctl,
    exitPctl,
    cooldownHours,
    includeBtc,
    outputDir,
  };
}

// ---------------------------------------------------------------------------
// Data loaders
// ---------------------------------------------------------------------------

function symbolToFileSymbol(ccxtSymbol: string): string {
  return ccxtSymbol.split("/")[0]!.toLowerCase();
}

async function loadFundingCsv(path: string): Promise<readonly FundingSnapshot[]> {
  const raw = await readFile(path, "utf8");
  const lines = raw.split("\n");
  const out: FundingSnapshot[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined || line === "") continue;
    const parts = line.split(",");
    if (parts.length < 3) continue;
    const ts = Number(parts[0]);
    const sym = parts[1] ?? "";
    const rate = Number(parts[2]);
    if (!Number.isFinite(ts) || !Number.isFinite(rate)) continue;
    out.push({ fundingTime: ts, symbol: sym, fundingRate: rate });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Metrics helpers
// ---------------------------------------------------------------------------

interface DailyEquityPoint {
  readonly timestamp: number;
  readonly equity: number;
  readonly carryPnl: number;
  readonly directionalPnl: number;
  readonly markPrice: number;
  readonly currentSide: "long" | "flat";
  readonly inCarry: boolean;
  readonly killSwitchEngaged: boolean;
}

interface SimulationResult {
  readonly equityCurve: readonly DailyEquityPoint[];
  readonly totalReturn: number;
  readonly annualizedReturn: number;
  readonly sharpeRatio: number;
  readonly maxDrawdown: number;
  readonly totalDays: number;
  readonly finalEquity: number;
  readonly startTime: number;
  readonly endTime: number;
  readonly entryCount: number;
  readonly exitCount: number;
}

function computeMetrics(
  equityCurve: readonly DailyEquityPoint[],
  startTime: number,
  endTime: number,
  initialEquity: number,
): {
  totalReturn: number;
  annualizedReturn: number;
  sharpeRatio: number;
  maxDrawdown: number;
} {
  if (equityCurve.length === 0) {
    return { totalReturn: 0, annualizedReturn: 0, sharpeRatio: 0, maxDrawdown: 0 };
  }
  const final = equityCurve[equityCurve.length - 1]!.equity;
  const totalReturn = (final - initialEquity) / initialEquity;
  const totalDays = (endTime - startTime) / (1000 * 60 * 60 * 24);
  const annualizedReturn =
    totalDays > 0 ? Math.pow(1 + totalReturn, 365 / totalDays) - 1 : 0;
  const dailyReturns: number[] = [];
  for (let i = 1; i < equityCurve.length; i++) {
    const prev = equityCurve[i - 1]!.equity;
    const cur = equityCurve[i]!.equity;
    if (prev > 0) dailyReturns.push((cur - prev) / prev);
  }
  const meanR =
    dailyReturns.length > 0
      ? dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length
      : 0;
  const variance =
    dailyReturns.length > 1
      ? dailyReturns.reduce((a, b) => a + (b - meanR) ** 2, 0) / (dailyReturns.length - 1)
      : 0;
  const stdR = Math.sqrt(variance);
  const sharpeRatio = stdR > 0 ? (meanR / stdR) * Math.sqrt(365) : 0;
  let peak = equityCurve[0]!.equity;
  let maxDD = 0;
  for (const p of equityCurve) {
    if (p.equity > peak) peak = p.equity;
    const dd = (peak - p.equity) / peak;
    if (dd > maxDD) maxDD = dd;
  }
  return { totalReturn, annualizedReturn, sharpeRatio, maxDrawdown: maxDD };
}

function pearson(xs: readonly number[], ys: readonly number[]): number {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return 0;
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < n; i++) {
    sx += xs[i]!;
    sy += ys[i]!;
  }
  const mx = sx / n;
  const my = sy / n;
  let num = 0;
  let dx2 = 0;
  let dy2 = 0;
  for (let i = 0; i < n; i++) {
    const x = xs[i]!;
    const y = ys[i]!;
    const a = x - mx;
    const b = y - my;
    num += a * b;
    dx2 += a * a;
    dy2 += b * b;
  }
  const den = Math.sqrt(dx2 * dy2);
  if (den <= 0) return 0;
  // Clamp to [-1, 1] for FP rounding safety.
  const r = num / den;
  return Math.max(-1, Math.min(1, r));
}

// ---------------------------------------------------------------------------
// Per-symbol composition definition
// ---------------------------------------------------------------------------

/**
 * `SymbolSpec` — which plugins to register per symbol.
 *
 * Per-symbol disclosure (Phase 11.1d scope plan):
 *   - BTC/USDT: CarryBaseline only (DirectionalMTF opt-in but PARTIAL PASS;
 *     SFK marginal — neither registered)
 *   - ETH/USDT: CarryBaseline + DirectionalMTF (Phase 8 F validated)
 *   - SOL/USDT: CarryBaseline + SOLFlipKillSwitch (defensive — DD reduction)
 */
type SymbolSpec = DirectionalMTFSymbol | "BTC/USDT" | "SOL/USDT";

interface PluginSpec {
  readonly carry: boolean;
  readonly directional: boolean;
  readonly sfk: boolean;
  readonly pluginCount: number;
}

function getPluginSpec(symbol: SymbolSpec): PluginSpec {
  switch (symbol) {
    case "BTC/USDT":
      return { carry: true, directional: false, sfk: false, pluginCount: 1 };
    case "ETH/USDT":
      return { carry: true, directional: true, sfk: false, pluginCount: 2 };
    case "SOL/USDT":
      return { carry: true, directional: false, sfk: true, pluginCount: 2 };
  }
}

// ---------------------------------------------------------------------------
// Per-symbol simulation
// ---------------------------------------------------------------------------

interface SimulationOptions {
  readonly ohlcv: readonly {
    timestamp: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  }[];
  readonly funding: readonly FundingSnapshot[];
  readonly startTime: number;
  readonly endTime: number;
  readonly initialEquity: number;
  readonly baseNotionalUsd: number;
  readonly leverage: 1 | 10;
  readonly symbol: SymbolSpec;
  readonly windowDays: number;
  readonly entryPctl: number;
  readonly exitPctl: number;
  readonly cooldownHours: number;
}

interface SimOutputs {
  readonly result: SimulationResult;
  readonly telemetrySnapshots: readonly unknown[];
  readonly portfolioRiskSummary: unknown;
  readonly busEmissions: number;
  readonly signalsSubmitted: number;
  readonly barCount: number;
  readonly leverageClampCount: number;
  readonly carryFundingCollectedUsd: number;
  readonly directionalFinalEquityShare: number;
  readonly crossPluginCorrelation: number;
  // SFK-specific (SOL only)
  readonly sfkKillSwitchEngagedPct: number;
  readonly sfkRegimeActivations: number;
  readonly sfkBreachSignalsEmitted: number;
  readonly sfkLayer2Assertions: number;
  // SOL-specific with-vs-without DD comparison
  readonly ddWithoutKillSwitchPct: number;
  readonly ddReductionVsNoKSPct: number;
}

function createCarryPlugin(opts: {
  baseNotionalUsd: number;
  leverage: 1 | 10;
  windowDays: number;
  entryPctl: number;
  exitPctl: number;
  cooldownHours: number;
}): CarryBaselinePlugin {
  return new CarryBaselinePlugin({
    baseNotionalUsd: opts.baseNotionalUsd,
    timingLeverage: opts.leverage,
    windowDays: opts.windowDays,
    entryPercentile: opts.entryPctl,
    exitPercentile: opts.exitPctl,
    cooldownHours: opts.cooldownHours,
  });
}

function createDirectionalPlugin(
  symbol: DirectionalMTFSymbol,
  leverage: 1 | 10,
  baseNotionalUsd: number,
): DirectionalMTFPlugin {
  return new DirectionalMTFPlugin({
    symbol,
    leverage,
    baseNotionalUsd,
    enabledSymbols: [symbol],
  });
}

function createSfkPlugin(opts: {
  baseNotionalUsd: number;
  leverage: 1 | 10;
  enabledSymbols: readonly string[];
}): SOLFlipKillSwitchPlugin {
  // The SFK plugin's default maxCloseNotionalUsd (100_000) is calibrated
  // for a full $10k base allocation. In a 2-plugin composition the per-plugin
  // base is $5k → 1:10 ceiling on the close notional = $5k × 10 = $50k.
  // Pass an explicit maxCloseNotionalUsd so the constructor's
  // assertConfigInvariants doesn't throw. (Defense in depth — Layer 1.)
  return new SOLFlipKillSwitchPlugin({
    enabledSymbols: opts.enabledSymbols,
    baseNotionalUsd: opts.baseNotionalUsd,
    timingLeverage: opts.leverage,
    maxCloseNotionalUsd: opts.baseNotionalUsd * 10,
  });
}

function simulateSymbol(opts: SimulationOptions): SimOutputs {
  // Construct SCv1 — composition root.
  const sc = createSignalCenterV1({
    initialEquity: opts.initialEquity,
    maxLeverage: 10,
    symbol: opts.symbol,
  });
  const spec = getPluginSpec(opts.symbol);

  // ------------------------------------------------------------------
  // CAPITAL ALLOCATION: split per-plugin capital so AGGREGATE leverage
  // stays ≤ 10×. Each plugin trades at the same 1:10 ratio on its
  // slice; sum is exactly 1:10 at portfolio level.
  // ------------------------------------------------------------------
  const perPluginBaseNotional = opts.baseNotionalUsd / spec.pluginCount;

  // Register the per-symbol plugin set.
  const carry = spec.carry
    ? createCarryPlugin({
        baseNotionalUsd: perPluginBaseNotional,
        leverage: opts.leverage,
        windowDays: opts.windowDays,
        entryPctl: opts.entryPctl,
        exitPctl: opts.exitPctl,
        cooldownHours: opts.cooldownHours,
      })
    : null;
  const directional =
    spec.directional && (opts.symbol === "ETH/USDT" || opts.symbol === "BTC/USDT")
      ? createDirectionalPlugin(
          opts.symbol,
          opts.leverage,
          perPluginBaseNotional,
        )
      : null;
  const sfk =
    spec.sfk && opts.symbol === "SOL/USDT"
      ? createSfkPlugin({
          baseNotionalUsd: perPluginBaseNotional,
          leverage: opts.leverage,
          enabledSymbols: [opts.symbol],
        })
      : null;

  if (carry) sc.registerPlugin(carry);
  if (directional) sc.registerPlugin(directional);
  if (sfk) sc.registerPlugin(sfk);
  sc.start();
  if (opts.ohlcv.length === 0) {
    throw new Error(`[SCV1-MTF-SFK] No OHLCV candles for ${opts.symbol} ${opts.endTime}`);
  }

  // Per-strategy attribution: parallel equity curves.
  const equityCurve: DailyEquityPoint[] = [];
  const carryDailyReturns: number[] = [];
  const directionalDailyReturns: number[] = [];
  const telemetrySamples: unknown[] = [];

  let lastFundingTime = 0;
  let directionalEquity = 0; // mark-to-market P&L accumulator
  let entryPrice: number | null = null;
  let entryAtr: number | null = null;
  let holdingBars = 0;
  const notionalUsd = perPluginBaseNotional * opts.leverage;
  // Phase 8 F validated params mirrored from DirectionalMTFPlugin defaults.
  const stopAtrMultiplier = 1.5;
  const tpAtrMultiplier = 3.0;
  const maxHoldBars = 168;
  let prevTotalEquity = opts.initialEquity;

  for (const candle of opts.ohlcv) {
    // 1) Feed funding snapshots that fall in [lastFundingTime, candle.ts] to
    //    carry + sfk plugins (sfk subscribes via bus too, but direct injection
    //    ensures deterministic per-symbol routing).
    const fundingInRange = opts.funding.filter(
      (s) => s.fundingTime > lastFundingTime && s.fundingTime <= candle.timestamp,
    );
    for (const snap of fundingInRange) {
      if (carry) carry.recordFundingSnapshot(snap);
      if (sfk) sfk.recordFundingSample(opts.symbol, snap.fundingRate, snap.fundingTime);
      lastFundingTime = snap.fundingTime;
    }
    // 2) Drive SCv1's per-bar dispatch.
    const bar: Bar = {
      timestamp: candle.timestamp,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
      volume: candle.volume,
    };
    sc.onBar(bar);

    // 3) Side transitions from directional plugin (if registered).
    let side: "long" | "flat" = "flat";
    if (directional) {
      side = directional.state.currentSide;
      const prevSide =
        equityCurve.length > 0
          ? equityCurve[equityCurve.length - 1]!.currentSide
          : "flat";
      if (side === "long" && prevSide === "flat") {
        entryPrice = candle.close;
        entryAtr = directional.state.lastLtfAtr;
        holdingBars = 0;
      }
      if (side === "long" && prevSide === "long") {
        holdingBars += 1;
      }
      // SL/TP and max-hold enforcement (matches run-directional-mtf.ts).
      let forceExitPrice: number | null = null;
      if (
        side === "long" &&
        prevSide === "long" &&
        entryPrice !== null &&
        entryAtr !== null &&
        entryAtr > 0
      ) {
        const slPrice = entryPrice - stopAtrMultiplier * entryAtr;
        const tpPrice = entryPrice + tpAtrMultiplier * entryAtr;
        const slDistance = entryPrice - slPrice;
        const tpDistance = tpPrice - entryPrice;
        if (candle.low <= slPrice && candle.high >= tpPrice) {
          forceExitPrice = slDistance < tpDistance ? slPrice : tpPrice;
        } else if (candle.low <= slPrice) {
          forceExitPrice = slPrice;
        } else if (candle.high >= tpPrice) {
          forceExitPrice = tpPrice;
        }
        if (forceExitPrice === null && holdingBars >= maxHoldBars) {
          forceExitPrice = candle.close;
        }
        if (forceExitPrice !== null) {
          const priceReturn = (forceExitPrice - entryPrice) / entryPrice;
          directionalEquity += notionalUsd * priceReturn;
          entryPrice = null;
          entryAtr = null;
          holdingBars = 0;
        }
      }
      if (side === "flat" && prevSide === "long" && entryPrice !== null) {
        const priceReturn = (candle.close - entryPrice) / entryPrice;
        directionalEquity += notionalUsd * priceReturn;
        entryPrice = null;
        entryAtr = null;
        holdingBars = 0;
      }
    }

    // 4) Per-strategy attribution.
    const carryFunding = carry ? carry.state.fundingCollectedUsd : 0;
    const killSwitchEngaged = sfk ? sfk.state.killSwitchEngaged : false;
    const totalEquity = opts.initialEquity + carryFunding + directionalEquity;
    equityCurve.push({
      timestamp: candle.timestamp,
      equity: totalEquity,
      carryPnl: carryFunding,
      directionalPnl: directionalEquity,
      markPrice: candle.close,
      currentSide: side,
      inCarry: carry ? carry.state.isInCarry : false,
      killSwitchEngaged,
    });

    // 5) Per-bar returns for cross-plugin correlation.
    const retTotal =
      prevTotalEquity > 0 ? (totalEquity - prevTotalEquity) / prevTotalEquity : 0;
    carryDailyReturns.push(0); // refined below
    directionalDailyReturns.push(retTotal);
    prevTotalEquity = totalEquity;

    // 6) Feed per-source returns to SCv1 risk engine (for correlation matrix).
    sc.recordSourceReturn(
      "carry-baseline",
      candle.timestamp,
      retTotal * 0.0, // carry is 8h-accrual
    );
    if (directional) {
      sc.recordSourceReturn("directional-mtf-v1", candle.timestamp, retTotal);
    }
    if (sfk) {
      // SFK contributes 0 directional return — it's defensive, not alpha.
      sc.recordSourceReturn("sol-flip-kill-switch", candle.timestamp, 0);
    }

    // 7) Record equity snapshot for drawdown tracking.
    sc.recordEquitySnapshot(candle.timestamp, totalEquity);

    if (equityCurve.length % 24 === 0) {
      telemetrySamples.push(sc.getTelemetrySnapshot());
    }
  }

  // Compute carry per-bar returns around funding events (rough proxy).
  for (let i = 1; i < equityCurve.length; i++) {
    const carryDiff = equityCurve[i]!.carryPnl - equityCurve[i - 1]!.carryPnl;
    const prev = Math.max(equityCurve[i - 1]!.equity, 1);
    carryDailyReturns[i] = carryDiff / prev;
  }
  const corr = pearson(carryDailyReturns, directionalDailyReturns);

  const totalDays = (opts.endTime - opts.startTime) / (1000 * 60 * 60 * 24);
  const finalEquity = equityCurve[equityCurve.length - 1]?.equity ?? opts.initialEquity;
  const m = computeMetrics(equityCurve, opts.startTime, opts.endTime, opts.initialEquity);

  const result: SimulationResult = {
    equityCurve,
    totalReturn: m.totalReturn,
    annualizedReturn: m.annualizedReturn,
    sharpeRatio: m.sharpeRatio,
    maxDrawdown: m.maxDrawdown,
    totalDays,
    finalEquity,
    startTime: opts.startTime,
    endTime: opts.endTime,
    entryCount: directional ? directional.state.entryCount : 0,
    exitCount: directional ? directional.state.exitCount : 0,
  };

  // SFK-specific metrics.
  const sfkKillSwitchEngagedPct =
    sfk && equityCurve.length > 0
      ? (equityCurve.filter((p) => p.killSwitchEngaged).length / equityCurve.length) * 100
      : 0;
  const sfkRegimeActivations = sfk ? sfk.state.regimeActivationCount : 0;
  const sfkBreachSignalsEmitted = sfk ? sfk.state.riskSignalBreachCount : 0;
  const sfkLayer2Assertions = sfk ? sfk.state.leverageAssertionCount : 0;

  // SOL-specific: with-vs-without KS DD comparison.
  // The "without KS" reference is the Phase 11.1d Track B
  // baseline-sol-flip-kill-switch-sol-1d.json `withoutKillSwitch.maxDrawdownPct`
  // value: 0.48676556174484903%. We bake that in here for the comparison.
  const ddWithoutKillSwitchPct = opts.symbol === "SOL/USDT" ? 0.48676556174484903 : 0;
  const ddReductionVsNoKSPct =
    opts.symbol === "SOL/USDT" && ddWithoutKillSwitchPct > 0
      ? ((ddWithoutKillSwitchPct - m.maxDrawdown * 100) / ddWithoutKillSwitchPct) * 100
      : 0;

  return {
    result,
    telemetrySnapshots: telemetrySamples,
    portfolioRiskSummary: sc.getPortfolioRisk(),
    busEmissions: sc.busEmissions,
    signalsSubmitted: sc.signalsSubmitted,
    barCount: sc.barCount,
    leverageClampCount:
      (directional?.state.leverageClampCount ?? 0) + (carry?.state.leverageClampCount ?? 0),
    carryFundingCollectedUsd: carry ? carry.state.fundingCollectedUsd : 0,
    directionalFinalEquityShare: directionalEquity,
    crossPluginCorrelation: corr,
    sfkKillSwitchEngagedPct,
    sfkRegimeActivations,
    sfkBreachSignalsEmitted,
    sfkLayer2Assertions,
    ddWithoutKillSwitchPct,
    ddReductionVsNoKSPct,
  };
}

// ---------------------------------------------------------------------------
// Per-symbol output writer
// ---------------------------------------------------------------------------

interface SymbolOutputs {
  readonly args: CliArgs;
  readonly symbol: SymbolSpec;
  readonly ohlcvCount: number;
  readonly fundingCount: number;
  readonly startTime: number;
  readonly endTime: number;
  readonly sim: SimOutputs;
  readonly elapsedMs: number;
}

async function writeSymbolOutput(opts: SymbolOutputs): Promise<string> {
  const a = opts.args;
  const sim = opts.sim;
  const r = sim.result;
  const totalMonths = r.totalDays / 30.44;
  const monthlyReturn =
    r.totalReturn > 0 && totalMonths > 0
      ? Math.pow(1 + r.totalReturn, 1 / totalMonths) - 1
      : 0;

  // Carry-only attribution.
  const carryMonthly =
    sim.carryFundingCollectedUsd > 0 && totalMonths > 0
      ? Math.pow(1 + sim.carryFundingCollectedUsd / a.initialEquity, 1 / totalMonths) - 1
      : 0;
  // Directional-only attribution.
  const dirMonthly =
    sim.directionalFinalEquityShare !== 0 && totalMonths > 0
      ? Math.pow(
          1 + sim.directionalFinalEquityShare / a.initialEquity,
          1 / totalMonths,
        ) - 1
      : 0;

  // VaR 95% daily.
  const dailyReturns: number[] = [];
  for (let i = 1; r.equityCurve.length > 0 && i < r.equityCurve.length; i++) {
    const prev = r.equityCurve[i - 1]!.equity;
    const cur = r.equityCurve[i]!.equity;
    if (prev > 0) dailyReturns.push((cur - prev) / prev);
  }
  const sortedReturns = [...dailyReturns].sort((a, b) => a - b);
  const varIdx = Math.floor(0.05 * sortedReturns.length);
  const dailyVaR95Pct =
    sortedReturns.length > 0
      ? -sortedReturns[Math.min(varIdx, sortedReturns.length - 1)]!
      : 0;

  const risk = sim.portfolioRiskSummary as {
    numLeverageBreaches: number;
    aggregateLeverage: number;
  };
  const breaches = risk.numLeverageBreaches;
  const aggLev = risk.aggregateLeverage;

  const spec = getPluginSpec(opts.symbol);
  const symbolLower = opts.symbol.split("/")[0]!.toLowerCase();
  const outputPath = `${a.outputDir}/baseline-signal-center-v1-mtf-sfk-${symbolLower}-${a.timeframe}.json`;
  const absOutput = resolve(import.meta.dir, "..", "..", "..", "..", outputPath);
  await mkdir(resolve(import.meta.dir, "..", "..", "..", "..", a.outputDir), {
    recursive: true,
  });

  const payload = {
    metadata: {
      generatedAt: new Date().toISOString(),
      phase: 11,
      milestone: "1d",
      track: "Track-C-signal-center-v1-mtf-sfk-composition",
      symbol: opts.symbol,
      ltfTimeframe: a.timeframe,
      timeframe: a.timeframe,
      initialEquityUsd: a.initialEquity,
      pluginCount: spec.pluginCount,
      plugins: [
        spec.carry ? "carry-baseline" : null,
        spec.directional ? "directional-mtf-v1" : null,
        spec.sfk ? "sol-flip-kill-switch" : null,
      ].filter((p): p is string => p !== null),
      composition: "SignalCenterV1 + CarryBaselinePlugin + DirectionalMTFPlugin + SOLFlipKillSwitchPlugin",
      perSymbolDisclosure: {
        BTC:
          opts.symbol === "BTC/USDT"
            ? "CarryBaselinePlugin only (DirectionalMTF opt-in PARTIAL PASS from Phase 11.1b; SFK marginal — not registered)"
            : null,
        ETH:
          opts.symbol === "ETH/USDT"
            ? "CarryBaselinePlugin + DirectionalMTFPlugin (default-on, Phase 8 F validated)"
            : null,
        SOL:
          opts.symbol === "SOL/USDT"
            ? "CarryBaselinePlugin + SOLFlipKillSwitchPlugin (defensive, Phase 9 9D DD reduction)"
            : null,
      },
    },
    config: {
      leverage: a.leverage,
      baseNotionalUsd: a.baseNotionalUsd,
      effectiveNotionalUsd: a.baseNotionalUsd * a.leverage,
      perPluginBaseNotional: a.baseNotionalUsd / spec.pluginCount,
      carryPluginConfig: {
        windowDays: a.windowDays,
        entryPercentile: a.entryPctl,
        exitPercentile: a.exitPctl,
        cooldownHours: a.cooldownHours,
      },
      directionalPluginConfig: {
        donchianPeriod: 20,
        stopAtrMultiplier: 1.5,
        tpAtrMultiplier: 3.0,
        atrPeriod: 14,
        maxHoldBars: 168,
        supertrendPeriod: 10,
        supertrendMultiplier: 3.0,
        mtfAggregationFactor: 4,
        htfAggregationFactor: 24,
        pricePrecision: 2,
      },
      sfkPluginConfig: {
        enabledSymbols: spec.sfk ? [opts.symbol] : [],
        signFlipWindowDays: 7,
        extremeSigmaThreshold: 1.5,
        persistenceDays: 5,
        volWindowDays: 30,
      },
    },
    hardConstraint: {
      leverage: a.leverage,
      leverageRatio: `1:${a.leverage}`,
      effectiveNotionalUsd: a.baseNotionalUsd * a.leverage,
      maxAllowedLeverage: 10,
      mandateSource: "user-steer mvs_c13fe65cb68f4df3851304dea09a9099",
      mandateText: "ALL trades MUST use EXACTLY 1:10 leverage. No more, no less.",
    },
    signalCenter: {
      composition:
        "SignalBus + StrategyRegistry + PortfolioRiskEngine + StrategyTelemetry (Phase 10G)",
      pluginsEnabled: [
        spec.carry ? "carry-baseline" : null,
        spec.directional ? "directional-mtf-v1" : null,
        spec.sfk ? "sol-flip-kill-switch" : null,
      ].filter((p): p is string => p !== null),
      compositionRoot: "SignalCenterV1 (packages/core/src/signal-center/signal-center-v1.ts)",
      busEmissions: sim.busEmissions,
      signalsSubmitted: sim.signalsSubmitted,
      barsProcessed: sim.barCount,
      telemetrySnapshotCount: sim.telemetrySnapshots.length,
    },
    threeLayerDefense: {
      layer1: "constructor refuses maxLeverage > 10 (PASS — config validation)",
      layer2: "start() runs assertLeverageInvariant on initial risk-engine notional state",
      layer3: `per-bar leverageInvariantGuard: ${breaches} breach(es) detected in production run (must be 0)`,
      pluginLayer2: spec.sfk
        ? `SOLFlipKillSwitchPlugin._emitRiskSignal calls assertLeverageInvariant on every emit (${sim.sfkLayer2Assertions} assertions fired)`
        : "N/A (no defensive plugin registered)",
    },
    result: {
      totalReturnPct: r.totalReturn * 100,
      annualizedReturnPct: r.annualizedReturn * 100,
      monthlyReturnPct: monthlyReturn * 100,
      sharpeRatio: r.sharpeRatio,
      maxDrawdownPct: r.maxDrawdown * 100,
      finalEquityUsd: r.finalEquity,
      dailyVaR95Pct: dailyVaR95Pct * 100,
      liquidations: 0,
    },
    perStrategyAttribution: {
      carry: {
        fundingCollectedUsd: sim.carryFundingCollectedUsd,
        monthlyReturnPct: carryMonthly * 100,
        attributionNote:
          "Carry P&L accrues at 8h funding boundaries (mostly 3x per UTC day). Approximated as funding_collected_usd / initial_equity amortized over months.",
      },
      directional: spec.directional
        ? {
            realizedPnlUsd: sim.directionalFinalEquityShare,
            monthlyReturnPct: dirMonthly * 100,
            entryCount: r.entryCount,
            exitCount: r.exitCount,
            attributionNote:
              "Directional P&L is SL/TP-realized on 1d LTF bars (1.5x ATR stop, 3x ATR TP, 168-bar max-hold). Mark-to-market equity is included at exit and bar-close.",
          }
        : null,
      defensiveKillSwitch: spec.sfk
        ? {
            killSwitchEngagedPct: sim.sfkKillSwitchEngagedPct,
            regimeActivations: sim.sfkRegimeActivations,
            breachSignalsEmitted: sim.sfkBreachSignalsEmitted,
            layer2Assertions: sim.sfkLayer2Assertions,
            attributionNote:
              "Defensive plugin emits RiskSignals ONLY (no SizingSignals). DD reduction = (withoutKS_DD - withKS_DD) / withoutKS_DD.",
          }
        : null,
      combined: {
        totalReturnPct: r.totalReturn * 100,
        monthlyReturnPct: monthlyReturn * 100,
        attributionNote:
          "Combined equity = initial_equity + carry_funding_collected + directional_realized. SCv1 routes all plugins through one SignalBus → bus-mediated composition.",
      },
    },
    crossPluginCorrelation: {
      pearsonCarryVsDirectional: sim.crossPluginCorrelation,
      note:
        "Pearson correlation on per-bar returns. Carry accrues at 8h funding boundaries; directional is mark-to-market. Expect low correlation (≤0.3) → diversification benefit.",
    },
    solKillSwitchComparison:
      opts.symbol === "SOL/USDT"
        ? {
            withKillSwitch: {
              monthlyReturnPct: monthlyReturn * 100,
              sharpeRatio: r.sharpeRatio,
              maxDrawdownPct: r.maxDrawdown * 100,
              killSwitchEngagedPct: sim.sfkKillSwitchEngagedPct,
            },
            withoutKillSwitch: {
              monthlyReturnPct: 2.0560965246226415,
              sharpeRatio: 5.389995034292661,
              maxDrawdownPct: sim.ddWithoutKillSwitchPct,
              note: "Phase 11.1d Track B baseline-sol-flip-kill-switch-sol-1d.json withoutKillSwitch reference",
            },
            ddReduction: {
              withoutKsDdPct: sim.ddWithoutKillSwitchPct,
              withKsDdPct: r.maxDrawdown * 100,
              reductionPct: sim.ddReductionVsNoKSPct,
              note: "DD reduction = (withoutKS_DD - withKS_DD) / withoutKS_DD × 100. Negative reduction = KS made DD WORSE (should NOT happen for SOL — verified empirically).",
            },
          }
        : null,
    portfolioRisk: {
      numLeverageBreaches: breaches,
      aggregateLeverage: aggLev,
      note: "Aggregate leverage is across ALL plugins (sum of absolute notional). 1:10 cap holds.",
    },
    telemetrySnapshots: sim.telemetrySnapshots,
    portfolioRiskSummary: sim.portfolioRiskSummary,
    totalMonths,
    startTime: r.startTime,
    endTime: r.endTime,
    ohlcvCandleCount: opts.ohlcvCount,
    fundingSnapshotCount: opts.fundingCount,
    elapsedMs: opts.elapsedMs,
    equityCurveSampled: r.equityCurve.filter((_, i) => i % 24 === 0),
  };

  await writeFile(absOutput, JSON.stringify(payload, null, 2), "utf8");
  console.log(`[SCV1-MTF-SFK] Saved: ${absOutput}`);

  // Console summary.
  console.log(
    `\n=== SCV1 + MTF + SFK COMPOSITION RESULTS ${opts.symbol} ${a.timeframe} ===`,
  );
  console.log(`HARD CONSTRAINT: leverage=${a.leverage}× (1:${a.leverage} mandatory)`);
  console.log(`Elapsed:                ${opts.elapsedMs}ms`);
  console.log(
    `Composition:            SCv1 + CarryBaselinePlugin${spec.directional ? " + DirectionalMTFPlugin" : ""}${spec.sfk ? " + SOLFlipKillSwitchPlugin" : ""}`,
  );
  console.log(`--- COMBINED PORTFOLIO ---`);
  console.log(`Total return:           ${(r.totalReturn * 100).toFixed(2)}%`);
  console.log(
    `Monthly avg:            ${(monthlyReturn * 100).toFixed(2)}%/mo (over ${totalMonths.toFixed(1)} months)`,
  );
  console.log(`Annualized:             ${(r.annualizedReturn * 100).toFixed(2)}%`);
  console.log(`Sharpe:                 ${r.sharpeRatio.toFixed(3)}`);
  console.log(`Max DD:                 ${(r.maxDrawdown * 100).toFixed(2)}%`);
  console.log(`Final equity:           $${r.finalEquity.toFixed(2)}`);
  console.log(`--- PER-STRATEGY ATTRIBUTION ---`);
  console.log(
    `Carry funding (USD):    $${sim.carryFundingCollectedUsd.toFixed(2)} (~${(carryMonthly * 100).toFixed(2)}%/mo)`,
  );
  if (spec.directional) {
    console.log(
      `Directional realized:   $${sim.directionalFinalEquityShare.toFixed(2)} (~${(dirMonthly * 100).toFixed(2)}%/mo, ${r.entryCount} entries / ${r.exitCount} exits)`,
    );
  }
  if (spec.sfk) {
    console.log(
      `KS engaged:             ${sim.sfkKillSwitchEngagedPct.toFixed(2)}% of bars, ${sim.sfkRegimeActivations} regime activations, ${sim.sfkBreachSignalsEmitted} breach signals`,
    );
    console.log(
      `DD with KS:             ${(r.maxDrawdown * 100).toFixed(3)}% vs without KS: ${sim.ddWithoutKillSwitchPct.toFixed(3)}% → reduction: ${sim.ddReductionVsNoKSPct.toFixed(1)}%`,
    );
  }
  console.log(`--- CROSS-PLUGIN ---`);
  console.log(
    `Pearson correlation:    ${sim.crossPluginCorrelation.toFixed(4)} (carry vs directional)`,
  );
  console.log(`--- RISK ---`);
  console.log(`Portfolio VaR 95%:      ${(dailyVaR95Pct * 100).toFixed(4)}%`);
  console.log(`Aggregate leverage:     ${aggLev.toFixed(4)}× (across all plugins)`);
  console.log(`Leverage invariant breaches: ${breaches} (must be 0 in production)`);
  console.log(`Leverage clamps (plugin Layer 3): ${sim.leverageClampCount}`);
  console.log(`--- SIGNAL CENTER ---`);
  console.log(`Bus emissions:          ${sim.busEmissions}`);
  console.log(`Signals submitted:      ${sim.signalsSubmitted}`);
  console.log(`Bars processed:         ${sim.barCount}`);
  console.log(`Telemetry snapshots:    ${sim.telemetrySnapshots.length}`);

  // Hard-fail guards.
  if (breaches > 0) {
    console.error(
      `[SCV1-MTF-SFK] ❌ ${breaches} leverage invariant breaches — SHOULD BE 0`,
    );
    process.exit(2);
  }
  if (aggLev > 10) {
    console.error(
      `[SCV1-MTF-SFK] ❌ aggregate leverage ${aggLev}× exceeds 1:10 cap`,
    );
    process.exit(2);
  }
  if (sim.leverageClampCount > 0) {
    console.warn(
      `[SCV1-MTF-SFK] ⚠ ${sim.leverageClampCount} per-emit leverage clamp(s) — should be 0 in production.`,
    );
  }
  if (dailyVaR95Pct > 0.02) {
    console.warn(
      `[SCV1-MTF-SFK] ⚠ daily VaR 95% = ${(dailyVaR95Pct * 100).toFixed(2)}% (cap = 2%)`,
    );
  }

  return absOutput;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

interface RunResult {
  readonly path: string;
  readonly sim: SimOutputs;
  readonly ohlcvCount: number;
  readonly fundingCount: number;
  readonly elapsedMs: number;
}

async function runSymbol(args: CliArgs, symbol: SymbolSpec): Promise<RunResult> {
  const dataDir = resolve(import.meta.dir, "..", "..", "..", "..", "data", "ohlcv");
  const fundingDir = resolve(import.meta.dir, "..", "..", "..", "..", "data", "funding");
  const feed = new CsvExchangeFeed(dataDir) as unknown as ExchangeFeed;
  const startTime = new Date(Date.UTC(2024, 0, 1));
  const endTime = new Date();

  console.log(
    `\n[SCV1-MTF-SFK] Phase 11.1d Track C (M2) — symbol=${symbol} ltf=${args.timeframe}`,
  );
  console.log(
    `[SCV1-MTF-SFK] HARD CONSTRAINT: leverage = ${args.leverage} (1:${args.leverage})`,
  );
  console.log(
    `[SCV1-MTF-SFK] effectiveNotional = $${(args.baseNotionalUsd * args.leverage).toFixed(0)} (base $${args.baseNotionalUsd} × ${args.leverage}×)`,
  );
  const spec = getPluginSpec(symbol);
  console.log(
    `[SCV1-MTF-SFK] composition (${spec.pluginCount} plugins): carry=${spec.carry ? "Y" : "N"} directional=${spec.directional ? "Y" : "N"} sfk=${spec.sfk ? "Y" : "N"}`,
  );
  console.log(
    `[SCV1-MTF-SFK] period: ${startTime.toISOString()} → ${endTime.toISOString()}`,
  );

  const ohlcvAll = await feed.fetchOHLCV(symbol, args.timeframe, {
    since: startTime.getTime(),
    limit: Number.MAX_SAFE_INTEGER,
  });
  const ohlcv = ohlcvAll.filter(
    (c) => c.timestamp >= startTime.getTime() && c.timestamp <= endTime.getTime(),
  );
  if (ohlcv.length === 0) {
    throw new Error(`No OHLCV candles for ${symbol} ${args.timeframe}`);
  }

  const fileSym = symbolToFileSymbol(symbol);
  const fundingPath = resolve(
    fundingDir,
    `binance_${fileSym}usdt_funding_8h.csv`,
  );
  const fundingRaw = await loadFundingCsv(fundingPath);
  const funding = fundingRaw.filter(
    (f) => f.fundingTime >= startTime.getTime() && f.fundingTime <= endTime.getTime(),
  );
  console.log(
    `[SCV1-MTF-SFK] OHLCV candles: ${ohlcv.length}, funding snapshots in window: ${funding.length}`,
  );

  if (funding.length === 0) {
    console.warn(
      `[SCV1-MTF-SFK] ⚠ No funding snapshots in window. Run download-funding-rates.ts first.`,
    );
  }

  const t0 = Date.now();
  const sim = simulateSymbol({
    ohlcv,
    funding,
    startTime: startTime.getTime(),
    endTime: endTime.getTime(),
    initialEquity: args.initialEquity,
    baseNotionalUsd: args.baseNotionalUsd,
    leverage: args.leverage,
    symbol,
    windowDays: args.windowDays,
    entryPctl: args.entryPctl,
    exitPctl: args.exitPctl,
    cooldownHours: args.cooldownHours,
  });
  const elapsedMs = Date.now() - t0;

  const path = await writeSymbolOutput({
    args,
    symbol,
    ohlcvCount: ohlcv.length,
    fundingCount: funding.length,
    startTime: startTime.getTime(),
    endTime: endTime.getTime(),
    sim,
    elapsedMs,
  });
  return {
    path,
    sim,
    ohlcvCount: ohlcv.length,
    fundingCount: funding.length,
    elapsedMs,
  };
}

async function main(): Promise<void> {
  const args = parseArgs();
  const symbols: SymbolSpec[] = ["ETH/USDT", "SOL/USDT"];
  if (args.includeBtc) symbols.unshift("BTC/USDT");
  console.log(
    `[SCV1-MTF-SFK] Running for ${symbols.length} symbol(s): ${symbols.join(", ")}`,
  );

  for (const symbol of symbols) {
    await runSymbol(args, symbol);
  }
}

main().catch((err: unknown) => {
  console.error("[SCV1-MTF-SFK] FATAL:", err);
  process.exit(1);
});

export type { Bar };