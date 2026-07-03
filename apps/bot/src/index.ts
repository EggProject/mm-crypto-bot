#!/usr/bin/env bun
/**
 * apps/bot/src/index.ts
 *
 * A mm-crypto-bot CLI entry pointja.
 *
 * A PR #5 (exchange-paper) szallitas fokozataban a bot csak az exchange
 * feed-et inditja el a megadott mod-ban. A paper-trader, a strategia-motor
 * es a backtest bekotes a kovetkezo PR-okben valik meg (lasd
 * docs/research/selected-strategy.md).
 *
 * Modusok:
 *   (default)   Paper feed inditasa a CCXT Pro bybit.eu WS-re epulve.
 *   --mock      A belsos mock feed (teszteleshez / smoke teszthez).
 *   --live      Figyelmezteto uzenet — a live driver meg nincs implementalva.
 *
 * Pelda:
 *   bun run dev --workspace=apps/bot -- --mock
 *   bun run dev --workspace=apps/bot --        # paper feed CCXT Pro-val
 */

import { detectExchangeEnv } from "@mm-crypto-bot/exchange";
import { createExchangeClient } from "@mm-crypto-bot/exchange";

interface CliArgs {
  mode?: "paper" | "live" | "mock";
}

function parseArgs(argv: readonly string[]): CliArgs {
  const args: CliArgs = {};
  for (const arg of argv) {
    if (arg === "--mock") args.mode = "mock";
    else if (arg === "--live") args.mode = "live";
    else if (arg === "--paper") args.mode = "paper";
  }
  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const env = detectExchangeEnv();
  const mode = args.mode ?? (env === "live" ? "live" : "paper");

  console.log("[bot] starting", { mode, env });

  if (mode === "live") {
    console.warn("[bot] LIVE MODE - valos penzmozgas! Megerosites kell a deploy elott.");
    console.warn("[bot] A live driver meg nincs implementalva — hasznald a --paper vagy --mock -ot.");
    return;
  }

  const useMock = mode === "mock";
  const feed = createExchangeClient({ useMock });
  await feed.open();

  try {
    console.log(`[bot] ${mode} feed elinditva — Ctrl+C a leallitashoz`);
    // A kovetkezo PR-okban: PaperTrader inditasa, strategia-motor bekotese.
    // Ideiglenesen egy vegten pending Promise-on varunk, hogy a process
    // eletben maradjon a feed leallasaig.
    await new Promise<void>(() => {
      /* idle - SIGINT-re process exit */
    });
  } finally {
    await feed.close();
  }
}

await main();
