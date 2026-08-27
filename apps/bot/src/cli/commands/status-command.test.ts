import { describe, expect, it, spyOn } from "bun:test";

import { DEFAULT_BOT_CONFIG } from "../../config/defaults.js";
import type { BotState } from "../../bot/state-store.js";
import { parseArgv } from "../argv.js";
import type { CliContext } from "../router.js";

import type { CommandStateFilePort } from "./command-state-file.js";
import { createStatusCommand } from "./status.js";

const CLI_CONTEXT: CliContext = { config: DEFAULT_BOT_CONFIG };
const STATE_PATH = "/var/lib/mm-bot/state.json";
const ROOT = "/var/lib/mm-bot";
const VALID_STATE: BotState = {
  version: 1,
  savedAt: 0,
  equityUsd: 1000,
  initialEquityUsd: 1000,
  realizedPnlUsd: 0,
  positions: [],
  closedTrades: [],
  inFlightOrderIds: [],
  counters: { placed: 0, filled: 0, cancelled: 0, rejected: 0 },
};

function configWithStatePath() {
  return { ...DEFAULT_BOT_CONFIG, bot: { ...DEFAULT_BOT_CONFIG.bot, state_file: STATE_PATH } };
}

function successfulRoot() {
  return { ok: true as const, runtimeRoot: ROOT, configPath: `${ROOT}/config/default.toml` };
}

function port(isPresent: boolean, readText: () => string): CommandStateFilePort {
  return { exists: () => isPresent, readText };
}

async function run(
  stateFile: CommandStateFilePort,
): Promise<{ readonly code: number; readonly logs: readonly string[] }> {
  const logs: string[] = [];
  const logSpy = spyOn(console, "log").mockImplementation((...values: unknown[]) => {
    logs.push(values.join(" "));
  });
  const command = createStatusCommand({
    loadConfig: () => configWithStatePath(),
    resolveRuntimeRoot: successfulRoot,
    stateFile,
  });
  try {
    return { code: await command(parseArgv(["status"]), CLI_CONTEXT), logs };
  } finally {
    logSpy.mockRestore();
  }
}

describe("status state-file boundary", () => {
  it("reports missing, throwing, malformed, and schema-invalid state without throwing", async () => {
    const missing = await run(port(false, () => "unused"));
    const throwing = await run(
      port(true, () => {
        // eslint-disable-next-line @typescript-eslint/only-throw-error -- Exercises the public non-Error state-file boundary.
        throw "read rejected";
      }),
    );
    const malformed = await run(port(true, () => "{"));
    const invalid = await run(port(true, () => "{}"));

    expect([missing.code, throwing.code, malformed.code, invalid.code]).toEqual([1, 1, 1, 1]);
    expect(missing.logs.join("\n")).toContain("state file not found");
    expect(throwing.logs.join("\n")).toContain("read rejected");
    expect(malformed.logs.join("\n")).toContain("invalid JSON");
    expect(invalid.logs.join("\n")).toContain("schema invalid");
  });

  it("renders empty and populated validated state", async () => {
    const empty = await run(port(true, () => JSON.stringify(VALID_STATE)));
    const populatedState: BotState = {
      ...VALID_STATE,
      realizedPnlUsd: 4,
      positions: [
        {
          id: "p",
          strategy: "s",
          symbol: "BTC/USDT",
          side: "long",
          quantity: 1,
          entryPrice: 2,
          currentPrice: 3,
          leverage: 1,
          unrealizedPnl: 1,
          realizedPnl: 0,
          openedAt: 0,
          notionalUsd: 2,
        },
      ],
      closedTrades: [
        {
          strategy: "s",
          symbol: "BTC/USDT",
          side: "long",
          quantity: 1,
          entryPrice: 2,
          exitPrice: 3,
          pnl: 1,
          pnlPct: 50,
          closedAt: 0,
        },
      ],
      counters: { placed: 1, filled: 1, cancelled: 0, rejected: 0 },
    };
    const populated = await run(port(true, () => JSON.stringify(populatedState)));

    expect(empty.code).toBe(0);
    expect(empty.logs.join("\n")).toContain("(none)");
    expect(populated.code).toBe(0);
    expect(populated.logs.join("\n")).toContain("BTC/USDT");
  });
});
