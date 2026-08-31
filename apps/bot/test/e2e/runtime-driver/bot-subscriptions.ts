import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { asSymbol } from "@mm-crypto-bot/exchange";
import { Bot } from "../../../src/bot/bot.js";
import type { BotConfig } from "../../../src/config/schema.js";

import {
  MockExchangeFeed,
  quietLogger,
  assertCondition,
  waitForCondition,
  RecordingLogger,
  FailingOhlcvFeed,
  placeOrderLedger,
} from "./runtime-driver-core.js";
import { botConfigFor, startBotThenStop } from "./runtime-driver-portfolio-fixtures.js";

async function runBotSubscriptions(): Promise<void> {
  const directory = mkdtempSync(path.join(tmpdir(), "mm-bot-subscriptions-driver-"));
  try {
    const feed = new MockExchangeFeed();
    const config: BotConfig = {
      ...botConfigFor(path.join(directory, "subscriptions.json")),
      symbols: { enabled: ["BTC/USDC", "ETH/USDC"] },
      strategies: {
        ...botConfigFor(path.join(directory, "subscriptions.json")).strategies,
        donchian_pivot_composition: {
          enabled: true,
          symbols: ["BTC/USDC", "XRP/USDC"],
          risk_per_trade: 0.01,
          max_positions: 1,
          timeframes: { htf: "2h", mtf: "4h", ltf: "15m" },
        },
      },
    };
    const bot = new Bot({ config, feed, logger: quietLogger });
    const running = bot.start();
    await waitForCondition(() => feed.subscriptionCount() === 5, "strategy timeframe subscriptions");
    const symbol = asSymbol("BTC/USDC");
    feed.pushEvent({
      kind: "ticker",
      payload: { symbol, timestamp: 1, bid: 99, ask: 101, last: 100, baseVolume: 0, quoteVolume: 0 },
    });
    feed.pushEvent({
      kind: "ohlcv",
      payload: { symbol, timeframe: "15m", candle: [1, 100, 101, 99, 100, 1] },
    });
    await Bun.sleep(20);
    assertCondition(placeOrderLedger.length === 0, "subscription callback reached order placement");
    await bot.stop();
    await running;

    const failureFeed = new FailingOhlcvFeed();
    const failureLogger = new RecordingLogger();
    const failureConfig: BotConfig = {
      ...botConfigFor(path.join(directory, "subscription-faults.json")),
      strategies: {
        ...botConfigFor(path.join(directory, "subscription-faults.json")).strategies,
        donchian_pivot_composition: { enabled: true },
      },
    };
    await startBotThenStop(
      new Bot({ config: failureConfig, feed: failureFeed, logger: failureLogger }),
      failureFeed,
    );
    const errors = new Set(
      failureLogger.entries
        .filter((entry) => entry.message === "bot.ohlcv.subscribe.failed")
        .map((entry) => entry.meta?.["error"]),
    );
    assertCondition(errors.has("4h subscription failed"), "Error OHLCV failure was not logged");
    assertCondition(errors.has("15m subscription failed"), "string OHLCV failure was not logged");

    const pluginFeed = new MockExchangeFeed();
    const pluginConfig: BotConfig = {
      ...botConfigFor(path.join(directory, "plugin-instance.json")),
      strategies: {
        ...botConfigFor(path.join(directory, "plugin-instance.json")).strategies,
        regime_detector: { enabled: true },
      },
    };
    await startBotThenStop(
      new Bot({ config: pluginConfig, feed: pluginFeed, logger: quietLogger }),
      pluginFeed,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

export { runBotSubscriptions };
