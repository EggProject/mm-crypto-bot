/**
 * apps/bot/src/config/strategy-registry.ts
 *
 * Phase 33 Track B — A `BotConfig` alapján a futó stratégia + plugin
 * példányok előállítása.
 *
 * A user mandátum (2026-07-11 23:42 Budapest):
 *   "ugy csinald meg a rendszert hogy egy config alapjan induljon a
 *    bot ahol minden strategiat be tudok allitani, es ha ki lehessen
 *    kapcsolni strategiakat egyesvel is"
 *
 * Ez a fájl a hid a konfiguráció és a runtime között:
 *   - Végigmegy a `config.strategies` szekción
 *   - Minden `enabled = true` stratégiához meghívja a megfelelő factory-t
 *   - A factory a per-strategy config-section alapján alkalmazza az
 *     override-okat (cap, leverage, symbols, timeframes, stb.)
 *   - A `enabled = false` stratégiák NEM kerülnek példányosításra
 *     (Phase 21 #1 wire-up integrity lecke: a lekapcsolt stratégia
 *     nem jelenik meg a runtime-ban, és a viselkedése különbözik az
 *     engedélyezettől).
 *
 * Kétféle runtime-entitás van:
 *   - `Strategy` (a `Strategy` interfészt implementáló osztályok) —
 *     ezek közvetlenül a `StrategyContext.onCandle(ctx)`-n keresztül
 *     kapják a feed-et.
 *   - `StrategyPlugin` (a signal-center pluginok) — ezek a SignalBus-ra
 *     iratkoznak fel, és a bus-on keresztül kapják a feed-et.
 *
 * Mindkettő ugyanabban a `Map<StrategyName, BotStrategyInstance>`-ben
 * tér vissza — az egységes kezeléshez. A `BotStrategyInstance` egy
 * tagged union, hogy a fogyasztók típus-szinten meg tudják különböztetni
 * a kettőt (`kind === "strategy"` vs `kind === "plugin"`).
 */

import {
  CascadeFadeStrategy,
  type CascadeFadeConfig,
} from "@mm-crypto-bot/core";
import {
  DEFAULT_CASCADE_FADE_CONFIG,
  DEFAULT_DONCHIAN_PIVOT_COMPOSITION_CONFIG,
  DEFAULT_DYDX_CEX_CARRY_CONFIG,
  DEFAULT_INITIAL_STATE_PROBS,
  DEFAULT_MIN_OBSERVATIONS,
  DEFAULT_NUM_STATES,
  DEFAULT_REGIME_DETECTOR_BASE_NOTIONAL_USD,
  DEFAULT_REGIME_DETECTOR_ENABLED_SYMBOLS,
  DEFAULT_REGIME_SIZE_MULTIPLIER_RANGING,
  DEFAULT_REGIME_SIZE_MULTIPLIER_TRENDING,
  DEFAULT_REGIME_SIZE_MULTIPLIER_VOLATILE,
  DEFAULT_SOL_FLIP_KILL_SWITCH_PLUGIN_CONFIG,
  DEFAULT_STATE_EMISSION_STDDEV,
  DEFAULT_TRANSITION_LEARNING_DAYS,
  DEFAULT_TRANSITION_MATRIX,
  DonchianPivotComposition,
  DydxCexCarryStrategy,
  RegimeDetectorMetaPlugin,
  SOLFlipKillSwitchPlugin,
  type DydxFundingSource,
  type Strategy,
  type StrategyPlugin,
} from "@mm-crypto-bot/core";

import { ConfigError } from "./loader.js";
import type { BotConfig, StrategyName, StrategySection } from "./schema.js";

// ============================================================================
// Public types
// ============================================================================

/**
 * `BotStrategyInstance` — a futó bot egy komponense.
 *
 * Tagged union: `kind: "strategy"` esetén `instance: Strategy`,
 * `kind: "plugin"` esetén `instance: StrategyPlugin`. A fogyasztó
 * a `kind` alapján szűrhet.
 */
export type BotStrategyInstance =
  | { readonly kind: "strategy"; readonly name: StrategyName; readonly instance: Strategy }
  | { readonly kind: "plugin"; readonly name: StrategyName; readonly instance: StrategyPlugin };

/**
 * `BotDependencies` — a factory-k által igényelt dependency-k.
 *
 * A `dydx_cex_carry` stratégia runtime-követelménye a `DydxFundingSource`
 * (a dYdX v4 indexer feed). Ha a config engedélyezi a stratégiát,
 * de nincs funding source, a factory `ConfigError`-t dob — így a
 * felhasználó azonnal látja, hogy mit kell bekötni.
 *
 * A jövőbeli track-ek (Track C Bot runtime) tölti fel a `deps`-t
 * tényleges implementációkkal. A config system most a szerződést
 * rögzíti.
 */
export interface BotDependencies {
  /**
   * `DydxFundingSource` — a dYdX v4 indexer + CEX funding feed.
   * Kötelező, ha a `dydx_cex_carry` stratégia `enabled = true`.
   * `null` / `undefined` esetén a factory `ConfigError`-t dob.
   */
  readonly dydxFundingSource?: DydxFundingSource | null;
}

// ============================================================================
// Per-strategy config adapterek
// ============================================================================

/**
 * `buildDonchianPivotConfig` — a `DonchianPivotComposition`-nek átadott
 * konfiguráció összeállítása a `StrategySection` alapján.
 *
 * A jelenlegi séma-szintű támogatás:
 *   - `min_consensus` (per-strategy override; 1..2)
 *
 * A többi per-strategy override (cap, leverage, symbols, timeframes)
 * a jövőbeli Track C Bot runtime-ban fog érvényesülni a position
 * sizing és a symbol-szűrés szintjén. A Strategy maga nem veszi
 * át ezeket a mezőket (a Donchian-Pivot Composition M15-ön emitál,
 * az indikátor-szintű konfigurációt a `donchianRange` / `pivotGrid`
 * sub-configokban lehet felülírni — lásd
 * `DEFAULT_DONCHIAN_PIVOT_COMPOSITION_CONFIG`).
 */
function buildDonchianPivotConfig(section: StrategySection): {
  readonly minConsensus: number;
  readonly ltf: "1m" | "5m" | "15m" | "1h" | "4h" | "1d";
} {
  const ltfOverride = section.timeframes?.ltf;
  // A DonchianPivotComposition M15-native (Phase 18 §3). Ha a user
  // más LTF-et ad, elfogadjuk, de alapértelmezetten M15 marad.
  const ltf = (ltfOverride === "1m" || ltfOverride === "5m" || ltfOverride === "15m" ||
    ltfOverride === "1h" || ltfOverride === "4h" || ltfOverride === "1d")
    ? ltfOverride
    : "15m";
  // Az 1..2 tartományon kívüli értéket a DonchianPivotComposition
  // saját RangeError-rel elutasítja — itt csak a defaultot adjuk.
  const minConsensusRaw = (section as { min_consensus?: unknown }).min_consensus;
  const minConsensus = typeof minConsensusRaw === "number" && minConsensusRaw >= 1 && minConsensusRaw <= 2
    ? minConsensusRaw
    : DEFAULT_DONCHIAN_PIVOT_COMPOSITION_CONFIG.minConsensus;
  return { minConsensus, ltf };
}

/**
 * `buildDydxCexCarryConfig` — a `DydxCexCarryStrategy` konfigurációjának
 * összeállítása a per-strategy section és a kötelező `DydxFundingSource`
 * alapján.
 *
 * Field-mapping:
 *   - `cap`          → `capFraction`  (max 0.5 a DydxCexCarryConfig invariant)
 *   - `leverage`     → `leverage`     (1 vagy 10; 1:10 MANDATE)
 *   - `notional_per_leg_usd` → `notionalPerLegUsd`  (USD, pozitív)
 *   - `fundingSource`  → kötelező, a `deps.dydxFundingSource`-ból jön
 *
 * A kill-switch / precondition / latency alapértékei a DydxCexCarry
 * `DEFAULT_DYDX_CEX_CARRY_CONFIG`-ból jönnek, és NEM overridable-ök
 * a TOML-ból (az orchestrator scope lock szerint).
 */
function buildDydxCexCarryConfig(
  section: StrategySection,
  fundingSource: DydxFundingSource,
): {
  readonly market: "BTC-USD";
  readonly direction: "dydx-long-cex-short";
  readonly notionalPerLegUsd: number;
  readonly capFraction: number;
  readonly leverage: 1 | 10;
  readonly fundingSource: DydxFundingSource;
  readonly killSwitch: typeof DEFAULT_DYDX_CEX_CARRY_CONFIG.killSwitch;
  readonly precondition: typeof DEFAULT_DYDX_CEX_CARRY_CONFIG.precondition;
  readonly latencyArbThresholdMs: number;
  readonly latencySource: null;
} {
  // cap → capFraction (a DydxCexCarryConfig invariant: (0, 0.5])
  const cap = typeof section.cap === "number" ? section.cap : DEFAULT_DYDX_CEX_CARRY_CONFIG.capFraction;
  const capFraction = cap > 0 && cap <= 0.5 ? cap : DEFAULT_DYDX_CEX_CARRY_CONFIG.capFraction;
  // leverage → 1 vagy 10 (1:10 MANDATE)
  const lev = typeof section.leverage === "number" ? section.leverage : DEFAULT_DYDX_CEX_CARRY_CONFIG.leverage;
  const leverage: 1 | 10 = lev === 1 ? 1 : 10;
  // notional_per_leg_usd → notionalPerLegUsd (USD, pozitív)
  const notionalRaw = (section as { notional_per_leg_usd?: unknown }).notional_per_leg_usd;
  const notionalPerLegUsd = typeof notionalRaw === "number" && notionalRaw > 0
    ? notionalRaw
    : DEFAULT_DYDX_CEX_CARRY_CONFIG.notionalPerLegUsd;
  return {
    market: DEFAULT_DYDX_CEX_CARRY_CONFIG.market,
    direction: DEFAULT_DYDX_CEX_CARRY_CONFIG.direction,
    notionalPerLegUsd,
    capFraction,
    leverage,
    fundingSource,
    killSwitch: DEFAULT_DYDX_CEX_CARRY_CONFIG.killSwitch,
    precondition: DEFAULT_DYDX_CEX_CARRY_CONFIG.precondition,
    latencyArbThresholdMs: DEFAULT_DYDX_CEX_CARRY_CONFIG.latencyArbThresholdMs,
    latencySource: null,
  };
}

/**
 * `buildCascadeFadeConfig` — a `CascadeFadeStrategy` konfigurációjának
 * összeállítása.
 *
 * Field-mapping:
 *   - `max_notional_per_event_usd` → `capacityMaxPerSymbolEventUsd`
 *   - `cooldown_hours`            → `riskBtCooldownMs` (ms-re váltva)
 *
 * A többi CascadeFadeConfig mező (Layer 1/2/3 küszöbök, risk governor,
 * symbol-lista) a `DEFAULT_CASCADE_FADE_CONFIG`-ból jön, és jelenleg
 * NEM overridable a TOML-ból.
 */
function buildCascadeFadeConfig(section: StrategySection): CascadeFadeConfig {
  const notionalRaw = (section as { max_notional_per_event_usd?: unknown }).max_notional_per_event_usd;
  const maxNotionalPerEventUsd = typeof notionalRaw === "number" && notionalRaw > 0
    ? notionalRaw
    : DEFAULT_CASCADE_FADE_CONFIG.capacityMaxPerSymbolEventUsd;
  const cooldownHoursRaw = (section as { cooldown_hours?: unknown }).cooldown_hours;
  const cooldownHours = typeof cooldownHoursRaw === "number" && cooldownHoursRaw > 0
    ? cooldownHoursRaw
    : DEFAULT_CASCADE_FADE_CONFIG.riskBtCooldownMs / (60 * 60 * 1000);
  return {
    ...DEFAULT_CASCADE_FADE_CONFIG,
    capacityMaxPerSymbolEventUsd: maxNotionalPerEventUsd,
    riskBtCooldownMs: cooldownHours * 60 * 60 * 1000,
  };
}

/**
 * `buildFundingFlipKillSwitchConfig` — a `SOLFlipKillSwitchPlugin`
 * konfigurációjának összeállítása. Jelenleg a phase 9 9D baseline
 * defaultjait használja, és nem vesz át per-section override-okat.
 */
function buildFundingFlipKillSwitchConfig(): typeof DEFAULT_SOL_FLIP_KILL_SWITCH_PLUGIN_CONFIG {
  return { ...DEFAULT_SOL_FLIP_KILL_SWITCH_PLUGIN_CONFIG };
}

/**
 * `buildRegimeDetectorConfig` — a `RegimeDetectorMetaPlugin`
 * konfigurációjának összeállítása. Jelenleg a phase 11.2a baseline
 * defaultjait használja.
 *
 * A `RegimeDetectorConfig` a phase 11.2a spec-ből jön:
 *   - `perRegimeSizeMultiplier` — 3-as tuple (trending, ranging, volatile)
 *   - `stateEmissionStdDev`     — 3-as tuple (per-state σ)
 *   - `transitionMatrix`        — 3×3-as tuple
 *   - `initialStateProbs`       — 3-as tuple
 */
function buildRegimeDetectorConfig(): {
  readonly numStates: number;
  readonly stateEmissionStdDev: readonly [number, number, number];
  readonly transitionMatrix: readonly [
    readonly [number, number, number],
    readonly [number, number, number],
    readonly [number, number, number],
  ];
  readonly initialStateProbs: readonly [number, number, number];
  readonly perRegimeSizeMultiplier: readonly [number, number, number];
  readonly minObservations: number;
  readonly transitionLearningDays: number;
  readonly baseNotionalUsd: number;
  readonly enabledSymbols: readonly string[];
} {
  return {
    numStates: DEFAULT_NUM_STATES,
    stateEmissionStdDev: DEFAULT_STATE_EMISSION_STDDEV,
    transitionMatrix: DEFAULT_TRANSITION_MATRIX,
    initialStateProbs: DEFAULT_INITIAL_STATE_PROBS,
    perRegimeSizeMultiplier: [
      DEFAULT_REGIME_SIZE_MULTIPLIER_TRENDING,
      DEFAULT_REGIME_SIZE_MULTIPLIER_RANGING,
      DEFAULT_REGIME_SIZE_MULTIPLIER_VOLATILE,
    ],
    minObservations: DEFAULT_MIN_OBSERVATIONS,
    transitionLearningDays: DEFAULT_TRANSITION_LEARNING_DAYS,
    baseNotionalUsd: DEFAULT_REGIME_DETECTOR_BASE_NOTIONAL_USD,
    enabledSymbols: DEFAULT_REGIME_DETECTOR_ENABLED_SYMBOLS,
  };
}

// ============================================================================
// Per-strategy factory-k
// ============================================================================

/**
 * `makeDonchianPivotComposition` — a `DonchianPivotComposition` factory.
 * A per-strategy config-ból a `minConsensus` és az `ltf` override-ok
 * kerülnek alkalmazásra. A `cap` / `leverage` / `symbols` mezők a
 * jelenlegi Strategy API-ban NEM átvehetők (ezek a Bot runtime-ban
 * érvényesülnek a position-sizing szintjén).
 */
function makeDonchianPivotComposition(
  section: StrategySection,
): { readonly kind: "strategy"; readonly instance: Strategy } {
  const { minConsensus, ltf } = buildDonchianPivotConfig(section);
  const strategy = new DonchianPivotComposition({ minConsensus }, ltf);
  return { kind: "strategy", instance: strategy };
}

/**
 * `makeDydxCexCarry` — a `DydxCexCarryStrategy` factory.
 *
 * Ha a per-strategy `enabled = true`, de a `deps.dydxFundingSource`
 * hiányzik, a factory `ConfigError`-t dob — ezzel szembesíti a
 * felhasználót a runtime-dependency-vel.
 */
function makeDydxCexCarry(
  section: StrategySection,
  deps: BotDependencies,
): { readonly kind: "strategy"; readonly instance: Strategy } {
  const fundingSource = deps.dydxFundingSource ?? null;
  if (fundingSource === null) {
    throw new ConfigError(
      "Strategy 'dydx_cex_carry' is enabled but no DydxFundingSource was provided. " +
        "Pass a `dydxFundingSource` in the `BotDependencies` to the strategy registry.",
      "strategies.dydx_cex_carry",
      [],
    );
  }
  const config = buildDydxCexCarryConfig(section, fundingSource);
  const strategy = new DydxCexCarryStrategy(config);
  return { kind: "strategy", instance: strategy };
}

/**
 * `makeCascadeFade` — a `CascadeFadeStrategy` factory.
 */
function makeCascadeFade(
  section: StrategySection,
): { readonly kind: "strategy"; readonly instance: Strategy } {
  const config = buildCascadeFadeConfig(section);
  const strategy = new CascadeFadeStrategy(config);
  return { kind: "strategy", instance: strategy };
}

/**
 * `makeFundingFlipKillSwitch` — a `SOLFlipKillSwitchPlugin` factory.
 */
function makeFundingFlipKillSwitch(): { readonly kind: "plugin"; readonly instance: StrategyPlugin } {
  const config = buildFundingFlipKillSwitchConfig();
  const plugin = new SOLFlipKillSwitchPlugin(config);
  return { kind: "plugin", instance: plugin };
}

/**
 * `makeRegimeDetector` — a `RegimeDetectorMetaPlugin` factory.
 */
function makeRegimeDetector(): { readonly kind: "plugin"; readonly instance: StrategyPlugin } {
  const config = buildRegimeDetectorConfig();
  const plugin = new RegimeDetectorMetaPlugin(config);
  return { kind: "plugin", instance: plugin };
}

// ============================================================================
// Main factory
// ============================================================================

/**
 * `createStrategyInstances` — a `BotConfig` alapján elkészíti az
 * engedélyezett stratégiák + plugin-ok futó példányait.
 *
 * Az iteráció sorrendje megegyezik a `BotConfigSchema.strategies`
 * kulcs-sorrendjével (canonical, determinisztikus). A visszatérési
 * érték egy `Map`, amely:
 *   - tartalmazza az összes `enabled = true` komponenst, és
 *   - NEM tartalmazza az `enabled = false` komponenseket.
 *
 * A wire-up integrity (Phase 21 #1 lecke): ha egy komponenst
 * kikapcsolunk, az NEM jelenik meg a visszatérési Map-ben, és a
 * bot runtime NAK fogja azt a komponenst futtatni → a kikapcsolt
 * stratégia 0 signalt produkál (bit-identical trade stream).
 *
 * @param config A Zod-validált `BotConfig`.
 * @param deps   A futásidejű dependency-k (pl. funding source).
 *   A Track C Bot runtime tölti fel a valós implementációkkal.
 * @returns `Map<StrategyName, BotStrategyInstance>` — a futó entitások.
 */
export function createStrategyInstances(
  config: BotConfig,
  deps: BotDependencies = {},
): Map<StrategyName, BotStrategyInstance> {
  const instances = new Map<StrategyName, BotStrategyInstance>();
  const strategies = config.strategies;

  // 1) Donchian + Pivot composition (default ON, M15-native).
  if (strategies.donchian_pivot_composition.enabled) {
    instances.set(
      "donchian_pivot_composition",
      { name: "donchian_pivot_composition", ...makeDonchianPivotComposition(strategies.donchian_pivot_composition) },
    );
  }

  // 2) dYdX-vs-CEX cross-venue funding carry (default ON, requires
  //    DydxFundingSource).
  if (strategies.dydx_cex_carry.enabled) {
    instances.set(
      "dydx_cex_carry",
      { name: "dydx_cex_carry", ...makeDydxCexCarry(strategies.dydx_cex_carry, deps) },
    );
  }

  // 3) Liquidation cascade fade (default ON, event-driven satellite).
  if (strategies.cascade_fade.enabled) {
    instances.set(
      "cascade_fade",
      { name: "cascade_fade", ...makeCascadeFade(strategies.cascade_fade) },
    );
  }

  // 4) SOL funding-flip kill-switch plugin (default OFF, opt-in).
  if (strategies.funding_flip_kill_switch.enabled) {
    instances.set(
      "funding_flip_kill_switch",
      { name: "funding_flip_kill_switch", ...makeFundingFlipKillSwitch() },
    );
  }

  // 5) HMM 3-state regime-detector meta-plugin (default OFF, opt-in).
  if (strategies.regime_detector.enabled) {
    instances.set(
      "regime_detector",
      { name: "regime_detector", ...makeRegimeDetector() },
    );
  }

  return instances;
}
