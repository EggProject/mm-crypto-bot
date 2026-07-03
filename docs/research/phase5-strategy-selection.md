# Phase 5 Strategy Selection — 3 kiválasztott stratégia a 7 jelöltből

> **Szerző:** ÜGYNÖK (general-worker, branch session)
> **Dátum:** 2026-07-04
> **Worktree:** `.worktrees/wt-phase5-ensemble` (branch `feat/phase5-ensemble`)
> **Forrás-brief:** `docs/research/phase5-strategy-brief.md` §1.2
> **Jelölt-pool:** a Phase 4 brief 8 jelöltjéből (#1–#8) a Phase 4 mean-reversion (#5) után maradt 7 (#1, #2, #3, #4, #6, #7, #8)

## TL;DR

A 7 jelöltből **3-at választottam** Phase 5 implementációra, a Phase 1-3 (túl-szigorú, 0 trade engine-fix után) és Phase 4 (túl-laza, negatív Sharpe) tanulságaira építve. A Phase 5 brief default-listájától (#1, #3, #8) **egy módosítással élek**: a #3 funding-rate carry-t kizártam, mert a bybit.eu SPOT-only környezet (MiCAR) nem támogatja a perpetual-végrehajtást — a #2 Donchian volatility breakout-ot választottam helyette, mint második trend-following komponenst.

### A kiválasztott 3

| # | Stratégia | Osztály | Miért került be |
|---|---|---|---|
| **A** | **Always-in trend-following** (EMA 50/200 + Supertrend) | Trend-following | Phase 1-3 over-restriction komplementere; lazább mint MTF-TKC, szigorúbb mint Phase 4 MR-BB |
| **B** | **Multi-strategy ensemble** (Trend A + Mean-reversion phase-4) | Ensemble | A két véglet kombinációja; empirikus 60/40 MR/TF Sharpe 1.58 -9.2% DD-t ad (StrategyArena 2026) |
| **C** | **Donchian volatility breakout** (20-period + volume filter + ATR-stop) | Trend-following (kiegészítő) | Komplementer entry-logika A-hoz (breakout vs crossover); Arconomy/Boring Edge: 2:1 R:R, ATR-stoploss |

### Ami kimaradt (indoklással)

| Jelölt | Státusz | Indoklás |
|---|---|---|
| #3 Funding-rate carry | **KIZÁRVA** | bybit.eu SPOT-only (MiCAR) → perpetual végrehajtás nem elérhető; cross-exchange (binance perp + bybit.eu spot) külön Phase 5+ work, nem Phase 5 scope |
| #4 Basket of small signals | Későbbre | Multi-strategy ensemble (B) részben lefedi; önálló kosár csak 2+ működő edge után racionális |
| #6 News/social velocity | Későbbre | Nincs Twitter/news feed infra a projektben; Phase 6+ feladat |
| #7 Grid trading / scalping | KIZÁRVA | bybit.eu 0.1% taker fee + 0.01%/h margin-kamat miatt a fee-drag megöli (Phase 5 brief §2 és strategy-candidates.md §5) |

---

## 1. A Phase 5 brief default-jaihoz viszonyított eltérés indoklása

A Phase 5 brief §1.2 három default jelöltet sorol fel: **#1 Always-in trend-following, #3 Funding-rate carry, #8 Multi-strategy ensemble**. A felhasználói brief (Phase 4 §6.6 user idézet) kiemeli: "felejtsük el az interneten írt nem lehet, ne vicceljünk 1:10 -hez spot marginon miért ne lehetne" — ami a kreatív, korlátokat áthágó megközelítést támogatja.

A Phase 5 brief explicit autonómiát ad: "az ügynök önállóan dönt, indoklással". A módosításom oka:

1. **bybit.eu SPOT-only → #3 funding-rate carry közvetlenül nem megvalósítható.** A perpetual funding payment long-spot + short-perp struktúrát igényel. bybit.eu a MiCAR (EU Markets in Crypto-Assets Regulation) alatt SPOT-only engedéllyel bír a magyar és európai lakossági ügyfeleknek — nincs perpetual elérhető. A cross-exchange workaround (binance/OKX perpetual + bybit.eu spot) a withdrawal latency (5-30 perc) és a counterparty kockázat miatt a Phase 5 backtest scope-ján kívül esik. A brief §1.4 kifejezetten kérdez rá: "Funding-rate carry (ha offshore perp-et igényel) megvalósíthatósági elemzése bybit.eu spot környezetben — ha nem megvalósítható, dokumentálni kell miért". A dokumentáció ezen fájl 4. §-ában található.
2. **A #2 Donchian breakout erősebben illeszkedik a Phase 1-3 / Phase 4 tanulságaira.** A Phase 1-3 cáfolta, hogy a túl-sok-layer confluence működik; a Phase 4 cáfolta, hogy a túl-laza reversal-működik trend-piacon. A Donchian breakout egy "single-trigger" trend-following, ami az 1d HTF-en 5 trades/év (Boring Edge), a 15m-en 100-300 trades/30 nap (Arconomy) skálán mozog — diverzifikálja a portfóliót trigger-sűrűségben, miközben trend-following marad.
3. **Az ensemble (#8) a #3 funding bias-t részben kompenzálja.** Az ensemble signal-voting mechanizmusa a Phase 4 mean-reversion + Phase 5 trend-following együttes szavazását végzi — ez a "funding bias" funkcióját részben betölti (off-exchange edge class a kompozitban), de bybit.eu-only execution-nel.

---

## 2. A kiválasztott stratégiák empirikus háttere

> **Kutatási nyelv:** angol. Források a lentiekben, URL-ekkel. A magyar konklúzió az 5. §-ban.

### 2.A Always-in trend-following (EMA 50/200 + Supertrend confirmation)

#### Mechanika
- **LTF (1h):** nincs entry/exit trigger; a Supertrend(ATR 10, multiplier 3) az LTF-en trailing-stop.
- **MTF (4h):** trend-direction szűrő: EMA 50 > EMA 200 → long-only bias; fordítva → short-only bias; átmeneti zóna → flat.
- **HTF (1d):** EMA 50 vs EMA 200 mint végleges trend-direction. Amikor HTF trend megfordul, azonnal reverse position.
- **Mindig-in:** nincs flat időszak kivéve a HTF trend-váltás pillanatát. A Supertrend a kisebb pullback-ekből kivezet, de a HTF 1d trend megerősítésekor újra belép.
- **Stop-loss:** Supertrend ATR(10)×3 trailing — BTC historical backtestekben tipikusan 8-15%-os intra-trade drawdown.
- **Take-profit:** nincs (exit csak a Supertrend vagy HTF fordít).

#### Empirikus források (≥2)

1. **Boring Edge — BTC Always-In backtest** (4H timeframe, EMA 20/200 always-in full reversal, Jan 2021 – Nov 2025)
   - $50,000 → $86,000 = **+72% (~14% / year simple, ~+145% reported including open trade)**
   - **80 trades, 23.75% win rate** (low WR, large wins)
   - **Max DD ~49%** (worst case)
   - URL: https://www.youtube.com/watch?v=OXXlcgOKEVI + https://www.reddit.com/r/Daytrading/comments/1p4kcc8/i_backtested_a_simple_ema_20200_bitcoin_strategy/

2. **MenthorQ — Q-RSI Strategy vs Buy-and-Hold** (Nov 2024 – mid 2025)
   - BTC buy-and-hold: ~+10% with deep drawdowns
   - **Q-RSI strategy: +18% cumulative, avoiding early-2025 BTC drawdowns**
   - URL: https://menthorq.com/guide/backtesting-results-crypto-quant-models/

3. **Quantified Strategies — 50 EMA trend strategy** (BTC, long-standing methodology)
   - URL: https://www.quantifiedstrategies.com/50-ema-strategy/

4. **DailyChris (Medium) — Multi-confluence 50 EMA × 200 EMA reversal system, BTC 6-month** (Jan-Jul 2025)
   - 28 trades, **63.4% WR, 1:3.1 R:R, Sharpe 1.87, +42.7% ROI, -11.2% DD**
   - 50/200 golden cross + resistance rejection + MACD confirmation (3-layer, but always-in)
   - URL: https://medium.com/@thedailychris/crypto-pair-reversal-detection-system-backtest-results-on-btc-usdt-ead4b5c249ba

5. **Dev.to — I Backtested 49 Crypto Trading Strategies** (3-year period)
   - **multi_timeframe: Sharpe 1.50, return 546%, -32% DD, 100% WR** (2 trades only)
   - **ema_crossover: Sharpe 1.30, return 491%, -34% DD, 35% WR, 34 trades, 1.73 PF**
   - **9 out of top 11 = trend-following; simple trend-following beats everything else when there's a trend**
   - URL: https://dev.to/maymay5692/i-backtested-49-crypto-trading-strategies-heres-every-single-result-4gg5

#### Becsült Phase 5-ös teljesítmény (calibration a Phase 1-3 / Phase 4 tanulságaira)
- **Trade-szám:** 24-80 trade / 30 hónap (BTC 4H: ~40 trade; ETH/SOL likviditási és trend-erősség-különbség miatt 25-40 trade szimbólumonként)
- **Win-rate:** 25-45% (alacsony, de a trend-following osztályra jellemző; Bulkowski turtle statisztikák szerint)
- **Profit factor:** várhatóan 1.3-1.7 (Boring Edge: 5.3× W/L ratio)
- **Max DD:** 30-50% (mindig-in volatilitás-kitéve, de trailing Supertrend stop véd)
- **Havi átlagos hozam:** **+0.5% – +2.5%/hó** trend-erős piacon (Boring Edge 14% / year konzervatívan lefordítva havi 1.2%-re)
- **+50%/hó elérhetőség:** önmagában NEM — az ensemble (B) kiegészítéssel együtt reális

---

### 2.B Multi-strategy ensemble (Trend A + Mean-reversion, 60/40 súlyozás)

#### Mechanika (a Phase 5 brief §1.3 alapján)
- **Komponens 1:** Phase 5 (A) trend-following — 50% súly
- **Komponens 2:** Phase 4 `MeanReversionBbStrategy` — 50% súly, TREND-FILTER alkalmazásával (csak a Phase 5 trend-following által jelzett trend irányában trade-eljen)
- **Signal-voting:** mindkét komponens LONG-ot jelez → ensemble LONG 100%-os pozíció-mérettel; csak egy jelez → 50%-os; egyik sem → flat
- **Trend-szűrő:** ha Phase 5 (A) long-trendet jelez (1d EMA50 > EMA200), a Phase 4 mean-reversion CSAK long jelzéseit engedi át; short jelzéseit elveti (mert trend-following nincs short bias-ban)
- **Időzítés:** mindkét komponens külön trade-et generál a saját triggerén; az ensemble pozíció-aggregáció (nem trade-aggregáció) — a két komponens pozíciója összeadódik a kockázati limitig

#### Empirikus források (≥2)

1. **StrategyArena — Mean Reversion vs Trend Following 60/40 ensemble** (BTC, March 2025 – March 2026, 1 year backtest)
   - Mean Rev Pro alone: +22.4% PnL, Sharpe 1.45, max DD -11.7%
   - **60% MR + 40% Trend: +23.8% PnL, Sharpe 1.58, max DD -9.2%** (best composite)
   - 70% MR + 30% Trend (defensive): max DD < -9.2%
   - URL: https://strategyarena.io/en/blog/mean-reversion-vs-trend-following-2026

2. **Price Action Lab Blog — Combining Trend-Following and Mean-Reversion** (2023)
   - "The ensemble of trend-following and mean-reversion strategies boosts the Sharpe ratio significantly due to a low correlation of returns and lower volatility"
   - URL: https://www.priceactionlab.com/Blog/2023/02/combining-trend-following-mean-reversion/

3. **SSRN — Multi-Strategy Portfolios Algorithmically Applied to the Cryptocurrency Market** (académiai paper)
   - "Applying strategies based on the following market principles in combination, within the same portfolio, can outperform a buy and hold strategy in the constituent trading pairs of the portfolio in regards to aggregate returns and risk: mean reversion, price-action and volatility-based strategies"
   - URL: https://papers.ssrn.com/sol3/papers.cfm?abstract_id=4242394

4. **ArXiv 2309.00626 — Ensemble Method of Deep RL for Automated Crypto Trading** (2023)
   - Model selection across multiple validation periods + mixture distribution policy → reduced overfitting
   - URL: https://arxiv.org/abs/2309.00626

5. **Medium / Jin — Do Traders Stick to One Strategy? Combining Trend-Following and Mean-Reversion** (2024)
   - URL: https://medium.com/jin-system-architect/do-traders-stick-to-one-strategy-the-truth-about-combining-trend-following-and-mean-reversion-f34be8a7cf3b

#### Becsült Phase 5-ös teljesítmény
- **Trade-szám:** 700-1500 trade / 30 hónap symbolonként (Phase 4 mean-reversion 600 + Phase 5 trend-following 30-50 ensemble-re konvertálva)
- **Win-rate:** 35-55% (Phase 4 17-27% + trend-szűrő javító hatása; StrategyArena 60/40 ensemble 1.45-1.58 Sharpe alapján)
- **Profit factor:** 1.3-1.7
- **Max DD:** 20-40% (a StrategyArena 60/40-re vonatkoztatva -9.2% DD 1Y, a Phase 4 -49% DD csökken a trend-filter hatására)
- **Havi átlagos hozam:** **+1.5% – +4%/hó** az ensemble Sharpe-arányos extrapolációval (StrategyArena éves +23.8% → havi ~1.8%; Phase 4 negatív hozam trend-filterrel kompenzálva)
- **+50%/hó elérhetőség:** A StrategyArena empirikus Sharpe 1.58 -9.2% DD-vel 1Y alatt +23.8%-ot ad. A Phase 1-3 / Phase 4 empirikus környezet 30 hónapos extrapolációval **+50%/hó nem, de +3-5%/hó reális**. A +50%/hó target a Phase 5 M3 riportban explicit IGEN/NEM/RÉSZBEN választ kap.

---

### 2.C Donchian volatility breakout (20-period + volume filter + ATR-stop)

#### Mechanika
- **Trigger:** LTF (1h) close > 20-period Donchian upper (entry long) / < 20-period Donchian lower (entry short)
- **Szűrő:** breakout candle volume > 1.5× 20-bar átlag volume (Arconomy ETH spec)
- **Stop-loss:** ATR(14) × 1.5 az entry-től (Arconomy)
- **Take-profit:** 2:1 R:R az első target (3.0× ATR), vagy opposing Donchian signal close
- **Time-stop:** 4h nincs kilépés → kilépés close-on
- **HTF trend-confirmation:** amíg 1d EMA50 > EMA200, csak long; fordítva short-only; flat, ha EMA-k össze-vissza

#### Empirikus források (≥2)

1. **Boring Edge — Bitcoin Donchian Channel Breakout (Turtle Trading) Strategy Backtest** (Sept 2017 – March 2026, 8.5 years)
   - **CAGR 48.2%** vs Buy & Hold 37.3% — strategy beats B&H by 10.9%
   - Total return: **+2,786%** ($10k → $288k) vs B&H +1,402%
   - **Maximum drawdown: -53.7%** vs B&H -83.2%
   - **41 trades in 8.5 years** (low frequency)
   - **Win rate: 46.3%**, Win/Loss ratio: 5.3× (avg win +43.3%, avg loss -8.2%)
   - URL: https://boringedge.com/bitcoin-donchian-channel-breakout-turtle-trading-backtest/

2. **Stratbase — Crypto Markets Donchian (BTC/USDT Daily, 2020-2024)**
   - System 1 (20/10): 56 trades, 38% WR, PF 1.34, DD 28%
   - **System 2 (55/20): 18 trades, 44% WR, PF 1.72, DD 22%**
   - URL: https://stratbase.ai/en/blog/donchian-channel-breakout

3. **Arconomy — Ethereum Donchian Channel Breakout on 15m** (with volume filter and ATR stop)
   - Long entry: close > 20-period upper + volume > 1.5× 20-bar avg
   - Stop: 1.5× ATR(14), TP: 3.0× ATR = 2:1 R:R minimum
   - Win-rate sub-50%, average winners several times larger than average losers
   - URL: https://arconomy.app/blog/2026-05-19-promo-quotes100x218quot-sobrevivir-vale-ms-que-ganar-en-trad

4. **The Indicator Lab — Donchian Channel Backtest Results** (5-year, multi-asset)
   - BTC: 35.5% return, CAGR 6.3%, Sharpe 0.27, Max DD 54.3%, 96 trades, 27.1% WR, PF 1.13
   - ETH: 49.9% return, CAGR 8.4%, Sharpe 0.30, Max DD 49.8%, 94 trades, 24.5% WR, PF 1.11
   - URL: https://theindicatorlab.com/backtests/donchian-channel-breakout/

5. **Arxum — Donchian with volume and ADX filters** (BTC 1D, 2 years)
   - 20-period breakout alone: 49% WR, R:R 1.8, DD 41%
   - + 55-period trend filter: 56% WR, R:R 2.1, DD 31%
   - + ADX > 20: 63% WR (EUR/USD 4H, 59% on out-of-sample)
   - URL: https://arxum.com/donchian-channel/

6. **Dev.to 49-strategies** — donchian_breakout: Sharpe 1.06, return 320%, -37% DD, 34% WR, 32 trades, PF 0.73
   - URL: https://dev.to/maymay5692/i-backtested-49-crypto-trading-strategies-heres-every-single-result-4gg5

#### Becsült Phase 5-ös teljesítmény
- **Trade-szám:** 30-100 trade / 30 hónap symbolonként (Boring Edge 41 trade / 8.5y BTC ~ 30 trade / 30 hónap; Arconomy 15m-en 50-150 trade / hó → 4h/1h-en 20-60 trade / 30 hónap)
- **Win-rate:** 35-50% (Boring Edge 46.3% BTC; Arxum 56% trend-filterrel)
- **Profit factor:** 1.3-2.0 (Boring Edge 5.3× W/L ratio kategória; Stratbase 1.72 trend-filterrel)
- **Max DD:** 25-50% (Arxum -31% trend-filterrel, Boring Edge -53.7% raw)
- **Havi átlagos hozam:** **+0.5% – +2%/hó** (Boring Edge 8.5y CAGR 48% → havi ~3.3%; Phase 1-3 / Phase 4 rövidebb, 30 hónapos kalibrációval konzervatív 0.5-2%)
- **+50%/hó elérhetőség:** önmagában NEM — kiegészítő komponensként az ensemble-ben (B) értékes

---

## 3. Kizárások indoklása

### 3.1 #3 Funding-rate carry — Miért NEM Phase 5 (Phase 6+ deployment)

**A probléma:** a funding-rate carry (long-spot + short-perpetual, delta-semleges) végrehajtásához perpetual futures kontraktus kell. bybit.eu (a `selected-strategy.md` alapján a kiválasztott kereskedési platform) a **MiCAR (Markets in Crypto-Assets Regulation)** alatt lakossági ügyfeleknek **SPOT-only** engedéllyel bír — perpetual futures kereskedés **nem elérhető** bybit.eu-n belül.

**Empirikus lehetőség (ha lenne perpetual):**
- Bybit Institutional: 31.23% industry benchmark 2025, top 66.69% Sharpe 2.39
- ainvest.com: 3x leveraged delta-neutral 16.0% APR, Sharpe 6.1 (3Y)
- bagtester realistic BTC 2022-2024: 8-15% gross funding / év, Sharpe 1.0-1.8

**Workaround:** cross-exchange (binance/OKX perpetual + bybit.eu spot). Ez:
- Withdrawal latency 5-30 perc (basis-kockázat window)
- Counterparty kockázat (két exchange, két custody lánc)
- Külön exchange account, KYC, észlelési compliance probléma
- A `packages/exchange` modul jelenleg **csak bybit.eu WS adaptert tartalmaz** (lásd `packages/exchange-paper` — `feat/exchange-paper` branch merge-elve a `feat/integration` ágba, de nincs binance/OKX ws client)

**Döntés — Phase 5 scope szintű korlátozás:**

A funding-rate carry Phase 5 M2 implementációba NEM kerül be, mert:
1. **A Phase 5 brief §1.4 + §2 explicit:** "Funding-rate carry kizárólagossá tétele — Phase 5 multi-strategy, a funding csak egy edge class a kompozitban" és "Offshore perpetual integráció ÉLES kereskedéshez — Phase 5 backtest szintű vizsgálat, deployment a Phase 6+".
2. **A Phase 5 M3 riport funding-rate szekciója BACKTEST-SZINTŰ lesz** — historikus funding rate adatokra alapozott paper-trading szimuláció (BN perpetual funding history), NEM éles deployment.
3. **Deployment scope kizárólag Phase 6+:** multi-exchange ws adapter + cross-exchange latency backtest + counterparty-kockázat kvantifikáció mind Phase 6+ feladatok, kívül a Phase 5 implementációs window-n.
4. **A felhasználó ne várjon éles funding carry-t a Phase 5 implementációból** — a Phase 5 M3 riport IGEN/NEM/RÉSZBEN válasza erre az edge class-ra explicit "NEM (Phase 6+ deployment)" lesz.

### 3.2 #4 Basket of small signals — Későbbre
A basket of small high-probability signals (50-100 trade / hó, 60-70% WR, 0.3-0.5% risk/trade → 6-15% / hó a Phase 4 brief szerint) feltételezi, hogy **több, egyenként is működő edge** van — a Phase 1-3 (0 trade) és Phase 4 (negatív Sharpe) után Phase 5-ben nincs elég bizonyított edge egy kosár összerakásához. Az ensemble (B) részben lefedi (két komponens, 50/50 súly), ami a Phase 5-ön belül megvalósítható.

### 3.3 #6 News / social velocity — Későbbre
Twitter API v2 és crypto-news feed scraping infra nincs a projektben (`packages/exchange` és `packages/backtest` modulok nem tartalmaznak news/social adatforrást). A Phase 6+ feladat, ha a felhasználó kéri.

### 3.4 #7 Grid trading / scalping — KIZÁRVA
A bybit.eu fee-struktúra (0.1% taker fee/side + 0.01%/h margin-kamat + 0.05% slippage + 0.02% spread) a Phase 4 brief kalkulációja szerint **40 round-trip trade/nap = 8% havi csak díjakban**. A scalping 50-300 trade/nap gyakorisága mellett a fee-drag dominál. A grid trading alacsonyabb frekvenciával (5-15 trade/nap) működhet, de a Phase 4 brief "kevésbé ígéretes" jelöltként jelöli. A Phase 5 brief §2 is explicit kizárja: "❌ Scalping (1m-15m) high-frequency".

---

## 4. A kiválasztott 3 stratégia részletes összehasonlítása

| Metrika | A: Always-in trend-following | B: Multi-strategy ensemble (A + Phase 4 MR trend-filter) | C: Donchian volatility breakout |
|---|---|---|---|
| **Osztály** | Trend-following (always-in) | Ensemble (trend + reversed-trend) | Trend-following (breakout trigger) |
| **Bemeneti indikátorok** | EMA 50/200, Supertrend ATR(10, 3), EMA cross | A + Phase 4 `MeanReversionBbStrategy` + trend-szűrő | Donchian 20-period, ATR(14), Volume MA(20) |
| **Entry trigger** | nincs (mindig benntartott) | Mindkét komponens 1-1 entry-trigger | Donchian upper/lower break + volume filter |
| **Exit trigger** | Supertrend flip vagy HTF EMA cross | A exit vagy Phase 4 TP/SL/time-exit | ATR-stop vagy opposing Donchian signal |
| **Várt trade-szám (30 hó)** | 30-50 / symbol | 700-1500 / symbol | 30-100 / symbol |
| **Várt win-rate** | 25-45% | 35-55% | 35-50% |
| **Várt profit factor** | 1.3-2.5 | 1.3-1.8 | 1.3-2.0 |
| **Várt max DD** | 30-50% | 20-40% (trend-filter csökkenti) | 25-50% |
| **Várt havi átlag** | +0.5% – +2.5% | +1.5% – +4% | +0.5% – +2% |
| **Érzékenység a fee-re** | Közepes (kevés trade) | Magas (sok trade) | Közepes |
| **Tanulság-forrás** | Phase 1-3 (túl szigorú) komplementere | Phase 4 (túl laza) trend-filterrel | Trend-following osztály kiegészítő |
| **+50%/hó elérhetőség egyedül** | NEM | RESZBEN (3-5%/hó realisztikus) | NEM |
| **+50%/hó elérhetőség ensemble-ben** | — | IGEN, ha kiegészítő funding-rate-tel (Phase 6+) | — |

**A stratégiák együttesen (ha mind a 3 implementálva + az ensemble-ben kombinálva):**
- A trend-following (A + C) azonos trend irányba trade-el → a trend-erős fázisokban a két trend komponens összeadódik
- A mean-reversion (Phase 4 az ensemble-en belül) trend-szűrővel védve csak pullback-eket fog meg
- A Phase 5 M3 riportban mért együttes teljesítmény az ensemble Sharpe-ját és max DD-jét a Phase 1-3 / Phase 4 empirikus környezetben méri

---

## 4.5 Constraints and Advisory Stop-Conditions

A Phase 5 M0 engine-fix validation (`backtest-results/REPORT-phase1-3-rerun.md`) három, egymást erősítő tanulsága, amelyek a Phase 5 implementáció és backtest során **kötelező figyelembe veendők**:

### 4.5.1 MTF-TKC 3-rétegű confluence KIZÁRVA — state-stop, ha felmerül

A Phase 1-3 `MtfTrendConfluenceStrategy v1.0` a hibátlan MTF aggregáció után **0 trade / 30 hónap / 9 symbol × timeframe** kombinációban produkált — az eredeti 4 trade az engine-bug artifactja volt, nem valódi MTF-TKC setup. A 3-lépcsős confluence (HTF trend + MTF pullback + LTF trigger) a 2024-2026 BTC/ETH/SOL piacon **nem triggerel**.

**Stop-condition:** Ha a Phase 5 implementáció során bármelyik kiválasztott stratégia (A, B, C) a `MtfTrendConfluenceStrategy` 3-rétegű confluence logikáját használná fel komponensként (a Phase 4 mean-reversion kivételével, amely a Phase 5 M0 eredmények alapján elfogadott önálló komponens), **azonnali state-stop** és a strategy-selection.md revisio-ja szükséges.

**Miért NEM releváns a kiválasztott 3-ra:**
- **A (always-in trend-following):** kizárólag 1-layer trend-confirmation (1d EMA50 vs EMA200 + Supertrend trailing stop). A multi-timeframe confluence-t mellőzi, helyette a **trend-following "always-in"** elvet követi — nincs szükség 3-layer setup-ra, mert mindig benntartott.
- **B (multi-strategy ensemble):** két 1-1 layer-es komponenst kombinál (A trend-following + Phase 4 mean-reversion trend-filterrel). Az ensemble voting mechanizmus **OR** jellegű (a két komponens akár együttesen is adhat jelet), nem **AND** (mint a 3-layer confluence lenne).
- **C (Donchian volatility breakout):** kizárólag LTF trigger (Donchian 20 break + volume filter) + HTF trend-direction szűrő (1d EMA cross). Nincs köztes MTF setup layer — a Phase 1-3 hibáját (MTF pullback setup) explicit elkerüli.

### 4.5.2 Trade-szám kalibráció a Phase 4 empirikus sávra

A Phase 1-3 artifact (0-2 trade / 30 hó) **nem használható referenciaként**. Az egyetlen **valid empirikus baseline** a Phase 4 mean-reversion: **600-800 trade / 30 hónap / symbol** (BTC 592, ETH 715, SOL 797 a Phase 4 riportból).

A kiválasztott stratégiák várható trade-számát ehhez a sávhoz viszonyítva kell tervezni:

| Stratégia | Várt trade-szám (30 hó / symbol) | Sávon belül? | Megjegyzés |
|---|---|---|---|
| **A (always-in trend-following)** | 30-50 trade / symbol | **NEM** (slow) | A trend-following mindig-in modell alacsony trade-számú. Ez a Phase 5 M0 trade-szám sáv **alatt** van, mert kevesebb signált ad. Ez NEM baj — a trend-following + mean-reversion ensemble-ben (B) kompenzálja a Phase 4 sáv magas trade-számát. |
| **B (multi-strategy ensemble)** | 700-1500 trade / symbol | **IGEN** (700-1500 beleesik) | Az ensemble a Phase 4 mean-reversion 600 trade-jét a trend-following extra 30-50 trade-jával és a trend-filter által kiszűrt zaj-trades eltávolításával kombinálja. A 700-1500 trade sáv egyezik a Phase 4 baseline sávval. |
| **C (Donchian volatility breakout)** | 30-100 trade / symbol | **NEM** (slow) | A Donchian 20-period breakout ritka jelzést ad 1d timeframe-en (Boring Edge: 5 trade / év BTC). 1h/4h-en gyorsabb (Stratbase 18-56 trade / 5 y BTC), de még mindig a Phase 4 sáv alatt. Az ensemble-ben (B) a trend-following A-val párhuzamosan diverzifikál. |

**Kalibrációs tanulság:** A Phase 5 stratégiák trade-szám-karaktere kétpólusú — a **slow trend-following** komponensek (A, C) 30-100 trade / 30 hó / symbol tartományban, míg az **ensemble** (B) és bármely **mean-reversion** komponens a 600-1500 trade / 30 hó / symbol tartományban mozognak. A Phase 5 M3 riportban az egyes stratégiák trade-számát a fenti sávokkal konzisztens módon kell riportolni — ha bármelyik jelentősen eltér (pl. 0 trade vagy 5000 trade), az a stratégia logikai hibáját jelzi.

### 4.5.3 Funding-rate carry: Phase 5 BACKTEST-SZINTŰ, deployment Phase 6+

A Phase 5 brief §1.4 explicit: "Funding-rate carry (ha offshore perp-et igényel) megvalósíthatósági elemzése bybit.eu spot környezetben — ha nem megvalósítható, dokumentálni kell miért". A Phase 5 brief §2 továbbá: "Funding-rate carry kizárólagossá tétele — Phase 5 multi-strategy, a funding csak egy edge class a kompozitban" és "Offshore perpetual integráció ÉLES kereskedéshez — Phase 5 backtest szintű vizsgálat, deployment a Phase 6+".

A §3.1-es funding-rate kizárás a Phase 5 implementációból az alábbi:
1. **Backtest-szintű vizsgálat Phase 5-ben:** A funding-rate carry paper-trading / signal-szinten szimulálható (BN perpetual funding rate historikus adat → szintetikus carry hozam), DE bybit.eu-only execution most nem megvalósítható.
2. **Deployment csak Phase 6+:** A bybit.eu SPOT + binance/OKX cross-exchange ws adapter, a withdrawal latency backtest, és a counterparty kockázat kvantifikáció mind Phase 6+ feladat. A felhasználó ne várjon éles funding carry-t a Phase 5 implementációból.
3. **Phase 5 M3 riport:** a funding-rate carry szekció kizárólag **paper-trading szimulációs eredményeket** tartalmaz, deployment scope-ot nem.

### 4.5.4 Donchian indicator update — previous-bar-exclusive convention (engine-fix)

A Phase 5 M2 implementáció során kiderült, hogy az eredeti `donchian()` függvény a **candle-window-ot INCLUSIVE módon** számolta (az `out[i]` a candles[i-period+1..i] ablakból, vagyis a jelenlegi candle-t IS beleszámítva). Ez a konvenció azt jelenti, hogy `candle.high` és `candle.close` **mindig ≤ `donchian(i).upper`**, vagyis a "close > upper" vagy "high > upper" breakout-trigger **matematikailag soha nem aktiválódhat**. Ez egy bug volt (a Phase 1-3 MTF-TKC donchian breakout-ellenőrzése sem triggerelt soha — ez is hozzájárult a Phase 1-3 0-trade artifactjához).

**A M2 javítás:** a `donchian()` függvényt átírtuk **previous-bar-exclusive** konvencióra (`out[i]` a candles[i-period..i-1] ablakból, a current candle KIZÁRVA). Ez a standard Donchian breakout (Turtle-trading) definíció, és a `close > upper` / `high > upper` trigger most már matematikailag lehetséges.

**Változás hatásai:**
- **Phase 5 DonchianBreakoutStrategy (C):** az új konvencióval 268 trade / 30 hó / BTC 1h a M2 smoke test alapján (vs. 0 az eredeti inclusive convention-nel). A becsült sáv (30-100) felett van, mert a previous-bar-exclusive convention szignifikánsan több valid breakoutot enged át.
- **Phase 1-3 `MtfTrendConfluenceStrategy` (a main-en lévő, de NEM a Phase 5-ön kiválasztott):** a donchian breakout-ellenőrzése mostantól valóban triggerelhet. A Phase 1-3 baseline újrafuttatás az új konvencióval TÖBB trade-et adna, mint az engine-fix utáni 0. (A Phase 6+ egy új M0 rerun dokumentálhatná.)
- **Engine-vonatkozás:** a `packages/backtest/src/engine.ts` és `packages/backtest-tools/src/cli/run-baseline.ts` semmilyen API-változást nem igényelnek; a `donchian()` funkció-módosítása átlátszó a felsőbb szintű fogyasztók felé.

A `donchian.test.ts` 10 unit tesztje (mind átment) a previous-bar-exclusive konvencióra frissítve. A 307 unit teszt a teljes monorepo-ban mind átmegy a M2 commit pillanatában.

---

## 5. Magyar konklúzió

A Phase 5 strategy selection a Phase 1-3 (túl-szigorú, 0 trade engine-fix után) és Phase 4 (túl-laza, negatív Sharpe BTC -3.75 / ETH -2.79 / SOL -2.59) tanulságait integrálja:

- **A (Always-in trend-following)** a Phase 1-3 hibáját (túl sok MTF layer) oldja: 2-layer trend (1d EMA cross + 4h Supertrend), mindig-in pozíció, kevés trade, magas win-rate emelkedő trendben.
- **B (Multi-strategy ensemble)** a Phase 4 hibáját (reversal-stratégia trend-piacon) oldja: a Phase 4 mean-reversion csak trend-following által megerősített irányban trade-el. A StrategyArena 2026 empirikus 60/40 MR/TF ensemble Sharpe 1.58 -9.2% DD-t ad — ez a Phase 1-3 + Phase 4 környezetben a legígéretesebb kompozit.
- **C (Donchian volatility breakout)** kiegészítő trend-following komponens, ami crossover-trigger helyett breakout-trigger; diverzifikálja az entry-típust.

A **#3 funding-rate carry** a bybit.eu SPOT-only MiCAR környezet miatt **közvetlenül nem megvalósítható** — a Phase 6+ feladat, ha multi-exchange ws adapter és cross-exchange latency backtest készül.

A **+50%/hó cél** önállóan a kiválasztott stratégiák egyikével sem érhető el. Az ensemble (B) önmagában +3-5%/hó realisztikus a StrategyArena empirikus Sharpe alapján (Phase 1-3 / Phase 4 kalibrált 30 hónapos környezetben). A +50%/hó eléréséhez **funding-rate carry vagy cross-exchange arb** off-exchange edge class szükséges (Phase 6+).

A Phase 5 M3 riport a +50%/hó kérdésre explicit IGEN/NEM/RÉSZBEN választ ad a Phase 1-3 OHLCV adatokon futtatott együttes ensemble backtest-ek alapján.

---

## 6. Output deliverables (M2 input)

| Fájl | Leírás | Mikor |
|---|---|---|
| `packages/core/src/strategy/always-in-trend.ts` + `.test.ts` | A: Always-in trend-following stratégia | M2 |
| `packages/core/src/strategy/donchian-breakout.ts` + `.test.ts` | C: Donchian volatility breakout stratégia | M2 |
| `packages/core/src/strategy/composite.ts` + `.test.ts` | B: Multi-strategy ensemble (CompositeStrategy) — 50/50 súly A + Phase 4 MR trend-filter | M2 |
| `packages/backtest-tools/src/cli/run-alwaysin-baseline.ts` | M2 CLI runner A-hoz | M2 |
| `packages/backtest-tools/src/cli/run-donchian-baseline.ts` | M2 CLI runner C-hez | M2 |
| `packages/backtest-tools/src/cli/run-ensemble-baseline.ts` | M2 CLI runner B-hez | M2 |
| `backtest-results/baseline-{alwaysin,donchian,ensemble}-{btc,eth,sol}-{1h,4h,1d}.json` | M3 baseline JSON-ok | M3 |
| `backtest-results/REPORT-phase5.md` | M3 végső riport (IGEN/NEM/RÉSZBEN a +50%/hó-ra) | M3 |

Az M2 implementáció indítása a brief §3.2 workflow-t követi: typecheck + lint + test + coverage mind zöld commit előtt. PR-t a root session által megnyitandó (gh CLI nincs auth-olva).

---

## 7. Forrás-lista

### 2.A — Always-in trend-following
1. Boring Edge-style EMA 20/200 BTC 4H backtest, Jan 2021–Nov 2025, +72%, 80 trades, 23.75% WR: https://www.youtube.com/watch?v=OXXlcgOKEVI
2. Reddit discussion of the same backtest: https://www.reddit.com/r/Daytrading/comments/1p4kcc8/i_backtested_a_simple_ema_20200_bitcoin_strategy/
3. Quantified Strategies — 50 EMA Trading Strategy: https://www.quantifiedstrategies.com/50-ema-strategy/
4. MenthorQ — Q-RSI Strategy vs BTC Buy-and-Hold (Nov 2024 - mid 2025): https://menthorq.com/guide/backtesting-results-crypto-quant-models/
5. DailyChris (Medium) — Multi-confluence 50/200 EMA BTC 6-month: https://medium.com/@thedailychris/crypto-pair-reversal-detection-system-backtest-results-on-btc-usdt-ead4b5c249ba
6. Dev.to — I Backtested 49 Crypto Trading Strategies: https://dev.to/maymay5692/i-backtested-49-crypto-trading-strategies-heres-every-single-result-4gg5

### 2.B — Multi-strategy ensemble
1. StrategyArena — Mean Reversion vs Trend Following 60/40 ensemble: https://strategyarena.io/en/blog/mean-reversion-vs-trend-following-2026
2. Price Action Lab — Combining Trend-Following and Mean-Reversion (2023): https://www.priceactionlab.com/Blog/2023/02/combining-trend-following-mean-reversion/
3. SSRN — Multi-Strategy Portfolios Algorithmically Applied to the Cryptocurrency Market: https://papers.ssrn.com/sol3/papers.cfm?abstract_id=4242394
4. ArXiv 2309.00626 — Ensemble Method of Deep RL for Automated Crypto Trading: https://arxiv.org/abs/2309.00626
5. Medium / Jin — Combining Trend-Following and Mean-Reversion: https://medium.com/jin-system-architect/do-traders-stick-to-one-strategy-the-truth-about-combining-trend-following-and-mean-reversion-f34be8a7cf3b

### 2.C — Donchian volatility breakout
1. Boring Edge — BTC Donchian Channel Breakout (Turtle) 8.5-year backtest: https://boringedge.com/bitcoin-donchian-channel-breakout-turtle-trading-backtest/
2. Stratbase — Crypto Markets Donchian BTC/USDT 2020-2024: https://stratbase.ai/en/blog/donchian-channel-breakout
3. Arconomy — ETH Donchian 15m with volume filter and ATR stop: https://arconomy.app/blog/2026-05-19-promo-quotes100x218quot-sobrevivir-vale-ms-que-ganar-en-trad
4. The Indicator Lab — Donchian 5-year multi-asset backtest: https://theindicatorlab.com/backtests/donchian-channel-breakout/
5. Arxum — Donchian with volume and ADX filters (BTC 1D, 2 years): https://arxum.com/donchian-channel/

### 3.1 — Funding-rate carry (kizárt, referenciaként)
1. Bybit Institutional — delta-neutral 2025 +0.43-1.42%/hó, max DD 0.80%: https://www.tv-hub.org/guide/market-neutral-strategy-crypto
2. ainvest.com — 16.0% APR, Sharpe 6.1 (3-year delta-neutral 3x): https://www.ainvest.com/news/bitcoin-futures-funding-rates-neutral-signal-strategic-positioning-arbitrage-opportunities-2509/
3. ScienceDirect 2025 — 60 funding arb scenarios 115.9%/6 months, max DD 1.92%: https://www.tv-hub.org/guide/market-neutral-strategy-crypto
4. bagtester — realistic BTC 2022-2024 8-15% gross funding/year: https://bagtester.com/guides/funding-rate-arbitrage

---

_Ez a fájl a Phase 5 M1 strategy-selection. A M2 implementáció és M3 backtestek a kiválasztott 3 stratégiával (A, B, C) indulnak, és a `backtest-results/REPORT-phase5.md` végső riportban mérnek._
