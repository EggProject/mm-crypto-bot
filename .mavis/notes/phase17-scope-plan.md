# Phase 17 — Engine-side confidence → notional wiring (cap fix #1)

**Created:** 2026-07-06 21:42 Budapest
**Status:** SCOPE — green light given, launching immediately
**Owner:** Mavis (orchestrator) + coder + verifier

---

## Why this phase

Phase 16 PR #37 squash-merged to main at `baf821c`. Critical finding from REPORT-phase16.md §1:

> The Phase 16 "4% notional cap" is **functionally a no-op** — `applyCap()` scales `signal.confidence` to 0.20, but `positionNotionalUsd` in `packages/backtest/src/engine.ts:252` never reads `signal.confidence`. Engine-side `maxPositionPctEquity = 0.20` is the only effective constraint. Phase 16 capped backtest is byte-identical to Phase 15 uncapped.

Phase 17 fixes the wiring: multiply `opts.positionSize.riskPerTrade` by `signal.confidence` in the engine before calling `positionNotionalUsd`. This makes strategy-side confidence actually affect position sizing.

**Secondary goal:** re-run the Pivot Grid with the fix applied and measure whether the "+20-50%/mo realistic envelope with 4% cap" from Phase 16 scope §2 is achievable.

---

## Scope (2 parallel tracks → 1 integration track, ~75 min total)

### Track A — Engine confidence wiring (coder, 20 min)

**File:** `packages/backtest/src/engine.ts`

**Change:** At the `positionNotionalUsd` call site (around line 252), multiply `riskPerTrade` by `signal.confidence`:

```typescript
// BEFORE (line 252-257):
const notional = positionNotionalUsd(
  equity,
  ltfCandle.close,
  signal.stopLoss,
  opts.positionSize,
);

// AFTER:
const confidenceScaledRisk = opts.positionSize.riskPerTrade * signal.confidence;
const notional = positionNotionalUsd(
  equity,
  ltfCandle.close,
  signal.stopLoss,
  { ...opts.positionSize, riskPerTrade: confidenceScaledRisk },
);
```

**Tests:** Add 5 tests in `packages/backtest/src/engine.test.ts` (or a new `confidence-scaling.test.ts`):

1. `confidence=1.0` → `riskPerTrade` unchanged (equivalent to Phase 15 behavior)
2. `confidence=0.7` → `riskPerTrade` scaled to 70% (pivot shallow entry)
3. `confidence=0.0` → position size = minNotional (zero-confidence signal suppressed)
4. `confidence=0.2` → `riskPerTrade` scaled to 20% (Phase 16 4% cap effect)
5. `confidence` clamped to `[0, 1]` before multiplication (defensive)

**Coverage:** 100% lines + branches on the modified `engine.ts` call site block. Read `lcov.info` directly after `bun test --coverage`.

**Existing strategy tests:** Run full suite (`bun test`) to verify no regression across all strategies that emit `confidence` (Pivot Grid, Regime Ensemble, BB Squeeze, etc.).

### Track B — Capped Pivot Grid re-run (coder M2, 45 min, independent of Track A)

**Files:** `backtest-results/phase17-pivot-grid-{btc,eth,sol}-15m-confidence-scaled.json`

Re-run Pivot Grid backtest for BTC/ETH/SOL with the engine fix applied. No CLI change needed — the fix is engine-internal. The Pivot Grid will emit `confidence=0.7` (shallow) and `confidence=1.0` (deep), and the engine will now scale `riskPerTrade` accordingly:

| Entry type | Signal confidence | Effective riskPerTrade | Position notional |
|---|---|---|---|
| Deep (S2/R2) | 1.0 | 1.0 × 0.01 = 1.0% equity | capped by maxPositionPctEquity=0.20 |
| Shallow (S1/R1) | 0.7 | 0.7 × 0.01 = 0.7% equity | smaller notional (stop further from entry) |

**CLI (existing, no changes needed):**
```bash
bun run packages/backtest-tools/src/cli/run-pivot-grid-baseline.ts \
  --symbol=BTC/USDT --timeframe=15m \
  --output=backtest-results/phase17-pivot-grid-btc-15m-confidence-scaled.json
# repeat for ETH/USDT and SOL/USDT
```

**Also re-run Phase 16's capped version for comparison:**
```bash
bun run packages/backtest-tools/src/cli/run-pivot-grid-baseline.ts \
  --symbol=BTC/USDT --timeframe=15m --max-position-pct-equity=0.04 \
  --output=backtest-results/phase17-pivot-grid-btc-15m-04cap.json
```

### Track C — Integration + REPORT (coder M2, 15 min, depends on A+B)

**Files:**
- `packages/backtest/src/engine.ts` (Track A)
- `packages/backtest/src/engine.test.ts` (Track A tests)
- `backtest-results/phase17-pivot-grid-{btc,eth,sol}-15m-confidence-scaled.json` (3 JSONs)
- `backtest-results/phase17-pivot-grid-{btc,eth,sol}-15m-04cap.json` (3 JSONs)
- `docs/research/REPORT-phase17.md`

**REPORT sections (in order, all REQUIRED):**

1. **Executive summary** — engine fix verdict: did confidence wiring change the Pivot Grid envelope? Comparison vs Phase 15 (no cap) and Phase 16 (no-op cap).
2. **Engine fix: confidence → notional** — before/after code diff, mechanism explanation, why this is the correct place for the fix.
3. **Pivot Grid re-run: confidence-scaled** — per-symbol table (BTC/ETH/SOL), compare vs Phase 15 no-cap baseline and Phase 16 no-op cap.
4. **Pivot Grid re-run: 4% cap with fix** — does the engine fix + 4% cap = different from engine fix alone? Quantify.
5. **Is +20-50%/mo achievable?** — Update Phase 16 §2's speculative claim with empirical data from Track B.
6. **Regime-Routed Ensemble: no regression** — verify the engine fix doesn't break the Phase 16 regime ensemble (re-run BTC at minimum).
7. **Risks** — confidence=0 signals (minNotional behavior), strategies that emit confidence>1 (not expected but possible).
8. **Phase 18 roadmap** — #2 regime-ensemble 1-of-2 consensus, #3 Donchian+Pivot composition, #5 Keltner ADX filter.

**Acceptance:**
- typecheck PASS, lint PASS, test PASS (≥5 new tests for confidence wiring)
- coverage 100% on `engine.ts` modified block (lcov.info direct read)
- 6 new JSON backtest files committed
- REPORT ≥8 sections, ≥2500 words
- PR opened: `feat/phase17-confidence-notional-wiring → main`
- deliverable.md at worktree root

---

## Workflow

1. **Orchestrator** creates worktrees:
   - `wt-phase17-a` on `feat/phase17-a-confidence-wiring`
   - `wt-phase17-b` on `feat/phase17-b-pivot-confidence-scaled`

2. **Track A** (parallel with B) — engine fix + tests, ~20 min
3. **Track B** (parallel with A) — backtest re-runs, ~45 min
4. **Orchestrator** squash-merges A into main, then B into main, creates `wt-phase17-c`
5. **Track C** — runs remaining backtests, writes REPORT, ~15 min
6. **Verifier** validates all 3 tracks
7. **Orchestrator** opens PR, writes deliverable.md, cleans up

---

## Memory rules active

- **1:10 leverage MANDATORY** — engine fix preserves 1:10 leverage; `confidence × riskPerTrade` is a pre-leverage risk scaling
- **No docstring lies** — JSDoc on the engine call site must explain why confidence is multiplied in
- **No eslint-disable** — fix root cause
- **Coverage 100% on modified file** — read lcov.info directly
- **REPORT empirical claims → JSON envelope file paths** — every number traces to a backtest-results JSON
- **Track C pre-set timeout ≥60 min** (Phase 16 lesson: 30 min structurally insufficient for multi-backtest + REPORT)

---

## Phase 18+ roadmap (out of scope for Phase 17)

Per Phase 16 §8 ranking:
- **#2 Regime-Ensemble 1-of-2 consensus relaxation** (30 min) — drop 2-of-2 to 1-of-2, likely lifts regime ensemble from +0.12%/mo to +5-15%/mo
- **#3 Donchian + Pivot 2-component composition** (30 min) — both M15-native, no M5 aggregation issue
- **#5 Keltner ADX filter** (15 min) — ADX < 20 gate on Keltner Grid (Phase 15 §6 noted this converts -50% to positive)
- **#4 BB Squeeze + DVOL regime** (30 min) — Phase 14D DVOL sizing applied to M5 breakout
- **#6 Adaptive Kelly for retail ensemble** (30 min) — Phase 11.1e HybridKellyPlugin drop-in
- **#7 PortfolioOrchestrator wrap** (45 min) — Phase 13 orchestrator × Phase 16 ensemble
