# Production strategies — bot wiring

How the 5 production strategies in the `mm-crypto-bot` runtime are configured
and wired into the `mm-bot` execution layer. This doc is the bridge between
the strategy implementations (in `packages/core/src/strategy/`) and the
bot config + factory layer (in `apps/bot/src/config/`).

For the full operator guide (quick start, CLI reference, live testing
workflow), see [`apps/bot/README.md`](../../apps/bot/README.md). For the
canonical config reference, see
[`run-bot/config/default.toml`](../../run-bot/config/default.toml).

---

## 1. The 5 configurable strategies

| Name (config key) | Class | Default | Kind |
|-------------------|-------|---------|------|
| `donchian_pivot_composition` | `DonchianPivotComposition` | ✅ enabled | `strategy` |
| `dydx_cex_carry` | `DydxCexCarryStrategy` | ✅ enabled | `strategy` |
| `cascade_fade` | `CascadeFadeStrategy` | ✅ enabled | `strategy` |
| `funding_flip_kill_switch` | `SOLFlipKillSwitchPlugin` | ❌ disabled | `plugin` |
| `regime_detector` | `RegimeDetectorMetaPlugin` | ❌ disabled | `plugin` |

**Wire-up integrity guarantee (Phase 21 #1):** an `enabled = false` strategy
is **not instantiated** by `createStrategyInstances(config)`. The runtime
behaviour is bit-identical to "the strategy does not exist" — not a
no-op shadow. The `mm-bot strategies` subcommand prints the on/off state
so you can verify the wire-up without starting the bot.

---

## 2. Where the strategies live

```
packages/core/src/strategy/
├── donchian-pivot-composition.ts   ← ①
├── dydx-cex-carry.ts               ← ②
├── cascade-fade.ts                 ← ③
├── funding-flip-kill-switch.ts     ← ④ (plugin)
├── regime-detector / signal-center ← ⑤ (meta-plugin)
└── ...                             (paper-trade helpers, infra)

apps/bot/src/config/
├── schema.ts            ← Zod schema (6 sections)
├── loader.ts            ← loadBotConfig(path?)
├── defaults.ts          ← Zod-derived defaults
└── strategy-registry.ts ← createStrategyInstances(config, deps)
                          ↑ this is the per-config factory
```

The strategies are constructed by the **strategy-registry factory**, which
reads `[strategies.<name>]` from the validated `BotConfig` and applies
per-strategy overrides at construction time. The factory is the **only
place** where TOML config → live strategy instance mapping happens.

---

## 3. Per-strategy config reference

Every section below is what you'll find in `config/default.toml`, with a
1-line description of what each field does and how it flows into the
strategy constructor.

### 3.1 `donchian_pivot_composition` (default ON)

The 2-component composition of `DonchianRangeChannel` and
`PivotPointGrid` with a configurable consensus. This is the **baseline
production strategy** — runs on every enabled symbol.

```toml
[strategies.donchian_pivot_composition]
enabled = true            # factory builds the instance iff true
cap = 0.20                # max position as fraction of equity (Bot runtime enforces)
min_consensus = 1         # 1 = loose (more trades), 2 = strict (fewer trades, lower DD)
symbols = ["BTC/USDC", "ETH/USDC", "SOL/USDC"]   # override default symbol list
```

**Config → constructor mapping** (in `buildDonchianPivotConfig()`):

| TOML field | Strategy param | Notes |
|------------|----------------|-------|
| `min_consensus` | `minConsensus` (1 or 2) | Anything outside [1, 2] falls back to the default (`1`). |
| `timeframes.ltf` | `ltf` (M1/M5/M15/M1H/M4H/D1) | M15 is the production default. |
| `cap` | (Bot-level) | Applied at position-sizing time by the Bot runtime, not in the Strategy. |
| `symbols` | (Bot-level) | Filter applied by the StrategyRunner, not in the Strategy. |

**Envelopes (Phase 31 fresh-start audit):** +41.99%/mo portfolio avg
@ ≤7.70% max-DD at `cap=0.20`, 1-of-2 mode, BTC/ETH/SOL. The
2-of-2 mode envelope (Phase 24 #2) is +18.82%/mo @ max-DD ~4.64% — a
safer downshift option, also at `cap=0.20`.

### 3.2 `dydx_cex_carry` (default ON)

Cross-venue funding-rate carry: long on dYdX v4, short on CEX, when
the dYdX funding rate is positive (or short-dYdX long-CEX when negative).
Captures the funding-rate differential with delta-neutral positioning.

```toml
[strategies.dydx_cex_carry]
enabled = true                          # factory builds the instance iff true
cap = 0.025                             # max position as fraction of equity
leverage = 10                           # 1:10 MANDATE (Zod enforces max 10)
notional_per_leg_usd = 125_000          # $125k/leg (per BTC-USD spec)
```

**Config → constructor mapping** (in `buildDydxCexCarryConfig()`):

| TOML field | Strategy param | Notes |
|------------|----------------|-------|
| `cap` | `capFraction` | Clamped to `(0, 0.5]`. |
| `leverage` | `leverage` (1 or 10) | Anything other than 1 ⇒ 10. |
| `notional_per_leg_usd` | `notionalPerLegUsd` | USD, must be positive. |
| `fundingSource` | (Bot-level) | Injected by `BotDependencies.dydxFundingSource` — required at runtime. |

**Special note:** the `dydx_cex_carry` strategy is the only one that
needs an external dependency (the dYdX v4 indexer + CEX funding feed).
If you enable it without providing a `DydxFundingSource` via the
`BotDependencies`, `createStrategyInstances` throws `ConfigError` at
startup — a fail-fast signal to the user.

**Scope lock:** BTC-USD only (per Phase 25 #2 T2). Kill-switches and
pre-conditions are NOT overridable from TOML (orchestrator-decided).

### 3.3 `cascade_fade` (default ON)

Detects liquidation-cascade events on the perps market and "fades" the
cascade — i.e., trades in the direction of the cascade as a
mean-reversion play when the cascade is over-extended. This is an
**event-driven satellite strategy** (not tick-by-tick).

```toml
[strategies.cascade_fade]
enabled = true                                 # factory builds the instance iff true
max_notional_per_event_usd = 1_000_000         # $1M/event cap (per Phase 25 #2 T2D)
cooldown_hours = 24                            # 24h cooldown between BTC entries
```

**Config → constructor mapping** (in `buildCascadeFadeConfig()`):

| TOML field | Strategy param | Notes |
|------------|----------------|-------|
| `max_notional_per_event_usd` | `capacityMaxPerSymbolEventUsd` | USD, must be positive. |
| `cooldown_hours` | `riskBtCooldownMs` | Converted to ms (`× 60 × 60 × 1000`). |

**Scope lock:** the other CascadeFadeConfig fields (Layer 1/2/3
thresholds, risk governor, default symbol list) are NOT overridable
from TOML. They come from `DEFAULT_CASCADE_FADE_CONFIG` (the Phase 25
#2 T2D baseline).

### 3.4 `funding_flip_kill_switch` (default OFF, opt-in)

SOL-only signal-center plugin: detects when the SOL funding rate
flips sign and engages a defensive kill-switch on SOL strategies
when the flip is sustained. Useful as a defensive drop-in for users
running SOL-heavy books.

```toml
[strategies.funding_flip_kill_switch]
enabled = false    # opt-in; set true to enable
```

Currently no per-strategy TOML overrides are applied — the strategy
uses its Phase 9 9D baseline defaults.

### 3.5 `regime_detector` (default OFF, opt-in)

HMM 3-state regime-detector meta-plugin (trending / ranging / volatile).
Outputs a `SizingSignal` modifier that scales the position size of the
strategies that subscribe to it. The wiring of the SignalBus
subscription is a **future-track item** — the plugin is registered in
the strategy-registry but is not currently active at runtime (see
`apps/bot/README.md` §9 "Signal-center plugins not wired at runtime").

```toml
[strategies.regime_detector]
enabled = false    # opt-in; set true to enable
```

No per-strategy TOML overrides are applied — uses Phase 11.2a baseline
defaults (`perRegimeSizeMultiplier`, `transitionMatrix`, etc.).

---

## 4. The factory in detail

`createStrategyInstances(config: BotConfig, deps?: BotDependencies)`
in `apps/bot/src/config/strategy-registry.ts` is the single point where
TOML config becomes runtime strategy instances.

```ts
// Example: enabled = 3 strategies, 2 plugins remain unwired
const config = loadBotConfig("config/prod.toml");
const instances = createStrategyInstances(config, {
  dydxFundingSource: new DydxV4IndexerFundingSource(),  // required for dydx_cex_carry
});

// instances is Map<StrategyName, BotStrategyInstance>
//   → Map {
//       "donchian_pivot_composition" → { kind: "strategy", instance: DonchianPivotComposition },
//       "dydx_cex_carry"            → { kind: "strategy", instance: DydxCexCarryStrategy },
//       "cascade_fade"              → { kind: "strategy", instance: CascadeFadeStrategy },
//     }
//
//   funding_flip_kill_switch and regime_detector are NOT in the Map
//   (enabled = false → no instantiation, wire-up integrity).
```

The factory throws `ConfigError` if a strategy is enabled but its
runtime dependency is missing (e.g. `dydx_cex_carry` without
`DydxFundingSource`). This is a **fail-fast** signal at startup.

---

## 5. The runtime path

Once the factory returns the instance Map, the `Bot` lifecycle wires
them into the event loop:

```
config (TOML)
   │  loadBotConfig() + Zod validation
   ▼
BotConfig
   │  createStrategyInstances(config, deps)
   ▼
Map<StrategyName, BotStrategyInstance>
   │  Bot constructor stores the Map
   ▼
StrategyRunner
   │  per-tick: for each (kind: "strategy") instance,
   │            call onCandle(ctx) with the current bar
   ▼
Strategy.onCandle → StrategySignal { side, takeProfit, stopLoss, ... }
   │  StrategyRunner sizes it: qty = riskPerTrade × equity / refPrice
   │  OrderManager.placeOrder() — L2 leverage check
   ▼
ExchangeFeed.placeOrder
   │  fill event comes back
   ▼
PositionManager.recordFill — L3 leverage check
   │
   ▼
StateStore (atomic JSON write) + Telemetry (log)
```

The `kind: "plugin"` instances are currently registered but **not
subscribed to the SignalBus at runtime** (future-track work, see
`apps/bot/README.md` §9).

---

## 6. Operating recipes

### 6.1 Conservative book (BTC-only, 1-of-2 with low cap)

```toml
[symbols]
enabled = ["BTC/USDC"]

[strategies.donchian_pivot_composition]
enabled = true
cap = 0.10
min_consensus = 2
symbols = ["BTC/USDC"]

[strategies.dydx_cex_carry]
enabled = false    # disable cross-venue carry for this profile

[strategies.cascade_fade]
enabled = false    # disable satellite strategy
```

### 6.2 Aggressive book (full universe, 1-of-2 with high cap)

```toml
[symbols]
enabled = ["BTC/USDC", "ETH/USDC", "SOL/USDC"]

[strategies.donchian_pivot_composition]
enabled = true
cap = 0.20
min_consensus = 1    # loose: more trades
symbols = ["BTC/USDC", "ETH/USDC", "SOL/USDC"]

[strategies.dydx_cex_carry]
enabled = true
cap = 0.025
leverage = 10
notional_per_leg_usd = 125_000

[strategies.cascade_fade]
enabled = true
max_notional_per_event_usd = 1_000_000
cooldown_hours = 24
```

### 6.3 Custom (turn off the baseline, opt into the meta-plugin)

```toml
[strategies.donchian_pivot_composition]
enabled = false    # turn off the M15 baseline

[strategies.dydx_cex_carry]
enabled = true
cap = 0.025
notional_per_leg_usd = 100_000

[strategies.cascade_fade]
enabled = false

[strategies.regime_detector]
enabled = true    # opt in to the regime meta-plugin
# (currently registers but is not subscribed to the SignalBus at runtime —
#  see apps/bot/README.md §9 for the current limitation)
```

After every edit:

```bash
mm-bot config validate --config=path/to/your.toml
mm-bot strategies --config=path/to/your.toml
```

The `strategies` subcommand prints the exact on/off state and every
per-strategy override, so you can confirm the wire-up before starting
the bot.

---

## 7. Where to look next

- [`apps/bot/README.md`](../../apps/bot/README.md) — full operator guide
  (quick start, CLI ref, live testing workflow, architecture).
- [`run-bot/config/default.toml`](../../run-bot/config/default.toml) — canonical
  config (every field documented inline). Phase 52D: the default
  values are now the Phase 37 Track 5 production-template (Tokyo
  edge, USDC symbols, finomhangolt risk/timeout) — `mode = "paper"`
  failsafe kivételével.
- [`apps/bot/src/config/strategy-registry.ts`](../../apps/bot/src/config/strategy-registry.ts) — the factory.
- [`apps/bot/src/config/schema.ts`](../../apps/bot/src/config/schema.ts) — the Zod schema.
- [`packages/core/src/strategy/`](../../packages/core/src/strategy/) — strategy implementations.
- [`.mavis/notes/board.md`](../../.mavis/notes/board.md) — project board
  (Phase 33 closure section documents the full wire-up).
