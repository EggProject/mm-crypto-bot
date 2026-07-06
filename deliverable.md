# Phase 15 Track B — Pivot Point Grid (M15) + Bollinger Range Squeeze (M5)

## Summary

Implemented two of the four Phase 15 simple-retail strategies end-to-end:
- **Pivot Point Grid** (`pivot-point-grid.ts`) — deterministic HTF-anchored
  grid on M15 LTF, built from previous 1d candle.
- **Bollinger Range Squeeze** (`bollinger-range-squeeze.ts`) — MTF BB
  squeeze detector + filtered breakout on M5 LTF.

Both with ≥100% line + 100% function coverage on the new files
(verified by direct `lcov.info` read), workspace-wide typecheck + lint
green, 455/455 strategy tests pass (was 425 — added 30).

## Files created (all under `packages/core/src/strategy/`)

| File | LOC | Tests | Coverage (lcov.info) |
|------|----:|------:|----------------------|
| `pivot-point-grid.ts` | 244 | — | LF:LH = 97:97, FNF:FNH = 3:3 |
| `pivot-point-grid.test.ts` | 357 | 14 | n/a (test file) |
| `bollinger-range-squeeze.ts` | 190 | — | LF:LH = 63:63, FNF:FNH = 3:3 |
| `bollinger-range-squeeze.test.ts` | 321 | 16 | n/a (test file) |

Total: **1112 LOC** across 4 files.

Branch pushed: `feat/phase15-b-pivot-bb-squeeze` @ commit `8731185`
on top of `main` (`a00bf78`). Awaiting PR open by orchestrator
(`/new/feat/phase15-b-pivot-bb-squeeze` — gh CLI unauthenticated in this
session, matching Phase 14D precedent where the orchestrator opens
PRs manually with the GH_TOKEN from keychain).

## Strategy design notes

### Pivot Point Grid (M15 LTF, 1d HTF for pivots)

- **Pivots** are deterministic Fibonacci-multiple bands of the previous
  daily candle's range: `PP=(H+L+C)/3`, `R1/S1=PP±0.382×(H-L)`,
  `R2/S2=PP±0.618×(H-L)`, `R3/S3=PP±(H-L)`. Configurable via `PivotPointGridConfig`.
- **Entries** (long: close at/below S2 then S1; short: close at/above R2 then R1).
  - `close ≤ S2` → buy, `SL=S3`, `TP=PP`, confidence 1.0
  - `S2 < close ≤ S1` → buy, `SL=S2`, `TP=PP`, confidence 0.7
  - `close ≥ R2` → sell, `SL=R3`, `TP=PP`, confidence 1.0
  - `R1 ≤ close < R2` → sell, `SL=R2`, `TP=PP`, confidence 0.7
  - Middle zone (`S1 < close < R1`) → no signal.
- **HTF accumulator** — the engine's `IndicatorState` doesn't expose
  HTF OHLC directly, so the strategy maintains
  `curr{High,Low,Close}` (in-progress 1d bucket rolled up from M15)
  + `prev{High,Low,Close}` (committed H/L/C of the just-finished 1d).
  At each LTF candle whose `timestamp % 86_400_000 === 0` (start of UTC
  day), we commit `curr* → prev*` BEFORE resetting `curr*` for the new
  bucket. `committedPrevHtfAtLeastOnce` is exposed as a public flag for
  tests.
- **Warmup**: 100 LTF (M15) candles (~25h). Past warmup gate, plus a
  complete 1d rollup has been observed.
- **Sizing is engine-side** (1:10 leverage mandate, 9× borrowed on
  bybit.eu SPOT) — this strategy only emits direction signals.

### Bollinger Range Squeeze (M5 LTF, 1h MTF for BB)

- **bbWidth = (bbUpper − bbLower) / bbMiddle**.
- A candle where `bbWidth < squeezeThreshold (default 0.020)` is in
  squeeze. Consecutive squeeze candles are counted (`state.squeezeCandles`,
  exposed for tests).
- Counter resets to 0 on any non-squeeze candle, OR after a breakout
  emits. The BREAKOUT CHECK happens BEFORE the counter update so a candle
  that is also outside the band does NOT increment its own count.
- A breakout is eligible when `state.squeezeCandles ≥ minConsecutiveSqueezeCandles` (default 2).
- **Long breakout**: `close > bbUpper` → buy, `SL=bbMiddle`, `TP=bbUpper+atr×atrBreakoutMultiplier` (default 2.0).
- **Short breakout**: `close < bbLower` → sell, `SL=bbMiddle`, `TP=bbLower−atr×atrBreakoutMultiplier`.
- **Warmup**: 30 M5 candles (~2.5h).
- **Sizing is engine-side** (1:10 leverage mandate).

## Tests (Pass / Accept verification)

### Pivot Point Grid — 14 tests

1. Default Fibonacci multipliers (0.382 / 0.618 / 1.0).
2. Custom multipliers respected (0.5 / 1.0 / 1.5).
3. `warmup()` returns 100.
4. `candleIndex < warmup` → null signal.
5. Missing prev HTF → null signal.
6. Boundary candle (`timestamp % 86_400_000 === 0`) commits `prev*` + resets accumulator.
7. Pivot recomputed when a new HTF candle rolls up.
8. Within-bucket candles extend the running H/L/C (no commit until boundary).
9. `close ≤ S2` → LONG deep, `SL=S3`, `TP=PP`, confidence=1.0.
10. `S2 < close ≤ S1` → LONG shallow, `SL=S2`, `TP=PP`, confidence=0.7.
11. `close ≥ R2` → SHORT deep, `SL=R3`, `TP=PP`, confidence=1.0.
12. `R1 ≤ close < R2` → SHORT shallow, `SL=R2`, `TP=PP`, confidence=0.7.
13. Middle zone (`S1 < close < R1`) → null.
14. `name` contains "Pivot Point Grid", `timeframes = ["1d", "15m"]`.

### Bollinger Range Squeeze — 16 tests

1. Default config (0.020 / 2 / 2.0).
2. Custom `squeezeThreshold` persists.
3. Custom `minConsecutiveSqueezeCandles` persists.
4. Custom `atrBreakoutMultiplier` persists.
5. `warmup()` returns 30.
6. `candleIndex < warmup` → null.
7. Missing MTF BB values → null.
8. Missing LTF ATR → null.
9. `ltf.atr = 0` (degenerate) → null.
10. `bbMiddle ≤ 0` (division-by-zero guard) → null.
11. `bbWidth < threshold` increments counter but no signal yet.
12. 2 consecutive squeeze + `close > bbUpper` → LONG breakout, `SL=bbMiddle`, `TP=bbUpper+2×ATR`, count resets.
13. 2 consecutive squeeze + `close < bbLower` → SHORT breakout, mirror values.
14. Single squeeze then exit → no breakout signal (count not yet qualified).
15. Squeeze counter resets to 0 on wide-band candles, then re-qualifies for next breakout.
16. `name` contains "Bollinger Range Squeeze", `timeframes = ["1h", "5m"]`.

## Quality gates

| Gate | Result |
|------|--------|
| `bun run typecheck` (workspace root, 13 tasks) | PASS — 13/13 |
| `bun run lint` (workspace root, 8 tasks) | PASS — 0 errors (265 pre-existing `security/detect-object-injection` warnings, all on the same false-positive rule that already trips 263 times elsewhere; my new code adds 2 of these on `candles[i]!` array access in test helpers — same rule, same false positive) |
| `bun test packages/core/src/strategy/` | PASS — 455/455 (was 425; +30 new) |
| `bun test src/strategy/pivot-point-grid.test.ts` | PASS — 14/14, 41 expect() |
| `bun test src/strategy/bollinger-range-squeeze.test.ts` | PASS — 16/16, 39 expect() |
| Coverage on `pivot-point-grid.ts` (lcov.info direct read) | **100% lines (LF:LH = 97:97), 100% functions (FNF:FNH = 3:3)** |
| Coverage on `bollinger-range-squeeze.ts` (lcov.info direct read) | **100% lines (LF:LH = 63:63), 100% functions (FNF:FNH = 3:3)** |

Branch coverage (`BRF:0, BRH:0` in `lcov.info`) is a documented
[Bun V8 lcov reporter limitation](https://bun.sh/docs/test/coverage)
— Bun's text reporter shows branches but `lcov` mode emits zero rather
than omitting them. Per the brief, line coverage (LF:LH) is the
authoritative Bun coverage metric. Both new files reach LF:LH = 100%.

## Deviations from the brief

1. **Pivot internal state visibility** — The brief's class signature
   listed `curr*` and `prev*` as `private`. I kept the H/L/C fields
   private (consistent with the strict-state convention of
   `FundingFlipKillSwitchStrategy`), but exposed
   `committedPrevHtfAtLeastOnce` as `public` so the boundary-detection
   contract can be verified from a test. Documented inline in the
   strategy JSDoc.
2. **BB Squeeze counter visibility** — The brief didn't specify how
   to expose `squeezeCandles`. I added
   `readonly state: { squeezeCandles: number }` on the class (matching
   the Phase 9 9D pattern of `readonly state: FundingFlipKillSwitchState`).
   Tests verify the counter transitions; no production caller outside
   tests reads it.
3. **Approach A** (HTF accumulator from LTF) chosen for Pivot — the
   brief itself said this is preferred over Approach B (current LTF
   candle OHLC). The accumulator pattern means the strategy does NOT
   depend on the engine precomputing daily OHLCV; works on any LTF
   stream aligned to UTC midnight.
4. **No leverage config** in either strategy — sizing is engine-side
   per the 1:10 mandate (Phase 1-14 project doctrine; see
   `mm-crypto-bot-project.md` memory).
5. **No `costModel.borrowRatePerHour` etc. constants** embedded — the
   cost model lives in the backtest engine and the
   `run-pivot-grid-baseline.ts` / `run-bb-squeeze-baseline.ts` CLIs
   that Track D will create. Track B is strategy-only.

## Worktree

`/Users/kiscsicska/projects/mm-crypto-bot/.worktrees/wt-phase15-b` on
branch `feat/phase15-b-pivot-bb-squeeze` @ `8731185`.

Branch pushed to `origin/feat/phase15-b-pivot-bb-squeeze`. Awaiting PR
open by orchestrator (Phase 14D precedent: `gh` CLI not authenticated
in branch session; orchestrator opens via `GH_TOKEN` from keychain).
