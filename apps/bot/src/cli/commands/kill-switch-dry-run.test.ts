/**
 * apps/bot/src/cli/commands/kill-switch-dry-run.test.ts
 *
 * Phase 37 Track 5 — `mm-bot kill-switch-dry-run` unit tests.
 *
 * ===========================================================================
 * COVERAGE TARGET: 100% line coverage on `kill-switch-dry-run.ts`.
 * ===========================================================================
 *
 * A tesztek az alábbi ágakat fedik le:
 *   1. `loadState` — success / file-not-found / read-error / JSON-parse-error
 *      / schema-invalid ágak.
 *   2. `buildClosures` — 0 positions / 1 position / multi-position.
 *   3. `formatTelegramAlert` — üres lista / 1 entry / multi-entry.
 *   4. `formatJsonLogLines` — üres lista / 1 entry / multi-entry.
 *   5. `computeWouldTrigger` — 0 positions / drawdown-alatt / drawdown-felett
 *      / drawdown-pontosan-egyenlő / zero initialEquity (defensive).
 *   6. `buildReport` — `generatedAt` default + explicit, `wouldTrigger`
 *      true + false ágak.
 *   7. `printHumanReadable` — 0 positions / multi positions / wouldTrigger
 *      true / wouldTrigger false (zöld vs piros verdict).
 *   8. `printJson` — JSON.stringify output shape.
 *   9. CLI handler — happy path / help / config-not-found / state-not-found
 *      / ConfigError (code 2) / non-ConfigError (code 1) / --json mode
 *      success / --json mode state-error.
 */

import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parseArgv } from "../argv.js";
import type { CliContext } from "../router.js";
import type { BotState } from "../../bot/state-store.js";

import {
  buildClosures,
  buildReport,
  computeWouldTrigger,
  formatJsonLogLines,
  formatTelegramAlert,
  killSwitchDryRunCommand,
  loadState,
  printHumanReadable,
  printJson,
} from "./kill-switch-dry-run.js";

// ============================================================================
// Test fixtures
// ============================================================================

/**
 * `makeState` — build a minimal `BotState` with the given overrides.
 * Defaults: empty positions, 10000 initial equity, 10000 current equity,
 * one closed trade, no in-flight orders.
 */
function makeState(overrides: Partial<BotState> = {}): BotState {
  const base: BotState = {
    version: 1,
    savedAt: 1_700_000_000_000,
    equityUsd: 10_000,
    initialEquityUsd: 10_000,
    realizedPnlUsd: 0,
    positions: [],
    closedTrades: [],
    inFlightOrderIds: [],
    counters: { placed: 0, filled: 0, cancelled: 0, rejected: 0 },
  };
  // Deep-merge `positions` + `closedTrades` + `counters` shallowly — the
  // partial override replaces the corresponding key wholesale.
  return {
    ...base,
    ...overrides,
    counters: { ...base.counters, ...(overrides.counters ?? {}) },
  };
}

/**
 * `makePosition` — build a single position record.
 */
function makePosition(overrides: {
  readonly id?: string;
  readonly strategy?: string;
  readonly symbol?: string;
  readonly side?: "long" | "short";
  readonly quantity?: number;
  readonly entryPrice?: number;
  readonly currentPrice?: number;
  readonly leverage?: number;
  readonly unrealizedPnl?: number;
  readonly realizedPnl?: number;
  readonly openedAt?: number;
  readonly notionalUsd?: number;
} = {}): BotState["positions"][number] {
  return {
    id: overrides.id ?? "pos-1",
    strategy: overrides.strategy ?? "donchian_pivot_composition",
    symbol: overrides.symbol ?? "BTC/USDC",
    side: overrides.side ?? "long",
    quantity: overrides.quantity ?? 0.5,
    entryPrice: overrides.entryPrice ?? 30_000,
    currentPrice: overrides.currentPrice ?? 31_000,
    leverage: overrides.leverage ?? 5,
    unrealizedPnl: overrides.unrealizedPnl ?? 500,
    realizedPnl: overrides.realizedPnl ?? 0,
    openedAt: overrides.openedAt ?? 1_700_000_000_000,
    notionalUsd: overrides.notionalUsd ?? 15_000,
  };
}

// ============================================================================
// `loadState` — read + validate the state file
// ============================================================================

describe("loadState", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "ksdr-state-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns state=null + error when the file does not exist", () => {
    const missing = join(dir, "no-such-file.json");
    const result = loadState(missing);
    expect(result.state).toBeNull();
    expect(result.error).toContain("state file not found");
    expect(result.error).toContain(missing);
  });

  it("returns the validated state when the file is valid", () => {
    const path = join(dir, "state.json");
    writeFileSync(path, JSON.stringify(makeState()), "utf8");
    const result = loadState(path);
    expect(result.error).toBeNull();
    expect(result.state).not.toBeNull();
    expect(result.state?.equityUsd).toBe(10_000);
    expect(result.state?.version).toBe(1);
  });

  it("returns error when JSON parse fails", () => {
    const path = join(dir, "bad.json");
    writeFileSync(path, "{not valid json", "utf8");
    const result = loadState(path);
    expect(result.state).toBeNull();
    expect(result.error).toContain("invalid JSON");
  });

  it("returns error when the schema is invalid (version mismatch)", () => {
    const path = join(dir, "bad-schema.json");
    writeFileSync(path, JSON.stringify({ version: 99, savedAt: 1 }), "utf8");
    const result = loadState(path);
    expect(result.state).toBeNull();
    expect(result.error).toContain("state file schema invalid");
  });

  it("returns error when readFileSync throws (e.g. state_file is a directory)", () => {
    // The `readFileSync` catch branch is defensive — the caller
    // (CLI handler) sees `error` non-null and `state` null, just
    // like the file-not-found case. We trigger it by pointing
    // `state_file` at a directory (EISDIR on readFileSync).
    const dirAsFile = join(dir, "a-directory");
    mkdirSync(dirAsFile, { recursive: true });
    writeFileSync(join(dirAsFile, "inside.txt"), "hello", "utf8");
    // Now `dirAsFile` is a directory — readFileSync on a directory
    // throws EISDIR on Linux/macOS.
    const result = loadState(dirAsFile);
    expect(result.state).toBeNull();
    // The error message format is "failed to read <path>: <msg>".
    expect(result.error).toContain("failed to read");
    expect(result.error).toContain(dirAsFile);
  });
});

// ============================================================================
// `buildClosures` — derive position closures from the state
// ============================================================================

describe("buildClosures", () => {
  it("returns an empty list when there are no positions", () => {
    const closures = buildClosures(makeState());
    expect(closures).toEqual([]);
  });

  it("maps a single position correctly", () => {
    const pos = makePosition({ symbol: "ETH/USDC", side: "short", quantity: 2, leverage: 7 });
    const state = makeState({ positions: [pos] });
    const closures = buildClosures(state);
    expect(closures).toHaveLength(1);
    const c = closures[0]!;
    expect(c.symbol).toBe("ETH/USDC");
    expect(c.side).toBe("short");
    expect(c.quantity).toBe(2);
    expect(c.leverage).toBe(7);
    expect(c.notionalUsd).toBe(pos.notionalUsd);
    expect(c.estLossUsd).toBe(pos.unrealizedPnl);
  });

  it("preserves all 3 positions in order", () => {
    const positions = [
      makePosition({ id: "p-1", symbol: "BTC/USDC" }),
      makePosition({ id: "p-2", symbol: "ETH/USDC" }),
      makePosition({ id: "p-3", symbol: "SOL/USDC" }),
    ];
    const closures = buildClosures(makeState({ positions }));
    expect(closures.map((c) => c.id)).toEqual(["p-1", "p-2", "p-3"]);
    expect(closures).toHaveLength(3);
  });
});

// ============================================================================
// `formatTelegramAlert` — build the alert text
// ============================================================================

describe("formatTelegramAlert", () => {
  it("formats the alert for an empty list", () => {
    const text = formatTelegramAlert([], 0, 0, 1_700_000_000_000, "/tmp/state.json");
    expect(text).toContain("KILL-SWITCH TRIGGERED (DRY-RUN)");
    expect(text).toContain("positions=0");
    expect(text).toContain("total notional: $0.00");
    expect(text).toContain("est. P&L: $0.00");
  });

  it("includes the state file path and ISO timestamp", () => {
    const text = formatTelegramAlert([], 0, 0, 1_700_000_000_000, "/data/bot-state.json");
    expect(text).toContain("/data/bot-state.json");
    // 1700000000000 ms = 2023-11-14T22:13:20.000Z
    expect(text).toContain("2023-11-14T22:13:20.000Z");
  });

  it("includes each position in the alert", () => {
    const closures = [
      {
        id: "p-1",
        strategy: "donchian",
        symbol: "BTC/USDC",
        side: "long" as const,
        quantity: 0.5,
        notionalUsd: 15_000,
        estLossUsd: 500,
        leverage: 5,
      },
    ];
    const text = formatTelegramAlert(closures, 15_000, 500, 1_700_000_000_000, "/s.json");
    expect(text).toContain("positions=1");
    expect(text).toContain("BTC/USDC LONG 0.5");
    expect(text).toContain("lev 5x");
    expect(text).toContain("notional $15000.00");
    expect(text).toContain("est. P&L $500.00");
  });
});

// ============================================================================
// `formatJsonLogLines` — build the structured JSON log lines
// ============================================================================

describe("formatJsonLogLines", () => {
  it("emits only the summary line when the closures list is empty", () => {
    const lines = formatJsonLogLines([], 0, 0, 1_700_000_000_000, "/s.json");
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]!);
    expect(parsed.level).toBe("error");
    expect(parsed.tag).toBe("kill-switch-dry-run");
    expect(parsed.positions).toBe(0);
    expect(parsed.totalNotionalUsd).toBe(0);
    expect(parsed.totalEstLossUsd).toBe(0);
  });

  it("emits a per-position line for each closure", () => {
    const closures = [
      {
        id: "p-1",
        strategy: "donchian",
        symbol: "BTC/USDC",
        side: "long" as const,
        quantity: 0.5,
        notionalUsd: 15_000,
        estLossUsd: 500,
        leverage: 5,
      },
      {
        id: "p-2",
        strategy: "carry",
        symbol: "ETH/USDC",
        side: "short" as const,
        quantity: 1.0,
        notionalUsd: 2_000,
        estLossUsd: -100,
        leverage: 3,
      },
    ];
    const lines = formatJsonLogLines(closures, 17_000, 400, 1_700_000_000_000, "/s.json");
    expect(lines).toHaveLength(3);
    const summary = JSON.parse(lines[0]!);
    expect(summary.positions).toBe(2);
    expect(summary.totalNotionalUsd).toBe(17_000);
    const p1 = JSON.parse(lines[1]!);
    expect(p1.symbol).toBe("BTC/USDC");
    expect(p1.positionId).toBe("p-1");
    const p2 = JSON.parse(lines[2]!);
    expect(p2.symbol).toBe("ETH/USDC");
    expect(p2.side).toBe("short");
  });
});

// ============================================================================
// `computeWouldTrigger` — would the kill-switch auto-fire?
// ============================================================================

describe("computeWouldTrigger", () => {
  it("returns false when there are no positions", () => {
    const state = makeState({ equityUsd: 5_000 }); // 50% drawdown
    expect(computeWouldTrigger(state, 0.15)).toBe(false);
  });

  it("returns true when drawdown >= threshold and positions exist", () => {
    const state = makeState({
      equityUsd: 8_000,
      initialEquityUsd: 10_000,
      positions: [makePosition()],
    });
    // 20% drawdown >= 15% threshold
    expect(computeWouldTrigger(state, 0.15)).toBe(true);
  });

  it("returns false when drawdown < threshold and positions exist", () => {
    const state = makeState({
      equityUsd: 9_000,
      initialEquityUsd: 10_000,
      positions: [makePosition()],
    });
    // 10% drawdown < 15% threshold
    expect(computeWouldTrigger(state, 0.15)).toBe(false);
  });

  it("returns true when drawdown exactly equals threshold", () => {
    const state = makeState({
      equityUsd: 8_500,
      initialEquityUsd: 10_000,
      positions: [makePosition()],
    });
    expect(computeWouldTrigger(state, 0.15)).toBe(true);
  });

  it("returns false when initialEquityUsd is 0 (defensive — no division by zero)", () => {
    const state = makeState({
      equityUsd: 0,
      initialEquityUsd: 0,
      positions: [makePosition()],
    });
    expect(computeWouldTrigger(state, 0.15)).toBe(false);
  });
});

// ============================================================================
// `buildReport` — orchestrate the full report
// ============================================================================

describe("buildReport", () => {
  it("uses Date.now() when generatedAt is not provided", () => {
    const before = Date.now();
    const report = buildReport({
      state: makeState(),
      stateFilePath: "/s.json",
      configPath: undefined,
      maxDrawdownPct: 0.15,
    });
    const after = Date.now();
    expect(report.generatedAt).toBeGreaterThanOrEqual(before);
    expect(report.generatedAt).toBeLessThanOrEqual(after);
  });

  it("uses the explicit generatedAt when provided", () => {
    const report = buildReport({
      state: makeState(),
      stateFilePath: "/s.json",
      configPath: "/c.toml",
      maxDrawdownPct: 0.15,
      generatedAt: 1_700_000_000_000,
    });
    expect(report.generatedAt).toBe(1_700_000_000_000);
    expect(report.configPath).toBe("/c.toml");
  });

  it("sets wouldTrigger=true and 'breached' description when drawdown > threshold", () => {
    const report = buildReport({
      state: makeState({
        equityUsd: 7_000,
        initialEquityUsd: 10_000,
        positions: [makePosition()],
      }),
      stateFilePath: "/s.json",
      configPath: undefined,
      maxDrawdownPct: 0.15,
    });
    expect(report.wouldTrigger).toBe(true);
    expect(report.killSwitchDescription).toContain("breached");
  });

  it("sets wouldTrigger=false and 'within budget' description when drawdown < threshold", () => {
    const report = buildReport({
      state: makeState({
        equityUsd: 9_500,
        initialEquityUsd: 10_000,
        positions: [makePosition()],
      }),
      stateFilePath: "/s.json",
      configPath: undefined,
      maxDrawdownPct: 0.15,
    });
    expect(report.wouldTrigger).toBe(false);
    expect(report.killSwitchDescription).toContain("within budget");
  });

  it("sums total notional + est P&L across multiple positions", () => {
    const positions = [
      makePosition({ notionalUsd: 1000, unrealizedPnl: 100 }),
      makePosition({ notionalUsd: 2000, unrealizedPnl: -50 }),
      makePosition({ notionalUsd: 500, unrealizedPnl: 25 }),
    ];
    const report = buildReport({
      state: makeState({ positions }),
      stateFilePath: "/s.json",
      configPath: undefined,
      maxDrawdownPct: 0.15,
    });
    expect(report.totalNotionalUsd).toBe(3500);
    expect(report.totalEstLossUsd).toBe(75);
  });

  it("builds the telegram alert + JSON log lines", () => {
    const report = buildReport({
      state: makeState({ positions: [makePosition()] }),
      stateFilePath: "/s.json",
      configPath: undefined,
      maxDrawdownPct: 0.15,
    });
    expect(report.telegramAlertText).toContain("KILL-SWITCH TRIGGERED (DRY-RUN)");
    expect(report.jsonLogLines).toHaveLength(2); // summary + 1 closure
  });
});

// ============================================================================
// `printHumanReadable` + `printJson` — output formatters
// ============================================================================

describe("printHumanReadable", () => {
  let logSpy: ReturnType<typeof spyOn>;
  let logged: string[];

  beforeEach(() => {
    logged = [];
    logSpy = spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      logged.push(args.map((a) => (typeof a === "string" ? a : String(a))).join(" "));
    });
  });
  afterEach(() => {
    logSpy.mockRestore();
  });

  it("prints the WOULD TRIGGER verdict in red when wouldTrigger is true", () => {
    const report = buildReport({
      state: makeState({
        equityUsd: 7_000,
        initialEquityUsd: 10_000,
        positions: [makePosition()],
      }),
      stateFilePath: "/s.json",
      configPath: undefined,
      maxDrawdownPct: 0.15,
    });
    printHumanReadable(report);
    const out = logged.join("\n");
    expect(out).toContain("WOULD TRIGGER");
    expect(out).toContain("[kill-switch-dry-run]");
  });

  it("prints the NO AUTO-TRIGGER verdict in green when wouldTrigger is false", () => {
    const report = buildReport({
      state: makeState(),
      stateFilePath: "/s.json",
      configPath: undefined,
      maxDrawdownPct: 0.15,
    });
    printHumanReadable(report);
    const out = logged.join("\n");
    expect(out).toContain("NO AUTO-TRIGGER");
  });

  it("prints a '(no open positions)' message when the list is empty", () => {
    const report = buildReport({
      state: makeState(),
      stateFilePath: "/s.json",
      configPath: undefined,
      maxDrawdownPct: 0.15,
    });
    printHumanReadable(report);
    expect(logged.join("\n")).toContain("(no open positions");
  });

  it("lists each closure with symbol/side/qty/lev/notional", () => {
    const report = buildReport({
      state: makeState({
        positions: [
          makePosition({ symbol: "BTC/USDC", side: "long", quantity: 0.5, leverage: 5 }),
        ],
      }),
      stateFilePath: "/s.json",
      configPath: undefined,
      maxDrawdownPct: 0.15,
    });
    printHumanReadable(report);
    const out = logged.join("\n");
    expect(out).toContain("BTC/USDC");
    expect(out).toContain("LONG");
    expect(out).toContain("qty=0.5");
    expect(out).toContain("lev=5x");
  });

  it("includes the config path when provided", () => {
    const report = buildReport({
      state: makeState(),
      stateFilePath: "/s.json",
      configPath: "/etc/live-tokyo.toml",
      maxDrawdownPct: 0.15,
    });
    printHumanReadable(report);
    expect(logged.join("\n")).toContain("/etc/live-tokyo.toml");
  });
});

describe("printJson", () => {
  let logSpy: ReturnType<typeof spyOn>;
  let logged: string[];

  beforeEach(() => {
    logged = [];
    logSpy = spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      logged.push(args.map((a) => (typeof a === "string" ? a : String(a))).join(" "));
    });
  });
  afterEach(() => {
    logSpy.mockRestore();
  });

  it("emits a single JSON object with all report fields", () => {
    const report = buildReport({
      state: makeState({ positions: [makePosition()] }),
      stateFilePath: "/s.json",
      configPath: undefined,
      maxDrawdownPct: 0.15,
    });
    printJson(report);
    const parsed = JSON.parse(logged[0]!);
    expect(parsed.stateFilePath).toBe("/s.json");
    expect(parsed.configPath).toBeUndefined();
    expect(parsed.killSwitchId).toBe("kill-switch-dry-run");
    expect(parsed.positions).toBe(1);
    expect(parsed.closures).toHaveLength(1);
    expect(parsed.telegramAlert).toContain("KILL-SWITCH TRIGGERED (DRY-RUN)");
    expect(parsed.jsonLogLines).toHaveLength(2);
  });
});

// ============================================================================
// `killSwitchDryRunCommand` — the CLI handler (end-to-end)
// ============================================================================

async function runCommand(argv: readonly string[]): Promise<number> {
  const parsed = parseArgv(argv);
  return killSwitchDryRunCommand(parsed, {} as CliContext);
}

describe("killSwitchDryRunCommand", () => {
  let logSpy: ReturnType<typeof spyOn>;
  let errorSpy: ReturnType<typeof spyOn>;
  let logged: string[];
  let errored: string[];

  beforeEach(() => {
    logged = [];
    errored = [];
    logSpy = spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      logged.push(args.map((a) => (typeof a === "string" ? a : String(a))).join(" "));
    });
    errorSpy = spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      errored.push(args.map((a) => (typeof a === "string" ? a : String(a))).join(" "));
    });
  });
  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("--help → 0 + usage text", async () => {
    const code = await runCommand(["kill-switch-dry-run", "--help"]);
    expect(code).toBe(0);
    const out = logged.join("\n");
    expect(out).toContain("Usage: mm-bot kill-switch-dry-run");
    expect(out).toContain("--json");
    expect(out).toContain("--config=");
  });

  it("returns 1 when the state file does not exist (default config)", async () => {
    // Build a temp config that points to a state file in a temp dir
    // we do NOT create. The handler will see `state_file = <missing>`
    // and exit 1. This is portable across all working directories
    // (the test does NOT depend on the repo's `data/bot-state.json`
    // being absent — it actively creates an isolated fixture).
    const dir = mkdtempSync(join(tmpdir(), "ksdr-no-state-"));
    const configFile = join(dir, "config.toml");
    writeFileSync(
      configFile,
      `[bot]\nstate_file = "${join(dir, "does-not-exist.json")}"\n`,
      "utf8",
    );
    try {
      const code = await runCommand([
        "kill-switch-dry-run",
        "--json",
        `--config=${configFile}`,
      ]);
      expect(code).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns 1 (human-readable) when the state file is missing", async () => {
    // Same as above but without --json, exercising the colored
    // human-readable error path.
    const dir = mkdtempSync(join(tmpdir(), "ksdr-no-state-hr-"));
    const configFile = join(dir, "config.toml");
    writeFileSync(
      configFile,
      `[bot]\nstate_file = "${join(dir, "does-not-exist.json")}"\n`,
      "utf8",
    );
    try {
      const code = await runCommand([
        "kill-switch-dry-run",
        `--config=${configFile}`,
      ]);
      expect(code).toBe(1);
      expect(errored.join("\n")).toContain("state file not found");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns 0 + dry-run report when the state file is valid", async () => {
    // We build a temp config that points to a temp state file we
    // pre-populate with a valid BotState.
    const dir = mkdtempSync(join(tmpdir(), "ksdr-cmd-"));
    const stateFile = join(dir, "state.json");
    const configFile = join(dir, "config.toml");
    writeFileSync(
      stateFile,
      JSON.stringify(
        makeState({
          positions: [
            makePosition({ symbol: "BTC/USDC", side: "long", quantity: 0.5, leverage: 5 }),
          ],
        }),
      ),
      "utf8",
    );
    writeFileSync(
      configFile,
      `[bot]\nstate_file = "${stateFile}"\n`,
      "utf8",
    );
    try {
      const code = await runCommand(["kill-switch-dry-run", `--config=${configFile}`]);
      expect(code).toBe(0);
      const out = logged.join("\n");
      expect(out).toContain("[kill-switch-dry-run]");
      expect(out).toContain("BTC/USDC");
      expect(out).toContain("LONG");
      expect(out).toContain("(dry-run: NO orders were sent");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns 0 + JSON output in --json mode", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ksdr-cmd-json-"));
    const stateFile = join(dir, "state.json");
    const configFile = join(dir, "config.toml");
    writeFileSync(
      stateFile,
      JSON.stringify(makeState({ positions: [makePosition()] })),
      "utf8",
    );
    writeFileSync(
      configFile,
      `[bot]\nstate_file = "${stateFile}"\n`,
      "utf8",
    );
    try {
      const code = await runCommand([
        "kill-switch-dry-run",
        "--json",
        `--config=${configFile}`,
      ]);
      expect(code).toBe(0);
      // The entire output should be a single JSON object.
      const parsed = JSON.parse(logged.join("\n"));
      expect(parsed.stateFilePath).toBe(stateFile);
      expect(parsed.positions).toBe(1);
      expect(parsed.wouldTrigger).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns 0 + JSON error envelope in --json mode when state file is missing", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ksdr-no-state-json-"));
    const configFile = join(dir, "config.toml");
    writeFileSync(
      configFile,
      `[bot]\nstate_file = "${join(dir, "does-not-exist.json")}"\n`,
      "utf8",
    );
    try {
      const code = await runCommand([
        "kill-switch-dry-run",
        "--json",
        `--config=${configFile}`,
      ]);
      expect(code).toBe(1);
      const parsed = JSON.parse(logged.join("\n"));
      expect(parsed.error).toContain("state file not found");
      expect(parsed.wouldTrigger).toBe(false);
      expect(parsed.positions).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns 2 on ConfigError (invalid config)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ksdr-cfg-err-"));
    const badConfig = join(dir, "bad.toml");
    writeFileSync(badConfig, "[risk]\nmax_leverage = 99\n", "utf8");
    try {
      const code = await runCommand(["kill-switch-dry-run", `--config=${badConfig}`]);
      expect(code).toBe(2);
      expect(errored.join("\n")).toContain("Config validation FAILED");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns 2 on file-not-found (loader wraps IO errors in ConfigError)", async () => {
    // The `loadBotConfig` loader wraps file-not-found errors in
    // `ConfigError` (the canonical pattern: all loader failures are
    // `ConfigError`, so the CLI can distinguish them from runtime
    // errors).  This test pins that behavior — the file-missing
    // path MUST exit with code 2 (the "config validation failure"
    // code), not 1.
    const dir = mkdtempSync(join(tmpdir(), "ksdr-missing-"));
    const missingConfig = join(dir, "no-such-config.toml");
    const code = await runCommand(["kill-switch-dry-run", `--config=${missingConfig}`]);
    expect(code).toBe(2);
    // The error message may vary — assert it's non-empty.
    expect(errored.join("\n").length).toBeGreaterThan(0);
  });

  it("returns 1 when loadBotConfig throws a non-ConfigError (defensive runtime branch)", async () => {
    // The `loadBotConfig` wrapper normally wraps all failures in
    // `ConfigError`, but a buggy future implementation could leak
    // a raw Error. The handler's defensive `catch` branch covers
    // that case — exit 1 + the error message on stderr.
    //
    // We force this branch by spying on `loadBotConfig` and making
    // it throw a plain `Error` (NOT a `ConfigError`).
    const configMod = await import("../../config/index.js");
    const loadSpy = spyOn(configMod, "loadBotConfig").mockImplementation(() => {
      throw new Error("intentional non-ConfigError failure");
    });
    try {
      const code = await runCommand(["kill-switch-dry-run"]);
      expect(code).toBe(1);
      expect(errored.join("\n")).toContain("intentional non-ConfigError failure");
    } finally {
      loadSpy.mockRestore();
    }
  });

  it("returns 1 (defensive) when loadState returns state=null with no error (contract violation)", async () => {
    // The `loadState` contract guarantees `state !== null` when
    // `error === null`. The handler still has a defensive branch
    // for that contract violation — we cover it here by mocking
    // `loadState` to return `{ state: null, error: null }`.
    const ksdrMod = await import("./kill-switch-dry-run.js");
    const loadStateSpy = spyOn(ksdrMod, "loadState").mockReturnValue({
      state: null,
      error: null,
    });
    try {
      const code = await runCommand(["kill-switch-dry-run"]);
      expect(code).toBe(1);
      expect(errored.join("\n")).toContain("contract violation");
    } finally {
      loadStateSpy.mockRestore();
    }
  });

  it("returns 1 (JSON mode) when loadState returns state=null with no error", async () => {
    // Same as above but exercising the --json branch of the
    // defensive `state === null` path.
    const ksdrMod = await import("./kill-switch-dry-run.js");
    const loadStateSpy = spyOn(ksdrMod, "loadState").mockReturnValue({
      state: null,
      error: null,
    });
    try {
      const code = await runCommand(["kill-switch-dry-run", "--json"]);
      expect(code).toBe(1);
      const parsed = JSON.parse(logged.join("\n"));
      expect(parsed.error).toContain("contract violation");
      expect(parsed.wouldTrigger).toBe(false);
    } finally {
      loadStateSpy.mockRestore();
    }
  });
});
