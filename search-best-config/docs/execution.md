# Execute, resume és provenance szerződés

Ez a dokumentum a `scripts/run-search.ts --execute` gépi szerződését rögzíti. A dry-run és execute ugyanazt a determinisztikus `runId`-t és parancsot használja.

## Életciklus

1. A helper rögzíti a Git `HEAD` revisiont és a tracked diff plusz releváns untracked források SHA-256 hash-ét.
2. A batch előtt egyszer lefut a teljes `data-snapshot.json` hash-, sor-, cadence-, coverage- és OHLC-ellenőrzése.
3. Minden runnable job előtt csak annak deklarált `inputFiles` listája hash-elődik újra.
4. Resume esetén a sidecar code revision, dirty diff, snapshot, command és raw output hash egyezése kötelező.
5. A runner külön processzben fut; stdout és stderr külön logfájlt kap.
6. Minden job után újra hash-elődik a saját inputlista, és ellenőrződik a raw JSON léte/érvényessége.
7. A batch végén egyszer újra lefut a teljes snapshot-ellenőrzés. Hiba esetén minden sikeres vagy resume-olt eredmény érvénytelenné válik.

Ez a kétszintű megoldás elkerüli, hogy a több mint 1,1 millió snapshot-sort minden egyes gridpont előtt és után újraolvassuk, de job szinten is bizonyítja, hogy a tényleges input nem változott.

## Kimeneti elrendezés

Egy `--output-dir=DIR` futás:

```text
DIR/
├── run-manifest.json
├── logs/
│   ├── RUN_ID.stdout.log
│   └── RUN_ID.stderr.log
└── raw/
    ├── RUN_ID.json
    └── RUN_ID.json.provenance.json
```

A provenance sidecar tartalmazza a code revisiont, dirty diff hash-t, teljes parancstömböt, exit code-ot, snapshot azonosítót/hash-t, a job inputhash-eit, batch pre/post riportot, job előtti/utáni inputellenőrzést, raw hash-t, logútvonalakat és időbélyegeket.

## Siker és hiba

- `SUCCESS`: 0 exit, létező érvényes JSON, változatlan jobinputok és zöld batch postflight.
- `RESUMED`: korábbi `SUCCESS` minden resume-kulcsa és raw hash-e egyezik.
- `FAILED_BATCH_SNAPSHOT_BEFORE`: a batch nem indul el.
- `FAILED_INPUT_HASH_BEFORE`: az adott runner nem indul el.
- `FAILED_SPAWN`, `FAILED_EXIT`, `FAILED_MISSING_OUTPUT`, `FAILED_INVALID_OUTPUT`: külön megőrzött végrehajtási hiba.
- `FAILED_INPUT_HASH_AFTER`: a job inputja futás közben változott.
- `FAILED_BATCH_SNAPSHOT_AFTER`: a teljes végső snapshot audit érvénytelenítette a látszólag sikeres sort.
- `INVALID_MASK`, `UNSUPPORTED_*`, `BLOCKED_*`: nem futtatott, de a manifestből és végső táblából nem elvesző sor.

## Overlay adapter

A `run-overlay-adapter.ts` csak akkor engedi aktív manifestjobok létrehozását, ha:

- a saját `--help` szerződése felsorolja a kötelező flag-eket;
- a tényleges `packages/backtest-tools/src/cli/run-dpc-overlay-combination.ts` létezik;
- a `--smoke` a valódi targetet egy nap letöltött BTC OHLCV-n lefuttatja;
- a smoke JSON tartalmaz `result`, `derivedMetrics` és `overlayMetrics` objektumot.

A négy maszk mindhárom spliten szerepel. `dpc-solflip` és `dpc-solflip-regime` BTC/ETH kombinációi szándékosan `INVALID_MASK` sorok; SOLFlip nem kezelhető hangtalan no-opként.

A külön `--strategy=overlay` rács mind a három szimbólumot felsorolja, ezért az invalid BTC/ETH sorokat is megőrzi. A strategy flag nélküli, 31 production maskos manifest ezzel szemben a kombinációs mátrix explicit scope-ját követi:

| Production mask | Végrehajtási út | Symbol scope |
|---|---|---|
| `10000` | közvetlen DPC runner | BTC/ETH/SOL |
| `10001` | adapter, `--mask=dpc-regime` | BTC/ETH/SOL |
| `10010` | adapter, `--mask=dpc-solflip` | csak SOL; BTC/ETH a mátrixban explicit invalid |
| `10011` | adapter, `--mask=dpc-solflip-regime` | csak SOL; BTC/ETH a mátrixban explicit invalid |

Így a default manifest nem készíthet DPC-only parancsot overlay kombinációhoz. Dry-runban ugyanez a routing auditálható, `--execute` mellett pedig ugyanaz a parancstömb indul el.

## Normalizálás

Az execute manifest a kanonikus bemenet. A normalizáló sikeres jobnál beolvassa a raw JSON-t és sidecart, majd a standard metrikák mellé változtatás nélkül megtartja az overlay `derivedMetrics`, `overlayMetrics`, coverage és provenance objektumait. Sikertelen vagy nem futtatható jobból metrika nélküli, de teljes státusz/indok sor készül. Egy manifestjob pontosan egy normalizált sor.
