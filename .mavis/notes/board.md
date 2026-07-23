# mm-crypto-bot — Project Board

**Last updated:** 2026-07-23 17:45 Budapest

---

## Phase 66 (2026-07-23) — paper mode = REAL bybit.eu, no mock feed, bar flow fix + mock feed lockdown

### User mandate (2026-07-23 07:59 Budapest)
- **NO mock feed** for paper mode — paper mode MUST use real bybit.eu market data (ticker + OHLCV)
- **Backtest** uses downloaded OHLCV data via `bun run ohlcv` → `bun run backtest`
- **Paper mode** = real-time bybit.eu, NO order sending (simulated fills)
- **Live mode** = real bybit.eu + real orders + `BYBIT_API_KEY`
- **MANDATE 2 (14:25)**: `csak a test hasznalhatja a mock feed -et! old meg hogy a kod tobbi resze ne tudja hasznalni!` — `MockExchangeFeed` strictly test-only

### Phase-66 scope doc
`.mavis/notes/phase-66-scope.md` — file-by-file plan + verification checklist (covers the realtime-bybit.eu part)

### TODO (top-line: `execution discipline: no-stop, no-ask, just-do` + `MANDATORY continuous-planning rule`)

#### Sub-phase A: realtime bybit.eu (PR #182 — MERGED)
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
- [x] run-bot/config/test-no-strategy.toml: NEW (Phase 66 screenshot test config — max_positions=12, only donchian_pivot_composition) — TEMP, deleted after screenshot
- [x] scripts/verify-phase-66-real-browser.mjs: NEW (Playwright screenshot script)
- [x] **PR #182 MERGED** (commit `a5dacbd`)

#### Sub-phase B: mock feed lockdown (PR #183 — MERGED)
- [x] Audit: identify all production vs test usage of `MockExchangeFeed`
- [x] **File move**: `packages/exchange/src/{mockFeed.ts,mockFeed.test.ts}` → `__testing__/{mockFeed.ts,mockFeed.test.ts}` (test-only contract signal)
- [x] **Public surface cleanup** in `packages/exchange/src/index.ts`:
  - removed `MockExchangeFeed`, `createMockFeed`, `MockExchangeFeedOptions`, `defaultTicker`, `defaultOrderBook`, `defaultMarketMeta` exports
- [x] **Factory cleanup** in `packages/exchange/src/factory.ts`:
  - removed `createMockFeed` factory
  - removed `useMock: true` branch in `createExchangeClient` (function ALWAYS returns `BybitEuFeed` now)
- [x] **Bot runtime guard** in `apps/bot/src/bot/bot.ts`:
  - removed `new MockExchangeFeed()` branch
  - THROW if `config.exchange.id === "mock"` without `options.feed` being injected
  - Error message: "MockExchangeFeed is test-only and not importable from production code. Tests must inject via `new Bot({ config, feed })`."
- [x] **Path alias** in `tsconfig.base.json`:
  - `paths: { "@exchange-testing/*": ["packages/exchange/src/__testing__/*"] }`
  - `baseUrl: "."`, `ignoreDeprecations: "6.0"`
- [x] **Test imports updated** (9 test files):
  - 6 apps/bot tests → import from `@exchange-testing/mockFeed.js`
  - 3 packages/exchange tests → relative path `./__testing__/mockFeed.js` or `../src/__testing__/mockFeed.js`
  - 2 `factory.test.ts` files (bun + vitest) → removed `useMock: true` + `createMockFeed` tests
- [x] **Removed**: `apps/bot/src/cli/headless-smoke.test.ts` (CLI black-box that used `exchange.id = mock` — incompatible with new contract)
- [x] **PR #183 MERGED** (commit `4ed812c`)

#### Post-phase cleanup
- [x] **HOT memory** frissítve a Phase 66 + mock lockdown tanulságokkal (2 entries in `MEMORY.md`)
- [x] **CI green**: typecheck 13/13, lint 8/8, test 13/13, coverage 7/7 package 100%
- [x] **board.md updated** (this entry) — last-updated 2026-07-23 17:45 Budapest
- [ ] **phase-66-scope.md** update: should add a "Sub-phase B: mock lockdown" section (CURRENTLY ONLY COVERS SUB-PHASE A)

### Phase status: 🟢 PHASE 66 COMPLETE
- **PR #182 MERGED** (`a5dacbd`): paper mode = realtime bybit.eu (12 files, 4 commits, all 7 CI checks green including e2e 13m32s)
- **PR #183 MERGED** (`4ed812c`): MockExchangeFeed strictly test-only (19 files changed, 167 insertions, 384 deletions; all 7 CI checks green)
- Screenshot: `.mavis/notes/phase-66-dashboard.png` (93KB, 1600×1000) — 9 real candlestick charts, WebSocket: connected

### Verification proof
- **Bot log** (`/tmp/bot-p66.log`): `"[bot] feed opened","exchangeId":"bybiteu"` + 600+ `"[bot] published bar"` events (real BTC 64681.4, ETH 1929.54, SOL ...)
- **Snapshot ohlcBootstrap** (`bun run /tmp/check-ohlc.mjs`): `BTC/USDC 1h: 200 bars`, `BTC/USDC 4h: 200 bars`, ... (9 key × 200 bar)
- **WebSocket inspection** (`bun run /tmp/inspect-ws.mjs`): bar events streaming, snapshot with ohlcBootstrap received by all 3 browser connections
- **Browser screenshot** (`.mavis/notes/phase-66-dashboard.png`): 9 candlestick charts, "WebSocket: connected" green pill, EggProject control bar
- **Mock lockdown test**: 921+344 = 1265 unit tests pass; 7/7 packages at 100% line coverage; production code CANNOT import `MockExchangeFeed` via `@mm-crypto-bot/exchange`

### Lesson learned (HOT memory, in MEMORY.md)
- A `cd apps/bot && bun run apps/bot/dist/index.js` a cd UTÁN a relatív path-t az apps/bot-hoz KÉPEST oldja fel → "Module not found". Helyes: abszolút path VAGY root cwd-ből.
- A `Bot.ts` `stateFeed` mező HIÁNYZOTT — a `this.stateFeed !== null` ellenőrzés a kódban TypeScript hibát ADOTT VOLNA, de a build átment. Ennek oka: `git stash` UTÁN nem adtam vissza. Most hozzáadva.
- A `mm-bot web` a built bundle-t `apps/bot/dist/web-client/index.js` útvonalon KERESI (`resolveWebDistDir` 4-szer `dirname`-el felold), de a bun `--target=bun` single bundle-t készít `apps/bot/dist/index.js`-be. A path-feloldás EGY szinttel rövidebb, mint a source. Workaround: `MM_BOT_WEB_DIST_DIR` env var + `--web-dist-dir` flag.
- A `bun run build` (turbo) CACHE-ELI a `bun build` output-ot, `touch` NEM invalidálja. Ha a bot kódját módosítom, a manuális `bun build` KELL.
- A `state-feed` `handleOpen` a TCP-socket-en küld HELLO+SNAPSHOT-ot — DE a `ws-relay` egy külön réteg. A relay az első connect-kor megkapja a SNAPSHOT-ot, de a KÉSŐBB csatlakozó böngészők NEM. A relay `open` handler-ében cache-elni + replay-elni kell az utolsó snapshot-ot.
- A `buildStatusLabel` line 161 `(snapshot.strategies.length)`-et olvas, de az `App.tsx` a `useWebSocket()`-ból jövő `snapshot`-ot adja át (ami a teljes ServerMessage). A `strategies` mező undefined. `Array.isArray` check megoldja.
- **NEW (PR #183)**: `MockExchangeFeed` strictly test-only pattern — `__testing__/` subdir + `paths` alias + throw-on-undefined-mock-config. Production code CANNOT import it; tests reach it via `@exchange-testing/mockFeed.js`.

### Open questions for user (post-phase)
- A `donchian_pivot_composition` stratégia minden ticknél új pozíciót nyit, SOHA nem zár → L2 leverage cap elbukik 2-3 perc után. Ez stratégia-hiba, NEM Phase 66 hiba. Külön PR.
- A `PaperTrader` (`packages/paper`) bypass-olva van a thin wrapper miatt — future work a PnL tracking rendes szimulációjához.
- A `buildStatusLabel` long-term fix: használja a `snapshot.snapshot.strategies` path-ot (most `Array.isArray` defensíven check-el, de a `useWebSocket` snapshot shape és a `StateFeedSnapshot` shape közötti inkonzisztencia fennmarad).

### Next phase: ⏸️ WAITING FOR USER
- Nincs új user mandate. A `board.md` frissítve, memory fold-back kész.
- Várható next user input: új phase mandate, vagy a `donchian_pivot_composition` strategy fix request.
