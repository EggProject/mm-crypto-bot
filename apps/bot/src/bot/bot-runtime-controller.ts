import type { FeedEvent, Timeframe } from "@mm-crypto-bot/exchange";
import { asSymbol } from "@mm-crypto-bot/exchange";
import type { Logger } from "@mm-crypto-bot/logging";

import type { BotConfig, StrategyName } from "../config/schema.js";
import type { BotStrategyInstance } from "../config/strategy-registry.js";
import type { BotRuntimeContext } from "./bot-runtime-assembly.js";
import type {
  LiveEquityAuthority,
  LiveEquityAuthoritySnapshot,
  LiveEquityStartupEvidence,
} from "./live-equity-authority.js";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const supportedTimeframes: ReadonlySet<string> = new Set(["1m", "5m", "15m", "1h", "4h", "1d"]);

export interface BotRuntimeControllerOptions {
  readonly config: BotConfig;
  readonly logger: Logger;
  readonly context: BotRuntimeContext;
  readonly strategyInstances: ReadonlyMap<StrategyName, BotStrategyInstance>;
  readonly heartbeatIntervalMs: number;
  readonly isRunning: () => boolean;
  readonly isStopRequested: () => boolean;
  readonly markRunExited: () => void;
}

export class BotRuntimeController {
  private readonly feedSubscriptions: number[] = [];
  private readonly liveAuthority: LiveEquityAuthority | undefined;

  public constructor(private readonly options: BotRuntimeControllerOptions) {
    this.liveAuthority = options.context.preparedLiveEquity?.authority;
  }

  private subscriptionTimeframesBySymbol(): ReadonlyMap<string, readonly Timeframe[]> {
    const bySymbol = new Map<string, Set<Timeframe>>();
    for (const symbol of this.options.config.symbols.enabled) bySymbol.set(symbol, new Set());
    for (const [name, section] of Object.entries(this.options.config.strategies) as [
      StrategyName,
      BotConfig["strategies"][StrategyName],
    ][]) {
      if (!section.enabled) continue;
      const symbols =
        section.symbols?.filter((symbol) => bySymbol.has(symbol)) ?? this.options.config.symbols.enabled;
      const frames = [section.timeframes?.htf, section.timeframes?.mtf, section.timeframes?.ltf];
      const instance = this.options.strategyInstances.get(name);
      for (const symbol of symbols) {
        for (const timeframe of frames) {
          if (timeframe !== undefined && supportedTimeframes.has(timeframe))
            bySymbol.get(symbol)?.add(timeframe as Timeframe);
        }
        if (instance?.kind === "strategy") {
          for (const timeframe of instance.instance.timeframes) {
            bySymbol.get(symbol)?.add(timeframe);
          }
        }
      }
    }
    return new Map([...bySymbol].map(([symbol, timeframes]) => [symbol, [...timeframes]]));
  }

  public async run(): Promise<void> {
    const { feed, runner } = this.options.context;
    for (const [symbol, timeframes] of this.subscriptionTimeframesBySymbol()) {
      const exchangeSymbol = asSymbol(symbol);
      const tickerSub = await feed.subscribeTicker(exchangeSymbol, (event: FeedEvent) => {
        void runner.onFeedEvent(event);
      });
      this.feedSubscriptions.push(tickerSub);
      this.options.logger.info("bot.ticker.subscribed", { symbol });
      for (const timeframe of timeframes) {
        try {
          const ohlcvSub = await feed.subscribeOhlcv(exchangeSymbol, timeframe, (event: FeedEvent) => {
            void runner.onFeedEvent(event);
          });
          this.feedSubscriptions.push(ohlcvSub);
          this.options.logger.info("bot.ohlcv.subscribed", { symbol, timeframe });
        } catch (error) {
          this.options.logger.warn("bot.ohlcv.subscribe.failed", { error: errorMessage(error) });
        }
      }
    }
    this.options.logger.info("bot.runloop.started", {
      subscribedSymbols: this.options.config.symbols.enabled.length,
    });
    const heartbeat = setInterval(() => {
      void this.runHeartbeat();
    }, this.options.heartbeatIntervalMs);
    try {
      while (this.options.isRunning() && !this.options.isStopRequested()) {
        await new Promise<void>((resolve) => setTimeout(resolve, 50));
      }
    } finally {
      clearInterval(heartbeat);
      this.options.markRunExited();
    }
  }

  public async cleanupSubscriptions(): Promise<void> {
    for (const id of this.feedSubscriptions) {
      try {
        await this.options.context.feed.unsubscribe(id);
      } catch {
        // best-effort
      }
    }
    this.feedSubscriptions.length = 0;
  }

  public async runHeartbeat(): Promise<void> {
    const { context } = this.options;
    if (this.liveAuthority !== undefined) {
      try {
        await this.liveAuthority.refresh();
        if (this.liveAuthority.getSnapshot().state !== "fresh")
          throw new Error("live authority emergency latch");
      } catch (error) {
        context.runner.pause();
        await context.emergencyHandler(`live-equity-authority: ${errorMessage(error)}`);
      }
      return;
    }
    const equity = context.positionManager.getEquity();
    context.killSwitches.updateEquity(equity);
    context.riskManager.onEquityUpdate(equity);
    const snap = context.killSwitches.evaluate();
    context.telemetry.setEngaged(snap.engaged, snap.reasons);
    if (snap.engaged) await context.emergencyHandler(`registry: ${snap.reasons.join(", ")}`);
    context.portfolioManager.recordEquity(equity);
    if (context.portfolioManager.isTripped()) await context.emergencyHandler("portfolio-stop");
  }

  public getLiveEquityAuthoritySnapshot(): LiveEquityAuthoritySnapshot | undefined {
    return this.liveAuthority?.getSnapshot();
  }

  public getLiveEquityStartupEvidence(): LiveEquityStartupEvidence | undefined {
    return this.options.context.preparedLiveEquity?.evidence;
  }

  public async reconcileAuthoritativeEquity(): Promise<void> {
    if (this.liveAuthority === undefined) return;
    await this.liveAuthority.refresh();
  }
}
