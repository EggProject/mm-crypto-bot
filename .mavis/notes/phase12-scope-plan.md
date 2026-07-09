---
description: Phase 12 scope (revised after research fleet) — implement 3 read-only signal plugins surfaced by Phase 11.5 research fleet (CEXNetFlowRegime / CrossDexFundingWatcher / PerpDexLiquidationSignalsPlugin) + walk-forward integration backtest. Top 3 plugins ranked by 1:10-bybit.eu compatibility + read-only architecture + empirical evidence strength.
---

# Phase 12 — Research-fleet plugin implementation + walk-forward integration (REVISED 2026-07-05)

**Trigger:** Phase 11.5 research fleet (PR #24, merged 2026-07-05 20:42 Budapest) surfaced 12+ plugin candidates across 5 tracks. Top 3 ranked below by 1:10-bybit.eu compatibility, read-only architecture, and empirical evidence strength. Phase 12 = implement those 3 + walk-forward integration backtest.

**Companion files:**
- `phase12-beyond-retail-scope-plan.md` — Phase 13+ HFT/MM/options scope (parked; capital/regulatory blocked)
- 5 merged research reports at `docs/research/phase11-5-research-fleet/{asian-listing-pump,hyperliquid-dydx-vaults,mev-liquidation-hunt,onchain-bridge-flow,cross-dex-funding-basis}/REPORT.md`

**Prior scope (Phase 11.4 best-subset re-platform) is SUPERSEDED.** The Phase 11.4 plugins (11.4f Kimchi + 11.4c Cascade + 11.4b OI-Div) remain in scope as secondary candidates but lower-priority than the research-fleet findings: research-fleet plugins are 1) sourced from post-Phase-11.4 evidence, 2) pre-aligned with multi-language research doctrine, 3) cited with ≥2 independent sources per claim.

---

## Top 3 plugin candidates (autonomous ranking)

### 1. **P1 — `cex-netflow-regime`** (from Track D report, ranked #1)
- **Edge source:** Track D §H1 + §3.2. CEX BTC/ETH/SOL netflow (24h-7d z-score). Pearson r = 0.47 with BTC daily vol (arXiv 2501.05232 + Glassnode 2-year study + Binance Square + CryptoQuant triple-confirmed).
- **Plugin type:** Factor-layer signal (continuous [-1, +1]).
- **Data feed:** Glassnode / CryptoQuant / CoinGlass public APIs (free tier).
- **Risk character:** Lagging 60-90 days if regime-only; coincident 24h-7d if z-scored. Pure read-only. Zero execution risk.
- **Build cost:** ~200 LOC. Existing `StrategyPlugin` interface compatible. 3-layer 1:10 defense trivially met (signal-only = no notional impact).
- **Why top:** (a) Strongest empirical edge in fleet (Pearson 0.47 + multi-source), (b) cheap to build, (c) zero risk, (d) orthogonal to existing carry/directional plugins (low correlation ≤0.3 expected).

### 2. **E1 — `cross-dex-funding-watcher`** (from Track E report, ranked #2)
- **Edge source:** Track E §H1 (cross-DEX funding carry). HL runs 2-3× higher funding than CEX (BitMEX Q3 2025 report + Button + CoinGlass triple-confirmed; 23.23% BTC annualized HL vs 4.52% Binance on Dec 5 2024 per Sina Finance).
- **Plugin type:** Read-only signal stream. Computes 8h-equivalent basis spread per asset, emits per-venue funding snapshots + spread metrics to bus.
- **Data feeds:** Hyperliquid `metaAndAssetCtxs` + `predictedFundings` (free), Binance/Bybit/OKX funding REST+WS (free), CoinGlass arbitrage-list (~$29-79/mo optional).
- **Build cost:** ~150 LOC. No execution dependencies.
- **Why top:** (a) foundation for future arb (Plugin E2 — execution — DEPENDS on E1 being deployed), (b) passive edge even without execution (regime detection + signal stream), (c) the 2026 tradeable evidence across BTC/ETH/SOL/HYPE is rock-solid (ArbitrageScanner Jun 2026 documents 18-32% APR post-fee), (d) drop-in compatible.

### 3. **M1 — `perpdex-liquidation-signals`** (from Track C report, ranked #3)
- **Edge source:** Track C §E1 (tick-level liquidation cascade detection) + §E5 (OI liquidation spirals).
- **Plugin type:** Read-only defensive SizingSignal. Emits `reduce_exposure` flags when cascade imminent; consumed by SCv1.
- **Data feeds:** 0xArchive liquidation REST + WS (free + $99/mo real-time tier), HypurrScan (free), GoldRush Pentagon cascade map, CoinGlass Hyperliquid liquidation map, HyperTracker.
- **Build cost:** ~300 LOC. Layer 1: `maxLeverage ≤ 10` metadata. Layer 2: subscribe-bus validation. Layer 3: per-bar guard.
- **Why top:** (a) **HIGH match** with project mandate (read-only, defensive, 1:10 compatible), (b) 0xArchive + GoldRush feeds already publicly accessible, (c) defensive overlay complements existing Phase 11.2a RegimeDetector (orthogonal defensive layer), (d) reduces left-tail DD by 20-40% per empirical case studies.

---

## Plugins NOT in Phase 12 (lower priority / deferred)

| Plugin | Source | Reason deferred |
|--------|--------|-----------------|
| E2 CrossDexDeltaNeutralArb | Track E §H1 | Execution legs, requires offshore perp sub-account; not 1:10-bybit.eu primary scope |
| E3 VenueSpecificFundingInversion | Track E §H4 | Defensive; merge into M1 cascade logic as one overlay rather than separate plugin |
| E4 BorosTermStructureOverlay | Track E §H2 | Boros smart-contract risk + Pendle yield complex; experimental |
| E5 HIP3DeployerMarketFundingArb | Track E §H5 | Deployer-slashing risk; high; tie to E1 if E1 upgrades prove out |
| E6 KoreanListingSpikeFunding | Track E §H6 | Event-frequency too low (5-10/yr); requires Korean exchange API access |
| Track B HLP/dYdX vault timing | Track B | perp-DEX only, bybit.eu SPOT-only constraint; deferred to Phase 13+ beyond-retail |
| Track B VaultFlowSignal | Track B | Same as above |
| Track A Asian listing-pump | Track A | Korean exchange API access required; edge decomposing in late 2025 (per report §TLDR) |
| Track A airdrop Sybil farming | Track A | Detection-arms-race alpha; not 1:10 compatible |
| Track C E2 (pre-liqq sniffing) | Track C | Sub-component of M1; merge |
| Track C E3 (cross-pair searcher arb) | Track C | Retail-latency vulnerable; offshore-only |
| Track C E4 (funding snap-back) | Track C | Extension of E2 future arb |
| Track C E6 (wallet cluster signal) | Track C | Requires Nansen API integration (paid); merge as optional sub-feature of M1 if available |
| Track D P2 IBIT ETF flow | Track D | Macro signal, low-frequency, conflicting with SCv1's per-bar timing |
| Track D P3 WhaleCluster | Track D | Defensive; merge into M1 as optional sub-feature |
| Track D P4 USDT supply 60d delta | Track D | Lagging not leading; regulatory correlation weakening per Mads Eberhardt caveat |
| Track D P5 Bridge inflow anomaly | Track D | Niche; not directional for BTC/ETH; skip unless we expand universe |
| Track D P6 Smart-money copy | Track D | 44% copier win-rate; skip |
| Phase 11.4f Kimchi | Phase 11.4 | Re-platform path superseded by research-fleet; reintroduce in Phase 13+ if budget permits |
| Phase 11.4c Cascade | Phase 11.4 | M1 supersedes (cascadedefensive is folded into M1's E1+E5 logic) |
| Phase 11.4b OI-Funding Divergence | Phase 11.4 | Data-feed complexity (5 venues); simpler E1 covers 70% of the same surface |

---

## Plan structure (1 plan, 4 tracks)

### Track A — `phase12-plugin-p1-cex-netflow`
- **Producer:** general agent (research-worker style)
- **Output:** `packages/core/src/signal-center/plugins/cex-netflow-regime-plugin.ts` (~200 LOC) + `cex-netflow-regime-plugin.test.ts` (~30 tests, ≥90% coverage)
- **Sub-tasks:**
  1. Implement `metadata.maxLeverage ≤ 10` + bus validation + per-bar guard (3-layer 1:10 defense)
  2. Wire Coinglass/CryptoQuant free tier feed (no paid API required for first cut)
  3. Compute z-score over rolling 90d window per symbol
  4. Emit factor signal (-1 to +1) to existing bus
  5. Unit tests: parse rejection, calibration edge, dedup invariance, regime classification
- **Verifier checks:** same 8-check pattern as Phase 11.x (typecheck, lint, test, coverage ≥90%, ≥1 adversarial probe, 1:10 defense verified, real-data feed wired, citation rigor)
- **Branch:** `feat/phase12-p1-cex-netflow`

### Track B — `phase12-plugin-e1-cross-dex-funding`
- **Output:** `packages/core/src/signal-center/plugins/cross-dex-funding-watcher-plugin.ts` (~150 LOC) + tests
- **Sub-tasks:**
  1. Subscribe to Hyperliquid WS (`metaAndAssetCtxs`, `predictedFundings`)
  2. Subscribe to Binance/Bybit/OKX WS funding (free public)
  3. Normalize all rates to 8h-equivalent bps
  4. Per asset, compute max-spread across venues
  5. Emit `cross-dex-funding-snapshot` signal stream
- **Branch:** `feat/phase12-e1-cross-dex-funding`

### Track C — `phase12-plugin-m1-perpdex-liquidation`
- **Output:** `packages/core/src/signal-center/plugins/perpdex-liquidation-signals-plugin.ts` (~300 LOC) + tests
- **Sub-tasks:**
  1. Subscribe to 0xArchive liquidation WS feed (`/api/liquidations` or websocket equivalent)
  2. HypurrScan polling fallback for free tier
  3. Cascade imminent detector: OI drop >20% in 24h + whale long-short ratio ∈ [0.4, 0.6] + thin book top-5 ask
  4. Paper-tiger detection: large wall inserted <5min + wallet cluster with N≥5 correlated
  5. Emit defensive SizingSignal (reduce exposure by 0.5× for 24h when flag fires)
- **Branch:** `feat/phase12-m1-perpdex-liquidation`

### Track D — Walk-forward integration + REPORT
- **Producer:** general agent
- **Output:** `packages/backtest-tools/src/cli/run-signal-center-v1-phase12.ts` + 4 composition baselines × 3 symbols = 12 backtest JSONs + `REPORT-phase12.md` (8 sections, ~400 lines, ≥3 sources per claim)
- **Sub-tasks:**
  1. Composition A: baseline (current SCv1 + Phase 11.1+11.2a = 6 plugins) = control
  2. Composition B: baseline + P1
  3. Composition C: baseline + E1
  4. Composition D: baseline + M1
  5. Composition E: baseline + P1 + E1 (orthogonality check)
  6. Composition F: baseline + P1 + E1 + M1 (full)
  7. 3 symbols × 6 compositions = 18 backtests
  8. Per-symbol DROP/RETAIN decision schema: `|Δ Sharpe| < 0.5` OR `max|ρ| > 0.5` OR `DD +20%` → DROP
  9. REPORT §1 TL;DR envelope, §6 +50%/month verdict, §7 Phase 13+ scope

---

## 1:10 defense-in-depth (HARD GUARDRAIL across all 4 tracks)

- Layer 1: `metadata.maxLeverage ≤ 10` enum
- Layer 2: `subscribe(bus)` validates initial state (no bootstrap with breach); for read-only signal plugins, this layer is trivially met (signal doesn't affect notional)
- Layer 3: `onBar(bar, state)` runs `portfolioRiskEngine.leverageInvariantGuard(state)` after every dispatch
- Per Phase 11.1c lesson: if bus-modifier produces spurious breaches, fall back to per-bar inspection API

---

## DROP/RETAIN decision schema (applied per-symbol per-plugin)

```
For each plugin (per-symbol, but threshold applied across symbols):
  IF |Δ monthly return| < 0.05%/mo         → DROP (insufficient alpha)
  IF |Δ Sharpe| < 0.5                      → DROP (stability question)
  IF max|ρ with existing| > 0.5            → DROP (redundant)
  IF DD increased > 20%                    → DROP (not worth the risk)
  ELSE                                    → RETAIN
```

---

## Cost + schedule estimate

| Cost component | Estimate |
|----------------|---------:|
| Track A producer (P1 plugin) | ~$0.20 |
| Track A verifier | ~$0.15 |
| Track B producer (E1 plugin) | ~$0.20 |
| Track B verifier | ~$0.15 |
| Track C producer (M1 plugin) | ~$0.25 |
| Track C verifier | ~$0.15 |
| Track D producer (integration backtest + REPORT) | ~$0.25 |
| Track D verifier | ~$0.10 |
| **Total** | **~$1.45 USD** |

**Schedule:** 3-5 cycles (Track D depends on A+B+C completion), 5-12 days at Phase 11.x pace.

---

## Lessons carried in from prior phases

- **Phase 11.2e dilution-hit:** integrate one-at-a-time via DROP/RETAIN schema, marginal Sharpe criterion, max |ρ| < 0.5. Encode explicitly in Track D verifier brief.
- **Per-bar calculator pattern (Phase 11.1c):** if bus-modifier produces spurious 1:10 breaches, fall back to per-bar inspection API. Apply to all 3 plugins.
- **Layer 2/3 docstring-lie pattern (Phase 10G):** verifier must read test file + code lines, not summary. Apply to all 3 implementations.
- **Coverage ≥90% per plugin file (project convention)** + verifier reads lcov.info directly.
- **≥1 adversarial probe per plugin** (parse rejection, calibration edge, dedup invariance, exact reproducibility match).
- **Per-symbol disclosure mandatory** (Phase 8 Track F pattern).

---

## Path forward (designer-designed walk-through)

**Step 1 (immediate, after this scope-plan approved):** Launch `mavis team plan run /tmp/phase12-implement-plan.yaml --no-wait` with 4 tracks.

**Step 2 (during plan execution):** Monitor via cron. Owner-side review on each verifier FAIL with 5-8 step correction spec. Owner-self-push for mechanical-step-only FAILS (memory rule).

**Step 3 (after plan complete):** Final squash-merge PR per Track D's RETAIN plugin set only (NOT all 3, only what's empirically justified). Open PR, branch preserved per cleanup doctrine.

**Step 4 (Phase 13+ parking):** Track A asian-listing-pump + Track B HLP/dYdX vault implementations if Phase 12 RETAIN dataset suggests viable (e.g., if E1 RETAINs strongly, E2 E5 become natural extensions). Re-evaluate at Phase 12 close.

**Step 5 (+50%/month target final status):** If Phase 12 RETAIN total lift is +0.5-1.0%/mo on top of Phase 11.1 set (+1.77%/mo), realistic ceiling = +2.5-3.0%/mo. Still 17× short of +50%/mo. Path forward is `phase12-beyond-retail-scope-plan.md` (capital + co-loc + options MM).

---

## Status (2026-07-05 20:50 Budapest)
- ✅ Phase 11.5 research fleet merged (PR #24)
- ✅ TOP 3 plugins ranked + scoped
- ⏳ Plan YAML pending owner launch OK
- ⏳ Owner monitors via cron until plan auto-closes
