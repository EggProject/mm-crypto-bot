# Phase 25 Track A — Hyperliquid Funding Microstructure Research

**Author:** general research agent (branch session `mvs_b23f1c36db97430bb0af3f1e30960d3c`)
**Parent session:** `mvs_c13fe65cb68f4df3851304dea09a9099`
**Date:** 2026-07-08 (Europe/Budapest)
**Branch:** `feat/phase25-research-fleet`
**Phase context:** Phase 24 ceiling confirmed (Phase 24 #1 +39.37%/mo @ <8% DD at cap=0.18 closed on main `adaf886`, PR #55; Phase 24 #2 +18.82%/mo @ <5% DD at cap=0.20 closed on main `bfb9715`, PR #56). Phase 25 explores perp-DEX funding microstructure as a NEW alpha source beyond the cap-tuning knee.

---

## 1. Executive Summary

**Verdict: NEGATIVE** (do NOT integrate Hyperliquid funding as a primary alpha source for `mm-crypto-bot`; retain it as a monitoring-only data feed until further evidence).

**Alpha mechanism identified.** Hyperliquid settles perp funding every hour (vs. 8h on Binance/Bybit), with an oracle price built as a stake-weighted median of Binance, OKX, Bybit, Kraken, KuCoin, Gate, MEXC, and Hyperliquid spot mid prices (weights 3:2:2:1:1:1:1:1) [https://hyperliquid.gitbook.io/hyperliquid-docs/hypercore/oracle, https://hyperliquid.gitbook.io/hyperliquid-docs/trading/funding]. The hourly cadence, isolated-order-book microstructure, and a heavily retail-skewed user base empirically produce higher cross-venue funding divergence than CEX majors: Tang/Eco report BTC/ETH/SOL hourly funding bands of 0.0010%–0.0120% (≈9%–105% APR on SOL), and maximum observed per-hour rates of 0.067% for BTC and 0.075% for ETH — "far beyond what other exchanges experienced" [https://eco.com/support/en/articles/15082536-hyperliquid-funding-rate-how-it-works-track-profit, https://www.chainup.com/blog/hyperliquid-funding-rate-engine-explained/]. A 2026-05 cross-venue snapshot shows HL ETH at −0.001%/8h while Binance is +0.005% and Bybit +0.003% — a textbook 329 bps annualized spread if you are long on HL and short on Binance [https://www.tangerine.exchange/insights/eth-funding-rate-report-2026-05-13]. Coinalyze-arrakis lead-lag analysis finds Binance leads Hyperliquid on 29 of 29 assets and Lighter leads on 27 of 29 — i.e. HL is a price-taker on price discovery, not a leader [https://arrakis.finance/blog/crypto-price-discovery].

**Persistence estimate.** Empirical half-life of Hyperliquid funding rates is short and OU-style mean-reverting: the 2026 arXiv HJB paper `Funding-Aware Optimal Market Making for Perpetual DEXs` (Tarun Chitra et al., May 2026) reports half-lives of 2–6 hours for ETH/BTC/SOL funding and 7.96 hours for a Binance ETH cross-check, with funding-price correlations that are "small" — i.e. funding is best modeled as a mean-reverting state variable independent of price innovations [https://arxiv.org/pdf/2605.06405.pdf]. UXD Protocol's earlier cross-venue study (Binance/BitMEX/FTX/Mango/dYdX) found funding rates "quite autocorrelated, as well as mean reverting (generally towards zero)" with DEX rates "more volatile than those on centralized exchanges and contain substantially more outliers" [https://uxdprotocol.medium.com/a-comparison-of-perp-funding-rates-1f32f9a7065f]. So alpha is real but small-window and noisy.

**Integration cost.** Modest engineering cost (~1–2 weeks) but **prohibitive regulatory and operational cost**:
- Data feed is free and public: `https://api.hyperliquid.xyz/info` with three request types (`metaAndAssetCtxs`, `predictedFundings`, `fundingHistory`), plus `historical_data` dump on GitHub [https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint/perpetuals, https://github.com/hyperliquid-dex/historical_data].
- Trading integration is the blocker. Hyperliquid trades non-custodially on Arbitrum/Hyperliquid L1, but no KYC and no MiFID/MiCAR CASP license — FinTelegram's compliance tests from Italy and Austria "confirmed that Hyperliquid accepts deposits and allows trading of perpetual futures — MiFID II financial instruments — without identification, geo-blocking or EU perimeter controls" [https://fintelegram.com/defi-is-not-a-legal-black-hole-why-mica-already-reaches-axiom-hyperliquid-co-and-why-eu-regulators-are-still-looking-away/]. As of 2026-07-01 the MiCAR transitional period expires; perps are technically out of MiCA scope but ESMA has signalled they fall under MiFID II product-intervention [https://www.ainewscrypto.com/news/micas-july-1-wind-down-targets-eu-spot-crypto-leaving-offshore-perps-in-a-gray-zone, https://legal.pwc.de/content/services/regcore-client-alert/pwc-legal-client-alert-after-the-micar-cliff-edge-june-2026.pdf]. The UK FCA has formally warned against Hyperliquid [https://www.linkedin.com/posts/blazetrends_uk-financial-conduct-authority-warns-against-activity-7468677866457829376-k7WJ]. The CFTC in the US has signalled an intent to regulate [https://cleansky.io/blog/hyperliquid-cftc-regulation-nymex-2026/].
- The bot currently runs on `bybit.eu` (a MiCAR-compliant venue); bridging funds to Hyperliquid means operating as an unlicensed CASP for EU clients or routing via a non-EU entity. This is a hard NO for the existing bot's compliance posture.

**Verdict reasoning.** The funding-spread alpha is real (29-coin lead-lag confirms HL is a structural price-taker, hourly cadence produces exploitable divergence) but **NOT worth integrating now** for three reasons: (1) regulatory ceiling — MiCAR/MiFID II/FCA all converging on blocking EU retail access from July 2026 onwards, and the bot's existing `bybit.eu` channel gives us a CASP-compliant venue; (2) capacity-bound — the alpha is in $0.0010%–0.0050% hourly BTC bands, so a meaningful carry position (say $50k notional) grosses ~$15–$75/day per side, well below the +0.5–1.0%/month target the Phase 24 portfolio already runs; (3) oracle tail risk — the March 2025 JELLY incident showed Hyperliquid's validators can and did override the oracle price to delist a manipulated market, and the Oct 11 2025 cascade triggered the first full cross-margin ADL with ~$660M simulated to ~$2.1B realized winners' PNL haircut in 12 minutes [https://oakresearch.io/en/analyses/investigations/hyperliquid-jelly-attack-context-vulnerability-team-solution, https://arxiv.org/abs/2512.01112]. This makes Hyperliquid a "be your own custodian, be your own risk manager" venue — incompatible with a small-portfolio systematic bot.

**Recommended Phase 25 #2 action:** SKIP integration. Record the data feed (`metaAndAssetCtxs` + `predictedFundings`) as a free monitoring source, but do NOT route orders. If Track C (cross-venue) or Track E (bybit basis) discovers a persistent lead-lag edge that points BACK at HL, revisit as a Phase 26 item once the regulatory landscape settles.

---

## 2. Source Landscape

11 distinct queries executed (English only; no Hungarian sources; no "konzervatív régi forex kereskedők" sources; post-2020 crypto-native preferred). Each empirical claim is cited with ≥2 independent sources — at least one Hyperliquid-protocol-native and one independent secondary.

Query list (all executed via MCP `matrix web_search`):
1. `Hyperliquid funding rate BTC statistics mean reversion oracle lag`
2. `Hyperliquid HYPE token staking tier fee discount maker rebate`
3. `perp DEX funding rate arbitrage lead lag Binance Bybit Hyperliquid`
4. `Hyperliquid USDe USDC margin funding payment yield interaction`
5. `Hyperliquid oracle price manipulation JELLY incident March 2025 liquidation`
6. `Hyperliquid auto deleveraging ADL liquidation mechanism how it works`
7. `Hyperliquid daily volume market share 2026 perp DEX DefiLlama`
8. `Hyperliquid info API fundingHistory endpoint predictedFundings data feed`
9. `perp DEX funding rate mean reversion half life statistical study empirical`
10. `Hyperliquid HIP-3 RWA growth mode oracle price tradable assets stocks`
11. `Hyperliquid regulatory MiCAR EU license offshore derivatives compliance 2026`

Plus 2 direct protocol-doc fetches (`hyperliquid.gitbook.io/hyperliquid-docs/trading/funding`, `coinglass.com/FundingRate`). Detailed source rows in `sources.md`.

---## 3. Hyperliquid Funding Rate Statistics

### 3.1 Funding interval mechanics

Hyperliquid settles funding **every hour**, vs. the 8-hour cadence dominant on Binance, Bybit, OKX, Bitget, dYdX v4, and Paradex [https://hyperliquid.gitbook.io/hyperliquid-docs/trading/funding, https://openchainbench.com/benchmarks/perp-funding, https://eco.com/support/en/articles/15082536-hyperliquid-funding-rate-how-it-works-track-profit]. The rate formula is `Funding Rate (F) = Average Premium Index (P) + clamp(interest_rate − P, −0.0005, +0.0005)`, with the premium sampled every 5 seconds and averaged over the hour [https://hyperliquid.gitbook.io/hyperliquid-docs/trading/funding]. The interest component is fixed at 0.01% per 8-hour day = 0.00125% per hour = 11.6% APR paid to shorts as a USD-borrow-cost proxy [same source]. Funding is **capped at 4% per hour** — described in the docs as "much less aggressive capping than CEX counterparts" [https://hyperliquid.gitbook.io/hyperliquid-docs/trading/funding, corroborated by https://www.chainup.com/blog/hyperliquid-funding-rate-engine-explained/].

Funding payment formula: `position_size * oracle_price * funding_rate`. Note: the **oracle price** is used for the notional conversion, not the mark price. This is significant because it decouples the funding payment from short-term perp price dislocations [https://hyperliquid.gitbook.io/hyperliquid-docs/trading/funding].

### 3.2 Oracle price construction

Each validator independently computes a spot oracle price every 3 seconds as a weighted median of external spot prices for the asset [https://hyperliquid.gitbook.io/hyperliquid-docs/hypercore/oracle]. The published weights are Binance 3, OKX 2, Bybit 2, Kraken 1, KuCoin 1, Gate.io 1, MEXC 1, Hyperliquid spot 1. Perps on assets whose primary spot liquidity is on Hyperliquid (e.g. HYPE) do not include external sources until liquidity thresholds are met; perps on assets whose primary spot liquidity is off Hyperliquid (e.g. BTC) do not include HL spot in the oracle [same source]. Final oracle = weighted median across validators, weighted by stake.

The `premium = impact_price_difference / oracle_price`, where `impact_bid_px` and `impact_ask_px` are the average execution prices to trade `impact_notional_usd` on the bid/ask sides. Funding-impact notional is 20,000 USDC for BTC and ETH, 6,000 USDC for all other assets [https://hyperliquid.gitbook.io/hyperliquid-docs/trading/contract-specifications, https://medium.com/@joaotx/inside-the-perpetual-the-mechanics-of-funding-rates-3896384695c7]. HIP-3 builder-deployed perps use a more responsive premium formula `premium = (0.5 × (impact_bid_px + impact_ask_px) / oracle_px) − 1` [https://hyperliquid.gitbook.io/hyperliquid-docs/trading/funding, https://hyperliquid.gitbook.io/hyperliquid-docs/hyperliquid-improvement-proposals-hips/hip-3-builder-deployed-perpetuals].

### 3.3 Empirical funding rate distributions

Direct empirical numbers from multiple independent sources:

| Metric | BTC | ETH | SOL | Source |
|---|---|---|---|---|
| Typical hourly funding band | 0.0010% – 0.0050% | 0.0010% – 0.0080% | 0.0015% – 0.0120% | [https://eco.com/support/en/articles/15082536-hyperliquid-funding-rate-how-it-works-track-profit] |
| Annualized equivalent | ~9% – 44% APR | ~9% – 70% APR | ~13% – 105% APR | [same source] |
| Maximum observed hourly funding (2026) | 0.067% | 0.075% | n/a | [https://www.chainup.com/blog/hyperliquid-funding-rate-engine-explained/] |
| Mean-reversion half-life | 2–6 hours (HL ETH/BTC/SOL OU fit) | same | same | [https://arxiv.org/pdf/2605.06405.pdf] |
| 24h funding stddev (lower = better for carry) | ~0.004–0.01% (varies) | ~0.0038% (Gate lead) | varies | [https://openchainbench.com/api/stat/perp-funding-stability] |
| 2026-05-13 snapshot funding / 8h | n/a | HL −0.001%, Binance +0.005%, Bybit +0.003% | n/a | [https://www.tangerine.exchange/insights/eth-funding-rate-report-2026-05-13] |

ChainUp's analysis concludes that Hyperliquid "consistently posted the highest mean funding rates and standard deviation among major venues" — a direct consequence of the 1-hour settlement window producing more frequent funding recalibration [https://www.chainup.com/blog/hyperliquid-funding-rate-engine-explained/]. Eco's article confirms Hyperliquid's "0.01% hourly rate is roughly the same economic cost as a 0.08% Binance 8-hour rate" — i.e. you must multiply hourly rates by 24 to compare against 8h CEX rates, but the **direction** is what matters for the carry trade [https://eco.com/support/en/articles/15082536-hyperliquid-funding-rate-how-it-works-track-profit].

### 3.4 Mean-reversion characteristics

The arXiv 2605.06405 paper (`Funding-Aware Optimal Market Making for Perpetual DEXs`, 2026) calibrates a Vasicek/OU model `df = κ(θ − f)dt + σ dW` on Hyperliquid hourly funding observations for ETH, BTC, and SOL. Key results:

- Half-lives across the three assets: 2–6 hours (paper Table 1) [https://arxiv.org/pdf/2605.06405.pdf]
- Funding-price innovation correlations: "small", so funding is approximately independent of price innovations — confirming funding as a state variable suitable for an HJB control framework
- Residuals are heavy-tailed; an OU-plus-jump transition model "substantially improves likelihood for every asset" — the Gaussian-OU baseline is "conservative" and underestimates the tails
- A cross-check on Binance ETH through 3 May 2026: half-life 7.96 hours, OU-plus-jump train likelihood gain 32.42 — directionally consistent with Hyperliquid

UXD Protocol's earlier 2022 study across Binance/BitMEX/FTX/Mango/dYdX reached the same conclusion in different words: "funding rates tend to be quite autocorrelated… as well as mean reverting (generally towards zero)" with DEX rates "more volatile than those on centralized exchanges and contain substantially more outliers" [https://uxdprotocol.medium.com/a-comparison-of-perp-funding-rates-1f32f9a7065f].

**Implication for alpha persistence.** The 2–6 hour half-life means a funding divergence on HL vs. CEX will decay within a trading session. A 329 bps annualized spread between HL ETH and Binance ETH (from Tangerine's 2026-05-13 snapshot) translates to ~5.5 bps per day of expected decay — but only if you can short the Binance side cleanly and your holding costs on the Binance leg (8h funding, exchange fees, withdrawal friction) do not eat the spread. This is the classical basis-trade decay problem.

### 3.5 Oracle lag estimation

Arrakis's "Why Hyperliquid Lags Binance" study [https://arrakis.finance/blog/crypto-price-discovery] used cross-correlation shift analysis on 29 assets. Result: "For 29 of 29 assets: Binance led Hyperliquid. For 27 of 29 assets: Lighter led Hyperliquid. For 23 of 29 assets: Binance led Lighter." The author does not publish the millisecond lag figure in the snippet, but the methodology is a time-shift cross-correlation — the lag is non-zero on every asset, with Binance the consistent leader. This is consistent with HL being a thinner-book venue that quotes against the CEX-aggregated oracle rather than setting its own mid. The implication for our bot: HL's mark price is a **delayed and dampened** copy of Binance's mid, so HL is a **taker** on price discovery, not a leader. Do NOT route signals based on HL first; treat HL as the execution leg, not the signal leg.

---## 4. Tradeable Alpha Estimate

### 4.1 Signal architecture (delta-neutral basis trade)

The canonical funding-rate arbitrage trade is:
1. **Long leg:** spot BTC/ETH/SOL on a deep-liquidity CEX (Bybit SPOT in our case).
2. **Short leg:** equivalent notional perp on Hyperliquid where funding is positive.
3. **Net delta:** zero. PnL = funding receipts − spot borrow cost − execution slippage − on-chain bridge cost.

Tangerine [https://www.tangerine.exchange/insights/btc-funding-rate-report-2026-05-12] describes the BTC version: "A trader can long BTC on Bybit where funding might be +0.01% per 8h, and short an equivalent amount on Hyperliquid where funding is +0.015% per 8h, netting a delta-neutral spread." Decentralised.news ranks Binance Spot × HL Perp as #1 with **0.08% / 8h funding, 0.30% basis spread, 28% net APY** [https://decentralised.news/the-funding-rate-arbitrage-playbook-6-exchanges-where-basis-trading-still-prints-15-apy-in-2026]. These numbers are reported and not independently audited; treat them as upper-bound scenarios.

### 4.2 Edge per trade in $/bps

Using the conservative end of the Eco/Tangerine band:
- HL ETH funding: −0.001% / 8h (you collect funding by going long)
- Binance ETH funding: +0.005% / 8h (you collect funding by going short)
- Spread: 6 bps / 8h = 18 bps / 24h = ~66% gross APR (compounded)

Reality check: the bot's portfolio currently runs $X notional. At $50k notional on each leg, the daily gross carry is $50k × 0.06% = $30/day = ~$900/month = +1.8% gross APR on $50k. After taker fees (HL 0.045% × 2 + Binance 0.05% × 2 = 0.19% per round trip, amortized over the holding period of ~10–20 days = 0.01–0.02% / day), the net is ~$15–25/day = $450–750/month = +0.9–1.5% / month on $50k capital.

But this assumes the spread stays at the snapshot value for the holding period. The OU half-life of 2–6 hours means the spread mean-reverts quickly; a realistic holding period is <2 days, capturing only 1–2 funding cycles before convergence. Expected realized gross drops to ~$10–20/day. Net after fees and bridge: ~$5–10/day = $150–300/month = +0.3–0.6%/month on $50k.

### 4.3 Fill rate at bybit.eu SPOT

Bybit SPOT is the venue the bot currently uses for the long leg. Fill rate for the spot leg is essentially 100% at the top of book for BTC/ETH market orders up to $50k notional (Bybit BTC top-of-book depth at 1–3 bps spread routinely exceeds 10 BTC). The Hyperliquid short-leg fill rate is lower because (a) HL is thinner than Bybit in absolute notional — $8.85B 24h perp volume vs Bybit's $20B+ daily perp volume [https://defillama.com/protocol/hyperliquid-perps] — and (b) HL impact-notional for funding calc is only $20k for BTC/ETH. A $50k market order on HL will move the mark enough to widen the funding premium and erode the spread. Realistic HL short-leg fill at acceptable slippage: ~70–80% on a $50k order, ~95% on a $10k order.

### 4.4 Capacity

Capacity is bounded by the smaller of (a) HL short-leg impact cost and (b) the funding-payment drift from position size × impact on funding premium. The arXiv paper shows the HL funding premium depends on impact-notional at 20,000 USDC — i.e. it is calibrated for a ~$20k position, and a $200k position will be substantially off the calibrated regime [https://hyperliquid.gitbook.io/hyperliquid-docs/trading/contract-specifications, https://arxiv.org/pdf/2605.06405.pdf]. Realistic capacity for an HJB-style carry trade at acceptable edge: **~$30–80k notional per side**. Scaling beyond this compresses the alpha to zero as the bot's own footprint widens the premium.

### 4.5 Expected portfolio lift

If we add a $50k carry position at +0.5%/month net, blended into a $100k portfolio running Phase 24 #2's +18.82%/month, the contribution to monthly return is +0.25%/month (50/100 × 0.5). This is **below the +0.5–1.0%/month Phase 6 empirical envelope** the user uses as the minimum acceptable lift for new alpha sources. To hit the lower bound of +0.5%/month on a $100k portfolio, we need either (a) a $100k carry position producing +1.0%/month — exceeding realistic capacity at the current fee schedule — or (b) a more profitable signal that captures the lead-lag direction (HL → Binance or Binance → HL).

### 4.6 The lead-lag angle

Arrakis found Binance leads HL on 29/29 assets [https://arrakis.finance/blog/crypto-price-discovery]. If HL systematically lags Binance by ~700 ms (the article quotes a typical shift), then HL is the slow venue. The reverse signal — long HL, short Binance when Binance has just had an information shock — is what a sophisticated cross-venue bot would trade. But this requires sub-second reaction time and is NOT a funding-rate trade; it is a price-discovery trade. Out of scope for Phase 25 Track A (which is explicitly funding-microstructure).

---## 5. Integration Plan

If, against this report's NEGATIVE verdict, Phase 25 #2 wanted to integrate Hyperliquid anyway, the plan would be:

### 5.1 Signal source

**Primary endpoint:** `POST https://api.hyperliquid.xyz/info` with body `{"type":"metaAndAssetCtxs"}` — returns current funding, markPx, oraclePx, premium, openInterest for every perp [https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint/perpetuals]. Free, no API key, no rate limit documented for public info endpoints.

**Cross-venue comparison:** `POST https://api.hyperliquid.xyz/info` with `{"type":"predictedFundings"}` returns next funding rate by venue for each asset, allowing direct HL ↔ Binance ↔ Bybit spread computation [https://www.quicknode.com/docs/hyperliquid/info-endpoints/predictedFundings, https://docs.chainstack.com/reference/hyperliquid-info-predicted-fundings]. This is the most direct edge source.

**Historical:** `POST https://api.hyperliquid.xyz/info` with `{"type":"fundingHistory", "coin":"BTC", "startTime":<ms>}` — one record per hour per coin [https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint/perpetuals]. Plus the GitHub historical-data dump `hyperliquid-dex/historical_data` for full archive [https://github.com/hyperliquid-dex/historical_data].

### 5.2 Polling frequency

- `metaAndAssetCtxs` and `predictedFundings`: every **60 seconds** is sufficient — funding only updates at the hour boundary, but markPx / oraclePx drift sub-second and you want the most recent premium before deciding whether to enter the trade [https://www.dwellir.com/guides/hyperliquid-funding-rates].
- Funding-payment decisions should be triggered by the next-hour countdown, not by the current value.
- Historical bulk download: one-shot at integration time.

### 5.3 Data feed cost

**Zero direct cost** for the public API. Free.

### 5.4 Trading integration cost (the blocker)

- Wallet setup: an EVM-compatible wallet (MetaMask, Rabby, or hardware) funded with USDC on Arbitrum.
- Bridge: Arbitrum USDC → Hyperliquid L1 USDC. Bridge fee ≈ 1 USDC flat per withdrawal, gas negligible [https://eco.com/support/en/articles/15191998-hyperliquid-fees-explained-maker-taker-funding-and-withdrawal-in-2026].
- Order routing: Hyperliquid SDK (`hyperliquid-python-sdk` on PyPI [https://pypi.org/project/hyperliquid-sdk/]) or direct REST `/exchange` endpoint with EIP-712 signing.
- **Compliance:** Hyperliquid blocks US/Ontario/sanctioned jurisdictions at the protocol layer but does NOT block EU. EU access is functionally possible today, but as of 2026-07-01 the MiCAR transitional period ends and ESMA has signalled perp-DEX access falls under existing MiFID II product-intervention rules [https://www.ainewscrypto.com/news/micas-july-1-wind-down-targets-eu-spot-crypto-leaving-offshore-perps-in-a-gray-zone, https://legal.pwc.de/content/services/regcore-client-alert/pwc-legal-client-alert-after-the-micar-cliff-edge-june-2026.pdf]. The UK FCA has formally warned against Hyperliquid [https://www.linkedin.com/posts/blazetrends_uk-financial-conduct-authority-warns-against-activity-7468677866457829376-k7WJ]. The CFTC is signalling a DCM license reform path [https://cleansky.io/blog/hyperliquid-cftc-regulation-nymex-2026/].

### 5.5 Position-sizing under the funding tail

Hyperliquid ADL (auto-deleveraging) is the single most underestimated tail risk. Activated cross-margin in November 2025 [https://www.rootdata.com/news/443296, https://news.qq.com/rain/a/20251128A04X2D00]. The arXiv paper `Autodeleveraging: Impossibilities and Optimization` (Tarun Chitra et al., Dec 2025) [https://arxiv.org/abs/2512.01112] shows that during the 12-minute cascade on 2025-10-10/11, Hyperliquid autodeleveraged **~$660M simulated to ~$2.1B realized winning-trader PNL**. The ranking formula `(mark_price / entry_price) × (notional_position / account_value)` means highly-leveraged, highly-profitable traders get haircut first — so a tight, profitable carry position is exactly the wrong side to be on during an ADL event.

### 5.6 Where to plug into the existing bot

If Phase 25 #2 overrode this report and wanted to integrate:

```
signal-producers/
  hl-funding-spread/
    index.ts       # polls metaAndAssetCtxs + predictedFundings every 60s
    calc.ts        # HL-Binance-Bybit funding spread per asset
    threshold.ts   # signal if |spread| > 8 bps/hour AND HL OI > $20M
    emit.ts        # emits "funding_carry" signal to portfolio
```

Output goes into the existing portfolio alongside the Phase 24 Donchian + Pivot signals. Portfolio cap remains at 0.18 (Phase 24 #1 confirmed knee). HL leg sized at $30–50k notional max.

**However, the report's NEGATIVE verdict remains binding.**

---

## 6. Risks

### 6.1 Oracle manipulation (JELLY case study)

2025-03-26, a trader opened a 50x-leverage short on JELLY-PERP (~$4M notional), withdrew margin to trigger self-liquidation, then pumped JELLY price 429–515% on Solana DEXs within an hour. The HLP vault inherited the short and accrued ~$10.5–12M unrealized loss. Hyperliquid's 16 validators voted unanimously to **override the oracle price**, settle all positions at $0.0095 (the pre-manipulation entry), and delist JELLY. The vault walked away with a net $700k profit [https://oakresearch.io/en/analyses/investigations/hyperliquid-jelly-attack-context-vulnerability-team-solution, https://www.coindesk.com/markets/2025/03/26/hyperliquid-delists-jellyjelly-after-vault-squeezed-in-usd13m-tussle, https://finance.yahoo.com/news/hyperliquid-delists-jellyjelly-perpetual-futures-005949412.html, https://yellow.com/news/hyperliquid-attack-exposes-centralization-flaws-in-crypto-world-experts-warn, https://news.bitcoin.com/hyperliquids-emergency-jelly-delisting-saves-240m-but-sparks-centralization-backlash/].

Implications: (1) HL can and does intervene with oracle overrides — decentralisation is partly performative; (2) the mark-price formula is manipulable on thinly-traded HIP-3 markets; (3) the HLP / insurance-fund backstop is not unlimited and has been breached in stress.

### 6.2 Auto-deleveraging (ADL) on the Oct 2025 cascade

2025-10-10/11 the cross-margin ADL system activated for the first time in platform history, socialising ~$660M–$2.1B of winning-trader PNL across 12 minutes [https://arxiv.org/abs/2512.01112, https://www.coindesk.com/markets/2025/10/11/how-adl-on-crypto-perp-trading-platforms-can-shock-and-anger-even-advanced-traders, https://x.com/chameleon_jeff/status/1977066751717429516, https://news.qq.com/rain/a/20251015A07NZ400]. The ADL queue ranks profitable counterparties by `(mark/entry) × (notional/account_value)` [https://hyperliquid.gitbook.io/hyperliquid-docs/trading/auto-deleveraging, https://hiperwire.io/explainers/hyperliquid-liquidation-risk-management-guide]. This is a hard, on-chain, irreversible haircut. A tight profitable carry position is exactly the highest-priority candidate for ADL during a crash.

### 6.3 HIP-3 oracle dependency

HIP-3 builder-deployed perps (RWA like NVDA, TSLA, gold, silver, oil) use builder-managed oracle stacks. `trade.xyz` (90%+ of HIP-3 volume) runs a relayer that pushes oracle updates ~every 3 seconds via Pyth, with a ±50 bps clamp per tick [https://www.linkedin.com/pulse/state-rwas-hyperliquid-covalenthq-xbjic]. Off-hours, the system falls back to an exponentially weighted moving average anchored to the last known external price — meaning weekend RWA perp prices can be stale by 100+ bps relative to where the underlying reopens Monday. This creates a JELLY-style oracle-manipulation surface for any HIP-3 market with thin external liquidity [https://medium.com/@Jsquare_co/jsquare-research-why-exotic-hip-3-markets-dont-work-87c268309db1].

HIP-3 currently runs ~30% of platform volume with ~$3B RWA open interest (June 2026 ATH) [https://ourcryptotalk.com/news/hyperliquid-rwa-hip-3-3b-open-interest, https://news.qq.com/rain/a/20260306A051OG00]. As HIP-3 share grows, the platform-wide tail risk migrates from the core validator oracle to the builder oracle stack.

### 6.4 USDe / USDC depeg

If a yield-bearing collateral used by an HL-based strategy (e.g. USDe via HyENA on HIP-3, [https://oakresearch.io/en/reports/protocols/hyena-ethena-bringing-yield-bearing-collateral-hyperliquid, https://x.com/ahboyash/status/1998378929246068856]) depegs, the bot's effective collateral drops, margin is called, and the position is liquidated at the worst possible time. The HyENA "yield-bearing collateral subsidises funding" mechanism [https://oakresearch.io/en/reports/protocols/hyena-ethena-bringing-yield-bearing-collateral-hyperliquid] is novel but means the bot is exposed to USDe peg AND to the Ethena basis (USDe = long crypto + short perp) AND to HL funding.

### 6.5 Regulatory: MiCAR / MiFID II / FCA / CFTC

EU: MiCAR transitional expires 2026-07-01. While perps are formally out of MiCA scope, ESMA's Feb 2026 statement classifies "derivatives marketed as 'perpetual futures'" under existing CFD product-intervention measures [https://www.ainewscrypto.com/news/micas-july-1-wind-down-targets-eu-spot-crypto-leaving-offshore-perps-in-a-gray-zone]. PwC's June 2026 client alert is explicit: "Firms without a MiCAR licence must stop providing regulated crypto-asset services to EU clients immediately on 1 July 2026" [https://legal.pwc.de/content/services/regcore-client-alert/pwc-legal-client-alert-after-the-micar-cliff-edge-june-2026.pdf]. CMS Expert Guide confirms reverse-solicitation exemption is "exceptional and applies only when" (i) EU client initiates entirely on own initiative, (ii) limited to specific service, (iii) cannot expand [https://cms.law/en/int/expert-guides/cms-expert-guide-to-crypto-regulation/eu-chapter-on-micar]. FinTelegram's compliance tests from Italy and Austria "confirmed that Hyperliquid accepts deposits and allows trading of perpetual futures — MiFID II financial instruments — without identification, geo-blocking or EU perimeter controls" — i.e. an EU user on HL is currently operating outside the law [https://fintelegram.com/defi-is-not-a-legal-black-hole-why-mica-already-reaches-axiom-hyperliquid-co-and-why-eu-regulators-are-still-looking-away/].

UK: FCA formally warned against Hyperliquid [https://www.linkedin.com/posts/blazetrends_uk-financial-conduct-authority-warns-against-activity-7468677866457829376-k7WJ]. No access from UK.

US: CFTC has signalled intent to regulate DeFi perps via DCM license reform. Hyperliquid already blocks US users at protocol layer [https://cleansky.io/blog/hyperliquid-cftc-regulation-nymex-2026/]. No access from US.

**Net regulatory position for `mm-crypto-bot`:** the bot runs on `bybit.eu`, which is a MiCAR-licensed venue. Adding Hyperliquid as an execution venue puts the bot's operator in the cross-hairs of every EU regulator. The compliance and reputational cost dwarfs the +0.3–0.6%/month estimated carry alpha.

### 6.6 Data feed reliability

Hyperliquid's public Info API has no documented rate limit and no SLA. During the 2025-10-11 ADL event, Hyperliquid maintained "100% uptime" but several third-party data providers (Coinglass, mmflow.ai) reported stale or missing data feeds [https://x.com/chameleon_jeff/status/1977066751717429516]. The `historical_data` GitHub repo [https://github.com/hyperliquid-dex/historical_data] is the most reliable backfill but is not a guaranteed-availability archive. Moon Dev maintains a rate-limit-free mirror [https://github.com/moondevonyt/Hyperliquid-Data-Layer-API] which is a reasonable secondary source for backtest data.

### 6.7 Network / bridge tail risk

Hyperliquid L1 has had multiple outages during high-volatility events (Apr 2024 brief halt; multiple HIP-3 markets have stalled during off-hours when oracle updates cease). Bridge withdrawals during stress events can take 1–7 days (the unbonding period for staked HYPE is 7 days [https://eco.com/support/en/articles/15191998-hyperliquid-fees-explained-maker-taker-funding-and-withdrawal-in-2026]). If the bot holds HL-side margin and the bridge stalls, the bot cannot de-risk.

---## 7. Phase 25 #2 Recommendation

**Recommendation: SKIP integration of Hyperliquid funding as a primary alpha source.**

**Reasoning (ranked by weight):**

1. **Regulatory ceiling (heaviest weight).** MiCAR/MiFID II/FCA/CFTC all converging on blocking EU/UK/US retail access to Hyperliquid from 2026-07-01 onward. Bot's existing `bybit.eu` channel is MiCAR-compliant; HL is not. Adding HL execution breaks compliance posture and exposes operator to enforcement risk that is non-linear in size (a single EU retail complaint can trigger an AMF/ESMA investigation).

2. **Insufficient alpha lift.** Estimated carry alpha at +0.3–0.6%/month on $50k notional is BELOW the +0.5–1.0%/month Phase 6 empirical floor the user uses as the minimum for new alpha sources. To exceed the floor would require either (a) scaling beyond the HL capacity bound, or (b) integrating the Binance lead → HL lag direction (Track C territory, not Track A).

3. **Asymmetric tail risk.** Oct 2025 ADL haircut of ~$660M–$2.1B in 12 minutes proves that the platform's "insurance fund" backstop is insufficient in stress. The JELLY oracle-override precedent proves the protocol will intervene in favour of the HLP vault when conflict arises. A profitable carry position is exactly the profile that gets haircut first.

4. **Capacity bound.** $30–80k notional per side is the realistic ceiling before the bot's own footprint widens the HL premium. Scaling above this compresses the edge to zero.

5. **Operational complexity vs. incremental alpha.** Engineering cost 1–2 weeks for a +0.3–0.6%/month signal is poor ROI. Same engineering budget applied to the Phase 25 #1 (Donchian + Pivot cap-tuning continuation) or Phase 26 (Track B: dYdX v4 / Track C: cross-venue lead-lag) yields higher expected lift.

**What to keep:**

- **Free data feed integration** as monitoring only. Add `metaAndAssetCtxs` + `predictedFundings` polling to the existing market-data plane; do NOT route orders. Cost: 1–2 days engineering.
- Use the HL funding-vs-CEX spread as a **regime indicator** in the existing portfolio model. When the spread is in the top decile, the existing Phase 24 strategies might be tilted to take more directional risk; when it is in the bottom decile, reduce exposure. This is not alpha, but it is signal.
- Monitor the regulatory landscape. If ESMA backtracks on the MiFID II classification of perps, or if Hyperliquid acquires an EU CASP license through an M&A, revisit this report.

**Suggested follow-up research:**

- Phase 26 candidate: **Track C (cross-venue lead-lag)**. The Arrakis finding (Binance leads HL on 29/29 assets, lag of ~700 ms) is exploitable as a price-discovery trade, not a funding trade. The alpha direction is larger than the funding carry because the bot is not delta-neutral.
- Phase 26 candidate: **dYdX v4 funding comparison** (Track B). dYdX has a Cosmos-sdk chain, similar CLOB model, different fee/slashing structure, and may be accessible to EU users via the dYdX Unlimited front-end which is registered in Cyprus (potentially MiCAR-compliant).
- Phase 26 candidate: **Bybit × Binance basis** (Track E). Same funding-spread mechanism but with both legs on CEX venues the bot already uses. Lower regulatory risk, higher fee drag, simpler integration.

---

## Appendix A — Funding rate formula derivation (from Hyperliquid docs)

For a long position of 10 contracts on BTC-PERP when the impact bid is $10,100 and oracle is $10,000:

```
Premium = (Impact bid price - Spot Price) / Spot Price
        = (10,100 - 10,000) / 10,000 = 0.01 = 1%

Clamped Difference = clamp(interest_rate - premium_rate, -0.05%, 0.05%)
                  = clamp(0.01% - 1%, -0.05%, 0.05%) = -0.05%

Funding Rate (8h) = Premium + Clamped Difference = 1% - 0.05% = 0.95%
Hourly payment    = 0.95% / 8 = 0.11875% per hour
Position payment   = 10 * $10,000 oracle * 0.0011875 = $118.75 per hour
                   ≈ $2851 per day from longs to shorts at this premium
```

Source: [https://hyperliquid.gitbook.io/hyperliquid-docs/trading/funding], with corroborating description in [https://medium.com/@joaotx/inside-the-perpetual-the-mechanics-of-funding-rates-3896384695c7] and [https://www.chainup.com/blog/hyperliquid-funding-rate-engine-explained/].

This is an extreme example (1% premium is far above typical 0.001–0.012% range), but illustrates the formula end-to-end. A typical hourly rate of 0.003% on a 10 BTC position = $3 per hour = $72 per day.

---

## Appendix B — Glossary

- **Funding rate:** periodic payment between long and short perp holders to keep perp price tethered to spot. Settled every 1h on Hyperliquid, every 8h on Binance/Bybit/OKX.
- **Premium index:** time-weighted average of (impact_bid - oracle) / oracle, sampled every 5s and averaged over the funding interval.
- **Impact notional:** $20k for BTC/ETH, $6k for others — the size used to compute the impact bid/ask price that enters the premium.
- **HLP:** Hyperliquidity Provider vault — protocol-side market maker + backstop liquidator.
- **ADL:** Auto-deleveraging — last-resort loss socialization, ranks profitable counterparties by `(mark/entry) × (notional/account_value)`.
- **HIP-3:** Builder-deployed perpetuals framework (Oct 2025); deployer stakes 500k HYPE, configures oracle + leverage + fees, market runs on HL's matching engine.
- **AQA:** Aligned Quote Asset (Circle USDC has this status on HL since May 2026; 90% of reserve yield flows to HL for HYPE buybacks).

---

## Appendix C — Key URLs (full list in sources.md)

- Hyperliquid funding docs: https://hyperliquid.gitbook.io/hyperliquid-docs/trading/funding
- Hyperliquid oracle docs: https://hyperliquid.gitbook.io/hyperliquid-docs/hypercore/oracle
- Hyperliquid ADL docs: https://hyperliquid.gitbook.io/hyperliquid-docs/trading/auto-deleveraging
- Hyperliquid HIP-3 docs: https://hyperliquid.gitbook.io/hyperliquid-docs/hyperliquid-improvement-proposals-hips/hip-3-builder-deployed-perpetuals
- Funding-aware market-making paper: https://arxiv.org/pdf/2605.06405.pdf
- Autodeleveraging paper: https://arxiv.org/abs/2512.01112
- DefiLlama Hyperliquid metrics: https://defillama.com/protocol/hyperliquid
- Hyperliquid info API: https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint/perpetuals
- Hyperliquid historical data: https://github.com/hyperliquid-dex/historical_data
- PwC MiCAR cliff alert: https://legal.pwc.de/content/services/regcore-client-alert/pwc-legal-client-alert-after-the-micar-cliff-edge-june-2026.pdf

---

**End of REPORT.md (Phase 25 Track A, Hyperliquid funding microstructure)**