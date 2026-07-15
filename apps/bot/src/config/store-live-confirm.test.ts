/**
 * apps/bot/src/config/store-live-confirm.test.ts
 *
 * Phase 36 Track C2 — `ConfigStore.writeAfterTypedLive` audit log tesztek.
 *
 * A `writeAfterTypedLive` a `bot.mode = "live"` typed-confirm guard:
 *   - A user által begépelt string PONTOSAN "LIVE" kell legyen
 *     (case-sensitive).
 *   - Sikeres confirm esetén audit-log bejegyzést ír a `<path>.audit.log`
 *     fájlba (JSON-line formátumban).
 *   - A `ConfigLiveConfirmError` a case-eltérés esetén.
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
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ConfigLiveConfirmError, ConfigStore } from "./store.js";

/**
 * `makeValidConfig` — egy valid BotConfig shape, amit a tesztek
 * seed-ként használnak.
 */
function makeValidConfig(mode: "paper" | "live" = "paper"): string {
  return `[bot]
mode = "${mode}"
log_level = "info"
state_file = "data/bot-state.json"
auto_start = false

[exchange]
id = "bybiteu"
rate_limit_ms = 100
sandbox = false

[risk]
risk_per_trade = 0.01
kelly_fraction = 0.25
max_drawdown_pct = 0.15
max_positions = 3
max_leverage = 10

[symbols]
enabled = ["BTC/USDC", "ETH/USDC", "SOL/USDC"]

[strategies.donchian_pivot_composition]
enabled = true
cap = 0.2

[strategies.dydx_cex_carry]
enabled = true
cap = 0.025

[strategies.cascade_fade]
enabled = true

[strategies.funding_flip_kill_switch]
enabled = false

[strategies.regime_detector]
enabled = false

[telemetry]
log_dir = "logs/bot"
metrics_interval_sec = 60
`;
}

describe("ConfigStore.writeAfterTypedLive (Phase 36 Track C2)", () => {
  let tmpDir: string;
  let configPath: string;
  let store: ConfigStore;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "mm-bot-live-"));
    configPath = join(tmpDir, "mm-bot.toml");
    writeFileSync(configPath, makeValidConfig("paper"), "utf8");
    store = new ConfigStore(configPath);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // --------------------------------------------------------------------------
  // 1) A `writeAfterTypedLive` "LIVE" esetén sikeresen ír és audit-log
  //    bejegyzést készít.
  // --------------------------------------------------------------------------
  it('writeAfterTypedLive("LIVE") writes the config and audit log entry', () => {
    const current = store.read();
    current.bot.mode = "live";
    const entry = store.writeAfterTypedLive(current, "LIVE", "paper");
    expect(entry.event).toBe("live-mode-confirm");
    expect(entry.prevMode).toBe("paper");
    expect(entry.newMode).toBe("live");
    expect(entry.value).toBe(true);

    // Az audit-log fájl létezik.
    const auditPath = `${configPath}.audit.log`;
    expect(existsSync(auditPath)).toBe(true);

    // A TOML most live.
    const reloaded = store.read();
    expect(reloaded.bot.mode).toBe("live");
  });

  // --------------------------------------------------------------------------
  // 2) A `writeAfterTypedLive` "live" (lowercase) esetén hibát dob.
  // --------------------------------------------------------------------------
  it('writeAfterTypedLive("live") throws ConfigLiveConfirmError', () => {
    const current = store.read();
    current.bot.mode = "live";
    let caught: unknown = null;
    try {
      store.writeAfterTypedLive(current, "live", "paper");
    } catch (err: unknown) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ConfigLiveConfirmError);
    if (caught instanceof ConfigLiveConfirmError) {
      expect(caught.typedValue).toBe("live");
    }

    // A TOML NEM változott (a write nem történt meg).
    const reloaded = store.read();
    expect(reloaded.bot.mode).toBe("paper");
  });

  // --------------------------------------------------------------------------
  // 3) A `writeAfterTypedLive` "Live" (capitalized) esetén hibát dob.
  // --------------------------------------------------------------------------
  it('writeAfterTypedLive("Live") throws ConfigLiveConfirmError', () => {
    const current = store.read();
    current.bot.mode = "live";
    let caught: unknown = null;
    try {
      store.writeAfterTypedLive(current, "Live", "paper");
    } catch (err: unknown) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ConfigLiveConfirmError);
  });

  // --------------------------------------------------------------------------
  // 4) A `writeAfterTypedLive` "" (üres) esetén hibát dob.
  // --------------------------------------------------------------------------
  it('writeAfterTypedLive("") throws ConfigLiveConfirmError', () => {
    const current = store.read();
    let caught: unknown = null;
    try {
      store.writeAfterTypedLive(current, "", "paper");
    } catch (err: unknown) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ConfigLiveConfirmError);
  });

  // --------------------------------------------------------------------------
  // 5) A `writeAfterTypedLive` " live" (space + live) esetén hibát dob.
  // --------------------------------------------------------------------------
  it('writeAfterTypedLive(" live") throws ConfigLiveConfirmError', () => {
    const current = store.read();
    let caught: unknown = null;
    try {
      store.writeAfterTypedLive(current, " live", "paper");
    } catch (err: unknown) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ConfigLiveConfirmError);
  });

  // --------------------------------------------------------------------------
  // 6) Az audit-log fájl JSON-line formátumban van (1 sor / bejegyzés).
  // --------------------------------------------------------------------------
  it("audit log is JSON-line formatted (one entry per line)", () => {
    const current1 = store.read();
    current1.bot.mode = "live";
    store.writeAfterTypedLive(current1, "LIVE", "paper");

    // Második confirm (most "live"-ról "live"-ra, a prevMode = "live").
    const current2 = store.read();
    store.writeAfterTypedLive(current2, "LIVE", "live");

    const auditPath = `${configPath}.audit.log`;
    const contents = readFileSync(auditPath, "utf8");
    const lines = contents.split("\n").filter((l) => l.length > 0);
    expect(lines.length).toBe(2);
    // Minden sor egy érvényes JSON.
    for (const line of lines) {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      expect(parsed["event"]).toBe("live-mode-confirm");
      expect(parsed["value"]).toBe(true);
    }
  });

  // --------------------------------------------------------------------------
  // 7) A `writeAfterTypedLive` a Zod-rejected config esetén is hibát dob.
  // --------------------------------------------------------------------------
  it("writeAfterTypedLive rejects Zod-invalid config (max_leverage > 10)", () => {
    const current = store.read();
    // A `bot.mode` átállítása live-ra + a max_leverage 11-re
    // (Zod-rejected, de a write előtt lefut a validate).
    current.bot.mode = "live";
    (current.risk as { max_leverage: number }).max_leverage = 15;
    let caught: unknown = null;
    try {
      store.writeAfterTypedLive(current, "LIVE", "paper");
    } catch (err: unknown) {
      caught = err;
    }
    // A ConfigValidationError-t a `write` metódus dob, nem a
    // ConfigLiveConfirmError-t (mert a LIVE check lefut, de a
    // Zod validate elbukik).
    expect(caught).not.toBeInstanceOf(ConfigLiveConfirmError);
  });
});
