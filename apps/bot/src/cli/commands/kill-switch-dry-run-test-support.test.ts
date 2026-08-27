import type { BotState } from "../../bot/state-store.js";

export function makeDryRunState(overrides: Partial<BotState> = {}): BotState {
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

export function makeDryRunPosition(
  overrides: Partial<BotState["positions"][number]> = {},
): BotState["positions"][number] {
  return {
    id: "pos-1",
    strategy: "donchian_pivot_composition",
    symbol: "BTC/USDC",
    side: "long",
    quantity: 0.5,
    entryPrice: 30_000,
    currentPrice: 31_000,
    leverage: 5,
    unrealizedPnl: 500,
    realizedPnl: 0,
    openedAt: 1_700_000_000_000,
    notionalUsd: 15_000,
    ...overrides,
  };
}
