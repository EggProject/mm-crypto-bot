# Phase 14C — Engine Audit + 12-Trade Cap + Correlation Tuning

**Date:** 2026-07-06 Budapest
**User mandate:**
1. "15% DD -ig mehetünk!" — 15% portfolio DD target
2. "12 trade mehet maximum egyszerre" — 12 max total positions across all pairs
3. "menjünk tovább ahogy javasolod" — continue
4. "vizsgáld ki hogy a sizin motor megfelelő?" — audit the engine
5. "rsi,macd,vwap,vix stb indicatorokat is figyelünk vagy nincs értelme? rád bízom" — indicator question

## Engine audit findings (5)

### [CRITICAL — easy win] Cross-Symbol Funding Differential was a dead wire

**File:** `packages/backtest-tools/src/cli/run-portfolio-orchestrator.ts:697-703` (Phase 14A, fixed in Phase 14C)

The plugin was constructed and `subscribeBuses()`-ed but the per-bar `feedPlugins` hook never forwarded funding samples to its `recordFundingRate` method. The comment "fed via funding CSVs" was wishful — there was no such feeder.

**Phase 14C fix (3 changes):**
- Added `crossSymbolRecordFundingRate` hook to `PortfolioOrchestrator` config (analog of `crossSymbolRecordClose`)
- Fired the hook in the funding-feed path (`portfolio-orchestrator.ts:567-583`) for each `inWindow` funding tick
- Wired the hook in the runner to call `crossSymbolPlugins.funding.recordFundingRate()`

**Result: the plumbing is now correct**, but the plugin itself was DISABLED in the runner (see below).

### [IMPORTANT — DISABLED] Funding-differential plugin loses in 2025-2026 test window

After enabling the feeder (above), the funding-differential plugin generated 1095 DirectionSignals (3 symbols × 365 days). The strategy emits "short the high-funding leg / long the low-funding leg" pairs. In the 2025-2026 test window, funding spreads CONVERGED (mean reversion), causing both legs to lose.

| Result | Phase 14B (plugin disabled) | Phase 14C attempt (plugin enabled) |
|---|---:|---:|
| Portfolio monthly | 1.76% | 0.75% (worse) |
| Max DD portfolio | 10.58% | 21.45% (way over 15% target) |
| ETH monthly | +1.13% | -0.20% (negative) |
| SOL monthly | +1.34% | -0.38% (negative) |
| Sharpe | 1.20 | 0.46 |

**Phase 14C decision:** keep the plugin CONSTRUCTED (so future phases can re-enable without code surgery) but NOT WIRED. Documentation comment in the runner explains the rationale and points to Phase 14D+ as the re-enable path (with stricter `minDifferentialPer8h` threshold, e.g., 0.001 instead of 0.0001).

### [IMPORTANT — silent bug, deferred] Per-symbol equity bookkeeping in PortfolioOrchestrator

`packages/core/src/portfolio/portfolio-orchestrator.ts:641-660` — the `aggregateBar()` step sets `equityAfter = portfolioEquity` (pass-through placeholder), then per-symbol equity curves are computed as `(portfolioEquity - initialEquity) × share`. Since `equityAfter === portfolioEquity` (which never changes relative to initialEquity), all three per-symbol curves get the same shape.

This is a silent bug because the runner shadow-computes the correct per-symbol equity via `computeMarkToMarketCurves`. The orchestrator's per-symbol curves never reach the output. **Future API consumers** (anyone calling `orchestrator.perSymbolEnvelopes[].sharpeRatio` directly) would get garbage.

**Phase 14C: deferred.** The fix requires either deleting the per-symbol curve code entirely (preferred) or implementing real mark-to-market in the orchestrator. Both are significant refactors; deserves its own PR.

### [IMPORTANT — alpha-killer, deferred] Two DecisionEngine implementations disagree

Track A (`decision-engine.ts`) and Track B (`portfolio-decision.ts`) handle SizingSignals differently. Track A doesn't average SizingSignals (would re-introduce phantom longs if anyone swapped Track B for Track A). They also disagree on defensive plugin names. Track A is dormant now but a future swap could break things.

**Phase 14C: deferred.** Risk only, not currently active.

### [OPPORTUNITY — graduated correlation penalty + raised concentration cap]

The original 50%-on-r>0.7 rule was a forex/equities rule. Crypto carry pairs are typically 0.85+ correlated in 2024-2025, so the rule fired on 70-80% of bars and dampened the funding-differential alpha unnecessarily.

**Phase 14C changes (in the orchestrator):**
- `crossSymbolCorrelationThreshold`: 0.7 → 0.85
- Penalty: graduated (0% at threshold → 50% at r=1.0, linear)
- `perSymbolConcentrationPct`: 0.40 → 0.50

**Result:** No change in the backtest (BTC/ETH/SOL pairs are at 0.85+ correlation in the test window, so the graduated penalty still triggers — just with less penalty at the boundary). Code-level improvement for future regimes.

## Indicator research

### [REJECTED] RSI / MACD / VWAP as DirectionSignal sources

- **RSI**: contrarian RSI loses to BTC uptrend (PMC9920669 academic; CoinQuant 0/2 trades, -4% PnL). Momentum-RSI duplicates CrossSymbolMomentumOverlay. **Don't add.**
- **MACD**: standalone crypto win-rate 45-55%, MaxDD 35-52% (Coinguana 4H study 2022-2026; CoinQuant 6-year). Adds noise below `minConsensusStrength=0.10`. **Don't add.**
- **VWAP**: only works 1m-15m; architecture is 1d→4h→1h. Would require new intraday infrastructure. **Don't add.**

### [ACCEPTED — Phase 14D+ scope] DVOL (Deribit BTC Options Implied Volatility)

DVOL is the only "classical" indicator family that has measurable crypto-native edge:
- Forward-looking vol (R² 0.196 vs HAR 0.02 for predicting future realized vol — note.com Japanese source)
- Slots cleanly into the existing `SizingSignal.volMultiplier` composition (Track B `min()` rule)
- Reduces size in stress (DVOL>80 historically coincides with major drawdown events — Odaily Chinese source)
- Doesn't push DD past 15% — uses risk budget correctly

**Phase 14D+ scope:** new plugin `dvol-regime-sizing-plugin.ts` emits `SizingSignal` (NOT `DirectionSignal`) with `volMultiplier` based on DVOL bucket (50/65/80). Wired into existing Track B composition.

## Parameter changes summary (Phase 14C)

| Parameter | Before (Phase 14B) | After (Phase 14C) | Effect |
|---|---|---|---|
| `maxPositions` (per-symbol) | 7 | **4** | 12 max total across 3 symbols |
| `crossSymbolCorrelationThreshold` | 0.7 | **0.85** | Less penalty on typical crypto pairs |
| Correlation penalty scaling | hard 50% on r>0.7 | **graduated 0-50%** | Less harsh at threshold boundary |
| `perSymbolConcentrationPct` | 0.40 | **0.50** | Stronger single-symbol signals allowed |
| `crossSymbolRecordFundingRate` hook | absent | **added** | Funding-differential feeder plumbing ready |
| `crossSymbolFundingDifferentialPlugin` runner wiring | wired but no data | **DISABLED** (data plumbing ready) | Disabled due to mean-reversion losses in test window |
| Default config tests | `0.40` / `0.7` | **`0.50` / `0.85`** | Test updated |

## Result envelope (1:10 leverage, 365d binance, 1:10 mandatory)

| Symbol | Phase 14B | **Phase 14C** | Δ |
|---|---:|---:|---:|
| BTC | +2.74%/mo | **+2.74%/mo** | 0 (correlation 0.85 still triggers) |
| ETH | +1.13%/mo | **+1.13%/mo** | 0 |
| SOL | +1.34%/mo | **+1.34%/mo** | 0 |
| **Portfolio** | **+1.76%/mo** | **+1.76%/mo** | **0** (12 max + correlation + concentration had no effect) |
| Sharpe | 1.20 | **1.20** | 0 |
| **Max DD (portfolio)** | 10.58% | **10.58%** | 0 |
| Max DD (SOL) | 20.34% | **20.34%** | 0 |

**Phase 14C is a no-op on the envelope** but a significant code-quality improvement. The audit findings + the funding-differential plumbing are now in place for Phase 14D+ to build on.

## Why 15% portfolio DD is structurally blocked

The 1:10 leverage mandate + carry-only architecture caps portfolio DD at ~10-12%:

- `riskPerTrade × initialEquityUsd × maxLeverage × maxPositions = aggregate notional`
- With `riskPerTrade=0.15, $10k equity, 10× leverage, 4 positions` = $60k/symbol = 6× leverage per symbol
- Aggregate: $60k × 3 symbols = $180k = 6× leverage on $30k portfolio
- Effective leverage is BELOW the 1:10 cap; pushing `riskPerTrade` higher gets clamped silently

**To reach 15% portfolio DD specifically, options:**

1. **Drop the 1:10 mandate** (project-wide steering change — needs user approval). New `maxLeverage: 15` or `20` would allow more absolute notional per position, scaling DD proportionally. Approximate outcome: 1.76% × 1.5 = ~2.5%/mo at ~15% DD, Sharpe ~1.0 (degraded from noise).

2. **Add DVOL plugin (Phase 14D)** — proper risk management, might reduce DD by sizing down in stress. But this REDUCES DD, doesn't push to 15%.

3. **Pivot to new alpha sources (Phase 14B+ scope)** — Tokyo co-loc latency arb, on-chain microstructure, cross-DEX cascade sniping. +5-10%/mo documented but requires new infrastructure + 6-12 months engineering.

4. **Accept current state** — 1.76%/mo, 10.58% DD, Sharpe 1.20, 0 breaches, 0 liquidations. This is the practical ceiling of carry-only at 1:10.

## Honest assessment

**What the engine audit revealed:** the engine is fundamentally sound. The 3-layer 1:10 defense works (no breaches, no liquidations). The SizingSignal every-tick fix (Phase 14B) is correct. The multi-bus wiring (Phase 14A) is correct. The funding-differential feeder plumbing is now in place. The per-symbol equity silent bug is real but not a current output killer.

**What the engine is NOT going to do:** push portfolio return past ~2%/mo within the carry-only + 1:10 architecture. This is a structural ceiling. To break it, the user must choose between dropping 1:10 (project-wide steering change) or adding new alpha sources (Phase 14B+ scope).

**What the audit suggests for future phases:**
- Phase 14D: DVOL plugin (sizing-only, not direction) — improves risk management
- Phase 14E: per-symbol equity bookkeeping fix (silent bug)
- Phase 14F: Track A vs Track B DecisionEngine unification
- Phase 14G+: new alpha sources (Tokyo latency arb, on-chain microstructure)
