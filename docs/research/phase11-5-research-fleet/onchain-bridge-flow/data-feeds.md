# Data Feeds — Track D (onchain-bridge-flow)

Curated list of public data sources for plugin candidates P1–P6 in REPORT.md.

---

## Tier 1 — Authoritative (paid; production-grade)

### Glassnode (https://glassnode.com)
- **Used by:** P1 (CEX netflow)
- **Endpoints:**
  - `transactions/transfers_volume_to_exchanges_sum` (BTC, ETH, SOL)
  - `transactions/transfers_volume_from_exchanges_sum`
  - `market/price_usd_close` (for z-score normalization)
  - Studio chart: https://studio.glassnode.com/charts/transactions.TransfersVolumeExchangesNet?a=BTC
- **API tier:** Professional ~$30–50/mo for Net Transfer Volume + Exchange Reserve; Enterprise for tick-level.
- **Latency:** Daily bars default; Studio Pro tier unlocks intraday.
- **Strengths:** 11yr BTC history; AI Agent CLI for backtests (https://research.glassnode.com/ai-for-crypto-research/).
- **Verification role:** P1 primary feed; cross-check with CryptoQuant.

### CryptoQuant (https://cryptoquant.com)
- **Used by:** P1, P4 (USDT 60d market-cap-change)
- **Endpoints:**
  - `/asset/btc/chart/exchange-flows/exchange-reserve` (Exchange Reserve Total)
  - `/asset/btc/chart/exchange-flows` (Netflow Total)
  - `/alert/preset/672d24fc21a51523a6d09aff` (Bitcoin Apparent Demand)
  - Alerts preset list at https://cryptoquant.com/insights/quicktake
- **API tier:** Free tier covers reserve + flow basics; Pro for full archive.
- **Latency:** Real-time on-chain for top assets.
- **Strengths:** Per-exchange granularity (Binance, OKX, Bybit etc.) — critical for differentiating Binance-specific stress.
- **Caveat:** Vendor dispute noted in r/Bitcoin thread about exchange-balance definitions near 1.195M BTC.

### Coinglass / CoinGlass (https://www.coinglass.com)
- **Used by:** P1 (cross-validation), narrative supply metric
- **Endpoints:** `https://www.coinglass.com/Balance` — BTC exchange balances, all exchanges.
- **API:** `docs.coinglass.com/reference/exchange-balance-chart`.
- **Annual report 2025** confirms step-wise destocking pattern Apr→Nov 2025 (https://www.coinglass.com/learn/2025-annual-report-en).
- **Strengths:** Free tier covers aggregate; Pro/API for granular.
- **Caveat:** Reddit flagged suspicious pattern at 1.195M BTC level (data-integrity question mark).

### Nansen API (https://docs.nansen.ai)
- **Used by:** P3 (whale deposit spike), P6 (smart-money filters)
- **Endpoints:**
  - `Flow Intelligence` (smart_trader_net_flow_usd, whale_net_flow_usd, public_figure_net_flow_usd)
  - `PnL Leaderboard` (roi_percent_realised, nof_trades)
  - `Smart Money DEX Trades`
- **API tier:** Standard $150/mo, VIP $1,800/mo, Alpha $25k/yr.
- **Latency:** Real-time.
- **Strengths:** Labeled wallets for 300M+ addresses across 20+ chains; the gold standard for "who is moving the money."

### Arkham Intelligence (https://intel.arkm.com)
- **Used by:** P3 (alternative to Nansen), investigative entity-mapping
- **Pricing:** Free public + paid tier.
- **Strengths:** Entity-attribution engine; visualizer; AI assistant (Nov 2024, ~85% answer accuracy). Public-bounty marketplace for entity labels.
- **Latency:** Real-time.
- **Strengths:** Visual transaction graph; cross-chain.

---

## Tier 2 — Free / Freemium (good enough for daily/weekly signals)

### Farside Investors (https://farside.co.uk)
- **Used by:** P2 (IBIT ETF flows)
- **Data:** Daily US-spot-ETF netflows in CSV / table format; free access.
- **Coverage:** IBIT, FBTC, ARKB, BITB, HODL, BRRR, EZBC, BTCO, GBTC since Jan 2024.
- **Latency:** T+1 same-day post-market-close publication.
- **Caveat:** Manual table — scraping required for automation.

### DefiLlama Bridges (https://defillama.com/bridges)
- **Used by:** P5 (bridge inflow anomaly)
- **Endpoints:** Aggregate bridge volume per chain, per bridge (LayerZero, Wormhole, Stargate, etc.)
- **Latency:** Daily.
- **Strengths:** Free, no signup, broad coverage. Single best surface for cross-chain flow.
- **Watch for:** DefiLlama's own data-disagreement notices (they explicitly mark "estimate").

### Wormhole Explorer (https://wormholescan.io)
- **Used by:** P5 (token-level bridge tracking)
- **Endpoints:** Per token, per source/destination chain.
- **Latency:** Real-time.

### LayerZero Scan (https://scan.layerzero.network)
- **Used by:** P5
- **Endpoints:** Per message token, NFT, generic.
- **Latency:** Real-time.

### Circle CCTP Dashboard (https://developers.circle.com/stablecoins/docs/cctp)
- **Used by:** P5 (native USDC cross-chain flow)
- **Strengths:** Authoritative on USDC native bridges.

### Lookonchain (https://www.lookonchain.com)
- **Used by:** P6 (smart money narrative)
- **Format:** Free Twitter/X feed + iOS app + web dashboard; curated on-chain moves with narrative annotations.
- **Latency:** Real-time on social.
- **Caveat:** Curated narrative, not raw data — manual verification required.

### Spot On Chain (https://spotonchain.ai)
- **Used by:** P6
- **Format:** AI-driven wallet-tracking dashboards, multi-chain.
- **Pricing:** Free tier, premium available.
- **Strengths:** More rigorous than Lookonchain; closer to a label-clean label engine.

### Whale Alert (https://whale-alert.io)
- **Used by:** Tier-3 ambient alert layer; supports P3 indirectly.
- **Format:** Public Twitter + Telegram feeds + API.
- **API tier:** From $79/mo.
- **Caveat:** Surface signals — entity attribution limited.

---

## Tier 3 — Academic & Open Data

### arXiv 2501.05232 ("Intraday Bitcoin Response to Tether Minting/Burning")
- **Used by:** §3.4 (USDT 60d delta), P4 calibration.
- **Citation surface:** open.

### arXiv 2411.06327v2 (Chi/Chu/Hao 2024 — "Return and Volatility Forecasting Using On-Chain Flows")
- **Used by:** P1 calibration reference.
- **Findings:** ETH net inflows negatively forecast ETH returns at 1–6 hour intervals. USDT net inflows to exchanges positively forecast BTC/ETH returns at 1–2h intervals.
- **Note:** Does not test our 7d z-score variant — we would need to run that backtest ourselves.

### SSRN-id4247684 (Forecasting Bitcoin Volatility from Whale + CryptoQuant)
- **Used by:** P1 secondary reference.
- **Finding:** Pearson r = 0.47 between `|BTC to-from-exchange|` daily volume and BTC daily vol.

### BIS Working Paper 1270 (Stablecoins and Safe Asset Prices, 2024)
- **Used by:** P4 — stablecoin supply delta primary validation.
- **Findings:** Stablecoin supply correlates with CP issuance (1B stablecoin → 1.9B CP); negative correlation with CP rates.

### SNB 2023 working paper (Nguyen — Stablecoins and short-term funding markets)
- **Used by:** P4 secondary reference.

### Federal Reserve FEDS Notes 2024-02-23 ("Primary and Secondary Markets for Stablecoins")
- **Used by:** §3.4 + P4 third reference.

### Deep Blue Alpha (https://deepbluealpha.io) + (https://deepbluealpha.io/alternatives)
- **Format:** Free-tier whale intelligence; 16,469+ tracked whale wallets; conviction scoring; ETHFI cohort tracking (https://x.com/DeepBlueAlpha/status/2058335116733145293).
- **Strengths:** Free / no signup; comparable to paid tier on EVM chains.
- **Used by:** P6 research; could substitute Nansen for narrow wallet-list use cases.

### Genesis Volatility / Glassnode Studio / CryptoQuant Insights
- **Format:** Free weekly Quicktakes that summarize regime.
- **Used by:** validation cross-checks.

---

## Tier 4 — Niche / Community (research-fleet bonus)

### Odaily (https://www.odaily.news) — Chinese-language crypto research daily
- High-signal for Chinese on-chain forensics; covers Tianfeng, Wu Blockchain, Lookonchain and others in compiled form.

### Wu Blockchain (https://www.wublock.com) — Chinese crypto forensics feed
- Real-time translation into English via @WuBlockchain.

### Footprint Analytics (https://www.footprint.network) — Chinese on-chain analytics platform
- BscScan-equivalent UX for non-EVM chains; free.

### AI Coin / Apify scrapers (https://apify.com/gochujang/mayan-cross-chain-tracker, https://apify.com/gochujang/eigenlayer-restaking-tracker)
- Pre-built actors for cross-chain swap tracking + EigenLayer restaking flows.
- **Used by:** P5 supplementary; bonus for LRT-rotation alpha.

### Onchainflow.io (https://www.onchainflows.io)
- Real-time whale alerts to Telegram; entity scoring.
- **Used by:** P3 ambient alerts.

### Eigenlayer app dashboard (https://diverseoutlook.com)
- Live AVS restaking tracking; useful for P5 LRT sub-segment.

### blocksight.com (mentioned in YouTube https://www.youtube.com/watch?v=JFaR3Y9g77M)
- Profitable-projects-pre-discovery platform.

---

## Recommended Stack (Production-grade, monthly cost)

| Source | Cost | Backbone for |
|--------|------|--------------|
| Glassnode Pro | ~$50 | P1 |
| CryptoQuant Pro | ~$50 | P1, P4 |
| Coinglass API | ~$30 | P1 validation |
| Nansen Standard | $150 | P3, P6 |
| Arkham free + Pro | ~$99 | P3 (alternative) |
| Farside | $0 | P2 |
| DefiLlama | $0 | P5 |
| Lookonchain / Spot On Chain | $0 | P6 narrative |
| Whale Alert API | $79 | P3 ambient |

**Total estimated: ~$460/mo** for a defensible on-chain signal stack. Trivial compared to expected edge if even one of P1/P2/P4 reduces SCv1 downside in a 13-day ETF-outflow sequence (S23/S24 documented a $4.4B outflow with BTC -50% off-ATH).

---

## Tier-Specific Latencies

- **Real-time (sub-minute):** Whale Alert, Arkham, Nansen, Lookonchain
- **Real-time (5-15min):** Wormhole Explorer, LayerZero Scan, on-the-fly address tracking
- **Hourly:** DefiLlama Bridges aggregates, CryptoQuant exchange-flow buckets
- **Daily:** Glassnode bars, Coinglass daily snapshots, Farside ETF table

---

## Free-Tier Tiered View

For a research-fleet or bot-bootstrap run with $0 budget:
- Farside (P2)
- DefiLlama (P5)
- Lookonchain (P6 partial)
- Glassnode Studio free charts (P1 daily read on public web, not API)
- Whale Alert Twitter (P3 ambient)

That covers ~70% of the proposed plugin stack at zero cost. Paid Glassnode/CryptoQuant only required for systematic backtests and intraday frequency.
