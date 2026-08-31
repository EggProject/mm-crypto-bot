import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import type { LatencyMonitorConfig, LatencyMonitorResult, LatencyStats } from "@mm-crypto-bot/exchange";
import type { LogFields, Logger } from "@mm-crypto-bot/logging";
import { runArbLatencyCli, type ArbLatencyCliDependencies } from "./run-arb-latency.js";

const REPOSITORY_ROOT = path.resolve(import.meta.dir, "..", "..", "..", "..");
const REDACTION_SENTINEL = "arb-latency-redaction-sentinel-7b1c";

function isJsonRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stringsInJson(value: unknown): readonly string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap((entry) => stringsInJson(entry));
  if (value !== null && typeof value === "object")
    return Object.values(value).flatMap((entry) => stringsInJson(entry));
  return [];
}

function latencyStats(exchangeId: LatencyStats["exchangeId"]): LatencyStats {
  return {
    exchangeId,
    rttCount: 1,
    rttMinMs: 20,
    rttMaxMs: 20,
    rttMedianMs: 20,
    rttP95Ms: 20,
    rttP99Ms: 20,
    rttSuccessRate: 1,
    gapCount: 1,
    gapMinMs: 10,
    gapMaxMs: 10,
    gapMedianMs: 10,
    gapP95Ms: 10,
    gapP99Ms: 10,
    reconnectCount: 0,
    reconnectMinMs: 0,
    reconnectMaxMs: 0,
    reconnectMedianMs: 0,
    reconnectP95Ms: 0,
  };
}

function latencyMonitorResult(): LatencyMonitorResult {
  return {
    config: {
      exchangeIds: ["binance", "bybit"],
      symbol: "BTC/USDT",
      durationMs: 1000,
      rttIntervalMs: 500,
      wsMessageBudget: 1000,
      measureReconnect: true,
      forcedDisconnectAtMs: 500,
    },
    startedAt: 0,
    endedAt: 1000,
    statsByExchange: {
      binance: latencyStats("binance"),
      bybit: latencyStats("bybit"),
      kucoin: latencyStats("kucoin"),
      bybiteu: latencyStats("bybiteu"),
    },
    samples: [],
  };
}

function eventLogger(events: string[]): Logger {
  const record = (event: string, _fields?: LogFields): void => {
    events.push(event);
  };
  return { debug: record, info: record, warn: record, error: record, critical: record };
}

async function waitUntil(isConditionMet: () => Promise<boolean>, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await isConditionMet())) {
    if (Date.now() >= deadline) throw new Error("timed out waiting for test condition");
    await Bun.sleep(5);
  }
}

describe("run-arb-latency logging routing", () => {
  it("emits ordered lifecycle events and one schema-versioned stdout record on success", async () => {
    const temporaryDirectory = mkdtempSync(path.join(tmpdir(), "mm-crypto-bot-arb-latency-"));
    const outputPath = path.join(temporaryDirectory, "result.json");
    const events: string[] = [];
    const outputLines: string[] = [];
    let receivedMonitorConfig: LatencyMonitorConfig | undefined;
    const dependencies: ArbLatencyCliDependencies = {
      argv: ["--exchange-a=binance", "--exchange-b=bybit", "--duration-ms=1000", `--output=${outputPath}`],
      collectSpreadSamples: () =>
        Promise.resolve({
          samples: [],
          opportunities: [
            {
              timestamp: 1,
              exchangeA: { id: "binance", bid: 101, ask: 102 },
              exchangeB: { id: "bybit", bid: 100, ask: 101 },
              crossSpreadBps: 20,
              profitableAfterLatency: false,
              theoreticalPnlUsd: 0,
            },
            {
              timestamp: 2,
              exchangeA: { id: "binance", bid: 101, ask: 102 },
              exchangeB: { id: "bybit", bid: 100, ask: 101 },
              crossSpreadBps: 5,
              profitableAfterLatency: false,
              theoreticalPnlUsd: 0,
            },
          ],
        }),
      createLatencyMonitor: () => ({
        start: (config) => {
          receivedMonitorConfig = config;
          return Promise.resolve(latencyMonitorResult());
        },
      }),
      logger: eventLogger(events),
      output: {
        writeLine: (line) => {
          outputLines.push(line);
        },
      },
      resolveCcxtPackageVersion: () => Promise.resolve("4.5.75"),
    };

    try {
      await runArbLatencyCli(dependencies);

      expect(receivedMonitorConfig).toEqual({
        exchangeIds: ["binance", "bybit"],
        symbol: "BTC/USDT",
        durationMs: 1000,
        rttIntervalMs: 500,
        measureReconnect: true,
        forcedDisconnectAtMs: 500,
      });
      expect(events).toEqual([
        "arb.latency.backtest.started",
        "arb.latency.backtest.completed",
        "arb.latency.output.saved",
      ]);
      expect(outputLines).toHaveLength(1);
      const stdoutRecord: unknown = JSON.parse(outputLines[0] ?? "");
      expect(stdoutRecord).toEqual({ outputPath, schema: "arb-latency-cli-output@1" });
      expect(await Bun.file(outputPath).exists()).toBe(true);
      const artifact: unknown = JSON.parse(await Bun.file(outputPath).text());
      expect(isJsonRecord(artifact)).toBe(true);
      if (!isJsonRecord(artifact)) throw new Error("Expected a JSON output artifact.");
      expect(artifact["metadata"]).toMatchObject({ ccxtVersion: "4.5.75" });
    } finally {
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });

  it("emits only a sanitized structured failure record for invalid CLI input", async () => {
    const child = Bun.spawn(
      [
        "bun",
        "run",
        "packages/backtest-tools/src/cli/run-arb-latency.ts",
        `--exchange-a=${REDACTION_SENTINEL}`,
      ],
      {
        cwd: REPOSITORY_ROOT,
        stderr: "pipe",
        stdout: "pipe",
      },
    );
    const [stderr, stdout, exitCode] = await Promise.all([
      new Response(child.stderr).text(),
      new Response(child.stdout).text(),
      child.exited,
    ]);

    expect(exitCode).toBe(1);
    expect(stdout).toBe("");
    const records = stderr
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as unknown);
    expect(records).toHaveLength(1);
    const record = records[0];
    expect(isJsonRecord(record)).toBe(true);
    if (!isJsonRecord(record)) throw new Error("Expected a structured stderr record.");
    expect(Object.keys(record)).toEqual([
      "timestamp",
      "level",
      "event",
      "component",
      "correlationId",
      "runId",
      "fields",
    ]);
    expect(record["component"]).toBe("arb-latency");
    expect(record["event"]).toBe("arb.latency.backtest.failed");
    expect(record["level"]).toBe("error");
    expect(typeof record["correlationId"]).toBe("string");
    expect(typeof record["runId"]).toBe("string");
    expect(typeof record["timestamp"]).toBe("string");
    expect(isJsonRecord(record["fields"])).toBe(true);
    if (!isJsonRecord(record["fields"])) throw new Error("Expected structured failure fields.");
    expect(record["fields"]).toEqual({
      failureCategory: "configuration",
      failureCode: "INVALID_CLI_ARGUMENTS",
    });
    expect(stringsInJson(record)).not.toContain(REDACTION_SENTINEL);
  });

  it("awaits logger shutdown when failure logging throws without masking the main failure", async () => {
    const temporaryDirectory = mkdtempSync(path.join(tmpdir(), "mm-crypto-bot-arb-latency-"));
    const preloadPath = path.join(temporaryDirectory, "throwing-logger-preload.ts");
    const shutdownStartedPath = path.join(temporaryDirectory, "shutdown-started");
    const shutdownReleasePath = path.join(temporaryDirectory, "shutdown-release");
    const shutdownCompletedPath = path.join(temporaryDirectory, "shutdown-completed");
    await Bun.write(
      preloadPath,
      `import { existsSync } from "node:fs";
import { mock } from "bun:test";

const shutdownStartedPath = process.env["ARB_LATENCY_SHUTDOWN_STARTED_PATH"];
const shutdownReleasePath = process.env["ARB_LATENCY_SHUTDOWN_RELEASE_PATH"];
const shutdownCompletedPath = process.env["ARB_LATENCY_SHUTDOWN_COMPLETED_PATH"];
let shutdownCalls = 0;

if (
  shutdownStartedPath === undefined ||
  shutdownReleasePath === undefined ||
  shutdownCompletedPath === undefined
) {
  throw new Error("Missing shutdown test paths");
}

mock.module("@mm-crypto-bot/logging", () => ({
  StderrJsonSink: class {},
  StructuredLogger: class {
    public error(): never {
      throw new Error("logger error failed");
    }

    public info(): void {}

    public async shutdown(): Promise<void> {
      shutdownCalls += 1;
      await Bun.write(shutdownStartedPath, shutdownCalls.toString());
      while (!existsSync(shutdownReleasePath)) await Bun.sleep(5);
      await Bun.write(shutdownCompletedPath, "completed");
    }
  },
}));
`,
    );
    const child = Bun.spawn(
      [
        "bun",
        "--preload",
        preloadPath,
        "packages/backtest-tools/src/cli/run-arb-latency.ts",
        "--exchange-a=invalid",
      ],
      {
        cwd: REPOSITORY_ROOT,
        env: {
          ...process.env,
          ARB_LATENCY_SHUTDOWN_COMPLETED_PATH: shutdownCompletedPath,
          ARB_LATENCY_SHUTDOWN_RELEASE_PATH: shutdownReleasePath,
          ARB_LATENCY_SHUTDOWN_STARTED_PATH: shutdownStartedPath,
        },
        stderr: "pipe",
        stdout: "pipe",
      },
    );

    try {
      await waitUntil(() => Bun.file(shutdownStartedPath).exists());
      expect(await Bun.file(shutdownStartedPath).text()).toBe("1");
      expect(await Bun.file(shutdownCompletedPath).exists()).toBe(false);
      await Bun.write(shutdownReleasePath, "release");
      expect(await child.exited).toBe(1);
      expect(await Bun.file(shutdownCompletedPath).exists()).toBe(true);
    } finally {
      if (!(await Bun.file(shutdownReleasePath).exists())) await Bun.write(shutdownReleasePath, "release");
      await child.exited;
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });
});
