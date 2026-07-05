# Data Feeds Reference — Track E (Order-Flow / Liquidation Cascade)
## Phase 11.3 Crypto-Native Microstructure Research

**Purpose**: Inventory of all data feeds required to build Phase 11.4+ plugins derived from this track's research. Each feed annotated with: provider, cost, latency, historical depth, schema, and which alpha hypothesis (H1-H5) it supports.

---

## §A. Liquidation Data (PRIMARY feed for cascades)

### A1. Coinglass Aggregated Liquidation History
- **Provider**: Coinglass (coinglass.com)
- **Endpoint**: `GET /api/futures/liquidation/aggregated-history`
- **Schema**: `{ time, aggregated_long_liquidation_usd, aggregated_short_liquidation_usd }` per candle
- **Latency**: aggregated cross-venue in near-real-time (≤1 min for free tier)
- **Historical**: Hobbyist tier 6-day at 1-min interval → Enterprise all-time at daily; Standard tier 90-day at 1-hour, 360-day at 4-hour
- **Cost**: $29/mo (Hobbyist) → $79/mo (Startup) → $299/mo (Standard) → $699/mo (Professional)
- **Free alternative**: coinglass.com website (no API key, manual scrape for research)
- **Use cases**: H3 (CascadeDefensiveOverlay composite), H5 (post-event exhaustion), H1 (proximity pull target)
- **Coverage**: 30+ exchanges including Binance, OKX, Bybit, Bitget, Deribit, BitMEX, dYdX, Hyperliquid, MEXC, HTX
- **Notes**: Free Coinglass UI provides liquidation heatmap visualization (cluster proximity ±1-5%) which is the empirical 82% touch-rate signal source. The heatmap is **model output, not raw data** — it's inferred from public OI + leverage tiers + recent liquidation stream.

### A2. Binance `!forceOrder@arr` WebSocket (per-trade liquidation stream)
- **Provider**: Binance Futures
- **Endpoint**: `wss://fstream.binance.com/ws/!forceOrder@arr`
- **Schema**: `{ "e":"forceOrder", "E":..., "o":{ "s":"BTCUSDT", "S":"BUY"/"SELL", "o":"LIMIT", ... "ap": avg price, "q": qty, ... } }`
- **Latency**: real-time (≤100ms)
- **Historical**: REST `GET /fapi/v1/allForceOrders` with `startTime`/`endTime` (free, last 7 days)
- **Cost**: FREE
- **Use cases**: H4 (cross-exchange divergence detection — Binance-only liquidation cloud)
- **Coverage**: BTCUSDT, ETHUSDT, SOLUSDT perpetuals (and 400+ other pairs)
- **Notes**: The `!` prefix means "all symbols in one stream" — very efficient for detecting cross-symbol contagion patterns.

### A3. Bybit Liquidation Stream
- **Provider**: Bybit
- **Endpoint**: `wss://stream.bybit.com/v5/public/linear` topic `liquidation`
- **Schema**: `{ topic:"liquidation.BTCUSDT", data: { size, price, side, updatedTime, ... } }`
- **Latency**: real-time
- **Historical**: REST `GET /v5/market/recent-trade` (no dedicated liquidation history endpoint)
- **Cost**: FREE
- **Use cases**: H4 (cross-venue detection — when Binance fires and Bybit doesn't = isolated event)

### A4. OKX Liquidation Stream
- **Provider**: OKX
- **Endpoint**: `wss://ws.okx.com:8443/ws/v5/public` channel `liquidations` under `public-channel`
- **Schema**: `{ arg:{ channel:"liquidations", instType:"SWAP" }, data:[[ instId, details, fillTime, ... ]] }`
- **Latency**: real-time
- **Historical**: REST `GET /api/v5/public/liquidation-orders` (limited depth)
- **Cost**: FREE
- **Use cases**: H4 (third leg of cross-venue divergence detection)

### A5. MarketTrace Cross-Exchange Liquidation Tape (visualization + paid API)
- **Provider**: markettrace.ai
- **Endpoint**: Web UI live tape + REST API
- **Coverage**: Binance + Bybit + OKX unified, Hyperliquid reconstructed from on-chain
- **Cost**: paid subscription (no public pricing)
- **Use cases**: H4 implementation reference — MarketTrace is the only vendor that natively fuses the three CEX liquidation streams with cross-venue color coding
- **Notes**: For our Phase 11.4+ build we can re-implement this in ~150 LOC using the three free public streams above.

---

## §B. Open Interest Data

### B1. CoinGlass OI History
- **Provider**: Coinglass
- **Endpoint**: `GET /api/futures/openInterest/ohlc-history`
- **Schema**: `{ time, open, high, low, close, volume }` OI candlesticks
- **Coverage**: 30+ exchanges, BTC/ETH/SOL/500+ pairs
- **Cost**: Hobbyist $29/mo sufficient for daily/4-hour OI history
- **Use cases**: H3 (cascade-defensive composite: OI > 90-day SMA), H5 (post-cascade -25% decline)

### B2. Binance OI WebSocket
- **Provider**: Binance Futures
- **Endpoint**: `wss://fstream.binance.com/ws/<symbol>@openInterest` per symbol, or REST `GET /fapi/v1/openInterest`
- **Latency**: real-time push
- **Historical**: REST only, last 30 days typical
- **Cost**: FREE
- **Use cases**: real-time H3 composite, intraday OI delta detection

### B3. Coinalyze OI Aggregator
- **Provider**: coinalyze.net
- **Coverage**: aggregated OI across multiple exchanges, longer history than per-exchange
- **Cost**: free tier with limits, Pro tier for full history
- **Use cases**: H3 historical backtest validation

---

## §C. Funding Rate Data

### C1. CoinGlass Funding Rate History
- **Endpoint**: `GET /api/futures/fundingRate/ohlc-history` (for OHLC) and `GET /api/futures/fundingRate/history`
- **Coverage**: aggregated + per-exchange
- **Cost**: $29/mo Hobbyist
- **Use cases**: H3 (cascade composite: funding APR > 15% sustained 3+ days), H5 (post-cascade funding reversal)

### C2. Binance Funding Rate
- **Endpoint**: `wss://fstream.binance.com/ws/<symbol>@markPrice` (includes next funding rate estimate) + REST `GET /fapi/v1/fundingRate` for history
- **Schema**: `{ symbol, fundingTime, fundingRate, markPrice }`
- **Latency**: real-time via markPrice stream (predicted next funding rate), 8h settlement via history
- **Cost**: FREE

### C3. Cross-Exchange Funding Rate Aggregation (Bybit/OKX/Bitget)
- **Bybit**: `GET /v5/market/tickers` returns `fundingRate` field
- **OKX**: `GET /api/v5/public/funding-rate` returns current + historical
- **Bitget**: `GET /api/v2/mix/market/ticker` returns `fundingRate`
- **Cost**: FREE
- **Use cases**: H4 (cross-venue funding divergence), Phase 11.2b funding-rate arb

---

## §D. Order Book / L2 Depth Data

### D1. Binance Depth Stream (real-time L2)
- **Endpoint**: `wss://fstream.binance.com/ws/<symbol>@depth20@100ms` (top 20 levels, 100ms refresh) or `<symbol>@depth` (full diff stream)
- **Schema**: `{ bids:[[price, qty],...], asks:[[price, qty],...] }`
- **Latency**: 100ms-1000ms push
- **Historical**: NOT available via free Binance API. Use Coinglass or Tardis.dev
- **Cost**: real-time FREE; historical via Tardis $$$

### D2. OKX L2 Historical (since March 2023)
- **Provider**: OKX
- **Endpoint**: `GET /api/v5/market/books-history` for snapshot history
- **Cost**: FREE for retail (5 req/2s)
- **Coverage**: since March 2023 — sufficient for Phase 11.4+ backtest

### D3. Tardis.dev Historical L2 (paid but best)
- **Provider**: tardis.dev
- **Coverage**: Binance/Bybit/OKX/BitMEX historical incremental L2 since 2019
- **Cost**: ~$50-200/mo depending on data volume
- **Use cases**: H4 backtest (need historical L2 to compute OFI across venues), H1 historical validation

### D4. Coinglass Order Book Snapshots (V4 API)
- **Endpoint**: `GET /api/spot/orderbook/snapshot`, `GET /api/futures/orderbook/snapshot`
- **Coverage**: L2 + L3 depth
- **Cost**: $79/mo Startup and above

---

## §E. Trade Tape (L1 — AggTrades)

### E1. Binance aggTrades (public WebSocket + Vision historical)
- **Real-time**: `wss://fstream.binance.com/ws/<symbol>@aggTrade`
- **Schema**: `{ "e":"aggTrade", "E":..., "s":"BTCUSDT", "a": tradeId, "p": price, "q": qty, "f": firstTradeId, "l": lastTradeId, "T": timestamp, "m": isBuyerMaker }`
- **`m` field is critical**: `isBuyerMaker=true` means taker sold (aggressor is seller). `isBuyerMaker=false` means taker bought.
- **Historical**: FREE via Binance Vision `data.binance.vision` — full monthly zip files of BTCUSDT, ETHUSDT, SOLUSDT aggTrades
- **Cost**: FREE
- **Use cases**: H2 (VPIN computation requires `isBuyerMaker` field to split taker buy vs sell volume per volume bucket), H5 (CVD calculation), H1 (footprint chart per candle)

### E2. Bybit + OKX + Bitget Trade Streams
- Similar structure; for cross-venue OFI in H4 we need all three
- **Cost**: FREE for real-time; historical free but limited to recent

### E3. Coinglass AggTrades History
- 300+ billion raw tick-by-tick records
- 1,500+ TB historical high-frequency
- Available via V4 API Professional and above ($699/mo)

---

## §F. On-Chain Leverage Metrics (for ELR + cross-validation)

### F1. CryptoQuant Estimated Leverage Ratio (ELR)
- **Definition**: `ELR = OI_usd / exchange_reserve_usd`
- **Endpoint**: CryptoQuant API `GET /api/v1/btc/market/estimated-leverage-ratio`
- **Cost**: free for current snapshot; Pro ($49/mo) for historical
- **Use cases**: H3 (cascade-defensive composite threshold: ELR > 0.55)

### F2. CryptoVault / Glassnode Cross-Validation
- **Glassnode**: ELR is computed in "Week On-Chain" reports as part of derivatives section
- **Glassnode Studio**: free tier shows current ELR + limited history
- **Cost**: free for current, Professional $800/mo for full history

### F3. CryptoQuant Exchange Reserves
- Endpoint: `/api/v1/btc/exchange-flows/netflow` (free, current)
- Used in ELR denominator

---

## §G. CVD (Cumulative Volume Delta) — Computable, no separate feed

### G1. CVD from aggTrades (computed locally)
- **Algorithm**: `CVD(t) = CVD(t-1) + Σ(volume × sign)` where sign = +1 if `isBuyerMaker=false` (taker buy), -1 if `isBuyerMaker=true`
- **Per-symbol**: compute 4h or 1h or 5min trailing CVD
- **Storage**: ~10MB/day per symbol for full aggTrade stream
- **Use cases**: H5 (post-cascade exhaustion via CVD divergence from price), H2 (VPIN volume decomposition)

### G2. CVD from Sharpe.ai or MarketTrace
- Vendor-computed pre-built CVD time-series
- Sharpe.ai: paid; MarketTrace: aggregated

---

## §H. Cross-Asset Contagion Data

### H1. Cross-margin Position Data (largely unavailable)
- **Problem**: cross-margin is venue-specific; exchanges don't expose position-by-account cross-margin status
- **Workaround**: derive contagion lag empirically from minute-resolution liquidation stream cross-correlation (Anatomy of Oct 10-11 paper approach)
- **Cost**: compute-only

### H2. DCC-GARCH / Multivariate Realized Volatility
- Computable from minute-resolution close prices across BTC/ETH/SOL
- Data source: Binance/OKX kline_1m (free)
- **Use cases**: H4 (cross-asset contagion modeling), H3 (regime detection enhancement)

---

## §I. Academic / Practitioner Source Repository

### I1. Brunnermeier-Pedersen Liquidity Spiral Models
- Source: Princeton Markus Brunnermeier research page
- URL: https://www.princeton.edu/~markus/research/papers/liquidity.pdf
- Cost: FREE academic access
- Use: theoretical justification for cascade overlay design

### I2. Alperen-Unal 2024 Thesis
- Source: Politecnico Milano master's thesis on VeloData
- GitHub: https://github.com/Alperen-Unal/Early-Detection-and-Prediction-of-Liquidation-Cascades-in-Cryptocurrency-Markets
- Cost: FREE (GitHub repo with code + thesis PDF)
- Use: reference architecture for Plugin E1 cascade-defensive overlay (GARCH+LSTM hybrid)

### I3. MEXC Research Substack / Blog
- https://www.mexc.com/news/1002105
- Free; provides VPIN alpha decay empirical data + Python implementation
- Use: reference for Plugin E4 VPIN flow direction implementation

### I4. Glassnode Insights Archive (2020-2025)
- https://insights.glassnode.com + https://research.glassnode.com
- Free summaries; Pro for full PDF reports
- Use: cascade chronology validation, cross-validation of pre-cascade OI/ELR/funding readings

---

## §J. Vendor Comparison Summary (Build vs Buy)

| Capability | Free path | Paid path | Plugin recommendation |
|------------|-----------|-----------|----------------------|
| Liquidation stream (real-time) | Binance/Bybit/OKX free WS | MarketTrace $ | E1, E4: build (free) |
| Liquidation history | Binance REST 7-day | Coinglass $29+/mo | E1, E5: build (free) |
| Liquidation heatmap model | Manual scrape Coinglass UI | Coinglass API $29+/mo | E1: Coinglass $29/mo |
| OI history | Per-exchange 30-day | Coinglass $29+/mo | E1, E5: Coinglass $29/mo |
| Funding rate history | Per-exchange free | Coinglass $29+/mo | E1, E5: Coinglass $29/mo |
| L2 order book history | OKX since 2023 (free) | Tardis $50+/mo | E4: build on OKX free |
| Cross-venue funding arb | Per-exchange free | Coinalyze $ | E2: build (free) |
| ELR | CryptoQuant current free | CryptoQuant Pro $49+/mo | E1: Pro for historical |
| CVD computation | aggTrades free | Sharpe.ai $ | E5: build on aggTrades |

**Total minimum spend for Phase 11.4+ Track E implementation**:
- Hobbyist: Coinglass $29/mo + CryptoQuant Pro $49/mo = **$78/mo**
- Sufficient for: Plugin E1 (CascadeDefensiveOverlay), Plugin E4 (VpinFlowDirection), Plugin E5 (CascadeExhaustionReversal)
- For Plugin E2 (CrossExchangeFundingArb): free path only, but cross-venue aggregation needs building

---

## §K. Real-time Latency Targets

For each plugin, what data latency is required?

| Plugin | Min acceptable latency | Why |
|--------|------------------------|-----|
| E1 CascadeDefensiveOverlay | 1-5 min | Composite of OI + ELR + funding + cluster proximity — slow-moving signals; 1-min refresh sufficient |
| E2 CrossExchangeFundingArb | 1 sec | Funding-rate arb is competitive; settlement is 8h but entry/exit must catch ephemeral divergence |
| E3 FootprintChartVisualizer | 100 ms | Real-time trader UI requirement |
| E4 VpinFlowDirection | 1 min | VPIN bucket size = daily volume / 50 → ~30 min per bucket on BTC; 1-min refresh overkill but needed for flow_sign |
| E5 CascadeExhaustionReversal | 1 min | Post-event contrarian; OI delta + CVD divergence computed at 1-min granularity |

**Latency infrastructure**: Phase 11.4+ should run a single Node.js / Bun process polling Binance/OKX/Bybit WebSockets + REST Coinglass 1-min cadence. Total budget: <$5/mo for cloud VPS (Hetzner / OVH) at this load.

---

## §L. Schema Reference for Cascade-Defensive Overlay (Plugin E1) MVP

```typescript
// Plugin E1 cascade-defensive-overlay — minimum data interface
type CascadeDefensiveState = {
  timestamp: number;            // ms epoch
  symbol: 'BTCUSDT' | 'ETHUSDT' | 'SOLUSDT';
  compositeRiskScore: number;   // 0-100
  components: {
    oiVsSmaRatio: number;       // OI / OI-90d-SMA, threshold > 1.0 = elevated
    elrCurrent: number;         // CryptoQuant snapshot, threshold > 0.55 = elevated
    fundingAprSustained: number; // 3-day rolling APR, threshold > 15% = elevated
    liquidationClusterProximity1pct: number; // Coinglass cluster density within ±1%
    liquidationIntensity24h: number; // daily liq / OI, threshold > 5% = extreme
  };
  recommendedLeverage: 1 | 3 | 5 | 10; // discrete scaling
  triggeredAt: number;          // ms epoch when last scale-down occurred
};

// Composite calculation (suggested weights from Amberdata + Axel Adler empirical):
// riskScore = w1*oiVsSmaRatio_normalized 
//           + w2*elr_normalized 
//           + w3*fundingApr_normalized 
//           + w4*clusterProximity_normalized 
//           + w5*liqIntensity_normalized
// where wi = 0.20 each, normalization = z-score over 90-day history

// Trigger logic:
//   riskScore < 30 → leverage 10 (no override)
//   30 ≤ riskScore < 50 → leverage 5
//   50 ≤ riskScore < 70 → leverage 3
//   riskScore ≥ 70 → leverage 1 (cash equivalent)
// Trigger at composite threshold 50+ reduces effective book leverage to 3:1
// which protects against the median historical cascade DD (typically -25% at 10:1, becomes -7.5% at 3:1)
```

This MVP is buildable in ~250 LOC on the existing Phase 10G signal-bus architecture.

---

## §M. Compliance Notes for bybit.eu

- **bybit.eu is MiCAR EU spot-only** — no perp trading directly. Our Track E plugins are technically tradable on Binance/OKX/Bybit perps (not bybit.eu).
- **Workaround A**: route via Binance/OKX/Bybit sub-accounts (the user already has these for Phase 11.2b cross-X arb).
- **Workaround B**: implement as a **signal-only plugin** that informs the bybit.eu book (e.g., scale down spot-book directional exposure when cascade risk > 50, even though there's no perp position to scale).
- **Recommendation**: Phase 11.4+ Track E plugins should support BOTH modes — perp-routable when capital is allocated, signal-only when bybit.eu is the only venue.

This is consistent with how Phase 11.2a RegimeDetector is implemented (defensive overlay applicable to any venue).