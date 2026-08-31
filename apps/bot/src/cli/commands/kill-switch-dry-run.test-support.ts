import { spyOn } from "bun:test";

import { loadBotConfig } from "../../config/index.js";
import type { BotState } from "../../bot/state-store.js";
import type { CliContext } from "../router.js";

export function makeState(overrides: Partial<BotState> = {}): BotState {
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
  return { ...base, ...overrides, counters: { ...base.counters, ...overrides.counters } };
}

export function makePosition(
  overrides: Partial<BotState["positions"][number]> = {},
): BotState["positions"][number] {
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

export function parseJsonRecord(value: string): Readonly<Record<string, unknown>> {
  const parsed: unknown = JSON.parse(value);
  if (!isJsonRecord(parsed)) {
    throw new TypeError("expected a JSON object");
  }
  return parsed;
}

function isJsonRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function captureConsole(): {
  readonly logged: string[];
  readonly errored: string[];
  readonly restore: () => void;
} {
  const logged: string[] = [];
  const errored: string[] = [];
  const logSpy = spyOn(console, "log").mockImplementation((...arguments_: unknown[]) => {
    logged.push(arguments_.map((value) => (typeof value === "string" ? value : String(value))).join(" "));
  });
  const errorSpy = spyOn(console, "error").mockImplementation((...arguments_: unknown[]) => {
    errored.push(arguments_.map((value) => (typeof value === "string" ? value : String(value))).join(" "));
  });
  return {
    logged,
    errored,
    restore: () => {
      logSpy.mockRestore();
      errorSpy.mockRestore();
    },
  };
}

export const cliContext: CliContext = { config: loadBotConfig() };
