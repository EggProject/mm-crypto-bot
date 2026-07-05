# Phase 11.5 — Track E (Cross-DEX Funding Basis) — Producer Log

**Producer role:** Crypto-native research agent — cross-DEX funding microstructure, perp-DEX basis arb
**Output track:** E — Cross-DEX funding microstructure basis arb (building on Phase 11.4d/11.4e TermStructure + RegimeShift)
**Date:** 2026-07-05
**Branch:** `phase11-5-research-fleet`
**Directed by:** Phase 11.5 research fleet brief — emphasize cross-DEX funding divergence beyond Phase 11.4d/11.4e, surface Asian forum depth

---

## 1. Inputs

- **Doctrine:** Mavis research doctrine — crypto-native only, ≥15 web searches, ≥4 non-English languages (en/zh/ja/kr minimum), ≥2 independent sources per empirical claim, in-line citations, NO Hungarian.
- **Predecessor anchors:**
  - Phase 11.3 Track E (`docs/research/phase11-3-archive/track-e/report.md`) — order-flow / liquidation cascade alpha; the Cross-Exchange Liquidation Divergence hypothesis (H4 in that track) is the primitive this track refines for funding rates.
  - Phase 11.4d (TermStructure) and Phase 11.4e (RegimeShift) — built on **synthetic AR(1) basis data**; this track is the empirical reality check + multi-venue wiring specification.
  - Phase 6 Funding Carry (`docs/research/phase6-funding-carry.md`) — long-spot + short-perp delta-neutral baseline.
- **Specific sub-questions assigned:**
  1. Perp-DEX vs CEX funding divergence (Hyperliquid vs Binance documented gaps)
  2. Cross-venue basis arb mechanics (when spread > X bps for > Y hours, post-fee P&L)
  3. Funding-rate mean reversion patterns (time-of-day, day-of-week)
  4. Sticky funding regimes (high-funding persistence length)
  5. Alt-coin funding volatility vs BTC/ETH (SOL, DOGE, HYPE, JUP)
  6. Term structure of funding across venues
  7. Phase 11.4e synthetic AR(1) limitation + multi-venue extension plan

## 2. Search-execution log

22 distinct queries executed; full audit trail:

| # | Query | Language scope | Notes |
|---|-------|----------------|-------|
| 1 | `Hyperliquid vs Binance funding rate divergence cross-exchange arbitrage basis 2025` | en | Found AlgoVault MCP, Button, BitMEX Q3 report |
| 2 | `Hyperliquid funding rate API documentation 8h formula HIP-3` | en | Official Hyperliquid funding docs + HIP-3 deployer actions |
| 3 | `永续合约资金费率套利 跨交易所 比特币 机制` | zh | Cross-exchange funding-rate arbitrage mechanism |
| 4 | `Hyperliquid 大宗交易 资金费率 HYPE 套利 中文` | zh | Chinese-language practice depth — Hyperliquid EVM arb team strategy |
| 5 | `Crypto funding rate time of day effect Asian European US session hour pattern` | en | Time-of-day seasonality depth |
| 6 | `ETH funding rate sticky regime mean reversion 2025 Boros delta-neutral` | en | Sticky-regime length + Boros as fixed-rate primitive |
| 7 | `Hyperliquid Hyperps DEXX vs Binance funding SOL DOGE HYPE JUP altcoin` | en | Alt-coin funding dispersion; HAL/PERP cross-venue |
| 8 | `비트코인 비트멕스 바이낸스 거래소 자금조달비율 김치프리미엄 차이` | kr | Korean funding-rate + Kimchi premium arb context |
| 9 | `Coinglass funding rate comparison tracker multiple exchanges arbitrage dashboard` | en | Coinglass's native cross-venue tracker + API endpoints |
| 10 | `crypto funding rate forward curve term structure implied yield curve` | en | Term-structure academic + sUSDe Blockworks research |
| 11 | `bitFlyer FX Perpetual funding rate basis bFFX BTC 毎時データ` | en+ja | BitFlyer FX perp + Japanese docs |
| 12 | `academic paper perpetual futures funding rate arbitrage crypto Ethereum two-tiered structure mdpi` | en | Zhivkov 2026 — anchor academic for §3.H1 |
| 13 | `"Phase 11.4" OR "Phase 11.5" mm-crypto-bot research TermStructure RegimeShift` | en | Tried to find prior in-repo context; only generic hits |
| 14 | `crypto funding rate inversion regime shift 2025 2026 sticky high positive mean reversion` | en | Sticky regime persistence + Feb 2026 collapse data |
| 15 | `GMO coin bitFlyer Japan 暗号資産 資金調達率 データ 取引所` | ja | Japan local-exchange funding depth |
| 16 | `Upbit Bithumb 비트코인 선물 Upbit perpetual funding rate Korean market launch` | kr | Korean KRW-spot listing event-driven funding spike |
| 17 | `Hyperliquid HIP-3 funding multiplier deployer custom perp market` | en | HIP-3 protocol spec + OI history (deployer-controlled dispersion) |
| 18 | `HYPE token Hyperliquid 市场 中性 期现套利 收益 中文币圈` | zh | HyperEVM arbitrage team post-mortem (LBank Chinese source) |
| 19 | `Hyperliquid 中文费率 资金费率 套利 跨所` | zh (via chaincatcher + chainup) | Chinese-language practitioner cross-venue |
| 20 | `crypto funding rate calendar UTC settlement Asian session` | en | Verified 00:00/08:00/16:00 UTC settlement mapping |
| 21 | `Hyperliquid predicted funding rate API endpoint metaAndAssetCtxs` | en | H3 mechanism — predicted-vs-realized |
| 22 | `Hyperliquid HYPE whale airdrop funding rate spike June 2026` | en | Empirical anchor for H1 timing (HYPE-airdrop-driven HL funding) |

### Detail fetches (full page reads)

- `https://ideas.repec.org/a/gam/jmathe/v14y2026i2p346-d1844705.html` — full MDPI Zhivkov 2026 abstract + RePEc citation chain (Krestenko et al 2026 Dynamic Collateral Control cites Zhivkov).
- `https://arbitragescanner.io/blog/hyperliquid-binance-funding-rate-arbitrage` — full June 2026 case study including the HOME -901bps day (June 7 2026), the HYPE/SOL/BEAT funding table, and risk-management rules.
- (Attempts on news.futunn.com and mdpi 403'd; relied on other repositories for those papers' content.)

## 3. Doctrine compliance verification

| Rule | Status | Evidence |
|------|--------|----------|
| No Hungarian | ✓ | No Hungarian text anywhere; English + zh + ja + kr + zh-tw only |
| ≥15 web queries | ✓ | 22 queries executed |
| Asian forums first-class | ✓ | Korean (Upbit/Bithumb 김치 premium, Korean sources Chosun Biz, BeInCrypto), Chinese (Odaily, PANews, ChainCatcher, Sina, Tencent News, Foresight News, CoinGlass zh-TW, 1Token, luyouqi, Hyperliquid CN, php.cn, 知乎), Japanese (bitFlyer Lightning docs + FAQ, GMO Coin comparison, Coinbase/Coincheck Japanese sources, CryptoQuant Japan, note.com practitioners) — all 4 are first-class. |
| Crypto-native only | ✓ | No equity/forex source cited as primary; Coinbase/Kraken mentioned only in passing as reference venues. |
| ≥2 independent sources per empirical claim | ✓ | Each H1-H6 mechanism and historical claim has ≥2 cited sources; Empirics of funding spread (HYPE 28-42% annualized) cited from ArbitrageScanner + Button + BitMEX Q3 report + Buildix (4 sources). |
| In-line citations | ✓ | All claims cite URL immediately. |

## 4. Source language distribution

| Language | Count of distinct sources | Type |
|----------|---------------------------|------|
| English | ~28 | Academic (Wharton, MDPI, Blockworks, SSRN, Springer), vendor (CoinGlass, BitMEX, Glassnode, Phemex, MEXC, Buildix, Button, ArbitrageScanner, Chainup, Eco, Dwellir, Zirodelta, AlgoVault, Fundingview, Hyperliquid Guide), exchange data (coinperps, loris.tools), practitioner Twitter/X, Reddit |
| Simplified Chinese | ~26 | Sina/吴说, Odaily (Foresight News), Tencent News, PANews, CoinGlass zh, ChainCatcher, luyouqi, lbank, hyperlink CN, php.cn (中文), Bitbo (zh), Hyperliquid CN, 1token zh, virtualcurrency.cc, heth.ink, marketmaker.cc, volcengine, 521BTC, Juejin |
| Traditional Chinese | ~3 | CoinGlass zh-TW (3 sub-pages), Gate.com zh-TW |
| Japanese | ~6 | bitFlyer Lightning docs JA, bitFlyer FAQ, JPM-trader, CryptoQuant JA, GMO Coin comparison table, Coinbase JP/bitbank, GMO Internet Group history |
| Korean | ~6 | Chosun Biz, BeInCrypto Korea, Yahoo Finance Korea, Follow.in (EN but Korea-listed signals), Premium IDX (Naver), TradingView KR, Bitcointalk Korea |
| Other (Italian, Spanish, etc.) | ~3 | Springer (Italian/Spanish co-authors), Coinglass regional pages (vi, id, es) |

Total: ~70 distinct URLs (numbered 1-77 in REPORT.md §5; some URLs are referenced more than once).

## 5. Mismatches / dead ends

- **Phase 11.4d/11.4e in-repo research:** No specific reports found for Phase 11.4d ("TermStructure") or 11.4e ("RegimeShift") under those exact names in this worktree. The cargo-cult loop showed only generic crypto materials. The "synthetic AR(1) basis data" claim from the user prompt is taken as a working assumption and §3.5 is written as if both phases shipped with synthetic input.
- **MDPI 14/2/346 PDF:** direct fetch returned 403; relied on RePEc abstract + secondary citations.
- **news.futunn.com fetch:** returned blank ("Please enable JavaScript"); relied on direct bitmex.com URL.
- **Upbit listing announcement APIs:** no official free endpoint; recommended Phase 12 uses a paid data vendor or aggregator.

## 6. Decisions / framing notes

- **Title:** "Cross-DEX Funding Microstructure Basis Arb" (per user prompt) — kept exact.
- **Number of hypotheses:** Delivered **6 ranked hypotheses** (H1-H6), not just H1-H2 expected. This is intentional: the cross-DEX surface is large enough that ranking alone would lose edges.
- **Plugin candidates:** Delivered **6 plugins** (E1-E6) matching the 6 hypotheses. E1 is read-only (lowest risk, highest priority); E2/E5/E6 are execution (with risk-gates).
- **§3.5 added beyond the user's spec:** called out specifically, since the user's question 7 asked for "Phase 11.4e limitation + extension plan."

## 7. Output

- **Primary deliverable:** `docs/research/phase11-5-research-fleet/cross-dex-funding-basis/REPORT.md`
- **Producer log:** this file (`producer-log.md`)
- **Data feeds:** `data-feeds.md` (per request)

Commit pending on `phase11-5-research-fleet` branch.
