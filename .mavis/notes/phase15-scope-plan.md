# Phase 15 scope plan — Simple Retail Strategies

**Status:** SCOPED, pending team-plan launch
**Author:** mavis orchestrator (Phase 14 closure → Phase 15 kickoff)
**Date:** 2026-07-06 19:15 Budapest
**Phase:** 15 (range-bound / mid-frequency retail, distinct from Phase 1-14 trend/carry/microstructure family)

---

## Context (mandate chain)

### Phase 14A-D arc — CLOSED, code merged
- 14A — multi-symbol cross-symbol plugin wiring (PR #29 → main)
- 14B — aggressive parameter relaxation to 15% DD target (PR #30 → main)
- 14C — engine audit + 12-trade cap + correlation tuning (PR #31 → main)
- 14D — DVOL regime sizing plugin (PR #32 → main @ `a00bf78`)
- Final envelope: **+2.06%/mo portfolio, Sharpe 1.31, 10.58% max DD, 0 liquidations**

### Phase 14E — Tokyo colocation research — CLOSED NO-GO
- 10 parallel research agents, 1,440+ source citations, ~470KB / ~5,500 lines of REPORT.md
- **USER CONSTRAINT DECLARED 2026-07-06 18:58 Budapest:** self-hosted only, no SLA-grade ping, no server spend
- Tokyo / Singapore / cloud VPS all violate constraint
- Structural ceiling: **+2%/mo at $10k book × 1:10 leverage × bybit.eu × self-hosted × variable-latency edge**
- +50%/mo target permanently structurally unreachable

### Phase 15 mandate (user 2026-07-06 19:09 Budapest, this session)
- "van barmi amit kod miatt le kene zarni?" → Phase 14 closure (orphan worktree + stale remote branch — both DONE)
- "mehet a phase 15" → green light to proceed

**Phase 15 thesis:** since the institutional / HFT / microstructure family is exhausted, try **simple mid-frequency RETAIL strategies** that work at home RTT. These are range-bound / grid / channel strategies at M5/M15 timeframes — orthogonal to existing trend-following + carry + signal-center alpha streams. If even one delivers +0.3-0.5%/mo on its own, composition with the existing +2%/mo baseline adds 15-25%.

---

## Hard constraints (carried from project memory)

- **1:10 leverage MANDATORY** (bybit.eu SPOT ceiling, can't relax)
- **bybit.eu SPOT-only** (no margin futures, MiCAR EU scope)
- **Self-hosted only** (user constraint 2026-07-06)
- **15% DD target** (user mandate 2026-07-06 13:06)
- **Max 12 simultaneous trades** across all 3 pairs (4 per symbol, 4 per pair)
- **100% unit-test coverage on NEW files** (per Phase 11+ convention, lcov.info direct read)

---

## Scope: 4 new retail strategies + ensemble + report

| # | Strategy | Timeframe | Type | Why this one |
|---|----------|-----------|------|--------------|
| 1 | **Pivot Point Grid** (PP/S1/S2/R1/R2/R3) | M15 | Range grid | Pivot points are deterministic (no fitting), work on every instrument, clear range bounds. "Different grid" — pivot-anchored vs %-band grids. Fibonacci multipliers (0.382/0.618/1.0) of (H-L) range. |
| 2 | **Bollinger Range Squeeze** | M5 | Range breakout | Tight-band detection (bbWidth < threshold) → expansion trade in either direction with confirmed breakout. Catches the M5 regime where M15 trend strategies miss. |
| 3 | **Donchian Range Channel** | M15 | Range | Pure range channel — buy at DonchianLower, sell at DonchianUpper, stop outside. "Range strategy" of Phase 15 brief. |
| 4 | **Volatility-Adaptive Grid** (Keltner-based) | M5/M15 | Grid | Grid type #2 — Keltner-channel-anchored grid (EMA20 ± 1.5×ATR). Auto-resizes to ATR. Different from #1 (pivot) and existing strategies. |

**Plus a 5th OPTIONAL** if viability check passes:
- **M1 Order-Flow Imbalance Scalp** — only if home RTT shows sub-50ms order-book latency is plausible. 1-line probe: pull order-book at M1, compute top-of-book imbalance, fade extreme imbalances.

**Why this ordering (agent-ranked, user did not override):**
1. Pivot Grid — most "different from anything we have" — pure mean-reversion in deterministic band, no fitting
2. BB Squeeze — uses existing BB indicator, proven indicator family
3. Donchian Range — uses existing Donchian, simplest possible range
4. Keltner Grid — uses existing EMA + ATR, complementary to pivot grid

---

## Pre-step: M5/M15 data download (orchestrator executes directly)

**Why pre-step:** M5 and M15 CSVs do not exist yet. `download-ohlcv.ts` hardcodes 1h/4h/1d. The 4 strategies cannot be backtested without M5/M15 data. Pre-step is mechanical and well-bounded (~10 min wall time for download).

**Tasks:**
1. Extend `packages/backtest-tools/src/cli/download-ohlcv.ts` to support `5m` and `15m` timeframes (add to `TIMEFRAMES` constant; `fetchAllCandles` is already timeframe-agnostic)
2. Run download for BTC/USDT, ETH/USDT, SOL/USDT × 5m + 15m, 2024-01-01 → today
3. Verify CSVs: row count, first/last timestamp, sha256 integrity
4. Update CLI runners that hardcode `if (tf !== "1h" && tf !== "4h" && tf !== "1d")` to accept `5m` and `15m` (run-baseline.ts is one; others similar)
5. Update `MANIFEST.json` schema (add 5m/15m entries)

**Time budget:** ~15 minutes wall time (download dominates; rate-limit 200ms × 600 calls ≈ 2 min for 15m, 8 min for 5m, plus file IO)

**Output:**
- `data/ohlcv/binance_{btc,eth,sol}_5m.csv` (~210k rows each)
- `data/ohlcv/binance_{btc,eth,sol}_15m.csv` (~70k rows each)
- Updated `MANIFEST.json` with 6 new entries

---

## Track structure (team plan, 4 tracks)

### Track A — Data + CLI (parallel with B, C)
**Owner:** coder
**Depends on:** nothing (run after orchestrator pre-step data download completes — A verifies data, no download itself)
**Scope:**
- Verify M5/M15 CSV integrity (row count, no gaps > 5min for 5m / > 15min for 15m)
- Update any CLI runners with hardcoded `1h/4h/1d` validator to accept `5m` and `15m`
- Add `timeframesFor(timeframe)` branch for `5m` (HTF=1d, MTF=1h, LTF=5m) and `15m` (HTF=1d, MTF=4h, LTF=15m)
- Add unit tests for the new `timeframesFor` branches
- (Pivot points, Keltner channel — inline math in strategy .ts files, no new indicator module)

**Estimated LOC:** 80-150 + tests
**Estimated time:** 20-30 min
**Verifier:** `verifier` agent, check that 5m/15m work end-to-end on a known run

### Track B — Strategies 1 + 2 (parallel with A, C)
**Owner:** coder
**Depends on:** nothing (strategies are pure logic, can be coded without backtest data)
**Scope:**
- **B1. `packages/core/src/strategy/pivot-point-grid.ts`** (~200 LOC)
  - Computes daily pivots from previous HTF (1d) candle: PP = (H+L+C)/3, R1/S1 = PP±0.382×(H-L), R2/S2 = PP±0.618×(H-L), R3/S3 = PP±(H-L)
  - At M15 LTF, when close touches S1/S2 → buy signal, target = PP, stop = S3
  - At M15 LTF, when close touches R1/R2 → sell signal, target = PP, stop = R3
  - Confidence: 1.0 if at S2/R2, 0.7 if at S1/R1
  - Unit tests: 8-12 tests covering all pivot levels, missing-data cases, position already open
- **B2. `packages/core/src/strategy/bollinger-range-squeeze.ts`** (~200 LOC)
  - Detect squeeze: bbWidth = (bbUpper - bbLower) / bbMiddle < squeezeThreshold (e.g., 0.02)
  - On breakout: if close > bbUpper → buy, target = bbUpper + 2×ATR, stop = bbMiddle
  - On breakout: if close < bbLower → sell, target = bbLower - 2×ATR, stop = bbMiddle
  - Require 2+ consecutive squeeze candles before breakout counts (filter for false breakouts)
  - Unit tests: 10-14 tests covering squeeze detection, breakout direction, missing BB data

**Estimated LOC:** 400-500 + 20-25 tests
**Estimated time:** 35-50 min
**Verifier:** `verifier`, check unit tests pass + coverage ≥100% on new files

### Track C — Strategies 3 + 4 (parallel with A, B)
**Owner:** coder
**Depends on:** nothing
**Scope:**
- **C1. `packages/core/src/strategy/donchian-range-channel.ts`** (~150 LOC)
  - At M15 LTF: long when close ≤ DonchianLower(20), short when close ≥ DonchianUpper(20)
  - Stop: DonchianLower - ATR for long, DonchianUpper + ATR for short
  - Take profit: opposite Donchian band
  - Skip if ADX > 25 (trending market, range strategy doesn't apply)
  - Unit tests: 8-10 tests covering range detection, trend filter, missing Donchian data
- **C2. `packages/core/src/strategy/keltner-grid.ts`** (~250 LOC)
  - Keltner channel: upper = EMA20 + 1.5×ATR, lower = EMA20 - 1.5×ATR
  - Grid: 5 levels inside Keltner band (at 20%/40%/60%/80% of band)
  - At M5 LTF, place limit orders at grid levels (simplified: emit signal at each level touched)
  - Long bias when above EMA, short bias when below EMA
  - Stop: opposite Keltner band
  - Unit tests: 12-15 tests covering grid construction, level-to-signal mapping, regime filter

**Estimated LOC:** 400-500 + 20-25 tests
**Estimated time:** 35-50 min
**Verifier:** `verifier`, check unit tests pass + coverage ≥100% on new files

### Track D — Backtests + Ensemble + REPORT (depends on A, B, C)
**Owner:** coder
**Depends on:** A (data verified), B (Pivot + BB Squeeze), C (Donchian + Keltner)
**Scope:**
- 4 baseline backtest CLI runners:
  - `run-pivot-grid-baseline.ts` — M15, BTC/ETH/SOL, 2024-01-01 → today
  - `run-bb-squeeze-baseline.ts` — M5, BTC/ETH/SOL, 2024-01-01 → today
  - `run-donchian-range-baseline.ts` — M15, BTC/ETH/SOL, 2024-01-01 → today
  - `run-keltner-grid-baseline.ts` — M5, BTC/ETH/SOL, 2024-01-01 → today
  - Each outputs JSON to `backtest-results/phase15-baseline-{strategy}-{symbol}-{timeframe}.json`
  - Cost model: bybit.eu SPOT 1:10 (existing constants from run-baseline.ts)
- `packages/core/src/strategy/simple-retail-ensemble.ts` (~300 LOC, with tests)
  - Composes 4 strategies: Pivot + BB Squeeze + Donchian Range + Keltner Grid
  - On each candle, run all 4 sub-strategies; pick highest-confidence signal
  - If conflict (long + short both fire) → emit `null` (defer, no position)
  - If only long or only short signals → emit first non-null (FIFO order)
  - Unit tests: 10-15 tests covering all-conflict, all-flat, all-bull, all-bear, mixed cases
- `run-simple-retail-ensemble.ts` CLI runner — backtest the ensemble on BTC/ETH/SOL
- `backtest-results/REPORT-phase15.md` (~5,000-7,000 words) with sections:
  - §1 — Executive summary (4 strategies + ensemble envelope, +50%/mo verdict at this scope)
  - §2 — Phase 14A-D baseline reminder (apples-to-apples reference)
  - §3 — Strategy 1: Pivot Grid (backtest envelope + win rate + DD)
  - §4 — Strategy 2: BB Squeeze (backtest envelope + win rate + DD)
  - §5 — Strategy 3: Donchian Range (backtest envelope + win rate + DD)
  - §6 — Strategy 4: Keltner Grid (backtest envelope + win rate + DD)
  - §7 — simple-retail-ensemble envelope (per-symbol + portfolio, vs Phase 14A-D baseline)
  - §8 — Cross-strategy correlation (Pivot vs BB vs Donchian vs Keltner — should be orthogonal, mean-reversion family)
  - §9 — Regime sensitivity (which strategy works in which regime)
  - §10 — +50%/mo verdict (still not achievable; realistic envelope X%/mo at Phase 15 composition)
  - §11 — Risks: regime change, spread widening, 5m/15m noise floor
  - §12 — Open decisions for user (Phase 16+ candidates)

**Estimated LOC:** 600-800 + tests + REPORT
**Estimated time:** 50-70 min
**Verifier:** `verifier`, check (a) all 4 baselines reproduce, (b) ensemble reproduces, (c) REPORT envelope matches JSON, (d) coverage ≥100% on ensemble file

---

## Per-track timeouts

Per Phase 14 lesson (Phase 14B timeout): **extend at plan-launch, not near deadline**. Each track gets **50 min** initial timeout (conservative — Track D is most complex).

| Track | Initial timeout | Notes |
|-------|----------------:|-------|
| A — Data + CLI | 50 min | Light work, mostly verification |
| B — Strategies 1+2 | 50 min | 2 strategies × 200 LOC + tests |
| C — Strategies 3+4 | 50 min | 2 strategies × 200-250 LOC + tests |
| D — Backtest + Ensemble + REPORT | 60 min | Most complex, largest output |

**Failure handling (per memory doctrine):**
- Cycle 1 FAIL → manual_retry with 5-8 step correction spec, "DO NOT REWRITE"
- Cycle 2 FAIL on mechanical step only → owner-self-push + override_accept
- Cycle 2 FAIL on substantive → manual_retry again
- Cycle 3 FAIL → owner escalation to user, NO loop

---

## Memory + doctrine reminders for producers + verifiers

Encode in producer + verifier prompts:
- **1:10 leverage MANDATORY** (config validator rejects >10, no override)
- **100% unit-test coverage on NEW files** (lcov.info direct read, no producer-summary)
- **Docstring-vs-implementation lie** check (Phase 10G lesson — JSDoc claims must match code)
- **No "DEFERRED (own PR)"** — all findings fixed in same PR cycle
- **Per-track isolated worktree** — one worktree per track (created at spawn time)
- **Per-track squash-merge** at end — single PR per track

---

## Success criteria

1. ✅ All 4 strategies implemented + unit tests pass + ≥100% line coverage on new files
2. ✅ All 4 baseline backtests run on BTC/ETH/SOL × M5/M15 = 12 JSONs in `backtest-results/`
3. ✅ `simple-retail-ensemble` implemented + unit tests pass + ≥100% coverage
4. ✅ Ensemble backtest runs on BTC/ETH/SOL = 3 JSONs
5. ✅ `REPORT-phase15.md` exists, envelope claims match JSON output bit-for-bit
6. ✅ All 4 (or 5) feature branches pushed to origin
7. ✅ All 4 (or 5) PRs squash-merged to main
8. ✅ Updated `CHANGELOG` / `board.md` with Phase 15 closure
9. ✅ Memory updated with Phase 15 lessons (range-strategy ≠ carry-strategy backtest envelope)

---

## Out of scope (deferred to Phase 16+)

- **M1 order-flow imbalance scalp** — needs viability check on home RTT; if sub-50ms plausible, Phase 16
- **Pivot Grid v2 with adaptive multipliers** — only if Phase 15 Pivot delivers positive alpha
- **BB Squeeze + Vol-Target sizing composition** — Phase 16 if both 14D DVOL + 15 BB Squeeze work
- **Trailing-stop overlay for Donchian Range** — already exists in Phase 7 (could plug in)
- **Adaptive Kelly for retail ensemble** — Phase 9E HybridKelly already exists, could retrofit
- **Cross-symbol composition** — Phase 15 strategies are per-symbol, like Phase 14A-D architecture
- **Latency-arb, on-chain microstructure, perp-DEX sniping** — Phase 14E confirmed NO-GO at user's constraints

---

## Risk register

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| M5/M15 data download fails (rate limit, exchange) | LOW | HIGH | Pre-step done by orchestrator with retry; verify before team plan launch |
| BB Squeeze / Keltner Grid don't fire (low-vol regime missing) | MEDIUM | MEDIUM | Each strategy expected to be partial-pass; ensemble composites all 4 |
| Range strategies conflict with existing trend/carry | LOW | LOW | Phase 15 strategies are independent `Strategy` classes, run separately. No integration with SCv1 in Phase 15 |
| Coverage < 100% on new files | MEDIUM | HIGH | Verifier enforces; producer reminded in prompt |
| Per-track timeout too short | MEDIUM | MEDIUM | 50min initial (60min for D); extend at first sign of slow progress |
| Ensemble correlation too high (all 4 strategies same regime) | MEDIUM | MEDIUM | If observed, REPORT §8 discloses; recommend fewer strategies in composition |

---

## Deliverables checklist (final state at Phase 15 close)

- [ ] 4 new strategy files in `packages/core/src/strategy/`
- [ ] 4 new test files in `packages/core/src/strategy/`
- [ ] 6 new CSV files in `data/ohlcv/`
- [ ] 1 new ensemble file + tests
- [ ] 4 new baseline CLI runners + 1 ensemble CLI runner
- [ ] 12 baseline backtest JSONs in `backtest-results/phase15-baseline-*.json`
- [ ] 3 ensemble backtest JSONs in `backtest-results/phase15-ensemble-*.json`
- [ ] `backtest-results/REPORT-phase15.md` (~5-7k words)
- [ ] 4 PRs squash-merged to main
- [ ] `board.md` updated with Phase 15 closure entry
- [ ] Memory updated with Phase 15 lessons
- [ ] `backtest-results/phase15-*.json` committed to main

---

**Next action:** orchestrator creates worktree `feat/phase15-simple-retail`, executes pre-step (data download + CLI update), then launches team plan with 4 tracks.