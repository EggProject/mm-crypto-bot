#!/usr/bin/env bun
import { parseWorkflowArgs, runCompositionBacktest, workflowHelp, writeWorkflowOutput } from "./workflow-common.js";

export async function main(argv = process.argv.slice(2)): Promise<void> {
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(workflowHelp("baseline"));
    return;
  }
  const args = parseWorkflowArgs(argv, "backtest-results/baseline.json");
  const result = await runCompositionBacktest(args);
  await writeWorkflowOutput(args.output, { workflow: "baseline", args, result });
  console.log(`[baseline] saved ${args.output}`);
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error("[baseline] FATAL:", error);
    process.exitCode = 1;
  });
}
