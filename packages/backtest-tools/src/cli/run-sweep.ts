#!/usr/bin/env bun
import {
  parseWorkflowArgs,
  runCompositionBacktest,
  workflowHelp,
  writeWorkflowOutput,
} from "./workflow-common.js";

function parseCaps(argv: readonly string[]): {
  readonly caps: readonly number[];
  readonly rest: readonly string[];
} {
  let caps: readonly number[] = [0.04, 0.08, 0.12, 0.2];
  const rest: string[] = [];
  for (const arg of argv) {
    if (!arg.startsWith("--caps=")) {
      rest.push(arg);
      continue;
    }
    caps = arg.slice("--caps=".length).split(",").map(Number);
    if (caps.length === 0 || caps.some((cap) => !Number.isFinite(cap) || cap <= 0 || cap > 1)) {
      throw new Error("--caps must be a comma-separated list in (0, 1]");
    }
  }
  return { caps, rest };
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(workflowHelp("sweep", ["  --caps=0.04,0.08,0.12  Max-notional fractions to evaluate"]));
    return;
  }
  const { caps, rest } = parseCaps(argv);
  const args = parseWorkflowArgs(rest, "backtest-results/sweep.json");
  const results = [];
  for (const cap of caps) {
    results.push({ maxPositionPctEquity: cap, result: await runCompositionBacktest(args, cap) });
  }
  await writeWorkflowOutput(args.output, { workflow: "sweep", args, results });
  console.log(`[sweep] saved ${args.output}`);
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error("[sweep] FATAL:", error);
    process.exitCode = 1;
  });
}
