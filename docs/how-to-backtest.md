# Teljes multi-stratégia backtest és konfigurációkeresési kézikönyv

Ez a kézikönyv azt írja le, hogyan lehet a repó stratégiáit és production komponenseit valós historikus adatokon, reprodukálhatóan felmérni. A folyamat minden komponenst nyilvántart, de nem állítja, hogy minden elem OHLCV-ből vagy önálló PnL-lel backtestelhető. A nem futtatható esetek `SKIP`, `UNSUPPORTED` vagy coverage-hibás sort kapnak; nem tűnnek el a végső táblából.

A konfigurációkeresés segédanyagai a `search-best-config/` mappában vannak. A `run-search.ts` alapértelmezetten csak dry-run manifestet készít, `--execute` kapcsolóval viszont a teljes futtatható gridet végre is hajtja. A futás concurrency-limitált és hash-alapú resume-ot, valamint batch- és job-szintű provenance-t használ. A mérési folyamat nem választ automatikusan „nyertest”: a teljes eredménytáblából a megfelelő hozam/DD/stabilitás kompromisszumot továbbra is a felhasználó dönti el.

## Mit nevezünk stratégiának, wrappernek, pluginnek és portfóliótesztnek?

- Az önálló stratégia közvetlenül kereskedési jelet képez, és megfelelő runnerrel saját trade/PnL/DD eredményt adhat.
- A wrapper vagy composition más stratégiákat fog össze. A `CompositeStrategy` csak akkor mérhető, ha megnevezzük a komponenseit; a `DonchianPivotComposition` ennek konkrét, futtatható változata.
- A plugin SignalBus eseményeket olvas vagy módosít. Egy defenzív risk/sizing plugin önmagában nem kereskedési rendszer, ezért az önálló hozam és DD gyakran nem értelmezhető.
- Az overlay backtest a DPC alphát a SOLFlip és/vagy Regime Detector overlayjel egyetlen időrendhelyes folyamban futtatja. Ez nem teljes, mind az öt production komponenst és közös korreláció/risk-budget modellt lefedő portfóliórunner; az egyedi eredmények összeadása ezt továbbra sem helyettesíti.

## Autoritatív implementációs inventory

### A hét stratégiaosztály

Az autoritatív lista a `packages/core/src/index.ts` által exportált stratégiaosztályokból áll.

| Stratégia                      | Típus                                | Valós adatkövetelmény                                                  | Jelenlegi reprodukciós állapot                                                                                                        |
| ------------------------------ | ------------------------------------ | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `CompositeStrategy`            | generikus wrapper                    | a konkrét komponensek összes adata                                     | Nincs önálló konfiguráció vagy runner; konkrét compositionként kell mérni.                                                            |
| `PivotPointGridStrategy`       | önálló price strategy, DPC komponens | Binance 15m + lezárt 4h/1d OHLCV                                       | Valós OHLCV baseline runner elérhető.                                                                                                 |
| `DonchianRangeChannelStrategy` | önálló price strategy, DPC komponens | Binance 15m + lezárt 4h/1d OHLCV                                       | Valós OHLCV runner elérhető; a Donchian-periodus és ADX-küszöb CLI-ről állítható.                                                     |
| `OhlcTrendStrategy`            | önálló OHLC trendstratégia           | 1h vagy 4h OHLCV                                                       | Valós Binance CSV-runnere van, explicit költség-, pozíció-, SL/TP- és teljes metrikamodellel.                                         |
| `DonchianPivotComposition`     | konkrét kétkomponensű wrapper        | Binance 15m/4h/1d OHLCV                                                | Valós OHLCV, multi-symbol, IS/validation/OOS runner elérhető.                                                                         |
| `CascadeFadeStrategy`          | eseményvezérelt satellite stratégia  | liquidation 1m, OI, funding, ELR és cross-venue confirmation           | Valódi historikus eseménytape nincs; a meglévő artifact szintetikus helyettesítő, nem valós backtest.                                 |
| `DydxCexCarryStrategy`         | cross-venue funding carry            | Binance 8h funding + teljes dYdX 1h funding + venue/latency feltételek | Runner van, de eredmény csak legalább 90% órás és 90% napi dYdX coverage mellett empirikus. A szükséges teljes cache nincs a repóban. |

### A tizenegy Signal Center plugin

Az autoritatív lista a `packages/core/src/signal-center/plugins/` könyvtár 11 exportált `StrategyPlugin` osztálya. A monolith wrapper adapterek nem külön pluginok ebben a számban.

| Plugin                                 | Szerep                           | Valós bemenet                                             | Önálló PnL/DD?                                         | Production registry              |
| -------------------------------------- | -------------------------------- | --------------------------------------------------------- | ------------------------------------------------------ | -------------------------------- |
| `CexNetFlowRegimePlugin`               | read-only factor/regime          | CEX balance és net-transfer-flow idősor                   | Nem                                                    | Nem                              |
| `CrossDexFundingWatcherPlugin`         | cross-venue funding source       | Hyperliquid, Binance, Bybit és OKX funding                | Nem                                                    | Nem                              |
| `CrossSymbolFundingDifferentialPlugin` | kétlábas funding hedge           | szinkron BTC/ETH vagy más párok fundingja                 | Csak közös kétlábas runnerrel                          | Nem                              |
| `CrossSymbolMomentumOverlayPlugin`     | BTC-vezérelt risk-on/off overlay | szinkron napi close több szimbólumra                      | Csak upstream stratégiával                             | Nem                              |
| `CrossSymbolSpreadReversionPlugin`     | pairs mean reversion             | szinkron close mindkét lábra                              | Csak kétlábas portfólió-runnerrel                      | Nem                              |
| `DvolRegimeSizingPlugin`               | forward-looking sizing           | Deribit BTC DVOL napi idősor                              | Nem; sizing modifier                                   | Nem                              |
| `HybridKellyPlugin`                    | carry-side adaptív sizing        | CarrySignal, SizingSignal, funding-Sharpe és realized vol | Nem; sizing modifier                                   | Nem                              |
| `PerpDexLiquidationSignalsPlugin`      | defenzív liquidation overlay     | több perp-DEX liquidation/OI feed                         | Nem                                                    | Nem                              |
| `RegimeDetectorMetaPlugin`             | HMM defenzív meta-plugin         | Direction/Carry/Sizing SignalBus stream és hozamok        | Nem                                                    | Igen: `regime_detector`          |
| `SOLFlipKillSwitchPlugin`              | SOL funding-flip risk gate       | SOL 8h funding history/CarrySignal                        | Önállóan nem; funding replayben PnL/DD explicit `null` | Igen: `funding_flip_kill_switch` |
| `VolTargetSizingPlugin`                | inverse-realized-vol sizing      | upstream SizingSignal és realized-vol idősor              | Nem; sizing modifier                                   | Nem                              |

### Az öt production registry elem

Az éles kapcsolható felület autoritatív forrása az `apps/bot/src/config/schema.ts`. Nem mind azonos a hét stratégia vagy a 11 plugin teljes könyvtári listájával.

| Production kulcs             | Runtime típus        | Alapadat                                      | Pontosan mit tudunk jelenleg állítani?                                                                                                                |
| ---------------------------- | -------------------- | --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `donchian_pivot_composition` | strategy/composition | OHLCV                                         | Egyedileg valós adaton támogatott.                                                                                                                    |
| `dydx_cex_carry`             | strategy             | CEX + dYdX funding                            | Coverage-gated runner; teljes lokális dYdX adat hiányzik.                                                                                             |
| `cascade_fade`               | strategy             | liquidation/OI/funding/ELR event tape         | Valós adat hiányában `UNSUPPORTED_DATA`.                                                                                                              |
| `funding_flip_kill_switch`   | plugin               | SOL funding                                   | Valós Binance funding replay elérhető; önálló PnL/DD nem értelmezhető. DPC-vel együtt SOL-on overlayként is mérhető.                                  |
| `regime_detector`            | plugin               | Direction/Sizing SignalBus stream és close-ok | Önálló replay nincs; DPC-vel együtt az overlay runner valós close- és DPC-jelekkel futtatja, a `sizeModifier` ténylegesen módosítja a pozícióméretet. |

Öt bináris kapcsoló 32 állapotot ad. Az all-off állapot nem stratégiai konfiguráció, ezért a helper mind a 31 nem üres production maskot kiírja. A teljesítményrunnerek a DPC singletont és a DPC + opcionális SOLFlip + opcionális Regime négy overlay-maskját támogatják; a dYdX/Cascade vagy önálló Regime adatot igénylő többi production mask explicit indokot kap. A 31 sor nem 31 sikeres backtestet jelent.

## Adatsnapshot és valós adatkövetelmények

| Dataset                                    |                Coverage |                  Méret | Mire használható?                                      | Korlát                                                  |
| ------------------------------------------ | ----------------------: | ---------------------: | ------------------------------------------------------ | ------------------------------------------------------- |
| Binance BTC/ETH/SOL OHLCV, 5m/15m/1h/4h/1d | 2024-01-01 – 2026-07-09 | 15 fájl, 1 146 429 sor | DPC, Donchian Range, Pivot Grid, OHLC Trend és overlay | Binance USDT, nem Bybit EU USDC.                        |
| Binance BTC/ETH/SOL funding, közel 8h      | 2024-01-01 – 2026-07-09 |    2 761 sor/szimbólum | funding plugin funkcionális replay, carry CEX láb      | Önállóan nem tartalmaz dYdX lábat.                      |
| Deribit BTC DVOL daily                     | 2024-10-04 – 2026-07-06 |                641 sor | DVOL sizing plugin                                     | A snapshot valós, de a letöltő nincs commitolva.        |
| dYdX hourly funding                        |                       — |               hiányzik | dYdX-vs-CEX carry                                      | Teljes ablakra legalább 90% órás és napi coverage kell. |
| Cascade event tape                         |                       — |               hiányzik | Cascade Fade                                           | OHLCV nem helyettesíti a liquidation/OI/ELR adatot.     |
| SignalBus replay                           |                       — |               hiányzik | Regime Detector és joint portfolio                     | A trade JSON nem teljes SignalBus eseményfolyam.        |

A fagyasztott hash-ek és coverage elvárások a `search-best-config/data-snapshot.json` fájlban vannak. Az OHLCV downloader forráskódjában régi USDC-komment maradt, de a tényleges `SYMBOLS` lista USDT-párokat tölt le. A CSV feed base asset alapján keres fájlt, ezért `BTC/USDC` kérésre is ugyanazt a BTC/USDT CSV-t adhatja. Ezt venue/quote driftként kell feltüntetni, nem szabad Bybit EU reprodukciónak nevezni.

## Teljes reprodukciós folyamat

Minden parancsot a repó gyökeréből futtass.

### 0. Környezet és célzott ellenőrzések

```bash
cd /home/eggp/projects/mm-crypto-bot
bun install --frozen-lockfile
bunx tsc --noEmit -p search-best-config/tsconfig.json
bun test search-best-config/tests
```

### 1. Verify: a fagyasztott adat ellenőrzése

```bash
bun search-best-config/scripts/verify-data.ts \
  --snapshot=search-best-config/data-snapshot.json
```

Az ellenőrzés SHA-256 hash-t, byte- és sorszámot, első/utolsó timestampet, szigorú időrendet, OHLC-invariánsokat, gyertyakontinuitást és funding-cadence-t vizsgál. Fundingnál a Binance timestamp néhány milliszekundumos jittere miatt deklarált tolerancia van. Bármely eltérésnél előbb az adatot kell tisztázni; régi és friss snapshot eredményeit nem szabad egy táblában azonos mintaként kezelni.

### 2. Matrix: mind a 31 production kombináció

```bash
bun search-best-config/scripts/generate-combination-matrix.ts \
  --output=search-best-config/results/combination-matrix.csv
```

JSON változat:

```bash
bun search-best-config/scripts/generate-combination-matrix.ts \
  --output=search-best-config/results/combination-matrix.json
```

Ellenőrzés:

```bash
wc -l search-best-config/results/combination-matrix.csv
```

Az elvárt eredmény 32 sor: egy fejléc és 31 adatmask. Minden adatsorban kötelező a `status` és `reason`.

### 3. Manifest: a véges joblista létrehozása

```bash
bun search-best-config/scripts/run-search.ts \
  --strategy=all-runnable \
  --phase=is,validation,oos \
  --concurrency=4 \
  --output=search-best-config/results/run-manifest.json
```

Ez dry-run: a script még nem indít backtestet, hanem:

- DPC, DRC, Pivot, OHLC Trend, SOLFlip és a négy overlay-mask teljes véges gridjéhez pontos parancstömböt készít;
- a nem érvényes kombinációkat is megőrzi státusszal és indokkal;
- rögzíti a Git revisiont és a használt snapshot hivatkozását.

Gyors ellenőrzés:

```bash
jq '{dryRun, strategies, rows: (.jobs | length), ready: ([.jobs[] | select(.status == "READY_DRY_RUN")] | length), invalid: ([.jobs[] | select(.status == "INVALID_MASK")] | length)}' \
  search-best-config/results/run-manifest.json
```

Az elvárt all-runnable manifest 1467 job/status sort tartalmaz: 1347 `READY_DRY_RUN` és 120 `INVALID_MASK`. Az invalid sorok a SOLFlipet BTC/ETH-n kérő overlay-k; ezeket a rendszer nem csendes no-opként kezeli.

| Runner/grid            | Manifest sor | Futtatható sor |
| ---------------------- | -----------: | -------------: |
| DPC                    |           90 |             90 |
| Donchian Range (DRC)   |           81 |             81 |
| Pivot Grid             |           45 |             45 |
| OHLC Trend             |          648 |            648 |
| SOLFlip funding replay |          243 |            243 |
| DPC overlay            |          360 |            240 |
| **Összesen**           |     **1467** |       **1347** |

### 4. Execute és resume

A teljes futtatható grid végrehajtása négy párhuzamos workerrel:

```bash
bun search-best-config/scripts/run-search.ts \
  --execute \
  --strategy=all-runnable \
  --phase=is,validation,oos \
  --concurrency=4 \
  --resume=true \
  --output-dir=search-best-config/results \
  --output=search-best-config/results/run-manifest.json
```

`--resume=true` az alapértelmezés. Egy korábbi job csak akkor kap `RESUMED` státuszt, ha a provenance szerint a command, code revision, dirty diff hash és snapshot hash azonos, a raw output hash-e egyezik, és az output érvényes JSON. Tiszta újrafuttatáshoz használható a `--resume=false`; ez felülírhat azonos nevű raw outputokat, ezért csak tudatosan használd.

A végrehajtás hitelességi kapui:

- batch preflight: a teljes adatsnapshot hash/coverage ellenőrzése még az első job előtt;
- per-job before/after: minden tényleges input SHA-256 ellenőrzése a job előtt és után;
- per-job sidecar: `<raw-output>.provenance.json`, benne command, időpontok, Git revision, dirty diff hash, snapshot/input/output hash, exit code és logútvonalak;
- batch postflight: a teljes snapshot újbóli ellenőrzése; hiba esetén a már sikeres eredmények is `FAILED_BATCH_SNAPSHOT_AFTER` státuszt kapnak;
- stdout/stderr: jobonként külön fájl a `search-best-config/results/logs/` alatt.

A futás megszakítható és ugyanazzal a paranccsal folytatható. Kisebb próba vagy egy stratégia esetén előbb készíts dry-run manifestet, például:

```bash
bun search-best-config/scripts/run-search.ts \
  --strategy=drc \
  --phase=is \
  --concurrency=4 \
  --output=search-best-config/results/run-manifest-is.json
```

A manifest léte önmagában nem bizonyítja, hogy a jobok lefutottak. Ehhez `dryRun: false`, jobonként `SUCCESS` vagy hiteles `RESUMED`, valamint érvényes provenance sidecar szükséges.

### 5. Normalize: heterogén outputok egységesítése

```bash
bun search-best-config/scripts/normalize-results.ts \
  --input=search-best-config/results/raw \
  --output=search-best-config/results/normalized.ndjson
```

Régi artifactok auditjához az input lehet `backtest-results` is. A normalizáló minden JSON-t megtart; hibás fájl `FAILED_PARSE`, szintetikus Cascade `UNSUPPORTED_SYNTHETIC`, elégtelen dYdX coverage `FAILED_DATA_COVERAGE`, revision/hash kötés nélküli régi output `LEGACY_UNVERIFIED_PROVENANCE` lesz.

### 6. Summarize: teljes CSV és Markdown táblák

```bash
bun search-best-config/scripts/summarize-results.ts \
  --input=search-best-config/results/normalized.ndjson \
  --csv=search-best-config/results/all-results.csv \
  --markdown=search-best-config/results/all-results.md
```

Sorvesztés ellenőrzése:

```bash
wc -l search-best-config/results/normalized.ndjson
wc -l search-best-config/results/all-results.csv
```

A CSV egy fejlécsorral hosszabb kell legyen. Plugin- vagy unsupported sornál a nem értelmezhető metrika üres/null, nem nulla.

## Közvetlen egyedi runner példák

### Donchian–Pivot composition

```bash
bun run packages/backtest-tools/src/cli/run-donchian-pivot-composition.ts \
  --symbol=BTC/USDT \
  --timeframe=15m \
  --min-consensus=1 \
  --max-position-pct-equity=0.12 \
  --equity=10000 \
  --start=2024-01-01 \
  --end=2025-07-01 \
  --data-dir=data/ohlcv \
  --output=backtest-results/manual/dpc-btc-is.json
```

### Donchian Range ablation

```bash
bun run packages/backtest-tools/src/cli/run-donchian-range-baseline.ts \
  --symbol=BTC/USDT \
  --timeframe=15m \
  --donchian-period=20 \
  --adx-trend-threshold=25 \
  --start=2024-01-01 \
  --end=2025-07-01 \
  --data-dir=data/ohlcv \
  --output=backtest-results/manual/donchian-range-btc-is.json
```

### Pivot Grid ablation

```bash
bun run packages/backtest-tools/src/cli/run-pivot-grid-baseline.ts \
  --symbol=BTC/USDT \
  --timeframe=15m \
  --max-position-pct-equity=0.04 \
  --start=2024-01-01 \
  --end=2025-07-01 \
  --data-dir=data/ohlcv \
  --output=backtest-results/manual/pivot-grid-btc-is.json
```

### OHLC Trend ablation

```bash
bun run packages/backtest-tools/src/cli/run-ohlc-trend-baseline.ts \
  --symbol=BTC/USDT \
  --timeframe=1h \
  --fast-ema=20 \
  --slow-ema=100 \
  --atr-stop-multiplier=1.5 \
  --reward-to-risk=2 \
  --cross-lookback=5 \
  --start=2024-01-01 \
  --end=2025-07-01 \
  --data-dir=data/ohlcv \
  --output=backtest-results/manual/ohlc-trend-btc-is.json
```

Ez a runner valós CSV-t ad át az `OhlcTrendStrategy` saját API-jának. A kimenet az explicit fee/slippage/spread/borrow modellt, pozícióméretezést, SL/TP-kezelést, trade-eket, DD-t és a negatív teljes hozamot is helyesen kezelő geometriai havi hozamot tartalmazza.

### SOLFlip funding replay

```bash
bun run packages/backtest-tools/src/cli/run-sol-flip-funding-replay.ts \
  --input=data/funding/binance_solusdt_funding_8h.csv \
  --sign-flip-window-days=7 \
  --extreme-sigma-threshold=1.5 \
  --persistence-days=5 \
  --vol-window-days=30 \
  --start=2024-01-01 \
  --end=2025-07-01 \
  --output=backtest-results/manual/solflip-is.json
```

A SOLFlip nem önálló alpha és nem tulajdonol pozíciót. A replay valós funding coverage-, rezsim- és risk-event metrikákat ad, de a PnL, hozam, Sharpe, DD és profit factor mezőit szándékosan `null`/N/A értéken hagyja.

### DPC + production overlay-k

Az adapter szerződésének és minimális valós-adatos futásának ellenőrzése:

```bash
bun search-best-config/scripts/run-overlay-adapter.ts --help
bun search-best-config/scripts/run-overlay-adapter.ts \
  --smoke \
  --output=/tmp/dpc-overlay-smoke.json
```

Egy teljes DPC + SOLFlip + Regime futás SOL-on:

```bash
bun search-best-config/scripts/run-overlay-adapter.ts \
  --mask=dpc-solflip-regime \
  --symbol=SOL/USDT \
  --start=2024-01-01 \
  --end=2025-07-01 \
  --min-consensus=1 \
  --max-position-pct-equity=0.12 \
  --funding-input=data/funding/binance_solusdt_funding_8h.csv \
  --output=backtest-results/manual/dpc-solflip-regime-sol-is.json
```

A négy támogatott mask: `dpc`, `dpc-solflip`, `dpc-regime`, `dpc-solflip-regime`. SOLFlip aktív állapotban blokkolja vagy zárja az alpha pozíciót; a Regime Detector a DPC direction/sizing jeleit kapja, és `sizeModifier` értéke ténylegesen módosítja a pozícióméretet. SOLFlip-mask BTC/ETH szimbólummal explicit invalid, nem no-op.

### dYdX-vs-CEX carry coverage gate

```bash
bun run packages/backtest-tools/src/cli/run-dydx-vs-cex-funding-carry.ts \
  --symbol=btc \
  --window=2025-Q2 \
  --funding-csv-dir=data/funding \
  --cache-dir=.cache/tardis-dydx-v4 \
  --skip-tardis-fetch \
  --output=backtest-results/manual/carry-btc-2025-Q2.json
```

A runner csak akkor enged normalizált havi/éves/Sharpe mutatót és empirikus verdictet, ha a dYdX adat legalább 90%-ban lefedi az elvárt órás slotokat és napokat. Elégtelen coverage esetén a metrikák `N/A`, a verdict invalid, a közvetlen CLI pedig nem nulla exit kódot adhat. Ezt nem szabad futási hibaként elrejteni vagy nullát valós teljesítményként értelmezni.

## Causal engine és futásidő

A közös DPC/DRC/Pivot/overlay backtest engine a historikus indikátor-idősorokat egyszer, kauzálisan előszámítja, és monoton HTF/MTF cursorral választja ki az adott LTF döntési időpontban már lezárt adatot. Nem lát jövőbeli gyertyát. Az előszámított mód minden HTF/MTF/LTF lépésen egzakt egyezést mutat a korábbi prefix-újraszámítással; a teljes valós IS DPC, DRC, Pivot és overlay trade streamje és eredményobjektuma bitazonos maradt.

Az ugyanazon 2024-01-01 – 2025-07-01 valós IS mintán mért common-engine idők:

| Runner                         | Korábbi idő | Causal precompute | Gyorsulás |
| ------------------------------ | ----------: | ----------------: | --------: |
| DPC                            |    110,35 s |            0,18 s |      613× |
| DRC                            |    158,46 s |            0,15 s |     1056× |
| Pivot                          |     95,56 s |            0,17 s |      562× |
| DPC + SOLFlip + Regime overlay |     84,69 s |            0,29 s |      292× |

Az OHLC Trend külön runnerének mért IS ideje 2,57 s volt; ezért annak 648 jobos gridje önmagában körülbelül 7 perc concurrency=4 mellett, és nem igényelt eltérő optimalizált végrehajtási utat. A teljes all-runnable gridre concurrency=4 mellett 10–15 perc walltime-keret ajánlott. Ez benchmark-alapú becslés: gépterhelés, lemez-cache és hardver függvényében változhat.

## IS, validation és OOS szabály

| Szakasz    | Időszak                 | Használat                                        |
| ---------- | ----------------------- | ------------------------------------------------ |
| IS         | 2024-01-01 – 2025-07-01 | véges grid keresése                              |
| Validation | 2025-07-01 – 2026-01-01 | IS-jelöltek szűrése                              |
| OOS        | 2026-01-01 – 2026-07-09 | előre lezárt jelöltek egyszeri végső ellenőrzése |

Az OOS eredmény láttán ugyanazon az OOS mintán tilos új paramétert választani. Minden ablak elején indikátor-warmup van. A DPC legalább 20 lezárt napos gyertyát igényel; rövid ablakok jelhiánya nem feltétlen stratégiahiba.

## A teljes eredménytábla metrikái

| Mező                                                    | Jelentés                                                                 |
| ------------------------------------------------------- | ------------------------------------------------------------------------ |
| `totalReturnPct`                                        | teljes kumulatív hozam százalékpontban                                   |
| `monthlyReturnPct`                                      | geometriai havi átlag százalékpontban                                    |
| `annualizedReturnPct`                                   | évesített hozam százalékpontban                                          |
| `maxDrawdownPct`                                        | legnagyobb csúcs–völgy visszaesés; minden teljesítménysornál kötelező DD |
| `sharpe`                                                | kockázat-adjustált átlaghozam                                            |
| `sortino`                                               | lefelé irányuló volatilitással korrigált hozam                           |
| `profitFactor`                                          | bruttó nyereség / bruttó veszteség                                       |
| `winRatePct`                                            | nyertes lezárt trade-ek aránya                                           |
| `totalTrades`                                           | lezárt trade-ek száma                                                    |
| `killSwitchTriggered`                                   | aktiválta-e a kockázati leállítást                                       |
| `coverage`                                              | adatfedettségi bizonyíték; különösen fontos carrynél                     |
| `status`, `reason`                                      | futtathatóság és minden skip/unsupported indoka                          |
| `parameters`, `dataInputs`, `codeRevision`, `rawOutput` | reprodukciós provenance                                                  |

Nem szabad csak havi hozam alapján rangsorolni. A teljes táblából érdemes Pareto-jelölteket választani: magasabb validation/OOS hozam, alacsonyabb DD, stabil Sharpe/Sortino és profit factor, elegendő tradeszám, több szimbólumon fennmaradó eredmény, kill-switch nélkül. A végső kockázati profilt a felhasználó választja.

## TOML/backtest eltérések

- A backtest `--max-position-pct-equity` az engine pozíció-notional limitje.
- A TOML `[strategies.donchian_pivot_composition].cap` runtime portfóliósúly. Egyetlen aktív stratégiánál normalizálás után nem ugyanazt jelenti, ezért a két számot nem szabad automatikusan átmásolni.
- A specializált DPC runner nem olvassa be a teljes TOML-t.
- A runner költség-, sizing- és marginmodellje nem reprodukál minden TOML mezőt, például a venue fee tiert, teljes leverage-policyt, max position countot, runtime Kellyt vagy portfólió-korrelációt.
- A CSV Binance USDT, a paper/live cél Bybit EU USDC lehet. A quote, venue, likviditás, spread, slippage és order-fill drift fennmarad.
- A több szimbólumos combined átlag nem közös, korrelációkezelt portfólióequity.

Ezért a historikus eredmény konfiguráció-összehasonlítás, nem hozamígéret és nem automatikus live engedély.

## Paper config ellenőrzése

```bash
bun run mm-bot config validate \
  --config=run-bot/config/paper-backtest-optimized.toml
```

Paper indítás csak a teljes táblából választott beállítással és a config fejlécében dokumentált drift elfogadása után:

```bash
bun run mm-bot start \
  --config=run-bot/config/paper-backtest-optimized.toml
```

A paper megfigyelési időszak nem helyettesíthető historikus backtesttel, és a backtest nem indokol automatikus live átállást.
