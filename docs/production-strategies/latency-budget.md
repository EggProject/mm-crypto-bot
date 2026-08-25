# Paper data latency budget

## Magyar

Ez a dokumentum kizárólag papír/emulált futások nyilvános piaci adatainak
mérésére szolgál. Nem ad éles telepítési vagy megbízásadási útmutatót.

### Adatútvonal

1. CCXT Pro támogatás esetén a piaci adat WebSocket-első.
2. REST-visszaesés megengedett, ha a WebSocket-adat nem használható.
3. A futás minden adatkimaradást, késést és újracsatlakozást strukturáltan
   rögzítsen; az eredményeket ne értelmezze végrehajtási teljesítményként.

### Mérési keret

Rögzítsd az érkezési időt, feldolgozási időt, forrást és az egymást követő
üzenetek közti eltérést UTC-ben. A p50/p95/p99 értékek csak az adott papír
futás megfigyelései; nem célértékek és nem hozam- vagy végrehajtási ígéretek.

| Szakasz                | Mért jel                                     |
| ---------------------- | -------------------------------------------- |
| Piaci adat érkezése    | forrás, UTC érkezési idő, üzenet-sorrend     |
| Stratégia feldolgozása | feldolgozási idő és hibastátusz              |
| Újracsatlakozás        | kiesés kezdete, vége és helyreállási állapot |

Az éles aktiválás jelenleg nem elérhető. Egy későbbi, külön engedélyezett
Bybit EU Spot Margin megvalósításnak pontosan kiválasztott és ellenőrzött 10×
tőkeáttételt kell alkalmaznia minden megbízás előtt; ez nem része ennek a
papír adatmegfigyelési útmutatónak.

## English

This document measures public market-data latency for paper/emulated runs only.
It provides no live-deployment or order-placement workflow.

### Data path

1. Use WebSocket-first public market data where CCXT Pro supports it.
2. REST fallback is permitted when WebSocket data is unavailable.
3. Record gaps, delays, and reconnects structurally; do not interpret the
   result as execution performance.

Record UTC arrival and processing times, source, and inter-message gaps.
Observed p50/p95/p99 values describe only that paper run; they are neither
targets nor promises of returns or execution. Live activation is unavailable.
A future separately authorized Bybit EU Spot Margin implementation must verify
exactly selected 10× leverage before every order.
