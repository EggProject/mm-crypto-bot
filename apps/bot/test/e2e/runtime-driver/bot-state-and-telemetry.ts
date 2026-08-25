import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { asSymbol, type ExchangePosition } from "@mm-crypto-bot/exchange";

import { Bot } from "../../../src/bot/bot.js";
import type { BotState } from "../../../src/bot/state-store.js";
import type { BotConfig } from "../../../src/config/schema.js";

import {
  assertCondition,
  botConfigFor,
  MockExchangeFeed,
  NoPositionsFeed,
  PositionFaultReconciliationFeed,
  quietLogger,
  ReconciliationFeed,
  RecordingLogger,
  SlowReconciliationFeed,
  startBotThenStop,
  waitForCondition,
} from "./runtime-driver-core.js";
import { makePortfolioMarketMeta } from "./runtime-driver-portfolio-fixtures.js";

const join = (...pathSegments: string[]): string => path.join(...pathSegments);

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

export async function runBotRestoreTelemetry(): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), "mm-bot-restore-driver-"));
  try {
    const stateFile = join(directory, "restore.json");
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
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- The path is derived from this case's fresh mkdtemp directory.
    writeFileSync(stateFile, JSON.stringify(saved), "utf8");
    const feed = new MockExchangeFeed();
    const baseConfig = botConfigFor(stateFile);
    const config: BotConfig = { ...baseConfig, risk: { ...baseConfig.risk, max_positions: 1 } };
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
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- The path is derived from this case's fresh mkdtemp directory.
    assertCondition(existsSync(stateFile), "periodic/final state save was missing");

    const emptyStateFile = join(directory, "empty-state.json");
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
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- The path is derived from this case's fresh mkdtemp directory.
    writeFileSync(emptyStateFile, JSON.stringify(emptySaved), "utf8");
    const emptyFeed = new MockExchangeFeed();
    await startBotThenStop(
      new Bot({ config: botConfigFor(emptyStateFile), feed: emptyFeed, logger: quietLogger }),
      emptyFeed,
    );

    const positiveTelemetryState = join(directory, "positive-telemetry.json");
    const positiveFeed = new MockExchangeFeed();
    const positiveBot = new Bot({
      config: botConfigFor(positiveTelemetryState),
      feed: positiveFeed,
      logger: quietLogger,
      telemetryMetricsIntervalSec: 0.01,
      stateSaveIntervalMs: 10_000,
      killSwitchEvalIntervalMs: 10_000,
      heartbeatIntervalMs: 10_000,
    });
    const positiveRunning = positiveBot.start();
    const positiveLog = join(
      `${positiveTelemetryState}.logs`,
      `bot-${new Date().toISOString().slice(0, 10)}.log`,
    );
    await waitForCondition(() => {
      try {
        // eslint-disable-next-line security/detect-non-literal-fs-filename -- The path is derived from this case's fresh mkdtemp directory.
        return readFileSync(positiveLog, "utf8").includes('"initialEquityUsd":10000');
      } catch {
        return false;
      }
    }, "positive telemetry snapshot");
    await positiveBot.stop();
    await positiveRunning;

    const telemetryStateFile = join(directory, "telemetry.json");
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
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- The path is derived from this case's fresh mkdtemp directory.
    writeFileSync(telemetryStateFile, JSON.stringify(telemetrySaved), "utf8");
    const telemetryFeed = new MockExchangeFeed();
    const telemetryBot = new Bot({
      config: botConfigFor(telemetryStateFile),
      feed: telemetryFeed,
      logger: quietLogger,
      telemetryMetricsIntervalSec: 0.01,
      stateSaveIntervalMs: 10_000,
      killSwitchEvalIntervalMs: 10_000,
      heartbeatIntervalMs: 10_000,
    });
    const telemetryRunning = telemetryBot.start();
    const telemetryLog = join(
      `${telemetryStateFile}.logs`,
      `bot-${new Date().toISOString().slice(0, 10)}.log`,
    );
    await waitForCondition(() => {
      try {
        // eslint-disable-next-line security/detect-non-literal-fs-filename -- The path is derived from this case's fresh mkdtemp directory.
        return readFileSync(telemetryLog, "utf8").includes("unrealizedPnlUsd");
      } catch {
        return false;
      }
    }, "telemetry snapshot");
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- The path is derived from this case's fresh mkdtemp directory.
    const contents = readFileSync(telemetryLog, "utf8");
    assertCondition(contents.includes('"initialEquityUsd":0'), "telemetry initial equity was not clamped");
    assertCondition(contents.includes('"unrealizedPnlUsd":-10000'), "telemetry unrealized PnL mismatch");
    await telemetryBot.stop();
    await telemetryRunning;
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

export async function runBotLiveReconciliation(): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), "mm-bot-live-driver-"));
  const originalKey = process.env["BYBIT_API_KEY"];
  const originalSecret = process.env["BYBIT_API_SECRET"];
  process.env["BYBIT_API_KEY"] = "scripted-key";
  process.env["BYBIT_API_SECRET"] = "scripted-secret";
  const liveConfig = (name: string, symbols: readonly string[] = ["BTC/USDC"]): BotConfig => {
    const baseConfig = botConfigFor(join(directory, `${name}.json`));
    return { ...baseConfig, bot: { ...baseConfig.bot, mode: "live" }, symbols: { enabled: [...symbols] } };
  };
  try {
    const btc = asSymbol("BTC/USDC");
    const eth = asSymbol("ETH/USDC");
    const usdc = asSymbol("USDC/USDT");
    const mixedFeed = new ReconciliationFeed(
      [{ currency: "USDC", free: 1000, total: 1000 }],
      [
        { currency: "USDC", free: 1000, total: 1000 },
        { currency: "BTC", free: 1, total: 1 },
      ],
      {
        positions: [
          {
            symbol: eth,
            side: "short",
            quantity: 1,
            entryPrice: 10,
            markPrice: 12,
            unrealizedPnl: -5,
            updateTimestamp: 1,
          },
        ],
        marketMeta: new Map([
          [btc, { ...makePortfolioMarketMeta(true), symbol: btc }],
          [eth, { ...makePortfolioMarketMeta(false), symbol: eth, base: "ETH" }],
          [usdc, { ...makePortfolioMarketMeta(true), symbol: usdc, base: "USDC", quote: "USDT" }],
        ]),
      },
    );
    mixedFeed.setTicker(btc, {
      symbol: btc,
      timestamp: 1,
      bid: 99,
      ask: 101,
      last: 100,
      baseVolume: 0,
      quoteVolume: 0,
    });
    const mixedBot = new Bot({
      config: liveConfig("mixed", [btc, eth, usdc]),
      feed: mixedFeed,
      logger: quietLogger,
      heartbeatIntervalMs: 5,
      killSwitchEvalIntervalMs: 10_000,
    });
    const mixedRunning = mixedBot.start();
    await waitForCondition(
      () => mixedFeed.tickerCalls > 0 && mixedFeed.positionCalls > 0,
      "mixed live reconciliation",
    );
    assertCondition(!mixedBot.isKillSwitchEngaged(), "mixed live reconciliation engaged kill switch");
    await mixedBot.stop();
    await mixedRunning;

    const absentFeed = new ReconciliationFeed([{ currency: "USDC", free: 1000, total: 1000 }], [], {
      marketMeta: new Map([[btc, makePortfolioMarketMeta(true)]]),
    });
    const absentBot = new Bot({
      config: liveConfig("absent"),
      feed: absentFeed,
      logger: quietLogger,
      heartbeatIntervalMs: 5,
      killSwitchEvalIntervalMs: 10_000,
    });
    const absentRunning = absentBot.start();
    await waitForCondition(() => absentFeed.balanceCalls >= 2, "absent spot reconciliation");
    assertCondition(absentFeed.tickerCalls === 0, "absent spot inventory fetched a ticker");
    await absentBot.stop();
    await absentRunning;

    const undefinedUpl: ExchangePosition = {
      symbol: btc,
      side: "long",
      quantity: 1,
      entryPrice: 100,
      markPrice: 100,
      unrealizedPnl: undefined,
      updateTimestamp: 1,
    };
    const derivativeFeed = new ReconciliationFeed(
      [{ currency: "USDC", free: 1000, total: 1000 }],
      [{ currency: "USDC", free: 1000, total: 1000 }],
      { positions: [undefinedUpl], marketMeta: new Map([[btc, makePortfolioMarketMeta(false)]]) },
    );
    const derivativeBot = new Bot({
      config: liveConfig("derivative"),
      feed: derivativeFeed,
      logger: quietLogger,
      heartbeatIntervalMs: 5,
      killSwitchEvalIntervalMs: 10_000,
    });
    const derivativeRunning = derivativeBot.start();
    await waitForCondition(() => derivativeFeed.positionCalls > 0, "derivative reconciliation");
    await derivativeBot.stop();
    await derivativeRunning;

    const positionFailures: readonly (Error | string)[] = [new Error("position Error"), "position string"];
    for (const failure of positionFailures) {
      const positionFeed = new PositionFaultReconciliationFeed(failure, [
        { currency: "USDC", free: 1000, total: 1000 },
      ]);
      const positionBot = new Bot({
        config: liveConfig(`position-${typeof failure}`),
        feed: positionFeed,
        logger: quietLogger,
        heartbeatIntervalMs: 5,
        killSwitchEvalIntervalMs: 10_000,
      });
      const positionRunning = positionBot.start();
      await waitForCondition(() => positionFeed.positionCalls > 0, "position-query rejection");
      await positionBot.stop();
      await positionRunning;
    }

    const balanceFailures: readonly (Error | string)[] = [new Error("balance Error"), "balance string"];
    for (const failure of balanceFailures) {
      const logger = new RecordingLogger();
      const balanceFeed = new ReconciliationFeed([{ currency: "USDC", free: 1000, total: 1000 }], failure);
      const balanceBot = new Bot({
        config: liveConfig(`balance-${typeof failure}`),
        feed: balanceFeed,
        logger,
        heartbeatIntervalMs: 5,
        killSwitchEvalIntervalMs: 10_000,
      });
      const balanceRunning = balanceBot.start();
      await waitForCondition(
        () =>
          logger.entries.some(
            (entry) => entry.message === "[bot] authoritative equity reconciliation failed",
          ),
        "balance reconciliation failure",
      );
      assertCondition(
        logger.entries.some(
          (entry) => entry.meta?.["error"] === (failure instanceof Error ? failure.message : failure),
        ),
        "balance reconciliation failure detail missing",
      );
      await balanceBot.stop();
      await balanceRunning;
    }

    for (const invalidEquity of [0, NaN]) {
      const invalidFeed = new ReconciliationFeed(
        [{ currency: "USDC", free: 1000, total: 1000 }],
        [{ currency: "USDC", free: invalidEquity, total: invalidEquity }],
      );
      const invalidBot = new Bot({
        config: liveConfig(`invalid-${String(invalidEquity)}`),
        feed: invalidFeed,
        logger: quietLogger,
        heartbeatIntervalMs: 5,
        killSwitchEvalIntervalMs: 10_000,
      });
      const invalidRunning = invalidBot.start();
      await waitForCondition(() => invalidFeed.balanceCalls >= 2, "invalid-equity reconciliation");
      await invalidBot.stop();
      await invalidRunning;
    }

    const slowFeed = new SlowReconciliationFeed();
    const slowBot = new Bot({
      config: liveConfig("slow"),
      feed: slowFeed,
      logger: quietLogger,
      heartbeatIntervalMs: 1,
      killSwitchEvalIntervalMs: 10_000,
    });
    const slowRunning = slowBot.start();
    await waitForCondition(() => slowFeed.balanceCalls >= 2, "overlapping reconciliation");
    await Bun.sleep(10);
    await slowBot.stop();
    await slowRunning;

    const noPositionsFeed = new NoPositionsFeed();
    const noPositionsBot = new Bot({
      config: liveConfig("no-positions"),
      feed: noPositionsFeed,
      logger: quietLogger,
      heartbeatIntervalMs: 5,
      killSwitchEvalIntervalMs: 10_000,
    });
    const noPositionsRunning = noPositionsBot.start();
    await waitForCondition(() => noPositionsFeed.subscriptionCount() > 0, "no-positions subscription");
    await Bun.sleep(15);
    await noPositionsBot.stop();
    await noPositionsRunning;
  } finally {
    if (originalKey === undefined) delete process.env["BYBIT_API_KEY"];
    else process.env["BYBIT_API_KEY"] = originalKey;
    if (originalSecret === undefined) delete process.env["BYBIT_API_SECRET"];
    else process.env["BYBIT_API_SECRET"] = originalSecret;
    rmSync(directory, { recursive: true, force: true });
  }
}
