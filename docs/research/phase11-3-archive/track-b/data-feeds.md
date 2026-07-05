# Data Feeds — Phase 11.3 Track B (On-Chain Alpha)

For each alpha hypothesis, the required data feeds, subscription tier, and 1:10 bybit.eu applicability verdict.

---

## H1 — StablecoinNetflowPlugin (RANK #1, MATCHES mandate)

**Signal:** USDC/USDT net-inflow into CEX hotspots (Binance/Bybit/OKX) ≥$100M/day AND ≥3 consecutive days AND BTC exchange netflow < 0 over the same window.

| Feed | What it provides | Source | Subscription tier | Free alternative |
|------|------------------|--------|-------------------|------------------|
| USDC ERC-20 netflow (CEX addresses) | Daily inflow/outflow per CEX | CryptoQuant Exchange Flows API | CryptoQuant Pro $49/mo (entry tier) OR CryptoQuant Expert $449/mo (full historical) | Dune query joining Etherscan `Transfer` events to Nansen-labeled CEX addresses (~2-4h lag, no historical >2yr) |
| USDT TRC-20 netflow (Tron) | Daily inflow/outflow per CEX | CryptoQuant OR TronScan + custom parser | Same as above OR TronScan free API | Direct TronScan `TransferContract` events — free but needs custom indexing |
| BTC exchange netflow (cross-exchange) | Daily netflow of BTC across all tracked CEX | CryptoQuant Exchange Netflow Total | CryptoQuant Pro $49/mo | Glassnode Studio free tier shows all-exchange 30-day MA |
| BTC price (OHLCV daily) | Trigger window verification | bybit.eu historical feed (already in repo) | FREE | — |

**Estimated monthly data cost: $49/mo (CryptoQuant Pro) — fits 1:10 retail budget.**

**Glassnode Studio alternative (cheapest):** Free tier shows 30-day MA exchange netflow, sufficient for the BTC-cross-condition check. USDC/USDT detail requires Pro ($29/mo) at minimum.

**Phase 11.4+ plugin data interface sketch:**
```ts
interface StablecoinNetflowInput {
  cexAddresses: { binance: string[]; bybit: string[]; okx: string[] };  // Nansen-labeled
  windowDays: 3;
  thresholdUsd: 100_000_000;
}
// Daily fetch: aggregate Transfer events to cexAddresses for USDC ERC-20 + USDT TRC-20
// Trigger fires when 3-day rolling sum ≥ threshold AND BTC exchange netflow < 0 over same window
// Output: SizingSignal { direction: 'long'; size: leverage-1:10; confidence: 0.7-0.9 }
```

---

## H2 — SOPRCapitulationPlugin (RANK #2, MATCHES mandate)

**Signal:** BOTH LTH-SOPR < 1.0 AND STH-SOPR < 1.0 for 3+ consecutive days AND 30-day BTC return < -15%.

| Feed | What it provides | Source | Subscription tier | Free alternative |
|------|------------------|--------|-------------------|------------------|
| LTH-SOPR daily | Spent UTXOs ≥155 days, profit ratio | Glassnode Studio LTH-SOPR chart | Glassnode Advanced $29/mo | Compute manually via Bitcoin Core UTXO set dump + mempool.space (~2-day lag) |
| STH-SOPR daily | Spent UTXOs <155 days, profit ratio | Glassnode Studio STH-SOPR chart | Glassnode Advanced $29/mo | Same as above |
| BTC 30-day return | Regime filter (must be < -15%) | bybit.eu historical feed (already in repo) | FREE | — |

**Estimated monthly data cost: $29/mo (Glassnode Advanced). Cheapest of the MATCHES candidates.**

**Phase 11.4+ plugin data interface sketch:**
```ts
interface SoprCapitulationInput {
  lthSoprWindow: 3;        // days
  sthSoprWindow: 3;        // days
  btcDrawdownPct: -15;     // 30-day return threshold
}
// Daily fetch: pull LTH-SOPR + STH-SOPR + BTC 30d return
// Trigger: BOTH SOPR < 1.0 for 3 consecutive days AND btcDrawdown < -15%
// Output: SizingSignal { direction: 'long'; size: leverage-1:10; confidence: 0.5-0.7 }
```

---

## H3 — LiquidationHuntPlugin (RANK #3, OUTSIDE SCOPE — parked to Phase 12)

**Signal:** Perp-DEX public position state reveals liquidation clusters; enter short bias perp position just before cascade fires.

| Feed | What it provides | Source | Subscription tier | Notes |
|------|------------------|--------|-------------------|-------|
| Hyperliquid public position state | All positions + liq prices | Hyperliquid public API | FREE | Public by design |
| dYdX v4 indexer | Same | dYdX public indexer | FREE | — |
| GMX v2 subgraph | Same | The Graph | FREE | — |
| CEX liquidation aggregation | Cross-venue cascade timing | Coinglass liquidation API | Coinglass Pro $49/mo | — |
| Perp execution venue | bybit.eu has NO perps | — | N/A | **BLOCKER for Phase 11.x — bybit.eu is SPOT-only** |

**Perp-DEX execution blocked by mandate.** Phase 12 (parked) re-evaluates when capital scale + perp access decision is made.

---

## H4 — PerpDexMEVSandwichPlugin (RANK #4, OUTSIDE SCOPE — parked to Phase 12)

**Signal:** Public-mempool front-running + cross-DEX arbitrage on perp-DEX liquidations.

| Feed | What it provides | Source | Subscription tier | Notes |
|------|------------------|--------|-------------------|-------|
| Hyperliquid mempool stream | Real-time pending tx | Quicknode gRPC testnet OR Dwellir gRPC | Dwellir paid tier for mainnet mempool (~$500/mo) | Mainnet mempool stream NOT publicly free as of 2026-07 |
| EigenPhi paid data | MEV opportunity ranking | EigenPhi subscription | Custom tier ($1k+/mo) | — |
| Co-located execution node | Sub-200ms latency | AWS Tokyo + Dwellir Tokyo validator node | ~$2-5k/mo infra | Tokyo co-loc not in Phase 11.x scope |
| Cross-DEX price feeds | Arbitrage opportunity detection | Hyperliquid + dYdX + GMX + CEX | FREE for read-only | — |

**Blocked by Tokyo co-loc requirement + perp execution + paid mempool data feeds.** Phase 12 parked.

---

## H5 — WhaleClusterSmartMoneyPlugin (RANK #5, MATCHES mandate but LOW edge)

**Signal:** Nansen Smart Money cluster deposit to same CEX within 48h + CEX net-inflow > 5,000 BTC equivalent → short bias.

| Feed | What it provides | Source | Subscription tier | Free alternative |
|------|------------------|--------|-------------------|------------------|
| Nansen Smart Money labels | High-PnL wallet list (~12 labels) | Nansen Standard | $150/mo | Dune community-built wallet-label datasets (less curated, no PnL filtering) |
| Nansen Netflow API | Per-label per-token per-CEX netflow | Nansen Standard API | $150/mo | Dune + Arkham cross-validation (slower, less reliable) |
| CryptoQuant exchange netflow | Total CEX inflow for size filter | CryptoQuant Pro | $49/mo (combined with H1) | Glassnode free 30-day MA |
| Arkham entity labels | Cross-validation of Nansen labels | Arkham Pro | $149/mo (optional) | Skip if Nansen labels sufficient |

**Estimated monthly data cost: $199-348/mo (Nansen $150 + CryptoQuant Pro $49 + optional Arkham $149).** Highest of the MATCHES candidates.

**Phase 11.4+ plugin feasibility assessment:** MATCHES mandate, but Presto Research showed R² = 0.0017-0.0537 for naive whale-deposit signals. The Nansen Smart Money filter is what differentiates this from the naive case, but Nansen does NOT publish their own backtest data on Smart Money PnL. Implementation would require:
1. Negotiate Nansen data-access tier for backtest history.
2. Build empirical backtest of Nansen Smart Money signals over 2020-2024.
3. If backtest shows R² > 0.05 with the Smart Money filter, proceed with plugin build; otherwise, deprioritize.

**Recommendation:** Defer to Phase 11.5+ until backtest economics are validated.

---

## Combined Phase 11.4+ data-feed cost summary

| Plugin | Subscriptions | Monthly cost |
|--------|---------------|-------------:|
| H1 StablecoinNetflow | CryptoQuant Pro | $49 |
| H2 SOPRCapitulation | Glassnode Advanced | $29 |
| H5 WhaleCluster (deferred) | Nansen + CryptoQuant + Arkham | $199-348 |
| **Phase 11.4+ TOTAL (H1+H2 only)** | — | **$78/mo** |
| **If H5 added (Phase 11.5+)** | — | $277-426/mo |

**Funding note.** $78/mo is well within a retail-bot operating budget. CryptoQuant + Glassnode subscriptions can be shared across other research agents (cost amortization across tracks).

---

## Data feed alternatives if subscriptions unavailable

| Hypothesis | Free-only alternative | Quality penalty |
|-----------|----------------------|-----------------|
| H1 StablecoinNetflow | Dune SQL query on Etherscan `Transfer` events to Nansen/CEX-labeled addresses | 2-4h lag, no historical >2yr; trigger reliability ~70% of paid feed |
| H2 SOPRCapitulation | Bitcoin Core UTXO set + mempool.space custom parser | Very slow (hours per refresh); GLASSNODE free tier shows SOME data but not LTH/STH split for historical periods |
| H5 WhaleCluster | Dune + Arkham free tiers | 50% label coverage; missing high-value "Fund" labels |

**Recommendation:** Phase 11.4+ should fund the $78/mo CryptoQuant Pro + Glassnode Advanced subscriptions (H1 + H2). H5 requires Nansen Standard ($150/mo) which is justified only AFTER validating backtest economics.
