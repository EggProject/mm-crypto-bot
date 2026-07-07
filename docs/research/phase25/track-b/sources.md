# Phase 25 Track B — dYdX v4 Funding Microstructure: Sources

All queries executed via `mavis mcp call matrix web_search`. Language key: `en` = English, `ja` = Japanese, `zh` = Chinese, `ko` = Korean (not used here; reserved for future cross-language work).

| # | Query | Source URL | Date | Lang | Key finding |
|--|--|--|--|--|--|
| 1 | dYdX v4 funding rate mechanics hourly interval formula isolated markets | https://docs.dydx.xyz/concepts/trading/funding | 2026-07-08 | en | Canonical formula: Premium = (Max(0, Impact Bid − Index) − Max(0, Index − Impact Ask)) / Index; Funding = Premium/8 + Interest. Hourly tick, 1-min sample. 8h cap = 600% × (IMF − MMF). |
| 2 | dYdX v4 perpetual funding rate BTC ETH statistics mean reversion 2024 2025 | https://dydx.forum/t/drc-update-default-funding-rate-for-isolated-markets/3417 | 2026-07-08 | en | DRC #3417 passed 95.51% to set isolated-market default funding to 0.125 bp/h (1 bp/8h), aligning with Binance/Bybit baseline. Effective March 2025. |
| 3 | dYdX v4 validator governance slashing events market parameters 2024 2025 | https://dydx.forum/t/drc-update-slashing-parameters/3259 | 2026-07-08 | en | DRC #3259: reduce SignedBlocksWindow 8192→2048, raise MinSignedPerWindow 0.2→0.8 to enhance responsiveness to lagging validators. Staged rollout Jan 2025. |
| 4 | dYdX token staking fee discount trading tier requirements | https://docs.dydx.xyz/concepts/trading/rewards | 2026-07-08 | en | Tiered staking fee discount up to 50% (Discount 2 column). Tier 1: 20,000 DYDX → 50% discount. Staking-based discount program approved by community in 2024. |
| 5 | dYdX Chain Indexer API historical funding rate data endpoint | https://docs.dydx.xyz/indexer-client/http | 2026-07-08 | en | `get_perpetual_market_historical_funding` Python method: paginated historical funding per market, no auth. Public Indexer. |
| 6 | dYdX v4 trading volume BTC ETH funding rate arbitrage vs Binance Bybit 2025 | https://bitcointalk.org/index.php?topic=5584224.0 | 2026-07-08 | en | May-2026 30D data: dYdX BTC −0.0022%/8h avg vs Binance +0.0080%/8h; inter-exchange divergence ~11.3% annualized if hedged. dYdX structurally negative, shorts earning. |
| 7 | dYdX v4 market depth liquidity BTC ETH orderbook spread 2025 | https://www.holysheep.ai/articles/en-dydx-v4-quzhongxinhuajiaoyisuodingdanbushendufenxi-2026-04-11-0006.html | 2026-07-08 | en | dYdX v4 uses StarkEx-derived order-book on Cosmos SDK; order types: Market, Limit, Fill-or-Kill, Post-Only. Bid/ask spread, depth at 25 levels, HHI concentration analysis. ~$30M daily volume BTC-USD. |
| 8 | dYdX Treasury SubDAO October 2025 funding rates deleveraging event report | https://dydx.forum/t/dydx-treasury-subdao-community-update-october-2025/4811 | 2026-07-08 | en | Oct 10–11, 2025 deleveraging: BTC off-chain funding 1–7% (Binance), on-chain (Hyperliquid) −2 to +18%. BTC OI 127k→115k; ETH 2.68M→2.41M. Cascading sell pressure drove funding lower. |
| 9 | dYdX v4 日本語 レビュー パーペチュアル funding rate 解説 | https://note.com/muzineco/n/n2e27c4b8c5fd | 2026-07-08 | ja | (ja) Detailed Japanese technical breakdown of FR calculation across venues. dYdX formula matches official docs: PI = (max(0, impact bid − index) − max(0, index − impact ask)) / index; FR = PI + 0.00125%. BTC-USD IMF=0.05 (20× leverage). |
| 10 | dYdX 日本 仮想通貨 取引所 手数料 レバレッジ 使い方 | https://diamond.jp/crypto/defi/dydx/ | 2026-07-08 | ja | (ja) Japanese trader-media overview. dYdX offers up to 20× leverage (vs Japan's regulated 2× cap). Cross-margin across 60 perpetual pairs. |
| 11 | DeFi 個人投資家 システムトレード dYdX 日本 クオンツ 戦略 | https://defire.jp/theoretical-rate-of-funding-rate/ | 2026-07-08 | ja | (ja) DeFiRE Japanese-language explanation of perp FR theory: theoretical rate ≈ cash short rate − coin lending rate. dYdX and Mango listed as DEX perp venues. FR paid 8h on most venues, 1h on dYdX (2023-11 snapshot). |
| 12 | dYdX 分散型取引所 手数料 使い方 解説 | https://crypto-times.jp/dydx-register/ | 2026-07-08 | ja | (ja) Crypto-times.jp tutorial on dYdX registration, leverage (10–20×), and fees. Maker 0.020%–0.000%; Taker 0.050%–0.020%; DYDX-holding discount up to 50%. |
| 13 | dYdX v4 手数料 比較 日本語 レビュー | https://myforex.com/ja/news/myf22110301.html | 2026-07-08 | ja | (ja) myforex.com Japanese overview of dYdX fee schedule by tier (Free → VIP). 30-day <$100k → 0% maker/taker; $100k–$1M → Maker 0.02% / Taker 0.05%. |
| 14 | dYdX v4 isolated markets cross margin v5 launch | https://docs.dydx.exchange/api_integration-trading/isolated_markets | 2026-07-08 | en | `PERPETUAL_MARKET_TYPE_ISOLATED` (post v5.0.0, Nov 2024) vs `PERPETUAL_MARKET_TYPE_CROSS` (pre v5.0.0). Isolated markets cannot cross-margin with other positions on the same subaccount. |
| 15 | dYdX v4 indexer node REST API documentation historicalFunding | https://jentic.com/apis/dydx.exchange/dydx | 2026-07-08 | en | OpenAPI spec for dYdX v4 Indexer (49 endpoints, fully read-only, unauthenticated). Endpoints: /perpetualMarkets, /orderbooks/perpetualMarket/{ticker}, /candles/perpetualMarkets/{ticker}, /historical-pnl, /fundingPayments. |
| 16 | dYdX Annual Ecosystem Report 2025 buyback 75% governance | https://www.gate.com/news/detail/15883369 | 2026-07-08 | en | Proposal #313 (Nov 13, 2025): 75% of net protocol revenue redirected to DYDX buybacks. 59.38% approval, >89M DYDX in favor. Effective allocation: 75% buybacks, 5% Treasury SubDAO, 5% MegaVault, 20% staking. |
| 17 | dYdX Chain Oct 2025 incident downtime blog | https://www.dydx.xyz/blog/october-2025-dydx-chain-incident-review-community-update | 2026-07-08 | en | dYdX Chain experienced ~7h downtime (5:35 PM ET Oct 10 → 1:41 AM ET Oct 11) following unprecedented volatility. Patch deployed, chain recovered, funds remained secure. |
| 18 | dYdX Treasury SubDAO Year 2025 buyback program | https://www.dydx.xyz/annual-report/annual-report-2025 | 2026-07-08 | en | 2025 full-year report: $1.55T cumulative volume, $34.3B Q4 trading volume (highest quarter). Q2 was $16B. Buyback program began April 23, 2025 with 12.5%, expanded to 25% (Proposal #231), then 75% (Proposal #313). |
| 19 | dYdX 2025 annual report cumulative volume buyback CN coverage | https://www.odaily.news/zh-CN/newsflash/464800 | 2026-07-08 | zh | (zh) Odaily coverage of dYdX 2025 annual report: $1.55T cumulative volume; 75% net-income buyback program; Q4 trading volume 34.3B. 98,000 DYDX holders by year-end. |
| 20 | dYdX funding rate arbitrage cross-venue analytics | https://www.sharpe.ai/funding-rates/dydx-chain | 2026-07-08 | en | Sharpe Terminal: DYDX funding aggregated across 11 venues, normalized to APR. As of 2026-04-30: Binance 0.0022% (8h), top venues by APR Bitget/Gate/HL all 0.11%, bottom KuCoin −0.12%. Annualization formula: rate × 8760 / interval_hours. |
| 21 | dYdX v4 funding rate cross-exchange Binance Bybit comparison | https://milkroad.com/funding/eth/ | 2026-07-08 | en | dYdX funding formula: Premium/8 + Interest. 20× leverage on BTC/ETH. Fee discount up to 50% via Hedgies NFTs. Funding paid hourly in USDC. Free trading below $100k 30-day volume. |
| 22 | dYdX validator set max validators chain governance | https://www.dydx.foundation/blog/understanding-rewards-and-fees-on-the-dydx-chain | 2026-07-08 | en | MaxValidators=50; CommunityTax=0% at launch; validator commission 5–100%, average 6.08% per Mintscan. Trading rewards C=0.33 → 0.66 → 0.90 over time. |
| 23 | dYdX DYDX Coin Metrics deep dive funding rates 2026 | https://www.lianpr.com/en/news/detail/254992 | 2026-07-08 | en | Coin Metrics dYdX v4 deep-dive (April 2026): avg daily volume ~$200M, peak $500M on Apr 6, OI rising to $175M. BTC funding "basically neutral"; SOL spike-negative Apr 13–14; ETH funding up sharply Apr 23. Top markets BTC/ETH/SOL. |
| 24 | dYdX 分散型取引所 レビュー 日本語 手数料 | https://toushi-blog.net/cryptocurrency/how-to-use-dydx/ | 2026-07-08 | ja | (ja) Japanese personal-finance blog on dYdX: leverage 2–25× (depending on asset); Maker max 0.02%, Taker max 0.05% — competitive vs CEX. |
| 25 | dYdX v4 dYdX Chain Perpetual DEX 日本語 レビュー 手数料 | https://dexcexhub.com/jp/blog/dYdX | 2026-07-08 | ja | (ja) 2026 dYdX Perp DEX review (Japanese). Maker 0.010% / Taker 0.025–0.050%; Surge Season 9 (50% fee rebate); BTC & SOL zero-fee promotion; Cosmos SDK + CometBFT consensus; API support for systematic/automated trading. |

---

## Independent-source verification map

| Claim | Sources |
|--|--|
| Funding formula Premium/8 + Interest | #1 (dYdX docs), #21 (milkroad), #9 (ja note) |
| 1-hour settlement cadence | #1 (dYdX docs), #20 (Sharpe), #9 (ja note) |
| Default-funding DRC (March 2025) | #2 (dydx.forum), #19 (Odaily zh) |
| October 10, 2025 chain incident | #17 (dydx blog), #8 (Treasury SubDAO update), #18 (annual report) |
| 75% buyback governance (#313) | #16 (Gate), #18 (annual report), #19 (Odaily zh) |
| Staking fee discount structure | #4 (dYdX docs), #22 (dydx.foundation), #13 (ja myforex) |
| Indexer endpoint | #5 (dYdX docs), #15 (Jentic OpenAPI), #25 (ja review) |
| Validator / slashing parameters | #3 (dydx.forum), #22 (dydx.foundation) |
| 30D funding-rate divergence table | #6 (bitcointalk), #20 (Sharpe), #8 (Treasury SubDAO Oct 2025) |
| BTC/ETH/SOL 2026 stats | #23 (Coin Metrics via lianpr), #6 (bitcointalk), #8 (SubDAO Oct 2025) |