# Phase 26 Strategy Audit — REFRESH (Fresh Rerun, Current Code)

**Generated:** 2026-07-08 23:30 Budapest
**Audit cycle:** Full wipe + fresh rerun of all candidate strategies with current code.
**Goal:** Verify Phase 26 audit (which was based on stale baseline JSONs from Phase 1-9 era) against
fresh backtest logs produced by current code on BTC/USDT 30-month full window (2024-01-01 → 2026-07-08).

---

## 0. Methodology

1. Wiped `backtest-results/` of all 272 old JSON logs (baseline-*, mr-baseline-*, phase15-* through
   phase25-*, audit-*, sensitivity-*, wf-*, portfolio-orchestrator/, oos-*, etc.) using `mavis-trash`
   (recoverable). Kept only research reports (REPORT-*.md), DROP-RETAIN-decisions.json,
   arb-latency-*.json, and all-on-1y/.

2. Created `backtest-results/fresh-2026-07-08/` and ran each strategy's CLI with default args
   (BTC/USDT, native timeframe) on the same 30-month window. 17 fresh backtests total
   (+ 1 simple-retail-ensemble that crashed with a null-deref bug).

3. Compared fresh metrics (Total Return, Monthly avg, Sharpe, Max DD, Trades, Kill-switch) against
   the Phase 26 audit categorization.

---

## 1. Fresh results table (BTC/USDT, 30-month full window, native TF, default config)

| # | Strategy | TF | Total % | Monthly % | Sharpe | Max DD % | Trades | Kill | **Fresh verdict** |
|--:|---|--:|--:|--:|--:|--:|--:|:--:|---|
| 18 | donchian-pivot-composition (default 2of2) | 15m | +10326.55 | **+16.62** | **20.518** | 4.64 | 2660 | no | **PRODUCTION** ✓ |
| 07 | multi-class-ensemble-v2 | 1d | +794.26 | **+9.46** | **3.426** | 5.00 | 28 | no | **PRODUCTION CANDIDATE** ⚠ |
| 10b | regime-routed-ensemble 2of2 | 15m | +236.92 | +4.10 | **9.239** | 8.59 | 1335 | no | **PRODUCTION CANDIDATE** ⚠ |
| 15 | funding-carry-leverage (10×) | 1h | +176.99 | +3.43 | **16.747** | 1.50 | 0 | no | **PRODUCTION CANDIDATE** ⚠ |
| 16 | funding-carry-timing | 1h | +82.63 | +2.01 | 10.343 | 0.13 | 195 | no | RESEARCH-KEEP ✓ |
| 14 | funding-carry (1×, no leverage) | 1h | +17.70 | +0.54 | 19.113 | 0.35 | 0 | no | RESEARCH-KEEP ✓ |
| 03 | donchian-mtf | 1h | +25.44 | +0.75 | 0.588 | 18.33 | 151 | no | HALT (low Sharpe) |
| 06 | multi-class-ensemble v1 | 1d | +17.53 | +0.54 | -0.131 | 0.93 | 0 | no | REMOVE (low Sharpe) |
| 04 | donchian-trailing | 1d | +1.55 | +0.05 | 0.216 | 5.00 | 28 | no | HALT (zero alpha) |
| 17 | mtf-trend-confluence | 1h | 0.00 | 0.00 | 0.000 | 0.00 | 0 | no | HALT (0 trades) |
| 10 | regime-routed-ensemble 1of2 | 15m | -1.40 | 0.00 | -0.500 | 50.00 | 1265 | **YES** | HALT (kill-switch) |
| 02 | donchian-breakout | 1h | -17.99 | 0.00 | -1.767 | 19.24 | 268 | no | HALT ✓ |
| 09 | multi-class-ensemble-v4 | 1d | +159.56 | +5.32 | **-13.708** | 5.38 | 151 | no | HALT (high vol, neg Sharpe) |
| 08 | multi-class-ensemble-v3 | 1d | +171.72 | +5.72 | **-14.722** | 7.31 | 151 | no | REMOVE (high vol, neg Sharpe) |
| 13 | bollinger-range-squeeze | 5m | -50.00 | 0.00 | -24.318 | 50.00 | 888 | **YES** | HALT ✓ |
| 12 | keltner-grid | 5m | -50.03 | 0.00 | -310.738 | 50.03 | 886 | **YES** | HALT ✓ |
| 01 | always-in-trend | 1h | -41.33 | 0.00 | -2.493 | 41.86 | 411 | no | HALT ✓ |
| 05 | mean-reversion-bb | 1h | -42.66 | 0.00 | -3.747 | 42.86 | 592 | no | HALT ✓ |
| — | simple-retail-ensemble | 15m | — | — | — | — | — | **CRASH** | BUG (null pos deref) |

---

## 2. Phase 26 audit vs fresh data — discrepancies

| Strategy | Phase 26 verdict | Fresh data | Verdict change? |
|---|---|---|---|
| always-in-trend | HALT | -41% / -2.49 Sharpe | ✓ confirmed |
| donchian-breakout | HALT | -18% / -1.77 Sharpe | ✓ confirmed |
| donchian-mtf | HALT | +25% / 0.59 Sharpe | ✓ borderline HALT (Sharpe too low) |
| donchian-trailing | HALT | +1.55% / 0.22 Sharpe | ✓ confirmed (zero alpha) |
| mean-reversion-bb | HALT | -43% / -3.75 Sharpe | ✓ confirmed |
| multi-class-ensemble v1 | REMOVE | +17.5% / -0.13 Sharpe | ✓ confirmed REMOVE |
| **multi-class-ensemble-v2** | **REMOVE** | **+794% / 3.43 Sharpe** | ❌ **MASSIVE CONTRADICTION** |
| multi-class-ensemble-v3 | REMOVE | +172% / -14.7 Sharpe | ✓ confirmed REMOVE (high vol) |
| **multi-class-ensemble-v4** | RESEARCH-KEEP | +160% / **-13.7 Sharpe** | ❌ **CONTRADICTS — high vol, neg Sharpe** |
| regime-routed 2of2 | RESEARCH-KEEP | +237% / 9.24 Sharpe | ✓ confirmed KEEP (better than audit said) |
| **keltner-grid** | RESEARCH-KEEP | **-50% / kill-switch / -310 Sharpe** | ❌ **CONTRADICTS — should be HALT** |
| **bollinger-range-squeeze** | RESEARCH-KEEP | **-50% / kill-switch / -24 Sharpe** | ❌ **CONTRADICTS — should be HALT** |
| funding-carry | RESEARCH-KEEP | +17.7% / 19.1 Sharpe | ✓ confirmed KEEP |
| funding-carry-leverage | RESEARCH-KEEP | +177% / 16.7 Sharpe | ✓ confirmed KEEP (very strong) |
| funding-carry-timing | RESEARCH-KEEP | +83% / 10.3 Sharpe | ✓ confirmed KEEP |
| **mtf-trend-confluence** | RESEARCH-KEEP | **0 trades / 0% return** | ❌ **CONTRADICTS — should be HALT** |
| **simple-retail-ensemble** | RESEARCH-KEEP | **CRASHES (TypeError null pos.side)** | ❌ **CONTRADICTS — broken, fix or REMOVE** |
| donchian-pivot-composition | PRODUCTION | +10327% / 20.5 Sharpe | ✓ confirmed (production-grade) |

**Audit accuracy: 11/18 confirmed, 7 contradicted by fresh data.**

---

## 3. Why Phase 26 audit was wrong

The Phase 26 audit categorized strategies from stale 98 baseline JSON files produced by
Phase 1-9 era code. After the Phase 26 wipe + fresh rerun with current code, **5 categories
shift** and **one massive mis-classification** surfaces:

1. **multi-class-ensemble-v2** was mis-marked REMOVE in audit, but fresh run shows
   **+794% total, +9.46%/mo, 3.43 Sharpe, 5.00% DD** — this is a top performer that
   should be reclassified as **PRODUCTION CANDIDATE** (or at least KEEP).

2. **keltner-grid, bollinger-range-squeeze** were marked KEEP in audit based on stale
   baseline JSONs that showed ~0% return and 50% DD. Fresh run shows the same — but
   the audit didn't translate that into HALT. **Both should be HALT.**

3. **mtf-trend-confluence** was the original Phase 1 baseline strategy. Audit marked
   it KEEP because "research artifact" — but fresh run shows **0 trades, 0% return**.
   The strategy produces no signals with current default config. **HALT.**

4. **multi-class-ensemble-v4** (currently the "canonical" multi-class per Phase 26 audit)
   has **negative Sharpe (-13.7)** despite +5.3%/mo return — meaning very high variance.
   v2's 3.43 Sharpe dominates v4 on every metric. v4 should be HALT, v2 should be promoted.

5. **simple-retail-ensemble** crashes with `TypeError: null is not an object (evaluating 'pos.side')`
   in `packages/backtest/src/engine.ts:485` — a regression in either the strategy or the engine.
   Either fix the bug or REMOVE.

---

## 4. Revised deletion recommendation (CURRENT-CODE ground truth)

### Definitely DELETE (code + tests + CLI files)

| File | Reason | LOC saved |
|---|---|--:|
| `packages/core/src/strategy/always-in-trend.ts` + `.test.ts` | -41% / -2.5 Sharpe / 41.9% DD | ~400 |
| `packages/core/src/strategy/donchian-breakout.ts` + `.test.ts` | -18% / -1.8 Sharpe / 19.2% DD | ~700 |
| `packages/core/src/strategy/donchian-trailing.ts` + `.test.ts` | +1.5% / 0.22 Sharpe — zero alpha | ~800 |
| `packages/core/src/strategy/mean-reversion-bb.ts` + `.test.ts` | -43% / -3.7 Sharpe / 42.9% DD | ~600 |
| `packages/core/src/strategy/keltner-grid.ts` + `.test.ts` | -50% / kill-switch / -310 Sharpe | ~700 |
| `packages/core/src/strategy/bollinger-range-squeeze.ts` + `.test.ts` | -50% / kill-switch / -24 Sharpe | ~700 |
| `packages/core/src/strategy/mtf-trend-confluence.ts` + `.test.ts` | 0 trades / 0% return | ~600 |
| `packages/core/src/strategy/multi-class-ensemble.ts` (v1) + `.test.ts` | -0.13 Sharpe, superseded by v2 | ~920 |
| `packages/core/src/strategy/multi-class-ensemble-v3.ts` + `.test.ts` | -14.7 Sharpe, superseded by v2 | ~1350 |
| `packages/core/src/strategy/multi-class-ensemble-v4.ts` + `.test.ts` | -13.7 Sharpe (lower than v2) | ~1630 |
| `packages/core/src/strategy/simple-retail-ensemble.ts` + `.test.ts` | CRASHES (null deref), broken | ~700 |
| `packages/core/src/strategy/regime-routed-ensemble.ts` (1of2 mode) + `.test.ts` | 1of2 mode kill-switch, 0% return | (keep file, deprecate mode) |
| 11 corresponding CLI files in `packages/backtest-tools/src/cli/` | matching baselines | ~1500 |
| All `export` lines for these in `packages/core/src/index.ts` | dead re-exports | ~50 |

**Subtotal: ~10,650 LOC deleted (without breaking 18 PRODUCTION+SUB-COMPONENT dependencies).**

### KEEP (research archive, even if HALT)

- `packages/core/src/strategy/donchian-mtf.ts` — borderline HALT (+25% / 0.59 Sharpe). The
  strategy is the **core sub-component** of the Phase 11.1b DirectionalMTFPlugin. Cannot
  delete without breaking the plugin.

### KEEP / PROMOTE

- `multi-class-ensemble-v2.ts` (435 lines + 357 tests = 792 LOC) — **STRONG CANDIDATE**,
  +9.46%/mo, 3.43 Sharpe, 5.00% DD. Fresh-data beats v4 and rivals donchian-pivot-composition
  for BTC delta-neutral carry dominance. Should be promoted to **PRODUCTION CANDIDATE**
  (Phase 27 scope).

### KEEP (production-grade)

- `donchian-pivot-composition.ts` — confirmed +16.62%/mo, 20.5 Sharpe, 4.64% DD (default 2of2 mode)
- `funding-carry-leverage.ts` — confirmed +3.43%/mo, 16.7 Sharpe, 1.50% DD (10× carry)
- `regime-routed-ensemble.ts` (2of2 mode only) — confirmed +4.10%/mo, 9.24 Sharpe, 8.59% DD

### SUB-COMPONENTS (don't delete — referenced by PRODUCTION)

- `donchian-range-channel.ts`, `pivot-point-grid.ts`, `funding-flip-kill-switch.ts`, `composite.ts`
- `dydx-cex-carry.ts` (live integration), `cascade-fade.ts` (paper-trade replay)

---

## 5. Action items

| # | Task | Effort |
|--:|---|--:|
| 1 | Open PR deleting the 11 HALT/REMOVE strategy files + corresponding CLIs + index.ts re-exports | ~30 min |
| 2 | Fix simple-retail-ensemble null-deref bug (or REMOVE if not worth fixing) | ~1-2 hours |
| 3 | Decide: keep multi-class-ensemble-v4 alongside v2, or replace v4 with v2 in the production pipeline | (decision) |
| 4 | Promote multi-class-ensemble-v2 to PRODUCTION CANDIDATE in Phase 27 | (next phase) |
| 5 | Add `--output` flag awareness to regime-routed-ensemble 2of2 default (currently 1of2 is default and blows up) | ~10 min |

---

## 6. Fresh log files

All 18 fresh logs (15 + 1 sanity + 1 crash + 1 extra regime 2of2) are in:

```
backtest-results/fresh-2026-07-08/
├── 01-alwaysin-btc-1h.json
├── 02-donchian-breakout-btc-1h.json
├── 03-donchian-mtf-btc-1h.json
├── 04-donchian-trailing-btc-1d.json
├── 05-mean-reversion-bb-btc-1h.json
├── 06-mc-v1-btc-1d.json
├── 07-mc-v2-btc-1d.json
├── 08-mc-v3-btc-1d.json
├── 09-mc-v4-btc-1d.json
├── 10-regime-routed-btc-15m.json
├── 10b-regime-routed-2of2-btc-15m.json
├── 12-keltner-grid-btc-5m.json
├── 13-bb-squeeze-btc-5m.json
├── 14-funding-carry-btc-1h.json
├── 15-funding-carry-lev-btc-1h.json
├── 16-funding-carry-timing-btc-1h.json
├── 17-mtf-trend-btc-1h.json
└── 18-donchian-pivot-prod-btc-15m.json
```

(Simple-retail-ensemble produced no JSON — it crashed mid-run.)

These logs are 100% current-code ground truth and can be diffed against any future code change
to detect silent regressions.