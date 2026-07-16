/**
 * apps/web/src/lib/subscription.ts
 *
 * Phase 48B: pure subscription manager for the multi-chart grid.
 *
 * A web dashboardban minden (symbol, timeframe) chart saját BAR feedet
 * igényel a state-feedtől. Amikor a user kapcsolgatja a strategy-kat
 * (engedélyez / tilt / timeframe-t vált), a ChartGrid újra ki kell
 * számolja, mely kulcsokra kell SUBSCRIBE-ot és melyekre UNSUBSCRIBE-et
 * küldeni — ezt a `computeSubscriptionDiff` végzi tisztán, a
 * `applySubscriptionDiff` pedig az aktuális SubscriptionState-ből
 * származtatja a következőt.
 *
 * **Nincs React, nincs DOM, nincs I/O.** Minden függvény:
 *   - tiszta (pure): nincs side-effect, nincs véletlenszerűség
 *   - determinisztikus: azonos input → azonos output
 *   - null-safe: a `null` prev "első render" szemantikát jelent
 *
 * A `ChartKey` → "symbol|tf" string konverzió a belső Set lookup-okhoz
 * kell (O(1) `has()` vs. O(n) tömb-keresés). Az elválasztó karakter a
 * "|", mert a crypto szimbólumok (BTC/USDC, ETH/USDC, ...) sosem
 * tartalmaznak pipe-ot.
 *
 * A diff sorrend fontos: UNSUBSCRIBE ELŐBB, SUBSCRIBE UTÁNA. Ez a
 * "graceful detach-then-attach" minta biztosítja, hogy a state-feed
 * ne kapjon kettős tick/bar terhelést a tranziens időszakban (amikor
 * a régi feed még aktív, de az új már subscribe-olva van).
 */

/**
 * Egy (symbol, tf) chart-ot azonosít a state-feed subscribe protokollban.
 */
export interface ChartKey {
  readonly symbol: string; // "BTC/USDC"
  readonly timeframe: string; // "1h"
}

/**
 * A ChartGrid által jelenleg megjelenített chart-ok kulcsai.
 *
 * A `strategy` mező a REST `/api/strategies` endpoint válaszából
 * származik, a `charts` pedig a (symbol, timeframe) párok listája.
 */
export interface ChartGridSpec {
  readonly strategy: string;
  readonly charts: readonly ChartKey[];
}

/**
 * A state-feed subscribe/unsubscribe üzenetek típusai (tükrözik a
 * apps/bot/src/state-feed/protocol.ts protokoll üzeneteit).
 */
export type SubscriptionMessage =
  | { readonly type: "subscribe"; readonly symbol: string; readonly timeframe: string }
  | { readonly type: "unsubscribe"; readonly symbol: string; readonly timeframe: string };

/**
 * A subscription manager belső állapota.
 *
 * A `subscribed` Set azokat a kulcsokat tartalmazza, amelyekre a
 * `send()` callback-en keresztül SUBSCRIBE üzenetet küldtünk és
 * még nem kaptunk UNSUBSCRIBE-et. A `send()` callback önmagában
 * nem tart számon semmit — ez a `SubscriptionState` a single source
 * of truth.
 */
export interface SubscriptionState {
  readonly subscribed: ReadonlySet<string>; // keys: `${symbol}|${tf}`
}

/**
 * `chartKeyToString` — ChartKey → "symbol|tf" string reprezentáció.
 * Belső használatra, a Set gyors lookup-hoz.
 *
 * Az elválasztó a `|`, mert a crypto szimbólumok (BTC/USDC, ...)
 * sosem tartalmaznak pipe-ot — így a konverzió invertálható.
 */
export function chartKeyToString(key: ChartKey): string {
  return `${key.symbol}|${key.timeframe}`;
}

/**
 * `chartKeyFromString` — "symbol|tf" → ChartKey.
 *
 * A "|" karakter az elválasztó. Ha nincs "|" a stringben, `null` a
 * visszatérési érték (a string nem egy érvényes kulcs-reprezentáció).
 *
 * **Élő esetek:**
 *   - "BTC/USDC|1h" → { symbol: "BTC/USDC", timeframe: "1h" }
 *   - "BTC/USDC|"   → { symbol: "BTC/USDC", timeframe: "" }
 *   - "|1h"         → { symbol: "", timeframe: "1h" }
 *   - "no-pipe"     → null
 *   - ""            → null
 */
export function chartKeyFromString(s: string): ChartKey | null {
  const idx = s.indexOf("|");
  if (idx === -1) return null;
  return { symbol: s.slice(0, idx), timeframe: s.slice(idx + 1) };
}

/**
 * `computeSubscriptionDiff` — két ChartGridSpec (előző + jelenlegi)
 * alapján kiszámolja a SUBSCRIBE és UNSUBSCRIBE üzenetek listáját.
 *
 * **Algoritmus:**
 *   1. Készíts egy Set-et az előző + jelenlegi kulcsokból.
 *   2. A jelenlegiben lévő, de az előzőben NEM lévő kulcsok → SUBSCRIBE
 *   3. Az előzőben lévő, de a jelenlegiben NEM lévő kulcsok → UNSUBSCRIBE
 *
 * **Sorrend:** UNSUBSCRIBE először (a prev listában megjelenő sorrendben),
 * aztán SUBSCRIBE (a current listában megjelenő sorrendben). Ez a
 * "graceful detach-then-attach" minta.
 *
 * **Edge case-ek:**
 *   - null prev (első render) → csak SUBSCRIBE (minden current kulcsra)
 *   - üres current (minden chart eltűnt) → csak UNSUBSCRIBE (minden prev kulcsra)
 *   - azonos prev + current → üres tömb
 *   - prev/current duplikátum kulcsok → dedup (Set-based), az első
 *     előfordulás sorrendje marad meg
 */
export function computeSubscriptionDiff(
  prev: readonly ChartKey[] | null, // null = "nincs korábbi állapot"
  current: readonly ChartKey[],
): readonly SubscriptionMessage[] {
  // Belső Set-ek az O(1) lookup-hoz.
  const prevSet = new Set<string>();
  if (prev !== null) {
    for (const k of prev) {
      prevSet.add(chartKeyToString(k));
    }
  }
  const currentSet = new Set<string>();
  for (const k of current) {
    currentSet.add(chartKeyToString(k));
  }

  const messages: SubscriptionMessage[] = [];

  // UNSUBSCRIBE ELŐBB — a prev listában megjelenő sorrendben.
  // Dedup: ha a prev tartalmaz egy kulcsot többször, csak egyszer
  // küldünk UNSUBSCRIBE-et. Az `alreadyUnsubbed` Set biztosítja,
  // hogy a dedup ne rontsa el a sorrendet.
  if (prev !== null) {
    const alreadyUnsubbed = new Set<string>();
    for (const k of prev) {
      const keyStr = chartKeyToString(k);
      if (alreadyUnsubbed.has(keyStr)) continue;
      alreadyUnsubbed.add(keyStr);
      if (!currentSet.has(keyStr)) {
        messages.push({
          type: "unsubscribe",
          symbol: k.symbol,
          timeframe: k.timeframe,
        });
      }
    }
  }

  // SUBSCRIBE MÁSODSZOR — a current listában megjelenő sorrendben.
  // Dedup: ha a current tartalmaz egy kulcsot többször, csak egyszer
  // küldünk SUBSCRIBE-et.
  const alreadySubbed = new Set<string>();
  for (const k of current) {
    const keyStr = chartKeyToString(k);
    if (alreadySubbed.has(keyStr)) continue;
    alreadySubbed.add(keyStr);
    if (!prevSet.has(keyStr)) {
      messages.push({
        type: "subscribe",
        symbol: k.symbol,
        timeframe: k.timeframe,
      });
    }
  }

  return messages;
}

/**
 * `applySubscriptionDiff` — egy kezdeti SubscriptionState + üzenetlista
 * alapján visszaadja az új SubscriptionState-et.
 *
 * **Pure:** nem módosítja a bemeneti state-et, új Set-et épít.
 *
 * **Hibakezelés:**
 *   - `subscribe` üzenet hozzáadja a kulcsot (Set idempotens: ha már
 *     benne van, akkor is "benne van", nincs duplicate).
 *   - `unsubscribe` üzenet eltávolítja. Ha a kulcs NINCS benne, az
 *     csendben sikeres (Set.delete() `false`-szal tér vissza, de nem
 *     dob hibát — így a dupla-UNSUBSCRIBE nem crashel).
 */
export function applySubscriptionDiff(
  state: SubscriptionState,
  messages: readonly SubscriptionMessage[],
): SubscriptionState {
  const next = new Set(state.subscribed);
  for (const m of messages) {
    const keyStr = `${m.symbol}|${m.timeframe}`;
    if (m.type === "subscribe") {
      next.add(keyStr);
    } else {
      next.delete(keyStr);
    }
  }
  return { subscribed: next };
}

/**
 * `initialSubscriptionState` — üres SubscriptionState.
 *
 * A `send()` callback hívása előtt ezt kell használni a kezdeti
 * állapothoz a useRef init-hez:
 *
 *   const subStateRef = useRef(initialSubscriptionState());
 */
export function initialSubscriptionState(): SubscriptionState {
  return { subscribed: new Set<string>() };
}
