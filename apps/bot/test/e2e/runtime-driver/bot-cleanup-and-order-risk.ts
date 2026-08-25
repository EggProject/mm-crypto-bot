import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { asSymbol } from "@mm-crypto-bot/exchange";

import { Bot } from "../../../src/bot/bot.js";
import type { KillSwitch } from "../../../src/bot/kill-switches.js";
import type { BotState } from "../../../src/bot/state-store.js";
import type { BotConfig } from "../../../src/config/schema.js";

import {
  AllUnsubscribeFailureFeed,
  assertCondition,
  botConfigFor,
  CleanupFailureFeed,
  MockExchangeFeed,
  quietLogger,
  RecordingLogger,
  SequencedBalanceFeed,
  startBotThenStop,
  waitForCondition,
} from "./runtime-driver-core.js";
import {
  AutoFlattenFeed,
  makePortfolioMarketMeta,
  makeRemotePosition,
} from "./runtime-driver-portfolio-fixtures.js";

const join = (...pathSegments: string[]): string => path.join(...pathSegments);

function alwaysEngagedSwitch(id: string): KillSwitch {
  return {
    id,
    description: "scripted always-engaged kill switch",
    evaluate: () => ({ switchId: id, engaged: true, reason: id }),
  };
}

function makeSavedPosition(strategy: string, symbol: string): BotState["positions"][number] {
  return {
    id: `${strategy}:${symbol}:long`,
    strategy,
    symbol,
    side: "long",
    quantity: 0.01,
    entryPrice: 100,
    currentPrice: 100,
    leverage: 10,
    unrealizedPnl: 0,
    realizedPnl: 0,
    openedAt: 1,
    notionalUsd: 1,
  };
}

export async function runBotCleanupFaults(): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), "mm-bot-cleanup-driver-"));
  const originalKey = process.env["BYBIT_API_KEY"];
  const originalSecret = process.env["BYBIT_API_SECRET"];
  process.env["BYBIT_API_KEY"] = "scripted-key";
  process.env["BYBIT_API_SECRET"] = "scripted-secret";
  try {
    const cleanupFailures: readonly {
      readonly lifecycle: Error | string;
      readonly close: Error | string;
      readonly expectedLifecycle: string;
      readonly expectedClose: string;
    }[] = [
      {
        lifecycle: new Error("lifecycle Error"),
        close: new Error("close Error"),
        expectedLifecycle: "lifecycle Error",
        expectedClose: "close Error",
      },
      {
        lifecycle: "lifecycle string",
        close: "close string",
        expectedLifecycle: "lifecycle string",
        expectedClose: "close string",
      },
    ];
    for (const failure of cleanupFailures) {
      const logger = new RecordingLogger();
      const feed = new CleanupFailureFeed(failure.lifecycle, failure.close);
      const baseConfig = botConfigFor(join(directory, `cleanup-${typeof failure.lifecycle}.json`));
      const config: BotConfig = { ...baseConfig, bot: { ...baseConfig.bot, mode: "live" } };
      await startBotThenStop(new Bot({ config, feed, logger }), feed);
      assertCondition(
        logger.entries.some(
          (entry) =>
            entry.message === "[bot] private lifecycle cleanup failed" &&
            entry.meta?.["error"] === failure.expectedLifecycle,
        ),
        "private lifecycle cleanup failure missing",
      );
      assertCondition(
        logger.entries.some(
          (entry) =>
            entry.message === "[bot] feed close failed" && entry.meta?.["error"] === failure.expectedClose,
        ),
        "feed close failure missing",
      );
    }

    const unsubscribeFeed = new AllUnsubscribeFailureFeed();
    const unsubscribeConfig = botConfigFor(join(directory, "unsubscribe.json"));
    await startBotThenStop(
      new Bot({
        config: unsubscribeConfig,
        feed: unsubscribeFeed,
        logger: quietLogger,
      }),
      unsubscribeFeed,
    );

    const blocker = join(directory, "state-parent-file");
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- The path is derived from this case's fresh mkdtemp directory.
    writeFileSync(blocker, "not a directory", "utf8");
    const invalidStateFile = join(blocker, "state.json");
    const flushLogger = new RecordingLogger();
    const flushFeed = new MockExchangeFeed();
    const flushBot = new Bot({
      config: botConfigFor(invalidStateFile),
      feed: flushFeed,
      logger: flushLogger,
    });
    const flushRunning = flushBot.start();
    await waitForCondition(() => flushFeed.subscriptionCount() > 0, "flush-fault subscription");
    await flushBot.stop();
    await flushRunning;
    assertCondition(
      flushLogger.entries.some((entry) => entry.message === "[bot] state flush failed"),
      "state flush failure was not logged",
    );
  } finally {
    if (originalKey === undefined) delete process.env["BYBIT_API_KEY"];
    else process.env["BYBIT_API_KEY"] = originalKey;
    if (originalSecret === undefined) delete process.env["BYBIT_API_SECRET"];
    else process.env["BYBIT_API_SECRET"] = originalSecret;
    rmSync(directory, { recursive: true, force: true });
  }
}

export async function runBotOrderRisk(): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), "mm-bot-order-risk-driver-"));
  const originalKey = process.env["BYBIT_API_KEY"];
  const originalSecret = process.env["BYBIT_API_SECRET"];
  try {
    const paperStateFile = join(directory, "paper-emergency.json");
    const paperState: BotState = {
      version: 1,
      savedAt: 1,
      equityUsd: 10_000,
      initialEquityUsd: 10_000,
      realizedPnlUsd: 0,
      positions: [makeSavedPosition("first", "BTC/USDC"), makeSavedPosition("second", "ETH/USDC")],
      closedTrades: [],
      inFlightOrderIds: [],
      counters: { placed: 0, filled: 0, cancelled: 0, rejected: 0 },
    };
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- The path is derived from this case's fresh mkdtemp directory.
    writeFileSync(paperStateFile, JSON.stringify(paperState), "utf8");
    const paperFeed = new MockExchangeFeed();
    const paperBot = new Bot({
      config: botConfigFor(paperStateFile),
      feed: paperFeed,
      logger: quietLogger,
      perStrategyKillSwitches: [alwaysEngagedSwitch("paper-emergency")],
      stateSaveIntervalMs: 10_000,
      killSwitchEvalIntervalMs: 10_000,
      heartbeatIntervalMs: 5,
      gracefulShutdownTimeoutMs: 0,
    });
    const paperRunning = paperBot.start();
    await paperRunning;
    assertCondition(paperBot.isKillSwitchEngaged(), "paper emergency did not engage kill switch");
    assertCondition(
      paperBot.getState().positions.length === 0,
      "paper emergency retained restored positions",
    );

    process.env["BYBIT_API_KEY"] = "scripted-key";
    process.env["BYBIT_API_SECRET"] = "scripted-secret";
    const venueSymbol = asSymbol("BTC/USDC");
    const venueFeed = new AutoFlattenFeed({
      positions: [makeRemotePosition()],
      marketMeta: new Map([[venueSymbol, makePortfolioMarketMeta(false)]]),
      balances: [{ currency: "USDC", free: 10_000, total: 10_000 }],
    });
    const venueBaseConfig = botConfigFor(join(directory, "venue-emergency.json"));
    const venueConfig: BotConfig = { ...venueBaseConfig, bot: { ...venueBaseConfig.bot, mode: "live" } };
    const venueBot = new Bot({
      config: venueConfig,
      feed: venueFeed,
      logger: quietLogger,
      perStrategyKillSwitches: [alwaysEngagedSwitch("venue-emergency")],
      stateSaveIntervalMs: 10_000,
      killSwitchEvalIntervalMs: 10_000,
      heartbeatIntervalMs: 5,
      gracefulShutdownTimeoutMs: 0,
    });
    await venueBot.start();
    assertCondition(venueBot.isKillSwitchEngaged(), "venue emergency did not engage kill switch");

    const unresolvedFeed = new MockExchangeFeed({
      positions: [{ ...makeRemotePosition(), entryPrice: undefined, markPrice: undefined }],
      marketMeta: new Map([[venueSymbol, makePortfolioMarketMeta(false)]]),
      balances: [{ currency: "USDC", free: 10_000, total: 10_000 }],
    });
    const unresolvedBaseConfig = botConfigFor(join(directory, "unresolved-emergency.json"));
    const unresolvedConfig: BotConfig = {
      ...unresolvedBaseConfig,
      bot: { ...unresolvedBaseConfig.bot, mode: "live" },
    };
    const unresolvedBot = new Bot({
      config: unresolvedConfig,
      feed: unresolvedFeed,
      logger: quietLogger,
      perStrategyKillSwitches: [alwaysEngagedSwitch("unresolved-emergency")],
      stateSaveIntervalMs: 10_000,
      killSwitchEvalIntervalMs: 10_000,
      heartbeatIntervalMs: 5,
      gracefulShutdownTimeoutMs: 0,
    });
    const unresolvedRunning = unresolvedBot.start();
    await waitForCondition(() => unresolvedBot.isKillSwitchEngaged(), "unresolved emergency engagement");
    await Bun.sleep(20);
    await unresolvedBot.stop();
    await unresolvedRunning;

    const tripFeed = new SequencedBalanceFeed([1000, 1000, 800]);
    const tripBaseConfig = botConfigFor(join(directory, "portfolio-trip.json"));
    const tripConfig: BotConfig = { ...tripBaseConfig, bot: { ...tripBaseConfig.bot, mode: "live" } };
    const tripBot = new Bot({
      config: tripConfig,
      feed: tripFeed,
      logger: quietLogger,
      stateSaveIntervalMs: 10_000,
      killSwitchEvalIntervalMs: 10_000,
      heartbeatIntervalMs: 5,
      gracefulShutdownTimeoutMs: 0,
    });
    await tripBot.start();
    assertCondition(tripBot.isKillSwitchEngaged(), "portfolio stop did not engage emergency coordinator");
  } finally {
    if (originalKey === undefined) delete process.env["BYBIT_API_KEY"];
    else process.env["BYBIT_API_KEY"] = originalKey;
    if (originalSecret === undefined) delete process.env["BYBIT_API_SECRET"];
    else process.env["BYBIT_API_SECRET"] = originalSecret;
    rmSync(directory, { recursive: true, force: true });
  }
}
