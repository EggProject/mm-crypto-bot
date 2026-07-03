# Stack Findings — CCXT Pro, bybit.eu, Bun + Turborepo, TS, ESLint, TUI

> Dátum: 2026-07-03 · Szerző: CCXT Pro Specialist (agent-4bd5822807ad) ·
> Hatókör: az `mm-crypto-bot` projekt stack-döntéseit megalapozó kutatás.
> Minden állítás ≥2 független URL-lel van alátámasztva — az URL-ek a
> [`sources-stack.md`](./sources-stack.md) fájlban találhatók, számokkal
> hivatkozva (pl. `[1.4]`, `[2.11]`).

---

## 1. CCXT Pro — verzió, WebSocket támogatás, paper/demo trading

### 1.1 Verzió és csomagkezelés

- **Aktuális stabil CCXT verzió: `4.5.64`** (lekérve 2026-07-03 a
  `registry.npmjs.org/ccxt` registry-ből, ahol a `dist-tags.latest` értéke
  `4.5.64` — megelőzve a CCXT Pro Manual oldalon 2026-06-29-re datált
  `v4.5.62`-t) `[1.12]` `[1.4]`.
- A CCXT monorepo a CCXT Pro WebSocket stack-et ugyanabban a `ccxt`
  csomagban szállítja JS/PHP/Python/C#/Go/Java nyelvekre — nincs külön
  `ccxt.pro` npm csomag `[1.1]` `[1.2]`. Telepítés: `npm install ccxt`
  ugyanúgy, mint a REST-only CCXT-nél.
- **Támogatott exchange-ek száma**: 75 a WebSocket/CCXT Pro oldalon
  (a wiki kézzel karban tartott táblázatában) `[1.5]`. A listán **külön
  `bybit` (id: `bybit`) és `bybiteu` (id: `bybiteu`) exchange-ID-k** vannak
  felsorolva `[1.3]` `[2.12]` — tehát a bybit.eu **első osztályú CCXT
  lakos**.

### 1.2 WebSocket / CCXT Pro bybit.eu-hoz

- A `bybit` és `bybiteu` exchange osztály egyaránt támogatja a
  `watchOrderBook`, `watchTicker`, `watchTrades`, `watchOHLCV`,
  `watchOrders`, `watchMyTrades`, `watchBalance` és `watchPositions`
  streameket `[1.7]`.
- A bybit V5 API-t használja (`version: 'v5'`, `hostname: 'bybit.com'`,
  `rateLimit: 20` ms) `[1.11]`. A `hostname` opció felülírásával
  átválthatunk `bybit.eu`/`bybit.nl`/`bybit.com.hk` hostra `[1.11]`.
- A CCXT Pro beépítetten kezeli a reconnect-et és az exponential backoff
  rate-limitet: „The library will handle the subscription
  request/response messaging sequences as well as the
  authentication/signing if the requested stream is private. The library
  will also watch the status of the uplink and will keep the connection
  alive. Upon a critical exception, a disconnect or a connection
  timeout/failure, the next iteration of the tick function will call the
  `watch` method that will trigger a reconnection. CCXT Pro applies the
  necessary rate-limiting and exponential backoff reconnection delays."
  `[7.5]`.

### 1.3 Paper / demo trading a CCXT Pro-n belül

- **A CCXT nem belső paper-trading motor** — „CCXT does not decide your
  prices, it's not a bot. It's a programmatic library of codes for
  developers." `[1.8]`
- A CCXT támogatja a tőzsdék által kínált sandbox/testnet/demo környezetet:
  a `setSandboxMode(true)` hívás azonnali átkapcsolás `api-testnet.*`
  URL-re `[1.6]` `[1.10]`. bybit esetén ez a `https://api-testnet.bybit.com`
  sandboxot jelenti `[1.11]`.
- A bybit emellett külön **demo trading** (`api-demo.{hostname}`) módot is
  kínál `[1.7]` `[1.11]`, amelyhez a `bybit.enableDemoTrading(true)` CCXT
  metódus használható (lásd `enableDemoTrading` a bybit API referenciában)
  `[1.7]`. A Bitget demo trading kapcsán dokumentált viselkedés analóg:
  `setSandboxMode(true)` + `productType: 'SUSDT-FUTURES'` `[1.14]` —
  bybit-en ugyanez a koncepció, csak a V5 API `setMarginMode` és
  `category` paraméterekkel.
- **Következtetés**: A mi esetünkre (bybit.eu spot + spot margin 1:10,
  BTC/ETH/SOL) a bybit.eu oldalán **nincs publikus sandbox/demo URL**
  dokumentálva (maga a CCXT Pro manual nem jelöli a `bybiteu` sort
  sandbox-kompatibilisnek). A bybit.eu jelenleg production-only entity a
  MiCAR alatt `[2.1]` `[2.4]`.

### 1.4 Saját paper-trading emulátor a CCXT Pro WS feedre

Mivel a bybit.eu-n nem érhető el sandbox/demo, saját emulátort kell
építenünk a CCXT Pro WebSocket feedre:

1. **Input**: A `watchOrderBook`, `watchTicker`, `watchTrades` streamek
   valós idejű adatai (CCXT Pro-ból).
2. **Virtuális számla**: Lokális state-machine a Cash + Position
   (qty, avg price, realized/unrealized PnL) tárolására.
3. **Végrehajtás szimuláció**: A `createOrder`/`cancelOrder` hívásokat a
   CCXT Pro-tól függetlenül, lokálisan oldjuk fel. A market order-ek a
   beérkező ticker bid/ask áron teljesülnek (slippage modellel), a limit
   order-ek az orderbookon haladnak végig (fill modellel).
4. **Megbízhatóság**: A emulátor ne a CCXT WS-től függjön a döntéshozatal
   pontosságában — ha bármilyen sequence gap-et észlelünk (ld. §7),
   függesszük fel a trade-et és reconcile-oljunk REST snapshot-tal.
5. **Könyvelés**: Minden szimulált fill SQLite/Postgres táblába kerül,
   hogy később visszajátszható legyen.

> A `crates.io/crates/ccxt-flux-sidecar/0.1.0-alpha.3` projekt egy
> Rust-ban íródott sidecar, ami pontosan ezt csinálja: exchange WS feed +
> REST snapshot → deterministic LOB. Ha a későbbiekben Rust felé mozdulunk
> el, érdemes referenciaként használni `[8.3]`.

---

## 2. bybit.eu vs bybit.com — spot, tőkeáttétel, díjak, asset lista

### 2.1 Szabályozási háttér

- A **bybit.eu** a **Bybit EU GmbH** (székhely: Bécs, Ausztria) által
  üzemeltetett, **MiCAR CASP** (Crypto-Asset Service Provider) licensszel
  rendelkező platform, kifejezetten az **EGT (EEA)** felhasználóknak —
  kivéve Máltát `[2.1]` `[2.4]` `[2.9]`.
- A bybit.eu-t **2025-07-01-én indították el**, és 2025-08-18-tól
  elérhető a **Spot Margin** kereskedés is, **max. 10× tőkeáttétellel**
  `[2.1]` `[2.2]` `[2.3]`.

### 2.2 Spot és tőkeáttétel

| Tulajdonság | bybit.com (global) | bybit.eu (MiCAR) |
|---|---|---|
| Spot | ✅ natív | ✅ natív |
| Spot Margin | ✅ (max 10×) | ✅ (max **10×**, 2025-08-18 óta) `[2.1]` `[2.5]` |
| Margin típus | Cross + Isolated | **Csak Cross Margin** `[2.1]` |
| Maintenance Margin | Változó | **100% MMR% → liquidation** `[2.1]` `[2.5]` |
| Hourly borrow fee | Változó | Pl. USDT 0.01%/h `[2.4]` |
| Liquidation fee | Változó | 2% az insurance pool-ba `[2.4]` |
| Futures (retail) | ✅ max 1:200 `[2.11]` | ❌ **MiCA tiltja** retail-nek `[2.4]` |
| Options | ✅ | ❌ |
| Leverage tudáskvíz | Nem kötelező | **Kötelező** (`client readiness testing`) `[2.1]` |

### 2.3 Díjak

- **Standard spot díj mindkét platformon: 0.1% maker / 0.1% taker**
  (non-VIP) `[2.4]`. A VIP szint 30 napos volume alapján **0.05%-ig**
  csökkenthető `[2.4]`.
- A `directionsmag.com` szerint a globális Bybit „0.0200% maker / 0.0300%
  taker" spot díjat is listáz — ez VIP-szintnek felel meg, vagy egy adott
  promóció eredménye `[2.11]`. A mi célunkra a **0.1% spot díjkalkulációval**
  érdemes számolni alapértelmezetten.

### 2.4 Asset lista (BTC, ETH, SOL elérhetősége)

A bybit spot directory és a Convert lista alapján mindhárom coin elérhető
a bybit.eu-n:

| Pár | bybit.com | bybit.eu | Forrás |
|---|---|---|---|
| BTC/USDT | ✅ | ✅ (spot margin 10×) | `[2.7]` `[2.6]` |
| BTC/USDC | ✅ | ✅ | `[2.1]` `[2.7]` |
| ETH/USDT | ✅ | ✅ | `[2.7]` |
| ETH/USDC | ✅ | ✅ (spot margin 10×) | `[2.1]` `[2.7]` |
| SOL/USDC | ✅ | ✅ | `[2.7]` |
| SOL/USDT | ✅ | ✅ | `[2.7]` |

A bybit.eu-n **a 1:10 spot margin BTC/USDC és ETH/USDC párokon** érhető el
explicit, ahogy a Bybit EU 2025-08-18-as launch-közleménye hangsúlyozza
`[2.1]`. A „Popular pairs like BTC/USDC, ETH/USDC, and others are already
available with Spot Margin functionality." megerősíti, hogy ezek a párok a
bybit.eu-n alap spot kereskedésre és spot marginra is mennek.

### 2.5 Összefoglaló

A `mm-crypto-bot` számára a bybit.eu támogatja az eredeti spec-ben
szereplő **1:10 spot margin**-t a BTC/ETH párokon (és SOL elérhető spot
kereskedésre). A hiányzó futures/options funkciók **nem blokkolják** a
spot-only botunkat, sőt a MiCAR compliance egyszerűsíti a jogi
környezetet.

---

## 3. Bun + Turborepo + TypeScript ultra-strict kompatibilitás

### 3.1 Bun aktuális verzió és támogatás

- **Bun stable: `1.3.14`** (npm `dist-tags.latest`, 2026-07-03-i lekérés)
  `[3.5]`. A honlap is `v1.3.14`-et hirdeti `[3.3]`.
- Támogatja a Linuxot (x64/arm64), macOS-t (x64 + Apple Silicon),
  Windowst (x64/arm64); Linux esetén **kernel ≥ 5.6** ajánlott `[3.4]`.
- A Bun 2026-ban „production-ready" runtime-nak tekinthető, amiben egy
  csomagban van a runtime, package manager, bundler, test runner és
  TypeScript transpiler `[3.3]` `[3.9]`.

### 3.2 Turborepo ↔ Bun

- **Turborepo 2.6-tól kezdve a Bun package manager stable státuszú** —
  „Bun package manager to stable: Granular lockfile analysis and pruning
  for `bun.lock`" `[3.1]`.
- A Turborepo support policy táblázat: **`bun 1.2+ → Stable`** `[3.2]`.
  Mivel a mi pinned verziónk `1.3.14 ≥ 1.2`, a támogatás garantált.
- A Turborepo legújabb verziója **`2.10.2`** (npm registry, „Published 3
  days ago") `[3.6]`.
- A `bun.lock` v1-es formátumát a Turborepo teljes mértékben kezeli
  `[3.1]`.

### 3.3 TypeScript futtatás Bun alatt

- A Bun natívan futtatja a `.ts` fájlokat külön `tsc` nélkül, és a
  `tsconfig.json` `compilerOptions`-t parse-olja a típus-ellenőrzéshez
  `[3.9]`. A Bun a `tsconfig.json` `paths` aliasait is feloldja.
- A TS strict mode és az ultra-strict kiegészítők (`noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`, `verbatimModuleSyntax`) **nem ütköznek**
  a Bun runtime-tal — ezek fordításidejű kapcsolók `[5.4]` `[5.6]`.

### 3.4 TypeScript aktuális verzió

- **TypeScript stabil: `6.0.3`** (npm `dist-tags.latest`) `[3.10]`. A
  `7.0.1-rc` release candidate elérhető, de production-botnál a `6.0.3`
  a javasolt `[3.10]`.
- A `@tsconfig/bases` community karbantartású preset csomag
  (`@tsconfig/strictest`, `@tsconfig/node20` stb.) `1.0.25`-ös verziónál
  tart `[5.7]`.

### 3.5 Monorepo topológia

A `mm-crypto-bot` várható monorepo struktúrája Turborepo + Bun alatt:

```
mm-crypto-bot/
├── apps/
│   ├── bot/        # A core trading engine (CCXT Pro wrapper)
│   └── tui/        # A TUI frontend (ink)
├── packages/
│   ├── exchange/   # CCXT Pro bybit.eu adapter
│   ├── strategy/   # Trading signal logika
│   └── shared/     # Közös típusok, util-ok
├── turbo.json
├── bun.lock
└── tsconfig.base.json
```

A `turbo.json` a `build`, `lint`, `test`, `dev`, `typecheck` scripteket
definiálja a pipeline-ban, a `bun.lock` lockfile-ot a Turborepo
granulárisan cache-eli `[3.1]`.

---

## 4. TUI választás: ratatui (Rust) vs ink (React/Node/TS)

> A részletes összehasonlítás és az indoklás a [`tui-decision.md`](./tui-decision.md)
> fájlban található. Itt csak a stack-koherencia szempontjából releváns
> döntéseket foglaljuk össze.

### 4.1 Stack-koherencia

- A projekt **Bun + TypeScript ultra-strict** stack-et választ. Ehhez a
  stack-hez az **Ink** (React/TS, npm `7.1.0`) illeszkedik
  természetesen: ugyanaz a nyelv, ugyanaz a toolchain, ugyanaz a
  `tsconfig.json` `[4.9]`.
- A **Ratatui** Rust nyelven íródott (legújabb verzió: `v0.30.2`,
  2026-06-19) `[4.2]`. A beépülése a Bun/TS projektbe egy **külön
  FFI / sidecar binary**-n keresztül történhet, ami többlet
  komplexitás (külön build pipeline, Rust toolchain a CI-ban,
  platform-specifikus binárisok).

### 4.2 Funkciók a bot-hoz

- A kívánt TUI funkciók (realtime frissítés, indítás/leállítás,
  statisztikai menü, history) **mindkét keretrendszerrel megvalósíthatók**
  `[4.1]` `[4.3]`. Az Ink a React komponens-modellel deklaratívabb, míg a
  Ratatui immediate-mode-ban működik Rust struct-okkal `[4.4]`.

### 4.3 Karbantarthatóság magyar fejlesztőknek

- Az Ink React/TypeScript mintát követ — a meglévő frontend-es
  TypeScript-tudás közvetlenül alkalmazható. A Ratatui Rust-ot
  igényel, ami plusz tanulási görbe és egy másik ökoszisztéma
  (Cargo, async Rust, borrow checker).
- A magyar nyelvű string-ek, Unicode kezelés és i18n mindkét
  keretrendszerben működik.

### 4.4 Teljesítmény

- A Ratatui Rust-oldali renderelése és a diff-engine (lásd
  `ratatat` projekt, ami React API-t + Rust diff-et kombinál) mérhetően
  gyorsabb lehet extrém update rate-nél `[4.5]`. A mi felhasználási
  esetünkben (1-3 ticker, ~1-10 update/sec) **a teljesítménykülönbség
  nem releváns**.

### 4.5 Döntés

**Az Ink (`v7.1.0`) a választott TUI-keretrendszer.** A teljes
indoklás és a Ratatui-val való side-by-side összehasonlítás a
`tui-decision.md` fájlban.

---

## 5. TypeScript legszigorúbb beállítások (tsconfig)

### 5.1 Ajánlott `tsconfig.base.json` (ultra-strict)

A `@tsconfig/strictest` community preset-et vesszük alapul, és kiegészítjük
a Bun-nal és a CCXT-vel való kompatibilitáshoz szükséges opciókkal
`[5.3]` `[5.5]` `[5.6]` `[3.4]`:

```jsonc
{
  "$schema": "https://json.schemastore.org/tsconfig",
  "compilerOptions": {
    /* Alap */
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "moduleDetection": "force",
    "resolveJsonModule": true,
    "esModuleInterop": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "allowImportingTsExtensions": false,
    "noEmit": true,

    /* Szigor (strict + minden kiegészítő) */
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "strictFunctionTypes": true,
    "strictBindCallApply": true,
    "strictPropertyInitialization": true,
    "noImplicitThis": true,
    "useUnknownInCatchVariables": true,
    "alwaysStrict": true,

    /* További strictness (a `@tsconfig/strictest` alapján) */
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noPropertyAccessFromIndexSignature": true,
    "allowUnusedLabels": false,
    "allowUnreachableCode": false,

    /* Bun/CCXT-kompatibilitás */
    "skipLibCheck": true,
    "types": ["bun-types"]
  }
}
```

### 5.2 Indoklás

- `strict: true` — bekapcsolja az összes strict type-check opciót
  `[5.4]` `[5.5]`. **Indispensable** (Total TypeScript).
- `noUncheckedIndexedAccess: true` — az `arr[0]` típusa `T | undefined`
  lesz, nem csak `T` — kiszűri az out-of-bounds hibákat a CCXT Pro
  callback-ekben `[5.1]` `[5.4]`.
- `exactOptionalPropertyTypes: true` — megkülönbözteti `undefined`-et
  a hiányzó property-től `[5.3]`.
- `verbatimModuleSyntax: true` — TypeScript 5.0+ ajánlott a helyes ESM
  import-export-hoz Bun alatt `[5.6]`.
- `skipLibCheck: true` — felgyorsítja a buildet a `node_modules` típus-
  definíciók átugrásával `[5.5]`.
- `noEmit: true` — a TypeScript csak type-check-et végez, a Bun
  (`bun --bun ./src/index.ts`) vagy `tsc-alias` + `tsup` végzi az
  emitet.

### 5.3 Csomag-szintű kiterjesztés

A monorepo minden package-je `extends: "@tsconfig/strictest"`-et vagy a
fenti `tsconfig.base.json`-t használja, és a saját `compilerOptions`-ban
csak a `composite`, `outDir`, `rootDir` értékeket írja felül `[5.3]`.

---

## 6. ESLint ultra-strict (typescript-eslint + security)

### 6.1 Verziók

- **ESLint: `10.6.0`** (npm latest, 2026-07-03) `[6.8]`.
- **`@typescript-eslint/eslint-plugin` + parser: `8.62.1`** (8.62.2-alpha
  fejlesztés alatt) `[6.7]`.
- **`eslint-plugin-security: 4.0.1`** `[6.6]`.

### 6.2 Ajánlott flat config (`eslint.config.js`)

A `typescript-eslint` v8-as flat config formátumot használunk
`[6.1]` `[6.2]`:

```js
// eslint.config.js
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import security from "eslint-plugin-security";

export default tseslint.config(
  // 1. Alap JS szabályok
  js.configs.recommended,

  // 2. TypeScript type-checked preset (legszigorúbb)
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,

  // 3. Security preset
  security.configs.recommended,

  // 4. Projekt-szintű finomhangolás
  {
    languageOptions: {
      parserOptions: {
        projectService: true,        // v8+ ajánlott: typescript-eslint
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // typescript-eslint strict-type-checked + stylistic-type-checked
      // már tartalmazza a legtöbb strict rule-t; itt csak kiegészítünk:
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/no-unnecessary-condition": "error",

      // Security
      "security/detect-object-injection": "warn",  // FP-veszélyes, ezért warn
      "security/detect-non-literal-regexp": "error",
      "security/detect-unsafe-regex": "error",
      "security/detect-eval-with-expression": "error",
      "security/detect-non-literal-require": "error",
      "security/detect-non-literal-fs-filename": "warn",
      "security/detect-child-process": "warn",
      "security/detect-possible-timing-attacks": "warn",
      "security/detect-bidi-characters": "error",
    },
  },

  // 5. Tesztek feloldása a type-check alól (gyorsabb lint)
  {
    files: ["**/*.test.ts", "**/*.spec.ts"],
    extends: [tseslint.configs.disableTypeChecked],
  },
);
```

### 6.3 Indoklás

- **`strict-type-checked`** preset a `recommended`-on felül további
  type-aware szabályokat ad hozzá (pl. `no-floating-promises`,
  `no-misused-promises`) `[6.1]` `[6.4]`.
- A `parserOptions.projectService: true` a v8+ ajánlás, mert a
  `project` array manuális karbantartása helyett a TS-ESLint maga
  fedezi fel a tsconfig.json fájlokat `[6.2]`.
- A `disableTypeChecked` preset a tesztekre kikapcsolja a type-aware
  szabályokat (az `any`-ok a fixture-ökben nem kívánatos hibák) `[6.2]`.
- Az `eslint-plugin-security` 14 db rule-t ad `[6.5]`. A
  `detect-object-injection` default `warn`, mert rengeteg false
  positive-ot generál `[6.9]`.

### 6.4 Ami NINCS benne és miért

- **Nincs `eslint-plugin-security-rules`** (a másik hasonló plugin): kevesebb
  a karbantartója, kevesebb szabály, és kísérleti. Helyette a jól
  ismert `eslint-plugin-security`-t használjuk.
- **Nincs `eslint-plugin-jsdoc`**: A TypeScript natívan kezeli a
  típusokat, a JSDoc-szabályok redundánsak lennének.

---

## 7. CCXT Pro rate limit és sequence drift kezelés

### 7.1 REST rate limit

- A CCXT beépített throttlere **alapértelmezetten aktív**
  (`enableRateLimit: true`) `[7.1]`. A `rateLimit` ms-ban van megadva,
  **nem** req/sec-ben `[7.1]` `[7.3]`.
- A `bybit` exchange specifikus `rateLimit: 20` ms (50 req/sec)
  `[1.11]` `[8.1]`. Ez a CCXT alapértelmezése, de exchange-enként
  eltérő `[7.1]`. A bybit V5 API dokumentációban a tényleges limit
  endpoint-csoportonként változó (5-10 req/sec), ezért érdemes
  konzervatívan `rateLimit: 100` (10 req/sec) értéket használni, ha
  sok ordert küldünk `[7.2]`.
- A `setSandboxMode`/`setSandboxMode` hívás **azonnal** kell történjen
  az exchange példány létrehozása után, különben rossz URL-re megy a
  kérés `[1.6]`.

### 7.2 WebSocket rate limit / reconnect

- A CCXT Pro automatikusan kezeli a reconnect-et és az exponential
  backoff-ot `[7.5]`. A felhasználónak nem kell saját retry-loop-ot
  írnia — a `watchOrderBook(symbol)` hívás újracsatlakozik, ha a
  kapcsolat megszakad.
- A **24 órás mandatory disconnect** a bybit-nél (és a legtöbb
  tőzsdénél) egy WS-session limit `[7.4]`. A CCXT Pro ezt is kezeli,
  de a reconnect után **újra kell subscribe-olni** a streamekre.

### 7.3 Sequence drift / message gap

A bybit WS üzenetek tartalmaznak egy `seq` (sequence) mezőt `[7.4]`. Ha
az inkrementális szám nem folytonos:

1. **Észlelés**: A felsőbb rétegünk tárolja az utolsó kapott `seq`-et,
   és minden új üzenetnél ellenőrzi, hogy `expected_seq == msg.seq`.
2. **Reakció**: Ha `gap > 0`, **REST snapshot-tal újraépítjük** a lokális
   state-et (order book, position, balance).
3. **Heartbeat**: A bybit elvárja, hogy a kliens **20 másodpercenként
   pinget** küldjön `[7.4]`. A CCXT Pro ezt transzparensen kezeli.
4. **Idempotency**: A `createOrder` hívásokhoz használjunk egyedi
   `clientOrderId`-t, hogy reconnect után a REST-en lekérdezhessük,
   valóban létrejött-e a megbízás `[7.4]`.

### 7.4 Ajánlott kód-pattern (Bun/TS)

```ts
import ccxt from "ccxt";

const bybit = new ccxt.bybiteu({
  apiKey: process.env.BYBIT_EU_API_KEY!,
  secret: process.env.BYBIT_EU_SECRET!,
  enableRateLimit: true,
  rateLimit: 100,  // 10 req/sec — bybit V5 biztonságos alap
  // options: { defaultType: "spot" },
});
await bybit.loadMarkets();

while (!shuttingDown) {
  try {
    const ob = await bybit.watchOrderBook("BTC/USDC", 20);
    // sequence drift detekció (ha bybit WS seq-et ad)
    // ... alkalmazáslogika ...
  } catch (err) {
    if (err instanceof ccxt.NetworkError) {
      // CCXT Pro automatikusan reconnect-el — itt csak logolunk
      console.warn("WS reconnect:", err.message);
    } else {
      throw err;
    }
  }
}
```

---

## 8. Összefoglaló — pinned verziók és indoklások

A pontos verziók és a forrásaik a [`version-pins.md`](./version-pins.md)
fájlban. A döntésünk a fenti kutatás alapján:

| Komponens | Verzió | Indoklás |
|---|---|---|
| Bun | `1.3.14` | Stabil, TS natív, Turborepo stable támogatás |
| Turborepo | `2.10.2` | Bun PM stable, lockfile-aware cache |
| TypeScript | `6.0.3` | Stabil, az összes ultra-strict opció támogatott |
| CCXT | `4.5.64` | `bybiteu` első osztályú ID, CCXT Pro WS támogatás |
| Ink | `7.1.0` | Bun/TS koherens, React komponens modell |
| ESLint | `10.6.0` | Flat config stabil, typescript-eslint v8-kompatibilis |
| @typescript-eslint | `8.62.1` | `strict-type-checked` preset, `projectService` támogatás |
| eslint-plugin-security | `4.0.1` | 14 security rule, széles körben használt |
| @tsconfig/bases | `1.0.25` | `@tsconfig/strictest` preset |