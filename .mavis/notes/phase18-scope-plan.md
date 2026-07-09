# Phase 18 — Regime-Ensemble 1-of-2 + Donchian/Pivot 2-component Composition

**Date:** 2026-07-06 23:05 Budapest (Europe/Budapest, UTC+2)
**Status:** SCOPING. Plan spawn imminent.
**Branch base:** `main` @ `34f8bc0` (Phase 17 closure, engine confidence-wired)
**Author:** orchestrator (this session, post Phase 17 disk-verified closure)

---

## 0. Doctrine reminder (HOT memory, top of file)

- **1:10 leverage MANDATORY** on all NEW code paths (3-layer defense)
- **100% unit test coverage** on NEW files (lcov.info direct read, NOT test output summary)
- **No eslint-disable** — fix root cause
- **No docstring lies** — JSDoc must match implementation
- **Per-symbol signal-flow verification** (Phase 14A lesson) — every symbol needs a DirectionSignal source
- **Producer gh CLI auth gap** — worktree lacks keyring → orchestrator-side PR creation (Phase 13/14/15 precedent)
- **Verifier-mandate conflict pattern** — user spec is authoritative
- **Multi-track integration timeout ≥45min** (Phase 15D/16 lesson)
- **Cycle-1 → manual_retry** with 5-8 step correction spec; cycle-2 owner-self-push on mechanical; cycle-3 escalate

---

## 1. Phase 17 closure (empirical baseline for Phase 18)

**Engine fix** (`packages/backtest/src/engine.ts:252-275`, commit `6f49f6b`): multiplies `opts.positionSize.riskPerTrade` by `clampedConfidence = clamp(signal.confidence, 0, 1)` before passing to `positionNotionalUsd()`.

**Empirical envelope (M15, bybit.eu SPOT 1:10, 30.2mo, Phase 17 §3):**

| Strategy | Symbol | Engine | Cap | Monthly | Max DD | Sharpe | Trades |
|----------|--------|--------|-----|--------:|-------:|-------:|-------:|
| Pivot Grid | BTC | Fixed | 0.04 | +20.06% | 6.76% | 24.96 | 9717 |
| Pivot Grid | ETH | Fixed | 0.04 | +25.21% | 4.59% | 27.57 | 9668 |
| Pivot Grid | SOL | Fixed | 0.04 | +20.47% | 7.70% | 21.39 | 8317 |
| Regime Ensemble | BTC | Fixed | engine | 0.00% | 50.00% | -0.50 | 1265 (kill-switch) |
| Regime Ensemble | ETH | Fixed | engine | (not run in Phase 17) | | | |
| Regime Ensemble | SOL | Fixed | engine | (not run in Phase 17) | | | |
| Donchian Range | BTC | (Phase 15) | engine | +13.35% | 5.77% | 16.30 | (single-strat) |
| Donchian Range | ETH | (Phase 15) | engine | +15.24% | 2-6% | 16-19 | (single-strat) |
| Donchian Range | SOL | (Phase 15) | engine | +22.78% | 2-6% | 16-19 | (single-strat) |

**Key Phase 17 verdict (REPORT-phase17 §5):** Realistic capped Pivot Grid envelope is +20–25%/mo. **+50%/mo target NOT achievable at 4% cap** (would require cap=0.10–0.15, reintroducing compounding-explosion).

---

## 2. Phase 18 motivation

Phase 17 §8 ranked 7 candidates for Phase 18. Top 2 selected by ROI + independence:

**#1 — Regime-Ensemble 1-of-2 consensus relaxation (HIGH, 30 min est.)**
- Phase 16 §3 finding: 2-of-2 consensus was too strict → BTC regime ensemble hit kill-switch at 0.00%/mo
- Dropping to 1-of-2 (either sub-strategy fires → emit) likely lifts BTC regime ensemble from 0.00%/mo to +5-15%/mo
- Cheap change: ~5 LOC in `regime-routed-ensemble.ts`, 1 parameter flip
- Validates that regime routing itself is viable (not just the consensus rule)

**#2 — Donchian + Pivot 2-component composition (HIGH, 30 min est.)**
- Both M15-native (no M5 aggregation issue that killed Phase 16 BB/Keltner)
- Both mean-reversion family, complementary (Donchian = range, Pivot = S/R levels)
- Phase 15 §10 noted: "ensemble mechanism favors noisy BB/Keltner signals over high-quality Donchian/Pivot. Ensemble composition should be regime-routed, not consensus."
- Phase 16 attempt with all 4 sub-strategies failed (regime dilution + M5 aggregation)
- Phase 18 isolates the best 2 sub-strategies with 2-of-2 (or 1-of-2) consensus
- Expected: +15-25%/mo BTC on top of single-strategy baseline

**Combined envelope projection:** Regime 1-of-2 (low-confidence) + Donchian/Pivot 2-component (high-confidence) could push realistic envelope to **+15-30%/mo** — meaningful step toward +50%/mo without cap inflation.

---

## 3. Phase 18 plan structure (3 tracks, depends_on A+B → C)

### Track A — Regime-Ensemble 1-of-2 consensus relaxation

**Owner:** coder (single-track, no M2 needed)
**Worktree:** `wt-phase18-a-regime-1of2` → branch `feat/phase18-a-regime-1of2`
**Base:** main @ 34f8bc0 (Phase 17 fixed engine)
**Timeout:** 45min (small change, but integration risk if I miss something)

**Deliverables:**
1. Modify `packages/core/src/signal-center/plugins/regime-routed-ensemble.ts` — change consensus threshold from 2-of-2 to 1-of-2 (configurable via `minConsensus` option, default 1)
2. Tests: 5 new unit tests covering (a) 1-of-2 with both fire, (b) 1-of-2 with one fire, (c) 0-of-2 no signal, (d) 2-of-2 still works (backward compat), (e) maxPositionPctEquity preserved
3. Quality gates: typecheck + lint + test + coverage 100% on the modified file
4. 3 backtest JSONs: BTC/ETH/SOL @ 15m regime ensemble with 1-of-2 + fixed engine
5. PR `feat/phase18-a-regime-1of2` → main (orchestrator-side gh auth)

### Track B — Donchian + Pivot 2-component composition

**Owner:** coder
**Worktree:** `wt-phase18-b-donchian-pivot-2comp` → branch `feat/phase18-b-donchian-pivot-2comp`
**Base:** main @ 34f8bc0 (Phase 17 fixed engine)
**Timeout:** 60min (new composition class + tests)

**Deliverables:**
1. New file: `packages/core/src/signal-center/plugins/donchian-pivot-composition.ts`
   - Wraps `DonchianRangeChannel` + `PivotPointGrid`
   - Configurable `minConsensus` (default 2-of-2 — both must fire)
   - Same `StrategyPlugin` interface as `SimpleRetailEnsemble` / `RegimeRoutedEnsemble`
   - Confidence = mean of sub-strategy confidences
   - Per-symbol position sizing inherited from each sub-strategy's signal.confidence
2. Tests: 8 unit tests covering (a) both fire → emit, (b) only Donchian fire → no emit, (c) only Pivot fire → no emit, (d) neither → no emit, (e) confidence averaging, (f) signal fields merged correctly, (g) 1-of-2 mode (parameter), (h) backward compat with both fire at conf=0.5
3. Quality gates: typecheck + lint + test + coverage 100% on new file
4. 3 backtest JSONs: BTC/ETH/SOL @ 15m with new composition + fixed engine (both 2-of-2 default AND 1-of-2 variant = 6 JSONs total)
5. PR `feat/phase18-b-donchian-pivot-2comp` → main

### Track C — Integration + REPORT-phase18.md

**Owner:** coder (M2)
**Worktree:** `wt-phase18-c-integration-report` → branch `feat/phase18-c-integration-report`
**Base:** main (after A+B merged)
**Timeout:** 60min (integration + report)
**depends_on:** `phase18-a-regime-1of2`, `phase18-b-donchian-pivot-2comp`

**Deliverables:**
1. Verify both A+B merged to main (`grep` for Track A changes + import check for Track B's new class)
2. Final composition envelope: run `Donchian + Pivot 2-component` + `Regime 1-of-2` as a final composition on BTC/ETH/SOL (3 JSONs)
3. `docs/research/REPORT-phase18.md`:
   - §1 Executive Summary: verdict on regime 1-of-2 relaxation + Donchian/Pivot 2-component
   - §2 Regime-Ensemble 1-of-2 results: per-symbol table comparing 2-of-2 vs 1-of-2 on fixed engine
   - §3 Donchian + Pivot 2-component results: per-symbol table comparing both single-strategy, all-4-strategy ensemble, and 2-component ensemble
   - §4 Combined envelope: portfolio avg with all Phase 18 strategies (regime 1-of-2 + 2-component)
   - §5 +50%/mo progress: updated arc trajectory table
   - §6 Risks: per-symbol regime asymmetry, 2-of-2 dilution risk, confidence averaging edge cases
   - §7 Architecture lessons (memory candidates)
   - §8 Phase 19 roadmap: cap sweep (Phase 17 #4), BB Squeeze + DVOL regime (Phase 17 #5), Adaptive Kelly (Phase 17 #6), PortfolioOrchestrator wrap (Phase 17 #7)
4. Quality gates: typecheck + lint + test all PASS
5. PR `feat/phase18-c-integration-report` → main

### Quality gates (ALL phases)
- `bun run typecheck` — 13/13 packages PASS
- `bun run lint` — 0 errors
- `bun test` — full suite PASS (regression verified)
- Coverage 100% on new files (lcov.info direct read, NOT test output summary)

---

## 4. Success criteria (Phase 18 closure)

- 3 PRs merged to main (Track A, B, C)
- Track A regime ensemble BTC envelope > 0.00%/mo (Phase 17 baseline) — minimum +2%/mo, target +5-15%/mo
- Track B Donchian+Pivot BTC envelope > +13.35%/mo (Phase 15 single-strat baseline) — minimum +15%/mo, target +20-30%/mo
- REPORT-phase18.md ≥8 sections, ≥2500 words, every numerical claim cites a JSON path
- +50%/mo verdict updated: still NOT achievable, but realistic envelope projection ≥+20%/mo combined

---

## 5. Phase 19+ roadmap (for REPORT §8)

Based on Phase 17 §8 + Phase 18 outcome:

1. **Cap sweep** (cap=0.04, 0.08, 0.10, 0.12, 0.15) — map return–cap curve for informed live deployment
2. **BB Squeeze + DVOL regime** (Phase 14D DVOL applied to M5 BB Squeeze) — survival under DVOL gating
3. **Keltner ADX filter** (Phase 15 lesson — convert -50% → positive)
4. **Adaptive Kelly for retail ensemble** (HybridKelly drop-in)
5. **PortfolioOrchestrator wrap** (Phase 13 over Phase 17/18 winners)
6. **Phase 20+ re-eval of +50%/mo** with full envelope data

**Parked (user constraint / structural):**
- Tokyo / Singapore co-location (Phase 14E NO-GO)
- Cloud VPS (user self-hosted-only constraint)
- Latency-arb (5-50ms budget at user's RTT)
- On-chain microstructure (perp-DEX only, bybit.eu SPOT-only)

---

## 6. Hygiene plan (post-Phase 18)

- 6 phase worktrees removed (wt-phase18-a/b/c × 2 each = wt-phase18-{a,b,c}-1, -2 for parallel-track workers)
- 3 phase branches deleted (local + remote, after squash-merge)
- `git fetch --prune` to clean remote refs
- `git worktree list` post-cleanup: only main checkout

---

**End of Phase 18 scope plan.** Plan YAML at `.mavis/plans/phase18-regime-1of2-donchian-pivot-2comp.yaml` (to be created at launch).