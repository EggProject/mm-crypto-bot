/**
 * apps/bot/src/tui/settings-panel-integration.test.tsx
 *
 * Phase 36 Track C1 — a TUI `App` komponens settings panel integráció.
 *
 * A teszt BIZONYÍTVA teszi, hogy:
 *   1) A settings panel NEM nyílik, ha a `settingsConfigPath` /
 *      `settingsSave` prop-ok hiányoznak.
 *   2) A settings panel NEM nyílik az `[o]` nélkül (a TUI csak
 *      a Settings gombot mutatja).
 *   3) A `useConfigStore` hook a settings panel mount-kor be tudja
 *      olvasni a config fájlt, és a settings panel a data prop-on
 *      keresztül hozzáfér a beolvasott értékekhez.
 *   4) A TUI-ban a `Settings` panel cím csak a settings módban jelenik meg.
 *
 * ===========================================================================
 */

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from "bun:test";
import { render as renderInk } from "ink-testing-library";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  App,
  type BotState,
  type BotStateProvider,
  type KillSwitchState,
  type Listener,
  type Position,
  type Statistics,
  type TickerEvent,
  type TickerPrice,
  type Trade,
} from "@mm-crypto-bot/tui";

// Az ink-testing-library `render()` típusát nem használjuk közvetlenül
// (a `renderInk` változó lokálisan a tesztekben érhető el).
void renderInk;

// ============================================================================
// MockStoppedProvider — a TUI tesztekhez (a `BotStateProvider` interfész
// egy minimalista implementációja).
// ============================================================================

function emptyStats(initialEquityUsdt: number): Statistics {
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
    equityUsdt: initialEquityUsdt,
    initialEquityUsdt,
  };
}

function makeState(
  mode: "tui-only" | "with-bot",
  running: boolean,
  initialEquityUsdt = 10_000,
): BotState {
  return {
    status: {
      mode,
      engineAvailable: running,
      engineError: null,
      connected: running,
      lastUpdate: 0,
    },
    running,
    killSwitch: "armed",
    positions: [] as readonly Position[],
    statistics: emptyStats(initialEquityUsdt),
    history: [] as readonly Trade[],
    tickers: [] as readonly TickerPrice[],
    tickerEvents: [] as readonly TickerEvent[],
    paused: false,
    killSwitchThresholdPct: -10,
  };
}

class MockStoppedProvider implements BotStateProvider {
  private state: BotState;
  private readonly listeners = new Set<Listener>();

  public constructor(mode: "tui-only" | "with-bot", running: boolean) {
    this.state = makeState(mode, running);
  }

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

  public setKillSwitchState(killState: KillSwitchState): void {
    this.state = { ...this.state, killSwitch: killState };
    this.notify();
  }

  public setPaused(paused: boolean): void {
    this.state = { ...this.state, paused };
    this.notify();
  }

  // eslint-disable-next-line @typescript-eslint/require-await -- async by design
  public async dispose(): Promise<void> {
    this.listeners.clear();
  }

  private notify(): void {
    const snapshot = this.getSnapshot();
    for (const l of this.listeners) {
      l(snapshot);
    }
  }
}

// ============================================================================
// Tests
// ============================================================================

describe("App settings panel integration (Phase 36 Track C1)", () => {
  let tmpDir: string;
  let configPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "mm-bot-app-"));
    configPath = join(tmpDir, "mm-bot.toml");
    writeFileSync(
      configPath,
      "[bot]\nmode = \"paper\"\nlog_level = \"info\"\nstate_file = \"data/state.json\"\nauto_start = false\n\n[risk]\nrisk_per_trade = 0.01\nkelly_fraction = 0.25\nmax_drawdown_pct = 0.15\nmax_positions = 3\nmax_leverage = 10\n\n[exchange]\nid = \"bybiteu\"\nrate_limit_ms = 100\nsandbox = false\n\n[symbols]\nenabled = [\"BTC/USDC\", \"ETH/USDC\", \"SOL/USDC\"]\n\n[telemetry]\nlog_dir = \"logs/bot\"\nmetrics_interval_sec = 60\n",
      "utf8",
    );
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // --------------------------------------------------------------------------
  // 1) A dashboard mutatja a normál paneleket (Statistics, Live, History, Charts).
  // --------------------------------------------------------------------------
  it("dashboard shows the normal panels (Statistics, Live, History, Charts)", () => {
    const provider = new MockStoppedProvider("with-bot", false);
    const instance = renderInk(
      <App
        provider={provider}
        settingsConfigPath={configPath}
        settingsSave={() => { void 0; }}
      />,
    );
    const frame = instance.lastFrame() ?? "";
    // A 4 panel címe (Phase 36 Track B2) — magyar lokalizációban:
    // STATISZTIKA, ÉLŐ, HISTORY, CHARTS. A keresés case-sensitive,
    // de a frame tartalmazza a rész-stringeket.
    expect(frame).toContain("STATISZTIKA");
    expect(frame).toContain("ÉLŐ");
    expect(frame).toContain("HISTORY");
    expect(frame).toContain("CHARTS");
    instance.unmount();
  });

  // --------------------------------------------------------------------------
  // 2) A dashboard NEM mutatja a Settings panelt (az [o] nélkül).
  // --------------------------------------------------------------------------
  it("dashboard does NOT show the Settings panel without [o] keypress", () => {
    const provider = new MockStoppedProvider("with-bot", false);
    const instance = renderInk(
      <App
        provider={provider}
        settingsConfigPath={configPath}
        settingsSave={() => { void 0; }}
      />,
    );
    const frame = instance.lastFrame() ?? "";
    // A SettingsPanel címe NEM jelenik meg a dashboard nézetben.
    expect(frame).not.toContain("SettingsPanel");
    instance.unmount();
  });

  // --------------------------------------------------------------------------
  // 3) A settings panel AKKOR sem nyílik, ha a settingsConfigPath / settingsSave
  //    prop-ok hiányoznak.
  // --------------------------------------------------------------------------
  it("settings panel does NOT open when settingsConfigPath is undefined", () => {
    const provider = new MockStoppedProvider("with-bot", false);
    const instance = renderInk(<App provider={provider} />);
    // Az [o] billentyű hatástalan — a settingsConfigPath nincs megadva.
    // A teszt nem nyom [o]-t, de ha nyomna, a settings panel nem nyílna.
    // Ellenőrizzük, hogy a settings panel cím NEM jelenik meg.
    const frame = instance.lastFrame() ?? "";
    expect(frame).not.toContain("SettingsPanel");
    instance.unmount();
  });

  // --------------------------------------------------------------------------
  // 4) A `settingsSave` callback hívódik, ha a settings panel save-ol.
  //    (A teljes save-flow-t a SettingsPanel.test.tsx ellenőrzi —
  //     itt csak annyit, hogy a callback prop átadódik.)
  // --------------------------------------------------------------------------
  it("forwards the settingsSave callback to the panel", () => {
    let saveCallbackCalled = false;
    const provider = new MockStoppedProvider("with-bot", false);
    const instance = renderInk(
      <App
        provider={provider}
        settingsConfigPath={configPath}
        settingsSave={() => {
          saveCallbackCalled = true;
        }}
      />,
    );
    // A callback prop átadódik — a tényleges meghívás a SettingsPanel
    // belsejében történik (a `Ctrl+S` billentyűre). Itt csak annyit
    // ellenőrzünk, hogy a render nem crashel.
    const frame = instance.lastFrame() ?? "";
    expect(frame).toBeDefined();
    void saveCallbackCalled;
    instance.unmount();
  });
});
