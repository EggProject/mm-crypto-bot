import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  type Balance,
  type ExchangePosition,
  type FeedListener,
  type SubscriptionId,
  type Symbol as ExchangeSymbol,
  type Timeframe,
} from "@mm-crypto-bot/exchange";
import { MockExchangeFeed } from "@exchange-testing/mockFeed.js";
import type { LogFields, Logger } from "@mm-crypto-bot/logging";

import { DEFAULT_BOT_CONFIG } from "../config/defaults.js";
import type { BotConfig } from "../config/schema.js";
import { Bot as RuntimeBot, type BotOptions } from "./bot.js";

export interface TestExchangeFactoryOptions {
  readonly override?: { readonly apiKey: string; readonly secret: string } | undefined;
  readonly rateLimitMs?: number | undefined;
  readonly timeoutMs?: number | undefined;
}

export interface PublicBoundaryTestFixture {
  readonly directory: string;
  readonly stateFile: string;
  readonly originalKey: string | undefined;
  readonly originalSecret: string | undefined;
}

const delay = async (milliseconds: number): Promise<void> => {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, milliseconds);
  });
};

function rejectWith(reason: unknown): Promise<never> {
  return new Promise<never>((_resolve, reject) => {
    const rejectReason: (value: unknown) => void = reject;
    rejectReason(reason);
  });
}

function isBalanceArray(value: unknown): value is readonly Balance[] {
  return Array.isArray(value) && value.every(isBalance);
}

function isBalance(value: unknown): value is Balance {
  if (typeof value !== "object" || value === null) return false;
  return (
    typeof Reflect.get(value, "currency") === "string" &&
    typeof Reflect.get(value, "free") === "number" &&
    typeof Reflect.get(value, "total") === "number"
  );
}

export async function waitFor(isConditionMet: () => boolean, timeoutMs = 1000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!isConditionMet()) {
    if (Date.now() >= deadline) throw new Error("timed out waiting for public bot boundary");
    await delay(5);
  }
}

export class RecordingLogger implements Logger {
  public readonly entries: {
    readonly level: "debug" | "info" | "warn" | "error" | "critical";
    readonly event: string;
    readonly fields?: LogFields;
  }[] = [];

  public debug(event: string, fields?: LogFields): void {
    this.entries.push({ level: "debug", event, ...(fields !== undefined && { fields }) });
  }
  public info(event: string, fields?: LogFields): void {
    this.entries.push({ level: "info", event, ...(fields !== undefined && { fields }) });
  }
  public warn(event: string, fields?: LogFields): void {
    this.entries.push({ level: "warn", event, ...(fields !== undefined && { fields }) });
  }
  public error(event: string, fields?: LogFields): void {
    this.entries.push({ level: "error", event, ...(fields !== undefined && { fields }) });
  }
  public critical(event: string, fields?: LogFields): void {
    this.entries.push({ level: "critical", event, ...(fields !== undefined && { fields }) });
  }
}

export class Bot extends RuntimeBot {
  public constructor(options: BotOptions) {
    super({ ...options, logger: options.logger ?? new RecordingLogger() });
  }
}

export class FailingOhlcvFeed extends MockExchangeFeed {
  public override async subscribeOhlcv(
    symbol: ExchangeSymbol,
    timeframe: Timeframe,
    listener: FeedListener,
  ): Promise<SubscriptionId> {
    if (timeframe === "4h") throw new Error("4h subscription failed");
    if (timeframe === "15m") return rejectWith("15m subscription failed");
    return super.subscribeOhlcv(symbol, timeframe, listener);
  }
}

export class BlockingTickerFeed extends MockExchangeFeed {
  private release: (() => void) | undefined;
  public tickerSubscriptionStarted = false;

  public override async subscribeTicker(
    symbol: ExchangeSymbol,
    listener: FeedListener,
  ): Promise<SubscriptionId> {
    this.tickerSubscriptionStarted = true;
    await new Promise<void>((resolve) => {
      this.release = resolve;
    });
    void symbol;
    void listener;
    return 30_000;
  }

  public releaseTickerSubscription(): void {
    this.release?.();
  }
}

export class CountingOpenFeed extends MockExchangeFeed {
  public openCalls = 0;

  public override async open(): Promise<void> {
    this.openCalls += 1;
    await super.open();
  }
}

export class CleanupFailureFeed extends MockExchangeFeed {
  public constructor(private readonly closeFailure: unknown) {
    super({ balances: [{ currency: "USDC", free: 10_000, total: 10_000 }] });
  }

  public override close(): Promise<never> {
    return rejectWith(this.closeFailure);
  }
}

export class ReconciliationFeed extends MockExchangeFeed {
  public balanceCalls = 0;
  public positionCalls = 0;
  public tickerCalls = 0;

  public constructor(
    private readonly initialBalances: readonly Balance[],
    private readonly reconciledBalances: unknown,
    options: ConstructorParameters<typeof MockExchangeFeed>[0] = {},
  ) {
    super({ ...options, balances: initialBalances });
  }

  public override fetchBalances(): Promise<readonly Balance[]> {
    this.balanceCalls += 1;
    if (this.balanceCalls === 1) return Promise.resolve(this.initialBalances);
    if (!isBalanceArray(this.reconciledBalances)) return rejectWith(this.reconciledBalances);
    return Promise.resolve(this.reconciledBalances);
  }

  public override async fetchPositions(
    symbols?: readonly ExchangeSymbol[],
  ): Promise<readonly ExchangePosition[]> {
    this.positionCalls += 1;
    return super.fetchPositions(symbols);
  }

  public override async fetchTickerSnapshot(symbol: ExchangeSymbol) {
    this.tickerCalls += 1;
    return super.fetchTickerSnapshot(symbol);
  }
}

export function createPublicBoundaryTestFixture(): PublicBoundaryTestFixture {
  const directory = mkdtempSync(path.join(tmpdir(), "mm-bot-public-"));
  return {
    directory,
    stateFile: path.join(directory, "state.json"),
    originalKey: process.env["BYBIT_API_KEY"],
    originalSecret: process.env["BYBIT_API_SECRET"],
  };
}

export function disposePublicBoundaryTestFixture(fixture: PublicBoundaryTestFixture): void {
  if (fixture.originalKey === undefined) delete process.env["BYBIT_API_KEY"];
  else process.env["BYBIT_API_KEY"] = fixture.originalKey;
  if (fixture.originalSecret === undefined) delete process.env["BYBIT_API_SECRET"];
  else process.env["BYBIT_API_SECRET"] = fixture.originalSecret;
  rmSync(fixture.directory, { recursive: true, force: true });
}

export function configFor(stateFile: string): BotConfig {
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
    telemetry: { ...DEFAULT_BOT_CONFIG.telemetry, log_dir: `${stateFile}.logs`, metrics_interval_sec: 60 },
  };
}

export async function startThenStop(bot: Bot, feed: MockExchangeFeed): Promise<void> {
  const running = bot.start();
  await waitFor(() => feed.subscriptionCount() > 0);
  await bot.stop();
  await running;
}
