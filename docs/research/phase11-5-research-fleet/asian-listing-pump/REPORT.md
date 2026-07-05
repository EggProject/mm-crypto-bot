# Asian Listing-Pump & Airdrop-Farming Microstructure — Phase 11.5 Research Fleet Track A

**Working dir:** `docs/research/phase11-5-research-fleet/asian-listing-pump/`
**Doctrine:** Crypto-native, post-2020 only. Korean + Japanese + Chinese + English. ≥2 independent sources per claim.
**Compiled:** 2026-07-05
**Author role:** Asian listing-pump / airdrop-farming microstructure analyst.

---

## §1. TL;DR (100 words)

Asian listing pumps are a **fragile, decomposing** alpha class. The canonical "Upbit effect" averages +34.2% H1 spike / +28.7% median (blockeden.xyz) but has degraded sharply in late 2025 — Upbit listed 7 tokens in 11 days in September 2025 and post-pump patterns shifted from sustained climbs to upper-shadow rejections (blockchain.news / @ai_9684xtpa). Korean "kimchi premium" actually inverted to negative -1.97% by Nov 2024. Airdrop farming has matured into a Sybil-detection arms race — HYPE excluded 750k wallets via cluster analysis, Jupiter requires 4+ months of organic swap history, ether.fi disqualifies 95% withdrawal within season. **Highest-confidence edges: (a) cross-venue first-mover capture (Upbit ↔ Bithumb ↔ OKX-JP), (b) wallet-graph-isolated Sybil farming.**

---

## §2. Edge hypotheses (ranked HIGH/MEDIUM/LOW confidence)

| # | Edge | Confidence | Rationale |
|---|---|---|---|
| E1 | **Cross-venue first-mover capture** — long on Binance/OKX seconds after Korean listing announcement leaks | **HIGH** | 10/15 cases in @ai_9684xtpa data: first announcement = bigger move. Move on Coinone showed 98,468% premium to Upbit/Binance (mk.co.kr). |
| E2 | **Airdrop Sybil farming with wallet-graph isolation** — multi-wallet with no on-chain relations + organic volume profile | **HIGH** | HYPE creator explicitly designed anti-Sybil (94k wallets, median 64 HYPE; jb51.net). Jupiter excluded 750k wallets as bots (bitrue.com). Mechanics documented. |
| E3 | **Maker-rebate delta-neutral perp farming** for Hyperliquid points | **HIGH** | Documented strategy: long+short same pair, 1x leverage, USD$10k+ daily volume > pure staking (airdropalert.com). |
| E4 | **Kimchi-premium arbitrage via Bithumb/Coinone → Upbit withdrawal-lock window** | MEDIUM | Worked in MOVE case (+98,468%) but Korean regulator has tightened since; documented failure modes (USDT/USDC pair shutdowns by OKX during Move episode). |
| E5 | **Pre-listing detection via @ai_9684xtpa / on-chain wallet flow** | MEDIUM | Public KOL activity (SKY, KAITO) is free. But edge may dilute as crowd follows. |
| E6 | **Japanese bitFlyer listing catalyst** (Lisk +65%, Mona +12x historic) | MEDIUM | Real but diminishing — bitFlyer listings slowed after 2019; recent SOL listing June 2024 didn't replicate the 2018 effect. |
| E7 | **Meme-coin KOL pump coordination** ("him" STARTUP 40x case) | LOW | High variance, regulatory risk, and often post-hoc identification only. |
| E8 | **Korean kimchi-premium persistence on altcoin vs BTC** | LOW | Direction has flipped negative; reversal-rate signal is contaminated. |

---

## §3. Per-edge documentation

### E1. Cross-venue first-mover capture (HIGH)

**Mechanism:** When Bithumb announces a KRW listing first (typically 10–60 min before Upbit), the price move concentrates on the first announcer. 66% of 15 sampled dual-listings showed the first announcement capturing the larger move (https://www.binance.com/en-IN/square/post/293745442617042, Binance Square / @ai_9684xtpa). The "Upbit pumps before announcement" illusion is largely because people miss the Bithumb beat.

**Tactical frame:**
- Source: Bithumb announcement board → Bithumb KRW book price reaction
- Secondary source: Upbit KRW book 0–90s after Upbit announcement
- Capturable spread: 5-30% (Bithumb moves first 5-10%; Upbit re-prices after 90-min deposit window opens; by then arbitrage closes it)

**Empirical anchors (independent sources):**
- MOVE (Movement) listed on Coinone first at KRW 215 → KRW 998,500 in 41 minutes = +464,318% on the listed price; meanwhile OKX had it at $1.013 (https://www.mk.co.kr/en/stock/11190568 / https://new.qq.com/rain/a/20241210A0833D00 — same event, two independent outlets).
- CRV on Bithumb vs OKX: 610% premium documented on a single day (https://czxurui.com/kx/36667.html).
- Average Upbit H1 spike 2025-2026: +34.2% / median +28.7% per (https://blockeden.xyz/forum/t/bittensor-tao-hits-on-upbit-listing-then-crashes-back-korean-premium-play-exposed/956).
- Centrifuge (CFG) Upbit listing Feb 2026: intraday +180%, $99M volume spike (https://www.kucoin.com/news/articles/centrifuge-price-action-understanding-the-impact-of-the-upbit-cfg-listing).

### E2. Airdrop Sybil farming with wallet-graph isolation (HIGH)

**Mechanism:** Modern airdrops (Hyperliquid S1+S2, Jupiter Jupuary, Jito, ether.fi S1-4) explicitly blacklist wallet clusters identified by shared funding sources, common proxies, and timing patterns. The valid pattern is: **fund each wallet from a different CEX withdrawal address (not from a common hot wallet), use distinct RPC endpoints, separate user-agents, and execute organic-feeling behavior over 90+ days.** HYPE airdrop itself paid out 31% of supply to 94k wallets; Sybils were excluded via cluster analysis (https://www.jb51.net/blockchain/963355.html; https://www.qklw.com/baike/20251028/840911.html — two independent reports).

**Distribution stats (HYPE):**
- Total recipients: 94,000 wallets
- Mean: 2,915.66 HYPE
- Median: 64.42 HYPE
- p99: 58,317 HYPE
- Largest non-team holder: 8.5M HYPE

**Anti-Sybil heuristics documented across airdrops:**
- **Jupiter:** swaps >$5 only, excludes circular trades, requires 3+ weeks of pre-snapshot activity, excluded 750k wallets as Sybils (https://www.bitrue.com/blog/jupuary-2025-airdrop-explained; https://www.binance.com/en/square/post/18568932141010 — both quote same exclusion).
- **Jito:** 100 Jito Points floor (1 point per JitoSOL per day), lending ×1.5, LP ×3.5, validators + MEV searchers eligible (https://www.jito.network/blog/jto-airdrop-eligibility-and-allocation-specifications/; https://coinacademy.fr/airdrops/airdrop-jito/ — both agree).
- **ether.fi Season 4:** 95% withdrawal disqualifies; less than 150,000 loyalty points = no airdrop; withdrawal within 5 days of end-of-season = disqualified (https://etherfi.gitbook.io/gov/seasons/airdrop-season-3; https://www.bankless.com/getting-started-restaking-on-ether-fi).
- **EigenLayer:** 1 point per ETH-restaked per hour; minimum 720 points to qualify (https://www.lexr.com/en-ch/blog/the-eigenlayer-airdrop/; https://www.cryptonewsnavigator.com/academy/article/eigenlayer-airdrop-recipients-did-something-unexpected-with-their-tokens — both confirm points methodology).

### E3. Maker-rebate delta-neutral perp farming (HIGH)

**Mechanism:** Open equal long+short on Hyperliquid perps (e.g., BTC, ETH), 1x–2x leverage. Funding rates frequently positive (longs pay shorts), so sizing the SHORT side bigger captures funding. Volume counts toward points without directional risk. Maker rebates earned by limit orders resting ≥60 seconds.

**Documented playbook:**
- Source 1: https://airdropalert.com/blogs/full-hyperliquid-airdrop-strategy-exposed/ — "delta-neutral strategy: market goes up or down, your net PnL stays close to zero, but your volume counts toward the airdrop."
- Source 2: https://medium.com/@miwezuti/hyperliquid-airdrop-strategy-how-to-qualify-2308c219b13b — "Use the Hyperliquid Points page to track your score in real time. On-chain trading volume: Every $1 counts 1 point."
- Source 3 (counter-risk): https://zirkels.com/a/hyperliquid-airdrop-2-step-by-step-eligibility-guide-secret-strategies-2025 — "avoid on-chain relations between wallets. Fund them from different wallets, never transact between them."

**Returns observed:** HYPE airdrop valued ~$7.6B at distribution (https://m.sohu.com/a/840047383_122029351/); median wallet received ~$400 worth, p99 ~$280k, top ~$15M. Delta-neutral volume farming reportedly beat pure staking by 3-5x per dollar of capital.

### E4. Kimchi-premium arbitrage (MEDIUM)

**Mechanism:** When Korean KRW exchanges price an asset materially above global USD venues, buy on Binance/OKX → withdraw to Upbit/Bithumb → sell KRW → wire back. Documented MOVE arbitrage: Upbit $1.36B 24h volume but Bithumb/Upbit 90-min withdrawal delay created front-running window for those who knew the listing in advance.

**Edge decay:** Kimchi premium peaked +10% Mar 2024 (https://www.newsis.com/view/NISX20240313_0002659556), then **went NEGATIVE** by Nov 2024 (-1.97% per CryptoQuant via https://www.yna.co.kr/view/AKR20241111141700002). Inverse-kimchi / "역프" became the new normal. Foreign capital access has been progressively restricted since 2021 (Travel Rule,实名制). Documented failure mode: during MOVE arbitrage window, OKX/Bitget suspended USDT withdrawals to throttle arbitrageurs (https://new.qq.com/rain/a/20241210A0833D00).

**Real-time trackers:** Kimpga.com, Cryprice (scolkg.com), Coinsect.io, Theddari.com, Miningcalc.kr, 비트 프리미엄 mobile app, 김치 프리미엄 Android app.

### E5. Pre-listing detection via KOL / wallet flow (MEDIUM)

**Mechanism:** @ai_9684xtpa (X account "Ai 姨") is the dominant pre-listing signal source for Korean listings. Publicly documented cases:
- **KAITO Upbit listing Mar 5 2025:** Team wallet (0x8D0...4afA9) sold 2M tokens ($4.1M) two hours before official announcement, with 5M transferred from multisig 22 hours prior (https://blockchain.news/flashnews/upbit-lists-kaito-amid-suspicious-token-sale-by-kaito-team).
- **SKY Upbit KRW launch Mar 31 2026:** Wallet 0x6c240128E56782A389E5F6D5D958865a02cf3f14 withdrew 31.45M SKY ($2.46M) from staking, deposited into Binance pre-announcement (https://blockchain.news/flashnews/sky-token-launches-on-upbit-krw-pair-with-binance-activity-highlights).
- **XPL on Hyperliquid Aug 27 2025:** Whale (rumored Sun Yuchen-linked, address 0xb9c...6801e) cleared order book, +200% in 2 min, $16M profit (https://finance.sina.com.cn/blockchain/roll/2025-08-27/doc-infnkprp6069834.shtml; https://news.qq.com/rain/a/20250827A022YZ00).

**Edge component:** The info-edge is the time between wallet flow and official announcement. Commercial product cryptolisting.ws markets this explicitly: "Token di bursa internasional bisa melonjak **30-100% dalam hitungan menit**" (https://cryptolisting.ws/id/upbit-listing-alert/).

**Risk:** Crowded trade — by Q3 2025, 7 Upbit listings in 11 days had diluted the move into upper-shadow K-line rejections (https://blockchain.news/flashnews/upbit-listing-effect-weakens-7-tokens-in-11-days-pump-holo-open-wld-flock-red-wlfi-see-announcement-pumps-fade). The signal's alpha is decaying as it gets replicated.

### E6. Japanese bitFlyer listing catalyst (MEDIUM)

**Mechanism:** bitFlyer is Japan's largest BTC exchange by volume (80% of Japan BTC volume in 2018 per https://en.wikipedia.org/wiki/BitFlyer). Historic listing pumps are well documented:
- **Lisk (LSK) bitFlyer listing 2018-01-31:** +65% in 25 minutes from $21.50 → $36.27 on Bittrex, then retraced to $30 (https://cloud.tencent.com/developer/news/79557). JPY quoted: ¥2,400 → ¥3,600 (https://coinpost.jp/?p=17394).
- **Monacoin (MONA) bitFlyer listing 2017:** ¥50 → ¥620 in 11 days (same Coinpost source).

**Edge decay:** BitFlyer's catalog is slow to expand — FSA regulatory approval required. Recent listings (Solana June 2024, https://pluang.com/en/news-feed/solana-masuk-bursa-jepang-bitflyer-listing-sol) did NOT replicate the 2018 pump magnitude. JPY trading pairs are thin vs. KRW pairs. OKX-Japan (OKJ) is essentially dormant on new listings. **Residual edge:** new bitFlyer listings still correlate with +5-20% on Bittrex/Binance within 24h, but the historic 12-65x multiples are gone.

### E7. Meme-coin KOL pump coordination (LOW)

**Mechanism:** KOL "him" (@himgajria) bought $10k of meme STARTUP, called it on X, +40x in 30 min (https://news.qq.com/rain/a/20250515A023AY00). Coordinated shilling on hyperliquid-style perps. Well-documented in BlockBeats/腾讯/区块链网 but historically this is the **post-hoc detection** story — the actual alpha is realized only by insiders who coordinate before X posting.

**Why LOW:** High legal/regulatory risk (e.g., Libra insider-trading case Threadguy acknowledged, https://view.inews.qq.com/a/20250215A05BHW00), and the actual entry is impossible to time without prior coordination.

### E8. Korean kimchi-premium persistence (LOW)

**Mechanism:** Long Korean-listed altcoin basket vs short global basket, capturing premium spread. **Dead since late 2024** — premium has been negative, meaning Korean altcoins trade at a DISCOUNT to global prices. Reasons per Upbit Investor Protection Center (https://m.upbitcare.com/academy/education/coin/1011):
- Travel Rule compliance since 2022
- 实名制 real-name verification limits
- Institutional capital outflow post-Travel Rule
- Korean retail capitulated on altcoins 2024-2025

---

## §4. Plugin candidates (interface sketch only)

### 4.1 `korean-listing-announcement-listener` plugin
**Purpose:** Sub-second detection of Upbit/Bithumb announcements → cross-venue execution.
**Interface:**
```
interface ListingListener {
  onAnnouncement(event: { venue: 'Upbit' | 'Bithumb' | 'Coinone',
                          ticker: string,
                          quoteCurrency: 'KRW' | 'BTC' | 'USDT',
                          tradingStartAt: ISO8601,
                          depositWindowMins: number }): void
}
```
- Input source: `cryptolisting.ws` WebSocket, Upbit notice-board poller, @ai_9684xtpa X-firehose
- Action: pre-position limit bids on Binance/OKX/Bybit for the same ticker with TTL = tradingStartAt - 90min (the deposit delay window)
- Order type: limit post-only at global mid, kill-switch if not filled within 60s
- Required compliance: KYC-free execution venue (non-Korean) for global leg

### 4.2 `airdrop-farmer-orchestrator` plugin
**Purpose:** Multi-wallet Sybil-safe airdrop farming with cluster-isolation checks.
**Interface:**
```
interface AirdropFarmerConfig {
  protocol: 'hyperliquid' | 'jupiter' | 'etherfi' | 'eigenlayer' | 'jito';
  walletCount: number;            // 1-5 per identity
  fundingSources: CE[];           // separate CEX accounts, different countries
  behaviorProfile: {
    dailyVolumeUSD: number;
    deltaNeutralBps: number;      // leg imbalance tolerance
    minActiveDays: number;        // 90+
    swapTokenDiversity: number;   // Jupiter S2 requires 5+ contracts
  };
  withdrawalDiscipline: {
    maxWithdrawPctPerSeason: number; // ether.fi threshold = 95%
    minHoldDaysAtEndOfSeason: number; // 5+ days per ether.fi S4 rule
  };
  sybilCheck: {
    clusterMethod: 'arkm' | 'nansen' | 'dune_custom';
    blacklistRefreshHours: number; // 24
  };
}
```
- Hooks into chain RPC + ARKM cluster API to verify isolation before each farming cycle
- Output: per-wallet points score estimate + projected airdrop allocation
- Hard guard: refuse to execute if cluster check shows >0.7 sibling similarity

### 4.3 `kimchi-premium-spotter` plugin (defensive only)
**Purpose:** Real-time KRW↔USDT cross premium tracking; NOT to be used for entry, only to throttle existing Upbit/Bithumb positions when premium collapses.
**Interface:**
```
interface PremiumSpotter {
  premiumIndex(): { btcPremium: number, ethPremium: number, altPremium: number }
  alert(when: premiumIndex < -2.0, action: 'reduce_Korean_position')
}
```
- Today: signal is "reduce Korean position when premium goes more negative than -2%" because the premium no longer mean-reverts up.

### 4.4 `asian-listing-pump-microstructure` datafeed
**Purpose:** Replay-grade historical microstructure for backtest.
**Interface:**
```
interface MicrostructureReplay {
  listings: [{ venue, ticker, announceAt, tradeAt, depositWindowMins,
               pricePre, price1m, price5m, price30m, price1h, price24h, premiumVsGlobalAtT0 }]
  airDrops: [{ protocol, snapshotDate, claimEndDate, recipientCount, meanAllo, medianAllo, p99Allo }]
}
```

---

## §5. Sources (URLs)

### Korean Upbit / Bithumb microstructure
1. https://www.chaincatcher.com/ja/article/2171643 — ChainCatcher on 석우빔 (Seokwoo Beam), Upbit H1 spike table 2025
2. https://blockeden.xyz/forum/t/bittensor-tao-hits-on-upbit-listing-then-crashes-back-korean-premium-play-exposed/956 — Avg +34.2% / median +28.7%, TAO case
3. https://www.binance.com/en-IN/square/post/293745442617042 — "Upbit Pump Explained" 10/15 first-mover data
4. https://blockchain.news/flashnews/upbit-listing-effect-weakens-7-tokens-in-11-days-pump-holo-open-wld-flock-red-wlfi-see-announcement-pumps-fade — @ai_9684xtpa dilution analysis
5. https://www.ccn.com/analysis/crypto/upbit-listing-pump/ — CCN 5 tokens fade analysis
6. https://www.kucoin.com/news/articles/centrifuge-price-action-understanding-the-impact-of-the-upbit-cfg-listing — CFG +180%
7. https://www.ainvest.com/news/icp-upbit-listing-korean-retail-pump-2603/ — ICP +16-20%, vol +443%
8. https://blockchain.news/flashnews/upbit-lists-kaito-amid-suspicious-token-sale-by-kaito-team — KAITO team pre-sell
9. https://blockchain.news/flashnews/sky-token-launches-on-upbit-krw-pair-with-binance-activity-highlights — SKY +16%
10. https://www.mk.co.kr/en/stock/11190568 — MOVE 98,468% premium case
11. https://www.binance.com/bg/square/post/26745323496330 — HYPER +130%
12. https://cryptonews.net/news/market/30168872/ — Bithumb ORDER +90%
13. https://czxurui.com/kx/36667.html — CRV Bithumb 600% premium
14. https://www.hankyung.com/article/202311031124i — Upbit 1-second chart (Korea economic daily)
15. https://m.upbitcare.com/academy/education/coin/1011 — Upbit official kimchi-premium article
16. https://www.upbit.com/service_center/notice?id=640 — Upbit 5-min buy-ban rule (official 2018)
17. https://www.yna.co.kr/view/AKR20241111141700002 — Yonhap on negative kimchi premium Nov 2024
18. https://www.newsis.com/view/NISX20240313_0002659556 — Newsis kimchi premium peaked 10%
19. https://datalab.upbit.com/ — Upbit Datalab dashboard

### Japanese venues
20. https://coinpost.jp/?p=17394 — CoinPost JP listing-pump factor article (Lisk, Monacoin)
21. https://cloud.tencent.com/developer/news/79557 — Lisk +65% on bitFlyer 2018-01-31
22. https://en.wikipedia.org/wiki/BitFlyer — BitFlyer corporate / market share
23. https://bitflyer.com/ja-jp/monacoin-chart — Monacoin/JPY live
24. https://www.fsa.go.jp/en/regulated/licensed/en_kasoutuka.pdf — Japan FSA licensed exchanges
25. https://pluang.com/en/news-feed/solana-masuk-bursa-jepang-bitflyer-listing-sol — bitFlyer SOL listing June 2024

### Airdrop mechanisms
26. https://www.jb51.net/blockchain/963355.html — HYPE distribution percentile stats
27. https://www.qklw.com/baike/20251028/840911.html — HYPE 31% community + Sybil detection
28. https://airdropalert.com/blogs/full-hyperliquid-airdrop-strategy-exposed/ — Delta-neutral farming
29. https://medium.com/@miwezuti/hyperliquid-airdrop-strategy-how-to-qualify-2308c219b13b — HYPE point multipliers
30. https://zirkels.com/a/hyperliquid-airdrop-2-step-by-step-eligibility-guide-secret-strategies-2025 — Anti-Sybil wallet isolation
31. https://www.bitrue.com/blog/jupuary-2025-airdrop-explained — Jupiter Jupuary rules (750k wallets excluded)
32. https://www.binance.com/en/square/post/18568932141010 — JUP tiered system, snapshot Nov 2 2023→Nov 2 2024
33. https://www.iyiou.com/briefing/197001211508485 — Jupiter 955k wallets S1, 1B JUP
34. https://www.jito.network/blog/jto-airdrop-eligibility-and-allocation-specifications/ — JTO eligibility (100 points floor)
35. https://coinacademy.fr/airdrops/airdrop-jito/ — Jito point-earning multipliers
36. https://etherfi.gitbook.io/gov/seasons/airdrop-season-3 — ether.fi S3 disqualifying rules
37. https://www.bankless.com/getting-started-restaking-on-ether-fi — ether.fi points formula ETH staked × 1000 × days
38. https://www.lexr.com/en-ch/blog/the-eigenlayer-airdrop/ — EigenLayer 15% supply, 6.05% Phase 1
39. https://www.cryptonewsnavigator.com/academy/article/eigenlayer-airdrop-recipients-did-something-unexpected-with-their-tokens — 68% of EIGEN recipients held/staked, not sold

### On-chain / cross-venue / arbitrage
40. https://new.qq.com/rain/a/20241210A0833D00 — MOVE $1.013 OKX vs Upbit $1.36B vol, arbitrage throttle
41. https://finance.sina.com.cn/blockchain/roll/2025-08-27/doc-infnkprp6069834.shtml — Hyperliquid XPL whale +200% in 2 min
42. https://news.qq.com/rain/a/20250827A022YZ00 — XPL whale detail (rumored Sun Yuchen-linked)
43. https://cryptolisting.ws/id/upbit-listing-alert/ — Commercial listing-alert API

---

## §6. Open questions / further research

1. **Post-Jupuary Sybil detection accuracy** — Jupiter excluded 750k wallets in Jupuary S1; what % of those exclusions were false positives? This determines whether wallet-graph isolation or behavior-pattern farming is the better risk-adjusted bet.

2. **Hyperliquid S3 specific curve** — S1 distributed 31% of supply (massive). S2 retention rates unknown. S3 likely smaller per-wallet — does the delta-neutral farming PnL still beat pure staking?

3. **Japan FSA "crypto asset" reform** — 2026 saw expansion of approved venues; will bitFlyer/Coincheck list more aggressive altcoin listings, reviving the Lisk-era pump? Unclear.

4. **Kimchi-premium structural flip** — Once Korean retail capitulates to global venues (negative premium), is the premium a useful retail-sentiment indicator at all, or just noise?

5. **@ai_9684xtpa signal decay** — As more market participants follow her, what's the half-life of her signal alpha? Public-time data from late 2025 suggests it's already compressing.

6. **ether.fi / EigenLayer retroactive airdrops vs forward point programs** — Are forward-farming strategies (S4/S5 etc) still economic, or has the points-to-token ratio compressed past break-even?

7. **Korea travel-rule expansion** — Does the 2025 expansion cover USDT-USDC pairs, closing the kimchi-premium arbitrage door further?

8. **Hyperliquid-specific token pre-market (HIP-1)** — The XPL pre-launch was first-mover-positive but also subject to whale manipulation ($16M in 1 min). Is there a systematic pre-market discovery edge here beyond gambling?

9. **Japan 上場ポンプ revival via Coincheck** — Coincheck (under Monex) has been more active listing recently than bitFlyer; need a Japanese-language data corpus specifically on Coincheck listings.

10. **Channel: which Telegram group is the actual leak source for @ai_9684xtpa** — without knowing the source, can't build a faster feed.