# Live trading status

## Magyar

Az éles kereskedési aktiválás jelenleg nem elérhető. Az aktív dokumentáció és
az összes kiadott konfiguráció kizárólag papír/emulált üzemre vonatkozik.

Ez a repository szándékosan nem tartalmaz külső megbízásadási,
környezetváltási vagy privát hozzáférési értékhez tartozó folyamatot. A
nyilvános piaci adatok CCXT Pro támogatás esetén WebSocket-elsők,
REST-visszaesés engedett; ettől a rendszer nem kap éles kereskedési
jogosultságot.

Egy külön engedélyezett jövőbeli megvalósításnak kizárólag Bybit EU Spot Margin
úton, minden megbízás előtt pontosan kiválasztott és függetlenül ellenőrzött
10× tőkeáttétellel, hiba esetén zárt módon kell működnie. Ez jövőbeli
követelmény, nem jelenlegi funkció vagy engedély.

## English

Live trading activation is currently unavailable. Active documentation and all
provided configuration profiles apply only to paper/emulated operation.

This repository intentionally contains no external-order,
environment-transition, or private-access workflow. Public market data is
WebSocket-first where CCXT Pro supports it, with REST fallback permitted; this
does not authorize live trading.

A separately authorized future implementation must operate only through Bybit
EU Spot Margin, verify exactly selected 10× leverage independently before every
order, and fail closed on any error. This is a future requirement, not a
current feature or permission.
