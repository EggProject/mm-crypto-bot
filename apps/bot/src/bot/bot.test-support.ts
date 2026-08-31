import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { MockExchangeFeed } from "@exchange-testing/mockFeed.js";
import { RecordingLogger } from "@logging-testing";

import { DEFAULT_BOT_CONFIG } from "../config/defaults.js";
import type { BotConfig } from "../config/schema.js";

import { Bot as RuntimeBot, type BotOptions } from "./bot.js";

export const fileSystem = await import("node:fs");

export class Bot extends RuntimeBot {
  public constructor(options: BotOptions) {
    super({ ...options, logger: options.logger ?? new RecordingLogger() });
  }
}

export interface BotTestFixture {
  readonly temporaryDirectory: string;
  readonly stateFile: string;
  readonly feed: MockExchangeFeed;
}

export function buildTestConfig(stateFile: string): BotConfig {
  return {
    ...DEFAULT_BOT_CONFIG,
    bot: { ...DEFAULT_BOT_CONFIG.bot, state_file: stateFile },
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
      log_dir: `${stateFile}.logs`,
      metrics_interval_sec: 60,
    },
  };
}

export function createBotTestFixture(): BotTestFixture {
  const temporaryDirectory = mkdtempSync(path.join(tmpdir(), "mm-bot-test-"));
  return {
    temporaryDirectory,
    stateFile: path.join(temporaryDirectory, "bot-state.json"),
    feed: new MockExchangeFeed({
      balances: [{ currency: "USDC", free: 10_000, total: 10_000 }],
    }),
  };
}

export function disposeBotTestFixture(fixture: BotTestFixture): void {
  if (fileSystem.existsSync(fixture.temporaryDirectory)) {
    rmSync(fixture.temporaryDirectory, { recursive: true, force: true });
  }
}
