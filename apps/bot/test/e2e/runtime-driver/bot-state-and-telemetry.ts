import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { asSymbol } from "@mm-crypto-bot/exchange";
import { Bot } from "../../../src/bot/bot.js";
import type { BotState } from "../../../src/bot/state-store.js";
import { computeDrawdownPct, formatUptime, Telemetry } from "../../../src/bot/telemetry.js";
import type { BotConfig } from "../../../src/config/schema.js";

import {
  MockExchangeFeed,
  quietLogger,
  assertCondition,
  expectAsyncFailure,
  waitForCondition,
  RecordingLogger,
  ReconciliationFeed,
  SlowReconciliationFeed,
  NoPositionsFeed,
} from "./runtime-driver-core.js";
import {
  botConfigFor,
  startBotThenStop,
  makePortfolioMarketMeta,
} from "./runtime-driver-portfolio-fixtures.js";
import {
  createLiveRuntimeFixture,
  emptyTelemetrySnapshot,
  makeSavedPosition,
} from "./bot-cleanup-and-order-risk.js";

function runTelemetryFacadeLifecycle(): void {
  const logger = new RecordingLogger();
  const telemetry = new Telemetry({
    metricsIntervalSec: 60,
    logger,
    snapshotProvider: emptyTelemetrySnapshot,
  });
  telemetry.stop();
  telemetry.setEngaged(true, ["e2e-kill-switch"]);
  telemetry.start();
  telemetry.start();
  telemetry.emitMetrics();
  telemetry.stop();
  telemetry.stop();
  assertCondition(telemetry.getLogger() === logger, "telemetry did not preserve its public logger");
  assertCondition(
    logger.entries.filter((entry) => entry.message === "telemetry.metrics.started").length === 1,
    "telemetry start was not idempotent",
  );
  assertCondition(
    logger.entries.filter((entry) => entry.message === "telemetry.metrics.stopped").length === 1,
    "telemetry stop was not idempotent",
  );
  const snapshot = logger.entries.find((entry) => entry.message === "telemetry.metrics.observed");
  assertCondition(
    snapshot?.meta?.["killSwitchEngaged"] === true &&
      Array.isArray(snapshot.meta["killSwitchReasons"]) &&
      snapshot.meta["killSwitchReasons"].includes("e2e-kill-switch"),
    "telemetry did not enrich the public snapshot with kill-switch state",
  );
  assertCondition(
    formatUptime(-1) === "0s" &&
      formatUptime(59_000) === "59s" &&
      formatUptime(61_000) === "1m 1s" &&
      formatUptime(3_661_000) === "1h 1m",
    "telemetry uptime formatting changed",
  );
  assertCondition(
    computeDrawdownPct(90, 100, 100) === 0.1 && computeDrawdownPct(90, 100, 0) === 0,
    "telemetry drawdown calculation did not fail closed for a missing peak",
  );
}

async function runBotRestoreTelemetry(): Promise<void> {
  runTelemetryFacadeLifecycle();
  const directory = mkdtempSync(path.join(tmpdir(), "mm-bot-restore-driver-"));
  try {
    const stateFile = path.join(directory, "restore.json");
    const saved: BotState = {
      version: 1,
      savedAt: 1,
      equityUsd: 10_100,
      initialEquityUsd: 10_000,
      realizedPnlUsd: 100,
      positions: [makeSavedPosition("first", "BTC/USDC"), makeSavedPosition("second", "ETH/USDC")],
      closedTrades: [
        {
          strategy: "closed",
          symbol: "BTC/USDC",
          side: "long",
          quantity: 0.01,
          entryPrice: 100,
          exitPrice: 110,
          pnl: 0.1,
          pnlPct: 0.1,
          closedAt: 1,
        },
      ],
      inFlightOrderIds: [],
      counters: { placed: 0, filled: 0, cancelled: 0, rejected: 0 },
    };
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- The E2E path is created beneath this process fresh temporary directory.
    writeFileSync(stateFile, JSON.stringify(saved), "utf8");
    const feed = new MockExchangeFeed();
    const config: BotConfig = {
      ...botConfigFor(stateFile),
      risk: { ...botConfigFor(stateFile).risk, max_positions: 1 },
    };
    const bot = new Bot({
      config,
      feed,
      logger: quietLogger,
      stateSaveIntervalMs: 10,
      killSwitchEvalIntervalMs: 10_000,
      heartbeatIntervalMs: 10_000,
      telemetryMetricsIntervalSec: 10,
    });
    const running = bot.start();
    await waitForCondition(() => feed.subscriptionCount() > 0, "restored bot subscription");
    const restored = bot.getState();
    assertCondition(restored.positions.length === 2, "restored positions were capacity-truncated");
    assertCondition(restored.closedTrades.length === 1, "closed trade history was not restored");
    assertCondition(restored.realizedPnlUsd === 100, "realized PnL was not restored");
    await Bun.sleep(30);
    await bot.stop();
    await running;
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- The E2E path is created beneath this process fresh temporary directory.
    assertCondition(existsSync(stateFile), "periodic/final state save was missing");

    const emptyStateFile = path.join(directory, "empty-state.json");
    const emptySaved: BotState = {
      version: 1,
      savedAt: 1,
      equityUsd: 10_000,
      initialEquityUsd: 10_000,
      realizedPnlUsd: 0,
      positions: [],
      closedTrades: [],
      inFlightOrderIds: [],
      counters: { placed: 0, filled: 0, cancelled: 0, rejected: 0 },
    };
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- The E2E path is created beneath this process fresh temporary directory.
    writeFileSync(emptyStateFile, JSON.stringify(emptySaved), "utf8");
    const emptyFeed = new MockExchangeFeed();
    await startBotThenStop(
      new Bot({ config: botConfigFor(emptyStateFile), feed: emptyFeed, logger: quietLogger }),
      emptyFeed,
    );

    const positiveTelemetryState = path.join(directory, "positive-telemetry.json");
    const positiveFeed = new MockExchangeFeed();
    const positiveLogger = new RecordingLogger();
    const positiveBot = new Bot({
      config: botConfigFor(positiveTelemetryState),
      feed: positiveFeed,
      logger: positiveLogger,
      telemetryMetricsIntervalSec: 0.01,
      stateSaveIntervalMs: 10_000,
      killSwitchEvalIntervalMs: 10_000,
      heartbeatIntervalMs: 10_000,
    });
    const positiveRunning = positiveBot.start();
    await waitForCondition(() => {
      return positiveLogger.entries.some(
        (entry) =>
          entry.message === "telemetry.metrics.observed" && entry.meta?.["initialEquityUsd"] === 10_000,
      );
    }, "positive telemetry snapshot");
    await positiveBot.stop();
    await positiveRunning;

    const telemetryStateFile = path.join(directory, "telemetry.json");
    const telemetrySaved: BotState = {
      ...saved,
      equityUsd: 0,
      realizedPnlUsd: 0,
      positions: [
        {
          ...makeSavedPosition("telemetry", "BTC/USDC"),
          quantity: 1,
          entryPrice: 10_001,
          currentPrice: 1,
          unrealizedPnl: -10_000,
          notionalUsd: 10_001,
        },
      ],
      closedTrades: [],
    };
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- The E2E path is created beneath this process fresh temporary directory.
    writeFileSync(telemetryStateFile, JSON.stringify(telemetrySaved), "utf8");
    const telemetryFeed = new MockExchangeFeed();
    const telemetryLogger = new RecordingLogger();
    const telemetryBot = new Bot({
      config: botConfigFor(telemetryStateFile),
      feed: telemetryFeed,
      logger: telemetryLogger,
      telemetryMetricsIntervalSec: 0.01,
      stateSaveIntervalMs: 10_000,
      killSwitchEvalIntervalMs: 10_000,
      heartbeatIntervalMs: 10_000,
    });
    const telemetryRunning = telemetryBot.start();
    await waitForCondition(() => {
      return telemetryLogger.entries.some((entry) => entry.message === "telemetry.metrics.observed");
    }, "telemetry snapshot");
    const telemetrySnapshot = telemetryLogger.entries.find(
      (entry) => entry.message === "telemetry.metrics.observed",
    );
    assertCondition(
      telemetrySnapshot?.meta?.["initialEquityUsd"] === 0,
      "telemetry initial equity was not clamped",
    );
    assertCondition(
      telemetrySnapshot.meta["unrealizedPnlUsd"] === -10_000,
      "telemetry unrealized PnL mismatch",
    );
    await telemetryBot.stop();
    await telemetryRunning;
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

async function runBotLiveReconciliation(): Promise<void> {
  const directory = mkdtempSync(path.join(tmpdir(), "mm-bot-live-driver-"));
  const liveConfig = (name: string, symbols: readonly string[] = ["BTC/USDC"]): BotConfig => ({
    ...botConfigFor(path.join(directory, `${name}.json`)),
    bot: { ...botConfigFor(path.join(directory, `${name}.json`)).bot, mode: "live" },
    symbols: { enabled: [...symbols] },
  });
  try {
    const btc = asSymbol("BTC/USDC");
    const sol = asSymbol("SOL/USDC");
    const spotInventoryFeed = new ReconciliationFeed(
      [{ currency: "USDC", free: 1000, total: 1000 }],
      [
        { currency: "USDC", free: 1000, total: 1000 },
        { currency: "BTC", free: 1, total: 1 },
      ],
      {
        marketMeta: new Map([
          [btc, { ...makePortfolioMarketMeta(true), symbol: btc }],
          [sol, { ...makePortfolioMarketMeta(true), symbol: sol, base: "SOL" }],
        ]),
      },
    );
    spotInventoryFeed.setTicker(btc, {
      symbol: btc,
      timestamp: Date.now(),
      bid: 99,
      ask: 101,
      last: 100,
      baseVolume: 0,
      quoteVolume: 0,
    });
    const spotInventoryRuntime = await createLiveRuntimeFixture(
      liveConfig("spot-inventory", [btc, sol]),
      spotInventoryFeed,
      quietLogger,
    );
    try {
      await spotInventoryRuntime.controller.reconcileAuthoritativeEquity();
      await spotInventoryRuntime.controller.reconcileAuthoritativeEquity();
      assertCondition(
        spotInventoryFeed.tickerCalls > 0 && spotInventoryFeed.positionCalls === 0,
        "spot inventory reconciliation did not use the exact live authority boundary",
      );
      assertCondition(
        spotInventoryRuntime.controller.getLiveEquityAuthoritySnapshot()?.state === "fresh" &&
          spotInventoryRuntime.emergencyReasons.length === 0,
        "valid spot inventory reconciliation did not preserve fresh live authority",
      );
    } finally {
      await spotInventoryRuntime.dispose();
    }

    const absentFeed = new ReconciliationFeed([{ currency: "USDC", free: 1000, total: 1000 }], [], {
      marketMeta: new Map([[btc, makePortfolioMarketMeta(true)]]),
    });
    const absentRuntime = await createLiveRuntimeFixture(liveConfig("absent"), absentFeed, quietLogger);
    try {
      await expectAsyncFailure(
        () => absentRuntime.controller.reconcileAuthoritativeEquity(),
        "missing USDC live reconciliation",
      );
      assertCondition(absentFeed.balanceCalls >= 2, "absent spot reconciliation did not query balances");
      assertCondition(
        absentFeed.tickerCalls === 0 &&
          absentRuntime.controller.getLiveEquityAuthoritySnapshot()?.state === "unavailable",
        "missing USDC did not fail closed without a ticker fallback",
      );
    } finally {
      await absentRuntime.dispose();
    }

    const derivativeFeed = new ReconciliationFeed(
      [{ currency: "USDC", free: 1000, total: 1000 }],
      [{ currency: "USDC", free: 1000, total: 1000 }],
      {
        marketMeta: new Map([[btc, makePortfolioMarketMeta(false)]]),
      },
    );
    await expectAsyncFailure(
      () => createLiveRuntimeFixture(liveConfig("derivative"), derivativeFeed, quietLogger),
      "derivative market live preparation",
    );
    assertCondition(derivativeFeed.positionCalls === 0, "derivative market queried unsupported positions");

    for (const failure of [new Error("balance Error"), "balance string"] as const) {
      const balanceFeed = new ReconciliationFeed([{ currency: "USDC", free: 1000, total: 1000 }], failure);
      const balanceRuntime = await createLiveRuntimeFixture(
        liveConfig(`balance-${typeof failure}`),
        balanceFeed,
        quietLogger,
      );
      try {
        await expectAsyncFailure(
          () => balanceRuntime.controller.reconcileAuthoritativeEquity(),
          "balance failure live reconciliation",
        );
        assertCondition(
          balanceRuntime.controller.getLiveEquityAuthoritySnapshot()?.state === "unavailable",
          "balance reconciliation failure did not leave live authority unavailable",
        );
      } finally {
        await balanceRuntime.dispose();
      }
    }

    for (const invalidEquity of [0, NaN]) {
      const invalidFeed = new ReconciliationFeed(
        [{ currency: "USDC", free: 1000, total: 1000 }],
        [{ currency: "USDC", free: invalidEquity, total: invalidEquity }],
      );
      const invalidRuntime = await createLiveRuntimeFixture(
        liveConfig(`invalid-${String(invalidEquity)}`),
        invalidFeed,
        quietLogger,
      );
      try {
        await expectAsyncFailure(
          () => invalidRuntime.controller.reconcileAuthoritativeEquity(),
          "invalid equity live reconciliation",
        );
        assertCondition(
          invalidFeed.balanceCalls >= 2 &&
            invalidRuntime.controller.getLiveEquityAuthoritySnapshot()?.state === "unavailable",
          "invalid equity did not fail closed after an authoritative query",
        );
      } finally {
        await invalidRuntime.dispose();
      }
    }

    const slowFeed = new SlowReconciliationFeed();
    const slowRuntime = await createLiveRuntimeFixture(liveConfig("slow"), slowFeed, quietLogger);
    try {
      const firstReconciliation = slowRuntime.controller.reconcileAuthoritativeEquity();
      await waitForCondition(() => slowFeed.balanceCalls >= 2, "overlapping reconciliation");
      await slowRuntime.controller.reconcileAuthoritativeEquity();
      await firstReconciliation;
      assertCondition(slowFeed.balanceCalls === 2, "overlapping reconciliation was not skipped");
    } finally {
      await slowRuntime.dispose();
    }

    const noPositionsFeed = new NoPositionsFeed();
    const noPositionsRuntime = await createLiveRuntimeFixture(
      liveConfig("no-positions"),
      noPositionsFeed,
      quietLogger,
    );
    try {
      await noPositionsRuntime.controller.reconcileAuthoritativeEquity();
      assertCondition(
        noPositionsRuntime.controller.getLiveEquityAuthoritySnapshot()?.current?.numerator === "1000",
        "spot-only feed did not reconcile exact USDC equity",
      );
    } finally {
      await noPositionsRuntime.dispose();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

export { runBotRestoreTelemetry, runBotLiveReconciliation };
