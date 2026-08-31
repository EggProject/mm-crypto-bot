import { expect, it } from "bun:test";

import { BotConfigSchema } from "./schema.js";

it("preserves public risk-builder defaults", () => {
  const config = BotConfigSchema.parse({});

  expect(config.risk).toMatchObject({
    risk_per_trade: 0.01,
    kelly_fraction: 0.25,
    max_drawdown_pct: 0.15,
    max_positions: 3,
    max_leverage: 10,
    max_position_fraction: 0.1,
    fallback_size_fraction: 0.01,
    trailing_stop: { enabled: false, atr_period: 14, atr_multiplier: 3, side: "both" },
    kelly: { enabled: false, fraction: 0.25, window_size: 50, min_trades: 10, fallback_fraction: 0.01 },
    drawdown_scaler: { enabled: false, max_dd_pct: 0.15 },
  });
});

it("preserves the public risk boundaries", () => {
  expect(BotConfigSchema.safeParse({ risk: { max_leverage: 10 } }).success).toBe(true);
  expect(BotConfigSchema.safeParse({ risk: { max_leverage: 11 } }).success).toBe(false);
});
