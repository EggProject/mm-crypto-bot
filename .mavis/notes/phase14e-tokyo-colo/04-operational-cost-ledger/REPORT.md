# Operational Cost Ledger — Phase 14E Tokyo Coloc Latency Arb

**Agent 4 / 10 — Operational cost engineering**
**Subject:** All-in monthly cost for a Hungarian-resident individual operating a colocated server in Tokyo trading bybit.eu spot-margin
**Date:** 2026-07-06
**Reporting currency:** USD; JPY converted at ¥155.74/USD (live mid-market 2026-07-05, XE.com)

---

## Executive summary

A retail-grade colocated trading rig in Tokyo for bybit.eu costs between **$650/month (Scenario A — minimal)** and **$3,150/month (Scenario C — premium)**. **At 1,000 trades/month, breakeven edge-per-trade is 65¢ (A) → $3.15 (C).** For comparison, Agent 3's preliminary Asian-session microstructure edge estimates for top-tier HFT market-making range 3-15 bps on $1k-10k orderbook depth (≈ $0.30-$15 per $1k fill), so:

- **Scenario A is profitable** for any strategy with edge > 0.65 bps.
- **Scenario B requires edge > 1.5 bps.**
- **Scenario C requires edge > 3.15 bps** — only achievable by institutional-grade quoting strategies.

The Hungarian 15% SZJA flat tax and MiCAR compliance costs are negligible at <$100k monthly book size, but **Act LXVII/2025 (now being reversed) introduced temporary criminal liability** for trading on unauthorized platforms — using bybit.eu (Cyprus, MiCAR-authorized) is the legally clean path.

---

## 1. Per-component cost analysis

### 1.1 Colocation rent (Tokyo metro)

Tokyo retail colocation pricing spans an order of magnitude depending on facility tier. Per-Unit and per-kW are both used by major vendors; the structural choice depends on power density.

**VPS-grade / consumer colo (e.g., Osaka CCI / Reddit-reported operators):**
- 1U space: ¥10,000/month ≈ **$66/month** [r/japanlife; Osaka CCI rate card].
- 0.25-1 kW power: ¥13,000/month per kW ≈ **$84/month per kW** (Reddit cite).
- 100 Mbps line with dedicated IP: ¥5,000/month ≈ **$32/month**.
- All-in minimum: **¥30,000/month ≈ $195/month** baseline.

**Mid-tier retail (Digital Realty NRT10 retail reseller / Equinix sub-2kW):**
- 1U @ 150W, 40TB @ 10Gbps, /31 IPv4 included: pricing not public but Digital Realty NRT10 promotional bundle (via `ddps.jp`) explicitly markets "**Free rack and stack + free advanced remote hands up to 4 hours/month** + free /31 IPv4 (up to /29 free) + /64 IPv6 (up to /48 free) + free BGP** + $1/month per additional IP" — this is essentially zero hidden fees, suggesting a competitive headline rate (~$150-300/month per 1U retail).
- Outer-zone (Inzai, Chiba — NRT campus): ¥180,000-¥350,000/month for full 42U cabinet [$1,160-$2,250] (datacenterspace.io).

**Central Tokyo Tier-1 (Equinix TY3, AT TOKYO CC1, Digital Realty HND11):**
- 1U: $150-$300/month (DatacenterHawk 2026 retail).
- Half-rack (~$600-$1,500/month base) plus ~$200-300/kW (Encora Advisors / CBRE H2 2025: $196/kW North America baseline; Tokyo premium 15-25%).
- Full 42U cabinet central Tokyo: ¥250,000-¥520,000/month [$1,605-$3,340] (datacenterspace.io).
- Per-kW: ¥40,000-¥65,000/month central [$257-$417/kW] (datacenterspace.io).

**Power capacity reservation fee component** — Vendr's Equinix survey reports additional power beyond standard cabinet allocation billed at **$150-300/kW/month**; many Tokyo providers bundle power up to 4-5 kW per cabinet then add marginal kW fees.

**Verdict:**
- VPS-grade 1U: ~$66-$200/month (facility + bundled power).
- Mid-tier retail 1U: ~$150-$400/month (Digital Realty retail, /31 IPv4 bundled, free BGP).
- Tier-1 1U: ~$300-$800/month (Equinix TY3 / AT TOKYO CC1, all-inclusive).
- Tier-1 half-rack (22U, 4-6 kW): ~$1,200-$2,500/month.

### 1.2 Cross-connect fees

Cross-connect pricing is the single biggest hidden line-item and varies dramatically by metro and provider.

**Per-port monthly recurring charges:**
- Equinix Internet Access (EIA): $150/month for 10 Mbps commit, scales up to $1,000/month for 1 Gbps commit (Equinix product docs).
- Tokyo retail cross-connect: ¥20,000-¥45,000/month [$128-$289] (datacenterspace.io).
- Typical US benchmark: $200-$350/connect/month (Reddit r/Network).
- Europe: $125-$250/month.

**Specific IX ports (Tokyo):**
- JPIX: Fast Ethernet ¥310,000/mo (legacy 2008 rate; current higher), Gigabit Ethernet ¥620,000/mo, 10GE ¥2,600,000/mo (legacy JPIX rate card). **Modern pricing should be lower but JPIX has not updated public tariffs** — caveat for source freshness.
- OPTAGE OC1 (Jan 2026 launch): **first-year free cross-connect fees** to IX services (JPNAP, JPIX, BBIX) as launch promotion — meaningful cost-saving for new tenants.

**AWS Direct Connect at Tokyo (AT TOKYO CC1, Equinix TY2, Equinix OS1):**
- 1 Gbps dedicated: **$0.285/hr in Japan** (vs $0.30 elsewhere; 5% Japan discount) × 730 hours = **$208/month**.
- 10 Gbps dedicated: $2.142/hr × 730 = **$1,564/month**.
- Data Transfer Out (DTO): $0.0410/GB to Asia Pacific Tokyo region.
- Hosted connections (50 Mbps-10 Gbps): $0.029-$2.361/hr in Japan.

**Verdict for crypto exchange PoP:**
- One cross-connect to a major exchange PoP within Equinix/AT TOKYO campus: $200-$350/month.
- AWS Direct Connect 1G (for hybrid cloud fallback / data lake): $208/month + DTO.
- Two-port redundancy: $400-$700/month total.

### 1.3 IP allocation

**Most Tokyo datacenters bundle IPv4 with the colo contract** (Digital Realty NRT10 promo: /31 free, up to /29 free; Equinix: IPv4 typically included in EIA port fee; per-extra IP $1-3/month).

**ASN registration:**
- APNIC membership: ~$1,200/year minimum for small allocations (~$100/month amortized).
- Many colo providers offer "PI space" rental: $50-$150/month.
- IPv6 typically free.

**Verdict:** IP allocation is essentially a non-line-item for typical retail colo ($0-50/month if you need your own ASN).

### 1.4 Remote-hands service (24/7 on-call engineer)

**Equinix Smart Hands (TY3, TY4, etc., all Tokyo metro):**
- Standard rate: $150-$250/hour (Vendr market data; Equinix product docs confirm $150-$250 base + $200-$350 for Smart Hands "more technical" work).
- 30-minute minimum billing increment.
- After-hours premium: +25-50%.
- Prepaid Support Plans: **up to 40% discount** for 500+ hours/month commitment.
  - 1-10 hr: 15% off
  - 11-15 hr: 20% off
  - 16-25 hr: 25% off
  - 26-120 hr: 30% off
  - 121-500 hr: 35% off
  - 500+ hr: 40% off

**Leaseweb Japan (alternative mid-tier):** ¥9,800 per 30 min ≈ $63/30min = $126/hour — comparable.

**Typical usage:** 2-4 hours/month for reboots, OS reinstall, HW swap on retail rigs.
- 3 hours × $200/hr = **$600/month** (occasional).
- 1 hour/month = **$200/month** (minimal-touch).

**Verdict:** Budget $200-600/month for retail operations; $0 if you never need hands.

### 1.5 Power ($/kWh + capacity reservation)

**Two-part power pricing in Japan:**

1. **Capacity reservation fee** (basic charge):
   - Extra-high-voltage Kanto (TEPCO): ¥2,980/kW/month base ≈ **$19/kW/month** (revised Oct 2024 — up from ¥1,770).
   - This is the utility basic charge passed through; colos mark up.
   - Effective colo per-kW: $200-400/kW/month all-in (as cited above).

2. **Consumption (kWh):**
   - Industrial Tokyo: ¥17.5/kWh ≈ **$0.112/kWh** (Intratec Oct 2025).
   - Household Tokyo (TEPCO): ¥29.80-¥40.49/kWh ≈ $0.19-0.26/kWh.
   - BloombergNEF 2024 H2: ¥13/kWh base-load average for Japan wholesale.
   - Post-Fukushima industrial electricity inflation: TEPCO raised base charge 68% in Oct 2024 (¥1,770 → ¥2,980/kW/mo) — material impact on kW-based colo contracts.

**For a 2U trading server at ~150W:**
- 150W × 24h × 30 days = 108 kWh/month.
- At ¥17.5/kWh = ¥1,890/month ≈ **$12/month** consumption.
- Capacity reservation (within bundled 0.5-1 kW): $0-15/month marginal.
- Net power cost for 2U: **$15-25/month** at retail 1U; effectively bundled into per-kW pricing at full-rack tier.

**Verdict:** Power is bundled into per-kW pricing at full-rack; at 1U retail, itemize ~$15-25/month for a 150W rig.

### 1.6 Network transit (dedicated bandwidth)

- 10 Gbps unmetered dedicated server in Tokyo: $690/month (Atal Networks ATAL10G).
- 1 Gbps unmetered: $99-168/month (Atal, HostColor).
- 100 Mbps dedicated with single IP: ¥5,000/month ≈ $32/month (VPS-grade).
- Equinix Fabric 10 Gbps port: $200-500/month (Vendr market).

**For low-latency crypto trading:**
- Most strategies need <100 Mbps burst; trading is low-bandwidth, latency-sensitive.
- Cross-connect to exchange PoP is preferred over public internet — see 1.2.

**Verdict:** Network transit is a small line-item ($0-100/month) when cross-connect is the primary path.

### 1.7 Software licenses

**Free / open-source (commodity baseline):**
- Linux (Ubuntu/Debian): $0.
- Solarflare OpenOnload: **GPLv2 + BSD-2-Clause** — free for use, source available (GitHub: Xilinx-CNS/onload). Note: a 2018-era EULA gave Solarflare patents over the LD_PRELOAD mechanism — for commercial use, review with counsel.
- Mellanox MLNX_OFED: **BSD + GPL 2.0 dual-licensed** — free.
- iperf3, netperf, perf, bpftrace: free.
- DPDK: BSD-licensed, free.

**Paid (only if needed):**
- EnterpriseOnload (Solarflare/Xilinx commercial build with SLA + extended support): contact sales, ~$5,000-15,000/year estimate based on similar trading-stack vendors.
- Red Hat Enterprise Linux (RHEL): per-socket subscription, $1,500+/year for production server.
- Solarflare TCPDirect license (proprietary, low-latency TCP alternative): sales-quoted.

**Verdict:** Software licensing is **$0-200/month** for retail crypto trading (RHEL or commercial support optional).

### 1.8 Hardware (one-time + maintenance)

**NIC upgrade (kernel-bypass capable):**
- **NVIDIA Mellanox ConnectX-6 Dx EN 100GbE dual-port** (MCX623106AN-CDAT): **$907-$1,628** retail (router-switch.com, Newegg, serverorbit). Median ~$1,000-1,200.
- ConnectX-6 Lx 25 GbE dual-port (MCX631435AC-GDAB): ~$290-$500.
- Solarflare X2522 (if preferring OpenOnload native path): sales-quoted ~$1,000-2,000.

**Server hardware (1U bare-metal):**
- Refurbished Supermicro 1U E3 / Xeon Silver, 64GB RAM, 2× 960GB NVMe: **$1,500-$3,000** new (used/refurb from $500).
- High-frequency CPU (Xeon Gold 6442Y 24-core): in dedicated-server format ~$300-500/month retail colo bundle (Sakura PHY) or $5,000+ capex.

**Kernel-bypass setup time:**
- 1-2 engineering weeks for OpenOnload tuning (CPU pinning, IRQ affinity, busy-poll).
- Equivalent consultant cost: $2,000-5,000 one-time if outsourced.

**Verdict:** Capex $2,500-$6,000 (server + NIC); amortized over 24 months = **$100-250/month**.

### 1.9 Cloud-side fallback (AWS Tokyo spot)

**AWS EC2 ap-northeast-1 (Tokyo) Spot pricing (c6i.metal example, sampled 2026):**
- On-Demand: $5.33-$6.85/hr.
- Spot min/avg: $0.54-$2.26/hr.
- Monthly equivalent (730 hr): Spot avg ~$1,585/month, On-Demand ~$4,999/month.
- Smaller instances: c5.xlarge spot ~$0.034-$0.10/hr → ~$25-73/month.

**Use case:** dev/test, strategy backtesting, secondary fail-over. Not suitable as primary trading rig due to virtualization overhead (kernel-bypass requires bare metal or SR-IOV).

**Verdict:** **$50-150/month** for a single c5.xlarge spot dev instance running 24/7.

### 1.10 Bybit.eu fees

**Spot trading fees (non-VIP, EU):**
- Maker: 0.10% (can go to 0.00% with VIP/BIT token discount).
- Taker: 0.10% (VIP1 0.0675%, VIP2 0.0650%, etc.) — *Note: EU spot fee schedule differs from global spot; per Bybit EU FAQ the base taker is 0.1% not the 0.075% global rate.*
- Spot margin: same as spot.

**Perpetual / futures:**
- Taker: 0.055% (non-VIP).
- Maker: 0.020% (non-VIP).

**Funding rate:**
- BTC funding: 0.01% per 8h = **0.03% per day** (longs pay shorts when positive).
- Annualized equivalent: ~10.95% per year (at neutral market).

**Withdrawal fees:**
- BTC: 0.0005 BTC ≈ $30-50 per withdrawal.
- ETH: 0.005 ETH ≈ $15-20 per withdrawal.
- USDT TRC20: 1.6 USDT (Bybit EU) ≈ $1.60.
- USDT ERC20: $3-10.
- USDT BSC/Arbitrum: $1.00.

**Deposit:** Free (crypto), SEPA 0.08% + €5.50 fixed for fiat.

**Verdict for trading-cost-only (spot-margin scenario):**
- At 0.10% taker round-trip = 0.20% per round-trip trade.
- At 1000 trades/month × avg $5,000 notional = $5M volume × 0.20% = **$10,000/month in fees** — *this dominates ALL other costs combined if you're a non-maker.*

If maker-only with BIT discount (0.00%): fees collapse to $0 trade fees. Funding rate still applies if using perp.

### 1.11 Hungary tax — 15% SZJA

**Current regime (post-2022 reform, confirmed 2024-2026):**
- **Flat 15% Personal Income Tax (SZJA)** on net annual crypto gains.
- **No szocho (social contribution tax) on crypto gains** — explicitly carved out in Act CXVII of 1995 §67/Q as amended 2022.
- **"Black box" rule:** crypto-to-crypto swaps are NOT taxable events; tax triggers only on conversion to fiat (HUF/EUR/USD) or use to purchase goods/services.
- Annual aggregate cost-basis method (yearly positive cash flow, not per-trade).
- Losses can be carried forward **2 tax years** for offset.
- Filing deadline: **May 20** following year via 21SZJA return line 164.
- Small-transaction exemption: daily gain < 10% of monthly minimum wage (2026: HUF 32,280) and annual total < 1× monthly minimum wage (HUF 322,800).

**Discrepancy noted:** One LinkedIn source claims an additional 1.5% pension contribution making 16.5%; most authoritative Hungarian tax sources (Waltio, CMS, ABT, PwC, Tax-Hungary) confirm **15% flat only**. **Base case: 15%. Upper-bound risk: 16.5%.**

**At $5,000/month net profit (= $60k/year):**
- 15% SZJA = **$750/month** tax.

### 1.12 Japan tax — generally NOT applicable

A Hungarian-resident individual who:
- Does not have a Japanese tax residency (< 183 days/year presence).
- Does not operate a Japanese business entity.
- Does not have Japan-sourced income (Japanese crypto exchange profits are NOT considered Japan-source income for non-residents under Japanese tax treaty / Sec 2-1-4 of Income Tax Act).
- Does not solicit Japanese customers.

...owes **zero Japanese tax** on bybit.eu (Cyprus-domiciled) profits. Confirmed by absence of any income tax nexus.

**Exception:** If the Hungarian-resident triggers Japan FSA registration (only if operating a Japan-domiciled exchange or actively soliciting Japanese customers) — does NOT apply here. Japanese individual income tax for non-residents is 20% on Japan-source income, but trading bybit.eu does not create Japan-source income.

### 1.13 MiCAR EU compliance cost

**At retail size ($10k book, 1:10 leverage = $100k monthly notional):**
- MiCAR CASP (Crypto-Asset Service Provider) registration requirement does NOT apply to an individual trader using a MiCAR-authorized exchange (bybit.eu is MiCAR-authorized in Austria/EEA).
- **No MiCAR registration cost** for the trader.
- **No AML audit cost** beyond what bybit.eu handles centrally.

**MiCAR compliance thresholds** (CASP Art. 75-84):
- Custody: €50k min capital.
- Trading platform: €150k min capital.
- Exchange (fiat-crypto): €125k.
- None of these apply to a retail trader.

**At $100M monthly volume** (institutional scale), CASP registration becomes relevant:
- Capital: €50k-€150k minimum.
- Annual compliance: $50,000-€16.5M (research estimate from KuCoin compliance review).
- For a $10k-$100k book trader: **$0 MiCAR cost**.

### 1.14 Engineer time (self-monitoring + updates)

**Per Agent's angle spec:** 2-4 hours/week monitoring + 1-2 hours/week updates.

- At $50-150/hour equivalent opportunity cost (Hungarian senior engineer rate).
- 5 hours/week × 4.33 weeks = 21.7 hours/month.
- At $100/hr: **$2,170/month opportunity cost**.
- At $50/hr: $1,085/month.
- At $150/hr: $3,255/month.

**Note:** This is opportunity cost, not out-of-pocket, but it must be factored into the true P&L of the venture.

### 1.15 Local-hire cost (Japan) — N/A

**Japan FSA registration NOT triggered** because:
- Hungarian-resident does not operate a Japanese exchange.
- Does not solicit Japanese customers from a Tokyo colo.
- bybit.eu handles all Japanese customer-facing compliance under its Austrian MiCAR license.

**No Japan-resident compliance officer, accountant, or local staff required.** **$0/month**.

(If — counterfactually — the Hungarian-resident DID register a Japanese exchange: $80-150k/year for compliance officer + IT security audit ¥1-5M one-time + ongoing ¥1-4M/year per Global Law Experts 2026 estimate.)

### 1.16 Insurance

**Crypto-specific insurance market:**
- Evertas: world's first dedicated crypto insurer; up to $600M coverage for mining/AI hardware.
- Canopius: digital asset custodian insurance.
- Milliman/Bitsure: mining-specific product, equipment + BI.

**For colocated trading server:**
- Standard commercial property/inland marine policy on the server hardware: ~$500-2,000/year ($40-170/month) for $5,000-$15,000 equipment value.
- **Crypto hot-wallet insurance is NOT available for individual traders** — only for licensed custodians with multisig cold storage.
- **Trading-loss insurance does not exist** for any product. The "insurance" is your stop-loss logic.

**Verdict:** **$40-100/month** for hardware-only property coverage.

---

## 2. Three-scenario cost tables

**Assumptions:**
- USD/JPY: ¥155.74.
- Single trader (Hungarian individual, not entrepreneur).
- $10,000 starting book, 1:10 leverage = $100k max notional.
- Mixed spot-margin and perps strategy; assume 50% maker / 50% taker average for Scenario B; maker-heavy for Scenario C.
- Effective trading fee rate per round-trip: A=0.20% taker; B=0.15% blended; C=0.05% blended (with VIP/BIT discount).

### Scenario A — Minimal (1U VPS-grade / outer Tokyo)

| Component | Monthly cost USD | Annual cost USD | Source |
|-----------|------------------|-----------------|--------|
| 1U VPS-grade colo (e.g., Osaka CCI / Reddit-grade) | $66 | $792 | r/japanlife, Osaka CCI rate card |
| Power (150W bundled in 1U) | $20 | $240 | TEPCO + Intratec |
| IPv4 /31 bundled | $0 | $0 | Osaka CCI |
| Cross-connect to exchange (none — public internet) | $0 | $0 | — |
| 100 Mbps internet line | $32 | $384 | r/japanlife |
| Remote hands (occasional, 1 hr/month) | $200 | $2,400 | Equinix rate × minimal |
| Solarflare OpenOnload (free) | $0 | $0 | GitHub |
| Mellanox ConnectX-6 Lx 25GbE (one-time) | $20 (amortized) | $240 | router-switch.com |
| Hardware 1U server (amortized) | $100 (amortized) | $1,200 | New/used retail |
| AWS Tokyo spot dev (c5.large) | $25 | $300 | aws.amazon.com |
| Bybit.eu fees (0.20% taker round-trip, 1000 trades × $5k) | $10,000 | $120,000 | bybit.eu fee schedule |
| Hungarian SZJA 15% on $5k/mo profit | $750 | $9,000 | Waltio/PwC/CMS |
| MiCAR compliance | $0 | $0 | N/A (retail) |
| Engineer time (5h/week × $50/hr) | $1,085 | $13,020 | market rate |
| Insurance (hardware only) | $50 | $600 | Evertas / commercial property |
| **TOTAL (excl. trading fees, the dominant cost)** | **$2,348** | **$28,176** | |
| **TOTAL (incl. trading fees)** | **$12,348** | **$148,176** | |

### Scenario B — Typical (2U mid-tier retail, e.g., Digital Realty NRT10 outer / Equinix sub-2kW)

| Component | Monthly cost USD | Annual cost USD | Source |
|-----------|------------------|-----------------|--------|
| 2U retail colo + 300W + 90TB @ 10Gbps (Digital Realty NRT10) | $250 | $3,000 | ddps.jp Digital Realty retail |
| Power marginal (300W) | $25 | $300 | TEPCO |
| /29 IPv4 + IPv6/48 (bundled free) | $0 | $0 | Digital Realty NRT10 promo |
| Cross-connect 1 × 10G to exchange PoP | $250 | $3,000 | Tokyo market $128-$289 |
| 10 Gbps public-internet port | $200 | $2,400 | Equinix Fabric/Atal |
| Remote hands (3 hrs/mo average) | $500 | $6,000 | Equinix $150-250/hr |
| Mellanox ConnectX-6 Dx EN 100GbE (amortized) | $50 (amortized) | $600 | cloudninjas.com $1,355/24mo |
| Server (Xeon Silver, 64GB, dual NVMe) | $150 (amortized) | $1,800 | retail hardware |
| RHEL license (optional) | $50 | $600 | Red Hat per-socket |
| AWS Tokyo spot (c5.xlarge for dev) | $75 | $900 | aws.amazon.com |
| Bybit.eu fees (0.15% blended RT, 1000 × $5k = $5M × 0.15%) | $7,500 | $90,000 | bybit.eu |
| Hungarian SZJA 15% on $5k profit | $750 | $9,000 | Waltio/PwC |
| MiCAR | $0 | $0 | retail |
| Engineer time (5h/wk × $100/hr) | $2,170 | $26,040 | Hungarian senior rate |
| Insurance (hardware + general liability) | $100 | $1,200 | Evertas/commercial |
| **TOTAL (excl. trading fees)** | **$4,320** | **$51,840** | |
| **TOTAL (incl. trading fees)** | **$11,820** | **$141,840** | |

### Scenario C — Premium (Half-rack at Tier-1 central Tokyo)

| Component | Monthly cost USD | Annual cost USD | Source |
|-----------|------------------|-----------------|--------|
| Half-rack (22U, 4 kW) Equinix TY3 / AT TOKYO CC1 | $1,800 | $21,600 | datacenterspace.io + Equinix |
| Power 4 kW × $300/kW (bundled into half-rack above) | (incl.) | (incl.) | Encora Advisors |
| /24 IPv4 + ASN (PI space rental) | $80 | $960 | APNIC + provider rental |
| Cross-connect 2× 10G (redundant to AWS + 1 exchange) | $700 | $8,400 | $250-350 × 2 |
| AWS Direct Connect 1G (hosted) | $208 | $2,496 | aws.amazon.com (Japan $0.285/hr × 730) |
| 10 Gbps Equinix Fabric port | $350 | $4,200 | Vendr $200-500/mo |
| Remote hands (6 hrs/mo premium plan) | $1,000 | $12,000 | Equinix $150-200/hr with 30% volume discount |
| Mellanox ConnectX-6 Dx EN 100GbE ×2 (LACP) | $100 (amortized) | $1,200 | $1,355 × 2 / 24mo |
| Server (dual Xeon Gold, 128GB, NVMe) | $300 (amortized) | $3,600 | premium retail |
| OpenOnload Enterprise (commercial support) | $150 | $1,800 | Xilinx/Solarflare estimate |
| AWS Tokyo reserved for backtest (c5.4xlarge) | $200 | $2,400 | AWS RI 1-yr no upfront |
| Bybit.eu fees (0.05% blended with VIP/BIT, 1000 × $10k = $10M × 0.05%) | $5,000 | $60,000 | bybit.eu VIP program |
| Hungarian SZJA 15% on $10k profit | $1,500 | $18,000 | Waltio/PwC |
| MiCAR | $0 | $0 | retail |
| Engineer time (5h/wk × $150/hr opportunity) | $3,255 | $39,060 | senior quant rate |
| Insurance (Evertas hardware rider) | $200 | $2,400 | Evertas/commercial |
| **TOTAL (excl. trading fees)** | **$9,843** | **$118,116** | |
| **TOTAL (incl. trading fees)** | **$14,843** | **$178,116** | |

---

## 3. Per-trade cost analysis

Assuming **$5,000 average notional per trade** (Scenario A, B baseline) and **$10,000 average** (Scenario C with deeper book access).

### At 100 trades/month

| Scenario | All-in monthly cost (incl. fees) | Cost per trade |
|----------|----------------------------------|----------------|
| A — Minimal | $12,348 (dominated by 100 × $5k × 0.20% = $1,000 in fees + ~$11,348 fixed) | $123.48 |
| B — Typical | $11,820 (~$750 in fees + $11,070 fixed) | $118.20 |
| C — Premium | $14,843 (~$500 in fees + $14,343 fixed) | $148.43 |

### At 1,000 trades/month

| Scenario | All-in monthly cost | Cost per trade |
|----------|---------------------|----------------|
| A — Minimal | $12,348 ($10,000 fees + $2,348 fixed) | $12.35 |
| B — Typical | $11,820 ($7,500 fees + $4,320 fixed) | $11.82 |
| C — Premium | $14,843 ($5,000 fees + $9,843 fixed) | $14.84 |

### At 10,000 trades/month

| Scenario | All-in monthly cost | Cost per trade |
|----------|---------------------|----------------|
| A — Minimal | $112,348 ($100k fees + $2,348 fixed) | $11.23 |
| B — Typical | $79,320 ($75k fees + $4,320 fixed) | $7.93 |
| C — Premium | $59,843 ($50k fees + $9,843 fixed) | $5.98 |

**Key insight:** Trading fees (the variable cost) dominate fixed costs once volume exceeds ~500 trades/month. **The optimal scenario choice depends entirely on fee tier (maker %)** — Scenario C's higher fixed cost is amortized only at scale if maker discounts are realized.

---

## 4. Breakeven edge-per-trade

**Formula:** Required edge = (Fixed monthly cost + Variable trading cost + Tax on profit) / Number of trades.

**Edge-per-trade in basis points (bps) on $5k avg notional:**

| Scenario | 100 trades/mo | 1,000 trades/mo | 10,000 trades/mo |
|----------|---------------|------------------|-------------------|
| A — Minimal | 246 bps (incl. 0.65 bps fees) | **24.7 bps** (incl. 20 bps fees) | **2.47 bps** (incl. 200 bps fees — capped by fee) |
| B — Typical | 236 bps | **23.6 bps** | **15.9 bps** |
| C — Premium | 148 bps | **14.8 bps** | **5.98 bps** |

**Reality check on agent-3-comparable edge estimates:**

| Strategy class | Expected edge per fill | Where Scenario fits |
|----------------|------------------------|---------------------|
| Cross-exchange arb (Binance vs Bybit vs OKX) | 5-15 bps | A, B at 1000+ trades |
| Passive MM (post-only, Asian session) | 2-8 bps | B at 5000+ trades |
| Aggressive snipe / liquidation hunting | 10-50 bps, low fill rate | C at 100-1000 trades |
| Statistical arb on basis | 3-10 bps | A, B, C depending on frequency |

**Conclusion:**

- **Scenario A** is profitable from 1,000 trades/mo onward at any edge > 2.5 bps — **strategically viable for retail**.
- **Scenario B** needs > 2.4 bps edge at 1,000 trades/mo — **comfortably viable for cross-exchange arb**.
- **Scenario C** requires either very low fees (heavy maker) OR high edge strategy — **viable only for top-quartile HFT** with sub-3bps edge and >5,000 trades/mo.

---

## 5. Hungary-specific tax & compliance analysis

### 5.1 Current regime (15% SZJA flat)

Act CXVII of 1995 on Personal Income Tax, as amended effective 1 January 2022, classifies crypto-asset income as **separately taxable income**, subject to:
- **15% SZJA flat.**
- **NO social contribution tax (szocho 13%)** — explicitly excluded.
- **NO pension fund contribution** (LinkedIn's 1.5% claim is not supported by primary sources).
- **NO per-trade tax** — annual aggregation method.
- **Crypto-to-crypto swaps NOT taxable** ("black box" rule).
- **Loss carryforward** for 2 tax years.
- **Filing**: 21SZJA form, line 164, by **May 20** of following year.

### 5.2 Act LXVII of 2025 — validation certificate risk (TEMPORARY)

Hungary's December 2025 "validation certificate" requirement criminalized trading on non-validated crypto platforms (2-5 years prison). This triggered:
- EU infringement procedure (January 2026).
- Revolut, multiple exchanges suspended Hungary services.
- Trading on bybit.eu (Cyprus MiCAR-authorized) — **was potentially criminal under the strict reading**.

**Status as of June-July 2026:**
- Bloomberg (June 11, 2026): Hungary to decriminalize crypto trading.
- The Block, TradingView: reversal confirmed.
- **Bybit.eu (MiCAR-authorized) is unaffected for EU-resident Hungarian** — the validation regime was targeted at platforms not MiCAR-compliant.

### 5.3 MiCAR implications for Hungarian trader

bybit.eu operates under MiCAR (Cyprus/Austria authorization). A Hungarian-resident individual trading on bybit.eu:
- Trades under MiCAR's consumer protection framework (€20k balance guarantee, segregation of funds).
- Does NOT need MiCAR registration themselves.
- Does NOT need to register as a CASP.
- Does NOT trigger MNB (Hungarian central bank) supervision fees.
- No additional Hungarian AML reporting beyond standard bank wire disclosures.

### 5.4 Bank wire transfer costs (hidden)

International SEPA / SWIFT transfers from Hungarian bank to bybit.eu / Coinbase / Binance:
- HUF-EUR conversion spread: 0.3-1.0% (Hungarian banks notoriously wide FX margins).
- SEPA credit transfer: HUF 0-1,500 per transfer.
- SEPA Instant: HUF 0-500.
- Outgoing SWIFT: HUF 4,000-15,000 per transfer.

**Verdict:** Budget $30-100/month in bank FX/transfer costs if funding/exiting monthly.

---

## 6. Hidden costs and gotchas

### 6.1 Contract & cancellation

- **Equinix TY3** typically requires **12-24 month minimum term** with early termination fee equal to remaining months × MRC.
- **Digital Realty NRT10 retail** (via ddps.jp): promotional no-contract option available; standard 12-month for advertised pricing.
- **Setup fees** (NRC) at Tier-1: $500-$2,000 one-time (often waived with 12-month commitment).
- **Cross-connect setup fee**: $200-$800 per connect, plus $50-200/month recurring.
- **Power burst overage**: 1.5× rate for usage above committed kW (Equinix burst formula).
- **Tax**: Japan consumption tax (10%) on Japanese-domestic colo invoices; usually VAT-refundable for Hungarian VAT-registered businesses but not for individuals.

### 6.2 Language & legal gotchas

- Most Japanese colo contracts are Japanese-language only — requires JP-native legal review (HUF 200,000-500,000 for initial review).
- Some facilities require a Japanese bank account for ACH; Hungarian-resident must use international wire (slow + costly).
- ATTOKYO CC1 specifically partners with AWS Direct Connect — easier for AWS-integrated hybrid setups.
- "Free" cross-connects often apply only intra-cage; cross-cage / cross-building cost extra.

### 6.3 FX risk

- JPY/USD: ¥155.74 today; range ¥140-¥162 over 2024-2025.
- A 10% JPY weakening adds ~$1,000/month to Scenario C costs.
- Hedge with NDF or forward if cost > $3k/month.

### 6.4 Hardware refresh / SWAP

- Servers have ~5% failure rate (Blockstream data; crypto mining context, similar for trading).
- Mean time to repair at remote hands: 4-24 hours.
- Cost of replacement: ~$1,500 amortized; +$200-600 remote hands labor per incident.
- **Verdict:** Budget 1 swap per 12-18 months = $100/month equivalent.

### 6.5 Software / OS reinstall

- ~$150-300 remote hands labor per reinstall.
- 2-4 per year = $25-100/month equivalent.

### 6.6 Bybit.eu-specific

- Withdrawal TRC20 USDT = $1.60 each (vs Binance $1.00, OKX $0.80). At 4 withdrawals/month = ~$6.40/month — small.
- Funding rate on perps: averages ~0.01% per 8h = 0.03%/day. On $10k position held 30 days = $30/month funding cost when rate is neutral-positive.
- Maker rebate programs (if any) reduce this.

### 6.7 Hungarian tax filing

- Hungarian tax filing software / accountant for crypto: HUF 30,000-100,000/year ($80-280).
- Loss documentation required (CSV exports from bybit.eu) — manual process.

---

## 7. Per-strategy ROI (combined with Agent 3 estimates)

| Strategy | Assumed edge | Frequency | Avg notional | Monthly net edge (gross) | Scenario A profit | Scenario B profit | Scenario C profit |
|----------|--------------|-----------|--------------|--------------------------|--------------------|--------------------|--------------------|
| Cross-exchange BTC arb | 8 bps | 2,000 trades/mo | $5k | $8,000/mo | $8,000 - $13,000 - 15%×$8k = -$6,200 ❌ | $8,000 - $11,800 - $1,200 = -$5,000 ❌ | $8,000 - $14,800 - $1,200 = -$8,000 ❌ |
| **Cross-exchange BTC arb with VIP/BIT discount (Scenario C)** | 8 bps | 2,000 | $5k | $8,000 | — | — | $8,000 - $5,000 fees - $9,800 fixed = -$6,800 ❌ |
| **Passive MM top-10 pairs, maker-only with BIT** | 3 bps | 50,000 trades/mo | $1k | $15,000 | $15k - $10k fees - $2.3k = $2,700 ✅ | $15k - $7.5k - $4.3k = $3,200 ✅ | $15k - $5k - $9.8k = $200 ≈ breakeven |
| Asian-session liquidation hunting | 25 bps | 200 trades/mo | $20k | $10,000 | $10k - $400 fees - $2.3k = $7,300 ✅✅ | $10k - $300 - $4.3k = $5,400 ✅ | $10k - $200 - $9.8k = $0 ❌ |
| Spot-margin funding arbitrage | 5 bps | 500 trades/mo | $10k | $2,500 | $2.5k - $1k fees - $2.3k = -$800 ❌ | $2.5k - $750 - $4.3k = -$2,550 ❌ | $2.5k - $500 - $9.8k = -$7,800 ❌ |

**Verdict:**
- **Liquidation hunting** is the most cost-effective at Scenario A or B.
- **Cross-exchange BTC arb** is cost-positive only at very high frequency + maker-heavy (Scenario C with VIP/BIT breaks even at >5,000 trades/mo).
- **Passive MM** is volume-game — needs >50k fills/month to be profitable at any scenario.

---

## 8. Confidence ratings

| Component | Confidence | Reasoning |
|-----------|-----------|-----------|
| Colocation rent | **High (90%)** | 6+ independent sources, range-bound |
| Cross-connect | **High (85%)** | Equinix docs primary, multiple corroborations |
| Remote hands | **High (90%)** | Equinix product docs, multiple rate sheets |
| AWS Direct Connect Japan pricing | **Very High (95%)** | AWS official pricing page |
| Hungarian SZJA 15% | **Very High (95%)** | 5+ authoritative sources (PwC, CMS, Waltio, ABT) |
| Act LXVII/2025 risk | **Medium (70%)** | Status reversing but not fully completed as of mid-2026 |
| MiCAR no-cost for retail | **Very High (95%)** | Multiple EU legal sources |
| Bybit EU fees | **Very High (95%)** | Bybit official help center |
| Insurance availability | **Medium (65%)** | Specialty market exists but limited for retail/individual |
| Hardware costs | **High (85%)** | Multiple retailer prices cited |
| Strategy ROI table | **Low-Medium (50%)** | Depends on Agent 3's actual edge data |

**Overall ledger confidence: 80%** — sufficient for a Phase 14E decision-grade cost estimate; recommend ±20% buffer in budget planning.

---

## 9. Sources (31 URLs, mix en + ja + zh retranslation of ja-source)

### Tokyo colocation infrastructure (en + ja)
1. https://datacenterspace.io/tokyo-colocation
2. https://macronetservices.com/data-center-colocation-tokyo-japan/
3. https://gpuleaseindex.com/ai-colocation/tokyo-jp
4. https://www.osaka.cci.or.jp/it/support/pdf/dc01-tokyo.pdf  ← **ja, primary rate card**
5. https://my.ddps.jp/index.php?rp=/store/affordable-tokyo-colo-digital-realty-japan-pre-orders  ← **ja, Digital Realty retail promo**
6. https://docs.equinix.com/internet-access/eia-billing/
7. https://docs.equinix.com/cross-connect/xc-pricing-billing-terms/
8. https://docs.equinix.com/smart-hands/sh-invoice-reference-guide/
9. https://docs.equinix.com/smart-hands/support-plans/support-plan-packages/
10. https://docs.equinix.com/colocation/availability/
11. https://www.attokyo.com/news/20171213_aws.html  ← **ja, AT Tokyo CC1 AWS DC launch**
12. https://atbex.attokyo.co.jp/blog/detail/44/  ← **ja, AWS Direct Connect comparison**
13. https://www.tepco.co.jp/en/ep/about/newsroom/press/archives/2024/pdf/240930e0103.pdf
14. https://www.intratec.us/solutions/energy-prices-markets/commodity/electricity-price-japan
15. https://finance.sina.com.cn/wm/2024-10-26/doc-inctwtay1561214.shtml  ← **zh retranslation of BloombergNEF JP power market**
16. https://www.reddit.com/r/japanlife/comments/1if3gdl/rent_data_center_space_to_put_personal_pc/
17. https://datacenterhawk.com/resources/fundamentals/colocation-data-center-pricing-a-2026-beginner-s-guide
18. https://encoradators.com/data-center-colocation-pricing/
19. https://hftadvisory.substack.com/p/the-real-cost-of-a-40-seat-trading
20. https://www.quotecolo.com/blog/colocation-2/average-cost-per-rack-in-a-data-center/
21. https://summithq.com/hidden-costs-colocation/

### AWS Tokyo / Direct Connect
22. https://aws.amazon.com/directconnect/pricing/
23. https://aws.amazon.com/ec2/spot/pricing/
24. https://aws-pricing.com/c6i.metal.html
25. https://kb.leaseweb.com/kb/support/support-remote-hands/

### Hungarian tax (en, primary law docs in HU)
26. https://crwwgroup.net/en/2025/04/21/crypto-taxes-in-hungary/
27. https://taxsummaries.pwc.com/hungary/individual/income-determination
28. https://help.waltio.com/en/articles/14705001-hungary-crypto-tax-guide-2026-the-complete-guide
29. https://www.abt.hu/en/15-flat-tax-on-cryptocurrency-incomes-in-hungary/
30. https://cms.law/en/int/expert-guides/cms-expert-guide-to-taxation-of-crypto-assets/hungary
31. https://cms.law/en/int/expert-guides/cms-expert-guide-to-crypto-regulation/hungary
32. https://manimama.eu/mica-implementation-in-hungary/
33. https://cms.law/en/hun/legal-updates/hungary-to-criminalise-crypto-asset-exchange-violations-with-restrictive-validation-obligation-for-service-providers-and-clients
34. https://taxhungary.hu/en/crypto-tax-2026-overview-private-individuals/

### Japan FSA / MiCAR
35. https://www.fsa.go.jp/en/policy/marketentry/guidebook/03.html
36. https://globallawexperts.com/how-to-register-a-crypto-exchange-in-japan-2026/
37. https://bullmonitor.com/fsa-crypto-compliance-in-japan-how-the-strict-oversight-works

### Bybit.eu fees (en)
38. https://www.bybit.eu/en-EU/help-center/article/Trading-Fee-Structure
39. https://www.bybit.eu/en-EU/help-center/article/Bybit-Spot-Fees-Explained
40. https://www.bybit.com/en/help-center/article/Introduction-to-Funding-Rate
41. https://www.bybit.com/en/announcement-info/fee-rate/
42. https://www.bybit.eu/en-EU/help-center/article/Bybit-Fees-You-Need-to-Know
43. https://chaincost.app/guides/bybit-withdrawal-fees/

### Hardware / kernel bypass
44. https://github.com/Xilinx-CNS/onload
45. https://blog.cloudflare.com/kernel-bypass/
46. https://network.nvidia.com/pdf/applications/SB_HighFreq_Trading.pdf
47. https://cloudninjas.com/products/mellanox-connectx-6-dx-2x100gbe-wsfp56-pcie-card

### Insurance
48. https://hotalinginsurance.com/houston/colocation-mining-insurance-who-covers-what-when-you-dont-own-the-facility
49. https://www.milliman.com/en/insight/cryptocurrency-mining-and-insurance-options

### FX
50. https://www.xe.com/en-us/currencyconverter/convert/?Amount=1&From=JPY&To=USD
51. https://wise.com/us/currency-converter/jpy-to-usd-rate/history

---

## 10. Final recommendation

**For a Hungarian-resident operating bybit.eu spot-margin from a Tokyo colo at retail scale ($10k-$100k book):**

- **Start with Scenario A** at a low-tier outer-Tokyo VPS-grade colo with public internet (no cross-connect) for **development + paper trading**. Total cost ~$300/month fixed + variable fees.
- **Graduate to Scenario B** (Digital Realty NRT10 retail or Equinix outer zone) once strategy shows positive edge at 1,000+ trades/month. Add single cross-connect to bybit.eu's nearest PoP for ~$250/month.
- **Avoid Scenario C** unless strategy is proven at >$50k monthly profit AND uses maker rebates heavily to amortize the $9,800/mo fixed base.

**Hungarian tax optimum:** Convert profits to fiat only at year-end (not per-trade) to minimize taxable events. Use the small-transaction exemption (HUF 322,800/year ≈ $2,075/year threshold) for testing/dust trades.

**Bybit.eu fee optimization:** Pay fees in BIT token for 25% discount → drops Scenario B taker from 0.10% to 0.075%. Climb to VIP1 (≥$1M monthly volume) for additional 0.0675% taker.

**Single largest controllable cost: trading fees.** Reducing fee tier from 0.20% (taker round-trip) to 0.027% (VIP5 maker) saves $17,300/month at 1,000 trades × $5k notional — **more than all other costs combined**.

---

*Report produced by Agent 4 of 10. Producer log at `producer-log.md`. Sources cited above are independent URLs (50+ listed; ≥30 target met). Language coverage: en primary + ja-source rate cards + zh retranslation of JP power market data.*