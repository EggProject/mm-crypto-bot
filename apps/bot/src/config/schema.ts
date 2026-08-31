/**
 * Bot configuration schemas and inferred public types.
 */

import { z } from "zod";

import { SelectedLeverageConfigSchema } from "./selected-leverage-config.js";

const TimeframesSchema = z
  .object({
    htf: z.string(),
    mtf: z.string(),
    ltf: z.string(),
  })
  .strict();

/**
 * A closed strategy section with every field consumed by the current runtime.
 */
export const StrategySectionSchema = z
  .object({
    enabled: z.boolean().default(false),
    cap: z.number().min(0).max(1).optional(),
    symbols: z.array(z.string()).optional(),
    timeframes: TimeframesSchema.optional(),
    risk_per_trade: z.number().min(0.001).max(0.05).optional(),
    max_positions: z.number().int().min(1).max(12).optional(),
    notional_per_leg_usd: z.number().positive().optional(),
    max_notional_per_event_usd: z.number().positive().optional(),
    cooldown_hours: z.number().positive().optional(),
  })
  .strict();

/**
 * The inferred strategy section type.
 */
export type StrategySection = z.infer<typeof StrategySectionSchema>;

/**
 * The dYdX carry section permits only values the carry strategy can execute.
 */
export const DydxCexCarryStrategySectionSchema = StrategySectionSchema.extend({
  cap: z.number().positive().max(0.5).optional(),
}).strict();

/**
 * The inferred closed dYdX carry section type.
 */
export type DydxCexCarryStrategySection = z.infer<typeof DydxCexCarryStrategySectionSchema>;

/**
 * The Donchian/Pivot strategy section adds its validated consensus setting.
 */
export const DonchianPivotStrategySectionSchema = StrategySectionSchema.extend({
  min_consensus: z.number().int().min(1).max(2).optional(),
}).strict();

const IntegerSchema = z.number().int();

function defaultIntegerInRange(minimum: number, maximum: number, defaultValue: number) {
  return IntegerSchema.min(minimum).max(maximum).default(defaultValue);
}

function defaultNumberInRange(minimum: number, maximum: number, defaultValue: number) {
  return z.number().min(minimum).max(maximum).default(defaultValue);
}

const BotSectionSchema = z
  .object({
    mode: z.enum(["paper", "live"]).default("paper"),
    log_level: z.enum(["debug", "info", "warn", "error"]).default("info"),
    state_file: z.string().default("data/bot-state.json"),
    selected_leverage: SelectedLeverageConfigSchema,
  })
  .strict()
  .default({});

const ExchangeSectionSchema = z
  .object({
    id: z.enum(["bybiteu", "mock"]).default("bybiteu"),
    rate_limit_ms: defaultIntegerInRange(10, 10_000, 100),
    slippage_pct: defaultNumberInRange(0, 1, 0.05),
    fee_tier: z.enum(["vip", "standard", "maker_rebate"]).default("standard"),
    rate_limit_per_min: defaultIntegerInRange(1, 600, 120),
    ws_reconnect_delay_ms: defaultIntegerInRange(100, 10_000, 1000),
    timeout_ms: defaultIntegerInRange(100, 120_000, 10_000),
  })
  .strict()
  .default({});

const ComplianceSectionSchema = z
  .object({
    jurisdiction: z.enum(["EU", "JP", "OTHER"]).default("EU"),
    jp_msb_registered: z.boolean().default(false),
  })
  .strict()
  .default({});

const TrailingStopSchema = z
  .object({
    enabled: z.boolean().default(false),
    atr_period: defaultIntegerInRange(2, 200, 14),
    atr_multiplier: defaultNumberInRange(0.5, 20, 3),
    side: z.enum(["long", "short", "both"]).default("both"),
  })
  .strict()
  .default({});

const KellySchema = z
  .object({
    enabled: z.boolean().default(false),
    fraction: defaultNumberInRange(0.05, 1, 0.25),
    window_size: defaultIntegerInRange(5, 500, 50),
    min_trades: defaultIntegerInRange(1, 100, 10),
    fallback_fraction: defaultNumberInRange(0.0001, 0.5, 0.01),
  })
  .strict()
  .default({});

const DrawdownScalerSchema = z
  .object({
    enabled: z.boolean().default(false),
    max_dd_pct: defaultNumberInRange(0.01, 0.5, 0.15),
  })
  .strict()
  .default({});

const RiskSectionSchema = z
  .object({
    risk_per_trade: defaultNumberInRange(0.001, 0.05, 0.01),
    kelly_fraction: defaultNumberInRange(0.05, 1, 0.25),
    max_drawdown_pct: defaultNumberInRange(0.01, 0.5, 0.15),
    max_positions: defaultIntegerInRange(1, 12, 3),
    max_leverage: z.literal(10).default(10),
    max_position_fraction: defaultNumberInRange(0.001, 1, 0.1),
    fallback_size_fraction: defaultNumberInRange(0.0001, 0.5, 0.01),
    trailing_stop: TrailingStopSchema,
    kelly: KellySchema,
    drawdown_scaler: DrawdownScalerSchema,
  })
  .strict()
  .default({});

const SymbolsSectionSchema = z
  .object({
    enabled: z.array(z.string()).default(["BTC/USDC", "ETH/USDC", "SOL/USDC"]),
  })
  .strict()
  .default({});

const StrategiesSectionSchema = z
  .object({
    donchian_pivot_composition: DonchianPivotStrategySectionSchema.default({
      enabled: true,
      cap: 0.2,
    }),
    dydx_cex_carry: DydxCexCarryStrategySectionSchema.default({
      enabled: false,
      cap: 0.025,
      notional_per_leg_usd: 125_000,
    }),
    cascade_fade: StrategySectionSchema.default({
      enabled: false,
      max_notional_per_event_usd: 1_000_000,
      cooldown_hours: 24,
    }),
    funding_flip_kill_switch: StrategySectionSchema.default({
      enabled: false,
    }),
    regime_detector: StrategySectionSchema.default({
      enabled: false,
    }),
  })
  .strict()
  .default({});

const TelemetrySectionSchema = z
  .object({
    log_dir: z.string().default("logs/bot"),
    metrics_interval_sec: defaultIntegerInRange(1, 3600, 60),
    log_level: z.enum(["debug", "info", "warn", "error"]).default("info"),
    log_destination: z.enum(["file", "stderr", "both"]).default("both"),
    metrics_enabled: z.boolean().default(true),
    heartbeat_interval_sec: defaultIntegerInRange(1, 300, 30),
  })
  .strict()
  .default({});

const PortfolioSectionSchema = z
  .object({
    total_risk_per_cycle_usd: defaultNumberInRange(1, 10_000, 100),
    correlation_penalty_threshold: defaultNumberInRange(0, 1, 0.7),
    correlation_window_size: defaultIntegerInRange(2, 1000, 30),
    max_dd_pct: defaultNumberInRange(0.01, 0.3, 0.1),
  })
  .strict()
  .default({});

/**
 * The complete bot configuration schema.
 */
export const BotConfigSchema = z
  .object({
    bot: BotSectionSchema,
    exchange: ExchangeSectionSchema,
    compliance: ComplianceSectionSchema,
    risk: RiskSectionSchema,
    symbols: SymbolsSectionSchema,
    strategies: StrategiesSectionSchema,
    telemetry: TelemetrySectionSchema,
    portfolio: PortfolioSectionSchema,
  })
  .strict();

/**
 * The complete inferred bot configuration.
 */
export type BotConfig = z.infer<typeof BotConfigSchema>;

/**
 * The union of top-level bot configuration keys.
 */
export type BotConfigKey = keyof BotConfig;

/**
 * The union of configured strategy names.
 */
export type StrategyName = keyof BotConfig["strategies"];
