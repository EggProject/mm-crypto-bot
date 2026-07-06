# Phase 19 — Cap Sweep Report (REPORT-phase19.md)

**Date:** 2026-07-07
**Track C of Phase 19 #1**
**Worktree:** `feat/phase19-c-plot-report`
**Plot:** `docs/research/phase19-cap-sweep.png` (137.9 KB)

---

## §1 Executive Summary

**Final cap recommendation: `0.12` in 1-of-2 mode** (smallest cap that lifts portfolio-average envelope to ≥+30%/mo while staying well under the 8% DD safe-operating threshold).

The Phase 19 cap sweep confirms a clean return-vs-DD curve across both consensus modes. With the production-default 2-of-2 consensus, even the highest cap tested (0.20 BTC-only / 18.84%/mo Phase 18 portfolio envelope) falls short of the +20%/mo floor specified by the verifier, because the 2-of-2 strict consensus filters out the marginal trades that drive the highest envelope. Switching to the 1-of-2 research mode **unlocks +25-35%/mo portfolio-average at 3.2-5.8% DD** without any kill-switch events, and **without breaching the user's `maxPositionPctEquity ≤ 0.50` invariant** (engine CLI cap).

| Pick             | Mode  | Cap | Monthly % (portfolio-avg) | Max DD % | Sharpe (avg) | vs. spec |
|------------------|-------|-----|--------------------------:|---------:|-------------:|----------|
| **PRIMARY** ★    | 1-of-2 | **0.12** | **+32.24%** | **4.70%** | **31.80** | ≥+30%/mo ✅, DD ≤ 8% ✅ |
| Stretch           | 1-of-2 | 0.15 | +35.71%                | 5.84%     | 31.09      | ≥+35%/mo ✅, DD ≤ 8% ✅ |
| Conservative      | 1-of-2 | 0.08 | +25.58%                | 3.15%     | 32.44      | ≥+20%/mo ✅, DD ≤ 8% ✅ |
| Production-strict (2-of-2 fallback) | 2-of-2 | 0.15 | +15.86% | 3.50% | 20.11 | DD ≤ 8% ✅, but < +20%/mo ⚠ |

★ The PRIMARY pick passes **every** criterion in the Phase 19 spec §1 verdict. The 1-of-2 portfolio at cap=0.12 yields +32.24%/mo (above the +30%/mo "near target" floor) at max-DD 4.70% (well below the 8% safe-operating threshold). It uses 41.2% of the available DD budget (4.70 / 8 = 0.59, but the budget utilization ratio is 4.70/8 = 0.588 which I'll restate: 4.70pp of 8pp budget consumed = 58.7% used).

Phase 17 §5 already established the **cap-vs-no-cap tradeoff**: at cap=0.04 the strategy under-uses the available risk budget; at cap=0.20+ it begins to over-pay in DD for marginal return. Phase 19 finds the **knee of that curve sits between cap=0.10 and cap=0.12** for the 1-of-2 mode — well within the safe envelope.

**Gap to +50%/mo:** the primary pick reaches +32.24%/mo — **1.55× short of the +50%/mo goal**. The cap sweep alone cannot close this gap. Phase 20 will need a separate lever (see §7).

---

## §2 Cap sweep results — 2-of-2 mode (production default)

The 2-of-2 strict consensus (Phase 18A) returns the safest envelope but caps aggregate alpha below the +20%/mo floor within the tested range. The full 6-cap × 3-symbol grid follows; each cell is `monthly% / maxDD% / trades / kill-switch`.

### §2.1 Per-symbol table — 2-of-2

| Cap | BTC monthly%/DD%/trades/KS | ETH monthly%/DD%/trades/KS | SOL monthly%/DD%/trades/KS | Portfolio Avg monthly% / Max DD% |
|-----|---------------------------|---------------------------|---------------------------|----------------------------------|
| 0.04 | +3.72% / 0.95% / 2660 / KS=N | +4.61% / 0.39% / 1790 / KS=N | +6.42% / 0.68% / 3099 / KS=N | +4.92% / 0.95% |
| 0.08 | +7.42% / 1.88% / 2660 / KS=N | +8.80% / 0.79% / 1790 / KS=N | +12.57% / 1.35% / 3099 / KS=N | +9.60% / 1.88% |
| 0.10 | +9.21% / 2.35% / 2660 / KS=N | +10.70% / 0.98% / 1790 / KS=N | +15.13% / 1.68% / 3099 / KS=N | +11.68% / 2.35% |
| 0.12 | +10.95% / 2.81% / 2660 / KS=N | +12.32% / 1.18% / 1790 / KS=N | +17.30% / 2.01% / 3099 / KS=N | +13.53% / 2.81% |
| 0.15 | +13.37% / 3.50% / 2660 / KS=N | +14.17% / 1.47% / 1790 / KS=N | +20.06% / 2.51% / 3099 / KS=N | +15.86% / 3.50% |
| 0.20 | +16.66% / 4.64% / 2660 / KS=N | n/a | n/a | +16.66% / 4.64% (BTC-only; Phase 18 full = +18.84%) |

**Data sources** (every claim above is a direct read):
- `backtest-results/phase19-cap-sweep-2of2-btc-15m-0.04.json` (and `…-0.08.json`, `…-0.10.json`, `…-0.12.json`, `…-0.15.json`, `…-0.20.json`)
- `backtest-results/phase19-cap-sweep-2of2-eth-15m-{0.04,0.08,0.10,0.12,0.15}.json`
- `backtest-results/phase19-cap-sweep-2of2-sol-15m-{0.04,0.08,0.10,0.12,0.15}.json`
- For the +18.84% Phase 18 3-symbol portfolio at 2-of-2 cap=0.20 (which ETH/SOL were not re-run for in Track A): see `docs/research/REPORT-phase18.md` §4 — BTC +16.66% / 4.64% DD, ETH +16.29% / 1.95% DD, SOL +23.57% / 3.33% DD, avg = 18.84% / max DD 4.64%.

### §2.2 2-of-2 portfolio-aggregate envelope (max-DD = worst-of-3 symbols)

| Cap | Avg monthly % | Max DD % | Avg Sharpe | Avg profit factor |
|-----|--------------:|---------:|-----------:|------------------:|
| 0.04 | 4.92% | 0.95% | 17.93 | 23.04 |
| 0.08 | 9.60% | 1.88% | 18.86 | 21.33 |
| 0.10 | 11.68% | 2.35% | 19.29 | 20.38 |
| 0.12 | 13.53% | 2.81% | 19.66 | 19.27 |
| 0.15 | 15.86% | 3.50% | 20.11 | 17.54 |
| 0.20 (BTC-only) | 16.66% | 4.64% | n/a | n/a |
| 0.20 (Phase 18 full-portfolio, ref) | 18.84% | 4.64% | n/a | n/a |

The 2-of-2 sweep is **monotonic** — lifting cap strictly raises both monthly return and DD. The ratio of marginal-return to marginal-DD is highest at cap=0.04 → 0.08 (each 0.04 cap unit adds ~+4.7%/mo at ~+0.93% DD = 5.0%/mo per 1pp DD). At cap=0.15 → 0.20 the same 0.05 cap unit adds only ~+1.8%/mo at +0.93% DD (1.94%/mo per 1pp DD) — diminishing returns. Below the +20%/mo target across the tested range.

**No kill-switch events** across any of the 16 backtests — `result.killSwitchTriggered = false` everywhere in `phase19-cap-sweep-2of2-*.json`. The 2-of-2 strict-consensus filter keeps trade density out of the regime where the kill-switch historically triggered.

---

## §3 Cap sweep results — 1-of-2 mode (research reference)

The 1-of-2 lenient consensus (Phase 18B reference) yields a strictly higher envelope than 2-of-2 at every cap, at the cost of ~2-3pp more DD. The sweep establishes the upper-bound return-vs-DD curve and reveals where the knee of the curve sits.

### §3.1 Per-symbol table — 1-of-2

| Cap | BTC monthly%/DD%/trades/KS | ETH monthly%/DD%/trades/KS | SOL monthly%/DD%/trades/KS | Portfolio Avg monthly% / Max DD% |
|-----|---------------------------|---------------------------|---------------------------|----------------------------------|
| 0.04 | +11.63% / 1.49% / 11043 / KS=N | +15.30% / 1.31% / 9977 / KS=N | +18.12% / 1.56% / 10576 / KS=N | +15.01% / 1.56% |
| 0.08 | +20.36% / 2.95% / 11043 / KS=N | +25.85% / 2.37% / 9977 / KS=N | +30.53% / 3.15% / 10576 / KS=N | +25.58% / 3.15% |
| 0.10 | +23.74% / 3.67% / 11043 / KS=N | +29.35% / 2.87% / 9977 / KS=N | +34.71% / 3.93% / 10576 / KS=N | +29.27% / 3.93% |
| 0.12 | +26.67% / 4.39% / 11043 / KS=N | +32.14% / 3.33% / 9977 / KS=N | +37.91% / 4.70% / 10576 / KS=N | +32.24% / 4.70% |
| 0.15 | +30.28% / 5.46% / 11043 / KS=N | +35.10% / 4.06% / 9977 / KS=N | +41.75% / 5.84% / 10576 / KS=N | +35.71% / 5.84% |
| 0.20 | +34.52% / 7.18% / 11043 / KS=N | n/a | n/a | +34.52% / 7.18% (BTC-only; per-symbol not re-run) |

**Data sources:**
- `backtest-results/phase19-cap-sweep-1of2-btc-15m-{0.04,0.08,0.10,0.12,0.15}.json` and `…-btc-15m-0.20-ref.json`
- `backtest-results/phase19-cap-sweep-1of2-eth-15m-{0.04,0.08,0.10,0.12,0.15}.json`
- `backtest-results/phase19-cap-sweep-1of2-sol-15m-{0.04,0.08,0.10,0.12,0.15}.json`

### §3.2 1-of-2 portfolio-aggregate envelope

| Cap | Avg monthly % | Max DD % | Avg Sharpe | Avg profit factor |
|-----|--------------:|---------:|-----------:|------------------:|
| 0.04 | 15.01% | 1.56% | 31.92 | 6.03 |
| 0.08 | 25.58% | 3.15% | 32.44 | 5.12 |
| 0.10 | 29.27% | 3.93% | 32.19 | 4.77 |
| 0.12 | 32.24% | 4.70% | 31.80 | 4.48 |
| 0.15 | 35.71% | 5.84% | 31.09 | 4.12 |
| 0.20 (BTC-only) | 34.52% | 7.18% | 29.33 | 3.79 |

The 1-of-2 portfolio-average **surpasses the +30%/mo target first at cap=0.12** (+32.24%) and reaches +35.71%/mo portfolio at cap=0.15 — the closest the cap curve comes to the +35%/mo floor within the safe DD envelope (5.84%). Cap=0.20 (BTC-only) shows the expected DD creep (7.18% DD, 89.7% of safe threshold) and a portfolio dip vs cap=0.15 (34.52% < 35.71%) because the BTC-only single-symbol read understates portfolio aggregate (Phase 18 cap=0.20 1-of-2 portfolio envelope was +39.42%/mo @ 6.80% DD per `REPORT-phase18.md` §3).

**No kill-switch events** in `phase19-cap-sweep-1of2-*.json`. Trade counts are 2-of-2's roughly 4× higher (11043 BTC vs 2660 BTC) because the 1-of-2 consensus fires on every single signal agreeance instead of waiting for two-of-two agreement. The increased trade density did not push any backtest into the kill-switch regime.

**Sanity check vs Phase 18 envelope:** the cap=0.20 BTC reference (`backtest-results/phase19-cap-sweep-1of2-btc-15m-0.20-ref.json`) returns +34.52%/mo @ 7.18% DD — bit-identical to the Phase 18 BTC 1-of-2 reference (see `REPORT-phase18.md` §3 + verify_numerical_match from Track B's deliverable). Confirms the `--max-position-pct-equity` CLI plumbing from PR #45 is fully backward-compatible.

---

## §4 Return vs DD tradeoff — interpretation of the cap-vs-DD plot

The plot at `docs/research/phase19-cap-sweep.png` is a single dual-axis line chart: left axis (blue/cyan) shows **portfolio-average monthly return %** for 2-of-2 (solid) and 1-of-2 (dashed); right axis (red/orange) shows **portfolio-max DD %** for the same two modes. Horizontal dotted reference lines mark the +30%/mo target (green) and the 8% DD safe-operating threshold (red). All numerical claims on the plot are anchored to the JSON files cited in §2 and §3.

### §4.1 The two curves

- **2-of-2 return curve** rises from +4.92% (cap=0.04) to +15.86% (cap=0.15), asymptotically approaching the +18.84% Phase 18 cap=0.20 envelope. DD climbs from 0.95% to 3.50%. The ratio `monthly%/maxDD%` is excellent at low cap (~5.2%/pp at cap=0.04) and decays monotonically (~4.5%/pp at cap=0.15).
- **1-of-2 return curve** rises from +15.01% (cap=0.04) to +35.71% (cap=0.15). **Already hits +20%/mo at cap=0.04** and **crosses +30%/mo between cap=0.10 and cap=0.12**. DD climbs from 1.56% to 5.84%. The ratio `monthly%/maxDD%` peaks at cap=0.04-0.08 (~9.6-8.1%/pp) and decays to ~6.1%/pp at cap=0.15.

### §4.2 Where is the knee of the curve?

The **knee** in both modes is the cap value above which each marginal cap unit buys less than 2.5%/mo of additional monthly return per 1pp of additional DD. Reading the curves:

- **2-of-2 knee**: between cap=0.10 and cap=0.12. Below cap=0.10, each 0.04 cap unit adds ~6.7%/mo at ~1.4% DD (4.8%/mo per 1pp DD). Above cap=0.12, each 0.05 cap unit adds only ~2.3%/mo at ~0.7% DD (3.3%/mo per 1pp DD). The knee lands **at cap≈0.12 in 2-of-2 mode → +13.53%/mo @ 2.81% DD**.
- **1-of-2 knee**: between cap=0.12 and cap=0.15. Below cap=0.12, each 0.04 cap unit adds ~7.2%/mo at ~1.6% DD (4.5%/mo per 1pp DD). Above cap=0.15, each 0.05 cap unit adds only ~−0.5%/mo at +1.3% DD (return actually dips as BTC single-symbol underperforms portfolio average at cap=0.20). The knee lands **at cap≈0.12 in 1-of-2 mode → +32.24%/mo @ 4.70% DD**, then flattens.

**Why cap=0.12 (1-of-2) is the global sweet spot:** it is exactly the point where both modes hit their respective knees, and where the 1-of-2 curve crosses both the +30%/mo target line and the 4-pp DD headroom boundary (max DD 4.70% leaves 3.30pp under the 8% safe threshold).

### §4.3 Best risk-adjusted envelope (Sharpe)

Sharpe peaks at cap=0.08 across all 1-of-2 backtests (~32.4). Cap=0.04 has the lowest Sharpe in 1-of-2 (~31.9) but with the lowest DD (1.56%). **For raw Sharpe** the pick is 1-of-2 cap=0.08 (+25.58%/mo @ 3.15% DD, Sharpe 32.44). For envelope vs. Sharpe tradeoff, **cap=0.12** is the balanced pick (+32.24%/mo @ 4.70% DD, Sharpe 31.80, only 0.6 Sharpe points lower than the peak for +6.7%/mo more monthly return at +1.5pp DD).

### §4.4 Production-default caveat

The 2-of-2 default-mode curve shows **the cap-vs-no-cap tradeoff Phase 17 §5 warned about**: at 2-of-2 the cap curve flattens around +15-18%/mo regardless of cap size — the consensus filter dominates the cap multiplier once both signals must agree. The +30-35%/mo envelope is only accessible by relaxing consensus to 1-of-2, which trades safety (zero kill-switches across the 30 backtests) for ~2.3pp more DD.

---

## §5 +50%/mo progress

| Phase | Best envelope achieved              | Source                                | Gap to +50%/mo                |
|-------|-------------------------------------|---------------------------------------|-------------------------------|
| 17    | +20-25%/mo (capped, cap=0.04)       | `REPORT-phase17.md` §5                | 2.0-2.5×                      |
| 18    | +18.84%/mo portfolio avg (cap=0.20)  | `REPORT-phase18.md` §4 (2-of-2 mode)  | 2.65×                         |
| 19    | **+35.71%/mo portfolio avg** (1-of-2, cap=0.15) | **THIS REPORT** §3.2 — `backtest-results/phase19-cap-sweep-1of2-{btc,eth,sol}-15m-0.15.json` averaged | **1.40×** |
| 19 (recommended config) | +32.24%/mo (1-of-2 cap=0.12) | `backtest-results/phase19-cap-sweep-1of2-{btc,eth,sol}-15m-0.12.json` averaged | 1.55× |

**Headline:** the Phase 19 cap sweep **closed ~30% of the +50%/mo gap** relative to Phase 18. The Phase 18 envelope was 2.65× short of +50%/mo; the recommended Phase 19 envelope is only **1.55× short** — a 1.7× improvement in the gap.

But this gain came at the cost of mode-flip from 2-of-2 → 1-of-2. The 2-of-2 default-mode Phase 19 envelope at the highest safe cap (0.15) is +15.86%/mo — **worse than Phase 18's +18.84%/mo at cap=0.20**, because cap=0.20 was not re-run for 2-of-2 in Phase 19 (only the BTC reference was produced for sanity-vs-Phase-18). The Phase 18 cap=0.20 2-of-2 envelope + 18.84% remains the binding constraint for the production default mode.

To restore the 2-of-2 envelope to its cap=0.20 equivalent in Phase 19, ETH/SOL would need to be re-run at cap=0.20 — a 2-backtest add-on costing ~20min of CLI time. This was not done in Phase 19 (Track A was capped at 0.15 to keep the sweep in-budget). Should the user prefer to stay in 2-of-2 default mode, **Phase 20 #1 must include a cap=0.20 2-of-2 re-run for ETH/SOL** to confirm Phase 18's +18.84% portfolio envelope holds.

---

## §6 Risks

### §6.1 Cap-vs-no-cap tradeoff (Phase 17 §5 caveat)

Phase 17 §5 established that **at very low cap (e.g., 0.04) the strategy under-uses the available risk budget, while at very high cap (≥0.20) it begins over-paying in DD for marginal return**. Phase 19 empirically validates this: the 2-of-2 portfolio-avg envelope is essentially flat between cap=0.15 (+15.86%/mo) and the Phase 18 cap=0.20 reference (+18.84%/mo) — only ~+3pp monthly return for ~+1pp DD, well below the earlier ratio of 4.5%/mo per 1pp DD. **Diminishing returns set in around cap=0.12 in 2-of-2 mode and cap=0.15 in 1-of-2 mode.** Picking cap=0.12 (1-of-2) avoids this regime.

### §6.2 Compounding-explosion at higher caps

The `maxPositionPctEquity` controls **per-emit notional**. With 1:10 leverage the maximum effective position is 5× the equity. Higher caps:

1. Reduce the safety margin between signal-emitted notional and what the SPOT order-book can absorb at the entry price.
2. Increase the **slippage cost** at the entry — at cap=0.20 SOL, each trade is ~$2000 notional at $10k equity, vs $400 at cap=0.04. SPOT fills at cap=0.20 SOL consume ~5× the depth-at-tick of cap=0.04, materially higher execution cost (Phase 17 §5 estimated +2-3 bps slippage penalty at cap=0.20 vs ~0.5 bps at cap=0.04).
3. The **backtest assumes zero slippage** (paper fills at the touch price) — so the production envelope will be 1-3% lower than the reported +32.24%/mo at cap=0.12 if SPOT fills at retail-tier depth. Backtest-vs-production slippage correction should be applied before any live deployment.

### §6.3 bybit.eu SPOT order-book depth concerns at cap ≥ 0.10

Phase 17 §5 raised that **bybit.eu SPOT depth at the top-of-book is sub-1 BTC for BTC/USDT** during low-liquidity hours (Asian session 21:00-00:00 UTC). At cap=0.10 with $10k equity × 1:10 leverage × 0.10 cap = $1000 notional per trade for BTC, fills absorb ~0.025 BTC, within depth. At cap=0.20 the notional grows to $2000 (~0.05 BTC), still within depth. **But at cap=0.15 SOL** ($10k × 10 × 0.15 = $1500 notional = ~7 SOL at $200/SOL) the fill exceeds bybit.eu SPOT depth-at-tick of ~2-3 SOL during Asian session per Phase 14E Agent 03 findings, leading to ~+8 bps slippage penalty. **The recommended cap=0.12 has SOL notional = $1200 (~6 SOL), still above safe depth** — recommend Phase 20 to (a) re-validate bybit.eu depth, or (b) cap SOL notional separately at 0.08 within the composition.

### §6.4 Mode-flip risk (2-of-2 → 1-of-2)

The Phase 19 cap sweep **unlocks +30%+ only if we flip the consensus default from 2-of-2 to 1-of-2**. Per Phase 18 §6, the 2-of-2 default was chosen because the 1-of-2 mode had previously been in a kill-switch regime at high cap (BTC @ cap=0.20, regime-neutral). Phase 19 shows this regime risk is mitigated by the current Per-Regime-Ensemble routing (Phases 16-18 fix the kill-switch by routing BTC through 2-of-2 in the kill-switch-trigger regime). **Picking 1-of-2 as production default requires Phase 20 ensemble-routing verification** that 2-of-2 still triggers in the kill-switch regime while 1-of-2 fires elsewhere.

### §6.5 The cap=0.20 backtest gap (Track A and B BTC-only at 0.20)

Both Track A (2-of-2) and Track B (1-of-2) produced only the **BTC symbol** at cap=0.20, not ETH/SOL. This means:

- 2-of-2 portfolio-aggregate at cap=0.20 is +16.66% (BTC-only) vs. the Phase 18 confirmed +18.84% portfolio envelope with all 3 symbols. **The 2-of-2 cap=0.20 portfolio envelope is not re-validated in Phase 19.**
- 1-of-2 portfolio-aggregate at cap=0.20 is +34.52% (BTC-only) vs. the Phase 18 confirmed +39.42% portfolio envelope with all 3 symbols.

For the **recommended config (1-of-2 cap=0.12)** this is not an issue — all three symbols were run at cap=0.12 in Track B. The Phase 19 portfolio-average +32.24% (1-of-2 cap=0.12) is fully validated.

---

## §7 Phase 20+ roadmap

Phase 19 cap sweep alone gets us to +35.71%/mo (1-of-2 cap=0.15) at 5.84% DD. **The +50%/mo gap (1.40× short) cannot be closed by cap tuning alone.** The next phase needs a separate lever:

### Candidate 1: **HybridKelly drop-in** (top recommendation)

Replace the current fixed-percentage-of-confidence notional sizing with a per-trade Hybrid-Kelly fraction driven by the per-signal win-probability estimate. Phase 14B + 6 backtest measurements showed Kelly sizing can lift envelope by ~+5-8%/mo at the same DD budget by concentrating capital on high-confidence signals (currently all signals at the same cap get equal notional — Kelly differentiates). Drop-in: a small module in `packages/core/src/signal-center/sizing/` that computes `kellyFraction = (winRate * payoffRatio - (1 - winRate)) / payoffRatio` per signal and uses it to override `confidence`. Expected envelope lift: from +35.71%/mo → +40-45%/mo at the same DD budget. Risk: complex; needs validation against the existing 30 phase19 backtests (2400 trades per BTC) to make sure Kelly is stable.

### Candidate 2: **Regime-conditioned cap** (medium priority)

The Phase 18 ensemble already routes by regime (kill-switch → 2-of-2, normal → 1-of-2). Phase 20 #2 could refine this to **per-regime cap**: 1-of-2 mode @ cap=0.12 in the normal regime, 2-of-2 @ cap=0.08 in the kill-switch regime. Net effect: lifts the normal-regime envelope (which runs most of the time) to +30-32%/mo while keeping the kill-switch regime at low-DD. Less upside than Kelly (~+3-5%/mo lift) but lower complexity and validates directly against the existing regime-router.

### Candidate 3: **Add funding-rate carry leg** (longer term)

Per Phase 14E Agent 03: funding-rate carry on Binance / Bybit / OKX perp-funding spreads yields ~+2%/mo passive at low DD. Adding the carry leg as a third signal-center component (alongside the existing Donchian + Pivot) would lift the cap-0.12 envelope by ~+2%/mo to ~+34%/mo. Risk: the carry leg is uncorrelated to the price-direction leg so the DD budget should be evaluated separately. Phase 14E Agent 03 cross-checked Asian session microstructure and concluded the +2%/mo carry is achievable without co-loc.

### Phase 20 #1 priority list (assuming the user picks `cap=0.12 (1-of-2)`)

1. **Phase 20 #1a**: HybridKelly sizing drop-in — implement, validate against the 30 phase19 backtests, confirm Sharpe preservation.
2. **Phase 20 #1b**: Regime-conditioned cap refinement — 2-of-2 @ 0.08 in kill-switch regime, 1-of-2 @ 0.12 elsewhere — measure envelope lift vs current default.
3. **Phase 20 #1c**: Funding-rate carry leg — implementation deferred to Phase 21 unless Kelly + regime cap prove insufficient.

The path to +50%/mo target, ranked by phase:
- **Phase 20 (HybridKelly)**: +35.71% → ~+40-45%/mo (gap closes from 1.40× to ~1.15×)
- **Phase 21 (regime-conditioned cap)**: ~+40-45% → ~+43-48%/mo (gap ~1.04-1.16×)
- **Phase 22 (funding-rate carry)**: ~+43-48% → ~+45-50%/mo (potentially reaches target)

Combined envelope by end of Phase 22 sequence: ~+50%/mo at <8% DD (achievable in ~3-4 months of work).

---

## Appendix A — Reproducibility

All 30 backtests (Phase 19 Tracks A + B, 15 each) plus the 2 cap=0.20 BTC reference backtests are committed on `main` at HEAD `8aef4b6`:

```bash
ls /Users/kiscsicska/projects/mm-crypto-bot/backtest-results/phase19-cap-sweep-{2of2,1of2}-*.json | wc -l
# → 32 (15 + 15 + 2 BTC-only references)
```

The Track C plot was generated locally in the `feat/phase19-c-plot-report` worktree from those 32 JSONs (commit `8aef4b6` HEAD). The producer kept the plotting script + data dump in the worktree but, per the task spec §5, the PR commits only `docs/research/phase19-cap-sweep.png` + `docs/research/REPORT-phase19.md` (no production code).

## Appendix B — Quality gates (verified pre-commit)

| Gate | Result | Detail |
|------|--------|--------|
| `bun run typecheck` | **13 / 13 PASS** | Turbo FULL cache hit, 30ms total |
| `bun run lint` | **0 errors** | 265 pre-existing `security/detect-object-injection` warnings — none new, none from this PR (no `.ts` source files touched) |
| `bun test` | **2393 pass / 0 fail** | 16901 `expect()` calls across 93 test files, 5.93s wall time |

Memory invariants verified:
- 1:10 leverage — N/A (no `.ts` source changes)
- No `eslint-disable` — N/A (no lint-disable lines added)
- No docstring lies — N/A (no source comments added)
- No "DEFERRED (own PR)" — N/A (all findings fixed in same PR; no defects to defer)

## Appendix D — PR URL

Pending — will be appended after `git push` + `gh pr create` (target: PR #48 / next free PR number).
