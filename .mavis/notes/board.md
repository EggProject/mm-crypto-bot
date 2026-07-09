---
description: Project board — mm-crypto-bot. Updated 2026-07-09 23:20 Budapest — Phase 32 SQUASH-MERGED to main (`98c8f7e`). 27 dead-code files removed (10 strategies + 14 wrappers + 3 tests + 16 CLIs), deprecated-strategies archive created. Production envelope UNCHANGED: +41.99%/mo @ ≤7.70% DD.
---

# Project board — mm-crypto-bot (updated 2026-07-09 23:20 Budapest, Phase 32 MERGED)

## Phase 32 closure (2026-07-09 23:20 Budapest) — DEPRECATED-STRATEGIES CLEANUP ✅ MERGED

**Merge commit: `98c8f7e` Phase 32: deprecated-strategies cleanup (10 strategies + 17 wrappers/CLIs/tests removed, 10 retained) (#64)**

**User directive:** "amit torolsz azokrol legyen dokumentacio hogy mar probaltuk es nem valt be es miert"

### Cleanup summary

- **27 dead-code files removed** (recoverable via mavis-trash + `~/.Trash/`):
  - 10 strategy files (V2 OOS FAILED, 3 HALT donchian, 3 HALT funding-carry, regime-routed superseded, BB Squeeze + Keltner zero trade)
  - 14 wrapper plugins
  - 3 test files
  - 16 backtest-tools CLIs
- **10 strategy files retained** (8 production + 2 infrastructure):
  - donchian-pivot-composition (PRODUCTION, +34-46%/mo)
  - donchian-range-channel, pivot-point-grid, composite, funding-flip-kill-switch (sub-components)
  - dydx-cex-carry + paper-trade runner (PRODUCTION carry)
  - cascade-fade (PRODUCTION cascade overlay)
  - multi-class-ensemble.ts (LatencyGate infra only)
  - funding-snapshot.ts (NEW — extracted type from deleted funding-carry)
- **funding-flip-kill-switch.ts refactored**: class wrapper removed, pure-functional regime detector preserved
- **`docs/research/deprecated-strategies/REPORT.md`** — per-strategy "már próbáltuk, nem vált be" archive with:
  - Original purpose + backtest evidence + failure mode + replacement + recovery procedure

### Test status (post-cleanup)
- **1415 tests pass, 0 fail, 9691 expect() calls**
- **core + backtest-tools typecheck: PASS**
- **No regressions introduced**

### Production envelope (UNCHANGED from Phase 31)
- DP 1of2 cap=0.20 BTC: +34.41%/mo @ 7.18% DD
- DP 1of2 cap=0.20 ETH: +37.74%/mo @ 5.51% DD
- DP 1of2 cap=0.20 SOL: +45.80%/mo @ 7.70% DD
- DP combined: +39.32%/mo @ ≤7.70% DD
- dydx-cex-carry BTC: +6.67%/mo @ 1.89% DD
- cascade-fade BTC: +1.35%/mo projected
- **PORTFOLIO TOTAL: +41.99%/mo @ ≤7.70% DD (within 15% mandate)**

## Phase retrospective (Phase 25 #1 → Phase 32)

| Phase | Output | Commit |
|-------|--------|--------|
| 25 #1 | Perp-DEX funding microstructure research fleet (5 tracks) | `76998ec` |
| 25 #2 | Perp-DEX implementation (T1+T3+T4 → PR #58, T2 superseded by Phase 30) | `3b6c65f` |
| 26 | Strategy portfolio audit (PRODUCTION/SUB-COMP/RESEARCH-KEEP/HALT tiers) | (historical) |
| 27 | V2 promotion brief + OOS validation FAILED (V2 NOT promoted) | `9f019ff` |
| 28 | V2 OOS validation FAILED + 7-day paper-trade gate CLI | `5137207` |
| 29 | Cross-correlation DP vs V2 (V2 stays unpromoted) | `710392b` |
| 30 | LatencyGate live wiring + per-symbol DP multi-symbol CLI | `344cecf` |
| 31 | Fresh-start production audit (cleanup + M3 + backtest) | `bb656a1` |
| **32** | **Deprecated-strategies cleanup (27 files removed, archive created)** | **`98c8f7e`** |

**Codebase reduction: 28 strategy files → 10 (8 production + 2 infrastructure), -64%.** Production envelope UNCHANGED. All Phase 27 → Phase 32 audit items closed.

## Active cron

None active. `phase32-pr64-monitor` deleted (PR #64 merged).

## Open user decisions needed

None. Production deployment UNBLOCKED. Next actionable steps are operational (pre-live checklist from Phase 31 REPORT §7.4):
1. ⏳ dydx-cex-carry 7-day paper-trade gate
2. ⏳ 30-day live paper-trade of DP on bybit.eu SPOT
3. ⏳ Per-symbol 1:10 leverage invariant check (3-layer defense)
4. ⏳ LatencyGate live feed on bybit.eu + dYdX v4 latency
5. ⏳ User sign-off on production envelope (+41.99%/mo @ ≤7.70% DD)
