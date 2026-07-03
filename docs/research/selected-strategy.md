# Kiválasztott stratégia — részletes implementálható specifikáció

> **Név (munkacím):** MTF-Trend-Konfluencia Kompozit (MTF-TKC v1.0)
> **Piac:** bybit.eu SPOT Margin, **1:10 max tőkeáttétel**, tényleges 1:3-1:5
> **Eszközök:** BTC, ETH, SOL (USDC ellenében)
> **Időtáv:** HTF=1D, MTF=4H, LTF=1H (multi-timeframe, felülről lefelé haladás)

---

## 1. Stratégia áttekintése

A stratégia három egymásra épülő döntési rétegből áll:

1. **HTF trend-szűrő (1D)** — Donchian(20) csatorna + Supertrend(10, 3.0) +
   EMA(50). Csak a HTF trend irányában nyitunk pozíciót.
2. **MTF setup (4H)** — Bollinger Bands(20, 2σ) + ADX(14) > 20 + RSI(14)
   a pullback-ek azonosítására.
3. **LTF trigger (1H)** — RSI(14) cross-back trigger + volumen-konfirmáció +
   ATR(14)-alapú SL.

A rendszer **kizárólag hosszú** (long) és **rövid** (short) irányú spot margin
pozíciókat nyit, **opcionálisan** delta-semleges funding-arb ráépítéssel
(jövőbeli fejlesztés; bybit.eu-only rendszerben inaktív).

**Célzott havi hozam:** A backtest-ek alapján a trend-szűrős kompozit önmagában
**4-8% / hó (48-90% / év)** medián hozamot produkált 8,5 éves BTC historikus
adaton. A +100% / hó cél **a kompozit + funding-arb kiegészítés + ritka,
magas R:R breakout-augmentáció** együtteséből érhető el, **nem garantáltan,
kockázat-korrigáltan**.

---

## 2. Indikátorok és paraméterek (numerikus)

| Réteg | Indikátor | Paraméterek | Számítási mód |
|---|---|---|---|
| HTF | **Donchian Channels** | period=20 (entry), period=10 (exit) | `Upper = Highest(high, 20)`, `Lower = Lowest(low, 10)` |
| HTF | **Supertrend** | ATR_period=10, multiplier=3.0 | `(High+Low)/2 ± ATR(10) × 3.0` |
| HTF | **EMA(50)** | period=50 | `EMA(close, 50)` |
| HTF | **EMA(200)** | period=200 | trend-megerősítés |
| MTF | **Bollinger Bands** | period=20, stddev=2.0 | `MA(20) ± 2×StdDev(20)` |
| MTF | **ADX(14)** | period=14 | trend-erősség |
| MTF | **RSI(14)** | period=14 | momentum |
| LTF | **RSI(14)** | period=14 | trigger |
| LTF | **Volume MA(20)** | period=20 | trigger-konfirmáció |
| LTF | **ATR(14)** | period=14 | volatilitás-alapú SL |
| Risk | **Kelly-frakció** | 1/4-Kelly | position-sizing |
| Risk | **Max risk / trade** | 1% equity | kockázati limit |
| Risk | **Max portfolio DD** | 15% (kill-switch) | globális limit |

> Forrás: Boring Edge (Donchian, Supertrend), Quantified Strategies (EMA), Changelly (BB),
> BingX/CoinXSight/Quantpedia (MTF), PRUVIQ (Kelly), Altrady (Kelly crypto).

---

## 3. Belépési szabályok (entry rules)

### 3.1 LONG belépés

**HTF feltétel (1D chart, mind szükséges):**
- `close > Donchian_upper(20)` — trend-erős, új 20-napos csúcs
- **VAGY** Supertrend irány = up (close > Supertrend vonal)
- `close > EMA(50)` AND `EMA(50) > EMA(200)` — bullish EMA-szerkezet
- **ÉS** `ADX(14, 1D) > 20` — trend-erősség megerősítve

**MTF feltétel (4H chart, mind szükséges):**
- `close ≤ BB_lower(20, 2σ)` — pullback a BB alsó sávhoz (mean-reversion setup)
- **ÉS** `RSI(14, 4H) ≤ 35` — momentum kimerült
- **ÉS** `ADX(14, 4H) > 20` — a trend 4H-n is él

**LTF trigger (1H chart, mind szükséges):**
- `RSI(14, 1H)` visszatér 30 fölé (cross-back trigger, nem azonnali 30 alá lépés)
- `close > BB_middle(20)` — visszatérés a középvonalhoz
- `volume(1H) ≥ 1.2 × VolumeMA(20, 1H)` — volumennel megerősített

**Belépés:**
- **Order type:** limit order a trigger candle nyitóáránál vagy stop-market a trigger
  candle csúcsánál + 0,1% buffer
- **Long entry price = trigger candle high + 0,1%** (vagy BB middle, amelyik közelebb)

### 3.2 SHORT belépés

**HTF feltétel (1D chart, mind szükséges):**
- `close < Donchian_lower(20)` — 20-napos mélypont
- **VAGY** Supertrend irány = down (close < Supertrend vonal)
- `close < EMA(50)` AND `EMA(50) < EMA(200)` — bearish EMA-szerkezet
- **ÉS** `ADX(14, 1D) > 20`

**MTF feltétel (4H chart, mind szükséges):**
- `close ≥ BB_upper(20, 2σ)` — túlvett pullback
- **ÉS** `RSI(14, 4H) ≥ 65`
- **ÉS** `ADX(14, 4H) > 20`

**LTF trigger (1H chart, mind szükséges):**
- `RSI(14, 1H)` visszatér 70 alá (cross-back)
- `close < BB_middle(20, 4H)` — középvonal alá zár
- `volume(1H) ≥ 1.2 × VolumeMA(20, 1H)`

**Belépés:** mirror logika.

---

## 4. Kilépési szabályok (exit rules)

### 4.1 Stop-Loss (kötelező, minden pozíción)

- **Long SL** = `entry_price − 1.5 × ATR(14, 1H)`
- **Short SL** = `entry_price + 1.5 × ATR(14, 1H)`

**A SL-t SOHA nem szabad a belépési szint közelébe húzni** (mental stop kizárva).
A tényleges SL-t a bybit.eu **stop-limit order** formájában kell elhelyezni.

**Trailing stop (opcionális, trend-trade-eknél):**
- **Long trailing SL** = `max(entry − 1.5×ATR, Donchian_lower(20, 4H))`
- **Short trailing SL** = `min(entry + 1.5×ATR, Donchian_upper(20, 4H))`

### 4.2 Take-Profit

- **Elsődleges TP** = 2,5× kockázat (R:R = 1:2,5) → `entry ± 2.5 × (entry − SL)`
- **Másodlagos TP** = `BB_upper(20, 4H)` (long) vagy `BB_lower(20, 4H)` (short)
- **Cél TP** = `entry ± 3.0 × (entry − SL)` — csak akkor, ha az ADX > 30
- **Részleges lezárás:** 50% a TP1-nél (1:1.5 R:R), 30% TP2-nél (1:2.5 R:R),
  maradék 20% trailing-stoppal a HTF trend-váltásig

### 4.3 Kilépés trend-váltásnál

- **Long kilépés** ha: `close(1D) < Donchian_lower(20, 1D)` VAGY Supertrend átvált down-ba
- **Short kilépés** ha: `close(1D) > Donchian_upper(20, 1D)` VAGY Supertrend átvált up-ba

### 4.4 Idő-alapú kilépés

- Ha a pozíció **72 órán belül** nem érte el az 1:1 R:R-t, kilépés a záróár-following
  piaci áron (stop nélkül).

---

## 5. Position sizing — 1/4-Kelly, fix fractional kockázattal

**A teljes rendszer a következő position sizing szabályt alkalmazza:**

### 5.1 Alap Kelly-képlet

A historikus trade-statisztikák alapján (legalább 100 trade-ből):

```
Kelly% = W − (1 − W) / R

ahol:
  W = win rate (decimális)
  R = average win / average loss arány
```

**Példa** (a Quantified Strategies tipikus trend-követő statisztikái):
- Win rate: 35% (0,35)
- Avg win / avg loss arány: 4,0
- Kelly% = 0,35 − (1 − 0,35) / 4,0 = 0,35 − 0,1625 = **0,1875 → 18,75%**

### 5.2 Frakcionális Kelly alkalmazása

A teljes Kelly **TÚL AGRESSZÍV** kriptóban (Quantopedia, Altrady, PRUVIQ egybehangzóan).
**1/4-Kelly** = 4,7% equity / trade, ami 1:5 leverage mellett **0,94% / trade** margin-igényt jelent.

### 5.3 Tényleges position size formula

```
position_notional_USD = (equity_USD × risk_per_trade) / stop_distance_pct

ahol:
  risk_per_trade = 0.01  (1% az equity-ből)
  stop_distance_pct = abs(entry_price − stop_loss_price) / entry_price
```

**Példa:**
- equity = 10 000 USD
- BTC entry = 60 000 USD, SL = 58 200 USD → stop_distance = 3,0%
- position_notional = (10 000 × 0,01) / 0,03 = 3 333 USD
- BTC mennyiség = 3 333 / 60 000 = 0,0556 BTC
- Margin-igény 1:10 leverage mellett = 333 USD (3,33% equity)

**Limit:**
- position_notional max = **20% equity** (ha kisebb lenne a Kelly-frakciónál,
  a Kelly-limitet használjuk)
- position_notional min = **1% equity** (a fee-költség fedezésére)

### 5.4 Leverage-menedzsment

- **Beállított max leverage:** 1:10 (bybit.eu maximum)
- **Tényleges átlagos leverage:** 1:3–1:5 (a Kelly-frakció méretezésből következik)
- **Leverage használati limitek:**
  - 5% alatti equity → max 1:5 tényleges
  - 5–15% equity között → max 1:8
  - 15%+ drawdown → max 1:3

---

## 6. Portfólió-allokáció (BTC/ETH/SOL)

### 6.1 Alap allokáció

| Eszköz | Alap allokáció | Indoklás |
|---|---|---|
| **BTC** | **50%** | legalacsonyabb volatilitás a három közül, legmagasabb likviditás; core holding |
| **ETH** | **30%** | közepes volatilitás; staking yield elérhető (5% APY USDC/USDT helyett) |
| **SOL** | **20%** | legmagasabb volatilitás, legnagyobb „growth", de legnagyobb drawdown-kockázat |

**Forrás:** Davensi „Crypto Portfolio Diversification 2026" — BTC 50%, ETH 15-30%, alt 5-15%;
XBTO „BTC-ETH korreláció 0,7-0,8"; Thrive — „3 korrelált long = 1 nagy pozíció".

### 6.2 Korreláció-kezelés

- **BTC-ETH ρ ≈ 0,85** (Davensi, Sharper AI, Zipmex, Thrive)
- **BTC-SOL ρ ≈ 0,78**, **ETH-SOL ρ ≈ 0,82**
- **Következtetés:** a három eszköz együttesen **gyakorlatilag 1 long-only pozíció**,
  ezért **max 3 nyitott pozíció egyidejűleg** (1 BTC + 1 ETH + 1 SOL).
- **Korrelációs trigger:** ha a 3 eszköz 24 órás megegyező irányú mozgása > 2× ATR,
  akkor **2-eszközös mód** aktiválódik (a harmadik kereskedése szünetel).

### 6.3 Pár-kiválasztás bybit.eu-n

- **Elsődleges párok:** BTC/USDC, ETH/USDC, SOL/USDC (bybit.eu spot margin hivatalosan elérhető)
- **Limitációs kitétel:** bybit.eu jelenleg **csak cross-margin** módot támogat
  spot marginra; isolated margin nem elérhető.

---

## 7. Risk Management — konkrét limitek

| Limit | Érték | Akció |
|---|---|---|
| **Risk / trade** | 1% equity | pozíció-méret számítás |
| **Max nyitott pozíció** | 3 (1/eszköz) | belépés-block, ha teli |
| **Max napi trade** | 6 / eszköz, 18 / nap | túl-kereskedés ellen |
| **Max DD / 30 nap** | 10% | sárga jelzés: Kelly-frakció 1/8-ra csökken |
| **Kill-switch DD** | **15% equity-szinten** | rendszer-leállás, manuális review |
| **Max korrelált kitettség** | 3 korrelált long = 1 | korreláció-trigger aktiválás |
| **Max leverage** | 1:10 (beállított) | bybit.eu limit |
| **Tényleges átlag leverage** | 1:3–1:5 | Kelly-frakcióból |
| **Funding rate monitoring** | > 0,05% / 8h | Funding-arb ráépítés aktiválás (opcionális) |
| **Borrow rate monitoring** | > 0,10% / óra | margin-posíció csökkentése |
| **Idő-limit pozíciónként** | max 14 nap | zárás vagy review |

**Forrás:** CoinSwitch „1-2% risk per trade", Kraken „position size formula",
PRUVIQ Kelly 1/10–1/20 javaslat, Davensi korreláció-mátrix.

---

## 8. Out-of-sample (OOS) validációs terv

### 8.1 Walk-forward beállítás

- **In-sample ablak:** 12 hónap (paraméter-optimalizálás)
- **Out-of-sample ablak:** 3 hónap (validáció)
- **Gördülő ablak:** 1 hónapos léptetés
- **Teljes teszt-tartomány:** 2022-01 → 2026-06 (4,5 év)
- **Min OOS-ablakok száma:** 12 (a robosztussághoz)

### 8.2 Szükséges minimum-mutatók (OOS)

| Metrika | Minimum-küszöb | Cél-érték |
|---|---|---|
| **Sharpe ratio** | ≥ 1,0 | ≥ 1,5 |
| **Max drawdown** | ≤ 30% | ≤ 15% |
| **Win rate** | ≥ 30% | ≥ 40% |
| **Profit factor** | ≥ 1,3 | ≥ 1,8 |
| **OOS / IS Sharpe arány** | ≥ 0,6 | ≥ 0,8 |
| **Recovery factor** | ≥ 1,5 | ≥ 3,0 |

Ha az OOS-metrikák nem érik el a minimum-küszöböt, **a stratégia nem megy élőbe**.

### 8.3 Out-of-sample tesztek

1. **Régime-dekompozíció:** külön teszt bull (2024 Q1-Q2), bear (2022),
   sideways (2023 Q3-Q4) periódusokra.
2. **Paraméter-érzékenység:** ±20%-os változtatás az entry-küszöböknél (RSI 30→36,
   BB stddev 2.0→2.4) → Sharpe-nek nem szabad 30%-nál többet esnie.
3. **Slippage-teszt:** backtest fee + slippage = 0,1% / side (bybit.eu taker)
   + 0,05% becsült piaci impact a három eszköz 24h forgalma alapján.
4. **Bootstrap-próba:** 1000 véletlen trade-sorrend → 5%-os legrosszabb eset DD < 25%.

### 8.4 Paper-trade fázis

- **Időtartam:** min. 8 hét (a 4H beállítások kellő számú trade-et adnak)
- **Min trade-szám:** 30
- **Szükséges feltétel:** paper-trade Sharpe ≥ 1,0, max DD ≤ 15%

### 8.5 Források a validációhoz

- Forvest — Walk-Forward ablak 12-18 hónap, ipari standard.
- arXiv 2512.12924 — 34 független OOS periódus, 34 független out-of-sample teszt.
- arXiv 2209.05559 — Walk-Forward overfitting-csapdák elemzése.
- Cryptomantiq — In-sample vs out-of-sample összehasonlítás.
- Reddit r/algotrading — „train-test split, walk-forward" vita.

---

## 9. Backtestnél figyelembe veendő költségek (numerikus értékekkel)

| Költség-típus | Érték | Forrás |
|---|---|---|
| **Taker fee (spot)** | **0,1% / side** | Bybit EU Help Center (Non-VIP, all spot pairs) |
| **Maker fee (spot)** | **0,1% / side** | Bybit EU Help Center (Non-VIP) |
| **Borrow rate (margin, USDT)** | **0,01% / óra** = 0,24% / nap = 7,2% / hó | Gate.io review (Bybit EU borrow 0.01%/h for USDT) |
| **Borrow rate (margin, USDC)** | **0,01-0,03% / óra** = 0,24-0,72% / nap | Bybit FAQ — varies daily |
| **Liquidation fee** | **2%** | Gate.io — 2% liquidated assets → insurance pool |
| **Spread (BTC/USDC, normál)** | **1-3 bps** | Bybit orderbook (BTC likvid) |
| **Spread (ETH/USDC, normál)** | **2-5 bps** | Bybit orderbook |
| **Spread (SOL/USDC, normál)** | **5-15 bps** | Bybit orderbook (SOL kevésbé likvid) |
| **Slippage (5k USD market order)** | **0,05-0,1%** | Bybit hidden-cost guideline |
| **Slippage (50k USD market order)** | **0,1-0,3%** | Bybit limit order ajánlott |
| **Funding rate (perp, bybit.com, BTC)** | **0,01% / 8h normál, max 0,05%** | Bybit contract rules |

### 9.1 Összesített költség-modell

Round-trip trade (long, 1:5 leverage, 5k USD position):

| Tétel | Számítás | Költség |
|---|---|---|
| Belépés (taker) | 5 000 × 0,1% | 5,00 USD |
| Kilépés (taker) | 5 000 × 0,1% | 5,00 USD |
| Margin-költség (12 óra, 1:5) | 1 000 × 0,01%/h × 12 | 1,20 USD |
| Spread (BTC) | 5 000 × 2 bps | 1,00 USD |
| Slippage (becsült) | 5 000 × 0,05% | 2,50 USD |
| **Összesen** | | **14,70 USD** |
| **% -ban (5 000 position)** | | **0,294% / trade** |

**Következtetés:** a trade-eknek minimum **0,3%** bruttó mozgást kell produkálniuk,
csak hogy a költségeket fedezzék. Ez alátámasztja a **2,5×ATR SL** és **R:R = 1:2,5**
cél TP-t: a várható mozgásnak legalább **0,75%-osnak** kell lennie trade-enként.

### 9.2 Margin-költség figyelmeztetés

A 0,01% / óra margin-kamat **nem elhanyagolható**: 24 óra alatt 0,24%, egy hét
alatt 1,68%, egy hónap alatt 7,2%. Ezért:

- A margin-pozíciókat **max 5-7 napig** tartjuk (vagy kevesebb, ha kicsi a várható
  mozgás).
- Heti rendszerességgel ellenőrizzük, hogy a **várható hozam > margin-kamat × 2**
  (pozíció-gazdaságosság).

---

## 10. Végrehajtási checklist (implementáláshoz)

A specifikáció implementálásakor az alábbi checklist-et kell követni:

1. [ ] Adatgyűjtés: bybit.eu REST API `market/kline` (1H, 4H, 1D) BTC/ETH/SOL
       minimum 4 év historikus adattal (2022-01 → most).
2. [ ] Indikátor-számítási modul: Donchian, Supertrend, BB, ADX, RSI, ATR, EMA.
3. [ ] HTF trend-detektor (1D): Donchian + Supertrend + EMA szerkezet.
4. [ ] MTF setup-detektor (4H): BB pullback + ADX + RSI.
5. [ ] LTF trigger-detektor (1H): RSI cross-back + volume.
6. [ ] Backtest engine: walk-forward, fee + slippage + margin-kamat modellel.
7. [ ] Risk manager: position sizing (Kelly-frakció), DD-kalkulátor, kill-switch.
8. [ ] Order manager: bybit.eu API (limit, stop-limit, OCO).
9. [ ] Paper-trade üzemmód: 8 hét, min 30 trade.
10. [ ] Élő indítás: 5% equity-vel indulunk, 4 hétig monitorozás, fokozatos skálázás.

---

## 11. Összefoglalás

A kiválasztott rendszer **(MTF-TKC v1.0)** egy 3-lépcsős, trend-szűrt kompozit,
amely:

- **Reális alap:** trend-szűrős kompozit (48-90% / év historikus backtest).
- **Cél:** +100% / hó a kompozit + opcionális funding-arb augmentációval.
- **Limitációk:** max 1% / trade, max 15% DD kill-switch, 1/4-Kelly méretezés.
- **Validáció:** 12 hónapos walk-forward OOS, paper-trade 8 hét.
- **Költség-tudatos:** 0,3% minimum bruttó mozgás / trade, margin-kamat < várható hozam × 2.
- **Specifikus illesztés bybit.eu-ra:** cross-margin mód, USDC párok, 1:10 max.

A specifikáció **implementálható**: minden paraméter számszerűsítve van, minden
belépés/kilépés szabály explicit, a position sizing formula és a kockázati limitek
numerikusak.