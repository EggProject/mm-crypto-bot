# Data Feeds — Phase 11.5 Track D (MEV & Liquidation-Hunt Microstructure on Perp-DEX)

> **Purpose:** enumerate the data sources required to build the 6 alpha hypotheses in `REPORT.md §3` (E1–E6). Each entry lists the REST endpoint / websocket channel / CSV file with a 1-line use note. Applicability to **1:10 bybit.eu SPOT-only mandate (MiCAR)** is flagged at the end of each hypothesis section.
>
> **Doctrine:** crypto-native only. The project runs **bybit.eu SPOT** (MiCAR EU, no margin futures). All perp-side data is consumed READ-ONLY via REST / websockets — the project does NOT place perp orders on bybit.eu. The implied perp leg is synthetic, executed on Binance/OKX/Bybit global/Hyperliquid via API on a separate risk-managed offshore sub-account (Phase 11.2e `BasisTradePlugin` precedent: Binance perp short + bybit.eu SPOT long).
>
> **Note on MiCAR:** bybit.eu SPOT-only is a HARD constraint. Reading data from offshore perp venues (Binance, OKX, Bybit.com, Hyperliquid, dYdX) is **legal under MiCAR Article 60** (market-data-only APIs) — the project already does this in Phase 6/8/11.2e for the funding-rate data download. Executing perp orders requires an offshore sub-account; the project documented this in Phase 6 (the "cross-exchange synthetic" model). The perp leg for Track D plugin candidates (E1, E5 signals) runs on Hyperliquid itself OR on Binance global (the cheapest retail route as of 2026).

---

## 1. Real-time liquidation event feeds (the E1 + E5 alpha core)

### 1.1 0xArchive — Hyperliquid Liquidation API
- **Endpoint (REST):** `GET https://api.0xarchive.io/liquidations/hyperliquid?coin=BTC&since=2025-12-01&limit=1000` (hypothetical; check docs for current schema)
- **Endpoint (WebSocket):** `wss://stream.0xarchive.io/v1/liquidations?venue=hyperliquid` — emits liquidation events in real time as `LiquidatedPosition {coin, wallet, side, notionalUSD, markPrice, liquidationType, eventID}`.
- **Project status:** NOT yet integrated.
- **Significance:** the highest-value single feed for E1 + E5; covers 150+ perp symbols since Dec 2025; cascade reconstruction built-in.
- **Build effort:** ~150 LOC.

### 1.2 GoldRush (Covalent) — Liquidation Cascade Map
- **Endpoint:** `GET https://api.covalenthq.com/v1/hyperliquid-mainnet/events/liquidations/?key={API_KEY}&page-size=100` (chain ID 998)
- **Endpoint (WebSocket):** via QuickNode Streams subscription on event signature `0x{EventSig}` for `HyperliquidEvent::Liquidated`
- **Web:** `https://goldrush.dev/guides/building-a-real-time-hyperliquid-liquidation-monitor-part-3/` (tutorial with WS + Python + gRPC)
- **Schema:** `{blockNumber, txHash, liquidator, liquidated, positionSize, notionalUSD, markPrice, collateralSeized}` + cascade-chain reconstruction in their Pentagon product.
- **Project status:** NOT yet integrated. Pricing: zero-rate-limit free tier available.

### 1.3 CoinGlass — Hyperliquid Liquidation Map
- **Endpoint (REST):** `GET https://open-api-v4.coinglass.com/api/hyperliquid/liquidation-map?symbol=BTC&range=1d` (Coinglass Pro API key required; subscription ~$29+/mo).
- **Web:** `https://www.coinglass.com/hyperliquid-liquidation-map` (free, browser-based).
- **Schema:** `{price: number[], liquidationLongNotional: number[], liquidationShortNotional: number[], realPositions: boolean}` — only positions > $1M from real liquidation levels.
- **Project status:** NOT yet integrated. Coinglass Pro subscription required.

### 1.4 Apify — Hyperliquid Liquidation Radar
- **Endpoint:** `https://apify.com/mrlarryjohnson/hyperliquid-liquidation-radar/api/openapi` (Apify API key, per-event billing)
- **Schema:** scored + deduplicated liquidation feed — coin, side liquidated, total notional, mark price, liquidated wallet, cascade flag, OI + funding context.
- **Project status:** NOT yet integrated. Alternative to 0xArchive for deduplicated signal.

### 1.5 HypurrScan / purrsec.com — Hyperliquid block explorers
- **Endpoint (REST):** `GET https://api.hypurrscan.io/api/v1/liquidations?coin=BTC&since=...`
- **Web:** `https://hypurrscan.io`
- **Schema:** on-chain liquidation events
- **Project status:** NOT yet integrated. Free public read.

### 1.6 Allium — Hyperliquid Liquidations Methodology
- **Endpoint:** via Allium API (Project not integrated)
- **Web:** `https://hyperliquid.allium.so/liquidations` (free, browser-based)
- **Schema:** `liquidated` field on `hyperliquid.raw.fills` table
- **Project status:** NOT yet integrated. Requires Allium subscription.

### 1.7 Herdvibe (Korean tracker)
- **Endpoint (no public API documented):** `https://herdvibe.com/43` (Korean top-500 trader tracker)
- **Refresh rate:** 30 s
- **Use:** reference UI for whale positions + funding + OI tabs; not API-accessible in standard sense

### 1.8 TraderMap (Korean tracker)
- **Endpoint:** `https://tradermap.io/ko/liquidation-map` (Korean on-chain liquidation map)
- **Schema:** real liquidation positions from Hyperliquid L1 + synthetic OI from Binance/Bybit/OKX/BitMEX
- **Refresh rate:** 30 s typical

---

## 2. Order-book depth feeds (E1 + E5 hot path)

### 2.1 Hyperliquid L2 Depth (WebSocket)
- **Endpoint:** `wss://api.hyperliquid.xyz/ws` subscribe `{"method":"subscribe","subscription":{"type":"l2Book","coin":"BTC"}}`
- **Schema:** `{coin, levels: [[{px, sz, n}], ...], time}` — 20-level depth × 100ms refresh typical
- **Project status:** NOT yet integrated.
- **Significance:** the most critical feed for E1 cascade detection — order book asymmetry tells you where the liq-driven sell will land.

### 2.2 Hyperliquid Trades (WebSocket)
- **Endpoint:** `wss://api.hyperliquid.xyz/ws` subscribe `{"method":"subscribe","subscription":{"type":"trades","coin":"BTC"}}`
- **Schema:** `{coin, side, px, sz, hash, time, tid, users: [maker, taker]}`
- **Project status:** NOT yet integrated. Used for cascade-detection (large trade clusters signal walk-down).

### 2.3 Hyperliquid ActiveAssetCtx (WebSocket)
- **Endpoint:** `wss://api.hyperliquid.xyz/ws` subscribe `{"method":"subscribe","subscription":{"type":"activeAssetCtx","coin":"BTC"}}`
- **Schema:** `{coin, ctx: {funding, openInterest, prevDayPx, premium, markPx, midPx, oraclePx}}`
- **Project status:** NOT yet integrated. Critical for E4 funding-rate snap-back detection.

### 2.4 Hyperliquid allMids
- **Endpoint:** `wss://api.hyperliquid.xyz/ws` subscribe `{"method":"subscribe","subscription":{"type":"allMids"}}`
- **Schema:** `{mids: {BTC: "65000", ETH: "3500", ...}}` — mid price for every perp
- **Project status:** NOT yet integrated. Used for spot-DEX cross-pair comparisons (E3).

### 2.5 Hyperliquid userFills
- **Endpoint:** `POST https://api.hyperliquid.xyz/info` body `{"type":"userFills","user":"0x..."}` — requires EIP-712 signed authentication
- **Schema:** `{fills: [{coin, side, px, sz, fee, time, closedPnl, hash, tid, ...}]}`
- **Project status:** NOT yet integrated. Used for cluster detection (E6 — track Smart Money trader's fills).

---

## 3. Funding-rate + OI feeds (E4 + E5)

### 3.1 Hyperliquid Funding History (REST)
- **Endpoint:** `POST https://api.hyperliquid.xyz/info` body `{"type":"fundingHistory","coin":"BTC","startTime":<ms>}`
- **Schema:** `{[coin]: [{time, fundingRate, premium}]}` — hourly settlement
- **Project status:** same as Phase 11.3 Track D plugin, NOT yet integrated for Hyperliquid-specific.

### 3.2 CoinGlass Aggregated Funding (Multi-venue)
- **Endpoint:** `GET https://open-api-v4.coinglass.com/api/futures/funding-rate/oi-weight-history?exchange=Hyperliquid&symbol=BTCUSDT&interval=1h&startTime=...`
- **Schema:** OI-weighted funding OHLC across all venues
- **Significance:** the project-critical feed for E4 — let us detect when Hyperliquid funding diverges from OI-weighted market consensus.
- **Project status:** NOT yet integrated. Coinglass Pro subscription required.

### 3.3 Hyperliquid OI (REST)
- **Endpoint:** `POST https://api.hyperliquid.xyz/info` body `{"type":"metaAndAssetCtxs"}`
- **Schema:** `assetCtxs: [{funding, openInterest, prevDayPx, premium, markPx, midPx, oraclePx}]` for every asset
- **Refresh:** every block (~2s)
- **Significance:** the canonical real-time OI per asset on Hyperliquid. Critical for E5 OI-drop signature detection.

### 3.4 CoinGlass Hyperliquid-specific OI (REST)
- **Endpoint:** `GET https://open-api-v4.coinglass.com/api/hyperliquid/open-interest?symbol=BTC&interval=5m&startTime=...`
- **Project status:** NOT yet integrated.

### 3.5 Binance Funding Rate (REST) — already integrated Phase 6/11.1/11.2e
- **Endpoint:** `GET https://fapi.binance.com/fapi/v1/fundingRate?symbol=BTCUSDT&startTime=...&endTime=...&limit=1000`
- **Schema:** `{fundingTime, symbol, fundingRate, markPrice}`
- **Project status:** INTEGRATED in `packages/backtest-tools/src/cli/download-funding-rates.ts`
- **Use:** baseline funding-rate feed for E4 cross-venue comparison.

---

## 4. Wallet-cluster + smart-money feeds (E6)

### 4.1 Nansen API — Perp Positions + Smart Money
- **Endpoint:** `GET https://api.nansen.ai/api/v1/profiler/perp-positions?address=0x...&chain=hyperliquid`
- **Endpoint:** `GET https://api.nansen.ai/api/v1/smart-money/perp-trades?since=24h`
- **Endpoint:** `GET https://api.nansen.ai/api/v1/token-god-mode/perp-positions?token=BTC&chain=hyperliquid`
- **Schema:** `{positions: [{wallet, token, side, leverage, entryPrice, liqPrice, unrealizedPnl}]}`
- **Significance:** the canonical smart-money perp-DEX position feed since Dec 2025 Nansen API endpoints live (per Nansen X post)
- **Build effort:** ~200 LOC + Nansen subscription ($129+/mo Pro tier)
- **Project status:** NOT yet integrated for perp-DEX specifically; Phase 11.2 partial integration exists for spot.

### 4.2 HyperTracker API
- **Endpoint:** `GET https://api.hypertracker.io/v1/wallets/{address}/positions` (paid tier)
- **Web:** `https://hypertracker.io`
- **Schema:** wallet positions + PnL + funding payments + trade history
- **Build effort:** ~150 LOC + subscription

### 4.3 Apify Hyperliquid Scraper (Zhorex)
- **Endpoint:** `https://apify.com/zhorex/hyperliquid-scraper` — run-mode leaderboard / wallet positions / vault details / market overview
- **Schema:** `{leaderboard: [{wallet, pnl, winRate, ...}], positions: [...], vault: {...}, markets: {...}}`
- **Build effort:** ~200 LOC + Apify credit billing
- **Project status:** NOT yet integrated. Free to use up to ~$5/mo credit.

### 4.4 Allium Hyperliquid + HyperEVM
- **Endpoint:** via Allium SQL API (Snowflake-compatible)
- **Schema:** `hyperliquid.raw.fills`, `hyperevm.raw.events` tables with full history
- **Build effort:** ~300 LOC + Allium subscription ($99+/mo)
- **Project status:** NOT yet integrated.

### 4.5 Lookonchain (Twitter + Web)
- **Endpoint:** manual + Twitter API integration
- **Web:** `https://lookonchain.com`
- **Schema:** free-form event narratives (e.g., "Abraxas Capital 10x short BTC/ETH/SOL on Hyperliquid, hedged spot, $13M profit realized")
- **Build effort:** ~100 LOC + X API scraping
- **Use:** E6 cluster-detection seed; needs to be combined with Nansen or HypurrScan verification

### 4.6 Onchain Lens (Odaily/PANews; Twitter + Web)
- **Endpoint:** `@Onchain Lens` X account
- **Use:** same as Lookonchain — high-quality wallet clustering intel

### 4.7 Bubblemaps × Arkham Cross-reference (for cluster intelligence)
- **Endpoint (Bubblemaps):** free onchain graph visualization
- **Endpoint (Arkham):** `GET https://api.arkm.com/api/v1/address/{address}` (requires Pro)
- **Use:** E6 cluster identification via Magic Nodes + Time Travel (Bubblemaps) + entity labels (Arkham)

---

## 5. Macro / cross-venue context feeds (E4 helpers)

### 5.1 Bitcoin / Ethereum price feeds (Binance WS — already integrated)
- **Endpoint:** `wss://fstream.binance.com/ws/btcusdt@markPrice@1s`
- **Schema:** `{e, E, s, p, r, T}` mark price + funding rate per second
- **Project status:** NOT integrated at SCv1 plugin level; Phase 6 partial integration in backtest-tools
- **Significance:** E4 + E5 cross-venue mark-price comparison

### 5.2 CoinGlass Aggregated OI (Multi-venue)
- **Endpoint:** `GET https://open-api-v4.coinglass.com/api/futures/open-interest/aggregated-history?symbol=BTC&interval=5m&startTime=...`
- **Schema:** aggregated OI across all venues including Hyperliquid
- **Project status:** NOT yet integrated.

### 5.3 Block Scholes Daily Derivatives Reports
- **Endpoint:** scraping `https://www.blockscholes.com/research` (HTML)
- **Use:** reference report for funding rate + basis narrative

### 5.4 Galaxy Research + BitMEX State-of-Perps
- **Free research PDFs** published periodically with deep analytics
- **Use:** macro context for cascade-window detection

---

## 6. Historical liquidation CSV (for backtest)

| Source | Coverage | Format | Access | Cost |
|--------|----------|--------|--------|------|
| 0xArchive | Dec 2025+ | JSON via API | https://0xarchive.io/blog/hyperliquid-liquidations-data | free for last 30 days |
| CoinGlass | 2024+ per venue | CSV via dashboard | https://www.coinglass.com/hyperliquid-liquidation-map | Pro $29+/mo |
| Allium SQL | 2024+ | SQL Snowflake | Allium subscription | $99+/mo |
| Hyperliquid historical fills (raw on-chain) | full chain | parquet via Allium / Dune | Allium / Dune | free (Dune) / Allium paid |
| SSRN Two-Regime paper figures (Oct 10 2025) | Oct 10 2025 snapshot | static PDF | https://papers.ssrn.com/sol3/Delivery.cfm/6636998.pdf | free |
| ArXiv ADL paper (Oct 10 2025 ADL numbers) | Oct 10 2025 snapshot | static PDF | https://arxiv.org/abs/2602.15182 | free |

---

## 7. Hypothesis-to-feed mapping

### Hypothesis E1 — Tick-level liquidation cascade detection (15s-5min pre-mining)
- **Required feeds:**
  - `0xArchive` WS liquidation events (§1.1) — PRIMARY
  - Hyperliquid `trades` WS (§2.2) + `l2Book` (§2.1) — order book confirmation
  - CoinGlass liquidation map (§1.3) — context
  - Hyperliquid `userFills` (§2.5) — own-trade confirmation
- **Project status:** None integrated. Build effort: ~400 LOC including 0xArchive WS client + cascade detector.
- **Verdict:** **MATCHES mandate**. The data is free or low-cost (0xArchive free, Hyperliquid WS free, CoinGlass $29+/mo Pro).

### Hypothesis E2 — Pre-liquidation wallet sniffing
- **Required feeds:**
  - Nansen Perp Positions + Smart Money (§4.1) — wallet-level liq_distance + smart-money labels
  - HyperTracker (§4.2) — public wallet tracking
  - HypurrScan / Apify / Allium (§1.5, 4.3, 4.4) — historical positions
  - Lookonchain Twitter (§4.5) — real-time event signal
- **Project status:** Nansen partly integrated (Phase 11.2 spot only); perp-DEX extension needed.
- **Verdict:** **MATCHES mandate** at the read-only signal layer.

### Hypothesis E3 — Cross-pair atomic arbitrage (searcher-style)
- **Required feeds:**
  - Hyperliquid `l2Book` per pair (§2.1) — same-venue perp+spot differential
  - Hyperliquid `allMids` (§2.4) — cross-asset reference
  - HyperEVM DEX pool state via Quickswap/Hyperswap RPC — for cross-pair AMM arb on HyperEVM
  - Pyth Lazer oracle — for off-venue comparison (sub-100ms)
- **Project status:** None integrated. Build effort: ~600-800 LOC including WS + signing + simulation.
- **Verdict:** **REQUIRES offshore sub-account** for execution; partial mandate match for the read-only detection layer.

### Hypothesis E4 — Funding-rate snap-back + forced deleveraging MEV
- **Required feeds:**
  - Binance funding history (§3.5) — already integrated
  - Hyperliquid funding history (§3.1) — REST hourly
  - CoinGlass aggregated funding (§3.2) — OI-weighted cross-venue
  - CoinGecko / Block Scholes / Galaxy research (§5) — macro context
  - Hyperliquid `activeAssetCtx` WS (§2.3) — real-time funding + OI
- **Project status:** Binance integrated. Hyperliquid funding + aggregated cross-venue not yet.
- **Verdict:** **MATCHES mandate**. The read-only layer is straightforward; execution via Phase 11.2e BasisTradePlugin offshore sub-account.

### Hypothesis E5 — OI liquidation spirals + paper-tiger walls
- **Required feeds:**
  - Hyperliquid OI live (§3.3) — `metaAndAssetCtxs` REST + `activeAssetCtx` WS
  - CoinGlass Hyperliquid OI (§3.4) — historical 5m granularity
  - CoinGlass aggregated OI (§5.2) — cross-venue context
  - 0xArchive liquidation events (§1.1) — confirm cascade
- **Project status:** None integrated. Build effort: ~300 LOC.
- **Verdict:** **MATCHES mandate**. Read-only signal layer; existing Phase 11.2a RegimeDetector can be extended.

### Hypothesis E6 — Position-builder wallet cluster detection
- **Required feeds:**
  - Nansen Smart Money perp-trades (§4.1) — cluster formation signal
  - Allium SQL on `hyperliquid.raw.fills` (§4.4) — cluster detection via queryable SQL
  - Bubblemaps + Arkham cross-reference (§4.7) — cluster identification
  - HyperTracker multi-address tracking (§4.2) — anchor real-time updates
  - Lookonchain / Onchain Lens narratives (§4.5, 4.6) — seed smart-money lists
- **Project status:** Nansen partly integrated (Phase 11.2 spot only). Perp-DEX extension needed.
- **Verdict:** **MATCHES mandate** at the read-only signal layer.

---

## 8. 1:10 bybit.eu applicability summary

| Hypothesis | Required data feeds | Available now? | Build effort | Mandate verdict |
|-----------|---------------------|----------------|--------------|-----------------|
| E1: Tick cascade | 0xArchive + HL WS + CoinGlass | Partial (HL WS free, CoinGlass paid) | ~400 LOC | MATCHES (read-only) |
| E2: Wallet sniffing | Nansen + HyperTracker + Lookonchain | Nansen partial | ~250 LOC | MATCHES (read-only) |
| E3: Cross-pair arb | HL l2Book + HyperEVM RPC + Pyth | Partial (HL WS free, RPC free) | ~700 LOC | PARTIAL (REQUIRES offshore for execution) |
| E4: Funding snap-back | Binance + HL funding + CoinGlass agg | Partial (Binance already in) | ~300 LOC | MATCHES (via Phase 11.2e extend) |
| E5: OI cascade | HL OI live + CoinGlass HL OI | Partial (HL OI free, CoinGlass paid) | ~250 LOC | MATCHES (read-only) |
| E6: Cluster detection | Nansen + Allium + Bubblemaps + Arkham | Nansen partial | ~400 LOC | MATCHES (read-only) |

**Total Phase 11.5 Track D plugin build:** ~2300 LOC across 6 hypotheses (E1 = `PerpDexLiquidationSignalsPlugin` is the priority). Selective reduction if any hypothesis proves non-actionable in backtest.

**bybit.eu SPOT mandate preserved throughout** — the synthetic perp leg runs on an offshore Binance/Hyperliquid sub-account under the Phase 11.2e BasisTradePlugin precedent.

---

## 9. Latency assumptions

- **bybit.eu Frankfurt → Hyperliquid WS:** ~150-250ms round-trip (Frankfurt primary region to Hyperliquid's validator mesh in Tokyo). Project-realistic for **detection signals** (E1, E2, E5, E6), NOT for **execution** at Hyperliquid's sub-second liquidation cadence. Specifically, the 15-90 second pre-cascade signal is well within reach.
- **bybit.eu → Binance WS:** ~50-100ms round-trip from Frankfurt to Binance Tokyo. Realistic for E4 funding-rate detection (5-min granularity is fine).
- **Funding timestamp snapshots:** Hyperliquid = 24 settlements/day (hourly); Binance/Bybit/OKX = 3 settlements/day (8h). Project can pre-position up to 30-90 minutes before settlement on retail infra.
- **Cascade event window:** 12 seconds (Oct 10 2025) to ~5 minutes (most documented cascades). 0xArchive + HypurrScan provide sub-second event recording.

---

## 10. Regulatory notes (MiCAR)

- **bybit.eu SPOT-only:** MiCAR Article 60 permits read-only market data from offshore venues. Project does NOT place perp orders on bybit.eu.
- **Offshore sub-account for synthetic perp leg:** requires KYC on Binance/Bybit.com/Hyperliquid separately. The project has historically used a single offshore sub-account (Phase 6); for Track D, this should be flagged in Phase 11.5+ scope.
- **dYdX v4 USDC settlement:** USDC is non-MiCAR regulated; not eligible for the EU project's settlement currency (relevant only for direct dYdX v4 subaccount, which is out of scope).

---

## 11. Cost summary

| Service | Monthly cost | Coverage |
|---------|-------------|----------|
| 0xArchive API free tier | $0 | Live liquidation feed (basic) |
| 0xArchive paid tier | $99+/mo | Cascade reconstruction + OI context |
| HypurrScan + Apify (free credit) | $0-5/mo | Liquidation radar + position scraper |
| CoinGlass Pro | $29+/mo | All-venue aggregated funding + OI + liquidation heatmap |
| GoldRush (Covalent) free | $0 | REST liquidation events |
| GoldRush (Covalent) Pro | $99+/mo | Pentagon product with cascade-reconstruction |
| Nansen Pro | $129+/mo | Smart Money + Perp Positions + entity labels |
| Allium SQL | $99+/mo | Hyperliquid raw fills SQL |
| HyperTracker Pro | $49+/mo | Multi-wallet alerts + historical |
| Arkham Intel | $99+/mo | Entity deanonymization + cluster intel |
| Lookonchain | $0 (free X scraping) | Event-narrative intel |
| Total max budget | ~$700/mo | Full depth |

Realistic Phase 11.5 budget: $250-350/mo for E1 + E4 + E5 + E6 read-only (0xArchive free + CoinGlass Pro + Nansen Pro + Allium SQL).

---

## 12. Open data-feed gaps to flag for Phase 11.6+ planning

1. **No aggregated liquidation heatmap × OI × cluster signal in one feed.** Combinations must be computed project-side via WS polling or via the Covalent GoldRush Pentagon product.
2. **No first-party ACCESS to ARKM/Bubblemaps real-time cluster detection.** Workflow requires manual export + project-side ingestion.
3. **No historical pre-Dec 2025 liquidation data on Hyperliquid.** The on-chain history exists (via Dune Allium) but is not yet productized.
4. **No real-time HyperEVM event subscription at the project.** QuickNode Streams or Dwellir gRPC closes this gap (~300 LOC).
5. **No free/cheap cluster formation detection at scale.** Nansen is the cheapest path; if Nansen budget is constrained, the cluster hypothesis (E6) becomes deprioritized.
6. **No "smart-money trade" signal from Hyperliquid's own order-book print stream.** Would require reconstructing "taker side" attribution per trade via the Hyperliquid WS `trades` `users` field — possible project-side but not yet OOTB.

All gaps are addressable in Phase 11.5+ with ~2-3 weeks of producer work. None are FUNDAMENTAL blockers — the data exists and most is free or low-cost.
