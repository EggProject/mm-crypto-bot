# Phase 4 Brief — Agresszív stratégia-kutatás (100%/hó realitásvizsgálat)

> **Szerző:** ÜGYNÖK #6 (orchestrator: Mavis root)
> **Dátum:** 2026-07-03
> **Trigger:** Phase 1-3 baseline mérések — a `MtfTrendConfluenceStrategy v1.0` 30 hónap alatt mindössze 4 trade-et generált, MIND vesztes, teljes hozam −0.71% / 0% (BTC 1h, ETH 1h, BTC 4h, BTC 1d, SOL 1h).

## 1. Kiinduló helyzet

A `docs/research/strategy-decision.md` (PR #8) 8 stratégiát hasonlított össze, és azt a (részben konzervatív) konklúziót vonta le, hogy **a +100%/hó nem érhető el ésszerű kockázattal a bybit.eu SPOT 1:10-en**. A user ezt a konklúziót VISSZAUTASÍTOTTA:

> „felejtsük el az interneten irt nem lehet, ne vicceljünk 1:10 -hez spot marginon miert ne lehetne? Pont ez a cel hogy elerd, ha kezi kereskedessel elerheto akkor gepi-vel is! rugaszkodj el attol amit irnak csak csinald csinald csinald keresd a lehetosegeket es technikakat es osszefuggeseket es talald meg a celhoz vezeto utat."

A Phase 1-3 baseline MÁR NEM ELMÉLETI — empirikus adat. A kiválasztott MTF-TKC v1.0 konkrétan a saját historikus adatainkon **−0.71%-os** hozamot produkált 30 hónap alatt, közel 0 trade-dzsel. A user kérésére a Phase 4 kutatásnak ezt az empirikus limitációt KELL megcáfolnia alternatív stratégia-típusokkal.

## 2. A Phase 4 célja

Egy vagy több **alternatív stratégia-típus** azonosítása, implementálása és tesztelése, amelyik — a Phase 4-es mérések alapján — **reálisan megközelíti a +100%/hó célt** a bybit.eu SPOT 1:10 margin-en. A kutatás NEM a konzervatív kutatási default-okra épít, hanem a Phase 1-3 baseline empirikus limitációit oldja fel.

## 3. A Phase 4 három mérföldköve

### 3.1 M1 — Stratégia-típus szűkítés (1-2 nap)

Az alábbi 8 irányból VÁLASZTUNK 2-3-at, amelyeket érdemes implementálni és letesztelni. Mindegyiknél meg kell adni:

- **Milyen piaci környezetben működik** (trend/range, volatilis, illiquid, stb.)
- **Várható trigger-arány** (hány trade / hó / symbol)
- **Várható win-rate** (a konzervatív kutatás default-jaitól ELTÉRŐ becslés)
- **Konkrét implementációs terv** (indikátorok, entry/exit, position-sizing)
- **A bybit.eu SPOT 1:10-re való alkalmazhatóság** (a margin-kamat, fee-drag, borrowing-limit korlátait hogyan kezeli)

A 8 jelölt:
1. **Always-in trend-following** — EMA50/200 crossover, mindig benntartott pozíció, nincs kivárás
2. **Volatility breakout** — Donchian-channel / ATR-szerű gyors break-out + re-entry
3. **Funding rate carry / cross-exchange arb** — perpetual-spot szintetikus, vagy binance↔bybit.eu eltérés kihasználása
4. **Basket of small high-probability signals** — sok kis edge, 0.3-0.5% risk/trade, 50-100 trade/hó
5. **Agresszív mean reversion (5m, 15m)** — Z-score visszatérés, sok trade
6. **News / social velocity** — Twitter/social gyorshajtás news-ra
7. **Grid trading / scalping 1:10 margin-en** — tight range, sok kis trade
8. **Multi-strategy ensemble** — a fentiek kombinációja, kockázat allokálva

### 3.2 M2 — Implementáció (2-3 nap)

A kiválasztott 2-3 stratégia közül a legígéretesebb(ek) teljes implementációja a `packages/core/src/strategy/` mappában, plusz unit-tesztek és integrációs tesztek. A backtest motor (az engine.ts) már kész, csak a `Strategy` interfészt kell megvalósítani.

### 3.3 M3 — Mérés és riport (1-2 nap)

A kiválasztott stratégia(k) teljesítése a Phase 1-es OHLCV adatokon (BTC/ETH/SOL × 1h/4h/1d, 2024-01 → 2026-07), riport a `backtest-results/REPORT.md` fájlba. A riportnak tartalmaznia kell:
- A Phase 4 stratégia havi hozamát az MTF-TKC baseline-hoz hasonlítva
- A 100%/hó realitásvizsgálat egyértelmű IGEN/NEM választ
- Amennyiben IGEN: a szükséges position-sizing-ot, a várható drawdown-t, és a backtest korlátait (look-ahead, overfitting, stb.)
- Amennyiben NEM: a Phase 4 végén is MILYEN hozam érhető el reálisan, és a terv hogyan adaptálódik

## 4. A Phase 4 NEM célja

- ✅ A konzervatív kutatási konklúziók általános cáfolata a világhálón
- ✅ A fee-drag vagy a margin-kamat hatásainak átértékelése (ezek adottak)
- ✅ Az ÜGYNÖK #5 (strategy-decision.md) általános lebecsülése
- ✅ A backtest motor újratervezése

## 5. Output-ok

- `docs/research/phase4-strategy-selection.md` — az M1 kiválasztás dokumentálása
- `packages/core/src/strategy/<new-strategy>.ts` — a kiválasztott stratégia(k) implementációja
- `packages/core/src/strategy/<new-strategy>.test.ts` — unit-tesztek
- `backtest-results/baseline-<strategy>-<tf>.json` — az új baseline-ok adatszerkezetben
- `backtest-results/REPORT.md` (felülírás) — a végső riport az M3 mérföldkő után

## 6. Kilépési kritérium

A Phase 4 akkor zárható le, ha:
1. A kiválasztott stratégia(k) implementálva vannak
2. A backtest futásprodukál ≥ 30 trade / 30 hónap / symbol szintű jelet (elegendő statisztikai értelmezhetőséghez)
3. A riport világos IGEN/NEM választ ad a +100%/hó realitására
4. A kód typecheck + lint + tesztek PASS státuszban van

Ha a Phase 4 végén a válasz NEM, a tervet a dokumentáltan elérhető havi hozamra kell újraszabni — NEM a konzervatív kutatási default-ok alapján csökkenteni, hanem a mért empirikus szinten.
