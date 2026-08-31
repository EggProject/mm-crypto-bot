import { describe, expect, it } from "bun:test";
import { ExactRational } from "@mm-crypto-bot/numeric";

import { DydxCexCarryStrategy } from "./dydx-cex-carry.js";
import { FIXED_NOW, MockFundingSource, mkSnapshot, mkStrategy } from "./dydx-cex-carry.test-support.js";

describe("DydxCexCarryStrategy — snapshot boundary", () => {
  it("rejects unknown nested fields in the versioned snapshot DTO", () => {
    const source = new MockFundingSource();
    const strategy = mkStrategy(source);
    strategy.recordFundingTick(mkSnapshot(), mkSnapshot(), FIXED_NOW);
    const snapshot = strategy.serializeState();
    const restore = (candidate: unknown) => DydxCexCarryStrategy.fromSnapshot(strategy.config, candidate);
    expect(() =>
      restore({ ...snapshot, preconditions: { ...snapshot.preconditions, unexpected: true } }),
    ).toThrow(/unsupported field/);
    expect(() =>
      restore({
        ...snapshot,
        tickDensity: { ...snapshot.tickDensity, days: [{ ...snapshot.tickDensity.days[0], extra: true }] },
      }),
    ).toThrow(/unsupported field/);
    expect(() =>
      restore({
        ...snapshot,
        killSwitchVerdicts: {
          ...snapshot.killSwitchVerdicts,
          "indexer-stale": { ...snapshot.killSwitchVerdicts["indexer-stale"], extra: true },
        },
      }),
    ).toThrow(/unsupported field/);
    expect(() => restore({ ...snapshot, bybitDepth: { status: "unknown" } })).toThrow(/bybitDepth.status/);
    expect(() => restore({ ...snapshot, firstTickMs: NaN })).toThrow(/firstTickMs must be finite/);
    expect(() => restore({ ...snapshot, firstTickMs: -1 })).toThrow(/firstTickMs must be non-negative/);
    expect(() => restore({ ...snapshot, lastMarkPrice: ExactRational.from("-1").toSnapshot() })).toThrow(
      /lastMarkPrice must be non-negative/,
    );
  });
});
