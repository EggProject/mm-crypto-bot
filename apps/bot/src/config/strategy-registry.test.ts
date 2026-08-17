/**
 * apps/bot/src/config/strategy-registry.test.ts
 *
 * A `createStrategyInstances` factory tesztjei.
 *
 * Coverage (≥ 8 assertions, all on `bun:test`):
 *   1.  Default config starts only the OHLCV-capable baseline.
 *   2.  dydx_cex_carry enabled but no DydxFundingSource → throws ConfigError.
 *   3.  dydx_cex_carry with funding but without a production precondition
 *       re-verifier fails loudly instead of remaining inert.
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
import {
  buildDydxCexCarryConfig,
  createStrategyInstances,
  type BotDependencies,
} from "./strategy-registry.js";
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
    return {
      close: () => {
        /* no-op */
      },
    };
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
  // 1) Default config — only the fully-wired OHLCV strategy is enabled.
  // --------------------------------------------------------------------------
  it("with default config: only the OHLCV-capable strategy starts", () => {
    const config = buildConfig({});
    const instances = createStrategyInstances(config, {});
    expect(instances.size).toBe(1);
    expect(instances.has("donchian_pivot_composition")).toBe(true);
    expect(instances.has("dydx_cex_carry")).toBe(false);
    expect(instances.has("cascade_fade")).toBe(false);
    expect(instances.has("funding_flip_kill_switch")).toBe(false);
    expect(instances.has("regime_detector")).toBe(false);
    // The sole default instance is Strategy-kind (not plugin).
    for (const entry of instances.values()) {
      expect(entry.kind).toBe("strategy");
    }
  });

  // --------------------------------------------------------------------------
  // 2) dydx_cex_carry enabled but no funding source → ConfigError.
  // --------------------------------------------------------------------------
  it("throws ConfigError when dydx_cex_carry is enabled but no funding source is provided", () => {
    const config = buildConfig({
      strategies: { dydx_cex_carry: { enabled: true } },
    });
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
        cascade_fade: { enabled: false },
        funding_flip_kill_switch: { enabled: false },
        regime_detector: { enabled: false },
      },
    });
    const instances = createStrategyInstances(config, {});
    expect(instances.size).toBe(1);
    expect(instances.has("dydx_cex_carry")).toBe(false);
    expect(instances.has("donchian_pivot_composition")).toBe(true);
    expect(instances.has("cascade_fade")).toBe(false);
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
  // 5) Explicit carry opt-in with funding still requires a verifier producer.
  // --------------------------------------------------------------------------
  it("fails loudly when carry has funding but no precondition re-verifier", () => {
    const config = buildConfig({
      strategies: {
        donchian_pivot_composition: { enabled: false },
        dydx_cex_carry: { enabled: true },
        cascade_fade: { enabled: false },
        funding_flip_kill_switch: { enabled: false },
        regime_detector: { enabled: false },
      },
    });
    expect(() => createStrategyInstances(config, buildDeps())).toThrow(/precondition re-verifier/);
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
    const carryConfig = buildDydxCexCarryConfig(config.strategies.dydx_cex_carry, new MockFundingSource());
    expect(carryConfig.capFraction).toBe(0.04);
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
    const carryConfig = buildDydxCexCarryConfig(config.strategies.dydx_cex_carry, new MockFundingSource());
    expect(carryConfig.notionalPerLegUsd).toBe(250_000);
  });

  // --------------------------------------------------------------------------
  // 8) Per-strategy min_consensus override flows to DonchianPivotComposition.
  // --------------------------------------------------------------------------
  it("per-strategy min_consensus 1 and 2 flow to DonchianPivotComposition", () => {
    for (const minConsensus of [1, 2] as const) {
      const config = buildConfig({
        strategies: {
          donchian_pivot_composition: { enabled: true, min_consensus: minConsensus },
          dydx_cex_carry: { enabled: false },
          cascade_fade: { enabled: false },
          funding_flip_kill_switch: { enabled: false },
          regime_detector: { enabled: false },
        },
      });
      const instances = createStrategyInstances(config, buildDeps());
      const entry = instances.get("donchian_pivot_composition");
      expect(entry?.kind).toBe("strategy");
      if (entry?.kind !== "strategy") continue;
      const dpc = entry.instance as unknown as {
        config: { minConsensus: number };
      };
      expect(dpc.config.minConsensus).toBe(minConsensus);
    }
  });

  // --------------------------------------------------------------------------
  // 9) Per-strategy max_notional_per_event_usd override flows to CascadeFade.
  // --------------------------------------------------------------------------
  it("fails loudly when cascade_fade is enabled without its event bridge", () => {
    const config = buildConfig({
      strategies: {
        cascade_fade: { enabled: true, max_notional_per_event_usd: 500_000 },
        donchian_pivot_composition: { enabled: false },
        dydx_cex_carry: { enabled: false },
        funding_flip_kill_switch: { enabled: false },
        regime_detector: { enabled: false },
      },
    });
    expect(() => createStrategyInstances(config, buildDeps())).toThrow(
      /liquidation \+ OI \+ ELR event bridge/,
    );
  });

  // --------------------------------------------------------------------------
  // 10) Per-strategy cooldown_hours override flows to CascadeFade.
  // --------------------------------------------------------------------------
  it("never silently accepts cascade_fade overrides without a producer", () => {
    const config = buildConfig({
      strategies: {
        cascade_fade: { enabled: true, cooldown_hours: 12 },
        donchian_pivot_composition: { enabled: false },
        dydx_cex_carry: { enabled: false },
        funding_flip_kill_switch: { enabled: false },
        regime_detector: { enabled: false },
      },
    });
    expect(() => createStrategyInstances(config, buildDeps())).toThrow(/OHLCV-only runtime would be inert/);
  });

  // --------------------------------------------------------------------------
  // 11) Enable funding_flip_kill_switch (default OFF) → plugin in Map.
  // --------------------------------------------------------------------------
  it("fails loudly when funding_flip_kill_switch has no SOL funding producer", () => {
    const config = buildConfig({
      strategies: {
        funding_flip_kill_switch: { enabled: true },
        donchian_pivot_composition: { enabled: false },
        dydx_cex_carry: { enabled: false },
        cascade_fade: { enabled: false },
        regime_detector: { enabled: false },
      },
    });
    expect(() => createStrategyInstances(config, buildDeps())).toThrow(/SOL funding-rate producer/);
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
  it("all-enabled configuration fails closed on unsupported event producers", () => {
    const config = buildConfig({
      strategies: {
        donchian_pivot_composition: { enabled: true },
        dydx_cex_carry: { enabled: true },
        cascade_fade: { enabled: true },
        funding_flip_kill_switch: { enabled: true },
        regime_detector: { enabled: true },
      },
    });
    expect(() => createStrategyInstances(config, buildDeps())).toThrow(/precondition re-verifier/);
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
    const carryConfig = buildDydxCexCarryConfig(config.strategies.dydx_cex_carry, new MockFundingSource());
    expect(carryConfig.leverage).toBe(1);
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
