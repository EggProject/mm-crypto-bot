# Stratégia- és plugin-audit jegyzőkönyv

Állapot: 2026-08-16, a jelenlegi forrásfa és a `repo-data-2026-07-09` adatsnapshot alapján.

Ez a dokumentum két külön kérdésre ad választ:

1. a stratégia-, plugin- és runtime-implementációkban talált konkrét programhibák státuszára;
2. arra, hogy mely komponensekhez van valódi, letöltött piaci adaton futott empirikus eredmény.

A két állítás nem azonos. Az `AUDITED_PASS` kódaudit- és regressziós státusz, nem nyereségességi minősítés. A `BLOCKED_FAIL_LOUD` azt jelenti, hogy a komponens algoritmusa auditált, de a production runtime a hiányzó kötelező adatproducer miatt szándékosan nem indul el, tehát nem marad csendes no-op.

## Vezetői összefoglaló

- Mind a 7 konkrét stratégiaosztályt és mind a 13 root-exportált/belső wrapper plugint átvizsgáltuk.
- A bizonyított symbol-state, lifecycle, timestamp, sizing, risk-close, async ordering és külső-feed hibák javítva, regressziós tesztekkel lefedve vannak.
- A dYdX carry, Cascade Fade és a production SOLFlip továbbra sem tekinthető bekötött production stratégiának: a hiányzó kötelező producer/bridge miatt fail-fast szerződés védi őket a csendes inaktivitástól.
- Valódi Binance OHLCV-n teljes grid futott DPC, Donchian Range, Pivot Grid és OHLC Trend komponensekre. A SOLFlip valós Binance fundingon funkcionális replayt kapott, de önálló PnL/DD-je fogalmilag nem értelmezhető.
- A dYdX artifact elégtelen coverage miatt érvénytelen, a Cascade artifact pedig szintetikus; egyik sem használható valós-adatos teljesítménybizonyítékként.
- Nincs automatikusan kijelölt „legjobb” konfiguráció. A teljes táblából és a Pareto-nézetből a felhasználó választ, DD-vel együtt.

## 1. A 7 konkrét stratégiaosztály státusza

| # | Osztály | Forrás | Kódaudit státusz | Valós-adatos státusz | Lényegi megjegyzés |
|---:|---|---|---|---|---|
| 1 | `DonchianRangeChannelStrategy` | `packages/core/src/strategy/donchian-range-channel.ts` | `AUDITED_PASS` | `SUPPORTED_REAL_DATA` | A runtime valódi ADX-et ad át; a grid 3 szimbólumon, IS/validation/OOS szakaszokon futott. |
| 2 | `PivotPointGridStrategy` | `packages/core/src/strategy/pivot-point-grid.ts` | `AUDITED_PASS` | `SUPPORTED_REAL_DATA` | A korábbi megosztott pivot-state szimbólumonkénti state-re lett bontva, így nincs cross-symbol szivárgás. |
| 3 | `DonchianPivotComposition` | `packages/core/src/strategy/donchian-pivot-composition.ts` | `AUDITED_PASS` | `SUPPORTED_REAL_DATA` | A két alpha state-je szimbólumonként izolált; nyitott pozíció mellett is frissül a megfigyelési state új entry nélkül. |
| 4 | `OhlcTrendStrategy` | `packages/core/src/strategy/ohlc-trend.ts` | `AUDITED_PASS` | `SUPPORTED_REAL_DATA`, nem production registry tag | Önálló baseline/grid van; a konfigurációk eredményei nem jelentik automatikusan, hogy productionra alkalmas. |
| 5 | `CompositeStrategy` | `packages/core/src/strategy/composite.ts` | `AUDITED_PASS_CONDITIONAL` | `NOT_STANDALONE` | Generikus kétkomponensű osztály. Eredménye csak a konkrét komponensekkel értelmezhető; hiányos wrapper-konfiguráció fail-loud. |
| 6 | `DydxCexCarryStrategy` | `packages/core/src/strategy/dydx-cex-carry.ts` | `AUDITED_PASS`, runtime: `BLOCKED_FAIL_LOUD` | `BLOCKED_MISSING_DATA` | Funding subscription, lifecycle, kötelező precondition gate, reject/close state és nyitott pozíciós kill-switch javítva. Productionhoz valódi funding source és folyamatos precondition re-verifier kell. |
| 7 | `CascadeFadeStrategy` | `packages/core/src/strategy/cascade-fade.ts` | `AUDITED_PASS`, runtime: `BLOCKED_FAIL_LOUD` | `UNSUPPORTED_DATA` | Az OHLCV-only út nem tehet úgy, mintha működne: valódi liquidation/OI/ELR event bridge nélkül a registry ConfigErrorral leáll. A `midPriceUsd` dimenziója USD ár, nem notional. |

Kapcsolódó, de nem külön stratégiaosztály: a `packages/core/src/strategy/funding-flip-kill-switch.ts` számítási segédeket tartalmaz; a futó implementáció a `SOLFlipKillSwitchPlugin`.

## 2. A 13 plugin és wrapper státusza

Az első 11 osztály a core publikus plugin felületének része; az utolsó kettő belső monolith wrapper.

| # | Plugin/wrapper | Forrás | Státusz | Auditált szerződés / korábbi hiba lezárása |
|---:|---|---|---|---|
| 1 | `SOLFlipKillSwitchPlugin` | `packages/core/src/signal-center/plugins/sol-flip-kill-switch-plugin.ts` | `AUDITED_PASS`; production `BLOCKED_FAIL_LOUD` producer nélkül | Symbol-bearing attribution, determinisztikus timestamp, stale trailing-state elleni védelem, risk/kill emit javítva. A bot registry funding producer nélkül nem engedi inert módon elindulni. |
| 2 | `DvolRegimeSizingPlugin` | `packages/core/src/signal-center/plugins/dvol-regime-sizing-plugin.ts` | `AUDITED_PASS` | Sizing attribution és timestamp megőrzött; a sizingot a központi engine pontosan egyszer alkalmazza. A DVOL input külső adatfüggőség. |
| 3 | `VolTargetSizingPlugin` | `packages/core/src/signal-center/plugins/vol-target-sizing-plugin.ts` | `AUDITED_PASS` | Out-of-order close elutasítás, reset/dispose friss state, és Hybrid-Kellyvel közös sizing-ciklus elleni védelem. |
| 4 | `HybridKellyPlugin` | `packages/core/src/signal-center/plugins/hybrid-kelly-plugin.ts` | `AUDITED_PASS` | A VolTarget eredményének visszacsatolása nem skálázhatja újra ugyanazt a notionalt; cycle guard és egyetlen sizing-alkalmazási pont van. |
| 5 | `RegimeDetectorMetaPlugin` | `packages/core/src/signal-center/plugins/regime-detector-meta-plugin.ts` | `AUDITED_PASS` | A runtime napi `recordClose` feedet ad; a per-symbol `sizeModifier` ténylegesen belép a sizing útba, explicit `1.0` defaulttal. |
| 6 | `CexNetFlowRegimePlugin` | `packages/core/src/signal-center/plugins/cex-netflow-regime-plugin.ts` | `AUDITED_PASS_CONDITIONAL` | Freshness, symbol state és lifecycle auditált. Live jelhez valódi `IExchangeNetflowAdapter` kell; a null adapter degradációt jelent, nem empirikus validációt. |
| 7 | `CrossDexFundingWatcherPlugin` | `packages/core/src/signal-center/plugins/cross-dex-funding-watcher-plugin.ts` | `AUDITED_PASS_CONDITIONAL` | Venue/symbol mapping, monoton állapot és friss ciklus auditált. Valódi venue funding producer nélkül csak a funkcionális szerződés tesztelt. |
| 8 | `PerpDexLiquidationSignalsPlugin` | `packages/core/src/signal-center/plugins/perpdex-liquidation-signals-plugin.ts` | `AUDITED_PASS_CONDITIONAL` | Az async `onBar` awaitelt, a freshest nem-stale snapshot választódik, jövőbeli/out-of-order adat nem használható. Live működéshez valódi liquidation adapterek kellenek. |
| 9 | `CrossSymbolSpreadReversionPlugin` | `packages/core/src/signal-center/plugins/cross-symbol-spread-reversion-plugin.ts` | `AUDITED_PASS` | A két láb symbol-bearing, időrendhelyes és freshness-gated; reset után nincs előző futásból származó state. |
| 10 | `CrossSymbolMomentumOverlayPlugin` | `packages/core/src/signal-center/plugins/cross-symbol-momentum-overlay-plugin.ts` | `AUDITED_PASS` | Per-symbol state, timestamp és source attribution javítva; hibás/hiányzó szimbólum nem képezhet implicit BTC-jelet. |
| 11 | `CrossSymbolFundingDifferentialPlugin` | `packages/core/src/signal-center/plugins/cross-symbol-funding-differential-plugin.ts` | `AUDITED_PASS` | Stale vagy túlságosan elcsúszott lábpár elutasított, változatlan aktív pár deduplikált, forrásban mindkét láb szerepel. |
| 12 | `CompositePlugin` | `packages/core/src/signal-center/monolith-wrappers/composite-plugin.ts` | `AUDITED_PASS_FAIL_LOUD` | `component1`, `component2`, symbol és timeframe kötelező; reset nélküli komponenssel nem ígér fresh-runt. Hiányos config csendes default helyett hibát dob. |
| 13 | `CrossVenueFundingDivergencePlugin` | `packages/core/src/signal-center/monolith-wrappers/cross-venue-funding-divergence-plugin.ts` | `AUDITED_PASS_CONDITIONAL` | Venue-láb freshness/order, symbol attribution és lifecycle auditált; valós cross-venue adapter nélkül csak a funkcionális út igazolt. |

### Mit nem jelent a plugin `AUDITED_PASS`?

- Nem jelenti, hogy a külső feed-adapter létezik vagy production SLA-val működik.
- Nem jelent önálló PnL/DD-t egy risk-, factor- vagy sizing-pluginhoz.
- Nem bizonyítja, hogy minden lehetséges pluginkombináció gazdaságilag értelmes.
- A production registry 5 kapcsolója nem azonos a teljes, 13 elemű plugin/wrapper leltárral.

## 3. Közös engine/runtime/lifecycle/sizing findingek és javítások

| Terület | Bizonyított hiba | Javítási státusz |
|---|---|---|
| Symbol state | A DPC/Pivot állapot több szimbólum között keveredhetett. | Szimbólumonkénti state; multi-symbol regresszió: `FIXED`. |
| Nyitott pozíció melletti state | A backtest/runtime korán kihagyhatta a stratégia state-frissítését, ezért az indikátorállapot driftelt. | `onCandleObserved` út frissít, miközben új entry továbbra sem hajtható végre: `FIXED`. |
| Donchian ADX | A runtime MTF context nem valódi ADX-et adott. | A bar historyból számított ADX kerül a contextbe: `FIXED`. |
| Regime input és sizing | A Regime plugin nem kapott napi close feedet, illetve a `sizeModifier` telemetry-only no-op volt. | `recordClose(symbol, close, timestamp)` bridge és per-symbol modifier fogyasztás; hiány esetén `1.0`: `FIXED`. |
| dYdX subscription | A funding source subscription nem volt a runtime lifecycle-be kötve. | Subscribe/close lifecycle, duplikáció- és leak-védelem: `FIXED`, de a production producer még külső blokk. |
| dYdX entry/exit state | Kötelező preconditionök megkerülhetők/inertté válhattak; reject vagy close után `hasEntered` ragadhatott; nyitott pozíciónál kill-switch exit kimaradhatott. | Valódi gate, reject/close reset és nyitott pozíciós emergency exit: `FIXED`. |
| Cascade bridge | Az alapértelmezett runtime OHLCV mellett csendes no-op volt, a `midPrice` jelentése dimenzióhibás lehetett. | Event bridge nélkül fail-fast; `midPriceUsd` árként kezelve: `FIXED_FAIL_LOUD`. |
| SOLFlip bridge | `recordFundingSample` producer nélkül a plugin inert volt. | Production opt-in producer nélkül fail-fast; a külön funding replay támogatott: `FIXED_FAIL_LOUD`. |
| Killed plugin gate | Kill után a plugin jele központi fogyasztóhoz juthatott. | SignalBus pre-dispatch gate minden központi consumer előtt: `FIXED`. |
| Start/reset/dispose | Ismételt start/reset előző subscriptiont vagy state-et örökölhetett. | Start kétszer fail-loud, reset/dispose idempotens és fresh-run szerződés: `FIXED`. |
| Portfolio fresh run | Az orchestrator második futása state-et örökölhetett. | Inicializált új run előtt teljes reset; azonos inputból reprodukálható envelope: `FIXED`. |
| Sizing | A plugin multiplier több rétegen, illetve ciklikusan is alkalmazódhatott. | DecisionEngine az egyetlen kompozíciós pont; defensive minimum és Hybrid/VolTarget cycle guard: `FIXED`. |
| Risk close | A méretcsökkentő risk signal összekeverhette a target notionalt a close notionallel. | Explicit reduce semantics és fennmaradó exposure kezelése: `FIXED`. |
| Timestamp | `Date.now()` vagy hiányzó timestamp miatt backtest nem volt determinisztikus. | Bar/signal timestamp továbbvitele; stale/out-of-order/jövőbeli adat elutasítása: `FIXED`. |
| Attribution | Több plugin implicit vagy hiányos symbol/source mappinget használt. | Symbol-bearing source és explicit lábattribúció; implicit BTC tiltott: `FIXED`. |
| Async sorrend | A runner nem awaitelte az async plugin `onBar()` hívását, majd túl korán drainelte a buszt és engedhette az entryt. | `await processPlugins` és `await plugin.onBar`; bus drain csak befejezés után: `FIXED`. |
| Async lifecycle | Order lifecycle callbackek lebegő Promise-szal és nem determinisztikus sorrenddel futhattak. | Soros, awaitelt per-order lifecycle chain és hibakezelés: `FIXED`. |
| Composite config | A wrapper hiányos komponensekkel vagy implicit contexttel csendben futhatott. | Kötelező komponens/symbol/timeframe és reset-képesség; különben fail-loud: `FIXED_FAIL_LOUD`. |

## 4. Valós-adatos empirikus támogatás és kódaudit szétválasztása

### 4.1 Valós adaton végrehajtott teljes grid

A fagyasztott futás:

- könyvtár: `search-best-config/results/repo-data-2026-07-09/full-v1-320972c0-971eefe6/`;
- adatsnapshot: `repo-data-2026-07-09`;
- futási code revision: `320972c0dc8f372f7eb67a5c230191e0959adf29`;
- futási dirty diff SHA-256: `971eefe688b3437172349a01f6c275a8e6fc86c2afb97a04411e7ab5c43bd366`;
- 1467 manifest job: 1347 `SUCCESS`, 120 megőrzött `INVALID_MASK`;
- 1104 stratégiai sor rendelkezik teljes metrika- és provenance-készlettel;
- 71 Pareto-jelölt; nincs automatikus győztes.

| Komponens | Valós input | IS + validation + OOS sor | PnL/DD értelmezhető? | Státusz |
|---|---|---:|---|---|
| DPC | letöltött, hash-ellenőrzött Binance USDT OHLCV | 90 | Igen | `EXECUTED_REAL_DATA` |
| Donchian Range | ugyanaz | 81 | Igen | `EXECUTED_REAL_DATA` |
| Pivot Grid | ugyanaz | 45 | Igen | `EXECUTED_REAL_DATA` |
| OHLC Trend | ugyanaz | 648 | Igen | `EXECUTED_REAL_DATA`, nem production |
| SOLFlip | letöltött Binance 8h funding | 243 | Nem önállóan; plugin-only mezők `null` | `FUNCTIONAL_REPLAY_REAL_DATA` |
| DPC overlay maszkok | Binance OHLCV, SOLFlip esetén Binance SOL funding | 360, ebből 120 szándékos `INVALID_MASK` | A DPC portfolioeredményre igen | `LIMITED_OVERLAY_EXECUTED` |

Az OHLCV snapshot 15 fájlt és 1 146 429 sort vár. A Binance funding snapshot BTC/ETH/SOL esetén egyenként 2761 sort tartalmaz. Az adat Binance USDT; ez nem azonos a Bybit EU USDC production piaccal. Az eredményt mindig a manifestben rögzített revision/diff/input hash együttessel kell értelmezni; egy későbbi forrásmódosítás nem írja át automatikusan a régi eredmény érvényességét.

### 4.2 Amihez nincs megfelelő valós-adatos bizonyíték

| Komponens/kombináció | Státusz | Mi hiányzik? |
|---|---|---|
| dYdX–CEX carry | `BLOCKED_MISSING_DATA` | Teljes dYdX órás funding cache. A meglévő Q2 artifact csak 72/2160 órás mintát, 3,33% órás és 3,33% napi coverage-et ad; a kapu mindkettőből legalább 90%. |
| Cascade Fade | `UNSUPPORTED_DATA` | Valódi historikus liquidation/OI/funding/ELR/cross-venue tape. A meglévő replay dokumentáltan szintetikus. |
| Teljes production kombinációk | `UNSUPPORTED_JOINT_RUNNER` vagy `UNSUPPORTED_DATA` | Általános, időrendhelyes production portfólió- és SignalBus-replay runner, illetve a fenti feedek. |
| Regime önálló replay | `UNSUPPORTED_SIGNAL_REPLAY` | Archivált Direction/Carry/Sizing SignalBus eseményfolyam. DPC overlayben viszont korlátozottan futtatott. |
| Adapterfüggő további pluginok | `CODE_AUDIT_ONLY` | Production minőségű CEX netflow, cross-DEX funding, cross-venue funding és perp-DEX liquidation feed-adapterek/adatsnapshotok. |

## 5. dYdX, Cascade és egyéb külső-feed blokkok

### dYdX–CEX carry

A strategy osztály funkcionális logikája auditált, de a bot production útja jelenleg szándékosan blokkolt. Az indulás csak akkor tehető engedélyezetté, ha egyszerre rendelkezésre áll:

1. élő `DydxFundingSource` subscription és szabályos close/dispose lifecycle;
2. folyamatos precondition re-verifier, amely ténylegesen meghívja a `recordPreconditionReverify` útvonalat;
3. a szükséges chain freshness, Bybit EU spot depth és latency inputok;
4. backtesthez legalább 90% órás és 90% napi dYdX coverage.

Ezek nélkül az `enabled = true` ConfigErrorral leáll. Ez biztonsági státusz, nem befejezett production integráció.

### Cascade Fade

A candle önmagában nem tartalmazza a liquidation cascade döntéshez szükséges eseménydimenziókat. Kötelező egy élő liquidation + OI + ELR, szükség szerint funding/cross-venue bridge. Enélkül az `enabled = true` fail-fast. Valós historikus tape hiányában a szintetikus replay csak állapotgép- és szerződésteszt, nem teljesítménymérés.

### SOLFlip

A production plugin valós SOL funding-rate producer nélkül fail-fast. A külön search runner valós Binance fundingon replayeli a döntési logikát. Risk/kill-switch pluginként önálló equity curve-ja, hozama és DD-je nincs; ezek a mezők helyesen `null`, nem nulla.

## 6. Ellenőrzési kapuk

Az alábbi eredmények a dokumentum készítésekor ellenőrzött snapshothoz tartoznak.

| Kapu | Eredmény |
|---|---|
| Core teljes teszt | 1547 pass, 0 fail, 9922 assertion, 44 fájl |
| Core typecheck | exit 0 |
| Core lint | 0 error, 272 warning |
| Bot teljes teszt, 1. egymást követő futás | 1074 pass, 1 szándékos system skip, 0 fail, 2444 assertion, 53 fájl |
| Bot teljes teszt, 2. egymást követő futás | 1074 pass, 1 szándékos system skip, 0 fail, 2444 assertion, 53 fájl |
| Bot célzott `config` + `StrategyRunner` teszt | 60 pass, 0 fail, 209 assertion |
| Bot typecheck | exit 0 |
| Bot lint | 0 error, 235 warning |
| Teljes grid manifest | 1467/1467 lezárt státusz: 1347 success + 120 explicit invalid mask |
| Grid stratégiai metrika/provenance | 1104/1104 teljes |
| `git diff --check` | pass |

A lint warningok nem lint errorok, de nem tekintendők automatikusan jelentéktelennek; külön technikaiadósság-listán kezelendők. A tesztszám önmagában nem bizonyít piaci helyességet.

## 7. Eredmények használata

- Teljes tábla, DD-vel: `search-best-config/results/repo-data-2026-07-09/full-v1-320972c0-971eefe6/all-results.md` és `.csv`.
- Pareto-jelöltek: ugyanott `pareto-candidates.md` és `.json`.
- Fázis/stratégia összefoglaló: `phase-strategy-summary.json`.
- Futási és input provenance: `run-manifest.json`, minden sikeres raw output mellett `.provenance.json`.
- A 31 production mask besorolása: `search-best-config/results/combination-matrix.csv`.
- Reprodukálási leírás: `search-best-config/README.md` és `search-best-config/docs/execution.md`.

Konfigurációválasztáskor legalább a validation és OOS hozamot, MaxDD-t, Sharpe-ot, Sortinót, profit factort, win rate-et, tradeszámot, kill-switch státuszt, adatcoverage-et és provenance-t együtt kell nézni. OOS eredmény alapján ugyanazon az OOS szakaszon újrahangolni tilos, mert azzal az OOS elveszíti ellenőrző szerepét.

## 8. Korlát és garancia

Ez az audit nem matematikai bugmentességi garancia. A review és a tesztek a vizsgált forrásverzióban felismerhető hibákat, lefedett edge case-eket és ismert integrációs kockázatokat kezelik. Nem bizonyíthatják, hogy nincs további rejtett hiba, nem modellezett exchange-viselkedés, adatminőségi probléma, latency/slippage eltérés vagy jövőbeli regresszió.

Az `AUDITED_PASS` ezért pontosan ezt jelenti: a felsorolt findingek javítva vannak, a hozzájuk tartozó regressziók és a megadott kapuk zöldek. Nem jelent matematikai teljességet, garantált nyereséget vagy automatikus production-engedélyt.
