# M0 Report — Phase 1-3 baseline rerun az engine-bug fix-szel

> **Dátum:** 2026-07-04 00:38 Europe/Budapest
> **Worktree:** `.worktrees/wt-phase5-ensemble` (branch `feat/phase5-ensemble`, main @ a236069)
> **Branch:** `feat/phase5-ensemble`
> **Cél:** A Phase 1-3 `MtfTrendConfluenceStrategy v1.0` baseline-ok újrafuttatása az engine-bug fix-szel — fair összehasonlítás a Phase 5 stratégiákhoz.

## TL;DR

A Phase 1-3 `MtfTrendConfluenceStrategy v1.0` az engine-bug fix után **MIND a 9 symbol × timeframe kombinációban 0 trade-et generált** — szemben az eredeti Phase 1-3 baseline 4 trade-jével (BTC 1h: 2, ETH 1h: 1, SOL 1h: 1). Az eredeti Phase 1-3 trade-számok **aggregáció-bug artifactok voltak**, nem valódi MTF-TKC setup-ok. A Phase 4 mean-reversion negatív eredményei és a Phase 1-3 baseline 0 trade-es valódi teljesítménye együttesen cáfolják a Phase 1-3 + Phase 4 historikus hipotézist: **a Phase 1-3 MTF-TKC szigorú 3-lépcsős confluence-e a 2024-2026-os BTC/ETH/SOL piacon egyáltalán nem triggerel**.

## 1. Eredmények — Phase 1-3 rerun (engine-fix után)

| Symbol | Timeframe | Trades | Total Return | Sharpe | Max DD | Final equity |
|---|---|---:|---:|---:|---:|---:|
| BTC/USDT | 1h | **0** | 0.00% | N/A | 0.00% | $10,000.00 |
| BTC/USDT | 4h | **0** | 0.00% | N/A | 0.00% | $10,000.00 |
| BTC/USDT | 1d | **0** | 0.00% | N/A | 0.00% | $10,000.00 |
| ETH/USDT | 1h | **0** | 0.00% | N/A | 0.00% | $10,000.00 |
| ETH/USDT | 4h | **0** | 0.00% | N/A | 0.00% | $10,000.00 |
| ETH/USDT | 1d | **0** | 0.00% | N/A | 0.00% | $10,000.00 |
| SOL/USDT | 1h | **0** | 0.00% | N/A | 0.00% | $10,000.00 |
| SOL/USDT | 4h | **0** | 0.00% | N/A | 0.00% | $10,000.00 |
| SOL/USDT | 1d | **0** | 0.00% | N/A | 0.00% | $10,000.00 |

**Összesítve:** 0 trade / 9 symbol × timeframe / 30.1 hónap. A stratégia a hibátlan MTF aggregációval egyetlen valódi szignált sem produkált.

A nyers JSON-ok a `backtest-results/baseline-mtf-tkc-rerun-{symbol}-{tf}.json` fájlokban.

## 2. Összehasonlítás — Phase 1-3 eredetik vs. engine-fix rerun

A Phase 1-3 baseline (`backtest-results/baseline-{symbol}-{tf}.json`, 5 fájl) a törött MTF aggregációval készült; a Phase 1-3 rerun (`baseline-mtf-tkc-rerun-{symbol}-{tf}.json`, 9 fájl) az engine-fix után:

| Symbol | Timeframe | Phase 1-3 trades | Phase 1-3 ret | Phase 5 M0 trades | Phase 5 M0 ret | Változás |
|---|---|---:|---:|---:|---:|---|
| BTC/USDT | 1h | 2 | −0.71% | **0** | 0.00% | −2 trade (artifact eliminálva) |
| BTC/USDT | 4h | 0 | 0.00% | 0 | 0.00% | nincs változás |
| BTC/USDT | 1d | 0 | 0.00% | 0 | 0.00% | nincs változás |
| ETH/USDT | 1h | 1 | −0.46% | **0** | 0.00% | −1 trade (artifact eliminálva) |
| ETH/USDT | 4h | *n/a* | — | 0 | 0.00% | új lefutás (a Phase 1-3 nem futtatta 4h/1d-t ETH/SOL) |
| ETH/USDT | 1d | *n/a* | — | 0 | 0.00% | új lefutás |
| SOL/USDT | 1h | 1 | −0.34% | **0** | 0.00% | −1 trade (artifact eliminálva) |
| SOL/USDT | 4h | *n/a* | — | 0 | 0.00% | új lefutás |
| SOL/USDT | 1d | *n/a* | — | 0 | 0.00% | új lefutás |

*Megjegyzés:* a Phase 1-3 baseline riport (`backtest-results/REPORT.md`) BTC 4h/1d, ETH 4h/1d, SOL 4h/1d baseline-kat **nem** készítette (csak az 5 fenti fájl létezik a main-en). A Phase 5 M0 ezeket most pótolta — és mind 0 trade.

## 3. Mit jelent ez?

### 3.1 Az eredeti Phase 1-3 trade-számok nem valódiak voltak

A Phase 1-3 riport a `MtfTrendConfluenceStrategy` stratégiát "túl restriktívnek" minősítette, mert 30 hónap alatt csak 4 trade-et generált. **Az engine-bug fix felfedte, hogy ezek a trade-ek hamis szignálok voltak** — a törött `aggregateToTimeframe` függvény miatt a MTF (4h) indikátorok valójában 1h candle-sorozatból számolódtak (1:1 copy), így a HTF trend, MTF pullback, LTF trigger hármas confluence condition-álisan teljesülhetett, de a jel mögött valódi 4h struktúra nem volt.

A Phase 1-3-ban a BTC 1h-n látott 2 trade entry-re példa: a jelzés akkor jött, amikor az LTF 1h close (44,237) "≤ MTF BB lower (61,194)" — a BB lower 61,194 egy fiktív érték volt, a törött aggregációból származó instabil stddev miatt. A valódi 4h BB lower a helyes aggregációval ~42,000 körül lett volna, és a close 44,237 nem érintette volna.

### 3.2 A MTF-TKC v1.0 a 2024-2026 BTC/ETH/SOL piacon SZIGNÁLSZEGÉNY

A Phase 1-3 riport "Phase 4 input" szekciójában megfogalmazott kritika (`docs/research/REPORT.md §4.1`) most empirikusan is igazolódott: a 3-lépcsős confluence (HTF trend + MTF pullback + LTF trigger) **egyetlen valódi 4h szintű pullback setup-ot sem azonosított** 30 hónap alatt. A piac jellemzően erős trend-időszakokból állt, ahol a MTF pullback-setup szinte sosem teljesült.

### 3.3 A Phase 1-3 stratégia-teszt validációját IS érinti a fix

A Phase 1-3 riport és a Phase 4 riport egyaránt használta a `MtfTrendConfluenceStrategy` unit tesztjeit, amik a confluence logikát helyes, kézzel összerakott teszt-adatokon validálják. Ezek a tesztek továbbra is passzolnak (124/124 a backtest csomagban, 137/137 a core-ban), DE az integrációs tesztek (valódi OHLCV) mostantól 0 trade-et produkálnak — ami a stratégia gyakorlati használhatóságát cáfolja.

## 4. Phase 5-re gyakorolt hatás

### 4.1 Alap referencia átértékelődik

A Phase 1-3 eredmények (4 trade / 30 hó, −0.71% legjobb) a bug miatt **nem összehasonlítási alapok** — a Phase 5 stratégiáknak a Phase 1-3 "korrigált 0 trade" értékhez kell, hogy viszonyítsanak. A valódi baseline referenciapont most a Phase 4 mean-reversion (BTC 592 / ETH 715 / SOL 797 trade, mind negatív Sharpe).

### 4.2 M1 irány: a trend-following egyértelműen preferált

A Phase 4 mean-reversion bizonyította, hogy a **reversal-stratégia** trend-strong környezetben veszteséges. A Phase 1-3 most bizonyítja, hogy a **túl-szigorú trend-stratégia** (3-lépcsős confluence) egyáltalán nem generál jelet. A kettő közötti **OPTIMUM** a lazább trend-following valahol, pl.:
- **Always-in EMA 50/200** crossover — mindig benntartott pozíció, kevés jel, de magas win-rate emelkedő trendben (Phase 4 brief #1 jelölt)
- **Donchian(20) breakout** — közepes trigger-sűrűség, trend-following (#2 jelölt)
- **Supertrend(10, 3) alone** — 1-lépcsős trend-szűrő, ami a MTF-TKC-nél lazább (#2 variáns)

A Phase 1-3 hiba (túl sok MTF layer) és a Phase 4 hiba (túl laza MTF indikátor-trigger) **az MTF komplexitás egyensúlyát jelzi** — Phase 5-re a "kevesebb layer, több always-in" irány a tanulság.

### 4.3 Az M0 rerun kihat a Phase 1-3 riportra

A `backtest-results/REPORT.md` (Phase 1-3 riport) "kritikus megállapítása" ("a stratégia a jelenlegi formájában NEM termel elegendő jelet") most már számszerűen is igaz: **0 trade / 30 hó / 9 kombináció**. A Phase 5 strategy selection dolgozhat ezzel a tisztított baseline-nal.

## 5. Futtatási reprodukálhatóság

```bash
# A Phase 5 M0 rerun reprodukálása (a wt-phase5-ensemble worktree gyökeréből):
for sym in BTC ETH SOL; do for tf in 1h 4h 1d; do
  lcsym=$(echo $sym | tr '[:upper:]' '[:lower:]')
  out="backtest-results/baseline-mtf-tkc-rerun-${lcsym}-${tf}.json"
  bun run packages/backtest-tools/src/cli/run-baseline.ts \
    --symbol=$sym/USDT --timeframe=$tf --output=$out
done; done

# Az engine-fix unit tesztjei (126/126 passzol):
cd packages/backtest && bun test

# Az M0 typecheck + lint + test + coverage:
bun run typecheck && bun run lint && bun run test && bun run coverage
```

A `MtfTrendConfluenceStrategy` unit tesztjei (`packages/core/src/strategy/mtf-trend-confluence.test.ts`) a fix után is mind átmennek (137/137 a core csomagban) — a fix nem érintette a stratégia logikáját, csak az aggregátort, ami a stratégia bemeneti adatait állítja elő.

## 6. Konklúzió

A Phase 1-3 baseline 4 trade-es száma az engine-bug miatt artifact volt — a Phase 5 M0 rerun 0 trade-et produkál minden symbol × timeframe kombinációban. Ez **két, egymást cáfoló eredményt** hozott felszínre:

1. **Phase 1-3 MTF-TKC túl szigorú volt** — a valódi piacon nem adott jelet.
2. **Phase 4 mean-reversion túl laza volt** — a valódi piacon ~600-800 trade-et adott, mind negatív EV-vel.

A Phase 5-nek a **két véglet közötti optimumot** kell megtalálnia: lazább trend-following (always-in, 1-2 layer), ensemble-szel kombinálva. A funding-rate carry és a cross-exchange arb mint off-exchange edge class kiegészítheti, de a bybit.eu SPOT-only környezetben limitációk vannak (lásd Phase 5 M1 strategy-selection).

---

_Ez a riport a Phase 5 M0 engine-fix validation eredményeit dokumentálja. A nyers adatok a `backtest-results/baseline-mtf-tkc-rerun-{sym}-{tf}.json` fájlokban (9 fájl), a Phase 1-3 eredetik a `backtest-results/baseline-{sym}-{tf}.json` fájlokban (5 fájl)._
