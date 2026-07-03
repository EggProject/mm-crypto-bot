# Phase 5 Brief — Trend-following + Multi-strategy Ensemble + Funding-rate carry

> **Szerző:** Mavis root (mvs_c13fe65cb68f4df3851304dea09a9099)
> **Dátum:** 2026-07-04
> **Trigger:** Phase 4 mean-reversion baseline (BTC −3.75 / ETH −2.79 / SOL −2.59 Sharpe) — a tisztán MR-BB stratégia NEM éri el a +100%/hó célt. Az engine-bug fix (`aggregateToTimeframe` bucketStart alignment) valódi Phase 1-3 korrekció. Phase 5 a kimaradt 7 jelöltből választ, és a Phase 1-3 baseline-t is újrafuttatja a fix motorral.

---

## 0. Phase 4 eredmények — ami működött és ami nem

### Ami NEM működött
- `MeanReversionBbStrategy` (LTF 1h close ≤ MTF 4h BB(20, 2σ) lower → long, target = BB middle, stop = entry × 0.99) — **mindhárom szimbólumon negatív Sharpe**, per-trade EV BTC −$7.21, ETH −$5.79, SOL −$5.84
- Stop-loss dominancia 73-82% — a fee-drag (0.34% round-trip bybit.eu) + trend-strong market miatt a BB lower-touch pullback, nem reversal
- ADX > 35 filter nem volt elég: a trend-szűrés nem védte meg a stratégiát a Phase 4 empirikus környezetben

### Ami MŰKÖDIK (Phase 4 outputok)
- **Engine-bug fix** (`packages/backtest/src/engine.ts` — `bucketStart = timestamp - timestamp % targetMs`): Phase 1-3 alatt is jelen volt, de a restriktív `MtfTrendConfluenceStrategy` (0-2 trade/30 hó) elfedte. Phase 4 mean-reversion láthatóvá tette. **A Phase 1-3 baseline-okat az új aggregátorral ÚJRA KELL FUTTATNI** a fair összehasonlításhoz.
- 126 backtest teszt (124 + 2 regression), 137 core teszt, 12/12 turbo pipeline green
- `MeanReversionBbStrategy` kód használható kompozit elemként (a trend-szűrővel együtt)

### Ami Phase 5-re VÁR
A Phase 4 brief 8 jelöltje közül Phase 4-ben csak az #5 (mean-reversion) lett tesztelve. A maradék 7-ből Phase 5 választ:
1. **Always-in trend-following** — EMA/Donchian/Supertrend, mindig benntartott
2. **Volatility breakout** — Donchian(20) + ATR-szűrő
3. **Funding rate carry / cross-exchange arb** — bybit.eu spot + offshore perp
4. **Basket of small high-probability signals** — sok kis edge, 0.3-0.5% risk/trade
6. **News / social velocity** — Twitter/social gyorshajtás news-ra
7. **Grid trading / scalping 1:10 margin-en** — tight range
8. **Multi-strategy ensemble** — a fentiek kombinációja

A `docs/research/strategy-candidates.md` részletes empirikus hátteret ad minden jelölthez. A user explicit kérése: „felejtsük el az interneten irt nem lehet, ne vicceljünk 1:10 -hez spot marginon miert ne lehetne? ... rugaszkodj el attol amit irnak csak csinald csinald csinald keresd a lehetosegeket es technikakat es osszefuggeseket es talald meg a celhoz vezeto utat." → Phase 5-öt ez a szellem vezérli.

---

## 1. Phase 5 cél

A Phase 1-3 + Phase 4 empirikus eredményei alapján a +100%/hó realitásvizsgálat 2. köre. **Nem elég egy újabb egyedi stratégiát tesztelni** — a Phase 5 az alábbi 4 komponenst párhuzamosan vizsgálja:

### 1.1 M0 — Engine-fix validáció (KÖTELEZŐ, 1 nap)
**Cél:** A Phase 1-3 baseline (`MtfTrendConfluenceStrategy v1.0`) újrafuttatása az engine-bug fix-szel. Ha a Phase 1-3 valódi teljesítménye szignifikánsan jobb (vagy más), az megváltoztatja a Phase 5 baseline referenciát.

- **Input:** `packages/backtest/src/engine.ts` (fix már bent van a main-en a Phase 4 merge után)
- **Output:** `backtest-results/REPORT-phase1-3-rerun.md` + frissített `baseline-mtf-tkc-{btc,eth,sol}-{1h,4h,1d}.json`
- **Sikerkritérium:** Az újrafuttatott eredmények dokumentálva + összehasonlítva a Phase 1-3 baseline-okkal (melyik trade-szám nőtt, melyik irány fordult meg)

### 1.2 M1 — Stratégia-típus szűkítés (1-2 nap, kutató fázis)
A Phase 4 kimaradt 7 jelöltjéből **3-at** kell kiválasztani indoklással. A kiválasztás kritériumai:
- **Konkrét backtest-szám a Phase 1-3 / Phase 4 tanulságaira** (nem általános kutatási default)
- **Realisztikus illeszkedés a bybit.eu SPOT 1:10 környezethez** (margin-kamat, fee-drag, borrowing-limit, EU-only spot → offshore perp limitáció)
- **Legalább egy** legyen a trend-following osztályból (#1 vagy #2) — mert Phase 4 mean-reversion bizonyította, hogy trend-strong környezetben a reversal-stratégia veszteséges; a trend-following ennek komplementere
- **A multi-strategy ensemble (#8) preferált**, mert a Phase 4 empirikus tanulsága az, hogy egyetlen edge-class önmagában nem elég; az ensemble diverzifikál

**Ajánlott default jelöltek (az ügynök módosíthatja indoklással):**
- **#1 Always-in trend-following** (EMA 50/200 vagy Supertrend) — counter-cyclical Phase 4 failure
- **#3 Funding-rate carry** — külön edge class, off-exchange kockázattal
- **#8 Multi-strategy ensemble** — kombó: trend-szűrő + MR-szűrő + funding-bias

**Output:** `docs/research/phase5-strategy-selection.md` — kiválasztás, empirikus háttér (≥2 független forrás minden jelöltnél), becsült trade-szám + win-rate + drawdown a Phase 1-3 / Phase 4 tanulságaira vetítve

### 1.3 M2 — Implementáció (2-3 nap)
A kiválasztott 3 stratégia teljes implementációja a `packages/core/src/strategy/` mappában:
- Minden stratégia: `Strategy` interfész implementáció + unit-tesztek (≥8 teszt / stratégia)
- Különösen fontos: a trend-following stratégia NE használjon restriktív 3-lépcsős MTF confluence-t (ami Phase 1-3 hibája volt) — hanem **always-in** legyen, 1D/4H HTF trend-del
- A multi-strategy ensemble-hez: új `CompositeStrategy` osztály a `packages/core/src/strategy/composite.ts` fájlban, ami a komponens stratégiákat ensemble-szé kombinálja (súlyozott jelzés-vagy kapu, position-sizing allokációval)

**Output:**
- `packages/core/src/strategy/<strategy>.ts` + `<strategy>.test.ts` (unit-tesztek)
- `packages/core/src/strategy/composite.ts` + `composite.test.ts` (ensemble)
- `packages/backtest-tools/src/cli/run-<strategy>-baseline.ts` (CLI runner, tükrözi a Phase 4 `run-mr-baseline.ts` mintát)
- Minden új stratégia backtest JSON: `backtest-results/baseline-<strategy>-{btc,eth,sol}-{1h,4h,1d}.json`

### 1.4 M3 — Mérés és riport (1-2 nap)
A kiválasztott stratégiák teljesítménye a Phase 1-3 OHLCV adatokon (BTC/ETH/SOL × 1h/4h/1d, 2024-01 → 2026-07). Riport a `backtest-results/REPORT-phase5.md` fájlba:
- A Phase 5 stratégiák havi hozama az M0 rerun-hoz és a Phase 4 MR-BB baseline-hoz hasonlítva
- A multi-strategy ensemble (ha implementálva) havi hozama a komponensekhez képest
- Funding-rate carry (ha offshore perp-et igényel) megvalósíthatósági elemzése bybit.eu spot környezetben — ha nem megvalósítható, dokumentálni kell miért
- A 100%/hó realitásvizsgálat 2. körének egyértelmű IGEN/NEM/RÉSZBEN válasza
- Amennyiben bármelyik eléri a +50%/hó szintet: a szükséges position-sizing, várható drawdown, backtest korlátok (look-ahead, overfitting)

---

## 2. Phase 5 NEM célja

- ❌ Több egyedi mean-reversion variáns tesztelése — Phase 4 ezt lezárta
- ❌ A Phase 4 engine-bug fix visszacsinálása vagy megkérdőjelezése — a fix a main-en van, stabil
- ❌ Scalping (1m-15m) high-frequency — a `docs/research/strategy-candidates.md` #5-öt kizárta bybit.eu fee-struktúra miatt
- ❌ Funding-rate carry kizárólagossá tétele — Phase 5 multi-strategy, a funding csak egy edge class a kompozitban
- ❌ Offshore perpetual integráció ÉLES kereskedéshez — Phase 5 backtest szintű vizsgálat, deployment a Phase 6+

---

## 3. Munkafolyamat és workflow szabályok

### 3.1 Worktree és branch
- **Új worktree** a main-ről (ami most a Phase 4 merge után `3425c61`):
  - `cd /Users/kiscsicska/projects/mm-crypto-bot && git worktree add .worktrees/wt-phase5-ensemble -b feat/phase5-ensemble main`
- A `wt-9d6d823b` worktree (feat/phase4-aggressive) Phase 4 után **archív** — ne módosítsd
- **MINDEN** munka az új `feat/phase5-ensemble` branch-en

### 3.2 Implementáció → commit → push → PR
1. Implementáció a worktree-ben (stratégia + unit tesztek + CLI runner)
2. `bun install --frozen-lockfile && bun run typecheck && bun run lint && bun run test && bun run coverage` — **MIND zöld kell legyen** commit előtt
3. Backtest futtatás: `bun run packages/backtest-tools/src/cli/run-<strategy>-baseline.ts --symbol=<SYM> --timeframe=<TF> --output=backtest-results/baseline-<strategy>-<sym>-<tf>.json`
4. Commit (conventional commits, magyar summary OK):
   ```
   feat(backtest,core,backtest-tools): ÜGYNÖK Phase 5 — <komponens neve>
   
   - <stratégia 1>: <rövid leírás>
   - <stratégia 2>: <rövid leírás>
   - engine-fix validation: M0 rerun eredmények
   ```
5. Push: `git push -u origin feat/phase5-ensemble`
6. **PR-t NE a Te oldaladon nyiss** — a `gh` CLI nincs auth-olva a worktree session-ön. Push után küldj report-ot a root session-nek (lásd 3.4), a root session nyitja a PR-t.

### 3.3 Kutatási nyelv és mélység (KÖTELEZŐ)
- **Kutatási nyelv: kizárólag angol.** Magyar források konzervatív default-okkal dolgoznak, az angol nyelvű crypto-trading community (Substack, X, akadémiai quant-finance, bybit.eu whitepaperek, perp-funding kutatások) szélesebb perspektívát ad.
- **Minimum 5-10 web query** minden stratégia-jelölthez, több szög (technikai, kulturális, regulatory, bybit.eu specifikus, perp-funding specifikus, cross-exchange specifikus).
- **Minden empirikus állításhoz ≥ 2 független forrás** idézése kötelező (a Phase 1-3 baseline riport 48+ forrása ennek mintája).
- A Phase 5 strategy-selection.md **angol nyelvű** kutatási szekciókat tartalmazzon; a bevezető/konklúzió magyar OK.

### 3.4 Report-back a root session-nek
Minden milestone (M0, M1, M2, M3) után küldj report-ot:
```
mavis communication send \
  --from <YOUR_SESSION_ID> \
  --to mvs_c13fe65cb68f4df3851304dea09a9099 \
  --command prompt \
  --content "PHASE 5 M<n> COMPLETE. <részletek>"
```
A root session (Mavis) nyitja a PR-t, monitorozza a CI-t, és kommunikál a user felé.

### 3.5 Döntési autonómia (KÖTELEZŐ)
- A user explicit kérése: „az ügynök önállóan dönt, indokolással".
- Az M1 stratégia-kiválasztásnál **NE kérdezz vissza a user felé** — válassz a 7 jelöltből szabadon, indokold a Phase 4 tanulságaival.
- Ha a kutatás során olyan edge case-t találsz, ami a brief módosítását indokolná (pl. bybit.eu spot margin limitáció miatt egy jelölt kizárandó), dokumentáld a strategy-selection.md-ban, és folytasd a módosított tervvel — ne blokkolj a root session-re.

---

## 4. Output-ok (végleges lista)

| Fájl | Tartalom | Mikor |
|------|----------|-------|
| `docs/research/phase5-strategy-brief.md` | Ez a fájl (a root session hozta létre) | M1 előtt kész |
| `docs/research/phase5-strategy-selection.md` | M1 kiválasztás: 3 stratégia, empirikus háttér ≥2 forrással, becsült paraméterek | M1 végén |
| `backtest-results/REPORT-phase1-3-rerun.md` | M0 engine-fix validation riport | M0 végén |
| `backtest-results/baseline-mtf-tkc-rerun-{sym}-{tf}.json` | M0 rerun JSON-ok | M0 végén |
| `packages/core/src/strategy/<strategy>.ts` + `.test.ts` | M2 stratégia implementációk (3 db) | M2 végén |
| `packages/core/src/strategy/composite.ts` + `.test.ts` | M2 ensemble (ha kiválasztva) | M2 végén |
| `packages/backtest-tools/src/cli/run-<strategy>-baseline.ts` | M2 CLI runner-ek (3 db) | M2 végén |
| `backtest-results/baseline-<strategy>-{sym}-{tf}.json` | M2 baseline JSON-ok | M2 végén |
| `backtest-results/REPORT-phase5.md` | M3 végső riport | M3 végén |
| `feat/phase5-ensemble` branch | Push-olva origin-re, PR a root session által | M3 után |

---

## 5. Kilépési kritérium

A Phase 5 akkor zárható le, ha **MIND** az alábbi teljesül:
1. ✅ M0 engine-fix validation kész — a Phase 1-3 baseline-ok újrafuttatva, riportolva
2. ✅ M1 strategy-selection.md kész — 3 stratégia kiválasztva, ≥2 forrás / stratégia, magyar konklúzió
3. ✅ M2 implementáció kész — 3 stratégia + ensemble (ha kiválasztva) kód + unit tesztek + CLI runner-ek
4. ✅ M3 backtest-ek kész — minden stratégia × symbol × timeframe baseline JSON + REPORT-phase5.md
5. ✅ `bun run typecheck && bun run lint && bun run test && bun run coverage` MIND zöld
6. ✅ A riport egyértelmű választ ad: a kiválasztott stratégiák együttesen elérik-e a +50%/hó szintet (a +100%/hó a Phase 5-ön már realistic target downgrade, lásd Phase 4 tanulságait)
7. ✅ Branch push-olva, PR kész (a root session nyitja)

---

## 6. Stratégiai kontextus (a user 100%/hó realitásvizsgálat)

A user explicit célja továbbra is +100%/hó. A Phase 4 dokumentáltan cáfolta, hogy **egyetlen edge class** (mean-reversion BB) eléri. Phase 5 azt vizsgálja, hogy **edge class-ok kombinációja** (trend-following + ensemble + funding-rate carry) eléri-e a +50%/hó szintet — ami a user cél felének reális előrehaladás. Ha igen, a Phase 6 a position-sizing és risk-management finomhangolásával közelíthet a +100%/hó felé. Ha nem, a user felé explicit riport: a bybit.eu SPOT 1:10 környezetben a mért empirikus limitáció dokumentálva, és a cél realisztikus szintre csökkentése javasolt (a user végső döntése).

A Phase 5 NEM a user felé kérdez, hanem önállóan halad — de a végső riport világos alternatívákat ad a usernek a döntéshez.

---

**Vége a briefnek. A root session várja a worker M0→M1→M2→M3 milestone reportjait.**