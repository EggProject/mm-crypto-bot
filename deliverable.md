# Phase 17 Track C — Integration + REPORT-phase17.md

**Status:** COMPLETE
**Date:** 2026-07-06 22:50 Budapest (UTC+2)
**Branch:** `feat/phase17-c-integration-report` → PR #41
**Author:** coder (Phase 17 Track C M2)

---

## Handoff

Track C (Integration) is complete. Tracks A+B were both merged to main before Track C started:
- Track A (PR #39 `6f49f6b`): engine confidence → notional wiring — MERGED
- Track B (PR #40 `153ceef`): 6 pivot-grid backtest JSONs (nocap + 4% cap) — MERGED
- Track C (PR #41): 4 fixed-engine backtests + REPORT-phase17.md — OPEN

---

## Deliverables

### 1. Backtest JSONs (10 total)

| File | Engine | Cap | Monthly return | Max DD | Trades |
|------|--------|-----|---------------:|-------:|-------:|
| `phase17-pivot-grid-btc-15m-fixed.json` | Fixed (PR #39) | 0.04 | +20.06%/mo | 6.76% | 9717 |
| `phase17-pivot-grid-eth-15m-fixed.json` | Fixed (PR #39) | 0.04 | +25.21%/mo | 4.59% | 9668 |
| `phase17-pivot-grid-sol-15m-fixed.json` | Fixed (PR #39) | 0.04 | +20.47%/mo | 7.70% | 8317 |
| `phase17-regime-ensemble-btc-15m-fixed.json` | Fixed (PR #39) | engine | 0.00%/mo | 50.00% | 1265 |
| `phase17-pivot-grid-btc-15m-nocap.json` | Old | None | +60.07%/mo | 6.77% | 9717 |
| `phase17-pivot-grid-eth-15m-nocap.json` | Old | None | +90.33%/mo | 5.39% | 9668 |
| `phase17-pivot-grid-sol-15m-nocap.json` | Old | None | +78.86%/mo | 7.57% | 8317 |
| `phase17-pivot-grid-btc-15m-04cap.json` | Old | 0.04 | +60.07%/mo | 6.77% | 9717 |
| `phase17-pivot-grid-eth-15m-04cap.json` | Old | 0.04 | +90.33%/mo | 5.39% | 9668 |
| `phase17-pivot-grid-sol-15m-04cap.json` | Old | 0.04 | +78.86%/mo | 7.57% | 8317 |

Tracks B's 6 old-engine JSONs (nocap + 04cap) are preserved for completeness but are superseded by Track C's 4 fixed-engine JSONs.

### 2. REPORT-phase17.md

Location: `docs/research/REPORT-phase17.md` (9 sections, ~4000 words)

Sections:
- §1 Executive Summary — verdict on confidence wiring, 3.3× return reduction, +20–25%/mo achievable
- §2 Engine Fix: Confidence → Notional — before/after code diff, mechanism, why engine is correct place
- §3 Pivot Grid: Fixed Engine vs Phase 15 Baseline — per-symbol table, all key metrics
- §4 Pivot Grid: Fixed Engine vs Phase 16 No-Op Cap — does 4% cap make a difference now? Yes: -40 to -65%/mo
- §5 Is +20–50%/Month Achievable? — partially validated: +20–25%/mo at 4% cap, +50% needs cap=0.10–0.15
- §6 Regime-Routed Ensemble: No Regression — kill-switch unchanged, 1265 trades, 26.96% win rate identical
- §7 Risks — zero-confidence signals, confidence > 1 clamping, missing confidence handling, compounding explosion
- §8 Phase 18 Roadmap — 7 candidates ranked by ROI, top 2: regime-ensemble 1-of-2 (30 min), Donchian+Pivot (30 min)
- §9 Files Produced — quality gates, backtest table

### 3. Quality Gates

| Gate | Result |
|------|--------|
| `bun run typecheck` | 13/13 packages PASS |
| `bun run lint` | 0 errors, 180 pre-existing warnings |
| `bun test` | 2369/2369 PASS, 16830 expect() calls across 92 files |

---

## PR URL

**https://github.com/EggProject/mm-crypto-bot/pull/41**

---

## Notes for Verifier

1. **Blocker resolved before start:** PR #39 (Track A) was OPEN when this session began but MERGED before Track C work started. Verified `confidenceScaledRisk` at `packages/backtest/src/engine.ts:269`.

2. **Backtests ran in main worktree:** the CLI runners were executed from the main repo, not the worktree, because bun workspaces resolve from repo root. Result files were copied to the worktree before commit.

3. **Track B backtests (6 old-engine JSONs) are superseded:** Phase 17B nocap/04cap results are byte-identical to Phase 15nocap and Phase 16capped, confirming they were run with the old engine. Preserved for documentation completeness.

4. **bun lcov branch coverage caveat:** per memory rule, `BRF=BRH=0` in lcov.info is expected and not a defect. Engine confidence-wiring tests (5 cases: confidence=1.0, 0.7, 0.0, 0.2, >1, <0) added in Track A.
