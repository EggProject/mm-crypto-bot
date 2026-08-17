import { describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { parseArgs, parseFundingCsv, replayFunding } from "./run-sol-flip-funding-replay.js";

const ROOT = resolve(import.meta.dir, "..", "..", "..", "..");
const REAL_FUNDING = resolve(ROOT, "data", "funding", "binance_solusdt_funding_8h.csv");

describe("run-sol-flip-funding-replay — real Binance funding CSV", () => {
  it("valós funding sorokon regime/risk metrikát ad, PnL-t és DD-t nem fabrikál", () => {
    const args = parseArgs([`--input=${REAL_FUNDING}`, "--start=2024-01-01", "--end=2024-06-01"]);
    const rows = parseFundingCsv(readFileSync(REAL_FUNDING, "utf8")).filter(
      (row) => row.fundingTime >= args.startTime.getTime() && row.fundingTime < args.endTime.getTime(),
    );
    const replay = replayFunding(rows, args.pluginConfig);

    expect(rows.length).toBe(456);
    expect(replay.metrics["regimeActivationCount"]).toBeGreaterThan(0);
    expect(replay.metrics["riskSignalCount"]).toBe(replay.riskEvents.length);
    expect(replay.metrics["pnlUsd"]).toBeNull();
    expect(replay.metrics["totalReturn"]).toBeNull();
    expect(replay.metrics["maxDrawdown"]).toBeNull();
    expect(replay.riskEvents.some((event) => event.breach)).toBe(true);
  });

  it("a direct CLI auditálható valós-adat outputot ír", async () => {
    const tempDir = mkdtempSync(resolve(tmpdir(), "sol-flip-real-cli-"));
    const output = resolve(tempDir, "result.json");
    try {
      const child = Bun.spawn(
        [
          "bun",
          "run",
          "packages/backtest-tools/src/cli/run-sol-flip-funding-replay.ts",
          `--input=${REAL_FUNDING}`,
          "--start=2024-01-01",
          "--end=2024-06-01",
          `--output=${output}`,
        ],
        { cwd: ROOT, stdout: "pipe", stderr: "pipe" },
      );
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);
      expect(exitCode).toBe(0);
      expect(stderr).toBe("");
      expect(stdout).toContain("PnL/DD: N/A");
      expect(existsSync(output)).toBe(true);
      const parsed = JSON.parse(readFileSync(output, "utf8")) as {
        pluginRole: string;
        pnlApplicability: { applicable: boolean };
        data: { sourceKind: string; synthetic: boolean; sampleCount: number; coverageRatio: number };
        metrics: { pnlUsd: null; totalReturn: null; maxDrawdown: null; regimeActivationCount: number };
      };
      expect(parsed.pluginRole).toBe("defensive_risk_overlay");
      expect(parsed.pnlApplicability.applicable).toBe(false);
      expect(parsed.data).toMatchObject({
        sourceKind: "downloaded_binance_funding_csv",
        synthetic: false,
        sampleCount: 456,
        coverageRatio: 1,
      });
      expect(parsed.metrics.pnlUsd).toBeNull();
      expect(parsed.metrics.totalReturn).toBeNull();
      expect(parsed.metrics.maxDrawdown).toBeNull();
      expect(parsed.metrics.regimeActivationCount).toBeGreaterThan(0);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("ismeretlen flag-et elutasít", () => {
    expect(() => parseArgs(["--synthetic=true"])).toThrow(/Unknown argument/);
  });
});
