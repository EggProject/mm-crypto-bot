import type { BotState } from "../../bot/state-store.js";
import { colorize } from "../color.js";

import {
  buildClosures,
  isKillSwitchWouldTriggered,
  type SimulatedPositionClosure,
} from "./kill-switch-dry-run-state.js";

export interface DryRunReport {
  readonly generatedAt: number;
  readonly configPath: string | undefined;
  readonly stateFilePath: string;
  readonly killSwitchId: string;
  readonly killSwitchDescription: string;
  readonly wouldTrigger: boolean;
  readonly closures: readonly SimulatedPositionClosure[];
  readonly totalNotionalUsd: number;
  readonly totalEstLossUsd: number;
  readonly telegramAlertText: string;
  readonly jsonLogLines: readonly string[];
}

export function formatTelegramAlert(
  closures: readonly SimulatedPositionClosure[],
  totalNotionalUsd: number,
  totalEstLossUsd: number,
  generatedAt: number,
  stateFilePath: string,
): string {
  const lines = [
    "🚨 KILL-SWITCH TRIGGERED (DRY-RUN)",
    `${new Date(generatedAt).toISOString()} | state=${stateFilePath} | positions=${String(closures.length)}`,
    `total notional: $${totalNotionalUsd.toFixed(2)} | est. P&L: $${totalEstLossUsd.toFixed(2)}`,
  ];
  for (const closure of closures)
    lines.push(
      `  • ${closure.symbol} ${closure.side.toUpperCase()} ${String(closure.quantity)} (lev ${String(closure.leverage)}x, notional $${closure.notionalUsd.toFixed(2)}, est. P&L $${closure.estLossUsd.toFixed(2)})`,
    );
  return lines.join("\n");
}

export function formatJsonLogLines(
  closures: readonly SimulatedPositionClosure[],
  totalNotionalUsd: number,
  totalEstLossUsd: number,
  generatedAt: number,
  stateFilePath: string,
): readonly string[] {
  const lines = [
    JSON.stringify({
      level: "error",
      tag: "kill-switch-dry-run",
      msg: "kill-switch DRY-RUN — no orders sent",
      stateFile: stateFilePath,
      positions: closures.length,
      totalNotionalUsd,
      totalEstLossUsd,
      timestamp: generatedAt,
    }),
  ];
  for (const closure of closures)
    lines.push(
      JSON.stringify({
        level: "warn",
        tag: "kill-switch-dry-run",
        msg: "would close position",
        positionId: closure.id,
        strategy: closure.strategy,
        symbol: closure.symbol,
        side: closure.side,
        quantity: closure.quantity,
        leverage: closure.leverage,
        notionalUsd: closure.notionalUsd,
        estLossUsd: closure.estLossUsd,
        timestamp: generatedAt,
      }),
    );
  return lines;
}

export function buildReport(input: {
  readonly state: BotState;
  readonly stateFilePath: string;
  readonly configPath: string | undefined;
  readonly maxDrawdownPct: number;
  readonly generatedAt?: number;
}): DryRunReport {
  const generatedAt = input.generatedAt ?? Date.now();
  const closures = buildClosures(input.state);
  const totalNotionalUsd = closures.reduce((total, closure) => total + closure.notionalUsd, 0);
  const totalEstLossUsd = closures.reduce((total, closure) => total + closure.estLossUsd, 0);
  const isWouldTrigger = isKillSwitchWouldTriggered(input.state, input.maxDrawdownPct);
  return {
    generatedAt,
    configPath: input.configPath,
    stateFilePath: input.stateFilePath,
    killSwitchId: "kill-switch-dry-run",
    killSwitchDescription: isWouldTrigger
      ? `Max drawdown ${(input.maxDrawdownPct * 100).toFixed(1)}% breached → all positions would close`
      : `No auto-trigger (positions=${String(closures.length)}, drawdown within budget)`,
    wouldTrigger: isWouldTrigger,
    closures,
    totalNotionalUsd,
    totalEstLossUsd,
    telegramAlertText: formatTelegramAlert(
      closures,
      totalNotionalUsd,
      totalEstLossUsd,
      generatedAt,
      input.stateFilePath,
    ),
    jsonLogLines: formatJsonLogLines(
      closures,
      totalNotionalUsd,
      totalEstLossUsd,
      generatedAt,
      input.stateFilePath,
    ),
  };
}

export function printHumanReadable(report: DryRunReport): void {
  const verdict = report.wouldTrigger ? "WOULD TRIGGER" : "NO AUTO-TRIGGER";
  console.log(
    `${colorize("[kill-switch-dry-run]", "bold")} ${colorize(verdict, report.wouldTrigger ? "red" : "green")}`,
  );
  console.log(`  Switch:         ${report.killSwitchId}`);
  console.log(`  Description:    ${report.killSwitchDescription}`);
  console.log(`  State file:     ${report.stateFilePath}`);
  if (report.configPath !== undefined) console.log(`  Config:         ${report.configPath}`);
  console.log(`  Generated at:   ${new Date(report.generatedAt).toISOString()}`);
  console.log(
    `  Positions: ${String(report.closures.length)}  |  Total notional: $${report.totalNotionalUsd.toFixed(2)}  |  est. P&L: $${report.totalEstLossUsd.toFixed(2)}`,
  );
  if (report.closures.length === 0)
    console.log(colorize("  (no open positions → nothing would close)", "dim"));
  for (const closure of report.closures)
    console.log(
      `    • ${closure.symbol.padEnd(12, " ")} ${closure.side.toUpperCase().padEnd(5, " ")} qty=${String(closure.quantity)} lev=${String(closure.leverage)}x notional=$${closure.notionalUsd.toFixed(2)} est.P&L=$${closure.estLossUsd.toFixed(2)}`,
    );
  console.log(colorize("  (dry-run: NO orders were sent. No exchange state was modified.)", "yellow"));
}

export function printJson(report: DryRunReport): void {
  console.log(
    JSON.stringify(
      { ...report, positions: report.closures.length, telegramAlert: report.telegramAlertText },
      undefined,
      2,
    ),
  );
}
