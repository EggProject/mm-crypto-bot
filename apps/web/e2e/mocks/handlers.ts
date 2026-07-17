/**
 * apps/web/e2e/mocks/handlers.ts
 *
 * MSW v2 handlers for the apps/web e2e suite. Intercepts:
 *   - REST:    http://127.0.0.1:7913/api/{strategies,ohlc,control}
 *   - WebSocket: ws://127.0.0.1:7913/ws
 *
 * The handlers mirror the production state-feed protocol
 * (apps/bot/src/state-feed/protocol.ts) so the dashboard's real
 * `useWebSocket()` + REST client code paths run unmodified against
 * the mocks. The test browser and the test runner share the same
 * Node process via Playwright's runner, so the `msw/node` server
 * (see `node.ts`) sees the same data; the `msw/browser` worker
 * (see `browser.ts`) intercepts the same URLs in the browser.
 *
 * **Why two transports:** the REST handlers run inside the MSW
 * service worker (which is browser-side, not Node-side), and the
 * WebSocket handlers run in-browser via the @mswjs/interceptors
 * `WebSocket` global patch. The handlers list is the same object
 * in both transports — MSW v2 supports `ws.link()` for both
 * `setupWorker` (browser) and `setupServer` (node).
 *
 * **Recorded state:** `clientMessages` and `controlCommands` are
 * push-only arrays the tests inspect to assert what the page sent.
 * The `reset()` function is exposed for `beforeEach` so each test
 * gets a clean recording.
 */

import { http, ws, HttpResponse } from "msw";

// =============================================================================
// State types (mirrors the bot's protocol.ts)
// =============================================================================

/**
 * `StrategyDescriptor` — the shape returned by `GET /api/strategies`
 * and used by `ChartGrid` (apps/web/src/components/ChartGrid.tsx).
 * Kept loose-typed here so the e2e mocks are easy to construct
 * (the production code does the runtime shape validation).
 */
export interface MockStrategy {
  readonly name: string;
  readonly enabled: boolean;
  readonly symbols: readonly string[];
  readonly timeframes: readonly string[];
}

/** A single OHLC bar (ms, ascending) used in bootstrap snapshots. */
export interface MockBar {
  readonly time: number;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
  readonly volume: number;
}

/** Position shape — matches PositionsTable's loose cast. */
export interface MockPosition {
  readonly id: string;
  readonly symbol: string;
  readonly side: string;
  readonly entryPrice: number;
  readonly currentPrice: number;
  readonly quantity: number;
  readonly leverage: number;
  readonly unrealizedPnl: number;
  readonly unrealizedPnlPct: number;
  readonly openedAt: number;
}

// =============================================================================
// State — the "current bot state" the mocks serve
// =============================================================================

/**
 * `state` — the mutable per-test bot state. Defaults match a
 * "happy path" bot with 1 enabled strategy × 1 symbol × 2 timeframes,
 * 1 open position, and a 20-bar OHLC bootstrap. Tests call `setState`
 * to override (e.g. to test the empty state or a disconnect).
 */
const state = {
  strategies: [
    {
      name: "donchian_pivot_composition",
      enabled: true,
      symbols: ["BTCUSDT"],
      timeframes: ["1h", "4h"],
    },
  ] as readonly MockStrategy[],
  positions: [
    {
      id: "pos-1",
      symbol: "BTCUSDT",
      side: "long",
      entryPrice: 67000,
      currentPrice: 67500,
      quantity: 0.1,
      leverage: 5,
      unrealizedPnl: 50,
      unrealizedPnlPct: 0.75,
      openedAt: Date.now() - 60 * 60 * 1000,
    },
  ] as readonly MockPosition[],
};

/** Recording — pushed to by the WS handler as the page sends messages. */
const clientMessages: string[] = [];
const controlCommands: {
  command: string;
  paused?: boolean;
  confirm?: boolean;
}[] = [];

/** `reset()` — clear the recordings (call from `beforeEach`). */
export function reset(): void {
  clientMessages.length = 0;
  controlCommands.length = 0;
}

/** `setStrategies(s)` — override the served strategy list. */
export function setStrategies(s: readonly MockStrategy[]): void {
  state.strategies = s;
}

/** `setPositions(p)` — override the served positions list. */
export function setPositions(p: readonly MockPosition[]): void {
  state.positions = p;
}

/** `getClientMessages()` — read the WS frames the page sent. */
export function getClientMessages(): readonly string[] {
  return clientMessages;
}

/** `getControlCommands()` — read the control commands the page sent. */
export function getControlCommands(): readonly {
  command: string;
  paused?: boolean;
  confirm?: boolean;
}[] {
  return controlCommands;
}

/** `getStrategies()` — read the currently-served strategies. */
export function getStrategies(): readonly MockStrategy[] {
  return state.strategies;
}

/** `getPositions()` — read the currently-served positions. */
export function getPositions(): readonly MockPosition[] {
  return state.positions;
}

// =============================================================================
// Bootstrap data
// =============================================================================

/**
 * `makeBootstrap()` — build the `ohlcBootstrap` for the snapshot. 20
 * bars of synthetic BTCUSDT 1h data, anchored at the current time and
 * going backwards in 1h intervals. The values are deterministic
 * (pure function of `now`) so tests are reproducible.
 */
function makeBootstrap(symbol: string, tf: string, now: number): MockBar[] {
  const intervalMs = tf === "1h" ? 60 * 60_000 : 4 * 60 * 60_000;
  const out: MockBar[] = [];
  let price = 67000;
  for (let i = 0; i < 20; i++) {
    const t = now - (19 - i) * intervalMs;
    const open = price;
    // Deterministic but non-trivial walk — the lightweight-charts
    // rendering test asserts that 20 bars produce a non-empty
    // series. The exact values don't matter, only the count.
    const delta = ((i * 7 + 3) % 11) - 5; // -5..+5
    price = Math.max(1, price + delta * 10);
    const close = price;
    out.push({
      time: t,
      open,
      high: Math.max(open, close) + 5,
      low: Math.min(open, close) - 5,
      close,
      volume: 100 + i,
    });
  }
  // Reference `symbol` to silence unused-var lint while keeping the
  // function shape (multi-symbol ready).
  void symbol;
  return out;
}

// =============================================================================
// REST handlers
// =============================================================================

/**
 * `GET /api/strategies` — return the current strategy list. The
 * dashboard's `App.tsx` fetches this on every WS connect.
 */
const strategiesHandler = http.get(
  "http://127.0.0.1:7913/api/strategies",
  () => {
    return HttpResponse.json({ strategies: state.strategies });
  },
);

/**
 * `GET /api/ohlc` — return OHLC bars for a (symbol, tf) pair. The
 * dashboard's chart grid (Phase 49 indicator overlay) calls this;
 * the 48D chart grid is fed via the WS SNAPSHOT bootstrap instead.
 * We keep the endpoint available for forward-compat.
 */
const ohlcHandler = http.get(
  "http://127.0.0.1:7913/api/ohlc",
  ({ request }) => {
    const url = new URL(request.url);
    const symbol = url.searchParams.get("symbol") ?? "BTCUSDT";
    const tf = url.searchParams.get("timeframe") ?? "1h";
    const bars = makeBootstrap(symbol, tf, Date.now());
    return HttpResponse.json({ bars });
  },
);

/**
 * `POST /api/control` — alternative HTTP control endpoint. The
 * 48D dashboard uses the WS CONTROL message, but the spec includes
 * this REST endpoint for completeness (the bot's web-client serves
 * both). Returns 202 Accepted, matching the real handler.
 */
const controlHandler = http.post(
  "http://127.0.0.1:7913/api/control",
  async ({ request }) => {
    const body = (await request.json()) as {
      command: string;
      paused?: boolean;
      confirm?: boolean;
    };
    controlCommands.push(body);
    return new HttpResponse(null, { status: 202 });
  },
);

// =============================================================================
// WebSocket handler
// =============================================================================

/**
 * `chat` — the WebSocket link to `ws://127.0.0.1:7913/ws`. Per the
 * state-feed protocol (apps/bot/src/state-feed/protocol.ts), the
 * server sends:
 *   1. HELLO (serverVersion + protocolVersion)
 *   2. SNAPSHOT (with `strategies` + `ohlcBootstrap`)
 * On the SNAPSHOT, the dashboard builds `barsByKey` and the WS
 * `send` is wired into ChartGrid for SUBSCRIBE messages.
 *
 * The handler also:
 *   - Records every client message to `clientMessages` (test asserts).
 *   - Sends a PING every 100ms; expects a PONG back.
 *   - Echoes SUBSCRIBE / UNSUBSCRIBE with a confirmation (no-op).
 *   - On CONTROL, records the command and replies with a STATE update
 *     reflecting the new `paused` flag.
 */
const chat = ws.link("ws://127.0.0.1:7913/ws");

const wsHandler = chat.addEventListener("connection", ({ client }) => {
  // 1. HELLO — sent first, before SNAPSHOT. The client-side WS code
  //    in apps/web/src/ws-client.ts does NOT react to HELLO (it
  //    only handles "snapshot" / "state" / "error" / "ping"), so
  //    this is a no-op for the dashboard but the protocol expects
  //    it.
  client.send(
    JSON.stringify({
      type: "hello",
      ts: Date.now(),
      serverVersion: "0.1.0-test",
      protocolVersion: 1,
    }),
  );

  // 2. SNAPSHOT — `strategies` (full descriptor list) + `ohlcBootstrap`
  //    (Record<symbol, Record<tf, OHLCBar[]>>). The dashboard's
  //    `extractBarsByKey()` walks this object and builds
  //    `barsByKey` for ChartGrid.
  const now = Date.now();
  const ohlcBootstrap: Record<string, Record<string, MockBar[]>> = {};
  for (const strat of state.strategies) {
    if (!strat.enabled) continue;
    for (const sym of strat.symbols) {
      const perTf: Record<string, MockBar[]> = {};
      for (const tf of strat.timeframes) {
        // The keys (`sym`, `tf`) are sourced from the test's mock
        // state, NOT user input. The eslint security rule flags
        // computed-property assignment as a generic object-
        // injection sink, but here the sink is our local `perTf`
        // object and the key is internally controlled.
        // eslint-disable-next-line security/detect-object-injection
        perTf[tf] = makeBootstrap(sym, tf, now);
      }
      // eslint-disable-next-line security/detect-object-injection
      ohlcBootstrap[sym] = perTf;
    }
  }
  client.send(
    JSON.stringify({
      type: "snapshot",
      ts: now,
      snapshot: {},
      strategies: state.strategies,
      ohlcBootstrap,
    }),
  );

  // 2b. Initial STATE — sent right after SNAPSHOT so the dashboard's
  //     `PositionsTable` has data to render. The real bot's web-client
  //     sends STATE on every state-feed tick (every ~1s); for the
  //     e2e we send ONE STATE on connect. Tests that need a different
  //     state (e.g. paused) can send a CONTROL message, which
  //     triggers a fresh STATE reply.
  client.send(
    JSON.stringify({
      type: "state",
      ts: Date.now(),
      snapshot: {},
      positions: state.positions,
      closedTrades: [],
      killSwitch: "off",
      paused: false,
      statistics: { trades: 0, pnl: 0, drawdown: 0 },
    }),
  );

  // 3. Heartbeat — the real server sends a PING every 10s; we send
  //    one every 100ms so the heartbeat branch runs in tests. The
  //    client (apps/web/src/ws-client.ts) auto-responds with PONG.
  const heartbeat = setInterval(() => {
    try {
      client.send(JSON.stringify({ type: "ping", ts: Date.now() }));
    } catch {
      // Client disconnected — interval is cleared in the close
      // handler below.
    }
  }, 100);

  // 4. Message handling — every client frame is recorded. SUBSCRIBE /
  //    UNSUBSCRIBE are echoed with a confirmation (no-op). CONTROL
  //    triggers a STATE update.
  client.addEventListener("message", (event) => {
    // The MSW WS event.data is a string (the client → server
    // frame). The `@typescript-eslint/no-base-to-string` rule
    // doesn't fire on `String()` but would fire on template-
    // literal interpolation. The cast is needed because
    // `Event.data` is `unknown` in some lib.dom definitions.
    const data = String((event as { data: unknown }).data);
    clientMessages.push(data);
    let msg: { type?: string; symbol?: unknown; timeframe?: unknown; paused?: unknown; command?: unknown; confirm?: unknown };
    try {
      msg = JSON.parse(data) as typeof msg;
    } catch {
      return;
    }
    switch (msg.type) {
      case "pong":
        // Client responding to a PING. No-op (heartbeat handled).
        return;
      case "subscribe":
      case "unsubscribe": {
        // Echo a confirmation (the real server does the same).
        // The dashboard doesn't wait for the ack — this is a
        // protocol-level no-op, recorded for completeness.
        const symbol = typeof msg.symbol === "string" ? msg.symbol : "";
        const timeframe =
          typeof msg.timeframe === "string" ? msg.timeframe : "";
        client.send(
          JSON.stringify({
            type: msg.type === "subscribe" ? "subscribed" : "unsubscribed",
            symbol,
            timeframe,
          }),
        );
        return;
      }
      case "control": {
        const command = typeof msg.command === "string" ? msg.command : "";
        const paused = typeof msg.paused === "boolean" ? msg.paused : undefined;
        const confirm =
          typeof msg.confirm === "boolean" ? msg.confirm : undefined;
        controlCommands.push({ command, paused, confirm });
        // Reply with a STATE update reflecting the new state.
        client.send(
          JSON.stringify({
            type: "state",
            ts: Date.now(),
            snapshot: {},
            positions: state.positions,
            closedTrades: [],
            killSwitch: "off",
            paused: paused === true,
            statistics: { trades: 0, pnl: 0, drawdown: 0 },
          }),
        );
        return;
      }
      default:
        // Unknown client message — ignore.
        return;
    }
  });

  // 5. Cleanup — when the client disconnects, stop the heartbeat
  //    interval so we don't leak timers in the test process.
  client.addEventListener("close", () => {
    clearInterval(heartbeat);
  });
});

// =============================================================================
// Handlers list
// =============================================================================

export const handlers = [
  strategiesHandler,
  ohlcHandler,
  controlHandler,
  wsHandler,
];
