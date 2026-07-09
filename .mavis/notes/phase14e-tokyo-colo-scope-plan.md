---
description: Phase 14E Tokyo co-loc latency arb — scope plan + research agent fleet design. Drafted 2026-07-06 14:58 Budapest after Phase 14D closure. Goal: determine if Tokyo co-loc is a viable path to +5-10%/mo at 1:10 leverage, or park definitively.
status: draft (scope phase)
owner: Mavis
agent: mavis
target-session-id: mvs_c13fe65cb68f4df3851304dea09a9099
---

# Phase 14E — Tokyo co-loc latency arb: scope plan + research fleet design

## 0. Why this exists

Phase 1-14D empirical arc plateaued at **+2.06%/mo portfolio / 10.58% DD / 0 liquidations** at 1:10 leverage on bybit.eu SPOT margin. **+50%/mo target structurally unreachable** at 1:10 retail bybit.eu confirmed by 13-phase empirical arc (boards: 1-7 conservative quant, 8-10G signal-center architecture, 10G.1-13 ensemble + arbitration + cross-symbol, 14A-D defensive stacking).

The ONLY documented architecture with realistic +5-10%/mo potential at 1:10 is **physical co-location adjacent to exchange matching engines** (Tokyo for Asian session, Equinix NY4/AWS for US). Phase 14E explores whether Tokyo co-loc is viable for this project's regulatory + capital profile, or definitively parked.

## 1. Hard constraints (re-baselined 2026-07-06)

| Constraint | Value | Source |
|------------|-------|--------|
| Leverage ceiling | **1:10 EXACT** (10× notional on 1× capital, 9× borrowed via bybit.eu SPOT margin) | bybit.eu SPOT margin policy + user directive 2026-07-04 |
| Exchange | **bybit.eu** primary, **binance** secondary (existing data paths) | user directive Phase 0 |
| Capital scale | **$10k** current book (user decision: stay at current book vs scale 5-10× deferred to user) | Phase 13 closure verdict |
| Jurisdiction | EU (MiCAR scope), Hungarian tax residency | bybit.eu registration |
| Latency budget target | **< 1ms RTT to venue matching engine** (cross-venue arb requires >1ms edge) | market microstructure literature |
| Tokyo session window | **00:00-08:00 UTC (= 09:00-17:00 JST)** — Asian market overlap with EU morning + US pre-market | session calendar |
| Risk per trade | 15% (Phase 14B) — caps at $100k notional per symbol at 1:10 | project default |
| Max open positions | 7 (4 per symbol × 3 symbols max) | Phase 14C |

## 2. Goal decomposition (the real questions)

The single question is "is Tokyo co-loc viable?", which decomposes into 6 sub-questions:

### Q1 — Vendor landscape (Tier 1 colocation providers in Tokyo)
**Goal:** Identify the realistic vendor set (3-7 candidates) with pricing, latency, cross-connect options.
**Termination:** Side-by-side vendor table with $/month + cross-connect options + setup fees + cancellation policies.

### Q2 — bybit.eu Tokyo presence (or lack thereof)
**Goal:** Does bybit.eu have a Tokyo PoP? If yes, where? If no, what regional PoP is closest (Singapore? Hong Kong?) and what's the realistic RTT from Tokyo colo?
**Termination:** bybit.eu PoP map + RTT matrix from each Tokyo colo vendor.

### Q3 — Asian session microstructure (the actual edge)
**Goal:** Where is the alpha in the 00:00-08:00 UTC window? Asian session patterns: funding-rate spikes (Kimchi, Binance-JA), JPY-pair arb, listing-pump, liquidation-cascade triggers. Documented historical net-edge per strategy per academic/quant source.
**Termination:** Per-strategy edge estimate (in $/trade basis points) + historical fill rate + per-strategy capital requirement.

### Q4 — Operational cost vs edge (the math)
**Goal:** All-in cost = colocation rent + cross-connect + exchange fees + tax + legal + compliance + engineer time. Compare against realistic edge ceiling.
**Termination:** Monthly cost ledger + breakeven-edge calculation + minimum-edge-per-trade for positive ROI.

### Q5 — Regulatory + tax (the legal showstoppers)
**Goal:** Can a Hungarian-resident EU-citizen legally place colocated servers in Tokyo and trade bybit.eu from them? Or does Japan have specific obligations (FSA registration, J-CT registration, J-NOL equivalent) that require local entity + local hire + ~$200k/yr legal cost?
**Termination:** Per-jurisdiction obligation table + cost-to-comply + alternatives (e.g., operate from EU PoP + remote latency, accept lower edge).

### Q6 — Alternatives to physical colocation
**Goal:** Are there viable non-colocation paths? (a) AWS Tokyo / Azure Japan East / GCP Tokyo with low-latency kernel-bypass AMI, (b) colocated VPS (Vultr Tokyo, etc), (c) hosted latency-arbitrage services (e.g., latency-arbitrage-as-a-service), (d) exchange-provided colocation (bybit doesn't offer).
**Termination:** Per-alternative latency / cost / setup matrix + recommendation.

## 3. Research agent fleet (10 distinct angles)

Per memory doctrine override: **5+ parallel agents minimum**, **distinct angles**, **≥10-20 web_queries per angle**, **multi-language mandatory** (ja critical for Tokyo, zh for Asian venue research, ko for Korean CEX, ru for Russian-speaking traders, vi for SEA traders).

**Important:** These 10 angles execute AFTER the scope doc is complete. The scope doc itself is this file. Each agent receives a self-contained brief + termination criterion + language mandate.

### Agent 1 — Tokyo colocation vendor map (en + ja)
- **Angle:** Identify 5-7 Tier-1 Tokyo colocation vendors with $/month pricing, cross-connect options, latency to JP exchanges (bitFlyer, Binance Japan, GMO Coin, bitbank, OKX-JP, Bybit-EU-or-closest-PoP).
- **Languages:** en (vendor docs), ja (domestic Japanese vendor pages — AT TOKYO, Equinix TY3/TY11, Digital Realty NRT10/12, KDDI TELEHOUSE, Colt Osaka, ARTERIA Networks)
- **Queries:** ≥20 (vendor-by-vendor: site, pricing page, contact, recent datacenter capacity changes, post-2020 pricing trends, JP-only vs international options)
- **Termination:** Side-by-side table with $/month + cross-connect list + setup fee + bybit.eu reachable endpoints + 24/7 NOC + remote-hands service.

### Agent 2 — bybit.eu PoP map + Tokyo RTT (en + zh)
- **Angle:** bybit.eu official PoP locations + any latency-sensitive routing info. If no Tokyo PoP, identify Singapore / Hong Kong / Frankfurt PoPs and realistic RTT from Tokyo colos (via public Looking Glass or test IPs).
- **Languages:** en (bybit.eu support docs), zh (Bybit-CN archives for historical PoP decisions, if available), plus the public traceroute/looking-glass docs of major IXPs in Tokyo (JPIX, JPNAP)
- **Queries:** ≥15 (bybit.eu docs, support tickets, community reports, latency benchmarks, RTT proxies via Cloudflare / AWS Tokyo / Azure Japan)
- **Termination:** Realistic RTT table from each Tokyo colo to bybit.eu's nearest PoP. If >5ms RTT, co-loc in Tokyo is unlikely viable.

### Agent 3 — Asian session microstructure alpha (zh + ja + ko)
- **Angle:** Document the alpha generation mechanics of Asian-session (00:00-08:00 UTC) strategies. Funding-rate spikes (Korean Kimchi premium, JPY carry, BNB burn impact), liquidation cascade patterns, listing-pump behavior in Asian session, JPY-pair vs USDT-pair price divergence.
- **Languages:** zh (Binance-CN, OKX-CN forums), ja (bitFlyer community, Binance-JP, Zaif exchange archives), ko (Upbit/Bithumb communities), en (academic microstructure papers post-2020)
- **Queries:** ≥20 (per-venue behavior, per-strategy fill rate, historical incident archives like 2024-08 carry-trade-unwind, 2025-10-11 crash analysis postmortems)
- **Termination:** Per-strategy $/trade edge estimate + fill rate + capital requirement + competing-firm pressure (if HFTs already extract this edge, retail co-loc won't).

### Agent 4 — Operational cost ledger (en)
- **Angle:** All-in cost for a Hungarian-resident operating a colocated server in Tokyo. Components: colo rent, cross-connect to bybit.eu PoP, exchange fees, tax (Hungarian + Japan), legal (entity registration, MiCAR filings if any), engineer time (estimate 2-4h/week monitoring + 1-2h/week updates), local hire (if Japan-FSA registration triggers).
- **Languages:** en (cost-engineering blogs, HFT firm salary reports, Hungarian tax law docs, MiCAR text), ja (Tokyo rent-12mo laws, Japanese tax residency rules)
- **Queries:** ≥10 (per-component cost sources, recent 2024-2026 pricing trends, Hungarian crypto tax rules, Japan crypto tax: 20% income tax + 0.55% reconstruction tax on gains)
- **Termination:** Monthly cost ledger (columns: $/month at low / mid / high scenario) + breakeven edge percentage.

### Agent 5 — Regulatory + tax (en + ja)
- **Angle:** Hungarian/EU citizen operating a colocated server in Tokyo trading bybit.eu. Japan FSA registration requirements (crypto service provider registration vs. trader-only), Japanese tax residency for crypto (deemed-disposal on withdrawal), Hungarian tax (15% SZJA on capital gains + 13% SZOCHO if individual entrepreneur), MiCAR EU implications for cross-border crypto trading.
- **Languages:** en (Japan FSA English docs, Hungarian NAV Tax Guide, MiCAR Regulation 2023/1114), ja (Japan NTA crypto tax guide, FSA registration flow)
- **Queries:** ≥15 (Japan FSA regulatory thresholds, Hungarian NAV ruling examples, MiCAR cross-border posture, legal precedent from HashHub / Merkle Science / Chainalysis reports)
- **Termination:** Per-jurisdiction obligation table + cost-to-comply + showstoppers identification.

### Agent 6 — Alternatives to physical colo (en + ja + zh)
- **Angle:** Non-physical-colo paths to <1ms latency. (a) AWS Tokyo / Azure Japan East / GCP Tokyo (DPDK/Solarflare-capable instances), (b) colocated VPS (Vultr Tokyo, Linode Tokyo, Sakura Cloud), (c) exchange-provided colo (Bybit doesn't offer; Binance Japan inherited bitFlyer colo — check availability), (d) latency-arb-as-a-service (BitMEX-affiliated, Wintermute, etc).
- **Languages:** en (cloud provider docs, AWS nitro / SR-IOV docs), ja (Sakura Cloud, GMO Cloud docs), zh (Alibaba Cloud Tokyo docs if relevant)
- **Queries:** ≥15 (per-provider latency benchmarks, per-instance type, per-cross-connect options, real-world latency reports, AWS Tokyo Direct Connect pricing)
- **Termination:** Per-alternative matrix (latency / cost / setup / ongoing-ops) + recommendation.

### Agent 7 — Hardware + network engineering (en + ja)
- **Angle:** What does actual HFT kit look like? Kernel bypass (DPDK, ef_vi, Solarflare OpenOnload), FPGA vs CPU decision, market-data feed types (ITCH/OUCH/FIX/websocket/WebSocket-binary), cross-connect vs dark fiber, NIC selection (Mellanox ConnectX-6 Dx), tick-to-trade latency benchmarks.
- **Languages:** en (Cloudflare / Jane Street / SIG / Tower Research engineering blogs, Solarflare / AMD technical papers), ja (Japanese HFT firm interviews — SIG group Tokyo, Optiver, Hudson River Trading Tokyo presence)
- **Queries:** ≥15 (kernel-bypass comparisons, FPGA economics at small scale, market-data feed selection for crypto — most exchanges use WS, not FIX/ITCH, cost of FPGA dev kit, real HFT firm deployment guides)
- **Termination:** Per-component recommendation: NIC, OS-bypass stack, market-data decoder, position-management library.

### Agent 8 — Adjacent Asian venues (Singapore / Hong Kong) (en + ja + zh)
- **Angle:** Cheaper co-loc alternatives to Tokyo — Singapore (Equinix SG3, ST Telemedia, 1-Net) closer to Binance Singapore PoP, Hong Kong (Equinix HK1, Mega-iAdvantage) closer to Binance HK legacy / OKX / Bybit regional.
- **Languages:** en (vendor docs), zh (Hong Kong / Singapore crypto venue docs), ja (Japanese brokers with Singapore presence, GMO Coin SG)
- **Queries:** ≥15 (per-venue pricing, RTT to bybit.eu, RTT to other Asian exchanges, regulatory landscape, recent 2024-2026 capacity changes)
- **Termination:** Per-venue comparison + recommendation if Tokyo is over-priced or regulatory-blocked.

### Agent 9 — Failure modes of co-loc systems (en + zh + ja)
- **Angle:** What breaks in production? (a) network partitions / exchange outages (LUNA 2022, FTX 2022, Bybit Jan 2025 cold wallet incident), (b) sync drift between exchange clock and local clock (PTP, NTP, GPS), (c) hardware failures (PSU, NIC, motherboard), (d) cooling / power failures at Tokyo colo (typhoon / earthquake — Tokyo is seismic zone 5), (e) regulatory takedowns (Japan FSA enforcement cases 2024-2026), (f) tax event triggers (Japanese deemed-disposal rules).
- **Languages:** en (Bybit postmortems, FTX/LUNA academic analyses, hardware failure literature), ja (JMA seismic reports, Japan FSA enforcement announcements), zh (postmortem analyses in Chinese)
- **Queries:** ≥15 (post-mortem reports, infrastructure-failure MTTR statistics, Japan earthquake power-grid impact, Japanese deemed-disposal rule specifics)
- **Termination:** Top 10 failure modes + per-mode mitigation +90-days-reserve capital requirement.

### Agent 10 — Historical HFT retail-co-loc case studies (en + zh + ja)
- **Angle:** Have any retail / small-firm players successfully operated latency-arb from Tokyo in the past 5 years? (a) Japanese individual quant trader community (e.g., 個人投資家, クオンツ, システムトレード communities), (b) Chinese individual co-loc case studies (个人量化, 量化交易者 forums), (c) Korean individual co-loc (개인 퀀트, 시스템 트레이딩). What's the realistic edge retention for a small firm vs HFT competition?
- **Languages:** en + ja + zh + ko (NO Hungarian)
- **Queries:** ≥15 (Japanese 個人投資家 blogs on Tokyo colo, Chinese 量化交易者 Zhihu/CSDN/SJTU cases, Korean 디시인사이드 crypto quant threads)
- **Termination:** Per-cohort realistic edge estimate + recommendation on whether small firm can compete.

## 4. Synthesis (after all 10 agents return)

After 10 agents complete, Mavis orchestrator:
1. **Aggregate findings → synthesis matrix** (venue × strategy × cost × regulatory).
2. **Identify MILESTONE-RANKED DECISION**: GO / CONDITIONAL-GO / NO-GO.
3. **If CONDITIONAL-GO**: detail the gates (e.g., "designated Japanese entity if $X asset threshold crossed", "AWS Tokyo if kernel-bypass AMI available with $Y/month", etc).
4. **If NO-GO**: document why, archive to `phase14e-tokyo-colo-verdict.md`, park and move to Phase 14F+ (next alpha research cycle).
5. **All findings → `.mavis/notes/phase14e-tokyo-colo-research-fleet.md`** (consolidated report).

## 5. Time + cost budget (the realistic numbers)

**Time-budget per research agent:** 25-40min each (10 agents × 30min avg = 5h parallel runtime).
**Mavis orchestrator synthesis:** 30min after agents return.
**Total session budget:** 1-2 working sessions (5-10h).

**Hard limit:** No vendor contracts, no colo lease, no legal entity registration initiated until user explicitly approves. This is research only.

## 6. Termination criteria (when do we STOP?)

We STOP when one of these is reached:
1. **All 10 agents return clean** with termination criteria met (per-agent) — proceed to synthesis.
2. **Single GO verdict is reached** before all 10 return — early synthesis with reduced data.
3. **Single NO-GO verdict is reached** with high confidence (>2 independent sources per showstopper criterion) — early exit.
4. **12h elapsed** in research phase — force synthesis on partial data, document gaps, present final synthesis with confidence ratings.

## 7. Cross-references

- **Phase 14A-D ceiling:** +2.06%/mo portfolio / 10.58% DD / 0 liquidations.
- **+50%/mo target:** structurally unreachable at 1:10 retail bybit.eu (13-phase arc).
- **Memory:** `mm-crypto-bot-project.md` (project state), `MEMORY.md` (research doctrine override).
- **Related scope plans:** `phase12-beyond-retail-scope-plan.md` (capital/regulatory decisions deferred).
- **Board:** `board.md` Phase 14E section.

## 8. Risks + open questions

1. **User-mandated Japan focus vs Singapore/Hong Kong closer PoPs.** If user mandate says "Tokyo", Agent 8 (adjacent venues) must explicitly document why Tokyo over alternatives.
2. **bybit.eu no-Tokyo-PoP showstopper.** If bybit.eu has zero Asian PoP, the entire Phase 14E is NO-GO. Document this as fundamental constraint.
3. **Japan FSA registration cost.** If >$50k/yr, the project is structurally retail-only. Document as fix-cost vs edge retention.
4. **Latency floor vs HFT competition.** Even at <1ms RTT, if 5+ HFT firms are extracting the edge first, retail co-loc ROI negative. Document as "small firm edge retention".

## 9. Status

- [x] Scope plan drafted (this file)
- [ ] User review (scope + agent fleet)
- [ ] 10 research agents launched in parallel (Mavis orchestrator)
- [ ] Per-agent reports collected (each ≥30KB)
- [ ] Synthesis report drafted
- [ ] User go/no-go for Phase 14F (implementation)
