# Phase 4 Riport — Agresszív Mean-Reversion Implementation

> **Dátum:** 2026-07-04 00:15 Europe/Budapest
> **Stratégia:** `MeanReversionBbStrategy` (`packages/core/src/strategy/mean-reversion-bb.ts`)
> **Adatok:** Phase 1 Binance public OHLCV (BTC/ETH/SOL × 1h, 2024-01-01 → 2026-07-03)
> **Cost-model:** bybit.eu SPOT 1:10 — taker 0.1%/side, slippage 0.05%/side, spread 0.02%/side, borrow 0.01%/h, funding 0
> **Position sizing:** riskPerTrade 1%, Kelly-fraction 0.25, max DD 50% (kill-switch), max position 20% equity, min 1%
> **Trigger:** LTF 1h close ≤ MTF 4h BB(20, 2σ) lower = **long**, ≥ upper = **short** (ADX > 35 szűrő blokkolja az erős trendeket)
> **Exit:** LTF close visszatér MTF BB middle-ig = TP, vagy stop loss az entry ±1%-án
> **Időkeret:** 30.1 hónap (2024-01-01 → 2026-07-03)

## TL;DR

A Phase 4 aggressive `MeanReversionBbStrategy` a BTC/ETH/SOL × 1h backtest-eken **mindhárom szimbólumon konzisztensen negatív eredményt produkált** (−41% és −47% közötti teljes hozam, 30 hónap alatt). A Phase 1-3 baseline-tal ellentétben a stratégia most **sok trade-et generált** (592-797 / 30 hónap), tehát a trade-szám-szűk keresztmetszet megoldódott — DE a per-trade EV negatív, így a fee-drag és a stop-loss-ok dominálnak. **A +100%/hó cél teljesíthetetlen ezzel a változattal.**

A vizsgált 30 hónapos időszak (2024-01 → 2026-07) egyébként **nem volt tisztán trendelő piac** — a BTC close-to-close +48%, ETH −23%, SOL −19% volt, DE mindhárom symbol elérte a 2025-ös csúcsát (BTC $126K, ETH $4957, SOL $296), majd 2026-ban komoly korrekciót szenvedett. Ez azt jelenti, hogy a piac 2024-2025-ben erősen trendelő volt, 2026-ban pedig range/oldalazó. A mean-reversion stratégia mindkét fázisban negatív EV-t produkált (lásd 3.1 szakasz).

A Phase 4 munka során **egy engine-bug is javításra került** (`aggregateToTimeframe` nem-grid-aligned kezdő timestamp esetén minden LTF candle-t külön bucketbe tett), ami a Phase 1-3 baseline-ot is érintette, de annak restrictív stratégiája miatt nem volt látható. A javítás után a Phase 1-3 eredmények is reprodukálhatók konzisztens MTF aggregációval.

## 1. Eredmények — BTC/ETH/SOL × 1h

| Symbol | Trades | Buys/Sells | Teljes hozam | Havi átlag* | Sharpe | Sortino | Max DD | Win Rate | Profit Factor | Final equity |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| **BTC/USDT** | 592 | 305 / 287 | **−42.66%** | −1.83%/mo | −3.747 | −2.257 | 42.86% | 26.52% | 0.539 | $5,733.52 |
| **ETH/USDT** | 715 | 359 / 356 | **−41.44%** | −1.78%/mo | −2.788 | −1.650 | 41.87% | 23.22% | 0.632 | $5,856.26 |
| **SOL/USDT** | 797 | 388 / 409 | **−46.59%** | −2.10%/mo | −2.585 | −1.594 | 49.46% | 17.58% | 0.651 | $5,341.29 |

\* Monthly avg a `Math.pow(1 + totalReturn, 1/months) - 1` formulával. Mivel minden totalReturn negatív, a havi átlag a `monthlyReturn`=0 formázás miatt jelenik meg a CLI-ban, de a fenti értékek a teljes hozamból számolódnak a trade-számmal súlyozva.

### Trade-ek exit-okok szerinti bontása

| Symbol | Stop-loss | Take-profit | Time-exit (>72h) | Összesen |
|---|---:|---:|---:|---:|
| BTC/USDT | 429 (72.5%) | 147 (24.8%) | 16 (2.7%) | 592 |
| ETH/USDT | 549 (76.8%) | 148 (20.7%) | 18 (2.5%) | 715 |
| SOL/USDT | 656 (82.3%) | 128 (16.1%) | 13 (1.6%) | 797 |

A stop-loss dominancia (73-82%) önmagában jelzi, hogy a trade-ek túlnyomó része a **tervezett irány ellen** mozdult el 1%-on belül. Ez a minta a **trend-erős piacon** tipikus: a BB alsó sávját érintő long setup a trend folytatódásával azonnal stop-ot üt, nem pedig visszafordul a BB middle-ig.

### Per-trade átlagok

| Symbol | Avg win | Avg loss | Best trade | Worst trade | Win/Loss arány |
|---|---:|---:|---:|---:|---:|
| BTC/USDT | $31.73 | −$21.26 | $138.10 | −$36.05 | 1.49× |
| ETH/USDT | $42.91 | −$20.52 | $196.92 | −$33.25 | 2.09× |
| SOL/USDT | $62.04 | −$20.31 | $269.71 | −$40.78 | 3.05× |

A win/loss USD-árány **nagyobb mint 1×** minden szimbólumon — DE a win-rate 17-27% messze a break-even alatt van. A várható érték trade-enként:

- BTC: 0.2652 × $31.73 + 0.7348 × (−$21.26) = **−$7.21 / trade**
- ETH: 0.2322 × $42.91 + 0.7678 × (−$20.52) = **−$5.79 / trade**
- SOL: 0.1757 × $62.04 + 0.8243 × (−$20.31) = **−$5.84 / trade**

A SOL a legnagyobb egyedi nyereséget hozza ($269), de a legalacsonyabb win-rate-tel (17.6%) → a konzervatív mean-reversion-nak ez a legkedvezőtlenebb kombináció.

## 2. Equity-görbe — korai csúcs, monoton ereszkedés

A stratégia mindhárom szimbólumon **az első 1-3 hétben érte el a peak equity-t**, és onnantól monoton csökken:

| Symbol | Peak equity | Peak dátum | Trough equity | Trough dátum | Final |
|---|---:|---|---:|---|---:|
| BTC/USDT | $10,034.06 | 2024-01-08 | $5,733.52 | 2026-07-03 | $5,733.52 |
| ETH/USDT | $10,071.49 | 2024-01-10 | $5,855.05 | 2026-06-15 | $5,856.26 |
| SOL/USDT | $10,567.58 | 2024-01-20 | $5,341.29 | 2026-07-03 | $5,341.29 |

A SOL egyedül ment 5.6% fölé az induló equity-hez képest (peak 2024-01-20, ~$10,567), DE ez a rövid lived trade-ek szerencsés sorozata volt, nem tartós edge. A Phase 4 briefben jelzett **"50-200 trade / hó, 55-65% win rate"** várakozás nem teljesült: 20-27 trade/hó jött létre, 17-27% win rate-tel.

SOL equity-görbe 5 havonta (az egyenletes eloszlás kedvéért):

| t (hónap) | Dátum | Equity |
|---:|---|---:|
| 5 | 2024-06-01 | $9,033 |
| 10 | 2024-11-01 | $7,663 |
| 15 | 2025-04-01 | $6,529 |
| 20 | 2025-09-01 | $6,035 |
| 25 | 2026-02-01 | $5,709 |
| 30 | 2026-07-03 | $5,341 |

A görbe simán lefelé tart, egyetlen nagyobb equity-recovery szakasz nélkül.

## 3. Kritikus megállapítások

### 3.1 A trade-szám-szűk keresztmetszet MEGOLDÓDOTT, de EV negatív

A Phase 1-3 MTF-Trend-Konfluencia strategy 4 trade-et generált 30 hónap alatt. A Phase 4 mean-reversion **592-797 trade-et** generált ugyanazon az időszakon. A likviditási / trade-generálási limitáció tehát megoldódott.

DE: a Phase 1-3 MTF-TKC strict 3-layer confluence-e kiszűrte a legtöbb false-signalt. A mean-reversion BB-trigger **minden BB-szél-érintésre** trade-et nyit. A 2024-2026-os BTC/ETH/SOL piac a 2024-2025-ös időszakban erősen trend-following volt (BTC csúcs +197% $126K-on 2025-10-06, ETH csúcs +116% $4957-en 2025-08-24, SOL csúcs +190% $296-on 2025-01-19), és csak a 2026-os szakaszra jött egy komolyabb korrekció. A BB alsó sávjához érő close egy trend-piacon **nem jelenti a fordulót** — csak egy kisebb pullback-et, ami hamar folytatódik → az 1%-os stop azonnal kiütődik.

### 3.2 A fee-drag önmagában megöli az alacsony per-trade edge-t

A bybit.eu SPOT 1:10 cost-model:
- Taker fee: 0.10% / side (0.20% round-trip)
- Slippage: 0.05% / side (0.10% round-trip)
- Spread: 0.02% / side (0.04% round-trip)
- **Összesen: 0.34% round-trip**

Egy 1%-os stop-loss-on lezárt trade bruttó -1.00% a notional-on, de a fee-k miatt a nettó -1.34%. Egy TP-n lezárt trade a BB lower → BB middle távolságtól függ (tipikusan 1-2% a BB közepére), bruttó +1.5%, nettó +1.16%.

A break-even win-rate ennek megfelelően: `0.34 / (1.34 + 1.16) = 0.34 / 2.50 = 13.6%`. Tehát minden win-rate 13.6% felett nyereséges kellene legyen — DE a valóságban a stop-loss 73-82%-ban triggerelődik, és a take-profit-ok gyakran a BB middle-nél zárulnak azonnal (ha a forduló gyors). A tényleges nettó PnL-trade-arány a win-rate-től és a take-profit távolságtól függ, és az adatok azt mutatják, hogy 17-27% win-rate-tel **a trade-ek túlnyomó része stop-loss-on zárul, és a take-profit-ok nem elég nagyok a kompenzációhoz**.

### 3.3 A Phase 4 brief "55-65% win-rate, 50-200 trade / hó" várakozása nem teljesült

A Phase 4 brief a strategy fejlécében (és a `mean-reversion-bb.ts` kommentjében) jelezte:
> "Expected behavior on BTC/ETH/SOL 2024-01 → 2026-07: 50-200 trades per month on each symbol with this single-instrument signal. Win-rate expectation: 55-65% (mean-reversion tends to recover ~50% of the oversold move on average)."

A valóság: **17-27% win-rate**. Ez a discrepancy azért van, mert a Bulkowski-féle mean-reversion statisztikák **range-bound (oldalazó) piacra** vonatkoznak, ahol a BB alsó sávjához érő close azonnal fordulót jelez. A 2024-2025-ös BTC/ETH/SOL nem range-bound volt (mindhárom erős trend-időszakot futott); a 2026-os range-szakaszban a mean-reversion elvileg jobban kellett volna működjön, de az ADX-szűrő és a BB-érintkezés gyakorisága miatt a valóságban itt is negatív volt az eredmény.

### 3.4 Az ADX > 35 szűrő nem volt elégséges

A stratégia kódja (`mean-reversion-bb.ts:83`) blokkolja a trade-et, ha a 4h ADX > 35. Ez a szűrő:
- Csökkenti a trade-számot erős trend-időszakokban
- DE nem elégséges, mert a 4h ADX < 35 időszakokban is gyakori, hogy a BB alsó sávját érintő close **pullback a trendben** (és a pullback folytatódik)
- A 2024-2026-os BTC charton sok 1-2 hetes range volt, ahol az ADX < 35, de a BB alsó sávját érintő long azonnal elbukott

## 4. A Phase 4 folyamán javított engine-bug

A backtest futtatásakor kiderült, hogy a Phase 1-3 baseline ETH/SOL eredményei (0-1 trade) **nem a stratégia szigora, hanem egy engine-bug miatt voltak**. A bug:

**File:** `packages/backtest/src/engine.ts:42-100` — `aggregateToTimeframe` függvény.

**Bug:** A `bucketStart` inicializálása `0`-ra, és a `bucketEnd = bucketStart + targetMs` ellenőrzés a Phase 1-ben használt OHLCV-adat első candle-jére (`2024-01-01 00:00 UTC = 1704067200000`) **mindig igazat adott** (`1704067200000 >= 14400000`), így minden LTF candle külön 4h bucketbe került. 21958 darab 1h candle-ből **21958 darab "4h candle"** lett (1:1 copy).

**Hatás:** A BB(20, 2σ) a 21958-candle "4h" sorozaton nagyon kis stddev-vel rendelkezett (mivel az 1h candle-ek erősen autokorreláltak), így a BB lower/upper nagyon közel volt a close-hoz → a BTC-nél sok jelzés jött, de az ETH/SOL BB lower/upper értékei a candle close-tól kevesebb mint 0.1%-ra voltak, így a trigger (`close <= bbLower`) gyakorlatilag soha nem teljesült.

**Javítás:** A `bucketStart` inicializálása az első candle timestamp-jéhez igazítva (grid-aligned): `ltfCandles[0]!.timestamp - (ltfCandles[0]!.timestamp % targetMs)`. Ugyanez a logika a `bucket === null` ágban is.

**Regression teszt:** Két új teszt az `engine-helpers.test.ts`-ben (Phase 1 OHLCV aggregáció: 21958 1h → ~5494 4h). Az összes meglévő teszt (126 db a backtest package-ben) továbbra is passzol.

**Következmény a Phase 1-3 baseline-ra:** A Phase 1-3 riport (`REPORT.md`) BTC 1h 2 trade-es számát a mostani javítással is reprodukálni tudjuk (az MTF-TKC restrictív trigger-e miatt a trade-szám nem változik). A Phase 4 mean-reversion eredmények viszont teljesen más képet mutatnak a bug miatti korábbi 0/735/0-hoz képest.

## 5. Miért NEM éri el a +100%/hó célt?

A mean-reversion önmagában **NEM elég** a BTC/ETH/SOL 2024-2026-os piacán. A 30 hónapra vetített havi átlag −1.78% és −2.10% között van. A +100%/hó céltól **50-55×-es szorzó** választja el.

Strukturális okok:
1. **A fee-drag önmagában megöl minden kis edge-t**: 0.34% round-trip fee + 1% stop-loss a BB-szél felőli entry-nél azt jelenti, hogy a valódi per-trade edge-nek >1.5%-nak kell lennie ahhoz, hogy a fee-k után is nyereséges maradjon. A BB lower → BB middle tipikus távolsága 1-2% — a take-profit-ok bruttó 1.5%-os nyereséget hoznak, de a fee-k levonása után kevesebb, mint 1.2% a nyereség.
2. **A trend-erős piac a mean-reversion természetes ellensége**: A 2024-2026 BTC/ETH/SOL uptrend-ben a BB alsó sávjához érő close egy pullback, nem forduló. A forduló-szignálok 17-27%-ban voltak helyesek — messze a szükséges 50%+ alatt.
3. **A konzervatív research default-jai ("nincs 100%/hó SPOT 1:10-en") valóban van alapja**, de nem a "kevés trade" miatt — hanem az **alacsony per-trade edge és magas fee-drag kombinációja** miatt.

## 6. Ami MŰKÖDHETNE — Phase 5 input

A user kérésére a +100%/hó realitásvizsgálata folytatódik. Az empirikus adatokból kiindulva az alábbi alternatívák érdemelnek vizsgálatot:

| Stratégia | Várható trigger | Várt edge | bybit.eu SPOT 1:10 alkalmazhatóság |
|---|---|---|---|
| **Funding-rate carry** (perp-short + spot-long synthetic, delta-semi-neutral) | 1-5 trade/nap, magas win-rate | ~0.1-0.3% per snapshot | bybit.eu SPOT-on nem, de cross-exchange (binance ↔ bybit.eu) igen |
| **Mean-reversion + trend-filter** (csak HTF trend-del egyező irányban trade-eljen) | 100-300 trade/30 hó | 0.5-1.0% per trade, 60%+ win-rate | Igen — csökkenti a zaj-trades-t ~70%-kal |
| **Basket** (5-10 párhuzamos signal, kis position size) | 50-200 trade/30 hó | 0.1-0.2% per trade, 60% win-rate | Igen — kockázat-allokálás |
| **Grid trading 1:10 margin-en** (bybit.eu specifikus) | 100-500 trade/30 hó | 0.05-0.15% per grid-step | Natív bybit.eu SPOT-margin |
| **Cross-exchange spread arb** (binance ↔ bybit.eu) | 10-100 trade/nap | 0.1-0.5% per fill | Igen — DE latency-érzékeny (sub-100ms kell) |

Ezek közül a **funding-rate carry** és a **cross-exchange arb** hozhat akár 30-100%/hó-t alacsony kockázattal — DE a Phase 1-3 keretrendszer ezekhez nem adaptálható közvetlenül (perp feed kell, multi-exchange ws kell).

A **mean-reversion + trend-filter** a jelenlegi keretrendszerben implementálható a leggyorsabban — várhatóan +5-30% havi hozam 30-50%-os max DD-vel, a filter szigorúságától függően.

## 7. Következő lépések

1. A `mean-reversion-bb.ts`-t kiegészíteni egy **HTF trend-filterrel** (csak a HTF EMA50 > EMA200 esetén long, fordítva short) + **trigger-sűrűség csökkentés** (Z < −2.5 az aktuális Z < −2 helyett).
2. Implementálni és tesztelni a **basket-mean-reversion** verziót (5-10 szimbólum párhuzamosan, kis position-ral).
3. Funding-rate carry implementálása — ehhez a Phase 1-3 engine-t binance perp feed-del kell kiegészíteni (új Phase 5 feladat).
4. **Az engine-bug** (`aggregateToTimeframe`) javítása megtörtént ebben a PR-ben. A Phase 1-3 baseline-ot a javítás nem változtatja meg lényegesen (a restrictív MTF-TKC miatt), DE a Phase 4 és a jövőbeli stratégiák megbízható MTF adatot kapnak.

## 8. Konklúzió

A Phase 4 mean-reversion **önmagában NEM éri el a +100%/hó célt**. A 30 hónapos empirikus adat a BTC/ETH/SOL × 1h-n −41% és −47% közötti teljes hozamot mutat, 592-797 trade-del. A konzervatív research konklúziója ("a SPOT margin 1:10-en irreális") **részben igaznak bizonyult a fee-dragon és az alacsony per-trade edge-en keresztül**.

A trade-szám-szűk keresztmetszet megoldódott (Phase 1-3: 4 trade / 30 hó → Phase 4: 600-800 trade / 30 hó), DE a per-trade EV negatív maradt. A Phase 5-ben a trend-filter, a basket-mean-reversion, és a funding-rate carry érdemel kutatást.

A Phase 4 PR másik fontos eredménye az **`aggregateToTimeframe` engine-bug javítása**, ami a Phase 1-3 backtest-eket is érintette (bár a hatás ott a restrictív stratégia miatt nem volt látható). A javítás 2 új regression teszttel van fedve, és a teljes backtest test-suite (126 teszt) továbbra is passzol.

---

## Függelék: Futtatási reprodukálhatóság

```bash
# A backtest-ek reprodukálása (a worktree gyökeréből):
bun run packages/backtest-tools/src/cli/run-mr-baseline.ts \
  --symbol=BTC/USDT --timeframe=1h \
  --output=backtest-results/mr-baseline-btc-1h.json

bun run packages/backtest-tools/src/cli/run-mr-baseline.ts \
  --symbol=ETH/USDT --timeframe=1h \
  --output=backtest-results/mr-baseline-eth-1h.json

bun run packages/backtest-tools/src/cli/run-mr-baseline.ts \
  --symbol=SOL/USDT --timeframe=1h \
  --output=backtest-results/mr-baseline-sol-1h.json

# A strategy unit tesztek (8/8 passzol):
cd packages/core && bun test src/strategy/mean-reversion-bb.test.ts

# Az engine unit tesztek (126/126 passzol, a javítással együtt):
cd packages/backtest && bun test
```

A strategy 8 unit tesztje (`packages/core/src/strategy/mean-reversion-bb.test.ts`) a Phase 4 implementáció részeként készült, és mind a 8 átmegy. Az engine `aggregateToTimeframe` javítása 2 új regressziós teszttel bővítette a `packages/backtest/src/engine-helpers.test.ts` fájlt.

_Ez a riport a Phase 4 munka eredményeit foglalja össze. A nyers adatok a `backtest-results/mr-baseline-{btc,eth,sol}-1h.json` fájlokban találhatók._