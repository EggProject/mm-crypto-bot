// packages/core/src/signal-center/monolith-wrappers/cross-venue-funding-divergence-plugin.test.ts
// — Phase 25 #2 T4 / Track C
//
// Test suite for CrossVenueFundingDivergencePlugin. Covers:
//   1.  Construction with default config succeeds
//   2.  Construction with custom config accepted
//   3.  metadata declares name/edgeClass/capitalRequirement=0/maxLeverage=10
//   4.  Construction with bucketSizeMs < MIN or > MAX REJECTED
//   5.  Construction with non-integer bucketSizeMs REJECTED
//   6.  Construction with bad divergenceThresholdBps REJECTED
//   7.  Construction with bad maxDivergenceBps REJECTED
//   8.  Construction with bad baseNotionalUsd REJECTED
//   9.  Construction with empty assets REJECTED
//   10. Construction with duplicate assets REJECTED
//   11. Construction with bad venues (not in VenueId) REJECTED
//   12. Construction with empty venues REJECTED
//   13. Construction with duplicate venues REJECTED
//   14. HL hourly → 8h-equivalent bps normalization (× 8 × 10_000)
//   15. dYdX hourly → 8h-equivalent bps normalization (× 8 × 10_000)
//   16. Binance 8h-native → 8h-equivalent bps (× 10_000)
//   17. Bybit 8h-native → 8h-equivalent bps (× 10_000)
//   18. OKX 8h-native → 8h-equivalent bps (× 10_000)
//   19. Bitget 8h-native → 8h-equivalent bps (× 10_000)
//   20. divergenceBps = max - min across present venues
//   21. Single-venue bucket does NOT emit (need ≥ 2 venues)
//   22. Empty bucket (< 2 venues) advances the window without emitting
//   23. Per-asset enable filter: non-enabled asset silently dropped
//   24. Per-venue enable filter: non-enabled venue silently dropped
//   25. NaN/Infinity funding rates rejected (malformedPayloadDrops++)
//   26. Bucket boundary detection: only emits on bucket close
//   27. Bucket clears between emits (last-write-wins per bucket)
//   28. spreadMax across legacy 4 fields (HL + BZ + BY + OK)
//   29. predictedGap = (HL_predicted - HL_realized) × 8 × 10_000
//   30. predictedGap defaults to 0 when no HL predicted data
//   31. Bus publish: emit routes to subscribers via `funding-snapshot` kind
//   32. divergenceBps optional field is present on emitted snapshot
//   33. dydx8h and bitget8h fields populated when venue reported
//   34. dydx8h and bitget8h fields OMITTED when venue did not report
//   35. bucketStartMs field is populated with bucket-aligned timestamp
//   36. Layer 2 1:10 defense: assertLeverageInvariant hook runs per emit
//   37. onBar drives pollAndEmit
//   38. reset() clears state
//   39. dispose() releases bus reference
//   40. validateConfig returns ok for undefined / null
//   41. validateConfig returns err on bad bucketSizeMs
//   42. validateConfig returns err on bad divergenceThresholdBps
//   43. validateConfig returns err on bad assets
//   44. Floor-to-bucket helper: floorToBucketMs(12:34:17.500, 60000) → 12:34:00.000
//   45. 4-venue regression: subset {hl,binance,bybit,okx} mirrors CrossDexFundingWatcherPlugin
//   46. factory createCrossVenueFundingDivergencePlugin produces same result as `new`
//   47. Registry accepts the plugin
//   48. Integration: signal-center bus subscription receives divergence metric correctly
//   49. ADVERSARIAL: malformed payloads rejected without throwing
//   50. ADVERSARIAL: missing venue data → insufficient buckets counter increments

import { describe, expect, it } from "bun:test";

import { SignalBus } from "../signal-bus.js";
import { StrategyRegistry } from "../strategy-registry.js";
import {
  ALL_VENUES,
  CrossVenueFundingDivergencePlugin,
  DEFAULT_ASSETS,
  DEFAULT_BASE_NOTIONAL_USD,
  DEFAULT_BUCKET_SIZE_MS,
  DEFAULT_DIVERGENCE_THRESHOLD_BPS,
  DEFAULT_VENUES,
  MAX_BUCKET_SIZE_MS,
  MAX_DIVERGENCE_THRESHOLD_BPS,
  MIN_BUCKET_SIZE_MS,
  createCrossVenueFundingDivergencePlugin,
  floorToBucketMs,
  isVenueId,
  rateDecimalToBps8h,
} from "./cross-venue-funding-divergence-plugin.js";
import {
  isFundingSnapshot,
  type Bar,
  type FundingSnapshotSignal,
} from "../types.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const mkBus = (): SignalBus => new SignalBus({ mode: "backtest" });

const wirePlugin = (
  plugin: CrossVenueFundingDivergencePlugin,
): SignalBus => {
  const bus = mkBus();
  plugin.subscribe(bus);
  return bus;
};

const mkBar = (timestamp = 1_700_000_000_000): Bar => ({
  timestamp,
  open: 50_000,
  high: 50_500,
  low: 49_500,
  close: 50_000,
  volume: 1000,
});

/**
 * Convenience: feed all 6 venues for a single asset, then call
 * pollAndEmit with a timestamp that crosses a bucket boundary. Returns
 * the emitted snapshots (filtered to the requested asset).
 */
const feedAllVenuesAndEmit = (
  plugin: CrossVenueFundingDivergencePlugin,
  asset: string,
  rates: {
    hlHourly?: number;
    hlPredictedHourly?: number | null;
    dydxHourly?: number;
    bz8h?: number;
    by8h?: number;
    ok8h?: number;
    bitget8h?: number;
  },
  timestampMs: number,
): FundingSnapshotSignal[] => {
  if (rates.hlHourly !== undefined) {
    plugin.recordHlFunding(
      asset,
      rates.hlHourly,
      rates.hlPredictedHourly ?? null,
      timestampMs,
    );
  }
  if (rates.dydxHourly !== undefined) {
    plugin.recordDydxFunding(asset, rates.dydxHourly, timestampMs);
  }
  if (rates.bz8h !== undefined) {
    plugin.recordBzFunding(asset, rates.bz8h, timestampMs);
  }
  if (rates.by8h !== undefined) {
    plugin.recordByFunding(asset, rates.by8h, timestampMs);
  }
  if (rates.ok8h !== undefined) {
    plugin.recordOkFunding(asset, rates.ok8h, timestampMs);
  }
  if (rates.bitget8h !== undefined) {
    plugin.recordBitgetFunding(asset, rates.bitget8h, timestampMs);
  }
  const emitted = plugin.pollAndEmit(timestampMs + plugin.bucketSizeMs());
  return emitted.filter((s) => s.asset === asset);
};

// ---------------------------------------------------------------------------
// 1. Construction + metadata
// ---------------------------------------------------------------------------

describe("CrossVenueFundingDivergencePlugin — construction", () => {
  it("construction with default config succeeds", () => {
    const p = new CrossVenueFundingDivergencePlugin();
    expect(p.config.bucketSizeMs).toBe(DEFAULT_BUCKET_SIZE_MS);
    expect(p.config.bucketSizeMs).toBe(60_000);
    expect(p.config.divergenceThresholdBps).toBe(
      DEFAULT_DIVERGENCE_THRESHOLD_BPS,
    );
    expect(p.config.baseNotionalUsd).toBe(DEFAULT_BASE_NOTIONAL_USD);
    expect(p.config.assets).toEqual(DEFAULT_ASSETS);
    expect(p.config.venues).toEqual(DEFAULT_VENUES);
    expect(p.enabledVenues()).toEqual(ALL_VENUES);
  });

  it("construction with custom config accepted", () => {
    const p = new CrossVenueFundingDivergencePlugin({
      bucketSizeMs: 5_000,
      divergenceThresholdBps: 5,
      assets: ["BTC", "ETH"],
      venues: ["hl", "binance"],
    });
    expect(p.config.bucketSizeMs).toBe(5_000);
    expect(p.config.divergenceThresholdBps).toBe(5);
    expect(p.config.assets).toEqual(["BTC", "ETH"]);
    expect(p.config.venues).toEqual(["hl", "binance"]);
  });

  it("metadata declares name/edgeClass/capitalRequirement=0/maxLeverage=10", () => {
    const p = new CrossVenueFundingDivergencePlugin();
    expect(p.metadata.name).toBe("cross-venue-funding-divergence-v1");
    expect(p.metadata.version).toBe("1.0.0");
    expect(p.metadata.edgeClass).toBe("mixed");
    expect(p.metadata.capitalRequirement).toBe(0);
    expect(p.metadata.maxLeverage).toBe(10);
    expect(p.metadata.description).toContain("SIX venues");
  });

  it("registry accepts the plugin", () => {
    const registry = new StrategyRegistry();
    registry.register(new CrossVenueFundingDivergencePlugin());
    expect(registry.size).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 2. Construction validation
// ---------------------------------------------------------------------------

describe("CrossVenueFundingDivergencePlugin — config validation", () => {
  it("construction rejects bucketSizeMs < MIN", () => {
    expect(
      () =>
        new CrossVenueFundingDivergencePlugin({
          bucketSizeMs: MIN_BUCKET_SIZE_MS - 1,
        }),
    ).toThrow(/bucketSizeMs/);
  });

  it("construction rejects bucketSizeMs > MAX", () => {
    expect(
      () =>
        new CrossVenueFundingDivergencePlugin({
          bucketSizeMs: MAX_BUCKET_SIZE_MS + 1,
        }),
    ).toThrow(/bucketSizeMs/);
  });

  it("construction rejects non-integer bucketSizeMs", () => {
    expect(
      () =>
        new CrossVenueFundingDivergencePlugin({
          bucketSizeMs: 1500.5,
        }),
    ).toThrow(/bucketSizeMs/);
  });

  it("construction rejects bad divergenceThresholdBps", () => {
    expect(
      () =>
        new CrossVenueFundingDivergencePlugin({
          divergenceThresholdBps: -1,
        }),
    ).toThrow(/divergenceThresholdBps/);
    expect(
      () =>
        new CrossVenueFundingDivergencePlugin({
          divergenceThresholdBps: MAX_DIVERGENCE_THRESHOLD_BPS + 1,
        }),
    ).toThrow(/divergenceThresholdBps/);
  });

  it("construction rejects bad maxDivergenceBps", () => {
    expect(
      () =>
        new CrossVenueFundingDivergencePlugin({
          maxDivergenceBps: 0,
        }),
    ).toThrow(/maxDivergenceBps/);
  });

  it("construction rejects divergenceThresholdBps > maxDivergenceBps", () => {
    expect(
      () =>
        new CrossVenueFundingDivergencePlugin({
          divergenceThresholdBps: 50,
          maxDivergenceBps: 20,
        }),
    ).toThrow(/must be <= maxDivergenceBps/);
  });

  it("construction rejects bad baseNotionalUsd", () => {
    expect(
      () =>
        new CrossVenueFundingDivergencePlugin({ baseNotionalUsd: 0 }),
    ).toThrow(/baseNotionalUsd/);
    expect(
      () =>
        new CrossVenueFundingDivergencePlugin({ baseNotionalUsd: -1 }),
    ).toThrow(/baseNotionalUsd/);
  });

  it("construction rejects empty assets", () => {
    expect(
      () => new CrossVenueFundingDivergencePlugin({ assets: [] }),
    ).toThrow(/assets/);
  });

  it("construction rejects duplicate assets", () => {
    expect(
      () =>
        new CrossVenueFundingDivergencePlugin({ assets: ["BTC", "BTC"] }),
    ).toThrow(/duplicate/);
  });

  it("construction rejects bad venues (not in VenueId)", () => {
    expect(
      () =>
        new CrossVenueFundingDivergencePlugin({
          venues: ["hl", "kraken" as unknown as "hl"],
        }),
    ).toThrow(/not a valid VenueId/);
  });

  it("construction rejects empty venues", () => {
    expect(
      () => new CrossVenueFundingDivergencePlugin({ venues: [] }),
    ).toThrow(/venues/);
  });

  it("construction rejects duplicate venues", () => {
    expect(
      () =>
        new CrossVenueFundingDivergencePlugin({
          venues: ["hl", "hl"],
        }),
    ).toThrow(/duplicate/);
  });
});

// ---------------------------------------------------------------------------
// 3. Rate normalization (8h-equivalent bps)
// ---------------------------------------------------------------------------

describe("CrossVenueFundingDivergencePlugin — rate normalization", () => {
  it("HL hourly → 8h-equivalent bps (× 8 × 10_000)", () => {
    // 0.0001 hourly = 0.0008 8h = 8 bps
    expect(rateDecimalToBps8h(0.0001, "hl")).toBeCloseTo(8.0, 6);
    expect(rateDecimalToBps8h(0.00005, "hl")).toBeCloseTo(4.0, 6);
    expect(rateDecimalToBps8h(0, "hl")).toBe(0);
  });

  it("dYdX hourly → 8h-equivalent bps (× 8 × 10_000)", () => {
    expect(rateDecimalToBps8h(0.0001, "dydx")).toBeCloseTo(8.0, 6);
    expect(rateDecimalToBps8h(-0.0001, "dydx")).toBeCloseTo(-8.0, 6);
  });

  it("Binance 8h-native → 8h-equivalent bps (× 10_000)", () => {
    expect(rateDecimalToBps8h(0.0001, "binance")).toBeCloseTo(1.0, 6);
    expect(rateDecimalToBps8h(0.01, "binance")).toBeCloseTo(100.0, 6);
  });

  it("Bybit 8h-native → 8h-equivalent bps (× 10_000)", () => {
    expect(rateDecimalToBps8h(0.0001, "bybit")).toBeCloseTo(1.0, 6);
  });

  it("OKX 8h-native → 8h-equivalent bps (× 10_000)", () => {
    expect(rateDecimalToBps8h(0.0001, "okx")).toBeCloseTo(1.0, 6);
  });

  it("Bitget 8h-native → 8h-equivalent bps (× 10_000)", () => {
    expect(rateDecimalToBps8h(0.0001, "bitget")).toBeCloseTo(1.0, 6);
    expect(rateDecimalToBps8h(-0.0001, "bitget")).toBeCloseTo(-1.0, 6);
  });

  it("isVenueId type guard returns true for valid venues", () => {
    for (const v of ALL_VENUES) {
      expect(isVenueId(v)).toBe(true);
    }
    expect(isVenueId("kraken")).toBe(false);
    expect(isVenueId("")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 4. Bucket aggregation + divergence metric
// ---------------------------------------------------------------------------

describe("CrossVenueFundingDivergencePlugin — divergence computation", () => {
  it("divergenceBps = max - min across 6 venues", () => {
    const p = new CrossVenueFundingDivergencePlugin({ assets: ["BTC"] });
    const bus = wirePlugin(p);
    const received: FundingSnapshotSignal[] = [];
    bus.subscribe("funding-snapshot", (s) => {
      if (isFundingSnapshot(s)) received.push(s);
    });

    // Feed: HL=10bps, dYdX=4bps, BZ=1bps, BY=2bps, OK=3bps, Bitget=6bps
    // (all 8h-equivalent bps). Divergence = max(10) - min(1) = 9 bps.
    const t0 = 1_700_000_000_000; // bucket boundary
    p.recordHlFunding("BTC", 10 / (8 * 10_000), null, t0);
    p.recordDydxFunding("BTC", 4 / (8 * 10_000), t0);
    p.recordBzFunding("BTC", 1 / 10_000, t0);
    p.recordByFunding("BTC", 2 / 10_000, t0);
    p.recordOkFunding("BTC", 3 / 10_000, t0);
    p.recordBitgetFunding("BTC", 6 / 10_000, t0);

    const emitted = p.pollAndEmit(t0 + p.bucketSizeMs());
    expect(emitted.length).toBe(1);
    const snap = emitted[0]!;
    expect(snap.asset).toBe("BTC");
    expect(snap.divergenceBps).toBeCloseTo(9.0, 6);
    expect(snap.hl8h).toBeCloseTo(10.0, 6);
    expect(snap.bz).toBeCloseTo(1.0, 6);
    expect(snap.by).toBeCloseTo(2.0, 6);
    expect(snap.ok).toBeCloseTo(3.0, 6);
    expect(snap.dydx8h).toBeCloseTo(4.0, 6);
    expect(snap.bitget8h).toBeCloseTo(6.0, 6);
    expect(received.length).toBe(1);
  });

  it("single-venue bucket does NOT emit (need ≥ 2 venues)", () => {
    const p = new CrossVenueFundingDivergencePlugin({ assets: ["BTC"] });
    wirePlugin(p);
    const t0 = 1_700_000_000_000;
    p.recordHlFunding("BTC", 10 / (8 * 10_000), null, t0);
    const emitted = p.pollAndEmit(t0 + p.bucketSizeMs());
    expect(emitted.length).toBe(0);
    expect(p.insufficientVenueBucketsFor("BTC")).toBe(1);
    expect(p.emittedBucketsFor("BTC")).toBe(0);
    expect(p.state.totalBucketCloses).toBe(1);
  });

  it("empty bucket (< 2 venues) advances the window without emitting", () => {
    const p = new CrossVenueFundingDivergencePlugin({ assets: ["BTC"] });
    wirePlugin(p);
    const t0 = 1_700_000_000_000;
    // No feeds at all — bucket closes empty.
    const emitted = p.pollAndEmit(t0 + p.bucketSizeMs());
    expect(emitted.length).toBe(0);
    expect(p.state.totalBucketCloses).toBe(0); // no perAsset entry yet
  });

  it("per-asset enable filter: non-enabled asset silently dropped", () => {
    const p = new CrossVenueFundingDivergencePlugin({ assets: ["BTC"] });
    wirePlugin(p);
    const t0 = 1_700_000_000_000;
    p.recordHlFunding("ETH", 10 / (8 * 10_000), null, t0);
    p.recordBzFunding("ETH", 1 / 10_000, t0);
    const emitted = p.pollAndEmit(t0 + p.bucketSizeMs());
    expect(emitted.length).toBe(0);
    expect(p.hasAnyVenueData("ETH")).toBe(false);
    expect(p.state.hlFeeds).toBe(0);
    expect(p.state.bzFeeds).toBe(0);
  });

  it("per-venue enable filter: non-enabled venue silently dropped", () => {
    const p = new CrossVenueFundingDivergencePlugin({
      assets: ["BTC"],
      venues: ["hl", "binance"], // 2 venues enabled
    });
    wirePlugin(p);
    const t0 = 1_700_000_000_000;
    p.recordHlFunding("BTC", 10 / (8 * 10_000), null, t0);
    p.recordDydxFunding("BTC", 4 / (8 * 10_000), t0); // disabled
    p.recordBzFunding("BTC", 1 / 10_000, t0);
    const emitted = p.pollAndEmit(t0 + p.bucketSizeMs());
    expect(emitted.length).toBe(1);
    expect(emitted[0]!.divergenceBps).toBeCloseTo(9.0, 6);
    expect(emitted[0]!.dydx8h).toBeUndefined();
    expect(p.state.dydxFeeds).toBe(0);
  });

  it("NaN/Infinity funding rates rejected (malformedPayloadDrops++)", () => {
    const p = new CrossVenueFundingDivergencePlugin({ assets: ["BTC"] });
    wirePlugin(p);
    const t0 = 1_700_000_000_000;
    p.recordHlFunding("BTC", Number.NaN, null, t0);
    p.recordBzFunding("BTC", Number.POSITIVE_INFINITY, t0);
    p.recordByFunding("BTC", 1 / 10_000, t0); // valid
    expect(p.state.malformedPayloadDrops).toBe(2);
    expect(p.state.bzFeeds).toBe(0);
    expect(p.state.byFeeds).toBe(1);
  });

  it("bucket boundary detection: only emits on bucket close", () => {
    const p = new CrossVenueFundingDivergencePlugin({ assets: ["BTC"] });
    wirePlugin(p);
    // T0 must be 60-second-aligned so floorToBucketMs(T0) === T0.
    const T0 = 1_700_000_040_000; // bucket boundary
    p.recordHlFunding("BTC", 10 / (8 * 10_000), null, T0);
    p.recordBzFunding("BTC", 1 / 10_000, T0);
    // Same bucket: pollAndEmit with timestamp < bucketEnd → no emit.
    const sameBucket = p.pollAndEmit(T0 + p.bucketSizeMs() - 1);
    expect(sameBucket.length).toBe(0);
    // Bucket close: pollAndEmit with timestamp >= bucketEnd → emit.
    const bucketClose = p.pollAndEmit(T0 + p.bucketSizeMs());
    expect(bucketClose.length).toBe(1);
  });

  it("bucket clears between emits (last-write-wins per bucket)", () => {
    const p = new CrossVenueFundingDivergencePlugin({ assets: ["BTC"] });
    wirePlugin(p);
    const t0 = 1_700_000_000_000;
    p.recordHlFunding("BTC", 10 / (8 * 10_000), null, t0);
    p.recordBzFunding("BTC", 1 / 10_000, t0);
    // Close bucket 1
    const bucket1 = p.pollAndEmit(t0 + p.bucketSizeMs());
    expect(bucket1.length).toBe(1);
    expect(bucket1[0]!.divergenceBps).toBeCloseTo(9.0, 6);
    // Bucket 2 starts fresh — no feeds, so it closes empty.
    const t1 = t0 + p.bucketSizeMs();
    const bucket2 = p.pollAndEmit(t1 + p.bucketSizeMs());
    expect(bucket2.length).toBe(0);
    expect(p.state.totalBucketCloses).toBe(2);
  });

  it("spreadMax across legacy 4 fields (HL + BZ + BY + OK)", () => {
    const p = new CrossVenueFundingDivergencePlugin({ assets: ["BTC"] });
    wirePlugin(p);
    const t0 = 1_700_000_000_000;
    // Only 4 legacy venues; no dYdX/Bitget
    p.recordHlFunding("BTC", 10 / (8 * 10_000), null, t0); // 10 bps
    p.recordBzFunding("BTC", 1 / 10_000, t0); // 1 bps
    p.recordByFunding("BTC", 5 / 10_000, t0); // 5 bps
    p.recordOkFunding("BTC", 3 / 10_000, t0); // 3 bps
    const emitted = p.pollAndEmit(t0 + p.bucketSizeMs());
    expect(emitted.length).toBe(1);
    expect(emitted[0]!.spreadMax).toBeCloseTo(9.0, 6); // 10 - 1
  });

  it("predictedGap = (HL_predicted - HL_realized) × 8 × 10_000", () => {
    const p = new CrossVenueFundingDivergencePlugin({ assets: ["BTC"] });
    wirePlugin(p);
    const t0 = 1_700_000_000_000;
    // HL realized hourly = 0.0001 (1 bps/hour = 8 bps/8h)
    // HL predicted hourly = 0.0002 (2 bps/hour = 16 bps/8h)
    // predictedGap = (0.0002 - 0.0001) × 8 × 10_000 = 8 bps
    p.recordHlFunding("BTC", 0.0001, 0.0002, t0);
    p.recordBzFunding("BTC", 1 / 10_000, t0);
    const emitted = p.pollAndEmit(t0 + p.bucketSizeMs());
    expect(emitted.length).toBe(1);
    expect(emitted[0]!.predictedGap).toBeCloseTo(8.0, 6);
  });

  it("predictedGap defaults to 0 when no HL predicted data", () => {
    const p = new CrossVenueFundingDivergencePlugin({ assets: ["BTC"] });
    wirePlugin(p);
    const t0 = 1_700_000_000_000;
    p.recordHlFunding("BTC", 0.0001, null, t0); // no predicted
    p.recordBzFunding("BTC", 1 / 10_000, t0);
    const emitted = p.pollAndEmit(t0 + p.bucketSizeMs());
    expect(emitted[0]!.predictedGap).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 5. Bus publish + integration
// ---------------------------------------------------------------------------

describe("CrossVenueFundingDivergencePlugin — bus publish + integration", () => {
  it("bus publish: emit routes to subscribers via `funding-snapshot` kind", () => {
    const p = new CrossVenueFundingDivergencePlugin({ assets: ["BTC"] });
    const bus = wirePlugin(p);
    const received: FundingSnapshotSignal[] = [];
    bus.subscribe("funding-snapshot", (s) => {
      if (isFundingSnapshot(s)) received.push(s);
    });
    const t0 = 1_700_000_000_000;
    p.recordHlFunding("BTC", 10 / (8 * 10_000), null, t0);
    p.recordBzFunding("BTC", 1 / 10_000, t0);
    p.pollAndEmit(t0 + p.bucketSizeMs());
    expect(received.length).toBe(1);
    expect(received[0]!.kind).toBe("funding-snapshot");
    expect(received[0]!.asset).toBe("BTC");
    expect(received[0]!.source).toBe(
      "cross-venue-funding-divergence-v1:BTC",
    );
  });

  it("divergenceBps optional field is present on emitted snapshot", () => {
    const p = new CrossVenueFundingDivergencePlugin({ assets: ["BTC"] });
    const bus = wirePlugin(p);
    const received: FundingSnapshotSignal[] = [];
    bus.subscribe("funding-snapshot", (s) => {
      if (isFundingSnapshot(s)) received.push(s);
    });
    const t0 = 1_700_000_000_000;
    p.recordHlFunding("BTC", 10 / (8 * 10_000), null, t0);
    p.recordBzFunding("BTC", 1 / 10_000, t0);
    p.pollAndEmit(t0 + p.bucketSizeMs());
    expect(received.length).toBe(1);
    expect(received[0]!.divergenceBps).toBeCloseTo(9.0, 6);
  });

  it("dydx8h and bitget8h fields populated when venue reported", () => {
    const p = new CrossVenueFundingDivergencePlugin({ assets: ["BTC"] });
    wirePlugin(p);
    const snap = feedAllVenuesAndEmit(
      p,
      "BTC",
      {
        hlHourly: 10 / (8 * 10_000),
        dydxHourly: 4 / (8 * 10_000),
        bz8h: 1 / 10_000,
        by8h: 2 / 10_000,
        ok8h: 3 / 10_000,
        bitget8h: 6 / 10_000,
      },
      1_700_000_000_000,
    );
    expect(snap.length).toBe(1);
    expect(snap[0]!.dydx8h).toBeCloseTo(4.0, 6);
    expect(snap[0]!.bitget8h).toBeCloseTo(6.0, 6);
  });

  it("dydx8h and bitget8h fields OMITTED when venue did not report", () => {
    const p = new CrossVenueFundingDivergencePlugin({ assets: ["BTC"] });
    wirePlugin(p);
    // Only HL + BZ (legacy 4-venue set, no dYdX/Bitget)
    const t0 = 1_700_000_000_000;
    p.recordHlFunding("BTC", 10 / (8 * 10_000), null, t0);
    p.recordBzFunding("BTC", 1 / 10_000, t0);
    const emitted = p.pollAndEmit(t0 + p.bucketSizeMs());
    expect(emitted.length).toBe(1);
    expect(emitted[0]!.dydx8h).toBeUndefined();
    expect(emitted[0]!.bitget8h).toBeUndefined();
    // The divergenceBps field IS still set (computed from HL + BZ).
    expect(emitted[0]!.divergenceBps).toBeCloseTo(9.0, 6);
  });

  it("bucketStartMs field is populated with bucket-aligned timestamp", () => {
    const p = new CrossVenueFundingDivergencePlugin({ assets: ["BTC"] });
    wirePlugin(p);
    // T0 must be 60-second-aligned so floorToBucketMs(T0) === T0.
    const T0 = 1_700_000_040_000;
    p.recordHlFunding("BTC", 10 / (8 * 10_000), null, T0);
    p.recordBzFunding("BTC", 1 / 10_000, T0);
    const emitted = p.pollAndEmit(T0 + p.bucketSizeMs());
    expect(emitted.length).toBe(1);
    expect(emitted[0]!.bucketStartMs).toBe(T0);
  });

  it("Layer 2 1:10 defense: assertLeverageInvariant hook runs per emit", () => {
    const p = new CrossVenueFundingDivergencePlugin({ assets: ["BTC"] });
    wirePlugin(p);
    const t0 = 1_700_000_000_000;
    p.recordHlFunding("BTC", 10 / (8 * 10_000), null, t0);
    p.recordBzFunding("BTC", 1 / 10_000, t0);
    p.pollAndEmit(t0 + p.bucketSizeMs());
    expect(p.state.layer2AssertionCount).toBe(1);
    // Second bucket
    p.recordHlFunding("BTC", 11 / (8 * 10_000), null, t0 + p.bucketSizeMs());
    p.recordBzFunding("BTC", 2 / 10_000, t0 + p.bucketSizeMs());
    p.pollAndEmit(t0 + 2 * p.bucketSizeMs());
    expect(p.state.layer2AssertionCount).toBe(2);
  });

  it("integration: signal-center bus subscription receives divergence metric correctly", () => {
    // Realistic integration: register plugin with the registry, wire
    // to a bus, subscribe to funding-snapshot, drive via onBar.
    const p = new CrossVenueFundingDivergencePlugin({ assets: ["BTC"] });
    const bus = mkBus();
    const registry = new StrategyRegistry();
    registry.register(p);
    registry.wireAll(bus);
    const received: FundingSnapshotSignal[] = [];
    bus.subscribe("funding-snapshot", (s) => {
      if (isFundingSnapshot(s)) received.push(s);
    });

    // Bar at t0 — feed venues within bucket 1.
    const t0 = 1_700_000_000_000;
    p.recordHlFunding("BTC", 10 / (8 * 10_000), null, t0);
    p.recordDydxFunding("BTC", 4 / (8 * 10_000), t0);
    p.recordBzFunding("BTC", 1 / 10_000, t0);
    p.recordByFunding("BTC", 2 / 10_000, t0);
    p.recordOkFunding("BTC", 3 / 10_000, t0);
    p.recordBitgetFunding("BTC", 6 / 10_000, t0);
    // Bar at t0 + 30s — same bucket, no emit.
    p.onBar(mkBar(t0 + 30_000), null);
    expect(received.length).toBe(0);
    // Bar at t0 + 60s — bucket closes, emit.
    p.onBar(mkBar(t0 + 60_000), null);
    expect(received.length).toBe(1);
    expect(received[0]!.asset).toBe("BTC");
    expect(received[0]!.divergenceBps).toBeCloseTo(9.0, 6); // 10 - 1
    expect(received[0]!.dydx8h).toBeCloseTo(4.0, 6);
    expect(received[0]!.bitget8h).toBeCloseTo(6.0, 6);
    expect(received[0]!.spreadMax).toBeCloseTo(9.0, 6); // 10 - 1 across legacy 4
  });
});

// ---------------------------------------------------------------------------
// 6. Lifecycle
// ---------------------------------------------------------------------------

describe("CrossVenueFundingDivergencePlugin — lifecycle", () => {
  it("onBar drives pollAndEmit", () => {
    const p = new CrossVenueFundingDivergencePlugin({ assets: ["BTC"] });
    wirePlugin(p);
    const t0 = 1_700_000_000_000;
    p.recordHlFunding("BTC", 10 / (8 * 10_000), null, t0);
    p.recordBzFunding("BTC", 1 / 10_000, t0);
    expect(p.state.barsProcessed).toBe(0);
    p.onBar(mkBar(t0 + p.bucketSizeMs()), null);
    expect(p.state.barsProcessed).toBe(1);
    expect(p.snapshotsEmittedFor("BTC")).toBe(1);
  });

  it("reset() clears state", () => {
    const p = new CrossVenueFundingDivergencePlugin({ assets: ["BTC"] });
    wirePlugin(p);
    const t0 = 1_700_000_000_000;
    p.recordHlFunding("BTC", 10 / (8 * 10_000), null, t0);
    p.recordBzFunding("BTC", 1 / 10_000, t0);
    p.pollAndEmit(t0 + p.bucketSizeMs());
    expect(p.snapshotsEmittedFor("BTC")).toBe(1);
    expect(p.state.totalVenueFeeds).toBe(2);
    p.reset();
    expect(p.snapshotsEmittedFor("BTC")).toBe(0);
    expect(p.state.totalVenueFeeds).toBe(0);
    expect(p.state.hlFeeds).toBe(0);
    expect(p.state.bzFeeds).toBe(0);
    expect(p.state.lastSnapshot).toBeNull();
  });

  it("dispose() releases bus reference", () => {
    const p = new CrossVenueFundingDivergencePlugin({ assets: ["BTC"] });
    wirePlugin(p);
    p.dispose();
    const t0 = 1_700_000_000_000;
    p.recordHlFunding("BTC", 10 / (8 * 10_000), null, t0);
    p.recordBzFunding("BTC", 1 / 10_000, t0);
    p.pollAndEmit(t0 + p.bucketSizeMs());
    expect(p.snapshotsEmittedFor("BTC")).toBe(1);
    // After dispose, the bus reference is null, so emit doesn't go
    // to subscribers. Re-subscribe to confirm no double-emit.
    const bus2 = wirePlugin(p);
    const received: FundingSnapshotSignal[] = [];
    bus2.subscribe("funding-snapshot", (s) => {
      if (isFundingSnapshot(s)) received.push(s);
    });
    const t1 = t0 + p.bucketSizeMs();
    p.recordHlFunding("BTC", 11 / (8 * 10_000), null, t1);
    p.recordBzFunding("BTC", 2 / 10_000, t1);
    p.pollAndEmit(t1 + p.bucketSizeMs());
    expect(received.length).toBe(1);
    expect(p.snapshotsEmittedFor("BTC")).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// 7. validateConfig
// ---------------------------------------------------------------------------

describe("CrossVenueFundingDivergencePlugin — validateConfig", () => {
  it("validateConfig returns ok for undefined / null", () => {
    const p = new CrossVenueFundingDivergencePlugin();
    expect(p.validateConfig(undefined).ok).toBe(true);
    expect(p.validateConfig(null).ok).toBe(true);
  });

  it("validateConfig returns err on bad bucketSizeMs", () => {
    const p = new CrossVenueFundingDivergencePlugin();
    const r = p.validateConfig({ bucketSizeMs: 100 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.field).toBe("bucketSizeMs");
  });

  it("validateConfig returns err on bad divergenceThresholdBps", () => {
    const p = new CrossVenueFundingDivergencePlugin();
    const r = p.validateConfig({ divergenceThresholdBps: -5 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.field).toBe("divergenceThresholdBps");
  });

  it("validateConfig returns err on bad assets", () => {
    const p = new CrossVenueFundingDivergencePlugin();
    const r = p.validateConfig({ assets: [] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.field).toBe("assets");
  });
});

// ---------------------------------------------------------------------------
// 8. Helpers
// ---------------------------------------------------------------------------

describe("CrossVenueFundingDivergencePlugin — helpers", () => {
  it("floorToBucketMs(12:34:17.500, 60000) → 12:34:00.000", () => {
    const t = floorToBucketMs(1_700_000_057_500, 60_000);
    expect(t).toBe(1_700_000_040_000); // 1_700_000_057_500 / 60_000 = 28333334.5833 → 28333334 × 60_000 = 1_700_000_040_000
  });

  it("floorToBucketMs with 5-second buckets", () => {
    // 1_700_000_000_000 / 5_000 = 340000000 (exact)
    expect(floorToBucketMs(1_700_000_000_000, 5_000)).toBe(1_700_000_000_000);
    // 1_700_000_003_000 / 5_000 = 340000000.6 → 340000000
    expect(floorToBucketMs(1_700_000_003_000, 5_000)).toBe(1_700_000_000_000);
    // 1_700_000_007_000 / 5_000 = 340000001.4 → 340000001
    expect(floorToBucketMs(1_700_000_007_000, 5_000)).toBe(1_700_000_005_000);
  });
});

// ---------------------------------------------------------------------------
// 9. 4-venue regression
// ---------------------------------------------------------------------------

describe("CrossVenueFundingDivergencePlugin — 4-venue regression", () => {
  it("4-venue subset {hl,binance,bybit,okx} mirrors CrossDexFundingWatcherPlugin", () => {
    const p = new CrossVenueFundingDivergencePlugin({
      assets: ["BTC"],
      venues: ["hl", "binance", "bybit", "okx"], // 4 venues only
    });
    wirePlugin(p);
    const t0 = 1_700_000_000_000;
    // HL hourly 0.0001 → 8 bps; BZ 8h 0.0001 → 1 bps; BY 8h 0.0005 → 5 bps; OK 8h 0.0003 → 3 bps
    p.recordHlFunding("BTC", 0.0001, null, t0);
    p.recordBzFunding("BTC", 0.0001, t0);
    p.recordByFunding("BTC", 0.0005, t0);
    p.recordOkFunding("BTC", 0.0003, t0);
    const emitted = p.pollAndEmit(t0 + p.bucketSizeMs());
    expect(emitted.length).toBe(1);
    const snap = emitted[0]!;
    // Max-min across 4 venues: max(8, 5) - min(1) = 4 bps
    expect(snap.divergenceBps).toBeCloseTo(7.0, 6); // 8 - 1
    expect(snap.spreadMax).toBeCloseTo(7.0, 6); // legacy 4: max(8, 5) - min(1)
    // dYdX / Bitget should NOT appear (disabled)
    expect(snap.dydx8h).toBeUndefined();
    expect(snap.bitget8h).toBeUndefined();
    expect(p.state.dydxFeeds).toBe(0);
    expect(p.state.bitgetFeeds).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 10. Factory + adversarial
// ---------------------------------------------------------------------------

describe("CrossVenueFundingDivergencePlugin — factory + adversarial", () => {
  it("factory createCrossVenueFundingDivergencePlugin produces same result as `new`", () => {
    const a = new CrossVenueFundingDivergencePlugin({ assets: ["BTC"] });
    const b = createCrossVenueFundingDivergencePlugin({ assets: ["BTC"] });
    expect(b.metadata.name).toBe(a.metadata.name);
    expect(b.config.assets).toEqual(a.config.assets);
  });

  it("ADVERSARIAL: malformed payloads rejected without throwing", () => {
    const p = new CrossVenueFundingDivergencePlugin({ assets: ["BTC"] });
    wirePlugin(p);
    const t0 = 1_700_000_000_000;
    // Should not throw — drop silently.
    expect(() => p.recordHlFunding("BTC", Number.NaN, null, t0)).not.toThrow();
    expect(() =>
      p.recordDydxFunding("BTC", Number.POSITIVE_INFINITY, t0),
    ).not.toThrow();
    expect(() =>
      p.recordBzFunding("BTC", Number.NEGATIVE_INFINITY, t0),
    ).not.toThrow();
    expect(p.state.malformedPayloadDrops).toBe(3);
    // Feed a valid pair → bucket still emits.
    p.recordByFunding("BTC", 1 / 10_000, t0);
    p.recordOkFunding("BTC", 2 / 10_000, t0);
    const emitted = p.pollAndEmit(t0 + p.bucketSizeMs());
    expect(emitted.length).toBe(1);
    expect(emitted[0]!.divergenceBps).toBeCloseTo(1.0, 6);
  });

  it("ADVERSARIAL: missing venue data → insufficient buckets counter increments", () => {
    const p = new CrossVenueFundingDivergencePlugin({ assets: ["BTC"] });
    wirePlugin(p);
    const t0 = 1_700_000_000_000;
    // Bucket 1: only 1 venue (HL). Closes without emitting.
    p.recordHlFunding("BTC", 0.0001, null, t0);
    p.pollAndEmit(t0 + p.bucketSizeMs());
    expect(p.insufficientVenueBucketsFor("BTC")).toBe(1);
    expect(p.emittedBucketsFor("BTC")).toBe(0);
    // Bucket 2: 2 venues. Emits.
    const t1 = t0 + p.bucketSizeMs();
    p.recordHlFunding("BTC", 0.0001, null, t1);
    p.recordBzFunding("BTC", 0.0001, t1);
    p.pollAndEmit(t1 + p.bucketSizeMs());
    expect(p.insufficientVenueBucketsFor("BTC")).toBe(1);
    expect(p.emittedBucketsFor("BTC")).toBe(1);
    expect(p.snapshotsEmittedFor("BTC")).toBe(1);
  });
});