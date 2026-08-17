import { describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import type { BacktestResult } from "@mm-crypto-bot/backtest";
import type { SizingSignal } from "@mm-crypto-bot/core";

import {
  OVERLAY_MASKS,
  parseArgs,
  runCombination,
  takeDueFundingRows,
  type OverlayAuditEvent,
  type OverlayStrategyMetrics,
} from "./run-dpc-overlay-combination.js";
import { parseFundingCsv } from "./run-sol-flip-funding-replay.js";

const ROOT = resolve(import.meta.dir, "..", "..", "..", "..");
const DATA_DIR = resolve(ROOT, "data", "ohlcv");
const FUNDING = resolve(ROOT, "data", "funding", "binance_solusdt_funding_8h.csv");

interface CombinationOutput {
  readonly status: string;
  readonly result: BacktestResult;
  readonly sizingSignals: readonly SizingSignal[];
  readonly overlayMetrics: OverlayStrategyMetrics & {
    readonly regimeDirectionSignalsReceived: number | null;
    readonly regimeSizingSignalsReceived: number | null;
  };
  readonly causality: {
    readonly lookaheadViolations: number;
    readonly audit: readonly OverlayAuditEvent[];
  };
  readonly inputProvenance: {
    readonly ohlcv: { readonly synthetic: boolean; readonly coverageRatio: number };
    readonly funding: { readonly synthetic?: boolean; readonly coverageRatio?: number };
  };
}

function args(mask: string, symbol: string, start: string, end: string) {
  return parseArgs([
    `--mask=${mask}`,
    `--symbol=${symbol}`,
    `--start=${start}`,
    `--end=${end}`,
    `--data-dir=${DATA_DIR}`,
    `--funding-input=${FUNDING}`,
    "--min-consensus=1",
    "--risk-per-trade=0.001",
  ]);
}

async function run(mask: string, symbol: string, start: string, end: string): Promise<CombinationOutput> {
  return (await runCombination(args(mask, symbol, start, end))) as unknown as CombinationOutput;
}

describe("run-dpc-overlay-combination — production overlay replay on real CSV data", () => {
  it("exposes exactly the four requested masks and rejects SOLFlip as a BTC/ETH no-op", () => {
    expect(OVERLAY_MASKS).toEqual(["dpc", "dpc-solflip", "dpc-regime", "dpc-solflip-regime"]);
    expect(() => args("dpc-solflip", "BTC/USDT", "2024-01-01", "2024-01-02")).toThrow(
      /INVALID_MASK.*SOL\/USDT/,
    );
    expect(() => args("dpc-solflip-regime", "ETH/USDT", "2024-01-01", "2024-01-02")).toThrow(
      /INVALID_MASK.*SOL\/USDT/,
    );
  });

  it("never releases a real funding observation before its exchange timestamp", () => {
    const rows = parseFundingCsv(readFileSync(FUNDING, "utf8"));
    const cursor = 100;
    const cutoff = rows[cursor + 4]!.fundingTime;
    const batch = takeDueFundingRows(rows, cursor, cutoff);
    expect(batch.rows.length).toBe(5);
    expect(batch.rows.every((row) => row.fundingTime <= cutoff)).toBe(true);
    expect(rows[batch.nextCursor]!.fundingTime).toBeGreaterThan(cutoff);
  });

  it("Regime ON consumes genuine DPC direction/executed sizing and changes real position notionals", async () => {
    const [plain, regime] = await Promise.all([
      run("dpc", "BTC/USDT", "2024-01-01", "2024-01-15"),
      run("dpc-regime", "BTC/USDT", "2024-01-01", "2024-01-15"),
    ]);
    expect(plain.result.totalTrades).toBeGreaterThan(0);
    expect(regime.result.totalTrades).toBe(plain.result.totalTrades);
    expect(regime.overlayMetrics.regimeModifiedEntries).toBeGreaterThan(0);
    expect(regime.overlayMetrics.regimeDirectionSignalsReceived).toBe(
      regime.overlayMetrics.dpcDirectionSignalsEmitted,
    );
    expect(regime.overlayMetrics.regimeSizingSignalsReceived).toBe(
      regime.overlayMetrics.dpcSizingSignalsEmitted,
    );
    expect(
      regime.sizingSignals.some((signal, index) => signal.notional !== plain.sizingSignals[index]?.notional),
    ).toBe(true);
    expect(regime.result.totalReturn).not.toBe(plain.result.totalReturn);
    expect(regime.inputProvenance.ohlcv).toMatchObject({ synthetic: false, coverageRatio: 1 });
  });

  it("SOLFlip+Regime ON changes the real SOL trade stream and remains causal", async () => {
    const [plain, overlaid] = await Promise.all([
      run("dpc", "SOL/USDT", "2024-02-25", "2024-03-20"),
      run("dpc-solflip-regime", "SOL/USDT", "2024-02-25", "2024-03-20"),
    ]);
    expect(overlaid.status).toBe("valid");
    expect(overlaid.result.totalTrades).not.toBe(plain.result.totalTrades);
    expect(overlaid.overlayMetrics.solFlipEntryBlocks).toBeGreaterThan(0);
    expect(overlaid.overlayMetrics.solFlipForcedCloses).toBeGreaterThan(0);
    expect(overlaid.overlayMetrics.regimeModifiedEntries).toBeGreaterThan(0);
    expect(overlaid.causality.lookaheadViolations).toBe(0);
    expect(overlaid.causality.audit.length).toBeGreaterThan(0);
    expect(
      overlaid.causality.audit.every(
        (event) =>
          event.lastFundingTimeConsumed !== null && event.lastFundingTimeConsumed <= event.decisionTime,
      ),
    ).toBe(true);
    expect(overlaid.inputProvenance.funding).toMatchObject({ synthetic: false, coverageRatio: 1 });
  });

  it("the direct CLI fails loudly for an invalid BTC+SOLFlip mask", async () => {
    const child = Bun.spawn(
      [
        "bun",
        "run",
        "packages/backtest-tools/src/cli/run-dpc-overlay-combination.ts",
        "--mask=dpc-solflip",
        "--symbol=BTC/USDT",
        "--start=2024-01-01",
        "--end=2024-01-02",
      ],
      { cwd: ROOT, stdout: "pipe", stderr: "pipe" },
    );
    const [stderr, exitCode] = await Promise.all([new Response(child.stderr).text(), child.exited]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("INVALID_MASK");
  });

  it("publishes the adapter help contract and writes a quick smoke JSON without a backtest", async () => {
    const helpChild = Bun.spawn(
      ["bun", "run", "packages/backtest-tools/src/cli/run-dpc-overlay-combination.ts", "--help"],
      { cwd: ROOT, stdout: "pipe", stderr: "pipe" },
    );
    const [help, helpExit] = await Promise.all([new Response(helpChild.stdout).text(), helpChild.exited]);
    expect(helpExit).toBe(0);
    for (const token of ["--smoke", "--mask", "--symbol", "--output", "--start", "--end"]) {
      expect(help).toContain(token);
    }

    const temp = mkdtempSync(resolve(tmpdir(), "dpc-overlay-smoke-"));
    const output = resolve(temp, "smoke.json");
    try {
      const smokeChild = Bun.spawn(
        [
          "bun",
          "run",
          "packages/backtest-tools/src/cli/run-dpc-overlay-combination.ts",
          "--smoke",
          "--mask=dpc-solflip-regime",
          "--symbol=SOL/USDT",
          `--output=${output}`,
        ],
        { cwd: ROOT, stdout: "pipe", stderr: "pipe" },
      );
      const [stdout, smokeExit] = await Promise.all([
        new Response(smokeChild.stdout).text(),
        smokeChild.exited,
      ]);
      expect(smokeExit).toBe(0);
      expect(stdout).toContain("SMOKE_OK");
      const document = JSON.parse(readFileSync(output, "utf8")) as {
        status: string;
        executionSkipped: boolean;
        inputChecks: { ohlcv: { synthetic: boolean }; funding: { synthetic: boolean } };
      };
      expect(document).toMatchObject({ status: "SMOKE_OK", executionSkipped: true });
      expect(document.inputChecks.ohlcv.synthetic).toBe(false);
      expect(document.inputChecks.funding.synthetic).toBe(false);
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });
});
