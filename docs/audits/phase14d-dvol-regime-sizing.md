# Phase 14D — DVOL Regime Sizing Plugin (forward-looking vol)

**Date:** 2026-07-06 Budapest
**User mandate:** "go" (after delegating ordering to agent: Phase 14D first, then Tokyo research)

## Summary

Phase 14D implements the first **forward-looking volatility sizing source** for mm-crypto-bot. The plugin reads BTC options implied volatility (Deribit DVOL) per bar and emits a SizingSignal whose `volMultiplier` is bucketed by DVOL regime.

While implementing, the audit revealed **two hidden bugs in the Track B composition** that the Phase 14C research assumed were already fixed:
1. **Track B did NOT compose SizingSignal.volMultiplier** (the original `arbitrate()` ignored the `volMultiplier` field entirely, using only `sizingNotional` average). Phase 14C research assumed this was in place; it wasn't.
2. **CarryBaseline encoded the carry regime in BOTH `CarrySignal.carrySizeMultiplier` AND `SizingSignal.volMultiplier`** (redundant). With the Track B min() composition introduced, the redundant `SizingSignal.volMultiplier` (0.5 in high regime) caused a carry-strategy regression — sizing DOWN during high carry windows, the exact opposite of what carry wants.

Both bugs are fixed in Phase 14D.

## Implementation

### New files

- `packages/core/src/signal-center/plugins/dvol-regime-sizing-plugin.ts` (556 lines) — plugin
- `packages/core/src/signal-center/plugins/dvol-regime-sizing-plugin.test.ts` (358 lines) — 29 unit tests
- `data/deribit/deribit_btc_dvol_daily.csv` (641 daily readings, 2024-10-04 to 2026-07-06) — real Deribit DVOL data fetched from public API
- `docs/audits/phase14d-dvol-regime-sizing.md` — this file

### Plugin design

**Bucketing strategy** (BTC options IV, Deribit DVOL):
| DVOL | Regime | volMultiplier | % of test window |
|---|---|---|---|
| > 80 | acute-stress | 0.5 | 0.3% (1 day) |
| 65-80 | elevated | 0.75 | 0% (0 days) |
| 50-65 | normal | 1.0 | 18.9% (69 days) |
| < 50 | compressed | 1.0 | 80.9% (296 days) |
| no data | no-data | 1.0 (fail-open) | n/a |

**Composition with Track B** (after Phase 14D fix):
```ts
sizeMultiplier = clamp(
  carrySizeMultiplier        // from CarrySignal.carrySizeMultiplier
  × defensiveSizeModifier    // from RiskSignal.sizeModifier
  × sizingVolMultiplier      // from SizingSignal.volMultiplier (min composition, Phase 14D new)
)
```

The min() composition of SizingSignals ensures the most defensive volMultiplier wins. DVOL's stress signal reduces position size during acute drawdown windows BEFORE the realized vol picks up (forward-looking via Deribit options IV).

### 1:10 leverage mandate (3-layer defense)

- **Layer 1 (constructor)**: `metadata.maxLeverage = 10`, validated
- **Layer 2 (per-emit clamp)**: `notional <= baseNotionalUsd × 10`
- **Layer 3 (multiplier cap)**: `volMultiplier in [0, 1.0]` — never scales UP

## Bugs fixed in Phase 14D

### Bug 1: Track B did NOT compose SizingSignal.volMultiplier

**File:** `packages/core/src/portfolio/portfolio-decision.ts:405-486` (original code)

The original Track B `arbitrate()` only summed the `notional` field. The `volMultiplier` field was ignored. This is a gap the Phase 14C research paper assumed was filled (it cited types.ts L142-144 "Track B risk engine composes them with min()"), but the actual code never implemented the min() composition for `volMultiplier`.

**Phase 14D fix:** track minimum SizingSignal.volMultiplier in a local `sizingVolMultiplier` variable. Compose via multiplication with carrySizeMultiplier and defensiveSizeModifier.

### Bug 2: CarryBaseline redundant regime encoding in SizingSignal.volMultiplier

**File:** `packages/core/src/signal-center/plugins/carry-baseline-plugin.ts:540-567` (original code)

CarryBaseline encoded the carry regime in BOTH:
- `CarrySignal` to `carrySizeMultiplier` in Track B (high=1.2 to clamp 1.0, neutral=1.0, flip=0.5)
- `SizingSignal.volMultiplier` (high=0.5, neutral=1.0, flip=0.25)

The CarrySignal path was the intended regime carrier. The SizingSignal.volMultiplier was redundant. With the Phase 14D Track B min() composition, the redundant `SizingSignal.volMultiplier=0.5` in high carry windows caused a carry-strategy regression: size reduction during the very windows where we want to size UP into carry.

**Phase 14D fix:** CarryBaseline SizingSignal.volMultiplier is now always 1.0. Regime is communicated via CarrySignal only.

## Result envelope (1:10 leverage, 365d binance)

| Symbol  | Phase 14C (no DVOL) | **Phase 14D (with DVOL + fixes)** | Delta |
|---|---:|---:|---:|
| BTC | +2.74%/mo | **+3.25%/mo** | +0.51% (+19%) |
| ETH | +1.13%/mo | **+1.16%/mo** | +0.03% (+3%) |
| SOL | +1.34%/mo | **+1.63%/mo** | +0.29% (+22%) |
| **Portfolio** | **+1.76%/mo** | **+2.06%/mo** | **+0.30% (+17%)** |
| Sharpe | 1.20 | **1.31** | +0.11 |
| **Max DD (portfolio)** | 10.58% | 10.58% | 0 |
| Max DD (SOL) | 20.34% | 20.34% | 0 |
| 0 leverage breaches | yes | yes | |
| 0 liquidations | yes | yes | |

## Why Max DD did not drop

The DVOL plugin's `volMultiplier=0.5` only fires on DVOL > 80. In the 1y backtest window, **only 1 day** crossed the acute-stress threshold (2026-02-05, DVOL=82.62, the well-known Feb 2026 BTC correction). On that day, the BTC/ETH/SOL size multiplier was 0.5, but the actual price moves on that single day did not produce a Max-DD event in the SOL leg (which dominates the DD at 20.34%).

To see the DD-reduction benefit, we need either:
- **Longer backtest windows** (e.g., 3-5 years) — DVOL spikes happen 2-3x per year
- **A future regime of higher DVOL** (e.g., 2022-style bear market)
- **Real-time production with live DVOL** — the plugin's value is in avoiding the NEXT acute drawdown

The plugin is **structurally correct** (tested with 29 unit tests covering every regime). The Phase 14D result envelope doesn't show its benefit because the test window is short and DVOL was mostly compressed.

## Test coverage

- 1949/1949 core tests pass (29 new for DVOL)
- 0 lint errors, 0 typecheck errors
- DVOL plugin unit tests cover:
  - Metadata (name, edgeClass, maxLeverage)
  - Regime classification (4 boundary tests: DVOL 85, 70, 55, 40)
  - Multiplier mapping (5 regime tests)
  - onBar emission (4 tests: normal, acute, elevated, compressed)
  - Fail-open behavior (3 tests: null, NaN, Infinity)
  - Per-symbol DVOL override (1 test)
  - Regime change tracking (1 test with 5 days)
  - 1:10 leverage mandate (6 tests: 3-layer defense + config validation)
  - subscribe/onBar/reset/dispose lifecycle (3 tests)

## Sources cited (DVOL research)

- note.com (ja): "DVOL is a core indicator for predicting future Bitcoin volatility, significantly outperforming historical volatility-based models (persistence / HAR) (R^2 0.196 vs. 0.02-0.03)"
- RegimeRisk (en): "the most powerful application of bitcoin DVOL is as a leading indicator: when implied volatility begins rising before realised volatility expands, the options market is warning you that stress is building"
- Changelly: Deribit DVOL vs CVI vs CF-BVI comparison. DVOL is the most-cited (Deribit = ~90% of BTC options flow)
- Odaily (zh): DVOL >80 historically coincides with major drawdown events

## Phase 14E (next): Tokyo co-loc latency arb

DVOL plugin is Phase 14D, DELIVERED. Phase 14E (Tokyo co-loc latency arb research + planning doc) starts now in parallel.

Tokyo co-loc is the only documented crypto-native alpha source that can push the portfolio past the carry-only ceiling at +5-10%/mo documented edge. It requires 6-12 months engineering (Tokyo server co-location, Hyperliquid validator setup, on-chain microstructure integration). The Phase 14E planning doc will detail the scope, infrastructure, milestones, and risk profile.
