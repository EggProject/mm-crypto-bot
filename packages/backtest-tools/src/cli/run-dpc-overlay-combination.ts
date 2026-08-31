#!/usr/bin/env bun

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { helpText, parseArgs as parseArguments, runSmoke } from "./dpc-overlay-command.js";
import { runCombination } from "./dpc-overlay-strategy.js";

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(helpText());
    return;
  }
  const arguments_ = parseArguments(argv);
  if (arguments_.smoke) {
    const output = await runSmoke(arguments_);
    const outputPath = path.resolve(process.cwd(), arguments_.outputPath);
    await mkdir(path.resolve(outputPath, ".."), { recursive: true });
    await writeFile(outputPath, JSON.stringify(output, null, 2), "utf8");
    console.log(
      `[dpc-overlay] SMOKE_OK mask=${arguments_.mask} symbol=${arguments_.symbol} output=${outputPath}`,
    );
    return;
  }
  const output = await runCombination(arguments_);
  const outputPath = path.resolve(process.cwd(), arguments_.outputPath);
  await mkdir(path.resolve(outputPath, ".."), { recursive: true });
  await writeFile(outputPath, JSON.stringify(output, null, 2), "utf8");
  console.log(`[dpc-overlay] mask=${arguments_.mask} symbol=${arguments_.symbol}`);
  console.log(`[dpc-overlay] Saved: ${outputPath}`);
}

function handleFatal(error: unknown): void {
  console.error("[dpc-overlay] FATAL:", error);
  process.exitCode = 1;
}

void main().catch(handleFatal);
