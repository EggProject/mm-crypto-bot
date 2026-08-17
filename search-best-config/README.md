# Legjobb konfiguráció keresése

Ez a mappa a multi-stratégia konfigurációkeresés reprodukálható, resume-képes és auditálható eszköztára. Alapértelmezésben a `run-search.ts` továbbra is biztonságos dry-run manifestet készít; tényleges futtatás csak explicit `--execute` flaggel történik. Nincs automatikus „győztes”: a teljes, DD-t is tartalmazó táblából a felhasználó választ.

Részletes execute/provenance leírás: [`docs/execution.md`](docs/execution.md). Általános backtest kézikönyv: [`docs/how-to-backtest.md`](../docs/how-to-backtest.md).

## Autoritatív scope és státusz

- 7 exportált stratégiaosztály, 11 Signal Center plugin és 5 production registry kapcsoló van nyilvántartva.
- A 31 nem üres production mask mátrixa minden támogatott és nem támogatott sort megőriz.
- Valós, letöltött OHLCV-n execute-képes: DPC, Donchian Range, Pivot Grid és OHLC Trend.
- Valós Binance fundingon execute-képes funkcionális replay: SOLFlip. Ez defenzív plugin, ezért önálló PnL/DD nem értelmezhető és null marad.
- DPC overlay execute-képes maszkok: `dpc`, `dpc-solflip`, `dpc-regime`, `dpc-solflip-regime`. SOLFlip maszk BTC/ETH szimbólummal explicit `INVALID_MASK`; nem tűnik el és nem lesz no-op.
- A dYdX carry teljes órás cache nélkül blokkolt; legalább 90% órás és 90% napi coverage kell.
- Cascade valódi liquidation/OI/funding/ELR tape nélkül `UNSUPPORTED_DATA`.
- Általános, több-alpha közös portfólió-runner továbbra sincs; az overlay runner kizárólag a fenti DPC maszkokat fedi le.

A production maskok explicit runner- és szimbólum-scope-ja:

| Bináris mask | Kombináció                  | Státusz                    | Runner                       | Érvényes symbol | Explicit invalid symbol |
| ------------ | --------------------------- | -------------------------- | ---------------------------- | --------------- | ----------------------- |
| `10000`      | DPC                         | `SUPPORTED_REAL_DATA`      | DPC runner                   | BTC, ETH, SOL   | –                       |
| `10001`      | DPC + Regime                | `SUPPORTED_REAL_DATA`      | overlay `dpc-regime`         | BTC, ETH, SOL   | –                       |
| `10010`      | DPC + SOLFlip               | `SUPPORTED_REAL_DATA`      | overlay `dpc-solflip`        | SOL             | BTC, ETH                |
| `10011`      | DPC + SOLFlip + Regime      | `SUPPORTED_REAL_DATA`      | overlay `dpc-solflip-regime` | SOL             | BTC, ETH                |
| `00011`      | SOLFlip + Regime DPC nélkül | `UNSUPPORTED_JOINT_RUNNER` | nincs                        | –               | –                       |

A további 26 mask státuszát a generált mátrix őrzi; a Carry és minden Cascade-t tartalmazó kombináció korábbi adatblokkolása változatlan. Az elvárt összesítés: 4 `SUPPORTED_REAL_DATA`, 1 `BLOCKED_MISSING_DATA`, 16 `UNSUPPORTED_DATA`, 1 `FUNCTIONAL_REPLAY_ONLY`, 1 `UNSUPPORTED_SIGNAL_REPLAY`, 8 `UNSUPPORTED_JOINT_RUNNER`.

## Véges gridméretek

| Kiválasztás    |  IS | IS + validation + OOS | Megjegyzés                                              |
| -------------- | --: | --------------------: | ------------------------------------------------------- |
| `dpc`          |  30 |                    90 | 3 symbol × 2 consensus × 5 cap                          |
| `drc`          |  27 |                    81 | 3 symbol × 3 Donchian × 3 ADX                           |
| `pivot`        |  15 |                    45 | 3 symbol × 5 cap                                        |
| `ohlc-trend`   | 216 |                   648 | 3 symbol × 2 TF × 2 EMA × 3 ATR × 2 RR × 3 lookback     |
| `solflip`      |  81 |                   243 | 3⁴ plugin-konfiguráció; PnL/DD N/A                      |
| `overlay`      | 120 |                   360 | splitenként 80 runnable + 40 `INVALID_MASK`             |
| `all-runnable` | 489 |                  1467 | teljes rács; ebből 120 megőrzött overlay `INVALID_MASK` |

A teljes grid hosszú. Először mindig egyetlen stratégiát és `--phase=is` szakaszt használj; a tesztek nem futtatják le a teljes rácsot.

## Fájlok

- `catalog.json`: besorolás, runner és támogatási státusz;
- `grids.json`: véges paraméterterek és IS/validation/OOS split;
- `data-snapshot.json`: valós inputok fagyasztott hash/coverage elvárása;
- `scripts/verify-data.ts`: teljes adatintegritás-ellenőrzés;
- `scripts/generate-combination-matrix.ts`: 31 production mask;
- `scripts/run-search.ts`: dry-run és explicit execute/resume;
- `scripts/run-overlay-adapter.ts`: help + valódi minimál-OHLCV smoke gate az overlay CLI előtt;
- `scripts/normalize-results.ts`: execute manifest + raw + provenance egy jobból pontosan egy NDJSON sor;
- `scripts/summarize-results.ts`: teljes CSV/Markdown, standard és extended metrikákkal.

## 1. Adat és production mátrix ellenőrzése

```bash
bun search-best-config/scripts/verify-data.ts \
  --snapshot=search-best-config/data-snapshot.json

bun search-best-config/scripts/generate-combination-matrix.ts \
  --output=search-best-config/results/combination-matrix.csv
```

A mátrix elvárt hossza 32 CSV-sor: fejléc + 31 mask. A `valid_symbols` és `invalid_symbols` oszlopok gépileg is rögzítik a symbol scope-ot. A snapshot Binance USDT-adat; ez nem azonos a Bybit EU USDC runtime piaccal.

## 2. Dry-run manifest

Példa egy kezelhető DRC IS gridre:

```bash
bun search-best-config/scripts/run-search.ts \
  --strategy=drc \
  --phase=is \
  --output-dir=search-best-config/results/drc-is
```

Elérhető strategy aliasok: `dpc`, `drc`, `pivot`, `ohlc-trend`, `solflip`, `overlay`, `all-runnable`. Ha nincs `--strategy`, a 31-mask production manifest készül: `10000` a DPC runnerre, `10001`/`10010`/`10011` a megfelelő overlay maskra kerül; a két SOLFlip-mask csak SOL jobot generál. Execute nélkül ez továbbra is kizárólag dry-run.

## 3. Execute és resume

```bash
bun search-best-config/scripts/run-search.ts \
  --execute \
  --strategy=drc \
  --phase=is \
  --concurrency=2 \
  --resume=true \
  --output-dir=search-best-config/results/drc-is
```

Flag-ek:

- `--execute`: nélküle semmilyen runner nem indul;
- `--strategy=...`: egy vagy több vesszővel elválasztott strategy/alias;
- `--phase=is,validation,oos`: a kiválasztott split;
- `--concurrency=N`: 1–64 párhuzamos job, alapérték 1;
- `--resume=true|false`: alapérték true;
- `--output-dir=...`: manifest, raw, sidecar és log célmappa;
- `--output=...`: opcionális manifestútvonal a visszafelé kompatibilitásért.

Audit és skálázhatóság:

- egyszer teljes snapshot preflight fut a batch előtt;
- minden job előtt és után csak a job saját `inputFiles` SHA-256 hash-e ellenőrződik;
- egyszer teljes snapshot postflight fut a batch végén;
- postflight hiba minden addig sikeres/resume-olt sort `FAILED_BATCH_SNAPSHOT_AFTER` státusszal érvénytelenít;
- resume csak azonos code revision, dirty diff hash, snapshot hash, parancs és raw-output hash esetén történik;
- minden raw JSON mellett `<raw>.provenance.json` sidecar, továbbá stdout/stderr log készül;
- non-zero exit, spawn hiba, hiányzó vagy hibás JSON output és hash-eltérés külön `FAILED_*` sor marad a manifestben.

Overlay gate kézi ellenőrzése:

```bash
bun search-best-config/scripts/run-overlay-adapter.ts --help
bun search-best-config/scripts/run-overlay-adapter.ts \
  --smoke \
  --output=/tmp/mm-overlay-smoke.json
```

## 4. Normalize és teljes táblák

Az execute output könyvtárát vagy közvetlenül a manifestet add meg. A normalizáló a sidecart nem kezeli külön stratégiának: a raw metrikát és provenance-t a manifest jobhoz merge-eli, így egy job pontosan egy sor.

```bash
bun search-best-config/scripts/normalize-results.ts \
  --input=search-best-config/results/drc-is/run-manifest.json \
  --output=search-best-config/results/drc-is/normalized.ndjson

bun search-best-config/scripts/summarize-results.ts \
  --input=search-best-config/results/drc-is/normalized.ndjson \
  --csv=search-best-config/results/drc-is/all-results.csv \
  --markdown=search-best-config/results/drc-is/all-results.md
```

A táblák megtartják a standard metrikákat — total/havi/évesített hozam, max DD, Sharpe, Sortino, profit factor, win rate, tradeszám, kill-switch — és az `extendedMetrics`, coverage, teljes provenance, input hash, paraméter, státusz, indok és raw-output mezőket is. Plugin-only sorban PnL/DD null, soha nem hamis nulla.

## IS, validation és OOS

| Szakasz    | Időszak                 | Szerep                            |
| ---------- | ----------------------- | --------------------------------- |
| IS         | 2024-01-01 – 2025-07-01 | grid keresése                     |
| Validation | 2025-07-01 – 2026-01-01 | jelöltek szűrése                  |
| OOS        | 2026-01-01 – 2026-07-09 | lezárt jelöltek végső ellenőrzése |

Az OOS alapján ugyanazon az OOS mintán nem szabad újrahangolni. A TOML `cap` runtime portfóliósúly, a runner `--max-position-pct-equity` engine pozíciólimit; nem másolhatók át automatikusan. A historikus CSV Binance USDT, a cél runtime Bybit EU USDC lehet.
