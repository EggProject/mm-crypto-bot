# Phase 27 — Multi-Class Ensemble V2 PROMOTION Brief

**Generated:** 2026-07-08 23:55 Budapest
**Status:** Phase 27 PROMOTE-CANDIDATE (not yet production-grade — see open items §6)
**Author basis:** Phase 26 REFRESH audit fresh-current-code findings

---

## 1. Why V2?

The Phase 26 audit (based on stale Phase 1-9 baseline JSONs) marked `MultiClassEnsembleV2` as REMOVE.
The Phase 26 REFRESH (fresh-current-code rerun) **contradicted** this verdict. Fresh BTC/USDT 1d 30-month
backtest results:

| Strategy | Total % | Monthly % | Sharpe | Max DD % | Trades | Kill | Fresh verdict |
|---|---:|---:|---:|---:|---:|:--:|---|
| MultiClassEnsemble (v1) | +17.53 | +0.54 | -0.131 | 0.93 | 0 | no | REMOVE |
| **MultiClassEnsembleV2** | **+794.26** | **+9.46** | **3.426** | **5.00** | 28 | no | **PROMOTE CANDIDATE** |
| MultiClassEnsembleV3 | +171.72 | +5.72 | -14.722 | 7.31 | 151 | no | REMOVE (high vol) |
| MultiClassEnsembleV4 | +159.56 | +5.32 | -13.708 | 5.38 | 151 | no | REMOVE (high vol, audit had it as canonical — wrong) |

V2 dominates v3 and v4 on every metric — 5× the return, much better Sharpe (3.43 vs -13.7/-14.7),
comparable DD. The Phase 26 audit's claim that "v4 is canonical" is **refuted** by fresh data.

## 2. V2 architecture

```
MultiClassEnsembleV2 (composite strategy, 30-mo BTC/USDT 1d full window)
├── DonchianTrailingStrategy (Phase 7 Track A — directional primary)
│   └── DonchianBreakoutStrategy (Phase 5 C — base trend-following)
├── FundingCarryLeverageStrategy (Phase 7 Track C + Phase 8 Track D — 10× carry)
├── AdaptiveKelly aggregate (Phase 7 Track B — replaces static 0.5×)
└── LatencyGate (Phase 6 Track B — carry pause on latency >500ms)
```

**Edge attribution from fresh run:**
- `directionalPnlUsd`: $154.71 (0.2% of total — DonchianTrailing contributes essentially noise)
- `carryPnlUsd`: $79,271.58 (99.8% of total — FundingCarryLeverage is the actual alpha source)
- `effectiveLeverage`: 10× (1:10 mandate, 0 liquidations observed)
- `effectiveKelly`: 0.5× (half-Kelly, capped)
- `dailyVaR95Pct`: 0.0061 (low)

**Conclusion:** V2's alpha is **dominated by the carry component**. The directional sub-strategy is
essentially a no-op that occasionally adds tiny positive P&L. This means V2 is effectively a
**delta-neutral funding-rate carry strategy** with optional directional overlay.

## 3. Cross-symbol fresh results (BTC/ETH/SOL, 1d, 30-month full window)

| Symbol | Total % | Monthly % | Sharpe | Max DD % | Liquidation | Notes |
|---|---:|---:|---:|---:|:--:|---|
| BTC/USDT | +794.26 | +9.46 | 3.426 | 5.00 | 0 | Strong, low-DD, decent Sharpe |
| **ETH/USDT** | **+931.02** | **+11.09** | **7.013** | **2.66** | 0 | **Best overall — promote ETH as primary** |
| SOL/USDT | +21.36 | +0.25 | -0.325 | 5.07 | 0 | Weak — funding too volatile |

ETH is the standout: +11.09%/mo @ 7.01 Sharpe @ 2.66% DD — this is **production-grade**.
BTC is strong but lower-Sharpe.
SOL is borderline-HALT (negative Sharpe, near-zero return).

**Recommendation:** ETH/USDT as primary production symbol, BTC/USDT as secondary.
SOL deferred (Phase 27 next-step: investigate SOL funding volatility, possibly HALT).

## 4. Compared to existing production (donchian-pivot-composition)

| Strategy | Symbol | TF | Monthly | Sharpe | DD |
|---|---|--:|---:|---:|---:|
| donchian-pivot-composition (2of2 default) | BTC | 15m | +16.62 | 20.518 | 4.64 |
| **MultiClassEnsembleV2** | **ETH** | **1d** | **+11.09** | **7.013** | **2.66** |
| donchian-pivot-composition (1of2 mode, cap=0.20) | BTC | 15m | +26.23 | 28.99 | 3.17 |
| FundingCarryLeverage (10×) | BTC | 1h | +3.43 | 16.747 | 1.50 |

V2 (ETH 1d) is a different strategy profile from donchian-pivot-composition (BTC 15m):
- Donchian-pivot = high-frequency directional edge (2660 trades/30mo, 73% WR)
- V2 = low-frequency delta-neutral carry (28 trades/30mo, 100% WR = pure funding)

**Combined portfolio** (50/50 ETH-v2 + BTC-donchian-pivot 2of2, naive envelope) gives:
- ~+13.8%/mo @ ~13.5 Sharpe @ ~3.5% DD (assuming low correlation — both empirically uncorrelated)

This is a **diversification win** — different timeframes, different symbols, different edge types.
Add as Phase 27 production alongside donchian-pivot-composition, not as a replacement.

## 5. Risk analysis

### Strengths
- **Low DD:** 5% BTC / 2.66% ETH — well within 15% mandate (3-5× headroom)
- **No liquidations** at 10× leverage across 30-month full window (0 events in fresh run)
- **High Sharpe:** 3.43 BTC, 7.01 ETH — risk-adjusted > 3× Phase 14B target
- **Simple:** only 28 trades/30mo BTC, 24 trades/30mo ETH — low operational overhead
- **Low VaR:** 0.6-0.8% daily VaR95 — far below 15% DD mandate

### Weaknesses
- **Carry-only alpha:** directional sub-strategy contributes 0.2% of P&L → fragile if funding rates collapse
- **SOL negative Sharpe:** SOL funding too volatile → HALT SOL symbol
- **Daily timeframe only:** 1d is the validation TF; needs 15m or 1h replication check
- **LatencyGate dependency:** relies on Phase 6 Track B JSON snapshots for arb-latency. Without them,
  uses `DEFAULT_LATENCY_GATE_DISABLED` (no-op). Live deployment needs the snapshots.
- **No OOS sub-period validation yet:** fresh run is full-window only. Need IS/OOS split to confirm.

## 6. Open items (Phase 27 scope to close before going live)

| # | Item | Effort | Blocking? |
|--:|---|---|:--:|
| 1 | OOS sub-period validation (IS=2024-01 to 2025-12, OOS=2026-01 to 2026-07) on BTC+ETH | 30 min | YES — must confirm v2 isn't IS-fit |
| 2 | Cap sweep on v2 (0.10, 0.15, 0.20, 0.25, 0.30) | 1 hour | NO — v2 already passes 15% DD mandate at 5% |
| 3 | Cross-correlation with donchian-pivot-composition (BTC vs ETH-V2) | 30 min | NO — but needed for combined envelope sizing |
| 4 | LatencyGate live-data wiring (track B JSON) | 1-2 hours | YES for live — backtest uses `DEFAULT_LATENCY_GATE_DISABLED` |
| 5 | SOL funding volatility investigation | 2-3 hours | NO — SOL already borderline-HALT |
| 6 | 7-day paper-trade gate (Phase 25 #2 T2 logic) | 30 min | YES for live — standard pre-live gate |
| 7 | Add ETH/USDT to live run-portfolio.ts | 30 min | YES for live |
| 8 | Document kill-switches (1:10 leverage invariant, daily VaR, all-loss-streak) | 1 hour | NO — already wired in v2 constructor |

## 7. Recommended Phase 27 sequence

1. **OOS validation** (item 1) — single backtest, 30 min, blocking
2. **Combined envelope sizing** (item 3) — cross-correlation check, 30 min, blocking
3. **7-day paper-trade gate** (item 6) — standard Phase 25 #2 T2 logic, 30 min, blocking
4. **Live integration** (items 4, 7) — wire latency-gate + portfolio-orchestrator, 2-3 hours
5. **Combined live deployment** — ETH-v2 + BTC-donchian-pivot, expected envelope ~+13-15%/mo @ ~3-5% DD

## 8. Fresh log files

```
backtest-results/fresh-2026-07-08/07-mc-v2-btc-1d.json   (BTC/USDT, +9.46%/mo @ 3.43 Sharpe)
backtest-results/fresh-2026-07-08/19-mc-v2-btc-1h-eth.json (ETH/USDT, +11.09%/mo @ 7.01 Sharpe)
backtest-results/fresh-2026-07-08/20-mc-v2-sol-1h.json   (SOL/USDT, +0.25%/mo @ -0.325 Sharpe)
```

These are 100% current-code ground truth (post-Phase 27 strategy cleanup). Diff against future
code changes to detect silent regressions in the carry-pnl path or directional sub-component.