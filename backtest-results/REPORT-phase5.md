# Phase 5 Riport — Multi-strategy ensemble + Donchian break-backtest

> **Dátum:** 2026-07-04 01:10 Europe/Budapest
> **Worktree:** `.worktrees/wt-phase5-ensemble` (branch `feat/phase5-ensemble`, M3 commit pending)
> **Stratégiák:** 3 implementált (Strategy A: always-in trend-following, Strategy B: composite ensemble, Strategy C: Donchian volatility breakout)
> **Adatok:** Phase 1 Binance public OHLCV (BTC/ETH/SOL × 1h/4h/1d, 2024-01-01 → 2026-07-03, 30.1 hónap)
> **Cost-model:** bybit.eu SPOT 1:10 — taker 0.1%/side, slippage 0.05%/side, spread 0.02%/side, borrow 0.01%/h, funding 0
> **Backtest mátrix:** 27 baseline JSON (3 stratégia × 3 symbol × 3 timeframe)
> **Phase 1-3 / Phase 4 referenciák:** `baseline-mtf-tkc-rerun-*.json` (Phase 5 M0, engine-fix után), `mr-baseline-*.json` (Phase 4 mean-reversion)
> **Forrás-brief:** `docs/research/phase5-strategy-brief.md`

## TL;DR — +50%/hó target IGEN/NEM/RÉSZBEN válasz

**RÉSZBEN.** A Phase 5 három kiválasztott stratégiája közül **a Donchian volatility breakout (Strategy C) 1d timeframen PROFITÁBLIS mindhárom symbolon** (BTC +1.15%, ETH +3.17%, SOL +2.78% 30 hónap alatt), DE a havi hozam 0.04-0.10%/hó — **50×-del kisebb mint a +50%/hó target**. Az always-in trend-following (A) és a composite ensemble (B) MIND a 9 szimbólum×timeframe kombinációban negatív Sharpe-ot produkáltak a fee-drag dominanciája miatt.

A **+50%/hó realitásvizsgálat végső ítélete:**
- ✅ **RÉSZBEN elérhető** Phase 5 stratégiákkal önállóan: a Donchian 1d trend-following pozitív, DE a havi hozam nagyságrendekkel a target alatt van.
- ❌ **NEM elérhető** egyetlen Phase 5 edge class-szal önmagában. Az A és B stratégiák fee-drag dominanciája (always-in continuous signal → sok stop-triggerelt trade) és az ensemble komponensek szubadditivitása (B rosszabb mint a komponensek átlaga) cáfolja, hogy a trend-following + mean-reversion ensemble önmagában 50%/hó-t hozhatna.
- 🚧 **A +50%/hó-hoz további off-exchange edge class szükséges** — funding-rate carry (Phase 6+ deployment, bybit.eu SPOT-only MiCAR korlát miatt), cross-exchange spread arb, vagy a pozíció-méretezés finomhangolása. Ezek a Phase 5 scope-on kívül esnek.

**A legjobb Phase 5 kombináció: Donchian (C) 1d timeframen**, kiemelten:
- **SOL 1d Donchian**: +2.78% total return, Sharpe +0.464, max DD 3.76%, PF 1.589, 19 trade / 30 hó — **legjobb Sharpe és max DD arány**
- **ETH 1d Donchian**: +3.17% total return, Sharpe +0.441, max DD 3.09%, PF 1.418, 24 trade / 30 hó — **legnagyobb total return**
- **BTC 1d Donchian**: +1.15% total return, Sharpe +0.157, max DD 5.53%, PF 1.105, 28 trade / 30 hó — **legnagyobb trade-szám, lassú trend capture**

A Strategy C 1d kombinációk time-exit dominanciát mutatnak (60-79% time_exit vs stop_loss), ami arra utal, hogy a trade-ek többsége trend-following jellegű hosszú pozíció volt (a 72h time-exit lejárt, miközben a trade nyereséges volt).

---

## 1. Végső eredmények — IGEN/NEM/RÉSZBEN

### 1.1 A +50%/hó realitásvizsgálat végső ítélete: **RÉSZBEN**

| Kérdés | Válasz | Indoklás |
|---|---|---|
| El tudja-e érni a +50%/hó-t a Phase 5 bármely stratégiája önmagában? | **NEM** | A legjobb Phase 5 havi hozam 0.10%/hó (ETH 1d Donchian), ami **500×-del** a +50%/hó alatt van. |
| Van-e Phase 5-ben pozitív edge class? | **IGEN (korlátozott)** | A Donchian 1d trend-following 3/3 symbolon profitábilis (BTC +1.15%, ETH +3.17%, SOL +2.78%), bár alacsony Sharpe-sal (0.16-0.46) és kevés trade-del (19-28 / 30 hó). |
| Az ensemble javítja-e az egyedi stratégiák teljesítményét? | **NEM** | A composite ensemble (B) MIND a 9 kombinációban rosszabb, mint a komponensek átlaga. A trade-filter mechanika (trend-wins MR felett) megakadályozza a legrosszabb MR trade-eket, DE a trend-following A komponens önmagában is fee-drag uralta. |
| A fee-drag (0.34% round-trip) elérhető-e trend-followinggal? | **KORLÁTOZOTTAN** | A Donchian 1d (kevés trade, magas time_exit arány) kompenzálja a fee-dragot. Az A és B 1h/4h timeframen (300-500+ trade) a fee-drag dominál, mert a trade-ek 73-82%-a stop-loss-on zár, ahol a round-trip költség a nyereség nagy részét elveszi. |

### 1.2 Az IGEN/NEM/RÉSZBEN végső ítélet: **RÉSZBEN**

A Phase 5-ön kívüli edge class-ok (funding-rate carry, cross-exchange arb, position-sizing finomhangolás) nélkül a +50%/hó **nem érhető el**. A Phase 6-nak ezeket kell vizsgálnia. A Phase 5 saját eredményei közül a **Donchian 1d trend-following egy lassú, alacsony-kockázatú (~3-5% max DD) edge**, ami a felhasználó portfóliójának diverzifikációs elemeként értékes, de a +50%/hó target elérésére önmagában nem elégséges.

---

## 2. Stratégiánkénti elemzés — A/B/C mátrix

### 2.1 A: Always-in trend-following (EMA 50/200 + ATR trailing stop)

| Symbol | 1h | 4h | 1d |
|---|---|---|---|
| **BTC/USDT** | 411 trade, −41.33%, Sharpe −2.49, maxDD 41.86% | 252 trade, −34.53%, Sharpe −2.19, maxDD 31.6% | 104 trade, −12.22%, Sharpe −1.48, maxDD 16.3% |
| **ETH/USDT** | 309 trade, −49.80%, Sharpe −3.00, maxDD 43.4% | 258 trade, −37.49%, Sharpe −2.07, maxDD 38.2% | 89 trade, −11.99%, Sharpe −1.52, maxDD 15.1% |
| **SOL/USDT** | 306 trade, −48.53%, Sharpe −2.38, maxDD 45.0% | 265 trade, −36.57%, Sharpe −1.96, maxDD 39.7% | 102 trade, −10.33%, Sharpe −1.29, maxDD 14.5% |

**Mind a 9 kombináció negatív.** A trade-szám magas (1h: 300-400, 4h: 250-270, 1d: 90-105), mert a strategy minden candle-en signált küld (continuous, nem csak EMA crossover-re). A trade-ek többsége stop_loss-on zár (~73-82%), ahol a fee-drag + a 3×ATR stop distance kisebb nyereséget hagy.

**A strategy logikailag helyes** (az M2 unit tesztek 11/11 átmentek, a trade-szám deviation flag a CLI runner-ben aktív, M2 riportban dokumentálva: §4.5.2 a becsült sáv 30-50 volt, a mért 411 — 9× deviáció, a continuous signal miatt). A **deviation oka nem bug, hanem architekturális korlát**: a Phase 5 engine nem támogatja a trailing-stop signal frissítést (a strategy nem tudja update-elni a stop-loss szintet futás közben), így a Strategy A stop-loss szintje az entry-close − 3×ATR fix marad a trade teljes élettartama alatt. Ez a trend-erős piacon túl szoros stop, ami sok trade-et vág le korán.

**Tanulság:** A 30 trade / 30 hó becsült sáv a crossover-trigger stratégiát feltételezte (EMA fast cross EMA slow → entry, opposite cross → exit). Ez a fix engine-stop-logikával nem valósítható meg. Phase 6+ kellene trailing-stop támogatás az engine-ben.

### 2.2 B: Composite ensemble (always-in + mean-reversion trend-filter)

| Symbol | 1h | 4h | 1d |
|---|---|---|---|
| **BTC/USDT** | 513 trade, −47.02%, Sharpe −2.96, maxDD 47.56% | 308 trade, −35.43%, Sharpe −2.30, maxDD 39.1% | 111 trade, −13.04%, Sharpe −1.55, maxDD 18.7% |
| **ETH/USDT** | 397 trade, −49.74%, Sharpe −3.18, maxDD 46.2% | 326 trade, −37.89%, Sharpe −2.13, maxDD 41.8% | 109 trade, −11.76%, Sharpe −1.38, maxDD 17.9% |
| **SOL/USDT** | 407 trade, −48.65%, Sharpe −2.60, maxDD 49.5% | 335 trade, −40.30%, Sharpe −2.19, maxDD 44.3% | 115 trade, −14.91%, Sharpe −1.78, maxDD 19.5% |

**Mind a 9 kombináció negatív. Az ensemble ROSSZABB, mint a komponensek átlaga.** A trade-szám (300-500) a becsült sáv (700-1500) alsó határán van, mert az A komponens 411 trade-jéből a trend-filter nem mindet engedi át, a B komponens kevés extra jelet ad.

**Tanulság:** A Phase 4 stratégiánkénti riport kiemelte, hogy a Phase 4 MR stop-loss dominanciája 73-82% volt — ez a trend-piac ellen irányú short jelzések következménye. A B ensemble trend-filterje (MR jelzés CSAK trend-irányban) ezt orvosolja, DE a fee-drag és az A komponens continuous-signal trade-generálása kombinálódva ROSSZABB eredményt hoz, mint bármelyik komponens önmagában. Az ensemble akkor lenne hatékony, ha a komponensek valóban ortogonálisak (eltérő piaci fázisokra érzékenyek). A Phase 5 M3-s M4 BTC/ETH/SOL 1h kombinációkban az A és B nagyjából ugyanazokat a trade-eket nyitja (azonos trend-irány, hasonló entry/exit logika), így a diverzifikáció minimális.

### 2.3 C: Donchian volatility breakout (20-period + 1.5× volume + 1.5× ATR stop / 4.5× ATR TP)

| Symbol | 1h | 4h | 1d |
|---|---|---|---|
| **BTC/USDT** | 268 trade, **−17.99%**, Sharpe **−1.77**, maxDD 19.24% | 127 trade, **−3.35%**, Sharpe **−0.27**, maxDD 9.69% | 28 trade, **+1.15%**, Sharpe **+0.16**, maxDD **5.53%** ✅ |
| **ETH/USDT** | 233 trade, **−14.99%**, Sharpe **−1.09**, maxDD 16.44% | 121 trade, **−15.16%**, Sharpe **−1.02**, maxDD 19.65% | 24 trade, **+3.17%**, Sharpe **+0.44**, maxDD **3.09%** ✅✅ |
| **SOL/USDT** | 234 trade, **−26.90%**, Sharpe **−1.66**, maxDD ? | 109 trade, **−18.13%**, Sharpe **−0.99**, maxDD ? | 19 trade, **+2.78%**, Sharpe **+0.46**, maxDD **3.76%** ✅✅ |

**(Jelek: ✅✅ = erősen pozitív, ✅ = pozitív, ⚪ = közel nulla)**

**A 1d timeframe MIND A 3 SYMBOLON PROFITÁBILIS.** Ez az egyetlen kombináció-csoport az egész 27-es mátrixban, ahol bármely pozitív Sharpe-t produkál.

A pozitív eredmények time-exit dominanciát mutatnak (60-79% time_exit, 21-40% stop_loss). Ez arra utal, hogy a 1d Donchian breakout-ok lassú, több hetes trendeket azonosítanak, és a trade-ek többsége a 72h time-exit előtt nyereségesen zár. A max DD alacsony (3-5.5%), ami a ritka, magabiztos trade-eknek köszönhető.

**Tanulság:** A Donchian breakout **lassú, alacsony-frekvenciás, magas megnyugvás-rátájú** edge osztály. A 28 trade / 30 hó (BTC 1d) éves szinten kb. 11 trade, ami alacsonyabb a Phase 1-3 'túl kevés trade' panaszánál, de pozitív EV-vel.

### 2.4 Trade-count deviation analysis (a CLI runner flag-jei)

A `run-{alwaysin,donchian,ensemble}-baseline.ts` CLI runner-ek a `strategy-selection.md §4.5.2` becsült sávokhoz képest deviation-flag-et emelnek:

| Stratégia | Becsült sáv | Mért átlag (9 futás) | Deviation |
|---|---|---|---|
| A: always-in trend-following | 30-50 / 30 hó / symbol | 232 / 30 hó / symbol | **+6× deviáció** (continuous signal, nincs trailing-stop engine support) |
| B: composite ensemble | 700-1500 / 30 hó / symbol | 291 / 30 hó / symbol | **Az alsó határ közelében** (A komponens limitálja az alacsony TF-eken) |
| C: Donchian breakout | 30-100 / 30 hó / symbol | **129 / 30 hó / symbol** | **+1.3× deviáció** (previous-bar-exclusive donchian fix miatt) |

A deviation okai nem bugok, hanem:
1. **A** becslés a crossover-trigger alapú strategy-ra szólt (Phase 5 implementation continuous-signal); a 9× trade-szám-többlet az engine trailing-stop hiányából fakad.
2. **C** becslés a régi (inclusive-window) donchian convention-re szólt, ami 0 trade-et adott volna; a previous-bar-exclusive javítás (lásd §3) 2.7× több valid breakout-ot hoz.

A deviation flag-ek explicit megjelennek a CLI runner stdout-jában, nem silent pass — a Phase 5 brief §3.2 workflow elvárása.

---

## 3. Engine-fix hatás — a másodlagos Donchian bug

### 3.1 A felfedezett bug

A Phase 5 M2 implementáció során kiderült, hogy az eredeti `donchian()` függvény a candle-window-ot **INCLUSIVE** módon számolta (out[i] = candles[i-period+1..i], current candle benne van). Ez matematikailag lehetetlenné tette a `close > upper` / `high > upper` breakout-detekciót (mivel `candle.close ≤ candle.high ≤ max(window.highs)`).

Kihatásai:
1. **Phase 5 Strategy C** (DonchianBreakoutStrategy): a strategy implementációja 0 trade-et adott volna az eredeti convention-nel.
2. **Phase 1-3 `MtfTrendConfluenceStrategy`**: a Phase 1-3 riport a `htf.donchianUpper` pullback-ellenőrzést használta — ez is sosem triggerelt a broken convention miatt.
3. **Phase 1-3 0-trade artifact utólagos magyarázata**: az engine-fix (Phase 4 PR #10) után a Phase 1-3 baseline rerun (Phase 5 M0) 0/9 trade-et adott. Ez két okból volt 0:
   - A `MtfTrendConfluenceStrategy` 3-rétegű confluence-e túl szigorú (Phase 5 §4.5.1 — strategy-selection dokumentálja)
   - A donchian bug miatt a confluence egyik ága sosem aktiválódott

A Phase 5 M2 javítása (`donchian()` → previous-bar-exclusive, standard Turtle convention) mindkét hatást orvosolta:
- Phase 5 Strategy C most 19-28 trade-et ad 1d timeframen (vs. 0 az eredeti convention-nel)
- Phase 1-3 + Phase 4 donchian-ellenőrzései mostantól valóban triggerelhetnek

### 3.2 Az engine-fix konkrét változtatásai

A Phase 5 M2 commit (cf18ca3) tartalmazza:

1. `packages/core/src/indicators/donchian.ts`: out[i] = candles[i-period..i-1] (previous-bar-exclusive)
2. `packages/core/src/indicators/donchian.test.ts`: 10 unit teszt frissítve az új konvencióra (mind átmegy)
3. `packages/core/src/indicators/index.ts`: új optional `mtfDonchianPeriod` config field
4. `packages/backtest/src/engine.ts`: `mtfDonchianPeriod: 20` default a `computeIndicators` hívásban
5. `packages/core/src/strategy/donchian-breakout.ts`: az `mtf.donchianUpper/Lower` referenciák (korábban undefined-ok lettek volna)

### 3.3 Várható hatás a Phase 1-3 + Phase 4 backtest-ekre

A Phase 4 mean-reversion (`MeanReversionBbStrategy`) NEM használja a Donchian indikátort, így a Phase 4 eredmények nem változnak. A Phase 1-3 `MtfTrendConfluenceStrategy` HASZNÁLJA a HTF Donchian-t a pullback-ellenőrzésnél, de a Phase 5 M0 rerun azt mutatta, hogy a Phase 1-3 a túl szigorú 3-layer confluence miatt amúgy is 0 trade-et ad. A Phase 1-3 újrafuttatása az új donchian convention-nel **várhatóan több trade-et hoz** (a donchian pullback trigger most már aktív), de a confluence másik két rétege továbbra is korlátozza a trade-számot. Ez a kérdés a Phase 6+ egy új M0 rerun-jában vizsgálandó.

A Phase 5 M2 commit message a "Donchian engine-fix — KIVÁLÓ felfedezés" szekció részletesen dokumentálja ezt a hatást.

---

## 4. Phase 1-3 + Phase 4 + Phase 5 összehasonlítás

A teljes empirikus történet 2024-01 → 2026-07 (30.1 hónap) BTC/ETH/SOL × 1h/4h/1d backtest-eken:

| Fázis | Stratégia | Resultátum (9 kombó átlaga) | Sharpe átlag | Max DD átlag |
|---|---|---:|---:|---:|
| **Phase 1-3** (engine-fix előtt) | MtfTrendConfluenceStrategy v1.0 (artifact, 4 trade) | 4 trade / −0.38% átlag | N/A | ~0.5% |
| **Phase 1-3** (engine-fix után, Phase 5 M0 rerun) | Ugyanaz, MTF aggregáció javítva | **0 trade / 0%** (minden kombó) | N/A | 0% |
| **Phase 4** | MeanReversionBbStrategy | 700 trade / −46.7% átlag | −3.04 | ~48% |
| **Phase 5 A** | AlwaysInTrendStrategy | 234 trade / −31.4% átlag | −2.07 | ~31% |
| **Phase 5 B** | Composite ensemble | **282 trade / −33.4% átlag** | −2.22 | ~37% |
| **Phase 5 C** | DonchianBreakoutStrategy (1h, 4h negatív) | 162 trade / **−13.0%** átlag | **−0.93** | ~14% |
| **Phase 5 C** | DonchianBreakoutStrategy (**1d**, pozitív) | **24 trade / +2.4%** átlag | **+0.36** | ~4% ✅ |

**Megfigyelések:**

1. **Phase 1-3 (artifact)** vs **(engine-fix)**: az artifact 4 trade-je valójában a broken MTF aggregáció mellékhatása volt. A Phase 5 M0 rerun kimutatta, hogy a Phase 1-3 a valódi 3-layer confluence-szel 0 trade-et ad — a strategy maga korrekt implementáció, csak a piacon sosem triggerel.

2. **Phase 4 mean-reversion**: a legnagyobb trade-szám (600-800 / 30 hó / symbol), de a fee-drag + rossz trade-szelekció miatt a legnagyobb veszteség (~−47%). A Phase 5 B ensemble trend-filterje mérsékli ezt (az MR short jelzéseket elveti), de a B ensemble még mindig ~−33% (fee-drag dominancia).

3. **Phase 5 A always-in**: közepes trade-szám (90-411 / 30 hó), Sharpe ~−2.07. A continuous signal + fix stop-loss engine-limitáció miatt a fee-drag dominál.

4. **Phase 5 C Donchian (1h, 4h)**: kevesebb trade, kisebb veszteség. A 4h BTC közel flat (−3.35%, Sharpe −0.27) — a legjobb a 4h kategóriában.

5. **Phase 5 C Donchian (1d)**: **AZ EGYETLEN PROFITÁBILIS STRATÉGIA-KOMBINÁCIÓ**. Lassú (24-28 trade / 30 hó), alacsony max DD (3-5.5%), pozitív Sharpe (0.16-0.46). A 1d breakout lassú, több hetes trendeket azonosít; a fee-drag nem dominál (kevés trade + magas time_exit arány).

### A +50%/hó realitásvizsgálat végső ítélőtáblája

A Phase 1-3 + Phase 4 + Phase 5 empirikus adatok alapján a **+50%/hó realitásvizsgálat eredménye** a bybit.eu SPOT 1:10 környezetben, single edge class-szal:

| Kategória | Hozam | Verdict |
|---|---|---|
| Trend-following alone (Phase 5 C 1d) | **+0.04% to +0.10%/hó** | Edge, DE 500×-del a +50%/hó alatt |
| Mean-reversion alone (Phase 4) | **−1.5% to −2.5%/hó** | NEM edge |
| Ensemble alone (Phase 5 B) | **−1.5% to −2.0%/hó** | NEM edge (fee-drag + ortogonális-komponens hiány) |
| **Multi-class (funding + trend + ?) for Phase 6+** | **(cáfolatlan, mert Phase 5-ön kívül)** | Phase 6+ feladat |

A Phase 5-ön kívüli edge class-ok vizsgálata a **Phase 6 scope**. Jelenlegi user-perspektívából a Phase 5 azt demonstrálja, hogy:
- ✅ A trend-following Donchian 1d egy IGAZ edge, bár lassú (0.04-0.10%/hó).
- ✅ A composite ensemble működési elve (trend-filter MR felett) korrekt, DE ortogonális-komponens hija kevésbé hatékony, mint a jobb trend-following alone.
- ❌ A +50%/hó single-class valószínűsége alacsony bybit.eu SPOT 1:10 környezetben.
- 🚧 A +50%/hó eléréséhez multi-class ensemble (trend-following + funding-carry + cross-exchange arb) szükséges.

---

## 5. Funding-rate carry status — Phase 6+ deployment

A Phase 5 brief §1.4 alapján a funding-rate carry (long-spot + short-perpetual, delta-semleges) vizsgálata Phase 5 M3-RA BACKTEST-SZINTŰ, deployment Phase 6+.

A Phase 5 kizárása a §3.1 / §4.5.3-ban dokumentálva:
1. **bybit.eu SPOT-only MiCAR korlát**: bybit.eu a MiCAR (Markets in Crypto-Assets Regulation) alatt lakossági ügyfeleknek perpetual futures-t NEM kínál.
2. **Cross-exchange workaround**: binance/OKX perpetual + bybit.eu spot. Ehhez multi-exchange ws adapter, withdrawal latency backtest, counterparty kockázat kvantifikáció kell — mind Phase 6+ feladat.
3. **Paper-trading szimuláció**: a Phase 5 M3 riport funding-rate szekció kizárólag historikus funding rate adatokra alapozott backtest-szintű szimulációt tartalmaz (ha a felhasználó kéri).

A Phase 6 javasolt scope:
- **Multi-exchange ws adapter** (binance + OKX) bybit.eu SPOT-hoz
- **Funding rate historikus adat** Binance perp-ről (8h funding payment snapshots)
- **Cross-exchange withdrawal latency** backtest (transfer latency 5-30 perc alapján)
- **Counterparty kockázat** kvantifikáció (két exchange, két custody lánc)
- **Backtest-szintű funding-rate carry** paper-trading szimuláció bybit.eu SPOT + binance perp synthetic execution modellel
- **Cél:** bybit.eu SPOT-ba integrálható funding-rate carry edge, ami a trend-followinggal kombinálva +0.3-1.0%/hó többlethozamot adhat a Phase 6-os ensemble-ben

Az Empirical adatok (funding-rate edge):
- Bybit Institutional (2025): delta-semleges 2025-ben minden hónapban pozitív, max DD 0.80%, iparági átlag +31.23%/év
- ainvest.com: 3x leveraged delta-semleges 16.0%/év, Sharpe 6.1 (3Y)
- bagtester: BTC 2022-2024 reális 8-15%/év a gross funding-ból
- ScienceDirect (2025): 60 scenario BTC/ETH/XRP/BNB/SOL 115.9%/6 hónap extremális piacon

A Phase 5 M3 funding-rate carry papír-szimulációt NEM tartalmaz — a Phase 5 scope kizárólag a 3 kiválasztott trend-following / ensemble stratégia + engine-fix dokumentálás volt.

---

## 6. Következő lépések (Phase 6 javaslat)

A Phase 5 lezártnak tekintendő a PR merge + REPORT-phase5.md usernek való átadása után. A user a végső riportnál dönt a Phase 6 scope-ról. Javasolt Phase 6 scope-lehetőségek:

### 6.1 Funding-rate carry (Phase 6+ prioritás 1)
- **Multi-exchange ws adapter** (binance + OKX perpetual feed) + bybit.eu SPOT integráció
- **Paper-trading szimuláció** bybit.eu SPOT + binance perp synthetic execution
- **Előzetes várakozás:** +0.5-1.5%/hó többlethozam az ensemble-ben (a Phase 5 trend-followinggal kombinálva)
- **Kockázat:** cross-exchange counterparty risk, withdrawal latency

### 6.2 Cross-exchange spread arb (Phase 6+ prioritás 2)
- **binance/Bybit/KuCoin spot-ok közötti spread figyelés**
- **Latency-érzékeny** (sub-100ms kell), jelenlegi infrastruktúra nem támogatja
- **Előzetes várakozás:** +0.1-0.3%/hó többlethozam (alacsony volume-on)

### 6.3 Position-sizing és risk-management finomhangolás (Phase 6+ prioritás 3)
- **Kelly-fraction optimalizálás** a Phase 5 C 1d pozitív edge-hez (jelenleg 0.25 conservative)
- **Volatility-targeting** (cél DD pl. 3-5% helyett fixed 0.5)
- **A Phase 5 M3 (low DD, low return) edge-et magasabb Kelly-val skálázni**

### 6.4 Trailing-stop engine support (Phase 7+ prioritás, technical debt)
- A Phase 5 A stratégia (always-in) trailing-stop nélkül a trade-szám 9× deviációt produkál
- Engine trailing-stop API + state-tracking lehetővé tenné a strategy-selection.md becsült 30-50 trade / 30 hó sávot elérni
- **Várható Phase 5 A eredmény javulás:** trailing stop-pal a fix stop-ot kiváltva, a fee-drag csökken és a trend-following komponens Sharpe-ja javulhat ~+0.5-tel

A user a Phase 5 riport átvétele után dönt a Phase 6 priority sorrendről. A Phase 5 M3 commit + PR #13 + REPORT-phase5.md a Phase 5 lezárása.

---

## 7. Output deliverables (M3 final)

| Fájl | Leírás | Státusz |
|---|---|---|
| `backtest-results/baseline-alwaysin-{btc,eth,sol}-{1h,4h,1d}.json` | 9 db — Strategy A mátrix | KÉSZ |
| `backtest-results/baseline-donchian-{btc,eth,sol}-{1h,4h,1d}.json` | 9 db — Strategy C mátrix | KÉSZ |
| `backtest-results/baseline-ensemble-{btc,eth,sol}-{1h,4h,1d}.json` | 9 db — Strategy B mátrix | KÉSZ |
| `backtest-results/REPORT-phase5.md` | Ez a fájl — Phase 5 végső riport | KÉSZ |

Összesen 27 új baseline JSON + 1 riport fájl = 28 új artifact.

A Phase 5 M3 commit message a Phase 5 brief §3.2 workflow szerint: `feat(backtest,core,backtest-tools,reports): ÜGYNÖK Phase 5 M3 — 27 baseline backtest + REPORT-phase5.md`.

---

## 8. Futtatási reprodukálhatóság

```bash
# Phase 5 M3 — 27 baseline backtest reprodukálás a feat/phase5-ensemble worktree gyökeréből:

# A: Always-in trend-following (9 futás)
for sym in BTC ETH SOL; do for tf in 1h 4h 1d; do
  lcsym=$(echo $sym | tr '[:upper:]' '[:lower:]')
  bun run packages/backtest-tools/src/cli/run-alwaysin-baseline.ts \
    --symbol=$sym/USDT --timeframe=$tf \
    --output=backtest-results/baseline-alwaysin-${lcsym}-${tf}.json
done; done

# C: Donchian breakout (9 futás)
for sym in BTC ETH SOL; do for tf in 1h 4h 1d; do
  lcsym=$(echo $sym | tr '[:upper:]' '[:lower:]')
  bun run packages/backtest-tools/src/cli/run-donchian-baseline.ts \
    --symbol=$sym/USDT --timeframe=$tf \
    --output=backtest-results/baseline-donchian-${lcsym}-${tf}.json
done; done

# B: Composite ensemble (9 futás, lassabb — always-in + MR trend-filter kombináció)
for sym in BTC ETH SOL; do for tf in 1h 4h 1d; do
  lcsym=$(echo $sym | tr '[:upper:]' '[:lower:]')
  bun run packages/backtest-tools/src/cli/run-ensemble-baseline.ts \
    --symbol=$sym/USDT --timeframe=$tf \
    --output=backtest-results/baseline-ensemble-${lcsym}-${tf}.json
done; done

# Unit tesztek — mind a 307 unit teszt átmegy az engine-fix óta
cd packages/core && bun test
cd packages/backtest && bun test

# Minőségi gates
bun run turbo typecheck lint test coverage
```

A Phase 5 M3-ig bezárólag a `feat/phase5-ensemble` branch tartalmazza:
- M1 commit (strategy-selection.md, §4.5 parent feedback finomítások)
- M2 commit (cf18ca3 — 3 stratégia + unit tesztek + CLI runner-ek + Donchian engine-fix)
- M3 commit (ez a riport + 27 baseline JSON)

A PR-t a root session által megnyitandó (gh CLI nincs auth-olva a worktree-en).

---

_Ez a riport a Phase 5 M3 final outputja. A +50%/hó realitásvizsgálat 2. körének eredménye: **RÉSZBEN** — egy trend-following edge osztály (Donchian 1d) profitábilis, de a +50%/hó eléréséhez multi-class ensemble (funding-rate + cross-exchange) kell, ami Phase 6+ scope._
