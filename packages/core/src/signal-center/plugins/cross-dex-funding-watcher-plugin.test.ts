// packages/core/src/signal-center/plugins/cross-dex-funding-watcher-plugin.test.ts —
// Phase 12 Track B.
//
// Test coverage (≥25 unit tests + ≥1 adversarial probe) for
// `CrossDexFundingWatcherPlugin`:
//
//   1.  Construction with default config succeeds
//   2.  Construction with custom config accepted
//   3.  metadata declares name/edgeClass/capitalRequirement=0/maxLeverage=10
//   4.  Construction with pollIntervalSec < 1 REJECTED
//   5.  Construction with pollIntervalSec > 300 REJECTED
//   6.  Construction with non-integer pollIntervalSec REJECTED
//   7.  Construction with bad maxSpreadBpsThreshold REJECTED
//   8.  Construction with bad maxPredictedGapBps REJECTED
//   9.  Construction with bad baseNotionalUsd REJECTED
//  10.  Construction with empty assets REJECTED
//  11.  Construction with duplicate assets REJECTED
//  12.  HL hourly → 8h-equivalent bps normalization (× 8 × 10_000)
//  13.  Binance 8h-native → 8h-equivalent bps (× 10_000)
//  14.  Bybit 8h-native → 8h-equivalent bps (× 10_000)
//  15.  OKX 8h-native → 8h-equivalent bps (× 10_000)
//  16.  spreadMax = max - min across ≥2 venues
//  17.  Single-venue data does NOT emit (need ≥2 venues)
//  18.  predictedGap = (HL_predicted - HL_realized) × 8 × 10_000
//  19.  predictedGap defaults to 0 when no HL predicted data
//  20.  Per-asset enable filter: non-enabled asset silently dropped
//  21.  Per-asset enable filter: malformed feed increments drop counter
//  22.  4 venue adapter paths — parseHlMetaAndAssetCtxs (HL meta)
//  23.  4 venue adapter paths — parseHlPredictedFundings (HL predicted)
//  24.  4 venue adapter paths — parseBzMarkPrice (Binance)
//  25.  4 venue adapter paths — parseByTicker (Bybit)
//  26.  4 venue adapter paths — parseOkFundingRate (OKX)
//  27.  Symbol-mapping helpers: toBinanceSymbol / toBybitSymbol / toOkxSymbol
//  28.  Bus publish: emit routes to subscribers via `funding-snapshot` kind
//  29.  onBar calls pollAndEmit
//  30.  reset() clears state
//  31.  dispose() releases bus reference
//  32.  validateConfig: undefined is ok, non-object rejected, bad pollIntervalSec rejected
//  33.  Per-asset spread: BTC vs ETH emits independently
//  34.  Determinism: same input sequence → same output snapshot
//  35.  Clock-skew tolerance: out-of-order timestamps are accepted (lastUpdateMs wins)
//  36.  ADVERSARIAL: malformed payloads rejected without throwing
//  37.  ADVERSARIAL: NaN/Infinity funding rates rejected
//  38.  ADVERSARIAL: missing venue data → empty poll counter increments
//  39.  WS reconnect handling: clearing per-asset state and re-feeding produces fresh snapshots
//  40.  Layer 2 1:10 defense: assertLeverageInvariant hook runs per emit
//  41.  factory createCrossDexFundingWatcherPlugin produces same result as `new`
//  42.  hasAnyVenueData accessor
//  43.  snapshotsEmittedFor accessor

import { describe, expect, it } from "bun:test";

import { SignalBus } from "../signal-bus.js";
import {
  CrossDexFundingWatcherPlugin,
  DEFAULT_ASSETS,
  DEFAULT_BASE_NOTIONAL_USD,
  DEFAULT_MAX_PREDICTED_GAP_BPS,
  DEFAULT_MAX_SPREAD_BPS_THRESHOLD,
  DEFAULT_POLL_INTERVAL_SEC,
  createCrossDexFundingWatcherPlugin,
  parseBzMarkPrice,
  parseBzMarkPriceBatch,
  parseByTicker,
  parseByTickerBatch,
  parseHlMetaAndAssetCtxs,
  parseHlPredictedFundings,
  parseOkFundingRate,
  parseOkFundingRateBatch,
  toBinanceSymbol,
  toBybitSymbol,
  toOkxSymbol,
} from "./cross-dex-funding-watcher-plugin.js";
import { isFundingSnapshot, type Bar, type FundingSnapshotSignal } from "../types.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const mkBus = (): SignalBus => new SignalBus({ mode: "backtest" });

const wirePlugin = (plugin: CrossDexFundingWatcherPlugin): SignalBus => {
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
 * Convenience: drive the plugin with synthetic funding rates for all 4 venues
 * for a single asset, then emit via pollAndEmit. Returns the emitted
 * snapshots (filtered to the requested asset).
 */
const feedAndEmit = (
  plugin: CrossDexFundingWatcherPlugin,
  asset: string,
  rates: {
    hlHourly?: number;
    hlPredictedHourly?: number;
    bz8h?: number;
    by8h?: number;
    ok8h?: number;
  },
  timestampMs?: number,
): FundingSnapshotSignal[] => {
  if (rates.hlHourly !== undefined) {
    plugin.recordHlFunding(asset, rates.hlHourly, rates.hlPredictedHourly ?? null, timestampMs);
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
  return plugin.pollAndEmit(timestampMs ?? Date.now()).filter((s) => s.asset === asset);
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("CrossDexFundingWatcherPlugin", () => {
  // -----------------------------------------------------------------------
  // Construction
  // -----------------------------------------------------------------------

  it("construction with default config succeeds", () => {
    const p = new CrossDexFundingWatcherPlugin();
    expect(p.config.assets).toEqual(DEFAULT_ASSETS);
    expect(p.config.pollIntervalSec).toBe(DEFAULT_POLL_INTERVAL_SEC);
    expect(p.config.maxSpreadBpsThreshold).toBe(DEFAULT_MAX_SPREAD_BPS_THRESHOLD);
    expect(p.config.maxPredictedGapBps).toBe(DEFAULT_MAX_PREDICTED_GAP_BPS);
    expect(p.config.baseNotionalUsd).toBe(DEFAULT_BASE_NOTIONAL_USD);
    expect(p.state.totalSnapshotsEmitted).toBe(0);
    expect(p.state.perAsset.size).toBe(0);
  });

  it("construction with custom config accepted", () => {
    const p = new CrossDexFundingWatcherPlugin({
      assets: ["BTC", "ETH"],
      pollIntervalSec: 10,
      maxSpreadBpsThreshold: 25,
      maxPredictedGapBps: 100,
      baseNotionalUsd: 25_000,
    });
    expect(p.config.assets).toEqual(["BTC", "ETH"]);
    expect(p.config.pollIntervalSec).toBe(10);
    expect(p.config.maxSpreadBpsThreshold).toBe(25);
    expect(p.config.maxPredictedGapBps).toBe(100);
    expect(p.config.baseNotionalUsd).toBe(25_000);
  });

  it("metadata declares name/edgeClass/capitalRequirement=0/maxLeverage=10", () => {
    const p = new CrossDexFundingWatcherPlugin();
    expect(p.metadata.name).toBe("cross-dex-funding-watcher-v1");
    expect(p.metadata.version).toBe("1.0.0");
    expect(p.metadata.edgeClass).toBe("mixed");
    expect(p.metadata.capitalRequirement).toBe(0);
    expect(p.metadata.maxLeverage).toBe(10);
    expect(p.metadata.dependencies).toEqual([]);
  });

  it("construction with pollIntervalSec < 1 REJECTED", () => {
    expect(() => new CrossDexFundingWatcherPlugin({ pollIntervalSec: 0 })).toThrow(/pollIntervalSec/);
    expect(() => new CrossDexFundingWatcherPlugin({ pollIntervalSec: -5 })).toThrow(/pollIntervalSec/);
  });

  it("construction with pollIntervalSec > 300 REJECTED", () => {
    expect(() => new CrossDexFundingWatcherPlugin({ pollIntervalSec: 301 })).toThrow(/pollIntervalSec/);
    expect(() => new CrossDexFundingWatcherPlugin({ pollIntervalSec: 9999 })).toThrow(/pollIntervalSec/);
  });

  it("construction with non-integer pollIntervalSec REJECTED", () => {
    expect(() => new CrossDexFundingWatcherPlugin({ pollIntervalSec: 2.5 })).toThrow(/pollIntervalSec/);
  });

  it("construction with bad maxSpreadBpsThreshold REJECTED", () => {
    expect(() => new CrossDexFundingWatcherPlugin({ maxSpreadBpsThreshold: 0 })).toThrow(/maxSpreadBpsThreshold/);
    expect(() => new CrossDexFundingWatcherPlugin({ maxSpreadBpsThreshold: -1 })).toThrow(/maxSpreadBpsThreshold/);
    expect(() => new CrossDexFundingWatcherPlugin({ maxSpreadBpsThreshold: 9999 })).toThrow(/maxSpreadBpsThreshold/);
  });

  it("construction with bad maxPredictedGapBps REJECTED", () => {
    expect(() => new CrossDexFundingWatcherPlugin({ maxPredictedGapBps: 0 })).toThrow(/maxPredictedGapBps/);
    expect(() => new CrossDexFundingWatcherPlugin({ maxPredictedGapBps: 9999 })).toThrow(/maxPredictedGapBps/);
  });

  it("construction with bad baseNotionalUsd REJECTED", () => {
    expect(() => new CrossDexFundingWatcherPlugin({ baseNotionalUsd: 0 })).toThrow(/baseNotionalUsd/);
    expect(() => new CrossDexFundingWatcherPlugin({ baseNotionalUsd: -1 })).toThrow(/baseNotionalUsd/);
    expect(() => new CrossDexFundingWatcherPlugin({ baseNotionalUsd: Number.NaN })).toThrow(/baseNotionalUsd/);
  });

  it("construction with empty assets REJECTED", () => {
    expect(() => new CrossDexFundingWatcherPlugin({ assets: [] })).toThrow(/assets/);
  });

  it("construction with duplicate assets REJECTED", () => {
    expect(() => new CrossDexFundingWatcherPlugin({ assets: ["BTC", "BTC"] })).toThrow(/duplicate/);
  });

  // -----------------------------------------------------------------------
  // bps normalization
  // -----------------------------------------------------------------------

  it("HL hourly → 8h-equivalent bps normalization (× 8 × 10_000)", () => {
    const p = new CrossDexFundingWatcherPlugin({ assets: ["BTC"] });
    // HL hourly 0.0001 → 0.0008 8h → 8 bps/8h
    const emitted = feedAndEmit(p, "BTC", {
      hlHourly: 0.0001,
      bz8h: 0.0001, // need a 2nd venue to emit
    });
    expect(emitted).toHaveLength(1);
    expect(emitted[0]!.hl8h).toBeCloseTo(8, 6); // 8 bps/8h
  });

  it("Binance 8h-native → 8h-equivalent bps (× 10_000)", () => {
    const p = new CrossDexFundingWatcherPlugin({ assets: ["ETH"] });
    const emitted = feedAndEmit(p, "ETH", {
      bz8h: 0.0001,
      by8h: 0.0002, // 2nd venue
    });
    expect(emitted[0]!.bz).toBeCloseTo(1, 6); // 1 bps/8h
    expect(emitted[0]!.by).toBeCloseTo(2, 6); // 2 bps/8h
  });

  it("Bybit 8h-native → 8h-equivalent bps (× 10_000)", () => {
    const p = new CrossDexFundingWatcherPlugin({ assets: ["SOL"] });
    const emitted = feedAndEmit(p, "SOL", {
      by8h: 0.0005,
      ok8h: 0.0001, // 2nd venue
    });
    expect(emitted[0]!.by).toBeCloseTo(5, 6);
    expect(emitted[0]!.ok).toBeCloseTo(1, 6);
  });

  it("OKX 8h-native → 8h-equivalent bps (× 10_000)", () => {
    const p = new CrossDexFundingWatcherPlugin({ assets: ["HYPE"] });
    const emitted = feedAndEmit(p, "HYPE", {
      ok8h: 0.001,
      bz8h: 0.0001, // 2nd venue
    });
    expect(emitted[0]!.ok).toBeCloseTo(10, 6); // 10 bps/8h
    expect(emitted[0]!.bz).toBeCloseTo(1, 6);
  });

  // -----------------------------------------------------------------------
  // spreadMax computation
  // -----------------------------------------------------------------------

  it("spreadMax = max - min across ≥2 venues", () => {
    const p = new CrossDexFundingWatcherPlugin({ assets: ["BTC"] });
    // HL: 0.0001 hourly → 8 bps/8h
    // BZ: 0.0002 → 2 bps/8h
    // BY: 0.0003 → 3 bps/8h
    // OK: 0.0005 → 5 bps/8h
    // Max=8, Min=2, spread=6
    const emitted = feedAndEmit(p, "BTC", {
      hlHourly: 0.0001,
      bz8h: 0.0002,
      by8h: 0.0003,
      ok8h: 0.0005,
    });
    expect(emitted[0]!.spreadMax).toBeCloseTo(6, 6);
  });

  it("single-venue data does NOT emit (need ≥2 venues)", () => {
    const p = new CrossDexFundingWatcherPlugin({ assets: ["BTC"] });
    feedAndEmit(p, "BTC", { bz8h: 0.0001 }); // only 1 venue
    expect(p.state.totalSnapshotsEmitted).toBe(0);
    expect(p.state.emptyPolls).toBe(0); // at least 1 venue had data
  });

  // -----------------------------------------------------------------------
  // predictedGap computation
  // -----------------------------------------------------------------------

  it("predictedGap = (HL_predicted - HL_realized) × 8 × 10_000", () => {
    const p = new CrossDexFundingWatcherPlugin({ assets: ["BTC"] });
    // realized HL hourly: 0.0001 (8 bps/8h)
    // predicted HL hourly: 0.00015 (12 bps/8h)
    // gap = 4 bps/8h
    const emitted = feedAndEmit(p, "BTC", {
      hlHourly: 0.0001,
      hlPredictedHourly: 0.00015,
      bz8h: 0.0001, // 2nd venue to emit
    });
    expect(emitted[0]!.predictedGap).toBeCloseTo(4, 6);
  });

  it("predictedGap defaults to 0 when no HL predicted data", () => {
    const p = new CrossDexFundingWatcherPlugin({ assets: ["BTC"] });
    const emitted = feedAndEmit(p, "BTC", {
      hlHourly: 0.0001, // no predicted
      bz8h: 0.0001,
    });
    expect(emitted[0]!.predictedGap).toBe(0);
  });

  // -----------------------------------------------------------------------
  // Per-asset enable filter
  // -----------------------------------------------------------------------

  it("per-asset enable filter: non-enabled asset silently dropped", () => {
    const p = new CrossDexFundingWatcherPlugin({ assets: ["BTC"] });
    p.recordBzFunding("XYZ_NOT_ENABLED", 0.0001);
    expect(p.state.totalVenueFeeds).toBe(0);
    expect(p.state.bzFeeds).toBe(0);
  });

  it("per-asset enable filter: malformed feed increments drop counter", () => {
    const p = new CrossDexFundingWatcherPlugin({ assets: ["BTC"] });
    p.recordBzFunding("BTC", Number.NaN);
    expect(p.state.malformedPayloadDrops).toBe(1);
    expect(p.state.bzFeeds).toBe(0);
  });

  // -----------------------------------------------------------------------
  // 4 venue adapter paths
  // -----------------------------------------------------------------------

  it("parseHlMetaAndAssetCtxs: extracts per-asset hourly funding", () => {
    const payload = [
      { universe: [] }, // meta (index 0, unused)
      [
        { coin: "BTC", funding: 0.0001 },
        { coin: "ETH", funding: 0.0002 },
        { coin: "BAD", funding: "not-a-number" }, // malformed
        { funding: 0.0001 }, // missing coin
      ],
    ];
    const out = parseHlMetaAndAssetCtxs(payload);
    expect(out.size).toBe(2);
    expect(out.get("BTC")?.funding).toBe(0.0001);
    expect(out.get("ETH")?.funding).toBe(0.0002);
  });

  it("parseHlPredictedFundings: extracts per-asset per-venue predicted", () => {
    const payload = [
      ["BTC", [["HlPerp", { fundingRate: 0.00015, nextFundingTime: 1234, fundingIntervalHours: 1 }]]],
      ["ETH", [["HlPerp", { fundingRate: 0.0002 }]]],
    ];
    const out = parseHlPredictedFundings(payload);
    expect(out.size).toBe(2);
    expect(out.get("BTC:HlPerp")?.fundingRate).toBe(0.00015);
    expect(out.get("ETH:HlPerp")?.fundingRate).toBe(0.0002);
  });

  it("parseBzMarkPrice: extracts single Binance entry", () => {
    const payload = { e: "markPriceUpdate", s: "BTCUSDT", r: 0.0001 };
    const out = parseBzMarkPrice(payload);
    expect(out).not.toBeNull();
    expect(out!.symbol).toBe("BTCUSDT");
    expect(out!.fundingRate).toBe(0.0001);
  });

  it("parseBzMarkPriceBatch: extracts multiple Binance entries, skipping malformed", () => {
    const payloads = [
      { e: "markPriceUpdate", s: "BTCUSDT", r: 0.0001 },
      { e: "markPriceUpdate", s: "ETHUSDT" }, // missing r
      { e: "markPriceUpdate", s: "SOLUSDT", r: "0.0001" }, // r not number
      { e: "markPriceUpdate", s: "", r: 0.0001 }, // empty symbol
      { e: "markPriceUpdate", s: "JUPUSDT", r: 0.0002 },
    ];
    const out = parseBzMarkPriceBatch(payloads);
    expect(out).toHaveLength(2);
    expect(out.map((e) => e.symbol)).toEqual(["BTCUSDT", "JUPUSDT"]);
  });

  it("parseByTicker: extracts single Bybit entry", () => {
    const payload = {
      topic: "tickers.BTCUSDT",
      data: { symbol: "BTCUSDT", fundingRate: 0.0003 },
    };
    const out = parseByTicker(payload);
    expect(out).not.toBeNull();
    expect(out!.symbol).toBe("BTCUSDT");
    expect(out!.fundingRate).toBe(0.0003);
  });

  it("parseByTickerBatch: rejects non-tickers topics and malformed entries", () => {
    const payloads = [
      { topic: "tickers.ETHUSDT", data: { symbol: "ETHUSDT", fundingRate: 0.0002 } },
      { topic: "orderbook.ETHUSDT", data: { symbol: "ETHUSDT", fundingRate: 0.0002 } }, // wrong topic
      { topic: "tickers.SOLUSDT", data: { fundingRate: 0.0001 } }, // missing symbol
      { topic: "tickers.DOGEUSDT", data: { symbol: "DOGEUSDT", fundingRate: "0.0001" } }, // bad funding
    ];
    const out = parseByTickerBatch(payloads);
    expect(out).toHaveLength(1);
    expect(out[0]!.symbol).toBe("ETHUSDT");
  });

  it("parseOkFundingRate: extracts single OKX entry", () => {
    const payload = {
      arg: { channel: "funding-rate", instId: "BTC-USDT-SWAP" },
      data: [{ fundingRate: 0.0004 }],
    };
    const out = parseOkFundingRate(payload);
    expect(out).not.toBeNull();
    expect(out!.instId).toBe("BTC-USDT-SWAP");
    expect(out!.fundingRate).toBe(0.0004);
  });

  it("parseOkFundingRateBatch: extracts multiple OKX entries, rejecting wrong channel", () => {
    const payloads = [
      {
        arg: { channel: "funding-rate", instId: "BTC-USDT-SWAP" },
        data: [{ fundingRate: 0.0004 }],
      },
      {
        arg: { channel: "tickers", instId: "ETH-USDT-SWAP" }, // wrong channel
        data: [{ fundingRate: 0.0002 }],
      },
      {
        arg: { channel: "funding-rate", instId: "" }, // empty instId
        data: [{ fundingRate: 0.0001 }],
      },
    ];
    const out = parseOkFundingRateBatch(payloads);
    expect(out).toHaveLength(1);
    expect(out[0]!.instId).toBe("BTC-USDT-SWAP");
  });

  // -----------------------------------------------------------------------
  // Symbol-mapping helpers
  // -----------------------------------------------------------------------

  it("symbol-mapping helpers produce canonical venue symbols", () => {
    expect(toBinanceSymbol("BTC")).toBe("BTCUSDT");
    expect(toBybitSymbol("ETH")).toBe("ETHUSDT");
    expect(toOkxSymbol("SOL")).toBe("SOL-USDT-SWAP");
  });

  // -----------------------------------------------------------------------
  // Bus publish
  // -----------------------------------------------------------------------

  it("bus publish: emit routes to subscribers via `funding-snapshot` kind", () => {
    const p = new CrossDexFundingWatcherPlugin({ assets: ["BTC"] });
    const bus = wirePlugin(p);
    const received: FundingSnapshotSignal[] = [];
    bus.subscribe("funding-snapshot", (s) => {
      if (isFundingSnapshot(s)) received.push(s);
    });
    feedAndEmit(p, "BTC", { hlHourly: 0.0001, bz8h: 0.0002 });
    expect(received).toHaveLength(1);
    expect(received[0]!.asset).toBe("BTC");
    expect(received[0]!.kind).toBe("funding-snapshot");
    expect(received[0]!.source).toContain("cross-dex-funding-watcher-v1");
  });

  // -----------------------------------------------------------------------
  // onBar / reset / dispose / validateConfig
  // -----------------------------------------------------------------------

  it("onBar calls pollAndEmit", () => {
    const p = new CrossDexFundingWatcherPlugin({ assets: ["BTC"] });
    feedAndEmit(p, "BTC", { hlHourly: 0.0001, bz8h: 0.0001 }); // state primed
    const before = p.state.barsProcessed;
    p.onBar(mkBar(), null);
    expect(p.state.barsProcessed).toBe(before + 1);
  });

  it("reset() clears all state", () => {
    const p = new CrossDexFundingWatcherPlugin({ assets: ["BTC"] });
    feedAndEmit(p, "BTC", { hlHourly: 0.0001, bz8h: 0.0001 });
    expect(p.state.totalSnapshotsEmitted).toBeGreaterThan(0);
    p.reset();
    expect(p.state.totalSnapshotsEmitted).toBe(0);
    expect(p.state.totalVenueFeeds).toBe(0);
    expect(p.state.barsProcessed).toBe(0);
    expect(p.state.perAsset.size).toBe(0);
  });

  it("dispose() releases bus reference (no throw)", () => {
    const p = new CrossDexFundingWatcherPlugin({ assets: ["BTC"] });
    wirePlugin(p);
    p.dispose();
    // After dispose, feeding + emitting should still work — but no bus
    // emission happens (the bus ref is null). Just verify no throw.
    expect(() => feedAndEmit(p, "BTC", { hlHourly: 0.0001, bz8h: 0.0001 })).not.toThrow();
  });

  it("validateConfig: undefined is ok, non-object rejected, bad pollIntervalSec rejected", () => {
    const p = new CrossDexFundingWatcherPlugin();
    expect(p.validateConfig(undefined).ok).toBe(true);
    expect(p.validateConfig(null).ok).toBe(true);
    const r1 = p.validateConfig("not-an-object");
    expect(r1.ok).toBe(false);
    const r2 = p.validateConfig({ pollIntervalSec: -1 });
    expect(r2.ok).toBe(false);
    const r3 = p.validateConfig({ pollIntervalSec: 10 });
    expect(r3.ok).toBe(true);
  });

  // -----------------------------------------------------------------------
  // Per-asset dispatch + determinism
  // -----------------------------------------------------------------------

  it("per-asset dispatch: BTC vs ETH emits independently", () => {
    const p = new CrossDexFundingWatcherPlugin({ assets: ["BTC", "ETH"] });
    p.recordBzFunding("BTC", 0.0001);
    p.recordByFunding("BTC", 0.0002);
    p.recordBzFunding("ETH", 0.0003);
    p.recordByFunding("ETH", 0.0004);
    const emitted = p.pollAndEmit();
    expect(emitted).toHaveLength(2);
    const btc = emitted.find((s) => s.asset === "BTC");
    const eth = emitted.find((s) => s.asset === "ETH");
    expect(btc).toBeDefined();
    expect(eth).toBeDefined();
    expect(btc!.spreadMax).toBeCloseTo(1, 6); // 2 - 1 bps
    expect(eth!.spreadMax).toBeCloseTo(1, 6); // 4 - 3 bps
  });

  it("determinism: same input sequence → same output snapshot", () => {
    const p1 = new CrossDexFundingWatcherPlugin({ assets: ["BTC"] });
    const p2 = new CrossDexFundingWatcherPlugin({ assets: ["BTC"] });
    const ts = 1_700_000_000_000;
    feedAndEmit(p1, "BTC", { hlHourly: 0.0001, bz8h: 0.0002 }, ts);
    feedAndEmit(p2, "BTC", { hlHourly: 0.0001, bz8h: 0.0002 }, ts);
    const s1 = p1.state.lastSnapshot;
    const s2 = p2.state.lastSnapshot;
    expect(s1).not.toBeNull();
    expect(s2).not.toBeNull();
    expect(s1!.hl8h).toBe(s2!.hl8h);
    expect(s1!.bz).toBe(s2!.bz);
    expect(s1!.spreadMax).toBe(s2!.spreadMax);
    expect(s1!.timestamp).toBe(s2!.timestamp);
  });

  it("clock-skew tolerance: out-of-order timestamps accepted (lastUpdateMs wins)", () => {
    const p = new CrossDexFundingWatcherPlugin({ assets: ["BTC"] });
    p.recordBzFunding("BTC", 0.0001, 2_000);
    p.recordByFunding("BTC", 0.0002, 1_000); // earlier ts — accepted (we don't enforce ordering)
    expect(p.hasAnyVenueData("BTC")).toBe(true);
    const ss = p.state.perAsset.get("BTC")!;
    // lastUpdateMs reflects the most-recent call (Bybit feed)
    expect(ss.lastUpdateMs).toBe(1_000);
    expect(ss.bz8h).toBe(0.0001);
    expect(ss.by8h).toBe(0.0002);
  });

  // -----------------------------------------------------------------------
  // ADVERSARIAL probes (≥1 required per brief — providing 4 for thoroughness)
  // -----------------------------------------------------------------------

  it("ADVERSARIAL: malformed payloads rejected without throwing", () => {
    const p = new CrossDexFundingWatcherPlugin({ assets: ["BTC"] });
    expect(() => {
      p.recordBzFunding("BTC", Number.NaN);
      p.recordByFunding("BTC", Number.POSITIVE_INFINITY);
      p.recordOkFunding("BTC", Number.NEGATIVE_INFINITY);
      p.recordHlFunding("BTC", Number.NaN);
    }).not.toThrow();
    expect(p.state.malformedPayloadDrops).toBeGreaterThanOrEqual(4);
    // State should be empty for BTC since all feeds were rejected.
    expect(p.state.perAsset.get("BTC")).toBeUndefined();
  });

  it("ADVERSARIAL: NaN/Infinity funding rates rejected at the parse layer", () => {
    expect(parseHlMetaAndAssetCtxs([[{}, [{ coin: "BTC", funding: Number.NaN }]]]).size).toBe(0);
    expect(
      parseBzMarkPrice({ e: "markPriceUpdate", s: "BTCUSDT", r: Number.POSITIVE_INFINITY }),
    ).toBeNull();
    expect(
      parseByTicker({ topic: "tickers.BTCUSDT", data: { symbol: "BTCUSDT", fundingRate: Number.NaN } }),
    ).toBeNull();
    expect(
      parseOkFundingRate({
        arg: { channel: "funding-rate", instId: "BTC-USDT-SWAP" },
        data: [{ fundingRate: Number.NEGATIVE_INFINITY }],
      }),
    ).toBeNull();
  });

  it("ADVERSARIAL: missing venue data → empty poll counter increments", () => {
    const p = new CrossDexFundingWatcherPlugin({ assets: ["BTC"] });
    const before = p.state.emptyPolls;
    p.pollAndEmit(); // no data at all
    expect(p.state.emptyPolls).toBe(before + 1);
  });

  it("ADVERSARIAL: WS reconnect handling — clear per-asset state and re-feed produces fresh snapshots", () => {
    const p = new CrossDexFundingWatcherPlugin({ assets: ["BTC"] });
    feedAndEmit(p, "BTC", { hlHourly: 0.0001, bz8h: 0.0001 });
    expect(p.snapshotsEmittedFor("BTC")).toBe(1);
    // Simulate WS disconnect/reconnect: clear state via the per-asset accessor
    p.state.perAsset.clear();
    expect(p.hasAnyVenueData("BTC")).toBe(false);
    // Re-feed and re-emit
    feedAndEmit(p, "BTC", { hlHourly: 0.0002, bz8h: 0.0003 });
    expect(p.snapshotsEmittedFor("BTC")).toBe(1); // counter reset by clear()
    const last = p.lastSnapshotFor("BTC")!;
    expect(last.hl8h).toBeCloseTo(16, 6); // 0.0002 × 8 × 10_000 = 16 bps/8h
  });

  // -----------------------------------------------------------------------
  // Layer 2 1:10 defense
  // -----------------------------------------------------------------------

  it("Layer 2 1:10 defense: assertLeverageInvariant hook runs per emit", () => {
    const p = new CrossDexFundingWatcherPlugin({ assets: ["BTC"] });
    feedAndEmit(p, "BTC", { hlHourly: 0.0001, bz8h: 0.0001 });
    feedAndEmit(p, "BTC", { hlHourly: 0.0001, bz8h: 0.0001 });
    expect(p.state.layer2AssertionCount).toBe(2);
  });

  // -----------------------------------------------------------------------
  // Factory + accessors
  // -----------------------------------------------------------------------

  it("factory createCrossDexFundingWatcherPlugin produces same result as `new`", () => {
    const p1 = createCrossDexFundingWatcherPlugin({ pollIntervalSec: 7 });
    const p2 = new CrossDexFundingWatcherPlugin({ pollIntervalSec: 7 });
    expect(p1.config.pollIntervalSec).toBe(p2.config.pollIntervalSec);
    expect(p1.metadata.name).toBe(p2.metadata.name);
  });

  it("hasAnyVenueData accessor", () => {
    const p = new CrossDexFundingWatcherPlugin({ assets: ["BTC"] });
    expect(p.hasAnyVenueData("BTC")).toBe(false);
    p.recordBzFunding("BTC", 0.0001);
    expect(p.hasAnyVenueData("BTC")).toBe(true);
  });

  it("snapshotsEmittedFor accessor", () => {
    const p = new CrossDexFundingWatcherPlugin({ assets: ["BTC"] });
    expect(p.snapshotsEmittedFor("BTC")).toBe(0);
    feedAndEmit(p, "BTC", { hlHourly: 0.0001, bz8h: 0.0001 });
    expect(p.snapshotsEmittedFor("BTC")).toBe(1);
  });

  it("isAssetEnabled + enabledAssets accessors", () => {
    const p = new CrossDexFundingWatcherPlugin({ assets: ["BTC", "ETH"] });
    expect(p.isAssetEnabled("BTC")).toBe(true);
    expect(p.isAssetEnabled("ETH")).toBe(true);
    expect(p.isAssetEnabled("SOL")).toBe(false);
    expect(p.enabledAssets()).toEqual(["BTC", "ETH"]);
  });
});
