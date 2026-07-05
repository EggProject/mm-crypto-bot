# Phase 11.5 Track E — Cross-DEX Funding Basis — Data Feeds Inventory

**Track:** E — Cross-DEX funding microstructure basis arb
**Date:** 2026-07-05
**Stage of design:** Research / discovery. Cataloged per the doctrine that "no real multi-venue wiring exists today" — Phase 11.5 is the discovery step.

This document lists every public endpoint, API, and dashboard cited in the REPORT, organized by the plugin that would consume it, including rate limits, cost, output schema, and known limitations.

---

## 1. Per-venue funding-rate feeds

### Hyperliquid (DEX, primary)

| Endpoint / Channel | URL | Schema | Cadence | Cost | Used by plugin |
|---|---|---|---|---|---|
| `metaAndAssetCtxs` | `POST https://api.hyperliquid.xyz/info` body `{"type":"metaAndAssetCtxs"}` | Per-asset: `funding` (string, hourly), `markPx`, `oraclePx`, `premium`, `openInterest`, `maxLeverage`, etc. | Poll every 5s | free | E1, E2, E3, E5 |
| `predictedFundings` | same, body `{"type":"predictedFundings"}` | `[coin, [[venue, {fundingRate, nextFundingTime, fundingIntervalHours}]]]` tuples. **Hyperliquid natively returns the predicted funding for OTHER venues alongside its own.** | Poll every 5s | free | E1, E2, E3 |
| `fundingHistory` | same, body `{"type":"fundingHistory","coin":"BTC","startTime":...,"endTime":...}` | Per-asset historical funding time-series | one-shot | free | E1 (backfill), E3 (history) |
| `userFunding` | same, body `{"type":"userFunding","user":"0x..."}` | User-account ledger of funding payments | on-demand | free | E2 (position state) |
| HIP-3 deployer actions on-chain | L1 events; explorer + `perpDeploy` API actions | `setFundingMultipliers` (0-10×), `setFundingInterestRates` (-0.01 to 0.01) | per-deploy event | free | E5 |
| `fundingComparison` (UI page) | `https://app.hyperliquid.xyz/fundingComparison` | Official cross-venue table (Binance/Bybit/Hyperliquid) | page-level refresh | free | E1 (read-only cross-check) |

**Documented mechanics:** funding settles **hourly** at 1/8 of the computed 8h rate, capped at 4%/hr. HIP-3 deployers can opt into a more responsive premium formula `premium = (0.5*(impact_bid_px+impact_ask_px)/oracle_px) − 1` ([Hyperliquid funding docs](https://hyperliquid.gitbook.io/hyperliquid-docs/trading/funding)). Hyperps (synthetic references without external spot oracle) compute funding at 1% of the usual clamped formula, with an EMA-based internal "oracle price."

### Binance (CEX, primary)

| Endpoint / Channel | URL | Schema | Cadence | Cost | Used by plugin |
|---|---|---|---|---|---|
| REST `fapi/v1/fundingRate` | `GET https://fapi.binance.com/fapi/v1/fundingRate?symbol=BTCUSDT` | Historical funding rates per symbol | one-shot (history) | free | E1 |
| WebSocket `markPrice@1s` | `wss://fstream.binance.com/ws/btcusdt@markPrice@1s` | Mark, index, funding rate, next funding time | 1s | free | E1, E2 |
| `!forceOrder@arr` liquidation stream | `wss://fstream.binance.com/ws/!forceOrder@arr` | Liquidation prints | real-time | free | E3 (cascade overlay) |
| REST `fapi/v1/allForceOrders` | `GET https://fapi.binance.com/fapi/v1/allForceOrders` | Liquidation history | fallback 10s | free | E3 |

**Documented mechanics:** 8h funding cadence at 00:00, 08:00, 16:00 UTC; default interest rate 0.01%/8h (≈11.6% APR paid to shorts); fee schedule 0.020%/0.050% maker/taker at VIP-0.

### Bybit (CEX, secondary)

| Endpoint / Channel | URL | Schema | Cadence | Cost | Used by plugin |
|---|---|---|---|---|---|
| REST `v5/market/funding/history` | `GET https://api.bybit.com/v5/market/funding/history?category=linear&symbol=BTCUSDT` | Historical funding | one-shot | free | E1 |
| WebSocket `tickers` | `wss://stream.bybit.com/v5/public/linear` | mark, index, fundingRate, nextFundingTime | 1s | free | E1, E2 |

**Documented mechanics:** 8h cadence (00:00, 08:00, 16:00 UTC). Fee schedule: taker 0.055%, maker 0.020% at base VIP-0.

### OKX (CEX, secondary)

| Endpoint / Channel | URL | Schema | Cadence | Cost | Used by plugin |
|---|---|---|---|---|---|
| REST `public/funding-rate` | `GET https://www.okx.com/api/v5/public/funding-rate?instId=BTC-USDT-SWAP` | Funding rate, next funding time, interest rate | one-shot (history) | free | E1 |
| WebSocket `funding-rate` | `wss://ws.okx.com:8443/ws/v5/public` | mark, funding, next time | 1s | free | E1 |

**Documented mechanics:** 8h cadence. Fee schedule: taker 0.050%, maker 0.020% at base tier.

### MEXC (CEX, optional)

| Endpoint / Channel | URL | Schema | Cadence | Cost | Used by plugin |
|---|---|---|---|---|---|
| REST `/api/v1/contract/funding_rate` | `GET https://contract.mexc.com/api/v1/contract/funding_rate` | Current + historical funding per symbol | one-shot | free | E1 (cross-check for alt-coins), E3 |

### Hyperps (Hyperliquid-only synthetic perps)

- **Schema detail:** [Hyperliquid Hyperps docs](https://hyperliquid.gitbook.io/hyperliquid-docs/trading/hyperps). Oracle price = 8h EMA of the last day's minutely mark prices. Funding = 1% of the normal clamped formula.
- **Used by plugin E1** for any HIP-3 listed synthetic asset.

### bitFlyer FX (Japan, optional)

| Endpoint / Channel | URL | Schema | Cadence | Cost | Used by plugin |
|---|---|---|---|---|---|
| REST `v1/getfundingrate` | `GET https://api.bitflyer.com/v1/getfundingrate?product_code=FX_BTC_JPY` | `current_funding_rate`, `next_funding_rate_settledate` | per 8h UTC | free | E1 (Japan regional) |
| REST `v1/getfundingratehistory` | `GET https://api.bitflyer.com/v1/getfundingratehistory?product_code=FX_BTC_JPY&count=500` | Historical list | one-shot | free | E1 |

**Documented mechanics:** 8h cadence since 2024-03-28 launch. "FX_BTC_JPY" product code. **Note:** bitFlyer FX is JPY-quoted; spread against USDT perps requires FX-conversion at every compare-step (introduces JPY/USD carry risk that has to be modeled).

### GMO Coin (Japan, optional)

- **Per iBuidl.org 2026 comparison** ([ibuidl.org/blog/japan-crypto-exchange-comparison-2026-20260309](https://ibuidl.org/blog/japan-crypto-exchange-comparison-2026-20260309)), GMO offers 14 FX perp pairs. Their public funding API is **not** documented in the same way as bitFlyer's. **Phase 12 research question.**

---

## 2. Aggregator / vendor feeds (cross-venue normalization)

### CoinGlass — primary aggregator

| Endpoint | URL | Output | Cadence | Cost | Used by plugin |
|---|---|---|---|---|---|
| Funding Rate Arbitrage List | `GET /futures/fundingRate/arbitrage-list` | Per-asset ranked cross-venue spread + APR + spread + fee | 1min | Hobbyist $29/mo, Startup $79/mo | E1, E2 |
| Funding Rate OHLC history | `/futures/fundingRate/ohlc-history` | OHLC time-series per (venue, asset) | 1min | Startup $79+/mo for hourly history | E1, E3 |
| OI-Weighted Funding Rate | `/pro/AvgFunding/<asset>` | OI-weighted aggregate funding baseline | 1min | Pro tier | E1, E3 |
| Cumulative Exchange List | `/cumulative-exchange-list` | All supported venues | daily | free | E1 |
| Funding Rate per venue | `/futures/fundingRate/exchange-list` | Per-venue snapshot | 1min | Hobbyist tier | E1 |
| Aggregate Funding Rate | `/futures/fundingRate` | Reference aggregate | 1min | free | E3 |

**Documented coverage** per CoinGlass: ~30 exchanges (Binance, OKX, Bybit, CME, Bitget, Deribit, BitMEX, Bitfinex, Gate, Kraken, KuCoin, dYdX, CoinEx, BingX, Coinbase, Crypto.com, Hyperliquid, Bitunix, MEXC, HTX, WhiteBIT, Aster, Lighter, EdgeX, Drift, Paradex, Extended, ApeX Omni, LBank, tradeXYZ).

**Limitation:** Hobbyist plan does **not** include hourly-granularity history; for backfilling Phase 11.5 strategy validation the Startup ($79) tier is required.

### Sharpe AI — Funding Rate Tracker

| Endpoint | URL | Output | Cadence | Cost | Used by plugin |
|---|---|---|---|---|---|
| 13-exchange Aggregated Funding | `https://www.sharpe.ai/products/funding-rates` | Real-time tracker w/ per-session, per-hour, per-day-of-week breakdown | 1min | free/paid | E1, E3 |

### Coinalyze — Free Funding History

- Historical funding rates per (venue, asset).
- Free tier limited but sufficient for back-testing core H1 signal.

### Glassnode Studio — Aggregated Perpetual Funding

- OI-weighted aggregate perpetual funding rate, 24h resolution.
- Free to query at low frequency; paid for high-freq or historical depth.

### Fundingfinder — Cross-venue Arbitrage Scanner

- Free, 8-venue funding-rate aggregator with optional $5/mo paid tier with cross-exchange arb endpoint.

### CF Benchmarks — Kraken Perpetual Funding Rate Index (KFRI)

- Official audited index on Kraken funding rate; can be used as a *neutral reference* for cross-venue comparison.

---

## 3. Term-structure feeds (Boros / Pendle YU)

### Boros (Pendle funding-rate tokenization, launched 2025-08-05 on Arbitrum)

| Endpoint / Channel | URL | Schema | Cadence | Cost | Used by plugin |
|---|---|---|---|---|---|
| Pendle API | `https://api.pendle.finance/core/v1/{chainId}/markets` | List of all YU markets w/ implied APY, maturity, TVL | 1min | free | E4 |
| Pendle Subgraph | `https://api.thegraph.com/subgraphs/name/pendle-finance/pendle-v2-arbitrum` | Historical implied APY + realized funding | on-demand | free | E4 |
| Boros Front-end | `https://boros.pendle.finance/` | UI confirmation of front-month vs back-month implied yields | manual | free | E4 (test signal) |
| BitMEX — Boros Blueprint explanatory | [bitmex.com/blog/the-boros-blueprint](https://www.bitmex.com/blog/the-boros-blueprint) | Structural baseline 10.95% APY | reference | free | E4 (anchor) |

**Documented mechanics:** YU = funding-rate cash flow over a future period. Front month implied > back month implied = backwardation (market expects funding to decline). Boros launched 2025-08-05 with BTC + ETH on Binance; subsequently expanding to Hyperliquid + Bybit.

---

## 4. Event / news feeds (H6 Korean listings)

| Endpoint / Channel | URL | Output | Cadence | Cost | Used by plugin |
|---|---|---|---|---|---|
| Upbit public Notice (Korean) | `https://upbit.com/service/notice` (HTML scrape) | New listing announcements | real-time | free | E6 |
| Bithumb public Notice (Korean) | `https://en.bithumb.com/news/notice` (HTML scrape) | New listing announcements | real-time | free | E6 |
| Upbit Telegram aggregator | `@upbit_sun`; `@BWEnews` | New listing real-time push | real-time | free | E6 |
| Cryptorank.io listing announcements | `https://cryptorank.io/news` | Cross-venue listing tracker | daily | free + paid tiers | E6 |

**Limitation:** No free REST API for Upbit listings. Workaround: scrape the official notice + Telegram aggregator + cross-check CoinGlass listing webhook.

---

## 5. Cross-venue spread / liquidity depth feeds

| Endpoint | URL | Output | Cadence | Cost | Used by plugin |
|---|---|---|---|---|---|
| Binance orderbook depth | `wss://fstream.binance.com/ws/btcusdt@depth20@100ms` | Top 20 levels, 100ms | 100ms | free | E2 (slippage curves) |
| Hyperliquid orderbook depth | `POST https://api.hyperliquid.xyz/info` body `{"type":"l2Book","coin":"BTC"}` | L2 snapshot | on-demand | free | E2, E5 |
| OKX orderbook | `wss://ws.okx.com:8443/ws/v5/public` channel `books5` | 5-level depth, 100ms | 100ms | free | E1 |
| Amberdata depth heatmap | `https://blog.amberdata.io/the-rhythm-of-liquidity-temporal-patterns-in-market-depth` | Historical 24h depth profile | daily | paid | E1 (calibration) |

---

## 6. Macro / regime-context feeds (Phase 11.4e gate)

| Endpoint | URL | Output | Cadence | Cost | Used by plugin |
|---|---|---|---|---|---|
| CryptoQuant ELR | `https://userguide.cryptoquant.com/cryptoquant-metrics/market/estimated-leverage-ratio` | Per-exchange estimated leverage ratio | daily | free snapshot | E3 |
| Glassnode Week On-Chain | `https://research.glassnode.com/` | Weekly market regime summary | weekly | paid | E3, E2 (regime gate) |
| Coin Metrics regional trading patterns | `https://coinmetrics.io/` | Asian/European/American session volume breakdown | daily | paid | E2 (regime gate) |

---

## 7. Backtest / validation data sources

| Source | URL | Output | Cost | Used by |
|---|---|---|---|---|
| Binance Vision aggTrades | `https://data.binance.vision/` | Historical trade-level data (free dumps) | free | historical backtest |
| Coinalyze free tier | `https://coinalyze.net/hyperliquid/funding-rate/` | Historical funding rates (free tier) | free | backtest E1 |
| Boros subgraph | above | Historical implied APY | free | backtest E4 |
| Loris.tools HYPE panel | `https://loris.tools/markets/perps/hype` | Live multi-venue HYPE data | free | live cross-check |

---

## 8. Cost summary (per Phase 11.5 build)

| Tier | Components | Monthly cost |
|---|---|---|
| **Free only** | All Hyperliquid public + all Binance/Bybit/OKX public + CoinGlass free + Boros subgraph + Coinalyze free + Glassnode Studio + bitFlyer public + Tokyo local | **$0** |
| **Hobbyist** | Above + CoinGlass Hobbyist $29 + FundingFinder Pro €5 | ~$35 |
| **Startup (recommended)** | Above + CoinGlass Startup $79 (180 days hourly history) + Glassnode Standard | ~$170 |
| **Standard (full backtest)** | CoinGlass Standard $299 + Glassnode Advanced + Cryptorank.io Pro | ~$500+ |

---

## 9. Known limitations / data-quality notes

1. **Hyperliquid `predictedFundings` is consensus-based per validator** — different validators may compute slightly different predictions. Best to use median across N validators.
2. **CoinGlass data has 30s-1min lag** vs the underlying venue's WebSocket. For real-time execution (E2), wire Hyperliquid + Binance + Bybit + OKX WS directly; use CoinGlass only as authoritative reference for spread-risk dashboards.
3. **BitFlyer FX historical funding rate is published only after settlement** — there's no "predicted" endpoint, so H3 (predicted-vs-realized) only applies to venues that publish predictions (Hyperliquid, Boros).
4. **Korean Upbit/Bithumb listing announcement scraping is a fragile signal** — recommend Phase 12 swap to Cryptorank.io Pro or a paid webhook ($30-50/mo).
5. **HIP-3 deployer-customized funding rates make per-asset calibration critical** — a single HIP-3 asset may have funding rules different from validator-operated markets. Phase 11.5 E5 must read the on-chain `perpDeploy` events to identify the funding multiplier + interest rate before assuming any cross-venue basis is "comparable."
6. **The "Hypurr" data feeds** (e.g., Hypurrscan or similar analytics dashboards) are not a primary signal source; included only in passing as a research-scope data layer.

---

*End of data-feeds.md*
