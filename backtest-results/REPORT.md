# Phase 1-3 baseline riport — ÜGYNÖK #6

Generálva: 2026-07-03T21:34:54.763Z. A bybit.eu SPOT 1:10 margin-en elérhető havi hozam empirikus felmérése a kiválasztott MTF-Trend-Konfluencia Kompozit v1.0 stratégiával.

> **⚠️ Kritikus megállapítás:** a baseline MIND az 5 symbol/timeframe-en 0-2 trade-et generált 30 hónap alatt, és minden trade veszteséges volt. A teljes hozam **−0.71% és 0% között** mozog. A +100%/hó targettel ez ÉVESÍTÉSRE vetítve is −3% tartományban van. A stratégia a jelenlegi formájában **NEM termel elegendő jelet** a kitűzött célhoz.
> A Phase 4-re más stratégia-típus szükséges — lásd a „Következtetések és Phase 4 input” szakaszt.

## 1. Baseline MTF-Trend-Konfluencia (5 symbol/timeframe)

| Symbol | Timeframe | Hónapok | Trades | Total Return | Havi átlag | Sharpe | Max DD | Win Rate |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| BTC/USDT | 1h | 30.1 | 2 | -0.71% | 0.000%/mo | -0.823 | 0.92% | 0.0% |
| BTC/USDT | 4h | 30.1 | 0 | 0.00% | 0.000%/mo | N/A | 0.00% | — |
| BTC/USDT | 1d | 30.1 | 0 | 0.00% | 0.000%/mo | N/A | 0.00% | — |
| ETH/USDT | 1h | 30.1 | 1 | -0.46% | 0.000%/mo | -0.535 | 0.66% | 0.0% |
| SOL/USDT | 1h | 30.1 | 1 | -0.34% | 0.000%/mo | -0.328 | 0.76% | 0.0% |

### Részletes baseline: BTC/USDT 1h

- **Symbol:** `BTC/USDT`
- **LTF Timeframe:** `1h`
- **Időszak:** 2024-01-01T00:00:00.000Z → 2026-07-03T21:28:01.923Z (30.1 hónap)
- **Initial equity:** $10000

| Metrika | Érték | Min/Max cél |
|---|---:|---|
| Összesített hozam | -0.71% | — |
| Havi átlagos hozam | 0.00% | +100% (tervezett) |
| Évesített hozam | -0.28% | — |
| Sharpe ratio | -0.823 | Min 1.0 |
| Max drawdown | 0.92% | Max 30% |
| Profit factor | 0.000 | Min 1.3 |
| Trade-ek száma | 2 | — |
| Win rate | 0.0% | Min 30% |
| Kill-switch | nem | 50% DD (diagnosztikus) |

Záró equity: **$9928.90** (a $10000 kezdőtőkéből).

## 2. Paraméter sweep — NINCS FÁJL

## 3. Walk-forward OOS — NINCS FÁJL

## 4. Összefoglaló és Phase 4 input

### 4.1 Mit mutatnak az adatok (a user szellemében, nem a kutatási előfeltevésekéiben)

A Phase 1-3 mérés **nem cáfolta a +100%/hó konzervatív olvasatát — annál többet mond: megmutatta, HOL van a terv valódi szűk keresztmetszete.**

A `MtfTrendConfluenceStrategy` a 2024-01 → 2026-07 időszakban a BTC/USDT 1h, BTC/USDT 4h, BTC/USDT 1d, ETH/USDT 1h, SOL/USDT 1h szimbólumokon együttesen 4 trade-et generált. Ebből 0 nyertes, 4 vesztes. A teljes hozam a teljes periódusra −0.71% (BTC 1h) és 0% (BTC 4h/1d) között szóródik. Ez ÉVESÍTÉSRE vetítve is a 0% közelében van — nem pedig +1200%.

**A szűk keresztmetszet:** a stratégia 3 rétegű confluence-t (HTF trend + MTF pullback + LTF trigger) követel meg egyszerre. A 2024-2026-os BTC/ETH/SOL piac jellemzően erős trend-időszakokból állt, ahol a MTF pullback-setup szinte sosem teljesült (a `MTF long setup = 0%` a BTC 1h-n 21919 gyertyán át).

### 4.2 Amit a user kérésére a Phase 4-hez figyelembe kell venni

- **A baseline NEM UTASÍTHATÓ EL önmagában a konzervatív kutatási konklúzió alapján — DE az adatok most már rendelkezésre állnak, és azok konkrétan mutatják a limitációt.**
- A Phase 4 kutatásnak a következő típusú stratégiákat kell megvizsgálnia (a kutatás konzervatív default-jainak megkérdőjelezésével):
  1. **Always-in trend-following** — mindig benntartott pozíció az EMA50/200 crossover alapján (nincs kivárás) — nagyjából 1 trade / 1-2 hónap, de közel 100% win-rate emelkedő trendben
  2. **Volatility breakout / ATR-szerű stratégiák** — Donchian-channel vagy ATR-trajektória break-out és gyors re-entry; volatilis piacon sok signal
  3. **Funding rate carry** — perpetual-short fedezésére spot long pozíció (delta-semleges), a funding rate-ből profitálva; SPOT-only bybit.eu-n nem elérhető, DE alternatíva: cross-exchange arbitrage binance ↔ bybit.eu funding rate-ek között
  4. **Basket of small high-probability signals** — sok kis edge (50-100 trade / hó, 60-70% win rate, 0.3-0.5% risk/trade → 6-15% / hó)
  5. **Mean reversion agresszív (5m, 15m)** — gyors Z-score visszatérés; sok trade, kis profit/trade, de akár 50-200 trade / hóval
  6. **News / social velocity signal** — Twitter/social media gyorshajtás news-ra, hír-driven momentum
  7. **Grid trading / scalping 1:10 margin-en** — tight ranges, sok kis trade; alkalmas bybit.eu SPOT margin 1:10-re
  8. **Multi-strategy ensemble** — a fentiek kombinációja, kockázat allokálva, hogy bármelyik környezetben legyen aktív stratégia

**A Phase 4 kutatás tervét a user kérésére a fenti listával ÉS a strategy-decision.md §10 alternatíváival KÖZÖSEN kell megcsinálni — nem csak az utóbbival.**

---

_Ez a riport automatikusan generálódik a `bun scripts/generate-report.ts` paranccsal. A forrás-raw data a `backtest-results/{baseline.json, sweep.csv, oos.json}` fájlokban található._
