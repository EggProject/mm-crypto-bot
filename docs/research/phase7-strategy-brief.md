# Phase 7 Brief — Edge amplification: trailing-stop + adaptive Kelly + leveraged carry

> **Szerző:** Mavis root session (mvs_c13fe65cb68f4df3851304dea09a9099)
> **Dátum:** 2026-07-04
> **Branch:** `feat/phase7-amplification` (off `feat/phase6-multi-class @ cfa5555`)
> **Trigger:** A Phase 6 multi-class ensemble +0.52%/hó empirikus eredményt hozott (96× a +50%/hó target alatt). A user explicit utasítása: „ne állj meg addig amíg a célt el nem éred, továbbra is agentekkel dolgozz". Phase 7 célja: a meglévő edge-ek amplifikálása 3 párhuzamos track-en, hogy a hozam +2-3%/hó szintre tolódjon.

---

## 0. Phase 1-6 eredmények — Phase 7 alapja

A Phase 6 riport részletezi, a lényeg:

| Phase | Best edge | Monthly return | +50%/hó verdict |
|---|---|---:|---|
| Phase 1-3 | artifact (engine buggy) | -0.71%/hó | NEM |
| Phase 4 | Mean-Reversion BB | -46.7% total | NEM |
| Phase 5 single-class (Donchian 1d) | +0.04-0.10%/hó | **+0.07%/hó** | NEM |
| Phase 6 multi-class (Donchian + Carry + Kelly) | +0.47-0.56%/hó | **+0.52%/hó** | NEM (96× short) |

**A Phase 7 célja: a +50%/hó realitásvizsgálat 4. köre.** Három párhuzamos amplifikációs track a meglévő edge-eken:

1. **Track A — Trailing-stop engine** (Phase 7 P1): Donchian 1d edge lock-in, DD 30-50% csökkentés
2. **Track B — Adaptive Kelly with rolling Sharpe** (Phase 7 P1): statikus 0.5× → dinamikus 0.25-1.0× Kelly a rolling realized Sharpe alapján
3. **Track C — Funding-carry leverage amplification** (Phase 7 P1): a carry Sharpe 9-19, low-variance — 2-5× leverage kihasználása

**Reális várakozás:** Phase 7 track-ek együttesen PROJECTED +1.5-3%/hó szintre hozhatják a rendszert (17-33× short of +50%/hó target). A +50%/hó eléréséhez **alapvetően új edge kategória** kell (options vol surface arb, MM spread, sub-10ms execution, ML on order flow) — Phase 8+ scope.

---

## 1. Phase 7 cél és scope

### 1.1 M0 — Phase 7 branch előkészítés (KÖTELEZŐ, owner session)

- **Bemenet:** `feat/phase6-multi-class @ cfa5555` (Phase 6 multi-class ensemble)
- **Output:** `feat/phase7-amplification` worktree, branch off feat/phase6-multi-class
- **Kész:** `git worktree add .worktrees/wt-phase7-amplification -b feat/phase7-amplification feat/phase6-multi-class`

### 1.2 M1 — Három párhuzamos amplifikációs track (2-3 nap)

#### M1.1 Track A: Trailing-stop engine for Donchian (Strategy Specialist)

**Cél:** A Phase 5 Donchian 1d edge PnL-jének 30-80%-os növelése trailing-stoppal, miközben a max DD 30-50%-kal csökken.

- **Input:**
  - `packages/core/src/strategy/donchian-breakout.ts` (Phase 5 C baseline)
  - `backtest-results/baseline-donchian-{btc,eth,sol}-1d.json` (Phase 5 M3 reference)
  - ATR(14) a jelenlegi stop-distance számításhoz

- **Output:**
  - `packages/core/src/strategy/donchian-trailing.ts` — kiterjesztett stratégia trailing-stoppal: high-water-mark tracking, exit when close < HWM × (1 - trailPct), ATR-alapú és fix%-os variánsok
  - `packages/core/src/strategy/donchian-trailing.test.ts` — ≥10 unit teszt (HWM update, trail trigger, edge case-k: gap-down, overnight, ATR változás)
  - `packages/backtest-tools/src/cli/run-donchian-trailing-baseline.ts` — CLI runner
  - `backtest-results/baseline-donchian-trailing-{btc,eth,sol}-1d.json` — 3 backtest JSON, 4 trailing-stop variáns (5%, 10%, 15%, ATR-2×)
  - `docs/research/phase7-trailing-stop.md` — empirikus riport, ≥5 independent source (Boring Edge, Stratbase, Arconomy trailing-stop specifikus irodalom, ATR trailing research)

- **Sikerkritérium:**
  - A trailing-stop PnL ≥ +30% a Phase 5 Donchian 1d baseline-hoz képest
  - A trailing-stop max DD ≤ 50% a Phase 5 baseline-hoz képest
  - Walk-forward anti-overfit validáció (180d IS / 30d OOS)

#### M1.2 Track B: Adaptive Kelly with rolling Sharpe (Strategy Specialist)

**Cél:** A Phase 6 statikus 0.5× Kelly sizing cseréje dinamikus, rolling 30-day realized Sharpe-alapú skálázásra.

- **Input:**
  - `packages/core/src/risk/kelly-position-sizer.ts` (Phase 6 Track C baseline)
  - `backtest-results/baseline-donchian-{btc,eth,sol}-1d.json` trade-list (Phase 5 M3)
  - Multi-class ensemble trade-list (Phase 6 M2)

- **Output:**
  - `packages/core/src/risk/kelly-adaptive.ts` — kiterjesztett Kelly: rolling 30-day realized Sharpe számítás (napi trade-ek rolling stat), Sharpe → Kelly fraction mapping (Sharpe > 1.0 → 1.0×, 0.5-1.0 → 0.7×, 0-0.5 → 0.5×, <0 → 0.25×)
  - `packages/core/src/risk/kelly-adaptive.test.ts` — ≥10 unit teszt (rolling Sharpe computation, mapping function, walk-forward split, edge case-k: insufficient history, all-loss streak)
  - `packages/backtest-tools/src/cli/run-kelly-adaptive.ts` — CLI runner
  - `backtest-results/baseline-kelly-adaptive-{btc,eth,sol}-1d.json` — 3 backtest JSON
  - `docs/research/phase7-adaptive-kelly.md` — empirikus riport, ≥5 independent source (Thorp, Vince, Poundstone kiegészítve rolling-regime detection irodalommal: Lo 2002 "Statistics of Sharpe Ratios", Bailey & López de Prado drawdown-based Kelly, Politis 2024 regime-switching)

- **Sikerkritérium:**
  - Adaptive Kelly PnL ≥ +20% a Phase 6 statikus 0.5× Kelly-hez képest
  - Walk-forward OOS Sharpe > 0 (no overfit)
  - Max DD ≤ 2× a statikus Kelly-hez képest

#### M1.3 Track C: Funding-carry leverage amplification (Crypto Expert)

**Cél:** A Phase 6 carry edge Sharpe 9-19, low-variance — 2-5× leverage alkalmazásával a carry hozam 2-5×-re skálázása, miközben a VaR kontrollált marad.

- **Input:**
  - `packages/core/src/strategy/funding-carry.ts` (Phase 6 Track A)
  - `backtest-results/baseline-funding-carry-{btc,eth,sol}-1h.json` (Phase 6 Track A reference)
  - Funding rate historikus volatilitás (Phase 6 funding CSV)

- **Output:**
  - `packages/core/src/strategy/funding-carry-leverage.ts` — kiterjesztett carry stratégia: dynamic leverage (1-5×), VaR cap (max 2% daily VaR 95% confidence), liquidation buffer (maintain 50% initial margin), leverage scaling based on funding-rate stability
  - `packages/core/src/strategy/funding-carry-leverage.test.ts` — ≥10 unit teszt (leverage calculation, VaR check, liquidation threshold, margin maintenance, edge case-k: funding spike, margin call)
  - `packages/backtest-tools/src/cli/run-funding-carry-leverage.ts` — CLI runner
  - `backtest-results/baseline-funding-carry-leverage-{btc,eth,sol}-1h.json` — 3 backtest JSON, 3 leverage variáns (1×, 2×, 3×)
  - `docs/research/phase7-carry-leverage.md` — empirikus riport, ≥5 independent source (Bybit Institutional, Binance Futures docs, MiCA margin requirements, perp-funding volatility research, delta-neutral carry with leverage practitioner guides)

- **Sikerkritérium:**
  - Leverage 2× carry PnL ≥ 1.8× a Phase 6 1× carry-hez képest (95%+ efficiency, fee/liquidation buffer levonása után)
  - Leverage 3× carry PnL ≥ 2.5× (80%+ efficiency)
  - VaR 95% confidence < 2% daily (max acceptable loss per day)
  - Zero liquidation events in 30-month backtest

### 1.3 M2 — Phase 7 multi-class ensemble V2 (1-2 nap, owner session)

A 3 track eredményeinek kombinálása új multi-class ensemble V2-be:

- **Output:**
  - `packages/core/src/strategy/multi-class-ensemble-v2.ts` — kiterjesztett ensemble: trailing-stop Donchian + adaptive Kelly sizing + leveraged carry + Phase 6 LatencyGate (zárt alapértelmezetten)
  - `packages/core/src/strategy/multi-class-ensemble-v2.test.ts` — ≥10 unit teszt
  - `packages/backtest-tools/src/cli/run-multi-class-baseline-v2.ts` — CLI runner
  - `backtest-results/baseline-multi-class-v2-{btc,eth,sol}-1d.json` — 3 ensemble JSON
  - `backtest-results/REPORT-phase7.md` — végső riport

### 1.4 M3 — Döntés a +50%/hó realitásáról (owner session)

A Phase 7 empirikus eredmények alapján egyértelmű IGEN/NEM válasz. A Phase 1-7 cumulative verdict a riport §6-ban.

---

## 2. Phase 7 NEM célja

- ❌ Teljesen új edge kategória kutatása (Phase 8+ scope: options vol surface, MM spread, ML)
- ❌ Éles multi-exchange deployment (Phase 8+ MiCAR scope)
- ❌ Több stratégia-típus tesztelése (a 3 track a Phase 7 scope)
- ❌ Tokyo co-location implementáció (Phase 8+ deployment readiness)

---

## 3. Munkafolyamat és workflow szabályok

### 3.1 Worktree struktúra

- **M0 (owner):** `wt-phase7-amplification` worktree a `feat/phase6-multi-class @ cfa5555`-ről
- **M1 (3 párhuzamos worker):** MINDEN worker a `wt-phase7-amplification` worktree-ben dolgozik, MIND a 3 track ugyanazon a branch-en (nincs sub-worktree). A track-ek fájl-határai NEM átfedők:
  - **Track A (trailing-stop):** `packages/core/src/strategy/donchian-trailing.ts`, `.test.ts`, `packages/backtest-tools/src/cli/run-donchian-trailing-baseline.ts`, `backtest-results/baseline-donchian-trailing-*.json`, `docs/research/phase7-trailing-stop.md`
  - **Track B (adaptive Kelly):** `packages/core/src/risk/kelly-adaptive.ts`, `.test.ts`, `packages/backtest-tools/src/cli/run-kelly-adaptive.ts`, `backtest-results/baseline-kelly-adaptive-*.json`, `docs/research/phase7-adaptive-kelly.md`
  - **Track C (carry leverage):** `packages/core/src/strategy/funding-carry-leverage.ts`, `.test.ts`, `packages/backtest-tools/src/cli/run-funding-carry-leverage.ts`, `backtest-results/baseline-funding-carry-leverage-*.json`, `docs/research/phase7-carry-leverage.md`
  - **Nincs átfedés** — minden track más-más fájlokat ír. Az ensemble V2 integráció (M2) az owner session dolga.

### 3.2 Implementáció → commit → push (minden track-re)

1. Implementáció a worktree-ben (stratégia + unit tesztek + CLI runner)
2. `bun install --frozen-lockfile && bun run typecheck && bun run lint && bun run test && bun run coverage` — **MIND zöld kell legyen** commit előtt
3. Backtest futtatás: `bun run packages/backtest-tools/src/cli/run-<strategy>-baseline.ts --symbol=<SYM> --timeframe=<TF> --output=backtest-results/baseline-<strategy>-<sym>-<tf>.json`
4. Commit (conventional commits, magyar summary OK):
   ```
   feat(backtest,core,backtest-tools): ÜGYNÖK Phase 7 Track <A|B|C> — <track neve>
   - <komponens>: <rövid leírás>
   - backtest eredmények: <kulcs számok>
   ```
5. Push: `git push -u origin feat/phase7-amplification`
6. **PR-t a root session nyitja** push után (mint Phase 6-ban).

### 3.3 Kutatási nyelv és mélység (KÖTELEZŐ — memory-beli user-preferencia)

- **Kutatási nyelv: kizárólag angol.** A Phase 6 baseline-t tartjuk.
- **Minimum 5-10 web query** minden track-hez, több szög.
- **Minden empirikus állításhoz ≥ 2 független forrás** idézése kötelező.
- A Phase 7 track-dokumentumok (phase7-*.md) **angol nyelvű** kutatási szekciókat tartalmazzanak; a bevezető/konklúzió magyar OK.

### 3.4 Report-back a root session-nek

Minden track milestone után (M1 track complete) küldj report-ot:
```
mavis communication send \
  --from <YOUR_SESSION_ID> \
  --to mvs_c13fe65cb68f4df3851304dea09a9099 \
  --command prompt \
  --content "PHASE 7 Track <A|B|C> COMPLETE. <részletek>"
```

### 3.5 Döntési autonómia (KÖTELEZŐ)

- A user explicit kérése: „az ügynök önállóan dönt, indokolással".
- A 3 track kiválasztása AUTONÓM: trailing-stop (Phase 6 §7 P2), adaptive Kelly (Phase 6 §7.3 enhancement), carry leverage (Phase 6 Track A amplifikáció).
- Ha a kutatás során kiderül, hogy egy track nem kivitelezhető, a worker dokumentálja és folytatja módosított tervvel.

---

## 4. Output-ok (végleges lista)

| Fájl | Tartalom | Mikor | Ki |
|------|----------|-------|----|
| `docs/research/phase7-strategy-brief.md` | Ez a fájl (root session hozta létre) | M0 | owner |
| `docs/research/phase7-trailing-stop.md` | Track A empirikus riport | M1.1 végén | Strategy Specialist |
| `packages/core/src/strategy/donchian-trailing.ts` + `.test.ts` | Track A trailing-stop implementáció | M1.1 végén | Strategy Specialist |
| `packages/backtest-tools/src/cli/run-donchian-trailing-baseline.ts` | Track A CLI runner | M1.1 végén | Strategy Specialist |
| `backtest-results/baseline-donchian-trailing-{btc,eth,sol}-1d.json` | Track A baseline JSON-ok | M1.1 végén | Strategy Specialist |
| `docs/research/phase7-adaptive-kelly.md` | Track B empirikus riport | M1.2 végén | Strategy Specialist |
| `packages/core/src/risk/kelly-adaptive.ts` + `.test.ts` | Track B adaptive Kelly | M1.2 végén | Strategy Specialist |
| `packages/backtest-tools/src/cli/run-kelly-adaptive.ts` | Track B CLI runner | M1.2 végén | Strategy Specialist |
| `backtest-results/baseline-kelly-adaptive-{btc,eth,sol}-1d.json` | Track B baseline JSON-ok | M1.2 végén | Strategy Specialist |
| `docs/research/phase7-carry-leverage.md` | Track C empirikus riport | M1.3 végén | Crypto Expert |
| `packages/core/src/strategy/funding-carry-leverage.ts` + `.test.ts` | Track C leveraged carry | M1.3 végén | Crypto Expert |
| `packages/backtest-tools/src/cli/run-funding-carry-leverage.ts` | Track C CLI runner | M1.3 végén | Crypto Expert |
| `backtest-results/baseline-funding-carry-leverage-{btc,eth,sol}-1h.json` | Track C baseline JSON-ok | M1.3 végén | Crypto Expert |
| `packages/core/src/strategy/multi-class-ensemble-v2.ts` + `.test.ts` | M2 ensemble V2 | M2 végén | owner |
| `packages/backtest-tools/src/cli/run-multi-class-baseline-v2.ts` | M2 ensemble V2 CLI | M2 végén | owner |
| `backtest-results/baseline-multi-class-v2-{btc,eth,sol}-1d.json` | M2 ensemble V2 JSON-ok | M2 végén | owner |
| `backtest-results/REPORT-phase7.md` | Végső Phase 7 riport | M2 végén | owner |
| `feat/phase7-amplification` branch | Push-olva origin-re, PR a root session által | M3 | owner |

---

## 5. Kilépési kritérium

A Phase 7 akkor zárható le, ha **MIND** az alábbi teljesül:
1. ✅ Mind a 3 track (trailing-stop, adaptive Kelly, carry-leverage) implementálva van + unit tesztek + CLI runner + baseline JSON + empirikus riport
2. ✅ A multi-class ensemble V2 (M2) integrálva van a 3 track edge-eiből + saját unit tesztek + ensemble baseline JSON
3. ✅ `bun run typecheck && bun run lint && bun run test && bun run coverage` MIND zöld
4. ✅ A REPORT-phase7.md egyértelmű IGEN/NEM választ ad a +50%/hó realitására Phase 7 szintjén
5. ✅ Branch push-olva, PR kész
6. ✅ A user felé Phase 7 szintézis: mi működik, mi nem, és a Phase 8+ scope javaslat (options vol surface, MM spread, ML alpha)

---

## 6. Stratégiai kontextus

A user explicit utasítása: „ne állj meg addig amíg a célt el nem éred". A Phase 6 riport 96×-del a +50%/hó alatti verdictje ellenére a user folytatást kért.

A Phase 7 legjobb esetben (minden track +50-100% boost) PROJECTED +1.5-3%/hó szintre hozza a rendszert, ami **17-33×-del** még mindig a +50%/hó target alatt van.

**Ha Phase 7 után is messze vagyunk, a Phase 8-nak kell:**
- Options volatility surface arb (deribit, institutional edge, +5-15%/hó projected)
- Cross-venue market-making (sub-10ms execution, +10-30%/hó projected, de 5-15% DD)
- ML on order flow (LSTM/transformer on L2 book, +3-10%/hó projected, research-only phase)
- Higher-frequency intraday strategies (5m-15m timeframe, +1-3%/hó projected)

Ezek kutatásigényesek és kevésbé validálhatók a jelenlegi 1h-1d adatbázison. Phase 8+ priorizálás a Phase 7 eredmények függvényében.

---

## 7. Agent assignment

| Track | Agent neve | Miért ő |
|-------|------------|---------|
| Track A: Trailing-stop engine | `agent-5394bdd48751` (Strategy Specialist) | Strategy + signal + risk specialist, Phase 6 Track C (Kelly) tapasztalat |
| Track B: Adaptive Kelly | `agent-5394bdd48751` (Strategy Specialist) | Same specialist — Kelly és walk-framework implementációban jártas |
| Track C: Carry leverage | `agent-c53b5725d31d` (Crypto Expert) | Market structure + funding + leverage specialist, Phase 6 Track A (funding-carry) tapasztalat |

A Track A és Track B megosztja ugyanazt a Strategy Specialist agent-ot — egymás utáni feladatok, nem párhuzamosak a specialist agent session-ön belül.

A M2 multi-class ensemble V2 integráció és a M3 riport az owner session (Mavis root) dolga.

---

**Vége a briefnek. A root session a 3 track-en dolgozó worker-ek milestone reportjait várja.**