---
description: Phase 11.4 implementation scope plan — 6 sub-plans (11.4a–f) targeting top-5 MATCHES-mandate plugins from Phase 11.3. Free-only data path. Multiplicative defensive-overlay stacking. Conservative ceiling +3.5–4.5%/mo (defensive-heavy) or +6.5–7.5%/mo (if KimchiPremiumSignal ships at 11.4f).
---

# Phase 11.4 — Crypto-native plugin implementation (top-5 from Phase 11.3)

**Trigger:** Phase 11.3 plan_10b8a19e completed. 5 tracks research-only, doctrine honored. 7 MATCHES-mandate crypto-native plugins ranked. Phase 11.4 picks the top-5 and builds them in 6 sub-plans.

**This is a CODE phase, NOT a research phase.** Each plugin is implemented as a new SCv1 signal-center strategy, validated against the Phase 11.1d baseline composition, then composed into the running system.

---

## Aggregate envelope projection (from Phase 11.3 consolidated)

| Composition | Conservative ceiling | Aggressive ceiling | Symbol breakdown |
|-------------|---------------------:|-------------------:|------------------|
| Phase 11.2e baseline (current) | +1.42%/mo AVG | +1.42%/mo AVG | BTC −37%, ETH −20%, SOL +3% |
| + 11.4a–c (defensive stack) | +1.8–2.2%/mo AVG | +2.0–2.5%/mo AVG | DD reduction 30–40% left-tail |
| + 11.4d (StablecoinNetflow, BTC-only) | +2.3–3.0%/mo AVG | +2.7–3.5%/mo AVG | BTC asymmetric +22% per trigger |
| + 11.4e (TermStructure + RegimeShift) | +2.6–3.4%/mo AVG | +3.1–4.0%/mo AVG | Carry-stack extension |
| + 11.4f (KimchiPremiumSignal) | +3.5–4.5%/mo AVG | +5.0–7.5%/mo AVG | BTC/ETH/SOL where KRW pair |
| + all Phase 11.4 (full) | **+3.5–4.5%/mo AVG** | **+6.5–7.5%/mo AVG** | |

**Gap to +50%/mo target:** 6.7–14× short. Phase 12+ (HFT/Tokyo co-loc/options-vol) is the only architecture that closes the gap further — parked pending capital/regulatory decisions (≥$500k).

---

## Data-budget recommendation

**Path A (FREE-ONLY, recommended for Phase 11.4):** $0/mo added
- YenCarryTripwire: open-source USD/JPY feed + BoJ RSS + NLP keyword match
- OIFundingDivergencePlugin: self-aggregated 5-venue OI from public WS (Binance/Bybit/OKX/Hyperliquid/dYdX) — slow backfill but no recurring cost
- CascadeDefensiveOverlay: CoinGlass free tier for OI/liq heatmap + CryptoQuant free tier for ELR
- StablecoinNetflowPlugin: Dune Analytics + Etherscan CEX-labeled addresses
- TermStructurePlugin: Binance 8h funding (existing) + dYdX v4 free indexer
- KimchiPremiumSignal: Upbit WS + USDKRW FX from Reuters/Korea KOSPI free tier

**Path B (PAID, defer to Phase 11.5+):** $300–650/mo added
- CoinGlass hobbyist ($29/mo) + CryptoQuant Pro ($49–449/mo) + Glassnode Pro ($29/mo) + Nansen Standard ($150/mo)
- Trigger when: a free-path plugin's envelope is validated empirically, then upgrade to paid for tighter signal-to-noise

**Decision:** Path A for Phase 11.4. Validate envelope first, then negotiate paid in Phase 11.5+.

---

## Defensive-overlay stacking policy

Phase 11.2a + 11.1d already give us two defensive meta-plugins (RegimeDetector + SOLFlipKillSwitch). Phase 11.4 adds THREE more (YenCarryTripwire, OIFundingDivergence, CascadeDefensive). Total: 5 defensive overlays.

**Policy: multiplicative floors (recommended).**

When multiple defensive overlays fire simultaneously, the effective leverage is the PRODUCT of individual reduction factors, floored at 1:1 (no leverage). Each plugin proposes its own reduction factor for its specific trigger condition; the signal-center composites them.

| Trigger combo | Reduction factor | Effective leverage (from 1:10 base) |
|---------------|-----------------:|------------------------------------:|
| Base (no triggers) | 1.0 | 1:10 |
| RegimeDetector bear flag | 0.7 | 1:7 |
| SOLFlipKillSwitch flip | 0.5 (SOL only) | 1:5 (SOL) |
| YenCarryTripwire | 0.7 | 1:7 |
| OIFundingDivergence exit | 0.0 (exit only) | 1:1 (no position) |
| CascadeDefensive reduce | 0.5 | 1:5 |
| All 5 fire (worst case) | 0.7 × 0.7 × 0.5 × 0.0 × 0.5 = 0.0 | 1:1 (cash) |

**Why multiplicative:** additive (e.g., −20% per trigger) over-suppresses carry yield during single-trigger false positives and creates whipsaw in the 1:10 layer-3 invariant assertion. Multiplicative compounds risk, exits when OI-funding divergence fires (binary signal), and floors at 1:1 (no leverage, no liquidation risk).

**Implementation:** each defensive plugin emits a `DefensiveSignal { reduction_factor: 0.0–1.0, reason: string }` to the signal bus. The signal-center composites them: `effective_leverage = base_leverage × Π(reduction_factors)`, floored at 1:1.

---

## Per-track scope (6 sub-plans)

Each sub-plan follows the Phase 11.1d / 11.2e implementation template: producer builds plugin + tests + CLI baseline + REPORT-phase11-4X.md; verifier checks coverage, leverage-invariant, multi-symbol backtest.

### Phase 11.4a — YenCarryTripwire

**Plugin purpose:** Defensive overlay that reduces SCv1 gross by 30% for 48h when BoJ intervention risk spikes (USD/JPY 24h move >2% + BoJ press release keyword match).

**Files to create:**
- `packages/core/src/defensive/yen-carry-tripwire.ts` (~300 LOC)
- `packages/core/src/data/usdjpy-feed.ts` (~80 LOC; open-source USD/JPY stream)
- `packages/core/src/data/boj-rss-monitor.ts` (~120 LOC; regex/keyword match on BoJ releases)
- `packages/core/test/yen-carry-tripwire.test.ts` (~150 LOC)
- `packages/backtest-tools/src/cli/run-yen-carry-tripwire.ts` (~80 LOC)
- `reports/phase11-4a/REPORT-phase11-4a.md` (composition results)

**Expected envelope:** +0.5–1.0%/mo defensive overlay (reduces left-tail DD during BoJ intervention events)

**Symbol scope:** Portfolio-level (BTC/ETH/SOL)

**Build complexity:** S (~300 LOC net new, 2 days)

**Data feeds:** Open-source USD/JPY (e.g., exchangerate.host free tier) + BoJ RSS (https://www.boj.or.jp/en/mopo/mpmsche_minu/) + NLP keyword match ("vigilance", "intervention", "speculative", "rapid move")

**Dependencies:** Existing SCv1 position feed

**Test scenarios:**
- Backtest 2022-09-22 BoJ intervention (USD/JPY −5% in 24h) → SCv1 should reduce gross by 30% for 48h, recover
- Backtest 2024-04-29 + 2024-05-01 BoJ interventions → similar
- False-positive: USD/JPY 24h move >2% on no BoJ intervention → no reduction

**Coverage requirement:** ≥95% line coverage on `yen-carry-tripwire.ts` + `boj-rss-monitor.ts` (parser + classifier); 100% on `assertLeverageInvariant` Layer 1/2/3 integration

**Layer 3 invariant:** When YenCarryTripwire fires, `effective_leverage = 1:7` (reduction factor 0.7) — must be enforced by `assertLeverageInvariant` Layer 2

**Branch:** `feat/phase11-4a-yen-carry-tripwire`

---

### Phase 11.4b — OIFundingDivergencePlugin

**Plugin purpose:** Cascade-loss avoidance via 5-venue OI-weighted funding divergence. When OI-weighted funding z>+1.0 across 5 venues + top-venue OI concentration >0.5, EXIT existing carry positions.

**Files to create:**
- `packages/core/src/strategies/oifunding-divergence.ts` (~250 LOC)
- `packages/core/src/data/multi-venue-oi-aggregator.ts` (~180 LOC; 5-venue WS: Binance/Bybit/OKX/Hyperliquid/dYdX)
- `packages/core/src/data/funding-history-aggregator.ts` (~120 LOC)
- `packages/core/test/oifunding-divergence.test.ts` (~150 LOC)
- `packages/backtest-tools/src/cli/run-oifunding-divergence.ts` (~100 LOC)
- `reports/phase11-4b/REPORT-phase11-4b.md`

**Expected envelope:** +0.2–0.4%/mo from cascade-loss avoidance + 25–40% left-tail DD reduction

**Symbol scope:** BTC, ETH

**Build complexity:** M (~250 LOC net new + 180 LOC aggregator + 120 LOC history; 3–4 days)

**Data feeds:** Self-aggregated 5-venue OI + funding from public WS. Free. No paid subscriptions.

**Dependencies:** FundingCarryTimingStrategy (Phase 8) — OIFundingDivergence consumes the same funding feed and adds OI divergence dimension

**Test scenarios:**
- Backtest 2024-08-05 BTC cascade (Japan carry unwind, $1B liq in 24h) → OIFundingDivergence should have signaled EXIT 4h before cascade peak
- Backtest 2025-02-03 ETH cascade (Bybit $300M hack liquidation cascade) → similar pre-signal
- False-positive: OI concentration >0.5 in single venue but funding z<1 → no EXIT

**Coverage requirement:** ≥90% line coverage on `oifunding-divergence.ts` + multi-venue aggregator; 100% on `assertLeverageInvariant` integration (EXIT signal must produce `reduction_factor: 0.0`)

**Layer 3 invariant:** OIFundingDivergence EXIT signal → `effective_leverage = 1:1` (no position). Multiplicative stacking with YenCarryTripwire → 1:7 × 0.0 = 0.0, floored at 1:1.

**Branch:** `feat/phase11-4b-oi-funding-divergence`

---

### Phase 11.4c — CascadeDefensiveOverlay

**Plugin purpose:** Composite trigger that reduces leverage when pre-cascade conditions align: OI >90d SMA AND ELR >0.55 AND funding APR >15% sustained 3d AND liq-cluster ±5% >0.5% OI.

**Files to create:**
- `packages/core/src/defensive/cascade-defensive.ts` (~250 LOC)
- `packages/core/src/data/coin-glass-free-tier.ts` (~150 LOC; OI/liq heatmap from CoinGlass free tier)
- `packages/core/src/data/elr-calculator.ts` (~100 LOC; estimated liquidation ratio)
- `packages/core/test/cascade-defensive.test.ts` (~150 LOC)
- `packages/backtest-tools/src/cli/run-cascade-defensive.ts` (~100 LOC)
- `reports/phase11-4c/REPORT-phase11-4c.md`

**Expected envelope:** +0.15%/mo indirect via avoided 2–3 worst events/yr + 20–40% left-tail DD reduction

**Symbol scope:** BTC, ETH primary; SOL secondary

**Build complexity:** M (~250 LOC + 250 LOC data; 3–4 days)

**Data feeds:** CoinGlass free tier for OI + funding + liq heatmap; CryptoQuant free tier for ELR

**Dependencies:** RegimeDetector (11.2a), SOLFlipKillSwitch (11.1d) — all three defensive meta-plugins composite together via multiplicative stacking

**Test scenarios:**
- Backtest 2024-08-05 BTC cascade → CascadeDefensive should have triggered T+12h before peak (OI >90d SMA, ELR>0.55, funding APR>15% sustained 3d)
- Backtest 2025-10-11 cascade (delayed from actual 2025-10-10) → similar
- False-positive: All 4 conditions met briefly for <3d → no trigger (sustainment criterion fails)

**Coverage requirement:** ≥90% line coverage on `cascade-defensive.ts` + data feeds; 100% on `assertLeverageInvariant` integration

**Layer 3 invariant:** CascadeDefensive trigger → `reduction_factor: 0.5` (1:5 leverage). Multiplicative stacking example: YenCarryTripwire + CascadeDefensive → 1:7 × 1:5 = 1:3.5.

**Branch:** `feat/phase11-4c-cascade-defensive`

---

### Phase 11.4d — StablecoinNetflowPlugin

**Plugin purpose:** On-chain alpha. USDC ERC-20 net-in ≥$100M/day × 3 consecutive days + BTC exchange netflow <0 → 1:10 long spot BTC.

**Files to create:**
- `packages/core/src/strategies/stablecoin-netflow.ts` (~150 LOC)
- `packages/core/src/data/usdc-erc20-feed.ts` (~200 LOC; Dune Analytics + Etherscan CEX-labeled addresses)
- `packages/core/src/data/btc-exchange-netflow.ts` (~150 LOC; Glassnode free tier or Bitcoin Core UTXO + mempool.space)
- `packages/core/test/stablecoin-netflow.test.ts` (~120 LOC)
- `packages/backtest-tools/src/cli/run-stablecoin-netflow.ts` (~100 LOC)
- `reports/phase11-4d/REPORT-phase11-4d.md`

**Expected envelope:** +0.5–1.0%/mo (BTC +22% avg per triggered move, ~6 triggers/yr)

**Symbol scope:** BTC only

**Build complexity:** M (~150 LOC strategy + 350 LOC data; 3 days)

**Data feeds:** Dune Analytics free tier + Etherscan CEX-labeled addresses (free path); CryptoQuant Pro ($49+/mo) for faster backfill if validated

**Dependencies:** None (standalone alpha)

**Test scenarios:**
- Backtest 14 historical triggers (CryptoQuant USDC backtest, zh Binance Square citation) → average per-trade +22% over 30–90d holding
- False-positive: USDC net-in × 3 days but BTC exchange netflow >0 (already absorbed) → no trigger
- Threshold recalibration: $100M threshold may need adjustment 6–12mo (decal from market regime change)

**Coverage requirement:** ≥85% line coverage on `stablecoin-netflow.ts` + data feeds; 100% on `assertLeverageInvariant` integration

**Layer 3 invariant:** StablecoinNetflow entry → `effective_leverage = 1:10` (max gross). Must respect 1:10 mandate at all times.

**Branch:** `feat/phase11-4d-stablecoin-netflow`

---

### Phase 11.4e — TermStructurePlugin + RegimeShiftDetectorPlugin (D-bundle)

**Plugin purpose:** Two Track D funding-microstructure plugins that extend Phase 8 FundingCarryTimingStrategy:
- **TermStructurePlugin:** Binance 8h funding × 390 annualized − dYdX v4 hourly funding × 8760 = term_spread z-score; gate carry entry when backwardation (z>+1)
- **RegimeShiftDetectorPlugin:** consecutive_negative_funding_days ≥30 → enter carry at streak break + funding >5bps; 1–2× per 24mo cycle

**Files to create:**
- `packages/core/src/strategies/term-structure.ts` (~150 LOC)
- `packages/core/src/strategies/regime-shift-detector.ts` (~200 LOC)
- `packages/core/src/data/dydx-v4-indexer.ts` (~100 LOC)
- `packages/core/test/term-structure.test.ts` (~100 LOC)
- `packages/core/test/regime-shift-detector.test.ts` (~120 LOC)
- `packages/backtest-tools/src/cli/run-term-structure.ts` (~80 LOC)
- `packages/backtest-tools/src/cli/run-regime-shift-detector.ts` (~80 LOC)
- `reports/phase11-4e/REPORT-phase11-4e.md` (composition results for both)

**Expected envelope:** +0.3–0.5%/mo regime timing (TermStructure); +0.3–0.5%/mo annualized with episodic +2–4%/mo bursts (RegimeShift). Combined +0.6–1.0%/mo.

**Symbol scope:** BTC, ETH

**Build complexity:** S (combined ~350 LOC strategy + 100 LOC indexer + 220 LOC tests + 160 LOC CLIs; 3–4 days for both)

**Data feeds:** Existing Binance 30mo funding history + dYdX v4 free indexer

**Dependencies:** FundingCarryTimingStrategy (Phase 8) — both plugins extend its funding-feed pipeline

**Test scenarios:**
- Backtest TermStructure: identify backwardation regimes 2022-2024 + verify carry entries outperform random entry timing
- Backtest RegimeShift: identify 2022-11 → 2023-01 (consecutive negative funding days → entry at streak break → +40% carry captured)
- False-positive: TermStructure z>+1 transient (<2 days) → no entry
- False-positive: RegimeShift 30d negative funding but streak break funding <5bps → no entry

**Coverage requirement:** ≥90% line coverage on both plugins; 100% on `assertLeverageInvariant` integration

**Layer 3 invariant:** Both plugins gate existing carry entry, don't add new leverage on top. The existing Phase 8 FundingCarryTimingStrategy's 1:10 invariant is preserved.

**Branch:** `feat/phase11-4e-funding-microstructure-bundle`

**Note:** RegimeShiftDetectorPlugin has an explicit dependency on OIFundingDivergencePlugin (Phase 11.4b) as confirmation filter — if OI divergence is firing, RegimeShift entry is suppressed. This means 11.4e must follow 11.4b in the build order.

---

### Phase 11.4f — KimchiPremiumSignal

**Plugin purpose:** Asian-session alpha. Upbit BTC/KRW premium regime-shift vs Binance/USD — long when Korean Discount <−1% with 4h persistence, exit on mean-revert to +0.5% or 96h.

**Files to create:**
- `packages/core/src/strategies/kimchi-premium.ts` (~400 LOC)
- `packages/core/src/data/upbit-ws.ts` (~150 LOC; ticker.UPBIT_BTC_KRW + ETH + SOL)
- `packages/core/src/data/usdkrw-fx.ts` (~100 LOC; Reuters/Korea KOSPI free tier)
- `packages/core/test/kimchi-premium.test.ts` (~150 LOC)
- `packages/backtest-tools/src/cli/run-kimchi-premium.ts` (~100 LOC)
- `reports/phase11-4f/REPORT-phase11-4f.md`

**Expected envelope:** +2–3%/mo overlay on carry/basis (highest single envelope in inventory)

**Symbol scope:** BTC, ETH, SOL (only on their KRW pairs)

**Build complexity:** M (~400 LOC strategy + 250 LOC data + 250 LOC tests; 4 days)

**Data feeds:** Upbit WebSocket (free) + USDKRW FX from Reuters/Korea KOSPI free tier

**Dependencies:** RegimeDetector (11.2a) for stop-loss layer; existing bybit.eu spot overlay for execution

**Test scenarios:**
- Backtest 2022-12 "Kimchi Premium collapse" (Korean Discount −3% → +2% over 48h) → entry signal at T+4h, exit at mean-revert, +18% per trade
- Backtest 2024-04 multiple Kimchi premium regime shifts → verify signal persistence criterion (4h) catches real opportunities
- False-positive: Transient Korean Discount <−1% for <4h → no entry
- Decay check: Track Kimchi premium half-life quarterly (expect 24-mo structural)

**Coverage requirement:** ≥85% line coverage on `kimchi-premium.ts` + data feeds; 100% on `assertLeverageInvariant` integration

**Layer 3 invariant:** KimchiPremiumSignal entry → bybit.eu SPOT overlay only (no margin), 1:1 effective leverage on the overlay (existing SCv1 carry leg maintains 1:10). This is structural — the signal informs the carry-overlay ratio, not the leverage ratio.

**Branch:** `feat/phase11-4f-kimchi-premium`

---

## Plan structure (Phase 11.4 launch)

**Single plan with 6 sub-tasks, sequential build order, each task ~45min timeout (extended at launch per Phase 8 lesson):**

```yaml
plan_id: phase11-4-crypto-native-plugins
description: Phase 11.4 implementation — 6 sub-plans building top-5 MATCHES-mandate crypto-native plugins from Phase 11.3

tasks:
  - id: phase11-4a-yen-carry-tripwire
    agent: general
    depends_on: []
    timeout_ms: 2700000  # 45min, extended at launch
    worktree: wt-phase11-4a
    branch: feat/phase11-4a-yen-carry-tripwire
    verify_prompt: |
      CHECK 1: yen-carry-tripwire.ts present + ≥95% line coverage (READ coverage/lcov.info directly, do NOT trust producer claim)
      CHECK 2: 3 baseline backtests (2022-09-22, 2024-04-29, 2024-05-01 BoJ interventions) produce expected leverage reduction
      CHECK 3: assertLeverageInvariant Layer 1/2/3 integration (READ test file, verify actual calls not docstring-only)
      CHECK 4: branch pushed to origin (git log --oneline origin/feat/phase11-4a-yen-carry-tripwire -1 shows commit + 1:10 effective_leverage assertion)
      CHECK 5: REPORT-phase11-4a.md includes SCv1 composition results + per-symbol envelope + DD comparison

  - id: phase11-4b-oi-funding-divergence
    agent: general
    depends_on: [phase11-4a-yen-carry-tripwire]
    timeout_ms: 2700000
    worktree: wt-phase11-4b
    branch: feat/phase11-4b-oi-funding-divergence
    verify_prompt: |
      CHECK 1: oifunding-divergence.ts present + multi-venue aggregator + ≥90% line coverage
      CHECK 2: 5-venue WS aggregator connects to Binance/Bybit/OKX/Hyperliquid/dYdX public endpoints
      CHECK 3: Backtest 2024-08-05 BTC cascade + 2025-02-03 ETH cascade produce EXIT signal 4h before peak
      CHECK 4: EXIT signal → reduction_factor: 0.0 → effective_leverage = 1:1 (no position) in assertLeverageInvariant
      CHECK 5: branch pushed

  - id: phase11-4c-cascade-defensive
    agent: general
    depends_on: [phase11-4a-yen-carry-tripwire]  # parallel with 11.4b
    timeout_ms: 2700000
    worktree: wt-phase11-4c
    branch: feat/phase11-4c-cascade-defensive
    verify_prompt: |
      CHECK 1: cascade-defensive.ts + CoinGlass free-tier integration + ≥90% line coverage
      CHECK 2: Composite trigger (OI >90d SMA AND ELR>0.55 AND funding APR>15% sustained 3d AND liq-cluster ±5%>0.5% OI) verified
      CHECK 3: Backtest 2024-08-05 + 2025-10-11 cascades produce trigger T+12h before peak
      CHECK 4: reduction_factor: 0.5 multiplicative stacking with YenCarryTripwire → 1:3.5 (not 1:5 additive)
      CHECK 5: branch pushed

  - id: phase11-4d-stablecoin-netflow
    agent: general
    depends_on: [phase11-4b-oi-funding-divergence, phase11-4c-cascade-defensive]
    timeout_ms: 2700000
    worktree: wt-phase11-4d
    branch: feat/phase11-4d-stablecoin-netflow
    verify_prompt: |
      CHECK 1: stablecoin-netflow.ts + Dune+Etherscan CEX-label integration + ≥85% line coverage
      CHECK 2: Backtest 14 historical CryptoQuant USDC triggers reproduce +22% avg per-trade
      CHECK 3: False-positive filter: USDC net-in × 3 days but BTC exchange netflow >0 → no trigger
      CHECK 4: entry → 1:10 effective_leverage preserved (BTC-only entry)
      CHECK 5: branch pushed

  - id: phase11-4e-funding-microstructure-bundle
    agent: general
    depends_on: [phase11-4b-oi-funding-divergence]  # RegimeShift depends on OIFundingDivergence as confirmation filter
    timeout_ms: 2700000
    worktree: wt-phase11-4e
    branch: feat/phase11-4e-funding-microstructure-bundle
    verify_prompt: |
      CHECK 1: term-structure.ts + regime-shift-detector.ts + dydx-v4-indexer.ts present + ≥90% line coverage
      CHECK 2: Both plugins extend Phase 8 FundingCarryTimingStrategy pipeline (verify by reading FundingCarryTimingStrategy code)
      CHECK 3: TermStructure z>+1 transient (<2d) → no entry
      CHECK 4: RegimeShift suppressed when OIFundingDivergence EXIT signal active (cross-plugin precedence verified)
      CHECK 5: branch pushed

  - id: phase11-4f-kimchi-premium
    agent: general
    depends_on: [phase11-4c-cascade-defensive]  # uses RegimeDetector stop-loss
    timeout_ms: 2700000
    worktree: wt-phase11-4f
    branch: feat/phase11-4f-kimchi-premium
    verify_prompt: |
      CHECK 1: kimchi-premium.ts + upbit-ws.ts + usdkrw-fx.ts present + ≥85% line coverage
      CHECK 2: Backtest 2022-12 Kimchi Premium collapse (+18% per trade) + 2024-04 multiple regime shifts
      CHECK 3: 4h persistence criterion verified (transient <4h → no entry)
      CHECK 4: bybit.eu SPOT-only overlay (no margin), 1:1 leverage on overlay leg (carry leg maintains 1:10)
      CHECK 5: branch pushed
```

**Cron schedule:** `phase11-4-monitor` at 5min cadence, 8h TTL after plan launch.

**Retry budget:** 2 cycles (Phase 11.3 lesson — verifier-mandate-conflict + owner-self-push patterns reduce need for cycle 3+).

**Doctrine compliance:** all 6 plugins are crypto-native (Track A/B/D/E-derived). Multi-language is N/A (implementation, not research). ≥10 queries/angle is N/A. ≥5 parallel agents — using 6 sub-plans in sequence/parallel as dependencies allow.

---

## Per-sub-plan deliverable checklist

Each sub-plan delivers:
1. New plugin file(s) under `packages/core/src/{strategies,defensive}/`
2. New data feed file(s) under `packages/core/src/data/`
3. Test file(s) under `packages/core/test/` with line coverage ≥ target
4. CLI baseline under `packages/backtest-tools/src/cli/`
5. 3-baseline backtest run (BTC + ETH + SOL by default; BTC-only for 11.4d)
6. REPORT-phase11-4X.md with composition results + per-symbol envelope + DD comparison vs Phase 11.2e baseline
7. Branch pushed to origin with descriptive commit message

---

## Open decisions needed BEFORE launch

1. **Confirm data-budget = free-only path** (recommendation: yes, $0/mo added for 11.4)
2. **Confirm defensive-overlay stacking policy = multiplicative floors** (recommendation: yes)
3. **Confirm build order: 11.4a → (11.4b ‖ 11.4c) → 11.4d → 11.4e → 11.4f** (recommendation: yes)
4. **Confirm 11.4a alone as initial launch** (recommendation: yes — fastest validation, defensive only, smallest scope, easiest verifier-PASS)
5. **Confirm timeout = 45min per sub-plan** (recommendation: yes — extended at launch per Phase 8 lesson, not when near deadline)
6. **Phase 12+ capital decision:** STILL BLOCKED. This plan does NOT unblock it.

---

## Next-step contract

- **Plan YAML:** written to `/tmp/phase11-4-implementation.yaml`
- **User decision:** approve sub-plan scope + data-budget + stacking policy + build order + timeout
- **Phase 11.4 launch:** owner spawns plan once approved. Initial sub-plan 11.4a (YenCarryTripwire) launches first as a defensive-only validation gate.
- **Cron:** `phase11-4-monitor` 5min cadence, 8h TTL.
- **Memory updates:** no new lessons expected from Phase 11.4 unless novel patterns emerge (e.g., cross-plugin precedence conflict, multiplicative-stacking policy interaction).
- **Phase 11.4 close-out:** REPORT-phase11-4.md consolidation similar to Phase 11.2e M2 report + ceiling projection vs +50%/mo target.

**Phase 11.4 is the final retail-viable crypto-native drop-in phase before Phase 12+ capital/regulatory decisions are required.**