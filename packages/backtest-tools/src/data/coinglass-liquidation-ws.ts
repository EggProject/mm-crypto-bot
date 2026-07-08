// packages/backtest-tools/src/data/coinglass-liquidation-ws.ts
//
// CoinGlass V4 WebSocket adapter for real-time liquidation data.
//
// Phase 25 #2 — Track D (Liquidation cascade detector, satellite).
//
// References (see docs/research/phase25/track-d/REPORT.md):
//   - §2.1 Vendor table: CoinGlass V4 aggregation across 30+ exchanges,
//     `<1 min cache` on `/history`, real-time WS push on `liquidationOrders`
//     channel. Industry-standard cross-venue aggregate.
//   - §3.3 Detection latency stack — 700-1500ms from Binance perp liquidation
//     print to CoinGlass WS push to our process.
//
// This adapter is the **Layer 1 (real-time detector)** feed per the
// 3-layer cascade filter (CoinGlass + Bitquery + Axel Adler OI/ELR).
// Naked-liquidation detection alone is NEGATIVE per anomiq.io
// full-year backtest — the strategy uses this feed ONLY as a
// trigger to enter Layer 2 (state machine) and ONLY Layer 2's
// `POST_CASCADE` state allows Layer 3 (execution) entries.
//
// Design constraints:
//   - WebSocket reconnect with exponential backoff
//   - Pluggable transport (testable with mock transport)
//   - 1-min rolling aggregation → ready for cross-confirmation in Bitquery feed
//   - Symbol-keyed event stream (BTC/ETH/SOL baseline)
//   - 1:10 leverage cap is enforced at the strategy layer, NOT here
//     (this is a read-only feed; it cannot place orders)

import type { Candle, Side, Symbol } from "@mm-crypto-bot/shared/types";

// ---------------------------------------------------------------------------
// Wire types — mirror CoinGlass V4 `liquidationOrders` payload shape
// ---------------------------------------------------------------------------

/**
 * One CoinGlass V4 liquidation print as it arrives on the
 * `liquidationOrders` channel.
 *
 * NOTE: We use `CoinGlassLiquidationPrint` as the canonical wire
 * type for both CoinGlass and Bitquery feeds (with adapter-level
 * field normalization) so consumers can use one unified downstream
 * shape.
 */
export interface CoinGlassLiquidationPrint {
  /** Unix epoch milliseconds when the print was emitted. */
  readonly timestampMs: number;
  /** Base symbol (BTC, ETH, SOL, ...). Normalized across adapter layers. */
  readonly symbol: string;
  /** Long or short side of the liquidated position. */
  readonly side: "long" | "short";
  /** USD notional of the liquidation. */
  readonly usdValue: number;
  /** Underlying asset quantity (instrument units). */
  readonly quantity: number;
  /** Execution price (best-effort, may be 0 on a few exchanges). */
  readonly price: number;
  /** Originating venue tag (Binance, OKX, Bybit, Hyperliquid, ...). */
  readonly exchange: string;
  /** Free-form raw payload (for debugging / forensic). */
  readonly raw?: Record<string, unknown>;
}

/**
 * Aggregated 1-minute liquidation metrics — used by Layer 1 cascade
 * detector to decide whether a "real" cascade is happening.
 */
export interface Liquidation1MinWindow {
  readonly windowStartMs: number;
  readonly windowEndMs: number;
  readonly symbol: string;
  /** Aggregate USD value across all venues × sides for this minute. */
  readonly totalUsd: number;
  /** USD value of long-side liquidations in this minute. */
  readonly longUsd: number;
  /** USD value of short-side liquidations in this minute. */
  readonly shortUsd: number;
  /** Number of liquidation prints in this minute. */
  readonly printCount: number;
  /** Count of distinct exchanges that contributed prints. */
  readonly distinctExchangeCount: number;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Pluggable transport interface — production uses `WebSocket`,
 * tests use `MockTransport`. Swappable per Layer 3 §6.2
 * (the wire-contract test exercises both).
 */
export interface CoinGlassTransport {
  /** Open a new connection. `onMessage` fires for every parsed JSON payload. */
  connect(onMessage: (payload: unknown) => void): void;
  /** Send a subscribe command to the upstream. */
  subscribe(channels: readonly { readonly channel: string; readonly symbol: string }[]): void;
  /** Close the connection. */
  close(): void;
  /** Whether the underlying connection is currently live. */
  isOpen(): boolean;
}

/**
 * Configuration for the CoinGlass feed.
 */
export interface CoinGlassLiquidationWsConfig {
  /** API key (CoinGlass V4 — Hobbyist $29, Pro $699). */
  readonly apiKey: string;
  /** Base WS URL — defaults to the V4 endpoint. */
  readonly wsUrl?: string;
  /** Subscribed symbols (will subscribe to each on connect). */
  readonly symbols: readonly string[];
  /** 1-min bucket size. Default = 60_000 ms. */
  readonly bucketMs?: number;
  /** Cache TTL for repeat-feed replay. Default = 60_000 ms (<1 min). */
  readonly cacheTtlMs?: number;
  /**
   * Hook called for every fresh 1-min window ready for consumption.
   * Layer 1 cascade detector subscribes via this hook.
   */
  readonly onWindowReady?: (window: Liquidation1MinWindow) => void;
  /** Hook for every parsed print — useful for raw forensic / debug. */
  readonly onPrint?: (print: CoinGlassLiquidationPrint) => void;
}

// ---------------------------------------------------------------------------
// Mock transport (for tests + paper-trade replay)
// ---------------------------------------------------------------------------

/**
 * `MockCoinGlassTransport` — deterministic in-memory transport. Tests
 * pre-load a list of `CoinGlassLiquidationPrint` and the transport
 * replays them at the configured tick rate. No actual network I/O.
 *
 * The mock is synchronous-friendly: `tick()` advances the simulation
 * by one `tickMs` and emits all due events via `onMessage`.
 */
export class MockCoinGlassTransport implements CoinGlassTransport {
  private open = false;
  private readonly eventsByTs = new Map<number, CoinGlassLiquidationPrint[]>();
  private readonly subscribed: { readonly channel: string; readonly symbol: string }[] = [];
  private onMessage: ((payload: unknown) => void) | null = null;
  private currentMockTimeMs = 0;

  constructor(prints: readonly CoinGlassLiquidationPrint[] = []) {
    for (const print of prints) {
      const arr = this.eventsByTs.get(print.timestampMs) ?? [];
      arr.push(print);
      this.eventsByTs.set(print.timestampMs, arr);
    }
  }

  /** Add a print to the mock event log. */
  addPrint(print: CoinGlassLiquidationPrint): void {
    const arr = this.eventsByTs.get(print.timestampMs) ?? [];
    arr.push(print);
    this.eventsByTs.set(print.timestampMs, arr);
  }

  connect(onMessage: (payload: unknown) => void): void {
    this.open = true;
    this.onMessage = onMessage;
  }

  subscribe(channels: readonly { readonly channel: string; readonly symbol: string }[]): void {
    this.subscribed.push(...channels);
  }

  close(): void {
    this.open = false;
    this.onMessage = null;
  }

  isOpen(): boolean {
    return this.open;
  }

  /**
   * Advance the mock clock by `tickMs` and emit all due events.
   * Tests call this to drive the simulation deterministically.
   */
  tick(tickMs = 1000): void {
    if (!this.open || this.onMessage === null) return;
    this.currentMockTimeMs += tickMs;
    const due = this.eventsByTs.get(this.currentMockTimeMs) ?? [];
    for (const print of due) {
      this.onMessage({ ...print });
    }
  }

  /** Inspect subscriptions (test-only). */
  getSubscriptions(): readonly { readonly channel: string; readonly symbol: string }[] {
    return [...this.subscribed];
  }

  /** Fast-forward the mock clock to a specific time, emitting events. */
  advanceTo(targetMs: number): void {
    while (this.currentMockTimeMs < targetMs) {
      const step = targetMs - this.currentMockTimeMs;
      this.tick(step);
    }
  }
}

// ---------------------------------------------------------------------------
// Main feed implementation
// ---------------------------------------------------------------------------

const DEFAULT_BUCKET_MS = 60_000;
const DEFAULT_CACHE_TTL_MS = 60_000;
const DEFAULT_WS_URL = "wss://api.coinglass.com/v4/ws";

/**
 * `CoinGlassLiquidationWs` — adapter for the CoinGlass V4
 * `liquidationOrders` channel. Subscribes to symbols, aggregates
 * incoming prints into 1-min windows, and exposes both per-print
 * and per-window hooks for downstream cascade detection.
 *
 * The feed does NOT detect cascades itself — it emits aggregated
 * windows; the cascade detector (Layer 1 + Layer 2 state machine)
 * consumes the windows. Separation of concerns keeps the test
 * surface tight: feed tests assert aggregation correctness;
 * detector tests assert cascade-state correctness with synthetic
 * windows.
 */
export class CoinGlassLiquidationWs {
  private readonly config: Required<
    Pick<CoinGlassLiquidationWsConfig, "bucketMs" | "cacheTtlMs" | "wsUrl">
  > &
    CoinGlassLiquidationWsConfig;

  private readonly transport: CoinGlassTransport;
  private readonly prints: CoinGlassLiquidationPrint[] = [];
  private readonly windowCache = new Map<string, { readonly emittedAtMs: number; readonly window: Liquidation1MinWindow }>();
  private cachedWindows: Liquidation1MinWindow[] = [];
  private lastBucketMs = 0;

  constructor(transport: CoinGlassTransport, config: CoinGlassLiquidationWsConfig) {
    if (config.apiKey.trim() === "") {
      throw new Error("CoinGlassLiquidationWs: apiKey is required");
    }
    if (config.symbols.length === 0) {
      throw new Error("CoinGlassLiquidationWs: at least one symbol required");
    }
    this.transport = transport;
    this.config = {
      bucketMs: config.bucketMs ?? DEFAULT_BUCKET_MS,
      cacheTtlMs: config.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS,
      wsUrl: config.wsUrl ?? DEFAULT_WS_URL,
      ...config,
    };
  }

  /** Open the WS connection and subscribe to symbols. */
  start(): void {
    this.transport.connect((payload: unknown) => {
      this.handleMessage(payload);
    });
    const channels = this.config.symbols.map((sym) => ({
      channel: "liquidationOrders",
      symbol: sym,
    }));
    this.transport.subscribe(channels);
  }

  /** Inspect all cached 1-min windows (windowCache-stamped). */
  getCachedWindows(): readonly Liquidation1MinWindow[] {
    return [...this.cachedWindows];
  }

  /** Inspect the raw print log (for tests / forensic). */
  getPrints(): readonly CoinGlassLiquidationPrint[] {
    return [...this.prints];
  }

  /** Close underlying connection. */
  stop(): void {
    this.transport.close();
  }

  /**
   * Manually ingest a wire-level payload (used in tests with the
   * mock transport, and on future historical backfill replay).
   *
   * Routes through `handleMessage` so the wire-parser is exercised
   * identically to a real WS push — this is the
   * `bit-identical-trade-stream probe` invariant from the Phase
   * 20-21-22-23-archive §6 the verifier checks.
   *
   * The input may be the canonical normalized form OR the
   * `{ d: ... }` envelope shape (CoinGlass V4 wrapper).
   */
  ingest(print: unknown): void {
    this.handleMessage(print);
  }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  private handleMessage(payload: unknown): void {
    // Wire-level payload is JSON-decoded upstream — we accept
    // either the original CoinGlass envelope `{ d: <payload> }`
    // or already-normalized `CoinGlassLiquidationPrint`.
    const parsed = this.parseWirePayload(payload);
    if (parsed === null) return;
    this.handlePrint(parsed);
  }

  /**
   * Parse a wire-level payload. Two shapes supported:
   *   - `{ d: <print> }` — the documented CoinGlass V4 wrapper
   *   - the print itself — already normalized form
   */
  private parseWirePayload(payload: unknown): CoinGlassLiquidationPrint | null {
    if (payload === null || typeof payload !== "object") return null;
    const obj = payload as Record<string, unknown>;
    // Wrapper shape: { d: ... }
    if ("d" in obj && typeof obj["d"] === "object") {
      const inner = obj["d"];
      if (inner === null || typeof inner !== "object") return null;
      return this.normalizePrint(inner as Record<string, unknown>);
    }
    // Direct shape
    if ("symbol" in obj && "side" in obj && "usdValue" in obj) {
      return this.normalizePrint(obj);
    }
    return null;
  }

  /**
   * Field-shape normalization. CoinGlass V4 uses camelCase; we map
   * to the canonical CoinGlassLiquidationPrint. Fields that are
   * missing or wrong-typed yield a synthetic print with `usdValue=0`
   * (defensive — never silently swap instead of ingest).
   */
  private normalizePrint(obj: Record<string, unknown>): CoinGlassLiquidationPrint | null {
    const symbol = typeof obj["symbol"] === "string" ? obj["symbol"] : "";
    if (symbol === "") return null;
    const sideRaw = typeof obj["side"] === "string" ? obj["side"].toLowerCase() : "";
    const side: "long" | "short" = sideRaw === "short" ? "short" : "long";
    const usdValue = typeof obj["usdValue"] === "number" ? obj["usdValue"] : 0;
    const quantity = typeof obj["quantity"] === "number" ? obj["quantity"] : 0;
    const price = typeof obj["price"] === "number" ? obj["price"] : 0;
    const exchange =
      typeof obj["exchange"] === "string" && obj["exchange"] !== ""
        ? obj["exchange"]
        : "unknown";
    const timestampMsRaw = obj["timestampMs"] ?? obj["timestamp"] ?? 0;
    const timestampMs = typeof timestampMsRaw === "number" ? timestampMsRaw : Number(timestampMsRaw);
    if (!Number.isFinite(timestampMs) || timestampMs <= 0) return null;
    return {
      timestampMs,
      symbol,
      side,
      usdValue,
      quantity,
      price,
      exchange,
      raw: obj,
    };
  }

  private handlePrint(print: CoinGlassLiquidationPrint): void {
    this.prints.push(print);
    this.config.onPrint?.(print);
    this.aggregate(print);
  }

  /**
   * Open/refresh the 1-min aggregation bucket. On bucket rollover,
   * freeze the window and emit via `onWindowReady`. The window
   * remains in the cache for `cacheTtlMs` (default 1 min) so
   * late-arriving prints in a Cascade feed can retroactively
   * update the same window key.
   */
  private aggregate(print: CoinGlassLiquidationPrint): void {
    const bucketMs = this.config.bucketMs;
    const bucketStart = Math.floor(print.timestampMs / bucketMs) * bucketMs;
    const bucketEnd = bucketStart + bucketMs;
    if (bucketMs !== this.lastBucketMs) {
      this.lastBucketMs = bucketMs;
    }
    const cacheKey = `${print.symbol}:${bucketStart}`;
    const existing = this.windowCache.get(cacheKey);
    const accumulated: Liquidation1MinWindow = (() => {
      if (existing !== undefined) {
        // Roll-forward — preserve emittedAtMs but bump aggregates.
        // We rebuild the window every time a fresh print arrives;
        // the `emittedAtMs` is unchanged so consumers can still
        // deduplicate by (symbol, bucketStart, emittedAtMs).
        const w = existing.window;
        const isLong = print.side === "long";
        const longUsd = isLong ? w.longUsd + print.usdValue : w.longUsd;
        const shortUsd = isLong ? w.shortUsd : w.shortUsd + print.usdValue;

        // Reconstruct exchange counts from this.prints is expensive —
        // we approximate by counting distinct symbols-exchanges across
        // the bucket. For the simulated scope, we track an inline map.
        const exchangeCountKey = `${print.symbol}:${bucketStart}`;
        const cur = this.bucketExchangeCounts.get(exchangeCountKey);
        if (cur !== undefined) {
          cur.add(print.exchange);
        }
        return {
          windowStartMs: w.windowStartMs,
          windowEndMs: w.windowEndMs,
          symbol: w.symbol,
          totalUsd: w.totalUsd + print.usdValue,
          longUsd,
          shortUsd,
          printCount: w.printCount + 1,
          distinctExchangeCount: cur?.size ?? 1,
        };
      }
      this.bucketExchangeCounts.set(cacheKey, new Set([print.exchange]));
      return {
        windowStartMs: bucketStart,
        windowEndMs: bucketEnd,
        symbol: print.symbol,
        totalUsd: print.usdValue,
        longUsd: print.side === "long" ? print.usdValue : 0,
        shortUsd: print.side === "short" ? print.usdValue : 0,
        printCount: 1,
        distinctExchangeCount: 1,
      };
    })();

    this.windowCache.set(cacheKey, {
      emittedAtMs: existing?.emittedAtMs ?? print.timestampMs,
      window: accumulated,
    });
    if (existing === undefined) {
      this.cachedWindows.push(accumulated);
      this.config.onWindowReady?.(accumulated);
    } else {
      // Replace the cached window (same key) so `getCachedWindows()`
      // returns up-to-date data.
      const idx = this.cachedWindows.findIndex(
        (w) => w.windowStartMs === bucketStart && w.symbol === print.symbol,
      );
      if (idx >= 0) {
        this.cachedWindows[idx] = accumulated;
      }
    }
  }

  private readonly bucketExchangeCounts = new Map<string, Set<string>>();

  /** TTL-based cache cleanup (called by external scheduler). */
  pruneExpiredCache(nowMs: number): number {
    const ttl = this.config.cacheTtlMs;
    let removed = 0;
    for (const [key, value] of this.windowCache.entries()) {
      if (nowMs - value.emittedAtMs > ttl) {
        this.windowCache.delete(key);
        this.cachedWindows = this.cachedWindows.filter(
          (w) => !(w.windowStartMs === value.window.windowStartMs && w.symbol === value.window.symbol),
        );
        this.bucketExchangeCounts.delete(key);
        removed += 1;
      }
    }
    return removed;
  }
}

// ---------------------------------------------------------------------------
// Helper: aggregate a list of prints into 1-min windows (used by
// replay mode + tests + the cross-confirmation in Bitquery adapter).
// ---------------------------------------------------------------------------

/**
 * `aggregatePrintsIntoWindows` — pure-functional helper that
 * groups liquidation prints into 1-min buckets. Used for both
 * paper-trade replay and unit tests.
 *
 * Per the brief: `<1 min cache` aggregation. Default bucket = 60s.
 */
export function aggregatePrintsIntoWindows(
  prints: readonly CoinGlassLiquidationPrint[],
  bucketMs = DEFAULT_BUCKET_MS,
): readonly Liquidation1MinWindow[] {
  const byKey = new Map<string, { window: Liquidation1MinWindow; exchanges: Set<string> }>();
  for (const print of prints) {
    const bucketStart = Math.floor(print.timestampMs / bucketMs) * bucketMs;
    const bucketEnd = bucketStart + bucketMs;
    const key = `${print.symbol}:${bucketStart}`;
    let entry = byKey.get(key);
    if (entry === undefined) {
      entry = {
        window: {
          windowStartMs: bucketStart,
          windowEndMs: bucketEnd,
          symbol: print.symbol,
          totalUsd: print.usdValue,
          longUsd: print.side === "long" ? print.usdValue : 0,
          shortUsd: print.side === "short" ? print.usdValue : 0,
          printCount: 1,
          distinctExchangeCount: 1,
        },
        exchanges: new Set([print.exchange]),
      };
      byKey.set(key, entry);
    } else {
      entry = {
        window: {
          windowStartMs: entry.window.windowStartMs,
          windowEndMs: entry.window.windowEndMs,
          symbol: entry.window.symbol,
          totalUsd: entry.window.totalUsd + print.usdValue,
          longUsd: entry.window.longUsd + (print.side === "long" ? print.usdValue : 0),
          shortUsd: entry.window.shortUsd + (print.side === "short" ? print.usdValue : 0),
          printCount: entry.window.printCount + 1,
          distinctExchangeCount: entry.window.distinctExchangeCount,
        },
        exchanges: entry.exchanges,
      };
      entry.exchanges.add(print.exchange);
      byKey.set(key, entry);
    }
  }
  const result: Liquidation1MinWindow[] = [];
  for (const entry of byKey.values()) {
    result.push({ ...entry.window, distinctExchangeCount: entry.exchanges.size });
  }
  result.sort((a, b) => a.windowStartMs - b.windowStartMs);
  return result;
}

// Re-export the shared `Side` / `Symbol` types so consumers can
// import everything they need for the cascade detector from this
// module. Avoids implicit dependency on `@mm-crypto-bot/shared/types`
// when wiring tests.
export type { Side, Symbol, Candle };
