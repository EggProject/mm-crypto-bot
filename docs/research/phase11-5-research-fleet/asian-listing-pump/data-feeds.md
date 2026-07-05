# Data feeds — Asian Listing-Pump / Airdrop-Farming Microstructure

Raw link vault for the research fleet. Includes KOL accounts, dashboards, Telegram channels, official exchange announcement feeds, and tracker apps. All in Korean / Japanese / Chinese / English — no Hungarian.

## Real-time Korean exchange announcement feeds

| Source | URL | What you get | Latency |
|---|---|---|---|
| Upbit 공지사항 (official) | https://www.upbit.com/service_center/notice | Authoritative listing/delisting; Korean only | minutes |
| Upbit DataLab | https://datalab.upbit.com/ | KRW premium, sector heatmap, 24h vol | 30s |
| Upbit Datalab Insight | https://datalab.upbit.com/insight | TA-grade signal pages | 1m |
| UpbitPro live dashboard | https://upbitpro.kr/ | Real-time KRW pairs depth | RT |
| Bithumb official | https://www.bithumb.com/ | Listings + KRW pairs | minutes |
| Coinone | https://coinone.co.kr/ | KRW-only CEX; had the MOVE 98,468% case | minutes |
| Coindataflow Upbit volume tracker | https://coindataflow.com/ja/取引所/upbit | % volume by pair | 1m |
| CoinGecko Upbit | https://www.coingecko.com/ko/거래소/upbit | +2%/-2% depth, spread | 30s |
| CoinGecko Bithumb | https://www.coingecko.com/en/exchanges/bithumb | Same | 30s |

## Korean pre-listing KOL accounts (X)

| Handle | Notes |
|---|---|
| **@ai_9684xtpa** ("Ai Yi" / Ai 姨) | The canonical Upbit/Bithumb listing-leak source. First to publish on-chain token movements ahead of listing announcements (SKY, KAITO pre-sell, PUMP Sep 2025). Quotes: "the first announcement moves price, the second confirms it" (https://www.binance.com/en-IN/square/post/293745442617042). |
| @starzqeth (starzq) | Chinese-language KOL who surfaced $virtual/$ai16z early; useful for Asian retail sentiment gauge |
| Korean exchange watcher aggregator | https://x.com/hashtag/Upbit |

## Japanese venues

| Source | URL | Note |
|---|---|---|
| bitFlyer announcements | https://bitflyer.com/ja-jp/s/press | Largest by Japan BTC volume 2018 (~80%) |
| bitFlyer Lightning (futures) | https://lightning.bitflyer.com/ | Has circuit breaker rules (サーキットブレーカー制度) |
| bitFlyer MONA/JPY chart | https://bitflyer.com/ja-jp/monacoin-chart | MONA = historic Japan listing pump token (50→620 JPY on bitFlyer listing 2017) |
| bitFlyer LSK/JPY chart | https://bitflyer.com/ja-jp/lisk-chart | LSK 2400→3600 JPY 2018-01-31 listing |
| Coincheck | https://coincheck.com/ja/exchange/charts | Major alt exchange; XYM, XEM, SUI/JPY all available |
| FSA Japan licensed exchanges | https://www.fsa.go.jp/en/regulated/licensed/en_kasoutuka.pdf | Authoritative list of approved Japanese venues |
| OKX Japan (OKJ/okcoin.jp) | https://www.okcoin.jp/ | Discontinued new listings; legacy alt support only |
| Coinchpost Japan | https://coinpost.jp/ | Most-quoted Japanese-language crypto news outlet for listing announcements |
| CoinDesk Japan | https://www.coindesk.com/jp/ | English-major but has Japan desk |

## Kimchi premium / cross-exchange arbitrage trackers

| Tool | URL | Language | Note |
|---|---|---|---|
| **Upbit Premium index** (official) | https://m.upbitcare.com/academy/education/coin/1011 | KO | Definition + thresholds (>5% = overheating) |
| Kimpga (김프가) | https://kimpga.com | KO | Real-time Kimp % |
| Cryprice (크라이프라이스) | http://scolkg.com/ | KO | Kimpga alternative |
| Coinsect (코인충) | https://coinsect.io | KO | Cross-exchange |
| Theddari (더따리) | https://theddari.com | KO | |
| Miningcalc Upbit vs Binance | https://miningcalc.kr | KO | Live spread |
| App: 비트 프리미엄 (iOS) | https://apps.apple.com/kr/app/비트-프리미엄-김치-프리미엄/id1560557313 | KO | Mobile alerts |
| App: 김치 프리미엄 Android | https://play.google.com/store/apps/details?id=kr.co.koreapremium | KO | Mobile alerts |
| CryptoQuant Kimchi Premium Index | (referenced via https://www.yna.co.kr/view/AKR20241111141700002) | EN | Standard institutional metric |

## Airdrop trackers / dashboards (Asian- and global-leaning)

| Source | URL | Airdrop covered |
|---|---|---|
| Airdrops.io Hyperliquid | https://airdrops.io/hyperliquid/ | HYPE S2 |
| Airdrops.io Jupiter | https://airdrops.io/jupiter/ | JUP |
| Airdrops.io Jito | https://airdrops.io/jito/ | JTO |
| ether.fi governance (Season 3) | https://etherfi.gitbook.io/gov/seasons/airdrop-season-3 | ETHFI |
| Jito official | https://www.jito.network/blog/jto-airdrop-eligibility-and-allocation-specifications/ | JTO rules |
| Jupuary checker | https://jup.ag/portfolio/airdrop-checker | JUP live check |
| ASXN HYPE dashboard | (referenced via https://www.jb51.net/blockchain/963355.html) | HYPE distribution |
| CoinGecko Trust Score leaderboards | https://www.coingecko.com/ko/거래소/upbit | Used to rank venues for Sybil farming transfers |
| CryptoRank drophunting | https://cryptorank.io/drophunting/hyperliquid-activity81 | HYPE + others |
| airdropalert.com Hyperliquid | https://airdropalert.com/blogs/full-hyperliquid-airdrop-strategy-exposed/ | Deep HYPE strategy doc |

## Airdrop-specific KOL / X accounts

| Handle / outlet | Why it matters |
|---|---|
| @aylo (HyperEVM alpha hunter) | Source for Hyperliquid airdrop tier list (translated on Odaily) |
| @meow (Jupiter founder) | Posts tier thresholds, drops claim windows on X |
| @ai_9684xtpa | Cross-coverage: covers both Upbit listing pre-buys AND EIGEN drop movements |
| Ai 姨 / PANews Chinese coverage | https://www.panewslab.com/ — Panewslab runs drop-by-drop breakdowns |

## Listing announcement alert infrastructure (commercial)

| Service | URL | What it does |
|---|---|---|
| Cryptolisting.ws (Upbit alert) | https://cryptolisting.ws/id/upbit-listing-alert/ | WebSocket API: Upbit + Bithumb + Binance listings, Tokyo & Seoul endpoints. Korean-source directly. Doc quote: "30-100% dalam hitungan menit" (30-100% in minutes) |
| CoinMarketCal | https://coinmarketcal.com/ | Calendar of confirmed listings |
| CryptoAlerting app (mobile) | https://www.youtube.com/watch?v=5pgOWdWHmiM | SMS/Telegram push per exchange listing |

## Korean discussion forums (Naver / Daum)

- Naver real-time search "업비트 상장" — primary social chatter channel (Naver is to Korea what Yahoo is to US). Real-time discussion threads within ~30s of listing announcement.
- Daum cafes: e.g., "비트코인 갤러리" on Daum — second-tier discussion.
- Naver Stock crypto boards — finance crossover.

## WeChat / Telegram channels

| Channel | Locale | Risk |
|---|---|---|
| 吴说 (Wu Shuo) | zh-CN | https://www.wublock123.com/ — dominant Chinese-language listing+whale news |
| PANews (PA News) | zh-CN | https://www.panewslab.com/ |
| Odaily 星球日报 | zh-CN | https://www.odaily.news/ |
| Foresight News | zh-CN | |
| 深潮 TechFlow | zh-CN | Translates Hyperliquid / Jupiter primary docs |
| 吴说 (mobile) Telegram | zh-CN | Lead time on Asian exchange listings |
| TraderKorea Telegram | KO | Off-exchange retail signal |
| 코인갤러리 (Coin Gallery) Telegram | KO | Naver bridge |

## Japanese social

- 5ch (5channel, formerly 2ch.net) crypto boards — pre-Twitter echo chamber for Japanese retail; MONA launched there.
- coinpost.jp comments — per-article discussion; moves around listing announcements.
- Twitter JP: @whitelist_tk, @Jin10JP, @CoinPost_JP, @coin_desk_jp.

## On-chain data sources (relevant to airdrop-farming & listing pump)

| Source | Use |
|---|---|
| ARKM Intel | Pre-trade wallet mapping (cited in ai_9684xtpa's KAITO expose) |
| Nansen | Sybil cluster detection (cited in airdrop guides) |
| Dune (community dashboards) | Per-airdrop eligibility reverse-engineering |
| HypurrCollective | Nansen-aligned Hyperliquid validator |
| Coinglass | Liquidation / open interest (Hyperliquid XPL squeeze detection) |

## Quote / specific case study URLs

| Case | URL |
|---|---|
| MOVE (Movement) 98,468% kimchi premium on Coinone | https://www.mk.co.kr/en/stock/11190568 |
| MOVE $1.013 OKX vs $1.36B Upbit vol | https://new.qq.com/rain/a/20241210A0833D00 |
| CRV 600% Bithumb premium | https://czxurui.com/kx/36667.html |
| TAO (Bittensor) Upbit +8.5% then crash | https://blockeden.xyz/forum/t/bittensor-tao-hits-on-upbit-listing-then-crashes-back-korean-premium-play-exposed/956 |
| PRL (Pearl) +5,500% volume | https://cryptorank.io/news/feed/a593f-upbit-bithumb-new-listings-krw-trading |
| SKR +62% / ESP +50% | https://jp.beincrypto.com/upbit-bithumb-skr-esp-token-listings-surge/ |
| CFG (Centrifuge) +180% | https://www.kucoin.com/news/articles/centrifuge-price-action-understanding-the-impact-of-the-upbit-cfg-listing |
| ICP +16-20% / +443% vol | https://www.ainvest.com/news/icp-upbit-listing-korean-retail-pump-2603/ |
| BIGTIME +30.7% / AKT +40% | https://view.inews.qq.com/k/20240423A04Q3O00 |
| API3 +70% | https://news.qq.com/rain/a/20250819A0598G00 |
| HYPER +130% (Hyperlane) | https://www.binance.com/bg/square/post/26745323496330 |
| ZETA +30% / OMNI +14.8% | https://czxurui.com/kx/126607.html |
| Raydium +34.3% / HUMA +12% / FORT +52% | https://phemex.com/ja/news/article/upbit-and-bithumb-listings-trigger-token-price-surges-10626 |
| KAITO team pre-sell ($4.1M) | https://blockchain.news/flashnews/upbit-lists-kaito-amid-suspicious-token-sale-by-kaito-team |
| SKY +16% Upbit listing | https://blockchain.news/flashnews/sky-token-launches-on-upbit-krw-pair-with-binance-activity-highlights |
| Lisk 2018-01-31 +65% bitFlyer | https://cloud.tencent.com/developer/news/79557 |
| Monacoin 50→620 JPY 2017 | https://coinpost.jp/?p=17394 |
| bitFlyer volume +200% 2026-03 | https://finance.sina.com.cn/blockchain/roll/2026-03-09/doc-inhqksxk9842219.shtml |
| Hyperliquid XPL whale +200% in 2 min | https://finance.sina.com.cn/blockchain/roll/2025-08-27/doc-infnkprp6069834.shtml |
| HYPE distribution percentiles | https://www.jb51.net/blockchain/963355.html |
| Upbit premium definition | https://m.upbitcare.com/academy/education/coin/1011 |
| Kimchi premium -1.97% (Nov 2024) | https://www.yna.co.kr/view/AKR20241111141700002 |
| 7 listings in 11 days effect dilution | https://blockchain.news/flashnews/upbit-listing-effect-weakens-7-tokens-in-11-days-pump-holo-open-wld-flock-red-wlfi-see-announcement-pumps-fade |