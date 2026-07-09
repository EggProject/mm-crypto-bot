---
description: Phase 25 #1 — Perp-DEX funding microstructure research fleet. Drafted 2026-07-08 00:50 Budapest after Phase 24 #1 + #2 closure. Goal: identify persistent cross-venue funding microstructure alpha that can be captured as a signal source for bybit.eu SPOT-only execution, lifting portfolio above the cap=0.18 ceiling (+39.37%/mo @ <8% DD).
status: launching
owner: Mavis
agent: mavis
target-session-id: mvs_c13fe65cb68f4df3851304dea09a9099
---

# Phase 25 #1 — Perp-DEX Funding Microstructure Research Fleet

## 0. Why this exists

**Phase 24 #1 closure (commit `adaf886`, PR #55):**
- Cap=0.18 portfolio: **+39.37%/mo @ <8% DD** (NEW PORTFOLIO PEAK)
- Cap=0.20 portfolio: +18.82%/mo @ <5% DD (knee)
- 1-of-2 mode recommendation: cap=0.18

**Phase 24 #2 closure (commit `bfb9715`, PR #56):**
- 2-of-2 cap=0.20 BTC byte-identical regression anchor vs Phase 19 #2 (2660 trades, hash -3516627081305100957, Sharpe 20.518, Sortino 21.792, PF 10.440, WR 0.7316)
- 2-of-2 mode: portfolio +18.82%/mo @ <5% DD
- Verdict: NEGATIVE — diminishing-returns curve holds at the knee above cap=0.18 in BOTH 1-of-2 and 2-of-2 modes

**Cap-tuning ceiling confirmed.** The +7pp/mo improvement (Phase 19 #1 cap=0.12 +32.24% → Phase 24 #1 cap=0.18 +39.37%) is the LAST gain available from cap-tuning. Pushing cap past 0.18 closes the knee. The next jump requires **a new alpha source** — not more parameter optimization on the existing Donchian+Pivot regime-INVARIANT baseline.

**Why perp-DEX funding microstructure:**
1. Funding-rate carry is already in the system (Phase 10G/11.2e BasisTrade BTC -37%, ETH -20% — closed) but only at bybit.eu level. Cross-venue funding divergence is structurally different and post-2020 crypto-native.
2. Perp-DEX venues (Hyperliquid, dYdX v4) emerged 2023-2024 — funding microstructure is empirically novel, alpha may not be fully extracted.
3. Compatible with 1:10 + bybit.eu SPOT-only + self-hosted constraints: signal source can be ANY venue (Hyperliquid, dYdX, OKX, Binance), execution stays bybit.eu SPOT margin at 1:10.
4. Aligns with research doctrine: crypto-native + multi-language (zh/ja/ko/ru) + ≥5 parallel agents.

## 1. Hard constraints (re-baselined 2026-07-08)

| Constraint | Value | Source |
|------------|-------|--------|
| Leverage ceiling | **1:10 EXACT** | bybit.eu SPOT margin + user mandate |
| Execution venue | **bybit.eu SPOT-only** (no futures) | bybit.eu policy + MiCAR scope |
| Signal source venue | **OPEN** (perp-DEX, cross-exchange) | This phase |
| Capital scale | $10k book | Phase 0 baseline |
| Jurisdiction | EU (MiCAR), Hungarian tax residency | bybit.eu registration |
| Self-hosted | YES, no server spend, no SLA ping | User structural mandate |
| Forbidden sources | "konzervatív régi forex kereskedők" | User research doctrine |
| Required sources | Crypto-native, post-2020, bybit.eu/perp-funding academic | User research doctrine |

## 2. Goal decomposition (5 distinct research angles)

The single question is "**can perp-DEX funding microstructure produce a persistent alpha signal compatible with bybit.eu SPOT execution at 1:10?**", decomposed into 5 sub-questions:

### Q1 — Hyperliquid funding microstructure (Track A)
- **Angle:** USDe/USDH-margined perp-DEX (post-2024, biggest TVL). Funding rate dynamics, oracle price divergence, USDe yield interaction, HYPE token impact on funding.
- **Languages:** en (primary)
- **Why:** Most novel venue, biggest perp-DEX by volume, USDe yield farm creates funding anomaly.

### Q2 — dYdX v4 funding microstructure (Track B)
- **Angle:** Cosmos-chain perp-DEX (post-2023), DYDX token-stake-based fee tier, isolated market structure, validator-set governance.
- **Languages:** en + ja (Japanese quant trader community has extensive dYdX content)
- **Why:** Established perp-DEX with full history, isolated markets = cleaner funding signal.

### Q3 — Cross-venue funding divergence (Track C)
- **Angle:** Hyperliquid vs dYdX vs bybit perp vs Binance vs OKX vs Bitget funding rate divergence. Real alpha if divergence > fees+slippage. Capture mechanism: lead-lag, mean-reversion, regime-specific divergence.
- **Languages:** en + zh (Binance-CN, OKX-CN communities)
- **Why:** THE actionable alpha — divergence between venues is tradeable as signal.

### Q4 — Perp-DEX liquidation cascade microstructure (Track D)
- **Angle:** Liquidation-driven price action as directional signal. When long liquidations cascade on perp-DEX, spot drops within minutes — tradeable on bybit.eu SPOT.
- **Languages:** en + ko (Korean trader communities heavily discuss liquidation cascades)
- **Why:** Crypto-native event-driven alpha, post-2020 (Hyperliquid), captures tail-risk premium.

### Q5 — Bybit perp-vs-spot basis / MiCA microstructure (Track E)
- **Angle:** bybit.eu vs bybit.com vs offshore perp basis. EU MiCAR regulatory microstructure — does bybit.eu SPOT-only constraint create unique pricing?
- **Languages:** en + ru (Russian trader community covers bybit regulatory arbitrage)
- **Why:** EU-specific angle — directly relevant to project's regulatory profile.

## 3. Research fleet (5 parallel agents, distinct angles)

Per memory doctrine override: **5+ parallel agents minimum**, **distinct angles**, **≥10-20 web_queries per angle**, **multi-language mandatory** (zh/ja/ko/ru — NEVER Hungarian for research).

### Agent 1 — Track A: Hyperliquid funding microstructure (en, ≥10 queries)
- **Angle:** USDe/USDH-margined perp-DEX (post-2024). Funding rate dynamics across BTC/ETH/SOL perps, oracle price divergence, USDe yield interaction, HYPE token staking impact on funding.
- **Languages:** en (primary)
- **Queries:** ≥10 (Hyperliquid docs, funding rate historical charts, post-2024 HYPE/USDe mechanics, oracle lag analysis, perp-DEX TVL rankings, academic perp-DEX papers)
- **Termination:** Per-symbol (BTC/ETH/SOL) funding rate distribution + volatility + mean-reversion speed + oracle divergence measurement + estimated alpha mechanism.

### Agent 2 — Track B: dYdX v4 funding microstructure (en + ja, ≥10 queries)
- **Angle:** Cosmos-chain perp-DEX (post-2023). DYDX token-stake fee tier, isolated market structure (vs cross-margin on Hyperliquid), validator governance, historical funding rate analysis.
- **Languages:** en (primary) + ja (Japanese quant community — dYdX-JP coverage)
- **Queries:** ≥10 (dYdX v4 docs, Cosmos validator mechanics, isolated market funding, Japanese 個人投資家 dYdX coverage, funding rate history)
- **Termination:** Per-symbol funding rate statistics + isolated-market behavior + comparison vs Hyperliquid + recommended integration approach.

### Agent 3 — Track C: Cross-venue funding divergence (en + zh, ≥10 queries)
- **Angle:** Hyperliquid vs dYdX vs bybit perp vs Binance vs OKX vs Bitget funding rate divergence. Lead-lag analysis, mean-reversion speed, divergence persistence, tradeable alpha estimate (divergence > fees+slippage).
- **Languages:** en (primary) + zh (Binance/OKX CN communities, 资金费率 discussion)
- **Queries:** ≥10 (Coinglass funding rate aggregator, per-venue funding history, post-2024 divergence events, OKX/Bybit/Binance research papers, Chinese crypto quant communities)
- **Termination:** Per-pair (venue × symbol) divergence statistics + lead-lag matrix + estimated alpha after fees + recommended signal source.

### Agent 4 — Track D: Perp-DEX liquidation cascade microstructure (en + ko, ≥10 queries)
- **Angle:** Liquidation cascade mechanics on Hyperliquid + dYdX. Long-liquidation cascade → spot drop, short-liquidation cascade → spot pump. Tradeable on bybit.eu SPOT within minutes.
- **Languages:** en (primary) + ko (Korean 트레이더 communities, 업비트/빗썸 liquidation discussion)
- **Queries:** ≥10 (Coinglass liquidation heatmap, Hyperliquid liquidation history, post-2024 cascade events, 2024-08 carry-trade unwind postmortem, 2025-10-11 crash analysis)
- **Termination:** Cascade detection latency estimate (signal lag from perp to spot) + expected fill rate at bybit.eu + alpha per cascade event.

### Agent 5 — Track E: Bybit perp-vs-spot basis / MiCA microstructure (en + ru, ≥10 queries)
- **Angle:** bybit.eu (MiCAR) vs bybit.com (offshore) vs bybit perp basis. EU regulatory microstructure, MiCAR implications for cross-border crypto, bybit.eu's SPOT-only product set vs offshore's full derivatives.
- **Languages:** en (primary) + ru (Russian трейдер community, bybit regulatory coverage)
- **Queries:** ≥10 (MiCAR Regulation 2023/1114 text, bybit.eu vs bybit.com product comparison, post-MiCA EU perp-DEX landscape, Russian-language bybit regulatory analysis, EU crypto tax)
- **Termination:** EU-specific pricing artifact estimate (if any) + recommended signal source compatible with bybit.eu SPOT-only execution.

## 4. Output structure (per track)

Each track produces 1-2 markdown files at the worktree root:

```
.worktrees/wt-phase25-research-fleet/
├── docs/research/
│   ├── REPORT-phase25-track-a-hyperliquid.md
│   ├── REPORT-phase25-track-b-dydx.md
│   ├── REPORT-phase25-track-c-cross-venue-divergence.md
│   ├── REPORT-phase25-track-d-liquidation-cascade.md
│   └── REPORT-phase25-track-e-bybit-basis-mica.md
└── deliverable.md (per-track)
```

**Per-track REPORT structure (REQUIRED sections):**
1. **Executive summary** — alpha mechanism identified, persistence estimate, integration cost, verdict (POSITIVE / NEGATIVE / MARGINAL)
2. **Source landscape** — ≥10 distinct queries with URLs + ≥2 independent sources per empirical claim
3. **Quantitative findings** — funding rate stats / divergence stats / cascade stats with numbers
4. **Tradeable alpha estimate** — edge per signal, fill rate, capacity, expected portfolio lift (rough)
5. **Integration plan** — where to plug into bot (signal source API, frequency, cost)
6. **Risks** — failure modes, regulatory concerns, data feed reliability
7. **Phase 25 #2 recommendation** — implement / skip / further-research

**Per-track deliverable.md:**
- Branch + commit SHA + push status
- File paths to REPORT + sources
- Quality gates (queries count, sources count, languages used, no-Hungarian check)
- Verdict summary (POSITIVE / NEGATIVE / MARGINAL)

## 5. Synthesis (after all 5 tracks return)

After 5 tracks complete, Mavis orchestrator:
1. **Aggregate findings → comparison matrix** (track × alpha mechanism × persistence × integration cost × expected lift).
2. **Identify TOP-RANKED track** for Phase 25 #2 implementation.
3. **Document NEXT-PHASE plan** in `phase25-2-scope-plan.md`.
4. **Archive all findings** to `docs/research/REPORT-phase25.md` (consolidated synthesis).

## 6. Time + cost budget (realistic numbers)

- **Time per track:** 45-60min each (5 tracks × 50min avg = ~4h parallel runtime, but max_concurrency=5 → ~50min wallclock).
- **Synthesis:** 20-30min after tracks complete.
- **Total session budget:** ~60-75min wallclock.

## 7. Termination criteria (when do we STOP?)

We STOP when one of these is reached:
1. **All 5 tracks return clean** with termination criteria met — proceed to synthesis.
2. **Single track returns strong POSITIVE** (alpha mechanism clearly identified with quantitative evidence) before all 5 return — early synthesis with reduced data.
3. **All 5 tracks return NEGATIVE** — early exit, archive, pivot to Phase 25 #2 (next alpha angle: e.g., on-chain microstructure).
4. **75min elapsed** in research phase — force synthesis on partial data, document gaps, present final synthesis with confidence ratings.

## 8. Cross-references

- **Phase 24 #1 closure:** +39.37%/mo @ <8% DD cap=0.18 (commit `adaf886`, PR #55).
- **Phase 24 #2 closure:** +18.82%/mo @ <5% DD cap=0.20 2-of-2 (commit `bfb9715`, PR #56).
- **+50%/mo target:** DNV (Phase 21 #1 closure). Realistic envelope +0.5-39%/mo.
- **Phase 10A (cross-exchange funding arb, parked):** initial exploration, never completed.
- **Phase 10B (options vol surface, parked):** initial exploration, never completed.
- **Memory:** `mm-crypto-bot-project.md` (project state), `MEMORY.md` (research doctrine override).
- **Related scope plans:** `phase14e-tokyo-colo-scope-plan.md` (NO-GO precedent, research methodology template).

## 9. Risks + open questions

1. **Signal lag from perp to spot** — perp-DEX price moves first, spot follows with 1-60s lag. Bot execution at bybit.eu SPOT must complete within this window.
2. **Funding rate convergence** — if cross-venue funding rates converge (arbitrageurs close the gap), alpha decays. Need post-2024 data, not historical.
3. **Regulatory drift** — MiCAR enforcement is post-2024. EU-specific pricing artifacts may disappear as market matures.
4. **Self-hosted data feed reliability** — perp-DEX APIs (Hyperliquid, dYdX) need continuous polling. Network outage = lost signal. Need fallback strategy.
5. **Signal vs alpha inflation** — finding a SIGNAL ≠ finding ALPHA. Need to validate via backtest against Phase 24 #1 baseline before implementing.

## 10. Status

- [x] Scope plan drafted (this file)
- [ ] Plan YAML written + launched
- [ ] 5 research agents launched in parallel
- [ ] Per-track reports collected
- [ ] Synthesis report drafted (orchestrator)
- [ ] Phase 25 #2 scope plan + implementation kickoff