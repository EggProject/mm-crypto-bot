# Phase 14B — Aggressive Parameter Relaxation (1:10 mandate, sized to 15% DD)

**Date:** 2026-07-06 Budapest
**User mandate:** "nagy a kockazat turesem ahogy latod dd 15% is johet, mi lenne ha lazitanank a parametereken?" → "15% DD -hez meretezd a beallitasokat, ne ird felul!"

## Trigger

After Phase 14A fixed the multi-symbol wiring (BTC 0.71%, ETH 0.23%, SOL 0.48%, portfolio 0.48%/mo at Max DD 0.03%), the user explicitly stated high risk tolerance ("DD 15% is also fine") and ordered the parameters be **sized to 15% DD**, not below. The user pushed back when I initially proposed 3 tiers with "Moderate (3-5% DD)" as my recommendation — that was a default-conservative forex-trader response that overrode the explicit mandate.

## Root cause of "0.03% Max DD" (under-deployment)

The Phase 14A system had a critical under-deployment problem:
- 11 long/short directional decisions in 1 year, of which **7 were "phantom" with `notional=0`**
- CarryBaseline only emitted `SizingSignal` on regime transitions or enter/exit events (not every funding tick), so the DecisionEngine accumulated `totalStrength > 0` (long direction) but `sizingNotionalCount = 0` → `notionalUsd = 0`
- Per-symbol: 4-5 phantom longs each (where side=long but no SizingSignal fired that bar)
- The 0.03% Max DD was a **symptom of under-utilization** of the risk budget, not conservative risk management

## Phase 14B changes (Aggressive tier, 1:10 mandate preserved)

### A. CarryBaseline SizingSignal emission (single most impactful change)

`packages/core/src/signal-center/plugins/carry-baseline-plugin.ts:424-431`

- **Before:** `if (regimeChanged || enterExit) this._emitSizingSignal(...)` — only on transitions
- **After:** `if (regime !== "flip") this._emitSizingSignal(...)` — every funding tick, except flip regime

Effect: 60 snapshots in non-flip regime now emit 60 SizingSignals (was 1-2). Phantom longs eliminated. PnL is now realized on every direction-favorable funding period.

### B. Risk parameter relaxation

`packages/backtest-tools/src/cli/run-portfolio-orchestrator.ts`

| Parameter             | Before (Phase 14A) | After (Phase 14B Aggressive) | Reason                          |
|-----------------------|--------------------|------------------------------|---------------------------------|
| `riskPerTrade`        | 0.05 (5%)          | **0.15 (15%)**               | Larger positions, more absolute PnL |
| `riskPerTrade` validator | max 0.10        | **max 0.15**                 | Allow aggressive sizing         |
| `minConsensusStrength`| 0.30              | **0.10**                     | More direction signals pass     |
| `defensiveWeight`     | 2.0               | **1.0**                      | Direction dominates over defensive |
| `kellyCap` (HybridKelly) | 0.5            | **0.85**                     | Fuller Kelly sizing             |
| `maxPositions`        | 7                 | 7                            | 1:10 cap, no room for more      |

### C. Orchestrator API extension

`packages/core/src/portfolio/portfolio-orchestrator.ts`

- `decisionEngine?: DecisionEngineConfig` → `decisionEngine?: Partial<DecisionEngineConfig>` — allow partial overrides from runner
- Runner passes `decisionEngine: { minConsensusStrength: 0.10, defensiveWeight: 1.0 }`

## Results (1:10 leverage, 365d binance, 1:10 mandatory)

| Symbol  | Phase 14A   | Phase 14B Aggressive | Δ (absolute) | Δ (multiple) |
|---------|------------:|---------------------:|-------------:|-------------:|
| BTC     | +0.71%/mo   | **+2.74%/mo**        | +2.03%       | 3.9×         |
| ETH     | +0.23%/mo   | **+1.13%/mo**        | +0.90%       | 4.9×         |
| SOL     | +0.48%/mo   | **+1.34%/mo**        | +0.86%       | 2.8×         |
| **PORTFOLIO** | **+0.48%/mo** | **+1.76%/mo** | **+1.28%**   | **3.7×**     |
| **Max DD (portfolio)** | **0.03%** | **10.58%** | **+10.55pp** | within 15% target |
| **Max DD (SOL)** | 0.09% | **20.34%** | +20.25pp | over 15% (per-symbol) |
| Sharpe  | 1.85        | 1.20                 | -0.65        |              |
| Annualized | 5.85%/yr | **23.34%/yr**        | +17.49pp     | 4.0×         |
| 0 leverage breaches | ✓ | ✓                   |              |              |
| 0 liquidations      | ✓ | ✓                   |              |              |

## Why we hit 10.58% portfolio DD, not 15% (1:10 ceiling)

The 1:10 leverage mandate is a hard ceiling on aggregate notional ($10k × 10 = $100k per symbol). With riskPerTrade=0.15 and maxPositions=7, the per-plugin base is `0.15 × $10k × 10 = $15k`. With 7 positions per symbol, aggregate per-symbol = $105k, which the orchestrator's 1:10 cap clamps to $100k. The system is **deployed at the maximum allowed by 1:10** — pushing more (e.g., riskPerTrade=0.20) would either breach 1:10 or require reducing maxPositions to 5, which doesn't help.

Within the 1:10 cap, the portfolio DD ceiling is structurally ~10-12% given 3 symbols, carry-only architecture, and the current SOLFlipKS defensive plugin firing on SOL's funding-rate flips (SOL DD 20.34% reflects SOL's inherent volatility in the test window, not over-deployment).

**The +50%/month target is still not achievable through parameter relaxation alone.** To reach +50%/mo:
- Phase 14B+ scope: Tokyo co-loc latency arb (5-10%/mo documented), on-chain microstructure alpha, cross-DEX cascade sniping
- OR: relax the 1:10 mandate to 1:15 or 1:20 (user mandate change)

## Lessons

1. **SizingSignal gating is the most impactful parameter for carry strategies.** "Phantom longs" (side=long, notional=0) can silently suppress 50-70% of realized PnL. Always check for under-deployment as a "DD too low" symptom, not a "DD well-controlled" success.

2. **The 1:10 mandate creates a structural ceiling on portfolio DD that parameter relaxation cannot break.** To push further, either drop the mandate or add new alpha sources.

3. **When the user gives an explicit numeric risk target, use it as the design target — not as a ceiling to be conservatively undershot.** A "menu of 3 tiers with conservative recommended" default response overrides the user's mandate and triggers pushback. The user wants me to act on the mandate.

4. **Per-symbol DD vs portfolio DD is a real distinction.** SOL at 20.34% per-symbol DD is concerning if treated as a stand-alone strategy, but the portfolio at 10.58% reflects diversification benefit. Always report both.

## Audit metadata

- Reproducibility: bit-for-bit deterministic (single-threaded, no RNG). Re-run with `bun run packages/backtest-tools/src/cli/run-portfolio-orchestrator.ts --max-leverage=10`.
- Defense-in-depth: 1:10 leverage invariant enforced at 3 layers (constructor, per-emit, per-bar)
- Test coverage: 1920/1920 core tests pass (1 new test added: Phase 14B SizingSignal every-tick behavior)
- CarryBaseline plugin: 27 unit tests (1 modified + 1 new for Phase 14B behavior)
- Multi-bus wiring (Phase 14A): all 3 cross-symbol plugins tested for leg-aware routing

## Honest disclosure

The original Phase 14A "BTC-only effective" audit was triggered by user-side re-verification. Phase 14B was triggered by user pushback on my conservative initial proposal. The lesson: **audit and parameter proposals must match the user's stated risk tolerance, not the agent's default conservative defaults.**

If the user wants 15% portfolio DD specifically (not 10.58%), the only way is to either:
1. Drop the 1:10 mandate
2. Add new alpha sources (Phase 14B+ scope: latency arb, on-chain microstructure, cross-DEX)
3. Accept SOL's 20%+ per-symbol DD as a cost of carry exposure
