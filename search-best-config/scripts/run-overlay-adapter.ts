#!/usr/bin/env bun

import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { isObject, REPO_ROOT } from "./common.js";

const TARGET = "packages/backtest-tools/src/cli/run-dpc-overlay-combination.ts";

const HELP = `DPC overlay search adapter

Usage:
  bun search-best-config/scripts/run-overlay-adapter.ts --help
  bun search-best-config/scripts/run-overlay-adapter.ts --smoke --output=PATH
  bun search-best-config/scripts/run-overlay-adapter.ts --mask=MASK --symbol=SYMBOL --start=DATE --end=DATE --output=PATH [...]

Required execution flags: --mask --symbol --start --end --output
Supported masks: dpc, dpc-solflip, dpc-regime, dpc-solflip-regime
The --smoke mode executes the real target CLI on one day of downloaded BTC OHLCV and validates its JSON envelope.
`;

async function runTarget(
  args: readonly string[],
): Promise<{ readonly exitCode: number; readonly stdout: string; readonly stderr: string }> {
  await access(resolve(REPO_ROOT, TARGET));
  const child = Bun.spawn(["bun", "run", TARGET, ...args], {
    cwd: REPO_ROOT,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { exitCode, stdout, stderr };
}

function outputArg(argv: readonly string[]): string {
  const raw = argv.find((arg) => arg.startsWith("--output="))?.slice("--output=".length);
  if (raw === undefined || raw.length === 0) throw new Error("--smoke requires --output=PATH");
  return resolve(REPO_ROOT, raw);
}

async function smoke(argv: readonly string[]): Promise<void> {
  const output = outputArg(argv);
  const result = await runTarget([
    "--mask=dpc",
    "--symbol=BTC/USDT",
    "--start=2024-01-01",
    "--end=2024-01-02",
    `--output=${output}`,
  ]);
  if (result.exitCode !== 0) throw new Error(`Target smoke failed (${result.exitCode}): ${result.stderr}`);
  const parsed = JSON.parse(await readFile(output, "utf8")) as unknown;
  if (
    !isObject(parsed) ||
    !isObject(parsed["result"]) ||
    !isObject(parsed["derivedMetrics"]) ||
    !isObject(parsed["overlayMetrics"])
  ) {
    throw new Error("Target smoke output misses result/derivedMetrics/overlayMetrics");
  }
  console.log(
    "PASS: overlay adapter target exists, executes on real minimal OHLCV, and writes the complete JSON envelope",
  );
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  if (argv.length === 1 && argv[0] === "--help") {
    console.log(HELP);
    return;
  }
  if (argv.includes("--smoke")) {
    await smoke(argv);
    return;
  }
  const result = await runTarget(argv);
  if (result.stdout.length > 0) process.stdout.write(result.stdout);
  if (result.stderr.length > 0) process.stderr.write(result.stderr);
  if (result.exitCode !== 0) process.exitCode = result.exitCode;
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
