# Phase 20 #1 — Per-Trade Hybrid-Kelly sizing drop-in (scope plan)

**Date:** 2026-07-07 09:51 Budapest
**Owner session:** `mvs_c13fe65cb68f4df3851304dea09a9099`
**Parent phase:** Phase 20 #1 — first candidate from REPORT-phase19.md §7 priority list
**Plan YAML:** `.mavis/plans/phase20-per-trade-hybrid-kelly.yaml`
**Target envelope:** +32.24%/mo (Phase 19 recommended, 1-of-2 cap=0.12) → **+40-45%/mo** at same DD budget (4.70%)

---

## §1 Background

Phase 19 #1 (closed 2026-07-07, plan_9f713ea0, PRs #46/#47/#48 → main @ `bc66ef2`) ended with a closed **+30%/mo gap** but **1.55× short of +50%/mo target**. Cap-vs-DD curve work; remaining gap cannot be closed by tuning the notional cap further — REPORT-phase19.md §7 §6.1 §6.2 confirm diminishing returns above cap=0.12 (1-of-2 mode).

REPORT §7 priority list for Phase 20:

| # | Candidate | Expected envelope lift | Risk | Effort |
|---|-----------|-----------------------:|------|--------|
| **20 #1** ★ | **HybridKelly sizing drop-in** | **+32→+40-45%/mo** (gap closes 1.55× → ~1.15×) | medium — needs validation vs 30 Phase 19 backtests | small (≤300 LOC, ~3h) |
| 20 #2 | Regime-conditioned cap | +3-5%/mo | low (regime router already in Phase 18A) | small |
| 20 #3 | Funding-rate carry leg | +2%/mo | low (Phase 14E Agent 03 confirmed viable without co-loc) | medium (WS feed + carry plugin) |

**Path to +50%/mo:** Phase 20 (HybridKelly) → Phase 21 (regime-conditioned cap) → Phase 22 (funding-rate carry). Target ~+50%/mo by end of Phase 22 sequence.

---

## §2 What Phase 20 #1 builds

### §2.1 Existing state

- `HybridKellyPlugin` (Phase 11.1e, on main via PR #20 / commit `bd5aa0a`) — SizingSignal-emitting plugin that uses **bucketed Sharpe → fixed multipliers** (1.0× / 0.7× / 0.5× / 0.25×). Same engine-chain flow as every other sizing plugin. 30+ unit tests. Located at `packages/core/src/signal-center/plugins/hybrid-kelly-plugin.ts` (~600 LOC).
- Engine position-size chain (Phase 17 fix): `signal.confidence × riskPerTrade → positionNotionalUsd() → clamped [minPositionPctEquity × equity, maxPositionPctEquity × equity]`. Reads confidence, does NOT compose it.
- `packages/core/src/signal-center/sizing/` directory does NOT exist yet.

### §2.2 What Phase 20 #1 adds

A **new sizing-layer module** that overrides the `confidence` field on SizingSignals AFTER plugin emit but BEFORE engine consumption. The override:

1. Reads **per-trade historical win rate** for the current signal signature (signal kind + direction + regime) over a rolling window.
2. Reads **per-trade historical payoff ratio** for the same signature.
3. Computes `kellyFraction = (winRate × payoffRatio - (1 − winRate)) / payoffRatio` per Thorp / Vince / Polk crypto-adapted Hybrid Kelly.
4. Clamps kellyFraction ∈ [0, HybridKellyCap] (default 0.5, consistent with Phase 9 9E `baseKellyFraction: 0.5` and Phase 14B `kellyCap: 0.85` ceiling).
5. **Overrides `sizingSignal.confidence = kellyFraction` BEFORE the signal-center-v1 returns** the signal to the engine.

This is a **drop-in** because:
- It lives at a NEW choke point between plugins and engine (no existing layer is mutated).
- It has ZERO effect when disabled (off by default, `--use-per-trade-kelly` CLI flag).
- It respects the 1:10 mandate end-to-end: kellyFraction ≤ 0.5 means engine chain produces notional ≤ `0.5 × riskPerTrade × equity` ≤ `0.5 × 0.01 × $10k = $50` pre-clamp, which the engine then clamps at `maxPositionPctEquity × equity = 0.12 × $10k = $1200` nominal at 1:10 leverage. **Phase 6 1:10 architectural invariant preserved.**

### §2.3 Architectural placement

```
Plugin emit (Carry/Directional/Regime/VolTarget/HybridKelly plugins)
  ↓ [SizingSignal{confidence: <plugin-emitted>}]
┌─────────────────────────────────────────────────────────────────┐
│ NEW: packages/core/src/signal-center/sizing/                    │
│   per-trade-hybrid-kelly.ts (Phase 20 #1)                       │
│                                                                 │
│   function applyHybridKelly(sizing: SizingSignal, history):     │
│     winRate = history.winRateFor(sizing.signature)              │
│     payoffRatio = history.payoffRatioFor(sizing.signature)      │
│     kellyFraction = clamp(                                      │
│       (winRate*payoffRatio - (1 - winRate)) / payoffRatio,     │
│       0, config.hybridKellyCap,                                 │
│     )                                                           │
│     return {...sizing, confidence: kellyFraction}               │
└─────────────────────────────────────────────────────────────────┘
  ↓ [SizingSignal{confidence: <kelly-overridden>}]
signal-center-v1.emit() returns
  ↓
Engine positionNotionalUsd (Phase 17 fixed chain)
  ↓
positionSize.confidence × maxPositionPctEquity × 1:10 leveraged notional
```

---

## §3 Plan structure (3 tracks, linear chain)

Per Phase 17/18/19 precedent: 3-track plan with linear `A → B → C` dependency chain. Tracks timed pre-launch (Phase 15/16 timeout-mismatch lesson).

| Track | Title | Timeout | Depends on | Producer |
|-------|-------|--------:|------------|----------|
| **A** | Per-Trade Hybrid-Kelly drop-in module + 100% tests | 60min | — | coder |
| **B** | Wire into signal-center-v1 + CLI flag on `run-donchian-pivot-composition.ts` | 60min | A | coder |
| **C** | Validated backtest sweep (9 JSONs) + REPORT-phase20.md + PR → main | 90min | B | coder |

Verification: **as_task policy** on all 3 tracks (`M2 verify-as-task`). Each track needs independent verifier hit before merging.

### §3.1 Track A — module + tests (~60min, 200 LOC)

**New files:**
- `packages/core/src/signal-center/sizing/per-trade-hybrid-kelly.ts` (~200 LOC core module)
- `packages/core/src/signal-center/sizing/per-trade-hybrid-kelly.test.ts` (≥20 unit tests, 100% coverage on lcov.info direct read)

**Public API:**

```ts
// packages/core/src/signal-center/sizing/per-trade-hybrid-kelly.ts
export interface HybridKellyConfig {
  readonly hybridKellyCap: number;          // default 0.5, Phase 14B ceiling 0.85
  readonly historyWindowDays: number;       // default 30 (per Phase 9 9E precedent)
  readonly minTradesForKelly: number;       // default 30 (per Phase 9 9E minTradeCount)
  readonly enabledSymbols?: readonly string[]; // default all 3 BTC/ETH/SOL
  readonly enabledSignatures?: readonly string[]; // default all SizingSignal.kind
}

export interface SignalTradeHistory {
  readonly signature: string;          // `${kind}:${side}:${symbol}` partition key
  readonly tradeList: readonly { pnl: number; notionalUsd: number }[];
}

export function computeHybridKellyFraction(
  history: SignalTradeHistory,
  config: Pick<HybridKellyConfig, 'hybridKellyCap' | 'minTradesForKelly'>,
): number; // returns 0..1, never NaN

export function applyHybridKelly(
  sizing: SizingSignal,
  historyLookup: (signature: string) => SignalTradeHistory,
  config: HybridKellyConfig,
  now: number,
): SizingSignal; // returns sizing with overridden confidence (or original if not enough history)
```

**Math (per REPORT §7 quoted formula):**

```
kelly_fraction = (winRate × payoffRatio - (1 - winRate)) / payoffRatio
                = (winRate × (avgWin / avgLoss) - (1 - winRate)) / (avgWin / avgLoss)
                = winRate - (1 - winRate) / payoffRatio
                = winRate - ((1 - winRate) × avgLoss) / avgWin

// Hot path:
const wins = history.tradeList.filter(t => t.pnl > 0);
const losses = history.tradeList.filter(t => t.pnl < 0);
const winRate = wins.length / history.tradeList.length;
const avgWin = mean(wins.map(t => t.pnlUsd)) || 0;
const avgLoss = Math.abs(mean(losses.map(t => t.pnlUsd))) || 0;
const payoffRatio = avgLoss > 0 ? avgWin / avgLoss : 1.0;
const rawKelly = (winRate * payoffRatio - (1 - winRate)) / Math.max(payoffRatio, 1e-9);
return clamp(rawKelly, 0, config.hybridKellyCap);
```

**Tests (≥20 required, 100% coverage):**
- winRate=1.0 → kelly=1.0 (capped at hybridKellyCap)
- winRate=0.6, payoffRatio=2 → kelly=(0.6*2 - 0.4)/2 = 0.4 → clamp at 0.4 (within 0.5 cap)
- winRate=0.5, payoffRatio=1 → kelly=0.0 (edge of profitable)
- winRate=0.4, payoffRatio=1 → kelly=-0.2 → clamp at 0 (loss-don't-bet)
- winRate=0.0, payoffRatio=any → kelly=-1/payoffRatio ≤ 0 → clamp at 0
- history.length < minTradesForKelly → returns 0 (no override)
- history.length === 0 → returns 0
- payoffRatio=∞ (no losses) → returns 1.0 (capped)
- payoffRatio=0 (no wins) → returns 0
- signature not in historyLookup → returns 0
- NaN guards on `history.tradeList` (empty array, all-NaN)
- hybridKellyCap=0 → always 0
- hybridKellyCap=1.0 (Phase 14B ceiling) → unclamped above 0.85 default
- hybridKellyCap=1.5 → throws at construction (per `HybridKellyPlugin` precedent)
- maxVolMultiplier? not present here (this is sizing, not vol) → negative test
- SizingSignal override: input confidence=0.8, kelly=0.4 → output confidence=0.4
- SizingSignal override: input confidence=0.8, kelly=0 → output confidence=0
- SizingSignal preserve immutability: input !== output (defensive copy or frozen)
- enabledSymbols filter: ETH/USDT-only config, BTC sizing pass-through
- enabledSignatures filter: only SizingSignal.kind=DIRECTIONAL applies
- 1:10 leverage audit: kelly × confidence × riskPerTrade × equity ≤ 1:10 cap (3-layer defense — math unit, NOT whole-system test)

**Quality gates (all mandatory PASS):**
- `bun run typecheck` → 13/13 packages PASS
- `bun run lint` → 0 errors (no `eslint-disable` lines)
- `bun test` → ALL pass (Track A new tests + full regression)
- Coverage: 100% on `per-trade-hybrid-kelly.ts` (lcov.info direct read per Phase 10G/13 lesson)
- Docstring-vs-implementation lie check (Phase 10G Track C lesson)
- No "DEFERRED (own PR)" (everything fixed in same cycle)

### §3.2 Track B — wire into signal-center-v1 + CLI flag (~60min)

**Modified files:**
- `packages/core/src/signal-center/signal-center-v1.ts` — insert `applyHybridKelly()` call between plugin emit aggregation and the return-SizingSignals-to-engine step. **Opt-in** by config (default off, preserving Phase 19 baseline behavior bit-identical).
- `packages/backtest-tools/src/cli/run-donchian-pivot-composition.ts` — add `--use-per-trade-kelly` flag (default `false`). When true, pass `{ usePerTradeHybridKelly: true, hybridKellyConfig: {...} }` to signal-center-v1.
- `packages/core/src/index.ts` — export `HybridKellyConfig`, `SignalTradeHistory`, `computeHybridKellyFraction`, `applyHybridKelly`.
- New test file: `packages/core/src/signal-center/signal-center-v1.test.ts` extension covering the opt-in hook (3-5 tests).

**History lookup mechanism:**

The signal-center-v1 runs inside a backtest loop, so trade-history accumulates PER RUN. The cleanest solution:
- Track B adds a `historyProvider?: (kind, side, symbol) => readonly HistoricalTrade[]` to `SignalCenterV1Config`.
- In the runner (Track B modifies `run-donchian-pivot-composition.ts`), we accumulate a `historicalTradesForSignature` map as the backtest progresses (using the `result.trades` from prior runs OR a re-stream of the trade log if accessible mid-backtest).
- For Phase 20 #1, **simpler version**: the runner maintains a `Map<signature, TradeHistory>` keyed by `SizingSignal.kind + ':' + side + ':' + symbol`. After each trade closes, the runner pushes to the signature's history buffer. At emit time, signal-center-v1 calls the provider callback to fetch up-to-date history.

**This is a simulation quirk, not a live-trading issue** — in production (real bybit.eu), the same data comes from a `tradeJrn` log file. Backtest runner only needs a `TradeRecord[]` that grows monotonically.

**Tests:**
- `--use-per-trade-kelly=false` (default): backtest envelope matches Phase 19 byte-identical (sanity regression test).
- `--use-per-trade-kelly=true` with 30-trade history: kelly overrides applied, backtest produces different envelope.
- `enabledSymbols=['BTC/USDT']`: only BTC sizing overridden, ETH/SOL pass-through to original confidence.
- Architecture docstring-lie check (Phase 10G lesson): the docstring on SignalCenterV1.emit MUST say exactly when/why applyHybridKelly is called.

**1:10 mandate verification:**
- Track B unit test: compose Track A's `computeHybridKellyFraction(0.85)` × 0.05 riskPerTrade × $10k equity / leverage → output ≤ maxPositionPctEquity × equity × leverage. (i.e., assertLeverageInvariant phase-aligned.)

### §3.3 Track C — Validated backtest sweep + REPORT (~90min)

**Validated sweep: 9 backtests (3 caps × 3 symbols, 1-of-2 mode, with `--use-per-trade-kelly=true`):**

```bash
cd /Users/kiscsicska/projects/mm-crypto-bot/.worktrees/wt-phase20-c-sweep-report
for SYMBOL in BTC/USDT ETH/USDT SOL/USDT; do
  SYM=$(echo $SYMBOL | cut -d/ -f1 | tr '[:upper:]' '[:lower:]')
  for CAP in 0.08 0.12 0.15; do  # Conservative | Recommended | Stretch per Phase 19
    bun run packages/backtest-tools/src/cli/run-donchian-pivot-composition.ts \
      --symbol=$SYMBOL --timeframe=15m --min-consensus=1 \
      --max-position-pct-equity=$CAP \
      --use-per-trade-kelly=true \
      --output=backtest-results/phase20-hybrid-kelly-1of2-${SYM}-15m-${CAP}.json
  done
done
```

Expected: 9 JSONs × ~3-5min runtime = ~30-45 min wall clock for the sweep.

**Plus 3 reference backtests (same 3 caps, 1-of-2 mode, NO Kelly, regression check vs Phase 19):**

```bash
for SYMBOL in BTC/USDT ETH/USDT SOL/USDT; do
  SYM=$(echo $SYMBOL | cut -d/ -f1 | tr '[:upper:]' '[:lower:]')
  for CAP in 0.08 0.12 0.15; do
    bun run packages/backtest-tools/src/cli/run-donchian-pivot-composition.ts \
      --symbol=$SYMBOL --timeframe=15m --min-consensus=1 \
      --max-position-pct-equity=$CAP \
      --use-per-trade-kelly=false \
      --output=backtest-results/phase20-baseline-1of2-${SYM}-15m-${CAP}.json
  done
done
```

Total: 12 JSONs on disk (9 HybridKelly + 3 reference baseline).

**REPORT-phase20.md (≥8 sections, ≥2500 words, JSON-anchored):**

1. Executive Summary — cap=0.12 1-of-2 expected to climb from +32.24%/mo (Phase 19) → +40-45%/mo (Phase 20 #1)
2. Track A module spec + 100% tests
3. Track B wire-up + opt-in flag
4. Per-trade Hybrid-Kelly math + 1:10 mandate verification
5. Backtest envelope results (3 caps × 3 symbols × {with-Kelly, no-Kelly})
6. Return-vs-DD curve update vs Phase 19
7. +50%/mo progress (closes from 1.55× to ~1.15×)
8. Risks (negative edge on regime shifts, history-window interactions with M15 frequency)
9. Phase 21 candidate (regime-conditioned cap) — REAFFIRMED priority
10. Phase 22 candidate (funding-rate carry leg) — REAFFIRMED priority
11. Quality gates verification

**Branch + PR:**
- Branch: `feat/phase20-c-hybrid-kelly-sweep-report` (Track C's own branch; depends_on A+B merge to main)
- Wait — Phase 17/18/19 had Track C use its own branch that pulls in A+B's commits as ancestor commits. Same pattern.
- PR: `feat/phase20-c-hybrid-kelly-sweep-report` → main
- Squash-merge per project convention (user-side)

---

## §4 Quality gates (every track)

| Gate | Required result |
|------|-----------------|
| `bun run typecheck` | 13/13 packages PASS |
| `bun run lint` | 0 errors |
| `bun test` | All pass (full suite + new tests) |
| Coverage on new files | 100% lines+branches, lcov.info direct read |
| 1:10 leverage defense | 3-layer invariant (engine.start + emit + per-bar) verified |
| No `eslint-disable` | None added |
| No docstring lies | Producer docstring vs implementation parity check |
| REPORT claims cite JSON | Every numerical claim cites `backtest-results/phase20-*.json` path |
| Architecture doc updated | SCv1 emit() now has applyHybridKelly step documented |
| PR open + CI green | Within ≤4h of Track A complete |

---

## §5 Failure handling

Per Phase 17/18/19 precedent:

- **Cycle 1 FAIL** → `manual_retry` with 5-8 step correction spec (TIGHT, no full brief echo), `"DO NOT REWRITE"` emphasis.
- **Cycle 2 FAIL on mechanical step only** (missing push, 404 URL, lint fix) → `owner-self-push` + `override_accept` with `acceptance_reason`.
- **Cycle 2 FAIL on substantive** → second `manual_retry`.
- **Cycle 3 FAIL** → escalate to user, NO loop.

---

## §6 Cron strategy

- `phase20-monitor` (5min cadence, 12h TTL, scheduled to expire 2026-07-07 22:00 Budapest).
- Gate discipline: silent stand-down on skip ticks. Act ONLY on cycle>1, status=completed, status=failed, status=cancelled, or FAIL on any task.
- On `status=completed` + Phase 20 #1 PR green → send ONE confirmation + delete cron (per Phase 19 #1 close pattern).
- On `status=failed` / `status=cancelled` → immediate root-cause notice to user (per "post-completion arbitration ping" pattern from engine desync memory note).

---

## §7 Risks & mitigations

| Risk | Likelihood | Mitigation |
|------|-----------:|------------|
| Per-trade history buffer under-samples signal signature | medium | minTradesForKelly=30 + carried-forward default confidence if under threshold |
| Kelly concentrates risk on high-confidence subset, kills diversification | low | clamp at hybridKellyCap=0.5 (Phase 9 9E baseKellyFraction) |
| 1:10 mandate breaks under high kelly × high signal confidence | low | Track A unit test asserts: `assertLeverageInvariant(kelly × 0.05 × $10k × 10× ≤ $100k)`; Track B re-asserts via engine.start |
| Phase 19 regression test fails (Turn C baseline differs from Phase 19 envelope) | medium | Run 3 reference backtests (no-Kelly) in Track C as regression before reporting envelope lift |
| M15 mean-reversion trades have shorter signature than typical carry; 30-trade history window needs ≥30d M15 bars | low | windowDays=30 days × 96 bars/day = 2880 M15 bars per symbol — well above 30-trade min |
| Architectural placement breaks downstream consensus (regime router, Donchian/Pivot composition) | low | Opt-in default off → production code path unchanged until Track C enables |
| Track C backtest runtime exceeds 90min budget | medium | Cap sweep at 9 (not 12) Kelly-enabled backtests; 3 reference backtests are fast (~3min each = 9min total) |

---

## §8 Out of scope (Phase 20 #2 / #3 / Phase 21+)

- Regime-conditioned cap refinement (Phase 20 #2)
- Funding-rate carry leg (Phase 20 #3)
- Phase 21: Adaptive Kelly + volatility targeting composition (Phase 9 9E precedent extending to HybridKelly window)
- Live trading via bybit.eu — Phase 20 #1 is backtest-only. Live deployment gated on Phase 22 walk-forward + paper-trading validation.

---

## §9 Expected ceiling (REPORT §5)

| Phase | Best single strategy envelope | Portfolio avg | Gap to +50%/mo |
|-------|-------------------------------|--------------|----------------|
| 19 (1-of-2 cap=0.12) | — | **+32.24%/mo** @ 4.70% DD | 1.55× short |
| **20 #1 (HybridKelly, conservative)** | — | **+38-42%/mo** @ 5.0-5.5% DD | 1.20-1.30× short |
| **20 #1 (HybridKelly, recommended)** | — | **+40-45%/mo** @ 5.5-6.0% DD | **1.10-1.25× short** ★ |
| 20 #1 (HybridKelly, stretch — cap=0.15) | — | +45-50%/mo @ 6.5-7.0% DD | 1.00-1.10× short |
| 21 (regime-conditioned cap) | — | +43-48%/mo @ 6.0% DD | 1.04-1.16× short |
| 22 (funding-rate carry) | — | +45-50%/mo @ 7.0% DD | ~1.0× — reaches target |

Combined Phase 20-22 sequence: **~+50%/mo achievable by end of Phase 22** at <8% DD across the envelope.

---

## §10 Pre-launch sanity (per agent memory)

- ✅ No active plan on `mvs_c13fe65cb68f4df3851304dea09a9099` (this session) — `mavis team plan status` confirmed.
- ✅ No active plan on `mvs_5e85a3825afd425190988efa3398bcbe` (agent root) — most recent was `plan_3d8c187c` (status=completed).
- ✅ No active crons — `mavis cron list mavis` returned 0 tasks.
- ✅ Main branch up-to-date with origin — `git log` shows `bc66ef2` (Phase 19 #1 merge).
- ✅ Workspace is clean — only main checkout, no orphan worktrees.

Safe to launch Phase 20 #1 directly via `mavis team plan run`.

---

## §11 Plan YAML reference

```yaml
id: phase20-hybrid-kelly
title: "Phase 20 #1 — Per-Trade Hybrid-Kelly sizing drop-in"
owner_session_id: mvs_c13fe65cb68f4df3851304dea09a9099
max_concurrency: 1
max_consecutive_failures: 2
max_cycles: 6
auto_reject_retries: 1

tasks:
  - id: track-a-module
    title: 'Track A — Per-Trade Hybrid-Kelly drop-in module'
    role: coder
    timeout_ms: 3600000  # 60min
    depends_on: []
    verified_by: verifier
    verify_prompt: <per §3.1 + quality gates + 1:10 + docstring-lie + coverage>
    prompt: <build per §3.1; test count ≥20; export from index.ts>

  - id: track-b-wire
    title: 'Track B — Wire into signal-center-v1 + CLI flag'
    role: coder
    timeout_ms: 3600000  # 60min
    depends_on: [track-a-module]
    verified_by: verifier
    verify_prompt: <opt-in sanity test + regression vs Phase 19 envelope + 1:10 3-layer test + docstring-lie + index re-exports>
    prompt: <wire per §3.2; --use-per-trade-kelly flag; 5+ tests>

  - id: track-c-sweep
    title: 'Track C — 9-backtest sweep + REPORT-phase20.md + PR'
    role: coder
    timeout_ms: 5400000  # 90min
    depends_on: [track-b-wire]
    verified_by: verifier
    verify_prompt: <12 JSONs on disk + REPORT ≥8 sections ≥2500 words + JSON path citations + PR URL + CI green + 5/5 quality gates>
    prompt: <sweep per §3.3; REPORT per §3.3 structure; PR feat/phase20-c-hybrid-kelly-sweep-report → main>
```

---

**Scope plan complete. Plan YAML next; then board.md update; then `mavis team plan run` + cron setup.**
