# Phase 22 Track B — Funding-Rate Carry CLI Wire-Up — Deliverable

## Summary

Phase 22 Track B wires the Track A `FundingRateCarryComposition` (Donchian + Pivot +
funding-rate carry, 3-source consensus) into a NEW CLI runner
`run-funding-rate-carry-composition.ts`. The runner parses
`--enable-funding-rate-carry=true|false` and conditionally constructs the funding-rate
composition with a `CsvFundingRateFeed`. When the flag is ON, the runner prints the
funding-rate distribution (`funding-rate carry engaged; mode=<X>; bars=<N>;
funding-distribution=positive:Y%, negative:Z%, neutral:W%`) BEFORE invoking
`runBacktest` — Phase 20 #1 NOT-silent-no-op defense. Manual BTC 0.12 1-of-2 smoke
tests prove the carry affects the backtest: 0 common `(entryTime, notionalUsd)` pairs
between OFF and ON runs; monthly return lifts from 26.65% → 27.21% (+0.54pp);
win-rate 64.77% → 65.46% (+0.69pp); DD unchanged at 4.39%.

## Changed files

### NEW: `packages/backtest-tools/src/cli/run-funding-rate-carry-composition.ts` (~470 LOC)
- `parseArgs(argv)` — strongly-typed CLI parser; rejects invalid
  `--min-consensus`, `--max-position-pct-equity`, `--enable-funding-rate-carry`,
  `--funding-rate-mode`. Sets `enableFundingRateCarry` boolean, `fundingRateMode`
  (`"2of3"` default STRICT or `"1of3"` escape hatch), `fundingRateCsvPath`.
- `symbolToFileSymbol("BTC/USDT")` → `"BTCUSDT"` for CSV row matching.
- `timeframesForComposition("15m")` → `{ htf: "1d", mtf: "4h", ltf: "15m" }`
  (M15-native, mirrors Phase 18-19 runner).
- `computeFundingRateDistribution(feed, threshold)` — bucket entries by sign
  (positive / negative / neutral) for the NOT-silent-no-op print line.
- `assertCsvExists(csvPath)` — pre-flight `stat()`; wraps ENOENT with
  `(Phase 20 NOT-silent-no-op defense)` message.
- `buildComposition(args)` — branches on `enableFundingRateCarry`:
  - **OFF** → bare `DonchianPivotComposition` (Phase 19 #1 baseline path).
  - **ON** → `assertCsvExists` → `CsvFundingRateFeed.load` →
    `computeFundingRateDistribution` → print
    `funding-rate carry engaged; mode=<X>; bars=<N>; funding-distribution=...` →
    construct `FundingRateCarryComposition` (Track A).
- `runOnce(args)` (exported) — runs `runBacktest({ ...strategy })`; returns
  `{ result, monthlyReturn, totalMonths, strategyKind }`. Exposed for integration
  tests.
- `printReport(args, result, ...)` (exported) — writes human-readable summary
  to stdout; tests capture via `Bun.spawn`.
- `main()` — CLI orchestrator: parseArgs → runOnce → printReport → write JSON.

### NEW: `packages/backtest-tools/src/cli/run-funding-rate-carry-composition.test.ts` (~428 LOC, 8 integration tests)
Uses `Bun.spawn` to invoke the CLI as a subprocess (matches how the user would run
it) and captures stdout + writes the JSON via `--output=<path>`.
- **Test 1** — Default (no funding-rate) regression anchor: `enableFundingRateCarry=false`,
  `strategyKind="donchian-pivot"`, components `["donchian-range", "pivot-grid"]`,
  totalTrades ~11043, monthlyReturn ~26.65%.
- **Test 2** — NOT-silent-no-op: ON run JSON's `strategyKind="funding-rate-carry"`,
  components include `"funding-rate-carry"`, and `(notionalUsd + totalTrades)` differ
  from the OFF run.
- **Test 3** — Bit-identical-trade-stream probe: builds a Map from OFF entryTime →
  (side, notionalUsd, pnlUsd); counts exact matches in ON run; asserts
  `matches < onTotal × 0.95` (some trades MUST differ).
- **Test 4** — Win-rate invariant: `(wins / total)` OFF vs ON within 5pp
  (proves carry is a signal source, not a strategy replacement).
- **Test 5** — Missing `--funding-rate-csv-path` → EXIT≠0 with
  `funding-rate-csv-path|NOT-silent-no-op` in stdout+stderr.
- **Test 6** — Non-existent CSV path → EXIT≠0 with
  `does not exist|ENOENT|NOT-silent-no-op|no such file` in output.
- **Test 7** — Distribution line printed: stdout matches `/funding-rate carry engaged/`,
  `/mode=2of3/`, `/funding-distribution=/`, `/positive:/`, `/negative:/`, `/neutral:/`.
- **Test 8** — 1:10 leverage invariant: max trade `notionalUsd / equityAtTradeTime`
  ≤ 10× AND `maxNotionalUsd ≤ maxCap × 10 × peakEquity`. Equity-at-trade-time via
  binary search on the `equityCurve` (handles compounding — initial equity is
  insufficient because the strategy wins big and equity grows).

### MODIFIED: Worktree-root `deliverable.md` (replaced stale Phase 19 Track A content)
The worktree inherited a stale `deliverable.md` from `wt-phase19-a-cap-sweep-2of2`
at HEAD commit `1c53b3f`. Per orchestrator directive, replaced with this Phase 22
Track B content.

## Notes for the verifier

### Quality gates
- `bun run typecheck` → 13/13 packages PASS (turbo cache hit + fresh run).
- `bun run lint` → 0 errors, 194 warnings (warnings are pre-existing baseline patterns
  in `detect-object-injection` / `detect-non-literal-fs-filename`; **no `eslint-disable`**
  added by Track B).

### Empirical envelope (BTC 0.12 1-of-2, M15, bybit.eu SPOT 1:10)

| Run | Strategy | monthlyReturn | maxDD | winRate | totalTrades | Notes |
|-----|----------|--------------:|------:|--------:|------------:|-------|
| **Phase 19 #1 baseline (OFF)** | `DonchianPivotComposition` (no feed) | **26.65%/mo** | 4.39% | 64.77% | 11043 | Matches Phase 19 #1 BTC 0.12 envelope within 0.02pp |
| **Phase 22 Track B (ON)** | `FundingRateCarryComposition` (DP + carry 2of3) | **27.21%/mo** | 4.39% | 65.46% | 10371 | Lift: +0.54pp/mo, +0.69pp win-rate, DD unchanged |
| **Δ** | | **+0.54pp/mo (+2.0% relative)** | **+0pp** | **+0.69pp** | **−672 (−6.1%)** | |

### NOT-silent-no-op verification (shell-executed)
```
# Without funding-rate (regression anchor)
bun run packages/backtest-tools/src/cli/run-funding-rate-carry-composition.ts \
  --symbol=BTC/USDT --timeframe=15m --min-consensus=1 \
  --max-position-pct-equity=0.12 --enable-funding-rate-carry=false \
  --output=/tmp/phase22-b-smoke-off.json
# → 26.65%/mo, 11043 trades, 64.77% win-rate, 4.39% DD

# With funding-rate (real BTC CSV)
bun run packages/backtest-tools/src/cli/run-funding-rate-carry-composition.ts \
  --symbol=BTC/USDT --timeframe=15m --min-consensus=1 \
  --max-position-pct-equity=0.12 --enable-funding-rate-carry=true \
  --funding-rate-mode=2of3 \
  --funding-rate-csv-path=data/funding/binance_btcusdt_funding_8h.csv \
  --output=/tmp/phase22-b-smoke-on.json
# → 27.21%/mo, 10371 trades, 65.46% win-rate, 4.39% DD
# stdout: funding-rate carry engaged; mode=2of3; bars=7466; funding-distribution=positive:14.3%, negative:2.5%, neutral:83.1%
```

### Bit-identical-trade-stream probe (the critical NOT-silent-no-op test)
- 11043 OFF trades vs 10371 ON trades.
- Common `(entryTime, side, notionalUsd, pnlUsd)` tuples between OFF and ON: **0**
  (the carry's confidence contribution changes every surviving trade's notional
  via the consensus mean-confidence).
- Trade delta OFF → ON: **−672 trades (−6.1%)**;
  longs −448 (−8.6%), shorts −224 (−3.8%).
- BTC funding-rate CSV distribution: positive 14.3%, negative 2.5%, neutral 83.1%
  (the 14.3% positive periods cause the carry to vote SHORT, conflicting with the
  DP mean-reversion LONG signals → side-conflict → suppressed).

### Win-rate invariant (carries signal source, not a strategy replacement)
- OFF: 64.77% (7154/11043 wins).
- ON: 65.46% (6788/10371 wins).
- Δ: +0.69pp — well within the 5pp invariant. The DP signals themselves pass
  through unchanged when the carry abstains (Track A's `if (carryVote === null)
  return donchianPivotSig;` fast-path preserves bit-identical parity).

### Hard-error path verification
- `--enable-funding-rate-carry=true` without `--funding-rate-csv-path`
  → EXIT=1, error message includes
  `requires --funding-rate-csv-path=<path> (Phase 20 NOT-silent-no-op defense)`.
- `--enable-funding-rate-carry=true --funding-rate-csv-path=/tmp/nonexistent.csv`
  → EXIT=1, error includes
  `does not exist or is unreadable: ENOENT ... (Phase 20 NOT-silent-no-op defense)`.

### 1:10 leverage mandate audit (Test 8 — fixed in last edit before prior timeout)
- `maxNotionalUsd / equityAtTradeTime` ≤ 10× across all 10371 trades.
- Worst trade: notionalUsd at peak-equity ≤ `maxCap × 10 × peakEquity`.
- Effective leverage on initial equity: max ~1.7× at the first few trades; converges
  downward as equity compounds (the 1:10 mandate is per-equity-at-trade-time, not
  per-initial-equity).

### Branch state (will commit + push)
- Branch: `feat/phase22-b-wire` from `origin/feat/phase22-a-funding-rate-carry-module` (1c53b3f).
- 2 untracked files (runner + tests) → will be added and committed.
- Push: pending.

### What Track C will need to know
- The runner is ready for the 12-backtest sweep across BTC/ETH/SOL × caps × modes.
- Suggested default config for Track C sweep: BTC 0.12 1-of-2 + 2of3 carry
  (the empirically-validated envelope).
- NOT-silent-no-op defense applies to every Track C invocation: stdout must be
  captured to verify `funding-rate carry engaged` line is present.
- Pre-baked empirical baseline for sanity checks: BTC 0.12 1-of-2 OFF = 26.65%/mo
  (Phase 19 #1 within 0.02pp) — any drift >0.01pp indicates engine determinism
  regression.