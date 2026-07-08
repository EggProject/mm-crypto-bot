#!/usr/bin/env bun
// packages/backtest-tools/src/cli/run-paper-trade-gate.ts —
// Phase 27 — 7-day paper-trade gate for production promotion.
//
// Runs a strategy in paper-trade mode over the last N days (default 7)
// and compares actual P&L against an expected baseline. Emits PASS/FAIL
// verdict.
//
// Usage:
//   bun run packages/backtest-tools/src/cli/run-paper-trade-gate.ts \
//     --strategy=v2 --symbol=BTC/USDT
//   bun run packages/backtest-tools/src/cli/run-paper-trade-gate.ts \
//     --strategy=v2 --symbol=ETH/USDT --days=7 --floor-pct=0.05
//
// The gate wraps the strategy CLI in --start/--end mode and evaluates:
//   - Actual 7-day P&L >= floor (default 0% — at least break-even)
//   - DD stays within hard ceiling (default 5%)
//   - Sharpe is non-negative
//
// Exit codes:
//   0 = PASS (gate opens)
//   1 = FAIL (gate stays closed, strategy stays in paper-trade)

import { resolve } from "node:path";

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

interface GateArgs {
  readonly strategy: "v2" | "dydx-cex-carry" | "donchian-pivot-composition";
  readonly symbol: string;
  readonly days: number;
  readonly floorPct: number;
  readonly ddCeilingPct: number;
  readonly endDate: string;
  readonly minConsensus: number;
  readonly outputPath: string;
}

function parseArgs(): GateArgs {
  const args = process.argv.slice(2);
  let strategy: GateArgs["strategy"] = "v2";
  let symbol = "BTC/USDT";
  let days = 7;
  let floorPct = 0.0;
  let ddCeilingPct = 5.0;
  // Default end date = today (2026-07-08). Override with --end-date=YYYY-MM-DD.
  let endDate = "2026-07-08";
  // Phase 27 — for donchian-pivot, default to 1of2 (loose consensus) for short-window
  // paper-trade gates; 2of2 (strict consensus) produces 0 trades in 7-day windows.
  // For 30+ day windows, 2of2 is appropriate.
  let minConsensus = 1;
  let outputPath = "";
  for (const arg of args) {
    if (arg.startsWith("--strategy=")) {
      const s = arg.slice("--strategy=".length);
      if (s !== "v2" && s !== "dydx-cex-carry" && s !== "donchian-pivot-composition") {
        throw new Error(`Unknown strategy: ${s}. Supported: v2, dydx-cex-carry, donchian-pivot-composition`);
      }
      strategy = s;
    } else if (arg.startsWith("--symbol=")) {
      symbol = arg.slice("--symbol=".length);
    } else if (arg.startsWith("--days=")) {
      days = Number(arg.slice("--days=".length));
    } else if (arg.startsWith("--floor-pct=")) {
      floorPct = Number(arg.slice("--floor-pct=".length));
    } else if (arg.startsWith("--dd-ceiling-pct=")) {
      ddCeilingPct = Number(arg.slice("--dd-ceiling-pct=".length));
    } else if (arg.startsWith("--end-date=")) {
      endDate = arg.slice("--end-date=".length);
    } else if (arg.startsWith("--min-consensus=")) {
      minConsensus = Number(arg.slice("--min-consensus=".length));
    } else if (arg.startsWith("--output=")) {
      outputPath = arg.slice("--output=".length);
    }
  }
  if (!outputPath) {
    outputPath = `backtest-results/fresh-2026-07-08/gate-${strategy}-${symbol.replace("/", "-").toLowerCase()}-${days}d.json`;
  }
  return { strategy, symbol, days, floorPct, ddCeilingPct, endDate, minConsensus, outputPath };
}

/**
 * `computeStartDate` — returns YYYY-MM-DD string for (endDate - days).
 */
function computeStartDate(endDate: string, days: number): string {
  const end = new Date(endDate + "T00:00:00.000Z");
  const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);
  return start.toISOString().slice(0, 10);
}

/**
 * `runStrategyCli` — invokes the strategy CLI in --start/--end mode and
 * captures stdout. The CLI emits JSON with totalReturnPct, sharpe, maxDdPct.
 */
function runStrategyCli(args: GateArgs, startDate: string): {
  totalReturnPct: number;
  sharpe: number;
  maxDdPct: number;
  totalTrades: number;
} | null {
  let cliCmd: string;
  let cliArgs: string[];
  switch (args.strategy) {
    case "v2":
      cliCmd = "packages/backtest-tools/src/cli/run-multi-class-baseline-v2.ts";
      cliArgs = [
        "--symbol=" + args.symbol,
        "--start=" + startDate,
        "--end=" + args.endDate,
        "--output=" + args.outputPath,
      ];
      break;
    case "donchian-pivot-composition":
      cliCmd = "packages/backtest-tools/src/cli/run-donchian-pivot-composition.ts";
      cliArgs = [
        "--symbol=" + args.symbol,
        "--start=" + startDate,
        "--end=" + args.endDate,
        `--min-consensus=${args.minConsensus}`,
        "--output=" + args.outputPath,
      ];
      break;
    case "dydx-cex-carry":
      // Phase 25 #2 dydx carry uses window-based logic. Skip for now
      // (would need a separate window-paper-trade runner; out of scope).
      throw new Error("dydx-cex-carry paper-trade gate not yet implemented — use v2 or donchian-pivot-composition");
    default:
      throw new Error(`Unknown strategy: ${String(args.strategy)}`);
  }

  console.log(`[gate] Running ${args.strategy} ${args.symbol} for ${args.days} days (${startDate} to ${args.endDate})`);
  const result = spawnSync("bun", ["run", cliCmd, ...cliArgs], {
    cwd: resolve(import.meta.dir, "..", "..", "..", ".."),
    encoding: "utf8",
  });
  if (result.status !== 0) {
    console.error(`[gate] CLI failed: ${result.stderr}`);
    return null;
  }
  // Parse the output JSON to extract metrics.
  // V2 emits `combinedEdge.totalReturnPct`, donchian emits `result.totalReturn * 100`.
  try {
    const raw = readFileSync(args.outputPath, "utf8");
    const json: unknown = JSON.parse(raw);
    if (typeof json !== "object" || json === null) return null;
    const obj = json as Record<string, unknown>;
    const combined = obj["combinedEdge"] as Record<string, unknown> | undefined;
    if (combined) {
      const result = obj["result"] as Record<string, unknown> | undefined;
      return {
        totalReturnPct: (combined["totalReturnPct"] as number | undefined) ?? 0,
        sharpe: (combined["sharpe"] as number | undefined) ?? 0,
        maxDdPct: (combined["maxDrawdownPct"] as number | undefined) ?? 0,
        totalTrades: (result?.["totalTrades"] as number | undefined) ?? 0,
      };
    }
    const result = obj["result"] as Record<string, unknown> | undefined;
    if (result) {
      return {
        totalReturnPct: ((result["totalReturn"] as number | undefined) ?? 0) * 100,
        sharpe: (result["sharpeRatio"] as number | undefined) ?? 0,
        maxDdPct: ((result["maxDrawdown"] as number | undefined) ?? 0) * 100,
        totalTrades: (result["totalTrades"] as number | undefined) ?? 0,
      };
    }
    return null;
  } catch (err) {
    console.error(`[gate] Failed to parse JSON output: ${String(err)}`);
    return null;
  }
}

/**
 * `evaluateGate` — returns PASS/FAIL verdict with reason.
 */
function evaluateGate(
  args: GateArgs,
  metrics: { totalReturnPct: number; sharpe: number; maxDdPct: number; totalTrades: number },
): { verdict: "PASS" | "FAIL"; reason: string } {
  const reasons: string[] = [];
  const winLabel = `${args.days}d`;
  if (metrics.totalReturnPct < args.floorPct) {
    reasons.push(
      `${winLabel} return ${metrics.totalReturnPct.toFixed(2)}% < floor ${args.floorPct.toFixed(2)}%`,
    );
  }
  if (metrics.maxDdPct > args.ddCeilingPct) {
    reasons.push(
      `${winLabel} DD ${metrics.maxDdPct.toFixed(2)}% > ceiling ${args.ddCeilingPct.toFixed(2)}%`,
    );
  }
  if (metrics.sharpe < 0) {
    reasons.push(`${winLabel} Sharpe ${metrics.sharpe.toFixed(3)} < 0`);
  }
  if (metrics.totalTrades === 0 && args.strategy === "v2") {
    reasons.push("0 trades (strategy did not produce signals)");
  }
  if (reasons.length === 0) {
    return { verdict: "PASS", reason: `all gates passed` };
  }
  return { verdict: "FAIL", reason: reasons.join("; ") };
}

async function main(): Promise<void> {
  const args = parseArgs();
  const startDate = computeStartDate(args.endDate, args.days);
console.log("=".repeat(80));
  console.log(`[gate] ${args.days}-DAY PAPER-TRADE GATE`);
  console.log(`[gate] Strategy: ${args.strategy}`);
  console.log(`[gate] Symbol:   ${args.symbol}`);
  console.log(`[gate] Window:   ${startDate} to ${args.endDate} (${args.days} days)`);
  console.log(`[gate] Floor:    ${args.floorPct}% return`);
  console.log(`[gate] DD ceil:  ${args.ddCeilingPct}%`);
  if (args.strategy === "donchian-pivot-composition") {
    console.log(`[gate] Consensus: ${args.minConsensus}of2`);
  }
  console.log("=".repeat(80));

  const metrics = runStrategyCli(args, startDate);
  if (!metrics) {
    console.error("[gate] FATAL: CLI run failed");
    process.exit(1);
  }

  console.log(`[gate] Actual ${args.days}d return:  ${metrics.totalReturnPct.toFixed(2)}%`);
  console.log(`[gate] Actual ${args.days}d Sharpe:  ${metrics.sharpe.toFixed(3)}`);
  console.log(`[gate] Actual ${args.days}d Max DD:  ${metrics.maxDdPct.toFixed(2)}%`);
  console.log(`[gate] Actual trades:     ${metrics.totalTrades}`);

  const evalResult = evaluateGate(args, metrics);
  console.log("=".repeat(80));
  console.log(`[gate] VERDICT: ${evalResult.verdict}`);
  console.log(`[gate] REASON:  ${evalResult.reason}`);
  console.log("=".repeat(80));

  // Write gate report
  const fs = await import("node:fs/promises");
  const reportPath = args.outputPath.replace(/\.json$/, ".gate-report.json");
  await fs.writeFile(
    reportPath,
    JSON.stringify(
      {
        strategy: args.strategy,
        symbol: args.symbol,
        window: { start: startDate, end: args.endDate, days: args.days },
        floor: { returnPct: args.floorPct, ddCeilingPct: args.ddCeilingPct },
        actual: metrics,
        verdict: evalResult.verdict,
        reason: evalResult.reason,
        generatedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
    "utf8",
  );
  console.log(`[gate] Report saved: ${reportPath}`);

  process.exit(evalResult.verdict === "PASS" ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error("[gate] FATAL:", err);
  process.exit(1);
});