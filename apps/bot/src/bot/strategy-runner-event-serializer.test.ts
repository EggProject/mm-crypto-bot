import { describe, expect, it } from "vitest";

import { asSymbol } from "@mm-crypto-bot/exchange";

import { StrategyRunnerEventSerializer } from "./strategy-runner.event-serializer.js";

describe("StrategyRunnerEventSerializer", () => {
  it("continues the same symbol queue after a rejected predecessor", async () => {
    const symbol = asSymbol("BTC/USDC");
    const serializer = new StrategyRunnerEventSerializer(new Map());
    const first = serializer.enqueue(symbol, () => Promise.reject(new Error("first event failed")));
    let successfulOperations = 0;
    const second = serializer.enqueue(symbol, () => {
      successfulOperations += 1;
      return Promise.resolve();
    });

    await expect(first).rejects.toThrow("first event failed");
    await second;
    expect(successfulOperations).toBe(1);
  });
});
