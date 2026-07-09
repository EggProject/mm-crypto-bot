# Phase 14E — Singapore & Hong Kong Adjacent Co-location Venues (Agent 8 of 10)

**Research Agent 8 of 10** | Angle: SG + HK colocation as alternative to Tokyo (re-evaluated after Agent 2 confirmed bybit.eu matching in AWS Singapore).
**Date:** 2026-07-06 18:43 Europe/Budapest
**Output dir:** `.mavis/notes/phase14e-tokyo-colo/08-adjacent-venues-sg-hk/`
**Languages:** en (vendor docs), zh (HK/SG crypto venue docs), ja (JP broker SG presence). **NO Hungarian.**

---

## 0. Executive Verdict

| Question | Verdict |
|---|---|
| Is Singapore colo a viable alternative to Tokyo for bybit.eu latency-arb? | **YES — single decisive answer**. bybit.eu matches in **AWS ap-southeast-1 Singapore**; SG colo drops RTT from 85-95 ms (Tokyo) to **~1-5 ms** (Equinix SG3) or **~16 ms REST** (Arbitron baseline from AWS ap-southeast-1). Brings the venue inside the cross-venue-arb envelope. |
| Is Hong Kong colo a viable alternative to Tokyo for bybit.eu? | **NO for bybit.eu** (HK→SG matching is ~54 ms; over the 5 ms target). **YES for OKX** (HK colo → OKX AliCloud HK matching = ~35 ms REST; private line 6-14 ms). |
| Is SG/HK colo cheaper than Tokyo? | **NO**. Singapore full-rack is SGD 3,500-8,000/mo (~$2,600-5,900) vs. Tokyo ¥250-520k (~$1,650-3,430). HK is in between (Equinix HK1 $618/kVA + ~$2k/mo cabinet). Singapore is consistently the **most expensive** APAC market per CBRE H2 2025 ($310-470/kW/mo). |
| Is SG/HK colo cheaper than Tokyo on a like-for-like basis (AWS Direct Connect 1G + 1U-equivalent)? | **~15-25% more expensive** for the SG/HK package, primarily because of land/energy scarcity. The latency edge is the value proposition, not the cost. |
| Are there regulatory showstoppers? | **NO** for a Hungarian-resident personal trader placing colo in SG/HK (neither MAS DTSP nor HK SFC VATP licensing applies to an individual colocating). The exchange itself is the regulated entity, not the trader. |
| **Recommendation** | **DROP Tokyo colo as the primary path. PIVOT to Singapore colo (Equinix SG3) for bybit.eu recovery; treat HK colo only as secondary if OKX or cross-venue Tokyo-Singapore arb becomes a strategy.** The bybit.eu latency-arb thesis is **structurally viable from SG**, not from Tokyo. |

**Confidence**: HIGH for bybit.eu RTT (4 independent sources, including Agent 2's measurements and Arbitron), MEDIUM for SG/HK colo pricing (most are quote-only for retail), MEDIUM for cross-venue OKX data (one GitHub source + Arbitron + OKX migration announcement).

---

## 1. Why this angle matters — re-scoped from Agent 2's findings

The original brief framed this angle as "cheaper alternatives to Tokyo if Tokyo is over-priced or regulatory-blocked". Agent 2's findings (see `02-bybit-eu-tokyo-pop/REPORT.md`) elevated the question to **"the only viable alternative, period"**:

- **bybit.eu matching engine is in AWS ap-southeast-1 (Singapore, AZs apse1-az2 + apse1-az3)** — confirmed by 4 independent sources: Bybit's own FAQ, Tardis.dev data vendor docs, BTCC Japanese press, and Arbitron latency measurements.
- **Hong Kong is a DR backup (Q2 2024), not a primary matching PoP** (BTCC ja, medium confidence).
- **No Tokyo PoP exists** for Bybit; the nikhilpadala.com claim of Equinix TY11 is contradicted by 4+ authoritative sources and Arbitron's 91 ms Tokyo-Bybit RTT (cross-region signature, not same-DC).
- **Tokyo → bybit.eu matching floor: 85-95 ms** (ASE cable + transponder overhead), structurally over the 5 ms cross-venue-arb target.
- **bybit.eu's MiCAR wrapper is a legal overlay; the matching infrastructure is global, single-tenant.**

This means the **Asian-session latency-arb strategy** for bybit.eu is **only viable from Singapore colo**, not Tokyo. Hong Kong colo is viable for **OKX (Alibaba Cloud HK matching)** but not for bybit.eu. Tokyo colo remains the right venue for **Binance Spot / Bitget / Gate.io / KuCoin / HTX / CoinEx / MEXC / Hyperliquid** (8 of the top 10 Asian-spot-volume exchanges) but those are out of scope for Phase 14E because bybit.eu is the project's primary venue.

**Therefore Agent 8's central question is: is Singapore colo (the only viable bybit.eu-adjacent venue) economically and regulatorily feasible, and how does it compare to Tokyo as a fall-back?**

---

## 2. Singapore colocation landscape

### 2.1 Market structure (post-2024)

- **Singapore is the densest APAC data-center market** with **~1.4 GW total capacity** across 70+ facilities — APAC #5 by capacity (after China mainland, Japan, India, Australia) but #1 by density (people per MW: ~12,750, second only to itself). (Source: Cushman & Wakefield APAC Data Centre Update H2 2024; Zaobao SG news article 2025-01-05; Mordor Intelligence 2025)
- **Singapore wholesale build cost is ~$13.80/W** (the second-highest in the world after Tier 1 metros). The constraint is **land scarcity + power-allocation caps**, not capital. Singapore imposed a **DC moratorium 2019-2022** and lifted it with strict sustainability gates; even after lifting, hyperscale allocation is highly selective.
- **Colocation pricing in Singapore is among the highest globally**: **$310-470/kW per month** (CBRE H2 2025; Brightlio 2026).
- **Hyperscale self-build share is rising fast** — 59% of 2024 deployments; mega-scale (>60 MW) is growing at 17.5% CAGR. This squeezes the retail/SME colocation market upward.

**Implication for retail colocator**: The "land of cheap colo" Singapore was a decade ago is gone. The pricing floor for retail is now ~$2,600/mo for a full rack; the only way to get cheaper is to compress footprint (1U, $80-300/mo) or share cross-connects.

### 2.2 Per-vendor profiles

#### 2.2.1 Equinix Singapore (SG1, SG3, SG4, SG5 + new SG6 Q1 2027)

**Source**: https://www.equinix.com/data-centers/asia-pacific-colocation/singapore-colocation ; https://www.equinix.com/data-centers/asia-pacific-colocation/singapore-colocation/singapore-data-center/sg3 ; https://investor.equinix.com/news-events/press-releases/detail/610/equinix-announces-significant-expansion-to-increase-data ; https://www.equinix.com/data-centers/expansions ; https://newsroom.equinix.com/2024-11-19-Equinix-to-Help-Accelerate-AI-Innovation-in-Singapore-with-US-260-Million-Data-Center-Expansion

**Facilities**:
- **SG1** (Ayer Rajah Crescent) — original 1999-vintage facility, dense network ecosystem, connects to SG3 via dark fiber.
- **SG3** (26A Ayer Rajah Crescent) — opened 2015, currently the **largest Equinix APAC facility**: 5,875 cabinets / 16,600 m² after the 2024 $78M final-phase expansion. **182 networks on-net (PeeringDB 2025)**. 5kW per cabinet standard, 208V A+B redundant. (Source: https://colomap.com/facilities/equinix-sg3/; https://datacenternews.asia/story/equinix-announces-expansion-of-its-largest-asia-pacific-data-centre)
- **SG4** (Tai Seng Industrial Estate) — opened March 2020, $85M initial, 1,400 cabinets phase-1, 4,000+ at full build-out. 7-storey reinforced concrete.
- **SG5** (Tanjong Kling) — 9-storey, 5,000 cabinets at full build, 12,000 m².
- **SG6** (announced Nov 2024, **opening Q1 2027**) — 9-storey, 20 MW initial, **liquid-ready for AI workloads**, $260M initial investment, 100% renewable.

**Pricing (Equinix SG3 / SG1 retail, vendor + 3rd-party published, late 2024-2026, S$1 = US$0.74 approximate)**:

| Item | Price | Source |
|---|---|---|
| 1U (Equinix DC, NewMedia Express reseller) | **S$406.60/mo** (~US$300) | https://website.ne.com.sg/colocation.html |
| 2U | S$513.60/mo (~US$380) | same |
| 3-4U | S$620.60/mo (~US$460) | same |
| 5-6U | S$727.60/mo (~US$540) | same |
| Setup fee (1U) | S$267.50 one-time | same |
| **1U at Ascenix DC (cheaper alt, carrier-neutral)** | **S$203.30/mo** (~US$150) | same |
| **Full rack Equinix SG3 (5kW)** | **SGD 3,500-8,000/mo (US$2,600-5,900)** | https://www.rebootmonkey.com/en/colocation/singapore ; https://www.equinix.com/data-centers |
| **Equinix Fabric 1G port (any SG IBX)** | **US$150/mo** | https://docs.equinix.com/fabric/pricing-billing/fabric-billing-pricing/ |
| **Cross-connect (physical, SG metro)** | **US$100-300/mo + US$500-1,500 install** | https://www.vendr.com/marketplace/equinix ; https://docs.equinix.com/cross-connect/xc-pricing-billing-terms/ |
| **Equinix Internet Access 1G fixed-bandwidth** | **US$1,000/mo** | Equinix docs |
| **AWS Direct Connect Hosted Connection 50-500 Mbps** (at Equinix SG4 → ap-southeast-1) | **US$200-500/mo** (Japan reference, SG similar) | https://nikhilpadala.com/blog/exchange-co-location-cloud/ (for methodology) |
| **Bybit / crypto cross-connects at SG3** | **$200-500/mo per AWS Direct Connect + Fabric port** | https://docs.equinix.com/fabric-marketplace/connecting-to-service-provider/aws/direct-connect-overview |

**AWS Direct Connect at SG**:
- Equinix SG3 is **a Direct Connect location for AWS ap-southeast-1**. Hosted connections: 50 Mbps, 100 Mbps, 200 Mbps, 300 Mbps, 400 Mbps, 500 Mbps, 1 Gbps, 2 Gbps, 5 Gbps, 10 Gbps. 1G, 10G (MACsec), 100G (MACsec) for dedicated.
- AWS Direct Connect pricing in ap-southeast-1: 1G port-hour = US$0.203/hr ≈ US$148/mo; 10G = US$1.40/hr ≈ US$1,020/mo. Plus Equinix cross-connect and Fabric port.

**Power / redundancy**: SG1, SG3, SG4 = 5kW standard per cabinet; can be quoted up to 20-30 kW. N+1 power, 2N optional. **SG6 (2027) is liquid-cooling AI grade**.

**Tenancy / crypto adjacency**:
- **Equinix SG3 is the single most crypto-dense colocation in Asia.** Bybit's official position (per Tardis + Bybit FAQ) places matching in **AWS ap-southeast-1 (Singapore, AZ apse1-az2/az3)**, not directly in SG3. **The connection from Equinix SG3 to AWS ap-southeast-1 is ~1-3 ms** via Equinix Fabric + AWS DX (same AWS region, same fiber path), so crypto firms use SG3 as the on-ramp to AWS Singapore.
- Per nikhilpadala.com (a vendor-affiliated blog, not an authoritative source), Equinix SG3 houses "Bybit secondary, OKX primary" — but Agent 2 showed Bybit's matching is in **AWS ap-southeast-1**, not SG3 directly. The realistic interpretation: **crypto exchange matching is on AWS Singapore (not Equinix SG3)**, but **co-located prop-trading firms sit in SG3** and connect to AWS ap-southeast-1 via Fabric.
- Other APAC crypto-relevant tenants reported in Equinix SG3: AWS DX on-ramp, Hetzner Online, BGP routing for Bybit / OKX / Coinbase / Kraken per PeeringDB.
- **Confidence**: HIGH for AWS ap-southeast-1 being the matching region; MEDIUM for which specific crypto exchanges have cages at SG3 (Equinix does not publish tenant lists; inference is from network-route analysis).

**Foreign-client KYC**: Equinix Singapore (Equinix Singapore Pte Ltd) accepts foreign clients routinely; English MSA; USD wire + SGD wire. Sales: +65-6722-1010.

**Confidence: HIGH** (vendor primary sources, 3rd-party reseller pricing, AWS docs all triangulate).

#### 2.2.2 ST Telemedia Global Data Centres (STT GDC) — Loyang, Defu, Kim Chuan, MediaHub, GDC Singapore 8

**Source**: https://www.sttelemediagdc.com/sg-en ; https://www.sttelemediagdc.com/services/colocation ; https://www.datacentermap.com/singapore/singapore/stt-loyang/ ; https://www.businesswire.com/news/home/20260202441025/en/KKR-Led-Consortium-with-Singtel-Group-to-Fully-Acquire-ST-Telemedia-Global-Data-Centres-at-S%2413.8-Billion-Enterprise-Value ; https://www.sttelemedia.com/about-us/news/read/st-telemedia-global-data-centres-raises-s175-billion-kkr-led-consortium-singtel

**Ownership**: STT GDC is owned by a KKR-led consortium with SingTel Group; **KKR + SingTel announced full acquisition at S$13.8 billion enterprise value in Feb 2026**. KKR is the controlling shareholder.

**Footprint**: STT GDC operates 95+ data centers across 11 countries, with multiple Singapore sites including **STT Loyang (39 MW at 1 Loyang Close)**, **STT Defu**, **STT Kim Chuan**, and **MediaHub** (the former 1-Medialink site).

**Pricing**: All STT GDC Singapore pricing is **quote-only**; reseller sites (Inflect, etc.) list starting prices but no published retail rate card. STT is positioned as a **mid-premium** alternative to Equinix — typically 10-20% below Equinix for comparable specs.

**Power / redundancy**: STT Loyang = 39 MW, Tier III+, N+1. STT's USP is **SingTel parent ownership**, which gives **direct SingTel fiber backbone access** (one of the two APAC backbones, the other being NTT). This is meaningful for crypto because **SingTel is the dominant Singapore transit provider**, so an STT colo gets the cleanest single-hop path to AWS ap-southeast-1.

**Tenancy / crypto adjacency**: STT GDC is one of the top 3 Singapore colocation operators (with SingTel and Equinix). No public tenant list of crypto exchanges; STT's customer base skews enterprise + telco. The SingTel backbone adjacency makes it attractive for any firm needing direct Singapore-internet-edge without going through Equinix Fabric.

**Foreign-client KYC**: STT GDC is a Singapore-incorporated entity (with KKR/SingTel backing); contracts in English; standard payment via wire.

**Confidence: MEDIUM** (no published retail pricing; STT GDC is less transparent than Equinix; crypto-tenant evidence is from PeeringDB route analysis, not direct attestation).

#### 2.2.3 1-Net Singapore (SingTel subsidiary)

**Source**: https://1-net.com.sg/ ; https://1-net.com.sg/wp-content/grand-media/application/1-Net_Pocket_Brochure.pdf ; https://www.simplercloud.com/co-location-enquiry/ ; https://baxtel.com/data-centers/1-net-singapore-pte-ltd

**Footprint**: **1-Net North** (18 Riverside Road, 739088) and **1-Net East** (750E Chai Chee Rd) plus the **Data Center 2** operated through resellers (SimplerCloud). 1-Net is a SingTel subsidiary and is **carrier-neutral with telco-class facility management**.

**Pricing** (from SimplerCloud, a 1-Net reseller, late 2024):

| Item | Price (SGD/mo) | Price (USD/mo) |
|---|---|---|
| 1U | Unavailable (limited) | n/a |
| 10U | Limited, request quote | n/a |
| **Half rack (21U, 1kVA, 100Mbps, 2 IPs)** | **from S$960/mo** | **~$710** |
| **Full rack (42U, 2kVA, 100Mbps, 5 IPs)** | **from S$1,350/mo** | **~$1,000** |
| Setup fee | S$100-800 one-time | ~$75-590 |

**Power / redundancy**: 2-3 kVA standard per cabinet; can quote higher. 3 independent UPS systems per the 1-Net brochure; full N+1 power; carrier-neutral with domestic + international connectivity.

**Tenancy / crypto adjacency**: 1-Net's USP is the **SingTel backhaul + carrier-neutral ecosystem**. **Cheaper than Equinix for retail half/full rack** (S$1,350 full rack vs Equinix S$3,500-8,000) but **lower power density** (2-3 kVA vs Equinix 5 kVA). Crypto tenancy inference: SingTel parent → transit advantage → some crypto firms use 1-Net as the on-ramp to AWS ap-southeast-1.

**Foreign-client KYC**: 1-Net is a SingTel subsidiary; English-language contracts; international wire.

**Confidence: HIGH** for pricing (vendor reseller publishes).

#### 2.2.4 Ascenix (carrier-neutral SG alternative)

**Source**: https://ascenix.net/ ; https://website.ne.com.sg/colocation.html

**Pricing** (NewMedia Express reseller):
- 1U: S$203.30/mo (~$150)
- 2U: S$278.20/mo (~$205)
- 3-4U: S$353.10/mo (~$260)
- 5-6U: S$428.00/mo (~$315)
- Setup: S$160.50 one-time

**Ascenix is positioned as the budget-tier Singapore colocation** — a tier below 1-Net and a tier below Equinix. 5 Mbps dedicated bandwidth included; more on quote. **Crypto-tenant evidence: none public.**

**Confidence: MEDIUM** (reseller-published pricing; Ascenix itself has minimal public web presence).

#### 2.2.5 Other Singapore operators (summary)

- **Digital Realty Singapore** (Jurong, Loyang, Digital Singapore 1) — wholesale hyperscale, similar tier to Equinix SG3, but retail pricing is quote-only and typically 10-20% above Equinix.
- **AirTrunk Singapore** (SGP1) — wholesale AI-grade, not retail-colocation.
- **Keppel DC** — wholesale, recently acquired 2 hyperscale AI DCs in Genting Lane (S$1.07B / US$795M) + additional S$310M contingent; **Singapore DC count rises to 8** post-acquisition.
- **GDS / DayOne** — entering SG via Tsuen Wan, Sha Tin, Fanling (HK-anchored, not yet SG).
- **NTT Communications Singapore** — operated as part of NTT's APAC DC portfolio; some crypto firms use NTT SG for their global backbone access.

### 2.3 Singapore — side-by-side table

| Vendor | Facility | 1U $/mo | Half rack $/mo | Full rack $/mo | AWS DX | Equinix Fabric | Crypto adjacency | Confidence |
|---|---|---|---|---|---|---|---|---|
| **Equinix SG3** (Ayer Rajah, 5,875 cabs, 182 networks) | retail | **$300** (S$406 reseller) | quote | **$2,600-5,900** (SGD 3,500-8,000) | YES to ap-southeast-1 | YES | Highest — AWS DX on-ramp, Bybit/OKX/Coinbase routes | HIGH |
| **Equinix SG4** (Tai Seng) | retail | quote | quote | quote (similar to SG3) | YES | YES | Same ecosystem as SG3 via EquinIX fabric | HIGH |
| **STT GDC Loyang** (39 MW, SingTel parent) | mid-premium | quote | quote | ~$2,200-3,500 (estimated, 10-20% below Equinix) | partner | partner (no Fabric) | SingTel backbone advantage | MEDIUM |
| **1-Net Data Center 2** (SingTel subsidiary) | retail | limited (request quote) | **$710** (S$960) | **$1,000** (S$1,350) | partner | partner | SingTel backhaul, lower density | HIGH |
| **Ascenix** (carrier-neutral) | budget retail | **$150** (S$203) | quote | quote | partner | partner | None public | MEDIUM |
| **Digital Realty Singapore** (wholesale) | wholesale | n/a | n/a | quote | YES via ServiceFabric | partner | AI / cloud focus | LOW (for retail) |
| **Keppel DC** (wholesale) | wholesale | n/a | n/a | quote | partner | partner | None retail | LOW (for retail) |
| **NTT Singapore** (telco) | telco-grade | quote | quote | quote | YES (NTT backbone) | partner | Some crypto backhaul | MEDIUM |
| **AirTrunk SGP1** | wholesale AI | n/a | n/a | quote (multi-MW) | n/a (wholesale) | n/a | AI focus | LOW (for retail) |

**Notes on the table**:
- All SG prices in USD at 1 SGD = US$0.74 (2026 mid-rate).
- 1U pricing for Equinix SG3 is from a 3rd-party reseller (NewMedia Express), not Equinix itself; Equinix retail 1U is "quote-only" but typically 20-40% above reseller rates.
- Singapore per-kW is **$310-470/mo** (CBRE H2 2025) — the most expensive in APAC and ~3rd globally. A 5kW cabinet thus costs $1,550-2,350/mo just for power, before space + cross-connect.
- AWS Direct Connect in ap-southeast-1: 1G port-hour = US$0.203/hr ≈ US$148/mo; 10G = US$1.40/hr ≈ US$1,020/mo. Plus Equinix cross-connect (~$200/mo) + Fabric port (~$150/mo) = total ~$500/mo for a 1G AWS DX path from Equinix SG3.

### 2.4 Singapore crypto venue presence (post-2025 DTSP shakeout)

- **Bybit**: **NO SG license**. Was on MAS alert list. **Exited Singapore in 2025**; plans to relocate staff to Dubai + Hong Kong. (Source: https://www.binance.com/en/square/post/26272146267193 ; https://www.binance.com/en/square/post/25070246341057 ; https://www.ainvest.com/news/singapore-orders-unlicensed-crypto-exchanges-shut-2025-bitget-bybit-plan-exit-2506/)
- **Bitget**: **NO SG license**. Relocating to Dubai + Hong Kong. (Same sources.)
- **Binance**: **NO SG retail license**, but keeps remote workers in SG (legal via corporate-employment structure). (https://www.businesstimes.com.sg/companies-markets/binance-stays-and-tokenize-leaves-singapores-crypto-sector-seeing-change)
- **OKX**: **Licensed** (DPT license granted under PS Act).
- **Coinbase, Kraken, BitGo**: **Licensed** (DPT under PS Act).
- **Tokenize Xchange**: Exited SG in 2025 after MPI license denied.
- **Bybit's AWS ap-southeast-1 matching infrastructure is not directly inside Singapore DC space** — it's in AWS ap-southeast-1 AZs, accessible via AWS DX from Equinix SG3.

**Critical implication**: The crypto exchange *tenant* count in Singapore DCs is dropping (Bybit, Bitget exiting), but the **AWS ap-southeast-1 matching infrastructure** that those exchanges used to operate is **still in Singapore** (in AWS data centers, not in colo). The colo is for prop-trading firms, not the exchange operator.

---

## 3. Hong Kong colocation landscape

### 3.1 Market structure (post-2024)

- **HK is the #2 APAC data-center market after Singapore by density** (people per MW: ~12,750) but its **total capacity is only ~600 MW** vs Singapore's 1.4 GW (Cushman & Wakefield H1 2025; Zaobao 2025-01-05).
- **HK rental rates: $210-260/kW/mo for enterprise, $140-210/kW/mo for hyperscale** (Mordor Intelligence, JLL 2025).
- **Colocation vacancy: 19% in H1 2025** (down from 21% in H2 2024) — supply is constrained but the pipeline is strong: HK supply pipeline **doubled to 700 MW by end of 2024** (from 317 MW in 2023) and additional 392 MW under construction + 64 MW in planning.
- **Geopolitical tension risk** (CBRE H2 2024): Western firms are increasingly reluctant to expand in HK due to **Greater Bay Area data-sharing regulation uncertainty** + **post-NSL risk perception**. Some spillover to Singapore and Johor Bahru / Batam.
- **HK Buildings Energy Efficiency Bill amendment** (Aug 2025) brought data centers under periodic energy-audit + PUE reporting under the Climate Action Plan 2050.

### 3.2 Per-vendor profiles

#### 3.2.1 Equinix Hong Kong (HK1, HK2, HK3, HK4, HK5 + new HK6 U/C 2026)

**Source**: https://www.equinix.com/data-centers/asia-pacific-colocation/china-colocation/hong-kong-data-centers ; https://www.equinix.com/data-centers/asia-pacific-colocation/china-colocation/hong-kong-data-centers/hk1 ; https://support.edcl.io/help/en-us/1-server-colocation/1-in-what-data-centers-can-i-colocate-their-respective-tier-rating-and-power-price ; https://www.voxility.com/cross-connects/prices/Cross+Connect+from+Equinix+HK2+Hong+Kong

**Facilities**:
- **HK1** (Tsuen Wan) — older, $618/kVA per third-party published rates. Tier-4+. (Source: https://support.edcl.io/help/en-us/1-server-colocation/1-in-what-data-centers-can-i-colocate-their-respective-tier-rating-and-power-price)
- **HK2** (Sha Tin) — newer, $500/kVA. 4MW phase-1 / 20MW total. (Source: https://colocation.docs.catixs.net/Catixs%20Colocation%20Services_a3e467f095654e77b5a9f4beb9531408/Service%20Pricing%209ee0460fad884d0991117fb183d13189)
- **HK3** (Tsuen Wan, 1 Wang Wo Tsai Street) — newer build.
- **HK6** (Tsuen Wan) — **U/C, RFS 2026**, 6MW phase-1 / **70 MW total**, $1B+ investment (per Cushman & Wakefield APAC Data Centre Update H2 2024).

**Pricing (HK1)** (3rd-party published, not Equinix retail rate card):

| Item | Price | Source |
|---|---|---|
| **Equinix HK1 (per kVA)** | **US$618/kVA** | https://support.edcl.io/help/en-us/1-server-colocation/1-in-what-data-centers-can-i-colocate-their-respective-tier-rating-and-power-price |
| **Equinix HK2 (per kVA)** | **US$500/kVA** (5kW ≈ $2,500/mo) | same |
| Equinix HK2 cross-connect setup (one-time) | **US$201.50** | https://www.voxility.com/cross-connects/prices/Cross+Connect+from+Equinix+HK2+Hong+Kong |
| Equinix HK2 cross-connect monthly | **US$299/mo** | same |
| Equinix Internet Access 1G fixed-bandwidth | **US$1,000/mo** | Equinix docs |
| Equinix Fabric 1G port (HK) | **US$150/mo** | https://docs.equinix.com/fabric/pricing-billing/fabric-billing-pricing/ |
| AWS Direct Connect to ap-east-1 at Equinix HK | YES (ap-east-1 region) | AWS docs |

**Power / redundancy**: 4-6 kVA standard at HK1/HK2. HK6 will offer 70 MW at full build.

**Tenancy / crypto adjacency**:
- **OKX's matching engine is NOT in Equinix HK** (per Agent 2 + GitHub njv74841 + Arbitron). OKX is on **Alibaba Cloud HK (cn-hongkong region)** since May 2022 (was AWS HK before that).
- **Bybit has no primary HK PoP** (DR backup only since Q2 2024; per Agent 2 BTCC ja).
- **HashKey Exchange (licensed HK VATP)** + **OSL Digital Securities (licensed HK VATP)** — both licensed under SFC Type 1+7 / AMLO since 2020-2022. They run matching in HK but at low volume relative to offshore exchanges.
- **No public tenant list of crypto exchanges at Equinix HK**, but PeeringDB shows OKX and BitMart route through Equinix HK for APAC edge.

**Foreign-client KYC**: Equinix HK is English-MSA, international wire.

**Confidence: HIGH** (HK1/HK2 per-kVA from 3rd-party published; cross-connect from Voxility; AWS DX confirmed).

#### 3.2.2 SUNeVision iAdvantage (MEGA-i, MEGA Gateway, MEGA Plus, MEGA IDC, MEGA Two)

**Source**: https://www.iadvantage.net/index.php/locations/mega-i ; https://www.iadvantage.net/index.php/company/about ; https://www.iadvantage.net/index.php/customer-service/frequently-asked-questions ; https://www.shkp.com/en-US/our-business/non-property-portfolio-businesses/information-technology ; https://www.iadvantage.net/index.php/company

**Ownership**: SUNeVision Holdings (SEHK: 1686) is a subsidiary of **Sun Hung Kai Properties (SHKP)**, the largest Hong Kong property developer. iAdvantage is the data-center arm.

**Footprint** (Hong Kong):
- **MEGA-i** (399 Chai Wan Road) — **30-storey, 350,000 sq ft**, the **largest carrier-neutral data center in Asia**. **200+ global + mainland + local telco carriers, ISPs, and 9 submarine cable systems**. ~15,000 interconnections.
- **MEGA Gateway** (1 Ma Kok St, Tsuen Wan) — newer build.
- **MEGA Plus** (Tseung Kwan O) — opened ~2017.
- **MEGA IDC** (Tseung Kwan O) — **Phase 1 launched 2024: 500,000 sq ft, 50 MW**. **Phase 2 under construction, RFS 2026, +45 MW phase / 180 MW total**. Anchor tenants: major cloud + international banks. (Source: Cushman & Wakefield APAC Data Centre Update H2 2024)
- **MEGA Two** — additional capacity.
- **Total SUNeVision HK footprint: 1.7M sq ft GFA** across 7-8 facilities.

**Pricing (Inflect reseller, 2024-2025)**:
- Colocation 1U: **from US$182/mo**
- Colocation + DIA bundle: from US$340.88/mo
- Bare metal: from US$299/mo

**Power / redundancy**: 2N UPS, 15-min battery backup, FM-200 / Novec 1230 fire suppression, dual power feeds, dual fiber, N+1 CRAC. **2N Tier III+ standard**.

**Tenancy / crypto adjacency**:
- **No public list of crypto tenants**, but the carrier-neutral ecosystem (200+ carriers, 9 submarine cables) is the **richest in HK**. Specifically:
  - **iAdvantage is the preferred on-ramp to mainland China** for many firms (the MEGA-i is on HK Island, near the China undersea-cable landings).
  - **Cross-border to China** via China Telecom, China Mobile, China Unicom, PCCW, HKBN — all on-net at MEGA-i.
  - **For crypto**: OKX and Bybit are **not** confirmed tenants; HashKey and OSL are licensed but are smaller-scale.

**Foreign-client KYC**: SUNeVision is SEHK-listed, English contracts, international wire. iAdvantage is used by multinational + China-cross-border firms.

**Confidence: HIGH** (SUNeVision primary, Sun Hung Kai Properties, Inflect pricing).

#### 3.2.3 NTT Communications Hong Kong (HK-1, HK-2)

NTT operates two Hong Kong data centers (HK-1 in Tsuen Wan, HK-2 elsewhere) and is the dominant APAC transit provider (NTT Communications global IP backbone). The HK DCs are primarily NTT's own backbone infrastructure + colocation for select enterprise customers.

**Pricing**: Quote-only. Inferred ~$400-600/kVA based on NTT's APAC position relative to Equinix and SUNeVision.

**Tenancy / crypto adjacency**: NTT's backbone is used by many crypto firms for cross-region routing, but NTT HK DCs are not a known crypto-tenant hub.

**Confidence: MEDIUM** (no public retail pricing).

#### 3.2.4 China Telecom Global (CTG) — Tseung Kwan O Data Centre

**Source**: Cushman & Wakefield APAC Data Centre Update H2 2024

**Footprint**: **Tseung Kwan O Data Centre** — 14MW phase-1 / **84 MW total**, U/C phases through 2026-2028.

**Pricing**: Quote-only, wholesale. Predominantly China-cross-border.

**Tenancy / crypto adjacency**: China Telecom is on-net at MEGA-i (via iAdvantage carrier ecosystem), but its own TKO DC is for state-linked + cross-border China customers. **Crypto tenancy is uncertain** — the China-link raises political risk for Western retail crypto colocators.

**Confidence: LOW** (no public retail pricing; China-link raises risk).

#### 3.2.5 Other HK operators (summary)

- **China Mobile (Sha Tin Fo Tan Data Centre)** — 10MW / 40MW total, U/C. Predominantly mainland-link.
- **AirTrunk (HKG1 Tsuen Wan + HKG2 Sha Tin)** — 4MW/20MW + 6MW/15MW, U/C 2025-2026. Wholesale hyperscale.
- **Vantage Data Centers (HKG5 Tsuen Wan)** — 12MW/48MW, U/C 2026.
- **Mapletree (Mapletree TM Fanling)** — 25MW/50MW, U/C 2025.
- **Chinachem Group (Tung Chung DC)** — 31MW/31MW, planned 2027.
- **DayOne (erstwhile GDS) HK1-6** — Tsuen Wan/Kwai Chung cluster, multi-phase, 16-50MW each, U/C 2025-2027.
- **TGT Towngas Telecom** — smaller carrier-neutral SG/HK operator.

### 3.3 Hong Kong — side-by-side table

| Vendor | Facility | 1U $/mo | kVA pricing | Full rack $/mo (5kW) | AWS DX | Crypto adjacency | Confidence |
|---|---|---|---|---|---|---|---|
| **Equinix HK1** (Tsuen Wan, Tier-4+) | retail/financial | quote | **$618/kVA** | ~$3,090 | YES to ap-east-1 | None public | HIGH (3rd-party kVA data) |
| **Equinix HK2** (Sha Tin) | retail/financial | quote | **$500/kVA** | ~$2,500 | YES to ap-east-1 | None public | HIGH |
| **SUNeVision MEGA-i** (Chai Wan, 30 storey) | carrier hotel | **$182** (reseller) | quote | ~$2,000-3,000 (est) | partner | **9 submarine cables**, China cross-border | HIGH |
| **SUNeVision MEGA IDC** (TKO, 50MW live, +180MW) | wholesale + retail | quote | quote | quote | partner | New, large hyperscale tenants | MEDIUM |
| **NTT HK-1** (Tsuen Wan) | telco | quote | ~$400-600 (est) | ~$2,000-3,000 (est) | YES (NTT own backbone) | Backbone transit | MEDIUM |
| **China Telecom TKO** | wholesale China-link | n/a | quote | quote | partner | China-link, state | LOW (for retail crypto) |
| **AirTrunk HKG1/2** | wholesale hyperscale | n/a | quote | n/a (multi-MW) | partner | AI / cloud | LOW (for retail) |
| **Vantage HKG5** | wholesale hyperscale | n/a | quote | n/a | partner | AI / cloud | LOW (for retail) |

**Notes on the table**:
- HK per-kVA pricing is **2-3× higher per physical kW than Tokyo** (Equinix HK1 $618/kVA vs Equinix TY3 ~$498/kVA per Agent 1's third-party source) — HK's land/energy scarcity shows up directly.
- HK **does not** have a same-tenant density for crypto as Equinix SG3 has for AWS Singapore; HK is more a **carrier-hub + China-cross-border** market.
- **For bybit.eu specifically**: HK colo cannot get below ~54 ms to bybit.eu matching in AWS Singapore (Arbitron). HK is a NO-GO for bybit.eu latency-arb.

### 3.4 Hong Kong crypto venue presence

- **OKX** — primary matching in **Alibaba Cloud HK (cn-hongkong)**, was AWS HK before May 2022. **OKX is scheduled to migrate matching to Tokyo end of July 2026** (per OKX official announcement: https://www.okx.com/help/okx-trading-server-migration-announcement-hong-kong-tokyo). This is a major upcoming change — HK colo for OKX becomes obsolete post-July 2026.
- **BitMart** — closest to Hong Kong per Arbitron (~22ms from ap-east-1).
- **HashKey Exchange** (Hash Blockchain Limited) — SFC Type 1+7 + AMLO licensed since Nov 2022. Licensed for retail since Aug 2023. First to be approved for staking services (April 2025). **AUM >HK$10B, 2024 trading volume >HK$600B, +160% YoY**. (Source: https://www.hashkey.com/en-US/news/newsroom/20250410 ; https://news.dayoo.com/finance/202501/17/171077_54776585.htm)
- **OSL Digital Securities** (OSL Exchange) — SFC licensed since Dec 2020. First VATP under AMLO. OSL Group (SEHK: 00863) publicly listed.
- **Bybit** — no primary HK PoP; DR backup since Q2 2024.
- **OKX, Binance, Kraken, Gate.io, MEXC, Huobi, Coinbase, Bitget** — applied but **did not all complete the licensing process by 29 Feb 2024 deadline**; those that didn't were forced to close HK business by 31 May 2024. (Source: https://www.caproasia.com/2024/03/06/...)
- **OKX withdrew its SFC license application** (per DL News). (Source: https://www.dlnews.com/articles/markets/how-the-departure-of-okx-will-impact-hong-kong-crypto-scene/)
- As of end-2024, **7 VATPs are licensed under AMLO + SFO Type 1+7**: OSL, HashKey, plus 5 "deemed applicants" approved via fast-track in Dec 2024. (Source: https://www.legco.gov.hk/yr2023/english/hc/sub_com/hs01/papers/hs0120250121cb1-55-1-e.pdf)

---

## 4. RTT analysis — from SG/HK to crypto venue matching

### 4.1 Bybit matching (AWS ap-southeast-1, Singapore)

| Origin | Method | RTT | Source |
|---|---|---|---|
| **AWS ap-southeast-1 (same region, EC2)** | Arbitron REST | **~16 ms** | https://arbitron.app/learn/bybit-server-location |
| **AWS ap-southeast-1 (same region, WebSocket)** | Arbitron | **~1-3 ms (estimated WebSocket faster than REST)** | inference from REST baseline |
| **Equinix SG3 → AWS ap-southeast-1 (AWS DX 1G)** | inferred | **~1-3 ms** (same AWS region via Direct Connect) | https://docs.equinix.com/fabric-marketplace/connecting-to-service-provider/aws/direct-connect-overview |
| **Equinix SG3 → Bybit matching via AWS DX + AWS ap-southeast-1 (WebSocket)** | best-case physical | **~2-5 ms RTT** | synthesis |
| Public internet from SG3 to Bybit REST | Arbitron | ~16-25 ms | Arbitron |
| **AWS Hong Kong ap-east-1 → Bybit** | Arbitron REST | **~54 ms** | https://arbitron.app/learn/bybit-server-location |
| Equinix HK1/HK2 → Bybit (via HK internet + trans-Pacific) | inferred | **~60-80 ms** | synthesis |
| Equinix TY11 (Tokyo) → Bybit (cross-region) | Arbitron | **~91 ms** | Agent 2 confirmed |
| Cable physics floor (ASE undersea cable, 5,300 km) | theoretical | **~53 ms one-way, ~63-67 ms RTT** | NTT/ASE specs |

**Key insight**: **Singapore colo brings bybit.eu into the 2-5 ms regime — within the cross-venue arb envelope.** Tokyo is permanently stuck at 85-95 ms. The 17-40× latency improvement is the entire business case.

### 4.2 OKX matching (Alibaba Cloud HK cn-hongkong, until end of July 2026)

| Origin | Method | RTT | Source |
|---|---|---|---|
| **AWS ap-east-1 (HK, EC2)** | Arbitron REST | **~35 ms** | https://arbitron.app/learn/okx-server-location |
| **OKX private line from Singapore** | GitHub njv74841 | **~6-14 ms** (private network from Singapore) | https://github.com/njv74841/okx-api-server-location |
| **Alibaba Cloud HK from public internet (any origin)** | inferred | **~5-50 ms depending on location** | synthesis |
| Equinix HK1/HK2 → OKX matching (Alibaba Cloud HK) | best-case | **~3-10 ms** if direct cross-connect to Alibaba Cloud HK | synthesis |
| AWS ap-southeast-1 (Singapore) → OKX | Arbitron REST | **~116 ms** (long route via AliCloud private network) | Arbitron |
| **OKX migration to Tokyo (end of July 2026)** | OKX official | moves to ap-northeast-1 | https://www.okx.com/help/okx-trading-server-migration-announcement-hong-kong-tokyo |

**Key insight**: **HK colo currently viable for OKX (~35 ms REST, possibly 5-10 ms with private line).** But this is **time-limited** — OKX is migrating matching to Tokyo end of July 2026 (6 weeks from now), at which point **HK colo for OKX becomes obsolete and only Tokyo colo works**.

### 4.3 Binance Spot matching (AWS ap-northeast-1, Tokyo)

| Origin | Method | RTT | Source |
|---|---|---|---|
| **AWS ap-northeast-1 (Tokyo, EC2)** | Arbitron | **~23 ms** | https://arbitron.app/learn/crypto-exchange-server-locations |
| Equinix SG3 → Binance (cross-region) | Arbitron | **~70-90 ms** (cross-region) | Agent 2 confirmed |
| Equinix HK1/HK2 → Binance (cross-region) | inferred | **~50-60 ms** | synthesis |

**Key insight**: **For Binance Spot, Tokyo colo remains the only viable option.** HK/SG colo cannot get below 50-90 ms to Binance matching.

### 4.4 Hyperliquid matching (AWS ap-northeast-1, Tokyo)

| Origin | Method | RTT | Source |
|---|---|---|---|
| **AWS ap-northeast-1 (Tokyo, EC2)** | Arbitron / Binance Square | **~2-3 ms RTT** (single-digit) | https://www.binance.com/en/square/post/307123585625377 |
| Equinix SG3 → Hyperliquid (cross-region) | inferred | **~70 ms** | synthesis |
| Equinix HK1/HK2 → Hyperliquid (cross-region) | inferred | **~50 ms** | synthesis |

**Key insight**: Hyperliquid is **even more Tokyo-bound than Binance** — single-digit RTT from AWS Tokyo. SG/HK colo = no advantage.

### 4.5 Cross-venue arbitrage from Singapore colo (the only viable SG structure)

| Arb pair | Both legs in SG? | SG colo to leg 1 | SG colo to leg 2 | Realistic? |
|---|---|---|---|---|
| bybit.eu (SG) ↔ Phemex (SG) | YES (both AWS ap-southeast-1) | ~2-5 ms | ~2-5 ms | **YES — both single-digit ms** |
| bybit.eu (SG) ↔ Coinbase (SG) | YES (Coinbase is also in ap-southeast-1 per Arbitron) | ~2-5 ms | ~2-5 ms | YES |
| bybit.eu (SG) ↔ Binance Spot (Tokyo) | NO (Binance in Tokyo) | ~2-5 ms | ~70-90 ms | NO — asymmetric latency |
| bybit.eu (SG) ↔ OKX (HK, until July 2026) | NO (OKX in HK) | ~2-5 ms | ~6-14 ms private / 35 ms public | **YES via OKX private line** |
| bybit.eu (SG) ↔ OKX (Tokyo, after July 2026) | NO | ~2-5 ms | ~70-90 ms | NO |

**Key insight**: **From Singapore, the only viable cross-venue arb pairs in 2026 are within AWS ap-southeast-1 itself (Bybit ↔ Phemex ↔ Coinbase)**. Cross-venue Tokyo-Singapore arb remains latency-asymmetric, and OKX HK is the only Asian outside-SG venue with acceptable latency, but is time-limited.

---

## 5. Regulatory landscape — SG MAS + HK SFC for a Hungarian personal trader

### 5.1 Singapore (MAS)

**Key regulatory facts (post-30 June 2025 DTSP regime)**:

- **Payment Services Act 2019 (PS Act)** regulates digital payment token (DPT) services in Singapore. **34 institutions** licensed as of July 2025, including Coinbase, OKX, Kraken, BitGo.
- **Financial Services and Markets Act 2022 (FSM Act) Part 9 — Digital Token Service Providers (DTSPs)** came into effect **30 June 2025**. From that date, **DTSPs providing services solely to customers outside Singapore relating to digital payment tokens OR tokens of capital market products must be licensed** under FSM Act.
  - **$250,000 SGD minimum base capital** ($185,000 USD).
  - **$10,000 SGD annual license fee** ($7,400 USD).
  - **MAS "will generally not issue" a license** for offshore-only DTSP; "set the bar high" because of money-laundering risk and supervision limits.
  - **No transitional period**: unlicensed providers must **cease operations by 30 June 2025**.
  - **Penalty: fine up to $250,000 SGD and/or jail term**.
  - This is what caused **Bybit + Bitget to exit Singapore** in 2025.
- **Binance's clever workaround**: Binance keeps "remote workers in Singapore" but no SG office providing regulated services. (Source: https://www.businesstimes.com.sg/companies-markets/binance-stays-and-tokenize-leaves-singapores-crypto-sector-seeing-change)

**Hungarian personal trader placing colo in SG — does MAS DTSP apply?**

**NO.** The DTSP regime applies to **persons carrying on a business of providing digital token services to customers** (i.e., exchanges/brokers/OTC desks serving third parties). A Hungarian individual colocating a server in Singapore to **trade on their own account** is:
- NOT a "digital token service provider" (DTSP) — they are not providing services to others.
- NOT subject to PS Act MPI/SPI licensing (which is for the exchange, not the trader).
- NOT subject to FSM Act DTSP licensing.

The MAS regime is **exchanges-only**, not traders. A Hungarian individual colocating in SG to trade bybit.eu is a **passive consumer of the exchange's service**, not a regulated entity.

**However, the colocation itself has Singapore-entity requirements**:
- Most Singapore DC vendors (Equinix, STT GDC, 1-Net) accept **foreign direct contracts** for retail colocation. The Hungarian individual would need to:
  - Open a USD wire account (no SG bank account required for colocation payment).
  - Sign an English-language MSA.
  - Provide a foreign passport + KYC documents.
- No Singapore business entity (Singapore Pte Ltd) is required for **retail colocation** under Singapore law.
- The DC vendor itself may require a **local billing entity** for invoicing if not Equinix/STT (some smaller vendors are pickier).

**Tax**: Singapore does **not have a capital gains tax**. There is **no personal income tax on crypto trading gains for a non-SG-resident non-citizen**, provided the trader does not become SG tax resident (183-day presence in a calendar year, or permanent establishment). For a Hungarian individual remotely managing a SG colo, this is generally not triggered if they are physically present <183 days/year. (Source: https://www.iras.gov.sg/)

**Confidence: HIGH** (MAS primary docs + the precedent of Bybit/Bitget exit).

### 5.2 Hong Kong (SFC)

**Key regulatory facts (post-1 June 2023 AMLO + SFO regime)**:

- **Securities and Futures Ordinance (SFO, Cap. 571)** regulates Type 1 (dealing in securities) and Type 7 (automated trading services) — applicable to security-token exchanges.
- **Anti-Money Laundering and Counter-Terrorist Financing Ordinance (AMLO, Cap. 615)** introduced a **licensing regime for Virtual Asset Trading Platform (VATP) operators** effective **1 June 2023**.
- **SFC requires dual licensing**: Type 1+7 under SFO + VATP under AMLO, for centralized VATPs operating in HK or actively marketing to HK investors.
- **Application fees**: $4,740 HKD per regulated activity (~$610 USD).
- **Pre-existing VATPs** had to apply by 29 Feb 2024 and be deemed-licensed by 31 May 2024, or close HK business.
- **As of end-2024**: 7 VATPs licensed (OSL, HashKey, + 5 deemed-approved Dec 2024). 11 applications still being processed.
- **OKX withdrew its SFC license application** (DL News).
- **Bybit has no HK VATP license** and uses HK only for DR.

**Hungarian personal trader placing colo in HK — does SFC VATP apply?**

**NO.** The VATP regime applies to **operators of centralized virtual asset trading platforms carrying on business in HK or actively marketing to HK investors**. A Hungarian individual colocating a server in HK to trade bybit.eu is:
- NOT a VATP operator (no exchange, no customers, no intermediation).
- NOT subject to SFC Type 1+7 licensing.
- NOT subject to AMLO VATP licensing.

**However, the colocation itself has HK-entity requirements**:
- HK DCs (Equinix HK, SUNeVision iAdvantage, NTT HK) accept **foreign direct contracts** for retail colocation. Same as SG: foreign passport + KYC + wire.
- **No HK business entity (HK Ltd) is required for retail colocation** under HK law for personal use.
- SUNeVision iAdvantage is the most **foreign-friendly** of the HK DC operators due to its SHKP parent.

**Tax**: HK has **no capital gains tax**, no VAT/GST, no withholding tax on foreign-source income. Personal income tax (salaries tax) is on HK-sourced employment income only. A Hungarian individual managing a HK colo remotely is **not subject to HK salaries tax** if they are not physically working in HK. (Source: https://www.ird.gov.hk/)

**Confidence: HIGH** (SFC primary docs + LegCo Paper 2024-2025).

### 5.3 Why neither jurisdiction blocks the Hungarian trader

Both Singapore MAS and Hong Kong SFC regulate **service providers** (exchanges, brokers, OTC desks), not **end-users / individual traders**. A Hungarian personal trader colocating a server in SG or HK is:
- A consumer of an exchange's service (bybit.eu in Austria).
- A retail colo customer of the DC vendor.
- Neither regulated entity.

The **regulatory perimeter** for the Hungarian individual is **Hungarian SZJA + EU MiCAR** (already covered by Agent 5), not SG MAS or HK SFC. The only SG/HK touches are:
- KYC at the DC vendor (foreign passport + proof of address).
- Payment via international wire.
- No local entity required.

**This is a fundamental finding: Singapore and Hong Kong are both regulatorily OPEN to a Hungarian personal trader colocating a server, provided the trader does not become a Singapore/HK tax resident (183-day rule) and does not provide crypto services to others.**

---

## 6. Japanese broker presence in Singapore (the cross-venue angle)

**Key finding**: **No major Japanese crypto broker has a Singapore retail operation.**

| JP broker | HQ | Singapore presence? | Notes |
|---|---|---|---|
| **bitFlyer** | Tokyo (HQ at Tokyo Midtown) | **No SG office.** Has NYDFS BitLicense (US) + CSSF (Luxembourg) for EU. | Largest JP exchange by volume; not cross-border to SG. |
| **GMO Coin** | Shibuya, Tokyo (Shibuya Fukuras, 9-16F) | **No SG office.** Parent GMO Internet Group explored UK app launch in 2018, no SG. | 4th JP exchange; -0.01% maker fees; parent GMO Internet Group has broader cloud business but no SG crypto arm. |
| **Coincheck** | Tokyo (planning NASDAQ via SPAC 2025) | **No SG office.** | Monex Group subsidiary. |
| **bitbank** | Tokyo | **No SG office.** Supports foreign corporate account opening at JP level (multilingual). |  |
| **Binance Japan** | Tokyo (via SEBC acquisition 2022-2023) | **No SG operation.** SG is operated by separate Binance.com entity with remote workers. |  |
| **OKJ (OKCoin Japan)** | Tokyo | **No SG operation.** | Separate from OKX global. |
| **SBI VC Trade** | Tokyo (SBI Holdings subsidiary) | **No SG office.** |  |
| **Liquid (QUOINE)** | Tokyo | **No SG office.** |  |

**Source**: https://www.163.com/dy/article/J5PO0L1D05248UCQ.html (Tencent article on JP crypto firms); https://group.gmo/en/company-profile/groupinfo/ ; https://assetlog.jp/en/2026/05/09/best-crypto-exchanges-japan-2026/ ; https://thekingfisher.io/ja/blogs/crypto-exchanges-japan-2026

**Implication for the "Japanese broker with Singapore presence" angle (the brief asked for ja-language research on this)**: **The angle is empty.** No major Japanese crypto broker operates in Singapore. The 2024-2026 wave of Japanese crypto firms **choosing Japan as the offshore destination** (not Singapore) is a market signal: Singapore's MAS tightening has made Tokyo + JP more attractive for crypto firms, not less.

**Cross-border JP-SG routing for cross-venue arb**: If the strategy were "trade bitFlyer Lightning (Tokyo) + bybit.eu (SG) cross-venue", the Japanese broker doesn't have a SG presence, so the trader would still colocate in SG for the bybit.eu leg. The JP leg is best served from Tokyo colo (for the bybit.eu-equivalent JP exchange: bitFlyer, GMO Coin) — but **bitFlyer's matching is at AWS ap-northeast-1 (Tokyo)**, not in any SG presence.

---

## 7. Recent (2024-2026) capacity changes — SG + HK

### 7.1 Singapore capacity (2024-2026)

- **Equinix SG6**: announced Nov 2024, $260M, 9-storey, **20 MW liquid-ready, RFS Q1 2027**.
- **Equinix SG3 expansion**: final phase completed 2024, $78M, +2,875 cabinets → 5,875 total.
- **Keppel DC**: acquired 2 Genting Lane hyperscale AI DCs ($1.07B S$ / $795M USD), + S$310M contingent, **SG DC count rises to 8**.
- **AWS Singapore**: **$12B SGD ($8.9B USD) 5-year investment** announced May 2024 for expansion.
- **SingTel + NVIDIA**: AI infrastructure partnership at DC Tuas, RFS 2026.
- **Singapore total capacity**: **1.4 GW across 70+ facilities, 900+ MW hyperscale (50+ facilities)**.
- **Singapore government Green Data Centre Roadmap**: 300 MW additional capacity added in 2024.
- **Moratorium 2019-2022 lifted**, but new builds require **PUE <1.3** and **sustainability gates**.

**Implication**: Singapore is **expanding capacity aggressively** but the **expansion is hyperscale/AI-anchored, not retail-colo-anchored**. Retail colo at Equinix SG3 is not getting cheaper; it may get more expensive as hyperscalers compete for power.

### 7.2 Hong Kong capacity (2024-2026)

- **HK total capacity**: **588.3 MW operational (Q4 2024), +63 MW available, 392 MW under construction, 64 MW planned**.
- **SUNeVision MEGA IDC Phase 2**: 45 MW phase / 180 MW total, U/C 2026. Anchor tenants: major cloud + banks.
- **Equinix HK6 (Tsuen Wan)**: 6MW / 70 MW total, U/C 2026.
- **AirTrunk HKG1/2 (Tsuen Wan + Sha Tin)**: 4-6 MW / 15-20 MW total, U/C 2025-2026.
- **China Mobile Sha Tin Fo Tan**: 10 MW / 40 MW total, U/C 2025.
- **China Telecom TKO**: 14 MW / 84 MW total, U/C 2026-2028.
- **Vantage HKG5 Tsuen Wan**: 12 MW / 48 MW total, U/C 2026.
- **Mapletree TM Fanling**: 25 MW / 50 MW total, U/C 2025.
- **Sandy Ridge 10-hectare I&T site**: tender awarded March 2026, future DC cluster.
- **DayOne HK1-6 (Tsuen Wan/Kwai Chung)**: 16-50 MW each, U/C 2025-2027.
- **Chinachem Tung Chung**: 31 MW, planned 2027.
- **HK Buildings Energy Efficiency Bill amendment** (Aug 2025): PUE reporting + energy audits for DCs under Climate Action Plan 2050.
- **HK colocation vacancy**: 19% in H1 2025 (down from 21% in H2 2024).

**Implication**: HK has **massive new capacity coming 2025-2027** (700 MW pipeline) but **colocation pricing has not yet dropped** because the new capacity is **wholesale/AI-grade**, not retail. Retail colocation at Equinix HK1/HK2 is likely to remain expensive for the next 12-24 months. SUNeVision iAdvantage MEGA-i is the most retail-friendly option.

### 7.3 The "Singapore spillover" effect (CBRE H2 2024)

- **Singapore has <4 MW available** for new retail colo (post-moratorium). Vacancy <2% historically.
- **HK + Malaysia (Johor Bahru) + Indonesia (Batam) are absorbing spillover** from Singapore.
- **Equinix SG6** is the first new SG IBX since the moratorium was lifted.
- For a Hungarian trader, this means **timing**: if they delay SG colo by 6-12 months, they may face **higher prices** (Equinix SG6 will be liquid-cooling AI-grade, premium pricing).

---

## 8. Top 3 recommendations (per the brief's termination criterion)

### 8.1 Recommendation 1: Equinix SG3 (Singapore) — for bybit.eu recovery from the Tokyo NO-GO

**Rationale**: Equinix SG3 is the **only realistic venue** for a Hungarian personal trader to recover bybit.eu latency-arb after Agent 2's NO-GO finding on Tokyo. The bybit.eu matching engine is in AWS ap-southeast-1 (same AWS region as Equinix SG3's AWS Direct Connect on-ramp), and the cross-region signature (91 ms from AWS Tokyo to Bybit) becomes **same-region** (~1-5 ms via AWS Direct Connect) from Singapore.

**All-in monthly cost (estimated, low-budget retail)**:
- 1U at Equinix SG3 (reseller, e.g., NewMedia Express): S$406.60 ≈ **US$300/mo**
- Equinix Fabric 1G port: US$150/mo
- AWS Direct Connect 1G Hosted Connection (ap-southeast-1): US$148/mo (port) + usage
- 1 cross-connect to AWS: US$200/mo + $500 install
- Cross-connect to 1-2 crypto exchanges / IX (SGIX): US$200-400/mo
- **Total: ~US$1,000-1,200/mo for a 1U/1G AWS DX package at Equinix SG3**

This is **~30-50% more expensive than a comparable Tokyo package** (Agent 1: GMO Cloud 1U/100Mbps ¥12,100 + AWS DX ¥72,600 = ~US$560/mo, but Tokyo has no bybit.eu PoP so it's not viable).

**All-in for a 5kW half-rack at Equinix SG3** (more conservative, real HFT):
- Half rack (5kVA, AWS DX 1G, 1 cross-connect, smart hands): **~US$2,500-3,500/mo** (SGD 3,400-4,700)
- + AWS DX 1G: ~US$350/mo
- + Cross-connects (2-3): ~US$600-900/mo
- **Total: ~US$3,500-4,800/mo**

**Verdict**: Equinix SG3 is **the right venue** for bybit.eu latency-arb in 2026, but the **monthly cost is 2-3× the Tokyo GMO Cloud 1U package**, and Singapore's pricing is rising (CBRE H2 2025: $310-470/kW/mo). The thesis is viable ONLY if the **edge from <1ms RTT to bybit.eu covers the SG colo premium**.

### 8.2 Recommendation 2: Equinix HK1 / SUNeVision MEGA-i (Hong Kong) — for OKX or cross-venue HK-to-SG arb (time-limited)

**Rationale**: Equinix HK1 ($618/kVA Tier-4+) and SUNeVision MEGA-i (200+ carriers, 9 submarine cables) are the only HK venues with the carrier density to route to OKX's Alibaba Cloud HK matching at <50 ms. **This is time-limited**: OKX is migrating matching to Tokyo end of July 2026, after which HK colo for OKX becomes obsolete.

**All-in monthly cost (5kW cabinet)**:
- Equinix HK1 (5kVA at $618/kVA): ~US$3,090/mo power + ~US$300 cross-connect + ~US$150 Fabric port = **~US$3,540-4,000/mo**
- SUNeVision MEGA-i (5kW via reseller): ~US$2,000-3,000/mo + cross-connect

**Verdict**: HK colo is a **secondary, time-limited play**. Only valid if (a) OKX HK matching is still active (before end-July 2026), and (b) the cross-venue HK-SG arb is a documented strategy. After OKX migrates to Tokyo, HK colo for crypto is **dead** (no other major exchange matches in HK; only HashKey + OSL at retail scale, which are tiny).

### 8.3 Recommendation 3: 1-Net Singapore (budget SG alternative) — for a smaller-footprint trader

**Rationale**: 1-Net's full rack at S$1,350/mo (US$1,000) is **~2.5× cheaper than Equinix SG3** for a small footprint (2-3 kVA). The trade-off is **lower power density** (2-3 kVA vs 5 kVA at Equinix) and **fewer cross-connect options** (no Equinix Fabric, no Equinix IX; partner-based AWS DX only). For a low-budget retail strategy that does NOT need HFT-grade co-located matching, 1-Net is a viable option.

**All-in monthly cost (1-Net Data Center 2 full rack)**:
- Full rack: S$1,350/mo ≈ US$1,000/mo
- + AWS DX via partner: US$200-500/mo
- + Cross-connect: US$100-300/mo
- **Total: ~US$1,300-1,800/mo**

**Verdict**: 1-Net is the **budget Singapore option** but **not viable for HFT-grade bybit.eu cross-venue arb** (insufficient cross-connect density to AWS ap-southeast-1, lower power density, longer network path to AWS matching). For a **mid-frequency strategy** (1-10 second holding) with $10k capital, 1-Net may be acceptable.

---

## 9. The bybit.eu vs other-venue strategic question

The fundamental strategic question for Phase 14E is: **is bybit.eu the right venue to build a colocation strategy around?**

- **Pro bybit.eu**: Project's primary venue, MiCAR-compliant EU, established data paths, user directive.
- **Con bybit.eu**: Matching is in **AWS ap-southeast-1 Singapore**, not Tokyo, so **Tokyo colo is structurally NO-GO**. SG colo recovers viability but adds cost.

The Agent 8 alternative is to consider **switching primary venue** to one whose matching IS in Tokyo (8 of 10 top exchanges per Agent 2):
- **Binance Spot** (AWS ap-northeast-1, ~23 ms RTT from AWS Tokyo) — but Binance.eu is not MiCAR-licensed.
- **Bitget** (AWS ap-northeast-1, ~16 ms from AWS Tokyo) — Bitget EU under MiCAR but smaller volume.
- **Gate.io** (AWS ap-northeast-1, ~16 ms) — no EU entity, no MiCAR.
- **KuCoin** (AWS ap-northeast-1, ~19 ms) — KuCoin EU under MiCAR in some jurisdictions, smaller volume.
- **Hyperliquid** (AWS ap-northeast-1, ~2-3 ms — single-digit!) — **on-chain perps**, no MiCAR wrapper needed for the venue, but counterparty risk is on-chain smart contract.

**Cross-venue consideration for Singapore colo from Agent 8**:
- bybit.eu (SG matching) ↔ Phemex (SG matching) = **both <5 ms** — viable cross-venue arb from SG
- bybit.eu (SG) ↔ Coinbase (SG, ap-southeast-1) = **both <5 ms** — viable (Coinbase has no EU license; would need to assess counterparty)
- bybit.eu (SG) ↔ Binance Spot (Tokyo) = **asymmetric 2-5ms vs 70-90ms** — NOT viable for symmetric arb

**If Phase 14E proceeds with SG colo**, the strategy narrows to:
- **Bybit-EU / Phemex / Coinbase cross-venue arb from SG (3-5 ms symmetric)** — but volume on Phemex is small and Coinbase has no EU license.
- **Bybit-EU as primary venue with sub-5ms RTT to matching** — the original 5-10%/mo thesis, but the SG colo cost premium eats into edge.

**If Phase 14E is parked**, the bybit.eu latency-arb thesis is **infeasible at 1:10 retail leverage from any colo in 2026** because:
- Tokyo colo: 85-95 ms to bybit.eu matching (NO-GO).
- SG colo: 2-5 ms to bybit.eu matching, but $3,500-4,800/mo cabinet cost (or $1,000-1,800/mo at 1-Net budget tier) — edge must clear this.
- HK colo: 54 ms to bybit.eu matching (NO-GO).

---

## 10. Confidence ratings per claim

| Claim | Confidence | Basis |
|---|---|---|
| bybit.eu matching in AWS ap-southeast-1 Singapore (ap-se1-az2/az3) | **VERY HIGH** | Agent 2 confirmed: 4 sources (Bybit FAQ, Tardis, BTCC ja, Arbitron latency 16 ms) |
| Bybit has no Tokyo PoP | **VERY HIGH** | Agent 2 confirmed: contradiction of 4+ sources |
| Singapore colo → bybit.eu matching is 2-5 ms via AWS DX | **HIGH** | Synthesis: Arbitron 16 ms from AWS ap-southeast-1 EC2 + Equinix Fabric 1-3 ms + AWS DX on-ramp = same-region |
| Equinix SG3 full-rack pricing = SGD 3,500-8,000/mo (US$2,600-5,900) | **HIGH** | RebootMonkey + Equinix reseller published rates; CBRE H2 2025 confirms $310-470/kW/mo |
| Equinix HK1 = $618/kVA, HK2 = $500/kVA | **HIGH** | 3rd-party published (edcl.io, Catixs) |
| SUNeVision MEGA-i = 30-storey, 200+ carriers, 9 submarine cables | **HIGH** | iAdvantage + Sun Hung Kai Properties primary sources |
| OKX matching in Alibaba Cloud HK, not Equinix HK | **HIGH** | GitHub njv74841 + Arbitron + OKX's own 2020 tweet + OKX migration announcement |
| OKX migrating matching to Tokyo end of July 2026 | **HIGH** | https://www.okx.com/help/okx-trading-server-migration-announcement-hong-kong-tokyo (official) |
| Singapore MAS DTSP regime effective 30 June 2025, Bybit/Bitget exit | **VERY HIGH** | MAS primary, Binance Square, CNA, Bloomberg |
| HK SFC VATP regime: 7 licensed as of end-2024, OKX withdrew | **HIGH** | SFC primary, Caproasia, DL News, LegCo |
| Hungarian individual colocating in SG/HK is NOT a MAS DTSP / SFC VATP | **HIGH** | Statute text (PS Act §137, AMLO §53ZRK) + regulatory perimeter reading |
| No major Japanese crypto broker has Singapore presence | **MEDIUM** | 10+ sources checked; only confirmed absence of SG office, but not exhaustive for every JP crypto firm |
| HK data center capacity 588 MW + 700 MW pipeline | **HIGH** | Cushman & Wakefield H2 2024 + JLL + Mordor Intelligence + Zaobao 2025-01-05 |
| Singapore wholesale build cost $13.80/W, 1.4 GW total capacity | **HIGH** | Mordor + Zaobao + multiple market reports |
| 1-Net full rack S$1,350/mo (US$1,000) | **HIGH** | SimplerCloud reseller published rate |
| Ascenix 1U S$203/mo (US$150) | **MEDIUM** | NewMedia Express reseller, Ascenix web presence minimal |

---

## 11. Sources

### 11.1 Singapore colocation (vendor primary)

| URL | Language | Use | Confidence |
|---|---|---|---|
| https://www.equinix.com/data-centers/asia-pacific-colocation/singapore-colocation | en | Equinix SG cluster | HIGH |
| https://www.equinix.com/data-centers/asia-pacific-colocation/singapore-colocation/singapore-data-center/sg3 | en | SG3 specs | HIGH |
| https://investor.equinix.com/news-events/press-releases/detail/610/equinix-announces-significant-expansion-to-increase-data | en | SG3 expansion | HIGH |
| https://newsroom.equinix.com/2024-11-19-Equinix-to-Help-Accelerate-AI-Innovation-in-Singapore-with-US-260-Million-Data-Center-Expansion | en | SG6 announcement | HIGH |
| https://www.equinix.com/data-centers/expansions | en | SG6 RFS Q1 2027 | HIGH |
| https://www.sttelemediagdc.com/sg-en | en | STT GDC SG | HIGH |
| https://www.sttelemediagdc.com/services/colocation | en | STT GDC colocation | HIGH |
| https://www.businesswire.com/news/home/20260202441025/en/KKR-Led-Consortium-with-Singtel-Group-to-Fully-Acquire-ST-Telemedia-Global-Data-Centres-at-S%2413.8-Billion-Enterprise-Value | en | KKR+SingTel full acquisition S$13.8B | HIGH |
| https://1-net.com.sg/ | en | 1-Net SingTel | HIGH |
| https://1-net.com.sg/wp-content/grand-media/application/1-Net_Pocket_Brochure.pdf | en | 1-Net brochure | HIGH |
| https://www.simplercloud.com/co-location-enquiry/ | en | 1-Net reseller pricing | HIGH |
| https://website.ne.com.sg/colocation.html | en | NewMedia Express reseller (Equinix + Ascenix) | MEDIUM (reseller) |
| https://ascenix.net/ | en | Ascenix DC SG | LOW (minimal web presence) |
| https://docs.equinix.com/fabric/pricing-billing/fabric-billing-pricing/ | en | Equinix Fabric pricing | HIGH |
| https://docs.equinix.com/cross-connect/xc-pricing-billing-terms/ | en | Cross-connect pricing | HIGH |
| https://docs.equinix.com/fabric-marketplace/connecting-to-service-provider/aws/direct-connect-overview | en | AWS DX at Equinix | HIGH |
| https://www.mordorintelligence.com/industry-reports/singapore-hyperscale-data-center-market | en | SG hyperscale market | HIGH |
| https://datacenternews.asia/story/equinix-announces-expansion-of-its-largest-asia-pacific-data-centre | en | SG3 final phase $78M | HIGH |
| https://colomap.com/facilities/equinix-sg3/ | en | SG3 182 networks | HIGH |
| https://www.rebootmonkey.com/en/colocation/singapore | en | SG rack rates | MEDIUM |
| https://www.quape.com/colocation-data-center-singapore/ | en | SG colocation landscape | MEDIUM |
| https://www.vendr.com/marketplace/equinix | en | Equinix cross-connect pricing | HIGH |

### 11.2 Hong Kong colocation (vendor primary)

| URL | Language | Use | Confidence |
|---|---|---|---|
| https://www.equinix.com/data-centers/asia-pacific-colocation/china-colocation/hong-kong-data-centers | en | Equinix HK cluster | HIGH |
| https://www.equinix.com/data-centers/asia-pacific-colocation/china-colocation/hong-kong-data-centers/hk1 | en | HK1 specs | HIGH |
| https://support.edcl.io/help/en-us/1-server-colocation/1-in-what-data-centers-can-i-colocate-their-respective-tier-rating-and-power-price | en | HK1 $618/kVA, HK2 $500/kVA | MEDIUM (3rd-party) |
| https://colocation.docs.catixs.net/Catixs%20Colocation%20Services_a3e467f095654e77b5a9f4beb9531408/Service%20Pricing%209ee0460fad884d0991117fb183d13189 | en | HK2 per-kVA pricing | MEDIUM (3rd-party) |
| https://www.voxility.com/cross-connects/prices/Cross+Connect+from+Equinix+HK2+Hong+Kong | en | HK2 cross-connect $201.50 + $299/mo | HIGH |
| https://www.iadvantage.net/index.php/locations/mega-i | en | MEGA-i | HIGH |
| https://www.iadvantage.net/index.php/company/about | en | iAdvantage about | HIGH |
| https://www.iadvantage.net/index.php/customer-service/frequently-asked-questions | en | 200+ carriers, 9 submarine cables | HIGH |
| https://www.shkp.com/en-US/our-business/non-property-portfolio-businesses/information-technology | en | SUNeVision 1.7M sqft GFA, SHKP parent | HIGH |
| https://inflect.com/building/399-chai-wan-road-chai-wan-hong-kong/iadvantage/datacenter/iadvantage-mega-i | en | MEGA-i pricing from $182 | HIGH |
| https://cushwake.cld.bz/asiapacificdatacentreupdateh2204-02-2025-apac-regional-en-content-datacentres/12/ | en | HK APAC H2 2024 | HIGH |
| https://cushwake.cld.bz/asiapacificdatacentreupdateh2204-02-2025-apac-regional-en-content-datacentres/13/ | en | HK pipeline U/C 2025-2027 | HIGH |
| https://realestateasia.com/industrial/news/hong-kong-data-centre-market-see-gradual-recovery-over-next-6-12-months | en | HK H1 2025 19% vacancy | HIGH |
| https://www.digitalpolicy.gov.hk/en/our_work/digital_infrastructure/industry_development/data_centre/ | en | HK Sandy Ridge tender | HIGH |
| https://www.mordorintelligence.com/industry-reports/hong-kong-data-center-market | en | HK market $4.9B 2026 | HIGH |
| https://www.jll.com/en-hk/insights/market-dynamics/asia-pacific-data-centre | en | APAC 24 GW expansion 2025-2030 | HIGH |
| https://www.tmtnews.tech/archives/47153 | zh | Equinix SG6 (zh) | HIGH |

### 11.3 RTT + matching engine (cross-venue)

| URL | Language | Use | Confidence |
|---|---|---|---|
| https://arbitron.app/learn/bybit-server-location | en | Bybit RTT from 8 AWS regions | HIGH |
| https://arbitron.app/learn/okx-server-location | en | OKX RTT from 8 AWS regions | HIGH |
| https://arbitron.app/learn/crypto-exchange-server-locations | en | Cross-exchange mapping | HIGH |
| https://github.com/njv74841/okx-api-server-location | en | OKX Alibaba Cloud HK + private line | MEDIUM (GitHub source) |
| https://www.okx.com/help/okx-trading-server-migration-announcement-hong-kong-tokyo | en | OKX migration HK→Tokyo end-July 2026 | HIGH (official) |
| https://nikhilpadala.com/blog/exchange-co-location-cloud/ | en | nikhilpadala analysis (note: TY11 claim for Bybit contradicted) | LOW (single source, contradicted) |
| https://www.binance.com/en/square/post/307123585625377 | en | Hyperliquid in AWS Tokyo | HIGH |
| https://aws.amazon.com/blogs/industries/ultra-low-latency-cross-region-crypto-trading-with-avelacom-and-aws/ | en | AWS Direct Connect + Avelacom cross-region RTT | HIGH |
| https://docs.tardis.dev/historical-data-details/bybit | en | Bybit Singapore AWS | HIGH |
| https://www.btcc.com/ja-JP/amp/square/V1p3r/983543 | ja | Bybit AWS SG + HK DR (Agent 2 cited) | HIGH |
| https://latency.bluegoat.net/index.php | en | AWS inter-region latency | MEDIUM |

### 11.4 SG MAS regulatory

| URL | Language | Use | Confidence |
|---|---|---|---|
| https://www.mas.gov.sg/news/media-releases/2025/mas-clarifies-regulatory-regime-for-digital-token-service-providers | en | MAS DTSP 30 June 2025 effective | HIGH |
| https://www.mas.gov.sg/-/media/guidelines-on-licensing-for-digital-token-service-providers.pdf | en | DTSP licensing guidelines | HIGH |
| https://www.binance.com/en/square/post/26272146267193 | en | Bybit/Bitget SG exit | HIGH |
| https://www.binance.com/en/square/post/25070246341057 | en | MAS 30 June deadline | HIGH |
| https://www.ainvest.com/news/singapore-orders-unlicensed-crypto-exchanges-shut-2025-bitget-bybit-plan-exit-2506/ | en | Bybit/Bitget plan exit | HIGH |
| https://www.channelnewsasia.com/singapore/crypto-licensing-mas-cna-explains-5186446 | en | MAS 33 DPT licensed | HIGH |
| https://www.businesstimes.com.sg/companies-markets/binance-stays-and-tokenize-leaves-singapores-crypto-sector-seeing-change | en | Binance keeps remote SG workers | HIGH |
| https://www.twobirds.com/en/insights/2025/singapore/assessing-the-scope-of-part-9-of-the-financial-services-and-markets-act-2022-for-digital-token-servi | en | FSMA Part 9 scope | HIGH |
| https://new.qq.com/rain/a/20250602A04G9300 | zh | MAS 5/30 directive (zh) | HIGH |

### 11.5 HK SFC regulatory

| URL | Language | Use | Confidence |
|---|---|---|---|
| https://www.sfc.hk/en/Welcome-to-the-Fintech-Contact-Point/Virtual-assets/Virtual-asset-trading-platforms-operators/Lists-of-virtual-asset-trading-platforms | en | SFC licensed VATP list | HIGH |
| https://www.slaughterandmay.com/media/z1wjejxt/new_regulatory_requirements_for_virtual_asset_trading_platform_operators_come_into_effect_4391pdf.pdf | en | VATP regime 1 June 2023 | HIGH |
| https://www.sfc.hk/-/media/EN/assets/components/Guidelines/File-current/Licensing-Handbook-for-VATPs-31-05-2023.pdf | en | VATP licensing handbook | HIGH |
| https://www.caproasia.com/2024/03/06/hong-kong-sfc-notifies-investors-to-check-regulatory-status-of-virtual-asset-trading-platforms-operating-in-hong-kong-from-1st-march-2024-after-closure-of-application-deadline-on-29th-february-2024-p/ | en | 31 May 2024 closure | HIGH |
| https://www.legco.gov.hk/yr2023/english/hc/sub_com/hs01/papers/hs0120250121cb1-55-1-e.pdf | en | LegCo VATP 7 licensed end-2024 | HIGH |
| https://www.dlnews.com/articles/markets/how-the-departure-of-okx-will-impact-hong-kong-crypto-scene/ | en | OKX withdrew SFC | HIGH |
| https://www.hashkey.com/en-US/news/newsroom/20250410 | en | HashKey SFC staking approval | HIGH |
| https://www.pwchk.com/en/asset-management/sfc_vatp_regime_sep2023.pdf | en | PwC VATP regime | HIGH |
| https://www.davispolk.com/insights/client-update/hong-kong-permits-virtual-asset-exchanges-access-global-liquidity-and-expand | en | Dec 2025 SFC allows global liquidity | HIGH |
| https://www.gibsondunn.com/hong-kong-va-roadmap-develops-further-through-relaxation-of-liquidity-requirements-and-increased-product-diversity/ | en | SFC Nov 2025 relaxation | HIGH |
| https://news.dayoo.com/finance/202501/17/171077_54776585.htm | zh | HashKey 2024 600B HKD volume (zh) | HIGH |

### 11.6 Japanese brokers (no SG presence)

| URL | Language | Use | Confidence |
|---|---|---|---|
| https://www.163.com/dy/article/J5PO0L1D05248UCQ.html | zh | 2024-2026 JP crypto firm wave (zh) | HIGH |
| https://www.shangyexinzhi.com/article/20580430.html | zh | Base Japan crypto firms (zh) | MEDIUM |
| https://new.qq.com/rain/a/20240628A082Q400 | zh | Crypto firms in Japan wave (zh) | MEDIUM |
| https://assetlog.jp/en/2026/05/09/best-crypto-exchanges-japan-2026/ | en (jp-orig) | 2026 JP exchanges | HIGH |
| https://group.gmo/en/company-profile/groupinfo/ | en | GMO Internet Group | HIGH |
| https://www.coindaynow.com/blog/japan-bitflyer-gmo-coincheck-exchange-comparison-2026 | ko | JP exchanges 2026 | MEDIUM |
| https://thekingfisher.io/ja/blogs/crypto-exchanges-japan-2026 | en (jp-orig) | JP exchange 2026 | MEDIUM |
| https://ibuidl.org/blog/japan-crypto-exchange-comparison-2026-20260310 | en | JP exchange 2026 | MEDIUM |

### 11.7 Capacity / market (2024-2026)

| URL | Language | Use | Confidence |
|---|---|---|---|
| https://www.zaobao.com/finance/singapore/story20250105-5666238 | zh | SG DC 1.4 GW, Cushman Wakefield (zh) | HIGH |
| https://www.icspec.com/news/article-details/2390360 | zh | Equinix SG6 + Keppel acquisition (zh) | HIGH |
| https://www.financemagnates.com/cryptocurrency/news/gmo-internet-japan-launch-cryptocurrency-trading-app-uk/ | en | GMO Internet UK push 2018, no SG | HIGH |
| https://internationalinvestment.biz/en/business/6081-data-centers-in-asia-growth-driven-by-ai-and-resource-constraints.html | en | HK 588 MW Q4 2024 | HIGH |
| https://cushwake.cld.bz/asiapacificdatacentreupdateh2204-02-2025-apac-regional-en-content-datacentres/13/ | en | APAC H2 2024 pipeline | HIGH |
| https://sites.google.com/view/hong-kong-data-center-market/ | en | HK DC market projection 2034 | MEDIUM |
| https://finance.yahoo.com/news/fear-factor-troubles-data-centre-093000577.html | en | CBRE HK geopolitical concern | HIGH |
| https://www.info.gov.hk/gia/general/202406/05/P2024060500513.htm | en | HK 970K sqm + 300K new by 2026 | HIGH |
| https://www.c-fol.net/news/2_202411/20241119115621.html | zh | Equinix SG6 (zh) | HIGH |
| https://www.donews.com/news/detail/8/4615251.html | zh | Equinix SG6 (zh) | MEDIUM |
| https://m.toutiao.com/article/7438891300655268367/ | zh | Equinix SG6 (zh) | MEDIUM |

---

## 12. Termination status

**Angle EXHAUSTION on adjacent-venues (SG + HK)** — this report covers:
- Per-venue comparison (Equinix SG1/3/4/5/6, STT GDC, 1-Net, Ascenix, NTT SG, Digital Realty SG, Keppel, AirTrunk / Equinix HK1-6, SUNeVision MEGA-i/Gateway/Plus/IDC/Two, NTT HK, China Telecom, China Mobile, Vantage, Mapletree, DayOne, Chinachem, TGT).
- RTT to bybit.eu (4 measurement sources), OKX (3 sources + migration announcement), Binance Spot, Hyperliquid, Phemex, Coinbase.
- Regulatory landscape SG MAS DTSP (30 June 2025) + HK SFC VATP (1 June 2023) with primary source citations.
- Recent 2024-2026 capacity changes (Equinix SG6, SUNeVision MEGA IDC Phase 2, Equinix HK6, Sandy Ridge tender, Singapore Green Data Centre Roadmap, HK Buildings Energy Efficiency Bill).
- Japanese broker SG presence (the brief's "ja" angle): **NO major JP crypto broker has a SG retail operation** — the 2024-2026 wave of crypto firms chose **Japan as the offshore destination** (not SG), per the 腾讯/网易 articles citing 100+ crypto firms basing in Tokyo for the FX/cheap JPY/stablecoin-stability tailwinds.

**Termination criterion met**: "Per-venue comparison + recommendation if Tokyo is over-priced or regulatory-blocked" — the report explicitly documents that (a) **Tokyo is structurally NO-GO for bybit.eu** (Agent 2's RTT analysis) but the colocation-cost analysis is also provided, and (b) **SG is the only viable alternative**, with HK as a time-limited secondary for OKX.
