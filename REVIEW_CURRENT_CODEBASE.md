# Jelenlegi kódbázis review — lezárási állapot

Dátum: 2026-08-10

Scope: a jelenlegi worktree teljes, webes primer forrásokkal és regressziós tesztekkel ellenőrzött review-ja. Az eredeti 32 megállapítás számozása és címe változatlan maradt a visszakövethetőség érdekében. A review során feltárt kódhibák mind javítva vannak; a jelentés frissítése nem jelent live-order engedélyezést vagy pénzügyi teljesítményígéretet.

## Összegzés

**Lezárási eredmény: 32/32 megállapítás RESOLVED.** A jelenlegi kód alkalmas további paper/testnet tesztelésre és kontrollált burn-inre. A live order lifecycle, risk/leverage, emergency flatten, MTF stratégiaadatok, backtest-időablakok, statikus fájlkiszolgálás, dashboard URL-képzés, coverage/E2E pipeline és dependency audit mind közvetlen regressziós bizonyítékot kapott.

Valódi Bybit credentiallel hitelesített live ordert nem küldtünk. A paper/testnet burn-in, a jogosultságok, instrumentum-specifikus minimumok, rate limit, hálózati hibák és operátori runbook ellenőrzése ezért továbbra is szükséges üzemeltetési validáció. Ez nem nyitott kódreview-megállapítás, hanem a live bevezetés kötelező következő kapuja.

## Megállapítások

### P1 — live trading, risk és konfiguráció

1. **RESOLVED — A bot nem iratkozik fel a stratégia konfigurált LTF-jére.** Az eredeti kockázat az volt, hogy a 15m Donchian LTF nem jut el a stratégiához. A Bot most a registryből számított, stratégiánként szükséges timeframe-ekre iratkozik fel (`apps/bot/src/bot/bot.ts:916`), és a runner csak a policyhez tartozó idősíkokat dolgozza fel. Regresszió: a Bot és StrategyRunner timeframe-routing tesztjei, valamint a végső root tesztfutás.

2. **RESOLVED — A runner nem épít valódi MTF indikátorállapotot, és minden timeframe-et minden stratégiához továbbít.** A runner külön zártbar-bufferből épít HTF/MTF/LTF állapotot (`apps/bot/src/bot/strategy-runner.ts:195`, `apps/bot/src/bot/strategy-runner.ts:337`); a Donchian upper/lower és ATR valódi timeframe-adatból készül. Regresszió: több-timeframe warmup, routing és signal-producing Donchian tesztek.

3. **RESOLVED — A live stratégia nyitott és ismételt candle-frissítéseken is kereskedhet.** A feed csak lezárt gyertyát ad tovább, subscriptionönként timestamp-deduplikál (`packages/exchange/src/bybitEuFeed.ts:788`, `packages/exchange/src/bybitEuFeed.ts:814`). A websocket open/repeat/late-final/reconnect és a REST fallback ismétlés külön tesztelt. A Bybit dokumentáció szerint csak `confirm=true` jelenti a zárt kline-t: [Bybit WebSocket Kline](https://bybit-exchange.github.io/docs/v5/websocket/public/kline).

4. **RESOLVED — Az OHLCV event→order útvonal nincs szerializálva.** A runner szimbólumonkénti promise-láncon szerializálja a market-, order- és execution-eseményeket (`apps/bot/src/bot/strategy-runner.ts:337`, `apps/bot/src/bot/strategy-runner.ts:946`), így egy függő order alatt a következő candle nem lát elavult pozícióállapotot. Regresszió: párhuzamos OHLCV/order-emission és private lifecycle race tesztek.

5. **RESOLVED — A live entryhez hibás CCXT TP/SL paraméterezés társul.** Az entry már nem kap vakon `stopLossPrice`/`takeProfitPrice` mezőt. A visszaigazolt fill után külön védelmi orderek készülnek; spotnál `StopOrder`, kontraktusnál reduce-only/close-on-trigger szemantikával (`packages/exchange/src/bybitEuFeed.ts:525`, `apps/bot/src/bot/strategy-runner.ts:1049`). A cancel/replace csak private terminális bizonyíték után cserél, sikertelenségkor fail-safe close fut (`apps/bot/src/bot/strategy-runner.ts:1128`, `apps/bot/src/bot/strategy-runner.ts:1189`). Regresszió: fill-before-cancel, cancel-before-fill, failed cancel, partial fill és spot/contract protection tesztek. Primer szabályok: [Bybit Place Order](https://bybit-exchange.github.io/docs/v5/order/create-order), [CCXT TP/SL FAQ](https://github.com/ccxt/ccxt/wiki/FAQ#how-to-create-an-order-with-takeprofitstoploss).

6. **RESOLVED — Minden sikeres create-order válasz teljes fillként kerül a könyvbe.** A create válasz csak ACK; könyvelés kizárólag private order/execution vagy hiteles fallback státusz alapján történik. A feed `watchOrders` és `watchMyTrades` streamet ad (`packages/exchange/src/bybitEuFeed.ts:874`, `packages/exchange/src/bybitEuFeed.ts:897`), a runner exec-id/order progress deduplikációval kezeli az order→execution, execution→order, duplikált Filled, cancel race és restart sorrendeket. Regresszió: lifecycle, zero-ticker és stream-cleanup tesztek. A Bybit create ACK aszinkron: [Place Order](https://bybit-exchange.github.io/docs/v5/order/create-order); egy orderhez több execution jöhet: [Execution stream](https://bybit-exchange.github.io/docs/v5/websocket/private/execution); a privát cache szemantikája: [CCXT Pro manual](https://github.com/ccxt/ccxt/wiki/ccxt.pro.manual).

7. **RESOLVED — A sizing fix 1%-os risket használ.** A globális `risk.risk_per_trade` és a per-strategy override ténylegesen eljut a runnerhez (`apps/bot/src/bot/bot.ts:781`, `apps/bot/src/bot/strategy-runner.ts:785`), majd a sizing függvény ezt használja (`apps/bot/src/bot/strategy-runner.ts:1405`). Regresszió: 0,1%-os és eltérő strategy-policy sizing tesztek.

8. **RESOLVED — A konfigurált max leverage nincs végigvezetve.** A globális limit a PositionManager, OrderManager és StrategyRunner közös invariantja (`apps/bot/src/bot/bot.ts:561`, `apps/bot/src/bot/bot.ts:691`); az effektív strategy leverage nem lépheti túl (`apps/bot/src/bot/strategy-runner.ts:741`, `apps/bot/src/bot/order-manager.ts:281`). Regresszió: `max_leverage=1`, cap és fill-bookkeeping tesztek.

9. **RESOLVED — Paper módban a signal SL/TP szintjei elvesznek.** A paper executor a fill után a signal stop/target értékeit a pozícióba viszi, a runner zárt candle high/low alapján determinisztikusan ellenőrzi az SL/TP-t (`apps/bot/src/bot/strategy-runner.ts:894`, `apps/bot/src/bot/strategy-runner.ts:1259`). Regresszió: paper long/short SL, TP és ugyanazon candle konzervatív ütközési tesztek.

10. **RESOLVED — A registry kill-switch nem zárja vagy cancelálja a live exchange kitettséget.** Egy Bot-tulajdonú emergency coordinator előbb pause-ol, cancelálja a tracked ordereket, majd authoritative venue pozíciót és spot balanszt flattenel; a feed csak teljes rendezés után áll le (`apps/bot/src/bot/bot.ts:1018`, `apps/bot/src/bot/bot.ts:1034`). Regresszió: lokális, venue-only derivative és venue-only spot open→partial→filled close-all tesztek, ismételt heartbeat mellett is egy orderrel.

11. **RESOLVED — A risk.max_drawdown_pct kill-switch nem kap equity-frissítést.** A Bot minden hiteles állapotfrissítés után authoritative vagy lokális equityt vezet a kill-switch registrybe (`apps/bot/src/bot/bot.ts:1142`, `apps/bot/src/bot/bot.ts:1148`). Regresszió: peak→drawdown trigger és private balance/equity update tesztek.

12. **RESOLVED — A záró ordereket az L2 guard új kitettségként számolja.** Az OrderManager felismeri a `reduceOnly` intentet, az oldalt és a lezárható authoritative mennyiséget; a cap csak a nettó új kitettséget tiltja (`apps/bot/src/bot/order-manager.ts:292`, `apps/bot/src/bot/order-manager.ts:304`). Regresszió: cap-közeli teljes és részleges safety close, valamint over-close elutasítás.

13. **RESOLVED — A portfolio close-all hibásan latchel, és a sikeres close-t sem könyveli.** A PortfolioManager pending-close journalt vezet, deduplikálja a close intentet, partial/cancel után csak a maradékot küldi, és csak friss authoritative flat pozíció/balansz után latchel (`apps/bot/src/portfolio/portfolio-manager.ts:191`, `apps/bot/src/portfolio/portfolio-manager.ts:586`). Regresszió: `apps/bot/src/portfolio/portfolio-manager.test.ts:271`–`499` delayed fill, partial, retry, venue-only spot/derivative és unresolved feed-alive esetek.

14. **RESOLVED — A konfigurált RiskManager nincs productionbe kötve.** A Bot példányosítja és mind a PositionManagerhez, mind a runnerhez csatolja (`apps/bot/src/bot/bot.ts:574`, `apps/bot/src/bot/bot.ts:596`, `apps/bot/src/bot/strategy-runner.ts:267`). A Kelly, drawdown scaler és trailing stop order-producing close útvonalon fut. Regresszió: opt-in risk feature és trailing close tesztek.

15. **RESOLVED — A dashboard Pause csak UI flag.** A CLI control a Bot/runner `pause()` és `resume()` metódusát hívja; a runner belépéskor és közvetlenül order emission előtt is gate-el (`apps/bot/src/bot/bot.ts:323`, `apps/bot/src/bot/strategy-runner.ts:339`, `apps/bot/src/bot/strategy-runner.ts:839`). Regresszió: pause-during-inflight és dashboard lifecycle tesztek.

16. **RESOLVED — A friss paper telepítés hamis credentiallel private API-t hív.** A `.env.example` credential mezői üresek; paper módban credential nélkül kizárólag public market-data kliens készül, a private balance fetch kimarad (`apps/bot/src/bot/bot.ts:507`, `apps/bot/src/bot/bot.ts:537`). Regresszió: friss `cp .env.example .env` paper startup és no-private-call teszt.

17. **RESOLVED — Az enabled production pluginok inertek.** A runner az enabled pluginok `onBar` lifecycle-ját valódi plugin state-tel meghívja (`apps/bot/src/bot/strategy-runner.ts:675`); risk breach esetén szinkron pause/emergency latch tilt minden további entryt explicit resume-ig (`apps/bot/src/bot/strategy-runner.ts:538`, `apps/bot/src/bot/strategy-runner.ts:690`). Regresszió: valódi enabled risk plugin + signal-producing strategy breach és subsequent-candle teszt.

18. **RESOLVED — A per-strategy safety override-ok nagy része nincs végrehajtva.** A Bot teljes strategy-policy mapet épít symbols/risk/max_positions/leverage értékekkel (`apps/bot/src/bot/bot.ts:802`), a runner a strategy policy alapján route-ol és méretez (`apps/bot/src/bot/strategy-runner.ts:244`, `apps/bot/src/bot/strategy-runner.ts:377`). Regresszió: BTC-only stratégia, strategy max-position és eltérő risk/leverage tesztek.

19. **RESOLVED — Az exchange safety/performance config nem jut el a factoryhoz.** A Bot átadja a `rate_limit_ms`, `sandbox`, `timeout_ms`, REST és WS origin értékeket (`apps/bot/src/bot/bot.ts:517`); a factory és adapter validálja és alkalmazza őket (`packages/exchange/src/factory.ts:83`, `packages/exchange/src/bybitEuFeed.ts:185`). A sandbox és custom endpoint tiltott kombinációja fail-fast. Regresszió: factory config és malformed-origin tesztek.

20. **RESOLVED — A REST OHLCV fallback minden másodpercben újrajátssza az utolsó 100 gyertyát.** Subscription-szintű `lastEmittedTimestamp` szűri az ismétlést (`packages/exchange/src/bybitEuFeed.ts:788`, `packages/exchange/src/bybitEuFeed.ts:814`), és minden fallback wait abortálható timer-szivárgás nélkül. Regresszió: ismételt historikus batch, unsubscribe és reconnect tesztek.

### P1 — backtest validitás és workflow

21. **RESOLVED — A backtest figyelmen kívül hagyja az endTime-ot.** A bemenet `[startTime,endTime)` ablakra és teljes LTF candle-zárásra szűr (`packages/backtest/src/engine.ts:178`, `packages/backtest/src/engine.ts:198`). Regresszió: nem igazított endTime, ablakhatár és OOS overlap tesztek.

22. **RESOLVED — A HTF/MTF aggregáció look-ahead bias-t okoz.** A backtest csak teljesen lezárt aggregált bucketet publikál, és a decision time előtt befejezett gyertyát engedi a stratégiának (`packages/backtest/src/engine.ts:112`, `packages/backtest/src/engine.ts:203`). Regresszió: bucket első LTF-jén láthatatlan jövőbeli high/low/close, egymás melletti window és boundary tesztek. A Bybit REST kline `start`/`end` mezői: [Get Kline](https://bybit-exchange.github.io/docs/v5/market/kline).

23. **RESOLVED — A terminal és kill-switch close P&L-je kimarad az equity curve-ből.** A terminal/kill close realizált P&L-je és költsége `recordEquityPoint` útvonalon bekerül a végpontba (`packages/backtest/src/engine.ts:162`, `packages/backtest/src/engine.ts:474`), a görbe endTime pontig normalizált (`packages/backtest/src/engine.ts:488`). Regresszió: terminal fee/P&L, kill close és monoton timestamp tesztek.

24. **RESOLVED — A három dokumentált root backtest workflow törött.** A package scriptek létező `run-baseline.ts`, `run-sweep.ts`, `run-oos.ts` entrypointokra mutatnak (`packages/backtest-tools/package.json:16`). Mindhárom root CLI help/smoke exit 0, és workflow E2E teszt fedi az argumentum- és output-szerződést.

### P2 — security, dashboard, paper és tooling

25. **RESOLVED — A static handler abszolút path traversalt enged.** A handler dekódolás előtt tiltja az encoded slash/backslash alakot, POSIX és Windows abszolút utat ellenőriz, `relative` containmentet és canonical `realpath` ellenőrzést végez (`apps/bot/src/web-client/static-server.ts:258`, `apps/bot/src/web-client/static-server.ts:277`, `apps/bot/src/web-client/static-server.ts:327`). Regresszió: `%2Fetc%2Fhosts`, drive/UNC, `..`, symlink escape és normál asset. A használt primitívek: [Node.js path](https://nodejs.org/api/path.html), [Node.js fs realpath](https://nodejs.org/api/fs.html#fsrealpathsyncpath-options).

26. **RESOLVED — A dashboard URL-jei fixen a 7913-as loopback portra vannak égetve.** A WS és REST URL-ek az aktuális `window.location` originből készülnek (`apps/web/src/lib/dashboard-url.ts:1`, `apps/web/src/ws-client.ts:145`, `apps/web/src/components/ControlBar.tsx:11`). Regresszió: custom port, HTTPS→WSS, base path és SSR fallback unit tesztek.

27. **RESOLVED — Mind a négy REST fallback loop intervalokat szivárogtat.** A polling wait AbortController-alapú, minden timeout/listener cleanup terminális ágon lefut (`packages/exchange/src/bybitEuFeed.ts:154`, `packages/exchange/src/bybitEuFeed.ts:665`). Regresszió: ticker/orderbook/trades/OHLCV NotSupported fallback, pending fetch unsubscribe és timer/listener leak tesztek.

28. **RESOLVED — A legacy PaperTrader hibásan könyveli az ellenirányú fillt.** A csökkentés megőrzi a maradó pozíció átlagárát, flipnél csak az új oldal kap új átlagárat, a cash előjele vétel/eladás szerint helyes (`packages/paper/src/paper-trader.ts:191`). Regresszió: long 2@100 + sell 1@150, teljes zárás, long→short és short→long cash/equity tesztek.

29. **RESOLVED — A strategy forceExit csak lokális pozíciót zár.** A force-exit és trailing stop a PortfolioManager közös deduplikált, reduce-only `requestPositionClose` útvonalát használja (`apps/bot/src/bot/strategy-runner.ts:438`, `apps/bot/src/portfolio/portfolio-manager.ts:738`); csak confirmed close után hívódik `onPositionClosed`. Regresszió: live/paper forceExit, partial és duplicate-close tesztek.

30. **RESOLVED — A coverage:full wrapper false-green és stale eredményt adhat.** A pipeline törli a stale outputot, megőrzi minden producer exit kódját, fresh inputot követel, és repo-owned LCOV-ot épít. A per-package gate közvetlen `LF`/`LH` számlálást használ (`scripts/coverage-full.sh:1`, `scripts/coverage-per-package.sh:64`), a szintetikus hibateszt bizonyítja, hogy producer-fail és stale input nem lehet zöld. Végső eredmény: 7/7 OWN package 100% line coverage. Fontos: ez a Bun által az adott futásban **betöltött/instrumentált saját `src/` fájlokra** vonatkozik; nem állítja, hogy a repository minden forrásfájlja automatikusan bekerült. A merge 56,2%-os száma információs, mert a Bun LCOV cross-workspace betöltött forrásokat is tartalmaz. Hivatalos szemantika: [Bun code coverage](https://bun.sh/docs/test/code-coverage), [LCOV](https://github.com/linux-test-project/lcov).

31. **RESOLVED — Az E2E suite nem hermetikus: tracked fájlt ír, és orphan preview szervert hagyhat.** A screenshot teszt kizárólag coverage artefaktumba ír; `.mavis` nem keletkezik. A Playwright mindig saját fresh instrumentált preview-t indít `reuseExistingServer:false` és graceful shutdown beállítással (`apps/web/playwright.config.ts:115`, `apps/web/playwright.config.ts:128`). A feed-indicator flake az azonnali `count()` helyett exact, auto-retry `toHaveCount(2)` és `toHaveText(["Live","Live"])` web-first assertiont használ (`apps/web/e2e/dashboard.spec.ts:584`). Végső E2E: CT 16/16; browser 312 pass, 1 skip, 0 fail; lifecycle 1/1 és a 7913 port szabad. Hivatalos szemantika: [Playwright webServer](https://playwright.dev/docs/test-webserver), [Playwright auto-retrying assertions](https://playwright.dev/docs/test-assertions).

### P3 — dependency tooling

32. **RESOLVED — A dependency audit 4 advisoryt jelez.** Az NYC 18-ra frissült, a webes toolchain explicit javított verziókat kapott (`apps/web/package.json:40`); a kompatibilis same-major tranzitív javítások `nanoid@3.3.17`, `postcss@8.5.26`, `js-yaml@3.15.1`, miközben a korábbi `uuid@11.1.1` javítás megmaradt (`package.json:73`). A sérülékeny brace-expansion 1.x lánc eltűnt; a jelenlegi 2.x/5.x ágak kompatibilisek. `bun install --frozen-lockfile` és `bun audit` exit 0, **No vulnerabilities found**. Az override-ok csak igazolt, kompatibilis parent range-eket fednek; Bun csak top-level override-ot támogat: [Bun overrides](https://bun.sh/docs/pm/overrides). Advisoryk: [brace-expansion GHSA-rgw5-rvv9-x895](https://github.com/advisories/GHSA-rgw5-rvv9-x895), [nanoid GHSA-2v37-7h3g-55p8](https://github.com/advisories/GHSA-2v37-7h3g-55p8), [PostCSS GHSA-fxqj-rqcc-2cmp](https://github.com/advisories/GHSA-fxqj-rqcc-2cmp), [js-yaml GHSA-5p4m-2wfm-xmqj](https://github.com/advisories/GHSA-5p4m-2wfm-xmqj).

## A review közben feltárt és lezárt másodlagos regressziók

- **Deterministic startup lifecycle.** A startup state csak a valós lifecycle pontokon vált, a Phase72 valódi Bybit smoke explicit `RUN_SYSTEM_TEST` opt-in; a default tesztfutás determinisztikus és nem függ külső hálózattól.
- **Explicit Bybit V5 client-order-id útvonal.** A pinelt CCXT 4.5.64 generikus `*WithClientOrderId` útja üres `orderId`/rossz mező alakot készített. Az adapter bounded metadata ledgerrel explicit `orderLinkId`-t küld, spot `Order`/`StopOrder` filterrel és `acknowledged:true` lookup-pal (`packages/exchange/src/bybitEuFeed.ts:120`, `packages/exchange/src/bybitEuFeed.ts:568`). Az offline pinned request-builder próba pontos spot `category`, `orderFilter` és `orderLinkId` alakot igazolt. A Bybit cancel szerződés: [Cancel Order](https://bybit-exchange.github.io/docs/v5/order/cancel-order); history filterek: [Get Order History](https://bybit-exchange.github.io/docs/v5/order/order-list).
- **Aszinkron protection/execution journal.** Late fill, részleges fill, cancel race, duplikált Filled és restart után is egyetlen authoritative quantity marad; védelmi order sosem nőhet a megerősített exposure fölé.
- **Repo-owned LCOV gate.** A package saját forrását a betöltött cross-workspace forrásoktól szétválasztó exact `LF/LH` gate és a szintetikus negatív tesztek megszüntették a false-green/stale eredményt.
- **E2E web-first várakozás.** A dashboard egészséges feedje exact szám- és szövegassertionnal várja meg a React/REST render végét; nincs arbitrary sleep.
- **Aktuális dependency lánc.** `bun pm why` igazolta az alkalmazott patch-eket, a lockfile a Bun package managerrel készült, frozen install és audit tiszta.

## Végső gate-ek

| Gate | Végső eredmény |
|---|---:|
| `bun install --frozen-lockfile` | PASS |
| `bun run build` | PASS — 8/8 task |
| `bun run typecheck` | PASS — 13/13 task |
| `bun run lint` | PASS — 8/8 task, 0 error |
| `bun run test` | PASS — 13/13 task; bot 1068 pass, 1 explicit opt-in system skip, 0 fail |
| `bun run coverage:full` | PASS — tests 13/13, coverage 12/12, exit 0 |
| OWN line coverage | PASS — bot 8009/8009; paper 253/253; exchange 1474/1474; core 12230/12230; shared 189/189; backtest 814/814; backtest-tools 2289/2289 |
| Synthetic coverage gates | PASS |
| Playwright CT | PASS — 16/16 |
| Playwright browser E2E | PASS — 312 pass, 1 skip, 0 fail; 20,9 perc |
| Web merged coverage | PASS — 86,39% line; 77,17% branch; 84,75% function; gate 75/75/75 |
| Playwright lifecycle | PASS — 1/1; owned preview leállt; port 7913 szabad |
| Root CLI help (`backtest`, `sweep`, `oos`) | PASS — mind exit 0 |
| `bun audit` | PASS — No vulnerabilities found |
| `git diff --check` | PASS |

## Webes validáció összefoglaló

- Bybit market data és zártbar-szemantika: [WebSocket Kline](https://bybit-exchange.github.io/docs/v5/websocket/public/kline), [REST Kline](https://bybit-exchange.github.io/docs/v5/market/kline).
- Bybit order lifecycle: [Place Order](https://bybit-exchange.github.io/docs/v5/order/create-order), [Cancel Order](https://bybit-exchange.github.io/docs/v5/order/cancel-order), [Private Order](https://bybit-exchange.github.io/docs/v5/websocket/private/order), [Private Execution](https://bybit-exchange.github.io/docs/v5/websocket/private/execution), [Private Wallet](https://bybit-exchange.github.io/docs/v5/websocket/private/wallet).
- CCXT/CCXT Pro: [CCXT manual](https://github.com/ccxt/ccxt/wiki/manual), [CCXT Pro manual](https://github.com/ccxt/ccxt/wiki/ccxt.pro.manual).
- Tooling: [Bun test coverage](https://bun.sh/docs/test/code-coverage), [Bun overrides](https://bun.sh/docs/pm/overrides), [Playwright webServer](https://playwright.dev/docs/test-webserver), [Playwright assertions](https://playwright.dev/docs/test-assertions), [Node path](https://nodejs.org/api/path.html), [Node fs realpath](https://nodejs.org/api/fs.html#fsrealpathsyncpath-options).

## Korlát és következő üzemeltetési kapu

Valódi Bybit credentiallel live ordert nem küldtünk. A kódreview megállapításai lezártak, de live indulás előtt külön paper/testnet burn-in szükséges: minimum order/precision, részleges fill, websocket reconnect, rate limit, API-jogosultság, emergency runbook és operátori resume ellenőrzéssel. A burn-in eredménye külön üzemeltetési döntés; nem írja felül a fenti kód- és tesztbizonyítékot.
