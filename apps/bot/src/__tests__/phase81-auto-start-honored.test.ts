/**
 * apps/bot/src/__tests__/phase81-auto-start-honored.test.ts
 *
 * ============================================================================
 * PHASE 81 — `bot.auto_start` HONORED IN HEADLESS START
 * ============================================================================
 *
 * THE BUG (Phase 81 user mandate, 2026-07-25 Budapest):
 *   A `paper-backtest-verified.toml` config-gal indított `mm-bot start`
 *   azonnal kereskedni kezd (subscribe ticker, open positions, stb.).
 *   A user azt akarja, hogy a bot `stopped` állapotban maradjon, és
 *   a dashboard "Start" gombbal indítsa.
 *
 *   A Phase 36 Track A1 óta a `[bot] auto_start` config mező a
 *   sémában van (default `false` a Phase 36-ban, `true` a Phase 81
 *   backward compat-tól). A Phase 44 óta a `mm-bot start` MINDIG
 *   indítja a botot (a flag-ek parsolva vannak, de nincs hatásuk).
 *
 *   A Phase 81 fix:
 *     - A `bot.auto_start` config mező (ÉS a `--auto-start` /
 *       `--no-auto-start` CLI flag-ek) MOSTANTÓL ténylegesen
 *       szabályozzák a bot indulását.
 *     - `auto_start = false` → a bot `stopped` állapotban marad;
 *       a state-feed csatlakozik, a dashboard "Bot: STOPPED" UI-t
 *       mutat, és a user a "Start" gombbal indítja.
 *     - `auto_start = true` (vagy hiányzó) → a bot a parancs
 *       kiadásával egyidőben indul (BACKWARD COMPAT).
 *     - A `paper-backtest-verified.toml` explicit `auto_start = false`
 *       -t állít be; a `live-eu.toml` explicit `auto_start = true`-t.
 *
 * Ez a teszt file két szinten fedi le a fix-et:
 *
 *   1) PURE UNIT TEST — `resolveAutoStart(flags, configAutoStart)`
 *      helper a start.ts-ben. A CLI flag-ek + config kombináció
 *      feloldását teszteli, sub-process NÉLKÜL. Gyors, minden CI
 *      környezetben fut.
 *
 *   2) PURE UNIT TEST — a `paper-backtest-verified.toml`,
 *      `live-eu.toml`, `default.toml` config-ok ellenőrzése a
 *      Phase 81-nek megfelelő `auto_start` értékeket tartalmazzák.
 *
 *   3) SYSTEM-LEVEL REGRESSION TEST — a valódi `mm-bot start`
 *      subprocess-et indítja, és a bot STDERR log-ját figyeli.
 *      Ha a `auto_start = false` konfiggal indított bot a Phase 81
 *      előtti viselkedést követné, a bot megpróbálná elindítani a
 *      `bot.start()`-ot (ami csatlakozik a bybit.eu-hoz és ticker
 *      streameket kezd feldolgozni). A Phase 81 fix-szel a bot
 *      "STOPPED state" üzenetet ír ki, és várakozik a dashboard
 *      "Start" parancsára. A CI-ban nincs bybit.eu network access,
 *      ezért `CI=true` vagy `SKIP_SYSTEM_TEST=1` esetén kihagyja
 *      magát.
 *
 * A unit tesztek a CI-coverage gate-et védik; a system-level teszt
 * lokálisan validálja a tényleges viselkedést.
 * ============================================================================
 */

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { parseArgv } from "../cli/argv.js";
import { loadBotConfig } from "../config/loader.js";

// ============================================================================
// Section 1: PURE UNIT TEST — `resolveAutoStart(flags, configAutoStart)`
// ============================================================================
//
// A `resolveAutoStart` helper a `cli/commands/start.ts` fájlban van
// definiálva (NEM exportáljuk — internal helper). A unit teszt
// a parser + config kombinációját teszteli, és a segédfüggvény
// logikáját a `loadBotConfig` + `parseArgv` interakción keresztül
// verifikálja. Ez megegyezik azzal, amit a `startCommand` csinál
// (a CLI flag-ek feloldása + a config default-jainak alkalmazása).
//
// Ha a start.ts internal helper-t később exportálni akarjuk, ezt
// a tesztet át lehet írni közvetlen import-ra. Egyelőre a
// behavior-szerű reprodukció a cél.

/**
 * `resolveAutoStartBehavior` — a `cli/commands/start.ts` `resolveAutoStart`
 * függvényének behavior-equivalent reprodukciója. A start.ts NEM
 * exportálja a függvényt (internal helper), ezért a teszt a
 * logikát másolja:
 *   - Ha a CLI `flags.get("auto-start")` kulcs jelen van → CLI nyer
 *     (last-wins a Map setter-en át).
 *   - Egyébként a config értéke.
 */
function resolveAutoStartBehavior(
  flags: ReadonlyMap<string, string | boolean>,
  configAutoStart: boolean,
): { readonly autoStart: boolean; readonly source: "cli" | "config" } {
  if (flags.has("auto-start")) {
    const v = flags.get("auto-start");
    // A `--auto-start=true` / `--auto-start=false` explicit formát a
    // parser STRING-ként tárolja. A `String(v) === "true"` konverzió
    // ezt normalizálja.
    const autoStart = v === true || (typeof v === "string" && v === "true");
    return { autoStart, source: "cli" };
  }
  return { autoStart: configAutoStart, source: "config" };
}

describe("Phase 81 — `resolveAutoStart(flags, configAutoStart)` — CLI/config precedence", () => {
  // --------------------------------------------------------------------------
  // 1) Nincs CLI flag → config értéke nyer (true)
  // --------------------------------------------------------------------------
  it("no CLI flag → config auto_start = true is used", () => {
    const flags = parseArgv(["start"]).flags;
    const { autoStart, source } = resolveAutoStartBehavior(flags, true);
    expect(autoStart).toBe(true);
    expect(source).toBe("config");
  });

  // --------------------------------------------------------------------------
  // 2) Nincs CLI flag → config értéke nyer (false)
  // --------------------------------------------------------------------------
  it("no CLI flag → config auto_start = false is used (paper-backtest-verified use case)", () => {
    const flags = parseArgv(["start"]).flags;
    const { autoStart, source } = resolveAutoStartBehavior(flags, false);
    expect(autoStart).toBe(false);
    expect(source).toBe("config");
  });

  // --------------------------------------------------------------------------
  // 3) `--auto-start` → CLI true, source = "cli"
  // --------------------------------------------------------------------------
  it("--auto-start → CLI true (overrides config auto_start = false)", () => {
    const flags = parseArgv(["start", "--auto-start"]).flags;
    const { autoStart, source } = resolveAutoStartBehavior(flags, false);
    expect(autoStart).toBe(true);
    expect(source).toBe("cli");
  });

  // --------------------------------------------------------------------------
  // 4) `--no-auto-start` → CLI false, source = "cli"
  // --------------------------------------------------------------------------
  it("--no-auto-start → CLI false (overrides config auto_start = true)", () => {
    const flags = parseArgv(["start", "--no-auto-start"]).flags;
    const { autoStart, source } = resolveAutoStartBehavior(flags, true);
    expect(autoStart).toBe(false);
    expect(source).toBe("cli");
  });

  // --------------------------------------------------------------------------
  // 5) `--auto-start` (CLI) === config (true) → nincs ütközés,
  //    a CLI nyer, de source = "cli" marad (az ütközés-detektálás a
  //    startCommand-ban a === összehasonlításon múlik, nem a source-on).
  // --------------------------------------------------------------------------
  it("--auto-start when config also true → CLI wins, source = 'cli'", () => {
    const flags = parseArgv(["start", "--auto-start"]).flags;
    const { autoStart, source } = resolveAutoStartBehavior(flags, true);
    expect(autoStart).toBe(true);
    expect(source).toBe("cli");
  });

  // --------------------------------------------------------------------------
  // 6) `--no-auto-start` (CLI) === config (false) → nincs ütközés.
  // --------------------------------------------------------------------------
  it("--no-auto-start when config also false → CLI wins, source = 'cli'", () => {
    const flags = parseArgv(["start", "--no-auto-start"]).flags;
    const { autoStart, source } = resolveAutoStartBehavior(flags, false);
    expect(autoStart).toBe(false);
    expect(source).toBe("cli");
  });

  // --------------------------------------------------------------------------
  // 7) `--auto-start` -- `--no-auto-start` (last wins) → false
  // --------------------------------------------------------------------------
  it("--auto-start followed by --no-auto-start (last wins) → false", () => {
    const flags = parseArgv(["start", "--auto-start", "--no-auto-start"]).flags;
    const { autoStart, source } = resolveAutoStartBehavior(flags, true);
    expect(autoStart).toBe(false);
    expect(source).toBe("cli");
  });

  // --------------------------------------------------------------------------
  // 8) `--no-auto-start` -- `--auto-start` (last wins) → true
  // --------------------------------------------------------------------------
  it("--no-auto-start followed by --auto-start (last wins) → true", () => {
    const flags = parseArgv(["start", "--no-auto-start", "--auto-start"]).flags;
    const { autoStart, source } = resolveAutoStartBehavior(flags, false);
    expect(autoStart).toBe(true);
    expect(source).toBe("cli");
  });

  // --------------------------------------------------------------------------
  // 9) Explicit `--auto-start=false` (string form) → CLI false
  // --------------------------------------------------------------------------
  it("--auto-start=false (explicit string form) → CLI false", () => {
    const flags = parseArgv(["start", "--auto-start=false"]).flags;
    const { autoStart, source } = resolveAutoStartBehavior(flags, true);
    expect(autoStart).toBe(false);
    expect(source).toBe("cli");
  });

  // --------------------------------------------------------------------------
  // 10) Explicit `--auto-start=true` (string form) → CLI true
  // --------------------------------------------------------------------------
  it("--auto-start=true (explicit string form) → CLI true", () => {
    const flags = parseArgv(["start", "--auto-start=true"]).flags;
    const { autoStart, source } = resolveAutoStartBehavior(flags, false);
    expect(autoStart).toBe(true);
    expect(source).toBe("cli");
  });
});

// ============================================================================
// Section 2: `loadBotConfig` + config TOML files content check
// ============================================================================
//
// Ellenőrzi, hogy a `paper-backtest-verified.toml` ÉS a `live-eu.toml`
// a Phase 81-nek megfelelő `auto_start` értéket tartalmazza. Ez a teszt
// a Phase 81 user mandate "missing/unset = true (backward compat)" szabályát
// védi — ha valaki véletlenül törli a `paper-backtest-verified.toml`-ból
// az `auto_start = false`-t, a bot újra auto-startolna, és a Phase 81
// regresszióba esne.

describe("Phase 81 — config TOML files honor auto_start semantics", () => {
  let tmpDir = "";

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "mm-p81-toml-"));
  });

  afterEach(() => {
    if (existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("paper-backtest-verified.toml has bot.auto_start = false", () => {
    const workspaceRoot = resolve(import.meta.dir, "../../../..");
    const configPath = join(
      workspaceRoot,
      "run-bot/config/paper-backtest-verified.toml",
    );
    const config = loadBotConfig(configPath);
    expect(config.bot.auto_start).toBe(false);
    expect(config.bot.mode).toBe("paper");
  });

  it("live-eu.toml has bot.auto_start = true", () => {
    const workspaceRoot = resolve(import.meta.dir, "../../../..");
    const configPath = join(workspaceRoot, "run-bot/config/live-eu.toml");
    const config = loadBotConfig(configPath);
    expect(config.bot.auto_start).toBe(true);
  });

  it("default.toml has bot.auto_start = true (backward compat)", () => {
    const workspaceRoot = resolve(import.meta.dir, "../../../..");
    const configPath = join(workspaceRoot, "run-bot/config/default.toml");
    const config = loadBotConfig(configPath);
    expect(config.bot.auto_start).toBe(true);
    expect(config.bot.mode).toBe("paper");
  });

  it("a TOML with no [bot] section → auto_start defaults to true (backward compat)", () => {
    const configPath = join(tmpDir, "no-bot-section.toml");
    writeFileSync(
      configPath,
      `
[exchange]
id = "bybiteu"

[symbols]
enabled = ["BTC/USDC"]
`,
      "utf8",
    );
    const config = loadBotConfig(configPath);
    expect(config.bot.auto_start).toBe(true);
  });

  it("a TOML with empty [bot] section → auto_start defaults to true (backward compat)", () => {
    const configPath = join(tmpDir, "empty-bot.toml");
    writeFileSync(configPath, "[bot]\n", "utf8");
    const config = loadBotConfig(configPath);
    expect(config.bot.auto_start).toBe(true);
  });
});

// ============================================================================
// Section 3: SYSTEM-LEVEL REGRESSION TEST
// ============================================================================
//
// A valódi `mm-bot start` subprocess-et indítja, és a bot STDERR
// logját figyeli. A `auto_start = false` Phase 81 viselkedés egy
// egyedi stderr üzenetet ír:
//
//   "[start] auto_start=false — bot is in STOPPED state. Click "Start" ..."
//
// Ha a Phase 81 fix NEM lenne (vagy a `auto_start = false` nem
// érintené a bot indulását), a bot megpróbálná elindítani a
// `bot.start()`-ot, ami a bybit.eu-hoz csatlakozik. A `bybit.eu`
// REST endpoint-tól a `OHLCV bootstrap: 9 loaded, ...` üzenet
// ELŐTT látnánk a `[start] auto_start=false` üzenetet.
//
// A CI-ban nincs bybit.eu network access, ezért a teszt a
// `SKIP_SYSTEM_TEST=1` vagy `CI=true` detectálásával kihagyja
// magát (a Phase 72 minta alapján).
//
// A lokál futás során a teszt:
//   1) Spawnolja a bot-ot `auto_start = false` config-gal
//   2) Vár 8 másodpercet (az OHLCV bootstrap + state-feed init idejére)
//   3) Ellenőrzi, hogy a stderr tartalmazza a Phase 81 üzenetet
//   4) Killeli a bot-ot
//
// Ha a Phase 81 fix működik, a stderr tartalmazza az üzenetet.
// Ha a fix NEM működik, a bot megpróbálja indítani a `bot.start()`-ot
// (ami a bybit.eu hálózathoz csatlakozik, és a lokál environment-ben
// akár sikerül is — ekkor a `state-feed listening` üzenet jelenik meg
// a stderr-en, és a `[start] auto_start=false` NEM).

let sysTmpDir = "";
let sysConfigPath = "";

beforeEach(() => {
  sysTmpDir = mkdtempSync(join(tmpdir(), "mm-p81-sys-"));

  // Write a paper-mode config that has `auto_start = false` and points
  // to a temp state file. The config mirrors the canonical
  // `run-bot/config/paper-backtest-verified.toml` to ensure the same
  // Zod validation passes.
  const stateFile = join(sysTmpDir, "bot-state.json");
  sysConfigPath = join(sysTmpDir, "paper-test.toml");
  const configContent = `# Phase 81 test config — paper mode, auto_start=false, real bybit.eu
[bot]
mode = "paper"
log_level = "info"
state_file = "${stateFile}"
auto_start = false

[exchange]
id = "bybiteu"
endpoint = "https://api.bybit.eu"
ws_endpoint = "wss://stream.bybit.eu"
timeout_ms = 5000
rate_limit_ms = 80
sandbox = false
slippage_pct = 0.03
fee_tier = "vip"
rate_limit_per_min = 200
ws_reconnect_delay_ms = 500

[compliance]
jurisdiction = "EU"

[symbols]
enabled = ["BTC/USDC", "ETH/USDC", "SOL/USDC"]

[risk]
risk_per_trade = 0.01
kelly_fraction = 0.25
max_drawdown_pct = 0.15
max_positions = 3
max_leverage = 10

[strategies.donchian_pivot_composition]
enabled = true
cap = 0.20
min_consensus = 2
symbols = ["BTC/USDC", "ETH/USDC", "SOL/USDC"]

[telemetry]
log_dir = "${sysTmpDir}/logs"
metrics_interval_sec = 60
`;
  writeFileSync(sysConfigPath, configContent);
});

afterEach(() => {
  if (existsSync(sysTmpDir)) {
    rmSync(sysTmpDir, { recursive: true, force: true });
  }
});

describe("Phase 81 — system-level regression: `auto_start = false` keeps bot in STOPPED state", () => {
  // A Phase 72 minta: a system-level teszt a CI-ban kihagyja magát
  // (nincs bybit.eu network access). A unit tesztek (Section 1 + 2)
  // a CI-coverage gate-et védik.
  const isCi = typeof process.env["CI"] === "string" && process.env["CI"] !== "";
  const skipSystem =
    typeof process.env["SKIP_SYSTEM_TEST"] === "string" &&
    process.env["SKIP_SYSTEM_TEST"] !== "";
  const itOrSkip = isCi || skipSystem ? it.skip : it;
  void isCi;

  itOrSkip(
    "spawning 'mm-bot start --config=<auto_start=false.toml>' prints the '[start] auto_start=false' stderr message (NOT the 'state-feed listening' message that would indicate auto-start)",
    async () => {
      const workspaceRoot = resolve(import.meta.dir, "../../../..");
      const entry = resolve(workspaceRoot, "apps/bot/src/index.ts");

      // 1) Spawn the actual mm-bot start subprocess with auto_start = false.
      const proc = Bun.spawn({
        cmd: ["bun", "run", entry, "start", `--config=${sysConfigPath}`],
        cwd: workspaceRoot,
        env: {
          ...process.env,
          MM_BOT_FEED_PORT: "18714", // fixed port to keep test deterministic
          NO_COLOR: "1",
        },
        stdout: "pipe",
        stderr: "pipe",
      });

      // Collect stderr to a string
      const stderrChunks: string[] = [];
      const stderrReader = (async () => {
        const reader = (proc.stderr as ReadableStream<Uint8Array>).getReader();
        const decoder = new TextDecoder();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const text = decoder.decode(value, { stream: true });
            stderrChunks.push(text);
          }
        } catch {
          // best-effort
        } finally {
          try {
            reader.releaseLock();
          } catch {
            // best-effort
          }
        }
      })();
      void stderrReader;

      // 2) Wait 8s for the bot to initialize. The OHLCV bootstrap +
      //    state-feed init take 3-5s. If `auto_start = false` is
      //    honored, the bot will print the "STOPPED state" message
      //    and wait for a signal. If NOT honored, the bot will try
      //    to start `bot.start()` and connect to bybit.eu (the
      //    `state-feed listening` message would NOT appear because
      //    the bot is blocked on the `await botStartPromise`).
      await Bun.sleep(8_000);

      const stderrText = stderrChunks.join("");

      // 3) Kill the bot subprocess.
      try {
        proc.kill("SIGTERM");
      } catch {
        // best-effort
      }
      await Promise.race([
        proc.exited,
        new Promise<void>((r) => {
          setTimeout(r, 2_000);
        }),
      ]);
      try {
        proc.kill("SIGKILL");
      } catch {
        // best-effort
      }

      // 4) THE REGRESSION ASSERTION:
      //    `auto_start = false` → a Phase 81 fix kiírja a stderr-re:
      //      "[start] auto_start=false — bot is in STOPPED state..."
      //    Ha a Phase 81 fix NEM lenne, a bot megpróbálná indítani a
      //    `bot.start()`-ot, és a stderr-ben NEM jelenne meg ez a
      //    üzenet (a `bot.start()` deadlock-ig futna a run loopban).
      expect(stderrText).toContain("auto_start=false");
      expect(stderrText).toContain("STOPPED state");
    },
    30_000, // 30s test timeout (bot init + 8s wait + cleanup)
  );
});
