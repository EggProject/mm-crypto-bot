import { BybitEuOriginAdmissionError, type BybitEuClient } from "./bybit-eu-client.js";
import type { RawTradePayload } from "./bybit-eu-raw-payloads.js";
import {
  normalizeExecution,
  normalizeOrder,
  normalizeOrderBook,
  normalizeTicker,
  normalizeTrade,
} from "./bybit-eu-normalizers.js";
import { ExchangeFeedError } from "./feed.js";
import type { FeedListener, SubscriptionId } from "./feed.js";
import type { Ohlcv, Symbol, Timeframe } from "./types.js";

interface Subscription {
  readonly id: SubscriptionId;
  readonly listener: FeedListener;
  readonly kind: "ticker" | "orderbook" | "trades" | "ohlcv" | "orders" | "executions";
  readonly abortController: AbortController;
  cancelled: boolean;
  runner: Promise<void>;
}

const TIMEFRAME_MS = new Map<Timeframe, number>([
  ["1m", 60_000],
  ["5m", 300_000],
  ["15m", 900_000],
  ["1h", 3_600_000],
  ["4h", 14_400_000],
  ["1d", 86_400_000],
]);

export class BybitEuSubscriptionManager {
  private nextId = 1;
  private readonly subs = new Map<SubscriptionId, Subscription>();

  constructor(private readonly client: BybitEuClient) {}

  private start(
    kind: Subscription["kind"],
    listener: FeedListener,
    createRunner: (id: SubscriptionId) => Promise<void>,
  ): SubscriptionId {
    const id = this.nextId++;
    const subscription: Subscription = {
      id,
      listener,
      kind,
      cancelled: false,
      abortController: new AbortController(),
      runner: Promise.resolve(),
    };
    this.subs.set(id, subscription);
    subscription.runner = completeOnAbort(createRunner(id), subscription.abortController.signal);
    void subscription.runner.catch(Boolean);
    return id;
  }

  close(): void {
    for (const subscription of this.subs.values()) {
      subscription.cancelled = true;
      subscription.abortController.abort();
    }
    this.subs.clear();
  }

  subscribeTicker(symbol: Symbol, listener: FeedListener): SubscriptionId {
    return this.start("ticker", listener, (id) => this.runTicker(id, symbol, listener));
  }

  subscribeOrderBook(symbol: Symbol, limit: number, listener: FeedListener): SubscriptionId {
    return this.start("orderbook", listener, (id) => this.runOrderBook(id, symbol, limit, listener));
  }

  subscribeTrades(symbol: Symbol, listener: FeedListener): SubscriptionId {
    return this.start("trades", listener, (id) => this.runTrades(id, symbol, listener));
  }

  subscribeOhlcv(symbol: Symbol, timeframe: Timeframe, listener: FeedListener): SubscriptionId {
    return this.start("ohlcv", listener, (id) => this.runOhlcv(id, symbol, timeframe, listener));
  }

  subscribeOrders(listener: FeedListener): SubscriptionId {
    return this.start("orders", listener, (id) => this.runOrders(id, listener));
  }

  subscribeExecutions(listener: FeedListener): SubscriptionId {
    return this.start("executions", listener, (id) => this.runExecutions(id, listener));
  }

  // eslint-disable-next-line unicorn/consistent-class-member-order -- Lifecycle runners stay beside their matching public subscriptions.
  private async runTicker(id: SubscriptionId, symbol: Symbol, listener: FeedListener): Promise<void> {
    const subscription = this.require(id);
    try {
      while (!isCancelled(subscription)) {
        listener({ kind: "ticker", payload: normalizeTicker(await this.client.watchTicker(symbol), symbol) });
      }
    } catch (error) {
      await this.runTickerFallback(subscription, symbol, listener, error);
    }
  }

  private async runTickerFallback(
    subscription: Subscription,
    symbol: Symbol,
    listener: FeedListener,
    error: unknown,
  ): Promise<void> {
    if (isCancelled(subscription)) return;
    if (!isNotSupported(error)) throw new ExchangeFeedError(`Ticker watch failed: ${symbol}`, error);
    while (!isCancelled(subscription)) {
      try {
        const raw = await this.client.fetchTicker(symbol);
        if (isCancelled(subscription)) return;
        listener({ kind: "ticker", payload: normalizeTicker(raw, symbol) });
      } catch (error) {
        if (isCancelled(subscription)) return;
        if (error instanceof BybitEuOriginAdmissionError) throw error;
      }
      await waitForNextPoll(subscription.abortController.signal);
    }
  }

  private async runOrderBook(
    id: SubscriptionId,
    symbol: Symbol,
    limit: number,
    listener: FeedListener,
  ): Promise<void> {
    const subscription = this.require(id);
    try {
      while (!isCancelled(subscription)) {
        listener({
          kind: "orderbook",
          payload: normalizeOrderBook(await this.client.watchOrderBook(symbol, limit), symbol),
        });
      }
    } catch (error) {
      if (isCancelled(subscription)) return;
      if (!isNotSupported(error)) throw new ExchangeFeedError(`Order book watch failed: ${symbol}`, error);
      while (!isCancelled(subscription)) {
        try {
          const raw = await this.client.fetchOrderBook(symbol, limit);
          if (isCancelled(subscription)) return;
          listener({ kind: "orderbook", payload: normalizeOrderBook(raw, symbol) });
        } catch (error) {
          if (isCancelled(subscription)) return;
          if (error instanceof BybitEuOriginAdmissionError) throw error;
        }
        await waitForNextPoll(subscription.abortController.signal);
      }
    }
  }

  private async runTrades(id: SubscriptionId, symbol: Symbol, listener: FeedListener): Promise<void> {
    const subscription = this.require(id);
    try {
      while (!isCancelled(subscription))
        this.emitTrades(await this.client.watchTrades(symbol), symbol, listener);
    } catch (error) {
      if (isCancelled(subscription)) return;
      if (!isNotSupported(error)) throw new ExchangeFeedError(`Trade watch failed: ${symbol}`, error);
      while (!isCancelled(subscription)) {
        try {
          const raw = await this.client.fetchTrades(symbol);
          if (isCancelled(subscription)) return;
          this.emitTrades(raw, symbol, listener);
        } catch (error) {
          if (isCancelled(subscription)) return;
          if (error instanceof BybitEuOriginAdmissionError) throw error;
        }
        await waitForNextPoll(subscription.abortController.signal);
      }
    }
  }

  private emitTrades(rawTrades: readonly RawTradePayload[], symbol: Symbol, listener: FeedListener): void {
    for (const raw of rawTrades) listener({ kind: "trade", payload: normalizeTrade(raw, symbol) });
  }

  private async runOhlcv(
    id: SubscriptionId,
    symbol: Symbol,
    timeframe: Timeframe,
    listener: FeedListener,
  ): Promise<void> {
    const subscription = this.require(id);
    let lastTimestamp: number | undefined;
    let pending: Ohlcv | undefined;
    const emit = (raw: readonly Ohlcv[], source: "watch" | "rest"): void => {
      const closed =
        source === "watch"
          ? collectWatchClosed(raw, pending)
          : raw.filter((candle) => isClosed(candle, timeframe));
      if (source === "watch") pending = latestCandle(raw, pending);
      for (const candle of closed) {
        if (lastTimestamp !== undefined && candle[0] <= lastTimestamp) continue;
        listener({ kind: "ohlcv", payload: { symbol, timeframe, candle } });
        lastTimestamp = candle[0];
        if (isCancelled(subscription)) return;
      }
    };
    try {
      while (!isCancelled(subscription))
        emit(toOhlcvs(await this.client.watchOHLCV(symbol, timeframe, undefined, undefined)), "watch");
    } catch (error) {
      if (isCancelled(subscription)) return;
      if (!isNotSupported(error))
        throw new ExchangeFeedError(`OHLCV watch failed: ${symbol}/${timeframe}`, error);
      while (!isCancelled(subscription)) {
        try {
          const raw = await this.client.fetchOHLCV(symbol, timeframe, undefined, 100);
          if (isCancelled(subscription)) return;
          emit(toOhlcvs(raw), "rest");
        } catch (error) {
          if (isCancelled(subscription)) return;
          if (error instanceof BybitEuOriginAdmissionError) throw error;
        }
        await waitForNextPoll(subscription.abortController.signal);
      }
    }
  }

  private async runOrders(id: SubscriptionId, listener: FeedListener): Promise<void> {
    const subscription = this.require(id);
    try {
      while (!isCancelled(subscription)) {
        const rawOrders = await this.client.watchOrders();
        for (const raw of rawOrders) {
          const order = normalizeOrder(raw, undefined);
          if (order.clientOrderId !== "" && order.symbol !== "UNKNOWN")
            listener({ kind: "order", payload: order });
          if (isCancelled(subscription)) return;
        }
      }
    } catch (error) {
      if (!isCancelled(subscription)) throw new ExchangeFeedError("Private order watch failed", error);
    }
  }

  private async runExecutions(id: SubscriptionId, listener: FeedListener): Promise<void> {
    const subscription = this.require(id);
    try {
      while (!isCancelled(subscription)) {
        const rawTrades = await this.client.watchMyTrades();
        for (const raw of rawTrades) {
          const execution = normalizeExecution(raw);
          if (execution !== undefined) listener({ kind: "execution", payload: execution });
          if (isCancelled(subscription)) return;
        }
      }
    } catch (error) {
      if (!isCancelled(subscription)) throw new ExchangeFeedError("Private execution watch failed", error);
    }
  }

  private require(id: SubscriptionId): Subscription {
    const subscription = this.subs.get(id);
    if (subscription === undefined) throw new ExchangeFeedError("Subscription is unavailable", undefined);
    return subscription;
  }

  waitForSubscription(id: SubscriptionId): Promise<void> {
    return this.require(id).runner;
  }

  async unsubscribe(id: SubscriptionId): Promise<void> {
    const subscription = this.subs.get(id);
    if (subscription === undefined) return;
    subscription.cancelled = true;
    subscription.abortController.abort();
    this.subs.delete(id);
    try {
      if (subscription.kind === "orders" && this.client.has["unWatchOrders"] === true)
        await this.client.unWatchOrders();
      if (subscription.kind === "executions" && this.client.has["unWatchMyTrades"] === true)
        await this.client.unWatchMyTrades();
    } catch (error) {
      if (error instanceof BybitEuOriginAdmissionError) throw error;
      return;
    }
  }
}

function completeOnAbort(runner: Promise<void>, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const finish = (): void => {
      signal.removeEventListener("abort", finish);
      resolve();
    };
    if (signal.aborted) {
      finish();
      return;
    }
    signal.addEventListener("abort", finish, { once: true });
    void runner
      .then(() => {
        signal.removeEventListener("abort", finish);
        resolve();
      })
      .catch((error: unknown) => {
        signal.removeEventListener("abort", finish);
        reject(
          error instanceof Error
            ? error
            : new ExchangeFeedError("Subscription runner rejected with a non-error value", undefined),
        );
      });
  });
}

function isNotSupported(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "NotSupported" ||
      error.message.includes("NotSupported") ||
      error.message.includes("is not supported yet"))
  );
}

function isCancelled(subscription: Subscription): boolean {
  return subscription.cancelled;
}

function waitForNextPoll(signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timeout = setTimeout(finish, 1000);
    function finish(): void {
      clearTimeout(timeout);
      signal.removeEventListener("abort", finish);
      resolve();
    }
    if (signal.aborted) finish();
    else signal.addEventListener("abort", finish, { once: true });
  });
}

function isClosed(candle: Ohlcv, timeframe: Timeframe): boolean {
  const duration = TIMEFRAME_MS.get(timeframe);
  if (duration === undefined) throw new ExchangeFeedError(`Unsupported timeframe: ${timeframe}`, undefined);
  return candle[0] + duration <= Date.now();
}

function collectWatchClosed(raw: readonly Ohlcv[], pending: Ohlcv | undefined): readonly Ohlcv[] {
  const candles = pending === undefined ? [...raw] : [pending, ...raw];
  const unique = new Map<number, Ohlcv>();
  for (const candle of candles) unique.set(candle[0], candle);
  const ordered: Ohlcv[] = [];
  for (const candle of unique.values()) insertChronologically(ordered, candle);
  return ordered.slice(0, -1);
}

function latestCandle(raw: readonly Ohlcv[], pending: Ohlcv | undefined): Ohlcv | undefined {
  const candles = pending === undefined ? raw : [pending, ...raw];
  let latest: Ohlcv | undefined;
  for (const candle of candles) {
    if (latest === undefined || candle[0] > latest[0]) latest = candle;
  }
  return latest;
}

function insertChronologically(values: Ohlcv[], candle: Ohlcv): void {
  const insertionIndex = values.findIndex((value) => value[0] > candle[0]);
  if (insertionIndex === -1) values.push(candle);
  else values.splice(insertionIndex, 0, candle);
}

function toOhlcvs(value: readonly unknown[]): readonly Ohlcv[] {
  return value.map((candle) => {
    if (!isOhlcv(candle)) throw new ExchangeFeedError("CCXT returned malformed OHLCV data", undefined);
    return candle;
  });
}

function isOhlcv(value: unknown): value is Ohlcv {
  return (
    Array.isArray(value) && value.length >= 6 && value.slice(0, 6).every((part) => typeof part === "number")
  );
}
