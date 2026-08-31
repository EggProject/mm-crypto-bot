import { createExchangeClient, symbolOf, type ExchangeFeed } from "@mm-crypto-bot/exchange";
import type { Logger } from "@mm-crypto-bot/logging";

import type { BotConfig } from "../config/schema.js";
import { PreparedLiveEquityAuthority, liveEquitySystemClock } from "./live-equity-authority.js";

export interface BotExchangeInitialization {
  readonly feed: ExchangeFeed;
  readonly initialEquity: number;
  readonly hasCredentials: boolean;
  readonly preparedLiveEquity: PreparedLiveEquityAuthority | undefined;
}

export interface BotExchangeInitializerOptions {
  readonly config: BotConfig;
  readonly injectedFeed: ExchangeFeed | undefined;
  readonly paperExchangeFeedFactory: (options: Parameters<typeof createExchangeClient>[0]) => ExchangeFeed;
  readonly hasCustomExchangeFeedFactory: boolean;
  readonly logger: Logger;
  readonly apiKey: string | undefined;
  readonly apiSecret: string | undefined;
  readonly assignFeed: (feed: ExchangeFeed) => void;
}

export class BotExchangeInitializer {
  private assertLiveConstructionBoundary(options: BotExchangeInitializerOptions): void {
    if (options.config.bot.mode !== "live") return;
    if (options.injectedFeed !== undefined) {
      throw new Error("Bot: live mode prohibits injected exchange feeds.");
    }
    if (options.hasCustomExchangeFeedFactory) {
      throw new Error("Bot: live mode prohibits custom exchange feed factories.");
    }
  }

  private createFeed(options: BotExchangeInitializerOptions, hasCredentials: boolean): ExchangeFeed {
    if (options.injectedFeed !== undefined) return options.injectedFeed;
    if (options.config.exchange.id === "mock") {
      throw new Error(
        "Bot: 'exchange.id = mock' in production config is not supported. MockExchangeFeed is test-only and not importable from production code. Tests must inject the mock feed via `new Bot({ config, feed })`. For real exchange data, use exchange.id = 'bybiteu' (or any non-mock id).",
      );
    }
    const common = {
      rateLimitMs: options.config.exchange.rate_limit_ms,
      timeoutMs: options.config.exchange.timeout_ms,
    };
    const exchangeFeedFactory =
      options.config.bot.mode === "live" ? createExchangeClient : options.paperExchangeFeedFactory;
    return exchangeFeedFactory(
      !hasCredentials && options.config.bot.mode === "paper"
        ? { ...common, override: { apiKey: "", secret: "" } }
        : common,
    );
  }

  private async resolvePaperInitialEquity(
    options: BotExchangeInitializerOptions,
    feed: ExchangeFeed,
    hasCredentials: boolean,
  ): Promise<number> {
    if (!hasCredentials) {
      const initialEquity = 10_000;
      options.logger.info("bot.paper.credentials.absent", { usdc: initialEquity });
      return initialEquity;
    }
    const balances = await feed.fetchBalances();
    const initialEquity = balances.find((balance) => balance.currency === "USDC")?.total ?? 10_000;
    options.logger.info("bot.equity.initial", { usdc: initialEquity });
    return initialEquity;
  }

  private async prepareLiveEquity(
    options: BotExchangeInitializerOptions,
    feed: ExchangeFeed,
  ): Promise<PreparedLiveEquityAuthority> {
    const prepared = await PreparedLiveEquityAuthority.prepare({
      feed,
      symbols: options.config.symbols.enabled.map((symbol) => symbolOf(symbol)),
      maxAgeMs: 60_000,
      now: liveEquitySystemClock,
      maxDrawdownFraction: options.config.risk.max_drawdown_pct.toString(),
    });
    const evidence = prepared.evidence;
    options.logger.info("bot.equity.initial", {
      source: evidence.source,
      observedAt: evidence.observedAt,
      equity: evidence.snapshot.current,
    });
    return prepared;
  }

  public async initialize(options: BotExchangeInitializerOptions): Promise<BotExchangeInitialization> {
    this.assertLiveConstructionBoundary(options);
    const apiKey = options.apiKey?.trim();
    const apiSecret = options.apiSecret?.trim();
    const hasCredentials =
      apiKey !== undefined && apiKey.length > 0 && apiSecret !== undefined && apiSecret.length > 0;
    const feed = this.createFeed(options, hasCredentials);
    options.assignFeed(feed);
    await feed.open();
    options.logger.info("bot.feed.opened", { exchangeId: feed.exchangeId });
    if (options.config.bot.mode === "live") {
      const preparedLiveEquity = await this.prepareLiveEquity(options, feed);
      return {
        feed,
        initialEquity: 1000,
        hasCredentials,
        preparedLiveEquity,
      };
    }
    const initialEquity = await this.resolvePaperInitialEquity(options, feed, hasCredentials);
    return {
      feed,
      initialEquity,
      hasCredentials,
      preparedLiveEquity: undefined,
    };
  }
}
