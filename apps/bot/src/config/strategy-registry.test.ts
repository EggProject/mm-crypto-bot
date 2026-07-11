/**
 * apps/bot/src/config/strategy-registry.test.ts
 *
 * A `createStrategyInstances` factory tesztjei.
 *
 * Coverage (≥ 8 assertions, all on `bun:test`):
 *   1.  With default config (all 3 production strategies ON), returns
 *       3 Strategy instances (dydx_cex_carry needs deps; if not provided,
 *       throws ConfigError — covered separately in test #2).
 *   2.  dydx_cex_carry enabled but no DydxFundingSource → throws ConfigError.
 *   3.  With funding source provided, all 3 production strategies
 *       are returned as Map entries with `kind: "strategy"`.
 *   4.  All strategies disabled → empty Map.
 *   5.  Disabling donchian_pivot_composition only → 2 instances (no dpc).
 *   6.  Per-strategy `cap` override flows to DydxCexCarryConfig.capFraction
 *       (configurable, but capped at 0.5 per DydxCexCarryConfig invariant).
 *   7.  Per-strategy `notional_per_leg_usd` override flows to
 *       DydxCexCarryConfig.notionalPerLegUsd.
 *   8.  Per-strategy `min_consensus` override flows to
 *       DonchianPivotComposition (verifiable via the .name field).
 *   9.  Per-strategy `max_notional_per_event_usd` override flows to
 *       CascadeFadeStrategy detector.
 *  10.  Enable funding_flip_kill_switch (default OFF) → plugin in Map.
 *  11.  Enable regime_detector (default OFF) → plugin in Map.
 *  12.  Default config: funding_flip_kill_switch and regime_detector NOT
 *       in Map (opt-in default).
 *  13.  With all 5 enabled + funding source → 5 instances, mix of
 *       "strategy" and "plugin" kinds.
 */

import { describe, expect, it } from "bun:test";

import { BotConfigSchema } from "./schema.js";
import type { BotConfig } from "./schema.js";
import { createStrategyInstances, type BotDependencies } from "./strategy-registry.js";
import type { DydxFundingSource, CarryMarket } from "@mm-crypto-bot/core";
import type { FundingSnapshot } from "@mm-crypto-bot/core";

// ============================================================================
// Test fixtures
// ============================================================================

const FIXED_NOW = Date.UTC(2026, 6, 1, 0, 0, 0); // 2026-07-01T00:00:00Z

/**
 * `MockFundingSource` — minimal DydxFundingSource for tests.  Returns
 * a controllable "fresh" snapshot (no stale) so that the dydx_cex_carry
 * constructor accepts the configuration and the strategy can be
 * instantiated.  The strategy does not call the source during
 * construction, so we just need an object that implements the interface.
 */
class MockFundingSource implements DydxFundingSource {
  subscribe(
    _market: CarryMarket,
    _onTick: (snap: { readonly dydx: FundingSnapshot; readonly cex: FundingSnapshot }) => void,
  ): { readonly close: () => void } {
    return { close: () => { /* no-op */ } };
  }
  lastTickAgeMs(_market: CarryMarket, nowMs: number): number | null {
    // Return a fresh age — strategy's `lastTickMs` is set on the first
    // recordFundingTick call, but the constructor doesn't query this.
    return nowMs - FIXED_NOW;
  }
  lastChainBlockHeight(_market: CarryMarket): number | null {
    return 1_000_000;
  }
  lastChainBlockTs(_market: CarryMarket): number | null {
    return FIXED_NOW;
  }
  bybitEuSpotDepthUsd(_market: CarryMarket, _nowMs: number): number | null {
    return 200_000;
  }
  health(): { readonly lastTickMs: number | null; readonly chainBlockHeight: number | null } {
    return { lastTickMs: FIXED_NOW, chainBlockHeight: 1_000_000 };
  }
}

/** Helper — build a `BotConfig` from a partial override. */
function buildConfig(overrides: Partial<BotConfig> = {}): BotConfig {
  return BotConfigSchema.parse(overrides);
}

/** Helper — build `BotDependencies` with a mock funding source. */
function buildDeps(): BotDependencies {
  return { dydxFundingSource: new MockFundingSource() };
}

// ============================================================================
// Test suite
// ============================================================================

describe("createStrategyInstances", () => {
  // --------------------------------------------------------------------------
  // 1) Default config — 3 production strategies ON, 2 defensive OFF.
  // --------------------------------------------------------------------------
  it("with default config + funding source: 3 Strategy instances (2 plugins OFF)", () => {
    const config = buildConfig({});
    const instances = createStrategyInstances(config, buildDeps());
    // Default: dpc + dydx + cascade ON; ffk + regime OFF.
    expect(instances.size).toBe(3);
    expect(instances.has("donchian_pivot_composition")).toBe(true);
    expect(instances.has("dydx_cex_carry")).toBe(true);
    expect(instances.has("cascade_fade")).toBe(true);
    expect(instances.has("funding_flip_kill_switch")).toBe(false);
    expect(instances.has("regime_detector")).toBe(false);
    // All 3 are Strategy-kind (not plugin).
    for (const entry of instances.values()) {
      expect(entry.kind).toBe("strategy");
    }
  });

  // --------------------------------------------------------------------------
  // 2) dydx_cex_carry enabled but no funding source → ConfigError.
  // --------------------------------------------------------------------------
  it("throws ConfigError when dydx_cex_carry is enabled but no funding source is provided", () => {
    const config = buildConfig({});
    // dydx_cex_carry default is enabled → factory MUST throw.
    expect(() => createStrategyInstances(config, {})).toThrow(/dydx_cex_carry/);
  });

  // --------------------------------------------------------------------------
  // 3) Disabling dydx_cex_carry removes it (no funding source needed).
  // --------------------------------------------------------------------------
  it("works without funding source when dydx_cex_carry is disabled", () => {
    const config = buildConfig({
      strategies: {
        dydx_cex_carry: { enabled: false },
        donchian_pivot_composition: { enabled: true },
        cascade_fade: { enabled: true },
        funding_flip_kill_switch: { enabled: false },
        regime_detector: { enabled: false },
      },
    });
    const instances = createStrategyInstances(config, {});
    expect(instances.size).toBe(2);
    expect(instances.has("dydx_cex_carry")).toBe(false);
    expect(instances.has("donchian_pivot_composition")).toBe(true);
    expect(instances.has("cascade_fade")).toBe(true);
  });

  // --------------------------------------------------------------------------
  // 4) All strategies disabled → empty Map.
  // --------------------------------------------------------------------------
  it("with all strategies disabled: returns an empty Map", () => {
    const config = buildConfig({
      strategies: {
        dydx_cex_carry: { enabled: false },
        donchian_pivot_composition: { enabled: false },
        cascade_fade: { enabled: false },
        funding_flip_kill_switch: { enabled: false },
        regime_detector: { enabled: false },
      },
    });
    const instances = createStrategyInstances(config, buildDeps());
    expect(instances.size).toBe(0);
  });

  // --------------------------------------------------------------------------
  // 5) Disabling only donchian_pivot_composition → 2 strategy instances.
  // --------------------------------------------------------------------------
  it("disabling only donchian_pivot_composition: 2 strategy instances remain", () => {
    const config = buildConfig({
      strategies: {
        donchian_pivot_composition: { enabled: false },
        dydx_cex_carry: { enabled: true },
        cascade_fade: { enabled: true },
        funding_flip_kill_switch: { enabled: false },
        regime_detector: { enabled: false },
      },
    });
    const instances = createStrategyInstances(config, buildDeps());
    expect(instances.size).toBe(2);
    expect(instances.has("donchian_pivot_composition")).toBe(false);
    expect(instances.has("dydx_cex_carry")).toBe(true);
    expect(instances.has("cascade_fade")).toBe(true);
  });

  // --------------------------------------------------------------------------
  // 6) Per-strategy cap override flows to DydxCexCarryConfig.capFraction.
  // --------------------------------------------------------------------------
  it("per-strategy cap override flows to DydxCexCarryConfig.capFraction", () => {
    const config = buildConfig({
      strategies: {
        dydx_cex_carry: { enabled: true, cap: 0.04 },
        donchian_pivot_composition: { enabled: false },
        cascade_fade: { enabled: false },
        funding_flip_kill_switch: { enabled: false },
        regime_detector: { enabled: false },
      },
    });
    const instances = createStrategyInstances(config, buildDeps());
    const entry = instances.get("dydx_cex_carry");
    expect(entry).toBeDefined();
    if (entry?.kind !== "strategy") {
      throw new Error("Expected strategy-kind instance for dydx_cex_carry");
    }
    const strategy = entry.instance;
    // The DydxCexCarryStrategy exposes its config as `config.capFraction`.
    // We need to cast to access the public `config` field.
    const capFraction = (strategy as unknown as { config: { capFraction: number } }).config
      .capFraction;
    expect(capFraction).toBe(0.04);
  });

  // --------------------------------------------------------------------------
  // 7) Per-strategy notional_per_leg_usd override flows to DydxCexCarryConfig.
  // --------------------------------------------------------------------------
  it("per-strategy notional_per_leg_usd override flows to DydxCexCarryConfig", () => {
    const config = buildConfig({
      strategies: {
        dydx_cex_carry: { enabled: true, notional_per_leg_usd: 250_000 },
        donchian_pivot_composition: { enabled: false },
        cascade_fade: { enabled: false },
        funding_flip_kill_switch: { enabled: false },
        regime_detector: { enabled: false },
      },
    });
    const instances = createStrategyInstances(config, buildDeps());
    const entry = instances.get("dydx_cex_carry");
    expect(entry?.kind).toBe("strategy");
    if (entry?.kind !== "strategy") return;
    const cfg = (entry.instance as unknown as { config: { notionalPerLegUsd: number } }).config;
    expect(cfg.notionalPerLegUsd).toBe(250_000);
  });

  // --------------------------------------------------------------------------
  // 8) Per-strategy min_consensus override flows to DonchianPivotComposition.
  // --------------------------------------------------------------------------
  it("per-strategy min_consensus override flows to DonchianPivotComposition", () => {
    const config = buildConfig({
      strategies: {
        donchian_pivot_composition: { enabled: true, min_consensus: 1 },
        dydx_cex_carry: { enabled: false },
        cascade_fade: { enabled: false },
        funding_flip_kill_switch: { enabled: false },
        regime_detector: { enabled: false },
      },
    });
    const instances = createStrategyInstances(config, buildDeps());
    const entry = instances.get("donchian_pivot_composition");
    expect(entry?.kind).toBe("strategy");
    if (entry?.kind !== "strategy") return;
    const dpc = entry.instance as unknown as {
      config: { minConsensus: number };
    };
    expect(dpc.config.minConsensus).toBe(1);
  });

  // --------------------------------------------------------------------------
  // 9) Per-strategy max_notional_per_event_usd override flows to CascadeFade.
  // --------------------------------------------------------------------------
  it("per-strategy max_notional_per_event_usd override flows to CascadeFadeStrategy", () => {
    const config = buildConfig({
      strategies: {
        cascade_fade: { enabled: true, max_notional_per_event_usd: 500_000 },
        donchian_pivot_composition: { enabled: false },
        dydx_cex_carry: { enabled: false },
        funding_flip_kill_switch: { enabled: false },
        regime_detector: { enabled: false },
      },
    });
    const instances = createStrategyInstances(config, buildDeps());
    const entry = instances.get("cascade_fade");
    expect(entry?.kind).toBe("strategy");
    if (entry?.kind !== "strategy") return;
    // The CascadeFadeStrategy wraps a `detector` (CascadeFadeDetector).
    // The detector's config is the public field `config`.
    const detectorCfg = (
      entry.instance as unknown as {
        detector: { config: { capacityMaxPerSymbolEventUsd: number } };
      }
    ).detector.config;
    expect(detectorCfg.capacityMaxPerSymbolEventUsd).toBe(500_000);
  });

  // --------------------------------------------------------------------------
  // 10) Per-strategy cooldown_hours override flows to CascadeFade.
  // --------------------------------------------------------------------------
  it("per-strategy cooldown_hours override flows to CascadeFadeStrategy riskBtCooldownMs", () => {
    const config = buildConfig({
      strategies: {
        cascade_fade: { enabled: true, cooldown_hours: 12 },
        donchian_pivot_composition: { enabled: false },
        dydx_cex_carry: { enabled: false },
        funding_flip_kill_switch: { enabled: false },
        regime_detector: { enabled: false },
      },
    });
    const instances = createStrategyInstances(config, buildDeps());
    const entry = instances.get("cascade_fade");
    if (entry?.kind !== "strategy") {
      throw new Error("Expected strategy-kind instance for cascade_fade");
    }
    const cfg = (
      entry.instance as unknown as {
        detector: { config: { riskBtCooldownMs: number } };
      }
    ).detector.config;
    expect(cfg.riskBtCooldownMs).toBe(12 * 60 * 60 * 1000);
  });

  // --------------------------------------------------------------------------
  // 11) Enable funding_flip_kill_switch (default OFF) → plugin in Map.
  // --------------------------------------------------------------------------
  it("enabling funding_flip_kill_switch adds a plugin-kind instance", () => {
    const config = buildConfig({
      strategies: {
        funding_flip_kill_switch: { enabled: true },
        donchian_pivot_composition: { enabled: false },
        dydx_cex_carry: { enabled: false },
        cascade_fade: { enabled: false },
        regime_detector: { enabled: false },
      },
    });
    const instances = createStrategyInstances(config, buildDeps());
    expect(instances.size).toBe(1);
    const entry = instances.get("funding_flip_kill_switch");
    expect(entry?.kind).toBe("plugin");
    if (entry?.kind !== "plugin") return;
    expect(entry.instance.metadata.name).toBe("sol-flip-kill-switch");
  });

  // --------------------------------------------------------------------------
  // 12) Enable regime_detector (default OFF) → plugin in Map.
  // --------------------------------------------------------------------------
  it("enabling regime_detector adds a plugin-kind instance", () => {
    const config = buildConfig({
      strategies: {
        regime_detector: { enabled: true },
        donchian_pivot_composition: { enabled: false },
        dydx_cex_carry: { enabled: false },
        cascade_fade: { enabled: false },
        funding_flip_kill_switch: { enabled: false },
      },
    });
    const instances = createStrategyInstances(config, buildDeps());
    expect(instances.size).toBe(1);
    const entry = instances.get("regime_detector");
    expect(entry?.kind).toBe("plugin");
    if (entry?.kind !== "plugin") return;
    expect(entry.instance.metadata.name).toBe("regime-detector-v1");
  });

  // --------------------------------------------------------------------------
  // 13) With all 5 enabled + funding source → 5 instances, mix kinds.
  // --------------------------------------------------------------------------
  it("with all 5 enabled: 3 strategies + 2 plugins, distinct kinds", () => {
    const config = buildConfig({
      strategies: {
        donchian_pivot_composition: { enabled: true },
        dydx_cex_carry: { enabled: true },
        cascade_fade: { enabled: true },
        funding_flip_kill_switch: { enabled: true },
        regime_detector: { enabled: true },
      },
    });
    const instances = createStrategyInstances(config, buildDeps());
    expect(instances.size).toBe(5);
    // Verify the kind distribution.
    const kinds: Record<string, number> = { strategy: 0, plugin: 0 };
    for (const entry of instances.values()) {
      kinds[entry.kind] = (kinds[entry.kind] ?? 0) + 1;
    }
    expect(kinds.strategy).toBe(3);
    expect(kinds.plugin).toBe(2);
  });

  // --------------------------------------------------------------------------
  // 14) Per-strategy leverage override is honored (1 or 10).
  // --------------------------------------------------------------------------
  it("per-strategy leverage override flows to DydxCexCarryConfig.leverage", () => {
    const config = buildConfig({
      strategies: {
        dydx_cex_carry: { enabled: true, leverage: 1 },
        donchian_pivot_composition: { enabled: false },
        cascade_fade: { enabled: false },
        funding_flip_kill_switch: { enabled: false },
        regime_detector: { enabled: false },
      },
    });
    const instances = createStrategyInstances(config, buildDeps());
    const entry = instances.get("dydx_cex_carry");
    if (entry?.kind !== "strategy") {
      throw new Error("Expected strategy-kind instance for dydx_cex_carry");
    }
    const leverage = (
      entry.instance as unknown as { config: { leverage: 1 | 10 } }
    ).config.leverage;
    expect(leverage).toBe(1);
  });

  // --------------------------------------------------------------------------
  // 15) Wire-up integrity: disabled strategy does NOT appear in Map.
  // --------------------------------------------------------------------------
  it("disabled strategies do NOT appear in the returned Map (wire-up integrity)", () => {
    const config = buildConfig({
      strategies: {
        donchian_pivot_composition: { enabled: false },
        dydx_cex_carry: { enabled: false },
        cascade_fade: { enabled: false },
        funding_flip_kill_switch: { enabled: false },
        regime_detector: { enabled: false },
      },
    });
    const instances = createStrategyInstances(config, buildDeps());
    // Empty Map, all 5 names absent.
    for (const name of [
      "donchian_pivot_composition",
      "dydx_cex_carry",
      "cascade_fade",
      "funding_flip_kill_switch",
      "regime_detector",
    ] as const) {
      expect(instances.has(name)).toBe(false);
    }
  });
});
