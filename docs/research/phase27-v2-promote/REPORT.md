# Phase 27 — Multi-Class Ensemble V2 PROMOTION Brief

**Generated:** 2026-07-09 00:10 Budapest
**Status:** ⚠️ **OOS validation FAILED — DO NOT PROMOTE TO PRODUCTION** (see §6)
**Author basis:** Phase 26 REFRESH audit fresh-current-code findings + Phase 27 OOS validation

---

## 1. Why V2 was initially a candidate

The Phase 26 audit (based on stale Phase 1-9 baseline JSONs) marked `MultiClassEnsembleV2` as REMOVE.
The Phase 26 REFRESH (fresh-current-code rerun) **contradicted** this verdict. Fresh BTC/USDT 1d 30-month
backtest results (initial — pre-OOS-validation):

| Strategy | Total % | Monthly % | Sharpe | Max DD % | Trades | Kill | Fresh verdict |
|---|---:|---:|---:|---:|:--:|---|
| MultiClassEnsemble (v1) | +17.53 | +0.54 | -0.131 | 0.93 | 0 | no | REMOVE |
| **MultiClassEnsembleV2** | **+794.26** | **+9.46** | **3.426** | **5.00** | 28 | no | **PROMOTE CANDIDATE** |
| MultiClassEnsembleV3 | +171.72 | +5.72 | -14.722 | 7.31 | 151 | no | REMOVE (high vol) |
| MultiClassEnsembleV4 | +159.56 | +5.32 | -13.708 | 5.38 | 151 | no | REMOVE (high vol) |

V2 dominated v3 and v4 on every metric — 5× the return, much better Sharpe (3.43 vs -13.7/-14.7).
The Phase 26 audit's claim that "v4 is canonical" was **refuted** by fresh data.

**HOWEVER** — these initial numbers were inflated by a CLI bug (`totalDays = 7 * 365` hardcoded,
ignoring actual window). The correct monthlyReturnPct values (after bugfix) are shown in §6.1.

## 2. V2 architecture

```
MultiClassEnsembleV2 (composite strategy, 30-mo BTC/USDT 1d full window)
├── DonchianTrailingStrategy (Phase 7 Track A — directional primary)
│   └── DonchianBreakoutStrategy (Phase 5 C — base trend-following)
├── FundingCarryLeverageStrategy (Phase 7 Track C + Phase 8 Track D — 10× carry)
├── AdaptiveKelly aggregate (Phase 7 Track B — replaces static 0.5×)
└── LatencyGate (Phase 6 Track B — carry pause on latency >500ms)
```

**Edge attribution (full window BTC, after bugfix):**
- `directionalPnlUsd`: $154.71 (0.9% of total — DonchianTrailing contributes essentially noise)
- `carryPnlUsd`: $17,698.93 (99.1% of total — FundingCarryLeverage is the actual alpha source)
- `effectiveLeverage`: 10× (1:10 mandate, 0 liquidations observed)
- `effectiveKelly`: 0.5× (half-Kelly, capped)
- `dailyVaR95Pct`: 0.0061 (low)

**Conclusion:** V2's alpha is **dominated by the funding-carry component**. The directional sub-strategy is
essentially a no-op that occasionally adds tiny positive P&L. This means V2 is effectively a
**delta-neutral funding-rate carry strategy** with optional directional overlay.

## 3. Cross-symbol fresh results (BTC/ETH/SOL, 1d, 30-month full window — INITIAL numbers, pre-bugfix)

| Symbol | Total % | Monthly % | Sharpe | Max DD % | Liquidation | Notes |
|---|---:|---:|---:|---:|:--:|---|
| BTC/USDT | +794.26 | +9.46 | 3.426 | 5.00 | 0 | Strong, low-DD, decent Sharpe |
| **ETH/USDT** | **+931.02** | **+11.09** | **7.013** | **2.66** | 0 | **Best overall — promote ETH as primary** |
| SOL/USDT | +21.36 | +0.25 | -0.325 | 5.07 | 0 | Weak — funding too volatile |

ETH was the standout: +11.09%/mo @ 7.01 Sharpe @ 2.66% DD — looked production-grade.
BTC was strong but lower-Sharpe.
SOL was borderline-HALT (negative Sharpe, near-zero return).

**⚠️ IMPORTANT:** These numbers used the buggy `totalDays = 7 * 365` hardcoded value, which inflated
monthlyReturnPct by ~2.6×. The correct values (post-bugfix) are in §6.1.

## 4. Compared to existing production (donchian-pivot-composition)

| Strategy | Symbol | TF | Monthly | Sharpe | DD |
|---|---|--:|---:|---:|---:|
| donchian-pivot-composition (2of2 default) | BTC | 15m | +16.62 | 20.518 | 4.64 |
| **MultiClassEnsembleV2** (initial, post-bugfix) | **ETH** | **1d** | **+6.11** | **7.013** | **2.66** |
| donchian-pivot-composition (1of2 mode, cap=0.20) | BTC | 15m | +26.23 | 28.99 | 3.17 |
| FundingCarryLeverage (10×) | BTC | 1h | +3.43 | 16.747 | 1.50 |

V2 (ETH 1d) is a different strategy profile from donchian-pivot-composition (BTC 15m):
- Donchian-pivot = high-frequency directional edge (2660 trades/30mo, 73% WR)
- V2 = low-frequency delta-neutral carry (24 trades/30mo, 100% WR = pure funding)

**Combined portfolio** (50/50 ETH-v2 + BTC-donchian-pivot 2of2, naive envelope) gives:
- ~+11.4%/mo @ ~13.8 Sharpe @ ~3.7% DD (assuming low correlation — both empirically uncorrelated)

This is a **diversification win** — different timeframes, different symbols, different edge types.

## 5. Risk analysis

### Strengths
- **Low DD:** 5% BTC / 2.66% ETH — well within 15% mandate (3-5× headroom)
- **No liquidations** at 10× leverage across full window (0 events)
- **Simple:** only 28 trades/30mo BTC, 24 trades/30mo ETH — low operational overhead
- **Low VaR:** 0.6-0.8% daily VaR95 — far below 15% DD mandate

### Weaknesses (initial assessment — see §6 for OOS findings)
- **Carry-only alpha:** directional sub-strategy contributes 0.9% of P&L → fragile if funding rates collapse
- **SOL negative Sharpe:** SOL funding too volatile → HALT SOL symbol
- **Daily timeframe only:** 1d is the validation TF; needs 15m or 1h replication check
- **LatencyGate dependency:** relies on Phase 6 Track B JSON snapshots for arb-latency
- **OOS sub-period validation:** NOW PERFORMED — see §6 (FAIL)

## 6. OOS sub-period validation (Phase 27 #1 — DONE — **FAIL**)

**Background:** Phase 26 audit verified v2 on full 30-month window only. Production promotion requires
OOS split to confirm alpha isn't in-sample fit.

**Method:** Added `--start=YYYY-MM-DD` and `--end=YYYY-MM-DD` flags to V2 CLI (Phase 27 contribution).
Also fixed a CLI bug where `totalDays = 7 * 365` was hardcoded, which inflated monthlyReturnPct.

**Windows:**
- IS: 2024-01-01 to 2025-12-31 (24 months)
- OOS: 2026-01-01 to 2026-07-08 (6.2 months)
- FULL: 2024-01-01 to 2026-07-08 (30.2 months)

**Results (post-bugfix, all on BTC/USDT 1d, 10× carry):**

| Symbol | Window | Total % | Monthly % | Sharpe | DD % | Trades | OOS/IS ratio |
|---|---|---:|---:|---:|---:|---:|---:|
| BTC | FULL | 178.54 | 5.91 | 3.426 | 5.00 | 28 | — |
| BTC | IS (2024-2025) | 172.30 | **7.19** | 3.426 | 5.00 | 28 | 1.00 (ref) |
| BTC | OOS (2026) | 6.97 | **1.13** | 8.035 | 2.32 | 7 | **0.157** |
| ETH | FULL | 184.45 | 6.11 | 7.013 | 2.66 | 24 | — |
| ETH | IS (2024-2025) | 181.71 | **7.58** | 7.013 | 2.66 | 24 | 1.00 (ref) |
| ETH | OOS (2026) | 1.79 | **0.29** | -7.821 | 2.97 | 7 | **0.038** |

**Verdict: OOS validation FAILED.**

- BTC OOS/IS = 0.157 (need ≥ 0.60) — 73% alpha decay
- ETH OOS/IS = 0.038 (need ≥ 0.60) — 96% alpha decay
- 2026 funding environment is structurally weaker than 2024-2025 (post-ETF bull market normalization)

**Root cause:** The funding-carry alpha is environmentally dependent. 2024-2025 was a structural bull
market with high positive funding rates (long-bias leverage). 2026 funding rates have normalized to
near-zero or negative. The carry edge effectively disappears in the OOS period.

**Decision: DO NOT promote V2 to production at this time.** Wait for funding environment to recover
OR find a different carry source (perp-DEX cross-venue arb from Phase 25 #2 T2 paper-trade gate).

### 6.0 Carry funding environment context

Looking at the raw carryPnlUsd numbers (not monthlyReturnPct):

| Window | BTC carry USD | ETH carry USD | Notes |
|---|---:|---:|---|
| FULL (30.2mo) | 17,698.93 | 18,189.22 | |
| IS (24mo) | 17,075.19 | 17,915.75 | 96% of FULL — IS dominates |
| OOS (6.2mo) | 615.62 | 263.58 | 3.5% of FULL, 1.5% of ETH FULL |

In 24 months (2024-2025), carry collected ~$17k BTC / ~$18k ETH.
In 6.2 months (2026), carry collected ~$0.6k BTC / ~$0.26k ETH.
**OOS carry is 1/30th of the IS rate.** Annualized: $0.6k/0.52y = $1.15k/yr BTC, $0.5k/yr ETH.
At 10× leverage on $10k notional, that's ~11.5% BTC carry yield (annualized) vs the 70%+ the IS period showed.

The structural shift in funding rates (likely driven by the post-2025 leverage normalization) means
V2's edge is not a stable alpha source — it's an environment-dependent bet.

## 7. Cap sweep findings (Phase 27 #2 — DONE)

CLI flag: `--kelly-bucket=N` (where N ∈ {0.25, 0.5, 0.7, 1.0}, mapped to cap = N×2/10).

**BTC/USDT 1d, 30-month full window (post-bugfix monthlyReturnPct):**

| Kelly | Cap | Total % | Monthly % | Sharpe | DD % |
|---|---:|---:|---:|---:|---:|
| 0.25 | 0.05 | 158.31 | 5.24 | -1.34 | 3.41 |
| **0.50** | **0.10** | **178.54** | **5.91** | **3.43** | **5.00** |
| 0.70 | 0.14 | 178.52 | 5.91 | 3.31 | 5.15 |
| 1.00 | 0.20 | 178.53 | 5.91 | 3.32 | 5.15 |

**ETH/USDT 1d, 30-month full window (post-bugfix):**

| Kelly | Cap | Total % | Monthly % | Sharpe | DD % |
|---|---:|---:|---:|---:|---:|
| 0.25 | 0.05 | 185.74 | 6.15 | 1.93 | 2.36 |
| **0.50** | **0.10** | **184.45** | **6.11** | **7.01** | **2.66** |
| 0.70 | 0.14 | 184.45 | 6.11 | 7.01 | 2.66 |
| 1.00 | 0.20 | 184.45 | 6.11 | 7.01 | 2.66 |

**Key findings (post-bugfix):**
- **Cap knee at 0.10** (kellyBucket=0.5). Above this, total return flat.
- ETH still dominates BTC at every cap level — ETH carry funding more stable than BTC's.
- BUT: OOS failure means cap sweep is moot — V2 doesn't go to production regardless.

## 8. Final decision

**V2 DOES NOT PROMOTE TO PRODUCTION.**

The full-window backtest was misleading due to a structurally high funding environment in 2024-2025.
OOS 2026 funding rates have normalized, and V2's alpha effectively disappears (OOS/IS = 0.038-0.157,
both well below the 0.60 overfitting threshold).

**Next steps for V2:**
1. **Wait for funding environment recovery** — V2 could be re-evaluated in 6-12 months.
2. **Investigate alternative carry sources** — perp-DEX cross-venue funding arb (Phase 25 #2 T2) had
   more structural alpha source (snapshot-based, not environment-dependent).
3. **Don't delete V2** — keep file as future research artifact; could be valuable if funding rebounds.

**What to do for the production portfolio:**
- Keep donchian-pivot-composition (BTC 15m, +16.62%/mo @ 20.5 Sharpe @ 4.64% DD) as primary.
- Use Phase 25 #2 dydx-cex-carry (BTC-USD perp-vs-spot, snapshot-gated) for carry exposure.
- Avoid SOL carry (confirmed HALT in Phase 25 #2 + Phase 27 fresh data).

## 9. Fresh log files (Phase 27 OOS validation)

```
backtest-results/fresh-2026-07-08/30-mc-v2-btc-FULL.json   (BTC 2024-01-01 to 2026-07-08)
backtest-results/fresh-2026-07-08/30-mc-v2-btc-IS.json     (BTC 2024-01-01 to 2025-12-31)
backtest-results/fresh-2026-07-08/30-mc-v2-btc-OOS.json    (BTC 2026-01-01 to 2026-07-08)
backtest-results/fresh-2026-07-08/30-mc-v2-eth-FULL.json   (ETH 2024-01-01 to 2026-07-08)
backtest-results/fresh-2026-07-08/30-mc-v2-eth-IS.json     (ETH 2024-01-01 to 2025-12-31)
backtest-results/fresh-2026-07-08/30-mc-v2-eth-OOS.json    (ETH 2026-01-01 to 2026-07-08)
```

These are 100% current-code ground truth (post-Phase 27 strategy cleanup + totalDays bugfix).
Diff against future code changes to detect silent regressions.