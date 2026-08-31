import { createTestBotConfig } from "../../../src/config/config-test-fixtures.test-support.js";
import { BotConfigSchema } from "../../../src/config/schema.js";
import { buildDydxCexCarryConfig, createStrategyInstances } from "../../../src/config/strategy-registry.js";
import * as support from "../../../src/bot/strategy-runner.test-support.js";
import { ExactRational } from "@mm-crypto-bot/numeric";

import { assertCondition, expectFailure } from "./runtime-driver-core.js";

function allDisabledConfig() {
  return createTestBotConfig({
    strategies: {
      donchian_pivot_composition: { enabled: false },
      dydx_cex_carry: { enabled: false },
      cascade_fade: { enabled: false },
      funding_flip_kill_switch: { enabled: false },
      regime_detector: { enabled: false },
    },
  });
}

export function runStrategyRegistryBoundaries(): void {
  const defaultInstances = createStrategyInstances(createTestBotConfig());
  assertCondition(defaultInstances.size === 1, "default registry must include exactly the OHLCV strategy");
  assertCondition(
    defaultInstances.get("donchian_pivot_composition")?.kind === "strategy",
    "default strategy kind changed",
  );

  const noStrategies = createStrategyInstances(allDisabledConfig());
  assertCondition(noStrategies.size === 0, "disabled strategies must not enter the runtime registry");

  const regimeConfig = createTestBotConfig({
    strategies: {
      donchian_pivot_composition: { enabled: false },
      dydx_cex_carry: { enabled: false },
      cascade_fade: { enabled: false },
      funding_flip_kill_switch: { enabled: false },
      regime_detector: { enabled: true, symbols: ["ETH/USDC"] },
    },
  });
  const regimeInstances = createStrategyInstances(regimeConfig);
  assertCondition(
    regimeInstances.get("regime_detector")?.kind === "plugin",
    "regime detector did not become a plugin",
  );

  const carryConfig = BotConfigSchema.parse({
    bot: { selected_leverage: "10" },
    strategies: {
      donchian_pivot_composition: { enabled: false },
      dydx_cex_carry: { enabled: true, cap: 0.04, notional_per_leg_usd: 250_000 },
      cascade_fade: { enabled: false },
      funding_flip_kill_switch: { enabled: false },
      regime_detector: { enabled: false },
    },
  });
  assertCondition(carryConfig.bot.selected_leverage.canonical === "10", "global selected leverage changed");
  const fundingSource = new support.ManualFundingSource();
  const carry = buildDydxCexCarryConfig(carryConfig.strategies.dydx_cex_carry, fundingSource);
  assertCondition(carry.capFraction === 0.04, "carry cap override was lost");
  assertCondition(
    carry.notionalPerLegUsd.equals(ExactRational.from("250000")),
    "carry notional override was lost",
  );
  const defaultCarry = buildDydxCexCarryConfig(
    createTestBotConfig({
      strategies: {
        ...allDisabledConfig().strategies,
        dydx_cex_carry: {
          enabled: true,
          cap: undefined,
          notional_per_leg_usd: undefined,
        },
      },
    }).strategies.dydx_cex_carry,
    fundingSource,
  );
  assertCondition(
    defaultCarry.capFraction === 0.025 && defaultCarry.notionalPerLegUsd.equals(ExactRational.from("10000")),
    "carry default risk settings were not retained",
  );
  assertCondition(
    !BotConfigSchema.safeParse({ strategies: { dydx_cex_carry: { enabled: true, cap: 0.6 } } }).success,
    "carry cap above its schema ceiling was accepted",
  );
  assertCondition(
    !BotConfigSchema.safeParse({ strategies: { dydx_cex_carry: { enabled: true, leverage: 10 } } }).success,
    "carry leverage selector was accepted",
  );
  expectFailure(() => createStrategyInstances(carryConfig), "carry without funding source");
  expectFailure(
    () => createStrategyInstances(carryConfig, { dydxFundingSource: fundingSource }),
    "carry without precondition re-verifier",
  );

  for (const [name, overrides] of [
    [
      "cascade",
      { cascade_fade: { enabled: true, max_notional_per_event_usd: undefined, cooldown_hours: undefined } },
    ],
    ["funding", { funding_flip_kill_switch: { enabled: true } }],
  ] as const) {
    const config = createTestBotConfig({
      strategies: {
        ...allDisabledConfig().strategies,
        ...overrides,
      },
    });
    expectFailure(() => createStrategyInstances(config), `${name} unsupported producer`);
  }
}
