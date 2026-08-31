import { z } from "zod";

const TrailingStopEnabledSchema = z.boolean().default(false);
const TrailingStopAtrPeriodSchema = z.number().int().min(2).max(200).default(14);
const TrailingStopAtrMultiplierSchema = z.number().min(0.5).max(20).default(3);
const TrailingStopSideSchema = z.enum(["long", "short", "both"]).default("both");

export const TrailingStopSectionSchema = z
  .object({
    enabled: TrailingStopEnabledSchema,
    atr_period: TrailingStopAtrPeriodSchema,
    atr_multiplier: TrailingStopAtrMultiplierSchema,
    side: TrailingStopSideSchema,
  })
  .default({});

const KellyEnabledSchema = z.boolean().default(false);
const KellyFractionSchema = z.number().min(0.05).max(1).default(0.25);
const KellyWindowSizeSchema = z.number().int().min(5).max(500).default(50);
const KellyMinimumTradesSchema = z.number().int().min(1).max(100).default(10);
const KellyFallbackFractionSchema = z.number().min(0.0001).max(0.5).default(0.01);

export const KellySectionSchema = z
  .object({
    enabled: KellyEnabledSchema,
    fraction: KellyFractionSchema,
    window_size: KellyWindowSizeSchema,
    min_trades: KellyMinimumTradesSchema,
    fallback_fraction: KellyFallbackFractionSchema,
  })
  .default({});

const DrawdownScalerEnabledSchema = z.boolean().default(false);
const DrawdownScalerMaximumDrawdownSchema = z.number().min(0.01).max(0.5).default(0.15);

export const DrawdownScalerSectionSchema = z
  .object({
    enabled: DrawdownScalerEnabledSchema,
    max_dd_pct: DrawdownScalerMaximumDrawdownSchema,
  })
  .default({});

const RiskPerTradeSchema = z.number().min(0.001).max(0.05).default(0.01);
const KellyFractionDefaultSchema = z.number().min(0.05).max(1).default(0.25);
const MaximumDrawdownSchema = z.number().min(0.01).max(0.5).default(0.15);
const MaximumPositionsSchema = z.number().int().min(1).max(12).default(3);
const MaximumLeverageSchema = z.number().int().min(1).max(10).default(10);
const MaximumPositionFractionSchema = z.number().min(0.001).max(1).default(0.1);
const FallbackSizeFractionSchema = z.number().min(0.0001).max(0.5).default(0.01);

export const RiskSectionSchema = z
  .object({
    risk_per_trade: RiskPerTradeSchema,
    kelly_fraction: KellyFractionDefaultSchema,
    max_drawdown_pct: MaximumDrawdownSchema,
    max_positions: MaximumPositionsSchema,
    max_leverage: MaximumLeverageSchema,
    max_position_fraction: MaximumPositionFractionSchema,
    fallback_size_fraction: FallbackSizeFractionSchema,
    trailing_stop: TrailingStopSectionSchema,
    kelly: KellySectionSchema,
    drawdown_scaler: DrawdownScalerSectionSchema,
  })
  .default({});

export const EnabledSymbolsSchema = z.array(z.string()).default(["BTC/USDC", "ETH/USDC", "SOL/USDC"]);
