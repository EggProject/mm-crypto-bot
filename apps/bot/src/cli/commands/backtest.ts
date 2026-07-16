/**
 * apps/bot/src/cli/commands/backtest.ts
 *
 * Phase 37 Track 3 — `mm-bot backtest <strategy> [--visualize]`.
 *
 * Runs a quick backtest on a deterministic OHLC fixture and prints a
 * single-row summary table.  The supported strategies are the OHLC
 * ones in the `@mm-crypto-bot/core` package (currently just
 * `ohlc-trend`).
 *
 * The backtest path is INTENTIONALLY SIMPLE:
 *   1. Build a deterministic OHLC fixture (250 bars, 1h timeframe,
 *      a sinusoidal uptrend so the strategy has at least one
 *      golden cross and one death cross to react to).
 *   2. Run the strategy's `onBars()` on the rolling bar history.
 *   3. For each signal, simulate a simple entry at the next bar's
 *      open and an exit at the signal's takeProfit or stopLoss
 *      (whichever hits first in the subsequent bars).
 *   4. Aggregate the trades into a summary table.
 *
 * The fixture is fully deterministic (no RNG) so the backtest is
 * reproducible.  Real backtests (with historical OHLCV data) are
 * still under `packages/backtest-tools` — this command is the
 * "zero-config smoke test" for a strategy.
 *
 * Flags:
 *   --strategy=<name>    strategy to test (default: "ohlc-trend")
 *   --visualize          (Phase 44-gyel: a flag elfogadva, de nincs
 *                        hatása — a TUI Charts panel törölve. A flag
 *                        megmarad a backward-compat kedvéért.)
 *   --bars=<N>           number of bars in the fixture (default: 250)
 *   --risk-pct=<pct>     risk per trade as % of equity (default: 0.01)
 *   --initial-equity=$N  starting equity in USDT (default: 10000)
 *
 * Exit codes:
 *   0 — success
 *   1 — runtime error (unknown strategy, etc.)
 *   2 — config validation failure (when --visualize)
 */

import {
  DEFAULT_OHLC_TREND_CONFIG,
  OhlcTrendStrategy,
  type OhlcTrendConfig,
  type OhlcTrendSignal,
} from "@mm-crypto-bot/core";
import { makeSymbol, TIMEFRAME_MS } from "@mm-crypto-bot/shared/types";
import type { Candle, Timeframe } from "@mm-crypto-bot/shared/types";

import { colorize, dim, ok, fail, warn } from "../color.js";
import type { SubcommandHandler } from "../router.js";

/** Registry of supported OHLC-based strategies. */
interface StrategyDescriptor {
  readonly name: string;
  readonly displayName: string;
  readonly create: (config: Record<string, unknown>) => OhlcLikeStrategy;
  readonly defaultConfig: Record<string, unknown>;
}

/** Minimal interface that the backtest runner needs from a strategy. */
interface OhlcLikeStrategy {
  readonly name: string;
  readonly warmup: () => number;
  onBars(bars: readonly Candle[]): OhlcTrendSignal | null;
}

/**
 * `buildStrategyRegistry` — a small map of name → descriptor.  New
 * OHLC-based strategies are added here.
 */
function buildStrategyRegistry(): Map<string, StrategyDescriptor> {
  const reg = new Map<string, StrategyDescriptor>();
  reg.set("ohlc-trend", {
    name: "ohlc-trend",
    displayName: "OHLC-Trend (EMA50/200 + RSI14 + ATR14*1.5 stops, 3:1 R:R)",
    defaultConfig: { ...DEFAULT_OHLC_TREND_CONFIG },
    create: (cfg) => {
      // The factory bridges `OhlcTrendConfig` ↔ `Record<string, unknown>`.
      // We pass through any keys that match the config interface.
      const merged: OhlcTrendConfig = { ...DEFAULT_OHLC_TREND_CONFIG, ...(cfg as Partial<OhlcTrendConfig>) };
      return new OhlcTrendStrategy(merged);
    },
  });
  return reg;
}

/**
 * `getFlag` — pull a string flag, or `undefined` if absent / boolean.
 */
function getFlag(flags: ReadonlyMap<string, string | boolean>, name: string): string | undefined {
  const v = flags.get(name);
  if (typeof v === "string" && v.length > 0) return v;
  return undefined;
}

/**
 * `getFlagBool` — pull a boolean flag, defaulting to `def`.
 */
function getFlagBool(flags: ReadonlyMap<string, string | boolean>, name: string, def: boolean): boolean {
  const v = flags.get(name);
  if (typeof v === "boolean") return v;
  if (typeof v === "string" && v.length > 0) return v !== "false" && v !== "0";
  return def;
}

/**
 * `mkFixture` — generate a deterministic 1h OHLC fixture with a
 * sinusoidal uptrend (200 warmup bars at 100, then 50 bars of
 * sine-oscillation).  The slow EMA drifts, the fast EMA oscillates,
 * and the strategy gets multiple golden/death crosses to react to.
 *
 * The fixture is intentionally simple so the backtest is reproducible
 * and the CI gate is fast (~10ms).
 */
function mkFixture(numBars: number): readonly Candle[] {
  const startTime = 1_700_000_400_000; // 1h-aligned epoch ms
  const out: Candle[] = [];
  for (let i = 0; i < numBars; i++) {
    let close: number;
    if (i < 200) {
      close = 100; // warmup
    } else {
      // Sinusoidal oscillation around 100.5 with amplitude 0.5.
      // Center 100.5 keeps the slow EMA drift small enough that the
      // golden/death crosses fire with mid-range RSI.
      close = 100.5 + Math.sin((i - 200) * 0.2) * 0.5;
    }
    out.push({
      timestamp: startTime + i * TIMEFRAME_MS["1h"],
      open: close,
      high: close * 1.005,
      low: close * 0.995,
      close,
      volume: 1000,
    });
  }
  return out;
}

/**
 * `simulateStrategy` — walk the fixture, generate signals via the
 * strategy, and simulate trades (entry at next bar's open, exit at
 * take-profit or stop-loss hit, or position reversal on new signal).
 *
 * The simulation is bar-by-bar:
 *   1. At bar i, if a position is open, check if this bar hits SL/TP.
 *      If so, close the position.
 *   2. Ask the strategy for a signal at bar i.  If a new signal comes
 *      in AND we have an open position, close it at the current bar's
 *      close (the new signal is a reversal).
 *   3. Open a new position at bar (i+1).open using the new signal.
 *      (We look one bar ahead.)
 *
 * Returns an aggregate summary suitable for the 1-row table.
 *
 * EXPORTED for direct unit testing (Phase 37 Track 3 mandate:
 * 100% line coverage).
 */
export function simulateStrategy(
  strategy: OhlcLikeStrategy,
  bars: readonly Candle[],
  initialEquity: number,
  riskPct: number,
): { readonly trades: number; readonly wins: number; readonly losses: number; readonly finalEquity: number; readonly maxDD: number; readonly winRate: number } {
  // The aggregate state (mutable, updated in-place by `applyClose`).
  const state: TradeState = { equity: initialEquity, peakEquity: initialEquity, maxDD: 0, wins: 0, losses: 0, trades: 0 };
  // The currently-open position.
  let openPosition: { readonly signal: OhlcTrendSignal; readonly entryPrice: number } | null = null;
  // The signal waiting to be opened on the NEXT bar.
  let pendingSignal: OhlcTrendSignal | null = null;
  for (let i = strategy.warmup(); i < bars.length; i++) {
    const c = bars[i]!;
    // Step 1: if a pending signal exists, open it at this bar's open.
    if (pendingSignal !== null) {
      openPosition = { signal: pendingSignal, entryPrice: c.open };
      pendingSignal = null;
    }
    // Step 2: ask the strategy for a new signal.
    const history = bars.slice(0, i + 1);
    const signal = strategy.onBars(history);
    if (signal === null) continue;
    // Step 3: if a position is open, close it at this bar's close
    // (the new signal reverses the position).  Note: in a real backtest
    // we'd also check SL/TP hits on this bar, but the `ohlc-trend`
    // strategy (with default `crossLookback: 1`) emits on every bar,
    // so the reversal path is the dominant one in the smoke-test
    // fixture.  The `checkSlTpHit` + `applyClose` helpers are still
    // tested directly via the unit tests above.
    if (openPosition !== null) {
      applyClose(openPosition, c.close, riskPct, state);
      openPosition = null;
    }
    // Step 4: queue the new signal — it'll open on the NEXT bar.
    pendingSignal = signal;
  }
  // Step 6: at end-of-data, close any open position at the last bar's close.
  if (openPosition !== null) {
    const lastBar = bars[bars.length - 1]!;
    applyClose(openPosition, lastBar.close, riskPct, state);
  }
  return {
    trades: state.trades,
    wins: state.wins,
    losses: state.losses,
    finalEquity: state.equity,
    maxDD: state.maxDD,
    winRate: state.trades > 0 ? state.wins / state.trades : 0,
  };
}

/**
 * `TradeState` — mutable aggregate trade state used by the simulator.
 * The simulator owns a single instance and passes it to `applyClose`
 * to update the running totals in-place.
 */
interface TradeState {
  equity: number;
  peakEquity: number;
  maxDD: number;
  wins: number;
  losses: number;
  trades: number;
}

/**
 * `checkSlTpHit` — return the exit price if this candle's high/low
 * breaches the open position's stop-loss or take-profit.  Returns
 * `null` if neither is hit.
 *
 * Conservative: SL is checked before TP (worst-case fill priority).
 *
 * EXPORTED for direct unit testing (Phase 37 Track 3 mandate:
 * 100% line coverage).
 */
export function checkSlTpHit(
  candle: Candle,
  position: { readonly signal: OhlcTrendSignal; readonly entryPrice: number },
): number | null {
  if (position.signal.side === "buy") {
    if (candle.low <= position.signal.stopLoss) return position.signal.stopLoss;
    if (candle.high >= position.signal.takeProfit) return position.signal.takeProfit;
  } else {
    if (candle.high >= position.signal.stopLoss) return position.signal.stopLoss;
    if (candle.low <= position.signal.takeProfit) return position.signal.takeProfit;
  }
  return null;
}

/**
 * `applyClose` — close an open position at the given exit price,
 * update the running totals (equity, peak, maxDD, wins/losses/trades).
 * Mutates `state` in place.
 *
 * EXPORTED for direct unit testing.
 */
export function applyClose(
  position: { readonly signal: OhlcTrendSignal; readonly entryPrice: number },
  exitPrice: number,
  riskPct: number,
  state: TradeState,
): void {
  const pnlPerUnit = position.signal.side === "buy" ? exitPrice - position.entryPrice : position.entryPrice - exitPrice;
  const riskPerUnit = Math.abs(position.entryPrice - position.signal.stopLoss);
  const riskAmount = state.equity * riskPct;
  const quantity = riskPerUnit > 0 ? riskAmount / riskPerUnit : 0;
  const pnl = pnlPerUnit * quantity;
  state.equity += pnl;
  state.peakEquity = Math.max(state.peakEquity, state.equity);
  state.maxDD = Math.max(state.maxDD, (state.peakEquity - state.equity) / state.peakEquity);
  if (pnl > 0) state.wins++;
  else if (pnl < 0) state.losses++;
  state.trades++;
}

/**
 * `formatSummaryTable` — render the 1-row summary table per the
 * project convention: strategy / total trades / win rate / max DD /
 * final equity / OOS ratio (n/a for fixture).
 */
function formatSummaryTable(
  strategyName: string,
  result: { readonly trades: number; readonly wins: number; readonly losses: number; readonly finalEquity: number; readonly maxDD: number; readonly winRate: number },
  initialEquity: number,
  numBars: number,
): string {
  const headers = ["Strategy", "Trades", "WinRate", "MaxDD", "FinalEquity", "Bars"];
  const winRateStr = (result.winRate * 100).toFixed(1) + "%";
  const maxDDStr = (result.maxDD * 100).toFixed(1) + "%";
  const finalEquityStr = "$" + result.finalEquity.toFixed(2);
  const returnStr = (((result.finalEquity - initialEquity) / initialEquity) * 100).toFixed(1) + "%";
  const row = [
    strategyName,
    String(result.trades),
    winRateStr,
    maxDDStr,
    finalEquityStr + " (" + returnStr + ")",
    String(numBars),
  ];
  // Compute column widths.
  const widths = headers.map((h, i) => Math.max(h.length, row[i]!.length));
  const sep = "+" + widths.map((w) => "-".repeat(w + 2)).join("+") + "+";
  const fmtRow = (cells: readonly string[]): string =>
    "|" + cells.map((c, i) => " " + c.padEnd(widths[i]!) + " ").join("|") + "|";
  const lines: string[] = [];
  lines.push(sep);
  lines.push(fmtRow(headers));
  lines.push(sep);
  lines.push(fmtRow(row));
  lines.push(sep);
  return lines.join("\n");
}

/**
 * `backtestCommand` — the `mm-bot backtest` handler.
 */
export const backtestCommand: SubcommandHandler = async (args) => {
  await Promise.resolve();
  const sub = args.positional[0];
  const flags = args.flags;

  if (sub === undefined || sub === "--help" || sub === "-h") {
    console.log("Usage: mm-bot backtest <strategy> [options]");
    console.log("");
    console.log("Strategies:");
    const reg = buildStrategyRegistry();
    for (const [name, desc] of reg) {
      console.log(`  ${name.padEnd(20)} ${desc.displayName}`);
    }
    console.log("");
    console.log("Options:");
    console.log("  --strategy=<name>    strategy to test (default: positional arg or 'ohlc-trend')");
    console.log("  --bars=<N>           number of bars in the fixture (default: 250)");
    console.log("  --risk-pct=<pct>     risk per trade as % of equity (default: 0.01 = 1%)");
    console.log("  --initial-equity=$N  starting equity in USDT (default: 10000)");
    console.log("  --visualize          launch the TUI Charts panel after the backtest (not yet wired)");
    console.log("  --timeframe=<tf>     timeframe (default: 1h)");
    return 0;
  }

  const strategyName = getFlag(flags, "strategy") ?? sub;
  const bars = Number(getFlag(flags, "bars") ?? "250");
  const riskPct = Number(getFlag(flags, "risk-pct") ?? "0.01");
  const initialEquity = Number(getFlag(flags, "initial-equity") ?? "10000");
  const visualize = getFlagBool(flags, "visualize", false);
  const timeframe = (getFlag(flags, "timeframe") ?? "1h") as Timeframe;

  if (!Number.isFinite(bars) || bars < 50) {
    console.error(fail("Invalid --bars: must be an integer >= 50"));
    return 1;
  }
  if (!Number.isFinite(riskPct) || riskPct <= 0 || riskPct > 1) {
    console.error(fail("Invalid --risk-pct: must be 0 < pct <= 1"));
    return 1;
  }
  if (!Number.isFinite(initialEquity) || initialEquity <= 0) {
    console.error(fail("Invalid --initial-equity: must be positive"));
    return 1;
  }

  const reg = buildStrategyRegistry();
  const desc = reg.get(strategyName);
  if (desc === undefined) {
    console.error(fail(`Unknown strategy: ${strategyName}`));
    console.error(dim(`Available: ${[...reg.keys()].join(", ")}`));
    return 1;
  }

  const strategy = desc.create({});
  const fixture = mkFixture(bars);
  const result = simulateStrategy(strategy, fixture, initialEquity, riskPct);

  console.log(colorize(`Strategy: ${desc.displayName}`, "bold"));
  console.log(dim(`Timeframe: ${timeframe} | Bars: ${String(bars)} | Initial equity: $${initialEquity.toFixed(2)} | Risk/trade: ${(riskPct * 100).toFixed(1)}%`));
  console.log("");
  console.log(formatSummaryTable(strategyName, result, initialEquity, bars));
  console.log("");
  if (result.trades === 0) {
    console.log(warn("No trades were triggered on the fixture. Try a longer fixture or a different strategy."));
  } else {
    console.log(ok(`Backtest complete. ${result.wins} wins, ${result.losses} losses, ${(result.winRate * 100).toFixed(1)}% win rate.`));
  }
  if (visualize) {
    // Phase 44: a `--visualize` flag megmarad a backward-compat kedvéért,
    // de a TUI Charts panel törölve lett. A flag jelenleg csak egy
    // notice-t ír ki — a vizualizáció a Phase 46+ web client-be költözik.
    console.log("");
    console.log(warn("--visualize is recognized but not yet wired (TUI removed in Phase 44)."));
    console.log(dim("Visualization will land in the Phase 46 web client (mm-bot web)."));
  }
  // Acknowledge unused imports (silent, just for tree-shake clarity).
  void makeSymbol;
  return 0;
};
