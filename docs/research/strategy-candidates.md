# Stratégia-jelöltek áttekintése

> 7 kutatott stratégia-kategória, mindegyiknél: leírás, ≥ 2 független forrás,
> várható előny/hátrány, javasolt alkalmazhatóság bybit.eu 1:10 spot marginra
> BTC/ETH/SOL-on.

A források teljes listája és az URL-ek a [`sources.md`](./sources.md) fájlban
találhatók.

---

## 1. Trendkövetés — Donchian Channel Breakout (Turtle-style)

**Leírás:** Belépés, ha a záróár meghaladja az elmúlt N periódus legmagasabb
legmagasabb árát (Donchian felső sáv); kilépés, ha áttöri az M periódus legalacsonyabb
alacsonyát (Donchian alsó sáv). Eredeti Turtle: N=20 (entry), M=10 (exit).
A 20/55 trend-szűrővel kiegészítve javul a találati arány.

**Források:**
- Boring Edge — Donchian Breakout backtest (BTC, 2017-2026, 8,5 év): **CAGR 48,2%**,
  max DD -53,7%, Buy&Hold -83,2%; 41 trade, 46,3% win rate, 5,3× W/L arány.
- TrendSpider — Donchian stratégiák (20-period breakout, +55 trend filter).
- ThetaTrend — Donchian rendszer eredeti koncepció (Turtle).

**Előny:** robosztus, széles körben backtestelt; trend-ben a legjobb; csak záróárra
épül, egyszerűen implementálható; bybit.eu spot-on long-only kivitelezhető; BTC-n
a 8,5 éves CAGR meghaladja a Buy & Hold-ot.

**Hátrány:** oldalazó piacban sokat veszít (win-rate csak 36-46%); long-only,
a bybit.eu spot margin viszont támogat short-ot is; a 4H/1D breakout-ek lassú
jelek → kevés trade / hó.

**Becsült hozam:** A Boring Edge backtest alapján 8,5 év → ~ 4% / hó CAGR alap,
konzervatív forward várakozás. **+100% / hó nem reális önmagában.**

**Javasolt alkalmazhatóság:** **HTF trend-szűrőnek kiváló** (1D/4H).

---

## 2. Trendkövetés — Supertrend (ATR-alapú)

**Leírás:** Supertrend indikátor (ATR-alapú trailing stop). Long, ha az ár az
ATR-szorzós szint fölé zár; short alá. Belépés az ATR-szint átlépésénél, kilépés
az ellenkező jelzésnél. Tipikus paraméterek: ATR period 10, multiplier 3,0.

**Források:**
- Boring Edge — Supertrend backtest (BTC 2017-2026): **CAGR 33,0%**, max DD -61,5%,
  38 trade, 42,1% win rate, 4,1× W/L. Jobb DD, mint a Buy & Hold.
- Quantified Strategies — Trend Following & Momentum cikk.
- Thetatrend — trend-following rendszerek.

**Előny:** egyszerű (1 indikátor); ATR-igazított; trailing stop; jól dokumentált
backtestekben robosztus; alkalmas a mi kompozitunk trend-szűrőjeként.

**Hátrány:** kevés trade (38 / 8,5 év); lassú jelzés; önmagában nem ér el +100% / hót.

**Becsült hozam:** CAGR 33% / 8,5 év → ~ 2,8% / hó. Kompozitban jobb.

**Javasolt alkalmazhatóság:** **MTF trend-szűrő**, trailing stop alap.

---

## 3. Mean-reversion — Bollinger Bands + RSI

**Leírás:** Vétel, ha záróár a Bollinger Band alsó sáv alatt zár **és** RSI(14) < 30
(vagy <25 szigorúbb verzióban). Eladás, ha zárás a középvonalon vagy a felső sávon.
Az RSI „cross-back" triggerként használata csökkenti a false-signal számot.

**Források:**
- Voiceofchain — Mean Reversion Strategy (BB+RSI 4H beállításokkal).
- Changelly — Mean Reversion Crypto útmutató.
- Stratbase — Mean Reversion backtest táblázat (BB touch + RSI < 35: 68% win, 1,71 PF).
- Quantified Strategies — Assesing RSI effectiveness BTC-n: **a tisztán RSI-alapú
  mean-reversion BTC-n NEM működik** (fontos ellenérv!).

**Előny:** nagyon sok trade; magas találati arány (68% BB+RSI kombó); kitűnő
range-bound piacokban; a stop 1,5× ATR; gyors profit-realizáció.

**Hátrány:** **trendben hamis jelzéseket ad, „kést fog meg"**; BTC-n önállóan
veszteséges volt az RSI-alapú verzió (Quantified Strategies); ezért **trend-szűrő
nélkül nem alkalmazható**.

**Becsült hozam:** önmagában BTC-n gyenge; trend-szűrővel kombinálva kiegészítő
modulként hasznos (3-5% / hó extra).

**Javasolt alkalmazhatóság:** **MTF setup réteg** a kompozitban, trend-szűrővel védve.

---

## 4. Breakout — EMA Crossover / Triple MA

**Leírás:** Belépés, ha a rövidebb EMA (pl. 21) átlépi a hosszabbikat (pl. 55)
felfelé (long) vagy lefelé (short). Kilépés az ellenkező jelzésnél vagy trailing
stoppal.

**Források:**
- Dev.to — „I Backtested 49 Crypto Trading Strategies" (multi_timeframe 1,50 Sharpe,
  ema_crossover 1,30 Sharpe, triple_ma 1,25).
- CoinQuant — EMA 21/55 trendkövetés (4H: +9%, 12H: -4,9%).
- Quantified Strategies — Bitcoin Trend Following ChatGPT-vel.

**Előny:** egyszerű; sok backtest-példa; EMA crossover a 4H-n pozitív volt.

**Hátrány:** lassú, sok hamis jelzés a „lagging" jellege miatt; a 12H teszten
veszteséges volt (zaj-dominancia).

**Becsült hozam:** önmagában 0-9% / hó szórással.

**Javasolt alkalmazhatóság:** másodlagos szűrő; a kompozitba beépíthető, de
nem önálló stratégiaként.

---

## 5. Scalping (1m-15m) — RSI oversold bounce, VWAP, orderbook

**Leírás:** Nagyon rövid (1-5 perc) trade-ek, cél 0,1-0,5% / trade, 50-300 trade / nap,
magas találati arány (65-75%).

**Források:**
- HaasOnline — Scalper bot: „120% monthly return" elméletben, de „actual results are
  typically lower due to losses and fees".
- EchoZero — Scalping Strategy Performance: **medián retail scalper 2-4% / hó díjak
  előtt, 3-8% / hó díjak után**.
- BTCC — Top scalpers 5-15% / hó, átlag 2-5%.

**Előny:** nagyon sok trade; magas találati arány; kis mozgásokat is kihasználja.

**Hátrány:** **bybit.eu 0,1% taker fee + 0,01% / óra margin-kamat** miatt a fee-drag
jelentős; 40 round-trip trade/nap = 8% / hó csak díjakban; **nem éri el a +100% / hót**
a fee-struktúra mellett.

**Becsült hozam:** 3-15% / hó a top 5% teljesítményben, **+100% / hó nem reális**.

**Javasolt alkalmazhatóság:** **NEM AJÁNLOTT** a mi rendszerünk számára — a fee-költség
és a likviditási kockázat bybit.eu SPOT-on nem teszi lehetővé a magas frekvenciát.
Kis trade-számú, magas kontrasztú swing-breakout jobban illeszkedik.

---

## 6. Funding-rate / Basis Arbitrage (delta-neutral)

**Leírás:** Long spot + short perpetual ugyanakkora notional értékben → delta-semleges.
A pozitív funding rate idején a short perp funding-ot kap a long spot tartása mellett.
Reális hozam: 5-15% / év stabil (átlagos funding 0,01-0,05% / 8h).

**Források:**
- Kraken — Funding Rate Arbitrage Guide (3 lépéses módszer, kockázat-limit-definíciók).
- Hyperdash — Basis Trading and Funding Rate Arbitrage: „~$3/day $10k pozíción = ~11% / év".
- CoinCryptoRank — Perpetual Basis Arbitrage Guide (8h funding ciklusok, USDQ 1-2% / nap
  extremális piacon).
- PRUVIQ — Funding Rate Arbitrage Practical Guide (collateral buffer 3-5%, rebalance szabály).

**Előny:** delta-semleges, nem függ az ár iránytól; viszonylag stabil hozam;
institucionális alapok alapstratégiája.

**Hátrány:** **bybit.eu SPOT-on nincs perpetual** (az EU spot-only a MiCAR alatt).
A spot-on a funding-rate arbitrázs **nem megvalósítható** tisztán bybit.eu-n belül;
multi-exchange (pl. Bybit EU spot + offshore perp) kell hozzá, ami plusz kockázat
(transfer idő, counterparty).

**Becsült hozam:** 5-15% / év, extrém piacon akár 30% / év.

**Javasolt alkalmazhatóság:** **OPCIONÁLIS kiegészítő** modul, amennyiben a későbbi
verzióban offshore perp-et is integrálunk. Egyelőre a bybit.eu-only rendszerben
**nem aktív**.

---

## 7. Multi-timeframe (MTF) Ensemble / Konfluencia

**Leírás:** 3 különböző időtávon (HTF trend → MTF setup → LTF trigger) egyszerre
történő elemzés; csak akkor belépés, ha mindhárom egy irányba mutat. Az 5-ös
stratégia (multi_timeframe) a Dev.to 49-stratégia backtestjében a **legjobb Sharpe-ral**
(1,50) és **100% win rate-tel** rendelkezett.

**Források:**
- Dev.to — I Backtested 49 Strategies (multi_timeframe: Sharpe 1,50, return 546%, -32% DD, 100% WR).
- CoinXSight — Multi-Timeframe Confluence („three timeframes standard").
- BingX — MTF Analysis for crypto entries.
- Quantpedia — How to Design a Multi-Timeframe Trend Strategy on Bitcoin.

**Előny:** kiszűri a zaj-jelzéseket; magas konfidencia; MTF trend-szűrő nélkül
a BB+RSI mean-reversion nem használható.

**Hátrány:** kevesebb trade-szám (HTF ritkán ad jelet); MTF-confluence lassabb
mint a tisztán LTF; összetettebb implementáció.

**Becsült hozam:** Sharpe 1,50 — kockázat-korrigáltan kiváló; a multi_timeframe
backtest 3 évre 546% (kb. 6% / hó CAGR), **out-of-sample fenntartással**.

**Javasolt alkalmazhatóság:** **A kiválasztott rendszer alapja** — a 3-lépcsős
MTF struktúra a kompozit gerince.

---

## 7 stratégia összehasonlító táblázata

| # | Stratégia | Backtest CAGR / hozam | DD | Trade-szám | bybit.eu SPOT 1:10? | MTF-be beépíthető? |
|---|---|---|---|---|---|---|
| 1 | Donchian Breakout (Turtle) | 48% / év (~4% / hó) | -54% | 41/8,5 év | Igen | Igen (HTF) |
| 2 | Supertrend (ATR) | 33% / év (~2,8% / hó) | -62% | 38/8,5 év | Igen | Igen (HTF) |
| 3 | BB+RSI Mean-reversion | változó, trend-szűrő nélkül gyenge | -32–45% | sok | Részben | Igen (MTF) |
| 4 | EMA Crossover | 9% (4H) / -5% (12H) | -7–12% | 3–84 | Igen | Igen (kieg.) |
| 5 | Scalping | 2-8% / hó (reális) | 22-30% | napi 50+ | NEM (fee-költség) | Nem |
| 6 | Funding/Basis Arb | 5-15% / év | alacsony | tartott pozíció | Nem (EU only) | Nem |
| 7 | MTF Ensemble | Sharpe 1,50 | -32% | ritka | Igen | Igen (alap) |

---

## Döntés: a kiválasztott kompozit

A fenti 7-ből **5-öt (scalping) és 6-ot (funding-arb)** kizárunk platform-specifikus
okokból. A maradék 5-ből **(1) Donchian, (2) Supertrend, (3) BB+RSI, (4) EMA, (7) MTF**
egy **3-lépcsős kompozitot** építünk:

- **HTF (1D)** = Donchian(20) + Supertrend(ATR 14, 3.0) trend-szűrő
- **MTF (4H)** = Bollinger Band(20, 2σ) re-entry + ADX > 20 szűrő
- **LTF (1H)** = RSI(14) cross-back + volume trigger

Részletes specifikáció: [`selected-strategy.md`](./selected-strategy.md).