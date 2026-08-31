import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { asSymbol, type ExchangeFeed } from "@mm-crypto-bot/exchange";
import { Bot, stopLifecycleForCleanup } from "../../../src/bot/bot.js";
import { BotRuntimeAssembly, type BotRuntimeAssemblyResult } from "../../../src/bot/bot-runtime-assembly.js";
import { BotRuntimeController } from "../../../src/bot/bot-runtime-controller.js";
import {
  PreparedLiveEquityAuthority,
  liveEquitySystemClock,
} from "../../../src/bot/live-equity-authority.js";
import type { BotState } from "../../../src/bot/state-store.js";
import type { KillSwitch } from "../../../src/bot/kill-switches.js";
import type { TelemetrySnapshot } from "../../../src/bot/telemetry.js";
import type { BotConfig } from "../../../src/config/schema.js";

import {
  MockExchangeFeed,
  quietLogger,
  assertCondition,
  waitForCondition,
  RecordingLogger,
  CleanupFailureFeed,
  AllUnsubscribeFailureFeed,
  SequencedBalanceFeed,
} from "./runtime-driver-core.js";
import {
  botConfigFor,
  startBotThenStop,
  makePortfolioMarketMeta,
  makeRemotePosition,
  AutoFlattenFeed,
} from "./runtime-driver-portfolio-fixtures.js";

interface LiveRuntimeFixture {
  readonly controller: BotRuntimeController;
  readonly assembly: BotRuntimeAssemblyResult;
  readonly emergencyReasons: readonly string[];
  dispose(): Promise<void>;
}

function emptyTelemetrySnapshot(): TelemetrySnapshot {
  return {
    equityUsd: 0,
    initialEquityUsd: 0,
    realizedPnlUsd: 0,
    unrealizedPnlUsd: 0,
    drawdownPct: 0,
    openPositions: 0,
    maxPositions: 0,
    counters: { placed: 0, filled: 0, cancelled: 0, rejected: 0 },
    killSwitchEngaged: false,
    killSwitchReasons: [],
    uptime: 0,
    uptimeHuman: "0s",
    activeStrategies: [],
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

async function createLiveRuntimeFixture(
  config: BotConfig,
  feed: ExchangeFeed,
  logger: RecordingLogger | typeof quietLogger,
  perStrategyKillSwitches?: readonly KillSwitch[],
): Promise<LiveRuntimeFixture> {
  const emergencyReasons: string[] = [];
  const runExitEvents: string[] = [];
  await feed.open();
  const preparedLiveEquity =
    config.bot.mode === "live"
      ? await PreparedLiveEquityAuthority.prepare({
          feed,
          symbols: config.symbols.enabled.map((symbol) => asSymbol(symbol)),
          maxAgeMs: 60_000,
          now: liveEquitySystemClock,
          maxDrawdownFraction: config.risk.max_drawdown_pct.toString(),
        })
      : undefined;
  const assembly = await BotRuntimeAssembly.create({
    config,
    feed,
    initialEquity: 1000,
    ...(preparedLiveEquity !== undefined && { preparedLiveEquity }),
    fundingSource: undefined,
    sizingFn: undefined,
    perStrategyKillSwitches: perStrategyKillSwitches ?? [],
    telemetryMetricsIntervalSec: 60,
    logger,
    createEmergencyHandler: (portfolioManager) => async (reason) => {
      emergencyReasons.push(reason);
      await portfolioManager.executeCloseAll();
    },
    snapshotProvider: emptyTelemetrySnapshot,
  });
  const controller = new BotRuntimeController({
    config,
    logger,
    context: assembly.context,
    strategyInstances: assembly.strategyInstances,
    heartbeatIntervalMs: 60_000,
    isRunning: () => false,
    isStopRequested: () => true,
    markRunExited: () => {
      runExitEvents.push("run-exited");
    },
  });
  return {
    controller,
    assembly,
    emergencyReasons,
    async dispose(): Promise<void> {
      assembly.context.telemetry.stop();
      await assembly.orderManager.stopLifecycle();
      assembly.context.runner.dispose();
      await feed.close();
    },
  };
}

async function runBotCleanupFaults(): Promise<void> {
  const directory = mkdtempSync(path.join(tmpdir(), "mm-bot-cleanup-driver-"));
  try {
    for (const failure of [new Error("cleanup Error"), "cleanup string"] as const) {
      const logger = new RecordingLogger();
      let didContinue = false;
      const lifecycleStop = Promise.withResolvers<undefined>();
      queueMicrotask(() => {
        lifecycleStop.reject(failure);
      });
      await stopLifecycleForCleanup(() => lifecycleStop.promise, logger);
      didContinue = true;
      assertCondition(didContinue, "lifecycle-stop failure halted cleanup continuation");
      assertCondition(
        logger.entries.some(
          (entry) =>
            entry.message === "bot.lifecycle.privatecleanup.failed" &&
            entry.meta?.["error"] === (failure instanceof Error ? failure.message : failure),
        ),
        "lifecycle-stop failure was not normalized into the cleanup warning",
      );
    }

    for (const failure of [
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
    ] as const) {
      const feed = new CleanupFailureFeed(failure.lifecycle, failure.close);
      feed.setBalance("USDC", 1000, 1000);
      const sourceConfig = botConfigFor(path.join(directory, `cleanup-${typeof failure.lifecycle}.json`));
      const config: BotConfig = { ...sourceConfig, bot: { ...sourceConfig.bot, mode: "live" } };
      const runtime = await createLiveRuntimeFixture(config, feed, quietLogger);
      try {
        await assertAsyncFailure(
          () => runtime.assembly.orderManager.stopLifecycle(),
          failure.expectedLifecycle,
          "private lifecycle cleanup",
        );
        await assertAsyncFailure(() => feed.close(), failure.expectedClose, "feed close");
      } finally {
        runtime.assembly.context.telemetry.stop();
        runtime.assembly.context.runner.dispose();
      }
    }

    const unsubscribeFeed = new AllUnsubscribeFailureFeed();
    await startBotThenStop(
      new Bot({
        // eslint-disable-next-line unicorn/max-nested-calls -- The E2E case constructs the nested dependency graph under test.
        config: botConfigFor(path.join(directory, "unsubscribe.json")),
        feed: unsubscribeFeed,
        logger: quietLogger,
      }),
      unsubscribeFeed,
    );

    const closeLogger = new RecordingLogger();
    const closeFeed = new CleanupFailureFeed(
      new Error("unreachable paper lifecycle failure"),
      new Error("bot feed close failure"),
    );
    const closeBot = new Bot({
      config: botConfigFor(path.join(directory, "bot-close-failure.json")),
      feed: closeFeed,
      logger: closeLogger,
    });
    const closeRunning = closeBot.start();
    await waitForCondition(() => closeFeed.subscriptionCount() > 0, "bot close failure subscription");
    await closeBot.stop();
    await closeRunning;
    assertCondition(
      closeLogger.entries.some(
        (entry) =>
          entry.message === "bot.feed.close.failed" && entry.meta?.["error"] === "bot feed close failure",
      ),
      "Bot cleanup did not normalize the feed close failure",
    );

    const blocker = path.join(directory, "state-parent-file");
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- The E2E path is created beneath this process fresh temporary directory.
    writeFileSync(blocker, "not a directory", "utf8");
    const invalidStateFile = path.join(blocker, "state.json");
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
      flushLogger.entries.some((entry) => entry.message === "bot.state.flush.failed"),
      "state flush failure was not logged",
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

async function assertAsyncFailure(
  operation: () => Promise<void>,
  expected: string,
  label: string,
): Promise<void> {
  try {
    await operation();
  } catch (error) {
    const actual = error instanceof Error ? error.message : String(error);
    assertCondition(actual === expected, `${label} error mismatch`);
    return;
  }
  throw new Error(`${label} unexpectedly succeeded`);
}

function alwaysEngagedSwitch(id: string): KillSwitch {
  return {
    id,
    description: "scripted always-engaged kill switch",
    evaluate: () => ({ switchId: id, engaged: true, reason: id }),
  };
}

async function runBotOrderRisk(): Promise<void> {
  const directory = mkdtempSync(path.join(tmpdir(), "mm-bot-order-risk-driver-"));
  try {
    const paperStateFile = path.join(directory, "paper-emergency.json");
    const paperState: BotState = {
      version: 1,
      savedAt: 1,
      equityUsd: 10_000,
      initialEquityUsd: 10_000,
      realizedPnlUsd: 0,
      positions: [makeSavedPosition("paper-emergency", "BTC/USDC")],
      closedTrades: [],
      inFlightOrderIds: [],
      counters: { placed: 0, filled: 0, cancelled: 0, rejected: 0 },
    };
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- The E2E path is created beneath this process fresh temporary directory.
    writeFileSync(paperStateFile, JSON.stringify(paperState), "utf8");
    const paperFeed = new MockExchangeFeed();
    const paperLogger = new RecordingLogger();
    const paperBot = new Bot({
      config: botConfigFor(paperStateFile),
      feed: paperFeed,
      logger: paperLogger,
      perStrategyKillSwitches: [alwaysEngagedSwitch("paper-emergency")],
      stateSaveIntervalMs: 10_000,
      killSwitchEvalIntervalMs: 10_000,
      heartbeatIntervalMs: 5,
      gracefulShutdownTimeoutMs: 0,
      paperOrderSimulator: () => "unfilled",
    });
    const paperRunning = paperBot.start();
    let hasPaperRunExited = false;
    void paperRunning.then(() => {
      hasPaperRunExited = true;
    });
    await waitForCondition(
      () => paperLogger.entries.some((entry) => entry.message === "bot.emergency.close.report"),
      "paper emergency report",
    );
    assertCondition(paperBot.isKillSwitchEngaged(), "paper emergency did not engage kill switch");
    assertCondition(
      paperLogger.entries.some(
        (entry) =>
          entry.message === "bot.emergency.close.report" &&
          Array.isArray(entry.meta?.["unresolved"]) &&
          entry.meta["unresolved"].length > 0,
      ),
      "paper emergency did not report unresolved positions",
    );
    assertCondition(
      paperBot.getState().positions.length === 1,
      "paper emergency removed unresolved position",
    );
    assertCondition(!hasPaperRunExited, "paper emergency stopped before an explicit operator stop");
    await paperBot.stop();
    await paperRunning;
    assertCondition(hasPaperRunExited, "paper emergency did not settle after an explicit operator stop");
    assertCondition(
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- The state path was created beneath this test's fresh temporary directory.
      readFileSync(paperStateFile, "utf8").includes("paper-emergency:BTC/USDC:long"),
      "paper emergency did not persist the retained position after stop",
    );

    const resolvedStateFile = path.join(directory, "paper-emergency-resolved.json");
    const resolvedState: BotState = {
      ...paperState,
      positions: [makeSavedPosition("paper-emergency-resolved", "BTC/USDC")],
    };
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- The E2E path is created beneath this process fresh temporary directory.
    writeFileSync(resolvedStateFile, JSON.stringify(resolvedState), "utf8");
    const resolvedLogger = new RecordingLogger();
    const resolvedBot = new Bot({
      config: botConfigFor(resolvedStateFile),
      feed: new MockExchangeFeed(),
      logger: resolvedLogger,
      perStrategyKillSwitches: [alwaysEngagedSwitch("paper-emergency-resolved")],
      stateSaveIntervalMs: 10_000,
      killSwitchEvalIntervalMs: 10_000,
      heartbeatIntervalMs: 5,
      gracefulShutdownTimeoutMs: 0,
      paperOrderSimulator: () => "filled",
    });
    const resolvedRunning = resolvedBot.start();
    let hasResolvedRunSettled = false;
    void resolvedRunning.then(() => {
      hasResolvedRunSettled = true;
    });
    await waitForCondition(() => hasResolvedRunSettled, "resolved paper emergency automatic stop");
    await resolvedRunning;
    assertCondition(resolvedBot.isKillSwitchEngaged(), "resolved paper emergency did not engage kill switch");
    assertCondition(
      resolvedLogger.entries.some(
        (entry) =>
          entry.message === "bot.emergency.close.report" &&
          Array.isArray(entry.meta?.["unresolved"]) &&
          entry.meta["unresolved"].length === 0,
      ),
      "resolved paper emergency did not report an empty unresolved set",
    );
    assertCondition(
      resolvedBot.getState().positions.length === 0,
      "resolved paper emergency did not close its restored position",
    );

    const venueSymbol = asSymbol("BTC/USDC");
    const venueFeed = new AutoFlattenFeed({
      positions: [makeRemotePosition()],
      marketMeta: new Map([[venueSymbol, makePortfolioMarketMeta(true)]]),
      balances: [{ currency: "USDC", free: 1000, total: 1000 }],
    });
    const venueConfig: BotConfig = {
      ...botConfigFor(path.join(directory, "venue-emergency.json")),
      bot: { ...botConfigFor(path.join(directory, "venue-emergency.json")).bot, mode: "live" },
    };
    const venueRuntime = await createLiveRuntimeFixture(venueConfig, venueFeed, quietLogger, [
      alwaysEngagedSwitch("venue-emergency"),
    ]);
    try {
      assertCondition(
        venueRuntime.controller.getLiveEquityAuthoritySnapshot()?.state === "fresh",
        "live runtime did not retain its prepared equity authority",
      );
      venueFeed.setBalance("USDC", 800, 800);
      await venueRuntime.controller.runHeartbeat();
      assertCondition(venueRuntime.emergencyReasons.length > 0, "venue emergency did not engage kill switch");
    } finally {
      await venueRuntime.dispose();
    }

    const unresolvedFeed = new MockExchangeFeed({
      positions: [{ ...makeRemotePosition(), entryPrice: undefined, markPrice: undefined }],
      marketMeta: new Map([[venueSymbol, makePortfolioMarketMeta(true)]]),
      balances: [{ currency: "USDC", free: 1000, total: 1000 }],
    });
    const unresolvedConfig: BotConfig = {
      ...botConfigFor(path.join(directory, "unresolved-emergency.json")),
      bot: { ...botConfigFor(path.join(directory, "unresolved-emergency.json")).bot, mode: "live" },
    };
    const unresolvedRuntime = await createLiveRuntimeFixture(unresolvedConfig, unresolvedFeed, quietLogger, [
      alwaysEngagedSwitch("unresolved-emergency"),
    ]);
    try {
      unresolvedFeed.setBalance("USDC", 800, 800);
      await unresolvedRuntime.controller.runHeartbeat();
      assertCondition(
        unresolvedRuntime.emergencyReasons.length > 0,
        "unresolved emergency did not engage kill switch",
      );
    } finally {
      await unresolvedRuntime.dispose();
    }

    const tripFeed = new SequencedBalanceFeed([1000, 1000, 800]);
    const tripConfig: BotConfig = {
      ...botConfigFor(path.join(directory, "portfolio-trip.json")),
      bot: { ...botConfigFor(path.join(directory, "portfolio-trip.json")).bot, mode: "live" },
    };
    const tripRuntime = await createLiveRuntimeFixture(tripConfig, tripFeed, quietLogger);
    try {
      await tripRuntime.controller.runHeartbeat();
      await tripRuntime.controller.runHeartbeat();
      await tripRuntime.controller.runHeartbeat();
      assertCondition(
        tripRuntime.controller.getLiveEquityAuthoritySnapshot()?.state === "emergency_latched" &&
          tripRuntime.assembly.context.runner.isPaused(),
        "live equity drawdown did not latch and pause order admission",
      );
      assertCondition(
        tripRuntime.emergencyReasons.some((reason) => reason.startsWith("live-equity-authority:")) &&
          !tripRuntime.emergencyReasons.includes("portfolio-stop"),
        "live equity drawdown did not use the fail-closed authority emergency path",
      );
    } finally {
      await tripRuntime.dispose();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

export {
  createLiveRuntimeFixture,
  emptyTelemetrySnapshot,
  makeSavedPosition,
  runBotCleanupFaults,
  runBotOrderRisk,
};
