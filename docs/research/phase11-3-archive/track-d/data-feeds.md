# Data Feeds — Phase 11.3 Track D (Funding-rate microstructures)

> **Purpose:** enumerate the data sources required to build the 5 alpha hypotheses in `report.md §3`. Each entry lists the REST endpoint / websocket channel / CSV file with a 1-line use note. Applicability to **1:10 bybit.eu SPOT-only mandate** is flagged at the end of each hypothesis section.
>
> **Doctrine:** crypto-native only. The project runs **bybit.eu SPOT** (MiCAR EU, no margin futures). All perp-side data is consumed READ-ONLY via REST / websockets — the project does NOT place perp orders. The implied perp leg is synthetic, executed on Binance/OKX/Bybit/Hyperliquid via API on a separate risk-managed sub-account (Phase 11.2e `BasisTradePlugin` precedent: Binance perp short + bybit.eu SPOT long).
>
> **Note on MiCAR:** bybit.eu SPOT-only is a HARD constraint. Reading data from offshore perp venues (Binance, OKX, Bybit.com, Hyperliquid, dYdX) is **legal under MiCAR Article 60** (market-data-only APIs) — the project already does this in Phase 6/8/11.2e for the funding-rate data download. Executing perp orders requires an offshore sub-account; the project documented this in Phase 6 (the "cross-exchange synthetic" model).

---

## 1. REST endpoints — historical funding rates

### 1.1 Binance USDⓈ-M perp funding history
- **Endpoint:** `GET https://fapi.binance.com/fapi/v1/fundingRate?symbol=BTCUSDT&startTime=...&endTime=...&limit=1000`
- **Auth:** none for read-only historical
- **Schema:** `{fundingTime (ms), symbol, fundingRate (decimal), markPrice}`
- **Rate limit:** 2400/min weight (public endpoint = 1 weight per request)
- **Page size:** 1000 rows; paging by `startTime = lastTs + 1`
- **Project precedent:** `packages/backtest-tools/src/cli/download-funding-rates.ts` already implements this end-to-end → CSV at `data/funding/binance_<sym>_funding_8h.csv` (2745 rows × 3 symbols × 30 months in current dataset)
- **Use in Track D hypotheses:** 1, 2, 4, 5 — every hypothesis consumes Binance as the baseline anchor

### 1.2 Bybit v5 funding history
- **Endpoint:** `GET https://api.bybit.com/v5/market/funding/history?category=linear&symbol=BTCUSDT&startTime=...&endTime=...&limit=200`
- **Auth:** none for public market data
- **Schema:** `{list: [{fundingRateTimestamp (ms), fundingRate, markPrice}], nextPageCursor}`
- **Rate limit:** 600 requests / 5s for public market
- **Project status:** NOT yet integrated. Need new CLI: `packages/backtest-tools/src/cli/download-bybit-funding.ts` (planned for Phase 11.4 Track D plugin).
- **Use:** Hypothesis 3 (cross-X basis Bybit ↔ Binance) requires 30 months of Bybit funding aligned with Binance timestamps.

### 1.3 OKX funding history
- **Endpoint:** `GET https://www.okx.com/api/v5/public/funding-rate-history?instId=BTC-USDT-SWAP&before=...&after=...&limit=100`
- **Auth:** none for public
- **Schema:** `{data: [{fundingTime (ms), fundingRate (string), instId}], code, msg}`
- **Rate limit:** 20 req / 2s public
- **Project status:** NOT yet integrated.
- **Use:** Hypothesis 3 (cross-X basis OKX ↔ Binance); also Hypothesis 4 (1h settlement cycle OKX = peg for arbitrage against 8h Binance).

### 1.4 Hyperliquid funding history
- **Endpoint:** `POST https://api.hyperliquid.xyz/info` body `{"type": "fundingHistory", "coin": "BTC", "startTime": <ms>}`
- **Auth:** none for public info endpoint
- **Schema:** `{[coin]: [{time (ms), fundingRate (string, hourly), premium (string)}]}`
- **Project status:** NOT yet integrated. Will need signing for trading.
- **Use:** Hypothesis 4 (Hyperliquid hourly cadence as arb source vs 8h Binance/OKX) + Hypothesis 1 (term-structure component).

### 1.5 dYdX v4 funding history
- **Endpoint:** `GET https://indexer.dydx.trade/v4/funding?market=BTC-USD&resolution=1HOUR&fromISO=...&toISO=...` (or via `https://api.dydx.trade/v4/funding/...`)
- **Auth:** none for public indexer
- **Schema:** `{funding: [{time (ms), rate (string, hourly 8h-equivalent)}]}`
- **Project status:** NOT yet integrated.
- **Use:** Hypothesis 4 (dYdX v4 governance-tunable rates as arb target). Note dYdX v4 hourly cadence + default cross-market interest = 0% makes it the most aggressive funding-rate venue for cross-X basis.

### 1.6 CoinGlass historical funding (cross-exchange aggregated)
- **Endpoint:** `GET https://open-api-v4.coinglass.com/api/futures/funding-rate/history?exchange=Binance&symbol=BTCUSDT&interval=8h&startTime=...&endTime=...` (requires CoinGlass API key — paid plan)
- **Auth:** CoinGlass Pro API key (~$29-99/mo for retail)
- **Schema:** OHLC funding rate history (open/high/low/close)
- **Endpoint:** `GET .../funding-rate/oi-weight-history` — **OI-weighted funding OHLC** — this is the project-critical new data feed
- **Endpoint:** `GET .../funding-rate/vol-weight-history` — volume-weighted funding OHLC
- **Endpoint:** `GET .../funding-rate/arbitrage` — live funding arbitrage opportunities list
- **Project status:** NOT yet integrated. Cost-effective alternative: run our own OI-weighted aggregation using CoinGlass's free `/arbitrage` endpoint as a verification check, plus our own Binance/Bybit/OKX feeds for the primary computation.
- **Use:** Hypothesis 2 (OI-weighted funding divergence signal). This endpoint is the single highest-value new feed for the project.

---

## 2. Websocket streams — real-time funding

### 2.1 Binance mark price + funding stream
- **Endpoint:** `wss://fstream.binance.com/ws/btcusdt@markPrice@1s` (1s mark price updates) OR `wss://fstream.binance.com/ws/btcusdt@fundingRate` (funding rate updates only)
- **Schema (mark):** `{e: "markPriceUpdate", E: ms, s: "BTCUSDT", p: "65000.00", r: "0.00010", T: nextFundingTime}`
- **Rate:** ~1 msg/sec per symbol per stream
- **Use:** Hypothesis 5 (real-time order-book imbalance around funding timestamp)

### 2.2 Bybit v5 linear ticker (mark + funding)
- **Endpoint:** `wss://stream.bybit.com/v5/public/linear` subscribe `{"op":"subscribe", "args":["tickers.BTCUSDT"]}`
- **Schema:** `{topic: "tickers.BTCUSDT", data: {fundingRate, markPrice, nextFundingTime, ...}}`
- **Rate:** ~10 msg/sec per symbol

### 2.3 OKX funding rate channel
- **Endpoint:** `wss://ws.okx.com:8443/ws/v5/public` subscribe `{"op":"subscribe", "args":[{"channel":"funding-rate","instId":"BTC-USDT-SWAP"}]}`
- **Schema:** `{arg, data: [{fundingRate, fundingTime, instId, ...}]}`

### 2.4 Hyperliquid real-time (sub-second)
- **Endpoint:** `wss://api.hyperliquid.xyz/ws` subscribe `{"method": "subscribe", "subscription": {"type": "activeAssetCtx", "coin": "BTC"}}`
- **Schema:** per-asset mark price + funding rate updates every ~3s
- **Significance:** sub-second resolution = best source for Hypothesis 5 (real-time cascade detection)

### 2.5 dYdX v4 websocket
- **Endpoint:** `wss://indexer.dydx.trade/v4/ws` subscribe `{"type": "subscribe", "channel": "v4_funding_markets_updates", "id": "BTC-USD"}`
- **Schema:** per-market funding rate updates

---

## 3. Open interest data feeds

### 3.1 Binance OI (historical + realtime)
- **REST historical:** `GET https://fapi.binance.com/futures/data/openInterestHist?symbol=BTCUSDT&period=5m&startTime=...&endTime=...` → OHLC OI
- **REST current:** `GET https://fapi.binance.com/fapi/v1/openInterest?symbol=BTCUSDT`
- **Websocket:** `wss://fstream.binance.com/ws/btcusdt@openInterest@1s`
- **Project status:** NOT yet integrated. Phase 11.4 Track D plugin would need this.

### 3.2 Bybit v5 OI
- **REST:** `GET https://api.bybit.com/v5/market/open-interest?category=linear&symbol=BTCUSDT&intervalTime=5min&startTime=...&endTime=...`
- **Websocket:** subscribe `tickers.BTCUSDT` (OI embedded in ticker data)

### 3.3 OKX OI
- **REST:** `GET https://www.okx.com/api/v5/rubik/stat/contracts/open-interest-history?instId=BTC-USDT-SWAP&period=5m&begin=...&end=...`
- **Websocket:** `public/trades` channel includes OI in ticker data

### 3.4 Hyperliquid OI
- **REST:** `POST https://api.hyperliquid.xyz/info` body `{"type": "meta"}` → includes asset universe; per-asset OI via `{"type": "assetCtxs"}`
- **Realtime:** `activeAssetCtx` websocket includes `openInterest`

### 3.5 dYdX v4 OI
- **REST:** `GET https://indexer.dydx.trade/v4/perpetualMarkets?market=BTC-USD` → includes `openInterest`
- **Realtime:** websocket `v4_perpetual_market_updates`

### 3.6 CoinGlass aggregated OI
- **Endpoint:** `GET https://open-api-v4.coinglass.com/api/futures/open-interest/aggregated-history?symbol=BTC&interval=5m&startTime=...&endTime=...`
- **Endpoint:** `GET https://open-api-v4.coinglass.com/api/futures/open-interest/exchange-history-chart?symbol=BTC&range=1d`
- **Significance:** aggregated OI across all venues = project-critical for Hypothesis 2 (OI-weighted funding).

---

## 4. Order-book depth feeds (Hypothesis 5)

### 4.1 Binance L2 depth
- **Websocket:** `wss://fstream.binance.com/ws/btcusdt@depth20@100ms` (20-level depth, 100ms update)
- **REST snapshot:** `GET https://fapi.binance.com/fapi/v1/depth?symbol=BTCUSDT&limit=1000`

### 4.2 Bybit L2 depth
- **Websocket:** `wss://stream.bybit.com/v5/public/linear` subscribe `orderbook.50.BTCUSDT`

### 4.3 OKX L2 depth
- **Websocket:** `wss://ws.okx.com:8443/ws/v5/public` subscribe `books-l2-tbt.BTC-USDT-SWAP` (tick-by-tick)

### 4.4 Hyperliquid L2 depth
- **Websocket:** `wss://api.hyperliquid.xyz/ws` subscribe `{"method":"subscribe", "subscription":{"type":"l2Book", "coin":"BTC"}}`
- **Project status:** NOT yet integrated. Critical for Hypothesis 5 — funding-timestamp order-book imbalance requires sub-second order-book data.

---

## 5. Historical funding CSV sources (offline bulk)

| Source | Coverage | Format | Access | Cost |
|--------|----------|--------|--------|------|
| Binance `download-funding-rates.ts` (project-internal) | 2024-01 → 2026-07 | CSV `fundingTime,symbol,fundingRate,markPrice` | bun run script | free |
| Coinglass bulk CSV export | 2019+ (per-exchange, per-symbol) | CSV via Pro dashboard | Coinglass Pro ($29+/mo) | paid |
| CryptoDataDownload (by retail aggregators) | varies | CSV | https://www.cryptodatadownload.com | free |
| OKX historical market data page | 2022-03+ | CSV | https://www.okx.com/historical-data | free |
| dYdX indexer historical | 2023-10+ | JSON via API | https://indexer.dydx.trade/v4 | free |

---

## 6. Hypothesis-to-feed mapping

### Hypothesis 1: Term structure (1-week vs 1-month funding differential)
- **Required feeds:**
  - Binance historical funding (1.1) for the 8h settlement rate
  - **Pendle yield curve** OR **dYdX HIP-3 forward-funding curve** for the 30d forward expectation (NOT YET DIRECTLY AVAILABLE — fall-back: use dYdX v4 funding premium history as proxy for forward-funding skew)
- **Project status:** Pendle integration is OUT OF SCOPE for 1:10 bybit.eu mandate. dYdX v4 funding history (1.5) is the most actionable feed.
- **Verdict:** MATCHES mandate for the dYdX v4 funding-rate proxy version (data is free; backtest-able in our existing funding-carry-leverage plugin).

### Hypothesis 2: OI-weighted funding rate divergence signal
- **Required feeds:**
  - Coinglass `oi-weight-history` endpoint (1.6) — the cleanest source
  - OR self-aggregated: Binance OI (3.1) + Bybit OI (3.2) + OKX OI (3.3) + Hyperliquid OI (3.4) + dYdX OI (3.5) feeding into a project-local weighted-average computation
- **Project status:** Coinglass endpoint is paid. Self-aggregation is free but requires writing the weighted-average math in TypeScript (≈ 200 LOC).
- **Verdict:** MATCHES mandate (self-aggregation version). REQUIRES TOKYO CO-LOC for the Coinglass Pro paid endpoint (low-latency API ingestion).

### Hypothesis 3: Cross-exchange basis arbitrage (Binance ↔ Bybit ↔ OKX ↔ Hyperliquid ↔ dYdX)
- **Required feeds:**
  - Binance funding (1.1) + Bybit funding (1.2) + OKX funding (1.3) + Hyperliquid funding (1.4) + dYdX funding (1.5)
  - Binance spot price + mark price (1.1, 2.1) for spot-leg pricing
  - Cross-exchange withdrawal latency feed (CoinGecko exchange balance, but NOT for the project — just latency assumption: 5-30 min)
- **Project status:** Binance funding already in dataset. Bybit/OKX/Hyperliquid/dYdX all need new downloaders.
- **Verdict:** MATCHES mandate at small scale (Binance ↔ Bybit, <$50k per leg). REQUIRES CAPITAL SCALE for the 5-way netting strategy (need margin in 3+ venues).

### Hypothesis 4: Funding rate regime shift detection (pre-event positioning)
- **Required feeds:**
  - All historical funding feeds (1.1–1.6)
  - Liquidations heatmap from Coinglass or Glassnode `GET https://api.glassnode.com/v1/metrics/derivatives/futures_liquidated_volume_long`
- **Project status:** liquidation heatmap is paid (Coinglass Pro $29+/mo or Glassnode Stage 1/2 ~$39+/mo). Fallback: derive liquidation proxy from OI decline rate.
- **Verdict:** MATCHES mandate at the read-only level (regime detection runs locally on already-downloaded historical data). OUT OF SCOPE for live real-time liquidation feed (requires paid subscription).

### Hypothesis 5: Funding + order-book imbalance at funding timestamp
- **Required feeds:**
  - Binance L2 depth @ 100ms (4.1)
  - Binance funding timestamp stream (2.1) for the trigger
  - Bybit L2 (4.2) + OKX L2 (4.3) for cross-X validation
- **Project status:** Binance L2 depth NOT yet integrated into the SCv1 plugins. Will require a new data-stream consumer in `packages/exchange`.
- **Verdict:** MATCHES mandate at the Binance-only level (1 venue, sub-second depth is enough to detect imbalance pre-funding). REQUIRES TOKYO CO-LOC for the cross-X real-time version (latency budget <50ms between Binance and Hyperliquid to be exploitable).

---

## 7. 1:10 bybit.eu applicability summary

| Hypothesis | Required data feeds | Available now? | Build effort | Mandate verdict |
|-----------|---------------------|----------------|--------------|-----------------|
| 1: Term structure | Binance + dYdX funding | Yes (free) | ~150 LOC | MATCHES |
| 2: OI-weighted funding | Coinglass OR self-aggregated OI×funding | Partial (self-agg free) | ~250 LOC | MATCHES (self-agg) |
| 3: Cross-X basis | 5 venues funding | Partial (Binance only) | ~500 LOC + 4 downloaders | MATCHES (Binance↔Bybit) |
| 4: Regime shift detection | Historical funding + OI | Yes (already in dataset) | ~200 LOC | MATCHES |
| 5: Funding + order-book | Binance L2 depth | No (not integrated) | ~400 LOC | MATCHES (Binance-only) |

**Total Phase 11.4 Track D plugin build:** ~1500 LOC across 5 hypotheses, with selective reduction if any hypothesis proves non-actionable in backtest. Bybit.eu SPOT mandate preserved throughout — the synthetic perp leg runs on an offshore Binance sub-account under the Phase 11.2e BasisTradePlugin precedent.

---

## 8. Latency assumptions

- **Binance → bybit.eu price feed:** ~50ms WebSocket round-trip from Frankfurt (bybit.eu primary region) to Binance Tokyo. Project-realistic for entry signals (not for HFT arbitrage).
- **Bybit.eu → Hyperliquid price feed:** ~200ms round-trip from Frankfurt to Hyperliquid's validator mesh. Project-realistic for signal detection, NOT for execution at Hyperliquid's sub-second cadence.
- **Funding timestamp snapshots:** funding settles at 00:00, 08:00, 16:00 UTC (Binance/Bybit/OKX). The project can pre-position up to 5 minutes before settlement on a 1:10 capital base without giving up edge to HFT desks.

---

## 9. Regulatory notes (MiCAR)

- **bybit.eu SPOT-only:** MiCAR Article 60 permits read-only market data from offshore venues. Project does NOT place perp orders on bybit.eu.
- **Offshore sub-account for synthetic perp leg:** requires KYC on Binance/Bybit/OKX/Hyperliquid separately. The project has historically used a single offshore sub-account (Phase 6) — this should be flagged in Phase 11.4+ scope.
- **dYdX v4 USDC settlement:** USDC is non-MiCAR regulated; not eligible for the EU project's settlement currency.

---

## 10. Open data-feed gaps to flag for Phase 11.4+ planning

1. **No Bybit / OKX / Hyperliquid / dYdX historical funding-rate CSV** in the project's `data/funding/` directory. Need 4 new downloader CLIs (≈ 100 LOC each) mirroring the Binance pattern.
2. **No OI history** beyond Binance mark-price history embedded in CSV. Need 5-venue OI downloader or Coinglass subscription.
3. **No real-time L2 depth** consumer in the SCv1 plugin runtime. Would need a new `OrderBookStreamConsumer` in `packages/exchange`.
4. **No liquidation heatmap** data — Coinglass or Glassnode subscription required.
5. **No Pendle yield curve / dYdX HIP-3 forward-funding data** — fundamental term-structure source is OUT OF SCOPE; use dYdX v4 funding premium history as the most actionable proxy.

All gaps are addressable in Phase 11.4+ with ~2-3 days of producer work. None are FUNDAMENTAL blockers — the data exists and is free or low-cost.