# mm-crypto-bot

## Magyar

Ez egy Bun/Turbo monorepo több stratégia és instrumentum papír/emulált
kereskedési vizsgálatához. Az aktív konfigurációk kizárólag `paper` módúak.

Az éles aktiválás jelenleg nem elérhető. Ez a repository nem ad éles indítási,
előléptetési vagy hitelesítőadat-beállítási utasítást. Egy későbbi, külön
engedélyezett éles megvalósításnak Bybit EU Spot Margin környezetben minden
megbízás előtt pontosan kiválasztott és ellenőrzött 10× tőkeáttételt kell
igazolnia; ez követelmény, nem jelenlegi engedély.

### Paper ellenőrzés

```sh
bun run apps/bot/src/index.ts config validate --config=run-bot/config/default.toml
bun run apps/bot/src/index.ts start --config=run-bot/config/default.toml
```

| Profil                                         | Rendeltetés                          |
| ---------------------------------------------- | ------------------------------------ |
| `run-bot/config/default.toml`                  | Alapértelmezett papír/emulált futás  |
| `run-bot/config/paper-backtest-optimized.toml` | Auditált backtest-jelölt papírprofil |
| `run-bot/config/paper-backtest-verified.toml`  | Backtesthez igazított papírprofil    |

A nyilvános piaci adatkapcsolat CCXT Pro támogatás esetén WebSocket-első;
REST-visszaesés és papír/emulált mód megmaradhat. Ez nem jelent kereskedési
engedélyt vagy teljesítményígéretet.

További aktív útmutatók: [bot kezelése](./apps/bot/README.md),
[éles állapot](./docs/LIVE-TRADING.md) és
[késleltetés megfigyelése](./docs/production-strategies/latency-budget.md).

## English

This Bun/Turbo monorepo supports paper/emulated investigation of multiple
strategies and instruments. Every active profile uses `paper` mode.

Live activation is currently unavailable. This repository intentionally
contains no workflow for external order submission, environment transition, or
private access values. A future, separately authorized live implementation must
verify an exactly selected 10× leverage before every Bybit EU Spot Margin order;
that is a requirement, not a current permission.

### Paper verification

```sh
bun run apps/bot/src/index.ts config validate --config=run-bot/config/default.toml
bun run apps/bot/src/index.ts start --config=run-bot/config/default.toml
```

Public market data is WebSocket-first where CCXT Pro supports it. REST fallback
and paper/emulated operation may remain available. Neither grants trading
authorization or promises performance.
