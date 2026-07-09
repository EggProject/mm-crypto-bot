---
description: Phase 9+ scope plan v2 — UPDATED with Phase 8 V3 empirical results (2026-07-04 16:25). 6 candidates ranked, sequencing recommendations, open user decisions.
---

# Phase 9+ scope plan v2 (2026-07-04 16:30, updated post-V3)

**Trigger:** Phase 8 V3 landed at +5.28%/month AVG. +50% target = 9.5× gap. Documented in `backtest-results/REPORT-phase8.md` §1.

**Constraint envelope (UNCHANGED):**
- 1:10 leverage MANDATORY on ALL trades (vol-targeting scales DOWN only) — structural cap from 2026-07-04 14:17 directive
- bybit.eu SPOT-only (no margin futures), MiCAR EU scope
- ~30 months of OHLCV + funding history (single-exchange)
- Available capital: TBD by user (presume scalable for some candidates)

**Decision style:** User wants **agent ranks candidates, user does NOT pick**. Below is ranked by feasibility, not user-priority.

---

## Phase 8 baseline (V3 closed 2026-07-04 16:23)

| Symbol | V3 monthly | Sharpe | DD | Liquidations |
|--------|-----------:|-------:|---:|-------------:|
| BTC | +5.72% | -14.72 | 7.31% | 0 |
| ETH | +6.18% | +11.56 | 2.89% | 0 |
| SOL | +3.93% | -14.31 | 6.08% | 0 |
| **AVG** | **+5.28%** | — | 5.43% | 0 |

**Per-symbol composition (V3, FINAL):**
- BTC: D carry + G sizing (no F — leverage-fragile)
- ETH: D carry + E timing + F directional + G sizing (full stack)
- SOL: D carry + E timing + G sizing (no F — data regime fail)

---

## Candidate tracks (6 entries, ranked)

### 9D. SOL funding-flip kill-switch (P1, HIGHEST)

**Edge class:** Avoid the 3 negative SOL walk-forward folds (Folds 16/19/20, 2025-10-29 → 2026-03-28) by detecting funding-rate flip regimes early and pausing carry.
**Expected monthly lift:** +0.5-1% on top of V3 (captures full historical miss; current SOL V3 = +3.93%/mo so this would lift to ~+4.5-5%/mo).
**Implementation scope:**
- Track A: 7d rolling funding-rate sign detector (currentRate flips sign N times in 7d → flip regime)
- Track B: Funding-volatility z-score detector (currentRate > 1.5× rolling 30d σ → extreme regime)
- Track C: Carry-pause + ETH-direction-fallback wiring (when regime triggered, SOL leg reverts to Track F ETH-style filtering only when ETH shows aligned signal)

**Why first:** LOWEST hanging fruit. ~30 min producer task. Same code as Phase 8 Track E (FundingCarryTiming) + ~50 LOC extension. Highest plausibility per REPORT-phase8.md §8.

**Sources (5-10 queries planned):**
- CryptoQuant Axel Adler Jr "Funding Rate Regime Detection"
- arXiv 2512.12924 walk-forward methodology
- bybit.eu SPOT-margin maintenance margin dynamics
- Glassnode "Funding Rate Flip Regimes" 2025
- SSRN 5292305 (Leveraged BTC Funding Carry Algorithm)

**Realism check:** +0.5-1%/month realistic. Composite → +6-7%/month. Single-symbol play, fits 1:10 mandate.

---

### 9E. Adaptive Kelly × VolTarget hybrid (P1, synergy)

**Edge class:** Combine Phase 7 Track B (adaptive Kelly, 0.5× empirical cold-start) + Phase 8 Track G (vol-targeting defensive 45-59% DD reduction). Single position-sizing layer respecting both constraints with NO double-counting.
**Expected monthly lift:** +0.5-1% on top of V3.
**Implementation scope:**
- Track A: Position-sizing unit test framework (verify both constraints simultaneously)
- Track B: `AdaptiveKellyVolHybrid` class — takes (Kelly fraction, vol multiplier) → outputs effective position size
- Track C: Wire into V3 ensemble as drop-in replacement for current Track G sizing
- Track D: Backtest comparison: V3 with current G only vs V3 with hybrid (BTC/ETH/SOL)

**Why second:** Synergy of two existing tracks. ~2-3h producer task. Both inputs exist (Phase 7 Track B code, Phase 8 Track G code). Builds on proven infrastructure.

**Sources (5-10 queries planned):**
- Thorp "Kelly Criterion" 2006 paper
- Vince "Optimal Trading Portfolios" 2009
- Luenberger "Investment Science" ch 6 (Kelly and utility)
- Quek, Samble, Wang "Adaptive Kelly with Regime Filters" 2024

**Realism check:** +0.5-1%/month realistic. Composite → +6-7%/month. Doesn't move +50% but tightens envelope.

---

### 9A. Cross-exchange funding arbitrage (P2, structural)

**Edge class:** Funding rate differential between bybit.eu and binance.com (or bybit.com). Venue-funding divergence captures ~30% of the time (when prices de-sync on cross-listing).
**Expected monthly lift:** +1-3%/mo on top of V3 (extends Phase 8 Track D by capturing negative-funding-period opportunity costs).
**Implementation scope:**
- Track A: Add binance.com + bybit.com feed ingestion (3-5 days data setup)
- Track B: Funding-rate divergence detector (rolling 8h differential vs cross-exchange median)
- Track C: Execution routing (always-on basis between the lowest-funding venue and primary venue)
- Track D: Cross-exchange inventory risk hedging

**Why deferred:** Builds on Phase 8 Track D infra but needs new data sources + cross-exchange execution logic. ~2-3 days producer work. Higher scope than P1 candidates.

**Sources for bid (5-10 queries planned):**
- perp-DEX / cross-exchange funding rate literature (BIS WP1087, bybit.eu research)
- Grabovsky 2024 "Cross-Exchange Funding Rate Arbitrage"
- Amberdata / Coinalyze / Velo Data cross-venue funding dashboards
- bybit.eu + bybit.com funding rate history (verify pricing parity, NOT same venue)
- Regulatory: MiCAR EU on cross-venue basis trading
- Grabovsky 2024 sub-papers (latency arb vs funding arb)
- "Funding Rate Arbitrage in Crypto Markets" 2025 review

**Realism check:** +1-3%/month realistic. Composite → +7-9%/month. Venue-funding divergence is structural, NOT statistical.

---

### 9B. Options-vol selling (P2, new data source)

**Edge class:** Implied volatility surface — short-vol carry when IV > realized vol × 1.3 (premium seller mode). Long-vol continuation when IV < RV × 0.8 (spot momentum overlay).
**Expected monthly lift:** +2-4%/mo on top of V3 (largest P2 candidate).
**Implementation scope:**
- Track A: bybit.eu options chain ingestion (BTC options IV surface; ETH secondary)
- Track B: Realized-vs-implied vol ratio signal (extending Moreira-Muir vol-targeting)
- Track C: When IV > RV × 1.3 → premium seller mode (short straddle/strangle)
- Track D: When IV < RV × 0.8 → spot momentum continuation overlay
- Track E: Options leg integration with linear V3 (hedging overlay)

**Why deferred:** Documented in academic literature (Carr & Wu 2009, Coval & Shumway 2001). bybit.eu has options on BTC/ETH/SOL. NEW data source — ~2-3 days producer work. MiCAR EU has retail restrictions on options selling — bybit.eu offers some exemptions.

**Sources for bid:**
- Deribit DVOL research papers (Cboe/Cboe Europe)
- bybit.eu Options Trading whitepaper
- "Volatility-of-Volatility" regime signals (Bollerslev, Todorov, Xu 2024)
- Realized-vol vs IV timing backtests (Andreasen, Bondarenko 2023)
- bybit.eu Options MiCAR FAQ (retail restrictions)
- Black-Scholes vol-surface modeling (Hull chapter 18)

**Realism check:** +2-4%/month realistic (largest candidate). Composite → +8-10%/month with 9A included. Options data = ~3-5TB/year if 1m granularity.

---

### 9H. Cross-asset carry basket (P3, capital-intensive)

**Edge class:** Multi-asset funding carry basket (10-20 altcoins vs BTC/ETH). DOGE/NEAR/ARB historically 50-200% APR funding.
**Expected monthly lift:** +0.5-2%/mo on top of V3, **but requires 5-10× capital scale** to be material.
**Implementation scope:**
- Track A: bybit.eu perp universe extension (top-20 by volume + funding carry ratio)
- Track B: Per-symbol Kelly cap from Phase 7 Track B's adaptive Kelly
- Track C: Funding-rate correlation clustering for pair-hedging
- Track D: Multi-symbol ledger + cross-margin accounting

**Why deferred:** Requires more capital to scale (10-symbol basket at 1:10 = needs bigger book). Regulatory (MiCAR complexity for alts > top-10). Operational complexity (10 × work for code+monitor+incident response).

**Sources for bid:**
- Glassnode "Altcoin Funding Carry" research
- CoinGlass "Alt Season" funding dashboards
- bybit.eu altcoin perp ledger

**Realism check:** +0.5-2%/month realistic IF capital scales. DEFER until user confirms capital availability.

---

### 9F. Order-flow imbalance ML (P3, skeptical)

**Edge class:** ML direction signal from L2 orderbook + trade tape (5-15min horizon). LightGBM or small transformer.
**Expected monthly lift:** +0.3-1% on top of V3 (skeptical — likely < 0.5% realistic after fees + slippage + decay).
**Implementation scope:**
- Track A: L2 orderbook snapshot + trade-tape ingestion (binance.com websocket archive)
- Track B: Feature engineering (OBI, microprice, trade-flow imbalance, hawkes-process intensity)
- Track C: Gradient-boosted (LightGBM) or small transformer on 5/15min horizon
- Track D: Walk-forward with MONTHLY refit (avoid overfit — known failure mode for crypto ML)

**Why deferred:** Crypto ML signals have notorious decay curve. Most published alpha (Hopper, Polychain 2020) lasted < 6 months. Skeptical of academic retail sources.

**Sources for bid:**
- "Order-Flow Imbalance" literature (Cont, Kukanov, Stoikov 2023)
- Binance Research order-book microstructure reports
- "Crypto Market Microstructure" academic surveys (BIS 2024)

**Realism check:** Skeptical of > 0.5%/month after fees. Signal WILL decay. Composite → +8-10%/month. Defer until 9A, 9B ship + capital-constraints clear.

---

## Sequencing recommendation

### Phase 9 plan (my pick: P1 — high-plausibility, smallest scope)

**3 tracks in parallel + V4 integration:**
- **Track 9D.1**: SOL funding-flip kill-switch (Track E extension, ~30min)
- **Track 9D.2**: Adaptive Kelly × VolTarget hybrid (~2-3h)
- **Track 9D.3**: V4 ensemble integration (V3 + 9D.1 + 9D.2, ~1h)
- (M2): 3 baselines + REPORT-phase9.md (~2h)

**Total runtime:** ~3-4h. Expected outcome: V4 envelope +6-7%/month avg (+0.5-1% lift from 9D.1, +0.5-1% from 9D.2).

### Alternative Phase 9 plans

**Phase 9 P2 (medium scope, new data):**
- Track 9A.1: bybit.eu/binance.com cross-exchange funding-rate ingestion
- Track 9A.2: Funding-rate divergence detector
- Track 9A.3: Execution routing
- Track 9A.4: Cross-exchange inventory hedging
- Track 9B.1: bybit.eu options chain ingestion (BTC/ETH)
- Track 9B.2: IV-RV regime signal
- Track 9B.3: Premium seller mode integration
- (M2): V4 + cross-exchange options ensemble + REPORT-phase9.md

**Total runtime:** ~5-7 days producer work. Expected outcome: +7-9%/month avg.

**Phase 9 P3 (broad, 5 tracks):**
- 9D + 9E + 9A + 9B + 9F + V4. ~10 days producer work. Expected outcome: +8-10%/month avg.

---

## +50%/month strategic reality check (C5 always-on)

**What hasn't been tried:**
- $10M+ capital scale (10× current) — moves +0.5-1%/month via better execution + cross-asset basket
- Options market-making (different than options-vol selling — bid/ask spread harvest, requires co-located infra)
- Cross-venue Triangular Arb (BTC/ETH/USDT triangular across 3 venues simultaneously)
- Regulatory arbitrage (jurisdictional pricing differences — out of scope for retail MiCAR)
- **Co-located Tokyo AWS infra** (sub-10ms round-trip to bybit.eu Tokyo) — could 10× trade count

**If +50% is floor:** would require $50M+ capital, co-located infra, options market-making. Out of scope for current envelope. User would need to commit capital + scale.

**If +50% is aspiration:** realistic Phase 9-10 envelope is +8-10%/month. Phase 11+ may push to +12-15%/month via co-loc + options. **+50% remains aspirational for current envelope.**

---

## Open user decisions needed

1. **Phase 9 scope:** P1 (recommended — quick wins), P2 (medium — new data), P3 (broad — comprehensive), or different mix.
2. **Capital scale for 9H:** stay at current book or 5-10× larger for cross-asset basket?
3. **+50%/month framing:** floor (would require strategy pivot) or aspiration (current planning = +8-10%/month by Phase 10)?
4. **PR #16 status:** user-side merge of feat/phase8-v3-integration → main. Confirm before Phase 9 starts (we don't want race conditions with merge happening mid-plan).
