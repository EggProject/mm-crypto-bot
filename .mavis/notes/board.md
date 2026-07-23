# mm-crypto-bot — Project Board

**Last updated:** 2026-07-23 09:52 Budapest

## Phase 66 (2026-07-23) — paper mode = REAL bybit.eu, no mock feed, bar flow fix

### User mandate (2026-07-23 07:59 Budapest)
- **NO mock feed** for paper mode — paper mode MUST use real bybit.eu market data (ticker + OHLCV)
- **Backtest** uses downloaded OHLCV data via `bun run ohlcv` → `bun run backtest`
- **Paper mode** = real-time bybit.eu, NO order sending (simulated fills)
- **Live mode** = real bybit.eu + real orders + `BYBIT_API_KEY`

### Phase-66 scope doc
`.mavis/notes/phase-66-scope.md` — file-by-file plan + verification checklist

### TODO (top-line: `execution discipline: no-stop, no-ask, just-do` + `MANDATORY continuous-planning rule`)

- [x] protobufjs telepítése + bun.lock frissítés
- [x] apps/bot/package.json: --external protobufjs ELTÁVOLÍTÁSA a build scriptből
- [x] bot.ts: paper mode → valódi bybit.eu feed (mock kivéve), empty-cred override, fetchBalances skip, OHLCV subscription, publishBar hook
- [x] bybitEuFeed.ts: runTickerLoop + runOhlcvLoop polling fallback NotSupported esetén
- [x] ws-client.ts: VITE_WS_URL támogatás
- [x] order-manager.ts: paperMode flag + szintetikus fill (NEM feed.placeOrder)
- [x] bot.ts: Bot.attachStateFeed + stateFeed mező
- [x] start.ts: bot.attachStateFeed(stateFeed) hívás az attachStateFeed UTÁN
- [x] vezérlőgombok design: apps/web/src/styles/control-bar.css + eggproject-design/
- [x] main.tsx import: control-bar.css
- [x] board.md + phase-66-scope.md (TERVEZÉS ELŐBBE, MEMORY MANDATE)
- [x] **build (turbo) + restart + screenshot — KÉSZ**
  - [x] bot indítása a HELYES cwd-ből (`/Users/kiscsicska/projects/mm-crypto-bot`)
  - [x] log ellenőrzés: feed opened,exchangeId:bybiteu + published bar + NINCS apiKey error
  - [x] web 7913 + screenshot — **9 REAL OHLCV CHARTS RENDERELVE (BTC/ETH/SOL × 1h/4h/1d)**
- [x] state-feed/index.ts: auto-create OhlcStore ha nincs megadva (SNAPSHOT ohlcBootstrap mostantól 200 bar × 9 key)
- [x] ws-relay.ts: cache last snapshot, replay az új böngésző nyitáskor (nélküle a browser csak a `bar` event-eket látta, a bootstrap snapshot-ot nem)
- [x] web.ts: --web-dist-dir flag + MM_BOT_WEB_DIST_DIR env var (a built bundle path-feloldás bug megkerüléséhez)
- [x] app-helpers.ts: buildStatusLabel defensive Array.isArray check (snapshot.strategies undefined esetén nem crashel)
- [x] run-bot/config/test-no-strategy.toml: NEW (Phase 66 screenshot test config — max_positions=12, only donchian_pivot_composition)
- [x] scripts/verify-phase-66-real-browser.mjs: NEW (Playwright screenshot script)
- [ ] **PR (Phase 66)**: 9 modified + 3 untracked files, branch `phase-66-paper-realtime-bybit-eu` — JELENLEG A CÉL
- [ ] **HOT memory** frissítés a Phase 66 tanulságokkal

### Phase status: 🟢 IMPLEMENTATION + VERIFICATION DONE, PR PENDING
- A 12 fájl módosítás MIND kész a lemezen (`git status` szerint)
- A build 8/8 sikeres (turbo + manuális bot rebuild a cache bypass-hoz)
- A bot log: `feed opened,exchangeId:bybiteu` + 600+ `published bar` 10 sec alatt (real BTC 64681.4, ETH 1929.54, SOL ...)
- A web 7913 + state-feed 7924 aktív
- A SCREENSHOT KÉSZ: 9 valódi candlestick chart (BTC/ETH/SOL × 1h/4h/1d), WebSocket: connected (zöld), EggProject dark theme, gold Start / red Kill Switch
- Screenshot: `.mavis/notes/phase-66-dashboard.png` (93KB, 1600×1000)

### Verification proof
- Bot log (`/tmp/bot-p66.log`): `"[bot] feed opened","exchangeId":"bybiteu"` + `"[bot] published bar","symbol":"BTC/USDC","timeframe":"1h","close":64681.4` (többszáz sor)
- Snapshot ohlcBootstrap check (`bun run /tmp/check-ohlc.mjs`): `BTC/USDC 1h: 200 bars`, `BTC/USDC 4h: 200 bars`, ... (9 key × 200 bar)
- WebSocket inspection (`bun run /tmp/inspect-ws.mjs`): bar events streaming, snapshot event with ohlcBootstrap received
- Browser screenshot (`.mavis/notes/phase-66-dashboard.png`): 9 candlestick charts rendered, "WebSocket: connected" green pill, EggProject control bar at bottom

### Lesson learned (HOT memory)
- A `cd apps/bot && bun run apps/bot/dist/index.js` a cd UTÁN a relatív path-t az apps/bot-hoz KÉPEST oldja fel → "Module not found". Helyes: `bun run /Users/kiscsicska/projects/mm-crypto-bot/apps/bot/dist/index.js` (abszolút path) VAGY `cd /Users/kiscsicska/projects/mm-crypto-bot && bun run apps/bot/dist/index.js` (root cwd-ből).
- A `Bot.ts` `stateFeed` mező HIÁNYZOTT — a `this.stateFeed !== null` ellenőrzés a kódban TypeScript hibát ADOTT VOLNA, de a build átment. Ennek oka: a `stateFeed` mezőt egy korábbi sessionben hozzáadtam, de a `git stash` UTÁN nem adtam vissza. Most hozzáadva.
- A `mm-bot web` a built bundle-t `apps/bot/dist/web-client/index.js` útvonalon KERESI (`resolveWebDistDir` 4-szer `dirname`-el felold), de a bun `--target=bun` single bundle-t készít `apps/bot/dist/index.js`-be. A path-feloldás EGY szinttel rövidebb, mint a source → `apps/web/dist` helyett a `/Users/<user>/apps/web/dist`-et keresi. Workaround: `MM_BOT_WEB_DIST_DIR=/abs/path/apps/web/dist` env var (Phase 66 fix a `web.ts`-ben).
- A `bun run build` (turbo) CACHE-ELI a `bun build` output-ot, és `touch` NEM invalidálja a cache-t. Ha a bot kódját módosítom, a `cd apps/bot && bun build src/index.ts --target=bun --outdir=dist --format=esm` manuális rebuild KELL, különben a régi bundle fut.
- A `state-feed` `handleOpen` a TCP-socket-en küld HELLO+SNAPSHOT-ot — DE a `ws-relay` egy külön réteg a state-feed ÉS a böngésző között. A relay az első connect-kor megkapja a SNAPSHOT-ot, de a KÉSŐBB csatlakozó böngészők NEM. A relay `open` handler-ében cache-elni + replay-elni kell az utolsó snapshot-ot (`ws-relay.ts` Phase 66 fix).
- A `apps/web/src/App.tsx` `useState` initial értékben `BTCUSDT` volt (NO SLASH), a server response `BTC/USDC` (WITH SLASH). Ez a default a Phase 52F MSW-hoz készült, nem a production-höz — de a `barsByKey` check ettől független: `Object.keys(barsByKey).length > 0`. Tehát ha a snapshot `ohlcBootstrap` üres, a dashboard "No charts configured"-ot mutat, függetlenül a strategy nevektől.
- A `buildStatusLabel` line 161 `(snapshot.strategies.length)`-et olvas, de az `App.tsx` a `useWebSocket()`-ból jövő `snapshot`-ot adja át (ami a teljes ServerMessage, NEM a StateFeedSnapshot). A message `strategies` mezője undefined a `StateFeedSnapshotMessage` protokoll szerint (csak a belső `snapshot.strategies` van). Az `Array.isArray` check hozzáadása (`app-helpers.ts` Phase 66 fix) megoldja, de a `snapshot.snapshot.strategies` használata lenne a "helyes" megoldás hosszú távon.

### Open questions for user (post-verification)
- A `donchian_pivot_composition` stratégia minden ticknél új pozíciót nyit, SOHA nem zár → L2 leverage cap elbukik 2-3 perc után. Ez stratégia-hiba, nem Phase 66 hiba. Külön PR.
- A `PaperTrader` (`packages/paper`) bypass-olva van a thin wrapper miatt — future work a PnL tracking rendes szimulációjához.
