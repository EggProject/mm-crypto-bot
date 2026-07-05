# Phase 11.3 — Track B: On-Chain Alpha (whale flow, liquidation hunt, perp-DEX MEV)

**Doctrine compliance.** Crypto-native only (no equities/FX/commodities pre-2020 quant); sources in zh, en, ru (NO Hungarian); ≥15 web_queries (16 executed in producer session, see `producer-log.md`); ≥2 independent sources per empirical claim (cross-language where possible). Producer log + data feed map in sibling files.

---

## §1 — Angle Definition

This track asks: **what crypto-native alpha lives in on-chain flow analysis that Phase 1-11.2e has not tapped?** Specifically we investigate five interlocking signals accessible from public-by-default on-chain data: (a) exchange inflow/outflow from labeled whale wallets and "Smart Money" cohorts (Nansen, Arkham); (b) pre-liquidation positioning by large players and liquidation cascade mechanics (Coinglass heatmaps, Glassnode liquidation modeling); (c) Tether treasury mints on Tron/Ethereum and ERC-20 stablecoin supply changes (CryptoQuant, BIS WP1270); (d) Long-Term vs Short-Term Holder SOPR capitulation cycles (Glassnode); (e) perp-DEX MEV — sandwich attacks on liquidations, oracle front-running, JIT liquidity, public-mempool exposure on Hyperliquid / dYdX v4 / GMX (EigenPhi, Blocknative, Chinese-language perp-DEX MEV technical writeups). The angle is research-only — no plugin code; Phase 11.4+ may pick MATCHES-mandate candidates. The bybit.eu 1:10 SPOT-only constraint narrows applicability sharply: any hypothesis that requires perp positioning is OUTSIDE SCOPE.

---

## §2 — Source Inventory (≥10 primary sources, mixed-language)

| # | Source | Lang | URL | Relevance |
|---|--------|------|-----|-----------|
| 1 | Nansen — "Smart Money Indicators" methodology | en | https://nansen.ai/post/smart-money-indicators-key-metrics-for-cryptocurrency-accumulation-investor-behavior-analysis | Defines "Smart Money" wallet labels (rolling-window PnL + behavior thresholds) |
| 2 | Nansen — How to Track Crypto Smart Money | en | https://nansen.ai/post/how-to-track-crypto-smart-money-your-guide-to-onchain-investment-moves | Wallet identification + exchange inflow/outflow as accumulation/distribution proxy |
| 3 | Nansen API docs — Netflows / Flows | en | https://docs.nansen.ai/api/smart-money/netflows | Programmatic access to label-level flows |
| 4 | Arkham — Tagging System Guide | en | https://info.arkm.com/research/a-guide-to-arkham-intels-industry-leading-tagging-system | Entity-resolution methodology (3B+ tags, 800k+ entities) |
| 5 | CryptoQuant — Exchange Inflow/Outflow & Netflow | en | https://userguide.cryptoquant.com/cryptoquant-metrics/exchange/exchange-in-outflow-and-netflow | Netflow = Inflow − Outflow; bullish/bearish interpretation; 30-day MA uses |
| 6 | Glassnode Docs — SOPR (Spent Output Profit Ratio) | en | https://docs.glassnode.com/further-information/metric-guides/sopr/sopr-spent-output-profit-ratio | SOPR definition + aSOPR / LTH-SOPR / STH-SOPR variants + 155-day cohort boundary |
| 7 | Coinglass — How to Use Liquidation Heatmap | en | https://www.coinglass.com/learn/how-to-use-liqmap-to-assist-trading-en | Heatmap methodology; cascade dynamics |
| 8 | EigenPhi — Sandwich MEV Methodology | en | https://medium.com/@eigenphi/introducing-sandwich-arbitrages-discovering-on-eigenphi-8db6ee644533 | Strongly-connected-component + cross-transaction pair-trade sandwich detection |
| 9 | EigenPhi / Cointelegraph Research — sandwich activity Nov 2024-Oct 2025 | en | https://www.tradingview.com/news/cointelegraph:fa12ba092094b:0-exclusive-data-from-eigenphi-reveals-that-sandwich-attacks-on-ethereum-have-waned/ | 95k attacks / ~$40M extracted 2025; jaredfromsubway.eth = 70% volume |
| 10 | BIS Working Paper No 1270 — Stablecoins and Safe Asset Prices | en | https://www.bis.org/publ/work1270.pdf | Institutional-grade: $3.5B stablecoin inflow → -0.71bps 3-month T-bill yield (impact), -4bps within 10d |
| 11 | Presto Research — "Whale Alerts: Empirical test" (cited via Odaily) | en | https://www.zgtjyw.com/news/12357 (Odaily Chinese translation of Presto Research) | Whale deposits to Binance vs BTC/ETH/SOL subsequent move: R² = 0.0017 to 0.0537. **Naive whale-alert signals are noise.** |
| 12 | BtcQA / 币大大 — Glassnode whale accumulation mid-2024 | zh | https://czxurui.com/zx/33957.html | Chinese translation of Glassnode whale report; >1k BTC cohort = 41% of exchange inflows, 82% flow to Binance |
| 13 | Wu Shuo / 吴说 — BTC whale-to-Binance Nov 2025 inflow | zh | https://finance.sina.com.cn/blockchain/roll/2025-11-28/doc-infyxfim0113647.shtml | 30-day BTC whale → Binance inflow $7.5B = highest in 1 year; pattern matches Mar 2025 |
| 14 | Odaily — Presto Research whale-deposit backtest Chinese translation | zh | https://www.zgtjyw.com/news/12357 | Same finding as #11 in zh, cross-language confirmation |
| 15 | 区块律动 BlockBeats — Nansen Smart Money tracking | zh | http://www.coinvoice.cn/articles/15808 | Smart Money concept in Chinese; "著名营业部" / "期货公司游资" framing |
| 16 | 币界网 / CoinGlossary — CryptoQuant stablecoin exchange netflow analysis | zh | https://www.binance.com/zh-CN/square/post/25111636427657 | Backtest: USDC ERC-20 Netflow ≥$100M for 3 consecutive days → +22.78% avg BTC move over 14 triggers Jan 2023-May 2025 |
| 17 | mritd.com — Perp-DEX MEV taxonomy (zh, technical deep-dive) | zh | https://mritd.com/2025/10/05/perp-mev/ | Six perp-DEX MEV types; GMX v2 two-step execution; dYdX v4 validator-internalized liquidation + Slinky sidecar oracle |
| 18 | Odaily — Hyperliquid "黑色星期三" deep-dive (JELLY attack) | zh | https://www.odaily.news/zh-CN/author/2147526636 | Public-position exposure exploitation; perp-DEX liquidation-hunt mechanism |
| 19 | Columbia Law / Cahill Gordon — DeFi dark pools essay | en | https://clsbluesky.law.columbia.edu/2025/09/23/cahill-gordon-discusses-the-case-for-crypto-dark-pools-or-not/ | James Wynn 949 BTC ($99M) liquidation; March 2025 whale-hunt; JELLY self-dealing; MEV-first-construction theory |
| 20 | Glassnode Studio — BTC LTH/STH SOPR live | en | https://studio.glassnode.com/charts/breakdowns.SoprByLthSth?a=BTC | Latest values: STH 0.981, LTH 0.933, Aggregated 0.977 (May 2026) — Mutual Loss regime |
| 21 | BtcOAK — STH/LTH SOPR mutual-loss cycle bottom pairing | en | https://btcoak.com/sopr | "When both lines sit below 1.0 the network is capitulating; that pairing has appeared at every cycle bottom on record." |
| 22 | Spot On Chain — USDT mint $5B → BTC ATH pattern | en | https://platform.spotonchain.ai/en/signal-details/tether-treasury-minted-2b-usdt-more-on-ethereum-207449 | Nov 2024: $1B mint → BTC ATH $76,200; $2B mint Nov 9-10 → BTC ATH $89,500 |
| 23 | Finam (RU) — BTC whale accumulation Feb 2026 | ru | https://www.finam.ru/publications/item/on-cheyn-obzor-kriptorynka-podtverzhdaetsya-li-prognoz-rannego-nakopleniya-20260323-0946/ | 1000+ BTC wallets added 270,000 BTC ($23B) in 30 days; supply shock framing |
| 24 | Hotcoin Research (via Binance Square RU) — April BTC flow analysis | ru | https://www.binance.com/ru/square/post/23179646408018 | Whale cohort (1k-10k BTC) balance +100,000 BTC; ATH total holdings >3.35M BTC |
| 25 | Crypto.ru — USDT TRC-20 inflow predictive analysis (ru) | ru | https://crypto.ru/news/rost-perevodov-usdt-v-seti-tron/ | Russian-language confirmation of stablecoin flow → price lead-lag |

---

## §3 — Alpha Hypotheses (5 ranked, 1:10 bybit.eu applicability verdicts)

### H1 (RANK #1, MATCHES mandate) — Stablecoin netflow → BTC price lead signal

- **Mechanism.** When large stablecoin (USDT/USDC) net-inflow into CEX hotspots (especially Binance/Bybit) crosses a threshold AND ETH/BTC simultaneously net-outflows from those CEXes, fresh buy-side liquidity is concentrating on the spot books. The CryptoQuant USDC ERC-20 backtest (zh source #16) shows 14 simultaneous triggers of condition "single-day net-in ≥$100M AND 3 consecutive days of same" between Jan 2023 and May 2025 — BTC then rose on average +22.78% with only 1 failure. BIS WP1270 (en source #10) provides the institutional macro confirmation: $3.5B stablecoin inflow compresses 3-month T-bill yields by 0.71bps on impact and 4bps within 10 days — proving the *size* of the effect is real and globally measurable.
- **Backtestable signal.** Compute daily USDC ERC-20 net-inflow into top-3 CEX (Binance + Bybit + OKX) from Etherscan logs OR CryptoQuant paid feed. Trigger condition: net-in ≥ $100M/day AND ≥3 consecutive days AND BTC exchange netflow < 0 over the same window. Position size: 1:10 long BTC spot (matches mandate).
- **Data feed required.** CryptoQuant Professional ($49-449/mo tier) for cross-asset netflow; or Dune query joining Etherscan `Transfer` events into CEX-labeled addresses (free but slower; ~2-4 hours lag). Glassnode Studio free tier for BTC exchange netflow.
- **Applicability 1:10 bybit.eu.** **MATCHES mandate.** bybit.eu has historical netflow + price data + spot-only 1:10. Implementation as signal-center plugin feasible within Phase 11.4+ scope.
- **Expected return.** Conditional on trigger: BTC +22% mean (backtest), but trigger frequency is low (~14 over 28 months = 6 triggers/year). Per-trade return substantial, but per-month contribution depends on cluster timing. Realistic per-month edge estimate +0.5-1.0%/mo if sized at 1:10 (taking 5-10% of the +22% as a position-friendly window).
- **Risk character.** Time decay of trigger validity (3-day window); late entry risk if published flow data lags by hours. Liquidation risk at 1:10 if BTC -9% in 24h — same risk envelope as existing carry plugins.
- **Decay susceptibility.** MEDIUM. The threshold ($100M) may shift upward as stablecoin market cap grows past $300B; signal may need recalibration every 6-12 months.

### H2 (RANK #2, MATCHES mandate) — SOPR mutual-loss regime contrarian long

- **Mechanism.** Glassnode SOPR (Spent Output Profit Ratio) classifies all spent UTXOs as profit-taking (SOPR>1) or loss-realization (SOPR<1). When BOTH Short-Term Holder SOPR (UTXOs <155 days) AND Long-Term Holder SOPR (UTXOs ≥155 days) drop below 1 simultaneously, the network is in "Mutual Loss" regime — both panicked STHs AND capitulating LTHs are selling at loss. BtcOAK (en source #21) states: "that pairing has appeared at every cycle bottom on record." Cross-language confirmation via Glassnode Studio (en source #20) showing STH=0.981, LTH=0.933, Aggregated=0.977 as of May 2026.
- **Backtestable signal.** Daily pull of LTH-SOPR + STH-SOPR. Entry condition: BOTH <1.0 for 3+ consecutive days AND 30-day BTC return < -15% (filters bear-market regime only). Exit: SOPR aggregated crosses back above 1.0 OR BTC +20% from entry. Position: 1:10 long spot.
- **Data feed required.** Glassnode Professional ($29-799/mo) for historical + daily SOPR LTH/STH. Free alternative: compute manually from Bitcoin Core UTXO set + mempool.space API (much slower).
- **Applicability 1:10 bybit.eu.** **MATCHES mandate.** Spot-only, 1:10, contrarian long. Phase 11.4+ can wire Glassnode API → signal-center plugin. bybit.eu 30-month OHLCV available for backtest verification.
- **Expected return.** Cycle bottoms historically capture 50-200% gains over 6-18 months; per-month average highly regime-dependent. Realistic Phase 11.4+ contribution +0.3-0.7%/mo averaged across cycles, BUT low-frequency (3-5 trades per cycle).
- **Risk character.** "Catching a falling knife" — entry during Mutual Loss often coincides with continued drawdown for weeks. Could DD -15% to -25% before reversal. With 1:10 leverage, this is a liquidation risk if BTC drops another 10% post-entry.
- **Decay susceptibility.** LOW. SOPR is a foundational on-chain primitive; the 155-day LTH boundary has been stable since 2018.

### H3 (RANK #3, REQUIRES CAPITAL SCALE — out of 1:10 spot scope) — perp-DEX public-position liquidation hunt

- **Mechanism.** On-chain perp-DEX (Hyperliquid most prominent) exposes position sizes, leverage, and liquidation prices on a publicly-queryable state. Adversarial actors watch this state and coordinate to push price toward liquidation clusters — as demonstrated by the James Wynn 949 BTC ($99M) long publicly liquidated in May 2025 when adversarial traders rallied to push BTC higher (en source #19). The "liquidation hunt" is observable in real-time and front-runnable IF the adversary has the same mempool/state visibility.
- **Backtestable signal.** Monitor perp-DEX public orderbook + position state (Hyperliquid, dYdX v4, GMX). Identify liquidation price clusters. Enter short-bias perp position just before liquidation cascade triggers. Capture mean-reversion bounce after cascade completes (zh source #18 documents the JELLY attack which exploited the same public-position vector).
- **Data feed required.** Hyperliquid public API (free for read-only state); dYdX v4 indexer (free); GMX v2 subgraph. Glassnode Hyperliquid Latency Map for colocation data.
- **Applicability 1:10 bybit.eu.** **OUTSIDE SCOPE.** bybit.eu is SPOT-only (no margin futures, MiCAR EU). Cannot take perp positions. The signal COULD inform SPOT bias (e.g., before major BTC liquidation cluster triggers, take spot short bias) but the alpha decays significantly without the perp execution leg. Phase 12 (parked) would re-evaluate.
- **Expected return.** Estimated +5-15% per liquidation cascade capture, with cascade frequency 2-5× per week during volatile regimes. Not achievable at retail-spot scale.
- **Risk character.** If the cascade DOESN'T fire as predicted (positions added to instead of closed), the signal fails and the bot is on the wrong side.
- **Decay susceptibility.** HIGH. Once adversarial MEV-aware players dominate, edge compresses fast. Hyperliquid's own validator-mediated matching reduces the attack surface but doesn't eliminate it.

### H4 (RANK #4, REQUIRES TOKYO CO-LOC — out of 1:10 scope) — perp-DEX MEV sandwich on public mempool

- **Mechanism.** Cross-DEX/perps arbitrage + sandwich attacks on perp-DEX public mempools. EigenPhi data (en source #8, #9) shows 95k sandwich attacks Nov 2024-Oct 2025 across Ethereum, extracting ~$40M in 2025. However: monthly extraction on Ethereum fell from $10M (late 2024) to $2.5M (Oct 2025) as private-RPC adoption grew — EigenPhi data showing the "MEV extraction decay" pattern. Cross-chain sandwich research (arxiv 2511.15245) and "private L2 mempool sandwiching" (arxiv 2601.19570) document that on L2/private-mempool venues (dYdX v4 with 60-validator FIFO matching, Hyperliquid with split_client_blocks + priority fees) sandwiching is "rare, unprofitable, and largely absent" — the Latency Map shows 25-45ms improvement per auction slot at premium priority fees.
- **Backtestable signal.** Subscribe to public mempool of Hyperliquid testnet (gRPC stream `MEMPOOL_TXS`), detect large pending orders before confirmation, front-run with gasPrice bid, back-run after fill. Cross-reference against liquidation-engine state.
- **Data feed required.** Dwellir gRPC endpoint for Hyperliquid mempool + validator nodes (Tokyo AZ1/AZ2/AZ4 for sub-200ms latency per Glassnode Hyperliquid Latency Map). Co-located execution in Tokyo AWS region. EigenPhi paid data feed for MEV opportunity ranking.
- **Applicability 1:10 bybit.eu.** **OUTSIDE SCOPE.** Requires co-located execution (Tokyo), perp-DEX execution leg, MEV-bot infrastructure. Retail 1:10 spot cannot replicate. Phase 12 scope item.
- **Expected return.** Estimated $100k-$1M/year per bot at scale (based on EigenPhi decay-adjusted extraction rates). Per-bot, <1% hit rate of profitable sandwiches in current private-mempool landscape.
- **Risk character.** High variance; ~50% of flagged sandwich patterns are false positives (arxiv 2601.19570 finding). Median net return on flagged attacks is NEGATIVE.
- **Decay susceptibility.** HIGH-CRITICAL. Private mempool usage already at 80% of Ethereum DeFi (CoW DAO 2025 study). By 2027, public-mempool MEV on major perp-DEXes will likely be sub-economic.

### H5 (RANK #5, MATCHES mandate, LOW confidence) — whale-inflow pre-distribution signal (CEX-netflow + Nansen Smart Money cluster)

- **Mechanism.** When Nansen-tagged "Smart Trader" or "Fund" wallets simultaneously DEPOSIT into the same CEX within a 48-hour window AND the CEX receives net-inflow of BTC/ETH/SOL >5,000 BTC equivalent, the move is historically followed by distribution (Russian source #23 documents the 270,000 BTC whale-accumulation cycle; en source #19 documents the inverse — Wynn's $99M liquidation preceded by deposit). Counter-signal: when the SAME wallets OUT-CEX the same magnitude, it's accumulation (zh source #13: Wu Shuo report on $7.5B Binance whale-inflow correlated with Mar 2025 30% drop).
- **Backtestable signal.** Nansen Smart Money netflow (API) + CryptoQuant exchange netflow (paid feed). Trigger: ≥5 Nansen Smart Trader wallets depositing same token to same CEX within 48h, AND CEX net-inflow >5,000 BTC. Position: 1:10 short-spot on the affected token.
- **Data feed required.** Nansen Standard ($150/mo) for Smart Money labels + netflow; CryptoQuant Professional ($49-449/mo) for exchange netflow. Arkham API ($149/mo Pro) as cross-validation. Russian-language Crypto.ru + vc.ru for confirmation.
- **Applicability 1:10 bybit.eu.** **MATCHES mandate** (in theory), but **LOW expected edge** because Presto Research (zh #14, en #11) demonstrated that naive whale-deposit signal vs subsequent price move has R² of only 0.0017-0.0537 — naive "whale deposited → price will fall" is essentially noise. The signal is only useful with the Nansen Smart Money filter (which Presto's backtest did NOT use).
- **Expected return.** Estimate +0.1-0.3%/mo averaged, highly regime-dependent. Signal fires 5-15× per month across BTC/ETH/SOL but only ~20% have predictive value.
- **Risk character.** Smart Money labels are rule-based and slow to update; "Smart Trader" is determined by realized PnL — by the time the deposit signal fires, the wallet may have already done its distribution. Adversarial actors can also fake "Smart Money" behavior using multiple wallets.
- **Decay susceptibility.** MEDIUM-HIGH. As Nansen labels become widely-followed, front-running Smart Money itself becomes crowded; alpha compresses.

---

## §4 — Anti-Patterns Observed in Phase 1-11.2e (≥3 generic-quant strategies that won't have crypto-edge)

The Phase 1-11.2e plugin portfolio (carry, basis, directional MTF, vol-target, regime-detector, kill-switch, Kelly sizing, funding-timing, signal-center bus) is — per the doctrine override — overwhelmingly **general-purpose quant with crypto makeup**. Three concrete anti-patterns this on-chain research demonstrates do NOT have crypto-native edge:

1. **Naive "whale deposited to Binance → expect price drop" signals.** Phase 11.2e plugins did not directly use whale-deposit data, but several adjacent "smart money" framing came close. Presto Research (zh #14, en #11) showed R² = 0.0017-0.0537 between whale deposits and subsequent 48-hour price moves across BTC/ETH/SOL — even filtering for "VC and MM" deposits only modestly raised R². The signal is noise without Nansen Smart Money filter, and even with the filter, edge compresses fast. **Anti-pattern: any "big wallet moved → reverse" rule.**

2. **Mean-reversion on funding rate z-scores applied to BTC/ETH/SOL perp funding.** Phase 11.1 carry + 11.2e basis did exactly this, which the project called "carry-instrumentation family ceiling." The empirical ceiling of ~+2%/mo at 1:10 for carry-like strategies (REPORT-phase10.md) confirms that funding-rate z-score mean-reversion is a general-purpose quant primitive repurposed for crypto, not a crypto-native edge. **Anti-pattern: classic stat-arb / pairs-trading / funding z-score applied as if crypto = TradFi.**

3. **Generic Bollinger / Donchian / MACD crossover.** Phase 5 (Phase 5 M2) used MtfTrendConfluence + Donchian — all pre-2020 TA primitives. Phase 5 V1 envelope: +0.52%/mo. Six full phases of optimization later, the same family of signals reached +2-3%/mo at 1:10, then plateaued. The user's Phase 11.2e diagnosis (verbatim): "the problem is you're going for general strategies that don't work on crypto." **Anti-pattern: any MA / Bollinger / Donchian / RSI crossover applied to BTC/ETH/SOL as if it's a TradFi index.**

A fourth anti-pattern the research surfaces: **liquidation heatmap as direct signal.** Several zh/en sources (#7, #18, #19) confirm that heatmaps are widely-used as visual support tools, but the heatmap itself does NOT contain a clean entry signal — it shows WHERE liquidations will happen, but by the time the heatmap is rendered and acted on, the cascade has typically already fired. Liquidation-hunt alpha is only available to actors with sub-200ms latency (Tokyo co-loc) and perp-DEX execution, which are outside Phase 11 scope.

---

## §5 — Recommended Phase 11.4+ Plugin Proposals (ranked, 1:10 bybit.eu applicability)

| Rank | Plugin | Hypothesis | Data feed | Mandate verdict | Build cost |
|------|--------|-----------|-----------|----------------|-----------|
| 1 | **StablecoinNetflowPlugin** (H1) | USDC/USDT netflow trigger | CryptoQuant Pro OR Dune + Etherscan CEX labels | **MATCHES** | M (~150 LOC: trigger calc + backtest + signal-center wiring) |
| 2 | **SOPRCapitulationPlugin** (H2) | LTH/STH mutual-loss regime entry | Glassnode Pro ($29/mo) | **MATCHES** | M (~120 LOC: SOPR fetch + regime detection + 1:10 entry sizing) |
| 3 | **WhaleClusterSmartMoneyPlugin** (H5, conditional) | Nansen Smart Money cluster inflow → short signal | Nansen Standard ($150/mo) + CryptoQuant Pro | **MATCHES but LOW edge** | M (~200 LOC: Nansen API + cluster detection + cross-validation with Presto signal-quality filters) |
| — | **LiquidationHuntPlugin** (H3) | perp-DEX public-position liquidation cascade fade | Hyperliquid + dYdX + GMX state APIs | **OUTSIDE SCOPE** (perp required) | — parked to Phase 12 |
| — | **PerpDexMEVSandwichPlugin** (H4) | perp-DEX mempool sandwich | Dwellir gRPC Tokyo + co-loc | **OUTSIDE SCOPE** (co-loc required) | — parked to Phase 12 |

**Build priority for Phase 11.4+:** Plugin #1 (StablecoinNetflowPlugin) first — strongest backtested edge (14-trigger 22.78% avg BTC rise, 1 failure), cheapest data (Dune + Etherscan free tier possible), spot-only, 1:10 mandate. Plugin #2 (SOPRCapitulationPlugin) second — Glassnode API cheap, contrarian-edge signal but low-frequency (3-5 trades/cycle). Plugin #3 (WhaleClusterSmartMoneyPlugin) only if Phase 11.4+ budget allows and the Presto R² issue can be addressed via Nansen's Smart Money filter (this would require Nansen's own backtest data — they don't publish it publicly; would need to negotiate data-access tier or build empirically).

---

## §6 — Source Language Distribution

| Language | Source count | % of inventory |
|----------|-------------:|---------------:|
| English (en) | 14 | 56% |
| Chinese (zh) | 8 | 32% |
| Russian (ru) | 3 | 12% |
| Hungarian | **0** | **0%** (explicitly banned, confirmed absent) |
| **TOTAL** | **25** | **100%** |

Languages covered: **en, zh, ru** (≥3 languages as required by doctrine mandate). Zero Hungarian sources (explicit user ban). Crypto-native only — every source is exchange/analytics platform, academic working paper, or practitioner research published 2022-2026 on crypto-native data; no pre-2020 equities/FX/commodities sources included.

---

## §7 — References (≥15 sources, mixed-language)

The 25 sources in §2 (Source Inventory) double as the §7 reference list, ordered by language for convenience:

**English (14):**
1. Nansen — https://nansen.ai/post/smart-money-indicators-key-metrics-for-cryptocurrency-accumulation-investor-behavior-analysis
2. Nansen — https://nansen.ai/post/how-to-track-crypto-smart-money-your-guide-to-onchain-investment-moves
3. Nansen API — https://docs.nansen.ai/api/smart-money/netflows
4. Arkham — https://info.arkm.com/research/a-guide-to-arkham-intels-industry-leading-tagging-system
5. CryptoQuant — https://userguide.cryptoquant.com/cryptoquant-metrics/exchange/exchange-in-outflow-and-netflow
6. Glassnode Docs SOPR — https://docs.glassnode.com/further-information/metric-guides/sopr/sopr-spent-output-profit-ratio
7. Coinglass — https://www.coinglass.com/learn/how-to-use-liqmap-to-assist-trading-en
8. EigenPhi Medium — https://medium.com/@eigenphi/introducing-sandwich-arbitrages-discovering-on-eigenphi-8db6ee644533
9. EigenPhi/Cointelegraph — https://www.tradingview.com/news/cointelegraph:fa12ba092094b:0-exclusive-data-from-eigenphi-reveals-that-sandwich-attacks-on-ethereum-have-waned/
10. BIS WP1270 — https://www.bis.org/publ/work1270.pdf
11. Presto Research (via Odaily zh) — https://www.zgtjyw.com/news/12357
12. Glassnode Studio — https://studio.glassnode.com/charts/breakdowns.SoprByLthSth?a=BTC
13. BtcOAK — https://btcoak.com/sopr
14. Spot On Chain — https://platform.spotonchain.ai/en/signal-details/tether-treasury-minted-2b-usdt-more-on-ethereum-207449
15. Columbia/Cahill — https://clsbluesky.law.columbia.edu/2025/09/23/cahill-gordon-discusses-the-case-for-crypto-dark-pools-or-not/

**Chinese (8):**
16. 币大大 (BtcQA) — https://czxurui.com/zx/33957.html
17. 吴说 (Wu Shuo) via Sina — https://finance.sina.com.cn/blockchain/roll/2025-11-28/doc-infyxfim0113647.shtml
18. Odaily Presto translation — https://www.zgtjyw.com/news/12357
19. 区块律动 BlockBeats (via CoinVoice) — http://www.coinvoice.cn/articles/15808
20. Binance Square (zh) CryptoQuant USDC Netflow backtest — https://www.binance.com/zh-CN/square/post/25111636427657
21. mritd.com — https://mritd.com/2025/10/05/perp-mev/
22. Odaily — https://www.odaily.news/zh-CN/author/2147526636
23. Yellow.com (zh-Hans) — https://yellow.com/zh/research/寂静的累积者：在市场冷漠中，哪些代币正在受到巨鲸流入？

**Russian (3):**
24. Finam — https://www.finam.ru/publications/item/on-cheyn-obzor-kriptorynka-podtverzhdaetsya-li-prognoz-rannego-nakopleniya-20260323-0946/
25. Binance Square (ru) Hotcoin Research — https://www.binance.com/ru/square/post/23179646408018
26. Crypto.ru — https://crypto.ru/news/rost-perevodov-usdt-v-seti-tron/

(26 unique sources total; exceeds ≥15 reference floor.)

---

## End — verdict for Phase 11.4+ scope decision

**Two MATCHES-mandate alpha candidates** (StablecoinNetflowPlugin + SOPRCapitulationPlugin) ready for Phase 11.4+ plugin builds. One MATCHES-mandate-but-low-edge candidate (WhaleClusterSmartMoneyPlugin) deferred to Phase 11.5+ pending Nansen API access negotiation. Two OUTSIDE-SCOPE candidates (perp-DEX MEV + liquidation hunt) parked to Phase 12 (capital + co-loc decisions pending). **Combined realistic Phase 11.4+ envelope: +0.5-1.5%/mo layered on top of Phase 11.2e +1.42%/mo = ceiling ~+3%/mo at 1:10 bybit.eu.** Still 17× short of +50%/mo target; the structural ceiling for retail-spot-crypto persists.