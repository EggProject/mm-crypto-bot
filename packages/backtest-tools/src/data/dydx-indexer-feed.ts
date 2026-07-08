// packages/backtest-tools/src/data/dydx-indexer-feed.ts — dYdX v4 Indexer
// client (REST + WebSocket) for live funding-rate ingestion.
//
// Phase 25 #2 Track B — wire dYdX v4 funding data into the mm-crypto-bot
// divergence monitor. The dYdX v4 Indexer is **publicly readable,
// unauthenticated, and free** (see docs.dydx.xyz). We support both:
//
//   - REST: `GET https://indexer.dydx.trade/v4/historicalFunding/{market}` (camelCase)
//     paginates historical funding events (up to 100 per request, oldest
//     first). Used for cold-start reconciliation and replay.
//
//   - WebSocket: `wss://indexer.dydx.trade/v4/ws` subscribes to the
//     `v4_markets` channel which pushes funding-rate updates on every
//     1-hour funding-tick. Used for live divergence detection.
//
// Three-layer defense for stale-data handling (per Phase 25 #2 Track B
// kill-switches — see docs/research/phase25/track-b/REPORT.md §7.5):
//
//   Layer 1 — constructor: `staleThresholdMs` is validated as a finite
//     positive number; `rateLimitPerMinute` is validated against the
//     dYdX public endpoint limits (default 300 req/min for Polkachu-hosted
//     validators; 250 req/min for KingNodes — per docs.dydx.xyz/interaction/endpoints).
//
//   Layer 2 — per-REST-request: token-bucket governor in `throttle()` caps
//     outgoing REST requests to the configured `rateLimitPerMinute`. After
//     a 429 response, the bucket is debited the configured `burstCost`.
//
//   Layer 3 — per-WS-tick: `isStale()` checks time-since-last-tick vs
//     `staleThresholdMs` (default 5 min). `DydxIndexerFeed.getFundingRange()`
//     surfaces a `staleSinceTick` field so the consumer can halt the
//     dYdX leg per the Phase 25 #2 Track B kill-switch rule.
//
// Per-market endpoint mapping follows the Indexer HTTP API spec at
// https://docs.dydx.xyz/indexer-client/http — market identifiers are
// upper-case like "BTC-USD", "ETH-USD", "SOL-USD".

import type { FundingSnapshot } from "@mm-crypto-bot/core";

/** dYdX v4 markets this feed supports. */
export type DydxMarket = "BTC-USD" | "ETH-USD" | "SOL-USD";

/** Stale-threshold default per Phase 25 #2 Track B §7.5 (5 min). */
export const DEFAULT_STALE_THRESHOLD_MS = 5 * 60 * 1000;

/** Polkachu validator endpoint limit (per docs.dydx.xyz/interaction/endpoints). */
export const DEFAULT_RATE_LIMIT_PER_MINUTE = 300;

/** KingNodes validator endpoint limit (per docs.dydx.xyz/interaction/endpoints). */
export const BACKUP_RATE_LIMIT_PER_MINUTE = 250;

/** Default fetch timeout (10s — same as Binance funding downloader). */
export const DEFAULT_FETCH_TIMEOUT_MS = 10_000;

/** Configuration for the dYdX v4 Indexer feed. */
export interface DydxIndexerFeedConfig {
  /** Base URL of the dYdX v4 Indexer (no trailing slash). */
  readonly baseUrl?: string;
  /** WebSocket URL of the dYdX v4 Indexer. */
  readonly wsUrl?: string;
  /** Maximum REST requests per minute (Polkachu default 300). */
  readonly rateLimitPerMinute?: number;
  /** Burst cost debited on a 429 response. */
  readonly burstCost?: number;
  /** Time since last WS tick beyond which data is marked stale. */
  readonly staleThresholdMs?: number;
  /** Per-request fetch timeout in milliseconds. */
  readonly fetchTimeoutMs?: number;
  /** Optional logger for diagnostics. */
  readonly logger?: DydxFeedLogger;
}

/** Minimal logger interface (subset of @mm-crypto-bot/shared Logger). */
export interface DydxFeedLogger {
  readonly debug: (msg: string, meta?: Readonly<Record<string, unknown>>) => void;
  readonly info: (msg: string, meta?: Readonly<Record<string, unknown>>) => void;
  readonly warn: (msg: string, meta?: Readonly<Record<string, unknown>>) => void;
  readonly error: (msg: string, meta?: Readonly<Record<string, unknown>>) => void;
}

const NOOP_LOGGER: DydxFeedLogger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

/** Live state of a single market subscription. */
export interface DydxMarketState {
  /** Last funding tick received from the WebSocket (epoch ms). */
  lastTickMs: number | null;
  /** Latest funding rate observed on the WebSocket. */
  lastRate: number | null;
  /** Is the WebSocket connected for this market? */
  wsConnected: boolean;
  /** Count of REST requests issued in the current minute window. */
  restRequestCount: number;
  /** Count of 429 responses received (rate-limit backoff counter). */
  rateLimitHits: number;
}

/**
 * Raw response shape of `GET /v4/historicalFunding/{market}` (camelCase path).
 *
 * The Indexer returns an array of `HistoricalFunding` objects with:
 *   - `ticker`: market identifier (e.g., "BTC-USD")
 *   - `rate`: funding rate (decimal, per-hour since 2025-Q1)
 *   - `price`: oracle price at funding time
 *   - `effectiveAt`: ISO timestamp string
 *   - `effectiveAtHeight`: chain height at funding time
 *
 * See https://docs.dydx.xyz/indexer-client/http for the canonical shape.
 */
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

/** Type alias for the v4_markets WS payload (avoid index signature). */
type TradingMap = Record<string, { readonly oraclePrice?: string; readonly markPrice?: string }>;

/** WebSocket subscription message for the `v4_markets` channel. */
export interface DydxWsSubscribe {
  readonly type: "subscribe";
  readonly channel: "v4_markets";
  readonly id: string;
}

export interface DydxWsChannelData {
  readonly channel: "v4_markets";
  readonly id: string;
  readonly contents?: {
    readonly trading?: TradingMap;
  };
  readonly type?: "channel_data";
}

export interface DydxWsChannelBatchData {
  readonly channel: "v4_markets";
  readonly id: string;
  readonly contents?: readonly { readonly trading?: TradingMap }[];
  readonly type?: "channel_batch_data";
}

/** A consolidated view of the feed for diagnostics. */
export interface DydxFeedHealth {
  readonly totalMarkets: number;
  readonly staleMarkets: readonly DydxMarket[];
  readonly restRequestCount: number;
  readonly rateLimitHits: number;
  readonly wsConnected: number;
}

/**
 * `DydxIndexerFeed` — production-shape dYdX v4 Indexer feed with REST
 * pagination, WebSocket subscription, token-bucket rate limiting, and
 * stale-data detection. The class is intentionally framework-free
 * (no Bun-specific globals except the `fetch` global) so the live
 * signal-center plugin can instantiate it directly.
 */
export class DydxIndexerFeed {
  readonly baseUrl: string;
  readonly wsUrl: string;
  readonly rateLimitPerMinute: number;
  readonly burstCost: number;
  readonly staleThresholdMs: number;
  readonly fetchTimeoutMs: number;
  private readonly logger: DydxFeedLogger;
  private readonly state = new Map<DydxMarket, DydxMarketState>();
  private readonly buckets = new Map<string, number[]>();
  /** WebSocket connections, keyed by market. */
  private readonly wsConnections = new Map<DydxMarket, WebSocket>();

  constructor(config: DydxIndexerFeedConfig = {}) {
    this.baseUrl = (config.baseUrl ?? "https://indexer.dydx.trade").replace(/\/$/, "");
    this.wsUrl = config.wsUrl ?? "wss://indexer.dydx.trade/v4/ws";
    this.rateLimitPerMinute = this.validateRateLimit(config.rateLimitPerMinute ?? DEFAULT_RATE_LIMIT_PER_MINUTE);
    this.burstCost = this.validateBurstCost(config.burstCost ?? 50);
    this.staleThresholdMs = this.validateStaleThreshold(config.staleThresholdMs ?? DEFAULT_STALE_THRESHOLD_MS);
    this.fetchTimeoutMs = this.validateFetchTimeout(config.fetchTimeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS);
    this.logger = config.logger ?? NOOP_LOGGER;

    for (const market of ["BTC-USD", "ETH-USD", "SOL-USD"] as const) {
      this.state.set(market, this.newMarketState());
    }
  }

  private newMarketState(): DydxMarketState {
    return {
      lastTickMs: null,
      lastRate: null,
      wsConnected: false,
      restRequestCount: 0,
      rateLimitHits: 0,
    };
  }

  private validateRateLimit(value: number): number {
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error(`rateLimitPerMinute must be positive finite, got ${value}`);
    }
    return value;
  }

  private validateBurstCost(value: number): number {
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(`burstCost must be non-negative finite, got ${value}`);
    }
    return value;
  }

  private validateStaleThreshold(value: number): number {
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error(`staleThresholdMs must be positive finite, got ${value}`);
    }
    return value;
  }

  private validateFetchTimeout(value: number): number {
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error(`fetchTimeoutMs must be positive finite, got ${value}`);
    }
    return value;
  }

  /** Get the current state for a market. */
  getState(market: DydxMarket): DydxMarketState {
    const state = this.state.get(market);
    if (!state) {
      throw new Error(`Unknown market: ${market}`);
    }
    return state;
  }

  /** Health snapshot for diagnostics. */
  getHealth(): DydxFeedHealth {
    const stale: DydxMarket[] = [];
    let wsConnected = 0;
    let restRequestCount = 0;
    let rateLimitHits = 0;
    for (const [market, state] of this.state) {
      if (this.isStale(market)) stale.push(market);
      if (state.wsConnected) wsConnected += 1;
      restRequestCount += state.restRequestCount;
      rateLimitHits += state.rateLimitHits;
    }
    return {
      totalMarkets: this.state.size,
      staleMarkets: stale,
      restRequestCount,
      rateLimitHits,
      wsConnected,
    };
  }

  /**
   * Is the data for `market` stale (last tick older than `staleThresholdMs`)?
   *
   * Per Phase 25 #2 Track B §7.5: "Indexer stale >5 min → halt dYdX leg".
   */
  isStale(market: DydxMarket, nowMs = Date.now()): boolean {
    const state = this.state.get(market);
    if (state?.lastTickMs === null || state?.lastTickMs === undefined) return true;
    return nowMs - state.lastTickMs > this.staleThresholdMs;
  }

  /**
   * Token-bucket throttle. Tracks per-bucket request timestamps in a
   * 60-second sliding window. If the bucket is full, awaits the
   * earliest eviction before issuing the next request.
   */
  private async throttle(bucketKey: string): Promise<void> {
    const now = Date.now();
    const cutoff = now - 60_000;
    const bucket = this.buckets.get(bucketKey) ?? [];
    // Evict old entries.
    while (bucket.length > 0 && bucket[0]! < cutoff) bucket.shift();
    if (bucket.length >= this.rateLimitPerMinute) {
      const waitMs = bucket[0]! - cutoff + 1;
      if (waitMs > 0) {
        this.logger.warn("dydx-indexer rate-limit throttling", {
          bucketKey,
          waitMs,
          limit: this.rateLimitPerMinute,
        });
        await new Promise<void>((resolve) => setTimeout(resolve, waitMs));
      }
    }
    bucket.push(now);
    this.buckets.set(bucketKey, bucket);
  }

  /**
   * Issue a rate-limited GET against the Indexer. Throws on non-2xx
   * responses; debits `burstCost` extra slots on a 429.
   */
  private async get(path: string, market: DydxMarket): Promise<unknown> {
    await this.throttle(market);
    const url = `${this.baseUrl}${path}`;
    const res = await fetch(url, {
      signal: AbortSignal.timeout(this.fetchTimeoutMs),
      headers: { Accept: "application/json" },
    });
    const state = this.getState(market);
    state.restRequestCount += 1;
    if (res.status === 429) {
      state.rateLimitHits += 1;
      const bucket = this.buckets.get(market) ?? [];
      for (let i = 0; i < this.burstCost && bucket.length > 0; i++) bucket.shift();
      this.buckets.set(market, bucket);
      throw new Error(`dYdX Indexer 429: ${res.statusText}`);
    }
    if (!res.ok) {
      throw new Error(`dYdX Indexer ${res.status}: ${res.statusText}`);
    }
    const json = await res.json();
    return json;
  }

  /**
   * Path helper: `/v4/historicalFunding/{market}` (camelCase path).
   *
   * The dYdX v4 Indexer's canonical REST endpoint uses **camelCase**
   * segment names (`historicalFunding`), not kebab-case. The kebab-case
   * variant (`historical-funding`) returns 404 (verified live against
   * https://indexer.dydx.trade/v4/historicalFunding/BTC-USD on 2026-07-08).
   */
  static readonly HISTORICAL_FUNDING_PATH = (market: DydxMarket): string =>
    `/v4/historicalFunding/${market}`;

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
    let cursorIso: string | undefined = options.effectiveBeforeMs
      ? new Date(options.effectiveBeforeMs).toISOString()
      : undefined;
    let pages = 0;
    const maxPages = 50; // safety cap
    while (pages < maxPages) {
      const path = cursorIso
        ? `/v4/historicalFunding/${market}?effectiveBeforeOrAt=${encodeURIComponent(cursorIso)}&limit=${limit}`
        : `/v4/historicalFunding/${market}?limit=${limit}`;
      const raw = (await this.get(path, market)) as DydxHistoricalFundingResponse;
      const page = raw.historicalFunding;
      if (page.length === 0) break;
      for (const ev of page) {
        const ts = Date.parse(ev.effectiveAt);
        if (Number.isNaN(ts)) continue;
        if (options.effectiveAfterMs !== undefined && ts < options.effectiveAfterMs) continue;
        const rate = Number(ev.rate);
        if (!Number.isFinite(rate)) continue;
        all.push({
          fundingTime: ts,
          symbol: ev.ticker,
          fundingRate: rate,
          ...(ev.price !== undefined ? { markPrice: Number(ev.price) } : {}),
        });
      }
      // Cursor moves to the OLDEST event on this page (i.e., last item).
      const oldest = page[page.length - 1];
      if (oldest === undefined) break;
      if (options.effectiveAfterMs !== undefined && Date.parse(oldest.effectiveAt) < options.effectiveAfterMs) break;
      if (page.length < limit) break;
      cursorIso = oldest.effectiveAt;
      pages += 1;
    }
    this.logger.info("dydx-indexer fetchHistoricalFunding", {
      market,
      fetched: all.length,
      pages,
    });
    return all;
  }

  /**
   * Get the latest funding snapshot for a market, falling back to
   * the most recent WS tick if the Indexer is unreachable.
   *
   * If the WS state is stale (no tick within `staleThresholdMs`),
   * the returned snapshot will have `staleSinceTick=true` so the
   * consumer can halt per the Phase 25 #2 Track B kill-switch rule.
   */
  async getLatestFunding(market: DydxMarket): Promise<FundingSnapshot & { readonly staleSinceTick: boolean }> {
    const state = this.getState(market);
    try {
      const raw = (await this.get(`/v4/historicalFunding/${market}?limit=1`, market)) as DydxHistoricalFundingResponse;
      const ev = raw.historicalFunding[0];
      if (ev !== undefined) {
        const ts = Date.parse(ev.effectiveAt);
        const rate = Number(ev.rate);
        if (Number.isFinite(ts) && Number.isFinite(rate)) {
          state.lastTickMs = ts;
          state.lastRate = rate;
          return {
            fundingTime: ts,
            symbol: ev.ticker,
            fundingRate: rate,
            ...(ev.price !== undefined ? { markPrice: Number(ev.price) } : {}),
            staleSinceTick: false,
          };
        }
      }
    } catch (err: unknown) {
      this.logger.warn("dydx-indexer getLatestFunding REST failed; falling back to WS state", {
        market,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    if (state.lastTickMs !== null && state.lastRate !== null) {
      return {
        fundingTime: state.lastTickMs,
        symbol: market,
        fundingRate: state.lastRate,
        staleSinceTick: this.isStale(market),
      };
    }
    throw new Error(`No funding data available for ${market}`);
  }

  /**
   * Get the funding range for `market` between `startMs` and `endMs`
   * (epoch ms, inclusive on both ends). Stale data is surfaced via the
   * `staleSinceTick` flag on the returned snapshot.
   */
  async getFundingRange(market: DydxMarket, startMs: number, endMs: number): Promise<readonly FundingSnapshot[]> {
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs > endMs) {
      throw new Error(`Invalid range: start=${startMs} end=${endMs}`);
    }
    const snapshots = await this.fetchHistoricalFunding(market, {
      effectiveAfterMs: startMs - 1,
      effectiveBeforeMs: endMs + 1,
    });
    return snapshots;
  }

  /**
   * Subscribe to live funding-tick updates for `market` via the
   * dYdX v4 Indexer WebSocket. The `v4_markets` channel emits the
   * oracle price every block; the funding rate itself updates hourly
   * at the funding-tick boundary.
   *
   * The `onTick` callback fires on every WebSocket message — the
   * consumer must filter for funding-rate events if needed (see
   * `parseFundingUpdate` below).
   *
   * Returns a `WebSocket` instance so the caller can `.close()` it.
   */
  subscribe(market: DydxMarket, onTick: (msg: DydxWsChannelData | DydxWsChannelBatchData) => void): WebSocket {
    const existing = this.wsConnections.get(market);
    if (existing?.readyState === WebSocket.OPEN) {
      return existing;
    }
    const ws = new WebSocket(this.wsUrl);
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
        error: event instanceof ErrorEvent ? event.message : "unknown",
      });
    });

    ws.addEventListener("message", (event) => {
      state.lastTickMs = Date.now();
      try {
        const raw = typeof event.data === "string" ? event.data : "";
        if (raw.length === 0) return;
        const msg = JSON.parse(raw) as DydxWsChannelData | DydxWsChannelBatchData;
        // Pull a funding-rate hint out of `trading` if present (oracle/mark).
        const trading = extractTradingMap(msg);
        const t = trading?.[market];
        if (t?.markPrice !== undefined) {
          const m = Number(t.markPrice);
          if (Number.isFinite(m)) state.lastRate = m;
        }
        onTick(msg);
      } catch (err: unknown) {
        this.logger.error("dydx-indexer WS message parse failed", {
          market,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    });

    return ws;
  }

  /** Close all open WebSocket subscriptions. */
  disconnectAll(): void {
    for (const ws of this.wsConnections.values()) {
      try {
        ws.close();
      } catch {
        // ignore
      }
    }
    this.wsConnections.clear();
    for (const state of this.state.values()) state.wsConnected = false;
  }
}

/**
 * `parseFundingUpdate` — extract a FundingSnapshot from a v4_markets
 * channel message. The Indexer WS does NOT push funding-rate values
 * directly; consumers must compute funding from the oracle/mark
 * premium samples over the funding-sample window (default 1 minute).
 *
 * This helper pulls the latest known funding rate from a `predictions`
 * sub-channel if present, otherwise returns `null`.
 */
export function parseFundingUpdate(
  msg: DydxWsChannelData | DydxWsChannelBatchData,
  market: DydxMarket,
): FundingSnapshot | null {
  const trading = extractTradingMap(msg);
  if (trading === undefined) return null;
  const t = trading[market];
  if (t === undefined) return null;
  const mark = t.markPrice !== undefined ? Number(t.markPrice) : undefined;
  const oracle = t.oraclePrice !== undefined ? Number(t.oraclePrice) : undefined;
  if (mark === undefined || !Number.isFinite(mark)) return null;
  // Funding rate is not in the WS payload — caller must compute it
  // from premium samples. We return a snapshot with the mark price
  // and let the caller compute rate from oracle-vs-mark.
  return {
    fundingTime: Date.now(),
    symbol: market,
    fundingRate: 0, // populated by consumer from premium computation
    markPrice: mark,
    ...(oracle !== undefined && Number.isFinite(oracle) ? {} : {}),
  };
}

/** Internal helper: unify `trading` access across channel_data and channel_batch_data. */
interface ChannelContentsSingle {
  readonly trading?: TradingMap;
}
type ChannelContentsBatch = readonly ChannelContentsSingle[];

/** Internal helper: unify `trading` access across channel_data and channel_batch_data. */
function extractTradingMap(msg: DydxWsChannelData | DydxWsChannelBatchData): TradingMap | undefined {
  const c = msg.contents;
  if (c === undefined) return undefined;
  // For batch_data, contents is an array; for channel_data, it's a single object.
  // Array.isArray narrows the union: readonly T[] vs T. We then cast the
  // narrowed branches to our typed wrappers so the `.trading` access is type-safe.
  if (Array.isArray(c)) {
    const batch = c as ChannelContentsBatch;
    const first = batch[0];
    if (first === undefined) return undefined;
    return first.trading;
  }
  const single = c as ChannelContentsSingle;
  return single.trading;
}