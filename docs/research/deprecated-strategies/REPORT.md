# Deprecated Strategies — "Már próbáltuk, nem vált be" Archive

**Generated:** 2026-07-09 22:55 Budapest
**Trigger:** Phase 32 — "minimal code surface for production" cleanup. User explicit: "amit torolsz azokrol legyen dokumentacio hogy mar probaltuk es nem valt be es miert".
**Status:** 10 strategy files DELETED from disk (recoverable via `mavis-trash` + OS Trash). This document is the institutional memory of WHY each was tried and WHY it was deleted.

---

## 1. What this document is

The codebase previously held 18 strategy files. Per the Phase 26 audit + Phase 27 OOS validation + Phase 31 fresh-start production audit, **10 of them had no production use case** and were deleted in Phase 32. This document preserves the empirical evidence and reasoning behind each deletion so future developers don't re-introduce the same strategies without first understanding the prior research.

**Deleted files are recoverable** — `mavis-trash` moves to OS Trash (`~/.Trash/` on macOS). The git history also retains the files at commit `bb656a1` (last pre-deletion commit).

---

## 2. Per-strategy deletion record

### 2.1 `multi-class-ensemble-v2.ts` (and test)

| Field | Value |
|-------|-------|
| **Status** | **HALT (Phase 27 OOS FAILED)** |
| **Original purpose** | Phase 7 Track A+B+C composite: DonchianTrailing (directional) + FundingCarryLeverage (10× carry) + AdaptiveKelly sizing. Designed as the "ensemble V2" superseding the V1 multi-class ensemble. |
| **Backtest evidence** | 9 fresh BTC/ETH/SOL backtests × 2024-2025 IS + 2026 OOS windows (Phase 27 fresh-current-code rerun). |
| **Why it failed** | **OOS/IS ratio = 0.157 (BTC) / 0.038 (ETH)** — way below the 0.60 overfitting threshold. The carry alpha is **environment-dependent** (collapsed in 2026 funding-rate normalization). |
| **Fresh data evidence** | BTC FULL: +5.91%/mo @ 5.00% DD; IS (2024-2025): +7.19%/mo; **OOS (2026): +1.13%/mo (BTC) / +0.29%/mo (ETH)** |
| **Citation** | `docs/research/phase27-v2-promote/REPORT.md` §6, §6.0, §7 |
| **Replacement** | None — V2 is permanently unpromoted. Carry exposure now comes from `dydx-cex-carry.ts` (BTC-only, LatencyGate-wired, structural carry alpha from cross-venue divergence, not environment-dependent). |
| **Recoverable** | git: `git show bb656a1:packages/core/src/strategy/multi-class-ensemble-v2.ts` |

### 2.2 `donchian-breakout.ts` (and test)

| Field | Value |
|-------|-------|
| **Status** | **HALT (Phase 26)** |
| **Original purpose** | Original Phase 5 C — the base Donchian breakout trend-following strategy. The simplest possible "buy on new N-day high" trend strategy. |
| **Backtest evidence** | Phase 15 §5 (early envelope study); Phase 26 strategy audit referenced it. |
| **Why it failed** | **Superseded by `donchian-pivot-composition.ts`**. DP composition combines Donchian Range Channel (mean-reversion variant) with Pivot Point Grid, achieving +34-46%/mo vs the breakout's lower envelope. The breakout variant lost the trade count war. |
| **Fresh data evidence** | DP composition 1of2 cap=0.20 BTC: +34.41%/mo @ 7.18% DD (11048 trades). The breakout variant was never re-tested on the 30.2-month fresh data because DP dominates. |
| **Citation** | `docs/research/phase15-strategy-brief.md`; `docs/research/phase26-strategy-audit/REPORT-phase26.md` §3 (HALT tier) |
| **Replacement** | `donchian-pivot-composition.ts` (the DP strategy, +34-46%/mo) |
| **Recoverable** | git: `git show bb656a1:packages/core/src/strategy/donchian-breakout.ts` |

### 2.3 `donchian-mtf.ts` (and test)

| Field | Value |
|-------|-------|
| **Status** | **HALT (Phase 26)** |
| **Original purpose** | Donchian breakout with multi-timeframe confluence (1d trend filter + 4h entry + 1h trigger). Phase 8 variant of the breakout. |
| **Backtest evidence** | Phase 8 envelope study; Phase 15 retail strategy sweep. |
| **Why it failed** | **Superseded by `donchian-pivot-composition.ts`**. The MTF complexity added no edge over the simpler DP composition. The M15-native mean-reversion pair (Donchian Range + Pivot) outperformed the M15-trend variant. |
| **Fresh data evidence** | Not re-tested on fresh data — DP dominates. |
| **Citation** | `docs/research/phase8-1h-mtf-donchian.md`; `docs/research/phase26-strategy-audit/REPORT-phase26.md` §3 (HALT tier) |
| **Replacement** | `donchian-pivot-composition.ts` |
| **Recoverable** | git: `git show bb656a1:packages/core/src/strategy/donchian-mtf.ts` |

### 2.4 `donchian-trailing.ts` (and test)

| Field | Value |
|-------|-------|
| **Status** | **HALT (Phase 26, but specifically: was a sub-component of V2, which is now halted)** |
| **Original purpose** | Phase 7 Track A — Donchian with HWM-based trailing-stop. Was a sub-component of `multi-class-ensemble-v2.ts`. |
| **Backtest evidence** | Phase 7 Track A envelope; Phase 26 audit classified as HALT. |
| **Why it failed** | **As a sub-component of V2, it shared V2's OOS failure.** As a standalone, it was never re-validated post-Phase 26. The trailing-stop logic itself is sound (validated in Phase 7), but the V2 ensemble around it was the problem. |
| **Fresh data evidence** | Not re-tested on fresh data. |
| **Citation** | `docs/research/phase7-trailing-stop.md`; `docs/research/phase26-strategy-audit/REPORT-phase26.md` §3 |
| **Replacement** | The DP composition uses ATR-based stops via the engine (see `BacktestOptions.positionSize.maxDrawdown`), not a custom HWM trailing-stop. If a trailing-stop is needed in the future, re-derive from Phase 7 lessons. |
| **Recoverable** | git: `git show bb656a1:packages/core/src/strategy/donchian-trailing.ts` |

### 2.5 `funding-carry.ts` (and test)

| Field | Value |
|-------|-------|
| **Status** | **HALT (Phase 26) — superseded by `dydx-cex-carry.ts`** |
| **Original purpose** | Phase 6 Track A — the baseline funding-rate carry strategy. Hold spot, pay funding, collect spread. |
| **Backtest evidence** | Phase 6 envelope study; Phase 7 leverage variant; Phase 8 in-trade tracking. |
| **Why it failed** | **Replaced by `dydx-cex-carry.ts` (Phase 25 #2 T2)** which does the same thing but with: (1) cross-venue divergence (dYdX vs CEX, not just spot-perp), (2) LatencyGate live wiring (Phase 30), (3) 4 kill-switches (indexer-stale, chain-non-finalized, divergence-7d-compression, bybit-eu-spot-thin), (4) 7-day paper-trade gate mandatory. The dydx-cex variant is more structural (less environment-dependent) and has the same +6-9%/mo carry envelope. |
| **Fresh data evidence** | dydx-cex-carry BTC 2025-Q2: +6.67%/mo @ 1.89% DD, 70.14% WR (Phase 31 fresh run) |
| **Citation** | `docs/research/phase6-funding-carry.md`; `docs/research/phase25/track-b/REPORT.md` (dydx-cex design rationale) |
| **Replacement** | `dydx-cex-carry.ts` |
| **Recoverable** | git: `git show bb656a1:packages/core/src/strategy/funding-carry.ts` |

### 2.6 `funding-carry-leverage.ts` (and test)

| Field | Value |
|-------|-------|
| **Status** | **HALT (Phase 26) — superseded by `dydx-cex-carry.ts`** |
| **Original purpose** | Phase 7 Track C — funding carry with leverage (1×..3× dynamic, VaR cap 2% daily @ 95%, liquidation buffer). |
| **Backtest evidence** | Phase 7 Track C envelope; Phase 8 in-trade tracking; Phase 21 #1 verified regime wire-up. |
| **Why it failed** | **Same as funding-carry.ts** — replaced by dydx-cex-carry. The leverage was dynamic (1-3× based on vol) but the strategy was BTC-only, single-venue, and lacked the LatencyGate + kill-switch infrastructure. |
| **Citation** | `docs/research/phase7-carry-leverage.md`; `docs/research/REPORT-phase21.md` §6 (wire-up integrity) |
| **Replacement** | `dydx-cex-carry.ts` (10× leverage, LatencyGate, 4 kill-switches, 7-day paper-trade gate) |
| **Recoverable** | git: `git show bb656a1:packages/core/src/strategy/funding-carry-leverage.ts` |

### 2.7 `funding-carry-timing.ts` (and test)

| Field | Value |
|-------|-------|
| **Status** | **HALT (Phase 26) — superseded by `dydx-cex-carry.ts`** |
| **Original purpose** | Phase 8 Track E — funding carry with timing optimization (entry filter based on funding-percentile regime). |
| **Backtest evidence** | Phase 8 envelope; Phase 9 9D `funding-flip-kill-switch.ts` wraps it (kill-switch on funding-flip regime). |
| **Why it failed** | **Same as funding-carry.ts** — replaced by dydx-cex-carry. The timing logic itself was sound (inCarry% on healthy folds was 75% vs 6.5-27.2% on bad folds), but the strategy was BTC-only, single-venue. |
| **Citation** | `docs/research/phase8-funding-timing.md`; `docs/research/phase9-funding-flip-kill-switch.md` (kill-switch integration) |
| **Replacement** | `dydx-cex-carry.ts` |
| **Recoverable** | git: `git show bb656a1:packages/core/src/strategy/funding-carry-timing.ts` |

### 2.8 `regime-routed-ensemble.ts` (and test)

| Field | Value |
|-------|-------|
| **Status** | **HALT (Phase 26) — superseded by `donchian-pivot-composition.ts`** |
| **Original purpose** | Phase 16 Track A — regime-routed ensemble using ADX-based routing across 4 sub-strategies (BB Squeeze, Keltner Grid, Donchian, Pivot). |
| **Backtest evidence** | Phase 16 envelope; Phase 18 winner at 2-of-2 mode. |
| **Why it failed** | **Superseded by `donchian-pivot-composition.ts`**. The 4-strategy regime-routed ensemble added ADX routing but at the cost of plugin overlap (5+ plugins per symbol competing for the same signal, Phase 26 §4.5 identified +23pp overhead). The simpler 2-strategy DP composition achieves +34-46%/mo vs RRE's lower envelope. |
| **Citation** | `docs/research/phase16-notional-cap-regime-ensemble.md`; `docs/research/phase18-regime-1of2-donchian-pivot-2comp.md` (DP composition supersedes RRE) |
| **Replacement** | `donchian-pivot-composition.ts` |
| **Recoverable** | git: `git show bb656a1:packages/core/src/strategy/regime-routed-ensemble.ts` |

### 2.9 `bollinger-range-squeeze.ts` (and test)

| Field | Value |
|-------|-------|
| **Status** | **HALT (Phase 26)** |
| **Original purpose** | Phase 15 Track B — Bollinger Band Squeeze breakout strategy on M5 timeframe. |
| **Backtest evidence** | Phase 15 envelope (1.33%/mo, 1 trade total in 30-month window — statistically insignificant). |
| **Why it failed** | **Statistically insignificant trade count** (1 trade in 30mo). M5 BB Squeeze never produced real edge on BTC/ETH/SOL. The strategy is referenced in Phase 15 §10 as a "lessons learned" — the M5 noise on crypto is too high to support a squeeze-based edge. |
| **Citation** | `docs/research/phase15-strategy-brief.md` §5; `docs/research/REPORT-phase15.md` §3 |
| **Replacement** | None — BB Squeeze has no structural edge. |
| **Recoverable** | git: `git show bb656a1:packages/core/src/strategy/bollinger-range-squeeze.ts` |

### 2.10 `keltner-grid.ts` (and test)

| Field | Value |
|-------|-------|
| **Status** | **HALT (Phase 26)** |
| **Original purpose** | Phase 15 Track B — Keltner Channel grid strategy on M5 timeframe. |
| **Backtest evidence** | Phase 15 envelope (0.00%/mo, 0 trades in 30-month window). |
| **Why it failed** | **Zero trade count** in the 30-month window — the strategy never fired on BTC/ETH/SOL. M5 noise on crypto. |
| **Citation** | `docs/research/phase15-strategy-brief.md` §5; `docs/research/REPORT-phase15.md` §4 |
| **Replacement** | None — Keltner Grid has no structural edge. |
| **Recoverable** | git: `git show bb656a1:packages/core/src/strategy/keltner-grid.ts` |

---

## 3. What we kept and why

The 8 strategy files that survived Phase 32 cleanup:

| File | Tier | Production role |
|------|------|-----------------|
| `donchian-pivot-composition.ts` | **PRODUCTION** | +34-46%/mo BTC/ETH/SOL, the production portfolio base |
| `donchian-range-channel.ts` | SUB-COMPONENT | Sub-strategy of DP composition (1 of 2 mean-reversion components) |
| `pivot-point-grid.ts` | SUB-COMPONENT | Sub-strategy of DP composition (1 of 2 mean-reversion components) |
| `composite.ts` | SUB-COMPONENT | Strategy composition wrapper (used by DP and other ensembles) |
| `funding-flip-kill-switch.ts` | SUB-COMPONENT | Kill-switch for carry strategies (used by dydx-cex-carry) |
| `dydx-cex-carry.ts` | **PRODUCTION** | +6.67%/mo BTC cross-venue carry, LatencyGate-wired |
| `dydx-cex-carry.paper-trade.ts` | (runner) | 7-day paper-trade gate for dydx-cex-carry |
| `cascade-fade.ts` | **PRODUCTION** | +1.35%/mo projected BTC cascade overlay |
| `multi-class-ensemble.ts` | (infrastructure) | Just exports `LatencyGate` / `createLatencyGate` types used by dydx-cex-carry. The multi-class-ensemble class itself was removed in Phase 27. |

**Codebase reduction: 18 → 8 strategy files (-56%), 0 production impact.**

---

## 4. Recovery procedure (if any of these are needed in the future)

```bash
# Recover from git history (commit bb656a1 was the last pre-deletion commit)
git show bb656a1:packages/core/src/strategy/multi-class-ensemble-v2.ts > packages/core/src/strategy/multi-class-ensemble-v2.ts
git show bb656a1:packages/core/src/strategy/multi-class-ensemble-v2.test.ts > packages/core/src/strategy/multi-class-ensemble-v2.test.ts

# Re-add the export to packages/core/src/index.ts
# Re-run typecheck + tests to ensure no regressions
bun run --filter='@mm-crypto-bot/core' typecheck
bun test packages/core/src/strategy/multi-class-ensemble-v2.test.ts
```

The same pattern works for all 10 deleted files. The git history is the single source of truth for what existed and why it was removed.

**OS Trash recovery** (faster, if files were recently deleted):
```bash
# macOS — files are in ~/.Trash/
ls ~/.Trash/ | grep -E "donchian|funding-carry|multi-class|regime|bollinger|keltner"
# Move back to original location
mv ~/.Trash/multi-class-ensemble-v2.ts packages/core/src/strategy/
```

---

## 5. Why this archive matters

The user directive (2026-07-09 22:53 Budapest): "amit torolsz azokrol legyen dokumentacio hogy mar probaltuk es nem valt be es miert" — the user explicitly asked for this archive.

**Future risks this archive mitigates:**
1. **Re-introduction**: A new developer sees a deleted strategy name in a citation and re-implements it. This document shows what was tried, what didn't work, and why — saving weeks of futile research.
2. **Lesson erosion**: The Phase 15 lessons (M5 noise on crypto) and Phase 27 lessons (carry environment dependence) are encoded in the per-strategy records. Without the archive, these lessons would have to be re-discovered.
3. **Audit trail**: Future audits can verify the deletion reasoning matches the empirical evidence. The git history + this document = complete provenance.

**The institutional memory is preserved in:**
- This document (per-strategy why-deleted records + recovery procedure)
- `docs/research/phase26-strategy-audit/REPORT-phase26.md` (the original tier classification)
- `docs/research/phase27-v2-promote/REPORT.md` (V2 OOS failure record)
- `docs/research/phase15-strategy-brief.md` (BB Squeeze / Keltner Grid original evidence)
- `docs/research/phase7-*` and `docs/research/phase8-*` (carry + trailing-stop lessons)
- Git history at commit `bb656a1` (the actual deleted code)

**Together, this is the complete "we tried this, it didn't work, here's why" archive.**

---

## 6. References (≥2 sources per deletion)

1. `docs/research/phase26-strategy-audit/REPORT-phase26.md` — Strategy portfolio audit (PRODUCTION/SUB-COMP/RESEARCH-KEEP/HALT tiers) — the source of the HALT/REMOVE classifications
2. `docs/research/phase27-v2-promote/REPORT.md` — V2 OOS validation FAILED (0.038-0.157) — the empirical evidence for V2 deletion
3. `docs/research/phase31-fresh-start-production-audit/REPORT.md` §6 — Per-strategy final verdict (18 strategies → 8 production/sub-component keepers)
4. `docs/research/phase15-strategy-brief.md` — BB Squeeze / Keltner Grid original evidence (zero trade count, M5 noise)
5. `docs/research/phase7-trailing-stop.md`, `phase7-carry-leverage.md` — Trailing-stop + carry leverage originals (superseded by DP / dydx-cex)
6. `docs/research/phase8-funding-timing.md` — Funding carry timing (superseded by dydx-cex)
7. `docs/research/phase16-notional-cap-regime-ensemble.md` — RRE original (superseded by DP)
8. Git commit `bb656a1` (last pre-deletion state, contains all 10 deleted files)

---

**END OF ARCHIVE**
