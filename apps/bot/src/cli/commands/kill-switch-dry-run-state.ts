import { existsSync, readFileSync } from "node:fs";

import { BotStateSchema, type BotState } from "../../bot/state-store.js";

export interface SimulatedPositionClosure {
  readonly id: string;
  readonly strategy: string;
  readonly symbol: string;
  readonly side: "long" | "short";
  readonly quantity: number;
  readonly notionalUsd: number;
  readonly estLossUsd: number;
  readonly leverage: number;
}

export interface LoadedDryRunState {
  readonly state: BotState | undefined;
  readonly error: string | undefined;
}

export interface DryRunStateFilePort {
  readonly exists: (filePath: string) => boolean;
  readonly readText: (filePath: string, encoding: "utf8") => string;
}

const nodeStateFilePort: DryRunStateFilePort = {
  exists: existsSync,
  readText: readFileSync,
};

export function loadState(
  filePath: string,
  files: DryRunStateFilePort = nodeStateFilePort,
): LoadedDryRunState {
  if (!files.exists(filePath)) return { state: undefined, error: `state file not found: ${filePath}` };
  let raw: string;
  try {
    raw = files.readText(filePath, "utf8");
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return { state: undefined, error: `failed to read ${filePath}: ${message}` };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error: unknown) {
    const message = String(error).replace(/^SyntaxError: /, "");
    return { state: undefined, error: `invalid JSON in ${filePath}: ${message}` };
  }
  const validated = BotStateSchema.safeParse(parsed);
  if (!validated.success) {
    return {
      state: undefined,
      error: `state file schema invalid: ${validated.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`,
    };
  }
  return { state: validated.data, error: undefined };
}

export function buildClosures(state: BotState): readonly SimulatedPositionClosure[] {
  return state.positions.map((position) => ({
    id: position.id,
    strategy: position.strategy,
    symbol: position.symbol,
    side: position.side,
    quantity: position.quantity,
    notionalUsd: position.notionalUsd,
    estLossUsd: position.unrealizedPnl,
    leverage: position.leverage,
  }));
}

export function isKillSwitchWouldTriggered(state: BotState, maxDrawdownPct: number): boolean {
  if (state.positions.length === 0) return false;
  const drawdown =
    state.initialEquityUsd > 0 ? (state.initialEquityUsd - state.equityUsd) / state.initialEquityUsd : 0;
  return drawdown >= maxDrawdownPct;
}
