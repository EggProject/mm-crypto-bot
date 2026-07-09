---
description: Project board — mm-crypto-bot. Updated 2026-07-09 20:50 Budapest — Phase 30 SQUASH-MERGED to main (`344cecf`). PR #62 closed, remote branch auto-deleted, cron `phase30-pr62-monitor` deleted. All 5 of 6 Phase 27 open items now closed (#5 SOL permanently HALTed per Phase 25 #2).
---

# Project board — mm-crypto-bot (updated 2026-07-09 20:50 Budapest, Phase 30 MERGED)

## Phase 30 closure (2026-07-09 20:30 Budapest)

**Phase 30a — LatencyGate live wiring (DONE):**
- dydx-cex-carry accepts `latencyArbThresholdMs` + `latencySource` config
- New `recordLatencySnapshot` / `pollLatencySource` / `isLatencyPaused` / `currentLatencyGate` methods
- `recordFundingTick` returns 0 when paused (no accrual)
- `onCandle` does NOT enter when paused (entry-block only, no auto-close)
- `serializeState` / `fromSnapshot` round-trip + forward-compat
- Paper-trade runner emits `PaperTradeLatencyStats` (min/max/mean round-trip, paused tick count, paused fraction)
- New `live-latency-source.ts` with `JsonLatencySource` (Phase 6 JSON replay) + `ConstantLatencySource` (fixed value)
- 19 new unit tests (40-58) — 62/62 total pass

**Phase 30b — Per-symbol DP multi-symbol CLI (DONE):**
- `--symbols=BTC/USDT,ETH/USDT,SOL/USDT` flag on `run-donchian-pivot-composition`
- Multi-symbol mode runs each symbol independently (Phase 26 §5 recommended — per-symbol DP, NOT via PortfolioOrchestrator)
- Per-symbol + combined envelope JSON output

**Fresh 2026 OOS verification (matches Phase 26 §4.2 exactly):**
| Symbol | Monthly | Sharpe | Max DD | Trades | Win rate |
|--------|--------:|-------:|-------:|-------:|---------:|
| BTC    | +26.23%/mo | 28.99 | 3.17% | 2075 | 68.82% |
| ETH    | +29.64%/mo | 27.39 | 4.58% | 2280 | 65.35% |
| SOL    | +27.86%/mo | 27.31 | 7.70% | 2295 | 64.23% |
| **Combined (3 symbols)** | **+27.91%/mo** | **27.90** | **7.70%** | — | — |

## PR #62 state (2026-07-09 20:50 Budapest) — ✅ MERGED

- Branch: `feat/phase30-latency-gate-live-wiring` (auto-deleted by `gh pr merge --delete-branch`)
- Squash-merge commit: **`344cecf` Phase 30: LatencyGate live wiring + per-symbol DP multi-symbol CLI (#62)**
- Local main: synced to `344cecf` (reset to origin/main after squash-merge)
- CI final: 5/5 PASS (Build / Coverage / Lint / Test / Typecheck)
- 1 CI retry needed for lint fix: `Array<T>` → `T[]` syntax (commit `9008c82`, pushed at 20:38, lint re-ran at 20:40 — green)
- Merge executed 20:50 per user override ("mire varunk?" — no 2h conservative buffer wait)
- Cron `phase30-pr62-monitor` DELETED (PR merged)

## Phase 27 → Phase 30 closure status

| # | Item | Status |
|---|------|--------|
| #1 | OOS validation (V2) | ✓ DONE Phase 28 (commit 5137207) |
| #3 | Cross-correlation (DP vs V2) | ✓ DONE Phase 29 (commit 710392b) |
| #4 | LatencyGate live wiring | ✓ DONE Phase 30a (this report) |
| #5 | SOL funding volatility | HALTED Phase 25 #2 — permanently closed |
| #6 | Paper-trade gate CLI | ✓ DONE Phase 28 (commit 5137207) |
| #7 | Portfolio orchestrator ETH registration | ✓ DONE Phase 30b (this report) |

**Phase 27 → 30: 5 of 6 items resolved, 1 permanently HALTed.** No outstanding actionable work.

## Constraint envelope (UNCHANGED, HARD GUARDRAILS)

- 1:10 leverage MANDATORY on ALL trades (user directive 2026-07-04 14:17)
- bybit.eu SPOT-only (no margin futures), MiCAR EU scope
- Self-hosted only, no server spend (user structural mandate)
- ~30 months of OHLCV + funding history (single-exchange)
- 12 max simultaneous trades (per-symbol 4)

## Empirical standing (post-Phase 30, pre-Phase 31)

| Strategy | Symbol | Mode | Cap | Monthly | DD | Verdict |
|----------|--------|------|----:|--------:|----:|---------|
| donchian-pivot-composition | BTC | 1-of-2 | 0.20 | +26.23%/mo | 3.17% | Production (per-symbol) |
| donchian-pivot-composition | ETH | 1-of-2 | 0.20 | +29.64%/mo | 4.58% | Production (per-symbol) |
| donchian-pivot-composition | SOL | 1-of-2 | 0.20 | +27.86%/mo | 7.70% | Production (per-symbol) |
| **DP combined (simple avg, 3 symbols)** | — | 1-of-2 | 0.20 | **+27.91%/mo** | **7.70%** | **PRODUCTION ENVELOPE ★** |
| dydx-cex-carry (LatencyGate-wired) | BTC | — | 0.025 | TBD post-7d paper-trade | TBD | Paper-trade gate (Phase 25 #2 T2) |
| PortfolioOrchestrator (orchestrator) | BTC+ETH+SOL | multi-plugin | 0.20 | +2.05%/mo | <5% | **NOT recommended** (Phase 26 audit) |
| MultiClassEnsembleV2 | BTC/ETH | 1d | 0.10 | +5.91-6.11%/mo OOS | 2.66-5.00% | NOT promoted (Phase 27 OOS FAIL) |

## Active cron

None. `phase30-pr62-monitor` deleted (PR #62 merged).

## Open user decisions needed

None. Phase 30 closed autonomously. Phase 31 scope TBD on user input (no plan queued).

## Phase 25 #2 plan_0f0d842e — STATUS CLOSED (cancelled cycle 3)

PR #58 (`3b6c65f`) merged T1+T3+T4. T2 (dydx-cex-carry live strategy) was never dispatched in the plan; Phase 30 LatencyGate live wiring supersedes the original T2 plan item.
