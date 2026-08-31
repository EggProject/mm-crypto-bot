import type { FundingSnapshot } from "@mm-crypto-bot/core";
import type { ExactRational } from "@mm-crypto-bot/numeric";

import {
  historicalFundingRows,
  historicalFundingSnapshot,
  parseIndexerWsMessage,
  validateIndexerFetchResponse,
  websocketErrorMessage,
  websocketText,
  type DydxHistoricalFundingRow,
  type DydxIndexerFetchPage,
  type DydxIndexerWebSocket,
  type DydxIndexerWebSocketFactory,
  type DydxTradingMap,
} from "./dydx-indexer-funding.js";

export { parseFundingUpdate } from "./dydx-indexer-funding.js";

export type DydxMarket = "BTC-USD" | "ETH-USD" | "SOL-USD";
export const DEFAULT_STALE_THRESHOLD_MS = 5 * 60 * 1000;
export const DEFAULT_RATE_LIMIT_PER_MINUTE = 300;
export const BACKUP_RATE_LIMIT_PER_MINUTE = 250;
export const DEFAULT_FETCH_TIMEOUT_MS = 10_000;
export interface DydxIndexerFeedConfig {
  readonly fetchPage?: DydxIndexerFetchPage;
  readonly now?: () => number;
  readonly webSocketFactory?: DydxIndexerWebSocketFactory;
  readonly baseUrl?: string;
  readonly wsUrl?: string;
  readonly rateLimitPerMinute?: number;
  readonly burstCost?: number;
  readonly staleThresholdMs?: number;
  readonly fetchTimeoutMs?: number;
  readonly logger?: DydxFeedLogger;
}
export interface DydxFeedLogger {
  readonly debug: (message: string, meta?: Readonly<Record<string, unknown>>) => void;
  readonly info: (message: string, meta?: Readonly<Record<string, unknown>>) => void;
  readonly warn: (message: string, meta?: Readonly<Record<string, unknown>>) => void;
  readonly error: (message: string, meta?: Readonly<Record<string, unknown>>) => void;
}

const NOOP_LOGGER: DydxFeedLogger = {
  debug: () => { void 0; },
  info: () => { void 0; },
  warn: () => { void 0; },
  error: () => { void 0; },
};

const defaultFetchPage: DydxIndexerFetchPage = async ({ url, timeoutMs }) =>
  fetch(url, {
    signal: AbortSignal.timeout(timeoutMs),
    headers: { Accept: "application/json" },
  });
const defaultWebSocketFactory: DydxIndexerWebSocketFactory = (url) => new WebSocket(url);
const MARKETS: readonly DydxMarket[] = ["BTC-USD", "ETH-USD", "SOL-USD"];

export interface DydxMarketState {
  lastTickMs: number | undefined;
  lastRate: ExactRational | undefined;
  wsConnected: boolean;
  restRequestCount: number;
  rateLimitHits: number;
}

export interface DydxHistoricalFunding {
  readonly ticker: string;
  readonly rate: string;
  readonly price?: string;
  readonly effectiveAt: string;
  readonly effectiveAtHeight?: string;
}

export interface DydxHistoricalFundingResponse {
  readonly historicalFunding: readonly DydxHistoricalFunding[];
}

/**
Type alias for the v4_markets WS payload (avoid index signature).
*/
/**
WebSocket subscription message for the `v4_markets` channel.
*/
export interface DydxWsSubscribe {
  readonly type: "subscribe";
  readonly channel: "v4_markets";
  readonly id: string;
}

export interface DydxWsChannelData {
  readonly channel: "v4_markets";
  readonly id: string;
  readonly contents?: {
    readonly trading?: DydxTradingMap;
  };
  readonly type?: "channel_data";
}

export interface DydxWsChannelBatchData {
  readonly channel: "v4_markets";
  readonly id: string;
  readonly contents?: readonly { readonly trading?: DydxTradingMap }[];
  readonly type?: "channel_batch_data";
}

/**
A consolidated view of the feed for diagnostics.
*/
export interface DydxFeedHealth {
  readonly totalMarkets: number;
  readonly staleMarkets: readonly DydxMarket[];
  readonly restRequestCount: number;
  readonly rateLimitHits: number;
  readonly wsConnected: number;
}

export class DydxIndexerFeed {
  static readonly HISTORICAL_FUNDING_PATH = (market: DydxMarket): string =>
    `/v4/historicalFunding/${market}`;

  private readonly logger: DydxFeedLogger;
  private readonly btcState: DydxMarketState;
  private readonly ethState: DydxMarketState;
  private readonly solState: DydxMarketState;
  private readonly buckets = new Map<string, number[]>();
  private readonly wsConnections = new Map<DydxMarket, DydxIndexerWebSocket>();
  private readonly fetchPage: DydxIndexerFetchPage;
  private readonly now: () => number;
  private readonly webSocketFactory: DydxIndexerWebSocketFactory;
  readonly baseUrl: string;
  readonly wsUrl: string;
  readonly rateLimitPerMinute: number;
  readonly burstCost: number;
  readonly staleThresholdMs: number;
  readonly fetchTimeoutMs: number;

  constructor(config: DydxIndexerFeedConfig = {}) {
    this.baseUrl = (config.baseUrl ?? "https://indexer.dydx.trade").replace(/\/$/, "");
    this.wsUrl = config.wsUrl ?? "wss://indexer.dydx.trade/v4/ws";
    this.rateLimitPerMinute = this.validateRateLimit(config.rateLimitPerMinute ?? DEFAULT_RATE_LIMIT_PER_MINUTE);
    this.burstCost = this.validateBurstCost(config.burstCost ?? 50);
    this.staleThresholdMs = this.validateStaleThreshold(config.staleThresholdMs ?? DEFAULT_STALE_THRESHOLD_MS);
    this.fetchTimeoutMs = this.validateFetchTimeout(config.fetchTimeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS);
    this.logger = config.logger ?? NOOP_LOGGER;
    this.fetchPage = config.fetchPage ?? defaultFetchPage;
    this.now = config.now ?? Date.now;
    this.webSocketFactory = config.webSocketFactory ?? defaultWebSocketFactory;

    this.btcState = this.newMarketState();
    this.ethState = this.newMarketState();
    this.solState = this.newMarketState();
    // Phase 35b — logger.debug is part of the logger interface
    // contract (callers wire it for verbose tracing). Use it here so
    // the default NOOP_LOGGER.debug is exercised on every
    // instantiation.
    this.logger.debug("DydxIndexerFeed constructed", {
      baseUrl: this.baseUrl,
      wsUrl: this.wsUrl,
      rateLimitPerMinute: this.rateLimitPerMinute,
      staleThresholdMs: this.staleThresholdMs,
    });
  }

  private newMarketState(): DydxMarketState {
    return {
      lastTickMs: undefined,
      lastRate: undefined,
      wsConnected: false,
      restRequestCount: 0,
      rateLimitHits: 0,
    };
  }

  private stateFor(market: string): DydxMarketState {
    switch (market) {
      case "BTC-USD": {
        return this.btcState;
      }
      case "ETH-USD": {
        return this.ethState;
      }
      case "SOL-USD": {
        return this.solState;
      }
    }
    throw new Error(`Unknown dYdX market: ${market}`);
  }

  private validateRateLimit(value: number): number {
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error(`rateLimitPerMinute must be positive finite, got ${String(value)}`);
    }
    return value;
  }

  private validateBurstCost(value: number): number {
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(`burstCost must be non-negative finite, got ${String(value)}`);
    }
    return value;
  }

  private validateStaleThreshold(value: number): number {
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error(`staleThresholdMs must be positive finite, got ${String(value)}`);
    }
    return value;
  }

  private validateFetchTimeout(value: number): number {
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error(`fetchTimeoutMs must be positive finite, got ${String(value)}`);
    }
    return value;
  }

  /**
   * Token-bucket throttle. Tracks per-bucket request timestamps in a
   * 60-second sliding window. If the bucket is full, awaits the
   * earliest eviction before issuing the next request.
   */
  private async throttle(bucketKey: string): Promise<number[]> {
    const now = this.now();
    const cutoff = now - 60_000;
    const bucket = this.buckets.get(bucketKey) ?? [];
    // Evict old entries.
    while (bucket.length > 0) {
      const oldest = bucket.at(0);
      if (oldest === undefined || oldest >= cutoff) break;
      bucket.shift();
    }
    if (bucket.length >= this.rateLimitPerMinute) {
      let oldest = 0;
      for (const timestamp of bucket) {
        oldest = timestamp;
        break;
      }
      const waitMs = oldest - cutoff + 1;
      this.logger.warn("dydx-indexer rate-limit throttling", {
        bucketKey,
        waitMs,
        limit: this.rateLimitPerMinute,
      });
      await new Promise<void>((resolve) => setTimeout(resolve, waitMs));
    }
    bucket.push(now);
    this.buckets.set(bucketKey, bucket);
    return bucket;
  }

  /**
   * Issue a rate-limited GET against the Indexer. Throws on non-2xx
   * responses; debits `burstCost` extra slots on a 429.
   */
  private async get(path: string, market: DydxMarket): Promise<unknown> {
    const bucket = await this.throttle(market);
    const url = `${this.baseUrl}${path}`;
    const response = validateIndexerFetchResponse(
      await this.fetchPage(Object.freeze({ url, timeoutMs: this.fetchTimeoutMs })),
    );
    const state = this.getState(market);
    state.restRequestCount += 1;
    if (response.status === 429) {
      state.rateLimitHits += 1;
      for (let index = 0; index < this.burstCost && bucket.length > 0; index++) bucket.shift();
      this.buckets.set(market, bucket);
      throw new Error(`dYdX Indexer 429: ${response.statusText}`);
    }
    if (!response.ok) {
      throw new Error(`dYdX Indexer ${String(response.status)}: ${response.statusText}`);
    }
    const json = await response.json();
    return json;
  }

  /**
   * Is the data for `market` stale (last tick older than `staleThresholdMs`)?
   *
   * Per Phase 25 #2 Track B §7.5: "Indexer stale >5 min → halt dYdX leg".
   */
  isStale(market: DydxMarket, nowMs = this.now()): boolean {
    const state = this.stateFor(market);
    if (state.lastTickMs === undefined) return true;
    return nowMs - state.lastTickMs > this.staleThresholdMs;
  }

  /**
  Get the current state for a market.
  */
  getState(market: DydxMarket): DydxMarketState {
    return this.stateFor(market);
  }

  /**
  Health snapshot for diagnostics.
  */
  getHealth(): DydxFeedHealth {
    const stale: DydxMarket[] = [];
    let wsConnected = 0;
    let restRequestCount = 0;
    let rateLimitHits = 0;
    for (const market of MARKETS) {
      const state = this.stateFor(market);
      if (this.isStale(market)) stale.push(market);
      if (state.wsConnected) wsConnected += 1;
      restRequestCount += state.restRequestCount;
      rateLimitHits += state.rateLimitHits;
    }
    return {
      totalMarkets: MARKETS.length,
      staleMarkets: stale,
      restRequestCount,
      rateLimitHits,
      wsConnected,
    };
  }

  /**
   * Fetch historical funding for `market` from the Indexer, paginated
   * until `effectiveBeforeMs` or `effectiveAfterMs` is reached.
   *
   * The Indexer returns at most 100 events per request, oldest first.
   * We walk forward until `effectiveAfterMs` is hit, or no more pages.
   */
  async fetchHistoricalFunding(
    market: DydxMarket,
    options: { readonly effectiveBeforeMs?: number; readonly effectiveAfterMs?: number; readonly limit?: number } = {},
  ): Promise<readonly FundingSnapshot[]> {
    const limit = options.limit ?? 100;
    const all: FundingSnapshot[] = [];
    const seenIdentities = new Set<string>();
    let cursorIso: string | undefined = options.effectiveBeforeMs
      ? new Date(options.effectiveBeforeMs).toISOString()
      : undefined;
    let pages = 0;
    const maxPages = 50; // safety cap
    while (pages < maxPages) {
      pages += 1;
      const path = cursorIso
        ? `/v4/historicalFunding/${market}?effectiveBeforeOrAt=${encodeURIComponent(cursorIso)}&limit=${String(limit)}`
        : `/v4/historicalFunding/${market}?limit=${String(limit)}`;
      const page = historicalFundingRows(await this.get(path, market));
      if (page.length === 0) break;
      const identityCountBeforePage = seenIdentities.size;
      for (const event of page) {
        const identity = historicalFundingIdentity(event);
        if (!seenIdentities.has(identity)) {
          seenIdentities.add(identity);
          const snapshot = historicalFundingSnapshot(event, options.effectiveAfterMs);
          if (snapshot !== undefined) all.push(snapshot);
        }
      }
      if (seenIdentities.size === identityCountBeforePage)
        throw new Error("dYdX Indexer historical funding pagination made no progress");
      let oldestMs = Infinity;
      for (const event of page) {
        const effectiveAtMs = Date.parse(event.effectiveAt);
        if (!Number.isFinite(effectiveAtMs))
          throw new Error(`dYdX Indexer historical funding has invalid effectiveAt: ${event.effectiveAt}`);
        oldestMs = Math.min(oldestMs, effectiveAtMs);
      }
      if (options.effectiveAfterMs !== undefined && oldestMs < options.effectiveAfterMs) break;
      if (page.length < limit) break;
      cursorIso = new Date(oldestMs - 1).toISOString();
    }
    if (pages === maxPages) throw new Error("dYdX Indexer historical funding exceeded the page limit");
    this.logger.info("dydx-indexer fetchHistoricalFunding", {
      market,
      fetched: all.length,
      pages,
    });
    return all;
  }

  async getLatestFunding(market: DydxMarket): Promise<FundingSnapshot & { readonly staleSinceTick: boolean }> {
    const state = this.getState(market);
    try {
      const events = historicalFundingRows(await this.get(`/v4/historicalFunding/${market}?limit=1`, market));
      const event = events.at(0);
      if (event !== undefined) {
        const snapshot = historicalFundingSnapshot(event, undefined);
        if (snapshot !== undefined) {
          state.lastTickMs = snapshot.fundingTime;
          state.lastRate = snapshot.fundingRate;
          return {
            ...snapshot,
            staleSinceTick: false,
          };
        }
      }
    } catch (error: unknown) {
      this.logger.warn("dydx-indexer getLatestFunding REST failed; falling back to WS state", {
        market,
        error: String(error),
      });
    }
    if (state.lastTickMs !== undefined && state.lastRate !== undefined) {
      return {
        fundingTime: state.lastTickMs,
        symbol: market,
        fundingRate: state.lastRate,
        staleSinceTick: this.isStale(market),
      };
    }
    throw new Error(`No funding data available for ${market}`);
  }

  async getFundingRange(market: DydxMarket, startMs: number, endMs: number): Promise<readonly FundingSnapshot[]> {
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs > endMs) {
      throw new Error(`Invalid range: start=${String(startMs)} end=${String(endMs)}`);
    }
    const snapshots = await this.fetchHistoricalFunding(market, {
      effectiveAfterMs: startMs - 1,
      effectiveBeforeMs: endMs + 1,
    });
    return snapshots;
  }

  subscribe(
    market: DydxMarket,
    onTick: (message: DydxWsChannelData | DydxWsChannelBatchData) => void,
  ): DydxIndexerWebSocket {
    const existing = this.wsConnections.get(market);
    if (existing?.readyState === 1) {
      return existing;
    }
    const ws = this.webSocketFactory(this.wsUrl);
    this.wsConnections.set(market, ws);
    const state = this.getState(market);

    ws.addEventListener("open", () => {
      state.wsConnected = true;
      const sub: DydxWsSubscribe = {
        type: "subscribe",
        channel: "v4_markets",
        id: market,
      };
      ws.send(JSON.stringify(sub));
      this.logger.info("dydx-indexer WS connected", { market });
    });

    ws.addEventListener("close", () => {
      state.wsConnected = false;
      this.logger.warn("dydx-indexer WS closed", { market });
    });

    ws.addEventListener("error", (event) => {
      state.wsConnected = false;
      this.logger.error("dydx-indexer WS error", {
        market,
        error: websocketErrorMessage(event),
      });
    });

    ws.addEventListener("message", (event) => {
      state.lastTickMs = this.now();
      try {
        const raw = websocketText(event);
        if (raw.length === 0) return;
        const message = parseIndexerWsMessage(JSON.parse(raw));
        if (message === undefined) throw new Error("Invalid dYdX Indexer WS message");
        onTick(message);
      } catch (error: unknown) {
        this.logger.error("dydx-indexer WS message parse failed", {
          market,
          error: String(error),
        });
      }
    });

    return ws;
  }

  /**
  Close all open WebSocket subscriptions.
  */
  disconnectAll(): void {
    for (const ws of this.wsConnections.values()) {
      try {
        ws.close();
      } catch {
        // ignore
      }
    }
    this.wsConnections.clear();
    for (const market of MARKETS) this.stateFor(market).wsConnected = false;
  }
}

function historicalFundingIdentity(event: DydxHistoricalFundingRow): string {
  return `${event.ticker}\u{0}${event.effectiveAt}\u{0}${event.rate}\u{0}${event.price ?? ""}`;
}
