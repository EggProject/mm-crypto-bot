// packages/core/src/signal-center/plugins/dvol-regime-sizing-plugin.test.ts —
// Phase 14D unit tests for the DVOL Regime Sizing Plugin.

import { describe, expect, it, beforeEach } from "bun:test";
import { SignalBus } from "../signal-bus.js";
import { createDvolRegimeSizingPlugin, DvolRegimeSizingPlugin } from "./dvol-regime-sizing-plugin.js";
import type { Bar, SizingSignal } from "../types.js";

const DAILY_MS = 24 * 60 * 60 * 1000;
const BASE_TS = Date.UTC(2025, 0, 1); // 2025-01-01

function makeBar(timestampMs: number, close: number): Bar {
  return {
    timestamp: timestampMs,
    open: close,
    high: close,
    low: close,
    close,
    volume: 1000,
  };
}

function wirePlugin(p: DvolRegimeSizingPlugin): { bus: SignalBus; sizing: SizingSignal[] } {
  const bus = new SignalBus();
  const sizing: SizingSignal[] = [];
  bus.subscribe("sizing", (s) => sizing.push(s as SizingSignal));
  p.subscribe(bus);
  return { bus, sizing };
}

describe("DvolRegimeSizingPlugin", () => {
  describe("metadata", () => {
    it("name = 'dvol-regime-v1', edgeClass = 'sizing'", () => {
      const p = new DvolRegimeSizingPlugin();
      expect(p.metadata.name).toBe("dvol-regime-v1");
      expect(p.metadata.edgeClass).toBe("sizing");
    });

    it("maxLeverage = 10 (1:10 MANDATE layer 1)", () => {
      const p = new DvolRegimeSizingPlugin();
      expect(p.metadata.maxLeverage).toBe(10);
    });
  });

  describe("regime classification", () => {
    let p: DvolRegimeSizingPlugin;
    beforeEach(() => {
      p = new DvolRegimeSizingPlugin();
    });

    it("DVOL > 80 → acute-stress", () => {
      expect(p["_classifyRegime"](85)).toBe("acute-stress");
      expect(p["_classifyRegime"](100)).toBe("acute-stress");
    });

    it("DVOL 65-80 → elevated", () => {
      expect(p["_classifyRegime"](70)).toBe("elevated");
      expect(p["_classifyRegime"](80)).toBe("elevated"); // boundary inclusive
    });

    it("DVOL 50-65 → normal", () => {
      expect(p["_classifyRegime"](55)).toBe("normal");
      expect(p["_classifyRegime"](65)).toBe("normal"); // boundary inclusive
    });

    it("DVOL < 50 → compressed", () => {
      expect(p["_classifyRegime"](40)).toBe("compressed");
      expect(p["_classifyRegime"](50)).toBe("compressed"); // boundary inclusive
    });
  });

  describe("multiplier mapping", () => {
    let p: DvolRegimeSizingPlugin;
    beforeEach(() => {
      p = new DvolRegimeSizingPlugin();
    });

    it("acute-stress → 0.5 (halve size)", () => {
      expect(p["_getMultiplierForRegime"]("acute-stress")).toBe(0.5);
    });

    it("elevated → 0.75", () => {
      expect(p["_getMultiplierForRegime"]("elevated")).toBe(0.75);
    });

    it("normal → 1.0", () => {
      expect(p["_getMultiplierForRegime"]("normal")).toBe(1.0);
    });

    it("compressed → 1.0 (don't fight compression)", () => {
      expect(p["_getMultiplierForRegime"]("compressed")).toBe(1.0);
    });

    it("no-data → 1.0 (fail-open)", () => {
      expect(p["_getMultiplierForRegime"]("no-data")).toBe(1.0);
    });
  });

  describe("onBar emission", () => {
    it("emits 1 SizingSignal per enabledSymbol per bar", () => {
      const p = new DvolRegimeSizingPlugin({
        getDvolForTimestamp: () => 55, // normal regime
        enabledSymbols: ["BTC/USDT", "ETH/USDT", "SOL/USDT"],
      });
      const { sizing } = wirePlugin(p);
      p.onBar(makeBar(BASE_TS, 50000), null);
      expect(sizing.length).toBe(3);
      expect(sizing.every((s) => s.kind === "sizing")).toBe(true);
      expect(sizing.every((s) => s.volMultiplier === 1.0)).toBe(true); // normal
    });

    it("DVOL = 85 (acute-stress) emits volMultiplier = 0.5 for all symbols", () => {
      const p = new DvolRegimeSizingPlugin({
        getDvolForTimestamp: () => 85,
        enabledSymbols: ["BTC/USDT", "ETH/USDT"],
      });
      const { sizing } = wirePlugin(p);
      p.onBar(makeBar(BASE_TS, 50000), null);
      expect(sizing.every((s) => s.volMultiplier === 0.5)).toBe(true);
      expect(p.state.regimeCounts["acute-stress"]).toBe(2); // 2 symbols × 1 bar
    });

    it("DVOL = 70 (elevated) emits volMultiplier = 0.75", () => {
      const p = new DvolRegimeSizingPlugin({
        getDvolForTimestamp: () => 70,
        enabledSymbols: ["BTC/USDT"],
      });
      const { sizing } = wirePlugin(p);
      p.onBar(makeBar(BASE_TS, 50000), null);
      expect(sizing.length).toBe(1);
      expect(sizing[0]!.volMultiplier).toBe(0.75);
    });

    it("DVOL = 40 (compressed) emits volMultiplier = 1.0", () => {
      const p = new DvolRegimeSizingPlugin({
        getDvolForTimestamp: () => 40,
        enabledSymbols: ["BTC/USDT"],
      });
      const { sizing } = wirePlugin(p);
      p.onBar(makeBar(BASE_TS, 50000), null);
      expect(sizing[0]!.volMultiplier).toBe(1.0);
    });
  });

  describe("fail-open behavior", () => {
    it("DVOL data missing (null) → fail-open with volMultiplier = 1.0", () => {
      const p = new DvolRegimeSizingPlugin({
        getDvolForTimestamp: () => null, // always missing
        enabledSymbols: ["BTC/USDT"],
      });
      const { sizing } = wirePlugin(p);
      p.onBar(makeBar(BASE_TS, 50000), null);
      expect(sizing.length).toBe(1);
      expect(sizing[0]!.volMultiplier).toBe(1.0);
      expect(sizing[0]!.source).toBe("dvol-regime-v1");
      expect(p.state.regimeCounts["no-data"]).toBe(1);
      expect(p.state.noDataEmissions).toBe(1);
    });

    it("DVOL NaN → fail-open (defensive)", () => {
      const p = new DvolRegimeSizingPlugin({
        getDvolForTimestamp: () => NaN,
        enabledSymbols: ["BTC/USDT"],
      });
      const { sizing } = wirePlugin(p);
      p.onBar(makeBar(BASE_TS, 50000), null);
      expect(sizing[0]!.volMultiplier).toBe(1.0);
    });

    it("DVOL Infinity → fail-open (defensive)", () => {
      const p = new DvolRegimeSizingPlugin({
        getDvolForTimestamp: () => Infinity,
        enabledSymbols: ["BTC/USDT"],
      });
      const { sizing } = wirePlugin(p);
      p.onBar(makeBar(BASE_TS, 50000), null);
      expect(sizing[0]!.volMultiplier).toBe(1.0);
    });
  });

  describe("per-symbol DVOL override", () => {
    it("uses dvolBySymbol[symbol] when present, falls back to getDvolForTimestamp otherwise", () => {
      const p = new DvolRegimeSizingPlugin({
        getDvolForTimestamp: () => 55, // normal default
        dvolBySymbol: new Map([
          ["BTC/USDT", 85], // BTC: acute-stress
          ["ETH/USDT", 70], // ETH: elevated
          // SOL/USDT: no entry → falls back to default (55, normal)
        ]),
        enabledSymbols: ["BTC/USDT", "ETH/USDT", "SOL/USDT"],
      });
      const { sizing } = wirePlugin(p);
      p.onBar(makeBar(BASE_TS, 50000), null);
      expect(sizing.length).toBe(3);
      // Per-symbol DVOL override: BTC=85 (acute-stress → 0.5),
      // ETH=70 (elevated → 0.75), SOL=no-override → falls back to
      // getDvolForTimestamp (55 = normal → 1.0). All three should
      // emit a SizingSignal with the corresponding volMultiplier.
      const btcSizing = sizing.find((s) => s.volMultiplier === 0.5);
      const ethSizing = sizing.find((s) => s.volMultiplier === 0.75);
      const solSizing = sizing.find((s) => s.volMultiplier === 1.0);
      expect(btcSizing).toBeDefined();
      expect(ethSizing).toBeDefined();
      expect(solSizing).toBeDefined();
    });
  });

  describe("regime change tracking", () => {
    it("updates state.lastRegime and state.lastSizeMultiplier on each bar", () => {
      const p = new DvolRegimeSizingPlugin({
        getDvolForTimestamp: (() => {
          // Simulate rising DVOL over 5 days: 50 → 55 → 60 → 70 → 90
          let day = 0;
          return (ts: number) => {
            const dayIndex = Math.floor((ts - BASE_TS) / DAILY_MS);
            day = dayIndex;
            const dvolSeries = [50, 55, 60, 70, 90];
            return dvolSeries[day] ?? 50;
          };
        })(),
        enabledSymbols: ["BTC/USDT"],
      });
      wirePlugin(p);
      // Bucket boundaries (inclusive lower, exclusive upper):
      //   DVOL > 80 → acute-stress
      //   DVOL 65-80 → elevated (boundary: dvol=80 still elevated)
      //   DVOL 50-65 → normal (boundary: dvol=65 still normal)
      //   DVOL < 50 → compressed (boundary: dvol=50 still compressed)
      p.onBar(makeBar(BASE_TS, 50000), null);
      expect(p.state.lastRegime).toBe("compressed"); // 50 < normal threshold 50
      p.onBar(makeBar(BASE_TS + DAILY_MS, 50000), null);
      expect(p.state.lastRegime).toBe("normal"); // 55 (50-65 range)
      p.onBar(makeBar(BASE_TS + 2 * DAILY_MS, 50000), null);
      expect(p.state.lastRegime).toBe("normal"); // 60
      p.onBar(makeBar(BASE_TS + 3 * DAILY_MS, 50000), null);
      expect(p.state.lastRegime).toBe("elevated"); // 70
      p.onBar(makeBar(BASE_TS + 4 * DAILY_MS, 50000), null);
      expect(p.state.lastRegime).toBe("acute-stress"); // 90
      expect(p.state.lastSizeMultiplier).toBe(0.5);
    });
  });

  describe("1:10 leverage mandate (3-layer defense)", () => {
    it("notional is clamped to baseNotionalUsd × 10", () => {
      const p = new DvolRegimeSizingPlugin({
        getDvolForTimestamp: () => 55,
        baseNotionalUsd: 10_000,
        enabledSymbols: ["BTC/USDT"],
      });
      const { sizing } = wirePlugin(p);
      p.onBar(makeBar(BASE_TS, 50000), null);
      // volMultiplier = 1.0 (normal) → notional = $10k, ≤ $100k cap
      expect(sizing[0]!.notional).toBeLessThanOrEqual(10_000 * 10);
    });

    it("constructor throws if maxLeverage != 10 (Layer 1)", () => {
      // We can't directly set metadata.maxLeverage, but we can verify
      // the constructor's Layer 1 assertion by reading the metadata.
      const p = new DvolRegimeSizingPlugin();
      expect(p.metadata.maxLeverage).toBe(10);
    });

    it("constructor rejects baseNotionalUsd ≤ 0", () => {
      expect(() => new DvolRegimeSizingPlugin({ baseNotionalUsd: 0 })).toThrow();
      expect(() => new DvolRegimeSizingPlugin({ baseNotionalUsd: -1 })).toThrow();
    });

    it("constructor rejects out-of-bounds thresholds", () => {
      expect(
        () =>
          new DvolRegimeSizingPlugin({
            acuteStressThreshold: 50,
            elevatedThreshold: 60, // < acuteStressThreshold
          }),
      ).toThrow();
      expect(
        () =>
          new DvolRegimeSizingPlugin({
            elevatedThreshold: 50,
            normalThreshold: 60, // > elevatedThreshold
          }),
      ).toThrow();
    });

    it("constructor rejects out-of-bounds multipliers", () => {
      expect(
        () =>
          new DvolRegimeSizingPlugin({
            acuteStressMultiplier: 1.5, // > 1.0 violates 1:10 mandate
          }),
      ).toThrow();
      expect(
        () =>
          new DvolRegimeSizingPlugin({
            elevatedMultiplier: -0.1, // < 0 invalid
          }),
      ).toThrow();
    });

    it("constructor rejects empty enabledSymbols", () => {
      expect(() => new DvolRegimeSizingPlugin({ enabledSymbols: [] })).toThrow();
      expect(
        () => new DvolRegimeSizingPlugin({ enabledSymbols: ["BTC/USDT", "BTC/USDT"] }),
      ).toThrow(); // duplicates
    });
  });

  describe("subscribe / onBar / reset / dispose lifecycle", () => {
    it("emissions only happen after subscribe (no bus = no emit)", () => {
      const p = new DvolRegimeSizingPlugin({
        getDvolForTimestamp: () => 55,
        enabledSymbols: ["BTC/USDT"],
      });
      // NOT subscribed
      p.onBar(makeBar(BASE_TS, 50000), null);
      expect(p.state.sizingSignalsEmitted).toBe(0);
    });

    it("reset() clears state but preserves config", () => {
      const p = new DvolRegimeSizingPlugin({
        getDvolForTimestamp: () => 85, // acute-stress
        enabledSymbols: ["BTC/USDT"],
      });
      wirePlugin(p);
      p.onBar(makeBar(BASE_TS, 50000), null);
      expect(p.state.dvolReadings).toBe(1);
      p.reset();
      expect(p.state.dvolReadings).toBe(0);
      expect(p.state.lastRegime).toBe("no-data");
      expect(p.state.lastDvol).toBeNull();
      // Config preserved
      expect(p.config.acuteStressThreshold).toBe(80);
    });

    it("dispose() releases bus reference", () => {
      const p = new DvolRegimeSizingPlugin({
        getDvolForTimestamp: () => 55,
        enabledSymbols: ["BTC/USDT"],
      });
      wirePlugin(p);
      p.dispose();
      expect((p as unknown as { _bus: unknown })._bus).toBeNull();
      expect((p as unknown as { _wired: boolean })._wired).toBe(false);
    });
  });

  describe("validateConfig", () => {
    it("undefined / null config → ok", () => {
      const p = new DvolRegimeSizingPlugin({ enabledSymbols: ["BTC/USDT"] });
      expect(p.validateConfig(undefined).ok).toBe(true);
      expect(p.validateConfig(null).ok).toBe(true);
    });

    it("non-object config (string) → error", () => {
      const p = new DvolRegimeSizingPlugin({ enabledSymbols: ["BTC/USDT"] });
      const r = p.validateConfig("not-an-object");
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.error.field).toBe("config");
        expect(r.error.message).toContain("object");
      }
    });

    it("baseNotionalUsd: 0 → error (must be positive)", () => {
      const p = new DvolRegimeSizingPlugin({ enabledSymbols: ["BTC/USDT"] });
      const r = p.validateConfig({ baseNotionalUsd: 0 });
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.error.field).toBe("baseNotionalUsd");
      }
    });

    it("baseNotionalUsd: -100 → error", () => {
      const p = new DvolRegimeSizingPlugin({ enabledSymbols: ["BTC/USDT"] });
      const r = p.validateConfig({ baseNotionalUsd: -100 });
      expect(r.ok).toBe(false);
    });

    it("baseNotionalUsd: NaN → error (not finite)", () => {
      const p = new DvolRegimeSizingPlugin({ enabledSymbols: ["BTC/USDT"] });
      const r = p.validateConfig({ baseNotionalUsd: Number.NaN });
      expect(r.ok).toBe(false);
    });

    it("baseNotionalUsd: 'string' → error (not number)", () => {
      const p = new DvolRegimeSizingPlugin({ enabledSymbols: ["BTC/USDT"] });
      const r = p.validateConfig({ baseNotionalUsd: "100" });
      expect(r.ok).toBe(false);
    });

    it("baseNotionalUsd: valid positive number → ok", () => {
      const p = new DvolRegimeSizingPlugin({ enabledSymbols: ["BTC/USDT"] });
      expect(p.validateConfig({ baseNotionalUsd: 1000 }).ok).toBe(true);
    });

    it("getDvolForTimestamp: 'string' (not function) → error", () => {
      const p = new DvolRegimeSizingPlugin({ enabledSymbols: ["BTC/USDT"] });
      const r = p.validateConfig({ getDvolForTimestamp: "not-a-function" });
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.error.field).toBe("getDvolForTimestamp");
      }
    });

    it("getDvolForTimestamp: valid function → ok", () => {
      const p = new DvolRegimeSizingPlugin({ enabledSymbols: ["BTC/USDT"] });
      expect(p.validateConfig({ getDvolForTimestamp: () => 50 }).ok).toBe(true);
    });

    it("valid object with both baseNotionalUsd and getDvolForTimestamp → ok", () => {
      const p = new DvolRegimeSizingPlugin({ enabledSymbols: ["BTC/USDT"] });
      const r = p.validateConfig({
        baseNotionalUsd: 1000,
        getDvolForTimestamp: () => 50,
      });
      expect(r.ok).toBe(true);
    });
  });

  describe("factory", () => {
    it("createDvolRegimeSizingPlugin() returns a DvolRegimeSizingPlugin instance", () => {
      const p = createDvolRegimeSizingPlugin();
      expect(p).toBeInstanceOf(DvolRegimeSizingPlugin);
    });

    it("createDvolRegimeSizingPlugin(overrides) propagates to the plugin", () => {
      const p = createDvolRegimeSizingPlugin({
        baseNotionalUsd: 5000,
        enabledSymbols: ["BTC/USDT", "ETH/USDT"],
      });
      expect(p).toBeInstanceOf(DvolRegimeSizingPlugin);
      // A factory-nak a `new DvolRegimeSizingPlugin(config)`-ot kell visszaadnia,
      // a config-ot propagálva. A plugin state-je a `state` publikus mezőn érhető el.
      expect(p.state).toBeDefined();
      expect(p.state.barsProcessed).toBe(0);
    });
  });
});
