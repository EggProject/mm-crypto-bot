# Phase 22 — Funding-Rate Carry Leg (SCOPE PLAN)

**Date:** 2026-07-07 18:00 (Europe/Budapest)
**Author:** Mavis orchestrator
**Status:** SCOPE DRAFT — ready for team-plan spawn
**Empirical baseline:** Phase 19 #1 (cap=0.12 1-of-2, +32.24%/mo portfolio avg @ 4.70% max-DD, main @ 8c56e2a)
**Projected lift:** +2-5 pp/mo portfolio avg → +34-37%/mo portfolio avg
**+50%/mo gap after Phase 22:** 1.55× short → 1.35-1.45× short

---

## §1 Why Phase 22 is the next lever

Per `docs/research/REPORT-phase20.md` §5.2 and `docs/research/REPORT-phase21.md` §8 (both kept on `main` after the Phase 20-21 revert), the next lever on the +50%/mo roadmap is **funding-rate carry**. Both reports reaffirm this priority after Phase 20 and Phase 21 were empirically refuted.

**Why this lever has potential (theoretical basis):**
- The Donchian+Pivot composition is a **trend-following** strategy (64-68% win-rate, regime-INVARIANT)
- Funding-rate carry is a **different edge** — earning the funding-rate payment by holding the right side of a perpetual swap
- The two edges can be combined: Donchian+Pivot chooses direction, funding-rate carry adds a return stream that compounds on top

**Why Phase 20/21 lessons apply:**
- The "edge" of funding-rate carry is **additive** (it doesn't scale the existing strategy's sizing), so it should be implemented as a **new DirectionSignal source** in the SCv1, NOT as a per-bar sizing modifier on the existing composition
- The CLI flag must either work or error (no silent no-op per §7 of the archive doc)
- The bit-identical-trade-stream probe verifies the wire-up is real (not silent-no-op)

---

## §2 Architecture decision

**Decision: Architecture A (strategy-internal funding-rate carry signal), built on existing carry infrastructure.**

**Rationale:**
- Phase 21 #1 used Architecture A (strategy-internal regime-conditioning) and the wire-up was provably engaged (NOT-silent-no-op verified). Architecture A is the proven approach.
- Phase 20 #1 attempted Architecture B (SCv1-throughout) and the wire-up was a silent no-op for the CLI runner. Architecture B requires a SCv1-throughout refactor that is out of scope for Phase 22.
- The existing carry infrastructure in `packages/core/src/signal-center/plugins/` (carry-baseline-plugin, cross-dex-funding-watcher-plugin, cross-symbol-funding-differential-plugin) provides the funding-rate signal generation. Phase 22 reuses + integrates, doesn't rebuild.

**Implementation outline:**
- **New strategy module:** `packages/core/src/strategy/funding-rate-carry-composition.ts` (~600 LOC)
  - Wraps the existing `DonchianPivotComposition` (Phase 18-19) and adds a 3rd signal source: funding-rate carry
  - Reads funding-rate history from `CsvExchangeFeed` (or equivalent)
  - Emits a `DirectionSignal` with `side: long | short | flat` based on funding-rate sign + magnitude
  - Combines with Donchian + Pivot via 2-of-3 STRICT consensus (default) or 1-of-3 (escape hatch)
- **CLI flag:** `--enable-funding-rate-carry` (parses, validates, engages, **emits a hard error if the funding-rate data file is missing** — no silent no-op per Phase 20 lessons)
- **Optional flag:** `--funding-rate-carry-mode=2of3|1of3` (default 2of3 STRICT)

**Funding-rate data source:**
- For backtest: CSV file with `timestamp, symbol, fundingRate` per row (3 symbols × 8h intervals = ~270 rows per 30-month window)
- For live: bybit.eu perp funding-rate REST endpoint
- Backtest-only: the CSV is a 3rd data source alongside the M15 OHLCV candle data

---

## §3 Track structure

### Track A — Funding-rate carry strategy module + 100% tests
- `packages/core/src/strategy/funding-rate-carry-composition.ts` (~600 LOC)
  - Reads funding-rate history from CSV
  - Emits DirectionSignal based on funding-rate sign + magnitude (with hysteresis to prevent whipsaw)
  - Combines with Donchian + Pivot via configurable consensus
- `packages/core/src/strategy/funding-rate-carry-composition.test.ts` (~700 LOC, ≥25 unit tests)
  - Funding-rate sign logic (positive → long bias, negative → short bias, neutral → flat)
  - Magnitude scaling (small funding = weak signal, large funding = strong signal)
  - Hysteresis (don't flip on every bar; require 2+ consecutive bars of opposite sign)
  - Missing-data fallback (default to flat if CSV is missing or empty)
  - 1:10 leverage audit
- `packages/feed/src/csv-funding-rate-feed.ts` (~300 LOC, new)
  - Loader for the funding-rate CSV
  - Validates schema, emits descriptive errors for missing/malformed files
- `packages/feed/src/csv-funding-rate-feed.test.ts` (~400 LOC, ≥10 unit tests)
- **Quality gates:** typecheck 13/13, lint 0 errors, ≥35 unit tests, 100% line coverage on new code
- **Verifier checklist:**
  - Docstring-vs-implementation parity (no docstring lies)
  - No `eslint-disable` lines
  - No "DEFERRED (own PR)"
  - 1:10 leverage invariant preserved (max effective leverage ≤ 10× equity)
  - No silent no-op: missing CSV must throw, not return zero/empty

### Track B — CLI wire-up + integration into runner
- `packages/backtest-tools/src/cli/run-funding-rate-carry-composition.ts` (NEW runner, ~150 LOC)
  - Separate CLI runner (not the existing `run-donchian-pivot-composition.ts` to avoid Phase 20-style silent no-op)
  - Flags: `--enable-funding-rate-carry`, `--funding-rate-mode=2of3|1of3`, `--funding-rate-csv-path=<path>`
  - **Hard error if `--enable-funding-rate-carry=true` but `--funding-rate-csv-path` is missing or file doesn't exist** (no silent no-op)
- `packages/backtest-tools/src/cli/run-donchian-pivot-composition.ts` (no changes — separate runner for Phase 22)
- Integration test: `run-funding-rate-carry-composition.test.ts` (~300 LOC, ≥8 tests)
  - Verify CLI flag engages the funding-rate path
  - Verify hard error on missing CSV
  - Verify 1:10 leverage invariant
- **Quality gates:** typecheck, lint, ≥8 integration tests, 100% line coverage on new code
- **Verifier checklist (CRITICAL — Phase 20 lessons applied):**
  - **Bit-identical-trade-stream probe:** diff trade-by-trade between `--enable-funding-rate-carry=false` and `=true` runs. Must show real engagement (different notionals OR different trades).
  - Win-rate per symbol check: must be byte-equal between on/off (proves the toggle is a signal source, not a strategy change).
  - **NOT-silent-no-op:** trade stream must differ (or notionals must differ) between on/off.
  - **Hard error path:** if funding-rate CSV is missing, CLI must error immediately, not run a no-op backtest.

### Track C — 12 backtest sweep + REPORT + PR
- 9 backtests at `backtest-results/phase22-funding-rate-carry-{2of3,1of3}-{btc,eth,sol}-15m-{0.08,0.12,0.15}.json`
- 3 baseline reference backtests at `backtest-results/phase22-baseline-1of2-{btc,eth,sol}-15m-0.12.json` (no-funding-rate, cap=0.12 control arm)
- Funding-rate CSV at `backtest-results/funding-rate-history-{btc,eth,sol}-2024-01-01_2026-07-03.csv` (synthetic or real, documented)
- `docs/research/REPORT-phase22.md` (~3500 words, 11 sections, all numerical claims cite specific JSON paths)
- PR opened against `main` (do NOT merge before user review)
- **Quality gates:** typecheck 13/13, lint 0 errors, 12 backtests, REPORT covers all 5 success criteria from §4
- **Verifier checklist:**
  - Bit-identical-trade-stream probe: as Track B
  - Win-rate per symbol byte-equal between with/without funding-rate
  - Funding-rate CSV is present and well-formed
  - 1:10 leverage audit on all 12 cells
  - DD budget check: max DD ≤ 8% for all 12 cells
  - Funding-rate distribution printed up-front (per Phase 21 NOT-silent-no-op defense pattern)

---

## §4 Success criteria

Phase 22 #1 is **SUCCESS** if **ALL** of the following hold:

1. **Envelope lift ≥ +2 pp/mo** at the primary cap=0.12 1-of-2 portfolio-avg cell. (Brief target: +32.24% → ≥ +34.24%.)
2. **9/9 funding-rate-carry cells reproduce Phase 19 baseline + lift** — none of the 9 funding-rate-carry envelopes is a clear regression (i.e., no cell loses >2 pp vs Phase 19 same-cap).
3. **3/3 baseline controls match Phase 19 within 0.03 pp** (regression anchor — proves the wire-up is bit-identical when funding-rate is OFF).
4. **NOT-silent-no-op verified** via bit-identical-trade-stream probe (Track B + Track C verifier).
5. **1:10 leverage invariant preserved** — max effective leverage ≤ 10× equity in all 12 cells.
6. **DD budget preserved** — max DD ≤ 8% safe-operating threshold in all 12 cells.

If criteria 1-2 are missed (envelope lift < +2 pp or any cell regresses >2 pp), Phase 22 #1 is **NEGATIVE** and the brief's "do NOT silently rubber-stamp" override clause applies.

---

## §5 Pre-flight (lessons from Phase 20/21)

From `docs/research/PHASE-20-21-ARCHIVE.md` §9:

1. **Edge-INVARIANCE test:** split historical backtest by funding-rate sign (positive vs negative vs neutral), compare win-rate per bucket. **If the spread is < 5 pp, the funding-rate classifier is not a winning-trade filter and the modifier will not lift the envelope meaningfully.** Phase 22 #1 must report this in §3 of REPORT-phase22.md.

2. **Geometric-compounding math:** the funding-rate carry leg adds a per-bar income stream (e.g., 0.01% per 8h funding payment ≈ 0.03% per day ≈ 1% per month). At 1:10 leverage, this is 10% per month if 100% of capital is deployed. Phase 22 #1 should target deployment of 50-80% of capital in the carry leg, yielding +0.5-0.8% per month at 1:10. Lift depends on how this stacks with the existing +32.24% baseline.

3. **Bit-identical-trade-stream probe:** as described in §3 Track B + Track C verifier checklists.

4. **CLI flag handling:** `--enable-funding-rate-carry` either works or errors. No silent no-op.

5. **Compensating alpha source:** Phase 22 #1's claimed +2-5 pp/mo lift comes from the funding-rate carry leg's per-bar income stream, NOT from a sizing modifier on the existing Donchian+Pivot composition. The brief's success criterion 1 quantifies the lift directly.

If any of these 5 conditions is not met at scope-plan time, the brief is rejected (no producer cycle).

---

## §6 Risks and known issues

| Risk | Probability | Severity | Mitigation |
|------|------------:|---------:|------------|
| Funding-rate history is noisy (sign flips multiple times per week) | MEDIUM | MEDIUM | Hysteresis logic: require 2+ consecutive bars of opposite sign before flipping DirectionSignal side |
| Funding-rate magnitude varies wildly (5 bps to 50 bps per 8h) | HIGH | LOW | Magnitude scaling: small funding = weak signal (low confidence), large funding = strong signal (high confidence) |
| 30-month backtest window may not capture current funding regime | MEDIUM | MEDIUM | Use the same 2024-01-01 → 2026-07-03 window as Phase 19 #1 for apples-to-apples comparison |
| bybit.eu funding-rate data may not be available historically | MEDIUM | MEDIUM | Synthesize plausible funding-rate history from price drift + funding-rate equilibrium (document as synthetic caveat in REPORT §6.1) |
| Funding-rate carry could conflict with Donchian+Pivot's 2-of-2 STRICT consensus | LOW | LOW | Use 2-of-3 STRICT consensus (1 signal can disagree) — preserves the Phase 19 #1 envelope when funding-rate is flat |
| Regime-INVARIANT edge lesson (Phase 21) doesn't apply to funding-rate carry | LOW | n/a | Funding-rate carry is a DIFFERENT edge (income stream, not sizing modifier). Regime-INVARIANCE test still applies as a pre-flight check. |

---

## §7 File layout

New files to be created in Phase 22 #1:
```
packages/core/src/strategy/funding-rate-carry-composition.ts        (~600 LOC)
packages/core/src/strategy/funding-rate-carry-composition.test.ts   (~700 LOC, ≥25 tests)
packages/feed/src/csv-funding-rate-feed.ts                          (~300 LOC, new feed type)
packages/feed/src/csv-funding-rate-feed.test.ts                     (~400 LOC, ≥10 tests)
packages/backtest-tools/src/cli/run-funding-rate-carry-composition.ts  (~150 LOC, new runner)
packages/backtest-tools/src/cli/run-funding-rate-carry-composition.test.ts (~300 LOC, ≥8 tests)
backtest-results/phase22-funding-rate-carry-{2of3,1of3}-{btc,eth,sol}-15m-{0.08,0.12,0.15}.json  (9 files)
backtest-results/phase22-baseline-1of2-{btc,eth,sol}-15m-0.12.json  (3 files)
backtest-results/funding-rate-history-{btc,eth,sol}-2024-01-01_2026-07-03.csv  (3 files, may be synthetic)
docs/research/REPORT-phase22.md  (~3500 words, 11 sections)
docs/research/NEGATIVE-RESULT.md  (if applicable, per §4 override clause)
```

No changes to existing files in `packages/core/src/signal-center/` (carry plugins are reused as-is).

---

## §8 Effort estimate

- Track A: ~3-4 hours producer + ~1 hour verifier
- Track B: ~2-3 hours producer + ~1.5 hours verifier (extra time for bit-identical-trade-stream probe + NOT-silent-no-op defense)
- Track C: ~3-4 hours producer (12 backtests + REPORT) + ~2 hours verifier (12 JSONs + REPORT cross-check + PR review)
- **Total:** ~12-16 hours wall-clock, ~$0.50-0.80 USD (assuming existing per-trade-Hybrid-Kelly rate)

---

## §9 Next steps

1. **Spawn team plan** with 3 tracks (A: module, B: wire-up, C: sweep + REPORT + PR)
2. **Set up monitor cron** for the team plan (similar to phase20-monitor / phase21-bc-monitor pattern)
3. **Watch for verifications** — Track C verifier MUST use the bit-identical-trade-stream probe + win-rate byte-equal check + NOT-silent-no-op defense
4. **User review** — Phase 22 #1 PR is held OPEN (not merged) until user reviews the empirical verdict
5. **If POSITIVE** → squash-merge to main, update project memory with Phase 22 envelope, propose Phase 23 candidates
6. **If NEGATIVE** → close PR, write NEGATIVE-RESULT.md, pivot to next candidate (Adaptive Kelly per-symbol, trailing-stop Donchian, or cross-DEX funding arb)

---

**End of phase22-scope-plan.md (DRAFT)**
