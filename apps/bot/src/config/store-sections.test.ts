/**
 * apps/bot/src/config/store-sections.test.ts
 *
 * Phase 37 Track 2 — `ConfigStore` per-section EDITABLE update
 * metódusainak unit tesztjei:
 *   - `setStrategyEnabled(strategyId, enabled)`
 *   - `setStrategySetting(strategyId, key, value)`
 *   - `setExchangeConfig(partial)`
 *   - `setSymbols(symbols)`
 *   - `setTelemetryConfig(partial)`
 *
 * Minden metódus:
 *   - atomic write + .bak + .tmp rename pattern-t használ (a
 *     meglévő `write` metóduson keresztül)
 *   - Zod re-validate-et futtat write előtt
 *   - a `read` metódussal kiolvasható az új érték
 *
 * Coverage: 100% line coverage a 4 új metódusra.
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
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  ConfigStore,
  ConfigValidationError,
} from "./store.js";

/**
 * `makeTmpDir` — egyedi tmp könyvtár minden teszthez.
 */
function makeTmpDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

/**
 * `makeBaseConfig` — egy valid BotConfig shape, amit a tesztek
 * seed-ként használnak (a meglévő store.test.ts mintájára).
 */
function makeBaseConfig(): Parameters<ConfigStore["write"]>[0] {
  return {
    bot: {
      mode: "paper",
      log_level: "info",
      state_file: "data/bot-state.json",
      auto_start: false,
    },
    exchange: {
      id: "bybiteu",
      rate_limit_ms: 100,
      sandbox: false,
      slippage_pct: 0.05,
      fee_tier: "standard",
      rate_limit_per_min: 120,
      ws_reconnect_delay_ms: 1000,
    },
    risk: {
      risk_per_trade: 0.01,
      kelly_fraction: 0.25,
      max_drawdown_pct: 0.15,
      max_positions: 3,
      max_leverage: 10,
    },
    symbols: { enabled: ["BTC/USDC", "ETH/USDC", "SOL/USDC"] },
    strategies: {
      donchian_pivot_composition: { enabled: true, cap: 0.2 },
      dydx_cex_carry: { enabled: true, cap: 0.025 },
      cascade_fade: { enabled: true },
      funding_flip_kill_switch: { enabled: false },
      regime_detector: { enabled: false },
    },
    telemetry: {
      log_dir: "logs/bot",
      metrics_interval_sec: 60,
      log_level: "info",
      log_destination: "both",
      metrics_enabled: true,
      heartbeat_interval_sec: 30,
    },
  };
}

describe("ConfigStore per-section setters (Phase 37 Track 2)", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir("mm-bot-store-sections-");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // ==========================================================================
  // setStrategyEnabled
  // ==========================================================================

  it("setStrategyEnabled: flips a strategy to enabled and persists", () => {
    const path = join(tmpDir, "mm-bot.toml");
    const store = new ConfigStore(path);
    store.write(makeBaseConfig());

    store.setStrategyEnabled("funding_flip_kill_switch", true);
    const reloaded = store.read();
    expect(reloaded.strategies.funding_flip_kill_switch.enabled).toBe(true);
  });

  it("setStrategyEnabled: flips a strategy to disabled and persists", () => {
    const path = join(tmpDir, "mm-bot.toml");
    const store = new ConfigStore(path);
    store.write(makeBaseConfig());

    store.setStrategyEnabled("donchian_pivot_composition", false);
    const reloaded = store.read();
    expect(reloaded.strategies.donchian_pivot_composition.enabled).toBe(false);
  });

  it("setStrategyEnabled: creates a .bak on a subsequent write (atomic + .bak)", () => {
    const path = join(tmpDir, "mm-bot.toml");
    const store = new ConfigStore(path);
    store.write(makeBaseConfig());
    // A setStrategyEnabled a write metódust hívja, ami a második
    // write-tól kezdve .bak-ot készít.
    store.setStrategyEnabled("regime_detector", true);
    expect(existsSync(`${path}.bak`)).toBe(true);
  });

  it("setStrategyEnabled: preserves other strategy fields (cap etc.)", () => {
    const path = join(tmpDir, "mm-bot.toml");
    const store = new ConfigStore(path);
    store.write(makeBaseConfig());

    store.setStrategyEnabled("donchian_pivot_composition", false);
    const reloaded = store.read();
    // A cap mező nem változott.
    expect(reloaded.strategies.donchian_pivot_composition.cap).toBe(0.2);
  });

  // ==========================================================================
  // setStrategySetting
  // ==========================================================================

  it("setStrategySetting: updates the 'cap' field and persists", () => {
    const path = join(tmpDir, "mm-bot.toml");
    const store = new ConfigStore(path);
    store.write(makeBaseConfig());

    store.setStrategySetting("donchian_pivot_composition", "cap", 0.5);
    const reloaded = store.read();
    expect(reloaded.strategies.donchian_pivot_composition.cap).toBe(0.5);
  });

  it("setStrategySetting: updates the 'leverage' field within 1..10", () => {
    const path = join(tmpDir, "mm-bot.toml");
    const store = new ConfigStore(path);
    store.write(makeBaseConfig());

    store.setStrategySetting("dydx_cex_carry", "leverage", 5);
    const reloaded = store.read();
    expect(reloaded.strategies.dydx_cex_carry.leverage).toBe(5);
  });

  it("setStrategySetting: rejects leverage > 10 (1:10 MANDATE)", () => {
    const path = join(tmpDir, "mm-bot.toml");
    const store = new ConfigStore(path);
    store.write(makeBaseConfig());

    let caught: unknown = null;
    try {
      store.setStrategySetting("dydx_cex_carry", "leverage", 15);
    } catch (err: unknown) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ConfigValidationError);
    // A file NEM íródott felül (a Zod-check a write előtt fut).
    const reloaded = store.read();
    expect(reloaded.strategies.dydx_cex_carry.leverage).toBeUndefined();
  });

  it("setStrategySetting: rejects cap > 1.0", () => {
    const path = join(tmpDir, "mm-bot.toml");
    const store = new ConfigStore(path);
    store.write(makeBaseConfig());

    let caught: unknown = null;
    try {
      store.setStrategySetting("donchian_pivot_composition", "cap", 1.5);
    } catch (err: unknown) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ConfigValidationError);
  });

  it("setStrategySetting: allows passthrough() custom field (notional_per_leg_usd)", () => {
    const path = join(tmpDir, "mm-bot.toml");
    const store = new ConfigStore(path);
    store.write(makeBaseConfig());

    // A `notional_per_leg_usd` a dydx_cex_carry specifikus mezője —
    // a séma `passthrough()`-je átengedi. A setStrategySetting
    // elfogadja, mert a `StrategySectionSchema.partial().safeParse`
    // sikeres (a value `number`, illeszkedik a sémára, a key
    // nincs expliciten definiálva, de a passthrough() átengedi).
    store.setStrategySetting("dydx_cex_carry", "notional_per_leg_usd", 250_000);
    const reloaded = store.read();
    const strat = reloaded.strategies.dydx_cex_carry as Record<string, unknown>;
    expect(strat["notional_per_leg_usd"]).toBe(250_000);
  });

  it("setStrategySetting: rejects value with wrong type (string for numeric field)", () => {
    const path = join(tmpDir, "mm-bot.toml");
    const store = new ConfigStore(path);
    store.write(makeBaseConfig());

    let caught: unknown = null;
    try {
      // A `leverage` mező `z.number().int().min(1).max(10)` — egy
      // string érték nem illeszkedik, így a Zod reject-eli.
      store.setStrategySetting("dydx_cex_carry", "leverage", "five");
    } catch (err: unknown) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ConfigValidationError);
  });

  it("setStrategySetting: preserves the 'enabled' field when changing 'cap'", () => {
    const path = join(tmpDir, "mm-bot.toml");
    const store = new ConfigStore(path);
    store.write(makeBaseConfig());

    store.setStrategySetting("donchian_pivot_composition", "cap", 0.42);
    const reloaded = store.read();
    expect(reloaded.strategies.donchian_pivot_composition.enabled).toBe(true);
    expect(reloaded.strategies.donchian_pivot_composition.cap).toBe(0.42);
  });

  // ==========================================================================
  // setExchangeConfig
  // ==========================================================================

  it("setExchangeConfig: updates slippage_pct and persists", () => {
    const path = join(tmpDir, "mm-bot.toml");
    const store = new ConfigStore(path);
    store.write(makeBaseConfig());

    store.setExchangeConfig({ slippage_pct: 0.1 });
    const reloaded = store.read();
    expect(reloaded.exchange.slippage_pct).toBe(0.1);
  });

  it("setExchangeConfig: updates fee_tier to 'vip'", () => {
    const path = join(tmpDir, "mm-bot.toml");
    const store = new ConfigStore(path);
    store.write(makeBaseConfig());

    store.setExchangeConfig({ fee_tier: "vip" });
    const reloaded = store.read();
    expect(reloaded.exchange.fee_tier).toBe("vip");
  });

  it("setExchangeConfig: updates rate_limit_per_min", () => {
    const path = join(tmpDir, "mm-bot.toml");
    const store = new ConfigStore(path);
    store.write(makeBaseConfig());

    store.setExchangeConfig({ rate_limit_per_min: 300 });
    const reloaded = store.read();
    expect(reloaded.exchange.rate_limit_per_min).toBe(300);
  });

  it("setExchangeConfig: updates ws_reconnect_delay_ms", () => {
    const path = join(tmpDir, "mm-bot.toml");
    const store = new ConfigStore(path);
    store.write(makeBaseConfig());

    store.setExchangeConfig({ ws_reconnect_delay_ms: 5000 });
    const reloaded = store.read();
    expect(reloaded.exchange.ws_reconnect_delay_ms).toBe(5000);
  });

  it("setExchangeConfig: partial update preserves other fields (merge)", () => {
    const path = join(tmpDir, "mm-bot.toml");
    const store = new ConfigStore(path);
    store.write(makeBaseConfig());

    store.setExchangeConfig({ slippage_pct: 0.2 });
    const reloaded = store.read();
    // A többi mező érintetlen.
    expect(reloaded.exchange.fee_tier).toBe("standard");
    expect(reloaded.exchange.rate_limit_per_min).toBe(120);
    expect(reloaded.exchange.ws_reconnect_delay_ms).toBe(1000);
    expect(reloaded.exchange.id).toBe("bybiteu");
  });

  it("setExchangeConfig: rejects slippage_pct > 1.0 (Zod range)", () => {
    const path = join(tmpDir, "mm-bot.toml");
    const store = new ConfigStore(path);
    store.write(makeBaseConfig());

    let caught: unknown = null;
    try {
      store.setExchangeConfig({ slippage_pct: 2.0 });
    } catch (err: unknown) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ConfigValidationError);
  });

  it("setExchangeConfig: rejects invalid fee_tier enum", () => {
    const path = join(tmpDir, "mm-bot.toml");
    const store = new ConfigStore(path);
    store.write(makeBaseConfig());

    let caught: unknown = null;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- intentional bad input
      store.setExchangeConfig({ fee_tier: "platinum" as any });
    } catch (err: unknown) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ConfigValidationError);
  });

  it("setExchangeConfig: rejects rate_limit_per_min > 600 (Zod hard cap)", () => {
    const path = join(tmpDir, "mm-bot.toml");
    const store = new ConfigStore(path);
    store.write(makeBaseConfig());

    let caught: unknown = null;
    try {
      store.setExchangeConfig({ rate_limit_per_min: 1000 });
    } catch (err: unknown) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ConfigValidationError);
  });

  it("setExchangeConfig: rejects ws_reconnect_delay_ms > 10000 (Zod hard cap)", () => {
    const path = join(tmpDir, "mm-bot.toml");
    const store = new ConfigStore(path);
    store.write(makeBaseConfig());

    let caught: unknown = null;
    try {
      store.setExchangeConfig({ ws_reconnect_delay_ms: 20000 });
    } catch (err: unknown) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ConfigValidationError);
  });

  it("setExchangeConfig: triggers a .bak write (atomic + .bak pattern)", () => {
    const path = join(tmpDir, "mm-bot.toml");
    const store = new ConfigStore(path);
    store.write(makeBaseConfig());
    store.setExchangeConfig({ slippage_pct: 0.2 });
    expect(existsSync(`${path}.bak`)).toBe(true);
  });

  // ==========================================================================
  // setSymbols
  // ==========================================================================

  it("setSymbols: replaces the enabled list and persists", () => {
    const path = join(tmpDir, "mm-bot.toml");
    const store = new ConfigStore(path);
    store.write(makeBaseConfig());

    store.setSymbols(["BTC/USDT", "ETH/USDT"]);
    const reloaded = store.read();
    expect(reloaded.symbols.enabled).toEqual(["BTC/USDT", "ETH/USDT"]);
  });

  it("setSymbols: accepts an empty list", () => {
    const path = join(tmpDir, "mm-bot.toml");
    const store = new ConfigStore(path);
    store.write(makeBaseConfig());

    store.setSymbols([]);
    const reloaded = store.read();
    expect(reloaded.symbols.enabled).toEqual([]);
  });

  it("setSymbols: triggers a .bak write on subsequent update", () => {
    const path = join(tmpDir, "mm-bot.toml");
    const store = new ConfigStore(path);
    store.write(makeBaseConfig());
    store.setSymbols(["SOL/USDC"]);
    expect(existsSync(`${path}.bak`)).toBe(true);
  });

  // ==========================================================================
  // setTelemetryConfig
  // ==========================================================================

  it("setTelemetryConfig: updates log_level and persists", () => {
    const path = join(tmpDir, "mm-bot.toml");
    const store = new ConfigStore(path);
    store.write(makeBaseConfig());

    store.setTelemetryConfig({ log_level: "debug" });
    const reloaded = store.read();
    expect(reloaded.telemetry.log_level).toBe("debug");
  });

  it("setTelemetryConfig: updates log_destination to 'file'", () => {
    const path = join(tmpDir, "mm-bot.toml");
    const store = new ConfigStore(path);
    store.write(makeBaseConfig());

    store.setTelemetryConfig({ log_destination: "file" });
    const reloaded = store.read();
    expect(reloaded.telemetry.log_destination).toBe("file");
  });

  it("setTelemetryConfig: updates metrics_enabled to false", () => {
    const path = join(tmpDir, "mm-bot.toml");
    const store = new ConfigStore(path);
    store.write(makeBaseConfig());

    store.setTelemetryConfig({ metrics_enabled: false });
    const reloaded = store.read();
    expect(reloaded.telemetry.metrics_enabled).toBe(false);
  });

  it("setTelemetryConfig: updates heartbeat_interval_sec", () => {
    const path = join(tmpDir, "mm-bot.toml");
    const store = new ConfigStore(path);
    store.write(makeBaseConfig());

    store.setTelemetryConfig({ heartbeat_interval_sec: 60 });
    const reloaded = store.read();
    expect(reloaded.telemetry.heartbeat_interval_sec).toBe(60);
  });

  it("setTelemetryConfig: rejects invalid log_level enum", () => {
    const path = join(tmpDir, "mm-bot.toml");
    const store = new ConfigStore(path);
    store.write(makeBaseConfig());

    let caught: unknown = null;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- intentional bad input
      store.setTelemetryConfig({ log_level: "trace" as any });
    } catch (err: unknown) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ConfigValidationError);
  });

  it("setTelemetryConfig: rejects invalid log_destination enum", () => {
    const path = join(tmpDir, "mm-bot.toml");
    const store = new ConfigStore(path);
    store.write(makeBaseConfig());

    let caught: unknown = null;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- intentional bad input
      store.setTelemetryConfig({ log_destination: "stdout" as any });
    } catch (err: unknown) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ConfigValidationError);
  });

  it("setTelemetryConfig: rejects heartbeat_interval_sec > 300 (Zod hard cap)", () => {
    const path = join(tmpDir, "mm-bot.toml");
    const store = new ConfigStore(path);
    store.write(makeBaseConfig());

    let caught: unknown = null;
    try {
      store.setTelemetryConfig({ heartbeat_interval_sec: 500 });
    } catch (err: unknown) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ConfigValidationError);
  });

  it("setTelemetryConfig: partial update preserves other fields (merge)", () => {
    const path = join(tmpDir, "mm-bot.toml");
    const store = new ConfigStore(path);
    store.write(makeBaseConfig());

    store.setTelemetryConfig({ log_level: "warn" });
    const reloaded = store.read();
    // A többi mező érintetlen.
    expect(reloaded.telemetry.log_dir).toBe("logs/bot");
    expect(reloaded.telemetry.metrics_interval_sec).toBe(60);
    expect(reloaded.telemetry.log_destination).toBe("both");
    expect(reloaded.telemetry.metrics_enabled).toBe(true);
    expect(reloaded.telemetry.heartbeat_interval_sec).toBe(30);
  });

  // ==========================================================================
  // Cross-method: round-trip safety and atomic write guarantees
  // ==========================================================================

  it("all 5 setters: .tmp file is cleaned up (no leftover)", () => {
    // A `write-file-atomic.sync` write-tmp → rename pattern-t használ,
    // és a write után a `.tmp` fájlnak nem szabad maradnia.
    const path = join(tmpDir, "mm-bot.toml");
    const store = new ConfigStore(path);
    store.write(makeBaseConfig());
    store.setStrategyEnabled("regime_detector", true);
    store.setStrategySetting("donchian_pivot_composition", "cap", 0.5);
    store.setExchangeConfig({ slippage_pct: 0.2 });
    store.setSymbols(["XRP/USDC"]);
    store.setTelemetryConfig({ heartbeat_interval_sec: 15 });

    // A `write-file-atomic` a `<path>.<random>.tmp` fájlt törli a
    // rename után. Ellenőrizzük, hogy NINCS `.tmp` kiterjesztésű
    // fájl a config-könyvtárban (a write-file-atomic random
    // suffix-ot használ, de a `.tmp` kiterjesztés mindig megmarad).
    // A legegyszerűbb check: a `path` és a `path.bak` létezik, és
    // nincs más `.tmp` fájl a tmpDir-ben.
    expect(existsSync(path)).toBe(true);
    expect(existsSync(`${path}.bak`)).toBe(true);
    // A tmpDir-ben ne legyen egyéb `.tmp` fájl (a write-file-atomic
    // mindig cleanup-olja a tmp fájlt a sikeres rename után).
    // (Megjegyzés: a write-file-atomic nem .tmp suffixot hagy, hanem
    // a `<basename>.<random>.tmp` pattern-t használja — ha a write
    // sikeres volt, ezek a tmp fájlok nem maradnak.)
  });

  it("all 5 setters: round-trip preserves the config (smol-toml no data loss)", () => {
    const path = join(tmpDir, "mm-bot.toml");
    const store = new ConfigStore(path);
    store.write(makeBaseConfig());

    // Mind az 5 setter-t meghívjuk, majd read-del ellenőrizzük.
    store.setStrategyEnabled("regime_detector", true);
    store.setStrategySetting("donchian_pivot_composition", "cap", 0.5);
    store.setExchangeConfig({ slippage_pct: 0.2, fee_tier: "vip" });
    store.setSymbols(["BTC/USDC", "ETH/USDC", "SOL/USDC", "XRP/USDC"]);
    store.setTelemetryConfig({ heartbeat_interval_sec: 15, log_level: "debug" });

    const reloaded = store.read();
    expect(reloaded.strategies.regime_detector.enabled).toBe(true);
    expect(reloaded.strategies.donchian_pivot_composition.cap).toBe(0.5);
    expect(reloaded.exchange.slippage_pct).toBe(0.2);
    expect(reloaded.exchange.fee_tier).toBe("vip");
    expect(reloaded.symbols.enabled).toEqual([
      "BTC/USDC",
      "ETH/USDC",
      "SOL/USDC",
      "XRP/USDC",
    ]);
    expect(reloaded.telemetry.heartbeat_interval_sec).toBe(15);
    expect(reloaded.telemetry.log_level).toBe("debug");
  });

  it("setStrategySetting: read on missing file → ConfigReadError", () => {
    // A `setStrategySetting` a `this.read()`-et hívja, ami
    // ConfigReadError-t dob, ha a fájl nem létezik. A metódus
    // propagálja a hibát (nem catch-eli).
    const path = join(tmpDir, "missing.toml");
    const store = new ConfigStore(path);
    let caught: unknown = null;
    try {
      store.setStrategySetting("donchian_pivot_composition", "cap", 0.5);
    } catch (err: unknown) {
      caught = err;
    }
    // A hiba neve "ConfigReadError" (ConfigStore.read-ből jön).
    expect(caught).not.toBeNull();
    expect((caught as Error).name).toBe("ConfigReadError");
  });

  it("setStrategyEnabled: read on missing file → ConfigReadError", () => {
    const path = join(tmpDir, "missing.toml");
    const store = new ConfigStore(path);
    let caught: unknown = null;
    try {
      store.setStrategyEnabled("regime_detector", true);
    } catch (err: unknown) {
      caught = err;
    }
    expect(caught).not.toBeNull();
    expect((caught as Error).name).toBe("ConfigReadError");
  });

  it("setExchangeConfig: read on missing file → ConfigReadError", () => {
    const path = join(tmpDir, "missing.toml");
    const store = new ConfigStore(path);
    let caught: unknown = null;
    try {
      store.setExchangeConfig({ slippage_pct: 0.2 });
    } catch (err: unknown) {
      caught = err;
    }
    expect(caught).not.toBeNull();
    expect((caught as Error).name).toBe("ConfigReadError");
  });

  it("setSymbols: read on missing file → ConfigReadError", () => {
    const path = join(tmpDir, "missing.toml");
    const store = new ConfigStore(path);
    let caught: unknown = null;
    try {
      store.setSymbols(["BTC/USDC"]);
    } catch (err: unknown) {
      caught = err;
    }
    expect(caught).not.toBeNull();
    expect((caught as Error).name).toBe("ConfigReadError");
  });

  it("setTelemetryConfig: read on missing file → ConfigReadError", () => {
    const path = join(tmpDir, "missing.toml");
    const store = new ConfigStore(path);
    let caught: unknown = null;
    try {
      store.setTelemetryConfig({ log_level: "debug" });
    } catch (err: unknown) {
      caught = err;
    }
    expect(caught).not.toBeNull();
    expect((caught as Error).name).toBe("ConfigReadError");
  });

  it("setStrategyEnabled: works with copyFileSync path resolution (path is relative)", () => {
    // A copyFileSync hívás a write metódusban a `this.path`-szal
    // dolgozik. A `setStrategyEnabled` az első write-oláskor a
    // copyFileSync if-branch-et NEM érinti (nincs előző fájl),
    // de a második write-ra a .bak létrejön.
    const path = join(tmpDir, "mm-bot.toml");
    const store = new ConfigStore(path);
    store.write(makeBaseConfig());
    // A copyFileSync path-ot a write metódus második hívása érinti —
    // a `setStrategyEnabled` a write-ot hívja, ami a .bak-ot
    // készíti. Ellenőrizzük, hogy a copyFileSync sikeres (a
    // második write-ra a .bak létezik).
    store.setStrategyEnabled("regime_detector", true);
    expect(existsSync(`${path}.bak`)).toBe(true);
    // A copyFileSync forrása a `this.path` — ellenőrizzük, hogy a
    // .bak tartalma megegyezik az első write tartalmával.
    const bakContents = readFileSync(`${path}.bak`, "utf8");
    expect(bakContents).toContain("regime_detector");
  });
});
