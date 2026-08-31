import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { ConstantLatencySource, JsonLatencySource } from "./live-latency-source.js";

describe("JsonLatencySource", () => {
  let temporaryDirectory: string;

  beforeEach(() => {
    temporaryDirectory = mkdtempSync(path.join(tmpdir(), "mm-backtest-latency-source-"));
  });

  afterEach(() => {
    rmSync(temporaryDirectory, { force: true, recursive: true });
  });

  it("returns undefined when no round-trip observation is available", () => {
    const source = new JsonLatencySource(path.join(temporaryDirectory, "unobserved.json"));

    expect(source.observeRoundTripMs(1_700_000_000_000)).toBeUndefined();
  });

  it("loads the maximum valid exchange round-trip observation", async () => {
    const sourcePath = path.join(temporaryDirectory, "observed.json");
    await Bun.write(
      sourcePath,
      JSON.stringify({
        arbLatency: { roundTripP95Ms: 145 },
        exchanges: {
          bybit: { stats: { rttMaxMs: 120 } },
          dydx: { stats: { rttMaxMs: 180 } },
        },
        metadata: { cliArgs: { exchangeA: "dydx", exchangeB: "bybit", symbol: "BTC/USDT" } },
      }),
    );

    const source = await JsonLatencySource.load(sourcePath);

    expect(source.pair).toBe("dydx-bybit-btc-");
    expect(source.p95RoundTripMs).toBe(145);
    expect(source.observeRoundTripMs(1_700_000_000_000)).toBe(180);
  });

  it("preserves absent source observations as undefined after parsing", async () => {
    const sourcePath = path.join(temporaryDirectory, "absent.json");
    await Bun.write(sourcePath, '{"exchanges":{}}');

    const source = await JsonLatencySource.load(sourcePath);

    expect(source.pair).toBe("unknown-unknown");
    expect(source.maxRoundTripMs).toBeUndefined();
    expect(source.p95RoundTripMs).toBeUndefined();
    expect(source.observeRoundTripMs(1_700_000_000_000)).toBeUndefined();
  });

  it("returns the configured constant observation", () => {
    const source = new ConstantLatencySource("dydx-bybit-btc", 120);

    expect(source.pair).toBe("dydx-bybit-btc");
    expect(source.observeRoundTripMs(1_700_000_000_000)).toBe(120);
  });
});
