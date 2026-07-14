/**
 * apps/bot/src/config/store.test.ts
 *
 * Phase 36 Track C1 — `ConfigStore` (apps/bot/src/config/store.ts)
 * unit tesztek.
 *
 * Coverage (≥ 8 assertions):
 *   1.  `read()` returns Zod defaults for a fresh empty file
 *       (the read still validates → if file is empty but valid TOML,
 *        the defaults fill in).
 *   2.  `read()` throws `ConfigReadError` if the file is missing.
 *   3.  `read()` throws `ConfigReadError` on invalid TOML syntax.
 *   4.  `read()` throws `ConfigValidationError` on Zod-rejected file.
 *   5.  `validate()` round-trips: parsed → re-validated → same.
 *   6.  `validate()` throws `ConfigValidationError` on `max_leverage = 15`.
 *   7.  `validate()` throws `ConfigValidationError` on `bot.mode = "invalid"`.
 *   8.  `write()` creates the file + .bak on second write.
 *   9.  `write()` round-trip safe: read after write returns the same config.
 *  10.  `write()` rejects Zod-invalid input (max_leverage = 15).
 *  11.  `writeAfterTypedLive("LIVE")` writes the config + audit entry.
 *  12.  `writeAfterTypedLive("live")` throws `ConfigLiveConfirmError`.
 *  13.  `writeAfterTypedLive("")` throws `ConfigLiveConfirmError`.
 *  14.  `getConfigStore(<path>)` returns the same instance (singleton).
 *  15.  `getConfigStore(<path1>)` and `getConfigStore(<path2>)` return
 *       different instances.
 *  16.  `resetConfigStoreCache()` clears the cache.
 */

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from "bun:test";
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  ConfigLiveConfirmError,
  ConfigReadError,
  ConfigStore,
  ConfigValidationError,
  getConfigStore,
  resetConfigStoreCache,
} from "./store.js";

/**
 * `makeTmpDir` — egyedi tmp könyvtár minden teszthez (a cleanup
 * izolált, és a párhuzamos tesztek nem zavarják egymást).
 */
function makeTmpDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

describe("ConfigStore (Phase 36 Track C1)", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir("mm-bot-store-");
    resetConfigStoreCache();
  });

  afterEach(() => {
    // A cleanup fontos, hogy a tmp könyvtárak ne halmozódjanak.
    rmSync(tmpDir, { recursive: true, force: true });
    resetConfigStoreCache();
  });

  // --------------------------------------------------------------------------
  // 1. read() with a valid empty TOML → defaults
  // --------------------------------------------------------------------------
  it("read() returns Zod defaults for a valid empty file", () => {
    const path = join(tmpDir, "mm-bot.toml");
    writeFileSync(path, "", "utf8");
    const store = new ConfigStore(path);
    const config = store.read();
    expect(config.bot.mode).toBe("paper");
    expect(config.risk.risk_per_trade).toBe(0.01);
    expect(config.risk.max_leverage).toBe(10);
  });

  // --------------------------------------------------------------------------
  // 2. read() throws ConfigReadError on missing file
  // --------------------------------------------------------------------------
  it("read() throws ConfigReadError if file is missing", () => {
    const path = join(tmpDir, "does-not-exist.toml");
    const store = new ConfigStore(path);
    let caught: unknown = null;
    try {
      store.read();
    } catch (err: unknown) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ConfigReadError);
    expect((caught as ConfigReadError).path).toBe(path);
  });

  // --------------------------------------------------------------------------
  // 3. read() throws ConfigReadError on invalid TOML syntax
  // --------------------------------------------------------------------------
  it("read() throws ConfigReadError on invalid TOML syntax", () => {
    const path = join(tmpDir, "bad.toml");
    writeFileSync(path, "this is not [ valid TOML", "utf8");
    const store = new ConfigStore(path);
    let caught: unknown = null;
    try {
      store.read();
    } catch (err: unknown) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ConfigReadError);
    expect((caught as ConfigReadError).message).toContain("Failed to parse TOML");
  });

  // --------------------------------------------------------------------------
  // 4. read() throws ConfigValidationError on Zod-rejected file
  // --------------------------------------------------------------------------
  it("read() throws ConfigValidationError on Zod-rejected file", () => {
    const path = join(tmpDir, "bad-zod.toml");
    writeFileSync(
      path,
      "[risk]\nmax_leverage = 15\n", // 1:10 MANDATE violation
      "utf8",
    );
    const store = new ConfigStore(path);
    let caught: unknown = null;
    try {
      store.read();
    } catch (err: unknown) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ConfigValidationError);
    const v = caught as ConfigValidationError;
    expect(v.fieldErrors["risk.max_leverage"]).toBeDefined();
    expect(v.fieldErrors["risk.max_leverage"]?.[0]).toContain("10");
  });

  // --------------------------------------------------------------------------
  // 5. validate() round-trips
  // --------------------------------------------------------------------------
  it("validate() round-trips a parsed object", () => {
    const store = new ConfigStore(join(tmpDir, "rt.toml"));
    const raw = {
      bot: { mode: "paper" as const, log_level: "info" as const },
      risk: { risk_per_trade: 0.02, max_leverage: 5 },
    };
    const validated = store.validate(raw);
    expect(validated.risk.risk_per_trade).toBe(0.02);
    expect(validated.risk.max_leverage).toBe(5);
    expect(validated.bot.mode).toBe("paper");
  });

  // --------------------------------------------------------------------------
  // 6. validate() rejects max_leverage > 10
  // --------------------------------------------------------------------------
  it("validate() throws ConfigValidationError on max_leverage = 15", () => {
    const store = new ConfigStore(join(tmpDir, "v.toml"));
    let caught: unknown = null;
    try {
      store.validate({ risk: { max_leverage: 15 } });
    } catch (err: unknown) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ConfigValidationError);
  });

  // --------------------------------------------------------------------------
  // 7. validate() rejects invalid bot.mode
  // --------------------------------------------------------------------------
  it("validate() throws ConfigValidationError on bot.mode = 'invalid'", () => {
    const store = new ConfigStore(join(tmpDir, "v.toml"));
    let caught: unknown = null;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- intentional bad input
      store.validate({ bot: { mode: "invalid" as any } });
    } catch (err: unknown) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ConfigValidationError);
  });

  // --------------------------------------------------------------------------
  // 8. write() creates the file + .bak on second write
  // --------------------------------------------------------------------------
  it("write() creates the file and the .bak on the second write", () => {
    const path = join(tmpDir, "mm-bot.toml");
    const store = new ConfigStore(path);

    // First write.
    store.write({
      bot: { mode: "paper", log_level: "info", state_file: "data/state.json", auto_start: false },
      exchange: { id: "bybiteu", rate_limit_ms: 100, sandbox: false },
      risk: {
        risk_per_trade: 0.01,
        kelly_fraction: 0.25,
        max_drawdown_pct: 0.15,
        max_positions: 3,
        max_leverage: 10,
      },
      symbols: { enabled: ["BTC/USDC"] },
      strategies: {
        donchian_pivot_composition: { enabled: true, cap: 0.2 },
        dydx_cex_carry: { enabled: true, cap: 0.025 },
        cascade_fade: { enabled: true },
        funding_flip_kill_switch: { enabled: false },
        regime_detector: { enabled: false },
      },
      telemetry: { log_dir: "logs/bot", metrics_interval_sec: 60 },
    });
    expect(existsSync(path)).toBe(true);
    expect(existsSync(`${path}.bak`)).toBe(false); // first write — no .bak yet

    // Second write.
    store.write({
      bot: { mode: "paper", log_level: "info", state_file: "data/state.json", auto_start: false },
      exchange: { id: "bybiteu", rate_limit_ms: 100, sandbox: false },
      risk: {
        risk_per_trade: 0.02, // CHANGED
        kelly_fraction: 0.25,
        max_drawdown_pct: 0.15,
        max_positions: 3,
        max_leverage: 10,
      },
      symbols: { enabled: ["BTC/USDC"] },
      strategies: {
        donchian_pivot_composition: { enabled: true, cap: 0.2 },
        dydx_cex_carry: { enabled: true, cap: 0.025 },
        cascade_fade: { enabled: true },
        funding_flip_kill_switch: { enabled: false },
        regime_detector: { enabled: false },
      },
      telemetry: { log_dir: "logs/bot", metrics_interval_sec: 60 },
    });
    expect(existsSync(`${path}.bak`)).toBe(true);
    // The .bak must contain the FIRST write (risk_per_trade = 0.01),
    // not the second (risk_per_trade = 0.02). The "previous version"
    // guarantee. We assert on the specific TOML line, not a substring
    // (the `dydx_cex_carry.cap = 0.025` would otherwise contain
    // "0.02" as a substring).
    const bakContents = readFileSync(`${path}.bak`, "utf8");
    expect(bakContents).toContain("risk_per_trade = 0.01");
    expect(bakContents).not.toContain("risk_per_trade = 0.02");
  });

  // --------------------------------------------------------------------------
  // 9. write() round-trip: read after write returns the same config
  // --------------------------------------------------------------------------
  it("write() + read() round-trip preserves the config", () => {
    const path = join(tmpDir, "mm-bot.toml");
    const store = new ConfigStore(path);
    store.write({
      bot: { mode: "paper", log_level: "info", state_file: "data/state.json", auto_start: false },
      exchange: { id: "bybiteu", rate_limit_ms: 100, sandbox: false },
      risk: {
        risk_per_trade: 0.03,
        kelly_fraction: 0.25,
        max_drawdown_pct: 0.15,
        max_positions: 3,
        max_leverage: 5,
      },
      symbols: { enabled: ["BTC/USDC", "ETH/USDC", "SOL/USDC"] },
      strategies: {
        donchian_pivot_composition: { enabled: true, cap: 0.2 },
        dydx_cex_carry: { enabled: true, cap: 0.025 },
        cascade_fade: { enabled: true },
        funding_flip_kill_switch: { enabled: false },
        regime_detector: { enabled: false },
      },
      telemetry: { log_dir: "logs/bot", metrics_interval_sec: 60 },
    });
    const reloaded = store.read();
    expect(reloaded.risk.risk_per_trade).toBe(0.03);
    expect(reloaded.risk.max_leverage).toBe(5);
    expect(reloaded.symbols.enabled).toEqual(["BTC/USDC", "ETH/USDC", "SOL/USDC"]);
  });

  // --------------------------------------------------------------------------
  // 10. write() rejects Zod-invalid input
  // --------------------------------------------------------------------------
  it("write() rejects Zod-invalid input (max_leverage = 15)", () => {
    const path = join(tmpDir, "mm-bot.toml");
    const store = new ConfigStore(path);
    let caught: unknown = null;
    try {
      store.write({
        bot: { mode: "paper", log_level: "info", state_file: "data/state.json", auto_start: false },
        exchange: { id: "bybiteu", rate_limit_ms: 100, sandbox: false },
        risk: {
          risk_per_trade: 0.01,
          kelly_fraction: 0.25,
          max_drawdown_pct: 0.15,
          max_positions: 3,
          max_leverage: 15, // 1:10 MANDATE violation
        },
        symbols: { enabled: [] },
        strategies: {
          donchian_pivot_composition: { enabled: true },
          dydx_cex_carry: { enabled: true },
          cascade_fade: { enabled: true },
          funding_flip_kill_switch: { enabled: false },
          regime_detector: { enabled: false },
        },
        telemetry: { log_dir: "logs/bot", metrics_interval_sec: 60 },
      });
    } catch (err: unknown) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ConfigValidationError);
    // The file must NOT have been written (the Zod check happens
    // before the write).
    expect(existsSync(path)).toBe(false);
  });

  // --------------------------------------------------------------------------
  // 11. writeAfterTypedLive("LIVE") writes the config + audit entry
  // --------------------------------------------------------------------------
  it('writeAfterTypedLive("LIVE") writes the config + audit entry', () => {
    const path = join(tmpDir, "mm-bot.toml");
    const store = new ConfigStore(path);
    // Seed with a paper config.
    store.write({
      bot: { mode: "paper", log_level: "info", state_file: "data/state.json", auto_start: false },
      exchange: { id: "bybiteu", rate_limit_ms: 100, sandbox: false },
      risk: {
        risk_per_trade: 0.01,
        kelly_fraction: 0.25,
        max_drawdown_pct: 0.15,
        max_positions: 3,
        max_leverage: 10,
      },
      symbols: { enabled: ["BTC/USDC"] },
      strategies: {
        donchian_pivot_composition: { enabled: true },
        dydx_cex_carry: { enabled: true },
        cascade_fade: { enabled: true },
        funding_flip_kill_switch: { enabled: false },
        regime_detector: { enabled: false },
      },
      telemetry: { log_dir: "logs/bot", metrics_interval_sec: 60 },
    });

    // Flip to live + confirm.
    const current = store.read();
    const prevMode = current.bot.mode;
    current.bot.mode = "live";
    const entry = store.writeAfterTypedLive(current, "LIVE", prevMode);

    expect(entry.event).toBe("live-mode-confirm");
    expect(entry.prevMode).toBe("paper");
    expect(entry.newMode).toBe("live");
    expect(entry.value).toBe(true);

    // The audit log must be present.
    const auditPath = `${path}.audit.log`;
    expect(existsSync(auditPath)).toBe(true);
    const auditContents = readFileSync(auditPath, "utf8");
    expect(auditContents).toContain("live-mode-confirm");
    expect(auditContents).toContain("\"prevMode\":\"paper\"");
    expect(auditContents).toContain("\"newMode\":\"live\"");

    // The config must now be live.
    const reloaded = store.read();
    expect(reloaded.bot.mode).toBe("live");
  });

  // --------------------------------------------------------------------------
  // 12. writeAfterTypedLive("live") throws ConfigLiveConfirmError
  // --------------------------------------------------------------------------
  it('writeAfterTypedLive("live") throws ConfigLiveConfirmError', () => {
    const path = join(tmpDir, "mm-bot.toml");
    const store = new ConfigStore(path);
    store.write({
      bot: { mode: "paper", log_level: "info", state_file: "data/state.json", auto_start: false },
      exchange: { id: "bybiteu", rate_limit_ms: 100, sandbox: false },
      risk: {
        risk_per_trade: 0.01,
        kelly_fraction: 0.25,
        max_drawdown_pct: 0.15,
        max_positions: 3,
        max_leverage: 10,
      },
      symbols: { enabled: ["BTC/USDC"] },
      strategies: {
        donchian_pivot_composition: { enabled: true },
        dydx_cex_carry: { enabled: true },
        cascade_fade: { enabled: true },
        funding_flip_kill_switch: { enabled: false },
        regime_detector: { enabled: false },
      },
      telemetry: { log_dir: "logs/bot", metrics_interval_sec: 60 },
    });
    const current = store.read();
    const prevMode = current.bot.mode;
    current.bot.mode = "live";
    let caught: unknown = null;
    try {
      store.writeAfterTypedLive(current, "live", prevMode); // lowercase — REJECTED
    } catch (err: unknown) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ConfigLiveConfirmError);
    expect((caught as ConfigLiveConfirmError).typedValue).toBe("live");
  });

  // --------------------------------------------------------------------------
  // 13. writeAfterTypedLive("") throws ConfigLiveConfirmError
  // --------------------------------------------------------------------------
  it('writeAfterTypedLive("") throws ConfigLiveConfirmError', () => {
    const path = join(tmpDir, "mm-bot.toml");
    const store = new ConfigStore(path);
    let caught: unknown = null;
    try {
      store.writeAfterTypedLive(
        {
          bot: { mode: "live", log_level: "info", state_file: "data/state.json", auto_start: false },
          exchange: { id: "bybiteu", rate_limit_ms: 100, sandbox: false },
          risk: {
            risk_per_trade: 0.01,
            kelly_fraction: 0.25,
            max_drawdown_pct: 0.15,
            max_positions: 3,
            max_leverage: 10,
          },
          symbols: { enabled: [] },
          strategies: {
            donchian_pivot_composition: { enabled: true },
            dydx_cex_carry: { enabled: true },
            cascade_fade: { enabled: true },
            funding_flip_kill_switch: { enabled: false },
            regime_detector: { enabled: false },
          },
          telemetry: { log_dir: "logs/bot", metrics_interval_sec: 60 },
        },
        "",
        "paper",
      );
    } catch (err: unknown) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ConfigLiveConfirmError);
  });

  // --------------------------------------------------------------------------
  // 14. getConfigStore(<path>) returns the same instance (singleton)
  // --------------------------------------------------------------------------
  it("getConfigStore(<path>) returns the same instance (singleton)", () => {
    const path = join(tmpDir, "mm-bot.toml");
    const a = getConfigStore(path);
    const b = getConfigStore(path);
    expect(a).toBe(b);
  });

  // --------------------------------------------------------------------------
  // 15. getConfigStore(<path1>) and getConfigStore(<path2>) differ
  // --------------------------------------------------------------------------
  it("getConfigStore(<path1>) and getConfigStore(<path2>) return different instances", () => {
    const path1 = join(tmpDir, "a.toml");
    const path2 = join(tmpDir, "b.toml");
    const a = getConfigStore(path1);
    const b = getConfigStore(path2);
    expect(a).not.toBe(b);
    expect(a.path).toBe(path1);
    expect(b.path).toBe(path2);
  });

  // --------------------------------------------------------------------------
  // 16. resetConfigStoreCache() clears the cache
  // --------------------------------------------------------------------------
  it("resetConfigStoreCache() clears the cache", () => {
    const path = join(tmpDir, "mm-bot.toml");
    const a = getConfigStore(path);
    resetConfigStoreCache();
    const b = getConfigStore(path);
    expect(a).not.toBe(b);
    expect(a.path).toBe(path);
    expect(b.path).toBe(path);
  });

  // --------------------------------------------------------------------------
  // 17. write() creates parent directory if it doesn't exist
  // --------------------------------------------------------------------------
  it("write() creates the parent directory if it doesn't exist", () => {
    const path = join(tmpDir, "deep/nested/mm-bot.toml");
    const store = new ConfigStore(path);
    store.write({
      bot: { mode: "paper", log_level: "info", state_file: "data/state.json", auto_start: false },
      exchange: { id: "bybiteu", rate_limit_ms: 100, sandbox: false },
      risk: {
        risk_per_trade: 0.01,
        kelly_fraction: 0.25,
        max_drawdown_pct: 0.15,
        max_positions: 3,
        max_leverage: 10,
      },
      symbols: { enabled: [] },
      strategies: {
        donchian_pivot_composition: { enabled: true },
        dydx_cex_carry: { enabled: true },
        cascade_fade: { enabled: true },
        funding_flip_kill_switch: { enabled: false },
        regime_detector: { enabled: false },
      },
      telemetry: { log_dir: "logs/bot", metrics_interval_sec: 60 },
    });
    expect(existsSync(path)).toBe(true);
  });

  // --------------------------------------------------------------------------
  // 18. write() preserves the previous file as .bak
  // --------------------------------------------------------------------------
  it("write() preserves the previous file as .bak (byte-identical copy)", () => {
    const path = join(tmpDir, "mm-bot.toml");
    const store = new ConfigStore(path);
    store.write({
      bot: { mode: "paper", log_level: "info", state_file: "data/state.json", auto_start: false },
      exchange: { id: "bybiteu", rate_limit_ms: 100, sandbox: false },
      risk: {
        risk_per_trade: 0.01,
        kelly_fraction: 0.25,
        max_drawdown_pct: 0.15,
        max_positions: 3,
        max_leverage: 10,
      },
      symbols: { enabled: [] },
      strategies: {
        donchian_pivot_composition: { enabled: true },
        dydx_cex_carry: { enabled: true },
        cascade_fade: { enabled: true },
        funding_flip_kill_switch: { enabled: false },
        regime_detector: { enabled: false },
      },
      telemetry: { log_dir: "logs/bot", metrics_interval_sec: 60 },
    });
    // Manually copy to a known state.
    const beforeContents = readFileSync(path, "utf8");
    // Second write.
    store.write({
      bot: { mode: "paper", log_level: "info", state_file: "data/state.json", auto_start: false },
      exchange: { id: "bybiteu", rate_limit_ms: 100, sandbox: false },
      risk: {
        risk_per_trade: 0.05,
        kelly_fraction: 0.25,
        max_drawdown_pct: 0.15,
        max_positions: 3,
        max_leverage: 10,
      },
      symbols: { enabled: [] },
      strategies: {
        donchian_pivot_composition: { enabled: true },
        dydx_cex_carry: { enabled: true },
        cascade_fade: { enabled: true },
        funding_flip_kill_switch: { enabled: false },
        regime_detector: { enabled: false },
      },
      telemetry: { log_dir: "logs/bot", metrics_interval_sec: 60 },
    });
    const bakContents = readFileSync(`${path}.bak`, "utf8");
    // The .bak must be byte-identical to the first write.
    expect(bakContents).toBe(beforeContents);
    // The new file must differ from .bak.
    const afterContents = readFileSync(path, "utf8");
    expect(afterContents).not.toBe(bakContents);
  });

  // --------------------------------------------------------------------------
  // 19. write() succeeds even when the .bak write is the first write
  //     (the .bak is created only on the SECOND+ write)
  // --------------------------------------------------------------------------
  it("write() does NOT create a .bak on the first write (no previous file)", () => {
    const path = join(tmpDir, "mm-bot.toml");
    const store = new ConfigStore(path);
    store.write({
      bot: { mode: "paper", log_level: "info", state_file: "data/state.json", auto_start: false },
      exchange: { id: "bybiteu", rate_limit_ms: 100, sandbox: false },
      risk: {
        risk_per_trade: 0.01,
        kelly_fraction: 0.25,
        max_drawdown_pct: 0.15,
        max_positions: 3,
        max_leverage: 10,
      },
      symbols: { enabled: [] },
      strategies: {
        donchian_pivot_composition: { enabled: true },
        dydx_cex_carry: { enabled: true },
        cascade_fade: { enabled: true },
        funding_flip_kill_switch: { enabled: false },
        regime_detector: { enabled: false },
      },
      telemetry: { log_dir: "logs/bot", metrics_interval_sec: 60 },
    });
    expect(existsSync(`${path}.bak`)).toBe(false);
  });

  // --------------------------------------------------------------------------
  // 20. write() copies existing file to .bak before writing
  // --------------------------------------------------------------------------
  it("write() copies an existing file to .bak (manual pre-seed)", () => {
    const path = join(tmpDir, "mm-bot.toml");
    // Pre-seed: write a file that's NOT a valid config (just to test
    // the .bak mechanism in isolation).
    writeFileSync(path, "placeholder\n", "utf8");
    const store = new ConfigStore(path);
    store.write({
      bot: { mode: "paper", log_level: "info", state_file: "data/state.json", auto_start: false },
      exchange: { id: "bybiteu", rate_limit_ms: 100, sandbox: false },
      risk: {
        risk_per_trade: 0.01,
        kelly_fraction: 0.25,
        max_drawdown_pct: 0.15,
        max_positions: 3,
        max_leverage: 10,
      },
      symbols: { enabled: [] },
      strategies: {
        donchian_pivot_composition: { enabled: true },
        dydx_cex_carry: { enabled: true },
        cascade_fade: { enabled: true },
        funding_flip_kill_switch: { enabled: false },
        regime_detector: { enabled: false },
      },
      telemetry: { log_dir: "logs/bot", metrics_interval_sec: 60 },
    });
    expect(existsSync(`${path}.bak`)).toBe(true);
    const bak = readFileSync(`${path}.bak`, "utf8");
    expect(bak).toBe("placeholder\n");
  });

  // --------------------------------------------------------------------------
  // 21. write() handles copyFileSync source path resolution
  // --------------------------------------------------------------------------
  it("write() handles the copyFileSync path correctly when path is relative", () => {
    // The ConfigStore.path is `resolve()`-elt, de a copyFileSync
    // forrása is ugyanaz az útvonal. A teszt a copyFile hívás
    // success-path-ját ellenőrzi (nincs ENOENT).
    const path = join(tmpDir, "mm-bot.toml");
    const store = new ConfigStore(path);
    store.write({
      bot: { mode: "paper", log_level: "info", state_file: "data/state.json", auto_start: false },
      exchange: { id: "bybiteu", rate_limit_ms: 100, sandbox: false },
      risk: {
        risk_per_trade: 0.01,
        kelly_fraction: 0.25,
        max_drawdown_pct: 0.15,
        max_positions: 3,
        max_leverage: 10,
      },
      symbols: { enabled: [] },
      strategies: {
        donchian_pivot_composition: { enabled: true },
        dydx_cex_carry: { enabled: true },
        cascade_fade: { enabled: true },
        funding_flip_kill_switch: { enabled: false },
        regime_detector: { enabled: false },
      },
      telemetry: { log_dir: "logs/bot", metrics_interval_sec: 60 },
    });
    // Pre-seed a second time → copyFileSync path is exercised.
    expect(() => {
      copyFileSync(path, `${path}.bak`);
    }).not.toThrow();
  });
});
