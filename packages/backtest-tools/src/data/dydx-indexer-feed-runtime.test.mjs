import { expect, it } from "bun:test";

import { DydxIndexerFeed } from "./dydx-indexer-feed.js";

it("rejects an untrusted JavaScript caller's unknown market at the public runtime boundary", () => {
  expect(() => new DydxIndexerFeed().getState("DOGE-USD")).toThrow("Unknown dYdX market");
});

it("fetchHistoricalFunding a fetch mock-ot használja", async () => {
  let calls = 0;
  const feed = new DydxIndexerFeed({
    fetchPage: () => {
      calls += 1;
      return Promise.resolve({ ok: true, status: 200, statusText: "OK", json: () => Promise.resolve({ historicalFunding: [] }) });
    },
  });
  await feed.fetchHistoricalFunding("BTC-USD");
  expect(calls).toBe(1);
});
