# Phase 11.3 Track C — Perp-DEX Data Feeds

**Track:** C — Perp-DEX microstructure
**Date:** 2026-07-05
**Purpose:** Reference of perp-DEX websocket endpoints, SDK access, capital deployment per alpha hypothesis in `report.md` §3.

---

## §1 — Hyperliquid (primary venue)

### REST endpoints
| Endpoint | URL | Auth | Purpose |
|----------|-----|------|---------|
| Info (read) | `https://api.hyperliquid.xyz/info` | None | meta, l2Book, allMids, recentTrades, candles, fundingHistory, userState, openOrders |
| Exchange (signed actions) | `https://api.hyperliquid.xyz/exchange` | EIP-712 | placeOrder, cancel, modifyOrder, batchModify, updateLeverage, withdraw |

### WebSocket
| Channel | URL | Notes |
|---------|-----|-------|
| Mainnet | `wss://api.hyperliquid.xyz/ws` | ≤10 concurrent subscriptions, ping every 20s, idle close 60s, ≤1000 subscriptions per IP |
| Testnet | `wss://api.hyperliquid-testnet.xyz/ws` | for paper-trading |

### WebSocket subscription types
| Type | Payload | Use |
|------|---------|-----|
| `l2Book` | `{type:"l2Book", coin:"ETH"}` | full L2 book for BBO + depth |
| `allMids` | `{type:"allMids"}` | mid prices for all assets |
| `trades` | `{type:"trades", coin:"BTC"}` | tape |
| `userEvents` | `{type:"userEvents", user:address}` | fills, order updates, account events |
| `userFills` | `{type:"userFills", user:address}` | own fills only |
| `orderUpdates` | `{type:"orderUpdates", user:address}` | own order lifecycle (placement, cancel, modify) |
| `candle` | `{type:"candle", coin:"ETH", interval:"1m"}` | OHLCV |
| `webData2` | `{type:"webData2", user:address}` | frontend portfolio + margin state |
| `bbo` | `{type:"bbo", coin:"BTC"}` | best bid/offer only |
| `activeAssetCtx` | `{type:"activeAssetCtx", coin:"ETH"}` | mark price, oracle, funding, OI |

### SDKs
- **Official:** `pip install hyperliquid-python-sdk` (GitHub: `hyperliquid-dex/hyperliquid-python-sdk`)
- **TypeScript:** `nktkas/hyperliquid`
- **CCXT:** `ccxt/hyperliquid-python` (sync + async)
- **Community:** `hyperliquid-sdk` on PyPI (covers HyperCore + HyperEVM + WS + gRPC)

### Reference strategy constants (from `basic_adding.py`)
- `DEPTH = 0.003` (0.3% inside BBO)
- `ALLOWABLE_DEVIATION = 0.5` (50% of DEPTH before cancel-replace)
- `MAX_POSITION = 1.0` (base asset units)
- `POLL_INTERVAL = 10` seconds
- `ORDER_TIMEOUT = 10000` ms
- `CANCEL_CLEANUP_TIME = 30000` ms

---

## §2 — dYdX v4

### REST endpoints
| Endpoint | URL | Auth |
|----------|-----|------|
| Indexer (read) | `https://indexer.dydx.trade/v4` | None |
| Validator (Cosmos RPC) | `https://dydx-rpc.publicnode.com:443` | None |

### WebSocket
- Indexer WS at `wss://indexer.dydx.trade/v4/ws` for market data (subscriptions: `v4/orderbook`, `v4/trades`, `v4/candles`)
- Order placement is via signed Cosmos transactions to the validator RPC, NOT via REST POST.

### SDKs
- TypeScript: `@dydxprotocol/v4-client-js`
- Python: `dydx-v4-python-client` (community)

### Validator / node setup
- Each validator maintains an in-memory orderbook; running your own node eliminates propagation latency (per dYdX v4 onboarding FAQ).
- Order types: short-term (immediate match) vs stateful (placed in block). **Market makers must use short-term only** (FAQ §4).

---

## §3 — Vertex Protocol

### REST endpoints
- Arbitrum: `https://prod.vertex-protocol-backend.com`
- Sonic / Sei / Base / others: Vertex Edge cross-chain via respective endpoints

### Off-chain sequencer
- Currently centralized at `https://gateway.sei.vertexprotocol.com` (and per-chain equivalent). Plans to decentralize via governance.
- Latency: ~15ms (per Vertex VRTX guide) / 10–30ms (Harmony review)
- Fallback "Slo-Mo Mode" = on-chain AMM-only if sequencer down

### SDKs
- TypeScript: `@vertex-protocol/client`
- Edge: cross-chain order routing via Vertex Edge synchronous orderbook (Arbitrum + Mantle + Sei + Base + Sonic + Abstract + Berachain + Avalanche unified)

---

## §4 — gTrade / Gains Network

### REST endpoints
- Arbitrum: `https://api.gains.trade`
- Polygon: legacy endpoint

### WebSocket
- `wss://api.gains.trade/ws` for trades, PnL updates, vault events

### Vault contracts
- DAI vault on Arbitrum + Polygon
- gETH / gUSDC yield tokens (gTrade v7)

---

## §5 — Cross-venue data feeds needed per hypothesis

### A1 — CrossVenueFundingArbPlugin (RECOMMENDED, MATCHES mandate)
- **Hyperliquid:** `fundingHistory` REST endpoint OR WS `userFunding` channel (1h granularity)
- **Binance Futures:** `https://fapi.binance.com/fapi/v1/fundingRate` (8h granularity, public)
- **Bybit:** `https://api.bybit.com/v5/market/funding/history` (8h)
- **Required tick rate:** hourly for HL; 8-hour aligned for Binance
- **Historical depth:** ≥6 months recommended (BlockEden uses 6-month rolling window)
- **Capital deployment:** $10K total per hypothesis, split $5K leg each, 3× leverage on perp leg (within 1:10 cap), 1× on spot leg
- **SDK:** Hyperliquid Python SDK + ccxt Binance + ccxt Bybit

### A2 — PerpDexMarketMakingPlugin (PARKED, REQUIRES TOKYO CO-LOC)
- **Hyperliquid:** `l2Book` WS (full depth), `orderUpdates` (own queue position), `trades` (fill rate), `userFills` (own adverse selection monitor)
- **Reference SDK constants:** DEPTH=0.3%, ALLOWABLE_DEVIATION=0.5, MAX_POSITION=1.0 base asset
- **Infra requirement:** Tokyo AWS AZ1/AZ2/AZ4 or direct TCP to validator nodes; target <100ms round-trip
- **Capital deployment:** $50K-$500K per market, 5-10× leverage on quote inventory (within 1:10 cap)

### A3 — HLP-equivalent passive vault (PARKED, REQUIRES CAPITAL SCALE)
- **Hyperliquid:** vault contract address `0x5f422` (mainnet); `vaultDetails` REST endpoint for TVL/PnL stream
- **Capital deployment:** $10K-$100K deposit; 4-day lockup after entry/exit
- **Yield sources:** trading fees + liquidation PnL + market-making spread
- **Risk controls:** post-JELLY ADL reforms (March 2025); per-sub-account Liquidator vault cap

### A4 — Oracle-latency front-running (OUTSIDE SCOPE)
- **Hyperliquid:** `activeAssetCtx` WS for mark/index/oracle/funding
- **Sub-3-second tick history:** archive via non-validating node (paper "Level 4 Order Book Data from the Hyperliquid Exchange" by Albers et al. 2026)
- **Capital deployment:** requires institutional scale (>$1M notional per front-run) + validator-level access; not retail-routable

### A5 — gTrade / dYdX MegaVault passive LP (OUTSIDE SCOPE)
- **gTrade:** vault contract addresses per chain; gDAI / gETH / gUSDC yield tokens
- **dYdX MegaVault:** USDC deposit; APR formula `(30d PnL / TVL) × 365/30`
- **Capital deployment:** $5K-$50K deposit; 4-day ramp-out (gTrade) or claim-cycle (dYdX)

---

## §6 — Cross-DEX aggregator endpoints (for execution)

| Aggregator | Endpoint | Pools | Perp DEX coverage |
|------------|----------|-------|--------------------|
| Ranger Finance | `https://api.ranger.finance` | Solana + cross-chain via DeBridge | Drift, Jupiter Perps, Flash, Hyperliquid (cross-chain) |
| Oneliquid | TEE dark-pool + cross-chain bridge | Solana, Base, EVM | multi-venue |
| LiquidView | `https://api.liquidview.app` | 9 perp DEXs | execution cost estimation endpoint |

---

## §7 — Capital deployment matrix

| Hypothesis | Min capital | Recommended | Max capital at 1:10 | Infra requirement |
|------------|-----------|-------------|---------------------|-------------------|
| A1 CrossVenueFundingArb | $5K | $10K | $100K (3× perp + 1× spot) | Retail AWS, REST + WS |
| A2 PerpDexMM | $50K | $200K | $2M (5-10× quote inv) | Tokyo co-loc |
| A3 HLP passive | $1K | $25K | n/a (vault unlevered) | Wallet only |
| A4 Oracle arb | $500K | n/a retail | n/a | Validator-level |
| A5 gTrade/MegaVault | $1K | $10K | n/a | Wallet only |

---

## §8 — Recommended deployment order (Phase 11.4+)

1. **A1 CrossVenueFundingArbPlugin** — single-track 1:10 bybit.eu SCOPE (via Binance/Bybit global for perp leg, bybit.eu spot for hedge leg). Build first; expected +0.5–1.5%/mo envelope.
2. **A2 PerpDexMarketMakingPlugin** — parked behind Tokyo co-loc decision (Phase 12+ scope).
3. **A3 HLP vault deposit** — parked behind capital scale decision (Phase 12+).
4. **A4 + A5** — research-only; not buildable in current 1:10 bybit.eu mandate.

---

## Notes

- **Testnet first:** all venues offer testnet endpoints (Hyperliquid testnet at `*.hyperliquid-testnet.xyz`). Testnet funding rates are not representative of mainnet divergence magnitude; paper-trade with mainnet historical data.
- **Rate limits:** Hyperliquid WS = ≤1000 subscriptions per IP, ≤10 concurrent per connection. Vertex sequencer currently rate-limited at ~15k TPS per chain. Ranger + LiquidView have per-user API rate limits.
- **Auth:** Hyperliquid = EIP-712 wallet signature; dYdX v4 = Cosmos transaction; Vertex = EOA signature; gTrade = EOA signature.
- **Time sync:** funding-rate divergence detection requires <1s clock skew across venues; use NTP.
- **Capital efficiency:** A1 at $10K split is well within retail envelope; A2 at $50K minimum is borderline retail; A3+ requires capital-scale decision.