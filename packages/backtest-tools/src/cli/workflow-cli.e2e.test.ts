import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..", "..", "..", "..");

async function runRootWorkflow(
  command: "backtest" | "sweep" | "oos",
  args: readonly string[],
): Promise<{ code: number; output: string }> {
  const process = Bun.spawn(["bun", "run", command, "--", ...args], {
    cwd: ROOT,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ]);
  return { code, output: `${stdout}${stderr}` };
}

describe("documented root backtest workflows", () => {
  let fixtureDir = "";
  let dataDir = "";

  beforeAll(async () => {
    fixtureDir = await mkdtemp(resolve(tmpdir(), "backtest-workflows-"));
    dataDir = resolve(fixtureDir, "ohlcv");
    await mkdir(dataDir, { recursive: true });
    const start = Date.UTC(2024, 0, 1);
    const quarterHour = 15 * 60 * 1000;
    const rows = ["timestamp,open,high,low,close,volume"];
    for (let index = 0; index < 2 * 24 * 4; index++) {
      const close = 100 + (index % 8) * 0.01;
      rows.push(`${start + index * quarterHour},${close},${close + 1},${close - 1},${close},10`);
    }
    await writeFile(resolve(dataDir, "binance_btc_15m.csv"), `${rows.join("\n")}\n`, "utf8");
  });

  afterAll(async () => {
    await rm(fixtureDir, { recursive: true, force: true });
  });

  for (const command of ["backtest", "sweep", "oos"] as const) {
    it(`${command} resolves its entry point and has a safe help path`, async () => {
      const result = await runRootWorkflow(command, ["--help"]);
      expect(result.code).toBe(0);
      expect(result.output).toContain(`${command === "backtest" ? "baseline" : command} — historical Donchian/Pivot`);
      expect(result.output).toContain("Completed candle must open >= start");
      expect(result.output).toContain("Completed candle must close <= end");
      expect(result.output).not.toContain("Module not found");
    });
  }

  it("backtest executes against the isolated CSV fixture and writes a baseline envelope", async () => {
    const output = resolve(fixtureDir, "baseline.json");
    const result = await runRootWorkflow("backtest", [
      `--data-dir=${dataDir}`,
      "--start=2024-01-01T00:00:00.000Z",
      "--end=2024-01-03T00:00:00.000Z",
      `--output=${output}`,
    ]);
    expect(result.code).toBe(0);
    const envelope = JSON.parse(await readFile(output, "utf8")) as {
      readonly workflow: string;
      readonly args: { readonly symbol: string };
      readonly result: { readonly totalTrades: number; readonly equityCurve: readonly unknown[]; readonly trades: readonly unknown[] };
    };
    expect(envelope.workflow).toBe("baseline");
    expect(envelope.args.symbol).toBe("BTC/USDT");
    expect(Number.isInteger(envelope.result.totalTrades)).toBe(true);
    expect(envelope.result.equityCurve.length).toBeGreaterThan(1);
    expect(Array.isArray(envelope.result.trades)).toBe(true);
  });

  it("sweep executes two bounded parameter points and writes both results", async () => {
    const output = resolve(fixtureDir, "sweep.json");
    const result = await runRootWorkflow("sweep", [
      `--data-dir=${dataDir}`,
      "--start=2024-01-01T00:00:00.000Z",
      "--end=2024-01-03T00:00:00.000Z",
      "--caps=0.04,0.08",
      `--output=${output}`,
    ]);
    expect(result.code).toBe(0);
    const envelope = JSON.parse(await readFile(output, "utf8")) as {
      readonly workflow: string;
      readonly results: readonly {
        readonly maxPositionPctEquity: number;
        readonly result: { readonly totalTrades: number; readonly equityCurve: readonly unknown[] };
      }[];
    };
    expect(envelope.workflow).toBe("sweep");
    expect(envelope.results.map((item) => item.maxPositionPctEquity)).toEqual([0.04, 0.08]);
    expect(envelope.results.every((item) => Number.isInteger(item.result.totalTrades))).toBe(true);
    expect(envelope.results.every((item) => item.result.equityCurve.length > 1)).toBe(true);
  });

  it("oos executes one deterministic IS/OOS window and writes its essential schema", async () => {
    const output = resolve(fixtureDir, "oos.json");
    const result = await runRootWorkflow("oos", [
      `--data-dir=${dataDir}`,
      "--start=2024-01-01T00:00:00.000Z",
      "--end=2024-01-03T00:00:00.000Z",
      "--in-sample-days=1",
      "--out-of-sample-days=1",
      "--step-days=1",
      `--output=${output}`,
    ]);
    expect(result.code).toBe(0);
    const envelope = JSON.parse(await readFile(output, "utf8")) as {
      readonly workflow: string;
      readonly inSampleDays: number;
      readonly outOfSampleDays: number;
      readonly stepDays: number;
      readonly result: {
        readonly windowCount: number;
        readonly isResults: readonly { readonly equityCurve: readonly unknown[] }[];
        readonly oosResults: readonly { readonly equityCurve: readonly unknown[] }[];
      };
    };
    expect(envelope.workflow).toBe("oos");
    expect([envelope.inSampleDays, envelope.outOfSampleDays, envelope.stepDays]).toEqual([1, 1, 1]);
    expect(envelope.result.windowCount).toBe(1);
    expect(envelope.result.isResults).toHaveLength(1);
    expect(envelope.result.oosResults).toHaveLength(1);
    expect(envelope.result.isResults[0]!.equityCurve.length).toBeGreaterThan(1);
    expect(envelope.result.oosResults[0]!.equityCurve.length).toBeGreaterThan(1);
  });
});
