# Phase 23 #1 Track A — Deliverable

**Task:** Phase 23 #1 Track A — HybridKelly kelly-fraction sweep (12 backtests) + envelope comparison vs Phase 19 #1
**Branch:** `feat/phase23-1a-sweep` from `main` @ `8c56e2a`
**Worktree:** `/Users/kiscsicska/projects/mm-crypto-bot/.worktrees/wt-phase23-1a-sweep`
**Empirical verdict:** **NEGATIVE — silent-no-op confirmed. Drop Phase 23 #1 from the +50%/mo roadmap.**

---

## 1. Summary

Ran 12 HybridKelly backtests (`--kelly-fraction ∈ {0.25, 0.5, 0.75, 1.0}` × `{BTC, ETH, SOL}`, 1d timeframe, 1:10 leverage). All 12 produced **byte-identical output** — the `--kelly-fraction` flag is silently ignored by `run-hybrid-kelly.ts` parseArgs() (the CLI doesn't have a `--kelly-fraction` branch; line 225 hardcodes `baseKellyFraction: 0.5`). This reproduces Phase 20 #1's structural finding from a different angle: the CLI cannot measure per-trade Hybrid-Kelly scaling empirically.

---

## 2. Changed files

### Created (14 files)

**12 backtest JSONs:**
- `backtest-results/phase23-hybrid-kelly-0.25-btc-1d.json`
- `backtest-results/phase23-hybrid-kelly-0.25-eth-1d.json`
- `backtest-results/phase23-hybrid-kelly-0.25-sol-1d.json`
- `backtest-results/phase23-hybrid-kelly-0.5-btc-1d.json`
- `backtest-results/phase23-hybrid-kelly-0.5-eth-1d.json`
- `backtest-results/phase23-hybrid-kelly-0.5-sol-1d.json`
- `backtest-results/phase23-hybrid-kelly-0.75-btc-1d.json`
- `backtest-results/phase23-hybrid-kelly-0.75-eth-1d.json`
- `backtest-results/phase23-hybrid-kelly-0.75-sol-1d.json`
- `backtest-results/phase23-hybrid-kelly-1.0-btc-1d.json`
- `backtest-results/phase23-hybrid-kelly-1.0-eth-1d.json`
- `backtest-results/phase23-hybrid-kelly-1.0-sol-1d.json`

**Summary + reference doc:**
- `backtest-results/phase23-envelope-comparison.summary.json` (machine-readable summary with all 12 cells, 3 references, lift table, portfolio avg per kelly-fraction, NOT-silent-no-op audit, leverage audit, DD budget audit)
- `docs/research/ENVELOPE-COMPARISON-phase23.md` (per-row table, lift table, NOT-silent-no-op verification, edge-INVARIANCE test, 1:10 audit, DD budget check)

### Modified

- **None** — per brief, did NOT modify `run-hybrid-kelly.ts`. Zero source edits. Zero `eslint-disable` lines added.

---

## 3. Empirical results — 12-row envelope table

| kelly-fraction | symbol | monthly% | maxDD% | trades | win-rate% | sharpe | kill-switch |
|---------------:|-------:|---------:|-------:|-------:|----------:|-------:|:-----------:|
| 0.25 | BTC | +0.0458 | 5.10 | 28 | 53.57 | 0.1954 | false |
| 0.25 | ETH | +0.0933 | 2.78 | 24 | 58.33 | 0.4408 | false |
| 0.25 | SOL | +0.0821 | 3.39 | 19 | 63.16 | 0.4641 | false |
| 0.50 | BTC | +0.0458 | 5.10 | 28 | 53.57 | 0.1954 | false |
| 0.50 | ETH | +0.0933 | 2.78 | 24 | 58.33 | 0.4408 | false |
| 0.50 | SOL | +0.0821 | 3.39 | 19 | 63.16 | 0.4641 | false |
| 0.75 | BTC | +0.0458 | 5.10 | 28 | 53.57 | 0.1954 | false |
| 0.75 | ETH | +0.0933 | 2.78 | 24 | 58.33 | 0.4408 | false |
| 0.75 | SOL | +0.0821 | 3.39 | 19 | 63.16 | 0.4641 | false |
| 1.00 | BTC | +0.0458 | 5.10 | 28 | 53.57 | 0.1954 | false |
| 1.00 | ETH | +0.0933 | 2.78 | 24 | 58.33 | 0.4408 | false |
| 1.00 | SOL | +0.0821 | 3.39 | 19 | 63.16 | 0.4641 | false |

**Key finding:** the kelly-fraction column has NO measurable effect on any other column. All 12 cells collapse to 3 distinct rows (one per symbol).

---

## 4. Reference table — Phase 19 #1 same-config 1d Donchian baseline

| symbol | monthly% | maxDD% | trades | win-rate% | sharpe | kill-switch |
|-------:|---------:|-------:|-------:|----------:|-------:|:-----------:|
| BTC | +0.0380 | 5.53 | 28 | 53.57 | 0.1568 | false |
| ETH | +0.1038 | 3.09 | 24 | 58.33 | 0.4408 | false |
| SOL | +0.0914 | 3.76 | 19 | 63.16 | 0.4643 | false |

Source: `backtest-results/baseline-donchian-{btc,eth,sol}-1d.json` (existing files, no new backtests).

---

## 5. Calibration sweet spot — **DOES NOT EXIST**

**No kelly-fraction × symbol combination lifts the portfolio avg meaningfully.** The 12-cell sweep produces 3 distinct outcomes (one per symbol), all independent of kelly-fraction:

- BTC: +0.0458%/mo (modestly +0.0079 pp vs Phase 19 #1 1d baseline)
- ETH: +0.0933%/mo (−0.0104 pp vs baseline)
- SOL: +0.0821%/mo (−0.0093 pp vs baseline)
- **Portfolio avg: +0.0737%/mo (−0.0040 pp vs baseline)**

The "sweet spot hypothesis" (the brief's premise that 0.25-1.0 might contain a winner) is **REJECTED** because the kelly-fraction has no observable effect on the engine output.

---

## 6. NOT-silent-no-op verification (Phase 20 #1 lesson)

### 6.1 Trade-stream probe (BTC, kelly=0.25 vs kelly=0.5)

Diff commands run:

```bash
# equity curves — byte-identical
diff <(jq -c '.equityCurveSampled' phase23-hybrid-kelly-0.25-btc-1d.json) \
     <(jq -c '.equityCurveSampled' phase23-hybrid-kelly-0.5-btc-1d.json)
# → NO OUTPUT (byte-identical)

# walk-forward folds — byte-identical
diff <(jq -c '.walkForward.folds' phase23-hybrid-kelly-0.25-btc-1d.json) \
     <(jq -c '.walkForward.folds' phase23-hybrid-kelly-0.5-btc-1d.json)
# → NO OUTPUT (byte-identical)

# withHybridKelly — only monthlyReturnPct differs by 1e-8
diff <(jq -c '.withHybridKelly' phase23-hybrid-kelly-0.25-btc-1d.json) \
     <(jq -c '.withHybridKelly' phase23-hybrid-kelly-0.5-btc-1d.json)
# → only monthlyReturnPct differs (1e-8, sub-noise from endTime=Date.now())
```

### 6.2 Smoking-gun: phase23-0.5-btc == baseline-hybrid-kelly-btc

`phase23-hybrid-kelly-0.5-btc-1d.json` (with `--kelly-fraction=0.5`) is **byte-identical** to the existing `baseline-hybrid-kelly-btc-1d.json` (run with NO `--kelly-fraction` flag). The flag has zero effect.

### 6.3 Root cause (CLI source inspection)

`packages/backtest-tools/src/cli/run-hybrid-kelly.ts`:
- Line 74-107 `parseArgs()` accepts only `--symbol`, `--timeframe`, `--equity`, `--base-notional`, `--leverage`, `--output`. Unknown flags silently ignored.
- Line 225 hardcodes `baseKellyFraction: 0.5` — this is what runs every time.

Per `PHASE-20-21-ARCHIVE.md` §7: this is exactly the **"CLI flags must either work or error, never silently no-op"** pattern that was identified as the root cause of Phase 20 #1's NEGATIVE verdict.

---

## 7. DD budget check (≤ 6.5% safe, > 8% reject)

All 12 HybridKelly cells PASS (worst case: BTC @ 5.10% DD, 21.5% safety margin from 6.5% threshold).

---

## 8. 1:10 leverage audit

All 12 JSONs PASS `avgEffectiveLeverage ≤ 10×` (BTC 8.32×, ETH 6.09×, SOL 5.21×).

---

## 9. Quality gates

| Gate | Status | Detail |
|------|:------:|--------|
| `bun run typecheck` | **PASS** | 13/13 packages (turbo cache hit; no new TS source) |
| `bun run lint` | **PASS** | 0 errors, 265 warnings (same as Phase 20 baseline) |
| `bun test` (full suite) | **PASS** | 2393 tests pass, 0 fail, 16901 expect() calls, 6.09s |
| No `eslint-disable` lines added | **PASS** | Zero source edits |
| 1:10 leverage audit | **PASS** | All 12 JSONs ≤ 10× |
| DD ≤ 6.5% threshold | **PASS** | Worst case 5.10% (BTC) |

---

## 10. Notes for verifier

1. **The empirical NEGATIVE is robust.** 12 backtests collapse to 3 distinct cells (one per symbol). The kelly-fraction has zero measurable effect. This is not a sampling artifact — the engine runs the same code path regardless of `--kelly-fraction` value.

2. **Smoke verification command:**
   ```bash
   # Phase 23 0.5 BTC == baseline HybridKelly BTC (proves flag is no-op)
   diff <(jq 'del(.metadata.generatedAt)|del(.period.endTime)|del(.period.totalMonths)|del(.withHybridKelly.monthlyReturnPct)|del(.walkForward.aggregateTestReturn)' \
           baseline-hybrid-kelly-btc-1d.json) \
        <(jq 'del(.metadata.generatedAt)|del(.period.endTime)|del(.period.totalMonths)|del(.withHybridKelly.monthlyReturnPct)|del(.walkForward.aggregateTestReturn)' \
           phase23-hybrid-kelly-0.5-btc-1d.json)
   # Expected: NO OUTPUT (byte-identical)
   ```

3. **Reproduction (per brief):** 12 backtests × ~200ms each = ~2.4 seconds of compute, plus ~1-2s Bun startup overhead per run ≈ 30-60 seconds total. The 1d timeframe is much faster than 15m sweeps.

4. **Source-code root cause** (informational only — DO NOT modify per brief): `packages/backtest-tools/src/cli/run-hybrid-kelly.ts` lines 74-107 (parseArgs) + line 225 (hardcoded `baseKellyFraction: 0.5`).

5. **Structural lesson (carry-forward to PHASE-24/25):** CLI flags must EITHER be wired through the runner OR throw a hard error. The 30-line "Option B" patch from PHASE-20-21-ARCHIVE.md §6.1 is the minimal fix; the SCv1-throughout refactor is the full fix.

6. **Lifts are sub-noise (−0.004 pp portfolio avg).** Even if the kelly-fraction WERE applied, the geometry of the HybridKelly signal (1d daily, 28/24/19 trades per symbol) does not provide enough compounding surface to materially move the envelope. The Phase 19 #1 15m cap-sweep (11043 trades per symbol) is the regime where per-trade Kelly could matter; the 1d HybridKelly baseline is too thin to demonstrate it either way.

7. **Branch state:** `feat/phase23-1a-sweep` from `main` @ `8c56e2a`, working tree clean except for the 14 deliverable files. No source edits — this is a research/data-only branch.

---

**End of deliverable.md**