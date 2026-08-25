import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { Bot, type BotOptions } from "../../../src/bot/bot.js";
import type { BotConfig } from "../../../src/config/schema.js";

import {
  assertCondition,
  BlockingTickerFeed,
  botConfigFor,
  expectAsyncFailure,
  expectFailure,
  MockExchangeFeed,
  quietLogger,
  RecordingLogger,
  startBotThenStop,
  waitForCondition,
} from "./runtime-driver-core.js";

const join = (...pathSegments: string[]): string => path.join(...pathSegments);

export async function runBotLifecycleFactory(): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), "mm-bot-factory-driver-"));
  const originalKey = process.env["BYBIT_API_KEY"];
  const originalSecret = process.env["BYBIT_API_SECRET"];
  try {
    const preStart = new Bot({
      config: botConfigFor(join(directory, "pre.json")),
      feed: new MockExchangeFeed(),
    });
    expectFailure(() => preStart.getState(), "pre-start state");
    await preStart.stop();
    assertCondition(preStart.getConfig().bot.state_file.endsWith("pre.json"), "Bot config accessor mismatch");

    delete process.env["BYBIT_API_KEY"];
    delete process.env["BYBIT_API_SECRET"];
    const unauthFeed = new MockExchangeFeed();
    const unauthCalls: Parameters<NonNullable<BotOptions["exchangeFeedFactory"]>>[0][] = [];
    const unauthBaseConfig = botConfigFor(join(directory, "unauth.json"));
    const unauthConfig: BotConfig = {
      ...unauthBaseConfig,
      exchange: {
        ...unauthBaseConfig.exchange,
        id: "bybiteu",
        endpoint: "https://scripted.invalid/rest",
        ws_endpoint: "wss://scripted.invalid/ws",
      },
    };
    await startBotThenStop(
      new Bot({
        config: unauthConfig,
        exchangeFeedFactory: (options) => {
          unauthCalls.push(options);
          return unauthFeed;
        },
      }),
      unauthFeed,
    );
    const unauthCall = unauthCalls[0];
    assertCondition(unauthCall !== undefined, "unauthenticated factory was not called");
    assertCondition(
      unauthCall.override?.apiKey === "",
      "unauthenticated factory did not receive empty credentials",
    );
    assertCondition(
      unauthCall.endpoint === "https://scripted.invalid/rest",
      "unauthenticated REST endpoint missing",
    );
    assertCondition(
      unauthCall.wsEndpoint === "wss://scripted.invalid/ws",
      "unauthenticated WS endpoint missing",
    );

    const noEndpointFeed = new MockExchangeFeed();
    const noEndpointCalls: Parameters<NonNullable<BotOptions["exchangeFeedFactory"]>>[0][] = [];
    const noEndpointBaseConfig = botConfigFor(join(directory, "unauth-no-endpoint.json"));
    const noEndpointConfig: BotConfig = {
      ...noEndpointBaseConfig,
      exchange: { ...noEndpointBaseConfig.exchange, id: "bybiteu" },
    };
    await startBotThenStop(
      new Bot({
        config: noEndpointConfig,
        exchangeFeedFactory: (options) => {
          noEndpointCalls.push(options);
          return noEndpointFeed;
        },
        logger: quietLogger,
      }),
      noEndpointFeed,
    );
    const noEndpointCall = noEndpointCalls[0];
    assertCondition(noEndpointCall !== undefined, "unauthenticated factory was not called");
    assertCondition(
      noEndpointCall.endpoint === undefined && noEndpointCall.wsEndpoint === undefined,
      "unauthenticated absent endpoints were populated",
    );

    process.env["BYBIT_API_KEY"] = "scripted-key";
    process.env["BYBIT_API_SECRET"] = "scripted-secret";
    const authFeed = new MockExchangeFeed({ balances: [{ currency: "BTC", free: 1, total: 1 }] });
    const authCalls: Parameters<NonNullable<BotOptions["exchangeFeedFactory"]>>[0][] = [];
    const authBaseConfig = botConfigFor(join(directory, "auth.json"));
    const authConfig: BotConfig = {
      ...authBaseConfig,
      exchange: { ...authBaseConfig.exchange, id: "bybiteu" },
    };
    const authBot = new Bot({
      config: authConfig,
      exchangeFeedFactory: (options) => {
        authCalls.push(options);
        return authFeed;
      },
      // eslint-disable-next-line unicorn/no-null -- The contract explicitly disables the optional funding source through null.
      fundingSource: null,
    });
    const authRunning = authBot.start();
    await waitForCondition(() => authFeed.subscriptionCount() > 0, "authenticated subscription");
    assertCondition(authBot.getState().equityUsd === 10_000, "missing-USDC startup fallback changed");
    await authBot.stop();
    await authRunning;
    const authCall = authCalls[0];
    assertCondition(authCall !== undefined, "authenticated factory was not called");
    assertCondition(authCall.override === undefined, "authenticated factory received credential override");
    assertCondition(
      authCall.endpoint === undefined && authCall.wsEndpoint === undefined,
      "absent factory endpoints were populated",
    );

    const endpointFeed = new MockExchangeFeed({
      balances: [{ currency: "USDC", free: 1000, total: 1000 }],
    });
    const endpointCalls: Parameters<NonNullable<BotOptions["exchangeFeedFactory"]>>[0][] = [];
    const endpointBaseConfig = botConfigFor(join(directory, "endpoint.json"));
    const endpointConfig: BotConfig = {
      ...endpointBaseConfig,
      exchange: {
        ...endpointBaseConfig.exchange,
        id: "bybiteu",
        endpoint: "https://scripted.invalid/rest",
        ws_endpoint: "wss://scripted.invalid/ws",
      },
    };
    await startBotThenStop(
      new Bot({
        config: endpointConfig,
        exchangeFeedFactory: (options) => {
          endpointCalls.push(options);
          return endpointFeed;
        },
      }),
      endpointFeed,
    );
    const endpointCall = endpointCalls[0];
    assertCondition(endpointCall !== undefined, "authenticated factory was not called");
    assertCondition(
      endpointCall.endpoint !== undefined && endpointCall.wsEndpoint !== undefined,
      "authenticated endpoints were dropped",
    );

    const doubleFeed = new MockExchangeFeed();
    const doubleBot = new Bot({ config: botConfigFor(join(directory, "double.json")), feed: doubleFeed });
    const doubleRunning = doubleBot.start();
    await waitForCondition(() => doubleFeed.subscriptionCount() > 0, "double-start subscription");
    await expectAsyncFailure(() => doubleBot.start(), "double start");
    await doubleBot.stop();
    await doubleRunning;
    await doubleBot.stop();

    const blockingFeed = new BlockingTickerFeed();
    const blockingLogger = new RecordingLogger();
    const blockingBot = new Bot({
      config: botConfigFor(join(directory, "blocking.json")),
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
      blockingLogger.entries.some((entry) => entry.message.includes("graceful shutdown timeout")),
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
