# Phase 18 Track C — Deliverable

**Track:** C — Integration + REPORT-phase18.md (final composition envelope)
**Branch:** `feat/phase18-c-integration-report` @ `0a72acf`
**PR:** [#44](https://github.com/EggProject/mm-crypto-bot/pull/44)
**Date:** 2026-07-06 23:58 Budapest (Europe/Budapest, UTC+2)
**Worktree:** `/Users/kiscsicska/projects/mm-crypto-bot/.worktrees/wt-phase18-c-integration-report`
**Author:** coder (M2)

---

## §1. Summary

Phase 18 Track C completes the integration of Track A (regime-ensemble
STRICT 2-of-2 default, PR #43 → `2a05cda`) and Track B (Donchian+Pivot
2-component composition, PR #42 → `2ccf77b`) on `main`. The deliverable
copies Track B's 2-of-2 backtest JSONs into the Phase 18 final-composition
naming convention (per brief "alternative simpler approach"), and writes
`docs/research/REPORT-phase18.md` (9 sections, 5962 words) with the full
empirical envelope citation map and Phase 19 roadmap. Headline:
**portfolio avg +18.84%/mo at 3.31% DD** (BTC +16.66%, ETH +16.29%, SOL
+23.57%).

## §2. Changed files

| File | Status | Size | Description |
|------|--------|-----:|-------------|
| `docs/research/REPORT-phase18.md` | NEW | 5962 words (9 sections) | Integration REPORT — every numerical claim cites a JSON path |
| `backtest-results/phase18-final-composition-btc-15m.json` | NEW (= Track B copy) | — | byte-identical to `phase18-donchian-pivot-btc-15m-2of2.json` |
| `backtest-results/phase18-final-composition-eth-15m.json` | NEW (= Track B copy) | — | byte-identical to `phase18-donchian-pivot-eth-15m-2of2.json` |
| `backtest-results/phase18-final-composition-sol-15m.json` | NEW (= Track B copy) | — | byte-identical to `phase18-donchian-pivot-sol-15m-2of2.json` |

**1 commit, 4 files changed, 1,163,772 insertions** (3 JSONs are large).

## §3. 12 backtest JSONs (cumulative for Phase 18)

### Track A — Regime-Routed Ensemble (6)

| # | File | Symbol | Mode | Monthly | Max DD |
|---|------|--------|------|--------:|-------:|
| 1 | `phase18-regime-ensemble-btc-15m-2of2-default.json` | BTC | STRICT 2-of-2 (new default) | +4.11%/mo | 8.59% |
| 2 | `phase18-regime-ensemble-eth-15m-2of2-default.json` | ETH | STRICT 2-of-2 (new default) | +5.65%/mo | 1.72% |
| 3 | `phase18-regime-ensemble-sol-15m-2of2-default.json` | SOL | STRICT 2-of-2 (new default) | +9.41%/mo | 1.93% |
| 4 | `phase18-regime-ensemble-btc-15m-1of2.json` | BTC | 1-of-2 (override) | 0.00%/mo | 50.00% KS |
| 5 | `phase18-regime-ensemble-eth-15m-1of2.json` | ETH | 1-of-2 (override) | 0.00%/mo | 50.04% KS |
| 6 | `phase18-regime-ensemble-sol-15m-1of2.json` | SOL | 1-of-2 (override) | 0.00%/mo | 50.00% KS |

### Track B — Donchian+Pivot 2-Component Composition (6)

| # | File | Symbol | Mode | Monthly | Max DD |
|---|------|--------|------|--------:|-------:|
| 7 | `phase18-donchian-pivot-btc-15m-2of2.json` | BTC | STRICT 2-of-2 (new default) | +16.66%/mo | 4.64% |
| 8 | `phase18-donchian-pivot-eth-15m-2of2.json` | ETH | STRICT 2-of-2 (new default) | +16.29%/mo | 1.95% |
| 9 | `phase18-donchian-pivot-sol-15m-2of2.json` | SOL | STRICT 2-of-2 (new default) | +23.57%/mo | 3.33% |
| 10 | `phase18-donchian-pivot-btc-15m-1of2.json` | BTC | 1-of-2 (override; high envelope) | +34.52%/mo | 7.18% |
| 11 | `phase18-donchian-pivot-eth-15m-1of2.json` | ETH | 1-of-2 (override; high envelope) | +37.82%/mo | 5.51% |
| 12 | `phase18-donchian-pivot-sol-15m-1of2.json` | SOL | 1-of-2 (override; high envelope) | +45.93%/mo | 7.70% |

### Track C — Final composition envelope (3, byte-identical to Track B 2-of-2 #7-9)

| # | File | Symbol | Monthly | Max DD |
|---|------|--------|--------:|-------:|
| 13 | `phase18-final-composition-btc-15m.json` | BTC | +16.66%/mo | 4.64% |
| 14 | `phase18-final-composition-eth-15m.json` | ETH | +16.29%/mo | 1.95% |
| 15 | `phase18-final-composition-sol-15m.json` | SOL | +23.57%/mo | 3.33% |

**Total: 15 backtest JSONs (12 unique + 3 final-composition copies).**

## §4. REPORT-phase18.md sections (9 sections, 5962 words)

| § | Title | Word count (approx) | Citations |
|---|-------|---------------------:|-----------|
| §1 | Executive Summary | ~750 | 6 JSONs cited |
| §2 | Regime-Ensemble STRICT 2-of-2 Results | ~870 | 6 JSONs (3 default + 3 override) |
| §3 | Donchian+Pivot 2-Component Composition Results | ~700 | 6 JSONs (2-of-2 + 1-of-2 modes) |
| §4 | Combined Phase 18 Final Composition Envelope | ~480 | 3 final-composition JSONs |
| §5 | +50%/month progress — Phase 1 through Phase 18 | ~530 | All 9 + 3 Phase 17 + 3 Phase 15 |
| §6 | Risks | ~620 | references §2-§4 metrics |
| §7 | Architecture lessons (memory candidates) | ~870 | references all 12 backtests |
| §8 | Phase 19 roadmap — top 5 ranked by ROI | ~620 | references §3 1-of-2 override |
| §9 | Files produced by Phase 18 — JSON backtest index | ~520 | self-referential |

**Every numerical claim in REPORT cites a JSON path** (e.g.,
"`phase18-donchian-pivot-btc-15m-2of2.json`") per task brief requirement.

## §5. Quality gates (all PASS on main post-merge of PRs #42 + #43)

```
$ bun run typecheck
 13 successful, 13 total
 Time: 3.996s
 Cached: 7 cached, 13 total

$ bun run lint
 8 successful, 8 total
 0 errors, 180 warnings (180 pre-existing in unrelated files)

$ bun test
 2393 pass, 0 fail, 16901 expect() calls
 Ran 2393 tests across 93 files. [6.21s]
```

**Test count delta:** Phase 17 closed at 2369 → Track A added 6 tests →
Track B added 18 tests → **Phase 18 closure at 2393 tests** (+24 net).

## §6. PR link

**PR #44:** https://github.com/EggProject/mm-crypto-bot/pull/44

PR body references PRs #42 (Track B) and #43 (Track A) explicitly, includes
the headline Phase 18 envelope table, and lists the Phase 19 roadmap link.

## §7. Notes for verifier

### Memory candidate — "Phase 18 ensemble dilution cascade"

The most important Phase 18 architectural lesson is the **ensemble
dilution cascade** (REPORT §7.1). M15 mean-reversion ensembles (range or
trend regime) require STRICT consensus (default 2-of-2) — the textbook
"1-of-N is better" logic INVERTES for solo-fire on parallel mean-reversion
sub-strategies: each solo fire looks like a real signal (the sub-strategy
IS validated), but the joint distribution of solos is noise with net
negative drift.

**Suggested AGENTS.md (or topic file) addition** (verbatim from REPORT §7.1):

> Phase 18 Track A finding: M15 mean-reversion ensembles (range or trend
> regime) require STRICT consensus (default 2-of-2), not relaxed consensus
> (1-of-N). Solo fires dilute. The relaxation path is preservable via a
> configurable `minConsensus` parameter but must NOT be the default.
> Track A producer initially implemented `minConsensus=1` per the literal
> brief, backtests came back byte-identical to Phase 17 (BTC still
> 0.00%/mo kill-switch) — the diagnostic that revealed the brief's
> "2-of-2 consensus" was a literal reason-tag string, not a logic gate.

### Spec hypothesis vs empirical reality — Track A

The Phase 18 §8 #1 candidate was described as "drop Regime-Routed
Ensemble consensus from 2-of-2 to 1-of-2 to lift BTC from 0.00%/mo
kill-switch to a viable +5-15%/mo envelope." When implemented literally
(`minConsensus=1` as default), the backtests reproduced Phase 17
byte-identical — confirming the brief was based on a misread. The
ACTUAL fix is the OPPOSITE direction (STRICT 2-of-2 silences the 26.96%
solo-fire diluter that was dragging BTC equity below the 50% DD
kill-switch). The `minConsensus` parameter remains configurable so the
1-of-2 path is reachable for research. **Track A deliverable.md §4
documents this explicitly.**

### Track B "alternative simpler approach" — final composition JSONs

The brief asked Track C to "combine Track A's regime-1of-2 + Track B's
donchian-pivot 2-of-2 as a single composition" via a hypothetical
`--include-regime-1of2` CLI flag. The flag does NOT exist on the Track
B CLI runner (verified — `--include-regime-1of2` is absent from
`packages/backtest-tools/src/cli/run-donchian-pivot-composition.ts`).
Per the brief's explicit "Alternative simpler approach" fallback,
Track C copied Track B's 2-of-2 JSONs to the `phase18-final-composition-*`
naming convention. The 3 final-composition JSONs are byte-identical to
Track B's 3 2-of-2 JSONs (same data, different file names).

### JSON file sizes (the 4 files committed are large)

The 3 final-composition JSONs are ~9MB each (Track B's 2-of-2 JSONs are
9051K-9199K BTC/ETH/SOL). The single commit is therefore 1,163,772
insertions (which is fine — see Phase 15 commits that pushed similar-size
JSONs without issue).

### Headline finding summary

- **Track A headline:** BTC regime-ensemble moves from 0.00%/mo kill-switch
  (Phase 17) to +4.11%/mo (Phase 18 STRICT 2-of-2 default).
- **Track B headline:** Donchian+Pivot 2-of-2 composition envelopes BTC
  +16.66%/mo @ 4.64% DD (beats Phase 15 Donchian baseline +13.35%/mo @
  5.77% DD by +3.31%/mo with -1.13pp DD).
- **Phase 18 final composition envelope:** portfolio avg +18.84%/mo @
  3.31% DD across BTC/ETH/SOL — the conservative Phase 18 final envelope.
- **+50%/mo verdict:** still NOT achievable at safe parameters
  (≤5% DD, no kill-switch). Phase 18 lifts the floor (~+18-25%/mo
  range) but the gap to +50%/mo requires either cap inflation (out of
  safe scope) or a fundamentally different edge (Phase 19+ candidates
  in REPORT §8).

---

**End of Phase 18 Track C deliverable.**
