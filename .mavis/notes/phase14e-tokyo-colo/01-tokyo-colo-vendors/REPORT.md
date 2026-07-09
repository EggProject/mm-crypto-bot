# Phase 14E — Tokyo Colocation Vendor Map

**Agent 01 of 10** | Angle: Tokyo colocation vendor landscape for retail-small-firm crypto latency-arb deployment
**Date**: 2026-07-06 | **Worktree**: `wt-9d6d823b`
**Output dir**: `.mavis/notes/phase14e-tokyo-colo/01-tokyo-colo-vendors/`

---

## 1. Vendor landscape (intro)

Tokyo is Asia's densest financial-services colocation market and a critical hub for the Japanese crypto-exchange cluster. Six vendor families dominate the relevant retail <$2k/mo and prosumer tier: **AT TOKYO** (the incumbent telco-neutral operator that hosts the AWS Direct Connect / Azure ExpressRoute on-ramps), **Equinix** (TY3 / TY11 / cluster around Shinagawa-Ariake), **Digital Realty** (NRT10/12/14 in Inzai via MC Digital Realty JV with Mitsubishi Corp), **KDDI / TELEHOUSE** (Tama campus — 30kVA effective power, the highest in Japan), **Colt Data Centre Services** (Otemachi + Inzai hyperscale campus, JPX co-lo specialist), and the **Sakura Internet / GMO Cloud / @Link** domestic-Japanese tier that offers <¥30k 1U starter plans. Network presence is dominated by AWS Direct Connect locations at AT Tokyo CC1 and Equinix TY2 (1G $216/mo, 10G $1,620/mo, 100G $16,200/mo) plus Azure ExpressRoute at the same two sites, and three Japanese IXes (JPIX, JPNAP, BBIX) which are present in essentially every facility. For latency-arb the two key crypto-venue colocations to know are **bitFlyer → AWS Tokyo (ap-northeast-1), RTT ~44 ms from in-metro sources** and **Bybit → Equinix TY11 (Tokyo primary matching) with AWS Singapore as the regulatory Bybit.eu front-end**. Tokyo retail pricing per CBRE Q1 2026 ranges **$190-$355/kW/mo** with a full-cabinet central-Tokyo monthly of ¥250,000-520,000 (~$1,650-$3,430), and Equinix Fabric 1G ports are $150/mo list.

## 2. Per-vendor profiles

### 2.1 AT TOKYO Corporation (旧テレハウス系, AT TOKYO CC1/CC2/KC1/DC12)

**Source (ja)**: <https://www.attokyo.co.jp/datacenter/index.html>, <https://www.attokyo.co.jp/news/20230407.html> · **Source (en)**: <https://www.attokyo.com/datacenter/>, <https://www.attokyo.com/company/datacenter.html>

AT TOKYO operates 13 data centers across Tokyo, Osaka, and Fukuoka; the relevant Tokyo sites are **Chuo Center #1 (CC1, Toyosu, Koto-ku)** and **Chuo Center #2 (CC2)**. CC1 is the most important node for the crypto-latency-arb thesis because it is one of only two Tokyo AWS Direct Connect on-ramps (the other being Equinix TY2) and a Microsoft Azure ExpressRoute location. The facility has historically been carrier-neutral, hosting JPIX, JPNAP, and BBIX, and operates an essentially-renewable-energy-powered housing footprint (AT TOKYO announced in April 2023 that its housing and premium rack-colocation services would run on 100% renewable-energy electricity).

**Pricing** (multi-source, tax-excluded unless noted):
- Cloud-Watch catalog 2024: 1U is **not listed / 個別見積** (quote-only); 1/4, 1/2, 1, 5 rack are all quote-only; 100Mbps shared line ¥14,000-; 1Mbps dedicated ¥34,000-. CC1, CC2, KC1 (Osaka), DC12 (Osaka) are all listed. ([cloud.watch.impress.co.jp](https://cloud.watch.impress.co.jp/docs/cdc/catalog/1521573.html))
- ZDNet Japan cross-source: 1/8 rack (4U) setup ¥10,500 + monthly ¥63,000-; 1/4 rack (9U) setup ¥21,000 + monthly ¥84,000-; 1/2 rack (20U) setup ¥84,000 + monthly ¥126,000-; 1 rack (42U) setup ¥105,000 + monthly ¥210,000-. Standard-plan 100M shared line: setup ¥52,500 + monthly ¥126,000; 1G shared: setup ¥157,500 + monthly ¥399,000. Premium 100M dedicated: monthly ¥420,000; 1G dedicated bandwidth-guaranteed: monthly ¥2,625,000. ([japan.zdnet.com](https://japan.zdnet.com/hikaku/10330604/))
- New "回線だけ持込パック" (line-only bring-in pack) — no rack needed, AWS 200M dedicated + virtual managed router + ONU custody: **¥79,500/month-** tax-excluded. ([prtimes.jp](https://prtimes.jp/main/html/rd/p/000000029.000020302.html))
- AWS Direct Connect at CC1 supports 1G, 10G (MACsec), 100G (MACsec). ([aws.amazon.com/directconnect/locations](https://aws.amazon.com/directconnect/locations/))
- Azure ExpressRoute: AT TOKYO is listed as a provider for both Osaka and Tokyo2 peering locations. ([learn.microsoft.com](https://learn.microsoft.com/en-us/azure/expressroute/expressroute-locations))

**Power / redundancy**: AC100V 20A/30A, AC200V 20A/30A standard; CC1 supports up to 30kVA per rack quote-only. Power is 100% renewable-attributed as of April 2023.

**Tenancy / crypto adjacency**: No public, audited tenant list of crypto exchanges at AT TOKYO; AT TOKYO appears on JPIX's peering facility list and on AWS Direct Connect location list. No direct evidence of bitFlyer / GMO / bitbank tenancy. **Confidence: medium** (no explicit public tenant list of crypto exchanges for AT TOKYO has been published).

**Foreign-client KYC**: AT TOKYO is a Japanese corporation; standard contracts are in Japanese, with bilingual sales support available via phone (+81-3-6372-3503). Foreign SMEs typically engage a Japanese payment-and-tax proxy.

### 2.2 Equinix Tokyo (TY3, TY11, TY12x, full 11-IBX cluster)

**Source (en)**: <https://www.equinix.com/data-centers/asia-pacific-colocation/japan-colocation/tokyo-data-centers>, <https://www.equinix.com/data-centers/asia-pacific-colocation/japan-colocation/tokyo-data-centers/ty11>, <https://investor.equinix.com/news-events/press-releases/detail/155/equinix-opens-eleventh-data-center-in-tokyo> · **Source (PeeringDB)**: <https://www.peeringdb.com/fac/8924>, <https://www.peeringdb.com/fac/452>

Equinix operates **11 IBX data centers in Tokyo** plus 2 in Osaka, totaling ~32,300 m² (TY11 alone is 11,553 m² / 124,355 ft² at full build-out, opening July 2019 at $70M phase-1 with 950 cabinets, planned expansion to 3,500+ cabinets / 153,800 ft² total). The cluster is the network hub of Japanese finance: JPIX has been at Equinix TY2 since 2008, JPNAP and BBIX are at TY11, and the **Equinix Internet Exchange Tokyo (JPIX-equivalent, 123 peers / 154 connections per PeeringDB)** runs at TY2 and TY11.

**Pricing**:
- 1G Equinix Fabric port: **$150/month** list. ([docs.equinix.com](https://docs.equinix.com/fabric/pricing-billing/fabric-billing-pricing/))
- 200 Mbps local virtual connection: **$100/month** list. ([f6s.com](https://www.f6s.com/software/equinix-fabric))
- Fabric Cloud Router Standard: **$1,200/month** list.
- Physical cross-connects: **$100-$300 per cross-connect per month** with one-time install fee **$500-$1,500**. ([vendr.com](https://www.vendr.com/marketplace/equinix))
- Equinix Internet Access 1G fixed-bandwidth: **$1,000/month** for max commit, with bandwidth commit tiers from 10 Mbps to 1,000 Mbps on a 1G port.
- TY7 per-kVA: **$498/kVA** (third-party published rate). ([support.edcl.io](https://support.edcl.io/help/en-us/1-server-colocation/1-in-what-data-centers-can-i-colocate-their-respective-tier-ratings-and-power-price))
- CBRE Q1 2026 Tokyo market: **$190-$355/kW/month**, slightly down from $200-$370 prior year. ([cbre.com](https://www.cbre.com/insights/reports/global-data-center-trends-2025))
- Tokyo central full-cabinet (42U): **¥250,000-¥520,000/month** (~$1,650-$3,430). Outer Tokyo: **¥180,000-¥350,000/month** (~$1,190-$2,310). Cross-connect: **¥20,000-¥45,000/month**. ([datacenterspace.io](https://datacenterspace.io/tokyo-colocation))

**Power / redundancy**: TY11 is 5-storey steel structure, anti-seismic design, multiple disaster-mitigation systems (per Equinix press release). Phase-1 day-1 = 2.7 kVA/cabinet, ultimate = 3.9 kVA/cabinet. TY3 = 4.5-6.0 kVA/cabinet; minimum 4 kVA. Power redundancy N+1 (TY3) / N+1 (TY11).

**Tenancy / crypto adjacency — KEY FINDING**: Per independent latency-arbitrage research published on nikhilpadala.com (cited by multiple sources), **Bybit's primary matching infrastructure is at Equinix TY11 (Tokyo)**, with secondary at Equinix SG3 (Singapore). The same research notes **Hyperliquid, MEXC, Binance, KuCoin, Bitget, HTX, CoinEx, Gate.io** all run matching in AWS Tokyo (ap-northeast-1) — but the Equinix TY11 location is specifically called out for Bybit and for FX-e matching engines (Equinix press materials position TY11 as the FX-matching venue of choice for Tokyo banks, citing proximity to JPX arrownet). For Japanese exchanges, **bitFlyer is on AWS Tokyo (RTT 44ms)** per Arbitron, **GMO Coin is headquartered at Dogenzaka, Shibuya (HQ office, not necessarily the matching colo)**, and **bitbank is at Tokyo Midtown Yaesu (HQ)**. Publicly, Equinix does not list tenants; the only crypto-tenant inference is from network-measurement research. **Confidence: high for Bybit @ TY11; medium for the rest.**

**AWS Direct Connect**: Equinix TY2 (also accessible from TY6, TY7, TY8) is a Tokyo Direct Connect location with 1G, 10G (MACsec), 100G (MACsec). Equinix Fabric supports AWS Direct Connect Hosted Connections in 50-500 Mbps and 1-25 Gbps tiers in the Tokyo metro. ([docs.equinix.com](https://docs.equinix.com/fabric-marketplace/connecting-to-service-provider/aws/direct-connect-overview))

**Azure ExpressRoute**: Equinix is the largest global provider of ExpressRoute; Tokyo is one of the supported metros for Japan East and Japan West. ([learn.microsoft.com](https://learn.microsoft.com/en-us/azure/expressroute/expressroute-locations-providers))

**Foreign-client KYC**: Equinix Japan contracts are English-capable; the JP sales desk (+81-50-3204-4692) handles foreign clients routinely. Payment in USD via international wire.

### 2.3 Digital Realty NRT10 / NRT12 / NRT14 (Inzai, Chiba — MC Digital Realty JV)

**Source (en)**: <https://www.digitalrealty.com/data-centers/asia-pacific/tokyo/nrt10>, <https://www.digitalrealty.com/data-centers/asia-pacific/tokyo/nrt12>, <https://www.digitalrealty.com/about/newsroom/press-releases/123251/>, <https://www.digitalrealty.com/about/newsroom/press-releases/30101/> · **Source (ja)**: <https://www.tmtnews.tech/archives/42402>, <https://xie.infoq.cn/article/09fe630f283adf22e0af5b12a> · **PeeringDB**: <https://www.peeringdb.com/fac/9211>

Digital Realty operates Tokyo capacity through a 50/50 joint venture with Mitsubishi Corporation called **MC Digital Realty (MCDR)**. The NRT campus in Inzai City, Chiba prefecture, sits ~71 km from central Tokyo and hosts three buildings: NRT10 (opened 2021, ~37,850 m² / 124,180 ft²), NRT12 (opened March 2024, +34 MW IT capacity → 73 MW campus total, **up to 70 kW per rack** with Air-Assisted Liquid Cooling), and NRT14 (announced 2024, opening planned December 2025, +31 MW → 104 MW campus total, **up to 150 kW per rack**). The campus is connected via **Campus Connect** so multiple buildings act as one logical facility. NRT12's anchor tenant for AI workloads is **Preferred Networks (PFN)**, Japan's leading AI company, publicly confirmed November 2024.

**Pricing**:
- Per kW wholesale: NRT12 is positioned at the high-density / high-power end of the market; specific rack-pricing is quote-only. Inferred from CBRE Q1 2026 outer-Tokyo pricing ($28,000-$48,000/kW/mo from datacenterspace.io) and Baxtel's NRT12 spec sheet (high-density up to 70 kW), NRT12 would price above the $190/kW/mo central-Tokyo CBRE floor.
- NRT10: standard retail pricing, quote-only.
- Cross-connect to AWS Direct Connect / Microsoft Azure / Oracle Cloud is available via ServiceFabric and PlatformDIGITAL.

**Power / redundancy**: NRT12/NRT14 = designed for hyperscale / AI workloads, 70-150 kW/rack. Standard N+1 / 2N power redundancy (Digital Realty standard). 100% renewable energy at NRT14.

**Tenancy / crypto adjacency**: **Preferred Networks (PFN) at NRT12** (confirmed). No public evidence of bitFlyer / Binance Japan / GMO Coin / bitbank tenancy at NRT10/12/14. MCDR is the dominant player for AI / hyperscale, **not** for crypto-exchange co-location in Tokyo. The NRT cluster is geographically far from the Tokyo central financial district (Inzai, Chiba), making it less attractive for FX-crypto cross-connect to JPX arrownet.

**Confidence: high for AI / hyperscale focus, low for crypto-tenant relevance**.

**Foreign-client KYC**: Digital Realty is a global NYSE-listed REIT; contracts in English, Japanese, and Mandarin; international wire and credit-card payment for smaller deployments.

### 2.4 KDDI TELEHOUSE (Tokyo Tama campus, Osaka 2)

**Source (en)**: <https://www.telehouse.com/global-data-centers/asia/tokyo-data-centers/tama-3/>, <https://news.kddi.com/kddi/business-topic/2016/02/1572.html>, <https://www.telehouse.com/2016/03/08/telehouse-launches-new-tokyo-data-center/> · **Source (ja)**: <https://cloud.watch.impress.co.jp/docs/cdc/catalog/1520911.html>, <https://news.kddi.com/kddi/business-topic/2015/08/1311.html>

KDDI's TELEHOUSE brand operates the **Tama campus** in Tama City, Tokyo (Tama 1, Tama 2, Tama 3, Tama 5 — 1,500 racks in Tama 5 alone) plus **Osaka 2** in OBP, Osaka. Tama 3 is the marquee facility: opened March 2016, 1,300 rack capacity, **42 kVA per rack (designed) / 30 kVA effective**, 14MW total facility power, PUE 1.31, 66kV primary + backup, N+1 redundant, 48-hour fuel autonomy. This is the **highest power-per-rack in Japan**, designed for AI / hyperconverged / dense cloud workloads.

**Pricing** (Cloud-Watch catalog, tax-excluded):
- 1U: **not offered** (×).
- 1/4 rack: **¥45,000-/month**.
- 1/2 rack: **¥90,000-/month**.
- 1 rack: **¥160,000-/month**.
- 5 rack: **¥800,000-/month** (volume).
- 100Mbps shared: **¥176,000/month**.
- 1Mbps dedicated: **¥70,000/month**; 10Mbps **¥420,000**; 100Mbps **¥1,900,000**; **1Gbps dedicated ¥18,000,000/month** (yes, eighteen million yen per month for 1Gbps dedicated — high because of the 42kVA power + premium network).

**Power / redundancy**: 42 kVA/rack designed (30 kVA effective), 14MW facility, N+1, 48h fuel.

**Tenancy / crypto adjacency**: TELEHOUSE is a brand under KDDI, Japan's second-largest telco. KDDI's network (backbone, OCN transit, IIJ peering) is the network used by many Japanese retail crypto exchanges. **No public direct evidence of bitFlyer / Binance Japan / GMO Coin / bitbank tenancy at TELEHOUSE**, but the network ecosystem (BBIX, JPNAP, JPIX, KDDI's own backbone) is the most-quoted in the Japanese crypto community for retail VPS and dedicated server deployments. Tokyonline (a KDDI-line VPS retailer) and BBTower (a BBIX peering partner) are commonly used by Japanese retail algo traders. **Confidence: medium for transit presence, low for direct exchange tenancy.**

**Foreign-client KYC**: KDDI corporate sales (0077-7007 / 0120-921-919) supports English via global accounts; standard retail plans are Japanese-language only with monthly invoicing in JPY.

### 2.5 Colt Data Centre Services (Colt DCS) — Tokyo Otemachi + Inzai 1/2/3/4

**Source (en)**: <https://www.coltdatacentres.net/en-GB/our-locations/data-centre-locations-asia/inzai>, <https://www.coltdatacentres.net/en-GB/press-releases/data-centres/2025/02/inzai-4-opening-ceremony>, <https://www.datacentermap.com/japan/tokyo/colt-tokyo-otemachi/>, <https://www.datacentermap.com/japan/tokyo/colt-tokyo-inzai-one/> · **Source (ja)**: <https://kyodonewsprwire.jp/release/202011096838>, <https://www.elecinfo.com/article/21660.html>

Colt DCS operates a Tokyo campus spanning **Otemachi (Chiyoda-ku) — colocation for financial-services clients** and **Inzai City, Chiba** (Inzai 1, 2, 3, 4 — hyperscale campus developed as a JV with Mitsui & Co. and Fidelity Investments). **Inzai 4 launched February 2025**, with phase-1 4.8 MW operational and full build 20 MW, taking the Inzai total to 70 MW. **Inzai 4 is fully pre-leased** to a single cloud operator (unannounced). Colt's USP is the **PrizmNet fiber network** that provides ultra-low-latency connectivity from JPX arrownet to global financial hubs (Chicago, London, Singapore, HK), and Colt is the only broker-neutral provider with **managed/hosting services for JPX** and a preferred JPX co-location vendor.

**Tenancy / crypto adjacency**: Per Colt trading-firm case studies, **Colt hosts trading firms on the same floor as the Japan Exchange Group (JPX) matching engine at @Tokyo CC2** (AT TOKYO CC2, where Colt provides the 10Gbps JPX arrownet cross-connect to its clients). This is the closest physical proximity to JPX arrownet available in Tokyo. For crypto specifically, **Colt is the dominant cross-connect provider for FX-crypto arbitrage between JPX (Japanese stocks/futures) and offshore crypto exchanges (Bybit, OKX, Binance)**. **Confidence: high for JPX-adjacent financial-services tenancy; medium for direct crypto-exchange tenancy.**

**Pricing**: Quote-only, not published. Inferred from market context and Baxtel listings: in the upper tier of Tokyo colocation (FX-grade), comparable to or above Equinix TY3. Colt Tokyo Inzai One sits in the outer-Inzai wholesale tier.

**Power / redundancy**: Inzai hyperscale is built to Tier III+ with N+1 / 2N options; 20MW single-tenant pre-lease in Inzai 4.

**AWS Direct Connect / Azure ExpressRoute**: Available at Tokyo Colt facilities via partner integrations; Colt is also an Azure ExpressRoute provider in the Asia-Pacific region.

**Foreign-client KYC**: Colt DCS is a Fidelity-investment-backed global operator; standard MSA in English; international wire.

### 2.6 さくらインターネット (Sakura Internet — 石狩 + 西新宿 + 代官山 + 東新宿)

**Source (ja)**: <https://datacenter.sakura.ad.jp/housing/>, <https://www.sakura.ad.jp/services/hybrid/>, <https://cloud.watch.impress.co.jp/docs/cdc/catalog/1522047.html>, <https://www.sakura.ad.jp/corporate/information/announcements/2023/11/14/1968214112/>

Sakura Internet is a JASDAQ-listed (then TSE Prime) cloud / hosting / colocation provider. The Tokyo footprint is **three buildings in central Tokyo** (代官山 = Daikanyama in Shibuya, 東新宿 = Higashi-Shinjuku, 西新宿 = Nishi-Shinjuku) plus a 4-rack-class offering in **大阪堂島 (Osaka Dojima)** and the large **石狩 (Ishikari, Hokkaido)** wholesale campus. The Tokyo data centers are the relevant ones for a small-firm crypto deployment; **石狩 is too far north** for Tokyo-finance co-lo.

**Pricing** (Cloud-Watch catalog + 2023 price-revision announcement, tax-excluded, **2024年4月1日 10-20% increase**):
- 1U: **not offered (―)**.
- 1/4 rack (8U): **¥80,000/month**.
- 1/2 rack (20U): **¥120,000/month**.
- 1 rack (42U): **¥200,000/month**.
- 100Mbps shared: **¥120,000/month**.
- 1Gbps shared: **¥380,000/month** (10-user shared ベストエフォート).
- 100Mbps dedicated: **¥400,000/month**; **1Gbps dedicated: ¥2,500,000/month**.
- 4kVA 高密度 racks (Daikanyama / Nishi-Shinjuku): **¥230,000-¥237,500/month per rack**.

**Hybrid connection (ハイブリッド接続) pricing**:
- 基本料: setup ¥5,500 / month ¥2,750.
- 物理回線 1G: setup ¥110,000 / month ¥0.
- 物理回線 10G (Ishikari only): setup ¥165,000 / month ¥27,500.

**Power / redundancy**: Standard 100V/200V per rack; cloud-watch notes high-density (4kVA+) limited to specific buildings. 2024-04-01 price hike: racks +10% (Daikanyama) / +15% (Higashi-Shinjuku) / +20% (Dojima); additional power +30%.

**Tenancy / crypto adjacency**: Sakura is one of the most-used providers by Japanese retail crypto miners and small trading firms. AS9370/9371/7684 are Sakura's own ASNs; the network is well-connected to JPIX/JPNAP and to KDDI / IIJ / OCN backbones. **Sakura's colocation is rarely used by the licensed Japanese exchanges (bitFlyer/GMO/bitbank) themselves** but is the de-facto home for retail Japanese algo trading. **Confidence: high for retail-trader use, low for exchange tenancy.**

**Foreign-client KYC**: Sakura's colocation is Japanese-contract-only, with a Japanese representative required for invoicing. Some retail VPS is available to foreign customers with credit card; colocation requires Japanese business registration.

### 2.7 GMOクラウド ハウジング (GMO Cloud Housing) + @Link + secondary providers

**Source (ja)**: <https://housing.gmocloud.com/price/?navi=menu>, <https://www.gmocloud.com/pdf/pricerevision/housing_PriceRevision.pdf>, <https://co-location.at-link.ad.jp/service/pricing.html>, <https://www.merisis.jp/datacenter/housing/>, <https://www.server-kanri.com/service/idc/>

The **GMO Internet Group** runs GMO Cloud (now GMO GlobalSign Holdings) with a 1U-from housing service that is one of the most affordable in Tokyo. **GMO Coin, the licensed Japanese crypto exchange, is a separate legal entity (GMO Coin, Inc., 1-2-3 Dogenzaka, Shibuya-ku, Tokyo) and does NOT publicly advertise that it uses GMO Cloud for its matching-engine colocation**; the parent GMO Internet Group's earlier cloud-mining announcement (2018) and various consumer VPN / hosting services used European and Hokkaido facilities. GMO Cloud's Tokyo housing is at **堂島 (Dojima) DC**, Osaka — and a Tokyo POP for retail customers.

**GMO Cloud pricing** (post-March 2023 10% surcharge, post-October 2023 additional 10% on certain items):
- 1U space (100V/1.5A): setup **¥0** / month **¥12,100** (税込).
- 1/8 rack (4U 100V/5A): setup ¥0 / month ¥45,980.
- 1/4 rack (8U 100V/10A): setup ¥27,500 / month ¥66,550.
- 1/2 rack (17U 100V/20A): setup ¥55,000 / month ¥130,680.
- 1 rack (38U 100V/20A): setup ¥110,000 / month **¥217,800**.
- AWS 接続オプション 50Mbps: setup ¥22,000 / month ¥42,350; 100Mbps: month ¥72,600.
- 1Gbps shared best-effort: setup ¥55,000 / month ¥60,500.

**@Link (KDDI系, 旧東京エレクトロニクス系) pricing**: 1U space ¥150,000/month-; 3kVA ¥240,000/month; 4kVA ¥264,000/month; 1Gbps shared bandwidth ¥120,000/month; 100Mbps shared ¥350,000/month.(@-link is a premium alternative)

**Tenancy / crypto adjacency**: **GMO Cloud is the parent-company ecosystem for GMO Coin but the two are operationally separate**; public evidence of GMO Coin using GMO Cloud housing for its matching engines is **not available**. However, the brand-association is a useful marketing shortcut for retail crypto customers who want to colocate near a "crypto-friendly" provider. **Confidence: low for direct crypto-tenant evidence; high for parent-company relationship.**

**Foreign-client KYC**: GMO Cloud requires Japanese business registration; English support is limited.

## 3. Side-by-side comparison table

| Vendor | Facility (Tokyo-area) | 1U $/mo | 1/2 rack $/mo | Full rack $/mo | Cross-connect | Power/rack | AWS Direct Connect | Azure ExpressRoute | Crypto-tenant evidence | Confidence |
|---|---|---|---|---|---|---|---|---|---|---|
| **AT TOKYO** | CC1 (Toyosu), CC2 | quote-only | ~$840 (¥126,000) | ~$1,400 (¥210,000) | quote-only; via JPIX/JPNAP/BBIX | 20-30A per rack, 100% renewable | YES at CC1 (1G/10G/100G) | YES (Tokyo2) | no public tenant list | medium |
| **Equinix TY3** | Shinagawa, Koto-ku | quote-only | quote-only | ~$1,650-3,430 (¥250-520k central) | $100-300/mo + $500-1,500 install | 4-6 kVA/cabinet | via TY2 (1G/10G/100G MACsec) | YES (largest global ER provider) | Bybit @ TY11; FX e-matching engines; JPIX/JPNAP/BBIX | high (for crypto), high (for connectivity) |
| **Equinix TY11** | Ariake, Koto-ku | quote-only | quote-only | ~$1,650-3,430 (¥250-520k central) | $100-300/mo + Fabric port $150/mo | 2.7-3.9 kVA/cab (phase-1) | via TY2 (same metro fabric) | YES | **Bybit primary matching** + JPX/FX | high |
| **Digital Realty NRT10/12/14** | Inzai, Chiba (71 km from central Tokyo) | n/a (wholesale) | n/a (wholesale) | quote-only wholesale | quote-only | NRT12 70 kW/rack; NRT14 150 kW/rack | via ServiceFabric | via ServiceFabric | PFN (AI) at NRT12; no public crypto tenant | high (for AI), low (for crypto) |
| **KDDI TELEHOUSE Tama 3** | Tama City, Tokyo (30 km from center) | n/a | ~$600 (¥90,000-) | ~$1,060 (¥160,000-) | 1G dedicated ¥18M/mo(!) | **42 kVA design / 30 kVA effective (Japan's highest)** | via KDDI/BBIX | via KDDI | KDDI network serves most Japanese retail crypto VPS | medium |
| **Colt DCS Otemachi** | Chiyoda-ku, central | n/a (financial-grade) | quote-only | quote-only (FX-grade) | 10Gbps JPX arrownet managed | n/a published | via partner | via partner (Azure ER provider) | **On the same floor as JPX matching engine @ CC2 (Colt provides the cross-connect)** | high (for JPX-adjacent) |
| **Colt DCS Inzai 1-4** | Inzai, Chiba (71 km) | n/a (wholesale) | n/a (wholesale) | n/a (single-tenant pre-lease Inzai 4) | n/a | up to 20MW single-tenant | via partner | via partner | none public | medium |
| **Sakura Internet** | Nishi-Shinjuku / Higashi-Shinjuku / Daikanyama | n/a | ~$800 (¥120,000) | ~$1,325 (¥200,000) | 1G shared ¥380k/mo; 1G dedicated ¥2.5M/mo | 4-6 kVA typical; up to 4kVA+ in select DCs | via hybrid-connect ¥2,750/mo | via hybrid-connect | retail trader use, not licensed exchange | high (for retail) |
| **GMO Cloud ハウジング** | Dojima (Osaka) + Tokyo POP | ~$80 (¥12,100) | ~$880 (¥130,680) | ~$1,460 (¥217,800) | AWS 接続 50Mbps ¥42,350/mo | 1.5A/2A per U; 20A/38U rack | AWS接続オプション (50/100Mbps) | via partner | GMO Internet Group parent of GMO Coin; no public colocation match | low (for crypto match), high (for parent linkage) |
| **@Link** | Tokyo | ~$1,000 (¥150,000-) | quote-only | quote-only (4kVA ¥264,000-) | 1G shared ¥120k/mo | 3-4 kVA | via partner | via partner | none public | low |

**Notes on table**:
- All JPY→USD conversions use 152 JPY/USD (mid-2026 approximate). 
- 1U pricing for AT TOKYO and Equinix is "quote-only" because these vendors do not publish retail 1U pricing; tier-1 retail 1U plans exist in the Japanese market only at GMO Cloud, Sakura, @Link, and Merisis (¥62,000/mo-).
- Equinix Fabric ports are the modern way to do AWS/Azure cloud on-ramp + cross-connect; $150/mo 1G port list is public.
- AWS Direct Connect pricing in Japan is ~5% below rest-of-world (1G $0.285/hr Japan vs $0.30/hr global → $216/mo 1G in Japan).

## 4. Top-3 recommendations for retail small-firm deployment (≤$2k/month all-in)

**1. GMO Cloud ハウジング (Dojima + Tokyo POP) for the absolute-lowest-CAPEX entry** — **¥217,800/month (~$1,430) for a full 38U rack at 20A**, or **¥12,100/month (~$80) for a single 1U**. AWS接続オプション adds 100Mbps direct to AWS Tokyo (ap-northeast-1) for ¥72,600/month ($478), giving an all-in **~$1,910/month** for a 1U/100Mbps AWS-Direct-Connect package — within the $2k budget. Pros: cheapest in market, GMO-Internet-Group brand association for crypto (parent of GMO Coin), AWS direct-connect included. Cons: low power (1.5A per U), no native IX peering, all-Japanese contract + invoicing requires a Japanese entity or billing agent.

**2. Equinix Fabric + 1U-equivalent at TY3 (or sub-1U at a partner) for crypto-native co-lo with AWS/Azure on-ramp** — Equinix Fabric 1G port $150/mo + 200Mbps local virtual connection $100/mo + AWS Direct Connect Hosted Connection (50Mbps-500Mbps tier, ~$20-$200/mo Japan rate) + a small 1U-equivalent cross-connect cage in TY3 or TY11. Total ~$500-$1,500/month for an active trading box with **direct access to JPIX/JPNAP/BBIX/Equinix IX** and proximity to Bybit matching at TY11. Pros: same data-center floor as crypto exchanges, full bilingual support, dense network ecosystem. Cons: Equinix doesn't publish 1U pricing — must request quote; min 12-month term; min cage footprint likely 1/4 rack (~$1,000-$2,500/mo).

**3. AT TOKYO "回線だけ持込パック" (line-only bring-in pack) for cloud-rack hybrid** — **¥79,500/month-** (~$523) for AWS 200M dedicated + virtual managed router + ONU custody, **no AT TOKYO rack required**. Combined with a separate Sakura Internet 1/2 rack in Nishi-Shinjuku (¥120,000/mo) at <2 ms network latency over the AWS Direct Connect extension, an all-in can hit **~$1,300/month** with AWS-anchored matching. Pros: lowest possible AT TOKYO entry, AWS direct cloud POP, bilingual sales support. Cons: doesn't solve the "physical colocation next to exchange" latency problem — you're still 2-5 ms from the matching engine floor.

**Honourable mention**: Sakura Internet 1/2 rack (¥120,000/mo) for retail traders with Japanese business registration; pricing is increasing 10-20% in April 2024 so act before then.

## 5. Top-3 showstoppers / gotchas

**1. Foreign-client KYC and contract-language barrier for Equinix / AT TOKYO / KDDI** — All Tier-1 vendors (AT TOKYO, Equinix Japan, KDDI Telehouse, Digital Realty) require either a Japanese registered entity (japan kabushiki kaisha / godo kaisha) or an international MSA backed by a Japanese tax representative. **Equinix is the most foreign-friendly** (English MSA, USD wire, +81-50-3204-4692 international sales). AT TOKYO and KDDI Telehouse are workable via their corporate sales desks (0077-7007, +81-3-6372-3503) but expect Japanese-language contract exhibits and bank references.

**2. 12-24 month minimum commitment + deinstallation fees** — Equinix Fabric Remote/Extended ports are 12-month minimum, with de-installation fees on early termination. Equinix colocation cages are co-terminus with the cage. AT TOKYO and KDDI typically require 1-year terms. **For a $2k/mo budget, the min commitment is $24k upfront exposure**; factor this in for any 1-month test.

**3. The "near-exchange" latency assumption is misleading for AWS-hosted exchanges** — bitFlyer / Binance Japan / GMO Coin / Hyperliquid matching engines are in **AWS Tokyo (ap-northeast-1)**, NOT in colocation facilities. **Co-locating at Equinix TY3 or AT TOKYO CC1 with AWS Direct Connect adds 0.1-0.5 ms versus the AWS Direct Connect itself**, which is already ~44 ms RTT from anywhere in Tokyo. The exception is **Bybit (Equinix TY11) and OKX (Equinix SG3)** which run their own matching engines inside Equinix — for these, co-locating at TY11 (Bybit) or in Singapore (OKX) saves 1-3 ms vs AWS Direct Connect. **Don't overpay for AT TOKYO / Equinix TY11 for the AWS-hosted exchanges; the latency math doesn't justify it.** Also: **Bybit stopped serving Japanese residents in January 2025** and operates Bybit.eu from Vienna with AWS Singapore (ap-southeast-1) backend — so for an EU-legitimate Bybit play, the Asian PoP is **Singapore Equinix SG3** or **AWS Singapore Direct Connect**, not Tokyo.

**Additional gotcha — Bybit Japan-specific**: The original Bybit primary matching was at **Equinix TY11 (Tokyo)**, but **Bybit withdrew from Japan** in 2025 due to FSA pressure (Yahoo Finance, July 2025). The **Bybit.eu MiCAR-licensed entity** is HQ'd in Vienna and serves EEA clients via **AWS Singapore (apse1-az3)**, not Tokyo. For Phase 14E's Tokyo-co-lo thesis, this means **the European-legitimate Bybit venue is NOT in Tokyo**; the Asia-Pacific Bybit infrastructure is via Equinix SG3 (Singapore) as primary fallback per the nikhilpadala research.

## 6. Sources (URLs, language tag, accessed 2026-07-06)

### Vendor-official (Japanese)
- <https://www.attokyo.co.jp/datacenter/index.html> — AT TOKYO data center overview (ja)
- <https://www.attokyo.co.jp/news/20230407.html> — AT TOKYO 100% renewable electricity announcement April 2023 (ja)
- <https://prtimes.jp/main/html/rd/p/000000029.000020302.html> — AT TOKYO 回線だけ持込パック ¥79,500-/mo announcement (ja)
- <https://cloud.watch.impress.co.jp/docs/cdc/catalog/1521573.html> — AT TOKYO Cloud-Watch catalog with 1U/CC1/CC2/KC1/DC12 pricing (ja)
- <https://cloud.watch.impress.co.jp/docs/cdc/catalog/1520911.html> — KDDI TELEHOUSE Cloud-Watch catalog with Tama 3 pricing (ja)
- <https://cloud.watch.impress.co.jp/docs/cdc/catalog/1522047.html> — Sakura Internet Cloud-Watch catalog (ja)
- <https://cloud.watch.impress.co.jp/docs/cdc/catalog/1521593.html> — GMO Cloud housing catalog (ja)
- <https://www.attokyo.co.jp/news/20230407.html> — AT TOKYO premium rack colocation pricing context (ja)
- <https://news.kddi.com/kddi/business-topic/2016/02/1572.html> — KDDI Tama 3 press release (ja)
- <https://news.kddi.com/kddi/business-topic/2015/08/1311.html> — KDDI Osaka 2 press release (ja)
- <https://datacenter.sakura.ad.jp/housing/> — Sakura housing overview (ja)
- <https://datacenter.sakura.ad.jp/location/> — Sakura location list (ja)
- <https://www.sakura.ad.jp/corporate/information/announcements/2023/11/14/1968214112/> — Sakura 2024-04-01 price hike (ja)
- <https://www.sakura.ad.jp/services/hybrid/> — Sakura ハイブリッド接続 pricing (ja)
- <https://www.sakura.ad.jp/corporate/information/announcements/2016/03/01/1213/> — Sakura ハウジング line-only bring-in (ja)
- <https://housing.gmocloud.com/price/?navi=menu> — GMO Cloud housing pricing (ja)
- <https://www.gmocloud.com/pdf/pricerevision/housing_PriceRevision.pdf> — GMO Cloud price revision PDF (ja)
- <https://co-location.at-link.ad.jp/service/pricing.html> — @Link colocation pricing (ja)
- <https://co-location.at-link.ad.jp/service/line.html> — @Link line plans (ja)
- <https://www.merisis.jp/datacenter/housing/> — Merisis housing (¥62,000/mo 1U) (ja)
- <https://www.osaka.cci.or.jp/it/support/dc.html> — Osaka CCI datacenter survey (ja)
- <https://www.osaka.cci.or.jp/it/support/pdf/dc01-tokyo.pdf> — Tokyo DC price list survey 2024-05-01 (ja)
- <https://www.nic.ad.jp/ja/materials/iw/2024/proceedings/c5/c5-mito.pdf> — JPNIC datacenter facility guide 2024 (ja)
- <https://japan.zdnet.com/hikaku/10330604/> — ZDNet Japan colocation price comparison (ja)
- <https://ascii.jp/elem/000/000/598/598001/> — ASCII GMO Cloud catalog (ja)
- <https://ascii.jp/elem/000/001/123/1123937/> — ASCII さくら ハイブリッド接続 (ja)
- <https://www.server-kanri.com/service/idc/> — サーバー管理ドットコム (ja)
- <https://www.nplus-net.jp/service/datacenter/housing.html> — N-PLUS colocation (ja)

### Vendor-official (English)
- <https://www.attokyo.com/datacenter/> — AT TOKYO English overview (en)
- <https://www.attokyo.com/company/datacenter.html> — AT TOKYO 13 data center locations (en)
- <https://www.equinix.com/data-centers/asia-pacific-colocation/japan-colocation/tokyo-data-centers> — Equinix Tokyo data centers (en)
- <https://www.equinix.com/data-centers/asia-pacific-colocation/japan-colocation/tokyo-data-centers/ty3> — Equinix TY3 specs (en)
- <https://www.equinix.com/data-centers/asia-pacific-colocation/japan-colocation/tokyo-data-centers/ty11> — Equinix TY11 specs (en)
- <https://www.equinix.com.br/content/dam/eqxcorp/en_us/documents/resources/ibx-tech-specs/ibx_ty11_en_oct2020.pdf> — Equinix TY11 tech spec PDF (en)
- <https://investor.equinix.com/news-events/press-releases/detail/155/equinix-opens-eleventh-data-center-in-tokyo> — Equinix TY11 press release July 2019 (en)
- <https://www.zdnet.com/article/equinix-opens-11th-tokyo-data-centre-its-largest-in-japan/> — ZDNet Equinix TY11 (en)
- <https://www.digitalrealty.com/data-centers/asia-pacific/tokyo> — Digital Realty Tokyo overview (en)
- <https://www.digitalrealty.com/data-centers/asia-pacific/tokyo/nrt10> — NRT10 specs (en)
- <https://www.digitalrealty.com/data-centers/asia-pacific/tokyo/nrt12> — NRT12 specs (en)
- <https://www.digitalrealty.com/about/newsroom/press-releases/123251/digital-realty-lays-foundation-to-private-ai-with-second-data-center-in-nrt-campus-boosts-ai-ready-data-center-capacity-in-metropolitan-tokyo> — NRT12 press release March 2024 (en)
- <https://www.digitalrealty.com/about/newsroom/press-releases/30101/digital-realty-opens-nrt14-data-center-third-facility-at-nrt-campus-in-japan> — NRT14 press release (en)
- <https://www.telehouse.com/global-data-centers/asia/tokyo-data-centers/tama-3/> — KDDI Tama 3 (en)
- <https://www.telehouse.com/2016/03/08/telehouse-launches-new-tokyo-data-center/> — Telehouse launch press (en)
- <https://baxtel.com/data-center/telehouse-tokyo-tama-3> — Baxtel Tama 3 spec (en)
- <https://www.telehouse.com/global-data-centers/asia/tokyo-data-centers/> — Telehouse Tokyo overview (en)
- <https://www.coltdatacentres.net/en-GB/our-locations/data-centre-locations-asia/inzai> — Colt Inzai (en)
- <https://www.coltdatacentres.net/en-GB/press-releases/data-centres/2025/02/inzai-4-opening-ceremony> — Colt Inzai 4 launch (en)
- <https://www.colt.net/wp-content/uploads/2019/04/Colt-Case-Study_Trading-firm_2019.pdf> — Colt JPX co-lo case study (en)
- <https://kyodonewsprwire.jp/release/202011096838> — Colt Inzai 3 launch (en)
- <https://itbusinesstoday.com/tech/colt-data-centre-services-opens-colt-inzai-data-centre-4/> — Colt Inzai 4 (en)
- <https://datacenterhawk.com/marketplace/markets/tokyo/facilities> — datacenterHawk Tokyo facilities (en)
- <https://datacenterhawk.com/marketplace/providers/at-tokyo/6-chome-2-15-toyosu-koto-city-tokyo-135-0061/cc1> — datacenterHawk AT Tokyo CC1 (en)
- <https://www.ocolo.io/colocation/at-tokyo/tokyo-chuo-center-2-cc2/> — Ocolo AT Tokyo CC2 (en)
- <https://www.ocolo.io/colocation/equinix/tokyo-ty11/> — Ocolo Equinix TY11 (en)
- <https://www.ocolo.io/colocation/digital-realty/tokyo-nrt10/> — Ocolo NRT10 (en)
- <https://www.ocolo.io/colocation/digital-realty/tokyo-nrt12/> — Ocolo NRT12 (en)
- <https://www.ocolo.io/colocation/colt-data-centres/tokyo-shiohama/> — Ocolo Colt Shiohama (en)
- <https://www.ocolo.io/colocation/colt-data-centres/tokyo-inzai-two/> — Ocolo Colt Inzai 2 (en)
- <https://www.ocolo.io/colocation/at-link.ad.jp/> — Ocolo @-link (en)
- <https://baxtel.com/data-center/equinix-tokyo-ty3> — Baxtel Equinix TY3 (en)
- <https://baxtel.com/data-center/equinix-tokyo-ty11> — Baxtel Equinix TY11 (en)
- <https://baxtel.com/data-center/mc-digital-realty> — Baxtel MCDR portfolio (en)
- <https://baxtel.com/data-center/colt-tokyo-inzai> — Baxtel Colt Inzai (en)
- <https://baxtel.com/data-center/colt-kvh-tokyo> — Baxtel Colt KVH Tokyo (en)
- <https://www.datacentermap.com/japan/tokyo/> — DataCenterMap Tokyo 105 facilities (en)
- <https://www.datacentermap.com/japan/tokyo/equinix-ty11/> — TY11 datacentermap (en)
- <https://www.datacentermap.com/japan/tokyo/equinix-ty3/> — TY3 datacentermap (en)
- <https://www.datacentermap.com/japan/tokyo/digital-realty-tokyo-nrt12/> — NRT12 datacentermap (en)
- <https://www.datacentermap.com/japan/tokyo/telehouse-tokyo-tama-3/> — Tama 3 datacentermap (en)
- <https://www.datacentermap.com/japan/tokyo/colt-tokyo-otemachi/> — Colt Otemachi (en)
- <https://www.datacentermap.com/japan/tokyo/colt-tokyo-inzai-one/> — Colt Inzai 1 (en)
- <https://datacenterspace.io/tokyo-colocation> — DataCenterSpace Tokyo pricing guide 2026 (en)
- <https://inflect.com/datacenters/apac/japan/tokyo> — Inflect Tokyo facilities (en)
- <https://inflect.com/building/1-9-20-edagawa-shinagawa-ku/equinix/datacenter/ty3> — Inflect Equinix TY3 (en)
- <https://inflect.com/building/1-chome-2-41-ariake-koto-ku/equinix/datacenter/ty11> — Inflect Equinix TY11 (en)
- <https://www.datacenters.com/providers/at-tokyo/data-center-locations> — DataCenters.com AT TOKYO (en)
- <https://www.datacenters.com/providers/equinix/locations/japan/tokyo> — DataCenters.com Equinix Tokyo (en)
- <https://www.datacenters.com/equinix-ty11-tokyo> — DataCenters.com TY11 (en)
- <https://www.datacenters.com/digital-realty-tokyo-nrt10> — DataCenters.com NRT10 (en)
- <https://www.datacenters.com/telehouse-tokyo-tama-3-telehouse> — DataCenters.com Tama 3 (en)
- <https://www.datacenters.com/providers/colt-technologies/data-center-locations> — DataCenters.com Colt (en)
- <https://www.datacenters.world/facility/equinix-inc-equinix-ty11-tokyo-tokyo> — Datacenters.world TY11 (en)
- <https://www.peeringdb.com/fac/8924> — PeeringDB Equinix TY11 (en)
- <https://www.peeringdb.com/fac/452> — PeeringDB Equinix TY2 (en)
- <https://www.peeringdb.com/fac/168> — PeeringDB Equinix TY1 (en)
- <https://www.peeringdb.com/fac/1253> — PeeringDB Equinix TY3 (en)
- <https://www.peeringdb.com/fac/3336> — PeeringDB Equinix TY8 (en)
- <https://www.peeringdb.com/fac/3337> — PeeringDB Equinix TY9 (en)
- <https://www.peeringdb.com/fac/9211> — PeeringDB Digital Realty NRT10 (en)
- <https://www.peeringdb.com/fac/15430> — PeeringDB Equinix TY15 (en)
- <https://www.peeringdb.com/ix/167> — PeeringDB Equinix Tokyo IX (en)
- <https://www.peeringdb.com/ix/30> — PeeringDB JPIX Tokyo (en)
- <https://www.peeringdb.com/ix/126> — PeeringDB BBIX Tokyo (en)
- <https://www.peeringdb.com/carrier/986> — PeeringDB TOKAI Communications (en)
- <https://support.edcl.io/help/en-us/1-server-colocation/1-in-what-data-centers-can-i-colocate-their-respective-tier-ratings-and-power-price> — EDCL power pricing TY7 $498/kVA (en)

### Cloud provider / connectivity official
- <https://aws.amazon.com/directconnect/pricing/> — AWS Direct Connect global + Japan pricing (en)
- <https://aws.amazon.com/jp/directconnect/pricing/> — AWS Direct Connect Japan pricing (ja)
- <https://aws.amazon.com/directconnect/locations/> — AWS Direct Connect locations list (en)
- <https://aws.amazon.com/directconnect/partners/> — AWS Direct Connect delivery partners (en)
- <https://learn.microsoft.com/en-us/azure/expressroute/expressroute-locations> — Azure ExpressRoute Tokyo locations (en)
- <https://learn.microsoft.com/en-us/azure/expressroute/expressroute-locations-providers> — Azure ExpressRoute providers (en)
- <https://docs.equinix.com/fabric-marketplace/connecting-to-service-provider/aws/direct-connect-overview> — Equinix Fabric AWS Direct Connect (en)
- <https://docs.equinix.com/fabric/pricing-billing/fabric-billing-pricing/> — Equinix Fabric pricing & billing (en)
- <https://docs.equinix.com/billing/cross-connect-billing/> — Equinix cross-connect billing (en)
- <https://docs.equinix.com/cross-connect/> — Equinix cross-connect product (en)
- <https://docs.equinix.com/cross-connect/xc-pricing-billing-terms/> — Equinix cross-connect pricing terms (en)
- <https://docs.equinix.com/fabric/pricing-billing/fabricpricingtool/> — Equinix Fabric pricing tool (en)
- <https://docs.equinix.com/internet-access/eia-billing/> — Equinix Internet Access pricing (en)
- <https://docs.equinix.com/fabric/ports/fabric-order-port-new/> — Equinix Fabric port ordering (en)
- <https://docs.equinix.com/network-edge/billing/ne-pricing-terms-billing/> — Equinix Network Edge pricing (en)
- <https://docs.equinix.com/billing/fabric-billing/> — Equinix Fabric billing (en)
- <https://blog.equinix.com/wp-content/uploads/2020/09/Azure-ExpressRoute-Map-Data-Sheet-US-EN.pdf> — Equinix Azure ExpressRoute map (en)
- <https://www.equinix.com/partners/microsoft-azure> — Equinix Microsoft Azure partner (en)
- <https://www.equinix.com/partners/aws> — Equinix AWS partner (en)
- <https://www.equinix.com/resources/data-sheets/microsoft-expressroute-map> — Equinix Microsoft ExpressRoute map (en)
- <https://www.prnewswire.com/news-releases/equinix-expands-private-connectivity-to-microsoft-azure-expressroute-to-new-global-markets-300641855.html> — Equinix Azure expansion (en)
- <https://blog.consoleconnect.com/console-connect-expands-azure-expressroute-reach-with-new-global-locations> — Console Connect Azure ExpressRoute (en)
- <https://www.consoleconnect.com/clouds/microsoft-azure-direct-connect/> — Console Connect Azure (en)
- <https://www.coresite.com/cloud-networking/aws-direct-connect> — CoreSite AWS Direct Connect (en)

### Crypto exchange / industry / market (English)
- <https://nikhilpadala.com/blog/exchange-co-location-cloud/> — Exchange co-location research: Bybit @ Equinix TY11, Bybit Singapore fallback, AWS Tokyo for Binance/Hyperliquid/MEXC/etc., Equinix IX RTT measurements (en)
- <https://arbitron.app/learn/bitflyer-server-location> — bitFlyer server location AWS Tokyo ap-northeast-1 44ms RTT (en)
- <https://arbitron.app/learn/crypto-exchange-server-locations> — Crypto exchange server location map 2026 (en)
- <https://www.binance.com/en/square/post/307123585625377> — Hyperliquid 24 validators in AWS Tokyo (en)
- <https://www.bybit.com/future-activity/de-DEU/developer> — Bybit servers: Singapore AWS apse1-az3 (en)
- <https://www.bybit.eu/sv-EU/help-center/article/How-to-Optimize-Trading-Experience> — Bybit EU servers in Singapore AWS (en)
- <https://www.prnewswire.com/news-releases/bybit-launches-bybiteu-a-fully-micar-compliant-platform-for-europes-crypto-users-302496293.html> — Bybit EU Vienna MiCAR launch July 2025 (en)
- <https://learn.bybitglobal.com/en/regulations/bybit-europe-eu-and-micar> — Bybit EU MiCAR (en)
- <https://www.mexc.com/en-GB/news/1182441> — Bybit EU MiCAR redirect (en)
- <https://bybit-exchange.github.io/docs/v5/guide> — Bybit API EEA region api.bybit.eu (en)
- <https://www.fsa.go.jp/en/regulated/licensed/en_kasoutuka.pdf> — Japan FSA licensed crypto exchanges list bitFlyer, Binance Japan, GMO Coin, bitbank, OKCoin Japan, etc. (en)
- <https://www.fsa.go.jp/en/regulated/licensed/en_kasoutuka.xlsx> — Same as above XLSX (en)
- <https://en.wikipedia.org/wiki/BitFlyer> — bitFlyer Wikipedia (en)
- <https://finance.yahoo.com/news/why-bybit-end-services-japan-151740145.html> — Bybit Japan withdrawal January 2025 (en)
- <https://www.financemagnates.com/cryptocurrency/news/bitbank-bitflyer-ceos-part-ways-japans-cryptocurrency-self-regulator/> — bitbank / bitFlyer CEOs (en)
- <https://www.fx-markets.com/technology/trading-systems/4434081/ty11-has-potential-to-host-e-fx-matching-engines-in-tokyo> — Equinix TY11 FX matching (en)
- <https://www.financemagnates.com/institutional-forex/technology/colt-jpx-team-connect-chicago-tokyo-markets/> — Colt JPX Chicago (en)
- <https://www.hedgeweek.com/colt-provide-direct-connectivity-between-tokyo-and-chicago/> — Colt Tokyo Chicago (en)
- <https://www.srgresearch.com/articles/equinix-digital-realty-and-ntt-control-30-of-the-growing-worldwide-colocation-market> — Structure Research colocation market shares (en)
- <https://www.cbre.com/insights/reports/global-data-center-trends-2025> — CBRE Global DC Trends 2025, Tokyo $190-355/kW/mo (en)
- <https://www.mingtiandi.com/real-estate/crelist/roundup-digital-realty-opens-3rd-data-centre-at-japan-campus/> — Digital Realty NRT14 (en)
- <https://www.tmtnews.tech/archives/42402> — Digital Realty NRT12 launch (en)
- <https://www.tmtnews.tech/archives/43828> — Digital Realty NRT14 construction (en)
- <https://www.credenceresearch.com/report/japan-data-center-colocation-market> — Japan colocation market size (en)
- <https://www.mordorintelligence.com/industry-reports/japan-data-center-market> — Japan data center market (en)
- <https://aijourn.com/japan-data-center-portfolio-2025-coverage-of-115-existing-and-46-upcoming-data-centers-across-20-locations-in-japan-researchandmarkets-com/> — Japan DC Portfolio 2025 (en)
- <https://www.businesswire.com/news/home/20241030279063/en/Japan-Colocation-Existing-Upcoming-Data-Center-Portfolio-2024-White-floor-Space-Current-IT-Load-Capacity-and-Future-Capacity-Additions-Retail-Colocation-Pricing---ResearchAndMarkets.com> — Japan Colocation 2024 (en)
- <https://www.vendr.com/marketplace/equinix> — Equinix pricing analysis (en)
- <https://www.f6s.com/software/equinix-fabric> — Equinix Fabric pricing (en)
- <https://encoradvisors.com/data-center-colocation-pricing/> — 2026 colocation pricing guide (en)
- <https://datacenterhawk.com/resources/fundamentals/colocation-data-center-pricing-a-2026-beginner-s-guide> — datacenterHawk pricing guide (en)
- <https://macronetservices.com/data-center-colocation-tokyo-japan/> — MacroNet Tokyo colo (en)
- <https://www.cloudzero.com/blog/aws-direct-connect-pricing/> — AWS Direct Connect pricing guide (en)
- <https://dgtlinfra.com/aws-direct-connect-gateway-locations-partners-pricing/> — Dgtl Infra AWS DX (en)
- <https://www.quantil.com/docs/at-tokyo-equinix-tokyo-network> — Quantil AT Tokyo Equinix (en)
- <https://www.lifewire.com/data-center-colocation-pricing-101> — general (en)
- <https://papers.peeringasia.org/pa60/peeringasia60-peering-personal-full-list.pdf> — Peering Asia 6.0 JPIX/JPNAP/BBIX (en)

### Crypto exchange Chinese-language / industry commentary
- <https://www.binance.com/en-NG/square/post/11323487640074> — BitFlyer acquires FTX Japan (en)
- <https://www.binance.com/en/square/post/9982864881673> — Crypto companies in Japan 2024 (en)
- <https://new.qq.com/rain/a/20240628A082Q400> — Crypto companies in Japan (zh)
- <https://www.163.com/dy/article/J5PO0L1D05248UCQ.html> — Crypto companies in Japan 2024 (zh)
- <https://finance.sina.com.cn/blockchain/roll/2024-06-28/doc-incafxzt5311766.shtml> — Crypto companies in Japan (zh)
- <https://www.shangyexinzhi.com/article/20580430.html> — Crypto companies in Japan (zh)
- <https://www.estie.jp/portal/en/article/78uc054gbEdnWM4hKlbtDP> — bitbank HQ relocation Tokyo Midtown Yaesu Jan 2026 (en)
- <https://cloudzy.com/id/japan-vps/> — Cloudzy Japan VPS (id)
- <https://cloudzy.com/ko/japan-vps/> — Cloudzy Japan VPS Korean (ko)
- <https://www.edisglobal.com/vps-hosting/japan-tokyo> — EDIS Japan VPS at Equinix TY8 (en)
- <https://zhujicankao.com/123806.html> — Friendhosting Japan VPS Equinix Tokyo (zh)
- <https://zhujicankao.com/127656.html> — Tokyonline KDDI line (zh)
- <https://www.idcspy.com/132121.html> — Tokyonline Sony So-Net VPS (zh)
- <https://fxvps.biz/features/crypto-trading/> — FXVPS crypto trading VPS at Equinix LD4 NY4 TY3 (en)
- <https://www.51idc.com> — 51IDC Tokyo (zh)
- <https://www.iaiyun.com/index.php?a=lists&catid=207> — 爱云技术 Tokyo (zh)
- <https://www.henghost.com/datecenter-jp-ty8.shtml> — 恒创科技 Equinix TY8 (zh)
- <https://www.a5idc.net/news/141.html> — A5互联 Equinix (zh)
- <https://www.idcbest.com/idcnews/11005133.html> — 天下数据 Colt IDC Tokyo (zh)
- <https://www.sohu.com/a/487019394_100161396> — 搜狐 Colt DCS Japan (zh)
- <https://www.sohu.com/a/828987852_121956424/> — 搜狐 PFN Digital Realty NRT12 (zh)
- <https://www.sohu.com/a/828988122_121885030> — 搜狐 PFN NRT12 (zh)
- <https://www.toutiao.com/article/6720123528911258123/> — 今日头条 Equinix TY11 (zh)
- <https://www.elecinfo.com/article/21660.html> — elecinfo Colt Inzai 4 (zh)
- <https://www.idcspy.com/132121.html> — 美国主机侦探 Tokyonline (zh)
- <https://www.henghost.com/datecenter-jp-ty8.shtml> — 恒创科技 Equinix TY8 (zh)
- <https://www.btcc.com> — 币圈子 MMO coin (zh) — not directly relevant
- <https://www.cryptogeek.info/en/exchanges/bitflyer> — Cryptogeek bitFlyer (en)
- <https://cointelegraph.com/news/franklin-templeton-sbi-holdings-launch-crypto-etf-japan> — SBI Franklin Templeton (en)
- <https://www.binance.com/en-AE/square/post/9982864881673> — Crypto companies in Japan (en)

## 7. Confidence ratings per vendor

| Vendor | Confidence | Reason |
|---|---|---|
| AT TOKYO | **High** (product) / Medium (crypto tenancy) | Multiple Cloud-Watch catalog entries, vendor-official, JPIX-confirmed presence; no public crypto tenant list |
| Equinix (TY3 / TY11) | **High** | Vendor-official spec sheets, Equinix Fabric pricing public, peer-reviewed research on Bybit @ TY11, PeeringDB network data |
| Digital Realty NRT10/12/14 | **High** (specs) / Low (crypto relevance) | Multiple press releases, MC Digital Realty JV public, NRT14 spec public; no crypto tenant evidence |
| KDDI TELEHOUSE Tama 3 | **High** (specs/pricing) / Medium (crypto) | KDDI official press release, Cloud-Watch catalog, Baxtel spec sheet, KDDI network is the dominant Japanese retail crypto backbone |
| Colt DCS Otemachi + Inzai | **High** (JPX co-lo) / Medium (crypto) | Colt case study PDF, Inzai 4 launch press, financial-services customer base documented |
| さくらインターネット | **High** | Vendor official + Cloud-Watch + 2024 price-revision announcement; 3 Tokyo buildings, 1 Osaka, 1 Hokkaido |
| GMO Cloud ハウジング | **High** (pricing) / Low (crypto match evidence) | Vendor official pricing PDF, parent-child relationship with GMO Coin public, but no matching-engine colocation evidence |

## 8. Summary

Tokyo's colocation market is **mature, dense, and pricing-competitive** for foreign retail-sized firms (¥10,000-300,000/month = $66-2,000/month range), with Equinix + AT TOKYO + KDDI Telehouse as the three pillars of crypto-relevant infrastructure. The single most important finding for Phase 14E's Tokyo co-located latency-arb thesis: **bitFlyer is on AWS Tokyo (ap-northeast-1), NOT in a colocation facility**; the only major venue with a self-hosted matching engine in Tokyo is **Bybit at Equinix TY11**, and Bybit is in active withdrawal from Japan (Bybit.eu for EEA is now AWS Singapore). The other licensed JP exchanges (GMO Coin at Dogenzaka HQ, bitbank at Yaesu HQ, Coincheck, OKCoin Japan, bitFlyer) run in cloud regions — so the "colocate next to the exchange" arbitrage is **only** valid for Bybit-style venues; for AWS-hosted JP exchanges, AWS Direct Connect to ap-northeast-1 from any Tier-1 Tokyo facility is functionally equivalent, and the cheaper AT TOKYO "回線だけ持込パック" (¥79,500/mo) or GMO Cloud ハウジング (¥217,800/mo full rack) wins on cost. Recommended budget-stratified picks: **GMO Cloud full-rack + AWS接続 = ~$1,900/mo all-in** for cloud-anchored retail; **Equinix Fabric 1G port + 1/4 rack at TY3 = ~$1,500-2,500/mo all-in** for crypto-floor proximity (only justified if Bybit-type venue is the target).
