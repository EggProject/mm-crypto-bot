/**
 * apps/bot/src/tui/log-routing-probe.test.tsx
 *
 * ===========================================================================
 * PHASE 36 TRACK A2 — log routing probe (TUI-bug fix pin-tesztje)
 * ===========================================================================
 *
 * User mandate (2026-07-14 20:58 Budapest, issue #2):
 *   "az [s] billentyűre logok jelentek meg a TUI tetején."
 *
 * A kiváltó ok: a `createLogger` `console.log`-ot hívott, ami a
 * `process.stdout`-ra ír — ez a TUI render surface-e. A Phase 36
 * Track A2 refaktor óta a logger:
 *   - FÁJLBA ír (`logs/bot/bot-YYYY-MM-DD.log`)
 *   - STDERR-re ír (warn + error szintekhez, operátori azonnali láthatóság)
 *   - STDOUT-ot SOHA nem ír (a TUI-bug fix!)
 *
 * Ez a teszt file BIZONYÍTVA teszi, hogy a logger a TUI futása alatt
 * a stdout-ot nem írja — a TUI frame soha nem fog log sort tartalmazni.
 *
 * A tesztek:
 *   1) `createLogger({ noFile: true })` hívásakor a `logger.info()` a
 *      TUI `stdout.lastFrame()`-jében NEM jelenik meg.
 *   2) `createLogger({ logDir: tmpDir, noFile: false })` hívásakor a
 *      `logger.info()` a `bot-YYYY-MM-DD.log` fájlba kerül.
 *   3) A `logger.error()` a `noFile: true` módban a `process.stderr.write`-ot
 *      hívja (operator-facing).
 *
 * A tesztek a `ink-testing-library` `render(<App />)`-ját használják —
 * a TUI mountolása a `logger.info()` hívás ELŐTT és UTÁN is megtörténik,
 * hogy bizonyítsuk: a TUI frame a log sort NEM tartalmazza.
 */

import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { render as renderInk } from "ink-testing-library";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  App,
  type BotState,
  type BotStateProvider,
  type KillSwitchState,
  type Listener,
  type Statistics,
  type TickerEvent,
  type TickerPrice,
} from "@mm-crypto-bot/tui";
import { createLogger } from "@mm-crypto-bot/shared";

/** Az ink-testing-library `render()` visszatérési típusa. */
type InkInstance = ReturnType<typeof renderInk>;

// ============================================================================
// MockProvider — `BotStateProvider` implementáció a TUI mount-hoz
// ============================================================================

function emptyStats(): Statistics {
  return {
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
    equityUsdt: 10_000,
    initialEquityUsdt: 10_000,
  };
}

function emptyState(): BotState {
  return {
    status: {
      mode: "with-bot",
      engineAvailable: false,
      engineError: null,
      connected: false,
      lastUpdate: 0,
    },
    running: false,
    killSwitch: "armed",
    positions: [],
    statistics: emptyStats(),
    history: [],
    tickers: [] as readonly TickerPrice[],
    tickerEvents: [] as readonly TickerEvent[],
    paused: false,
    killSwitchThresholdPct: -10,
  };
}

class MockProvider implements BotStateProvider {
  private state: BotState = emptyState();
  private readonly listeners = new Set<Listener>();
  public subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  public getSnapshot(): BotState {
    return this.state;
  }
  // eslint-disable-next-line @typescript-eslint/require-await -- async by design
  public async start(): Promise<void> {
    this.state = { ...this.state, running: true };
    this.notify();
  }
  // eslint-disable-next-line @typescript-eslint/require-await -- async by design
  public async stop(): Promise<void> {
    this.state = { ...this.state, running: false };
    this.notify();
  }
  // eslint-disable-next-line @typescript-eslint/require-await -- async by design
  public async killSwitch(): Promise<void> {
    this.state = { ...this.state, killSwitch: "triggered" };
    this.notify();
  }
  public setKillSwitchState(s: KillSwitchState): void {
    this.state = { ...this.state, killSwitch: s };
    this.notify();
  }
  public setPaused(p: boolean): void {
    this.state = { ...this.state, paused: p };
    this.notify();
  }
  // eslint-disable-next-line @typescript-eslint/require-await -- async by design
  public async dispose(): Promise<void> {
    this.listeners.clear();
  }
  private notify(): void {
    for (const l of this.listeners) {
      l();
    }
  }
}

// ============================================================================
// Spy helpers
// ============================================================================

/**
 * `spyOnStderr` — a `process.stderr.write` metódust spy-on-ra cseréli.
 * A logger a `process.stderr.write`-ot hívja a `warn`/`error` szintekhez
 * (vagy minden szinthez, ha `noFile: true`).
 */
function spyOnStderr(): { spy: ReturnType<typeof spyOn>; restore: () => void } {
  const orig = process.stderr.write.bind(process.stderr);
  const spy = spyOn(process.stderr, "write").mockImplementation((() => true) as never);
  return {
    spy,
    restore: () => {
      spy.mockRestore();
      process.stderr.write = orig;
    },
  };
}

// ============================================================================
// Tests
// ============================================================================

describe("log-routing probe — TUI-bug fix pin-tesztje (Phase 36 Track A2)", () => {
  let mounted: InkInstance | null = null;
  let provider: MockProvider | null = null;

  beforeEach(() => {
    mounted = null;
    provider = null;
  });

  afterEach(async () => {
    if (mounted !== null) {
      mounted.unmount();
      mounted.cleanup();
    }
    if (provider !== null) {
      await provider.dispose();
    }
  });

  // --------------------------------------------------------------------------
  // 1) A `logger.info("test")` a TUI mount alatt NEM jelenik meg a
  //    `stdout.lastFrame()`-ben.
  //
  //    Ez a Phase 36 Track A2 legfontosabb pin-tesztje: bármilyen
  //    jövőbeli refaktor (pl. véletlenül visszatérés a `console.log`-hoz)
  //    AZONNAL elbukik ezen a teszten.
  // --------------------------------------------------------------------------
  it("logger.info() does NOT appear in the TUI's stdout frame (TUI-bug fix)", async () => {
    // A logger `noFile: true` módban — a fájl-írást kikapcsoljuk,
    // így minden log a `stderr`-re megy. A `stdout`-nak TISZTÁNAK
    // kell maradnia.
    const logger = createLogger({ level: "info", noFile: true });

    // A TUI mountolása a log hívás ELŐTT — biztosítjuk, hogy a TUI
    // render surface-e üres.
    provider = new MockProvider();
    mounted = renderInk(<App provider={provider} />);
    await new Promise<void>((r) => setTimeout(r, 50));
    const frameBefore = mounted.lastFrame() ?? "";
    expect(frameBefore).toContain("mm-crypto-bot TUI");

    // A `logger.info("test")` hívás — a TUI frame-be NEM kerülhet.
    logger.info("test");
    logger.info("this should NOT appear in the TUI");
    logger.warn("nor should this");
    logger.error("nor this either");

    // A TUI mountolása a log hívás UTÁN — bizonyítjuk, hogy a log
    // sorok a TUI render surface-ére nem kerültek.
    const frameAfter = mounted.lastFrame() ?? "";
    expect(frameAfter).not.toContain("test");
    expect(frameAfter).not.toContain("this should NOT appear in the TUI");
    expect(frameAfter).not.toContain("nor should this");
    expect(frameAfter).not.toContain("nor this either");
    // A TUI továbbra is a saját frame-jét mutatja (a "mm-crypto-bot TUI" header).
    expect(frameAfter).toContain("mm-crypto-bot TUI");
  });

  // --------------------------------------------------------------------------
  // 2) A `logger.info("hello")` a `logDir` opcióval a fájlba ír.
  // --------------------------------------------------------------------------
  it("logger.info() writes the entry to a file in the logDir", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "mm-log-routing-"));
    try {
      const logger = createLogger({
        level: "info",
        noFile: false,
        logDir: tmpDir,
        logFileBase: "log-routing",
      });
      logger.info("hello");

      // A `logFileBase-YYYY-MM-DD.log` fájlnak léteznie kell ÉS
      // tartalmaznia kell a "hello" üzenetet.
      const date = new Date().toISOString().slice(0, 10);
      const filePath = join(tmpDir, `log-routing-${date}.log`);
      const content = readFileSync(filePath, "utf8");
      expect(content).toContain("hello");
      // Az entry strukturált (időbélyeg, szint, msg).
      expect(content).toContain('"level":"info"');
      expect(content).toContain('"msg":"hello"');
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  // --------------------------------------------------------------------------
  // 3) A `logger.error("bad")` `noFile: true` módban a `process.stderr.write`-ot hívja.
  //
  //    A `noFile: true` mód a tesztek / CI számára készült — a fájl-írást
  //    kikapcsolja, és minden log a `stderr`-re megy. A spy a `process.stderr.write`
  //    hívását ellenőrzi.
  // --------------------------------------------------------------------------
  it("logger.error() with noFile: true calls process.stderr.write (operator-facing)", () => {
    const { spy, restore } = spyOnStderr();
    try {
      const logger = createLogger({ level: "info", noFile: true });
      logger.error("bad");
      expect(spy).toHaveBeenCalled();
      // A kiírt szöveg tartalmazza a "bad" üzenetet.
      const call = spy.mock.calls[0]!;
      const text = call[0] as string;
      expect(text).toContain("bad");
      // A `process.stderr.write` NEM a `process.stdout.write`-ot hívja —
      // közvetett bizonyíték: a spy nem a stdout-on van.
    } finally {
      restore();
    }
  });

  // --------------------------------------------------------------------------
  // 4) A `logger.info` `noFile: false` módban a `process.stdout`-ot
  //    SOHA nem írja — ez a TUI-bug fix-ének a pin-tesztje a fájl-módban.
  //
  //    A korábbi implementáció `console.log`-ot hívott, ami a stdout-ra
  //    írt. Az új implementáció `appendFileSync`-et használ a fájlba,
  //    és a `process.stderr.write`-ot a stderr-re. A `process.stdout.write`
  //    spy-on bizonyítja, hogy a logger NEM nyúl a stdout-hoz.
  // --------------------------------------------------------------------------
  it("logger does NOT call process.stdout.write in file mode (TUI-bug fix)", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "mm-log-routing-stdout-"));
    const stdoutSpy = spyOn(process.stdout, "write").mockImplementation((() => true) as never);
    try {
      const logger = createLogger({
        level: "info",
        noFile: false,
        logDir: tmpDir,
        logFileBase: "stdout-check",
      });
      logger.info("this should NOT hit stdout");
      logger.error("neither should this");
      // A `process.stdout.write` NEM hívódott meg.
      expect(stdoutSpy).not.toHaveBeenCalled();
    } finally {
      stdoutSpy.mockRestore();
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  // --------------------------------------------------------------------------
  // 5) A `logger.info` `noFile: true` módban is NEM ír a `process.stdout`-ra.
  // --------------------------------------------------------------------------
  it("logger does NOT call process.stdout.write in noFile mode either", () => {
    const stdoutSpy = spyOn(process.stdout, "write").mockImplementation((() => true) as never);
    try {
      const logger = createLogger({ level: "info", noFile: true });
      logger.info("noFile info");
      logger.warn("noFile warn");
      logger.error("noFile error");
      // A `process.stdout.write` NEM hívódott meg.
      expect(stdoutSpy).not.toHaveBeenCalled();
    } finally {
      stdoutSpy.mockRestore();
    }
  });

  // --------------------------------------------------------------------------
  // 6) A logger + TUI együttes futtatása: a TUI mount alatt a logger
  //    `info` hívása NEM szennyezi a TUI frame-jét.
  // --------------------------------------------------------------------------
  it("combined: TUI mount + logger.info() does not pollute the TUI frame", async () => {
    const logger = createLogger({ level: "info", noFile: true });
    provider = new MockProvider();
    mounted = renderInk(<App provider={provider} />);
    await new Promise<void>((r) => setTimeout(r, 50));

    // 10 logger hívás — egyik sem kerülhet a TUI frame-be.
    for (let i = 0; i < 10; i++) {
      logger.info(`message-${String(i)}`, { iteration: i });
    }
    await new Promise<void>((r) => setTimeout(r, 50));

    const frame = mounted.lastFrame() ?? "";
    for (let i = 0; i < 10; i++) {
      expect(frame).not.toContain(`message-${String(i)}`);
    }
    // A TUI továbbra is a saját frame-jét mutatja.
    expect(frame).toContain("mm-crypto-bot TUI");
  });

  // --------------------------------------------------------------------------
  // 7) A logger + TUI együttes futtatása: a `logger.info` hívás a fájlba
  //    ír (noFile: false módban), ÉS a TUI frame TISZTA marad.
  // --------------------------------------------------------------------------
  it("combined: TUI mount + logger.info() in file mode keeps TUI clean AND writes to file", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "mm-log-routing-combined-"));
    try {
      const logger = createLogger({
        level: "info",
        noFile: false,
        logDir: tmpDir,
        logFileBase: "combined",
      });
      provider = new MockProvider();
      mounted = renderInk(<App provider={provider} />);

      logger.info("bot-stopped", { reason: "user-keypress" });
      logger.warn("position-warning", { symbol: "BTC/USDC" });
      logger.error("exchange-error", { code: 401 });

      const frame = mounted?.lastFrame() ?? "";
      // A TUI frame TISZTA — a log sorok egyike sem jelenik meg.
      expect(frame).not.toContain("bot-stopped");
      expect(frame).not.toContain("position-warning");
      expect(frame).not.toContain("exchange-error");
      // A TUI továbbra is a saját frame-jét mutatja.
      expect(frame).toContain("mm-crypto-bot TUI");

      // A fájl TARTALMAZZA a log sorokat.
      const date = new Date().toISOString().slice(0, 10);
      const filePath = join(tmpDir, `combined-${date}.log`);
      const content = readFileSync(filePath, "utf8");
      expect(content).toContain("bot-stopped");
      expect(content).toContain("position-warning");
      expect(content).toContain("exchange-error");
    } finally {
      if (mounted !== null) {
        mounted.unmount();
        mounted.cleanup();
      }
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  // --------------------------------------------------------------------------
  // 8) Trivial Ink app: a logger hívás NEM szennyezi a `stdout`-ot.
  //
  //    Ez a teszt a Phase 36 Track A2 logger refaktor legkisebb pin-tesztje —
  //    a TUI mountolása a logger hívás ELŐTT és UTÁN, és bizonyítjuk,
  //    hogy a TUI frame a log hívás után is TISZTA.
  // --------------------------------------------------------------------------
  it("trivial Ink app: logger.info() does not pollute the trivial stdout frame", async () => {
    const stdoutSpy = spyOn(process.stdout, "write").mockImplementation((() => true) as never);
    try {
      // A TUI mountolása (az `App` a TUI-ból jön — ugyanaz, mint
      // a fenti tesztekben).
      const trivialProvider = new MockProvider();
      const trivialInstance = renderInk(<App provider={trivialProvider} />);
      await new Promise<void>((r) => setTimeout(r, 50));
      const frameBefore = trivialInstance.lastFrame() ?? "";
      expect(frameBefore).toContain("mm-crypto-bot TUI");

      const logger = createLogger({ level: "info", noFile: true });
      logger.info("this should not appear in the trivial Ink app frame");

      // A TUI frame a log hívás UTÁN sem tartalmazza a log üzenetet.
      const frameAfter = trivialInstance.lastFrame() ?? "";
      expect(frameAfter).toContain("mm-crypto-bot TUI");
      expect(frameAfter).not.toContain("this should not appear");

      // A `process.stdout.write` NEM hívódott meg a logger-ből.
      expect(stdoutSpy).not.toHaveBeenCalled();

      trivialInstance.unmount();
      trivialInstance.cleanup();
      void trivialProvider.dispose();
    } finally {
      stdoutSpy.mockRestore();
    }
  });
});
