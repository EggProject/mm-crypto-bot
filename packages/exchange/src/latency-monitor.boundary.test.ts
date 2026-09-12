/**
 * Architectural boundary checks for the latency-monitor module split.
 */

import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

import {
  LatencyMonitor as PublicLatencyMonitor,
  aggregateStats as publicAggregateStats,
} from "@mm-crypto-bot/exchange";
import { LatencyMonitor, aggregateStats } from "./latency-monitor.js";

describe("latency-monitor module boundaries", () => {
  it("keeps each runtime responsibility below the repository file-size limit", async () => {
    const contractSource = await readFile("packages/exchange/src/latency-monitor.contract.ts", "utf8");
    const statisticsSource = await readFile("packages/exchange/src/latency-monitor-statistics.ts", "utf8");
    const facadeSource = await readFile("packages/exchange/src/latency-monitor.ts", "utf8");
    const lineCounts = [
      contractSource.split("\n").length,
      statisticsSource.split("\n").length,
      facadeSource.split("\n").length,
    ];
    for (const lineCount of lineCounts) {
      expect(lineCount).toBeLessThanOrEqual(500);
    }
  });

  it("preserves the package-index latency-monitor exports", () => {
    expect(PublicLatencyMonitor).toBe(LatencyMonitor);
    expect(publicAggregateStats).toBe(aggregateStats);
  });
});
