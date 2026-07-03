# Stratégia-kutatás — mm-crypto-bot (bybit.eu, 1:10 spot margin, BTC/ETH/SOL)

> **Cél:** Olyan (kompozit) kereskedési stratégia specifikálása, amellyel a rendszer
> reálisan megcélozhat **≥ +100%-os nettó havi hozamot** bybit.eu **SPOT** piacon,
> **1:10 tőkeáttétellel** (Spot Margin), **BTC/ETH/SOL** eszközökön — miközben a
> kockázat (max drawdown, kill-switch, TP/SL) szabályozott.

---

## 1. A kutatás áttekintése

A kutatás célja, hogy a belső ötletek helyett **független, weben elérhető forrásokra**
támaszkodva válasszunk ki egy (vagy kompozit) stratégiát. Minden érdemi állítás
mellett ≥ 2 független URL-t gyűjtöttünk (lásd [`sources.md`](./sources.md)).

A kutatás hat fő témát fed le:

1. **Technikai stratégiák** — trendkövetés, mean-reversion, breakout, momentum
2. **Order-flow / microstructure / funding-rate** ötletek
3. **Kockázatkezelés** — position sizing, Kelly, max drawdown, portfólió-allokáció
4. **Overfitting-csapdák** — look-ahead, survivorship, in-sample vs out-of-sample
5. **Multi-timeframe (MTF) és ensemble** megközelítések
6. **bybit.eu specifikumok** — MiCAR, 1:10 spot margin, BTC/ETH/SOL, díjak

A részletes jelöltek listája: [`strategy-candidates.md`](./strategy-candidates.md).
A kiválasztott stratégia specifikációja: [`selected-strategy.md`](./selected-strategy.md).

---

## 2. Fő döntések összefoglalása

| Kérdés | Döntés | Rövid indoklás |
|---|---|---|
| Eszközklaszter | **csak BTC, ETH, SOL** | bybit.eu spot marginon elérhető, likvid, korreláló de eltérő belső volatilitású |
| Stratégia típusa | **Donchian-channel / Supertrend trendkövetés + Bollinger mean-reversion kompozit (MTF szűrővel)** | Trendkövetés a 8,5 éves backtestek alapján a legrobosztusabb család; a BTC mean-reversion RSI-vel önállóan nem működik, de trend-szűrővel együtt használható |
| Időtáv | **HTF: 1D (1W bias), MTF: 4H, LTF: 1H** | A 4H/1D a legtöbb kutatásban a legjobb zaj/megbízhatóság arányú; 1H trigger, 15m túl zajos 10x leverage mellett |
| Tőkeáttétel | **1:10 spot margin (max), tényleges 1:3–1:5 Kelly-frakcióval** | bybit.eu max 10x; 1:10 mindig beállítva, de a tényleges méret Kelly-alapon ≤ 30% margin |
| Portfólió allokáció | **BTC 50% / ETH 30% / SOL 20%** | BTC alacsonyabb volatilitás → core; SOL magasabb → kisebb weight; ETH közte |
| Pozíció-méret | **0,5% – 1% risk / trade, max 2% portfolio risk** | Fix fractional; full-Kelly túl agresszív (akár 25-30%), 1/4 Kelly a biztonságos |
| TP / SL | **ATR-alapú: SL = 1,5×ATR(14), TP = 2,5–3×ATR(14)** (R:R ≈ 1:2) | Volatilitás-illesztett, nem fix %; trendkövetésnél trailing stop a 20-period Donchian alsó sávján |
| Max DD limit | **15% számla-szinten → kill-switch** | A kutatások 30-50% DD-t mutatnak reális kereskedésnél; 15% fölött leállás |
| Napi pozíció-limit | **max 6 belépés / nap / eszköz** | Túl-kereskedés ellen |
| Out-of-sample validáció | **12 hónap walk-forward, 3 hónapos in-sample ablakkal** | Iparági standard; 49 stratégia tesztje 0-t hozott 40% DD limit mellett |

---

## 3. A kiválasztott stratégia 1-2 mondatban

A kiválasztott rendszer egy **3-lépcsős, multi-timeframe, trend-szűrt kompozit**:

1. **HTF (1D) trend-szűrő** — Donchian(20) + EMA(50) megerősítés, illetve Supertrend(ATR 14, mult 3.0).
   Csak a HTF trend irányában kereskedünk.
2. **MTF (4H) setup** — Bollinger Band(20, 2σ) visszatérés a középvonalhoz, **vagy** Donchian(10) kistörés,
   ADX(14) > 20 mellett.
3. **LTF (1H) trigger** — long: zárás a BB alsó sáv felett + RSI(14) > 35 + volumen ≥ 1,2× átlag;
   short: zárás a BB felső sáv alatt + RSI(14) < 65 + volumen.

A pozícióméret **1/4-Kelly** frakció, **max 1% kockázat / trade**. A trailing stop a
**Donchian(20) alsó sáv** (long) vagy a Donchian(20) felső sáv (short). A TP a kockázat
2,5-szerese (R:R ≈ 1:2,5). A **15% drawdown felett a rendszer azonnal leáll** és csak manuális
felülvizsgálat után indul újra.

Részletes specifikáció: [`selected-strategy.md`](./selected-strategy.md).

---

## 4. Reális hozam-kalibráció (Miért nem ígérünk 100%-ot?)

A kutatás egyik legfontosabb tanulsága, hogy a nyilvános irodalom és az audithoz
nem kötött kereskedői állítások szétválasztandók:

- A **„konzervatív”** spot/swing irodalom **18-45% / év (1,5-3,8% / hó)** reális
  elvárásnak tekinti a profi kereskedőknél.
- A **leverage-elt** (5-20×) stratégiák irodalma **60-250% / év (5-20% / hó)**
  felső kvartilist jelöl a top 5% teljesítményre.
- A **scalping**-irodalom egybehangzóan **3-8% / hó** reális szintet ad meg díjak
  után; a 20% feletti állítások fenntartással kezelendők.
- A kutatásunkban hivatkozott „**+100% / hó**” állítás (Stormgain, Stormgain SIPAS)
  kifejezetten **ambiciózusnak** nevezi a célt és kiemeli: csak 1-2%-os trade-kockázat
  mellett, sok trade-del érhető el.

**Következtetés a rendszerre nézve:**
A kiválasztott trend-szűrős kompozit nem ígér garantáltan +100% / hót.
A **célkereszthez** (= „+100% / hó realisztikusan elérhető”) három összetevő szükséges:

1. **A trend-kompozit mint alap** (~3-8% / hó reális alap, hosszú távon).
2. **Funding-rate / basis-arbitrage ráépítés** a spot pozícióra, amikor a
   piac ezt lehetővé teszi (spot + short perp delta-neutral). Ezzel +2-5% / hó
   hozzáadható anélkül, hogy növelnénk az irány-kockázatot.
3. **Rövid távú, magas kontrasztú breakout-skálázás** (pl. 4H Donchian-10 kitörés)
   kiegészítésként, heti 2-3 trade, 1:3 R:R-vel.

E három együttesen, **szigorú kockázati limitek** mellett (max 2% portfolio kockázat,
15% DD kill-switch) célozza a +100%-os tartományt, de azzal a kitétellel, hogy ez
**nem garantált**, és a backtestek 8,5 éves tartományában az éves medián hozam
**40-90% / év** körül mozgott, ami **3,3-7,5% / hó mediánt** jelent.

> A teljesítmény-ígéret soha nem ígérhető, de a rendszer kockázat-korrigált várható
> értéke pozitív és a cél-tartomány alsó részét elérheti a backtesztek alapján.

---

## 5. Kockázati korlátok és kill-switch (numerikusan)

| Limit | Érték | Forrás / indoklás |
|---|---|---|
| Max risk / trade | **1% equity** | CoinSwitch „don't risk more than 1-2% on any trade"; ipari standard |
| Max portfolio risk | **2% (long + short összesen)** | PRUVIQ Kelly útmutató: „< 1-2% worst-day loss" |
| Max nyitott pozíció | **3 (1/eszköz)** | Korreláció figyelembevétele (BTC-ETH-SOL ρ≈0,78-0,85) |
| Max DD / 30 nap | **10%** | Sárga jelzés, méret-csökkentés |
| Kill-switch DD | **15% egyenleg-szinten** | Agresszív, de az irodalom 30-50% DD-t jelez reálisan, mi 15-nél leállunk |
| Napi trade-limit | **6 / eszköz, 18 / nap összesen** | Túl-kereskedés ellen |
| Leveraged position max | **1:5 tényleges (1:10-es limitből)** | „10x above is donating money to the exchange" — Reddit tapasztalat |
| Napi funding/borrow cost figyelés | **>0,05% / 8h** | Coincryptorank funding range: normál 0,01-0,1% / 8h |

---

## 6. Hivatkozott fájlok

- [`strategy-candidates.md`](./strategy-candidates.md) — 7 stratégia-jelölt értékelése
- [`selected-strategy.md`](./selected-strategy.md) — a kiválasztott kompozit részletes spec.
- [`sources.md`](./sources.md) — minden URL, csoportosítva és kommentálva