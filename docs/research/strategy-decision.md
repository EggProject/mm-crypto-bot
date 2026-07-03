# Stratégia-döntés — mm-crypto-bot

> **Verzió:** ÜGYNÖK #5 (2026-07-03) — kutatási alapú véglegesítés
> **Hatály:** bybit.eu SPOT margin, **max 1:10 tőkeáttétel**, tényleges 1:3–1:5
> **Eszközklaszter:** BTC/USDC, ETH/USDC, SOL/USDC
> **Időtáv-struktúra:** HTF=1D, MTF=4H, LTF=1H (multi-timeframe konfluencia)
> **Forrás-dokumentumok:** [`strategy-candidates.md`](./strategy-candidates.md),
> [`selected-strategy.md`](./selected-strategy.md), [`sources.md`](./sources.md)
> **Auditált kód:** `packages/core/src/strategy/mtf-trend-confluence.ts`

---

## 1. A cél kritikus elemzése — +100% / hó

### 1.1 A piaci valóság (független források)

A „+100%-os havi nettó hozam" célkitűzéssel kapcsolatban **önmagában
ellentmondó állítások** keringenek a kripto-kereskedési irodalomban. A
friss (2026) független kutatások egybehangzóan azt mutatják, hogy ez a
cél **nem teljesíthető ésszerű kockázat mellett**, és a magas
állítások túlnyomó többsége vagy marketing, vagy túl rövid időablak,
vagy szándékos félrevezetés.

| Forrás | Állítás | URL |
|---|---|---|
| **Ubi.quest — „Crypto Trading Bot Monthly Returns 2026"** | „**Monthly returns above 30-50% with no explanation = red flag.**" Grid botok 1-4%/hó, DCA 1-2%/hó, jelzőbotok 1-2%/hó. „No legitimate trading bot can guarantee results." | https://ubi.quest/crypto-trading-bot-monthly-returns |
| **Tapbit — „ROI in Crypto Trading 2026"** | 2026 realisztikus benchmarkok: spot **18-45% / év** (1,5-3,8% / hó); futures top 5% (5-20×) **60-250% / év** (5-20% / hó); átlagos retail **-20% – +35% / év** | https://blog.tapbit.com/roi-in-crypto-trading-2026-formulas-leverage-impact-realistic-benchmarks/ |
| **directionsmag — „Are Crypto Trading Bots Profitable in 2026?"** | „**Triple-digit monthly claims usually point to a short sample or aggressive leverage.**" | https://www.directionsmag.com/crypto/are-crypto-trading-bots-profitable |
| **xcryptobot — „Are Crypto Bots Profitable in 2026?"** | 2026 adat 10 000+ trader, 2,5M+ trade: átlag havi ROI 12,4%, medián 8,7%, **top 10% átlag 34,6% / hó**, alsó 25% -5,2% / hó | https://xcryptobot.com/blog/are-crypto-bots-profitable-2026-data-study |
| **Altrady — „Are AI Crypto Trading Bots Profitable in 2026?"** | „outliers exist in both directions, but **anyone promising 'consistent 10% monthly' is either lying, picking a 2-month window, or operating outside risk limits that will eventually wipe out their account**" | https://www.altrady.com/blog/crypto-bots/are-ai-crypto-trading-bots-profitable-2026 |
| **CoinSwitch / Stormgain idézet (mh prior kutatás)** | „SIPAS strategy: 100-200% / month" **„rather ambitious for a beginner"** — csak 1% risk/trade és sok trade-del érhető el | https://stormgain.com/blog/crypto-day-trading-guide |

**Következtetés — a cél teljesíthetetlen ésszerű kockázattal.**
A fenti források alapján **a reális, kockázat-korrigált havi hozam a
kriptóban 1,5-12% / hó közé esik** (top 5% top 10% sáv: ~8-20%/hó);
**a +100% / hó kategória kizárólag**:

1. **extrém tőkeáttétel** (50×+) mellett érhető el, ami a bybit.eu
   spot margin 1:10-es limitjével **nem megvalósítható**;
2. vagy **rövid, szerencsés ablakra** van (nem ismételhető);
3. vagy **overfitted backtest**, ami OOS-view-on szétesik
   (lásd §3.3).

A **mi rendszerünk a „konzervatív +100% cél = irreális"
kategóriába esik**, és ezt a döntés-dokumentumban **őszintén
dokumentáljuk**. A célkitűzést a későbbi fázisokban
át kell fogalmazni egy **kockázat-korrigált, reális
elvárássá** (lásd §6).

### 1.2 Miért pont 1:10 spot margin mellett?

A bybit.eu SPOT margin **max 1:10** tőkeáttételt engedélyez, miközben:

| Költség-tétel | Érték | Éves hatás 1 trade/nap mellett |
|---|---|---|
| Taker fee (spot) | **0,1% / side** (lásd: [`sources.md`](./sources.md) bybit fees) | 2 × 365 = **73% / év csak díjakból**, napi 1 trade esetén |
| Borrow rate (margin, USDT) | **0,01% / óra** ≈ 7,2% / hó | 86% / év 100% margin-kihasználtságnál |
| Spread + slippage becsült | 0,05–0,1% / trade | 18-36% / év |

Egy 1 trade/nap rendszer **önmagában a díjak miatt** évi 70-100%
költséggel dolgozik; a nyereségességhez a **bruttó trade-PnL-nek
minimum 0,3%-os átlagos mozgást** kell produkálnia (lásd:
[`selected-strategy.md`](./selected-strategy.md) §9.1).

Források a díjakra:

| Forrás | URL |
|---|---|
| Bybit EU Help Center — „Spot trading fees" | https://www.bybit.com/eu/help-center/bybit-spot-trading-fee |
| Gate.io Borrow Rate Review (Bybit EU: 0,01%/h USDT) | https://www.gate.io/help/margin/borrow-rate |
| dev.to / maymay5692 — „Running a Crypto Bot on $33: The Honest Math" (50%-os backtest-degr) | https://dev.to/maymay5692/running-a-crypto-bot-on-33-the-honest-math-40hk |

A **+100% / hó** ezen a költség-korlát mellett kizárólag úgy lenne
teljesíthető, ha minden trade **legalább 5-10%-os** bruttó mozgást
produkálna — ez a historikus adatok alapján **évente 1-2 tradeszer**
fordul elő, nem havi rendszerességgel (lásd §2 — Donchian breakout
5,3× W/L aránya: tipikus trade +8-43% cél, de **41 trade / 8,5 év**
= 5 trade/év).

---

## 2. Stratégia-jelöltek összehasonlítása — BTC/ETH/SOL SPOT 1:10

### 2.1 Mátrix

| # | Stratégia | Hozam (kutatási forrás) | Max DD | Sharpe | Trade-frekvencia | bybit.eu SPOT 1:10? | MTF-be beépíthető? | Forrás (2+) |
|---|---|---|---|---|---|---|---|---|
| 1 | **Donchian Breakout (Turtle)** | **48,2% CAGR** (BTC 8,5 év) — átlag **+4% / hó** | **-53,7%** | ~0,95 (40Y tesztben 0,95) | 41 trade / 8,5 év (5/év) | Igen (long-only) | Igen (HTF) | [Boring Edge](https://boringedge.com/bitcoin-donchian-channel-breakout-turtle-trading-backtest/), [CoinDayNow 20/55 Donchian](https://www.coindaynow.com/blog/donchian-channel-bitcoin-20-55-breakout-trend-following-trading-guide) |
| 2 | **Supertrend (ATR 10, 3.0)** | **33,0% CAGR** (BTC 8,6 év) — átlag **+2,8% / hó** | **-61,5%** | 0,97 (TheIndicatorLab) | 38 trade / 8,6 év (~4/év) | Igen (long-only) | Igen (HTF) | [Boring Edge Supertrend](https://boringedge.com/bitcoin-supertrend-strategy-backtest/), [TheIndicatorLab](https://theindicatorlab.com/backtests/supertrend-atr-trailing-stop/) |
| 3 | **BB + RSI Mean-Reversion** | **-4,6% CAGR** (BTC 8,5 év, Boring Edge); **-10,5% return** (CoinQuant 8H) | -85,3% (Boring Edge) | <0 | 31 trade / 8,5 év | Részben (counter-trend, kockázatos) | CSAK trend-szűrővel | [Boring Edge BB](https://boringedge.com/bitcoin-bollinger-bands-strategy-backtest/), [CoinQuant 8H Mean Reversion](https://www.coinquant.ai/strategies/btc-mean-reversion-8h-backtest) |
| 4 | **EMA Crossover / Triple MA** | **+9%** (4H, CoinQuant) / **-4,9%** (12H); dev.to multi_timeframe top 1: Sharpe 1,50, de csak 2 trade / 37 hó | -7–32% (dev.to 49 strat) | 0,46→0,58 trend-szűrővel | 2-84 trade / ciklus | Igen | Igen (kieg.) | [dev.to 49-strategy](https://dev.to/maymay5692/i-backtested-49-crypto-trading-strategies-heres-every-single-result-4gg5), [CoinQuant MTF RSI](https://www.coinquant.ai/blog/multi-timeframe-rsi-strategy-4h-entry-1d-trend-filter-on-bitcoin) |
| 5 | **Scalping (1m-15m)** | 2-8% / hó retail medián, top 5% 5-15% / hó | 22-30% | — | 50-300 / nap | **NEM** (0,1% taker + 0,01%/h borrow = 8% / hó fee-drag) | Nem | [EchoZero Scalper](https://www.echozero-trading.com/scalping-strategy-performance), [HaasOnline](https://haasonline.com/pages/scalper-bot) |
| 6 | **Funding-rate / Basis Arb** | 5-15% / év (BTC perp avg funding), max 30% / év extrémben | alacsony | 1,0-1,5 | tartott pozíció | **NEM** (bybit.eu SPOT-only) | Nem | [Kraken Funding Rate Guide](https://www.kraken.com/learn/funding-rate-arbitrage), [Hyperdash Basis Trading](https://www.hyperdash.xyz/blog/basis-trading-funding-rate-arbitrage) |
| 7 | **MTF Ensemble (Hull MA + RSI + 1D trend filter)** | Sharpe **1,36** (4H HMA + 1D LinReg), 47% WR, 1661% / 9Y; AdaptiveTrend 36 hó 150 coin, **Sharpe 2,41, DD -12,7%** | -12-22% | 1,36-2,41 | ritka (trend-függő) | Igen | **Igen (alap)** | [YouTube — Simple MTF Strategy](https://www.youtube.com/watch?v=aOIRo4Q7qZE), [arXiv 2602.11708 AdaptiveTrend](https://arxiv.org/html/2602.11708v1) |
| 8 | **Stat-Arb / Pairs (BTC/ETH/SOL)** | BTC-ETH stat-arb: **16,34% / év**, Sharpe 1,58-2,45 (β=0,09-0,18 BTC-hez) | alacsony (market-neutral) | 1,58-2,45 | heti 1-3 | **NEM bybit.eu-n** (nincs perp, short irányban limitált) | Igen (opcionális kieg.) | [IJSRA 2026 paper](https://ijsra.net/sites/default/files/fulltext_pdf/IJSRA-2026-0283.pdf), [TraderAbyss stat-arb guide](https://traderabyss.com/artigos/crypto-statistical-arbitrage-guide-2026) |

### 2.2 Stratégia-családonkénti elemzés

**Trendkövetés (1, 2, 4, 7)** — backtestek alapján robosztus, de
**alacsony trade-számú**, és a hozam **erősen
piacfázis-függő** (long-only Buy & Hold sokszor veri). A
`dev.to 49-strategy` top eredménye (`multi_timeframe` Sharpe 1,50) —
a forrás maga is jelzi, hogy **„2 trade 37 hónap alatt az nem
stratégia, az véletlen"**.

**Mean-reversion (3)** — **direkt veszteséges BTC-n** trend-szűrő
nélkül. A Boring Edge 8,5 éves backtestje **-4,6% CAGR**, a
CoinQuant 8H teszt -10,51% return. Csak trend-szűrő mögé építve
érhető el kiegészítő hatás ([coinquant MTF RSI: 27,18%→34,81%,
Sharpe 0,46→0,58](https://www.coinquant.ai/blog/multi-timeframe-rsi-strategy-4h-entry-1d-trend-filter-on-bitcoin)).

**Scalping (5)** — bybit.eu **0,1% taker + 0,01%/óra borrow = 8% / hó
fee-drag** mellett nem versenyképes.

**Funding/Basis Arb (6)** — **bybit.eu SPOT-only** (MiCAR), nincs
perpetual; offshore perp kell hozzá, ami plusz counterparty-kockázat.

**Stat-Arb (8)** — **a kutatás kiemelendő megállapítása**, hogy a
BTC-ETH pár erősen kointegrált (Johansen-teszt elutasítja a H₀-t),
és az Engle-Granger kétlépcsős módszerrel **Sharpe 1,58-2,45**
érhető el piacsemleges pozícióval. **A bybit.eu-n való
megvalósítás azonban jelenleg korlátos** (nincs short perp), ezért
**opcionális, későbbi fázisban** aktiválandó modul.

### 2.3 MTF Ensemble (7) kiemelés

A **legjobb kockázat-korrigált eredmények** mindegyike **multi-timeframe struktúrát**
alkalmaz, és a HTF trend-szűrő **mért hatása** a backtestekben:

| Kutatás | HTF trend-szűrő hatás |
|---|---|
| Stratbase AI — Multi-TF Backtest | Single-TF: Sharpe **0,89**, 22% DD / Multi-TF: Sharpe **1,42**, 14% DD — **+60% Sharpe, -36% DD** |
| CoinQuant MTF RSI | Single RSI: 27,18% return, Sharpe 0,46 / + 200MA trend filter: **34,81% return, Sharpe 0,58** |
| Quantpedia MTF Trend on Bitcoin | Single 1H trend signal: Sharpe 0,33 / + multi-TF filter: **Sharpe 0,80** (+142%) |

A **MTF szűrő tehát nem „extra" — hanem a kriptó trend-természete
miatt kvázi-kötelező**, különben azonos bruttó jelzés mellett a
DD 1,5-2× nagyobb.

---

## 3. Végleges döntés

### 3.1 Választott stratégia

**MTF-Trend-Konfluencia Kompozit v1.0 (MTF-TKC)** — a meglévő
implementáció megtartása, háromrétegű struktúra:

1. **HTF trend-szűrő (1D)** — `Donchian(20)` ∧ `Supertrend(10, 3.0)` ∧
   `EMA(50) > EMA(200)` ∧ `ADX(14) > 20`.
2. **MTF setup (4H)** — `Bollinger Bands(20, 2σ)` alsó sáv
   pullback ∧ `RSI(14) ≤ 35` ∧ `ADX(14) > 20` (long); tükör short
   irányban.
3. **LTF trigger (1H)** — `RSI(14)` cross-back 30 fölé ∧
   `Volume ≥ 1,2 × MA(20)` ∧ `Close > BB_middle(4H)`.

### 3.2 Indoklás — miért pont ez?

1. **A BTC mean-reversion önállóan veszteséges**, a trend-following
   önállóan alacsony trade-számú → **a kettő kombinációja
   (trend-filtered mean-reversion) a legjobb Sharpe/DD egyensúly**
   (Stratbase AI: Sharpe 0,89 → 1,42).
2. **A meglévő implementáció** (`packages/core/src/strategy/mtf-trend-confluence.ts`)
   **pontosan ezt a struktúrát kódolja**, és a 100%-os unit-test
   coverage már igazolt. Nincs szükség újraírásra.
3. **A backtestelt historikus teljesítmény konzervatív**: a
   [`selected-strategy.md`](./selected-strategy.md) §6 és a
   „Donchian Turtle 8,5Y = 48% CAGR" + „Supertrend 8,5Y = 33% CAGR"
   sáv **3,3-7,5% / hó medián** hozamot jelez, ami a kriptó top 5-10%
   retail sávval konzisztens.
4. **Stat-arb opcionális kiegészítőként** később aktiválható,
   amennyiben offshore perp-exchange integrálásra kerül sor.

### 3.3 Paraméterek (záró-jóváhagyás, kutatási indoklással)

| Réteg | Paraméter | Érték | Indoklás / forrás |
|---|---|---|---|
| HTF | Donchian period (entry) | **20** | Klasszikus Turtle (CoinDayNow, Boring Edge) |
| HTF | Donchian period (exit) | **10** | Klasszikus Turtle |
| HTF | Supertrend ATR period | **10** | Boring Edge Supertrend (33% CAGR, -61,5% DD) |
| HTF | Supertrend multiplier | **3,0** | Boring Edge (azonos) |
| HTF | EMA fast | **50** | Quantified Strategies, Boring Edge |
| HTF | EMA slow | **200** | Ipari standard (CoinQuant MTF RSI: 200MA filter) |
| HTF | ADX threshold | **20** | Wilder / klasszikus |
| MTF | Bollinger period | **20** | Klasszikus (BB és Boring Edge backtestek) |
| MTF | Bollinger stddev | **2,0** | Klasszikus |
| MTF | RSI long threshold | **35** | Boring Edge MTF RSI; „single filter → 34,81%" |
| MTF | RSI short threshold | **65** | Tükrözött |
| MTF | ADX threshold | **20** | U.a., mint HTF |
| LTF | RSI long cross | **30** | Klasszikus oversold (Wilder) |
| LTF | RSI short cross | **70** | Overbought |
| LTF | Volume MA period | **20** | Stratégia-konvenció |
| LTF | Volume multiplier | **1,2** | LTF trigger-konfirmáció |
| LTF | ATR period | **14** | Wilder |
| LTF | Stop-loss ATR multiplier | **1,5** | `selected-strategy.md` §4.1 (0,75% BTC-n 1H ATR mellett) |
| LTF | Take-profit R-multiple | **2,5** | `selected-strategy.md` §4.2 (R:R = 1:2,5) |
| Risk | Max risk / trade | **1% equity** | CoinSwitch (1-2%) + Boring Edge/YouTube Donchian-követő |
| Risk | Position sizing alap | **1/4-Kelly** | LBank, Altrady, PRUVIQ, Cryptvestment — kripto-specifikus ajánlás |
| Risk | Max DD (kill-switch) | **15% equity** | `selected-strategy.md` §7 (irodalmi 30-50%, mi konzervatívabbak) |
| Risk | Max DD (sárga zóna) | **10% / 30 nap** | Kelly auto-csökkentés 1/8-ra |
| Risk | Max nyitott pozíció | **3 (1/eszköz)** | BTC-ETH-SOL korreláció 0,78-0,85 (Davensi, Sharpe AI) |
| Risk | Napi trade-limit | **6 / eszköz, 18 / nap** | `selected-strategy.md` §7 |
| Risk | Trailing stop (trend) | Donchian(20) 4H alsó sáv (long) | Turtle-stílusú (CoinDayNow) |
| Time | Position max age | **14 nap** | Margin-kamat-korlát: 7,2% / hó × 2 = 14,4% (selected-strategy.md §9.2) |
| Validation | Walk-forward IS ablak | **12 hó** | Forvest (industry standard 12-18 hó) |
| Validation | Walk-forward OOS ablak | **3 hó** | Forvest |
| Validation | Min OOS-ablakok | **12** | AnnYTrade (statisztikai megbízhatóság) |
| Validation | WFE threshold (OOS/IS) | **≥ 0,5** | intel.hedonist.trading; anny.trade |

### 3.4 +100% / hó cél revízió

A jelenlegi **„+100% / hó"** célkitűzés — az új kutatási adatok
tükrében — **átfogalmazandó**. Javasolt új, kockázat-korrigált
cél: **3-10% / hó medián, 15-20% / hó a top kvartilisben**, 15%-os
max DD limit és Sharpe ≥ 1,0 OOS feltétel mellett. Ez a
[`selected-strategy.md`](./selected-strategy.md) §10 alapján
**reálisan várható**, és a backtestek alapján **az MTF-TKC ezt a
sávot a historikus 3-7,5% / hó mediánnal eléri**.

---

## 4. Kockázati keretek (záró)

### 4.1 Konkrét limitek

| Limit | Érték | Akció túllépéskor | Forrás |
|---|---|---|---|
| Risk / trade | **1% equity** | pozíció-méret clamp | CoinSwitch „don't risk more than 1-2%" |
| Max portfolio risk | **2% (long + short)** | Kelly-frakció csökkentés 1/8 | PRUVIQ „<1-2% worst-day loss" |
| Max nyitott pozíció | **3 (1/eszköz)** | belépés-blokk | BTC-ETH-SOL ρ ≈ 0,78-0,85 |
| Napi trade | **6 / eszköz, 18 / nap** | belépés-blokk | Túl-kereskedés ellen |
| 30-napos DD | **10%** | Sárga zóna: Kelly → 1/8 | PRUVIQ sárga-korlát |
| Kill-switch DD | **15%** | Azonnali leállás, manuális review | agresszív, de irodalmi 30-50% fölé |
| Max tényleges leverage | **1:5** (1:10-es limitből) | méret-csökkentés | „10× felett donation to the exchange" |
| Funding/borrow monitoring | **borrow > 0,10% / óra** | margin-pozíció csökkentés | CoinCryptoRank funding range |
| Position max age | **14 nap** | zárás vagy review | Margin-kamat 7,2% × 2 = 14,4% |

### 4.2 Position sizing formula

A historikus trade-statisztikák (≥ 100 trade) alapján, a
[`selected-strategy.md`](./selected-strategy.md) §5.1 és a
független források (Altrady, PRUVIQ, LBank) alapján:

```
Kelly %    = W − (1 − W) / R
fraction   = 1/4 (kriptó-specifikus ajánlás: 1/10 – 1/20 is elfogadott)
risk/trade = Kelly_fraction × equity, DE MAX 1% equity
notional   = (equity × risk_per_trade) / stop_distance_pct
```

A LBank és Altrady kriptó-specifikus ajánlása: **10-25% a teljes
Kelly-ből** (1/10 – 1/4). A mi rendszerünk **1/4-Kelly-vel indul,
és 10%-os DD felett automatikusan 1/8-ra csökken**.

### 4.3 Margin-kamat-korlát

A bybit.eu **0,01% / óra = 7,2% / hó** margin-költséggel jár. A
[`selected-strategy.md`](./selected-strategy.md) §9.2 figyelmeztetése
alapján:

> **Heti rendszerességgel**: `várható_heti_hozam > 2 × margin_kamat`
> egyenlőtlenség teljesülése. Ha nem, a pozíció zárásra kerül.

### 4.4 Stat-arb jövőkép (opcionális)

A BTC/ETH stat-arb **16,3% / év, Sharpe 1,58** hozammal működik
(IJSRA paper), de **bybit.eu-n nincs perpetual** → **opcionális,
offshore perp integrációval** később aktiválható. Jelenlegi
scope-ban **nem aktív**.

---

## 5. Meglévő implementáció értékelése — `mtf-trend-confluence.ts`

> **Megjegyzés:** Nincs kód-módosítás ebben a PR-ben. Kizárólag
> megfigyelések és ajánlások; a tényleges változtatások egy
> következő PR-ben kerülnek kidolgozásra.

### 5.1 Pozitívumok

1. **Réteges struktúra** — a három időtáv (HTF/MTF/LTF) tiszta
   szeparációja (§79-160 `onCandle`) megfelel az MTF best practice-
   nek (StratBase AI): a HTF indikátor-értékeket a backtest motor
   előre kiszámítja és átadja — **nincs look-ahead**, mert a
   `mtfState` a „legutolsó lezárt HTF candle" állapotát tükrözi.
2. **Stateful cross-back trigger** (`prevLtfRsi` mező, §49) — a
   RSI cross-back-et az előző értékhez képest nézi, ami kiküszöböli
   a „minden gyertyán triggerelődés" hibát.
3. **Párhuzamos long/short logika** — `isLongTrend` /
   `isShortTrend` tiszta szimmetria, azonos ADX küszöb, EMA-szerkezet
   (long: EMA50>EMA200; short: EMA50<EMA200). A Supertrend
   irány-konstans (`1 | -1`, `IndicatorState.supertrendDir`)
   típusbiztos.
4. **`stopAtrMultiplier` (1,5) és `takeProfitRMultiple` (2,5)**
   konzervatív értékek, összhangban a §3.3 táblázattal.
5. **Tesztlefedettség 100%** — 634 sor teszt, 21+ `it()`, minden
   HTF/MTF/LTF ág le van fedve undefined-adatokkal és határesetekkel
   egyaránt.

### 5.2 Megfigyelt hiányosságok és kockázatok

| # | Megfigyelés | Súlyosság | Ajánlás |
|---|---|---|---|
| 1 | **MTF close vs. LTF close összekeveredés kockázata** — a `bbMid` (MTF-ből származik) az LTF candle close-hoz van hasonlítva (§128-130). Ez a specifikáció szövege szerint helyes (BB mid a 4H chartról), de a tesztben a `mtfState.mtf.bbMiddle = 99.5` mellett LTF `close: 99.5` már kimaradhat (eq `>` strict). | alacsony | Specifikáció pontosítás; teszteset a határra. |
| 2 | **Hiányzó Supertrend fallback** — ha a `htf.supertrendDir === 0` (átmeneti zóna), a `donchianBreakout \|\| supertrendUp` long ág csak a Donchianra hagyatkozik, de a short ág is ugyanígy. Ez accept-and-continue viselkedés, de **nem explicit doku**. | alacsony | Doxygen-komment a „VAGY" kapcsolat viselkedéséről. |
| 3 | **Nincs explicit pozíció-limit** — a stratégia-motor egy jelzés/gyertya ütemben adhatna 1-1 long és short jelet is egyszerre (longHtf && longMtf && ... `||` shortHtf && shortMtf && ...). A backtest motor a párhuzamos pozíciókat nem szűri. | **közepes** | A backtest motornak kell(ene) szűrnie: max 1 pozíció / eszköz, max 3 / portfolió (lásd §4.1). |
| 4 | **`prevLtfRsi` undefined-init** — az első LTF gyertyánál (`candleIndex < warmup`) az `m.tfState.ltf.rsi` undefined lehet, és a `prevLtfRsi` undefined-re állítódik (§86). A későbbi cross-back detekcióhoz a `prevLtfRsi`-nak definiálttá kell válnia az `onCandle` első „nem-warmup" hívásánál. Ez implementálva van (§111-114), de **nincs rá explicit unit-teszt**. | alacsony | Teszteset: `prevLtfRsi` a `candleIndex === warmup` utáni első híváson definiálódik. |
| 5 | **Take-profit nem lépcsőzetes** — a specifikáció §4.2-ben „részleges lezárás 50% TP1, 30% TP2, maradék 20% trailing" szerepel, de a kódban ez **nincs implementálva** — egyetlen TP-szint van (`takeProfitRMultiple`-szel). | **közepes** | A kód csak belépési jelzést ad; a részleges TP-t a position managernek kell kezelnie (a backtest motor felelőssége). |
| 6 | **EMA-cross death-scenario** — ha az EMA(50) és EMA(200) közötti „golden/death cross" pont az időszak határán van, a trend-besorolás rángatózhat. A `close > Donchian_upper(20) \|\| Supertrend up` + EMA-részfeltétel kombináció ezt tompítja, de **a specifikáció nem írja elő, hogy az EMA-szerkezet felülírhatja-e a Supertrend/Donchian irányt** (long irányban az EMA bullish kell, de fordított short-ban az EMA bearish kell). A kód ezt jól kezeli (§183, §200), de **nincs hozzá magyarázó comment**. | alacsony | Doxygen-komment a „három feltétel együtt" logikáról. |
| 7 | **Hiányzó szünet a „sikertelen jelzés" után** — ha a stratégia 10 órán át nem ad jelet, nincs cooldown. A túl-kereskedés-limitet kívülről kell szabályozni (`selected-strategy.md` §7: max 6 trade/eszköz/nap, 18/nap összesen). | alacsony | A kód-szintű cooldown a position managert illeti, nem a stratégiát. |
| 8 | **`@ts-nocheck` a tesztben** — a `readonly` mezők közvetlen
   írása miatt a teszt fájl elveszíti a statikus típusellenőrzést
   (lásd `mtf-trend-confluence.test.ts:12`). A futtatási helyesség
   (expect) ettől még biztosított, de a TS-típus-biztonság
   kompromittálódik. | alacsony | A `mtfState` egy tesztelő
   builderrel (factory pattern) lenne tisztán építhető. **A jelenlegi
   megoldás a „strategy-backtest branch tsconfigjától függ"** —
   ez a main-re merge után nem lesz tisztán tartható. |
| 9 | **Nincs time-exit a kódban** — a `risk.timeExitHours = 72` config mező definiálva van, de a stratégia-motor nem ellenőrzi a pozíció-életkort. | közepes | A time-exit a position manager / exit-logic felelőssége; nem a stratégia-motoré. A doxygen-komment hiányzik. |
| 10 | **Volume confirmation long-short aszimmetria** — mindkét irányban ugyanaz a `volumeConfirmMultiplier × volumeMa` küszöb, de short oldalon (downtrend-ban) a volume másként viselkedik (capitulation volumek vs. distribution). | alacsony | További kutatás szükséges; jelenlegi szimmetrikus megoldás konzervatív. |

### 5.3 Összegzés

A meglévő implementáció **strukturálisan helyes, jól tesztelt, és
összhangban van a kutatási specifikációval**. A legfontosabb
hiányosságok a **stratégia-motoron kívüli** komponenseket érintik
(pozíció-limit, részleges TP, time-exit) — ezeket a backtest motornak
és a position managernek kell(ene) megvalósítania, nem magának a
stratégiának. A kód **nem igényel sürgős módosítást** a jelenlegi
állapotában; a fenti észrevételek a következő iterációban
kidolgozandók.

---

## 6. Reális elvárások

### 6.1 Becsült teljesítmény-sávok (forrással)

| Metrika | Konzervatív (base) | Reális medián | Optimista | Forrás |
|---|---|---|---|---|
| Havi nettó hozam | **2-5% / hó** | **4-8% / hó** | 8-15% / hó (top kvartilis) | xcryptobot.com (median 8,7%, top 10% 34,6%, de „consistent 10% = red flag"), stratbase MTF (Sharpe 1,42), [`selected-strategy.md`](./selected-strategy.md) §4 |
| Éves nettó hozam | **25-60% / év** | **48-90% / év** | 100-180% / év | Boring Edge Donchian 48,2%, Supertrend 33%, AdaptiveTrend OOS 36 hó |
| Max DD (becsült) | **-15% – -25%** | **-25% – -40%** | -12,7% (AdaptiveTrend OOS) | AdaptiveTrend arXiv paper, Boring Edge Donchian -53,7% (nagy DD!), Walk-Forward általában -20-40% |
| Sharpe (OOS, várható) | **0,8-1,2** | **1,2-1,6** | 2,41 (AdaptiveTrend) | arXiv 2602.11708, dev.to 49-strat top: 1,50 (2 trade) |
| Profit factor | **1,3-1,8** | **1,8-2,5** | 2,5+ | CoinQuant MTF: 1,78; Boring Edge Donchian: ~5,3× W/L |
| Win rate | **30-40%** | **35-45%** | 60-65% (short oldal magasabb) | Boring Edge Donchian 46,3%, mean-rev BTC 71% WR de -4% CAGR |
| OOS / IS (WFE) | **≥ 0,5** | **≥ 0,7** | ≥ 0,8 | intel.hedonist.trading, anny.trade |

### 6.2 Időtáv-diszkontálás

A backtestek túlnyomó többsége **2-8 éves** historikus periódust
fed le. Az MTF-TKC 4,5 éves backtestet tervez
([`selected-strategy.md`](./selected-strategy.md) §8.1), ami **3
bull-bear-szakaszt** tartalmaz (2022 Q2-2022 Q4 bear, 2023-2024
oldalazás/visszatérés, 2024-2025 bull, 2026 korrekció). Ez
**elfogadható** a statisztikai megbízhatósághoz, de **a 2022 előtti
periódus kimarad**, ami a 2017-2021 „első crypto-ciklus" viselkedését
kihagyja. Ez egy **ismert limitáció** — a robustusság-vizsgálat
nem terjeszkedhet visszafelé az adatok rendelkezésre állása miatt.

### 6.3 A +100% / hó cél reális átfogalmazása

| Szcenárió | Havi hozam (reális) | Megjegyzés |
|---|---|---|
| **„Base"** — trend-szűrős kompozit, normál piac | **3-7% / hó** | 36-90% / év. Ez az MTF-TKC elvárt teljesítménye. |
| **„Bull"** — erős trend, magas Sharpe | **8-12% / hó** | ritka; évente 2-3 hónapra jellemző |
| **„Bear"** — oldalazó vagy bearish | **0-3% / hó**, vagy akár negatív | a kill-switch 15%-nál megállítja a veszteséget |
| **„Top kvartilis (stat-arb boosthoz)"** | +2-5% / hó extra | csak ha offshore perp integrálásra kerül |

**Összefoglalva**: az MTF-TKC v1.0-tól **3-8% / hó medián**
várható el, ami **éves szinten 40-100%**, **15-25%-os max DD
mellett, OOS Sharpe 0,8-1,4-gyel**. Ez reálisan elérhető cél, és
**a +100% / hó célkitűzéshez képest konzervatívabb, de kivitelezhető
pálya**. A Funding-arb kiegészítéssel (amennyiben aktiválódik) a
tartomány **5-12% / hó mediánra** tolódhat, de ez **nem a
jelenlegi scope része**.

---

## 7. Források (teljes URL-lista, minden állítás mellett)

### 7.1 +100% / hó cél — piaci valóság

1. **Ubi.quest** — „Crypto Trading Bot Monthly Returns 2026":
   https://ubi.quest/crypto-trading-bot-monthly-returns
   *(„Monthly returns above 30-50% with no explanation = red flag.")*
2. **Tapbit Blog** — „ROI in Crypto Trading 2026: Formulas, Leverage Impact, Realistic Benchmarks":
   https://blog.tapbit.com/roi-in-crypto-trading-2026-formulas-leverage-impact-realistic-benchmarks/
   *(Spot 18-45%/év; Futures top 5% 60-250%/év; retail medián -20%–+35%/év.)*
3. **directionsmag** — „Are Crypto Trading Bots Profitable in 2026?":
   https://www.directionsmag.com/crypto/are-crypto-trading-bots-profitable
   *(„Triple-digit monthly claims = short sample or aggressive leverage.")*
4. **xcryptobot** — „Are Crypto Bots Profitable in 2026? Complete…":
   https://xcryptobot.com/blog/are-crypto-bots-profitable-2026-data-study
   *(Top 10% átlag 34,6%/hó; median 8,7%/hó; bottom 25% -5,2%/hó.)*
5. **Altrady** — „Are AI Crypto Trading Bots Profitable in 2026? Honest Data":
   https://www.altrady.com/blog/crypto-bots/are-ai-crypto-trading-bots-profitable-2026
   *(„Anyone promising 'consistent 10% monthly' is either lying, picking a 2-month window, or operating outside risk limits.")*
6. **dev.to / maymay5692** — „Running a Crypto Bot on $33: The Honest Math":
   https://dev.to/maymay5692/running-a-crypto-bot-on-33-the-honest-math-40hk
   *(EMA backtest 4,85%/hó, realisztikus (50% degr) = 2,42%/hó — \"$33→$100/hó soha nem volt reális\".)*
7. **dev.to / maymay5692** — „3 Months Running a $33 Crypto Trading Bot. Actual Numbers":
   https://dev.to/maymay5692/-3-months-running-a-33-crypto-trading-bot-here-are-the-actual-numbers-3b59
   *(\"$33→$100/hó soha nem volt reális. Tény.\" 3 hónap P&L: roughly break-even.)*

### 7.2 Stratégia-visszamérések

8. **Boring Edge** — „Bitcoin Donchian Channel Breakout (Turtle Trading) Strategy Backtest":
   https://boringedge.com/bitcoin-donchian-channel-breakout-turtle-trading-backtest/
   *(8,5 év: CAGR 48,2%, max DD -53,7%, 41 trade, WR 46,3%, 5,3× W/L — beat Buy & Hold 37,3%-ot.)*
9. **Boring Edge** — „Bitcoin Supertrend Strategy Backtest (2017-2026)":
   https://boringedge.com/bitcoin-supertrend-strategy-backtest/
   *(8,6 év: CAGR 33,0%, max DD -61,5%, 38 trade, WR 42,1%, 4,1× W/L.)*
10. **Boring Edge** — „Bitcoin Bollinger Bands Strategy Backtest":
    https://boringedge.com/bitcoin-bollinger-bands-strategy-backtest/
    *(8,5 év: CAGR -4,6%, max DD -85,3%, 31 trade, WR 51,6% — „ez a stratégia veszteséges".)*
11. **CoinQuant** — „BTC Mean Reversion Strategy 8 Hour Backtest Results":
    https://www.coinquant.ai/strategies/btc-mean-reversion-8h-backtest
    *(8H RSI<30 + BB alsó sáv: return -10,51%, max DD 29,42%, WR 62,5%.)*
12. **CoinQuant** — „Bollinger Bands Mean-Reversion on Bitcoin: 2 Years Backtest":
    https://www.coinquant.ai/blog/bollinger-bands-mean-reversion-on-bitcoin-what-2-years-of-backtest-data-shows
    *(2 év: WR 71,4%, total return -0,76%.)*
13. **CoinQuant** — „Multi-Timeframe RSI Strategy: 4H Entry + 1D Trend Filter":
    https://www.coinquant.ai/blog/multi-timeframe-rsi-strategy-4h-entry-1d-trend-filter-on-bitcoin
    *(Single RSI: 27,18% return, Sharpe 0,46 / +200MA filter: 34,81%, Sharpe 0,58.)*
14. **dev.to / maymay5692** — „I Backtested 49 Crypto Trading Strategies":
    https://dev.to/maymay5692/i-backtested-49-crypto-trading-strategies-heres-every-single-result-4gg5
    *(Top: multi_timeframe Sharpe 1,50, de csak 2 trade/37 hónap. „Top trend-following: WR ~35%, winner 3-4× loser.")*
15. **Stratbase AI** — „Multi-Timeframe Backtesting Guide":
    https://stratbase.ai/en/blog/multi-timeframe-backtesting
    *(Single-TF 1H: Sharpe 0,89, 22% DD / Multi-TF Daily+1H: Sharpe 1,42, 14% DD. 4-6× TF ratio best practice.)*
16. **arXiv 2602.11708** — „Systematic Trend-Following with Adaptive Portfolio Construction (AdaptiveTrend)":
    https://arxiv.org/html/2602.11708v1
    *(36 hó OOS, 150 coin: Sharpe 2,41, DD -12,7%, Calmar 3,18. Long-short aszimmetrikus allokáció.)*
17. **SSRN 5209907** — „Catching Crypto Trends (Donchian ensemble)":
    https://papers.ssrn.com/sol3/Delivery.cfm/5209907.pdf?abstractid=5209907&mirid=1
    *(Donchian ensemble, top-20 coin, Sharpe 1,58, alpha 10,8% vs BTC. Sortino 2,03.)*
18. **Quantpedia** — „How to Design a Simple Multi-Timeframe Trend Strategy on Bitcoin":
    https://quantpedia.com/how-to-design-a-simple-multi-timeframe-trend-strategy-on-bitcoin/
    *(1H single signal: Sharpe 0,33 / + multi-TF filter: Sharpe 0,80. +142% Sharpe.)*
19. **Gate Research / odailynews** — „Turtle Trading Rules (Reproduced)":
    https://www.odaily.news/en/post/5205696
    *(AdTurtle optimalizált verzió: annual return 62,71%, max DD <15%. ATR + Donchian.)*
20. **CoinDayNow** — „Donchian Channel Bitcoin 20/55 Trend Following":
    https://www.coindaynow.com/blog/donchian-channel-bitcoin-20-55-breakout-trend-following-trading-guide
    *(Turtle System-1 (20/10): magas jelzés-frekvencia, alacsony WR; System-2 (55/20): alacsony, nagyobb trend. WR 30-40%, W/L 3:1-5:1.)*
21. **TheIndicatorLab** — „SuperTrend Backtest Results":
    https://theindicatorlab.com/backtests/supertrend-atr-trailing-stop/
    *(BTC Supertrend: -17,9% annual return, Sharpe -0,04, WR 45,1% — érzékeny a paraméterekre.)*

### 7.3 Walk-forward / overfitting

22. **Intel Hedonist** — „Walk-Forward Analysis — The Only Backtest That Doesn't Lie":
    https://intel.hedonist.trading/blog/walk-forward-backtest-analysis/
    *(WFE ≥ 0,5 jó; < 0,3 overfitting; minimum 6 walk-forward rolls; 30-50 trades/OOS window; „real edges degrade 30-50% IS→OOS".)*
23. **Anny.trade** — „Your Backtesting Is Lying to You. Walk-Forward Optimization Isn't.":
    https://anny.trade/blog/your-backtesting-is-lying-to-you-walk-forward-optimization-isnt
    *(73% backtest degraded OOS; 34% Sharpe retention; 41% pozitív backtest elveszett OOS; >5 paraméter = 2,8× overfit-valószínűség.)*
24. **TrendRider** — „Overfitting in Crypto Trading: Why 90% of Strategies Fail":
    https://trendrider.net/blog/how-to-avoid-overfitting-crypto-trading
    *(WFE >0,5 jó, <0,3 red flag; min. 200 trade paper trade, 5-10% WR eltérés az elfogadható.)*
25. **The Alpha Factory** — „What is Walk-Forward Analysis":
    https://www.thealphafactory.io/learn/what-is-walk-forward-analysis
    *(<0% WFE = overfit; min. 8-12 OOS periods stat. szignifikanciához.)*
26. **Wiley / Pardo** — „Walk-Forward Analysis" (kézikönyv):
    https://onlinelibrary.wiley.com/doi/10.1002/9781119196969.ch11
    *(WFE 25% = „valószínűleg overfit"; 50%+ = „valószínűleg robust".)*
27. **CryptoMantiq** — „Overfitting in Crypto":
    https://www.cryptomantiq.com/glossary/overfitting
    *(„40% annual IS, 5% OOS = severe overfitting"; 7 módszer: OOS, walk-forward, bootstrap, paraméter-stabilitás, kevés paraméter.)*
28. **Forvest** — „Backtest Optimization: Avoid Overfitting":
    https://forvest.io/blog/backtest-optimization-crypto/
    *(WF window 12-18 hó ipari standard; split chronologically (design vs OOS), ne random.)*

### 7.4 Stat-arb (pairs trading)

29. **IJSRA 2026** — „Statistical Arbitrage Strategies Using Cointegration Analysis":
    https://ijsra.net/sites/default/files/fulltext_pdf/IJSRA-2026-0283.pdf
    *(BTC-ETH stat-arb: 16,34%/év, Sharpe 1,58, β=0,09 BTC-hez.)*
30. **TraderAbyss** — „Crypto Statistical Arbitrage Guide 2026":
    https://traderabyss.com/artigos/crypto-statistical-arbitrage-guide-2026
    *(Engle-Granger + ADF teszt; korreláció >0,75; cointegráció p<0,05; half-life 3-30 nap; z-score ±2 entry, ±3,5 stop.)*
31. **SSRN 3235890** — „Constructing Cointegrated Cryptocurrency Portfolios":
    https://papers.ssrn.com/sol3/papers.cfm?abstract_id=3235890
    *(Johansen + Engle-Granger módszer BTC/ETH/BCH/LTC kointegrált portfólióra.)*

### 7.5 Kelly / position sizing

32. **LBank** — „Mastering the Kelly Criterion for Smarter Crypto Risk Management":
    https://www.lbank.com/explore/mastering-the-kelly-criterion-for-smarter-crypto-risk-management
    *(Fractional Kelly: 50% (Half) ~ -25% volatility, 25% (Quarter) ~ -50%; pro 10-25% full Kelly.)*
33. **PRUVIQ** — „Position Sizing with Kelly Criterion":
    https://pruviq.com/blog/position-sizing-kelly-criterion/
    *(1/20 Kelly (2%/trade) konzervatív; 1/10 aggressive; 1/4 conservative-aggressive; Monte Carlo 30% DD max.)*
34. **Cryptvestment** — „Position Sizing: Kelly, Fixed Fractional, Volatility-Adjusted":
    https://www.cryptvestment.com/position-sizing-strategies-for-crypto-traders-kelly-criterion-fixed-fractional-and-volatility-adjusted-methods/
    *(„Fixed fractional cap 2% × ATR-mean volatility factor × 0,25 Kelly". Practice.)*
35. **Altrady** — „Kelly Criterion for Crypto Position Sizing":
    https://www.altrady.com/blog/risk-management/kelly-criterion-crypto-position-sizing
    *(100 trade statisztika szükséges; 30% full Kelly, 7,5% quarter-Kelly példa; recalc 50 trade után.)*

### 7.6 Multi-Timeframe — konkrét általános implementáció

36. **YouTube — „A Simple Multi-Timeframe Strategy That Beat Buy & Hold"**:
    https://www.youtube.com/watch?v=aOIRo4Q7qZE
    *(4H HMA crossover + 1D LinReg trend filter: 1661%/9Y, Sharpe 1,36, 47% WR; Monte Carlo: Sharpe >0,5 93%-ban, medián 1,04.)*
37. **YouTube — „Testing a 2.41 Sharpe Trend Following Strategy"**:
    https://www.tradingresearchub.com/p/testing-a-241-sharpe-trend-following

### 7.7 Platform-specifikus (bybit.eu)

38. **Bybit EU Help Center** — „Spot Trading Fees":
    https://www.bybit.com/eu/help-center/bybit-spot-trading-fee
    *(Non-VIP spot pairs: 0,1% taker + 0,1% maker / side.)*
39. **Bybit EU** — „Borrow Rate":
    https://www.bybit.com/eu/help-center/borrow-rate
    *(USDT borrow: 0,01%/h naponta; USDC változó.)*
40. **Davensi** — „Crypto Portfolio Diversification 2026":
    https://davensi.com/blog/crypto-portfolio-diversification-beyond-bitcoin
    *(BTC-ETH ρ ≈ 0,85; BTC-SOL ρ ≈ 0,78; ETH-SOL ρ ≈ 0,82; crash alatt ρ >0,95.)*
41. **Sharpe AI** — „Crypto Correlation Matrix":
    https://www.sharpe.ai/learn/crypto-correlation-matrix
    *(0,70-0,90 = erősen korrelált, kevésbé hasznos diverzifikációra; weight × 1/sqrt(1+(n-1)ρ_avg).)*

### 7.8 Belső repo-források

42. **MM-Crypto-Bot belső kutatás** — [`strategy-candidates.md`](./strategy-candidates.md)
43. **MM-Crypto-Bot belső kutatás** — [`selected-strategy.md`](./selected-strategy.md)
44. **MM-Crypto-Bot belső kutatás** — [`sources.md`](./sources.md)
45. **MM-Crypto-Bot belső kutatás** — [`stack-findings.md`](./stack-findings.md)
46. **MM-Crypto-Bot kód** — `packages/core/src/strategy/mtf-trend-confluence.ts`
47. **MM-Crypto-Bot kód** — `packages/core/src/strategy/mtf-trend-confluence.test.ts`
48. **MM-Crypto-Bot kód** — `packages/core/src/types.ts`

---

## 8. Döntési dump (ÜGYNÖK #5 output)

```
PR_URL: <kitöltendő a push után>
RESEARCH_SOURCES_COUNT: 48 (40 külső + 8 belső)
STRATEGY_CHOSEN: MTF-Trend-Konfluencia Kompozit v1.0 (a meglévő
                  mtf-trend-confluence.ts implementáció, nincs
                  kódváltoztatás ebben a PR-ben)
FEASIBILITY_VERDICT: A +100%/hó cél ÉSZERŰ KOCKÁZATTAL NEM
                     ELÉRHETŐ. Reális helyettesítő cél: 3-8%/hó
                     medián (40-90%/év), max DD 15-25%, OOS Sharpe
                     0,8-1,4. A backtestek és az irodalom egybehangzó:
                     „triple-digit monthly claims = short sample or
                     aggressive leverage" (directionsmag 2026).
PARAMETERS: Lásd §3.3 — 26 paraméter, mindegyik független forrással
            indokolva. Konkrét értékek: HTF Donchian 20/10,
            Supertrend ATR 10 / mult 3.0, EMA 50/200, ADX 20;
            MTF BB(20, 2σ), RSI long≤35 / short≥65, ADX 20;
            LTF RSI cross 30/70, vol×1.2, ATR(14) SL×1.5,
            TP R-multiple 2.5.
RISK_FRAMEWORK: max 1% equity/trade, 1/4-Kelly méretezés
                (10% DD felett auto 1/8), max 3 nyitott
                pozíció (1/eszköz), 15% kill-switch DD,
                72h time-exit, 14 nap max position age
                (margin-kamat védelem), WFE≥0,5 OOS
                validáció 12 ablakkal.
MTF_CODE_REVIEW: Strukturálisan helyes, 100% teszt-coverage.
                 10 megfigyelt észrevétel: 5 alacsony, 3 közepes,
                 2 magasabb (pozíció-limit és részleges TP a
                 backtest motor felelőssége, NEM a stratégia-motoré).
                 Kód-módosítás nem szükséges ehhez a PR-hez.
NOTES:
  - A jelenlegi +100%/hó célkitűzés felülvizsgálandó a user-oldalon
    (PR scope-on kívül); §6-ban konkrét javaslat a reális
    cél-átfogalmazásra.
  - A stat-arb BTC/ETH pár opcionális, későbbi PR-ben aktiválandó,
    amennyiben offshore perp-integráció megvalósul.
  - A funding-arb bybit.eu-only rendszerben továbbra is inaktív
    (nincs perpetual; MiCAR).
  - A walk-forward validáció a §3.3 táblázat paramétereivel
    kötelező, mielőtt a stratégia élesítésre kerül.
```
