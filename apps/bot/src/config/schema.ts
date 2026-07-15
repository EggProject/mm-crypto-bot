/**
 * apps/bot/src/config/schema.ts
 *
 * Phase 33 Track B — Bot config Zod schema.
 *
 * A bot config 6 szekcióból áll:
 *   1. `bot`        — indítási mód (paper/live), log-szint, state-fájl.
 *   2. `exchange`   — melyik exchange-re csatlakozunk, rate-limit, sandbox.
 *   3. `risk`       — risk/trade, Kelly-frakció, max DD, max position, max leverage.
 *   4. `symbols`    — mely symbol-okon kereskedünk (CCXT unified formátumban).
 *   5. `strategies` — per-strategy enable/disable + per-strategy beállítások.
 *   6. `telemetry`  — log-könyvtár, metrika-intervallum.
 *
 * A 1:10 leverage mandate a `risk.max_leverage` és a per-strategy
 * `leverage` mezőkön is érvényesítve van (Zod `.max(10)`).
 *
 * A `StrategySectionSchema.passthrough()` miatt forward-compatible
 * bármilyen új strategy-specifikus mezőt be tudunk vezetni a meglévő
 * config-ok kompatibilis törése nélkül.
 */

import { z } from "zod";

// ============================================================================
// 1) Per-strategy section schema
// ============================================================================

/**
 * `StrategySectionSchema` — egy adott stratégia konfigurációs szekciója.
 *
 * Minden stratégia section-jében kötelező az `enabled: boolean` flag.
 * A `true` azt jelenti: a bot runtime példányosítja a stratégiát és
 * beregisztrálja a futási ciklusba. A `false` azt jelenti: a stratégia
 * NEM lesz példányosítva és NEM jelenik meg a futási ciklusban
 * (Phase 21 #1 wire-up integrity lecke).
 *
 * A `.passthrough()` lehetővé teszi, hogy az egyes stratégiák
 * saját specifikus mezőket (cap, leverage, symbols, timeframes, ...)
 * is felvegyenek anélkül, hogy a sémát újra kelljen írni — a
 * Zod ezeket a mezőket változatlanul átengedi.
 */
export const StrategySectionSchema = z
  .object({
    /** A stratégia engedélyezve van-e. `false` → nincs példányosítva. */
    enabled: z.boolean().default(false),
    /** Max position size, equity-frakció (0..1). */
    cap: z.number().min(0).max(1).optional(),
    /** Per-strategy override leverage. 1:10 MANDATE. */
    leverage: z.number().int().min(1).max(10).optional(),
    /** Override symbol-lista. CCXT unified formátumban. */
    symbols: z.array(z.string()).optional(),
    /** Override timeframe-ek (htf/mtf/ltf). */
    timeframes: z
      .object({
        htf: z.string(),
        mtf: z.string(),
        ltf: z.string(),
      })
      .optional(),
    /**
     * Phase 37 Track 2 — per-strategy override-ok.
     *
     * A globális `[risk] risk_per_trade` / `[risk] max_positions` a
     * default, de a per-strategy override felülírja azt (a runtime
     * a `strategy-registry.ts`-ben olvassa a per-strategy értéket
     * először, és csak fallback-ként használja a globálisat).
     */
    risk_per_trade: z.number().min(0.001).max(0.05).optional(),
    max_positions: z.number().int().min(1).max(12).optional(),
  })
  .passthrough();

/** `StrategySection` — a Zod-inferred type. */
export type StrategySection = z.infer<typeof StrategySectionSchema>;

// ============================================================================
// 2) Top-level config schema
// ============================================================================

/**
 * `BotConfigSchema` — a teljes bot-konfiguráció Zod sémája.
 *
 * Minden szekció `.default({})` — így a felhasználó bármelyiket
 * elhagyhatja, és a Zod behelyettesíti a sémában definiált defaultokat.
 *
 * A `strategies` szekció default-jai a Phase 33 scope plan §"Track B"
 * táblázatából jönnek:
 *   - donchian_pivot_composition: enabled (default production)
 *   - dydx_cex_carry:            enabled (default production)
 *   - cascade_fade:              enabled (default production)
 *   - funding_flip_kill_switch:  disabled (defensive opt-in)
 *   - regime_detector:           disabled (meta-plugin opt-in)
 */
export const BotConfigSchema = z.object({
  // --------------------------------------------------------------------------
  // 1) Bot section — indítási mód, log-szint, state-fájl, auto_start.
  //
  // A `bot.auto_start` flag a Phase 36 Track A1 user-mandate:
  //   `mm-bot start` ALAPÉRTELMEZETTEN NEM indítja el a botot — a
  //   TUI `stopped` állapotban nyílik, a usernek a `[s]` billentyűvel
  //   kell indítania. A `bot.auto_start = true` (vagy a `--auto-start`
  //   CLI flag) visszakapcsolja a régi viselkedést (a bot indul a TUI
  //   indulásával egyidőben). Lásd `docs/audits/phase36-tui-ux-revamp-scope.md`
  //   §1 user issue #1, valamint `phase36-research-findings.md` §5 (Angle E).
  // --------------------------------------------------------------------------
  bot: z
    .object({
      mode: z.enum(["paper", "live"]).default("paper"),
      log_level: z.enum(["debug", "info", "warn", "error"]).default("info"),
      state_file: z.string().default("data/bot-state.json"),
      /** Ha `true`, a bot indul a TUI-val együtt. Default: `false` (manual start). */
      auto_start: z.boolean().default(false),
    })
    .default({}),

  // --------------------------------------------------------------------------
  // 2) Exchange section — melyik exchange-re csatlakozunk.
  //
  // A Phase 37 Track 2 új mezők: `slippage_pct`, `fee_tier`,
  // `rate_limit_per_min`, `ws_reconnect_delay_ms`. Ezek a per-exchange
  // kapcsolati paraméterek — a TUI settings panelből szerkeszthetők.
  // A meglévő `id`, `rate_limit_ms`, `sandbox` mezők megmaradnak a
  // backward compatibility kedvéért.
  // --------------------------------------------------------------------------
  exchange: z
    .object({
      id: z.enum(["bybiteu", "mock"]).default("bybiteu"),
      rate_limit_ms: z.number().int().min(10).max(10_000).default(100),
      sandbox: z.boolean().default(false),
      /** Max accepted slippage percent (0..1). Default: 0.05 (5%). */
      slippage_pct: z.number().min(0).max(1).default(0.05),
      /** Fee tier — vip / standard / maker_rebate. */
      fee_tier: z.enum(["vip", "standard", "maker_rebate"]).default("standard"),
      /** Rate limit per minute (orders + REST calls). Default: 120. */
      rate_limit_per_min: z.number().int().min(1).max(600).default(120),
      /** WebSocket reconnect delay in ms. Default: 1000. */
      ws_reconnect_delay_ms: z.number().int().min(100).max(10_000).default(1000),
    })
    .default({}),

  // --------------------------------------------------------------------------
  // 3) Risk section — 1:10 leverage MANDATE a max_leverage és a
  //    per-strategy leverage mezőkön.
  //
  //    Phase 37 Track 1 — Adaptive Risk Management: a `risk` szekció
  //    három új, default-off al-szekcióval bővül:
  //      - `trailing_stop`     — ATR-based trailing stop (long/short/both).
  //      - `kelly`             — dynamic Kelly position sizing (rolling window).
  //      - `drawdown_scaler`   — equity drawdown-aware position scaler.
  //
  //    A `max_position_fraction` és a `fallback_size_fraction` a Kelly
  //    modul cap-jei (cold-start fallback, max position cap). A teljes
  //    `risk` szekció `.default({})`-vel rendelkezik, így a meglévő
  //    TOML-ok minden változtatás nélkül parse-olódnak.
  // --------------------------------------------------------------------------
  risk: z
    .object({
      risk_per_trade: z.number().min(0.001).max(0.05).default(0.01),
      kelly_fraction: z.number().min(0.05).max(1).default(0.25),
      max_drawdown_pct: z.number().min(0.01).max(0.5).default(0.15),
      max_positions: z.number().int().min(1).max(12).default(3),
      max_leverage: z.number().int().min(1).max(10).default(10),
      /**
       * Phase 37 Track 1 — hard cap on Kelly-suggested size as fraction
       * of equity. Default 0.10 (10%). Matches Phase 1-5 engine convention.
       */
      max_position_fraction: z.number().min(0.001).max(1).default(0.1),
      /**
       * Phase 37 Track 1 — fallback size fraction used during the Kelly
       * cold-start period (fewer than `kelly.min_trades` closed trades).
       * Default 0.01 (1%) — small, defensive.
       */
      fallback_size_fraction: z.number().min(0.0001).max(0.5).default(0.01),
      /**
       * Phase 37 Track 1 — ATR-based trailing stop module. Disabled by
       * default (user must opt in).
       */
      trailing_stop: z
        .object({
          enabled: z.boolean().default(false),
          /** ATR period (Wilder smoothing). Default 14 — industry standard. */
          atr_period: z.number().int().min(2).max(200).default(14),
          /** ATR multiplier for the trail distance. Default 3.0. */
          atr_multiplier: z.number().min(0.5).max(20).default(3.0),
          /** Which side(s) to apply the trail. Default "both". */
          side: z.enum(["long", "short", "both"]).default("both"),
        })
        .default({}),
      /**
       * Phase 37 Track 1 — dynamic Kelly position sizing. Disabled by
       * default (user must opt in). The bot's existing
       * `risk.kelly_fraction` static value remains in effect when this
       * is disabled.
       */
      kelly: z
        .object({
          enabled: z.boolean().default(false),
          /** Fractional-Kelly multiplier. Default 0.25 (quarter Kelly). */
          fraction: z.number().min(0.05).max(1).default(0.25),
          /** Rolling window size (in closed trades) for p, b estimation. */
          window_size: z.number().int().min(5).max(500).default(50),
          /** Cold-start threshold — below this, fallback size is used. */
          min_trades: z.number().int().min(1).max(100).default(10),
          /** Fallback size fraction (override of `fallback_size_fraction`). */
          fallback_fraction: z.number().min(0.0001).max(0.5).default(0.01),
        })
        .default({}),
      /**
       * Phase 37 Track 1 — equity drawdown-aware position scaler.
       * Disabled by default. When enabled, new positions are scaled
       * DOWN as drawdown deepens, and STOPPED entirely in the kill
       * region (80-100% of max_dd_pct).
       */
      drawdown_scaler: z
        .object({
          enabled: z.boolean().default(false),
          /** Max drawdown pct (kill threshold). Default 0.15 (15%). */
          max_dd_pct: z.number().min(0.01).max(0.5).default(0.15),
        })
        .default({}),
    })
    .default({}),

  // --------------------------------------------------------------------------
  // 4) Symbols section — mely coin-okon kereskedünk.
  // --------------------------------------------------------------------------
  symbols: z
    .object({
      enabled: z
        .array(z.string())
        .default(["BTC/USDC", "ETH/USDC", "SOL/USDC"]),
    })
    .default({}),

  // --------------------------------------------------------------------------
  // 5) Strategies section — per-strategy enable/disable + overrides.
  // --------------------------------------------------------------------------
  strategies: z
    .object({
      /** Donchian + Pivot 2-component composition (Phase 18 #1 baseline). */
      donchian_pivot_composition: StrategySectionSchema.default({
        enabled: true,
        cap: 0.2,
      }),
      /** dYdX-vs-CEX cross-venue funding carry (Phase 25 #2 T2). */
      dydx_cex_carry: StrategySectionSchema.default({
        enabled: true,
        cap: 0.025,
        notional_per_leg_usd: 125_000,
      }),
      /** Liquidation cascade "fade-the-cascade" detector (Phase 25 #2 T2D). */
      cascade_fade: StrategySectionSchema.default({
        enabled: true,
        max_notional_per_event_usd: 1_000_000,
        cooldown_hours: 24,
      }),
      /** SOL funding-flip kill-switch plugin (defensive opt-in). */
      funding_flip_kill_switch: StrategySectionSchema.default({
        enabled: false,
      }),
      /** HMM 3-state regime-detector meta-plugin (opt-in). */
      regime_detector: StrategySectionSchema.default({
        enabled: false,
      }),
    })
    .default({}),

  // --------------------------------------------------------------------------
  // 6) Telemetry section — log-könyvtár, metrika-intervallum, log-szint,
  //    log-dest, metrics-kapcsoló, heartbeat.
  //
  // A Phase 37 Track 2 kibővíti a `telemetry` szekciót a
  // `log_level` / `log_destination` / `metrics_enabled` /
  // `heartbeat_interval_sec` mezőkkel. A `log_level` itt a
  // TELEMETRY log-szintje (nem a bot fő log-szintje — bár a
  // runtime jelenleg mindkettőt használja). A meglévő
  // `log_dir` / `metrics_interval_sec` mezők megmaradnak.
  // --------------------------------------------------------------------------
  telemetry: z
    .object({
      log_dir: z.string().default("logs/bot"),
      metrics_interval_sec: z.number().int().min(1).max(3600).default(60),
      /** Log-szint (debug/info/warn/error). Default: info. */
      log_level: z.enum(["debug", "info", "warn", "error"]).default("info"),
      /** Log-dest: file / stderr / both. Default: both. */
      log_destination: z.enum(["file", "stderr", "both"]).default("both"),
      /** Metrics-emitálás engedélyezve van-e. Default: true. */
      metrics_enabled: z.boolean().default(true),
      /** Liveness heartbeat interval in seconds. Default: 30. */
      heartbeat_interval_sec: z.number().int().min(1).max(300).default(30),
    })
    .default({}),

  // --------------------------------------------------------------------------
  // 7) Portfolio section — Phase 37 Track 4.
  //
  // A multi-strategy portfólió koordináció paraméterei:
  //   - `total_risk_per_cycle_usd`: a ciklusonkénti max új kockázat
  //     (USD). A `RiskBudgetAllocator` ezt osztja szét a stratégiák
  //     között. Hard cap: 10 000.
  //   - `correlation_penalty_threshold`: a korreláció küszöb (0..1).
  //     Ha két stratégia korrelációja >= ez, a közös büdzséjük
  //     csökken. Default: 0.7.
  //   - `correlation_window_size`: a görgető korreláció ablakméret
  //     (trade-ek száma). Default: 30.
  //   - `max_dd_pct`: a portfolió-szintű circuit breaker küszöb
  //     (0..0.30). Ha a portfolió drawdown >= ez, minden pozíció
  //     zárul, és a bot leáll. Default: 0.10.
  // --------------------------------------------------------------------------
  portfolio: z
    .object({
      total_risk_per_cycle_usd: z.number().min(1).max(10_000).default(100),
      correlation_penalty_threshold: z.number().min(0).max(1).default(0.7),
      correlation_window_size: z.number().int().min(2).max(1000).default(30),
      max_dd_pct: z.number().min(0.01).max(0.30).default(0.10),
    })
    .default({}),
});

/** `BotConfig` — a teljes bot-config Zod-inferred típusa. */
export type BotConfig = z.infer<typeof BotConfigSchema>;

/**
 * A `BotConfigSchema` kulcsainak uniója — hasznos a strategy-registry
 * és a loader típus-szintű kimerítős vizsgálatához.
 */
export type BotConfigKey = keyof BotConfig;

/**
 * A `strategies` szekcióban definiált összes strategy-név unió-típusa.
 */
export type StrategyName = keyof BotConfig["strategies"];
