import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { asSymbol, type Ohlcv, type Ticker } from "@mm-crypto-bot/exchange";

import { Bot } from "../../../src/bot/bot.js";
import { DEFAULT_BOT_CONFIG } from "../../../src/config/defaults.js";
import type { BotConfig } from "../../../src/config/schema.js";

import { assertCondition, MockExchangeFeed, quietLogger } from "./runtime-driver-core.js";

const join = (...pathSegments: string[]): string => path.join(...pathSegments);

export async function runLifecycleSmoke(): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), "mm-bot-coverage-driver-"));
  const stateFile = join(directory, "state.json");
  const config: BotConfig = {
    ...DEFAULT_BOT_CONFIG,
    bot: { ...DEFAULT_BOT_CONFIG.bot, state_file: stateFile, log_level: "error" },
    exchange: { ...DEFAULT_BOT_CONFIG.exchange, id: "mock" },
    symbols: { enabled: ["BTC/USDC"] },
    strategies: {
      donchian_pivot_composition: { enabled: false },
      dydx_cex_carry: { enabled: false },
      cascade_fade: { enabled: false },
      funding_flip_kill_switch: { enabled: false },
      regime_detector: { enabled: false },
    },
    telemetry: {
      ...DEFAULT_BOT_CONFIG.telemetry,
      log_dir: join(directory, "telemetry"),
      metrics_interval_sec: 60,
    },
  };
  const feed = new MockExchangeFeed({ balances: [{ currency: "USDC", free: 10_000, total: 10_000 }] });
  const bot = new Bot({
    config,
    feed,
    logger: quietLogger,
    stateSaveIntervalMs: 25,
    killSwitchEvalIntervalMs: 25,
    heartbeatIntervalMs: 25,
    telemetryMetricsIntervalSec: 1,
  });

  try {
    const running = bot.start();
    await Bun.sleep(100);
    const symbol = asSymbol("BTC/USDC");
    const ticker: Ticker = {
      symbol,
      timestamp: Date.now(),
      bid: 59_999,
      ask: 60_001,
      last: 60_000,
      baseVolume: 100,
      quoteVolume: 6_000_000,
    };
    feed.pushEvent({ kind: "ticker", payload: ticker });
    const candle: Ohlcv = [Date.now() - 60_000, 59_990, 60_010, 59_980, 60_000, 100];
    feed.pushEvent({ kind: "ohlcv", payload: { symbol, timeframe: "15m", candle } });
    await Bun.sleep(100);
    assertCondition(bot.getState().version === 1, "runtime driver observed an invalid state version");
    await bot.stop();
    await running;
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- The path is derived from this case's fresh mkdtemp directory.
    assertCondition(existsSync(stateFile), "runtime driver did not persist state");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
