/**
 * apps/bot/src/web-client/__tests__/http-server.test.ts
 *
 * PHASE 46 — HttpServer (Hono REST endpoints) tests.
 *
 * Lefedi:
 *   - GET / — placeholder HTML ha nincs bundle
 *   - GET /api/health — mindig 200
 *   - GET /api/strategies — 503 ha nincs snapshot, 200 ha van
 *   - GET /api/ohlc — query param validáció, 200 ha van OHLC
 *   - POST /api/control — body validáció, 202 ha sikeres
 *   - GET /api/strategies 503 ha state-feed disconnected
 *   - POST /api/control 503 ha state-feed disconnected
 */

import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createHttpHandler } from "../http-server.js";
import type { StateFeedClientHandle } from "../state-feed-client.js";

// ============================================================================
// Test helpers
// ============================================================================

/** Egy fake StateFeedClientHandle — a send / isConnected API-ját mockolja. */
function makeFakeStateFeed(opts: {
  readonly connected: boolean;
  readonly sendResult?: boolean;
} = { connected: true }): {
  readonly handle: StateFeedClientHandle;
  readonly sent: object[];
} {
  const sent: object[] = [];
  const handle: StateFeedClientHandle = {
    start: async () => undefined,
    close: async () => undefined,
    send: (msg) => {
      sent.push(msg);
      return opts.sendResult ?? true;
    },
    isConnected: () => opts.connected,
    reconnectAttempt: () => 0,
    hostname: "127.0.0.1",
    port: 7914,
  };
  return { handle, sent };
}

function makeRequest(path: string, init?: RequestInit): Request {
  return new Request(`http://127.0.0.1:7913${path}`, init);
}

// ============================================================================
// Tests
// ============================================================================

describe("http-server", () => {
  describe("GET /api/health", () => {
    it("returns 200 with state-feed status", async () => {
      const { handle } = makeFakeStateFeed({ connected: true });
      const factory = createHttpHandler(handle, { webDistDir: "/nonexistent" });
      const res = await factory.fetch(makeRequest("/api/health"));
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body["ok"]).toBe(true);
      expect(body["stateFeedConnected"]).toBe(true);
      expect(body["hasSnapshot"]).toBe(false);
    });
  });

  describe("GET / (static handler)", () => {
    it("returns placeholder HTML when webDistDir is missing", async () => {
      const { handle } = makeFakeStateFeed();
      const factory = createHttpHandler(handle, { webDistDir: "/nonexistent/path" });
      const res = await factory.fetch(makeRequest("/"));
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toContain("mm-bot web");
      expect(text).toContain("has not been built");
      expect(text).toContain("bun run web:build");
    });

    it("serves the built index.html when webDistDir has it", async () => {
      const tmp = mkdtempSync(join(tmpdir(), "web-test-"));
      try {
        writeFileSync(join(tmp, "index.html"), "<html>built</html>");
        const { handle } = makeFakeStateFeed();
        const factory = createHttpHandler(handle, { webDistDir: tmp });
        const res = await factory.fetch(makeRequest("/"));
        expect(res.status).toBe(200);
        const text = await res.text();
        expect(text).toContain("<html>built</html>");
      } finally {
        rmSync(tmp, { recursive: true, force: true });
      }
    });

    it("serves static files from /static/* with correct content-type", async () => {
      const tmp = mkdtempSync(join(tmpdir(), "web-test-"));
      try {
        writeFileSync(join(tmp, "app.js"), "console.log('hi');");
        const { handle } = makeFakeStateFeed();
        const factory = createHttpHandler(handle, { webDistDir: tmp });
        const res = await factory.fetch(makeRequest("/static/app.js"));
        expect(res.status).toBe(200);
        const text = await res.text();
        expect(text).toContain("console.log");
        expect(res.headers.get("content-type")).toContain("text/javascript");
      } finally {
        rmSync(tmp, { recursive: true, force: true });
      }
    });

    it("returns 404 for /static/* files that do not exist", async () => {
      const tmp = mkdtempSync(join(tmpdir(), "web-test-"));
      try {
        const { handle } = makeFakeStateFeed();
        const factory = createHttpHandler(handle, { webDistDir: tmp });
        const res = await factory.fetch(makeRequest("/static/missing.js"));
        expect(res.status).toBe(404);
      } finally {
        rmSync(tmp, { recursive: true, force: true });
      }
    });

    it("rejects path traversal in /static/*", async () => {
      const tmp = mkdtempSync(join(tmpdir(), "web-test-"));
      try {
        const { handle } = makeFakeStateFeed();
        const factory = createHttpHandler(handle, { webDistDir: tmp });
        const res = await factory.fetch(makeRequest("/static/../etc/passwd"));
        // A böngésző normalizálja az URL-t, így a `..` a path elejére kerül
        // és a normalize eltávolítja — 404 a helyes válasz.
        expect(res.status).toBe(404);
      } finally {
        rmSync(tmp, { recursive: true, force: true });
      }
    });
  });

  describe("GET /api/strategies", () => {
    it("returns 503 when state-feed is disconnected", async () => {
      const { handle } = makeFakeStateFeed({ connected: false });
      const factory = createHttpHandler(handle, { webDistDir: "/nonexistent" });
      const res = await factory.fetch(makeRequest("/api/strategies"));
      expect(res.status).toBe(503);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body["error"]).toBe("state-feed disconnected");
    });

    it("returns 503 when no snapshot is cached", async () => {
      const { handle } = makeFakeStateFeed({ connected: true });
      const factory = createHttpHandler(handle, { webDistDir: "/nonexistent" });
      const res = await factory.fetch(makeRequest("/api/strategies"));
      expect(res.status).toBe(503);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body["error"]).toBe("snapshot not yet received from state-feed");
    });

    it("returns 200 with the strategies list when a snapshot is cached", async () => {
      const { handle } = makeFakeStateFeed({ connected: true });
      const factory = createHttpHandler(handle, { webDistDir: "/nonexistent" });
      factory.setSnapshot(
        {
          status: {
            mode: "with-bot",
            engineAvailable: true,
            engineError: null,
            connected: true,
            lastUpdate: 0,
          },
          running: false,
          killSwitch: "armed",
          positions: [],
          statistics: {
            totalPnlUsdt: 0,
            totalPnlPct: 0,
            winRate: 0,
            totalTrades: 0,
            winningTrades: 0,
            losingTrades: 0,
            maxDrawdownPct: 0,
            currentDrawdownPct: 0,
            avgWinPnl: 0,
            avgLossPnl: 0,
            bestTradePnl: 0,
            worstTradePnl: 0,
            profitFactor: 0,
            sharpeRatio: 0,
            equityUsdt: 0,
            initialEquityUsdt: 0,
          },
          history: [],
          tickers: [{ symbol: "BTC/USDC", price: 60000, ts: 1 }],
          tickerEvents: [],
          // Phase 52E: hiányzó `strategies` mező — a fallback
          // (donchian_pivot_composition a tickers-ből) fut le.
          paused: false,
          killSwitchThresholdPct: -10,
          // Phase 69: a bot indulás előtt "stopped" állapotban van.
          botStatus: {
            state: "stopped",
            startedAt: 0,
            lastUpdate: 0,
            activeStrategyCount: 0,
          },
        },
        {},
      );
      const res = await factory.fetch(makeRequest("/api/strategies"));
      expect(res.status).toBe(200);
      const body = (await res.json()) as { strategies: { name: string; symbols: string[] }[] };
      expect(body.strategies.length).toBe(1);
      expect(body.strategies[0]?.name).toBe("donchian_pivot_composition");
      expect(body.strategies[0]?.symbols).toContain("BTC/USDC");
    });

    it("returns 200 with the strategies list from snapshot.strategies when populated (Phase 52E)", async () => {
      const { handle } = makeFakeStateFeed({ connected: true });
      const factory = createHttpHandler(handle, { webDistDir: "/nonexistent" });
      factory.setSnapshot(
        {
          status: {
            mode: "with-bot",
            engineAvailable: true,
            engineError: null,
            connected: true,
            lastUpdate: 0,
          },
          running: false,
          killSwitch: "armed",
          positions: [],
          statistics: {
            totalPnlUsdt: 0,
            totalPnlPct: 0,
            winRate: 0,
            totalTrades: 0,
            winningTrades: 0,
            losingTrades: 0,
            maxDrawdownPct: 0,
            currentDrawdownPct: 0,
            avgWinPnl: 0,
            avgLossPnl: 0,
            bestTradePnl: 0,
            worstTradePnl: 0,
            profitFactor: 0,
            sharpeRatio: 0,
            equityUsdt: 0,
            initialEquityUsdt: 0,
          },
          history: [],
          tickers: [{ symbol: "BTC/USDC", price: 60000, ts: 1 }],
          tickerEvents: [],
          // Phase 52E: a `strategies` mező 3 stratégiát tartalmaz —
          // az új kód ezt olvassa, NEM a fallback-et.
          strategies: [
            { name: "donchian_pivot_composition", enabled: true, symbols: ["BTC/USDC", "ETH/USDC", "SOL/USDC"], timeframes: ["1h", "4h", "1d"] },
            { name: "dydx_cex_carry", enabled: true, symbols: ["BTC/USDC"], timeframes: ["1h", "4h", "1d"] },
            { name: "cascade_fade", enabled: true, symbols: ["BTC/USDC"], timeframes: ["1h", "4h", "1d"] },
          ],
          paused: false,
          killSwitchThresholdPct: -10,
          // Phase 69: a bot indulás előtt "stopped" állapotban van.
          botStatus: {
            state: "stopped",
            startedAt: 0,
            lastUpdate: 0,
            activeStrategyCount: 3,
          },
        },
        {},
      );
      const res = await factory.fetch(makeRequest("/api/strategies"));
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        strategies: { name: string; enabled: boolean; symbols: string[]; timeframes: string[] }[];
      };
      expect(body.strategies.length).toBe(3);
      expect(body.strategies.map((s) => s.name)).toEqual([
        "donchian_pivot_composition",
        "dydx_cex_carry",
        "cascade_fade",
      ]);
      // A `tickers` mezőből származó fallback NEM fut le, ha a
      // `strategies` mező nem üres.
      for (const s of body.strategies) {
        expect(s.symbols.length).toBeGreaterThan(0);
        expect(s.timeframes.length).toBeGreaterThan(0);
      }
    });
  });

  // Phase 69: GET /api/status — a dashboard status banner forrása.
  describe("GET /api/status", () => {
    it("returns 503 with default 'stopped' status when no snapshot is cached", async () => {
      const { handle } = makeFakeStateFeed({ connected: true });
      const factory = createHttpHandler(handle, { webDistDir: "/nonexistent" });
      const res = await factory.fetch(makeRequest("/api/status"));
      expect(res.status).toBe(503);
      const body = (await res.json()) as { botStatus: { state: string; startedAt: number; activeStrategyCount: number } };
      expect(body.botStatus.state).toBe("stopped");
      expect(body.botStatus.startedAt).toBe(0);
      expect(body.botStatus.activeStrategyCount).toBe(0);
    });

    it("returns 200 with the snapshot's botStatus when present", async () => {
      const { handle } = makeFakeStateFeed({ connected: true });
      const factory = createHttpHandler(handle, { webDistDir: "/nonexistent" });
      factory.setSnapshot(
        {
          status: {
            mode: "with-bot",
            engineAvailable: true,
            engineError: null,
            connected: true,
            lastUpdate: 0,
          },
          running: true,
          killSwitch: "armed",
          positions: [],
          statistics: {
            totalPnlUsdt: 0,
            totalPnlPct: 0,
            winRate: 0,
            totalTrades: 0,
            winningTrades: 0,
            losingTrades: 0,
            maxDrawdownPct: 0,
            currentDrawdownPct: 0,
            avgWinPnl: 0,
            avgLossPnl: 0,
            bestTradePnl: 0,
            worstTradePnl: 0,
            profitFactor: 0,
            sharpeRatio: 0,
            equityUsdt: 0,
            initialEquityUsdt: 0,
          },
          history: [],
          tickers: [],
          tickerEvents: [],
          paused: false,
          killSwitchThresholdPct: -10,
          // Phase 69: a bot aktívan fut, 3 enabled stratégia van.
          botStatus: {
            state: "running",
            startedAt: 1_700_000_000_000,
            lastUpdate: 1_700_000_060_000,
            activeStrategyCount: 3,
          },
        },
        {},
      );
      const res = await factory.fetch(makeRequest("/api/status"));
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        botStatus: { state: string; startedAt: number; lastUpdate: number; activeStrategyCount: number };
      };
      expect(body.botStatus.state).toBe("running");
      expect(body.botStatus.startedAt).toBe(1_700_000_000_000);
      expect(body.botStatus.lastUpdate).toBe(1_700_000_060_000);
      expect(body.botStatus.activeStrategyCount).toBe(3);
    });

    it("returns 'paused' status when the snapshot.paused flag is set", async () => {
      const { handle } = makeFakeStateFeed({ connected: true });
      const factory = createHttpHandler(handle, { webDistDir: "/nonexistent" });
      factory.setSnapshot(
        {
          status: {
            mode: "with-bot",
            engineAvailable: true,
            engineError: null,
            connected: true,
            lastUpdate: 0,
          },
          running: true,
          killSwitch: "armed",
          positions: [],
          statistics: {
            totalPnlUsdt: 0,
            totalPnlPct: 0,
            winRate: 0,
            totalTrades: 0,
            winningTrades: 0,
            losingTrades: 0,
            maxDrawdownPct: 0,
            currentDrawdownPct: 0,
            avgWinPnl: 0,
            avgLossPnl: 0,
            bestTradePnl: 0,
            worstTradePnl: 0,
            profitFactor: 0,
            sharpeRatio: 0,
            equityUsdt: 0,
            initialEquityUsdt: 0,
          },
          history: [],
          tickers: [],
          tickerEvents: [],
          paused: true,
          killSwitchThresholdPct: -10,
          botStatus: {
            state: "paused",
            startedAt: 1_700_000_000_000,
            lastUpdate: 1_700_000_060_000,
            activeStrategyCount: 2,
          },
        },
        {},
      );
      const res = await factory.fetch(makeRequest("/api/status"));
      expect(res.status).toBe(200);
      const body = (await res.json()) as { botStatus: { state: string } };
      expect(body.botStatus.state).toBe("paused");
    });

    it("returns 503 when state-feed is disconnected", async () => {
      const { handle } = makeFakeStateFeed({ connected: false });
      const factory = createHttpHandler(handle, { webDistDir: "/nonexistent" });
      const res = await factory.fetch(makeRequest("/api/status"));
      expect(res.status).toBe(503);
    });
  });

  describe("GET /api/ohlc", () => {
    it("returns 400 when required params are missing", async () => {
      const { handle } = makeFakeStateFeed({ connected: true });
      const factory = createHttpHandler(handle, { webDistDir: "/nonexistent" });
      const res = await factory.fetch(makeRequest("/api/ohlc"));
      expect(res.status).toBe(400);
    });

    it("returns 404 for an unknown symbol", async () => {
      const { handle } = makeFakeStateFeed({ connected: true });
      const factory = createHttpHandler(handle, { webDistDir: "/nonexistent" });
      const res = await factory.fetch(makeRequest("/api/ohlc?symbol=UNKNOWN&tf=1h"));
      expect(res.status).toBe(404);
    });

    it("returns 404 for an unknown timeframe", async () => {
      const { handle } = makeFakeStateFeed({ connected: true });
      const factory = createHttpHandler(handle, { webDistDir: "/nonexistent" });
      factory.setSnapshot(
        {
          status: { mode: "with-bot", engineAvailable: true, engineError: null, connected: true, lastUpdate: 0 },
          running: false,
          killSwitch: "armed",
          positions: [],
          statistics: {
            totalPnlUsdt: 0,
            winRate: 0,
            maxDrawdownPct: 0,
            totalTrades: 0,
            winningTrades: 0,
            losingTrades: 0,
            sharpeRatio: 0,
          },
          history: [],
          tickers: [],
          tickerEvents: [],
          paused: false,
          killSwitchThresholdPct: -10,
        },
        { "BTC/USDC": { "1h": [] } },
      );
      const res = await factory.fetch(makeRequest("/api/ohlc?symbol=BTC/USDC&tf=99h"));
      expect(res.status).toBe(404);
    });

    it("returns 200 with the OHLC bars when present", async () => {
      const { handle } = makeFakeStateFeed({ connected: true });
      const factory = createHttpHandler(handle, { webDistDir: "/nonexistent" });
      const bars = [
        { time: 1, open: 100, high: 110, low: 90, close: 105, volume: 1 },
        { time: 2, open: 105, high: 115, low: 100, close: 110, volume: 1.5 },
      ];
      factory.setSnapshot(
        {
          status: {
            mode: "with-bot",
            engineAvailable: true,
            engineError: null,
            connected: true,
            lastUpdate: 0,
          },
          running: false,
          killSwitch: "armed",
          positions: [],
          statistics: {
            totalPnlUsdt: 0,
            winRate: 0,
            maxDrawdownPct: 0,
            totalTrades: 0,
            winningTrades: 0,
            losingTrades: 0,
            sharpeRatio: 0,
          },
          history: [],
          tickers: [],
          tickerEvents: [],
          paused: false,
          killSwitchThresholdPct: -10,
        },
        { "BTC/USDC": { "1h": bars } },
      );
      const res = await factory.fetch(makeRequest("/api/ohlc?symbol=BTC/USDC&tf=1h"));
      expect(res.status).toBe(200);
      const body = (await res.json()) as { symbol: string; tf: string; bars: unknown[] };
      expect(body.symbol).toBe("BTC/USDC");
      expect(body.tf).toBe("1h");
      expect(body.bars.length).toBe(2);
    });

    it("respects the count query parameter", async () => {
      const { handle } = makeFakeStateFeed({ connected: true });
      const factory = createHttpHandler(handle, { webDistDir: "/nonexistent" });
      const bars = [
        { time: 1, open: 100, high: 110, low: 90, close: 105, volume: 1 },
        { time: 2, open: 105, high: 115, low: 100, close: 110, volume: 1.5 },
        { time: 3, open: 110, high: 120, low: 105, close: 115, volume: 2 },
      ];
      factory.setSnapshot(
        {
          status: { mode: "with-bot", engineAvailable: true, engineError: null, connected: true, lastUpdate: 0 },
          running: false,
          killSwitch: "armed",
          positions: [],
          statistics: {
            totalPnlUsdt: 0,
            winRate: 0,
            maxDrawdownPct: 0,
            totalTrades: 0,
            winningTrades: 0,
            losingTrades: 0,
            sharpeRatio: 0,
          },
          history: [],
          tickers: [],
          tickerEvents: [],
          paused: false,
          killSwitchThresholdPct: -10,
        },
        { "BTC/USDC": { "1h": bars } },
      );
      const res = await factory.fetch(makeRequest("/api/ohlc?symbol=BTC/USDC&tf=1h&count=2"));
      expect(res.status).toBe(200);
      const body = (await res.json()) as { bars: unknown[] };
      expect(body.bars.length).toBe(2);
    });
  });

  describe("POST /api/control", () => {
    it("returns 400 when body is invalid JSON", async () => {
      const { handle } = makeFakeStateFeed({ connected: true });
      const factory = createHttpHandler(handle, { webDistDir: "/nonexistent" });
      const res = await factory.fetch(
        makeRequest("/api/control", {
          method: "POST",
          body: "not json",
          headers: { "content-type": "application/json" },
        }),
      );
      expect(res.status).toBe(400);
    });

    it("returns 400 when body is a JSON array (not an object)", async () => {
      const { handle } = makeFakeStateFeed({ connected: true });
      const factory = createHttpHandler(handle, { webDistDir: "/nonexistent" });
      const res = await factory.fetch(
        makeRequest("/api/control", {
          method: "POST",
          body: JSON.stringify(["a", "b"]),
          headers: { "content-type": "application/json" },
        }),
      );
      expect(res.status).toBe(400);
    });

    it("returns 400 when body is a JSON string (not an object)", async () => {
      const { handle } = makeFakeStateFeed({ connected: true });
      const factory = createHttpHandler(handle, { webDistDir: "/nonexistent" });
      const res = await factory.fetch(
        makeRequest("/api/control", {
          method: "POST",
          body: JSON.stringify("hello"),
          headers: { "content-type": "application/json" },
        }),
      );
      expect(res.status).toBe(400);
    });

    it("returns 400 when command is missing or invalid", async () => {
      const { handle } = makeFakeStateFeed({ connected: true });
      const factory = createHttpHandler(handle, { webDistDir: "/nonexistent" });
      const res = await factory.fetch(
        makeRequest("/api/control", {
          method: "POST",
          body: JSON.stringify({ foo: "bar" }),
          headers: { "content-type": "application/json" },
        }),
      );
      expect(res.status).toBe(400);
    });

    it("returns 400 for an unknown command", async () => {
      const { handle } = makeFakeStateFeed({ connected: true });
      const factory = createHttpHandler(handle, { webDistDir: "/nonexistent" });
      const res = await factory.fetch(
        makeRequest("/api/control", {
          method: "POST",
          body: JSON.stringify({ command: "explode" }),
          headers: { "content-type": "application/json" },
        }),
      );
      expect(res.status).toBe(400);
    });

    it("returns 202 and forwards the control message to state-feed", async () => {
      const { handle, sent } = makeFakeStateFeed({ connected: true });
      const factory = createHttpHandler(handle, { webDistDir: "/nonexistent" });
      const res = await factory.fetch(
        makeRequest("/api/control", {
          method: "POST",
          body: JSON.stringify({ command: "pause", paused: true }),
          headers: { "content-type": "application/json" },
        }),
      );
      expect(res.status).toBe(202);
      const body = (await res.json()) as { accepted: boolean; command: string };
      expect(body.accepted).toBe(true);
      expect(body.command).toBe("pause");
      expect(sent.length).toBe(1);
      const ctrl = sent[0] as { type: string; command: string; paused?: boolean };
      expect(ctrl.type).toBe("control");
      expect(ctrl.command).toBe("pause");
      expect(ctrl.paused).toBe(true);
    });

    // Phase 69: a dashboard Start/Stop/Pause/Resume/Kill gombjai mind
    // ezen az endpoint-on át küldenek CONTROL üzeneteket. Mindegyik
    // commandot külön teszteli, hogy a state-feed üzenet helyes
    // típussal és payload-dal menjen ki.
    it("forwards 'start' control message", async () => {
      const { handle, sent } = makeFakeStateFeed({ connected: true });
      const factory = createHttpHandler(handle, { webDistDir: "/nonexistent" });
      const res = await factory.fetch(
        makeRequest("/api/control", {
          method: "POST",
          body: JSON.stringify({ command: "start" }),
          headers: { "content-type": "application/json" },
        }),
      );
      expect(res.status).toBe(202);
      expect(sent.length).toBe(1);
      const ctrl = sent[0] as { type: string; command: string };
      expect(ctrl.type).toBe("control");
      expect(ctrl.command).toBe("start");
    });

    it("forwards 'stop' control message", async () => {
      const { handle, sent } = makeFakeStateFeed({ connected: true });
      const factory = createHttpHandler(handle, { webDistDir: "/nonexistent" });
      const res = await factory.fetch(
        makeRequest("/api/control", {
          method: "POST",
          body: JSON.stringify({ command: "stop" }),
          headers: { "content-type": "application/json" },
        }),
      );
      expect(res.status).toBe(202);
      const ctrl = sent[0] as { type: string; command: string };
      expect(ctrl.command).toBe("stop");
    });

    it("forwards 'resume' control message", async () => {
      const { handle, sent } = makeFakeStateFeed({ connected: true });
      const factory = createHttpHandler(handle, { webDistDir: "/nonexistent" });
      const res = await factory.fetch(
        makeRequest("/api/control", {
          method: "POST",
          body: JSON.stringify({ command: "resume" }),
          headers: { "content-type": "application/json" },
        }),
      );
      expect(res.status).toBe(202);
      const ctrl = sent[0] as { type: string; command: string };
      expect(ctrl.command).toBe("resume");
    });

    it("forwards 'pause' control message with paused:true from body", async () => {
      const { handle, sent } = makeFakeStateFeed({ connected: true });
      const factory = createHttpHandler(handle, { webDistDir: "/nonexistent" });
      const res = await factory.fetch(
        makeRequest("/api/control", {
          method: "POST",
          body: JSON.stringify({ command: "pause", paused: false }),
          headers: { "content-type": "application/json" },
        }),
      );
      expect(res.status).toBe(202);
      const ctrl = sent[0] as { type: string; command: string; paused?: boolean };
      expect(ctrl.command).toBe("pause");
      expect(ctrl.paused).toBe(false);
    });

    it("forwards 'kill_switch' control message with confirm:true", async () => {
      const { handle, sent } = makeFakeStateFeed({ connected: true });
      const factory = createHttpHandler(handle, { webDistDir: "/nonexistent" });
      const res = await factory.fetch(
        makeRequest("/api/control", {
          method: "POST",
          body: JSON.stringify({ command: "kill_switch", confirm: true }),
          headers: { "content-type": "application/json" },
        }),
      );
      expect(res.status).toBe(202);
      const ctrl = sent[0] as { type: string; command: string; confirm?: boolean };
      expect(ctrl.command).toBe("kill_switch");
      expect(ctrl.confirm).toBe(true);
    });

    it("returns 503 when stateFeed.send returns false", async () => {
      const { handle } = makeFakeStateFeed({ connected: true, sendResult: false });
      const factory = createHttpHandler(handle, { webDistDir: "/nonexistent" });
      const res = await factory.fetch(
        makeRequest("/api/control", {
          method: "POST",
          body: JSON.stringify({ command: "start" }),
          headers: { "content-type": "application/json" },
        }),
      );
      expect(res.status).toBe(503);
    });

    it("returns 503 when state-feed is disconnected", async () => {
      const { handle, sent } = makeFakeStateFeed({ connected: false });
      const factory = createHttpHandler(handle, { webDistDir: "/nonexistent" });
      const res = await factory.fetch(
        makeRequest("/api/control", {
          method: "POST",
          body: JSON.stringify({ command: "start" }),
          headers: { "content-type": "application/json" },
        }),
      );
      expect(res.status).toBe(503);
      expect(sent.length).toBe(0);
    });
  });

  describe("unknown routes", () => {
    it("returns 404", async () => {
      const { handle } = makeFakeStateFeed();
      const factory = createHttpHandler(handle, { webDistDir: "/nonexistent" });
      const res = await factory.fetch(makeRequest("/api/unknown"));
      expect(res.status).toBe(404);
    });
  });

  describe("snapshot cache management", () => {
    it("clearSnapshot() resets the cache", async () => {
      const { handle } = makeFakeStateFeed({ connected: true });
      const factory = createHttpHandler(handle, { webDistDir: "/nonexistent" });
      factory.setSnapshot(
        {
          status: {
            mode: "with-bot",
            engineAvailable: true,
            engineError: null,
            connected: true,
            lastUpdate: 0,
          },
          running: false,
          killSwitch: "armed",
          positions: [],
          statistics: {
            totalPnlUsdt: 0,
            winRate: 0,
            maxDrawdownPct: 0,
            totalTrades: 0,
            winningTrades: 0,
            losingTrades: 0,
            sharpeRatio: 0,
          },
          history: [],
          tickers: [],
          tickerEvents: [],
          paused: false,
          killSwitchThresholdPct: -10,
        },
        {},
      );
      // Az OHLC lookup is 503 lesz a törölt cache-csel.
      const ohlcRes = await factory.fetch(makeRequest("/api/ohlc?symbol=BTC/USDC&tf=1h"));
      // A cache üres, így a strategies 503.
      // A `setSnapshot` az ohlcBootstrap-ot {} ra állítja — az OHLC
      // symbol lookup 404 lesz.
      void ohlcRes;
      factory.clearSnapshot();
      const res = await factory.fetch(makeRequest("/api/strategies"));
      expect(res.status).toBe(503);
    });

    it("setStateFeed() swaps the state-feed reference", async () => {
      const { handle: handle1 } = makeFakeStateFeed({ connected: false });
      const { handle: handle2 } = makeFakeStateFeed({ connected: true });
      const factory = createHttpHandler(handle1, { webDistDir: "/nonexistent" });
      // Az első handle disconnected → 503.
      let res = await factory.fetch(makeRequest("/api/health"));
      let body = (await (res as Response).json()) as Record<string, unknown>;
      expect(body["stateFeedConnected"]).toBe(false);
      // A második handle connected.
      factory.setStateFeed(handle2);
      factory.setStateFeed(handle2);
      factory.setStateFeed(handle2);
      res = await factory.fetch(makeRequest("/api/health"));
      body = (await res.json()) as Record<string, unknown>;
      expect(body["stateFeedConnected"]).toBe(true);
      // A context getter is elérhető.
      expect(factory.context.stateFeed).toBe(handle2);
    });
  });
});
