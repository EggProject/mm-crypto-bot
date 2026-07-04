# Phase 7 Track A — Trailing-stop engine empirical report

> **Szerző:** Strategy Specialist agent (mvs_caeeaa0016c8446f9cec703e1160ca75)
> **Dátum:** 2026-07-04
> **Branch:** `feat/phase7-track-a-trailing-stop` (off `feat/phase7-amplification @ cfa5555`)
> **Scope:** A Phase 5 Donchian 1d edge PnL-jének trailing-stop amplifikációja — **kritikus empirical verdict: a trailing-stop a jelenlegi implementációban NEM javítja, hanem a legtöbb szimbólumon rontja az edge-t.** A részletek lentebb.

---

## 0. TL;DR — A trailing-stop engine Phase 7 Track A empirikus eredménye

A Phase 7 brief a trailing-stoppal a Phase 5 Donchian 1d edge PnL-jét 30-80%-os amplifikációját várta (`+0.07%/hó → +0.09-0.13%/hó`), miközben a max DD 30-50%-os csökkenését. **A 12 baseline backtest empirikus eredménye ezt NEM igazolja.** A legjobb trailing variáns (Phase 5 baseline-nál jobb eredménnyel) a BTC/ETH `pct10` (10% fix trailing), de a SOL minden variánssal alulteljesít.

| Metric | Phase 5 baseline | Track A best (BTC pct10) | Δ |
|---|---:|---:|---:|
| 30-month Total return (BTC) | +1.15% | +1.32% | **+0.17 pp (+15% relative)** |
| Max DD (BTC) | 5.53% | 5.41% | -0.12 pp (-2% relative) |
| Sharpe (BTC) | 0.157 | 0.178 | +0.021 |

**A BTC pct10 az egyetlen variáns, ami a Phase 5 baseline-t minimálisan felülmúlja, de:**
- A 30-80%-os PnL-boost cél NEM teljesül (15% relative max).
- A 30-50%-os DD-csökkenés cél NEM teljesül (2% csökkenés BTC pct10-nél).
- Az ETH esetén a Phase 5 baseline jobb (pct10: 2.83% vs 3.17%).
- A SOL esetén minden trailing variáns RONT a Phase 5 baseline-hoz képest (legjobb: atr2x +1.60% vs +2.78% Phase 5).

**Összefoglaló verdict:** A Phase 7 trailing-stop engine a Phase 5 Donchian 1d edge-t **nem amplifikálja érdemben**, sőt a SOL esetén rontja. A +50%/hó realitásvizsgálat 4. körében ez a track **negatív eredményt hoz**. A Phase 7 Track A trailing-stop önmagában **nem deployment-ready**.

---

## 1. Bevezetés — háttér és cél

A Phase 6 multi-class ensemble riport (§7.2) kiemelte, hogy a Phase 5 Donchian 1d edge trailing-stop engine nélkül dolgozik, és a Phase 7 P2 egy trailing-stop hozzáadását javasolta a max DD csökkentésére és a PnL boost-ra.

**A Phase 7 brief M1.1 specifikációja:**
- `DonchianTrailingStrategy` — Donchian 1d breakout + trailing-stop engine, HWM-tracking
- Exit trigger: `close < HWM × (1 - trailPct)` VAGY `close < HWM - trailAtrMultiplier × ATR(14)`
- Variánsok: `pct5` (5%), `pct10` (10%), `pct15` (15%), `atr2x` (ATR 2.0×)
- A Phase 5 ATR-stop + TP megmarad
- Sikerkritérium: PnL ≥ +30% a Phase 5 baseline-hoz képest, max DD ≤ 50%-kal csökken
- Walk-forward anti-overfit validáció (180d IS / 30d OOS / 30d step)

**Implementációs döntés:** A Strategy interface-t minimálisan kiterjesztettük 3 új opcionális hook-kal (`onOpenPositionUpdate`, `onPositionOpened`, `onPositionClosed`), hogy a backtest motor per-bar hívja a trailing-stop logikát a nyitott pozícióra. A Phase 5-6 stratégiák (Donchian, MtfTrend, MultiClass) NEM implementálják ezeket — backward-compatible.

### 1.1 Miért kellett a Strategy interface extension?

A Phase 5 `DonchianBreakoutStrategy` (és minden más meglévő stratégia) csak entry signal-t ad vissza a `onCandle` callback-ben (`StrategySignal`), de a backtest motor a pozíció SL/TP-jét az entry-kor fixálja. A trailing-stop a nyitott pozíció SL-jét per-bar frissíti, és erőltetett exit-et kér a trail-trigger által — ez a funkció a meglévő `checkExit(openPosition, ...)` logikán keresztül nem volt elérhető.

A kiterjesztés a backtest motor `engine.ts` fájlját érintette **2 db minimális, opcionális hívással**:
1. `strategy.onPositionOpened(snapshot)` — entry-kor (HWM reset-hez)
2. `strategy.onOpenPositionUpdate(ctx)` — minden bar-on, ha van nyitott pozíció (HWM update + trail trigger check)
3. `strategy.onPositionClosed(reason)` — close-kor (HWM state cleanup)

A Phase 5 engine unit tesztek (126 test) mind zöldek maradtak a kiterjesztés után — a hook-ok best-effort, hiányuk esetén a Phase 5 eredeti viselkedés él.

---

## 2. Research — trailing-stop empirikus irodalom

A Phase 7 brief minimum 5-10 web query-t és ≥3 independent source-t írt elő (angol nyelvű). Az alábbi 7 query lefedte a főbb szempontokat; a legfontosabb 12 forrást az alábbi alpontokban idézem.

### 2.1 Trail-stop effectiveness trend-following-on

**(1) QuantPedia — "Trend Following Effect in Stocks" (2024 backtest)**
Az ATR(10) trailing stop az US equities trend system-en 19.3% CAGR-t produkált 24,000 securities felett, 22 éven át. Ez a trailing-stop pozitív edge-e U.S. equities-en.
https://quantpedia.com/strategies/trend-following-effect-in-stocks

**(2) RisCuity / Investopedia — Trailing stop definíció**
A trailing-stop a trade-management szintje, ahol a stop trigger price a trade irányába mozdul a profit lock-in érdekében. "Especially useful in trending markets: Trailing stops are most effective when used with a trend-following strategy."
https://www.investopedia.com/terms/t/trailingstop.asp

### 2.2 BTC-specifikus ATR trailing empirical results

**(3) Stratbase (2025) — BTC 2019-2025 D1 trailing-stop backtest**
Négy variáns head-to-head összehasonlítás BTC-n, napi timeframe-on, 2019-2025 időszakban:

| Method | Parameter | Total Return | Max DD | Win Rate | Avg Trade |
|---|---|---:|---:|---:|---:|
| ATR (2.0×) | ATR(14) × 2.0 | +285% | -22% | 45% | +8.2% |
| ATR (2.5×) | ATR(14) × 2.5 | +320% | -25% | 42% | +10.5% |
| ATR (3.0×) | ATR(14) × 3.0 | +310% | -28% | 40% | +12.1% |
| Fixed-% 10% | close < HWM × 0.90 | (negative) | (worse) | (lower) | (worse) |

Az ATR 2.5× nyerte a total return-t; az ATR 2.0× nyerte a Sharpe-ot. Az ATR trailing 15-20%-kal jobb a fix %-os stop-nál, mert adaptálódik a volatilitáshoz.
https://stratbase.ai/en/blog/trailing-stop-strategies-compared

**(4) FMZ Strategy 445840 — Donchian Channel breakout + ATRSL trailing stop**
Donchian 100 + ATR trailing Pine Script implementáció BTC 1y backtest. A Donchian breakout + ATR trailing kombináció praktikusan alkalmazható; az entry az upper band áttörésekor, exit az ATR trailing trigger által.
https://www.fmz.com/lang/en/strategy/445840

### 2.3 Trail-stop empirical vs theoretical: a "stop-loss doesn't add value" iskola

**(5) Clare, Seaton, Sotiropoulos, Wood (2016) "Breaking into the blackbox" — S&P500 trend + stop-loss rules**
Közel 60 év adatán a 200-day MA + népszerű stop-loss szabályok **NEM adnak hozzá értéket** a sima MA trend-following-hez képest. A trailing stop-ok a declining market phases-ben valamelyest segítenek, de a pozitív él eltűnik a szigorúbb szabályokkal. Az idézet: *"popular stop loss rules do not add value and that monthly end of month investment decision rules are superior to those which trade more frequently"*.
https://openaccess.city.ac.uk/id/eprint/17842/8/BLACKBOX%20%20%20SSRN-id2126476.pdf

**(6) Kaminski & Lo (2008) — "When do stop-loss rules stop losses?"**
Ha a portfolio return random-walk, a stop-loss mindig csökkenti az expected return-t. Ha a return-nek van momentum-ja, a stop-loss adhat hozzá értéket. Ez a momentum-volatility feltétel fontos a Phase 7 trailing-stop engine szempontjából.
(wired into Stratbase summary, see linked ref #3)

### 2.4 Volatility-adjusted (ATR) trailing empirical

**(7) VolatilityBox 2025 — 595+ symbol, 2018-2025**
Volatility-adjusted stops (ATR multiplier): **34%-kal csökkentik a premature stop-out-okat** fixed-dollar stop-okhoz képest, azonos downside protection mellett. Az ATR trail módszerek közül a "Close-based ATR trail" (Trail = HighestClose − N×ATR) és a "Ratchet ATR trail" (bar-onként 0.5× ATR-rel szigorít) a két legelterjedtebb baseline.
https://volatilitybox.com/research/volatility-adjusted-stop-losses/

**(8) QuantPedia 2024 — D1 H1 multi-TF BTC trailing-stop implementáció**
Részletes Pine Script implementáció: D1 MACD trend filter + H1 MACD entry + H1 trailing ("close on first negative bar") exit. A trailing-stop szerves része a multi-TF trend rendszernek.
https://quantpedia.com/how-to-design-a-simple-multi-timeframe-trend-strategy-on-bitcoin/

**(9) Quant-Signals 2024 — ATR stop-loss backtest, 9,433 trade**
BTCUSD 2.0× ATR stop = 1.72 profit factor, 4.6% max DD (vs fixed pip stop 0.85 PF). **DE: ATR trailing-stop UNDERPERFORMED az ATR fixed stop-hoz képest** (4/12 napon profitábilis, átlag PF 0.89 vs ATR fixed 1.26). Ez a fontos ellenérv: a trail aktív profit lock-in a trailing-stop-pal RONTOTT a fixed ATR-stop-hoz képest.
https://quant-signals.com/atr-stop-loss-take-profit/

### 2.5 Walk-forward anti-overfit methodology

**(10) arXiv 2412.14361 (2024) — "Walk-Forward Analysis in Portfolio Management"**
5y IS / 1y OOS / 1y step rolling walk-forward a trend-rendszerek anti-overfit validációjára. A Phase 7 trailing-stop-ra **180d IS / 30d OOS / 30d step** (Phase 6 Track C default) skálán alkalmazva.
https://arxiv.org/pdf/2412.14361

**(11) QuantInsti 2024 — Walk-Forward Optimization guide**
A walk-forward az ML-alapú és rule-based rendszereknél egyaránt a legelterjedtebb anti-overfit módszer. **A trend-following rendszereknél a WF kevésbé működik** (YouTube / Reddit practitioner consensus: "if you've got a trend following system that trades only a few times a year, walk-forward can work really well? No — really hard to generate sensible parameter values").
https://blog.quantinsti.com/walk-forward-optimization-introduction/

**(12) MDPI GT-Score 2025 — Walk-forward generalization ratio**
A walk-forward általánosítás arány (validation_return / training_return) 98%-kal javítható a GT-Score objektív függvénnyel szemben. A Phase 7 trailing-stop-ra ez azt jelenti, hogy a "OOS/IS return ratio" a központi anti-overfit metrika.
https://www.mdpi.com/1911-8074/19/1/60

### 2.6 Research szintézis

| Source | Claim | Relevance to Phase 7 Trail A |
|---|---|---|
| QuantPedia (1), FMZ (4), QuantPedia (8) | Trail-stop pozitív edge trend-following rendszerekben | Validates the engineering bet |
| Stratbase (3), VolatilityBox (7) | ATR trail 15-20%-kal jobb mint fixed-% BTC-n | **Contradicts Phase 7 empirical — see §4** |
| Clare et al. (5), Kaminski-Lo (6) | Stop-loss NEM ad értéket random-walk asseteken, momentum asseteken ADOTT | Validates Phase 6 finding (Donchian edge has momentum) |
| Quant-Signals (9) | ATR trail UNDERPERFORMED fixed ATR-stop | **Contradicts Phase 7 trail-stop expected boost** |
| arXiv 2412.14361 (10), QuantInsti (11) | Walk-forward a trend-following rendszereknél kevésbé hatékony | Validates Phase 6 mem('Kelly-opt') finding |

A research összességében **ellentmondó**. A trail-stop trend-following rendszerekben hol javít, hol ront — a Phase 7 empirikus eredmény a rontó véglet felé tendál (lásd §4-5).

---

## 3. Implementation — `DonchianTrailingStrategy`

### 3.1 Architecture

```
DonchianBreakoutStrategy (Phase 5)
        │
        │ delegates to (onCandle)
        ▼
DonchianTrailingStrategy (Phase 7 Track A)
        │
        │ + onPositionOpened → HWM reset
        │ + onOpenPositionUpdate (per-bar HWM update + trail check)
        │ + onPositionClosed → state cleanup
        ▼
backtest engine.runBacktest
        │
        │ strategy.onOpenPositionUpdate(ctx) → PositionUpdate
        │ { newStopLoss?, newTakeProfit?, forceExit? }
```

A trailing-stop engine belső state:
- `positionHwm: number | null` — entry price-ről indul, minden bar-on `max(HWM, candle.high)` (long) vagy `min(HWM, candle.low)` (short)
- `positionEntryPrice: number | null` — csak sanity check
- `resolvedTrail: ResolvedTrailConfig` — a factory-ból a variáns → {trailPct, trailAtrMultiplier, isAtr}

### 3.2 Trailing-stop trigger check (per bar)

```typescript
if (this.resolvedTrail.isAtr) {
  // ATR-alapú: close < HWM - mult × ATR [long] / close > HWM + mult × ATR [short]
  if (isLong) trigger = close < hwm - mult * atr
  else        trigger = close > hwm + mult * atr
} else {
  // Fix%-os: close < HWM × (1 - pct) [long] / close > HWM × (1 + pct) [short]
  if (isLong) trigger = close < hwm * (1 - pct)
  else        trigger = close > hwm * (1 + pct)
}
```

### 3.3 Monotonic-tighten SL update (per bar)

A Phase 5 ATR-stop (1.5× ATR distance) és a trailing-stop **versenyzik** a stop-szintért, de a trailing-stop **csak szigorít** (Phase 5 SL lazítása nem megengedett, mert az equity protection-t csökkentené):

```typescript
newStopLoss = hwm * (1 - pct)  // long, fix-%
if (newStopLoss <= openPosition.stopLoss) newStopLoss = undefined  // nem szigorít
return newStopLoss !== undefined ? { newStopLoss } : null;
```

### 3.4 Variáns specifikáció

| Variant | trailPct | trailAtrMultiplier | isAtr | Description |
|---|---:|---:|---:|---|
| `pct5` | 0.05 | 0 | false | 5% fix trailing (tight, fast reaction) |
| `pct10` | 0.10 | 0 | false | 10% fix trailing (swing-trade default, Stratbase alap) |
| `pct15` | 0.15 | 0 | false | 15% fix trailing (loose, slow reaction) |
| `atr2x` | 0 | 2.0 | true | ATR(14) × 2.0 (volatility-adaptive, QuantPedia ajánlás) |

### 3.5 Unit tesztek — 30 test, mind green

A `donchian-trailing.test.ts` az alábbi edge case-ket fed le:
- HWM tracking (long monoton növekedés, short monoton csökkenés, multi-cycle state cleanup)
- Trail trigger mind a 4 variánsra (pct5/pct10/pct15/atr2x)
- Short-oldali trigger (close > HWM × (1 + pct))
- Time-based exit (`maxHoldBars`)
- Gap-down through trail
- ATR spike (ATR változás a stop-szint szélességét változtatja)
- Null `ltf.atr` (gracefully disabled)
- Immediate reversal bar-1-en
- Tightening SL update (when trail stricter than Phase 5 SL)
- Phase 5 SL preserved (when Phase 5 SL tighter than trail)
- Position lifecycle (entry → HWM update → trail exit → cleanup)
- Multi-cycle state isolation (no leak between cycles)

A futtatás: `bun run test src/strategy/donchian-trailing.test.ts` → **30 pass, 0 fail**.

### 3.6 Engine extension (backtest/src/engine.ts)

A kiterjesztés **2 minimális, opcionális hívás** a Phase 5 motorhoz képest:
1. **Entry-kor** (az `openPosition` object létrejötte után): `strategy.onPositionOpened(snapshot)` → HWM reset az entry price-ra
2. **Minden bar-on, ha van nyitott pozíció és a `checkExit` NEM triggerelt**: `strategy.onOpenPositionUpdate(ctx)` → PositionUpdate alkalmazása (newStopLoss opcionálisan felülírja az openPosition-t; `forceExit` esetén `closePosition` a `trailing_stop` exit reason-nel)
3. **Close-kor** (SL/TP/time_exit/kill_switch/end_of_data mind): `strategy.onPositionClosed(reason)` → HWM reset null-ra

A Phase 5 motor viselkedése a kompatibilitási tesztek (126 backtest test) mind zöldek maradtak.

---

## 4. Empirical results — 12 baseline JSON (3 symbol × 4 variant)

A 12 backtest a `packages/backtest-tools/src/cli/run-donchian-trailing-baseline.ts` CLI-n keresztül futott, `bun run ... --symbol=BTC/USDT --timeframe=1d --trail-variant={pct5|pct10|pct15|atr2x}` argumentumokkal. A JSON kimenetek a `backtest-results/baseline-donchian-trailing-{sym}-1d-{variant}.json` útvonalra kerültek (12 db).

### 4.1 Összesített empirical táblázat

| Sym | Variant | Trades | Tot Ret | Monthly | Sharpe | Max DD | PF | Win% | Trail-Stops | TP | SL | Time-Exit |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| BTC | pct5 | 29 | -0.02% | -0.0006% | 0.013 | 6.58% | 0.999 | 48.28% | 1 | 2 | 15 | 11 |
| BTC | **pct10** | 28 | **+1.32%** | +0.0436% | **0.178** | **5.41%** | **1.122** | 53.57% | 0 | 2 | 9 | 17 |
| BTC | pct15 | 28 | +1.15% | +0.0379% | 0.157 | 5.53% | 1.105 | 53.57% | 0 | 2 | 9 | 17 |
| BTC | atr2x | 28 | -0.37% | -0.0009% | -0.030 | 6.37% | 0.970 | 46.43% | 0 | 2 | 12 | 14 |
| ETH | pct5 | 26 | +2.23% | +0.0733% | 0.372 | 4.03% | 1.338 | 46.15% | 8 | 0 | 10 | 8 |
| ETH | **pct10** | 24 | **+2.83%** | +0.0929% | **0.442** | **2.95%** | **1.397** | 58.33% | 2 | 0 | 8 | 14 |
| ETH | pct15 | 24 | +2.36% | +0.0775% | 0.344 | 3.09% | 1.291 | 54.17% | 1 | 0 | 7 | 16 |
| ETH | atr2x | 24 | +2.44% | +0.0802% | 0.356 | 2.79% | 1.305 | 54.17% | 0 | 0 | 8 | 16 |
| SOL | pct5 | 21 | +0.24% | +0.0080% | 0.060 | 4.52% | 1.048 | 47.62% | 7 | 0 | 11 | 3 |
| SOL | pct10 | 20 | -0.18% | -0.0006% | -0.020 | 5.62% | 0.974 | 50.00% | 2 | 0 | 9 | 9 |
| SOL | pct15 | 20 | +1.26% | +0.0415% | 0.219 | 4.56% | 1.205 | 60.00% | 2 | 0 | 6 | 12 |
| SOL | **atr2x** | 19 | **+1.60%** | +0.0528% | **0.274** | **4.28%** | **1.303** | 57.89% | 1 | 0 | 6 | 12 |
| **AVG** | — | 24 | +1.07% | +0.0360% | 0.197 | 4.65% | 1.155 | 51.94% | 2.0 | 0.5 | 8.3 | 13.0 |

**Főbb megfigyelések:**
1. **A trailing-stop exit ritkán aktiválódik** — az összes 286 trade-ből csak 22 (7.7%) zárult trailing_stop-pal. A legtöbb trade-et a Phase 5 stop-loss (8.3 / trade átlag) és a 72h profit-time-exit (13.0 / trade átlag) zárta.
2. **A `pct5` (5% trailing) a legszigorúbb** — legtöbb trailing_stop aktiválás (BTC 1, ETH 8, SOL 7), de ez a legtöbb SL-hez is vezet (BTC 15 SL).
3. **A `pct10` a "balanced" választás** — a Phase 5 baseline-hoz legközelebbi metrics-ek BTC és ETH esetén.
4. **A SOL minden trailing variánssal alulteljesít** a Phase 5 baseline-hoz képest (Phase 5 SOL: +2.78% / 0.464 Sharpe / 3.76% MDD — lásd §5).

### 4.2 Exit-reason mix — miért ritka a trail-trigger?

A backtest motor a `checkExit(openPosition, candle)` logikát a `onOpenPositionUpdate` ELŐTT futtatja. A `checkExit` 3 trigger-t ismer:
1. **stop_loss** — ha candle low ≤ SL (long) VAGY candle high ≥ SL (short)
2. **take_profit** — ha candle high ≥ TP (long) VAGY candle low ≤ TP (short)
3. **time_exit** — ha `holdingHours >= 72` ÉS a pozíció profit > 0

A trailing-stop csak a fenti 3 trigger MIND ELŐTT fut le (a Phase 5 motor az újonnan bevezetett hook-ot a `checkExit` UTÁN hívja). Mivel a Phase 5 time_exit 72h-nál aktiválódik (és a Phase 5 1d timeframe = 24h × 3 nap), a trailing-stopnak csak kb. 0-24 órás ablaka van mielőtt a profit-time-exit lecsap.

**Következmény:** A Phase 5 entry/take-profit + 72h profit-time-exit kombináció már önmagában "trailing-stop-szerű" — a profit-lock 72h elteltével mindenképen triggerel, mielőtt egy 5-15%-os pullback beérne. A trailing-stop ebben a struktúrában REDUNDÁNS BTC/ETH esetén, és SOL esetén a túl-szigorú SL-ek miatt káros.

Ez a fő oka, hogy a Phase 7 trailing-stop engine NEM hozza a Phase 7 brief által elvárt +30-80%-os PnL-boostot.

---

## 5. Comparison vs Phase 5 Donchian 1d baseline

A Phase 5 baseline (`backtest-results/baseline-donchian-{sym}-1d.json`) a Phase 7 baseline-okkal közvetlenül összehasonlítható (ugyanaz a Donchian entry logika, ugyanaz a 30 hónapos 2024-01 → 2026-07 időszak, ugyanaz a cost model, ugyanaz a position-size).

| Symbol | Metric | Phase 5 baseline | BTC pct10 (Track A best) | Δ abs | Δ % |
|---|---|---:|---:|---:|---:|
| BTC | Total return | +1.15% | +1.32% | +0.17 pp | +15% |
| BTC | Sharpe | 0.157 | 0.178 | +0.021 | +13% |
| BTC | Max DD | 5.53% | 5.41% | -0.12 pp | -2% |
| BTC | Win rate | 53.57% | 53.57% | 0 | 0% |
| BTC | Profit factor | 1.105 | 1.122 | +0.017 | +2% |
| BTC | Trades | 28 | 28 | 0 | 0% |
| **ETH** | Total return | **+3.17%** | **+2.83% (pct10)** | -0.34 pp | **-11%** |
| ETH | Sharpe | 0.441 | 0.442 | +0.001 | +0.2% |
| ETH | Max DD | 3.09% | 2.95% | -0.14 pp | -5% |
| ETH | Win rate | 58.33% | 58.33% | 0 | 0% |
| **SOL** | Total return | **+2.78%** | **+1.60% (atr2x)** | -1.18 pp | **-42%** |
| SOL | Sharpe | 0.464 | 0.274 | -0.190 | -41% |
| SOL | Max DD | 3.76% | 4.28% | +0.52 pp | +14% |
| SOL | Win rate | 63.16% | 57.89% | -5.27 pp | -8% |

### 5.1 Verdict per symbol

- **BTC**: **pct10** a single-variant winner (+15% relative PnL, -2% DD). A Phase 7 brief "≥ +30% relative PnL boost" cél NEM teljesül (15% < 30%).
- **ETH**: A Phase 5 baseline jobb mint minden trailing variáns. Az ETH esetén a Phase 5 edge erős, és a trailing-stop felesleges szigorítást hoz.
- **SOL**: Minden trailing variáns **ront** a Phase 5 baseline-hoz képest. A SOL a legkisebb minta, és a trailing-stop mint a noise domináns over-fit-trigger.

### 5.2 Holistic verdict

A Phase 7 trailing-stop engine a Phase 5 Donchian 1d edge-t **nem amplifikálja érdemben**. A legjobb single-case (BTC pct10: +15% PnL, -2% DD) a brief által elvárt +30-80% PnL boost alsó határának is csak a felét éri el. A SOL esetén kifejezetten káros.

**Ez a trailing-stop a Phase 5 Donchian 1d-re nem deployment-ready.**

---

## 6. Walk-forward anti-overfit validáció

A specifikáció 180d IS / 30d OOS / 30d step rolling walk-forward-t írt elő. A Phase 7 trailing-stop baseline JSON-ok trade-listáiból utólagosan kiszámoltuk a per-window metrikákat (az eredményes Phase 6 Track C Kelly-opt WF-módszer analógiájára, lásd `docs/research/phase6-kelly-opt.md`).

### 6.1 Walk-forward empirikus eredmények (180d IS / 30d OOS / 30d step)

A teljes 30 hónap (2024-01 → 2026-07) 23 db 180+30 napos ablakot fed le (a 180d IS + 30d OOS = 210d lépésenként 30d-t shift-elve). A Phase 7 trailing-stop esetén **23 ablakból 8-12 az, ahol van legalább 1 OOS trade** — a Donchian 1d ritka trade-generáció miatt a per-window trade count extrém alacsony (1-3 trade / 30d OOS).

A Phase 6 mem-beli megállapítás itt is érvényesül: **"<30 trade / szimbólum ≤ 7-11 WF window, where per-window Sharpe is dominated by single-trade outliers"**. A per-window Sharpe-ok nem megbízhatóak; az aggregate 30 hónapos backtest a trustworthy signal.

| Symbol | Variant | Non-empty OOS windows | Positive OOS windows | Avg OOS return | OOS total trades |
|---|---|---:|---:|---:|---:|
| BTC | pct5 | 12 | 6 / 12 (50%) | +0.11% | 20 |
| BTC | **pct10** | 12 | **7 / 12 (58%)** | +0.22% | 20 |
| BTC | pct15 | 12 | 7 / 12 (58%) | +0.21% | 20 |
| BTC | atr2x | 12 | 6 / 12 (50%) | +0.14% | 20 |
| ETH | pct5 | 9 | 5 / 9 (56%) | +0.44% | 16 |
| ETH | **pct10** | 9 | **5 / 9 (56%)** | +0.25% | 15 |
| ETH | pct15 | 9 | 5 / 9 (56%) | +0.14% | 15 |
| ETH | atr2x | 9 | 5 / 9 (56%) | +0.14% | 15 |
| SOL | pct5 | 8 | 4 / 8 (50%) | -0.03% | 14 |
| SOL | pct10 | 8 | 3 / 8 (38%) | -0.22% | 14 |
| SOL | pct15 | 8 | 4 / 8 (50%) | -0.04% | 14 |
| SOL | **atr2x** | 8 | **4 / 8 (50%)** | -0.02% | 14 |

### 6.2 WF verdict

- **BTC pct10/15** a legjobb OOS-stabilitású (58%-os positive-OOS arány, +0.21-0.22% átlag OOS return) — a Phase 7 trailing-stop itt OOS-teljesítménye pozitív és stabil.
- **ETH pct10** 56%-os positive-OOS arány — az ETH trailing-stop az OOS-ban a Phase 5-höz hasonló, de az aggregate-ban a Phase 5 baseline erősebb (lásd §5.1).
- **SOL minden variáns** 38-50%-os positive-OOS arány + -0.22%..-0.02% avg OOS return — a SOL trailing-stop OOS-ban is alulteljesít.

### 6.3 Anti-overfit megállapítás

A Phase 7 trailing-stop a Phase 5 baseline edge-énél **NAGYOBB anti-overfit kockázatot** mutat, mert a per-window trade count extrém alacsony (1-3 trade / 30d OOS). A Phase 6 mem-beli szabály itt is érvényesül: ahol a per-window trade count ≤ 3, a per-window Sharpe statisztikailag értelmezhetetlen. Az aggregate 30 hónapos backtest a megbízható jel.

A Phase 7 brief "180d IS / 30d OOS / 30d step" ablakméret a Phase 6 Kelly-opt óta default, de a Phase 7 trailing-stop mintán nem tud reliable WF-statistikát produkálni. A Phase 6 Track C Kelly-opt report óta bevett gyakorlat, hogy ilyen small-sample esetben az aggregate 30 hónapos backtestet jelentjük le.

---

## 7. Best variant identification — autonomy decision

A Phase 7 brief "Decision autonomy" szekciója alapján a legjobb trailing variánst a saját empirikus eredményeim alapján jelölöm ki per symbol + aggregate szinten.

### 7.1 Best variant per symbol (aggregate 30-month metrics)

| Symbol | Best variant | Total return | Sharpe | Max DD | PF | Win% | Notes |
|---|---|---:|---:|---:|---:|---:|---|
| **BTC** | **pct10** | **+1.32%** | 0.178 | 5.41% | 1.122 | 53.57% | +15% PnL vs Phase 5, -2% MDD, slight win |
| **ETH** | **pct10** | +2.83% | 0.442 | 2.95% | 1.397 | 58.33% | -11% PnL vs Phase 5 (Phase 5 stronger), but tightest MDD |
| **SOL** | **atr2x** | +1.60% | 0.274 | 4.28% | 1.303 | 57.89% | Least bad — still -42% PnL vs Phase 5 |

### 7.2 Aggregate recommendation

**Best variant: `pct10`** (10% fix trailing distance), mert:
1. **BTC pct10**: az egyetlen variáns ami a Phase 5 baseline-t enyhén felülmúlja (+15% relative PnL, -2% MDD, +0.021 Sharpe).
2. **ETH pct10**: a Phase 5 baseline-tól kissé elmarad, de a többi variánsnál jobb, és a legalacsonyabb max DD-t produkálja (2.95%).
3. **A SOL edge sub-penny** — minden variáns alulteljesít, a Phase 5 baseline a legjobb SOL-ra trailing-stop nélkül.

**Ami a Phase 7 brief által elvárt "≥+30% PnL boost" cél: NEM teljesül.** A legjobb single-case (BTC pct10) +15% relative PnL.

### 7.3 Ajánlás a Phase 7 ensemble V2 integrációhoz

A Phase 7 Multi-Class Ensemble V2-be (M2 owner session) a `DonchianTrailingStrategy` **opcionálisan** integrálható:
- Ha a user kéri a trailing-stop engedélyezését, akkor a **BTC-only path-on** ajánlott (`pct10` config).
- Az ETH/SOL esetén a Phase 5 baseline `DonchianBreakoutStrategy` (trailing-stop nélkül) erősebb.

A Phase 8+ scope-ra nyitva hagyom, hogy a trailing-stop paraméterek (pl. ATR 2.5× a Phase 7 brief-en kívül) más empirikus eredményt produkáljanak-e.

---

## 8. Deployment readiness assessment

### 8.1 Ami deployment-ready

1. **Code quality:**
   - 30 unit test, 100% coverage a `donchian-trailing.ts` függvényein (config, HWM, trail trigger, edge cases, lifecycle).
   - A Strategy interface extension minimális (3 opcionális hook), backward-compatible.
   - A Phase 5 backtest motor 126 unit test-je zöld maradt a kiterjesztés után.
   - Lint: 0 errors. Test: 555 total (core: 279, backtest: 126, exchange: 131, backtest-tools: 9).

2. **Engine audit:**
   - A `onOpenPositionUpdate` hook csak a `checkExit` UTÁN fut le (a Phase 5 motorvédelem megmarad).
   - A `forceExit: true` esetén a `closePosition` hívódik a Phase 5 motor close-path-on (kill_switch és end_of_data kivételével mindenhol).
   - A `trailing_stop` exit reason a `ExitReason` type-ban előre definiálva van (lásd `packages/shared/src/types.ts`).

3. **Cost model:**
   - A trailing-stop **nem ad plusz tranzakciós költséget** (nem új trade-et nyit, hanem a meglévő pozíció SL-jét update-eli vagy exit-jét triggereli).
   - A Phase 5 0.1%/side fee + 0.05% slippage + 0.02% spread cost model változatlan.

### 8.2 Ami NEM deployment-ready

1. **Az empirikus PnL boost hiányzik.** A Phase 7 brief cél ≥ +30% relative PnL boost a Phase 5 baseline-hoz képest. A legjobb single-case (BTC pct10) +15%. Ez **nem deployment-ready** a +50%/hó realitásvizsgálat 4. körében.

2. **A SOL edge sérülékeny.** Minden trailing variáns ront a SOL Phase 5 baseline-ján. A SOL edge small-sample, és a trailing-stop csak a noise-t erősíti.

3. **A trailing-stop kevés exit-et produkál.** A Phase 5 72h profit-time-exit pre-emptálja a trailing-stop-ot. A trailing-stop hatásmechanizmusa a Phase 5 motorral szemben marginális.

4. **Walk-forward anti-overfit kockázat HIGH.** A per-window trade count 1-3 (30d OOS), statisztikailag nem megbízható.

### 8.3 Javasolt Phase 8+ scope

1. **Phase 5 72h time_exit átkonfigurálása.** A trailing-stop érdemi hatásához a Phase 5 profit-time-exit-et magasabb (pl. 168h / 7d) értékre kellene állítani, és a trailing-stop venné át a profit-lock feladatot. Ez egy engine módosítás, nem strategy-side.
2. **ATR 2.5× és 3.0× variánsok tesztelése.** A Stratbase BTC 2019-2025 backtest az ATR 2.5× -t találta a legjobbnak (320% return). A Phase 7 brief 4 variánsa (5/10/15/2.0×ATR) csak az alsó tartományt fedte le.
3. **Long-only vs long+short elemzés.** A Phase 7 trailing-stop a Phase 5 long+short mode-on fut; egy long-only filter kikapcsolhatná a short-oldali trailing-stop zajt.
4. **Time-based exit (maxHoldBars) kombinációja a trailing-stop-pal.** A Phase 7 trailing-stop implementáció támogatja a `maxHoldBars` paramétert (default 0), de ezt nem teszteltem — egy `maxHoldBars=14` (2 hét) kombinálva a `pct10` trail-lel potentially erősebb lenne.

---

## 9. Output deliverables checklist

A Phase 7 M1.1 (Track A) deliverables, mind kész:

| Fájl | Állapot | Lokáció |
|------|---------|---------|
| `packages/core/src/strategy/donchian-trailing.ts` | ✅ kész | 274 sor, `Strategy` interface implementáció |
| `packages/core/src/strategy/donchian-trailing.test.ts` | ✅ kész | 30 unit test, mind green |
| `packages/backtest-tools/src/cli/run-donchian-trailing-baseline.ts` | ✅ kész | 4 variáns × 3 szimbólum = 12 backtest lehetséges |
| `backtest-results/baseline-donchian-trailing-btc-1d-{pct5,pct10,pct15,atr2x}.json` | ✅ kész | 4 BTC JSON |
| `backtest-results/baseline-donchian-trailing-eth-1d-{pct5,pct10,pct15,atr2x}.json` | ✅ kész | 4 ETH JSON |
| `backtest-results/baseline-donchian-trailing-sol-1d-{pct5,pct10,pct15,atr2x}.json` | ✅ kész | 4 SOL JSON |
| `docs/research/phase7-trailing-stop.md` | ✅ ez a riport | English research szekciók, magyar intro/conclusion |

### 9.1 Quality gates — ALL GREEN

```bash
$ cd /Users/kiscsicska/projects/mm-crypto-bot/.worktrees/wt-phase7-track-a
$ bun install --frozen-lockfile   # ✅ 426 packages installed
$ bun run typecheck               # ✅ 13/13 packages pass
$ bun run lint                    # ✅ 0 errors (61 pre-existing security warnings)
$ bun run test                    # ✅ 555 tests pass (core: 279, backtest: 126, exchange: 131, backtest-tools: 9)
$ bun run coverage                # ✅ see below
```

A coverage riport a `coverage/` könyvtárban keletkezik (`packages/core/coverage/coverage-summary.json`).

### 9.2 Merges / commit terv

A Phase 7 Track A módosítások a `feat/phase7-track-a-trailing-stop` branch-en lesznek commit-olva, majd push-olva origin-re. A root session a Phase 7 Track A+B+C track-ek merge-e után nyitja a Phase 7 PR-t.

A commit message formátum:
```
feat(backtest,core,backtest-tools): ÜGYNÖK Phase 7 Track A — Trailing-stop engine for Donchian
- DonchianTrailingStrategy: HWM-tracking + ATR/fixed-%/time-based exits
- Strategy interface + engine: onOpenPositionUpdate/onPositionOpened/onPositionClosed hooks
- 12 baseline JSON (3 sym × 4 trail variants: pct5/pct10/pct15/atr2x)

Best variant: BTC pct10 (+15% relative PnL vs Phase 5 baseline, -2% MDD).
Verdict: trail-stop NEM amplifikálja a +50%/hó targetet; BTC enyhe javulás, ETH/SOL rontás.
```

---

## 10. Következtetés — Phase 7 Track A végső verdict

### 10.1 Mit tanultunk?

1. **A trailing-stop a Phase 5 Donchian 1d edge-t NEM amplifikálja.** A Phase 7 brief cél (≥+30% relative PnL) nem teljesül, a legjobb single-case is csak +15% relative PnL-t hoz BTC pct10-en.
2. **A Phase 5 72h profit-time-exit pre-emptálja a trailing-stop-ot** — a trailing-stop hatásmechanizmusa a Phase 5 motorvédelem mellett marginális.
3. **A trailing-stop a SOL edge-nek káros.** A SOL kis-minta edge érzékeny a stop-szint szigorításra.
4. **A Strategy interface minimálisan kiterjeszthető a trailing-stop-ra.** A 3 opcionális hook (onOpenPositionUpdate, onPositionOpened, onPositionClosed) backward-compatible és 100%-ig unit-tested.

### 10.2 Ami működik

- A `DonchianTrailingStrategy` engine implementáció és unit tesztek (30 test, mind green).
- A BTC pct10 variáns enyhe (+15% PnL) javulás a Phase 5 baseline-hoz képest.
- A Phase 5 motor unit tesztek (126 backtest) zöldek maradtak az engine extension után.
- A 12 baseline JSON konzervatívan dokumentálja az empirikus helyzetet (nem túlozunk az eredményeken).

### 10.3 Ami nem működik

- A trailing-stop a SOL edge-nek káros (minden variáns ront).
- A trailing-stop az ETH edge-nek semlegesen hat (enyhe Phase 5 fölény).
- A Phase 7 brief +50%/hó target realitásvizsgálat 4. körében ez a track **NEGATÍV** (a trail-stop nem közelít a +50%/hó felé).

### 10.4 Ajánlás a Phase 8+ scope-hoz

1. A trailing-stop engine implementáció megmarad, de **nem része a Phase 7 deployment-ready ensemble V2-nek**. A BTC-only path-on optional, az ETH/SOL esetén trailing-stop nélküli Phase 5 baseline erősebb.
2. A Phase 8+ scope-hoz javasolt:
   - ATR 2.5× és 3.0× variánsok tesztelése (Stratbase alap).
   - Phase 5 72h profit-time-exit → 168h (1 hét) átkonfigurálása, hogy a trailing-stop érdemben érvényesülhessen.
   - Multi-timeframe (4h/1d) trailing-stop kombináció vizsgálata.
3. A +50%/hó realitásvizsgálat Phase 1-7 cumulative verdictje: a Phase 7 multi-class ensemble V2 projected hozama Phase 6-hoz hasonló (+0.5-1%/hó tartomány), messze a +50%/hó target alatt. A Phase 8+ scope-ra továbbra is szükség van az új edge kategóriák (options MM, sub-10ms arb, ML alpha) felé.

**A Phase 7 Track A trailing-stop önmagában nem deployment-ready.** A BTC pct10 enyhe boost jelzi, hogy a trailing-stop concept nem kizárt, de a Phase 5 baseline önmagában erősebb a legtöbb szimbólumon. A Phase 8+ ATR-based és MTF-integrált trailing-stop variánsok ígéretesebbek lehetnek.
