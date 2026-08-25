# Bot operator guide

## Magyar

Az `@mm-crypto-bot/bot` aktív kezelési felülete papír/emulált üzemre szolgál.
Az összes repositoryban kiadott profil `mode = "paper"`; a futás nem jogosít
fel éles megbízásra.

### Konfiguráció ellenőrzése és papír futás

```sh
bun run apps/bot/src/index.ts config validate --config=run-bot/config/default.toml
bun run apps/bot/src/index.ts start --config=run-bot/config/default.toml
```

Választható profilok:

- `run-bot/config/default.toml`: alapértelmezett papír/emulált profil.
- `run-bot/config/paper-backtest-optimized.toml`: auditált jelöltprofil.
- `run-bot/config/paper-backtest-verified.toml`: backtesthez igazított profil.

A nyilvános piaci adatfolyam CCXT Pro támogatás esetén WebSocket-első; REST
visszaesés megengedett. Hálózati vagy adathiba nem ad felhatalmazást éles
kereskedésre.

Az éles aktiválás nem elérhető, ezért ez az útmutató nem tartalmaz külső
megbízásadási, környezetváltási vagy privát hozzáférési értékhez tartozó lépést.
Jövőbeli, külön engedélyezett éles úton minden Bybit EU Spot Margin
megbízásnak pontosan kiválasztott és ellenőrzött 10× tőkeáttételt kell
igazolnia.

## English

The active `@mm-crypto-bot/bot` operator surface is paper/emulated only. All
repository-provided profiles use `mode = "paper"`; running one does not permit
live orders.

```sh
bun run apps/bot/src/index.ts config validate --config=run-bot/config/default.toml
bun run apps/bot/src/index.ts start --config=run-bot/config/default.toml
```

Public market data is WebSocket-first where CCXT Pro supports it, with REST
fallback permitted. Live activation is unavailable, so this guide deliberately
has no external-order, environment-transition, or private-access workflow. A
future separately authorized Bybit EU Spot Margin path must verify exactly
selected 10× leverage before every order.
