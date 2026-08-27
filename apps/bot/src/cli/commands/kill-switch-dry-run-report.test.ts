import { describe, expect, it, spyOn } from "bun:test";

import { makeDryRunPosition, makeDryRunState } from "./kill-switch-dry-run-test-support.test.js";
import {
  buildReport,
  formatJsonLogLines,
  formatTelegramAlert,
  printHumanReadable,
  printJson,
} from "./kill-switch-dry-run.js";

describe("kill-switch dry-run report", () => {
  it("formats alert and telemetry for empty and positioned reports", () => {
    expect(formatTelegramAlert([], 0, 0, 1_700_000_000_000, "/state.json")).toContain("positions=0");
    const closures = [{ ...makeDryRunPosition(), estLossUsd: 500 }];
    const alert = formatTelegramAlert(closures, 15_000, 500, 1_700_000_000_000, "/state.json");
    expect(alert).toContain("BTC/USDC LONG");
    const lines = formatJsonLogLines(closures, 15_000, 500, 1_700_000_000_000, "/state.json");
    expect(lines).toHaveLength(2);
    const positionLine = lines[1] ?? "{}";
    expect(JSON.parse(positionLine)).toMatchObject({ positionId: "pos-1", level: "warn" });
  });

  it("builds a deterministic report for breached and non-breached state", () => {
    const report = buildReport({
      state: makeDryRunState({ positions: [makeDryRunPosition()], equityUsd: 8500 }),
      stateFilePath: "/state.json",
      configPath: "/config.toml",
      maxDrawdownPct: 0.15,
      generatedAt: 1_700_000_000_000,
    });
    expect(report).toMatchObject({
      wouldTrigger: true,
      killSwitchId: "kill-switch-dry-run",
      totalNotionalUsd: 15_000,
      totalEstLossUsd: 500,
    });
    expect(report.killSwitchDescription).toContain("breached");
    const nonBreachedState = makeDryRunState({ positions: [makeDryRunPosition()] });
    const nonBreachedReport = buildReport({
      state: nonBreachedState,
      stateFilePath: "/state.json",
      configPath: undefined,
      maxDrawdownPct: 0.15,
    });
    expect(nonBreachedReport.wouldTrigger).toBe(false);
  });

  it("prints human and JSON output without sending state-changing commands", () => {
    const lines: string[] = [];
    const logSpy = spyOn(console, "log").mockImplementation((...values: unknown[]) => {
      lines.push(values.join(" "));
    });
    try {
      const report = buildReport({
        state: makeDryRunState({ positions: [makeDryRunPosition()] }),
        stateFilePath: "/state.json",
        configPath: "/config.toml",
        maxDrawdownPct: 0.15,
        generatedAt: 1_700_000_000_000,
      });
      printHumanReadable(report);
      expect(lines.join("\n")).toContain("NO AUTO-TRIGGER");
      expect(lines.join("\n")).toContain("Config:         /config.toml");
      expect(lines.join("\n")).toContain("BTC/USDC");
      printJson(report);
      expect(JSON.parse(lines.at(-1) ?? "{}")).toMatchObject({ positions: 1, wouldTrigger: false });
    } finally {
      logSpy.mockRestore();
    }
  });

  it("prints a breached report without an explicit configuration path", () => {
    const lines: string[] = [];
    const logSpy = spyOn(console, "log").mockImplementation((...values: unknown[]) => {
      lines.push(values.join(" "));
    });
    try {
      const report = buildReport({
        state: makeDryRunState({ positions: [makeDryRunPosition()], equityUsd: 8500 }),
        stateFilePath: "/state.json",
        configPath: undefined,
        maxDrawdownPct: 0.15,
        generatedAt: 1_700_000_000_000,
      });
      printHumanReadable(report);
      expect(lines.join("\n")).toContain("WOULD TRIGGER");
      expect(lines.join("\n")).not.toContain("Config:");
    } finally {
      logSpy.mockRestore();
    }
  });
});
