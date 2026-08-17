#!/usr/bin/env bun
import {
  parseWorkflowArgs,
  runCompositionWalkForward,
  workflowHelp,
  writeWorkflowOutput,
} from "./workflow-common.js";

export function parseWindowArg(argv: readonly string[]): {
  readonly inSampleDays: number;
  readonly outOfSampleDays: number;
  readonly stepDays: number;
  readonly rest: readonly string[];
} {
  let inSampleDays = 365;
  let outOfSampleDays = 90;
  let stepDays = 90;
  const rest: string[] = [];
  for (const arg of argv) {
    if (arg.startsWith("--in-sample-days=")) inSampleDays = Number(arg.slice("--in-sample-days=".length));
    else if (arg.startsWith("--out-of-sample-days="))
      outOfSampleDays = Number(arg.slice("--out-of-sample-days=".length));
    else if (arg.startsWith("--step-days=")) stepDays = Number(arg.slice("--step-days=".length));
    else rest.push(arg);
  }
  if (![inSampleDays, outOfSampleDays, stepDays].every((value) => Number.isFinite(value) && value > 0)) {
    throw new Error("walk-forward day values must be positive numbers");
  }
  return { inSampleDays, outOfSampleDays, stepDays, rest };
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(
      workflowHelp("oos", [
        "  --in-sample-days=365       In-sample window length",
        "  --out-of-sample-days=90   OOS window length",
        "  --step-days=90             Window step (non-overlapping OOS default)",
      ]),
    );
    return;
  }
  const { inSampleDays, outOfSampleDays, stepDays, rest } = parseWindowArg(argv);
  const args = parseWorkflowArgs(rest, "backtest-results/oos.json");
  const result = await runCompositionWalkForward(args, inSampleDays, outOfSampleDays, stepDays);
  await writeWorkflowOutput(args.output, {
    workflow: "oos",
    args,
    inSampleDays,
    outOfSampleDays,
    stepDays,
    result,
  });
  console.log(`[oos] saved ${args.output}`);
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error("[oos] FATAL:", error);
    process.exitCode = 1;
  });
}
