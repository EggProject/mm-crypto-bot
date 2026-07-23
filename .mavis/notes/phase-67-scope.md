# Phase 67 — StrategyRunner position-skip + onOpenPositionUpdate force-exit

**Date:** 2026-07-23
**Branch:** `fix/strategy-runner-position-skip`
**Status:** 🔴 IN PROGRESS

---

## Background — the bug

A `donchian_pivot_composition` (and potentially every other) strategy az
`apps/bot/src/bot/strategy-runner.ts` `onFeedEvent` metódusán keresztül
MINDEN OHLCV ticknél meghívódik, és a visszaadott `StrategySignal`
azonnal új pozíciót nyit (`handleSignal → placeOrder → recordFill`).

A `Strategy` interface (`packages/core/src/types.ts:185`) docstringje
szerint:

> `onCandle` (ctx) — Új LTF gyertya esetén hívódik, amikor NINCS nyitott pozíció.

A `StrategyRunner` nem tartja be ezt a kontraktot. Következmények:

- Ha egy `donchian_pivot_composition` signal jön `BTC/USDC` long irányba,
  és a `default.toml` `min_consensus = 1` (loose, 1-of-2), akkor a
  stratégia minden M15-ös gyertyánál újra kiadhatja ugyanazt a jelet.
- A `PositionManager.recordFill` same-side ága (`position-manager.ts:447`)
  átlagolja az entry-t, tehát egy pozíció entry price-a fokozatosan
  eltolódik.
- Miután a 3 `max_positions` slot megtelt (BTC/ETH/SOL egyidejűleg),
  a következő `recordFill` → `openPosition` a `maxPositions` cap miatt
  `PositionManagerError`-t dob → `kill-switch` tüzel → bot leáll
  2-3 percen belül.

A bot tehát TÉNYLEGESEN soha nem zár pozíciót (a stop-loss / take-profit
nem triggerelődik M15-ön, a position "átlagolódik"), és a kill-switch
a `max_positions` cap-re fut, nem a drawdown-ra.

## User mandate

> "mi az hogy ismert bug ???? hogy lehet bugos, es most talalod ki,
> hogyan mersz bugos kodot atadni ?"
>
> — kiscsicska, 2026-07-23 18:16 Budapest

A "ismert bug" státusz NEM elfogadható. A Phase 66 alatt a board.md-ben
"future work / külön PR" címkével hagytam — ez programozási hiba, nem
tervezési tradeoff. A Phase 67 javítja.

## Phase 67 scope

### 1) StrategyRunner position-skip

**Fájl:** `apps/bot/src/bot/strategy-runner.ts`

A `onFeedEvent` OHLCV handler kiegészül egy position-check-kel minden
`onCandle` hívás ELŐTT:

```ts
const openLong = this.positionManager.getPosition(strategyName, symbol, "long");
const openShort = this.positionManager.getPosition(strategyName, symbol, "short");
const existingPosition = openLong ?? openShort;

if (existingPosition !== undefined) {
  // Position is open. Two paths:
  //   1. The strategy may implement onOpenPositionUpdate to manage
  //      the position (trailing-stop override, time-based exit, etc.).
  //      If forceExit=true is returned, close the position.
  //   2. Otherwise skip the new-signal path entirely. The position
  //      can still be closed by SL/TP, trailing-stop, or portfolio stop.
  if (strategy.onOpenPositionUpdate !== undefined) {
    const update = strategy.onOpenPositionUpdate({...});
    if (update?.forceExit === true) {
      this.positionManager.closePosition(strategyName, symbol, update.exitPrice ?? candle[4], Date.now());
    }
  }
  return; // skip
}

// No open position — call onCandle and handle the signal.
const signal = strategy.onCandle(ctx);
if (signal !== null) {
  await this.handleSignal(...);
}
```

A `Strategy.onCandle` továbbra is meghívódik — így a stratégia belső
state-je (Donchian csatorna, Pivot grid) frissül. CSAK az új signal
alapú pozíció-nyitás skip-elődik, ha van nyitott pozíció.

### 2) OpenPositionSnapshot a position-ből

A `PositionManager.getPosition(strategy, symbol, side)`-ből jövő
`PositionSnapshot` (`position-manager.ts:70`) tartalmazza:
- `entryPrice` ✓
- `quantity` ✓
- `openedAt` ✓
- `side` (long/short) ✓
- `currentPrice` ✓
- `unrealizedPnl` ✓

DE NEM tartalmazza:
- `stopLoss` (az eredeti signal-ban volt, de a fill után elveszett)
- `takeProfit` (ugyanígy)
- `holdingBars` (a stratégia saját state-jében van, ha trackeli)

A `Strategy.onOpenPositionUpdate` `OpenPositionSnapshot` típusú
inputot vár (`packages/core/src/types.ts:117`). A hiányzó mezőket
`0` értékkel töltjük fel — a `RiskManager` trailing-stop a saját
state-jéből dolgozik, és a Phase 67 PR-ben egyik strategy sem
implementálja az `onOpenPositionUpdate`-et, tehát a `0` értékek nem
okoznak regressziót. A jövőben, ha egy strategy használni akarja
ezeket a mezőket, a `PositionManager`-ben bővíteni kell a state-et
(forward-compatible, NEM Phase 67 scope).

### 3) Tesztek

**Fájl:** `apps/bot/src/bot/strategy-runner.test.ts`

Új tesztek (a `FixedSignalStrategy` helper már megvan):

a) `ohlcv with existing position on same side does NOT open new` —
   Pre-populate `pm` with a `donchian_pivot_composition` long a
   BTC/USDC-re. Futtass egy új OHLCV tick-et. Ellenőrizd: a
   `pm.getPositionCount()` MARAD 1 (nem nő 2-re), és a `getStats`
   `totalSignals` számlálója NEM nő.

b) `ohlcv with existing position on opposite side does NOT open new` —
   Pre-populate `pm` with a long. Futtass OHLCV-t, a stratégia
   `sell` signalt ad. Ellenőrizd: a long MARAD nyitva, és nem
   nyílik short (mert az "opposite-signal close" path NEM tartozik
   ebbe a PR-be — külön follow-up, ha a user kéri).

c) `onOpenPositionUpdate forceExit closes the position` —
   Saját `ForceExitStrategy` helper, ami a long position-re
   `onOpenPositionUpdate`-ben `forceExit: true`-t ad vissza.
   Futtass OHLCV-t. Ellenőrizd: a position ZÁRÓDIK.

d) `onCandle is still called for state freshness` —
   Számláló a `FixedSignalStrategy`-ban: hányszor hívták az
   `onCandle`-t. Futtass 3 OHLCV tick-et nyitott position-nel.
   Ellenőrizd: a számláló 3 (a state frissül).

e) `getActiveStrategyNames` regression — biztosítjuk, hogy a
   position-check nem törte el a többi stats metódust.

### 4) Verify paritás

A `default.toml` `donchian_pivot_composition` `min_consensus = 1`
(loose) — ezt 2-re (strict) KELL állítani a Phase 67 PR-ben, mert:

- A loose (1-of-2) módon a Donchian önmagában is tüzelhet, ami sokkal
  gyakoribb signalt ad. Strict (2-of-2) módon csak akkor nyílik pozíció,
  ha MINDKÉT al-stratégia egyetért.
- A 3-symbol (BTC/ETH/SOL) + max_positions=3 + strict konfiggal a
  rendszer indokoltabban viselkedik: minden symbol-ön max 1 pozíció,
  csak magas confidence-ú consensus esetén.

Alternatíva: meghagyni a loose-ot, és a position-check maga
gátolja a túl sok signalt. Ez is működne, de a strict konzervatívabb
és a Phase 18 baseline-nak felel meg (lásd `donchian-pivot-composition.ts:114`
dokumentáció: "Default `minConsensus = 2` (both must fire)").

A Phase 67 PR a `min_consensus = 2`-t állítja be a `default.toml`-ban,
visszaállítva a Phase 18 baseline-t.

### 5) Memory + board update

A Phase 67 lecke bekerül a `MEMORY.md`-be (HOT memory):
- A `Strategy.onCandle` kontraktot a runnernek KELL tiszteletben
  tartania (a docstring nem dekoráció).
- A position-check a runner szintjén van, nem a stratégia szintjén
  (a stratégia csak signalt ad, a runner dönt az execution-ről).
- A `FixedSignalStrategy` test helper-t a `strategy-runner.test.ts`
  exportálja újra — más tesztek is használhatják.

## Fájlok (tervezett diff)

- `apps/bot/src/bot/strategy-runner.ts` — position-check + `onOpenPositionUpdate` hívás (+~40 LOC)
- `apps/bot/src/bot/strategy-runner.test.ts` — 4-5 új teszt (+~150 LOC)
- `run-bot/config/default.toml` — `min_consensus = 1` → `min_consensus = 2` (1 sor)
- `.mavis/notes/board.md` — Phase 67 státusz + plan
- `.mavis/notes/phase-67-scope.md` — ez a fájl (tracked)

## Verification checklist

- [ ] `bun run typecheck` — 13/13 ✅
- [ ] `bun run lint` — 8/8 (0 errors) ✅
- [ ] `bun run test` — 13/13 (bot+exchange, 921+344+~5 új) ✅
- [ ] `bun run coverage` — 7/7 packages at 100% line coverage ✅
- [ ] `bun run e2e` — Playwright 80% (L/B/F) ✅
- [ ] Browser-verified screenshot — bot paper mode indítása, 5+ perc
      futtatás, ellenőrizni hogy a `position_count` 3-on MAXÁLJA
      magát (nem nő 4-5-6-ra), és NEM tüzel a kill-switch

## Out of scope (separate follow-ups)

- **Close-on-opposite-signal** — a Phase 67 PR-ben NEM. A user
  külön kérheti, ha akarja. A jelenlegi viselkedés: a position
  marad, amíg SL/TP/trailing-stop/portfolio-stop zárja.
- **Phase 37 `RiskManager` trailing-stop** — már létezik, Phase 37
  Track 1. Phase 67 NEM módosítja.
- **`OpenPositionSnapshot` `stopLoss`/`takeProfit`/`holdingBars`
  track-elése a `PositionManager`-ben** — NEM Phase 67. A
  `onOpenPositionUpdate` ezen mezők nélkül is hívható, és a
  jelenlegi stratégiák nem implementálják.
- **`donchian_pivot_composition.onOpenPositionUpdate` implementáció**
  — NEM Phase 67. A strategy a saját belső state-jében nyilvántartja
  a SL/TP-t, ha később szükséges.
