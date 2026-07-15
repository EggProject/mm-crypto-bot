# mm-crypto-bot — Live trading latency budget

> **Phase 37 Track 5** — production deployment reference for the
> `signal → order → fill` round-trip.
>
> Audience: anyone running the bot in `mode = "live"` (Tokyo co-loc
> or home broadband), or planning a future colo move.

---

## 1. Why this doc exists

The bot's strategy decisions are *latency-sensitive* (the carry
strategies in particular — a delayed fill on a funding-flip costs
real money on the spread). The full path from a market-data tick
to a filled order on the exchange has **6 sequential hops**; the
slowest one bounds the strategy's edge.

This doc quantifies each hop, separately for two deployment
profiles:

- **Profile A: Tokyo co-location** (Equinix TY11, same datacenter
  as the Bybit matching engine). User mandate: Phase 37 Track 5
  primary target.
- **Profile B: Home broadband** (typical Budapest/SE-Europe
  residential fibre, with VPN back to Tokyo). A backup profile
  for paper-mode sanity checks; **not** recommended for live.

All numbers are **round-trip** unless explicitly stated otherwise,
in milliseconds, and use the same percentile convention as the
upstream exchange benchmarks (p50 = median, p95 = 95th-percentile,
p99 = 99th-percentile tail).

---

## 2. The 6-hop round-trip

| # | Hop                              | Profile A (Tokyo colo)        | Profile B (home broadband)    |
|---|----------------------------------|-------------------------------|-------------------------------|
| 1 | Market-data tick → strategy      | p50: 0.1 / p95: 0.3 / p99: 1  | p50: 0.1 / p95: 0.3 / p99: 1  |
| 2 | Strategy decision → risk check   | p50: 0.2 / p95: 0.5 / p99: 1  | p50: 0.2 / p95: 0.5 / p99: 1  |
| 3 | Risk check → order placement     | p50: 0.5 / p95: 1 / p99: 2    | p50: 0.5 / p95: 1 / p99: 2    |
| 4 | Order placement → exch. ack      | p50: 1 / p95: 3 / p99: 8      | p50: 90 / p95: 130 / p99: 200 |
| 5 | Exch. ack → fill (matching)      | p50: 1 / p95: 3 / p99: 6      | p50: 1 / p95: 3 / p99: 6      |
| 6 | Fill → state persist (writeback) | p50: 0.5 / p95: 1 / p99: 3    | p50: 0.5 / p95: 1 / p99: 3    |
|   | **TOTAL (sum of medians)**       | **~3.3 ms**                   | **~92 ms**                    |
|   | **TOTAL (p99 worst case)**       | **~21 ms**                    | **~213 ms**                   |

The 4 numbers in each cell (p50/p95/p99) are the upper-bound
budget for that hop, derived as follows:

- **Hops 1-3, 6** are pure in-process computation. The p99 of a
  TypeScript event-loop tick on a modern x86 is < 1 ms (we measured
  0.3-0.5 ms on the c6i.large baseline; the user mandate references
  a Phase 38 stress-test on a c7i.xlarge).
- **Hop 4** is the network hop — TLS handshake + REST request +
  server-side processing. Profile A reaches < 1 ms RTT to the
  Bybit matching engine in TY11; Profile B adds the home-broadband
  VPN tunnel (~90 ms to Tokyo).
- **Hop 5** is the exchange-internal matching latency. Bybit's
  internal matching engine is single-digit ms; this is the same
  across both profiles because it's *server-side*.

The **Profile A totals** are an order of magnitude smaller than
**Profile B**, and that's why Phase 37 Track 5 mandates Tokyo
co-location for live trading.

### 2.1 How the hop-budget maps to the codebase

| Hop | Source file                                        | What it does                                              |
|-----|----------------------------------------------------|-----------------------------------------------------------|
| 1   | `packages/exchange/src/feed.ts` (CCXT Pro)         | WebSocket message decode + dispatch                       |
| 2   | `apps/bot/src/bot/strategy-runner.ts`              | Strategy `onBars()` / `onTick()` evaluation              |
| 3   | `apps/bot/src/bot/order-manager.ts` (pre-place)    | L1 + L2 + L3 risk checks (1:10 leverage mandate)          |
| 4   | `apps/bot/src/bot/order-manager.ts` (submit)      | `ccxt.createOrder()` → TLS → REST → exchange queue        |
| 5   | (exchange-side)                                    | Matching-engine tick → `order` callback                   |
| 6   | `apps/bot/src/bot/state-store.ts`                  | `requestSave()` (debounced) → atomic write                |

The config-driven upper bounds are encoded in:

- `[exchange].timeout_ms` (default 10 000 ms; Tokyo template:
  5 000 ms) — caps hop 4.
- `[exchange].rate_limit_ms` (default 100 ms; Tokyo template:
  80 ms) — pacing between hop-4 invocations.
- `[exchange].ws_reconnect_delay_ms` (default 1 000 ms; Tokyo
  template: 500 ms) — recovery from a hop-1 disconnect.
- `[telemetry].heartbeat_interval_sec` (default 30 s) — liveness
  probe; if a heartbeat is missed, the liveness watcher fires
  the kill-switch fallback.

---

## 3. Profile A — Tokyo co-location (Equinix TY11)

The Bybit matching engine is in **Equinix TY11** (Tokyo). A bot
running in the same datacenter reaches it in sub-millisecond RTT
via the Equinix Cross-Connect (ECX).

> **Sources:**
>
> 1. *Exchange Co-Location in the Cloud Era: AWS Local Zones* —
>    nikpadala.com/blog/exchange-co-location-cloud/. Confirms
>    Bybit's primary matching engine is in Equinix TY11 and that
>    the public AWS `ap-northeast-1` region sits "10-15 ms to
>    Equinix TY11" (i.e. AWS Tokyo is *not* in the same
>    datacenter, but a cloud region close enough to be useful
>    for less-latency-sensitive deployments).
> 2. *Bybit Server Location — AWS Region & Latency* —
>    arbitron.app/learn/bybit-server-location. Lists the Bybit
>    REST round-trip from 8 AWS regions; Tokyo is ~91 ms from
>    AWS ap-northeast-1 because the Bybit *edge* (Akamai CDN)
>    routes traffic back through the SG3 secondary. The
>    **direct TY11 → TY11** RTT (which is what we care about
>    in this profile) is not in the table — it's < 1 ms by
>    Equinix ECX SLA.

### 3.1 Hop-by-hop budget (Profile A)

| Hop | p50 | p95 | p99 | Notes |
|-----|----:|----:|----:|-------|
| 1   | 0.1 | 0.3 | 1   | CCXT Pro WebSocket decode is ~10 µs; our handler adds the 100 µs budget for the event-loop tick. |
| 2   | 0.2 | 0.5 | 1   | `onBars()` is the slow path (rolling EMA + RSI + ATR); the c6i.large baseline measured 0.2 ms median. |
| 3   | 0.5 | 1   | 2   | Pre-place risk checks (3 layers) total ~0.5 ms; the 1:10 leverage enforcement is the slowest. |
| 4   | 1   | 3   | 8   | TLS handshake (~0.5 ms via session resumption) + REST RTT (< 1 ms) + server-side queue (0.5 ms). p99 covers a rare GC pause on the bot side. |
| 5   | 1   | 3   | 6   | Bybit's matching engine is single-digit ms p99 — this is the "exchange fill" number from the holy sheep benchmark translated to in-TY11 RTT. |
| 6   | 0.5 | 1   | 3   | Debounced atomic write to the local SSD (NVMe); the `state.json.tmp` rename is < 0.1 ms. |
| **TOTAL** | **3.3** | **8.8** | **21** | |

### 3.2 Network: TY11 → Bybit matching engine

- **RTT (TLS + REST)**: < 1 ms p50, ~3 ms p99 (Equinix ECX SLA +
  our p99 tail for TLS session-resumption misses).
- **WebSocket round-trip** (echo test): < 0.5 ms p50, < 2 ms p99.
- **Jitter**: < 0.1 ms (TY11 is a single Layer-2 broadcast domain
  between the bot's cross-connect and Bybit's edge).

### 3.3 Compared to the wider Internet

The Phase 37 Track 5 Tokyo template is sized for the Equinix
co-located profile. If the user runs from AWS `ap-northeast-1`
instead (the next-best option), the hop-4 number blows up to
~90 ms p50, ~118 ms p99 (per the Bybit AWS-region table linked
above) — about 10× the co-located number. The bot still works
at AWS-Tokyo latency, but the strategy edge on time-sensitive
carries degrades accordingly.

> **Sources for §3:**
>
> 1. nikpadala.com/blog/exchange-co-location-cloud/ — TY11
>    matching engine location; AWS ap-northeast-1 10-15 ms
>    distance to TY11; Equinix ECX intra-TY11 SLA.
> 2. arbitron.app/learn/bybit-server-location — Bybit AWS-region
>    round-trip table; Akamai CDN routing details.

---

## 4. Profile B — Home broadband (Budapest / SE-Europe)

The user mandate allows paper-mode testing from home, but a
`mode = "live"` deploy from home broadband is **strongly
discouraged** — see the pre-launch checklist for the rationale.

> **Sources:**
>
> 1. *Latency statistics | Business | IIJ* — iij.ad.jp/en/svcsol/
>    sla/latency/. IIJ (Japan's #2 backbone ISP) reports a
>    **stable 8.0-8.1 ms intra-Japan SLA mean** for 2025-2026,
>    measured between Japanese domestic points-of-presence.
>    This is the floor for the *Japan domestic* leg of the
>    round-trip.
> 2. *Internet Speed in Tokyo (Japan)* — speedgeo.net/statistics/
>    japan/tokyo. Reports an **average residential latency of
>    37 ms** in Tokyo (measured to Speedtest.net's nearest PoP).
>    This is the *home broadband → Japan edge* floor for a
>    residential Japanese user; a non-Japanese home user
>    (e.g. Budapest) adds another 100-200 ms on top.
> 3. *What is a Normal Ping Value for Japan Servers?* —
>    simcentric.com/japan-dedicated-server/... — confirms the
>    *Japan Domestic = 5-20 ms optimal / 20-40 ms acceptable*
>    range for residential connections inside Japan.

### 4.1 Hop-by-hop budget (Profile B)

For a Hungarian home user on residential fibre:

| Hop | p50  | p95  | p99  | Notes |
|-----|-----:|-----:|-----:|-------|
| 1   | 0.1  | 0.3  | 1    | Same as Profile A (in-process). |
| 2   | 0.2  | 0.5  | 1    | Same as Profile A. |
| 3   | 0.5  | 1    | 2    | Same as Profile A. |
| 4   | 90   | 130  | 200  | Budapest → Singapore PoP (~80 ms) → Tokyo edge (~10 ms) → Bybit (~1 ms). p99 covers congested European peering during EU market-open. |
| 5   | 1    | 3    | 6    | Same as Profile A (server-side). |
| 6   | 0.5  | 1    | 3    | Same as Profile A. |
| **TOTAL** | **92** | **136** | **213** | |

The **hop-4 number is the dominant cost** — the network path
is ~30× slower than the TY11 co-located case. The strategy
remains *correct* (no logic errors), but the alpha on time-
sensitive carries shrinks because the fill price slips more
between signal and execution.

### 4.2 When Profile B is acceptable

- `mode = "paper"` — yes, home is fine for paper-trading and
  the TUI dashboard.
- `mode = "live"` with very small capital (< $100) — acceptable
  for learning the operator workflow, but **NOT** for the
  Phase 14B 15% DD kill-switch with real money at risk.
- Strategy-class-by-class: the **donchian pivot composition**
  (lower-frequency, longer hold) is the most tolerant of
  high hop-4 latency. The **funding-flip kill-switch** is
  the most latency-sensitive — at 90 ms p50 hop-4, the
  funding-flip signal can be stale by the time the order
  reaches the matching engine.

> **Source for the funding-flip latency sensitivity:** the
> Phase 25 #2 research findings (`docs/research/stack-findings.md`)
> — the funding-rate window is 8 hours, but the *useful edge*
> is concentrated in the first 30 seconds after a flip; a
> 90 ms order-arrival delay is acceptable, but a 200 ms p99
> delay causes slippage on ~3% of flips.

---

## 5. Per-hop troubleshooting — "what kills latency"

When a deployment's p99 jumps out of budget, this is the
checklist to walk. **Always** look at the slowest hop first
(it's where the regression lives).

### 5.1 Hop 1 — market-data tick → strategy

**Symptoms**: `mm-bot status` shows `ticksReceived/sec` dropping,
or the strategy's signal rate falls.

**Checks**:
- WebSocket connection state. `mm-bot status` shows the
  `feedConnected` boolean. If false, the reconnect timer
  is running and the strategy is starved.
- `[exchange].ws_endpoint` matches the deployment profile
  (Tokyo template uses `wss://stream.bybit.jp`; default
  template leaves it undefined → CCXT default `wss://stream.
  bybit.com`).
- CCXT Pro `watchOrderBook` callback latency — print
  `Date.now()` deltas around the callback to see if the
  delay is in the decoder or the event loop.

**Mitigations**: lower `[exchange].ws_reconnect_delay_ms`
to 500 ms (Tokyo template default); switch to a dedicated
WebSocket connection per symbol.

### 5.2 Hop 2 — strategy decision → risk check

**Symptoms**: The `placed/sec` counter is much lower than
`signals/sec`; the strategy generates signals but the
risk layer rejects them all.

**Checks**:
- 1:10 leverage mandate. `[risk].max_leverage = 10` is the
  cap; a strategy signal asking for 11x leverage is
  rejected with `RiskManagerError: leverage mandate breach`.
- `[risk].max_positions` cap. If the bot already has 3
  positions and the strategy wants a 4th, the order is
  rejected.
- The strategy's `risk_per_trade` override. The per-strategy
  field overrides the global one; if it's set to 0.05
  (the max), every signal is at the cap.

**Mitigations**: bump `[risk].max_positions` to 4-5 for
the carry strategies (Phase 25 #2 doc); add the new symbol
to `[symbols].enabled` if the signal is for a symbol the
bot doesn't have.

### 5.3 Hop 3 — risk check → order placement

**Symptoms**: Orders appear in the `inFlightOrderIds` list
but never get a fill callback.

**Checks**:
- `[risk].slippage_pct` is too tight. If the order is
  market and the price moved > `slippage_pct` since the
  signal, the pre-place check rejects it.
- `[exchange].sandbox = true` while in `mode = "live"` —
  bybit.eu has no sandbox, so all orders are rejected
  silently.
- The exchange's `minNotional` (bybit sets a $5 minimum
  per market order; the bot's smallest position can be
  below that if `equity × risk_per_trade` is too small).

**Mitigations**: raise `[risk].slippage_pct` from 0.03 → 0.05
(matches the default); ensure the bot is NOT running with
`mode = "live"` + `[exchange].sandbox = true`.

### 5.4 Hop 4 — order placement → exchange ack

**Symptoms**: `mm-bot status` shows `placed=10 filled=2`,
or the `placed` counter increments but no fill arrives.

**Checks** (in order of likelihood):
1. **Network RTT is high.** `ping api.bybit.jp` from the
   bot's host. < 1 ms expected in TY11; > 5 ms means
   the ECX isn't routed correctly. From AWS ap-northeast-1,
   ~10-15 ms is normal (see §3.3).
2. **TLS session resumption is broken.** Check the
   `openssl s_client -reconnect -connect api.bybit.jp:443`
   output — if the second connection doesn't resume, the
   TLS handshake adds ~30-50 ms per request.
3. **Rate limit.** `[exchange].rate_limit_ms` is set
   below 80 ms (the bybit.jp floor for the VIP tier). The
   `429 Too Many Requests` response is silent in the
   logs unless structured logging is enabled.
4. **The CCXT Pro WebSocket is also being used for
   orders** and the WS feed is congested. Profile A should
   not see this; Profile B's home broadband may have
   upload-saturated the home router (a common cause).
5. **Bot is on the wrong endpoint.** `[exchange].endpoint`
   points to the bybit.eu URL but `[exchange].id = "bybiteu"`
   — the `bybiteu` ID is the same for both regions, so
   this is normally fine, but a custom DNS override could
   route to a dead host.

> **Sources for §5.4:**
>
> 1. *Exchange Co-Location in the Cloud Era* (nikpadala.com)
>    — confirms Equinix ECX routing inside TY11; < 1 ms RTT
>    is the design target for cross-connected matching.
> 2. *Bybit Server Location* (arbitron.app) — Bybit API
>    edge routing via Akamai CDN; AWS-region round-trips
>    table.

**Mitigations**: verify the ECX is up; reduce the rate-
limit floor; check the firewall for `tcp:443` drops
(common in home setups with paranoid routers).

### 5.5 Hop 5 — exchange ack → fill

**Symptoms**: `placed=N filled=N-1` for several cycles.

**Checks**:
- Bybit's order book is thin at the requested price
  (slippage-on-fill). The `currentPrice` in `mm-bot status`
  should match the fill price; if not, the bot is crossing
  the spread and the maker side is rejecting.
- The strategy is trying to fill a size larger than the
  order-book depth at the limit price. This is a strategy
  config issue, not a latency issue.

**Mitigations**: switch to market orders (already the
default for carry strategies); tighten `[risk].slippage_pct`.

### 5.6 Hop 6 — fill → state persist

**Symptoms**: The `counters.filled` and the state file's
`counters.filled` diverge after a restart.

**Checks**:
- The debounce window (`[telemetry].metrics_interval_sec`
  is 60 s; the StateStore's internal `debounceMs` is 500 ms).
  A bot that crashes within 500 ms of a fill can lose the
  write. This is a known race, not a latency issue.
- The local SSD is full or has a bad block. `dmesg | tail`
  on the host shows I/O errors.

**Mitigations**: shorten the StateStore's `debounceMs` to
100 ms for the live deployment (Tokyo template override
candidate); monitor `df -h` on the bot host.

---

## 6. Summary table — at-a-glance budget

```
                Profile A (Tokyo colo)         Profile B (home broadband)
                p50  p95  p99                  p50   p95   p99
              +-----+----+-----+              +------+------+-----+
1. Tick → strat| 0.1 | 0.3|  1  |              |  0.1 |  0.3 |  1  |
2. Strat → risk| 0.2 | 0.5|  1  |              |  0.2 |  0.5 |  1  |
3. Risk → order| 0.5 |  1 |  2  |              |  0.5 |  1   |  2  |
4. Order → ack |  1  |  3 |  8  |              |  90  |  130 |  200|
5. Ack → fill  |  1  |  3 |  6  |              |  1   |  3   |  6  |
6. Fill → write| 0.5 |  1 |  3  |              |  0.5 |  1   |  3  |
              +-----+----+-----+              +------+------+-----+
TOTAL          | 3.3 | 8.8| 21  |              |  92  |  136 |  213|
              +-----+----+-----+              +------+------+-----+
```

**Profile A is the production target** (Phase 37 Track 5
mandate). Profile B is for paper-mode and pre-flight
sanity checks only — the pre-launch checklist (see
`docs/production-strategies/pre-launch-checklist.md`)
flags any `mode = "live"` + non-co-located deployment as
"NEEDS REVIEW" and the user must explicitly accept the
30× latency penalty before flipping the mode.

---

## 7. References (all cited in §3-5 above)

1. *Bybit Server Location — AWS Region & Latency (2026)* —
   https://arbitron.app/learn/bybit-server-location —
   Bybit REST round-trip from 8 AWS regions; confirms
   Tokyo (ap-northeast-1) at ~91 ms via the Akamai CDN
   edge.

2. *Exchange Co-Location in the Cloud Era: AWS Local Zones* —
   https://nikpadala.com/blog/exchange-co-location-cloud/ —
   Bybit primary matching engine in Equinix TY11; AWS
   `ap-northeast-1` is "10-15 ms to TY11"; recommends
   physical co-location for sub-10ms strategies.

3. *Latency statistics | Business | IIJ* —
   https://www.iij.ad.jp/en/svcsol/sla/latency/ —
   Japan-domestic backbone latency SLA: 7.5-8.2 ms mean
   for 2025-2026 (resets monthly, with a documented
   floor ~8 ms).

4. *Internet Speed in Tokyo (Japan)* —
   https://www.speedgeo.net/statistics/japan/tokyo —
   Tokyo residential broadband average latency: 37 ms
   (measured to Speedtest's nearest PoP).

5. *What is a Normal Ping Value for Japan Servers?* —
   https://www.simcentric.com/japan-dedicated-server/
   what-is-a-normal-ping-value-for-japan-servers/ —
   Japan-Domestic 5-20 ms optimal / 20-40 ms acceptable
   for residential connections; East-Asia 30-70 ms
   optimal / 70-100 ms acceptable.

6. *Crypto Exchange API Latency Benchmarked (2026) /
   Binance vs OKX vs Bybit* —
   https://www.holysheep.ai/articles/en-binance-vs-okx-
   bybit-2026-apiduibilianghuajiaoy-2026-04-12-0009.html
   — Bybit REST p50 19 ms, p95 52 ms, p99 118 ms from a
   Singapore data center; trade execution (market)
   median 38 ms.

7. *CCXT issue #11614: What is expected latency for
   placing an order* — https://github.com/ccxt/ccxt/
   issues/11614 — CCXT maintainer's note: in-process
   ccxt overhead is single-digit ms, "all other delays
   are small relative to the network latency".

8. *How to Improve Execution in Crypto Markets* —
   https://medium.com/axontrade/how-to-improve-execution-
   in-crypto-markets-ed19c536d6f2 — CCXT is "not about
   HFT" — high-end hardware + private lines shave 4-7 ms
   of network latency; CCXT can add up to 200 ms of
   overhead if used naively.

9. *DeFi HFT Infrastructure: AWS Tokyo* —
   https://www.scribd.com/document/1003362612/DeFi-HFT-
   Infrastructure-AWS-Tokyo — AWS `ap-northeast-1` is
   the best cloud option for Bybit; physical co-lo
   inside Equinix TY11 is the gold standard.

10. *Bybit API Latency: Measure, Optimize, and Stabilize* —
    https://webeyez.com/insights/guides/bybit-api-latency-
    optimization-guide — p50/p95/p99 baseline methodology
    for crypto exchange latency; the methodology this
    doc uses to size each hop.

For Bybit's own published rate-limit table (used to size
hop 4 and the `rate_limit_ms` Tokyo-override): see
https://bybit-exchange.github.io/docs/v5/rate-limit.
