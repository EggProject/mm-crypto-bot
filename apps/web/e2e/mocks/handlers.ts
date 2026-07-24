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
  // Phase 69: the bot's high-level state. The dashboard's status
  // banner + the ControlBar's button enable/disable logic both read
  // this. Default = "stopped" (the dashboard's first-paint state).
  // The handler mutates this on each CONTROL message (matching the
  // real bot's state-machine), and tests can override via
  // `setBotState` for explicit assertions on the button states.
  botState: "stopped" as "running" | "paused" | "stopped",
  startedAt: 0 as number,
  activeStrategyCount: 1 as number,
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
  // Phase 69: the bot state also resets to "stopped" on `reset()` —
  // the dashboard's status banner should match the production
  // first-paint state in every test.
  state.botState = "stopped";
  state.startedAt = 0;
  state.activeStrategyCount = 1;
}

// Phase 69: auto-reset the bot state on every new page load. The
// MSW worker maintains a single state closure across all tests;
// without this auto-reset, the state from the previous test (e.g.
// "paused" from a test that paused the bot) bleeds into the next.
// Each new page load = a fresh test = a fresh state. The reset
// is also exposed via the `__mswResetState` global for tests that
// need to explicitly reset between sub-assertions.
if (typeof window !== "undefined") {
  (window as unknown as { __mswResetState?: () => void }).__mswResetState =
    reset;
}

/** `setStrategies(s)` — override the served strategy list. */
export function setStrategies(s: readonly MockStrategy[]): void {
  state.strategies = s;
}

/** `setPositions(p)` — override the served positions list. */
export function setPositions(p: readonly MockPosition[]): void {
  state.positions = p;
}

/** `setBotState(s)` — override the served bot state (Phase 69). */
export function setBotState(s: "running" | "paused" | "stopped"): void {
  state.botState = s;
}

/** `getBotState()` — read the currently-served bot state. */
export function getBotState(): "running" | "paused" | "stopped" {
  return state.botState;
}

/** `setStartedAt(ts)` — override the bot startedAt timestamp. */
export function setStartedAt(ts: number): void {
  state.startedAt = ts;
}

/** `setActiveStrategyCount(n)` — override the active strategy count. */
export function setActiveStrategyCount(n: number): void {
  state.activeStrategyCount = n;
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
 *
 * Phase 69: this is now the PRIMARY control endpoint for the
 * dashboard's Start/Stop/Pause/Resume buttons. The handler mutates
 * the mock `state.botState` to mirror the real bot's state machine
 * (so the next `/api/status` poll returns the updated state).
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
    // Phase 69: update the mock bot state to match the real bot's
    // state machine. This is the MOCK side of the HTTP /api/control
    // wiring — the real bot's web-client HTTP handler does the same
    // dispatch via the `handleControl` callback in start.ts.
    switch (body.command) {
      case "start":
        state.botState = "running";
        state.startedAt = Date.now();
        break;
      case "stop":
        state.botState = "stopped";
        // Note: `startedAt` is NOT reset (the real bot's
        // `markBotStopped()` keeps the historical timestamp; the
        // dashboard only displays uptime while running).
        break;
      case "pause":
        state.botState = "paused";
        break;
      case "resume":
        state.botState = "running";
        break;
      case "kill_switch":
        state.botState = "stopped";
        break;
    }
    return new HttpResponse(null, { status: 202 });
  },
);

/**
 * `GET /api/status` — Phase 69: the dashboard's status banner
 * source. Returns the current `botStatus` object (matching the real
 * bot's `web-client/http-server.ts` `handleGetStatus` shape).
 *
 * The dashboard polls this endpoint on mount and every 5s as a
 * fallback (the primary source is the WS `state` message). The
 * `GET /api/health` endpoint is also useful for liveness checks
 * (no bot state, just connection status).
 */
const statusHandler = http.get(
  "http://127.0.0.1:7913/api/status",
  () => {
    return HttpResponse.json({
      botStatus: {
        state: state.botState,
        startedAt: state.startedAt,
        lastUpdate: Date.now(),
        activeStrategyCount: state.activeStrategyCount,
      },
    });
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
  //
  // Phase 69: the STATE message's `snapshot` field now also embeds
  // the `botStatus` (mirroring the real bot's `StateFeedSnapshot`
  // shape — the WS `state` message carries the full snapshot, so
  // the botStatus comes through automatically).
  client.send(
    JSON.stringify({
      type: "state",
      ts: Date.now(),
      snapshot: {
        botStatus: {
          state: state.botState,
          startedAt: state.startedAt,
          lastUpdate: Date.now(),
          activeStrategyCount: state.activeStrategyCount,
        },
      },
      positions: state.positions,
      closedTrades: [],
      killSwitch: "off",
      paused: state.botState === "paused",
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

  // 3b. Phase 52F follow-up: tick + bar stream. The real state-feed
  //     pushes ~60Hz ticks and 1Hz bars; for the e2e we send a
  //     tick every 200ms and a bar every 1s (a 5Hz tick cadence is
  //     enough to exercise the `RealtimeBatcher` rAF pipeline in
  //     `apps/web/src/ws-client.ts` and `lib/realtime-batcher.ts`).
  //     The previous setup only sent PINGs, leaving
  //     `RealtimeBatcher.push/flush/ensureFrameScheduled`
  //     uncovered in the lcov — dragging the function-coverage
  //     below the 60% threshold set in `e2e/dashboard.spec.ts`.
  //     Sending ticks+bars here is the smallest implementation
  //     change that exercises the batcher without altering the
  //     test assertions (the dashboard renders `lastTick` /
  //     `lastBar` only as internal state; no e2e test asserts on
  //     them).
  let lastBarTime = Date.now();
  let price = 67000;
  const tickInterval = setInterval(() => {
    try {
      // Deterministic but non-trivial walk so the dashboard
      // sees a moving price if it ever renders one. The test
      // assertions don't read `lastTick` directly — they just
      // need the message to flow through the WS pipeline.
      price = Math.max(1, price + ((Date.now() % 7) - 3) * 5);
      client.send(
        JSON.stringify({
          type: "tick",
          ts: Date.now(),
          symbol: "BTCUSDT",
          price,
        }),
      );
      const now2 = Date.now();
      if (now2 - lastBarTime >= 1000) {
        lastBarTime = now2;
        client.send(
          JSON.stringify({
            type: "bar",
            ts: now2,
            symbol: "BTCUSDT",
            timeframe: "1h",
            ohlc: { open: price, high: price + 5, low: price - 5, close: price },
          }),
        );
      }
    } catch {
      // Client disconnected — intervals are cleared in the close
      // handler below.
    }
  }, 200);

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
        // Phase 69: update the mock bot state to mirror the real
        // bot's state machine (the HTTP /api/control handler also
        // does this, but the WS handler is the canonical source of
        // truth for the dashboard).
        switch (command) {
          case "start":
            state.botState = "running";
            state.startedAt = Date.now();
            break;
          case "stop":
            state.botState = "stopped";
            break;
          case "pause":
            state.botState = "paused";
            break;
          case "resume":
            state.botState = "running";
            break;
          case "kill_switch":
            state.botState = "stopped";
            break;
        }
        // Reply with a STATE update reflecting the new state.
        // Phase 69: the snapshot's `botStatus` is the source of truth
        // for the dashboard's status banner (the WS state message
        // carries the full snapshot, which includes the botStatus).
        client.send(
          JSON.stringify({
            type: "state",
            ts: Date.now(),
            snapshot: {
              botStatus: {
                state: state.botState,
                startedAt: state.startedAt,
                lastUpdate: Date.now(),
                activeStrategyCount: state.activeStrategyCount,
              },
            },
            positions: state.positions,
            closedTrades: [],
            killSwitch: "off",
            paused: state.botState === "paused",
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
    clearInterval(tickInterval);
  });
});

// =============================================================================
// Handlers list
// =============================================================================

export const handlers = [
  strategiesHandler,
  ohlcHandler,
  controlHandler,
  statusHandler,
  wsHandler,
];
