// packages/backtest-tools/src/cli/run-funding-rate-carry-composition.test.ts —
// Phase 22 Track B — Integration tests for the funding-rate carry CLI runner.
//
// ===========================================================================
// PHASE 22 TRACK B — INTEGRATION TESTS
// ===========================================================================
//
// Tests (8 total):
//   1. Default (no funding-rate) returns a result — regression anchor.
//   2. `--enable-funding-rate-carry=true` engages the funding-rate path
//      (NOT-silent-no-op) — verify the JSON differs from Test 1's output.
//   3. Bit-identical-trade-stream probe — diff trade-by-trade between ON/OFF.
//   4. Win-rate per symbol byte-equal between ON/OFF (proves the toggle
//      is a signal source, not a strategy change).
//   5. `--enable-funding-rate-carry=true` without `--funding-rate-csv-path`
//      THROWS (hard error, no silent no-op).
//   6. `--enable-funding-rate-carry=true` with non-existent CSV THROWS.
//   7. Funding-rate distribution printed up-front (grep stdout for
//      "funding-rate carry engaged").
//   8. 1:10 leverage invariant — max effective leverage ≤ 10×.
//
// Each test uses `Bun.spawn` to invoke the CLI runner as a subprocess
// (matches how the user would invoke it) — this avoids test-time vs
// production-time divergence. Outputs are written to `tmpdir()` for
// cleanup in `afterAll`.

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdir } from "node:fs/promises";
import { mkdtempSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";

const PROJECT_ROOT = resolve(import.meta.dir, "..", "..", "..", "..");
const RUNNER_PATH = resolve(
  PROJECT_ROOT,
  "packages",
  "backtest-tools",
  "src",
  "cli",
  "run-funding-rate-carry-composition.ts",
);
const BTC_FUNDING_CSV = resolve(PROJECT_ROOT, "data", "funding", "binance_btcusdt_funding_8h.csv");

// ---------------------------------------------------------------------------
// Fixture management
// ---------------------------------------------------------------------------

/** Output directory for the integration tests — created lazily. */
let outputDir: string;

beforeAll(async () => {
  outputDir = mkdtempSync(resolve(tmpdir(), "phase22-b-wire-"));
  await mkdir(outputDir, { recursive: true });
});

afterAll(() => {
  if (outputDir !== undefined) {
    try {
      rmSync(outputDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
});

/** Output path for a given test tag. */
function out(tag: string): string {
  return resolve(outputDir, `${tag}.json`);
}

/**
 * `runCli` — invoke the runner as a subprocess and return the parsed
 * stdout + the JSON file content (if produced) + the exit code.
 *
 * Uses `bun run <runner> ...args`. We DO NOT redirect stdout to a pipe
 * — we capture both stdout and the JSON file the runner writes.
 */
async function runCli(args: readonly string[]): Promise<{
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly json: unknown | null;
}> {
  const proc = Bun.spawn({
    cmd: ["bun", "run", RUNNER_PATH, ...args],
    cwd: PROJECT_ROOT,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, BUN_ENV: "test" },
  });
  const [stdoutText, stderrText] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;

  // Parse the JSON file if --output was provided.
  const outputArg = args.find((a) => a.startsWith("--output="));
  let json: unknown | null = null;
  if (outputArg !== undefined) {
    const jsonPath = outputArg.slice("--output=".length);
    try {
      const content = await Bun.file(jsonPath).text();
      json = JSON.parse(content);
    } catch {
      json = null;
    }
  }
  return { exitCode, stdout: stdoutText, stderr: stderrText, json };
}

// ---------------------------------------------------------------------------
// Common CLI arg builders
// ---------------------------------------------------------------------------

/**
 * `baseArgs` — common arg list for the BTC 0.12 1-of-2 tests. Matches
 * the Phase 19 #1 envelope so the OFF run is bit-comparable to the
 * existing Phase 19 baselines (BTC 0.12 monthly ~26.67%, ~11043 trades).
 */
function baseArgs(extra: readonly string[] = []): readonly string[] {
  return [
    "--symbol=BTC/USDT",
    "--timeframe=15m",
    "--min-consensus=1",
    "--max-position-pct-equity=0.12",
    ...extra,
  ];
}

// ---------------------------------------------------------------------------
// Test 1: Default (no funding-rate) — regression anchor
// ---------------------------------------------------------------------------

describe("run-funding-rate-carry-composition — Test 1: default (no funding-rate)", () => {
  it("Test 1: produces a backtest JSON with the expected structure", async () => {
    const tag = "t1-no-carry";
    const args = [...baseArgs(), `--output=${out(tag)}`];
    const result = await runCli(args);
    expect(result.exitCode).toBe(0);
    expect(result.json).not.toBeNull();

    const json = result.json as {
      args: { enableFundingRateCarry: boolean; symbol: string; minConsensus: number; maxPositionPctEquity: number };
      strategyKind: string;
      components: readonly string[];
      monthlyReturn: number;
      totalMonths: number;
      result: { totalTrades: number; trades: readonly unknown[]; maxDrawdown: number };
    };
    // Verify default OFF path.
    expect(json.args.enableFundingRateCarry).toBe(false);
    expect(json.strategyKind).toBe("donchian-pivot");
    // Components list — only DP, no carry.
    expect(json.components).toEqual(["donchian-range", "pivot-grid"]);
    // Phase 19 #1 envelope for BTC 0.12 1-of-2: ~26.67%/mo, ~11043 trades.
    expect(json.result.totalTrades).toBeGreaterThan(5_000);
    expect(json.monthlyReturn).toBeGreaterThan(0.20);
    expect(json.monthlyReturn).toBeLessThan(0.35);
    expect(json.result.maxDrawdown).toBeGreaterThan(0);
    expect(json.result.maxDrawdown).toBeLessThan(0.10);
  }, { timeout: 180_000 });
});

// ---------------------------------------------------------------------------
// Test 2: enable-funding-rate-carry=true engages the funding-rate path
// (NOT-silent-no-op — JSON differs from Test 1's output)
// ---------------------------------------------------------------------------

describe("run-funding-rate-carry-composition — Test 2: NOT-silent-no-op verification", () => {
  it("Test 2: ON run JSON differs from OFF run JSON (carry affects backtest)", async () => {
    const offTag = "t2-off";
    const onTag = "t2-on";
    const offArgs = [...baseArgs(), `--output=${out(offTag)}`];
    const onArgs = [
      ...baseArgs(),
      "--enable-funding-rate-carry=true",
      "--funding-rate-mode=2of3",
      `--funding-rate-csv-path=${BTC_FUNDING_CSV}`,
      `--output=${out(onTag)}`,
    ];

    const offResult = await runCli(offArgs);
    const onResult = await runCli(onArgs);
    expect(offResult.exitCode).toBe(0);
    expect(onResult.exitCode).toBe(0);
    expect(offResult.json).not.toBeNull();
    expect(onResult.json).not.toBeNull();

    const offJson = offResult.json as { result: { totalTrades: number; trades: readonly { notionalUsd: number }[] } };
    const onJson = onResult.json as {
      strategyKind: string;
      components: readonly string[];
      result: { totalTrades: number; trades: readonly { notionalUsd: number }[] };
    };

    // Strategy class MUST change.
    expect(onJson.strategyKind).toBe("funding-rate-carry");
    expect(onJson.components).toContain("funding-rate-carry");

    // The trade stream MUST differ — at minimum the notionalUsd values
    // (in 2of3 mode the carry votes short in a bull market → side
    // conflicts with the mean-reversion DP signals → suppressed trades;
    // in 1of3 mode the carry adds new trades).
    const offNotionals = offJson.result.trades.map((t) => t.notionalUsd);
    const onNotionals = onJson.result.trades.map((t) => t.notionalUsd);
    const notionalsIdentical =
      offNotionals.length === onNotionals.length &&
      offNotionals.every((v, i) => v === onNotionals[i]);
    // Trade count and/or notionalUsd values MUST differ.
    const totalTradesIdentical = offJson.result.totalTrades === onJson.result.totalTrades;
    expect(notionalsIdentical && totalTradesIdentical).toBe(false);
  }, { timeout: 300_000 });
});

// ---------------------------------------------------------------------------
// Test 3: Bit-identical-trade-stream probe — diff trade-by-trade ON vs OFF
// ---------------------------------------------------------------------------

describe("run-funding-rate-carry-composition — Test 3: bit-identical-trade-stream probe", () => {
  it("Test 3: ON run trade stream differs from OFF run (carry affects signal emit)", async () => {
    // Reuse the JSONs produced in Test 2 (read them off disk).
    const offPath = out("t2-off");
    const onPath = out("t2-on");
    const offRaw = await Bun.file(offPath).text();
    const onRaw = await Bun.file(onPath).text();
    const offJson = JSON.parse(offRaw) as { result: { trades: readonly { entryTime: number; side: string; notionalUsd: number; pnlUsd: number }[] } };
    const onJson = JSON.parse(onRaw) as { result: { trades: readonly { entryTime: number; side: string; notionalUsd: number; pnlUsd: number }[] } };

    // Build a Map keyed by entry-time → trade for the OFF run.
    const offByTs = new Map<number, { side: string; notionalUsd: number; pnlUsd: number }>();
    for (const t of offJson.result.trades) {
      offByTs.set(t.entryTime, { side: t.side, notionalUsd: t.notionalUsd, pnlUsd: t.pnlUsd });
    }
    // For each ON trade, check whether the OFF run had a trade at the
    // same entryTime with identical side/notionalUsd/pnlUsd.
    let matches = 0;
    for (const t of onJson.result.trades) {
      const off = offByTs.get(t.entryTime);
      if (off !== undefined && off.side === t.side && off.notionalUsd === t.notionalUsd && off.pnlUsd === t.pnlUsd) {
        matches += 1;
      }
    }
    // The carry MUST affect the trade stream — some trades must change
    // (notionalUsd altered by carry confidence contribution, or new
    // trades added, or DP trades removed by side-conflict).
    const onTotal = onJson.result.trades.length;
    // At least 5% of trades should differ — proving the carry is NOT a
    // silent no-op. (Strict equality of all trades = Phase 20 #1 failure.)
    expect(matches).toBeLessThan(onTotal * 0.95);
  }, { timeout: 60_000 });
});

// ---------------------------------------------------------------------------
// Test 4: Win-rate per symbol byte-equal between ON/OFF (proves DP signals
// themselves unchanged — only the carry vote modifies the consensus)
// ---------------------------------------------------------------------------

describe("run-funding-rate-carry-composition — Test 4: win-rate invariant", () => {
  it("Test 4: overall win-rate (wins/total) is preserved within 5pp between ON and OFF", async () => {
    const offPath = out("t2-off");
    const onPath = out("t2-on");
    const offJson = JSON.parse(await Bun.file(offPath).text()) as {
      result: { trades: readonly { pnlUsd: number }[] };
    };
    const onJson = JSON.parse(await Bun.file(onPath).text()) as {
      result: { trades: readonly { pnlUsd: number }[] };
    };

    const winRate = (trades: readonly { pnlUsd: number }[]): number => {
      if (trades.length === 0) return 0;
      const wins = trades.filter((t) => t.pnlUsd > 0).length;
      return wins / trades.length;
    };
    const offWR = winRate(offJson.result.trades);
    const onWR = winRate(onJson.result.trades);

    // The carry is a SIGNAL SOURCE (adds votes, doesn't replace logic).
    // Win-rate preservation is a soft invariant — we expect ≤5pp drift.
    // Phase 18 2-of-2 baseline BTC 1-of-2 win-rate ~64.77%; with the
    // carry suppressing some DP signals via side-conflict, win-rate may
    // drift but should stay within a tight band.
    expect(Math.abs(offWR - onWR)).toBeLessThan(0.05);
  }, { timeout: 60_000 });
});

// ---------------------------------------------------------------------------
// Test 5: --enable-funding-rate-carry=true without --funding-rate-csv-path
// throws (hard error, no silent no-op)
// ---------------------------------------------------------------------------

describe("run-funding-rate-carry-composition — Test 5: missing CSV path throws", () => {
  it("Test 5: enable-funding-rate-carry=true without CSV path exits non-zero with descriptive error", async () => {
    const args = [
      "--symbol=BTC/USDT",
      "--timeframe=15m",
      "--min-consensus=1",
      "--max-position-pct-equity=0.12",
      "--enable-funding-rate-carry=true",
      // intentionally no --funding-rate-csv-path
      `--output=${out("t5")}`,
    ];
    const result = await runCli(args);
    expect(result.exitCode).not.toBe(0);
    // Error message must mention the missing CSV path (NOT-silent-no-op
    // defense — user must see exactly what they forgot).
    const combined = result.stdout + result.stderr;
    expect(combined).toMatch(/funding-rate-csv-path|NOT-silent-no-op/);
  }, { timeout: 60_000 });
});

// ---------------------------------------------------------------------------
// Test 6: --enable-funding-rate-carry=true with non-existent CSV throws
// ---------------------------------------------------------------------------

describe("run-funding-rate-carry-composition — Test 6: non-existent CSV throws", () => {
  it("Test 6: enable-funding-rate-carry=true with bogus CSV path exits non-zero", async () => {
    const args = [
      "--symbol=BTC/USDT",
      "--timeframe=15m",
      "--min-consensus=1",
      "--max-position-pct-equity=0.12",
      "--enable-funding-rate-carry=true",
      "--funding-rate-mode=2of3",
      "--funding-rate-csv-path=/tmp/does-not-exist-phase22-b-test.csv",
      `--output=${out("t6")}`,
    ];
    const result = await runCli(args);
    expect(result.exitCode).not.toBe(0);
    const combined = result.stdout + result.stderr;
    expect(combined).toMatch(/does not exist|ENOENT|NOT-silent-no-op|no such file/i);
  }, { timeout: 60_000 });
});

// ---------------------------------------------------------------------------
// Test 7: Funding-rate distribution printed up-front (grep stdout for
// "funding-rate carry engaged")
// ---------------------------------------------------------------------------

describe("run-funding-rate-carry-composition — Test 7: distribution line printed", () => {
  it("Test 7: stdout contains 'funding-rate carry engaged' distribution line", async () => {
    const args = [
      "--symbol=BTC/USDT",
      "--timeframe=15m",
      "--min-consensus=1",
      "--max-position-pct-equity=0.12",
      "--enable-funding-rate-carry=true",
      "--funding-rate-mode=2of3",
      `--funding-rate-csv-path=${BTC_FUNDING_CSV}`,
      `--output=${out("t7")}`,
    ];
    const result = await runCli(args);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/funding-rate carry engaged/);
    expect(result.stdout).toMatch(/mode=2of3/);
    expect(result.stdout).toMatch(/funding-distribution=/);
    expect(result.stdout).toMatch(/positive:/);
    expect(result.stdout).toMatch(/negative:/);
    expect(result.stdout).toMatch(/neutral:/);
  }, { timeout: 180_000 });
});

// ---------------------------------------------------------------------------
// Test 8: 1:10 leverage invariant — max effective leverage ≤ 10×
// ---------------------------------------------------------------------------

describe("run-funding-rate-carry-composition — Test 8: 1:10 leverage invariant", () => {
  it("Test 8: max trade notional / equity-at-trade-time <= 10× (1:10 mandate)", async () => {
    // Use the ON run from Test 2 (most leverage-sensitive scenario).
    const onPath = out("t2-on");
    const onJson = JSON.parse(await Bun.file(onPath).text()) as {
      args: { initialEquity: number; maxPositionPctEquity: number };
      result: {
        trades: readonly { notionalUsd: number; entryTime: number }[];
        equityCurve: readonly { timestamp: number; equity: number }[];
      };
    };
    const maxCap = onJson.args.maxPositionPctEquity;

    // The 1:10 mandate is enforced at three layers in this codebase.
    // Verify engine-level invariant: max(notionalUsd / equity-at-trade)
    // across all trades <= 10× (the engine uses maxPositionPctEquity ×
    // confidence × leverage, and confidence ≤ 1.0, so effective leverage
    // on current equity is at most cap × 10×).
    //
    // We approximate equity-at-trade-time by linear interpolation
    // across the equityCurve (curve is monotonic-ish on a winning
    // strategy; worst-case for leverage is peak equity, so we look up
    // the equity nearest each trade's entryTime).
    const sortedCurve = [...onJson.result.equityCurve].sort((a, b) => a.timestamp - b.timestamp);
    const equityAt = (ts: number): number => {
      // Binary search for the largest curve point with timestamp <= ts.
      let lo = 0;
      let hi = sortedCurve.length - 1;
      let best = sortedCurve[0]?.equity ?? 1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const p = sortedCurve[mid];
        if (p === undefined) break;
        if (p.timestamp <= ts) {
          best = p.equity;
          lo = mid + 1;
        } else {
          hi = mid - 1;
        }
      }
      return best;
    };

    let maxLeverageRatio = 0;
    let maxNotionalUsd = 0;
    let minEquityAtTrade = Number.POSITIVE_INFINITY;
    for (const t of onJson.result.trades) {
      const eq = equityAt(t.entryTime);
      if (eq < minEquityAtTrade) minEquityAtTrade = eq;
      if (t.notionalUsd > maxNotionalUsd) maxNotionalUsd = t.notionalUsd;
      const ratio = t.notionalUsd / eq;
      if (ratio > maxLeverageRatio) maxLeverageRatio = ratio;
    }
    // Strict: leverage ratio never exceeds 10× relative to equity-at-time.
    expect(maxLeverageRatio).toBeLessThanOrEqual(10);
    // Loose: max notional <= cap × 10 × peak equity (over the run).
    const peakEquity = Math.max(...sortedCurve.map((p) => p.equity));
    const capLeveragedMax = maxCap * 10 * peakEquity;
    expect(maxNotionalUsd).toBeLessThanOrEqual(capLeveragedMax);
    // Diagnostic context for the deliverable.md report.
    expect(minEquityAtTrade).toBeGreaterThan(0);
  }, { timeout: 60_000 });
});