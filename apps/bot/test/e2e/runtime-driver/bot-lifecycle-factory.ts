import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { asSymbol } from "@mm-crypto-bot/exchange";
import { Bot, type BotOptions } from "../../../src/bot/bot.js";
import { OrderManager } from "../../../src/bot/order-manager.js";
import { parsePaperOrderSimulationOutcome } from "../../../src/bot/order-manager-placement.js";
import { Telemetry } from "../../../src/bot/telemetry.js";
import type { BotConfig } from "../../../src/config/schema.js";

import {
  MockExchangeFeed,
  quietLogger,
  assertCondition,
  waitForCondition,
  expectFailure,
  expectAsyncFailure,
  RecordingLogger,
  BlockingTickerFeed,
} from "./runtime-driver-core.js";
import { botConfigFor, startBotThenStop } from "./runtime-driver-portfolio-fixtures.js";

function hasExactlyKeys(value: object, expected: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === expected.length && expected.every((key) => actual.includes(key));
}

function onlyFactoryCall(
  calls: readonly Parameters<NonNullable<BotOptions["exchangeFeedFactory"]>>[0][],
): Parameters<NonNullable<BotOptions["exchangeFeedFactory"]>>[0] {
  const [call] = calls;
  if (call === undefined || calls.length !== 1) throw new Error("expected exactly one exchange factory call");
  return call;
}

async function expectAsyncFailureMessage(
  action: () => Promise<unknown>,
  expectedMessage: string,
  label: string,
): Promise<void> {
  try {
    await action();
  } catch (error) {
    assertCondition(error instanceof Error, `${label} did not reject with an Error`);
    assertCondition(error.message === expectedMessage, `${label} error mismatch`);
    return;
  }
  throw new Error(`${label} unexpectedly succeeded`);
}

class CountingOpenFeed extends MockExchangeFeed {
  public openCalls = 0;

  public override async open(): Promise<void> {
    this.openCalls += 1;
    await super.open();
  }
}

async function runBotLifecycleFactory(): Promise<void> {
  const directory = mkdtempSync(path.join(tmpdir(), "mm-bot-factory-driver-"));
  const originalKey = process.env["BYBIT_API_KEY"];
  const originalSecret = process.env["BYBIT_API_SECRET"];
  try {
    const telemetryLogger = new RecordingLogger();
    const defaultTelemetry = new Telemetry({
      logger: telemetryLogger,
      snapshotProvider: () => ({
        equityUsd: 10_000,
        initialEquityUsd: 10_000,
        realizedPnlUsd: 0,
        unrealizedPnlUsd: 0,
        drawdownPct: 0,
        openPositions: 0,
        maxPositions: 3,
        counters: { placed: 0, filled: 0, cancelled: 0, rejected: 0 },
        killSwitchEngaged: false,
        killSwitchReasons: [],
        uptime: 0,
        uptimeHuman: "0s",
        activeStrategies: [],
      }),
    });
    defaultTelemetry.start();
    defaultTelemetry.setEngaged(true);
    defaultTelemetry.emitMetrics();
    defaultTelemetry.stop();
    const telemetryMetric = telemetryLogger.entries.find(
      (entry) => entry.message === "telemetry.metrics.observed",
    );
    const telemetryReasons = telemetryMetric?.meta?.["killSwitchReasons"];
    assertCondition(
      telemetryMetric?.meta?.["killSwitchEngaged"] === true &&
        Array.isArray(telemetryReasons) &&
        telemetryReasons.length === 0,
      "default telemetry interval or reasons contract changed",
    );
    const preStart = new Bot({
      config: botConfigFor(path.join(directory, "pre.json")),
      feed: new MockExchangeFeed(),
      logger: quietLogger,
    });
    expectFailure(() => preStart.getState(), "pre-start state");
    await preStart.stop();
    assertCondition(preStart.getConfig().bot.state_file.endsWith("pre.json"), "Bot config accessor mismatch");

    delete process.env["BYBIT_API_KEY"];
    delete process.env["BYBIT_API_SECRET"];

    const liveSourceConfig = botConfigFor(path.join(directory, "live-boundary.json"));
    const liveConfig: BotConfig = {
      ...liveSourceConfig,
      bot: { ...liveSourceConfig.bot, mode: "live" },
      exchange: { ...liveSourceConfig.exchange, id: "bybiteu" },
    };
    const injectedLiveFeed = new CountingOpenFeed();
    const injectedLiveBot = new Bot({ config: liveConfig, feed: injectedLiveFeed, logger: quietLogger });
    await expectAsyncFailureMessage(
      () => injectedLiveBot.start(),
      "Bot: live mode prohibits injected exchange feeds.",
      "live injected feed",
    );
    assertCondition(injectedLiveFeed.openCalls === 0, "live injected feed opened before rejection");
    assertCondition(
      injectedLiveFeed.subscriptionCount() === 0,
      "live injected feed subscribed before rejection",
    );

    let customFactoryCalls = 0;
    const customFactoryFeed = new CountingOpenFeed();
    const customFactoryLiveBot = new Bot({
      config: liveConfig,
      logger: quietLogger,
      exchangeFeedFactory: () => {
        customFactoryCalls += 1;
        return customFactoryFeed;
      },
    });
    await expectAsyncFailureMessage(
      () => customFactoryLiveBot.start(),
      "Bot: live mode prohibits custom exchange feed factories.",
      "live custom feed factory",
    );
    assertCondition(customFactoryCalls === 0, "live custom feed factory ran before rejection");
    assertCondition(
      customFactoryFeed.openCalls === 0,
      "live custom feed factory feed opened before rejection",
    );
    assertCondition(
      customFactoryFeed.subscriptionCount() === 0,
      "live custom feed factory feed subscribed before rejection",
    );

    let simulatorFactoryCalls = 0;
    const simulatorFactoryFeed = new CountingOpenFeed();
    const simulatorLiveBot = new Bot({
      config: liveConfig,
      logger: quietLogger,
      paperOrderSimulator: () => "unfilled",
      exchangeFeedFactory: () => {
        simulatorFactoryCalls += 1;
        return simulatorFactoryFeed;
      },
    });
    await expectAsyncFailureMessage(
      () => simulatorLiveBot.start(),
      "Bot: live mode prohibits paper order simulators.",
      "live paper order simulator",
    );
    assertCondition(simulatorFactoryCalls === 0, "live paper simulator reached the exchange factory");
    assertCondition(
      simulatorFactoryFeed.openCalls === 0,
      "live paper simulator opened a feed before rejection",
    );

    let directLiveSimulatorError: unknown;
    try {
      new OrderManager({
        feed: new MockExchangeFeed(),
        logger: quietLogger,
        getPositionContext: () => ({ equityUsd: 10_000, positions: [] }),
        paperOrderSimulator: () => "unfilled",
      });
    } catch (error) {
      directLiveSimulatorError = error;
    }
    assertCondition(
      directLiveSimulatorError instanceof Error &&
        directLiveSimulatorError.message ===
          "[order-manager] paper order simulator is only permitted in paper mode.",
      "direct live paper simulator guard mismatch",
    );

    const throwingPaperLogger = new RecordingLogger();
    let simulatorCalls = 0;
    const throwingPaperManager = new OrderManager({
      feed: new MockExchangeFeed(),
      logger: throwingPaperLogger,
      paperMode: true,
      getPositionContext: () => ({ equityUsd: 10_000, positions: [] }),
      paperOrderSimulator: () => {
        simulatorCalls += 1;
        if (simulatorCalls === 1) return parsePaperOrderSimulationOutcome(JSON.parse('"invalid"'));
        return "filled";
      },
    });
    await expectAsyncFailure(
      () =>
        throwingPaperManager.placeOrder({
          signal: { side: "buy", confidence: 0.8, reason: "simulator failure", stopLoss: 0, takeProfit: 0 },
          symbol: asSymbol("BTC/USDC"),
          amount: 0.01,
          referencePrice: 60_000,
          type: "market",
        }),
      "paper simulator failure",
    );
    assertCondition(
      throwingPaperManager.getCounters().rejected === 1 &&
        throwingPaperManager.getCounters().placed === 0 &&
        throwingPaperManager.getInFlightCount() === 0,
      "paper simulator failure retained placement capacity or recorded an order",
    );
    assertCondition(
      throwingPaperLogger.entries.some(
        (entry) =>
          entry.level === "error" &&
          entry.message === "order.paper.simulator.failed" &&
          typeof entry.meta?.["error"] === "string" &&
          entry.meta["error"].length > 0,
      ),
      "paper simulator failure was not structured-logged",
    );
    const recoveredPaperOrder = await throwingPaperManager.placeOrder({
      signal: { side: "buy", confidence: 0.8, reason: "simulator recovery", stopLoss: 0, takeProfit: 0 },
      symbol: asSymbol("BTC/USDC"),
      amount: 0.01,
      referencePrice: 60_000,
      type: "market",
    });
    assertCondition(
      recoveredPaperOrder.status === "closed" && throwingPaperManager.getCounters().placed === 1,
      "paper simulator failure did not release capacity for a subsequent valid placement",
    );

    const defaultLiveBot = new Bot({ config: liveConfig, logger: quietLogger });
    await expectAsyncFailureMessage(
      () => defaultLiveBot.start(),
      "Hiányzó API hitelesítő adatok. Állítsd be a BYBIT_API_KEY és BYBIT_API_SECRET környezeti változókat a .env fájlban (lásd .env.example).",
      "live default factory missing credentials",
    );

    const unauthFeed = new MockExchangeFeed();
    const unauthCalls: Parameters<NonNullable<BotOptions["exchangeFeedFactory"]>>[0][] = [];
    const unauthConfig: BotConfig = {
      ...botConfigFor(path.join(directory, "unauth.json")),
      exchange: {
        ...botConfigFor(path.join(directory, "unauth.json")).exchange,
        id: "bybiteu",
      },
    };
    await startBotThenStop(
      new Bot({
        config: unauthConfig,
        logger: quietLogger,
        exchangeFeedFactory: (options) => {
          unauthCalls.push(options);
          return unauthFeed;
        },
      }),
      unauthFeed,
    );
    const unauthCall = onlyFactoryCall(unauthCalls);
    assertCondition(
      unauthCall.override?.apiKey === "",
      "unauthenticated factory did not receive empty credentials",
    );
    assertCondition(
      hasExactlyKeys(unauthCall, ["override", "rateLimitMs", "timeoutMs"]),
      "unauthenticated factory received prohibited options",
    );
    assertCondition(
      unauthCall.rateLimitMs === unauthConfig.exchange.rate_limit_ms &&
        unauthCall.timeoutMs === unauthConfig.exchange.timeout_ms,
      "unauthenticated factory did not receive approved options",
    );

    process.env["BYBIT_API_KEY"] = "scripted-key";
    process.env["BYBIT_API_SECRET"] = "scripted-secret";
    const authFeed = new MockExchangeFeed({ balances: [{ currency: "BTC", free: 1, total: 1 }] });
    const authCalls: Parameters<NonNullable<BotOptions["exchangeFeedFactory"]>>[0][] = [];
    const authConfig: BotConfig = {
      ...botConfigFor(path.join(directory, "auth.json")),
      exchange: { ...botConfigFor(path.join(directory, "auth.json")).exchange, id: "bybiteu" },
    };
    const authBot = new Bot({
      config: authConfig,
      logger: quietLogger,
      exchangeFeedFactory: (options) => {
        authCalls.push(options);
        return authFeed;
      },
      // eslint-disable-next-line unicorn/no-null -- The E2E boundary preserves the explicit null contract under test.
      fundingSource: null,
    });
    const authRunning = authBot.start();
    await waitForCondition(() => authFeed.subscriptionCount() > 0, "authenticated subscription");
    assertCondition(authBot.getState().equityUsd === 10_000, "missing-USDC startup fallback changed");
    await authBot.stop();
    await authRunning;
    const authCall = onlyFactoryCall(authCalls);
    assertCondition(authCall.override === undefined, "authenticated factory received credential override");
    assertCondition(
      hasExactlyKeys(authCall, ["rateLimitMs", "timeoutMs"]),
      "authenticated factory received prohibited options",
    );

    const doubleFeed = new MockExchangeFeed();
    const doubleBot = new Bot({
      config: botConfigFor(path.join(directory, "double.json")),
      feed: doubleFeed,
      logger: quietLogger,
    });
    const doubleRunning = doubleBot.start();
    await waitForCondition(() => doubleFeed.subscriptionCount() > 0, "double-start subscription");
    await expectAsyncFailure(() => doubleBot.start(), "double start");
    await doubleBot.stop();
    await doubleRunning;
    await doubleBot.stop();

    const blockingFeed = new BlockingTickerFeed();
    const blockingLogger = new RecordingLogger();
    const blockingBot = new Bot({
      config: botConfigFor(path.join(directory, "blocking.json")),
      feed: blockingFeed,
      logger: blockingLogger,
      gracefulShutdownTimeoutMs: 0,
    });
    const blockingRunning = blockingBot.start();
    await waitForCondition(() => blockingFeed.tickerSubscriptionStarted, "blocking ticker subscription");
    await blockingBot.stop();
    blockingFeed.releaseTickerSubscription();
    await blockingRunning;
    assertCondition(
      blockingLogger.entries.some((entry) => entry.message === "bot.lifecycle.shutdown.timeout"),
      "force-stop fallback was not logged",
    );
  } finally {
    if (originalKey === undefined) delete process.env["BYBIT_API_KEY"];
    else process.env["BYBIT_API_KEY"] = originalKey;
    if (originalSecret === undefined) delete process.env["BYBIT_API_SECRET"];
    else process.env["BYBIT_API_SECRET"] = originalSecret;
    rmSync(directory, { recursive: true, force: true });
  }
}

export { runBotLifecycleFactory };
