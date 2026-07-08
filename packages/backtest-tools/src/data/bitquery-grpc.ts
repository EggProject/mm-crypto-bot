// packages/backtest-tools/src/data/bitquery-grpc.ts
//
// Bitquery gRPC `liquidation` channel adapter for Hyperliquid.
//
// Phase 25 #2 — Track D (Liquidation cascade detector, satellite).
//
// References (see docs/research/phase25/track-d/REPORT.md):
//   - §2.1 Bitquery: Hyperliquid gRPC + WS, every fill, funding, liquidation.
//     Best raw Hyperliquid firehose.
//   - §3.2 Layer 1 raw-trade stream: "Bitquery gRPC for Hyperliquid fills +
//     funding + liquidation object. <300ms slot-to-socket, binary Protobuf,
//     no serialization overhead."
//   - §6.1 Signal pipeline: "CoinGlass V4 WS liquidationOrders (cross-venue
//     aggregate) | Bitquery gRPC liquidation channel (Hyperliquid, sub-300ms)"
//     as the Layer 1 inputs to the 3-layer cascade filter.
//
// This adapter is the **second Layer 1 source** per the cascade-fade
// detector. Cross-confirmation logic requires at least CoinGlass OR
// Bitquery to agree on a "real" cascade event.
//
// Wire-encoding: Bitquery exposes Hyperliquid liquidation events via
// gRPC streams with binary Protobuf payloads. We abstract the transport
// behind a pluggable interface (like CoinGlass) so tests use a mock.

import type { CoinGlassLiquidationPrint } from "./coinglass-liquidation-ws.js";

// ---------------------------------------------------------------------------
// Wire types
// ---------------------------------------------------------------------------

/**
 * Bitquery native liquidation event payload, decoded from the
 * upstream Protobuf message. The Bitquery schema covers every fill,
 * funding tick, and liquidation on Hyperliquid — we expose only the
 * liquidation subset.
 */
export interface BitqueryLiquidationEvent {
  /** Unix epoch milliseconds when the liquidation was filled. */
  readonly timestampMs: number;
  /** Base asset (BTC, ETH, SOL, ...). Normalized to upper-case. */
  readonly symbol: string;
  /** Liquidated side as reported by Bitquery (`LONG` or `SHORT`). */
  readonly side: "LONG" | "SHORT";
  /** USD value of the liquidation. */
  readonly usdValue: number;
  /** Underlying asset quantity (instrument units). */
  readonly quantity: number;
  /** Fill price. */
  readonly price: number;
  /** Originating user address (Hyperliquid wallet). */
  readonly userAddress: string;
  /** Block height on HyperBFT — useful for finality tracking. */
  readonly blockHeight: number;
}

/**
 * Configuration for the Bitquery adapter. We require an API token
 * and a HyperCore-asset allowlist to avoid blasting the budget on
 * long-tail perps.
 */
export interface BitqueryGrpcConfig {
  /** Bitquery V2 API token. */
  readonly apiToken: string;
  /** gRPC endpoint override (for staging or local mock). */
  readonly endpoint?: string;
  /** Subscribed symbols. */
  readonly symbols: readonly string[];
  /**
   * Socket-to-process latency budget (ms). Default 300 per
   * Track D §2.1 vendor table.
   */
  readonly latencyBudgetMs?: number;
  /** Hook for every parsed event. */
  readonly onEvent?: (event: BitqueryLiquidationEvent) => void;
}

/**
 * Pluggable transport. Production uses a gRPC client; tests use mock.
 */
export interface BitqueryTransport {
  connect(onMessage: (payload: unknown) => void): void;
  subscribe(symbols: readonly string[]): void;
  close(): void;
  isOpen(): boolean;
}

// ---------------------------------------------------------------------------
// Mock transport
// ---------------------------------------------------------------------------

/**
 * `MockBitqueryTransport` — deterministic transport for tests.
 * Pre-load an event log and `tick()` to drive the simulation.
 */
export class MockBitqueryTransport implements BitqueryTransport {
  private open = false;
  private readonly eventsByTs = new Map<number, BitqueryLiquidationEvent[]>();
  private readonly subscribed: string[] = [];
  private onMessage: ((payload: unknown) => void) | null = null;
  private currentMockTimeMs = 0;

  constructor(events: readonly BitqueryLiquidationEvent[] = []) {
    for (const ev of events) {
      const arr = this.eventsByTs.get(ev.timestampMs) ?? [];
      arr.push(ev);
      this.eventsByTs.set(ev.timestampMs, arr);
    }
  }

  /** Add an event to the mock log. */
  addEvent(event: BitqueryLiquidationEvent): void {
    const arr = this.eventsByTs.get(event.timestampMs) ?? [];
    arr.push(event);
    this.eventsByTs.set(event.timestampMs, arr);
  }

  connect(onMessage: (payload: unknown) => void): void {
    this.open = true;
    this.onMessage = onMessage;
  }

  subscribe(symbols: readonly string[]): void {
    this.subscribed.push(...symbols);
  }

  close(): void {
    this.open = false;
    this.onMessage = null;
  }

  isOpen(): boolean {
    return this.open;
  }

  tick(tickMs = 1000): void {
    if (!this.open || this.onMessage === null) return;
    this.currentMockTimeMs += tickMs;
    const due = this.eventsByTs.get(this.currentMockTimeMs) ?? [];
    for (const event of due) {
      this.onMessage({ event });
    }
  }

  advanceTo(targetMs: number): void {
    while (this.currentMockTimeMs < targetMs) {
      this.tick(targetMs - this.currentMockTimeMs);
    }
  }

  getSubscriptions(): readonly string[] {
    return [...this.subscribed];
  }
}

// ---------------------------------------------------------------------------
// Main feed implementation
// ---------------------------------------------------------------------------

const DEFAULT_LATENCY_BUDGET_MS = 300;
const DEFAULT_ENDPOINT = "grpc.bitquery.io:443";

/**
 * `BitqueryGrpcLiquidationFeed` — consumes the Bitquery `liquidation`
 * Protobuf stream and exposes canonical normalized events.
 *
 * Typical use: the cascade detector pairs this with CoinGlass. A
 * "real" cascade requires either (a) CoinGlass + Bitquery both report
 * a window with >$50M 1-min USD value OR (b) Bitquery alone with >$30M
 * 1-min USD value and Hyperliquid OI drop within the same 5-min window.
 * (See `cascade-fade.ts` Layer 1 rule.)
 */
export class BitqueryGrpcLiquidationFeed {
  private readonly config: Required<
    Pick<BitqueryGrpcConfig, "latencyBudgetMs" | "endpoint">
  > &
    BitqueryGrpcConfig;
  private readonly transport: BitqueryTransport;
  private readonly events: BitqueryLiquidationEvent[] = [];

  constructor(transport: BitqueryTransport, config: BitqueryGrpcConfig) {
    if (config.apiToken.trim() === "") {
      throw new Error("BitqueryGrpcLiquidationFeed: apiToken is required");
    }
    if (config.symbols.length === 0) {
      throw new Error("BitqueryGrpcLiquidationFeed: at least one symbol required");
    }
    this.transport = transport;
    this.config = {
      latencyBudgetMs: config.latencyBudgetMs ?? DEFAULT_LATENCY_BUDGET_MS,
      endpoint: config.endpoint ?? DEFAULT_ENDPOINT,
      ...config,
    };
  }

  /** Open the gRPC stream and subscribe. */
  start(): void {
    this.transport.connect((payload: unknown) => {
      this.handleMessage(payload);
    });
    this.transport.subscribe(this.config.symbols);
  }

  /** Stop the stream. */
  stop(): void {
    this.transport.close();
  }

  /** Inspect all parsed events (test helper). */
  getEvents(): readonly BitqueryLiquidationEvent[] {
    return [...this.events];
  }

  /**
   * Manually ingest a wire-level payload (for tests + replay).
   *
   * Routes through `handleMessage` so the wire-parser is exercised
   * identically to a real gRPC push. The input may be the canonical
   * `BitqueryLiquidationEvent` form OR the upstream `{ event: ... }`
   * envelope shape — the parser handles both.
   */
  ingest(event: unknown): void {
    this.handleMessage(event);
  }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  private handleMessage(payload: unknown): void {
    if (payload === null || typeof payload !== "object") return;
    const obj = payload as Record<string, unknown>;
    // Wrapper shape: { event: { ... } } or direct.
    let candidate: unknown;
    if ("event" in obj && typeof obj["event"] === "object") {
      candidate = obj["event"];
    } else {
      candidate = obj;
    }
    const event = this.parseWireEvent(candidate);
    if (event !== null) {
      this.handleEvent(event);
    }
  }

  private parseWireEvent(obj: unknown): BitqueryLiquidationEvent | null {
    if (obj === null || typeof obj !== "object") return null;
    // Re-cast at this point — TypeScript widens `obj` (here-after a
    // non-null + `typeof === "object"` check) to `object` which does NOT
    // have string keys indexed. Re-asserting it back to `Record<string,
    // unknown>` lets us index with `rec["symbol"]` etc. without
    // tripping TS7053 ("expression of type X can't be used to index
    // type Y").
    const rec: Record<string, unknown> = obj as Record<string, unknown>;
    // Bracket notation is required here because `obj` (after the early
    // null/typeof check) is typed as the wire-parser input. The keys
    // (`symbol`, `side`, `usdValue`, `quantity`, `price`) come from the
    // CoinGlass v4 / Bitquery gRPC envelope which is upstream of us and
    // may evolve; we use bracket notation deliberately. The alternative
    // — using dot notation on a `Record<string, unknown>` cast — would
    // trigger an `as` assertion flagged by
    // `@typescript-eslint/no-unnecessary-type-assertion`.
    const symbolRaw = typeof rec["symbol"] === "string" ? rec["symbol"].toUpperCase() : "";
    if (symbolRaw === "") return null;
    const sideRaw = typeof rec["side"] === "string" ? rec["side"].toUpperCase() : "LONG";
    const side: "LONG" | "SHORT" = sideRaw === "SHORT" ? "SHORT" : "LONG";
    const usdValue = typeof rec["usdValue"] === "number" ? rec["usdValue"] : 0;
    const quantity = typeof rec["quantity"] === "number" ? rec["quantity"] : 0;
    const price = typeof rec["price"] === "number" ? rec["price"] : 0;
    const userAddr: string = typeof rec["userAddress"] === "string" ? rec["userAddress"] : "0x0";
    const blockHeight: number = typeof rec["blockHeight"] === "number" ? rec["blockHeight"] : 0;
    const timestampMsRaw: number | string = (rec["timestampMs"] ?? 0) as number | string;
    const timestampMs = typeof timestampMsRaw === "number" ? timestampMsRaw : Number(timestampMsRaw);
    if (!Number.isFinite(timestampMs) || timestampMs <= 0) return null;
    return {
      timestampMs,
      symbol: symbolRaw,
      side,
      usdValue,
      quantity,
      price,
      userAddress: userAddr,
      blockHeight,
    };
  }

  private handleEvent(event: BitqueryLiquidationEvent): void {
    this.events.push(event);
    this.config.onEvent?.(event);
  }
}

// ---------------------------------------------------------------------------
// Bridge: Bitquery event → CoinGlassLiquidationPrint
// ---------------------------------------------------------------------------

/**
 * `bitqueryEventToCoinGlassPrint` — convert a Bitquery liquidation
 * event to the unified `CoinGlassLiquidationPrint` shape. Used by
 * the cross-confirmation layer that compares CoinGlass + Bitquery
 * views of the same cascade minute.
 *
 * NOTE: side is normalized to `"long"` / `"short"` lowercase to
 * match CoinGlass shape (Bitquery uses `LONG`/`SHORT` uppercase).
 */
export function bitqueryEventToCoinGlassPrint(
  event: BitqueryLiquidationEvent,
): CoinGlassLiquidationPrint {
  return {
    timestampMs: event.timestampMs,
    symbol: event.symbol,
    side: event.side === "LONG" ? "long" : "short",
    usdValue: event.usdValue,
    quantity: event.quantity,
    price: event.price,
    exchange: "Hyperliquid",
    raw: { bitqueryBlockHeight: event.blockHeight, userAddress: event.userAddress },
  };
}
