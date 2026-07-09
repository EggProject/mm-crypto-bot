---
description: Phase 12+ scope plan — HFT market-making + Tokyo co-loc + options-extension architecture. OUTSIDE retail envelope. Requires ≥$500k capital + regulatory review. Projected +12-18%/month envelope. Beyond +50%/month requires mandate removal OR this architecture.
---

# Phase 12+ — Beyond retail envelope (scope plan, 2026-07-05 04:25)

**Trigger:** Phase 11.1+11.2 single-venue set is the COMPLETE retail-viable envelope. Phase 12+ is OUTSIDE retail — requires capital scale + regulatory review + HFT-grade infrastructure.

**This is the architectural "Renaissance / Two Sigma" piece** the user mentioned in their original Phase 10G pushback: "build the platform that lets us compose arbitrary numbers of independent alpha streams and measure their portfolio-level Sharpe, drawdown, and correlation structure empirically."

**The +50%/month ceiling at 1:10 retail bybit.eu:**
- Phase 11.1 set: +4.5-5.5%/month
- Phase 11.2 single-venue: +5.1-6.3%/month
- **+50%/month is 8-10× short** even with all retail-viable single-venue drop-ins

**To bridge to +50%/month, one of these is required:**
1. **Capital scale 10×** → moves envelope by +2-3%/month (better execution + multi-asset basket)
2. **HFT market-making plugin** (sub-10ms Tokyo co-loc) → +10-20%/month standalone
3. **Options market-making plugin** (vol surface arbitrage) → +5-10%/month standalone
4. **Drop 1:10 mandate** → linear scale-up, but VaR + liquidation risk scales too

Phase 12+ addresses options 1-3 (option 4 = mandate removal, separate discussion).

---

## What Phase 12+ delivers

**3 architectural pillars, each a separate plan with own infrastructure requirements:**

### Pillar 12.A — Multi-venue execution backbone

**Purpose:** Replace single-venue bybit.eu execution with multi-venue routing for better fill rates and lower slippage at scale.

**Components:**
- 12.A.1: Smart order router (Phase 10G.4) — venue selection based on liquidity + fees
- 12.A.2: Cross-venue order book aggregation
- 12.A.3: Latency arbitrage detector (cross-venue price dislocations)
- 12.A.4: Failover + redundancy (if venue A goes down, route to B)

**Files (~1500 LOC expected):**
- `packages/core/src/execution/smart-order-router.ts` (~600 LOC)
- `packages/core/src/execution/venue-aggregator.ts` (~400 LOC)
- `packages/core/src/execution/latency-arb.ts` (~300 LOC)
- `packages/core/src/execution/failover-controller.ts` (~200 LOC)

**Data sources required (NEW):**
- bybit.eu WebSocket (existing)
- binance WebSocket (NEW)
- okx WebSocket (NEW)
- Cross-venue latency measurement (NEW)
- Multi-venue account aggregation (NEW)

**Capital requirement:** ≥$500k for retail-viable alpha (below that, fees + slippage eat the edge).

**Expected envelope:** +2-3%/month (better execution + multi-asset basket).

### Pillar 12.B — HFT market-making plugin

**Purpose:** Market-make on top exchanges, capturing bid-ask spread on liquid pairs. Requires sub-10ms latency.

**Components:**
- 12.B.1: Market-making engine (Avellaneda-Stoikov model)
- 12.B.2: Inventory management (don't accumulate directional risk)
- 12.B.3: Adverse selection detection (toxic flow detection)
- 12.B.4: Latency-budgeted quote placement (sub-10ms Tokyo co-loc)

**Files (~2000 LOC expected):**
- `packages/core/src/market-making/avellaneda-stoikov.ts` (~700 LOC)
- `packages/core/src/market-making/inventory-manager.ts` (~500 LOC)
- `packages/core/src/market-making/toxic-flow-detector.ts` (~400 LOC)
- `packages/core/src/market-making/latency-quoter.ts` (~400 LOC)

**Infrastructure required (NEW):**
- Tokyo co-location (sub-10ms to bybit.eu, binance, okx Asia servers)
- Hardware: FPGA or low-latency CPU (1µs tick-to-trade)
- Network: cross-connect to exchange matching engines
- Capital: ≥$1M for viable market-making (inventory + margin)

**Expected envelope:** +10-20%/month standalone (highly variable, market regime dependent).

### Pillar 12.C — Options vol surface arbitrage

**Purpose:** Trade options vol surface dislocations across strikes and expiries. Captures vol risk premium + smile arbitrage.

**Components:**
- 12.C.1: Vol surface fitter (SVI / SSVI parameterization)
- 12.C.2: Smile arbitrage detector (SVI vs market)
- 12.C.3: Term structure arbitrage (calendar spreads)
- 12.C.4: Vol-gamma hedging (delta-hedge with futures/perp)

**Files (~2500 LOC expected):**
- `packages/core/src/options-vol/svi-fitter.ts` (~700 LOC)
- `packages/core/src/options-vol/smile-arb.ts` (~500 LOC)
- `packages/core/src/options-vol/term-structure.ts` (~400 LOC)
- `packages/core/src/options-vol/gamma-hedger.ts` (~500 LOC)
- `packages/core/src/options-vol/data/deribit-options-feed.ts` (~400 LOC)

**Data sources required (NEW):**
- Deribit options chain (real-time)
- Deribit DVOL index (real-time)
- Deribit futures for hedging (real-time)
- Separate Deribit account (not bybit.eu)

**Capital requirement:** ≥$500k margin for options vol-selling; ≥$1M for full vol surface arb.

**Expected envelope:** +5-10%/month standalone.

---

## Phase 12+ projected envelope (combined)

If all 3 pillars ship:
- Pillar 12.A: +2-3%/month
- Pillar 12.B: +10-20%/month
- Pillar 12.C: +5-10%/month
- **Combined: +17-33%/month** (with high correlation between pillars, realistic +12-18%/month)

This is **THE BRIDGE to +50%/month** — but only viable with:
- ≥$500k capital
- Tokyo co-location
- Deribit account
- 2-3 senior engineers
- 3-6 months setup time

---

## Phase 12+ vs the 1:10 mandate

**CRITICAL DECISION POINT:** the 1:10 leverage cap is a hard guardrail. Phase 12+ requires careful thought about how to maintain the mandate while enabling HFT/options alpha.

**Possible solutions:**
1. **Run Phase 12+ as a SEPARATE capital pool** with explicit mandate override for that pool (e.g. "Tokyo pool: max leverage 50×, max notional $100k per trade")
2. **Drop the 1:10 mandate project-wide** and replace with VaR-based risk budget (e.g. "max daily VaR 2% per pool")
3. **Keep 1:10 for SCv1 retail** + run Phase 12+ as experimental sub-pools with explicit user approval per pool

**Recommendation:** Option 1 — separate capital pool with explicit mandate override. This preserves the retail 1:10 mandate while enabling HFT/options alpha on a separate capital pool.

---

## Phase 12+ scope plans status

| Pillar | Scope plan | Plan YAML | Ready to launch |
|--------|-----------|-----------|-----------------|
| 12.A Multi-venue execution | NOT WRITTEN | NOT WRITTEN | after Phase 11.2 lands + capital decision |
| 12.B HFT market-making | NOT WRITTEN | NOT WRITTEN | DEFERRED (Tokyo co-loc setup) |
| 12.C Options vol surface | NOT WRITTEN | NOT WRITTEN | DEFERRED (Deribit account) |

**Will write scope plans + plan.yamls after Phase 11.1+11.2 lands + user makes capital/regulatory decisions.**

---

## Capital + regulatory decisions needed (BLOCKING)

The user needs to decide:
1. **Capital scale:** stay retail (≤$50k) or scale to ≥$500k for Phase 12+?
2. **Tokyo co-location:** budget $5-10k/month for Tokyo server + cross-connects?
3. **Deribit account:** open separate Deribit account (out of MiCAR EU retail scope)?
4. **Mandate:** keep 1:10 project-wide or allow per-pool overrides for Phase 12+?

These are user decisions, not agent decisions. Agent ranks (12.A first, 12.B second, 12.C third) but user decides whether to launch Phase 12+ at all.

---

## Realistic envelope projection (post-Phase 12+)

**If Phase 12+ ships + capital decision made:**
- Combined envelope: +12-18%/month
- Still 3-4× short of +50%/month
- Remaining gap requires: options market-making (10B) + ML signal (Phase 13+) + capital scale 10×

**To bridge the FINAL gap to +50%/month:**
- All 3 Phase 12+ pillars ship (12-18%/mo)
- 10× capital scale (+2-3%/mo better execution)
- Options MM at scale (+5-10%/mo)
- ML signal alpha (+3-5%/mo, but HIGH decay risk)
- **Total possible envelope: +22-36%/month**

Even with EVERYTHING optimized, +50%/month is 1.4-2.3× short. The structural mandate vs Sharpe trade-off is real.

**Final verdict on +50%/month at 1:10 retail bybit.eu:** STRUCTURALLY UNREACHABLE.
**Final verdict on +50%/month at HFT/options/MM extension:** POSSIBLE but requires the entire Phase 12+ stack + 10× capital + perfect execution.

This is the architectural reality. The +50%/month target either becomes "Phase 12+ + capital" or stays unreachable.
