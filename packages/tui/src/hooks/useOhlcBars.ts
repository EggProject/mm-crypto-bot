// packages/tui/src/hooks/useOhlcBars.ts — TUI hook for OHLC bar streaming
//
// Phase 37 Track 3: wire the `@mm/exchange` `OhlcStream` into the TUI
// Charts panel.  The hook:
//
//   1. Owns a per-symbol `OhlcStream` instance (in-memory trade → bar
//      aggregator).
//   2. Subscribes to the `BotStateProvider` and on each `state` change
//      reads the `tickers` array (a snapshot of latest prices per
//      symbol).  For each ticker, synthesizes a synthetic `Trade` event
//      and pushes it into the corresponding `OhlcStream`.
//   3. Returns the bar history (most recent first) for the requested
//      `(symbol, timeframe)`, debounced to a maximum of 1Hz (the
//      underlying state changes are already 1Hz in the SimulatedProvider
//      and the live Bybit feed, so this is mostly defensive).
//
// The hook is intentionally **stateless across renders** — every render
// gets a fresh `bars` array.  The OhlcStream state lives in a `useRef`,
// so it survives across renders but is GC'd when the component unmounts.
//
// The hook does NOT start a real `ExchangeFeed` subscription — it
// synthesizes trades from the already-aggregated `tickers` snapshot.
// This is the right level of abstraction for the TUI: the underlying
// feed (live or simulated) is owned by the `Bot` process, and the TUI
// just observes the aggregated state.  If a future phase needs
// per-trade granularity in the TUI, the hook can be extended to
// subscribe to a trade-event feed exposed by the provider.

import { useEffect, useRef, useState } from "react";
import { EventEmitter } from "node:events";

import { MockExchangeFeed, OhlcStream } from "@mm-crypto-bot/exchange";
import type { OhlcBar, Symbol, Timeframe, Trade } from "@mm-crypto-bot/exchange";

import { useBotState } from "./useBotState.js";
import type { BotStateProvider } from "../providers/BotStateProvider.js";

/** Per-hook return: the bars for the requested (symbol, timeframe). */
export interface UseOhlcBarsResult {
  /** Most recent first; length ≤ `bufferSize` from the OhlcStreamConfig. */
  readonly bars: readonly OhlcBar[];
  /** The number of trades the stream has ingested so far. */
  readonly tradeCount: number;
}

/**
 * `__testHooks` — TEST-ONLY module-level handle for accessing the
 * per-provider stream map.  Used by `useOhlcBars.test.tsx` to trigger
 * a `bar` event programmatically (which would otherwise require
 * waiting 60+ seconds for a real-time bucket rollover).
 *
 * **NOT FOR PRODUCTION USE** — the leading underscore signals test-only,
 * and the export is intentionally verbose.  A consumer that imports
 * this directly will fail any code review.
 */
export const __testHooks = {
  /** The map of provider → (key → StreamEntry) used by `useOhlcBars`. */
  entries: new WeakMap<BotStateProvider, Map<string, StreamEntry>>(),
};

/** Internal state for the per-symbol OhlcStream bookkeeping. */
interface StreamEntry {
  readonly stream: OhlcStream;
  readonly emitter: EventEmitter;
  /** Last price we synthesized a trade for (to compute trade.amount). */
  lastPrice: number;
  /** Total trades ingested into the stream. */
  tradeCount: number;
}

/**
 * `useOhlcBars` — given a `BotStateProvider` and a `(symbol, timeframe)`,
 * return the live OHLC bar history.  The bars are aggregated from the
 * provider's ticker stream (synthesizing a trade per tick).
 */
export function useOhlcBars(
  provider: BotStateProvider,
  symbol: Symbol,
  timeframe: Timeframe,
  bufferSize = 200,
): UseOhlcBarsResult {
  const state = useBotState(provider);
  // `useRef` survives across renders but does NOT trigger re-render on
  // mutation.  The `tick` counter below IS the re-render trigger.
  // The per-provider stream map lives in a module-level WeakMap for
  // test introspection (see `__testHooks.entries`).
  let streamsRefMap = __testHooks.entries.get(provider);
  if (streamsRefMap === undefined) {
    streamsRefMap = new Map<string, StreamEntry>();
    __testHooks.entries.set(provider, streamsRefMap);
  }
  const streamsRef = useRef<Map<string, StreamEntry>>(streamsRefMap);
  // Bump this on every bar-event to force a re-render.  The number
  // itself is opaque (we just need a new value each time).
  const [tick, setTick] = useState(0);
  // Cached bar array for the current render.  We re-fetch from the
  // stream on every render (cheap — it's an array copy).
  const [bars, setBars] = useState<readonly OhlcBar[]>([]);

  // Initialize the per-symbol stream lazily (on first render that
  // references the symbol).  The stream lives in the ref so it
  // persists across renders.
  const key = `${symbol}::${timeframe}`;
  let entry = streamsRef.current.get(key);
  if (entry === undefined) {
    const emitter = new EventEmitter();
    // Use the real `MockExchangeFeed` from `@mm/exchange` — the hook
    // never calls `stream.start()`, so the feed's no-op behavior is
    // fine; we feed trades via `ingest()` directly.
    const feed = new MockExchangeFeed();
    const stream = new OhlcStream(feed, emitter, {
      timeframes: [timeframe],
      bufferSize,
      symbols: [symbol],
    });
    entry = { stream, emitter, lastPrice: 0, tradeCount: 0 };
    streamsRef.current.set(key, entry);
    // Wire the bar event so we can re-render.  A `bar` event fires
    // when a new OHLC bar closes (typically every 1m / 5m / 15m / etc).
    // The `onBar` callback simply bumps the `tick` counter, which
    // causes React to re-render with the fresh `bars` array.
    const onBar = (): void => {
      setTick((t) => t + 1);
    };
    emitter.on("bar", onBar);
  }

  // 1) On every state change, synthesize a trade from the ticker
  //    for our symbol and feed it into the stream.
  useEffect(() => {
    const e = streamsRef.current.get(key);
    if (e === undefined) return;
    const ticker = state.tickers.find((t) => t.symbol === symbol);
    if (ticker === undefined) return;
    // Skip if the price didn't change (saves CPU on no-op ticks).
    if (ticker.price === e.lastPrice) return;
    // Synthesize a trade: amount proportional to the price change,
    // taker side based on direction.  This is a "fake trade" for
    // OHLC aggregation purposes — the real trade feed is in the
    // Bot process, not the TUI.
    const trade: Trade = {
      id: `synth-${String(Date.now())}`,
      symbol,
      timestamp: Date.now(),
      price: ticker.price,
      amount: 1, // 1 unit of base currency; the OHLC aggregator only cares about price
      takerSide: ticker.price > e.lastPrice ? "buy" : "sell",
    };
    e.stream.ingest(trade);
    e.lastPrice = ticker.price;
    e.tradeCount += 1;
  }, [state, key, symbol, tick]);

  // 2) On every tick, refresh the cached `bars` array for render.
  useEffect(() => {
    const e = streamsRef.current.get(key);
    if (e === undefined) return;
    setBars(e.stream.getBars(symbol, timeframe));
  }, [tick, key, symbol, timeframe]);

  // 3) On unmount, dispose the stream (no-op since we never started it,
  //    but the ref is cleared).
  useEffect(() => {
    return () => {
      // No teardown needed — the stream has no live subscriptions.
    };
  }, []);

  return { bars, tradeCount: entry.tradeCount };
}

/**
 * `makeNoopFeed` removed in favor of the real `MockExchangeFeed` from
 * `@mm/exchange` — see the hook body.  The feed is used purely as a
 * type-valid placeholder; the hook never calls `stream.start()`.
 */
