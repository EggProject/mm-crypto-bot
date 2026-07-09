---
description: Phase 11.2+ roadmap scope plan — Cross-venue funding arb (11.2b), Options vol surface (11.2c-d), Basis trade (11.2e). NEW data sources required. DEFERRED to Phase 12+ until Phase 11.1 set lands empirical evidence.
---

# Phase 11.2+ — Cross-X + Options-vol + Basis extensions (scope plan, 2026-07-05 04:00)

**Trigger:** Phase 11.1 set scope plans + plan.yamls written. Phase 11.2 is the NEXT logical phase after 11.1 completes. This is a DEFERRED plan — only launchable after 11.1 has empirical evidence of +4.5-5.5%/mo envelope (not 11.1b alone).

**Why deferred (not launched after 11.1):**
- Phase 11.2b (CrossExchangeFundingArb) requires NEW data sources (multi-venue OHLCV)
- Phase 11.2c-d (Deribit options) requires Deribit options data + separate account
- Phase 11.2e (BasisTrade) requires spot+perp basis data
- These are MEDIUM-HIGH RISK (latency-budget dependent, exchange-specific edge cases)
- 11.1 set must land first to provide baseline for measuring 11.2 incremental lift

---

## What 11.2 delivers (overview)

**5 sub-phases, each a separate plan with own empirical validation:**

| Sub-phase | Plugin | Data Source | Expected Lift | Risk | Priority |
|-----------|--------|-------------|---------------|------|----------|
| 11.2a | RegimeDetectorMetaPlugin | existing | defensive | MEDIUM | HIGH |
| 11.2b | CrossExchangeFundingArbPlugin | bybit.eu + binance + okx | +1-3%/mo | HIGH (latency) | DEFER |
| 11.2c | DeribitDVOLShortVolPlugin | Deribit options | +0.5-2%/mo | HIGH | DEFER |
| 11.2d | OptionsRiskReversalPlugin | Deribit options | +0.5-1.5%/mo | HIGH | DEFER |
| 11.2e | BasisTradePlugin | bybit.eu spot+perp basis | +0.5-1%/mo | MEDIUM | MEDIUM |

**Combined 11.2 envelope (theoretical):** +5-8%/month total, depending on which sub-phases land.

---

## Sub-phase 11.2a — RegimeDetectorMetaPlugin (DEFENSIVE)

**Purpose:** Meta-plugin that detects market regime (trending / ranging / volatile) and adjusts other plugins' parameters dynamically.

**Validated by:** Phases 6-8 (regime filtering was a component but not as a separate plugin)

**Files (~600 LOC):**
- `packages/core/src/signal-center/plugins/regime-detector-meta-plugin.ts` (~400 LOC)
- `packages/core/src/signal-center/plugins/regime-detector-meta-plugin.test.ts` (~200 LOC)

**1:10 invariant:** 2-layer (Layers 1+2 only; meta-plugin emits RiskSignals, not SizingSignals).

**Expected effect:** defensive — reduces DD by 20-30% during regime shifts, no PnL change.

**Why HIGH priority:** defensive layer for 11.2 set; without it, the cross-X / options plugins are vulnerable to regime shifts.

---

## Sub-phase 11.2b — CrossExchangeFundingArbPlugin (DEFERRED)

**Purpose:** Captures funding-rate arbitrage between bybit.eu and binance/okx (when same coin has different funding rates, buy on lower, short on higher).

**Validated by:** Phase 8 (mentioned in REPORT §3) but not implemented.

**Data sources required:**
- bybit.eu OHLCV + funding (already have)
- binance OHLCV + funding (NEW)
- okx OHLCV + funding (NEW)
- Cross-venue latency measurement (NEW)

**Files (~800 LOC):**
- `packages/core/src/signal-center/plugins/cross-exchange-funding-arb-plugin.ts` (~500 LOC)
- `packages/core/src/signal-center/plugins/cross-exchange-funding-arb-plugin.test.ts` (~300 LOC)
- `packages/core/src/data/cross-venue-feed.ts` (~200 LOC)
- `packages/backtest-tools/src/cli/run-cross-exchange-arb.ts` (~120 LOC)
- `backtest-results/baseline-cross-exchange-arb-{btc,eth,sol}-1d.json` (3 files)
- `backtest-results/REPORT-phase11-2b.md` (~300 LOC)

**1:10 invariant:** 3-layer (Layers 1+2+3; per-venue exposure cap, aggregate exposure cap, latency-adjusted notional cap).

**Why DEFERRED:**
- Requires multi-venue data pipeline (binance + okx API integration)
- HIGH latency risk (cross-venue arb has ~50-200ms latency, requires HFT-grade infra)
- Capital scale: cross-X arb typically requires ≥$100k to be profitable (retail 1:10 doesn't scale)
- Estimated setup time: 2-3 weeks (not 1-2 hours like Phase 11.1)

**Capital requirement:** ≥$100k for retail-viable alpha; below that, fees eat the edge.

---

## Sub-phase 11.2c — DeribitDVOLShortVolPlugin (DEFERRED)

**Purpose:** Sells options volatility when Deribit's DVOL index is elevated (mean-reverting to historical median).

**Validated by:** Phase 8 (mentioned in REPORT §3) but not implemented; requires Deribit options data.

**Data sources required:**
- Deribit DVOL index (NEW — daily volatility index for BTC/ETH)
- Deribit options chain (NEW — strikes, expiries, IV surfaces)
- Separate Deribit account (not bybit.eu)

**Files (~1000 LOC):**
- `packages/core/src/signal-center/plugins/deribit-dvol-short-vol-plugin.ts` (~600 LOC)
- `packages/core/src/signal-center/plugins/deribit-dvol-short-vol-plugin.test.ts` (~400 LOC)
- `packages/core/src/data/deribit-feed.ts` (~300 LOC)
- `packages/backtest-tools/src/cli/run-deribit-dvol-short-vol.ts` (~150 LOC)
- `backtest-results/baseline-deribit-dvol-short-vol-{btc,eth}-1d.json` (2 files, NO SOL)
- `backtest-results/REPORT-phase11-2c.md` (~350 LOC)

**1:10 invariant:** 3-layer (Layers 1+2+3; notional = max_loss_at_strike × contracts × leverage).

**Why DEFERRED:**
- Requires Deribit API integration (separate exchange)
- Requires options pricing models (Black-Scholes + smile)
- HIGH risk: vol-selling has unlimited upside but limited downside (asymmetric)
- Capital scale: options vol-selling typically requires ≥$50k margin
- Estimated setup time: 3-4 weeks

**Per-symbol:** BTC + ETH only (Deribit has limited SOL options liquidity).

---

## Sub-phase 11.2d — OptionsRiskReversalPlugin (DEFERRED)

**Purpose:** Buys call + sells put (or vice versa) to express directional view with options-defined risk.

**Validated by:** Phase 8 (mentioned in REPORT §3) but not implemented.

**Files (~900 LOC):** similar structure to 11.2c.

**1:10 invariant:** 3-layer (Layers 1+2+3; net delta + vega exposure caps).

**Why DEFERRED:** same as 11.2c — Deribit API + options pricing + capital scale.

**Per-symbol:** BTC + ETH only.

---

## Sub-phase 11.2e — BasisTradePlugin (MEDIUM priority)

**Purpose:** Trades spot-vs-perp basis when it diverges from "carry-neutral" equilibrium (basis = funding_rate / 365 / perp_mark_interval).

**Validated by:** Phase 8 (carry strategies already trade basis) but not as a separate dedicated plugin.

**Data sources required:**
- bybit.eu spot + perp OHLCV + funding (already have)
- Per-second mark price for basis calculation (NEW)

**Files (~700 LOC):**
- `packages/core/src/signal-center/plugins/basis-trade-plugin.ts` (~450 LOC)
- `packages/core/src/signal-center/plugins/basis-trade-plugin.test.ts` (~250 LOC)
- `packages/backtest-tools/src/cli/run-basis-trade.ts` (~120 LOC)
- `backtest-results/baseline-basis-trade-{btc,eth,sol}-1d.json` (3 files)
- `backtest-results/REPORT-phase11-2e.md` (~250 LOC)

**1:10 invariant:** 3-layer (Layers 1+2+3; notional = basis × leverage, max notional cap per symbol).

**Why MEDIUM priority (not DEFERRED):**
- bybit.eu data already available (no new data source)
- Simpler than cross-X (single venue)
- Lower capital requirement (retail-viable at $10k)

**Expected effect:** +0.5-1%/month per symbol, defensive (basis converges, low tail risk).

---

## Phase 11.2 sequence (after Phase 11.1 lands)

1. **11.2a RegimeDetectorMetaPlugin** (defensive) — HIGH priority, single venue, no new data
2. **11.2e BasisTradePlugin** (alpha, single venue) — MEDIUM priority, no new data
3. **11.2b CrossExchangeFundingArbPlugin** (alpha, multi-venue) — DEFERRED, requires new data
4. **11.2c DeribitDVOLShortVolPlugin** (alpha, options) — DEFERRED, requires Deribit
5. **11.2d OptionsRiskReversalPlugin** (alpha, options) — DEFERRED, requires Deribit

**Combined 11.2a + 11.2e envelope:** +0.5-1%/month alpha + 20-30% DD reduction
**Combined 11.2a + 11.2b + 11.2e envelope:** +1.5-4%/month alpha + 20-30% DD reduction
**Combined 11.2a + 11.2b + 11.2c + 11.2d + 11.2e envelope:** +2-5%/month alpha + 20-30% DD reduction

**Phase 11.1 + 11.2 combined envelope:** +5-7%/month HIGH confidence, 9-11× short of +50%/mo.

**Phase 12+ (out of retail envelope):** HFT market-making + Tokyo co-loc + capital scale 10× → +12-18%/month, but breaks retail envelope.

---

## Constraint envelope (UNCHANGED, HARD GUARDRAILS)

- 1:10 leverage MANDATORY on all trades (vol-targeting scales DOWN only)
- bybit.eu SPOT-only primary venue (cross-X requires explicit multi-venue configuration)
- MiCAR EU scope (Deribit options require non-EU regulatory review — DEFER)

---

## Open questions

1. **Capital scale for cross-X arb:** retail-viable at $10k? Or requires ≥$100k?
   - Recommendation: defer until Phase 11.1 lands + capital scale decision made
2. **Deribit account setup:** when? who pays? regulatory?
   - Recommendation: defer indefinitely (out of MiCAR retail scope)
3. **Basis trade data:** is per-second mark price available in existing OHLCV?
   - Recommendation: check bybit.eu API docs in Phase 11.2e pre-flight

---

## Phase 11.2 scope plans status

| Sub-phase | Scope plan | Plan YAML | Ready to launch |
|-----------|-----------|-----------|-----------------|
| 11.2a | NOT WRITTEN | NOT WRITTEN | after Phase 11.1 set |
| 11.2b | NOT WRITTEN | NOT WRITTEN | after Phase 11.1 set + capital decision |
| 11.2c | NOT WRITTEN | NOT WRITTEN | DEFER (Deribit) |
| 11.2d | NOT WRITTEN | NOT WRITTEN | DEFER (Deribit) |
| 11.2e | NOT WRITTEN | NOT WRITTEN | after Phase 11.1 set |

**Will write scope plan + plan.yaml for 11.2a and 11.2e after Phase 11.1 lands** (the 2 single-venue, no-new-data sub-phases). 11.2b/c/d deferred until capital scale decision.
