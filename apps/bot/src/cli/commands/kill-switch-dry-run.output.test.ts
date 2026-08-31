import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { buildReport, printHumanReadable, printJson } from "./kill-switch-dry-run.js";
import {
  captureConsole,
  makePosition,
  makeState,
  parseJsonRecord,
} from "./kill-switch-dry-run.test-support.js";

describe("printHumanReadable", () => {
  let consoleCapture: ReturnType<typeof captureConsole>;

  beforeEach(() => {
    consoleCapture = captureConsole();
  });
  afterEach(() => {
    consoleCapture.restore();
  });

  it("prints the WOULD TRIGGER verdict in red when wouldTrigger is true", () => {
    const report = buildReport({
      state: makeState({ equityUsd: 7000, initialEquityUsd: 10_000, positions: [makePosition()] }),
      stateFilePath: "/s.json",
      configPath: undefined,
      maxDrawdownPct: 0.15,
    });
    printHumanReadable(report);
    const output = consoleCapture.logged.join("\n");
    expect(output).toContain("WOULD TRIGGER");
    expect(output).toContain("[kill-switch-dry-run]");
  });

  it("prints the NO AUTO-TRIGGER verdict in green when wouldTrigger is false", () => {
    const report = buildReport({
      state: makeState(),
      stateFilePath: "/s.json",
      configPath: undefined,
      maxDrawdownPct: 0.15,
    });
    printHumanReadable(report);
    expect(consoleCapture.logged.join("\n")).toContain("NO AUTO-TRIGGER");
  });

  it("prints a '(no open positions)' message when the list is empty", () => {
    const report = buildReport({
      state: makeState(),
      stateFilePath: "/s.json",
      configPath: undefined,
      maxDrawdownPct: 0.15,
    });
    printHumanReadable(report);
    expect(consoleCapture.logged.join("\n")).toContain("(no open positions");
  });

  it("lists each closure with symbol/side/qty/lev/notional", () => {
    const report = buildReport({
      state: makeState({
        positions: [makePosition({ symbol: "BTC/USDC", side: "long", quantity: 0.5, leverage: 5 })],
      }),
      stateFilePath: "/s.json",
      configPath: undefined,
      maxDrawdownPct: 0.15,
    });
    printHumanReadable(report);
    const output = consoleCapture.logged.join("\n");
    expect(output).toContain("BTC/USDC");
    expect(output).toContain("LONG");
    expect(output).toContain("qty=0.5");
    expect(output).toContain("lev=5x");
  });

  it("includes the config path when provided", () => {
    const report = buildReport({
      state: makeState(),
      stateFilePath: "/s.json",
      configPath: "/etc/live-tokyo.toml",
      maxDrawdownPct: 0.15,
    });
    printHumanReadable(report);
    expect(consoleCapture.logged.join("\n")).toContain("/etc/live-tokyo.toml");
  });
});

describe("printJson", () => {
  let consoleCapture: ReturnType<typeof captureConsole>;

  beforeEach(() => {
    consoleCapture = captureConsole();
  });
  afterEach(() => {
    consoleCapture.restore();
  });

  it("emits a single JSON object with all report fields", () => {
    const report = buildReport({
      state: makeState({ positions: [makePosition()] }),
      stateFilePath: "/s.json",
      configPath: undefined,
      maxDrawdownPct: 0.15,
    });
    printJson(report);
    const parsed = parseJsonRecord(consoleCapture.logged[0] ?? "");
    expect(parsed["stateFilePath"]).toBe("/s.json");
    expect(parsed["configPath"]).toBeUndefined();
    expect(parsed["killSwitchId"]).toBe("kill-switch-dry-run");
    expect(parsed["positions"]).toBe(1);
    expect(parsed["closures"]).toHaveLength(1);
    expect(parsed["telegramAlert"]).toContain("KILL-SWITCH TRIGGERED (DRY-RUN)");
    expect(parsed["jsonLogLines"]).toHaveLength(2);
  });
});
