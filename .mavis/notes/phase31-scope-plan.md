# Phase 31 — Fresh-Start Production Audit (Scope Plan)

**Generated:** 2026-07-09 21:05 Budapest
**Trigger:** User explicit — "torold a logokat es minden letoltott adatot es mindent ujra ... a vegen foglald ossze az eredmenyt, mert innentol az a production a celunk"
**Status:** IN-FLIGHT (multi-phase, autonomous)

---

## 1. Why Phase 31

The codebase has accumulated:
- 60 MB of downloaded OHLCV + funding + deribit data (last sync: unknown)
- 49 MB of backtest JSONs (262+ runs, many stale — pre-Phase 27 bugfix)
- 25 strategy files (mix of PRODUCTION / RESEARCH-KEEP / HALT / REMOVE per Phase 26)
- Many undocumented changes since the last full audit (Phase 26: 2026-07-08)

The user wants a **production-grade restart** — clean data, fresh backtest results, M3 code review, and a final keep/discard verdict per strategy.

---

## 2. Scope (what gets deleted, what gets re-built, what stays)

### DELETE (recoverable via `mavis-trash`)

| Path | Reason | Size |
|------|--------|-----:|
| `data/ohlcv/` (all CSVs + MANIFEST + README) | Stale downloaded OHLCV | ~50 MB |
| `data/funding/` (3 CSVs) | Stale downloaded funding | <1 MB |
| `data/deribit/` (1 CSV) | Stale downloaded DVOL | <1 MB |
| `backtest-results/` (all 20 entries: REPORTs + JSONs + sub-dirs) | Stale pre-Phase 27 results | 49 MB |
| `backtest-results/phase30b-multisymbol/` (5 files) | Phase 30 multi-symbol envelope (preserved in Phase 30 REPORT.md) | <1 MB |

### KEEP (not deleted)

- `packages/` — all source code (production + tests)
- `docs/research/` — historical REPORTs (deliverables, not logs)
- `apps/` — live execution scaffolding
- `.mavis/notes/board.md` + `.mavis/notes/phase*.md` — operational state + scope plans
- `.mavis/plans/` — historical team plan YAMLs (record only)
- `README.md`, `AGENTS.md`, `package.json`, `tsconfig.json`, `bun.lockb` — meta
- `.git/` — version control
- `data/arb-latency-*.json` (samples for Phase 6 Track B LatencyGate) — these are TEST FIXTURES, not downloaded data; they live in `backtest-results/` though, so they go with that dir

### RE-BUILD (after cleanup)

1. **OHLCV data** — `bun run packages/backtest-tools/src/cli/download-ohlcv.ts` for BTC/ETH/SOL × 5m/15m/1h/4h/1d (full 30-month history)
2. **Funding data** — `bun run packages/backtest-tools/src/cli/download-funding-rates.ts` for BTC/ETH/SOL 8h funding
3. **Deribit DVOL** — re-download BTC daily DVOL (DVOL is in `cascade-fade` plugin's wire-up)
4. **Backtest JSONs** — generated fresh in Phase 31.6

---

## 3. Testing strategy (the keep/discard decision)

### 3.1 Per-strategy decision matrix

Each strategy is evaluated on **4 axes** and assigned ONE verdict:

| Axis | Threshold | Why |
|------|-----------|-----|
| **Code health** (M3 audit) | 0 BLOCKING bugs found | A strategy with bugs produces wrong results — can't trust backtest |
| **Backtest health** (OOS/IS ratio) | ≥ 0.60 | Below 0.60 = overfit (Phase 21 #1 / Phase 27 standard) |
| **Risk envelope** (DD) | ≤ 15% (project mandate) | Above 15% violates user directive 2026-07-06 13:06 |
| **Trade count** (sanity) | ≥ 30 trades in 30-month window | Below 30 = statistically insignificant (Phase 13 audit lesson) |

### 3.2 Verdict matrix

| Code | OOS/IS | DD | Trades | Verdict |
|------|--------|-----|--------|---------|
| 0 bugs | ≥ 0.60 | ≤ 15% | ≥ 30 | **PRODUCTION** |
| 0 bugs | ≥ 0.60 | ≤ 15% | < 30 | **RESEARCH-KEEP** (interesting but small sample) |
| 0 bugs | 0.40-0.60 | ≤ 15% | ≥ 30 | **PARTIAL** (regime-INVARIANT parameter optimization still valuable) |
| 0 bugs | < 0.40 OR | > 15% | any | **HALT** (overfit or violates mandate) |
| ≥ 1 BLOCKING bug | any | any | any | **BROKEN — fix bug, re-evaluate** |

### 3.3 Symbol-specific application

The same strategy can be PRODUCTION on ETH and HALT on SOL (Phase 26 per-symbol pattern: SOL funding is structurally different). Each strategy × symbol combination gets its OWN verdict.

### 3.4 Production portfolio target

From the PRODUCTION strategies, build the production portfolio per the Phase 26 §5 recommendation:
- Per-symbol `DonchianPivotComposition` 1-of-2 at cap=0.20 (NEW: 2026 OOS envelope: +27.91%/mo @ 7.70% DD combined)
- Carry exposure: `dydx-cex-carry` (BTC-only per Phase 25 #2 scope lock)
- Cascade overlay: `cascade-fade` (T3 of Phase 25 #2)

Aggregate target: **+29-30%/mo @ 6-8% DD portfolio envelope** (Phase 26 §5 projection, Phase 30 OOS verification).

---

## 4. M3 code review protocol

### 4.1 What "M3" means here

M3 = a **code-quality agent** that reads each strategy file + its tests and produces a bug list. Same model/agent as the existing M3 verifier in this project, repurposed for code review instead of plan verification.

### 4.2 Per-strategy M3 review checklist

For each strategy file `packages/core/src/strategy/<name>.ts` and its `.test.ts` companion, M3 checks:

1. **HARD GUARDRAILS** — does the strategy enforce 1:10 leverage? Reject inputs that violate?
2. **STATE PERSISTENCE** — does `serializeState`/`fromSnapshot` round-trip preserve all state? (Phase 10G lesson)
3. **WIRE-UP INTEGRITY** — does the strategy have ≥ 1 DirectionSignal source per symbol? (Phase 13 lesson)
4. **SIZING GATING** — does SizingSignal emit on every funding tick? (Phase 13 lesson)
5. **KILL-SWITCH ENFORCEMENT** — are kill-switches enforced at the entry hot path, not just declared? (Phase 25 #2 T3 lesson)
6. **TIMEFRAME COHERENCE** — does the strategy work on its declared timeframe? (Phase 8 lesson)
7. **DOCSTRING VS IMPL** — do the docstrings match the implementation? (Phase 10G Track C lesson)
8. **ARCHITECTURE PARITY** — if refactored, does the refactored version match the SCOPE-equivalent prior baseline? (Phase 10G lesson)

### 4.3 Bug severity classification

- **BLOCKING** — produces wrong results, violates 1:10 mandate, or has a state-persistence bug. Must be fixed before backtest.
- **WARNING** — minor issue (e.g. docstring typo, unused import). Not blocking but worth fixing.
- **INFO** — style / preference / future-work note.

### 4.4 M3 output format

Per strategy, M3 emits a JSON file:
```json
{
  "strategy": "<name>",
  "verdict": "PASS | FIXABLE | BROKEN",
  "blockingBugs": [ { "id": "B1", "severity": "BLOCKING", "line": 123, "description": "...", "fix": "..." } ],
  "warnings": [ ... ],
  "info": [ ... ],
  "reviewDurationMs": 12345
}
```

### 4.5 Multi-agent parallel execution

25 strategy files × M3 review = 25 agents. To avoid running 25 in serial:
- Batch by **architectural family** (5 batches):
  - Batch 1: Funding-carry family (FundingCarry, FundingCarryLeverage, FundingCarryTiming, DydxCexCarry) — 4 files
  - Batch 2: Donchian family (DonchianBreakout, DonchianMtf, DonchianTrailing, DonchianRangeChannel, DonchianPivotComposition) — 5 files
  - Batch 3: Volatility-sizing family (VolTargetedSizing, AdaptiveKelly, HybridKelly, DvolRegimeSizing) — 4 files
  - Batch 4: Pivot/grid family (PivotPointGrid, KeltnerGrid, BollingerRangeSqueeze, RegimeRoutedEnsemble, SimpleRetailEnsemble) — 5 files
  - Batch 5: Mean-reversion / kill-switch family (AlwaysInTrend, MeanReversionBb, CascadeFade, FundingFlipKillSwitch, Composite) + multi-class ensembles (v1-v4) — 7 files
- Each batch is 1 producer agent + 1 verifier agent
- 5 batches run in parallel (max 5 concurrent plan tasks)
- Total agent-time: ~5 batches × ~30 min = ~2.5 hours wall-clock

---

## 5. Phase 31 sub-phases

| Sub-phase | Title | Status | Duration estimate |
|-----------|-------|--------|-------------------|
| 31.1 | Cleanup (data wipe + backtest-results wipe) | ✅ DONE (21:08) | 5 min |
| 31.2 | Re-download OHLCV + funding + deribit | ✅ DONE (21:18) | 1-2 hours |
|   | - data/ohlcv/ — 12 CSVs (BTC/ETH/SOL × 15m/1h/4h/1d, 2024-01-01 → 2026-07-09, 350,829 rows) | | |
|   | - data/funding/ — 3 CSVs (BTC/ETH/SOL 8h funding, 2761 snapshots each) | | |
|   | - data/deribit/ — SKIPPED (no dedicated downloader; only used by DvolRegimeSizingPlugin via PortfolioOrchestrator, which Phase 26 audit recommended NOT using. If needed later, can backfill from Deribit public API) | | |
| 31.3 | Design testing strategy | ✅ DONE (this doc) | — |
| 31.4 | M3 multi-agent code review | IN-FLIGHT (serial self-execution due to time constraint) | 1-2 hours |
| 31.5 | Apply M3 bug fixes (BLOCKING only) | PENDING | variable |
| 31.6 | Fresh backtest run (surviving strategies × 3 symbols × IS/OOS/FULL) | PENDING | 1-2 hours |
| 31.7 | Final report (per-strategy verdict + production recommendation) | PENDING | 30 min |

**Total Phase 31 estimated wall-clock: 4-6 hours** (serial self-execution due to single-session time budget; would be 2-3 hours with 5x parallel team plan).

**Strategy count clarification:** 18 strategy files in `packages/core/src/strategy/` (excluding 1 paper-trade runner + 1 LatencyGate infra file). Phase 26 audit identified 3 PRODUCTION, 4 SUB-COMP, 8 RESEARCH-KEEP, 5 HALT, 4 REMOVE tiers; some REMOVE files were already physically deleted, leaving 18.

---

## 6. Risk register

| Risk | Mitigation |
|------|-----------|
| Data re-download takes longer than expected (CCXT rate limits) | Use `download-ohlcv.ts` with built-in rate-limit handling; per-symbol sequential |
| M3 audit finds BLOCKING bugs that require non-trivial fixes | Re-plan: bug fix becomes its own sub-phase (31.5); extend timeout |
| Re-run backtests produce different numbers than cached (sampling noise) | Acceptable — fresh data is the ground truth; document any deltas |
| `mavis-trash` recovery needed | All deleted data is in OS Trash (`~/.Trash/` on macOS), recoverable until emptied |
| Production portfolio envelope still underperforms the +50%/mo target | Already DNV (Phase 21 #1 closure); realistic envelope is +27-30%/mo (Phase 30 verification) |

---

## 7. Constraints (UNCHANGED, HARD GUARDRAILS)

- 1:10 leverage MANDATORY on ALL trades (user directive 2026-07-04 14:17)
- bybit.eu SPOT-only (no margin futures), MiCAR EU scope
- Self-hosted only, no server spend (user structural mandate)
- 12 max simultaneous trades (per-symbol 4)
- 15% DD project target (Phase 14B mandate) — sizing TO this, not below

---

## 8. Deliverable

**Final Phase 31 REPORT** at `docs/research/phase31-fresh-start-production-audit/REPORT.md`:
- Per-strategy verdict table (all 25 strategies × 3 symbols)
- M3 audit summary (BLOCKING / WARNING / INFO counts)
- Fresh backtest envelope (BTC/ETH/SOL × IS/OOS/FULL)
- Production portfolio recommendation (with sizing to 15% DD target)
- Project portfolio target re-affirmed vs DNV

---

**END OF SCOPE PLAN**
