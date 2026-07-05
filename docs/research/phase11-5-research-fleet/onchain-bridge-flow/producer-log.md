# Producer Log — Track D (onchain-bridge-flow)

## Run Metadata
- **Producer:** onchain-bridge-flow
- **Branch:** `phase11-5-research-fleet`
- **Started:** 2026-07-05
- **Research-fleet target:** Phase 11.5 — Track D
- **Working directory:** `/Users/kiscsicska/projects/mm-crypto-bot`
- **CWD ephemerality note:** The env-stated working directory `/Users/kiscsicska/projects/mm-crypto-bot/.worktrees/wt-9d6d823b` did not exist on the filesystem; the actual repo root is `/Users/kiscsicska/projects/mm-crypto-bot` and the task was executed against it.

## Workflow
1. Verified the workspace layout (`docs/research/`, branch state — main, branch-out into `phase11-5-research-fleet`).
2. Created target directory `docs/research/phase11-5-research-fleet/onchain-bridge-flow/`.
3. Issued **20 web_search queries** in parallel batches (≥15 mandated). All in English — searched Russian-language crypto material as well via `Russian crypto Telegram channel whale analysis on-chain signal Bitkogan TradingFlow` (most results were Telegram channel catalogs; Russian-language trading Telegram alpha dissemination is fragmented and low-signal compared to Chinese KOL equivalents covered via @lookonchain, Wu Blockchain, 吴说, 币界网, etc.).
4. Cross-referenced Chinese-language on-chain coverage (Odaily, 币界网, 币百科, 帮企客, 528btc, 173you, 新浪财经, 知乎) for the Asian-community angle.
5. Pulled Russian-language discussion via the Bitsgap/YieldFund copy-trade paper (https://bitsgap.com/blog/why-copying-on-chain-whale-trades-usually-backfires) and CryptoRank Russian-language feed.
6. Wrote REPORT.md with §1–§6, citing ≥2 independent sources per empirical claim where possible.
7. Companion `data-feeds.md` listing data sources by tier.
8. Companion `producer-log.md` (this file).

## Coverage Notes
- **≥2 sources per empirical claim:** Achieved for all major claims:
  - Justin Sun TRX price impact (Cointelegraph + 528btc + 帮企客)
  - CZ Binance 127K BTC transfer (Cointelegraph + Reddit thread + Cryptonomist)
  - FTX collapse $6B withdrawal (Reuters + Investopedia + 网易 + 知乎)
  - 3AC asset transfer to Kelly Chen wallet (Forkast + Binance Square + Crowdfund Insider)
  - HYPE airdrop mechanics (Eco.com + airdrops.io + Tencent News + php.cn)
  - USDT/BTC correlation (BIS WP 1270 + Yellow.com + SNB + Fed FEDS + Odaily + arXiv 2501.05232)
  - ETF flows BTC impact (KuCoin + TradingNews + Investing.com + Tencent News)

- **Asian forums first-class:**
  - @lookonchain + Spot On Chain = Chinese-curated alpha coverage (Lookonchain 美区 App Store, https://apps.apple.com/us/app/lookonchain/id6738108412; SpotOnChain https://spotonchain.ai/)
  - 币界网 (https://www.528btc.com/), 币百科 (https://m.btcbaike.com/), 区块链网 (https://www.qklw.com/), 知乎 (https://zhuanlan.zhihu.com/), Odaily (https://www.odaily.news/)
  - 帮企客 (https://www.bangqike.com/) for Sun-linked wallet stories
  - 吴说 (Wu Blockchain) reproduced in Tencent News for crypto-native Chinese reporting
  - Footprint/Wublock coverage merged into DefiLlama/Lookonchain — no granular Chinese-language feed scraper needed.

- **Russian / Indian community overlap:**
  - Russian: CryptoRank.io Russian feed has translated coverage; community most active on Telegram channels catalogued but with low reliability (https://tgstat.com/channel/@the_crypto_whales, https://t.me/whalepumpsignaI). The "70 best crypto signal groups" Reddit/Russian guides exist (https://remitano.com/ru/forum/5562-70-best-crypto-signal-groups-on-telegram) but signal integrity unverified.
  - Indian: WazirX hack (Jul 2024) is a documented Indian-crypto on-chain case; Lookchain/Cyvers flagged the breach in real-time before WazirX even responded (https://techcrunch.com/2024/07/18/...); Elliptic pegged $235M loss (https://www.elliptic.co/blog/235-million-lost-by-wazirx-in-north-korea-linked-breach). This is illustrative — the attack signature is detectable on-chain but does not constitute tradable alpha.

## Search Queries Executed (20)

1. `on-chain whale wallet tracking alpha crypto case studies vitalik ethereum movements`
2. `Justin Sun wallet movements crypto market price impact 2024 TRX transfer`
3. `Binance cold wallet outflow inflow signal BTC price bull bear`
4. `FTX collapse Binance withdrawal massive BTC transfer November 2022 dump`
5. `Arbitrum Optimism Base bridge flow signal mainnet ETH movement on-chain analytics`
6. `stablecoin USDT USDC supply change mint burn BTC price correlation historical`
7. `MicroStrategy Bitcoin accumulation on-chain wallet inflows 2024 2025 price impact`
8. `Coinglass exchange balance BTC ETH reserve 24 month chart 2023 2024 2025`
9. `BlackRock IBIT ETF inflow outflow Bitcoin price signal impact`
10. `Three Arrows Capital 3AC on-chain unwind liquidation 2022 BTC transfers Su Zhu`
11. `friend.tech early wallet holder alpha pre-launch on-chain tracking profit`
12. `Nansen Arkham alternative on-chain analytics free dashboard smart money tracker 2024`
13. `Lookonchain SpotOnChain whale tracking Chinese Telegram alpha free tools`
14. `Hyperliquid airdrop early wallet pre-claim alpha on-chain pre-launch tracking profitable`
15. `ether.fi ezETH early withdrawal wallet pre-launch whale Restake TVL signal`
16. `CEX netflow BTC ETH signal correlation price predictive study Glassnode CryptoQuant research paper`
17. `CZ Binance wallet transfer BTC sale 2019 proof of reserve transfer signal`
18. `Russian crypto Telegram channel whale analysis on-chain signal Bitkogan TradingFlow`
19. `WazirX Bitcoin India exchange reserve on-chain proof scandal 2024 withdrawal`
20. `smart money copy trading wallet leaderboard Lookonchain profitable track record profitability`

## Open Items for Follow-up
- The Russian Telegram angle is the weakest seam; if Track E or another track wants to specialize in Russian-language Telegram mining, treat that as a separate producer.
- No Solidity/Vyper contract-level pre-empt evidence beyond what Hyperliquid/ether.fi narratives show — to harden P5 plugin decision, would want a systematic study of friend.tech / ether.fi / Hyperliquid wallet-cohort distributions before/after TGE with Nansen or Arkham backtest.
- Plugin backtests for P1/P2/P4 not run — that's Phase 12 work, not Phase 11.5 research fleet.

## Output Files
- `REPORT.md` (this directory)
- `producer-log.md` (this file)
- `data-feeds.md` (this directory)
