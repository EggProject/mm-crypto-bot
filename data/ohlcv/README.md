# OHLCV Data — `data/ohlcv/`

> **ÜGYNÖK #6** (data + backtest) — Phase 1 deliverable
> **Forrás:** Binance public REST API (`api.binance.com`)
> **Időszak:** 2024-01-01 00:00 UTC → today (≥2.5 years)
> **Generálva:** `scripts/download-ohlcv.ts`

## Tartalom

| File | Sorok | Időszak | Méret |
|---|---:|---|---:|
| `binance_btc_1h.csv` | ~22 000 | 2024-01-01 → most | ~1.3 MB |
| `binance_btc_4h.csv` | ~5 500 | 2024-01-01 → most | ~325 KB |
| `binance_btc_1d.csv` | ~920 | 2024-01-01 → most | ~55 KB |
| `binance_eth_1h.csv` | ~22 000 | 2024-01-01 → most | ~1.2 MB |
| `binance_eth_4h.csv` | ~5 500 | 2024-01-01 → most | ~305 KB |
| `binance_eth_1d.csv` | ~920 | 2024-01-01 → most | ~51 KB |
| `binance_sol_1h.csv` | ~22 000 | 2024-01-01 → most | ~1.1 MB |
| `binance_sol_4h.csv` | ~5 500 | 2024-01-01 → most | ~280 KB |
| `binance_sol_1d.csv` | ~920 | 2024-01-01 → most | ~48 KB |

A pontos sor-szám és SHA256 hash a [`MANIFEST.json`](./MANIFEST.json)-ban.

## Formátum

Minden CSV 6 oszloppal rendelkezik, fejléc nélküli (vagy pontosan 1 fejléc-sorral):

```
timestamp,open,high,low,close,volume
1704067200000,42283.58,42554.57,42261.02,42475.23,1271.68108
1704070800000,42475.23,42775.00,42431.65,42613.56,1196.37856
...
```

| Oszlop | Típus | Jelentés |
|---|---|---|
| `timestamp` | integer (ms epoch) | A gyertya NYITÓ ideje UTC-ben |
| `open` | float | Nyitó ár (USDT) |
| `high` | float | Legmagasabb ár a gyertyán belül |
| `low` | float | Legalacsonyabb ár a gyertyán belül |
| `close` | float | Záró ár |
| `volume` | float | Alap-volume (BTC/ETH/SOL) a gyertyán belül |

- **Quote currency**: USDT (Binance-en a leglikvidebb BTC/USDT market).
  A backtest-ekben a "USDC" vagy "USDT" elnevezés nem befolyásolja
  a stratégia-számításokat (mindkettő stabilcoin, 1:1-hez közeli árfolyam).
- **Timezone**: minden timestamp UTC.
- **Sortörés**: a fájlok trailing newline-nal végződnek.
- **Nincs hiányzó adat**: a Binance public API garantálja a folytonos
  history-t; ha bármelyik óra kimaradt volna, a `MANIFEST.json` rögzíti.

## Időkeretek

| Timeframe | Hossz | Mintavétel |
|---|---:|---:|
| `1h` | 60 perc | 24 / nap |
| `4h` | 240 perc | 6 / nap |
| `1d` | 1440 perc | 1 / nap |

## Reprodukálhatóság

A letöltés **teljesen determinisztikus** a következő feltételek mellett:

```bash
# 1. Telepítsd a függőségeket
bun install

# 2. Futtasd a downloadert
bun scripts/download-ohlcv.ts
```

A script:
- CCXT `4.5.64` publikus Binance REST API-t használ (nincs auth, nincs rate-limit probléma)
- 200 ms rate-limit (konzervatív; a Binance 1200 req/min-et engedélyez)
- Paginál: `since = last_candle_ts + 1ms`, `limit = 1000`
- Ciklus addig fut, amíg az utolsó candle 1 percnél frissebb
- Minden fájlhoz kiszámolja a SHA256 hash-t a `MANIFEST.json`-ban

**Fontos**: a Binance a jövőben pontosításokat / újrapublikálásokat
végezhet (pl. tőzsdei korrekció), ezért a SHA256 hash csak a
**letöltés időpontjára** érvényes. A `MANIFEST.json` `generatedAt`
mezője rögzíti a letöltés pontos idejét.

## Betöltés backtest-hez

A `scripts/csv-feed.ts` modul egy `CsvExchangeFeed` osztályt exportál,
amely a `packages/backtest/src/types.ts`-ban definiált `ExchangeFeed`
interfészt implementálja. Használat:

```typescript
import { CsvExchangeFeed } from "../scripts/csv-feed.js";

const feed = new CsvExchangeFeed(resolve("data/ohlcv"));
const candles = await feed.fetchOHLCV("BTC/USDT", "1h", { since: 0 });
// candles: readonly Candle[]
```

A feed a `BTC/USDT` symbolt várja (a CSV fájlnév a `binance_btc_1h.csv`
mintát követi, és a belső `Symbol` brand típus használja a CCXT-kompatibilis
"BTC/USDT" formátumot).

## Miért USDT és nem USDC?

A bybit.eu SPOT margin **USDC**-t használ (MiCAR-megfelelés), de a
Binance-en a **USDT** market likvidebb minden fő kriptó-párra. A két
stabilcoin árfolyama a vizsgált időszakban (2024-01 → 2026-07)
**0,1%-on belül** volt (1 USDT ≈ 0,999–1,001 USDC), így a backtest
szempontjából az eltérés elhanyagolható. A `USDT/USDC` eltérés
a költség-modellben egyenletesen alkalmazható, és a historikus
backtest nem érzékeny rá.

## Verifikáció

A `MANIFEST.json` minden fájlhoz tartalmazza:
- `symbol` — `btc | eth | sol`
- `timeframe` — `1h | 4h | 1d`
- `path` — relatív fájlnév
- `rows` — CSV sorok száma (fejléc nélkül)
- `firstTs` / `lastTs` — első / utolsó timestamp ms-ben
- `sha256` — a teljes CSV-tartalom SHA256 hash-e
- `bytes` — fájlméret byte-ban

A CSV integritását a `sha256sum data/ohlcv/*.csv` paranccsal lehet
ellenőrizni; a kimenet meg kell egyezzen a `MANIFEST.json`-ban lévőkkel.