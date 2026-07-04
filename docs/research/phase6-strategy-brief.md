# Phase 6 Brief — Multi-class edge ensemble (funding carry + cross-exchange arb + Kelly-opt)

> **Szerző:** Mavis root (mvs_c13fe65cb68f4df3851304dea09a9099)
> **Dátum:** 2026-07-04
> **Trigger:** Phase 5 REPORT-phase5.md — a +50%/hó realitásvizsgálat 2. köre **RÉSZBEN** eredményt hozott. A Donchian 1d trend-following (Strategy C) az EGYETLEN profitábilis edge osztály (+0.04-0.10%/hó), DE 500×-del a +50%/hó target alatt. A +50%/hó eléréséhez multi-class ensemble kell (funding-rate carry + cross-exchange arb + Kelly-opt a meglévő Donchian 1d edge-re).
>
> **User-perspektíva:** A user explicit kérése: „használj agenteket" → Phase 6 három párhuzamos track-en, specialista agent-ek spawnolásával.

---

## 0. Phase 5 eredmények — ami Phase 6 alapja

### Ami MŰKÖDIK (Phase 5-ből átvett edge)
- **DonchianBreakoutStrategy 1d** — SOL +2.78% / ETH +3.17% / BTC +1.15% / 30 hónap, Sharpe 0.16-0.46, max DD 3.09-5.53%, 19-28 trade / symbol. **Legjobb Sharpe/DD arány: SOL (0.464) és ETH (0.441)**. Ez lassú, alacsony-frekvenciás, magas megnyugvás-rátájú trend-following edge.
- **Engine maturity:** Phase 4 + Phase 5 engine-fix-ek (bucketStart alignment + previous-bar-exclusive Donchian) a main-en vannak, stabilak. 307 unit teszt átmegy.
- **Cost-model validáció:** bybit.eu SPOT 1:10 — taker 0.1%/side, slippage 0.05%/side, spread 0.02%/side, borrow 0.01%/h, funding 0 (SPOT-only MiCAR).

### Ami NEM MŰKÖDIK (Phase 5 lezárt, NEM folytatjuk)
- Always-in trend-following (Strategy A): minden kombináció negatív, fee-drag dominancia
- Composite ensemble (Strategy B): fee-drag + ortogonális-komponens hiány → rosszabb mint a komponensek átlaga
- Mean-reversion BB (Phase 4): trend-strong piacon stop-loss dominancia 73-82%
- +50%/hó single-class valószínűsége bybit.eu SPOT 1:10-en: alacsony (Phase 5 cáfolta)

### Ami Phase 6-ra VÁR
A Phase 5 riport §6-ban priorizált 4 scope-ból Phase 6 az első 3-at vizsgálja párhuzamosan:
1. **Funding-rate carry** (priority 1) — bybit.eu SPOT-only MiCAR korlát miatt multi-exchange szintetikus (binance/OKX perp + bybit.eu spot), paper-trading backtest
2. **Cross-exchange spread arb** (priority 2) — latency-érzékeny (sub-100ms), jelenlegi infrastruktúra nem támogatja — Phase 6-ban latency-backtest, deployment Phase 7+
3. **Kelly-opt position-sizing** (priority 3) — Phase 5 Donchian 1d edge (jelenleg 0.25 conservative) Kelly-fraction optimalizálással skálázva

A Phase 6 **NEM** scope-jába esik:
- ❌ Trailing-stop engine support (Phase 7+ technical debt)
- ❌ Éles deployment (Phase 8+, MiCAR scope)
- ❌ Több egyedi trend-following variáns (a Donchian 1d a baseline)

---

## 1. Phase 6 cél

A +50%/hó realitásvizsgálat 3. köre. **Multi-class ensemble backtest-szintű vizsgálata** annak megállapítására, hogy a funding-rate carry + cross-exchange arb + Kelly-opt kombináció reálisan közelíti-e a +50%/hó szintet bybit.eu SPOT 1:10 + multi-exchange synthetic perp környezetben.

### 1.1 M0 — Phase 6 baseline szinkronizáció (KÖTELEZŐ, owner session)
- **Cél:** A Phase 5 artifact-ok (27 baseline JSON, REPORT-phase5.md, 3 stratégia implementáció) a Phase 6 munkához előkészítve.
- **Output:** A `feat/phase6-multi-class` branch a main-ről (most `3b8188c` Phase 5 M3 merge után)
- **Kész:** `git worktree add .worktrees/wt-phase6-multi-class -b feat/phase6-multi-class main` (a root session)

### 1.2 M1 — Három párhuzamos track (2-4 nap, specialista agent-ek)

#### M1.1 Track A: Funding-rate carry simulation (Crypto Expert agent)
**Cél:** Paper-trading szintű funding-rate carry backtest, bybit.eu SPOT + binance/OKX perp synthetic execution modellel.

- **Input:** Phase 1 OHLCV adatok (BTC/ETH/SOL × 1h, 2024-01 → 2026-07) + historikus funding rate adatok (binance 8h snapshot, ingyenes public API-ból letöltendő)
- **Output:**
  - `packages/core/src/strategy/funding-carry.ts` — `Strategy` interfész implementáció: long-spot + short-perpetual delta-semleges pozíció, funding payment collection szimuláció
  - `packages/core/src/strategy/funding-carry.test.ts` — ≥8 unit teszt (delta-semlegesség, funding accrual, edge case-k)
  - `packages/backtest-tools/src/cli/run-funding-carry-baseline.ts` — CLI runner (tükrözi a `run-donchian-baseline.ts` mintát)
  - `backtest-results/baseline-funding-carry-{btc,eth,sol}-1h.json` — 3 backtest JSON
  - `docs/research/phase6-funding-carry.md` — empirikus riport, ≥3 független forrás (Bybit Institutional, ainvest.com, bagtester, ScienceDirect — Phase 5 §5-ben idézve)
- **Sikerkritérium:**
  - A funding-rate carry pozitív edge-e ≥ 0.3%/hó (a Phase 5 becslés ±50%-os sávjának alsó határa)
  - A delta-semleges pozíció VaR-ja < 2% (a bybit.eu SPOT margin 1:10-hez illeszkedve)
  - A withdraw latency (5-30 perc baseline) figyelembe véve a carry trade entry/exit költségeiben

#### M1.2 Track B: Cross-exchange spread arb latency backtest (CCXT Pro Specialist agent)
**Cél:** binance/Bybit/KuCoin spot-ok közötti spread arb latency-backtest, deployment readiness assessment Phase 7+ számára.

- **Input:** Phase 1 OHLCV + historikus order book tick data (binance/Bybit public WS, 2024-01 → 2026-07 limitált subset, pl. 30 nap minta)
- **Output:**
  - `packages/exchange/src/latency-monitor.ts` — WS latency mérő modul (RTT, message gap, reconnect time)
  - `packages/exchange/src/latency-monitor.test.ts` — ≥6 unit teszt
  - `packages/backtest-tools/src/cli/run-arb-latency.ts` — latency-backtest CLI runner
  - `backtest-results/arb-latency-{exchange-pair}-sample.json` — 3 minta JSON (BTC, ETH, SOL spread latency)
  - `docs/research/phase6-arb-latency.md` — empirikus riport, ≥3 független forrás (CCXT Pro latency benchmarks, exchange SLA-k, academic HFT latency papers)
- **Sikerkritérium:**
  - A jelenlegi WS infrastruktúra (Phase 5 óta: `feat/exchange-paper` branch-en) latency karakterizálása
  - A profitábilis arb ablak mérete > 50ms (a jelenlegi infra 100-300ms RTT-jéhez képest)
  - Deployment readiness score (Phase 7+ scope): jelenlegi infrastruktúra mennyire támogatja a sub-100ms arb-ot

#### M1.3 Track C: Kelly-opt position-sizing Donchian 1d edge-re (Strategy Specialist agent)
**Cél:** A Phase 5 C Donchian 1d pozitív edge-ének Kelly-fraction optimalizálása, hogy a havi hozam 2-5×-re skálázódjon a jelenlegi 0.25 conservative sizing-ról.

- **Input:** `backtest-results/baseline-donchian-{btc,eth,sol}-1d.json` (Phase 5 M3 baseline-ok) + a DonchianBreakoutStrategy meglévő implementáció (`packages/core/src/strategy/donchian-breakout.ts`)
- **Output:**
  - `packages/core/src/risk/kelly-position-sizer.ts` — Kelly-fraction kalkulátor + walk-forward validator
  - `packages/core/src/risk/kelly-position-sizer.test.ts` — ≥10 unit teszt (Kelly formula, walk-forward split, edge case-k)
  - `packages/backtest-tools/src/cli/run-kelly-opt.ts` — Kelly-opt CLI runner, ami a Donchian 1d edge-en futtatja a Kelly-optimalizált position-sizing-ot
  - `backtest-results/baseline-kelly-opt-{btc,eth,sol}-1d.json` — 3 backtest JSON (Kelly-opt sizing-ú Donchian 1d)
  - `docs/research/phase6-kelly-opt.md` — empirikus riport, Kelly formula származtatás, walk-forward validáció, ≥3 független forrás (Thorp, Vince, Poundstone — Kelly criterion akadémiai források)
- **Sikerkritérium:**
  - A Kelly-opt edge ≥ 2× a Phase 5 conservative (0.25) sizing-hoz képest
  - A walk-forward out-of-sample Sharpe > 0 (nincs overfitting)
  - A maximális drawdown < 15% (a Phase 5 baseline 3-5.5%-ról indulva, Kelly által skálázva)

### 1.3 M2 — Multi-class ensemble integráció (1-2 nap, owner session)
A 3 track eredményeinek kombinálása egyetlen ensemble backtest keretrendszerben.

- **Output:**
  - `packages/core/src/strategy/multi-class-ensemble.ts` — `CompositeStrategy` kiterjesztés: Donchian 1d + funding-carry + arb-latency (paper-trade szinten) parallel futtatás, allokáció Kelly-opt-on keresztül
  - `packages/core/src/strategy/multi-class-ensemble.test.ts` — ≥8 unit teszt (komponens izoláció, allokáció, fee-drag számítás)
  - `packages/backtest-tools/src/cli/run-multi-class-baseline.ts` — multi-class ensemble CLI runner
  - `backtest-results/baseline-multi-class-{btc,eth,sol}-1d.json` — 3 ensemble backtest JSON
  - `backtest-results/REPORT-phase6.md` — végső riport, ami szintetizálja a 3 track eredményeit + a multi-class ensemble mérését

### 1.4 M3 — Döntés a +50%/hó realitásáról (1 nap, owner session)
- A Phase 6 empirikus eredményei alapján egyértelmű IGEN/NEM/RÉSZBEN válasz
- Amennyiben bármely multi-class kombináció eléri a +5%/hó szintet: Phase 7+ scope javaslat (position-sizing finomhangolás, deployment readiness)
- Amennyiben nem: a user felé explicit riport a Phase 1-6 empirikus limitációiról, és javaslat a reális célra (pl. +0.5-2%/hó, havi 2-10% konzervatívabb sizing-gal)

---

## 2. Phase 6 NEM célja

- ❌ Éles multi-exchange deployment (a MiCAR scope és a Phase 5 kizárás miatt)
- ❌ Több stratégia-típus tesztelése (a 3 track a Phase 6 scope)
- ❌ A Phase 5 stratégiák újrafuttatása (a Phase 5 M3 baseline-ok referenciaként szolgálnak)
- ❌ Trailing-stop engine support (Phase 7+ technical debt, bár a Phase 6 multi-class ensemble TRAILING stop nélkül is működik, csak alacsonyabb Sharpe-sal)

---

## 3. Munkafolyamat és workflow szabályok

### 3.1 Worktree struktúra
- **M0 (owner):** `wt-phase6-multi-class` worktree a main-ről (most `3b8188c` Phase 5 M3 merge után) — `feat/phase6-multi-class` branch
- **M1 (3 párhuzamos worker):** MINDEN worker a `wt-phase6-multi-class` worktree-ben dolgozik, MIND a 3 track ugyanazon a branch-en (nincs sub-worktree). A track-ek fájl-határai NEM átfedők:
  - Track A (funding-carry): `packages/core/src/strategy/funding-carry.ts`, `packages/backtest-tools/src/cli/run-funding-carry-baseline.ts`, `backtest-results/baseline-funding-carry-*.json`, `docs/research/phase6-funding-carry.md`
  - Track B (arb-latency): `packages/exchange/src/latency-monitor.ts`, `packages/exchange/src/latency-monitor.test.ts`, `packages/backtest-tools/src/cli/run-arb-latency.ts`, `backtest-results/arb-latency-*.json`, `docs/research/phase6-arb-latency.md`
  - Track C (Kelly-opt): `packages/core/src/risk/kelly-position-sizer.ts`, `packages/core/src/risk/kelly-position-sizer.test.ts`, `packages/backtest-tools/src/cli/run-kelly-opt.ts`, `backtest-results/baseline-kelly-opt-*.json`, `docs/research/phase6-kelly-opt.md`
  - **Nincs átfedés** — minden track más-más fájlokat ír. Az ensemble integráció (M2) az owner session dolga, nem worker.
- **M2 (owner):** Ugyanebben a worktree-ben, a 3 track commit-jaira építve

### 3.2 Implementáció → commit → push → PR (minden track-re)
1. Implementáció a worktree-ben (stratégia + unit tesztek + CLI runner)
2. `bun install --frozen-lockfile && bun run typecheck && bun run lint && bun run test && bun run coverage` — **MIND zöld kell legyen** commit előtt
3. Backtest futtatás: `bun run packages/backtest-tools/src/cli/run-<strategy>-baseline.ts --symbol=<SYM> --timeframe=<TF> --output=backtest-results/baseline-<strategy>-<sym>-<tf>.json`
4. Commit (conventional commits, magyar summary OK):
   ```
   feat(backtest,core,backtest-tools): ÜGYNÖK Phase 6 Track <A|B|C> — <track neve>
   
   - <komponens>: <rövid leírás>
   - <komponens>: <rövid leírás>
   - backtest eredmények: <kulcs számok>
   ```
5. Push: `git push -u origin feat/phase6-multi-class`
6. **PR-t NE a Te oldaladon nyiss** — a `gh` CLI nincs auth-olva a worktree session-ön. Push után küldj report-ot a root session-nek (lásd 3.4), a root session nyitja a PR-t.

### 3.3 Kutatási nyelv és mélység (KÖTELEZŐ — memory-beli user-preferencia)
- **Kutatási nyelv: kizárólag angol.** Magyar források konzervatív default-okkal dolgoznak, az angol nyelvű crypto-trading community (Substack, X, akadémiai quant-finance, bybit.eu whitepaperek, perp-funding kutatások) szélesebb perspektívát ad.
- **Minimum 5-10 web query** minden track-hez, több szög (technikai, kulturális, regulatory, bybit.eu specifikus, perp-funding specifikus, cross-exchange specifikus, Kelly-criterion akadémiai).
- **Minden empirikus állításhoz ≥ 2 független forrás** idézése kötelező (a Phase 1-3 baseline riport 48+ forrása ennek mintája).
- A Phase 6 track-dokumentumok (phase6-*.md) **angol nyelvű** kutatási szekciókat tartalmazzanak; a bevezető/konklúzió magyar OK.

### 3.4 Report-back a root session-nek
Minden track milestone után (M1 track complete) küldj report-ot:
```
mavis communication send \
  --from <YOUR_SESSION_ID> \
  --to mvs_c13fe65cb68f4df3851304dea09a9099 \
  --command prompt \
  --content "PHASE 6 Track <A|B|C> COMPLETE. <részletek>"
```
A root session (Mavis) nyitja a PR-t, monitorozza a CI-t, és kommunikál a user felé.

### 3.5 Döntési autonómia (KÖTELEZŐ — memory-beli user-preferencia)
- A user explicit kérése: „az ügynök önállóan dönt, indokolással".
- A 3 track kiválasztása a Phase 5 riport §6 alapján AUTONÓM: funding-carry (prioritás 1), arb-latency (prioritás 2), Kelly-opt (prioritás 3). Ha a kutatás során kiderül, hogy egy track nem kivitelezhető bybit.eu SPOT + multi-exchange synthetic környezetben, a worker NE blokkoljon a root session-re, hanem dokumentálja a track-dokumentumban, és folytassa a módosított tervvel (pl. funding-carry helyett csak historikus funding rate statisztikát készít).
- Ha a track-ek során olyan edge case merül fel, ami a brief módosítását indokolná (pl. bybit.eu spot margin limitáció miatt a Kelly-opt position-sizing-ot csökkenteni kell), a worker dokumentálja a track-dokumentumban.

---

## 4. Output-ok (végleges lista)

| Fájl | Tartalom | Mikor | Ki |
|------|----------|-------|-----|
| `docs/research/phase6-strategy-brief.md` | Ez a fájl (a root session hozta létre) | M0 | owner |
| `docs/research/phase6-funding-carry.md` | Track A empirikus riport | M1.1 végén | Crypto Expert |
| `packages/core/src/strategy/funding-carry.ts` + `.test.ts` | Track A stratégia implementáció | M1.1 végén | Crypto Expert |
| `packages/backtest-tools/src/cli/run-funding-carry-baseline.ts` | Track A CLI runner | M1.1 végén | Crypto Expert |
| `backtest-results/baseline-funding-carry-{btc,eth,sol}-1h.json` | Track A baseline JSON-ok | M1.1 végén | Crypto Expert |
| `docs/research/phase6-arb-latency.md` | Track B empirikus riport | M1.2 végén | CCXT Pro Specialist |
| `packages/exchange/src/latency-monitor.ts` + `.test.ts` | Track B latency modul | M1.2 végén | CCXT Pro Specialist |
| `packages/backtest-tools/src/cli/run-arb-latency.ts` | Track B latency-backtest CLI | M1.2 végén | CCXT Pro Specialist |
| `backtest-results/arb-latency-{exchange-pair}-sample.json` | Track B latency JSON-ok | M1.2 végén | CCXT Pro Specialist |
| `docs/research/phase6-kelly-opt.md` | Track C empirikus riport | M1.3 végén | Strategy Specialist |
| `packages/core/src/risk/kelly-position-sizer.ts` + `.test.ts` | Track C Kelly-opt modul | M1.3 végén | Strategy Specialist |
| `packages/backtest-tools/src/cli/run-kelly-opt.ts` | Track C Kelly-opt CLI runner | M1.3 végén | Strategy Specialist |
| `backtest-results/baseline-kelly-opt-{btc,eth,sol}-1d.json` | Track C Kelly-opt JSON-ok | M1.3 végén | Strategy Specialist |
| `packages/core/src/strategy/multi-class-ensemble.ts` + `.test.ts` | M2 ensemble implementáció | M2 végén | owner |
| `packages/backtest-tools/src/cli/run-multi-class-baseline.ts` | M2 ensemble CLI runner | M2 végén | owner |
| `backtest-results/baseline-multi-class-{btc,eth,sol}-1d.json` | M2 ensemble JSON-ok | M2 végén | owner |
| `backtest-results/REPORT-phase6.md` | Végső Phase 6 riport | M2 végén | owner |
| `feat/phase6-multi-class` branch | Push-olva origin-re, PR a root session által | M3 | owner |

---

## 5. Kilépési kritérium

A Phase 6 akkor zárható le, ha **MIND** az alábbi teljesül:
1. ✅ Mind a 3 track (funding-carry, arb-latency, Kelly-opt) implementálva van + unit tesztek + CLI runner + baseline JSON + empirikus riport
2. ✅ A multi-class ensemble (M2) integrálva van a 3 track edge-eiből + saját unit tesztek + ensemble baseline JSON
3. ✅ `bun run typecheck && bun run lint && bun run test && bun run coverage` MIND zöld
4. ✅ A REPORT-phase6.md egyértelmű IGEN/NEM/RÉSZBEN választ ad a +50%/hó realitására a multi-class ensemble szintjén
5. ✅ Branch push-olva, PR kész (a root session nyitja)
6. ✅ A user felé Phase 6 szintézis: mi működik, mi nem, és a Phase 7+ scope javaslat

---

## 6. Stratégiai kontextus (a user 100%/hó realitásvizsgálat)

A user explicit célja továbbra is +100%/hó. A Phase 1-5 empirikus története:
- Phase 1-3: −0.71% (artifact, broken engine miatt)
- Phase 4: −46.7% (mean-reversion, fee-drag dominancia)
- Phase 5: −13% átlag, DE a Donchian 1d az EGYETLEN pozitív edge (+0.04-0.10%/hó)
- Phase 6 várakozás (autonóm döntés): a multi-class ensemble a Phase 5 Donchian 1d edge-ét a funding-carry-vel kiegészítve +0.5-2%/hó szintre hozhatja. Ez **25-100× javulás** a Phase 5-höz képest, DE még mindig **25-100× a +50%/hó target alatt**.

Ha Phase 6 RÉSZBEN választ ad (a multi-class ensemble pozitív, de nem éri el a +50%/hó-t), a felhasználó felé explicit riport:
- A bybit.eu SPOT 1:10 + multi-exchange synthetic perp környezetben a mért empirikus edge-ek limitációja dokumentálva
- A reális havi hozam célsáv javaslat: +0.5-2%/hó (ami 6-24%/hó konzervatívabb, mint a +100%, DE konzisztens edge)
- A Phase 7+ scope: trailing-stop engine support (technical debt), deployment readiness Phase 8+

A Phase 6 NEM a user felé kérdez, hanem önállóan halad — de a végső riport világos alternatívákat ad a usernek a döntéshez.

---

## 7. Agent assignment (javasolt)

A user explicit kérése: „használj agenteket". A Phase 6 három párhuzamos track-jére a specialista agent-ek spawnolása a `mavis-team` skill-en keresztül:

| Track | Agent neve | Miért ő |
|-------|------------|---------|
| Track A: Funding-rate carry | `agent-c53b5725d31d` (Crypto Expert) | Market structure + funding rate + perp specialist |
| Track B: Cross-exchange arb latency | `agent-4bd5822807ad` (CCXT Pro Specialist) | ccxt/ccxt.pro + WS + latency expert |
| Track C: Kelly-opt position-sizing | `agent-5394bdd48751` (Strategy Specialist) | Strategy + backtest + risk + anti-overfit specialist |

A M2 multi-class ensemble integráció és a M3 riport az owner session (Mavis root) dolga, nem worker.

---

**Vége a briefnek. A root session a 3 track-en dolgozó worker-ek milestone reportjait várja.**
