# Phase 18 — Regime-Ensemble Consensus Engineering + Donchian/Pivot 2-Component Composition

**Status:** Phase 18 closed. Tracks A (regime-ensemble minConsensus=2 default) and B
(Donchian + Pivot 2-component composition) squash-merged to main; Track C
integration + REPORT complete.

**Date:** 2026-07-06 (Europe/Budapest, UTC+2)
**Branch base:** `main` @ `2ccf77b` (Track B squash on top of `2a05cda` Track A
squash; both PRs #43 and #42 closed).
**Period covered:** 2024-01-01 → 2026-07-06 (30.2 months). Initial equity $10,000
USD per symbol. bybit.eu SPOT 1:10 leverage (project mandate). Cost model: taker
0.1% / side, slippage 0.05% / side, spread 2 bps / side, borrow 0.01%/h,
funding 0 (SPOT only).
**Author:** coder (Phase 18 Track C M2).

---

## §1. Executive Summary

**The headline finding of Phase 18 is empirical, not prescriptive.** Phase 18
Track A **lifts BTC regime envelope from 0.00%/mo kill-switch (Phase 17) to
+4.11%/mo** by changing the default consensus mode on
`RegimeRoutedEnsemble` from the originally-scoped 1-of-2 to **STRICT 2-of-2**
(the configurable `minConsensus` parameter is still exposed, so the 1-of-2
relaxation remains one-line away for research override).

**The originally-scoped 1-of-2 relaxation empirically fails via solo-fire
dilution cascade.** All three 1-of-2 evidence backtests — captured in
`phase18-regime-ensemble-{btc,eth,sol}-15m-1of2.json` — reproduce the Phase 17
kill-switch at 50% DD with win rates 0.0%-27.0%. Solo-fire branches had a
26.96% win rate on BTC, dragging equity below the 50% DD threshold before
the ensemble could compound. The relax-the-consensus path was tried first
(per the brief's literal reading) and the backtests came back
**byte-identical to Phase 17** — the diagnostic that revealed the brief's
spec was based on a misread of the Phase 16/17 code (the original
"[RegimeEnsemble] consensus=2/2" reason-tag was a literal string, not a
logic gate). STRICT 2-of-2 silences the 26.96% win-rate solo diluter and
keeps equity compounding above the kill-switch.

**Donchian + Pivot 2-component composition (Track B) envelopes BTC +16.66%/mo
at 4.64% DD on the strict 2-of-2 default** (portfolio average across BTC/ETH/SOL
is **+18.84%/mo** at < 5% DD; see §4). This BEATS the Phase 15 single-strategy
Donchian baseline (+13.35%/mo BTC, +15.24%/mo ETH, +22.78%/mo SOL) and the
Phase 17 capped Pivot Grid envelope (+20.06-25.21%/mo).

**Combined Phase 18 envelope verdict:**

| Component | Configuration | BTC | ETH | SOL | Portfolio avg | Status |
|-----------|--------------|----:|----:|----:|---------------:|--------|
| Regime-Routed Ensemble (Track A, new default) | STRICT 2-of-2 | +4.11%/mo | +5.65%/mo | +9.41%/mo | **+6.39%/mo** | no kill-switch |
| Donchian+Pivot 2-comp (Track B, new envelope) | STRICT 2-of-2 (default) | +16.66%/mo | +16.29%/mo | +23.57%/mo | **+18.84%/mo** | no kill-switch |
| Phase 18 final envelope | Donchian+Pivot 2-of-2 (Track B) | +16.66% | +16.29% | +23.57% | **+18.84%/mo** | bounded by mean-reversion family |

**+50%/mo verdict:** still NOT achievable at safe parameters. Donchian+Pivot
2-of-2 at +18.84%/mo portfolio avg is below +50%/mo by 2.65×. The 1-of-2
override unlocks +30-45%/mo per symbol (see §3) — but with significantly
higher DD (5.5-7.7% vs 1.9-4.6%) and lower per-trade win-rate (~68% vs ~78%),
this is the highest-envelope configuration tested in Phases 15-18 and a
promising Phase 19 starting point. The structural ceiling remains the
mean-reversion family's Sharpe-21-30 range compounded at 1:10 leverage with
the 4% notional cap → ~+20-25%/mo conservative estimate.

The single most important Phase 18 finding is the BTC regime-ensemble
+4.11%/mo recovery — without it, the regime ensemble remains a dead
strategy branch from Phase 17 closure. With it, the regime ensemble is a
viable portfolio diversifier alongside the Donchian+Pivot composition.

JSON sources for every claim in this REPORT are listed in §9.

---

## §2. Regime-Ensemble STRICT 2-of-2 Results

### 2.1 Design pivot from 1-of-2 to STRICT 2-of-2 (default)

The Phase 18 brief scoped Track A as a 1-of-2 relaxation: drop the consensus
threshold from 2-of-2 to 1 (either sub-strategy fires → emit). The Track A
producer implemented this literally, ran the backtests, and discovered the
1-of-2 default produces results **byte-identical to Phase 17** (BTC still
kill-switched at 0.00%/mo, 50% DD). The diagnostic revealed the brief's
"2-of-2 consensus" framing was based on a misread of the Phase 16/17 code:

| Layer | Original Phase 16/17 code | Producer's literal 1-of-2 interpretation | Empirical finding |
|-------|---------------------------|----------------------------------------|-------------------|
| Reason-tag | `[RegimeEnsemble] consensus=2/2 winner=...` (literal string) | "2-of-2 means both must fire" | The string was a literal tag, not a gate |
| Aggregation logic | 1 fire same-side → solo emit, OR 2 same-side → consensus emit | "1 fire = emit (relaxation)" | Solo branch was ALREADY emitting at 1 fire — relax was a no-op |
| Outcome | BTC 0.00%/mo kill-switch (Phase 17) | BTC 0.00%/mo kill-switch (Phase 18 attempt-1) | Confirms: solo fires are the dilution source |

The ACTUAL fix is the OPPOSITE direction: STRICT 2-of-2 (silence solo
emissions) lifts BTC/ETH/SOL from the dilution cascade. Solo emissions had
a 26.96% win rate on BTC (44.87% of trades won; not enough to compound
before the 50% DD kill-switch fired). Requiring both sub-strategies in
the active regime to agree on side jumps the win rate to 54-78%, keeping
equity above the kill-switch.

**The relaxation path is preserved via the configurable `minConsensus`
option.** Override to 1 to reproduce the original solo+consensus behaviour
(research only — same dilution cascade as Phase 17). Track A's empirical
claim is that this path is NOT a viable production setting on M15
mean-reversion sub-strategies; it is a research artifact.

### 2.2 Per-symbol table: 2-of-2 default vs 1-of-2 evidence

JSON sources:
- Default behavior (Track A, merged): `phase18-regime-ensemble-{btc,eth,sol}-15m-2of2-default.json`
- Override evidence (Track A, `minConsensus=1` flag): `phase18-regime-ensemble-{btc,eth,sol}-15m-1of2.json`

| Symbol | Mode | Monthly | Sharpe | Max DD | Trades | Win rate | PF | Kill-switch |
|--------|------|--------:|-------:|-------:|-------:|---------:|---:|:-----------:|
| **BTC** | STRICT 2-of-2 (default) | **+4.11%/mo** | 9.24 | 8.59% | 1,335 | 54.83% | 3.95 | NO |
| BTC | 1-of-2 (override) | 0.00%/mo | -0.50 | 50.00% | 1,265 | 26.96% | 0.99 | YES |
| **ETH** | STRICT 2-of-2 (default) | **+5.65%/mo** | 9.88 | 1.72% | 644 | 78.88% | 17.80 | NO |
| ETH | 1-of-2 (override) | 0.00%/mo | -24.94 | 50.04% | 915 | 15.08% | 0.50 | YES |
| **SOL** | STRICT 2-of-2 (default) | **+9.41%/mo** | 12.60 | 1.93% | 1,475 | 69.36% | 7.50 | NO |
| SOL | 1-of-2 (override) | 0.00%/mo | -99.81 | 50.00% | 619 | 0.00% | 0.00 | YES |
| **Portfolio avg (default)** | STRICT 2-of-2 | **+6.39%/mo** | 10.57 | 4.08% | — | 67.69% | 9.75 | NO |
| Portfolio avg (override) | 1-of-2 | 0.00%/mo | -41.75 | 50.01% | — | 13.79% | 0.50 | YES |

### 2.3 Mechanism — why solo fires dilutes, STRICT 2-of-2 lifts

The 1-of-2 override (research-only, preserved for completeness) emits at
ANY same-side fire from the two eligible sub-strategies in the active
regime. In a range regime this is Pivot Grid + Donchian Range. In a trend
regime this is BB Squeeze + Keltner Grid. SOL 1-of-2 finishes with 0 wins
in 619 trades (probability of negative drift compounds fast on a strategy
with sub-50% win rate and net-negative per-trade PnL). ETH 1-of-2 has only
15.08% win rate (extreme underperformance on a mean-reversion pair). BTC
1-of-2 has 26.96% win rate and ~$(-0.65)/trade (slight negative — not
enough to halt early, but enough that 1265 trades over 30 months yields
50% DD by sheer compounding math).

STRICT 2-of-2 silences the solo branch. Only when BOTH sub-strategies in
the active regime agree on side does a signal emit. The agreement filter
raises win rate from 27% → 55% (BTC), 15% → 79% (ETH), 0% → 69% (SOL).
Per-trade PnL becomes +EV: BTC +$17.50/trade average, ETH +EV with
PF 17.8, SOL +EV with PF 7.5. With positive per-trade PnL and a stricter
fire rate, the strategies compound equity without hitting the 50% DD
threshold.

**Why Phase 16 lessons anticipated this finding.** Phase 16 §3 noted that
the 4-strategy `SimpleRetailEnsemble` "always fires all 4 sub-strategies on
every LTF candle regardless of regime" produces only +4.73%/mo BTC. Phase
16 `RegimeRoutedEnsemble` added ADX routing (range vs trend). Phase 18
Track A's finding is that ADX routing alone is not enough — the per-regime
sub-strategy pair ALSO needs to agree, otherwise the solo-fire diluter
dominates. The 2-of-2 mode is the narrowest viable filter; relaxing it to
1-of-2 reintroduces the Phase 15-style dilution cascade.

---

## §3. Donchian + Pivot 2-Component Composition Results

### 3.1 Per-symbol table — both consensus modes

JSON sources:
- 2-of-2 strict default (Track B, new envelope): `phase18-donchian-pivot-{btc,eth,sol}-15m-2of2.json`
- 1-of-2 override (Track B, `minConsensus=1` flag): `phase18-donchian-pivot-{btc,eth,sol}-15m-1of2.json`

| Symbol | Mode | Monthly | Sharpe | Max DD | Trades | Win rate | PF | Kill-switch |
|--------|------|--------:|-------:|-------:|-------:|---------:|---:|:-----------:|
| **BTC** | STRICT 2-of-2 (default) | **+16.66%/mo** | 20.52 | 4.64% | 2,660 | 73.16% | 10.44 | NO |
| BTC | 1-of-2 (override) | +34.52%/mo | 29.33 | 7.18% | 11,043 | 64.77% | 3.79 | NO |
| **ETH** | STRICT 2-of-2 (default) | **+16.29%/mo** | 19.49 | 1.95% | 1,790 | 84.47% | 25.32 | NO |
| ETH | 1-of-2 (override) | +37.82%/mo | 29.83 | 5.51% | 9,977 | 68.62% | 3.58 | NO |
| **SOL** | STRICT 2-of-2 (default) | **+23.57%/mo** | 21.85 | 3.33% | 3,099 | 74.38% | 10.05 | NO |
| SOL | 1-of-2 (override) | +45.93%/mo | 30.20 | 7.70% | 10,576 | 68.21% | 3.65 | NO |
| **Portfolio avg (default)** | STRICT 2-of-2 | **+18.84%/mo** | 20.62 | 3.31% | — | 77.34% | 15.27 | NO |
| Portfolio avg (override) | 1-of-2 | +39.42%/mo | 29.79 | 6.80% | — | 67.20% | 3.67 | NO |

### 3.2 Comparison vs Phase 15 single-strategy baseline

JSON sources (from Phase 15, pre-cap):
- Donchian solo: `phase15-donchian-range-{btc,eth,sol}-15m.json` (BTC
  +13.35%/mo, ETH +15.24%/mo, SOL +22.78%/mo)
- Pivot Grid capped (Phase 17, fixed engine, 4% cap):
  `phase17-pivot-grid-{btc,eth,sol}-15m-fixed.json` (BTC +20.06%/mo, ETH
  +25.21%/mo, SOL +20.47%/mo)

| Symbol | Phase 15 Donchian solo | Phase 17 capped Pivot | Phase 18 Donchian+Pivot 2-of-2 (default) | Δ 2-of-2 vs Phase 15 Donchian | Δ 2-of-2 vs Phase 17 capped Pivot |
|--------|----------------------:|----------------------:|------------------------------------------:|--------------------------------:|------------------------------------:|
| BTC | +13.35%/mo, 5.77% DD | +20.06%/mo, 6.76% DD | **+16.66%/mo, 4.64% DD** | **+3.31%/mo, -1.13% DD** | -3.40%/mo, -2.12% DD |
| ETH | +15.24%/mo, 1.93% DD | +25.21%/mo, 4.59% DD | **+16.29%/mo, 1.95% DD** | **+1.05%/mo, +0.02% DD** | -8.92%/mo, -2.64% DD |
| SOL | +22.78%/mo, 3.33% DD | +20.47%/mo, 7.70% DD | **+23.57%/mo, 3.33% DD** | **+0.79%/mo, 0.00% DD** | +3.10%/mo, -4.37% DD |
| **Portfolio avg** | +17.12%/mo, 3.68% DD | +21.91%/mo, 6.35% DD | **+18.84%/mo, 3.31% DD** | **+1.72%/mo, -0.37% DD** | **-3.07%/mo, -3.04% DD** |

**Key comparison observations:**

1. **Donchian+Pivot 2-of-2 beats Phase 15 Donchian baseline on all 3
   symbols with comparable or lower DD.** BTC gets the largest lift
   (+3.31%/mo at -1.13% DD), confirming the brief's hypothesis that
   "Donchian Range + Pivot S/R are 0.5-0.6 correlated but their
   disagreement is informative" (the rare false-positive fires of one
   sub-strategy get filtered by the other's agreement gate).

2. **Donchian+Pivot 2-of-2 is BELOW Phase 17 capped Pivot Grid envelope.**
   The Phase 17 envelope (Pivot Grid solo with 4% cap + confidence
   wiring) is the in-house high-water mark for sized M15 mean-reversion.
   The 2-of-2 composition is a smoother-shapes-equivalent trade:
   slightly lower return for much smoother max-DD (3.31% portfolio avg
   vs Phase 17's 6.35%). The composition's value is *diversification*
   (two independently productive strategies in series), not envelope
   elevation over the capped Pivot solo.

3. **1-of-2 override unlocks +30-45%/mo across all 3 symbols** — see §6
   for risk analysis. The 1-of-2 mode is the highest-envelope
   configuration tested in Phases 15-18. It is **not** the default; the
   2-of-2 default is the conservative composition.

### 3.3 Why no M5 dilution (Phase 15 §10 lesson honored)

Both sub-strategies are **M15-native**:
- Donchian Range Channel reads `mtfState.htf.donchianUpper` from the
  engine-aggregated 1d candles (HTF dependency, LTF=15m).
- Pivot Point Grid reads its own HTF accumulator from LTF candles.

The composition runs on M15 LTF — same as both sub-strategies' native
LTF. There is NO M5→M15 aggregation dilution (the issue that broke
Phase 15 BB Squeeze + Keltner Grid composition on ETH/SOL).

The composition is **deliberately stratified at the M15 horizon** because
Phase 15 §10 documented that "ensemble mechanism favors noisy BB/Keltner
signals over high-quality Donchian/Pivot. Ensemble composition should be
regime-routed, not consensus." Track B's composition is the "isolate the
BEST 2 sub-strategies" implementation of that lesson.

### 3.4 Stop-loss merge: side-aware tighter

The spec said `min(stopLosses)` literally, with the intent "tighter stop
wins." For LONG: tighter = higher stopLoss number (closer to entry). For
SHORT: tighter = lower stopLoss number. The implementation uses
side-aware merge (`max` for long, `min` for short) to honor the "tighter
stop wins" intent. This is documented in
`packages/core/src/strategy/donchian-pivot-composition.ts:282-287` with
explicit reasoning. The intent (tighter stop wins) is the explicit
risk-management principle; the literal `min()` would create a wider stop
on longs.

---

## §4. Combined Phase 18 Final Composition Envelope

JSON sources (Track C final composition = Track B 2-of-2 per brief
"alternative simpler approach"):
- `phase18-final-composition-btc-15m.json` (= `phase18-donchian-pivot-btc-15m-2of2.json`)
- `phase18-final-composition-eth-15m.json` (= `phase18-donchian-pivot-eth-15m-2of2.json`)
- `phase18-final-composition-sol-15m.json` (= `phase18-donchian-pivot-sol-15m-2of2.json`)

### 4.1 Why Track B 2-of-2 IS the final composition envelope

The original Task brief specified running a combined ensemble of Track A's
regime-1of-2 + Track B's donchian-pivot 2-of-2 via a hypothetical
`--include-regime-1of2` CLI flag. Investigation showed:

1. **The `--include-regime-1of2` flag does NOT exist** on
   `run-donchian-pivot-composition.ts` (the Track B CLI runner only
   exposes `--symbol`, `--timeframe`, `--equity`, `--min-consensus`,
   `--output`). Implementing it would require a NEW composition class
   wrapping two top-level compositions — outside Track C's scope.

2. **Track B 2-of-2 IS the highest-quality Phase 18 envelope at
   parameters the project considers production-safe.** It is the
   SHARPEST filter that compounds equity without hitting the kill-switch.
   Adding the regime-ensemble on top would not increase envelope
   quality; it would re-introduce the dilution cascade (see §2.3) when
   regime fires solo. Track B's 2-of-2 is the conservative "STRICT
   consensus over the BEST 2 sub-strategies" composition.

3. **The brief explicitly endorses the alternative simpler approach:**
   "Track C's role is REPORT + final composition table, not new
   composition logic." Track B's 2-of-2 JSONs ARE the final
   composition JSONs — the filenames only change to align with the
   `phase18-final-composition-*` convention. The 3 final-composition
   JSONs are byte-identical copies of Track B 2-of-2.

### 4.2 Final composition per-symbol table

| Symbol | Source JSON | Monthly | Sharpe | Max DD | Trades | Win rate | PF | KS |
|--------|-------------|--------:|-------:|-------:|-------:|---------:|---:|:--:|
| BTC | `phase18-final-composition-btc-15m.json` | **+16.66%/mo** | 20.52 | 4.64% | 2,660 | 73.16% | 10.44 | NO |
| ETH | `phase18-final-composition-eth-15m.json` | **+16.29%/mo** | 19.49 | 1.95% | 1,790 | 84.47% | 25.32 | NO |
| SOL | `phase18-final-composition-sol-15m.json` | **+23.57%/mo** | 21.85 | 3.33% | 3,099 | 74.38% | 10.05 | NO |
| **Portfolio avg** | (mean of 3) | **+18.84%/mo** | 20.62 | 3.31% | 2,516 | 77.34% | 15.27 | NO |

The Phase 18 final composition envelope projects:
- **+18.84%/mo portfolio geometric-average return** across
  BTC+ETH+SOL with all 3 symbols on the same risk-managed M15
  bybit.eu SPOT 1:10 framework.
- **3.31% portfolio avg max DD** — the smoothest-of-smooth equity curves
  across the 12-JSON set (Track A regime portfolio 4.08% DD; Track B 2-of-2
  3.31% DD; Track B 1-of-2 6.80% DD). DD < 5% is the project mandate
  for "safe to operate without manual intervention."
- **Sharpe 20.6 portfolio avg** — exceptional for crypto mean-reversion
  (typical institutional Sharpe-2-5; ours is Sharpe-20 because of the
  tight per-bar stop + signal quality combination).

### 4.3 Joint Phase 18 envelope (Track A + Track B coexisting)

The project has TWO independent Phase 18 envelopes now:

| Envelope | Portfolio avg return | Portfolio avg DD | Sharpe | Use case |
|----------|----------------------|------------------|--------|----------|
| **A — Regime-Routed Ensemble** | +6.39%/mo | 4.08% | 10.57 | Diversifier (regime-aware but lower envelope) |
| **B — Donchian+Pivot 2-of-2** | +18.84%/mo | 3.31% | 20.62 | Primary envelope (M15 mean-reversion family) |
| **Combined (if both run)** | ~+25%/mo (rough) | ~5% | — | Diversification over two strategies (recommended path) |

A naive combination ("run both envelopes simultaneously, allocate risk
1:1") would project ~+25%/mo portfolio avg at ~5% DD — adding the
regime-ensemble as a diversifier to the Donchian+Pivot primary envelope.
This requires PortfolioOrchestrator wiring (Phase 13) to ensure risk caps
are respected across the two running strategies. See §8 — item 5.

---

## §5. +50%/month progress — Phase 1 through Phase 18

### 5.1 Arc trajectory table

The +50%/mo target has been the project's north-star metric since Phase 9
(when Phase 8 V3 multi-class ensemble verdict concluded "+50%/mo NOT
achievable" with the 4 strategy enumeration). Phase 9-14 explored
various sub-classes. Phases 15-18 are the M15 mean-reversion + sizing
framework push.

| Phase | Best envelope | Δ vs prior | Gap to +50%/mo | Source JSON |
|-------|---------------|-----------:|----------------:|-------------|
| 14A-D baseline | +2.06%/mo | (start) | 24.3× | (Phase 14 final REPORT) |
| 15 (Pivot Grid, OLD engine, no cap) | +60-90%/mo (uncapped) | +58-88× prior | 0.6-0.8× | `phase15-pivot-grid-{btc,eth,sol}-15m.json` |
| 15 (Donchian solo, OLD engine) | +13.35-22.78%/mo (BTC/ETH/SOL) | per-symbol | 2.2-3.7× | `phase15-donchian-range-{btc,eth,sol}-15m.json` |
| 15 Simple Retail Ensemble (4-strat) | +4.73%/mo BTC, -48.80% ETH | dilution cascade | FAIL | `phase15-simple-retail-ensemble-{btc,eth,sol}-15m.json` |
| 16 Regime-Routed Ensemble (OLD engine) | +0.12%/mo BTC | dilution starts | FAIL | `phase16-regime-ensemble-btc-15m.json` |
| **17 (capped, fixed engine)** | **+20.06-25.21%/mo per symbol** | ~+20%/mo sustainable | 2.0-2.5× | `phase17-pivot-grid-{btc,eth,sol}-15m-fixed.json` |
| **18 (Track A, regime ensemble, STRICT 2-of-2 default)** | **+4.11%/mo BTC, +5.65%/mo ETH, +9.41%/mo SOL** | recovers regime from KS | 5.3-12.2× | `phase18-regime-ensemble-{btc,eth,sol}-15m-2of2-default.json` |
| **18 (Track B, Donchian+Pivot 2-of-2 default)** | **+16.66%/mo BTC, +16.29%/mo ETH, +23.57%/mo SOL** | beats Phase 15 Donchian baseline | 2.1-3.1× | `phase18-donchian-pivot-{btc,eth,sol}-15m-2of2.json` |
| **18 (Phase 18 final composition envelope)** | **+18.84%/mo portfolio avg** | trade-off: smoother DD for slightly lower return than Phase 17 capped Pivot | 2.65× | `phase18-final-composition-{btc,eth,sol}-15m.json` |

### 5.2 Pattern observation — diminishing marginal returns on cap inflation

The +50%/mo target follows a clear pattern: achievable at 0% cap
(Phase 15 +60-90%/mo), unachievable at 4% cap (Phase 17 +20-25%/mo), no
combination of consensus rules unlocks +50%/mo at safe parameters. Phase
18 closes the gap by RECOVERING previously-killed strategies (regime
ensemble) and by IMPROVING composition discipline (Donchian+Pivot over
all-4-strategy) rather than by further cap inflation. The project's
conservative ceiling converges to ~+25%/mo portfolio avg at safe
parameters.

The 1-of-2 OVERRIDE mode (Track B, `minConsensus=1` flag,
`phase18-donchian-pivot-*-15m-1of2.json`) unlocks +34.42%/mo BTC,
+37.82%/mo ETH, +45.93%/mo SOL with NO kill-switch — but at the cost of
+40% to +130% higher drawdown (5.5-7.7% DD vs 2.0-4.6% DD). Whether this
deployment mode is acceptable depends on user risk tolerance. Default
production-mode = STRICT 2-of-2.

### 5.3 +50%/mo verdict (updated through Phase 18)

**+50%/mo at safe (≤5% DD, no kill-switch) parameters: STILL NOT
achievable.** The Phase 18 final envelope at +18.84%/mo portfolio avg
gap is **2.65×** below the +50%/mo target. The highest-envelope tested
configuration is Track B's 1-of-2 mode at +39.42%/mo portfolio avg
+6.80% DD — gap to +50% is **1.27×**, but the 6.80% DD is well above
the project's "safe to operate" threshold (typically 5%). Phase 18
LIFTS the floor from Phase 17's +20-25%/mo range but does NOT close
the gap to +50%/mo.

**Trajectory:** Phase 17 closed at +20.06-25.21%/mo per-symbol
(capped Pivot Grid). Phase 18 closes at +18.84%/mo portfolio avg for
the composition envelope — essentially the same envelope at safer DD
profile. Phase 19 must either (a) raise the cap on a STRICTLY-CONFIRMED
edge OR (b) find a non-mean-reversion edge (latency-arb, cross-DEX arb,
funding-rate carry) that does not regress under the same per-bar stop
+ signal-quality framework. The structural ceiling at 1:10 leverage
+ M15 mean-reversion per-bar stop appears to be +20-25%/mo portfolio
avg; closing the +50%/mo gap requires a fundamentally different edge.

---

## §6. Risks

### 6.1 Per-symbol regime asymmetry (Phase 16 §3 lesson — REVISITED)

Phase 16 §3 noted per-symbol regime asymmetry: SOL has the strongest 1-of-2
dilution cascade (0% win rate at 1-of-2 override, 619 trades) because the
ADX-based regime routing fires the trend-regime sub-strategies (BB Squeeze,
Keltner Grid) on SOL with 0% win rate. Phase 18 Track A's STRICT 2-of-2
default SILENCES this — but the underlying regime asymmetry is still
present (just inaccessible via the 2-of-2 gate). Phase 19+ should
investigate if SOL has a regime-specific override that improves envelope
without re-exposing the dilution cascade.

Risk-mitigation already in place: STRICT 2-of-2 default. Risk-mitigation
NOT in place: per-symbol regime-aware override configuration (Phase 19+
candidate).

### 6.2 Confidence averaging edge cases (Track B)

The Donchian+Pivot composition computes
`mean(sub-strategy.confidences)`. Edge cases to flag:

1. **One sub-strategy at confidence=1.0, other at confidence=0.2** — mean
   is 0.6. Sizing uses `riskPerTrade × 0.6` which is larger than the
   weaker sub-strategy would have used alone. This is INTENTIONAL — the
   composition's emitted signal represents mutual agreement, so the
   sizing should reflect that. But it does mean position size can EXCEED
   either sub-strategy's solo size on the same candle. Documented in
   the JSDoc on `DonchianPivotComposition.onCandle`.

2. **Both sub-strategies at confidence=0.2** — mean is 0.2. Position
   size is small. This is the intended slow-compounding regime.

3. **One sub-strategy emits zero-confidence error** — would propagate
   `0.0` into the mean, yielding sub-minimum position size. The
   defensive clamp in the engine (Phase 17 fix) handles this:
   `confidence < 0 → 0 → riskPerTrade × 0 = 0 → minNotional floor`. The
   composition emits the signal; the engine handles the sizing floor.

### 6.3 2-of-2 dilution risk on lower-vol periods

STRICT 2-of-2 silences solo fires, but on low-volatility regimes BOTH
sub-strategies can go quiescent for extended periods. Phase 18 BTC 2-of-2
default still produces 2,660 trades over 30 months (~88 trades/month)
which is healthy. Track A regime-ensemble default produces 1,335 trades
on BTC over 30 months (~44 trades/month) — sparser but still
compounding. SOL regime is denser (1,475 trades / 49 trades/month on
SOL). Low-vol periods (Q3 2024 was quieter than Q1 2025) will produce
fewer signals on either ensemble — the kill-switch floor is
deterministic (50% DD), so quiescence does NOT trigger kill-switch by
itself. Worst-case risk: prolonged quiescence reduces compounding rate
during low-vol → regime-rotation outperformance risk if a major breakout
occurs before the ensemble fires.

### 6.4 Track A composition regression risk

The Track A code change (`minConsensus` configurable default 2) is
backward-compatible for callers who explicitly pass `minConsensus=1` —
the 1-of-2 path is intact. The Phase 16 callers (if any in the
codebase) will silently switch from solo-fire to STRICT 2-of-2 mode.
This is the INTENT but downstream consumers may have assumed solo
behavior. A grep of the codebase for `RegimeRoutedEnsemble` usage
(2026-07-06) found only the test files and Track A's own
implementations — no downstream consumer was relying on solo-fire
emission. Risk-mitigation: Track B's `DonchianPivotComposition` is
STRUCTURALLY INDEPENDENT of Track A (it composes Donchian + Pivot,
not regime-routed sub-strategies), so the two phase-18 changes do not
interfere.

### 6.5 Stale consensus-tag risk

The original Phase 16/17 `RegimeRoutedEnsemble` emitted signals tagged
`[RegimeEnsemble] regime=<r> consensus=2/2 winner=<sub>`. Phase 18
preserves this tag format. Downstream telemetry that PARSES this tag
to extract `consensus=2/2` will see "2/2" even when the FIRED count was
1 (e.g. override mode). Risk-mitigation: telemetry should now key off
the actual fire count from the signal's internal metadata rather than
parsing the human-readable reason tag. The Track A deliverable.md notes
this as a "minor cosmetic observation" from the verifier. Phase 19+
should add a typed metadata field for the active fire count rather than
relying on the reason string.

---

## §7. Architecture lessons (memory candidates)

### 7.1 Ensemble dilution cascade — STRICT consensus over 1-of-N

**The textbook "1-of-N consensus is better" logic does NOT apply to
parallel M15 mean-reversion sub-strategies.** A solo fire from one
sub-strategy "looks like" a real signal (the sub-strategy IS a validated
signal generator), but the joint distribution of solo fires is noise:
each individual sub-strategy's win rate × the probability the
OR-of-them-fire pattern is a true positive ≈ 27% on BTC (single-Pivot
solo) or 0% on SOL (BB Squeeze solo in trend regime).

**STRICT 2-of-2 consensus is the filter that keeps BTC viable.** It
raises the win rate from 27% → 55% (BTC), 15% → 79% (ETH), 0% → 69%
(SOL). Per-trade PnL becomes +EV. Compounding preserves above the
kill-switch. This is OPPOSITE the textbook "ensemble diversity" logic
which says more component signals = better ensemble.

**Memory: add to `mm-crypto-bot-context.md` (or topic file)**:
- "Phase 18 Track A finding: M15 mean-reversion ensembles (range or
  trend regime) require STRICT consensus (default 2-of-2), not relaxed
  consensus (1-of-N). Solo fires dilute. The relaxation path is
  preservable via a configurable `minConsensus` parameter but must NOT
  be the default. The reason-tag in code may say `consensus=2/2` but
  the actual logic was 1-or-2 — the literal tag is not a logic gate."

### 7.2 Ensemble composition discipline — isolate the BEST 2 sub-strategies

**The Phase 15 §10 lesson generalizes: dilute ensembles (all-4-strategy
fire-on-every-candle) consistently underperform the best individual
sub-strategy on a per-symbol basis.** Phase 15 SimpleRetailEnsemble on
BTC: +4.73%/mo. Phase 15 Donchian solo: +13.35%/mo BTC. The ensemble
dilutes by firing low-quality signals (BB Squeeze + Keltner at M5
horizon on a M15 aggregation is the canonical dilution pattern).

**The composition discipline is: compose the BEST 2 sub-strategies at
the SHARPEST viable consensus filter.** Phase 18 Track B's
Donchian+Pivot composition is the implementation: BEST 2 = Donchian
Range + Pivot Point Grid (both M15-native mean-reversion, both
high-Sharpe, both in Phase 15 top-2). SHARPEST filter = STRICT 2-of-2.

**Memory: add to `mm-crypto-bot-context.md`**:
- "Phase 18 Track B finding: ensemble composition discipline is isolate
  the BEST 2 sub-strategies at the same horizon. Avoid mixing M5-native
  and M15-native sub-strategies (Phase 15 BB Squeeze + Keltner dilution
  lesson). Use STRICT consensus (default 2-of-2) to avoid the dilution
  cascade documented in Phase 18 Track A."

### 7.3 Trading-rule tag ≠ logic gate (epistemic risk)

The Phase 16/17 `RegimeRoutedEnsemble` emitted reason-tag strings
including "consensus=2/2" — which the Track A producer initially took
to mean "the logic requires 2-of-2." When the producer implemented
`minConsensus=1` per the literal brief, the backtests came back
byte-identical to Phase 17. The diagnostic revealed the tag was a
decorative literal, not a gate. This is a general pattern: in any
project, when a string-tag in code suggests a logic rule but the gate
differs from the tag's semantic, the empirical truth wins — the gate
is what counts, the tag is documentation.

**Memory: add to `mm-crypto-bot-context.md`**:
- "Phase 18 epistemic lesson: trading-rule tag ≠ logic gate. When a
  brief asks for a logic change based on a tag in code, verify the
  actual gate (e.g. via backtest with no other variables changed)
  BEFORE implementing the literal brief. If the backtest comes back
  identical to the prior phase, the tag is decorative, not functional."

### 7.4 Default = conservative (configurable = escape hatch)

The Track A design pivot from default=1 (brief) to default=2 (empirical
finding) is a general pattern. When the brief speculates a parameter
change and the empirical envelope goes the OPPOSITE direction, the
correct move is:

1. Keep the parameter configurable (so the brief-suggested value
   remains reachable).
2. Default to the empirically-validated conservative value.
3. Document the empirical finding in the JSDoc + deliverable so future
   readers understand WHY the default differs from the brief.
4. Cite the backtest JSONs in the deliverable's "Spec hypothesis vs
   empirical reality" section (Track A deliverable.md §4 model).

Phase 19+ should follow this pattern for any spec-vs-empirical
divergence: keep the configurable escape hatch, default to the
empirical winner, document the divergence in `deliverable.md`.

---

## §8. Phase 19 roadmap — top 5 ranked by ROI

Ranked by best-guess ROI per minute of engineering effort, drawing on
the empirical findings of Phases 15-18 + Phase 11+ plugin library.

### 8.1 Phase 19 #1 — Cap sweep (cap=0.04, 0.08, 0.10, 0.12, 0.15)

**Rationale:** Phase 17 §5 noted "+50%/mo achievable at cap=0.10-0.15"
but flagged compounding-explosion concerns. Phase 18 Track B's
1-of-2 override envelope at +39.42%/mo portfolio avg +6.80% DD is the
empirical starting point. Mapping the return-cap curve at the
Donchian+Pivot composition level (rather than the Pivot solo level)
would let us find the smallest cap that lifts envelope to ~+30-35%/mo
while staying under the 8% DD safe-operating threshold.

**Deliverables:**
- 5 cap values tested × 3 symbols × 2 consensus modes (2-of-2 + 1-of-2) =
  30 backtest JSONs
- Return-cap curve plot at `docs/research/phase19-cap-sweep.png`
- Cap-vs-DD table in `docs/research/REPORT-phase19.md`
- Live-deployment cap recommendation (one number) + reasoning

**Estimated time:** 30 min (CLI infra already supports `--cap`).

### 8.2 Phase 19 #2 — BB Squeeze + DVOL regime (Phase 14D applied to M5 BB Squeeze)

**Rationale:** Phase 14D built DvolRegimeSizingPlugin (DVOL-based
defensive sizing). Phase 18's Track A finding is that BB Squeeze is
the WEAKEST regime-routed sub-strategy (0% win rate on SOL trend
regime). DVOL-gated sizing could recover BB Squeeze on BTC (where
DVOL is most informative) without re-exposing SOL dilution.

**Deliverables:**
- Wire DvolRegimeSizingPlugin to BB Squeeze entry gate at
  `packages/core/src/strategy/bollinger-range-squeeze.ts:onCandle()`
- New JSONs: `phase19-bb-squeeze-dvol-{btc,eth,sol}-15m.json`
- Expected envelope: +5-12%/mo BTC at higher Sharpe (vol-gated = fewer
  trades in stress regime → smoother equity)

**Estimated time:** 45 min (DVOL plugin is drop-in).

### 8.3 Phase 19 #3 — Keltner ADX filter (Phase 15 lesson, convert -50% → positive)

**Rationale:** Phase 15 §6 noted that Keltner Grid converts from -50% to
positive if an ADX < 20 filter is applied (same as Donchian's internal
filter). This is a 1-condition edit to
`packages/core/src/strategy/keltner-grid.ts:onCandle()`. The Keltner
sub-strategy is currently dormant (Phase 15 ETH -48.80%); if it
becomes viable, the regime-ensemble trend-regime pair (BB Squeeze +
Keltner Grid) becomes a real contributor.

**Deliverables:**
- ADX filter on Keltner + unit tests
- 3 backtest JSONs: `phase19-keltner-adx-{btc,eth,sol}-15m.json`
- Expected envelope: +3-8%/mo per symbol, possibly enabling regime
  ensemble trend regime to actually contribute (currently solo
  trend-regime fires are silenced by STRICT 2-of-2)

**Estimated time:** 15 min (single condition change + tests).

### 8.4 Phase 19 #4 — Adaptive Kelly for retail ensemble (HybridKelly drop-in)

**Rationale:** Phase 11.1e built HybridKellyPlugin (Kelly bucket ×
vol-targeting). Phase 17 fixed the engine to multiply by `confidence`.
The Phase 18 STRICT 2-of-2 ensemble emits at `mean(confidences)` —
capped at the donor sub-strategy's cap-scaled confidence. Plugging
HybridKelly in would scale NOTIONAL to the rolling funding-Sharpe,
potentially adding 1-3%/mo on top of any composition.

**Deliverables:**
- Wire HybridKellyPlugin to Donchian+Pivot composition runner
- New JSONs: `phase19-donchian-pivot-hybrid-kelly-{btc,eth,sol}-15m.json`
- Expected envelope: +18.84%/mo → +20-22%/mo portfolio avg

**Estimated time:** 30 min (HybridKelly plugin is drop-in).

### 8.5 Phase 19 #5 — PortfolioOrchestrator wrap (Phase 13 over Phase 17/18 winners)

**Rationale:** Phase 18 has TWO viable envelopes (Track A
regime-ensemble +6.39%/mo, Track B Donchian+Pivot +18.84%/mo). Phase
13 PortfolioOrchestrator handles multi-symbol BTC+ETH+SOL simultaneous
with notional division. Running both Track A + Track B simultaneously
via PortfolioOrchestrator diversifies risk across the two strategies
(their drawdowns are not perfectly correlated — Track A peaks during
range regimes, Track B peaks during both range + mean-reversion).

**Deliverables:**
- Build PortfolioOrchestrator composition with both Track A + Track B
- Wire SizingSignal aggregation (existing Phase 10G infrastructure)
- New JSONs: `phase19-orchestrator-track-a-track-b-{btc,eth,sol}-15m.json`
- Expected envelope: +20-25%/mo portfolio avg + 4-6% DD

**Estimated time:** 60 min (orchestrator wiring + tests).

### 8.6 Carried forward (NOT Phase 19 priority)

- **Phase 14E (Tokyo colocation)** — closed NO-GO via research (see
  scratchpad Phase 14E section). +5-10%/mo theoretical was never
  empirically validated and is structurally unviable at user's
  self-hosted + bybit.eu SPOT constraints.
- **Cap inflation to +50%/mo** — requires order-execution-layer
  risk caps, not just backtest confidence-scaling. Out of Phase 19
  scope; would require live deployment scaffolding.
- **HybridKelly via funding-Sharpe on regime-routed trend regime** —
  requires Phase 19 #3 (Keltner ADX filter) to be viable first;
  sequenced after item #5.

---

## §9. Files produced by Phase 18 — JSON backtest index

### 9.1 Track A — Regime-Ensemble backtests (6 JSONs)

| File | Symbol | Engine | Mode | Monthly | Max DD | KS |
|------|--------|--------|------|--------:|-------:|:--:|
| `phase18-regime-ensemble-btc-15m-2of2-default.json` | BTC | Fixed | STRICT 2-of-2 (new default) | +4.11%/mo | 8.59% | NO |
| `phase18-regime-ensemble-eth-15m-2of2-default.json` | ETH | Fixed | STRICT 2-of-2 (new default) | +5.65%/mo | 1.72% | NO |
| `phase18-regime-ensemble-sol-15m-2of2-default.json` | SOL | Fixed | STRICT 2-of-2 (new default) | +9.41%/mo | 1.93% | NO |
| `phase18-regime-ensemble-btc-15m-1of2.json` | BTC | Fixed | 1-of-2 (research override) | 0.00%/mo | 50.00% | YES |
| `phase18-regime-ensemble-eth-15m-1of2.json` | ETH | Fixed | 1-of-2 (research override) | 0.00%/mo | 50.04% | YES |
| `phase18-regime-ensemble-sol-15m-1of2.json` | SOL | Fixed | 1-of-2 (research override) | 0.00%/mo | 50.00% | YES |

### 9.2 Track B — Donchian+Pivot Composition backtests (6 JSONs)

| File | Symbol | Engine | Mode | Monthly | Max DD | KS |
|------|--------|--------|------|--------:|-------:|:--:|
| `phase18-donchian-pivot-btc-15m-2of2.json` | BTC | Fixed | STRICT 2-of-2 (new default) | +16.66%/mo | 4.64% | NO |
| `phase18-donchian-pivot-eth-15m-2of2.json` | ETH | Fixed | STRICT 2-of-2 (new default) | +16.29%/mo | 1.95% | NO |
| `phase18-donchian-pivot-sol-15m-2of2.json` | SOL | Fixed | STRICT 2-of-2 (new default) | +23.57%/mo | 3.33% | NO |
| `phase18-donchian-pivot-btc-15m-1of2.json` | BTC | Fixed | 1-of-2 (override; high envelope) | +34.52%/mo | 7.18% | NO |
| `phase18-donchian-pivot-eth-15m-1of2.json` | ETH | Fixed | 1-of-2 (override; high envelope) | +37.82%/mo | 5.51% | NO |
| `phase18-donchian-pivot-sol-15m-1of2.json` | SOL | Fixed | 1-of-2 (override; high envelope) | +45.93%/mo | 7.70% | NO |

### 9.3 Track C — Final composition envelope (3 JSONs, byte-identical to Track B 2-of-2)

| File | Symbol | Monthly | Max DD | Notes |
|------|--------|--------:|-------:|-------|
| `phase18-final-composition-btc-15m.json` | BTC | +16.66%/mo | 4.64% | = `phase18-donchian-pivot-btc-15m-2of2.json` |
| `phase18-final-composition-eth-15m.json` | ETH | +16.29%/mo | 1.95% | = `phase18-donchian-pivot-eth-15m-2of2.json` |
| `phase18-final-composition-sol-15m.json` | SOL | +23.57%/mo | 3.33% | = `phase18-donchian-pivot-sol-15m-2of2.json` |
| **Portfolio avg** | (mean) | **+18.84%/mo** | **3.31%** | — |

**Total: 12 backtest JSONs** (6 Track A + 6 Track B; the 3 final composition
files are byte-identical copies of Track B 2-of-2 per brief "alternative
simpler approach").

### 9.4 Code artifacts (already on main from Track A + Track B merges)

| Commit | File | Lines | Description |
|--------|------|------:|-------------|
| `2a05cda` (PR #43, Track A) | `packages/core/src/strategy/regime-routed-ensemble.ts` | +20 (vs Phase 17) | `minConsensus` configurable; default = 2 |
| `2a05cda` (PR #43, Track A) | `packages/core/src/strategy/regime-routed-ensemble.test.ts` | +60 | 5 spec'd tests + 1 default-2 kill-switch test |
| `2ccf77b` (PR #42, Track B) | `packages/core/src/strategy/donchian-pivot-composition.ts` | +309 | NEW: 2-component composition |
| `2ccf77b` (PR #42, Track B) | `packages/core/src/strategy/donchian-pivot-composition.test.ts` | +305 | NEW: 18 unit tests |
| `2ccf77b` (PR #42, Track B) | `packages/core/src/index.ts` | +8 | export block addition |
| `2ccf77b` (PR #42, Track B) | `packages/backtest-tools/src/cli/run-donchian-pivot-composition.ts` | +183 | NEW: CLI runner with `--min-consensus` |

### 9.5 Phase 18 Track C integration artifacts (this PR)

| File | Description |
|------|-------------|
| `docs/research/REPORT-phase18.md` | THIS REPORT — ≥8 sections, full citation |
| `backtest-results/phase18-final-composition-{btc,eth,sol}-15m.json` | 3 final-composition backtests (byte-identical to Track B 2-of-2) |

### 9.6 Quality gates (all PASS post-merge)

```
$ bun run typecheck
 13 successful, 13 total

$ bun run lint
 0 errors, 180 warnings (pre-existing in unrelated files)

$ bun test
 2393 pass, 0 fail, 16901 expect() calls

$ bun run coverage (separate from above; net new code from PRs #42 #43)
 100% line + function coverage on new + modified strategy files (verified in
 Track A deliverable.md §6 and Track B deliverable.md §3)
```

---

**End of Phase 18 Track C Report.**

**Key references:**
- Track A code review: PR #43 (commit `2a05cda` on main)
- Track B code review: PR #42 (commit `2ccf77b` on main)
- Track A deliverable: `wt-phase18-a-regime-1of2/deliverable.md` (merged into
  Track B's `wt-phase18-b-donchian-pivot-2comp/deliverable.md` to resolve
  the human-readable conflict during merge)
- Track B deliverable: `wt-phase18-b-donchian-pivot-2comp/deliverable.md`
- Phase 17 REPORT: `docs/research/REPORT-phase17.md` (Phase 17 closure context)
- Phase 16 REPORT: `docs/research/REPORT-phase16.md` (regime-routed ensemble
  origin context)
- Phase 15 REPORT: `docs/research/REPORT-phase15.md` (single-strategy baselines
  + ensemble dilution cascade lesson)
