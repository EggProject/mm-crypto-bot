#!/usr/bin/env bun
/**
 * apps/bot/src/index.ts
 *
 * A mm-crypto-bot CLI entry pointja.
 *
 * Modusok:
 *   --mode=paper   Paper-trading a CCXT Pro WS feedre epulve (alapertelmezett)
 *   --mode=live    Live trading a bybit.eu-n (FIGYELEM: valos penz!)
 *   --mode=backtest  Historikus OHLCV adatokon
 *
 * Pelda inditasok:
 *   bun run dev --workspace=apps/bot -- --mode=paper --exchange=bybiteu
 *   bun run dev --workspace=apps/bot -- --mode=backtest --symbols=BTC/USDC,ETH/USDC
 */

import { loadAppConfig, type AppConfig } from "@mm-crypto-bot/shared";
import { createExchangeAdapter } from "@mm-crypto-bot/exchange";
import { PaperTrader } from "@mm-crypto-bot/paper";

interface CliArgs {
  mode?: "paper" | "live" | "backtest";
  exchange?: "bybiteu" | "binance" | "okx";
  symbols?: readonly string[];
}

function parseArgs(argv: readonly string[]): CliArgs {
  const args: CliArgs = {};
  for (const arg of argv) {
    if (arg.startsWith("--mode=")) {
      const value = arg.slice("--mode=".length);
      if (value === "paper" || value === "live" || value === "backtest") {
        args.mode = value;
      }
    } else if (arg.startsWith("--exchange=")) {
      const value = arg.slice("--exchange=".length);
      if (value === "bybiteu" || value === "binance" || value === "okx") {
        args.exchange = value;
      }
    } else if (arg.startsWith("--symbols=")) {
      args.symbols = arg.slice("--symbols=".length).split(",");
    }
  }
  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const config: AppConfig = loadAppConfig();

  const exchangeId = args.exchange ?? config.exchange;
  const mode = args.mode ?? config.mode;
  const symbols = args.symbols ?? config.symbols;

  console.log("[bot] starting", { mode, exchange: exchangeId, symbols });

  const adapter = createExchangeAdapter({
    exchange: exchangeId,
    ...(process.env["BYBIT_EU_API_KEY"] !== undefined
      ? { apiKey: process.env["BYBIT_EU_API_KEY"] }
      : {}),
    ...(process.env["BYBIT_EU_SECRET"] !== undefined
      ? { secret: process.env["BYBIT_EU_SECRET"] }
      : {}),
  });

  await adapter.loadMarkets();

  if (mode === "paper") {
    const trader = new PaperTrader(adapter, {
      initialBalanceQuote: 10000,
      fee: config.fee,
    });
    await trader.start({ symbols: [...symbols] });
    return;
  }

  if (mode === "backtest") {
    console.log("[bot] backtest mode - jelenleg skeleton, csak a CLI ellenorzese fut le");
    return;
  }

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- defensive check for clarity in CLI flow
  if (mode === "live") {
    console.warn("[bot] ⚠️  LIVE MODE - valos penzmozgas! Megerosites kell a deploy elott.");
    // TODO: live driver
    return;
  }
}

await main();