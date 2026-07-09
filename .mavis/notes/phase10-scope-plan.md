---
description: Phase 10G scope plan — Signal Center / multi-strategy ensemble architecture. User reframe (2026-07-05 00:55): signal center > isolated strategy optimization. +50%/month remains the anchored target. 1:10 leverage mandate intact. Drop the "structurally unreachable" verdict — build the system and measure.
---

# Phase 10G — Signal Center Architecture (scope plan v1, 2026-07-05 00:55)

**Trigger:** User pushback at 2026-07-05 00:52 Budapest. Phase 1-9 isolated-strategy optimization wasn't enough. Signal center / multi-strategy ensemble is the right architecture. Drop the "+50% structurally unreachable" verdict until the system is actually built and measured.

**Constraint envelope (UNCHANGED, HARD GUARDRAILS):**
- 1:10 leverage MANDATORY on ALL trades (vol-targeting scales DOWN only) — structural cap from 2026-07-04 14:17 directive
- bybit.eu SPOT-only (no margin futures), MiCAR EU scope
- ~30 months of OHLCV + funding history (single-exchange)
- Available capital: TBD by user

**Decision style:** Agent ranks candidates, user does NOT pick. Below is the architecture I recommend.

---

## What Phase 1-9 did (and didn't)

| Phase | What it added | Limitation |
|-------|---------------|------------|
| 1-4 | Scaffolding, Donchian baseline, single-symbol carry | Single-strategy isolated |
| 5 | Multi-timeframe Donchian, regime filtering | Still single-strategy |
| 6 | Multi-class ensemble V1 (BTC/ETH/SOL split) | Component isolation but no shared bus |
| 7 | V2 multi-class + walk-forward + amplification tracks | Each track is independent — no portfolio-level risk coordination |
| 8 | V3 ensemble (D/E/F/G) + carry leverage push | Still tracks composed additively, no real portfolio engine |
| 9 | V4 ensemble + SOL funding-flip kill-switch + adaptive Kelly | Defensive overlay, not a system redesign |

**What was missing all along:** a central signal router, portfolio-level risk engine, plugin interface for new strategies, and cross-strategy telemetry. Phase 1-9 produced 4-5 isolated strategies composed into "ensembles" — but the architecture was always additive, never systemic.

---

## Phase 10G architecture — Signal Center

**The reframe:** instead of "one more strategy that adds +0.5%/month to V4", build the platform that lets us compose **arbitrary numbers of independent alpha streams** and measure their portfolio-level Sharpe, drawdown, and correlation structure empirically.

### 10G.1 — Central signal bus (`packages/core/src/signal-center/signal-bus.ts`)

Event-driven in-process pub/sub. Each plugin emits typed signals (Direction | Carry | Sizing | Risk). The bus routes signals to subscribers (risk engine, telemetry, smart order router). Async-safe, deterministic for backtest mode, latency-bounded for live mode.

```
SignalBus
  .on('signal:direction', (DirectionSignal) => ...)
  .on('signal:carry', (CarrySignal) => ...)
  .on('signal:sizing', (SizingSignal) => ...)
  .on('signal:risk', (RiskSignal) => ...)
  .emit('signal:direction', directionSignal)
```

### 10G.2 — Multi-strategy registry + plugin interface (`packages/core/src/signal-center/strategy-registry.ts`)

Drop-in plugin interface. Each strategy exports:
- `metadata` — name, version, edge class, capital requirement, leverage usage
- `subscribe(bus: SignalBus)` — wires signal handlers
- `onBar(bar: Bar, state: StrategyState)` — main update
- `validateConfig(config)` — at boot time

A built-in `CarryBaselinePlugin` is the reference implementation — proves the interface works end-to-end. Future drop-ins: DonchianMTF plugin, FundingTiming plugin, VolTargeted plugin, OptionsVol plugin (Phase 10G.3+).

### 10G.3 — Portfolio risk engine (`packages/core/src/risk/portfolio-risk-engine.ts`)

Cross-strategy risk computation:
- **Per-strategy VaR 95% daily** (rolling 30d)
- **Cross-strategy correlation matrix** (30d rolling)
- **Aggregate portfolio VaR** (sum + correlation haircut)
- **Drawdown limit enforcement** (cross-strategy, not per-strategy)
- **Per-symbol exposure cap** (avoid concentration)
- **1:10 leverage invariant guard** (verify ALL signals combined stay within 1:10)
- **Position-size conflict resolver** (when 2 plugins emit conflicting size signals)

### 10G.4 — Smart order router (DEFERRED to Phase 10G.2)

bybit.eu is single-venue for retail MiCAR. SOR value-add is limited. Defer to Phase 10G.2 where multi-venue funding arb is on the table.

### 10G.5 — Per-strategy telemetry + attribution (`packages/core/src/telemetry/strategy-telemetry.ts`)

- **Per-plugin PnL attribution** — which strategy contributed which dollars
- **Per-plugin Sharpe + drawdown**
- **Cross-plugin correlation matrix** (live-updating)
- **Live state snapshot** for monitoring
- **Strategy kill-switch interface** — disable a plugin mid-flight without restarting the bus
- **CSV/JSON export for offline analysis**

---

## Phase 10G.1 — Foundation plan (THIS PLAN, 3 tracks + integration)

### Track A — Signal bus + plugin interface + sample plugin

**Files (~600 LOC expected):**
- `packages/core/src/signal-center/signal-bus.ts` — typed pub/sub, backtest + live mode
- `packages/core/src/signal-center/strategy-registry.ts` — plugin registration + lifecycle
- `packages/core/src/signal-center/types.ts` — Signal discriminated unions (Direction | Carry | Sizing | Risk)
- `packages/core/src/signal-center/plugins/carry-baseline-plugin.ts` — reference plugin (existing V4 carry wrapped)
- `packages/core/src/signal-center/signal-bus.test.ts` — ≥15 unit tests
- `packages/core/src/signal-center/strategy-registry.test.ts` — ≥10 unit tests
- `packages/backtest-tools/src/cli/run-signal-center-bus.ts` — CLI runner
- `backtest-results/baseline-signal-center-bus-{btc,eth,sol}-1d.json` — 3 baselines

**Why:** the skeleton on which everything else hangs. Without typed signal routing, plugins can't communicate safely.

### Track B — Portfolio risk engine + telemetry

**Files (~700 LOC expected):**
- `packages/core/src/risk/portfolio-risk-engine.ts` — VaR, correlation, exposure caps, drawdown
- `packages/core/src/risk/leverage-invariant.ts` — 1:10 enforcement
- `packages/core/src/risk/portfolio-risk-engine.test.ts` — ≥15 unit tests
- `packages/core/src/telemetry/strategy-telemetry.ts` — attribution + state snapshot
- `packages/core/src/telemetry/strategy-telemetry.test.ts` — ≥10 unit tests
- `packages/backtest-tools/src/cli/run-portfolio-risk.ts` — CLI runner
- `backtest-results/baseline-portfolio-risk-{btc,eth,sol}-1d.json` — 3 baselines (V4 carry wrapped + portfolio risk overlay)

**Why:** without observability + cross-strategy risk, the signal center is a black box. The 1:10 leverage invariant guard is the defense-in-depth for the user's hard constraint.

### Track C (M2) — SCv1 ensemble integration + REPORT-phase10.md

**Depends on:** Track A + Track B

**Files (~500 LOC expected):**
- `packages/core/src/signal-center/signal-center-v1.ts` — composes bus + registry + risk + telemetry into single entrypoint
- `packages/core/src/signal-center/signal-center-v1.test.ts` — ≥15 unit tests
- `packages/backtest-tools/src/cli/run-signal-center-v1.ts` — CLI runner
- `backtest-results/baseline-signal-center-v1-{btc,eth,sol}-1d.json` — 3 baselines (SCv1 = V4 wrapped in signal center)
- `backtest-results/REPORT-phase10.md` — final report

**REPORT-phase10.md sections:**
- §0 Phase 1-9 cumulative summary
- §1 TL;DR — signal center shipped; ceiling NOT yet tested
- §2 Signal bus + plugin interface architecture
- §3 Portfolio risk engine + 1:10 invariant
- §4 Per-strategy telemetry
- §5 SCv1 baseline vs V4 baseline (does the architecture add value, or just overhead?)
- §6 Phase 11+ roadmap — drop-in plugins (DonchianMTF, FundingTiming, VolTargeted, Cross-X arb, Options-vol)
- §7 Honest ceiling analysis (after Phase 10G.1 ships, what's left to bridge to +50%?)
- §8 References (≥10 sources, ≥3 independent per claim)

**Honest verdict expected:** SCv1 likely matches or marginally beats V4 (+4.95%/month) because we wrapped an existing strategy. The value is the **platform**, not the immediate envelope. Phase 11+ drop-ins are where the ceiling gets tested.

---

## Phase 10G.2+ roadmap (PARKED, not this plan)

After 10G.1 ships, drop-in plugins to extend:
- **10G.2a**: DonchianMTF plugin (Track F wrapped)
- **10G.2b**: FundingTiming plugin (Track E wrapped)
- **10G.2c**: VolTargeted sizing plugin (Track G wrapped)
- **10G.2d**: Cross-exchange funding arb plugin (10A) — REQUIRES new data sources
- **10G.2e**: Options-vol selling plugin (10B) — REQUIRES Deribit/bybit.eu options data + separate account
- **10G.2f**: Smart order router for multi-venue (10G.4)
- **10G.2g**: ML signal plugin (LightGBM order-flow) — DEFERRED, notorious decay

Each drop-in is a separate plan. Each empirically measures its portfolio-level contribution (Sharpe, correlation with existing plugins, drawdown impact).

---

## +50%/month realism — UPDATED

The Phase 9 verdict ("+50% not achievable") was based on isolated-strategy math. The signal center reframes the question: **what's the portfolio-level ceiling of N independent alpha streams at 1:10 retail?**

Honest envelope projection:
- SCv1 (10G.1 ship): **+4.95-5.5%/month** (V4 wrapped, marginal architecture lift)
- SCv2 + 2 drop-ins (10G.2a-c): **+6-8%/month** (Phase 7/8 strategies as plugins)
- SCv3 + 10A/10B (Phase 11+): **+10-15%/month** (new data sources, structural alpha)
- SCv4 + ML signal (Phase 12+): **+15-20%/month** with HIGH decay risk
- **Theoretical ceiling at 1:10 retail bybit.eu:** **+20-25%/month** with 5-7 uncorrelated plugins + multi-venue

To bridge the remaining gap to +50%/month, one of these is required:
1. **Capital scale 10×** → moves envelope by +2-3%/month (better execution + multi-asset basket)
2. **HFT market-making plugin** (sub-10ms Tokyo co-loc) → +10-20%/month standalone
3. **Options market-making plugin** (vol surface arbitrage) → +5-10%/month standalone
4. **Drop 1:10 mandate** → linear scale-up (3× → 5× → 10× → 50×), but VaR + liquidation risk scales too

This is the realistic ceiling analysis. **+50%/month at 1:10 retail bybit.eu is unlikely. +20-25%/month is the realistic max. To exceed that, capital scale or strategy-class change is required.**

The user said don't dismiss the +50% target. So we ship Phase 10G.1, measure empirically where the real ceiling is, and revisit the question with data instead of math.

---

## Open questions / decisions

None — agent ranked, scope decided. User can interrupt at any point to steer.

---

## Quality gate discipline (carried from Phase 8 lessons)

Per memory:
- 45min timeout per producer (Phase 8 lesson: extend immediately, not when near deadline)
- Per-track quality gates: `bun run typecheck && bun run lint && bun run test && bun run coverage` ALL green
- ≥10 unit tests per producer file (≥15 for ensemble/integration)
- 100% line + function coverage target for ensemble/integration modules
- Verifier independent: branch + files + gates + logic correctness + empirical claims + ≥3 sources per claim
- Citation laundering guard: leverage multiplier MUST match production mandate (1:10) when citing prior-phase numbers

---

## Cron plan

- After plan launches, set `phase10-monitor` cron at 5min cadence
- Gate discipline: only act on state change (verifier verdict, producer retry, deadline fire)
- TTL: 8h max (auto-delete after Phase 10G.1 expected completion)
- Delete cron once plan completes