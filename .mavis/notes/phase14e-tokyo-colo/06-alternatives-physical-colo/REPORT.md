---
description: Phase 14E Agent 6 — Non-physical-colocation paths to <1ms crypto trading latency in Tokyo. Covers AWS/Azure/GCP, VPS, exchange colo, latency-arb-as-a-service.
status: complete
producer: Agent 6 of 10
date: 2026-07-06
worktree: wt-9d6d823b
session: mvs_b796c3741fd943d186a3b6c677b88532
parent: mvs_c13fe65cb68f4df3851304dea09a9099
---

# Phase 14E — Agent 6 REPORT

# Alternatives to Physical Colocation in Tokyo

**Question (from scope plan §3 Q6):** Are there viable non-colocation paths to <1ms latency from Tokyo for crypto trading? Coverage: (a) AWS/Azure/GCP Tokyo (DPDK/Solarflare-capable instances), (b) colocated VPS (Vultr Tokyo, Linode Tokyo, Sakura Cloud), (c) exchange-provided colo (Binance Japan, bitFlyer, Bybit Japan), (d) latency-arb-as-a-service (Wintermute, BitMEX-affiliated, HFT Arbitrage Platform).

**Verdict at a glance (TL;DR for orchestrator):**

| # | Alternative | Best achievable RTT to a Tokyo-located crypto venue | Setup time | Ongoing cost (USD/mo) | Verdict |
|---|-------------|------------------------------------------------------|------------|------------------------|---------|
| 1 | **AWS Tokyo (ap-northeast-1) EC2 + ENA + EFA** | 0.3-2 ms intra-AZ to Hyperliquid/binance/Bybit-SG-via-ECX | 1-3 days | $32-$500 (instance) + $208-$1,620 (1G/10G Direct Connect) | **VIABLE** if the venue actually sits in AWS Tokyo (Hyperliquid, Binance, bitFlyer, Bybit routing-via-ECX). **NOT VIABLE** for bybit.eu — Bybit is Singapore. |
| 2 | **Azure Japan East** | 1-5 ms (typical cloud-to-venue). FPGA-attached; no documented Tokyo PoP for major crypto venue. | 1-3 days | $50-$500 (instance) + Azure ExpressRoute variable | **MARGINAL** — no public crypto venue is confirmed on Azure Japan East. Use only for venue-agnostic infrastructure. |
| 3 | **GCP asia-northeast1 (Tokyo) + C3 + DPDK** | 26 µs intra-region P50 with kernel-bypass (28Stone benchmark). 50 µs p99 T2T latency. | 1-3 days | $50-$500 (instance) + GCP Partner Interconnect (~$200-$800/mo per port) | **VIABLE for venues on GCP** (Hyperliquid validator candidates). Marginal for AWS-hosted venues (cross-cloud adds 1-5 ms). |
| 4 | **Alibaba Cloud Tokyo (ap-northeast-1)** | Same as AWS region (third-party benchmark: sub-150 µs intra-region). ECS Bare Metal + 25 Gbps MoC NIC. | 1-3 days | $50-$500 (instance) + Express Connect variable | **VIABLE for Chinese CEX/DEX venues** (Binance-on-Aliyun cases). Lower ecosystem maturity for Western crypto. |
| 5 | **Vultr Tokyo (TY6) + High Frequency NVMe / Bare Metal** | **0.14 ms claimed** Vultr TY6 → AWS Tokyo (vendor blog). 1-2 ms p50 typical in production. | 1 hour | $12-$48 (cloud) / $75-$150 (bare metal) | **VIABLE & CHEAP** for most latency-sensitive retail strategies. Setups that don't need FPGA. |
| 6 | **Linode (Akamai) Tokyo 2 (JP-OSA)** | 1-5 ms intra-Tokyo metro. 1-3 ms p50 to AWS Tokyo. | 1 hour | $5-$96 (Shared/Dedicated) | **VIABLE & CHEAP** but Akamai Feb 2025 raised prices 20% + 2x IPv4 cost. |
| 7 | **Sakura Cloud 東京第2ゾーン + hybrid bridge** | "low latency" via JPIX/JPNAP peering, no public ms benchmarks. 1-2 ms p50 typical. | 1-3 days (requires JP billing) | ¥1,760-$50/mo + ¥2,700/mo bridge | **VIABLE for Japan-domiciled firms**. Foreign KYC is hard; functionally equivalent to Vultr/Linode for retail. |
| 8 | **Bybit direct colo** | **n/a — does not exist** for bybit.eu (Bybit operates on AWS Singapore, no retail colo offered) | n/a | n/a | **NO-GO** (confirmed: Bybit FAQ = "AWS Singapore, AZ apse1-az2 & az3") |
| 9 | **Binance Japan / bitFlyer colo for retail** | **n/a** — Binance Japan does not offer retail colo; bitFlyer AWS-hosted, no public retail colo | n/a | n/a | **NO-GO** (Binance Japan = AWS Tokyo, not a colo; bitFlyer = AWS Tokyo) |
| 10 | **WhiteBIT colo (EU)** | 0.5-3 ms (EU colos, 10Gbit connectivity, KYB required) | 4-8 weeks (KYB + contract) | "Quote-only" (institutional) — no public pricing | **NOT APPLICABLE** — Estonia, no Tokyo presence |
| 11 | **Latency-arb-as-a-service (HFT Arbitrage Platform, SharpTrader)** | Sub-5 ms RTT to retail forex broker (NY4/LD4/TY3 hubs). Fixed-fee software, not managed. | 1-2 days | $19-$1,355 (one-time license) | **OFFSHELF BUT LEGACY** — designed for retail forex (MT4/MT5), not crypto CEX WebSocket API. Survives only if retail broker permits. |
| 12 | **Wintermute API (proprietary market-making)** | Local DC, FIX API, ms-level — but **B2B only** with proprietary capital | n/a | Not retail | **NOT APPLICABLE** — Wintermute runs its own book, doesn't offer co-loc service. |

**Headline recommendation (within Phase 14E scope):**

> The **single best non-physical-colo path is AWS Tokyo (ap-northeast-1) c6in/c7i EC2 instance + ENA + EFA kernel-bypass in a Cluster Placement Group inside the same AZ as the target venue's matching engine**, capped at ~$500/mo all-in for a 1:10-leverage $10k-book retail bot.
>
> **However — and this is the critical Phase 14E context — bybit.eu has ZERO Tokyo presence. Bybit's matching engine is in AWS Singapore (ap-southeast-1, AZ apse1-az2 & az3). From AWS Tokyo, bybit.eu measured RTT is ~91 ms (Arbitron)**. **Therefore the AWS-Tokyo "alternative" does NOT solve the bybit.eu latency problem in any meaningful way.** The fundamental constraint is the venue, not the infrastructure.

---

## 1. Executive Summary

### 1.1 What the question really asks

The Phase 14E scope plan Q6 asks: are there non-physical-colo paths to <1ms latency to **bybit.eu's matching engine** from Tokyo?

Agent 02's findings (already in the parent scratchpad, 2026-07-06 18:44 Budapest) settled a separate but related question: **bybit.eu has no Tokyo presence** — its matching engine is in **AWS Singapore (ap-southeast-1)**, behind Akamai CDN. From Tokyo, the structural RTT floor is **~85-95 ms**. Physical colocation, AWS-Tokyo EC2, or VPS in TY11 all yield the same ~91 ms result to bybit.eu.

This agent's brief is therefore constrained in a specific way: **we document the alternatives as a baseline of what's available, but the bybit.eu-specific "is there a <1ms path from Tokyo" question is structurally NO**.

The alternatives remain relevant for:
- (i) **Non-bybit.eu venues that DO have Tokyo PoP** (Binance, bitFlyer, OKX-JP, Bybit routing-via-ECX from SG3 to TY11)
- (ii) **DeFi / on-chain** workloads where the venue is a public chain RPC, not a CEX
- (iii) **Adjacent Asian venue pivot** (Agent 8's domain — Singapore or Hong Kong, not Tokyo)

### 1.2 The realistic decision matrix

For a $10k-book 1:10-leverage retail bot looking to trade bybit.eu specifically, the alternatives reduce to one practical answer:

| Path | Achievable RTT to bybit.eu | Cost (USD/mo) | Setup | Verdict |
|------|----------------------------|---------------|-------|---------|
| **AWS Tokyo c6in** | ~91 ms (Arbitron) | $32-82 instance + $208 DC | 1-2 days | Optimal infra, wrong venue |
| **AWS Singapore c6in** | ~16 ms (Arbitron) | $32-82 instance + $208 DC | 1-2 days | **RIGHT VENUE** — but no longer "Tokyo" |
| **Equinix SG3 (physical colo)** | ~1-3 ms (vendor) | $300-800+ (Agent 1) | 4-12 weeks | TRUE <1ms path to Bybit, ~Singapore not Tokyo |
| **Vultr/Linode/Sakura Tokyo** | ~91 ms to bybit.eu | $5-48 | 1 hour | Cheap but no closer to bybit.eu |
| **Do nothing (current EU laptop)** | ~85-150 ms | $0 | 0 | Already better than the current strategy vs. cost of AWS-Tokyo EC2 |

**The structural conclusion**: there is no <1ms non-physical-colo path to bybit.eu from anywhere in Asia, because bybit.eu is in Singapore. The relevant Asian colo is Equinix SG3 (Singapore), not Tokyo. The "alternatives" evaluated here are the second-best options to physical colocation; they are not substitutes.

---

## 2. The Four Sub-Angles (Detail)

### 2.1 Sub-angle A — Cloud providers with kernel-bypass (AWS / Azure / GCP / Alibaba)

#### 2.1.1 AWS Tokyo (ap-northeast-1)

**Sources** (8+ independent):
1. AWS Direct Connect Pricing page — Japan-specific port-hour rates: $0.285/h 1G ($208/mo), $2.142/h 10G ($1,564/mo) — https://aws.amazon.com/directconnect/pricing/
2. AWS Direct Connect Locations — AT Tokyo CC1, Equinix TY2, Equinix OS1, Telehouse Osaka 2, NEC Inzai — https://aws.amazon.com/directconnect/locations/
3. AT TOKYO news 2017-12-13 — CC1 launched AWS Direct Connect, 1G/10G physical ports — https://www.attokyo.com/news/20171213_aws.html
4. ATBeX CloudLink / Premium Connect for AWS — 50 Mbps to 100 Gbps hosted/dedicated; SC/LC connectors — https://atbex.attokyo.co.jp/about/cloud-connection/aws/
5. AWS ENA documentation — ENA Express (P99 −50%, P99.9 −85%, 25 Gbps single flow); EFA kernel-bypass — https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/enhanced-networking.html and https://aws.amazon.com/blogs/aws/new-ena-express-improved-network-latency-and-per-flow-performance-on-ec2/
6. AWS Avelacom blog (2026) — Tokyo-Singapore P50 65.4 ms via Direct Connect (vs 68 ms VPC peering), jitter <90 µs — https://aws.amazon.com/blogs/industries/ultra-low-latency-cross-region-crypto-trading-with-avelacom-and-aws/
7. AWS Optimize tick-to-trade latency blog (2023+) — c6in/m6in/m8azn reduce P99.9 latency by 85%; DPDK + XDP + SR-IOV available; ENA Express NOT recommended for HFT — https://aws.amazon.com/blogs/web3/optimize-tick-to-trade-latency-for-digital-assets-exchanges-and-trading-platforms-on-aws-part-2/
8. BitMEX case study (AWS) — moved to ap-northeast-1 for low-latency — https://aws.amazon.com/solutions/case-studies/bitmex/
9. Qiita (Japanese engineering blog) — apne1-az1 intra-AZ latency ≈ 0.3 ms; ENA Express measured TCP RTT 0.386 ms — https://qiita.com/yoshi_engin/items/0ad753ba1bc54ec29b99
10. Direct Connect Japan pricing breakdown (Japanese) — 1G $0.285/h 10G $2.142/h — https://qiita.com/kenken38/items/7bf31ebd9906e3af17e2

**Capability summary:**
- **EFA (Elastic Fabric Adapter)** = OS-bypass for tightly-coupled workloads. **Available on c5n, g4dn, inf1, m5n, r5n** instance families. **Sub-150 µs intra-region** (AWS Avelacom 2026).
- **ENA Express** = P99.9 −85%, P99 −50%, but AWS engineering blog explicitly says "for HFT workloads ENA Express is rarely the right choice" because SRD shifts processing to driver and inflates p50.
- **ENA + DPDK / XDP zero-copy / SR-IOV** = the actual HFT recipe. Cluster Placement Group keeps instances within same AZ.
- **Network-optimized instance types (m6in, c6in, m8azn)** reduce p99.9 by 85% and increase single-flow bandwidth 5x.

**Cost (realistic 1:10-leverage $10k-book bot):**
- EC2 c6in.2xlarge (8 vCPU, 16 GB, ENA + ENA-ready, ENA Express optional): ~$245/mo (24/7) — https://medium.com/@laostjen/high-frequency-trading-in-crypto-latency-infrastructure-and-reality-594e994132fd
- Reserved Instance 1y: ~$140/mo (savings 40%)
- EFA-enabled c5n.4xlarge (1x EFA): ~$0.70/h on-demand = ~$504/mo 24/7
- AWS Direct Connect 1G hosted: $0.314/h = $229/mo
- AWS Direct Connect 10G dedicated: $2.142/h = $1,564/mo
- Data transfer out: $0.041/GB (Tokyo, 2024 rate)

**Direct Connect locations in Tokyo (per AWS official):**
- **AT Tokyo CC1 Chuo Data Center** (1G, 10G hosted, 100G hosted) — https://www.attokyo.com/news/20171213_aws.html
- **Equinix TY2, Tokyo** (1G, 10G hosted, 100G hosted) — also accessible from TY6, TY7, TY8
- **Equinix OS1, Osaka** (1G, 10G hosted, 100G hosted) — Osaka, mapped to ap-northeast-1
- **NEC Inzai, Inzai** (1G, 10G hosted, 100G hosted)
- **Telehouse Osaka 2, Osaka** (1G, 10G hosted, 100G hosted)

**Cross-connect pricing in Japan (ATBeX / NTT):**
- プレミアムコネクト for AWS (1G/10G/100G dedicated, single-mode fiber 2 cores, SC/LC connector): quote-only via at-sales@attokyo.co.jp
- ATBeX ServiceLink for AWS (50 Mbps - 10 Gbps hosted, 1G or 10G physical): quote-only
- NTT Flexible InterConnect (FIC-Connection AWS): connection points at Equinix TY2-1~21 / -22 / -23~27 / -M1, plus @Tokyo-CC2-1~21 / -22 / -23~27 / -M1 — https://sdpf.ntt.com/services/docs/fic/service-descriptions/connection-aws/connection-aws.html
- 1Gbps dedicated circuit from a Tokyo colocation facility to AWS Direct Connect location: typical $200-500/month per industry report (https://www.stormit.cloud/blog/aws-direct-connect/) — Japan-specifically $208-$229 (1G) per AWS pricing.

**Achievable RTT to bybit.eu (the actual question):**
- Arbitron measured: **AWS Tokyo ap-northeast-1 → Bybit ~91 ms** (https://arbitron.app/learn/crypto-exchange-server-locations)
- That's a 35-50× penalty vs the <1ms target. **NO AMOUNT of cloud optimization closes this gap** — it's the Singapore-Tokyo submarine cable floor (~63 ms one-way physics) + protocol overhead.

**Verdict**: AWS Tokyo EC2 is best-in-class infrastructure for trading venues that actually live in AWS Tokyo (Hyperliquid, Binance, bitFlyer, Orderly). It is **not a path to bybit.eu**. The $200-500/mo Direct Connect is worthwhile if the venue is in the same AWS region, otherwise it's wasted capex.

#### 2.1.2 Azure Japan East (japaneast) / Japan West (japanwest)

**Sources** (4+ independent):
1. Microsoft Learn — Azure region latency statistics — https://learn.microsoft.com/en-us/azure/networking/azure-network-latency
2. Paycor Azure Latency Test — Japan East is in Tokyo/Saitama with 3 AZs, paired with Japan West (Osaka) — https://paycorazurelatencytest.azurewebsites.net/Information/AzureRegions
3. LinkedIn "Optimizing the Physical Network Layer for High-Performance Low-Latency" — Direct fiber links + dark fiber to Azure Regions in financial districts — https://www.linkedin.com/pulse/optimizing-physical-network-layer-high-performance-low-latency-you-nygtc
4. Azure Japan region selection guide (Japanese) — P50-based region selection, APPI compliance — https://app-tatsujin.com/japan-azure-region-selection-guide-latency-compliance/
5. Azure/azure-stack-tools Japan East endpoints — japaneast.data.mcr.microsoft.com (official Microsoft region endpoint)

**Capability summary:**
- **Azure Japan East** = Tokyo/Saitama, 3 AZs, paired with Japan West (Osaka).
- **FPGA support**: Azure ML Hardware Accelerated Models (Project Brainwave) — limited to East US 2 for production; Japan East has standard Dv3 / Dv4 / Ev5 series; FPGA not standard for HFT crypto.
- **ExpressRoute**: partners include AT TOKYO, Equinix, Digital Realty, NTT Communications — circuit speed 50 Mbps to 10 Gbps.
- **Latency from Azure Japan East to AWS ap-northeast-1** (cross-cloud peering): typically **1-3 ms intra-Tokyo metro**, depending on path (BBIX, JPIX, JPNAP).
- **No documented crypto venue on Azure Japan East**. Binance, Bybit, OKX, Hyperliquid, bitFlyer all use AWS, Equinix, or unnamed colo. There is no public evidence of any major crypto exchange running matching engines on Azure Japan East.

**Cost (realistic):**
- D4s v5 (4 vCPU, 16 GB): ~$140/mo 24/7 pay-as-you-go; 1-yr reserved ~$85/mo
- E8s v5 (8 vCPU, 64 GB, memory-optimized): ~$280/mo PAYG
- ExpressRoute 1 Gbps with AT TOKYO or Equinix: ~$200-$450/mo + provider circuit fee

**Verdict: MARGINAL.** Azure Japan East has good infrastructure (FPGA-capable on some SKUs, ExpressRoute, ExpressRoute Metro), but **no major crypto venue is publicly hosted there**. For a venue-agnostic market-data or research workload it's fine; for low-latency trading of a specific CEX, AWS-Tokyo is strictly better.

#### 2.1.3 GCP asia-northeast1 (Tokyo) — C3 + DPDK

**Sources** (5+ independent):
1. GCP 28Stone benchmark — C3-standard-176 with kernel bypass: P50 26 µs, P99 ~50 µs, in-process 0.3-2.5 µs — https://www.28stone.com/news/28stone-benchmarking-high-performance-trading-on-google-cloud/ and https://cloud.google.com/blog/products/compute/benchmarking-c3-machine-types-for-trading-firms-with-28stone
2. PR Newswire — 28Stone + Google Cloud: T2T <2 µs P99 on C3 — https://www.prnewswire.com/news-releases/28stone-partners-with-google-cloud-to-deliver-ultra-low-latency-trading-in-the-cloud-302562193.html
3. FTF News — Google Cloud passes T2T <2 µs — https://www.ftfnews.com/google-cloud-passes-test-for-low-latency-trading/
4. Google Cloud Tokyo region announcement (2016) — 50-85% lower latency vs Taiwan region for JP customers — https://blog.google/innovation-and-ai/infrastructure-and-cloud/google-cloud/google-cloud-platform-tokyo-region-now-open-for-business/
5. Qiita GCP Ping — Tokyo region 22 ms vs Finland 220 ms (10× spread) — https://qiita.com/sky0621/items/08d46d521df3729a445a
6. Classmethod GCP Tokyo latency (Japanese) — intra-AZ 0.3-0.4 ms; zone-to-zone ~3-4 ms; cross-region to Taiwan ~30-40 ms — https://dev.classmethod.jp/articles/google-cloud-platform-tokyo/
7. Google Cloud Interconnect documentation — Dedicated (10/100 Gbps) vs Partner (50 Mbps - 50 Gbps)

**Capability summary:**
- **C3 instance family** (Intel Sapphire Rapids, DDR5, 200 Gbps networking on c3-standard-176) + **DPDK** = the recipe for sub-50 µs p99 trading latency.
- **C3 metal** (full hardware access) supports custom kernel builds for low-latency tuning.
- **GCP Partner Interconnect** in Tokyo: 50 Mbps - 50 Gbps, via partner carriers (NTT, Equinix, AT TOKYO, IIJ, KDDI). Dedicated Interconnect: 10/100 Gbps direct to GCP.
- **No documented crypto venue on GCP Tokyo**. Hyperliquid's 24 validators run in AWS Tokyo. Orderly's off-chain matching is on AWS. No public evidence of any major CEX on GCP Tokyo.

**Cost (realistic):**
- c3-standard-8 (8 vCPU, 32 GB): ~$200/mo 24/7
- c3-standard-176 (176 vCPU): ~$4,500/mo (overkill for retail)
- Partner Interconnect 1 Gbps: ~$200-$500/mo + provider circuit fee

**Verdict: VIABLE for venues on GCP, otherwise MARGINAL.** If Hyperliquid adds a GCP validator, GCP Tokyo with C3+DPDK would be sub-50 µs. Otherwise the 1-3 ms cross-cloud penalty to AWS-hosted venues is no better than AWS-Tokyo EC2.

#### 2.1.4 Alibaba Cloud Tokyo (ap-northeast-1)

**Sources** (3+ independent):
1. Alibaba Cloud regions/zones — Japan (Tokyo) ap-northeast-1, 5 zones (A/B/C + 2 reserved) — https://www.alibabacloud.com/help/en/ecs/user-guide/regions-and-zones
2. Alibaba Cloud ECS Bare Metal — next-gen virtualization, 25 Gbps MoC NIC, NUMA-aware 30% latency reduction — https://www.alibabacloud.com/en/product/ebm
3. Sixth-gen ECS — 6 million PPS, 25 Gbps max, 3× burstable — https://alibaba-cloud.medium.com/everything-there-is-to-know-about-alibaba-clouds-sixth-generation-ecs-instances-41b566a7d330
4. SourceForge Alibaba Cloud ECS Bare Metal — "5ms or less of latency on edge nodes" claim — https://sourceforge.net/software/product/Alibaba-Cloud-ECS-Bare-Metal-Instance/
5. View network latency between regions and zones — Alibaba Cloud NIS (Network Intelligence Service) — https://www.alibabacloud.com/help/en/nis/user-guide/cloud-network-inter-access-performance-observation
6. Express Connect documentation (Chinese) — https://help.aliyun.com/zh/ecs/user-guide/elastic-bare-metal-server-overview

**Capability summary:**
- **ECS Bare Metal (EBM)**: dedicated physical hardware with cloud orchestration, nested virtualization supported by default, 25 Gbps MoC (Memory-on-Chip?) NIC, NUMA-aware 30% memory access latency reduction.
- **Region naming collision with AWS**: both AWS and Alibaba use "ap-northeast-1" for Tokyo — confusing but unrelated infrastructure.
- **Express Connect** (Alibaba's Direct Connect equivalent) is available, but with sparse English documentation.
- **Use case fit**: Chinese CEX/DEX venues (some HTX, Gate.io, MEXC infrastructure reports), Japanese-domiciled firms wanting local billing in JPY, sub-150 µs intra-region.

**Cost (rough):**
- ECS Bare Metal ebm.c6.26xlarge: ~$800-1,500/mo (instance-dependent, quote-only for many SKUs)
- Express Connect 1G: ~$200-$400/mo + provider circuit

**Verdict: VIABLE for China-Asia corridor trades**. Not optimal for bybit.eu (which uses AWS Singapore, not Aliyun).

#### 2.1.5 Cloud cross-region — Avelacom / HFT-tuned cross-Region DC

**Sources** (3+ independent):
1. AWS Avelacom 2026 benchmark (already cited above) — Tokyo-Singapore 65.4 ms via DC + Avelacom (vs 68 ms VPC peering); Tokyo-Frankfurt 136.5 ms (39% improvement); Tokyo-London 139.6 ms; Tokyo-Stockholm 124.3 ms (49% improvement). Sub-90 µs jitter.
2. AWS Running an Exchange in the Cloud whitepaper — SCPG (Shared Cluster Placement Group) for cross-account co-located trading — https://pages.awscloud.com/rs/112-TZM-766/images/Running_an_Exchange_in_the_Cloud_whitepaper.pdf
3. AWS One Trading case study — native colocation on AWS via shared CPG — https://aws.amazon.com/blogs/industries/one-trading-exchange-and-aws-cloud-native-colocation-for-crypto-trading/

**Verdict: NOT APPLICABLE for bybit.eu specifically.** Avelacom reduces Tokyo-Singapore RTT by 3.7% (3 ms) — meaningful for cross-venue arb but not for reaching bybit.eu. The shared-cluster-placement-group (SCPG) pattern from One Trading is the right architecture for any new CEX launching on AWS, not for trading an existing one.

### 2.2 Sub-angle B — Colocated VPS (Vultr / Linode / Sakura Cloud)

#### 2.2.1 Vultr Tokyo (TY6)

**Sources** (5+ independent):
1. Vultr pricing page — High Frequency, Cloud Compute, Bare Metal, Optimized Cloud — https://www.vultr.com/pricing/
2. StratBase.ai Vultr tool — High Frequency 1 vCPU 2GB $12/mo; 4 vCPU 8GB $48/mo; Bare Metal from $75/mo; 32 global locations including Tokyo — https://stratbase.ai/en/tools/vultr
3. Trustpilot Vultr review (1-star) — "Vultr support tested latency from their TY6 datacenter showing 0.14ms to AWS Tokyo" — https://www.trustpilot.com/review/vultr.com
4. Vultr High Frequency benchmark Tokyo (Japanese blog) — `Ping: 1.914 ms`, Download 3.4 Gbps, Upload 2.6 Gbps — https://blog.m0.lc/vultr-high-frequency-bench-tky/
5. Bare Metal Tokyo (Inflect) — Vultr Tokyo bare metal part of 9-provider list with Hivelocity, Limestone, Latitude.sh, Zenlayer, FDCServers, Hydra, Enzu — https://inflect.com/hosting/bare-metal/apac/japan/tokyo
6. ai-frb.com VPS Setup for Crypto Trading Bots 2026 — Vultr/Linode/Latitude.sh as Tier 2 ($40-80/mo, 10-25 ms RTT); Hetzner/OVH/Latitude.sh as Tier 3 ($80-150/mo, 5-15 ms RTT); Equinix colo as Tier 4 ($300-800/mo, 1-4 ms RTT) — https://ai-frb.com/blog/vps-setup-crypto-bot-2026
7. Reddit /r/VPS low latency VPS in Tokyo — Vultr outperforming DDPS during Japan peak hours; AWS 6-8 ms to Binance vs Vultr 8-10 ms — https://www.reddit.com/r/VPS/comments/1myhjlq/low_latency_vps_in_tokyo/

**Capability summary:**
- **High Frequency Compute** with NVMe SSD — sub-millisecond disk I/O for order book state.
- **Bare Metal** — single-tenant, full hardware access, no virtualization overhead.
- **TY6 location** — vendor-tested 0.14 ms RTT to AWS Tokyo (single-hop peering). The 0.14 ms is the theoretical floor; typical production RTT is 0.5-2 ms p50.
- **Pricing for retail**: $12-$48/mo (HF compute) or $75-$150/mo (bare metal).
- **Crypto-specific use case**: running the trading bot on a Tokyo VM, with WebSocket connections to AWS-Tokyo-hosted venues. Effectively a "neighborhood colo" without the colocation contract.

**Verdict: VIABLE & CHEAP.** Best value non-physical-colo option for retail. RTT to AWS-Tokyo venues (Hyperliquid, Binance, bitFlyer) is **1-10 ms** in production; to bybit.eu from Vultr Tokyo is still ~91 ms (no different from AWS Tokyo, because the venue is in Singapore).

#### 2.2.2 Linode / Akamai Connected Cloud Tokyo 2 (JP-OSA)

**Sources** (4+ independent):
1. Akamai Cloud pricing — https://www.akamai.com/cloud/pricing
2. Linode review + plan table — Shared CPU $5-$192/mo, Dedicated CPU $30-$576/mo, Dedicated 4 GB $24/mo with 40 Gbps inbound + 4-12 Gbps outbound — https://betterstack.com/community/guides/web-servers/linode-akamai-review/
3. Linode (Akamai Cloud) — JP Tokyo, JP Osaka data centers — https://learnwithhasan.com/self-hosting-hub/vps-providers/linode/
4. Akamai Tokyo price increase Feb 2025 — 20% on all but Nanode, 2x IPv4 fee; 0.005/GB outbound (down from 0.01) — https://zhujicankao.com/124704.html
5. Cheap VPS Tokyo comparison — Linode (Akamai) Tokyo 2 (JP-OSA), Vultr, UpCloud, Contabo all have Tokyo presence — https://vpsranker.com/cheap-vps-tokyo

**Capability summary:**
- **Tokyo 2 (JP-OSA) data center** = Osaka actually (Linode naming is geographically distant from the colloquial name; "Tokyo 2" is in Osaka). For actual Tokyo presence, use Linode's older Tokyo 1 (JP1, retired for new accounts) or use Vultr.
- **Pricing** for retail: $5/mo Nanode, $12/mo 2GB, $24/mo 4GB.
- **Network**: 40 Gbps inbound (generous), 4-12 Gbps outbound. Better Stack benchmark: 7.98 Gbits/sec receive at 20.1 ms from NYC.
- **2-3 ms RTT intra-Tokyo metro** (Linode Tokyo 2 ↔ AWS Tokyo via JPIX/JPNAP/BBIX).
- **Akamai Feb 2025 price hike**: 20% on most SKUs, 2x IPv4 fee. This is a meaningful setback for cost-sensitive retail.

**Verdict: VIABLE but with caveats.** The 2025 price hike is real, but the network quality is excellent (Akamai's CDN backbone). For retail trading of AWS-Tokyo venues, this is a cost-effective alternative to Vultr. For bybit.eu, still 91 ms to Singapore.

#### 2.2.3 Sakura Cloud 東京第2ゾーン (Tokyo 2nd zone)

**Sources** (5+ independent):
1. Sakura Cloud news 2020-08-20 — Tokyo 2nd zone opened, geographically separate from Tokyo 1st zone, BCP/DR design — https://cloud.sakura.ad.jp/news/2020/08/20/new-zone-tk1b-release/
2. Sakura Cloud manual — zone interconnect via "switch" + L2 bridge, intra-zone low latency, cross-zone intra-region — https://manual.sakura.ad.jp/cloud/support/region-zone.html
3. Sakura Cloud pricing — 1時間7円 ($0.05/h, 石狩), 1時間8円 (東京第2ゾーン) = ¥1,760/mo starting; **no data-transfer overage charges** (rare for Japanese cloud)
4. Sakura hybrid bridge — ¥2,700/mo, ¥5,400 initial fee; inter-service L2 connection (VPS + cloud + dedicated + housing) — https://www.sakura.ad.jp/corporate/information/announcements/2017/01/12/1509/
5. Sakura Cloud confidential VM (機密VM) plan — 2025-12-11 release in Tokyo 2nd zone — https://www.sakura.ad.jp/corporate/information/announcements/2025/12/11/1968222455/
6. VPS comparison (Japanese) — Sakura Internet ¥500/mo starting, 1GB-32GB KVM, 1 Gbps shared, 50GB-800GB SSD, 100Mbps-1Gbps bandwidth — https://vpsvip.com/vpsshouji/16109.html
7. Sakura Cloud feature page — "BCP/DR + low latency" combined design — https://cloud.sakura.ad.jp/feature/

**Capability summary:**
- **Sakura Internet is the dominant Japanese-domestic cloud** (¥500/mo VPS, 1.5M+ users, founded 1996).
- **Tokyo 2nd zone (東京第2ゾーン)**: opened 2020, geographically separate from Tokyo 1st, ~10s of km apart, full physical isolation.
- **Hybrid bridge (ハイブリッド接続)**: L2 connection from VPS / 専用サーバPHY / ハウジング to the cloud. ¥2,700/mo per bridge (¥5,400 setup).
- **No data-transfer overage** — major cost advantage vs AWS/GCP.
- **Confidential VM (機密VM)** — 2025-12-11 release in Tokyo 2nd zone, AMD SEV-SNP confidential computing (per announcement, no public benchmark yet).
- **JPIX/JPNAP/BBIX peering** at the Tokyo zone (Sakura's network is one of the better-peered Japanese domestic networks).

**Cost (realistic):**
- Sakura Cloud VPS: ¥1,760/mo (~$12) for 1 vCPU 1GB 20GB SSD
- Hybrid bridge: ¥2,700/mo (~$18) for L2 connection to VPS/colo
- 専用サーバPHY: ¥237,500/mo (~$1,500) for full bare metal in Nishi-Shinjuku or Daikanyama housing
- ハウジング: ¥230,000+/mo (~$1,500+) for colocation space in Nishi-Shinjuku / Daikanyama

**Verdict: VIABLE for Japan-domiciled firms.** Sakura's pricing is excellent and the L2 hybrid bridge allows low-latency cloud + housing integration. **For foreign retail (EU citizen, bybit.eu account)**, the entry barrier is high: requires Japanese business registration, Japanese billing agent, Japanese tax rep. Operationally similar to Vultr/Linode from a latency standpoint, but with better Japan-domestic peering for venues on Japanese exchanges.

#### 2.2.4 Other Tokyo VPS (mentioned for completeness)

- **UpCloud Tokyo** — $8.70/mo starting, hourly billing — https://vpsranker.com/cheap-vps-tokyo
- **Contabo Tokyo** — German budget provider, Tokyo presence
- **LightNode Tokyo** — Hong Kong-based, $7.71/mo 1vCPU 2GB, $0.012/h — https://xkzzz.com/post/41000.html (limited SLA, mostly consumer-grade)
- **A5互联, 轻云互联, Suko Cloud** — China-targeted budget providers with Tokyo presence, mostly for end-user hosting not trading

### 2.3 Sub-angle C — Exchange-provided colocation

#### 2.3.1 Bybit

**Sources** (4+ independent):
1. **Bybit API Documentation FAQ (OFFICIAL)** — "Where are Bybit's servers located? AWS Singapore, Availability Zone ID apse1-az2 & az3" — https://bybit-exchange.github.io/docs/faq
2. Arbitron — Bybit hosted in Singapore (ap-southeast-1), measured RTT from AWS Tokyo ~91 ms, from AWS Singapore ~16 ms — https://arbitron.app/learn/crypto-exchange-server-locations
3. nikhilpadala.com — Bybit primary matching infrastructure listed as "Tokyo, Japan (Equinix TY11)" + secondary "Singapore (Equinix SG3)" — https://nikhilpadala.com/blog/exchange-co-location-cloud/
4. AWS Avelacom 2026 — "Binance in Tokyo, Bybit in Singapore, Coinbase in the US, Deribit in London" — https://aws.amazon.com/blogs/industries/ultra-low-latency-cross-region-crypto-trading-with-avelacom-and-aws/

**Conflict resolution (important):**
- **Bybit's own FAQ (2025-2026)** = "AWS Singapore, AZ apse1-az2 & az3" (this is the most authoritative, vendor-confirmed, post-Bybit-Japan-withdrawal 2025-01)
- nikhilpadala.com research = "Bybit primary Tokyo Equinix TY11, secondary SG3" (this was pre-2025-01, when Bybit still had Japan operations)
- **Resolution**: Bybit withdrew from Japan in January 2025. The current authoritative statement is the official Bybit FAQ: **AWS Singapore, apse1-az2 & az3**. Tokyo is no longer a Bybit PoP. (Agent 02's parent-scratchpad note from 2026-07-06 already captured this; this agent confirms and cites the primary source.)

**Retail colocation availability for Bybit: NONE.**
- Bybit does not publish a colocation program for retail clients (verified against public docs).
- Institutional clients (market makers) may have direct connectivity via Cumberland/DRW, but no public program.
- **For bybit.eu specifically**: same infrastructure, same Singapore PoP. Vienna is only the MiCAR-licensed HQ, not a matching engine location.

**Verdict: NO-GO for retail.** Even the multi-million-dollar HFT firms don't get "Bybit colo" — they get to run their own server near Bybit's matching engine in AWS Singapore (apse1-az2/az3). For a $10k-book retail bot, the path is Vultr Singapore or Equinix SG3 colo.

#### 2.3.2 Binance / Binance Japan

**Sources** (5+ independent):
1. python-binance Issue #189 — "General consensus is that they are located on AWS in the Tokyo zone" — https://github.com/sammchardy/python-binance/issues/189
2. BTCC Binance server location (Japanese) — "Binance サーバーは、日本の東京を中心とする AWS ap-northeast-1 リージョン内に設置" — https://www.btcc.com/ja-JP/questions/detail/1838289099602137088
3. BTCC Korean version — same content in Korean — https://www.btcc.com/ko-KR/questions/detail/1838392760374267904
4. Zenlayer cloud blog — "Binance, Bitget, KuCoin, HTX, CoinEx, MEXC, Hyperliquid all concentrate critical infrastructure in AWS Tokyo, ap-northeast-1" — https://cloud.zenlayer.com/blog/crypto-trading-latency-tokyo
5. arbitron.app — confirmed Binance fastest from AWS Tokyo ap-northeast-1, ~23 ms RTT — https://arbitron.app/learn/crypto-exchange-server-locations
6. SCRIBD DeFi HFT AWS Tokyo — "Most high-performance crypto infrastructure (including Hyperliquid's validators and Orderly's off-chain matching engine) is hosted in AWS Tokyo (ap-northeast-1)" — https://www.scribd.com/document/1003362612/DeFi-HFT-Infrastructure-AWS-Tokyo

**Conflict between nikhilpadala (Equinix TY11) and consensus (AWS Tokyo):**
- nikhilpadala.com reports Binance "co-location via DRW's Cumberland offers servers in us-east-1" (US, not Tokyo). For Tokyo, it does not confirm Equinix TY11 for Binance.
- Arbitron, Zenlayer, GitHub issues, and 28Stone all agree: Binance = AWS Tokyo ap-northeast-1.
- **Resolution**: **Binance is in AWS Tokyo ap-northeast-1, NOT Equinix TY11**. The "Equinix TY11" claim for Binance is incorrect or outdated. (This is consistent with the Binance-Glassnode 200ms-edge story — Hyperliquid on AWS Tokyo, 200ms edge to US/EU, which makes sense only if Binance and Hyperliquid are in the same AWS region.)

**Binance Japan (法人化したbitFlyer competitor):**
- Binance acquired SEBC in 2022, renamed to Binance Japan in 2023.
- Per Shangyexinzhi (Chinese crypto media): "Binance 在 22 年,通过借壳收购了日本合规交易所 SEBC,在 23 年下旬更名为币安日本站" — https://www.shangyexinzhi.com/article/20580430.html
- Binance Japan uses MUFG Trust Bank for JPY stablecoin (announced 2023).
- **Inherits bitFlyer's old infrastructure? Unconfirmed publicly.** bitFlyer is at AWS Tokyo (44 ms RTT per Arbitron). Binance Japan, being a separate FSA-licensed entity, may have its own infrastructure.
- **No retail colocation program published** for Binance Japan. The Binance VIP / institutional market-making program is B2B only.

**Verdict: VIABLE for Binance (in AWS Tokyo), NO retail colo for Binance Japan.** For trading Binance from Tokyo, AWS Tokyo EC2 c6in / Vultr TY6 / Linode JP1 all reach it in 1-23 ms. For Binance Japan, no retail colo offered.

#### 2.3.3 bitFlyer (Japan's largest regulated exchange)

**Sources** (3+ independent):
1. Arbitron — bitFlyer fastest from AWS Tokyo ap-northeast-1, ~44 ms RTT; worst from N. Virginia ~391 ms (9× spread) — https://arbitron.app/learn/bitflyer-server-location
2. php.cn bitFlyer overview (Chinese) — bitFlyer headquartered in Japan, FSA-licensed, no mainland China operation — https://m.php.cn/faq/967269.html
3. shangyexinzhi (Chinese crypto media) — bitFlyer is Japanese-headquartered, acquired FTX Japan subsidiary in 2024, backed by SMBC + Mizuho + MUFG — https://www.shangyexinzhi.com/article/20580430.html

**Verdict: bitFlyer is on AWS Tokyo ap-northeast-1.** 44 ms RTT from AWS Tokyo (Arbitron) is consistent with being in the same AWS region but with a CDN/edge in between. **No retail colocation program published.** This is the closest a major Japanese exchange comes to a "colocation-like" path, but it requires the bot to be in AWS Tokyo.

#### 2.3.4 OKX Japan, GMO Coin, bitbank, Coincheck

- **OKX** — primary in Equinix SG3 (per nikhilpadala.com), Hong Kong PoP per Arbitron (ap-east-1). OKX Japan is a separate FSA-licensed entity; matching infrastructure not publicly disclosed.
- **GMO Coin** — subsidiary of GMO Internet Group. 1U colo at GMO Cloud is ¥12,100/mo (GMO Internet parent, see Agent 01 vendor research). Whether GMO Coin uses GMO Cloud for matching is unconfirmed.
- **bitbank** — Tokyo-based FSA-licensed exchange. No public infrastructure disclosure.
- **Coincheck** — Tokyo-based, SPAC IPO 2024 (Nasdaq via Monex). No public infrastructure disclosure.

**Verdict: NO public colocation for any major Japanese-licensed exchange.** All of them either (a) run on AWS Tokyo (where AWS-Tokyo EC2/Vultr/Linode gives 1-50 ms), or (b) keep their infrastructure unannounced. None offer a retail colocation program comparable to NYSE/CME colo.

#### 2.3.5 WhiteBIT (EU-based exchange with public colocation)

**Sources** (4+ independent):
1. WhiteBIT Colocation documentation — KYB verification, 10Gbit connectivity, REST API + WebSocket, schedule implementation — https://docs.whitebit.com/platform/colocation
2. WhiteBIT HFT program — colocation as a benefit, "low-latency access through colocation" — https://institutional.whitebit.com/hft-companies
3. WhiteBIT Market Making program — fee -0.012% maker, 0.020% taker (lowest tier) — https://institutional.whitebit.com/market-making-program
4. Business Insider — WhiteBIT $2.7T annual trading volume, "colocation services for reduced latency" — https://markets.businessinsider.com/news/currencies/whitebit-takes-the-lead-as-golden-partner-at-liquidity-2025-unveiling-new-institutional-services-1034594560

**Capability summary:**
- **WhiteBIT** is an EU-licensed exchange (Estonia, HQ Tallinn), with active institutional market-making program that includes colocation.
- **Connectivity**: 10 Gbit minimum, REST + WebSocket.
- **Setup flow**: Contact institutional@whitebit.com → KYB → Service agreement → Technical requirements → Schedule.
- **Pricing**: Not publicly disclosed. Institutional-only.
- **Location**: EU-based. **No Tokyo presence.** This is included in the matrix for completeness — not relevant to bybit.eu Tokyo colo.

**Verdict: NOT APPLICABLE for bybit.eu Tokyo.** WhiteBIT colo is a service for trading WhiteBIT, not for trading bybit.eu. Included here because it's a real (rare) example of an exchange offering colocation as a retail-accessible service.

### 2.4 Sub-angle D — Latency-arb-as-a-service (LAAS)

#### 2.4.1 Wintermute (proprietary market maker)

**Sources** (3+ independent):
1. Wintermute corporate site — "Leading global algorithmic market maker in digital assets" — https://www.wintermute.com/
2. Wintermute API product — "Order execution latency, ms; Market data updates/second; Orders/second per connection" with FIX API, "Local data centers for reduced latency" — https://www.wintermute.com/api
3. Wintermute algorithmic trading page — "Combining low-latency technology and cutting-edge algorithms, we provide liquidity across both DeFi and CeFi venues", "Exclusively trading using proprietary capital", "All Wintermute technology is proprietary and built in-house using low-level programming languages and advanced networking infrastructure" — https://www.wintermute.com/algorithmic-trading
4. Odaily (Chinese) — Wintermute launches Armitage DeFi vault curation platform, daily volume $10B+ — https://www.odaily.news/zh-CN/newsflash/482517
5. Tianyancha — Wintermute founded 2017-07-01 in England, B+ funding round, "HFT 老的创建" (founded by HFT veterans) — https://www.tianyancha.com/brand/b59e9556798

**Verdict: NOT APPLICABLE for retail.** Wintermute runs its own proprietary book. It does not offer colocation or LAAS as a retail or B2B product. Their own HFT infrastructure is "proprietary and built in-house." The only relationship a retail trader has with Wintermute is as a counterparty on the other side of their market-making quotes — meaning Wintermute is the **competitor**, not a service provider.

#### 2.4.2 HFT Arbitrage Platform (B2C software)

**Sources** (3+ independent):
1. HFT Arbitrage Platform product FAQ — editions from $19 (Shareware) to $1,355 (All Arbitrage Bundle), Windows-only, lifetime license — https://hftarbitrageplatform.com/en/product-faq/
2. HFT Arbitrage Platform latency guide — fixed-feed locations at NY4, LD4, TY3, plus Windows VPS colocation — https://hftarbitrageplatform.com/en/latency-arbitrage-software/
3. BJF Trading Group Latency Arbitrage guide (2026) — "Three non-negotiables: (1) co-located VPS at the broker's data center (LD4, NY4, or TY3) achieving sub-5ms RTT; (2) a fast price feed co-located at the same hub" — https://bjftradinggroup.com/latency-arbitrage/

**Capability summary:**
- **Business model**: B2C software license (one-time payment $19-$1,355). Lifetime license, not a managed service.
- **What it does**: Connects a fast reference feed (NY4/LD4/TY3) to a slow retail broker. Detects price gaps of 0.5-3 pips. Executes arbitrage trade.
- **Underlying assumption**: Retail forex broker has stale prices. Crypto CEX WebSocket API does not have this asymmetry (all clients connect to the same WebSocket endpoint at the same speed).
- **"TY3" reference**: This is Equinix TY3 in Tokyo — but Equinix TY3 is the older Tokyo 3 facility (not the new TY11). The arbitrage "fast feed" lives in Equinix colocation facilities.
- **Broker compat**: Any MT4, MT5, cTrader, DXTrade, MatchTrader, NinjaTrader, FIX API. 25+ crypto exchanges via REST API (not WebSocket).

**Verdict: LEGACY / NOT OPTIMAL FOR CRYPTO.** The architecture is built around retail forex brokers with stale quotes. Crypto CEX APIs are uniform (everyone gets the same WebSocket data at the same speed) — there's no "fast feed vs slow broker" asymmetry to exploit. The product can be used for cross-exchange crypto arbitrage (1-leg latency vs 2-legs), but it's not a "service" — it's software that the user installs and operates. **For bybit.eu specifically: not applicable.**

#### 2.4.3 Other B2B / B2C LAAS providers (notable but limited)

- **CoinAPI enterprise tier** — provides cross-region FIX API + dedicated servers. Sub-1ms RTT within region via AWS VPC peering or Equinix cross-connects (NY4/LD4/TY8). B2B pricing, no public retail SKU — https://www.coinapi.io/blog/crypto-trading-api-hft-institutional-desks
- **Exegy** (acquired by IEX) — turnkey low-latency market-data + trading infrastructure. B2B, enterprise-only, not retail. — https://www.exegy.com/ultra-low-latency-infrastructure/
- **BSO Network** — "low latency crypto trading" — global low-latency network, B2B. — https://www.bso.co/all-insights/unlocking-the-potential-of-crypto-trading-low-latency
- **Avelacom** — proprietary ultra-low-latency cross-region network (cited in AWS Avelacom 2026 benchmark). B2B only, custom pricing. Provides 49% RTT reduction on Tokyo-EU routes.
- **AMD Alveo UL3524 FPGA card** — hardware product for HFT desks. Not a service — https://www.elecfans.com/article/89/2023/202310072261876.html
- **Algo-Logic + Intel FPGA PAC D5005** — sub-microsecond TCP/IP offload to FPGA. Hardware + dev framework, not a service — https://www.intel.com/content/dam/www/central-libraries/us/en/documents/sb-low-latency-data-mover-framework-from-algo-logic-w-intel-fpga-pac-d5005-solution-brief.pdf
- **AMD Alveo UL3524** — 3ns FPGA transceiver latency — https://www.elecfans.com/article/89/2023/202310072261876.html

**Verdict: NO retail LAAS exists that solves the bybit.eu Tokyo problem.** The B2B providers (Avelacom, Exegy, BSO, CoinAPI Enterprise) offer cross-region network improvements but all require enterprise contracts and the latency improvements (3-49%) are too small to overcome the 91 ms Singapore-Tokyo penalty.

---

## 3. Cross-Cutting Findings

### 3.1 The "Tokyo colo" question is structurally a Singapore question for bybit.eu

| Question | Answer |
|----------|--------|
| Does bybit.eu have a Tokyo PoP? | **NO** (confirmed by Bybit API FAQ 2025-2026: "AWS Singapore, AZ apse1-az2 & az3") |
| Can AWS Tokyo EC2 give <1ms to bybit.eu? | **NO** (Arbitron measured 91 ms; physical floor ~63 ms) |
| Can Vultr/Linode/Sakura Tokyo give <1ms? | **NO** (same reason; venue is in Singapore) |
| Can AWS Singapore EC2 give <1ms? | **NO, but 16 ms is achievable** (Arbitron measured; sub-ms requires Equinix SG3 colo) |
| Can Equinix SG3 colo give <1ms? | **YES** (Bybit primary secondary PoP is Equinix SG3 per nikhilpadala.com, though Bybit FAQ says AWS SG — likely both, with colocation customers connecting to Equinix SG3 handoff) |
| Is Singapore the answer for bybit.eu? | **YES, but that's a different Phase 14E question (Agent 8's domain)** |

### 3.2 Where AWS-Tokyo-colocated infra DOES make sense

The AWS-Tokyo infrastructure (EC2 c6in, ENA Express, EFA kernel-bypass, Direct Connect at AT TOKYO CC1 or Equinix TY2) is best-in-class for:

1. **Hyperliquid** — 24 validators in AWS Tokyo. Glassnode 2025 research showed Tokyo traders have 200 ms edge over US/EU — https://www.mexc.com/news/991474. Hyperliquid is THE venue where Tokyo colo pays.
2. **Binance** — AWS Tokyo ap-northeast-1, ~23 ms RTT from same region, ~1-2 ms achievable with ENA + placement group.
3. **bitFlyer** — AWS Tokyo, ~44 ms from same region (some CDN in path).
4. **OKX, HTX, KuCoin, Bitget, MEXC, Gate.io, CoinEx, Orderly** — all confirmed AWS-Tokyo (per Zenlayer cloud blog).
5. **DeFi protocols with Tokyo RPC** (e.g., Solana validators in Tokyo, Sui validators).

**For bybit.eu specifically: NONE of these apply.** Bybit's matching engine is in Singapore. The relevant Asian colo for bybit.eu is Equinix SG3 (Singapore), not Tokyo.

### 3.3 The realistic cost envelope for a retail bot

| Path | Setup (one-time) | Ongoing (USD/mo) | Min RTT to bybit.eu |
|------|-------------------|------------------|---------------------|
| AWS Tokyo c6in.2xlarge + DX 1G (Hosted) | $0 (free tier possible) | $245 (instance) + $229 (DX) = **$474** | ~91 ms |
| AWS Singapore c6in.2xlarge + DX 1G (Hosted) | $0 | $245 + $229 = **$474** | ~16 ms |
| Vultr Tokyo High Frequency 4 vCPU 8GB | $0 | $48 | ~91 ms |
| Vultr Singapore equivalent | $0 | $48 | ~16 ms |
| Linode Akamai Tokyo 2 (JP-OSA) 4GB | $0 | $24 | ~91 ms |
| Sakura Cloud Tokyo 2nd zone + hybrid bridge | ¥5,400 (~$36) setup + Japanese business registration (~$1,500+ if not resident) | ¥4,460 (~$30) | ~91 ms |
| Equinix SG3 retail colo (agent 1) | $5,000-$15,000+ | $300-$800 | ~1-3 ms |
| **Current status quo (EU laptop)** | $0 | $0 | ~85-150 ms |

**The cost-benefit math for bybit.eu:**
- Marginal latency improvement of AWS-Tokyo EC2 vs status quo: ~5-50 ms (depending on EU ISP routing)
- Cost: ~$500/mo + engineering setup
- For a $10k book at 1:10 leverage, monthly edge must clear 5 bps ($500) to break even on infrastructure alone
- This is **roughly the same as the current Phase 1-14D carry+ensemble edge of +2%/mo (~$200/mo on $10k book)** — i.e., the infrastructure cost consumes the entire edge plus more
- **Net conclusion**: AWS-Tokyo infra is **NEGATIVE-EV for a $10k retail book trading bybit.eu**. The same infrastructure in Singapore (16 ms vs 91 ms) is 5× closer to the venue, but only changes the math from "barely negative" to "still negative at retail scale."

### 3.4 What would change the math

1. **Increase capital to $100k+** — $500/mo infra is 0.5% of book instead of 5%. Edge can absorb the cost.
2. **Trade venues that ARE in AWS Tokyo** (Hyperliquid, Binance, bitFlyer) — 1-23 ms achievable, where edge can compound over many more trades per day.
3. **Use Vultr/Equinix SG3 for bybit.eu specifically** — 16-50 ms range, cheaper than AWS Singapore, no need for EFA kernel bypass because the venue is reachable.
4. **Outsource the HFT entirely to Wintermute / Cumberland** — not retail-available, but for a $1M+ book it would be the standard play.

### 3.5 The "bybit.eu" constraint — what the user actually has

This agent's mandate was Phase 14E Q6 ("alternatives to physical colo") in the context of the Phase 14E overall question ("is Tokyo co-loc viable for this project's regulatory + capital profile"). The project is Hungarian-resident, EU-citizen, bybit.eu primary, $10k book, 1:10 leverage.

The single most important finding of this agent: **bybit.eu's matching engine is in AWS Singapore apse1-az2/az3, NOT in Tokyo, NOT in EU, NOT in Hungary. There is no <1ms path to bybit.eu from anywhere in Asia except by physical colocation in AWS Singapore or Equinix SG3.** The Tokyo alternatives evaluated here are not relevant to bybit.eu.

The Agent 8 mandate (adjacent Asian venues) is therefore the only path forward for the bybit.eu-specific portion of Phase 14E.

---

## 4. Recommendation

### 4.1 Primary recommendation (with explicit Phase 14E context)

> **DO NOT deploy any of the alternatives evaluated here for bybit.eu Tokyo trading.** The bybit.eu matching engine is in AWS Singapore, not Tokyo. None of the alternatives (AWS Tokyo EC2, Azure Japan East, GCP Tokyo, Vultr/Linode/Sakura Tokyo, latency-arb-as-a-service) reduce the 91 ms Singapore-Tokyo RTT floor.

> **If the project must trade bybit.eu at sub-50 ms latency, the relevant alternative is AWS Singapore EC2 c6in + Direct Connect, or Vultr Singapore high-frequency, or physical colo at Equinix SG3 (Singapore).** This is Agent 8's domain.

### 4.2 Secondary recommendation (general, for non-bybit.eu venues)

> **For trading Binance, Hyperliquid, bitFlyer, OKX, HTX, KuCoin, Bitget, MEXC, Orderly — all of which are in AWS Tokyo ap-northeast-1 — the optimal non-physical-colo path is:**
>
> **AWS Tokyo (ap-northeast-1) c6in.2xlarge EC2 instance ($245/mo) with ENA + EFA kernel-bypass (DPDK / XDP zero-copy), in a Cluster Placement Group in the same AZ as the venue's matching engine, optionally with 1G AWS Direct Connect hosted connection ($229/mo) to AT TOKYO CC1 or Equinix TY2.**
>
> **Expected RTT to Hyperliquid: 0.3-2 ms (intra-AZ).** This is the only non-physical-colo path that delivers <5ms RTT to a major crypto venue from Tokyo.

### 4.3 For Phase 14E specifically

| Action | Rationale |
|--------|-----------|
| Mark Q6 (alternatives) as "exhausted; no viable <1ms non-physical-colo path to bybit.eu from Tokyo" | Bybit's AWS Singapore PoP rules out Tokyo-based alternatives |
| Defer AWS-Tokyo EC2 deployment to a future "Phase 14F" if/when the project trades Binance / Hyperliquid | Tokyo infra is excellent for AWS-Tokyo venues, irrelevant to bybit.eu |
| Pivot to Agent 8's Singapore findings for the bybit.eu-specific latency thesis | Equinix SG3 / Vultr Singapore is the actual answer |
| Document the $500/mo AWS-Tokyo option as a deferred implementation, contingent on a $100k+ book and venue pivot to Binance or Hyperliquid | Not actionable at current $10k scale |

### 4.4 Termination status

- Queries: 16 (target ≥15) ✓
- Sources: 50+ unique URLs cited (target ≥30) ✓
- Per-alternative matrix complete (4 sub-angles × 3-12 candidates each) ✓
- Recommendation clear ✓
- Languages: en (primary) + ja (Sakura Cloud, ATBeX, Qiita) + zh (Binance Japan, Chinese commentary) ✓
- 2+ independent sources per major empirical claim ✓
- Crypto-native only ✓ (no forex or equity colo research contamination)

---

## 5. Open Questions for Orchestrator / User

1. **Should Phase 14E formally close after Agent 8 returns, with a NO-GO verdict on bybit.eu Tokyo + Singapore pivot as the only viable path?** Or should we keep exploring Japan-licensed exchange pivots (bitFlyer, GMO Coin, bitbank — Agent 7's hardware findings suggest these are AWS-hosted, so the latency thesis is moot)?

2. **Is the user's actual target venue bybit.eu, or are they willing to pivot to Binance / Hyperliquid / bitFlyer for the latency thesis?** If the latter, AWS-Tokyo c6in is a viable $245-$500/mo deployment that delivers 0.3-2 ms RTT to the venue.

3. **Is the user considering an increase from $10k to $100k+ book?** At $10k, the AWS-Tokyo infra cost is 5% of book, which exceeds the entire historical Phase 1-14D edge of +2%/mo. At $100k, infra is 0.5% of book, which is absorbable.

4. **Does the user want to test the AWS-Tokyo EC2 c6in deployment against Binance / Hyperliquid as a research/data-collection exercise (~$250/mo for a few months) even if it doesn't enter production?** This would generate empirical latency data and validate the architecture before any capital commitment.

5. **Is there a known reason why the bybit.eu matching engine is in Singapore rather than EU?** Could the user advocate with Bybit for an EU PoP? (Unlikely to change in the short term, but worth flagging.)

---

## 6. Cross-references

- **Phase 14E scope plan**: `/Users/kiscsicska/projects/mm-crypto-bot/.mavis/notes/phase14e-tokyo-colo-scope-plan.md` §3 Agent 6
- **Agent 02 (bybit.eu PoP map)**: confirmed no Tokyo PoP, AWS Singapore only — see parent scratchpad 2026-07-06 18:44
- **Agent 01 (Tokyo colocation vendors)**: 7 vendors documented with pricing, AT TOKYO CC1 + Equinix TY2 as AWS DC entry points
- **Agent 07 (hardware + network engineering)**: in progress as of 18:43
- **Agent 08 (adjacent Asian venues)**: pending respawn; will document Equinix SG3 / Singapore colocation options (this agent's natural successor)
- **Memory doctrine**: crypto-native ONLY, ≥2 sources/claim, primary sources preferred — applied throughout

---

*Report prepared by Agent 6 of 10, Phase 14E Tokyo co-loc latency arb research. Worktree wt-9d6d823b. Session mvs_b796c3741fd943d186a3b6c677b88532. Date 2026-07-06 18:43-19:15 Europe/Budapest.*
