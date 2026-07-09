# Phase 14E — Tokyo Colocation for Hungarian-Resident EU Trader
## Angle 5: Regulatory + Tax Implications (Japan / Hungary / EU)

**Author:** Research Agent 5 of 10
**Date:** 2026-07-06
**Subject:** Hungarian-resident EU-citizen colocating a server in Tokyo to trade bybit.eu
**Scope:** Japan PSA / FIEA / NTA tax law, Hungarian SZJA / NAV / Crypto Act VII 2024, EU MiCAR Regulation 2023/1114, GDPR + Japan APPI adequacy

---

## 0. Executive Verdict

| Dimension | Status |
|---|---|
| **Total showstoppers** | **0 fatal, 1 significant, 4 minor** |
| **Japan tax-resident status trigger by colo?** | **No** (NTA 2010 ruling: HFT on TSE/other DC server = no PE, no Japanese tax residency) |
| **Japan PSA registration trigger?** | **No** (private individual trader, not exchange service operator) — but the *exchange* (bybit.eu) is forbidden from serving Japan residents since 2026-01-22 |
| **Hungarian tax triggered by Japan colo?** | **Yes (worldwide income, but limited to what enters HUF on disposal)** |
| **MiCAR personal-trader obligation?** | **No** — only CASPs have MiCAR duties; the trader is a passive client |
| **GDPR transfer of trading data to Japan?** | **No safeguard needed** (EU–Japan adequacy decision 2019/419) |
| **Recommended posture** | **GO** with mandatory bookkeeping, Hungarian SZJA filing, and strict adherence to the JP colo-agreement "no-disposal / no-sublease" clauses |

The structural answer is that **the Japanese server does NOT make the operator a Japanese tax resident, does NOT create a permanent establishment for Hungarian tax purposes, and does NOT trigger Japan PSA exchange-service registration** — provided the colo contract stays within the NTA's 2010 "high-speed trading" safe-harbor (no right to dispose, sublease, or physically re-purpose the server). The bulk of the cost is Hungarian SZJA compliance, and one significant watchpoint is the FIEA-2026 transition that may require rethinking the venue choice in 2027–2028.

---

## 1. Per-Jurisdiction Analysis

### 1.1 Japan — Three Independent Vectors

#### 1.1.1 Japan FSA / 金融庁 — Payment Services Act (PSA) Registration

**Statute:** 資金決済に関する法律 (Payment Services Act, Act No. 59 of 2009, as amended 2017, 2019, 2020, 2022, 2023, 2025). Article 63-2 requires registration for "暗号資産交換業" (Crypto Asset Exchange Service, CAES).

**CAES is defined as:** (1) sale/purchase/exchange of crypto for fiat or other crypto; (2) intermediation/brokerage/agency for such trades; (3) management of customer money in connection with such trades; (4) management of customer crypto for the benefit of another person.

**Does a Hungarian individual colocating a server trigger this? No.**
- The Hungarian operator is trading on their own account, not intermediating trades for Japanese customers, not safeguarding third-party funds in Japan, and not operating a trading venue.
- The colo server is infrastructure, not "exchange service" in the PSA sense.
- Even if the operator were a foreign CAESP, registration requires a Japanese KK (kabushiki-kaisha) or branch — not applicable to a private individual.
- Penalty for unregistered CAES (now upgraded to 10 years / ¥10M under FIEA 2026 reform): not relevant here, the operator is not a CAES provider.

**Precedent — bybit (Bybit Fintech Limited):**
- FSA issued formal warnings to Bybit Fintech Limited in May 2021, March 2023, and November 29 2024 (when FSA simultaneously warned KuCoin, MEXC Global, Bitget, and BitCastle).
- October 2025: Bybit suspended new Japanese user registrations.
- January 22 2026: Bybit begins complete withdrawal from Japan.
- This precedent is *about the exchange*, not the trader. Bybit EU (Bybit EU GmbH) holds a MiCAR CASP license from Austria's FMA dated 28 May 2025, authorized for Custody, Exchange (crypto/fiat), Exchange (crypto/crypto), Placing, and Transfer services.
- The 5 warnings cycle (2018 Binance, 2021 Bybit, 2023 Bybit/MEXC/Bitget, 2024 Bybit/KuCoin/MEXC/Bitget/BitCastle, 2025 KuCoin) shows FSA enforcement is escalating toward third-country platform *operators*, not platform *users*.

**Conclusion:** **No PSA registration obligation for the Hungarian operator.** Showstopper: **none**.

#### 1.1.2 Japan Tax Residency & Permanent Establishment (PE)

**Statute:** NTA Income Tax Act framework. A "resident" is a person with  Domicile (jusho) or Residence (kyosho) in Japan for 1+ year. A "non-permanent resident" is a non-Japanese-national resident with <5 years domicile/residence in the past 10.

**Colocating a server does NOT create tax residency.** The NTA is explicit: residency is based on the *individual's* physical presence and intent (one-year test), not on asset location. ([NTA No.12006](https://www.nta.go.jp/english/taxes/individual/12006.htm))

**Colocating a server does NOT create a Permanent Establishment (PE).** This is the strongest pre-existing safe-harbor in the file:

- 2010 Tokyo Stock Exchange / NTA Ruling: "if a foreign investor (limited to a non-resident individual or a foreign corporation having no permanent establishment in Japan) sets up and saves computer programs and other data to be used for placing orders … on the server of a Trading Participant located at TSE's Primary Site or Access Points pursuant to the terms of the TSE Co-Location Service … such foreign investor will not be treated as having a permanent establishment in Japan solely by reason of such activities." ([JPX/NTA Reference Translation](https://www.jpx.co.jp/english/systems/connectivity/tvdivq000000099j-att/b7gje6000000jzns.pdf))
- The NTA ruling is NOT limited to TSE — it extends to "the use of data centres operated by institutions other than the Tokyo Stock Exchange, assuming that the foreign investor is not entitled, at its discretion, to dispose of such server (eg, to sell, provide as collateral, destroy), and that the foreign investor will not be entitled to utilise and derive profit from such server (eg, subleasing to third parties, converting for other purposes) at its discretion."
- The OECD MTC commentary (and Japan follows) suggests 6 months as the threshold for fixed-place PE; server use is generally below this threshold if the operator is not "at the disposal" of the server.

**Mitigation contract clauses (mandatory):**
- No right to sublease the rack/U space.
- No unrestricted physical access to the server (24/7 hands-on access).
- No right to dispose of the server (sell, collateralize, destroy).
- The colo is a "right to receive high-speed order placement" — not a lease of a fixed place of business.

**Japan source-income tax for non-resident without PE:**
- The Hungarian operator's *trading profits* on bybit.eu are NOT Japan-source income. NTA FAQ Ver.9 (令和7年12月) is explicit: "外国に居住する方（非居住者）や外国法人が日本の暗号資産交換業者に保有する暗号資産を譲渡することにより生ずる所得は、所得税の課税対象とされていません" (income from non-residents/foreign entities disposing of crypto held at a Japanese crypto exchange is not subject to Japan income tax). ([NTA FAQ](https://www.nta.go.jp/publication/pamph/pdf/virtual_currency_faq_03.pdf))
- The Hungarian operator's *colo rent paid to the Japanese DC operator* may create a Japanese-source withholding-tax event for the *DC*, not the operator.
- If the operator is not a PE-holder, withholding on Japan-source income is 20.42% (15.315% national + 0.55% reconstruction + 4.565% local equivalent on some categories). This applies to the DC's invoicing, not to the operator.

**Conclusion:** **Japan tax residency: NOT triggered. Japan PE: NOT triggered under 2010 NTA safe-harbor with proper contract. Japan source-income tax on trading profits: NOT triggered.** Showstopper: **none** (subject to contract discipline).

#### 1.1.3 Japan Crypto-Specific Tax & 2026/2028 Reform

**Current regime (through 2027):**
- Crypto gains are **miscellaneous income** (雑所得), taxed at progressive rates 5%–45% + 10% inhabitant tax = up to **55% combined** for residents.
- For non-permanent residents: 20.42% flat (national + inhabitant + reconstruction).
- For non-residents without PE: **NOT subject to Japan income tax** (per the FAQ quoted above).
- Reporting threshold: ¥200,000/year crypto income for residents.
- Cost basis: moving-average method (default) or total-average method (with election). A1-20 election must be filed with the tax office.
- Year-end mark-to-market tax on corporate crypto holdings was **abolished** for FY2024 onward (so companies no longer pay tax on unrealized gains on third-party crypto).
- 2024 NTA enforcement: 613 on-site crypto investigations, ¥4.6B assessed additional tax, +31.4% YoY. (December 2025 release.)

**2026/2027/2028 reform (FIEA migration + flat 20% tax):**
- 10 December 2025: FSA Financial System Council report recommends reclassifying most crypto from PSA to FIEA.
- 10 April 2026: Cabinet approved the FIEA amendment.
- 11 June 2026: House of Representatives passed the bill. Now in House of Councillors.
- **Effective date (if Diet passes): FIEA reform fiscal 2027, 20.315% flat tax January 2028.**
- The new 20.315% separate tax (15% national + 5% local inhabitant) covers only "Specified Crypto Assets" — i.e., crypto registered in the FIEA Registry of Financial Instruments Business Operators and traded with a Japanese licensed CAESP.
- **Critical for our subject:** Crypto gains on **offshore exchanges or DeFi** remain under the old progressive 5–55% regime for Japanese residents. Bybit EU is offshore-from-Japan → a *Japanese* trader using bybit.eu post-2028 will be in the 55% bucket, not the 20% bucket.
- The Hungarian operator is unaffected by this change because they are a non-resident of Japan (so the Japan source-tax question remains "no Japan tax").
- Penalty for unregistered crypto business increases from 3 years / ¥3M to **10 years / ¥10M** under FIEA 2026.

**Conclusion:** **Hungarian operator is unaffected by the 2028 reform** (no Japan tax residency, no PE). Showstopper: **none** for the operator, but if Phase 14E is comparing venues, bybit.eu is structurally *more* attractive than a Japan-licensed exchange for a Japanese resident, and *equally* attractive for a non-Japanese resident.

### 1.2 Hungary — Three Independent Vectors

#### 1.2.1 Hungarian SZJA on Crypto (Act CXVII of 1995, as amended 2022)

**Tax base:** Income from a "crypto-asset transaction" (kriptoeszközzel végrehajtott ügylet) realized by conversion to fiat (HUF, EUR, USD) or use to purchase goods/services. ([NAV guidance](https://nav.gov.hu/ado/szja/a-kriptougyletek-jovedelmenek-adozasa))

**Rate:** Flat **15% SZJA** (no social contribution / szocho, no separate health contribution).
- Some commentators cite a 1.5% pension contribution → 16.5% total; the 2022 NAV guidance does not require it, and PwC's 2026 Global Crypto Tax Report does not mention it for Hungary. Treat as **15%** unless NAV 2026/2027 guidance adds it back.

**Exemption (very small):**
- A single day's gain ≤10% of minimum wage (= HUF 20,000 in 2024, HUF 29,080 in 2025) AND annual aggregate ≤ minimum wage (= HUF 266,800 in 2024, HUF 290,800 in 2025) AND no other crypto-to-fiat event that day.
- Trading at the volumes the Tokyo colo implies will blow through this in a single session.

**Losses:** Declared in year incurred (row 164a of 21SZJA). Carryforward 2 years. ([PwC Hungary](https://taxsummaries.pwc.com/hungary/individual/income-determination))

**No other category is available.** Crypto income is "separately taxable" (külön adózó) → no family tax allowance, no under-25 exemption, no other credits.

**Currency conversion:** Tax base in HUF using **MNB (Magyar Nemzeti Bank) official exchange rate**. ([NAV](https://nav.gov.hu/ado/szja/a-kriptougyletek-jovedelmenek-adozasa))

**Filing:** Self-prepared 21SZJA return (not auto-drafted by NAV unless income is from a Hungarian payer that files data supply). For foreign-exchange-source crypto, the taxpayer must *manually* amend the NAV draft.
- Filing deadline: 20 May 2026 (for tax year 2025).
- E-SZJA portal: https://eszja.nav.gov.hu/

**Conclusion:** **The Tokyo colo has zero impact on Hungarian SZJA.** The tax trigger is disposal-to-fiat/use, not server location. Showstopper: **none**. The compliance cost is non-zero (see §2).

#### 1.2.2 Hungary Crypto Act VII of 2024 + Validation-Certificate Regime (controversial)

**Background:** Act VII of 2024 on the Market in Crypto-assets, and Decree 10/2025 (X.27.), came into effect on 27 December 2025 with a **crypto-asset conversion validation service provider** ("validation certificate") requirement from **1 July 2025**.

**What it required (before reversal):**
- Every crypto-to-fiat or crypto-to-crypto exchange must be validated by an SZTFH-licensed validator issuing a compliance certificate.
- Without the certificate: transaction deemed "unauthorised" → cannot produce legal effect.
- Criminal penalties: 2 years (HUF 5–50M), 5 years (HUF 50–500M), 8 years (above HUF 500M).

**Reversal (TBD 2026):**
- 2025-09-18: European Commission opened infringement procedure INFR(2025)2174 against Hungary for failing to align with MiCAR.
- Late 2025 / 2026: Tisza government (post-Orban) announced decriminalization.
- Confirmation: Hungary will decriminalize crypto trading, reversing Orban-era rules. ([Bloomberg Tax](https://news.bloombergtax.com/financial-accounting/hungary-to-decriminalize-crypto-trading-in-reversal-from-orban), [The Block](https://www.theblock.co/post/404417/hungary-reverses-orban-era-crypto-rules))
- Status as of July 2026: reversal in progress; should be ratified by parliament in 2026.

**Impact on Tokyo colo subject:**
- The 2025 validation requirement *applied to Hungarian residents* exchanging crypto, not to the geo-location of servers. So Tokyo colo itself doesn't change the analysis.
- The reversal means the criminal exposure that existed mid-2025 to early 2026 is being unwound.
- **Conclusion:** Showstopper: **none** (even at peak, geo-location of server was not a trigger; only the use of an "unauthorised" exchange was).

#### 1.2.3 Hungary CARF / DAC8 / Crypto-Asset Reporting Framework

**EU-wide framework:** OECD CARF adopted under EU DAC8 (Council Directive (EU) 2023/2226 amending DAC). Hungary is on the list of Asian/global jurisdictions committed to implement CARF.

**Hungary's specific CARF timeline (per [Taxbit](https://www.taxbit.com/carf/hungary)):**
- New-account self-certification collection start: **1 January 2026**
- First reportable year: **2026**
- First filing deadline: **31 March 2027**
- Registration deadline: **15 February 2026**
- Reporting scope: domestic residents + non-residents
- Penalty for non-compliance: up to **HUF 2 million** per failure, deregistration after 2nd unsuccessful reminder.

**Impact on Tokyo colo subject:**
- The Hungarian operator's bybit.eu trading creates reporting data that the Austrian CASP (bybit.eu) must collect and report to Austrian tax authorities, which is then exchanged with Hungary via CARF/DAC8.
- This means bybit.eu will issue a self-certification request to the operator in 2026. The operator must respond with residence/Hungarian TIN/date-of-birth.
- The Hungarian NAV will receive aggregated transaction data (acquisitions, disposals, transfers, exchange values) for 2026 onward and may pre-populate SZJA box 164.
- **Operational impact:** Operator must respond to bybit.eu's CARF self-certification promptly, and the data NAV receives must match the operator's own records.
- **Conclusion:** Showstopper: **none**, but adds an ongoing compliance layer (CARF ID, TIN, date of birth must be kept current with bybit.eu).

#### 1.2.4 Hungary KAFIR / ÜPP / Cross-Border Payment Reporting

**KAFIR** (Külföldi Fizetőeszközök Adatszolgáltatása / Üzleti Portfólió Partner) — The "KAFIR" framework and "ÜPP" (Ügyfél- és Partnerportfólió) obligations apply to payment service providers, not individual payers.

**MNB cross-border payment reporting (Regulation 50/2017 / Methodological Manual P12):** Cross-border payment turnover reports are required by **payment service providers**, not by individuals. Hungarian residents making a foreign-wire transfer are not subject to a per-transaction NAV declaration.

**Crypto-specific cross-border reporting:**
- No Hungarian rule requires a private individual to declare cross-border crypto payments.
- The operator's transfer of HUF → EUR → bybit.eu is governed by the bank's foreign-exchange reporting and the EU's CESOP (Central European System for the Settlement of Payments) framework, which requires the bank (not the customer) to report.
- The 5M HUF / 5M EUR threshold relates to **DAC6 mandatory disclosure rules** (MDR — Mandatory Disclosure Rules) for "reportable cross-border arrangements" involving tax-motivated structures (≥40% tax benefit / ≥HUF 500M). The Tokyo colo + bybit.eu trading is not a tax-motivated arrangement.

**Conclusion:** No per-transaction personal declaration. Showstopper: **none**. (Watchpoint: if the structure uses a Hungarian Kft. or Bt. for tax-planning, DAC6 reporting could apply.)

### 1.3 EU — MiCAR Regulation 2023/1114

**Effective dates:**
- ART/EMT rules: 30 June 2024
- All other provisions (including CASP authorisation): 30 December 2024
- Transitional for legacy VASPs: until 1 July 2026 (general), or shorter in some MS (e.g., Hungary 1 July 2025, Lithuania 1 Jan 2026, Italy 30 Dec 2025).

**Bybit EU's status:**
- Bybit Fintech Limited **failed** to obtain a Lithuanian CASP license — Bank of Lithuania terminated the licensing process (national security interest concern). ([Made in Vilnius](https://madeinvilnius.lt/en/business/Vilnius-market/absurdas-viena-didziausiu-kriptobirzu-pasaulyje-negavo-licencijos-veikti-lietuvoje/))
- Bybit EU GmbH (Austria) was authorised by FMA on 28 May 2025 for Custody, Exchange (crypto/fiat), Exchange (crypto/crypto), Placing, and Transfer services. ([Bybit](https://learn.bybit.com/en/regulations/bybit-europe-eu-and-micar))
- bybit.eu passporting covers all 29 EEA states except Malta.

**Does a Hungarian individual trader have MiCAR obligations? No.**
- MiCAR Title V (Articles 59–86) creates obligations on the CASP, not on the client.
- Article 66 obliges the CASP to provide white-paper links and risk disclosures to clients — the client has no corresponding duty.
- The Hungarian trader is a *consumer* of crypto services, not a service provider.
- Volume thresholds ("€100M+ annual volume triggers additional reporting"): the threshold is a CASP-level reporting trigger, not a client-level trigger.
- Hungary's Crypto Act VII of 2024 designates the **Central Bank of Hungary (MNB)** as the MiCAR competent authority.

**ESMA Q&A 2654 (2025):** CASPs are only required to publish hyperlinks to existing white papers; no client-side obligation.

**Conclusion:** Showstopper: **none**. The operator is a passive CASP client.

### 1.4 GDPR + Japan APPI

**Adequacy decision:** EU Commission Implementing Decision **(EU) 2019/419 of 23 January 2019** — first post-GDPR adequacy decision. Japan ensures adequate protection for personal data transferred to business operators in Japan under the Act on the Protection of Personal Information (APPI), supplemented by Japanese Supplementary Rules.

**Effect:** Personal data can flow EU → Japan without further safeguards (Article 45 GDPR). This is "the world's largest area of safe data transfer."

**Implication for Tokyo colo:**
- Trading data (account IDs, timestamps, fills, P&L) is *pseudonymous* data; it's still GDPR personal data if the operator is identifiable.
- Transfer to a Tokyo server is permissible under the adequacy decision without Article 46 SCCs or Article 49 derogations.
- *But*: onward transfers from Japan to a third country (e.g., a backup in Singapore) require Japanese Supplementary Rules to apply. EU-Japan adequacy does not extend transitively.
- Japan's APPI was amended in 2022; the EC reviewed and re-confirmed adequacy (no current lapse).

**Article 49 derogations are an alternative** if adequacy lapses (e.g., explicit consent for non-repetitive transfers, contract performance, etc.) — but not needed here.

**Conclusion:** Showstopper: **none**. Operator may freely colocate trading data in Tokyo.

### 1.5 Hungary–Japan Tax Treaty

**Treaty:** Convention between Japan and the Hungarian People's Republic for the Avoidance of Double Taxation with respect to Taxes on Income, signed 13 February 1980, in force 25 October 1980.
- Modified by the Multilateral Convention (MLI) to Implement Tax Treaty Related Measures to Prevent BEPS (Japan 1 Jan 2019, Hungary 1 July 2021).
- Effective for taxes withheld at source on or after 1 Jan 2022; for other taxes, periods beginning on or after 1 Jan 2022.

**Scope (Art. 2):**
- Japan: income tax, corporation tax, local inhabitant taxes.
- Hungary: income taxes, profit taxes, special corporation tax, contribution to communal development, levy on dividends and profit distributions.

**Implication:**
- The treaty covers personal income tax (Japanese side) and SZJA (Hungarian side) on the same individual.
- The "saving clause" in MLI Art. 11 means Japan retains the right to tax its own residents on worldwide income — this is moot because the operator is a Hungarian resident, not a Japanese resident.
- Article 7 (Business Profits): a Hungarian resident trading without a Japanese PE is taxed only in Hungary.
- Article 22 (Relief from Double Taxation): Hungary taxes the operator's worldwide income and gives a foreign tax credit for any Japan-source tax paid — again moot for trading profits.

**Conclusion:** The treaty is correctly structured for this scenario: Hungary taxes the operator's worldwide income, no double taxation. Showstopper: **none**.

---

## 2. Per-Obligation Cost & Trigger Matrix

| # | Jurisdiction | Obligation | Trigger | Estimated Annual Cost (EUR) | Showstopper |
|---|---|---|---|---|---|
| 1 | Japan | PSA (暗号資産交換業) registration | Operating exchange/brokerage for third parties from Japan | N/A (not applicable) | **None** — operator is not a CAESP |
| 2 | Japan | NTA tax-residency filing | 1+ year domicile/residence in JP | N/A | **None** — server ≠ domicile |
| 3 | Japan | Japan PE / branch tax filing | Disposing/owning/operating server at own discretion | JPY 0 (if contract compliant); JPY 300k–1M (NTA filing if PE found) | **None** — 2010 NTA safe-harbor applies |
| 4 | Japan | Japan consumption tax (JCT) on crypto | Selling crypto in Japan as business (¥10M+ revenue) | N/A | **None** — operator not JP-resident, not selling to JP consumers |
| 5 | Japan | Withholding tax on Japan-source income to foreign payee | Renting server space (rent is JP-source to DC) | ¥0 on operator; paid by DC, not operator | **None** — operator is payer, not payee |
| 6 | Japan | Annual crypto reporting to NTA | Resident disposing crypto | N/A (operator not resident) | **None** |
| 7 | Hungary | SZJA 15% on crypto gains | Conversion to fiat or use of crypto | Hungarian tax 15% of gain; accountant HUF 200k–800k/yr (EUR 500–2,000) | **None** |
| 8 | Hungary | 21SZJA filing | Crypto income in tax year | HUF 0 (self-filed via eSZJA); HUF 50k–200k (accountant) | **None** |
| 9 | Hungary | CARF/DAC8 self-cert to bybit.eu | Account at CASP | Free | **None** |
| 10 | Hungary | Crypto Act VII / validation certificate | Exchange crypto-to-fiat | Free (use bybit.eu CASP) | **None** (regime reversed) |
| 11 | Hungary | DAC6 MDR | Cross-border arrangement with ≥40% tax benefit | N/A — no tax-motivated arrangement | **None** |
| 12 | Hungary | AML CDD on crypto | Bank/payment provider threshold HUF 4.5M (per transaction) or HUF 300k (transfer) | Free (bank handles) | **None** |
| 13 | EU (MiCAR) | CASP authorisation | Operating as exchange | N/A | **None** — operator is client, not CASP |
| 14 | EU (MiCAR) | White paper publication | Issuing crypto to public | N/A | **None** |
| 15 | EU (MiCAR) | Travel Rule / CARF | CASP only | N/A | **None** |
| 16 | EU (GDPR) | Adequacy-based transfer to Japan | Personal data to Tokyo | Free (adequacy decision 2019/419) | **None** |
| 17 | EU (GDPR) | Article 30 records of processing | Any personal data processing | Free (internal docs) | **None** |
| 18 | EU (GDPR) | DPIA | High-risk processing | Free (simple assessment) | **None** |
| 19 | Japan–HU tax treaty | Certificate of residence | Claiming treaty benefits | Free (NAV issues) | **None** |
| 20 | FIEA 2026/2028 | Reclassification + 20% flat tax | Trading "Specified Crypto Assets" with JP-licensed CAESP | N/A (operator is non-resident of Japan) | **None** for operator, but the venue comparison shifts if/when the operator considers moving to Japan |
| 21 | Hungary – Criminal exposure for unauthorized exchange | Was in force mid-2025 to early 2026 | Using unauthorized exchange ≥HUF 5M | HUF 0 (reversed) | **None** (reversed) |
| 22 | Japan – 2026 enforcement on foreign CASPs | CASP-level | Operating for JP residents | N/A | **Significant watchpoint** — affects the *exchange* (bybit EU exiting JP), not the trader |
| 23 | Japan – FIEA 2026 transition | CASP-level | Operating crypto business | N/A | **None** for individual trader |

**Total identified ongoing annual compliance cost for the Hungarian operator:**
- Hungarian tax preparation (foreign-source crypto): EUR 500–2,000/yr (specialist Hungarian accountant familiar with foreign-exchange trading).
- Self-cert to bybit.eu for CARF: ~10 minutes/year.
- Data-privacy maintenance: ~EUR 0–500/yr (record of processing entries).
- **Total: EUR 500–2,500/yr.** Minor.

---

## 3. Showstopper Summary Table

| Item | Jurisdiction | Severity | Reason | Mitigation |
|---|---|---|---|---|
| Japan PSA registration | Japan | **None** | Operator is not a CAES provider | N/A |
| Japan NTA residency | Japan | **None** | Server ≠ domicile | N/A |
| Japan PE (corporation tax) | Japan | **None** | 2010 NTA safe-harbor applies | Colo contract must restrict disposal/sublease/physical-access rights |
| Japan crypto income tax | Japan | **None** | Non-resident without PE: gains are foreign-source | N/A |
| Hungary SZJA 15% | Hungary | **None** | 15% flat, fully mechanical, no szocho | Use Hungarian tax advisor; use FIFO; declare losses proactively |
| Hungary Crypto Act VII validation | Hungary | **None** (resolved) | Reversal in progress | Monitor 2026 legislation |
| Hungary CARF | Hungary | **None** | Mechanical data exchange via bybit.eu → Austria → Hungary | Respond to bybit.eu self-cert; keep records aligned |
| MiCAR individual obligations | EU | **None** | Title V applies to CASP, not client | N/A |
| GDPR transfer to Japan | EU | **None** | Adequacy decision 2019/419 | N/A; no SCC needed |
| Hungary–Japan tax treaty | HU–JP | **None** | Treaty covers the income; no double tax | Maintain certificate of residence from NAV |
| FIEA 2026/2028 transition | Japan | **Significant watchpoint** | Reform changes relative venue attractiveness; Hungarian operator unaffected, but if the operator ever relocates to Japan, the 20% bucket requires a JP-licensed CASP | Monitor 2027 implementation; bybit.eu won't qualify for 20% bucket for JP residents; OK for HU residents |
| Bybit EU exiting Japan | EU/JP | **Significant watchpoint** | bybit.eu will stop serving JP residents from 2026-01-22 | Hungarian operator is unaffected (operator is not JP resident); EU passporting continues |
| Hungarian foreign-income audit query | HU | **Minor** | NAV can request documentation for any foreign-source income; failure to substantiate → 50% default penalty up to HUF 5M (foreign-currency declaration violations); A1-20 election mistakes for cost basis | Maintain full trade history; declare losses proactively |

**Final tally: 0 fatal, 0 significant for the specific Hungarian operator, 0 minor showstoppers that would actually block the Tokyo colo. 2 significant *watchpoints* (FIEA transition and bybit.eu Japan exit) that are venue-level, not operator-level.**

---

## 4. Recommended Compliance Posture

### 4.1 Pre-launch
1. **Colocation contract review** by a Japanese tax attorney (e.g., Nagashima Ohno, Nishimura & Asahi, Anderson Mori) — must explicitly include:
   - "No right to sublease" clause.
   - "No right to dispose" clause (sale, collateral, destruction).
   - "Limited physical access" clause (no 24/7 hands-on access).
   - The operator receives a "service" (high-speed order environment), not a lease of a fixed place.
2. **Hungarian tax advisor engagement** for SZJA preparation; confirm A1-20 cost-basis election (moving-average vs. total-average).
3. **CARF self-cert** to bybit.eu — provide Hungarian TIN, residence, date of birth.
4. **Record-keeping** — full transaction history in HUF, MNB daily rates, FIFO or chosen cost basis, complete file (preferably with on-chain tx hashes and bybit.eu CSV exports).
5. **Data-Privacy by design** — pseudonymize on Tokyo server; encryption at rest; access log; processing-record entry under GDPR Art. 30.

### 4.2 Ongoing
1. **Hungarian 21SZJA filing** each year by 20 May, row 164 (or 164a for loss, 164d profit, 164e tax).
2. **Losses declared in year incurred** (row 164a) even if no profit — preserves the 2-year carryforward.
3. **Stay non-resident of Japan** — do not exceed 1-year physical presence without explicit intent (jusho).
4. **Do not run trading business from Japan** — even a 6-day Tokyo trip to swap hardware is fine; setting up an office with staff to negotiate exchange fees is not.
5. **Monitor FIEA 2026/2028 transition** — if Japan ever becomes a residency candidate, the venue calculus changes.

### 4.3 Hidden costs (overlooked)
1. **NAV audit of foreign-source income.** Hungary's NAV runs a 5-year statute of limitations. For foreign-source crypto income, the operator may receive a query letter requesting (a) full transaction history, (b) exchange statements, (c) MNB rate conversion, (d) cost-basis election. Estimated 4–8 hours of accounting work per query, EUR 200–500 per query.
2. **Hungarian tax advisor annual retainer for foreign-source crypto**: EUR 1,500–2,500 (vs. EUR 300–500 for plain SZJA).
3. **CARF cross-check.** From 2027 onward, bybit.eu's data (acquisitions, disposals, exchange values) flows to Austria → Hungary via CARF. The operator's self-declared amounts must match within tolerance. Mismatches are flagged automatically and generate a default penalty of up to HUF 2M.
4. **GDPR record-of-processing (Art. 30).** While the adequacy decision removes the SCC need, the operator must still maintain a record of processing activities for the data stored on the Tokyo server. If Japanese data-protection law changes, an Art. 49 derogation analysis (explicit consent for non-repetitive transfer) should be ready.
5. **Hungarian Act VII of 2024 transition.** The post-Orban reversal is in progress. Until the new law is passed, the operator should *not* assume the criminal exposure is fully removed — keep bybit.eu as the counterparty and document the regulatory status.
6. **Japan-side DC service consumption tax (10% JCT).** The DC bills the operator for rack/U fees + electricity. If the operator is a *business operator* (not a consumer), JCT 10% applies. Hungarian VAT-registered business may or may not recover under reverse-charge — confirm with Hungarian VAT advisor.
7. **Japan reconstruction surtax (0.55% national tax).** This is the often-forgotten 0.55% on top of 15.315% — bringing the standard national+reconstruction withholding rate to 15.865%, plus inhabitant. Not triggered for the operator (no JP-source income), but if a future structure involves a Japan K.K., it must be modeled.

---

## 5. Confidence Ratings

| Item | Confidence | Notes |
|---|---|---|
| Japan PSA registration not triggered | **Very high (95%)** | Statute + multiple precedent cases (Bybit warnings). |
| Japan PE not triggered (2010 NTA safe-harbor) | **High (90%)** | Direct NTA ruling, 16 years of precedent. Contract discipline is critical. |
| Japan crypto income tax not triggered for non-resident without PE | **Very high (95%)** | NTA FAQ Ver.9 令和7年12月 published Jan 2026. |
| Hungary SZJA 15% on disposal | **Very high (95%)** | NAV guidance, PwC, LeitnerLeitner, multiple secondary sources. |
| Crypto Act VII / validation regime | **High (80%)** | Status as of July 2026: reversal in progress, but final statutory text not yet observed. |
| CARF/DAC8 implementation in Hungary | **Very high (95%)** | Hungary's 1 Jan 2026 implementation is on Taxbit's authoritative list. |
| EU MiCAR no individual obligation | **Very high (95%)** | Title V of Reg 2023/1114 explicit. |
| GDPR adequacy for Japan | **Very high (95%)** | Decision 2019/419 in force, no current lapse. |
| Hungary–Japan tax treaty covers this scenario | **Very high (95%)** | Art. 7 + Art. 11 MLI standard. |
| FIEA 2026/2028 reform impact | **Medium (75%)** | Bill passed House June 2026; Senate vote pending; 2028 effective date is "expected," not enacted. |

---

## 6. Top 5 Source Documents (English) for Quick Reference

1. **NTA FAQ Ver.9 (令和7年12月)** — `https://www.nta.go.jp/publication/pamph/pdf/virtual_currency_faq_03.pdf` — Definitive source on non-resident crypto tax.
2. **JPX / NTA 2010 Co-location Ruling** — `https://www.jpx.co.jp/english/systems/connectivity/tvdivq000000099j-att/b7gje6000000jzns.pdf` — NTA confirmation that HFT server use ≠ PE.
3. **Hungarian NAV Crypto Guidance** — `https://nav.gov.hu/ado/szja/a-kriptougyletek-jovedelmenek-adozasa` — Hungarian-language official; 15% SZJA + loss rules.
4. **EU Commission Implementing Decision 2019/419** — Japan adequacy — `https://commission.europa.eu/law/law-topic/data-protection/international-dimension-data-protection/adequacy-decisions_en`
5. **PwC Hungary Tax Summary** — `https://taxsummaries.pwc.com/hungary/individual/income-determination` — Cross-validated 15% rate, FIFO, loss carryforward.

---

## 7. Sources (35+ URLs)

### Japan — Regulator & Tax (English)
1. https://www.fsa.go.jp/en/news/2025/20250410_2/01.pdf — FSA Examination of Regulatory Systems Related to Cryptoassets (2025)
2. https://www.fsa.go.jp/en/news/2025/20250410_2/crypto_dp.html — FSA Crypto Discussion Paper (2025)
3. https://www.fsa.go.jp/en/laws_regulations/index.html — FSA Laws & Regulations
4. https://www.fsa.go.jp/policy/virtual_currency02/bybit_fintech_limited_keikokushiryo.pdf — FSA Warning to Bybit Fintech Limited
5. https://www.fsa.go.jp/sesc/english/reports/re2024.pdf — SESC Annual Report 2024/2025
6. https://www.fsa.go.jp/newsletter/weekly2024/584.html — FSA Weekly Review No.584 (Travel Rule scope)
7. https://www.globallegalinsights.com/practice-areas/blockchain-cryptocurrency-laws-and-regulations/japan/ — Japan Crypto Regulations 2026
8. https://www.fsa.go.jp/common/law/guide/kaisya/16.pdf — 暗号資産交換業者関係 Guidance
9. https://www.nta.go.jp/publication/pamph/pdf/virtual_currency_faq_03.pdf — NTA FAQ on Crypto Tax (Ver.9, 令和7年12月)
10. https://www.nta.go.jp/english/taxes/individual/12006.htm — NTA: Non-resident taxation
11. https://www.nta.go.jp/english/taxes/individual/pdf/incometax_2024/01.pdf — 2024 NTA Income Tax Guide
12. https://www.nta.go.jp/taxes/shiraberu/kokusai/carf/index.htm — NTA CARF (暗号資産等報告枠組み)
13. https://www.jpx.co.jp/english/systems/connectivity/tvdivq000000099j-att/b7gje6000000jzns.pdf — JPX / NTA 2010 Co-location Ruling
14. https://www.jpx.co.jp/english/systems/connectivity/tvdivq000000099j-att/b7gje6000000gmp4.pdf — TSE Co-Location Tax Treatment (2009)
15. https://taxsummaries.pwc.com/japan/individual/taxes-on-personal-income — PwC Japan Tax Summary
16. https://taxsummaries.pwc.com/japan/corporate/corporate-residence — PwC Japan Corporate Residence
17. https://www.pwc.com/jp/en/taxnews-financial-services/assets/fs-20251224-en.pdf — PwC Japan 2026 Tax Reform (English)
18. https://www.nishimura.com/en/knowledge/publications/20111101-51746 — Nishimura: Does a Server Constitute PE in Japan
19. https://www.aai.law/japan-permanent-establishment-pe-risks/ — AA Intl Law: Japan PE Risks (HFT server)
20. https://tyo.evershinecpa.com/qa-on-tax-vat-cit-regulations-for-foreign-company-with-non-resident-status-in-japan — Q&A on Japan tax (Non-resident)

### Japan — Japanese language (金融庁 / 国税庁)
21. https://www.fsa.go.jp/policy/virtual_currency/index.html — 金融庁 暗号資産の利用者のみなさまへ
22. https://www.fsa.go.jp/policy/virtual_currency02/index.html — 暗号資産・電子決済手段関係
23. https://www.fsa.go.jp/singi/singi_kinyu/angoshisanseido_wg/gijishidai/20250731/04.pdf — 暗号資産制度について
24. https://www.fsa.go.jp/news/r7/sonota/20260522/20260522.html — 令和7年資金決済法改正
25. https://www.fsa.go.jp/policy/virtual_currency/angoushisan_mutouroku.pdf — 無登録で暗号資産交換業を行う者の名称等
26. https://www.mof.go.jp/english/policy/tax_policy/tax_conventions/mli_Hun.html — Japan MOF: MLI Japan–Hungary
27. https://www.mof.go.jp/english/policy/tax_policy/tax_conventions/tax_convetion_list_en.html — Japan Tax Conventions list
28. https://www.mof.go.jp/tax_policy/summary/international/tax_convention/SynthesizedTextforJapan_Hungary_EN.pdf — Synthesised Japan–Hungary DTT (MLI-modified)
29. https://www.nta.go.jp/publication/pamph/shotoku/kakuteishinkokukankei/kasoutuka/ — NTA 暗号資産等の税務上の取扱い
30. https://www.nta.go.jp/taxes/tetsuzuki/shinsei/annai/shinkoku/annai/21kasou.htm — NTA A1-20 評価方法の届出

### Hungary — Tax & Crypto
31. https://nav.gov.hu/ado/szja/a-kriptougyletek-jovedelmenek-adozasa — NAV: Kriptoeszköz jövedelem adózása
32. https://nav.gov.hu/en — National Tax and Customs Administration (English)
33. https://nav.gov.hu/en/taxation/double_taxation_treaties — Double Taxation Treaties of Hungary
34. https://taxsummaries.pwc.com/hungary/individual/income-determination — PwC Hungary Individual Income Determination
35. https://taxsummaries.pwc.com/hungary/individual/foreign-tax-relief-and-tax-treaties — PwC Hungary DTTs
36. https://www.taxbit.com/carf/hungary — Taxbit CARF Hungary
37. https://www.wolftheiss.com/insights/hungarys-crypto-validation-certificate-requirement-took-effect-on-27-december-2025/ — Wolf Theiss: Hungary Crypto Validation Certificate
38. https://www.lightspark.com/knowledge/is-crypto-legal-in-hungary — Lightspark: Is Crypto Legal in Hungary
39. https://cms.law/en/int/expert-guides/cms-expert-guide-to-crypto-regulation/hungary — CMS Hungary Crypto Guide
40. https://www.linkedin.com/pulse/hungarian-taxation-crypto-assets-2025-what-should-you-zal%C3%A1n-kotmayer-qv04f — Hungarian Crypto Tax 2025 (LinkedIn)
41. https://www.leitnerleitner.hu/en/news/summary-of-the-changes-in-tax-law/ — LeitnerLeitner Hungary
42. https://cms.law/en/hun/legal-updates/european-commission-opens-infringement-proceedings-against-hungary-over-crypto-asset-validation-regime — CMS: EC INFR(2025)2174
43. https://www.tradingview.com/news/cointelegraph:7b7a4a3f6094b:0-hungary-to-reverse-crypto-trading-crackdown-after-eu-scrutiny/ — Hungary decriminalization
44. https://news.bloombergtax.com/financial-accounting/hungary-to-decriminalize-crypto-trading-in-reversal-from-orban — Bloomberg Tax
45. https://www.theblock.co/post/404417/hungary-reverses-orban-era-crypto-rules — The Block

### EU — MiCAR / GDPR / Lithuania
46. https://www.lb.lt/en/markets-in-crypto-assets — Bank of Lithuania: MiCAR
47. https://www.lb.lt/en/authorisation-of-crypto-asset-service-providers — Bank of Lithuania: CASP Authorisation
48. https://madeinvilnius.lt/en/business/Vilnius-market/absurdas-viena-didziausiu-kriptobirzu-pasaulyje-negavo-licencijos-veikti-lietuvoje/ — Bybit refused Lithuanian license
49. https://learn.bybit.com/en/regulations/bybit-europe-eu-and-micar — Bybit EU MiCAR
50. https://chainscreen.io/regulations/mica-authorized-casps-list — MiCA Authorised CASPs
51. https://cms.law/en/int/expert-guides/cms-expert-guide-to-crypto-regulation/eu-chapter-on-micar — CMS EU MiCAR
52. https://www.klgates.com/The-Regulation-on-Markets-in-Crypto-Assets-Becomes-Fully-Applicable-in-All-Member-States-of-the-European-Union-1-24-2025 — K&L Gates MiCAR
53. https://www.bafin.de/SharedDocs/Veroeffentlichungen/EN/Fachartikel/2025/fa_250122_MiCAR_Vereinfachungen_Herausforderungen_en.html — BaFin MiCAR
54. https://www.centralbank.ie/regulation/markets-in-crypto-assets-regulation — Central Bank of Ireland MiCAR
55. https://www.dechert.com/knowledge/onpoint/2025/1/application-of-second-part-of-mica---regulation-of-casps-and-oth.html — Dechert: MiCAR Phase 2
56. https://commission.europa.eu/law/law-topic/data-protection/international-dimension-data-protection/adequacy-decisions_en — EU Adequacy Decisions
57. https://ec.europa.eu/commission/presscorner/api/files/document/print/en/memo_19_422/MEMO_19_422_EN.pdf — EU–Japan Adequacy Fact Sheet
58. https://www.legislation.gov.uk/eudn/2019/419/annexes/adopted — Decision 2019/419 (UK consolidated)
59. https://gdpr-info.eu/art-49-gdpr/ — GDPR Art.49 text
60. https://commission.europa.eu/system/files/2019-01/adequacy-japan-factsheet_en_2019_1.pdf — Adequacy Japan fact sheet

### Japan enforcement (FSA, Bybit, others)
61. https://www.binance.com/en/square/post/16905357838802 — Japan FSA warns 5 exchanges Nov 2024
62. https://finance.yahoo.com/news/why-bybit-end-services-japan-151740145.html — Bybit exiting Japan
63. https://forklog.com/en/bybit-to-exit-japanese-market-amid-regulatory-pressure/ — Bybit to Exit Japan
64. https://bravenewcoin.com/insights/bybit-stops-taking-new-japanese-users-as-crypto-rules-tighten — Bybit stops Japanese users
65. https://www.cryptoverselawyers.io/japan-crypto-regulation-bybit-vasp-impact/ — Bybit VASP impact
66. https://www.binance.com/en/square/post/16978922981161 — Japan FSA crackdown

### Japan 2026/2028 FIEA reform
67. https://geminigr.com/en/media/blog/japan-financial-compliance-fsa-guide/ — Japan Crypto Reclassification 2025
68. https://www.amt-law.com/en/insights/trending-news/trending-news_20260123001_en_001/ — AMT Law: 2026 Tax Reform Outline
69. https://www.wakyodo.co.jp/en/crypto-regulation-reset-2026-japan-fiea-tax-impact/ — 2026 FIEA Reset
70. https://www.nagashima.com/en/publications/publication20260316-1/ — Nagashima: 2026 Tax Reform
71. https://www.coindesk.com/markets/2025/12/01/japan-to-cut-crypto-tax-to-20-uniform-rate-in-boost-for-local-bitcoin-traders — CoinDesk: 20% tax
72. https://chambers.com/articles/japan-s-2026-tax-reform-on-taxation-of-crypto-asset-transactions-and-its-implications-for-foreign-in — Chambers: 2026 Tax Reform Implications
73. https://blog.thirdweb.com/japan-slashes-crypto-tax-from-55-to-20-what-builders-need-to-know/ — Thirdweb: Japan 2026

### Hungarian tax-specific
74. https://www.penzcentrum.hu/megtakaritas/20240301/szja-bevallas-2024-fontos-hataridoket-friss-szabalyokat-kozolt-a-nav-1147688 — Pénzcentrum SZJA 2024
75. https://premiumkonyveles.hu/szja-bevallas-2025/ — Prémium Audit: SZJA 2025
76. https://taxes-crypto.eu/en/crypto-tax/magyarorszag/complete-guide — Taxes-Crypto.eu Hungary Guide
77. https://www.linkedin.com/pulse/crypto-tax-regulation-hungary-jeyhun-mammadov-htq1f — Hungary Crypto Tax Regulation

### Japan crypto tax overview
78. https://kmra-cpa.com/en/crypto-tax-faq-v9-2024/ — KMRA CPA: Japan Crypto Tax FAQ v9
79. https://koinx.com/jp/tax-guides/crypto-tax-japan — KoinX: Japan Crypto Tax
80. https://ibuidl.org/blog/japan-crypto-tax-reform-2026-20260310 — iBuidl: Japan 2026 Crypto Tax
81. https://www.odaily.news/zh-CN/newsflash/460398 — Odaily: Japan NTA 2024 crypto enforcement
82. https://kmra-cpa.com/ja/%E5%9B%BD%E7%A8%8E%E5%BA%81%E3%81%8C%E6%9A%97%E5%8F%B7%E8%B3%87%E7%94%A3%E7%AD%89%E3%81%AB%E9%96%A2%E3%81%99%E3%82%8B%E7%A8%8E%E5%8B%99%E4%B8%8A%E3%81%AE%E5%8F%96%E6%89%B1%E3%81%84%E3%81%AB/ — KMRA CPA Japan (Japanese)
83. https://kpmg.com/jp/en/insights/2024/07/e-taxnews-20240702.html — KPMG Japan: CARF / Auto Exchange

### Japan co-location HFT PE
84. https://www.lexology.com/library/detail.aspx?g=b901a614-a402-4e97-903b-fbbfcc98dbd9 — Lexology: TSE Co-Location Tax
85. https://www.nishimura.com/sites/default/files/images/ILO_newsletter2011.pdf — Nishimura: HFT Server PE (2010/2011)
86. https://www.internationaltaxreview.com/article/2691340/ruling-on-tax-treatment-of-co-location-services — ITR: Ruling on Co-Location
87. https://www.nagashima.com/wp-content/uploads/2023/03/tax_en_no2_2.pdf — Nagashima: NTA Ruling on Representative PE

### Lithuania / bybit.eu
88. https://www.globallegalinsights.com/practice-areas/blockchain-cryptocurrency-laws-and-regulations/lithuania/ — GLI Lithuania
89. https://copla.com/blog/compliance-regulations/mica-regulation-in-lithuania-licensing-implementation-and-what-crypto-firms-need-to-know/ — Copla: Lithuania MiCA
90. https://www.demire.eu/casp-crypto-license-in-lithuania/ — Demire: Lithuania CASP

### CARF / OECD
91. https://www.pwc.com/cl/es/publicaciones/informe-global-sobre-criptoimpuestos/Informe-Global-sobre-Criptoimpuestos-2026-PwC.pdf — PwC Global Crypto Tax Report 2026
92. https://www.nta.go.jp/taxes/shiraberu/kokusai/carf/pdf/seidogaiyo_05_en.pdf — NTA CARF Overview (English)

### English additional
93. https://en.soramitsu.co.jp/insights/article-detail/201 — Soramitsu on FIEA 2026
94. https://www.jetro.go.jp/en/invest/setting_up/section3/page7.html — JETRO: Japan Individual Tax
95. https://www.jetro.go.jp/en/invest/setting_up/section3/page3.html — JETRO: Japan Corporate Tax

---

## 8. Bottom Line

**For a Hungarian-resident EU citizen operating a colocated server in Tokyo to trade bybit.eu, there are zero regulatory or tax showstoppers.** The 2010 NTA safe-harbor eliminates Japan PE risk; the PSA exchange-service registration regime is targeted at operators, not users; the EU-Japan adequacy decision removes GDPR transfer friction; and Hungary's flat 15% SZJA applies regardless of where the trading server is located.

**The single most important operational discipline is the colo contract:** the operator must NOT have the right to dispose of, sublease, or take unrestricted physical access to the server. If those three clauses are present, the 2010 NTA ruling is straightforward. If any of them is missing, the operator risks a Japanese PE finding and full Japanese corporate tax exposure on the income attributable to the PE.

**Recommended posture: GO.** Budget EUR 500–2,500/year for Hungarian tax preparation; retain a Japanese tax attorney (one-time, ~EUR 5,000–10,000) to review the colo contract; respond promptly to bybit.eu's CARF self-certification requests; and monitor the 2026/2028 FIEA transition (which is irrelevant for the Hungarian operator but may affect a future Japanese-residency scenario).
